const number=v=>v==null?'—':v.toLocaleString('es-VE',{maximumFractionDigits:2});
const statuses=['Prioritario','Revisar pronto','Sin urgencia','Datos insuficientes'];
const reviewDays=7;
function monthsEnding(period,n){
  const [year,month]=period.split('-').map(Number);
  return Array.from({length:n},(_,i)=>new Date(Date.UTC(year,month-1-i,1)).toISOString().slice(0,7));
}
function days(period){
  const [year,month]=period.split('-').map(Number);
  return new Date(Date.UTC(year,month,0)).getUTCDate();
}
export function suggestions(data,options){
  const periods=monthsEnding(options.period,options.months);
  const cuts=new Map(data.stock_cut.map(c=>[JSON.stringify([c.product,c.warehouse,c.period]),c]));
  const policies=new Map(data.stock_policy.map(p=>[p.cut,p]));
  const sales=new Map();
  for(const m of data.stock_move){
    if(m.kind==='sale'||m.kind==='return')sales.set(m.cut,(sales.get(m.cut)||0)-m.units);
  }
  const articles=new Map(data.article.map(a=>[a.product,a]));
  const names=new Map(data.product.map(p=>[p.id,p.name]));
  const stores=new Map(data.warehouse.map(w=>[w.id,w.name]));
  const result=[];
  for(const c of data.stock_cut.filter(c=>c.period===options.period)){
    const a=articles.get(c.product);
    if((options.warehouse&&c.warehouse!==options.warehouse)||(options.category&&a.category!==options.category)||(options.product&&c.product!==options.product))continue;
    const p=policies.get(c.id);
    const lead=options.lead??p?.lead_days,safety=options.safety??p?.safety;
    const available=p?.reserved==null?null:c.closing-p.reserved;
    const hist=periods.map(month=>cuts.get(JSON.stringify([c.product,c.warehouse,month])));
    const complete=hist.every(h=>h&&policies.get(h.id)?.sales_complete);
    const windowDays=periods.reduce((n,m)=>n+days(m),0);
    const net=complete?hist.reduce((n,h)=>n+(sales.get(h.id)||0),0):null;
    const rate=complete?Math.max(0,net/windowDays):null;
    const coverage=rate>0&&available!=null?Math.max(0,available)/rate:null;
    const end=c.period+'-'+days(c.period);
    const deadline=lead==null?null:new Date(Date.parse(end)+lead*86400000).toISOString().slice(0,10);
    const inbound=data.inbound.filter(i=>i.cut===c.id&&i.state==='confirmed'&&i.arrival>end&&deadline&&i.arrival<=deadline);
    const incoming=inbound.reduce((n,i)=>n+i.open_units,0);
    const position=available==null||!p?.receipts_complete||lead==null?null:available+incoming;
    const point=rate==null||lead==null||safety==null?null:rate*lead+safety;
    const target=point==null?null:point+rate*reviewDays;
    const qty=position==null||point==null?null:position<point?Math.ceil(target-position):0;
    const daysToOrder=qty==null?null:qty>0?0:rate>0?Math.floor((position-point)/rate)+1:null;
    let orderDate='Sin fecha estimada';
    if(daysToOrder!=null)orderDate=daysToOrder>365?'Después de un año':new Date(Date.parse(end)+daysToOrder*86400000).toISOString().slice(0,10);
    let status=statuses[3];
    if(qty!=null){
      if(qty>0)status=coverage!=null&&coverage<=lead?statuses[0]:statuses[1];
      else status=rate>0&&(coverage<=lead||position<target)?statuses[1]:statuses[2];
    }
    const missing=[!complete&&'historial de ventas',lead==null&&'plazo',safety==null&&'seguridad',available==null&&'reservas',!p?.receipts_complete&&'recepciones'].filter(Boolean);
    result.push({...c,name:names.get(c.product),sku:a.sku,unit:a.unit,store:stores.get(c.warehouse),reserved:p?.reserved,available,rate,coverage,lead,safety,position,point,target,qty,status,net,windowDays,inbound,incoming,missing,end,orderDate});
  }
  return result.filter(r=>!options.priority||r.status===options.priority).sort((a,b)=>statuses.indexOf(a.status)-statuses.indexOf(b.status)||a.name.localeCompare(b.name));
}
export function renderRestock(data,options,ui){
  const {esc,action,show}=ui;
  const rows=suggestions(data,options);
  const headers=['SKU','Producto','Almacén','Ud.','Disponible','Consumo/día','Cobertura (d)','Plazo (d)','En camino','Sugerido','Prioridad'];
  function values(r){return [r.sku,r.name,r.store,r.unit,r.available,r.rate==null?null:+r.rate.toFixed(3),r.coverage==null?null:+r.coverage.toFixed(2),r.lead,r.position==null?null:r.incoming,r.qty,r.status]}
  function detail(r){
    const facts=[
      ['Corte',r.end],['Existencias físicas',number(r.closing)],['Reservas pendientes',number(r.reserved)],['Disponible = físico − reservas',number(r.available)],
      ['Salidas netas / días',number(r.net)+' / '+r.windowDays],['Consumo diario',number(r.rate)],['Plazo de entrega',number(r.lead)+' días'],
      ['Stock de seguridad',number(r.safety)],['Recepciones confirmadas a tiempo',r.inbound.map(i=>i.id+' · '+i.arrival+' · '+i.open_units+' '+r.unit).join(', ')||(r.missing.includes('recepciones')?'Sin historial confirmado':'Ninguna')],
      ['Posición = disponible + recepciones',number(r.position)],['Punto = consumo × plazo + seguridad',number(r.point)],
      ['Objetivo = punto + 7 días de consumo',number(r.target)],['Cantidad para revisión',number(r.qty)+' '+r.unit],
      ['Fecha estimada para pedir al ritmo actual',r.orderDate]
    ];
    show(r.name,'REPOSICIÓN · '+r.store,'<p class="detailsum">'+esc(r.status)+(r.missing.length?' · Falta '+esc(r.missing.join(', ')):'')+'</p><section class="profile-section"><dl>'+facts.map(([k,v])=>'<div><dt>'+esc(k)+'</dt><dd>'+esc(v)+'</dd></div>').join('')+'</dl></section>');
  }
  const exportRows=rows.map(r=>values(r).map(v=>v??'Sin dato'));
  const table='<div class="table-wrap restock-table"><table><thead><tr>'+headers.map(h=>'<th>'+esc(h)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(r=>'<tr>'+values(r).map((v,i)=>'<td>'+ (i===1?'<button class="link" data-a="'+action(()=>detail(r))+'">'+esc(v)+' ↗</button>':esc(typeof v==='number'?number(v):v??'—'))+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
  return {html:'<h2>Sugerencias de reposición</h2><p class="hint">Revisión humana · Corte '+options.end+' · Selecciona un producto para consultar el cálculo.</p>'+table+
    (!rows.length?'<p class="empty">Sin referencias para estos filtros.</p>':'')+
    '<p class="hint">Se repone por debajo del punto de reposición, hasta cubrir el plazo y 7 días adicionales, más la seguridad. Cantidades redondeadas hacia arriba en la unidad del artículo. Sin demanda, la cobertura en días no aplica.</p>',
    tables:[{name:'Sugerencias',headers,amounts:[],rows:exportRows},
      {name:'Cálculo',headers:['SKU','Almacén','Ud.','Seguridad','Posición','Punto de reposición','Objetivo','Fecha estimada para pedir','Datos faltantes'],amounts:[],
        rows:rows.map(r=>[r.sku,r.store,r.unit,r.safety,r.position,r.point==null?null:+r.point.toFixed(2),r.target==null?null:+r.target.toFixed(2),r.orderDate,r.missing.join(', ')].map(v=>v??'Sin dato'))}],
    summary:statuses.map(status=>[status,rows.filter(r=>r.status===status).length])};
}
