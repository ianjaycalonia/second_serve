(function(){
  'use strict';
  const root = (typeof window !== 'undefined') ? window : globalThis;
  const BASE = (root.API_BASE_URL || '/php/api');
  const URL  = `${BASE}/recipients/index.php`;

  const RecipientsAPI = {
    async finalizeWeek(period_key, week_start){
      const url = `${URL}?action=finalize_week&period_key=${encodeURIComponent(period_key)}&week_start=${encodeURIComponent(week_start||'sunday')}`;
      return root.fetchJson(url, { method:'GET' });
    },
    async getPlan(month, week_start){
      const url = `${URL}?action=get_plan&month=${encodeURIComponent(month)}&week_start=${encodeURIComponent(week_start||'sunday')}`;
      return root.fetchJson(url, { method:'GET' });
    }
  };

  root.RecipientsAPI = RecipientsAPI;
})();
