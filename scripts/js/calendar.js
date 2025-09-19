(function(){
  'use strict';

  const API_BASE_URL = (typeof window.API_BASE_URL === 'string' && window.API_BASE_URL)
    ? window.API_BASE_URL
    : '/Capstone%20Project/php/api';

  const qs = (s, r=document)=> r.querySelector(s);

  function getUser(){
    try{ const s = sessionStorage.getItem('user'); return s ? JSON.parse(s) : null; }catch(_){ return null; }
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

  async function listEvents(startIso, endIso){
    const url = `${API_BASE_URL}/schedule.php?action=list&start=${encodeURIComponent(startIso)}&end=${encodeURIComponent(endIso)}&t=${Date.now()}`;
    const res = await fetch(url, { credentials:'include', headers:{ 'Accept':'application/json' } });
    const j = await res.json().catch(()=>({success:false,error:`HTTP ${res.status}`}));
    if (!res.ok || !j?.success) throw new Error(j?.error || `HTTP ${res.status}`);
    return Array.isArray(j?.data?.items) ? j.data.items : [];
  }
  async function createEvent(payload){
    const res = await fetch(`${API_BASE_URL}/schedule.php?action=create`, { method:'POST', credentials:'include', headers:{'Content-Type':'application/json','Accept':'application/json'}, body: JSON.stringify(payload) });
    const j = await res.json().catch(()=>({success:false,error:`HTTP ${res.status}`}));
    if (!res.ok || !j?.success) throw new Error(j?.error || `HTTP ${res.status}`);
    return j?.data;
  }
  async function updateEvent(id, payload){
    const res = await fetch(`${API_BASE_URL}/schedule.php?action=update&id=${encodeURIComponent(id)}`, { method:'PATCH', credentials:'include', headers:{'Content-Type':'application/json','Accept':'application/json'}, body: JSON.stringify(payload) });
    const j = await res.json().catch(()=>({success:false,error:`HTTP ${res.status}`}));
    if (!res.ok || !j?.success) throw new Error(j?.error || `HTTP ${res.status}`);
    return j?.data;
  }
  async function deleteEvent(id){
    const res = await fetch(`${API_BASE_URL}/schedule.php?action=delete&id=${encodeURIComponent(id)}`, { method:'DELETE', credentials:'include', headers:{'Accept':'application/json'} });
    const j = await res.json().catch(()=>({success:false,error:`HTTP ${res.status}`}));
    if (!res.ok || !j?.success) throw new Error(j?.error || `HTTP ${res.status}`);
    return true;
  }

  function openModal(data){
    const mEl = qs('#eventModal'); if (!mEl) return;
    const m = bootstrap.Modal.getOrCreateInstance(mEl);
    // Populate
    qs('#evId').value = data?.id || '';
    qs('#evTitle').value = data?.title || '';
    qs('#evStart').value = data?.start ? data.start.replace('Z','').slice(0,16) : '';
    qs('#evEnd').value = data?.end ? data.end.replace('Z','').slice(0,16) : '';
    qs('#evRecipient').value = data?.recipient_id || '';
    qs('#evDonor').value = data?.donor_id || '';
    qs('#evLocation').value = data?.location || '';
    qs('#evNotes').value = data?.notes || '';
    qs('#evStatus').value = data?.status || 'scheduled';

    // Role-based controls
    const r = role();
    const myId = userId();
    const isOwner = data?.created_by ? Number(data.created_by) === myId : true;
    const involved = (r==='admin') || (r==='donor' && (Number(data?.donor_id||0)===myId || isOwner)) || (r==='recipient' && (Number(data?.recipient_id||0)===myId || isOwner));
    const canEdit = (r==='admin') || involved;

    ['evTitle','evStart','evEnd','evRecipient','evDonor','evLocation','evNotes','evStatus'].forEach(id=>{
      const el = qs('#'+id); if (el) el.disabled = !canEdit;
    });
    const delBtn = qs('#deleteEventBtn'); if (delBtn) delBtn.style.display = (canEdit && data?.id) ? '' : 'none';
    const saveBtn = qs('#saveEventBtn'); if (saveBtn) saveBtn.disabled = !canEdit;

    m.show();
  }

  function collectForm(){
    return {
      id: qs('#evId').value || null,
      title: qs('#evTitle').value.trim(),
      start: new Date(qs('#evStart').value).toISOString(),
      end: qs('#evEnd').value ? new Date(qs('#evEnd').value).toISOString() : null,
      recipient_id: qs('#evRecipient').value ? Number(qs('#evRecipient').value) : null,
      donor_id: qs('#evDonor').value ? Number(qs('#evDonor').value) : null,
      location: qs('#evLocation').value.trim() || null,
      notes: qs('#evNotes').value.trim() || null,
      status: qs('#evStatus').value || 'scheduled'
    };
  }

  async function init(){
    const feedback = qs('#calFeedback');
    // Compute start-of-today (local) and YYYY-MM-DD string
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yyyy = startOfToday.getFullYear();
    const mm = String(startOfToday.getMonth()+1).padStart(2,'0');
    const dd = String(startOfToday.getDate()).padStart(2,'0');
    const todayStr = `${yyyy}-${mm}-${dd}`;

    // Initialize calendar
    const calendarEl = document.getElementById('calendar');
    const calendar = new FullCalendar.Calendar(calendarEl, {
      initialView: 'dayGridMonth',
      height: 'auto',
      headerToolbar: { left: 'prev,next today', center: 'title', right: 'dayGridMonth,timeGridWeek,timeGridDay' },
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
      datesSet: async (info)=>{
        try{
          const items = await listEvents(info.startStr, info.endStr);
          calendar.removeAllEvents();
          items.forEach(ev => {
            calendar.addEvent({
              id: String(ev.id), title: ev.title,
              start: ev.start, end: ev.end || undefined,
              extendedProps: ev,
              classNames: [ (Number(ev.created_by)===userId()) ? 'event-owned' : 'event-assigned' ]
            });
          });
        } catch(e){ showCalModal(e.message || 'Failed to load events'); }
      },
      dateClick: (info)=>{
        // open modal for new event with selected date
        const clicked = new Date(info.dateStr + 'T00:00');
        if (clicked < startOfToday) { return; }
        const start = new Date(info.dateStr + 'T09:00');
        const end = new Date(info.dateStr + 'T10:00');
        openModal({ start: start.toISOString(), end: end.toISOString(), status:'scheduled' });
      },
      eventClick: (arg)=>{
        const ev = arg.event.extendedProps || {};
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
    qs('#refreshCalBtn')?.addEventListener('click', ()=> calendar.refetchEvents ? calendar.refetchEvents() : calendar.setDate(new Date()));

    // Save
    qs('#saveEventBtn')?.addEventListener('click', async ()=>{
      try{
        const data = collectForm();
        if (!data.title || !data.start) { showCalModal('Title and start are required'); return; }
        if (data.id){ await updateEvent(data.id, data); }
        else { await createEvent(data); }
        bootstrap.Modal.getInstance(qs('#eventModal'))?.hide();
        showCalModal('Event saved');
        calendar.setDate(new Date(calendar.getDate())); // trigger datesSet reload
      } catch(e){ showCalModal(e.message || 'Failed to save event'); }
    });

    // Delete
    qs('#deleteEventBtn')?.addEventListener('click', async ()=>{
      try{
        const id = Number(qs('#evId').value||0)||0; if (!id) return;
        await deleteEvent(id);
        bootstrap.Modal.getInstance(qs('#eventModal'))?.hide();
        showCalModal('Event deleted');
        calendar.setDate(new Date(calendar.getDate()));
      } catch(e){ showCalModal(e.message || 'Failed to delete event'); }
    });
  }

  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', init);
  } else { init(); }
})();
