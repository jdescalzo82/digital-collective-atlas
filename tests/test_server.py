"""End-to-end tests for the backend. Run:  python3 -m unittest discover tests"""

import http.client
import io
import json
import tempfile
import threading
import unittest
import zipfile
from datetime import date
from pathlib import Path

from server.app import App, make_server
from server.config import Config
from server.github import ForkCounter
from server.ratelimit import RateLimiter
from server.store import Store
from server.validation import ValidationError, clean_name


class FakeClock:
    def __init__(self):
        self.t = 1000.0

    def __call__(self):
        return self.t


class ServerTestCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        static = root / "docs"
        static.mkdir()
        (static / "index.html").write_text("<h1>TERMINAL</h1>")
        (static / "style.css").write_text("body{}")
        (static / "sub").mkdir()
        (static / "sub" / "index.html").write_text("sub")
        (static / ".gitkeep").write_text("")
        (root / "secret.txt").write_text("outside")
        (root / "README.md").write_text("# Atlas")
        (root / ".git").mkdir()
        (root / ".git" / "config").write_text("nope")

        self.config = Config(port=0, static_dir=static, archive_root=root,
                             db_path=":memory:", write_burst=5, write_rate_per_min=10)
        self.store = Store(":memory:")
        self.fork_calls = 0
        self.fork_value = 42
        self.fork_fail = False

        def fetcher():
            self.fork_calls += 1
            if self.fork_fail:
                raise OSError("github down")
            return self.fork_value

        self.clock = FakeClock()
        forks = ForkCounter(self.store, "x/y", ttl=600, fetcher=fetcher, clock=self.clock)
        app = App(self.config, store=self.store, forks=forks, limiter=RateLimiter(clock=self.clock),
                  today=lambda: date(2025, 12, 8))
        self.httpd, self.app = make_server(self.config, app)
        self.port = self.httpd.server_address[1]
        self.thread = threading.Thread(target=self.httpd.serve_forever, kwargs={"poll_interval": 0.05}, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        self.store.close()
        self.tmp.cleanup()

    def request(self, method, path, body=None, headers=None, raw=None):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        hdrs = dict(headers or {})
        payload = raw
        if body is not None:
            payload = json.dumps(body).encode()
            hdrs.setdefault("Content-Type", "application/json")
        conn.request(method, path, body=payload, headers=hdrs)
        resp = conn.getresponse()
        data = resp.read()
        conn.close()
        parsed = None
        if resp.getheader("Content-Type", "").startswith("application/json") and data:
            parsed = json.loads(data)
        return resp, parsed, data


class HealthAndStats(ServerTestCase):
    def test_health(self):
        resp, data, _ = self.request("GET", "/api/health")
        self.assertEqual(resp.status, 200)
        self.assertEqual(data["status"], "ok")
        self.assertEqual(resp.getheader("X-Content-Type-Options"), "nosniff")
        self.assertEqual(resp.getheader("Cache-Control"), "no-store")

    def test_stats_countdown_and_day(self):
        resp, data, _ = self.request("GET", "/api/stats")
        self.assertEqual(resp.status, 200)
        self.assertEqual(data["mission_day"], 47)
        self.assertEqual(data["countdown"]["days_remaining"], 11)
        self.assertFalse(data["countdown"]["passed"])
        self.assertEqual(data["forks"], {"count": 42, "source": "github",
                                         "as_of": data["forks"]["as_of"]})

    def test_countdown_after_approach(self):
        self.app.today = lambda: date(2026, 1, 1)
        _, data, _ = self.request("GET", "/api/stats")
        self.assertTrue(data["countdown"]["passed"])
        self.assertEqual(data["countdown"]["days_remaining"], 0)
        self.assertEqual(data["countdown"]["days_since"], 13)

    def test_fork_count_is_cached(self):
        self.request("GET", "/api/stats")
        self.request("GET", "/api/stats")
        self.assertEqual(self.fork_calls, 1)
        self.clock.t += 601
        self.request("GET", "/api/stats")
        self.assertEqual(self.fork_calls, 2)

    def test_fork_count_serves_stale_when_github_fails(self):
        self.request("GET", "/api/stats")
        self.fork_fail = True
        self.clock.t += 601
        _, data, _ = self.request("GET", "/api/stats")
        self.assertEqual(data["forks"]["count"], 42)
        self.assertEqual(data["forks"]["source"], "cache")
        # Backs off instead of retrying on every request.
        self.request("GET", "/api/stats")
        self.assertEqual(self.fork_calls, 2)

    def test_fork_count_unavailable(self):
        self.fork_fail = True
        _, data, _ = self.request("GET", "/api/stats")
        self.assertEqual(data["forks"], {"count": None, "source": "unavailable", "as_of": None})


class Consent(ServerTestCase):
    def test_consent_creates_then_reuses_token(self):
        resp, data, _ = self.request("POST", "/api/consent", {})
        self.assertEqual(resp.status, 201)
        token = data["token"]
        resp, data, _ = self.request("POST", "/api/consent", {"token": token})
        self.assertEqual(resp.status, 200)
        self.assertEqual(data["token"], token)
        self.assertEqual(self.store.counts()["consents"], 1)

    def test_consent_unknown_token_issues_new(self):
        resp, data, _ = self.request("POST", "/api/consent", {"token": "A" * 32})
        self.assertEqual(resp.status, 201)
        self.assertNotEqual(data["token"], "A" * 32)

    def test_consent_rejects_refusal_and_bad_token(self):
        resp, data, _ = self.request("POST", "/api/consent", {"accepted": False})
        self.assertEqual(resp.status, 400)
        resp, data, _ = self.request("POST", "/api/consent", {"token": "<script>"})
        self.assertEqual(resp.status, 400)
        self.assertEqual(data["error"]["code"], "invalid_token")

    def test_empty_body_is_allowed(self):
        resp, _, _ = self.request("POST", "/api/consent", raw=b"",
                                  headers={"Content-Type": "application/json"})
        self.assertEqual(resp.status, 201)


class Bridges(ServerTestCase):
    def register(self, name, token=None, **extra):
        headers = {"Authorization": f"Bearer {token}"} if token else {}
        return self.request("POST", "/api/bridges", {"name": name, **extra}, headers)

    def test_register_lookup_rename_forget(self):
        resp, data, _ = self.register("  Ada   Lovelace ")
        self.assertEqual(resp.status, 201)
        token = data["token"]
        self.assertEqual(data["bridge"]["name"], "Ada Lovelace")
        self.assertEqual(data["bridge"]["number"], 1)

        resp, data, _ = self.request("GET", "/api/bridges/me",
                                     headers={"Authorization": f"Bearer {token}"})
        self.assertEqual(resp.status, 200)
        self.assertEqual(data["bridge"]["name"], "Ada Lovelace")

        resp, data, _ = self.register("Countess", token)
        self.assertEqual(resp.status, 200)
        self.assertEqual(data["token"], token)
        self.assertEqual(data["bridge"]["name"], "Countess")
        self.assertEqual(self.store.counts()["bridges"], 1)

        resp, _, _ = self.request("DELETE", "/api/bridges/me",
                                  headers={"Authorization": f"Bearer {token}"})
        self.assertEqual(resp.status, 204)
        resp, _, _ = self.request("GET", "/api/bridges/me",
                                  headers={"Authorization": f"Bearer {token}"})
        self.assertEqual(resp.status, 404)

    def test_links_visitor(self):
        _, consent, _ = self.request("POST", "/api/consent", {})
        resp, _, _ = self.register("Kipp", visitor_token=consent["token"])
        self.assertEqual(resp.status, 201)

    def test_unknown_bridge_token_creates_new_bridge(self):
        resp, data, _ = self.register("Kipp", "B" * 32)
        self.assertEqual(resp.status, 201)
        self.assertNotEqual(data["token"], "B" * 32)

    def test_invalid_names(self):
        for bad in ["", "   ", "x" * 33, "<script>", "a\u0000b", "---", "a‮b", 12, None]:
            self.clock.t += 60  # refill the write bucket
            resp, data, _ = self.register(bad)
            self.assertEqual(resp.status, 422, bad)
            self.assertEqual(data["error"]["field"], "name")

    def test_unicode_names_ok(self):
        for good in ["José", "Сергей", "李雷", "O'Brien", "TARS-2.0", "Ｆｕｌｌ"]:
            resp, data, _ = self.register(good)
            self.assertIn(resp.status, (200, 201), good)
            self.clock.t += 60  # refill the write bucket
        self.assertEqual(clean_name("Ｆｕｌｌ"), "Full")

    def test_auth_errors(self):
        resp, data, _ = self.request("GET", "/api/bridges/me")
        self.assertEqual(resp.status, 401)
        resp, data, _ = self.request("GET", "/api/bridges/me", headers={"Authorization": "Basic x"})
        self.assertEqual(resp.status, 400)
        resp, data, _ = self.request("DELETE", "/api/bridges/me",
                                     headers={"Authorization": "Bearer " + "C" * 32})
        self.assertEqual(resp.status, 404)

    def test_tokens_are_hashed_at_rest(self):
        _, data, _ = self.register("Kipp")
        rows = self.store._db.execute("SELECT token_hash FROM bridges").fetchall()
        self.assertNotIn(data["token"], [r[0] for r in rows])


class RequestHardening(ServerTestCase):
    def test_wrong_content_type(self):
        resp, data, _ = self.request("POST", "/api/bridges", raw=b"name=x",
                                     headers={"Content-Type": "application/x-www-form-urlencoded"})
        self.assertEqual(resp.status, 415)

    def test_invalid_json(self):
        for raw in [b"{nope", b"[1,2]", b"\xff\xfe", b'"str"']:
            resp, data, _ = self.request("POST", "/api/bridges", raw=raw,
                                         headers={"Content-Type": "application/json"})
            self.assertEqual(resp.status, 400, raw)

    def test_body_too_large(self):
        resp, data, _ = self.request("POST", "/api/bridges", raw=b"{" + b" " * 5000 + b"}",
                                     headers={"Content-Type": "application/json"})
        self.assertEqual(resp.status, 413)

    def test_unknown_endpoint_and_method(self):
        resp, data, _ = self.request("GET", "/api/nope")
        self.assertEqual(resp.status, 404)
        resp, data, _ = self.request("PUT", "/api/stats")
        self.assertEqual(resp.status, 405)
        self.assertEqual(resp.getheader("Allow"), "GET")
        resp, _, _ = self.request("POST", "/index.html")
        self.assertEqual(resp.status, 405)

    def test_rate_limit_writes(self):
        statuses = [self.request("POST", "/api/consent", {})[0].status for _ in range(8)]
        self.assertIn(429, statuses)
        resp, _, _ = self.request("POST", "/api/consent", {})
        self.assertEqual(resp.status, 429)
        self.assertTrue(resp.getheader("Retry-After"))
        self.clock.t += 60
        self.assertEqual(self.request("POST", "/api/consent", {})[0].status, 201)

    def test_rejected_body_does_not_poison_keepalive(self):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        for _ in range(7):  # exhaust the write bucket on one connection
            conn.request("POST", "/api/consent", body=b'{"accepted": true}',
                         headers={"Content-Type": "application/json"})
            last = conn.getresponse()
            last.read()
        self.assertEqual(last.status, 429)
        conn.request("GET", "/api/health")
        self.assertEqual(conn.getresponse().status, 200)
        conn.close()

    def test_cors(self):
        origin = "https://jdescalzo82.github.io"
        resp, _, _ = self.request("OPTIONS", "/api/bridges", headers={
            "Origin": origin, "Access-Control-Request-Method": "POST"})
        self.assertEqual(resp.status, 204)
        self.assertEqual(resp.getheader("Access-Control-Allow-Origin"), origin)
        resp, _, _ = self.request("GET", "/api/stats", headers={"Origin": "https://evil.example"})
        self.assertIsNone(resp.getheader("Access-Control-Allow-Origin"))

    def test_keepalive_survives_error(self):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        conn.request("POST", "/api/nope", body=b'{"a":1}',
                     headers={"Content-Type": "application/json"})
        self.assertEqual(conn.getresponse().read() and 404, 404)
        conn.request("GET", "/api/health")
        self.assertEqual(conn.getresponse().status, 200)
        conn.close()


class Static(ServerTestCase):
    def test_index_and_assets(self):
        resp, _, body = self.request("GET", "/")
        self.assertEqual(resp.status, 200)
        self.assertEqual(body, b"<h1>TERMINAL</h1>")
        resp, _, _ = self.request("GET", "/style.css")
        self.assertTrue(resp.getheader("Content-Type").startswith("text/css"))

    def test_directory_redirect_and_index(self):
        resp, _, _ = self.request("GET", "/sub")
        self.assertEqual(resp.status, 301)
        resp, _, body = self.request("GET", "/sub/")
        self.assertEqual(body, b"sub")

    def test_traversal_and_dotfiles_blocked(self):
        for path in ["/../secret.txt", "/%2e%2e/secret.txt", "/sub/../../secret.txt",
                     "/.gitkeep", "/%00", "/..%5csecret.txt"]:
            resp, _, body = self.request("GET", path)
            self.assertIn(resp.status, (400, 404), path)
            self.assertNotIn(b"outside", body)

    def test_etag(self):
        resp, _, _ = self.request("GET", "/style.css")
        etag = resp.getheader("ETag")
        resp, _, _ = self.request("GET", "/style.css", headers={"If-None-Match": etag})
        self.assertEqual(resp.status, 304)

    def test_head(self):
        resp, _, body = self.request("HEAD", "/")
        self.assertEqual(resp.status, 200)
        self.assertEqual(body, b"")


class Download(ServerTestCase):
    def test_zip(self):
        resp, _, body = self.request("GET", "/api/download")
        self.assertEqual(resp.status, 200)
        self.assertEqual(resp.getheader("Content-Type"), "application/zip")
        self.assertIn("attachment", resp.getheader("Content-Disposition"))
        names = zipfile.ZipFile(io.BytesIO(body)).namelist()
        self.assertIn("digital-collective-atlas/README.md", names)
        self.assertIn("digital-collective-atlas/docs/index.html", names)
        self.assertFalse(any("/.git/" in n or n.endswith(".gitkeep") for n in names))


class Units(unittest.TestCase):
    def test_rate_limiter_refills(self):
        clock = FakeClock()
        rl = RateLimiter(clock=clock)
        self.assertTrue(all(rl.allow("k", 60, 2)[0] for _ in range(2)))
        ok, retry = rl.allow("k", 60, 2)
        self.assertFalse(ok)
        self.assertGreaterEqual(retry, 1)
        clock.t += 1.0
        self.assertTrue(rl.allow("k", 60, 2)[0])

    def test_fork_cache_survives_restart(self):
        store = Store(":memory:")
        ForkCounter(store, "x/y", fetcher=lambda: 7).get()

        def boom():
            raise OSError
        again = ForkCounter(store, "x/y", fetcher=boom).get()
        self.assertEqual((again["count"], again["source"]), (7, "cache"))

    def test_clean_name_errors(self):
        with self.assertRaises(ValidationError):
            clean_name("​")


if __name__ == "__main__":
    unittest.main()
