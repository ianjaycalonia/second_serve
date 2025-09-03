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
    switch(st){
      case 'Pending': return '<span class="badge bg-warning text-dark">Pending</span>';
      case 'Allocated': return '<span class="badge bg-info text-dark">Allocated</span>';
      case 'Completed': return '<span class="badge bg-success">Completed</span>';
      case 'Cancelled': return '<span class="badge bg-secondary">Cancelled</span>';
      case 'Mixed': return '<span class="badge bg-light text-dark">Mixed</span>';
      default: return `<span class="badge bg-light text-dark">${st||'Unknown'}</span>`;
    }
  }

  function actionButtons(row){
    // For grouped batches, show batch-level actions
    if (row.is_group) {
      const disabled = false; // actions enabled for batch rows
      return [
        `<button class="btn btn-sm btn-outline-primary me-1 act-allocate-batch" ${disabled?'disabled':''} data-batch-id="${row.batch_id}">Allocate</button>`,
        `<button class="btn btn-sm btn-outline-success me-1 act-complete-batch" ${disabled?'disabled':''} data-batch-id="${row.batch_id}">Complete</button>`,
        `<button class="btn btn-sm btn-outline-secondary me-1 act-cancel-batch" ${disabled?'disabled':''} data-batch-id="${row.batch_id}">Cancel</button>`,
        `<button class="btn btn-sm btn-outline-danger act-delete-batch" data-batch-id="${row.batch_id}">Delete</button>`
      ].join('');
    }
    const disabled = row.status === 'Completed' || row.status === 'Cancelled';
    return [
      `<button class="btn btn-sm btn-outline-primary me-1 act-allocate" ${disabled?'disabled':''} data-id="${row.id}">Allocate</button>`,
      `<button class="btn btn-sm btn-outline-success me-1 act-complete" ${disabled?'disabled':''} data-id="${row.id}">Complete</button>`,
      `<button class="btn btn-sm btn-outline-secondary me-1 act-cancel" ${disabled?'disabled':''} data-id="${row.id}">Cancel</button>`,
      `<button class="btn btn-sm btn-outline-danger act-delete" data-id="${row.id}">Delete</button>`
    ].join('');
  }

  function donorDisplay(row){
    return row.donor_org || row.donor_name || `Donor #${row.donor_id}`;
  }

  function receiptCell(row){
    const url = row.image_url;
    if (url && typeof url === 'string') {
      const safeUrl = url.replace(/"/g, '&quot;');
      return `<a href="${safeUrl}" target="_blank" rel="noopener" class="link-primary"><i class="bi bi-receipt"></i> View</a>`;
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

    $tbody.on('click', '.act-allocate', function(){
      const id = $(this).data('id');
      openConfirmModal({
        title: 'Allocate Donation',
        body: '<p class="mb-0">Allocating donation…</p>',
        confirmText: 'Allocate',
        confirmClass: 'btn-primary',
        onConfirm: function(){ updateStatus(id, 'Allocated'); }
      });
    });
    $tbody.on('click', '.act-complete', function(){
      const id = $(this).data('id');
      openConfirmModal({
        title: 'Complete Donation',
        body: '<p class="mb-0">Completing donation…</p>',
        confirmText: 'Complete',
        confirmClass: 'btn-success',
        onConfirm: function(){ updateStatus(id, 'Completed'); }
      });
    });
    $tbody.on('click', '.act-cancel', function(){
      const id = $(this).data('id');
      openConfirmModal({
        title: 'Cancel Donation',
        body: '<p class="mb-0">Cancelling donation…</p>',
        confirmText: 'Cancel',
        confirmClass: 'btn-secondary',
        onConfirm: function(){ updateStatus(id, 'Cancelled'); }
      });
    });
    $tbody.on('click', '.act-delete', function(){
      const id = $(this).data('id');
      deleteDonation(id);
    });
    // Expand/collapse when clicking name or button on group row
    $tbody.on('click', '.batch-toggle', function(){
      const $tr = $(this).closest('tr.group-row');
      toggleBatchRow($tr);
    });
    // Batch actions
    $tbody.on('click', '.act-allocate-batch', function(){
      const batchId = $(this).data('batch-id');
      openConfirmModal({
        title: 'Allocate Batch',
        body: '<p class="mb-0">Allocating all items in this batch…</p>',
        confirmText: 'Allocate',
        confirmClass: 'btn-primary',
        onConfirm: function(){ updateStatusBatch(batchId, 'Allocated'); }
      });
    });
    $tbody.on('click', '.act-complete-batch', function(){
      const batchId = $(this).data('batch-id');
      openConfirmModal({
        title: 'Complete Batch',
        body: '<p class="mb-0">Completing all items in this batch…</p>',
        confirmText: 'Complete',
        confirmClass: 'btn-success',
        onConfirm: function(){ updateStatusBatch(batchId, 'Completed'); }
      });
    });
    $tbody.on('click', '.act-cancel-batch', function(){
      const batchId = $(this).data('batch-id');
      openConfirmModal({
        title: 'Cancel Batch',
        body: '<p class="mb-0">Cancelling all items in this batch…</p>',
        confirmText: 'Cancel',
        confirmClass: 'btn-secondary',
        onConfirm: function(){ updateStatusBatch(batchId, 'Cancelled'); }
      });
    });
    $tbody.on('click', '.act-delete-batch', function(){
      const batchId = $(this).data('batch-id');
      deleteBatch(batchId);
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
