const source='/cartography/VEN-ADM1-9469f09.geojson';
const W=640,H=410;
const ranges=['0','1','2','3–4','5+'];
const level=n=>n<=2?n:n<=4?3:4;
const view={mode:'city',pick:null,zoom:1,panX:0,panY:0,signature:null};
let atlas,load,error;
const memberships=new Map();

export function resetMap(){
  Object.assign(view,{mode:'city',pick:null,zoom:1,panX:0,panY:0,signature:null});
}
function resetCamera(){
  view.zoom=1;
  view.panX=0;
  view.panY=0;
}
function extent(points){
  let west=Infinity,east=-Infinity,south=Infinity,north=-Infinity;
  for(const [x,y] of points){
    west=Math.min(west,x);east=Math.max(east,x);
    south=Math.min(south,y);north=Math.max(north,y);
  }
  return {west,east,south,north};
}
function prepare(collection){
  const states=collection.features.map(({properties,geometry})=>{
    const polys=geometry.type==='Polygon'?[geometry.coordinates]:geometry.coordinates;
    const points=polys.flat(2);
    const path=polys.map(poly=>poly.map(ring=>'M'+ring.map(([x,y])=>x.toFixed(4)+' '+y.toFixed(4)).join('L')+'Z').join('')).join('');
    return {id:properties.shapeID,name:properties.shapeName,polys,box:extent(points),path};
  });
  return {states,box:extent(states.flatMap(s=>[[s.box.west,s.box.south],[s.box.east,s.box.north]]))};
}
function inRing(x,y,ring){
  let inside=false;
  for(let i=0,j=ring.length-1;i<ring.length;j=i++){
    const [a,b]=ring[i],[c,d]=ring[j];
    if((b>y)!==(d>y) && x<(c-a)*(y-b)/(d-b)+a)inside=!inside;
  }
  return inside;
}
function stateAt(x,y){
  const key=x+','+y;
  if(!memberships.has(key)){
    const match=atlas.states.find(({box,polys})=>x>=box.west&&x<=box.east&&y>=box.south&&y<=box.north&&
      polys.some(([outer,...holes])=>inRing(x,y,outer)&&!holes.some(h=>inRing(x,y,h))));
    memberships.set(key,match?.id);
  }
  return memberships.get(key);
}
function center(rows){
  const average=k=>rows.reduce((n,c)=>n+c[k],0)/rows.length;
  return [average('longitude'),average('latitude')];
}
function camera(box,zoom,local){
  const x=(box.west+box.east)/2,y=(box.south+box.north)/2;
  const horizontal=Math.max(local ? 0.65 : 0.01,box.east-box.west);
  const vertical=Math.max(local ? 0.5 : 0.01,box.north-box.south);
  const aspect=1/Math.cos(y*Math.PI/180);
  const scale=Math.min((W-90)/horizontal,(H-64)/(vertical*aspect))*zoom;
  const cx=W/2+view.panX,cy=H/2+view.panY;
  return {xy:(lon,lat)=>[cx+(lon-x)*scale,cy-(lat-y)*scale*aspect],
    transform:'translate('+cx+' '+cy+') scale('+scale+' '+(-scale*aspect)+') translate('+(-x)+' '+(-y)+')'};
}
const isLocated=c=>Number.isFinite(c.longitude)&&Number.isFinite(c.latitude);
function titleCount(name,count){return name+' · '+count+(count===1?' cliente':' clientes')}
export function customerMap(all,filter,ui){
  const {action,esc,refresh}=ui;
  if(view.signature!==JSON.stringify(filter)){
    view.signature=JSON.stringify(filter);
    view.pick=filter.zone?{kind:'city',id:filter.zone,name:filter.zone}:null;
    resetCamera();
  }
  function redraw(key){
    refresh();
    if(key)document.querySelector('[data-focus="'+CSS.escape(key)+'"]')?.focus({preventScroll:true});
  }
  function select(kind,id,name,key){
    view.pick={kind,id,name};resetCamera();redraw(key);
  }
  function clear(){view.pick=null;resetCamera();redraw('national')}
  if(!atlas&&!load&&!error){
    load=fetch(source).then(r=>{if(!r.ok)throw Error();return r.json()}).then(g=>{atlas=prepare(g)})
      .catch(()=>{error=true}).finally(()=>{load=null;refresh()});
  }
  const located=all.filter(isLocated);
  const pick=view.pick;
  const visible=all.filter(c=>!pick||(pick.kind==='client'?c.id===pick.id:pick.kind==='city'?c.zone===pick.id:
    atlas&&isLocated(c)&&stateAt(c.longitude,c.latitude)===pick.id));
  const selection=pick?titleCount(pick.name,visible.length):'';
  const controls={visible,selection,clear,selectClient:c=>select('client',c.id,c.name,'client-'+c.id)};
  const fallback=error?'No se pudo cargar la cartografía. <button class="link" data-a="'+action(()=>{error=false;refresh()})+'">Reintentar</button>':'Cargando cartografía…';
  if(!atlas)return {...controls,html:'<article class="panel"><h2>Distribución geográfica</h2><p role="status">'+fallback+'</p></article>'};
  const city=view.mode==='city',groups=new Map(),states=new Map();
  for(const c of located){
    const state=stateAt(c.longitude,c.latitude);
    if(state){if(!states.has(state))states.set(state,[]);states.get(state).push(c)}
    if(!groups.has(c.zone))groups.set(c.zone,[]);groups.get(c.zone).push(c);
  }
  const target=pick?.kind==='state'?atlas.states.find(s=>s.id===pick.id)?.box:null;
  const points=visible.filter(isLocated).map(c=>[c.longitude,c.latitude]);
  const box=target??(pick&&points.length?extent(points):atlas.box);
  const projection=camera(box,view.zoom,!!pick);
  function attributes(key,label,selected,callback){
    return ' role="button" tabindex="0" aria-label="'+esc(label)+'" aria-pressed="'+selected+'" data-focus="'+esc(key)+'" data-a="'+action(callback)+'"';
  }
  function pickState(s,key){view.mode='state';select('state',s.id,s.name,key)}
  const orderedStates=[...atlas.states].sort((a,b)=>Number(a.id===pick?.id)-Number(b.id===pick?.id));
  const shapes=orderedStates.map(s=>{
    const count=states.get(s.id)?.length??0,selected=pick?.kind==='state'&&pick.id===s.id;
    const key='state-'+s.id,label=titleCount(s.name,count);
    return '<g class="territory '+(selected?'selected':'')+'" data-level="'+level(city?0:count)+'"'+attributes(key,label,selected,()=>pickState(s,key))+'><title>'+esc(label)+'</title><path vector-effect="non-scaling-stroke" fill-rule="evenodd" d="'+s.path+'"/></g>';
  }).join('');
  const markers=[];
  for(const [id,rows] of (city?groups:states)){
    const state=city?null:atlas.states.find(s=>s.id===id),name=state?.name??id;
    const [x,y]=projection.xy(...center(rows));
    if(x<0||x>W||y<0||y>H)continue;
    const width=Math.max(78,Math.min(185,name.length*7+39));
    markers.push({id,rows,name,x,y,width,left:Math.max(4,Math.min(W-width-4,x-width/2)),top:Math.max(8,y-44)});
  }
  // Offset overlapping labels, retaining a leader to each geographic anchor.
  const placed=[];
  for(const m of markers.sort((a,b)=>a.x-b.x)){
    const overlaps=()=>placed.some(p=>m.left<p.left+p.width+3&&m.left+m.width+3>p.left&&Math.abs(m.top-p.top)<28);
    for(let i=0;overlaps()&&i<14;i++)m.top=(m.top+29)%(H-27);
    placed.push(m);
  }
  const pins=placed.map(m=>{
    const key='marker-'+m.id,count=m.rows.length;
    const selected=pick?.kind===(city?'city':'state')&&pick.id===m.id || pick?.kind==='client'&&m.rows.some(c=>c.id===pick.id);
    return '<g class="zone-marker '+(selected?'selected':'')+'" data-level="'+level(count)+'"'+attributes(key,titleCount(m.name,count),!!selected,()=>select(city?'city':'state',m.id,m.name,key))+'>'+
      '<line x1="'+m.x+'" y1="'+m.y+'" x2="'+(m.left+m.width/2)+'" y2="'+(m.top+13)+'"/><circle cx="'+m.x+'" cy="'+m.y+'" r="3"/>'+
      '<rect x="'+m.left+'" y="'+m.top+'" width="'+m.width+'" height="25" rx="8"/><text text-anchor="middle" x="'+(m.left+m.width/2)+'" y="'+(m.top+17)+'">'+esc(m.name)+' · '+count+'</text></g>';
  }).join('');
  const toggle=(mode,label)=>'<button aria-pressed="'+(view.mode===mode)+'" data-focus="'+mode+'" data-a="'+action(()=>{
    view.mode=mode;view.pick=filter.zone?{kind:'city',id:filter.zone,name:filter.zone}:null;resetCamera();redraw(mode);
  })+'">'+label+'</button>';
  const zoom=(factor,label,symbol)=>'<button aria-label="'+label+'" data-focus="'+label+'" data-a="'+action(()=>{const next=Math.min(16,Math.max(.5,view.zoom*factor));view.panX*=next/view.zoom;view.panY*=next/view.zoom;view.zoom=next;redraw(label)})+'">'+symbol+'</button>';
  const precision=city?(located.some(c=>c.precision==='municipality')?'ciudad o municipio':'ciudad'):'estado';
  const html='<article class="panel geo-panel"><h2>Distribución geográfica</h2><p class="hint">Agrupación por '+precision+' · '+(filter.live?'Ubicaciones registradas en Odoo':'Ubicaciones sintéticas')+'</p>'+
    '<div class="mapbar"><div class="mapmode">'+toggle('city','Ciudades')+toggle('state','Estados')+'</div><span>'+located.length+' de '+all.length+' clientes en el mapa</span></div>'+
    '<div class="map venezuela"><div class="maptools">'+zoom(.5,'Alejar mapa','−')+zoom(2,'Acercar mapa','+')+'<button class="country" data-focus="national" data-a="'+action(clear)+'">Venezuela</button></div>'+
    '<svg tabindex="0" viewBox="0 0 '+W+' '+H+'" aria-label="Mapa de Venezuela. Arrastra o usa las flechas para mover. Agrupación por '+precision+'"><g class="pan-layer"><g transform="'+projection.transform+'">'+shapes+'</g>'+pins+'</g></svg></div>'+
    (selection?'<a class="map-selection" href="#zone-clients">Ver '+esc(selection)+' ↓</a>':'')+'<div class="geo-legend"><strong>Clientes por zona</strong>'+ranges.map((r,i)=>'<span data-level="'+i+'"><i></i>'+r+'</span>').join('')+'</div>'+
    '<details class="map-source"><summary aria-label="Información cartográfica" title="Información cartográfica">ⓘ</summary><p class="geo-credit"><a href="https://www.geoboundaries.org/api/current/gbOpen/VEN/ADM1/">geoBoundaries VEN ADM1</a> · OCHA Venezuela / Instituto Nacional de Estadística · <a href="https://creativecommons.org/licenses/by/3.0/igo/">CC BY 3.0 IGO</a></p></details></article>';
  return {...controls,html};
}


export function enableMapPan(svg,refresh){
  if(!svg)return;
  const layer=svg.querySelector('.pan-layer');
  let drag=null;
  function moveBy(dx,dy){
    view.panX+=dx;
    view.panY+=dy;
    refresh();
  }
  svg.onpointerdown=e=>{
    if(!e.isPrimary||e.button!==0)return;
    const matrix=svg.getScreenCTM();
    if(!matrix)return;
    drag={id:e.pointerId,x:e.clientX,y:e.clientY,scale:matrix.a,dx:0,dy:0,moved:false};
  };
  svg.onpointermove=e=>{
    if(!drag||e.pointerId!==drag.id)return;
    const dx=e.clientX-drag.x,dy=e.clientY-drag.y;
    if(!drag.moved){
      if(Math.hypot(dx,dy)<4)return;
      drag.moved=true;
      svg.setPointerCapture(e.pointerId);
      svg.classList.add('dragging');
    }
    drag.dx=dx/drag.scale;
    drag.dy=dy/drag.scale;
    layer.setAttribute('transform','translate('+drag.dx+' '+drag.dy+')');
  };
  function finish(e){
    if(!drag||e.pointerId!==drag.id)return;
    const {moved,dx,dy}=drag;
    drag=null;
    if(!moved)return;
    svg.classList.remove('dragging');
    if(e.type==='pointerup'){
      moveBy(dx,dy);
    }else{
      layer.removeAttribute('transform');
    }
  }
  svg.onpointerup=finish;
  svg.onpointercancel=finish;
  svg.onlostpointercapture=e=>{if(!svg.hasPointerCapture(e.pointerId))finish(e)};
  svg.onpointerleave=()=>{if(drag&&!drag.moved)drag=null};
  svg.onkeydown=e=>{
    if(e.target!==svg)return;
    const step={ArrowLeft:[48,0],ArrowRight:[-48,0],ArrowUp:[0,48],ArrowDown:[0,-48]}[e.key];
    if(!step)return;
    e.preventDefault();
    moveBy(...step);
    document.querySelector('.venezuela svg')?.focus({preventScroll:true});
  };
}
