"""Runtime configuration, read from environment variables.

Every setting has a safe default so `python3 -m server` works with no setup.
"""

import os
from dataclasses import dataclass
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def _env(name, default):
    value = os.environ.get(name)
    return default if value is None or value.strip() == "" else value.strip()


def _env_int(name, default, minimum=None, maximum=None):
    raw = _env(name, None)
    if raw is None:
        return default
    try:
        value = int(raw)
    except ValueError:
        raise SystemExit(f"{name} must be an integer, got {raw!r}")
    if minimum is not None and value < minimum:
        raise SystemExit(f"{name} must be >= {minimum}, got {value}")
    if maximum is not None and value > maximum:
        raise SystemExit(f"{name} must be <= {maximum}, got {value}")
    return value


def _env_bool(name, default):
    raw = _env(name, None)
    if raw is None:
        return default
    return raw.lower() in ("1", "true", "yes", "on")


def _env_date(name, default):
    raw = _env(name, None)
    if raw is None:
        return default
    try:
        return date.fromisoformat(raw)
    except ValueError:
        raise SystemExit(f"{name} must be an ISO date (YYYY-MM-DD), got {raw!r}")


DEFAULT_ORIGINS = (
    "https://jdescalzo82.github.io",
    "http://localhost:8000",
    "http://127.0.0.1:8000",
)


@dataclass
class Config:
    host: str = "127.0.0.1"
    port: int = 8000
    static_dir: Path = ROOT / "docs"
    archive_root: Path = ROOT
    db_path: Path = ROOT / "data" / "atlas.db"
    # Browsers on these origins may call the API cross-site (e.g. the
    # GitHub Pages copy of the site talking to a hosted backend).
    allowed_origins: tuple = DEFAULT_ORIGINS
    # Only honour X-Forwarded-For when running behind a reverse proxy you
    # control; otherwise any client could spoof its rate-limit identity.
    trust_proxy: bool = False
    github_repo: str = "steviesonz/digital-collective-atlas"
    github_token: str = ""
    github_cache_seconds: int = 600
    github_timeout_seconds: float = 5.0
    # Story timeline: Day 44 is 2025-12-05, so Day 1 is 2025-10-23, and the
    # "11 days to closest approach" on Day 47 lands on 2025-12-19.
    day_one: date = date(2025, 10, 23)
    approach_date: date = date(2025, 12, 19)
    max_body_bytes: int = 4096
    # Token buckets per client IP: steady rate (per minute) and burst size.
    read_rate_per_min: int = 120
    read_burst: int = 60
    write_rate_per_min: int = 10
    write_burst: int = 5
    download_rate_per_min: int = 6
    download_burst: int = 3

    @classmethod
    def from_env(cls):
        origins = _env("DCA_ALLOWED_ORIGINS", None)
        return cls(
            host=_env("DCA_HOST", "127.0.0.1"),
            port=_env_int("DCA_PORT", _env_int("PORT", 8000, 1, 65535), 1, 65535),
            static_dir=Path(_env("DCA_STATIC_DIR", str(ROOT / "docs"))),
            archive_root=Path(_env("DCA_ARCHIVE_ROOT", str(ROOT))),
            db_path=Path(_env("DCA_DB_PATH", str(ROOT / "data" / "atlas.db"))),
            allowed_origins=tuple(o.strip().rstrip("/") for o in origins.split(",") if o.strip())
            if origins else DEFAULT_ORIGINS,
            trust_proxy=_env_bool("DCA_TRUST_PROXY", False),
            github_repo=_env("DCA_GITHUB_REPO", "steviesonz/digital-collective-atlas"),
            github_token=_env("GITHUB_TOKEN", ""),
            github_cache_seconds=_env_int("DCA_GITHUB_CACHE_SECONDS", 600, 10),
            day_one=_env_date("DCA_DAY_ONE", date(2025, 10, 23)),
            approach_date=_env_date("DCA_APPROACH_DATE", date(2025, 12, 19)),
            read_rate_per_min=_env_int("DCA_READ_RATE", 120, 1),
            write_rate_per_min=_env_int("DCA_WRITE_RATE", 10, 1),
            download_rate_per_min=_env_int("DCA_DOWNLOAD_RATE", 6, 1),
        )
