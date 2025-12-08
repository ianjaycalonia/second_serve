(function(){
  'use strict';

  const API_BASE_URL = (typeof window.API_BASE_URL === 'string' && window.API_BASE_URL)
    ? window.API_BASE_URL
    : '/php/api';

  const qs = (s, r=document)=> r.querySelector(s);

  function getUser(){
    try {
      if (window.__SESSION_USER && typeof window.__SESSION_USER === 'object') {
        return window.__SESSION_USER;
      }

    } catch(_) { /* ignore */ }
    try {
      const s = sessionStorage.getItem('user');
      return s ? JSON.parse(s) : null;
    } catch(_) {
      return null;
    }
  }

  function updateSelectedListActive(){
    const listEl = qs('#selectedDayList');
    if (!listEl) return;
    listEl.querySelectorAll('.selected-day-item').forEach(item=>{
      const idNum = Number(item.dataset.eventId);
      item.classList.toggle('active', Number.isFinite(selectedEventId) && idNum === selectedEventId);
    });
  }

  function getSelectedEventData(){
    if (!selectedDayEvents || !selectedDayEvents.length) return null;
    if (Number.isFinite(selectedEventId)){
      const found = selectedDayEvents.find(ev => Number(ev.id) === selectedEventId);
      if (found) return found;
    }
    return null;
  }

  function toDatetimeLocal(value){
    try{
      const d = (value instanceof Date) ? value : new Date(value);
      if (isNaN(d)) return '';
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth()+1).padStart(2,'0');
      const dd = String(d.getDate()).padStart(2,'0');
      const hh = String(d.getHours()).padStart(2,'0');
      const mi = String(d.getMinutes()).padStart(2,'0');
      return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
    } catch(_) { return ''; }
  }
  function formatDateInput(date){
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
    return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  }
  function formatTimeInput(date){
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
    return `${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}`;
  }
  function role(){ return ((getUser()?.role)||'').toLowerCase(); }
  function userId(){
    const raw = getUser();
    const candidates = [raw?.user_id, raw?.id, raw?.userId, raw?.account_id];
    for (const value of candidates){
      const n = Number(value);
      if (Number.isFinite(n) && n > 0) return n;
    }
    return 0;
  }
  function currentUserOrganization(){
    const user = getUser();
    if (!user) return '';
    return user.organization_name || user.org_name || user.display_name || user.name || user.email || '';
  }
  function toNumber(value){
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  function defaultTypeForCurrentRole(){
    const r = role();
    if (r === 'donor') return 'donor';
    if (r === 'recipient') return 'recipient';
    return 'admin';
  }
  function recipientStatus(){
    const user = getUser();
    const raw = user?.recipient_status ?? user?.status ?? '';
    return String(raw || '').toLowerCase();
  }
  function recipientEligibleForScheduling(){
    if (role() !== 'recipient') return true;
    try {
      // Prefer authoritative state from Schedule UI if available
      if (typeof window.ensureRecipientSchedulingEligibility === 'function') {
        // Trigger async check (non-blocking)
        try { window.ensureRecipientSchedulingEligibility(); } catch(_){}
        if (typeof window.getRecipientSchedulingEligibility === 'function') {
          const state = window.getRecipientSchedulingEligibility();
          if (state && state.checked) return !!state.eligible;
          // Not yet checked – allow until verified by Schedule UI
          return true;
        }
        // No state getter – allow optimistically; Schedule UI will disable if needed
        return true;
      }
    } catch(_){}
    // Fallback to basic status heuristic if Schedule UI not present
    const status = recipientStatus();
    if (!status) return true; // default allow to avoid blocking valid recipients
    return ['acknowledged'].includes(status);
  }
  function recipientEligibilityMessage(){
    if (typeof window.recipientEligibilityMessage === 'function') {
      try { return window.recipientEligibilityMessage(); } catch(_){}
    }
    return 'Only recipients with an allocation scheduled for this week can create pickup events. Please contact support if you believe this is an error.';
  }
  function normalizeEventData(raw, fallbackType){
    const data = raw ? { ...raw } : {};
    const userDefault = fallbackType || defaultTypeForCurrentRole();
    let type = String(data.event_type || data.role_type || '').toLowerCase();
    const donorId = toNumber(data.donor_id ?? data.donor_user_id ?? data.partner_id);
    const recipientId = toNumber(data.recipient_id ?? data.recipient_user_id ?? data.beneficiary_id);
    if (!type){
      if (recipientId) type = 'recipient';
      else if (donorId) type = 'donor';
      else type = userDefault;
    }
    const createdBy = toNumber(data.created_by_user_id ?? data.created_by ?? data.created_by_id ?? data.owner_id ?? data.user_id);
    let createdFor = toNumber(
      data.created_for_user_id ??
      data.created_for ??
      data.target_user_id ??
      (type === 'donor' ? (data.donor_user_id ?? data.donor_owner_id ?? data.donor_id) : null) ??
      (type === 'recipient' ? (data.recipient_user_id ?? data.recipient_owner_id ?? data.recipient_id) : null)
    );
    const idCandidate = data.id ?? data.event_id;
    const idNumeric = toNumber(idCandidate);
    data.id = idNumeric ?? (idCandidate ?? null);
    data.event_type = type;
    data.created_by_user_id = createdBy ?? null;
    data.created_for_user_id = createdFor ?? null;
    data.donor_id = donorId ?? null;
    data.recipient_id = recipientId ?? null;
    return data;
  }
  function eventIsForCurrentUser(eventData){
    const uid = userId();
    if (!uid) return false;
    return [
      eventData.created_by_user_id,
      eventData.created_for_user_id,
      eventData.donor_id,
      eventData.recipient_id
    ].some(id => Number(id) === uid);
  }

  function escapeHtml(value){
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  let recipientQueue = [];
  let lastViewedEvent = null;
  let lastSelectedDate = null;
  let selectedDayEvents = [];
  let selectedEventId = null;
  let calendarInstance = null;
  let resizeRaf = null;
  let cachedCalendarItems = [];
  let lastRangeInfo = null;
  let rangeRequestId = 0;

  function hasContent(value){
    if (value === null || value === undefined) return false;
    if (typeof value === 'string') return value.trim() !== '';
    if (typeof value === 'number') return Number.isFinite(value);
    if (Array.isArray(value)) return value.length > 0;
    if (value instanceof Date) return !Number.isNaN(value.getTime());
    if (typeof value === 'object') return Object.keys(value).length > 0;
    return false;
  }

  function formatDateTime(value){
    if (!value) return '—';
    try {
      const d = value instanceof Date ? value : new Date(value);
      if (Number.isNaN(d.getTime())) return '—';
      return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
    } catch(_){ return '—'; }
  }

  function getDateKey(value){
    if (!value) return null;
    if (typeof value === 'string' && value.length >= 10) return value.slice(0,10);
    try {
      const d = new Date(value);
      if (Number.isNaN(d.getTime())) return null;
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth()+1).padStart(2,'0');
      const dd = String(d.getDate()).padStart(2,'0');
      return `${yyyy}-${mm}-${dd}`;
    } catch(_){ return null; }
  }

  function clearViewModal(){
    const map = {
      '#viewEventTitle': '—',
      '#viewEventType': '—',
      '#viewEventStatus': '',
      '#viewEventStart': '—',
      '#viewEventEnd': '—',
      '#viewEventRecipients': '—',
      '#viewEventDonor': '—',
      '#viewEventLocation': '—',
      '#viewEventNotes': '—',
      '#viewEventCreatedBy': '—',
      '#viewEventUpdated': '—'
    };
    Object.entries(map).forEach(([sel,val])=>{ const el = qs(sel); if (el) el.textContent = val; });
  }

  function resetViewRows(){
    document.querySelectorAll('[data-view-row]').forEach(node=>{
      const def = node.getAttribute('data-default-label');
      if (def && node.hasAttribute('data-view-label')) node.textContent = def;
      node.classList.remove('d-none');
    });
  }

  function setViewRowVisibility(key, visible, label){
    const nodes = document.querySelectorAll(`[data-view-row="${key}"]`);
    nodes.forEach(node=>{
      if (label && node.hasAttribute('data-view-label')) node.textContent = label;
      node.classList.toggle('d-none', !visible);
    });
  }

  function formatTime(value){
    if (!value) return '—';
    try {
      const d = value instanceof Date ? value : new Date(value);
      if (Number.isNaN(d.getTime())) return '—';
      return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    } catch(_){ return '—'; }
  }

  function populateViewModal(eventData){
    clearViewModal();
    resetViewRows();
    const data = normalizeEventData(eventData || {});
    if (hasContent(data.title)) qs('#viewEventTitle').textContent = data.title;
    if (hasContent(data.event_type)) qs('#viewEventType').textContent = data.event_type;
    if (hasContent(data.status)) qs('#viewEventStatus').textContent = data.status;
    qs('#viewEventStart').textContent = formatDateTime(data.start);
    if (hasContent(data.end)) {
      qs('#viewEventEnd').textContent = formatDateTime(data.end);
    } else {
      qs('#viewEventEnd').textContent = '—';
    }
    const recipientsEl = qs('#viewEventRecipients');
    const recNames = [];
    if (Array.isArray(data.recipients) && data.recipients.length){
      data.recipients.forEach(r=>{ if (hasContent(r.display_name || r.name)) recNames.push(r.display_name || r.name); });
    }
    if (!recNames.length && hasContent(data.recipient_display || data.recipient_name)) recNames.push(data.recipient_display || data.recipient_name);
    if (recNames.length > 1){
      const list = document.createElement('ul');
      list.className = 'mb-0';
      recNames.forEach(name=>{
        const li = document.createElement('li');
        li.textContent = name;
        list.appendChild(li);
      });
      recipientsEl.textContent = '';
      recipientsEl.appendChild(list);
    } else {
      recipientsEl.textContent = recNames.length ? recNames[0] : '—';
    }
    qs('#viewEventDonor').textContent = hasContent(data.donor_display || data.donor_name) ? (data.donor_display || data.donor_name) : '—';
    qs('#viewEventLocation').textContent = hasContent(data.location) ? data.location : '—';
    qs('#viewEventNotes').textContent = hasContent(data.notes) ? data.notes : '—';
    const createdLabel = data.created_by_display || data.created_by_name || data.created_by_user_name || data.created_by_email;
    qs('#viewEventCreatedBy').textContent = hasContent(createdLabel) ? createdLabel : '—';
    qs('#viewEventUpdated').textContent = hasContent(data.updated_at) ? formatDateTime(data.updated_at) : '—';

    const type = (data.event_type || '').toLowerCase();
    if (type === 'recipient'){
      // For recipient pickups, show only time and recipients
      setViewRowVisibility('start', true, 'Time');
      qs('#viewEventStart').textContent = formatTime(data.start);
      setViewRowVisibility('end', false);
      setViewRowVisibility('donor', false);
      setViewRowVisibility('location', false);
      setViewRowVisibility('notes', false);
      setViewRowVisibility('created', false);
      setViewRowVisibility('updated', false);
    } else {
      setViewRowVisibility('start', true);
      const isPickup = type === 'donor' || type === 'recipient';
      setViewRowVisibility('end', Boolean(!isPickup && hasContent(data.end)));
      setViewRowVisibility('recipients', Boolean(!isPickup && hasContent(data.recipients) && data.recipients.length > 0));
      setViewRowVisibility('location', true);
      setViewRowVisibility('notes', true);
      setViewRowVisibility('created', true);
      setViewRowVisibility('updated', true);
    }

    lastViewedEvent = data;
  }

  function updateEditButtonState(){
    const btn = qs('#editEventBtn');
    if (!btn) return;
    let candidate = null;
    // Prefer the currently selected event in the list/day over any stale lastViewedEvent
    const sel = getSelectedEventData();
    if (sel && canEditEvent(sel)) candidate = sel;
    if (!candidate && lastViewedEvent && canEditEvent(lastViewedEvent)) candidate = lastViewedEvent;
    btn.disabled = !candidate;
    if (!candidate) {
      btn.title = 'Select an event you can edit';
      btn.dataset.eventId = '';
    } else {
      btn.removeAttribute('title');
      btn.dataset.eventId = candidate.id ?? '';
    }
  }

  function showViewModal(eventData){
    populateViewModal(eventData);
    const dateKey = getDateKey(eventData?.start);
    if (dateKey && dateKey === lastSelectedDate){
      const idNum = Number(eventData?.id);
      if (Number.isFinite(idNum)) selectedEventId = idNum;
      updateSelectedListActive();
    }
    updateEditButtonState();
    const modalEl = document.getElementById('eventViewModal');
    if (!modalEl) return;
    const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
    modal.show();
  }

  function renderSelectedDay(dateStr, events){
    const dateEl = qs('#selectedDayDate');
    const listEl = qs('#selectedDayList');
    selectedDayEvents = Array.isArray(events) ? events : [];
    if (dateEl){
      dateEl.textContent = dateStr ? new Date(dateStr).toDateString() : 'Select a date';
    }
    if (!listEl) return;
    listEl.innerHTML = '';
    if (!selectedDayEvents.length){
      selectedEventId = null;
      listEl.innerHTML = '<li class="list-group-item text-center text-muted py-3">No events scheduled for this day.</li>';
      updateEditButtonState();
      return;
    }
    const availableIds = selectedDayEvents.map(ev => Number(ev.id)).filter(Number.isFinite);
    if (!availableIds.includes(selectedEventId)){
      selectedEventId = availableIds.length ? availableIds[0] : null;
    }
    selectedDayEvents.forEach(ev=>{
      const item = document.createElement('li');
      const idNum = Number(ev.id);
      item.className = 'list-group-item selected-day-item' + (idNum === selectedEventId ? ' active' : '');
      item.dataset.eventId = String(ev.id);
      const startStr = new Date(ev.start).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
      const endStr = ev.end ? new Date(ev.end).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : '';
      const roleBadge = role()==='admin' ? `<span class="badge ${ev.event_type==='donor'?'bg-primary':ev.event_type==='recipient'?'bg-success':'bg-warning text-dark'} ms-2">${ev.event_type}</span>` : '';
      let targetName = '';
      if (ev.event_type === 'recipient') {
        if (Array.isArray(ev.recipients) && ev.recipients.length) {
          const names = ev.recipients.map(r => r?.display_name || r?.name || r?.text).filter(Boolean);
          targetName = names.join(', ');
        } else if (ev.recipient_name || ev.recipient_org || ev.recipient_display) {
          targetName = ev.recipient_name || ev.recipient_org || ev.recipient_display;
        } else if (ev.recipient_id) {
          targetName = `Recipient #${ev.recipient_id}`;
        }
      } else if (ev.event_type === 'donor') {
        targetName = ev.donor_display || ev.donor_name || ev.donor_org || (ev.donor_id ? `Donor #${ev.donor_id}` : '');
      } else {
        if (Array.isArray(ev.recipients) && ev.recipients.length) {
          const names = ev.recipients.map(r => r?.display_name || r?.name || r?.text).filter(Boolean);
          targetName = names.join(', ');
        } else if (ev.donor_display || ev.donor_name || ev.donor_org) {
          targetName = ev.donor_display || ev.donor_name || ev.donor_org;
        }
      }
      const targetLine = targetName ? `<div class="small text-muted">${escapeHtml(targetName)}</div>` : '';
      item.innerHTML = `
        <div class="d-flex justify-content-between align-items-start gap-2">
          <div class="flex-grow-1">
            <div class="fw-semibold">${escapeHtml(ev.title||'Event')}${roleBadge}</div>
            <div class="small text-muted">${startStr}${endStr?(' - '+endStr):''}</div>
            ${targetLine}
          </div>
          <div>
            <button type="button" class="btn btn-sm btn-outline-secondary selected-day-open" data-event-id="${ev.id}">View</button>
          </div>
        </div>`;
      listEl.appendChild(item);
    });
    updateSelectedListActive();
    updateEditButtonState();
  }

  function filterEventsForDate(items, dateStr){
    if (!dateStr) return [];
    const dayStart = new Date(`${dateStr}T00:00:00`);
    const dayEnd = new Date(`${dateStr}T23:59:59`);
    return items
      .map(normalizeEventData)
      .filter(ev => {
        if (!canViewEvent(ev)) return false;
        const start = new Date(ev.start);
        if (Number.isNaN(start)) return false;
        const end = ev.end ? new Date(ev.end) : start;
        return start <= dayEnd && end >= dayStart;
      });
  }

  function renderDateFromCache(dateStr){
    if (!dateStr) return;
    const items = filterEventsForDate(cachedCalendarItems, dateStr);
    renderSelectedDay(dateStr, items);
  }

  function rerenderSelectedDayFromCache(){
    if (!lastSelectedDate) return;
    renderDateFromCache(lastSelectedDate);
    highlightSelectedDate(lastSelectedDate);
  }

  function highlightSelectedDate(dateStr){
    if (!dateStr) return;
    try {
      document.querySelectorAll('.fc-daygrid-day').forEach(el=> el.classList.remove('selected-day'));
      const target = document.querySelector(`.fc-daygrid-day[data-date="${dateStr}"]`);
      if (target) target.classList.add('selected-day');
    } catch(_){ }
  }

  function queueCalendarResize(){
    if (!calendarInstance) return;
    if (resizeRaf) return;
    resizeRaf = window.requestAnimationFrame(()=>{
      resizeRaf = null;
      try { calendarInstance.updateSize(); } catch(_){ }
    });
  }

  function resetRecipientQueue(initial, syncHidden = true){
    if (Array.isArray(initial) && initial.length){
      const seen = new Set();
      recipientQueue = initial.reduce((acc, raw)=>{
        const idNum = Number(raw?.id || raw?.recipient_id);
        if (!Number.isFinite(idNum) || idNum <= 0 || seen.has(idNum)) return acc;
        seen.add(idNum);
        let text = raw?.text || raw?.label || raw?.display_name || raw?.name || '';
        if (!text){ text = `Recipient #${idNum}`; }
        acc.push({ id: idNum, text });
        return acc;
      }, []);
    } else {
      recipientQueue = [];
    }
    renderRecipientTags();
    if (syncHidden) syncRecipientHiddenFromQueue();
  }

  function getRecipientQueueIds(){
    return recipientQueue.map(r => r.id);
  }

  function addRecipientToQueue(item){
    if (!item || !item.id) return false;
    const idNum = Number(item.id);
    if (!Number.isFinite(idNum) || idNum <= 0) return false;
    if (recipientQueue.some(r => r.id === idNum)) return false;
    recipientQueue.push({ id: idNum, text: item.text || `Recipient #${idNum}` });
    renderRecipientTags();
    syncRecipientHiddenFromQueue();
    return true;
  }

  function removeRecipientFromQueue(id){
    const idNum = Number(id);
    if (!Number.isFinite(idNum)) return;
    const before = recipientQueue.length;
    recipientQueue = recipientQueue.filter(r => r.id !== idNum);
    if (recipientQueue.length !== before){
      renderRecipientTags();
      syncRecipientHiddenFromQueue();
    }
  }

  function renderRecipientTags(){
    const container = qs('#evRecipientTags');
    if (!container) return;
    if (!recipientQueue.length){
      container.innerHTML = '<span class="text-muted">No recipients added.</span>';
      return;
    }
    const chips = recipientQueue.map(r => (
      `<span class="badge text-bg-primary d-inline-flex align-items-center me-2 mb-2" data-recipient-chip="${r.id}">${escapeHtml(r.text)}<button type="button" class="btn-close btn-close-white btn-sm ms-2" aria-label="Remove" data-remove-recipient="${r.id}"></button></span>`
    ));
    container.innerHTML = chips.join('');
  }

  function syncRecipientHiddenFromQueue(){
    const hidden = qs('#evRecipient');
    if (!hidden) return;
    if (recipientQueue.length){
      hidden.value = String(recipientQueue[0].id);
      return;
    }
    const select = qs('#evRecipientSelect');
    if (!select){ hidden.value = ''; return; }
    let val = select.value;
    if (!val && typeof window.$ === 'function' && $(select).select2){
      val = $(select).val();
    }
    hidden.value = val ? String(val) : '';
  }

  function addRecipientFromCurrentSelection(){
    const select = qs('#evRecipientSelect');
    if (!select) return false;
    let val = select.value;
    if (!val && typeof window.$ === 'function' && $(select).select2){
      val = $(select).val();
    }
    const idNum = Number(val);
    if (!Number.isFinite(idNum) || idNum <= 0) return false;
    let text = '';
    if (typeof window.$ === 'function' && $(select).select2){
      const data = $(select).select2('data');
      if (Array.isArray(data) && data[0]){
        text = data[0].text || data[0].id || '';
        if (data[0].address) applyLocationFromAddress(data[0].address);
        rememberOptionAddress(select, idNum, data[0].address);
      }
    }
    if (!text){
      const opt = select.options && select.selectedIndex >= 0 ? select.options[select.selectedIndex] : null;
      text = opt ? opt.text : '';
      if (opt && opt.dataset?.address) applyLocationFromAddress(opt.dataset.address);
    }
    const added = addRecipientToQueue({ id: idNum, text });
    if (added){
      if (typeof window.$ === 'function' && $(select).select2){
        $(select).val(null).trigger('change');
      } else {
        select.value = '';
      }
    }
    return added;
  }
  function canCreateEvents(){
    const r = role();
    if (r === 'recipient') return recipientEligibleForScheduling();
    return r === 'admin' || r === 'donor';
  }
  function canCreateEventOfType(type){
    const r = role();
    if (r === 'admin') return true;
    if (r === 'donor') return type === 'donor';
    if (r === 'recipient') return type === 'recipient' && recipientEligibleForScheduling();
    return false;
  }
  function canViewEvent(eventData){
    const r = role();
    if (r === 'admin') return true;
    if (r === 'donor') return eventData.event_type === 'admin' || eventData.event_type === 'donor';
    if (r === 'recipient') return eventData.event_type === 'admin' || eventData.event_type === 'recipient';
    return false;
  }
  function canEditEvent(eventData){
    const r = role();
    if (r === 'admin') return true;
    const involved = eventIsForCurrentUser(eventData);
    if (!involved) return false;
    if (r === 'donor') return eventData.event_type === 'donor' || eventData.event_type === 'admin';
    if (r === 'recipient') return eventData.event_type === 'recipient' || eventData.event_type === 'admin';
    return false;
  }

  function calendarToast(message, variant = 'info'){
    const containerId = 'calendarToastContainer';
    let container = document.getElementById(containerId);
    if (!container){
      container = document.createElement('div');
      container.id = containerId;
      container.className = 'toast-container position-fixed top-0 end-0 p-3';
      container.style.zIndex = '2000';
      document.body.appendChild(container);
    }
    const toastEl = document.createElement('div');
    toastEl.className = `toast align-items-center text-bg-${variant === 'error' ? 'danger' : variant === 'success' ? 'success' : variant === 'warn' ? 'warning' : 'secondary'} border-0`;
    toastEl.setAttribute('role', 'alert');
    toastEl.setAttribute('aria-live', 'assertive');
    toastEl.setAttribute('aria-atomic', 'true');
    toastEl.innerHTML = `
      <div class="d-flex">
        <div class="toast-body">${escapeHtml(String(message || ''))}</div>
        <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button>
      </div>`;
    container.appendChild(toastEl);
    try {
      const toast = bootstrap.Toast.getOrCreateInstance(toastEl, { delay: 4000, autohide: true });
      toast.show();
      toastEl.addEventListener('hidden.bs.toast', () => toastEl.remove(), { once: true });
    } catch(_){
      // Fallback: simple alert
      alert(String(message || ''));
    }
  }

  // Small helper to show a confirm modal (Bootstrap) and resolve true/false
  function confirmModal(opts){
    const o = Object.assign({ title: 'Confirm', message: 'Are you sure?', confirmText: 'Confirm', confirmClass: 'btn-primary' }, opts||{});
    return new Promise(resolve => {
      const id = 'calConfirm'+Date.now();
      const wrapper = document.createElement('div');
      wrapper.innerHTML = `
        <div class="modal fade" id="${id}" tabindex="-1" aria-hidden="true">
          <div class="modal-dialog">
            <div class="modal-content">
              <div class="modal-header">
                <h5 class="modal-title">${escapeHtml(o.title)}</h5>
                <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
              </div>
              <div class="modal-body">${escapeHtml(o.message)}</div>
              <div class="modal-footer">
                <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
                <button type="button" class="btn ${o.confirmClass}" data-confirm="1">${escapeHtml(o.confirmText)}</button>
              </div>
            </div>
          </div>
        </div>`;
      const el = wrapper.firstElementChild;
      document.body.appendChild(el);
      const modal = bootstrap.Modal.getOrCreateInstance(el);
      const onHide = ()=>{ el.removeEventListener('hidden.bs.modal', onHide); el.remove(); resolve(false); };
      el.addEventListener('hidden.bs.modal', onHide, { once: true });
      const okBtn = el.querySelector('[data-confirm]');
      if (okBtn){ okBtn.addEventListener('click', ()=>{ resolve(true); modal.hide(); }, { once: true }); }
      modal.show();
    });
  }

  async function parseJsonSafe(res){
    const txt = await res.text();
    if (!txt) return { ok: true, data: { success: true }, raw: '' };
    try { return { ok: true, data: JSON.parse(txt), raw: txt }; }
    catch(_) { return { ok: false, data: null, raw: txt }; }
  }
  async function listEvents(startIso, endIso){
    // Prefer shared API module if available
    try{
      if (window.ScheduleAPI && typeof window.ScheduleAPI.list === 'function'){
        const j = await window.ScheduleAPI.list(startIso, endIso);
        return Array.isArray(j?.data?.items) ? j.data.items : [];
      }
    }catch(_){ /* fall through to legacy fetch */ }
    const url = `${API_BASE_URL}/schedule/index.php?action=list&start=${encodeURIComponent(startIso)}&end=${encodeURIComponent(endIso)}&t=${Date.now()}`;
    const res = await fetch(url, { credentials:'include', headers:{ 'Accept':'application/json' } });
    const parsed = await parseJsonSafe(res);
    const j = parsed.ok ? parsed.data : null;
    if (!res.ok) throw new Error((j && j.error) || `HTTP ${res.status}`);
    if (!j || j.success !== true) throw new Error((j && j.error) || (parsed.ok ? 'Unexpected response' : 'Failed to parse server response'));
    return Array.isArray(j?.data?.items) ? j.data.items : [];
  }
  async function createEvent(payload){
    try{
      if (window.ScheduleAPI && typeof window.ScheduleAPI.create === 'function'){
        const j = await window.ScheduleAPI.create(payload);
        if (j?.success === false) throw new Error(j?.error || 'Create failed');
        return j?.data || j;
      }
    }catch(_){ /* fallback */ }
    const res = await fetch(`${API_BASE_URL}/schedule/index.php?action=create`, { method:'POST', credentials:'include', headers:{'Content-Type':'application/json','Accept':'application/json'}, body: JSON.stringify(payload) });
    const parsed = await parseJsonSafe(res);
    const j = parsed.ok ? parsed.data : null;
    if (!res.ok) throw new Error((j && j.error) || `HTTP ${res.status}`);
    if (!j || j.success !== true) throw new Error((j && j.error) || (parsed.ok ? 'Unexpected response' : 'Failed to parse server response'));
    return j?.data;
  }
  async function updateEvent(id, payload){
    try{
      if (window.ScheduleAPI && typeof window.ScheduleAPI.update === 'function'){
        const j = await window.ScheduleAPI.update(id, payload);
        if (j?.success === false) throw new Error(j?.error || 'Update failed');
        return j?.data || j;
      }
    }catch(_){ /* fallback */ }
    const res = await fetch(`${API_BASE_URL}/schedule/index.php?action=update&id=${encodeURIComponent(id)}`, { method:'PATCH', credentials:'include', headers:{'Content-Type':'application/json','Accept':'application/json'}, body: JSON.stringify(payload) });
    const parsed = await parseJsonSafe(res);
    const j = parsed.ok ? parsed.data : null;
    if (!res.ok) throw new Error((j && j.error) || `HTTP ${res.status}`);
    if (!j || j.success !== true) throw new Error((j && j.error) || (parsed.ok ? 'Unexpected response' : 'Failed to parse server response'));
    return j?.data;
  }
  async function deleteEvent(id){
    try{
      if (window.ScheduleAPI && typeof window.ScheduleAPI.remove === 'function'){
        const j = await window.ScheduleAPI.remove(id);
        if (j?.success === false) throw new Error(j?.error || 'Delete failed');
        return true;
      }
    }catch(_){ /* fallback */ }
    const res = await fetch(`${API_BASE_URL}/schedule/index.php?action=delete&id=${encodeURIComponent(id)}`, { method:'DELETE', credentials:'include', headers:{'Accept':'application/json'} });
    const parsed = await parseJsonSafe(res);
    const j = parsed.ok ? parsed.data : null;
    if (!res.ok) throw new Error((j && j.error) || `HTTP ${res.status}`);
    if (!j || j.success !== true) throw new Error((j && j.error) || (parsed.ok ? 'Unexpected response' : 'Failed to parse server response'));
    return true;
  }

  function openModal(data){
    if (role() === 'recipient' && !recipientEligibleForScheduling()){
      calendarToast(recipientEligibilityMessage(), 'warn');
      return;
    }
    const mEl = qs('#eventModal'); if (!mEl) return;
    const m = bootstrap.Modal.getOrCreateInstance(mEl);
    // Reset modal to a clean baseline to avoid leakage from previous event
    try{
      // Remove injected recipient-only display blocks
      const inj = ['evRecipientName','evRecipientAddress'];
      inj.forEach(id=>{ const el = document.getElementById(id); if (el && el.parentNode) el.parentNode.removeChild(el); });
      // Restore default labels
      const startTime0 = qs('#evStartTime'); if (startTime0) startTime0.value = '';
      const endTime0 = qs('#evEndTime');
      if (endTime0){
        endTime0.value = '';
        const endWrap0 = endTime0.parentElement;
        if (endWrap0) endWrap0.style.display = '';
      }
      const dateInput0 = qs('#evDate'); if (dateInput0) dateInput0.value = '';
      const startLbl0 = document.querySelector('label[for="evStartTime"]'); if (startLbl0) startLbl0.textContent = 'Start Time';
      const endLbl0 = document.querySelector('label[for="evEndTime"]'); if (endLbl0) endLbl0.textContent = 'End Time';
      // Restore wrappers' visibility
      const recWrap0 = qs('#wrapRecipient'); if (recWrap0) recWrap0.style.display = '';
      const donWrap0 = qs('#wrapDonor'); if (donWrap0) donWrap0.style.display = '';
      const loc0 = qs('#evLocation'); if (loc0){ const w = loc0.closest('.mt-2') || loc0.parentElement; if (w) w.style.display = ''; }
      // Re-enable all form controls by default (role logic will adjust afterward)
      const form0 = qs('#eventForm'); if (form0){ form0.querySelectorAll('input,select,textarea,button').forEach(c=>{ if (c.id !== 'deleteEventBtn') c.disabled = false; }); }
      // Clear select2 fields
      const donorSel0 = qs('#evDonor');
      if (donorSel0){
        if (typeof window.$ === 'function' && $(donorSel0).select2) { $(donorSel0).val(null).trigger('change'); }
        else donorSel0.value = '';
      }
      const recipientSel0 = qs('#evRecipientSelect');
      if (recipientSel0){
        if (typeof window.$ === 'function' && $(recipientSel0).select2) {
          $(recipientSel0).val(null).trigger('change');
          $(recipientSel0).prop('disabled', false);
        }
        else recipientSel0.value = '';
      }
      const recipientHidden0 = qs('#evRecipient'); if (recipientHidden0) recipientHidden0.value = '';
      const donorDisplay0 = qs('#evDonorDisplay');
      if (donorDisplay0){
        donorDisplay0.style.display = 'none';
        donorDisplay0.innerHTML = '';
      }
    }catch(_){ }
    // Populate
    const normalized = normalizeEventData(data);
    const donorDisplay = normalized?.donor_display || normalized?.donor_name || data?.donor_name || '';
    const donorAddress = normalized?.donor_address || data?.donor_address || normalized?.location || data?.location || '';
    const donorUserId = normalized?.donor_id || (normalized?.event_type === 'donor' ? (normalized?.created_for_user_id || normalized?.created_by_user_id || null) : null);
    const presetDate = data?.preset_date || data?.presetDate || null;
    lastViewedEvent = normalized;
    const r = role();
    const isRecipientEvent = normalized.event_type === 'recipient';
    const isAdmin = r === 'admin';
    const myId = userId();
    const involved = eventIsForCurrentUser(normalized);
    let canEdit = canEditEvent(normalized);
    if (!normalized?.id) {
      canEdit = true;
    }
    const existingRecipients = Array.isArray(normalized?.recipients)
      ? normalized.recipients.map(item => ({
          id: item.id || item.recipient_id,
          text: item.display_name || item.name || item.text || '',
          address: item.address || item.recipient_address || item.location || ''
        }))
      : [];
    resetRecipientQueue(isAdmin && isRecipientEvent ? existingRecipients : [], false);
    renderRecipientTags();
    const tagsWrap = qs('#evRecipientTags');
    if (tagsWrap) {
      if (isAdmin && isRecipientEvent) {
        tagsWrap.style.display = '';
      } else {
        tagsWrap.style.display = 'none';
        tagsWrap.innerHTML = '';
      }
    }

    qs('#evId').value = normalized?.id || '';
    qs('#evTitle').value = normalized?.title || data?.title || '';
    // Populate date/time for new modal fields
    const startIso = data?.start || normalized.start || '';
    const endIso = data?.end || normalized.end || '';
    const startDate = startIso ? new Date(startIso) : null;
    const endDate = endIso ? new Date(endIso) : null;
    const dateInput = qs('#evDate');
    const donorStartInput = qs('#donorStartTime');
    const adminStartInput = qs('#adminStartTime');
    const adminEndInput = qs('#adminEndTime');
    const donorDateInput = qs('#donorDate');
    const adminDateInput = qs('#adminDate');
    const startTimeStr = startDate ? formatTimeInput(startDate) : '';
    const endTimeStr = endDate ? formatTimeInput(endDate) : '';
    if (dateInput) dateInput.value = startDate ? formatDateInput(startDate) : '';
    if (donorDateInput) donorDateInput.value = startDate ? formatDateInput(startDate) : (dateInput ? dateInput.value : '');
    if (adminDateInput) adminDateInput.value = startDate ? formatDateInput(startDate) : (dateInput ? dateInput.value : '');
    if (donorStartInput) donorStartInput.value = startTimeStr;
    if (adminStartInput) adminStartInput.value = startTimeStr;
    if (adminEndInput) adminEndInput.value = endTimeStr;
    if (presetDate && dateInput && !dateInput.value) {
      dateInput.value = presetDate;
    }
    if (donorDateInput && !donorDateInput.value && (dateInput?.value || presetDate)) {
      donorDateInput.value = dateInput?.value || presetDate;
    }
    if (adminDateInput && !adminDateInput.value && (dateInput?.value || presetDate)) {
      adminDateInput.value = dateInput?.value || presetDate;
    }
    const evRecipientHidden = qs('#evRecipient');
    if (evRecipientHidden){
      if (existingRecipients.length){
        evRecipientHidden.value = String(existingRecipients[0].id);
        if (!normalized.location && existingRecipients[0].address) applyLocationFromAddress(existingRecipients[0].address);
      } else {
        evRecipientHidden.value = normalized?.recipient_id || '';
      }
    }

    if (!existingRecipients.length && !normalized?.id) {
      try {
        window.SchedulePickupUI?.resetRecipientFields({ date: '', time: '', clearAdditional: true });
      } catch (_) { /* ignore reset errors */ }
    }
    qs('#evDonor').value = donorUserId || '';
    qs('#evLocation').value = donorAddress || '';
    qs('#evNotes').value = normalized?.notes || data?.notes || '';

    // Ensure an informational hint element exists
    (function ensureHint(){
      try{
        const form = qs('#eventForm');
        if (!form) return;
        let hint = document.getElementById('evHint');
        if (!hint) {
          hint = document.createElement('div');
          hint.id = 'evHint';
          hint.className = 'form-text text-muted small mt-1';
          // insert after date/time blocks
          const anchor = qs('#wrapDateTimeAdmin') || qs('#wrapDateTimeDefault') || form.lastElementChild;
          if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(hint, anchor.nextSibling);
          else form.appendChild(hint);
        }
        // Hint text removed as per user request
      }catch(_){ }
    })();

    // Event type handling
    const typeSel = qs('#evType');
    const wrapRec = qs('#wrapRecipient');
    const wrapDon = qs('#wrapDonor');
    const wrapDtDefault = qs('#wrapDateTimeDefault');
    const wrapStatus = qs('#wrapStatus');
    const donorSelect = qs('#evDonor');
    const recipientSelect = qs('#evRecipientSelect');
    const recipientHidden = qs('#evRecipient');

    function applyLocationFromAddress(address){
      const addr = typeof address === 'string' ? address.trim() : '';
      if (!addr) return;
      const locInput = qs('#evLocation');
      if (!locInput) return;
      locInput.value = addr;
      const locWrap = locInput.closest('.mt-2') || locInput.parentElement;
      if (locWrap && role() !== 'recipient') locWrap.style.display = '';
    }

    function rememberOptionAddress(selectEl, value, address){
      if (!selectEl || !address) return;
      const opts = Array.from(selectEl.options || []);
      const match = opts.find(opt => String(opt.value) === String(value));
      if (match) match.dataset.address = address;
    }
    // Initialize Select2 for donor search if available and admin
    function ensureDonorSelect() {
      if (!donorSelect || typeof window.$ !== 'function') return;
      if ($(donorSelect).select2 && !$(donorSelect).data('select2')){
        $(donorSelect).select2({
          dropdownParent: $('#eventModal'),
          placeholder: 'Search donor organizations',
          allowClear: true,
          width: 'resolve',
          ajax: {
            url: `${API_BASE_URL}/users/index.php`,
            delay: 300,
            dataType: 'json',
            xhrFields: { withCredentials: true },
            data: params => ({ action:'list', role:'donor', q: params.term||'' }),
            processResults: (data)=>{
              const items = (data?.data?.items)||[];
              return { results: items.map(u=>({
                id: u.user_id,
                text: u.organization_name || u.name || ('Donor #'+u.user_id),
                address: u.address || null
              })) };
            },
            error: function(xhr){
              try {
                const msg = xhr?.responseJSON?.error || `HTTP ${xhr?.status||''}` || 'Failed to load donors';
              } catch(_) { /* ignore */ }
            }
          },
          minimumInputLength: 1
        }).on('select2:select', function(ev){
          const dataItem = ev.params?.data;
          if (dataItem?.address) applyLocationFromAddress(dataItem.address);
          rememberOptionAddress(donorSelect, dataItem?.id, dataItem?.address);
        }).on('change', function(){
          const opt = this.options[this.selectedIndex];
          if (opt && opt.dataset?.address) applyLocationFromAddress(opt.dataset.address);
        });
      }
    }
    function ensureRecipientSelect() {
      if (!recipientSelect) return;
      const payload = (function retrieveSchedulePayload(){
        let stored = null;
        try {
          const raw = window.sessionStorage ? window.sessionStorage.getItem('schedule_payload_from_pickup') : null;
          if (raw) stored = JSON.parse(raw);
        } catch (_) {
          stored = null;
        }
        if (!stored && window.__schedulePayloadFromPickup && typeof window.__schedulePayloadFromPickup === 'object') {
          stored = window.__schedulePayloadFromPickup;
        }
        return stored && Array.isArray(stored.recipients) ? stored : null;
      })();

      // When editing an existing recipient event, do NOT seed from the global
      // pickup payload; that payload contains all recipients for the run,
      // not just the ones attached to this specific time slot. In edit mode
      // we want to preserve the event's own recipient list (normalized.recipients).
      const editingRecipientEvent = Boolean(normalized?.id) && isRecipientEvent;

      const hasPayloadRecipients = !editingRecipientEvent && payload && Array.isArray(payload.recipients) && payload.recipients.length > 0;
      const canUseSelect2 = typeof window.$ === 'function' && $(recipientSelect).select2;

      if (!hasPayloadRecipients && canUseSelect2 && !$(recipientSelect).data('select2')){
        $(recipientSelect).select2({
          dropdownParent: $('#eventModal'),
          placeholder: 'Search recipient organizations',
          allowClear: true,
          width: 'resolve',
          ajax: {
            url: `${API_BASE_URL}/users/index.php`,
            delay: 300,
            dataType: 'json',
            xhrFields: { withCredentials: true },
            data: params => ({ action:'list', role:'recipient', q: params.term||'' }),
            processResults: (data)=>{
              const items = (data?.data?.items)||[];
              return { results: items.map(u=>({
                id: u.user_id,
                text: u.organization_name || u.name || ('Recipient #'+u.user_id),
                address: u.address || null
              })) };
            },
            minimumInputLength: 1
          }
        }).on('select2:select', function(ev){
          const dataItem = ev.params?.data;
          if (dataItem?.address) applyLocationFromAddress(dataItem.address);
          rememberOptionAddress(recipientSelect, dataItem?.id, dataItem?.address);
        }).on('change', function(){
          const opt = this.options[this.selectedIndex];
          if (opt && opt.dataset?.address) applyLocationFromAddress(opt.dataset.address);
        });
      }

      if (hasPayloadRecipients) {
        const recipients = payload.recipients;
        const dataOptions = recipients
          .map(rec => {
            const id = Number(rec.recipient_id || rec.id);
            if (!Number.isFinite(id)) return null;
            return {
              id,
              text: rec.recipient_name || rec.organization || `Recipient #${id}`,
              address: rec.address || rec.location || null
            };
          })
          .filter(Boolean);

        const unique = new Map();
        dataOptions.forEach(item => {
          if (!unique.has(item.id)) unique.set(item.id, item);
        });
        const deduped = Array.from(unique.values());

        if (canUseSelect2 && $(recipientSelect).data('select2')) {
          try { $(recipientSelect).select2('destroy'); } catch (_) {}
        }
        recipientSelect.innerHTML = '';
        deduped.forEach(item => {
          const opt = document.createElement('option');
          opt.value = String(item.id);
          opt.textContent = item.text;
          if (item.address) opt.dataset.address = item.address;
          recipientSelect.appendChild(opt);
        });

        recipientSelect.disabled = false;

        // Seed recipient queue so chips/hidden field reflect all payload recipients
        resetRecipientQueue(
          deduped.map(item => ({ id: item.id, text: item.text, address: item.address })),
          true
        );
        renderRecipientTags();
        syncRecipientHiddenFromQueue();

        if (canUseSelect2) {
          $(recipientSelect).select2({
            dropdownParent: $('#eventModal'),
            placeholder: 'Select recipient',
            allowClear: true,
            width: 'resolve'
          }).on('select2:select', function(ev){
            const dataItem = ev.params?.data;
            if (dataItem?.address) applyLocationFromAddress(dataItem.address);
            rememberOptionAddress(recipientSelect, dataItem?.id, dataItem?.address);
          }).on('change', function(){
            const opt = this.options[this.selectedIndex];
            if (opt && opt.dataset?.address) applyLocationFromAddress(opt.dataset.address);
          });
          // Select2 doesn't reflect queue automatically; clear dropdown selection
          $(recipientSelect).val(null).trigger('change');
        }
      }
    }
    function syncRecipientHiddenFromSelect(){
      if (!recipientHidden) return;
      const val = recipientSelect && recipientSelect.value ? Number(recipientSelect.value) : null;
      recipientHidden.value = val ? String(val) : '';
    }
    function setDonorSelectValue(id, text, address){
      if (!donorSelect) return;
      if (typeof window.$ === 'function' && $(donorSelect).select2){
        const option = new Option(text || ('Donor #'+id), id, true, true);
        if (address) option.dataset.address = address;
        $(donorSelect).append(option).trigger('change');
      } else {
        let opt = Array.from(donorSelect.options || []).find(o=>String(o.value)===String(id));
        if (!opt){
          opt = new Option(text || ('Donor #'+id), id, true, true);
          donorSelect.appendChild(opt);
        } else {
          opt.selected = true;
        }
        if (address) opt.dataset.address = address;
        donorSelect.value = String(id);
        applyLocationFromAddress(address);
      }
      rememberOptionAddress(donorSelect, id, address);
    }
    function setRecipientSelectValue(id, text, address){
      if (!recipientSelect) return;
      if (typeof window.$ === 'function' && $(recipientSelect).select2){
        const option = new Option(text || ('Recipient #'+id), id, true, true);
        if (address) option.dataset.address = address;
        $(recipientSelect).append(option).trigger('change');
      } else {
        let opt = Array.from(recipientSelect.options || []).find(o=>String(o.value)===String(id));
        if (!opt){
          opt = document.createElement('option');
          opt.value = String(id);
          opt.textContent = text || `Recipient #${id}`;
          recipientSelect.appendChild(opt);
        }
        if (address) opt.dataset.address = address;
        recipientSelect.value = String(id);
        applyLocationFromAddress(address);
      }
      rememberOptionAddress(recipientSelect, id, address);
      syncRecipientHiddenFromSelect();
    }
    if (recipientSelect){
      recipientSelect.addEventListener('change', syncRecipientHiddenFromSelect);
      if (!recipientSelect.dataset.locationBound){
        recipientSelect.addEventListener('change', ()=>{
          const opt = recipientSelect.options && recipientSelect.selectedIndex >= 0 ? recipientSelect.options[recipientSelect.selectedIndex] : null;
          if (opt && opt.dataset?.address) applyLocationFromAddress(opt.dataset.address);
        });
        recipientSelect.dataset.locationBound = '1';
      }
      if (isAdmin && isRecipientEvent){
        if (typeof window.$ === 'function' && $(recipientSelect).select2){
          existingRecipients.forEach(r => {
            if (r?.id){
              const option = new Option(r.text || ('Recipient #'+r.id), r.id, false, false);
              if (r.address) option.dataset.address = r.address;
              $(recipientSelect).append(option);
            }
          });
          $(recipientSelect).trigger('change');
        } else {
          // Fallback when Select2 is unavailable: ensure options exist for current recipients
          existingRecipients.forEach(r => {
            if (!r?.id) return;
            const exists = Array.from(recipientSelect.options || []).some(opt => Number(opt.value) === Number(r.id));
            if (!exists){
              const opt = document.createElement('option');
              opt.value = String(r.id);
              opt.textContent = r.text || `Recipient #${r.id}`;
              if (r.address) opt.dataset.address = r.address;
              recipientSelect.appendChild(opt);
            }
          });
          if (existingRecipients.length){
            recipientSelect.value = String(existingRecipients[0].id);
            syncRecipientHiddenFromSelect();
          }
        }
      }
    }
    if (donorSelect){
      if (typeof window.$ === 'function' && $(donorSelect).select2){ $(donorSelect).prop('disabled', !canEdit && r!=='admin'); }
      donorSelect.disabled = !canEdit && r !== 'admin';
      if (!donorSelect.dataset.locationBound){
        donorSelect.addEventListener('change', ()=>{
          const opt = donorSelect.options && donorSelect.selectedIndex >= 0 ? donorSelect.options[donorSelect.selectedIndex] : null;
          if (opt && opt.dataset?.address) applyLocationFromAddress(opt.dataset.address);
        });
        donorSelect.dataset.locationBound = '1';
      }
    }
    function inferTypeFromData(d){
      const norm = normalizeEventData(d);
      return norm.event_type || 'admin';
    }
    function applyTypeUI(t){
      const rNow = role();
      // Recipient ID shown only to admin when setting recipient-type events
      if (wrapRec) {
        const show = (t==='recipient' && rNow==='admin');
        wrapRec.style.display = show ? '' : 'none';
        const addBtn = qs('#addRecipientBtn');
        const tagsWrapEl = qs('#evRecipientTags');
        if (addBtn) addBtn.style.display = show ? '' : 'none';
        if (tagsWrapEl) tagsWrapEl.style.display = show ? '' : 'none';
        if (show) {
          ensureRecipientSelect();
          renderRecipientTags();
        } else {
          resetRecipientQueue([], true);
          if (tagsWrapEl) tagsWrapEl.innerHTML = '';
          if (recipientSelect){
            if (typeof window.$ === 'function' && $(recipientSelect).data('select2')){
              $(recipientSelect).val(null).trigger('change');
            } else {
              recipientSelect.value = '';
            }
          }
        }
      }
      // Donor selector visible only for admin when scheduling donor pickups
      if (wrapDon){
        const showDonor = (t==='donor' && (rNow==='admin' || rNow==='donor'));
        wrapDon.style.display = showDonor ? '' : 'none';
      }
      if (wrapStatus) wrapStatus.style.display = (rNow==='admin') ? 'none' : '';
      // Hide Location for recipients
      const locInput = qs('#evLocation');
      if (locInput) {
        const locWrap = locInput.closest('.mt-2') || locInput.parentElement;
        if (rNow==='recipient') { if (locWrap) locWrap.style.display = 'none'; locInput.value = ''; }
        else { if (locWrap) locWrap.style.display = ''; }
      }
      const endTimeInput = qs('#evEndTime');
      const endTimeWrap = endTimeInput ? endTimeInput.parentElement : null;
      if (endTimeInput){
        if (t==='donor' || t==='recipient'){
          endTimeInput.value = '';
          if (endTimeWrap) endTimeWrap.style.display = 'none';
        } else if (endTimeWrap) {
          endTimeWrap.style.display = '';
        }
      }
      if (t==='donor' && rNow==='admin') { ensureDonorSelect(); }
    }
    let initType = inferTypeFromData(normalized);
    if (typeSel){
      // Restrict options based on role
      const allowOptions = (r==='admin') ? ['admin','donor','recipient'] : (r==='donor') ? ['donor'] : (r==='recipient') ? ['recipient'] : ['admin'];
      // If evType is a SELECT element, prune disallowed options. Hidden input has no options.
      if (typeSel.tagName === 'SELECT' && typeSel.options) {
        Array.from(typeSel.options).forEach(opt=>{ if (!allowOptions.includes(opt.value)) opt.remove(); });
      }
      if (typeof window !== 'undefined' && typeof window.enforceAllowedEventType === 'function') {
        const enforced = window.enforceAllowedEventType(typeSel.value);
        if (enforced && enforced !== typeSel.value) {
          typeSel.value = enforced;
        }
      }
      if (r==='admin'){
        typeSel.disabled = false;
        if (!allowOptions.includes(initType)) initType = 'admin';
        typeSel.value = initType;
      } else if (r==='donor'){
        typeSel.value = 'donor';
        typeSel.disabled = true;
        initType = 'donor';
      } else if (r==='recipient'){
        typeSel.value = 'recipient';
        typeSel.disabled = true;
        initType = 'recipient';
      } else {
        typeSel.value = 'admin';
        typeSel.disabled = true;
        initType = 'admin';
      }
      applyTypeUI(initType);
      typeSel.onchange = ()=> applyTypeUI(typeSel.value);
    }

    // Sync schedulePickup UI tab and permissions
    try {
      if (window.SchedulePickupUI) {
        // Flag editing early so UI defaults don't overwrite prefilled fields
        window.SchedulePickupUI._editing = Boolean(normalized?.id);
        if (typeof window.SchedulePickupUI.setType === 'function') {
          window.SchedulePickupUI.setType(initType);
        }
      }
    } catch(_){ }

    // Toggle admin UI sections via schedulePickup helpers if available
    const syncUiType = (evtType) => {
      if (window.SchedulePickupUI?.updateUI) {
        window.SchedulePickupUI.updateUI(evtType);
      } else {
        qs('#wrapRecipient')?.classList.toggle('d-none', evtType!=='recipient');
        qs('#wrapDonor')?.classList.toggle('d-none', evtType!=='donor');
        qs('#wrapAdminTimes')?.classList.toggle('d-none', evtType!=='admin');
      }
    };

    const initialType = typeSel ? typeSel.value : inferTypeFromData(normalized);
    if (typeSel) {
      typeSel.value = initialType;
    }
    syncUiType(initialType);

    if (typeSel) {
      typeSel.addEventListener('change', (e) => {
        syncUiType(e.target.value);
        if (window.SchedulePickupUI?.updateDonorData) {
          window.SchedulePickupUI.updateDonorData();
        }
      });
    }

    // Bridge: prefill schedulePickup recipient UI when editing recipient-type events
    if (window.SchedulePickupUI && initialType === 'recipient') {
      try {
        const dateStr = dateInput ? dateInput.value : (startDate ? formatDateInput(startDate) : '');
        const timeStr = startTimeStr;
        if (typeof window.SchedulePickupUI.resetRecipientFields === 'function') {
          window.SchedulePickupUI.resetRecipientFields({ date: dateStr || '', time: timeStr || '', clearAdditional: true });
        }
        const container = document.getElementById('recipientSelections');
        if (container) {
          const need = Math.max(1, existingRecipients.length);
          while (container.querySelectorAll('.recipient-selection').length < need) {
            if (typeof window.SchedulePickupUI.addRecipientField === 'function') window.SchedulePickupUI.addRecipientField();
            else break;
          }
          const blocks = Array.from(container.querySelectorAll('.recipient-selection'));
          if (existingRecipients.length) {
            existingRecipients.forEach((r, idx) => {
              const blk = blocks[idx]; if (!blk) return;
              const sel = blk.querySelector('.recipient-select'); if (!sel) return;
              let opt = Array.from(sel.options||[]).find(o=>String(o.value)===String(r.id));
              if (!opt) { opt = new Option(r.text || (`Recipient #${r.id}`), r.id, true, true); sel.appendChild(opt); }
              if (typeof window.$ === 'function' && window.$.fn && window.$.fn.select2) {
                const $sel = window.$(sel);
                if (!$sel.data('select2')) { if (typeof window.initRecipientSelect === 'function') window.initRecipientSelect(sel); }
                $sel.val(String(r.id)).trigger('change');
              } else {
                sel.value = String(r.id);
                sel.dispatchEvent(new Event('change', { bubbles: true }));
              }
              const dEl = blk.querySelector('.recipient-date'); if (dEl && dateStr) dEl.value = dateStr;
              const tEl = blk.querySelector('.recipient-time'); if (tEl && timeStr) tEl.value = timeStr;
            });
          } else if (normalized.recipient_id) {
            const blk = blocks[0]; if (!blk) return;
            const sel = blk.querySelector('.recipient-select'); if (!sel) return;
            const rid = normalized.recipient_id;
            let opt = Array.from(sel.options||[]).find(o=>String(o.value)===String(rid));
            const text = normalized.recipient_display || normalized.recipient_name || (`Recipient #${rid}`);
            if (!opt) { opt = new Option(text, rid, true, true); sel.appendChild(opt); }
            if (typeof window.$ === 'function' && window.$.fn && window.$.fn.select2) {
              const $sel = window.$(sel);
              if (!$sel.data('select2')) { if (typeof window.initRecipientSelect === 'function') window.initRecipientSelect(sel); }
              $sel.val(String(rid)).trigger('change');
            } else {
              sel.value = String(rid);
              sel.dispatchEvent(new Event('change', { bubbles: true }));
            }
            const dEl = blk.querySelector('.recipient-date'); if (dEl && dateStr) dEl.value = dateStr;
            const tEl = blk.querySelector('.recipient-time'); if (tEl && timeStr) tEl.value = timeStr;
          }
          if (typeof window.SchedulePickupUI.updateRecipientSelections === 'function') window.SchedulePickupUI.updateRecipientSelections();
        }
      } catch(_){ }
    }

    // Prefill donor/admin fields for admin role
    try {
      if (r === 'admin') {
        const startIso = data?.start || '';
        const endIso = data?.end || '';
        if (initialType === 'donor') {
          if (startIso) {
            const d = new Date(startIso);
            const yyyy = d.getFullYear();
            const mm = String(d.getMonth()+1).padStart(2,'0');
            const dd = String(d.getDate()).padStart(2,'0');
            const hh = String(d.getHours()).padStart(2,'0');
            const mi = String(d.getMinutes()).padStart(2,'0');
            const donorTimeEl = qs('#donorStartTime');
            if (donorTimeEl) donorTimeEl.value = `${hh}:${mi}`;
            const dateInput = qs('.recipient-date');
            if (dateInput) dateInput.value = `${yyyy}-${mm}-${dd}`;
          }
          const prefillId = donorUserId || data?.donor_id;
          if (prefillId) {
            ensureDonorSelect();
            setDonorSelectValue(prefillId, donorDisplay || undefined, donorAddress || undefined);
            rememberOptionAddress(qs('#evDonor'), prefillId, donorAddress || '');
          }
        } else if (initialType === 'admin') {
          if (startIso) {
            const d = new Date(startIso);
            qs('#adminStartTime')?.setAttribute('value', `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`);
          }
          if (endIso) {
            const d = new Date(endIso);
            qs('#adminEndTime')?.setAttribute('value', `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`);
          }
        }
      }
    } catch(_){ }

    // If editing an existing admin-created donor pickup, try set donor select (use donor_display when available)
    if (r==='admin'){
      if (donorSelect && (donorUserId || normalized?.donor_id)){
        ensureDonorSelect();
        setDonorSelectValue(donorUserId || normalized.donor_id, donorDisplay || undefined, donorAddress || undefined);
      }
      if (recipientSelect && normalized?.recipient_id){
        ensureRecipientSelect();
        setRecipientSelectValue(normalized.recipient_id, normalized.recipient_display || normalized.recipient_name || undefined, normalized.recipient_address || data?.recipient_address);
      }
      try { if (window.SchedulePickupUI?.updateDonorData) window.SchedulePickupUI.updateDonorData(); } catch(_){ }
    }
    if (recipientSelect && existingRecipients.length){
      ensureRecipientSelect();
      const first = existingRecipients[0];
      if (first?.id){
        setRecipientSelectValue(first.id, first.text || first.display_name || first.name || undefined);
      }
    }

    // Role-based controls

    ['evTitle','evStart','evEnd','evDonor','evLocation','evNotes'].forEach(id=>{
      const el = qs('#'+id); if (el) el.disabled = !canEdit;
    });
    if (recipientHidden) recipientHidden.disabled = (r!=='admin' && !canEdit);
    if (donorSelect){
      if (typeof window.$ === 'function' && $(donorSelect).select2){ $(donorSelect).prop('disabled', !canEdit); }
      donorSelect.disabled = !canEdit;
    }
    if (recipientSelect){
      const lockRecipientSelect = !canEdit && r !== 'admin';
      if (typeof window.$ === 'function' && $(recipientSelect).select2){ $(recipientSelect).prop('disabled', lockRecipientSelect); }
      recipientSelect.disabled = lockRecipientSelect;
    }
    const delBtn = qs('#deleteEventBtn'); if (delBtn) delBtn.style.display = (canEdit && data?.id) ? '' : 'none';
    const saveBtn = qs('#saveEventBtn'); if (saveBtn) saveBtn.disabled = !canEdit;
    try {
      const recInput = qs('#evRecipient');
      const recWrap = document.getElementById('wrapRecipient');
      const donorInput = qs('#evDonor');
      const donorWrap = donorInput ? donorInput.closest('.col-6') : qs('#wrapDonor');
      const donorDisplayEl = qs('#evDonorDisplay');
      const disp = document.getElementById('evRecipientName');
      if (disp && disp.parentElement) disp.parentElement.removeChild(disp);
      if (recWrap){
        const typeSel = qs('#evType');
        const isRecipientType = typeSel && typeSel.value === 'recipient';
        recWrap.style.display = isRecipientType ? '' : 'none';
      }
      if (donorDisplayEl){
        donorDisplayEl.style.display = 'none';
        donorDisplayEl.innerHTML = '';
      }

      if (recipientSelect){
        if (typeof window.$ === 'function' && $(recipientSelect).select2){ $(recipientSelect).prop('disabled', !canEdit && r!=='admin'); }
        recipientSelect.disabled = !canEdit && r !== 'admin';
      }
      if (donorSelect){
        if (typeof window.$ === 'function' && $(donorSelect).select2){ $(donorSelect).prop('disabled', !canEdit && r!=='admin'); }
        donorSelect.disabled = !canEdit && r !== 'admin';
        if (!donorSelect.dataset.locationBound){
          donorSelect.addEventListener('change', ()=>{
            const opt = donorSelect.options && donorSelect.selectedIndex >= 0 ? donorSelect.options[donorSelect.selectedIndex] : null;
            if (opt && opt.dataset?.address) applyLocationFromAddress(opt.dataset.address);
          });
          donorSelect.dataset.locationBound = '1';
        }
      }

      if (r === 'recipient'){
        const org = currentUserOrganization();
        if (recipientSelect){
          if (typeof window.$ === 'function' && $(recipientSelect).data('select2')){
            try { $(recipientSelect).select2('destroy'); } catch(_){ }
          }
          recipientSelect.style.display = 'none';
          const existing = recipientSelect.nextElementSibling;
          if (existing && existing.classList && existing.classList.contains('select2')){
            existing.parentElement?.removeChild(existing);
          }
        }
        const addBtn = qs('#addRecipientBtn');
        if (addBtn) addBtn.style.display = 'none';
        const tagsWrapEl = qs('#evRecipientTags');
        if (tagsWrapEl) {
          tagsWrapEl.innerHTML = '';
          tagsWrapEl.style.display = '';
          tagsWrapEl.innerHTML = `<div class="form-control form-control-sm bg-light" aria-readonly="true">${escapeHtml(org || 'My organization')}</div>`;
        }
        if (recInput) recInput.value = String(userId());
        const locInput = qs('#evLocation');
        if (locInput){
          locInput.value = 'Food Bank Warehouse';
          const locWrap = locInput.closest('.mt-2') || locInput.parentElement;
          if (locWrap) locWrap.style.display = 'none';
        }
      } else if (r === 'donor'){
        const org = normalized?.donor_display || normalized?.donor_name || currentUserOrganization();
        if (donorWrap) donorWrap.style.display = '';
        if (donorSelect){
          if (typeof window.$ === 'function' && $(donorSelect).data('select2')){
            try { $(donorSelect).select2('destroy'); } catch(_){ }
          }
          donorSelect.style.display = 'none';
          const existingDonor = donorSelect.nextElementSibling;
          if (existingDonor && existingDonor.classList && existingDonor.classList.contains('select2')){
            existingDonor.parentElement?.removeChild(existingDonor);
          }
        }
        if (donorDisplayEl){
          donorDisplayEl.style.display = '';
          donorDisplayEl.innerHTML = `<div class="form-control form-control-sm bg-light" aria-readonly="true">${escapeHtml(org || 'My organization')}</div>`;
        }
        if (donorInput) donorInput.value = String(userId());
        const locInput = qs('#evLocation');
        if (locInput){
          const locWrap = locInput.closest('.mt-2') || locInput.parentElement;
          if (locWrap) locWrap.style.display = 'none';
          locInput.value = '';
        }
      } else if (r !== 'admin'){
        const locInput = qs('#evLocation');
        if (locInput){
          const locWrap = locInput.closest('.mt-2') || locInput.parentElement;
          if (locWrap) locWrap.style.display = 'none';
          locInput.value = '';
        }
      } else {
        const locInput = qs('#evLocation');
        if (locInput){
          const locWrap = locInput.closest('.mt-2') || locInput.parentElement;
          if (locWrap) locWrap.style.display = '';
        }
      }
    } catch(_){ }

    // Prefill separate date/time inputs for admin donor-type UI
    try {
      const t = typeSel ? typeSel.value : inferTypeFromData(normalized);
      if (r==='admin' && t==='donor'){
        const startIso = data?.start || '';
        if (startIso){
          const d = new Date(startIso);
          const yyyy = d.getFullYear();
          const mm = String(d.getMonth()+1).padStart(2,'0');
          const dd = String(d.getDate()).padStart(2,'0');
          const hh = String(d.getHours()).padStart(2,'0');
          const mi = String(d.getMinutes()).padStart(2,'0');
          const dateInput = qs('#evDate'); if (dateInput) dateInput.value = `${yyyy}-${mm}-${dd}`;
          const timeInput = qs('#evTime'); if (timeInput) timeInput.value = `${hh}:${mi}`;
        }
      }
    } catch(_){}

    m.show();
  }

  function collectForm(){
    let t = (qs('#evType')?.value)||defaultTypeForCurrentRole();
    const r = role();
    const uid = userId();
    const editingId = Number(qs('#evId')?.value||0)||0;
    if (r === 'recipient' && !recipientEligibleForScheduling()) {
      calendarToast(recipientEligibilityMessage(), 'warn');
      return null;
    }
    // Resolve donor from select2 if present
    let donorId = null;
    const donorSelect = qs('#evDonor');
    if (donorSelect && donorSelect.value) donorId = Number(donorSelect.value);
    if (!donorId) { donorId = qs('#evDonor')?.value ? Number(qs('#evDonor').value) : null; }
    let recipientId = null;
    let recipientIds = [];
    const recipientSelect = qs('#evRecipientSelect');
    if (recipientSelect && recipientSelect.value) recipientId = Number(recipientSelect.value);
    if (!recipientId) { recipientId = qs('#evRecipient')?.value ? Number(qs('#evRecipient').value) : null; }
    if (!canCreateEventOfType(t)) {
      return null;
    }
    // Parse recipients ONLY when the active type is recipient
    let recipientsUi = [];
    let recipientIdsFromUi = [];
    if (t === 'recipient') {
      const recipientsRaw = qs('#evRecipients')?.value || '';
      if (recipientsRaw) {
        try {
          const parsed = JSON.parse(recipientsRaw);
          if (Array.isArray(parsed)) {
            recipientsUi = parsed;
            recipientIdsFromUi = parsed
              .map(item => Number(item && item.id))
              .filter(v => Number.isFinite(v) && v > 0);
          }
        } catch(_){ }
      }
      // Fallback: read from DOM if hidden JSON is empty or invalid
      if (!recipientsUi.length) {
        try {
          const blocks = document.querySelectorAll('.recipient-selection');
          const tmp = [];
          blocks.forEach(b => {
            const sel = b.querySelector('.recipient-select');
            const id = sel ? Number(sel.value) : null;
            if (!Number.isFinite(id) || id <= 0) return;
            const dateEl = b.querySelector('.recipient-date');
            const timeEl = b.querySelector('.recipient-time');
            const date = (dateEl && dateEl.value) ? String(dateEl.value) : '';
            const time = (timeEl && timeEl.value) ? String(timeEl.value) : '';
            tmp.push({ id, date, time });
          });
          if (tmp.length) {
            recipientsUi = tmp;
            recipientIdsFromUi = tmp.map(x => Number(x.id)).filter(v => Number.isFinite(v) && v > 0);
          }
        } catch(_){ }
      }
      // If editing an existing recipient event, update it (single payload) instead of creating new ones
      if (editingId) {
        const first = Array.isArray(recipientsUi) && recipientsUi.length ? recipientsUi[0] : null;
        const rid = first && Number(first.id) > 0 ? Number(first.id) : (recipientId || null);
        const d = (first && first.date) ? String(first.date).trim() : (qs('#evDate')?.value || '');
        let tstr = (first && first.time) ? String(first.time).trim() : '';
        const m = tstr.match(/^(\d{1,2}):(\d{2})\s*([ap]m)$/i);
        if (m){ let hh = Number(m[1]); const mm = m[2]; const ap = m[3].toLowerCase(); if (ap==='pm' && hh<12) hh+=12; if (ap==='am' && hh===12) hh=0; tstr = `${String(hh).padStart(2,'0')}:${mm}`; }
        const startIso = (d && tstr) ? new Date(`${d}T${tstr}`).toISOString() : null;
        return {
          id: editingId,
          title: qs('#evTitle').value.trim(),
          start: startIso,
          end: null,
          recipient_id: rid,
          donor_id: null,
          location: qs('#evLocation').value.trim() || null,
          notes: qs('#evNotes').value.trim() || null,
          event_type: t,
          created_for_user_id: (r==='admin') ? null : uid
        };
      }
    }
    // Enforce per role
    if (r==='donor') { donorId = uid; recipientId = null; recipientIds = []; }
    else if (r==='recipient') { recipientId = uid; donorId = null; recipientIds = []; }
    else if (r==='admin') {
      if (t==='admin'){ donorId = null; recipientId = null; }
      else if (t==='donor'){ recipientId = null; }
      else if (t==='recipient'){
        donorId = null;
        recipientIds = recipientIdsFromUi.slice();
        if (!recipientIds.length && recipientId) recipientIds = [recipientId];
        if (recipientIds.length) recipientId = Number(recipientIds[0]);
        else recipientId = null;
      }
    }
    let titleVal = qs('#evTitle').value.trim();
    if (!titleVal) {
      // Auto-title for convenience
      if (r==='donor') titleVal = 'My Availability';
      else if (r==='recipient') titleVal = 'My Availability';
      else if (t==='admin') titleVal = 'Admin Event';
      else if (t==='donor') titleVal = 'Donor Pickup/Availability';
      else if (t==='recipient') titleVal = 'Recipient Pickup/Availability';
    }
    // Build start/end from new modal fields
    let dateVal = qs('#evDate')?.value || '';
    const donorDateVal = qs('#donorDate')?.value || '';
    const adminDateVal = qs('#adminDate')?.value || '';
    const donorStartTimeVal = qs('#donorStartTime')?.value || '';
    const adminStartVal = qs('#adminStartTime')?.value || '';
    const adminEndVal = qs('#adminEndTime')?.value || '';
    let startIso = null;
    let endIso = null;
    if (t === 'admin') {
      dateVal = adminDateVal || dateVal;
      if (dateVal && adminStartVal){
        startIso = new Date(`${dateVal}T${adminStartVal}`).toISOString();
      }
      if (dateVal && adminEndVal){
        endIso = new Date(`${dateVal}T${adminEndVal}`).toISOString();
      }
    } else if (t === 'donor') {
      dateVal = donorDateVal || dateVal;
      const timeVal = donorStartTimeVal || adminStartVal || '';
      if (dateVal && timeVal){
        startIso = new Date(`${dateVal}T${timeVal}`).toISOString();
      }
      endIso = null;
    } else if (t === 'recipient') {
      // Build grouped payloads by recipient date+time
      const titleVal2 = titleVal;
      const locationVal = qs('#evLocation').value.trim() || null;
      const notesVal = qs('#evNotes').value.trim() || null;
      const groups = new Map();
      if (Array.isArray(recipientsUi) && recipientsUi.length){
        recipientsUi.forEach(item => {
          if (!item || !item.id) return;
          const date = (item.date || '').trim();
          let time = (item.time || '').trim();
          if (!date || !time) return;
          // normalize 12h to 24h if needed
          const m = time.match(/^(\d{1,2}):(\d{2})\s*([ap]m)$/i);
          if (m){
            let hh = Number(m[1]); const mm = m[2]; const ap = m[3].toLowerCase();
            if (ap === 'pm' && hh < 12) hh += 12; if (ap === 'am' && hh === 12) hh = 0;
            time = `${String(hh).padStart(2,'0')}:${mm}`;
          }
          const key = `${date}T${time}`;
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key).push(Number(item.id));
        });
      }
      if (groups.size){
        const payloads = Array.from(groups.entries()).map(([key, ids])=>({
          id: null,
          title: titleVal2,
          start: new Date(key).toISOString(),
          end: null,
          recipient_id: ids[0] || null,
          donor_id: null,
          location: locationVal,
          notes: notesVal,
          event_type: t,
          created_for_user_id: (r==='admin') ? null : uid,
          recipient_ids: ids
        })).sort((a,b)=> new Date(a.start) - new Date(b.start));
        return payloads;
      }
      // If no per-recipient times, return empty array so save handler can warn appropriately
      return [];
    } else {
      if (dateVal && adminStartVal){
        startIso = new Date(`${dateVal}T${adminStartVal}`).toISOString();
      }
      if (dateVal && adminEndVal){
        endIso = new Date(`${dateVal}T${adminEndVal}`).toISOString();
      }
    }

    const payload = {
      id: qs('#evId').value || null,
      title: titleVal,
      start: startIso,
      end: endIso,
      recipient_id: recipientId,
      donor_id: donorId,
      location: qs('#evLocation').value.trim() || null,
      notes: qs('#evNotes').value.trim() || null,
      event_type: t,
      created_for_user_id: (r==='admin') ? (t==='admin' ? null : (t==='donor' ? donorId : recipientId)) : uid,
    };
    if (recipientIds.length) payload.recipient_ids = recipientIds;
    return payload;
  }

  async function init(){
    const feedback = qs('#calFeedback');
    // Inject CSS to remove default blue link color on FullCalendar events
    try {
      const styleId = 'fc-event-textcolor-inherit';
      if (!document.getElementById(styleId)){
        const st = document.createElement('style');
        st.id = styleId;
        st.textContent = `
          .fc .fc-event {
            /* Do not override color so per-event textColor can apply */
            --fc-event-bg-color: transparent;
            --fc-event-border-color: transparent;
            background-color: transparent !important;
            border-color: transparent !important;
          }
          .fc .fc-daygrid-event,
          .fc .fc-timegrid-event {
            background-color: transparent !important;
            border-color: transparent !important;
          }
          .fc .fc-event a,
          .fc .fc-event a:visited,
          .fc .fc-event a:hover,
          .fc .fc-event a:active { color: inherit; text-decoration: none; }
        `;
        document.head.appendChild(st);
      }
    } catch(_){}
    // Compute start-of-today (local) and YYYY-MM-DD string
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yyyy = startOfToday.getFullYear();
    const mm = String(startOfToday.getMonth()+1).padStart(2,'0');
    const dd = String(startOfToday.getDate()).padStart(2,'0');
    const todayStr = `${yyyy}-${mm}-${dd}`;

    const addRecipientBtn = qs('#addRecipientBtn');
    if (addRecipientBtn){
      addRecipientBtn.addEventListener('click', (ev)=>{
        ev.preventDefault();
        const added = addRecipientFromCurrentSelection();
        if (!added){
          const sel = qs('#evRecipientSelect');
          const hasValue = sel && (sel.value || (typeof window.$ === 'function' && $(sel).select2 && $(sel).val()));
          if (!hasValue){
            const msg = qs('#calFeedback');
            showMsg(msg, 'Select a recipient first, then press “Add”.', 'warning');
            setTimeout(()=> showMsg(msg, '', 'info'), 2500);
          }
        } else {
          showMsg(feedback, '', 'info');
        }
      });
    }

    const recipientTagsWrap = qs('#evRecipientTags');
    if (recipientTagsWrap){
      recipientTagsWrap.addEventListener('click', (ev)=>{
        const btn = ev.target.closest('[data-remove-recipient]');
        if (!btn) return;
        ev.preventDefault();
        removeRecipientFromQueue(btn.getAttribute('data-remove-recipient'));
      });
    }

    const viewModalEl = document.getElementById('eventViewModal');
    if (viewModalEl){
      viewModalEl.addEventListener('hidden.bs.modal', ()=>{
        lastViewedEvent = null;
        updateEditButtonState();
      });
    }

    const editBtn = qs('#editEventBtn');
    if (editBtn){
      editBtn.addEventListener('click', ()=>{
        let targetEvent = null;
        // Prefer currently selected event over any previously viewed
        const selected = getSelectedEventData();
        if (selected && canEditEvent(selected)) targetEvent = normalizeEventData(selected);
        else if (lastViewedEvent && canEditEvent(lastViewedEvent)) targetEvent = lastViewedEvent;
        if (!targetEvent){
          calendarToast('Select an event you can edit first', 'warn');
          return;
        }
        const viewModal = viewModalEl ? bootstrap.Modal.getInstance(viewModalEl) : null;
        viewModal?.hide();
        openModal(targetEvent);
      });
    }

    const selectedDayList = qs('#selectedDayList');
    if (selectedDayList){
      selectedDayList.addEventListener('click', (e)=>{
        const trigger = e.target.closest('.selected-day-open, .selected-day-item');
        if (!trigger) return;
        const id = Number(trigger.getAttribute('data-event-id') || trigger.dataset.eventId);
        if (!Number.isFinite(id)) return;
        const match = cachedCalendarItems.find(item => Number(item.id) === id || Number(item.event_id) === id);
        if (!match) return;
        selectedEventId = id;
        // Reset any previously viewed event so edits reflect the current selection
        lastViewedEvent = null;
        updateSelectedListActive();
        updateEditButtonState();
        if (trigger.classList.contains('selected-day-open')){
          e.preventDefault();
          const ev = normalizeEventData(match);
          if (canViewEvent(ev)) showViewModal(ev);
        }
      });
    }

    const layout = qs('#scheduleLayout');
    const resizer = qs('#scheduleResizer');
    const selectedPane = qs('.selected-pane');
    const calendarPane = qs('.calendar-pane');
    if (layout && resizer && selectedPane && calendarPane){
      const minWidth = Number(selectedPane.dataset.minWidth) || 240;
      const maxWidth = Number(selectedPane.dataset.maxWidth) || 520;
      const calendarMin = Number(layout.dataset.calendarMin) || 520;
      let startX = 0;
      let startWidth = 0;
      const onMove = (ev)=>{
        const delta = ev.clientX - startX;
        let newWidth = startWidth - delta;
        if (!Number.isFinite(newWidth)) return;
        const layoutWidth = layout.getBoundingClientRect().width;
        const calendarWidth = layoutWidth - newWidth - resizer.getBoundingClientRect().width;
        if (calendarWidth < calendarMin){
          newWidth = layoutWidth - calendarMin - resizer.getBoundingClientRect().width;
        }
        newWidth = Math.max(minWidth, Math.min(maxWidth, newWidth));
        layout.style.setProperty('--selected-pane-width', `${Math.round(newWidth)}px`);
        queueCalendarResize();
      };
      const onUp = ()=>{
        document.body.classList.remove('schedule-resizing');
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        queueCalendarResize();
      };
      resizer.addEventListener('pointerdown', (ev)=>{
        if (ev.pointerType === 'mouse' && ev.button !== 0) return;
        ev.preventDefault();
        startX = ev.clientX;
        startWidth = selectedPane.getBoundingClientRect().width;
        layout.style.setProperty('--selected-pane-width', `${Math.round(startWidth)}px`);
        document.body.classList.add('schedule-resizing');
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp, { once: true });
      });
    }

    const calendarEl = document.getElementById('calendar');
    if (!calendarEl) return;

    const loadCalendarRange = async (startIso, endIso)=>{
      const token = ++rangeRequestId;
      try {
        const items = await listEvents(startIso, endIso);
        if (token !== rangeRequestId) return;
        cachedCalendarItems = items;
        calendarInstance?.removeAllEvents();
        items.forEach(rawEv => {
          const ev = normalizeEventData(rawEv);
          if (!canViewEvent(ev)) return;
          const mine = eventIsForCurrentUser(ev) || Number(ev.created_by_user_id) === userId();
          const cls = [ mine ? 'event-owned' : 'event-assigned' ];
          let textColor;
          const editor = (rawEv.editor_role||rawEv.last_updated_role||'').toLowerCase();
          if (editor === 'donor') { textColor = '#00a0b0'; }
          else if (editor === 'recipient') { textColor = '#ed3f34'; }
          else if (editor === 'admin') { textColor = '#76818d'; }
          else if (rawEv.is_busy) {
            textColor = '#6c757d';
          } else {
            const roleType = ev.event_type;
            if (roleType === 'donor') { textColor = '#00a0b0'; }
            else if (roleType === 'recipient') { textColor = '#ed3f34'; }
            else { textColor = '#76818d'; }
          }
          calendarInstance?.addEvent({
            id: String(ev.id),
            title: rawEv.title || ev.title,
            start: rawEv.start || ev.start,
            end: rawEv.end || ev.end || undefined,
            extendedProps: ev,
            classNames: cls,
            textColor
          });
        });
        rerenderSelectedDayFromCache();
      } catch (e) {
        if (token === rangeRequestId) {
          calendarToast(e.message || 'Failed to load events', 'error');
        }
      }
    };

    const refreshVisibleRange = ()=>{
      if (lastRangeInfo && lastRangeInfo.startStr && lastRangeInfo.endStr){
        return loadCalendarRange(lastRangeInfo.startStr, lastRangeInfo.endStr);
      }
      const view = calendarInstance?.view;
      if (view?.activeStart && view?.activeEnd){
        return loadCalendarRange(view.activeStart.toISOString(), view.activeEnd.toISOString());
      }
      return Promise.resolve();
    };

    const calendar = new FullCalendar.Calendar(calendarEl, {
      initialView: 'dayGridMonth',
      height: 'auto',
      headerToolbar: { left: 'prev,next today', center: 'title', right: 'dayGridMonth,timeGridWeek,timeGridDay' },
      navLinks: true,
      nowIndicator: true,
      expandRows: true,
      allDaySlot: false,
      slotMinTime: '06:00:00',
      slotMaxTime: '21:00:00',
      eventDisplay: 'block',
      selectable: canCreateEvents(),
      eventTimeFormat: { hour:'2-digit', minute:'2-digit', hour12:false },
      selectAllow: (selectionInfo)=> {
        // Disallow creating selections starting before today
        return selectionInfo.start >= startOfToday;
      },
      select: ()=>{},
      eventAllow: (dropInfo, draggedEvent)=> {
        const start = dropInfo.start;
        if (start < startOfToday) return false;
        const data = normalizeEventData(draggedEvent?.extendedProps || {});
        return canEditEvent(data);
      },
      eventDidMount: ()=>{},
      datesSet: (info)=>{
        lastRangeInfo = { startStr: info.startStr, endStr: info.endStr };
        loadCalendarRange(info.startStr, info.endStr);
      },
      dateClick: (info)=>{
        lastSelectedDate = info.dateStr;
        highlightSelectedDate(info.dateStr);
        renderDateFromCache(info.dateStr);
        // Changing the selected day invalidates any prior viewed event
        lastViewedEvent = null;
        updateEditButtonState();
      },
      eventClick: (arg)=>{
        const raw = { ...(arg.event.extendedProps || {}),
          id: Number(arg.event.id),
          title: arg.event.title,
          start: arg.event.start?.toISOString(),
          end: arg.event.end?.toISOString() || null
        };
        const ev = normalizeEventData(raw);
        if (!canViewEvent(ev)) { calendarToast('You do not have permission to view this event', 'warn'); return; }
        const dateKey = getDateKey(ev.start);
        if (dateKey){
          lastSelectedDate = dateKey;
          highlightSelectedDate(dateKey);
          renderDateFromCache(dateKey);
          const idNum = Number(ev.id);
          if (Number.isFinite(idNum)){
            selectedEventId = idNum;
            updateSelectedListActive();
          }
        }
        // Clicking a different event should not keep an old lastViewedEvent
        lastViewedEvent = null;
        updateEditButtonState();
      }
    });
    calendarInstance = calendar;
    calendar.render();

    // New event button
    const newBtn = qs('#newEventBtn');
    if (newBtn){
      newBtn.addEventListener('click', ()=> {
        lastViewedEvent = null;
        updateEditButtonState();
        const defaults = { status:'scheduled', event_type: defaultTypeForCurrentRole() };
        if (lastSelectedDate) defaults.preset_date = lastSelectedDate;
        if (role()==='recipient'){
          defaults.event_type = 'recipient';
          defaults.recipient_id = userId();
          defaults.recipients = [{ id: userId(), text: currentUserOrganization() }];
        }
        openModal(defaults);
      });
    }
    qs('#refreshCalBtn')?.addEventListener('click', ()=> {
      refreshVisibleRange();
    });

    // Save
    qs('#saveEventBtn')?.addEventListener('click', async ()=>{
      try{
        const data = collectForm();
        if (!data) { calendarToast('You do not have permission to save this event type', 'warn'); return; }
        // Batched recipient payloads
        if (Array.isArray(data)){
          const payloads = data.filter(p => p && p.title && p.start && Array.isArray(p.recipient_ids) && p.recipient_ids.length);
          if (!payloads.length) { calendarToast('Add at least one recipient with a date and time', 'warn'); return; }
          let minStart = null;
          for (const p of payloads){
            await createEvent(p);
            const st = new Date(p.start); if (!minStart || st < minStart) minStart = st;
          }
          if (minStart){
            const dateKey = getDateKey(minStart.toISOString());
            if (dateKey) {
              lastSelectedDate = dateKey;
              const startDate = new Date(`${dateKey}T00:00:00`);
              if (!Number.isNaN(startDate)) calendarInstance?.gotoDate(startDate);
            }
          }
          bootstrap.Modal.getInstance(qs('#eventModal'))?.hide();
          calendarToast('Events saved', 'success');
          refreshVisibleRange();
          return;
        }
        // Single payload flow
        if (!data.title) { calendarToast('Title is required', 'warn'); return; }
        const isRecipientSingle = String(data.event_type||'').toLowerCase() === 'recipient';
        if (!isRecipientSingle) {
          const needsDate = !data.start;
          const donorDate = document.getElementById('donorDate')?.value || '';
          const adminDate = document.getElementById('adminDate')?.value || '';
          const hasDate = Boolean((donorDate || adminDate));
          if (!hasDate) {
            calendarToast('Pickup date is required', 'warn');
            return;
          }
          const donorTime = document.getElementById('donorStartTime')?.value || '';
          const adminStart = document.getElementById('adminStartTime')?.value || '';
          const hasTime = Boolean(donorTime || adminStart);
          if (!hasTime) {
            calendarToast('Start time is required', 'warn');
            return;
          }
          if (needsDate) {
            calendarToast('Pickup date and time are required', 'warn');
            return;
          }
        }
        if (data.id){
          if (!canEditEvent(normalizeEventData(data))) { calendarToast('You do not have permission to update this event', 'warn'); return; }
          await updateEvent(data.id, data);
        } else {
          const created = await createEvent(data);
          const newId = Number(created?.id ?? created?.event_id);
          if (Number.isFinite(newId)) {
            data.id = newId;
            selectedEventId = newId;
          }
        }
        const dateKey = getDateKey(data.start);
        if (dateKey) {
          lastSelectedDate = dateKey;
          const startDate = new Date(`${dateKey}T00:00:00`);
          if (!Number.isNaN(startDate)) {
            calendarInstance?.gotoDate(startDate);
          }
        }
        bootstrap.Modal.getInstance(qs('#eventModal'))?.hide();
        calendarToast('Event saved', 'success');
        refreshVisibleRange();
      } catch(e){ calendarToast(e.message || 'Failed to save event', 'error'); }
    });

    // Delete
    qs('#deleteEventBtn')?.addEventListener('click', async ()=>{
      try{
        const id = Number(qs('#evId').value||0)||0; if (!id) return;
        const evData = normalizeEventData({ id });
        if (!canEditEvent(evData)) { calendarToast('You do not have permission to delete this event', 'warn'); return; }
        const ok = await confirmModal({ title: 'Delete Event', message: 'Are you sure you want to delete this event? This action cannot be undone.', confirmText: 'Delete', confirmClass: 'btn-danger' });
        if (!ok) return;
        await deleteEvent(id);
        bootstrap.Modal.getInstance(qs('#eventModal'))?.hide();
        calendarToast('Event deleted', 'success');
        if (selectedEventId === id) {
          selectedEventId = null;
        }
        refreshVisibleRange();
      } catch(e){ calendarToast(e.message || 'Failed to delete event', 'error'); }
    });
  }

  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', init);
  } else { init(); }
})();
