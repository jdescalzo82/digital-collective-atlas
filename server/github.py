"""Fork count from the GitHub API, cached so visitors never hit its rate limit.

Unauthenticated GitHub API calls are limited to 60 per hour per IP, which is
why the browser-side fetch used to show "0" or "ERR". The server asks at most
once per cache window, keeps the last good value in SQLite so it survives
restarts, and serves that stale value whenever GitHub is down or limiting.
"""

import json
import threading
import time
import urllib.error
import urllib.request

CACHE_KEY = "github_forks"


def fetch_forks(repo, token="", timeout=5.0):
    req = urllib.request.Request(
        f"https://api.github.com/repos/{repo}",
        headers={
            "Accept": "application/vnd.github+json",
            "User-Agent": "digital-collective-atlas-server",
            **({"Authorization": f"Bearer {token}"} if token else {}),
        },
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        data = json.loads(resp.read(1_000_000).decode("utf-8"))
    forks = data.get("forks_count")
    if not isinstance(forks, int) or forks < 0:
        raise ValueError("GitHub response has no forks_count")
    return forks


class ForkCounter:
    def __init__(self, store, repo, token="", ttl=600, timeout=5.0, fetcher=None,
                 clock=time.monotonic):
        self.store = store
        self.repo = repo
        self.ttl = ttl
        self.fetcher = fetcher or (lambda: fetch_forks(repo, token, timeout))
        self.clock = clock
        self._lock = threading.Lock()
        self._value = None
        self._fetched_at = None   # monotonic time of last successful fetch
        self._failed_at = None    # monotonic time of last failed fetch
        self._as_of = None        # ISO timestamp of the cached value
        value, as_of = store.kv_get(CACHE_KEY)
        if value is not None and value.isdigit():
            self._value, self._as_of = int(value), as_of

    def get(self):
        """Return {"count", "source", "as_of"}; never raises."""
        with self._lock:
            now = self.clock()
            fresh = self._fetched_at is not None and now - self._fetched_at < self.ttl
            # After a failure, back off for a minute rather than retrying per request.
            backing_off = self._failed_at is not None and now - self._failed_at < 60
            if not fresh and not backing_off:
                try:
                    self._value = self.fetcher()
                    self._fetched_at = now
                    self._failed_at = None
                    self.store.kv_set(CACHE_KEY, self._value)
                    self._as_of = self.store.kv_get(CACHE_KEY)[1]
                    fresh = True
                except (urllib.error.URLError, OSError, ValueError, json.JSONDecodeError):
                    self._failed_at = now
            if self._value is None:
                return {"count": None, "source": "unavailable", "as_of": None}
            return {"count": self._value, "source": "github" if fresh else "cache",
                    "as_of": self._as_of}
