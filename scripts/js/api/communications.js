(function(){
  'use strict';
  const root = (typeof window !== 'undefined') ? window : globalThis;
  const BASE = (root.API_BASE_URL || '/Capstone%20Project/php/api');

  function obj(o){ return (o && typeof o === 'object') ? o : {}; }

  const MESSAGES_URL = `${BASE}/communications/messages.php`;
  const NOTIFS_URL   = `${BASE}/communications/notifications.php`;
  const USERS_URL    = `${BASE}/users/index.php`;

  async function get(params){
    const url = MESSAGES_URL + '?' + new URLSearchParams(obj(params)).toString();
    return root.fetchJson(url, { method:'GET' });
  }
  async function post(action, body){
    const url = MESSAGES_URL + '?action=' + encodeURIComponent(action);
    return root.fetchJson(url, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body||{}) });
  }
  async function patch(action, params){
    const url = MESSAGES_URL + '?' + new URLSearchParams(Object.assign({ action }, obj(params))).toString();
    return root.fetchJson(url, { method:'PATCH' });
  }

  const CommunicationsAPI = {
    // Messages
    async listConversations(){
      const j = await get({ action:'list_conversations' });
      return Array.isArray(j?.data?.items) ? j.data.items : [];
    },
    async listMessages(conversation_id, after_id, limit){
      const j = await get({ action:'list_messages', conversation_id, after_id: after_id||'', limit: limit||100 });
      return Array.isArray(j?.data?.items) ? j.data.items : [];
    },
    async sendMessage(conversation_id, body){
      return post('send_message', { conversation_id, body });
    },
    async markRead(conversation_id){
      return patch('mark_read', { conversation_id });
    },
    async getOrCreateDirect(other_user_id){
      return post('get_or_create_direct', other_user_id ? { other_user_id } : {});
    },
    async unreadCount(){
      const items = await this.listConversations();
      return items.reduce((sum,c)=> sum + (Number(c.unread_count)||0), 0);
    },

    // Notifications
    async listNotifications(){
      const j = await root.fetchJson(`${NOTIFS_URL}`, { method:'GET' });
      return Array.isArray(j?.data?.items) ? j.data.items : [];
    },
    async markAllRead(){
      return root.fetchJson(`${NOTIFS_URL}?action=read_all`, { method:'PATCH' });
    },
    async markReadNotification(id){
      return root.fetchJson(`${NOTIFS_URL}?action=read&id=${encodeURIComponent(id)}`, { method:'PATCH' });
    },
    async createNotification(payload){
      return root.fetchJson(`${NOTIFS_URL}?action=create`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload||{}) });
    },

    // Users (admin search for messaging)
    async searchUsers(role, q){
      const j = await root.fetchJson(`${USERS_URL}?action=list&role=${encodeURIComponent(role)}&status=active&q=${encodeURIComponent(q||'')}`);
      return Array.isArray(j?.data?.items) ? j.data.items : [];
    }
  };

  root.CommunicationsAPI = CommunicationsAPI;
})();
