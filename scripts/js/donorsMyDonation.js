(function(){
  'use strict';

  const API_BASE_URL = (typeof window.API_BASE_URL === 'string' && window.API_BASE_URL)
    ? window.API_BASE_URL
    : '/Capstone%20Project/php/api';

  function badge(status){
    switch(status){
      case 'Pending': return '<span class="badge bg-warning text-dark">Pending</span>';
      case 'Allocated': return '<span class="badge bg-info text-dark">Allocated</span>';
      case 'Picked Up': return '<span class="badge bg-primary">Picked Up</span>';
      case 'Arrived at warehouse': return '<span class="badge bg-secondary">Arrived</span>';
      case 'Failed Safety': return '<span class="badge bg-danger">Failed Safety</span>';
      case 'Completed': return '<span class="badge bg-success">Completed</span>';
      case 'Cancelled': return '<span class="badge bg-dark">Cancelled</span>';
      default: return `<span class="badge bg-light text-dark">${status||'Unknown'}</span>`;
    }
  }

  function fmtDateTime(s){
    if (!s) return '';
    const d = new Date(s);
    return isNaN(d) ? s : d.toLocaleString();
  }

  function escapeHtml(str){
    return (str||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));
  }

  async function fetchAll() {
    const res = await fetch(`${API_BASE_URL}/donations/index.php/list`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include'
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const json = await res.json();
    return json?.data?.items || [];
  }

  function groupByBatch(items){
    const groups = new Map();
    for (const r of items){
      const key = r.batch_id ? `b-${r.batch_id}` : `s-${r.id}`;
      if (!groups.has(key)) groups.set(key, { batch_id: r.batch_id || null, items: [], created_at: r.created_at });
      groups.get(key).items.push(r);
      // track representative created_at for sorting: latest within group
      const t = groups.get(key);
      if (!t.created_at || (r.created_at && r.created_at > t.created_at)) t.created_at = r.created_at;
    }
    // Sort groups by created_at desc
    return Array.from(groups.values()).sort((a,b) => (b.created_at || '').localeCompare(a.created_at || ''));
  }

  function render(groups){
    const tbody = document.querySelector('.table tbody');
    if (!tbody) return;
    if (!groups.length){
      tbody.innerHTML = '<tr><td colspan="6" class="text-center">No donations logged yet.</td></tr>';
      return;
    }

    let html = '';
    groups.forEach(group => {
      const isBatch = !!group.batch_id;
      if (isBatch){
        const count = group.items.length;
        const first = group.items[0] || {};
        const title = `Batch • ${count} item${count>1?'s':''}`;
        html += `
          <tr class="table-active group-row" data-batch-id="${group.batch_id}">
            <td class="py-2 align-middle">${fmtDateTime(group.created_at)}</td>
            <td class="py-2">
              <div class="fw-semibold"><button class="btn btn-sm btn-outline-secondary me-2 batch-toggle" type="button" aria-label="Toggle">Show</button>${title}</div>
            </td>
            <td class="py-2 align-middle">${badge(first.status || 'Pending')}</td>
            <td class="py-2 align-middle">${fmtDateTime(group.created_at)}</td>
          </tr>
          <tr class="child-container d-none" data-batch-id="${group.batch_id}">
            <td colspan="4" class="p-0">
              <table class="table table-sm mb-0">
                <thead>
                  <tr class="table-light">
                    <th>Item</th>
                    <th>Type</th>
                    <th>Qty</th>
                    <th>Expiry</th>
                    <th>Status</th>
                    <th>Reason</th>
                  </tr>
                </thead>
                <tbody>
                  ${group.items.map(r => `
                    <tr>
                      <td>${escapeHtml(r.name || '')}</td>
                      <td>${escapeHtml(r.type || '')}</td>
                      <td>${r.quantity ?? ''}</td>
                      <td>${escapeHtml(r.expiry_date || '')}</td>
                      <td>${badge(r.status)}</td>
                      <td>${r.fail_reason ? escapeHtml(r.fail_reason) : ((r.status||'') === 'Failed Safety' ? 'Failed safety check' : '—')}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </td>
          </tr>
        `;
      } else {
        const r = group.items[0];
        html += `
          <tr>
            <td>${fmtDateTime(group.created_at)}</td>
            <td>${escapeHtml(r.name || '')}</td>
            <td>${badge(r.status)}</td>
            <td>${fmtDateTime(r.created_at)}</td>
          </tr>
        `;
      }
    });

    tbody.innerHTML = html;
  }

  function bindEvents(){
    document.addEventListener('click', function(e){
      const btn = e.target.closest('.batch-toggle');
      if (!btn) return;
      const row = btn.closest('tr.group-row');
      const batchId = row?.getAttribute('data-batch-id');
      if (!batchId) return;
      const child = document.querySelector(`tr.child-container[data-batch-id="${batchId}"]`);
      if (!child) return;
      const showing = !child.classList.contains('d-none');
      child.classList.toggle('d-none', showing);
      btn.textContent = showing ? 'Show' : 'Hide';
    });
  }

  async function init(){
    try {
      const items = await fetchAll();
      // Attach absolute image URLs are already provided by API as image_full_url in index.php list
      // Group by batch and render all
      const groups = groupByBatch(items);
      render(groups);
      bindEvents();

      // KPI counters (batch-based)
      const pendingStatuses = new Set(['Pending','Allocated','Picked Up']);
      const batchGroups = groups.filter(g => !!g.batch_id);
      const total = batchGroups.length;
      const pending = batchGroups.filter(g => g.items.some(it => pendingStatuses.has(it.status || ''))).length;
      const arrived = batchGroups.filter(g => g.items.length > 0 && g.items.every(it => (it.status || '') === 'Arrived at warehouse')).length;
      const elTotal = document.getElementById('totalDonationsCount');
      const elPending = document.getElementById('pendingPickupsCount');
      const elArrived = document.getElementById('successfulDeliveriesCount');
      if (elTotal) elTotal.textContent = String(total);
      if (elPending) elPending.textContent = String(pending);
      if (elArrived) elArrived.textContent = String(arrived);
    } catch (e) {
      console.error('Failed to load donations', e);
    }
  }

  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
