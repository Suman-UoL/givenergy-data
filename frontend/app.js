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

// Calculate kWh using actual time intervals between readings
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

const state={tab:"day",selectedDate:isoToday()};
const $=id=>document.getElementById(id);
const loading=$("loading"),errorState=$("error-state"),errorMsg=$("error-msg");
const views={day:$("view-day"),week:$("view-week"),month:$("view-month")};

function showLoading(){loading.classList.remove("hidden");errorState.classList.add("hidden");Object.values(views).forEach(v=>v.classList.add("hidden"));}
function showError(msg){loading.classList.add("hidden");errorState.classList.remove("hidden");errorMsg.textContent=msg;Object.values(views).forEach(v=>v.classList.add("hidden"));}
function showView(name){loading.classList.add("hidden");errorState.classList.add("hidden");Object.entries(views).forEach(([k,v])=>{k===name?v.classList.remove("hidden"):v.classList.add("hidden");});}
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
  const selfSuffPct=totalConsumed>0?Math.min(100,((totalConsumed-totalImported)/totalConsumed)*100):0;
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
  const socPts=thinPts.filter(p=>p.soc!==null&&p.soc!==undefined);
  mkChart("chart-soc",{type:"line",data:{labels:socPts.map(p=>shortTime(p.t)),datasets:[
    lineDs("Battery %",socPts.map(p=>p.soc),COLORS.battery)
  ]},options:lineOpts(v=>`${v.toFixed(0)}%`,0,100)});
  const flows=day.energy_flows||[];
  if(flows.length>0){
    mkChart("chart-flows",{type:"bar",data:{labels:flows.map(f=>shortTime(f.t)),datasets:[
      barDs("Solar→House",flows.map(f=>f.pv_h||0),COLORS.solar),
      barDs("Grid→House",flows.map(f=>f.grid_h||0),COLORS.grid),
      barDs("Bat→House",flows.map(f=>f.bat_h||0),COLORS.battery),
      barDs("Exported",flows.map(f=>f.pv_g||0),COLORS.export,"b"),
      barDs("Bat Charge",flows.map(f=>f.pv_b||0),COLORS.charge,"b"),
    ]},options:barOpts(v=>`${v.toFixed(3)} kWh`)});
  }
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
  const selfSuff=dates.map((_,i)=>consumed[i]>0?Math.min(100,((consumed[i]-imported[i])/consumed[i])*100):0);
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
  const selfSuff=tConsumed>0?((tConsumed-tImported)/tConsumed)*100:0;
  $("month-totals").innerHTML=[
    {label:"Solar Generated",val:fmtKwh(tSolar),color:COLORS.solar},
    {label:"Total Consumed",val:fmtKwh(tConsumed),color:COLORS.consumption},
    {label:"Grid Exported",val:fmtKwh(tExported),color:COLORS.export},
    {label:"Grid Imported",val:fmtKwh(tImported),color:COLORS.grid},
    {label:"Self-sufficiency",val:fmtPct(selfSuff),color:COLORS.battery},
  ].map(({label,val,color})=>`<div class="month-total-card"><div class="label">${label}</div><div class="val" style="color:${color}">${val}</div></div>`).join("");
  showView("month");
}

function render(){
  const d=state.selectedDate;
  if(state.tab==="day")renderDay(d);
  if(state.tab==="week")renderWeek(d);
  if(state.tab==="month")renderMonth(d);
}

document.querySelectorAll(".tab").forEach(btn=>{
  btn.addEventListener("click",()=>{
    document.querySelectorAll(".tab").forEach(b=>b.classList.remove("active"));
    btn.classList.add("active");state.tab=btn.dataset.tab;render();
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

async function renderYear(anchorDate){
  showLoading();
  const anchor=new Date(anchorDate);
  const currentYear=anchor.getFullYear();
  const years=[2024,2025,2026].filter(y=>y<=currentYear);
  const months=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const pad=n=>String(n).padStart(2,"0");

  // Build list of all dates we need
  const allDates=[];
  for(const year of years){
    for(let m=1;m<=12;m++){
      const daysInMonth=new Date(year,m,0).getDate();
      for(let d=1;d<=daysInMonth;d++){
        const iso=`${year}-${pad(m)}-${pad(d)}`;
        if(iso<=isoToday()) allDates.push(iso);
      }
    }
  }

  // Load all days in parallel batches
  const allDays={};
  const batchSize=30;
  for(let i=0;i<allDates.length;i+=batchSize){
    const batch=allDates.slice(i,i+batchSize);
    const results=await loadManyDays(batch);
    Object.assign(allDays,results);
  }

  // Aggregate by year+month
  function monthKey(year,month){return `${year}-${pad(month)}`;}
  const agg={};
  for(const year of years){
    for(let m=1;m<=12;m++){
      const key=monthKey(year,m);
      agg[key]={solar:0,consumed:0,imported:0,exported:0,days:0};
      const daysInMonth=new Date(year,m,0).getDate();
      for(let d=1;d<=daysInMonth;d++){
        const iso=`${year}-${pad(m)}-${pad(d)}`;
        if(iso>isoToday()) continue;
        const day=allDays[iso];
        if(!day) continue;
        const pts=day.data_points||[];
        if(pts.length<2) continue;
        agg[key].solar+=calcKwh(pts,"pv");
        agg[key].consumed+=calcKwh(pts,"cons");
        agg[key].imported+=calcKwhPos(pts,"grid");
        agg[key].exported+=calcKwhNeg(pts,"grid");
        agg[key].days++;
      }
    }
  }

  // Build charts
  const yearColors={2024:COLORS.solar,2025:COLORS.battery,2026:COLORS.grid};

  // Chart 1: Monthly solar by year
  const solarDatasets=years.map(year=>({
    label:`${year}`,
    data:Array.from({length:12},(_,i)=>{const k=monthKey(year,i+1);return agg[k]?agg[k].solar:0;}),
    backgroundColor:yearColors[year]+"cc",
  }));
  mkChart("chart-year-solar",{type:"bar",data:{labels:months,datasets:solarDatasets},
    options:barOpts(v=>`${v.toFixed(0)} kWh`,false)});

  // Chart 2: Monthly consumption by year
  const consDatasets=years.map(year=>({
    label:`${year}`,
    data:Array.from({length:12},(_,i)=>{const k=monthKey(year,i+1);return agg[k]?agg[k].consumed:0;}),
    backgroundColor:yearColors[year]+"cc",
  }));
  mkChart("chart-year-cons",{type:"bar",data:{labels:months,datasets:consDatasets},
    options:barOpts(v=>`${v.toFixed(0)} kWh`,false)});

  // Chart 3: Grid import vs export by month (current year)
  const gridLabels=months;
  const importData=Array.from({length:12},(_,i)=>{const k=monthKey(currentYear,i+1);return agg[k]?agg[k].imported:0;});
  const exportData=Array.from({length:12},(_,i)=>{const k=monthKey(currentYear,i+1);return agg[k]?agg[k].exported:0;});
  mkChart("chart-year-grid",{type:"bar",data:{labels:gridLabels,datasets:[
    {label:"Imported",data:importData,backgroundColor:COLORS.grid+"cc"},
    {label:"Exported",data:exportData,backgroundColor:COLORS.export+"cc"},
  ]},options:barOpts(v=>`${v.toFixed(0)} kWh`,false)});

  // Chart 4: Self-sufficiency by month
  const selfDatasets=years.map(year=>({
    label:`${year}`,
    data:Array.from({length:12},(_,i)=>{
      const k=monthKey(year,i+1);
      const a=agg[k];
      if(!a||a.consumed===0)return 0;
      return Math.min(100,((a.consumed-a.imported)/a.consumed)*100);
    }),
    backgroundColor:yearColors[year]+"cc",
  }));
  mkChart("chart-year-self",{type:"bar",data:{labels:months,datasets:selfDatasets},
    options:barOpts(v=>`${v.toFixed(0)}%`,false,0,100)});

  // Records
  let bestSolarDay={date:"",val:0};
  let bestExportDay={date:"",val:0};
  let highestConsDay={date:"",val:0};
  for(const iso of allDates){
    const day=allDays[iso];
    if(!day) continue;
    const pts=day.data_points||[];
    if(pts.length<2) continue;
    const s=calcKwh(pts,"pv");
    const e=calcKwhNeg(pts,"grid");
    const c=calcKwh(pts,"cons");
    if(s>bestSolarDay.val){bestSolarDay={date:iso,val:s};}
    if(e>bestExportDay.val){bestExportDay={date:iso,val:e};}
    if(c>highestConsDay.val){highestConsDay={date:iso,val:c};}
  }

  $("year-records").innerHTML=[
    {icon:"☀️",label:"Best Solar Day",val:fmtKwh(bestSolarDay.val),date:bestSolarDay.date},
    {icon:"🔌",label:"Best Export Day",val:fmtKwh(bestExportDay.val),date:bestExportDay.date},
    {icon:"🏠",label:"Highest Consumption",val:fmtKwh(highestConsDay.val),date:highestConsDay.date},
  ].map(({icon,label,val,date})=>`
    <div class="month-total-card">
      <div class="label">${icon} ${label}</div>
      <div class="val" style="color:var(--text);font-size:20px">${val}</div>
      <div style="font-size:12px;color:var(--muted);margin-top:4px">${date}</div>
    </div>`).join("");

  showView("year");
}

// Add year view to views object and render function
views.year = document.getElementById("view-year");

const origRender = render;
window.render = function() {
  if(state.tab === "year") renderYear(state.selectedDate);
  else origRender();
}

// Override the tab click handler to use new render
document.querySelectorAll(".tab").forEach(btn=>{
  btn.onclick = ()=>{
    document.querySelectorAll(".tab").forEach(b=>b.classList.remove("active"));
    btn.classList.add("active");
    state.tab=btn.dataset.tab;
    window.render();
  };
});
