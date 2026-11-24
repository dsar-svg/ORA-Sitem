import {initTour} from './tour.js';
import {monthRanges,statement,statementTables,gross,docType} from './reports.js';
import {exportMenu,downloadReport} from './exports.js';
import {resetMap,enableMapPan} from './map.js';
import {enhanceFilters,setupNavigation} from './filters.js';
import {customers} from './customers.js';
import {renderInventory} from './inventory.js';
import {initAppearance} from './theme.js';
import {prepare,sales,balances,sum,groups,overdue} from './metrics.js';

const $ = id => document.getElementById(id);
const esc = v => String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icons = {
  user:'M16 8a4 4 0 1 1-8 0 4 4 0 1 1 8 0 M4 21v-2a8 8 0 0 1 16 0v2',
  users:'M13 8a3.5 3.5 0 1 1-7 0 3.5 3.5 0 1 1 7 0 M3 20v-1a6.5 6.5 0 0 1 13 0v1 M16 4.6a3.5 3.5 0 0 1 0 6.8 M18.5 14.2A6.5 6.5 0 0 1 22 20v0',
  box:'M3 7l9-5 9 5-9 5z M3 7v10l9 5 9-5V7 M12 12v10',
  chart:'M3 4v16h18 M7 15l4-5 4 2 6-7',wallet:'M3 7h17v13H3z M3 7V5l14-3v5 M15 12h6v4h-6z',
  building:'M4 21V4h11v17 M15 10h5v11 M2 21h20 M7 8h1m3 0h1m-5 4h1m3 0h1m-5 4h1',
  calendar:'M3 5h18v16H3z M7 3v5m10-5v5M3 10h18',pin:'M12 21s7-7 7-12a7 7 0 1 0-14 0c0 5 7 12 7 12z M11 9a1 1 0 1 0 2 0 1 1 0 1 0-2 0',
  invoice:'M5 3h14v18l-3-2-4 2-4-2-3 2z M8 8h8m-8 4h6',credit:'M4 6h16v13H4z M4 10h16m-8 5h5',
  clock:'M21 12a9 9 0 1 1-18 0 9 9 0 1 1 18 0 M12 6v6l4 3'
};
const icon = k => '<svg class="icon" aria-hidden="true" viewBox="0 0 24 24"><path d="'+icons[k]+'"/></svg>';
document.querySelectorAll('[data-icon]').forEach(e=>e.innerHTML=icon(e.dataset.icon));
const decimal = new Intl.NumberFormat('es-VE',{minimumFractionDigits:2,maximumFractionDigits:2});
const money = cents => $('currency').value+'\u00a0'+(cents<0?'−':'')+decimal.format(Math.abs(cents)/100);
// Compact axis labels (1,5 M · 771 mil) fit the 45-unit gutter at any scale.
const axis = new Intl.NumberFormat('es',{notation:'compact',maximumSignificantDigits:2});
const pct = n => new Intl.NumberFormat('es-VE',{maximumFractionDigits:1}).format(n)+' %';
const monthDate = month => new Date(month+'-15T12:00:00Z');
const monthName = month => new Intl.DateTimeFormat('es-VE',{month:'long',year:'numeric',timeZone:'UTC'}).format(monthDate(month));
const cap = s => s.charAt(0).toUpperCase()+s.slice(1);
const day = s => s.split('-').reverse().join('/');
// Data reads in ink and sand; the action colour is reserved for what can be pressed.
const colors = ['var(--data)','var(--muted)','var(--data-prev)'];
let data, opener, docs, moduleName='sales', actions=[];
let ledgerDocs;
const requested = new URLSearchParams(location.search);
const requestedView = requested.get('view') || 'sales';
const viewTitles={sales:'Resumen de ventas',ar:'Cuentas por cobrar',clients:'Clientes',inventory:'Inventario'};
const loaderHTML='<div class="loader" role="status"><span></span>Cargando reporte…</div>';
function markLoading(view){
  document.querySelectorAll('[data-module]').forEach(b=>{const active=b.dataset.module===view;b.classList.toggle('active',active);b.setAttribute('aria-pressed',active)});
  $('title').textContent=viewTitles[view]??viewTitles.sales;$('subtitle').textContent='';
  $('dashboard').innerHTML=loaderHTML;$('reportBar').hidden=true;
  $('sync').classList.add('loading');$('sync').textContent='Cargando datos…';
  document.body.classList.add('loading');
}
function openLiveView(view,month){
  markLoading(view);
  const target = new URL(location.href);
  target.searchParams.set('view',view);
  if(month)target.searchParams.set('month',month);
  location.assign(target);
}
let salesTab='summary', arTab='summary', inventoryTab='summary', renderRestock, viewReport, detailReport;
const businessToday=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Caracas',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const rangeText=(a,b)=>day(a)+' – '+day(b);
const selected=id=>$(id).selectedOptions[0]?.text??'';
function context(title,range,filters){
  return {title,range,currency:$('currency').value,company:data.company[0].name,
    origin:data.company[0].source==='demo-v1'?'Datos sintéticos de demostración':'ERP',
    filters:(filters||[data.branch||selected('branch'),...['seller','product','zone'].filter(id=>!$(id).parentElement.hidden).map(selected)].join(' · '))+(data.excludedGroup?.length?' · Sin empresas del grupo':'')};
}
function documentReport(title,rows,range,filters){
  return {...context(title,range,filters),summary:[['Importe en el reporte',sum(rows)]],
    tables:[{name:'Detalle',headers:['Número','Cliente','Emisión','Tipo','Sucursal','Total con impuestos','Importe en el reporte'],amounts:[5,6],
      rows:rows.map(d=>[d.number,d.client,d.issued,docType(d),d.branch,d.fullGross,d.value])}]};
}
function reportTabs(salesMode,statementMode){
  const inv=moduleName==='inventory'&&data.modules.includes('inventory');
  $('reportBar').hidden=!salesMode && moduleName!=='ar'&&!inv;
  $('restockControls').hidden=!inv||inventoryTab!=='restock';
  const pair=inv?[['summary','Existencias'],['restock','Reposición']]:salesMode?[['summary','Resumen'],['docs','Documentos']]:[['summary','Resumen'],['statement','Estados de cuenta']];
  const active=inv?inventoryTab:salesMode?salesTab:arTab;
  $('reportBar').firstElementChild.innerHTML=pair.map(([id,name])=>'<button data-view="'+id+'" aria-pressed="'+(id===active)+'">'+name+'</button>').join('');
  $('viewExport').innerHTML=salesMode||moduleName==='ar'||(inv&&inventoryTab==='restock')?exportMenu('view'):'';
  $('docFilters').hidden=!salesMode||active!=='docs';
}
function reportTable(headers,rows){
  return '<div class="table-wrap"><table><thead><tr>'+headers.map(h=>'<th>'+esc(h)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(r=>'<tr>'+r.map(v=>'<td>'+v+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
}
function linkRows(label,rows,ar=false,range){
  return '<button class="link" data-a="'+action(()=>openRows(label,rows,ar,'',range))+'">'+esc(label)+'</button>';
}
function action(fn) {actions.push(fn);return actions.length-1}
function showDetail(title,kind,body){
  $('dt').textContent=title;
  $('detailKind').textContent=kind;
  $('detailBody').classList.toggle('invoices',kind==='DOCUMENTOS DE RESPALDO');
  $('detailBody').innerHTML=body;
  $('detail').showModal();
  $('detailBody').scrollTop=0;
}
function openRows(title,rows,receivables=moduleName==='ar',extra='',range,asOf=lastDay()) {
  $('dt').textContent=title;
  const sorted=[...rows].sort((a,b)=>b.issued.localeCompare(a.issued));
  detailReport=documentReport(title,sorted,range||(receivables?'Corte '+day(lastDay()):rangeText($('period').value+'-01',monthRanges($('period').value,businessToday()).end)));
  if(moduleName==='sales' && salesTab==='docs' && viewReport)detailReport.filters=viewReport.filters;
  if(moduleName==='ar' && arTab==='statement' && viewReport)detailReport.note=viewReport.note;
  const body=exportMenu('detail')+'<div class="detailsum">'+rows.length+' documentos · <b>'+money(sum(rows))+'</b></div>'+extra+'<div class="table-wrap"><table><thead><tr><th>Documento y cliente</th><th>Emisión</th><th>Vencimiento</th><th>Importe en el reporte</th></tr></thead><tbody>'+
    sorted.map(r=>'<tr><td><details><summary>'+esc(r.number)+'</summary><div class="hint">Origen '+esc(r.id)+' · '+docType(r)+' · '+esc(r.currency)+' · Total del documento con impuestos: '+money(r.fullGross)+' · Importe en el reporte: '+money(r.value)+' · Contabilizado · '+esc(r.branch)+'</div>'+
      r.lines.map(l=>'<div>'+esc(l.name)+' · '+l.quantity+' uds. · neto '+money(r.sign*l.net)+' · impuesto '+money(r.sign*l.tax)+'</div>').join('')+
      (receivables?r.payments.filter(p=>p.posted<=asOf).map(p=>'<div>Aplicación '+esc(p.id)+' · '+day(p.posted)+' · '+money(p.amount)+'</div>').join(''):'')+
      '</details>'+esc(r.client)+'<div class="compact-dates">Emisión '+day(r.issued)+'<br>Vence '+day(r.due)+'</div></td><td>'+day(r.issued)+'</td><td>'+day(r.due)+'</td><td>'+money(r.value)+'</td></tr>').join('')+'</tbody></table></div>'+
      (rows.length?'':'<p class="empty">Sin documentos para estos filtros.</p>');
  showDetail(title,'DOCUMENTOS DE RESPALDO',body);
}
function drill(name,rows,range){return action(()=>openRows(name,rows,moduleName==='ar','',range))}
function kpi(title,value,sub,symbol,rows,primary=false,extra=''){
  return '<button class="kpi '+(primary?'primary':'')+'" data-a="'+drill(title,rows)+'"><span class="kpi-name"><i class="icon-box">'+icon(symbol)+'</i>'+title+'</span>'+(primary?'':'<span class="arrow"></span>')+'<strong>'+value+'</strong><span class="sub">'+esc(sub)+'</span>'+extra+(primary?'<span class="cta">Ver documentos</span>':'')+'</button>';
}
// Where the figure comes from and its cut-off date: the trust anchor under every headline figure.
function provenance(cents){
  const r=data.bolivar,bs=r&&$('currency').value===r.currency?'<span class="bs">≈ Bs '+decimal.format(cents/100*parseFloat(r.rate))+' · tasa Odoo '+decimal.format(parseFloat(r.rate))+' Bs/'+esc(r.currency)+' del '+day(r.date)+'</span>':'';
  return bs+'<span class="source">'+(data.reportMonth?'Fuente: Odoo':'Datos de demostración')+' · corte '+day(lastDay())+'</span>';
}
function panel(title,sub,body){return '<article class="panel"><h2>'+title+'</h2><p class="hint">'+esc(sub)+'</p>'+body+'</article>'}
function dot(color){return '<i class="dot" style="background:'+color+'"></i>'}
function lastDay(){if(data.cutoff)return data.cutoff;const d=monthDate($('period').value);d.setUTCMonth(d.getUTCMonth()+1,0);return d.toISOString().slice(0,10)}
const bounds=[5,10,15,20,25,31];
const slices=rows=>bounds.map((end,i)=>rows.filter(r=>+r.issued.slice(-2)<=end && +r.issued.slice(-2)>(bounds[i-1]||0)));
const sliceLabels=bounds.map((v,i)=>(1+(bounds[i-1]||0))+'–'+(i===5?'fin':v));
const top=(entries,n=15)=>[...entries].sort((a,b)=>Math.abs(b.value)-Math.abs(a.value)).slice(0,n);
const barChart=(title,entries)=>({title,labels:entries.map(e=>e.name),series:[{name:title,values:entries.map(e=>e.value)}]});
function chart(current,prior,period,prev){
  const series=[slices(current),slices(prior)];
  const vals=series.flatMap(s=>s.map(sum));
  const top=Math.ceil(Math.max(1,...vals)/10000)*10000, low=Math.min(0,...vals);
  const y=v=>131-(v-low)/(top-low)*109;
  const grid=[0,0.5,1].map(f=>{
    const v=low+(top-low)*f;
    return '<path d="M45 '+y(v)+'H479" stroke="var(--line)" stroke-dasharray="3 4"/><text x="40" y="'+(y(v)+4)+'" text-anchor="end">'+axis.format(v/100)+'</text>';
  }).join('');
  const bars=series.map((s,j)=>s.map((rows,i)=>{
    const x=58+i*71+j*22, val=sum(rows),title=(j?monthName(prev):monthName(period))+' · días '+(1+(bounds[i-1]||0))+'–'+bounds[i];
    const compare='Días '+(1+(bounds[i-1]||0))+'–'+(i===5?'fin':bounds[i])+' · Actual '+money(vals[i])+' · Anterior '+money(vals[i+6])+' · Diferencia '+money(vals[i]-vals[i+6]);
    return '<g data-compare="'+esc(compare)+'" role="button" tabindex="0" aria-label="'+esc(compare+' · Abrir '+title)+'" data-a="'+drill(title,rows,monthName(j?prev:period)+' · '+title)+'"><title>'+title+' · '+money(val)+'</title><rect x="'+x+'" y="'+Math.min(y(0),y(val))+'" class="'+(j?'previous':'current')+'" width="18" height="'+Math.max(1,Math.abs(y(val)-y(0)))+'" rx="3" fill="'+(j?colors[2]:colors[0])+'"/></g>';
  }).join('')).join('');
  return '<div class="legend"><span>'+dot(colors[0])+cap(monthName(period))+'</span><span>'+dot(colors[2])+cap(monthName(prev))+'</span></div><svg class="chart" viewBox="0 0 490 160" aria-label="Ventas netas por tramo del mes">'+grid+bars+bounds.map((v,i)=>'<text x="'+(78+i*71)+'" y="153" text-anchor="middle">'+(1+(bounds[i-1]||0))+'–'+(i===5?'fin':v)+'</text>').join('')+'</svg><div class="comparison" id="comparison" aria-live="polite">Enfoca un tramo para comparar ambos períodos.</div>';
}
function sellerRanking(rows){
  const ranking=groups(rows,'seller'),total=sum(rows);
  const max=Math.max(1,...ranking.map(g=>Math.abs(g.value)));
  return ranking.map(g=>{
    const name=data.seller.find(s=>s.id===g.name)?.name??'Sin asignar';
    const count=g.docs.filter(r=>r.kind==='invoice').length;
    const detail=action(()=>{
      const lines=g.docs.flatMap(r=>r.lines.map(l=>({...l,value:r.sign*l.net})));
      function list(label,items){
        return '<details class="seller-summary"><summary>'+label+'</summary><dl>'+items.map(([label,value])=>'<div><dt>'+esc(label)+'</dt><dd>'+money(value)+'</dd></div>').join('')+'</dl></details>';
      }
      const breakdown=list('Por cliente',groups(g.docs,'customer').map(x=>[x.docs[0].client,x.value]))+
        list('Por producto',groups(lines,'product').map(x=>[x.docs[0].name,x.value]));
      openRows(name,g.docs,false,breakdown);
    });
    return horizontal(name,money(g.value)+' · '+(total?pct(g.value/total*100):'—')+' · '+count+' fact.',g.value,max,detail);
  }).join('')||'<p class="empty">Sin movimientos.</p>';
}
function distribution(rows){
  const g=groups(rows,'branch'),total=sum(rows);
  const max=Math.max(1,...g.map(k=>Math.abs(k.value)));
  return g.map(k=>horizontal(k.name,money(k.value)+' · '+(total?pct(k.value/total*100):'—'),k.value,max,drill(k.name,k.docs))).join('') || '<p class="empty">Sin movimientos.</p>';
}
function horizontal(name,value,n,max,id,highlight=false){
  return '<button class="hrow '+(highlight?'priority':'')+'" data-a="'+id+'"><div><strong title="'+esc(name)+'">'+esc(name)+'</strong><b>'+esc(value)+'</b></div><span class="track"><i style="width:'+Math.abs(n)/max*100+'%"></i></span></button>';
}
function breakdown(title,label,entries,total){
  const ar=moduleName==='ar';
  return panel(title,'Selecciona una fila para consultar sus documentos.','<div class="table-wrap"><table class="breakdown"><thead><tr><th>'+label+'</th><th class="num">Documentos</th><th class="num">Participación</th><th class="num">Importe</th>'+(ar?'<th class="num">Vencido</th>':'')+'<th>Detalle</th></tr></thead><tbody>'+entries.map(g=>{
    const share=total?g.value/total*100:0;
    const open=drill(g.name,g.docs);
    return '<tr data-a="'+open+'"><td><button class="link name-link" data-a="'+open+'">'+esc(g.name)+'</button></td><td class="num">'+new Set(g.docs.map(d=>d.id)).size+'</td><td class="num"><span class="bar"><i style="width:'+Math.max(0,Math.min(100,share))+'%"></i></span>'+pct(share)+'</td><td class="num">'+money(g.value)+'</td>'+(ar?'<td class="num">'+money(sum(g.docs.filter(overdue)))+'</td>':'')+'<td><button class="link" data-a="'+drill(g.name,g.docs)+'">Ver documentos</button></td></tr>';
  }).join('')+'</tbody></table></div>'+(entries.length?'':'<p class="empty">Sin movimientos para estos filtros.</p>'));
}
function render(){
  actions=[];
  const period=$('period').value, branch=$('branch').value, curr=$('currency').value;
  const clients=moduleName==='clients',hasSeller=data.assignment.length>0;
  const sellerEnabled=moduleName==='sales'||(clients&&!data.firstMonth);
  const seller=sellerEnabled&&hasSeller?$('seller').value:'';
  const filtered=(moduleName==='ar'&&ledgerDocs?ledgerDocs:docs).filter(d=>d.currency===curr && (!branch || d.branch===branch) && (!seller||d.seller===seller));
  const isSales=moduleName==='sales';
  const stock=moduleName==='inventory';
  for(const id of ['branch','currency']) $(id).parentElement.hidden=stock;
  for(const id of ['warehouse','category','stockProduct']) $(id).parentElement.hidden=!stock;
  $('zone').parentElement.hidden=!clients||!data.location.some(l=>l.zone);
  $('seller').parentElement.hidden=!hasSeller||!sellerEnabled;
  const statementMode=moduleName==='ar' && arTab==='statement';
  $('statementCustomer').parentElement.hidden=!statementMode;
  $('branch').parentElement.hidden=stock||!!data.branch||!!data.reportMonth;
  $('prodLabel').hidden=!isSales||!data.product.length;
  reportTabs(isSales,statementMode);
  viewReport=null;
  $('dashboard').dataset.module=moduleName;
  const count=[...$('secondaryFilters').querySelectorAll('select')].filter(s=>!s.parentElement.hidden && s.value).length;
  $('filterCount').textContent=count||'';
  $('filterToggle').setAttribute('aria-label','Filtros secundarios, '+count+' activos');
  $('title').textContent=clients?'Clientes':stock?'Inventario':isSales?'Resumen de ventas':'Cuentas por cobrar';
  document.title=$('title').textContent+' · ORA';
  $('subtitle').textContent=clients?'Ventas de '+monthName(period)+(data.modules.includes('ar')?' · Cartera al '+day(lastDay()):''):stock?'Existencias y rotación al '+day(lastDay())+'.':isSales?'Facturación, evolución y composición de las ventas del período.':'Cartera de clientes y vencimientos al '+day(statementMode?monthRanges(period,businessToday()).end:lastDay())+'.';
  if(data.excludedGroup?.length&&!stock)$('subtitle').textContent+=' Excluye ventas y cartera de empresas del grupo: '+data.excludedGroup.join(', ')+'.';
  document.querySelectorAll('[data-module]').forEach(b=>{const active=b.dataset.module===moduleName;b.classList.toggle('active',active);b.setAttribute('aria-pressed',active)});
  if(clients){
    $('dashboard').innerHTML=customers(data,filtered,{period,end:lastDay(),zone:$('zone').value,branch,seller,curr,constrained:!!(branch||seller),live:!!data.reportMonth},{money,esc,day,action,openRows,show:showDetail,companyDocs:ledgerDocs??docs,arDocs:ledgerDocs?.filter(d=>d.currency===curr),refresh:render});
    enableMapPan(document.querySelector('.venezuela svg'),render);
    return;
  }
  if(stock){
    if(inventoryTab==='restock' && data.modules.includes('inventory')){
      if(!['leadDays','safetyUnits'].every(id=>$(id).checkValidity())){
        $('dashboard').textContent='Introduce valores enteros dentro del intervalo indicado.';$('viewExport').innerHTML='';return;
      }
      const opts={period,end:lastDay(),warehouse:$('warehouse').value,category:$('category').value,product:$('stockProduct').value,
        months:Number($('demandMonths').value),lead:$('leadDays').value===''?null:$('leadDays').valueAsNumber,
        safety:$('safetyUnits').value===''?null:$('safetyUnits').valueAsNumber,priority:$('stockPriority').value};
      const r=renderRestock(data,opts,{esc,action,show:showDetail});
      $('dashboard').innerHTML=r.html;
      viewReport={...context('Reposición de inventario','Corte '+day(opts.end),[selected('warehouse'),selected('category'),selected('stockProduct'),selected('stockPriority'),selected('demandMonths'),
        'Plazo: '+(opts.lead??'según producto'),'Seguridad: '+(opts.safety??'según producto')].join(' · ')),currency:null,summary:r.summary,tables:r.tables,note:'Sugerencias para revisión humana.'};
      return;
    }
    $('dashboard').innerHTML=renderInventory(data,{period,end:lastDay(),warehouse:$('warehouse').value,category:$('category').value,product:$('stockProduct').value},{esc,action,panel,show:showDetail,refresh:render,day});
    return;
  }
  let cards,panels,table,hero,evolution;
  if(isSales){
    const d=monthDate(period);d.setUTCMonth(d.getUTCMonth()-1);
    const prev=d.toISOString().slice(0,7),prod=$('product').value;
    const ranges=monthRanges(period,businessToday());
    const current=sales(filtered,period,prod).filter(d=>d.issued<=ranges.end);
    const prior=sales(filtered,prev,prod).filter(d=>d.issued<=ranges.priorEnd);
    const range=rangeText(ranges.first,ranges.end);
    const coverage=data.company[0].source==='demo-v1' && ranges.end>'2026-10-31'?'La muestra de ventas llega al 31/10/2026.':'';
    if(salesTab==='docs'){
      const q=$('docSearch').value.trim().toLocaleLowerCase('es');
      for(const control of [$('docFrom'),$('docUntil')]){control.min=ranges.first;control.max=ranges.end}
      const from=[$('docFrom').value||ranges.first,ranges.first].sort().at(-1);
      const until=[$('docUntil').value||ranges.end,ranges.end].sort()[0],type=$('docType').value;
      const rows=current.filter(d=>d.issued>=from&&d.issued<=until&&(!type||d.kind===type)&&
        (d.number+' '+d.client).toLocaleLowerCase('es').includes(q)).sort((a,b)=>b.issued.localeCompare(a.issued));
      const label=rangeText(from,until);
      viewReport=documentReport('Documentos de venta',rows,label);
      viewReport.note=coverage;
      viewReport.filters+=' · '+selected('docType')+(q?' · Búsqueda: '+q:'');
      $('dashboard').innerHTML=panel('Documentos contabilizados',rows.length+' documentos · Neto del reporte '+money(sum(rows)),
        reportTable(['Documento','Cliente','Emisión','Tipo','Total con impuestos','Importe en el reporte'],rows.map(d=>[linkRows(d.number,[d],false,label),esc(d.client),day(d.issued),docType(d),money(d.fullGross),money(d.value)]))+
        (rows.length?'':'<p class="empty">Sin documentos para estos filtros.</p>'));
      return;
    }
    viewReport=documentReport('Ventas',current,range);
    viewReport.note=coverage;
    viewReport.summary.push(['Facturas netas sin impuestos',sum(current.filter(d=>d.sign===1))],['Notas de crédito',sum(current.filter(d=>d.sign<0))],['Comparativo '+rangeText(ranges.priorFirst,ranges.priorEnd),sum(prior)]);
    const invoices=current.filter(d=>d.sign===1), credits=current.filter(d=>d.sign===-1),net=sum(current);
    const previous=sum(prior),growth=previous>0?(net-previous)/previous*100:null;
    const recon=invoices.length+(invoices.length===1?' factura ':' facturas ')+money(sum(invoices))+(credits.length?' − '+credits.length+(credits.length===1?' nota de crédito ':' notas de crédito ')+money(-sum(credits)):'')+' = '+money(net)+' sin impuestos';
    hero=kpi('Facturación neta',money(net),growth===null?'Sin base de comparación':pct(Math.abs(growth))+(growth>=0?' más que ':' menos que ')+monthName(prev),'chart',current,true,
      '<span class="recon">'+esc(recon)+'</span>'+provenance(net));
    cards=kpi('Facturas emitidas',String(invoices.length),money(sum(invoices))+' sin impuestos','invoice',invoices)+
      kpi('Notas de crédito',money(sum(credits)),credits.length+(credits.length===1?' documento de ajuste':' documentos de ajuste'),'credit',credits);
    evolution=panel('Evolución de ventas',range+' frente a '+rangeText(ranges.priorFirst,ranges.priorEnd)+' · '+curr+(coverage?' · '+coverage:''),chart(current,prior,period,prev));
    panels=(data.reportMonth?'':panel('Ventas por sucursal','Participación en la facturación neta',distribution(current)))+
      (hasSeller?panel('Ventas por vendedor','Facturación neta · participación · facturas emitidas',sellerRanking(current)):'');
    const items=current.flatMap(r=>r.lines.map(l=>({...r,lines:[l],name:l.name,productId:l.product,value:l.net*r.sign})));
    const products=groups(items,'productId').map(g=>{
      const documents=groups(g.docs,'id').map(x=>({...x.docs[0],lines:x.docs.flatMap(d=>d.lines),value:x.value}));
      return {...g,name:g.docs[0].name,docs:documents};
    });
    table=data.product.length?breakdown('Desglose por producto','Producto',products,net):'';
    viewReport.charts=[{title:'Evolución de ventas por tramo del mes',labels:sliceLabels.map(l=>'Días '+l),
      series:[{name:cap(monthName(period)),values:slices(current).map(sum)},{name:cap(monthName(prev)),values:slices(prior).map(sum)}]},
      ...(data.reportMonth?[]:[barChart('Ventas por sucursal',groups(current,'branch'))]),
      ...(hasSeller?[barChart('Ventas por vendedor',groups(current,'seller').map(g=>({...g,name:data.seller.find(x=>x.id===g.name)?.name??'Sin asignar'})))]:[]),
      ...(products.length?[barChart('Ventas por producto (principales 15)',top(products))]:[])];
  }else{
    if(statementMode){
      renderStatement(filtered,period);
      return;
    }
    const rows=balances(filtered,lastDay()),late=rows.filter(overdue),upcoming=rows.filter(d=>d.days<=0&&!d.payment),unapplied=rows.filter(d=>d.payment);
    const unit=data.firstMonth?' partidas':' documentos';
    const oldest=rows.filter(d=>d.bucket==='Más de 90 días');
    cards=kpi('Saldo pendiente',money(sum(rows)),rows.length+unit,'wallet',rows,true,
      (sum(oldest)>0?'<span class="alert">'+esc(money(sum(oldest)))+' con más de 90 días</span>':'')+provenance(sum(rows)))+
      kpi('Saldo vencido',money(sum(late)),late.length+unit,'clock',late)+
      kpi('Por vencer',money(sum(upcoming)),upcoming.length+unit,'calendar',upcoming)+
      (unapplied.length?kpi('Pagos sin aplicar',money(sum(unapplied)),unapplied.length+' pagos por conciliar','credit',unapplied):'');
    const buckets=['Por vencer','1–30 días','31–60 días','61–90 días','Más de 90 días'];
    const bands=buckets.map(k=>rows.filter(d=>d.bucket===k)),max=Math.max(1,...bands.map(x=>Math.abs(sum(x))));
    panels=panel('Antigüedad de saldos','Saldo por vencimiento al '+day(lastDay())+' · Selecciona un tramo para revisar sus facturas.',bands.map((b,i)=>horizontal(buckets[i],money(sum(b)),sum(b),max,drill(buckets[i],b),i===4)).join(''));
    const byClient=groups(rows,'customer').map(g=>({...g,name:g.docs[0].client}));
    const debtors=top(groups(late,'customer').map(g=>({...g,name:g.docs[0].client})).filter(g=>g.value>0),5),most=Math.max(1,...debtors.map(g=>g.value));
    panels+=panel('Mayores deudores','Saldo vencido al '+day(lastDay())+' · cinco principales',debtors.map(g=>horizontal(g.name,money(g.value)+' · '+new Set(g.docs.map(d=>d.id)).size+' doc.',g.value,most,drill(g.name,g.docs))).join('')||'<p class="empty">Sin saldos vencidos. Todo al día.</p>');
    table=breakdown('Cartera por cliente','Cliente',byClient,sum(rows));
    viewReport=documentReport('Cuentas por cobrar',rows,'Corte '+day(lastDay()));
    viewReport.summary.push(['Saldo vencido',sum(late)],['Por vencer',sum(upcoming)],...(unapplied.length?[['Pagos sin aplicar',sum(unapplied)]]:[]));
    viewReport.charts=[barChart('Antigüedad de saldos',buckets.map((name,i)=>({name,value:sum(bands[i])}))),barChart('Cartera por cliente (principales 15)',top(byClient))];
  }
  if(isSales){
    $('dashboard').innerHTML='<div class="sales-overview"><div class="sales-summary">'+hero+'<div class="support">'+cards+'</div></div><div class="trend">'+evolution+'</div></div><div class="ranking-pair">'+panels+'</div>'+table;
    return;
  }
  $('dashboard').innerHTML='<div class="kpis">'+cards+'</div><div class="panels">'+panels+'</div>'+table;
}
$('filterToggle').onclick=()=>{
  const open=$('filterToggle').getAttribute('aria-expanded')!=='true';
  $('filterToggle').setAttribute('aria-expanded',open);
  $('secondaryFilters').classList.toggle('expanded',open);
};
$('reportBar').addEventListener('click',e=>{
  const button=e.target.closest('[data-view]');
  if(!button)return;
  if(moduleName==='sales')salesTab=button.dataset.view;else if(moduleName==='inventory')inventoryTab=button.dataset.view;else arTab=button.dataset.view;
  render();$('reportBar').querySelector('[aria-pressed=true]').focus();
});
document.addEventListener('click',async e=>{
  const b=e.target.closest('[data-export]');if(!b)return;
  const r=b.dataset.export==='view'?viewReport:detailReport;if(!r)return;
  const menu=b.closest('details');menu.open=false;
  try{await downloadReport(r,b.dataset.format)}catch(error){alert('Exportación: '+error.message)}
});
for(const id of ['docSearch','docFrom','docUntil','docType'])$(id).addEventListener('input',render);
$('period').addEventListener('change',()=>{$('docFrom').value='';$('docUntil').value=''});
function options(id,items){$(id).replaceChildren(...items.map(([value,label])=>new Option(label,value)))}
$('detailBody').addEventListener('click',e=>{
  const button=e.target.closest('[data-detail-action]');
  if(button){actions[button.dataset.detailAction]();$('close').focus()}
});
$('dashboard').addEventListener('keydown',e=>{
  if(!e.target.matches('[role=tab]'))return;
  const tabs=[...e.target.parentNode.querySelectorAll('[role=tab]')];
  const target=({Home:tabs[0],End:tabs.at(-1),ArrowLeft:tabs.find(t=>t!==e.target),ArrowRight:tabs.find(t=>t!==e.target)})[e.key];
  if(target){e.preventDefault();target.click()}
});
$('dashboard').addEventListener('click',e=>{const b=e.target.closest('[data-a]');if(b){opener=b;actions[b.dataset.a]()}});
$('dashboard').addEventListener('keydown',e=>{const b=e.target.closest('g[data-a]');if(b&&[' ','Enter'].includes(e.key)){e.preventDefault();opener=b;actions[b.dataset.a]()}});
$('detail').addEventListener('close',()=>opener?.focus());
for(const event of ['focusin','pointerover']){
  $('dashboard').addEventListener(event,e=>{
    const group=e.target.closest('[data-compare]');
    if(group) $('comparison').textContent=group.dataset.compare;
  });
}
setupNavigation();
// Shrink oversized figures until they fit their card; covers every renderer and viewport change.
function fitNumbers(){
  document.querySelectorAll('.kpi strong,.statement-focus strong').forEach(el=>{
    el.style.fontSize='';
    let size=parseFloat(getComputedStyle(el).fontSize);
    while(el.scrollWidth>el.clientWidth&&size>12){size-=1;el.style.fontSize=size+'px'}
  });
}
new MutationObserver(()=>requestAnimationFrame(fitNumbers)).observe($('dashboard'),{childList:true});
window.addEventListener('resize',()=>requestAnimationFrame(fitNumbers));
if(viewTitles[requestedView])markLoading(requestedView);
// Live mode reloads per section; keep the sidebar usable while this section's data is still arriving.
if(document.body.dataset.live)document.querySelectorAll('[data-module]').forEach(b=>b.onclick=()=>openLiveView(b.dataset.module,requested.get('month')));

$('close').onclick=()=>$('detail').close();
try{
  $('sync').classList.add('loading');
  const query=new URLSearchParams({view:requestedView});
  if(requested.has('month'))query.set('month',requested.get('month'));
  // A stalled ERP read must end in a visible error, not an endless loader.
  const response=await fetch('/api/demo?'+query,{signal:AbortSignal.timeout(180000)}).catch(e=>{throw Error(e.name==='TimeoutError'?'Odoo tardó demasiado en responder. Intenta de nuevo o elige otro mes.':'No se pudo conectar con el servidor.')});
  if(response.status===401 && !response.headers.has('WWW-Authenticate')){location.replace('/login');throw Error('Sesión expirada')}
  if(!response.ok) throw Error(response.status===403?'Tu cuenta carece de acceso a la lectura solicitada.':'No se pudieron consultar los datos. Revisa la conexión y vuelve a cargar.');
  data=await response.json();
  docs=prepare({...data,settlement:data.arDocument?[]:data.settlement??[]});
  if(data.firstMonth)moduleName=requestedView;
  if(data.arDocument){
    ledgerDocs=prepare({...data,document:data.arDocument,line:[]});
    ledgerDocs.forEach(d=>d.fullGross=gross(d));
  }
  if(data.modules.includes('inventory'))({renderRestock}=await import('./restock.js'));
  $('logout').hidden=!data.erpCompany;
  if(data.erpCompany)window.addEventListener('pageshow',e=>{if(e.persisted)location.reload()});
  initAppearance(data.user||'demo-local');
  docs.forEach(d=>d.fullGross=gross(d));
  const assignments=new Map(data.assignment.map(a=>[a.document,a.seller]));
  docs.forEach(d=>d.seller=assignments.get(d.id)??'__unassigned__');
  options('seller',[['','Todos los vendedores'],...data.seller.map(s=>[s.id,s.name]),['__unassigned__','Sin asignar']]);
  const zones=[...new Set(data.location.map(l=>l.zone).filter(Boolean))].sort();
  options('zone',[['','Todas las zonas'],...zones.map(z=>[z,z]),['Sin ubicación','Sin ubicación']]);
  document.querySelectorAll('[data-module]').forEach(b=>b.hidden=!data.modules.includes(b.dataset.module));
  const branches=[...new Set(docs.map(d=>d.branch))];
  if(!data.reportMonth && !data.branch && branches.length===1)data.branch=branches[0];
  $('company').textContent=data.company[0].name+(data.branch?' · '+data.branch:'');
  document.querySelector('.badge').textContent=(data.reportMonth?'Odoo':'Demo')+' · '+({basico:'Básico',intermedio:'Intermedio',avanzado:'Avanzado'})[data.plan];
  document.querySelector('footer span').textContent=data.reportMonth?'Fuente: Odoo':'Datos sintéticos de demostración';
  document.querySelector('#accountMenu summary span').textContent=data.user==='demo-local'?'Perfil de demo':data.user;
  document.querySelector('#accountMenu summary').title=data.user==='demo-local'?'':data.user;
  options('statementCustomer',[...data.customer].sort((a,b)=>a.name.localeCompare(b.name,'es')).map(c=>[c.id,c.name]));
  const syncedAt=new Date(data.synced),stale=Date.now()-syncedAt>12*36e5;
  $('sync').classList.toggle('stale',stale);
  $('sync').textContent=(stale?'Datos del ':'Actualizado · ')+syncedAt.toLocaleString('es-VE',{dateStyle:'short',timeStyle:'short'})+(stale?' · pueden no reflejar Odoo hoy':'');
  options('period',[...new Set(docs.map(d=>d.issued.slice(0,7)))].sort().reverse().map(m=>[m,cap(monthName(m))]));
  options('branch',[['','Todas las sucursales'],...[...new Set(docs.map(d=>d.branch))].sort().map(b=>[b,b])]);
  options('currency',[...new Set([...docs,...(ledgerDocs??[])].map(d=>d.currency))].sort().reverse().map(c=>[c,c]));
  if([...$('currency').options].some(o=>o.value===data.company[0].currency))$('currency').value=data.company[0].currency;
  options('product',[['','Todos los productos'],...data.product.map(p=>[p.id,p.name])]);
  if(data.modules.includes('inventory')){
    options('warehouse',[['','Todos los almacenes'],...data.warehouse.map(w=>[w.id,w.name])]);
    options('category',[['','Todas las categorías'],...[...new Set(data.article.map(a=>a.category))].map(c=>[c,c])]);
    options('stockProduct',[['','Todos los productos'],...data.product.map(p=>[p.id,p.name])]);
    const periods=[...new Set([...Array.from($('period').options,o=>o.value),...data.stock_cut.map(c=>c.period)])].sort().reverse();
    options('period',periods.map(m=>[m,cap(monthName(m))]));
  }
  const thisMonth=businessToday().slice(0,7);
  if(data.firstMonth){
    const periods=[];
    const d=monthDate(data.lastMonth);
    while(d.toISOString().slice(0,7)>=data.firstMonth){
      const m=d.toISOString().slice(0,7);periods.push([m,cap(monthName(m))]);d.setUTCMonth(d.getUTCMonth()-1);
    }
    options('period',periods);$('period').value=data.reportMonth;
  }else if(data.reportMonth){
    options('period',[[data.reportMonth,cap(monthName(data.reportMonth))]]);
  }else if(!Array.from($('period').options).some(o=>o.value===thisMonth)){
    $('period').add(new Option(cap(monthName(thisMonth)),thisMonth));
  }
  if(data.branch)$('branch').value=data.branch;
  document.querySelectorAll('.filters select').forEach(s=>s.onchange=render);
  if(data.firstMonth)$('period').onchange=()=>openLiveView(moduleName,$('period').value);
  document.querySelectorAll('[data-module]').forEach(b=>b.onclick=()=>{if(!data.modules.includes(b.dataset.module))return;if(b.dataset.module==='clients'&&moduleName!=='clients')resetMap();moduleName=b.dataset.module;render()});
  if(data.firstMonth)document.querySelectorAll('[data-module]').forEach(b=>b.onclick=()=>openLiveView(b.dataset.module,data.reportMonth));
  enhanceFilters();
  for(const id of ['leadDays','safetyUnits','stockPriority'])$(id).oninput=render;
  render();
  $('demandMonths').onchange=render;
  initTour({user:data.company[0].id+'.'+data.user+'.'+data.plan,modules:data.firstMonth?[moduleName]:data.modules,
    state:()=>({mod:moduleName,tab:moduleName==='sales'?salesTab:moduleName==='ar'?arTab:inventoryTab,
      salesTab,arTab,inventoryTab}),
    restore:s=>{moduleName=s.mod;salesTab=s.salesTab;arTab=s.arTab;inventoryTab=s.inventoryTab;render()},
    navigate:(mod,tab)=>{if(!data.modules.includes(mod))return;moduleName=mod;
      if(tab){if(mod==='sales')salesTab=tab;else if(mod==='ar')arTab=tab;else if(mod==='inventory')inventoryTab=tab}render()}
  });
}catch(e){$('sync').textContent='No se pudo leer Odoo';$('sync').classList.add('failed');
  $('dashboard').innerHTML='<div class="load-error" role="alert"><h2>No pudimos cargar este reporte</h2><p>Revisa tu conexión o que tu sesión de Odoo siga activa, y vuelve a intentarlo.</p><p class="hint">'+esc(e.message||'Error desconocido')+'</p><button class="retry">Reintentar</button></div>';
  $('dashboard').querySelector('.retry').addEventListener('click',()=>location.reload());
  if(location.search){const back=document.createElement('a');back.href='/';back.textContent='Volver a Ventas';$('dashboard').append(' ',back)}
  console.error(e)}finally{$('sync').classList.remove('loading');document.body.classList.remove('loading')}
function renderStatement(filtered,period){
  const currency=$('currency').value,id=$('statementCustomer').value,name=selected('statementCustomer');
  if(!id){$('dashboard').textContent='Selecciona un cliente.';return}
  const start=period+'-01',end=monthRanges(period,businessToday()).end;
  const s=statement(filtered,id,start,end,data.history);
  const note=s.missing.length?'Provisional · Falta '+s.missing.join(' e '):'Historial completo al corte';
  const range=rangeText(start,end);
  const tables=statementTables(s);
  viewReport={...context('Estado de cuenta · '+name,range),note,summary:s.summary,headlineBalances:s.summary.slice(-2),tables};
  const overview='<div class="statement-focus">'+s.summary.slice(-2).map(([k,v])=>'<div><span>'+esc(k)+'</span><strong>'+money(v)+'</strong></div>').join('')+'</div><details class="statement-breakdown"><summary>Desglose del saldo</summary><div class="statement-numbers">'+s.summary.slice(0,-2).map(([k,v])=>'<div><span>'+esc(k)+'</span><b>'+money(v)+'</b></div>').join('')+'</div></details>';
  function movementLink(e){
    const open=action(()=>openRows(e.reference,[{...e.doc,value:e.delta}],true,'','Movimiento del '+day(e.date),e.date));
    return '<button class="link" data-a="'+open+'">'+esc(e.reference)+'</button>';
  }
  const movementRows=s.events.map(e=>[day(e.date),esc(e.label),movementLink(e),esc(e.doc.number),money(Math.max(0,e.delta)),money(Math.max(0,-e.delta)),money(e.balance)]);
  const open=s.open.map(d=>[linkRows(d.number,[d],true,'Corte '+day(end)),day(d.issued),day(d.due),d.payment?'Pago sin aplicar':d.days>0?'Vencido':'Por vencer',money(d.value)]);
  $('dashboard').innerHTML='<h2>'+esc(name)+'</h2><p class="detailsum">Corte '+day(end)+' · '+esc(currency)+' · '+esc(note)+'</p>'+overview+
    panel('Movimientos del período',range,reportTable(tables[0].headers,movementRows)+(movementRows.length?'':'<p class="empty">Sin movimientos en el período.</p>'))+
    panel('Documentos abiertos al corte',s.open.length+' documentos · '+money(sum(s.open)),reportTable(tables[1].headers,open));
}
