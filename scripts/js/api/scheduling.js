(function(){
  'use strict';

  const API_BASE_URL = (typeof window.API_BASE_URL === 'string' && window.API_BASE_URL)
    ? window.API_BASE_URL
    : '/Capstone%20Project/php/api';

  async function jsonFetch(url, opts={}){
    const res = await fetch(url, { credentials:'include', headers:{ 'Accept':'application/json', ...(opts.headers||{}) }, ...opts });
    const j = await res.json().catch(()=>null);
    if (!res.ok || !j || !j.success){
      const msg = (j && (j.error||j.message)) ? j.error||j.message : `HTTP ${res.status}`;
      throw new Error(msg);
    }

  // Alias for consumers that expect getMonthPlan
  async function getMonthPlan(year, month){
    return getMonthSchedule(year, month);
  }

  // Fetch previous period allocation items (for computing cancelled carryovers)
  async function getPrevPeriodItems(periodKey){
    const runUrl = `${API_BASE_URL}/allocations/index.php?action=run_by_period&period_key=${encodeURIComponent(periodKey)}&_=${Date.now()}`;
    try{
      const r = await fetch(runUrl, { credentials:'include', headers:{ 'Accept':'application/json' } });
      const j = await r.json().catch(()=>null);
      if (!r.ok || !j || !j.success || !j.data || !j.data.run_id) return [];
      const runId = j.data.run_id;
      const listUrl = `${API_BASE_URL}/allocations/index.php?action=list_by_run&run_id=${encodeURIComponent(String(runId))}&_=${Date.now()}`;
      const rr = await fetch(listUrl, { credentials:'include', headers:{ 'Accept':'application/json' } });
      const jj = await rr.json().catch(()=>null);
      if (!rr.ok || !jj || !jj.success) return [];
      return Array.isArray(jj?.data?.items) ? jj.data.items : [];
    } catch(_){ return []; }
  }
    return j.data;
  }

  async function getMonthSchedule(year, month){
    const url = `${API_BASE_URL}/scheduling/index.php?action=get_month_schedule&year=${encodeURIComponent(year)}&month=${encodeURIComponent(month)}&_=${Date.now()}`;
    const data = await jsonFetch(url);
    // data.weeks: [{ week: {...}, recipients: [...] }]
    return data;
  }

  async function scheduleMonth({year, month, capacity=10}){
    const url = `${API_BASE_URL}/scheduling/index.php?action=schedule_month`;
    const body = JSON.stringify({ year, month, capacity });
    const data = await jsonFetch(url, { method:'POST', headers:{'Content-Type':'application/json'}, body });
    return data; // { weeks: [...] }
  }

  async function markStatus({week_recipient_id, status}){
    const url = `${API_BASE_URL}/scheduling/index.php?action=mark_status`;
    const body = JSON.stringify({ week_recipient_id, status });
    const data = await jsonFetch(url, { method:'POST', headers:{'Content-Type':'application/json'}, body });
    return data;
  }

  async function processWeekResults({week_id}){
    const url = `${API_BASE_URL}/scheduling/index.php?action=process_week_results`;
    const body = JSON.stringify({ week_id });
    return data; // { changed: N }
  }

  // Expose to window for UI integration
  try{
    window.SchedulingAPI = { getMonthSchedule, getMonthPlan, getPrevPeriodItems, scheduleMonth, markStatus, processWeekResults };
  } catch(_){}
})();
