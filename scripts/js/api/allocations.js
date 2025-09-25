(function(){
  'use strict';
  const root = (typeof window !== 'undefined') ? window : globalThis;
  const BASE = (root.API_BASE_URL || '/Capstone%20Project/php/api');
  const URL  = `${BASE}/allocations/index.php`;

  function obj(o){ return (o && typeof o === 'object') ? o : {}; }

  async function get(params){
    const url = URL + '?' + new URLSearchParams(obj(params)).toString();
    return root.fetchJson(url, { method:'GET' });
  }
  async function post(action, body){
    const url = URL + '?action=' + encodeURIComponent(action);
    return root.fetchJson(url, { method:'POST', headers:{'Content-Type':'application/json','Accept':'application/json'}, body: JSON.stringify(body||{}) });
  }
  async function patch(action, params){
    const url = URL + '?' + new URLSearchParams(Object.assign({ action }, obj(params))).toString();
    return root.fetchJson(url, { method:'PATCH' });
  }
  async function del(action, params){
    const url = URL + '?' + new URLSearchParams(Object.assign({ action }, obj(params))).toString();
    return root.fetchJson(url, { method:'DELETE' });
  }

  const AllocationsAPI = {
    async listByRecipient(recipient_id){
      const j = await get(recipient_id ? { action:'list_by_recipient', recipient_id } : { action:'list_by_recipient' });
      return Array.isArray(j?.data?.items) ? j.data.items : [];
    },
    async listByRun(run_id){
      const j = await get({ action:'list_by_run', run_id });
      return Array.isArray(j?.data?.items) ? j.data.items : [];
    },
    async acknowledge(allocation_id){ return post('acknowledge', { allocation_id }); },
    async acknowledgeByAdmin(allocation_id){ return post('acknowledge_admin', { allocation_id }); },
    async schedule(allocation_id){ return post('schedule', { allocation_id }); },
    async complete(allocation_id){ return post('complete', { allocation_id }); },
    async finalize(allocation_id){ return post('finalize', { allocation_id }); },
    async onsiteIssue(item_name, category, quantity, note, period_key, recipient_id){
      return post('onsite_issue', { item_name, category, quantity, note, period_key, recipient_id });
    },

    async previewAllocation(period_key, recipient_ids){
      return root.fetchJson(`${URL}?action=preview_allocation`, {
        method:'POST', headers:{'Content-Type':'application/json','Accept':'application/json'},
        body: JSON.stringify({ period_key, recipient_ids: recipient_ids||[] })
      });
    },
    async createResult(recipient_id, items, run_id, allocation_code, notify_admin){
      return post('create_result', { recipient_id, items, run_id, allocation_code, notify_admin });
    },
    async addItem(allocation_id, item_name, category, quantity){
      return post('add_item', { allocation_id, item_name, category, quantity });
    },
    async updateItem(item_id, item_name, quantity){
      return patch('update_item', { item_id, item_name, quantity });
    },
    async deleteItem(item_id){
      return post('delete_item', { item_id });
    },

    async createRun(note, period_key){ return post('create_run', { note: note||null, period_key: period_key||null }); },
    async notifyRun(run_id){ return post('notify_run', { run_id }); },
    async latestRun(){ return get({ action:'latest_run' }); },
    async runByPeriod(period_key){ return get({ action:'run_by_period', period_key }); },
    async listRuns(limit){ return get({ action:'list_runs', limit: Math.max(1, Math.min(100, limit||24)) }); }
  };

  root.AllocationsAPI = AllocationsAPI;
})();
