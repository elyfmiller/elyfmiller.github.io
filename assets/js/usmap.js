// US rate-change map, after FluBNF's outlook map (flubnf app/core/usmap.py).
// Each state is coloured by its most likely FluSight rate-change category
// (large decrease .. large increase), stronger the more likely it is
// (opacity 0.55 + 0.45 p). The chances come from data/forecasts.json
// (cat_probs, built by scripts/build_forecasts.py) and the outlines from
// data/us-states.json (scripts/build_us_map.py).
//
// Selection is an accent outline, never a fill, so the category colour
// stays readable. Ctrl/Cmd + scroll zooms (plain scroll scrolls the page),
// drag pans, double-click resets. Each state is a button for the keyboard
// too (Tab, then Enter or Space).
(function () {
  "use strict";
  var NS = "http://www.w3.org/2000/svg";
  var CATS = ["large decrease", "decrease", "stable", "increase", "large increase"];
  var POSTAL = { "01": "AL", "02": "AK", "04": "AZ", "05": "AR", "06": "CA", "08": "CO", "09": "CT", "10": "DE",
    "11": "DC", "12": "FL", "13": "GA", "15": "HI", "16": "ID", "17": "IL", "18": "IN", "19": "IA", "20": "KS",
    "21": "KY", "22": "LA", "23": "ME", "24": "MD", "25": "MA", "26": "MI", "27": "MN", "28": "MS", "29": "MO",
    "30": "MT", "31": "NE", "32": "NV", "33": "NH", "34": "NJ", "35": "NM", "36": "NY", "37": "NC", "38": "ND",
    "39": "OH", "40": "OK", "41": "OR", "42": "PA", "44": "RI", "45": "SC", "46": "SD", "47": "TN", "48": "TX",
    "49": "UT", "50": "VT", "51": "VA", "53": "WA", "54": "WV", "55": "WI", "56": "WY", "72": "PR", "US": "US" };
  var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var DAY = 864e5;

  function t(iso) { return Date.parse(iso + "T00:00:00Z"); }
  function short(ms) { var d = new Date(ms); return MON[d.getUTCMonth()] + " " + d.getUTCDate(); }
  function n(v) { return Math.round(v).toLocaleString("en-US"); }
  function svgEl(name, attrs, parent) {
    var e = document.createElementNS(NS, name);
    for (var a in attrs) e.setAttribute(a, attrs[a]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function h(tag, cls, text, parent) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    if (parent) parent.appendChild(e);
    return e;
  }

  // the colourblind-safe scale is a per-viewer choice, kept in this browser
  function cvdOn() { try { return localStorage.getItem("map-cvd") === "1"; } catch (e) { return false; } }
  function setCvd(on) {
    try { localStorage.setItem("map-cvd", on ? "1" : "0"); } catch (e) { /* private mode: this page only */ }
    document.documentElement.classList.toggle("map-cvd", on);
    document.querySelectorAll("input.map-cvd").forEach(function (i) { i.checked = on; });
  }

  // One state's view for (model, round, horizon): the modal category and
  // its chance, plus the hover lines, in the words FluBNF's hovers use.
  function cards(D, model, round, hz) {
    var out = {}, byLoc = ((D.cat_probs || {})[model] || {})[round] || {};
    var fc = ((D.forecasts[model] || {})[round]) || {};
    var baseDay = new Date(t(round) - 7 * DAY).toISOString().slice(0, 10);
    var bi = D.obs_dates.indexOf(baseDay);
    var target = short(t(round) + hz * 7 * DAY);
    D.locations.forEach(function (l) {
      var p = (byLoc[l.id] || [])[hz];
      var q = (fc[l.id] || [])[hz];
      if (!p) { out[l.id] = { cat: -1, name: l.name }; return; }
      var best = 0;
      p.forEach(function (v, i) { if (v > p[best]) best = i; });
      var base = bi >= 0 ? (D.observed[l.id] || [])[bi] : null;
      out[l.id] = { cat: best, p: p[best] / 100, probs: p, name: l.name,
        base: base, baseDay: short(t(baseDay)), median: q ? q[2] : null, target: target };
    });
    return out;
  }

  function label(c) {
    return c.cat < 0 ? c.name + ": no forecast from this model this round"
      : c.name + ": " + CATS[c.cat] + " " + Math.round(c.p * 100) + "%";
  }

  function fillHover(tip, c, hint) {
    tip.textContent = "";
    h("b", null, c.name, tip);
    if (c.cat < 0) { h("div", "muted", "no forecast from this model this round", tip); return; }
    if (c.base != null) h("div", null, "week ending " + c.baseDay + ": " + n(c.base), tip);
    if (c.median != null) h("div", null, "median, week ending " + c.target + ": " + n(c.median), tip);
    var ul = h("ul", "cat-rows", null, tip);
    c.probs.forEach(function (v, i) {
      var li = h("li", i === c.cat ? "top" : null, null, ul);
      h("span", "sw c" + i, null, li);
      h("span", null, CATS[i], li);
      h("span", "pct", v + "%", li);
    });
    if (hint) h("div", "muted hint-line", hint, tip);
  }

  // geo: data/us-states.json. opts.onPick(fips) runs on click or Enter;
  // opts.hint is a last hover line ("click for ..."); opts.pressed marks the
  // selected state aria-pressed (a picker rather than links).
  function USMap(host, geo, opts) {
    opts = opts || {};
    var VB = geo.viewBox.slice(), vb = VB.slice();
    var wrap = h("div", "usmap-wrap", null, host);
    var svg = svgEl("svg", { viewBox: VB.join(" "), class: "usmap", role: "group",
      "aria-label": opts.label || "Map of the states" }, wrap);
    var tip = h("div", "usmap-tip", null, wrap);
    tip.hidden = true;
    var paths = {}, data = {};
    // by name: the order Tab walks the states
    Object.keys(geo.states).sort(function (a, b) { return geo.states[a][0] < geo.states[b][0] ? -1 : 1; })
      .forEach(function (f) {
        paths[f] = svgEl("path", { d: geo.states[f][1], "data-fips": f, class: "st nd",
          role: "button", tabindex: "0", "aria-label": geo.states[f][0] }, svg);
      });

    function paint(c, selected) {
      data = c;
      Object.keys(paths).forEach(function (f) {
        var p = paths[f], d = c[f] || { cat: -1, name: geo.states[f][0] };
        p.setAttribute("class", "st " + (d.cat < 0 ? "nd" : "c" + d.cat) + (f === selected ? " sel" : ""));
        p.setAttribute("fill-opacity", d.cat < 0 ? 1 : (0.55 + 0.45 * d.p).toFixed(2));
        p.setAttribute("aria-label", label(d));
        if (opts.pressed) p.setAttribute("aria-pressed", String(f === selected));
        if (f === selected) svg.appendChild(p);   // the ring above its neighbours
      });
    }

    // ---- zoom and pan (FluBNF's: clamp so ~20% of the map stays in view) ----
    function apply() { svg.setAttribute("viewBox", vb.join(" ")); wrap.classList.toggle("zoomed", vb[2] < VB[2]); }
    function clamp() {
      if (vb[2] >= VB[2]) { vb = VB.slice(); return; }
      vb[0] = Math.min(Math.max(vb[0], VB[0] - vb[2] * 0.8), VB[0] + VB[2] - vb[2] * 0.2);
      vb[1] = Math.min(Math.max(vb[1], VB[1] - vb[3] * 0.8), VB[1] + VB[3] - vb[3] * 0.2);
    }
    function toSvg(ev) {
      var r = svg.getBoundingClientRect();
      return [vb[0] + (ev.clientX - r.left) / r.width * vb[2], vb[1] + (ev.clientY - r.top) / r.height * vb[3]];
    }
    svg.addEventListener("wheel", function (ev) {
      if (!ev.ctrlKey && !ev.metaKey) return;      // plain scroll keeps scrolling the page
      ev.preventDefault();
      var s = toSvg(ev), f = ev.deltaY > 0 ? 1.25 : 0.8;
      f = Math.min(Math.max(vb[2] * f, VB[2] / 40), VB[2]) / vb[2];
      vb = [s[0] - (s[0] - vb[0]) * f, s[1] - (s[1] - vb[1]) * f, vb[2] * f, vb[3] * f];
      clamp(); apply();
    }, { passive: false });
    var down = null, start = null, dist = 0;
    svg.addEventListener("mousedown", function (ev) {
      if (ev.button !== 0) return;
      down = [ev.clientX, ev.clientY]; start = down.slice(); dist = 0;
    });
    addEventListener("mousemove", function (ev) {
      if (!down) return;
      dist = Math.max(dist, Math.hypot(ev.clientX - start[0], ev.clientY - start[1]));
      if (vb[2] >= VB[2]) return;                    // nothing to pan at full extent
      var r = svg.getBoundingClientRect();
      vb[0] -= (ev.clientX - down[0]) * vb[2] / r.width;
      vb[1] -= (ev.clientY - down[1]) * vb[3] / r.height;
      down = [ev.clientX, ev.clientY];
      clamp(); apply();
      if (dist >= 5) tip.hidden = true;
    });
    addEventListener("mouseup", function () { down = null; });
    var timer = null;
    svg.addEventListener("dblclick", function (ev) {
      clearTimeout(timer); ev.preventDefault(); vb = VB.slice(); apply();
    });

    // ---- hover card ----
    function place(x, y) {
      var r = wrap.getBoundingClientRect(), tw = tip.offsetWidth, th = tip.offsetHeight;
      var px = x - r.left + 14, py = y - r.top + 14;
      if (px + tw > r.width) px = Math.max(4, x - r.left - tw - 14);
      if (py + th > r.height) py = Math.max(4, y - r.top - th - 14);
      tip.style.left = px + "px"; tip.style.top = py + "px";
    }
    function show(p) {
      var d = data[p.dataset.fips];
      if (!d) { tip.hidden = true; return false; }
      fillHover(tip, d, opts.hint); tip.hidden = false; return true;
    }
    svg.addEventListener("mousemove", function (ev) {
      if (down && dist >= 5) return;
      var p = ev.target.closest && ev.target.closest("path[data-fips]");
      if (!p) { tip.hidden = true; return; }
      if (show(p)) place(ev.clientX, ev.clientY);
    });
    svg.addEventListener("mouseleave", function () { tip.hidden = true; });
    svg.addEventListener("focusin", function (ev) {
      var p = ev.target.closest && ev.target.closest("path[data-fips]");
      if (!p || !show(p)) return;
      var b = p.getBoundingClientRect();
      place(b.right - 8, b.top);
    });
    svg.addEventListener("focusout", function () { tip.hidden = true; });

    // ---- pick ----
    function pick(f) { if (opts.onPick) opts.onPick(f); }
    svg.addEventListener("click", function (ev) {
      if (dist >= 5) return;                         // that was a drag
      var p = ev.target.closest && ev.target.closest("path[data-fips]");
      if (!p) return;
      clearTimeout(timer);
      timer = setTimeout(function () { pick(p.dataset.fips); }, 250);   // a double-click resets instead
    });
    svg.addEventListener("keydown", function (ev) {
      if (ev.key !== "Enter" && ev.key !== " ") return;
      var p = ev.target.closest && ev.target.closest("path[data-fips]");
      if (!p) return;
      ev.preventDefault(); pick(p.dataset.fips);
    });

    return { paint: paint, svg: svg };
  }

  // The key under every map: five categories, no forecast, and the
  // colourblind-safe switch.
  USMap.legend = function (host) {
    host.textContent = "";
    host.classList.add("map-legend");
    CATS.forEach(function (c, i) { var s = h("span", null, null, host); h("span", "sw c" + i, null, s); s.appendChild(document.createTextNode(c)); });
    var s = h("span", null, null, host); h("span", "sw nd", null, s); s.appendChild(document.createTextNode("no forecast"));
    var lab = h("label", "cvd-switch", null, host);
    var box = h("input", "map-cvd", null, lab);
    box.type = "checkbox"; box.checked = cvdOn();
    box.addEventListener("change", function () { setCvd(box.checked); });
    lab.appendChild(document.createTextNode("Colorblind-safe colors"));
  };

  if (cvdOn()) document.documentElement.classList.add("map-cvd");
  USMap.cards = cards;
  USMap.CATS = CATS;
  USMap.POSTAL = POSTAL;
  window.USMap = USMap;
})();
