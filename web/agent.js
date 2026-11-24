import { downloadReport } from './exports.js';
// Panel "Pregúntale a ORA": sends the question with the visible period and shows the answer with its supporting documents.
const $ = id => document.getElementById(id);
const esc = v => String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const history = [];
const suggestions = ['¿Cuánto vendí este mes frente al anterior?','¿Quiénes me deben más vencido?','¿Qué vendedor facturó más este mes?','¿Qué productos se vendieron más?'];
let busy = false, attached = [];
const MAX_FILES = 3, MAX_BYTES = 5_000_000;

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

function add(role, html){
  const item = document.createElement('div');
  item.className = 'agent-msg '+role;
  item.innerHTML = html;
  $('agentLog').append(item);
  item.scrollIntoView({block:'end'});
  return item;
}

function welcome(){
  if ($('agentLog').children.length) return;
  const box = add('assistant','<p>Pregunta en tus palabras. Respondo con las cifras de tu ERP para el período que estás viendo y te muestro las facturas que las forman.</p><div class="agent-suggestions"></div>');
  for (const text of suggestions) {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = text;
    b.addEventListener('click',()=>{ $('agentInput').value = text; send(); });
    box.querySelector('.agent-suggestions').append(b);
  }
}

async function send(){
  const question = $('agentInput').value.trim();
  if (!question || busy) return;
  busy = true; $('agentSend').disabled = true; $('agentInput').value = '';
  const files = attached; attached = []; showAttached();
  add('user','<p>'+esc(question)+'</p>'+(files.length?'<p class="hint">Adjuntos: '+files.map(f=>esc(f.name)).join(', ')+'</p>':''));
  const pending = add('assistant pending','<p>Revisando tus datos…</p>');
  try {
    const res = await fetch('/api/agent',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({question,month:$('period').value,history,files}),signal:AbortSignal.timeout(180000)});
    const data = await res.json().catch(()=>({error:'Respuesta inesperada del servidor.'}));
    if (!res.ok) throw new Error(data.error || 'No se pudo responder.');
    pending.classList.remove('pending');
    pending.innerHTML = format(data.answer) + downloads(data.files) + evidence(data.documents);
    pending.querySelectorAll('[data-file]').forEach(b=>b.addEventListener('click',()=>{ const f = data.files[b.dataset.file]; downloadReport(f.report, f.format); }));
    history.push({role:'user',content:question},{role:'assistant',content:data.answer});
  } catch (e) {
    pending.classList.remove('pending'); pending.classList.add('failed');
    pending.innerHTML = '<p>'+esc(e.name==='TimeoutError'?'La consulta tardó demasiado. Intenta con una pregunta más concreta.':e.message)+'</p>';
  } finally {
    busy = false; $('agentSend').disabled = false; $('agentInput').focus();
  }
}

if ($('agentOpen') && !$('agentOpen').hidden) {
  $('agentOpen').addEventListener('click',()=>{ $('agent').showModal(); welcome(); $('agentInput').focus(); });
  $('agentClose').addEventListener('click',()=>$('agent').close());
  $('agentForm').addEventListener('submit',e=>{ e.preventDefault(); send(); });
  $('agentFiles').addEventListener('change',async e=>{
    for (const file of e.target.files) {
      if (attached.length >= MAX_FILES) break;
      if (file.size > MAX_BYTES) { add('assistant failed','<p>'+esc(file.name)+' supera 5 MB.</p>'); continue; }
      try { attached.push(await readFile(file)); } catch { add('assistant failed','<p>No se pudo leer '+esc(file.name)+'.</p>'); }
    }
    e.target.value = ''; showAttached();
  });
  $('agentAttached').addEventListener('click',e=>{ const b = e.target.closest('[data-remove]'); if (b) { attached.splice(+b.dataset.remove,1); showAttached(); } });
  $('agentInput').addEventListener('keydown',e=>{ if (e.key==='Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
}
