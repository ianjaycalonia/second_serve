(function(){
  'use strict';
  const root = (typeof window !== 'undefined') ? window : globalThis;

  function ensureBase(){
    if (!root.API_BASE_URL) root.API_BASE_URL = '/Capstone%20Project/php/api';
  }

  async function parseJsonLenient(res){
    const ct = (res.headers.get('content-type')||'').toLowerCase();
    if (ct.includes('application/json')){
      try { return await res.json(); } catch(_) { /* fallthrough */ }
    }
    const text = await res.text();
    try { return JSON.parse(text); } catch(_){
      const snippet = text && text.slice ? text.slice(0, 300) : '';
      const err = new Error(`Non-JSON response (HTTP ${res.status}). Snippet: ${snippet}`);
      err.status = res.status;
      throw err;
    }
  }

  async function fetchJson(url, options){
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
      throw err;
    }
    return data;
  }

  root.fetchJson = fetchJson;
})();
