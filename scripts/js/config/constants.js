(function(){
  try{
    if (!window.jQuery) {
      try {
        const xhr = new XMLHttpRequest();
        xhr.open('GET', '/includes/lib/jquery/3.7.1/jquery.min.js', false);
        xhr.send(null);
        if (xhr.status >= 200 && xhr.status < 400 && typeof xhr.responseText === 'string') {
          // eslint-disable-next-line no-eval
          eval(xhr.responseText);
          if (typeof window.jQuery !== 'undefined' && typeof window.$ === 'undefined') {
            window.$ = window.jQuery;
          }
        }
      } catch(_){ /* ignore */ }
    }
    if (typeof window.jQuery !== 'undefined' && typeof window.$ === 'undefined') {
      window.$ = window.jQuery;
    }
    if (!window.APP_VERSION) window.APP_VERSION = '20250925';
    if (!window.API_BASE_URL) window.API_BASE_URL = '/php/api';
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
        let last = 0; const cooldownMs = 8000; // avoid log storms
        return function(err){
          const now = Date.now();
          if (now - last < cooldownMs) return;
          last = now;
          if (window.__DEBUG && console && typeof console.error === 'function') {
            console.error('Global error caught', err);
          }
        };
      })();
      window.addEventListener('unhandledrejection', function(evt){ showOnce(evt && evt.reason); });
      window.addEventListener('error', function(evt){ showOnce(evt && evt.error); }, true);
    }
  }catch(_){ /* ignore */ }
})();
