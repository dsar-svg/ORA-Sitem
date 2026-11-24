// Runs before first paint: restores the chosen light/dark mode so reloads don't flash the other one.
try{const m=localStorage.getItem('ora.mode');document.documentElement.dataset.mode=['light','dark'].includes(m)?m:'auto';}catch{document.documentElement.dataset.mode='auto';}
