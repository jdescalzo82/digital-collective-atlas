#!/usr/bin/env python3
"""
Portable server for the Survival Library - for laptops, old Android phones (Termux) or any
machine with Python 3. No installs needed. Supports HTTP Range requests (needed for PMTiles maps)
and redirects phone "captive portal" checks to the library.

  python3 device/serve.py                 # http://<this-machine>:8080/
  sudo python3 device/serve.py --port 80  # port 80 so people can just type the IP
  python3 device/serve.py --cert cert.pem --key key.pem --port 8443   # https (enables phone compass/GPS)

On a Raspberry Pi hotspot use setup-pi.sh instead (nginx, auto-start, captive DNS).
"""
import argparse, os, re, socket, ssl, sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

WEB = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "web")
PROBES = {"/generate_204", "/gen_204", "/hotspot-detect.html", "/library/test/success.html",
          "/ncsi.txt", "/connecttest.txt", "/redirect", "/canonical.html", "/success.txt",
          "/chat", "/kindle-wifi/wifistub.html"}


class Handler(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map,
                      ".stl": "model/stl", ".scad": "text/plain; charset=utf-8", ".md": "text/plain; charset=utf-8",
                      ".geojson": "application/geo+json", ".pmtiles": "application/octet-stream",
                      ".json": "application/json", ".js": "text/javascript", ".gpx": "application/gpx+xml"}

    def __init__(self, *a, **kw):
        super().__init__(*a, directory=WEB, **kw)

    def log_message(self, fmt, *args):
        if not self.server.quiet:
            sys.stderr.write("%s - %s\n" % (self.client_address[0], fmt % args))

    def end_headers(self):
        self.send_header("Accept-Ranges", "bytes")
        if self.path.endswith((".html", ".json", "/")):
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def _redirect_home(self):
        self.send_response(302)
        self.send_header("Location", "http://%s/" % self.server.public_host)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        host = (self.headers.get("Host") or "").split(":")[0]
        if path in PROBES or (host and host not in self.server.own_hosts and not os.path.exists(self.translate_path(path))):
            return self._redirect_home()
        rng = self.headers.get("Range")
        if rng and os.path.isfile(self.translate_path(path)):
            return self._send_range(self.translate_path(path), rng)
        return super().do_GET()

    def _send_range(self, fpath, rng):
        size = os.path.getsize(fpath)
        m = re.match(r"bytes=(\d*)-(\d*)$", rng.strip())
        if not m or (m.group(1) == "" and m.group(2) == ""):
            self.send_error(416); return
        if m.group(1) == "":
            start, end = max(0, size - int(m.group(2))), size - 1
        else:
            start = int(m.group(1)); end = int(m.group(2)) if m.group(2) else size - 1
        end = min(end, size - 1)
        if start > end:
            self.send_response(416); self.send_header("Content-Range", "bytes */%d" % size); self.end_headers(); return
        self.send_response(206)
        self.send_header("Content-Type", self.guess_type(fpath))
        self.send_header("Content-Range", "bytes %d-%d/%d" % (start, end, size))
        self.send_header("Content-Length", str(end - start + 1))
        self.end_headers()
        with open(fpath, "rb") as f:
            f.seek(start)
            left = end - start + 1
            while left > 0:
                chunk = f.read(min(65536, left))
                if not chunk:
                    break
                self.wfile.write(chunk)
                left -= len(chunk)


def local_ips():
    ips = {"127.0.0.1", "localhost"}
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("10.255.255.255", 1))
        ips.add(s.getsockname()[0])
        s.close()
    except OSError:
        pass
    try:
        ips.update(socket.gethostbyname_ex(socket.gethostname())[2])
    except OSError:
        pass
    return ips


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--port", type=int, default=8080)
    ap.add_argument("--bind", default="0.0.0.0")
    ap.add_argument("--host", help="address people use to reach this machine (default: auto-detected IP)")
    ap.add_argument("--cert"); ap.add_argument("--key")
    ap.add_argument("--quiet", action="store_true")
    a = ap.parse_args()
    if not os.path.exists(os.path.join(WEB, "content", "library.json")):
        sys.exit("web/content/library.json missing - run: python3 tools/build.py --no-render")
    srv = ThreadingHTTPServer((a.bind, a.port), Handler)
    ips = local_ips()
    pub = a.host or next((i for i in sorted(ips) if not i.startswith("127.") and i != "localhost"), "127.0.0.1")
    srv.public_host = pub + ("" if a.port in (80, 443) else ":%d" % a.port)
    srv.own_hosts = ips | {pub, "survival.lan", "library.lan", socket.gethostname(), socket.gethostname() + ".local"}
    srv.quiet = a.quiet
    scheme = "http"
    if a.cert:
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ctx.load_cert_chain(a.cert, a.key)
        srv.socket = ctx.wrap_socket(srv.socket, server_side=True)
        scheme = "https"
    print("Survival Library serving %s" % WEB)
    for ip in sorted(ips):
        if not ip.startswith("127.") and ip != "localhost":
            print("  open  %s://%s%s/" % (scheme, ip, "" if a.port in (80, 443) else ":%d" % a.port))
    print("Ctrl+C to stop.")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
