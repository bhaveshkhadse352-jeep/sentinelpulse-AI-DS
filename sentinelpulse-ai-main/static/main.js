/* SentinelPulse AI frontend — Flask API remains the source of truth. */
'use strict';
let threatData = [];
let lineChart = null;
let doughnutChart = null;
let pendingMitigationId = null;
let isBusy = false;
const $ = id => document.getElementById(id);
const palette = () => {
  const s = getComputedStyle(document.documentElement);
  return { text:s.getPropertyValue('--muted').trim(), grid:s.getPropertyValue('--border').trim(),
    cyan:s.getPropertyValue('--cyan').trim(), red:s.getPropertyValue('--red').trim(),
    orange:s.getPropertyValue('--orange').trim(), violet:s.getPropertyValue('--violet').trim(),
    green:s.getPropertyValue('--green').trim() };
};
async function fetchJson(url, options={}) {
  const response = await fetch(url, options);
  const type = response.headers.get('content-type') || '';
  const data = type.includes('application/json') ? await response.json() : null;
  if (!response.ok) throw new Error(data?.error || `Request failed (${response.status})`);
  return data;
}
function toast(message, kind='success') {
  const node = document.createElement('div');
  node.className = `toast ${kind === 'error' ? 'error' : kind === 'info' ? 'info' : ''}`;
  node.textContent = message;
  $('toastRegion').appendChild(node);
  window.setTimeout(() => node.remove(), 3600);
}
function setLoading(el, value) { if (el) el.disabled = value; }
function updateDate() {
  $('currentDate').textContent = new Intl.DateTimeFormat('en-IN',{weekday:'short',day:'2-digit',month:'short',year:'numeric'}).format(new Date());
  $('lastUpdated').textContent = `Updated ${new Intl.DateTimeFormat('en-IN',{hour:'2-digit',minute:'2-digit'}).format(new Date())}`;
}
async function updateKPIs() {
  const ids = ['kpi-total-logs','kpi-active-critical','kpi-mitigated','kpi-health-score'];
  ids.forEach(id => { $(id).classList.add('is-loading'); });
  try {
    const data = await fetchJson('/api/kpis');
    $('kpi-total-logs').textContent = data.total_logs;
    $('kpi-active-critical').textContent = data.active_critical;
    $('kpi-mitigated').textContent = data.mitigated;
    $('kpi-health-score').replaceChildren(document.createTextNode(String(data.health_score)), Object.assign(document.createElement('small'),{textContent:'%'}));
    $('healthBar').style.width = `${Math.max(0,Math.min(100,Number(data.health_score)||0))}%`;
    $('nav-threat-count').textContent = threatData.filter(x=>x.status==='Active').length;
  } catch (error) { toast(`Could not load KPI data: ${error.message}`,'error'); }
  finally { ids.forEach(id => $(id).classList.remove('is-loading')); updateDate(); }
}
function badge(text, className) {
  const el = document.createElement('span'); el.className = className; el.textContent = text; return el;
}
function renderThreatTable() {
  const tbody = $('threatTableBody');
  tbody.replaceChildren();
  const severity = $('severityFilter').value;
  const query = $('searchBox').value.trim().toLowerCase();
  const rows = threatData.filter(log => (severity==='All'||log.severity===severity) &&
    [log.source_ip,log.attack_type,log.mitre_id,log.status,log.timestamp].some(v=>String(v??'').toLowerCase().includes(query)));
  $('recordCount').textContent = `${rows.length} ${rows.length===1?'record':'records'}`;
  $('tableSummary').textContent = `${threatData.filter(x=>x.status==='Active').length} active · ${threatData.filter(x=>x.status==='Mitigated').length} mitigated`;
  if (!rows.length) {
    const tr=document.createElement('tr'), td=document.createElement('td');
    td.colSpan=7; td.className='empty-cell'; td.textContent=query||severity!=='All'?'No incidents match your filters.':'No threat records available.';
    tr.appendChild(td); tbody.appendChild(tr); return;
  }
  rows.slice().reverse().forEach(log => {
    const tr=document.createElement('tr');
    const values=[log.timestamp,log.source_ip,log.attack_type,log.mitre_id];
    values.forEach(value=>{const td=document.createElement('td');td.textContent=String(value??'—');tr.appendChild(td);});
    let td=document.createElement('td'); td.appendChild(badge(log.severity,`severity-badge sev-${String(log.severity).toLowerCase()}`));tr.appendChild(td);
    td=document.createElement('td');td.appendChild(badge(log.status,`status-badge ${log.status==='Active'?'status-active':'status-mitigated'}`));tr.appendChild(td);
    td=document.createElement('td');
    if(log.status==='Active'){
      const button=document.createElement('button');button.type='button';button.className='mitigate-btn';button.textContent='Mitigate';
      button.setAttribute('aria-label',`Mitigate incident ${log.id}`);button.addEventListener('click',()=>openMitigation(log.id));td.appendChild(button);
    } else {td.textContent='—';}
    tr.appendChild(td);tbody.appendChild(tr);
  });
}
async function loadThreats() {
  try { threatData=await fetchJson('/api/threats'); renderThreatTable(); updateCharts(); $('nav-threat-count').textContent=threatData.filter(x=>x.status==='Active').length; }
  catch(error){ $('threatTableBody').replaceChildren();const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=7;td.className='empty-cell';td.textContent=`Unable to load threat feed: ${error.message}`;tr.appendChild(td);$('threatTableBody').appendChild(tr);toast('Threat feed unavailable. Check that the Flask server is running.','error');}
}
async function refreshAll(showMessage=false) {
  await Promise.all([loadThreats(),updateKPIs()]);
  if(showMessage)toast('Dashboard data refreshed.','success');
}
function initCharts() {
  if (!window.Chart) { toast('Chart.js could not be loaded. Charts are unavailable.','error'); return; }
  const p=palette();
  lineChart=new Chart($('lineChart'),{type:'line',data:{labels:[],datasets:[]},options:{
    responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},
    plugins:{legend:{display:false},tooltip:{backgroundColor:'#0b1728',titleColor:'#e7eef8',bodyColor:'#c0cede',borderColor:'#31445d',borderWidth:1,padding:10}},
    scales:{x:{grid:{display:false},ticks:{color:p.text,font:{size:9},maxTicksLimit:6}},y:{beginAtZero:true,grid:{color:p.grid},ticks:{color:p.text,font:{size:9},maxTicksLimit:5}}}
  }});
  doughnutChart=new Chart($('doughnutChart'),{type:'doughnut',data:{labels:[],datasets:[{data:[],backgroundColor:[p.red,p.orange,p.violet,p.green,p.cyan],borderWidth:0,hoverOffset:5}]},options:{responsive:true,maintainAspectRatio:false,cutout:'76%',plugins:{legend:{display:false},tooltip:{backgroundColor:'#0b1728',padding:10}}}});
}
function updateCharts() {
  if(!lineChart||!doughnutChart)return;
  const p=palette(), now=Date.now(), labels=[],traffic=[],threats=[];
  for(let i=11;i>=0;i--){
    const time=new Date(now-i*60000);
    labels.push(time.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'}));
    traffic.push(Math.floor(Math.random()*150)+100); // Simulated demo traffic — not network telemetry.
    const count=threatData.filter(log=>{const t=new Date(String(log.timestamp).replace(' ','T')).getTime();return Number.isFinite(t)&&Math.abs(t-time.getTime())<60000&&log.status==='Active';}).length;
    threats.push(count);
  }
  lineChart.data={labels,datasets:[
    {label:'Simulated traffic (demo)',data:traffic,borderColor:p.cyan,backgroundColor:p.cyan+'22',tension:.38,pointRadius:0,pointHoverRadius:4,borderWidth:2,fill:true},
    {label:'Active threat events',data:threats,borderColor:p.red,backgroundColor:p.red+'12',tension:.38,pointRadius:2,pointHoverRadius:5,borderWidth:2,fill:true}
  ]}; lineChart.options.scales.x.ticks.color=p.text;lineChart.options.scales.y.ticks.color=p.text;lineChart.options.scales.y.grid.color=p.grid;lineChart.update('none');
  const counts={};threatData.filter(x=>x.status==='Active').forEach(x=>counts[x.attack_type]=(counts[x.attack_type]||0)+1);
  const entries=Object.entries(counts), colors=[p.red,p.orange,p.violet,p.green,p.cyan];
  doughnutChart.data.labels=entries.map(x=>x[0]);doughnutChart.data.datasets[0].data=entries.map(x=>x[1]);doughnutChart.data.datasets[0].backgroundColor=colors.slice(0,entries.length);doughnutChart.update();
  $('donutTotal').textContent=entries.reduce((sum,x)=>sum+x[1],0);
  const legend=$('chartLegend');legend.replaceChildren();
  if(!entries.length){const empty=document.createElement('span');empty.textContent='No active incidents';legend.appendChild(empty);}
  entries.forEach(([name,count],i)=>{const item=document.createElement('span'),dot=document.createElement('i');dot.style.background=colors[i%colors.length];item.append(dot,document.createTextNode(`${name} · ${count}`));legend.appendChild(item);});
}
async function simulateAttack(button) {
  const type=button.dataset.type;setLoading(button,true);
  const old=button.querySelector('small')?.textContent;
  if(button.querySelector('small'))button.querySelector('small').textContent='Creating incident...';
  try{
    await fetchJson('/api/simulate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type})});
    await refreshAll();toast(`${type} simulation added to the incident feed.`); 
  }catch(error){toast(`Simulation failed: ${error.message}`,'error');}
  finally{setLoading(button,false);if(button.querySelector('small'))button.querySelector('small').textContent=old;}
}
function openMitigation(id){pendingMitigationId=id;$('confirmModal').hidden=false;$('confirmMitigate').focus();}
function closeMitigation(){$('confirmModal').hidden=true;pendingMitigationId=null;}
async function confirmMitigation(){
  if(pendingMitigationId===null)return;
  const id=pendingMitigationId;setLoading($('confirmMitigate'),true);
  try{
    await fetchJson('/api/mitigate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id})});
    closeMitigation();await refreshAll();toast('Incident record marked as mitigated.');
  }catch(error){toast(`Could not update incident: ${error.message}`,'error');}
  finally{setLoading($('confirmMitigate'),false);}
}
function addChatMessage(sender,message){
  const log=$('chatLog'),wrap=document.createElement('div'),avatar=document.createElement('span'),content=document.createElement('div'),meta=document.createElement('span'),bubble=document.createElement('div');
  wrap.className=`chat-message ${sender==='You'?'user':'assistant'}`;avatar.className='chat-avatar';
  if(window.lucide){const icon=document.createElement('i');icon.setAttribute('data-lucide',sender==='You'?'user':'bot');avatar.appendChild(icon);}else avatar.textContent=sender==='You'?'U':'AI';
  content.className='bubble-wrap';meta.className='sender';meta.textContent=sender==='You'?'YOU':'SENTINEL ASSISTANT';
  const time=document.createElement('time');time.textContent=new Date().toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'});meta.append(' ',time);
  bubble.className='chat-bubble';bubble.textContent=message;content.append(meta,bubble);wrap.append(avatar,content);log.appendChild(wrap);
  if(window.lucide)lucide.createIcons({nodes:[avatar]});log.scrollTop=log.scrollHeight;
}
async function askCopilot(prompt){
  const typing=document.createElement('div');typing.className='typing';typing.textContent='Copilot is reviewing incident records...';$('chatLog').appendChild(typing);$('chatLog').scrollTop=$('chatLog').scrollHeight;setLoading($('sendChat'),true);
  try{
    const summary=await fetchJson('/api/copilot');let reply;
    if(prompt.includes('critical'))reply=`There are ${summary.active_critical} active critical alerts in ${summary.total_logs} total incident records.`;
    else if(prompt.includes('dangerous')||prompt.includes('riskiest'))reply=`The most frequently occurring active source IP is ${summary.most_dangerous_ip}.`;
    else if(prompt.includes('suggest')||prompt.includes('next step'))reply=summary.suggestion+' Review the incident context and validate any response action before taking it.';
    else reply=`I can summarize this demo dataset: ${summary.total_logs} total records, ${summary.active_critical} active critical alerts. Try asking about critical alerts, the riskiest IP, or suggested next steps.`;
    typing.remove();addChatMessage('Copilot',reply);
  }catch(error){typing.remove();addChatMessage('Copilot',`I couldn't retrieve the incident summary. ${error.message}`);toast('Copilot request failed.','error');}
  finally{setLoading($('sendChat'),false);}
}
function sendCopilot(text){
  const prompt=text.trim();if(!prompt)return;addChatMessage('You',prompt);askCopilot(prompt.toLowerCase());
}
function setPage(page){
  const supported=['Overview','Threat Intelligence','Security Analytics','Attack Simulator','SOC Copilot','Incident Reports','Settings'];
  document.querySelectorAll('.nav-item[data-page]').forEach(b=>b.classList.toggle('active',b.dataset.page===page));
  $('page-title').textContent=page;$('welcome-title').textContent=page==='Overview'?'Security overview':page;
  const isOverview=page==='Overview';document.querySelectorAll('.kpi-grid,.analytics-grid,.lower-grid').forEach(el=>el.hidden=!isOverview);
  $('placeholderPanel').hidden=isOverview;
  if(!isOverview){$('placeholderTitle').textContent=page;$('placeholderPanel').scrollIntoView({behavior:'smooth',block:'center'});}
  $('sidebar').classList.remove('open');
}
function initTheme(){
  let theme='dark';try{theme=localStorage.getItem('sentinelpulse-theme')||'dark';}catch(e){}
  document.documentElement.dataset.theme=theme;
  const icon=document.createElement('i');icon.setAttribute('data-lucide',theme==='dark'?'sun':'moon');$('themeToggle').replaceChildren(icon);
  if(window.lucide)lucide.createIcons();
}
function toggleTheme(){
  const next=document.documentElement.dataset.theme==='dark'?'light':'dark';document.documentElement.dataset.theme=next;
  try{localStorage.setItem('sentinelpulse-theme',next);}catch(e){}
  $('themeToggle').replaceChildren();const icon=document.createElement('i');icon.setAttribute('data-lucide',next==='dark'?'sun':'moon');$('themeToggle').appendChild(icon);
  if(window.lucide)lucide.createIcons();updateCharts();
}
document.addEventListener('DOMContentLoaded',()=>{
  initTheme();initCharts();refreshAll();
  $('severityFilter').addEventListener('change',renderThreatTable);$('searchBox').addEventListener('input',renderThreatTable);
  $('globalSearch').addEventListener('input',e=>{$('searchBox').value=e.target.value;setPage('Overview');renderThreatTable();});
  $('refreshBtn').addEventListener('click',()=>refreshAll(true));
  $('exportBtn').addEventListener('click',()=>{toast('Preparing incident report CSV...','info');window.location.assign('/api/export');});
  document.querySelectorAll('.sim-btn').forEach(btn=>btn.addEventListener('click',()=>simulateAttack(btn)));
  $('confirmMitigate').addEventListener('click',confirmMitigation);$('cancelMitigate').addEventListener('click',closeMitigation);
  $('confirmModal').addEventListener('click',e=>{if(e.target===$('confirmModal'))closeMitigation();});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'){closeMitigation();$('sidebar').classList.remove('open');}});
  document.querySelectorAll('.quick-btn').forEach(btn=>btn.addEventListener('click',()=>{
    const prompts={critical:'Summarize critical alerts',dangerous_ip:'Which IP is the most dangerous?',suggestion:'Suggest mitigation steps'};sendCopilot(prompts[btn.dataset.q]||btn.textContent);
  }));
  $('chatForm').addEventListener('submit',e=>{e.preventDefault();const input=$('chatInput');sendCopilot(input.value);input.value='';});
  $('themeToggle').addEventListener('click',toggleTheme);$('menuToggle').addEventListener('click',()=>$('sidebar').classList.toggle('open'));
  document.querySelectorAll('.nav-item[data-page]').forEach(btn=>btn.addEventListener('click',()=>setPage(btn.dataset.page)));
  $('backOverview').addEventListener('click',()=>setPage('Overview'));
  $('notificationBtn').addEventListener('click',()=>toast('Notifications are not connected in this demo build.','info'));
  window.addEventListener('resize',()=>{if(lineChart)lineChart.resize();if(doughnutChart)doughnutChart.resize();});
});
