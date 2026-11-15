# Backend // Digital Collective Atlas

A small, dependency-free Python server (standard library only, Python 3.10+)
that backs every interactive control on the site and also serves the static
pages in `docs/`.

```bash
python3 -m server                     # http://127.0.0.1:8000
python3 -m unittest discover tests    # 34 end-to-end tests
```

The site still works without it. On GitHub Pages (or any static host) the
frontend detects that no backend is reachable and falls back to local-only
behaviour.

## What each control does

| Control (page) | Endpoint | With backend | Without backend |
|---|---|---|---|
| **I ACCEPT THE RISK** (Terminal) | `POST /api/consent` | Records an anonymous consent and issues a visitor token | Remembered in `localStorage` only |
| **ENTER DESIGNATION** (Terminal) | `POST /api/bridges` | Validated, normalised, stored, and returns a private bridge token | Validated in the browser and stored locally |
| **[CHANGE DESIGNATION]** (Terminal) | `POST /api/bridges` + `Authorization: Bearer` | Renames the same bridge | Local rename |
| **[FORGET ME]** (Terminal) | `DELETE /api/bridges/me` | Deletes the server record | Clears local data |
| Returning visitor (Terminal) | `GET /api/bridges/me` | Re-registers if the server lost the record | n/a |
| **ACTIVE BRIDGES** (Terminal) | `GET /api/stats` | Fork count cached server-side (10 min) and kept when GitHub is down | Browser asks GitHub directly |
| **DAYS TO CLOSEST APPROACH** (Terminal) | `GET /api/stats` | Computed from `DCA_APPROACH_DATE` | Computed in the browser |
| **DOWNLOAD MIRROR** (Download) | `GET /api/download` | ZIP built from the server's copy of the repo | Card hidden; GitHub ZIP still offered |
| Health check | `GET /api/health` | `200` ok, `503` if the database is broken | n/a |

## Robustness

- **Validation.** Designations are NFKC-normalised, whitespace-collapsed, 1–32
  characters, and limited to letters/numbers/marks plus space and `- _ . '`.
  Control characters, bidi overrides and zero-width tricks are rejected. Tokens
  must match a strict format.
- **Request hardening.** JSON-only bodies (`415` otherwise), 4 KB body limit
  (`413`), no chunked uploads, malformed JSON gets `400`, and unknown routes or
  methods get `404`/`405` with `Allow`. Errors are always JSON
  `{"error": {"code", "message", "field"?}}` and never contain tracebacks.
- **Rate limits.** Per-IP token buckets for reads, writes and downloads, returning
  `429` with `Retry-After`. Rejected request bodies are drained so kept-alive
  connections stay in sync.
- **Privacy.** No IPs or user agents are stored. Tokens are stored only as
  SHA-256 hashes. Designations are never exposed publicly; only counts are.
- **Static hosting.** Path-traversal and dotfile protection, ETag/304 support,
  `no-cache` for HTML, a 15 s socket timeout against slow clients, and security
  headers on every response (strict CSP on API responses).
- **Resilience.** The GitHub fork count backs off for 60 s after a failure, serves
  the last good value (persisted in SQLite, so it survives restarts), and
  never blocks the page. SQLite runs in WAL mode behind a lock, and SIGTERM
  triggers a graceful shutdown.

## Configuration (environment variables)

| Variable | Default | Purpose |
|---|---|---|
| `DCA_HOST` / `DCA_PORT` (or `PORT`) | `127.0.0.1` / `8000` | Bind address. Use `0.0.0.0` in containers |
| `DCA_DB_PATH` | `data/atlas.db` | SQLite file (directory is created) |
| `DCA_STATIC_DIR` | `docs/` | Static site to serve |
| `DCA_ARCHIVE_ROOT` | repo root | What the download mirror zips |
| `DCA_ALLOWED_ORIGINS` | GitHub Pages + localhost | Comma-separated CORS origins |
| `DCA_TRUST_PROXY` | `false` | Use `X-Forwarded-For` (only behind your own proxy) |
| `DCA_GITHUB_REPO` | `steviesonz/digital-collective-atlas` | Repo whose forks are counted |
| `GITHUB_TOKEN` | none | Optional; raises GitHub's rate limit |
| `DCA_GITHUB_CACHE_SECONDS` | `600` | Fork-count cache lifetime |
| `DCA_DAY_ONE` / `DCA_APPROACH_DATE` | `2025-10-23` / `2025-12-19` | Mission timeline |
| `DCA_READ_RATE` / `DCA_WRITE_RATE` / `DCA_DOWNLOAD_RATE` | `120` / `10` / `6` | Requests per minute per IP |

## Deploying

**Single host (simplest).** Run the server and let it serve both the site and
the API. The frontend uses the same origin automatically.

```bash
docker build -t atlas . && docker run -p 8000:8000 -v atlas-data:/app/data atlas
```

**GitHub Pages + hosted API.** Keep the site on Pages, deploy the server
anywhere (Render, Fly.io, a VPS), then set `window.DCA_API_BASE` in
`docs/api.js` to the server URL. Make sure `DCA_ALLOWED_ORIGINS` includes
`https://jdescalzo82.github.io`.
