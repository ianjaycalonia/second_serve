(function(){
  'use strict';
  const root = (typeof window !== 'undefined') ? window : globalThis;

  function ensureToast(){
    if (root.showToast && typeof root.showToast === 'function') return;
    let host = document.getElementById('globalToastHost');
    if (!host){
      host = document.createElement('div');
      host.id = 'globalToastHost';
      host.style.position = 'fixed';
      host.style.top = '1rem';
      host.style.right = '1rem';
      host.style.zIndex = '1080';
      host.style.display = 'flex';
      host.style.flexDirection = 'column';
      host.style.gap = '0.5rem';
      document.body.appendChild(host);
    }
    root.showToast = function(message, type){
      try{
        const msg = String(message || '');
        const variant = (type || 'danger').toLowerCase();
        const useBs = !!(root.bootstrap && root.bootstrap.Toast);
        const wrap = document.createElement('div');
        if (useBs){
          wrap.className = 'toast align-items-center text-bg-' + (variant === 'success' ? 'success' : (variant === 'info' ? 'info' : (variant === 'warning' ? 'warning' : 'danger')));
          wrap.setAttribute('role','alert');
          wrap.setAttribute('aria-live','assertive');
          wrap.setAttribute('aria-atomic','true');
          wrap.innerHTML = '<div class="d-flex"><div class="toast-body">'+msg+'</div><button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button></div>';
          host.appendChild(wrap);
          const t = root.bootstrap.Toast.getOrCreateInstance(wrap, { delay: 4000 });
          t.show();
          setTimeout(()=>{ try{ wrap.remove(); }catch(_){ } }, 5000);
        } else {
          wrap.style.background = (variant==='success')?'#198754':(variant==='info')?'#0dcaf0':(variant==='warning')?'#ffc107':'#dc3545';
          wrap.style.color = '#fff';
          wrap.style.padding = '10px 12px';
          wrap.style.borderRadius = '6px';
          wrap.style.boxShadow = '0 2px 8px rgba(0,0,0,0.2)';
          wrap.textContent = msg;
          host.appendChild(wrap);
          setTimeout(()=>{ try{ wrap.remove(); }catch(_){ } }, 4000);
        }
      } catch(_){ }
    };
    if (!root._origAlert){
      try{
        root._origAlert = root.alert;
        root.alert = function(msg){ root.showToast(msg, 'danger'); };
      } catch(_){ }
    }
  }

  function ensureBase(){
    if (!root.API_BASE_URL) root.API_BASE_URL = '/Capstone%20Project/php/api';
  }

  async function parseJsonLenient(res){
    const ct = (res.headers.get('content-type')||'').toLowerCase();
    if (ct.includes('application/json')){
      try { return await res.json(); } catch(_) { /* fallthrough */ }
    }
    const _ = await res.text();
    // Hide raw body; return generic error structure
    const err = new Error(`HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }

  async function fetchJson(url, options){
    try{ ensureToast(); }catch(_){ }
    ensureBase();
    const opts = options || {};
    const headers = Object.assign({ 'Accept': 'application/json' }, opts.headers||{});
    const final = Object.assign({}, opts, { headers, credentials: opts.credentials || 'include' });
    const res = await fetch(url, final);
    const data = await parseJsonLenient(res);
    if (!res.ok || (data && data.success === false)){
      const msg = (data && (data.error || data.message)) || `HTTP ${res.status}`;
      const err = new Error(msg);
      err.status = res.status;
      err.response = data;
      try{ root.showToast(`Something went wrong. ${msg}`, 'danger'); }catch(_){ }
      throw err;
    }
    return data;
  }

  root.fetchJson = fetchJson;
})();
