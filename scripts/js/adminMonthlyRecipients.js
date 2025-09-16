(function(){
  'use strict';

  const API_BASE_URL = (typeof window.API_BASE_URL === 'string' && window.API_BASE_URL)
    ? window.API_BASE_URL
    : '/Capstone%20Project/php/api';

  const qs = (sel, el=document)=> el.querySelector(sel);
  const qsa = (sel, el=document)=> Array.from(el.querySelectorAll(sel));

  function escapeHtml(str){
    return String(str||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));
  }

  function monthStart(d){
    const x = new Date(d.getFullYear(), d.getMonth(), 1);
    x.setHours(0,0,0,0);
    return x;
  }

  function fmtMonthKey(d){
    // YYYY-MM-01
    const y = d.getFullYear();
    const m = String(d.getMonth()+1).padStart(2,'0');
    return `${y}-${m}-01`;
  }

  function fmtMonthTitle(d){
    return d.toLocaleString(undefined, { month: 'long', year: 'numeric' });
  }

  function createCard(user){
    const el = document.createElement('div');
    el.className = 'rcard';
    el.draggable = true;
    el.setAttribute('data-user-id', String(user.user_id));
    el.innerHTML = `
      <i class="bi bi-building-check text-secondary"></i>
      <div class="flex-grow-1">
        <div class="fw-semibold small">${escapeHtml(user.organization_name && user.organization_name.trim() ? user.organization_name : (user.name || ''))}</div>
        <div class="rmeta">${escapeHtml(user.address || '')}</div>
      </div>
    `;
    el.addEventListener('dragstart', (e)=>{
      e.dataTransfer.setData('text/plain', String(user.user_id));
      e.dataTransfer.effectAllowed = 'copyMove';
    });
    return el;
  }

  function createAssignedCard(user){
    const el = createCard(user);
    // add remove button
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-sm btn-link text-danger px-1 py-0';
    btn.innerHTML = '<i class="bi bi-x-circle"></i>';
    btn.title = 'Remove';
    btn.addEventListener('click', ()=>{
      const parent = el.closest('.dropzone');
      if (parent) parent.removeChild(el);
      // After removal, return card to pool ONLY if not assigned in any month
      const stillAssigned = !!document.querySelector(`.dropzone .rcard[data-user-id="${user.user_id}"]`);
      if (!stillAssigned){
        const pool = qs('#pool');
        if (pool){
          let poolCard = pool.querySelector(`.rcard[data-user-id="${user.user_id}"]`);
          if (poolCard){
            poolCard.style.display = '';
          } else {
            pool.appendChild(createCard(user));
          }
        }
      }
    });
    el.appendChild(btn);
    return el;
  }

  async function fetchRecipients(){
    const res = await fetch(`${API_BASE_URL}/recipient_assignments.php?action=list_recipients&t=${Date.now()}`, {
      method: 'GET', credentials: 'include', headers: { 'Accept': 'application/json' }, cache: 'no-store'
    });
    const j = await res.json();
    return Array.isArray(j?.data?.items) ? j.data.items : [];
  }

  async function fetchAssignments(months){
    const res = await fetch(`${API_BASE_URL}/recipient_assignments.php?action=get_assignments`, {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ months })
    });
    const j = await res.json();
    return j?.data?.assignments || {};
  }

  async function saveAssignments(monthKey, ids){
    const res = await fetch(`${API_BASE_URL}/recipient_assignments.php?action=save_assignments`, {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ month: monthKey, recipient_ids: ids })
    });
    const j = await res.json();
    if (!j?.success) throw new Error(j?.error || 'Save failed');
    return true;
  }

  function setupDnD(dropEl){
    dropEl.addEventListener('dragover', (e)=>{
      e.preventDefault();
      dropEl.classList.add('drag-over');
      e.dataTransfer.dropEffect = 'copy';
    });
    dropEl.addEventListener('dragleave', ()=>{
      dropEl.classList.remove('drag-over');
    });
    dropEl.addEventListener('drop', (e)=>{
      e.preventDefault();
      dropEl.classList.remove('drag-over');
      const id = Number(e.dataTransfer.getData('text/plain')) || 0;
      if (!id) return;
      // prevent duplicates within this month
      if (dropEl.querySelector(`.rcard[data-user-id="${id}"]`)) return;
      // find user info from pool cache if present
      const user = window.__mr_usersById?.get(id) || null;
      if (!user) return;
      dropEl.appendChild(createAssignedCard(user));
      // Hide the card in the pool when assigned to any month
      const poolCard = qs(`#pool .rcard[data-user-id="${id}"]`);
      if (poolCard){ poolCard.style.display = 'none'; }
    });
  }

  // Allow dropping back to pool to unassign
  function setupPoolDnD(){
    const poolWrap = qs('.rpool-scroll');
    const pool = qs('#pool');
    if (!poolWrap || !pool) return;
    poolWrap.addEventListener('dragover', (e)=>{ e.preventDefault(); poolWrap.classList.add('drag-over'); e.dataTransfer.dropEffect='move'; });
    poolWrap.addEventListener('dragleave', ()=> poolWrap.classList.remove('drag-over'));
    poolWrap.addEventListener('drop', (e)=>{
      e.preventDefault(); poolWrap.classList.remove('drag-over');
      const id = Number(e.dataTransfer.getData('text/plain')) || 0;
      if (!id) return;
      // If card exists in any month, remove it
      const assigned = document.querySelector(`.dropzone .rcard[data-user-id="${id}"]`);
      if (assigned) assigned.remove();
      // Show or create card in pool
      let poolCard = qs(`#pool .rcard[data-user-id="${id}"]`);
      const user = window.__mr_usersById?.get(id) || null;
      if (!poolCard && user){ poolCard = createCard(user); pool.appendChild(poolCard); }
      if (poolCard){ poolCard.style.display = ''; }
    });
  }

  function collectIds(dropId){
    const box = qs(`#${dropId}`);
    return qsa('.rcard[data-user-id]', box).map(el => Number(el.getAttribute('data-user-id')) || 0).filter(Boolean);
  }

  function filterPool(term){
    const t = term.trim().toLowerCase();
    const pool = qs('#pool');
    qsa('.rcard', pool).forEach(el => {
      const text = el.textContent.toLowerCase();
      el.style.display = !t || text.includes(t) ? '' : 'none';
    });
  }

  async function init(){
    try {
      // months
      const now = new Date();
      const m1 = monthStart(now);
      const m2 = monthStart(new Date(now.getFullYear(), now.getMonth()+1, 1));
      const m3 = monthStart(new Date(now.getFullYear(), now.getMonth()+2, 1));
      const keys = [fmtMonthKey(m1), fmtMonthKey(m2), fmtMonthKey(m3)];

      qs('#m1Label').textContent = fmtMonthTitle(m1);
      qs('#m2Label').textContent = fmtMonthTitle(m2);
      qs('#m3Label').textContent = fmtMonthTitle(m3);
      qs('#m1Date').textContent = keys[0];
      qs('#m2Date').textContent = keys[1];
      qs('#m3Date').textContent = keys[2];

      // dropzones
      ['m1','m2','m3'].forEach(id => setupDnD(qs('#'+id)));
      setupPoolDnD();

      // load data
      const [recipients, assignments] = await Promise.all([
        fetchRecipients(),
        fetchAssignments(keys)
      ]);

      // cache
      const map = new Map();
      recipients.forEach(u => map.set(Number(u.user_id), u));
      window.__mr_usersById = map;

      // render pool
      const pool = qs('#pool');
      pool.innerHTML = '';
      recipients.forEach(u => pool.appendChild(createCard(u)));

      // render assignments into months
      const slots = [qs('#m1'), qs('#m2'), qs('#m3')];
      slots.forEach((slot, idx) => {
        slot.innerHTML = '';
        const arr = assignments[keys[idx]] || [];
        arr.forEach(u => {
          // ensure we have full user info structure like list_recipients response
          const full = map.get(Number(u.user_id)) || u;
          slot.appendChild(createAssignedCard(full));
        });
      });

      // Hide pool cards for all recipients already assigned in any month
      const assignedIds = new Set();
      Object.values(assignments).forEach(list => {
        (list || []).forEach(u => assignedIds.add(Number(u.user_id)));
      });
      assignedIds.forEach(id => {
        const poolCard = qs(`#pool .rcard[data-user-id="${id}"]`);
        if (poolCard){ poolCard.style.display = 'none'; }
      });

      // wiring
      qs('#poolSearch')?.addEventListener('input', (e)=> filterPool(e.target.value));
      qs('#reloadBtn')?.addEventListener('click', ()=> location.reload());

      qs('#saveM1')?.addEventListener('click', async ()=>{
        try { await saveAssignments(keys[0], collectIds('m1')); toast('Month 1 saved','success'); } catch(err){ toast(err.message||'Save failed','danger'); }
      });
      qs('#saveM2')?.addEventListener('click', async ()=>{
        try { await saveAssignments(keys[1], collectIds('m2')); toast('Month 2 saved','success'); } catch(err){ toast(err.message||'Save failed','danger'); }
      });
      qs('#saveM3')?.addEventListener('click', async ()=>{
        try { await saveAssignments(keys[2], collectIds('m3')); toast('Month 3 saved','success'); } catch(err){ toast(err.message||'Save failed','danger'); }
      });

      // Clear buttons - return all assignments to pool
      function clearMonth(dropId){
        const dz = qs('#'+dropId);
        const pool = qs('#pool');
        if (!dz || !pool) return;
        qsa('.rcard[data-user-id]', dz).forEach(card => {
          const id = Number(card.getAttribute('data-user-id')) || 0;
          // remove from month
          card.remove();
          // show in pool
          let poolCard = qs(`#pool .rcard[data-user-id="${id}"]`);
          if (poolCard){ poolCard.style.display = ''; }
          else {
            const user = window.__mr_usersById?.get(id);
            if (user) pool.appendChild(createCard(user));
          }
        });
      }
      qs('#clearM1')?.addEventListener('click', ()=> clearMonth('m1'));
      qs('#clearM2')?.addEventListener('click', ()=> clearMonth('m2'));
      qs('#clearM3')?.addEventListener('click', ()=> clearMonth('m3'));

      qs('#saveAllBtn')?.addEventListener('click', async ()=>{
        try {
          await saveAssignments(keys[0], collectIds('m1'));
          await saveAssignments(keys[1], collectIds('m2'));
          await saveAssignments(keys[2], collectIds('m3'));
          toast('All months saved','success');
        } catch(err){ toast(err.message||'Save failed','danger'); }
      });

    } catch(err){
      console.error('Failed to initialize Monthly Recipients:', err);
      toast('Failed to load data: ' + (err.message||err),'danger');
    }
  }

  // Minimal toast using Bootstrap alerts injected at top-right
  function toast(message, type='info'){
    let host = qs('#__mr_toast_host');
    if (!host){
      host = document.createElement('div');
      host.id = '__mr_toast_host';
      host.style.position = 'fixed';
      host.style.top = '1rem';
      host.style.right = '1rem';
      host.style.zIndex = '1080';
      document.body.appendChild(host);
    }
    const el = document.createElement('div');
    el.className = `alert alert-${type} py-2 px-3 shadow-sm`;
    el.textContent = message;
    host.appendChild(el);
    setTimeout(()=>{
      el.classList.add('fade');
      setTimeout(()=>{ el.remove(); }, 300);
    }, 2000);
  }

  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
