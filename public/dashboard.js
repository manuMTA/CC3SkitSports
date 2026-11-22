"use strict";
/* Code partagé : utilitaires + tableau de bord */
/* ============ Constantes & utilitaires ============ */
const SPORTS = {
  swim:{label:"Natation", v:"--swim"},
  bike:{label:"Vélo", v:"--bike"},
  run:{label:"Course à pied", v:"--run"},
  other:{label:"Autre", v:"--other"}
};
const ORDER = ["swim","bike","run","other"];
const $ = (s, el=document) => el.querySelector(s);
const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const nf1 = new Intl.NumberFormat("fr-FR",{maximumFractionDigits:1});
const nf0 = new Intl.NumberFormat("fr-FR",{maximumFractionDigits:0});
const dfShort = new Intl.DateTimeFormat("fr-FR",{day:"numeric",month:"short"});
const dfFull = new Intl.DateTimeFormat("fr-FR",{day:"numeric",month:"short",year:"numeric"});
const dfTime = new Intl.DateTimeFormat("fr-FR",{day:"numeric",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"});
const DAY = 86400000;

function sportOf(raw){
  const s = String(raw||"").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,"");
  if (/swim|natation|nage|piscine/.test(s)) return "swim";
  if (/ride|velo|bike|cycl|vtt|gravel|handcycle|velomobile/.test(s)) return "bike";
  if (/run|course|trail|footing|jog/.test(s)) return "run";
  return "other";
}
function fmtDur(sec){
  sec = Math.round(sec||0);
  const h = Math.floor(sec/3600), m = Math.floor((sec%3600)/60);
  return h ? `${h} h ${String(m).padStart(2,"0")}` : `${m} min`;
}
function fmtPace(secPerUnit){ // mm:ss
  if (!isFinite(secPerUnit) || secPerUnit<=0) return "–";
  const m = Math.floor(secPerUnit/60), s = Math.round(secPerUnit%60);
  return `${m}:${String(s===60?0:s).padStart(2,"0")}`;
}
function parseDuration(v){
  if (v==null || v==="") return 0;
  if (typeof v === "number") return v;
  const s = String(v).trim();
  if (/^\d+(\.\d+)?$/.test(s)) return parseFloat(s);
  const p = s.split(":").map(Number);
  if (p.length>=2 && p.every(n=>!isNaN(n))) return p.reduce((a,n)=>a*60+n,0);
  let t=0, m;
  if ((m=s.match(/(\d+)\s*h/))) t+= +m[1]*3600;
  if ((m=s.match(/(\d+)\s*m(in)?/))) t+= +m[1]*60;
  if ((m=s.match(/(\d+)\s*s/))) t+= +m[1];
  return t;
}
function num(v){
  if (v==null || v==="") return 0;
  if (typeof v === "number") return v;
  let s = String(v).replace(/\s/g,"");
  if (s.includes(",") && !s.includes(".")) s = s.replace(",",".");
  const n = parseFloat(s.replace(/[^\d.\-]/g,""));
  return isNaN(n) ? 0 : n;
}
const FR_MONTHS = {janv:0,jan:0,fevr:1,fev:1,feb:1,mars:2,mar:2,avr:3,apr:3,avril:3,mai:4,may:4,juin:5,jun:5,juil:6,jul:6,aout:7,aug:7,sept:8,sep:8,oct:9,nov:10,dec:11};
function parseDate(v){
  if (v==null) return NaN;
  if (typeof v === "number") return v < 1e12 ? v*1000 : v;
  const s = String(v).trim();
  let t = Date.parse(s.replace(" à ", " "));
  if (!isNaN(t)) return t;
  const n = s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,"");
  const m = n.match(/(\d{1,2})\s+([a-z]+)\.?\s+(\d{4})\D*(\d{1,2})?:?(\d{2})?:?(\d{2})?/);
  if (m && FR_MONTHS[m[2]]!=null) return new Date(+m[3], FR_MONTHS[m[2]], +m[1], +(m[4]||0), +(m[5]||0), +(m[6]||0)).getTime();
  return NaN;
}
function weekStart(ts){ const d=new Date(ts); d.setHours(0,0,0,0); const wd=(d.getDay()+6)%7; d.setDate(d.getDate()-wd); return d.getTime(); }


const DS = { period:"12w", sportFilter:"all", onChange:()=>{} };
const charts = [];
function destroyCharts(){ while(charts.length) charts.pop().destroy(); }

/* ---------- Tableau de bord (partagé utilisateur / admin) ---------- */
function renderDashboard(el, allActs){
  const now = Date.now();
  const periods = {"4w":28,"12w":84,"26w":182,"52w":364,"all":null};
  const days = periods[DS.period];
  const from = days ? weekStart(now) - (days-7)*DAY : Math.min(...allActs.map(a=>a.ts));
  const inPeriod = allActs.filter(a=>a.ts>=from);
  const acts = DS.sportFilter==="all" ? inPeriod : inPeriod.filter(a=>a.t===DS.sportFilter);

  el.innerHTML = `
    <div class="toolbar">
      <div class="seg" id="segP">${[["4w","4 sem."],["12w","12 sem."],["26w","6 mois"],["52w","12 mois"],["all","Tout"]].map(([k,l])=>`<button data-k="${k}" class="${DS.period===k?"on":""}">${l}</button>`).join("")}</div>
      <div class="seg" id="segS">${[["all","Toutes"],["swim","Natation"],["bike","Vélo"],["run","Course"]].map(([k,l])=>`<button data-k="${k}" class="${DS.sportFilter===k?"on":""}">${l}</button>`).join("")}</div>
      <span class="tooltip-hint">${inPeriod.length} activités sur la période</span>
    </div>
    <div class="grid g4" id="kpis"></div>
    <div class="grid g2 mt">
      <div class="card"><h2>Volume hebdomadaire (heures)</h2><div class="legend" id="wkLegend"></div><div class="chart-box"><canvas id="cWeek"></canvas></div></div>
      <div class="card"><h2>Répartition du temps</h2><div id="split"></div></div>
    </div>
    <div class="grid g3 mt">
      <div class="card"><h2>Allure course <span class="tooltip-hint">min/km</span></h2><div class="chart-box sm"><canvas id="cRun"></canvas></div></div>
      <div class="card"><h2>Vitesse vélo <span class="tooltip-hint">km/h</span></h2><div class="chart-box sm"><canvas id="cBike"></canvas></div></div>
      <div class="card"><h2>Allure natation <span class="tooltip-hint">min/100 m</span></h2><div class="chart-box sm"><canvas id="cSwim"></canvas></div></div>
    </div>
    <div class="grid g2 mt">
      <div class="card"><h2>Régularité — 12 derniers mois</h2><div class="heat-wrap"><div class="heat" id="heat"></div></div>
        <div class="heat-legend">Moins <i style="background:var(--seq0)"></i><i style="background:var(--seq1)"></i><i style="background:var(--seq2)"></i><i style="background:var(--seq3)"></i><i style="background:var(--seq4)"></i><i style="background:var(--seq5)"></i> Plus <span style="margin-left:10px" id="heatInfo"></span></div></div>
      <div class="card"><h2>Records</h2><div class="records" id="records"></div></div>
    </div>
    <div class="card mt"><h2>Dernières activités</h2><div class="tbl-wrap"><table id="recent"></table></div></div>`;

  $("#segP",el).onclick = e=>{ const b=e.target.closest("button"); if(!b) return; DS.period=b.dataset.k; DS.onChange(); };
  $("#segS",el).onclick = e=>{ const b=e.target.closest("button"); if(!b) return; DS.sportFilter=b.dataset.k; DS.onChange(); };

  // KPI
  const tot = t => { const a = inPeriod.filter(x=>x.t===t); return {n:a.length, km:a.reduce((s,x)=>s+x.dist,0)/1000, sec:a.reduce((s,x)=>s+x.sec,0)}; };
  const totalSec = acts.reduce((s,x)=>s+x.sec,0), totalElev = acts.reduce((s,x)=>s+x.elev,0);
  const weeksN = Math.max(1, Math.round((now-from)/(7*DAY)));
  const k = ["swim","bike","run"].map(t=>{ const o=tot(t);
    const dist = t==="swim" ? `${nf1.format(o.km)}<small>km</small>` : `${nf0.format(o.km)}<small>km</small>`;
    return `<div class="card kpi"><div class="lbl"><span class="dot" style="background:var(${SPORTS[t].v})"></span>${SPORTS[t].label}</div><div class="val">${dist}</div><div class="meta">${o.n} séances · ${fmtDur(o.sec)}</div></div>`; });
  k.push(`<div class="card kpi"><div class="lbl">Temps total${DS.sportFilter!=="all"?" ("+SPORTS[DS.sportFilter].label.toLowerCase()+")":""}</div><div class="val">${nf0.format(totalSec/3600)}<small>h</small></div><div class="meta">${fmtDur(totalSec/weeksN)} / sem. · D+ ${nf0.format(totalElev)} m</div></div>`);
  $("#kpis",el).innerHTML = k.join("");

  // Volume hebdomadaire / mensuel empilé
  const monthly = (now-from) > 60*7*DAY;
  const buckets = [];
  if (monthly){
    const d = new Date(from); d.setDate(1); d.setHours(0,0,0,0);
    while (d.getTime()<=now){ buckets.push(d.getTime()); d.setMonth(d.getMonth()+1); }
  } else {
    for (let w=weekStart(from); w<=now; w+=7*DAY) buckets.push(w);
  }
  const bIndex = ts => { let i = buckets.length-1; while(i>0 && buckets[i]>ts) i--; return i; };
  const showSports = DS.sportFilter==="all" ? ORDER.filter(t=>inPeriod.some(a=>a.t===t)) : [DS.sportFilter];
  const series = {}; showSports.forEach(t=>series[t]=buckets.map(()=>0));
  acts.forEach(a=>{ if(series[a.t]) series[a.t][bIndex(a.ts)] += a.sec/3600; });
  $("#wkLegend",el).innerHTML = showSports.map(t=>`<span><span class="dot" style="background:var(${SPORTS[t].v})"></span>${SPORTS[t].label}</span>`).join("") + (monthly?`<span>· par mois</span>`:"");
  const labels = buckets.map(b=> monthly ? new Intl.DateTimeFormat("fr-FR",{month:"short",year:"2-digit"}).format(new Date(b)) : dfShort.format(new Date(b)));
  const surface = css("--surface");
  charts.push(new Chart($("#cWeek",el), {
    type:"bar",
    data:{labels, datasets: showSports.map(t=>({label:SPORTS[t].label, data:series[t].map(v=>+v.toFixed(2)), backgroundColor:css(SPORTS[t].v), borderColor:surface, borderWidth:{top:2,bottom:0,left:0,right:0}, borderRadius:4, borderSkipped:"bottom", maxBarThickness:28}))},
    options: baseOpts({stacked:true, tooltip:{mode:"index", callbacks:{
      title: it => monthly ? it[0].label : "Semaine du "+it[0].label,
      label: c => ` ${c.dataset.label} : ${fmtDur(c.raw*3600)}`,
      footer: it => "Total : "+fmtDur(it.reduce((s,c)=>s+c.raw,0)*3600)
    }}, yTick: v=>v+" h"})
  }));

  // Répartition
  const bySport = ORDER.map(t=>({t, sec:inPeriod.filter(a=>a.t===t).reduce((s,a)=>s+a.sec,0)})).filter(x=>x.sec>0);
  const sumSec = bySport.reduce((s,x)=>s+x.sec,0)||1;
  $("#split",el).innerHTML = `<div class="split">${bySport.map(x=>`<div title="${SPORTS[x.t].label}" style="width:${x.sec/sumSec*100}%;background:var(${SPORTS[x.t].v})"></div>`).join("")}</div>
    <div class="split-labels">${bySport.map(x=>`<div><span class="dot" style="background:var(${SPORTS[x.t].v})"></span>${SPORTS[x.t].label}<b>${Math.round(x.sec/sumSec*100)} %</b><span style="width:70px;text-align:right">${fmtDur(x.sec)}</span></div>`).join("") || `<p class="sub">Aucune activité sur la période.</p>`}</div>`;

  // Allures
  trendChart($("#cRun",el), inPeriod.filter(a=>a.t==="run" && a.dist>=1000 && a.sec>0), a=>a.sec/(a.dist/1000), "--run", true, v=>fmtPace(v), a=>`${nf1.format(a.dist/1000)} km · ${fmtPace(a.sec/(a.dist/1000))}/km`);
  trendChart($("#cBike",el), inPeriod.filter(a=>a.t==="bike" && a.dist>=3000 && a.sec>0), a=>(a.dist/1000)/(a.sec/3600), "--bike", false, v=>nf1.format(v), a=>`${nf0.format(a.dist/1000)} km · ${nf1.format((a.dist/1000)/(a.sec/3600))} km/h`);
  trendChart($("#cSwim",el), inPeriod.filter(a=>a.t==="swim" && a.dist>=200 && a.sec>0), a=>a.sec/(a.dist/100), "--swim", true, v=>fmtPace(v), a=>`${nf0.format(a.dist)} m · ${fmtPace(a.sec/(a.dist/100))}/100 m`);

  // Heatmap
  const heatStart = weekStart(now) - 51*7*DAY;
  const daily = new Map();
  allActs.forEach(a=>{ if(a.ts>=heatStart && (DS.sportFilter==="all"||a.t===DS.sportFilter)){ const d=new Date(a.ts); d.setHours(0,0,0,0); daily.set(d.getTime(), (daily.get(d.getTime())||0)+a.sec); } });
  const cells=[]; let activeDays=0;
  for (let d=heatStart; d<=now+DAY; d+=DAY){
    const dd=new Date(d); dd.setHours(0,0,0,0); const key=dd.getTime();
    if (key>now) { cells.push(`<i style="visibility:hidden"></i>`); continue; }
    const s = daily.get(key)||0; if(s) activeDays++;
    const lvl = s===0?0 : s<1800?1 : s<3600?2 : s<5400?3 : s<9000?4 : 5;
    cells.push(`<i style="background:var(--seq${lvl})" title="${dfFull.format(dd)} — ${s?fmtDur(s):"repos"}"></i>`);
  }
  $("#heat",el).innerHTML = cells.join("");
  $("#heatInfo",el).textContent = `${activeDays} jours actifs`;

  // Records (sur tout l'historique)
  const best = (t, f, min=0) => allActs.filter(a=>a.t===t && a.dist>=min && a.sec>0).sort((a,b)=>f(b)-f(a))[0];
  const rows = [];
  const lr = best("run", a=>a.dist); if(lr) rows.push(["run","Plus longue course", `${nf1.format(lr.dist/1000)} km`, lr]);
  const fr = best("run", a=>-(a.sec/a.dist), 5000); if(fr) rows.push(["run","Meilleure allure (≥ 5 km)", `${fmtPace(fr.sec/(fr.dist/1000))}/km`, fr]);
  const lb = best("bike", a=>a.dist); if(lb) rows.push(["bike","Plus longue sortie vélo", `${nf0.format(lb.dist/1000)} km`, lb]);
  const eb = best("bike", a=>a.elev); if(eb && eb.elev>0) rows.push(["bike","Plus gros dénivelé", `${nf0.format(eb.elev)} m`, eb]);
  const ls = best("swim", a=>a.dist); if(ls) rows.push(["swim","Plus longue nage", `${nf0.format(ls.dist)} m`, ls]);
  const fs = best("swim", a=>-(a.sec/a.dist), 400); if(fs) rows.push(["swim","Meilleure allure (≥ 400 m)", `${fmtPace(fs.sec/(fs.dist/100))}/100 m`, fs]);
  $("#records",el).innerHTML = rows.map(([t,l,v,a])=>`<div><span class="dot" style="background:var(${SPORTS[t].v})"></span><span class="t">${l}<br><span class="tooltip-hint">${dfFull.format(new Date(a.ts))}</span></span><b>${v}</b></div>`).join("") || `<p class="sub">Pas encore assez d’activités.</p>`;

  // Tableau récent
  const recent = acts.slice().sort((a,b)=>b.ts-a.ts).slice(0,15);
  $("#recent",el).innerHTML = `<thead><tr><th>Date</th><th>Activité</th><th>Sport</th><th class="num">Distance</th><th class="num">Durée</th><th class="num">Allure / vitesse</th><th class="num">D+</th><th class="num">FC moy.</th></tr></thead><tbody>` +
    recent.map(a=>{
      const sp = a.t==="run" && a.dist ? fmtPace(a.sec/(a.dist/1000))+"/km" : a.t==="swim" && a.dist ? fmtPace(a.sec/(a.dist/100))+"/100 m" : a.dist && a.sec ? nf1.format((a.dist/1000)/(a.sec/3600))+" km/h" : "–";
      const d = a.t==="swim" ? nf0.format(a.dist)+" m" : nf1.format(a.dist/1000)+" km";
      return `<tr><td>${dfShort.format(new Date(a.ts))}</td><td>${esc(a.name||a.raw)}${a.id && /^\d+$/.test(a.id) ? ` <a class="strava-link" href="https://www.strava.com/activities/${a.id}" target="_blank" rel="noopener">Voir sur Strava</a>` : ""}</td><td><span class="dot" style="background:var(${SPORTS[a.t].v});margin-right:6px"></span>${esc(a.raw||SPORTS[a.t].label)}</td><td class="num">${a.dist?d:"–"}</td><td class="num">${fmtDur(a.sec)}</td><td class="num">${sp}</td><td class="num">${a.elev?nf0.format(a.elev)+" m":"–"}</td><td class="num">${a.hr||"–"}</td></tr>`;
    }).join("") + (recent.length?"":`<tr><td colspan="8" class="sub">Aucune activité sur la période.</td></tr>`) + `</tbody>`;
}

function baseOpts({stacked=false, tooltip={}, yTick, reverse=false}={}){
  const grid = css("--border"), ink = css("--text-2");
  return {
    responsive:true, maintainAspectRatio:false, animation:false,
    interaction:{mode:"index", intersect:false},
    plugins:{legend:{display:false}, tooltip:Object.assign({backgroundColor:css("--surface"), titleColor:css("--text"), bodyColor:css("--text-2"), footerColor:css("--text"), borderColor:grid, borderWidth:1, padding:10, boxPadding:4, usePointStyle:true}, tooltip)},
    scales:{
      x:{stacked, grid:{display:false}, ticks:{color:ink, maxRotation:0, autoSkip:true, maxTicksLimit:8, font:{size:11}}, border:{color:grid}},
      y:{stacked, reverse, grid:{color:grid}, border:{display:false}, ticks:{color:ink, font:{size:11}, maxTicksLimit:5, callback: yTick || (v=>v)}, beginAtZero: !reverse}
    }
  };
}
function trendChart(canvas, list, f, colorVar, reverse, fmt, tip){
  const box = canvas.parentElement;
  if (list.length < 2){ box.innerHTML = `<p class="sub" style="padding-top:50px;text-align:center">Pas assez de séances sur la période.</p>`; return; }
  const pts = list.slice().sort((a,b)=>a.ts-b.ts);
  const vals = pts.map(f);
  // moyenne mobile sur 5 séances
  const ma = vals.map((_,i)=>{ const s=vals.slice(Math.max(0,i-4),i+1); return s.reduce((a,b)=>a+b,0)/s.length; });
  const c = css(colorVar);
  const opts = baseOpts({reverse, yTick:v=>fmt(v), tooltip:{mode:"nearest", intersect:false, callbacks:{
    title: it => dfFull.format(new Date(pts[it[0].dataIndex].ts)),
    label: ctx => ctx.datasetIndex===0 ? " "+tip(pts[ctx.dataIndex]) : " Tendance : "+fmt(ctx.raw)
  }}});
  opts.scales.y.beginAtZero = false;
  opts.interaction = {mode:"nearest", intersect:false, axis:"x"};
  charts.push(new Chart(canvas, {
    type:"line",
    data:{labels: pts.map(p=>dfShort.format(new Date(p.ts))), datasets:[
      {data:vals, showLine:false, pointRadius:3.5, pointHoverRadius:6, pointBackgroundColor:c+"88", pointBorderColor:c, pointBorderWidth:1},
      {data:ma, borderColor:c, borderWidth:2, pointRadius:0, tension:.35}
    ]},
    options:opts
  }));
}

