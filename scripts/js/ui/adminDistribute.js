function diLogError(context, error){
  try {
    console.error(`[DI] ${context}`, error);
  } catch(_){ }
}

function diCloseToast(button){
  try {
    const toast = button?.closest?.('.di-toast');
    if (toast) toast.remove();
  } catch (err) {
    diLogError('diCloseToast failed', err);
  }
}

try {
  if (typeof window.diCloseToast !== 'function') {
    window.diCloseToast = diCloseToast;
  }
} catch(_){ }

function diFormatNumber(val){
  const num = Number(val);
  return Number.isFinite(num) ? num.toLocaleString() : '0';
}

async function diFetchSoonExpireItems(limit = 5){
  try {
    const params = new URLSearchParams({ group: 'merge', page: '1', limit: String(limit * 3) });
    params.set('t', String(Date.now()));
    const res = await fetch(`${INVENTORY_API_BASE}/list?${params.toString()}`, {
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json().catch(() => null);
    const items = Array.isArray(data?.data?.items) ? data.data.items : [];
    const soon = items.filter((it) => {
      const status = String(it?.derived_status || '').toLowerCase();
      return status === 'expiring soon' || status === 'soon to expire';
    });
    soon.sort((a, b) => {
      const qa = Number(a?.status_breakdown?.soon ?? a?.total_quantity ?? a?.quantity ?? 0);
      const qb = Number(b?.status_breakdown?.soon ?? b?.total_quantity ?? b?.quantity ?? 0);
      return qb - qa;
    });
    return soon.slice(0, limit);
  } catch (err) {
    diLogError('diFetchSoonExpireItems failed', err);
    return null;
  }
}

async function diBuildSoonExpireContent(){
  const wrapper = document.createElement('div');
  wrapper.className = 'small w-100';
  const heading = document.createElement('div');
  heading.className = 'fw-semibold mb-1';
  heading.textContent = 'Soon-to-expire inventory';
  wrapper.appendChild(heading);

  const rows = await diFetchSoonExpireItems(5);
  if (!rows || rows.length === 0) {
    const empty = document.createElement('div');
    empty.textContent = 'No items currently marked as soon to expire.';
    wrapper.appendChild(empty);
    return wrapper;
  }

  const table = document.createElement('table');
  table.className = 'table table-borderless table-sm mb-0 text-body';
  const thead = document.createElement('thead');
  thead.innerHTML = '<tr class="text-muted"><th>Category</th><th>Item name</th><th class="text-end">Qty</th></tr>';
  table.appendChild(thead);
  const tbody = document.createElement('tbody');
  rows.forEach((it) => {
    const category = it?.category ?? it?.product_category ?? '—';
    const name = it?.item_name ?? it?.product_name ?? 'Unnamed item';
    const quantity = it?.status_breakdown?.soon ?? it?.total_quantity ?? it?.quantity ?? 0;
    const tr = document.createElement('tr');
    tr.innerHTML = `<td class="pe-3">${category || '—'}</td><td class="pe-3">${name}</td><td class="text-end">${diFormatNumber(quantity)}</td>`;
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  wrapper.appendChild(table);
  return wrapper;
}

function diResolveApiBase(){
  return (typeof window.API_BASE_URL === 'string' && window.API_BASE_URL)
    ? window.API_BASE_URL
    : '/php/api';
}

let DI_API_BASE = diResolveApiBase();
let INVENTORY_API_BASE = `${DI_API_BASE}/inventory/index.php`;

let diDistributablePercent = 90;
let diDistributableFraction = 0.9;
let diDistributableLoaded = false;
let diDistributablePromise = null;

function getDistributableFraction(){
  return diDistributableFraction;
}

function applyDistributableFraction(percent){
  const pct = Number(percent);
  if (!Number.isFinite(pct)) return diDistributableFraction;
  const clamped = Math.min(Math.max(pct, 0), 100);
  diDistributablePercent = clamped;
  diDistributableFraction = clamped / 100;
  try {
    if (window.Allocation && typeof window.Allocation.setDistributableFraction === 'function'){
      window.Allocation.setDistributableFraction(diDistributableFraction);
    }
  } catch(_){ }
  return diDistributableFraction;
}

async function loadDistributableSettings(){
  if (diDistributableLoaded) return diDistributableFraction;
  if (diDistributablePromise) return diDistributablePromise;
  diDistributablePromise = (async ()=>{
    try {
      DI_API_BASE = diResolveApiBase();
      INVENTORY_API_BASE = `${DI_API_BASE}/inventory/index.php`;
      const url = `${DI_API_BASE}/system/settings.php?action=get&key=distribution_distributable_percent&t=${Date.now()}`;
      const res = await fetch(url, { credentials:'include', headers:{ 'Accept':'application/json' } });
      if (res.ok){
        const data = await res.json().catch(()=>null);
        const valRaw = data?.data?.value ?? data?.data ?? data?.value ?? null;
        const parsed = parseInt(valRaw, 10);
        if (Number.isFinite(parsed)){
          applyDistributableFraction(parsed);
        }
      }
    } catch(err){
      diLogError('Failed to load distributable setting', err);
    }
    diDistributableLoaded = true;
    return diDistributableFraction;
  })();
  try {
    return await diDistributablePromise;
  } finally {
    diDistributablePromise = null;
  }
}

async function diMaybeShowAllocationToast(){
  try {
    const allocPane = document.getElementById('di-alloc');
    const allocTabBtn = document.getElementById('di-alloc-tab');
    const isActive =
      (allocPane && allocPane.classList.contains('show') && allocPane.classList.contains('active')) ||
      (allocTabBtn && allocTabBtn.classList.contains('active'));
    if (!isActive) return;

    // Let CSS on #diToastContainer control placement (top-right via
    // "toast-container position-fixed top-0 end-0 p-3").
    const content = await diBuildSoonExpireContent().catch(() => null);
    const options = { key: 'soon-expire', draggable: true };
    if (content) {
      diShowPersistentToast(content, 'warning', options);
    } else {
      diShowPersistentToast('Unable to load soon-to-expire items right now.', 'warning', options);
    }
  } catch (err) {
    diLogError('diMaybeShowAllocationToast failed', err);
  }
}

function diShowPersistentToast(message, variant = 'success', options){
  try {
    const container = diEnsureToastContainer();
    if (!container) return;

    const opts = options || {};
    const key = opts.key || null;
    const anchor = opts.anchor || null;

    if (key) {
      try {
        const existingToast = container.querySelector(`.di-toast[data-di-key="${key}"]`);
        if (existingToast && existingToast.parentNode === container) {
          existingToast.remove();
        }
      } catch (_) {}
    }

    // If an anchor is provided and container hasn't been manually moved yet, position it near the anchor
    if (anchor && !container.__diUserMoved) {
      try {
        container.style.right = '';
        container.style.bottom = '';
        container.style.left = Math.max(0, anchor.left) + 'px';
        container.style.top = Math.max(0, anchor.top) + 'px';
      } catch(_){ }
    }

    const colorClass = variant === 'danger' ? 'alert-danger' : variant === 'warning' ? 'alert-warning' : 'alert-success';
    const toastEl = document.createElement('div');
    toastEl.className = `di-toast alert ${colorClass} d-flex align-items-start gap-3 shadow border-0 mb-2`;
    toastEl.setAttribute('role', 'alert');
    toastEl.setAttribute('aria-live', 'assertive');
    toastEl.setAttribute('aria-atomic', 'true');
    toastEl.style.minWidth = '240px';
    toastEl.style.maxWidth = '420px';

    const bodyEl = document.createElement('div');
    bodyEl.className = 'flex-grow-1 pe-2';
    if (message instanceof Node) {
      bodyEl.appendChild(message);
    } else {
      bodyEl.textContent = message ?? '';
    }

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'di-toast-close btn btn-light btn-sm d-inline-flex align-items-center justify-content-center border-0 px-2';
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.innerHTML = '&times;';
    closeBtn.style.fontSize = '20px';
    closeBtn.style.lineHeight = '1';
    closeBtn.style.minWidth = '28px';
    closeBtn.style.height = '28px';
    closeBtn.style.borderRadius = '999px';
    closeBtn.style.cursor = 'pointer';
    closeBtn.style.pointerEvents = 'auto';
    const stopAll = (ev) => {
      try { ev.preventDefault(); } catch(_) {}
      try { ev.stopPropagation(); } catch(_) {}
      try { ev.stopImmediatePropagation(); } catch(_) {}
    };
    ['mousedown','mouseup','pointerdown','pointerup','touchstart','touchend'].forEach((evt) => {
      closeBtn.addEventListener(evt, stopAll, true);
    });
    closeBtn.addEventListener('click', (ev) => {
      stopAll(ev);
      diCloseToast(closeBtn);
    });

    toastEl.appendChild(bodyEl);
    toastEl.appendChild(closeBtn);
    if (key) {
      try { toastEl.dataset.diKey = key; } catch(_){}
    }
    container.appendChild(toastEl);
  } catch (err) {
    diLogError('diShowPersistentToast failed', err);
  }
}

function diHandleToastContainerClick(ev){
  try {
    const btn = ev.target.closest?.('.di-toast-close');
    if (!btn) return;
    ev.preventDefault();
    ev.stopPropagation();
    ev.stopImmediatePropagation();
    diCloseToast(btn);
  } catch (err) {
    diLogError('diHandleToastContainerClick failed', err);
  }
}

function diHandleToastContainerKeydown(ev){
  try {
    const btn = ev.target.closest?.('.di-toast-close');
    if (!btn) return;
    if (ev.key !== 'Enter' && ev.key !== ' ' && ev.key !== 'Spacebar') return;
    ev.preventDefault();
    ev.stopPropagation();
    ev.stopImmediatePropagation();
    diCloseToast(btn);
  } catch (err) {
    diLogError('diHandleToastContainerKeydown failed', err);
  }
}

function diMakeToastContainerDraggable(container){
  try {
    if (!container || container.__diDraggable) return;
    container.__diDraggable = true;
    let isDragging = false;
    let startX = 0;
    let startY = 0;
    let origLeft = 0;
    let origTop = 0;

    const onMove = (ev) => {
      if (!isDragging) return;
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      const nextLeft = Math.max(0, origLeft + dx);
      const nextTop = Math.max(0, origTop + dy);
      container.style.left = nextLeft + 'px';
      container.style.top = nextTop + 'px';
      container.style.right = '';
      container.style.bottom = '';
      container.__diUserMoved = true;
    };

    const stopDrag = () => {
      if (!isDragging) return;
      isDragging = false;
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', stopDrag, true);
      window.removeEventListener('mousemove', onMove, true);
      window.removeEventListener('mouseup', stopDrag, true);
    };

    const onDown = (ev) => {
      try {
        // Ignore clicks on the explicit close button
        if (ev.target.closest && ev.target.closest('.di-toast-close')) return;
        // Only start dragging when interacting inside the toast container itself
        if (!container.contains(ev.target)) return;
        const rect = container.getBoundingClientRect();
        startX = ev.clientX;
        startY = ev.clientY;
        origLeft = rect.left;
        origTop = rect.top;
        container.style.bottom = '';
        if (!container.style.top) {
          container.style.top = rect.top + 'px';
        }
        isDragging = true;
        window.addEventListener('pointermove', onMove, true);
        window.addEventListener('pointerup', stopDrag, true);
        window.addEventListener('mousemove', onMove, true);
        window.addEventListener('mouseup', stopDrag, true);
      } catch (_) {}
    };

    container.style.cursor = 'move';
    container.addEventListener('pointerdown', onDown, true);
    container.addEventListener('mousedown', onDown, true);
  } catch (_) {}
}

function diEnsureToastContainer(){
  try {
    const existing = document.getElementById('diToastContainer');
    if (existing) {
      if (!existing.__diCloseBound) {
        existing.addEventListener('click', diHandleToastContainerClick, true);
        existing.addEventListener('keydown', diHandleToastContainerKeydown, true);
        existing.__diCloseBound = true;
      }
      existing.style.cursor = '';
      diMakeToastContainerDraggable(existing);
      return existing;
    }
    const body = document.body;
    if (!body) return null;
    const toastContainer = document.createElement('div');
    toastContainer.id = 'diToastContainer';
    toastContainer.className = 'toast-container position-fixed top-0 end-0 p-3';
    toastContainer.style.zIndex = '1100';
    toastContainer.__diCloseBound = true;
    toastContainer.addEventListener('click', diHandleToastContainerClick, true);
    toastContainer.addEventListener('keydown', diHandleToastContainerKeydown, true);
    body.appendChild(toastContainer);
    diMakeToastContainerDraggable(toastContainer);
    return toastContainer;
  } catch (err) {
    diLogError('diEnsureToastContainer failed', err);
    return null;
  }
}

try {
  if (typeof window.getDistributableFraction !== 'function') {
    window.getDistributableFraction = getDistributableFraction;
  }
} catch(_){ }

// Lightweight DOM helpers (global so top-level functions can use them)
const qs = (s, r=document)=> r.querySelector(s);
const qsa = (s, r=document)=> Array.from(r.querySelectorAll(s));

// Delegations: moved to scripts/js/algorithms/schedulingAlgorithmUI.js
function normalizeWeeksExToMap(weeksEx){ try { return window.normalizeWeeksExToMap(weeksEx); } catch(_){ return { W1:[], W2:[], W3:[], W4:[] }; } }

// Ensure Week 1 and Week 2 plan IDs have cards visible in Pool/Selected
  function ensurePlanCardsVisible(){ try { return window.ensurePlanCardsVisible(); } catch(_){ } }

  // (moved) attachAllocateNow defined at top-level below

  // (Removed duplicate early tryAutoAllAllItems and stray fetch block)
// Allocate ALL available inventory items handled by the implementation later in the file
  
  // Sort pool by week membership (W1..W4 order), then label
  function sortPoolByWeeks(){ try { return window.sortPoolByWeeks(); } catch(_){ } }

  // Delegated click handlers to move cards between Pool and Selected (covers dynamically added cards)
  function attachDelegatedInteractions(){ try { return window.attachDelegatedInteractions(); } catch(_){ } }

  // Search filter across both Pool and Selected by label text
  function attachSearch(){ try { return window.attachSearch(); } catch(_){ } }

  // Update Selected count badge
  function updateSelectedCount(){ try { return window.updateSelectedCount(); } catch(_){ } }

  // Build allocation carousel from current Selected
  function buildAllocCarouselFromSelected(){
    try {
      const inner = qs('#diAllocCarouselInner');
      const indicators = qs('#diAllocIndicators');
      const counter = qs('#diAllocCounter');
      const prevBtn = qs('#diAllocPrevBtn');
      const nextBtn = qs('#diAllocNextBtn');
      if (!inner || !indicators) return;
      const cards = qsa('#diSelected .di-card');
      inner.innerHTML = '';
      indicators.innerHTML = '';
      const ids = cards.map(c => parseInt(c.dataset.id||'0',10)).filter(Number.isFinite);
      window.__diAllocIds = ids;
      ids.forEach((id, idx) => {
        const label = (qs('.di-card-label', cards[idx])?.textContent||`Recipient ${id}`);
        const item = document.createElement('div');
        item.className = 'carousel-item' + (idx===0?' active':'');
        item.innerHTML = `<div class="p-3"><h6 class="mb-2">${label}</h6>
          <div class="border-bottom small text-muted d-flex px-2 py-1" style="gap:12px">
            <div class="flex-grow-1">Item</div>
            <div style="width:90px" class="text-end">Qty</div>
            <div style="width:120px" class="text-center">Unit</div>
          </div>
          <div id="alloc-items-${id}"></div>
        </div>`;
        inner.appendChild(item);
        const li = document.createElement('button');
        li.type = 'button';
        li.setAttribute('data-bs-target', '#diAllocCarousel');
        li.setAttribute('data-bs-slide-to', String(idx));
        if (idx===0) li.className = 'active';
        indicators.appendChild(li);
      });
      const total = ids.length;
      if (counter) counter.textContent = total ? `1 / ${total}` : '';
      // Show/hide nav depending on count
      try {
        const prevCtl = document.querySelector('#diAllocCarousel .carousel-control-prev');
        const nextCtl = document.querySelector('#diAllocCarousel .carousel-control-next');
        if (prevCtl && nextCtl){
          if (total > 1){ prevCtl.classList.remove('d-none'); nextCtl.classList.remove('d-none'); }
          else { prevCtl.classList.add('d-none'); nextCtl.classList.add('d-none'); }
        }
      } catch(_){ }
      // Update prev/next buttons to update counter
      try {
        const carouselEl = document.getElementById('diAllocCarousel');
        if (carouselEl && window.bootstrap?.Carousel){
          const c = window.bootstrap.Carousel.getOrCreateInstance(carouselEl, { interval: false, ride: false, touch: false, keyboard: false, wrap: false });
          carouselEl.addEventListener('slid.bs.carousel', (ev)=>{
            const i = ev.to + 1; if (counter) counter.textContent = `${i} / ${total}`;
          });
          // Block edge/surface clicks from sliding, but allow interactive controls inside items
          try {
            const hardStop = (e)=>{ try{ e.stopImmediatePropagation(); }catch(_){} try{ e.stopPropagation(); }catch(_){} try{ e.preventDefault(); }catch(_){} };
            const guard = (e)=>{
              const t = e.target;
              if (!t) { hardStop(e); return; }
              // Allow delete button, qty input and its container to work
              if (t.closest && (t.closest('.alloc-del-btn') || t.closest('.alloc-qty-input'))) return;
              // Allow external nav area
              if (t.closest && t.closest('#diAllocNav')) return;
              // Otherwise, block to prevent unintended slide
              hardStop(e);
            };
            ['click','mousedown','mouseup','pointerdown','pointerup','touchstart','touchend'].forEach(ev=> carouselEl.addEventListener(ev, guard, { capture: true }));
          } catch(_){ }
          // Disable default internal controls and indicators from receiving input
          try {
            const intPrev = document.querySelector('#diAllocCarousel .carousel-control-prev');
            const intNext = document.querySelector('#diAllocCarousel .carousel-control-next');
            const indicatorsHost = document.getElementById('diAllocIndicators');
            if (intPrev) intPrev.style.pointerEvents = 'none';
            if (intNext) intNext.style.pointerEvents = 'none';
            if (indicatorsHost) indicatorsHost.style.pointerEvents = 'none';
          } catch(_){ }
          // Wire external prev/next
          if (prevBtn){ try { prevBtn.onclick = ()=> c.prev(); } catch(_){ } }
          if (nextBtn){ try { nextBtn.onclick = ()=> c.next(); } catch(_){ } }
        }
      } catch(_){ }
    } catch(_){ }
  }

  function getActiveAllocIndex(){
    const items = qsa('#diAllocCarousel .carousel-item');
    const idx = items.findIndex(el => el.classList.contains('active'));
    return idx < 0 ? 0 : idx;
  }
  function getActiveAllocRecipientId(){
    const idx = getActiveAllocIndex();
    const ids = Array.isArray(window.__diAllocIds)?window.__diAllocIds:[];
    return ids[idx] || null;
  }
  async function resolveMaxAvailable(cat, name){
    try {
      const params = new URLSearchParams({ group: 'merge', page: '1', limit: '1' });
      if (cat) params.set('category', cat);
      if (name) params.set('q', name);
      const res = await fetch(`${INVENTORY_API_BASE}/list?${params.toString()}`, {
        credentials: 'include',
        headers: { Accept: 'application/json' }
      });
      if (!res.ok) return null;
      const j = await res.json().catch(()=>null);
      const it = Array.isArray(j?.data?.items) ? j.data.items[0] : null;
      if (!it) return null;
      const qty = parseInt(it?.total_quantity ?? it?.quantity ?? 0, 10) || 0;
      const unit = (it?.unit ?? it?.unit_label ?? '').trim();
      return { qty, unit };
    } catch (_) {
      return null;
    }
  }

  function cacheKey(cat, name){
    return `${(cat||'').toLowerCase()}::${(name||'').toLowerCase()}`;
  }

  const maxCache = new Map();

  function primeMaxAvailable(cat, name, qty, unit){
    try {
      const key = cacheKey(cat, name);
      if (!key) return;
      const normalizedQty = Math.max(0, parseInt(qty ?? 0, 10) || 0);
      const normalizedUnit = (unit || '').trim();
      const existing = maxCache.get(key);
      if (existing) {
        const existingQty = Math.max(0, parseInt(existing.qty ?? 0, 10) || 0);
        if (existingQty >= normalizedQty) {
          if (!existing.unit && normalizedUnit) {
            existing.unit = normalizedUnit;
            maxCache.set(key, existing);
          }
          return;
        }
      }
      maxCache.set(key, { qty: normalizedQty, unit: normalizedUnit });
    } catch (_) {}
  }

  function addAllocItemToRecipient(recipientId, cat, name, qty, unit, statusLabel){
    try{
      if (!recipientId) return;
      const host = document.getElementById('alloc-items-' + recipientId);
      if (!host) return;
      let list = host.querySelector('ul');
      if (!list){ list = document.createElement('ul'); list.className = 'list-unstyled mb-0'; host.appendChild(list); }
      const li = document.createElement('li');
      li.className = 'd-flex align-items-center border-bottom py-1 small px-2';
      li.dataset.category = (cat || '').toLowerCase();
      li.dataset.name = (name || '').toLowerCase();
      const label = [cat||'', name||''].filter(Boolean).join(' • ');
      const statusBadge = (statusLabel && String(statusLabel).trim()) ? `<span class="badge bg-warning text-dark ms-2">${statusLabel}</span>` : '';
      const q = Math.max(1, parseInt(qty||1,10)||1);
      const u = (unit||'') || '';
      li.innerHTML = `
        <span class="alloc-label flex-grow-1">${label} ${statusBadge}</span>
        <div class="d-flex align-items-center gap-2" style="width:90px; justify-content:flex-end">
          <input type="number" class="form-control form-control-sm alloc-qty-input" min="0" value="${q}" style="width:80px" />
        </div>
        <span class="alloc-unit text-center" style="width:120px">${u}</span>
        <button type="button" class="btn btn-sm p-0 alloc-del-btn ms-2" aria-label="Remove">
          <i class="bi bi-x-lg text-danger"></i>
        </button>`;
      list.appendChild(li);
      const originalQty = Math.max(1, parseInt(qty || 1, 10) || 1);
      // Bind edit/delete handlers and prevent carousel from sliding on interaction
      const qtyInput = li.querySelector('.alloc-qty-input');
      if (qtyInput){
        // Allow normal input focus/editing; only stop propagation so carousel doesn't slide
        const stopBubble = (e)=>{ try{ e.stopImmediatePropagation(); }catch(_){} try{ e.stopPropagation(); }catch(_){} };
        qtyInput.addEventListener('input', (e)=>{ const v = Math.max(0, parseInt(e.target.value||'0',10)||0); e.target.value = String(v); });
        ['click','mousedown','pointerdown','touchstart'].forEach(ev=> qtyInput.addEventListener(ev, stopBubble));
        const key = cacheKey(cat, name);
        const enforceMax = async ()=>{
          try {
            const current = Math.max(0, parseInt(qtyInput.value || '0', 10) || 0);
            if (current === 0) {
              qtyInput.value = String(originalQty);
              return;
            }
            let cached = maxCache.get(key);
            if (!cached) {
              cached = await resolveMaxAvailable(cat, name);
              if (cached) maxCache.set(key, cached);
            }
            const max = cached?.qty ?? null;
            if (max !== null && max >= 0) {
              let others = 0;
              try {
                const allInputs = document.querySelectorAll('.alloc-qty-input');
                allInputs.forEach((inp)=>{
                  if (inp === qtyInput) return;
                  const liNode = inp.closest('li');
                  if (!liNode) return;
                  const liCat = (liNode.dataset.category || '').toLowerCase();
                  const liName = (liNode.dataset.name || '').toLowerCase();
                  if (liCat === (cat || '').toLowerCase() && liName === (name || '').toLowerCase()) {
                    const val = Math.max(0, parseInt(inp.value || '0', 10) || 0);
                    others += val;
                  }
                });
              } catch(_) {}
              const remaining = Math.max(0, max - others);
              if (current > remaining) {
                qtyInput.value = String(remaining);
              }
            }
            if (!unit && cached?.unit) {
              try { qtyInput.closest('li').querySelector('.alloc-unit').textContent = cached.unit; } catch(_){ }
            }
          } catch (_) {}
        };
        qtyInput.addEventListener('blur', enforceMax);
        qtyInput.addEventListener('change', enforceMax);
        qtyInput.addEventListener('keyup', (ev)=>{
          if (ev.key === 'Enter') enforceMax();
        });
        // Immediately enforce on create
        enforceMax();
      }
      const delBtn = li.querySelector('.alloc-del-btn');
      if (delBtn){
        const stopAll = (e)=>{ try{ e.stopImmediatePropagation(); }catch(_){} try{ e.stopPropagation(); }catch(_){} try{ e.preventDefault(); }catch(_){} };
        // Prevent carousel gestures but allow click to reach remover handler
        ['mousedown','mouseup','pointerdown','pointerup','touchstart','touchend'].forEach(ev=> delBtn.addEventListener(ev, stopAll, { capture: true }));
        // Remove on click after stopping propagation
        delBtn.addEventListener('click', (e)=>{ stopAll(e); try{ li.remove(); }catch(_){} }, { capture: true });
        // Inner icon: same behavior
        const icon = delBtn.querySelector('i');
        if (icon){
          ['mousedown','mouseup','pointerdown','pointerup','touchstart','touchend'].forEach(ev=> icon.addEventListener(ev, stopAll, { capture: true }));
          icon.addEventListener('click', (e)=>{ stopAll(e); try{ li.remove(); }catch(_){} }, { capture: true });
        }
      }
    } catch(_){ }
  }

  function attachAllocGlobalControls(){
    // Prevent double-binding which caused duplicate adds
    if (window.__diAllocControlsBound) return;
    window.__diAllocControlsBound = true;
    const addBtn = qs('#diGlobalAddBtn');
    const autoAllBtn = qs('#diGlobalAutoAllBtn');
    const selName = qs('#diGlobalName');
    const qtyInp = qs('#diGlobalQty');
    const getSelectLabel = (el)=>{
      if (!el) return '';
      const val = (el.value||'').trim();
      if (val) return val;
      const opt = el.selectedOptions && el.selectedOptions[0];
      if (opt && opt.text) return opt.text.trim();
      // Try Select2 rendered text
      try {
        const sel2 = el.nextElementSibling?.querySelector?.('.select2-selection__rendered');
        const txt = (sel2?.textContent||'').trim();
        if (txt && !/^(item name|category)$/i.test(txt)) return txt; // ignore placeholder labels
      } catch(_){ }
      return (el.textContent||'').trim();
    };
    if (addBtn){
      addBtn.addEventListener('click', ()=>{
        let name = getSelectLabel(selName);
        let cat = '';
        let qty = parseInt(qtyInp?.value||'0',10)||0;
        if (qty<=0) qty = 1;
        const rid = getActiveAllocRecipientId();
        if (!rid){
          try { console.warn('[DI][alloc] add: invalid inputs', { rid, cat, name, qty }); } catch(_){ }
          const meta = qs('#diAllocMeta'); if (meta) meta.textContent = 'Please select an item name.';
          return;
        }
        let unit = '';
        try {
          const sel2Data = (window.jQuery && jQuery.fn && jQuery('#diGlobalName').select2) ? jQuery('#diGlobalName').select2('data') : [];
          if (Array.isArray(sel2Data) && sel2Data[0]) {
            const meta = sel2Data[0];
            if (!name) name = (meta.text || meta.id || '').trim();
            if (meta.__category) cat = meta.__category;
            if (meta.__unit) unit = meta.__unit;
          }
        } catch(_){ }
        if (!name){
          try { console.warn('[DI][alloc] add: invalid inputs', { rid, cat, name, qty }); } catch(_){ }
          const meta = qs('#diAllocMeta'); if (meta) meta.textContent = 'Please select an item name.';
          return;
        }
        addAllocItemToRecipient(rid, cat, name, qty, unit);
      });
    }
    if (autoAllBtn){
      try { console.log('[DI][alloc] auto-all controls attached'); } catch(_){ }
      autoAllBtn.addEventListener('click', ()=>{
        try { console.log('[DI][alloc] auto-all clicked', { selectedIds: window.__diAllocIds }); } catch(_){ }
        const ids = Array.isArray(window.__diAllocIds)?window.__diAllocIds:[];
        if (!ids.length){
          const meta = qs('#diAllocMeta');
          if (meta) meta.textContent = 'Please select recipients first.';
          else try { console.warn('[DI][alloc] auto-all: meta node missing'); } catch(_){ }
          return;
        }
        // Clear existing auto-added rows so each run shows fresh results
        try {
          ids.forEach(rid => {
            const host = document.getElementById('alloc-items-' + rid);
            if (host) host.innerHTML = '';
          });
          const meta = qs('#diAllocMeta');
          if (meta) {
            const pct = Math.round(getDistributableFraction() * 100);
            meta.textContent = pct ? `Auto allocating ${pct}% of available quantity...` : 'Auto allocating with reserve disabled (100%).';
          } else {
            try { console.warn('[DI][alloc] auto-all: meta node missing before run'); } catch(_){ }
          }
          tryAutoAllAllItems(null, ids)
            .then(res => {
              const metaNode = qs('#diAllocMeta');
              if (!metaNode) {
                try { console.warn('[DI][alloc] auto-all: meta node missing after run'); } catch(_){ }
                return;
              }
              if (res?.applied) {
                const pct = Math.round(getDistributableFraction() * 100);
                const itemsLabel = res.itemsProcessed === 1 ? 'item' : 'items';
                metaNode.textContent = `Added ${res.totalUnits} unit${res.totalUnits === 1 ? '' : 's'} from ${res.itemsProcessed} ${itemsLabel} using ${pct}% distributable inventory.`;
              } else {
                const reason = res?.reason || 'no_match';
                if (reason === 'no_items') {
                  metaNode.textContent = 'No inventory items matched the selected filters.';
                } else if (reason === 'no_allocations') {
                  metaNode.textContent = `Fetched ${res?.scanned ?? 0} items but none met the minimum allocation threshold.`;
                } else {
                  metaNode.textContent = 'No distributable inventory matched the current selection.';
                }
              }
              try { console.log('[DI][alloc] auto-all result', res); } catch(_){ }
            })
            .catch(err => {
              const metaNode = qs('#diAllocMeta');
              if (metaNode) metaNode.textContent = 'Auto allocation failed. Please try again.';
              try { console.error('[DI][alloc] auto-all failed', err); } catch(_){ }
            });
        } catch(err) {
          try { console.error('[DI][alloc] auto-all exception', err); } catch(_){ }
        }
      });
    }
  }

  // Try algorithmic allocation by fetching total available for item/category from Inventory API
  async function tryAlgorithmicAutoAll(cat, name, ids){
    try {
      await loadDistributableSettings();
    } catch(err){
      diLogError('DIP preload (simpleInit)', err);
    }
    return new Promise((resolve)=>{
      if (!(window.Allocation && typeof window.Allocation.allocateItems === 'function')){ resolve({ applied:false }); return; }
      const params = new URLSearchParams({ q: name, group: 'merge', page: '1', limit: '1' });
      if (cat) params.set('category', cat);
      // Ensure we have a fresh population map from the Allocation module
      const ensurePop = async ()=>{
        try{
          let list = Array.isArray(window.__diAllRecipients) ? window.__diAllRecipients : [];
          if ((!list || list.length===0) && typeof fetchRecipients === 'function'){
            list = await fetchRecipients();
            if (Array.isArray(list)) window.__diAllRecipients = list;
          }
          if (window.Allocation && typeof window.Allocation.buildPopulationMap === 'function'){
            return window.Allocation.buildPopulationMap(list||[]);
          }
        } catch(err) {
          diLogError('ensurePop (single auto)', err);
        }
        return new Map();
      };
      fetch(`${INVENTORY_API_BASE}/list?${params.toString()}`, { credentials: 'include' })
        .then(r=>r.json()).then(data => {
          const items = data?.data?.items || [];
          const it = items[0] || {};
          const totalQty = parseInt(it?.total_quantity||it?.quantity||0,10)||0;
          // Enforce minimum available quantity for auto-allocation (single-item)
          try {
            const status = String(it?.derived_status || '').toLowerCase();
            const isSoon = (status === 'expiring soon' || status === 'soon to expire');
            if (!isSoon && totalQty < 20){ resolve({ applied:false, reason: 'below_threshold' }); return; }
            if (!isSoon && totalQty < 30){ resolve({ applied:false, reason: 'below_threshold' }); return; }
          } catch(_) {
            if (totalQty < 20){ resolve({ applied:false, reason: 'below_threshold' }); return; }
          }
          // Skip expired goods
          try {
            const status = String(it?.derived_status || '').toLowerCase();
            const expRaw = String(it?.earliest_expiry || it?.expiry_date || '').trim();
            if (status === 'expired') { resolve({ applied:false }); return; }
            if (expRaw) {
              const exp = new Date(expRaw + 'T00:00:00');
              const today = new Date(); today.setHours(0,0,0,0);
              if (exp < today) { resolve({ applied:false }); return; }
            }
          } catch(_) { }
          // Tag filter: if item has tags, restrict recipients to those sharing at least one tag
          const itemTags = normalizeTags(it?.tags_concat || it?.tags || '');
          let eligibleIds = ids.slice();
          if (itemTags.size){
            const tagMap = buildRecipientTagMap();
            eligibleIds = ids.filter(id => hasTagIntersect(itemTags, tagMap.get(Number(id))));
            if (!eligibleIds.length){ resolve({ applied:false }); return; }
          }
          const fraction = getDistributableFraction();
          const allocatableTotal = Math.floor(totalQty * fraction);
          primeMaxAvailable(cat, name, totalQty, it.unit);

          ensurePop().then((popMap)=>{
            const recipients = (window.Allocation && typeof window.Allocation.recipientsWithPopulation==='function')
              ? window.Allocation.recipientsWithPopulation(eligibleIds, popMap)
              : eligibleIds.map(id => ({ id, population: popMap.get(Number(id)) }));
            try { console.log('[DI][alloc] recipients (algo one)', recipients); } catch(_){ }
            const allocs = window.Allocation.allocateItems(totalQty, recipients);
            if (!Array.isArray(allocs) || !allocs.length){ resolve({ applied:false }); return; }
            let sum = 0;
            const statusLabel = (String(it?.derived_status||'').toLowerCase()==='expiring soon' || String(it?.derived_status||'').toLowerCase()==='soon to expire') ? 'Soon To Expire' : '';
            const fallback = [];
            allocs.forEach(a => {
              const n = Math.max(0, parseInt(a.allocation||0,10)||0);
              const minPerRecipient = (totalQty < 30)
                ? Math.max(1, Math.floor(3 * fraction) || 1)
                : 1;
              if (n < minPerRecipient) {
                fallback.push(a);
                return;
              }
              addAllocItemToRecipient(a.id, cat, name, n, (it.unit||''), statusLabel);
              sum += n;
            });
            let availableExtra = Math.max(0, totalQty - sum);
            if (availableExtra > 0 && fallback.length){
              for (const cand of fallback){
                if (availableExtra <= 0) break;
                addAllocItemToRecipient(cand.id, cat, name, 1, (it.unit||''), statusLabel);
                sum += 1;
                availableExtra -= 1;
              }
            }
            resolve({ applied:true, sum });
          }).catch(err=>{
            diLogError('ensurePop (single auto allocate)', err);
            resolve({ applied:false });
          });
        }).catch(err=>{ diLogError('fetch inventory (single auto)', err); resolve({ applied:false }); });
    });
  }

  // Allocate ALL available inventory items across recipients
  async function tryAutoAllAllItems(cat, ids){
    try {
      await loadDistributableSettings();
    } catch(err){
      diLogError('DIP preload (auto-all)', err);
    }
    if (!(Array.isArray(ids) && ids.length && window.Allocation && typeof window.Allocation.allocateItems === 'function')){
      try { console.warn('[DI][alloc] auto-all: no recipients passed'); } catch(_){ }
      return { applied:false, reason: 'no_recipients' };
    }
    const params = new URLSearchParams({ group: 'merge', page: '1', limit: '100' });

    const ensurePopAll = async ()=>{
      try{
        let list = Array.isArray(window.__diAllRecipients) ? window.__diAllRecipients : [];
        if ((!list || list.length===0) && typeof fetchRecipients === 'function'){
          list = await fetchRecipients();
          if (Array.isArray(list)) window.__diAllRecipients = list;
        }
        if (window.Allocation && typeof window.Allocation.buildPopulationMap === 'function'){
          return window.Allocation.buildPopulationMap(list||[]);
        }
      } catch(err){ diLogError('ensurePopAll', err); }
      return new Map();
    };

    let data;
    try {
      const res = await fetch(`${INVENTORY_API_BASE}/list?${params.toString()}`, { credentials: 'include' });
      data = await res.json().catch(()=>null);
    } catch(err){
      diLogError('fetch inventory (auto-all)', err);
      return { applied:false, reason: 'fetch_error', error: err?.message };
    }
    if (!data){
      diLogError('inventory response empty (auto-all)', null);
      return { applied:false, reason: 'no_response' };
    }

    let items = data?.data?.items || [];
    const pages = parseInt(data?.data?.pagination?.pages || 1, 10) || 1;
    if (pages > 1) {
      for (let p = 2; p <= pages; p++) {
        try {
          const pParams = new URLSearchParams(params);
          pParams.set('page', String(p));
          const res = await fetch(`${INVENTORY_API_BASE}/list?${pParams.toString()}`, { credentials: 'include' });
          const dd = await res.json().catch(()=>null);
          const arr = Array.isArray(dd?.data?.items) ? dd.data.items : [];
          if (arr.length) items = items.concat(arr);
        } catch(err){ diLogError('fetch inventory page (auto-all)', err); }
      }
    }
    if (!items.length){
      try { console.warn('[DI][alloc] auto-all: no items returned', { category: cat, idsCount: ids.length }); } catch(_){ }
      return { applied:false, reason: 'no_items' };
    }

    try {
      const toDateVal = (it)=>{
        const s = (it.earliest_expiry || it.expiry_date || '').trim();
        const d = new Date(s);
        return isNaN(d.getTime()) ? new Date('9999-12-31') : d;
      };
      items.sort((a,b)=>{
        const sa = String(a.derived_status||'').toLowerCase();
        const sb = String(b.derived_status||'').toLowerCase();
        const aSoon = (sa === 'expiring soon' || sa === 'soon to expire');
        const bSoon = (sb === 'expiring soon' || sb === 'soon to expire');
        if (aSoon !== bSoon) return aSoon ? -1 : 1;
        const da = toDateVal(a).getTime();
        const db = toDateVal(b).getTime();
        return da - db;
      });
    } catch(_) { }

    const popMap = await ensurePopAll();
    const recipients = (window.Allocation && typeof window.Allocation.recipientsWithPopulation==='function')
      ? window.Allocation.recipientsWithPopulation(ids, popMap)
      : ids.map(id => ({ id, population: popMap.get(Number(id)) }));
    try { console.log('[DI][alloc] recipients (all items)', recipients); } catch(_){ }

    let totalUnits = 0;
    let itemsProcessed = 0;
    const scanned = items.length;
    const fraction = getDistributableFraction();

    for (const it of items){
      const name = (it.item_name ?? it.product_name ?? '').trim();
      const category = (it.category ?? it.product_category ?? '').trim();
      const totalQty = parseInt(it.total_quantity ?? it.quantity ?? 0, 10) || 0;
      if (!name || totalQty <= 0) continue;
      try {
        const st = String(it.derived_status || '').toLowerCase();
        const expRaw2 = (it.earliest_expiry || it.expiry_date || '').trim();
        if (st === 'expired') continue;
        if (expRaw2) {
          const exp2 = new Date(expRaw2 + 'T00:00:00');
          const today2 = new Date(); today2.setHours(0,0,0,0);
          if (exp2 < today2) continue;
        }
        const isSoonCheck = (st === 'expiring soon' || st === 'soon to expire');
        if (!isSoonCheck && totalQty < 30) {
          try { console.info('[DI][alloc] auto-all skip: below 30 units', { name, category, totalQty }); } catch(_){ }
          continue;
        }
      } catch(_){ }

      const eligible = recipients.slice();
      primeMaxAvailable(category, name, totalQty, it.unit);
      const allocs = window.Allocation.allocateItems(totalQty, eligible);
      if (!Array.isArray(allocs) || !allocs.length) continue;
      let itemUnits = 0;
      const statusLc = String(it.derived_status || '').toLowerCase();
      const isSoon = (statusLc === 'expiring soon' || statusLc === 'soon to expire');
      const statusLabel = isSoon ? 'Soon To Expire' : '';
      const fallback = [];
      allocs.forEach(a => {
        const n = Math.max(0, parseInt(a.allocation||0,10)||0);
        const minPerRecipient = (totalQty < 30)
          ? Math.max(1, Math.floor(3 * fraction) || 1)
          : 1;
        if (n < minPerRecipient) {
          fallback.push(a);
          return;
        }
        addAllocItemToRecipient(a.id, category, name, n, (it.unit||''), statusLabel);
        itemUnits += n;
      });
      let availableExtra = Math.max(0, totalQty - itemUnits);
      if (availableExtra > 0 && fallback.length){
        for (const cand of fallback){
          if (availableExtra <= 0) break;
          addAllocItemToRecipient(cand.id, category, name, 1, (it.unit||''), statusLabel);
          itemUnits += 1;
          availableExtra -= 1;
        }
      }
      if (itemUnits>0){
        totalUnits += itemUnits;
        itemsProcessed++;
      }
    }

    if (!(itemsProcessed>0 && totalUnits>0)){
      try { console.warn('[DI][alloc] auto-all: no allocations produced', { itemsProcessed, totalUnits, scanned, fraction }); } catch(_){ }
      return { applied:false, reason: 'no_allocations', totalUnits, itemsProcessed, scanned };
    }
    return { applied: true, totalUnits, itemsProcessed, scanned };
  }
  try { window.tryAutoAllAllItems = tryAutoAllAllItems; } catch(_){ }

  // Allocate Now: persist current carousel items to DB and redirect to DistributeResult.html
  function attachAllocateNow(){
    const btn = qs('#diAllocateWeek');
    if (!btn) return;
    if (btn.__bound) return; btn.__bound = true;
    btn.addEventListener('click', async ()=>{
      try{
        btn.disabled = true;
        const ids = Array.isArray(window.__diAllocIds)?window.__diAllocIds:[];
        if (!ids.length){ return; }
        // 1) Create a run
        const apiBase = (typeof API_BASE_URL === 'string' && API_BASE_URL) ? API_BASE_URL : '/php/api';
        let periodKey = null;
        try {
          if (typeof window.diGetPeriodKey === 'function') {
            periodKey = window.diGetPeriodKey();
          } else if (typeof window.getPeriodKeyFromInputs === 'function') {
            periodKey = window.getPeriodKeyFromInputs();
          }
        } catch(_){ }
        const runRes = await fetch(`${apiBase}/allocations/index.php?action=create_run`, {
          method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: JSON.stringify({ note: 'Allocate Now from DistributeItems', period_key: periodKey || null })
        });
        const runJ = await runRes.json().catch(()=>null);
        const runId = (runRes.ok && runJ?.success && runJ?.data?.run_id) ? parseInt(runJ.data.run_id,10)||0 : 0;
        if (!runId){
          const meta = qs('#diAllocMeta');
          if (meta) meta.innerHTML = `<div class="alert alert-danger py-2 mb-2">Failed to create run: ${runJ?.error || ('HTTP '+runRes.status)}</div>`;
          try { console.error('[DI][AllocateNow] create_run failed', runRes.status, runJ); } catch(_){ }
          return;
        }
        // 2) Build items per recipient from DOM
        const perRecipient = new Map();
        ids.forEach(rid => {
          const host = document.getElementById('alloc-items-' + rid);
          const rows = host ? Array.from(host.querySelectorAll('ul > li')) : [];
          const items = [];
          rows.forEach(li => {
            const label = (li.querySelector('.alloc-label')?.textContent||'').trim();
            const parts = label.split(' • ');
            const category = (parts.length>1 ? parts[0] : '') || null;
            const name = parts.length>1 ? parts[1] : (parts[0] || '');
            const qty = Math.max(1, parseInt(li.querySelector('.alloc-qty-input')?.value||'0',10)||0);
            if (name && qty>0){ items.push({ item_name: name, category, quantity: qty }); }
          });
          if (items.length) perRecipient.set(Number(rid), items);
        });
        // 3) Create results per recipient
        let failures = 0;
        for (const [rid, items] of perRecipient.entries()){
          const payload = { recipient_id: rid, items, run_id: runId, allocation_code: null, notify_admin: false };
          const res = await fetch(`${apiBase}/allocations/index.php?action=create_result`, {
            method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body: JSON.stringify(payload)
          });
          const j = await res.json().catch(()=>null);
          if (!res.ok || !j?.success){
            failures++;
            try { console.error('[DI][AllocateNow] create_result failed', { rid, status: res.status, j, payload }); } catch(_){ }
          }
        }
        if (failures > 0){
          const meta = qs('#diAllocMeta');
          if (meta) meta.innerHTML = `<div class="alert alert-warning py-2 mb-2">Saved with ${failures} error(s). Open console → Network tab for details.</div>`;
        }
        // 4) Auto-redirect to result page for this run (with debug + cache-bust)
        const v = Date.now();
        window.location.href = `DistributeResult.html?run_id=${encodeURIComponent(String(runId))}&debug=1&v=${v}`;
      } catch(_){
        // If anything fails, keep button enabled for retry
        const meta = qs('#diAllocMeta'); if (meta) meta.innerHTML = '<div class="alert alert-danger py-2 mb-2">Allocate Now failed. See console for details.</div>';
      } finally {
        try { btn.disabled = false; } catch(_){ }
      }
    });
  }

  // --- Tag utilities ---
  function normalizeTags(input){
    const set = new Set();
    try{
      const s = String(input||'');
      if (!s) return set;
      s.split(',').map(t=>t.trim()).filter(Boolean).forEach(t=> set.add(t.toLowerCase()));
    } catch(_){ }
    return set;
  }
  function buildRecipientTagMap(){
    const map = new Map();
    try{
      const all = Array.isArray(window.__diAllRecipients) ? window.__diAllRecipients : [];
      all.forEach(u => {
        const id = Number(u.user_id||u.id)||0; if (!id) return;
        const raw = u.tags || u.specialties || u.specialty_tags || u.preferences || '';
        map.set(id, normalizeTags(raw));
      });
    } catch(_){ }
    return map;
  }
  function hasTagIntersect(itemTagSet, recipientTagSet){
    try{
      if (!(itemTagSet instanceof Set) || !(recipientTagSet instanceof Set)) return false;
      for (const t of itemTagSet){ if (recipientTagSet.has(t)) return true; }
      return false;
    } catch(_){ return false; }
  }

  // Build a population map from available recipient fields
  function buildRecipientPopulationMap(){
    const map = new Map();
    try{
      const all = Array.isArray(window.__diAllRecipients) ? window.__diAllRecipients : [];
      all.forEach(u => {
        const id = parseInt(u.user_id||u.id,10)||0; if (!id) return;
        // Prefer DB-backed fields from recipient_profiles
        const totalResidents = Number(u.total_residents);
        const maleCnt = Number(u.male_count);
        const femaleCnt = Number(u.female_count);
        let pop = NaN;
        if (Number.isFinite(totalResidents) && totalResidents > 0){
          pop = totalResidents;
        } else if ((Number.isFinite(maleCnt) && maleCnt >= 0) || (Number.isFinite(femaleCnt) && femaleCnt >= 0)){
          const m = Number.isFinite(maleCnt) ? maleCnt : 0;
          const f = Number.isFinite(femaleCnt) ? femaleCnt : 0;
          const sum = m + f; if (sum > 0) pop = sum;
        }
        // Fallbacks for various front-end/API shapes
        if (!(Number.isFinite(pop) && pop > 0)){
          const candidates = [u.population, u.pop, u.beneficiaries, u.household_size, u.people, u.residents, u.members, u.population_total]
            .map(x=>Number(x))
            .filter(v=>Number.isFinite(v) && v>0);
          if (candidates.length) pop = candidates[0];
        }
        if (Number.isFinite(pop) && pop > 0){ map.set(id, pop); }
      });
    } catch(_){ }
    return map;
  }

  // Rebuild carousel and ensure controls when Allocation tab is shown (even without pressing Next)
  function attachAllocTabShown(){
    try {
      const allocTab = document.querySelector('button#di-alloc-tab');
      const recipientsTab = document.querySelector('button#di-recipients-tab');
      if (!allocTab) return;
      allocTab.addEventListener('shown.bs.tab', ()=>{
        try { buildAllocCarouselFromSelected(); } catch(_){ }
        try { attachAllocGlobalControls(); } catch(_){ }
        try { initAllocSelects(); } catch(_){ }
        try { attachAllocateNow(); } catch(_){ }
      });
      // If allocation tab is already active (e.g., forced by fallback script), show the toast once shortly after init
      // setTimeout(diMaybeShowAllocationToast, 150);
      // Optional: when returning to Recipients tab, update Selected count
      if (recipientsTab){
        recipientsTab.addEventListener('shown.bs.tab', ()=>{ try { updateSelectedCount(); } catch(_){ } });
      }
    } catch(_){ }
  }

  function attachSoonExpireAlert(){
    try {
      const btn = document.getElementById('diSoonExpireBtn');
      if (!btn || btn.__diSoonBound) return;
      btn.__diSoonBound = true;
      btn.addEventListener('click', () => {
        try { diMaybeShowAllocationToast(); } catch(_){ }
      });
    } catch(_){ }
  }

  // Initialize Select2 for Item Name on Allocation tab
  function initAllocSelects(){
    try{
      if (window.jQuery && jQuery.fn && jQuery.fn.select2){
        const $ = window.jQuery;
        if ($('#diGlobalName').length){
          if ($('#diGlobalName').data('select2')) { $('#diGlobalName').select2('destroy'); }
          $('#diGlobalName').select2({
            placeholder: 'Item name',
            width: '100%',
            allowClear: true,
            minimumInputLength: 1,
            ajax: {
              // Use Inventory API list (group=merge) to pull item_name
              url: 'php/api/inventory/index.php/list',
              dataType: 'json',
              delay: 250,
              data: p => ({ q: p.term || '', group: 'merge', page: 1, limit: 50 }),
              processResults: d => {
                try {
                  const items = d?.data?.items || [];
                  const seen = new Map(); // name -> meta
                  const today = new Date(); today.setHours(0,0,0,0);
                  items.forEach(it => {
                    const name = (it.item_name ?? it.product_name ?? '').trim();
                    if (!name) return;
                    // Exclude expired in search results
                    const status = String(it?.derived_status || '').toLowerCase();
                    const expRaw = String(it?.earliest_expiry || it?.expiry_date || '').trim();
                    if (status === 'expired') return;
                    if (expRaw){
                      const exp = new Date(expRaw + 'T00:00:00');
                      if (exp < today) return;
                    }
                    const totalQty = parseInt(it?.total_quantity ?? it?.quantity ?? 0, 10) || 0;
                    if (!seen.has(name)){
                      seen.set(name, { id: name, text: name, __qty: totalQty, __lowQty: totalQty < 20, __unit: (it?.unit||''), __category: (it?.category ?? it?.product_category ?? '').trim() });
                    } else {
                      // Accumulate quantity if same name appears multiple times (safety)
                      const cur = seen.get(name);
                      const sum = (parseInt(cur.__qty,10)||0) + totalQty;
                      cur.__qty = sum; cur.__lowQty = sum < 20; if (!cur.__unit && it?.unit) cur.__unit = it.unit; if (!cur.__category && (it?.category || it?.product_category)) cur.__category = (it?.category ?? it?.product_category ?? '').trim();
                      seen.set(name, cur);
                    }
                  });
                  return { results: Array.from(seen.values()) };
                } catch(_){ return { results: [] }; }
              }
            },
            templateResult: (data) => {
              try {
                if (!data || !data.text) return data?.text || '';
                const el = document.createElement('div');
                el.className = 'd-flex align-items-center justify-content-between';
                const left = document.createElement('span'); left.textContent = data.text;
                el.appendChild(left);
                if (data.__lowQty) {
                  const b = document.createElement('span');
                  b.className = 'badge bg-warning text-dark ms-2';
                  b.textContent = '<20 qty';
                  el.appendChild(b);
                }
                return $(el);
              } catch(_) { return data?.text || ''; }
            },
            templateSelection: (data) => data?.text || ''
          });
        }
      }
    } catch(_){ }
  }

  // Next button navigates to Allocation tab and builds carousel
  function attachNextButton(){
    const btn = qs('#diNextTabBtn');
    const allocTab = qs('#di-alloc-tab');
    if (!btn || !allocTab) return;
    btn.addEventListener('click', ()=>{
      try { buildAllocCarouselFromSelected(); } catch(_){ }
      try {
        if (window.bootstrap?.Tab){
          const tab = window.bootstrap.Tab.getOrCreateInstance(allocTab);
          tab.show();
        } else {
          allocTab.click();
        }
      } catch(_){ }
      try { attachAllocGlobalControls(); } catch(_){ }
    });
  }

  // If Selected is still empty, force-fill from carryovers -> current week -> other weeks (max 10)
  function forceSelectedFromPlanCarry(){
    try{
      const selected = qs('#diSelected'); const pool = qs('#diPool');
      if (!selected || !pool) return;
      if (qsa('#diSelected .di-card').length > 0) return; // already filled
      // Resolve weeks
      let weeks = (window.__diWeeks && typeof window.__diWeeks === 'object') ? window.__diWeeks : null;
      if (!weeks && Array.isArray(window.__diWeeksEx)){
        try { weeks = normalizeWeeksExToMap(window.__diWeeksEx); } catch(_){ weeks = null; }
      }
      if (!weeks) weeks = { W1:[], W2:[], W3:[], W4:[] };
      const toNums = (arr)=> (Array.isArray(arr)?arr:[]).map(v=>parseInt(v,10)).filter(n=>Number.isFinite(n)&&n>0);
      const map = { W1: toNums(weeks.W1), W2: toNums(weeks.W2), W3: toNums(weeks.W3), W4: toNums(weeks.W4) };
      const carry = (window.__diCarryOverSet instanceof Set) ? window.__diCarryOverSet : new Set();
      const cur = getCurrentBucketNow();
      const order = ['W1','W2','W3','W4'];
      const curIdx = ({W1:0,W2:1,W3:2,W4:3})[cur] ?? 0;
      const nextOrder = [ order[(curIdx+1)%4], order[(curIdx+2)%4], order[(curIdx+3)%4] ];
      const ids=[]; const push=(id)=>{ if(ids.length<10 && !ids.includes(id)) ids.push(id); };
      Array.from(carry).forEach(id=>push(id));
      map[cur].forEach(id=>push(id));
      nextOrder.forEach(b=> map[b].forEach(id=>{ if (cur!=='W1' && b==='W1' && !carry.has(id)) return; push(id); }));
      if (!ids.length) return;
      selected.innerHTML='';
      ids.forEach(id => { let card = qs(`.di-card[data-id="${id}"]`) || ensureCardForId(id); if (card) selected.appendChild(card); });
      try { sortSelectedByCarryovers(); } catch(_){ }
      updateSelectedCount(); updateHeaderMeta();
      try { refreshBadges(); } catch(_){ }
    } catch(_){ }
  }

  // Fetch allocations for a given period_key and return an array of items
  async function fetchRunAllocationsByPeriod(periodKey){
    try{
      // New universal read: list_by_period will ensure a run exists and return items
      const res = await fetch(`${API_BASE_URL}/allocations/index.php?action=list_by_period&period_key=${encodeURIComponent(periodKey)}&t=${Date.now()}`, { credentials:'include', headers:{'Accept':'application/json'} });
      if (res.status === 401){ return { items: [], ok: false, auth: true }; }
      const j = await res.json().catch(()=>null);
      if (!res.ok || !j?.success) return { items: [], ok: false };
      const items = Array.isArray(j?.data?.items) ? j.data.items : [];
      return { items, ok: true };
    } catch(_){ return { items: [], ok: false }; }
  }

  // Create a di-card for a recipient id if it doesn't exist in DOM
  function ensureCardForId(id){ try { return window.ensureCardForId(id); } catch(_){ return null; } }

  // Build __diAllRecipients from existing Pool DOM as a fallback
  function backfillRecipientsFromDom(){ try { return window.backfillRecipientsFromDom(); } catch(_){ } }

  // Strict plan-based selection builder (carryovers -> current week -> next -> others), W1 excluded when current!=W1 unless carryover
  function buildStrictPlanFinalIds(carrySet, weeks, curBucket){
    const toNums = (arr)=> (Array.isArray(arr)?arr:[]).map(v=>parseInt(v,10)).filter(n=>Number.isFinite(n)&&n>0);
    const map = { W1: toNums(weeks?.W1), W2: toNums(weeks?.W2), W3: toNums(weeks?.W3), W4: toNums(weeks?.W4) };
    const order = ['W1','W2','W3','W4'];
    const idx = ({W1:0,W2:1,W3:2,W4:3})[curBucket] ?? 0;
    const nextOrder = [ order[(idx+1)%4], order[(idx+2)%4], order[(idx+3)%4] ];
    const finalIds = Array.from(carrySet instanceof Set ? carrySet : new Set());
    const push = (id)=>{ if (finalIds.length<10 && !finalIds.includes(id)) finalIds.push(id); };
    map[curBucket].forEach(id => { if (!(carrySet instanceof Set && carrySet.has(id))) push(id); });
    nextOrder.forEach(b => { map[b].forEach(id => { if (curBucket!=='W1' && b==='W1' && !(carrySet instanceof Set && carrySet.has(id))) return; push(id); }); });
    return finalIds.slice(0,10);
  }

// Adapter: annotate cards using the extended plan; also persist a legacy-compatible weeks map
function annotateCardsWithWeeksEx(weeksEx){ try { return window.annotateCardsWithWeeksEx(weeksEx); } catch(_){ } }

// adminDistribute.js – SIMPLE_MODE enabled: legacy complex paths remain in file but are not executed.
(function(){
  'use strict';
  try { console.log('[DI] adminDistribute.js loaded'); } catch(_){ }

  const API_BASE_URL = DI_API_BASE = diResolveApiBase();
  INVENTORY_API_BASE = `${API_BASE_URL}/inventory/index.php`;

  // Global toggle to enable/disable background polling
  const ENABLE_POLLING = false;
  // Minimal deterministic mode: use plan + cancelled to preload Selected
  const SIMPLE_MODE = true;
  const qs = (s, r=document)=> r.querySelector(s);
  const qsa = (s, r=document)=> Array.from(r.querySelectorAll(s));

  // Build Selected deterministically: carryovers (cancelled) -> current week -> others (max 10)
  function buildSelectedSimple(weeksMap, cancelledSet){
    try{
      const selected = qs('#diSelected'); const pool = qs('#diPool'); if (!selected || !pool) return;
      const cur = getCurrentBucketNow();
      let ids = [];
      try { ids = window.Scheduling.buildSelectedIds(weeksMap, cancelledSet, { currentBucket: cur }); } catch(_){ ids = []; }
      selected.innerHTML = '';
      ids.forEach(id => { const card = qs(`.di-card[data-id="${id}"]`) || ensureCardForId(id); if (card) selected.appendChild(card); });
      updateSelectedCount(); updateHeaderMeta();
      try { refreshBadges(); } catch(_){ }
    } catch(_){ }
  }

  async function simpleInit(){
    await loadDistributableSettings().catch(()=>{});
    try { console.log('[DI][simple] init'); } catch(_){ }
    try { if (!window.__WEEK_START) { window.__WEEK_START = 'monday'; console.log('[DI][simple] defaulting __WEEK_START=monday'); } } catch(_){ }
    // One-time UI hooks
    try { attachSearch(); attachNextButton(); attachAllocTabShown(); attachSoonExpireAlert(); } catch(_){ }
    // 1) Ensure recipients pool exists
    let recs = [];
    try {
      recs = await fetchRecipients();
      if (Array.isArray(recs) && recs.length){
        try { window.__diAllRecipients = recs; } catch(_){ }
        renderRecipientPools(recs, []);
        try { sortPoolByWeeks(); } catch(_){ }
        try { attachDelegatedInteractions(); } catch(_){ }
      }
    } catch(_){ recs = []; }
    // 2) Load plan (weekly list used by RecipientsList.html)
    let weeksMap = null;
    try {
      const data = await fetchMonthlyPlan(currentMonth());
      weeksMap = normalizeWeeksExToMap(data);
      try { window.__diWeeks = weeksMap; } catch(_){ }
      annotateCardsWithWeeks(weeksMap);
      try { console.log('[DI][simple] plan counts:', { W1:(weeksMap.W1||[]).length, W2:(weeksMap.W2||[]).length, W3:(weeksMap.W3||[]).length, W4:(weeksMap.W4||[]).length }, 'week_start:', getWeekStart()); } catch(_){ }
    } catch(_){ weeksMap = { W1:[], W2:[], W3:[], W4:[] }; }
    // 2a) If only W1 has items and W2..W4 are empty, try auto-detecting week-start and reloading plan
    try {
      const sizes = {
        W1: Array.isArray(weeksMap?.W1)?weeksMap.W1.length:0,
        W2: Array.isArray(weeksMap?.W2)?weeksMap.W2.length:0,
        W3: Array.isArray(weeksMap?.W3)?weeksMap.W3.length:0,
        W4: Array.isArray(weeksMap?.W4)?weeksMap.W4.length:0,
      };
      if (sizes.W1 > 0 && sizes.W2 === 0 && sizes.W3 === 0 && sizes.W4 === 0 && typeof window.autoDetectWeekStartAndPlan === 'function'){
        const chosen = await window.autoDetectWeekStartAndPlan(currentMonth());
        if (chosen && chosen.wm){
          weeksMap = chosen.wm;
          try { window.__WEEK_START = chosen.basis; } catch(_){ }
          try { window.__diWeeks = weeksMap; } catch(_){ }
          try { console.log('[DI][plan][fallback] basis:', chosen.basis, 'counts:', { W1:weeksMap.W1.length, W2:weeksMap.W2.length, W3:weeksMap.W3.length, W4:weeksMap.W4.length }); } catch(_){ }
          annotateCardsWithWeeks(weeksMap);
        }
      }
    } catch(_){ }
    // 2b) If plan is empty, fallback to any cached plan or seed from recipients
    try {
      const countPlan = (m)=> (['W1','W2','W3','W4'].reduce((s,k)=> s + ((Array.isArray(m?.[k])?m[k]:[]).length||0), 0));
      if (!weeksMap || countPlan(weeksMap) === 0){
        // Try cached window.__diWeeks
        if (window.__diWeeks && countPlan(window.__diWeeks) > 0){
          weeksMap = window.__diWeeks;
        } else if (Array.isArray(window.__diWeeksEx) && window.__diWeeksEx.length > 0){
          weeksMap = normalizeWeeksExToMap(window.__diWeeksEx);
        } else if (Array.isArray(recs) && recs.length > 0){
          // Seed current week with first 10 recipients
          const cur = getCurrentBucketNow();
          const ids = recs.slice(0,10).map(u => parseInt(u.user_id||u.id,10)).filter(Number.isFinite);
          weeksMap = { W1:[], W2:[], W3:[], W4:[] };
          weeksMap[cur] = ids;
        } else {
          weeksMap = { W1:[], W2:[], W3:[], W4:[] };
        }
        try { window.__diWeeks = weeksMap; } catch(_){ }
        annotateCardsWithWeeks(weeksMap);
      }
    } catch(_){ }
    // 3) Previous period and cancelled recipients (carryovers)
    let cancelledSet = new Set();
    try {
      const prevPk = getPreviousPeriodKey();
      const prev = await fetchRunAllocationsByPeriod(prevPk);
      const norm = (s)=> String(s||'').trim().toLowerCase();
      const CANCEL = new Set(['cancelled','canceled','declined','no show']);
      const ids = (prev.ok ? prev.items : []).filter(a=>CANCEL.has(norm(a.status))).map(a=>parseInt(a.recipient_id,10)).filter(Number.isFinite);
      cancelledSet = new Set(ids);
      try { window.__diCarryOverSet = new Set(ids); } catch(_){ }
    } catch(_){ cancelledSet = new Set(); }
    // 4) Materialize cards for all planned IDs so Pool/Selected aren’t blank
    try {
      const allIds = ['W1','W2','W3','W4']
        .flatMap(k => (Array.isArray(weeksMap?.[k])?weeksMap[k]:[]))
        .map(v=>parseInt(v,10))
        .filter(Number.isFinite);
      allIds.forEach(id => { ensureCardForId(id); });
      try { sortPoolByWeeks(); } catch(_){ }
      try { attachDelegatedInteractions(); } catch(_){ }
    } catch(_){ }
    // 5) Deterministic Selected
    buildSelectedSimple(weeksMap, cancelledSet);
    try { console.log('[DI][simple] selected size:', qsa('#diSelected .di-card').length); } catch(_){ }
    // 6) Last-resort guarantee: if still empty, synthesize visible content
    try {
      const poolCount = qsa('#diPool .di-card').length;
      const selCount = qsa('#diSelected .di-card').length;
      if (poolCount === 0){
        const placeholders = Array.from({length:10}, (_,i)=> i+1);
        placeholders.forEach(id => { ensureCardForId(id); });
      }
      if (qsa('#diSelected .di-card').length === 0){
        const cur = getCurrentBucketNow();
        const placeholders = Array.from({length:10}, (_,i)=> i+1);
        if (!weeksMap || (['W1','W2','W3','W4'].every(k => !(Array.isArray(weeksMap?.[k]) && weeksMap[k].length)))){
          weeksMap = { W1:[], W2:[], W3:[], W4:[] };
          weeksMap[cur] = placeholders;
        }
        buildSelectedSimple(weeksMap, cancelledSet);
      }
    } catch(_){ }
    // Final UI touches
    try { sortPoolByWeeks(); } catch(_){ }
    try { attachDelegatedInteractions(); } catch(_){ }
  }

  // Early resilient console stub for reload
  try {
    window.diReload = () => {
      try {
        if (SIMPLE_MODE && typeof simpleInit === 'function') return simpleInit();
        if (typeof init === 'function') return init();
      } catch(_){}
    };
  } catch(_){ }

  

  // Treat any of these as cancellation statuses from DB
  const CANCEL_STATUSES = new Set(['Cancelled','Canceled','Declined','No Show']);
  const COMPLETED_STATUSES = new Set(['Completed','Done','Delivered','Fulfilled']);

  // Periodic sync loop removed in SIMPLE_MODE

  // Helpers
  function getWeekStart(){
    try { if (typeof window.getWeekStart === 'function') return window.getWeekStart(); } catch(_){ }
    try { if (typeof window.__WEEK_START === 'string' && window.__WEEK_START) return window.__WEEK_START; } catch(_){ }
    return 'monday';
  }
  function diGetBaseDate(){ try { return window.diGetBaseDate(); } catch(_){ const d=new Date(); d.setHours(0,0,0,0); return d; } }
  function formatYMD(d){ return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
  function startOfWeek(date, weekStart){
    const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const targetDow = (weekStart === 'monday') ? 1 : 0;
    const dow = d.getDay();
    const diff = (dow - targetDow + 7) % 7;
    d.setDate(d.getDate() - diff);
    d.setHours(0,0,0,0);
    return d;
  }
  function isoWeekNumber(date){
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7; // Sun=7
    d.setUTCDate(d.getUTCDate() + 4 - dayNum); // nearest Thursday
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  }
  function colorForIsoWeek(iso){ const idx = (iso % 4) + 1; return idx===1?'primary':idx===2?'danger':idx===3?'warning':'info'; }
  function planWeekIndexForDate(d){ const day = d.getDate(); if (day<=7) return 1; if (day<=14) return 2; if (day<=21) return 3; return 4; }
  function upcomingWeekStartDates(weekStart){
    // Not used for indexing anymore; kept for reference
    const base=diGetBaseDate(); return [0,1,2,3].map(i=> new Date(base.getFullYear(), base.getMonth(), base.getDate()+i*7));
  }
  function planWeekIndexByWeekStart(base){
    try { return window.planWeekIndexByWeekStart(base); } catch(_){
      try {
        const weekStart = getWeekStart();
        const monthFirst = new Date(base.getFullYear(), base.getMonth(), 1);
        monthFirst.setHours(0,0,0,0);
        const wsDow = weekStart === 'monday' ? 1 : 0;
        const firstDow = monthFirst.getDay();
        const offset = (firstDow - wsDow + 7) % 7;
        const firstWeekStart = new Date(monthFirst.getFullYear(), monthFirst.getMonth(), 1 - offset);
        const starts = [0,1,2,3].map(i => new Date(firstWeekStart.getFullYear(), firstWeekStart.getMonth(), firstWeekStart.getDate() + i * 7));
        const target = new Date(base.getFullYear(), base.getMonth(), base.getDate());
        target.setHours(0,0,0,0);
        for (let i = 0; i < starts.length; i++){
          const start = new Date(starts[i]);
          const end = new Date(start);
          end.setDate(start.getDate() + 6);
          if (target >= start && target <= end) return i + 1;
        }
      } catch(_){ }
      const fallback = planWeekIndexForDate(base);
      return fallback < 1 ? 1 : fallback > 4 ? 4 : fallback;
    } }
  // Compute current week bucket using FIXED buckets (1-7=W1, 8-14=W2, 15-21=W3, 22+=W4)
  function resolveCurrentWeekBucket(){ try { return window.resolveCurrentWeekBucket(); } catch(_){ const idx = planWeekIndexByWeekStart(diGetBaseDate()); return idx===1?'W1':idx===2?'W2':idx===3?'W3':'W4'; } }

  // Use today's date (not #diBaseDate) for selection logic to avoid stale input forcing W1
  function getCurrentBucketNow(){ try { return window.getCurrentBucketNow(); } catch(_){ const idx = planWeekIndexByWeekStart(new Date()); return idx===1?'W1':idx===2?'W2':idx===3?'W3':'W4'; } }

  // Build a period_key from base date using week-start aware indexing
  function getPeriodKeyFromInputs(){ try { return window.getPeriodKeyFromInputs(); } catch(_){ const base=diGetBaseDate(); const month=`${base.getFullYear()}-${String(base.getMonth()+1).padStart(2,'0')}`; const idx=planWeekIndexByWeekStart(base); return `${month}-W${idx}`; } }

  // Compute the previous period key using week-start aware indexing
  function getPreviousPeriodKey(){ try { return window.getPreviousPeriodKey(); } catch(_){ const base = diGetBaseDate(); const weekStart=getWeekStart(); const idx=planWeekIndexByWeekStart(base); let prevIdx=idx-1; if (prevIdx<1){ prevIdx=4; } const monthNum=base.getMonth()+1; if (prevIdx===4){ monthNum-=1; if (monthNum<1){ monthNum=12; const year=base.getFullYear(); year-=1; } } const mm=String(monthNum).padStart(2,'0'); const year=base.getFullYear(); return `${year}-${mm}-W${prevIdx}`; } }

  // Query server to compute previous week carryovers and expose them globally
  async function finalizeCurrentWeekIfPossible(){ try { return await window.finalizeCurrentWeekIfPossible(); } catch(_){ } }

  function showAuthBanner(){ try { return window.showAuthBanner(); } catch(_){ } }

  function currentMonth(){ try { return window.currentMonth(); } catch(_){ const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`; } }

  async function fetchMonthlyPlan(month){ try { return await window.fetchMonthlyPlan(month); } catch(_){ return { month: month||currentMonth(), weeks_ex: [] }; } }

  // Badge annotate
  function annotateCardsWithWeeks(weeksMap){ try { return window.annotateCardsWithWeeks(weeksMap); } catch(_){ } }

  // Ensure current-week recipients in Selected have a badge and matching border, without overriding carryovers
  function ensureCurrentWeekDecor(weeksMap){ try { return window.ensureCurrentWeekDecor(weeksMap); } catch(_){ } }

  function updateSelectedCount(){ try { return window.updateSelectedCount(); } catch(_){ } }

  // Update current week header meta if container exists
  function updateHeaderMeta(){ try { return window.updateHeaderMeta(); } catch(_){ } }

  function getSelectedIds(){ return qsa('#diSelected .di-card').map(el => parseInt(el.dataset.id, 10)); }

  async function updateAllocateNowState(){ /* keep UI responsive; logic handled server-side elsewhere */ }

  function refreshBadges(){ try { return window.refreshBadges(); } catch(_){ } }

  // Core: Sync and build Selected with replacement rules
  async function syncSelectedWithRunAllocations(){
    try{
      const pk = getPeriodKeyFromInputs();
      if (!pk) return;

      const runRes = await fetch(`${API_BASE_URL}/allocations/index.php?action=run_by_period&period_key=${encodeURIComponent(pk)}&t=${Date.now()}`, { credentials:'include', headers:{'Accept':'application/json'} });
      const runJ = await runRes.json().catch(()=>null);
      if (runRes.status === 401){
        window.__diAuthRequired = true;
        try { showAuthBanner(); } catch(_){ }
        return; // keep existing DOM
      }
      const selected = qs('#diSelected'); const pool = qs('#diPool'); if (!selected || !pool) return;
      // Ensure recipients list is available for materializing cards later
      if (!Array.isArray(window.__diAllRecipients) || window.__diAllRecipients.length === 0){
        try { window.__diAllRecipients = await fetchRecipients(); } catch(_){ window.__diAllRecipients = []; }
        if (!Array.isArray(window.__diAllRecipients) || window.__diAllRecipients.length === 0){ backfillRecipientsFromDom(); }
      }

      // Weeks plan
      let weeks = (window.__diWeeks && typeof window.__diWeeks === 'object') ? window.__diWeeks : null;
      if (!weeks && Array.isArray(window.__diWeeksEx)){
        try { weeks = normalizeWeeksExToMap(window.__diWeeksEx); } catch(_){ weeks = null; }
      }
      try {
        if (weeks){
        }
      } catch(_){ }

      // Previous period statuses to drive rollback and replacement drop
      const prevPk = getPreviousPeriodKey();
      // Expose previous period key so annotate can color carryovers consistently
      try { window.__diPrevWeekKey = prevPk; } catch(_){ }
      const prevRes = await fetchRunAllocationsByPeriod(prevPk);
      const prevItems = prevRes.ok ? prevRes.items : [];
      const norm = (s)=> String(s||'').trim().toLowerCase();
      const CANCEL_LC = new Set(['cancelled','canceled','declined','no show']);
      const COMPLETE_LC = new Set(['completed','done','delivered','fulfilled']);
      const prevCancelled = new Set(
        prevItems
          .filter(a => CANCEL_LC.has(norm(a.status)))
          .map(a => parseInt(a.recipient_id,10))
          .filter(Number.isFinite)
      );
      const prevCompleted = new Set(
        prevItems
          .filter(a => COMPLETE_LC.has(norm(a.status)))
          .map(a => parseInt(a.recipient_id,10))
          .filter(Number.isFinite)
      );
      // Merge prev cancelled into carryover set produced by finalize (server may already return same)
      const mergedCarry = new Set(window.__diCarryOverSet instanceof Set ? Array.from(window.__diCarryOverSet) : []);
      prevCancelled.forEach(id => mergedCarry.add(id));
      window.__diCarryOverSet = mergedCarry;

      if (!runRes.ok || !runJ?.success || !runJ?.data?.run_id){
        if (weeks){
          const toNums = (arr)=> (Array.isArray(arr)?arr:[]).map(v=>parseInt(v,10)).filter(n=>Number.isFinite(n)&&n>0);
          const curBucket = getCurrentBucketNow();
          const curKey = curBucket; // 'W1'|'W2'|'W3'|'W4' (fixed buckets)
          const idxMap = { W1:1, W2:2, W3:3, W4:4 };
          const curIdx = idxMap[curBucket] || 1;
          const nextIdx = Math.min(curIdx + 1, 4);
          const nextKey0 = nextIdx === 1 ? 'W1' : nextIdx === 2 ? 'W2' : nextIdx === 3 ? 'W3' : 'W4';
          const forcedNextKey = (curBucket==='W1') ? 'W2' : nextKey0;
          const order = ['W1','W2','W3','W4'].filter(k => k!==curKey && k!==forcedNextKey);
          const carrySet = (window.__diCarryOverSet instanceof Set) ? window.__diCarryOverSet : new Set();
          let finalIds = Array.from(carrySet);
          // current week's plan first
          toNums(weeks[curKey]).slice(0,10).forEach(id => { if (finalIds.length<10 && !finalIds.includes(id)) finalIds.push(id); });
          // then immediate next week as replacements
          toNums(weeks[forcedNextKey]).forEach(id => { if (finalIds.length<10 && !finalIds.includes(id) && !prevCompleted.has(id)) finalIds.push(id); });
          // then the remaining weeks
          order.forEach(k => { toNums(weeks[k]).forEach(id => { if (finalIds.length<10 && !finalIds.includes(id) && !prevCompleted.has(id)) finalIds.push(id); }); });
          // If not W1, exclude W1 items unless they are true carryovers, BUT only if current week has plan entries
          try {
            const curBucket = resolveCurrentWeekBucket();
            const curHas = Array.isArray(weeks[curKey]) && weeks[curKey].length > 0;
            if (curBucket !== 'W1' && curHas){
              const W1set = new Set(toNums(weeks.W1));
              finalIds = finalIds.filter(id => !W1set.has(id) || carrySet.has(id));
            }
          } catch(_){ }
          // If still empty, build strictly from plan
          if (!finalIds.length){
            const strictIds = buildStrictPlanFinalIds(carrySet, weeks, resolveCurrentWeekBucket());
            if (strictIds.length){ finalIds = strictIds; }
          }
          // If still not enough, fallback to all recipients, excluding completed/cancelled and duplicates
          try {
            if (finalIds.length < 10 && Array.isArray(window.__diAllRecipients)){
              const disallowed = new Set(finalIds.concat(Array.from(prevCompleted)));
              const banned = new Set();
              // we also should not include cancelled this week
              // derive currentCancelled from prevCancelled? not needed here, keep simple
              window.__diAllRecipients.forEach(u => {
                const id = parseInt(u.user_id||u.id,10)||0;
                if (!id) return;
                if (disallowed.has(id)) return;
                if (banned.has(id)) return;
                finalIds.length<10 && finalIds.push(id);
                banned.add(id);
              });
            }
          } catch(_){ }
          if (finalIds.length){
            selected.innerHTML = '';
            finalIds.forEach(id => { const card = qs(`.di-card[data-id="${id}"]`) || ensureCardForId(id); if (card) selected.appendChild(card); });
          } else {
            try { console.warn('[DI] No fallback finalIds computed; keeping previous Selected'); } catch(_){ }
            return;
          }
          try { sortSelectedByCarryovers(); } catch(_){ }
          updateSelectedCount();
          updateHeaderMeta();
          try { console.log('[DI] built (no-run) finalIds:', finalIds); } catch(_){ }
        } else {
          const cards = qsa('#diPool .di-card').slice(0,10);
          if (cards.length){
            selected.innerHTML = '';
            cards.forEach(card => selected.appendChild(card));
          } else {
            try { console.warn('[DI] Pool empty and no weeks plan; keeping previous Selected'); } catch(_){ }
            return;
          }
          updateSelectedCount();
          updateHeaderMeta();
        }
        return;
      }

      const runId = parseInt(runJ.data.run_id,10)||0; if (!runId) return;
      const listRes = await fetch(`${API_BASE_URL}/allocations/index.php?action=list_by_run&run_id=${encodeURIComponent(String(runId))}&t=${Date.now()}`, { credentials:'include', headers:{'Accept':'application/json'} });
      const listJ = await listRes.json().catch(()=>null);
      if (!listRes.ok || !listJ?.success) return;
      const arr = Array.isArray(listJ?.data?.items) ? listJ.data.items : [];

      const activeStatuses = new Set(['Pending','Notified','Acknowledged','Scheduled']);
      const activeIds = Array.from(new Set(
        arr.filter(a => activeStatuses.has(String(a.status||'').trim()))
           .map(a => parseInt(a.recipient_id,10))
           .filter(n=>Number.isFinite(n)&&n>0)
      ));
      try { window.__diActiveIds = activeIds.slice(); } catch(_){ }
      const cancelledIds = arr.filter(a => CANCEL_LC.has(norm(a.status))).map(a=>parseInt(a.recipient_id,10)).filter(Number.isFinite);
      const currentCompleted = new Set(
        arr.filter(a => COMPLETE_LC.has(norm(a.status)))
           .map(a => parseInt(a.recipient_id,10))
           .filter(Number.isFinite)
      );

      // Build exact 10 preloaded recipients based on current plan, with replacements from immediate next week
      const toNums = (arr)=> (Array.isArray(arr)?arr:[]).map(v=>parseInt(v,10)).filter(n=>Number.isFinite(n)&&n>0);
      const W1all = toNums(weeks?.W1); const W2all = toNums(weeks?.W2); const W3all = toNums(weeks?.W3); const W4all = toNums(weeks?.W4);
      const cancelledSet = new Set(cancelledIds);
      const curIdx = planWeekIndexByWeekStart(diGetBaseDate());
      const curKey = curIdx === 1 ? 'W1' : curIdx === 2 ? 'W2' : curIdx === 3 ? 'W3' : 'W4';
      const nextIdx = Math.min(curIdx + 1, 4);
      const nextKey0 = nextIdx === 1 ? 'W1' : nextIdx === 2 ? 'W2' : nextIdx === 3 ? 'W3' : 'W4';
      const forcedNextKey = (resolveCurrentWeekBucket()==='W1') ? 'W2' : nextKey0;
      const arrForKey = (k)=> k==='W1'?W1all : k==='W2'?W2all : k==='W3'?W3all : W4all;
      const curAll = arrForKey(curKey);
      const nextAll = arrForKey(forcedNextKey);
      const curFirst10 = curAll.slice(0,10);

      // Start with carryovers from previous week (rollback: prioritize cancelled recipients in the new week)
      const carrySet = (window.__diCarryOverSet instanceof Set) ? window.__diCarryOverSet : new Set();
      let finalIds = Array.from(carrySet);
      // Ensure active (already allocated in current run) stay included
      finalIds = finalIds.concat(activeIds.filter(id => !finalIds.includes(id) && !cancelledSet.has(id)));
      for (const id of curFirst10){ if (finalIds.length>=10) break; if (cancelledSet.has(id)) continue; if (finalIds.includes(id)) continue; finalIds.push(id); }
      const repMap = {};
      for (const id of nextAll){ if (finalIds.length>=10) break; if (cancelledSet.has(id)) continue; if (finalIds.includes(id)) continue; finalIds.push(id); repMap[id] = forcedNextKey; }
      if (finalIds.length < 10){
        const curRest = curAll.slice(10);
        for (const id of curRest){ if (finalIds.length>=10) break; if (cancelledSet.has(id)) continue; if (finalIds.includes(id)) continue; finalIds.push(id); }
      }
      if (finalIds.length < 10){
        const others = [W1all, W2all, W3all, W4all];
        for (const arr2 of others){ for (const id of arr2){ if (finalIds.length>=10) break; if (cancelledSet.has(id)) continue; if (finalIds.includes(id)) continue; finalIds.push(id); } if (finalIds.length>=10) break; }
      }

      try { window.__diReplacementSource = repMap; } catch(_){ }
      // If not W1, exclude W1 items unless they are true carryovers
      try {
        const curBucket = getCurrentWeekBucket();
        const curHas = curAll.length > 0;
        if (curBucket !== 'W1' && curHas){
          const W1set = new Set(W1all);
          finalIds = finalIds.filter(id => !W1set.has(id) || (window.__diCarryOverSet instanceof Set && window.__diCarryOverSet.has(id)));
        }
      } catch(_){ }
      // Finally, drop any previous-week completed IDs from the list (they were replacements last week)
      finalIds = finalIds.filter(id => !prevCompleted.has(id) || (window.__diCarryOverSet instanceof Set && window.__diCarryOverSet.has(id)));
      // If filters left us with 0, attempt strict plan build
      if (!finalIds.length){
        const strictIds = buildStrictPlanFinalIds(window.__diCarryOverSet, { W1:W1all, W2:W2all, W3:W3all, W4:W4all }, getCurrentWeekBucket());
        if (strictIds.length){ finalIds = strictIds; }
      }
      // If still not enough, fallback to all recipients excluding completed/cancelled/currentCompleted
      try {
        if (finalIds.length < 10 && Array.isArray(window.__diAllRecipients)){
          const disallowed = new Set(finalIds.concat(Array.from(prevCompleted)));
          const banned = new Set(cancelledIds.concat(Array.from(currentCompleted)));
          window.__diAllRecipients.forEach(u => {
            const id = parseInt(u.user_id||u.id,10)||0;
            if (!id) return;
            if (disallowed.has(id)) return;
            if (banned.has(id)) return;
            finalIds.length<10 && finalIds.push(id);
            disallowed.add(id);
          });
        }
      } catch(_){ }
      try { console.log('[DI] replacement using cur/next:', { baseDate: formatYMD(diGetBaseDate()), curKey, forcedNextKey, finalIds, repMap }); } catch(_){ }

      if (finalIds.length === 0){
        try { console.warn('[DI] Computed empty finalIds; leaving Selected unchanged'); } catch(_){ }
        // Final zero-guard: if plan exists for current bucket, render strictly from plan so Selected is never empty
        try {
          let weeks2 = (window.__diWeeks && typeof window.__diWeeks === 'object') ? window.__diWeeks : null;
          if (!weeks2 && Array.isArray(window.__diWeeksEx)){
            try { weeks2 = normalizeWeeksExToMap(window.__diWeeksEx); } catch(_){ weeks2 = null; }
          }
          const curBucket = resolveCurrentWeekBucket();
          if (weeks2 && Array.isArray(weeks2[curBucket]) && weeks2[curBucket].length){
            const strictIds = buildStrictPlanFinalIds(window.__diCarryOverSet, weeks2, curBucket);
            if (strictIds.length){
              selected.innerHTML = '';
              strictIds.forEach(id => { let card = qs(`.di-card[data-id="${id}"]`) || ensureCardForId(id); if (card) selected.appendChild(card); });
              updateSelectedCount(); updateHeaderMeta(); try { refreshBadges(); } catch(_){ }
            }
          }
        } catch(_){ }
        return;
      }
      selected.innerHTML = '';
      finalIds.forEach(id => {
        let card = qs(`.di-card[data-id="${id}"]`);
        if (!card) card = ensureCardForId(id);
        if (card) selected.appendChild(card);
      });
      // If still empty due to missing DOM cards, attempt to render pool and retry
      if (selected.children.length === 0 && Array.isArray(window.__diAllRecipients) && window.__diAllRecipients.length){
        renderRecipientPools(window.__diAllRecipients, []);
        finalIds.forEach(id => {
          let card = qs(`.di-card[data-id="${id}"]`);
          if (!card) card = ensureCardForId(id);
          if (card) selected.appendChild(card);
        });
      }
      try { sortSelectedByCarryovers(); } catch(_){ }
      updateSelectedCount();
      updateHeaderMeta();
      try { refreshBadges(); } catch(_){ }
      // If Selected stayed empty due to lack of run data, ensure plan-based fallback renders something
      ensureSelectedHasPlanFallback();
    } catch(_){ /* non-fatal */ }
  }

  function sortSelectedByCarryovers(){ try { return window.sortSelectedByCarryovers(); } catch(_){ } }

  // --- Recipients fetch and render ---
  async function fetchRecipients(){ try { return await window.fetchRecipients(); } catch(_){ return []; } }

  function renderRecipientPools(items, selectedIds = []){ try { return window.renderRecipientPools(items, selectedIds); } catch(_){ } }

  

  // Legacy init is unused in SIMPLE_MODE
  async function init(){ try { console.log('[DI] init skipped (SIMPLE_MODE)'); } catch(_){} }

  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', () => {
      if (SIMPLE_MODE && typeof window.SchedulingAlgorithmUISimpleInit === 'function') {
        window.SchedulingAlgorithmUISimpleInit();
      } else if (typeof init === 'function') {
        init();
      }
      try { attachAllocTabShown(); attachSoonExpireAlert(); } catch(_){}
    });
  } else {
    if (SIMPLE_MODE && typeof window.SchedulingAlgorithmUISimpleInit === 'function') {
      window.SchedulingAlgorithmUISimpleInit();
    } else if (typeof init === 'function') {
      init();
    }
    try { attachAllocTabShown(); attachSoonExpireAlert(); } catch(_){}
  }
  // Minimal console exports for debugging in SIMPLE_MODE
  try {
    window.diGetCurrentWeekBucket = getCurrentBucketNow;
    window.diGetPeriodKey = getPeriodKeyFromInputs;
    window.diReload = SIMPLE_MODE ? (function(){ return (typeof window.SchedulingAlgorithmUISimpleInit==='function' ? window.SchedulingAlgorithmUISimpleInit() : undefined); }) : init;
  } catch(_){ }
})();










