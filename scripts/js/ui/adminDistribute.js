// Lightweight DOM helpers (global so top-level functions can use them)
const qs = (s, r=document)=> r.querySelector(s);
const qsa = (s, r=document)=> Array.from(r.querySelectorAll(s));

// Delegations: moved to scripts/js/algorithms/schedulingAlgorithmUI.js
function normalizeWeeksExToMap(weeksEx){ try { return window.normalizeWeeksExToMap(weeksEx); } catch(_){ return { W1:[], W2:[], W3:[], W4:[] }; } }

// Ensure Week 1 and Week 2 plan IDs have cards visible in Pool/Selected
  function ensurePlanCardsVisible(){ try { return window.ensurePlanCardsVisible(); } catch(_){ } }

  // (moved) attachAllocateNow defined at top-level below

  // Allocate ALL available inventory items (optionally filtered by category) across recipients
  function tryAutoAllAllItems(cat, ids){
    return new Promise((resolve)=>{
      if (!(Array.isArray(ids) && ids.length && window.Allocation && typeof window.Allocation.allocateItems==='function')){
        resolve({ applied:false });
        return;
      }

  // --- Exclusion logic for cancelled/completed statuses ---
  function isExcludedStatus(s){
    try { return /cancel|decline|no\s*show|complete|deliver|picked/i.test(String(s||'')); } catch(_){ return false; }
  }
  async function fetchExcludedIdsForPeriods(){
    try{
      const curPk = (typeof getPeriodKeyFromInputs==='function') ? getPeriodKeyFromInputs() : null;
      const curRes = curPk ? await fetchRunAllocationsByPeriod(curPk) : { ok:false, items:[] };
      const ids = new Set();
      // Only exclude current-period statuses; do NOT exclude previous period so rollbacks can surface
      (curRes.items||[]).forEach(a=>{ if (isExcludedStatus(a?.status)) ids.add(Number(a?.recipient_id||0)); });

      // Fallback/augment: also check latest allocation per currently selected recipients
      try{
        const selectedIds = Array.from(document.querySelectorAll('#diSelected .di-card'))
          .map(el => Number(el.dataset.id)).filter(n => Number.isFinite(n) && n>0);
        if (selectedIds.length){
          const API = (typeof API_BASE_URL==='string' && API_BASE_URL) ? API_BASE_URL : '/Capstone%20Project/php/api';
          const fetchByRecipient = async (rid)=>{
            const url = `${API}/allocations/index.php?action=list_by_recipient&recipient_id=${encodeURIComponent(String(rid))}&t=${Date.now()}`;
            try { const res=await fetch(url,{credentials:'include',headers:{'Accept':'application/json'}}); const j=await res.json().catch(()=>null); return (res.ok&&j?.success&&Array.isArray(j?.data?.items))? j.data.items:[]; } catch(_){ return []; }
          };
          const histories = await Promise.all(selectedIds.map(async id=>{ const hist=await fetchByRecipient(id); const sorted=[...hist].sort((a,b)=> new Date(b.created_at||0)-new Date(a.created_at||0)); return { id, latest: sorted[0] }; }));
          histories.forEach(r=>{ if (r.latest && isExcludedStatus(r.latest.status)) ids.add(r.id); });
        }
      } catch(_){ }

      return ids;
    } catch(_){ return new Set(); }
  }
  function overrideBuildSelectedSimple(){
    try{
      if (window.__diBuildOverrideBound) return; window.__diBuildOverrideBound = true;
      const orig = window.buildSelectedSimple;
      window.buildSelectedSimple = async function(weeksMap, cancelledSet){
        try{
          const selected = qs('#diSelected'); const pool = qs('#diPool'); if (!selected || !pool) return;
          // Merge excluded from API statuses
          const apiExcluded = await fetchExcludedIdsForPeriods();
          const skip = new Set([...(cancelledSet instanceof Set? cancelledSet : []), ...apiExcluded]);
          // Compute desired ids using Scheduling
          const cur = (typeof getCurrentBucketNow==='function') ? getCurrentBucketNow() : 'W1';
          let ids = [];
          try { ids = window.Scheduling.buildSelectedIds(weeksMap, skip, { currentBucket: cur }); } catch(_){ ids = []; }
          // Prepend rollback candidates (previous-period cancelled)
          try {
            const carry = (window.__diCarryOverSet instanceof Set) ? window.__diCarryOverSet : new Set();
            if (carry && carry.size){
              const desired = [];
              carry.forEach(function(v){
                try{ const n = parseInt(v,10)||0; if (n>0 && !skip.has(n) && !ids.includes(n)) desired.push(n); } catch(_){ }
              });
              if (desired.length){ ids = desired.concat(ids); }
            }
          } catch(_){ }
          // Purge already-rendered excluded
          try {
            qsa('#diSelected .di-card').forEach(el=>{ const rid = parseInt(el.dataset.id||'0',10)||0; if (rid && skip.has(rid)) pool.appendChild(el); });
          } catch(_){ }
          // Render
          selected.innerHTML = '';
          ids.forEach(id=>{
            if (skip.has(id)) return;
            const card = qs(`.di-card[data-id="${id}"]`) || ensureCardForId(id);
            if (card) selected.appendChild(card);
          });
          try { updateSelectedCount(); } catch(_){ }
          try { updateHeaderMeta(); } catch(_){ }
          try { refreshBadges(); } catch(_){ }
        } catch(_){ }
      };
    } catch(_){ }
  }
  // Bind override on load
  try {
    if (document.readyState === 'loading'){
      document.addEventListener('DOMContentLoaded', overrideBuildSelectedSimple);
    } else { overrideBuildSelectedSimple(); }
  } catch(_){ }

  // Observe #diSelected for added nodes and purge excluded in real-time
  async function startExclusionObserver(){
    try{
      const selected = document.querySelector('#diSelected'); const pool = document.querySelector('#diPool');
      if (!selected || !pool) return;
      let excluded = await fetchExcludedIdsForPeriods();
      // Refresh excluded set periodically to reflect latest statuses
      setInterval(async ()=>{ try { excluded = await fetchExcludedIdsForPeriods(); } catch(_){} }, 30000);
      // Initial sweep
      try {
        selected.querySelectorAll('.di-card').forEach(el=>{ const rid=+el.dataset.id; if (excluded.has(rid)) pool.appendChild(el); });
      } catch(_){ }
      const observer = new MutationObserver((mutations)=>{
        try{
          mutations.forEach(m=>{
            m.addedNodes && m.addedNodes.forEach(node=>{
              if (!(node && node.nodeType===1)) return;
              if (!node.matches || !node.matches('.di-card')) return;
              const rid = +node.dataset.id;
              if (excluded.has(rid)) pool.appendChild(node);
            });
          });
          try { updateSelectedCount(); } catch(_){}
          try { refreshBadges(); } catch(_){}
        } catch(_){ }
      });
      observer.observe(selected, { childList:true });
      window.__diExclusionObserver = observer;
    } catch(_){ }
  }
  try {
    if (document.readyState === 'loading'){
      document.addEventListener('DOMContentLoaded', startExclusionObserver);
    } else { startExclusionObserver(); }
  } catch(_){ }
      const params = new URLSearchParams({ group: 'merge', page: '1', limit: '50' });
      if (cat) params.set('category', cat);
      fetch(`php/api/inventory/index.php/list?${params.toString()}`, { credentials: 'include' })
        .then(r=>r.json())
        .then(data => {
          const items = data?.data?.items || [];
          if (!items.length){ resolve({ applied:false }); return; }
          const popMap = buildRecipientPopulationMap();
          const recipients = ids.map(id => ({ id, population: popMap.get(Number(id)) }));
          let totalUnits = 0; let itemsProcessed = 0;
          items.forEach(it => {
            const name = (it.item_name ?? it.product_name ?? '').trim();
            const category = (it.category ?? it.product_category ?? '').trim();
            const totalQty = parseInt(it.total_quantity ?? it.quantity ?? 0, 10) || 0;
            if (!name || totalQty <= 0) return;
            const allocs = window.Allocation.allocateItems(totalQty, recipients);
            if (!Array.isArray(allocs) || !allocs.length) return;
            let itemUnits = 0;
            allocs.forEach(a => { const n = Math.max(0, parseInt(a.allocation||0,10)||0); if (n>0){ addAllocItemToRecipient(a.id, category, name, n); itemUnits += n; } });
            if (itemUnits>0){ totalUnits += itemUnits; itemsProcessed++; }
          });
          resolve({ applied: itemsProcessed>0 && totalUnits>0, totalUnits, itemsProcessed });
        })
        .catch(()=> resolve({ applied:false }));
    });
  }
  

  // Sort pool by week membership (W1..W4 order), then label
  function sortPoolByWeeks(){ try { return window.sortPoolByWeeks(); } catch(_){ } }

  // Delegated click handlers to move cards between Pool and Selected (covers dynamically added cards)
  function attachDelegatedInteractions(){ try { return window.attachDelegatedInteractions(); } catch(_){ } }

  // Search filter across both Pool and Selected by label text
  function attachSearch(){ try { return window.attachSearch(); } catch(_){ } }

  // Update Selected count badge
  function updateSelectedCount(){ try { return window.updateSelectedCount(); } catch(_){ } }

  // Build allocation carousel from current Selected
  function buildAllocCarouselFromSelected(){
    try {
      const inner = qs('#diAllocCarouselInner');
      const indicators = qs('#diAllocIndicators');
      const counter = qs('#diAllocCounter');
      const prevBtn = qs('#diAllocPrevBtn');
      const nextBtn = qs('#diAllocNextBtn');
      if (!inner || !indicators) return;
      const cards = qsa('#diSelected .di-card');
      inner.innerHTML = '';
      indicators.innerHTML = '';
      const ids = cards.map(c => parseInt(c.dataset.id||'0',10)).filter(Number.isFinite);
      window.__diAllocIds = ids;
      ids.forEach((id, idx) => {
        const label = (qs('.di-card-label', cards[idx])?.textContent||`Recipient ${id}`);
        const item = document.createElement('div');
        item.className = 'carousel-item' + (idx===0?' active':'');
        item.innerHTML = `<div class="p-3"><h6 class="mb-2">${label}</h6><div id="alloc-items-${id}"></div></div>`;
        inner.appendChild(item);
        const li = document.createElement('button');
        li.type = 'button';
        li.setAttribute('data-bs-target', '#diAllocCarousel');
        li.setAttribute('data-bs-slide-to', String(idx));
        if (idx===0) li.className = 'active';
        indicators.appendChild(li);
      });
      const total = ids.length;
      if (counter) counter.textContent = total ? `1 / ${total}` : '';
      // Show/hide nav depending on count
      try {
        const prevCtl = document.querySelector('#diAllocCarousel .carousel-control-prev');
        const nextCtl = document.querySelector('#diAllocCarousel .carousel-control-next');
        if (prevCtl && nextCtl){
          if (total > 1){ prevCtl.classList.remove('d-none'); nextCtl.classList.remove('d-none'); }
          else { prevCtl.classList.add('d-none'); nextCtl.classList.add('d-none'); }
        }
      } catch(_){ }
      // Update prev/next buttons to update counter
      try {
        const carouselEl = document.getElementById('diAllocCarousel');
        if (carouselEl && window.bootstrap?.Carousel){
          const c = window.bootstrap.Carousel.getOrCreateInstance(carouselEl, { interval: false, ride: false, touch: false });
          carouselEl.addEventListener('slid.bs.carousel', (ev)=>{
            const i = ev.to + 1; if (counter) counter.textContent = `${i} / ${total}`;
          });
          // Wire external prev/next
          if (prevBtn){ try { prevBtn.onclick = ()=> c.prev(); } catch(_){ } }
          if (nextBtn){ try { nextBtn.onclick = ()=> c.next(); } catch(_){ } }
        }
      } catch(_){ }
    } catch(_){ }
  }

  function getActiveAllocIndex(){
    const items = qsa('#diAllocCarousel .carousel-item');
    const idx = items.findIndex(el => el.classList.contains('active'));
    return idx < 0 ? 0 : idx;
  }
  function getActiveAllocRecipientId(){
    const idx = getActiveAllocIndex();
    const ids = Array.isArray(window.__diAllocIds)?window.__diAllocIds:[];
    return ids[idx] || null;
  }
  function addAllocItemToRecipient(recipientId, cat, name, qty){
    try{
      if (!recipientId) return;
      const host = document.getElementById('alloc-items-' + recipientId);
      if (!host) return;
      let list = host.querySelector('ul');
      if (!list){ list = document.createElement('ul'); list.className = 'list-unstyled mb-0'; host.appendChild(list); }
      const li = document.createElement('li');
      li.className = 'd-flex align-items-center justify-content-between border-bottom py-1 small';
      const label = [cat||'', name||''].filter(Boolean).join(' • ');
      const q = Math.max(1, parseInt(qty||1,10)||1);
      li.innerHTML = `<span class="alloc-label">${label}</span>
        <div class="d-flex align-items-center gap-2">
          <input type="number" class="form-control form-control-sm alloc-qty-input" min="1" value="${q}" style="width:80px" />
          <button type="button" class="btn btn-sm p-0 alloc-del-btn" aria-label="Remove">
            <i class="bi bi-x-lg text-danger"></i>
          </button>
        </div>`;
      list.appendChild(li);
      // Bind edit/delete handlers and prevent carousel from sliding on interaction
      const qtyInput = li.querySelector('.alloc-qty-input');
      if (qtyInput){
        const stopAll = (e)=>{ try{ e.stopImmediatePropagation(); }catch(_){} try{ e.stopPropagation(); }catch(_){} try{ e.preventDefault(); }catch(_){} };
        qtyInput.addEventListener('input', (e)=>{ const v = Math.max(1, parseInt(e.target.value||'1',10)||1); e.target.value = String(v); });
        ['click','mousedown','pointerdown','touchstart'].forEach(ev=> qtyInput.addEventListener(ev, stopAll, { capture: true }));
      }
      const delBtn = li.querySelector('.alloc-del-btn');
      if (delBtn){
        const stopAll = (e)=>{ try{ e.stopImmediatePropagation(); }catch(_){} try{ e.stopPropagation(); }catch(_){} try{ e.preventDefault(); }catch(_){} };
        delBtn.addEventListener('click', (e)=>{ stopAll(e); li.remove(); }, { capture: true });
        ['mousedown','pointerdown','touchstart'].forEach(ev=> delBtn.addEventListener(ev, stopAll, { capture: true }));
      }
    } catch(_){ }
  }

  function attachAllocGlobalControls(){
    // Prevent double-binding which caused duplicate adds
    if (window.__diAllocControlsBound) return;
    window.__diAllocControlsBound = true;
    const addBtn = qs('#diGlobalAddBtn');
    const autoAllBtn = qs('#diGlobalAutoAllBtn');
    const selCat = qs('#diGlobalCat');
    const selName = qs('#diGlobalName');
    const qtyInp = qs('#diGlobalQty');
    const getSelectLabel = (el)=>{
      if (!el) return '';
      const val = (el.value||'').trim();
      if (val) return val;
      const opt = el.selectedOptions && el.selectedOptions[0];
      if (opt && opt.text) return opt.text.trim();
      // Try Select2 rendered text
      try {
        const sel2 = el.nextElementSibling?.querySelector?.('.select2-selection__rendered');
        const txt = (sel2?.textContent||'').trim();
        if (txt && !/^(item name|category)$/i.test(txt)) return txt; // ignore placeholder labels
      } catch(_){ }
      return (el.textContent||'').trim();
    };
    if (addBtn){
      addBtn.addEventListener('click', ()=>{
        const cat = getSelectLabel(selCat);
        const name = getSelectLabel(selName);
        let qty = parseInt(qtyInp?.value||'0',10)||0;
        if (qty<=0) qty = 1;
        const rid = getActiveAllocRecipientId();
        if (!rid || !name){
          try { console.warn('[DI][alloc] add: invalid inputs', { rid, cat, name, qty }); } catch(_){ }
          const meta = qs('#diAllocMeta'); if (meta) meta.textContent = 'Please select an item name.';
          return;
        }
        addAllocItemToRecipient(rid, cat, name, qty);
      });
    }
    if (autoAllBtn){
      autoAllBtn.addEventListener('click', ()=>{
        const cat = getSelectLabel(selCat); // optional filter
        const ids = Array.isArray(window.__diAllocIds)?window.__diAllocIds:[];
        if (!ids.length){
          const meta = qs('#diAllocMeta'); if (meta) meta.textContent = 'Please select recipients first.';
          return;
        }
        tryAutoAllAllItems(cat, ids).then(res => {
          const meta = qs('#diAllocMeta');
          if (meta) meta.textContent = '';
        });
      });
    }
  }

  // Try algorithmic allocation by fetching total available for item/category from Inventory API
  function tryAlgorithmicAutoAll(cat, name, ids){
    return new Promise((resolve)=>{
      if (!(window.Allocation && typeof window.Allocation.allocateItems === 'function')){ resolve({ applied:false }); return; }
      const params = new URLSearchParams({ q: name, group: 'merge', page: '1', limit: '1' });
      if (cat) params.set('category', cat);
      // Ensure we have a fresh population map from the Allocation module
      const ensurePop = async ()=>{
        try{
          let list = Array.isArray(window.__diAllRecipients) ? window.__diAllRecipients : [];
          if ((!list || list.length===0) && typeof fetchRecipients === 'function'){
            list = await fetchRecipients();
            if (Array.isArray(list)) window.__diAllRecipients = list;
          }
          if (window.Allocation && typeof window.Allocation.buildPopulationMap === 'function'){
            return window.Allocation.buildPopulationMap(list||[]);
          }
        } catch(_){ }
        return new Map();
      };
      fetch(`php/api/inventory/index.php/list?${params.toString()}`, { credentials: 'include' })
        .then(r=>r.json()).then(data => {
          const items = data?.data?.items || [];
          const it = items[0] || {};
          const totalQty = parseInt(it?.total_quantity||it?.quantity||0,10)||0;
          if (totalQty <= 0){ resolve({ applied:false }); return; }
          // Tag filter: if item has tags, restrict recipients to those sharing at least one tag
          const itemTags = normalizeTags(it?.tags_concat || it?.tags || '');
          let eligibleIds = ids.slice();
          if (itemTags.size){
            const tagMap = buildRecipientTagMap();
            eligibleIds = ids.filter(id => hasTagIntersect(itemTags, tagMap.get(Number(id))));
            if (!eligibleIds.length){ resolve({ applied:false }); return; }
          }
          const allocatableTotal = Math.floor(totalQty * 0.9);
          ensurePop().then((popMap)=>{
            const recipients = (window.Allocation && typeof window.Allocation.recipientsWithPopulation==='function')
              ? window.Allocation.recipientsWithPopulation(eligibleIds, popMap)
              : eligibleIds.map(id => ({ id, population: popMap.get(Number(id)) }));
            try { console.debug('[DI][alloc] recipients (algo one)', recipients); } catch(_){ }
            const allocs = window.Allocation.allocateItems(allocatableTotal/0.9, recipients);
            if (!Array.isArray(allocs) || !allocs.length){ resolve({ applied:false }); return; }
            let sum = 0;
            allocs.forEach(a => { const n = Math.max(0, parseInt(a.allocation||0,10)||0); if (n>0){ addAllocItemToRecipient(a.id, cat, name, n); sum += n; } });
            resolve({ applied:true, sum });
          });
        }).catch(()=> resolve({ applied:false }));
    });
  }

  // Allocate ALL available inventory items (optionally filtered by category) across recipients
  function tryAutoAllAllItems(cat, ids){
    return new Promise((resolve)=>{
      if (!(Array.isArray(ids) && ids.length && window.Allocation && typeof window.Allocation.allocateItems==='function')){
        resolve({ applied:false }); return;
      }
      const params = new URLSearchParams({ group: 'merge', page: '1', limit: '50' });
      if (cat) params.set('category', cat);
      // Ensure we have a fresh population map from the Allocation module
      const ensurePopAll = async ()=>{
        try{
          let list = Array.isArray(window.__diAllRecipients) ? window.__diAllRecipients : [];
          if ((!list || list.length===0) && typeof fetchRecipients === 'function'){
            list = await fetchRecipients();
            if (Array.isArray(list)) window.__diAllRecipients = list;
          }
          if (window.Allocation && typeof window.Allocation.buildPopulationMap === 'function'){
            return window.Allocation.buildPopulationMap(list||[]);
          }
        } catch(_){ }
        return new Map();
      };
      fetch(`php/api/inventory/index.php/list?${params.toString()}`, { credentials: 'include' })
        .then(r=>r.json())
        .then(data => {
          const items = data?.data?.items || [];
          if (!items.length){ resolve({ applied:false }); return; }
          ensurePopAll().then((popMap)=>{
            const recipients = (window.Allocation && typeof window.Allocation.recipientsWithPopulation==='function')
              ? window.Allocation.recipientsWithPopulation(ids, popMap)
              : ids.map(id => ({ id, population: popMap.get(Number(id)) }));
            try { console.debug('[DI][alloc] recipients (all items)', recipients); } catch(_){ }
            let totalUnits = 0, itemsProcessed = 0;
            const tagMap = buildRecipientTagMap();
            items.forEach(it => {
              const name = (it.item_name ?? it.product_name ?? '').trim();
              const category = (it.category ?? it.product_category ?? '').trim();
              const totalQty = parseInt(it.total_quantity ?? it.quantity ?? 0, 10) || 0;
              if (!name || totalQty <= 0) return;
              // Determine eligible recipients by tag intersection
              const itemTags = normalizeTags(it?.tags_concat || it?.tags || '');
              const eligible = (itemTags.size)
                ? recipients.filter(r => hasTagIntersect(itemTags, tagMap.get(Number(r.id))))
                : recipients.slice();
              if (!eligible.length && itemTags.size) return; // specialty item with no matching recipients
              const allocs = window.Allocation.allocateItems(totalQty, eligible);
              if (!Array.isArray(allocs) || !allocs.length) return;
              let itemUnits = 0;
              allocs.forEach(a => { const n = Math.max(0, parseInt(a.allocation||0,10)||0); if (n>0){ addAllocItemToRecipient(a.id, category, name, n); itemUnits += n; } });
              if (itemUnits>0){ totalUnits += itemUnits; itemsProcessed++; }
            });
            resolve({ applied: itemsProcessed>0 && totalUnits>0, totalUnits, itemsProcessed });
          });
        })
        .catch(()=> resolve({ applied:false }));
    });
  }
  try { window.tryAutoAllAllItems = tryAutoAllAllItems; } catch(_){ }

  // Allocate Now: persist current carousel items to DB and redirect to DistributeResult.html
  function attachAllocateNow(){
    const btn = qs('#diAllocateWeek');
    if (!btn) return;
    if (btn.__bound) return; btn.__bound = true;
    btn.addEventListener('click', async ()=>{
      try{
        btn.disabled = true;
        const ids = Array.isArray(window.__diAllocIds)?window.__diAllocIds:[];
        if (!ids.length){ return; }
        // 1) Create a run
        const runRes = await fetch(`${API_BASE_URL}/allocations/index.php?action=create_run`, {
          method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: JSON.stringify({ note: 'Allocate Now from DistributeItems', period_key: null })
        });
        const runJ = await runRes.json().catch(()=>null);
        const runId = (runRes.ok && runJ?.success && runJ?.data?.run_id) ? parseInt(runJ.data.run_id,10)||0 : 0;
        if (!runId){ throw new Error(runJ?.error || 'Failed to create run'); }
        // 2) Build items per recipient from DOM
        const perRecipient = new Map();
        ids.forEach(rid => {
          const host = document.getElementById('alloc-items-' + rid);
          const rows = host ? Array.from(host.querySelectorAll('ul > li')) : [];
          const items = [];
          rows.forEach(li => {
            const label = (li.querySelector('.alloc-label')?.textContent||'').trim();
            const parts = label.split(' • ');
            const category = (parts.length>1 ? parts[0] : '') || null;
            const name = parts.length>1 ? parts[1] : (parts[0] || '');
            const qty = Math.max(1, parseInt(li.querySelector('.alloc-qty-input')?.value||'0',10)||0);
            if (name && qty>0){ items.push({ item_name: name, category, quantity: qty }); }
          });
          if (items.length) perRecipient.set(Number(rid), items);
        });
        // 3) Create results per recipient
        for (const [rid, items] of perRecipient.entries()){
          const payload = { recipient_id: rid, items, run_id: runId, allocation_code: null, notify_admin: false };
          const res = await fetch(`${API_BASE_URL}/allocations/index.php?action=create_result`, {
            method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body: JSON.stringify(payload)
          });
          const j = await res.json().catch(()=>null);
          // continue loop regardless of per-recipient errors
        }
        // 4) Redirect to result page for this run
        // Cache-bust to ensure latest DistributeResult.html and scripts load on first navigation
        const v = Date.now();
        window.location.href = `DistributeResult.html?run_id=${encodeURIComponent(String(runId))}&v=${v}`;
      } catch(_){
        // If anything fails, keep button enabled for retry
      } finally {
        try { btn.disabled = false; } catch(_){ }
      }
    });
  }

  // --- Tag utilities ---
  function normalizeTags(input){
    const set = new Set();
    try{
      const s = String(input||'');
      if (!s) return set;
      s.split(',').map(t=>t.trim()).filter(Boolean).forEach(t=> set.add(t.toLowerCase()));
    } catch(_){ }
    return set;
  }
  function buildRecipientTagMap(){
    const map = new Map();
    try{
      const all = Array.isArray(window.__diAllRecipients) ? window.__diAllRecipients : [];
      all.forEach(u => {
        const id = Number(u.user_id||u.id)||0; if (!id) return;
        const raw = u.tags || u.specialties || u.specialty_tags || u.preferences || '';
        map.set(id, normalizeTags(raw));
      });
    } catch(_){ }
    return map;
  }
  function hasTagIntersect(itemTagSet, recipientTagSet){
    try{
      if (!(itemTagSet instanceof Set) || !(recipientTagSet instanceof Set)) return false;
      for (const t of itemTagSet){ if (recipientTagSet.has(t)) return true; }
      return false;
    } catch(_){ return false; }
  }

  // Build a population map from available recipient fields
  function buildRecipientPopulationMap(){
    const map = new Map();
    try{
      const all = Array.isArray(window.__diAllRecipients) ? window.__diAllRecipients : [];
      all.forEach(u => {
        const id = parseInt(u.user_id||u.id,10)||0; if (!id) return;
        // Prefer DB-backed fields from recipient_profiles
        const totalResidents = Number(u.total_residents);
        const maleCnt = Number(u.male_count);
        const femaleCnt = Number(u.female_count);
        let pop = NaN;
        if (Number.isFinite(totalResidents) && totalResidents > 0){
          pop = totalResidents;
        } else if ((Number.isFinite(maleCnt) && maleCnt >= 0) || (Number.isFinite(femaleCnt) && femaleCnt >= 0)){
          const m = Number.isFinite(maleCnt) ? maleCnt : 0;
          const f = Number.isFinite(femaleCnt) ? femaleCnt : 0;
          const sum = m + f; if (sum > 0) pop = sum;
        }
        // Fallbacks for various front-end/API shapes
        if (!(Number.isFinite(pop) && pop > 0)){
          const candidates = [u.population, u.pop, u.beneficiaries, u.household_size, u.people, u.residents, u.members, u.population_total]
            .map(x=>Number(x))
            .filter(v=>Number.isFinite(v) && v>0);
          if (candidates.length) pop = candidates[0];
        }
        if (Number.isFinite(pop) && pop > 0){ map.set(id, pop); }
      });
    } catch(_){ }
    return map;
  }

  // Rebuild carousel and ensure controls when Allocation tab is shown (even without pressing Next)
  function attachAllocTabShown(){
    try {
      const allocTab = document.querySelector('button#di-alloc-tab');
      const recipientsTab = document.querySelector('button#di-recipients-tab');
      if (!allocTab) return;
      allocTab.addEventListener('shown.bs.tab', ()=>{
        try { buildAllocCarouselFromSelected(); } catch(_){ }
        try { attachAllocGlobalControls(); } catch(_){ }
        try { initAllocSelects(); } catch(_){ }
        try { attachAllocateNow(); } catch(_){ }
      });
      // Optional: when returning to Recipients tab, update Selected count
      if (recipientsTab){
        recipientsTab.addEventListener('shown.bs.tab', ()=>{ try { updateSelectedCount(); } catch(_){ } });
      }
    } catch(_){ }
  }

  // Initialize Select2 for Category and Item Name on Allocation tab
  function initAllocSelects(){
    try{
      if (window.jQuery && jQuery.fn && jQuery.fn.select2){
        const $ = window.jQuery;
        if ($('#diGlobalCat').length){
          if ($('#diGlobalCat').data('select2')) { $('#diGlobalCat').select2('destroy'); }
          $('#diGlobalCat').select2({
            placeholder: 'Category',
            width: '100%',
            allowClear: true,
            minimumInputLength: 1,
            ajax: {
              // Use Inventory API list (group=merge) and derive unique categories client-side
              url: 'php/api/inventory/index.php/list',
              dataType: 'json',
              delay: 250,
              data: p => ({ q: p.term || '', group: 'merge', page: 1, limit: 50 }),
              processResults: d => {
                try {
                  const items = d?.data?.items || [];
                  const seen = new Set();
                  const cats = [];
                  items.forEach(it => {
                    const c = (it.category ?? it.product_category ?? '').trim();
                    if (c && !seen.has(c)) { seen.add(c); cats.push({ id: c, text: c }); }
                  });
                  return { results: cats };
                } catch(_){ return { results: [] }; }
              }
            }
          }).on('select2:select', function(){
            try { $('#diGlobalName').val(null).trigger('change'); } catch(_){ }
          });
        }
        if ($('#diGlobalName').length){
          if ($('#diGlobalName').data('select2')) { $('#diGlobalName').select2('destroy'); }
          $('#diGlobalName').select2({
            placeholder: 'Item name',
            width: '100%',
            allowClear: true,
            minimumInputLength: 1,
            ajax: {
              // Use Inventory API list (group=merge) filtered by category to pull item_name
              url: 'php/api/inventory/index.php/list',
              dataType: 'json',
              delay: 250,
              data: p => ({ q: p.term || '', category: $('#diGlobalCat').val() || '', group: 'merge', page: 1, limit: 50 }),
              processResults: d => {
                try {
                  const items = d?.data?.items || [];
                  const seen = new Set();
                  const names = [];
                  items.forEach(it => {
                    const n = (it.item_name ?? it.product_name ?? '').trim();
                    if (n && !seen.has(n)) { seen.add(n); names.push({ id: n, text: n }); }
                  });
                  return { results: names };
                } catch(_){ return { results: [] }; }
              }
            }
          });
        }
      }
    } catch(_){ }
  }

  // Next button navigates to Allocation tab and builds carousel
  function attachNextButton(){
    const btn = qs('#diNextTabBtn');
    const allocTab = qs('#di-alloc-tab');
    if (!btn || !allocTab) return;
    btn.addEventListener('click', ()=>{
      try { buildAllocCarouselFromSelected(); } catch(_){ }
      try {
        if (window.bootstrap?.Tab){
          const tab = window.bootstrap.Tab.getOrCreateInstance(allocTab);
          tab.show();
        } else {
          allocTab.click();
        }
      } catch(_){ }
      try { attachAllocGlobalControls(); } catch(_){ }
    });
  }

  // If Selected is still empty, force-fill from carryovers -> current week -> other weeks (max 10)
  function forceSelectedFromPlanCarry(){
    try{
      const selected = qs('#diSelected'); const pool = qs('#diPool');
      if (!selected || !pool) return;
      if (qsa('#diSelected .di-card').length > 0) return; // already filled
      // Resolve weeks
      let weeks = (window.__diWeeks && typeof window.__diWeeks === 'object') ? window.__diWeeks : null;
      if (!weeks && Array.isArray(window.__diWeeksEx)){
        try { weeks = normalizeWeeksExToMap(window.__diWeeksEx); } catch(_){ weeks = null; }
      }
      if (!weeks) weeks = { W1:[], W2:[], W3:[], W4:[] };
      const toNums = (arr)=> (Array.isArray(arr)?arr:[]).map(v=>parseInt(v,10)).filter(n=>Number.isFinite(n)&&n>0);
      const map = { W1: toNums(weeks.W1), W2: toNums(weeks.W2), W3: toNums(weeks.W3), W4: toNums(weeks.W4) };
      const carry = (window.__diCarryOverSet instanceof Set) ? window.__diCarryOverSet : new Set();
      const cur = getCurrentBucketNow();
      const order = ['W1','W2','W3','W4'];
      const curIdx = ({W1:0,W2:1,W3:2,W4:3})[cur] ?? 0;
      const nextOrder = [ order[(curIdx+1)%4], order[(curIdx+2)%4], order[(curIdx+3)%4] ];
      const ids=[]; const push=(id)=>{ if(ids.length<10 && !ids.includes(id)) ids.push(id); };
      Array.from(carry).forEach(id=>push(id));
      map[cur].forEach(id=>push(id));
      nextOrder.forEach(b=> map[b].forEach(id=>{ if (cur!=='W1' && b==='W1' && !carry.has(id)) return; push(id); }));
      if (!ids.length) return;
      selected.innerHTML='';
      ids.forEach(id => { let card = qs(`.di-card[data-id="${id}"]`) || ensureCardForId(id); if (card) selected.appendChild(card); });
      try { sortSelectedByCarryovers(); } catch(_){ }
      updateSelectedCount(); updateHeaderMeta();
      try { refreshBadges(); } catch(_){ }
    } catch(_){ }
  }




  // Fetch allocations for a given period_key and return an array of items
  async function fetchRunAllocationsByPeriod(periodKey){
    try{
      // New universal read: list_by_period will ensure a run exists and return items
      const res = await fetch(`${API_BASE_URL}/allocations/index.php?action=list_by_period&period_key=${encodeURIComponent(periodKey)}&t=${Date.now()}`, { credentials:'include', headers:{'Accept':'application/json'} });
      if (res.status === 401){ return { items: [], ok: false, auth: true }; }
      const j = await res.json().catch(()=>null);
      if (!res.ok || !j?.success) return { items: [], ok: false };
      const items = Array.isArray(j?.data?.items) ? j.data.items : [];
      return { items, ok: true };
    } catch(_){ return { items: [], ok: false }; }
  }

  // Create a di-card for a recipient id if it doesn't exist in DOM
  function ensureCardForId(id){ try { return window.ensureCardForId(id); } catch(_){ return null; } }

  // Build __diAllRecipients from existing Pool DOM as a fallback
  function backfillRecipientsFromDom(){ try { return window.backfillRecipientsFromDom(); } catch(_){ } }

  // Strict plan-based selection builder (carryovers -> current week -> next -> others), W1 excluded when current!=W1 unless carryover
  function buildStrictPlanFinalIds(carrySet, weeks, curBucket){
    const toNums = (arr)=> (Array.isArray(arr)?arr:[]).map(v=>parseInt(v,10)).filter(n=>Number.isFinite(n)&&n>0);
    const map = { W1: toNums(weeks?.W1), W2: toNums(weeks?.W2), W3: toNums(weeks?.W3), W4: toNums(weeks?.W4) };
    const order = ['W1','W2','W3','W4'];
    const idx = ({W1:0,W2:1,W3:2,W4:3})[curBucket] ?? 0;
    const nextOrder = [ order[(idx+1)%4], order[(idx+2)%4], order[(idx+3)%4] ];
    const finalIds = Array.from(carrySet instanceof Set ? carrySet : new Set());
    const push = (id)=>{ if (finalIds.length<10 && !finalIds.includes(id)) finalIds.push(id); };
    map[curBucket].forEach(id => { if (!(carrySet instanceof Set && carrySet.has(id))) push(id); });
    nextOrder.forEach(b => { map[b].forEach(id => { if (curBucket!=='W1' && b==='W1' && !(carrySet instanceof Set && carrySet.has(id))) return; push(id); }); });
    return finalIds.slice(0,10);
  }

// Adapter: annotate cards using the extended plan; also persist a legacy-compatible weeks map
function annotateCardsWithWeeksEx(weeksEx){ try { return window.annotateCardsWithWeeksEx(weeksEx); } catch(_){ } }

// adminDistribute.js – SIMPLE_MODE enabled: legacy complex paths remain in file but are not executed.
(function(){
  'use strict';
  try { console.log('[DI] adminDistribute.js loaded'); } catch(_){ }

  const API_BASE_URL = (typeof window.API_BASE_URL === 'string' && window.API_BASE_URL)
    ? window.API_BASE_URL
    : '/Capstone%20Project/php/api';
  // Global toggle to enable/disable background polling
  const ENABLE_POLLING = false;
  // Minimal deterministic mode: use plan + cancelled to preload Selected
  const SIMPLE_MODE = true;

  const qs = (s, r=document)=> r.querySelector(s);
  const qsa = (s, r=document)=> Array.from(r.querySelectorAll(s));

  // Build Selected deterministically: carryovers (cancelled) -> current week -> others (max 10)
  function buildSelectedSimple(weeksMap, cancelledSet){
    try{
      const selected = qs('#diSelected'); const pool = qs('#diPool'); if (!selected || !pool) return;
      const cur = getCurrentBucketNow();
      let ids = [];
      try { ids = window.Scheduling.buildSelectedIds(weeksMap, cancelledSet, { currentBucket: cur }); } catch(_){ ids = []; }
      selected.innerHTML = '';
      ids.forEach(id => { const card = qs(`.di-card[data-id="${id}"]`) || ensureCardForId(id); if (card) selected.appendChild(card); });
      updateSelectedCount(); updateHeaderMeta();
      try { refreshBadges(); } catch(_){ }
    } catch(_){ }
  }

  async function simpleInit(){
    try { console.log('[DI][simple] init'); } catch(_){ }
    try { if (!window.__WEEK_START) { window.__WEEK_START = 'monday'; console.log('[DI][simple] defaulting __WEEK_START=monday'); } } catch(_){ }
    // One-time UI hooks
    try { attachSearch(); attachNextButton(); attachAllocTabShown(); } catch(_){ }
    // 1) Ensure recipients pool exists
    let recs = [];
    try {
      recs = await fetchRecipients();
      if (Array.isArray(recs) && recs.length){
        try { window.__diAllRecipients = recs; } catch(_){ }
        renderRecipientPools(recs, []);
        try { sortPoolByWeeks(); } catch(_){ }
        try { attachDelegatedInteractions(); } catch(_){ }
      }
    } catch(_){ recs = []; }
    // 2) Load plan (weekly list used by RecipientsList.html)
    let weeksMap = null;
    try {
      const data = await fetchMonthlyPlan(currentMonth());
      weeksMap = normalizeWeeksExToMap(data);
      try { window.__diWeeks = weeksMap; } catch(_){ }
      annotateCardsWithWeeks(weeksMap);
      try { console.log('[DI][simple] plan counts:', { W1:(weeksMap.W1||[]).length, W2:(weeksMap.W2||[]).length, W3:(weeksMap.W3||[]).length, W4:(weeksMap.W4||[]).length }, 'week_start:', getWeekStart()); } catch(_){ }
    } catch(_){ weeksMap = { W1:[], W2:[], W3:[], W4:[] }; }
    // 2a) If only W1 has items and W2..W4 are empty, try auto-detecting week-start and reloading plan
    try {
      const sizes = {
        W1: Array.isArray(weeksMap?.W1)?weeksMap.W1.length:0,
        W2: Array.isArray(weeksMap?.W2)?weeksMap.W2.length:0,
        W3: Array.isArray(weeksMap?.W3)?weeksMap.W3.length:0,
        W4: Array.isArray(weeksMap?.W4)?weeksMap.W4.length:0,
      };
      if (sizes.W1 > 0 && sizes.W2 === 0 && sizes.W3 === 0 && sizes.W4 === 0 && typeof window.autoDetectWeekStartAndPlan === 'function'){
        const chosen = await window.autoDetectWeekStartAndPlan(currentMonth());
        if (chosen && chosen.wm){
          weeksMap = chosen.wm;
          try { window.__WEEK_START = chosen.basis; } catch(_){ }
          try { window.__diWeeks = weeksMap; } catch(_){ }
          try { console.log('[DI][plan][fallback] basis:', chosen.basis, 'counts:', { W1:weeksMap.W1.length, W2:weeksMap.W2.length, W3:weeksMap.W3.length, W4:weeksMap.W4.length }); } catch(_){ }
          annotateCardsWithWeeks(weeksMap);
        }
      }
    } catch(_){ }
    // 2b) If plan is empty, fallback to any cached plan or seed from recipients
    try {
      const countPlan = (m)=> (['W1','W2','W3','W4'].reduce((s,k)=> s + ((Array.isArray(m?.[k])?m[k]:[]).length||0), 0));
      if (!weeksMap || countPlan(weeksMap) === 0){
        // Try cached window.__diWeeks
        if (window.__diWeeks && countPlan(window.__diWeeks) > 0){
          weeksMap = window.__diWeeks;
        } else if (Array.isArray(window.__diWeeksEx) && window.__diWeeksEx.length > 0){
          weeksMap = normalizeWeeksExToMap(window.__diWeeksEx);
        } else if (Array.isArray(recs) && recs.length > 0){
          // Seed current week with first 10 recipients
          const cur = getCurrentBucketNow();
          const ids = recs.slice(0,10).map(u => parseInt(u.user_id||u.id,10)).filter(Number.isFinite);
          weeksMap = { W1:[], W2:[], W3:[], W4:[] };
          weeksMap[cur] = ids;
        } else {
          weeksMap = { W1:[], W2:[], W3:[], W4:[] };
        }
        try { window.__diWeeks = weeksMap; } catch(_){ }
        annotateCardsWithWeeks(weeksMap);
      }
    } catch(_){ }
    // 3) Previous period and cancelled recipients (carryovers)
    let cancelledSet = new Set();
    try {
      const prevPk = getPreviousPeriodKey();
      const prev = await fetchRunAllocationsByPeriod(prevPk);
      const norm = (s)=> String(s||'').trim().toLowerCase();
      const CANCEL = new Set(['cancelled','canceled','declined','no show']);
      const ids = (prev.ok ? prev.items : []).filter(a=>CANCEL.has(norm(a.status))).map(a=>parseInt(a.recipient_id,10)).filter(Number.isFinite);
      cancelledSet = new Set(ids);
      try { window.__diCarryOverSet = new Set(ids); } catch(_){ }
    } catch(_){ cancelledSet = new Set(); }
    // 4) Materialize cards for all planned IDs so Pool/Selected aren’t blank
    try {
      const allIds = ['W1','W2','W3','W4']
        .flatMap(k => (Array.isArray(weeksMap?.[k])?weeksMap[k]:[]))
        .map(v=>parseInt(v,10))
        .filter(Number.isFinite);
      allIds.forEach(id => { ensureCardForId(id); });
      try { sortPoolByWeeks(); } catch(_){ }
      try { attachDelegatedInteractions(); } catch(_){ }
    } catch(_){ }
    // 5) Deterministic Selected
    buildSelectedSimple(weeksMap, cancelledSet);
    try { console.log('[DI][simple] selected size:', qsa('#diSelected .di-card').length); } catch(_){ }
    // 6) Last-resort guarantee: if still empty, synthesize visible content
    try {
      const poolCount = qsa('#diPool .di-card').length;
      const selCount = qsa('#diSelected .di-card').length;
      if (poolCount === 0){
        const placeholders = Array.from({length:10}, (_,i)=> i+1);
        placeholders.forEach(id => { ensureCardForId(id); });
      }
      if (qsa('#diSelected .di-card').length === 0){
        const cur = getCurrentBucketNow();
        const placeholders = Array.from({length:10}, (_,i)=> i+1);
        if (!weeksMap || (['W1','W2','W3','W4'].every(k => !(Array.isArray(weeksMap?.[k]) && weeksMap[k].length)))){
          weeksMap = { W1:[], W2:[], W3:[], W4:[] };
          weeksMap[cur] = placeholders;
        }
        buildSelectedSimple(weeksMap, cancelledSet);
      }
    } catch(_){ }
    // Final UI touches
    try { sortPoolByWeeks(); } catch(_){ }
    try { attachDelegatedInteractions(); } catch(_){ }
  }

  // Early resilient console stub for reload
  try {
    window.diReload = () => {
      try {
        if (SIMPLE_MODE && typeof simpleInit === 'function') return simpleInit();
        if (typeof init === 'function') return init();
      } catch(_){}
    };
  } catch(_){ }

  

  // Treat any of these as cancellation statuses from DB
  const CANCEL_STATUSES = new Set(['Cancelled','Canceled','Declined','No Show']);
  const COMPLETED_STATUSES = new Set(['Completed','Done','Delivered','Fulfilled']);

  // Periodic sync loop removed in SIMPLE_MODE

  // Helpers
  function getWeekStart(){
    try { if (typeof window.getWeekStart === 'function') return window.getWeekStart(); } catch(_){ }
    try { if (typeof window.__WEEK_START === 'string' && window.__WEEK_START) return window.__WEEK_START; } catch(_){ }
    return 'monday';
  }
  function diGetBaseDate(){ try { return window.diGetBaseDate(); } catch(_){ const d=new Date(); d.setHours(0,0,0,0); return d; } }
  function formatYMD(d){ return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
  function startOfWeek(date, weekStart){
    const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const targetDow = (weekStart === 'monday') ? 1 : 0;
    const dow = d.getDay();
    const diff = (dow - targetDow + 7) % 7;
    d.setDate(d.getDate() - diff);
    d.setHours(0,0,0,0);
    return d;
  }
  function isoWeekNumber(date){
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7; // Sun=7
    d.setUTCDate(d.getUTCDate() + 4 - dayNum); // nearest Thursday
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  }
  function colorForIsoWeek(iso){ const idx = (iso % 4) + 1; return idx===1?'primary':idx===2?'danger':idx===3?'warning':'info'; }
  function planWeekIndexForDate(d){ const day = d.getDate(); if (day<=7) return 1; if (day<=14) return 2; if (day<=21) return 3; return 4; }
  function upcomingWeekStartDates(weekStart){
    // Not used for indexing anymore; kept for reference
    const base=diGetBaseDate(); return [0,1,2,3].map(i=> new Date(base.getFullYear(), base.getMonth(), base.getDate()+i*7));
  }
  function planWeekIndexByWeekStart(base){ try { return window.planWeekIndexByWeekStart(base); } catch(_){ return planWeekIndexForDate(base); } }
  // Compute current week bucket using FIXED buckets (1-7=W1, 8-14=W2, 15-21=W3, 22+=W4)
  function resolveCurrentWeekBucket(){ try { return window.resolveCurrentWeekBucket(); } catch(_){ const idx = planWeekIndexForDate(diGetBaseDate()); return idx===1?'W1':idx===2?'W2':idx===3?'W3':'W4'; } }

  // Use today's date (not #diBaseDate) for selection logic to avoid stale input forcing W1
  function getCurrentBucketNow(){ try { return window.getCurrentBucketNow(); } catch(_){ const idx = planWeekIndexForDate(new Date()); return idx===1?'W1':idx===2?'W2':idx===3?'W3':'W4'; } }

  // Build a period_key from base date using FIXED buckets (W1..W4)
  function getPeriodKeyFromInputs(){ try { return window.getPeriodKeyFromInputs(); } catch(_){ const base=diGetBaseDate(); const month=`${base.getFullYear()}-${String(base.getMonth()+1).padStart(2,'0')}`; const idx=planWeekIndexForDate(base); return `${month}-W${idx}`; } }

  // Compute the previous period key using FIXED week index (if current is W1, go to previous month W4)
  function getPreviousPeriodKey(){ try { return window.getPreviousPeriodKey(); } catch(_){ const base=diGetBaseDate(); let year=base.getFullYear(); let monthNum=base.getMonth()+1; const idx=planWeekIndexForDate(base); let prevIdx=idx-1; if (prevIdx<1){ prevIdx=4; monthNum-=1; if (monthNum<1){ monthNum=12; year-=1; } } const mm=String(monthNum).padStart(2,'0'); return `${year}-${mm}-W${prevIdx}`; } }

  // Query server to compute previous week carryovers and expose them globally
  async function finalizeCurrentWeekIfPossible(){ try { return await window.finalizeCurrentWeekIfPossible(); } catch(_){ } }

  function showAuthBanner(){ try { return window.showAuthBanner(); } catch(_){ } }

  function currentMonth(){ try { return window.currentMonth(); } catch(_){ const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`; } }

  async function fetchMonthlyPlan(month){ try { return await window.fetchMonthlyPlan(month); } catch(_){ return { month: month||currentMonth(), weeks_ex: [] }; } }

  // Badge annotate
  function annotateCardsWithWeeks(weeksMap){ try { return window.annotateCardsWithWeeks(weeksMap); } catch(_){ } }

  // Ensure current-week recipients in Selected have a badge and matching border, without overriding carryovers
  function ensureCurrentWeekDecor(weeksMap){ try { return window.ensureCurrentWeekDecor(weeksMap); } catch(_){ } }

  function updateSelectedCount(){ try { return window.updateSelectedCount(); } catch(_){ } }

  // Update current week header meta if container exists
  function updateHeaderMeta(){ try { return window.updateHeaderMeta(); } catch(_){ } }

  function getSelectedIds(){ return qsa('#diSelected .di-card').map(el => parseInt(el.dataset.id, 10)); }

  async function updateAllocateNowState(){ /* keep UI responsive; logic handled server-side elsewhere */ }

  function refreshBadges(){ try { return window.refreshBadges(); } catch(_){ } }

  // Core: Sync and build Selected with replacement rules
  async function syncSelectedWithRunAllocations(){
    try{
      const pk = getPeriodKeyFromInputs();
      if (!pk) return;

      const runRes = await fetch(`${API_BASE_URL}/allocations/index.php?action=run_by_period&period_key=${encodeURIComponent(pk)}&t=${Date.now()}`, { credentials:'include', headers:{'Accept':'application/json'} });
      const runJ = await runRes.json().catch(()=>null);
      if (runRes.status === 401){
        window.__diAuthRequired = true;
        try { showAuthBanner(); } catch(_){ }
        return; // keep existing DOM
      }
      const selected = qs('#diSelected'); const pool = qs('#diPool'); if (!selected || !pool) return;
      // Ensure recipients list is available for materializing cards later
      if (!Array.isArray(window.__diAllRecipients) || window.__diAllRecipients.length === 0){
        try { window.__diAllRecipients = await fetchRecipients(); } catch(_){ window.__diAllRecipients = []; }
        if (!Array.isArray(window.__diAllRecipients) || window.__diAllRecipients.length === 0){ backfillRecipientsFromDom(); }
      }

      // Weeks plan
      let weeks = (window.__diWeeks && typeof window.__diWeeks === 'object') ? window.__diWeeks : null;
      if (!weeks && Array.isArray(window.__diWeeksEx)){
        try { weeks = normalizeWeeksExToMap(window.__diWeeksEx); } catch(_){ weeks = null; }
      }
      try {
        if (weeks){
          console.log('[DI] plan sizes:', {
            W1: Array.isArray(weeks.W1)?weeks.W1.length:0,
            W2: Array.isArray(weeks.W2)?weeks.W2.length:0,
            W3: Array.isArray(weeks.W3)?weeks.W3.length:0,
            W4: Array.isArray(weeks.W4)?weeks.W4.length:0,
          });
        }
      } catch(_){ }

      // Previous period statuses to drive rollback and replacement drop
      const prevPk = getPreviousPeriodKey();
      // Expose previous period key so annotate can color carryovers consistently
      try { window.__diPrevWeekKey = prevPk; } catch(_){ }
      const prevRes = await fetchRunAllocationsByPeriod(prevPk);
      const prevItems = prevRes.ok ? prevRes.items : [];
      const norm = (s)=> String(s||'').trim().toLowerCase();
      const CANCEL_LC = new Set(['cancelled','canceled','declined','no show']);
      const COMPLETE_LC = new Set(['completed','done','delivered','fulfilled']);
      const prevCancelled = new Set(
        prevItems
          .filter(a => CANCEL_LC.has(norm(a.status)))
          .map(a => parseInt(a.recipient_id,10))
          .filter(Number.isFinite)
      );
      const prevCompleted = new Set(
        prevItems
          .filter(a => COMPLETE_LC.has(norm(a.status)))
          .map(a => parseInt(a.recipient_id,10))
          .filter(Number.isFinite)
      );
      // Merge prev cancelled into carryover set produced by finalize (server may already return same)
      const mergedCarry = new Set(window.__diCarryOverSet instanceof Set ? Array.from(window.__diCarryOverSet) : []);
      prevCancelled.forEach(id => mergedCarry.add(id));
      window.__diCarryOverSet = mergedCarry;

      if (!runRes.ok || !runJ?.success || !runJ?.data?.run_id){
        if (weeks){
          const toNums = (arr)=> (Array.isArray(arr)?arr:[]).map(v=>parseInt(v,10)).filter(n=>Number.isFinite(n)&&n>0);
          const curBucket = getCurrentBucketNow();
          const curKey = curBucket; // 'W1'|'W2'|'W3'|'W4' (fixed buckets)
          const idxMap = { W1:1, W2:2, W3:3, W4:4 };
          const curIdx = idxMap[curBucket] || 1;
          const nextIdx = Math.min(curIdx + 1, 4);
          const nextKey0 = nextIdx === 1 ? 'W1' : nextIdx === 2 ? 'W2' : nextIdx === 3 ? 'W3' : 'W4';
          const forcedNextKey = (curBucket==='W1') ? 'W2' : nextKey0;
          const order = ['W1','W2','W3','W4'].filter(k => k!==curKey && k!==forcedNextKey);
          const carrySet = (window.__diCarryOverSet instanceof Set) ? window.__diCarryOverSet : new Set();
          let finalIds = Array.from(carrySet);
          // current week's plan first
          toNums(weeks[curKey]).slice(0,10).forEach(id => { if (finalIds.length<10 && !finalIds.includes(id)) finalIds.push(id); });
          // then immediate next week as replacements
          toNums(weeks[forcedNextKey]).forEach(id => { if (finalIds.length<10 && !finalIds.includes(id) && !prevCompleted.has(id)) finalIds.push(id); });
          // then the remaining weeks
          order.forEach(k => { toNums(weeks[k]).forEach(id => { if (finalIds.length<10 && !finalIds.includes(id) && !prevCompleted.has(id)) finalIds.push(id); }); });
          // If not W1, exclude W1 items unless they are true carryovers, BUT only if current week has plan entries
          try {
            const curBucket = resolveCurrentWeekBucket();
            const curHas = Array.isArray(weeks[curKey]) && weeks[curKey].length > 0;
            if (curBucket !== 'W1' && curHas){
              const W1set = new Set(toNums(weeks.W1));
              finalIds = finalIds.filter(id => !W1set.has(id) || carrySet.has(id));
            }
          } catch(_){ }
          // If still empty, build strictly from plan
          if (!finalIds.length){
            const strictIds = buildStrictPlanFinalIds(carrySet, weeks, resolveCurrentWeekBucket());
            if (strictIds.length){ finalIds = strictIds; }
          }
          // If still not enough, fallback to all recipients, excluding completed/cancelled and duplicates
          try {
            if (finalIds.length < 10 && Array.isArray(window.__diAllRecipients)){
              const disallowed = new Set(finalIds.concat(Array.from(prevCompleted)));
              const banned = new Set();
              // we also should not include cancelled this week
              // derive currentCancelled from prevCancelled? not needed here, keep simple
              window.__diAllRecipients.forEach(u => {
                const id = parseInt(u.user_id||u.id,10)||0;
                if (!id) return;
                if (disallowed.has(id)) return;
                if (banned.has(id)) return;
                finalIds.length<10 && finalIds.push(id);
                banned.add(id);
              });
            }
          } catch(_){ }
          if (finalIds.length){
            selected.innerHTML = '';
            finalIds.forEach(id => { const card = qs(`.di-card[data-id="${id}"]`) || ensureCardForId(id); if (card) selected.appendChild(card); });
          } else {
            try { console.warn('[DI] No fallback finalIds computed; keeping previous Selected'); } catch(_){ }
            return;
          }
          try { sortSelectedByCarryovers(); } catch(_){ }
          updateSelectedCount();
          updateHeaderMeta();
          try { console.log('[DI] built (no-run) finalIds:', finalIds); } catch(_){ }
        } else {
          const cards = qsa('#diPool .di-card').slice(0,10);
          if (cards.length){
            selected.innerHTML = '';
            cards.forEach(card => selected.appendChild(card));
          } else {
            try { console.warn('[DI] Pool empty and no weeks plan; keeping previous Selected'); } catch(_){ }
            return;
          }
          updateSelectedCount();
          updateHeaderMeta();
        }
        return;
      }

      const runId = parseInt(runJ.data.run_id,10)||0; if (!runId) return;
      const listRes = await fetch(`${API_BASE_URL}/allocations/index.php?action=list_by_run&run_id=${encodeURIComponent(String(runId))}&t=${Date.now()}`, { credentials:'include', headers:{'Accept':'application/json'} });
      const listJ = await listRes.json().catch(()=>null);
      if (!listRes.ok || !listJ?.success) return;
      const arr = Array.isArray(listJ?.data?.items) ? listJ.data.items : [];

      const activeStatuses = new Set(['Pending','Notified','Acknowledged','Scheduled']);
      const activeIds = Array.from(new Set(
        arr.filter(a => activeStatuses.has(String(a.status||'').trim()))
           .map(a => parseInt(a.recipient_id,10))
           .filter(n=>Number.isFinite(n)&&n>0)
      ));
      try { window.__diActiveIds = activeIds.slice(); } catch(_){ }
      const cancelledIds = arr.filter(a => CANCEL_LC.has(norm(a.status))).map(a=>parseInt(a.recipient_id,10)).filter(Number.isFinite);
      const currentCompleted = new Set(
        arr.filter(a => COMPLETE_LC.has(norm(a.status)))
           .map(a => parseInt(a.recipient_id,10))
           .filter(Number.isFinite)
      );

      // Build exact 10 preloaded recipients based on current plan, with replacements from immediate next week
      const toNums = (arr)=> (Array.isArray(arr)?arr:[]).map(v=>parseInt(v,10)).filter(n=>Number.isFinite(n)&&n>0);
      const W1all = toNums(weeks?.W1); const W2all = toNums(weeks?.W2); const W3all = toNums(weeks?.W3); const W4all = toNums(weeks?.W4);
      const cancelledSet = new Set(cancelledIds);
      const curIdx = planWeekIndexByWeekStart(diGetBaseDate());
      const curKey = curIdx === 1 ? 'W1' : curIdx === 2 ? 'W2' : curIdx === 3 ? 'W3' : 'W4';
      const nextIdx = Math.min(curIdx + 1, 4);
      const nextKey0 = nextIdx === 1 ? 'W1' : nextIdx === 2 ? 'W2' : nextIdx === 3 ? 'W3' : 'W4';
      const forcedNextKey = (resolveCurrentWeekBucket()==='W1') ? 'W2' : nextKey0;
      const arrForKey = (k)=> k==='W1'?W1all : k==='W2'?W2all : k==='W3'?W3all : W4all;
      const curAll = arrForKey(curKey);
      const nextAll = arrForKey(forcedNextKey);
      const curFirst10 = curAll.slice(0,10);

      // Start with carryovers from previous week (rollback: prioritize cancelled recipients in the new week)
      const carrySet = (window.__diCarryOverSet instanceof Set) ? window.__diCarryOverSet : new Set();
      let finalIds = Array.from(carrySet);
      // Ensure active (already allocated in current run) stay included
      finalIds = finalIds.concat(activeIds.filter(id => !finalIds.includes(id) && !cancelledSet.has(id)));
      for (const id of curFirst10){ if (finalIds.length>=10) break; if (cancelledSet.has(id)) continue; if (finalIds.includes(id)) continue; finalIds.push(id); }
      const repMap = {};
      for (const id of nextAll){ if (finalIds.length>=10) break; if (cancelledSet.has(id)) continue; if (finalIds.includes(id)) continue; finalIds.push(id); repMap[id] = forcedNextKey; }
      if (finalIds.length < 10){
        const curRest = curAll.slice(10);
        for (const id of curRest){ if (finalIds.length>=10) break; if (cancelledSet.has(id)) continue; if (finalIds.includes(id)) continue; finalIds.push(id); }
      }
      if (finalIds.length < 10){
        const others = [W1all, W2all, W3all, W4all];
        for (const arr2 of others){ for (const id of arr2){ if (finalIds.length>=10) break; if (cancelledSet.has(id)) continue; if (finalIds.includes(id)) continue; finalIds.push(id); } if (finalIds.length>=10) break; }
      }

      try { window.__diReplacementSource = repMap; } catch(_){ }
      // If not W1, exclude W1 items unless they are true carryovers
      try {
        const curBucket = getCurrentWeekBucket();
        const curHas = curAll.length > 0;
        if (curBucket !== 'W1' && curHas){
          const W1set = new Set(W1all);
          finalIds = finalIds.filter(id => !W1set.has(id) || (window.__diCarryOverSet instanceof Set && window.__diCarryOverSet.has(id)));
        }
      } catch(_){ }
      // Finally, drop any previous-week completed IDs from the list (they were replacements last week)
      finalIds = finalIds.filter(id => !prevCompleted.has(id) || (window.__diCarryOverSet instanceof Set && window.__diCarryOverSet.has(id)));
      // If filters left us with 0, attempt strict plan build
      if (!finalIds.length){
        const strictIds = buildStrictPlanFinalIds(window.__diCarryOverSet, { W1:W1all, W2:W2all, W3:W3all, W4:W4all }, getCurrentWeekBucket());
        if (strictIds.length){ finalIds = strictIds; }
      }
      // If still not enough, fallback to all recipients excluding completed/cancelled/currentCompleted
      try {
        if (finalIds.length < 10 && Array.isArray(window.__diAllRecipients)){
          const disallowed = new Set(finalIds.concat(Array.from(prevCompleted)));
          const banned = new Set(cancelledIds.concat(Array.from(currentCompleted)));
          window.__diAllRecipients.forEach(u => {
            const id = parseInt(u.user_id||u.id,10)||0;
            if (!id) return;
            if (disallowed.has(id)) return;
            if (banned.has(id)) return;
            finalIds.length<10 && finalIds.push(id);
            disallowed.add(id);
          });
        }
      } catch(_){ }
      try { console.log('[DI] replacement using cur/next:', { baseDate: formatYMD(diGetBaseDate()), curKey, forcedNextKey, finalIds, repMap }); } catch(_){ }

      if (finalIds.length === 0){
        try { console.warn('[DI] Computed empty finalIds; leaving Selected unchanged'); } catch(_){ }
        // Final zero-guard: if plan exists for current bucket, render strictly from plan so Selected is never empty
        try {
          let weeks2 = (window.__diWeeks && typeof window.__diWeeks === 'object') ? window.__diWeeks : null;
          if (!weeks2 && Array.isArray(window.__diWeeksEx)){
            try { weeks2 = normalizeWeeksExToMap(window.__diWeeksEx); } catch(_){ weeks2 = null; }
          }
          const curBucket = resolveCurrentWeekBucket();
          if (weeks2 && Array.isArray(weeks2[curBucket]) && weeks2[curBucket].length){
            const strictIds = buildStrictPlanFinalIds(window.__diCarryOverSet, weeks2, curBucket);
            if (strictIds.length){
              selected.innerHTML = '';
              strictIds.forEach(id => { let card = qs(`.di-card[data-id="${id}"]`) || ensureCardForId(id); if (card) selected.appendChild(card); });
              updateSelectedCount(); updateHeaderMeta(); try { refreshBadges(); } catch(_){ }
            }
          }
        } catch(_){ }
        return;
      }
      selected.innerHTML = '';
      finalIds.forEach(id => {
        let card = qs(`.di-card[data-id="${id}"]`);
        if (!card) card = ensureCardForId(id);
        if (card) selected.appendChild(card);
      });
      // If still empty due to missing DOM cards, attempt to render pool and retry
      if (selected.children.length === 0 && Array.isArray(window.__diAllRecipients) && window.__diAllRecipients.length){
        renderRecipientPools(window.__diAllRecipients, []);
        finalIds.forEach(id => {
          let card = qs(`.di-card[data-id="${id}"]`);
          if (!card) card = ensureCardForId(id);
          if (card) selected.appendChild(card);
        });
      }
      try { sortSelectedByCarryovers(); } catch(_){ }
      updateSelectedCount();
      updateHeaderMeta();
      try { refreshBadges(); } catch(_){ }
      // If Selected stayed empty due to lack of run data, ensure plan-based fallback renders something
      ensureSelectedHasPlanFallback();
    } catch(_){ /* non-fatal */ }
  }

  function sortSelectedByCarryovers(){ try { return window.sortSelectedByCarryovers(); } catch(_){ } }

  // --- Recipients fetch and render ---
  async function fetchRecipients(){ try { return await window.fetchRecipients(); } catch(_){ return []; } }

  function renderRecipientPools(items, selectedIds = []){ try { return window.renderRecipientPools(items, selectedIds); } catch(_){ } }

  

  // Legacy init is unused in SIMPLE_MODE
  async function init(){ try { console.log('[DI] init skipped (SIMPLE_MODE)'); } catch(_){} }

  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', () => {
      if (SIMPLE_MODE && typeof window.SchedulingAlgorithmUISimpleInit === 'function') window.SchedulingAlgorithmUISimpleInit();
      else if (typeof init === 'function') init();
    });
  } else {
    if (SIMPLE_MODE && typeof window.SchedulingAlgorithmUISimpleInit === 'function') window.SchedulingAlgorithmUISimpleInit();
    else if (typeof init === 'function') init();
  }
  // Minimal console exports for debugging in SIMPLE_MODE
  try {
    window.diGetCurrentWeekBucket = getCurrentBucketNow;
    window.diGetPeriodKey = getPeriodKeyFromInputs;
    window.diReload = SIMPLE_MODE ? (function(){ return (typeof window.SchedulingAlgorithmUISimpleInit==='function' ? window.SchedulingAlgorithmUISimpleInit() : undefined); }) : init;
  } catch(_){ }
})();










