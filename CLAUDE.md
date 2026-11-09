# elyfmiller.github.io — rules for Claude

Personal academic website for Ely F. Miller (he/him), PhD student, Biological Sciences, Northern Arizona University. Hosted on GitHub Pages from `elyfmiller/elyfmiller.github.io`; custom domain `elymiller.com` planned (Ely buys it himself). BIO 558 assignment: due Nov 12, 2026; revise and finalize by Dec 9, 2026.

## Commits and pushes
- Author and committer: `Ely F. Miller <efm46@nau.edu>` (set in this repo's local git config). Push with Ely's own `gh` login, account `elyfmiller`.
- Never add a Co-Authored-By, "Generated with", Claude, or Anthropic trailer or mention to a commit message or PR body. `.githooks/commit-msg` rejects them; never bypass it with `--no-verify`.
- Commit or push only when Ely asks. The repo is public, so the first push publishes the site.

## Text ownership
- Ely writes all prose: bio, research descriptions, project blurbs, page intros, captions. Claude does not draft it.
- Claude builds structure, styling, scripts and data plumbing, and leaves visible placeholders for prose in the form `<!-- TODO(Ely): ... -->` plus a short grey bracketed hint on the page, so nothing Claude-written ships as Ely's voice.
- Claude may: fix typos Ely asks about, check facts and links, and suggest structure. Any wording suggestion goes in chat, not into the files, unless Ely says to paste it.
- Facts on the site (numbers, dates, model names, publications) must come from Ely or from a source Claude can cite: the flubnf repo docs (`/Users/elymiller/GitHub/flubnf`, source of truth for FluSight model facts), the FluSight hub, or the publication itself.

## Design brief
- Modern and minimalist. Lots of white space, one accent color, a clean sans-serif. NAU True Blue `#002454` and Gold `#FFB81C` are the palette if branding is wanted; ask Ely before using NAU marks or logos.
- Static site, no build step required for Pages (plain HTML/CSS/JS, or Jekyll only if Ely wants it). Light and dark mode. Works at phone width.
- Pages, from the class guidelines (`BIO 558 webpage/00-Webpage Guidelines.docx`): home (name, affiliations, contact, photo, research interests, short bio), research/projects (current and past, PIs and collaborators with links), publications (with Google Scholar, ORCID, CV links), forecasts, plus education, work history, awards, press and personal interests wherever Ely wants them.

## Forecast page
- Shows FluBNF's live FluSight forecasts: `NAU_PyBNF-OracleSIHRS` (mechanistic SIHRS + Liu–West filter + Oracle step) and `NAU_PyBNF-GroundHogCGR` (empirical), against observed NHSN admissions, with the FluSight baseline and ensemble optional for comparison. Location picker (US + states), 50% and 95% intervals, horizons 0–3.
- Data source: public `cdcepi/FluSight-forecast-hub` — `model-output/<model>/<YYYY-MM-DD>-<model>.csv` (23 quantiles) and `target-data/target-hospital-admissions.csv`. A small script turns these into compact JSON in the repo; a scheduled GitHub Action can refresh it weekly (Ely approves the workflow before it is enabled).
- Diseases: influenza is the only live target. Per the flubnf repo, a COVID-19 port was tested and archived (`docs/MODEL-PROVENANCE.md` §5) and RSV is a planned future direction. Ely decides how the page describes each.
- Do not show scores (relWIS etc.) Ely has not approved for public display.
