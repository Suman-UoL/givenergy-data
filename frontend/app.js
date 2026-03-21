const DATA_BASE = "data";
const COLORS = {
  solar:"#f59e0b",consumption:"#f43f5e",battery:"#10b981",
  grid:"#3b82f6",export:"#8b5cf6",charge:"#06b6d4",
  muted:"#64748b",border:"#1a2540",text:"#e2e8f0"
};
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
const cache={};
async function loadDay(dateStr){
  if(cache[dateStr])return cache[dateStr];
  const r=await fetch(`${DATA_BASE}/${dateStr}.json`);
  if(!r.ok)throw new Error(`No data for ${dateStr}`);
  const json=await r.json();cache[dateStr]=json;return json;
}
const state={tab:"day",selectedDate:isoToday()};
const $=id=>document.getElementById(id);
const loading=$("loading"),errorState=$("error-state"),errorMsg=$("error-msg");
const views={day:$("view-day"),week:$("view-week"),month:$("view-month")};
function showLoading(){loading.classList.remove("hidden");errorState.classList.add("hidden");Object.values(views).forEach(v=>v.classList.add("hidden"));}
function showError(msg){loading.classList.add("hidden");errorState.classList.remove("hidden");errorMsg.textContent=msg;Object.values(views).forEach(v=>v.classList.add("hidden"));}
function showView(name){loading.classList.add("hidden");errorState.classList.add("hidden");Object.entries(views).forEach(([k,v])=>{k===name?v.classList.remove("hidden"):v.classList.add("hidden");});}
function setText(id,val){const el=$(id);if(el)el.textContent=val;}
function sumFlow(flows,key){return(flows||[]).reduce((a,f)=>a+(Number(f[key])||0),0);}
function getDayFlows(day){return day?day.energy_flows||[]:[]}
function getTotal(day,totalKey,fallbackFn){
  if(!day)return 0;
  const t=day.totals||{};
  if(t[totalKey]!==undefined&&t[totalKey]!==null)return Number(t[totalKey]);
  return fallbackFn(day);
}
async function loadManyDays(dates){
  const result={};
  await Promise.allSettled(dates.map(async d=>{try{result[d]=await loadDay(d);}catch{result[d]=null;}}));
  return result;
}
function lineDs(label,data,color,dashed=false){
  return{label,data,borderColor:color,backgroundColor:color+"22",borderWidth:2,pointRadius:0,fill:true,tension:0.3,borderDash:dashed?[4,3]:[]};
}
function barDs(label,data,color,stackId="a"){
  return{label,data,backgroundColor:color+"cc",stack:stackId};
}
function lineOptions(formatter,min,max){
  return{responsive:true,maintainAspectRatio:false,animation:{duration:300},
    interaction:{mode:"index",intersect:false},
    scales:{
      x:{grid:{color:COLORS.border},ticks:{maxTicksLimit:12,color:COLORS.muted,font:{size:11}}},
      y:{min,max,grid:{color:COLORS.border},ticks:{color:COLORS.muted,font:{size:11},callback:formatter}}
    },
    plugins:{tooltip:{backgroundColor:"#0f1729",borderColor:COLORS.border,borderWidth:1,
      callbacks:{label:ctx=>` ${ctx.dataset.label}: ${formatter(ctx.parsed.y)}`}}}
  };
}
function barOptions(formatter,stacked=true,min,max){
  return{responsive:true,maintainAspectRatio:false,animation:{duration:300},
    interaction:{mode:"index",intersect:false},
    scales:{
      x:{stacked,grid:{color:COLORS.border},ticks:{maxTicksLimit:16,color:COLORS.muted,font:{size:11}}},
      y:{min,max,stacked,grid:{color:COLORS.border},ticks:{color:COLORS.muted,font:{size:11},callback:formatter}}
    },
    plugins:{tooltip:{backgroundColor:"#0f1729",borderColor:COLORS.border,borderWidth:1,
      callbacks:{label:ctx=>` ${ctx.dataset.label}: ${formatter(ctx.parsed.y)}`}}}
  };
}
async function renderDay(dateStr){
  showLoading();
  let day;
  try{day=await loadDay(dateStr);}
  catch(e){showError(`No data for ${dateStr} yet. The fetcher runs every 30 minutes — check back soon.`);return;}
  const pts=day.data_points||[];
  const flows=day.energy_flows||[];
  const totalSolar=(day.data_points||[]).reduce((a,p)=>a+(p.pv||0),0)*5/60/1000;
  const totalConsumed=(day.data_points||[]).reduce((a,p)=>a+(p.cons||0),0)*5/60/1000;
  const totalExported=(day.data_points||[]).reduce((a,p)=>a+Math.max(0,-(p.grid||0)),0)*5/60/1000;
  const totalImported=(day.data_points||[]).reduce((a,p)=>a+Math.max(0,(p.grid||0)),0)*5/60/1000;
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
  ]},options:lineOptions(v=>fmtW(v))});
  const socPts=thinPts.filter(p=>p.soc!==null&&p.soc!==undefined);
  mkChart("chart-soc",{type:"line",data:{labels:socPts.map(p=>shortTime(p.t)),datasets:[
    lineDs("Battery %",socPts.map(p=>p.soc),COLORS.battery)
  ]},options:lineOptions(v=>`${v.toFixed(0)}%`,0,100)});
  if(flows.length>0){
    mkChart("chart-flows",{type:"bar",data:{labels:flows.map(f=>shortTime(f.t)),datasets:[
      barDs("Solar→House",flows.map(f=>f.pv_h||0),COLORS.solar),
      barDs("Grid→House",flows.map(f=>f.grid_h||0),COLORS.grid),
      barDs("Bat→House",flows.map(f=>f.bat_h||0),COLORS.battery),
      barDs("Exported",flows.map(f=>f.pv_g||0),COLORS.export,"b"),
      barDs("Bat Charge",flows.map(f=>f.pv_b||0),COLORS.charge,"b"),
    ]},options:barOptions(v=>`${v.toFixed(3)} kWh`)});
  }
  showView("day");
}
async function renderWeek(anchorDate){
  showLoading();
  const dates=Array.from({length:7},(_,i)=>addDays(anchorDate,-6+i));
  const days=await loadManyDays(dates);
  const labels=dates.map(d=>d.slice(5));
  const solar=dates.map(d=>getTotal(days[d],"solar_generated",d=>sumFlow(getDayFlows(d),"pv_h")));
  const consumed=dates.map(d=>getTotal(days[d],"consumption",d=>sumFlow(getDayFlows(d),"pv_h")+sumFlow(getDayFlows(d),"grid_h")+sumFlow(getDayFlows(d),"bat_h")));
  const imported=dates.map(d=>getTotal(days[d],"grid_import",d=>sumFlow(getDayFlows(d),"grid_h")));
  const exported=dates.map(d=>getTotal(days[d],"grid_export",d=>sumFlow(getDayFlows(d),"pv_g")+sumFlow(getDayFlows(d),"bat_g")));
  const selfSuff=dates.map((_,i)=>consumed[i]>0?Math.min(100,((consumed[i]-imported[i])/consumed[i])*100):0);
  mkChart("chart-week",{type:"bar",data:{labels,datasets:[
    barDs("Solar",solar,COLORS.solar),
    barDs("Consumed",consumed,COLORS.consumption,"b"),
    barDs("Exported",exported,COLORS.export,"c"),
    barDs("Imported",imported,COLORS.grid,"c"),
  ]},options:barOptions(v=>`${v.toFixed(2)} kWh`,false)});
  mkChart("chart-week-self",{type:"bar",data:{labels,datasets:[
    barDs("Self-sufficiency %",selfSuff,COLORS.battery)
  ]},options:barOptions(v=>`${v.toFixed(0)}%`,false,0,100)});
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
  const solar=dates.map(d=>getTotal(days[d],"solar_generated",d=>sumFlow(getDayFlows(d),"pv_h")));
  const consumed=dates.map(d=>getTotal(days[d],"consumption",d=>sumFlow(getDayFlows(d),"pv_h")+sumFlow(getDayFlows(d),"grid_h")+sumFlow(getDayFlows(d),"bat_h")));
  const exported=dates.map(d=>getTotal(days[d],"grid_export",d=>sumFlow(getDayFlows(d),"pv_g")+sumFlow(getDayFlows(d),"bat_g")));
  const imported=dates.map(d=>getTotal(days[d],"grid_import",d=>sumFlow(getDayFlows(d),"grid_h")));
  mkChart("chart-month",{type:"bar",data:{labels,datasets:[
    barDs("Solar",solar,COLORS.solar),
    barDs("Consumed",consumed,COLORS.consumption,"b"),
    barDs("Exported",exported,COLORS.export,"c"),
    barDs("Imported",imported,COLORS.grid,"c"),
  ]},options:barOptions(v=>`${v.toFixed(2)} kWh`,false)});
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
