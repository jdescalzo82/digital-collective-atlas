"""HTTP server: JSON API for the site's controls plus static hosting of docs/.

API (all responses are JSON unless noted):

  GET    /api/health        liveness + database check
  GET    /api/stats         fork count, bridge/consent totals, countdown, mission day
  POST   /api/consent       "I ACCEPT THE RISK"  body: {"token"?: str}
  POST   /api/bridges       "ENTER DESIGNATION"  body: {"name": str, "visitor_token"?: str}
                            send "Authorization: Bearer <bridge token>" to rename
  GET    /api/bridges/me    current bridge       needs Authorization header
  DELETE /api/bridges/me    forget designation   needs Authorization header
  GET    /api/download      offline backup ZIP (application/zip)

Anything outside /api/ is served from the static directory.
"""

import email.utils
import hashlib
import json
import logging
import mimetypes
import posixpath
import time
import traceback
import urllib.parse
from datetime import date, datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from .archive import ArchiveBuilder
from .config import Config
from .github import ForkCounter
from .ratelimit import RateLimiter
from .store import Store
from .validation import ValidationError, bearer_token, clean_name, clean_token

log = logging.getLogger("dca")

SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Frame-Options": "SAMEORIGIN",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
}


class ApiError(Exception):
    def __init__(self, status, code, message, field=None, headers=None):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message
        self.field = field
        self.headers = headers or {}


class App:
    """Holds shared state; one instance per server."""

    def __init__(self, config, store=None, forks=None, archive=None, limiter=None, today=None):
        self.config = config
        self.store = store or Store(config.db_path)
        self.forks = forks or ForkCounter(
            self.store, config.github_repo, config.github_token,
            ttl=config.github_cache_seconds, timeout=config.github_timeout_seconds,
        )
        self.archive = archive or ArchiveBuilder(config.archive_root)
        self.limiter = limiter or RateLimiter()
        self.today = today or (lambda: datetime.now(timezone.utc).date())
        self.static_root = Path(config.static_dir).resolve()
        self.started = time.time()

    def countdown(self):
        today = self.today()
        remaining = (self.config.approach_date - today).days
        return {
            "target": self.config.approach_date.isoformat(),
            "days_remaining": max(remaining, 0),
            "passed": remaining < 0,
            "days_since": max(-remaining, 0),
        }

    def mission_day(self):
        return (self.today() - self.config.day_one).days + 1


class Handler(BaseHTTPRequestHandler):
    server_version = "DCA"
    sys_version = ""
    protocol_version = "HTTP/1.1"
    timeout = 15  # seconds; stops idle/slow clients from pinning threads
    app: App = None  # set by make_server

    # --- plumbing -----------------------------------------------------------

    def log_message(self, fmt, *args):
        log.info("%s %s", self.client_id(), fmt % args)

    def client_id(self):
        if self.app.config.trust_proxy:
            fwd = self.headers.get("X-Forwarded-For", "")
            if fwd:
                return fwd.split(",")[0].strip()[:64]
        return self.client_address[0]

    def cors_headers(self):
        origin = (self.headers.get("Origin") or "").rstrip("/")
        if origin and origin in self.app.config.allowed_origins:
            return {
                "Access-Control-Allow-Origin": origin,
                "Vary": "Origin",
                "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
                "Access-Control-Allow-Headers": "Content-Type, Authorization",
                "Access-Control-Max-Age": "600",
            }
        return {"Vary": "Origin"}

    def send(self, status, body=b"", content_type="application/json; charset=utf-8",
             headers=None, head_only=False):
        self.send_response(status)
        merged = {**SECURITY_HEADERS, **(headers or {})}
        for k, v in merged.items():
            self.send_header(k, v)
        if content_type:
            self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if body and not head_only and self.command != "HEAD":
            self.wfile.write(body)

    def send_json(self, status, payload, headers=None):
        body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        self.send(status, body, headers={
            "Cache-Control": "no-store",
            "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
            **self.cors_headers(),
            **(headers or {}),
        })

    def send_error_json(self, err):
        payload = {"error": {"code": err.code, "message": err.message}}
        if err.field:
            payload["error"]["field"] = err.field
        self.send_json(err.status, payload, err.headers)

    def rate_limit(self, bucket):
        cfg = self.app.config
        rate, burst = {
            "read": (cfg.read_rate_per_min, cfg.read_burst),
            "write": (cfg.write_rate_per_min, cfg.write_burst),
            "download": (cfg.download_rate_per_min, cfg.download_burst),
        }[bucket]
        ok, retry = self.app.limiter.allow((bucket, self.client_id()), rate, burst)
        if not ok:
            raise ApiError(429, "rate_limited", "Too many requests. Slow down.",
                           headers={"Retry-After": str(retry)})

    def read_json(self):
        ctype = (self.headers.get("Content-Type") or "").split(";")[0].strip().lower()
        if ctype != "application/json":
            raise ApiError(415, "unsupported_media_type", "Send Content-Type: application/json.")
        if self.headers.get("Transfer-Encoding"):
            raise ApiError(411, "length_required", "Chunked bodies are not accepted.")
        try:
            length = int(self.headers.get("Content-Length", ""))
        except ValueError:
            raise ApiError(411, "length_required", "Content-Length header is required.")
        if length < 0:
            raise ApiError(400, "bad_request", "Invalid Content-Length.")
        if length > self.app.config.max_body_bytes:
            self.close_connection = True
            raise ApiError(413, "payload_too_large", "Request body is too large.")
        raw = self.rfile.read(length) if length else b""
        self._body_consumed = True
        if not raw.strip():
            return {}
        try:
            data = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            raise ApiError(400, "invalid_json", "Request body is not valid JSON.")
        if not isinstance(data, dict):
            raise ApiError(400, "invalid_json", "Request body must be a JSON object.")
        return data

    def discard_body(self):
        """Drain an unread body so a kept-alive connection stays in sync."""
        if getattr(self, "_body_consumed", False):
            return
        self._body_consumed = True
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = 0
        if 0 < length <= self.app.config.max_body_bytes:
            self.rfile.read(length)
        elif length:
            self.close_connection = True

    # --- dispatch -----------------------------------------------------------

    ROUTES = {
        "/api/health": {"GET": "api_health"},
        "/api/stats": {"GET": "api_stats"},
        "/api/consent": {"POST": "api_consent"},
        "/api/bridges": {"POST": "api_register"},
        "/api/bridges/me": {"GET": "api_me", "DELETE": "api_forget"},
        "/api/download": {"GET": "api_download"},
    }

    def handle_any(self):
        path = urllib.parse.urlsplit(self.path).path
        self._body_consumed = False
        try:
            if path == "/api" or path.startswith("/api/"):
                self.dispatch_api(path.rstrip("/") or "/api")
            elif self.command in ("GET", "HEAD"):
                self.discard_body()
                self.serve_static(path)
            else:
                self.discard_body()
                raise ApiError(405, "method_not_allowed", "Method not allowed.",
                               headers={"Allow": "GET, HEAD"})
        except ApiError as err:
            self.discard_body()  # e.g. rejected by the rate limit before reading
            self.send_error_json(err)
        except (BrokenPipeError, ConnectionResetError):
            self.close_connection = True
        except Exception:  # never leak a traceback to the client
            log.error("Unhandled error on %s %s\n%s", self.command, path, traceback.format_exc())
            self.close_connection = True
            try:
                self.send_error_json(ApiError(500, "internal_error", "Something went wrong."))
            except OSError:
                pass

    def dispatch_api(self, path):
        methods = self.ROUTES.get(path)
        if self.command == "OPTIONS":
            self.discard_body()
            allow = ", ".join(sorted(set(methods or {}) | {"OPTIONS"}))
            self.send(204, b"", content_type=None,
                      headers={**self.cors_headers(), "Allow": allow})
            return
        if methods is None:
            self.discard_body()
            raise ApiError(404, "not_found", "No such endpoint.")
        name = methods.get("GET" if self.command == "HEAD" else self.command)
        if name is None:
            self.discard_body()
            raise ApiError(405, "method_not_allowed", "Method not allowed.",
                           headers={"Allow": ", ".join(sorted(methods))})
        getattr(self, name)()

    do_GET = do_HEAD = do_POST = do_PUT = do_PATCH = do_DELETE = do_OPTIONS = handle_any

    # --- API endpoints ------------------------------------------------------

    def api_health(self):
        try:
            self.app.store.ping()
            db = "ok"
        except Exception:
            db = "error"
        status = 200 if db == "ok" else 503
        self.send_json(status, {
            "status": "ok" if db == "ok" else "degraded",
            "database": db,
            "uptime_seconds": int(time.time() - self.app.started),
        })

    def api_stats(self):
        self.rate_limit("read")
        counts = self.app.store.counts()
        self.send_json(200, {
            "forks": self.app.forks.get(),
            "bridges": counts["bridges"],
            "consents": counts["consents"],
            "countdown": self.app.countdown(),
            "mission_day": self.app.mission_day(),
        })

    def _field(self, fn, *args):
        try:
            return fn(*args)
        except ValidationError as e:
            raise ApiError(422 if e.field == "name" else 400,
                           "invalid_" + e.field, e.message, field=e.field)

    def _auth(self, required=True):
        token = self._field(bearer_token, self.headers.get("Authorization"))
        if required and not token:
            raise ApiError(401, "unauthorized", "Bridge token required.",
                           headers={"WWW-Authenticate": "Bearer"})
        return token

    def api_consent(self):
        self.rate_limit("write")
        data = self.read_json()
        if data.get("accepted", True) is not True:
            raise ApiError(400, "invalid_accepted", "Consent must be accepted.", field="accepted")
        token = self._field(clean_token, data.get("token"), "token")
        token, accepted_at, created = self.app.store.record_consent(token)
        self.send_json(201 if created else 200, {"token": token, "accepted_at": accepted_at})

    def api_register(self):
        self.rate_limit("write")
        bridge_token = self._auth(required=False)
        data = self.read_json()
        name = self._field(clean_name, data.get("name"))
        visitor = self._field(clean_token, data.get("visitor_token"), "visitor_token")
        token, bridge, created = self.app.store.register_bridge(name, bridge_token, visitor)
        self.send_json(201 if created else 200, {"token": token, "bridge": bridge})

    def api_me(self):
        self.rate_limit("read")
        bridge = self.app.store.get_bridge(self._auth())
        if not bridge:
            raise ApiError(404, "not_found", "Unknown bridge token.")
        self.send_json(200, {"bridge": bridge})

    def api_forget(self):
        self.rate_limit("write")
        self.discard_body()
        if not self.app.store.delete_bridge(self._auth()):
            raise ApiError(404, "not_found", "Unknown bridge token.")
        self.send(204, b"", content_type=None, headers=self.cors_headers())

    def api_download(self):
        self.rate_limit("download")
        data = self.app.archive.build()
        stamp = date.today().isoformat()
        self.send(200, data, content_type="application/zip", headers={
            "Content-Disposition":
                f'attachment; filename="digital-collective-atlas-{stamp}.zip"',
            "Cache-Control": "no-cache",
            **self.cors_headers(),
        })

    # --- static files -------------------------------------------------------

    def serve_static(self, url_path):
        self.rate_limit("read")
        rel = urllib.parse.unquote(url_path)
        if "\x00" in rel or "\\" in rel:
            raise ApiError(400, "bad_request", "Bad path.")
        rel = posixpath.normpath("/" + rel).lstrip("/")
        parts = rel.split("/") if rel else []
        if any(p.startswith(".") for p in parts):  # hide dotfiles like .gitkeep
            return self.not_found()
        target = (self.app.static_root / rel).resolve()
        if target != self.app.static_root and self.app.static_root not in target.parents:
            return self.not_found()
        if target.is_dir():
            if url_path and not url_path.endswith("/"):
                location = url_path + "/"
                return self.send(301, b"", content_type=None, headers={"Location": location})
            target = target / "index.html"
        if not target.is_file():
            return self.not_found()

        st = target.stat()
        etag = '"' + hashlib.sha1(f"{st.st_mtime_ns}-{st.st_size}".encode()).hexdigest()[:16] + '"'
        last_mod = email.utils.formatdate(st.st_mtime, usegmt=True)
        ctype = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype in ("application/javascript", "application/xml"):
            ctype += "; charset=utf-8"
        cache = "no-cache" if target.suffix == ".html" else "public, max-age=3600"
        headers = {"ETag": etag, "Last-Modified": last_mod, "Cache-Control": cache}
        if self.headers.get("If-None-Match") == etag:
            return self.send(304, b"", content_type=None, headers=headers)
        self.send(200, target.read_bytes(), content_type=ctype, headers=headers)

    def not_found(self):
        page = self.app.static_root / "404.html"
        body = page.read_bytes() if page.is_file() else (
            b"<!DOCTYPE html><title>404</title><p>SIGNAL LOST. <a href='/'>Return to terminal</a></p>")
        self.send(404, body, content_type="text/html; charset=utf-8",
                  headers={"Cache-Control": "no-cache"})


class Server(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True
    request_queue_size = 64


def make_server(config=None, app=None):
    config = config or Config.from_env()
    app = app or App(config)
    handler = type("BoundHandler", (Handler,), {"app": app})
    return Server((config.host, config.port), handler), app


mimetypes.add_type("application/javascript", ".js")
mimetypes.add_type("text/css", ".css")
mimetypes.add_type("application/xml", ".xml")
