(function(){
  'use strict';
  const root = (typeof window !== 'undefined') ? window : globalThis;
  const BASE = (root.API_BASE_URL || '/Capstone%20Project/php/api');
  const URL  = `${BASE}/schedule/index.php`;

  function obj(o){ return (o && typeof o === 'object') ? o : {}; }

  const ScheduleAPI = {
    async list(startIso, endIso){
      const url = `${URL}?action=list&start=${encodeURIComponent(startIso)}&end=${encodeURIComponent(endIso)}`;
      return root.fetchJson(url, { method:'GET' });
    },
    async create(payload){
      return root.fetchJson(`${URL}?action=create`, {
        method:'POST', headers:{'Content-Type':'application/json','Accept':'application/json'},
        body: JSON.stringify(obj(payload))
      });
    },
    async update(id, payload){
      return root.fetchJson(`${URL}?action=update&id=${encodeURIComponent(id)}`, {
        method:'PATCH', headers:{'Content-Type':'application/json','Accept':'application/json'},
        body: JSON.stringify(obj(payload))
      });
    },
    async remove(id){
      return root.fetchJson(`${URL}?action=delete&id=${encodeURIComponent(id)}`, {
        method:'DELETE', headers:{'Accept':'application/json'}
      });
    }
  };

  root.ScheduleAPI = ScheduleAPI;
})();
