"""SQLite persistence for visitors (consent) and bridges (designations).

Only random tokens and the designation a visitor typed are stored; no IP
addresses or user agents. Tokens are kept as SHA-256 hashes so a leaked
database cannot be used to impersonate anyone.
"""

import hashlib
import secrets
import sqlite3
import threading
from datetime import datetime, timezone

SCHEMA = """
CREATE TABLE IF NOT EXISTS visitors (
    id          INTEGER PRIMARY KEY,
    token_hash  TEXT NOT NULL UNIQUE,
    accepted_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS bridges (
    id          INTEGER PRIMARY KEY,
    token_hash  TEXT NOT NULL UNIQUE,
    visitor_id  INTEGER REFERENCES visitors(id) ON DELETE SET NULL,
    name        TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS kv (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
"""


def _now():
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _hash(token):
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def new_token():
    return secrets.token_urlsafe(24)


class Store:
    def __init__(self, path):
        self.path = str(path)
        if self.path != ":memory:":
            from pathlib import Path
            Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._db = sqlite3.connect(self.path, check_same_thread=False, timeout=10)
        self._db.row_factory = sqlite3.Row
        with self._lock:
            if self.path != ":memory:":
                self._db.execute("PRAGMA journal_mode=WAL")
            self._db.execute("PRAGMA foreign_keys=ON")
            self._db.executescript(SCHEMA)
            self._db.commit()

    def close(self):
        with self._lock:
            self._db.close()

    def ping(self):
        with self._lock:
            self._db.execute("SELECT 1").fetchone()

    # --- visitors -----------------------------------------------------------

    def record_consent(self, existing_token=None):
        """Record that a visitor accepted the warning. Idempotent per token."""
        with self._lock:
            if existing_token:
                row = self._db.execute(
                    "SELECT id, accepted_at FROM visitors WHERE token_hash = ?",
                    (_hash(existing_token),),
                ).fetchone()
                if row:
                    return existing_token, row["accepted_at"], False
            token = new_token()
            accepted_at = _now()
            self._db.execute(
                "INSERT INTO visitors (token_hash, accepted_at) VALUES (?, ?)",
                (_hash(token), accepted_at),
            )
            self._db.commit()
            return token, accepted_at, True

    def _visitor_id(self, token):
        if not token:
            return None
        row = self._db.execute(
            "SELECT id FROM visitors WHERE token_hash = ?", (_hash(token),)
        ).fetchone()
        return row["id"] if row else None

    # --- bridges ------------------------------------------------------------

    def _bridge_row(self, token):
        return self._db.execute(
            "SELECT id, name, created_at, updated_at FROM bridges WHERE token_hash = ?",
            (_hash(token),),
        ).fetchone()

    @staticmethod
    def _bridge_dict(row):
        return {
            "number": row["id"],
            "name": row["name"],
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
        }

    def register_bridge(self, name, bridge_token=None, visitor_token=None):
        """Create a bridge, or rename it when a valid bridge token is given.

        Returns (token, bridge_dict, created).
        """
        with self._lock:
            now = _now()
            if bridge_token:
                row = self._bridge_row(bridge_token)
                if row:
                    self._db.execute(
                        "UPDATE bridges SET name = ?, updated_at = ? WHERE id = ?",
                        (name, now, row["id"]),
                    )
                    self._db.commit()
                    return bridge_token, self._bridge_dict(self._bridge_row(bridge_token)), False
            token = new_token()
            cur = self._db.execute(
                "INSERT INTO bridges (token_hash, visitor_id, name, created_at, updated_at)"
                " VALUES (?, ?, ?, ?, ?)",
                (_hash(token), self._visitor_id(visitor_token), name, now, now),
            )
            self._db.commit()
            row = self._db.execute(
                "SELECT id, name, created_at, updated_at FROM bridges WHERE id = ?",
                (cur.lastrowid,),
            ).fetchone()
            return token, self._bridge_dict(row), True

    def get_bridge(self, token):
        with self._lock:
            row = self._bridge_row(token)
            return self._bridge_dict(row) if row else None

    def delete_bridge(self, token):
        with self._lock:
            cur = self._db.execute("DELETE FROM bridges WHERE token_hash = ?", (_hash(token),))
            self._db.commit()
            return cur.rowcount > 0

    # --- counters & cache ---------------------------------------------------

    def counts(self):
        with self._lock:
            bridges = self._db.execute("SELECT COUNT(*) FROM bridges").fetchone()[0]
            visitors = self._db.execute("SELECT COUNT(*) FROM visitors").fetchone()[0]
            return {"bridges": bridges, "consents": visitors}

    def kv_get(self, key):
        with self._lock:
            row = self._db.execute(
                "SELECT value, updated_at FROM kv WHERE key = ?", (key,)
            ).fetchone()
            return (row["value"], row["updated_at"]) if row else (None, None)

    def kv_set(self, key, value):
        with self._lock:
            self._db.execute(
                "INSERT INTO kv (key, value, updated_at) VALUES (?, ?, ?)"
                " ON CONFLICT(key) DO UPDATE SET value = excluded.value,"
                " updated_at = excluded.updated_at",
                (key, str(value), _now()),
            )
            self._db.commit()
