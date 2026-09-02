/* Material Aging Dashboard — client-side analytics over material_aging.json */
'use strict';

const BUCKETS = ["Expired","0-30","31-60","61-90","91-120"];
const BUCKET_CLASS = {"Expired":"b-Expired","0-30":"b-0-30","31-60":"b-31-60","61-90":"b-61-90","91-120":"b-91-120",">120 Days":"b-gt120"};
const BUCKET_COLOR = {"Expired":"#ff5d6c","0-30":"#f5a623","31-60":"#ffc266","61-90":"#4f8cff","91-120":"#22c1a4",">120 Days":"#6f8298"};
const REGION_PALETTE = ["#4f8cff","#22c1a4","#f5a623","#ff5d6c","#a78bfa","#33c08a","#ffb347","#7b5cff"];
const FONT = "'Segoe UI', Roboto, Arial, sans-serif";

let DATA = [];
let META = {};
const state = {
  regio: new Set(), werks: new Set(), vkorg: "", extwg: "", matkl: "", bucket: "", search: "",
  sortKey: "value", sortDir: -1, page: 1, pageSize: 50
};
const charts = {};

/* ---------- helpers ---------- */
const fmtInt = n => (n==null?0:n).toLocaleString('en-US',{maximumFractionDigits:0});
const fmtNum = (n,d=2) => (n==null?0:n).toLocaleString('en-US',{minimumFractionDigits:0,maximumFractionDigits:d});
const fmtMoney = n => 'SAR '+fmtNum(n,0);
const esc = s => String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

function applyFilters(){
  const q = state.search.trim().toLowerCase();
  return DATA.filter(r=>{
    if(state.regio.size && !state.regio.has(r.regio)) return false;
    if(state.werks.size && !state.werks.has(r.werks)) return false;
    if(state.vkorg && r.vkorg!==state.vkorg) return false;
    if(state.extwg && r.extwg!==state.extwg) return false;
    if(state.matkl && r.matkl!==state.matkl) return false;
    if(state.bucket && r.aging_bucket!==state.bucket) return false;
    if(q){
      const hay = (r.matnr+' '+(r.maktx||'')+' '+(r.charg||'')).toLowerCase();
      if(!hay.includes(q)) return false;
    }
    return true;
  });
}

/* ---------- aggregation ---------- */
function aggregate(rows){
  let totalQty=0,totalVal=0,expiredQty=0,expiredVal=0,batches=rows.length;
  let deadStockVal=0, sl01ExpiredVal=0;
  const seenMat=new Map(); // matnr -> avg_monthly_active (distinct, avoids batch double-count)
  const byBucket={}, byRegion={}, byPlant={}, byMgrp={}, byRegionBucket={}, byPlantBucket={}, byMgrpBucket={}, byMatnr={}, byMatnrBucket={};
  BUCKETS.forEach(b=>byBucket[b]={qty:0,val:0,batches:0});
  for(const r of rows){
    const q=r.clabs||0, v=r.value||0;
    totalQty+=q; totalVal+=v;
    if(r.aging_bucket==='Expired'){
      expiredQty+=q; expiredVal+=v;
      if(r.lgort==='SL01') sl01ExpiredVal+=v;
    }
    const b=r.aging_bucket; if(byBucket[b]){byBucket[b].qty+=q;byBucket[b].val+=v;byBucket[b].batches++;}
    const rg=r.regio||'(none)'; byRegion[rg]=(byRegion[rg]||0)+v;
    if(!byRegionBucket[rg]){byRegionBucket[rg]={};BUCKETS.forEach(x=>byRegionBucket[rg][x]=0);}
    if(byRegionBucket[rg][b]!==undefined)byRegionBucket[rg][b]+=v;
    const pl=r.name1?r.werks+' – '+r.name1:r.werks; byPlant[pl]=(byPlant[pl]||0)+v;
    if(!byPlantBucket[pl]){byPlantBucket[pl]={};BUCKETS.forEach(x=>byPlantBucket[pl][x]=0);}
    if(byPlantBucket[pl][b]!==undefined)byPlantBucket[pl][b]+=v;
    const mg=r.ewbez||r.extwg||'(none)'; byMgrp[mg]=(byMgrp[mg]||0)+v;
    if(!byMgrpBucket[mg]){byMgrpBucket[mg]={};BUCKETS.forEach(x=>byMgrpBucket[mg][x]=0);}
    if(byMgrpBucket[mg][b]!==undefined)byMgrpBucket[mg][b]+=v;
    const mkey=r.maktx?r.matnr+' – '+r.maktx:r.matnr; byMatnr[mkey]=(byMatnr[mkey]||0)+v;
    if(!byMatnrBucket[mkey]){byMatnrBucket[mkey]={};BUCKETS.forEach(x=>byMatnrBucket[mkey][x]=0);}
    if(byMatnrBucket[mkey][b]!==undefined)byMatnrBucket[mkey][b]+=v;
    // dead stock = material with NO sales in last 6 months (avg_monthly_active null/0)
    const am=r.avg_monthly_active;
    if(am===null||am===undefined||am===0){
      if(!seenMat.has(r.matnr)) deadStockVal+=v;
    }
    if(!seenMat.has(r.matnr)) seenMat.set(r.matnr, am);
  }
  // avg portfolio coverage: total qty / total avg daily sales (over materials with sales)
  let totalAvgDaily=0;
  for(const [,am] of seenMat){ if(am) totalAvgDaily+=am/30; }
  const coverageDays=totalAvgDaily>0?totalQty/totalAvgDaily:null;
  return {totalQty,totalVal,expiredQty,expiredVal,batches,deadStockVal,sl01ExpiredVal,coverageDays,byBucket,byRegion,byPlant,byMgrp,byRegionBucket,byPlantBucket,byMgrpBucket,byMatnr,byMatnrBucket};
}

/* ---------- KPIs ---------- */
function renderKPIs(a){
  const b030=a.byBucket['0-30'];
  const expiredPct=a.totalVal?a.expiredVal/a.totalVal*100:0;
  const deadPct=a.totalVal?a.deadStockVal/a.totalVal*100:0;
  const cards=[
    {cls:'k-expired',label:'Expired Value',value:fmtMoney(a.expiredVal),sub:fmtNum(expiredPct,1)+'% of stock · '+fmtInt(a.byBucket['Expired'].batches)+' batches'},
    {cls:'k-near',label:'Expiring (0–30d)',value:fmtMoney(b030.val),sub:fmtNum(b030.qty,0)+' units · '+fmtInt(b030.batches)+' batches'},
    {cls:'',label:'Goods Disposal YTD',value:fmtMoney(window.__AGING__?.gdrn?.total_ytd||0),sub:'fact_gdrn DMBTR · '+fmtInt((window.__AGING__?.gdrn?.records||[]).length)+' lines'},
    {cls:'k-active',label:'Slow Moving (no sales 6mo)',value:fmtMoney(a.deadStockVal),sub:fmtNum(deadPct,1)+'% of stock value'},
  ];
  document.getElementById('kpis').innerHTML=cards.map(c=>`
    <div class="kpi ${c.cls}">
      <div class="label">${c.label}</div>
      <div class="value">${c.value}</div>
      <div class="sub">${c.sub}</div>
    </div>`).join('');
}

/* ---------- charts ---------- */
Chart.defaults.color='#8a99af';
Chart.defaults.font.family=FONT;
Chart.defaults.borderColor='rgba(42,54,71,.6)';

function renderBucketChart(a){
  const labels=BUCKETS, qty=labels.map(b=>a.byBucket[b].qty), val=labels.map(b=>a.byBucket[b].val);
  const ctx=document.getElementById('chart-bucket');
  if(charts.bucket)charts.bucket.destroy();
  charts.bucket=new Chart(ctx,{type:'bar',data:{labels,datasets:[
    {label:'Stock qty',data:qty,backgroundColor:labels.map(b=>BUCKET_COLOR[b]),borderRadius:6,yAxisID:'y',order:2},
    {label:'Valuation (M)',data:val.map(v=>+(v/1e6).toFixed(3)),type:'line',borderColor:'#e7edf5',
     backgroundColor:'#e7edf5',borderWidth:2.5,tension:.3,pointRadius:4,pointBorderColor:'#e7edf5',pointBackgroundColor:'#e7edf5',yAxisID:'y1',order:1}
  ]},options:{maintainAspectRatio:false,interaction:{mode:'index',intersect:false},
    plugins:{legend:{labels:{usePointStyle:true}}},
    scales:{y:{position:'left',title:{display:true,text:'Qty'},ticks:{callback:v=>fmtInt(v)}},
      y1:{position:'right',title:{display:true,text:'Value (M SAR)'},grid:{drawOnChartArea:false},ticks:{callback:v=>v}}}}});
}
function renderBucketTable(a){
  const labels=BUCKETS;
  const rows=labels.map(b=>({bucket:b, qty:a.byBucket[b]?.qty||0, val:a.byBucket[b]?.val||0}));
  const table=document.querySelector('#bucket-table');
  if(!table) return;
  table.innerHTML='<thead><tr><th>Bucket</th><th class="num">Qty</th><th class="num">Value</th></tr></thead>'+
    '<tbody>'+(rows.map(r=>'<tr><td><span class="bucket-tag '+BUCKET_CLASS[r.bucket]+'">'+esc(r.bucket)+'</span></td><td class="num">'+fmtNum(r.qty,0)+'</td><td class="num">'+fmtMoney(r.val)+'</td></tr>').join(''))+'</tbody>';
}
function bucketTooltip(aggData, bucketKey, tipId){
  let tip=document.getElementById(tipId);
  if(!tip){tip=document.createElement('div');tip.id=tipId;tip.className='region-tip';document.body.appendChild(tip);}
  const hide=()=>{ if(tip) tip.style.opacity=0; };
  // hide when focus leaves the canvas/window so the tooltip never sticks.
  // idempotent: guard global listeners so repeated refresh() calls don't stack them.
  if(!bucketTooltip._globalBound){
    const TIPS=()=>[document.getElementById('region-tip'),document.getElementById('plant-tip'),document.getElementById('mgrp-tip'),document.getElementById('mat-tip')];
    window.addEventListener('blur', ()=>{ for(const t of TIPS()) if(t) t.style.opacity=0; });
    document.addEventListener('mouseleave', ()=>{ for(const t of TIPS()) if(t) t.style.opacity=0; });
    bucketTooltip._globalBound = true;
  }
  // canvas mouseleave is wired per-chart below via the chart instance
  bucketTooltip._wire = bucketTooltip._wire || new WeakMap();
  return function(ctx){
    const c=ctx.chart.canvas;
    if(!bucketTooltip._wire.get(c)){
      bucketTooltip._wire.set(c, true);
      c.addEventListener('mouseleave', hide);
      c.addEventListener('mouseout', hide);
    }
    if(ctx.opacity===0 || !ctx.tooltip || !ctx.tooltip.dataPoints || !ctx.tooltip.dataPoints.length){
      hide(); return;
    }
    const dp=ctx.tooltip.dataPoints[0];
    const key=dp.label;
    const rb=aggData[bucketKey][key]||{};
    let html=`<div class="rt-title">${esc(key)}</div>`;
    html+=`<div class="rt-line rt-total"><span class="rt-lbl">Total stock value</span><b>${fmtMoney(dp.raw)}</b></div>`;
    BUCKETS.forEach(b=>{
      const v=rb[b]||0;
      if(v>0) html+=`<div class="rt-line"><span class="rt-sw" style="background:${BUCKET_COLOR[b]}"></span><span class="rt-lbl">${esc(b)}</span><b>${fmtMoney(v)}</b></div>`;
    });
    tip.innerHTML=html;
    const rect=c.getBoundingClientRect();
    let x=rect.left+window.scrollX+ctx.tooltip.caretX+14;
    let y=rect.top+window.scrollY+ctx.tooltip.caretY-10;
    const tw=tip.offsetWidth, th=tip.offsetHeight;
    if(x+tw>window.scrollX+rect.left+rect.width+rect.left) x=rect.left+window.scrollX+ctx.tooltip.caretX-tw-14;
    if(x<window.scrollX)x=window.scrollX+8;
    if(y+th>window.scrollY+window.innerHeight)y=window.scrollY+window.innerHeight-th-8;
    if(y<window.scrollY)y=window.scrollY+8;
    tip.style.left=x+'px'; tip.style.top=y+'px'; tip.style.opacity=1;
  };
}
function renderRegion(a){
  const entries=Object.entries(a.byRegion).sort((x,y)=>y[1]-x[1]);
  const ctx=document.getElementById('chart-region');
  if(charts.region)charts.region.destroy();
  charts.region=new Chart(ctx,{type:'bar',data:{labels:entries.map(e=>e[0]),
    datasets:[{label:'Stock value',data:entries.map(e=>e[1]),
      backgroundColor:entries.map((_,i)=>REGION_PALETTE[i%REGION_PALETTE.length]),borderRadius:6}]},
    options:{indexAxis:'y',maintainAspectRatio:false,
      plugins:{legend:{display:false},
        tooltip:{enabled:false,external:bucketTooltip(a,'byRegionBucket','region-tip')}},
      scales:{x:{ticks:{callback:v=>fmtNum(v/1e6,1)+'M'}}}}});
}
function renderPlant(a){
  const top=Object.entries(a.byPlant).sort((x,y)=>y[1]-x[1]).slice(0,15);
  const ctx=document.getElementById('chart-plant');
  if(charts.plant)charts.plant.destroy();
  charts.plant=new Chart(ctx,{type:'bar',data:{labels:top.map(e=>e[0]),
    datasets:[{label:'Stock value',data:top.map(e=>e[1]),backgroundColor:'#22c1a4',borderRadius:6}]},
    options:{maintainAspectRatio:false,
      plugins:{legend:{display:false},tooltip:{enabled:false,external:bucketTooltip(a,'byPlantBucket','plant-tip')}},
      scales:{y:{ticks:{callback:v=>fmtNum(v/1e6,1)+'M'}}}}});
}
function renderMgrp(a){
  const entries=Object.entries(a.byMgrp).sort((x,y)=>y[1]-x[1]);
  const ctx=document.getElementById('chart-mgrp');
  if(charts.mgrp)charts.mgrp.destroy();
  charts.mgrp=new Chart(ctx,{type:'bar',data:{labels:entries.map(e=>e[0]),
    datasets:[{label:'Stock value',data:entries.map(e=>e[1]),
      backgroundColor:entries.map((_,i)=>`hsl(${210-i*14} 70% 58%)`),borderRadius:6}]},
    options:{indexAxis:'y',maintainAspectRatio:false,
      plugins:{legend:{display:false},tooltip:{enabled:false,external:bucketTooltip(a,'byMgrpBucket','mgrp-tip')}},
      scales:{x:{ticks:{callback:v=>fmtNum(v/1e6,1)+'M'}}}}});
}

function renderTopMat(rows){
  // aggregate per MATNR from the filtered rows
  const m={};
  for(const r of rows){
    const k=r.matnr; const o=m[k]||(m[k]={matnr:r.matnr, maktx:r.maktx, ewbez:r.ewbez, qty:0, value:0,
      avgMonthly:r.avg_monthly_active, forecast:r.forecast_value, forecastQty:r.forecast_qty, buckets:{}});
    o.qty+=(r.clabs||0); o.value+=(r.value||0);
    if(o.avgMonthly===undefined) o.avgMonthly=r.avg_monthly_active;
    o.buckets[r.aging_bucket]=(o.buckets[r.aging_bucket]||0)+(r.value||0);
  }
  const list=Object.values(m).map(o=>{
    const avgDaily=(o.avgMonthly||0)/30;
    const coverage=avgDaily>0?o.qty/avgDaily:null;
    const bk={}; BUCKETS.forEach(b=>bk['b_'+b]=(o.buckets[b]||0));
    return {matnr:o.matnr, maktx:o.maktx, ewbez:o.ewbez, qty:o.qty, value:o.value,
      avgMonthly:o.avgMonthly||0, avgDaily, coverage, forecast:o.forecast||0, forecastQty:o.forecastQty||0, ...bk};
  }).sort((x,y)=>y.value-x.value).slice(0, topMatState.limit);
  topMatState.data=list; topMatState.sortKey='value'; topMatState.sortDir=-1;
  drawTopMat();
}

const topMatState={data:[], sortKey:'value', sortDir:-1, limit:10};
function drawTopMat(){
  const cols=[
    {k:'matnr',t:'Material',cls:''},
    {k:'maktx',t:'Description',cls:''},
    ...BUCKETS.map(b=>({k:'b_'+b,t:b,cls:'num'})),
    {k:'value',t:'Total Value',cls:'num'},
    {k:'qty',t:'Total Qty',cls:'num'},
    {k:'forecastQty',t:'Forecast Qty',cls:'num'},
    {k:'avgMonthly',t:'Avg Monthly Sales',cls:'num'},
    {k:'avgDaily',t:'Avg Daily Sales',cls:'num'},
    {k:'coverage',t:'Coverage Days',cls:'num'},
  ];
  const data=[...topMatState.data].sort((x,y)=>{
    let a=x[topMatState.sortKey], b=y[topMatState.sortKey];
    if(typeof a==='number'&&typeof b==='number')return (a-b)*topMatState.sortDir;
    a=(a==null?'':String(a)); b=(b==null?'':String(b));
    return a<b?-1*topMatState.sortDir:a>b?1*topMatState.sortDir:0;
  });
  const thead=document.querySelector('#topmat-table thead');
  thead.innerHTML='<tr>'+cols.map(c=>`<th data-k="${c.k}" class="${c.cls}">${c.t}${topMatState.sortKey===c.k?(topMatState.sortDir<0?' ▼':' ▲'):''}</th>`).join('')+'</tr>';
  thead.onclick=e=>{
    const th=e.target.closest('th'); if(!th) return; const k=th.dataset.k;
    if(topMatState.sortKey===k) topMatState.sortDir*=-1; else {topMatState.sortKey=k; topMatState.sortDir=-1;}
    drawTopMat();
  };
  document.querySelector('#topmat-table tbody').innerHTML=data.map(r=>{
    const cov=r.coverage==null?'—':fmtNum(r.coverage,0)+' d';
    const avm=r.avgMonthly?fmtNum(r.avgMonthly,0):'—';
    const avd=r.avgMonthly?fmtNum(r.avgDaily,1):'—';
    const bucketCells=BUCKETS.map(b=>{
      const v=r['b_'+b]||0;
      const disp=v?fmtMoney(v):'—';
      return `<td class="num" style="color:${v?BUCKET_COLOR[b]:'inherit'}">${disp}</td>`;
    }).join('');
    return `<tr>
      <td>${esc(r.matnr)}</td>
      <td>${esc(r.maktx)}</td>
      ${bucketCells}
      <td class="num">${fmtMoney(r.value)}</td>
      <td class="num">${fmtNum(r.qty,0)}</td>
      <td class="num">${r.forecastQty?fmtNum(r.forecastQty,0):'—'}</td>
      <td class="num">${avm}</td>
      <td class="num">${avd}</td>
      <td class="num">${cov}</td>
    </tr>`;
  }).join('');
}

/* ---------- table ---------- */
const COLS=[
  {k:'matnr',t:'Material',cls:''},
  {k:'maktx',t:'Description',cls:''},
  {k:'werks',t:'Plant',cls:''},
  {k:'lgort',t:'SLoc',cls:''},
  {k:'charg',t:'Batch',cls:''},
  {k:'extwg',t:'Mat.Grp',cls:''},
  {k:'ewbez',t:'Mat.Grp Description',cls:''},
  {k:'clabs',t:'Qty',cls:'num'},
  {k:'ma_price',t:'Price',cls:'num'},
  {k:'value',t:'Value',cls:'num'},
  {k:'aging_bucket',t:'Bucket',cls:''},
];
function renderTable(rows){
  const cols=COLS;
  document.querySelector('#detail-table thead').innerHTML=
    '<tr>'+cols.map(c=>`<th data-k="${c.k}" class="${c.cls}">${c.t}${state.sortKey===c.k?(state.sortDir<0?' ▼':' ▲'):''}</th>`).join('')+'</tr>';
  const sorted=[...rows].sort((x,y)=>{
    let a=x[state.sortKey],b=y[state.sortKey];
    if(typeof a==='number'&&typeof b==='number')return (a-b)*state.sortDir;
    a=(a==null?'':String(a));b=(b==null?'':String(b));
    return a<b?-1*state.sortDir:a>b?1*state.sortDir:0;
  });
  const total=sorted.length, pages=Math.max(1,Math.ceil(total/state.pageSize));
  if(state.page>pages)state.page=pages;
  const start=(state.page-1)*state.pageSize, pageRows=sorted.slice(start,start+state.pageSize);
  document.querySelector('#detail-table tbody').innerHTML=pageRows.map(r=>'<tr>'+
    cols.map(c=>{
      if(c.k==='aging_bucket') return `<td><span class="bucket-tag ${BUCKET_CLASS[r.aging_bucket]||''}">${esc(r.aging_bucket)}</span></td>`;
      if(c.cls==='num'){const v=r[c.k];return `<td class="num">${c.k==='value'?fmtMoney(v):fmtNum(v,c.k==='clabs'?0:2)}</td>`;}
      return `<td>${esc(r[c.k])}</td>`;
    }).join('')+'</tr>').join('');
  document.getElementById('table-count').textContent=fmtInt(total)+' batches';
  document.getElementById('page-info').textContent=`Page ${state.page} / ${pages}`;
  document.getElementById('prev').disabled=state.page<=1;
  document.getElementById('next').disabled=state.page>=pages;
}

function csvFrom(rows, head, cols, filename){
  const lines=[head.join(',')];
  for(const r of rows){
    const row=cols.map(k=>{let v=r[k];v=v==null?'':String(v);return /[",\n]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v;});
    lines.push(row.join(','));
  }
  const blob=new Blob([lines.join('\n')],{type:'text/csv'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);
  a.download=filename;a.click();URL.revokeObjectURL(a.href);
}

function exportCSV(rows){
  const head=['MATNR','MAKTX','WERKS','SLOC','NAME1','REGIO','CHARG','EXTWG','EWBEZ','CLABS','MA_PRICE','VALUE','AGING_BUCKET'];
  const cols=['matnr','maktx','werks','lgort','name1','regio','charg','extwg','ewbez','clabs','ma_price','value','aging_bucket'];
  csvFrom(rows, head, cols, 'material_aging_filtered.csv');
}

/* ---------- dead stock table ---------- */
let deadData=[];
function renderDeadStock(rows){
  const m={};
  for(const r of rows){
    const am=r.avg_monthly_active;
    if(am===null||am===undefined||am===0){
      const k=r.matnr;
      const o=m[k]||(m[k]={matnr:r.matnr, maktx:r.maktx, ewbez:r.ewbez, qty:0, value:0, b:{}, lastSales:r.last_sales});
      o.qty+=(r.clabs||0); o.value+=(r.value||0);
      o.b[r.aging_bucket]=(o.b[r.aging_bucket]||0)+(r.value||0);
      // keep the most recent last_sales seen for this material
      if(r.last_sales && (!o.lastSales || r.last_sales>o.lastSales)) o.lastSales=r.last_sales;
    }
  }
  deadData=Object.values(m).map(o=>{
    let dom='(none)', dv=-1;
    for(const b in o.b){ if(o.b[b]>dv){dv=o.b[b]; dom=b;} }
    return {matnr:o.matnr, maktx:o.maktx, ewbez:o.ewbez, qty:o.qty, value:o.value, bucket:dom, lastSales:o.lastSales};
  }).sort((x,y)=>y.value-x.value);
  drawDead();
}
const DEAD_COLS=[
  {k:'matnr',t:'Material',cls:''},
  {k:'maktx',t:'Description',cls:''},
  {k:'ewbez',t:'Mat.Grp',cls:''},
  {k:'qty',t:'Total Qty',cls:'num'},
  {k:'value',t:'Stock Value',cls:'num'},
  {k:'bucket',t:'Aging Bucket',cls:''},
  {k:'lastSales',t:'Last Sales Date',cls:''},
];
let deadSort={key:'value',dir:-1};
function drawDead(){
  const data=[...deadData].sort((x,y)=>{
    let a=x[deadSort.key],b=y[deadSort.key];
    if(typeof a==='number'&&typeof b==='number')return (a-b)*deadSort.dir;
    a=String(a==null?'':a);b=String(b==null?'':b);
    return a<b?-1*deadSort.dir:a>b?1*deadSort.dir:0;
  });
  const thead=document.querySelector('#dead-table thead');
  thead.innerHTML='<tr>'+DEAD_COLS.map(c=>`<th data-k="${c.k}" class="${c.cls}">${c.t}${deadSort.key===c.k?(deadSort.dir<0?' ▼':' ▲'):''}</th>`).join('')+'</tr>';
  thead.onclick=e=>{
    const th=e.target.closest('th'); if(!th) return; const k=th.dataset.k;
    if(deadSort.key===k) deadSort.dir*=-1; else {deadSort.key=k; deadSort.dir=-1;}
    drawDead();
  };
  document.querySelector('#dead-table tbody').innerHTML=data.map(r=>{
    const cls=BUCKET_CLASS[r.bucket]||'';
    const ls=r.lastSales?esc(r.lastSales):'—';
    return `<tr>
    <td>${esc(r.matnr)}</td>
    <td>${esc(r.maktx)}</td>
    <td>${esc(r.ewbez)}</td>
    <td class="num">${fmtNum(r.qty,0)}</td>
    <td class="num">${fmtMoney(r.value)}</td>
    <td><span class="bucket-tag ${cls}">${esc(r.bucket)}</span></td>
    <td>${ls}</td>
  </tr>`;
  }).join('');
  document.getElementById('dead-count').textContent=fmtInt(deadData.length)+' materials · '+fmtMoney(deadData.reduce((s,r)=>s+r.value,0))+' tied up';
}

/* ---------- GDRN (goods disposal) table ---------- */
function renderGdrnTable(){
  const recs=(window.__AGING__&&window.__AGING__.gdrn&&window.__AGING__.gdrn.records)||[];
  const tbody=document.querySelector('#gdrn-table tbody');
  if(!tbody) return;
  tbody.innerHTML=recs.map(r=>{
    const matnr=String(r.matnr||'').replace(/^0+/,'')||'0';
    return `<tr>
      <td>${esc(r.date||'')}</td>
      <td>${esc(r.werks||'')}</td>
      <td>${esc(matnr)}</td>
      <td>${esc(r.maktx||'')}</td>
      <td>${esc(r.lgort||'')}</td>
      <td>${esc(r.charg||'')}</td>
      <td class="num">${fmtNum(r.menge,2)}</td>
      <td>${esc(r.meins||'')}</td>
      <td class="num">${fmtMoney(r.dmbtr)}</td>
    </tr>`;
  }).join('');
  document.getElementById('gdrn-count').textContent=fmtInt(recs.length)+' lines · '+fmtMoney(recs.reduce((s,r)=>s+(r.dmbtr||0),0))+' disposed YTD';
}

/* ---------- wire up ---------- */
function refresh(){
  const rows=applyFilters();
  const a=aggregate(rows);
  renderKPIs(a);
  renderBucketChart(a);renderBucketTable(a);renderRegion(a);renderPlant(a);renderMgrp(a);renderTopMat(rows);
  renderTable(rows);
  renderDeadStock(rows);
  renderGdrnTable();
}

function injectMSToggle(root,label){
  let t=root.querySelector('.ms-toggle');
  if(!t){
    t=document.createElement('div');t.className='ms-toggle';
    root.insertBefore(t,root.firstChild);
  }
  t.innerHTML=`<span class="lbl">${esc(label)}</span><span class="cnt">All</span><span class="chev">▾</span>`;
  let m=root.querySelector('.ms-menu');
  if(!m){
    m=document.createElement('div');m.className='ms-menu';
    root.appendChild(m);
  }
}
function buildSelect(elId,values,allLabel){
  const el=document.getElementById(elId);
  el.innerHTML='<option value="">'+allLabel+'</option>'+
    values.map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join('');
}
function buildMultiSelect(root,key,values,label){
  const selAll=()=> (values.length+' selected');
  const toggle=root.querySelector('.ms-toggle');
  const menu=root.querySelector('.ms-menu');
  const search=root.querySelector('.ms-search');
  if(search)search.addEventListener('input',()=>{
    const q=search.value.toLowerCase();
    menu.querySelectorAll('.ms-opt').forEach(o=>{
      o.style.display=(o.dataset.label||'').toLowerCase().includes(q)?'':'none';
    });
  });
  toggle.addEventListener('click',e=>{e.stopPropagation();root.classList.toggle('open');});
  menu.addEventListener('click',e=>e.stopPropagation());
  root.querySelectorAll('input[type=checkbox]').forEach(cb=>{
    cb.addEventListener('change',()=>{
      if(cb.checked)state[key].add(cb.value);else state[key].delete(cb.value);
      const n=state[key].size;toggle.querySelector('.cnt').textContent=n?n+' / '+values.length:'All';
      refresh();
    });
  });
  root.querySelector('.ms-clear').addEventListener('click',()=>{
    state[key].clear();root.querySelectorAll('input').forEach(c=>c.checked=false);
    toggle.querySelector('.cnt').textContent='All';refresh();
  });
  root.querySelector('.ms-all').addEventListener('click',()=>{
    state[key].clear();root.querySelectorAll('input').forEach(c=>c.checked=true);
    state[key]=new Set(values);toggle.querySelector('.cnt').textContent=values.length+' / '+values.length;refresh();
  });
  document.addEventListener('click',()=>root.classList.remove('open'));
  toggle.querySelector('.cnt').textContent='All';
}

function initUI(){
  // single selects
  const regions=[...new Set(DATA.map(r=>r.regio).filter(Boolean))].sort();
  const plants=[...new Set(DATA.map(r=>r.werks).filter(Boolean))].sort();
  const vkorgs=[...new Set(DATA.map(r=>r.vkorg).filter(Boolean))].sort();
  const extwgDesc=new Map();
  DATA.forEach(r=>{ if(r.extwg && !extwgDesc.has(r.extwg) && r.ewbez) extwgDesc.set(r.extwg,r.ewbez); });
  const extwgs=[...new Set(DATA.map(r=>r.extwg).filter(Boolean))].sort();
  const matklDesc=new Map();
  DATA.forEach(r=>{ if(r.matkl && !matklDesc.has(r.matkl) && r.wgbez) matklDesc.set(r.matkl,r.wgbez); });
  const matkls=[...new Set(DATA.map(r=>r.matkl).filter(Boolean))].sort();
  const buckets=BUCKETS.filter(b=>DATA.some(r=>r.aging_bucket===b));
  buildSelect('f-vkorg',vkorgs,'All sales orgs');
  const extwgSel=document.getElementById('f-extwg');
  extwgSel.innerHTML='<option value="">All ext material groups</option>'+
    extwgs.map(v=>`<option value="${esc(v)}">${esc(v)}${extwgDesc.get(v)?' – '+esc(extwgDesc.get(v)):''}</option>`).join('');
  const matklSel=document.getElementById('f-matkl');
  matklSel.innerHTML='<option value="">All material groups</option>'+
    matkls.map(v=>`<option value="${esc(v)}">${esc(v)}${matklDesc.get(v)?' – '+esc(matklDesc.get(v)):''}</option>`).join('');
  buildSelect('f-bucket',buckets,'All buckets');
  document.getElementById('f-vkorg').onchange=e=>{state.vkorg=e.target.value;refresh();};
  extwgSel.onchange=e=>{state.extwg=e.target.value;refresh();};
  matklSel.onchange=e=>{state.matkl=e.target.value;refresh();};
  document.getElementById('f-bucket').onchange=e=>{state.bucket=e.target.value;refresh();};
  document.getElementById('f-search').oninput=e=>{state.search=e.target.value;state.page=1;refresh();};
  const topnSel=document.getElementById('f-topn');
  if(topnSel) topnSel.onchange=e=>{topMatState.limit=+e.target.value; renderTopMat(applyFilters());};
  document.getElementById('export-top-csv').onclick=()=>{
    const head=['MATNR','MAKTX','EXPIRED','0-30','31-60','61-90','91-120','TOTAL_VALUE','TOTAL_QTY','FORECAST_QTY','AVG_MONTHLY_SALES','AVG_DAILY_SALES','COVERAGE_DAYS'];
    const cols=['matnr','maktx','b_Expired','b_0-30','b_31-60','b_61-90','b_91-120','value','qty','forecastQty','avgMonthly','avgDaily','coverage'];
    const data=[...topMatState.data].map(r=>{
      const o={...r};
      o['b_Expired']=r['b_Expired']||0;
      o['b_0-30']=r['b_0-30']||0;
      o['b_31-60']=r['b_31-60']||0;
      o['b_61-90']=r['b_61-90']||0;
      o['b_91-120']=r['b_91-120']||0;
      o['coverage']=r.coverage==null?'':r.coverage;
      return o;
    });
    csvFrom(data, head, cols, 'top_materials_by_stock_value.csv');
  };

  // multi-selects (region, plant)
  const regioRoot=document.querySelector('.ms[data-key="regio"]');
  injectMSToggle(regioRoot,'Region');
  regioRoot.querySelector('.ms-menu').innerHTML=
    '<div class="ms-opt"><input type="checkbox" value="__ALL__" disabled hidden></div>'+
    regions.map(v=>`<label class="ms-opt" data-label="${esc(v)}"><input type="checkbox" value="${esc(v)}">${esc(v)}</label>`).join('')+
    `<div class="ms-actions"><button class="ms-all">All</button><button class="ms-clear">Clear</button></div>`;
  const plantRoot=document.querySelector('.ms[data-key="werks"]');
  injectMSToggle(plantRoot,'Plant');
  const werksDesc=new Map();
  DATA.forEach(r=>{ if(r.werks && !werksDesc.has(r.werks) && r.name1) werksDesc.set(r.werks,r.name1); });
  plantRoot.querySelector('.ms-menu').innerHTML=
    '<input class="ms-search" placeholder="search plant…">'+
    plants.map(v=>`<label class="ms-opt" data-label="${esc(v)}${werksDesc.get(v)?' '+esc(werksDesc.get(v)):''}"><input type="checkbox" value="${esc(v)}">${esc(v)}${werksDesc.get(v)?' – '+esc(werksDesc.get(v)):''}</label>`).join('')+
    `<div class="ms-actions"><button class="ms-all">All</button><button class="ms-clear">Clear</button></div>`;
  buildMultiSelect(regioRoot,'regio',regions);
  buildMultiSelect(plantRoot,'werks',plants);

  // table head sort
  document.querySelector('#detail-table thead').addEventListener('click',e=>{
    const th=e.target.closest('th');if(!th)return;const k=th.dataset.k;
    if(state.sortKey===k)state.sortDir*=-1;else{state.sortKey=k;state.sortDir=-1;}
    renderTable(applyFilters());
  });
  document.getElementById('prev').onclick=()=>{if(state.page>1){state.page--;renderTable(applyFilters());}};
  document.getElementById('next').onclick=()=>{state.page++;renderTable(applyFilters());};
  document.getElementById('page-size').onchange=e=>{state.pageSize=+e.target.value;state.page=1;renderTable(applyFilters());};
  document.getElementById('export-csv').onclick=()=>exportCSV(applyFilters());
  document.getElementById('export-dead-csv').onclick=()=>{
    const head=['MATNR','MAKTX','MAT_GRUP','TOTAL_QTY','STOCK_VALUE','AGING_BUCKET','LAST_SALES_DATE'];
    const cols=['matnr','maktx','ewbez','qty','value','bucket','lastSales'];
    csvFrom(deadData, head, cols, 'dead_stock_no_sales_6mo.csv');
  };
  document.getElementById('reset').onclick=()=>{
    state.regio.clear();state.werks.clear();state.vkorg='';state.extwg='';state.matkl='';state.bucket='';state.search='';state.page=1;
    document.querySelectorAll('.ms').forEach(r=>{r.querySelectorAll('input').forEach(c=>c.checked=false);const c=r.querySelector('.cnt');if(c)c.textContent='All';r.classList.remove('open');});
    ['f-vkorg','f-extwg','f-matkl','f-bucket'].forEach(id=>document.getElementById(id).value='');
    document.getElementById('f-search').value='';
    refresh();
  };
}

/* ---------- boot ---------- */
function boot(){
  const el=document.createElement('div');el.className='loading';
  el.innerHTML='<div><div class="spin"></div>Loading material aging data…</div>';document.body.appendChild(el);
  const done=json=>{
    META=json.meta||{};
    const EXCLUDE_BUCKET='>120 Days';
    DATA=(json.records||[])
      .filter(r=>r.aging_bucket!==EXCLUDE_BUCKET)
      .map(r=>{const x={...r}; x.matnr=String(x.matnr||'').replace(/^0+/,'')||'0'; return x;});
    document.getElementById('meta-time').textContent='Data refreshed: '+(META.generated_at||'?');
    initUI();refresh();
    el.remove();
  };
  const fail=err=>{
    el.innerHTML='<div style="color:#ff8a96">Failed to load data.<br><small>'+esc(err.message)+'</small></div>';
  };
  // Prefer inline data.js (works via file:// double-click); fall back to fetch (http server)
  if(window.__AGING__ && window.__AGING__.records){ try{return done(window.__AGING__);}catch(e){return fail(e);} }
  fetch('data/material_aging.json').then(r=>r.json()).then(done).catch(fail);
}
document.addEventListener('DOMContentLoaded',boot);
