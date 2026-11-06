// Theme toggle + footer year. The initial theme is set by the inline
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
  });

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
