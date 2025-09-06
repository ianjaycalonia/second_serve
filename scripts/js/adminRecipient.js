(function(){
  'use strict';

  // API base URL (consistent with other admin pages)
  const API_BASE_URL = (typeof window.API_BASE_URL === 'string' && window.API_BASE_URL)
    ? window.API_BASE_URL
    : '/Capstone%20Project/php/api';

  function escapeHtml(str){
    return (String(str||'')).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));
  }

  function badge(text, type='light'){
    return `<span class="badge bg-${type} ${type==='light'?'text-dark':''}">${text}</span>`;
  }

  async function fetchRecipients(){
    const res = await fetch(`${API_BASE_URL}/user_api.php?action=list&role=recipient&status=approved&t=${Date.now()}`, {
      method: 'GET', headers: { 'Accept': 'application/json' }, credentials: 'include', cache: 'no-store'
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const j = await res.json();
    return Array.isArray(j?.data?.items) ? j.data.items : [];
  }

  // There is no clear recipient mapping in donations schema, so we cannot compute Last Pickup Date reliably.
  // We'll leave it as em dash for now. If an allocation endpoint is added later, we can derive from that.
  function renderRecipients(items){
    const tbody = document.querySelector('main .table tbody');
    if (!tbody) return;
    const rows = items.map(u => {
      const recipientName = (u.organization_name && u.organization_name.trim()) ? u.organization_name.trim() : (u.name || '').trim();
      const type = (u.organization_name && u.organization_name.trim()) ? 'Organization' : 'Individual';
      const contact = (u.name || '').trim() || '—';
      const location = (u.address || '').trim() || '—';
      const lastPickup = '—';
      const status = (u.status === 'approved') ? badge('Active','success') : (u.status === 'pending' ? badge('Pending','warning') : badge('Inactive','secondary'));
      return `
        <tr>
          <td>${escapeHtml(recipientName)}</td>
          <td>${escapeHtml(type)}</td>
          <td>${escapeHtml(contact)}</td>
          <td>${escapeHtml(location)}</td>
          <td>${lastPickup}</td>
          <td>${status}</td>
          <td><a href="#" data-user-id="${u.user_id}">View / Edit</a></td>
        </tr>
      `;
    });
    tbody.innerHTML = rows.join('');
  }

  async function init(){
    try{
      const tbody = document.querySelector('main .table tbody');
      if (tbody){ tbody.innerHTML = `<tr><td colspan="7" class="text-center py-3">Loading recipients...</td></tr>`; }
      const recipients = await fetchRecipients();
      renderRecipients(recipients);
    } catch(err){
      console.error('Failed to load recipients:', err);
      const tbody = document.querySelector('main .table tbody');
      if (tbody){ tbody.innerHTML = `<tr><td colspan="7" class="text-center text-danger">Failed to load recipients (${escapeHtml(err.message)})</td></tr>`; }
    }
  }

  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
