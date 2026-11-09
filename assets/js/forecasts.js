// Forecast chart for forecasts.html. Reads data/forecasts.json (built by
// scripts/build_forecasts.py) and draws the 0-3 week ahead fans of each
// selected model against observed NHSN admissions. Plain SVG, no library.
//
// Two views: one round (with its 50%/95% intervals), or every round of the
// season at once (each round's median; intervals for the latest round only).
// Linear or log scale. Everything chosen is kept in the link
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
  var WEEKS_BEFORE = 16;   // observed weeks shown before the reference date
  var DAY = 864e5, WEEK = 7 * DAY;
  var NS = "http://www.w3.org/2000/svg";

  // FIPS code -> postal code (links use postal codes; old FIPS links still work)
  var POSTAL = window.USMap.POSTAL;
  // map models: link key -> hub model ID
  var MAPM = { oracle: "NAU_PyBNF-OracleSIHRS", groundhog: "NAU_PyBNF-GroundHogCGR",
    ensemble: "FluSight-ensemble", baseline: "FluSight-baseline" };
  var MAPM_SHORT = { oracle: "Oracle SIHRS", groundhog: "Groundhog", ensemble: "Ensemble", baseline: "Baseline" };

  var D, GEO, map, state = {}, rounds = [];
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
  function onModels() { return Object.keys(SERIES).filter(function (m) { return state.on[m] && D.models[m]; }); }

  // ---------- link state ----------
  // Only choices that differ from the defaults go in the link, so the plain
  // page stays forecasts.html. Example: #loc=AZ&view=all&scale=log
  function readHash() {
    var p = new URLSearchParams(location.hash.slice(1));
    return { loc: p.get("loc"), round: p.get("round"), models: p.get("models"),
      view: p.get("view"), scale: p.get("scale"), bands: p.get("bands"),
      map: p.get("map"), week: p.get("week") };
  }
  function linkParams() {
    var p = new URLSearchParams();
    if (state.loc !== "US") p.set("loc", POSTAL[state.loc] || state.loc);
    if (state.view === "all") p.set("view", "all");
    else if (state.round !== rounds[0]) p.set("round", state.round);
    var on = onModels(), def = Object.keys(SERIES).filter(function (m) { return SERIES[m].on && D.models[m]; });
    if (on.join() !== def.join()) p.set("models", on.join(",") || "none");
    if (state.log) p.set("scale", "log");
    if (!(state.i50 && state.i95)) p.set("bands", [state.i50 ? "50" : "", state.i95 ? "95" : ""].filter(Boolean).join(",") || "none");
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
    var x0 = all ? t(D.obs_dates[0]) : Math.max(r - WEEKS_BEFORE * WEEK, t(D.obs_dates[0]));
    var obs = D.observed[state.loc] || [], o = [];
    D.obs_dates.forEach(function (d, i) {
      var ms = t(d);
      if (ms >= x0 && ms <= x1 && obs[i] != null) o.push({ x: ms, y: obs[i], after: !all && ms >= r });
    });
    var runs = [], missing = [];
    onModels().forEach(function (m) {
      var list = all ? rounds.slice().reverse() : [state.round], any = false;
      list.forEach(function (rd) {
        var pts = points(rowsFor(m, rd), t(rd));
        if (pts.length) { runs.push({ id: m, round: rd, pts: pts, latest: rd === latest }); any = true; }
      });
      if (!any) missing.push(m);
    });
    return { all: all, r: r, x0: x0, x1: x1, obs: o, runs: runs, missing: missing };
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
  function render() {
    var wrap = $("fc-chart");
    var c = current();
    wrap.innerHTML = "";
    var W = Math.max(300, Math.round(wrap.clientWidth));
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
        (c.all ? ", every forecast round of the season" : ", forecast round " + long(c.r)) +
        (state.log ? ", log scale" : "") });

    // grid + y axis
    var g = el("g", { class: "grid" }, svg), ax = el("g", { class: "axis" }, svg);
    ys.ticks.forEach(function (v) {
      el("line", { x1: m.l, x2: m.l + iw, y1: Y(v), y2: Y(v) }, g);
      var tx = el("text", { x: m.l - 8, y: Y(v) + 4, "text-anchor": "end" }, ax);
      tx.textContent = kfmt(v);
    });
    el("line", { class: "base", x1: m.l, x2: m.l + iw, y1: Y(0), y2: Y(0) }, ax);
    // x ticks: labelled every 2 weeks (every 4 when narrow, or for the whole season)
    var every = narrow || c.all ? 4 : 2;
    var weeks = [];
    for (var w = c.r + 3 * WEEK; w >= c.x0; w -= WEEK) weeks.unshift(w);
    weeks.forEach(function (ms) {
      if (Math.round((c.r - ms) / WEEK) % every !== 0) return;
      var xt = el("text", { x: X(ms), y: m.t + ih + 20, "text-anchor": "middle" }, ax);
      xt.textContent = short(ms);
    });
    // reference date marker (the latest round in the season view)
    var rx = X(c.r - pad);
    el("line", { class: "refline", x1: rx, x2: rx, y1: m.t, y2: m.t + ih }, svg);
    var rl = el("text", { class: "reflabel", x: rx + 6, y: m.t + 10 }, svg);
    rl.textContent = c.all ? "Latest →" : "Forecast →";

    // fans: 95% band, 50% band, median (season view: older rounds are medians only)
    c.runs.forEach(function (f) {
      var s = SERIES[f.id], old = c.all && !f.latest;
      var gg = el("g", { "data-model": f.id, "data-round": f.round, class: old ? "past-run" : "" }, svg);
      function band(lo, hi, op) {
        var up = f.pts.map(function (p) { return X(p.x) + "," + Y(p.q[hi]); });
        var dn = f.pts.slice().reverse().map(function (p) { return X(p.x) + "," + Y(p.q[lo]); });
        if (f.pts.length === 1) { // single horizon: a short bar instead of a polygon
          var p0 = f.pts[0];
          el("rect", { x: X(p0.x) - 6, width: 12, y: Y(p0.q[hi]), height: Math.max(1, Y(p0.q[lo]) - Y(p0.q[hi])), rx: 3,
            style: "fill:" + s.color + ";opacity:" + op }, gg);
          return;
        }
        el("polygon", { points: up.concat(dn).join(" "), style: "fill:" + s.color + ";opacity:" + op }, gg);
      }
      if (!old && state.i95) band(0, 4, 0.14);
      if (!old && state.i50) band(1, 3, 0.28);
      el("polyline", { points: f.pts.map(function (p) { return X(p.x) + "," + Y(p.q[2]); }).join(" "),
        style: "fill:none;stroke:" + s.color + ";stroke-width:" + (old ? 1.5 : 2) + ";stroke-linejoin:round" +
          (old ? ";opacity:.6" : "") + (s.dashed ? ";stroke-dasharray:5 3" : "") }, gg);
      f.pts.forEach(function (p) {
        el("circle", { cx: X(p.x), cy: Y(p.q[2]), r: old ? 2.5 : 4,
          style: "fill:" + s.color + ";stroke:var(--chart-surface);stroke-width:" + (old ? 1 : 2) + (old ? ";opacity:.75" : "") }, gg);
      });
    });

    // observed
    if (c.obs.length > 1) el("polyline", { class: "obs-line", points: c.obs.map(function (o) { return X(o.x) + "," + Y(o.y); }).join(" ") }, svg);
    c.obs.forEach(function (o) { el("circle", { class: "obs-dot" + (o.after ? " later" : ""), cx: X(o.x), cy: Y(o.y), r: 4 }, svg); });

    // direct labels at the last horizon of the (latest) round (wide only), nudged apart
    if (!narrow) {
      var labs = c.runs.filter(function (f) { return f.latest; })
        .map(function (f) { var p = f.pts[f.pts.length - 1]; return { id: f.id, x: X(p.x) + 10, y: Y(p.q[2]) + 4 }; })
        .sort(function (a, b) { return a.y - b.y; });
      for (var i = 1; i < labs.length; i++) if (labs[i].y - labs[i - 1].y < 15) labs[i].y = labs[i - 1].y + 15;
      var floor = m.t + ih + 4; // keep the stack inside the plot
      for (var j = labs.length - 1; j >= 0; j--) {
        var cap = j === labs.length - 1 ? floor : labs[j + 1].y - 15;
        if (labs[j].y > cap) labs[j].y = cap;
      }
      labs.forEach(function (l) { var tl = el("text", { class: "dlabel", x: l.x, y: l.y }, svg); tl.textContent = label(l.id); });
    }

    // hover layer: crosshair + tooltip snapped to the nearest week
    var cross = el("line", { class: "crosshair", y1: m.t, y2: m.t + ih, visibility: "hidden" }, svg);
    var hit = el("rect", { x: m.l, y: m.t, width: iw, height: ih, fill: "transparent", style: "cursor:crosshair" }, svg);
    var tip = document.createElement("div");
    tip.className = "tooltip"; tip.hidden = true;
    wrap.appendChild(svg); wrap.appendChild(tip);

    function show(ev) {
      var box = svg.getBoundingClientRect(), sx = (ev.clientX - box.left) * (W / box.width);
      var best = weeks[0], bd = Infinity;
      weeks.forEach(function (wk) { var d = Math.abs(X(wk) - sx); if (d < bd) { bd = d; best = wk; } });
      var rows = "", o = c.obs.filter(function (q) { return q.x === best; })[0];
      if (o) rows += '<tr><td><span class="key" style="background:var(--obs);border-radius:50%"></span>Observed</td><td>' + fmt(o.y) + "</td></tr>";
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
      tip.style.left = Math.max(0, left) + "px";
      tip.style.top = Math.max(0, (ev.clientY - box.top) - tip.offsetHeight / 2) + "px";
    }
    function hide() { tip.hidden = true; cross.setAttribute("visibility", "hidden"); }
    hit.addEventListener("pointermove", show);
    hit.addEventListener("pointerdown", show);
    hit.addEventListener("pointerleave", hide);

    renderLegend(c); renderTable(c); renderNote(c);
  }

  function renderLegend(c) {
    var html = '<li><svg class="k" width="14" height="10"><circle cx="7" cy="5" r="4" fill="var(--obs)"/></svg>Observed (NHSN)</li>' +
      (c.obs.some(function (o) { return o.after; }) ? '<li><svg class="k" width="14" height="10"><circle cx="7" cy="5" r="3.5" fill="none" stroke="var(--obs)" stroke-width="1.5"/></svg>Observed after the reference date</li>' : '') +
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
    var html = '<table class="data"><thead><tr>' + (c.all ? "<th>Round</th>" : "") + '<th>Week ending</th><th>Horizon</th><th>Observed</th>';
    cols.forEach(function (id) { html += "<th>" + label(id) + " median</th><th>50%</th><th>95%</th>"; });
    html += "</tr></thead><tbody>";
    list.forEach(function (rd) {
      for (var h = 0; h <= 3; h++) {
        var x = t(rd) + h * WEEK, o = c.obs.filter(function (q) { return q.x === x; })[0];
        html += "<tr>" + (c.all ? "<td>" + short(t(rd)) + "</td>" : "") + "<td>" + long(x) + "</td><td>" + h + "</td><td>" + (o ? fmt(o.y) : "–") + "</td>";
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

  // ---------- rate-change map ----------
  // The map shows the chart's round (the latest one in the all-rounds view).
  function mapRound() { return state.view === "all" ? rounds[0] : state.round; }
  function pickLoc(f) {
    state.loc = f; sync(); update();
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
    paintSummary();
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

  // One line above the chart: for the chosen place and map model, the most
  // likely rate-change category at each of the four weeks (the same numbers
  // the map shows), with the map's week picked. Click a week to pick it.
  function paintSummary() {
    var box = $("fc-summary");
    if (!box || !D.cat_probs) return;
    var r = mapRound(), id = MAPM[state.mapM], CATS = window.USMap.CATS;
    var cs = [0, 1, 2, 3].map(function (hz) { return window.USMap.cards(D, id, r, hz)[state.loc] || { cat: -1 }; });
    box.textContent = "";
    if (cs.every(function (c) { return c.cat < 0; })) { box.hidden = true; return; }
    box.hidden = false;
    var head = document.createElement("p"), sel = cs[state.mapH];
    head.className = "fc-sum-head";
    var b = document.createElement("strong");
    b.textContent = locName(state.loc);
    head.appendChild(b);
    var rest = " · " + (MAPM_SHORT[state.mapM] === "Ensemble" ? "FluSight ensemble" : MAPM_SHORT[state.mapM] === "Baseline" ? "FluSight baseline" : MAPM_SHORT[state.mapM]) + ": ";
    rest += sel.cat < 0 ? "no forecast for the week ending " + short(t(r) + state.mapH * WEEK)
      : "most likely " + CATS[sel.cat] + " (" + Math.round(sel.p * 100) + "%) by the week ending " + sel.target +
        (sel.base != null ? ", from " + fmt(sel.base) + " admissions in the week ending " + sel.baseDay : "");
    head.appendChild(document.createTextNode(rest));
    box.appendChild(head);
    var ul = document.createElement("ul");
    ul.className = "fc-sum-weeks";
    cs.forEach(function (c, hz) {
      var li = document.createElement("li"), btn = document.createElement("button");
      btn.type = "button"; btn.dataset.v = String(hz);
      btn.setAttribute("aria-pressed", String(hz === state.mapH));
      var sw = document.createElement("span");
      sw.className = "sw " + (c.cat < 0 ? "nd" : "c" + c.cat);
      if (c.cat >= 0) sw.style.opacity = (0.55 + 0.45 * c.p).toFixed(2);
      var wk = document.createElement("span");
      wk.className = "wk"; wk.textContent = short(t(r) + hz * WEEK);
      btn.appendChild(sw); btn.appendChild(wk);
      btn.appendChild(document.createTextNode(c.cat < 0 ? "no forecast" : CATS[c.cat] + " " + Math.round(c.p * 100) + "%"));
      li.appendChild(btn); ul.appendChild(li);
    });
    ul.addEventListener("click", function (e) {
      var x = e.target.closest("button[data-v]"); if (!x) return;
      state.mapH = +x.dataset.v; sync(); writeHash();
    });
    box.appendChild(ul);
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
    seg("fc-view", state.view); seg("fc-scale", state.log ? "log" : "linear");
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
      lab.querySelector("input").addEventListener("change", function (e) { state.on[m] = e.target.checked; update(); });
      box.appendChild(lab);
    });
    buildMap();
    sync();

    locSel.addEventListener("change", function () { state.loc = locSel.value; sync(); update(); });
    roundSel.addEventListener("change", function () { state.round = roundSel.value; update(); });
    $("fc-i50").addEventListener("change", function (e) { state.i50 = e.target.checked; update(); });
    $("fc-i95").addEventListener("change", function (e) { state.i95 = e.target.checked; update(); });
    $("fc-view").addEventListener("click", function (e) {
      var b = e.target.closest("button[data-v]"); if (!b) return;
      state.view = b.dataset.v; sync(); update();
    });
    $("fc-scale").addEventListener("click", function (e) {
      var b = e.target.closest("button[data-v]"); if (!b) return;
      state.log = b.dataset.v === "log"; sync(); update();
    });
    $("fc-csv").addEventListener("click", download);
    $("fc-link").addEventListener("click", function () {
      var b = this, url = location.href;
      if (window.Site) window.Site.copy(url).then(function () { window.Site.done(b, "Link"); }, function () { window.Site.say("Could not copy"); });
    });
    // a pasted link, or the browser's back/forward buttons
    addEventListener("hashchange", function () { applyHash(); sync(); render(); });


    var last = 0;
    new ResizeObserver(function () { var w = $("fc-chart").clientWidth; if (Math.abs(w - last) > 4) { last = w; render(); } }).observe($("fc-chart"));
  }
  function update() { writeHash(); paintMap(); render(); }

  document.addEventListener("DOMContentLoaded", function () {
    var geo = fetch("data/us-states.json").then(function (r) { return r.ok ? r.json() : null; }, function () { return null; });
    fetch("data/forecasts.json", { cache: "no-cache" })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (data) { D = data; return geo; })
      .then(function (g) { GEO = g; setup(); render(); })
      .catch(function (e) {
        $("fc-chart").innerHTML = '<p class="empty">Could not load forecast data (' + e.message + ").</p>";
      });
  });
})();
