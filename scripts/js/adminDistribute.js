(function(){
  'use strict';

  const API_BASE_URL = (typeof window.API_BASE_URL === 'string' && window.API_BASE_URL)
    ? window.API_BASE_URL
    : '/Capstone%20Project/php/api';

  const qs = (s, r=document)=> r.querySelector(s);
  const qsa = (s, r=document)=> Array.from(r.querySelectorAll(s));

  function showMsg(el, msg, type='secondary'){
    if (!el) return;
    el.innerHTML = msg ? `<div class="alert alert-${type} py-2 mb-0">${msg}</div>` : '';
  }

  async function fetchJson(url, opts={}){
    const res = await fetch(url, opts);
    const ct = (res.headers.get('content-type')||'').toLowerCase();
    if (ct.includes('application/json')){
      try {
        const j = await res.json();
        if (!res.ok || !j){
          const err = new Error((j && j.error) ? j.error : `HTTP ${res.status}`);
          err.status = res.status; throw err;
        }
        return j;
      } catch(parseErr){
        try {
          const raw = await res.clone().text();
          // Fallback: if it looks like JSON, try to parse
          const looksJson = raw && (raw.trim().startsWith('{') || raw.trim().startsWith('['));
          if (looksJson){
            const j = JSON.parse(raw);
            if (!res.ok || !j){
              const err = new Error((j && j.error) ? j.error : `HTTP ${res.status}`);
              err.status = res.status; throw err;
            }
            return j;
          }
          const snippet = (raw || '').slice(0, 300);
          const err = new Error(`Invalid JSON (HTTP ${res.status}). Snippet: ${snippet}`);
          err.status = res.status; throw err;
        } catch(_) {
          const err = new Error(`Invalid JSON (HTTP ${res.status}).`);
          err.status = res.status; throw err;
        }
      }
    } else {
      // Content-Type not JSON. Still try to parse body if it looks like JSON.
      const text = await res.text();
      const trimmed = (text || '').trim();
      if (trimmed.startsWith('{') || trimmed.startsWith('[')){
        try {
          const j = JSON.parse(trimmed);
          if (!res.ok || !j){
            const err = new Error((j && j.error) ? j.error : `HTTP ${res.status}`);
            err.status = res.status; throw err;
          }
          return j;
        } catch(parseErr){
          const snippet = trimmed.slice(0, 300);
          const err = new Error(`Invalid JSON (HTTP ${res.status}). Snippet: ${snippet}`);
          err.status = res.status; throw err;
        }
      }
      const snippet = trimmed.slice(0, 300);
      const err = new Error(`Non-JSON response (HTTP ${res.status}). Snippet: ${snippet}`);
      err.status = res.status; throw err;
    }
  }

  async function finalizeCurrentWeekIfPossible(){
    try{
      const pk = getPeriodKeyFromInputs();
      if (!pk) return;
      const weekStart = getWeekStart();
      const res = await fetch(`${API_BASE_URL}/recipients_list.php?action=finalize_week&period_key=${encodeURIComponent(pk)}&week_start=${encodeURIComponent(weekStart)}`, { credentials: 'include' });
      const j = await res.json().catch(()=>null);
      if (j && j.success){
        const prevKey = j.data?.previous_period_key || null;
        const carry = Array.isArray(j.data?.carry_overs) ? j.data.carry_overs.map(n=>parseInt(n,10)).filter(n=>Number.isFinite(n)&&n>0) : [];
        window.__diPrevWeekKey = prevKey;
        window.__diCarryOverSet = new Set(carry);
      } else {
        window.__diPrevWeekKey = null;
        window.__diCarryOverSet = new Set();
      }
    } catch(err){ /* non-fatal: UI can still load */ }
  }

  function updateCurrentWeekBadge(){
    const badge = qs('#diCurrentWeek');
    if (!badge) return;
    const basis = getWeekStart();
    const starts = upcomingWeekStartDates(basis);
    const wn = weekNumber(starts[0]||new Date(), basis);
    const idx = 1; // current is W1
    const color = idx===1 ? 'primary' : idx===2 ? 'danger' : idx===3 ? 'warning' : 'info';
    badge.textContent = `W${wn}`;
    badge.className = `badge bg-${color}`;
  }

  function currentMonth(){
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
  }

  // Helpers to mirror RecipientsList week-of-year labeling
  function isoWeekNumber(date){
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7; // Sun=7
    d.setUTCDate(d.getUTCDate() + 4 - dayNum); // nearest Thursday
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  }
  function startOfWeek(date, weekStart){
    const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const targetDow = (weekStart === 'monday') ? 1 : 0;
    const dow = d.getDay();
    const diff = (dow - targetDow + 7) % 7;
    d.setDate(d.getDate() - diff);
    d.setHours(0,0,0,0);
    return d;
  }
  function upcomingWeekStartDates(weekStart){
    const ws = (weekStart === 'monday') ? 'monday' : 'sunday';
    const first = startOfWeek(new Date(), ws);
    return [0,1,2,3].map(i => new Date(first.getFullYear(), first.getMonth(), first.getDate() + i*7));
  }
  function colorForIsoWeek(iso){
    const idx = (iso % 4) + 1; // 1..4, aligns with W1..W4 colors
    return idx===1 ? 'primary' : idx===2 ? 'danger' : idx===3 ? 'warning' : 'info';
  }
  function weekNumber(date, basis){
    const b = (basis === 'monday') ? 'monday' : 'sunday';
    if (b === 'monday') return isoWeekNumber(date);
    // Sunday-based week numbering
    const year = date.getFullYear();
    const start = startOfWeek(date, 'sunday');
    const jan1 = new Date(year, 0, 1);
    const yearWeek0 = startOfWeek(jan1, 'sunday');
    const diffDays = Math.floor((start - yearWeek0) / 86400000);
    return Math.floor(diffDays / 7) + 1;
  }

  async function loadWeekStartSetting(){
    try{
      const res = await fetch(`${API_BASE_URL}/settings.php?action=get&key=week_start`, { credentials:'include' });
      const j = await res.json().catch(()=>null);
      const val = (j && j.success && j.data && typeof j.data.value === 'string') ? j.data.value.toLowerCase() : 'sunday';
      window.__WEEK_START = (val === 'monday') ? 'monday' : 'sunday';
    } catch(_){ window.__WEEK_START = 'sunday'; }
  }

  function getWeekStart(){
    return (window.__WEEK_START === 'monday') ? 'monday' : 'sunday';
  }

  function getPeriodKeyFromInputs(){
    const monthEl = qs('#diMonth');
    const month = (monthEl?.value || currentMonth());
    if (!/^\d{4}-\d{2}$/.test(month)) return null;
    // Derive week bucket from today's date according to selected week start
    const today = new Date();
    const ws = getWeekStart();
    // compute week-of-month index by counting boundaries within the month
    const y = today.getFullYear();
    const m = today.getMonth(); // 0-based
    const first = new Date(y, m, 1);
    const firstDow = first.getDay(); // 0=Sun..6=Sat
    const weekStartDow = (ws === 'monday') ? 1 : 0;
    // shift first date to first week start on/before
    const offset = (firstDow - weekStartDow + 7) % 7;
    const firstWeekStart = new Date(y, m, 1 - offset);
    let wIndex = 1;
    let cursor = new Date(firstWeekStart);
    while (new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate()+7) <= new Date(y, m+1, 1)){
      const next = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate()+7);
      if (today >= cursor && today < next) break;
      wIndex++;
      cursor = next;
    }
    const w = `W${Math.min(4, Math.max(1, wIndex))}`;
    return `${month}-${w}`;
  }

  async function updateAllocateNowState(selectedRecipientIds){
    try{
      const btn = qs('#diAllocateWeek');
      const top = qs('#diTopFeedback');
      const meta = qs('#diAllocMeta') || qs('#diFeedback');
      if (!btn) return;
      // Default: enabled
      btn.disabled = false;
      if (top) showMsg(top, '', 'secondary');
      if (meta) showMsg(meta, '', 'secondary');

      const pk = getPeriodKeyFromInputs();
      if (!pk) return; // cannot resolve period

      // Resolve run by period
      const runRes = await fetch(`${API_BASE_URL}/allocations.php?action=run_by_period&period_key=${encodeURIComponent(pk)}&t=${Date.now()}`, { credentials:'include', headers:{'Accept':'application/json'} });
      const runJ = await runRes.json().catch(()=>null);
      if (!runRes.ok || !runJ?.success || !runJ?.data?.run_id){
        // No run yet => allocation allowed
        return;
      }
      const runId = parseInt(runJ.data.run_id,10)||0;
      if (!runId) return;

      // Load allocations for that run
      const listRes = await fetch(`${API_BASE_URL}/allocations.php?action=list_by_run&run_id=${encodeURIComponent(String(runId))}&t=${Date.now()}`, { credentials:'include', headers:{'Accept':'application/json'} });
      const listJ = await listRes.json().catch(()=>null);
      if (!listRes.ok || !listJ?.success){ return; }
      const arr = Array.isArray(listJ?.data?.items) ? listJ.data.items : [];
      if (arr.length === 0){ return; }

      // If any allocation belongs to the currently selected recipients, disable
      const selected = Array.isArray(selectedRecipientIds) ? selectedRecipientIds.map(n=>parseInt(n,10)).filter(Number.isFinite) : getSelectedIds();
      const selSet = new Set(selected);
      const overlap = arr.some(a => selSet.has(parseInt(a.recipient_id,10)||0));
      if (overlap){
        btn.disabled = true;
        const link = `DistributeResult.html?period_key=${encodeURIComponent(pk)}`;
        const text = `Allocate Now is disabled: current run already has allocations for one or more selected recipients. <a href="${link}" class="alert-link">Open Distribution: Result</a> to review.`;
        if (top) showMsg(top, text, 'warning');
        // Also clear/hide bottom meta to avoid duplicate
        if (meta) showMsg(meta, '', 'secondary');
      }
    } catch(_){ /* non-blocking */ }
  }

  function updateSelectedCount(){
    const count = (qs('#diSelected')?.children.length) || 0;
    const badge = qs('#diSelectedCount');
    if (badge){ badge.textContent = `Selected: ${count}`; }
  }

  function applySearchFilter(){
    const q = (qs('#diSearch')?.value || '').toLowerCase();
    qsa('#diPool .di-card').forEach(card => {
      const lbl = card.textContent?.toLowerCase() || '';
      const show = !q || lbl.includes(q);
      card.style.display = show ? '' : 'none';
    });
  }

  // Inventory helpers and allocation utilities
  function invKey(name, category){
    const n = String(name||'').trim();
    const c = String(category||'').trim();
    return n + '\u0001' + c; // compound key
  }

  // Global in-memory summary map: key -> { name, category, total }
  let __invSummary = new Map();

  async function loadInventorySummary(){
    try{
      // Primary attempt: inventory merged list
      const url = `${API_BASE_URL}/inventory/index.php/list?group=merge&limit=500&t=${Date.now()}`;
      let map = new Map();
      try{
        const res = await fetch(url, { credentials: 'include', headers: { 'Accept': 'application/json' } });
        const j = await res.json().catch(()=>null);
        const arr = (j && j.success && Array.isArray(j.data?.items)) ? j.data.items : (Array.isArray(j?.items) ? j.items : []);
        for (const it of arr){
          const name = (it.item_name ?? it.product_name ?? it.name ?? '').toString();
          const cat = (it.category ?? it.product_category ?? it.type ?? '').toString();
          const qty = Number(it.total_quantity ?? it.total ?? it.quantity ?? 0) || 0;
          const key = invKey(name, cat);
          if (!map.has(key)) map.set(key, { name, category: cat, total: 0 });
          map.get(key).total += Math.max(0, qty);
        }
      } catch(_) { /* fall through */ }

      // Fallback: derive from donations list (Completed/Picked Up)
      if (map.size === 0){
        const collectFromDonations = async (status) => {
          try{
            const r = await fetch(`${API_BASE_URL}/donations/index.php/list?status=${encodeURIComponent(status)}&t=${Date.now()}`, { credentials:'include', headers:{'Accept':'application/json'} });
            const jj = await r.json().catch(()=>null);
            return Array.isArray(jj?.data?.items) ? jj.data.items : [];
          } catch(_){ return []; }
        };
        const combined = [ ...(await collectFromDonations('Completed')), ...(await collectFromDonations('Picked Up')) ];
        for (const it of combined){
          const name = (it.product_name ?? it.name ?? '').toString();
          const cat = (it.type ?? it.category ?? '').toString();
          const qty = Number(it.quantity ?? 0) || 0;
          const key = invKey(name, cat);
          if (!map.has(key)) map.set(key, { name, category: cat, total: 0 });
          map.get(key).total += Math.max(0, qty);
        }
      }

      // Last-resort fallback: donations list without status filter
      if (map.size === 0){
        try{
          const r = await fetch(`${API_BASE_URL}/donations/index.php/list?t=${Date.now()}`, { credentials:'include', headers:{'Accept':'application/json'} });
          const jj = await r.json().catch(()=>null);
          const items = Array.isArray(jj?.data?.items) ? jj.data.items : [];
          for (const it of items){
            const name = (it.product_name ?? it.name ?? '').toString();
            const cat = (it.type ?? it.category ?? '').toString();
            const qty = Number(it.quantity ?? 0) || 0;
            const key = invKey(name, cat);
            if (!map.has(key)) map.set(key, { name, category: cat, total: 0 });
            map.get(key).total += Math.max(0, qty);
          }
        } catch(_){ /* ignore */ }
      }

      __invSummary = map;
      try { window.__invSummary = map; } catch(_) {}
      // Surface hint if still empty
      if (map.size === 0){
        const fb = qs('#diAllocMeta') || qs('#diFeedback');
        if (fb){ showMsg(fb, 'No inventory suggestions found yet. You can still type Category and Item freely.', 'info'); }
      }
      return map;
    } catch(err){ __invSummary = new Map(); return __invSummary; }
  }

  function attachRowAllocationHandlers(tr){
    // Delete row
    const del = qs('.di-del-row', tr);
    del?.addEventListener('click', (e)=>{ e.preventDefault(); tr.remove(); try{ recomputeAvailabilities(); } catch(_){} });
    // Sanitize quantity inputs
    const qty = qs('.di-alloc', tr);
    qty?.addEventListener('input', ()=>{
      const v = Math.max(0, parseInt(qty.value||'0', 10) || 0);
      qty.value = String(v);
      try{ recomputeAvailabilities(); } catch(_){}
    });
    // Recompute on name/category change
    const cat = qs('.di-cat', tr);
    const name = qs('.di-name', tr);
    cat?.addEventListener('input', ()=>{ try{ recomputeAvailabilities(); } catch(_){} });
    name?.addEventListener('input', ()=>{ try{ recomputeAvailabilities(); } catch(_){} });
  }

  function addRecipientRowWithValues(recId, category, name, qty){
    const tbody = qs(`.di-rec-tbody[data-rec="${recId}"]`);
    if (!tbody) return;
    const targetCat = String(category||'').trim().toLowerCase();
    const targetName = String(name||'').trim().toLowerCase();
    const addQty = Math.max(0, parseInt(qty||'0',10)||0);
    // Try to find an existing row with same category + name (case-insensitive)
    let merged = false;
    qsa('tr', tbody).some(tr => {
      const catVal = (qs('.di-cat', tr)?.value || '').trim().toLowerCase();
      const nameVal = (qs('.di-name', tr)?.value || '').trim().toLowerCase();
      if (catVal === targetCat && nameVal === targetName){
        const qtyEl = qs('.di-alloc', tr);
        const cur = Math.max(0, parseInt(qtyEl?.value || '0', 10) || 0);
        if (qtyEl) qtyEl.value = String(cur + addQty);
        merged = true;
        return true; // stop iteration
      }
      return false;
    });
    if (!merged){
      // Append a new row
      addRecipientRow(recId);
      const last = tbody?.lastElementChild;
      if (!last) return;
      const catEl = qs('.di-cat', last);
      const nameEl = qs('.di-name', last);
      const qtyEl = qs('.di-alloc', last);
      if (catEl) catEl.value = String(category||'');
      if (nameEl) nameEl.value = String(name||'');
      if (qtyEl) qtyEl.value = String(addQty);
    }
    try{ recomputeAvailabilities(); } catch(_){}}

  function computePlannedTotals(){
    const totals = new Map();
    qsa('.di-rec-tbody').forEach(tbody => {
      qsa('tr', tbody).forEach(tr => {
        const name = qs('.di-name', tr)?.value || '';
        const cat = qs('.di-cat', tr)?.value || '';
        const qty = Math.max(0, parseInt(qs('.di-alloc', tr)?.value || '0', 10) || 0);
        const key = invKey(name, cat);
        totals.set(key, (totals.get(key)||0) + qty);
      });
    });
    return totals;
  }

  async function issueAllocations(groups){
    // Use Inventory API to move out per item group, FIFO by earliest expiry
    const endpoint = `${API_BASE_URL}/inventory/index.php/move-out-group`;
    const done = [];
    for (const g of (groups || [])){
      const rid = Number(g.recipient_id || g.id || 0) || 0;
      const items = Array.isArray(g.items) ? g.items : [];
      for (const it of items){
        const payload = {
          item_name: String(it.item_name || it.name || ''),
          category: String(it.category || it.product_category || ''),
          quantity: Number(it.quantity || it.qty || 0) || 0,
          mode: 'recipient',
          recipient_id: rid,
          note: it.note ? String(it.note) : null,
        };
        if (!payload.item_name || payload.quantity <= 0){ continue; }
        const res = await fetch(endpoint, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' }, body: JSON.stringify(payload) });
        const j = await res.json().catch(()=>null);
        if (!res.ok || !j?.success){
          const msg = j?.error || `Move-out failed for ${payload.item_name} (${payload.category}) x${payload.quantity}`;
          throw new Error(msg);
        }
        done.push({ recipient_id: rid, item_name: payload.item_name, category: payload.category, quantity: payload.quantity, result: j.data });
      }
    }
    return done;
  }

  // Items table management
  function addItemRow(){
    const tbody = qs('#diItemsBody');
    if (!tbody) return;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><input class="form-control form-control-sm di-item-name" placeholder="Item name" /></td>
      <td><input class="form-control form-control-sm di-item-cat" placeholder="Category (optional)" /></td>
      <td style="width:120px"><input type="number" min="0" step="1" class="form-control form-control-sm di-item-qty" value="0" /></td>
      <td><button type="button" class="btn btn-sm btn-outline-danger di-del-item"><i class="bi bi-x"></i></button></td>
    `;
    tbody.appendChild(tr);
    attachRowAllocationHandlers(tr);
  }

  function collectItems(){
    const rows = qsa('#diItemsBody tr');
    const items = [];
    for (const tr of rows){
      const name = qs('.di-item-name', tr)?.value.trim();
      const qty = parseInt(qs('.di-item-qty', tr)?.value || '0', 10);
      const cat = qs('.di-item-cat', tr)?.value.trim();
      if (!name || !Number.isFinite(qty) || qty <= 0) continue;
      const obj = { name, quantity: qty };
      if (cat) obj.category = cat;
      items.push(obj);
    }
    return items;
  }

  // Recipients
  async function fetchRecipients(){
    const url = `${API_BASE_URL}/users.php?action=list&role=recipient&status=approved&t=${Date.now()}`;
    const res = await fetch(url, { headers: { 'Accept': 'application/json' }, credentials: 'include' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const j = await res.json();
    return Array.isArray(j?.data?.items) ? j.data.items : [];
  }

  // Period-based distribution helpers (suggest/mark_result)
  function getPeriodType(){
    const sel = document.getElementById('diPeriodType');
    const v = sel ? sel.value : 'monthly';
    return (v === 'weekly' || v === 'monthly' || v === 'quarterly') ? v : 'monthly';
  }
  async function suggestPeriod(roundSize){
    const payload = { period_type: getPeriodType(), round_size: Math.max(1, parseInt(roundSize || '5', 10) || 5) };
    const res = await fetch(`${API_BASE_URL}/distribution.php?action=suggest`, {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(payload)
    });
    const j = await res.json();
    if (!res.ok || !j?.success) throw new Error(j?.error || `HTTP ${res.status}`);
    const ids = Array.isArray(j?.data?.recipient_ids) ? j.data.recipient_ids.map(n=>parseInt(n,10)).filter(Number.isFinite) : [];
    window.__diPeriodKey = j?.data?.period_key || null;
    window.__diPeriodType = payload.period_type;
    return ids;
  }
  async function markPeriodResult(servedIds, skippedIds){
    const res = await fetch(`${API_BASE_URL}/distribution.php?action=mark_result`, {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ period_type: window.__diPeriodType || getPeriodType(), period_key: window.__diPeriodKey || undefined, served_ids: servedIds, skipped_ids: skippedIds })
    });
    const j = await res.json();
    if (!res.ok || !j?.success) throw new Error(j?.error || `HTTP ${res.status}`);
    return true;
  }

  function renderRecipientPools(items, selectedIds = []){
    const pool = qs('#diPool');
    const selected = qs('#diSelected');
    if (!pool || !selected) return;
    const mkCard = (u) => {
      const id = u.user_id || u.id;
      const label = (u.organization_name && u.organization_name.trim()) ? u.organization_name : (u.name || `Recipient ${id}`);
      const el = document.createElement('div');
      el.className = 'di-card p-2 border rounded bg-light';
      el.draggable = true;
      el.dataset.id = String(id);
      el.innerHTML = `
        <div class="d-flex justify-content-between align-items-center gap-2">
          <span class="di-card-label text-truncate">${label}</span>
          <span class="di-week-badges d-flex gap-1"></span>
        </div>`;
      el.title = label;
      return el;
    };
    // Clear and repopulate
    pool.innerHTML = '';
    selected.innerHTML = '';
    for (const u of items){
      const id = u.user_id || u.id;
      const card = mkCard(u);
      if (selectedIds.includes(id)) { selected.appendChild(card); }
      else { pool.appendChild(card); }
    }
    updateSelectedCount();
  }

  function earliestWeekIndexForId(id, weeksMap){
    const toSet = (arr)=> new Set((Array.isArray(arr)?arr:[]).map(v=>parseInt(v,10)).filter(n=>Number.isFinite(n)&&n>0));
    const W1 = toSet(weeksMap?.W1); const W2 = toSet(weeksMap?.W2); const W3 = toSet(weeksMap?.W3); const W4 = toSet(weeksMap?.W4);
    if (W1.has(id)) return 1;
    if (W2.has(id)) return 2;
    if (W3.has(id)) return 3;
    if (W4.has(id)) return 4;
    return 5; // unscheduled last
  }

  function sortPoolByWeeks(weeksMap){
    const pool = qs('#diPool'); if (!pool) return;
    const cards = qsa('#diPool .di-card');
    // Build array with sort keys: [weekIndex, label, element]
    const rows = cards.map(card => {
      const id = parseInt(card.dataset.id||'0',10) || 0;
      const lbl = (qs('.di-card-label', card)?.textContent || '').toLowerCase();
      const wkIdx = earliestWeekIndexForId(id, weeksMap);
      return { wkIdx, lbl, el: card };
    });
    rows.sort((a,b)=> a.wkIdx - b.wkIdx || a.lbl.localeCompare(b.lbl));
    // Re-append in sorted order
    rows.forEach(r => pool.appendChild(r.el));
  }

  function getCurrentWeekBucket(){
    // Upcoming model: W1 is always the current week
    return 'W1';
  }

  async function fetchMonthlyPlan(month){
    const m = month || currentMonth();
    const weekStart = getWeekStart();
    const res = await fetch(`${API_BASE_URL}/recipients_list.php?action=get_plan&month=${encodeURIComponent(m)}&week_start=${encodeURIComponent(weekStart)}`, { credentials:'include' });
    if (!res.ok) return { month: m, weeks: { W1:[], W2:[], W3:[], W4:[] } };
    const j = await res.json().catch(()=>null);
    if (!j?.success) return { month: m, weeks: { W1:[], W2:[], W3:[], W4:[] } };
    return j.data || { month: m, weeks: { W1:[], W2:[], W3:[], W4:[] } };
  }

  function annotateCardsWithWeeks(weeksMap){
    const toSet = (arr)=> new Set((Array.isArray(arr)?arr:[]).map(v=>parseInt(v,10)).filter(n=>Number.isFinite(n)&&n>0));
    const W1 = toSet(weeksMap?.W1); const W2 = toSet(weeksMap?.W2); const W3 = toSet(weeksMap?.W3); const W4 = toSet(weeksMap?.W4);
    const currentW = getCurrentWeekBucket(); // 'W1'..'W4' for border highlighting
    const isInWeek = (id, wk)=> wk==='W1'?W1.has(id):wk==='W2'?W2.has(id):wk==='W3'?W3.has(id):W4.has(id);
    const weekStartBasis = getWeekStart();
    const starts = upcomingWeekStartDates(weekStartBasis);
    const labels = starts.map(dt => `W${weekNumber(dt, weekStartBasis)}`);
    const isoColors = starts.map(dt => colorForIsoWeek(isoWeekNumber(dt)));
    // Map 'W1'..'W4' to corresponding iso label/color based on index
    const wkToIso = { W1: { label: labels[0], color: isoColors[0] }, W2: { label: labels[1], color: isoColors[1] }, W3: { label: labels[2], color: isoColors[2] }, W4: { label: labels[3], color: isoColors[3] } };
    // For carryover previous week: compute its iso label/color too
    const prevKey = window.__diPrevWeekKey || '';
    let prevIsoLabel = null, prevIsoColor = null;
    try {
      const m = /^(\d{4})-(\d{2})-W([1-4])$/.exec(prevKey);
      if (m){
        const y = parseInt(m[1],10), mon = parseInt(m[2],10), wIdx = parseInt(m[3],10);
        const firstOfMonth = new Date(y, mon-1, 1);
        const prevStarts = (function(monthDate, basis){
          const first = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
          const wsDow = (basis==='monday')?1:0; const firstDow = first.getDay();
          const offset = (firstDow - wsDow + 7) % 7;
          const firstWeekStart = new Date(first.getFullYear(), first.getMonth(), 1 - offset);
          return [0,1,2,3].map(i => new Date(firstWeekStart.getFullYear(), firstWeekStart.getMonth(), firstWeekStart.getDate() + i*7));
        })(firstOfMonth, weekStartBasis);
        const dt = prevStarts[wIdx-1];
        if (dt){ const iso = isoWeekNumber(dt); prevIsoLabel = `W${iso}`; prevIsoColor = colorForIsoWeek(iso); }
      }
    } catch(_){ }
    const carrySet = (window.__diCarryOverSet instanceof Set) ? window.__diCarryOverSet : new Set();
    qsa('.di-card').forEach(card => {
      const id = parseInt(card.dataset.id||'0',10) || 0;
      const host = qs('.di-week-badges', card);
      if (host) host.innerHTML = '';
      card.classList.remove('border-primary','border-danger','border-warning','border-info');
      if (carrySet.has(id) && prevIsoLabel && prevIsoColor){
        const span = document.createElement('span');
        span.className = `badge bg-${prevIsoColor} text-uppercase`;
        span.style.fontSize = '0.65rem';
        span.textContent = prevIsoLabel;
        host?.appendChild(span);
        card.classList.add(`border-${prevIsoColor}`);
      } else {
        ['W1','W2','W3','W4'].forEach(wk => {
          if (isInWeek(id, wk)){
            const meta = wkToIso[wk];
            if (host && meta){
              const span = document.createElement('span');
              span.className = `badge bg-${meta.color} text-uppercase`;
              span.style.fontSize = '0.65rem';
              span.textContent = meta.label;
              host.appendChild(span);
            }
            if (wk === currentW && meta){
              card.classList.add(`border-${meta.color}`);
            }
          }
        });
      }
    });
  }

  function autoMoveCurrentWeekRecipients(weeksMap){
    const currentW = getCurrentWeekBucket();
    const plannedIds = (weeksMap?.[currentW]||[]).map(v=>parseInt(v,10)).filter(n=>Number.isFinite(n)&&n>0);
    const carrySet = (window.__diCarryOverSet instanceof Set) ? window.__diCarryOverSet : new Set();
    const ids = new Set([...plannedIds, ...carrySet]);
    if (!ids.size) return;
    const pool = qs('#diPool');
    const selected = qs('#diSelected');
    ids.forEach(id => {
      const card = qs(`.di-card[data-id="${id}"]`);
      if (card && card.parentElement && card.parentElement.id === 'diPool'){
        selected?.appendChild(card);
      }
    });
    updateSelectedCount();
  }

  function sortSelectedByCarryovers(){
    const selected = qs('#diSelected'); if (!selected) return;
    const carrySet = (window.__diCarryOverSet instanceof Set) ? window.__diCarryOverSet : new Set();
    const rows = qsa('#diSelected .di-card').map(el => ({
      el,
      id: parseInt(el.dataset.id||'0',10)||0,
      label: (qs('.di-card-label', el)?.textContent||'').toLowerCase()
    }));
    rows.sort((a,b) => {
      const ac = carrySet.has(a.id) ? 0 : 1;
      const bc = carrySet.has(b.id) ? 0 : 1;
      if (ac !== bc) return ac - bc;
      return a.label.localeCompare(b.label);
    });
    rows.forEach(r => selected.appendChild(r.el));
  }

  function parseIds(str){
    return String(str||'')
      .split(/[,\s]+/)
      .map(s => parseInt(s, 10))
      .filter(n => Number.isFinite(n) && n > 0);
  }

  function getSelectedIds(){
    return qsa('#diSelected .di-card').map(el => parseInt(el.dataset.id, 10));
  }

  function getSelectedRecipientObjects(){
    const all = window.__diAllRecipients || [];
    const map = new Map(all.map(u => [u.user_id || u.id, u]));
    return getSelectedIds().map(id => ({ id, ...(map.get(id)||{}) }));
  }

  function getHighlightedIdsFromPool(){
    return qsa('#diPool .di-card.border-warning').map(el => parseInt(el.dataset.id, 10)).filter(n=>Number.isFinite(n)&&n>0);
  }

  function getFirstIdsFromPool(n=5){
    return qsa('#diPool .di-card').slice(0,n).map(el => parseInt(el.dataset.id,10)).filter(n=>Number.isFinite(n)&&n>0);
  }

  function buildRecipientsPayload(all){
    // Build minimal shape expected by allocate-items: id, age, gender, received_count
    const byId = new Map(all.map(u => [u.user_id || u.id, u]));
    const selectedIds = getSelectedIds();
    return selectedIds.map(id => {
      const u = byId.get(id) || {};
      return {
        id,
        age: (u.age !== undefined ? parseInt(u.age,10) : null),
        gender: (u.gender || 'unknown'),
        received_count: (u.received_count !== undefined ? parseInt(u.received_count,10) : 0)
      };
    });
  }

  function buildOptions(){
    // Keep manual carryovers as an advanced option; quarterly flow controls main order
    return {
      carryover_ids: parseIds(qs('#diCarryoverIds')?.value),
      carryover_boost: 1,
      random_count: parseInt(qs('#diRandomCount')?.value || '0', 10) || 0,
      random_seed: (qs('#diRandomSeed')?.value || ''),
      include_rationale: qs('#diIncludeRationale')?.checked ? 1 : 0
    };
  }

  function buildAllocationColumns(recipients, allocations){
    const host = qs('#diAllocCarouselInner');
    const indicators = qs('#diAllocIndicators');
    if (!host) return;
    host.innerHTML = '';
    if (indicators) indicators.innerHTML = '';
    const makeSlide = (r, isActive) => {
      const slide = document.createElement('div');
      slide.className = `carousel-item ${isActive ? 'active' : ''}`;
      const orgName = (r.organization_name && r.organization_name.trim()) ? r.organization_name : (r.name || ('Recipient ' + r.id));
      const orgType = (r.organization_type && String(r.organization_type).trim()) ? String(r.organization_type).trim() : '';
      const title = orgType ? `${orgName} - ${orgType}` : orgName;
      slide.innerHTML = `
        <div class="p-2 h-100 d-flex flex-column">
          <div class="d-flex justify-content-between align-items-center mb-2">
            <div class="fw-semibold">${title}</div>
            <button type="button" class="btn btn-sm btn-outline-primary di-auto-rec" data-rec="${r.id}">Auto</button>
          </div>
          <div class="table-responsive flex-grow-1">
            <table class="table table-sm align-middle mb-0">
              <thead class="table-light">
                <tr>
                  <th>Category</th>
                  <th>Item Name</th>
                  <th style="width: 90px">Qty</th>
                  <th style="width: 40px"></th>
                </tr>
              </thead>
              <tbody class="di-rec-tbody" data-rec="${r.id}"></tbody>
            </table>
          </div>
        </div>
      `;
      return slide;
    };
    recipients.forEach((r, idx) => {
      host.appendChild(makeSlide(r, idx === 0));
      if (indicators){
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.setAttribute('data-bs-target', '#diAllocCarousel');
        btn.setAttribute('data-bs-slide-to', String(idx));
        if (idx === 0) btn.classList.add('active');
        btn.setAttribute('aria-label', `Slide ${idx+1}`);
        indicators.appendChild(btn);
      }
    });
    // Initialize counter text
    const counter = qs('#diAllocCounter');
    if (counter){ counter.textContent = recipients.length ? `1 / ${recipients.length}` : ''; }
    // Switch to Allocation tab
    const tabBtn = qs('#di-alloc-tab');
    if (tabBtn){
      const bsTab = new bootstrap.Tab(tabBtn);
      bsTab.show();
    }

    // Initialize carousel and wire controls after slides exist
    const carouselEl = document.getElementById('diAllocCarousel');
    let carousel = null;
    try { if (carouselEl && typeof bootstrap !== 'undefined' && bootstrap.Carousel) {
      carousel = bootstrap.Carousel.getOrCreateInstance(carouselEl, { interval: false, ride: false, keyboard: false, touch: false });
    } } catch(_) {}
    // Indicators and counter on slide
    if (carouselEl){
      carouselEl.addEventListener('slide.bs.carousel', (ev) => {
        const to = ev.to;
        const dots = qsa('#diAllocIndicators [data-bs-target]');
        dots.forEach((d,i)=>{ if (i===to) d.classList.add('active'); else d.classList.remove('active'); });
        const c = qs('#diAllocCounter');
        if (c){ c.textContent = `${to+1} / ${dots.length}`; }
      }, { once: false });
    }
    // Prev/Next buttons
    qs('#diAllocPrevBtn')?.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); if (carousel) carousel.prev(); });
    qs('#diAllocNextBtn')?.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); if (carousel) carousel.next(); });
    // Keyboard navigation while modal focused
    const modalEl = document.getElementById('distributeItemsModal');
    modalEl?.addEventListener('keydown', (e) => {
      if (!carousel) return;
      if (e.key === 'ArrowLeft'){ e.preventDefault(); carousel.prev(); }
      if (e.key === 'ArrowRight'){ e.preventDefault(); carousel.next(); }
    });
    // Disable nav buttons if fewer than 2 slides
    const slides = qsa('#diAllocCarouselInner .carousel-item');
    const disable = slides.length < 2;
    const prevBtn = qs('#diAllocPrevBtn'); const nextBtn = qs('#diAllocNextBtn');
    if (prevBtn) prevBtn.disabled = disable; if (nextBtn) nextBtn.disabled = disable;

    // After rendering, update Allocate Now button state based on current run allocations
    try {
      const ids = Array.isArray(recipients) ? recipients.map(r => parseInt(r.id||r.user_id||r.recipient_id||0,10)).filter(Number.isFinite) : [];
      updateAllocateNowState(ids);
    } catch(_){ /* ignore */ }

    // Wire Auto button (per recipient) using server-side preview restricted to current selection
    document.addEventListener('click', async (e)=>{
      const t = e.target;
      if (!(t instanceof HTMLElement)) return;
      if (!t.classList.contains('di-auto-rec')) return;
      e.preventDefault();
      const recId = parseInt(t.getAttribute('data-rec')||'0', 10) || 0;
      if (!recId) return;
      const fb = qs('#diAllocMeta') || qs('#diFeedback');
      try{
        const pk = getPeriodKeyFromInputs();
        if (!pk) { showMsg(fb, 'Please choose a valid Month and Week.', 'warning'); return; }
        const selIds = getSelectedIds();
        if (!selIds.length){ showMsg(fb, 'Select at least one recipient first.', 'warning'); return; }
        // Ensure recipients loaded
        if (!window.__diAllRecipients) window.__diAllRecipients = await fetchRecipients();
        // Request server preview for current selection
        const res = await fetch(`${API_BASE_URL}/allocations.php?action=preview_allocation`, {
          method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: JSON.stringify({ period_key: pk, recipient_ids: selIds })
        });
        const j = await res.json();
        if (!res.ok || !j?.success) throw new Error(j?.error || `HTTP ${res.status}`);
        const allocations = Array.isArray(j?.data?.allocations) ? j.data.allocations : [];
        // Clear only this recipient rows and populate from preview
        clearRecipientRows(recId);
        // Aggregate allocations for this recipient by item before adding rows
        const agg = new Map();
        allocations.forEach(a => {
          if (Number(a.recipient_id) !== recId) return;
          const name = (a.product_name || '').toString();
          const cat = (a.product_category || '').toString();
          const qty = Number(a.quantity || 0) || 0;
          if (!name || qty <= 0) return;
          const key = cat + '\u0001' + name;
          agg.set(key, (agg.get(key) || 0) + qty);
        });
        agg.forEach((qty, key) => {
          const [cat, name] = key.split('\u0001');
          addRecipientRowWithValues(recId, cat, name, qty);
        });
        try{ recomputeAvailabilities(); } catch(_){ }
      } catch(err){
        console.error('Auto (single) failed:', err);
        showMsg(fb, err?.message || 'Auto allocation failed', 'danger');
      }
    });
  }

  // With no global items/availability, we skip cross-recipient validation here.
  function enforceTotals(){ /* no-op */ }

  function attachSuggestTableEvents(items, recipients){
    document.addEventListener('input', (e) => {
      const t = e.target;
      if (!(t instanceof HTMLInputElement)) return;
      if (!t.classList.contains('di-alloc')) return;
      // sanitize
      const v = Math.max(0, parseInt(t.value || '0', 10) || 0);
      t.value = String(v);
      enforceTotals(items, recipients);
    });
  }

  function addRecipientRow(recId){
    const tbody = qs(`.di-rec-tbody[data-rec="${recId}"]`);
    if (!tbody) return;
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><input class="form-control form-control-sm di-cat" placeholder="Category (optional)"></td>
      <td><input class="form-control form-control-sm di-name" placeholder="Item name"></td>
      <td style="width:90px"><input type="number" min="0" step="1" class="form-control form-control-sm di-alloc" data-rec="${recId}" data-item="" value="0"></td>
      <td style="width:40px"><button type="button" class="btn btn-sm btn-outline-danger di-del-row">&times;</button></td>
    `;
    tbody.appendChild(tr);
    attachRowAllocationHandlers(tr);
    try{ recomputeAvailabilities(); } catch(_){ }
  }

  // ---------- Auto allocation helpers (per-recipient) ----------
  const PREFERRED = {
    dairy_infant: ['infant formula'],
    dairy_elderly: ['elderly milk'],
    medicine_exact: ['paracetamol 500mg', 'vitamin c 500mg']
  };
  function keywordMatch(s, kws){
    const t = String(s||'').toLowerCase();
    return kws.some(k => t.includes(k));
  }

  function inferItemTag(meta){
    const n = String(meta.name||'');
    const c = String(meta.category||'');
    const nl = n.toLowerCase();
    if (keywordMatch(n, ['rice']) || keywordMatch(c, ['grain','grains','staple'])) return 'staple';
    if (keywordMatch(n, ['sardine','tuna','meat','chicken','pork','beef']) || keywordMatch(c, ['protein','canned'])) return 'protein';
    if (keywordMatch(n, ['noodle','pasta'])) return 'fast_meal';
    // Dairy subtypes
    if (PREFERRED.dairy_infant.some(p => nl === p)) return 'dairy_infant';
    if (PREFERRED.dairy_elderly.some(p => nl === p)) return 'dairy_elderly';
    if (keywordMatch(n, ['infant','baby','toddler','formula']) || keywordMatch(c, ['infant','baby'])) return 'dairy_infant';
    if (keywordMatch(n, ['senior','elder','adult','ensure','fortified']) || keywordMatch(c, ['elderly','senior'])) return 'dairy_elderly';
    if (keywordMatch(n, ['milk']) || keywordMatch(c, ['dairy'])) return 'dairy';
    if (PREFERRED.medicine_exact.some(p => nl === p)) return 'medicine';
    if (keywordMatch(c, ['medicine']) || keywordMatch(n, ['vitamin','paracetamol','supplement','med'])) return 'medicine';
    return 'other';
  }

  function deriveRecipientNeeds(rec){
    const needs = new Set();
    const tags = String(rec.tags||'').toLowerCase();
    const ageGroup = String(rec.age_group||'').toLowerCase();
    const orgType = String(rec.organization_type||'').toLowerCase();
    // Base pack for all
    needs.add('staple'); needs.add('protein'); needs.add('fast_meal');
    // Conditional
    if (tags.includes('infant') || ageGroup.includes('infant') || orgType.includes('daycare') || orgType.includes('orphan')) needs.add('infant');
    if (tags.includes('elder') || ageGroup.includes('elder') || orgType.includes('home for the aged') || orgType.includes('senior')) needs.add('elderly');
    if (tags.includes('medicine') || orgType.includes('clinic') || orgType.includes('health')) needs.add('medicine');
    return needs;
  }

  function pickInventoryForNeeds(needs){
    // Configure default pack sizes
    const PACK = { staple: 5, protein: 4, fast_meal: 3, dairy: 2, medicine: 2 };
    const byTag = { staple: [], protein: [], fast_meal: [], dairy_infant: [], dairy_elderly: [], dairy: [], medicine: [], other: [] };
    try {
      (__invSummary || new Map()).forEach(meta => {
        const tag = inferItemTag(meta);
        if (!byTag[tag]) byTag[tag] = [];
        byTag[tag].push(meta);
      });
      Object.values(byTag).forEach(arr => arr.sort((a,b)=> (b.total||0) - (a.total||0)));
    } catch(_){ /* ignore */ }
    const picks = [];
    const take = (tag, qty, opts={ fallbackQty:0, prefer:[] })=>{
      const arr = byTag[tag]||[];
      // Prefer items with certain keywords in name
      let chosen = null;
      if (opts.prefer && opts.prefer.length){
        // try exact-name match first
        chosen = arr.find(m => opts.prefer.some(p => String(m.name||'').toLowerCase() === p));
        if (!chosen) chosen = arr.find(m => keywordMatch(m.name, opts.prefer));
      }
      if (!chosen && arr.length) chosen = arr[0];
      if (chosen){ picks.push({ name: chosen.name, category: chosen.category, quantity: qty }); }
      else if (opts.fallbackQty>0 && (byTag.other||[]).length){ const m = byTag.other[0]; picks.push({ name: m.name, category: m.category, quantity: opts.fallbackQty }); }
    };
    // Base pack
    take('staple', PACK.staple, { fallbackQty: Math.max(0, PACK.staple-2) });
    take('protein', PACK.protein, { fallbackQty: Math.max(0, PACK.protein-2) });
    take('fast_meal', PACK.fast_meal, { fallbackQty: Math.max(0, PACK.fast_meal-1) });
    // Conditional
    if (needs.has('infant')){
      // Prefer infant/toddler formula items
      if (byTag.dairy_infant.length){
        take('dairy_infant', PACK.dairy, { prefer:[...PREFERRED.dairy_infant, 'infant','formula','baby','toddler'] });
      } else if (byTag.dairy.length){
        take('dairy', PACK.dairy, { prefer:['milk'] });
      }
    }
    if (needs.has('elderly')){
      // Prefer elderly/adult fortified milk
      if (byTag.dairy_elderly.length){
        take('dairy_elderly', PACK.dairy, { prefer:[...PREFERRED.dairy_elderly, 'senior','adult','ensure','fortified'] });
      } else if (byTag.dairy.length){
        take('dairy', PACK.dairy, { prefer:['milk'] });
      }
    }
    if (needs.has('medicine')){
      take('medicine', PACK.medicine, { prefer:[...PREFERRED.medicine_exact, 'vitamin','paracetamol','supplement','med'] });
    }
    return picks.filter(it => (it.quantity||0) > 0);
  }

  function clearRecipientRows(recId){
    const tbody = qs(`.di-rec-tbody[data-rec="${recId}"]`);
    if (!tbody) return;
    while (tbody.firstChild) tbody.removeChild(tbody.firstChild);
  }

  // Weighted quantity distribution helpers
  function getSelectedRecipientWeights(){
    const recs = getSelectedRecipientObjects();
    const weights = new Map();
    let sumNonZero = 0;
    let nonZero = 0;
    const zeroKeys = [];
    recs.forEach(r => {
      const traw = parseInt(r.total_residents||0,10);
      const k = Number(r.id||r.user_id||0)||0;
      const w = Number.isFinite(traw) && traw > 0 ? traw : 0;
      if (w > 0){ nonZero++; sumNonZero += w; weights.set(k, w); }
      else { weights.set(k, 0); zeroKeys.push(k); }
    });
    const selCount = recs.length || 1;
    // If all are zero/missing, fall back to equal weights of 1 each
    if (sumNonZero === 0){
      recs.forEach(r => { weights.set(Number(r.id||r.user_id||0)||0, 1); });
      return { weights, sum: selCount, selCount, avg: 1 };
    }
    const avg = sumNonZero / Math.max(1, nonZero);
    // Replace zeros with average (float) and recompute total sum
    zeroKeys.forEach(k => { weights.set(k, avg); });
    const sum = sumNonZero + (avg * zeroKeys.length);
    return { weights, sum, selCount, avg };
  }
  function invTotalFor(name, category){
    const key = invKey(name, category);
    if (__invSummary && __invSummary.has(key)) return Number(__invSummary.get(key).total||0)||0;
    // Fallback: try to find by name only if category key not found
    try{
      const nlc = String(name||'').trim().toLowerCase();
      let total = 0;
      __invSummary.forEach(meta => { if (String(meta.name||'').trim().toLowerCase() === nlc){ total = Number(meta.total||0)||0; } });
      return total;
    } catch(_){ return 0; }
  }
  function getPlannedUsageMap(){
    if (!window.__diPlannedUsage) window.__diPlannedUsage = new Map();
    return window.__diPlannedUsage;
  }
  function plannedUsedFor(name, category){
    const key = invKey(name, category);
    const m = getPlannedUsageMap();
    return Number(m.get(key)||0) || 0;
  }
  function addPlannedUsage(name, category, qty){
    const key = invKey(name, category);
    const m = getPlannedUsageMap();
    const cur = Number(m.get(key)||0) || 0;
    m.set(key, cur + Math.max(0, Number(qty)||0));
  }

  // ---- Safe modal utility to avoid stuck dark screen ----
  function safeShowAlertModal(message, primaryHref, primaryText){
    try{
      const modalEl = document.getElementById('diAlertModal');
      const body = document.getElementById('diAlertBody');
      const primary = document.getElementById('diAlertPrimaryLink');
      if (body && typeof message === 'string') body.textContent = message;
      if (primary && primaryHref){ primary.href = primaryHref; primary.classList.remove('d-none'); primary.textContent = primaryText || 'Open'; }
      // Disable backdrop so the screen does not darken
      const inst = modalEl ? new bootstrap.Modal(modalEl, { backdrop: false, focus: true }) : null;
      if (inst) inst.show();
      // Fallback: if modal did not become visible, clean any stuck backdrops and inline-message instead
      setTimeout(() => {
        const shown = !!document.querySelector('#diAlertModal.show');
        if (!shown){
          document.querySelectorAll('.modal-backdrop').forEach(el => { try{ el.remove(); } catch(_){} });
          document.body.classList.remove('modal-open');
          document.body.style.removeProperty('overflow');
          showMsg(qs('#diAllocMeta')||qs('#diFeedback'), message || 'Done.', 'success');
        }
      }, 400);
    } catch(err){
      // Last resort cleanup
      try{ document.querySelectorAll('.modal-backdrop').forEach(el => el.remove()); } catch(_){ }
      document.body.classList.remove('modal-open');
      document.body.style.removeProperty('overflow');
      showMsg(qs('#diAllocMeta')||qs('#diFeedback'), message || 'Done.', 'success');
    }
  }

  // Compute total planned quantity per inventory key across all rows
  function computeCurrentTotals(){
    const totals = new Map();
    qsa('.di-rec-tbody tr').forEach(tr => {
      const name = (qs('.di-name', tr)?.value || '').trim();
      const cat = (qs('.di-cat', tr)?.value || '').trim();
      const qty = Math.max(0, parseInt(qs('.di-alloc', tr)?.value || '0', 10) || 0);
      if (!name) return;
      const key = invKey(name, cat);
      totals.set(key, (totals.get(key)||0) + qty);
    });
    return totals;
  }

  // Refresh Avail (Remaining/Total) for each row using in-memory inventory summary
  function recomputeAvailabilities(){
    if (!__invSummary || typeof __invSummary.size !== 'number') return;
    const totals = computeCurrentTotals();
    qsa('.di-rec-tbody tr').forEach(tr => {
      const name = (qs('.di-name', tr)?.value || '').trim();
      const cat = (qs('.di-cat', tr)?.value || '').trim();
      const qty = Math.max(0, parseInt(qs('.di-alloc', tr)?.value || '0', 10) || 0);
      const span = qs('.di-avail', tr);
      if (!span || !name) return;
      const key = invKey(name, cat);
      const meta = __invSummary.get(key);
      let total = 0;
      if (meta && typeof meta.total === 'number'){ total = meta.total; }
      else { total = invTotalFor(name, cat); }
      const pool = Math.floor(Math.max(0, total) * 0.90);
      const sum = totals.get(key) || 0;
      const remaining = Math.max(0, pool - (sum - qty));
      span.textContent = `${remaining}/${pool}`;
      span.classList.toggle('text-danger', remaining === 0 && pool > 0);
    });
  }

  async function autoPopulateForRecipient(recId){
    const all = window.__diAllRecipients || [];
    const meta = all.find(u => (u.user_id||u.id) === recId) || {};
    // Ensure inventory summary exists
    try { if (!__invSummary || typeof __invSummary.size !== 'number' || __invSummary.size === 0) { await loadInventorySummary(); } } catch(_){ }
    const needs = deriveRecipientNeeds(meta);
    let items = pickInventoryForNeeds(needs);
    if (!items || items.length === 0){
      items = [
        { category: 'Grains', name: 'Rice', quantity: 5 },
        { category: 'Canned Goods', name: 'Canned Sardines', quantity: 4 },
        { category: 'Dry Goods', name: 'Instant Noodles', quantity: 3 },
      ];
    }
    // Compute weighted quantities per item using 90% of inventory across all selected recipients
    const { weights, sum, selCount, avg } = getSelectedRecipientWeights();
    let myW = weights.get(recId);
    if (!Number.isFinite(myW) || myW <= 0){ myW = avg || 1; }
    const minOne = (x)=> (x>0 ? Math.max(1, x) : 0);

    const computed = items.map(it => {
      const total = invTotalFor(it.name, it.category);
      const pool = Math.floor(total * 0.90) - plannedUsedFor(it.name, it.category);
      const available = Math.max(0, pool);
      let qty = 0;
      if (available > 0 && sum > 0){
        qty = Math.floor(available * (myW / sum));
        // Ensure at least 1 if we planned this tag for this recipient and stock exists
        qty = minOne(qty);
        // Cap to available pool
        qty = Math.min(qty, available);
      }
      return { ...it, quantity: qty };
    }).filter(it => (it.quantity||0) > 0);

    clearRecipientRows(recId);
    computed.forEach(it => {
      addRecipientRowWithValues(recId, it.category, it.name, it.quantity);
      addPlannedUsage(it.name, it.category, it.quantity);
    });
    try{ recomputeAvailabilities(); } catch(_){}
    // Feedback
    const tbody = qs(`.di-rec-tbody[data-rec="${recId}"]`);
    const rowCount = tbody ? qsa('tr', tbody).length : 0;
    const fb = qs('#diAllocMeta') || qs('#diFeedback');
    if (rowCount > 0) showMsg(fb, `Auto-filled ${rowCount} line(s) using 90% pooled inventory weighted by population.`, 'success');
    else showMsg(fb, 'No items could be suggested yet. Try loading inventory or add items manually.', 'warning');
  }

  // Collect allocations from Allocation tab grouped by recipient
  function collectAllocationsFromUI(){
    const groups = [];
    qsa('.di-rec-tbody').forEach(tbody => {
      const recId = parseInt(tbody.getAttribute('data-rec')||'0', 10) || 0;
      if (!recId) return;
      const items = [];
      qsa('tr', tbody).forEach(tr => {
        const name = qs('.di-name', tr)?.value.trim();
        const cat = qs('.di-cat', tr)?.value.trim();
        const qty = Math.max(0, parseInt(qs('.di-alloc', tr)?.value || '0', 10) || 0);
        const key = invKey(name, cat);
        if (__invSummary.has(key) && __invSummary.get(key).total >= qty){
          items.push({ item_name: name, category: cat || '', quantity: qty });
        } else {
          throw new Error(`Invalid allocation: ${qty} of ${name} (${cat}) exceeds available stock`);
        }
      });
      if (items.length){ groups.push({ recipient_id: recId, items }); }
    });
    return groups;
  }

  // Build lookup sets for categories and item names per category
  function rebuildInventoryLookups(){
    const cats = new Set();
    const namesByCat = new Map();
    // Build derived tags for each inventory item for better matching
    const itemTags = new Map(); // key: invKey(name,category) -> Set(tags)
    const norm = (s)=> String(s||'').toLowerCase().trim();
    __invSummary.forEach(meta => {
      const cat = String(meta.category||'').trim();
      const name = String(meta.name||'').trim();
      cats.add(cat);
      if (!namesByCat.has(cat)) namesByCat.set(cat, new Set());
      namesByCat.get(cat).add(name);
      // derive tags from name/category tokens
      const tokens = new Set([ ...norm(name).split(/[^a-z0-9]+/).filter(Boolean), ...norm(cat).split(/[^a-z0-9]+/).filter(Boolean) ]);
      // add semantic tags from our inference
      const tag = inferItemTag(meta);
      tokens.add(tag);
      // expand specialty synonyms
      if (tag==='dairy_infant'){ ['infant','baby','toddler','formula'].forEach(t=>tokens.add(t)); }
      if (tag==='dairy_elderly'){ ['elder','senior','adult','ensure','fortified'].forEach(t=>tokens.add(t)); }
      if (tag==='medicine'){ ['medicine','med','vitamin','paracetamol'].forEach(t=>tokens.add(t)); }
      itemTags.set(invKey(name, cat), tokens);
    });
    try { window.__invItemTags = itemTags; } catch(_){ }
    return { cats, namesByCat };
  }

  function select2DataFromSet(set){
    return Array.from(set).filter(v=>v!==null && v!==undefined).map(v => ({ id: v, text: v||'(Uncategorized)' }));
  }

  function initGlobalSelectsFromInventory(){
    try{
      const $ = window.jQuery || window.$;
      if (!$ || typeof $.fn.select2 !== 'function') return;
      const { cats, namesByCat } = rebuildInventoryLookups();
      const $cat = $('#diGlobalCat');
      const $name = $('#diGlobalName');
      const $modal = $('#distributeItemsModal');
      const ddParent = $modal.length ? $modal : $(document.body);
      // Populate Category from inventory (allow free typing; validate after)
      if ($cat && $cat.length){
        const catData = select2DataFromSet(cats);
        try{
          if ($cat.hasClass('select2-hidden-accessible') || ($cat.data && $cat.data('select2'))){
            $cat.select2('destroy');
          }
        } catch(_){ }
        $cat.empty();
        $cat.select2({ data: catData, tags: true, placeholder: $cat.data('placeholder')||'Category', allowClear: true, width: '100%', dropdownParent: ddParent });
      }
      // Populate Item Name (filter by selected category; if none, show all)
      function refreshNames(){
        const catVal = String(($cat.val()||'')).trim();
        let namesSet;
        if (catVal){
          namesSet = namesByCat.get(catVal) || new Set();
        } else {
          namesSet = new Set(Array.from(namesByCat.values()).flatMap(s => Array.from(s)));
        }
        const nameData = select2DataFromSet(namesSet);
        try{
          if ($name.hasClass('select2-hidden-accessible') || ($name.data && $name.data('select2'))){
            $name.select2('destroy');
          }
        } catch(_){ }
        $name.empty();
        $name.select2({ data: nameData, tags: true, placeholder: $name.data('placeholder')||'Item name', allowClear: true, width: '100%', dropdownParent: ddParent });
      }
      // Bind dependent select refresh
      $cat.off('change.di').on('change.di', refreshNames);
      // Initial populate for Item Name
      try {
        // Force a change to refresh names now
        refreshNames();
      } catch(_) {}
    } catch(_) { /* ignore */ }
  }

  // Initialize modal bindings and controls
  function init(){
    const modalEl = document.getElementById('distributeItemsModal');
    if (modalEl && !modalEl.hasAttribute('tabindex')){ modalEl.setAttribute('tabindex', '-1'); }
    // When modal opens, load recipients and annotate weeks, then update badge
    modalEl?.addEventListener('shown.bs.modal', async () => {
      try {
        // Default the month control to current if not set
        const mEl = qs('#diMonth');
        if (mEl && !mEl.value){ mEl.value = currentMonth(); }
        // Ensure week-start setting is loaded
        if (!window.__WEEK_START) { await loadWeekStartSetting(); }
        // Load inventory suggestions and init Select2s
        await loadInventorySummary();
        initGlobalSelectsFromInventory();
        // Load recipients once and render the pool (selected will be auto-moved by plan)
        try {
          window.__diAllRecipients = await fetchRecipients();
        } catch (e) {
          window.__diAllRecipients = [];
          showMsg(qs('#diFeedback'), 'Failed to load recipients. Please ensure you are logged in and have approved recipients.', 'danger');
        }
        renderRecipientPools(window.__diAllRecipients || [], []);
        if (!window.__diAllRecipients || !window.__diAllRecipients.length){
          showMsg(qs('#diFeedback'), 'No approved recipients found. Add or approve recipients to continue.', 'warning');
        }
        // Fetch plan for current month and annotate/move
        const month = (qs('#diMonth')?.value || currentMonth());
        const data = await fetchMonthlyPlan(month).catch(()=>({weeks:{}}));
        annotateCardsWithWeeks(data?.weeks || {});
        sortPoolByWeeks(data?.weeks || {});
        autoMoveCurrentWeekRecipients(data?.weeks || {});
        sortSelectedByCarryovers();
        updateCurrentWeekBadge();
        // If Selected has items, auto-build allocation slides so arrows work immediately
        const selectedCount = qsa('#diSelected .di-card').length;
        if (selectedCount > 0){
          const recObjs = getSelectedRecipientObjects();
          if (recObjs.length){ buildAllocationColumns(recObjs, {}); }
        } else {
          showMsg(qs('#diFeedback'), 'No recipients planned for this week. Drag from Pool to Selected, then click Next.', 'info');
        }
        // Focus modal for keyboard navigation
        try { modalEl.focus(); } catch(_) {}
      } catch (e) {
        console.warn('Distribute modal init failed:', e);
      }
    });

    // Standalone page init (no modal present)
    const isPage = !modalEl && document.getElementById('diPool') && document.getElementById('diSelected');
    if (isPage){
      (async () => {
        try {
          // Month default and week-start
          const mEl = qs('#diMonth');
          if (mEl && !mEl.value){ mEl.value = currentMonth(); }
          if (!window.__WEEK_START) { await loadWeekStartSetting(); }
          // Inventory suggestions and selects
          await loadInventorySummary();
          initGlobalSelectsFromInventory();
          // Recipients
          try{ window.__diAllRecipients = await fetchRecipients(); } catch(_){ window.__diAllRecipients = []; }
          renderRecipientPools(window.__diAllRecipients || [], []);
          if (!window.__diAllRecipients || !window.__diAllRecipients.length){
            showMsg(qs('#diFeedback'), 'No approved recipients found. Add or approve recipients to continue.', 'warning');
          }
          // Plan annotate and auto-move
          const month = (qs('#diMonth')?.value || currentMonth());
          const data = await fetchMonthlyPlan(month).catch(()=>({weeks:{}}));
          annotateCardsWithWeeks(data?.weeks || {});
          sortPoolByWeeks(data?.weeks || {});
          autoMoveCurrentWeekRecipients(data?.weeks || {});
          sortSelectedByCarryovers();
          updateCurrentWeekBadge();
          // Auto-build allocation if any selected
          const recObjs = getSelectedRecipientObjects();
          if (recObjs.length){ buildAllocationColumns(recObjs, {}); }
        } catch(e){ console.warn('Distribute page init failed:', e); }
      })();
    }

    // Confirm Round: mark served vs skipped for quarterly flow
    qs('#diConfirmRound')?.addEventListener('click', async () => {
        try{
          const selectedIds = getSelectedIds();
          if (!selectedIds.length) { showMsg(qs('#diFeedback'), 'No recipients selected to confirm.', 'warning'); return; }
          // Compute per-recipient allocated sum from Allocation tab
          const served = [];
          const skipped = [];
          selectedIds.forEach(id => {
            const tbody = qs(`.di-rec-tbody[data-rec="${id}"]`);
            let sum = 0;
            if (tbody){
              qsa('input.di-alloc', tbody).forEach(inp => { sum += Math.max(0, parseInt(inp.value || '0', 10) || 0); });
            }
            if (sum > 0) served.push(id); else skipped.push(id);
          });
          await markPeriodResult(served, skipped);
          showMsg(qs('#diFeedback'), 'Round results saved. Skipped will be prioritized next round.', 'success');
        } catch(err){
          console.error('Confirm round failed:', err);
          showMsg(qs('#diFeedback'), err.message || 'Failed to save round results', 'danger');
        }
      });

    // Next button: build Allocation tab from current selection (or first 5 from Pool)
    qs('#diNextBtn')?.addEventListener('click', async () => {
      const recObjs = getSelectedRecipientObjects();
      if (!recObjs.length){
        showMsg(qs('#diFeedback'), 'Select at least one recipient first.', 'warning');
        return;
      }
      buildAllocationColumns(recObjs, {});
      try { await loadInventorySummary(); recomputeAvailabilities(); } catch(_){ }
    });

    // If user switches to Allocation tab manually, auto-build columns once
    document.getElementById('di-alloc-tab')?.addEventListener('shown.bs.tab', async () => {
      const host = qs('#diAllocCarouselInner');
      if (host && host.children && host.children.length > 0) return; // already built
      const recObjs = getSelectedRecipientObjects();
      if (!recObjs.length){ showMsg(qs('#diFeedback'), 'Select at least one recipient first.', 'warning'); return; }
      buildAllocationColumns(recObjs, {});
      try { await loadInventorySummary(); recomputeAvailabilities(); } catch(_){ }
    });

    // Global Add: add row into currently active recipient slide
    qs('#diGlobalAddBtn')?.addEventListener('click', async (e) => {
      e.preventDefault(); e.stopPropagation();
      const activeTBody = qs('#diAllocCarouselInner .carousel-item.active .di-rec-tbody');
      if (!activeTBody) return;
      const recId = parseInt(activeTBody.getAttribute('data-rec')||'0', 10) || 0;
      if (!recId) return;
      // Read from Select2 selects (fallback to plain value)
      const catEl = qs('#diGlobalCat');
      const nameEl = qs('#diGlobalName');
      const qtyEl = qs('#diGlobalQty');
      const $ = window.jQuery || window.$;
      const cat = ($ && $.fn && $(catEl).val) ? String($(catEl).val()||'').trim() : ((catEl?.value||'').trim());
      const name = ($ && $.fn && $(nameEl).val) ? String($(nameEl).val()||'').trim() : ((nameEl?.value||'').trim());
      const qty = ($ && $.fn && $(qtyEl).val) ? String($(qtyEl).val()||'0') : (qtyEl?.value || '0');
      addRecipientRowWithValues(recId, cat, name, qty);
      // optional: clear fields
      try { if ($ && $.fn){ $('#diGlobalName').val(null).trigger('change'); $('#diGlobalQty').val('0').trigger('change'); } } catch(_){ }
      try { await loadInventorySummary(); recomputeAvailabilities(); } catch(_){ }
    });

    // Auto for All: use server-side pooled 90% preview and apply to UI (restricted to selected recipients)
    qs('#diGlobalAutoAllBtn')?.addEventListener('click', async (e) => {
      e.preventDefault(); e.stopPropagation();
      const fb = qs('#diFeedback');
      try{
        const pk = getPeriodKeyFromInputs();
        if (!pk) { showMsg(fb, 'Please choose a valid Month and Week.', 'warning'); return; }
        const selIds = getSelectedIds();
        if (!selIds.length){ showMsg(fb, 'Select at least one recipient first.', 'warning'); return; }
        // no status alert for auto-all
        // Ensure recipients are loaded for labels
        if (!window.__diAllRecipients) window.__diAllRecipients = await fetchRecipients();
        const recMap = new Map((window.__diAllRecipients||[]).map(u => [Number(u.user_id || u.id), u]));
        // Call server preview (pooled distribution across inventory) restricted to current selection
        const j = await fetchJson(`${API_BASE_URL}/allocations.php?action=preview_allocation&recipient_ids=${encodeURIComponent(selIds.join(','))}`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: JSON.stringify({ period_key: pk, recipient_ids: selIds })
        });
        const allocations = Array.isArray(j?.data?.allocations) ? j.data.allocations : [];
        if (!allocations.length){ showMsg(fb, 'No allocations suggested for this week.', 'warning'); return; }
        const orderedIds = Array.from(new Set(allocations.map(a => Number(a.recipient_id)).filter(n=>Number.isFinite(n)&&n>0)));
        const recipients = orderedIds.map(id => ({ id, ...(recMap.get(id) || {}) }));
        buildAllocationColumns(recipients, {});
        // Clear all rows first per recipient to avoid duplicates
        recipients.forEach(r => clearRecipientRows(Number(r.id)));
        // Populate rows per recipient
        allocations.forEach(a => {
          if (a.inventory_id && a.quantity > 0){
            addRecipientRowWithValues(Number(a.recipient_id), a.product_category || '', a.product_name || '', a.quantity || 1);
          }
        });
        try { await loadInventorySummary(); recomputeAvailabilities(); } catch(_){ }
        // no success alert for auto-all
      } catch(err){
        console.error('Auto for All failed:', err);
        // suppress error alert below carousel as requested
      }
    });

    // Load final weekly list (carry-overs first + planned)
    qs('#diLoadFinal')?.addEventListener('click', async () => {
      const fb = qs('#diFeedback');
      try{
        const pk = getPeriodKeyFromInputs();
        if (!pk) { showMsg(fb, 'Please choose a valid Month and Week.', 'warning'); return; }
        showMsg(fb, 'Loading final weekly list...', 'secondary');
        const res = await fetch(`${API_BASE_URL}/recipients_list.php?action=finalize_week&period_key=${encodeURIComponent(pk)}`, { credentials:'include' });
        const j = await res.json();
        if (!res.ok || !j?.success) throw new Error(j?.error || `HTTP ${res.status}`);
        const ids = Array.isArray(j?.data?.final) ? j.data.final.map(n=>parseInt(n,10)).filter(n=>Number.isFinite(n)&&n>0) : [];
        if (!window.__diAllRecipients) window.__diAllRecipients = await fetchRecipients();
        renderRecipientPools(window.__diAllRecipients, ids);
        showMsg(fb, `Loaded final list for ${pk} (${ids.length} recipients).`, 'success');
      } catch(err){
        console.error('Load final list failed:', err);
        showMsg(qs('#diFeedback'), err.message || 'Failed to load final list', 'danger');
      }
    });

      // Preview Allocation (server-side tag matching, no deduction)
      qs('#diPreviewAlloc')?.addEventListener('click', async () => {
        const fb = qs('#diFeedback');
        try{
          const pk = getPeriodKeyFromInputs();
          if (!pk) { showMsg(fb, 'Please choose a valid Month and Week.', 'warning'); return; }
          const selIds = getSelectedIds();
          if (!selIds.length){ showMsg(fb, 'Select at least one recipient first.', 'warning'); return; }
          // Ensure recipients loaded for labels
          if (!window.__diAllRecipients) window.__diAllRecipients = await fetchRecipients();
          const recMap = new Map((window.__diAllRecipients||[]).map(u => [Number(u.user_id || u.id), u]));
          // Call preview for the currently selected recipients
          const j = await fetchJson(`${API_BASE_URL}/allocations.php?action=preview_allocation&recipient_ids=${encodeURIComponent(selIds.join(','))}`, {
            method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body: JSON.stringify({ period_key: pk, recipient_ids: selIds })
          });
          const allocations = Array.isArray(j?.data?.allocations) ? j.data.allocations : [];
          if (!allocations.length){ showMsg(fb, 'No allocations suggested for this selection.', 'warning'); return; }
          const orderedIds = Array.from(new Set(allocations.map(a => Number(a.recipient_id)).filter(n=>Number.isFinite(n)&&n>0)));
          const recipients = orderedIds.map(id => ({ id, ...(recMap.get(id) || {}) }));
          buildAllocationColumns(recipients, {});
          // Aggregate and populate rows per recipient
          const agg = new Map();
          allocations.forEach(a => {
            const rid = Number(a.recipient_id);
            const name = (a.product_name || '').toString();
            const cat = (a.product_category || '').toString();
            const qty = Number(a.quantity || 0) || 0;
            if (!rid || !name || qty <= 0) return;
            const key = rid + '\u0001' + cat + '\u0001' + name;
            agg.set(key, (agg.get(key) || 0) + qty);
          });
          agg.forEach((qty, key) => {
            const [ridStr, cat, name] = key.split('\u0001');
            addRecipientRowWithValues(Number(ridStr), cat, name, qty);
          });
          showMsg(fb, 'Allocation preview loaded (no inventory deducted).', 'success');
          // Refresh inventory suggestions and selects
          loadInventorySummary().then(initGlobalSelectsFromInventory);
        } catch(err){
          console.error('Preview allocation failed:', err);
          showMsg(qs('#diFeedback'), err.message || 'Failed to preview allocation', 'danger');
        }
      });

      // Allocate Now (persist to DB; DO NOT deduct inventory). Recipients will later acknowledge and pickup.
      qs('#diAllocateWeek')?.addEventListener('click', async () => {
        const fb = qs('#diAllocMeta');
        const btn = qs('#diAllocateWeek');
        try {
          // Validate against in-memory inventory
          const planned = computePlannedTotals();
          for (const [key, qty] of planned.entries()){
            const have = __invSummary.get(key)?.total || 0;
            if (qty > have){
              const meta = __invSummary.get(key);
              const label = meta ? `${meta.name} (${meta.category||'Uncategorized'})` : key.split('\u0001')[0];
              showMsg(fb, `Cannot allocate ${qty} of ${label}; only ${have} in stock. Adjust quantities.`, 'danger');
              return;
            }
          }
          const groups = collectAllocationsFromUI();
          if (!groups.length){ showMsg(fb, 'Nothing to allocate. Add items and quantities first.', 'warning'); return; }
          btn.disabled = true;
          showMsg(fb, 'Saving allocations to database (no inventory deducted)...', 'secondary');
          // Create an allocation run first
          function computePeriodKey(d){
            const y = d.getFullYear();
            const m = String(d.getMonth()+1).padStart(2,'0');
            const day = d.getDate();
            let w = Math.ceil(day/7);
            if (w < 1) w = 1; if (w > 4) w = 4;
            return `${y}-${m}-W${w}`;
          }
          const periodKey = computePeriodKey(new Date());
          let runId = 0;
          try{
            const rr = await fetch(`${API_BASE_URL}/allocations.php?action=create_run`, {
              method:'POST', credentials:'include', headers:{'Content-Type':'application/json','Accept':'application/json'},
              body: JSON.stringify({ note: `Auto-run ${new Date().toISOString()}`, period_key: periodKey })
            });
            const rj = await rr.json().catch(()=>null);
            if (!(rr.ok && rj && rj.success && rj.data && rj.data.run_id)) throw new Error('Failed to create run');
            runId = Number(rj.data.run_id)||0;
          } catch(e){ showMsg(fb, 'Failed to create allocation run.', 'danger'); btn.disabled=false; return; }

          // Persist allocations per recipient directly to DB with run_id
          const results = [];
          for (const g of groups){
            const rid = Number(g.recipient_id || g.id || 0) || 0;
            const items = (Array.isArray(g.items) ? g.items : []).map(it => ({
              item_name: String(it.item_name || it.name || ''),
              category: String(it.category || it.product_category || ''),
              quantity: Number(it.quantity || it.qty || 0) || 0,
            })).filter(x => x.item_name && x.quantity > 0);
            if (!rid || !items.length) continue;
            try{
              const res = await fetch(`${API_BASE_URL}/allocations.php?action=create_result`, {
                method:'POST', credentials:'include', headers:{'Content-Type':'application/json','Accept':'application/json'},
                body: JSON.stringify({ recipient_id: rid, items, run_id: runId })
              });
              const j = await res.json().catch(()=>null);
              const ok = !!(res.ok && j && j.success && j.data && j.data.allocation_id);
              results.push({ rid, ok, id: j?.data?.allocation_id || null });
            } catch(_){ results.push({ rid, ok:false, id:null }); }
          }
          const okIds = results.filter(r=>r.ok).map(r=>r.rid);
          if (okIds.length > 0 && runId){
            // Redirect to DB-backed result view by period_key to keep URL clean
            window.location.href = `DistributeResult.html?period_key=${encodeURIComponent(String(periodKey))}`;
            return;
          } else {
            const failCount = results.length;
            showMsg(fb, `No allocations were saved. Failed: ${failCount}.`, 'danger');
          }
        } catch(err){
          console.error('Save plan failed:', err);
          showMsg(qs('#diAllocMeta'), err?.message || 'Failed to save allocation plan', 'danger');
        } finally {
          btn.disabled = false;
        }
      });

    // Clean highlights on hide
    modalEl?.addEventListener('hide.bs.modal', () => {
        showMsg(qs('#diFeedback'), '', '');
        // nothing else to clean for DnD
      });

    // When month changes, re-annotate cards and auto-move current week recipients for that month
    qs('#diMonth')?.addEventListener('change', async () => {
      try{
        await finalizeCurrentWeekIfPossible();
        const month = qs('#diMonth')?.value || currentMonth();
        const data = await fetchMonthlyPlan(month);
        annotateCardsWithWeeks(data?.weeks || {});
        sortPoolByWeeks(data?.weeks || {});
        autoMoveCurrentWeekRecipients(data?.weeks || {});
        sortSelectedByCarryovers();
        updateCurrentWeekBadge();
      } catch(err){ console.warn('Month change plan fetch failed', err); }
    });

  }

  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', () => { if (typeof init === 'function') init(); });
  } else {
    if (typeof init === 'function') init();
  }
})();
