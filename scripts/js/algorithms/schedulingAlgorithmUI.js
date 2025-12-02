// schedulingAlgorithmUI.js (recreated)
(function(){
  'use strict';

  // ----- DOM helpers -----
  const qs = (s, r=document)=> r.querySelector(s);
  const qsa = (s, r=document)=> Array.from(r.querySelectorAll(s));
  function cardHasBadge(el, tag){
    const host = qs('.di-week-badges', el);
    if (!host) return false;
    return Array.from(host.querySelectorAll('.badge')).some(b => String(b.textContent || '').trim().toUpperCase() === tag);
  }

  // ----- API base -----
  const API_BASE_URL = (typeof window.API_BASE_URL === 'string' && window.API_BASE_URL)
    ? window.API_BASE_URL
    : '/php/api';

  const WEEK_KEYS = ['W1', 'W2', 'W3', 'W4'];
  const WEEK_INDEX = { W1: 0, W2: 1, W3: 2, W4: 3 };
  const MAX_SELECTED = 10;
  const CANCELLED_STATUSES = new Set(['cancelled', 'canceled', 'declined', 'no show']);

  function createEmptyWeekMap(){
    return { W1: [], W2: [], W3: [], W4: [] };
  }

  function toRecipientIds(source){
    return (Array.isArray(source) ? source : [])
      .map(value => Number.parseInt(value, 10))
      .filter(number => Number.isFinite(number) && number > 0);
  }

  function toRecipientIdSet(source){
    return new Set(toRecipientIds(source));
  }

  function normalizeWeekMap(mapLike){
    const map = createEmptyWeekMap();
    if (!mapLike) return map;
    WEEK_KEYS.forEach(key => { map[key] = toRecipientIds(mapLike[key]); });
    return map;
  }

  function getNextBuckets(current){
    const idx = WEEK_INDEX[current] ?? 0;
    return [
      WEEK_KEYS[(idx + 1) % WEEK_KEYS.length],
      WEEK_KEYS[(idx + 2) % WEEK_KEYS.length],
      WEEK_KEYS[(idx + 3) % WEEK_KEYS.length],
    ];
  }

  function fillIdsFromBuckets(target, map, buckets, skipSet, limit = MAX_SELECTED){
    const existing = new Set(target);
    buckets.forEach(bucket => {
      (map[bucket] || []).forEach(id => {
        if (existing.has(id) || skipSet.has(id) || target.length >= limit) return;
        target.push(id);
        existing.add(id);
      });
    });
  }

  async function resolveExtraExcludedSet(){
    try {
      if (typeof window.__diExcludedIdsFromPeriodsAndSelected === 'function') {
        const extra = await window.__diExcludedIdsFromPeriodsAndSelected();
        return extra instanceof Set ? extra : new Set(extra);
      }
    } catch(_){ }
    return new Set();
  }

  async function createSkipSet(cancelledSet){
    const base = cancelledSet instanceof Set ? new Set(cancelledSet) : new Set();
    const extra = await resolveExtraExcludedSet();
    extra.forEach(id => base.add(id));
    return base;
  }

  function prependCarryoverIds(ids, skip){
    try {
      const carry = (window.__diCarryOverSet instanceof Set) ? window.__diCarryOverSet : new Set();
      if (!carry.size) return ids;
      const desired = [];
      carry.forEach(v => {
        const n = Number.parseInt(v, 10) || 0;
        if (n > 0 && !skip.has(n) && !ids.includes(n)) desired.push(n);
      });
      return desired.length ? desired.concat(ids) : ids;
    } catch(_){ return ids; }
  }

  function augmentWithNextBuckets(ids, mapNormalized, skip, currentBucket, originalWeeksMap){
    const nextOrder = getNextBuckets(currentBucket);
    const result = ids.slice();
    fillIdsFromBuckets(result, mapNormalized, nextOrder, skip, MAX_SELECTED);

    if (result.length < MAX_SELECTED && window.Scheduling && typeof window.Scheduling.planOrder === 'function'){
      const orderAll = window.Scheduling.planOrder(originalWeeksMap, skip, currentBucket) || [];
      const firstBucket = nextOrder[0];
      const bucketIds = mapNormalized[firstBucket] || [];
      const pos = orderAll.findIndex(id => bucketIds.includes(id));
      const rotated = pos > 0 ? orderAll.slice(pos).concat(orderAll.slice(0, pos)) : orderAll;
      rotated.forEach(id => {
        if (result.length >= MAX_SELECTED || skip.has(id) || result.includes(id)) return;
        result.push(id);
      });
    }

    if (result.length < MAX_SELECTED){
      for (const bucket of nextOrder){
        if (result.length >= MAX_SELECTED) break;
        const tag = bucket.toUpperCase();
        const candidates = qsa('#diPool .di-card')
          .map(el => ({ el, id: Number.parseInt(el.dataset.id || '0', 10) || 0 }))
          .filter(candidate => candidate.id && !skip.has(candidate.id) && !result.includes(candidate.id) && cardHasBadge(candidate.el, tag));
        for (const candidate of candidates){
          if (result.length >= MAX_SELECTED) break;
          result.push(candidate.id);
        }
      }
    }

    return result;
  }

  async function enforceLatestStatus(ids, skip){
    try {
      const API = API_BASE_URL;
      const isExcluded = (s)=> /cancel|decline|no\s*show/i.test(String(s||''));
      const curPkForGuard = (typeof getPeriodKeyFromInputs === 'function') ? getPeriodKeyFromInputs() : null;
      const fetchByRecipient = async (rid)=>{
        const url = `${API}/allocations/index.php?action=list_by_recipient&recipient_id=${encodeURIComponent(String(rid))}&t=${Date.now()}`;
        try {
          const res = await fetch(url, { credentials:'include', headers:{'Accept':'application/json'} });
          const j = await res.json().catch(()=>null);
          return (res.ok && j?.success && Array.isArray(j?.data?.items)) ? j.data.items : [];
        } catch(_){ return []; }
      };
      const checks = await Promise.all(ids.map(async id => {
        const hist = await fetchByRecipient(id);
        const curOnly = (Array.isArray(hist) ? hist : []).filter(row => String(row?.period_key || '') === String(curPkForGuard || ''));
        const sorted = [...curOnly].sort((a,b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
        const latest = sorted[0];
        return { id, drop: !!(latest && isExcluded(latest.status)) };
      }));
      const forcedDrop = new Set(checks.filter(x => x.drop).map(x => x.id));
      if (forcedDrop.size){
        ids = ids.filter(id => !forcedDrop.has(id));
        forcedDrop.forEach(id => skip.add(id));
      }
    } catch(_){ }
    return { ids, skip };
  }

  function orderIdsForRendering(ids, mapNormalized, currentBucket){
    try {
      const nextOrder = getNextBuckets(currentBucket);
      const carry = (window.__diCarryOverSet instanceof Set) ? window.__diCarryOverSet : new Set();
      const isIn = (collection, id)=> (collection instanceof Set) ? collection.has(id) : Array.isArray(collection) ? collection.includes(id) : false;
      const rollbacks = ids.filter(id => isIn(carry, id));
      const currentOnly = ids.filter(id => (mapNormalized[currentBucket] || []).includes(id));
      const nextAll = nextOrder.flatMap(b => mapNormalized[b] || []);
      const replacements = ids.filter(id => nextAll.includes(id) && !isIn(carry, id));
      const seen = new Set();
      const ordered = [];
      const pushGroup = (group)=>{
        group.forEach(id => {
          if (ordered.length >= MAX_SELECTED || seen.has(id)) return;
          ordered.push(id);
          seen.add(id);
        });
      };
      pushGroup(rollbacks);
      pushGroup(replacements);
      pushGroup(currentOnly);
      if (ordered.length < Math.min(MAX_SELECTED, ids.length)){
        pushGroup(ids);
      }
      return ordered.slice(0, MAX_SELECTED);
    } catch(_){
      return ids.slice(0, MAX_SELECTED);
    }
  }

  function removeExcludedCardsFromDom(skip, pool, selected){
    try {
      selected.querySelectorAll('.di-card').forEach(el => {
        const rid = Number.parseInt(el.dataset.id || '0', 10) || 0;
        if (rid && skip.has(rid)) pool.appendChild(el);
      });
    } catch(_){ }
  }

  function renderSelectedCards(ids, skip, selected, pool){
    removeExcludedCardsFromDom(skip, pool, selected);
    selected.innerHTML = '';
    for (let i = ids.length - 1; i >= 0; i--){
      const id = ids[i];
      if (skip.has(id)) continue;
      const card = qs(`.di-card[data-id="${id}"]`) || ensureCardForId(id);
      if (card) selected.insertBefore(card, selected.firstChild);
    }
  }

  // ======================== Week/period helpers ========================
  function getWeekStart(){
    try { if (typeof window.__WEEK_START === 'string' && window.__WEEK_START) return window.__WEEK_START; } catch(_){ }
    return 'monday';
  }
  // Query helpers
  function getQueryParam(name){ try { const u = new URL(window.location.href); return u.searchParams.get(name); } catch(_){ return null; } }
  function parsePeriodKey(pk){
    try{
      const m = /^(\d{4})-(\d{2})-W([1-4])$/i.exec(String(pk||''));
      if (!m) return null;
      const y = parseInt(m[1],10), mon = parseInt(m[2],10), w = parseInt(m[3],10);
      return { year: y, month: mon, weekIndex: w, bucket: w===1?'W1':w===2?'W2':w===3?'W3':'W4' };
    } catch(_){ return null; }
  }

  // ======================== Simple Init Orchestrator ========================
  async function simpleInit(){
    // Reentrancy guard to avoid double init from auto-init and wrapper
    if (window.__diSimpleInitRunning) return; window.__diSimpleInitRunning = true;
    try { if (!window.__WEEK_START) window.__WEEK_START = 'monday'; } catch(_){ }
    // Hooks
    try { attachSearch(); attachDelegatedInteractions(); } catch(_){ }
    // 1) Recipients
    let recs = [];
    try {
      recs = await fetchRecipients();
      if (Array.isArray(recs) && recs.length){
        window.__diAllRecipients = recs;
        renderRecipientPools(recs, []);
      } else {
        // Create placeholder cards so UI is visible even without API data
        const placeholders = Array.from({ length: 10 }, (_, i) => ({ id: i+1, user_id: i+1, name: `Recipient ${i+1}` }));
        window.__diAllRecipients = placeholders;
        renderRecipientPools(placeholders, []);
      }
    } catch(_){ recs = []; }
    // 2) Plan (auto-detect basis/month handled in fetchMonthlyPlan)
    let weeksMap = null;
    try {
      const data = await fetchMonthlyPlan(currentMonth());
      weeksMap = normalizeWeeksExToMap(data);
      window.__diWeeks = weeksMap;
      annotateCardsWithWeeks(weeksMap);
      refreshBadges();
    } catch(_){ weeksMap = createEmptyWeekMap(); }
    // If plan still empty, seed current bucket from available recipients so Selected shows something
    try {
      const hasAny = WEEK_KEYS.some(k => Array.isArray(weeksMap?.[k]) && weeksMap[k].length);
      if (!hasAny){
        const cur = getCurrentBucketNow();
        const poolCards = qsa('#diPool .di-card');
        const ids = (poolCards.length ? poolCards : Array.from({length:MAX_SELECTED}, (_,i)=>({dataset:{id:String(i+1)}})))
          .slice(0,MAX_SELECTED)
          .map(el => parseInt(el.dataset.id||'0',10))
          .filter(Number.isFinite);
        weeksMap = createEmptyWeekMap();
        weeksMap[cur] = ids;
        window.__diWeeks = weeksMap;
      }
    } catch(_){ }
    // 3) Cancelled recipients
    //    - Previous period cancellations become rollbacks (carryover) and SHOULD be eligible this week
    //    - Current period cancellations remain excluded from selection
    let cancelledSet = new Set();
    try {
      const skipRuns = (typeof window.DI_SKIP_RUN_LOOKUPS === 'boolean') ? window.DI_SKIP_RUN_LOOKUPS : false;
      if (!skipRuns){
        const norm = (s)=> String(s||'').trim().toLowerCase();
        // Previous period
        try {
          const prevPk = getPreviousPeriodKey();
          const prev = await fetchRunAllocationsByPeriod(prevPk);
          const idsPrev = (prev.ok ? prev.items : [])
            .filter(a=>CANCELLED_STATUSES.has(norm(a.status)))
            .map(a=>parseInt(a.recipient_id,10))
            .filter(Number.isFinite);
          // NOTE: Do NOT add previous-period cancelled into cancelledSet so they remain eligible as rollbacks
          window.__diCarryOverSet = new Set(idsPrev);
        } catch(_){ }
        // Current period
        try {
          const curPk = getPeriodKeyFromInputs();
          const cur = await fetchRunAllocationsByPeriod(curPk);
          const idsCur = (cur.ok ? cur.items : [])
            .filter(a=>CANCELLED_STATUSES.has(norm(a.status)))
            .map(a=>parseInt(a.recipient_id,10))
            .filter(Number.isFinite);
          idsCur.forEach(id=> cancelledSet.add(id));
        } catch(_){ }
      }
    } catch(_){ cancelledSet = new Set(); }
    // 4) Ensure plan cards exist in pool, then build Selected
    try {
      const allIds = WEEK_KEYS
        .flatMap(k => (Array.isArray(weeksMap?.[k])?weeksMap[k]:[]))
        .map(v=>parseInt(v,10)).filter(Number.isFinite);
      allIds.forEach(id => { ensureCardForId(id); });
      sortPoolByWeeks();
      attachDelegatedInteractions();
      refreshBadges();
    } catch(_){ }
    buildSelectedSimple(weeksMap, cancelledSet);
    try { window.__diSimpleInitRunning = false; } catch(_){ }
  }
  function diGetBaseDate(){
    const inp = qs('#diBaseDate');
    let d = null;
    if (inp && inp.value){ d = new Date(inp.value + 'T00:00:00'); }
    if (!d || isNaN(d)) d = new Date();
    d.setHours(0,0,0,0);
    return d;
  }
  function planWeekIndexForDate(d){ const day = d.getDate(); return day<=7?1:day<=14?2:day<=21?3:4; }
  function planWeekIndexByWeekStart(base){
    try{
      const basis = getWeekStart();
      const monthFirst = new Date(base.getFullYear(), base.getMonth(), 1);
      const wsDow = (basis === 'monday') ? 1 : 0;
      const firstDow = monthFirst.getDay();
      const offset = (firstDow - wsDow + 7) % 7;
      const firstWeekStart = new Date(monthFirst.getFullYear(), monthFirst.getMonth(), 1 - offset);
      const starts = [0,1,2,3].map(i => new Date(firstWeekStart.getFullYear(), firstWeekStart.getMonth(), firstWeekStart.getDate() + i*7));
      const b = new Date(base.getFullYear(), base.getMonth(), base.getDate()); b.setHours(0,0,0,0);
      for (let i=0;i<starts.length;i++){
        const s = new Date(starts[i].getFullYear(), starts[i].getMonth(), starts[i].getDate());
        const e = new Date(s.getFullYear(), s.getMonth(), s.getDate()+6);
        if (b >= s && b <= e){ return i+1; }
      }
      return planWeekIndexForDate(base);
    } catch(_){ return planWeekIndexForDate(base); }
  }
  function resolveCurrentWeekBucket(){
    try{
      const forced = window.__PERIOD_KEY || getQueryParam('period_key');
      const meta = parsePeriodKey(forced);
      if (meta) return meta.bucket;
    } catch(_){ }
    const idx = planWeekIndexForDate(diGetBaseDate()); return idx===1?'W1':idx===2?'W2':idx===3?'W3':'W4';
  }
  function getCurrentBucketNow(){
    try{
      const forced = window.__PERIOD_KEY || getQueryParam('period_key');
      const meta = parsePeriodKey(forced);
      if (meta) return meta.bucket;
    } catch(_){ }
    const idx = planWeekIndexForDate(new Date()); return idx===1?'W1':idx===2?'W2':idx===3?'W3':'W4';
  }
  function currentMonth(){
    try{
      const forced = window.__PERIOD_KEY || getQueryParam('period_key');
      const meta = parsePeriodKey(forced);
      if (meta) return `${meta.year}-${String(meta.month).padStart(2,'0')}`;
    } catch(_){ }
    const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
  }
  function getPeriodKeyFromInputs(){
    try{
      const forced = window.__PERIOD_KEY || getQueryParam('period_key');
      const meta = parsePeriodKey(forced);
      if (meta) return `${meta.year}-${String(meta.month).padStart(2,'0')}-W${meta.weekIndex}`;
    } catch(_){ }
    const base = diGetBaseDate(); const month = `${base.getFullYear()}-${String(base.getMonth()+1).padStart(2,'0')}`; const idx = planWeekIndexForDate(base); return `${month}-W${idx}`;
  }
  function getPreviousPeriodKey(){
    // If a forced period_key is set, compute previous relative to it
    try{
      const forced = window.__PERIOD_KEY || getQueryParam('period_key');
      const meta = parsePeriodKey(forced);
      if (meta){
        let { year, month, weekIndex } = meta;
        let prevIdx = weekIndex - 1;
        if (prevIdx < 1){ prevIdx = 4; month -= 1; if (month < 1){ month = 12; year -= 1; } }
        return `${year}-${String(month).padStart(2,'0')}-W${prevIdx}`;
      }
    } catch(_){ }
    const base = diGetBaseDate();
    let year = base.getFullYear();
    let monthNum = base.getMonth() + 1;
    const idx = planWeekIndexForDate(base);
    let prevIdx = idx - 1;
    if (prevIdx < 1){ prevIdx = 4; monthNum -= 1; if (monthNum < 1){ monthNum = 12; year -= 1; } }
    const mm = String(monthNum).padStart(2,'0');
    return `${year}-${mm}-W${prevIdx}`;
  }

  // ======================== Plan helpers ========================
  function normalizePlan(input){
    try{
      const src = (input && typeof input === 'object' && !Array.isArray(input))
        ? (input.weeks_ex || input.weeks || input)
        : input;
      if (src && typeof src === 'object' && !Array.isArray(src) && (src.W1||src.W2||src.W3||src.W4)){
        const out={W1:[],W2:[],W3:[],W4:[]};
        ['W1','W2','W3','W4'].forEach(k=>{ const v=src[k]; out[k]=Array.isArray(v)?v.map(n=>parseInt(n,10)).filter(Number.isFinite):[]; });
        return out;
      }
      if (Array.isArray(src) && src.length && typeof src[0]==='object' && !Array.isArray(src[0])){
        const map={W1:[],W2:[],W3:[],W4:[]};
        src.forEach(w=>{ const idx=parseInt(w?.week_index||w?.index||w?.week,10); const key=idx===1?'W1':idx===2?'W2':idx===3?'W3':idx===4?'W4':null; const ids=Array.isArray(w?.recipient_ids||w?.ids)?(w.recipient_ids||w.ids):[]; if(key) map[key]=ids.map(n=>parseInt(n,10)).filter(Number.isFinite); });
        return map;
      }
      if (Array.isArray(src) && src.length && Array.isArray(src[0])){
        const keys=['W1','W2','W3','W4']; const out={W1:[],W2:[],W3:[],W4:[]};
        keys.forEach((k,i)=>{ const val=src[i]||[]; out[k]=val.map(n=>parseInt(n,10)).filter(Number.isFinite); });
        return out;
      }
    } catch(_){ }
    return { W1:[], W2:[], W3:[], W4:[] };
  }
  function normalizeWeeksExToMap(weeksEx){ return normalizePlan(weeksEx); }

  function prevMonth(ym){
    try{
      if (!ym || !/^\d{4}-\d{2}$/.test(ym)) ym = currentMonth();
      const y = parseInt(ym.slice(0,4),10), m = parseInt(ym.slice(5),10);
      const d = new Date(y, m-2, 1); // previous month
      return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    } catch(_){ return currentMonth(); }
  }
  async function fetchMonthlyPlan(month){
    const m = month || currentMonth();
    const tryFetch = async (mm, basis)=>{
      try{
        const url = `${API_BASE_URL}/recipients/index.php?action=get_plan&month=${encodeURIComponent(mm)}&week_start=${encodeURIComponent(basis)}&t=${Date.now()}`;
        const r = await fetch(url, { credentials:'include', cache:'no-store' });
        const j = await r.json().catch(()=>null);
        const data = j?.data || { month:mm, weeks_ex:[] };
        const wm = normalizePlan(data);
        const counts = ['W1','W2','W3','W4'].map(k => (Array.isArray(wm[k])?wm[k].length:0));
        const score = counts.reduce((a,b)=>a+b,0);
        return { ok: !!j?.success, data, wm, counts, score, month:mm, basis };
      } catch(_){ return { ok:false, data:{ month:mm, weeks_ex:[] }, wm:{W1:[],W2:[],W3:[],W4:[]}, counts:[0,0,0,0], score:0, month:mm, basis } }
    };
    // First, try requested month with current basis
    const primary = await tryFetch(m, getWeekStart());
    if (primary.score > 0) return primary.data;
    // Probe both bases on current and previous months
    const candidates = [];
    candidates.push(await tryFetch(m, 'monday'));
    candidates.push(await tryFetch(m, 'sunday'));
    const pm = prevMonth(m);
    candidates.push(await tryFetch(pm, 'monday'));
    candidates.push(await tryFetch(pm, 'sunday'));
    // Pick best by total items, then by non-W1 items
    const pick = (a,b)=>{
      if (a.score !== b.score) return a.score > b.score ? a : b;
      const an=a.counts[1]+a.counts[2]+a.counts[3]; const bn=b.counts[1]+b.counts[2]+b.counts[3];
      return an>=bn ? a : b;
    };
    const best = candidates.reduce((acc, cur)=> pick(acc, cur));
    if (best.score > 0){
      try { window.__WEEK_START = best.basis; window.__PLAN_MONTH = best.month; } catch(_){ }
      // Return a compatible data shape with weeks map so existing callers work
      return { month: best.month, weeks: best.wm, week_start: best.basis };
    }
    // Nothing found
    return primary.data;
  }

  async function autoDetectWeekStartAndPlan(month){
    const m = month || currentMonth();
    const load = async (basis) => {
      try{
        const url = `${API_BASE_URL}/recipients/index.php?action=get_plan&month=${encodeURIComponent(m)}&week_start=${encodeURIComponent(basis)}&t=${Date.now()}`;
        const r = await fetch(url, { credentials:'include', cache:'no-store' });
        const j = await r.json().catch(()=>null);
        const wm = normalizePlan(j?.data);
        const counts = ['W1','W2','W3','W4'].map(k => (Array.isArray(wm[k])?wm[k].length:0));
        return { basis, wm, counts, score: counts.reduce((a,b)=>a+b,0) };
      } catch(_){ return { basis, wm:{W1:[],W2:[],W3:[],W4:[]}, counts:[0,0,0,0], score:0 }; }
    };
    const monday = await load('monday');
    const sunday = await load('sunday');
    const pick = (a,b)=>{
      if (a.score!==b.score) return a.score>b.score?a:b;
      const an=a.counts[1]+a.counts[2]+a.counts[3]; const bn=b.counts[1]+b.counts[2]+b.counts[3];
      return an>=bn?a:b;
    };
    const chosen = pick(monday, sunday);
    try { window.__WEEK_START = chosen.basis; } catch(_){ }
    try { console.log('[DI][plan] basis:', chosen.basis, 'counts:', { W1:chosen.wm.W1.length, W2:chosen.wm.W2.length, W3:chosen.wm.W3.length, W4:chosen.wm.W4.length }); } catch(_){ }
    return chosen;
  }

  // ======================== Recipients: fetch + render ========================
  async function fetchRecipients(){
    const url = `${API_BASE_URL}/users/index.php?action=list&role=recipient&status=approved&t=${Date.now()}`;
    const res = await fetch(url, { headers:{'Accept':'application/json'}, credentials:'include' });
    if (!res.ok) return [];
    const j = await res.json().catch(()=>null);
    const arr = Array.isArray(j?.data?.items) ? j.data.items : [];
    const filtered = arr.filter((u) => {
      const org = String(u.organization_name || u.name || '').trim().toLowerCase();
      const tags = String(u.tags || '').toLowerCase();
      const isHidden = org === 'foodbank (on-site)' || /(^|[^a-z])hidden([^a-z]|$)/.test(tags);
      return !isHidden;
    });
    return filtered;
  }
  function renderRecipientPools(items, selectedIds = []){
    const pool = qs('#diPool'); const selected = qs('#diSelected');
    if (!pool || !selected) return;
    const mk = (u)=>{
      const id = parseInt(u.user_id||u.id,10)||0;
      const label = (u.organization_name && u.organization_name.trim()) ? u.organization_name : (u.name || `Recipient ${id}`);
      const el = document.createElement('div');
      el.className='di-card p-2 border rounded bg-light cursor-pointer'; el.draggable=true; el.dataset.id=String(id);
      el.innerHTML=`<div class="d-flex justify-content-between align-items-center gap-2">
        <span class="di-card-label text-truncate">${label}</span>
        <span class="di-week-badges d-flex gap-1"></span>
      </div>`;
      return el;
    };
    pool.innerHTML=''; selected.innerHTML='';
    (items||[]).forEach(u=>{ const id=parseInt(u.user_id||u.id,10)||0; const card=mk(u); if (selectedIds.includes(id)) selected.appendChild(card); else pool.appendChild(card); });
    updateSelectedCount(); refreshBadges();
  }
  function ensureCardForId(id){
    id = parseInt(id,10)||0; if (!id) return null;
    let card = qs(`.di-card[data-id="${id}"]`);
    if (card) return card;
    const pool = qs('#diPool'); if (!pool) return null;
    const all = Array.isArray(window.__diAllRecipients) ? window.__diAllRecipients : [];
    const u = all.find(r => (parseInt(r.user_id||r.id,10)||0) === id);
    if (!u) return null;
    const label = (u.organization_name && u.organization_name.trim()) ? u.organization_name : (u.name || `Recipient ${id}`);
    card = document.createElement('div'); card.className='di-card p-2 border rounded bg-light cursor-pointer'; card.draggable=true; card.dataset.id=String(id);
    card.innerHTML = `<div class="d-flex justify-content-between align-items-center gap-2"><span class="di-card-label text-truncate">${label}</span><span class="di-week-badges d-flex gap-1"></span></div>`;
    pool.appendChild(card);
    return card;
  }

  // ======================== Badges / annotations ========================
  function annotateCardsWithWeeks(weeksMap){
    const W1=toRecipientIdSet(weeksMap?.W1), W2=toRecipientIdSet(weeksMap?.W2), W3=toRecipientIdSet(weeksMap?.W3), W4=toRecipientIdSet(weeksMap?.W4);
    const currentW = resolveCurrentWeekBucket();
    const wkToIso = { W1:{label:'W1',color:'primary'}, W2:{label:'W2',color:'danger'}, W3:{label:'W3',color:'warning'}, W4:{label:'W4',color:'info'} };
    qsa('.di-card').forEach(card => {
      const id = parseInt(card.dataset.id||'0',10)||0;
      const host = qs('.di-week-badges', card); if (host) host.innerHTML='';
      card.classList.remove('border-primary','border-danger','border-warning','border-info','border-secondary','border-1','border-2');
      if (!card.classList.contains('border')) card.classList.add('border');
      let added=false;
      WEEK_KEYS.forEach(wk=>{
        const has = wk==='W1'?W1.has(id):wk==='W2'?W2.has(id):wk==='W3'?W3.has(id):W4.has(id);
        if (!has) return;
        const meta = wkToIso[wk];
        if (host){ const span=document.createElement('span'); span.className=`badge bg-${meta.color} text-uppercase`; span.style.fontSize='0.65rem'; span.textContent=meta.label; host.appendChild(span); }
        card.classList.add(`border-${meta.color}`); if (wk===currentW) card.classList.add('border-2');
        added=true;
      });
      if (!added){ card.classList.add('border-secondary','border-1'); }
    });
  }
  function ensureCurrentWeekDecor(){
    try{
      const currentW = resolveCurrentWeekBucket();
      const color = currentW==='W1'?'primary':currentW==='W2'?'danger':currentW==='W3'?'warning':'info';
      qsa('#diSelected .di-card').forEach(card => {
        const host = qs('.di-week-badges', card);
        const hasBadge = !!(host && host.children && host.children.length);
        if (!hasBadge){
          if (host){ const span=document.createElement('span'); span.className=`badge bg-${color} text-uppercase`; span.style.fontSize='0.65rem'; span.textContent=currentW; host.appendChild(span); }
          card.classList.add(`border-${color}`,'border-2');
        }
      });
    } catch(_){ }
  }
  function refreshBadges(){
    try{
      let weeks = (window.__diWeeks && typeof window.__diWeeks==='object') ? window.__diWeeks : null;
      if (!weeks && Array.isArray(window.__diWeeksEx)) weeks = normalizeWeeksExToMap(window.__diWeeksEx);
      annotateCardsWithWeeks(weeks||createEmptyWeekMap());
      ensureCurrentWeekDecor();
    } catch(_){ }
  }
  function sortPoolByWeeks(){
    try{
      const pool = qs('#diPool'); if (!pool) return;
      const weeks = (window.__diWeeks && typeof window.__diWeeks==='object') ? window.__diWeeks : createEmptyWeekMap();
      const W1=toRecipientIdSet(weeks.W1), W2=toRecipientIdSet(weeks.W2), W3=toRecipientIdSet(weeks.W3), W4=toRecipientIdSet(weeks.W4);
      const orderIdx=(id)=> W1.has(id)?0:W2.has(id)?1:W3.has(id)?2:W4.has(id)?3:4;
      const rows = qsa('#diPool .di-card').map(el=>({ el, id:parseInt(el.dataset.id||'0',10)||0, label:(qs('.di-card-label',el)?.textContent||'').toLowerCase() }));
      rows.sort((a,b)=>{ const ai=orderIdx(a.id), bi=orderIdx(b.id); if (ai!==bi) return ai-bi; return a.label.localeCompare(b.label); });
      rows.forEach(r=> pool.appendChild(r.el));
    } catch(_){ }
  }

  // ======================== Interactions & UI ========================
  function attachSearch(){
    const input = qs('#diSearch'); if (!input) return;
    input.addEventListener('input', ()=>{
      const q = input.value.trim().toLowerCase();
      qsa('.di-card').forEach(el=>{ const label=(qs('.di-card-label',el)?.textContent||'').toLowerCase(); el.style.display = q ? (label.includes(q)? '' : 'none') : ''; });
    });
  }
  function attachDelegatedInteractions(){
    const pool = qs('#diPool'); const selected = qs('#diSelected'); if (!pool || !selected) return;
    // Bind once globally to avoid duplicate handlers
    if (window.__diCardToggleBound) return;
    window.__diCardToggleBound = true;
    const onDocClick = (e)=>{
      try {
        let el = e.target;
        if (el && el.nodeType !== 1 && el.parentElement) { el = el.parentElement; }
        const card = el && typeof el.closest === 'function' ? el.closest('.di-card') : null;
        if (!card) return;
        const inSelected = !!card.closest('#diSelected');
        if (inSelected) { pool.appendChild(card); } else { selected.appendChild(card); }
        updateSelectedCount(); refreshBadges();
        try { e.stopImmediatePropagation(); } catch(_){}
        try { e.stopPropagation(); } catch(_){}
        try { e.preventDefault(); } catch(_){}
        return false;
      } catch(_){ }
    };
    document.addEventListener('click', onDocClick, true);
  }
  function updateSelectedCount(){ try { const n=qsa('#diSelected .di-card').length; const b=qs('#diSelectedCount'); if (b) b.textContent = `Selected: ${n}`; } catch(_){ } }
  function updateHeaderMeta(){
    try{
      const host = qs('#diCurrentWeek'); if (!host) return;
      const base = diGetBaseDate();
      // Use the same fixed month buckets as Scheduling.getPeriodKeyFromDate / weekIndexForDate
      const idx = (window.Scheduling && typeof window.Scheduling.weekIndexForDate === 'function')
        ? window.Scheduling.weekIndexForDate(base)
        : planWeekIndexForDate(base);
      const month = `${base.getFullYear()}-${String(base.getMonth()+1).padStart(2,'0')}`;
      const periodKey = `${month}-W${idx}`;
      const startDay = idx===1 ? 1 : idx===2 ? 8 : idx===3 ? 15 : 22;
      const start = new Date(base.getFullYear(), base.getMonth(), startDay);
      start.setHours(0,0,0,0);
      const end = new Date(start.getFullYear(), start.getMonth(), start.getDate()+6);
      const fmt=(d)=> `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      host.textContent = `Current week: W${idx} • ${periodKey} • ${fmt(start)} to ${fmt(end)}`;
    } catch(_){ }
  }

  // ======================== Selected builder & allocations data ========================
  async function buildSelectedSimple(weeksMap, cancelledSet){
    try {
      const selected = qs('#diSelected');
      const pool = qs('#diPool');
      if (!selected || !pool) return;

      const currentBucket = getCurrentBucketNow();
      const normalizedMap = normalizeWeekMap(weeksMap);
      let skip = await createSkipSet(cancelledSet);

      let ids = [];
      try { ids = window.Scheduling.buildSelectedIds(weeksMap, skip, { currentBucket }); } catch(_){ ids = []; }

      ids = prependCarryoverIds(ids, skip);
      ids = augmentWithNextBuckets(ids, normalizedMap, skip, currentBucket, weeksMap);

      ({ ids, skip } = await enforceLatestStatus(ids, skip));

      ids = augmentWithNextBuckets(ids, normalizedMap, skip, currentBucket, weeksMap);
      ids = orderIdsForRendering(ids, normalizedMap, currentBucket);

      renderSelectedCards(ids, skip, selected, pool);
      updateSelectedCount();
      updateHeaderMeta();
      refreshBadges();
    } catch(_){ }
  }
  async function fetchRunAllocationsByPeriod(periodKey){
    try{
      // Use list_by_period: ensures run and returns items with period_key only
      const res = await fetch(`${API_BASE_URL}/allocations/index.php?action=list_by_period&period_key=${encodeURIComponent(periodKey)}&t=${Date.now()}`, { credentials:'include', headers:{'Accept':'application/json'} });
      if (res.status === 401) return { items: [], ok:false, auth:true };
      const j = await res.json().catch(()=>null);
      if (!res.ok || !j?.success) return { items: [], ok:false };
      return { items: Array.isArray(j?.data?.items)? j.data.items : [], ok:true };
    } catch(_){ return { items: [], ok:false }; }
  }

  // ======================== Exports ========================
  try {
    window.normalizeWeeksExToMap = normalizeWeeksExToMap;
    window.sortPoolByWeeks = sortPoolByWeeks;
    window.attachDelegatedInteractions = attachDelegatedInteractions;
    window.attachSearch = attachSearch;
    window.updateSelectedCount = updateSelectedCount;
    window.fetchRunAllocationsByPeriod = fetchRunAllocationsByPeriod;
    window.ensureCardForId = ensureCardForId;
    window.annotateCardsWithWeeks = annotateCardsWithWeeks;
    window.ensureCurrentWeekDecor = ensureCurrentWeekDecor;
    window.refreshBadges = refreshBadges;
    window.getWeekStart = getWeekStart;
    window.diGetBaseDate = diGetBaseDate;
    window.planWeekIndexForDate = planWeekIndexForDate;
    window.planWeekIndexByWeekStart = planWeekIndexByWeekStart;
    window.resolveCurrentWeekBucket = resolveCurrentWeekBucket;
    window.getCurrentBucketNow = getCurrentBucketNow;
    window.getPeriodKeyFromInputs = getPeriodKeyFromInputs;
    window.getPreviousPeriodKey = getPreviousPeriodKey;
    window.currentMonth = currentMonth;
    window.fetchMonthlyPlan = fetchMonthlyPlan;
    window.autoDetectWeekStartAndPlan = autoDetectWeekStartAndPlan;
    window.fetchRecipients = fetchRecipients;
    window.renderRecipientPools = renderRecipientPools;
    window.buildSelectedSimple = buildSelectedSimple;
    window.diSetPeriodKey = function(pk){
      const meta = parsePeriodKey(pk);
      if (meta){
        window.__PERIOD_KEY = `${meta.year}-${String(meta.month).padStart(2,'0')}-W${meta.weekIndex}`;
        window.__PERIOD_KEY_META = meta;
      }
    };
    window.SchedulingAlgorithmUISimpleInit = simpleInit;
  } catch(_){ }

  // Auto-init when page loads unless explicitly disabled
  try {
    const autorun = (typeof window.DI_AUTO_INIT === 'boolean') ? window.DI_AUTO_INIT !== false : true;
    if (autorun){
      if (document.readyState === 'loading'){
        document.addEventListener('DOMContentLoaded', ()=>{ try { simpleInit(); } catch(_){ } });
      } else {
        try { simpleInit(); } catch(_){ }
      }
    }
  } catch(_){ }
  // ========= Inline exclusion for cancelled/completed statuses =========
  (function(){
    function isExcludedStatus(s){ try { return /cancel|decline|no\s*show|complete|deliver|picked/i.test(String(s||'')); } catch(_){ return false; } }
    async function fetchByPeriod(periodKey){
      try{
        const url = `${API_BASE_URL}/allocations/index.php?action=list_by_period&period_key=${encodeURIComponent(periodKey)}&t=${Date.now()}`;
        const res = await fetch(url, { credentials:'include', headers:{'Accept':'application/json'} });
        if (!res.ok) return { ok:false, items:[] };
        const j = await res.json().catch(()=>null);
        return (j?.success) ? { ok:true, items: Array.isArray(j?.data?.items) ? j.data.items : [] } : { ok:false, items:[] };
      } catch(_){ return { ok:false, items:[] }; }
    }
    async function excludedIdsFromPeriodsAndSelected(){
      try{
        const curPk = (typeof getPeriodKeyFromInputs==='function') ? getPeriodKeyFromInputs() : null;
        const cur = curPk ? await fetchByPeriod(curPk) : { ok:false, items:[] };
        const ids = new Set();
        // Only exclude from CURRENT period; do not exclude previous period to allow rollbacks
        (cur.items||[]).forEach(a => { if (isExcludedStatus(a?.status)) ids.add(Number(a?.recipient_id||0)); });
        // augment by checking latest allocation for currently selected recipients
        try{
          const API = API_BASE_URL;
          const selectedIds = Array.from(document.querySelectorAll('#diSelected .di-card'))
            .map(el => Number(el.dataset.id)).filter(n => Number.isFinite(n) && n>0);
          if (selectedIds.length){
            const fetchByRecipient = async (rid)=>{
              const url = `${API}/allocations/index.php?action=list_by_recipient&recipient_id=${encodeURIComponent(String(rid))}&t=${Date.now()}`;
              try { const res=await fetch(url,{credentials:'include',headers:{'Accept':'application/json'}}); const j=await res.json().catch(()=>null); return (res.ok&&j?.success&&Array.isArray(j?.data?.items))? j.data.items:[]; } catch(_){ return []; }
            };
            const histories = await Promise.all(selectedIds.map(async id=>{
              const hist=await fetchByRecipient(id);
              // Restrict to CURRENT period_key when checking latest status to avoid excluding rollbacks
              const curOnly = (Array.isArray(hist)?hist:[]).filter(row => String(row?.period_key||'') === String(curPk||''));
              const sorted=[...curOnly].sort((a,b)=> new Date(b.created_at||0)-new Date(a.created_at||0));
              return { id, latest: sorted[0] };
            }));
            histories.forEach(r=>{ if (r.latest && isExcludedStatus(r.latest.status)) ids.add(r.id); });
          }
        } catch(_){ }
        return ids;
      } catch(_){ return new Set(); }
    }
    // Expose for builder usage within the correct scope
    try { window.__diExcludedIdsFromPeriodsAndSelected = excludedIdsFromPeriodsAndSelected; } catch(_){ }
    async function patchBuildAndObserve(){
      try{
        if (window.__diExcludePatched) return; window.__diExcludePatched = true;
        const orig = window.buildSelectedSimple;
        if (typeof orig === 'function'){
          window.buildSelectedSimple = async function(weeksMap, cancelledSet){
            const selected = document.querySelector('#diSelected'); const pool = document.querySelector('#diPool'); if (!selected || !pool) return;
            const extraExcluded = await excludedIdsFromPeriodsAndSelected();
            const skip = new Set([...(cancelledSet instanceof Set ? cancelledSet : []), ...extraExcluded]);
            const cur = (typeof getCurrentBucketNow==='function') ? getCurrentBucketNow() : 'W1';
            let ids = [];
            try { ids = window.Scheduling.buildSelectedIds(weeksMap, skip, { currentBucket: cur }); } catch(_){ ids = []; }
            try { selected.querySelectorAll('.di-card').forEach(el=>{ const rid = parseInt(el.dataset.id||'0',10)||0; if (rid && skip.has(rid)) pool.appendChild(el); }); } catch(_){}
            selected.innerHTML = '';
            ids.forEach(id=>{ if (skip.has(id)) return; const card = document.querySelector(`.di-card[data-id="${id}"]`) || ensureCardForId(id); if (card) selected.appendChild(card); });
            try { updateSelectedCount(); } catch(_){}
            try { updateHeaderMeta(); } catch(_){}
            try { refreshBadges(); } catch(_){}
          };
        }
        // Force an immediate rebuild so exclusions take effect even if the original build already ran
        try { if (window.__diWeeks) { await window.buildSelectedSimple(window.__diWeeks, new Set()); } } catch(_){ }
        const selected = document.querySelector('#diSelected'); const pool = document.querySelector('#diPool');
        if (selected && pool){
          let excluded = await excludedIdsFromPeriodsAndSelected();
          setInterval(async ()=>{ try { excluded = await excludedIdsFromPeriodsAndSelected(); } catch(_){} }, 30000);
          try { selected.querySelectorAll('.di-card').forEach(el=>{ const rid=+el.dataset.id; if (excluded.has(rid)) pool.appendChild(el); }); } catch(_){}
          const mo = new MutationObserver((muts)=>{
            try{
              muts.forEach(m=>{ m.addedNodes && m.addedNodes.forEach(node=>{ if (!(node && node.nodeType===1 && node.matches && node.matches('.di-card'))) return; const rid = +node.dataset.id; if (excluded.has(rid)) pool.appendChild(node); }); });
              try { updateSelectedCount(); } catch(_){}
              try { refreshBadges(); } catch(_){}
            } catch(_){ }
          });
          mo.observe(selected, { childList:true });
          window.__diExclusionObserver2 = mo;
        }
      } catch(_){ }
    }
    if (document.readyState === 'loading'){ document.addEventListener('DOMContentLoaded', patchBuildAndObserve); } else { patchBuildAndObserve(); }
  })();
})();
