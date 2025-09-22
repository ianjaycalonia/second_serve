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

  // Attempt to read the current logged-in user from sessionStorage only
  function getStoredUser() {
    try {
      const s = sessionStorage.getItem('user');
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
    const iconHtml = (function(t){
      switch(t){
        case 'donation_created': return '📦';
        case 'status_updated': return '🚚';
        case 'donation_cancelled': return '🛑';
        case 'allocation_ready': return '📦';
        case 'allocation_acknowledged': return '✅';
        case 'allocation_cancelled': return '❌';
        default: return '🔔';
      }
    })((n.type || '').toLowerCase());
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
    }
    // Visually highlight the bell when there are unread notifications
    const unreadCount = items.filter(n => !n.read_status).length;
    if (bellIcon && bellAnchor) {
      if (unreadCount > 0) {
        bellIcon.classList.add('text-danger');
        bellAnchor.classList.add('text-danger');
        bellAnchor.setAttribute('aria-label', 'Open notifications (unread)');
        bellAnchor.setAttribute('title', 'You have unread notifications');
      } else {
        bellIcon.classList.remove('text-danger');
        bellAnchor.classList.remove('text-danger');
        bellAnchor.setAttribute('aria-label', 'Open notifications');
        bellAnchor.removeAttribute('title');
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
          const wasUnread = li.classList.contains('unread');
          // Optimistically update UI immediately
          li.classList.remove('unread');
          const badge = li.querySelector('.badge');
          if (badge) badge.remove();
          // Only call PATCH when it was unread; ignore any errors (it might have been read via markAllRead)
          if (wasUnread) {
            try {
              await fetch(`${API_BASE_URL}/notifications.php?action=read&id=${id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include'
              });
            } catch(_) { /* ignore */ }
          }
          // Determine destination
          const user = getStoredUser();
          const role = (user?.role || '').toLowerCase();
          let dest = null;
          // Admin: new donation => Donation.html
          if (nType === 'donation_created') {
            dest = 'Donation.html';
          } else if (nType === 'status_updated') {
            // Donors: go to their donations page; Admins: Donation.html
            if (role === 'donor') dest = 'MyDonations.html';
            else if (role === 'admin') dest = 'Donation.html';
          } else if (nType === 'donation_cancelled') {
            if (role === 'donor') dest = 'MyDonations.html';
            else if (role === 'admin') dest = 'Donation.html';
          } else if (nType === 'allocation_ready') {
            // Recipients: redirect to Received Items page to view allocations
            if (role === 'recipient') {
              dest = 'RecievedItems.html';
            }
          }
          // Fallbacks by reference_type if not set above
          if (!dest && refType === 'donation') dest = (role === 'admin') ? 'Donation.html' : (role === 'donor' ? 'MyDonations.html' : null);
          if (!dest && refType === 'batch') dest = (role === 'admin') ? 'Donation.html' : (role === 'donor' ? 'MyDonations.html' : null);

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
    // Let server default to current session user
    try {
      const res = await fetch(`${API_BASE_URL}/notifications.php`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include'
      });
      if (!res.ok) {
        const txt = await res.text().catch(()=>`HTTP ${res.status}`);
        // Show error in UI for visibility during testing
        if (listEl) {
          listEl.innerHTML = `<div class="text-center text-danger py-3">Notifications fetch failed (${res.status}). ${escapeHtml(txt)}</div>`;
        }
        if (bellIcon && bellAnchor) {
          bellIcon.classList.add('text-danger');
          bellAnchor.classList.add('text-danger');
          bellAnchor.setAttribute('title', `Notifications fetch failed (${res.status})`);
        }
        throw new Error(txt);
      }
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
      // If we reach here and UI not yet updated, provide a minimal hint
      try {
        if (listEl && !listEl.innerHTML) {
          listEl.innerHTML = '<div class="text-center text-muted py-3">Unable to load notifications.</div>';
        }
        if (bellIcon && bellAnchor) {
          bellIcon.classList.add('text-danger');
          bellAnchor.classList.add('text-danger');
        }
      } catch(_) {}
    }
  }

  function startPolling() {
    if (pollingTimer) return;
    // When modal opens, mark all as read then refresh list
    modalEl.addEventListener('show.bs.modal', async () => {
      try {
        await markAllRead();
      } catch (_) {}
      await fetchNotifications();
    });
    // Also wire the explicit "Mark all as read" button if present
    const markAllBtn = document.getElementById('markAllReadBtn');
    if (markAllBtn) {
      markAllBtn.addEventListener('click', async () => {
        try {
          await markAllRead();
        } catch (_) {}
        await fetchNotifications();
      });
    }
    // Regular polling in background (10 seconds, normal operation)
    pollingTimer = window.setInterval(fetchNotifications, 10000);
    // Initial background fetch too
    fetchNotifications();
  }

  async function markAllRead() {
    try {
      await fetch(`${API_BASE_URL}/notifications.php?action=read_all`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include'
      });
    } catch (e) {
      console.error('markAllRead failed', e);
    }
  }

  // Start when DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startPolling);
  } else {
    startPolling();
  }
})();
