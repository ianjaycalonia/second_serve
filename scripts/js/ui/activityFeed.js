(function(){
  'use strict';
  const API_BASE_URL = (typeof window.API_BASE_URL === 'string' && window.API_BASE_URL) ? window.API_BASE_URL : '/Capstone%20Project/php/api';

  function $(sel, root=document){ return root.querySelector(sel); }
  function esc(s){ return String(s||'').replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c])); }
  function fmtTime(iso){ try{ const d=new Date(iso); if(isNaN(d)) return ''; return d.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});}catch(_){ return ''; } }
  function getStoredUser(){ try{ const s=sessionStorage.getItem('user'); return s?JSON.parse(s):null; } catch(_){ return null; } }
  function userRole(){ return String(getStoredUser()?.role || '').toLowerCase(); }

  async function fetchNotifications(){
    const res = await fetch(`${API_BASE_URL}/communications/notifications.php`, { credentials: 'include' });
    const json = await res.json().catch(()=>({success:false,data:{items:[]}}));
    if (!res.ok || !json?.success) throw new Error(json?.error || `HTTP ${res.status}`);
    return Array.isArray(json?.data?.items) ? json.data.items : [];
  }

  function filterItemsByRole(items){
    const role = userRole();
    if (role === 'admin' || !role) return items;
    return items.filter(n => {
      const t = String(n.type || '').toLowerCase();
      const refType = String(n.reference_type || '').toLowerCase();
      if (role === 'donor') {
        // Show donation-related events
        return t.startsWith('donation_') || t === 'status_updated' || refType === 'donation' || refType === 'batch';
      }
      if (role === 'recipient') {
        // Show allocation/delivery related events
        return t.startsWith('allocation_') || refType === 'allocation' || /delivery|allocation/i.test(String(n.message || ''));
      }
      return true;
    });
  }

  function renderFeed(items, container){
    if (!container) return;
    container.innerHTML = '';
    if (!items.length){ container.innerHTML = '<div class="text-muted small">No recent activity</div>'; return; }
    const max = 6;
    items.slice(0, max).forEach(n => {
      const div = document.createElement('div');
      div.className = 'details mb-2';
      div.innerHTML = `<strong>${esc(fmtTime(n.created_at))}</strong><br/>${esc(n.message || '')}`;
      container.appendChild(div);
    });
  }

  async function loadOnce(){
    try{
      // Support multiple feeds on a page if present
      const feeds = document.querySelectorAll('.activity-feed');
      if (!feeds || feeds.length === 0) return;
      const items = await fetchNotifications();
      const filtered = filterItemsByRole(items);
      feeds.forEach(feed => renderFeed(filtered, feed));
    } catch(_) { /* ignore on dashboard */ }
  }

  function start(){
    loadOnce();
    // light refresh every 30s
    try { setInterval(loadOnce, 30000); } catch(_) {}
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
