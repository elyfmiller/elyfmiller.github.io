#!/usr/bin/env python3
"""Build the site background, assets/img/topo.svg: contour lines of the
terrain around Flagstaff, Arizona (the San Francisco Peaks, Mount Elden and
the city below them). Lines only: no labels, roads, places or points.

Elevation: the Terrain Tiles open dataset on AWS (terrarium encoding,
elevation = R*256 + G + B/256 - 32768 metres), which draws on USGS 3DEP
for this area. Tiles are cached in --cache (default: a folder in the
system temp directory) so a re-run makes no requests.

The SVG is used as a CSS mask, so it is drawn in black only; the colour
and strength come from the --topo-* tokens in assets/css/site.css.

Needs numpy, scipy, Pillow and scikit-image:
    python3 scripts/build_topo.py
"""
import argparse
import math
import os
import tempfile
import urllib.request
from pathlib import Path

import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter
from skimage.measure import approximate_polygon, find_contours

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "assets" / "img" / "topo.svg"
URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"
UA = "elymiller.com background builder (https://elymiller.com)"

Z = 12
CENTER = (-111.655, 35.275)     # lon, lat: between the Peaks and Mount Elden
SPAN_KM = (40.0, 25.0)          # width, height of the drawn area
W = 1600                        # SVG width in user units; height follows
MINOR, INDEX = 30, 150          # contour interval and index interval, metres
SMOOTH = 2.4                    # Gaussian blur of the elevation grid, pixels
TOLERANCE = 0.7                 # line simplification, SVG units


def tile_xy(lon, lat):
    n = 2 ** Z
    return ((lon + 180) / 360 * n,
            (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n)


def fetch(cache, x, y):
    p = Path(cache) / f"{Z}_{x}_{y}.png"
    if not p.exists():
        req = urllib.request.Request(URL.format(z=Z, x=x, y=y), headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=60) as r:
            p.write_bytes(r.read())
    rgb = np.asarray(Image.open(p).convert("RGB"), dtype=np.float64)
    return rgb[..., 0] * 256 + rgb[..., 1] + rgb[..., 2] / 256 - 32768


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--cache", default=os.path.join(tempfile.gettempdir(), "elymiller-topo-tiles"))
    ap.add_argument("--out", default=str(OUT))
    args = ap.parse_args()
    os.makedirs(args.cache, exist_ok=True)

    lon0, lat0 = CENTER
    dlat = SPAN_KM[1] / 2 / 110.574
    dlon = SPAN_KM[0] / 2 / (111.320 * math.cos(math.radians(lat0)))
    fx0, fy0 = tile_xy(lon0 - dlon, lat0 + dlat)
    fx1, fy1 = tile_xy(lon0 + dlon, lat0 - dlat)
    pad = 16 / 256                  # tile units: room for the margin below
    tx = range(int(fx0 - pad), int(fx1 + pad) + 1)
    ty = range(int(fy0 - pad), int(fy1 + pad) + 1)
    dem = np.vstack([np.hstack([fetch(args.cache, x, y) for x in tx]) for y in ty])

    # crop to the drawn area (tile pixel coordinates), with a margin so the
    # blur and the contours run cleanly off the edges
    px = lambda f, t0: (f - t0) * 256
    c0, c1 = px(fx0, tx[0]), px(fx1, tx[0])
    r0, r1 = px(fy0, ty[0]), px(fy1, ty[0])
    m = 8
    a, b = int(r0) - m, int(math.ceil(r1)) + m
    c, d = int(c0) - m, int(math.ceil(c1)) + m
    dem = gaussian_filter(dem[a:b, c:d], SMOOTH)
    scale = W / (c1 - c0)
    H = round((r1 - r0) * scale)
    ox, oy = c0 - c, r0 - a

    lo = math.ceil(dem.min() / MINOR) * MINOR
    hi = math.floor(dem.max() / MINOR) * MINOR
    minor, index = [], []
    for level in range(lo, hi + 1, MINOR):
        for line in find_contours(dem, level):
            line = approximate_polygon(line, TOLERANCE / scale)
            if len(line) < 3:
                continue
            pts = [((col - ox) * scale, (row - oy) * scale) for row, col in line]
            span = max(math.dist(pts[0], p) for p in pts)
            if span < 6:            # specks
                continue
            d_ = "M" + "L".join(f"{x:.1f} {y:.1f}" for x, y in pts)
            (index if level % INDEX == 0 else minor).append(d_)

    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" '
           f'preserveAspectRatio="xMidYMid slice">'
           f'<g fill="none" stroke="#000" stroke-linejoin="round" stroke-linecap="round">'
           f'<path stroke-opacity=".55" stroke-width=".8" d="{"".join(minor)}"/>'
           f'<path stroke-width="1.3" d="{"".join(index)}"/>'
           f'</g></svg>\n')
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(svg, encoding="utf-8")
    print(f"{lo}-{hi} m, {len(minor)} + {len(index)} lines, {W}x{H}, "
          f"wrote {out} ({out.stat().st_size / 1024:.0f} KB)")


if __name__ == "__main__":
    main()
