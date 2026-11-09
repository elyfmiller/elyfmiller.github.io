// Home page: small US sparkline of the latest FluBNF round, drawn from the
// same data/forecasts.json as the forecasts page. Observed NHSN admissions
// (dots), plus each team model's median and 50% interval for horizons 0-3.
(function () {
  var MODELS = [
    { id: "NAU_PyBNF-OracleSIHRS", v: "--s-oracle" },
    { id: "NAU_PyBNF-GroundHogCGR", v: "--s-groundhog" },
  ];
  var WEEKS = 10, DAY = 864e5, W = 640, H = 190, M = { t: 14, r: 108, b: 22, l: 6 };
  var lastW = 0;
  var NS = "http://www.w3.org/2000/svg";
  var box = document.getElementById("home-spark");
  if (!box || !window.fetch) return;
  var plot = box.querySelector(".spark-plot"), meta = box.querySelector(".spark-meta");
  var D;

  function t(iso) { return Date.parse(iso + "T00:00:00Z"); }
  function fmtDate(ms, year) {
    return new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: year ? "numeric" : undefined, timeZone: "UTC" });
  }
  function n(x) { return Math.round(x).toLocaleString("en-US"); }
  function k(x) { return x >= 1000 ? Math.round(x / 1000) + "k" : String(Math.round(x)); }
  function el(name, attrs, parent, text) {
    var e = document.createElementNS(NS, name);
    for (var a in attrs) e.setAttribute(a, attrs[a]);
    if (text != null) e.textContent = text;
    if (parent) parent.appendChild(e);
    return e;
  }
  function color(v) { return getComputedStyle(document.documentElement).getPropertyValue(v).trim(); }

  function draw() {
    // draw at the container's real width so text stays at its CSS size
    W = Math.max(300, Math.round(plot.clientWidth || 640));
    H = W < 480 ? 170 : Math.round(Math.min(300, Math.max(190, W * 0.42)));
    lastW = W;
    var rounds = Object.keys(D.forecasts[MODELS[0].id] || {}).sort();
    var r = rounds[rounds.length - 1];
    if (!r) return;
    var R = t(r);
    var obsAll = D.obs_dates.map(function (d, i) { return { x: t(d), y: D.observed.US[i] }; })
      .filter(function (p) { return p.y != null; });
    var obs = obsAll.slice(-WEEKS);
    var series = MODELS.map(function (m) {
      var rows = ((D.forecasts[m.id] || {})[r] || {}).US;
      if (!rows) return null;
      return { m: m, label: D.models[m.id].label, pts: rows.map(function (q, h) { return q && { x: R + h * 7 * DAY, h: h, q: q }; }).filter(Boolean) };
    }).filter(Boolean);
    if (!series.length) return;

    var x0 = obs[0].x, x1 = R + 3 * 7 * DAY;
    var ymax = Math.max.apply(null, obs.map(function (p) { return p.y; }).concat(
      [].concat.apply([], series.map(function (s) { return s.pts.map(function (p) { return p.q[3]; }); }))));
    ymax *= 1.08;
    var X = function (ms) { return M.l + (ms - x0) / (x1 - x0) * (W - M.l - M.r); };
    var Y = function (v) { return H - M.b - v / ymax * (H - M.t - M.b); };

    plot.textContent = "";
    var svg = el("svg", { viewBox: "0 0 " + W + " " + H, role: "img",
      "aria-label": "US weekly influenza hospital admissions: observed through " + fmtDate(obs[obs.length - 1].x, true) +
        ", and FluBNF median forecasts for the round of " + fmtDate(R, true) + "." }, plot);

    // gridline at a round number, labelled
    var step = Math.pow(10, Math.floor(Math.log10(ymax))) ;
    var top = Math.floor(ymax / step) * step;
    if (top / ymax < 0.6) top = Math.floor(ymax / (step / 2)) * (step / 2);
    el("line", { x1: M.l, x2: W - M.r, y1: Y(top), y2: Y(top), stroke: color("--grid") }, svg);
    el("text", { x: M.l, y: Y(top) - 4 }, svg, k(top));
    el("line", { x1: M.l, x2: W - M.r, y1: Y(0), y2: Y(0), stroke: color("--axis") }, svg);
    el("line", { class: "s-ref", x1: X(R), x2: X(R), y1: M.t - 4, y2: H - M.b }, svg);
    [[x0, "start"], [x1, "end"]].forEach(function (a) {
      el("text", { x: X(a[0]), y: H - 6, "text-anchor": a[1] }, svg, fmtDate(a[0]));
    });
    el("text", { x: X(R) - 5, y: M.t + 4, "text-anchor": "end" }, svg, "Forecast from " + fmtDate(R));

    var labels = [];
    series.forEach(function (s) {
      var c = color(s.m.v), g = el("g", {}, svg);
      var band = s.pts.map(function (p) { return X(p.x) + "," + Y(p.q[3]); })
        .concat(s.pts.slice().reverse().map(function (p) { return X(p.x) + "," + Y(p.q[1]); }));
      el("polygon", { class: "s-band", points: band.join(" "), fill: c }, g);
      el("polyline", { class: "s-line", stroke: c, points: s.pts.map(function (p) { return X(p.x) + "," + Y(p.q[2]); }).join(" ") }, g);
      s.pts.forEach(function (p) {
        var dot = el("circle", { cx: X(p.x), cy: Y(p.q[2]), r: 3.5, fill: c, stroke: color("--card"), "stroke-width": 1.5 }, g);
        el("title", {}, dot, s.label + ", week ending " + fmtDate(p.x) + ": median " + n(p.q[2]) +
          " (50% interval " + n(p.q[1]) + "–" + n(p.q[3]) + ")");
      });
      var last = s.pts[s.pts.length - 1];
      labels.push({ y: Y(last.q[2]), text: s.label, c: c });
    });
    el("polyline", { class: "s-obs-line", points: obs.map(function (p) { return X(p.x) + "," + Y(p.y); }).join(" ") }, svg);
    obs.forEach(function (p) {
      var dot = el("circle", { class: "s-obs", cx: X(p.x), cy: Y(p.y), r: 3 }, svg);
      el("title", {}, dot, "Observed, week ending " + fmtDate(p.x) + ": " + n(p.y));
    });
    // direct labels at the right edge, nudged apart
    labels.sort(function (a, b) { return a.y - b.y; });
    for (var i = 1; i < labels.length; i++) if (labels[i].y - labels[i - 1].y < 15) labels[i].y = labels[i - 1].y + 15;
    labels.forEach(function (l) {
      el("rect", { x: W - M.r + 10, y: l.y - 4, width: 8, height: 8, rx: 2, fill: l.c }, svg);
      el("text", { class: "lab", x: W - M.r + 22, y: l.y + 4 }, svg, l.text);
    });
    if (meta) meta.textContent = "Observed (NHSN) and FluBNF forecasts · round of " + fmtDate(R, true);
  }

  // ---- the rate-change map: the latest round, the week ending on the
  // reference date (horizon 0, as FluBNF's home outlook); a click opens that
  // state on the forecast page ----
  var MAPM = { oracle: "NAU_PyBNF-OracleSIHRS", groundhog: "NAU_PyBNF-GroundHogCGR" };
  var mapModel = "oracle", map;
  function paintMap() {
    if (!map) return;
    var id = MAPM[mapModel], rounds = Object.keys((D.cat_probs || {})[id] || {}).sort();
    var r = rounds[rounds.length - 1];
    if (!r) return;
    map.paint(window.USMap.cards(D, id, r, 0), null);
    document.getElementById("home-map-model").textContent = D.models[id].label;
    document.getElementById("home-map-when").textContent = "Round of " + fmtDate(t(r), true) +
      " · change from the week ending " + fmtDate(t(r) - 7 * DAY) + " to the week ending " + fmtDate(t(r));
    document.querySelectorAll("#home-map-models button").forEach(function (b) {
      b.setAttribute("aria-pressed", String(b.dataset.v === mapModel));
    });
  }
  function setupMap(geo) {
    var host = document.getElementById("home-map");
    if (!host || !geo || !window.USMap || !D.cat_probs) {
      var card = document.getElementById("home-map-card");
      if (card) card.hidden = true;
      return;
    }
    map = window.USMap(host, geo, {
      label: "States, coloured by forecast rate change; each opens that state's forecast",
      hint: "click for this state's forecast",
      onPick: function (f) {
        location.href = "forecasts.html#loc=" + (window.USMap.POSTAL[f] || f) + (mapModel === "oracle" ? "" : "&map=" + mapModel);
      }
    });
    window.USMap.legend(document.getElementById("home-map-legend"));
    document.getElementById("home-map-models").addEventListener("click", function (e) {
      var b = e.target.closest("button[data-v]");
      if (b) { mapModel = b.dataset.v; paintMap(); }
    });
    paintMap();
  }

  // the data is for the folded sections below the bio, so it waits behind the page itself
  var geo = fetch("data/us-states.json", { priority: "low" }).then(function (r) { return r.ok ? r.json() : null; }, function () { return null; });
  fetch("data/forecasts.json", { priority: "low" }).then(function (r) { return r.json(); }).then(function (d) {
    D = d; draw();
    geo.then(setupMap);
    document.addEventListener("themechange", draw);
    if ("ResizeObserver" in window) new ResizeObserver(function () {
      // a folded section has no width: wait until it opens again
      if (plot.clientWidth && Math.abs(Math.round(plot.clientWidth) - lastW) > 4) draw();
    }).observe(plot);
    matchMedia("(prefers-color-scheme: dark)").addEventListener("change", draw);
  }).catch(function () {});
})();
