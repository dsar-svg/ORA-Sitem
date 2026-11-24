// Runs before first paint: reapplies the last resolved palette so page reloads don't flash the default theme.
try{
  const vars=JSON.parse(localStorage.getItem('ora.appearance.boot3'))||{};
  for(const [k,v] of Object.entries(vars))if(/^#[0-9a-f]{6}$/i.test(v))document.documentElement.style.setProperty('--'+k,v);
}catch{}
