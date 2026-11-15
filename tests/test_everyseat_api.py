"""End-to-end tests for the Every Seat PHP API (stage360/api).

Runs the API under PHP's built-in server with a throwaway SQLite database.
Run:  python3 -m unittest tests.test_everyseat_api
"""

import json
import os
import re
import shutil
import socket
import subprocess
import tempfile
import time
import unittest
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STAGE = ROOT / "stage360"
KEY = "test-director-key-0123456789"


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@unittest.skipUnless(shutil.which("php"), "php not installed")
class EverySeatApi(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.port = free_port()
        env = dict(os.environ, ES_DB_PATH=str(Path(cls.tmp.name) / "es.sqlite"),
                   ES_DIRECTOR_KEY=KEY, ES_RATE_SCALE="100", PHP_CLI_SERVER_WORKERS="4")
        cls.proc = subprocess.Popen(
            ["php", "-S", f"127.0.0.1:{cls.port}", "-t", str(STAGE)],
            env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(50):
            try:
                socket.create_connection(("127.0.0.1", cls.port), timeout=0.2).close()
                break
            except OSError:
                time.sleep(0.1)

    @classmethod
    def tearDownClass(cls):
        cls.proc.terminate()
        cls.proc.wait(5)
        cls.tmp.cleanup()

    def call(self, method, route, body=None, token=None, raw=None, ctype="application/json", query=""):
        url = f"http://127.0.0.1:{self.port}/api/?r={route}{query}"
        data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
        req = urllib.request.Request(url, data=data, method=method)
        if data is not None and ctype:
            req.add_header("Content-Type", ctype)
        if token:
            req.add_header("X-ES-Token", token)
        try:
            with urllib.request.urlopen(req, timeout=5) as r:
                text = r.read()
                return r.status, (json.loads(text) if text else None), r.headers
        except urllib.error.HTTPError as e:
            text = e.read()
            return e.code, (json.loads(text) if text else None), e.headers

    # helpers
    def pair(self):
        s, viewer, _ = self.call("POST", "/rooms", {})
        self.assertEqual(s, 201)
        s, remote, _ = self.call("POST", "/rooms/join", {"code": viewer["display_code"].lower()})
        self.assertEqual(s, 201, remote)
        return viewer, remote

    # ---------------------------------------------------------------- basics
    def test_health_and_config(self):
        s, d, h = self.call("GET", "/health")
        self.assertEqual((s, d["status"]), (200, "ok"))
        self.assertEqual(h["Cache-Control"], "no-store")
        s, d, _ = self.call("GET", "/config")
        self.assertEqual(s, 200)
        self.assertEqual([c["id"] for c in d["cams"]], ["front", "mid", "balcony", "stage", "wings", "foh"])
        self.assertTrue(d["director_enabled"])

    def test_cams_match_player(self):
        html = (STAGE / "index.html").read_text()
        player_ids = re.findall(r"\{ id: '(\w+)',\s+key: \d", html)
        _, d, _ = self.call("GET", "/config")
        self.assertEqual(player_ids, [c["id"] for c in d["cams"]])

    def test_unknown_routes(self):
        self.assertEqual(self.call("GET", "/nope")[0], 404)
        self.assertEqual(self.call("GET", "/rooms/zzz/commands")[0], 404)
        self.assertEqual(self.call("GET", "/rooms")[0], 405)

    def test_internal_files_not_served(self):
        for path in ["/api/config.php", "/api/lib.php"]:
            with urllib.request.urlopen(f"http://127.0.0.1:{self.port}{path}") as r:
                body = r.read()
            # PHP runs them instead of printing source; they must output nothing.
            self.assertNotIn(b"director_key", body)
            self.assertEqual(body.strip(), b"")

    # --------------------------------------------------------------- pairing
    def test_full_remote_flow(self):
        viewer, remote = self.pair()
        room = viewer["room"]
        self.assertEqual(remote["room"], room)

        s, d, _ = self.call("GET", f"/rooms/{room}/commands", token=viewer["token"], query="&after=-1")
        self.assertEqual((s, d["commands"]), (200, []))
        cursor = d["cursor"]
        self.assertEqual(d["remotes"], 1)

        cmds = [
            {"type": "seat", "cam": "balcony"},
            {"type": "seek", "t": 42.123},
            {"type": "guided", "on": False},
            {"type": "setting", "key": "capsize", "value": "large"},
            {"type": "setting", "key": "vocal", "value": 6},
            {"type": "toggle_play"},
            {"type": "menu", "open": False},
            {"type": "skip", "by": -10},
        ]
        for c in cmds:
            s, d, _ = self.call("POST", f"/rooms/{room}/commands", c, token=remote["token"])
            self.assertEqual(s, 201, (c, d))
            self.assertTrue(d["viewer_online"])

        s, d, _ = self.call("GET", f"/rooms/{room}/commands", token=viewer["token"], query=f"&after={cursor}")
        got = [{k: v for k, v in c.items() if k != "id"} for c in d["commands"]]
        cmds[1]["t"] = 42.12
        self.assertEqual(got, cmds)
        s, d2, _ = self.call("GET", f"/rooms/{room}/commands", token=viewer["token"], query=f"&after={d['cursor']}")
        self.assertEqual(d2["commands"], [])

        status = {"cam": "balcony", "guided": False, "playing": True, "t": 42.1, "xr": True,
                  "audio_locked": False, "section": "Verse 1",
                  "settings": {"captions": True, "capsize": "large", "vocal": 6, "future_thing": 1}}
        s, _, _ = self.call("POST", f"/rooms/{room}/status", {"status": status}, token=viewer["token"])
        self.assertEqual(s, 204)
        s, d, _ = self.call("GET", f"/rooms/{room}/status", token=remote["token"])
        self.assertEqual(s, 200)
        self.assertEqual(d["status"]["cam"], "balcony")
        self.assertNotIn("future_thing", d["status"]["settings"])
        self.assertTrue(d["viewer_online"])

        # remote leaves; viewer closes; remote is then locked out
        self.assertEqual(self.call("DELETE", f"/rooms/{room}", token=remote["token"])[0], 204)
        self.assertEqual(self.call("GET", f"/rooms/{room}/status", token=remote["token"])[0], 403)
        _, remote2 = self.pair()[0], None
        self.assertEqual(self.call("DELETE", f"/rooms/{room}", token=viewer["token"])[0], 204)
        self.assertEqual(self.call("GET", f"/rooms/{room}/status", token=viewer["token"])[0], 404)

    def test_roles_are_enforced(self):
        viewer, remote = self.pair()
        room = viewer["room"]
        # a remote cannot read the viewer's command queue, a viewer cannot send commands
        self.assertEqual(self.call("GET", f"/rooms/{room}/commands", token=remote["token"])[0], 403)
        self.assertEqual(self.call("POST", f"/rooms/{room}/commands", {"type": "play"}, token=viewer["token"])[0], 403)
        self.assertEqual(self.call("POST", f"/rooms/{room}/status", {"status": {}}, token=remote["token"])[0], 403)
        # another room's token is rejected
        other, _ = self.pair()
        self.assertEqual(self.call("POST", f"/rooms/{room}/commands", {"type": "play"}, token=_["token"])[0], 403)
        # no token / malformed token
        self.assertEqual(self.call("POST", f"/rooms/{room}/commands", {"type": "play"})[0], 401)
        self.assertEqual(self.call("POST", f"/rooms/{room}/commands", {"type": "play"}, token="bad token!")[0], 401)

    def test_bad_codes(self):
        for code in ["", "abc", "ABCDEFG", "ABC-10O", 123456, None]:
            s, d, _ = self.call("POST", "/rooms/join", {"code": code})
            self.assertEqual(s, 422, code)
            self.assertEqual(d["error"]["field"], "code")
        s, d, _ = self.call("POST", "/rooms/join", {"code": "ZZZ-ZZZ"})
        self.assertEqual(s, 404)

    def test_invalid_commands(self):
        viewer, remote = self.pair()
        room = viewer["room"]
        bad = [
            {}, {"type": "explode"}, {"type": "seat", "cam": "roof"}, {"type": "seat"},
            {"type": "seek", "t": -1}, {"type": "seek", "t": 151}, {"type": "seek", "t": "10"},
            {"type": "guided", "on": "yes"}, {"type": "setting", "key": "volume", "value": 1},
            {"type": "setting", "key": "vocal", "value": 13}, {"type": "setting", "key": "vocal", "value": 2.5},
            {"type": "setting", "key": "capsize", "value": "huge"}, {"type": "skip", "by": 1e9},
        ]
        for c in bad:
            s, d, _ = self.call("POST", f"/rooms/{room}/commands", c, token=remote["token"])
            self.assertEqual(s, 422, (c, d))
            self.assertIn("message", d["error"])

    def test_invalid_status(self):
        viewer, _ = self.pair()
        room = viewer["room"]
        for st in [None, [], {"cam": "x", "guided": True, "playing": True, "t": 1},
                   {"cam": "mid", "guided": 1, "playing": True, "t": 1},
                   {"cam": "mid", "guided": True, "playing": True, "t": 999}]:
            s, d, _ = self.call("POST", f"/rooms/{room}/status", {"status": st}, token=viewer["token"])
            self.assertEqual(s, 422, st)

    def test_request_hardening(self):
        viewer, remote = self.pair()
        room = viewer["room"]
        url = f"/rooms/{room}/commands"
        self.assertEqual(self.call("POST", url, raw=b"{bad", token=remote["token"])[0], 400)
        self.assertEqual(self.call("POST", url, raw=b"[1,2]", token=remote["token"])[0], 400)
        self.assertEqual(self.call("POST", url, raw=b"type=play", ctype="application/x-www-form-urlencoded",
                                   token=remote["token"])[0], 415)
        self.assertEqual(self.call("POST", url, raw=b'{"type":"play","x":"' + b"a" * 70000 + b'"}',
                                   token=remote["token"])[0], 413)
        s, d, _ = self.call("GET", url, token=viewer["token"], query="&after=abc")
        self.assertEqual(s, 400)

    def test_tokens_hashed_at_rest(self):
        import sqlite3
        viewer, remote = self.pair()
        db = sqlite3.connect(Path(self.tmp.name) / "es.sqlite")
        hashes = {r[0] for r in db.execute("SELECT hash FROM tokens")}
        db.close()
        self.assertNotIn(viewer["token"], hashes)
        self.assertNotIn(remote["token"], hashes)

    # --------------------------------------------------------------- director
    def test_director_flow(self):
        s, d, _ = self.call("POST", "/shows", {"key": "wrong"})
        self.assertEqual((s, d["error"]["code"]), (403, "wrong_key"))
        s, show, _ = self.call("POST", "/shows", {"key": KEY, "title": "  Opening   Night "})
        self.assertEqual(s, 201)
        self.assertEqual(show["title"], "Opening Night")
        code, tok = show["display_code"], show["token"]

        s, d, _ = self.call("GET", f"/shows/{code}", query="&viewer=viewer-abc-123")
        self.assertEqual((s, d["live"], d["cue"], d["viewers"]), (200, False, None, 1))
        v0 = d["version"]

        s, d, _ = self.call("POST", f"/shows/{code}/cue", {"cam": "stage", "subject": "guitar"}, token=tok)
        self.assertEqual(s, 200)
        s, d, _ = self.call("GET", f"/shows/{code}")
        self.assertTrue(d["live"])
        self.assertEqual((d["cue"]["cam"], d["cue"]["subject"]), ("stage", "guitar"))
        self.assertGreater(d["version"], v0)

        self.assertEqual(self.call("POST", f"/shows/{code}/cue", {"cam": "roof"}, token=tok)[0], 422)
        self.assertEqual(self.call("POST", f"/shows/{code}/cue", {"cam": "mid", "subject": "audience"}, token=tok)[0], 422)
        self.assertEqual(self.call("POST", f"/shows/{code}/cue", {"cam": "mid"})[0], 401)
        # a viewer's room token can't direct
        viewer, _ = self.pair()
        self.assertEqual(self.call("POST", f"/shows/{code}/cue", {"cam": "mid"}, token=viewer["token"])[0], 403)

        s, d, _ = self.call("POST", f"/shows/{code}/live", {"live": False}, token=tok)
        self.assertEqual((s, d["live"]), (200, False))
        # take over from another device with the key
        s, d2, _ = self.call("POST", f"/shows/{code}/director", {"key": KEY})
        self.assertEqual(s, 201)
        self.assertEqual(self.call("POST", f"/shows/{code}/cue", {"cam": "foh"}, token=d2["token"])[0], 200)
        # end
        self.assertEqual(self.call("DELETE", f"/shows/{code}", token=tok)[0], 204)
        s, d, _ = self.call("GET", f"/shows/{code}")
        self.assertEqual((d["live"], d["ended"]), (False, True))
        self.assertEqual(self.call("POST", f"/shows/{code}/cue", {"cam": "mid"}, token=tok)[0], 409)

    def test_feeds_report(self):
        _, show, _ = self.call("POST", "/shows", {"key": KEY, "title": "Feeds"})
        code, tok = show["code"], show["token"]
        viewer, _ = self.pair()
        self.assertEqual(self.call("POST", f"/shows/{code}/feeds", {"feeds": {}}, token=viewer["token"])[0], 403)
        self.assertEqual(self.call("POST", f"/shows/{code}/feeds", {"feeds": {}})[0], 401)
        for bad in [{}, {"feeds": {"roof": {"device": "x", "status": "ok"}}},
                    {"feeds": {"front": {"device": "", "status": "ok"}}},
                    {"feeds": {"front": {"device": "x", "status": "great"}}},
                    {"feeds": {"front": {"device": "x" * 61, "status": "ok"}}},
                    {"feeds": {"front": {"device": "x", "status": "ok", "fps": -1}}}]:
            s, d, _ = self.call("POST", f"/shows/{code}/feeds", bad, token=tok)
            self.assertEqual(s, 422, (bad, d))
        feeds = {"front": {"device": "Insta360 Titan", "status": "ok", "width": 7680, "height": 3840,
                           "fps": 29.97, "recording": True, "three_sixty": True, "future": 1},
                 "foh": {"device": "HDMI Capture 2", "status": "no_signal"}}
        self.assertEqual(self.call("POST", f"/shows/{code}/feeds", {"feeds": feeds}, token=tok)[0], 204)
        _, d, _ = self.call("GET", f"/shows/{code}")
        self.assertEqual(d["feeds"]["front"]["device"], "Insta360 Titan")
        self.assertEqual(d["feeds"]["front"]["fps"], 30.0)
        self.assertNotIn("future", d["feeds"]["front"])
        self.assertLessEqual(d["feeds_age"], 2)
        self.assertEqual(self.call("POST", f"/shows/{code}/feeds", {"feeds": {}}, token=tok)[0], 204)
        _, d, _ = self.call("GET", f"/shows/{code}")
        self.assertEqual(d["feeds"], {})

    def test_automation_track(self):
        _, show, _ = self.call("POST", "/shows", {"key": KEY, "title": "Automation"})
        code, tok = show["code"], show["token"]
        s, d, _ = self.call("GET", f"/shows/{code}/automation")
        self.assertEqual((s, d["cues"], d["version"]), (200, [], 0))
        # only a director token may write
        self.assertEqual(self.call("PUT", f"/shows/{code}/automation", {"cues": []})[0], 401)
        viewer, _ = self.pair()
        self.assertEqual(self.call("PUT", f"/shows/{code}/automation", {"cues": []}, token=viewer["token"])[0], 403)
        # NB {"cues": {}} is indistinguishable from [] after PHP's decode, so it means "no cues".
        for bad in [{}, {"cues": [[]]}, {"cues": [{"t": -1, "cam": "mid"}]},
                    {"cues": [{"t": 999, "cam": "mid"}]}, {"cues": [{"t": 5, "cam": "roof"}]},
                    {"cues": [{"t": 5, "cam": "mid", "subject": "audience"}]},
                    {"cues": [{"t": 5, "cam": "mid"}] * 601}]:
            s, d, _ = self.call("PUT", f"/shows/{code}/automation", bad, token=tok)
            self.assertEqual(s, 422, (str(bad)[:60], d))
        cues = [{"t": 60.123, "cam": "balcony", "subject": "guitar"}, {"t": 0, "cam": "mid"},
                {"t": 30, "cam": "stage", "subject": "vocal", "extra": "x"}]
        s, d, _ = self.call("PUT", f"/shows/{code}/automation", {"cues": cues}, token=tok)
        self.assertEqual((s, d["version"], d["count"]), (200, 1, 3))
        _, d, _ = self.call("GET", f"/shows/{code}/automation")
        self.assertEqual([c["t"] for c in d["cues"]], [0, 30, 60.12])      # sorted, rounded
        self.assertEqual(d["cues"][0], {"t": 0, "cam": "mid", "subject": "wide"})
        self.assertNotIn("extra", d["cues"][1])
        _, d, _ = self.call("GET", f"/shows/{code}")
        self.assertEqual(d["automation_version"], 1)
        s, d, _ = self.call("PUT", f"/shows/{code}/automation", {"cues": []}, token=tok)
        self.assertEqual(d["version"], 2)

    def test_channel_map(self):
        _, show, _ = self.call("POST", "/shows", {"key": KEY, "title": "Channels"})
        code, tok = show["code"], show["token"]
        s, d, _ = self.call("GET", f"/shows/{code}/channels")
        self.assertEqual((s, d["channels"], d["version"]), (200, {}, 0))
        for bad in [{}, {"channels": {"roof": {"src": "x.mp4"}}},
                    {"channels": {"front": {}}},
                    {"channels": {"front": {"src": "/etc/passwd"}}},
                    {"channels": {"front": {"src": "../secret.mp4"}}},
                    {"channels": {"front": {"src": "media/a.mp4", "offset": 9999}}},
                    {"channels": {"front": {"src": "media/a.mp4", "sync": "psychic"}}},
                    {"channels": {"front": {"src": "ftp://x/a.mp4"}}}]:
            s, d, _ = self.call("PUT", f"/shows/{code}/channels", bad, token=tok)
            self.assertEqual(s, 422, (bad, d))
        channels = {"front": {"src": "media/front.mp4", "offset": 1.2345, "sync": "audio"},
                    "balcony": {"src": "https://cdn.example.com/balc.mp4", "offset": -0.5}}
        s, d, _ = self.call("PUT", f"/shows/{code}/channels", {"channels": channels}, token=tok)
        self.assertEqual((s, d["version"], d["count"]), (200, 1, 2))
        _, d, _ = self.call("GET", f"/shows/{code}/channels")
        self.assertEqual(d["channels"]["front"]["offset"], 1.235)  # PHP rounds half-up
        self.assertEqual(d["channels"]["balcony"]["src"], "https://cdn.example.com/balc.mp4")
        _, d, _ = self.call("GET", f"/shows/{code}")
        self.assertEqual(d["channels_version"], 1)

    def test_show_lookup_errors(self):
        self.assertEqual(self.call("GET", "/shows/ZZZ-ZZZ")[0], 404)
        self.assertEqual(self.call("GET", "/shows/bad")[0], 422)
        self.assertEqual(self.call("GET", "/shows/ZZZ-ZZZ", query="&viewer=<x>")[0], 404)


@unittest.skipUnless(shutil.which("php"), "php not installed")
class EverySeatRateLimit(unittest.TestCase):
    def test_join_is_rate_limited(self):
        with tempfile.TemporaryDirectory() as tmp:
            port = free_port()
            env = dict(os.environ, ES_DB_PATH=str(Path(tmp) / "es.sqlite"))
            proc = subprocess.Popen(["php", "-S", f"127.0.0.1:{port}", "-t", str(STAGE)], env=env,
                                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            try:
                time.sleep(0.5)
                codes = []
                for _ in range(12):
                    req = urllib.request.Request(f"http://127.0.0.1:{port}/api/?r=/rooms/join",
                                                 data=b'{"code":"ZZZ-ZZZ"}', method="POST",
                                                 headers={"Content-Type": "application/json"})
                    try:
                        urllib.request.urlopen(req, timeout=5)
                    except urllib.error.HTTPError as e:
                        codes.append(e.code)
                        if e.code == 429:
                            self.assertTrue(e.headers["Retry-After"])
                self.assertIn(429, codes)  # 10 guesses per minute per IP
            finally:
                proc.terminate()
                proc.wait(5)


if __name__ == "__main__":
    unittest.main()
