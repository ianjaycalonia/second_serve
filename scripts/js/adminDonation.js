(function(){
  'use strict';

  // Allow override via window.API_BASE_URL; default to encoded project path
  const API_BASE_URL = (typeof window.API_BASE_URL === 'string' && window.API_BASE_URL)
    ? window.API_BASE_URL
    : '/Capstone%20Project/php/api';

  function badge(status){
    switch(status){
      case 'Pending': return '<span class="badge bg-warning text-dark">Pending</span>';
      case 'Acknowledged': return '<span class="badge bg-info text-dark">Acknowledged</span>';
      case 'Picked Up': return '<span class="badge bg-primary">Picked Up</span>';
      case 'Failed Safety': return '<span class="badge bg-danger">Failed Safety</span>';
      case 'Completed': return '<span class="badge bg-success">Completed</span>';
      case 'Cancelled': return '<span class="badge bg-dark">Cancelled</span>';
      default: return `<span class="badge bg-light text-dark">${status||'Unknown'}</span>`;
    }
}

// Populate category dropdowns from fixed list + current items' types
async function populateCategorySelects(currentItems){
  try {
    const desktop = getEl('categorySelectDesktop');
    const mobile = getEl('categorySelectMobile');
    const FIXED = [
      'Bakery',
      'Beverage - Juices/Coffee/Tea',
      'Beverage - Sweetened Beverages',
      'Beverage - Water',
      'Confectionary',
      'Dairy',
      'Fats & Oils',
      'Fruits & Vegetables',
      'Grains/Grain Products',
      'Non-Food - Baby Products',
      'Non-Food - Cleaning Products',
      'Non-Food - Others',
      'Non-Food - Personal Hygiene',
      'Non-Food - Pet Food',
      'Prepared Foods',
      'Processed Cereals/ Cereal Products',
      'Protein-Animal Based',
      'Ready-To-Eat Savories',
      'Sauces/Condiments/Seasonings',
      'Special Nutritional Uses',
      'Sweeteners'
    ];
    // Collect types from current items
    const dynamic = Array.from(new Set((Array.isArray(currentItems) ? currentItems : [])
      .map(it => (it && typeof it.type === 'string') ? it.type.trim() : '')
      .filter(v => v && v.toLowerCase() !== 'all')));
    // Merge fixed + dynamic (case-insensitive uniqueness, keep display as-is for fixed, others as found)
    const lowerSeen = new Set();
    const merged = [];
    const pushUniq = (label) => {
      const key = String(label).toLowerCase();
      if (!lowerSeen.has(key)) { lowerSeen.add(key); merged.push(label); }
    };
    FIXED.forEach(pushUniq);
    dynamic.forEach(pushUniq);

    [desktop, mobile].forEach(sel => {
      if (!sel) return;
      const prev = (sel.value || 'All');
      const frag = document.createDocumentFragment();
      const optAll = document.createElement('option');
      optAll.textContent = 'All';
      optAll.value = 'All';
      frag.appendChild(optAll);
      merged.forEach(label => {
        const o = document.createElement('option');
        o.textContent = label;
        o.value = label;
        frag.appendChild(o);
      });
      sel.innerHTML = '';
      sel.appendChild(frag);
      // Restore previous selection if available
      sel.value = Array.from(sel.options).some(o => o.value === prev) ? prev : 'All';
    });
  } catch (e) {
    console.warn('populateCategorySelects failed:', e);
  }
}

// === Auto-refresh donations list (10s) ===
let __donationPollingTimer = 0;
let __lastRenderSig = '';

function anyModalOpen(){
  try { return !!document.querySelector('.modal.show'); } catch(_) { return false; }
}

function getExpandedBatchIds(){
  const ids = [];
  try {
    document.querySelectorAll('tr.child-container').forEach(tr => {
      const bid = tr.getAttribute('data-batch-id');
      if (bid && !tr.classList.contains('d-none')) ids.push(bid);
    });
  } catch(_) {}
  return ids;
}

function restoreExpandedBatchIds(ids){
  try {
    ids.forEach(bid => {
      const child = document.querySelector(`tr.child-container[data-batch-id="${bid}"]`);
      const header = document.querySelector(`tr.group-row[data-batch-id="${bid}"] .batch-toggle`);
      if (child && child.classList.contains('d-none')) {
        child.classList.remove('d-none');
      }
      if (header) { header.textContent = 'Hide'; }
    });
  } catch(_) {}
}

function computeSig(items){
  try {
    if (!Array.isArray(items)) return '';
    // Build a compact signature of id/batch + status + fail_reason + created_at length
    const parts = items.map(it => [it.id||'', it.batch_id||'', it.status||'', (it.fail_reason||'')].join(':'));
    return parts.sort().join('|');
  } catch(_) { return ''; }
}

async function refreshDonationsOnce(){
  try {
    const items = await fetchAdminList();
    window.__adminDonationRaw = Array.isArray(items) ? items.slice() : [];
    // Keep categories up-to-date if new types appear
    try { await populateCategorySelects(window.__adminDonationRaw); } catch(_c) {}
    const filtered = applyFilters(window.__adminDonationRaw);
    const sig = computeSig(filtered);
    if (sig === __lastRenderSig) return; // no visible change
    if (anyModalOpen()) return; // avoid disrupting active modal interactions
    // Preserve expanded batches, re-render, then restore
    const expanded = getExpandedBatchIds();
    renderTable(filtered);
    restoreExpandedBatchIds(expanded);
    __lastRenderSig = sig;
  } catch(e){ /* ignore transient errors */ }
}

function startDonationAutoRefresh(){
  if (__donationPollingTimer) return;
  // Initialize signature from current render
  try {
    const base = window.__adminDonationRaw || [];
    __lastRenderSig = computeSig(applyFilters(base));
  } catch(_) { __lastRenderSig = ''; }
  __donationPollingTimer = window.setInterval(refreshDonationsOnce, 10000);
  // Also do an initial background refresh
  refreshDonationsOnce();
}

  // Helper: show Next Steps modal after acknowledge
  function showAckNextStepsModal(){
    try {
      // Respect user preference to not show again
      try {
        if (localStorage.getItem('ackNextStepsDontShow') === '1') return;
      } catch(_p) {}
      const modalEl = document.getElementById('ackNextStepsModal');
      if (!modalEl || typeof bootstrap === 'undefined' || !bootstrap.Modal) return;
      // Defensive cleanup: remove any stray backdrops and modal-open state
      try {
        document.querySelectorAll('.modal-backdrop').forEach(el => el.remove());
        document.body.classList.remove('modal-open');
        document.body.style.removeProperty('overflow');
        document.body.style.removeProperty('padding-right');
      } catch(_c) {}
      const m = bootstrap.Modal.getOrCreateInstance(modalEl);
      const openBtn = document.getElementById('ackOpenMessagesBtn');
      const closeBtn = document.getElementById('ackCloseBtn');
      const dontShow = document.getElementById('ackDontShowAgain');
      if (dontShow) { dontShow.checked = false; }
      if (openBtn){
        openBtn.onclick = function(){
          try { if (dontShow && dontShow.checked) { localStorage.setItem('ackNextStepsDontShow', '1'); } } catch(_s) {}
          const messagesEl = document.getElementById('messagesModal');
          if (messagesEl){
            const mm = bootstrap.Modal.getOrCreateInstance(messagesEl);
            mm.show();
          }
          m.hide();
        };
      }
      if (closeBtn){
        closeBtn.onclick = function(){
          try { if (dontShow && dontShow.checked) { localStorage.setItem('ackNextStepsDontShow', '1'); } } catch(_s) {}
        };
      }
      m.show();
    } catch(_e) { /* ignore */ }
  }
  // Initialize page: load items, populate filters, bind events
  async function init(){
  try {
    const items = await fetchAdminList();
      // keep a copy of raw items for client-side filtering without refetch
      window.__adminDonationRaw = Array.isArray(items) ? items.slice() : [];
      // Ensure filters start at defaults
      try {
        const ids = [
          'donorSelectDesktop','donorSelectMobile',
          'statusSelectDesktop','statusSelectMobile',
          'categorySelectDesktop','categorySelectMobile',
          'dateSelectDesktop','dateSelectMobile'
        ];
        ids.forEach(id => { const el = document.getElementById(id); if (el && el.options && el.options.length) el.selectedIndex = 0; });
      } catch(_) {}
      // Populate donors and categories from loaded items
      await populateDonorSelects(window.__adminDonationRaw);
      await populateCategorySelects(window.__adminDonationRaw);
      renderTable(applyFilters(window.__adminDonationRaw));
      bindImageViewer();
      bindGroupToggle();
      bindActions();
      bindFoodSafetySubmit();
      bindFilters();
      // Bind temporary restore toggle
      try {
        const restore = document.getElementById('restoreAckPromptBtn');
        if (restore){
          restore.addEventListener('click', function(e){
            e.preventDefault();
            try { localStorage.removeItem('ackNextStepsDontShow'); alert('Acknowledge prompt will show again next time.'); } catch(_e) {}
          });
        }
      } catch(_e) {}
      // Start background auto-refresh matching notifications polling interval (10s)
      try { startDonationAutoRefresh(); } catch(_) {}
  } catch(err){
      console.error('Failed to load donations list:', err);
      const tbody = document.querySelector('main .table tbody');
      if (tbody){
        tbody.innerHTML = `<tr><td colspan="7" class="text-center text-danger">Failed to load donations (${escapeHtml(err.message)})</td></tr>`;
      }
    }
  
  }

  // Simple cache so the modal can build inputs instantly without extra network calls
  const donationCache = {
    byBatch: new Map(),   // batch_id => array of items
    byId: new Map(),      // id => item
  };

  function groupByBatch(items){
    const groups = new Map();
    for (const r of items){
      const key = r.batch_id ? `b-${r.batch_id}` : `s-${r.id}`;
      if (!groups.has(key)) groups.set(key, { batch_id: r.batch_id || null, items: [], created_at: r.created_at });
      groups.get(key).items.push(r);
      const g = groups.get(key);
      if (!g.created_at || (r.created_at && r.created_at > g.created_at)) g.created_at = r.created_at;
    }
    return Array.from(groups.values()).sort((a,b) => (b.created_at || '').localeCompare(a.created_at || ''));
  }

  function escapeHtml(str){
    return (str||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));
  }

  function capFirst(str){
    if (!str) return '';
    try { str = String(str); } catch(_) { return ''; }
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  function fmtDateTime(s){
    if (!s) return '';
    const d = new Date(s);
    return isNaN(d) ? s : d.toLocaleString();
  }

  async function fetchAdminList(){
    // Admin endpoint: GET /api/donations/list
    const res = await fetch(`${API_BASE_URL}/donations/index.php/list?t=${Date.now()}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      cache: 'no-store'
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const json = await res.json();
    return json?.data?.items || [];
  }

  function renderTable(items){
    const tbody = document.querySelector('main .table tbody');
    if (!tbody) return;
    if (!items.length){
      tbody.innerHTML = '<tr><td colspan="7" class="text-center py-4">No donations match the current filters. <button type="button" id="resetFiltersBtn" class="btn btn-sm btn-outline-secondary ms-2">Reset filters</button></td></tr>';
      const btn = document.getElementById('resetFiltersBtn');
      if (btn){
        btn.addEventListener('click', () => {
          // Reset all selects to their first option
          const ids = [
            'donorSelectDesktop','donorSelectMobile',
            'statusSelectDesktop','statusSelectMobile',
            'categorySelectDesktop','categorySelectMobile',
            'dateSelectDesktop','dateSelectMobile'
          ];
          ids.forEach(id => {
            const el = document.getElementById(id);
            if (el && el.options && el.options.length) el.selectedIndex = 0;
          });
          const base = window.__adminDonationRaw || [];
          renderTable(applyFilters(base));
        }, { once: true });
      }
      return;
    }

    const groups = groupByBatch(items);
    // Populate cache
    donationCache.byBatch.clear();
    donationCache.byId.clear();
    groups.forEach(g => {
      if (g.batch_id && g.items.length > 1) {
        donationCache.byBatch.set(g.batch_id, g.items.slice());
        g.items.forEach(it => { if (it?.id) donationCache.byId.set(String(it.id), it); });
      } else if (g.items[0]?.id) {
        donationCache.byId.set(String(g.items[0].id), g.items[0]);
      }
    });
    const rows = [];
    groups.forEach(group => {
      const isBatch = !!group.batch_id && group.items.length > 1;
      if (isBatch){
        const count = group.items.length;
        const first = group.items[0] || {};
        const donorName = escapeHtml(first.donor_org || '—');
        const title = `Batch • ${count} item${count>1?'s':''}`;
        const created = fmtDateTime(group.created_at);
        const statusHtml = badge(first.status || '');
        const dataAttrs = `data-batch="${group.batch_id}" data-status="${first.status ?? ''}"`;
        const firstWithImg = group.items.find(it => (it.receipt_full_url || it.image_full_url)) || first;
        const imgUrl = (firstWithImg.receipt_full_url || firstWithImg.image_full_url || '');
        const isPending = (first.status || '') === 'Pending';
        const isCancelled = (first.status || '') === 'Cancelled';
        // Receipt/failure display
        const isFailed = (first.status || '') === 'Failed Safety';
        const failReason = (first.fail_reason || '').trim();
        const showReceipt = ((first.status || '') === 'Picked Up' || (first.status || '') === 'Completed');
        const cancelReason = (first.cancel_reason || '').trim();
        const imgThumb = isFailed
          ? `<div class="small text-danger text-center">${escapeHtml(failReason || 'Failed safety check')}</div>`
          : (showReceipt
              ? `<div class="d-flex justify-content-center" style="gap:5px;"><button type="button" class="btn btn-sm btn-outline-secondary view-image-btn" data-img="${imgUrl}" ${dataAttrs} title="View receipt">View</button></div>`
              : (isCancelled && cancelReason
                  ? `<div class="small text-muted text-center">${escapeHtml(cancelReason)}</div>`
                  : '<div class="d-flex justify-content-center">—</div>'));

        const actionsBtns = [];
        if ((first.status || '') === 'Pending') {
          actionsBtns.push(`<button type="button" class="btn btn-sm btn-outline-primary action-ack" ${dataAttrs} title="Acknowledge" aria-label="Acknowledge"><i class="bi bi-hand-thumbs-up"></i></button>`);
        }
        if ((first.status || '') === 'Acknowledged') {
          actionsBtns.push(`<button type="button" class="btn btn-sm btn-outline-warning action-fs" ${dataAttrs} title="Food Safety Check" aria-label="Food Safety Check"><i class="bi bi-clipboard-check"></i></button>`);
        }
        if ((first.status || '') === 'Picked Up') {
          actionsBtns.push(`<button type="button" class="btn btn-sm btn-outline-success action-receive" ${dataAttrs} title="Mark as Completed" aria-label="Mark Completed"><i class="bi bi-check2-circle"></i></button>`);
        }
        actionsBtns.push(`<button type="button" class="btn btn-sm btn-outline-danger action-delete" ${dataAttrs} title="Delete donation" aria-label="Delete"><i class="bi bi-trash"></i></button>`);
        const actions = `<div class="d-flex justify-content-center" style="gap:5px;">${actionsBtns.join('')}</div>`;

        rows.push(`
          <tr class="table-active group-row" data-batch-id="${group.batch_id}">
            <td class="py-2 align-middle">${donorName}</td>
            <td class="py-2"><div class="fw-semibold"><button class="btn btn-sm btn-outline-secondary me-2 batch-toggle" type="button" aria-label="Toggle">Show</button>${title}</div></td>
            <td class="py-2 align-middle">—</td>
            <td class="py-2 align-middle">${created}</td>
            <td class="py-2 align-middle">${statusHtml}</td>
            <td class="py-2 align-middle">${imgThumb}</td>
            <td class="py-2 align-middle">${actions}</td>
          </tr>
          <tr class="child-container d-none" data-batch-id="${group.batch_id}">
            <td colspan="7" class="p-0">
              <table class="table table-sm mb-0">
                <thead>
                  <tr class="table-light">
                    <th>Item</th>
                    <th>Type</th>
                    <th>Qty</th>
                    <th>Expiry</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  ${group.items.map(r => `
                    <tr>
                      <td>${escapeHtml(r.name || '')}</td>
                      <td>${escapeHtml(capFirst(r.type || ''))}</td>
                      <td>${r.quantity ?? ''}</td>
                      <td>${escapeHtml(r.expiry_date || '')}</td>
                      <td>${badge(r.status)}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </td>
          </tr>
        `);
      } else {
        const r = group.items[0];
        const donorName = escapeHtml(r.donor_org || '—');
        const itemName = escapeHtml(r.name || '');
        const qty = (r.quantity !== undefined && r.quantity !== null) ? String(r.quantity) : '';
        const created = fmtDateTime(group.created_at);
        const statusHtml = badge(r.status || '');
        const imgUrl = r.receipt_full_url || r.image_full_url || '';
        const isPending = (r.status || '') === 'Pending';
        const isCancelled = (r.status || '') === 'Cancelled';
        // If this donation belongs to a batch (even if it's a singleton batch), keep the batch id
        const batchForSingle = r.batch_id ? String(r.batch_id) : '';
        // Receipt/failure display
        const isFailedSingle = (r.status || '') === 'Failed Safety';
        const failReasonSingle = (r.fail_reason || '').trim();
        const showReceipt = ((r.status || '') === 'Picked Up' || (r.status || '') === 'Completed');
        const cancelReason = (r.cancel_reason || '').trim();
        const needFetchReason = isFailedSingle && !failReasonSingle;
        const imgThumb = isFailedSingle
          ? `<div class="small text-danger text-center" ${needFetchReason ? `data-need-fail-reason="1" data-id="${r.id ?? ''}"` : ''}>${escapeHtml(failReasonSingle || 'Failed safety check')}</div>`
          : (showReceipt
              ? `<div class="d-flex justify-content-center" style="gap:5px;"><button type="button" class="btn btn-sm btn-outline-secondary view-image-btn" data-img="${imgUrl}" data-id="${r.id ?? ''}" data-batch="${batchForSingle}" data-status="${r.status ?? ''}" title="View receipt">View</button></div>`
              : (isCancelled && cancelReason
                  ? `<div class="small text-muted text-center">${escapeHtml(cancelReason)}</div>`
                  : '<div class="d-flex justify-content-center">—</div>'));
        const dataAttrs = `data-id="${r.id ?? ''}" data-batch="${batchForSingle}" data-status="${r.status ?? ''}"`;
        const actionsBtns = [];
        if ((r.status || '') === 'Pending') {
          actionsBtns.push(`<button type="button" class="btn btn-sm btn-outline-primary action-ack" ${dataAttrs} title="Acknowledge" aria-label="Acknowledge"><i class="bi bi-hand-thumbs-up"></i></button>`);
        }
        if ((r.status || '') === 'Acknowledged') {
          actionsBtns.push(`<button type="button" class="btn btn-sm btn-outline-warning action-fs" ${dataAttrs} title="Food Safety Check" aria-label="Food Safety Check"><i class="bi bi-clipboard-check"></i></button>`);
        }
        if ((r.status || '') === 'Picked Up') {
          actionsBtns.push(`<button type="button" class="btn btn-sm btn-outline-success action-receive" ${dataAttrs} title="Mark as Completed" aria-label="Mark Completed"><i class="bi bi-check2-circle"></i></button>`);
        }
        actionsBtns.push(`<button type="button" class="btn btn-sm btn-outline-danger action-delete" ${dataAttrs} title="Delete donation" aria-label="Delete"><i class="bi bi-trash"></i></button>`);
        const actions = `<div class="d-flex justify-content-center" style="gap:5px;">${actionsBtns.join('')}</div>`;

        rows.push(`
          <tr>
            <td>${donorName}</td>
            <td>${itemName}</td>
            <td>${qty}</td>
            <td>${created}</td>
            <td>${statusHtml}</td>
            <td>${imgThumb}</td>
            <td>${actions}</td>
          </tr>
        `);
      }
    });

    tbody.innerHTML = rows.join('');

    // Post-process: fetch fail_reason for single items marked as Failed Safety but missing reason
    try {
      const nodes = tbody.querySelectorAll('[data-need-fail-reason="1"][data-id]');
      nodes.forEach(async (el) => {
        const id = el.getAttribute('data-id');
        if (!id) return;
        try {
          const res = await fetch(`${API_BASE_URL}/donations/index.php/${encodeURIComponent(id)}`, { credentials: 'include' });
          if (!res.ok) return;
          const j = await res.json().catch(() => ({}));
          const row = j && j.data ? j.data : null;
          const reason = (row && row.fail_reason) ? String(row.fail_reason).trim() : '';
          if (reason) {
            el.textContent = reason;
          }
        } catch (_) { /* ignore */ }
      });
    } catch(_) { /* no-op */ }
  }

  function bindImageViewer(){
    document.addEventListener('click', async function(e){
      const btn = e.target.closest('.view-image-btn');
      if (!btn) return;
      let src = btn.getAttribute('data-img');
      const img = document.getElementById('imageViewerImg');
      const infoEl = document.getElementById('imageViewerInfo');
      const modalEl = document.getElementById('imageViewerModal');
      if (modalEl && typeof bootstrap !== 'undefined' && bootstrap.Modal){
        const m = bootstrap.Modal.getOrCreateInstance(modalEl);
        // Reset image before showing
        if (img){
          img.style.transform = 'scale(1)';
          img.src = '';
          img.alt = 'Loading receipt...';
        }
        m.show();
        if (infoEl){ infoEl.textContent = 'Resolving image URL...'; }
        const batch = btn.getAttribute('data-batch') || '';
        const id = btn.getAttribute('data-id') || '';
        // Try local cache first for instant URL without network
        if ((!src || src === '') && (batch || id)){
          try {
            if (batch && donationCache.byBatch && donationCache.byBatch.has(batch)){
              const arr = donationCache.byBatch.get(batch) || [];
              const any = arr.find(it => (it && (it.receipt_full_url || it.image_full_url)));
              if (any) src = any.receipt_full_url || any.image_full_url || '';
            } else if (id && donationCache.byId && donationCache.byId.has(String(id))){
              const it = donationCache.byId.get(String(id));
              if (it) src = it.receipt_full_url || it.image_full_url || it.image_url || '';
            }
          } catch(_e) {}
        }
        // If no URL was embedded, try to resolve it from latest list data
        if ((!src || src === '') && (batch || id)){
          try {
            const items = await fetchAdminList();
            if (batch){
              const any = items.find(it => it.batch_id === batch && (it.receipt_full_url || it.image_full_url));
              if (any) src = any.receipt_full_url || any.image_full_url || '';
            } else if (id) {
              const it = items.find(it => String(it.id) === String(id));
              if (it) src = it.receipt_full_url || it.image_full_url || '';
            }
            console.debug('Image viewer (after refetch):', { batch, id, resolvedSrc: src });
          } catch(_e) { /* ignore */ }
        }
        // As a final fallback for singles, hit the detail endpoint to fetch the latest receipt URL
        if ((!src || src === '') && id){
          try {
            const res = await fetch(`${API_BASE_URL}/donations/index.php/${encodeURIComponent(id)}`, { credentials: 'include' });
            if (res.ok){
              const j = await res.json().catch(() => ({}));
              const row = j && j.data ? j.data : null;
              if (row){ src = row.receipt_full_url || row.image_full_url || ''; }
              console.debug('Image viewer (detail fallback):', { id, resolvedSrc: src });
            }
          } catch(_e) { /* ignore */ }
        }
        if (!src || src === ''){
          // No receipt available
          if (img){
            img.alt = 'No receipt uploaded yet';
            img.removeAttribute('src');
          }
          try {
            const titleEl = modalEl.querySelector('.modal-title');
            if (titleEl){ titleEl.textContent = 'Receipt Image (none available)'; }
          } catch(_) {}
          if (infoEl){ infoEl.textContent = 'No image URL found for this donation/batch.'; }
          console.warn('Image viewer: no image URL found for this donation/batch.', { batch, id });
          return;
        }
        if (img && src){
          // Load with error handling
          const tmp = new Image();
          tmp.onload = () => {
            img.src = src;
            img.alt = 'Receipt';
            try {
              const titleEl = modalEl.querySelector('.modal-title');
              if (titleEl){ titleEl.textContent = 'Receipt Image'; }
            } catch(_) {}
            if (infoEl){ infoEl.textContent = 'URL: ' + src; }
          };
          tmp.onerror = () => {
            img.alt = 'Failed to load receipt image';
            try {
              const titleEl = modalEl.querySelector('.modal-title');
              if (titleEl){ titleEl.textContent = 'Receipt Image (failed to load)'; }
            } catch(_) {}
            if (infoEl){ infoEl.textContent = 'Failed to load URL: ' + src; }
            console.warn('Failed to load receipt image.', { urlTried: src, batch, id });
          };
          tmp.src = src;
        }
      }
    });

    // Zoom controls (optional)
    const img = document.getElementById('imageViewerImg');
    const btnIn = document.getElementById('imgZoomInBtn');
    const btnOut = document.getElementById('imgZoomOutBtn');
    const btnReset = document.getElementById('imgZoomResetBtn');

    let scale = 1;
    function apply(){ if (img) img.style.transform = `scale(${scale})`; }
    if (btnIn) btnIn.addEventListener('click', () => { scale = Math.min(5, scale + 0.25); apply(); });
    if (btnOut) btnOut.addEventListener('click', () => { scale = Math.max(0.25, scale - 0.25); apply(); });
    if (btnReset) btnReset.addEventListener('click', () => { scale = 1; apply(); });
  }

  function bindGroupToggle(){
    document.addEventListener('click', function(e){
      const toggleBtn = e.target.closest('.batch-toggle');
      if (!toggleBtn) return;
      const batchId = toggleBtn.closest('.group-row').getAttribute('data-batch-id');
      const childContainer = document.querySelector(`.child-container[data-batch-id="${batchId}"]`);
      if (childContainer){
        childContainer.classList.toggle('d-none');
        toggleBtn.textContent = childContainer.classList.contains('d-none') ? 'Show' : 'Hide';
      }
    });
  }

  // Bind delete confirmation button once
  (function bindDeleteConfirm(){
    const modalEl = document.getElementById('deleteConfirmModal');
    const confirmBtn = document.getElementById('deleteConfirmBtn');
    if (!confirmBtn || !modalEl) return;
    confirmBtn.addEventListener('click', async function(){
      const id = this.getAttribute('data-id') || '';
      const batch = this.getAttribute('data-batch') || '';
      try{
        let res;
        if (batch && !id){
          res = await fetch(`${API_BASE_URL}/donations/index.php/batch/${encodeURIComponent(batch)}`, {
            method: 'DELETE',
            credentials: 'include'
          });
        } else if (id){
          res = await fetch(`${API_BASE_URL}/donations/index.php/${encodeURIComponent(id)}`, {
            method: 'DELETE',
            credentials: 'include'
          });
        } else {
          return;
        }
        if (!res.ok){
          let msg = `HTTP ${res.status}`;
          try { const j = await res.json(); if (j && j.error) msg = j.error; } catch(_e){ try { msg = await res.text(); } catch(__e){} }
          throw new Error(msg);
        }
        // Hide modal and refresh table
        try { bootstrap.Modal.getOrCreateInstance(modalEl).hide(); } catch(_) {}
        const items = await fetchAdminList();
        window.__adminDonationRaw = Array.isArray(items) ? items.slice() : [];
        renderTable(applyFilters(window.__adminDonationRaw));
      } catch(err){
        console.error('Failed to delete donation:', err);
        try {
          const body = modalEl.querySelector('.modal-body');
          if (body){ body.innerHTML = `<div class="text-danger">Failed to delete: ${escapeHtml(err.message||'Unknown error')}</div>`; }
        } catch(_) {}
      }
    });
  })();

  function bindFoodSafetySubmit(){
    async function handleSubmit(result){
      const form = document.getElementById('foodSafetyForm');
      if (!form) return;

      const btnSubmit = document.getElementById('foodSafetySubmitBtn');
      const btnFail = document.getElementById('foodSafetyFailBtn');
      const modalEl = document.getElementById('foodSafetyModal');

      const fd = new FormData(form);
      fd.set('result', result);

      // Validate required fields based on result
      const receipt = document.getElementById('fsReceipt');
      if (result === 'passed'){
        if (!receipt || !receipt.files || receipt.files.length === 0){
          alert('Receipt image is required for a Passed check.');
          return;
        }
      } else if (result === 'failed') {
        // Read failure reason from hidden input set by the Fail Reason modal
        const hiddenReasonEl = document.getElementById('fsFailReasonHidden');
        const reason = (hiddenReasonEl?.value || '').trim();
        if (!reason){
          alert('Failure reason is required when marking as Failed.');
          return;
        }
        fd.set('fail_reason', reason);
      }

      // Map UI fields to API expected names
      const storage = document.getElementById('fsStorage');
      if (storage && storage.value){ fd.set('storage', storage.value); }

      const packaging = document.getElementById('fsPackaging');
      if (packaging){ fd.set('packaging_ok', packaging.checked ? '1' : '0'); }
      const spoilage = document.getElementById('fsSpoilage');
      if (spoilage){ fd.set('spoilage_ok', spoilage.checked ? '1' : '0'); }

      // Disable buttons during submit
      if (btnSubmit) btnSubmit.disabled = true;
      if (btnFail) btnFail.disabled = true;
      try {
        const res = await fetch(`${API_BASE_URL}/food_safety_checks/create.php`, {
          method: 'POST',
          body: fd,
          credentials: 'include'
        });
        let json = null;
        try { json = await res.json(); } catch(_) { json = null; }
        if (!res.ok){
          let msg = `HTTP ${res.status}`;
          try { if (json && json.error) msg = json.error; } catch(_) {}
          throw new Error(msg);
        }
        // Success: close modal(s) and refresh list
        if (modalEl && typeof bootstrap !== 'undefined' && bootstrap.Modal){
          const m = bootstrap.Modal.getOrCreateInstance(modalEl);
          m.hide();
        }
        try {
          const failModal = document.getElementById('fsFailReasonModal');
          if (failModal && typeof bootstrap !== 'undefined' && bootstrap.Modal){
            bootstrap.Modal.getOrCreateInstance(failModal).hide();
          }
        } catch(_) {}
        // Show small success confirmation
        try {
          const fsMsgEl = document.getElementById('fsSuccessMessage');
          if (fsMsgEl){
            fsMsgEl.textContent = (result === 'passed') ? 'Items updated. Status set to Picked Up.' : 'Food safety recorded as Failed.';
          }
          const fsSuccessEl = document.getElementById('fsSuccessModal');
          if (fsSuccessEl && typeof bootstrap !== 'undefined' && bootstrap.Modal){
            bootstrap.Modal.getOrCreateInstance(fsSuccessEl).show();
          }
        } catch(_) {}
        // Optimistic UI update without full refetch
        const newStatus = (result === 'passed') ? 'Picked Up' : 'Failed Safety';
        // Read the failure reason from the hidden input we populated from the modal
        const failReasonVal = (result === 'failed') ? ((document.getElementById('fsFailReasonHidden')?.value || '').trim()) : '';
        const batchId = document.getElementById('fsBatchId')?.value || '';
        const donationId = document.getElementById('fsDonationId')?.value || '';

        // Helper to rebuild actions html by status and dataset
        function buildActionsHtml(ds){
          const parts = [];
          if (newStatus === 'Pending'){
            parts.push(`<button type="button" class="btn btn-sm btn-outline-warning action-fs" ${ds} title="Food Safety Check" aria-label="Food Safety Check"><i class="bi bi-clipboard-check"></i></button>`);
          }
          if (newStatus === 'Picked Up'){
            parts.push(`<button type="button" class="btn btn-sm btn-outline-success action-receive" ${ds} title="Mark as Completed" aria-label="Mark Completed"><i class="bi bi-check2-circle"></i></button>`);
          }
          parts.push(`<button type="button" class="btn btn-sm btn-outline-danger action-delete" ${ds} title="Delete donation" aria-label="Delete"><i class="bi bi-trash"></i></button>`);
          return `<div class="btn-group btn-group-sm" role="group">${parts.join('')}</div>`;
        }

        if (batchId){
          // Update cache
          const arr = donationCache.byBatch.get(batchId) || [];
          arr.forEach(it => { it.status = newStatus; if (failReasonVal) it.fail_reason = failReasonVal; });
          donationCache.byBatch.set(batchId, arr);
          // Update main group row
          const row = document.querySelector(`tr.group-row[data-batch-id="${batchId}"]`);
          if (row){
            const statusCell = row.querySelector('td:nth-child(5)');
            if (statusCell) statusCell.innerHTML = badge(newStatus);
            // Update receipt/failure display cell for batch group row
            const receiptCell = row.querySelector('td:nth-child(6)');
            if (receiptCell && result === 'failed'){
              receiptCell.innerHTML = `<div class="small text-danger text-center">${escapeHtml(failReasonVal || 'Failed safety check')}</div>`;
            }
            const actionsCell = row.querySelector('td:nth-child(7)');
            const ds = `data-batch="${batchId}" data-status="${newStatus}"`;
            if (actionsCell) actionsCell.innerHTML = buildActionsHtml(ds);
          }
          // Update child rows if visible
          const child = document.querySelector(`tr.child-container[data-batch-id="${batchId}"]`);
          if (child){
            child.querySelectorAll('tbody tr').forEach(tr => {
              const statusTd = tr.querySelector('td:nth-child(5)');
              if (statusTd) statusTd.innerHTML = badge(newStatus);
              const reasonTd = tr.querySelector('td:nth-child(6)');
              if (reasonTd && result === 'failed') reasonTd.textContent = failReasonVal || 'Failed safety check';
            });
          }
        } else if (donationId) {
          // Update cache for single item
          const it = donationCache.byId.get(String(donationId));
          if (it){ it.status = newStatus; if (failReasonVal) it.fail_reason = failReasonVal; donationCache.byId.set(String(donationId), it); }
          // Find the row via any action button with matching data-id
          const btn = document.querySelector(`.action-delete[data-id="${donationId}"]`) || document.querySelector(`.action-fs[data-id="${donationId}"]`) || document.querySelector(`.action-receive[data-id="${donationId}"]`);
          if (btn){
            const tr = btn.closest('tr');
            if (tr){
              const statusCell = tr.querySelector('td:nth-child(5)');
              if (statusCell) statusCell.innerHTML = badge(newStatus);
              // Update receipt/failure display cell for single item row
              const receiptCell = tr.querySelector('td:nth-child(6)');
              if (receiptCell && result === 'failed'){
                receiptCell.innerHTML = `<div class="small text-danger text-center">${escapeHtml(failReasonVal || 'Failed safety check')}</div>`;
              }
              const actionsCell = tr.querySelector('td:nth-child(7)');
              const ds = `data-id="${donationId}" data-batch="" data-status="${newStatus}"`;
              if (actionsCell) actionsCell.innerHTML = buildActionsHtml(ds);
            }
          } else {
            // Fallback to refetch if row not found
            const items = await fetchAdminList();
            renderTable(items);
          }
        } else {
          // Fallback if neither id nor batch is present
        }

        // Always refetch after success to pick up latest receipt_image URLs (from food_safety_checks)
        try {
          const items = await fetchAdminList();
          // keep raw copy for filters
          window.__adminDonationRaw = Array.isArray(items) ? items.slice() : [];
          renderTable(applyFilters(window.__adminDonationRaw));
        } catch(_e) { /* ignore transient errors; UI already updated */ }
      } catch (err){
        console.error('Food safety submit failed:', err);
        alert('Failed to submit food safety check: ' + err.message);
      } finally {
        if (btnSubmit) btnSubmit.disabled = false;
        if (btnFail) btnFail.disabled = false;
        // Clear hidden fail reason after any attempt
        try { const hiddenReasonEl = document.getElementById('fsFailReasonHidden'); if (hiddenReasonEl) hiddenReasonEl.value = ''; } catch(_) {}
      }
    }

    const btnSubmit = document.getElementById('foodSafetySubmitBtn');
    if (btnSubmit){
      btnSubmit.addEventListener('click', () => handleSubmit('passed'));
    }
    const btnFail = document.getElementById('foodSafetyFailBtn');
    if (btnFail){
      btnFail.addEventListener('click', () => {
        const failModal = document.getElementById('fsFailReasonModal');
        const failInput = document.getElementById('fsFailReasonInput');
        const confirmBtn = document.getElementById('fsFailReasonConfirmBtn');
        const hidden = document.getElementById('fsFailReasonHidden');
        const fsModalEl = document.getElementById('foodSafetyModal');
        if (!failModal || !confirmBtn) { return; }
        try {
          // Hide the Food Safety modal so the Fail Reason modal is on top
          let fsModal = null;
          if (fsModalEl) { try { fsModal = bootstrap.Modal.getOrCreateInstance(fsModalEl); fsModal.hide(); } catch(_) {} }
          const m = bootstrap.Modal.getOrCreateInstance(failModal);
          if (failInput) { failInput.value = ''; setTimeout(()=>failInput.focus(), 200); }
          // Remove previous handler to avoid stacking
          confirmBtn.replaceWith(confirmBtn.cloneNode(true));
          const newConfirm = document.getElementById('fsFailReasonConfirmBtn');
          // Also wire cancel to restore FS modal visibility
          const cancelBtn = failModal.querySelector('[data-bs-dismiss="modal"]');
          if (cancelBtn){
            cancelBtn.addEventListener('click', () => {
              try { if (fsModal) fsModal.show(); } catch(_) {}
            }, { once: true });
          }
          newConfirm.addEventListener('click', async function(){
            const reason = (failInput?.value || '').trim();
            if (!reason){ alert('Failure reason is required.'); return; }
            if (hidden) hidden.value = reason;
            try { m.hide(); } catch(_) {}
            // Keep FS modal hidden while submitting; it will refresh after
            await handleSubmit('failed');
          });
          m.show();
        } catch(_) { /* no bootstrap */ }
      });
    }
  }

  function bindActions(){
    document.addEventListener('click', async function(e){
      const ackBtn = e.target.closest('.action-ack');
      if (ackBtn){
        const id = ackBtn.getAttribute('data-id') || '';
        const batch = ackBtn.getAttribute('data-batch') || '';
        try{
          if (batch && !id){
            const res = await fetch(`${API_BASE_URL}/donations/index.php/batch/${encodeURIComponent(batch)}/status`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'include',
              body: JSON.stringify({ status: 'Acknowledged' })
            });
            if (!res.ok){
              let msg = `HTTP ${res.status}`;
              try { const j = await res.json(); if (j && j.error) msg = j.error; } catch(_e){ try { msg = await res.text(); } catch(__e){} }
              throw new Error(msg);
            }
            // Update cache
            const arr = donationCache.byBatch.get(batch) || [];
            arr.forEach(it => { it.status = 'Acknowledged'; });
            donationCache.byBatch.set(batch, arr);
            // Update main group row
            const row = document.querySelector(`tr.group-row[data-batch-id="${batch}"]`);
            if (row){
              const statusCell = row.querySelector('td:nth-child(5)');
              if (statusCell) statusCell.innerHTML = badge('Acknowledged');
              const actionsCell = row.querySelector('td:nth-child(7)');
              const ds = `data-batch="${batch}" data-status="Acknowledged"`;
              const parts = [];
              parts.push(`<button type="button" class="btn btn-sm btn-outline-warning action-fs" ${ds} title="Food Safety Check" aria-label="Food Safety Check"><i class="bi bi-clipboard-check"></i></button>`);
              parts.push(`<button type="button" class="btn btn-sm btn-outline-danger action-delete" ${ds} title="Delete donation" aria-label="Delete"><i class="bi bi-trash"></i></button>`);
              if (actionsCell) actionsCell.innerHTML = `<div class="d-flex justify-content-center" style="gap:5px;">${parts.join('')}</div>`;
            }
            // Show next steps modal
            showAckNextStepsModal();
          } else if (id){
            const res = await fetch(`${API_BASE_URL}/donations/index.php/${encodeURIComponent(id)}/status`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'include',
              body: JSON.stringify({ status: 'Acknowledged' })
            });
            if (!res.ok){
              let msg = `HTTP ${res.status}`;
              try { const j = await res.json(); if (j && j.error) msg = j.error; } catch(_e){ try { msg = await res.text(); } catch(__e){} }
              throw new Error(msg);
            }
            // Update cache
            const it = donationCache.byId.get(String(id));
            if (it){ it.status = 'Acknowledged'; donationCache.byId.set(String(id), it); }
            // Update row
            const btn = document.querySelector(`.action-ack[data-id="${id}"]`) || document.querySelector(`.action-delete[data-id="${id}"]`);
            const tr = btn ? btn.closest('tr') : null;
            if (tr){
              const statusCell = tr.querySelector('td:nth-child(5)');
              if (statusCell) statusCell.innerHTML = badge('Acknowledged');
              const actionsCell = tr.querySelector('td:nth-child(7)');
              const ds = `data-id="${id}" data-batch="" data-status="Acknowledged"`;
              const parts = [];
              parts.push(`<button type="button" class="btn btn-sm btn-outline-warning action-fs" ${ds} title="Food Safety Check" aria-label="Food Safety Check"><i class="bi bi-clipboard-check"></i></button>`);
              parts.push(`<button type="button" class="btn btn-sm btn-outline-danger action-delete" ${ds} title="Delete donation" aria-label="Delete"><i class="bi bi-trash"></i></button>`);
              if (actionsCell) actionsCell.innerHTML = `<div class="d-flex justify-content-center" style="gap:5px;">${parts.join('')}</div>`;
            }
            // Show next steps modal
            showAckNextStepsModal();
          }
        } catch(err){
          console.error('Acknowledge failed:', err);
          alert('Failed to acknowledge donation: ' + (err?.message||'Unknown error'));
        }
        return;
      }
      const delBtn = e.target.closest('.action-delete');
      const fsBtn = e.target.closest('.action-fs');
      const recvBtn = e.target.closest('.action-receive');

      // Delete (supports single item or entire batch)
      if (delBtn){
        const id = delBtn.getAttribute('data-id') || '';
        const batch = delBtn.getAttribute('data-batch') || '';
        const isBatch = !!batch && !id;
        // Open Bootstrap confirm modal
        const modalEl = document.getElementById('deleteConfirmModal');
        const confirmBtn = document.getElementById('deleteConfirmBtn');
        const confirmText = document.getElementById('deleteConfirmText');
        if (modalEl && confirmBtn){
          confirmBtn.setAttribute('data-id', id);
          confirmBtn.setAttribute('data-batch', batch);
          if (confirmText){
            confirmText.textContent = isBatch
              ? 'Are you sure you want to delete this entire batch? This action cannot be undone.'
              : 'Are you sure you want to delete this donation? This action cannot be undone.';
          }
          try {
            const m = bootstrap.Modal.getOrCreateInstance(modalEl);
            m.show();
          } catch(_) {}
        }
        return;
      }

      // Food Safety Check (open modal, prefill hidden fields)
      if (fsBtn){
        const id = fsBtn.getAttribute('data-id') || '';
        const batch = fsBtn.getAttribute('data-batch') || '';
        const elDon = document.getElementById('fsDonationId');
        const elBatch = document.getElementById('fsBatchId');
        if (elDon) elDon.value = id;
        if (elBatch) elBatch.value = batch;

        // Build per-item expiry inputs: one photo per item, mapped by donation_id
        const container = document.getElementById('fsBatchItems');
        if (container){
          let items = [];
          if (batch && donationCache.byBatch && donationCache.byBatch.has(batch)){
            items = donationCache.byBatch.get(batch) || [];
          } else if (id && donationCache.byId && donationCache.byId.has(String(id))){
            items = [donationCache.byId.get(String(id))];
          }
          if (!Array.isArray(items) || items.length === 0){
            // Fallback placeholder if cache missing
            items = id ? [{ id, name: '', quantity: '' }] : [];
          }
          const rows = items.map((it, idx) => {
            const label = `${idx+1}. ${escapeHtml(it?.name || '')}${it?.quantity ? ` (x${it.quantity})` : ''}`;
            const did = String(it?.id || '');
            return `
              <div class="border rounded p-2 d-flex flex-column gap-1">
                <div class="fw-semibold">${label || 'Item' + (did ? ' #' + did : '')}</div>
                <input type="hidden" name="item_ids[]" value="${did}">
                <label class="form-label mb-1">Expiry date photo (one per item)</label>
                <input type="file" class="form-control" name="expiry_item_photo[${did}]" accept="image/*" capture="environment">
              </div>
            `;
          });
          container.innerHTML = rows.join('');
        }

        const modalEl = document.getElementById('foodSafetyModal');
        if (modalEl && typeof bootstrap !== 'undefined' && bootstrap.Modal){
          const m = bootstrap.Modal.getOrCreateInstance(modalEl);
          m.show();
        }
        return;
      }

      // Receive (mark as Completed): open confirmation first
      if (recvBtn){
        const id = recvBtn.getAttribute('data-id') || '';
        const batch = recvBtn.getAttribute('data-batch') || '';
        const modalEl = document.getElementById('receiveConfirmModal');
        const confirmBtn = document.getElementById('receiveConfirmBtn');
        if (modalEl && confirmBtn && typeof bootstrap !== 'undefined' && bootstrap.Modal){
          confirmBtn.setAttribute('data-id', id);
          confirmBtn.setAttribute('data-batch', batch);
          const m = bootstrap.Modal.getOrCreateInstance(modalEl);
          m.show();
        } else {
          // Fallback: proceed directly if modal not present
          await completeDonation({ id, batch });
        }
        return;
      }
    });
  }

  // Helper to actually complete donation after confirm
  async function completeDonation({ id, batch }){
    const newStatus = 'Completed';
    try{
      if (batch){
        const res = await fetch(`${API_BASE_URL}/donations/index.php/batch/${encodeURIComponent(batch)}/status`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
          body: JSON.stringify({ status: newStatus })
        });
        if (!res.ok){
          let msg = `HTTP ${res.status}`;
          try { const j = await res.json(); if (j && j.error) msg = j.error; } catch(_e){ try { msg = await res.text(); } catch(__e){} }
          throw new Error(msg);
        }
      } else if (id){
        const res = await fetch(`${API_BASE_URL}/donations/index.php/${encodeURIComponent(id)}/status`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
          body: JSON.stringify({ status: newStatus })
        });
        if (!res.ok){
          let msg = `HTTP ${res.status}`;
          try { const j = await res.json(); if (j && j.error) msg = j.error; } catch(_e){ try { msg = await res.text(); } catch(__e){} }
          throw new Error(msg);
        }
      }
      // Update UI
      function buildActionsHtml(ds){
        const parts = [];
        parts.push(`<button type="button" class="btn btn-sm btn-outline-danger action-delete" ${ds} title="Delete donation" aria-label="Delete"><i class="bi bi-trash"></i></button>`);
        return `<div class="btn-group btn-group-sm" role="group">${parts.join('')}</div>`;
      }
      if (batch){
        const arr = donationCache.byBatch.get(batch) || [];
        arr.forEach(it => { it.status = newStatus; });
        donationCache.byBatch.set(batch, arr);
        const row = document.querySelector(`tr.group-row[data-batch-id="${batch}"]`);
        if (row){
          const statusCell = row.querySelector('td:nth-child(5)');
          if (statusCell) statusCell.innerHTML = badge(newStatus);
          const actionsCell = row.querySelector('td:nth-child(7)');
          const ds = `data-batch="${batch}" data-status="${newStatus}"`;
          if (actionsCell) actionsCell.innerHTML = buildActionsHtml(ds);
        }
        const child = document.querySelector(`tr.child-container[data-batch-id="${batch}"]`);
        if (child){
          child.querySelectorAll('tbody tr').forEach(tr => {
            const statusTd = tr.querySelector('td:nth-child(5)');
            if (statusTd) statusTd.innerHTML = badge(newStatus);
          });
        }
      } else if (id){
        const it = donationCache.byId.get(String(id));
        if (it){ it.status = newStatus; donationCache.byId.set(String(id), it); }
        const btn = document.querySelector(`.action-delete[data-id="${id}"]`) || document.querySelector(`.action-fs[data-id="${id}"]`) || document.querySelector(`.action-receive[data-id="${id}"]`);
        if (btn){
          const tr = btn.closest('tr');
          if (tr){
            const statusCell = tr.querySelector('td:nth-child(5)');
            if (statusCell) statusCell.innerHTML = badge(newStatus);
            const actionsCell = tr.querySelector('td:nth-child(7)');
            const ds = `data-id="${id}" data-batch="" data-status="${newStatus}"`;
            if (actionsCell) actionsCell.innerHTML = buildActionsHtml(ds);
          }
        }
      }
      // Optionally refetch to stay in sync
      try {
        const items = await fetchAdminList();
        window.__adminDonationRaw = Array.isArray(items) ? items.slice() : [];
        renderTable(applyFilters(window.__adminDonationRaw));
      } catch(_) {}
    } catch(err){
      console.error('Failed to mark as completed:', err);
      alert('Failed to update status: ' + (err?.message || 'Unknown error'));
    }
  }

  // Bind confirm button for completion
  (function bindReceiveConfirm(){
    const modalEl = document.getElementById('receiveConfirmModal');
    const confirmBtn = document.getElementById('receiveConfirmBtn');
    if (!modalEl || !confirmBtn) return;
    confirmBtn.addEventListener('click', async function(){
      const id = this.getAttribute('data-id') || '';
      const batch = this.getAttribute('data-batch') || '';
      const origText = this.textContent;
      this.disabled = true; this.textContent = 'Completing...';
      try {
        await completeDonation({ id, batch });
        try { bootstrap.Modal.getOrCreateInstance(modalEl).hide(); } catch(_) {}
      } finally {
        this.disabled = false; this.textContent = origText;
      }
    });
  })();

  function getEl(id){ return document.getElementById(id); }

  function readFilters(){
    // Prefer desktop controls when visible; otherwise mobile. If both exist, any change will trigger re-render.
    const donor = (getEl('donorSelectDesktop')?.value || getEl('donorSelectMobile')?.value || '').trim();
    const status = (getEl('statusSelectDesktop')?.value || getEl('statusSelectMobile')?.value || '').trim();
    const category = (getEl('categorySelectDesktop')?.value || getEl('categorySelectMobile')?.value || '').trim();
    const date = (getEl('dateSelectDesktop')?.value || getEl('dateSelectMobile')?.value || '').trim();
    return { donor, status, category, date };
  }

  function applyFilters(items){
    const f = readFilters();
    let out = Array.isArray(items) ? items.slice() : [];

    // Donor filter: match donor_org text
    if (f.donor && f.donor.toLowerCase() !== 'all'){
      const q = f.donor.toLowerCase();
      out = out.filter(r => (r.donor_org || r.organization_name || '').toLowerCase().includes(q));
    }
    // Status filter
    if (f.status && f.status.toLowerCase() !== 'all'){
      out = out.filter(r => (r.status || '').toLowerCase() === f.status.toLowerCase());
    }
    // Category filter maps to type (skip when 'All' or 'Other')
    if (f.category && !['all','other'].includes(f.category.toLowerCase())){
      out = out.filter(r => (r.type || '').toLowerCase() === f.category.toLowerCase());
    }
    // Date filter: Today, This Week, This Month, Custom, All
    if (f.date){
      const now = new Date();
      const todayStr = now.toISOString().slice(0,10);
      if (f.date === 'Today'){
        out = out.filter(r => {
          const d = r.created_at ? new Date(r.created_at) : null;
          if (!d || isNaN(d)) return false;
          return d.toISOString().slice(0,10) === todayStr;
        });
      } else if (f.date === 'This Week'){
        const sevenDaysAgo = new Date(now);
        sevenDaysAgo.setDate(now.getDate() - 6);
        sevenDaysAgo.setHours(0,0,0,0);
        out = out.filter(r => {
          const d = r.created_at ? new Date(r.created_at) : null;
          if (!d || isNaN(d)) return false;
          return d >= sevenDaysAgo && d <= now;
        });
      } else if (f.date === 'This Month') {
        const start = new Date(now.getFullYear(), now.getMonth(), 1);
        const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
        out = out.filter(r => {
          const d = r.created_at ? new Date(r.created_at) : null;
          if (!d || isNaN(d)) return false;
          return d >= start && d <= end;
        });
      } else if (f.date === 'All') {
        // no-op
      } else if (f.date === 'Custom'){
        // No custom picker in UI yet; treat as no filter
      }
    }
    return out;
  }

  // Populate donor dropdowns from current items; then try to augment with backend users list
  async function populateDonorSelects(currentItems){
    const desktop = getEl('donorSelectDesktop');
    const mobile = getEl('donorSelectMobile');

    function buildFromLabels(labels){
      const uniqueLabels = Array.from(new Set(labels.filter(Boolean))).sort((a,b)=>a.localeCompare(b));
      [desktop, mobile].forEach(sel => {
        if (!sel) return;
        const prev = sel.value || 'All';
        // Rebuild options safely
        const frag = document.createDocumentFragment();
        const optAll = document.createElement('option');
        optAll.textContent = 'All';
        optAll.value = 'All';
        frag.appendChild(optAll);
        uniqueLabels.forEach(label => {
          const o = document.createElement('option');
          o.textContent = label;
          o.value = label;
          frag.appendChild(o);
        });
        sel.innerHTML = '';
        sel.appendChild(frag);
        // Restore previous selection if present, otherwise default to 'All'
        sel.value = Array.from(sel.options).some(o => o.value === prev) ? prev : 'All';
      });
    }

    try {
      // 1) Immediate build from the currently loaded donation items
      const labelsFromItems = Array.isArray(currentItems) ? currentItems.map(r => (r.donor_org || r.organization_name || '').trim()).filter(Boolean) : [];
      buildFromLabels(labelsFromItems);

      // 2) Try to augment with backend donors list (optional)
      const url = `${API_BASE_URL}/user_api.php?action=list&role=donor&status=approved&t=${Date.now()}`;
      const res = await fetch(url, {
        method: 'GET',
        credentials: 'include',
        headers: { 'Accept': 'application/json' },
        cache: 'no-store'
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const json = await res.json();
      const users = json?.data?.items || [];
      const labelsFromUsers = users.map(u => ((u.organization_name && u.organization_name.trim()) ? u.organization_name.trim() : (u.name || '').trim())).filter(Boolean);
      const merged = Array.from(new Set([...(labelsFromItems||[]), ...labelsFromUsers]));
      buildFromLabels(merged);
    } catch (err) {
      // Keep whatever we built from items; do not break the UI
      console.warn('Donor users list fetch failed; using donor names from items only:', err);
    }
  }

  function bindFilters(){
    const ids = [
      'donorSelectDesktop','donorSelectMobile',
      'statusSelectDesktop','statusSelectMobile',
      'categorySelectDesktop','categorySelectMobile',
      'dateSelectDesktop','dateSelectMobile'
    ];
    ids.forEach(id => {
      const el = getEl(id);
      if (el){
        el.addEventListener('change', () => {
          const base = window.__adminDonationRaw || [];
          const filtered = applyFilters(base);
          renderTable(filtered);
        });
      }
    });
  }

  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
