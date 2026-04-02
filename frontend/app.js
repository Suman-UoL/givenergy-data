const DATA_BASE="data";
const COLORS={solar:"#f59e0b",consumption:"#f43f5e",battery:"#10b981",grid:"#3b82f6",export:"#8b5cf6",charge:"#06b6d4",muted:"#64748b",border:"#1a2540",text:"#e2e8f0"};
Chart.defaults.color=COLORS.muted;
Chart.defaults.borderColor=COLORS.border;
Chart.defaults.font.family="'JetBrains Mono',monospace";
Chart.defaults.plugins.legend.display=false;

const chartInstances={};
function destroyChart(id){if(chartInstances[id]){chartInstances[id].destroy();delete chartInstances[id];}}
function mkChart(id,config){destroyChart(id);const ctx=document.getElementById(id).getContext("2d");chartInstances[id]=new Chart(ctx,config);return chartInstances[id];}

const fmtKwh=v=>`${Math.abs(Number(v)||0).toFixed(2)} kWh`;
const fmtW=v=>{const n=Number(v)||0;return Math.abs(n)>=1000?`${(n/1000).toFixed(2)} kW`:`${Math.round(n)} W`;};
const fmtPct=v=>`${Math.round(Number(v)||0)}%`;
function isoToday(){return new Date().toISOString().slice(0,10);}
function addDays(iso,n){const d=new Date(iso);d.setDate(d.getDate()+n);return d.toISOString().slice(0,10);}
function shortTime(iso){if(!iso)return "";return iso.length>5?iso.slice(11,16):iso.slice(0,5);}

function calcKwh(pts,key){
  if(!pts||pts.length<2)return 0;
  let total=0;
  for(let i=1;i<pts.length;i++){
    const dt=(new Date(pts[i].t)-new Date(pts[i-1].t))/3600000;
    if(dt>0&&dt<0.5)total+=Math.abs(pts[i][key]||0)*dt;
  }
  return total/1000;
}
function calcKwhPos(pts,key){
  if(!pts||pts.length<2)return 0;
  let total=0;
  for(let i=1;i<pts.length;i++){
    const dt=(new Date(pts[i].t)-new Date(pts[i-1].t))/3600000;
    if(dt>0&&dt<0.5){const v=pts[i][key]||0;if(v>0)total+=v*dt;}
  }
  return total/1000;
}
function calcKwhNeg(pts,key){
  if(!pts||pts.length<2)return 0;
  let total=0;
  for(let i=1;i<pts.length;i++){
    const dt=(new Date(pts[i].t)-new Date(pts[i-1].t))/3600000;
    if(dt>0&&dt<0.5){const v=pts[i][key]||0;if(v<0)total+=Math.abs(v)*dt;}
  }
  return total/1000;
}

const cache={};
async function loadDay(dateStr){
  if(cache[dateStr])return cache[dateStr];
  const r=await fetch(`${DATA_BASE}/${dateStr}.json`);
  if(!r.ok)throw new Error(`No data for ${dateStr}`);
  const json=await r.json();cache[dateStr]=json;return json;
}
async function loadManyDays(dates){
  const result={};
  await Promise.allSettled(dates.map(async d=>{try{result[d]=await loadDay(d);}catch{result[d]=null;}}));
  return result;
}

// ── Open-Meteo temperature fetching ─────────────────────────────────────────
const tempCache = {};

async function fetchTemps(startDate, endDate) {
  const key = `${startDate}_${endDate}`;
  if (tempCache[key]) return tempCache[key];
  const url = `https://archive-api.open-meteo.com/v1/archive?latitude=53.8008&longitude=-1.5491&start_date=${startDate}&end_date=${endDate}&daily=temperature_2m_max,temperature_2m_min,temperature_2m_mean&timezone=Europe%2FLondon`;
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error("Temp fetch failed");
    const data = await r.json();
    const result = {};
    const dates = data.daily.time || [];
    dates.forEach((date, i) => {
      result[date] = {
        max:  data.daily.temperature_2m_max[i],
        min:  data.daily.temperature_2m_min[i],
        mean: data.daily.temperature_2m_mean[i],
      };
    });
    tempCache[key] = result;
    return result;
  } catch(e) {
    console.warn("Temperature data unavailable:", e);
    return {};
  }
}

const state={tab:"day",selectedDate:isoToday()};
const $=id=>document.getElementById(id);
const loading=$("loading"),errorState=$("error-state"),errorMsg=$("error-msg");
const views={day:$("view-day"),week:$("view-week"),month:$("view-month"),year:$("view-year")};

function showLoading(){loading.classList.remove("hidden");errorState.classList.add("hidden");Object.values(views).forEach(v=>v&&v.classList.add("hidden"));}
function showError(msg){loading.classList.add("hidden");errorState.classList.remove("hidden");errorMsg.textContent=msg;Object.values(views).forEach(v=>v&&v.classList.add("hidden"));}
function showView(name){loading.classList.add("hidden");errorState.classList.add("hidden");Object.entries(views).forEach(([k,v])=>{if(v)k===name?v.classList.remove("hidden"):v.classList.add("hidden");});}
function setText(id,val){const el=$(id);if(el)el.textContent=val;}

function lineDs(label,data,color,dashed=false){
  return{label,data,borderColor:color,backgroundColor:color+"22",borderWidth:2,pointRadius:0,fill:true,tension:0.3,borderDash:dashed?[4,3]:[]};
}
function barDs(label,data,color,stackId="a"){
  return{label,data,backgroundColor:color+"cc",stack:stackId};
}
function lineOpts(formatter,min,max){
  return{responsive:true,maintainAspectRatio:false,animation:{duration:300},interaction:{mode:"index",intersect:false},
    scales:{x:{grid:{color:COLORS.border},ticks:{maxTicksLimit:12,color:COLORS.muted,font:{size:11}}},
      y:{min,max,grid:{color:COLORS.border},ticks:{color:COLORS.muted,font:{size:11},callback:formatter}}},
    plugins:{tooltip:{backgroundColor:"#0f1729",borderColor:COLORS.border,borderWidth:1,
      callbacks:{label:ctx=>` ${ctx.dataset.label}: ${formatter(ctx.parsed.y)}`}}}};
}
function barOpts(formatter,stacked=true,min,max){
  return{responsive:true,maintainAspectRatio:false,animation:{duration:300},interaction:{mode:"index",intersect:false},
    scales:{x:{stacked,grid:{color:COLORS.border},ticks:{maxTicksLimit:16,color:COLORS.muted,font:{size:11}}},
      y:{min,max,stacked,grid:{color:COLORS.border},ticks:{color:COLORS.muted,font:{size:11},callback:formatter}}},
    plugins:{tooltip:{backgroundColor:"#0f1729",borderColor:COLORS.border,borderWidth:1,
      callbacks:{label:ctx=>` ${ctx.dataset.label}: ${formatter(ctx.parsed.y)}`}}}};
}

async function renderDay(dateStr){
  showLoading();
  let day;
  try{day=await loadDay(dateStr);}
  catch(e){showError(`No data for ${dateStr} yet. The fetcher runs every 30 minutes.`);return;}
  const pts=day.data_points||[];
  const totalSolar=calcKwh(pts,"pv");
  const totalConsumed=calcKwh(pts,"cons");
  const totalImported=calcKwhPos(pts,"grid");
  const totalExported=calcKwhNeg(pts,"grid");
  const selfSuffPct=totalConsumed>0?Math.min(100,(totalSolar/totalConsumed)*100):0;
  let peakSolar=0,peakTime="";
  for(const p of pts){if((p.pv||0)>peakSolar){peakSolar=p.pv;peakTime=shortTime(p.t);}}
  setText("val-solar",fmtKwh(totalSolar));
  setText("val-consumed",fmtKwh(totalConsumed));
  setText("val-exported",fmtKwh(totalExported));
  setText("val-imported",fmtKwh(totalImported));
  setText("val-selfuse",fmtPct(selfSuffPct));
  setText("val-peak-solar",fmtW(peakSolar));
  setText("sub-peak-solar",peakTime?`at ${peakTime}`:"");
  setText("last-updated",day.fetched_at?`Updated ${day.fetched_at.slice(0,16).replace("T"," ")} UTC`:"");
  const step=pts.length>200?2:1;
  const thinPts=pts.filter((_,i)=>i%step===0);
  const thinLabels=thinPts.map(p=>shortTime(p.t));
  mkChart("chart-power",{type:"line",data:{labels:thinLabels,datasets:[
    lineDs("Solar",thinPts.map(p=>p.pv||0),COLORS.solar),
    lineDs("Consumption",thinPts.map(p=>p.cons||0),COLORS.consumption),
    lineDs("Battery (±)",thinPts.map(p=>p.bat||0),COLORS.battery,true),
    lineDs("Grid (±)",thinPts.map(p=>p.grid||0),COLORS.grid,true),
  ]},options:lineOpts(v=>fmtW(v))});

  showView("day");
}

async function renderWeek(anchorDate){
  showLoading();
  const dates=Array.from({length:7},(_,i)=>addDays(anchorDate,-6+i));
  const days=await loadManyDays(dates);
  const labels=dates.map(d=>d.slice(5));
  const solar=dates.map(d=>days[d]?calcKwh(days[d].data_points,"pv"):0);
  const consumed=dates.map(d=>days[d]?calcKwh(days[d].data_points,"cons"):0);
  const imported=dates.map(d=>days[d]?calcKwhPos(days[d].data_points,"grid"):0);
  const exported=dates.map(d=>days[d]?calcKwhNeg(days[d].data_points,"grid"):0);
  const selfSuff=dates.map((_,i)=>consumed[i]>0?Math.min(100,(solar[i]/consumed[i])*100):0);
  mkChart("chart-week",{type:"bar",data:{labels,datasets:[
    barDs("Solar",solar,COLORS.solar),
    barDs("Consumed",consumed,COLORS.consumption,"b"),
    barDs("Exported",exported,COLORS.export,"c"),
    barDs("Imported",imported,COLORS.grid,"c"),
  ]},options:barOpts(v=>`${v.toFixed(2)} kWh`,false)});
  mkChart("chart-week-self",{type:"bar",data:{labels,datasets:[
    barDs("Self-sufficiency %",selfSuff,COLORS.battery)
  ]},options:barOpts(v=>`${v.toFixed(0)}%`,false,0,100)});
  showView("week");
}

async function renderMonth(anchorDate){
  showLoading();
  const anchor=new Date(anchorDate);
  const year=anchor.getFullYear(),month=anchor.getMonth();
  const daysInMonth=new Date(year,month+1,0).getDate();
  const pad=n=>String(n).padStart(2,"0");
  const dates=Array.from({length:daysInMonth},(_,i)=>`${year}-${pad(month+1)}-${pad(i+1)}`).filter(d=>d<=isoToday());
  const days=await loadManyDays(dates);
  const labels=dates.map(d=>d.slice(8));
  const solar=dates.map(d=>days[d]?calcKwh(days[d].data_points,"pv"):0);
  const consumed=dates.map(d=>days[d]?calcKwh(days[d].data_points,"cons"):0);
  const exported=dates.map(d=>days[d]?calcKwhNeg(days[d].data_points,"grid"):0);
  const imported=dates.map(d=>days[d]?calcKwhPos(days[d].data_points,"grid"):0);
  mkChart("chart-month",{type:"bar",data:{labels,datasets:[
    barDs("Solar",solar,COLORS.solar),
    barDs("Consumed",consumed,COLORS.consumption,"b"),
    barDs("Exported",exported,COLORS.export,"c"),
    barDs("Imported",imported,COLORS.grid,"c"),
  ]},options:barOpts(v=>`${v.toFixed(2)} kWh`,false)});
  const tSolar=solar.reduce((a,b)=>a+b,0);
  const tConsumed=consumed.reduce((a,b)=>a+b,0);
  const tExported=exported.reduce((a,b)=>a+b,0);
  const tImported=imported.reduce((a,b)=>a+b,0);
  const selfSuff=tConsumed>0?Math.min(100,(tSolar/tConsumed)*100):0;
  $("month-totals").innerHTML=[
    {label:"Solar Generated",val:fmtKwh(tSolar),color:COLORS.solar},
    {label:"Total Consumed",val:fmtKwh(tConsumed),color:COLORS.consumption},
    {label:"Grid Exported",val:fmtKwh(tExported),color:COLORS.export},
    {label:"Grid Imported",val:fmtKwh(tImported),color:COLORS.grid},
    {label:"Self-sufficiency",val:fmtPct(selfSuff),color:COLORS.battery},
  ].map(({label,val,color})=>`<div class="month-total-card"><div class="label">${label}</div><div class="val" style="color:${color}">${val}</div></div>`).join("");
  showView("month");
}

async function renderYear(anchorDate){
  showLoading();
  const pad=n=>String(n).padStart(2,"0");
  const months=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const years=[2024,2025,2026];
  const yearColors={2024:COLORS.solar,2025:COLORS.battery,2026:COLORS.grid};

  // Build all dates needed
  const allDates=[];
  for(const year of years){
    for(let m=1;m<=12;m++){
      const daysInMonth=new Date(year,m,0).getDate();
      for(let d=1;d<=daysInMonth;d++){
        const iso=`${year}-${pad(m)}-${pad(d)}`;
        if(iso<=isoToday())allDates.push(iso);
      }
    }
  }

  // Load in batches of 30
  const allDays={};
  for(let i=0;i<allDates.length;i+=30){
    const batch=allDates.slice(i,i+30);
    Object.assign(allDays,await loadManyDays(batch));
  }

  // Aggregate by year+month
  const agg={};
  for(const year of years){
    for(let m=1;m<=12;m++){
      const key=`${year}-${pad(m)}`;
      agg[key]={solar:0,consumed:0,imported:0,exported:0};
      const daysInMonth=new Date(year,m,0).getDate();
      for(let d=1;d<=daysInMonth;d++){
        const iso=`${year}-${pad(m)}-${pad(d)}`;
        if(iso>isoToday())continue;
        const day=allDays[iso];
        if(!day)continue;
        const pts=day.data_points||[];
        if(pts.length<2)continue;
        agg[key].solar+=calcKwh(pts,"pv");
        agg[key].consumed+=calcKwh(pts,"cons");
        agg[key].imported+=calcKwhPos(pts,"grid");
        agg[key].exported+=calcKwhNeg(pts,"grid");
      }
    }
  }

  // Solar by year
  mkChart("chart-year-solar",{type:"bar",data:{labels:months,datasets:years.map(year=>({
    label:`${year}`,
    data:Array.from({length:12},(_,i)=>{const k=`${year}-${pad(i+1)}`;return agg[k]?agg[k].solar:0;}),
    backgroundColor:yearColors[year]+"cc",
  }))},options:barOpts(v=>`${v.toFixed(0)} kWh`,false)});

  // Consumption by year
  mkChart("chart-year-cons",{type:"bar",data:{labels:months,datasets:years.map(year=>({
    label:`${year}`,
    data:Array.from({length:12},(_,i)=>{const k=`${year}-${pad(i+1)}`;return agg[k]?agg[k].consumed:0;}),
    backgroundColor:yearColors[year]+"cc",
  }))},options:barOpts(v=>`${v.toFixed(0)} kWh`,false)});

  // Grid import vs export (all years)
  mkChart("chart-year-grid",{type:"bar",data:{labels:months,datasets:years.flatMap(year=>[
    {label:`${year} Import`,data:Array.from({length:12},(_,i)=>{const k=`${year}-${pad(i+1)}`;return agg[k]?agg[k].imported:0;}),backgroundColor:yearColors[year]+"99"},
    {label:`${year} Export`,data:Array.from({length:12},(_,i)=>{const k=`${year}-${pad(i+1)}`;return agg[k]?agg[k].exported:0;}),backgroundColor:yearColors[year]+"44"},
  ])},options:barOpts(v=>`${v.toFixed(0)} kWh`,false)});

  // Self-sufficiency by year
  mkChart("chart-year-self",{type:"bar",data:{labels:months,datasets:years.map(year=>({
    label:`${year}`,
    data:Array.from({length:12},(_,i)=>{
      const k=`${year}-${pad(i+1)}`;
      const a=agg[k];
      if(!a||a.consumed===0)return 0;
      return Math.min(100,(a.solar/a.consumed)*100);
    }),
    backgroundColor:yearColors[year]+"cc",
  }))},options:barOpts(v=>`${v.toFixed(0)}%`,false,0,100)});

  // Records
  let bestSolar={date:"",val:0},bestExport={date:"",val:0},highCons={date:"",val:0};
  for(const iso of allDates){
    const day=allDays[iso];
    if(!day)continue;
    const pts=day.data_points||[];
    if(pts.length<2)continue;
    const s=calcKwh(pts,"pv"),e=calcKwhNeg(pts,"grid"),c=calcKwh(pts,"cons");
    if(s>bestSolar.val)bestSolar={date:iso,val:s};
    if(e>bestExport.val)bestExport={date:iso,val:e};
    if(c>highCons.val)highCons={date:iso,val:c};
  }
  $("year-records").innerHTML=[
    {icon:"☀️",label:"Best Solar Day",val:fmtKwh(bestSolar.val),date:bestSolar.date},
    {icon:"🔌",label:"Best Export Day",val:fmtKwh(bestExport.val),date:bestExport.date},
    {icon:"🏠",label:"Highest Consumption",val:fmtKwh(highCons.val),date:highCons.date},
  ].map(({icon,label,val,date})=>`<div class="month-total-card"><div class="label">${icon} ${label}</div><div class="val" style="color:var(--text);font-size:20px">${val}</div><div style="font-size:12px;color:var(--muted);margin-top:4px">${date}</div></div>`).join("");

  showView("year");
}

function render(){
  const d=state.selectedDate;
  if(state.tab==="day")renderDay(d);
  else if(state.tab==="week")renderWeek(d);
  else if(state.tab==="month")renderMonth(d);
  else if(state.tab==="year")renderYear(d);
}

document.querySelectorAll(".tab").forEach(btn=>{
  btn.addEventListener("click",()=>{
    document.querySelectorAll(".tab").forEach(b=>b.classList.remove("active"));
    btn.classList.add("active");
    state.tab=btn.dataset.tab;
    render();
  });
});
$("date-picker").addEventListener("change",e=>{state.selectedDate=e.target.value;render();});
$("prev-date").addEventListener("click",()=>{state.selectedDate=addDays(state.selectedDate,-1);$("date-picker").value=state.selectedDate;render();});
$("next-date").addEventListener("click",()=>{const next=addDays(state.selectedDate,1);if(next<=isoToday()){state.selectedDate=next;$("date-picker").value=state.selectedDate;render();}});
$("today-btn").addEventListener("click",()=>{state.selectedDate=isoToday();$("date-picker").value=state.selectedDate;render();});

(async()=>{
  const dp=$("date-picker");
  dp.value=state.selectedDate;
  dp.max=state.selectedDate;
  render();
})();

// ── Base load analysis ────────────────────────────────────────────────────────

function percentile(arr, p) {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.floor((p / 100) * sorted.length);
  return sorted[Math.max(0, idx)];
}

function baseLoad(pts) {
  // Exclude 00:00-06:00 (overnight charging window)
  // Use 10th percentile of remaining readings as true base load
  const daytime = (pts || []).filter(p => {
    const h = new Date(p.t).getUTCHours();
    return h >= 6;
  }).map(p => p.cons || 0).filter(v => v > 0);
  if (daytime.length < 5) return 0;
  return percentile(daytime, 10);
}

function histogram(pts, bins = 20) {
  // Exclude 00:00-06:00 charging window, cap at 2000W
  const cons = (pts || []).filter(p => {
    const h = new Date(p.t).getUTCHours();
    return h >= 6;
  }).map(p => p.cons || 0).filter(v => v >= 0);
  if (!cons.length) return { labels: [], data: [] };
  const min = 0;
  const max = 1000; // cap at 1kW for better resolution
  const binSize = (max - min) / bins;
  const counts = Array(bins).fill(0);
  for (const v of cons) {
    if (v > max) continue;
    const idx = Math.min(bins - 1, Math.floor((v - min) / binSize));
    counts[idx]++;
  }
  const labels = Array.from({ length: bins }, (_, i) =>
    `${Math.round(min + i * binSize)}W`
  );
  return { labels, data: counts };
}

async function renderBase() {
  showLoading();
  const pad = n => String(n).padStart(2, "0");
  const years = [2024, 2025, 2026];
  const yearColors = { 2024: COLORS.solar, 2025: COLORS.battery, 2026: COLORS.grid };
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

  // Build all dates
  const allDates = [];
  for (const year of years) {
    for (let m = 1; m <= 12; m++) {
      const dim = new Date(year, m, 0).getDate();
      for (let d = 1; d <= dim; d++) {
        const iso = `${year}-${pad(m)}-${pad(d)}`;
        if (iso <= isoToday()) allDates.push(iso);
      }
    }
  }

  // Load in batches
  const allDays = {};
  for (let i = 0; i < allDates.length; i += 30) {
    Object.assign(allDays, await loadManyDays(allDates.slice(i, i + 30)));
  }

  // Calculate daily base load
  const dailyBase = {};
  for (const iso of allDates) {
    const day = allDays[iso];
    if (!day) continue;
    const bl = baseLoad(day.data_points);
    if (bl > 0) dailyBase[iso] = bl;
  }

  // Chart 1: Daily base load trend (last 90 days) with 7-day rolling average + temperature
  const recentDates = allDates.filter(d => d >= addDays(isoToday(), -90));
  const trendLabels = recentDates.map(d => d.slice(5));
  const trendData = recentDates.map(d => dailyBase[d] || null);

  function rollingAvg(data, window) {
    return data.map((_, i) => {
      const slice = data.slice(Math.max(0, i - window + 1), i + 1).filter(v => v !== null);
      return slice.length ? slice.reduce((a, b) => a + b, 0) / slice.length : null;
    });
  }
  const trendSmooth = rollingAvg(trendData, 7);

  // Fetch temperatures for trend period
  const trendTemps = await fetchTemps(recentDates[0], recentDates[recentDates.length-1]);
  const tempMax  = recentDates.map(d => trendTemps[d]?.max  ?? null);
  const tempMin  = recentDates.map(d => trendTemps[d]?.min  ?? null);
  const tempMean = recentDates.map(d => trendTemps[d]?.mean ?? null);

  mkChart("chart-base-trend", {
    type: "line",
    data: {
      labels: trendLabels,
      datasets: [
        {
          label: "Daily base load",
          data: trendData,
          borderColor: COLORS.consumption + "44",
          backgroundColor: "transparent",
          borderWidth: 1,
          pointRadius: 0,
          tension: 0.3,
          spanGaps: true,
          yAxisID: "y",
        },
        {
          label: "7-day average",
          data: trendSmooth,
          borderColor: COLORS.consumption,
          backgroundColor: COLORS.consumption + "22",
          borderWidth: 2.5,
          pointRadius: 0,
          fill: true,
          tension: 0.4,
          spanGaps: true,
          yAxisID: "y",
        },
        {
          label: "Temp max °C",
          data: tempMax,
          borderColor: "#f97316cc",
          backgroundColor: "#f9731622",
          borderWidth: 1.5,
          pointRadius: 0,
          tension: 0.4,
          spanGaps: true,
          yAxisID: "yTemp",
          fill: "+1",
        },
        {
          label: "Temp min °C",
          data: tempMin,
          borderColor: "#38bdf8cc",
          backgroundColor: "#38bdf822",
          borderWidth: 1.5,
          pointRadius: 0,
          tension: 0.4,
          spanGaps: true,
          yAxisID: "yTemp",
          fill: false,
        },
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false, animation: { duration: 300 },
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { display: true, labels: { color: COLORS.muted, font: { size: 12 } } },
        tooltip: {
          backgroundColor: "#0f1729", borderColor: COLORS.border, borderWidth: 1,
          callbacks: {
            label: ctx => {
              if (ctx.dataset.yAxisID === "yTemp") return ` ${ctx.dataset.label}: ${ctx.parsed.y?.toFixed(1)}°C`;
              return ` ${ctx.dataset.label}: ${fmtW(ctx.parsed.y)}`;
            }
          }
        }
      },
      scales: {
        x: { grid: { color: COLORS.border }, ticks: { color: COLORS.muted, font: { size: 11 }, maxTicksLimit: 12 } },
        y: { grid: { color: COLORS.border }, ticks: { color: COLORS.muted, font: { size: 11 }, callback: v => fmtW(v) },
             title: { display: true, text: "Base Load", color: COLORS.muted, font: { size: 11 } } },
        yTemp: { position: "right", grid: { drawOnChartArea: false },
                 ticks: { color: COLORS.muted, font: { size: 11 }, callback: v => `${v}°C` },
                 title: { display: true, text: "Temperature", color: COLORS.muted, font: { size: 11 } } }
      }
    }
  });

  // Chart 1b: Weekly base load year-on-year with temperature overlay
  function isoWeekKey(iso) {
    // Returns "YYYY-WW" based on Monday-start ISO weeks
    const d = new Date(iso);
    const day = d.getUTCDay() || 7; // Mon=1, Sun=7
    d.setUTCDate(d.getUTCDate() + 4 - day); // nearest Thursday
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const week = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    return `${d.getUTCFullYear()}-${String(week).padStart(2,'0')}`;
  }

  function weekOfYear(iso) {
    const d = new Date(iso);
    const day = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - day);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil((((d - yearStart) / 86400000) + 1) / 7) - 1;
  }

  // Fetch temperatures for all years
  const allTempData = {};
  for (const year of years) {
    const startIso = `${year}-01-01`;
    const endIso = `${year}-12-31` <= isoToday() ? `${year}-12-31` : isoToday();
    const temps = await fetchTemps(startIso, endIso);
    Object.assign(allTempData, temps);
  }

  const doyLabels = Array.from({length: 52}, (_, i) => {
    const d = new Date(2024, 0, 1 + i * 7);
    return d.toLocaleDateString("en-GB", {month: "short", day: "numeric"});
  });

  // Base load datasets
  const doyDatasets = years.map(year => {
    const weekMapBL = {};
    const yearDates = allDates.filter(d => d.startsWith(`${year}-`));
    for (const iso of yearDates) {
      if (!dailyBase[iso]) continue;
      const wk = isoWeekKey(iso);
      if (!weekMapBL[wk]) weekMapBL[wk] = [];
      weekMapBL[wk].push(dailyBase[iso]);
    }
    const weekBuckets = Array.from({length: 52}, () => null);
    for (const [wk, vals] of Object.entries(weekMapBL)) {
      if (vals.length < 7) continue;
      const wkNum = parseInt(wk.split('-')[1]) - 1;
      if (wkNum >= 0 && wkNum < 52) weekBuckets[wkNum] = vals;
    }
    const weeklyAvg = weekBuckets.map(bucket =>
      bucket ? bucket.reduce((a, b) => a + b, 0) / bucket.length : null
    );
    const smoothed = weeklyAvg.map((_, i) => {
      const slice = weeklyAvg.slice(Math.max(0, i-1), i+2).filter(v => v !== null);
      return slice.length ? slice.reduce((a,b) => a+b, 0) / slice.length : null;
    });
    return {
      label: `${year} base load`,
      data: smoothed,
      borderColor: yearColors[year],
      backgroundColor: "transparent",
      borderWidth: 2.5,
      pointRadius: 0,
      tension: 0.4,
      spanGaps: true,
      yAxisID: "y",
    };
  });

  // Temperature datasets (weekly mean per year) — iterate all days in year
  const tempLineColors = {2024:"#f97316", 2025:"#fb923c", 2026:"#fdba74"};
  const doyTempDatasets = years.map(year => {
    const weekTempBuckets = Array.from({length: 52}, () => []);
    // Iterate every day of the year, not just days with energy data
    const daysInYear = year % 4 === 0 ? 366 : 365;
    for (let d = 0; d < daysInYear; d++) {
      const date = new Date(year, 0, 1 + d);
      const iso = date.toISOString().slice(0, 10);
      if (iso > isoToday()) continue;
      const wk = Math.min(51, weekOfYear(iso));
      if (allTempData[iso]?.mean != null) weekTempBuckets[wk].push(allTempData[iso].mean);
    }
    const weeklyTemp = weekTempBuckets.map(bucket =>
      bucket.length ? bucket.reduce((a,b) => a+b, 0) / bucket.length : null
    );
    return {
      label: `${year} temp °C`,
      data: weeklyTemp,
      borderColor: tempLineColors[year],
      backgroundColor: "transparent",
      borderWidth: 1.5,
      borderDash: [4, 3],
      pointRadius: 0,
      tension: 0.4,
      spanGaps: true,
      yAxisID: "yTemp",
    };
  });

  mkChart("chart-base-doy", {
    type: "line",
    data: { labels: doyLabels, datasets: [...doyDatasets, ...doyTempDatasets] },
    options: {
      responsive: true, maintainAspectRatio: false, animation: { duration: 300 },
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { display: true, labels: { color: COLORS.muted, font: { size: 12 } } },
        tooltip: {
          backgroundColor: "#0f1729", borderColor: COLORS.border, borderWidth: 1,
          callbacks: {
            label: ctx => {
              if (ctx.dataset.yAxisID === "yTemp") return ` ${ctx.dataset.label}: ${ctx.parsed.y?.toFixed(1)}°C`;
              return ` ${ctx.dataset.label}: ${fmtW(ctx.parsed.y)}`;
            }
          }
        }
      },
      scales: {
        x: { grid: { color: COLORS.border }, ticks: { color: COLORS.muted, font: { size: 11 }, maxTicksLimit: 12 } },
        y: { grid: { color: COLORS.border },
             ticks: { color: COLORS.muted, font: { size: 11 }, callback: v => fmtW(v) },
             title: { display: true, text: "Base Load", color: COLORS.muted, font: { size: 11 } } },
        yTemp: { position: "right", grid: { drawOnChartArea: false },
                 ticks: { color: "#f97316", font: { size: 11 }, callback: v => `${v}°C` },
                 title: { display: true, text: "Temperature", color: "#f97316", font: { size: 11 } } }
      }
    }
  });

  // Chart 2: Monthly average base load
  const monthlyBase = {};
  for (const year of years) {
    for (let m = 1; m <= 12; m++) {
      const key = `${year}-${pad(m)}`;
      const vals = [];
      const dim = new Date(year, m, 0).getDate();
      for (let d = 1; d <= dim; d++) {
        const iso = `${year}-${pad(m)}-${pad(d)}`;
        if (dailyBase[iso]) vals.push(dailyBase[iso]);
      }
      monthlyBase[key] = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
    }
  }

  // Use current year for monthly chart
  const currentYear = new Date().getFullYear();
  mkChart("chart-base-monthly", {
    type: "bar",
    data: {
      labels: months,
      datasets: [{
        label: "Avg base load",
        data: Array.from({ length: 12 }, (_, i) => monthlyBase[`${currentYear}-${pad(i + 1)}`] || 0),
        backgroundColor: COLORS.consumption + "cc",
      }]
    },
    options: barOpts(v => fmtW(v), false)
  });

  // Chart 3: Weekly histogram — pool all readings from the 7 days ending on selected date
  const baseDatePicker = $("base-date-picker");
  baseDatePicker.value = isoToday();
  baseDatePicker.max = isoToday();

  async function loadWeekHist(anchorDate) {
    try {
      // Get 7 days ending on anchorDate
      const weekDates = Array.from({length: 7}, (_, i) => addDays(anchorDate, -6 + i));
      const weekDays = await loadManyDays(weekDates);

      // Pool all readings from the week, excluding 00:00-06:00
      const allPts = weekDates.flatMap(d => {
        const day = weekDays[d];
        if (!day) return [];
        return (day.data_points || []).filter(p => {
          const h = new Date(p.t).getUTCHours();
          return h >= 6;
        });
      });

      // Build histogram from pooled readings
      const { labels, data } = histogram(allPts);
      const bl = baseLoad(allPts);
      const consVals = allPts.map(p => p.cons || 0).filter(v => v > 0);

      const weekLabel = `${weekDates[0].slice(5)} → ${weekDates[6].slice(5)}`;

      // Fetch weekly temperatures
      const weekTemps = await fetchTemps(weekDates[0], weekDates[6]);
      const avgTempMax  = weekDates.reduce((s,d) => s + (weekTemps[d]?.max  ?? 0), 0) / 7;
      const avgTempMin  = weekDates.reduce((s,d) => s + (weekTemps[d]?.min  ?? 0), 0) / 7;
      const avgTempMean = weekDates.reduce((s,d) => s + (weekTemps[d]?.mean ?? 0), 0) / 7;

      mkChart("chart-base-hist", {
        type: "bar",
        data: {
          labels,
          datasets: [{
            label: `Readings (${weekLabel})`,
            data,
            backgroundColor: COLORS.grid + "cc",
          }]
        },
        options: {
          responsive: true, maintainAspectRatio: false, animation: { duration: 300 },
          plugins: {
            legend: { display: true, labels: { color: COLORS.muted, font: { size: 12 } } },
            tooltip: {
              backgroundColor: "#0f1729", borderColor: COLORS.border, borderWidth: 1,
              callbacks: { label: ctx => ` ${ctx.parsed.y} readings` }
            }
          },
          scales: {
            x: { grid: { color: COLORS.border }, ticks: { color: COLORS.muted, font: { size: 11 }, maxTicksLimit: 10 } },
            y: { grid: { color: COLORS.border }, ticks: { color: COLORS.muted, font: { size: 11 } } }
          }
        }
      });

      // Stats for the week including temperature
      $("base-stats").innerHTML = [
        { label: "Base Load", val: fmtW(bl), color: COLORS.consumption },
        { label: "Median Consumption", val: fmtW(percentile(consVals, 50)), color: COLORS.grid },
        { label: "Peak Consumption", val: fmtW(Math.max(...consVals)), color: COLORS.solar },
        { label: "Avg Max Temp", val: `${avgTempMax.toFixed(1)}°C`, color: "#f97316" },
        { label: "Avg Min Temp", val: `${avgTempMin.toFixed(1)}°C`, color: "#38bdf8" },
        { label: "Total Readings", val: `${allPts.length}`, color: COLORS.muted },
      ].map(({ label, val, color }) => `
        <div class="month-total-card">
          <div class="label">${label}</div>
          <div class="val" style="color:${color};font-size:22px">${val}</div>
        </div>`).join("");
    } catch (e) {
      console.error("Weekly hist failed", e);
    }
  }

  await loadWeekHist(isoToday());
  $("base-date-load").addEventListener("click", () => loadWeekHist(baseDatePicker.value));

  // Chart 4: Year-on-year base load by month
  // Self-sufficiency year-on-year chart
  const selfYoyDatasets = years.map(year => {
    const weekMapSS = {};
    const yearDates = allDates.filter(d => d.startsWith(`${year}-`));
    for (const iso of yearDates) {
      const day = allDays[iso];
      if (!day) continue;
      const pts = day.data_points || [];
      if (pts.length < 2) continue;
      const wk = isoWeekKey(iso);
      if (!weekMapSS[wk]) weekMapSS[wk] = {solar: 0, consumed: 0, days: 0};
      weekMapSS[wk].solar += calcKwh(pts, "pv");
      weekMapSS[wk].consumed += calcKwh(pts, "cons");
      weekMapSS[wk].days++;
    }
    const ssBuckets = Array.from({length: 52}, () => null);
    for (const [wk, b] of Object.entries(weekMapSS)) {
      if (b.days < 7) continue;
      const wkNum = parseInt(wk.split('-')[1]) - 1;
      if (wkNum >= 0 && wkNum < 52) ssBuckets[wkNum] = b;
    }
    const weeklyData = ssBuckets.map(b =>
      b && b.consumed > 0 ? Math.min(100, (b.solar / b.consumed) * 100) : null
    );
    // 3-week rolling smooth
    const smoothed = weeklyData.map((_, i) => {
      const slice = weeklyData.slice(Math.max(0, i-1), i+2).filter(v => v !== null);
      return slice.length ? slice.reduce((a,b) => a+b, 0) / slice.length : null;
    });
    return {
      label: `${year}`,
      data: smoothed,
      borderColor: yearColors[year],
      backgroundColor: yearColors[year] + "22",
      borderWidth: 2.5,
      pointRadius: 0,
      tension: 0.4,
      spanGaps: true,
    };
  });

  mkChart("chart-self-yoy", {
    type: "line",
    data: { labels: doyLabels, datasets: selfYoyDatasets },
    options: {
      responsive: true, maintainAspectRatio: false, animation: { duration: 300 },
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { display: true, labels: { color: COLORS.muted, font: { size: 12 } } },
        tooltip: {
          backgroundColor: "#0f1729", borderColor: COLORS.border, borderWidth: 1,
          callbacks: { label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y?.toFixed(1)}%` }
        }
      },
      scales: {
        x: { grid: { color: COLORS.border }, ticks: { color: COLORS.muted, font: { size: 11 }, maxTicksLimit: 12 } },
        y: { min: 0, max: 100, grid: { color: COLORS.border },
             ticks: { color: COLORS.muted, font: { size: 11 }, callback: v => `${v}%` } }
      }
    }
  });

  mkChart("chart-base-yoy", {
    type: "bar",
    data: {
      labels: months,
      datasets: years.map(year => ({
        label: `${year}`,
        data: Array.from({ length: 12 }, (_, i) => monthlyBase[`${year}-${pad(i + 1)}`] || 0),
        backgroundColor: yearColors[year] + "cc",
      }))
    },
    options: barOpts(v => fmtW(v), false)
  });

  showView("base");
}

// Wire up Base tab
views.base = document.getElementById("view-base");

const origRenderFn = render;
render = function() {
  if (state.tab === "base") renderBase();
  else origRenderFn();
};

document.querySelectorAll(".tab").forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll(".tab").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    state.tab = btn.dataset.tab;
    render();
  };
});
