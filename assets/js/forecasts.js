// Forecast chart for forecasts.html. Reads data/forecasts.json (built by
// scripts/build_forecasts.py) and draws one round's 0-3 week ahead fans for
// each selected model against observed NHSN admissions. Plain SVG, no library.
(function () {
  "use strict";

  var SERIES = {
    "NAU_PyBNF-OracleSIHRS": { color: "var(--s-oracle)", on: true },
    "NAU_PyBNF-GroundHogCGR": { color: "var(--s-groundhog)", on: true },
    "FluSight-ensemble": { color: "var(--s-ensemble)", on: false },
    "FluSight-baseline": { color: "var(--s-baseline)", on: false, dashed: true }
  };
  var WEEKS_BEFORE = 16;   // observed weeks shown before the reference date
  var DAY = 864e5;
  var NS = "http://www.w3.org/2000/svg";

  var D, state = {};
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

  // ---------- URL state (shareable links: forecasts.html#loc=04&round=2026-11-07) ----------
  function readHash() {
    var p = new URLSearchParams(location.hash.slice(1));
    return { loc: p.get("loc"), round: p.get("round"), models: p.get("models") };
  }
  function writeHash() {
    var p = new URLSearchParams();
    p.set("loc", state.loc);
    p.set("round", state.round);
    p.set("models", Object.keys(state.on).filter(function (m) { return state.on[m]; }).join(","));
    history.replaceState(null, "", "#" + p.toString());
  }

  // ---------- data for the current selection ----------
  function current() {
    var r = t(state.round);
    var obsIdx = [];
    var obs = D.observed[state.loc] || [];
    var x0 = Math.max(r - WEEKS_BEFORE * 7 * DAY, t(D.obs_dates[0])), x1 = r + 3 * 7 * DAY;
    D.obs_dates.forEach(function (d, i) {
      var ms = t(d);
      if (ms >= x0 && ms <= x1 && obs[i] != null) obsIdx.push({ x: ms, y: obs[i], after: ms >= r });
    });
    var fans = [], missing = [];
    Object.keys(SERIES).forEach(function (m) {
      if (!state.on[m]) return;
      var rows = (((D.forecasts[m] || {})[state.round]) || {})[state.loc];
      if (!rows) { missing.push(m); return; }
      var pts = [];
      rows.forEach(function (q, h) { if (q) pts.push({ x: r + h * 7 * DAY, h: h, q: q }); });
      if (pts.length) fans.push({ id: m, pts: pts }); else missing.push(m);
    });
    return { r: r, x0: x0, x1: x1, obs: obsIdx, fans: fans, missing: missing };
  }

  // ---------- chart ----------
  function render() {
    var wrap = $("fc-chart");
    var c = current();
    wrap.innerHTML = "";
    var W = Math.max(300, Math.round(wrap.clientWidth));
    var narrow = W < 560;
    var H = narrow ? 320 : 420;
    var m = { t: 16, r: narrow ? 12 : 112, b: 30, l: narrow ? 44 : 56 };
    var iw = W - m.l - m.r, ih = H - m.t - m.b;

    if (!c.obs.length && !c.fans.length) {
      wrap.innerHTML = '<p class="empty">No data for this location and round.</p>';
      renderTable(c); renderNote(c); return;
    }

    var ymax = 0;
    c.obs.forEach(function (o) { ymax = Math.max(ymax, o.y); });
    c.fans.forEach(function (f) {
      f.pts.forEach(function (p) { ymax = Math.max(ymax, state.i95 ? p.q[4] : state.i50 ? p.q[3] : p.q[2]); });
    });
    ymax = ymax || 1;
    var step = niceStep(ymax, narrow ? 4 : 5);
    var ytop = Math.ceil((ymax * 1.04) / step) * step;
    var pad = 3.5 * DAY;
    var X = function (ms) { return m.l + ((ms - (c.x0 - pad)) / (c.x1 + pad - (c.x0 - pad))) * iw; };
    var Y = function (v) { return m.t + ih - (v / ytop) * ih; };

    var svg = el("svg", { viewBox: "0 0 " + W + " " + H, width: W, height: H, role: "img",
      "aria-label": "Weekly influenza hospital admissions, " + locName(state.loc) + ", forecast round " + long(c.r) });

    // grid + y axis
    var g = el("g", { class: "grid" }, svg), ax = el("g", { class: "axis" }, svg);
    for (var v = 0; v <= ytop + 1e-9; v += step) {
      el("line", { x1: m.l, x2: m.l + iw, y1: Y(v), y2: Y(v) }, g);
      var tx = el("text", { x: m.l - 8, y: Y(v) + 4, "text-anchor": "end" }, ax);
      tx.textContent = v >= 1000 ? (v / 1000).toLocaleString("en-US") + "k" : fmt(v);
    }
    el("line", { class: "base", x1: m.l, x2: m.l + iw, y1: Y(0), y2: Y(0) }, ax);
    // x ticks: every week, labelled every 2 (every 4 when narrow)
    var every = narrow ? 4 : 2, k = 0;
    for (var ms = c.r - WEEKS_BEFORE * 7 * DAY; ms <= c.x1; ms += 7 * DAY, k++) {
      if (ms < c.x0) continue;
      var lab = ((c.r - ms) / (7 * DAY)) % every === 0;
      if (!lab) continue;
      var xt = el("text", { x: X(ms), y: m.t + ih + 20, "text-anchor": "middle" }, ax);
      xt.textContent = short(ms);
    }
    // reference date marker
    var rx = X(c.r - pad);
    el("line", { class: "refline", x1: rx, x2: rx, y1: m.t, y2: m.t + ih }, svg);
    var rl = el("text", { class: "reflabel", x: rx + 6, y: m.t + 10 }, svg);
    rl.textContent = "Forecast →";

    // fans: 95% band, 50% band, median
    c.fans.forEach(function (f) {
      var s = SERIES[f.id], gg = el("g", { "data-model": f.id }, svg);
      function band(lo, hi, op) {
        var up = f.pts.map(function (p) { return X(p.x) + "," + Y(p.q[hi]); });
        var dn = f.pts.slice().reverse().map(function (p) { return X(p.x) + "," + Y(p.q[lo]); });
        if (f.pts.length === 1) { // single horizon: draw a short bar instead of a polygon
          var p0 = f.pts[0];
          el("rect", { x: X(p0.x) - 6, width: 12, y: Y(p0.q[hi]), height: Math.max(1, Y(p0.q[lo]) - Y(p0.q[hi])), rx: 3,
            style: "fill:" + s.color + ";opacity:" + op }, gg);
          return;
        }
        el("polygon", { points: up.concat(dn).join(" "), style: "fill:" + s.color + ";opacity:" + op }, gg);
      }
      if (state.i95) band(0, 4, 0.14);
      if (state.i50) band(1, 3, 0.28);
      el("polyline", { points: f.pts.map(function (p) { return X(p.x) + "," + Y(p.q[2]); }).join(" "),
        style: "fill:none;stroke:" + s.color + ";stroke-width:2;stroke-linejoin:round" + (s.dashed ? ";stroke-dasharray:5 3" : "") }, gg);
      f.pts.forEach(function (p) {
        el("circle", { cx: X(p.x), cy: Y(p.q[2]), r: 4, style: "fill:" + s.color + ";stroke:var(--chart-surface);stroke-width:2" }, gg);
      });
    });

    // observed
    if (c.obs.length > 1) el("polyline", { class: "obs-line", points: c.obs.map(function (o) { return X(o.x) + "," + Y(o.y); }).join(" ") }, svg);
    c.obs.forEach(function (o) { el("circle", { class: "obs-dot" + (o.after ? " later" : ""), cx: X(o.x), cy: Y(o.y), r: 4 }, svg); });

    // direct labels at the last horizon (wide only), nudged apart
    if (!narrow) {
      var labs = c.fans.map(function (f) { var p = f.pts[f.pts.length - 1]; return { id: f.id, x: X(p.x) + 10, y: Y(p.q[2]) + 4 }; })
        .sort(function (a, b) { return a.y - b.y; });
      for (var i = 1; i < labs.length; i++) if (labs[i].y - labs[i - 1].y < 15) labs[i].y = labs[i - 1].y + 15;
      var floor = m.t + ih + 4; // keep the stack inside the plot: shift up from the bottom if needed
      for (var j = labs.length - 1; j >= 0; j--) {
        var cap = j === labs.length - 1 ? floor : labs[j + 1].y - 15;
        if (labs[j].y > cap) labs[j].y = cap;
      }
      labs.forEach(function (l) { var tl = el("text", { class: "dlabel", x: l.x, y: l.y }, svg); tl.textContent = label(l.id); });
    }

    // hover layer: crosshair + tooltip snapped to the nearest week
    var weeks = [];
    for (var w = c.r - WEEKS_BEFORE * 7 * DAY; w <= c.x1; w += 7 * DAY) if (w >= c.x0) weeks.push(w);
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
      c.fans.forEach(function (f) {
        var p = f.pts.filter(function (q) { return q.x === best; })[0];
        if (!p) return;
        rows += '<tr><td><span class="key" style="background:' + SERIES[f.id].color + '"></span>' + label(f.id) +
          ' <span class="rng">h' + p.h + "</span></td><td>" + fmt(p.q[2]) + "</td></tr>" +
          '<tr><td colspan="2" class="rng" style="text-align:right">' +
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
      '<li><svg class="k" width="22" height="10"><line x1="1" x2="21" y1="5" y2="5" stroke="var(--muted)" stroke-width="2"/><circle cx="11" cy="5" r="3" fill="var(--muted)"/></svg>Median, horizons 0–3</li>';
    if (state.i50) html += '<li><svg class="k" width="16" height="10"><rect width="16" height="10" rx="2" fill="var(--muted)" opacity=".4"/></svg>50% interval</li>';
    if (state.i95) html += '<li><svg class="k" width="16" height="10"><rect width="16" height="10" rx="2" fill="var(--muted)" opacity=".2"/></svg>95% interval</li>';
    $("fc-legend").innerHTML = html;
  }

  function renderNote(c) {
    var parts = [];
    if (c.missing.length) parts.push(c.missing.map(label).join(", ") + ": no forecast for " + locName(state.loc) + " in this round.");
    parts.push('Data: <a href="' + D.source + '">cdcepi/FluSight-forecast-hub</a>, target “' + D.target + '”, updated ' + D.generated.slice(0, 10) + ".");
    $("fc-note").innerHTML = parts.join(" ");
  }

  function renderTable(c) {
    var cols = c.fans.map(function (f) { return f.id; });
    var html = '<table class="data"><thead><tr><th>Week ending</th><th>Horizon</th><th>Observed</th>';
    cols.forEach(function (id) { html += "<th>" + label(id) + " median</th><th>50%</th><th>95%</th>"; });
    html += "</tr></thead><tbody>";
    for (var h = 0; h <= 3; h++) {
      var x = c.r + h * 7 * DAY, o = c.obs.filter(function (q) { return q.x === x; })[0];
      html += "<tr><td>" + long(x) + "</td><td>" + h + "</td><td>" + (o ? fmt(o.y) : "–") + "</td>";
      c.fans.forEach(function (f) {
        var p = f.pts.filter(function (q) { return q.h === h; })[0];
        html += p ? "<td>" + fmt(p.q[2]) + "</td><td>" + fmt(p.q[1]) + "–" + fmt(p.q[3]) + "</td><td>" + fmt(p.q[0]) + "–" + fmt(p.q[4]) + "</td>"
                  : "<td>–</td><td>–</td><td>–</td>";
      });
      html += "</tr>";
    }
    $("fc-table").innerHTML = html + "</tbody></table>";
  }

  function locName(id) {
    for (var i = 0; i < D.locations.length; i++) if (D.locations[i].id === id) return D.locations[i].name;
    return id;
  }

  // ---------- controls ----------
  function setup() {
    var h = readHash();
    var locSel = $("fc-loc"), roundSel = $("fc-round"), box = $("fc-models");
    D.locations.forEach(function (l) {
      var o = document.createElement("option");
      o.value = l.id; o.textContent = l.id === "US" ? "United States" : l.name; locSel.appendChild(o);
    });
    var rounds = {};
    Object.keys(SERIES).forEach(function (m) { if (D.models[m] && D.models[m].team) D.models[m].rounds.forEach(function (r) { rounds[r] = 1; }); });
    rounds = Object.keys(rounds).sort().reverse();
    rounds.forEach(function (r) { var o = document.createElement("option"); o.value = r; o.textContent = long(t(r)); roundSel.appendChild(o); });

    state.loc = h.loc && D.observed[h.loc] ? h.loc : "US";
    state.round = h.round && rounds.indexOf(h.round) >= 0 ? h.round : rounds[0];
    state.on = {};
    var wanted = h.models ? h.models.split(",") : null;
    Object.keys(SERIES).forEach(function (m) {
      if (!D.models[m]) return;
      state.on[m] = wanted ? wanted.indexOf(m) >= 0 : SERIES[m].on;
      var lab = document.createElement("label");
      lab.className = "chip" + (SERIES[m].dashed ? " baseline" : "");
      lab.style.setProperty("--c", SERIES[m].color);
      lab.innerHTML = '<input type="checkbox"' + (state.on[m] ? " checked" : "") + '><span class="sw"></span>' + label(m);
      lab.querySelector("input").addEventListener("change", function (e) { state.on[m] = e.target.checked; update(); });
      box.appendChild(lab);
    });
    state.i50 = true; state.i95 = true;
    locSel.value = state.loc; roundSel.value = state.round;
    locSel.addEventListener("change", function () { state.loc = locSel.value; update(); });
    roundSel.addEventListener("change", function () { state.round = roundSel.value; update(); });
    $("fc-i50").addEventListener("change", function (e) { state.i50 = e.target.checked; update(); });
    $("fc-i95").addEventListener("change", function (e) { state.i95 = e.target.checked; update(); });

    var last = 0;
    new ResizeObserver(function () { var w = $("fc-chart").clientWidth; if (Math.abs(w - last) > 4) { last = w; render(); } }).observe($("fc-chart"));
  }
  function update() { writeHash(); render(); }

  document.addEventListener("DOMContentLoaded", function () {
    fetch("data/forecasts.json", { cache: "no-cache" })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (data) { D = data; setup(); render(); })
      .catch(function (e) {
        $("fc-chart").innerHTML = '<p class="empty">Could not load forecast data (' + e.message + ").</p>";
      });
  });
})();
