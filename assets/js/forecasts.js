// Forecast chart for forecasts.html. Reads data/forecasts.json (built by
// scripts/build_forecasts.py) and draws the 0-3 week ahead fans of each
// selected model against observed NHSN admissions. Plain SVG, no library.
//
// Two views: one round (with its 50%/95% intervals), or every round of the
// season at once (each round's median; intervals for the latest round only).
// Recent weeks or the whole season; last season's admissions for the same
// weeks as a dotted line; linear or log scale. Everything chosen is kept in the link
// (forecasts.html#loc=AZ&view=all&scale=log ...). The rate-change map
// (assets/js/usmap.js, after FluBNF's) doubles as the location picker.
(function () {
  "use strict";

  var SERIES = {
    "NAU_PyBNF-OracleSIHRS": { color: "var(--s-oracle)", on: true },
    "NAU_PyBNF-GroundHogCGR": { color: "var(--s-groundhog)", on: true },
    "FluSight-ensemble": { color: "var(--s-ensemble)", on: false },
    "FluSight-baseline": { color: "var(--s-baseline)", on: false, dashed: true }
  };
  var RECENT = 6;   // observed weeks shown before the reference date in the "Recent" window
  var DAY = 864e5, WEEK = 7 * DAY;
  var NS = "http://www.w3.org/2000/svg";

  // FIPS code -> postal code (links use postal codes; old FIPS links still work)
  var POSTAL = window.USMap.POSTAL;
  // map models: link key -> hub model ID
  var MAPM = { oracle: "NAU_PyBNF-OracleSIHRS", groundhog: "NAU_PyBNF-GroundHogCGR",
    ensemble: "FluSight-ensemble", baseline: "FluSight-baseline" };
  var MAPM_SHORT = { oracle: "Oracle SIHRS", groundhog: "Groundhog", ensemble: "Ensemble", baseline: "Baseline" };

  var D, GEO, map, chartSvg, state = {}, rounds = [];
  var $ = function (id) { return document.getElementById(id); };

  // ---------- helpers ----------
  function t(iso) { return Date.parse(iso + "T00:00:00Z"); }
  function iso(ms) { return new Date(ms).toISOString().slice(0, 10); }
  var MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  function short(ms) { var d = new Date(ms); return MON[d.getUTCMonth()] + " " + d.getUTCDate(); }
  function long(ms) { var d = new Date(ms); return MON[d.getUTCMonth()] + " " + d.getUTCDate() + ", " + d.getUTCFullYear(); }
  function fmt(v) {
    if (v == null) return "–";
    return v < 10 ? (Math.round(v * 10) / 10).toString() : Math.round(v).toLocaleString("en-US");
  }
  function kfmt(v) { return v >= 1000 ? (v / 1000).toLocaleString("en-US") + "k" : fmt(v); }
  function el(tag, attrs, parent) {
    var n = document.createElementNS(NS, tag);
    for (var k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }
  function niceStep(max, n) {
    var raw = max / n, p = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / p;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
  }
  function label(id) { return D.models[id] ? D.models[id].label : id; }
  function locName(id) {
    for (var i = 0; i < D.locations.length; i++) if (D.locations[i].id === id) return D.locations[i].id === "US" ? "United States" : D.locations[i].name;
    return id;
  }
  function fipsFor(code) {
    if (!code) return null;
    code = code.toUpperCase();
    if (D.observed[code]) return code;               // already FIPS (or "US")
    for (var f in POSTAL) if (POSTAL[f] === code && D.observed[f]) return f;
    return null;
  }
  function prevLabel() {
    var y = +D.obs_dates[0].slice(0, 4) - 1;
    return "Last season (" + y + "–" + String(y + 1).slice(2) + ")";
  }
  function onModels() { return Object.keys(SERIES).filter(function (m) { return state.on[m] && D.models[m]; }); }

  // ---------- link state ----------
  // Only choices that differ from the defaults go in the link, so the plain
  // page stays forecasts.html. Example: #loc=AZ&view=all&scale=log
  function readHash() {
    var p = new URLSearchParams(location.hash.slice(1));
    return { loc: p.get("loc"), round: p.get("round"), models: p.get("models"),
      view: p.get("view"), scale: p.get("scale"), bands: p.get("bands"),
      map: p.get("map"), week: p.get("week"), span: p.get("span"), prev: p.get("prev") };
  }
  function linkParams() {
    var p = new URLSearchParams();
    if (state.loc !== "US") p.set("loc", POSTAL[state.loc] || state.loc);
    if (state.view === "all") p.set("view", "all");
    else if (state.round !== rounds[0]) p.set("round", state.round);
    if (state.span === "season") p.set("span", "season");
    var on = onModels(), def = Object.keys(SERIES).filter(function (m) { return SERIES[m].on && D.models[m]; });
    if (on.join() !== def.join()) p.set("models", on.join(",") || "none");
    if (state.log) p.set("scale", "log");
    if (!(state.i50 && state.i95)) p.set("bands", [state.i50 ? "50" : "", state.i95 ? "95" : ""].filter(Boolean).join(",") || "none");
    if (!state.prev && D.last_season) p.set("prev", "0");
    if (state.mapM !== "oracle") p.set("map", state.mapM);
    if (state.mapH) p.set("week", String(state.mapH));
    return p.toString();
  }
  function writeHash() {
    var h = linkParams();
    history.replaceState(null, "", h ? "#" + h : location.pathname + location.search);
  }
  function applyHash() {
    var h = readHash();
    state.loc = fipsFor(h.loc) || "US";
    state.view = h.view === "all" ? "all" : "round";
    state.round = h.round && rounds.indexOf(h.round) >= 0 ? h.round : rounds[0];
    state.span = h.span === "season" ? "season" : "recent";
    state.prev = h.prev !== "0";
    var wanted = h.models ? h.models.split(",") : null;
    state.on = {};
    Object.keys(SERIES).forEach(function (m) { state.on[m] = wanted ? wanted.indexOf(m) >= 0 : SERIES[m].on; });
    state.log = h.scale === "log";
    var b = h.bands == null ? ["50", "95"] : h.bands.split(",");
    state.i50 = b.indexOf("50") >= 0; state.i95 = b.indexOf("95") >= 0;
    state.mapM = MAPM[h.map] && D.models[MAPM[h.map]] ? h.map : "oracle";
    state.mapH = /^[0-3]$/.test(h.week || "") ? +h.week : 0;
  }

  // ---------- data for the current selection ----------
  function rowsFor(m, r) { return (((D.forecasts[m] || {})[r]) || {})[state.loc]; }
  function points(rows, rms) {
    var pts = [];
    (rows || []).forEach(function (q, h) { if (q) pts.push({ x: rms + h * WEEK, h: h, q: q }); });
    return pts;
  }
  function current() {
    var all = state.view === "all";
    var latest = all ? rounds[0] : state.round;
    var r = t(latest);
    var x1 = r + 3 * WEEK;
    var x0 = state.span === "season" ? t(D.obs_dates[0]) : Math.max(r - RECENT * WEEK, t(D.obs_dates[0]));
    var obs = D.observed[state.loc] || [], o = [];
    D.obs_dates.forEach(function (d, i) {
      var ms = t(d);
      if (ms >= x0 && ms <= x1 && obs[i] != null) o.push({ x: ms, y: obs[i], after: !all && ms >= r });
    });
    var runs = [], missing = [];
    onModels().forEach(function (m) {
      var list = all ? rounds.slice().reverse() : [state.round], any = false;
      list.forEach(function (rd) {
        if (t(rd) < x0) return;   // all rounds, recent window: rounds inside the window only
        var pts = points(rowsFor(m, rd), t(rd));
        if (pts.length) { runs.push({ id: m, round: rd, pts: pts, latest: rd === latest }); any = true; }
      });
      if (!any) missing.push(m);
    });
    var prev = [], L = D.last_season;
    if (state.prev && L && L.observed[state.loc]) L.dates.forEach(function (d, i) {
      var ms = t(d), v = L.observed[state.loc][i];
      if (ms >= x0 && ms <= x1 && v != null) prev.push({ x: ms, y: v });
    });
    return { all: all, r: r, x0: x0, x1: x1, obs: o, prev: prev, runs: runs, missing: missing };
  }

  // ---------- y scale: linear, or log of (value + 1) so zero weeks still plot ----------
  function yScale(ymax, top, ih, narrow) {
    if (!state.log) {
      var step = niceStep(ymax, narrow ? 4 : 5), ytop = Math.ceil((ymax * 1.04) / step) * step, ticks = [];
      for (var v = 0; v <= ytop + 1e-9; v += step) ticks.push(v);
      return { f: function (x) { return top + ih - (x / ytop) * ih; }, ticks: ticks };
    }
    var steps = [0, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1e3, 2e3, 5e3, 1e4, 2e4, 5e4, 1e5, 2e5, 5e5];
    var hi = steps.filter(function (s) { return s >= ymax * 1.04; })[0] || steps[steps.length - 1];
    var ticks = steps.filter(function (s) { return s <= hi; });
    if (ticks.length > (narrow ? 6 : 9)) {
      // too many: keep 0, 1, 10, 100...; label the top too unless it sits right above one of those
      ticks = ticks.filter(function (s) { return s === 0 || /^1(0*)$/.test(String(s)); });
      if (hi / ticks[ticks.length - 1] >= 4) ticks.push(hi);
    }
    var L = Math.log10(hi + 1);
    return { f: function (x) { return top + ih - (Math.log10(Math.max(0, x) + 1) / L) * ih; }, ticks: ticks };
  }

  // ---------- chart ----------
  // Layers, bottom to top: grid, last season, interval bands (95% band
  // outlined so two models' bands stay apart), observed line, medians (each
  // with a ring of the chart's background so one never hides another),
  // observed dots, then labels. `anim` reveals the fans from the reference
  // line after a change of place, round or view (not on resize).
  function render(anim) {
    var wrap = $("fc-chart");
    var c = current();
    wrap.innerHTML = "";
    var ws = getComputedStyle(wrap);
    var W = Math.max(280, Math.round(wrap.clientWidth - parseFloat(ws.paddingLeft) - parseFloat(ws.paddingRight)));
    var narrow = W < 560;
    var H = narrow ? 320 : Math.round(Math.min(560, Math.max(420, W * 0.36)));
    var m = { t: 16, r: narrow ? 12 : 112, b: 30, l: narrow ? 44 : 56 };
    var iw = W - m.l - m.r, ih = H - m.t - m.b;

    if (!c.obs.length && !c.runs.length) {
      wrap.innerHTML = '<p class="empty">No data for this location and round.</p>';
      renderLegend(c); renderTable(c); renderNote(c); return;
    }

    var ymax = 0;
    c.obs.forEach(function (o) { ymax = Math.max(ymax, o.y); });
    c.prev.forEach(function (o) { ymax = Math.max(ymax, o.y); });
    c.runs.forEach(function (f) {
      var bands = !c.all || f.latest;
      f.pts.forEach(function (p) { ymax = Math.max(ymax, bands && state.i95 ? p.q[4] : bands && state.i50 ? p.q[3] : p.q[2]); });
    });
    ymax = ymax || 1;
    var ys = yScale(ymax, m.t, ih, narrow), Y = ys.f;
    var pad = 3.5 * DAY;
    var X = function (ms) { return m.l + ((ms - (c.x0 - pad)) / (c.x1 + pad - (c.x0 - pad))) * iw; };

    var svg = el("svg", { viewBox: "0 0 " + W + " " + H, width: W, height: H, role: "img",
      "aria-label": "Weekly influenza hospital admissions, " + locName(state.loc) +
        (c.all ? ", every forecast round" : ", forecast round " + long(c.r)) +
        (state.span === "season" ? ", whole season" : ", recent weeks") +
        (state.log ? ", log scale" : "") });
    chartSvg = svg;

    // grid + y axis
    var g = el("g", { class: "grid" }, svg), ax = el("g", { class: "axis" }, svg);
    ys.ticks.forEach(function (v) {
      el("line", { x1: m.l, x2: m.l + iw, y1: Y(v), y2: Y(v) }, g);
      var tx = el("text", { x: m.l - 8, y: Y(v) + 4, "text-anchor": "end" }, ax);
      tx.textContent = kfmt(v);
    });
    el("line", { class: "base", x1: m.l, x2: m.l + iw, y1: Y(0), y2: Y(0) }, ax);
    // x ticks: every week in the recent window, else every 2 weeks (4 when narrow or for all rounds)
    var span = Math.round((c.x1 - c.x0) / WEEK);
    var every = span <= 10 && !narrow ? 1 : narrow || (c.all && span > 10) ? 4 : 2;
    if (narrow && span <= 10) every = 2;
    var weeks = [];
    for (var w = c.r + 3 * WEEK; w >= c.x0; w -= WEEK) weeks.unshift(w);
    weeks.forEach(function (ms) {
      if (Math.round((c.r - ms) / WEEK) % every !== 0) return;
      var xt = el("text", { x: X(ms), y: m.t + ih + 20, "text-anchor": "middle" }, ax);
      xt.textContent = short(ms);
    });
    // reference date marker (the latest round in the all-rounds view)
    var rx = X(c.r - pad);
    el("line", { class: "refline", x1: rx, x2: rx, y1: m.t, y2: m.t + ih }, svg);
    var rl = el("text", { class: "reflabel", x: rx + 6, y: m.t + 10 }, svg);
    rl.textContent = c.all ? "Latest →" : "Forecast →";

    var gPrev = el("g", { class: "fc-prev" }, svg), gBands = el("g", { class: "fc-bands" }, svg),
      gObsLine = el("g", { class: "fc-obs" }, svg), gLines = el("g", { class: "fc-lines" }, svg),
      gObs = el("g", { class: "fc-obs" }, svg);

    // last season, same weeks
    if (c.prev.length > 1) el("polyline", { class: "prev-line", points: c.prev.map(function (o) { return X(o.x) + "," + Y(o.y); }).join(" ") }, gPrev);

    // fans: 95% band, 50% band, median (all-rounds view: older rounds are medians only).
    // Medians of the latest round are spread 6 px apart so equal values stay visible.
    var latest = c.runs.filter(function (f) { return f.latest; });
    function band(gb, f, col, lo, hi, op, edge) {
      if (f.pts.length === 1) { // single horizon: a short bar instead of a polygon
        var p0 = f.pts[0];
        el("rect", { x: X(p0.x) - 6, width: 12, y: Y(p0.q[hi]), height: Math.max(1, Y(p0.q[lo]) - Y(p0.q[hi])), rx: 3,
          style: "fill:" + col + ";opacity:" + op }, gb);
        return;
      }
      var up = f.pts.map(function (p) { return X(p.x) + "," + Y(p.q[hi]); });
      var dn = f.pts.map(function (p) { return X(p.x) + "," + Y(p.q[lo]); });
      el("polygon", { points: up.concat(dn.slice().reverse()).join(" "), style: "fill:" + col + ";opacity:" + op }, gb);
      if (edge) [up, dn].forEach(function (e) { el("polyline", { class: "band-edge", points: e.join(" "), style: "stroke:" + col }, gb); });
    }
    c.runs.forEach(function (f) {
      var s = SERIES[f.id], old = c.all && !f.latest;
      var dx = f.latest && latest.length > 1 ? (latest.indexOf(f) - (latest.length - 1) / 2) * 6 : 0;
      if (!old && (state.i95 || state.i50)) {
        var gb = el("g", { "data-model": f.id }, gBands);
        if (state.i95) band(gb, f, s.color, 0, 4, 0.12, true);
        if (state.i50) band(gb, f, s.color, 1, 3, 0.26, false);
      }
      var gl = el("g", { "data-model": f.id, "data-round": f.round, class: old ? "past-run" : "" }, gLines);
      var pts = f.pts.map(function (p) { return (X(p.x) + dx) + "," + Y(p.q[2]); }).join(" ");
      if (!old) el("polyline", { class: "halo", points: pts }, gl);
      el("polyline", { points: pts,
        style: "fill:none;stroke:" + s.color + ";stroke-width:" + (old ? 1.5 : 2.25) + ";stroke-linejoin:round;stroke-linecap:round" +
          (old ? ";opacity:.6" : "") + (s.dashed ? ";stroke-dasharray:5 3" : "") }, gl);
      f.pts.forEach(function (p) {
        el("circle", { cx: X(p.x) + dx, cy: Y(p.q[2]), r: old ? 2.5 : 4,
          style: "fill:" + s.color + ";stroke:var(--chart-surface);stroke-width:" + (old ? 1 : 2) + (old ? ";opacity:.75" : "") }, gl);
      });
    });

    // observed
    if (c.obs.length > 1) el("polyline", { class: "obs-line", points: c.obs.map(function (o) { return X(o.x) + "," + Y(o.y); }).join(" ") }, gObsLine);
    c.obs.forEach(function (o) { el("circle", { class: "obs-dot" + (o.after ? " later" : ""), cx: X(o.x), cy: Y(o.y), r: 4 }, gObs); });

    // the latest observed week, labelled in words
    var known = c.obs.filter(function (o) { return !o.after; });
    var lo = known[known.length - 1], pv = known[known.length - 2];
    if (lo) {
      var ay = pv && pv.y > lo.y ? Y(lo.y) + 20 : Y(lo.y) - 26;
      if (ay < m.t + 12) ay = Y(lo.y) + 20;
      if (ay + 14 > m.t + ih - 4) ay = Y(lo.y) - 26;
      var right = X(lo.x) - m.l < 150;   // no room on the left: write it to the right
      var axx = X(lo.x) + (right ? 9 : -9);
      var an = el("text", { class: "anno", x: axx, y: ay, "text-anchor": right ? "start" : "end" }, svg);
      var t1 = el("tspan", { class: "v" }, an);
      t1.textContent = fmt(lo.y) + (lo.y === 1 ? " admission" : " admissions");
      var t2 = el("tspan", { x: axx, dy: 14 }, an);
      t2.textContent = "week ending " + short(lo.x);
    }

    // direct labels in the right margin (wide only), nudged apart: each model's
    // median, the first model's 95% and 50% ranges, and last season
    if (!narrow) {
      var lx = X(c.x1) + 12, items = [];
      latest.forEach(function (f) {
        var p = f.pts[f.pts.length - 1];
        items.push({ ty: Y(p.q[2]), text: label(f.id), model: f.id, px: X(p.x) });
      });
      if (latest[0]) {
        var lp = latest[0].pts[latest[0].pts.length - 1];
        if (state.i95) items.push({ ty: Y(lp.q[4]), text: "95% range", cls: "band-lab", px: X(lp.x), lead: true });
        if (state.i50) items.push({ ty: Y(lp.q[3]), text: "50% range", cls: "band-lab", px: X(lp.x), lead: true });
      }
      if (c.prev.length) {
        var lq = c.prev[c.prev.length - 1];
        items.push({ ty: Y(lq.y), text: "Last season", cls: "prev-lab", px: X(lq.x), lead: true });
      }
      items.forEach(function (l) { l.y = l.ty + 4; });
      items.sort(function (a, b) { return a.y - b.y; });
      for (var i = 1; i < items.length; i++) if (items[i].y - items[i - 1].y < 15) items[i].y = items[i - 1].y + 15;
      var floor = m.t + ih + 4; // keep the stack inside the plot
      for (var j = items.length - 1; j >= 0; j--) {
        var cap = j === items.length - 1 ? floor : items[j + 1].y - 15;
        if (items[j].y > cap) items[j].y = cap;
      }
      items.forEach(function (l) {
        if (l.lead && (Math.abs(l.y - 4 - l.ty) > 2 || l.px < lx - 14))
          el("polyline", { class: "lead", points: (l.px + 4) + "," + l.ty + " " + (lx - 8) + "," + l.ty + " " + (lx - 3) + "," + (l.y - 4) }, svg);
        var tl = el("text", { class: "dlabel" + (l.cls ? " " + l.cls : ""), x: lx, y: l.y }, svg);
        tl.textContent = l.text;
        if (l.model) {
          tl.setAttribute("data-model", l.model);
          tl.addEventListener("pointerenter", function () { focusModel(l.model); });
          tl.addEventListener("pointerleave", function () { focusModel(null); });
        }
      });
    }

    // hover layer: crosshair + tooltip snapped to the nearest week
    var cross = el("line", { class: "crosshair no-export", y1: m.t, y2: m.t + ih, visibility: "hidden" }, svg);
    var hit = el("rect", { class: "no-export", x: m.l, y: m.t, width: iw, height: ih, fill: "transparent", style: "cursor:crosshair" }, svg);
    var tip = document.createElement("div");
    tip.className = "tooltip"; tip.hidden = true;
    wrap.appendChild(svg); wrap.appendChild(tip);
    if (anim && !matchMedia("(prefers-reduced-motion: reduce)").matches) svg.classList.add("enter");
    focusModel(state.focus);

    function show(ev) {
      var box = svg.getBoundingClientRect(), wb = wrap.getBoundingClientRect(), sx = (ev.clientX - box.left) * (W / box.width);
      var best = weeks[0], bd = Infinity;
      weeks.forEach(function (wk) { var d = Math.abs(X(wk) - sx); if (d < bd) { bd = d; best = wk; } });
      var rows = "", o = c.obs.filter(function (q) { return q.x === best; })[0];
      if (o) rows += '<tr><td><span class="key" style="background:var(--obs);border-radius:50%"></span>Observed</td><td>' + fmt(o.y) + "</td></tr>";
      var lq = c.prev.filter(function (q) { return q.x === best; })[0];
      if (lq) rows += '<tr><td><span class="key prev"></span>Last season <span class="rng">' +
        long(best - D.last_season.shift_days * DAY) + "</span></td><td>" + fmt(lq.y) + "</td></tr>";
      c.runs.forEach(function (f) {
        var p = f.pts.filter(function (q) { return q.x === best; })[0];
        if (!p) return;
        var bands = !c.all || f.latest;
        rows += '<tr><td><span class="key" style="background:' + SERIES[f.id].color + '"></span>' + label(f.id) +
          ' <span class="rng">' + (c.all ? short(t(f.round)) + " round, " : "") + "h" + p.h + "</span></td><td>" + fmt(p.q[2]) + "</td></tr>";
        if (bands && (state.i50 || state.i95)) rows += '<tr><td colspan="2" class="rng" style="text-align:right">' +
          (state.i50 ? "50%: " + fmt(p.q[1]) + "–" + fmt(p.q[3]) : "") + (state.i50 && state.i95 ? " · " : "") +
          (state.i95 ? "95%: " + fmt(p.q[0]) + "–" + fmt(p.q[4]) : "") + "</td></tr>";
      });
      if (!rows) { hide(); return; }
      cross.setAttribute("x1", X(best)); cross.setAttribute("x2", X(best)); cross.setAttribute("visibility", "visible");
      tip.innerHTML = '<div class="tt-date">Week ending ' + long(best) + "</div><table>" + rows + "</table>";
      tip.hidden = false;
      var px = (X(best) / W) * box.width, tw = tip.offsetWidth;
      var left = px + 14 + tw > box.width ? px - 14 - tw : px + 14;
      tip.style.left = (box.left - wb.left) + Math.max(0, left) + "px";
      tip.style.top = (box.top - wb.top) + Math.max(0, (ev.clientY - box.top) - tip.offsetHeight / 2) + "px";
    }
    function hide() { tip.hidden = true; cross.setAttribute("visibility", "hidden"); }
    hit.addEventListener("pointermove", show);
    hit.addEventListener("pointerdown", show);
    hit.addEventListener("pointerleave", hide);

    renderLegend(c); renderTable(c); renderNote(c);
  }

  // Hovering a model (its chip above the chart or its label on the chart)
  // fades the other models so its own fan stands out.
  function focusModel(id) {
    state.focus = id || null;
    if (!chartSvg) return;
    chartSvg.classList.toggle("focusing", !!state.focus);
    chartSvg.querySelectorAll("[data-model]").forEach(function (n) {
      n.classList.toggle("is-focus", n.getAttribute("data-model") === state.focus);
    });
  }

  function renderLegend(c) {
    var html = '<li><svg class="k" width="14" height="10"><circle cx="7" cy="5" r="4" fill="var(--obs)"/></svg>Observed (NHSN)</li>' +
      (c.obs.some(function (o) { return o.after; }) ? '<li><svg class="k" width="14" height="10"><circle cx="7" cy="5" r="3.5" fill="none" stroke="var(--obs)" stroke-width="1.5"/></svg>Observed after the reference date</li>' : '') +
      (c.prev.length ? '<li><svg class="k" width="22" height="10"><line x1="2" x2="20" y1="5" y2="5" stroke="var(--muted)" stroke-width="2" stroke-linecap="round" stroke-dasharray="0.1 4"/></svg>' + prevLabel() + ", same weeks</li>" : "") +
      '<li><svg class="k" width="22" height="10"><line x1="1" x2="21" y1="5" y2="5" stroke="var(--muted)" stroke-width="2"/><circle cx="11" cy="5" r="3" fill="var(--muted)"/></svg>Median, horizons 0–3' + (c.all ? ", latest round" : "") + '</li>';
    if (c.all) html += '<li><svg class="k" width="22" height="10"><line x1="1" x2="21" y1="5" y2="5" stroke="var(--muted)" stroke-width="1.5" opacity=".6"/><circle cx="11" cy="5" r="2.5" fill="var(--muted)" opacity=".75"/></svg>Earlier rounds</li>';
    if (state.i50) html += '<li><svg class="k" width="16" height="10"><rect width="16" height="10" rx="2" fill="var(--muted)" opacity=".4"/></svg>50% interval</li>';
    if (state.i95) html += '<li><svg class="k" width="16" height="10"><rect width="16" height="10" rx="2" fill="var(--muted)" opacity=".2"/></svg>95% interval</li>';
    if (state.log) html += '<li class="scale-note">Log scale</li>';
    $("fc-legend").innerHTML = html;
  }

  function renderNote(c) {
    var parts = [];
    if (c.missing.length) parts.push(c.missing.map(label).join(", ") + ": no forecast for " + locName(state.loc) + (c.all ? " this season." : " in this round."));
    if (c.all) parts.push("Observed values are the latest reported, which can be revised after a forecast is made.");
    if (state.log) parts.push("Log scale: equal steps are equal ratios (each value plotted as value + 1, so weeks with zero admissions still show).");
    parts.push('Data: <a href="' + D.source + '">cdcepi/FluSight-forecast-hub</a>, target “' + D.target + '”, updated ' + D.generated.slice(0, 10) + ".");
    $("fc-note").innerHTML = parts.join(" ");
  }

  function renderTable(c) {
    var cols = onModels().filter(function (id) { return c.runs.some(function (f) { return f.id === id; }); });
    var list = c.all ? rounds : [state.round];
    var L = c.prev.length ? D.last_season : null, last = {};
    if (L) L.dates.forEach(function (d, i) { last[d] = L.observed[state.loc][i]; });
    var html = '<table class="data"><thead><tr>' + (c.all ? "<th>Round</th>" : "") + '<th>Week ending</th><th>Horizon</th><th>Observed</th>' +
      (L ? "<th>Last season</th>" : "");
    cols.forEach(function (id) { html += "<th>" + label(id) + " median</th><th>50%</th><th>95%</th>"; });
    html += "</tr></thead><tbody>";
    list.forEach(function (rd) {
      for (var h = 0; h <= 3; h++) {
        var x = t(rd) + h * WEEK, o = c.obs.filter(function (q) { return q.x === x; })[0];
        html += "<tr>" + (c.all ? "<td>" + short(t(rd)) + "</td>" : "") + "<td>" + long(x) + "</td><td>" + h + "</td><td>" + (o ? fmt(o.y) : "–") + "</td>" +
          (L ? "<td>" + fmt(last[iso(x)]) + "</td>" : "");
        cols.forEach(function (id) {
          var f = c.runs.filter(function (r) { return r.id === id && r.round === rd; })[0];
          var p = f && f.pts.filter(function (q) { return q.h === h; })[0];
          html += p ? "<td>" + fmt(p.q[2]) + "</td><td>" + fmt(p.q[1]) + "–" + fmt(p.q[3]) + "</td><td>" + fmt(p.q[0]) + "–" + fmt(p.q[4]) + "</td>"
                    : "<td>–</td><td>–</td><td>–</td>";
        });
        html += "</tr>";
      }
    });
    $("fc-table").innerHTML = html + "</tbody></table>";
  }

  // ---------- CSV of what the chart shows ----------
  function csv() {
    var c = current();
    var obs = {};
    D.obs_dates.forEach(function (d, i) { obs[d] = (D.observed[state.loc] || [])[i]; });
    var head = ["location", "location_name", "model_id", "reference_date", "horizon", "target_end_date"]
      .concat(D.quantiles.map(function (q) { return "q" + q; }), ["observed"]);
    var lines = [head.join(",")];
    c.runs.forEach(function (f) {
      f.pts.forEach(function (p) {
        var target = iso(p.x), o = obs[target];
        lines.push([POSTAL[state.loc] || state.loc, '"' + locName(state.loc) + '"', f.id, f.round, p.h, target]
          .concat(p.q, [o == null ? "" : o]).join(","));
      });
    });
    return lines.join("\n") + "\n";
  }
  function download() {
    var name = "flubnf-forecasts-" + (POSTAL[state.loc] || state.loc).toLowerCase() + "-" +
      (state.view === "all" ? "all-rounds" : state.round) + ".csv";
    var url = URL.createObjectURL(new Blob([csv()], { type: "text/csv" }));
    var a = document.createElement("a");
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  // ---------- save the chart as a PNG ----------
  // Copies the chart with its computed colours (so it matches the theme on
  // screen), adds a title, a key and the data source, embeds Inter, and
  // draws it at 2x on a canvas.
  var STYLE_PROPS = ["fill", "fill-opacity", "stroke", "stroke-width", "stroke-opacity", "stroke-dasharray",
    "stroke-linecap", "stroke-linejoin", "opacity", "paint-order", "font-family", "font-size", "font-weight",
    "font-variant-numeric", "visibility"];
  var fontCss = null;
  function getFontCss() {
    if (fontCss != null) return Promise.resolve(fontCss);
    return fetch("assets/fonts/inter-latin.woff2")
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.blob(); })
      .then(function (b) {
        return new Promise(function (res) { var fr = new FileReader(); fr.onload = function () { res(fr.result); }; fr.readAsDataURL(b); });
      })
      .then(function (url) { return (fontCss = '@font-face{font-family:"Inter";font-weight:400 700;src:url(' + url + ') format("woff2")}'); },
        function () { return (fontCss = ""); });
  }
  function xesc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function cssColor(v) {
    var mm = /var\((--[\w-]+)\)/.exec(v);
    return mm ? getComputedStyle(document.documentElement).getPropertyValue(mm[1]).trim() : v;
  }
  function saveBlob(blob, name) {
    var url = URL.createObjectURL(blob), a = document.createElement("a");
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }
  function chartImage() {
    var src = $("fc-chart").querySelector("svg");
    if (!src) return Promise.reject(new Error("no chart"));
    var c = current(), W = +src.getAttribute("width"), H = +src.getAttribute("height");
    var clone = src.cloneNode(true), a = src.querySelectorAll("*"), b = clone.querySelectorAll("*"), gone = [];
    for (var i = 0; i < a.length; i++) {
      if (a[i].classList.contains("no-export")) { gone.push(b[i]); continue; }  // crosshair, hover target
      var cs = getComputedStyle(a[i]);
      b[i].setAttribute("style", STYLE_PROPS.map(function (p) { return p + ":" + cs.getPropertyValue(p); }).join(";"));
      b[i].removeAttribute("class");
    }
    gone.forEach(function (n) { n.remove(); });
    clone.removeAttribute("class");

    var wcs = getComputedStyle($("fc-chart")), root = getComputedStyle(document.documentElement);
    var bg = wcs.backgroundColor, ink = root.getPropertyValue("--ink").trim(), muted = root.getPropertyValue("--muted").trim(),
      ink2 = root.getPropertyValue("--ink-2").trim(), rule = root.getPropertyValue("--rule").trim();
    var P = 28, TOP = 78, TW = Math.max(W + 2 * P, 640);
    var both = state.i50 && state.i95;
    var title = "Weekly influenza hospital admissions · " + locName(state.loc);
    var sub = (c.all ? "Every forecast round, latest " + long(c.r) : "Forecast round of " + long(c.r)) +
      " · median" + (both ? " with 50% and 95% ranges" : state.i50 ? " with 50% range" : state.i95 ? " with 95% range" : "") +
      (state.log ? " · log scale" : "");

    // key, wrapped to the width
    var keys = [{ k: "dot", col: cssColor("var(--obs)"), text: "Observed (NHSN)" }];
    if (c.prev.length) keys.push({ k: "dots", col: muted, text: prevLabel() });
    onModels().forEach(function (id) {
      if (c.runs.some(function (f) { return f.id === id; })) keys.push({ k: "line", col: cssColor(SERIES[id].color), text: label(id), dashed: SERIES[id].dashed });
    });
    var ctx = document.createElement("canvas").getContext("2d");
    ctx.font = "13px Inter, system-ui, sans-serif";
    var kx = P, ky = TOP + H + 30, keySvg = "";
    keys.forEach(function (k) {
      var w = 26 + ctx.measureText(k.text).width + 22;
      if (kx + w > TW - P && kx > P) { kx = P; ky += 22; }
      var mid = ky - 4;
      if (k.k === "dot") keySvg += '<circle cx="' + (kx + 8) + '" cy="' + mid + '" r="4.5" fill="' + k.col + '"/>';
      else if (k.k === "dots") keySvg += '<line x1="' + kx + '" x2="' + (kx + 18) + '" y1="' + mid + '" y2="' + mid + '" stroke="' + k.col + '" stroke-width="2" stroke-linecap="round" stroke-dasharray="0.1 4"/>';
      else keySvg += '<line x1="' + kx + '" x2="' + (kx + 18) + '" y1="' + mid + '" y2="' + mid + '" stroke="' + k.col + '" stroke-width="2.5"' + (k.dashed ? ' stroke-dasharray="5 3"' : "") + '/>' +
        '<circle cx="' + (kx + 9) + '" cy="' + mid + '" r="3.5" fill="' + k.col + '"/>';
      keySvg += '<text x="' + (kx + 26) + '" y="' + ky + '" style="font-size:13px;fill:' + ink2 + '">' + xesc(k.text) + "</text>";
      kx += w;
    });
    var foot = ky + 30, TH = foot + 22;
    var src2 = "Data: CDC FluSight forecast hub (cdcepi/FluSight-forecast-hub), updated " + long(t(D.generated.slice(0, 10))) +
      " · elymiller.com/forecasts.html";

    clone.setAttribute("x", (TW - W) / 2); clone.setAttribute("y", TOP);
    return getFontCss().then(function (font) {
      var out = '<svg xmlns="http://www.w3.org/2000/svg" width="' + TW + '" height="' + TH + '" viewBox="0 0 ' + TW + " " + TH + '">' +
        "<style>" + font + 'text{font-family:Inter,system-ui,sans-serif}</style>' +
        '<rect width="' + TW + '" height="' + TH + '" fill="' + bg + '"/>' +
        '<text x="' + P + '" y="38" style="font-size:20px;font-weight:600;fill:' + ink + '">' + xesc(title) + "</text>" +
        '<text x="' + P + '" y="60" style="font-size:13.5px;fill:' + muted + '">' + xesc(sub) + "</text>" +
        new XMLSerializer().serializeToString(clone) + keySvg +
        '<line x1="' + P + '" x2="' + (TW - P) + '" y1="' + (foot - 16) + '" y2="' + (foot - 16) + '" stroke="' + rule + '"/>' +
        '<text x="' + P + '" y="' + foot + '" style="font-size:11.5px;fill:' + muted + '">' + xesc(src2) + "</text></svg>";
      return new Promise(function (res, rej) {
        var img = new Image();
        img.onload = function () {
          var k = 2, cv = document.createElement("canvas");
          cv.width = TW * k; cv.height = TH * k;
          var cx = cv.getContext("2d");
          cx.scale(k, k); cx.drawImage(img, 0, 0, TW, TH);
          cv.toBlob(function (blob) { blob ? res(blob) : rej(new Error("canvas")); }, "image/png");
        };
        img.onerror = function () { rej(new Error("image")); };
        img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(out);
      });
    });
  }
  function savePng() {
    var name = "flubnf-forecast-" + (POSTAL[state.loc] || state.loc).toLowerCase() + "-" +
      (state.view === "all" ? "all-rounds" : state.round) + ".png";
    chartImage().then(function (blob) { saveBlob(blob, name); },
      function () { if (window.Site) window.Site.say("Could not save the image"); });
  }

  // ---------- rate-change map ----------
  // The map shows the chart's round (the latest one in the all-rounds view).
  function mapRound() { return state.view === "all" ? rounds[0] : state.round; }
  function pickLoc(f) {
    state.loc = f; sync(); update(true);
    // one column (map under the chart): bring the chart back into view
    var c = $("fc-chart");
    if (!matchMedia("(min-width: 1100px)").matches && c.getBoundingClientRect().top < 0)
      c.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
  }
  function buildMap() {
    var host = $("fc-map");
    if (!host || !GEO) return;
    map = window.USMap(host, GEO, { onPick: pickLoc, pressed: true, label: "States, coloured by forecast rate change" });
    window.USMap.legend($("fc-map-legend"));
    var ms = $("fc-map-models");
    Object.keys(MAPM).forEach(function (k) {
      if (!D.models[MAPM[k]]) return;
      var b = document.createElement("button");
      b.type = "button"; b.dataset.v = k; b.textContent = MAPM_SHORT[k];
      ms.appendChild(b);
    });
    ms.addEventListener("click", function (e) {
      var b = e.target.closest("button[data-v]"); if (!b) return;
      state.mapM = b.dataset.v; sync(); writeHash();
    });
    var ws = $("fc-map-weeks");
    [0, 1, 2, 3].forEach(function (hz) {
      var b = document.createElement("button");
      b.type = "button"; b.dataset.v = String(hz); ws.appendChild(b);
    });
    ws.addEventListener("click", function (e) {
      var b = e.target.closest("button[data-v]"); if (!b) return;
      state.mapH = +b.dataset.v; sync(); writeHash();
    });
    document.querySelectorAll(".map-extra .loc-chip").forEach(function (b) {
      if (!D.observed[b.dataset.loc]) { b.hidden = true; return; }
      b.addEventListener("click", function () { pickLoc(b.dataset.loc); });
    });
  }
  function paintMap() {
    if (!map) return;
    var r = mapRound(), id = MAPM[state.mapM];
    var c = window.USMap.cards(D, id, r, state.mapH);
    map.paint(c, state.loc);
    $("fc-map-model").textContent = MAPM_SHORT[state.mapM] === "Ensemble" ? "FluSight ensemble"
      : MAPM_SHORT[state.mapM] === "Baseline" ? "FluSight baseline" : MAPM_SHORT[state.mapM];
    $("fc-map-when").textContent = "Round of " + long(t(r)) + " · change from the week ending " +
      short(t(r) - WEEK) + " to the week ending " + short(t(r) + state.mapH * WEEK);
    $("fc-map-weeks").querySelectorAll("button").forEach(function (b) {
      b.textContent = short(t(r) + (+b.dataset.v) * WEEK);
      b.setAttribute("aria-label", "Week ending " + long(t(r) + (+b.dataset.v) * WEEK));
    });
    document.querySelectorAll(".map-extra .loc-chip").forEach(function (b) {
      var d = c[b.dataset.loc] || { cat: -1 };
      b.querySelector(".sw").className = "sw " + (d.cat < 0 ? "nd" : "c" + d.cat);
      b.querySelector(".sw").style.opacity = d.cat < 0 ? 1 : (0.55 + 0.45 * d.p).toFixed(2);
      b.setAttribute("aria-pressed", String(b.dataset.loc === state.loc));
      b.title = d.cat < 0 ? "no forecast" : window.USMap.CATS[d.cat] + " " + Math.round(d.p * 100) + "%";
    });
  }

  // ---------- controls ----------
  function seg(id, value) {
    var s = $(id);
    if (s) s.querySelectorAll("button").forEach(function (b) { b.setAttribute("aria-pressed", String(b.dataset.v === value)); });
  }
  function sync() {  // push state into the controls
    $("fc-loc").value = state.loc;
    $("fc-round").value = state.round;
    $("fc-round").disabled = state.view === "all";
    $("fc-i50").checked = state.i50; $("fc-i95").checked = state.i95;
    $("fc-models").querySelectorAll("input[data-m]").forEach(function (i) { i.checked = !!state.on[i.dataset.m]; });
    seg("fc-view", state.view); seg("fc-scale", state.log ? "log" : "linear"); seg("fc-span", state.span);
    if ($("fc-prev")) { $("fc-prev").checked = state.prev; $("fc-prev").closest(".control").hidden = !D.last_season; }
    // a link that changes a folded option opens the fold, so the reader sees why
    if ($("fc-opts") && (state.view !== "round" || state.span !== "recent" || !state.i50 || !state.i95 || !state.prev || state.log)) $("fc-opts").open = true;
    seg("fc-map-models", state.mapM); seg("fc-map-weeks", String(state.mapH));
    paintMap();
  }
  function setup() {
    var locSel = $("fc-loc"), roundSel = $("fc-round"), box = $("fc-models");
    D.locations.forEach(function (l) {
      var o = document.createElement("option");
      o.value = l.id; o.textContent = locName(l.id); locSel.appendChild(o);
    });
    var rs = {};
    Object.keys(SERIES).forEach(function (m) { if (D.models[m] && D.models[m].team) D.models[m].rounds.forEach(function (r) { rs[r] = 1; }); });
    rounds = Object.keys(rs).sort().reverse();
    rounds.forEach(function (r) { var o = document.createElement("option"); o.value = r; o.textContent = long(t(r)); roundSel.appendChild(o); });

    applyHash();
    Object.keys(SERIES).forEach(function (m) {
      if (!D.models[m]) return;
      var lab = document.createElement("label");
      lab.className = "chip" + (SERIES[m].dashed ? " baseline" : "");
      lab.style.setProperty("--c", SERIES[m].color);
      lab.innerHTML = '<input type="checkbox" data-m="' + m + '"><span class="sw"></span>' + label(m);
      lab.querySelector("input").addEventListener("change", function (e) { state.on[m] = e.target.checked; update(true); });
      ["pointerenter", "focusin"].forEach(function (ev) { lab.addEventListener(ev, function () { if (state.on[m]) focusModel(m); }); });
      ["pointerleave", "focusout"].forEach(function (ev) { lab.addEventListener(ev, function () { focusModel(null); }); });
      box.appendChild(lab);
    });
    buildMap();
    sync();

    locSel.addEventListener("change", function () { state.loc = locSel.value; sync(); update(true); });
    roundSel.addEventListener("change", function () { state.round = roundSel.value; update(true); });
    $("fc-i50").addEventListener("change", function (e) { state.i50 = e.target.checked; update(); });
    $("fc-i95").addEventListener("change", function (e) { state.i95 = e.target.checked; update(); });
    $("fc-view").addEventListener("click", function (e) {
      var b = e.target.closest("button[data-v]"); if (!b) return;
      state.view = b.dataset.v; sync(); update(true);
    });
    $("fc-span").addEventListener("click", function (e) {
      var b = e.target.closest("button[data-v]"); if (!b) return;
      state.span = b.dataset.v; sync(); update(true);
    });
    $("fc-prev").addEventListener("change", function (e) { state.prev = e.target.checked; update(); });
    $("fc-scale").addEventListener("click", function (e) {
      var b = e.target.closest("button[data-v]"); if (!b) return;
      state.log = b.dataset.v === "log"; sync(); update();
    });
    $("fc-csv").addEventListener("click", download);
    $("fc-png").addEventListener("click", savePng);
    $("fc-link").addEventListener("click", function () {
      var b = this, url = location.href;
      if (window.Site) window.Site.copy(url).then(function () { window.Site.done(b, "Link"); }, function () { window.Site.say("Could not copy"); });
    });
    // a pasted link, or the browser's back/forward buttons
    addEventListener("hashchange", function () { applyHash(); sync(); render(true); });


    var last = 0;
    new ResizeObserver(function () { var w = $("fc-chart").clientWidth; if (Math.abs(w - last) > 4) { last = w; render(); } }).observe($("fc-chart"));
  }
  function update(anim) { writeHash(); paintMap(); render(anim); }

  document.addEventListener("DOMContentLoaded", function () {
    var geo = fetch("data/us-states.json").then(function (r) { return r.ok ? r.json() : null; }, function () { return null; });
    fetch("data/forecasts.json", { cache: "no-cache" })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (data) { D = data; return geo; })
      .then(function (g) { GEO = g; setup(); render(true); })
      .catch(function (e) {
        $("fc-chart").innerHTML = '<p class="empty">Could not load forecast data (' + e.message + ").</p>";
      });
  });
})();
