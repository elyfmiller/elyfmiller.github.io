#!/usr/bin/env python3
"""Render scripts/og-card.html to images/og-card.jpg, the 1200 x 630 card
that link previews show (LinkedIn, Slack, iMessage, ...).

Serves the repo on a local port so the page can load the site's own
background, mark and photo, then screenshots it with headless Chrome.
Needs Google Chrome and Pillow:

    python3 scripts/build_og_card.py

After changing the card, social sites keep the old one for a while;
LinkedIn's Post Inspector (linkedin.com/post-inspector) refreshes it.
"""
import functools
import http.server
import os
import subprocess
import tempfile
import threading
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "images" / "og-card.jpg"
CHROME = os.environ.get("CHROME", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")


def main():
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *args):
            pass
    handler = functools.partial(Quiet, directory=str(ROOT))
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    url = f"http://127.0.0.1:{server.server_address[1]}/scripts/og-card.html"
    with tempfile.TemporaryDirectory() as tmp:
        png = Path(tmp) / "card.png"
        subprocess.run([CHROME, "--headless=new", "--hide-scrollbars", "--force-device-scale-factor=1",
                        "--window-size=1200,630", "--virtual-time-budget=4000",
                        f"--user-data-dir={tmp}/profile", f"--screenshot={png}", url],
                       check=True, capture_output=True)
        Image.open(png).convert("RGB").crop((0, 0, 1200, 630)).save(OUT, quality=88, optimize=True, progressive=True)
    server.shutdown()
    print(f"wrote {OUT} ({OUT.stat().st_size / 1024:.0f} KB)")


if __name__ == "__main__":
    main()
