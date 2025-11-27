let eventTypeButtons = [];
let eventTypeInputEl = null;
let recipientsLoadedFromPickup = false;

document.addEventListener('DOMContentLoaded', () => {
  initSchedulePickupUI();
  ensureBaseDefaults();
  updateRecipientSelections();
});

function ensureBaseDefaults(){
  const todayStr = new Date().toISOString().split('T')[0];
  const evDateInput = document.getElementById('evDate');
  if (evDateInput && !evDateInput.value) evDateInput.value = todayStr;

  const donorDateEl = document.getElementById('donorDate');
  if (donorDateEl && !donorDateEl.value) donorDateEl.value = todayStr;
  const adminDateEl = document.getElementById('adminDate');
  if (adminDateEl && !adminDateEl.value) adminDateEl.value = todayStr;

  const now = new Date();
  const nextHour = new Date(now.getTime() + 60 * 60 * 1000);
  const defaultTime = `${String(nextHour.getHours()).padStart(2, '0')}:${String(nextHour.getMinutes()).padStart(2, '0')}`;

  if (!isFromPickup()) {
    document.querySelectorAll('.recipient-date').forEach(input => {
      if (!input.value) input.value = todayStr;
    });
    document.querySelectorAll('.recipient-time').forEach(input => {
      if (!input.value) input.value = defaultTime;
    });
  }

  const donorTime = document.getElementById('donorStartTime');
  if (donorTime && !donorTime.value) donorTime.value = defaultTime;

  const adminStart = document.getElementById('adminStartTime');
  const adminEnd = document.getElementById('adminEndTime');
  if (adminStart && !adminStart.value) adminStart.value = defaultTime;
  if (adminEnd && !adminEnd.value) {
    const twoHours = new Date(nextHour.getTime() + 60 * 60 * 1000);
    adminEnd.value = `${String(twoHours.getHours()).padStart(2, '0')}:${String(twoHours.getMinutes()).padStart(2, '0')}`;
  }
}

// Top-level helpers for preloading recipients from distributionpickup.html
function isFromPickup(){
  try { return new URLSearchParams(window.location.search).get('from') === 'pickup'; } catch(_) { return false; }
}

function getPickupPayload(){
  let stored = null;
  try {
    const raw = window.sessionStorage ? window.sessionStorage.getItem('schedule_payload_from_pickup') : null;
    if (raw) stored = JSON.parse(raw);
  } catch(_) { stored = null; }
  if (!stored && window.__schedulePayloadFromPickup && typeof window.__schedulePayloadFromPickup === 'object') {
    stored = window.__schedulePayloadFromPickup;
  }
  return stored && Array.isArray(stored.recipients) ? stored : null;
}

async function resolveRecipientIdByName(name){
  try {
    if (!name) return null;
    const params = new URLSearchParams({ action:'list', role:'recipient', q: name });
    const res = await fetch(`/php/api/users/index.php?${params.toString()}`, { credentials:'include' });
    const j = await res.json().catch(()=>null);
    const items = Array.isArray(j?.data?.items) ? j.data.items : [];
    if (!items.length) return null;
    // Prefer exact organization_name match (case-insensitive), else first item
    const lower = String(name).trim().toLowerCase();
    const exact = items.find(u => String(u.organization_name||'').trim().toLowerCase() === lower || String(u.name||'').trim().toLowerCase() === lower);
    return Number(exact?.user_id || items[0]?.user_id) || null;
  } catch(_) { return null; }
}

async function getValidRecipientsFromPayload(payload){
  if (!payload || !Array.isArray(payload.recipients)) return [];
  const candidates = [];
  for (const r of payload.recipients){
    const allocs = Array.isArray(r.allocations) ? r.allocations : [];
    const hasNonCancelled = allocs.some(a => String(a.status || '').toLowerCase() !== 'cancelled');
    if (!hasNonCancelled) continue;
    let id = Number(r.recipient_id);
    const text = r.recipient_name || r.organization || (id ? `Recipient #${id}` : 'Recipient');
    if (!Number.isFinite(id) || id <= 0){
      // Try to resolve by name
      id = await resolveRecipientIdByName(text);
    }
    if (Number.isFinite(id) && id > 0) candidates.push({ id, text });
  }
  // Deduplicate by id
  const seen = new Set();
  return candidates.filter(x => { if (seen.has(x.id)) return false; seen.add(x.id); return true; });
}

async function tryAutoPopulateRecipientsFromPickup(){
  if (recipientsLoadedFromPickup || !isFromPickup()) return;
  const payload = getPickupPayload();
  if (!payload) return;
  const recs = await getValidRecipientsFromPayload(payload);
  if (!recs.length) return;

  const container = document.getElementById('recipientSelections');
  if (!container) return;

  const blocks = () => Array.from(container.querySelectorAll('.recipient-selection'));
  while (blocks().length < recs.length) addRecipientField();

  const modalDate = document.getElementById('evDate')?.value || '';

  blocks().forEach((blk, idx) => {
    const rec = recs[idx];
    if (!rec) return;
    const select = blk.querySelector('.recipient-select');
    if (!select) return;
    initRecipientSelect(select);

    let option = select.querySelector(`option[value="${rec.id}"]`);
    if (!option) {
      option = new Option(rec.text, rec.id, true, true);
      select.appendChild(option);
    }

    if (typeof window.$ === 'function' && window.$.fn?.select2) {
      const $sel = window.$(select);
      $sel.val(String(rec.id)).trigger('change');
      $sel.trigger({ type: 'select2:select', params: { data: { id: rec.id, text: rec.text, contact: 'N/A', phone: 'N/A', lastPickup: 'Never' } } });
    } else {
      select.value = String(rec.id);
    }

    const dateEl = blk.querySelector('.recipient-date');
    if (dateEl) dateEl.value = modalDate;
    const timeEl = blk.querySelector('.recipient-time');
    if (timeEl) timeEl.value = '';
  });

  updateRecipientSelections();
  recipientsLoadedFromPickup = true;
}

function initSchedulePickupUI() {
  // Event type buttons
  eventTypeButtons = Array.from(document.querySelectorAll('.event-type-btn'));
  eventTypeInputEl = document.getElementById('evType');
  
  // Initialize event type buttons
  eventTypeButtons.forEach(button => {
    button.addEventListener('click', function() {
      // Update active state
      const type = this.dataset.type;
      setEventType(type);
    });
  });
  
  // Set default to recipient pickup
  setEventType('admin');

  // Add recipient button
  const addRecipientBtn = document.getElementById('addAnotherRecipient');
  if (addRecipientBtn) {
    addRecipientBtn.addEventListener('click', addRecipientField);
  }
  
  // Initialize date and time pickers
  initDateTimePickers();
  
  // Initialize form submission
  const eventForm = document.getElementById('eventForm');
  if (eventForm) {
  }
  
  // Initialize delete button
  const deleteBtn = document.getElementById('deleteEventBtn');
  if (deleteBtn) {
    deleteBtn.addEventListener('click', handleDeleteEvent);
  }

  initDonorSelect();

  // Initialize existing recipient selects with Select2 (for the initial block)
  document.querySelectorAll('.recipient-select').forEach((sel)=>{
    if (typeof window.$ === 'function' && window.$.fn?.select2) {
      const $el = window.$(sel);
      if (!$el.data('select2')) initRecipientSelect(sel);
    }
  });

  // Delegate changes from recipient date/time to keep hidden JSON in sync
  const recContainer = document.getElementById('recipientSelections');
  if (recContainer){
    recContainer.addEventListener('change', (e)=>{
      const t = e.target;
      if (t && (t.classList.contains('recipient-date') || t.classList.contains('recipient-time') || t.classList.contains('recipient-select'))){
        updateRecipientSelections();
      }
    });
    recContainer.addEventListener('input', (e)=>{
      const t = e.target;
      if (t && (t.classList.contains('recipient-date') || t.classList.contains('recipient-time'))){
        updateRecipientSelections();
      }
    });
  }

  const donorTimeInput = document.getElementById('donorStartTime');
  if (donorTimeInput) {
    donorTimeInput.addEventListener('change', updateDonorData);
  }

  const adminStartInput = document.getElementById('adminStartTime');
  const adminEndInput = document.getElementById('adminEndTime');
  if (adminStartInput) {
    adminStartInput.addEventListener('change', () => {
      if (adminEndInput && adminEndInput.value && adminEndInput.value < adminStartInput.value) {
        adminEndInput.value = adminStartInput.value;
      }
    });
  }
  if (adminEndInput) {
    adminEndInput.addEventListener('change', () => {
      if (adminStartInput && adminEndInput.value && adminEndInput.value < adminStartInput.value) {
        adminStartInput.value = adminEndInput.value;
      }
    });
  }

  // When the modal opens from distribution pickup, switch to Recipient and auto-populate
  const modalEl = document.getElementById('eventModal');
  if (modalEl) {
    modalEl.addEventListener('shown.bs.modal', () => {
      if (isFromPickup()) {
        setEventType('recipient');
        // Delay to ensure select2 is fully mounted
        setTimeout(() => tryAutoPopulateRecipientsFromPickup(), 0);
      }
    });
  }
}

function setEventType(type) {
  setActiveEventTypeButton(type);
  if (eventTypeInputEl) eventTypeInputEl.value = type;
  setEventTypeUI(type);
  if (type === 'donor') {
    updateDonorData();
  }
  if (type === 'recipient') {
    tryAutoPopulateRecipientsFromPickup();
  }
}

function setActiveEventTypeButton(type) {
  if (!eventTypeButtons.length) return;
  eventTypeButtons.forEach((btn) => {
    const isActive = btn.dataset.type === type;
    btn.classList.toggle('active', isActive);
    if (isActive) {
      btn.classList.remove('btn-outline-secondary');
      if (type === 'recipient') {
        btn.classList.add('btn-primary');
        btn.classList.remove('btn-secondary');
      } else {
        btn.classList.add('btn-secondary');
        btn.classList.remove('btn-primary');
      }
    } else {
      btn.classList.add('btn-outline-secondary');
      btn.classList.remove('btn-primary');
      btn.classList.remove('btn-secondary');
    }
  });
}

function setEventTypeUI(type) {
  const recipientSection = document.getElementById('wrapRecipient');
  const donorSection = document.getElementById('wrapDonor');
  const adminTimes = document.getElementById('wrapAdminTimes');
  const pickupDetails = document.getElementById('wrapPickupDetails');
  const locationInput = document.getElementById('evLocation');
  
  const showSection = (el) => {
    if (!el) return;
    el.classList.remove('d-none');
    el.style.removeProperty('display');
  };
  const hideSection = (el) => {
    if (!el) return;
    el.classList.add('d-none');
    el.style.display = 'none';
  };

  switch(type) {
    case 'recipient':
      // Show recipient-specific UI
      showSection(recipientSection);
      hideSection(donorSection);
      hideSection(adminTimes);
      if (pickupDetails) {
        pickupDetails.querySelector('.card-header h6').textContent = 'Pickup Details';
        pickupDetails.querySelector('label[for="evLocation"]').textContent = 'Pickup Location';
      }
      if (locationInput) {
        locationInput.value = 'Warehouse';
      }
      break;
      
    case 'donor':
      // Show donor-specific UI
      hideSection(recipientSection);
      showSection(donorSection);
      hideSection(adminTimes);
      if (pickupDetails) {
        pickupDetails.querySelector('.card-header h6').textContent = 'Pickup Information';
        pickupDetails.querySelector('label[for="evLocation"]').textContent = 'Pickup Address';
      }
      if (locationInput) {
        locationInput.value = '';
      }
      break;
      
    case 'admin':
      // Show admin event UI
      hideSection(recipientSection);
      hideSection(donorSection);
      showSection(adminTimes);
      if (pickupDetails) {
        pickupDetails.querySelector('.card-header h6').textContent = 'Event Details';
        pickupDetails.querySelector('label[for="evLocation"]').textContent = 'Location';
      }
      if (locationInput) {
        locationInput.value = 'Warehouse';
      }
      break;
  }
}

function initRecipientSelect(selectEl) {
  if (!selectEl) return;
  const $sel = window.$ ? window.$(selectEl) : null;
  if (!$sel || !$sel.select2) return;
  $sel.select2({
    dropdownParent: window.$('#eventModal'),
    placeholder: 'Search recipients...',
    allowClear: true,
    width: '100%',
    ajax: {
      url: '/php/api/users/index.php',
      dataType: 'json',
      delay: 250,
      xhrFields: { withCredentials: true },
      data: function (params) {
        return { action: 'list', role: 'recipient', q: params.term || '' };
      },
      processResults: function (data) {
        const items = (data?.data?.items) || [];
        return { results: items.map(u => ({
          id: u.user_id,
          text: u.organization_name || u.name || (`Recipient #${u.user_id}`),
          contact: u.contact_person || 'N/A',
          phone: u.phone || 'N/A',
          lastPickup: 'Never'
        })) };
      },
      error: function(xhr){ try{ console.warn('Recipient search failed', xhr?.status, xhr?.responseText); }catch(_){} },
      cache: true
    },
    minimumInputLength: 1
  }).on('select2:select', function(e) {
    const data = e.params?.data;
    const details = this.closest('.recipient-selection')?.querySelector('.recipient-details');
    if (details) {
      details.querySelector('.recipient-contact').textContent = `${data.contact} (${data.phone})`;
      details.querySelector('.recipient-last-pickup').textContent = data.lastPickup;
      details.style.display = 'block';
    }
    updateRecipientSelections();
  }).on('select2:clear', function(){
    updateRecipientSelections();
  }).on('change', function(){
    updateRecipientSelections();
  });
}

function addRecipientField() {
  const recipientSelections = document.getElementById('recipientSelections');
  if (!recipientSelections) return;
  
  const now = new Date();
  const nextHour = new Date(now.getTime() + 60 * 60 * 1000);
  const defaultDate = now.toISOString().split('T')[0];
  const defaultTime = `${String(nextHour.getHours()).padStart(2, '0')}:${String(nextHour.getMinutes()).padStart(2, '0')}`;
  
  const newRecipient = document.createElement('div');
  newRecipient.className = 'recipient-selection mb-3 p-3 border rounded';
  newRecipient.innerHTML = `
    <div class="d-flex align-items-center gap-2">
      <div class="flex-grow-1" style="min-width: 300px;">
        <select class="form-select recipient-select" data-placeholder="Search recipients...">
          <option></option>
          <!-- Options will be loaded dynamically -->
        </select>
      </div>
      <button type="button" class="btn btn-sm btn-outline-danger remove-recipient" style="height: 38px;">
        <i class="bi bi-x-lg"></i>
      </button>
    </div>
    <div class="recipient-details mt-2 p-2 bg-light rounded">
      <div class="d-flex justify-content-between small mb-2">
        <span>Contact: <span class="recipient-contact text-muted">Not selected</span></span>
        <span>Last Pickup: <span class="recipient-last-pickup text-muted">Never</span></span>
      </div>
      <div class="row g-2">
        <div class="col-md-6">
          <label class="form-label small text-muted mb-1">Pickup Date</label>
          <input type="date" class="form-control form-control-sm recipient-date" value="${defaultDate}" required>
        </div>
        <div class="col-md-6">
          <label class="form-label small text-muted mb-1">Start Time</label>
          <input type="time" class="form-control form-control-sm recipient-time" value="${defaultTime}" required>
        </div>
      </div>
    </div>
  `;
  
  recipientSelections.appendChild(newRecipient);
  
  // Initialize select2 for the new recipient select
  initRecipientSelect(newRecipient.querySelector('.recipient-select'));
  
  // Add remove button handler
  const removeBtn = newRecipient.querySelector('.remove-recipient');
  if (removeBtn) {
    removeBtn.addEventListener('click', function() {
      if (recipientSelections.children.length > 1) {
        newRecipient.remove();
        updateRecipientSelections();
      }
    });
  }
  
  updateRecipientSelections();
}

function updateRecipientSelections() {
  const recipientSelections = document.getElementById('recipientSelections');
  if (!recipientSelections) return;
  
  // Enable/disable remove buttons based on number of recipients
  const removeButtons = recipientSelections.querySelectorAll('.remove-recipient');
  removeButtons.forEach((btn, index) => {
    btn.disabled = removeButtons.length <= 1;
  });
  
  // Update hidden input with selected recipients
  const selectedRecipients = [];
  document.querySelectorAll('.recipient-select').forEach(select => {
    if (select.value) {
      const recipientSelection = select.closest('.recipient-selection');
      const date = recipientSelection.querySelector('.recipient-date').value;
      const time = recipientSelection.querySelector('.recipient-time').value;
      
      selectedRecipients.push({
        id: select.value,
        name: select.options[select.selectedIndex].text,
        date: date,
        time: time,
        // Combine date and time for sorting/display
        datetime: date && time ? `${date}T${time}` : null
      });
    }
  });
  
  const recipientsInput = document.getElementById('evRecipients');
  if (recipientsInput) {
    recipientsInput.value = JSON.stringify(selectedRecipients);
  }
  
  // Update donor/admin timing data
  updateDonorData();
}

function resetRecipientFields(options = {}) {
  const { date = '', time = '', clearAdditional = true } = options;
  const container = document.getElementById('recipientSelections');
  if (!container) return;

  const blocks = Array.from(container.querySelectorAll('.recipient-selection'));
  if (!blocks.length) {
    addRecipientField();
  }

  const refreshedBlocks = Array.from(container.querySelectorAll('.recipient-selection'));
  refreshedBlocks.forEach((block, idx) => {
    if (idx > 0 && clearAdditional) {
      block.remove();
      return;
    }

    const select = block.querySelector('.recipient-select');
    if (select) {
      if (typeof window.$ === 'function' && window.$.fn?.select2) {
        const $sel = window.$(select);
        if ($sel.data('select2')) {
          $sel.val(null).trigger('change');
        } else {
          select.value = '';
        }
      } else {
        select.value = '';
      }

      Array.from(select.options).forEach((opt, optionIndex) => {
        if (optionIndex === 0) return;
        if (opt.value) opt.remove();
      });
    }

    const contactEl = block.querySelector('.recipient-contact');
    if (contactEl) contactEl.textContent = 'Not selected';
    const pickupEl = block.querySelector('.recipient-last-pickup');
    if (pickupEl) pickupEl.textContent = 'Never';
    const detailWrap = block.querySelector('.recipient-details');
    if (detailWrap) detailWrap.style.removeProperty('display');

    const dateInput = block.querySelector('.recipient-date');
    if (dateInput && date !== null) {
      dateInput.value = date;
    }
    const timeInput = block.querySelector('.recipient-time');
    if (timeInput && time !== null) {
      timeInput.value = time;
    }
  });

  recipientsLoadedFromPickup = false;
  updateRecipientSelections();
}

function updateDonorData() {
  const donorSelect = document.getElementById('evDonor');
  const donorTime = document.getElementById('donorStartTime');
  const donorInput = document.getElementById('evDonorData');
  
  if (donorSelect && donorInput) {
    if (donorSelect.value) {
      donorInput.value = JSON.stringify({
        id: donorSelect.value,
        name: donorSelect.options[donorSelect.selectedIndex].text,
        time: donorTime ? donorTime.value : null
      });
    } else {
      donorInput.value = '';
    }
  }
}

function initDonorSelect() {
  const donorSelectEl = document.getElementById('evDonor');
  if (!donorSelectEl) return;

  const $donor = $(donorSelectEl).select2({
    dropdownParent: $('#eventModal'),
    placeholder: 'Search donors...',
    allowClear: true,
    width: '100%',
    ajax: {
      url: '/php/api/users/index.php',
      dataType: 'json',
      delay: 250,
      xhrFields: { withCredentials: true },
      data: (params) => ({ action: 'list', role: 'donor', q: params.term || '' }),
      processResults: (data) => {
        const items = (data?.data?.items) || [];
        return { results: items.map(u => ({
          id: u.user_id,
          text: u.organization_name || u.name || (`Donor #${u.user_id}`),
          address: u.address || null
        })) };
      },
      error: function(xhr){ try{ console.warn('Donor search failed', xhr?.status, xhr?.responseText); }catch(_){} },
      cache: true
    },
    minimumInputLength: 1
  });

  $donor.on('select2:select', function(e) {
    updateDonorData();
    const locInput = document.getElementById('evLocation');
    const data = e.params && e.params.data;
    if (locInput && data && data.address) {
      locInput.value = data.address;
    }
  });
  $donor.on('select2:clear', function() {
    updateDonorData();
    const locInput = document.getElementById('evLocation');
    if (locInput) {
      locInput.value = '';
    }
  });

  donorSelectEl.addEventListener('change', updateDonorData);
}

function initDateTimePickers() {
  // Set minimum date to today for all date inputs
  const today = new Date().toISOString().split('T')[0];
  document.querySelectorAll('.recipient-date').forEach(input => {
    input.min = today;
    if (!isFromPickup() && !input.value) { input.value = today; }
  });
  
  // Set default time to next hour for all time inputs
  const now = new Date();
  const nextHour = new Date(now.getTime() + 60 * 60 * 1000);
  const defaultTime = `${String(nextHour.getHours()).padStart(2, '0')}:${String(nextHour.getMinutes()).padStart(2, '0')}`;
  
  document.querySelectorAll('.recipient-time').forEach(input => {
    if (!isFromPickup() && !input.value) { input.value = defaultTime; }
  });

  const donorTime = document.getElementById('donorStartTime');
  if (donorTime && !donorTime.value) donorTime.value = defaultTime;

  const adminStart = document.getElementById('adminStartTime');
  const adminEnd = document.getElementById('adminEndTime');
  if (adminStart && !adminStart.value) adminStart.value = defaultTime;
  if (adminEnd && !adminEnd.value) {
    const twoHours = new Date(nextHour.getTime() + 60 * 60 * 1000);
    adminEnd.value = `${String(twoHours.getHours()).padStart(2, '0')}:${String(twoHours.getMinutes()).padStart(2, '0')}`;
  }
}

// Date/time now handled per recipient, no need for global update functions

function handleEventFormSubmit(e) {
  e.preventDefault();
  
  // Show loading state
  const submitBtn = document.querySelector('#eventForm [type="submit"]');
  const originalBtnText = submitBtn.innerHTML;
  submitBtn.disabled = true;
  submitBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-1" role="status" aria-hidden="true"></span> Saving...';
  
  // Collect form data
  const type = document.getElementById('evType').value;
  const recipients = JSON.parse(document.getElementById('evRecipients').value || '[]');
  const donorDataRaw = document.getElementById('evDonorData').value;
  const donorData = donorDataRaw ? JSON.parse(donorDataRaw) : null;
  const adminStart = document.getElementById('adminStartTime') ? document.getElementById('adminStartTime').value : null;
  const adminEnd = document.getElementById('adminEndTime') ? document.getElementById('adminEndTime').value : null;

  if (type === 'recipient' && recipients.length === 0) {
    alert('Please add at least one recipient with a scheduled time.');
    submitBtn.innerHTML = originalBtnText;
    submitBtn.disabled = false;
    return;
  }

  if (type === 'donor' && (!donorData || !donorData.id || !donorData.time)) {
    alert('Please select a donor and provide a start time.');
    submitBtn.innerHTML = originalBtnText;
    submitBtn.disabled = false;
    return;
  }

  if (type === 'admin' && (!adminStart || !adminEnd)) {
    alert('Please provide both start and end times for the admin event.');
    submitBtn.innerHTML = originalBtnText;
    submitBtn.disabled = false;
    return;
  }

  const formData = {
    id: document.getElementById('evId').value || null,
    title: document.getElementById('evTitle').value,
    type,
    location: document.getElementById('evLocation').value,
    notes: document.getElementById('evNotes').value
  };

  if (type === 'recipient') {
    formData.recipients = recipients;
  } else if (type === 'donor') {
    formData.donor = donorData;
  } else if (type === 'admin') {
    formData.adminTimes = { start: adminStart, end: adminEnd };
  }
  
  // Simulate API call (replace with actual API call)
  setTimeout(() => {
    console.log('Form submitted:', formData);
    
    // Reset form and show success message
    submitBtn.innerHTML = originalBtnText;
    submitBtn.disabled = false;
    
    // Show success message
    const toast = document.createElement('div');
    toast.className = 'position-fixed bottom-0 end-0 m-3 alert alert-success alert-dismissible fade show';
    toast.role = 'alert';
    toast.innerHTML = `
      <i class="bi bi-check-circle-fill me-2"></i>
      <strong>Success!</strong> Event ${formData.id ? 'updated' : 'created'} successfully.
      <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
    `;
    document.body.appendChild(toast);
    
    // Auto-dismiss after 3 seconds
    setTimeout(() => {
      const bsAlert = new bootstrap.Alert(toast);
      bsAlert.close();
    }, 3000);
    
    // Close modal if open
    const modal = bootstrap.Modal.getInstance(document.getElementById('eventModal'));
    if (modal) modal.hide();
    
  }, 1000);
}

function handleDeleteEvent() {
  if (!confirm('Are you sure you want to delete this event? This action cannot be undone.')) {
    return;
  }
  
  const eventId = document.getElementById('evId').value;
  if (!eventId) return;
  
  // Show loading state
  const deleteBtn = document.getElementById('deleteEventBtn');
  const originalBtnText = deleteBtn.innerHTML;
  deleteBtn.disabled = true;
  deleteBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-1" role="status" aria-hidden="true"></span> Deleting...';
  
  // Simulate API call (replace with actual API call)
  setTimeout(() => {
    console.log('Deleting event:', eventId);
    
    // Reset button
    deleteBtn.innerHTML = originalBtnText;
    deleteBtn.disabled = false;
    
    // Show success message
    const toast = document.createElement('div');
    toast.className = 'position-fixed bottom-0 end-0 m-3 alert alert-success alert-dismissible fade show';
    toast.role = 'alert';
    toast.innerHTML = `
      <i class="bi bi-check-circle-fill me-2"></i>
      <strong>Success!</strong> Event deleted successfully.
      <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
    `;
    document.body.appendChild(toast);
    
    // Auto-dismiss after 3 seconds
    setTimeout(() => {
      const bsAlert = new bootstrap.Alert(toast);
      bsAlert.close();
    }, 3000);
    
    // Close modal
    const modal = bootstrap.Modal.getInstance(document.getElementById('eventModal'));
    if (modal) modal.hide();
    
    // Refresh calendar or remove event from view
    if (window.calendar) {
      window.calendar.refetchEvents();
    }
    
  }, 1000);
}

// Make functions available globally
window.SchedulePickupUI = {
  init: initSchedulePickupUI,
  addRecipientField,
  updateRecipientSelections,
  resetRecipientFields,
  handleEventFormSubmit,
  handleDeleteEvent,
  updateUI: setEventTypeUI,
  setType: setEventType,
  updateDonorData
};
