/* global SignaturePad, bootstrap, AllocationsAPI */
(function(){
  'use strict';
  const DEBUG = !!window.__DEBUG;
  if (DEBUG) console.debug('adminDistributionPickup.js loaded');
  const API_BASE_URL = (typeof window.API_BASE_URL === 'string' && window.API_BASE_URL) ? window.API_BASE_URL : '/php/api';
  const FETCH_OPTS = { credentials: 'include', headers: { Accept: 'application/json' } };
  const AUTO_REFRESH_INTERVAL_MS = 15000;

  const els = {
    tableBody: document.getElementById('allocationsTableBody'),
    loadingRow: document.getElementById('allocationsLoading'),
    statusFilter: document.getElementById('statusFilter'),
    runFilter: document.getElementById('runFilter'),
    searchInput: document.getElementById('searchInput'),
    refreshBtn: document.getElementById('refreshBtn'),
    exportBtn: document.getElementById('exportBtn'),
    pickupModal: document.getElementById('pickupModal'),
    pickupRecipientDetails: document.getElementById('pickupRecipientDetails'),
    pickupItemsList: document.getElementById('pickupItemsList'),
    confirmPickupBtn: document.getElementById('confirmPickupBtn'),
    startCameraBtn: document.getElementById('startCameraBtn'),
    takePhotoBtn: document.getElementById('takePhotoBtn'),
    retakePhotoBtn: document.getElementById('retakePhotoBtn'),
    cameraPreview: document.getElementById('cameraPreview'),
    cameraFeed: document.getElementById('cameraFeed'),
    photoCanvas: document.getElementById('photoCanvas'),
    photoUploadInput: document.getElementById('photoUploadInput'),
    clearSignatureBtn: document.getElementById('clearSignatureBtn'),
    signaturePadWrap: document.getElementById('signaturePad'),
    signatureUploadInput: document.getElementById('signatureUploadInput'),
    toggleSignaturePadBtn: document.getElementById('toggleSignaturePadBtn'),
    signatureMobileGroup: document.getElementById('signatureMobileGroup'),
    signatureUploadGroup: document.getElementById('signatureUploadGroup')
  };

  if (!els.tableBody) return;

  let rawAllocations = [];
  let allocations = [];
  let runs = [];
  let currentFilters = { status: '', run: '', search: '' };
  let cameraStream = null;
  let signaturePad = null;
  let signaturePadEventsBound = false;
  let nativeCaptureActive = false;
  let signaturePadEnabled = false;
  let currentAllocation = null;
  let recipientMeta = new Map();
  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
  const prefersNativeCapture = isMobile;
  let allocationsFetchInFlight = false;
  let allocationsFetchQueued = false;
  let autoRefreshTimer = null;
  let allocationsFetchPromise = null;

  const toastId = 'pickupToast';
  const toastEl = document.getElementById(toastId);
  const toast = toastEl ? bootstrap.Toast.getOrCreateInstance(toastEl, { delay: 3500 }) : null;

  function showToast(msg, variant){
    if (!toastEl) return;
    const body = toastEl.querySelector('.toast-body');
    if (body) body.textContent = msg;
    toastEl.classList.remove('text-bg-success', 'text-bg-danger', 'text-bg-warning');
    toastEl.classList.add(variant === 'error' ? 'text-bg-danger' : variant === 'warn' ? 'text-bg-warning' : 'text-bg-success');
    toast && toast.show();
  }

  async function loadExistingProofAsDataUrl(path, fallbackMime = 'image/png'){
    if (!path) return null;
    const absoluteUrl = new URL(path, window.location.origin).toString();
    try {
      const res = await fetch(absoluteUrl, { credentials: 'include' });
      if (!res.ok) return null;
      const blob = await res.blob();
      return await blobToDataUrl(blob, fallbackMime);
    } catch(err){
      if (DEBUG) console.error('[Pickup] failed to reload proof', err);
      return null;
    }
  }

  function blobToDataUrl(blob, fallbackMime = 'image/png'){
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      const type = blob && blob.type ? blob.type : fallbackMime;
      const wrapped = blob && blob.type ? blob : new File([blob], 'proof', { type });
      reader.readAsDataURL(wrapped);
    });
  }

  function bindSignaturePadEvents(){
    if (!signaturePad || signaturePadEventsBound) return;
    const emitUpdate = () => updateConfirmState();
    const origBegin = signaturePad.onBegin?.bind(signaturePad);
    const origEnd = signaturePad.onEnd?.bind(signaturePad);
    signaturePad.onBegin = (...args) => {
      origBegin && origBegin(...args);
      emitUpdate();
    };
    signaturePad.onEnd = (...args) => {
      origEnd && origEnd(...args);
      emitUpdate();
    };
    signaturePadEventsBound = true;
  }

  function enrichAllocation(row, runId){
    const meta = recipientMeta.get(Number(row.recipient_id)) || {};
    return Object.assign({}, row, {
      run_id: runId ? Number(runId) : (row.run_id ? Number(row.run_id) : null),
      recipient_name: meta.organization_name || meta.display_name || meta.full_name || meta.name || null,
      organization: meta.organization_name || meta.display_name || meta.full_name || meta.name || null
    });
  }

  async function ensureRecipientMeta(){
    if (recipientMeta.size) return;
    try {
      const res = await fetch(`${API_BASE_URL}/users/index.php?action=list&role=recipient&status=approved&t=${Date.now()}`, FETCH_OPTS);
      const j = await res.json().catch(() => null);
      const items = Array.isArray(j?.data?.items) ? j.data.items : [];
      recipientMeta = new Map(items.map(it => [Number(it.user_id || it.id), it]));
    } catch(err){
      if (DEBUG) console.error('[Pickup] recipient meta load failed', err);
      recipientMeta = new Map();
    }
  }

  async function resolveLatestRunId(){
    try {
      if (!runs.length){
        await fetchRuns();
      }
      if (runs.length) {
        return runs[0]?.run_id ? Number(runs[0].run_id) : null;
      }
      const res = await fetch(`${API_BASE_URL}/allocations/index.php?action=latest_run&t=${Date.now()}`, FETCH_OPTS);
      const j = await res.json().catch(() => null);
      if (res.ok && j?.success && j?.data?.run_id){
        return Number(j.data.run_id);
      }
    } catch(err){
      if (DEBUG) console.error('[Pickup] resolve latest run failed', err);
    }
    return null;
  }

  function fmtDateTime(val){
    if (!val) return '—';
    const d = new Date(val);
    if (Number.isNaN(d.getTime())) return String(val);
    return d.toLocaleString();
  }

  function statusBadge(status){
    const st = String(status || '').toLowerCase();
    const map = {
      pending: 'secondary',
      notified: 'info',
      acknowledged: 'warning',
      updated: 'primary',
      scheduled: 'primary',
      'picked up': 'success',
      completed: 'success',
      cancelled: 'dark'
    };
    const cls = map[st] || 'light text-dark';
    return `<span class="badge bg-${cls}">${status || 'Unknown'}</span>`;
  }

  function escapeHtml(str){
    return (str || '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  }
  
  function getFullImagePath(relativePath) {
    if (!relativePath) return '';
    // If it's already a full URL, return as is
    if (relativePath.startsWith('http://') || relativePath.startsWith('https://') || relativePath.startsWith('/')) {
      return relativePath;
    }
    // Otherwise, assume it's a path relative to the site root
    return `/${relativePath.replace(/^\/+/, '')}`;
  }

  function renderAllocations(){
    if (!allocations || !allocations.length){
      if (DEBUG) console.debug('No allocations data or empty array');
      els.tableBody.innerHTML = `<tr><td colspan="6" class="text-center py-5 text-muted">No allocations match the current filters.</td></tr>`;
      return;
    }
    
    if (DEBUG && allocations.length > 0) {
      const firstAlloc = allocations[0];
      console.debug('First allocation object:', JSON.parse(JSON.stringify(firstAlloc)));
      console.debug('All fields in first allocation:', Object.keys(firstAlloc).join(', '));
      const proofFields = Object.keys(firstAlloc).filter(key => 
        key.toLowerCase().includes('photo') || 
        key.toLowerCase().includes('signature') ||
        key.toLowerCase().includes('proof') ||
        key.toLowerCase().includes('image')
      );
      console.debug('Possible proof-related fields:', proofFields);
      proofFields.forEach(field => {
        console.debug(`Field "${field}":`, firstAlloc[field]);
      });
    }
    
    const frag = document.createDocumentFragment();
    allocations.forEach(row => {
      const status = String(row.status || '').toLowerCase();
      const canPickup = status === 'acknowledged';
      const pickupActionVisible = !(status === 'picked up' || status === 'completed');
      const showProofButtons = status === 'picked up' || status === 'completed';
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>
          <div class="fw-semibold">${escapeHtml(row.recipient_name || 'Recipient #' + row.recipient_id)}</div>
          <div class="small text-muted">${escapeHtml(row.organization || '')}</div>
        </td>
        <td>
          ${row.items.length ? `<ul class="list-unstyled mb-0 small">${row.items.map(it => `<li>${escapeHtml(it.item_name)} <span class="text-muted">× ${it.quantity}${it.unit ? ' ' + escapeHtml(it.unit) : ''}</span></li>`).join('')}</ul>` : '<span class="text-muted">No items</span>'}
        </td>
        <td class="text-center">${statusBadge(row.status)}</td>
        <td>${fmtDateTime(row.updated_at || row.created_at)}</td>
        <td class="text-center">
          ${showProofButtons ? `
          <div class="d-flex justify-content-center gap-1">
            <button type="button" class="btn btn-sm btn-outline-secondary js-view-proof" 
              data-type="photo" 
              data-path="${getFullImagePath(row.pickup_photo_path || 'images/placeholder-photo.jpg')}" 
              title="View photo">
              <i class="bi bi-camera"></i>
            </button>
            <button type="button" class="btn btn-sm btn-outline-secondary js-view-proof" 
              data-type="signature" 
              data-path="${getFullImagePath(row.pickup_signature_path || 'images/placeholder-signature.png')}" 
              title="View signature">
              <i class="bi bi-pen"></i>
            </button>
          </div>` : '<span class="text-muted">—</span>'}
        </td>
        <td class="text-center">
          ${pickupActionVisible ? `<button type="button" class="btn btn-outline-primary btn-sm js-open-pickup" data-id="${row.allocation_id}" ${canPickup ? '' : 'disabled title="Pickup is available once recipient acknowledges."'}>
            <i class="bi bi-clipboard-check"></i> Pickup
          </button>` : '<span class="text-muted">—</span>'}
        </td>`;
      frag.appendChild(tr);
    });
    els.tableBody.innerHTML = '';
    els.tableBody.appendChild(frag);
  }

  function applyFilters(raw){
    const status = currentFilters.status.trim().toLowerCase();
    const runId = parseInt(currentFilters.run, 10) || '';
    const term = currentFilters.search.trim().toLowerCase();
    return raw.filter(row => {
      if (status && String(row.status || '').toLowerCase() !== status) return false;
      if (runId && Number(row.run_id) !== runId) return false;
      if (term){
        const hay = [row.recipient_name, row.organization, row.items.map(it => it.item_name).join(' ')].join(' ').toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });
  }

  async function fetchRuns(){
    try {
      const res = await fetch(`${API_BASE_URL}/allocations/index.php?action=list_runs&limit=24&t=${Date.now()}`, FETCH_OPTS);
      const j = await res.json().catch(() => null);
      runs = Array.isArray(j?.data?.items) ? j.data.items : [];
      renderRunFilter();
    } catch(err){
      if (DEBUG) console.error('[Pickup] list_runs failed', err);
    }
  }

  function renderRunFilter(){
    if (!els.runFilter) return;
    const value = els.runFilter.value;
    els.runFilter.innerHTML = '<option value="">Current run</option>' + runs.map(r => `<option value="${r.run_id}">${escapeHtml(r.period_key || ('Run #' + r.run_id))}</option>`).join('');
    if (value) els.runFilter.value = value;
  }

  function scheduleAutoRefresh(){
    if (autoRefreshTimer) {
      clearTimeout(autoRefreshTimer);
      autoRefreshTimer = null;
    }
    autoRefreshTimer = setTimeout(async () => {
      autoRefreshTimer = null;
      if (document.hidden) {
        scheduleAutoRefresh();
        return;
      }
      try {
        await fetchAllocations();
      } catch (err) {
        if (DEBUG) console.error('[Pickup] auto-refresh fetch failed', err);
      }
    }, AUTO_REFRESH_INTERVAL_MS);
  }

  function stopAutoRefresh(){
    if (autoRefreshTimer) {
      clearTimeout(autoRefreshTimer);
      autoRefreshTimer = null;
    }
  }

  async function fetchAllocations(){
    stopAutoRefresh();
    if (allocationsFetchInFlight) {
      allocationsFetchQueued = true;
      return allocationsFetchPromise;
    }

    allocationsFetchInFlight = true;
    allocationsFetchQueued = false;
    if (els.loadingRow) els.loadingRow.style.display = '';
    const runFetch = (async () => {
      try {
      if (DEBUG) console.debug('Fetching allocations...');
      let runId = currentFilters.run;
      if (!runId){
        runId = await resolveLatestRunId();
        if (runId){
          currentFilters.run = String(runId);
          if (els.runFilter && !els.runFilter.value) {
            els.runFilter.value = String(runId);
          }
        }
      }

      if (!runId){
        rawAllocations = [];
        allocations = [];
        renderAllocations();
        showToast('No allocation run found. Generate a run first.', 'warn');
        return;
      }

      await ensureRecipientMeta();

      const params = `run_id=${encodeURIComponent(runId)}`;
      const url = `${API_BASE_URL}/allocations/index.php?action=list_by_run&${params}&t=${Date.now()}`;
      const res = await fetch(url, FETCH_OPTS);
      const j = await res.json().catch(() => null);
      
      if (DEBUG) {
        console.debug('Allocations API response:', JSON.parse(JSON.stringify(j)));
      }
      
      if (!res.ok || !j?.success){
        throw new Error(j?.error || `Request failed (${res.status})`);
      }
      const rows = Array.isArray(j?.data?.items) ? j.data.items : [];
      if (DEBUG) console.debug('Raw API response rows:', rows);
      rawAllocations = rows.map(row => enrichAllocation(row, runId));
      if (DEBUG) console.debug('Enriched allocations:', rawAllocations);
      allocations = applyFilters(rawAllocations);
      if (DEBUG) console.debug('Filtered allocations:', allocations);
      if (DEBUG) {
        window.debugAllocations = allocations;
      } else if (window.debugAllocations) {
        delete window.debugAllocations;
      }
      renderAllocations();
    } catch(err){
      if (DEBUG) console.error('[Pickup] fetch allocations failed', err);
      showToast(err.message || 'Failed to load allocations', 'error');
      rawAllocations = [];
      allocations = [];
      renderAllocations();
    } finally {
      if (els.loadingRow) els.loadingRow.style.display = 'none';
      allocationsFetchInFlight = false;
      allocationsFetchPromise = null;
      if (allocationsFetchQueued) {
        allocationsFetchQueued = false;
        fetchAllocations();
      } else {
        scheduleAutoRefresh();
      }
    }
    })();

    allocationsFetchPromise = runFetch;
    return runFetch;
  }

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      fetchAllocations();
    }
  });

  window.addEventListener('beforeunload', () => {
    stopAutoRefresh();
  });

  function debounce(fn, wait){
    let t;
    return function(){
      const args = arguments;
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), wait);
    };
  }

  function bindFilters(){
    if (els.statusFilter){
      els.statusFilter.addEventListener('change', () => {
        currentFilters.status = els.statusFilter.value || '';
        allocations = applyFilters(rawAllocations);
        renderAllocations();
      });
    }
    if (els.runFilter){
      els.runFilter.addEventListener('change', () => {
        currentFilters.run = els.runFilter.value || '';
        fetchAllocations();
      });
    }
    if (els.searchInput){
      const handler = debounce(() => {
        currentFilters.search = els.searchInput.value || '';
        allocations = applyFilters(rawAllocations);
        renderAllocations();
      }, 200);
      els.searchInput.addEventListener('input', handler);
    }
    if (els.refreshBtn){
      els.refreshBtn.addEventListener('click', () => {
        fetchAllocations();
      });
    }
    if (els.exportBtn){
      els.exportBtn.addEventListener('click', () => exportCsv());
    }
  }

  function exportCsv(){
    const headers = ['Allocation ID','Recipient','Organization','Status','Updated At','Items'];
    const rows = allocations.map(row => [row.allocation_id, row.recipient_name || '', row.organization || '', row.status || '', fmtDateTime(row.updated_at || row.created_at), row.items.map(it => `${it.quantity}x ${it.item_name}`).join('; ')]);
    const csv = [headers].concat(rows).map(r => r.map(cell => '"' + String(cell ?? '').replace(/"/g,'""') + '"').join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `pickup_export_${Date.now()}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  function initTableHandlers(){
    els.tableBody.addEventListener('click', (evt) => {
      const btn = evt.target.closest('button');
      if (!btn) return;
      
      if (DEBUG) {
        console.debug('Button clicked:', btn);
        console.debug('Button classes:', btn.className);
      }
      
      if (btn.classList.contains('js-open-pickup')){
        const id = parseInt(btn.dataset.id, 10);
        const allocation = rawAllocations.find(a => a.allocation_id === id);
        if (allocation) openPickupModal(allocation);
      } else if (btn.classList.contains('js-mark-complete')){
        const id = parseInt(btn.dataset.id, 10);
        markComplete(id);
      } else if (btn.classList.contains('js-view-proof')) {
        if (DEBUG) {
          console.debug('View proof button clicked');
          console.debug('Button dataset:', btn.dataset);
        }
        
        const type = btn.dataset.type;
        const path = btn.dataset.path;
        
        if (DEBUG) {
          console.debug('Type:', type);
          console.debug('Path:', path);
        }
        
        if (!path || path.includes('placeholder-')) {
          showToast(`No ${type} available for this allocation`, 'info');
          return;
        }
        
        if (DEBUG) console.debug('Path exists, trying to show modal');
        const modalEl = document.getElementById('imageViewerModal');
        if (DEBUG) console.debug('Modal element:', modalEl);
        
        if (!modalEl) {
          if (DEBUG) console.error('Modal element not found');
          return;
        }
        
        const modal = new bootstrap.Modal(modalEl);
        const img = document.getElementById('imageViewerImg');
        const title = document.querySelector('#imageViewerModal .modal-title');
        
        if (DEBUG) {
          console.debug('Image element:', img);
          console.debug('Title element:', title);
        }
        
        if (img && title) {
          if (DEBUG) console.debug('Setting image source to:', path);
          
          // Show loading state
          img.src = '';
          img.alt = 'Loading...';
          title.textContent = type === 'photo' ? 'Loading Photo...' : 'Loading Signature...';
          
          // Try to load the image
          const imageLoader = new Image();
          imageLoader.onload = function() {
            if (DEBUG) console.debug('Image loaded successfully');
            img.src = path;
            img.alt = type === 'photo' ? 'Pickup Photo' : 'Recipient Signature';
            title.textContent = type === 'photo' ? 'Pickup Photo' : 'Recipient Signature';
            modal.show();
          };
          
          imageLoader.onerror = function() {
            if (DEBUG) console.error('Error loading image');
            showToast(`Could not load the ${type}. The file may have been moved or deleted.`, 'error');
            return;
          };
          
          imageLoader.src = path;
          
          try {
            modal.show();
            if (DEBUG) console.debug('Modal shown');
          } catch (e) {
            if (DEBUG) console.error('Error showing modal:', e);
            showToast('Could not open the image viewer', 'error');
          }
        } else {
          if (DEBUG) console.error('Image or title element not found');
          showToast('Could not initialize the image viewer', 'error');
        }
      }
    });
  }

  async function markComplete(allocationId){
    if (!window.AllocationsAPI || typeof window.AllocationsAPI.complete !== 'function'){
      showToast('Complete API not available.', 'error');
      return;
    }
    try {
      await window.AllocationsAPI.complete(allocationId);
      showToast('Allocation marked completed.', 'success');
      fetchAllocations();
    } catch(err){
      showToast(err?.message || 'Failed to mark complete', 'error');
    }
  }

  function openPickupModal(allocation){
    currentAllocation = allocation;
    if (!els.pickupModal) return;
    els.pickupRecipientDetails.innerHTML = `
      <div class="fw-semibold">${escapeHtml(allocation.recipient_name || 'Recipient #' + allocation.recipient_id)}</div>
      <div class="text-muted small">${escapeHtml(allocation.organization || '')}</div>
      <div class="text-muted small">Status: ${statusBadge(allocation.status)}</div>`;
    els.pickupItemsList.innerHTML = allocation.items.length
      ? allocation.items.map(it => `<li class="list-group-item d-flex justify-content-between align-items-center">
            <span>${escapeHtml(it.item_name)}</span>
            <span class="text-muted">${it.quantity}${it.unit ? ' ' + escapeHtml(it.unit) : ''}</span>
          </li>`).join('')
      : '<li class="list-group-item text-muted">No items recorded</li>';
    
    // Initialize form state
    els.confirmPickupBtn.disabled = true;
    photoUploadData = null;
    signatureUploadData = null;
    if (els.photoUploadInput) els.photoUploadInput.value = '';
    if (els.signatureUploadInput) els.signatureUploadInput.value = '';
    if (isMobile){
      resetCamera();
    } else {
      resetCamera();
    }
    resetSignaturePad();
    const modal = bootstrap.Modal.getOrCreateInstance(els.pickupModal);
    modal.show();
    updateConfirmState();
  }

  function resetCamera(){
    stopCamera();
    if (els.cameraFeed) els.cameraFeed.style.display = 'none';
    if (els.photoCanvas) els.photoCanvas.style.display = 'none';
    if (els.startCameraBtn) els.startCameraBtn.style.display = '';
    if (els.takePhotoBtn) els.takePhotoBtn.style.display = 'none';
    if (els.retakePhotoBtn) els.retakePhotoBtn.style.display = 'none';
    if (els.downloadPhotoBtn) els.downloadPhotoBtn.style.display = 'none';
  }

  function stopCamera(){
    if (cameraStream){
      cameraStream.getTracks().forEach(track => track.stop());
      cameraStream = null;
    }
  }

  function resetSignaturePad(){
    if (!els.signaturePadWrap) return;
    if (!isMobile){
      signaturePad = null;
      signaturePadEventsBound = false;
      return;
    }
    els.signaturePadWrap.style.height = '220px';
    if (!signaturePad){
      const canvas = document.createElement('canvas');
      canvas.className = 'w-100 h-100';
      els.signaturePadWrap.innerHTML = '';
      els.signaturePadWrap.appendChild(canvas);
      resizeCanvas(canvas);
      signaturePad = new SignaturePad(canvas, { backgroundColor: 'rgba(255,255,255,0)', penColor: '#0d6efd' });
      bindSignaturePadEvents();
    } else {
      const canvas = signaturePad.canvas;
      if (canvas){
        resizeCanvas(canvas);
      }
    }
    signaturePad.clear();
    signaturePadEnabled = false;
    updateSignaturePadUI();
    updateConfirmState();
  }

  function resizeCanvas(canvas){
    const ratio = window.devicePixelRatio || 1;
    canvas.width = canvas.offsetWidth * ratio;
    canvas.height = canvas.offsetHeight * ratio;
    const ctx = canvas.getContext('2d');
    ctx.scale(ratio, ratio);
  }

  function bindPickupModal(){
    if (!els.pickupModal) return;
    els.pickupModal.addEventListener('shown.bs.modal', () => {
      if (signaturePad && signaturePad.canvas) resizeCanvas(signaturePad.canvas);
      updateConfirmState();
    });
    els.clearSignatureBtn?.addEventListener('click', evt => {
      evt.preventDefault();
      signaturePad && signaturePad.clear();
      updateConfirmState();
    });
    // Mobile camera controls
    if (isMobile){
      const mobileGroup = document.getElementById('photoMobileGroup');
      const uploadGroup = document.getElementById('photoUploadGroup');
      if (prefersNativeCapture) {
        nativeCaptureActive = true;
        mobileGroup?.classList.remove('d-none');
        uploadGroup?.classList.add('d-none');
        els.startCameraBtn?.addEventListener('click', evt => {
          evt.preventDefault();
          triggerNativeCapture();
        });
        els.retakePhotoBtn?.addEventListener('click', evt => {
          evt.preventDefault();
          triggerNativeCapture();
        });
        if (els.takePhotoBtn) els.takePhotoBtn.style.display = 'none';
        if (els.retakePhotoBtn) els.retakePhotoBtn.style.display = 'none';
      } else {
        nativeCaptureActive = false;
        uploadGroup?.classList.add('d-none');
        mobileGroup?.classList.remove('d-none');
        els.startCameraBtn?.addEventListener('click', startCamera);
        els.takePhotoBtn?.addEventListener('click', capturePhoto);
        els.retakePhotoBtn?.addEventListener('click', evt => {
          evt.preventDefault();
          resetCamera();
          startCamera(evt);
        });
      }
    } else {
      nativeCaptureActive = false;
      els.startCameraBtn?.addEventListener('click', startCamera);
      els.takePhotoBtn?.addEventListener('click', capturePhoto);
      els.retakePhotoBtn?.addEventListener('click', evt => {
        evt.preventDefault();
        resetCamera();
        startCamera(evt);
      });
    }
    els.confirmPickupBtn.addEventListener('click', submitPickupConfirmation);
    els.pickupModal.addEventListener('hidden.bs.modal', () => {
      stopCamera();
      currentAllocation = null;
    });
  }

  function updateConfirmState(){
    const hasExistingPhoto = !!(currentAllocation && currentAllocation.pickup_photo_path);
    const hasPhotoData = !!photoUploadData || hasExistingPhoto;

    const hasSignaturePad = signaturePad && !signaturePad.isEmpty();
    const hasSignatureUpload = !!signatureUploadData;
    const hasExistingSignature = !!(currentAllocation && currentAllocation.pickup_signature_path);
    const hasSignature = isMobile
      ? (hasSignaturePad || hasExistingSignature)
      : (hasSignatureUpload || hasExistingSignature);

    els.confirmPickupBtn.disabled = !(hasPhotoData && hasSignature);
  }

  function hasCameraPhoto(){
    return !!(els.photoCanvas && els.photoCanvas.style.display !== 'none');
  }

  async function startCamera(evt){
    evt && evt.preventDefault();
    try {
      cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      if (els.cameraFeed){
        els.cameraFeed.srcObject = cameraStream;
        els.cameraFeed.play();
        els.cameraFeed.style.display = 'block';
      }
      if (els.startCameraBtn) els.startCameraBtn.style.display = 'none';
      if (els.takePhotoBtn) els.takePhotoBtn.style.display = '';
      if (els.retakePhotoBtn) els.retakePhotoBtn.style.display = 'none';
      if (els.photoCanvas) els.photoCanvas.style.display = 'none';
      updateConfirmState();
    } catch(err){
      showToast('Camera access denied.', 'error');
      if (DEBUG) console.error('[Pickup] getUserMedia failed', err);
    }
  }

  function capturePhoto(evt){
    evt && evt.preventDefault();
    if (!cameraStream || !els.cameraFeed || !els.photoCanvas) return;
    const video = els.cameraFeed;
    const canvas = els.photoCanvas;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.style.display = 'block';
    els.cameraFeed.style.display = 'none';
    if (els.takePhotoBtn) els.takePhotoBtn.style.display = 'none';
    if (els.retakePhotoBtn) els.retakePhotoBtn.style.display = '';
    photoUploadData = els.photoCanvas?.toDataURL('image/jpeg', 0.85) || null;
    stopCamera();
    updateConfirmState();
  }

  async function submitPickupConfirmation(){
    if (!currentAllocation) return;
    try {
      els.confirmPickupBtn.disabled = true;
      let photoData = photoUploadData;
      let signatureData = isMobile
        ? (signaturePad && !signaturePad.isEmpty() ? signaturePad.toDataURL('image/png') : null)
        : (signatureUploadData || null);

      if (!photoData && currentAllocation?.pickup_photo_path) {
        photoData = await loadExistingProofAsDataUrl(currentAllocation.pickup_photo_path, 'image/jpeg');
      }
      if (!signatureData && currentAllocation?.pickup_signature_path) {
        signatureData = await loadExistingProofAsDataUrl(currentAllocation.pickup_signature_path, 'image/png');
      }
      const payload = {
        allocation_id: currentAllocation.allocation_id,
        photo_base64: photoData,
        signature_base64: signatureData,
        confirm_text: 'Recipient confirmed pickup'
      };
      const res = await fetch(`${API_BASE_URL}/allocations/index.php?action=confirm_pickup`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload)
      });
      const j = await res.json().catch(() => null);
      if (!res.ok || !j?.success){
        throw new Error(j?.error || `Failed (${res.status})`);
      }
      showToast('Pickup recorded successfully!', 'success');
      bootstrap.Modal.getInstance(els.pickupModal)?.hide();
      fetchAllocations();
    } catch(err){
      showToast(err?.message || 'Failed to confirm pickup', 'error');
      els.confirmPickupBtn.disabled = false;
    }
  }

  function triggerNativeCapture(){
    const input = els.photoUploadInput;
    if (!input) return;
    input.value = '';
    input.setAttribute('accept', 'image/*');
    input.setAttribute('capture', 'environment');
    const uploadGroup = document.getElementById('photoUploadGroup');
    const wasHidden = uploadGroup && uploadGroup.classList.contains('d-none');
    if (wasHidden) uploadGroup.classList.remove('d-none');
    nativeCaptureActive = true;
    input.click();
    // Re-hide immediately after triggering chooser to keep UI clean
    if (wasHidden) {
      setTimeout(() => uploadGroup.classList.add('d-none'), 0);
    }
  }

  function renderUploadedPhoto(dataUrl){
    if (!els.photoCanvas) return;
    const img = new Image();
    img.onload = () => {
      const canvas = els.photoCanvas;
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      canvas.style.display = 'block';
      if (els.cameraFeed) els.cameraFeed.style.display = 'none';
      if (els.startCameraBtn) els.startCameraBtn.style.display = 'none';
      if (els.retakePhotoBtn) els.retakePhotoBtn.style.display = 'inline-flex';
    };
    img.src = dataUrl;
  }

  function handleUploadInputs(){
    const photoUploadGroup = document.getElementById('photoUploadGroup');
    const photoMobileGroup = document.getElementById('photoMobileGroup');
    const signatureMobileGroup = document.getElementById('signatureMobileGroup');
    const signatureUploadGroup = document.getElementById('signatureUploadGroup');
    const photoUploadInput = els.photoUploadInput;
    const signatureUploadInput = els.signatureUploadInput;

    if (!isMobile){
      photoMobileGroup?.classList.add('d-none');
      photoUploadGroup?.classList.remove('d-none');
      signatureMobileGroup?.classList.add('d-none');
      signatureUploadGroup?.classList.remove('d-none');
    } else {
      signatureMobileGroup?.classList.remove('d-none');
      signatureUploadGroup?.classList.add('d-none');
      if (!prefersNativeCapture){
        photoMobileGroup?.classList.remove('d-none');
        photoUploadGroup?.classList.add('d-none');
      }
    }

    if (photoUploadInput){
      photoUploadInput.addEventListener('change', handlePhotoUploadChange);
    }
    if (signatureUploadInput){
      signatureUploadInput.addEventListener('change', handleSignatureUploadChange);
    }

    els.toggleSignaturePadBtn?.addEventListener('click', toggleSignaturePad);
    updateSignaturePadUI();
  }

  async function handlePhotoUploadChange(evt){
    const input = evt?.target;
    if (!input || !input.files || !input.files.length){
      photoUploadData = null;
      updateConfirmState();
      return;
    }
    const file = input.files[0];
    if (!validateUpload(file)){
      input.value = '';
      photoUploadData = null;
      updateConfirmState();
      return;
    }
    photoUploadData = await toDataUrl(file, file.type || 'image/jpeg');
    renderUploadedPhoto(photoUploadData);
    updateConfirmState();
  }

  async function handleSignatureUploadChange(evt){
    const input = evt?.target;
    if (!input || !input.files || !input.files.length){
      signatureUploadData = null;
      updateConfirmState();
      return;
    }
    const file = input.files[0];
    if (!validateUpload(file)){
      input.value = '';
      signatureUploadData = null;
      updateConfirmState();
      return;
    }
    signatureUploadData = await toDataUrl(file, file.type || 'image/png');
    updateConfirmState();
  }

  function toggleSignaturePad(){
    signaturePadEnabled = !signaturePadEnabled;
    updateSignaturePadUI();
    updateConfirmState();
  }

  function updateSignaturePadUI(){
    const button = els.toggleSignaturePadBtn;
    if (button){
      button.innerHTML = signaturePadEnabled
        ? '<i class="bi bi-lock"></i> Lock Pad'
        : '<i class="bi bi-unlock"></i> Unlock Pad';
    }
    if (els.signaturePadWrap){
      els.signaturePadWrap.classList.toggle('opacity-50', !signaturePadEnabled);
      els.signaturePadWrap.classList.toggle('pe-none', !signaturePadEnabled);
      els.signaturePadWrap.classList.toggle('user-select-none', !signaturePadEnabled);
    }
    if (els.clearSignatureBtn){
      els.clearSignatureBtn.disabled = !signaturePadEnabled;
    }
    if (signaturePadEnabled){
      bindSignaturePadEvents();
    }
  }

  function validateUpload(file){
    const maxBytes = 10 * 1024 * 1024;
    if (!/^image\//i.test(file.type)){
      showToast('Only image files are allowed.', 'error');
      return false;
    }
    if (file.size > maxBytes){
      showToast('Image must be 10MB or smaller.', 'error');
      return false;
    }
    return true;
  }

  function toDataUrl(file, fallbackMime){
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    }).catch(err => {
      if (DEBUG) console.error('[Pickup] file read failed', err);
      showToast('Failed to read image.', 'error');
      return null;
    });
  }

  let photoUploadData = null;
  let signatureUploadData = null;

  function init(){
    bindFilters();
    initTableHandlers();
    bindPickupModal();
    handleUploadInputs();
    fetchRuns();
    fetchAllocations();
  }

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) fetchAllocations();
  });

  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
