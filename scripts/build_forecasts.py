#!/usr/bin/env python3
"""Build data/forecasts.json from the public FluSight forecast hub.

Reads, from https://github.com/cdcepi/FluSight-forecast-hub (main branch):
  model-output/<model>/<YYYY-MM-DD>-<model>.csv   (quantile forecasts)
  target-data/target-hospital-admissions.csv      (observed NHSN admissions)

Writes a compact JSON file for forecasts.html: for every model, round
(reference_date) and location, the 2.5/25/50/75/97.5% quantiles for
horizons 0-3 of target "wk inc flu hosp", plus observed weekly admissions
since SEASON_START.

It also writes, for the map, each forecast's chances of FluSight's five
rate-change categories (large decrease .. large increase), worked out from
the forecast's full quantile grid the way FluBNF does it for every model
(flubnf app/core/categorical.py, probs_from_quantiles). The baseline is
the week ending reference_date - 7 in the hub's current target data, and
populations come from the hub's auxiliary-data/locations.csv.

Standard library only. Usage:
    python3 scripts/build_forecasts.py            # fetch from GitHub
    python3 scripts/build_forecasts.py --hub DIR  # read a local hub clone
Set GITHUB_TOKEN to raise the GitHub API rate limit (optional).
"""

import argparse
import csv
import io
import json
import math
import os
import re
import sys
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

HUB_REPO = "cdcepi/FluSight-forecast-hub"
HUB_BRANCH = "main"
TARGET = "wk inc flu hosp"
SEASON_START = "2026-08-01"  # rounds and observations before this are left out
HORIZONS = (0, 1, 2, 3)
QUANTILES = ("0.025", "0.25", "0.5", "0.75", "0.975")

# Model IDs on the hub and their short display labels. Labels follow the
# model_name fields of the hub's model-metadata cards.
MODELS = {
    "NAU_PyBNF-OracleSIHRS": {"label": "Oracle SIHRS", "team": True},
    "NAU_PyBNF-GroundHogCGR": {"label": "Groundhog", "team": True},
    "FluSight-ensemble": {"label": "FluSight ensemble", "team": False},
    "FluSight-baseline": {"label": "FluSight baseline", "team": False},
}

# FluSight rate-change categories (hub model-output/README.md, "Rate-trend
# forecast specifications"; cut points as the hub's scoring code applies them)
CATS = ("large_decrease", "decrease", "stable", "increase", "large_increase")
RATE_CUTS = {0: (0.3, 1.7), 1: (0.5, 3.0), 2: (0.7, 4.0), 3: (1.0, 5.0)}
COUNT_STABLE = 10.0

OUT = Path(__file__).resolve().parent.parent / "data" / "forecasts.json"
FILE_RE = re.compile(r"^(\d{4}-\d{2}-\d{2})-(.+)\.(csv|parquet)$")


def _get(url, api=False):
    headers = {"User-Agent": "forecast-page-builder"}
    token = os.environ.get("GITHUB_TOKEN")
    if api:
        headers["Accept"] = "application/vnd.github+json"
        if token:
            headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


class RemoteHub:
    def list_dir(self, path):
        url = f"https://api.github.com/repos/{HUB_REPO}/contents/{path}?ref={HUB_BRANCH}"
        return [e["name"] for e in json.loads(_get(url, api=True)) if e["type"] == "file"]

    def read_text(self, path):
        url = f"https://raw.githubusercontent.com/{HUB_REPO}/{HUB_BRANCH}/{path}"
        return _get(url).decode("utf-8")


class LocalHub:
    def __init__(self, root):
        self.root = Path(root)

    def list_dir(self, path):
        return sorted(p.name for p in (self.root / path).iterdir() if p.is_file())

    def read_text(self, path):
        return (self.root / path).read_text(encoding="utf-8")


def num(x):
    """Round to 1 decimal and drop a trailing .0 so the JSON stays small."""
    v = round(float(x), 1)
    return int(v) if v == int(v) else v


def interp(x, xs, ys):
    """numpy.interp for one point: clamped at both ends."""
    if x <= xs[0]:
        return ys[0]
    if x >= xs[-1]:
        return ys[-1]
    i = 1
    while xs[i] < x:
        i += 1
    return ys[i - 1] + (ys[i] - ys[i - 1]) * (x - xs[i - 1]) / (xs[i] - xs[i - 1])


def cat_probs(grid, baseline, population, horizon):
    """The five rate-change probabilities from one quantile grid
    {level: value}: FluBNF's probs_from_quantiles, standard library only.
    The grid is read as a piecewise-linear CDF, its outermost segments
    carried on to levels 0 and 1 (never below a count of 0), and differenced
    at the half-integer edges of each category's whole-count changes from
    the baseline week. None when the grid or population is unusable."""
    if not grid or not population:
        return None
    xs, ls = [], []
    for v, l in sorted((v, l) for l, v in grid.items()):
        if xs and v <= xs[-1]:
            ls[-1] = max(ls[-1], l)
        else:
            xs.append(v)
            ls.append(l)
    if len(xs) < 2:
        return None
    lo = max(xs[0] - (xs[1] - xs[0]) * ls[0] / max(ls[1] - ls[0], 1e-12), -0.5)
    if ls[0] > 0 and lo < xs[0]:
        xs.insert(0, lo)
        ls.insert(0, 0.0)
    hi = xs[-1] + (xs[-1] - xs[-2]) * (1 - ls[-1]) / max(ls[-1] - ls[-2], 1e-12)
    if ls[-1] < 1 and hi > xs[-1]:
        xs.append(hi)
        ls.append(1.0)
    lo_rate, hi_rate = RATE_CUTS[horizon]
    scale = population / 1e5
    s = int(math.ceil(max(COUNT_STABLE, lo_rate * scale))) - 1
    big = max(int(math.floor(hi_rate * scale)) + 1, s + 1)
    b = float(round(baseline))
    F = lambda e: interp(b + e, xs, ls)
    p = (F(-big + 0.5), F(-s - 0.5) - F(-big + 0.5), F(s + 0.5) - F(-s - 0.5),
         F(big - 0.5) - F(s + 0.5), 1.0 - F(big - 0.5))
    return [min(1.0, max(0.0, x)) for x in p]


def read_forecast(text, grids=None):
    """-> {location: [[q025,q25,q50,q75,q975] or None for h in HORIZONS]}
    and, into `grids` when given, every quantile level:
    {location: {horizon: {level: value}}} (for the category chances)"""
    cells = {}
    for row in csv.DictReader(io.StringIO(text)):
        if row["target"] != TARGET or row["output_type"] != "quantile":
            continue
        try:
            h = int(row["horizon"])
        except ValueError:
            continue
        if h not in HORIZONS:
            continue
        if grids is not None and row["value"] not in ("", "NA") and row["output_type_id"]:
            grids.setdefault(row["location"], {}).setdefault(h, {})[float(row["output_type_id"])] = float(row["value"])
        q = row["output_type_id"]
        # hub files write quantile levels as e.g. 0.5 or 0.500
        q = str(float(q)).rstrip("0").rstrip(".") if q else q
        q = {"0.25": "0.25", "0.025": "0.025", "0.5": "0.5", "0.75": "0.75", "0.975": "0.975"}.get(q)
        if q is None or row["value"] in ("", "NA"):
            continue
        cells.setdefault(row["location"], {}).setdefault(h, {})[q] = num(row["value"])
    out = {}
    for loc, by_h in cells.items():
        rows = []
        for h in HORIZONS:
            qs = by_h.get(h, {})
            rows.append([qs[q] for q in QUANTILES] if all(q in qs for q in QUANTILES) else None)
        if any(rows):
            out[loc] = rows
    return out


def read_target(text):
    obs, names = {}, {}
    for row in csv.DictReader(io.StringIO(text)):
        if row["date"] < SEASON_START or row["value"] in ("", "NA"):
            continue
        obs.setdefault(row["location"], {})[row["date"]] = num(row["value"])
        names[row["location"]] = row["location_name"]
    return obs, names


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--hub", help="path to a local clone of the hub (default: fetch from GitHub)")
    ap.add_argument("--out", default=str(OUT))
    args = ap.parse_args()
    hub = LocalHub(args.hub) if args.hub else RemoteHub()

    obs, names = read_target(hub.read_text("target-data/target-hospital-admissions.csv"))
    dates = sorted({d for series in obs.values() for d in series})
    pop = {r["location"]: float(r["population"])
           for r in csv.DictReader(io.StringIO(hub.read_text("auxiliary-data/locations.csv")))
           if r.get("population")}

    forecasts, models, cats = {}, {}, {}
    for model, meta in MODELS.items():
        rounds, rcats = {}, {}
        for name in hub.list_dir(f"model-output/{model}"):
            m = FILE_RE.match(name)
            if not m or m.group(2) != model or m.group(3) != "csv" or m.group(1) < SEASON_START:
                continue
            ref = m.group(1)
            grids = {}
            data = read_forecast(hub.read_text(f"model-output/{model}/{name}"), grids)
            if data:
                rounds[ref] = data
            # category chances, in whole percent, per horizon
            base_day = (datetime.strptime(ref, "%Y-%m-%d") - timedelta(days=7)).strftime("%Y-%m-%d")
            by_loc = {}
            for loc, by_h in grids.items():
                base = obs.get(loc, {}).get(base_day)
                if base is None:
                    continue
                row = []
                for h in HORIZONS:
                    p = cat_probs(by_h.get(h), base, pop.get(loc), h)
                    row.append([round(100 * x) for x in p] if p else None)
                if any(row):
                    by_loc[loc] = row
            if by_loc:
                rcats[ref] = by_loc
            print(f"  {model} {ref}: {len(data)} locations, {len(by_loc)} with categories", file=sys.stderr)
        forecasts[model] = dict(sorted(rounds.items()))
        cats[model] = dict(sorted(rcats.items()))
        models[model] = {**meta, "rounds": sorted(rounds)}

    locs = sorted(names, key=lambda k: (k != "US", names[k]))
    payload = {
        "generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%MZ"),
        "source": f"https://github.com/{HUB_REPO}",
        "target": TARGET,
        "quantiles": [float(q) for q in QUANTILES],
        "horizons": list(HORIZONS),
        "models": models,
        "locations": [{"id": k, "name": names[k]} for k in locs],
        "obs_dates": dates,
        "observed": {k: [obs[k].get(d) for d in dates] for k in locs},
        "forecasts": forecasts,
        "categories": CATS,
        "cat_probs": cats,
    }
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"wrote {out} ({out.stat().st_size / 1024:.0f} KB)", file=sys.stderr)


if __name__ == "__main__":
    main()
