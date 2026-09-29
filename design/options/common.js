// Shared SAMPLE data + tiny SVG chart builders for the three design options.
// Every number here is a placeholder for layout only — not real market data.

(function () {
  function seeded(seed) {
    let s = seed;
    return () => (s = (s * 16807) % 2147483647) / 2147483647;
  }
  const rnd = seeded(42);
  let series = Array.from({ length: 90 }, (_, i) =>
    930 + i * 1.6 + 55 * Math.sin(i / 8) + (rnd() - 0.5) * 50
  );
  // smooth into a believable 7-day average, then pin the last value
  series = series.map((_, i) => {
    const w = series.slice(Math.max(0, i - 6), i + 1);
    return w.reduce((a, b) => a + b, 0) / w.length;
  });
  const shift = 1086 - series[89];
  series = series.map((v, i) => Math.round(v + shift * (i / 89)));

  window.SAMPLE = {
    today: "Wed 30 Sep 2026",
    dataDay: "Tue 29 Sep",
    updated: "09:12",
    status: { dld: "ok", news: "ok", ai: "6/10" },
    kpis: [
      { key: "deals", label: "Deals", value: "1,184", delta: +9, vs: "vs 7-day avg", spark: series.slice(-14) },
      { key: "value", label: "Value", value: "AED 3.9bn", delta: +6, vs: "vs 7-day avg", spark: series.slice(-14).map((v, i) => v * (1 + Math.sin(i) * 0.04)) },
      { key: "offplan", label: "Off-plan share", value: "69%", delta: +4, deltaUnit: "pts", vs: "vs last week", spark: null, split: { off: 817, ready: 367 } },
      { key: "psf", label: "Median price", value: "AED 1,586", unit: "/sqft", delta: +0.4, vs: "vs 30-day", spark: series.slice(-14).map((v) => 1500 + v / 12) },
    ],
    heroCompare: [
      { label: "7-day avg", value: "1,086", delta: +9 },
      { label: "30-day avg", value: "1,139", delta: +4 },
      { label: "Same wk 2025", value: "1,038", delta: +14 },
    ],
    series90: series,
    seriesStart: "1 Jul",
    seriesMid: "14 Aug",
    seriesEnd: "29 Sep",
    topAreas: [
      { name: "JVC", value: 412 },
      { name: "Business Bay", value: 318 },
      { name: "Dubai South", value: 297 },
      { name: "Dubai Marina", value: 245 },
      { name: "Dubai Hills Estate", value: 231 },
    ],
    largest: { value: "AED 38.5m", what: "Villa, Palm Jumeirah<br>Ready" },
    watch: [
      { area: "Dubai Marina", deals: 1020, psf: 2210, d30: 1.2, d90: 3.8 },
      { area: "Business Bay", deals: 1310, psf: 2150, d30: 0.9, d90: 3.1 },
      { area: "Downtown Dubai", deals: 610, psf: 3120, d30: 0.4, d90: 1.9 },
      { area: "Palm Jumeirah", deals: 280, psf: 4350, d30: 1.6, d90: 4.4 },
      { area: "Dubai Hills Estate", deals: 980, psf: 2050, d30: 2.4, d90: 6.0 },
      { area: "JVC", deals: 1760, psf: 1250, d30: 0.8, d90: 2.9 },
      { area: "JBR", deals: 190, psf: 2480, d30: -0.6, d90: 2.1 },
      { area: "Arabian Ranches", deals: 140, psf: 1640, d30: 1.9, d90: 5.2 },
      { area: "Dubai South", deals: 1210, psf: 1180, d30: 3.1, d90: 7.4 },
    ],
    sharjah: [
      { area: "Aljada", note: "Monthly SRERD totals" },
      { area: "Al Khan", note: "Monthly SRERD totals" },
    ],
    rising: [
      { area: "Dubai South", d90: 7.4 },
      { area: "Dubai Hills Estate", d90: 6.0 },
      { area: "Arabian Ranches", d90: 5.2 },
      { area: "Al Furjan", d90: 4.9 },
      { area: "MBR City", d90: 4.6 },
    ],
    brief: [
      "Sales rose to <b>1,184 deals (AED 3.9bn)</b> on Tue 29 Sep, 9% above the 7-day average.",
      "Off-plan took <b>69%</b> of deals, up from 65% a week ago.",
      "Median price held at <b>AED 1,586/sqft</b> (+0.4% vs 30 days).",
      "<b>Dubai South</b> is the fastest riser: +7.4% per sqft over 90 days.",
      "JVC 1BR rents <b>+2.1%</b> month on month; gross yield 7.1%.",
    ],
    talking: [
      "Rates didn't move this month, so your financing cost is stable.",
      "NRI buyers: start the remittance paperwork before you book.",
      "Big handover wave this quarter: ready units in JVC are negotiable.",
    ],
    news: [
      {
        impact: "HIGH", cat: "Rates & mortgages", src: "The National", ago: "2h", watch: false,
        head: "Fed holds rates and the UAE central bank follows",
        sum: "The US Federal Reserve left rates unchanged; the CBUAE matched it, as the dirham peg usually requires.",
        why: "mortgage payments for your buyers stay flat this month.",
      },
      {
        impact: "HIGH", cat: "Regulation & fees", src: "Khaleej Times", ago: "5h", watch: true,
        head: "India updates remittance paperwork for residents buying abroad",
        sum: "Banks will ask for extra declarations on large outward transfers under the remittance scheme.",
        why: "NRI clients should start bank paperwork before booking.",
      },
      {
        impact: "MED", cat: "Supply & reports", src: "Gulf News", ago: "7h", watch: true,
        head: "Handover wave lands in JVC and Dubai South this quarter",
        sum: "Several thousand units are due for completion before year-end, most of them apartments.",
        why: "more ready supply is a negotiating point for ready-unit buyers.",
      },
      {
        impact: "MED", cat: "Infrastructure", src: "Arabian Business", ago: "9h", watch: false,
        head: "Metro Blue Line works pass another milestone",
        sum: "RTA reports steady progress on the 14-station line due to open in 2029.",
        why: "areas near the new stations keep their 2029 upside story.",
      },
    ],
    rent: [
      { area: "JVC", type: "1BR", median: "78,000", mom: 2.1, yoy: 9.4, yield: 7.1 },
      { area: "Dubai Marina", type: "1BR", median: "118,000", mom: -0.8, yoy: 5.2, yield: 5.9 },
      { area: "Dubai South", type: "2BR", median: "92,000", mom: 6.2, yoy: 14.8, yield: 7.6, alert: true, n: 48 },
    ],
  };

  const fmt = (n) => Math.round(n).toLocaleString("en-US");

  function niceTicks(min, max, count) {
    const span = max - min;
    const raw = span / count;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw);
    const lo = Math.floor(min / step) * step;
    const hi = Math.ceil(max / step) * step;
    const ticks = [];
    for (let v = lo; v <= hi + 1e-9; v += step) ticks.push(v);
    return ticks;
  }

  // Line chart: single series, 2px line, 10% area wash, end-dot with surface ring,
  // hairline solid gridlines, muted axis text, direct end label (no legend: one series).
  window.lineChart = function (o) {
    const W = o.width, H = o.height;
    const pad = Object.assign({ t: 10, r: 52, b: 24, l: 40 }, o.pad || {});
    const v = o.values;
    const ticks = niceTicks(Math.min(...v), Math.max(...v), 3);
    const y0 = ticks[0], y1 = ticks[ticks.length - 1];
    const x = (i) => pad.l + (i / (v.length - 1)) * (W - pad.l - pad.r);
    const y = (val) => pad.t + (1 - (val - y0) / (y1 - y0)) * (H - pad.t - pad.b);
    const pts = v.map((val, i) => `${x(i).toFixed(1)},${y(val).toFixed(1)}`);
    const line = "M" + pts.join(" L");
    const area = `${line} L${x(v.length - 1).toFixed(1)},${y(y0)} L${x(0).toFixed(1)},${y(y0)} Z`;
    const grid = ticks
      .map((t) => `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(t)}" y2="${y(t)}" stroke="${o.grid}" stroke-width="1"/>
        <text x="${pad.l - 8}" y="${y(t) + 4}" text-anchor="end" font-size="11" fill="${o.muted}" style="font-variant-numeric:tabular-nums">${fmt(t)}</text>`)
      .join("");
    const xl = [
      [0, o.xLabels[0], "start"],
      [Math.floor((v.length - 1) / 2), o.xLabels[1], "middle"],
      [v.length - 1, o.xLabels[2], "end"],
    ]
      .map(([i, t, a]) => `<text x="${x(i)}" y="${H - 6}" text-anchor="${a}" font-size="11" fill="${o.muted}">${t}</text>`)
      .join("");
    const ex = x(v.length - 1), ey = y(v[v.length - 1]);
    return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${o.label}" style="display:block;font-family:${o.font || "inherit"}">
      ${grid}
      <path d="${area}" fill="${o.stroke}" fill-opacity="0.10"/>
      <path d="${line}" fill="none" stroke="${o.stroke}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
      <circle cx="${ex}" cy="${ey}" r="6" fill="${o.surface}"/>
      <circle cx="${ex}" cy="${ey}" r="4" fill="${o.stroke}"/>
      <text x="${ex + 9}" y="${ey + 4}" font-size="12" font-weight="600" fill="${o.ink}" style="font-variant-numeric:tabular-nums">${fmt(v[v.length - 1])}</text>
      ${xl}
    </svg>`;
  };

  // Horizontal bar list: one series = one color, <=24px bars (we use 10px),
  // 4px rounded data-end, square at the baseline, value at the tip in ink.
  window.barList = function (o) {
    const W = o.width, rowH = o.rowH || 30, labelW = o.labelW || 118, thick = o.thick || 10;
    const max = Math.max(...o.items.map((d) => d.value));
    const barMax = W - labelW - 44;
    const H = o.items.length * rowH;
    const rows = o.items
      .map((d, i) => {
        const w = Math.max(6, (d.value / max) * barMax);
        const cy = i * rowH + rowH / 2;
        const r = Math.min(4, thick / 2);
        const x0 = labelW, y0 = cy - thick / 2;
        const path = `M${x0},${y0} H${x0 + w - r} Q${x0 + w},${y0} ${x0 + w},${y0 + r} V${y0 + thick - r} Q${x0 + w},${y0 + thick} ${x0 + w - r},${y0 + thick} H${x0} Z`;
        return `<text x="0" y="${cy + 4}" font-size="12.5" fill="${o.secondary}">${d.name}</text>
          <path d="${path}" fill="${o.color}"/>
          <text x="${x0 + w + 6}" y="${cy + 4}" font-size="12" font-weight="600" fill="${o.ink}" style="font-variant-numeric:tabular-nums">${fmt(d.value)}</text>`;
      })
      .join("");
    return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${o.label}" style="display:block;font-family:${o.font || "inherit"}">${rows}</svg>`;
  };

  // Sparkline: de-emphasis gray line, accent end-dot.
  window.spark = function (vals, o) {
    const W = o.width || 64, H = o.height || 22;
    const mn = Math.min(...vals), mx = Math.max(...vals);
    const x = (i) => 2 + (i / (vals.length - 1)) * (W - 8);
    const y = (v) => 3 + (1 - (v - mn) / (mx - mn || 1)) * (H - 6);
    const d = "M" + vals.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" L");
    const ex = x(vals.length - 1), ey = y(vals[vals.length - 1]);
    return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true" style="display:block">
      <path d="${d}" fill="none" stroke="${o.gray}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>
      <circle cx="${ex}" cy="${ey}" r="4" fill="${o.surface}"/><circle cx="${ex}" cy="${ey}" r="2.5" fill="${o.accent}"/>
    </svg>`;
  };

  window.signed = function (n, unit, dp) {
    const u = unit || "%";
    const arrow = n > 0 ? "▲" : n < 0 ? "▼" : "•";
    const val = Math.abs(n).toFixed(dp !== undefined ? dp : (Math.abs(n) < 10 && n % 1 !== 0 ? 1 : 0));
    return `${arrow}${val}${u === "pts" ? " pts" : u}`;
  };
})();
