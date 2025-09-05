// Admin Donations Management
// Depends on: jQuery, Bootstrap, and API_BASE_URL from auth.js

(function(){
  'use strict';
  
  // Helper function to escape HTML special characters
  function escapeHtml(unsafe) {
    if (unsafe === null || unsafe === undefined) return '';
    return unsafe.toString()
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
  
  const $statusMobile = $('#statusSelectMobile');
  const $statusDesktop = $('#statusSelectDesktop');
  const $tbody = $('table tbody');

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

  function actionButtons(row) {
    if (!row) return '';
    
    const id = row.id || '';
    const statusNorm = normalizeStatus(row.status || '');
    // Allow delete for all statuses except those explicitly marked as non-deletable
    const nonDeletableStatuses = []; // Empty array means all statuses can be deleted
    const canDelete = !nonDeletableStatuses.includes(statusNorm);
    const isBatch = !!row.batch_id || row.is_group;
    
    // Helper to create button HTML
    const btn = (text, cls, icon, extra = '') => {
      return `<button class="btn btn-sm ${cls}" ${extra}>
        <i class="bi ${icon}"></i> ${text}
      </button>`;
    };
    
    // Batch actions
    if (isBatch) {
      const batchId = row.batch_id || id;
      const buttons = [];
      
      // Received button for picked up batches
      if (statusNorm === 'picked up') {
        buttons.push(btn('Mark Received', 'btn-success me-1 act-received-batch', 'bi-check-lg', 
          `data-batch-id="${batchId}" title="Mark as received at warehouse"`));
      } 
      // Food Safety Check button for applicable statuses
      else if (!['failed safety', 'completed', 'cancelled', 'arrived at warehouse'].includes(statusNorm)) {
        buttons.push(btn('Food Safety', 'btn-warning me-1 act-food-safety-batch', 'bi-clipboard-check',
          `data-batch-id="${batchId}" title="Perform food safety check"`));
      }
      
      // Always show delete button but disable based on canDelete
      buttons.push(btn('', 'btn-outline-danger act-delete-batch', 'bi-trash',
        `data-batch-id="${batchId}" ${canDelete ? '' : 'disabled'} 
         title="${canDelete ? 'Delete batch' : 'Cannot delete ' + statusNorm + ' batch'}"`));
      
      return buttons.join('');
    }
    
    // Single donation actions
    const buttons = [];
    
    // Food Safety Check button for pending/scheduled donations
    if (['pending', 'scheduled', 'picked up'].includes(statusNorm)) {
      buttons.push(btn('Food Safety', 'btn-warning me-1 act-food-safety', 'bi-clipboard-check',
        `data-id="${id}" title="Perform food safety check"`));
    }
    
    // Always show delete button but disable based on canDelete
    buttons.push(btn('', 'btn-outline-danger act-delete', 'bi-trash',
      `data-id="${id}" ${canDelete ? '' : 'disabled'} 
       title="${canDelete ? 'Delete donation' : 'Cannot delete ' + statusNorm + ' donation'}"`));
    
    return buttons.join('');
  }

  function donorDisplay(row) {
    if (row.donor_org) {
      return `<span class="fw-medium">${escapeHtml(row.donor_org)}</span>`;
    }
    if (row.donor_name) {
      return `<span class="text-nowrap">${escapeHtml(row.donor_name)}</span>`;
    }
    if (row.donor_id) {
      return `<span class="text-muted">Donor #${escapeHtml(row.donor_id.toString())}</span>`;
    }
    return '<span class="text-muted">Unknown</span>';
  }

  function receiptCell(row){
    const url = row.image_full_url || row.image_url;
    if (url && typeof url === 'string') {
      const safeUrl = url.replace(/"/g, '&quot;');
      return `<button type="button" class="btn btn-link p-0 act-view-receipt" data-url="${safeUrl}"><i class="bi bi-receipt"></i> View</button>`;
    }
    return '<span class="text-muted">None</span>';
  }

  function renderRows(items) {
    if (!Array.isArray(items)) items = [];
    
    // Clear existing rows
    $tbody.empty();
    
    if (items.length === 0) {
      $tbody.html('<tr><td colspan="7" class="text-center text-muted py-4">No donations found</td></tr>');
      return;
    }
    
    items.forEach(row => {
      const isBatch = !!row.batch_id;
      const status = row.status ? row.status.toLowerCase() : '';
      
      // Determine row class based on status
      let rowClass = '';
      if (status.includes('completed') || status.includes('delivered')) {
        rowClass = 'table-success';
      } else if (status.includes('rejected') || status.includes('failed')) {
        rowClass = 'table-danger';
      } else if (status.includes('pending') || status.includes('scheduled')) {
        rowClass = 'table-warning';
      }
      
      // Format date
      const formattedDate = fmtDate(row.created_at);
      
      // Create row HTML
      const nameCell = row.name || row.type || 'N/A';
      let showButton = '';
      
      if (isBatch) {
        showButton = `<button class="btn btn-sm btn-outline-primary btn-sm batch-toggle me-2" 
                     data-batch-id="${row.batch_id}" 
                     title="Show batch details">
            <i class="bi bi-chevron-down"></i>
          </button>`;
      } else {
        showButton = '<div class="ms-4"></div>'; // Add spacing for non-batch rows
      }
      
      const rowHtml = `
        <tr class="${rowClass}">
          <td class="align-middle">${donorDisplay(row)}</td>
          <td class="align-middle">
            <div class="d-flex align-items-center">
              ${showButton}
              <span>${nameCell}</span>
            </div>
          </td>
          <td class="align-middle">${row.quantity || '1'}</td>
          <td class="align-middle">${formattedDate}</td>
          <td class="align-middle">${badgeForStatus(row.status)}</td>
          <td class="align-middle">${receiptCell(row)}</td>
          <td class="align-middle">${actionButtons(row)}</td>
        </tr>
      `;
      
      $tbody.append(rowHtml);
      
      // Add click handler for batch toggle button
      if (isBatch) {
        const $row = $tbody.find(`tr:last-child`); // Get the row we just added
        $row.attr('data-batch-id', row.batch_id); // Ensure the row has the batch-id
        
        $row.find('.batch-toggle').on('click', function(e) {
          e.stopPropagation();
          const $btn = $(this);
          const $currentRow = $btn.closest('tr');
          
          // Toggle chevron icon
          $btn.find('i').toggleClass('bi-chevron-down bi-chevron-up');
          
          // Toggle the batch details
          if ($currentRow.next().hasClass('batch-details')) {
            $currentRow.next().remove();
          } else {
            // Remove any other open batch details first
            $('.batch-details').remove();
            // Reset all chevron icons
            $('.batch-toggle i').removeClass('bi-chevron-up').addClass('bi-chevron-down');
            // Set the current icon to up
            $btn.find('i').removeClass('bi-chevron-down').addClass('bi-chevron-up');
            // Show loading state
            $btn.prop('disabled', true).html('<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>');
            
            // Fetch and show batch details
            toggleBatchRow($currentRow);
            
            // Re-enable the button after a short delay
            setTimeout(() => {
              $btn.prop('disabled', false).html('<i class="bi bi-chevron-up"></i>');
            }, 300);
          }
        });
      }
    });
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

  function toggleBatchRow($tr) {
    const batchId = $tr.data('batch-id');
    if (!batchId) return;
    
    // Check if details are already shown
    const $existingDetails = $tr.next('.batch-details');
    if ($existingDetails.length) {
      $existingDetails.remove();
      return;
    }

    // Show loading state in the row
    const $loadingRow = $(`<tr class="batch-details"><td colspan="7" class="text-center py-3">
      <div class="spinner-border spinner-border-sm" role="status">
        <span class="visually-hidden">Loading...</span>
      </div> Loading batch items...
    </td></tr>`);
    $tr.after($loadingRow);

    function insertDetails(items) {
      try {
        // Remove loading row
        $loadingRow.remove();
        
        if (!items || items.length === 0) {
          const $noItems = $(`<tr class="batch-details"><td colspan="7" class="text-center py-3 text-muted">No items found in this batch</td></tr>`);
          $tr.after($noItems);
          return;
        }
        
        const detailsHtml = buildBatchDetailsTable(items);
        const $details = $(`<tr class="batch-details"><td colspan="7">${detailsHtml}</td></tr>`);
        $tr.after($details);
        
        // Smooth scroll to show the details
        $('html, body').animate({
          scrollTop: $details.offset().top - 20
        }, 300);
        
      } catch (error) {
        console.error('Error displaying batch details:', error);
        $loadingRow.html('<td colspan="7" class="text-center text-danger py-3">Error loading batch details</td>');
      }
    }

    // Check cache first
    if (batchCache.has(batchId)) {
      insertDetails(batchCache.get(batchId));
      return;
    }

    // Fetch from API
    $.ajax({
      url: `${API_BASE_URL}/donations/index.php/batch/${batchId}`,
      method: 'GET',
      dataType: 'json',
      xhrFields: { withCredentials: true },
      success: function(resp) {
        try {
          const items = resp?.data?.items || [];
          batchCache.set(batchId, items);
          insertDetails(items);
        } catch (error) {
          console.error('Error processing batch items:', error);
          $loadingRow.html('<td colspan="7" class="text-center text-danger py-3">Error processing batch items</td>');
        }
      },
      error: function(xhr) {
        console.error('Batch items API error:', xhr);
        const errorMsg = xhr.responseJSON?.error || 'Failed to load batch items';
        $loadingRow.html(`<td colspan="7" class="text-center text-danger py-3">${errorMsg}</td>`);
      }
    });
  }

  function setLoadingUI(loading) {
    const overlayId = 'donations-loading-overlay';
    const container = document.querySelector('.main, main, .content, .container, body') || document.body;
    
    if (loading) {
      // Remove any existing overlay first
      const existingOverlay = document.getElementById(overlayId);
      if (existingOverlay) {
        existingOverlay.remove();
      }
      
      // Create and append new overlay
      const overlay = document.createElement('div');
      overlay.id = overlayId;
      overlay.className = 'position-fixed top-0 start-0 w-100 h-100 d-flex align-items-center justify-content-center';
      overlay.style.background = 'rgba(255,255,255,0.7)';
      overlay.style.zIndex = '9999';
      overlay.innerHTML = `
        <div class="text-center">
          <div class="spinner-border text-warning" role="status" style="width: 3rem; height: 3rem;">
            <span class="visually-hidden">Loading...</span>
          </div>
          <p class="mt-2 text-muted">Loading donations...</p>
        </div>`;
      
      container.style.position = 'relative';
      container.appendChild(overlay);
    } else {
      // Remove overlay if it exists
      const el = document.getElementById(overlayId);
      if (el) {
        el.remove();
      }
    }
  }

  function fetchList() {
    let status = ($statusDesktop.val() || $statusMobile.val() || '').trim();
    if (/^all$/i.test(status)) status = '';
    
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    // Request grouped by batch for admin view
    params.set('group', 'batch');

    setLoadingUI(true);
    
    $.ajax({
      url: `${API_BASE_URL}/donations/index.php/list?${params.toString()}`,
      method: 'GET',
      dataType: 'json',
      xhrFields: { withCredentials: true },
      success: function(resp) {
        try {
          console.log('API Response:', resp); // Debug log
          
          // Handle both direct array response and data.items format
          let items = [];
          if (Array.isArray(resp)) {
            items = resp;
          } else if (resp && Array.isArray(resp.data)) {
            items = resp.data;
          } else if (resp && resp.data && Array.isArray(resp.data.items)) {
            items = resp.data.items;
          } else if (resp && resp.items && Array.isArray(resp.items)) {
            items = resp.items;
          }
          
          console.log('Processed items:', items); // Debug log
          
          if (items.length === 0) {
            console.warn('No donation items found in the response');
          }
          
          // Sort by creation date (newest first)
          items.sort((a, b) => {
            const da = a.created_at ? new Date(a.created_at) : new Date(0);
            const db = b.created_at ? new Date(b.created_at) : new Date(0);
            return db - da; // Sort descending (newest first)
          });
          
          renderRows(items);
        } catch (error) {
          console.error('Error processing donation data:', error);
          showBanner('danger', 'Error processing donation data. Please check console for details.');
        }
      },
      error: function(xhr, status, error) {
        console.error('Failed to load donations:', {
          status: xhr.status,
          statusText: xhr.statusText,
          responseText: xhr.responseText,
          error: error
        });
        
        let errorMsg = 'Failed to load donations';
        try {
          const errResp = JSON.parse(xhr.responseText);
          if (errResp && errResp.error) {
            errorMsg = errResp.error;
          }
        } catch (e) {
          // If we can't parse the error, use the default message
        }
        
        showBanner('danger', errorMsg);
      },
      complete: function() {
        setLoadingUI(false);
        bindRowActions();
      }
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
