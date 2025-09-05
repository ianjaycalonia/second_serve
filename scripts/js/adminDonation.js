(function(){
  'use strict';

  // Allow override via window.API_BASE_URL; default to encoded project path
  const API_BASE_URL = (typeof window.API_BASE_URL === 'string' && window.API_BASE_URL)
    ? window.API_BASE_URL
    : '/Capstone%20Project/php/api';

  function badge(status){
    switch(status){
      case 'Pending': return '<span class="badge bg-warning text-dark">Pending</span>';
      case 'Allocated': return '<span class="badge bg-info text-dark">Allocated</span>';
      case 'Picked Up': return '<span class="badge bg-primary">Picked Up</span>';
      case 'Arrived at warehouse': return '<span class="badge bg-secondary">Arrived</span>';
      case 'Failed Safety': return '<span class="badge bg-danger">Failed Safety</span>';
      case 'Completed': return '<span class="badge bg-success">Completed</span>';
      case 'Cancelled': return '<span class="badge bg-dark">Cancelled</span>';
      default: return `<span class="badge bg-light text-dark">${status||'Unknown'}</span>`;
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
        const firstWithImg = group.items.find(it => (it.receipt_full_url || it.image_full_url || it.image_url)) || first;
        const imgUrl = (firstWithImg.receipt_full_url || firstWithImg.image_full_url || firstWithImg.image_url || '');
        const isPending = (first.status || '') === 'Pending';
        const imgThumb = isPending
          ? '<div class="d-flex justify-content-center">—</div>'
          : `<div class="d-flex justify-content-center" style="gap:5px;"><button type="button" class="btn btn-sm btn-outline-secondary view-image-btn" data-img="${imgUrl}" ${dataAttrs} title="View receipt">View</button></div>`;

        const actionsBtns = [];
        if ((first.status || '') === 'Pending') {
          actionsBtns.push(`<button type="button" class="btn btn-sm btn-outline-warning action-fs" ${dataAttrs} title="Food Safety Check" aria-label="Food Safety Check"><i class="bi bi-clipboard-check"></i></button>`);
        }
        if ((first.status || '') === 'Picked Up') {
          actionsBtns.push(`<button type="button" class="btn btn-sm btn-outline-success action-receive" ${dataAttrs} title="Mark as Arrived at warehouse" aria-label="Receive"><i class="bi bi-check2-circle"></i></button>`);
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
                    <th>Reason</th>
                  </tr>
                </thead>
                <tbody>
                  ${group.items.map(r => `
                    <tr>
                      <td>${escapeHtml(r.name || '')}</td>
                      <td>${escapeHtml(r.type || '')}</td>
                      <td>${r.quantity ?? ''}</td>
                      <td>${escapeHtml(r.expiry_date || '')}</td>
                      <td>${badge(r.status)}</td>
                      <td>${r.fail_reason ? escapeHtml(r.fail_reason) : ((r.status||'') === 'Failed Safety' ? 'Failed safety check' : '—')}</td>
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
        const imgUrl = r.receipt_full_url || r.image_full_url || r.image_url || '';
        const isPending = (r.status || '') === 'Pending';
        const imgThumb = isPending
          ? '<div class="d-flex justify-content-center">—</div>'
          : `<div class="d-flex justify-content-center" style="gap:5px;"><button type="button" class="btn btn-sm btn-outline-secondary view-image-btn" data-img="${imgUrl}" data-id="${r.id ?? ''}" data-batch="" data-status="${r.status ?? ''}" title="View receipt">View</button></div>`;
        const dataAttrs = `data-id="${r.id ?? ''}" data-batch="" data-status="${r.status ?? ''}"`;
        const actionsBtns = [];
        if ((r.status || '') === 'Pending') {
          actionsBtns.push(`<button type="button" class="btn btn-sm btn-outline-warning action-fs" ${dataAttrs} title="Food Safety Check" aria-label="Food Safety Check"><i class="bi bi-clipboard-check"></i></button>`);
        }
        if ((r.status || '') === 'Picked Up') {
          actionsBtns.push(`<button type="button" class="btn btn-sm btn-outline-success action-receive" ${dataAttrs} title="Mark as Arrived at warehouse" aria-label="Receive"><i class="bi bi-check2-circle"></i></button>`);
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
  }

  function bindImageViewer(){
    document.addEventListener('click', async function(e){
      const btn = e.target.closest('.view-image-btn');
      if (!btn) return;
      let src = btn.getAttribute('data-img');
      const img = document.getElementById('imageViewerImg');
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
        // If no URL was embedded, try to resolve it from latest list data
        if ((!src || src === '') && (btn.getAttribute('data-batch') || btn.getAttribute('data-id'))){
          try {
            const items = await fetchAdminList();
            const batch = btn.getAttribute('data-batch') || '';
            const id = btn.getAttribute('data-id') || '';
            if (batch){
              const any = items.find(it => it.batch_id === batch && (it.image_full_url || it.image_url));
              if (any) src = any.image_full_url || any.image_url || '';
            } else if (id) {
              const it = items.find(it => String(it.id) === String(id));
              if (it) src = it.image_full_url || it.image_url || '';
            }
          } catch(_e) { /* ignore */ }
        }
        if (!src || src === ''){
          // No receipt available
          img && (img.alt = 'No receipt uploaded yet');
          alert('No receipt uploaded yet for this donation.');
          return;
        }
        if (img && src){
          // Load with error handling
          const tmp = new Image();
          tmp.onload = () => { img.src = src; img.alt = 'Receipt'; };
          tmp.onerror = () => { img.alt = 'Failed to load receipt image'; alert('Failed to load receipt image. URL: ' + src); };
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

      // Validate required fields
      const receipt = document.getElementById('fsReceipt');
      if (!receipt || !receipt.files || receipt.files.length === 0){
        alert('Receipt image is required.');
        return;
      }
      if (result === 'failed'){
        const failReason = document.getElementById('fsFailReason');
        if (!failReason || !failReason.value.trim()){
          alert('Please provide a failure reason.');
          return;
        }
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
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json.success){
          const msg = json?.error || `HTTP ${res.status}`;
          throw new Error(msg);
        }
        // Success: close modal and refresh list
        if (modalEl && typeof bootstrap !== 'undefined' && bootstrap.Modal){
          const m = bootstrap.Modal.getOrCreateInstance(modalEl);
          m.hide();
        }
        // Optimistic UI update without full refetch
        const newStatus = (result === 'passed') ? 'Picked Up' : 'Failed Safety';
        const failReasonVal = (result === 'failed') ? (document.getElementById('fsFailReason')?.value || '') : '';
        const batchId = document.getElementById('fsBatchId')?.value || '';
        const donationId = document.getElementById('fsDonationId')?.value || '';

        // Helper to rebuild actions html by status and dataset
        function buildActionsHtml(ds){
          const parts = [];
          if (newStatus === 'Pending'){
            parts.push(`<button type="button" class="btn btn-sm btn-outline-warning action-fs" ${ds} title="Food Safety Check" aria-label="Food Safety Check"><i class="bi bi-clipboard-check"></i></button>`);
          }
          if (newStatus === 'Picked Up'){
            parts.push(`<button type="button" class="btn btn-sm btn-outline-success action-receive" ${ds} title="Mark as Arrived at warehouse" aria-label="Receive"><i class="bi bi-check2-circle"></i></button>`);
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
      }
    }

    const btnSubmit = document.getElementById('foodSafetySubmitBtn');
    if (btnSubmit){
      btnSubmit.addEventListener('click', () => handleSubmit('passed'));
    }
    const btnFail = document.getElementById('foodSafetyFailBtn');
    if (btnFail){
      btnFail.addEventListener('click', () => handleSubmit('failed'));
    }
  }

  function bindActions(){
    document.addEventListener('click', async function(e){
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

        // Build per-item expiry photo inputs from cache immediately
        const container = document.getElementById('fsBatchItems');
        if (container){
          let items = [];
          if (batch && donationCache.byBatch.has(batch)) {
            items = donationCache.byBatch.get(batch) || [];
          } else if (id && donationCache.byId.has(String(id))) {
            items = [donationCache.byId.get(String(id))];
          } else if (batch) {
            // If cache missing for some reason, render a single generic input so the user can still proceed
            items = [{ id: '', name: '', quantity: '' }];
          } else if (id) {
            items = [{ id: id }];
          }

          if (!items.length) {
            items = [{ id: '', name: '', quantity: '' }];
          }

          const rows = items.map((it, idx) => {
            const label = `${idx+1}. ${it?.name ? (it.name + (it.quantity ? ` (x${it.quantity})` : '')) : 'Item' + (it?.id ? ' #' + it.id : '')}`;
            return `
              <div class="border rounded p-2 d-flex flex-column gap-1">
                <div class="fw-semibold">${escapeHtml(label)}</div>
                <input type="hidden" name="item_ids[]" value="${it?.id ?? ''}">
                <label class="form-label mb-1">Expiry date photo</label>
                <input type="file" class="form-control" name="item_photos[]" accept="image/*" capture="environment">
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

      // Receive (mark as Arrived at warehouse)
      if (recvBtn){
        const id = recvBtn.getAttribute('data-id') || '';
        const batch = recvBtn.getAttribute('data-batch') || '';
        try{
          if (batch){
            const res = await fetch(`${API_BASE_URL}/donations/index.php/batch/${encodeURIComponent(batch)}/status`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'include',
              body: JSON.stringify({ status: 'Arrived at warehouse' })
            });
            if (!res.ok) {
              let msg = `HTTP ${res.status}`;
              try { const j = await res.json(); if (j && j.error) msg = j.error; } catch(_e){ try { msg = await res.text(); } catch(__e){} }
              throw new Error(msg || `HTTP ${res.status}`);
            }
          } else if (id){
            const res = await fetch(`${API_BASE_URL}/donations/index.php/${encodeURIComponent(id)}/status`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'include',
              body: JSON.stringify({ status: 'Arrived at warehouse' })
            });
            if (!res.ok) {
              let msg = `HTTP ${res.status}`;
              try { const j = await res.json(); if (j && j.error) msg = j.error; } catch(_e){ try { msg = await res.text(); } catch(__e){} }
              throw new Error(msg || `HTTP ${res.status}`);
            }
          }
          // Optimistic UI update without full refetch
          const newStatus = 'Arrived at warehouse';
          function buildActionsHtml(ds){
            const parts = [];
            // No FS or Receive for Arrived; only Delete remains
            parts.push(`<button type=\"button\" class=\"btn btn-sm btn-outline-danger action-delete\" ${ds} title=\"Delete donation\" aria-label=\"Delete\"><i class=\"bi bi-trash\"></i></button>`);
            return `<div class=\"btn-group btn-group-sm\" role=\"group\">${parts.join('')}</div>`;
          }
          if (batch){
            // Update cache
            const arr = donationCache.byBatch.get(batch) || [];
            arr.forEach(it => { it.status = newStatus; });
            donationCache.byBatch.set(batch, arr);
            // Update main group row
            const row = document.querySelector(`tr.group-row[data-batch-id=\"${batch}\"]`);
            if (row){
              const statusCell = row.querySelector('td:nth-child(5)');
              if (statusCell) statusCell.innerHTML = badge(newStatus);
              const actionsCell = row.querySelector('td:nth-child(7)');
              const ds = `data-batch=\"${batch}\" data-status=\"${newStatus}\"`;
              if (actionsCell) actionsCell.innerHTML = buildActionsHtml(ds);
            }
            // Update child rows if visible
            const child = document.querySelector(`tr.child-container[data-batch-id=\"${batch}\"]`);
            if (child){
              child.querySelectorAll('tbody tr').forEach(tr => {
                const statusTd = tr.querySelector('td:nth-child(5)');
                if (statusTd) statusTd.innerHTML = badge(newStatus);
              });
            }
          } else if (id){
            // Update cache single item
            const it = donationCache.byId.get(String(id));
            if (it){ it.status = newStatus; donationCache.byId.set(String(id), it); }
            // Update row
            const btn = document.querySelector(`.action-delete[data-id=\"${id}\"]`) || document.querySelector(`.action-fs[data-id=\"${id}\"]`) || document.querySelector(`.action-receive[data-id=\"${id}\"]`);
            if (btn){
              const tr = btn.closest('tr');
              if (tr){
                const statusCell = tr.querySelector('td:nth-child(5)');
                if (statusCell) statusCell.innerHTML = badge(newStatus);
                const actionsCell = tr.querySelector('td:nth-child(7)');
                const ds = `data-id=\"${id}\" data-batch=\"\" data-status=\"${newStatus}\"`;
                if (actionsCell) actionsCell.innerHTML = buildActionsHtml(ds);
              }
            }
          }
        } catch(err){
          console.error('Failed to mark as received:', err);
          alert('Failed to update status: ' + (err?.message || 'Unknown error'));
        }
        return;
      }
    });
  }

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
      renderTable(applyFilters(window.__adminDonationRaw));
      bindImageViewer();
      bindGroupToggle();
      bindActions();
      bindFoodSafetySubmit();
      bindFilters();
    } catch(err){
      console.error('Failed to load donations list:', err);
      const tbody = document.querySelector('main .table tbody');
      if (tbody){
        tbody.innerHTML = `<tr><td colspan="7" class="text-center text-danger">Failed to load donations (${escapeHtml(err.message)})</td></tr>`;
      }
    }
  }

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
    if (f.donor && f.donor.toLowerCase() !== 'none'){
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
