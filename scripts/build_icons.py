#!/usr/bin/env python3
"""Build the site icons from one drawing: the skyline of the San Francisco
Peaks (Humphreys, Agassiz, Fremont) on a pine-green tile.

Writes:
    images/icon.svg              tab icon for browsers that take SVG
    favicon.ico                  16, 32 and 48 px, for everything else
    images/favicon-32.png        32 px PNG
    images/apple-touch-icon.png  180 px, square (iOS rounds the corners)
    assets/img/mark.svg          header mark, used as a CSS mask so it takes
                                 the theme's accent colour (see .brand::before)

Needs rsvg-convert (librsvg; `brew install librsvg`) and Pillow:
    python3 scripts/build_icons.py
"""
import io
import subprocess
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
PINE, PAPER = "#2f6b4f", "#faf8f3"         # --accent and --bg in site.css
PEAKS = "M4 25L11.5 14L14 16.5L17.5 8.5L21 14.5L23 13L28 25Z"   # 32 x 32 grid
TILE = "M7 0H25A7 7 0 0 1 32 7V25A7 7 0 0 1 25 32H7A7 7 0 0 1 0 25V7A7 7 0 0 1 7 0Z"


def svg(body, view="0 0 32 32"):
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{view}">{body}</svg>\n'


ICON = svg(f'<rect width="32" height="32" rx="7" fill="{PINE}"/>'
           f'<path fill="{PAPER}" d="{PEAKS}"/>')
# square, with the peaks drawn smaller so they sit inside iOS's rounded corners
TOUCH = svg(f'<rect width="32" height="32" fill="{PINE}"/>'
            f'<path fill="{PAPER}" transform="translate(16 17.5) scale(.82) translate(-16 -17.5)" d="{PEAKS}"/>')
# tile with the peaks cut out: opaque where the accent shows
MARK = svg(f'<path fill="#000" fill-rule="evenodd" d="{TILE}{PEAKS}"/>')


def png(src, size):
    out = subprocess.run(["rsvg-convert", "-w", str(size), "-h", str(size)],
                         input=src.encode(), capture_output=True, check=True).stdout
    return Image.open(io.BytesIO(out)).convert("RGBA")


def main():
    (ROOT / "images" / "icon.svg").write_text(ICON, encoding="utf-8")
    (ROOT / "assets" / "img" / "mark.svg").write_text(MARK, encoding="utf-8")
    png(ICON, 32).save(ROOT / "images" / "favicon-32.png", optimize=True)
    png(TOUCH, 180).convert("RGB").save(ROOT / "images" / "apple-touch-icon.png", optimize=True)
    png(ICON, 48).save(ROOT / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)])
    print("wrote images/icon.svg, favicon.ico, images/favicon-32.png, "
          "images/apple-touch-icon.png, assets/img/mark.svg")


if __name__ == "__main__":
    main()
