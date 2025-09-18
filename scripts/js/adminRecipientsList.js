(function(){
  'use strict';

  const API_BASE_URL = (typeof window.API_BASE_URL === 'string' && window.API_BASE_URL)
    ? window.API_BASE_URL
    : '/Capstone%20Project/php/api';

  const qs = (s, r=document)=> r.querySelector(s);
  const qsa = (s, r=document)=> Array.from(r.querySelectorAll(s));

  function toast(msg, type='secondary'){
    // simple inline feedback near breadcrumb (reuse pool caption area)
    const host = qs('.card.card-accent .fw-semibold');
    if (!host) return;
    const wrap = document.createElement('span');
    wrap.className = `ms-2 badge text-bg-${type}`;
    wrap.textContent = msg;
    host.appendChild(wrap);
    setTimeout(()=> wrap.remove(), 2500);
  }

  function createCard(user){
    const el = document.createElement('div');
    el.className = 'rcard';
    el.draggable = true;
    el.setAttribute('data-user-id', String(user.user_id));
    const label = (user.organization_name && user.organization_name.trim()) ? user.organization_name : (user.name || ('Recipient ' + user.user_id));
    el.innerHTML = `<i class="bi bi-person-badge"></i><span>${label}</span>`;
    return el;
  }

  function setupDragSources(container){
    container.addEventListener('dragstart', (e)=>{
      const t = e.target;
      if (!(t instanceof HTMLElement)) return;
      if (!t.classList.contains('rcard')) return;
      const id = t.getAttribute('data-user-id') || '';
      e.dataTransfer?.setData('text/plain', id);
      e.dataTransfer?.setDragImage(t, 10, 10);
    });
  }

  function setupDropzone(el){
    function findBeforeElement(container, clientY){
      const cards = qsa(':scope > .rcard', container);
      for (const card of cards){
        const rect = card.getBoundingClientRect();
        const midpoint = rect.top + rect.height / 2;
        if (clientY < midpoint) return card;
      }
      return null; // append at end
    }
    el.addEventListener('dragover', (e)=>{ e.preventDefault(); el.classList.add('drag-over'); e.dataTransfer.dropEffect='move'; });
    el.addEventListener('dragleave', ()=> el.classList.remove('drag-over'));
    el.addEventListener('drop', (e)=>{
      e.preventDefault(); el.classList.remove('drag-over');
      const id = parseInt(e.dataTransfer?.getData('text/plain') || '0', 10);
      if (!id) return;
      const user = window.__rl_usersById?.get(id);
      if (!user) return;
      // Remove existing from any week
      const existingAssigned = document.querySelector(`.dropzone .rcard[data-user-id="${id}"]`);
      if (existingAssigned && existingAssigned.parentElement !== el){ existingAssigned.remove(); }
      let card = el.querySelector(`.rcard[data-user-id="${id}"]`);
      if (!card){
        // may be from pool
        card = createCard(user);
      } else {
        // moving within same week: detach to reinsert at new position
        card.remove();
      }
      const before = findBeforeElement(el, e.clientY);
      if (before) el.insertBefore(card, before); else el.appendChild(card);
      const poolCard = qs(`#pool .rcard[data-user-id="${id}"]`);
      if (poolCard) poolCard.style.display='none';
    });
  }

  function setupPoolDnD(){
    const poolWrap = qs('.rpool-scroll');
    const pool = qs('#pool');
    if (!poolWrap || !pool) return;
    poolWrap.addEventListener('dragover', (e)=>{ e.preventDefault(); poolWrap.classList.add('drag-over'); e.dataTransfer.dropEffect='move'; });
    poolWrap.addEventListener('dragleave', ()=> poolWrap.classList.remove('drag-over'));
    poolWrap.addEventListener('drop', (e)=>{
      e.preventDefault(); poolWrap.classList.remove('drag-over');
      const id = parseInt(e.dataTransfer?.getData('text/plain') || '0', 10);
      if (!id) return;
      // remove from any week
      const assigned = document.querySelector(`.dropzone .rcard[data-user-id="${id}"]`);
      if (assigned) assigned.remove();
      // show in pool
      let poolCard = qs(`#pool .rcard[data-user-id="${id}"]`);
      if (!poolCard){
        const user = window.__rl_usersById?.get(id);
        if (user){ poolCard = createCard(user); pool.appendChild(poolCard); }
      }
      if (poolCard){ poolCard.style.display=''; }
    });
  }

  function filterPool(term){
    const t = String(term||'').toLowerCase();
    qsa('#pool .rcard').forEach(el => {
      const lbl = (el.textContent||'').toLowerCase();
      el.style.display = (!t || lbl.includes(t)) ? '' : 'none';
    });
  }

  function clearWeek(dropId){
    const dz = qs('#'+dropId);
    const pool = qs('#pool');
    if (!dz || !pool) return;
    qsa('.rcard[data-user-id]', dz).forEach(card => {
      const id = parseInt(card.getAttribute('data-user-id')||'0', 10);
      card.remove();
      let poolCard = qs(`#pool .rcard[data-user-id="${id}"]`);
      if (poolCard) poolCard.style.display='';
      else {
        const user = window.__rl_usersById?.get(id);
        if (user) pool.appendChild(createCard(user));
      }
    });
  }

  function collectWeekIds(dropId){ return qsa(`#${dropId} .rcard[data-user-id]`).map(el => parseInt(el.getAttribute('data-user-id')||'0',10)).filter(Boolean); }
  function currentMonth(){ const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`; }
  function isoWeekNumber(date){
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7; // Sun=7
    d.setUTCDate(d.getUTCDate() + 4 - dayNum); // nearest Thursday
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  }
  function monthWeekStartDates(month, weekStart){
    // month: 'YYYY-MM', weekStart: 'sunday'|'monday'
    const m = /^(\d{4})-(\d{2})$/.exec(String(month));
    if (!m) return [];
    const year = parseInt(m[1],10), mon = parseInt(m[2],10);
    const wsDow = (weekStart === 'monday') ? 1 : 0; // 0=Sun..6=Sat
    const first = new Date(year, mon-1, 1);
    const firstDow = first.getDay();
    const offset = (firstDow - wsDow + 7) % 7;
    const firstWeekStart = new Date(year, mon-1, 1 - offset);
    return [0,1,2,3].map(i => new Date(firstWeekStart.getFullYear(), firstWeekStart.getMonth(), firstWeekStart.getDate() + i*7));
  }
  function updateWeekLabels(){
    try{
      const month = currentMonth();
      const basis = (window.__WEEK_START === 'monday') ? 'monday' : 'sunday';
      const starts = monthWeekStartDates(month, basis);
      const ids = ['w1Label','w2Label','w3Label','w4Label'];
      starts.forEach((dt, i) => {
        const iso = isoWeekNumber(dt);
        const el = qs('#'+ids[i]);
        if (el) el.textContent = `Week W${iso}`;
      });
      // Update aria-labels of dropzones and button titles for clarity (optional, non-breaking)
      const dzMap = [['w1','W'+isoWeekNumber(starts[0]||new Date())],['w2','W'+isoWeekNumber(starts[1]||new Date())],['w3','W'+isoWeekNumber(starts[2]||new Date())],['w4','W'+isoWeekNumber(starts[3]||new Date())]];
      dzMap.forEach(([id,w])=>{ const dz = qs('#'+id); if (dz) dz.setAttribute('aria-label', `Week ${w} assignments`); });
      const btns = [
        ['saveW1','Save '+('W'+isoWeekNumber(starts[0]||new Date()))],
        ['saveW2','Save '+('W'+isoWeekNumber(starts[1]||new Date()))],
        ['saveW3','Save '+('W'+isoWeekNumber(starts[2]||new Date()))],
        ['saveW4','Save '+('W'+isoWeekNumber(starts[3]||new Date()))],
      ];
      btns.forEach(([id,title])=>{ const b = qs('#'+id); if (b) b.setAttribute('title', title); if (b) b.setAttribute('data-bs-original-title', title); });
    } catch(_){}
  }
  async function apiGetPlan(month){
    const ws = (window.__WEEK_START === 'monday') ? 'monday' : 'sunday';
    const res = await fetch(`${API_BASE_URL}/recipients_list.php?action=get_plan&month=${encodeURIComponent(month||currentMonth())}&week_start=${encodeURIComponent(ws)}`, { credentials:'include' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const j = await res.json();
    if (!j?.success) throw new Error(j?.error || 'Failed to load plan');
    return j.data;
  }
  async function apiSavePlan(weeksObj, month){
    const body = { month: month||currentMonth(), weeks: weeksObj||{} };
    const res = await fetch(`${API_BASE_URL}/recipients_list.php?action=save_plan`, { method:'POST', headers:{'Content-Type':'application/json','Accept':'application/json'}, credentials:'include', body: JSON.stringify(body) });
    const j = await res.json().catch(()=>({success:false,error:`HTTP ${res.status}`}));
    if (!res.ok || !j?.success) throw new Error(j?.error || `HTTP ${res.status}`);
    return true;
  }

  async function restoreFromServer(){
    const map = window.__rl_usersById || new Map();
    const pool = qs('#pool');
    // Show pool cards initially
    qsa('#pool .rcard').forEach(c => c.style.display='');
    try {
      const data = await apiGetPlan(currentMonth());
      const weeks = data?.weeks || {};
      [['W1','w1'],['W2','w2'],['W3','w3'],['W4','w4']].forEach(([key,drop])=>{
        const dz = qs('#'+drop); if (!dz) return; dz.innerHTML='';
        const ids = Array.isArray(weeks[key]) ? weeks[key] : [];
        ids.forEach(id => {
          const user = map.get(id); if (!user) return;
          dz.appendChild(createCard(user));
          const poolCard = qs(`#pool .rcard[data-user-id="${id}"]`); if (poolCard) poolCard.style.display='none';
        });
      });
    } catch (e) {
      toast('Failed to load plan from server', 'danger');
    }
  }

  async function saveWeekKey(weekKey, dropId){
    const ids = collectWeekIds(dropId);
    try {
      await apiSavePlan({ [weekKey]: ids }, currentMonth());
      toast(`Saved ${weekKey} (${ids.length})`, 'success');
    } catch (e) {
      toast(`Failed to save ${weekKey}: ${e.message || e}`, 'danger');
    }
  }

  function autoFill(dropId, count){
    const dz = qs('#'+dropId);
    const pool = qs('#pool');
    if (!dz || !pool) return;
    // collect available ids from pool that are currently visible (not hidden by assignment)
    const cards = qsa('#pool .rcard').filter(el => el.style.display !== 'none');
    if (!cards.length){ toast('No recipients available in pool', 'warning'); return; }
    // shuffle
    const idx = cards.map((_,i)=>i);
    for (let i=idx.length-1; i>0; i--){ const j = Math.floor(Math.random()*(i+1)); [idx[i],idx[j]] = [idx[j],idx[i]]; }
    let added = 0;
    for (let k=0; k<idx.length && added < count; k++){
      const card = cards[idx[k]];
      const id = parseInt(card.getAttribute('data-user-id')||'0', 10);
      if (!Number.isFinite(id) || id<=0) continue;
      if (dz.querySelector(`.rcard[data-user-id="${id}"]`)) continue; // skip if already there
      // append to week
      const user = window.__rl_usersById?.get(id);
      if (!user) continue;
      dz.appendChild(createCard(user));
      // hide in pool
      card.style.display='none';
      added++;
    }
    toast(`Auto added ${added} recipient(s)`, added ? 'success' : 'warning');
  }

  async function fetchRecipients(){
    const res = await fetch(`${API_BASE_URL}/users.php?action=list&role=recipient&status=approved&t=${Date.now()}`, {
      method: 'GET', headers: { 'Accept': 'application/json' }, credentials: 'include', cache: 'no-store'
    });
    const j = await res.json();
    if (!res.ok || !j?.success) throw new Error(j?.error || `HTTP ${res.status}`);
    return Array.isArray(j?.data?.items) ? j.data.items : [];
  }

  async function init(){
    try{
      // Removed outdated local-only save notice (server persistence enabled)

      // setup drag handlers
      setupDragSources(document);
      ['w1','w2','w3','w4'].forEach(id => setupDropzone(qs('#'+id)));
      setupPoolDnD();

      // Load global week_start from settings and wire dropdown
      try{
        const sel = qs('#rlWeekStart');
        if (sel){
          console.info('Week start control found; initializing...');
          const r = await fetch(`${API_BASE_URL}/settings.php?action=get&key=week_start`, { credentials:'include' });
          const j = await r.json().catch(()=>null);
          const val = (j && j.success && j.data && typeof j.data.value === 'string') ? j.data.value.toLowerCase() : 'sunday';
          window.__WEEK_START = (val === 'monday') ? 'monday' : 'sunday';
          sel.value = window.__WEEK_START;
          // Set dynamic week-of-year labels initially
          updateWeekLabels();
          sel.addEventListener('change', async ()=>{
            const v = sel.value === 'monday' ? 'monday' : 'sunday';
            try{
              console.info('Submitting week_start update...', { url: `${API_BASE_URL}/settings.php?action=update`, value: v });
              const upd = await fetch(`${API_BASE_URL}/settings.php?action=update`, { method:'POST', headers:{'Content-Type':'application/json','Accept':'application/json'}, credentials:'include', body: JSON.stringify({ key:'week_start', value: v }) });
              const raw = await upd.text();
              let uj = null;
              try { uj = JSON.parse(raw); } catch(_) { uj = null; }
              if (upd.ok && uj?.success){
                window.__WEEK_START = v;
                toast('Week start updated', 'success');
                updateWeekLabels();
                await restoreFromServer();
              } else {
                // TEMP debug logging
                console.error('Week start update failed', { status: upd.status, ok: upd.ok, response: uj, raw });
                const msg = (uj && uj.error) ? uj.error : (`Failed to update setting (HTTP ${upd.status})` + (raw ? `: ${raw.slice(0,180)}` : ''));
                toast(msg, 'danger');
              }
            } catch(e){
              // TEMP debug logging
              console.error('Week start update request error', e);
              toast('Failed to update setting', 'danger');
            }
          });
        }
      } catch(_){ /* ignore */ }

      // load recipients
      const items = await fetchRecipients();
      window.__rl_usersById = new Map();
      const pool = qs('#pool');
      pool.innerHTML = '';
      items.forEach(u => { window.__rl_usersById.set(Number(u.user_id), u); pool.appendChild(createCard(u)); });

      // Load plan from server (fallback to local if needed)
      await restoreFromServer();

      // wire search, clear and auto buttons
      qs('#poolSearch')?.addEventListener('input', (e)=> filterPool(e.target.value));
      qs('#clearW1')?.addEventListener('click', ()=> clearWeek('w1'));
      qs('#clearW2')?.addEventListener('click', ()=> clearWeek('w2'));
      qs('#clearW3')?.addEventListener('click', ()=> clearWeek('w3'));
      qs('#clearW4')?.addEventListener('click', ()=> clearWeek('w4'));
      qs('#autoW1')?.addEventListener('click', ()=> autoFill('w1', 10));
      qs('#autoW2')?.addEventListener('click', ()=> autoFill('w2', 10));
      qs('#autoW3')?.addEventListener('click', ()=> autoFill('w3', 10));
      qs('#autoW4')?.addEventListener('click', ()=> autoFill('w4', 10));
      qs('#reloadBtn')?.addEventListener('click', async ()=>{ try{ await init(); } catch(_){} });
      // per-week saves
      qs('#saveW1')?.addEventListener('click', ()=> saveWeekKey('W1','w1'));
      qs('#saveW2')?.addEventListener('click', ()=> saveWeekKey('W2','w2'));
      qs('#saveW3')?.addEventListener('click', ()=> saveWeekKey('W3','w3'));
      qs('#saveW4')?.addEventListener('click', ()=> saveWeekKey('W4','w4'));
      // save all
      qs('#saveAllBtn')?.addEventListener('click', async ()=>{
        const weeks = { W1: collectWeekIds('w1'), W2: collectWeekIds('w2'), W3: collectWeekIds('w3'), W4: collectWeekIds('w4') };
        try { await apiSavePlan(weeks, currentMonth()); toast('All weeks saved', 'success'); }
        catch(e){ toast('Failed to save all weeks', 'danger'); }
      });

      // Enable Bootstrap tooltips for icon-only buttons
      try {
        const ttEls = qsa('[data-bs-toggle="tooltip"]');
        ttEls.forEach(el => new bootstrap.Tooltip(el));
      } catch(_) { /* bootstrap may not be defined yet */ }
      // Ensure labels are set even if settings endpoint had issues
      updateWeekLabels();

    } catch(err){
      console.error('Recipients List init failed:', err);
      toast(err.message || 'Failed to load recipients', 'danger');
    }
  }

  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', init);
  } else { init(); }
})();
