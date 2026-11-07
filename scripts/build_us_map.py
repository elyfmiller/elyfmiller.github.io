#!/usr/bin/env python3
"""Build data/us-states.json, the state outlines for the forecast maps.

Source: us-atlas (https://github.com/topojson/us-atlas, ISC licence; the
shapes are the US Census Bureau's public-domain cartographic boundaries),
file states-albers-10m.json: pre-projected Albers USA with Alaska and
Hawaii inset, 975 x 610. The same file FluBNF vendors for its maps
(flubnf app/core/assets/states-albers-10m.json).

The TopoJSON arcs are decoded into one SVG path per state, so the page
needs no map library. Puerto Rico is not in this file; the pages offer it
as a button. Run once; the outlines do not change:

    python3 scripts/build_us_map.py
"""
import json
import urllib.request
from pathlib import Path

URL = "https://cdn.jsdelivr.net/npm/us-atlas@3.0.1/states-albers-10m.json"
OUT = Path(__file__).resolve().parent.parent / "data" / "us-states.json"


def main():
    req = urllib.request.Request(URL, headers={"User-Agent": "elymiller.com map builder"})
    with urllib.request.urlopen(req, timeout=60) as r:
        topo = json.load(r)
    sc, tr = topo["transform"]["scale"], topo["transform"]["translate"]

    def arc(i):
        pts, x, y = [], 0, 0
        for dx, dy in topo["arcs"][~i if i < 0 else i]:
            x += dx
            y += dy
            pts.append((x * sc[0] + tr[0], y * sc[1] + tr[1]))
        return pts[::-1] if i < 0 else pts

    def ring(arcs):
        pts = []
        for k, a in enumerate(arcs):
            p = arc(a)
            pts.extend(p if k == 0 else p[1:])      # arcs share endpoints
        return "M" + "L".join(f"{x:.1f} {y:.1f}".replace(".0 ", " ") for x, y in pts) + "Z"

    states = {}
    for g in topo["objects"]["states"]["geometries"]:
        polys = g["arcs"] if g["type"] == "MultiPolygon" else [g["arcs"]]
        states[str(g["id"]).zfill(2)] = [g["properties"]["name"],
                                         "".join(ring(r) for poly in polys for r in poly)]
    out = {"source": URL, "viewBox": [0, 0, 975, 610], "states": dict(sorted(states.items()))}
    OUT.write_text(json.dumps(out, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"wrote {OUT} ({len(states)} shapes, {OUT.stat().st_size / 1024:.0f} KB)")


if __name__ == "__main__":
    main()
