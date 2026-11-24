// Sober variants: neutral ground, one accent for what can be pressed, a grey that still reads for the previous period.
const palettes = {
  Pizarra:{accent:'#2f5bd3',secondary:'#878f9b',paper:'#f5f6f7',surface:'#ffffff',nav:'#ffffff'},
  Pino:{accent:'#1f7a55',secondary:'#86908a',paper:'#f4f5f3',surface:'#ffffff',nav:'#ffffff'},
  Coral:{accent:'#d9532b',secondary:'#948a84',paper:'#f6f5f3',surface:'#ffffff',nav:'#ffffff'}
};
const rgb = color => [1,3,5].map(i=>parseInt(color.slice(i,i+2),16));
function luminance(c){
  const v=rgb(c).map(n=>n/255).map(n=>n<=0.04045?n/12.92:((n+0.055)/1.055)**2.4);
  return v[0]*0.2126+v[1]*0.7152+v[2]*0.0722;
}
function ratio(a,b){
  const x=luminance(a),y=luminance(b);
  return (Math.max(x,y)+0.05)/(Math.min(x,y)+0.05);
}
function accessibleAccent(input,p){
  let color=input;
  while(Math.min(ratio(color,p.paper),ratio(color,p.surface),ratio(color,'#eeeeea'))<4.5){
    color='#'+rgb(color).map(v=>Math.floor(v*0.94).toString(16).padStart(2,'0')).join('');
  }
  return color;
}
export function initAppearance(profile='demo-local'){
  const $=id=>document.getElementById(id), key='ora.appearance.v3.'+profile;
  let choice={palette:'Pizarra',accent:palettes.Pizarra.accent};
  try{
    const saved=JSON.parse(localStorage.getItem(key));
    if(saved && Object.hasOwn(palettes,saved.palette) && /^#[0-9a-f]{6}$/i.test(saved.accent)) choice=saved;
  }catch{}
  for(const [name,p] of Object.entries(palettes)){
    const button=document.createElement('button');
    button.dataset.palette=name;
    button.innerHTML='<span class="swatches">'+[p.accent,p.secondary,p.paper].map(color=>'<i style="background:'+color+'"></i>').join('')+'</span>'+name;
    button.onclick=()=>apply({palette:name,accent:p.accent});
    $('palettes').append(button);
  }
  function apply(next,save=true){
    choice=next;
    const p=palettes[choice.palette],accent=accessibleAccent(choice.accent,p);
    const fill=choice.accent,vars={plum:accent,fill,'on-fill':ratio(fill,'#ffffff')>=ratio(fill,'#1c1e21')?'#ffffff':'#1c1e21',paper:p.paper,white:p.surface,nav:p.nav,peach:p.secondary};
    for(const [k,v] of Object.entries(vars)){
      document.documentElement.style.setProperty('--'+k,v);
    }
    try{localStorage.setItem('ora.appearance.boot3',JSON.stringify(vars))}catch{}
    document.documentElement.dataset.palette=choice.palette;
    document.querySelectorAll('[data-palette]').forEach(b=>{
      if(b.tagName==='BUTTON') b.setAttribute('aria-pressed',b.dataset.palette===choice.palette);
    });
    $('accent').value=choice.accent;
    $('contrast').textContent=(accent!==choice.accent?'Acento ajustado a '+accent+' para mantener la legibilidad. ':'')+
      'Contraste mínimo del acento: '+Math.min(ratio(accent,p.paper),ratio(accent,p.surface),ratio(accent,'#ffffff')).toFixed(1)+' a 1.';
    if(save){try{localStorage.setItem(key,JSON.stringify(choice))}catch{$('contrast').textContent+=' Preferencia disponible solo en esta sesión.'}}
  }
  $('openAppearance').onclick=()=>{$('accountMenu').open=false;$('appearance').showModal()};
  $('closeAppearance').onclick=()=>$('appearance').close();
  $('appearance').addEventListener('close',()=>$('accountMenu').querySelector('summary').focus());
  $('accent').oninput=e=>apply({...choice,accent:e.target.value});
  $('resetTheme').onclick=()=>apply({palette:'Pizarra',accent:palettes.Pizarra.accent});
  apply(choice,false);
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
