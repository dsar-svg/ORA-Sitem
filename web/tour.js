const sections={
  sales:['Ventas',['.sales-summary .primary','Facturación neta','Abre el importe para ver las facturas y las notas de crédito que lo componen.','summary'],['#docSearch','Documentos','Busca un número de factura o el nombre del cliente.','docs'],['#viewExport summary','Exportar','Descarga las filas filtradas en Excel o PDF con la paleta activa.','docs']],
  ar:['Cobranza',['.kpis .primary','Cuentas por cobrar','Selecciona un saldo para revisar sus documentos y vencimientos.','summary'],['.statement-focus','Estados de cuenta','Elige el cliente en los filtros y revisa el saldo final y el vencido al corte.','statement']],
  clients:['Clientes',['.client-tabs','Directorio y mapa','Alterna entre el directorio y el mapa para explorar clientes por zona.'],['.directory-row, .venezuela','Ficha de cliente o zona','Selecciona un cliente para consultar sus ventas y crédito. En el mapa puedes seleccionar una zona para ver sus clientes.']],
  inventory:['Inventario',['.kpis','Inventario','Filtra por almacén o producto para revisar existencias y rotación al corte.','summary'],['#restockControls','Reposición','Ajusta el consumo, el plazo y la seguridad. Abre una sugerencia para revisar su cálculo.','restock']]
};
const subviews={
  docs:{name:'Documentos',module:'sales',steps:[['#docSearch','Buscar un documento','Escribe un número o un cliente y ajusta las fechas de emisión.'],['#dashboard tbody .link','Respaldo de la factura','Abre la referencia para comparar el importe del reporte con el total del documento.'],['#viewExport summary','Exportar documentos','Descarga todos los resultados de la búsqueda con los filtros activos.']]},
  statement:{name:'Estados de cuenta',module:'ar',steps:[['.statement-focus','Saldos al corte','Consulta el saldo final y la parte vencida del cliente en la moneda elegida.'],['.statement-breakdown','Desglose del saldo','Despliega la apertura, los cargos, los abonos y las notas del período.'],['#dashboard .panel tbody .link','Movimientos y documentos','Selecciona una referencia para revisar el movimiento que explica el saldo.']]},
  restock:{name:'Reposición',module:'inventory',steps:[['#restockControls','Ajustar el cálculo','Elige los meses de consumo y ajusta el plazo o el stock de seguridad para este análisis.'],['.restock-table tbody .link','Fundamento de la sugerencia','Selecciona el producto para consultar reservas, recepciones y punto de reposición.'],['#viewExport summary','Exportar sugerencias','Comparte las sugerencias filtradas con quien revisa las compras.']]}
};
export function initTour({user,modules,state,navigate,restore}){
  const $=id=>document.getElementById(id);
  const key='ora.tour.v1.'+user;
  const visible=e=>e.getClientRects().length>0&&getComputedStyle(e).visibility==='visible';
  let progress={};
  try{progress=JSON.parse(localStorage.getItem(key))||{}}catch{}
  const save=()=>{try{localStorage.setItem(key,JSON.stringify(progress))}catch{}};
  const dialog=$('tour'),card=$('tourCard'),spot=$('tourSpot');
  let steps=[],index=0,course='general',target=null,origin=null,previous=null,fromMenu=false;
  const allowed=Object.keys(sections).filter(k=>modules.includes(k));
  function sequence(which){
    if(Object.hasOwn(subviews,which)){
      const {module,steps}=subviews[which];
      return steps.map(([selector,title,text])=>[module,selector,title,text,which]);
    }
    const list=[];
    if(which==='general'){
      list.push([null,'#sidebar nav, #navOpen','Navegación','Abre el menú para cambiar entre los reportes habilitados en tu plan.']);
      list.push(['sales','.filters','Período y filtros','Elige período y moneda. Los filtros secundarios acotan las cifras y sus documentos.','summary']);
    }
    for(const mod of which==='general'?allowed:[which]){
      if(!allowed.includes(mod))continue;
      for(const [sel,title,text,tab] of sections[mod].slice(1))list.push([mod,sel,title,text,tab]);
    }
    if(which==='general')list.push([null,'#accountMenu summary, #navOpen','Apariencia','Desde el perfil al pie del menú puedes cambiar la paleta y el acento de los reportes y las descargas.']);
    return list;
  }
  function position(){
    if(!dialog.open||!target)return;
    const r=target.getBoundingClientRect(),pad=4;
    Object.assign(spot.style,{left:Math.max(0,r.left-pad)+'px',top:Math.max(0,r.top-pad)+'px',width:Math.min(innerWidth,r.width+pad*2)+'px',height:Math.min(innerHeight,r.height+pad*2)+'px'});
    const h=card.offsetHeight,w=card.offsetWidth;
    const y=r.bottom+h+20<innerHeight?r.bottom+12:r.top-h-12;
    card.style.left=Math.max(8,Math.min(r.left,innerWidth-w-8))+'px';
    card.style.top=Math.max(8,Math.min(y,innerHeight-h-8))+'px';
  }
  function showStep(direction){
    while(index>=0&&index<steps.length){
      const [mod,selector,title,text,tab]=steps[index];
      if(mod)navigate(mod,tab);
      target=[...document.querySelectorAll(selector)].find(e=>visible(e)&&e.getBoundingClientRect().height>0);
      if(target){
        target.scrollIntoView({block:'nearest',behavior:'instant'});
        $('tourTitle').textContent=title;$('tourText').textContent=text;
        $('tourCount').textContent=courseName(course)+' · '+(index+1)+' / '+steps.length;
        $('tourPrev').disabled=index===0;$('tourNext').textContent=index===steps.length-1?'Finalizar':'Siguiente';
        progress[course]={step:index};save();spot.hidden=false;position();$('tourNext').focus({preventScroll:true});return;
      }
      index+=direction;
    }
    if(index<0){index=0;showStep(1)}else finish(true);
  }
  function finish(done){
    if(done){progress[course]={done:true};save()}
    if(previous)restore(previous);
    target=null;dialog.close();
    if(done&&course==='general')$('tourOffer').hidden=true;
    if(fromMenu){
      if(matchMedia('(max-width:800px)').matches&&!$('mobileNav').open)$('mobileNav').showModal();
      $('accountMenu').open=true;
    }
    const fallback=visible($('navOpen'))?$('navOpen'):$('accountMenu').querySelector('summary');
    (origin?.isConnected&&visible(origin)?origin:fallback).focus({preventScroll:true});
    if(previous)window.scrollTo({left:previous.scroll[0],top:previous.scroll[1],behavior:'instant'});
  }
  function start(which){
    course=which;steps=sequence(which);index=Math.min(progress[which]?.step||0,steps.length-1);
    $('tourCourses').hidden=true;$('tourSteps').hidden=false;
    showStep(1);
  }
  function open(menu){
    previous={...state(),scroll:[scrollX,scrollY]};origin=menu?$('openTour'):$('tourStart');fromMenu=menu;
    $('accountMenu').open=false;if($('mobileNav').open)$('mobileNav').close();
    dialog.showModal();
    if(!menu){start('general');return}
    target=null;spot.hidden=true;
    $('tourCourses').hidden=false;$('tourSteps').hidden=true;
    card.style.cssText='left:50%;top:50%;transform:translate(-50%,-50%)';
    $('tourCourses').querySelector('button').focus();
  }
  function courseName(id){return id==='general'?'Recorrido general':subviews[id]?.name||sections[id][0]}
  for(const mod of ['general',...allowed.flatMap(m=>[m,...Object.keys(subviews).filter(k=>subviews[k].module===m)])]){
    const b=document.createElement('button');b.textContent=courseName(mod);
    b.onclick=()=>{card.style.transform='';start(mod)};$('courseList').append(b);
  }
  $('tourOffer').hidden=!!progress.general?.done;
  $('tourStart').onclick=()=>{card.style.transform='';open(false)};
  $('tourDismiss').onclick=()=>{progress.general={done:true};save();$('tourOffer').hidden=true;$('period-control').focus()};
  $('openTour').onclick=()=>open(true);
  $('tourPrev').onclick=()=>{index--;showStep(-1)};
  $('tourNext').onclick=()=>{index++;showStep(1)};
  $('tourSkip').onclick=()=>finish(true);
  $('tourCancel').onclick=()=>finish(false);
  dialog.oncancel=e=>{e.preventDefault();finish(false)};
  dialog.addEventListener('keydown',e=>{
    if(e.key!=='Tab')return;
    const buttons=[...card.querySelectorAll('button:not(:disabled)')].filter(b=>visible(b));
    const first=buttons[0],last=buttons.at(-1);
    if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}
    else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}
  });
  window.addEventListener('resize',()=>{if(!dialog.open||!target)return;if(!visible(target))showStep(1);else position()});
  window.addEventListener('scroll',position,true);
}
