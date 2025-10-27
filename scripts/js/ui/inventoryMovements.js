(function(){
  'use strict';
  const API_BASE_URL = typeof window.API_BASE_URL === 'string' && window.API_BASE_URL ? window.API_BASE_URL : '/php/api';

  function qs(id){ return document.getElementById(id); }

  function formatDateTime(dtStr){
    try{ const d = new Date(dtStr); if (!isNaN(d)) return d.toLocaleString(); }catch(_){}
    return dtStr || '';
  }

  let currentPage = 1;

  async function fetchMovements(){
    const days = qs('mvDays')?.value || '2';
    const mode = qs('mvMode')?.value || '';
    const direction = qs('mvDirection')?.value || 'all';
    const limit = parseInt(qs('mvPageSize')?.value || '20', 10);
    const url = new URL(`${API_BASE_URL}/inventory/index.php/movements`, window.location.origin);
    url.searchParams.set('days', days);
    url.searchParams.set('direction', direction);
    url.searchParams.set('page', String(currentPage));
    url.searchParams.set('limit', String(limit));
    if (mode) url.searchParams.set('mode', mode);
    url.searchParams.set('t', String(Date.now()));
    const res = await fetch(url.toString(), { credentials: 'include', headers: { Accept: 'application/json' } });
    const j = await res.json().catch(() => null);
    if (!res.ok || !j?.success) throw new Error(j?.error || `HTTP ${res.status}`);
    return j?.data || { items: [], pagination: { page: 1, pages: 1, total: 0, limit } };
  }

  function render(rows){
    const tbody = qs('mvTableBody');
    if (!tbody) return;
    if (!rows.length){
      tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted py-3">No movements found</td></tr>';
      return;
    }
    const html = rows.map(r => {
      const when = formatDateTime(r.created_at);
      const dir = (r.direction || '').toString();
      const item = (r.item_name || '').toString();
      const cat = (r.category || '').toString();
      const qty = Number(r.quantity||0);
      const mode = (r.mode || '').toString();
      const admin = (r.performed_by_name || '').toString();
      return `<tr>
        <td>${when}</td>
        <td>${escapeHtml(dir)}</td>
        <td>${escapeHtml(item)}</td>
        <td>${escapeHtml(cat)}</td>
        <td>${qty}</td>
        <td>${escapeHtml(mode)}</td>
        <td>${escapeHtml(admin)}</td>
      </tr>`;
    }).join('');
    tbody.innerHTML = html;
  }

  function escapeHtml(s){
    return String(s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));
  }

  function renderPagination(p){
    const el = qs('mvPagination');
    if (!el) return;
    const page = Number(p?.page||1), pages = Number(p?.pages||1), total = Number(p?.total||0);
    const disablePrev = page <= 1; const disableNext = page >= pages;
    el.innerHTML = `
      <div class="btn-group" role="group" aria-label="pagination">
        <button type="button" class="btn btn-sm btn-outline-secondary" id="mvPrev" ${disablePrev?'disabled':''}>&laquo; Prev</button>
        <span class="btn btn-sm btn-outline-secondary disabled">Page ${page} / ${pages || 1}</span>
        <button type="button" class="btn btn-sm btn-outline-secondary" id="mvNext" ${disableNext?'disabled':''}>Next &raquo;</button>
      </div>
      <span class="ms-2 small text-muted">Total: ${total}</span>
    `;
    const scrollBack = () => { try { el.scrollIntoView({ behavior: 'auto', block: 'end' }); } catch(_) {} };
    qs('mvPrev')?.addEventListener('click', async (e)=>{ e.preventDefault(); if (currentPage>1){ currentPage--; await load({ keepPos: true }); scrollBack(); }});
    qs('mvNext')?.addEventListener('click', async (e)=>{ e.preventDefault(); if (pages && currentPage<pages){ currentPage++; await load({ keepPos: true }); scrollBack(); }});
  }

  async function load(opts){
    const keepPos = !!(opts && opts.keepPos);
    const prevScrollY = keepPos ? window.scrollY : null;
    const tbody = qs('mvTableBody');
    if (tbody) tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted py-3">Loading...</td></tr>';
    try{
      const data = await fetchMovements();
      const rows = Array.isArray(data.items) ? data.items : [];
      render(rows);
      renderPagination(data.pagination);
      // Restore previous scroll position if requested
      if (keepPos && prevScrollY !== null) {
        try { window.scrollTo({ top: prevScrollY, left: 0, behavior: 'auto' }); } catch(_) { window.scrollTo(0, prevScrollY); }
      }
    } catch (err) {
      if (tbody) tbody.innerHTML = `<tr><td colspan="7" class="text-center text-danger py-3">Failed to load movements: ${escapeHtml(err?.message||'Error')}</td></tr>`;
    }
  }

  function init(){
    qs('mvRefresh')?.addEventListener('click', ()=>{ currentPage=1; load(); });
    qs('mvDays')?.addEventListener('change', ()=>{ currentPage=1; load(); });
    qs('mvDirection')?.addEventListener('change', () => {
      const dir = qs('mvDirection')?.value || 'all';
      const modeSel = qs('mvMode');
      if (modeSel) {
        // Disable mode when viewing IN since it only applies to OUT
        const isIn = dir === 'in';
        modeSel.disabled = isIn;
        if (isIn) modeSel.value = '';
      }
      currentPage=1; load();
    });
    qs('mvMode')?.addEventListener('change', ()=>{ currentPage=1; load(); });
    qs('mvPageSize')?.addEventListener('change', ()=>{ currentPage=1; load(); });
    load();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
