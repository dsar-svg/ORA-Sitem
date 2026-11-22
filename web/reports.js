import {balances,sum} from './metrics.js';
const iso=d=>d.toISOString().slice(0,10);
export const previousDay=s=>iso(new Date(Date.parse(s)-86400000));
export function monthRanges(month,today){
  const first=month+'-01',start=new Date(first+'T00:00:00Z');
  const end=iso(new Date(Date.UTC(start.getUTCFullYear(),start.getUTCMonth()+1,0)));
  const priorEnd=previousDay(first),prior=priorEnd.slice(0,7);
  const current=today.startsWith(month);
  return {first,end:current?today:end,priorFirst:prior+'-01',priorEnd:current?prior+'-'+(today.slice(-2)<priorEnd.slice(-2)?today.slice(-2):priorEnd.slice(-2)):priorEnd};
}
export function gross(d){return d.sign*d.lines.reduce((n,l)=>n+l.net+l.tax,0)}
export const docType=d=>d.sign<0?'Nota de crédito':'Factura';
export function statement(docs,customer,from,end,history={}){
  const scoped=docs.filter(d=>d.customer===customer && d.issued<=end);
  const opening=sum(balances(scoped,previousDay(from))),open=balances(scoped,end);
  const events=[];
  function entry(date,label,reference,delta,doc,order){
    if(date>=from&&date<=end)events.push({date,label,reference,delta,doc,order});
  }
  for(const d of scoped){
    entry(d.issued,docType(d),d.number,gross(d),d,0);
    for(const p of d.payments){
      entry(p.posted,d.sign===1?'Pago aplicado':'Liquidación de crédito',p.id,-d.sign*p.amount,d,1);
    }
  }
  events.sort((a,b)=>a.date.localeCompare(b.date)||a.order-b.order||a.reference.localeCompare(b.reference));
  let running=opening;
  for(const e of events){running+=e.delta;e.balance=running}
  const by=label=>events.filter(e=>e.label===label).reduce((s,e)=>s+e.delta,0);
  const missing=[];
  if(!history.opening||!history.start||from<history.start)missing.push('saldo inicial verificable');
  if(!history.applications||!history.through||end>history.through)missing.push('historial de aplicaciones hasta el corte');
  return {opening,events,open,ending:running,overdue:sum(open.filter(d=>d.days>0)),missing,
    summary:[['Saldo inicial',opening],['Facturas y cargos',by('Factura')],['Pagos aplicados',by('Pago aplicado')],['Notas de crédito',by('Nota de crédito')],['Liquidaciones de crédito',by('Liquidación de crédito')],['Saldo final',running],['Saldo vencido',sum(open.filter(d=>d.days>0))]]};
}
export function statementTables(s){
  return [{name:'Movimientos',headers:['Fecha','Movimiento','Referencia','Documento','Cargo','Abono','Saldo acumulado'],amounts:[4,5,6],
    rows:s.events.map(e=>[e.date,e.label,e.reference,e.doc.number,Math.max(0,e.delta),Math.max(0,-e.delta),e.balance])},
    {name:'Abiertos al corte',headers:['Documento','Emisión','Vencimiento','Estado al corte','Saldo'],amounts:[4],
    rows:s.open.map(d=>[d.number,d.issued,d.due,d.days>0?'Vencido':'Por vencer',d.value])}];
}
