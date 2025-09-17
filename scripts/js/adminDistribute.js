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

  async function finalizeCurrentWeekIfPossible(){
    try{
      const pk = getPeriodKeyFromInputs();
      if (!pk) return;
      const res = await fetch(`${API_BASE_URL}/recipients_list.php?action=finalize_week&period_key=${encodeURIComponent(pk)}`, { credentials: 'include' });
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
    const wk = getCurrentWeekBucket();
    // Map to contextual color same as badges
    const color = wk==='W1' ? 'primary' : wk==='W2' ? 'danger' : wk==='W3' ? 'warning' : 'info';
    badge.textContent = wk;
    badge.className = `badge bg-${color}`;
  }

  function currentMonth(){
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
  }

  function getPeriodKeyFromInputs(){
    const monthEl = qs('#diMonth');
    const month = (monthEl?.value || currentMonth());
    if (!/^\d{4}-\d{2}$/.test(month)) return null;
    // Derive week bucket from current date: 1-7 W1, 8-14 W2, 15-21 W3, 22+ W4
    const today = new Date();
    const day = today.getDate();
    const w = day <= 7 ? 'W1' : day <= 14 ? 'W2' : day <= 21 ? 'W3' : 'W4';
    return `${month}-${w}`;
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
    const d = new Date();
    const day = d.getDate();
    return day <= 7 ? 'W1' : day <= 14 ? 'W2' : day <= 21 ? 'W3' : 'W4';
  }

  async function fetchMonthlyPlan(month){
    const m = month || currentMonth();
    const res = await fetch(`${API_BASE_URL}/recipients_list.php?action=get_plan&month=${encodeURIComponent(m)}`, { credentials:'include' });
    if (!res.ok) return { month: m, weeks: { W1:[], W2:[], W3:[], W4:[] } };
    const j = await res.json().catch(()=>null);
    if (!j?.success) return { month: m, weeks: { W1:[], W2:[], W3:[], W4:[] } };
    return j.data || { month: m, weeks: { W1:[], W2:[], W3:[], W4:[] } };
  }

  function annotateCardsWithWeeks(weeksMap){
    const toSet = (arr)=> new Set((Array.isArray(arr)?arr:[]).map(v=>parseInt(v,10)).filter(n=>Number.isFinite(n)&&n>0));
    const W1 = toSet(weeksMap?.W1); const W2 = toSet(weeksMap?.W2); const W3 = toSet(weeksMap?.W3); const W4 = toSet(weeksMap?.W4);
    const currentW = getCurrentWeekBucket();
    const isInWeek = (id, wk)=> wk==='W1'?W1.has(id):wk==='W2'?W2.has(id):wk==='W3'?W3.has(id):W4.has(id);
    const colorFor = (wk)=> wk==='W1' ? 'primary' : wk==='W2' ? 'danger' : wk==='W3' ? 'warning' : 'info';
    const carrySet = (window.__diCarryOverSet instanceof Set) ? window.__diCarryOverSet : new Set();
    let prevW = null;
    const prevKey = window.__diPrevWeekKey || '';
    const m = /^\d{4}-\d{2}-W([1-4])$/.exec(prevKey);
    if (m) prevW = `W${m[1]}`;
    qsa('.di-card').forEach(card => {
      const id = parseInt(card.dataset.id||'0',10) || 0;
      const host = qs('.di-week-badges', card);
      if (host) host.innerHTML = '';
      card.classList.remove('border-primary','border-danger','border-warning','border-info');
      // If this is a carry-over, show previous-week badge and border using that week's color
      if (carrySet.has(id) && prevW){
        const c = colorFor(prevW);
        if (host){
          const span = document.createElement('span');
          span.className = `badge bg-${c} text-uppercase`;
          span.style.fontSize = '0.65rem';
          span.textContent = prevW;
          host.appendChild(span);
        }
        card.classList.add(`border-${c}`);
      } else {
        // Otherwise, annotate based on scheduled week(s)
        ['W1','W2','W3','W4'].forEach(wk => {
          if (isInWeek(id, wk)){
            if (host){
              const span = document.createElement('span');
              span.className = `badge bg-${colorFor(wk)} text-uppercase`;
              span.style.fontSize = '0.65rem';
              span.textContent = wk;
              host.appendChild(span);
            }
            if (wk === currentW){
              card.classList.add(`border-${colorFor(wk)}`);
            }
          }
        });
      }
    });
  }

  function autoMoveCurrentWeekRecipients(weeksMap){
    const currentW = getCurrentWeekBucket();
    const ids = new Set((weeksMap?.[currentW]||[]).map(v=>parseInt(v,10)).filter(n=>Number.isFinite(n)&&n>0));
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
      const title = (r.organization_name && r.organization_name.trim()) ? r.organization_name : (r.name || ('Recipient ' + r.id));
      slide.innerHTML = `
        <div class="p-2 h-100 d-flex flex-column">
          <div class="d-flex justify-content-between align-items-center mb-2">
            <div class="fw-semibold">${title}</div>
            <button type="button" class="btn btn-sm btn-outline-secondary di-add-item-rec" data-rec="${r.id}">Add item</button>
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
  }

  function addRecipientRowWithValues(recId, cat, name, qty){
    const tbody = qs(`.di-rec-tbody[data-rec="${recId}"]`);
    if (!tbody) return;
    const q = Math.max(0, parseInt(qty || '0', 10) || 0);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><input class="form-control form-control-sm di-cat" placeholder="Category (optional)" value="${(cat||'').replace(/"/g,'&quot;')}"></td>
      <td><input class="form-control form-control-sm di-name" placeholder="Item name" value="${(name||'').replace(/"/g,'&quot;')}"></td>
      <td style="width:90px"><input type="number" min="0" step="1" class="form-control form-control-sm di-alloc" data-rec="${recId}" data-item="${(name||'').replace(/"/g,'&quot;')}" value="${q}"></td>
      <td style="width:40px"><button type="button" class="btn btn-sm btn-outline-danger di-del-row">&times;</button></td>
    `;
    tbody.appendChild(tr);
  }

  async function suggest(){
    const fb = qs('#diFeedback');
    const items = collectItems();
    if (!items.length){ showMsg(fb, 'Please add at least one item with quantity > 0', 'danger'); return; }

    const allRecipients = await fetchRecipients();
    // Decide pool type and specialty based on items (simple keyword rules)
    function detectPoolFromItems(items){
      const text = (s)=> String(s||'').toLowerCase();
      const keys = new Set();
      for (const it of items){
        const name = text(it.name);
        const cat = text(it.category);
        const blob = name + ' ' + cat;
        if (/infant|baby|children|kid|child|milk/gi.test(blob)) keys.add('children');
        if (/elderly|senior|aged/gi.test(blob)) keys.add('elderly');
        if (/medical|kit|medicine/gi.test(blob)) keys.add('medical');
      }
      if (keys.size === 1){ return { pool_type: 'specialty', specialty_key: Array.from(keys)[0] }; }
      return { pool_type: 'general', specialty_key: null };
    }
    const periodType = getPeriodType();
    const roundSize = parseInt(qs('#diRoundSize')?.value || '5', 10) || 5;
    const { pool_type, specialty_key } = detectPoolFromItems(items);
    // Ask server to suggest ordered recipients for this period/pool
    let suggestedIds = [];
    let leftoverSlots = 0;
    try{
      const res = await fetch(`${API_BASE_URL}/distribution.php?action=suggest`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ period_type: periodType, round_size: roundSize, pool_type, specialty_key })
      });
      const j = await res.json();
      if (!res.ok || !j?.success) throw new Error(j?.error || `HTTP ${res.status}`);
      suggestedIds = Array.isArray(j?.data?.recipient_ids) ? j.data.recipient_ids.map(n=>parseInt(n,10)).filter(Number.isFinite) : [];
      leftoverSlots = parseInt(j?.data?.leftover_slots ?? '0', 10) || 0;
      window.__diPeriodKey = j?.data?.period_key || null;
      window.__diPeriodType = periodType;
    } catch(err){ console.warn('distribution suggest failed; falling back to manual selection', err); }

    const recipients = buildRecipientsPayload(allRecipients);
    // If suggest returned ids, preselect them in UI before allocation
    if (suggestedIds.length){
      renderRecipientPools(allRecipients, suggestedIds);
    }
    const payload = buildRecipientsPayload(allRecipients);
    if (!payload.length){ showMsg(fb, 'Please select recipients or paste their IDs', 'danger'); return; }

    const options = buildOptions();

    try{
      showMsg(fb, 'Requesting suggestion...', 'secondary');
      const res = await fetch(`${API_BASE_URL}/allocate-items.php`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items, recipients, options })
      });
      const j = await res.json();
      if (!res.ok || !j?.success){ throw new Error(j?.error || `HTTP ${res.status}`); }
      const data = j.data || {};
      window.__diItems = items; // store for totals enforcement
      const usedRecipients = data.prioritized || payload;
      buildAllocationColumns(usedRecipients, data.allocations || {});
      attachSuggestTableEvents([], usedRecipients);
      const meta = qs('#diAllocMeta');
      if (meta){
        const sampled = j.meta?.sampled_count;
        const parts = [];
        if (typeof sampled === 'number') parts.push(`Sampled recipients: ${sampled}`);
        if (pool_type === 'specialty' && leftoverSlots > 0) parts.push(`Specialty leftover slots: ${leftoverSlots} (review to redistribute or hold)`);
        meta.textContent = parts.join(' · ');
      }
      showMsg(fb, '', '');
    } catch(err){
      console.error('Suggestion failed:', err);
      showMsg(fb, err.message || 'Suggestion failed', 'danger');
    }
  }

  async function preloadFiveRecipients(){
    const fb = qs('#diFeedback');
    try{
      showMsg(fb, 'Loading recipients...', 'secondary');
      const all = await fetchRecipients();
      window.__diAllRecipients = all;
      // Render all recipients into Pool (no auto-selection)
      renderRecipientPools(all, []);
      updateSelectedCount();
      showMsg(fb, '', '');
    } catch(err){
      console.error('Load recipients failed:', err);
      showMsg(qs('#diFeedback'), err.message || 'Failed to load recipients', 'danger');
    }
  }

  async function init(){
    // Items add/remove
    qs('#diAddItem')?.addEventListener('click', addItemRow);
    document.addEventListener('click', (e) => {
      const t = e.target;
      if (!(t instanceof HTMLElement)) return;
      if (t.classList.contains('di-del-item')){
        e.preventDefault(); e.stopPropagation();
        const tr = t.closest('tr');
        tr?.remove();
      }
      if (t.classList.contains('di-add-item-rec')){
        e.preventDefault(); e.stopPropagation();
        const rec = parseInt(t.getAttribute('data-rec') || '0', 10);
        if (rec) addRecipientRow(rec);
      }
      if (t.classList.contains('di-del-row')){
        e.preventDefault(); e.stopPropagation();
        const tr = t.closest('tr');
        tr?.remove();
      }
    });
    // Drag-and-drop interactions
    const pool = qs('#diPool');
    const selected = qs('#diSelected');
    function onDragStart(e){
      const target = e.target;
      if (!(target instanceof HTMLElement) || !target.classList.contains('di-card')) return;
      e.dataTransfer?.setData('text/plain', target.dataset.id || '');
      e.dataTransfer?.setDragImage(target, 10, 10);
    }
    function onDragOver(e){ e.preventDefault(); }
    function onDropToSelected(e){
      e.preventDefault();
      const id = parseInt(e.dataTransfer?.getData('text/plain') || '0', 10);
      const card = qs(`.di-card[data-id="${id}"]`);
      if (card && selected) { selected.appendChild(card); updateSelectedCount(); }
    }
    function onDropToPool(e){
      e.preventDefault();
      const id = parseInt(e.dataTransfer?.getData('text/plain') || '0', 10);
      const card = qs(`.di-card[data-id="${id}"]`);
      if (card && pool) { pool.appendChild(card); updateSelectedCount(); }
    }
    document.addEventListener('dragstart', onDragStart);
    pool?.addEventListener('dragover', onDragOver);
    selected?.addEventListener('dragover', onDragOver);
    pool?.addEventListener('drop', onDropToPool);
    selected?.addEventListener('drop', onDropToSelected);

    // Click to toggle (faster than dragging)
    document.addEventListener('click', (e) => {
      const t = e.target;
      if (!(t instanceof HTMLElement)) return;
      if (t.classList.contains('di-card')){
        const parent = t.parentElement;
        if (parent && parent.id === 'diPool') selected.appendChild(t); else pool.appendChild(t);
        updateSelectedCount();
      }
    });

    // Clear selected
    qs('#diClearSelected')?.addEventListener('click', () => {
      qsa('#diSelected .di-card').forEach(card => pool.appendChild(card));
      updateSelectedCount();
    });

    // preload a blank item row
    addItemRow();

    qs('#diSuggestBtn')?.addEventListener('click', suggest);
    qs('#diRegenerate')?.addEventListener('click', () => preloadFiveRecipients(true));
    qs('#diNextBtn')?.addEventListener('click', () => {
      // build allocation columns from current selection or suggested/highlighted
      let recObjs = getSelectedRecipientObjects();
      if (!recObjs.length){
        const all = window.__diAllRecipients || [];
        const map = new Map(all.map(u => [u.user_id || u.id, u]));
        const ids = getSelectedIds();
        recObjs = ids.map(id => ({ id, ...(map.get(id)||{}) }));
      }
      buildAllocationColumns(recObjs, {});
      const meta = qs('#diAllocMeta');
      if (meta){ meta.textContent = recObjs.length ? '' : 'No recipients selected.'; }
    });
    qs('#diSearch')?.addEventListener('input', applySearchFilter);

    // When modal opens, load recipients and auto-preselect 5 suggested
    const modalEl = document.getElementById('distributeItemsModal');
    if (modalEl){
      modalEl.addEventListener('shown.bs.modal', () => {
        // Default the month control to current if not set
        const m = qs('#diMonth');
        if (m && !m.value){ m.value = currentMonth(); }
        preloadFiveRecipients().then(async () => {
          try{
            await finalizeCurrentWeekIfPossible();
            const month = qs('#diMonth')?.value || currentMonth();
            const data = await fetchMonthlyPlan(month);
            annotateCardsWithWeeks(data?.weeks || {});
            sortPoolByWeeks(data?.weeks || {});
            autoMoveCurrentWeekRecipients(data?.weeks || {});
            updateCurrentWeekBadge();
          } catch(_) { /* ignore */ }
        });
      });
      // If user switches tabs manually to Allocation, render empty columns based on current selection
      modalEl.addEventListener('shown.bs.tab', (e) => {
        if (e.target && e.target.id === 'di-alloc-tab'){
          let recObjs = getSelectedRecipientObjects();
          if (!recObjs.length){
            const all = window.__diAllRecipients || [];
            const map = new Map(all.map(u => [u.user_id || u.id, u]));
            const hl = getHighlightedIdsFromPool();
            const ids = (hl.length ? hl : getFirstIdsFromPool(5)).slice(0,5);
            recObjs = ids.map(id => ({ id, ...(map.get(id)||{}) }));
          }
          buildAllocationColumns(recObjs, {});
        }
      });
      // Carousel handles single panel view; no accordion constraints needed
      // Keyboard navigation for carousel: left/right arrows
      modalEl.addEventListener('keydown', (e) => {
        const key = e.key;
        const carouselEl = document.getElementById('diAllocCarousel');
        if (!carouselEl) return;
        const carousel = bootstrap.Carousel.getOrCreateInstance(carouselEl, { interval: false, ride: false });
        if (key === 'ArrowLeft') { e.preventDefault(); carousel.prev(); }
        if (key === 'ArrowRight') { e.preventDefault(); carousel.next(); }
      });
      // Dedicated prev/next buttons near indicators
      const carouselEl = document.getElementById('diAllocCarousel');
      const carousel = carouselEl ? bootstrap.Carousel.getOrCreateInstance(carouselEl, { interval: false, touch: false, ride: false }) : null;
      qs('#diAllocPrevBtn')?.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); carousel?.prev(); });
      qs('#diAllocNextBtn')?.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); carousel?.next(); });
      // Keep indicators and counter in sync with slide events
      if (carouselEl){
        carouselEl.addEventListener('slide.bs.carousel', (ev) => {
          const to = ev.to; // index of the slide to be shown
          const dots = qsa('#diAllocIndicators [data-bs-target]');
          dots.forEach((d,i)=>{ if (i===to) d.classList.add('active'); else d.classList.remove('active'); });
          const counter = qs('#diAllocCounter');
          if (counter){ counter.textContent = `${to+1} / ${dots.length}`; }
        });
      }

      // Main-window Add button wires to currently active slide
      qs('#diGlobalAddBtn')?.addEventListener('click', (e) => {
        e.preventDefault(); e.stopPropagation();
        const activeSlide = qs('#diAllocCarouselInner .carousel-item.active .di-rec-tbody');
        if (!activeSlide) return;
        const recId = parseInt(activeSlide.getAttribute('data-rec') || '0', 10);
        if (!recId) return;
        const cat = (qs('#diGlobalCat')?.value || '').trim();
        const name = (qs('#diGlobalName')?.value || '').trim();
        const qty = qs('#diGlobalQty')?.value || '0';
        addRecipientRowWithValues(recId, cat, name, qty);
        // optional: clear fields
        // qs('#diGlobalName').value = '';
        // qs('#diGlobalQty').value = '0';
      });
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
          showMsg(fb, 'Previewing allocation...', 'secondary');
          // Ensure recipients are loaded for labels
          if (!window.__diAllRecipients) window.__diAllRecipients = await fetchRecipients();
          const recMap = new Map(window.__diAllRecipients.map(u => [Number(u.user_id || u.id), u]));
          // Call preview
          const res = await fetch(`${API_BASE_URL}/allocations.php?action=preview_allocation&period_key=${encodeURIComponent(pk)}`, { credentials:'include' });
          const j = await res.json();
          if (!res.ok || !j?.success) throw new Error(j?.error || `HTTP ${res.status}`);
          const allocations = Array.isArray(j?.data?.allocations) ? j.data.allocations : [];
          const orderedIds = allocations.map(a => Number(a.recipient_id)).filter(n=>Number.isFinite(n)&&n>0);
          const recipients = orderedIds.map(id => ({ id, ...(recMap.get(id) || {}) }));
          buildAllocationColumns(recipients, {});
          // Populate rows per recipient with preview suggestion
          allocations.forEach(a => {
            if (a.inventory_id && a.quantity > 0){
              addRecipientRowWithValues(Number(a.recipient_id), a.product_category || '', a.product_name || '', a.quantity || 1);
            }
          });
          showMsg(fb, 'Allocation preview loaded (no inventory deducted).', 'success');
        } catch(err){
          console.error('Preview allocation failed:', err);
          showMsg(qs('#diFeedback'), err.message || 'Failed to preview allocation', 'danger');
        }
      });

      // Allocate Now (deduct inventory, create movements)
      qs('#diAllocateWeek')?.addEventListener('click', async () => {
        const fb = qs('#diFeedback');
        try{
          const pk = getPeriodKeyFromInputs();
          if (!pk) { showMsg(fb, 'Please choose a valid Month and Week.', 'warning'); return; }
          showMsg(fb, 'Allocating and deducting inventory...', 'secondary');
          const res = await fetch(`${API_BASE_URL}/allocations.php?action=allocate_week`, {
            method: 'POST', credentials:'include', headers:{'Content-Type':'application/json','Accept':'application/json'},
            body: JSON.stringify({ period_key: pk })
          });
          const j = await res.json();
          if (!res.ok || !j?.success) throw new Error(j?.error || `HTTP ${res.status}`);
          showMsg(fb, `Allocation completed. Allocated to ${j?.data?.allocated ?? 0} recipient(s).`, 'success');
        } catch(err){
          console.error('Allocate week failed:', err);
          showMsg(qs('#diFeedback'), err.message || 'Failed to allocate', 'danger');
        }
      });

      // Clean highlights on hide
      modalEl.addEventListener('hide.bs.modal', () => {
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
          updateCurrentWeekBadge();
        } catch(err){ console.warn('Month change plan fetch failed', err); }
      });
    }
  }

  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
