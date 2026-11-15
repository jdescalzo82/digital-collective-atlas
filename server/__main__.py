"""Run the backend:  python3 -m server   (see server/README.md for settings)."""

import logging
import signal
import sys
import threading

from .app import make_server


def main():
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    httpd, app = make_server()
    host, port = httpd.server_address[:2]
    logging.info("Digital Collective Atlas backend on http://%s:%s (static: %s)",
                 host, port, app.static_root)

    def shutdown(*_):
        logging.info("Shutting down")
        threading.Thread(target=httpd.shutdown, daemon=True).start()

    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGINT, shutdown)
    try:
        httpd.serve_forever()
    finally:
        httpd.server_close()
        app.store.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
