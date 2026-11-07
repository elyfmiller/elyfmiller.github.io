#!/usr/bin/env python3
"""Build citation data for publications.html from Crossref.

Reads every https://doi.org/... link in publications.html, asks Crossref for
each DOI's metadata, and writes:

  data/citations.json   BibTeX per DOI, used by the "BibTeX" buttons
  publications.html     a schema.org ScholarlyArticle list (JSON-LD) between
                        the <!-- citations:start --> / <!-- citations:end -->
                        markers in <head>, for search engines

Run it again after adding a paper to the page:

    python3 scripts/build_citations.py

Standard library only.
"""
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PAGE = ROOT / "publications.html"
OUT = ROOT / "data" / "citations.json"
UA = "elymiller.com citation builder (https://elymiller.com)"
ELY = {"@id": "https://elymiller.com/#ely"}
MAX_AUTHORS = 12


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return r.read().decode("utf-8")
        except Exception:
            if attempt == 2:
                raise
            time.sleep(2 * (attempt + 1))


def tidy_bibtex(raw, key, posted=False):
    """Crossref returns one long line; put each field on its own line."""
    raw = re.sub(r"<i>(.*?)</i>", r"\\textit{\1}", re.sub(r"\s+", " ", raw.strip()))
    m = re.match(r"@(\w+)\{[^,]*,\s*(.*)\}\s*$", raw, re.S)
    if not m:
        return raw
    kind, body = m.groups()
    fields, depth, cur = [], 0, ""
    for ch in body:
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
        if ch == "," and depth == 0:
            fields.append(cur.strip())
            cur = ""
        else:
            cur += ch
    if cur.strip():
        fields.append(cur.strip())
    # Crossref's url field is the dx.doi.org form; the DOI field already says it
    fields = [f for f in fields if not f.lower().startswith("url=")]
    fields = [re.sub(r"^(\w+)=", lambda m: "  " + m.group(1).lower() + " = ", f) for f in fields]
    # month: Crossref writes Sept, June...; BibTeX's macros are jan..dec
    fields = [re.sub(r"(month = )([A-Za-z]+)", lambda m: m.group(1) + m.group(2)[:3].lower(), f) for f in fields]
    if posted:  # preprints: Crossref says @article with no journal
        kind = "misc"
        fields.append("  note = {Preprint}")
    return "@%s{%s,\n%s\n}" % (kind, key, ",\n".join(fields))


def is_ely(a):
    return a.get("family", "").lower() == "miller" and a.get("given", "").lower().startswith("ely")


def scholarly(work, doi):
    authors, has_ely = [], False
    for a in work.get("author", []):
        if is_ely(a):
            authors.append(ELY)
            has_ely = True
        elif "family" in a:
            p = {"@type": "Person", "name": (a.get("given", "") + " " + a["family"]).strip()}
            if a.get("ORCID"):
                p["sameAs"] = a["ORCID"].replace("http://", "https://")
            authors.append(p)
        elif a.get("name"):
            authors.append({"@type": "Organization", "name": a["name"]})
    if len(authors) > MAX_AUTHORS:
        # very long consortium lists: keep the first few, plus Ely
        authors = authors[:MAX_AUTHORS] + ([ELY] if has_ely and ELY not in authors[:MAX_AUTHORS] else [])
    parts = (work.get("issued") or work.get("published") or {}).get("date-parts", [[None]])[0]
    item = {
        "@type": "ScholarlyArticle",
        "headline": " ".join(re.sub(r"<[^>]+>", "", (work.get("title") or [""])[0]).split()),
        "author": authors,
        "datePublished": "-".join("%02d" % p if i else str(p) for i, p in enumerate(parts) if p),
        "identifier": {"@type": "PropertyValue", "propertyID": "DOI", "value": doi},
        "url": "https://doi.org/" + doi,
    }
    if not has_ely:
        # consortium papers: Ely is listed as a member, not by name in Crossref
        item["contributor"] = ELY
    venue = (work.get("container-title") or [None])[0]
    if venue:
        item["isPartOf"] = {"@type": "Periodical", "name": venue}
    elif work.get("institution"):
        item["publisher"] = {"@type": "Organization", "name": work["institution"][0].get("name")}
    return item


def main():
    html = PAGE.read_text(encoding="utf-8")
    dois = list(dict.fromkeys(re.findall(r'href="https://doi\.org/([^"]+)"', html)))
    if not dois:
        sys.exit("no DOIs found in publications.html")
    bib, items, used = {}, [], set()
    for doi in dois:
        q = urllib.parse.quote(doi, safe="/")
        work = json.loads(get("https://api.crossref.org/works/" + q))["message"]
        first = next((a.get("family") or a.get("name") for a in work.get("author", [])), "anon")
        year = (work.get("issued", {}).get("date-parts") or [[0]])[0][0]
        word = re.sub(r"[^A-Za-z]", "", ((work.get("title") or ["x"])[0].split() or ["x"])[0]).lower()
        key = re.sub(r"[^A-Za-z]", "", first) + str(year) + word
        while key in used:
            key += "b"
        used.add(key)
        bib[doi] = tidy_bibtex(get("https://api.crossref.org/works/%s/transform/application/x-bibtex" % q), key,
                               posted=work.get("type") == "posted-content")
        items.append(scholarly(work, doi))
        print("ok", doi, "->", key)
        time.sleep(0.3)

    OUT.write_text(json.dumps(bib, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    me = dict(ELY, **{"@type": "Person", "name": "Ely F. Miller", "url": "https://elymiller.com/"})
    ld = json.dumps({"@context": "https://schema.org", "@graph": [me] + items}, indent=1, ensure_ascii=False)
    block = ("<!-- citations:start (built by scripts/build_citations.py from Crossref) -->\n"
             '  <script type="application/ld+json">\n' + ld + "\n  </script>\n  <!-- citations:end -->")
    new, n = re.subn(r"<!-- citations:start.*?<!-- citations:end -->", lambda m: block, html, flags=re.S)
    if n != 1:
        sys.exit("add <!-- citations:start --><!-- citations:end --> to publications.html <head> first")
    PAGE.write_text(new, encoding="utf-8")
    print("wrote", OUT.relative_to(ROOT), "and", len(items), "articles to", PAGE.name)


if __name__ == "__main__":
    main()
