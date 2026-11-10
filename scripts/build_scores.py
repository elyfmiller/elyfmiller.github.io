#!/usr/bin/env python3
"""Build data/scores.json from the FluSight dashboard's published scores.

The FluSight dashboard (https://reichlab.io/flusight-dashboard/eval.html,
repo reichlab/flusight-dashboard, branch predevals/data) scores every model
on the hub each week with hubPredEvalsData. This script reads its
"<season> season, US national level" and "<season> season, state level"
sets for target "wk inc flu hosp" (the latest season it has) and keeps, for
our models and the FluSight ensemble and baseline:

  rel   wis_scaled_relative_skill: pairwise relative WIS, FluSight-baseline = 1
  rank  place among every model the set scores, lowest relative WIS first
        (ties share the better place)
  n     forecasts scored

plus the number of models scored, the rounds scored (from the set's
reference_date breakdown) and the date the dashboard last updated its scores.
flubnf's scripts/dashboard_score.py reproduces these numbers from the hub's
own files.

Standard library only. Usage:
    python3 scripts/build_scores.py
Set GITHUB_TOKEN to raise the GitHub API rate limit (optional).
"""

import csv
import io
import json
import os
import re
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_forecasts import MODELS  # noqa: E402  (same model list and labels as the chart)

DASH_REPO = "reichlab/flusight-dashboard"
DASH_BRANCH = "predevals/data"
DASH_PAGE = "https://reichlab.io/flusight-dashboard/eval.html"
TARGET = "wk inc flu hosp"
LEVELS = {"national": "US national level", "state": "state level"}
SEASON_RE = re.compile(r"^(\d{4})-(\d{4}) season, US national level$")

OUT = Path(__file__).resolve().parent.parent / "data" / "scores.json"


def _get(url, api=False):
    headers = {"User-Agent": "forecast-page-builder"}
    if api:
        headers["Accept"] = "application/vnd.github+json"
        token = os.environ.get("GITHUB_TOKEN")
        if token:
            headers["Authorization"] = f"Bearer {token}"
    with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=60) as r:
        return r.read()


def raw(path):
    q = urllib.parse.quote(path)
    return _get(f"https://raw.githubusercontent.com/{DASH_REPO}/{DASH_BRANCH}/{q}").decode()


def rows(path):
    return list(csv.DictReader(io.StringIO(raw(path))))


def num(x):
    try:
        v = float(x)
    except (TypeError, ValueError):
        return None
    return v if v == v else None  # NaN -> None


def latest_season():
    """The newest '<YYYY-YYYY> season' eval set the dashboard has."""
    opts = json.loads(raw("predevals-options.json"))
    seasons = [m.group(1) + "-" + m.group(2) for s in opts["eval_sets"]
               if (m := SEASON_RE.match(s["eval_set_name"]))]
    if not seasons:
        raise SystemExit("the dashboard lists no season eval set")
    return max(seasons)


def updated():
    """The date the dashboard last committed its scores (UTC, YYYY-MM-DD)."""
    url = f"https://api.github.com/repos/{DASH_REPO}/commits?sha={urllib.parse.quote(DASH_BRANCH, safe='')}&per_page=1"
    c = json.loads(_get(url, api=True))[0]
    return c["commit"]["committer"]["date"][:10]


def level(season, name):
    base = f"scores/{TARGET}/{season} season, {name}"
    scored = [(r["model_id"], num(r["wis_scaled_relative_skill"]), r) for r in rows(f"{base}/scores.csv")]
    scored = [s for s in scored if s[1] is not None]
    vals = sorted(v for _, v, _ in scored)
    out = {"models": len(scored), "rows": {}}
    for model, v, r in scored:
        if model in MODELS:
            out["rows"][model] = {
                "rel": round(v, 4),
                "rank": vals.index(v) + 1,  # ties share the better place
                "n": int(float(r["n"])) if num(r.get("n")) is not None else None,
            }
    out["rounds"] = sorted({r["reference_date"] for r in rows(f"{base}/reference_date/scores.csv")})
    return out


def main():
    season = latest_season()
    data = {
        "generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%MZ"),
        "source": DASH_PAGE,
        "updated": updated(),
        "season": season,
        "labels": {m: v["label"] for m, v in MODELS.items()},
        "levels": {k: level(season, name) for k, name in LEVELS.items()},
    }
    for k, lv in data["levels"].items():
        if not lv["rows"]:
            print(f"warning: none of our models in the {k} set", file=sys.stderr)
    OUT.write_text(json.dumps(data, separators=(",", ":")) + "\n")
    nat = data["levels"]["national"]
    print(f"wrote {OUT.name}: {season}, dashboard of {data['updated']}, rounds {', '.join(nat['rounds'])}; "
          + "; ".join(f"{m} US {r['rel']:.2f} ({r['rank']}/{nat['models']})" for m, r in nat["rows"].items()))


if __name__ == "__main__":
    main()
