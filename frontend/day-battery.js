// Adds a battery charge level chart to the Day tab. Wraps renderDay from app.js, so app.js is unchanged.
(function () {
  "use strict";
  const prevDay = renderDay;
  renderDay = async function (dateStr) {
    await prevDay(dateStr);
    const section = $("battery-section");
    try {
      const day = await loadDay(dateStr);
      const pts = (day && day.data_points) || [];
      const known = pts.filter(p => p.soc != null);
      if (!known.length) { if (section) section.style.display = "none"; return; }
      const step = pts.length > 200 ? 2 : 1;
      const thin = pts.filter((_, i) => i % step === 0);
      const ds = lineDs("Charge level", thin.map(p => p.soc == null ? null : p.soc), COLORS.battery);
      ds.spanGaps = true;
      mkChart("chart-soc", { type: "line", data: { labels: thin.map(p => shortTime(p.t)), datasets: [ds] },
                             options: lineOpts(v => fmtPct(v), 0, 100) });
      const first = known[0], last = known[known.length - 1];
      setText("battery-summary", `${fmtPct(first.soc)} at ${shortTime(first.t)} to ${fmtPct(last.soc)} at ${shortTime(last.t)} · ` +
        `charged ${fmtKwh(calcKwhNeg(known, "bat"))} · discharged ${fmtKwh(calcKwhPos(known, "bat"))}`);
      if (section) section.style.display = "";
    } catch (e) { if (section) section.style.display = "none"; }
  };
  // The first render of today starts before this script is loaded, so draw the Day tab again once.
  if (typeof state !== "undefined" && state.tab === "day" && typeof render === "function") setTimeout(() => render(), 0);
})();
