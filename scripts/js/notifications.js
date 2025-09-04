// Notifications polling and modal rendering (vanilla JS)
(function(){
  'use strict';

  // Compute API base URL in a robust way; reuse global if present
  const API_BASE_URL = (typeof window.API_BASE_URL === 'string' && window.API_BASE_URL)
    ? window.API_BASE_URL
    : (function(){
        // Same default used in auth.js
        return '/Capstone%20Project/php/api';
      })();

  // Attempt to read the current logged-in user from sessionStorage/localStorage
  function getStoredUser() {
    try {
      const s = sessionStorage.getItem('user') || localStorage.getItem('user');
      return s ? JSON.parse(s) : null;
    } catch(_) { return null; }
  }

  // DOM Elements (optional; script will no-op if absent)
  const modalEl = document.getElementById('notificationsModal');
  const listEl = document.getElementById('notificationsList'); // e.g., <ul id="notificationsList"></ul>
  const badgeEl = document.getElementById('notificationsBadge'); // optional unread count badge
  const bellAnchor = document.querySelector('a[data-bs-target="#notificationsModal"]');
  const bellIcon = bellAnchor ? (bellAnchor.querySelector('i') || bellAnchor) : null;

  if (!modalEl || !listEl) {
    // Nothing to do on this page
    return;
  }

  // State
  let pollingTimer = 0;
  let lastRender = [];

  function fmtDate(iso) {
    const d = new Date(iso);
    if (isNaN(d)) return '' + iso;
    return d.toLocaleString();
  }

  function buildItemHtml(n) {
    const unreadClass = n.read_status ? '' : 'unread';
    const iconHtml = n.type === 'donation_created' ? '📦' : (n.type === 'status_updated' ? '🚚' : '🔔');
    return `
      <li class="list-group-item d-flex align-items-start ${unreadClass} clickable" data-id="${n.id}" data-type="${n.type || ''}" data-ref-type="${n.reference_type || ''}" data-ref-id="${n.reference_id || ''}">
        <div class="me-2" aria-hidden="true">${iconHtml}</div>
        <div class="flex-grow-1">
          <div class="fw-semibold mb-1">${escapeHtml(n.message || '')}</div>
          <div class="text-muted small">${fmtDate(n.created_at)}${n.reference_type && n.reference_id ? ` · ${n.reference_type} #${n.reference_id}` : ''}</div>
        </div>
        ${n.read_status ? '' : '<span class="badge bg-primary align-self-center">new</span>'}
      </li>`;
  }

  function escapeHtml(s) {
    return (s || '').replace(/[&<>"]|'/g, function(c){
      switch(c){
        case '&': return '&amp;';
        case '<': return '&lt;';
        case '>': return '&gt;';
        case '"': return '&quot;';
        case "'": return '&#39;';
      }
      return c;
    });
  }

  function render(items) {
    // Update list
    listEl.innerHTML = items.length
      ? `<ul class="list-group">${items.map(buildItemHtml).join('')}</ul>`
      : '<div class="text-center text-muted py-4">No notifications yet</div>';

    // Update unread badge (if present)
    if (badgeEl) {
      const unread = items.filter(n => !n.read_status).length;
      badgeEl.textContent = unread > 0 ? String(unread) : '';
      badgeEl.style.display = unread > 0 ? '' : 'none';
      // Visually highlight the bell when there are unread notifications
      if (bellIcon) {
        if (unread > 0) {
          bellIcon.classList.add('text-danger');
          bellAnchor && bellAnchor.setAttribute('aria-label', 'Open notifications (unread)');
        } else {
          bellIcon.classList.remove('text-danger');
          bellAnchor && bellAnchor.setAttribute('aria-label', 'Open notifications');
        }
      }
    }

    // Click handlers to mark as read and redirect
    listEl.querySelectorAll('li[data-id]').forEach(li => {
      if (li.dataset.bound === '1') return;
      li.dataset.bound = '1';
      li.addEventListener('click', async () => {
        const id = parseInt(li.getAttribute('data-id'), 10);
        if (!id) return;
        const nType = (li.getAttribute('data-type') || '').toLowerCase();
        const refType = (li.getAttribute('data-ref-type') || '').toLowerCase();
        const refIdRaw = li.getAttribute('data-ref-id');
        const refId = refIdRaw && /^\d+$/.test(refIdRaw) ? parseInt(refIdRaw, 10) : null;
        try {
          await fetch(`${API_BASE_URL}/notifications_api.php?action=read&id=${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include'
          });
          // Optimistically update UI
          li.classList.remove('unread');
          const badge = li.querySelector('.badge');
          if (badge) badge.remove();
          // Determine destination
          const user = getStoredUser();
          const role = (user?.role || '').toLowerCase();
          let dest = null;
          // Admin: new donation => Donation.html
          if (nType === 'donation_created') {
            dest = 'Donation.html';
          } else if (nType === 'status_updated') {
            // Donors: go to their donations page; Admins: Donation.html
            if (role === 'donor') dest = 'donorsMyDonation.html';
            else if (role === 'admin') dest = 'Donation.html';
          }
          // Fallbacks by reference_type if not set above
          if (!dest && refType === 'donation') dest = (role === 'admin') ? 'Donation.html' : (role === 'donor' ? 'donorsMyDonation.html' : null);
          if (!dest && refType === 'batch') dest = (role === 'admin') ? 'Donation.html' : (role === 'donor' ? 'donorsMyDonation.html' : null);

          if (dest) {
            // Close modal before navigation for better UX
            try {
              const modal = bootstrap.Modal.getInstance(modalEl) || bootstrap.Modal.getOrCreateInstance(modalEl);
              modal.hide();
            } catch(_) {}
            window.location.href = dest;
          }
        } catch (e) {
          console.error('Failed to mark read', e);
        }
      });
    });
  }

  async function fetchNotifications() {
    const user = getStoredUser();
    const userId = user?.user_id || user?.userId || user?.id;
    if (!userId) return;

    try {
      const res = await fetch(`${API_BASE_URL}/notifications_api.php?user_id=${encodeURIComponent(userId)}`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include'
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const json = await res.json();
      const items = json?.data?.items || [];
      // Render only if changed (shallow compare by id+read_status count)
      const sig = items.map(n => `${n.id}:${n.read_status ? 1 : 0}`).join('|');
      if (sig !== lastRender.join('|')) {
        render(items);
        lastRender = sig.split('|');
      }
    } catch (e) {
      console.error('Notifications fetch failed', e);
    }
  }

  function startPolling() {
    if (pollingTimer) return;
    // First load ASAP when modal opens
    modalEl.addEventListener('show.bs.modal', fetchNotifications);
    // Regular polling in background (10 seconds)
    pollingTimer = window.setInterval(fetchNotifications, 10000);
    // Initial background fetch too
    fetchNotifications();
  }

  // Start when DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startPolling);
  } else {
    startPolling();
  }
})();
