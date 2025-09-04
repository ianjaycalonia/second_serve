// Admin Donations Management
// Depends on: jQuery, Bootstrap, and API_BASE_URL from auth.js

(function(){
  'use strict';

  const $tbody = $('table tbody');
  const $statusDesktop = $('#statusSelectDesktop');
  const $statusMobile = $('#statusSelectMobile');

  function fmtDate(s){
    if(!s) return '';
    const d = new Date(s);
    if (isNaN(d)) return s;
    return d.toLocaleDateString();
  }

  // Wire submit of Food Safety Checklist (Passed)
  $(document).on('click', '#foodSafetySubmitBtn', function(){
    const formEl = document.getElementById('foodSafetyForm');
    if (!formEl) return;
    const btn = this;
    const fd = new FormData(formEl);
    // Validation rules
    const packagingOk = document.getElementById('fsPackaging').checked;
    const spoilageOk = document.getElementById('fsSpoilage').checked;
    const receiptInput = document.getElementById('fsReceipt');
    const isBatch = !!(fd.get('batch_id'));

    if (!packagingOk || !spoilageOk) {
      alert('Please confirm packaging is in good condition and no signs of spoilage.');
      return;
    }
    if (!receiptInput || !(receiptInput.files && receiptInput.files.length > 0)) {
      alert('Receipt photo is required.');
      return;
    }
    // Relax client-side size limit; server now compresses and allows up to 15 MB
    const MAX_BYTES = 15 * 1024 * 1024;
    if (receiptInput.files[0] && receiptInput.files[0].size > MAX_BYTES) {
      alert('Receipt photo is too large (limit 15 MB).');
      return;
    }
    // Require an expiry photo for each item
    const itemRows = Array.from(document.querySelectorAll('#fsBatchItems .fs-item-row'));
    if (itemRows.length === 0) {
      alert('Please provide at least one item with an expiry photo.');
      return;
    }
    for (const row of itemRows) {
      const input = row.querySelector('.fs-item-photo');
      if (!input || !(input.files && input.files.length > 0)) {
        alert('Please provide an expiry photo for each item.');
        return;
      }
      if (input.files[0] && input.files[0].size > MAX_BYTES) {
        alert('Each expiry photo is too large (limit 15 MB).');
        return;
      }
    }
    // Proceed to submit (passed)
    btn.disabled = true;
    btn.textContent = 'Submitting…';

    $.ajax({
      url: `${API_BASE_URL}/food_safety_checks/create.php`,
      method: 'POST',
      data: (function(){ fd.set('result','passed'); return fd; })(),
      processData: false,
      contentType: false,
      dataType: 'json',
      xhrFields: { withCredentials: true },
      success: function(resp){
        // Close modal
        try {
          const modalEl = document.getElementById('foodSafetyModal');
          const inst = bootstrap.Modal.getInstance(modalEl) || bootstrap.Modal.getOrCreateInstance(modalEl);
          inst.hide();
        } catch(_) {}

        // Update status to Picked Up (batch or single)
        const donationId = fd.get('donation_id');
        const batchId = fd.get('batch_id');
        showBanner('success', 'Food safety check submitted. Marked as Picked Up.');
        if (batchId) {
          updateStatusBatch(batchId, 'Picked Up');
        } else if (donationId) {
          updateStatus(donationId, 'Picked Up');
        } else {
          fetchList();
        }
      },
      error: function(err){
        console.error('Food safety submit error', err);
        const status = err?.status;
        const text = (err?.responseJSON && err.responseJSON.error) ? err.responseJSON.error : (err?.responseText || '').toString().slice(0, 500);
        alert(text || (`Failed to submit food safety check${status ? ` (HTTP ${status})` : ''}`));
      },
      complete: function(){
        btn.disabled = false;
        btn.textContent = 'Submit Check';
      }
    });
  });

  // Wire submit of Food Safety Checklist (Failed)
  $(document).on('click', '#foodSafetyFailBtn', function(){
    const formEl = document.getElementById('foodSafetyForm');
    if (!formEl) return;
    const btn = this;
    const fd = new FormData(formEl);
    const failReason = (document.getElementById('fsFailReason').value || '').trim();
    const receiptInput = document.getElementById('fsReceipt');

    // Validation for fail path
    if (!failReason) {
      alert('Please provide a failure reason.');
      return;
    }
    if (!receiptInput || !(receiptInput.files && receiptInput.files.length > 0)) {
      alert('Receipt photo is required.');
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Submitting…';

    $.ajax({
      url: `${API_BASE_URL}/food_safety_checks/create.php`,
      method: 'POST',
      data: (function(){ fd.set('result','failed'); return fd; })(),
      processData: false,
      contentType: false,
      dataType: 'json',
      xhrFields: { withCredentials: true },
      success: function(){
        try {
          const modalEl = document.getElementById('foodSafetyModal');
          const inst = bootstrap.Modal.getInstance(modalEl) || bootstrap.Modal.getOrCreateInstance(modalEl);
          inst.hide();
        } catch(_) {}
        const donationId = fd.get('donation_id');
        const batchId = fd.get('batch_id');
        showBanner('danger', 'Food safety check marked as Failed.');
        if (batchId) {
          updateStatusBatch(batchId, 'Failed Safety');
        } else if (donationId) {
          updateStatus(donationId, 'Failed Safety');
        } else {
          fetchList();
        }
      },
      error: function(err){
        console.error('Food safety fail submit error', err);
        const status = err?.status;
        const text = (err?.responseJSON && err.responseJSON.error) ? err.responseJSON.error : (err?.responseText || '').toString().slice(0, 500);
        alert(text || (`Failed to submit failure result${status ? ` (HTTP ${status})` : ''}`));
      },
      complete: function(){
        btn.disabled = false;
        btn.textContent = 'Mark as Failed';
      }
    });
  });

  function updateStatusBatch(batchId, status){
    setLoadingUI(true);
    $.ajax({
      url: `${API_BASE_URL}/donations/index.php/batch/${batchId}/status`,
      method: 'PUT',
      data: JSON.stringify({ status }),
      contentType: 'application/json',
      dataType: 'json',
      xhrFields: { withCredentials: true },
      success: function(){
        fetchList();
      },
      error: function(err){
        console.error('Batch status update error', err);
        alert(err.responseJSON?.error || 'Failed to update batch status');
      },
      complete: function(){ setLoadingUI(false); }
    });
  }

  // Simple reusable warning modal (no buttons)
  function ensureConfirmModal(){
    if (document.getElementById('confirmModal')) return;
    const html = `
      <div class="modal fade" id="confirmModal" tabindex="-1" aria-hidden="true">
        <div class="modal-dialog">
          <div class="modal-content">
            <div class="modal-header">
              <h5 class="modal-title">Confirm</h5>
              <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
            </div>
            <div class="modal-body"><p class="mb-0">Processing…</p></div>
          </div>
        </div>
      </div>`;
    document.body.insertAdjacentHTML('beforeend', html);
  }

  function openConfirmModal(options){
    ensureConfirmModal();
    const { title, body, onConfirm, autoHideMs, confirmable, confirmText, confirmClass } = options || {};
    const modalEl = document.getElementById('confirmModal');
    const contentEl = modalEl.querySelector('.modal-content');
    modalEl.querySelector('.modal-title').textContent = title || 'Confirm';
    modalEl.querySelector('.modal-body').innerHTML = body || '<p class="mb-0">Processing…</p>';

    // Remove any previous footer
    const oldFooter = contentEl.querySelector('.modal-footer');
    if (oldFooter) oldFooter.remove();

    const inst = bootstrap.Modal.getOrCreateInstance(modalEl);

    if (confirmable) {
      // Build footer with buttons
      const footer = document.createElement('div');
      footer.className = 'modal-footer';
      footer.innerHTML = `
        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
        <button type="button" class="btn ${confirmClass || 'btn-danger'}" id="confirmModalConfirmBtn">${confirmText || 'Confirm'}</button>`;
      contentEl.appendChild(footer);
      // Wire confirm click
      const btn = footer.querySelector('#confirmModalConfirmBtn');
      btn.addEventListener('click', () => {
        try { onConfirm && onConfirm(); } catch(_) {}
        inst.hide();
      });
      inst.show();
    } else {
      // Auto-run on show and auto-hide
      function onShown(){
        try { onConfirm && onConfirm(); } catch(_) {}
        const hideDelay = typeof autoHideMs === 'number' ? autoHideMs : 1200;
        setTimeout(() => inst.hide(), hideDelay);
        modalEl.removeEventListener('shown.bs.modal', onShown);
      }
      modalEl.addEventListener('shown.bs.modal', onShown);
      inst.show();
    }
  }

  function deleteBatch(batchId){
    openConfirmModal({
      title: 'Delete Batch',
      body: '<p class="mb-0">This will archive all items in the batch.</p>',
      confirmable: true,
      confirmText: 'Delete',
      confirmClass: 'btn-danger',
      onConfirm: function(){
        setLoadingUI(true);
        $.ajax({
          url: `${API_BASE_URL}/donations/index.php/batch/${batchId}`,
          method: 'DELETE',
          dataType: 'json',
          xhrFields: { withCredentials: true },
          success: function(){ fetchList(); },
          error: function(err){
            console.error('Batch delete error', err);
            alert(err.responseJSON?.error || 'Failed to delete batch');
          },
          complete: function(){ setLoadingUI(false); }
        });
      }
    });
  }

  function badgeForStatus(st){
    const s = normalizeStatus(st);
    switch(s){
      case 'pending': return '<span class="badge bg-warning text-dark">Pending</span>';
      case 'allocated': return '<span class="badge bg-info text-dark">Allocated</span>';
      case 'picked up': return '<span class="badge bg-primary">Picked Up</span>';
      case 'arrived at warehouse': return '<span class="badge bg-dark">Arrived at warehouse</span>';
      case 'failed safety': return '<span class="badge bg-danger">Failed Safety</span>';
      case 'completed': return '<span class="badge bg-success">Completed</span>';
      case 'cancelled': return '<span class="badge bg-secondary">Cancelled</span>';
      case 'mixed': return '<span class="badge bg-light text-dark">Mixed</span>';
      default: return `<span class="badge bg-light text-dark">${st||'Unknown'}</span>`;
    }
  }

  function normalizeStatus(st){
    const s = String(st||'').trim().toLowerCase();
    if (s === 'picked up' || s === 'picked-up' || s === 'pickedup') return 'picked up';
    if (s === 'arrived at warehouse' || s === 'arrived at Warehouse'.toLowerCase()) return 'arrived at warehouse';
    if (s === 'failed safety' || s === 'failed') return 'failed safety';
    if (s === 'in progress') return 'allocated'; // legacy mapping if any
    return s;
  }

  function actionButtons(row){
    // Replace plain actions with Food Safety Check entry point
    const statusNorm = normalizeStatus(row.status);
    if (row.is_group) {
      // Batch actions
      if (statusNorm === 'picked up') {
        return [
          `<button class="btn btn-sm btn-success me-1 act-received-batch" data-batch-id="${row.batch_id}">Received</button>`,
          `<button class="btn btn-sm btn-outline-danger act-delete-batch" data-batch-id="${row.batch_id}">Delete</button>`
        ].join('');
      }
      const hideFs = (statusNorm === 'failed safety' || statusNorm === 'completed' || statusNorm === 'cancelled' || statusNorm === 'arrived at warehouse');
      return [
        hideFs ? '' : `<button class="btn btn-sm btn-warning me-1 act-food-safety-batch" data-batch-id="${row.batch_id}">Food Safety Check</button>`,
        `<button class="btn btn-sm btn-outline-danger act-delete-batch" data-batch-id="${row.batch_id}">Delete</button>`
      ].join('');
    }
    // Single item actions
    if (statusNorm === 'picked up') {
      return [
        `<button class="btn btn-sm btn-success me-1 act-received" data-id="${row.id}">Received</button>`,
        `<button class="btn btn-sm btn-outline-danger act-delete" data-id="${row.id}">Delete</button>`
      ].join('');
    }
    const disabled = (statusNorm === 'completed' || statusNorm === 'cancelled' || statusNorm === 'failed safety' || statusNorm === 'arrived at warehouse');
    return [
      disabled ? '' : `<button class="btn btn-sm btn-warning me-1 act-food-safety" data-id="${row.id}">Food Safety Check</button>`,
      `<button class="btn btn-sm btn-outline-danger act-delete" data-id="${row.id}">Delete</button>`
    ].join('');
  }

  function donorDisplay(row){
    return row.donor_org || row.donor_name || `Donor #${row.donor_id}`;
  }

  function receiptCell(row){
    const url = row.image_full_url || row.image_url;
    if (url && typeof url === 'string') {
      const safeUrl = url.replace(/"/g, '&quot;');
      return `<button type="button" class="btn btn-link p-0 act-view-receipt" data-url="${safeUrl}"><i class="bi bi-receipt"></i> View</button>`;
    }
    return '<span class="text-muted">None</span>';
  }

  function renderRows(items){
    if(!Array.isArray(items)) items = [];
    const html = items.map(row => {
      const trAttrs = row.is_group ? ` class="group-row" data-batch-id="${row.batch_id||''}"` : '';
      const nameCell = row.is_group
        ? `<span class="text-primary text-decoration-underline batch-toggle" role="button">${row.name || 'Batch'}</span>`
        : (row.name || row.type || '');
      return `
      <tr${trAttrs}>
        <td>${donorDisplay(row)}</td>
        <td>${nameCell}</td>
        <td>${row.quantity ?? ''}</td>
        <td>${fmtDate(row.created_at)}</td>
        <td>${badgeForStatus(row.status)}</td>
        <td>${receiptCell(row)}</td>
        <td>${actionButtons(row)}</td>
      </tr>`;
    }).join('');
    $tbody.html(html || '<tr><td colspan="7" class="text-center text-muted">No donations found</td></tr>');
  }

  // Cache for loaded batch details
  const batchCache = new Map();

  function buildBatchDetailsTable(items){
    const rows = items.map(it => `
      <tr>
        <td>${it.name || ''}</td>
        <td>${it.type || ''}</td>
        <td>${it.quantity ?? ''}</td>
        <td>${fmtDate(it.expiry_date)}</td>
        <td>${badgeForStatus(it.status)}</td>
      </tr>
    `).join('');
    return `
      <div class="p-2 bg-light border rounded">
        <div class="small text-muted mb-2">Batch items</div>
        <div class="table-responsive">
          <table class="table table-sm mb-0">
            <thead class="table-secondary">
              <tr>
                <th>Item</th><th>Type</th><th>Qty</th><th>Expiry</th><th>Status</th>
              </tr>
            </thead>
            <tbody>
              ${rows || '<tr><td colspan="5" class="text-center text-muted">No items</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>`;
  }

  function toggleBatchRow($tr){
    const batchId = $tr.data('batch-id');
    if (!batchId) return;
    const isOpen = $tr.next().hasClass('batch-details');
    if (isOpen) { $tr.next().remove(); return; }

    function insertDetails(items){
      const detailsHtml = buildBatchDetailsTable(items);
      const colCount = $tr.children('td').length;
      const $details = $(`<tr class="batch-details"><td colspan="${colCount}">${detailsHtml}</td></tr>`);
      $tr.after($details);
    }

    if (batchCache.has(batchId)){
      insertDetails(batchCache.get(batchId));
      return;
    }

    // Fetch from API
    $.ajax({
      url: `${API_BASE_URL}/donations/index.php/batch/${batchId}`,
      method: 'GET',
      dataType: 'json',
      xhrFields: { withCredentials: true },
      success: function(resp){
        const items = resp?.data?.items || [];
        batchCache.set(batchId, items);
        insertDetails(items);
      },
      error: function(err){
        alert(err?.responseJSON?.error || 'Failed to load batch items');
      }
    });
  }

  function setLoadingUI(loading){
    const overlayId = 'donations-loading-overlay';
    if (loading){
      if (!document.getElementById(overlayId)){
        const overlay = document.createElement('div');
        overlay.id = overlayId;
        overlay.className = 'position-absolute top-0 start-0 w-100 h-100 d-flex align-items-center justify-content-center';
        overlay.style.background = 'rgba(255,255,255,0.6)';
        overlay.innerHTML = '<div class="spinner-border text-warning" role="status" aria-label="Loading"></div>';
        document.querySelector('.main').appendChild(overlay);
      }
    } else {
      const el = document.getElementById(overlayId);
      if (el) el.remove();
    }
  }

  function fetchList(){
    let status = ($statusDesktop.val() || $statusMobile.val() || '').trim();
    if (/^all$/i.test(status)) status = '';
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    // Default to grouped by batch for admin list
    params.set('group', 'batch');

    setLoadingUI(true);
    $.ajax({
      url: `${API_BASE_URL}/donations/index.php/list?${params.toString()}`,
      method: 'GET',
      dataType: 'json',
      xhrFields: { withCredentials: true },
      success: function(resp){
        const items = resp?.data?.items || [];
        // Ensure latest first on the client as a safeguard
        items.sort((a,b) => {
          const da = new Date(a.created_at);
          const db = new Date(b.created_at);
          if (isNaN(da) && isNaN(db)) return 0;
          if (isNaN(da)) return 1;
          if (isNaN(db)) return -1;
          return db - da;
        });
        renderRows(items);
      },
      error: function(err){
        console.error('List fetch error', err);
        alert(err.responseJSON?.error || 'Failed to load donations');
      },
      complete: function(){ setLoadingUI(false); bindRowActions(); }
    });
  }

  function updateStatus(id, status){
    setLoadingUI(true);
    $.ajax({
      url: `${API_BASE_URL}/donations/index.php/${id}/status`,
      method: 'PUT',
      data: JSON.stringify({ status }),
      contentType: 'application/json',
      dataType: 'json',
      xhrFields: { withCredentials: true },
      success: function(){
        // Set filters to the new status so the processed donation is visible
        try { $statusDesktop.val(status); } catch(_) {}
        try { $statusMobile.val(status); } catch(_) {}
        fetchList();
      },
      error: function(err){
        console.error('Status update error', err);
        alert(err.responseJSON?.error || 'Failed to update status');
      },
      complete: function(){ setLoadingUI(false); }
    });
  }

  function deleteDonation(id){
    openConfirmModal({
      title: 'Delete Donation',
      body: '<p class="mb-0">This action will archive the donation.</p>',
      confirmable: true,
      confirmText: 'Delete',
      confirmClass: 'btn-danger',
      onConfirm: function(){
        setLoadingUI(true);
        $.ajax({
          url: `${API_BASE_URL}/donations/index.php/${id}`,
          method: 'DELETE',
          dataType: 'json',
          xhrFields: { withCredentials: true },
          success: function(){ fetchList(); },
          error: function(err){
            console.error('Delete error', err);
            alert(err.responseJSON?.error || 'Failed to delete donation');
          },
          complete: function(){ setLoadingUI(false); }
        });
      }
    });
  }

  function bindRowActions(){
    // Unbind first to avoid duplicates
    $tbody.off('click', '.act-allocate');
    $tbody.off('click', '.act-complete');
    $tbody.off('click', '.act-cancel');
    $tbody.off('click', '.act-delete');
    $tbody.off('click', '.batch-toggle');
    $tbody.off('click', '.act-allocate-batch');
    $tbody.off('click', '.act-complete-batch');
    $tbody.off('click', '.act-cancel-batch');
    $tbody.off('click', '.act-delete-batch');
    $tbody.off('click', '.act-food-safety');
    $tbody.off('click', '.act-food-safety-batch');
    $tbody.off('click', '.act-received');
    $tbody.off('click', '.act-received-batch');
    $tbody.off('click', '.act-view-receipt');

    // Batch toggle show/hide for grouped rows
    $tbody.on('click', '.batch-toggle', function(){
      const $tr = $(this).closest('tr');
      toggleBatchRow($tr);
    });

    // Food Safety openers
    function renderItemRows(items){
      const wrap = document.getElementById('fsBatchItems');
      if (!wrap) return;
      wrap.innerHTML = '';
      (items || []).forEach((it, idx) => {
        const id = it.id || it.donation_id || it.item_id || it; // support various shapes
        const name = (it.name || it.type || `Item #${id}`);
        const row = document.createElement('div');
        row.className = 'fs-item-row border rounded p-2';
        row.innerHTML = `
          <input type="hidden" name="item_ids[]" value="${id}">
          <div class="d-flex align-items-center gap-2">
            <div class="flex-grow-1 small text-muted">${name}</div>
            <div style="min-width:220px;">
              <label class="form-label mb-1">Expiry photo</label>
              <input type="file" class="form-control form-control-sm fs-item-photo" name="item_photos[]" accept="image/*" capture="camera">
            </div>
          </div>`;
        wrap.appendChild(row);
      });
    }

    function openFoodSafetyModal(opts){
      try {
        const donationId = opts?.donationId || '';
        const batchId = opts?.batchId || '';
        const form = document.getElementById('foodSafetyForm');
        if (!form) { alert('Food Safety form not found on this page.'); return; }
        // reset
        form.reset();
        document.getElementById('fsDonationId').value = donationId;
        document.getElementById('fsBatchId').value = batchId;
        // populate items section
        if (batchId) {
          // fetch batch items
          $.ajax({
            url: `${API_BASE_URL}/donations/index.php/batch/${batchId}`,
            method: 'GET',
            dataType: 'json',
            xhrFields: { withCredentials: true },
            success: function(resp){
              const items = resp?.data?.items || [];
              renderItemRows(items);
            },
            error: function(){
              renderItemRows([]);
            }
          });
        } else if (donationId) {
          // single donation: one item row
          renderItemRows([{ id: donationId, name: `Donation #${donationId}` }]);
        } else {
          renderItemRows([]);
        }
        const modalEl = document.getElementById('foodSafetyModal');
        const inst = bootstrap.Modal.getOrCreateInstance(modalEl);
        inst.show();
      } catch(e) { console.error(e); }
    }

    $tbody.on('click', '.act-food-safety', function(){
      const id = $(this).data('id');
      openFoodSafetyModal({ donationId: id });
    });
    // Batch Food Safety opener (for grouped rows)
    $tbody.on('click', '.act-food-safety-batch', function(){
      const batchId = $(this).data('batch-id');
      openFoodSafetyModal({ batchId });
    });
    // (Deprecated old batch actions removed)
    $tbody.on('click', '.act-delete-batch', function(){
      const batchId = $(this).data('batch-id');
      deleteBatch(batchId);
    });

    // Mark as Received (Arrived at warehouse)
    $tbody.on('click', '.act-received', function(){
      const id = $(this).data('id');
      if (!id) return;
      updateStatus(id, 'Arrived at warehouse');
    });
    $tbody.on('click', '.act-received-batch', function(){
      const batchId = $(this).data('batch-id');
      if (!batchId) return;
      updateStatusBatch(batchId, 'Arrived at warehouse');
    });

    // Open image viewer modal for receipt images
    $tbody.on('click', '.act-view-receipt', function(){
      try {
        const url = $(this).data('url');
        const img = document.getElementById('imageViewerImg');
        const wrap = document.getElementById('imageViewerWrap');
        const modalEl = document.getElementById('imageViewerModal');
        if (!url) return;
        if (!img || !modalEl) { window.open(url, '_blank'); return; }
        img.src = url;
        // Reset zoom state
        let scale = 1;
        function apply(){ img.style.transform = `scale(${scale})`; }
        apply();
        // Wire zoom buttons (replace nodes to clear old listeners)
        const btnIn0 = document.getElementById('imgZoomInBtn');
        const btnOut0 = document.getElementById('imgZoomOutBtn');
        const btnReset0 = document.getElementById('imgZoomResetBtn');
        if (btnIn0) {
          const n = btnIn0.cloneNode(true); btnIn0.parentNode.replaceChild(n, btnIn0);
          n.addEventListener('click', () => { scale = Math.min(5, +(scale + 0.2).toFixed(2)); apply(); });
        }
        if (btnOut0) {
          const n = btnOut0.cloneNode(true); btnOut0.parentNode.replaceChild(n, btnOut0);
          n.addEventListener('click', () => { scale = Math.max(0.2, +(scale - 0.2).toFixed(2)); apply(); });
        }
        if (btnReset0) {
          const n = btnReset0.cloneNode(true); btnReset0.parentNode.replaceChild(n, btnReset0);
          n.addEventListener('click', () => { scale = 1; apply(); if (wrap) wrap.scrollTo({top:0,left:0}); });
        }
        // Show modal
        const inst = bootstrap.Modal.getOrCreateInstance(modalEl);
        inst.show();
      } catch(e) {
        console.error('image modal error', e);
      }
    });
  }

  $(document).ready(function(){
    // Filter listeners
    $statusDesktop.on('change', fetchList);
    $statusMobile.on('change', fetchList);

    // Initial load
    fetchList();
  });

  // Small helper: show a dismissible banner at the top of the main content
  function showBanner(type, message){
    try {
      const container = document.querySelector('.main');
      if (!container) return;
      const wrap = document.createElement('div');
      wrap.innerHTML = `
        <div class="alert alert-${type} alert-dismissible fade show" role="alert" style="position:sticky; top:60px; z-index: 1029;">
          ${message}
          <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
        </div>`;
      // Insert at top of main, after the header block
      const firstChild = container.firstElementChild;
      if (firstChild) {
        container.insertBefore(wrap.firstElementChild, firstChild.nextSibling);
      } else {
        container.prepend(wrap.firstElementChild);
      }
      // Auto dismiss after 3 seconds
      setTimeout(() => {
        const alertEl = container.querySelector('.alert');
        if (!alertEl) return;
        const bsAlert = bootstrap.Alert.getOrCreateInstance(alertEl);
        bsAlert.close();
      }, 3000);
    } catch(_) { /* no-op */ }
  }
})();
