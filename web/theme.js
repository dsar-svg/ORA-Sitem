// Appearance is a mode (light, dark or the device's choice); colors live in style.css so both modes stay designed.
const MODES={auto:'Automático',light:'Claro',dark:'Oscuro'};
const rgb = color => [1,3,5].map(i=>parseInt(color.slice(i,i+2),16));
function luminance(c){
  const v=rgb(c).map(n=>n/255).map(n=>n<=0.04045?n/12.92:((n+0.055)/1.055)**2.4);
  return v[0]*0.2126+v[1]*0.7152+v[2]*0.0722;
}
function ratio(a,b){
  const x=luminance(a),y=luminance(b);
  return (Math.max(x,y)+0.05)/(Math.min(x,y)+0.05);
}
export function initAppearance(){
  const $=id=>document.getElementById(id), key='ora.mode';
  let mode='auto';
  try{ if(Object.hasOwn(MODES,localStorage.getItem(key))) mode=localStorage.getItem(key); }catch{}
  for(const [value,label] of Object.entries(MODES)){
    const button=document.createElement('button');
    button.dataset.mode=value;
    button.innerHTML='<span class="mode-swatch mode-'+value+'"></span>'+label;
    button.onclick=()=>apply(value);
    $('palettes').append(button);
  }
  function apply(next,save=true){
    mode=next;
    document.documentElement.dataset.mode=mode;
    document.querySelectorAll('#palettes [data-mode]').forEach(b=>b.setAttribute('aria-pressed',b.dataset.mode===mode));
    if(save){try{localStorage.setItem(key,mode)}catch{}}
  }
  $('openAppearance').onclick=()=>{$('accountMenu').open=false;$('appearance').showModal()};
  $('closeAppearance').onclick=()=>$('appearance').close();
  $('appearance').addEventListener('close',()=>$('accountMenu').querySelector('summary').focus());
  $('resetTheme').onclick=()=>apply('auto');
  apply(mode,false);
}
/* Freeze the resolved appearance at download time for both file formats. */
export function exportBrand(){
  const css=getComputedStyle(document.documentElement);
  const canvas=document.createElement('canvas');
  canvas.width=canvas.height=160;
  const ctx=canvas.getContext('2d');
  function color(token){
    ctx.fillStyle=css.getPropertyValue('--'+token).trim();
    ctx.fillRect(0,0,1,1);
    return '#'+[...ctx.getImageData(0,0,1,1).data].slice(0,3).map(x=>x.toString(16).padStart(2,'0')).join('');
  }
  const accent=color('plum'),surface=color('white'),paper=color('paper'),secondary=color('peach');
  const light=ratio(surface,accent)>=4.5?surface:'#ffffff';
  const foreground=ratio(light,accent)>=ratio('#181318',accent)?light:'#181318';
  ctx.clearRect(0,0,160,160);
  ctx.strokeStyle=foreground;ctx.lineWidth=18;
  ctx.beginPath();ctx.roundRect(20,20,120,120,25);ctx.stroke();
  ctx.clearRect(110,0,50,48);
  ctx.fillStyle=secondary;ctx.fillRect(124,10,24,24);
  ctx.fillStyle=foreground;ctx.beginPath();ctx.arc(80,80,11,0,Math.PI*2);ctx.fill();
  return {accent,secondary,foreground,paper,surface,logo:canvas.toDataURL('image/png'),signature:'Generado con ORA'};
}
