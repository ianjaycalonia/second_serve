(function(){
  const apiBase = 'php/api/messages.php';

  const state = {
    conversations: [],
    activeConversationId: null,
    messages: [],
    lastMessageId: null,
    pollTimer: null,
  };

  function $(sel, root=document){ return root.querySelector(sel); }
  function $all(sel, root=document){ return Array.from(root.querySelectorAll(sel)); }

  function fmtTime(ts){
    try { return new Date(ts.replace(' ', 'T')).toLocaleString(); } catch(e){ return ts; }
  }

  async function apiGet(params){
    const url = apiBase + '?' + new URLSearchParams(params).toString();
    const res = await fetch(url, { method: 'GET', credentials: 'include' });
    return res.json();
  }
  async function apiPost(action, body){
    const res = await fetch(apiBase + '?action=' + encodeURIComponent(action), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(body || {})
    });
    return res.json();
  }
  async function apiPatch(action, params){
    const url = apiBase + '?' + new URLSearchParams(Object.assign({ action }, params || {})).toString();
    const res = await fetch(url, { method: 'PATCH', credentials: 'include' });
    return res.json();
  }

  function renderConversations(){
    const wrap = $('#conversations');
    wrap.innerHTML = '';
    state.conversations.forEach(c => {
      const li = document.createElement('div');
      li.className = 'conversation-item' + (state.activeConversationId === c.id ? ' active' : '');
      const last = c.last_message ? JSON.parse(c.last_message) : null;
      const title = c.display_title || c.title || (c.type === 'direct' ? 'Direct conversation #' + c.id : 'Group #' + c.id);
      li.innerHTML = `
        <div class="conv-title">${title}</div>
        <div class="conv-last">${last ? (last.body || '[attachment]') : 'No messages yet'}</div>
        <div class="conv-meta">
          <span>${last ? fmtTime(last.created_at) : fmtTime(c.created_at)}</span>
          ${Number(c.unread_count) > 0 ? `<span class="badge">${c.unread_count}</span>` : ''}
        </div>
      `;
      li.addEventListener('click', () => selectConversation(c.id));
      wrap.appendChild(li);
    });
  }

  function renderMessages(){
    const wrap = $('#messages');
    wrap.innerHTML = '';
    state.messages.forEach(m => {
      const div = document.createElement('div');
      div.className = 'msg-item' + (window.CURRENT_USER_ID && Number(m.sender_id) === Number(window.CURRENT_USER_ID) ? ' mine' : '');
      div.innerHTML = `
        <div class="msg-text">${escapeHtml(m.body || '')}</div>
        ${m.attachment_url ? `<div class="msg-attachment"><a href="${m.attachment_url}" target="_blank">Attachment</a></div>` : ''}
        <div class="msg-meta">by ${m.sender_name} • ${fmtTime(m.created_at)}</div>
      `;
      wrap.appendChild(div);
    });
    wrap.scrollTop = wrap.scrollHeight;
  }

  function escapeHtml(s){
    return (s || '').replace(/[&<>\"']/g, function(c){
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c];
    });
  }

  async function loadConversations(){
    const res = await apiGet({ action: 'list_conversations' });
    if (!res.success) throw new Error(res.error || 'Failed to load conversations');
    state.conversations = (res.data && res.data.items) || [];
    renderConversations();
  }

  async function selectConversation(id){
    state.activeConversationId = id;
    renderConversations();
    await markRead();
    await loadMessages(true);
  }

  async function loadMessages(reset=false){
    if (!state.activeConversationId) return;
    const res = await apiGet({ action: 'list_messages', conversation_id: state.activeConversationId, limit: 100, after_id: reset? '' : (state.lastMessageId || '') });
    if (!res.success) throw new Error(res.error || 'Failed to load messages');
    const items = (res.data && res.data.items) || [];
    if (reset) {
      state.messages = items;
    } else if (items.length) {
      state.messages = state.messages.concat(items);
    }
    if (state.messages.length) state.lastMessageId = state.messages[state.messages.length - 1].id;
    renderMessages();
  }

  async function sendMessage(){
    const input = $('#message-input');
    const text = input.value.trim();
    if (!state.activeConversationId || text === '') return;
    const res = await apiPost('send_message', { conversation_id: state.activeConversationId, body: text });
    if (res.success) {
      input.value = '';
      await loadMessages();
      await loadConversations();
    } else {
      alert(res.error || 'Failed to send message');
    }
  }

  async function markRead(){
    if (!state.activeConversationId) return;
    await apiPatch('mark_read', { conversation_id: state.activeConversationId });
    await loadConversations();
  }

  async function createDirectConversation(){
    // If current user is non-admin, auto-connect to admin (backend defaults to admin when other_user_id omitted)
    const role = (window.CURRENT_USER_ROLE || '').toLowerCase();
    let payload = {};
    if (role === 'admin') {
      const otherId = Number(prompt('Enter user ID to chat with:'));
      if (!otherId) return;
      payload.other_user_id = otherId;
    }
    const res = await apiPost('get_or_create_direct', payload);
    if (res.success) {
      await loadConversations();
      await selectConversation(res.data.conversation.id);
    } else {
      alert(res.error || 'Failed to create conversation');
    }
  }

  function schedulePolling(){
    if (state.pollTimer) clearInterval(state.pollTimer);
    // Align with notifications polling (10s)
    state.pollTimer = setInterval(async () => {
      try {
        await loadConversations();
        await loadMessages();
      } catch(e) { /* ignore transient errors */ }
    }, 10000);
  }

  function bindUI(){
    $('#send-btn').addEventListener('click', sendMessage);
    $('#message-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    });
    const newBtn = $('#new-direct-btn');
    if (newBtn) {
      // Hide the new button for non-admin users since they only chat with the food bank
      const role = (window.CURRENT_USER_ROLE || '').toLowerCase();
      if (role && role !== 'admin') newBtn.style.display = 'none';
      newBtn.addEventListener('click', createDirectConversation);
    }
  }

  async function init(){
    bindUI();
    await loadConversations();
    // For non-admin users, ensure an admin chat exists and open it automatically
    const role = (window.CURRENT_USER_ROLE || '').toLowerCase();
    if (role && role !== 'admin') {
      try {
        const res = await apiPost('get_or_create_direct', {});
        if (res.success) {
          await selectConversation(res.data.conversation.id);
        }
      } catch(_) { /* ignore */ }
    }
    schedulePolling();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
