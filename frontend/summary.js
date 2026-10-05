// Annual summary tab. Self contained: uses helpers from app.js (state, views, showView,
// showLoading, loadManyDays, isoToday, render) but all calculations are pure and testable.
(function () {
  "use strict";

  // ── Calculations (pure) ─────────────────────────────────────────────────────
  const MAX_GAP_H = 0.5;          // same gap rule as the other tabs
  const CAR_W = 5000, CAR_MIN_H = 20 / 60;   // car: 5 kW or more for at least 20 minutes
  const BAT_W = 1500;             // battery charge estimate: grid import 1.5 kW above consumption

  function percentile(arr, p) {
    if (!arr.length) return 0;
    const s = [...arr].sort((a, b) => a - b);
    return s[Math.max(0, Math.floor((p / 100) * s.length))];
  }
  function baseLoadOf(pts) {      // identical rule to the Base tab
    const v = pts.filter(p => new Date(p.t).getUTCHours() >= 6).map(p => p.cons || 0).filter(x => x > 0);
    return v.length < 5 ? 0 : percentile(v, 10);
  }

  function dayMetrics(day) {
    const pts = (day && day.data_points) || [];
    if (pts.length < 2) return null;
    let solar = 0, cons = 0, imp = 0, exp = 0, car = 0, bat = 0, run = 0, runWh = 0;
    const flush = () => { if (run >= CAR_MIN_H) car += runWh; run = 0; runWh = 0; };
    for (let i = 1; i < pts.length; i++) {
      const dt = (new Date(pts[i].t) - new Date(pts[i - 1].t)) / 3600000;
      if (!(dt > 0 && dt < MAX_GAP_H)) { flush(); continue; }
      const c = pts[i].cons || 0, g = pts[i].grid || 0;
      solar += Math.abs(pts[i].pv || 0) * dt;
      cons += Math.abs(c) * dt;
      if (g > 0) imp += g * dt; else if (g < 0) exp += -g * dt;
      if (Math.abs(c) >= CAR_W) { run += dt; runWh += Math.abs(c) * dt; } else flush();
      if (g > BAT_W && g - c > BAT_W) bat += (g - c) * dt;
    }
    flush();
    return { solar: solar / 1000, cons: cons / 1000, imp: imp / 1000, exp: exp / 1000,
             car: car / 1000, bat: bat / 1000, base: baseLoadOf(pts), n: pts.length, full: pts.length >= 100 };
  }

  function addDaysIso(iso, n) { const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
  function shiftYear(iso, n) { const d = new Date(iso + "T00:00:00Z"); d.setUTCFullYear(d.getUTCFullYear() + n); return d.toISOString().slice(0, 10); }
  function dateRange(a, b) { const o = []; for (let d = a; d <= b; d = addDaysIso(d, 1)) o.push(d); return o; }

  function periods(choice, today) {
    let start, end;
    if (choice === "last12") { end = today; start = addDaysIso(shiftYear(today, -1), 1); }
    else { start = choice + "-01-01"; end = choice + "-12-31" < today ? choice + "-12-31" : today; }
    return { cur: { start, end }, prev: { start: shiftYear(start, -1), end: shiftYear(end, -1) } };
  }

  function aggregate(range, metricsFor) {
    const dates = dateRange(range.start, range.end);
    const A = { days: dates.length, withData: 0, tot: { solar: 0, cons: 0, imp: 0, exp: 0, car: 0, bat: 0, selfNum: 0 },
                bases: [], months: {}, best: { solar: null, cons: null, imp: null } };
    const newBucket = () => ({ solar: 0, cons: 0, imp: 0, exp: 0, selfNum: 0, bases: [], days: 0 });
    for (const d of dates) {
      const m = metricsFor(d);
      if (!m) continue;
      if (m.full) A.withData++;
      const sn = Math.min(m.solar, m.cons);
      for (const k of ["solar", "cons", "imp", "exp", "car", "bat"]) A.tot[k] += m[k];
      A.tot.selfNum += sn;
      if (m.full && m.base > 0) A.bases.push(m.base);
      const key = d.slice(0, 7), b = A.months[key] || (A.months[key] = newBucket());
      for (const k of ["solar", "cons", "imp", "exp"]) b[k] += m[k];
      b.selfNum += sn; b.days++;
      if (m.full && m.base > 0) b.bases.push(m.base);
      if (m.full) {
        if (!A.best.solar || m.solar > A.best.solar.v) A.best.solar = { v: m.solar, d };
        if (!A.best.cons || m.cons > A.best.cons.v) A.best.cons = { v: m.cons, d };
        if (!A.best.imp || m.imp > A.best.imp.v) A.best.imp = { v: m.imp, d };
      }
    }
    const t = A.tot;
    A.stat = {
      solar: t.solar, cons: t.cons, imp: t.imp, exp: t.exp, car: t.car, bat: t.bat,
      consExCar: t.cons - t.car, net: t.imp - t.exp,
      selfSuff: t.cons > 0 ? (t.selfNum / t.cons) * 100 : 0,
      selfCons: t.solar > 0 ? ((t.solar - t.exp) / t.solar) * 100 : 0,
      base: percentile(A.bases, 50),
    };
    return A;
  }

  const api = { dayMetrics, aggregate, periods, dateRange, shiftYear, baseLoadOf, percentile };
  if (typeof document === "undefined") { if (typeof module !== "undefined") module.exports = api; return; }

  // ── UI ───────────────────────────────────────────────────────────────────────
  const $s = id => document.getElementById(id);
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const f0 = v => Math.round(v).toLocaleString("en-GB");
  const f1 = v => v.toFixed(1);
  const kwh = v => `${f0(v)} kWh`;
  const monthLabel = k => `${MON[+k.slice(5, 7) - 1]} ${k.slice(0, 4)}`;
  const dayLabel = d => `${+d.slice(8, 10)} ${MON[+d.slice(5, 7) - 1]} ${d.slice(0, 4)}`;

  views.summary = $s("view-summary");
  let token = 0;

  function fillSelect(today) {
    const sel = $s("sum-period");
    if (sel.options.length) return;
    const thisYear = +today.slice(0, 4);
    sel.innerHTML = `<option value="last12">Last 12 months</option>` +
      Array.from({ length: thisYear - 2024 + 1 }, (_, i) => thisYear - i)
        .map(y => `<option value="${y}">${y}${y === thisYear ? " so far" : ""}</option>`).join("");
    sel.addEventListener("change", () => { state.sumPeriod = sel.value; renderSummary(); });
  }

  function deltaHtml(cur, prev, better, mode, label) {
    if (prev == null) return `<div class="delta neutral">&nbsp;</div>`;
    const diff = mode === "pts" ? cur - prev : (prev > 0 ? ((cur - prev) / prev) * 100 : null);
    if (diff == null) return `<div class="delta neutral">&nbsp;</div>`;
    let cls = "neutral";
    if (better && Math.abs(diff) >= (mode === "pts" ? 0.5 : 1)) cls = (better === "up") === (diff > 0) ? "good" : "bad";
    const txt = mode === "pts" ? `${Math.abs(diff).toFixed(1)} pts` : `${Math.abs(diff).toFixed(1)}%`;
    return `<div class="delta ${cls}">${diff >= 0 ? "▲" : "▼"} ${txt} vs ${label}</div>`;
  }

  function renderCards(cur, prev, canCompare, label) {
    const c = cur.stat, p = canCompare ? prev.stat : null;
    const defs = [
      ["☀️", "Solar generated", kwh(c.solar), c.solar, p && p.solar, "up"],
      ["🏠", "Total consumed", kwh(c.cons), c.cons, p && p.cons, "down"],
      ["🏡", "Consumed excl. car (est.)", kwh(c.consExCar), c.consExCar, p && p.consExCar, "down"],
      ["⬇️", "Grid import", kwh(c.imp), c.imp, p && p.imp, "down"],
      ["🔌", "Grid export", kwh(c.exp), c.exp, p && p.exp, "up"],
      ["⚖️", "Net grid import", kwh(c.net), c.net, p && p.net, "down"],
      ["🔋", "Self sufficiency", `${f0(c.selfSuff)}%`, c.selfSuff, p && p.selfSuff, "up", "pts"],
      ["♻️", "Self consumption", `${f0(c.selfCons)}%`, c.selfCons, p && p.selfCons, "up", "pts"],
      ["📉", "Base load (median)", `${f0(c.base)} W`, c.base, p && p.base, "down"],
      ["🚗", "Car charging (est.)", kwh(c.car), c.car, p && p.car, null],
      ["🔁", "Battery charged from grid (est.)", kwh(c.bat), c.bat, p && p.bat, null],
    ];
    $s("sum-cards").innerHTML = defs.map(([icon, name, val, cv, pv, better, mode]) =>
      `<div class="card sum-card"><div class="card-top"><span class="card-icon">${icon}</span><span class="card-label">${name}</span></div>` +
      `<div class="card-value">${val}</div>${deltaHtml(cv, pv, better, mode, label)}</div>`).join("");
  }

  function renderTable(cur, prev, canCompare, today) {
    const keys = Object.keys(cur.months).sort();
    const pk = k => shiftYear(k + "-01", -1).slice(0, 7);
    const cell = (v, pv, fmt) => `${fmt(v)}${canCompare && pv != null ? `<span class="prev">${fmt(pv)}</span>` : ""}`;
    const rows = keys.map(k => {
      const m = cur.months[k], q = prev.months[pk(k)];
      const pct = x => x && x.cons > 0 ? Math.round(x.selfNum / x.cons * 100) : null;
      const base = x => x && x.bases.length ? percentile(x.bases, 50) : null;
      const selfv = pct(m), bv = base(m);
      return `<tr><td>${monthLabel(k)}${k === today.slice(0, 7) ? " <span class=\"prev\">to date</span>" : ""}</td>` +
        `<td>${cell(m.solar, q && q.solar, f0)}</td><td>${cell(m.cons, q && q.cons, f0)}</td>` +
        `<td>${cell(m.imp, q && q.imp, f0)}</td><td>${cell(m.exp, q && q.exp, f0)}</td>` +
        `<td>${selfv == null ? "–" : cell(selfv, pct(q), v => v + "%")}</td>` +
        `<td>${bv == null ? "–" : cell(bv, base(q), f0)}</td></tr>`;
    }).join("");
    $s("sum-table").innerHTML = `<table class="sum-table"><thead><tr><th>Month</th><th>Solar kWh</th><th>Consumed kWh</th>` +
      `<th>Import kWh</th><th>Export kWh</th><th>Self suff.</th><th>Base W</th></tr></thead><tbody>${rows}</tbody></table>`;
  }

  function renderHighlights(cur) {
    const bm = Object.entries(cur.months).map(([k, m]) => [k, m.bases.length ? percentile(m.bases, 50) : null]).filter(x => x[1]);
    const lowBase = bm.sort((a, b) => a[1] - b[1])[0], highBase = bm[bm.length - 1];
    const items = [
      ["☀️ Best solar day", cur.best.solar && kwh(cur.best.solar.v), cur.best.solar && dayLabel(cur.best.solar.d)],
      ["🏠 Highest consumption", cur.best.cons && kwh(cur.best.cons.v), cur.best.cons && dayLabel(cur.best.cons.d)],
      ["⬇️ Highest import day", cur.best.imp && kwh(cur.best.imp.v), cur.best.imp && dayLabel(cur.best.imp.d)],
      ["📉 Lowest base load month", lowBase && `${f0(lowBase[1])} W`, lowBase && monthLabel(lowBase[0])],
    ].filter(x => x[1]);
    $s("sum-highlights").innerHTML = items.map(([l, v, d]) =>
      `<div class="month-total-card"><div class="label">${l}</div><div class="val" style="color:var(--text);font-size:20px">${v}</div>` +
      `<div style="font-size:12px;color:var(--muted);margin-top:4px">${d}</div></div>`).join("");
  }

  async function renderSummary() {
    const my = ++token;
    const today = isoToday();
    fillSelect(today);
    const choice = state.sumPeriod || "last12";
    $s("sum-period").value = choice;
    showLoading();
    const { cur: cr, prev: pr } = periods(choice, today);
    const dates = [...dateRange(cr.start, cr.end), ...dateRange(pr.start, pr.end)];
    const note = document.querySelector("#loading p");
    const days = {};
    for (let i = 0; i < dates.length; i += 30) {
      if (note) note.textContent = `Loading data… ${Math.min(i, dates.length)} of ${dates.length} days`;
      Object.assign(days, await loadManyDays(dates.slice(i, i + 30)));
      if (my !== token) return;
    }
    if (note) note.textContent = "Loading data…";
    const mf = d => dayMetrics(days[d]);
    const cur = aggregate(cr, mf), prev = aggregate(pr, mf);
    const canCompare = prev.withData >= 0.8 * prev.days;
    const label = choice === "last12" ? "previous 12 months" : String(+choice - 1);
    $s("sum-title").textContent = choice === "last12" ? "Last 12 months" : `${choice}${cr.end < choice + "-12-31" ? " so far" : ""}`;
    $s("sum-sub").textContent = `${dayLabel(cr.start)} to ${dayLabel(cr.end)} · ${cur.withData} of ${cur.days} days with data` +
      (canCompare ? ` · compared with ${dayLabel(pr.start)} to ${dayLabel(pr.end)}` : " · no full comparison period available");
    renderCards(cur, prev, canCompare, label);
    renderTable(cur, prev, canCompare, today);
    renderHighlights(cur);
    $s("sum-note").innerHTML = "Self sufficiency is the share of consumption met by same day solar, as on the other tabs. " +
      "Car charging is estimated from sustained draws of 5 kW or more, and battery charging from grid import more than 1.5 kW above consumption. " +
      "Muted figures in the table are the comparison period. First and last months may be part months.";
    if (state.tab === "summary") showView("summary");
  }

  const prevRender = render;
  render = function () { if (state.tab === "summary") renderSummary(); else prevRender(); };
})();
