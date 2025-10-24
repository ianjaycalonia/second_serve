(function(){
  'use strict';
  const API_BASE_URL = typeof window.API_BASE_URL === 'string' && window.API_BASE_URL ? window.API_BASE_URL : '/Capstone%20Project/php/api';

  function getMonthRange() {
    const m = document.getElementById('reportMonth')?.value || '';
    let year, month;
    if (m && /^\d{4}-\d{2}$/.test(m)) {
      [year, month] = m.split('-').map(n => parseInt(n, 10));
    } else {
      const now = new Date();
      year = now.getFullYear();
      month = now.getMonth() + 1;
    }
    const start = `${year}-${String(month).padStart(2,'0')}-01`;
    const endDate = new Date(year, month, 0).getDate();
    const end = `${year}-${String(month).padStart(2,'0')}-${String(endDate).padStart(2,'0')}`;
    return { start, end };
  }

  async function loadTotalWeight() {
    try {
      const url = new URL(`${API_BASE_URL}/inventory/index.php/report-in`, window.location.origin);
      const { start, end } = getMonthRange();
      url.searchParams.set('start', start);
      url.searchParams.set('end', end);
      url.searchParams.set('t', String(Date.now()));
      const res = await fetch(url.toString(), { credentials: 'include', headers: { Accept: 'application/json' } });
      const j = await res.json().catch(() => null);
      if (!res.ok || !j?.success) throw new Error(j?.error || `HTTP ${res.status}`);
      const rows = Array.isArray(j?.data?.rows) ? j.data.rows : [];
      const total = rows.reduce((sum, r) => {
        const w = r['TOTAL WEIGHT(KG)'];
        const num = typeof w === 'number' ? w : (w ? parseFloat(w) : 0);
        return sum + (isFinite(num) ? num : 0);
      }, 0);
      const el = document.getElementById('totalWeightKg');
      if (el) el.textContent = (Math.round(total * 100) / 100).toLocaleString(undefined, { maximumFractionDigits: 2 });
    } catch (err) {
      // Silent fail for the stat to avoid blocking rest of page
    }
  }

  async function exportIn() {
    try {
      const url = new URL(`${API_BASE_URL}/inventory/index.php/report-in`, window.location.origin);
      const { start, end } = getMonthRange();
      url.searchParams.set('start', start);
      url.searchParams.set('end', end);
      url.searchParams.set('t', String(Date.now()));
      const res = await fetch(url.toString(), { credentials: 'include', headers: { Accept: 'application/json' } });
      const j = await res.json().catch(() => null);
      if (!res.ok || !j?.success) throw new Error(j?.error || `HTTP ${res.status}`);
      const rows = Array.isArray(j?.data?.rows) ? j.data.rows : [];
      const headers = ['ENTRY DATE','DONATED/PURCHASED','DONOR NAME','DONOR CATEGORY','PRODUCT NAME','PRODUCT CATEGORY','QUANTITY','PACKED BY','TOTAL WEIGHT(KG)','TOTAL COST(P)','EXPIRY DATE','ENTRY BY'];
      const aoa = [headers, ...rows.map(r => headers.map(h => r[h] ?? ''))];
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Product In');
      const fname = `product_in_${(j?.data?.start||'')}_${(j?.data?.end||'')}.xlsx`.replace(/[^a-zA-Z0-9_.-]/g,'_');
      XLSX.writeFile(wb, fname);
    } catch (err) {
      alert('Export In failed: ' + (err?.message || 'Unknown error'));
    }
  }

  async function exportOut() {
    try {
      const url = new URL(`${API_BASE_URL}/inventory/index.php/report-out`, window.location.origin);
      const { start, end } = getMonthRange();
      url.searchParams.set('start', start);
      url.searchParams.set('end', end);
      url.searchParams.set('t', String(Date.now()));
      const res = await fetch(url.toString(), { credentials: 'include', headers: { Accept: 'application/json' } });
      const j = await res.json().catch(() => null);
      if (!res.ok || !j?.success) throw new Error(j?.error || `HTTP ${res.status}`);
      const rows = Array.isArray(j?.data?.rows) ? j.data.rows : [];
      const headers = ['DATE OUT','ITEM','CATEGORY','QUANTITY','MODE','NOTE','PERFORMED BY'];
      const aoa = [headers, ...rows.map(r => headers.map(h => r[h] ?? ''))];
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Product Out');
      const fname = `product_out_${(j?.data?.start||'')}_${(j?.data?.end||'')}.xlsx`.replace(/[^a-zA-Z0-9_.-]/g,'_');
      XLSX.writeFile(wb, fname);
    } catch (err) {
      alert('Export Out failed: ' + (err?.message || 'Unknown error'));
    }
  }

  function init(){
    document.getElementById('exportInBtn')?.addEventListener('click', exportIn);
    document.getElementById('exportOutBtn')?.addEventListener('click', exportOut);
    loadTotalWeight();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
