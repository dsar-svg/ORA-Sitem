import {customerMap} from './map.js';
import {sales,balances,sum,groups,overdue} from './metrics.js';

let activeTab='directory';

export function customers(data,docs,filter,ui){
  const {money,esc,day,action,openRows,refresh,show,companyDocs}=ui;
  const locations=new Map(data.location.map(l=>[l.customer,l]));
  const monthly=sales(docs,filter.period);
  const ar=data.modules.includes('ar');
  const pending=ar?balances(ui.arDocs??docs,filter.end):[];
  const included=new Set(docs.filter(d=>d.issued<=filter.end).map(d=>d.customer));
  const all=data.customer.filter(c=>!filter.constrained||included.has(c.id)).map(c=>({
    ...c, ...locations.get(c.id), zone:locations.get(c.id)?.zone||'Sin ubicación',
    sales:monthly.filter(d=>d.customer===c.id),ar:pending.filter(d=>d.customer===c.id)
  })).filter(c=>!filter.zone||c.zone===filter.zone).sort((a,b)=>a.name.localeCompare(b.name,'es'));
  const profiles=new Map(data.customer_profile.map(p=>[p.customer,p]));
  const field=(name,value)=>'<div><dt>'+esc(name)+'</dt><dd>'+esc(value??'Sin registrar')+'</dd></div>';
  const detailLink=(label,fn)=>'<button class="link" data-detail-action="'+action(fn)+'">'+label+'</button>';
  function profile(c){
    const p=profiles.get(c.id)??{};
    const lines=c.sales.flatMap(d=>d.lines.map(l=>({...l,value:d.sign*l.net})));
    const top=groups(lines,'product')[0];
    const invoiceCount=c.sales.filter(d=>d.sign===1).length;
    const back=detailLink('← Volver a la ficha',()=>profile(c));
    const documents=(label,rows,cartera=false)=>detailLink(label+' ↗',()=>openRows(c.name+' · '+label,rows,cartera,back));
    const section=(title,items,extra='')=>'<section class="profile-section"><h3>'+esc(title)+'</h3><dl>'+items+'</dl>'+extra+'</section>';
    let body=section('Datos del cliente',field('Código',p.code??c.id)+field('Identificación fiscal',p.tax_id)+field('Zona',c.zone)+
      field('Dirección',p.address)+field('Contacto',p.contact)+field('Correo',p.email));
    body+=section('Facturación del período',field('Ventas netas',money(sum(c.sales)))+field('Facturas emitidas',invoiceCount)+
      field('Producto con mayor venta neta',top?top.docs[0].name:'Sin ventas en el período')+
      (top?field('Venta neta del producto',money(top.value)):''),documents('Ver documentos de ventas',c.sales));
    if(ar){
      body+=section('Cartera al '+day(filter.end),field('Saldo pendiente',money(sum(c.ar)))+
        field('Saldo vencido',money(sum(c.ar.filter(overdue)))),documents('Ver documentos de cartera',c.ar,true));
      const credit=data.credit_line.find(l=>l.customer===c.id&&l.currency===filter.curr);
      if(credit?.limit_cents>0){
        const whole=balances(companyDocs.filter(d=>d.customer===c.id&&d.currency===filter.curr),filter.end);
        const used=Math.max(0,sum(whole)),limit=credit.limit_cents;
        body+=section('Línea de crédito · '+filter.curr,field('Límite autorizado',money(limit))+field('Consumido al corte',money(used))+
          field('Disponible',money(Math.max(0,limit-used)))+(used>limit?field('Exceso sobre el límite',money(used-limit)):''),
          '<p class="hint">El consumo corresponde al saldo pendiente del cliente en toda la empresa, al '+day(filter.end)+'.</p>'+documents('Ver respaldo del consumo',whole,true));
      }else body+=section('Línea de crédito',field('Condición en '+filter.curr,credit?'Sin crédito autorizado':'Sin información de crédito'));
    }
    show(c.name,'FICHA DE CLIENTE',body);
  }
  function card(c){
    const initials=c.name.split(/\s+/).slice(0,2).map(w=>w[0]).join('');
    return '<button class="directory-card directory-row" data-a="'+action(()=>profile(c))+'"><span class="row-name"><span class="monogram">'+esc(initials)+'</span><strong>'+esc(c.name)+'</strong></span><span class="row-city">'+esc(c.zone)+'</span>'+
      '<span class="row-number"><small>Ventas</small>'+money(sum(c.sales))+'</span>'+
      (ar?'<span class="row-number"><small>Pendiente</small>'+money(sum(c.ar))+'</span>':'')+'<span class="row-open" aria-hidden="true">↗</span></button>';
  }
  const grid=rows=>rows.length?'<div class="client-list '+(ar?'with-ar':'')+'"><div class="directory-labels" aria-hidden="true"><span>Cliente</span><span>Ciudad o zona</span><span>Ventas del período</span>'+(ar?'<span>Saldo pendiente</span>':'')+'<span></span></div>'+rows.map(card).join('')+'</div>':'<p class="empty">Sin clientes para estos filtros.</p>';
  function tab(id,label){
    const selected=activeTab===id;
    const change=action(()=>{activeTab=id;refresh();document.getElementById('tab-'+id).focus({preventScroll:true})});
    return '<button id="tab-'+id+'" role="tab" aria-controls="client-panel" aria-selected="'+selected+'" tabindex="'+(selected?0:-1)+'" data-a="'+change+'">'+label+'</button>';
  }
  const tabs='<div class="client-tabs" role="tablist" aria-label="Vistas de clientes">'+tab('directory','Directorio de clientes')+tab('map','Distribución geográfica')+'</div>';
  let content;
  if(activeTab==='directory'){
    content='<p class="directory-title">'+all.length+' clientes</p>'+grid(all);
  }else{
    const map=customerMap(all,filter,ui);
    content=map.html+(map.selection?'<section class="zone-clients" id="zone-clients"><h3>'+esc(map.selection)+'</h3>'+grid(map.visible)+'</section>':'');
  }
  return tabs+'<section role="tabpanel" id="client-panel" aria-labelledby="tab-'+activeTab+'">'+content+'</section>';
}
