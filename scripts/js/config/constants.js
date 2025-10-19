(function(){
  try{
    if (!window.APP_VERSION) window.APP_VERSION = '20250925';
    if (!window.API_BASE_URL) window.API_BASE_URL = '/Capstone%20Project/php/api';
    // Set this to the actual recipient_id of the Foodbank (must exist in Users as an approved recipient)
    if (typeof window.FOOD_BANK_RECIPIENT_ID === 'undefined') window.FOOD_BANK_RECIPIENT_ID = 1;

    // Demo-safe defaults applied across all pages
    if (typeof window.__DEBUG === 'undefined') window.__DEBUG = false;
    if (!window.__DEBUG){
      try {
        const noop = function(){};
        if (console && typeof console.debug === 'function') console.debug = noop;
        if (console && typeof console.info === 'function') console.info = noop;
        if (console && typeof console.log === 'function') console.log = noop;
        if (console && typeof console.warn === 'function') console.warn = noop;
      } catch(_){}
    }

    // Global generic error alert fallback (applies to all pages)
    if (!window.__GLOBAL_ERROR_HANDLER_BOUND__){
      window.__GLOBAL_ERROR_HANDLER_BOUND__ = true;
      const showOnce = (function(){
        let last = 0; const cooldownMs = 8000; // avoid alert storms
        return function(){
          const now = Date.now();
          if (now - last < cooldownMs) return; last = now;
          try { alert('Something went wrong, please try again.'); } catch(_){ }
        };
      })();
      window.addEventListener('unhandledrejection', function(){ showOnce(); });
      window.addEventListener('error', function(){ showOnce(); }, true);
    }
  }catch(_){ /* ignore */ }
})();
