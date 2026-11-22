const fmt = n => new Intl.NumberFormat('es-VE',{maximumFractionDigits:2}).format(n);
const rotation = n => n == null ? 'Datos insuficientes' : fmt(n)+' ×';
const types = {sale:'Salida por venta',return:'Devolución de cliente',receipt:'Recepción',transfer:'Transferencia interna',adjustment:'Ajuste'};
const sort = {key:'turns',direction:-1};
const columns = [['sku','SKU'],['name','Producto'],['warehouseName','Almacén'],['closing','Existencias'],['out','Salidas netas'],['turns','Rotación'],['status','Estado']];

export function calculateStock(cut,moves,days){
  const daily = Array(days).fill(0);
  let out = 0, sold = 0;
  for(const m of moves){
    daily[Number(m.posted.slice(-2))-1] += m.units;
    if(m.kind==='sale') sold -= m.units;
    if(m.kind==='sale' || m.kind==='return') out -= m.units;
  }
  let balance = cut.opening, total = 0;
  for(const delta of daily){balance += delta;total += balance}
  const mean = cut.opening == null || balance !== cut.closing ? null : total/days;
  const turns = mean > 0 ? out/mean : null;
  const tags = [];
  if(cut.closing<=0) tags.push('Agotado');
  if(cut.minimum!=null && cut.closing<cut.minimum) tags.push('Stock bajo');
  if(!sold) tags.push('Sin salidas');
  if(turns==null) tags.push('Datos insuficientes');
  else if(turns<0.5) tags.push('Baja rotación');
  else if(turns>=1) tags.push('Alta rotación');
  if(!tags.length) tags.push('Normal');
  return {...cut,out,sold,mean,turns,status:tags.join(' · '),moves,days};
}

export function renderInventory(data,filters,ui){
  const {esc,action,panel,show,refresh,day} = ui;
  const {period,warehouse,category,product,end} = filters;
  const products=new Map(data.product.map(p=>[p.id,p.name]));
  const articles=new Map(data.article.map(a=>[a.product,a]));
  const stores=new Map(data.warehouse.map(w=>[w.id,w.name]));
  const byCut=new Map();
  for(const move of data.stock_move){
    if(!byCut.has(move.cut)) byCut.set(move.cut,[]);
    byCut.get(move.cut).push(move);
  }
  const rows=data.stock_cut.filter(c=>c.period===period && (!warehouse||c.warehouse===warehouse) &&
    (!product||c.product===product) && (!category||articles.get(c.product).category===category)).map(c=>({
    ...calculateStock(c,byCut.get(c.id)??[],Number(end.slice(-2))),...articles.get(c.product),
    name:products.get(c.product),warehouseName:stores.get(c.warehouse)
  }));
  function movements(r){
    const sorted=[...r.moves].sort((a,b)=>a.posted.localeCompare(b.posted));
    const body='<p>'+esc(r.warehouseName)+' · '+esc(r.sku)+' · Corte '+day(end)+'</p>'+
      '<p>Apertura: '+(r.opening==null?'sin registro':fmt(r.opening))+' '+esc(r.unit)+' · Cierre: '+fmt(r.closing)+' '+esc(r.unit)+
      ' · Mínimo: '+(r.minimum==null?'sin configurar':fmt(r.minimum))+'</p>'+
      '<p>Promedio de '+r.days+' cierres diarios: '+(r.mean==null?'sin base conciliable':fmt(r.mean)+' '+esc(r.unit))+
      '. Salidas netas: '+fmt(r.out)+' '+esc(r.unit)+'. Rotación: '+rotation(r.turns)+'.</p>'+
      '<div class="detailsum">'+r.moves.length+' movimientos · Existencias <b>'+fmt(r.closing)+' '+esc(r.unit)+'</b></div>'+
      '<div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Referencia</th><th>Movimiento</th><th class="num">Variación ('+esc(r.unit)+')</th></tr></thead><tbody>'+
      sorted.map(m=>'<tr><td>'+day(m.posted)+'</td><td>'+esc(m.reference)+'</td><td>'+types[m.kind]+'</td><td class="num">'+(m.units>0?'+':'')+fmt(m.units)+'</td></tr>').join('')+'</tbody></table></div>';
    show(r.name,'MOVIMIENTOS DE INVENTARIO',body);
  }
  const byProduct=new Map();
  for(const row of rows){
    if(!byProduct.has(row.product)) byProduct.set(row.product,[]);
    byProduct.get(row.product).push(row);
  }
  const ranking=[...byProduct.values()].flatMap(locations=>{
    if(locations.some(r=>r.mean==null || r.mean<0)) return [];
    const avg=locations.reduce((n,r)=>n+r.mean,0);
    return avg>0?[{name:locations[0].name,turns:locations.reduce((n,r)=>n+r.out,0)/avg}]:[];
  }).sort((a,b)=>b.turns-a.turns);
  const bars=ranking.map(r=>'<div class="hrow"><div><strong>'+esc(r.name)+'</strong><b>'+rotation(r.turns)+'</b></div><span class="track"><i style="width:'+Math.max(0,r.turns/(ranking[0].turns||1)*100)+'%"></i></span></div>').join('');
  const summary=(name,count,description)=>'<div class="kpi"><span class="kpi-name">'+name+'</span><strong>'+count+'</strong><span class="sub">'+description+'</span></div>';
  rows.sort((a,b)=>{
    const x=a[sort.key],y=b[sort.key];
    if(x==null || y==null) return Number(x==null)-Number(y==null);
    return sort.direction*(typeof x==='number'?x-y:String(x).localeCompare(String(y),'es'));
  });
  const headers=columns.map(([key,label])=>{
    const active=sort.key===key;
    const id=action(()=>{
      sort.direction=active?-sort.direction:1;sort.key=key;refresh();
      document.querySelector('[data-sort="'+key+'"]').focus();
    });
    return '<th class="'+(['closing','out','turns'].includes(key)?'num':'')+'" aria-sort="'+(active?(sort.direction===1?'ascending':'descending'):'none')+'"><button data-sort="'+key+'" data-a="'+id+'">'+label+' '+(active?(sort.direction===1?'↑':'↓'):'↕')+'</button></th>';
  }).join('');
  const body=rows.map(r=>'<tr><td>'+esc(r.sku)+'</td><td>'+esc(r.name)+'</td><td>'+esc(r.warehouseName)+'</td><td class="num">'+fmt(r.closing)+' '+esc(r.unit)+'</td><td class="num">'+fmt(r.out)+'</td><td class="num">'+rotation(r.turns)+'</td><td>'+esc(r.status)+'</td><td><button class="link" data-a="'+action(()=>movements(r))+'">Movimientos ↗</button></td></tr>').join('');
  return '<div class="kpis">'+summary('Agotados',rows.filter(r=>r.closing<=0).length,'Referencias por almacén')+
    summary('Baja rotación',rows.filter(r=>r.turns!=null && r.turns<0.5).length,'Menos de 0,5 vueltas en el mes')+
    summary('Sin salidas',rows.filter(r=>!r.sold).length,'Sin despachos de venta')+'</div><div class="panels">'+
    panel('Mayor rotación','Vueltas por producto · almacenes seleccionados',bars||'<p class="empty">Sin productos con promedio disponible.</p>')+
    panel('Criterios de revisión','Cálculo mensual por producto y almacén','<dl><dt>Reposición</dt><dd>Agotado con existencias ≤ 0. Stock bajo al quedar por debajo del mínimo configurado.</dd><dt>Rotación</dt><dd>Salidas por venta menos devoluciones, divididas entre el promedio de cierres diarios. Alta desde 1 vuelta y baja por debajo de 0,5.</dd><dt>Datos insuficientes</dt><dd>El promedio falta, no concilia con el corte o es menor o igual que cero.</dd></dl>')+
    '</div>'+panel('Existencias por almacén','Corte '+day(end)+' · '+rows.length+' referencias','<div class="table-wrap"><table><thead><tr>'+headers+'<th>Detalle</th></tr></thead><tbody>'+body+'</tbody></table></div>'+(rows.length?'':'<p class="empty">Sin existencias registradas para estos filtros.</p>'));
}
