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
| `assets/js/site.js` | dark-mode toggle, publication sort and copy buttons, copy-email button, footer "Updated" date, CV section rail, unfolding lists for printing |
| `assets/js/forecasts.js` | the forecast chart: one round or all rounds, linear or log scale, state tile map, CSV download; every choice is kept in the link |
| `assets/js/home.js` | the small US forecast chart on the home page |
| `assets/icons.svg` | link icons (Lucide, ISC; Simple Icons, CC0) |
| `data/forecasts.json` | forecast data, built by the script below |
| `scripts/build_forecasts.py` | rebuilds the data from `cdcepi/FluSight-forecast-hub` |
| `data/citations.json` | BibTeX for each paper, built by `scripts/build_citations.py` |
| `scripts/build_citations.py` | fetches paper metadata from Crossref (BibTeX, and search-engine data in `publications.html`) |
| `.github/workflows/refresh-forecasts.yml` | refreshes the forecast data each week |
| `.github/workflows/check-links.yml` | checks every link once a week |
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

## Citations

After adding a paper to `publications.html` (with its `https://doi.org/...`
link), rebuild the citation data:

    python3 scripts/build_citations.py

It reads the DOIs from the page, fetches each one from Crossref, and rewrites
`data/citations.json` (used by the BibTeX buttons) and the search-engine data
between the `citations:start` / `citations:end` markers in the page's `<head>`.
"Copy citation" copies the entry's text as it appears on the page.

## Link check

`.github/workflows/check-links.yml` runs [lychee](https://github.com/lycheeverse/lychee)
over every page on Mondays at 15:00 UTC. A broken link fails the run (GitHub
emails you), and the run's summary lists what broke. Run it by hand from the
Actions tab. Exclusions and the reasons for them are commented in the file.

## Printing

Every page prints in light colors without the header menu or buttons; the CV
page prints as a single column with the folded lists opened.

## Forecast page links

Every choice on the forecast page is kept in the address, so a link opens the
same view. Only choices that differ from the defaults appear:

    forecasts.html#loc=AZ                    Arizona, latest round
    forecasts.html#loc=TX&round=2026-10-24   Texas, an earlier round
    forecasts.html#loc=AZ&view=all           every round of the season
    forecasts.html#scale=log&bands=50        log scale, 50% interval only
    forecasts.html#models=NAU_PyBNF-OracleSIHRS,FluSight-ensemble

`loc` takes postal codes (`AZ`, `DC`, `PR`) or `US`.
