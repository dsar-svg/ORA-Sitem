const fmt = n => new Intl.NumberFormat('es-VE',{maximumFractionDigits:2}).format(n);
const rotation = n => n == null ? 'Datos insuficientes' : fmt(n)+' ×';
const types = {sale:'Salida por venta',return:'Devolución de cliente',receipt:'Recepción',transfer:'Transferencia interna',adjustment:'Ajuste'};
const sort = {key:'turns',direction:-1};
const columns = [['sku','SKU'],['name','Producto'],['warehouseName','Almacén'],['closing','Existencias'],['out','Salidas netas'],['turns','Rotación'],['status','Estado']];

// The server (inventory_view.py) sends out, sold and mean per cut; the local arithmetic stays for tests and old payloads.
export function calculateStock(cut,moves,days){
  let {out,sold,mean}=cut;
  if(out===undefined){
    const daily = Array(days).fill(0);
    out = 0; sold = 0;
    for(const m of moves){
      daily[Number(m.posted.slice(-2))-1] += m.units;
      if(m.kind==='sale') sold -= m.units;
      if(m.kind==='sale' || m.kind==='return') out -= m.units;
    }
    let balance = cut.opening, total = 0;
    for(const delta of daily){balance += delta;total += balance}
    mean = cut.opening == null || balance !== cut.closing ? null : total/days;
  }
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

// Pareto by units shipped: A covers the first 80 % of net outflow, B the next 15 %, C the rest.
export function classify(products){
  const total=products.reduce((n,p)=>n+Math.max(0,p.out),0);
  let running=0;
  return [...products].sort((a,b)=>b.out-a.out).map(p=>{
    // Class by the share already covered before this item, so the top seller is always A; rounding keeps 80 % exact.
    const before=total?Math.round(running/total*1e6)/1e6:1;
    running+=Math.max(0,p.out);
    return {...p,abc:p.out<=0?'C':before<0.8?'A':before<0.95?'B':'C'};
  });
}

function abc(rows,{esc,panel,action,show,end,day,movements}){
  const map=new Map();
  for(const r of rows){
    const p=map.get(r.product)??{product:r.product,name:r.name,sku:r.sku,unit:r.unit,out:0,closing:0,rows:[]};
    p.out+=r.out;p.closing+=r.closing;p.rows.push(r);map.set(r.product,p);
  }
  const items=classify([...map.values()]).map(p=>{
    const turns=p.rows.every(r=>r.turns!=null)?p.rows.reduce((n,r)=>n+r.turns,0)/p.rows.length:null;
    const status=p.out<=0&&p.closing>0?'Sin salidas':turns!=null&&turns<0.5&&p.closing>0?'Lento':'Activo';
    return {...p,turns,status};
  });
  const count=c=>items.filter(i=>i.abc===c).length;
  const idle=items.filter(i=>i.status!=='Activo');
  const card=(title,value,sub)=>'<div class="kpi"><span class="kpi-name">'+title+'</span><strong>'+value+'</strong><span class="sub">'+esc(sub)+'</span></div>';
  const row=i=>'<tr data-a="'+action(()=>movements(i.rows[0]))+'"><td><span class="abc abc-'+i.abc+'">'+i.abc+'</span></td><td>'+esc(i.sku)+'</td><td><button class="link name-link" data-a="'+action(()=>movements(i.rows[0]))+'">'+esc(i.name)+'</button></td><td class="num">'+fmt(i.out)+' '+esc(i.unit)+'</td><td class="num">'+fmt(i.closing)+' '+esc(i.unit)+'</td><td class="num">'+rotation(i.turns)+'</td><td>'+esc(i.status)+'</td></tr>';
  return '<div class="kpis">'+card('Clase A',count('A'),'Hacen el 80 % de las salidas')+card('Clase B',count('B'),'El siguiente 15 %')+card('Clase C',count('C'),'El 5 % restante o sin salidas')+'</div>'+
    panel('Inventario lento o sin salidas','Productos con existencias que rotan menos de 0,5 vueltas o no tuvieron despachos al '+day(end),
      idle.length?'<div class="table-wrap"><table><thead><tr><th>Clase</th><th>SKU</th><th>Producto</th><th class="num">Salidas</th><th class="num">Existencias</th><th class="num">Rotación</th><th>Estado</th></tr></thead><tbody>'+idle.map(row).join('')+'</tbody></table></div>':'<p class="empty">Todo el inventario con existencias tuvo movimiento.</p>')+
    panel('Clasificación ABC','Por unidades despachadas en el mes · Selecciona un producto para ver sus movimientos',
      '<div class="table-wrap"><table><thead><tr><th>Clase</th><th>SKU</th><th>Producto</th><th class="num">Salidas</th><th class="num">Existencias</th><th class="num">Rotación</th><th>Estado</th></tr></thead><tbody>'+items.map(row).join('')+'</tbody></table></div>');
}

export function renderInventory(data,filters,ui){
  const {esc,action,panel,show,refresh,day} = ui;
  const {period,warehouse,category,product,end} = filters;
  const products=new Map(data.product.map(p=>[p.id,p.name]));
  const articles=new Map(data.article.map(a=>[a.product,a]));
  const stores=new Map(data.warehouse.map(w=>[w.id,w.name]));
  const byCut=new Map();
  for(const move of data.stock_move??[]){
    if(!byCut.has(move.cut)) byCut.set(move.cut,[]);
    byCut.get(move.cut).push(move);
  }
  const rows=data.stock_cut.filter(c=>c.period===period && (!warehouse||c.warehouse===warehouse) &&
    (!product||c.product===product) && (!category||articles.get(c.product).category===category)).map(c=>({
    ...calculateStock(c,byCut.get(c.id)??[],Number(end.slice(-2))),moves:byCut.get(c.id)??(c.moves===undefined?[]:undefined),...articles.get(c.product),
    name:products.get(c.product),warehouseName:stores.get(c.warehouse)
  }));
  if(filters.view==='abc') return abc(rows,{esc,panel,action,show,day,end,movements:r=>movements(r)});
  async function movements(r){
    if(!Array.isArray(r.moves)){
      show(r.name,'MOVIMIENTOS DE INVENTARIO','<p class="empty">Cargando movimientos…</p>');
      try{
        const res=await fetch('/api/moves?month='+encodeURIComponent(period)+'&cut='+encodeURIComponent(r.id));
        if(!res.ok)throw Error();
        r.moves=await res.json();
      }catch{show(r.name,'MOVIMIENTOS DE INVENTARIO','<p class="empty">No se pudieron cargar los movimientos. Intenta de nuevo.</p>');return}
    }
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
    return '<th class="'+(['closing','out','turns'].includes(key)?'num':'')+'" aria-sort="'+(active?(sort.direction===1?'ascending':'descending'):'none')+'"><button data-sort="'+key+'" data-a="'+id+'">'+label+'<i class="sort" data-dir="'+(active?(sort.direction===1?'up':'down'):'none')+'" aria-hidden="true"></i></button></th>';
  }).join('');
  const body=rows.map(r=>'<tr><td>'+esc(r.sku)+'</td><td>'+esc(r.name)+'</td><td>'+esc(r.warehouseName)+'</td><td class="num">'+fmt(r.closing)+' '+esc(r.unit)+'</td><td class="num">'+fmt(r.out)+'</td><td class="num">'+rotation(r.turns)+'</td><td>'+esc(r.status)+'</td><td><button class="link" data-a="'+action(()=>movements(r))+'">Movimientos</button></td></tr>').join('');
  const urgent=rows.filter(r=>r.closing<=0||/Stock bajo/.test(r.status)).sort((a,b)=>a.closing-b.closing).slice(0,6);
  return '<div class="kpis">'+summary('Agotados',rows.filter(r=>r.closing<=0).length,'Referencias por almacén')+
    summary('Baja rotación',rows.filter(r=>r.turns!=null && r.turns<0.5).length,'Menos de 0,5 vueltas en el mes')+
    summary('Sin salidas',rows.filter(r=>!r.sold).length,'Sin despachos de venta')+'</div><div class="panels">'+
    panel('Mayor rotación','Vueltas por producto · almacenes seleccionados',bars||'<p class="empty">Sin productos con promedio disponible.</p>')+
    panel('Para reponer','Agotados o bajo el mínimo al '+day(end),urgent.map(r=>'<button class="hrow priority" data-a="'+action(()=>movements(r))+'"><div><strong title="'+esc(r.name)+'">'+esc(r.name)+'</strong><b>'+fmt(r.closing)+' '+esc(r.unit)+' · '+esc(r.warehouseName)+'</b></div></button>').join('')||'<p class="empty">Nada por reponer con estos filtros.</p>')+
    '</div>'+panel('Existencias por almacén','Corte '+day(end)+' · '+rows.length+' referencias','<div class="table-wrap"><table><thead><tr>'+headers+'<th>Detalle</th></tr></thead><tbody>'+body+'</tbody></table></div>'+(rows.length?'':'<p class="empty">Sin existencias registradas para estos filtros.</p>')+
    '<details class="criteria"><summary>Cómo se calcula</summary><dl><dt>Reposición</dt><dd>Agotado con existencias ≤ 0. Stock bajo al quedar por debajo del mínimo configurado.</dd><dt>Rotación</dt><dd>Salidas por venta menos devoluciones, divididas entre el promedio de cierres diarios. Alta desde 1 vuelta y baja por debajo de 0,5.</dd><dt>Datos insuficientes</dt><dd>El promedio falta, no concilia con el corte o es menor o igual que cero.</dd></dl></details>');
}
