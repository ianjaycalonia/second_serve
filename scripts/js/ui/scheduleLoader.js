(function(){
  'use strict';
  const root = (typeof window !== 'undefined') ? window : globalThis;
  function getRole(){
    try { if (root.CURRENT_USER_ROLE) return String(root.CURRENT_USER_ROLE).toLowerCase(); } catch(_) {}
    try {
      const raw = root.sessionStorage ? root.sessionStorage.getItem('user') : null;
      if (raw){ const u = JSON.parse(raw); if (u && u.role) return String(u.role).toLowerCase(); }
    } catch(_) {}
    return 'admin';
  }
  function loadScript(src){
    return new Promise((resolve, reject)=>{
      const s = document.createElement('script');
      s.src = src;
      s.onload = ()=> resolve();
      s.onerror = ()=> reject(new Error('Failed to load '+src));
      document.body.appendChild(s);
    });
  }
  async function boot(){
    const allowed = ['admin','donor','recipient'];
    const role = getRole();
    const r = allowed.includes(role) ? role : 'admin';
    // Load role wrapper to define __scheduleAfterCoreInit
    await loadScript(`scripts/js/ui/schedule.${r}.js`);
    // Core is already included on the page; just invoke the hook now
    try { if (typeof root.__scheduleAfterCoreInit === 'function') { root.__scheduleAfterCoreInit(); } } catch(_){ }
  }
  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
