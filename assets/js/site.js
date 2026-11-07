// Theme toggle, footer year and last-updated date, publication sort and
// copy buttons, CV rail. The initial theme is set by the inline
// snippet in each page's <head> so there is no flash on load.
(function () {
  var root = document.documentElement;
  function current() {
    var t = root.getAttribute("data-theme");
    if (t) return t;
    return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  function label(btn) {
    var dark = current() === "dark";
    btn.setAttribute("aria-label", dark ? "Switch to light mode" : "Switch to dark mode");
    btn.innerHTML = dark
      ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>'
      : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';
  }
  document.addEventListener("DOMContentLoaded", function () {
    var btn = document.querySelector(".theme-toggle");
    if (btn) {
      label(btn);
      btn.addEventListener("click", function () {
        var next = current() === "dark" ? "light" : "dark";
        root.setAttribute("data-theme", next);
        try { localStorage.setItem("theme", next); } catch (e) {}
        label(btn);
        document.dispatchEvent(new CustomEvent("themechange"));
      });
    }
    var y = document.getElementById("year");
    if (y) y.textContent = new Date().getFullYear();
    setupSort();
    setupRail();
    setupCopyEmail();
    setupCite();
    setupUpdated();
    setupPrint();
  });

  // Printing: unfold the "N more" lists, then fold them back afterwards.
  function setupPrint() {
    var opened = [];
    addEventListener("beforeprint", function () {
      document.querySelectorAll("details:not([open])").forEach(function (d) { d.open = true; opened.push(d); });
    });
    addEventListener("afterprint", function () {
      opened.forEach(function (d) { d.open = false; }); opened = [];
    });
  }

  // ---- copying to the clipboard, with a spoken "Copied" ----
  var live;
  function say(msg) {
    if (!live) {
      live = document.createElement("span");
      live.className = "sr-only";
      live.setAttribute("aria-live", "polite");
      document.body.appendChild(live);
    }
    live.textContent = "";
    setTimeout(function () { live.textContent = msg; }, 50);
  }
  function copy(text) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
    return new Promise(function (ok, fail) {
      var ta = document.createElement("textarea");
      ta.value = text; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy") ? ok() : fail(); } catch (e) { fail(e); }
      document.body.removeChild(ta);
    });
  }
  function done(btn, what) {
    btn.classList.add("copied");
    var lab = btn.querySelector(".lab");
    var was = lab && lab.textContent;
    if (lab) lab.textContent = "Copied";
    var use = btn.querySelector("use");
    if (use) use.setAttribute("href", "assets/icons.svg#check");
    say(what + " copied");
    clearTimeout(btn._t);
    btn._t = setTimeout(function () {
      btn.classList.remove("copied");
      if (lab) lab.textContent = was;
      if (use) use.setAttribute("href", "assets/icons.svg#copy");
    }, 1600);
  }
  function icon(id) {
    return '<svg class="ic" aria-hidden="true"><use href="assets/icons.svg#' + id + '"/></svg>';
  }

  // Contact links: a small "copy address" button beside each email link.
  function setupCopyEmail() {
    document.querySelectorAll('.links a[href^="mailto:"]').forEach(function (a) {
      var addr = a.getAttribute("href").slice(7);
      var b = document.createElement("button");
      b.type = "button"; b.className = "copy-btn";
      b.setAttribute("aria-label", "Copy email address");
      b.title = "Copy email address";
      b.innerHTML = icon("copy");
      b.addEventListener("click", function () {
        copy(addr).then(function () { done(b, "Email address"); }, function () { say("Could not copy"); });
      });
      a.parentNode.classList.add("has-copy");
      a.parentNode.appendChild(b);
    });
  }

  // Publications: "Copy citation" (the text as shown, plus its DOI link) and
  // "BibTeX" (from data/citations.json, built by scripts/build_citations.py).
  function setupCite() {
    var bib;
    function getBib() {
      if (!bib) bib = fetch("data/citations.json").then(function (r) { if (!r.ok) throw r; return r.json(); });
      return bib;
    }
    document.querySelectorAll('.pub-list .pill-links a[href^="https://doi.org/"]').forEach(function (a) {
      var doi = a.getAttribute("href").slice(16);
      var ul = a.closest(".pill-links"), entry = ul.parentNode;
      function add(label, what, getText) {
        var li = document.createElement("li"), b = document.createElement("button");
        b.type = "button";
        b.innerHTML = icon("copy") + '<span class="lab">' + label + "</span>";
        b.setAttribute("aria-label", label + ": " + (entry.querySelector(".ttl") || entry).textContent.trim().slice(0, 80));
        b.addEventListener("click", function () {
          Promise.resolve().then(getText).then(copy).then(function () { done(b, what); },
            function () { say("Could not copy"); });
        });
        li.appendChild(b); ul.appendChild(li);
      }
      add("Copy citation", "Citation", function () {
        var c = entry.cloneNode(true);
        c.querySelectorAll(".pill-links, .badge").forEach(function (x) { x.remove(); });
        return c.textContent.replace(/\s+/g, " ").trim() + " https://doi.org/" + doi;
      });
      add("BibTeX", "BibTeX", function () {
        return getBib().then(function (d) { if (!d[doi]) throw doi; return d[doi]; });
      });
    });
  }

  // Footer: when the site was last deployed (GitHub Pages' Last-Modified).
  function setupUpdated() {
    var f = document.querySelector(".site-footer .inner > span");
    var t = Date.parse(document.lastModified);
    // with no Last-Modified header, browsers report "now"; skip that case
    if (!f || isNaN(t) || Date.now() - t < 5000) return;
    var d = new Date(t);
    var s = document.createElement("span");
    s.className = "updated";
    s.innerHTML = 'Updated <time datetime="' + d.toISOString().slice(0, 10) + '">' +
      d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) + "</time>";
    f.parentNode.insertBefore(s, f.nextSibling);
  }

  // Publications: "As in CV" / "Newest first" switch. Items carry
  // data-order (CV position) and data-year; ties keep the CV order.
  function setupSort() {
    document.querySelectorAll("[data-sort-for]").forEach(function (seg) {
      var list = document.getElementById(seg.getAttribute("data-sort-for"));
      if (!list) return;
      var items = Array.prototype.slice.call(list.children);
      seg.addEventListener("click", function (e) {
        var b = e.target.closest("button[data-sort]");
        if (!b) return;
        var byYear = b.getAttribute("data-sort") === "year";
        items.slice().sort(function (a, c) {
          var d = byYear ? (+c.dataset.year - +a.dataset.year) : 0;
          return d || (+a.dataset.order - +c.dataset.order);
        }).forEach(function (li) { list.appendChild(li); });
        seg.querySelectorAll("button").forEach(function (x) { x.setAttribute("aria-pressed", String(x === b)); });
      });
    });
  }

  // CV: highlight the section in view in the side rail.
  function setupRail() {
    var rail = document.querySelector(".cv-rail");
    if (!rail || !("IntersectionObserver" in window)) return;
    var links = {};
    rail.querySelectorAll('a[href^="#"]').forEach(function (a) { links[a.getAttribute("href").slice(1)] = a; });
    var visible = {};
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) { visible[en.target.id] = en.isIntersecting; });
      var first = Object.keys(links).filter(function (id) { return visible[id]; })[0];
      if (!first) return;
      Object.keys(links).forEach(function (id) {
        if (id === first) links[id].setAttribute("aria-current", "true");
        else links[id].removeAttribute("aria-current");
      });
    }, { rootMargin: "-80px 0px -55% 0px" });
    Object.keys(links).forEach(function (id) { var s = document.getElementById(id); if (s) io.observe(s); });
  }
})();
