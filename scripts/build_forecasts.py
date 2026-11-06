#!/usr/bin/env python3
"""Build data/forecasts.json from the public FluSight forecast hub.

Reads, from https://github.com/cdcepi/FluSight-forecast-hub (main branch):
  model-output/<model>/<YYYY-MM-DD>-<model>.csv   (quantile forecasts)
  target-data/target-hospital-admissions.csv      (observed NHSN admissions)

Writes a compact JSON file for forecasts.html: for every model, round
(reference_date) and location, the 2.5/25/50/75/97.5% quantiles for
horizons 0-3 of target "wk inc flu hosp", plus observed weekly admissions
since SEASON_START.

Standard library only. Usage:
    python3 scripts/build_forecasts.py            # fetch from GitHub
    python3 scripts/build_forecasts.py --hub DIR  # read a local hub clone
Set GITHUB_TOKEN to raise the GitHub API rate limit (optional).
"""

import argparse
import csv
import io
import json
import os
import re
import sys
import urllib.request
from datetime import datetime, timezone
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


def read_forecast(text):
    """-> {location: [[q025,q25,q50,q75,q975] or None for h in HORIZONS]}"""
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

    forecasts, models = {}, {}
    for model, meta in MODELS.items():
        rounds = {}
        for name in hub.list_dir(f"model-output/{model}"):
            m = FILE_RE.match(name)
            if not m or m.group(2) != model or m.group(3) != "csv" or m.group(1) < SEASON_START:
                continue
            ref = m.group(1)
            data = read_forecast(hub.read_text(f"model-output/{model}/{name}"))
            if data:
                rounds[ref] = data
            print(f"  {model} {ref}: {len(data)} locations", file=sys.stderr)
        forecasts[model] = dict(sorted(rounds.items()))
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
    }
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"wrote {out} ({out.stat().st_size / 1024:.0f} KB)", file=sys.stderr)


if __name__ == "__main__":
    main()
