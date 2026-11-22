const fold = text => text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('es');
export function enhanceFilters(){
  let closeActive=()=>{};
  for(const select of document.querySelectorAll('.filters select')){
    const name=select.getAttribute('aria-label');
    const search=['product','stockProduct','statementCustomer'].includes(select.id) || select.length>15;
    const input=document.createElement('input');
    input.id=select.id+'-control';
    input.setAttribute('role','combobox');
    input.setAttribute('aria-label',name);
    input.setAttribute('aria-expanded','false');
    input.setAttribute('aria-autocomplete',search?'list':'none');
    input.autocomplete='off';
    input.readOnly=!search;
    input.placeholder=search?'Buscar '+name.toLowerCase()+'…':name;
    select.hidden=true;
    select.after(input);
    const arrow=document.createElement('span');
    arrow.className='chevron';
    arrow.setAttribute('aria-hidden','true');
    input.after(arrow);
    const list=document.createElement('div');
    list.className='choices';
    list.id=select.id+'-options';
    input.setAttribute('aria-controls',list.id);
    list.setAttribute('role','listbox');
    list.setAttribute('aria-label',name);
    list.hidden=true;
    document.body.append(list);
    let matches=[],active=-1;
    function sync(){
      const label=select.selectedOptions[0]?.text??'';
      input.value=label;
      input.style.width=Math.min(29,Math.max(6,label.length+2))+'ch';
    }
    function position(){
      if(list.hidden)return;
      const b=input.parentElement.getBoundingClientRect();
      const below=innerHeight-b.bottom-12,above=b.top-12;
      const up=below<Math.min(list.scrollHeight,260) && above>below;
      list.style.width=Math.min(innerWidth-16,Math.max(225,b.width))+'px';
      list.style.left=Math.max(8,Math.min(b.left,innerWidth-list.offsetWidth-8))+'px';
      list.style.maxHeight=Math.min(270,Math.max(40,up?above:below))+'px';
      list.style.top=(up?Math.max(6,b.top-list.offsetHeight-5):b.bottom+5)+'px';
    }
    function highlight(index){
      active=Math.max(0,Math.min(index,matches.length-1));
      [...list.children].forEach((el,i)=>el.classList.toggle('focused',i===active));
      if(matches.length){
        input.setAttribute('aria-activedescendant',list.children[active].id);
        list.children[active].scrollIntoView({block:'nearest'});
      }else input.removeAttribute('aria-activedescendant');
    }
    function draw(query=''){
      matches=[...select.options].filter(o=>fold(o.text).includes(fold(query)));
      list.replaceChildren();
      for(const [i,option] of matches.entries()){
        const row=document.createElement('div');
        row.id=list.id+'-'+i;
        row.setAttribute('role','option');
        row.setAttribute('aria-selected',String(option.selected));
        row.textContent=option.text;
        row.onmousedown=e=>e.preventDefault();
        row.onclick=()=>choose(i);
        list.append(row);
      }
      if(!matches.length)list.textContent='Sin coincidencias';
      position();
      highlight(query?0:matches.findIndex(o=>o.selected));
    }
    function close(){
      list.hidden=true;input.setAttribute('aria-expanded','false');
      input.removeAttribute('aria-activedescendant');sync();
    }
    function open(){
      if(!list.hidden)return;
      input.focus();
      closeActive();closeActive=close;
      list.hidden=false;input.setAttribute('aria-expanded','true');
      if(search)input.value='';
      draw();
    }
    function choose(i){
      if(!matches[i])return;
      select.value=matches[i].value;
      close();input.focus();select.dispatchEvent(new Event('change',{bubbles:true}));
    }
    input.onfocus=()=>{if(search)input.select()};
    input.onclick=()=>open();
    input.parentElement.onclick=e=>{
      e.preventDefault();
      if(e.target!==input){input.focus();open()}
    };
    input.oninput=()=>{const q=input.value;open();input.value=q;draw(q)};
    input.onkeydown=e=>{
      if(e.key==='Escape'&&!list.hidden){e.preventDefault();e.stopPropagation();close();return}
      if(e.key==='Tab'){close();return}
      if(e.key==='Enter'||(!search&&e.key===' ')){
        e.preventDefault();if(list.hidden)open();else choose(active);return;
      }
      if(['ArrowUp','ArrowDown','Home','End'].includes(e.key)){
        if(search&&list.hidden&&['Home','End'].includes(e.key))return;
        e.preventDefault();
        if(list.hidden){open();return}
        highlight(e.key==='Home'?0:e.key==='End'?matches.length-1:active+(e.key==='ArrowDown'?1:-1));
      }
    };
    input.onblur=()=>close();
    select.addEventListener('change',sync);
    window.addEventListener('resize',position);
    window.addEventListener('scroll',e=>{if(!list.contains(e.target))position()},true);
    sync();
  }
}
export function setupNavigation(){
  const $=id=>document.getElementById(id),sidebar=$('sidebar'),drawer=$('mobileNav');
  const narrow=matchMedia('(max-width:800px)');
  function place(){
    if(drawer.open)drawer.close();
    if(narrow.matches)drawer.append(sidebar);
    else document.body.prepend(sidebar);
  }
  $('navOpen').onclick=()=>drawer.showModal();
  $('navClose').onclick=()=>drawer.close();
  sidebar.querySelector('nav').addEventListener('click',e=>{if(e.target.closest('button')&&drawer.open)drawer.close()});
  narrow.addEventListener('change',place);place();
}
