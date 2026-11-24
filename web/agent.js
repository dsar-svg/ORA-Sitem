// Panel "Pregúntale a ORA": sends the question with the visible period and shows the answer with its supporting documents.
const $ = id => document.getElementById(id);
const esc = v => String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const history = [];
const suggestions = ['¿Cuánto vendí este mes frente al anterior?','¿Quiénes me deben más vencido?','¿Qué vendedor facturó más este mes?','¿Qué productos se vendieron más?'];
let busy = false;

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
  add('user','<p>'+esc(question)+'</p>');
  const pending = add('assistant pending','<p>Revisando tus datos…</p>');
  try {
    const res = await fetch('/api/agent',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({question,month:$('period').value,history}),signal:AbortSignal.timeout(180000)});
    const data = await res.json().catch(()=>({error:'Respuesta inesperada del servidor.'}));
    if (!res.ok) throw new Error(data.error || 'No se pudo responder.');
    pending.classList.remove('pending');
    pending.innerHTML = format(data.answer) + evidence(data.documents);
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
  $('agentInput').addEventListener('keydown',e=>{ if (e.key==='Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
}
