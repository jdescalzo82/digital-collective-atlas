"""In-memory token-bucket rate limiter keyed by (bucket name, client id)."""

import threading
import time


class RateLimiter:
    def __init__(self, clock=time.monotonic, max_keys=50_000):
        self.clock = clock
        self.max_keys = max_keys
        self._buckets = {}
        self._lock = threading.Lock()

    def allow(self, key, rate_per_min, burst):
        """Take one token. Returns (allowed, retry_after_seconds)."""
        now = self.clock()
        rate = rate_per_min / 60.0
        with self._lock:
            tokens, last = self._buckets.get(key, (float(burst), now))
            tokens = min(float(burst), tokens + (now - last) * rate)
            if tokens >= 1:
                self._buckets[key] = (tokens - 1, now)
                allowed, retry = True, 0
            else:
                self._buckets[key] = (tokens, now)
                allowed, retry = False, max(1, int((1 - tokens) / rate + 0.999))
            if len(self._buckets) > self.max_keys:
                self._prune(now)
            return allowed, retry

    def _prune(self, now):
        # Drop buckets idle for 10+ minutes; they would be full again anyway.
        stale = [k for k, (_, last) in self._buckets.items() if now - last > 600]
        for k in stale:
            del self._buckets[k]
        if len(self._buckets) > self.max_keys:
            self._buckets.clear()
