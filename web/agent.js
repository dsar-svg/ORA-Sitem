import { downloadReport } from './exports.js';
import { face } from './ora.js';
// Sección "Ora": the analyst's own page. Sends the question with the visible period and shows answers with their evidence.
const $ = id => document.getElementById(id);
const esc = v => String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const STORE = 'ora.chat.v1';  // sessionStorage: the conversation survives navigation but not closing the browser
// Suggestions follow the seat's role (set by the server on <body>), so each person starts with their own day-to-day questions.
const TOPICS = {
  direccion: [
    {title:'Ventas', icon:'chart', ask:'¿Cuánto vendí este mes frente al anterior y qué vendedor facturó más?'},
    {title:'Cobranza', icon:'wallet', ask:'¿Quiénes me deben más vencido y desde cuándo?'},
    {title:'Inventario', icon:'box', ask:'¿Qué productos tienen pocas existencias?'},
    {title:'Compras', icon:'invoice', ask:'¿Cuánto le debo a proveedores y a quién más?'}],
  ventas: [
    {title:'Equipo', icon:'users', ask:'¿Cómo va cada vendedor este mes frente al anterior?'},
    {title:'Clientes', icon:'chart', ask:'¿Qué clientes compraron menos que el mes pasado?'},
    {title:'Margen', icon:'invoice', ask:'¿Qué productos dejan menos margen este mes?'},
    {title:'Cobranza', icon:'wallet', ask:'¿Qué vendedor tiene más cartera vencida?'}],
  vendedor: [
    {title:'Mis ventas', icon:'chart', ask:'¿Cuánto llevo vendido este mes y cómo voy frente al mes pasado?'},
    {title:'Por cobrar', icon:'wallet', ask:'¿Qué clientes míos tienen facturas vencidas?'},
    {title:'Clientes', icon:'users', ask:'¿Qué clientes míos no me han comprado este mes?'},
    {title:'Existencias', icon:'box', ask:'¿Qué productos tienen pocas existencias para vender?'}],
  cobranza: [
    {title:'Vencido', icon:'wallet', ask:'¿Quiénes deben más vencido y desde cuándo?'},
    {title:'Esta semana', icon:'calendar', ask:'¿Qué facturas vencen en los próximos 7 días?'},
    {title:'Estado de cuenta', icon:'invoice', ask:'Prepara en PDF el estado de cuenta del cliente que más debe.'},
    {title:'Recordatorio', icon:'users', ask:'Redacta un recordatorio de pago cordial para el cliente con más días vencido.'}],
  compras: [
    {title:'Reponer', icon:'box', ask:'¿Qué tengo que reponer esta semana?'},
    {title:'Proveedores', icon:'invoice', ask:'¿Cuánto le debo a proveedores y qué vence primero?'},
    {title:'Pedidos', icon:'chart', ask:'¿Qué órdenes de compra siguen sin recibir?'},
    {title:'Sin movimiento', icon:'calendar', ask:'¿Qué productos tienen existencias pero no se vendieron este mes?'}],
};
const topics = TOPICS[document.body.dataset.role] || TOPICS.direccion;
const demoRole = new URLSearchParams(location.search).get('rol');
const MAX_FILES = 3, MAX_BYTES = 5_000_000;
let busy = false, attached = [], chat = [];
try { chat = JSON.parse(sessionStorage.getItem(STORE)) || []; } catch {}
const save = () => { try { sessionStorage.setItem(STORE, JSON.stringify(chat.slice(-40))); } catch {} };
const recent = () => chat.filter(m => !m.failed).slice(-12).map(m => ({role:m.role, content:m.text}));

const base64 = buffer => { let s = ''; const bytes = new Uint8Array(buffer); for (let i = 0; i < bytes.length; i += 32768) s += String.fromCharCode(...bytes.subarray(i, i + 32768)); return btoa(s); };
function loadScript(src){ return window.ExcelJS ? Promise.resolve() : new Promise((ok,fail)=>{ const t = document.createElement('script'); t.src = src; t.onload = ok; t.onerror = fail; document.head.append(t); }); }
// Excel files travel as CSV text, one block per sheet, so the model reads them without extra server libraries.
async function xlsxToCsv(buffer){
  await loadScript('/vendor/exceljs.min.js');
  const book = new window.ExcelJS.Workbook(); await book.xlsx.load(buffer);
  const cell = v => { const t = v?.result ?? v?.text ?? v ?? ''; const s = t instanceof Date ? t.toISOString().slice(0,10) : String(t); return /[",\n]/.test(s) ? '"'+s.replace(/"/g,'""')+'"' : s; };
  return book.worksheets.map(ws => { const rows = []; ws.eachRow({includeEmpty:false}, r => rows.push(r.values.slice(1).map(cell).join(','))); return '# Hoja: '+ws.name+'\n'+rows.join('\n'); }).join('\n\n');
}
async function readFile(file){
  const buffer = await file.arrayBuffer();
  if (/\.xlsx$/i.test(file.name)) return {name:file.name, type:'text/csv', data:base64(new TextEncoder().encode(await xlsxToCsv(buffer)))};
  const type = file.type || (/\.csv$/i.test(file.name) ? 'text/csv' : 'text/plain');
  return {name:file.name, type, data:base64(buffer)};
}
function showAttached(){
  $('agentAttached').innerHTML = attached.map((f,i)=>'<span class="agent-chip">'+esc(f.name)+'<button type="button" data-remove="'+i+'" aria-label="Quitar '+esc(f.name)+'"></button></span>').join('');
}

// Plain text in, a small safe subset of formatting out: paragraphs, bullets and **bold**.
function format(text){
  const inline = line => esc(line).replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>');
  const blocks = [];
  let list = null;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    const item = line.match(/^[-•*]\s+(.*)/);
    if (item) { (list ??= []).push('<li>'+inline(item[1])+'</li>'); continue; }
    if (list) { blocks.push('<ul>'+list.join('')+'</ul>'); list = null; }
    if (line) blocks.push('<p>'+inline(line.replace(/^#+\s*/,''))+'</p>');
  }
  if (list) blocks.push('<ul>'+list.join('')+'</ul>');
  return blocks.join('');
}
function evidence(documents){
  if (!documents?.length) return '';
  const rows = documents.map(d=>'<tr><td>'+esc(d.numero)+'</td><td>'+esc(d.cliente)+'</td><td>'+esc(d.emision)+'</td><td class="num">'+esc(d.importe)+'</td></tr>').join('');
  return '<details class="agent-docs"><summary>'+documents.length+(documents.length===1?' documento de respaldo':' documentos de respaldo')+'</summary><div class="table-wrap"><table><thead><tr><th>Documento</th><th>Cliente</th><th>Emisión</th><th class="num">Importe</th></tr></thead><tbody>'+rows+'</tbody></table></div></details>';
}
function downloads(files){
  if (!files?.length) return '';
  return '<div class="agent-files">'+files.map((f,i)=>'<button type="button" data-file="'+i+'">Descargar '+(f.format==='pdf'?'PDF':'Excel')+': '+esc(f.report.title)+'</button>').join('')+'</div>';
}

function bubble(m){
  const row = document.createElement('div');
  row.className = 'ora-row '+m.role+(m.failed?' failed':'')+(m.pending?' pending':'');
  const body = m.role === 'user'
    ? '<p>'+esc(m.text)+'</p>'+(m.files?.length?'<p class="hint">Adjuntos: '+m.files.map(esc).join(', ')+'</p>':'')
    : m.pending ? '<p>Revisando tus datos<span class="ora-dots"><i></i><i></i><i></i></span></p>'
    : m.failed ? '<p>'+esc(m.text)+'</p>' : format(m.text) + downloads(m.downloads) + evidence(m.documents);
  row.innerHTML = (m.role === 'assistant' ? '<span class="ora-avatar">'+face(36, m.pending?'thinking':'')+'</span>' : '') + '<div class="agent-msg">'+body+'</div>';
  row.querySelectorAll('[data-file]').forEach(b=>b.addEventListener('click',()=>{ const f = m.downloads[b.dataset.file]; downloadReport(f.report, f.format); }));
  return row;
}
function render(){
  const log = $('agentLog');
  log.replaceChildren();
  if (!chat.length) {
    log.innerHTML = '<div class="ora-empty">'+face(112,'waving')+'<h2>Hola, soy Ora</h2><p>Pregúntame en tus palabras. Leo tu ERP en vivo para el período que estás viendo, te respondo con cifras exactas y te muestro las facturas que las forman. También preparo Excel y PDF, y leo los archivos que me adjuntes.</p>'+
      '<div class="ora-topics">'+topics.map((t,i)=>'<button type="button" data-topic="'+i+'"><b><i data-icon="'+t.icon+'"></i>'+t.title+'</b><span>'+esc(t.ask)+'</span></button>').join('')+'</div></div>';
    log.querySelectorAll('[data-topic]').forEach(b=>b.addEventListener('click',()=>{ $('agentInput').value = topics[b.dataset.topic].ask; send(); }));
    document.dispatchEvent(new CustomEvent('ora:icons', {detail:log}));
    return;
  }
  for (const m of chat) log.append(bubble(m));
  log.lastElementChild?.scrollIntoView({block:'end'});
}

async function send(){
  const question = $('agentInput').value.trim();
  if (!question || busy) return;
  busy = true; $('agentSend').disabled = true; $('agentInput').value = '';
  const files = attached; attached = []; showAttached();
  const prior = recent();
  chat.push({role:'user', text:question, files:files.map(f=>f.name)});
  const answer = {role:'assistant', pending:true};
  chat.push(answer); render();
  try {
    const res = await fetch('/api/agent',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({question,month:$('period').value,history:prior,files,...(demoRole?{role:demoRole}:{})}),signal:AbortSignal.timeout(180000)});
    const data = await res.json().catch(()=>({error:'Respuesta inesperada del servidor.'}));
    if (!res.ok) throw new Error(data.error || 'No se pudo responder.');
    Object.assign(answer, {pending:false, text:data.answer, documents:data.documents, downloads:data.files});
  } catch (e) {
    Object.assign(answer, {pending:false, failed:true, text:e.name==='TimeoutError'?'La consulta tardó demasiado. Intenta con una pregunta más concreta.':e.message});
  } finally {
    busy = false; $('agentSend').disabled = false; save(); render(); $('agentInput').focus();
  }
}

function showPeriod(){ const t = $('period').selectedOptions[0]?.text; $('oraPeriod').textContent = t ? 'Período: '+t : ''; }
$('period')?.addEventListener('change', showPeriod);
new MutationObserver(showPeriod).observe($('period'), {childList:true});

function open(show){
  document.body.dataset.section = show ? 'ora' : '';
  $('oraView').hidden = !show;
  if (!show) return;
  document.querySelectorAll('#sidebar nav button').forEach(b=>b.classList.toggle('active', b.dataset.section==='ora'));
  showPeriod();
  window.history.replaceState(null, '', '#ora');
  render(); $('agentInput').focus();
}

const entry = document.querySelector('[data-section="ora"]');
if (entry && !entry.hidden) {
  entry.addEventListener('click',()=>open(true));
  document.querySelectorAll('[data-module]').forEach(b=>b.addEventListener('click',()=>{ if (document.body.dataset.section==='ora') { open(false); window.history.replaceState(null,'',location.pathname+location.search); } }));
  document.addEventListener('click',e=>{ if (e.target.closest('[data-ask-ora]')) open(true); });
  $('oraReset').addEventListener('click',()=>{ chat = []; save(); render(); $('agentInput').focus(); });
  $('agentForm').addEventListener('submit',e=>{ e.preventDefault(); send(); });
  $('agentFiles').addEventListener('change',async e=>{
    for (const file of e.target.files) {
      if (attached.length >= MAX_FILES) break;
      if (file.size > MAX_BYTES) { alertFile(file.name+' supera 5 MB.'); continue; }
      try { attached.push(await readFile(file)); } catch { alertFile('No se pudo leer '+file.name+'.'); }
    }
    e.target.value = ''; showAttached();
  });
  $('agentAttached').addEventListener('click',e=>{ const b = e.target.closest('[data-remove]'); if (b) { attached.splice(+b.dataset.remove,1); showAttached(); } });
  $('agentInput').addEventListener('keydown',e=>{ if (e.key==='Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
  $('agentInput').addEventListener('input',e=>{ e.target.style.height = 'auto'; e.target.style.height = Math.min(160, e.target.scrollHeight)+'px'; });
  if (location.hash === '#ora') open(true);
} else {
  document.documentElement.classList.add('no-ora');
}
function alertFile(text){ chat.push({role:'assistant', failed:true, text}); render(); }
