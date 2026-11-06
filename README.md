# elyfmiller.github.io

Personal website of Ely F. Miller.

## Working on the site

Plain HTML, CSS and JS; no build step. Preview locally:

    python3 -m http.server 8558
    # open http://localhost:8558

| Path | What |
| --- | --- |
| `index.html`, `research.html`, `publications.html`, `cv.html`, `forecasts.html` | the pages |
| `assets/css/site.css` | all styles; colors are CSS variables at the top (light, then dark) |
| `assets/js/site.js` | dark-mode toggle |
| `assets/js/forecasts.js` | the forecast chart |
| `data/forecasts.json` | forecast data, built by the script below |
| `scripts/build_forecasts.py` | rebuilds the data from `cdcepi/FluSight-forecast-hub` |
| `.github/workflows/refresh-forecasts.yml` | refreshes the forecast data each week |
| `CNAME` | custom domain, `elymiller.com` |
| `sitemap.xml`, `robots.txt` | for search engines; add new pages to the sitemap |
| `404.html` | page shown for broken links (uses `/`-rooted paths) |
| `images/og-card.jpg`, `favicon.ico`, `images/*icon*` | link-preview card and site icons |

Placeholders for text are marked `<!-- TODO(Ely): ... -->` in the HTML and
show on the page as grey bracketed hints. Find them all with:

    grep -rn "TODO(Ely)" *.html

## Forecast data

    python3 scripts/build_forecasts.py                 # fetch from GitHub
    python3 scripts/build_forecasts.py --hub ~/GitHub/FluSight-forecast-hub   # or a local clone

Standard library only. Set `GITHUB_TOKEN` (e.g. `GITHUB_TOKEN=$(gh auth token)`)
to avoid the GitHub API's unauthenticated rate limit. Models, quantiles and the
season start are constants at the top of the script.

`.github/workflows/refresh-forecasts.yml` runs the script on Thursdays 20:00 UTC
and Fridays 14:00 UTC, commits the data only when it changed (as
github-actions[bot]), then asks Pages to redeploy. Run it by hand from the
Actions tab ("Run workflow"), or turn it off there with "Disable workflow".
