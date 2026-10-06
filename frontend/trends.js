// Trends tab: year on year line charts of monthly or cumulative totals. Uses helpers from app.js
// (state, views, showView, showLoading, loadManyDays, isoToday, render, mkChart, COLORS) and the
// per day calculations exposed by summary.js as window.SummaryCalc.
(function () {
  "use strict";

  const FIRST_YEAR = 2024;
  const YEAR_COLORS = { 2024: "#f59e0b", 2025: "#10b981", 2026: "#3b82f6", 2027: "#8b5cf6", 2028: "#06b6d4" };
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const ESTIMATE_END = "2024-06-12";   // days up to here come from the battery inverter's own readings
  const CHARTS = [
    { key: "solar", title: "Solar generated" },
    { key: "cons", title: "Total consumed" },
    { key: "imp", title: "Grid import" },
    { key: "exp", title: "Grid export" },
    { key: "net", title: "Net grid import (import minus export)" },
    { key: "car", title: "Car charging (est.)" },
    { key: "batAll", title: "Battery charged (total)" },
  ];

  // Pure helpers
  function monthlyTotals(dates, metricsFor) {
    const out = {};   // year -> month index -> sums
    for (const d of dates) {
      const m = metricsFor(d);
      if (!m) continue;
      const y = +d.slice(0, 4), mi = +d.slice(5, 7) - 1;
      const b = ((out[y] = out[y] || {})[mi] = out[y][mi] || { solar: 0, cons: 0, imp: 0, exp: 0, car: 0, batAll: 0, days: 0 });
      for (const k of ["solar", "cons", "imp", "exp", "car", "batAll"]) b[k] += m[k];
      b.days++;
    }
    return out;
  }
  function value(b, key) { return key === "net" ? b.imp - b.exp : b[key]; }

  // One series per year: 12 values (null where there is no data). Cumulative stops at the last month with data.
  function series(totals, year, key, mode) {
    const months = totals[year] || {};
    const data = Array(12).fill(null);
    let run = 0, last = -1;
    for (let i = 0; i < 12; i++) if (months[i]) last = i;
    for (let i = 0; i <= last; i++) {
      const b = months[i];
      if (mode === "cumulative") { run += b ? value(b, key) : 0; data[i] = run; }
      else data[i] = b ? value(b, key) : null;
    }
    return { data, last };
  }

  const api = { monthlyTotals, series, value };
  if (typeof document === "undefined") { if (typeof module !== "undefined") module.exports = api; return; }

  // UI
  const $t = id => document.getElementById(id);
  const f0 = v => Math.round(v).toLocaleString("en-GB");
  views.trends = $t("view-trends");
  let token = 0;

  function buildShell() {
    const holder = $t("tr-charts");
    if (holder.children.length) return;
    holder.innerHTML = CHARTS.map(c =>
      `<section class="chart-section"><div class="chart-header"><h2>${c.title} (kWh)</h2></div>` +
      `<div class="chart-wrap"><canvas id="chart-tr-${c.key}"></canvas></div></section>`).join("");
    const sel = $t("tr-mode");
    sel.addEventListener("change", () => { state.trMode = sel.value; renderTrends(); });
  }

  function chartConfig(totals, years, key, mode, todayIso) {
    const nowYear = +todayIso.slice(0, 4), nowMonth = +todayIso.slice(5, 7) - 1;
    return {
      type: "line",
      data: {
        labels: MONTHS,
        datasets: years.map(y => {
          const { data } = series(totals, y, key, mode);
          return {
            label: String(y), data, borderColor: YEAR_COLORS[y] || COLORS.muted, backgroundColor: "transparent",
            borderWidth: 2.5, pointRadius: 3, pointHoverRadius: 5, tension: 0.3, spanGaps: true, fill: false,
            segment: { borderDash: ctx => {
              const i = ctx.p1DataIndex;
              if (y === FIRST_YEAR && i <= 5) return [3, 3];                 // estimate period, dotted
              if (y === nowYear && i === nowMonth) return [6, 4];            // current month to date, dashed
              return undefined;
            } },
          };
        }),
      },
      options: {
        responsive: true, maintainAspectRatio: false, animation: { duration: 300 },
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { display: true, labels: { color: COLORS.muted, font: { size: 12 } } },
          tooltip: { backgroundColor: "#0f1729", borderColor: COLORS.border, borderWidth: 1,
                     callbacks: { label: c => c.parsed.y == null ? null : ` ${c.dataset.label}: ${f0(c.parsed.y)} kWh` } },
        },
        scales: {
          x: { grid: { color: COLORS.border }, ticks: { color: COLORS.muted, font: { size: 11 } } },
          y: { grid: { color: COLORS.border }, ticks: { color: COLORS.muted, font: { size: 11 }, callback: v => f0(v) } },
        },
      },
    };
  }

  async function renderTrends() {
    const my = ++token;
    buildShell();
    const mode = state.trMode || "monthly";
    $t("tr-mode").value = mode;
    showLoading();
    const today = isoToday();
    const nowYear = +today.slice(0, 4);
    const years = Array.from({ length: nowYear - FIRST_YEAR + 1 }, (_, i) => FIRST_YEAR + i);
    const dates = window.SummaryCalc.dateRange(FIRST_YEAR + "-01-01", today);
    const note = document.querySelector("#loading p");
    const days = {};
    for (let i = 0; i < dates.length; i += 30) {
      if (note) note.textContent = `Loading data… ${Math.min(i, dates.length)} of ${dates.length} days`;
      Object.assign(days, await loadManyDays(dates.slice(i, i + 30)));
      if (my !== token) return;
    }
    if (note) note.textContent = "Loading data…";
    const totals = monthlyTotals(dates, d => window.SummaryCalc.dayMetrics(days[d]));
    for (const c of CHARTS) mkChart(`chart-tr-${c.key}`, chartConfig(totals, years, c.key, mode, today));
    $t("tr-sub").textContent = (mode === "monthly" ? "Monthly totals" : "Running total through the year") +
      ` · ${years.join(", ")} · click a year in a chart legend to hide or show its line`;
    $t("tr-note").textContent = "Dotted line: before mid June 2024 the figures come from the battery inverter's own readings, so they are close estimates. " +
      "Dashed line: the current month so far. Car charging is estimated from sustained draws of 5 kW or more, less base load.";
    if (state.tab === "trends") showView("trends");
  }

  const prevRender = render;
  render = function () { if (state.tab === "trends") renderTrends(); else prevRender(); };
})();
