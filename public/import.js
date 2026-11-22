"use strict";
/* Lecture des fichiers CSV d'activités : export Strava (activities.csv), export Garmin Connect,
   ou tableau simple (colonnes : date, sport, distance, durée…). Utilise les utilitaires de dashboard.js. */
function parseCsv(text){
  const first = text.split("\n")[0] || "";
  const sep = (first.match(/;/g)||[]).length > (first.match(/,/g)||[]).length ? ";" : ",";
  const rows=[]; let row=[], field="", q=false;
  for (let i=0;i<text.length;i++){
    const c=text[i];
    if (q){ if (c==='"'){ if (text[i+1]==='"'){ field+='"'; i++; } else q=false; } else field+=c; }
    else if (c==='"') q=true;
    else if (c===sep){ row.push(field); field=""; }
    else if (c==='\n'){ row.push(field); rows.push(row); row=[]; field=""; }
    else if (c!=='\r') field+=c;
  }
  if (field||row.length){ row.push(field); rows.push(row); }
  return rows;
}
const normH = h => h.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,"").replace(/[’']/g,"'").replace(/\s+/g," ").trim();
function localIso(ts){
  const d = new Date(ts), p = n => String(n).padStart(2,"0");
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
function parseActivityCsv(text){
  const rows = parseCsv(text.replace(/^﻿/,""));
  if (rows.length < 2) return [];
  const H = rows[0].map(normH);
  const find = aliases => H.findIndex(h => aliases.includes(h));
  const iDate = find(["activity date","date de l'activite","date","start time","heure de debut"]);
  const iType = find(["activity type","type d'activite","type","sport"]);
  const iName = find(["activity name","nom de l'activite","titre","title","nom","name"]);
  const iId = find(["activity id","id de l'activite"]);
  const distIdx = H.map((h,i)=>h==="distance"||h==="distance (km)"?i:-1).filter(i=>i>=0);
  const iMove = find(["moving time","duree de deplacement","temps de deplacement","duree","temps","time","duration"]);
  const iElapsed = find(["elapsed time","temps ecoule","duree ecoulee"]);
  const iElev = find(["elevation gain","denivele positif","ascension totale","total ascent","d+","denivele"]);
  const iHr = find(["average heart rate","frequence cardiaque moyenne","fc moyenne","avg hr","fc moy","fc"]);
  if (iDate<0 || iType<0) return [];
  const out=[];
  for (const r of rows.slice(1)){
    if (r.length < 3) continue;
    const raw = (r[iType]||"").trim(); const ts = parseDate(r[iDate]);
    if (!raw || !isFinite(ts)) continue;
    const t = sportOf(raw);
    const kmOrM = v => (t==="swim" && v>50) ? v : v*1000; // natation souvent en mètres, le reste en km
    let dist = 0;
    if (distIdx.length>1) dist = num(r[distIdx[distIdx.length-1]]);     // export Strava : 2e colonne en mètres
    if (!dist && distIdx.length) dist = kmOrM(num(r[distIdx[0]]));
    const dur = c => c>=0 ? parseDuration(String(r[c]||"").replace(",",".")) : 0;
    const sec = dur(iMove) || dur(iElapsed);
    out.push({
      start_date_local: localIso(ts), sport_type: raw.slice(0,40), name: iName>=0 ? r[iName] : "",
      distance: Math.round(dist), moving_time: Math.round(sec), elevation: iElev>=0 ? num(r[iElev]) : 0,
      avg_hr: iHr>=0 ? num(r[iHr]) : 0, strava_id: iId>=0 && /^\d+$/.test((r[iId]||"").trim()) ? r[iId].trim() : null
    });
  }
  return out;
}
