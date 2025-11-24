/* Decoupled Messaging Module */
(function(){
  'use strict';

  const API = 'php/api/communications/messages.php';
  const qs = (s, r=document)=> r.querySelector(s);

  // Upgrade any messages triggers to avoid Bootstrap's data-api (which can conflict with dynamic injection)
  function upgradeTriggers(){
    document.querySelectorAll('[data-bs-target="#messagesModal"]').forEach(el=>{
      if (!el.getAttribute('data-messages-trigger')){
        el.setAttribute('data-messages-trigger','1');
        // Remove data-bs-toggle so Bootstrap's data-api won't run
        el.removeAttribute('data-bs-toggle');
      }
    });
  }
  upgradeTriggers();
  const mo = new MutationObserver(()=> upgradeTriggers());
  mo.observe(document.body, { childList:true, subtree:true });

  // Modal injector for any anchor with data-messages-trigger
  document.addEventListener('click', function(e){
    const trigger = e.target.closest('[data-messages-trigger], [data-bs-toggle="modal"][data-bs-target="#messagesModal"]');
    if (!trigger) return;
    // Prevent Bootstrap's data-api from running its own handler before we inject the modal
    e.preventDefault();
    if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
    e.stopPropagation();
    let modalEl = document.getElementById('messagesModal');
    if (!modalEl) {
      modalEl = document.createElement('div');
      modalEl.id = 'messagesModal';
      modalEl.className = 'modal fade';
      modalEl.tabIndex = -1;
      modalEl.setAttribute('aria-hidden', 'true');
      // Set explicit data attributes for broader Bootstrap compatibility
      modalEl.setAttribute('data-bs-backdrop', 'true');
      modalEl.setAttribute('data-bs-keyboard', 'true');
      modalEl.innerHTML = `
        <div class="modal-dialog modal-dialog-scrollable modal-lg">
          <div class="modal-content">
            <div class="modal-header">
              <h5 class="modal-title">Messages</h5>
              <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
            </div>
            <div class="modal-body"></div>
          </div>
        </div>`;
      document.body.appendChild(modalEl);
      try { window.__initMessagesModal && window.__initMessagesModal(modalEl); } catch(_){ }
    }
    // Some Bootstrap builds expect an options object; pass explicit defaults to avoid 'backdrop' undefined errors
    let modal = null;
    try {
      if (bootstrap && bootstrap.Modal) {
        // Prefer constructor to avoid edge-cases in getOrCreateInstance with data-api interactions
        modal = new bootstrap.Modal(modalEl, { backdrop: 'static', keyboard: false, focus: true });
      }
    } catch(_) { /* ignore */ }
    try { if (!modal && bootstrap && bootstrap.Modal) { modal = bootstrap.Modal.getOrCreateInstance(modalEl, { backdrop: true, keyboard: true, focus: true }); } } catch(_) { /* ignore */ }
    if (modal && typeof modal.show === 'function') { modal.show(); }
  }, true);

  // Badge polling for mail icon
  (function(){
    let badgeTimer = 0;
    // Poll every 5 seconds whether the page is visible or hidden
    const BADGE_MS_VISIBLE = 5000;
    const BADGE_MS_HIDDEN = 5000;
    function ensureBadges(){
      document.querySelectorAll('a[data-bs-target="#messagesModal"]').forEach(anchor => {
        if (anchor.querySelector('.messages-badge')) return;
        const span = document.createElement('span');
        span.className = 'messages-badge position-absolute translate-middle badge-message rounded-pill bg-danger';
        span.style.top = '6px';
        span.style.left = '37px';
        span.style.display = 'none';
        span.style.fontSize = '0.6rem';
        anchor.style.position = 'relative';
        anchor.appendChild(span);
      });
    }
    async function fetchUnreadTotal(){
      try {
        const res = await fetch(`${API}?action=list_conversations`, { credentials: 'include' });
        const json = await res.json();
        if (!json || !json.success) return 0;
        const items = (json.data && Array.isArray(json.data.items)) ? json.data.items : [];
        return items.reduce((sum,c)=> sum + (Number(c.unread_count)||0), 0);
      } catch(_) { return 0; }
    }
    async function refreshBadge(){
      ensureBadges();
      const modalOpen = !!window.__messagesModalOpen;
      const total = modalOpen ? 0 : await fetchUnreadTotal();
      document.querySelectorAll('.messages-badge').forEach(span => {
        if (total > 0) { span.textContent = total > 99 ? '99+' : String(total); span.style.display = ''; }
        else { span.style.display = 'none'; }
      });
      // Update letter animation based on unread messages
        if (window.LetterAnimation) {
          window.LetterAnimation.update(total);
        }

      // Turn mail icon red when there are unread messages
      document.querySelectorAll('a[data-bs-target="#messagesModal"]').forEach(anchor => {
        const icon = anchor.querySelector('i');
        if (!icon) return;
        if (total > 0) icon.classList.add('text-danger');
        else icon.classList.remove('text-danger');
      });
    }
    window.__refreshMessagesBadge = refreshBadge;
    ensureBadges(); refreshBadge();
    function startBadgeTimer(ms){ if (badgeTimer) clearInterval(badgeTimer); badgeTimer = setInterval(refreshBadge, ms); }
    startBadgeTimer(document.hidden ? BADGE_MS_HIDDEN : BADGE_MS_VISIBLE);
    document.addEventListener('visibilitychange', ()=>{
      if (document.hidden) startBadgeTimer(BADGE_MS_HIDDEN);
      else { refreshBadge(); startBadgeTimer(BADGE_MS_VISIBLE); }
    });
    const mo = new MutationObserver(()=> ensureBadges());
    mo.observe(document.body, { childList: true, subtree: true });
  })();

  // Messages Modal Controller (ported from auth.js)
  (function(){
    let __modalElRef = null;
    function initFor(modalEl){
      if (!modalEl || modalEl.__messagesBound) return;
      modalEl.__messagesBound = true;
      __modalElRef = modalEl;

      const apiBase = API;
      const MODAL_POLL_MS = 5000;
      const SINGLE_CHANNEL_MSG_MS = 2000;
      let convs = [], activeId = null, messages = [], lastId = null;
      let loadingMessages = false, messageIds = new Set();
      let pollTimer = 0, msgTimer = 0, isTickRunning = false, uiInitialized = false;
      const qsM = (sel)=> modalEl.querySelector(sel);

      async function apiGet(params){ const url = apiBase + '?' + new URLSearchParams(params).toString(); const res = await fetch(url, { credentials:'include' }); return res.json(); }
      async function apiPost(action, body){ const res = await fetch(apiBase + '?action=' + encodeURIComponent(action), { method:'POST', headers:{'Content-Type':'application/json'}, credentials:'include', body: JSON.stringify(body||{}) }); return res.json(); }
      async function apiPatch(action, params){ const url = apiBase + '?' + new URLSearchParams(Object.assign({ action }, params||{})).toString(); const res = await fetch(url, { method:'PATCH', credentials:'include' }); return res.json(); }

      function ensureTheme(){
  if (document.getElementById('messages-theme-override')) return;
  const style = document.createElement('style');
  style.id = 'messages-theme-override';
  style.textContent = `
    /* Active conversation */
    #messagesModal .list-group-item.active {
      background-color: #35b4c1;
      border-color: #35b4c1;
      color: #fff;
    }

    /* Primary button base */
    #messagesModal .btn-primary {
      background-color: #35b4c1;
      border-color: #35b4c1;
      transition: background-color 0.25s ease, transform 0.2s ease;
    }

    /* 🔹 Hover zoom-in effect */
    #messagesModal .btn-primary:hover {
      background-color: #2ea2ad;
      border-color: #2ea2ad;
      transform: scale(1.08);
    }

    /* Optional: smooth icon color on hover */
    #messagesModal .btn-primary:hover i {
      color: #fff;
      transition: color 0.2s ease;
    }
  `;
  document.head.appendChild(style);
}

      function buildUI(){
        const body = qsM('.modal-body'); if (!body) return; ensureTheme();
        const role = (window.CURRENT_USER_ROLE||'').toLowerCase();
        const leftPanel = (role && role !== 'admin')
          ? `
              <div class="mb-2 fw-semibold">Conversations</div>
              <div id="mm-conversations" class="list-group small"></div>
            `
          : `
              <div class="mb-2">
                <input id="mm-search" class="form-control form-control-sm" placeholder="Search donors or recipients..."/>
              </div>
              <div id="mm-search-results" class="list-group small mb-2"></div>
              <div class="fw-semibold small mb-1">Recent conversations</div>
              <div id="mm-recent" class="list-group small" style="max-height: 320px; overflow:auto;"></div>
            `;

        body.innerHTML = `
          <div class="d-flex" style="min-height:320px; max-height:60vh;">
            <div class="border-end pe-3 me-3" style="width: 260px; overflow:auto;">${leftPanel}</div>
            <div class="flex-grow-1 d-flex flex-column">
              <div id="mm-messages" class="flex-grow-1 overflow-auto mb-2"></div>
              <div class="input-group"><input id="mm-input" type="text" class="form-control" placeholder="Type a message..."/><button id="mm-send" class="btn btn-primary" type="button"><i class="bi bi-send"></i></button></div>
            </div>
          </div>`;
        bindUI();
      }

      function renderConversations(){
        // Choose target container: admin -> #mm-recent; others -> #mm-conversations
        const role=(window.CURRENT_USER_ROLE||'').toLowerCase();
        const wrap = (role==='admin') ? (qsM('#mm-recent') || qsM('#mm-conversations')) : qsM('#mm-conversations');
        if (!wrap) return;
        if (window.__limitToSingleChannel){ wrap.innerHTML=''; return; }
        wrap.innerHTML='';
        // For admin, show recent first. If there is a preselected conversation without messages yet,
        // include it so the empty-state text is replaced immediately upon selection.
        let list = Array.isArray(convs) ? convs.slice(0, 15) : [];
        try {
          const tmp = window.__messagesTempRecent; // {id,title,other_role}
          if (role==='admin' && tmp && tmp.id) {
            const exists = list.some(c => String(c.id)===String(tmp.id));
            if (!exists) {
              list = [{ id: tmp.id, display_title: tmp.title || ('Conversation #'+tmp.id), other_role: tmp.other_role||'', unread_count: 0, last_message: null }, ...list];
            }
          }
        } catch(_){ /* ignore */ }
        if (!list.length){
          try { wrap.innerHTML = '<div class="text-muted small px-2 py-1">No recent conversations yet. Use the search above to start one.</div>'; } catch(_){ }
          return;
        }
        list.forEach(c=>{
          const last = c.last_message ? JSON.parse(c.last_message) : null;
          const a=document.createElement('a'); a.href='#'; a.className='list-group-item list-group-item-action'+(activeId===c.id?' active':'');
          const title = c.display_title || c.title || ('Conversation #'+c.id);
          const role = (c.other_role||'').toLowerCase();
          const roleBadge = role==='donor' ? '<span class="badge text-bg-warning ms-2">Donor</span>' : (role==='recipient' ? '<span class="badge text-bg-info ms-2">Recipient</span>' : '');
          a.innerHTML = `<div class=\"d-flex justify-content-between align-items-center\"><div class=\"fw-semibold\">${title}${roleBadge}</div>${Number(c.unread_count)>0?`<span class=\"badge rounded-pill bg-primary\">${c.unread_count}</span>`:''}</div><div class=\"text-muted small\">${last?(last.body||'[attachment]'):'No messages yet'}</div>`;
          a.addEventListener('click',(e)=>{ e.preventDefault(); selectConversation(c.id); });
          wrap.appendChild(a);
        });
      }

        function renderMessages() {
        const wrap = qsM('#mm-messages');
        if (!wrap) return;

        // Detect if user is near bottom before re-render
        const wasNearBottom = wrap.scrollHeight - wrap.scrollTop - wrap.clientHeight < 50;

        wrap.innerHTML = '';
        let lastDate = '';

        messages.forEach(m => {
          const isMine = (window.CURRENT_USER_ID && Number(m.sender_id) === Number(window.CURRENT_USER_ID));
          const outer = document.createElement('div');
          outer.className = 'mb-2 d-flex flex-column ' + (isMine ? 'align-items-end' : 'align-items-start');

          const bubbleWrap = document.createElement('div');
          bubbleWrap.className = 'd-flex ' + (isMine ? 'justify-content-end' : '');

          const style = isMine
            ? 'background: var(--primary-color); border:1px solid var(--primary-color); color: var(--primary-background);'
            : 'background: var(--header-text-color); border:1px solid #717171ff; color: var(--primary-background);';

          // Parse and format date/time
          const msgDate = new Date(m.created_at);
          const now = new Date();
          const isSameDay =
            msgDate.getFullYear() === now.getFullYear() &&
            msgDate.getMonth() === now.getMonth() &&
            msgDate.getDate() === now.getDate();

          const timeStr = msgDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          const dateStr = msgDate.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });

          // Date separator for messages from a new day
          const msgDateKey = msgDate.toDateString();
          if (msgDateKey !== lastDate) {
            const sep = document.createElement('div');
            sep.className = 'text-center text-muted small my-2';
            sep.textContent = isSameDay ? 'Today' : dateStr;
            wrap.appendChild(sep);
            lastDate = msgDateKey;
          }

          // Sanitize message
          const safeBody = (m.body || '').replace(/[&<>"']/g, c => ({
            "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"
          }[c]));

          // Message bubble
          const bubble = document.createElement('div');
          bubble.className = 'p-2 rounded';
          bubble.style.cssText = `max-width:100%; white-space:pre-wrap; ${style}`;
          bubble.innerHTML = safeBody;

          // Time below bubble (outside border)
          const timeDiv = document.createElement('div');
          timeDiv.className = 'text-muted small mt-1';
          timeDiv.style.fontSize = '0.7rem';
          timeDiv.textContent = isSameDay ? timeStr : `${timeStr}`;

          bubbleWrap.appendChild(bubble);
          outer.appendChild(bubbleWrap);
          outer.appendChild(timeDiv);
          wrap.appendChild(outer);
        });

        // Only scroll to bottom if user was near bottom before
        if (wasNearBottom) {
          wrap.scrollTop = wrap.scrollHeight;
        }
      }
      
      async function loadConversations(){ const res = await apiGet({ action:'list_conversations' }); if (res.success){ convs = res.data.items||[]; renderConversations(); } if (window.__refreshMessagesBadge) try{ window.__refreshMessagesBadge(); }catch(_){ } }
      async function selectConversation(id){ activeId=id; messages=[]; messageIds=new Set(); lastId=null; await markRead(); await loadMessages(true); renderConversations(); setComposerEnabled(true); focusSingleChannel(); }
      async function loadMessages(reset){ if (!activeId || loadingMessages) return; loadingMessages=true; try{ const doReset = (typeof reset==='boolean') ? reset : (messages.length===0); const res = await apiGet({ action:'list_messages', conversation_id: activeId, limit: 100, after_id: doReset? '' : (lastId||'') }); if (!res.success) return; const items = Array.isArray(res.data?.items) ? res.data.items : []; if (doReset){ messages=[]; messageIds=new Set(); lastId=null; } for (const m of items){ const mid=Number(m.id); if (!messageIds.has(mid)){ messageIds.add(mid); messages.push(m); if (!lastId || mid>Number(lastId)) lastId=mid; } } messages.sort((a,b)=> Number(a.id)-Number(b.id)); renderMessages(); } finally { loadingMessages=false; } }
      async function markRead(){ if (!activeId) return; await apiPatch('mark_read', { conversation_id: activeId }); await loadConversations(); }
      async function send(){ if (!activeId) return; const input=qsM('#mm-input'); const text=(input.value||'').trim(); if (!text) return; const res = await apiPost('send_message', { conversation_id: activeId, body: text }); if (res.success){ input.value=''; await loadMessages(); await loadConversations(); } }

      function bindUI(){
        const sendBtn=qsM('#mm-send'); const input=qsM('#mm-input');
        if (sendBtn) sendBtn.addEventListener('click', send);
        if (input) input.addEventListener('keydown',(e)=>{ if (e.key==='Enter' && !e.shiftKey){ e.preventDefault(); send(); } });
        // Admin search across donors and recipients
        const searchInput = qsM('#mm-search'); const resultsBox = qsM('#mm-search-results'); let searchTimer=0;
        async function queryUsers(role, q){
          const url = 'php/api/users/index\.php?action=list&role=' + encodeURIComponent(role) + '&status=active&q=' + encodeURIComponent(q.trim());
          const res = await fetch(url,{ credentials:'include' });
          const json = await res.json();
          const arr = (json && json.success && json.data && Array.isArray(json.data.items)) ? json.data.items : [];
          return arr.map(u => ({...u, __role: role}));
        }
        async function runSearch(q){
          if (!resultsBox) return;
          const s = (q||'').trim();
          if (!s || s.length < 2){ resultsBox.innerHTML=''; return; }
          try{
            const [donors, recipients] = await Promise.all([ queryUsers('donor', s), queryUsers('recipient', s) ]);
            const items = [...donors, ...recipients];
            resultsBox.innerHTML = '';
            if (!items.length){ resultsBox.innerHTML = '<div class="text-muted small px-2 py-1">No users found</div>'; return; }
            items.slice(0, 15).forEach(u => {
              const a=document.createElement('a'); a.href='#'; a.className='list-group-item list-group-item-action d-flex justify-content-between align-items-center';
              const label=(u.organization_name&&u.organization_name.trim())? u.organization_name : (u.name || ('User #'+u.user_id));
              const badge = u.__role==='donor' ? '<span class="badge text-bg-warning">Donor</span>' : '<span class="badge text-bg-info">Recipient</span>';
              a.innerHTML = `<span>${label}</span>${badge}`;
              a.addEventListener('click', async (e)=>{
                e.preventDefault();
                const r=await apiPost('get_or_create_direct',{ other_user_id:Number(u.user_id)});
                if (r&&r.success){
                  // Pre-insert temp recent so empty-state is replaced immediately
                  try { window.__messagesTempRecent = { id: r.data.conversation.id, title: label, other_role: u.__role||'' }; } catch(_) {}
                  if (searchInput) searchInput.value='';
                  resultsBox.innerHTML='';
                  await loadConversations();
                  await selectConversation(r.data.conversation.id);
                  renderConversations();
                }
              });
              resultsBox.appendChild(a);
            });
          } catch(_){ resultsBox.innerHTML = '<div class="text-muted small px-2 py-1">Search failed</div>'; }
        }
        if (searchInput){ searchInput.addEventListener('input', ()=>{ if (searchTimer) clearTimeout(searchTimer); searchTimer = setTimeout(()=> runSearch(searchInput.value), 300); }); }
        setComposerEnabled(!!activeId);
      }

      function setComposerEnabled(enabled){ const input=qsM('#mm-input'), sendBtn=qsM('#mm-send'); if (input) { input.disabled = !enabled; input.placeholder = enabled ? 'Type a message...' : 'Select a conversation to start chatting'; } if (sendBtn) sendBtn.disabled = !enabled; }
      function focusSingleChannel(){ if (!window.__limitToSingleChannel) return; ['#mm-search','#mm-new','#mm-search-results','#mm-conversations'].forEach(sel=>{ const el=qsM(sel); if (el) el.style.display='none'; }); const donorsWrap=qsM('#mm-donors'); if (!donorsWrap) return; const conv=(convs||[]).find(c=> Number(c.id)===Number(activeId)); const otherId = conv && conv.other_user_id ? Number(conv.other_user_id) : null; donorsWrap.querySelectorAll('a.list-group-item').forEach(a=>{ const uid = Number(a.getAttribute('data-user-id')||'0'); if (otherId && uid!==otherId){ a.style.display='none'; } else { a.style.display=''; a.classList.add('active'); } }); }

      async function initOnceUI(){ if (uiInitialized) return; uiInitialized=true; buildUI(); await loadConversations(); const role=(window.CURRENT_USER_ROLE||'').toLowerCase(); if (role && role!=='admin'){ try{ const res=await apiPost('get_or_create_direct', {}); if (res.success) await selectConversation(res.data.conversation.id); } catch(_){ } } else { try { if (!activeId && Array.isArray(convs) && convs.length){ await selectConversation(convs[0].id); } } catch(_){ } } setComposerEnabled(!!activeId); }
      function startPolling(){ stopPolling(); pollTimer=window.setInterval(async ()=>{ if (isTickRunning) return; isTickRunning=true; try { await Promise.all([loadConversations(), loadMessages()]); if (activeId && window.__messagesModalOpen){ try{ await markRead(); }catch(_){ } } } catch(_){ } finally { isTickRunning=false; } }, MODAL_POLL_MS); msgTimer=window.setInterval(async ()=>{ if (!activeId || !window.__messagesModalOpen) return; try { await loadMessages(); } catch(_){ } }, SINGLE_CHANNEL_MSG_MS); }
      function stopPolling(){ if (pollTimer){ clearInterval(pollTimer); pollTimer=0; } if (msgTimer){ clearInterval(msgTimer); msgTimer=0; } }

      modalEl.addEventListener('shown.bs.modal', async ()=>{
        window.__messagesModalOpen=true;
        await initOnceUI();
        try {
          await Promise.all([
            loadConversations(),
            (async()=>{ await loadMessages(true); })(),
          ]);
          // If a preselect conversation id was set globally, select it now
          try {
            const pre = (typeof window.__messagesPreselectConvId !== 'undefined') ? window.__messagesPreselectConvId : null;
            if (pre) {
              window.__messagesPreselectConvId = null;
              await selectConversation(pre);
            }
          } catch(_) { /* ignore */ }
        } catch(_){ }
        startPolling();
        if (window.__refreshMessagesBadge) window.__refreshMessagesBadge();
      });
      modalEl.addEventListener('hidden.bs.modal', ()=>{ window.__messagesModalOpen=false; stopPolling(); if (window.__refreshMessagesBadge) window.__refreshMessagesBadge(); });
    }

    // Expose initializer
    window.__initMessagesModal = initFor;
    // Programmatic open helper
    window.__openConversation = async function(convId){ try { const m = __modalElRef || document.getElementById('messagesModal'); if (!m) return; await initFor(m); await m.dispatchEvent(new Event('shown.bs.modal')); } catch(_){ } };
    // Auto-init if modal exists
    const existing = document.getElementById('messagesModal'); if (existing) initFor(existing);
  })();

})();

