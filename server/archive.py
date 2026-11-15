"""Offline backup ZIP built from the server's own copy of the repository.

The DOWNLOAD page promises a backup "if GitHub goes down"; this mirror keeps
that promise by not depending on GitHub at all.
"""

import io
import threading
import zipfile
from pathlib import Path

INCLUDE_SUFFIXES = {".md", ".html", ".css", ".js", ".txt", ".xml", ".py"}
EXCLUDE_DIRS = {".git", "data", "__pycache__", "node_modules", ".venv", "venv"}
MAX_FILE_BYTES = 5 * 1024 * 1024


class ArchiveBuilder:
    def __init__(self, root, prefix="digital-collective-atlas"):
        self.root = Path(root).resolve()
        self.prefix = prefix
        self._lock = threading.Lock()
        self._cache = None  # (signature, bytes)

    def _files(self):
        for path in sorted(self.root.rglob("*")):
            rel = path.relative_to(self.root)
            if any(part in EXCLUDE_DIRS or part.startswith(".") for part in rel.parts[:-1]):
                continue
            if rel.name.startswith(".") or path.is_symlink() or not path.is_file():
                continue
            if path.suffix.lower() not in INCLUDE_SUFFIXES:
                continue
            if path.stat().st_size > MAX_FILE_BYTES:
                continue
            yield path, rel

    def build(self):
        """Return the ZIP bytes, rebuilding only when files have changed."""
        files = list(self._files())
        signature = tuple((str(rel), p.stat().st_mtime_ns, p.stat().st_size) for p, rel in files)
        with self._lock:
            if self._cache and self._cache[0] == signature:
                return self._cache[1]
            buf = io.BytesIO()
            with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
                for path, rel in files:
                    zf.write(path, f"{self.prefix}/{rel.as_posix()}")
            data = buf.getvalue()
            self._cache = (signature, data)
            return data
