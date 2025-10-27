(function(){
  'use strict';

  const API_BASE_URL = (typeof window.API_BASE_URL === 'string' && window.API_BASE_URL)
    ? window.API_BASE_URL
    : '/php/api';

  const qs = (s, r=document)=> r.querySelector(s);

  function getUser(){
    try{ const s = sessionStorage.getItem('user'); return s ? JSON.parse(s) : null; }catch(_){ return null; }
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
  function role(){ return ((getUser()?.role)||'').toLowerCase(); }
  function userId(){ return Number(getUser()?.user_id || getUser()?.id || 0) || 0; }

  function showMsg(el, msg, type){ if (!el) return; try{ el.innerHTML = msg ? `<div class="alert alert-${type} py-2 mb-0">${msg}</div>` : ''; }catch(_){} }
  function showCalModal(message){
    try{
      // If the Event modal is open, hide it first to avoid stacking underlay
      const ev = document.getElementById('eventModal');
      if (ev && ev.classList.contains('show')){
        try{ bootstrap.Modal.getInstance(ev)?.hide(); } catch(_){ }
      }
      const mEl = document.getElementById('calAlertModal');
      const bEl = document.getElementById('calAlertBody');
      if (bEl) bEl.textContent = String(message||'');
      if (mEl){ const m = bootstrap.Modal.getOrCreateInstance(mEl); m.show(); }
    } catch(_){ /* fallback no-op */ }
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
    const mEl = qs('#eventModal'); if (!mEl) return;
    const m = bootstrap.Modal.getOrCreateInstance(mEl);
    // Reset modal to a clean baseline to avoid leakage from previous event
    try{
      // Remove injected recipient-only display blocks
      const inj = ['evRecipientName','evRecipientAddress'];
      inj.forEach(id=>{ const el = document.getElementById(id); if (el && el.parentNode) el.parentNode.removeChild(el); });
      // Restore default labels
      const startInput0 = qs('#evStart');
      if (startInput0){ const lbl0 = startInput0.closest('.mb-2')?.querySelector('label'); if (lbl0) lbl0.textContent = 'Start'; }
      // Restore wrappers' visibility
      const recWrap0 = qs('#wrapRecipient'); if (recWrap0) recWrap0.style.display = '';
      const donWrap0 = qs('#wrapDonor'); if (donWrap0) donWrap0.style.display = '';
      const loc0 = qs('#evLocation'); if (loc0){ const w = loc0.closest('.mt-2') || loc0.parentElement; if (w) w.style.display = ''; }
      // Re-enable all form controls by default (role logic will adjust afterward)
      const form0 = qs('#eventForm'); if (form0){ form0.querySelectorAll('input,select,textarea,button').forEach(c=>{ if (c.id !== 'deleteEventBtn') c.disabled = false; }); }
    }catch(_){ }
    // Populate
    qs('#evId').value = data?.id || '';
    qs('#evTitle').value = data?.title || '';
    // Populate start/end using robust formatter for datetime-local (avoid using any external arg)
    const startVal = data?.start || '';
    const endVal = data?.end || '';
    const evStartEl = qs('#evStart'); if (evStartEl) evStartEl.value = toDatetimeLocal(startVal);
    const evEndEl = qs('#evEnd'); if (evEndEl) evEndEl.value = toDatetimeLocal(endVal);
    qs('#evRecipient').value = data?.recipient_id || '';
    qs('#evDonor').value = data?.donor_id || '';
    qs('#evLocation').value = data?.location || '';
    qs('#evNotes').value = data?.notes || '';

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
        const r = role();
        if (r==='recipient') {
          hint.textContent = 'Recipients: Bookings allowed 10:00–16:00. If a donor is booked, recipient must wait 3 hours after the latest donor booking that day.';
        } else if (r==='donor') {
          hint.textContent = 'Donors: Only one booking per day. No past-date bookings.';
        } else {
          hint.textContent = 'Scheduling rules: No creating events in the past. Recipients: 10:00–16:00 window and 3 hours after donor; Donors: one per day.';
        }
      }catch(_){ }
    })();

    // Event type handling
    const typeSel = qs('#evType');
    const wrapRec = qs('#wrapRecipient');
    const wrapDon = qs('#wrapDonor');
    const wrapDtDefault = qs('#wrapDateTimeDefault');
    const wrapDtAdmin = qs('#wrapDateTimeAdmin');
    const wrapStatus = qs('#wrapStatus');
    const donorSelect = qs('#evDonorSelect');
    // Initialize Select2 for donor search if available and admin
    function ensureDonorSelect() {
      if (!donorSelect) return;
      if (typeof $ === 'function' && $(donorSelect).select2 && !$(donorSelect).data('select2')){
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
              return { results: items.map(u=>({ id: u.user_id, text: u.organization_name || u.name || ('Donor #'+u.user_id) })) };
            },
            error: function(xhr){
              try {
                const msg = xhr?.responseJSON?.error || `HTTP ${xhr?.status||''}` || 'Failed to load donors';
              } catch(_) { /* ignore */ }
            }
          },
          minimumInputLength: 1
        });
      }
    }
    function setDonorSelectValue(id, text){
      if (!donorSelect || typeof $ !== 'function' || !$(donorSelect).select2) return;
      const option = new Option(text || ('Donor #'+id), id, true, true);
      $(donorSelect).append(option).trigger('change');
    }
    function inferTypeFromData(d){
      if (!d) return 'admin';
      if (d.recipient_id) return 'recipient';
      if (d.donor_id) return 'donor';
      return 'admin';
    }
    function applyTypeUI(t){
      const rNow = role();
      // Recipient ID shown only to admin when setting recipient-type events
      if (wrapRec) wrapRec.style.display = (t==='recipient' && rNow==='admin') ? '' : 'none';
      // Donor selector visible only for admin when scheduling donor pickups
      if (wrapDon) wrapDon.style.display = (t==='donor' && rNow==='admin') ? '' : 'none';
      if (wrapDtDefault) wrapDtDefault.style.display = (rNow==='admin' && t==='donor') ? 'none' : '';
      if (wrapDtAdmin) wrapDtAdmin.style.display = (rNow==='admin' && t==='donor') ? '' : 'none';
      if (wrapStatus) wrapStatus.style.display = (rNow==='admin') ? 'none' : '';
      // Donor/Recipient do not use End time; hide its column
      const endInput = qs('#evEnd');
      const endCol = endInput ? endInput.closest('.col-6') : null;
      if (endCol) {
        if (rNow==='donor' || rNow==='recipient' || rNow==='admin') {
          endCol.style.display = 'none';
          if (endInput) endInput.value = '';
        } else {
          endCol.style.display = '';
        }
      }
      // Hide Location for recipients
      const locInput = qs('#evLocation');
      if (locInput) {
        const locWrap = locInput.closest('.mt-2') || locInput.parentElement;
        if (rNow==='recipient') { if (locWrap) locWrap.style.display = 'none'; locInput.value = ''; }
        else { if (locWrap) locWrap.style.display = ''; }
      }
      if (t==='donor' && rNow==='admin') { ensureDonorSelect(); }
    }
    const r = role();
    let initType = inferTypeFromData(data);
    if (typeSel){
      // Restrict options based on role
      const allowOptions = (r==='admin') ? ['admin','donor','recipient'] : (r==='donor') ? ['donor'] : (r==='recipient') ? ['recipient'] : ['admin'];
      // Remove disallowed options from the select
      Array.from(typeSel.options).forEach(opt=>{ if (!allowOptions.includes(opt.value)) opt.remove(); });
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

    // If editing an existing admin-created donor pickup, try set donor select (use donor_display when available)
    if (r==='admin' && donorSelect && data?.donor_id){
      ensureDonorSelect();
      setDonorSelectValue(data.donor_id, data.donor_display || data.donor_name || undefined);
    }

    // Role-based controls
    // r already computed above
    const myId = userId();
    const isOwner = data?.created_by ? Number(data.created_by) === myId : true;
    const involved = (r==='admin') || (r==='donor' && (Number(data?.donor_id||0)===myId || isOwner)) || (r==='recipient' && (Number(data?.recipient_id||0)===myId || isOwner));
    // Admins can generally edit, EXCEPT recipient schedules should be read-only for admins
    const isRecipientEvent = !!(data?.recipient_id);
    let canEdit = (r==='admin') ? !isRecipientEvent : involved;

    ['evTitle','evStart','evEnd','evRecipient','evDonor','evLocation','evNotes'].forEach(id=>{
      const el = qs('#'+id); if (el) el.disabled = !canEdit;
    });
    const delBtn = qs('#deleteEventBtn'); if (delBtn) delBtn.style.display = (canEdit && data?.id) ? '' : 'none';
    const saveBtn = qs('#saveEventBtn'); if (saveBtn) saveBtn.disabled = !canEdit;
    // Additionally, prevent changing Event Type when admin views recipient events
    if (r==='admin' && isRecipientEvent && typeSel){ typeSel.disabled = true; }
    // For admin viewing recipient events: hide numeric Recipient ID, show name read-only
    try {
      if (r==='admin' && isRecipientEvent){
        const recInput = qs('#evRecipient');
        const recWrap = recInput ? recInput.closest('.col-6') : null;
        if (recWrap) recWrap.style.display = 'none';
        let disp = document.getElementById('evRecipientName');
        if (!disp){
          disp = document.createElement('div');
          disp.id = 'evRecipientName';
          disp.className = 'mb-2';
          disp.innerHTML = '<label class="form-label mb-1">Recipient</label><input type="text" class="form-control form-control-sm" disabled />';
          const row = recWrap ? recWrap.parentElement : qs('#eventForm');
          if (row) row.insertBefore(disp, (recWrap? recWrap.nextSibling : row.firstChild));
        }
        const input = disp.querySelector('input');
        if (input) input.value = data?.recipient_display || data?.recipient_name || ('Recipient #'+ String(data?.recipient_id||''));
        // Address display
        let addr = document.getElementById('evRecipientAddress');
        if (!addr){
          addr = document.createElement('div');
          addr.id = 'evRecipientAddress';
          addr.className = 'mb-2';
          addr.innerHTML = '<label class="form-label mb-1">Address/Location</label><input type="text" class="form-control form-control-sm" disabled />';
          const row = disp.parentElement || qs('#eventForm');
          if (row) row.insertBefore(addr, disp.nextSibling);
        }
        const addrInput = addr.querySelector('input');
        if (addrInput) addrInput.value = data?.recipient_address || data?.location || '';
        // Change Start label to Date & Time
        const startInput = qs('#evStart');
        if (startInput){
          const lbl = startInput.closest('.mb-2')?.querySelector('label');
          if (lbl) lbl.textContent = 'Date & Time';
        }
        // Hide Location field for admin on recipient entries
        const locInputAdmin = qs('#evLocation');
        if (locInputAdmin){
          const locWrapAdmin = locInputAdmin.closest('.mt-2') || locInputAdmin.parentElement;
          if (locWrapAdmin) locWrapAdmin.style.display = 'none';
          locInputAdmin.value = '';
        }
      }
    } catch(_){ }

    // Prefill separate date/time inputs for admin donor-type UI
    try {
      const t = typeSel ? typeSel.value : inferTypeFromData(data);
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
    const t = (qs('#evType')?.value)||'admin';
    const r = role();
    const uid = userId();
    // Resolve donor from select2 if present
    let donorId = null;
    const donorSelect = qs('#evDonorSelect');
    if (donorSelect && donorSelect.value) donorId = Number(donorSelect.value);
    if (!donorId) { donorId = qs('#evDonor')?.value ? Number(qs('#evDonor').value) : null; }
    let recipientId = qs('#evRecipient').value ? Number(qs('#evRecipient').value) : null;
    // Enforce per role
    if (r==='donor') { donorId = uid; recipientId = null; }
    else if (r==='recipient') { recipientId = uid; donorId = null; }
    else if (r==='admin') {
      if (t==='admin'){ donorId = null; recipientId = null; }
      else if (t==='donor'){ recipientId = null; /* donorId from field */ }
      else if (t==='recipient'){ donorId = null; /* recipientId from field */ }
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
    // Build start/end: for admin 'donor' (Pickup), compose from evDate/evTime with no end
    let startIso;
    let endIso;
    if (r==='admin' && t==='donor'){
      const d = qs('#evDate')?.value;
      const tm = qs('#evTime')?.value || '09:00';
      if (d) {
        startIso = new Date(`${d}T${tm}`).toISOString();
        endIso = null;
      } else {
        // Fallback to datetime-local if not provided
        startIso = new Date(qs('#evStart').value).toISOString();
        endIso = qs('#evEnd').value ? new Date(qs('#evEnd').value).toISOString() : null;
      }
    } else {
      startIso = new Date(qs('#evStart').value).toISOString();
      endIso = qs('#evEnd').value ? new Date(qs('#evEnd').value).toISOString() : null;
    }

    return {
      id: qs('#evId').value || null,
      title: titleVal,
      start: startIso,
      end: endIso,
      recipient_id: recipientId,
      donor_id: donorId,
      location: qs('#evLocation').value.trim() || null,
      notes: qs('#evNotes').value.trim() || null,
      // status removed from UI; backend defaults to 'scheduled' if omitted
    };
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

    // Initialize calendar
    const calendarEl = document.getElementById('calendar');
    let lastItems = [];
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
      selectable: true,
      eventTimeFormat: { hour:'2-digit', minute:'2-digit', hour12:false },
      selectAllow: (selectionInfo)=> {
        // Disallow creating selections starting before today
        return selectionInfo.start >= startOfToday;
      },
      eventAllow: (dropInfo, draggedEvent)=> {
        // Prevent dragging/resizing events into the past
        const start = dropInfo.start; // Date
        return start >= startOfToday;
      },
      eventDidMount: (info)=>{
        // Make the event title itself a clickable link that opens the modal
        try{
          const titleEl = info.el.querySelector('.fc-event-title');
          if (titleEl && !titleEl.querySelector('a.ev-open')){
            const link = document.createElement('a');
            link.href = '#';
            link.className = 'ev-open';
            link.style.color = 'inherit';
            link.style.textDecoration = 'underline';
            // move existing title content inside the link
            while (titleEl.firstChild){ link.appendChild(titleEl.firstChild); }
            titleEl.appendChild(link);
            link.addEventListener('click', (e)=>{
              e.preventDefault(); e.stopPropagation();
              const ev = info.event;
              const data = { ...(ev.extendedProps||{}) };
              data.id = Number(ev.id);
              data.title = ev.title;
              data.start = ev.start?.toISOString();
              data.end = ev.end?.toISOString() || null;
              openModal(data);
            });
          }
        } catch(_){}
      },
      datesSet: async (info)=>{
        try{
          const items = await listEvents(info.startStr, info.endStr);
          lastItems = items;
          calendar.removeAllEvents();
          items.forEach(ev => {
            const mine = (Number(ev.created_by)===userId());
            const cls = [ mine ? 'event-owned' : 'event-assigned' ];
            let textColor;
            // Primary coloring rule: based on last editor's role (editor_role)
            const editor = (ev.editor_role||'').toLowerCase();
            if (editor === 'donor') { textColor = '#00a0b0'; }
            else if (editor === 'recipient') { textColor = '#ed3f34'; }
            else if (editor === 'admin') { textColor = '#76818d'; }
            else if (ev.is_busy) {
              // busy block for privacy
              textColor = '#6c757d';
            } else {
              // Fallback when editor_role is not available: color by role_type
              if (ev.role_type === 'donor') { textColor = '#00a0b0'; }
              else if (ev.role_type === 'recipient') { textColor = '#ed3f34'; }
              else { textColor = '#76818d'; }
            }
            calendar.addEvent({
              id: String(ev.id), title: ev.title,
              start: ev.start, end: ev.end || undefined,
              extendedProps: ev,
              classNames: cls,
              textColor
            });
          });
        } catch(e){ showCalModal(e.message || 'Failed to load events'); }
      },
      dateClick: (info)=>{
        // Show list of events for the clicked day in a modal instead of create
        const dayStart = new Date(info.dateStr + 'T00:00:00');
        const dayEnd = new Date(info.dateStr + 'T23:59:59');
        // Filter items that overlap the clicked day
        const items = (lastItems||[]).filter(ev=>{
          const s = new Date(ev.start);
          const e = ev.end ? new Date(ev.end) : s;
          return (s <= dayEnd && e >= dayStart);
        });
        // Populate modal
        const listEl = qs('#dayEventsList');
        const dateEl = qs('#dayEventsDate');
        if (dateEl) dateEl.textContent = new Date(info.dateStr).toDateString();
        if (listEl){
          listEl.innerHTML = '';
          if (!items.length){
            listEl.innerHTML = '<li class="list-group-item text-center text-muted">No events</li>';
          } else {
            items.forEach(ev=>{
              const startStr = new Date(ev.start).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
              const endStr = ev.end ? new Date(ev.end).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : '';
              const busyBadge = ev.is_busy ? '<span class="badge bg-secondary ms-2">Busy</span>' : '';
              const roleBadge = (role()==='admin') ? `<span class="badge ${ev.role_type==='donor'?'bg-primary':ev.role_type==='recipient'?'bg-success':'bg-warning text-dark'} ms-2">${ev.role_type}</span>` : '';
              const li = document.createElement('li');
              li.className = 'list-group-item d-flex justify-content-between align-items-start';
              li.innerHTML = `<div>
                  <div class="fw-semibold"><a href="#" class="ev-open-link" style="text-decoration:none;">${ev.title||'Event'}</a> ${busyBadge} ${roleBadge}</div>
                  <div class="small text-muted">${startStr}${endStr?(' - '+endStr):''}</div>
                </div>`;
              li.querySelector('.ev-open-link').addEventListener('click', (e)=>{
                e.preventDefault();
                const evForOpen = { ...ev, id: ev.id, start: ev.start, end: ev.end || null, title: ev.title };
                bootstrap.Modal.getOrCreateInstance(document.getElementById('dayEventsModal')).hide();
                openModal(evForOpen);
              });
              listEl.appendChild(li);
            });
          }
        }
        const mdl = bootstrap.Modal.getOrCreateInstance(document.getElementById('dayEventsModal'));
        mdl.show();
      },
      eventClick: (arg)=>{
        // Clone extendedProps before mutating to avoid modifying a frozen object
        const ev = { ...(arg.event.extendedProps || {}) };
        ev.id = Number(arg.event.id);
        ev.title = arg.event.title;
        ev.start = arg.event.start?.toISOString();
        ev.end = arg.event.end?.toISOString() || null;
        openModal(ev);
      }
    });
    calendar.render();

    // New event button
    qs('#newEventBtn')?.addEventListener('click', ()=> openModal({ status:'scheduled' }));
    qs('#refreshCalBtn')?.addEventListener('click', ()=> {
      if (calendar.refetchEvents) { calendar.refetchEvents(); }
      else { calendar.gotoDate(new Date(calendar.getDate())); }
    });

    // Save
    qs('#saveEventBtn')?.addEventListener('click', async ()=>{
      try{
        const data = collectForm();
        if (!data.title || !data.start) { showCalModal('Title and start are required'); return; }
        // All roles: disallow creating/updating to past times
        const now = new Date();
        const startTest = new Date(data.start);
        if (startTest < now) { showCalModal('Cannot create or update events in the past'); return; }
        // Client-side guard: recipients can only book 10:00-16:00
        if (role()==='recipient'){
          const d = new Date(data.start);
          const mins = d.getHours()*60 + d.getMinutes();
          if (mins < (10*60) || mins > (16*60)) { showCalModal('Recipients can only book between 10:00 and 16:00'); return; }
        }
        if (data.id){ await updateEvent(data.id, data); }
        else { await createEvent(data); }
        bootstrap.Modal.getInstance(qs('#eventModal'))?.hide();
        showCalModal('Event saved');
        calendar.gotoDate(new Date(calendar.getDate())); // trigger datesSet reload
      } catch(e){ showCalModal(e.message || 'Failed to save event'); }
    });

    // Delete
    qs('#deleteEventBtn')?.addEventListener('click', async ()=>{
      try{
        const id = Number(qs('#evId').value||0)||0; if (!id) return;
        await deleteEvent(id);
        bootstrap.Modal.getInstance(qs('#eventModal'))?.hide();
        showCalModal('Event deleted');
        calendar.gotoDate(new Date(calendar.getDate()));
      } catch(e){ showCalModal(e.message || 'Failed to delete event'); }
    });
  }

  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', init);
  } else { init(); }
})();
