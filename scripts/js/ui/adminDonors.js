document.addEventListener("DOMContentLoaded", () => {
  // Base API URL (same as other admin pages)
  const API_BASE_URL =
    typeof window.API_BASE_URL === "string" && window.API_BASE_URL
      ? window.API_BASE_URL
      : "/Capstone%20Project/php/api";

  // In-memory datasets and derived index
  let donorsData = [];
  let donationsData = [];

  // Fetch donors (approved) and donations list, then render donors table
  init();

  async function fetchDonors() {
    const res = await fetch(
      `${API_BASE_URL}/users/index.php?action=list&role=donor&status=active&t=${Date.now()}`,
      {
        method: "GET",
        credentials: "include",
        headers: { Accept: "application/json" },
        cache: "no-store",
      }
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const j = await res.json();
    return Array.isArray(j?.data?.items) ? j.data.items : [];
  }

  async function fetchDonations() {
    const res = await fetch(
      `${API_BASE_URL}/donations/index.php/list?t=${Date.now()}`,
      {
        method: "GET",
        credentials: "include",
        headers: { Accept: "application/json" },
        cache: "no-store",
      }
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const j = await res.json();
    return Array.isArray(j?.data?.items) ? j.data.items : [];
  }

  function badge(text, type = "light") {
    return `<span class="badge bg-${type} ${
      type === "light" ? "text-dark" : ""
    }">${text}</span>`;
  }

  function renderDonors(donors, donations) {
    const tbody = document.querySelector("main .table tbody");
    if (!tbody) return;
    // Aggregate donations per donor_id for metrics and last activity/status
    const byDonor = new Map();
    donations.forEach((d) => {
      const id = d.donor_id;
      if (!id) return;
      const cur = byDonor.get(id) || { batches: new Set(), last: null, lastStatus: null };
      const ts = d.created_at ? new Date(d.created_at) : null;
      if (d.batch_id && (d.status || "") === "Completed") {
        cur.batches.add(String(d.batch_id));
      }
      if (ts && (!cur.last || ts > cur.last)) {
        cur.last = ts;
        cur.lastStatus = d.status || null;
      }
      byDonor.set(id, cur);
    });

    const rows = donors.map((u) => {
      const name =
        u.organization_name && u.organization_name.trim()
          ? u.organization_name.trim()
          : (u.name || "").trim();
      const contact = (u.name || "").trim() || "—";
      const location = (u.address || "").trim() || "—";
      const agg = byDonor.get(u.user_id) || { batches: new Set(), last: null, lastStatus: null };
      const total = agg.batches.size; // total completed batches
      const last = agg.last ? agg.last.toLocaleDateString() : "—";
      const status =
        u.status === "approved"
          ? badge("Active", "success")
          : u.status === "pending"
          ? badge("Pending", "warning")
          : badge("Inactive", "secondary");
      return `
        <tr>
          <td>${escapeHtml(name)}</td>
          <td>${escapeHtml(contact)}</td>
          <td>${escapeHtml(location)}</td>
          <td>${total}</td>
          <td>${last}</td>
          <td>${status}</td>
          <td><a href="#" data-user-id="${u.user_id}">View / Edit</a></td>
        </tr>
      `;
    });
    tbody.innerHTML = rows.join("");
    // Donor names are plain text now. Removed chat-open click handler on donor name.
  }

  function escapeHtml(str) {
    return String(str || "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        }[c])
    );
  }

  function uniqueSorted(vals){
    return Array.from(new Set(vals.filter(v => v && String(v).trim()))).sort((a,b)=>String(a).localeCompare(String(b)));
  }

  function applyFiltersAndSort(){
    const q = (document.getElementById('donationSearch')?.value || '').trim().toLowerCase();
    const fromStr = document.getElementById('fromDate')?.value || '';
    const toStr = document.getElementById('toDate')?.value || '';
    const statusSel = document.getElementById('donorsStatusSelectMobile');
    const statusFilter = (statusSel && statusSel.value) ? statusSel.value : 'All';
    const actSel = document.getElementById('donorsDonationActivitySelectMobile');
    const activity = (actSel && actSel.value) ? actSel.value : 'All';
    const locSel = document.getElementById('donorsCategorySelectMobile');
    const location = (locSel && locSel.value) ? locSel.value : '';

    // Sort controls (accept both donor and recipient IDs for robustness)
    const qtySel = document.getElementById('recipientQuantityOrderSelectMobile') || document.getElementById('donorsQuantityOrderSelectMobile');
    const qtyOrder = qtySel ? qtySel.value : 'None';
    const dateSel = document.getElementById('recipientSubmissionDateSelectMobile') || document.getElementById('donorsSubmissionDateSelectMobile');
    const dateOrder = dateSel ? dateSel.value : 'None';
    const nameSel = document.getElementById('recipientDonorOrderSelectMobile') || document.getElementById('donorsDonorOrderSelectMobile');
    const nameOrder = nameSel ? nameSel.value : 'None';

    // Build aggregates map once
    const byDonor = new Map();
    donationsData.forEach((d) => {
      const id = d.donor_id;
      if (!id) return;
      const cur = byDonor.get(id) || { batches: new Set(), last: null, lastStatus: null };
      const ts = d.created_at ? new Date(d.created_at) : null;
      if (d.batch_id && (d.status || '') === 'Completed') cur.batches.add(String(d.batch_id));
      if (ts && (!cur.last || ts > cur.last)) { cur.last = ts; cur.lastStatus = d.status || null; }
      byDonor.set(id, cur);
    });

    // Filter donors
    let list = donorsData.filter((u) => {
      const name = (u.organization_name || u.name || '').toLowerCase();
      if (q && !name.includes(q)) return false;
      const agg = byDonor.get(u.user_id) || { batches: new Set(), last: null, lastStatus: null };
      // Date range on last donation date
      if (fromStr) {
        const from = new Date(fromStr + 'T00:00:00');
        if (!agg.last || agg.last < from) return false;
      }
      if (toStr) {
        const to = new Date(toStr + 'T23:59:59');
        if (!agg.last || agg.last > to) return false;
      }
      // Location filter
      if (location && location !== 'All') {
        if (String(u.address || '').trim() !== location) return false;
      }
      // Donation activity by total completed batches
      const total = agg.batches.size;
      if (activity === 'Low' && !(total >= 1 && total < 3)) return false;
      if (activity === 'Medium' && !(total >= 3 && total < 10)) return false;
      if (activity === 'High' && !(total >= 10)) return false;
      // Status filter (based on last donation status when available)
      if (statusFilter && statusFilter !== 'All') {
        const lastStatus = agg.lastStatus || '';
        if (lastStatus !== statusFilter) return false;
      }
      return true;
    });

    // Sort: apply in priority order (quantity, date, donor name) if set
    list = list.slice();
    if (nameOrder && nameOrder !== 'None') {
      list.sort((a,b)=>{
        const an = (a.organization_name || a.name || '').toLowerCase();
        const bn = (b.organization_name || b.name || '').toLowerCase();
        const cmp = an.localeCompare(bn);
        return nameOrder === 'Ascending' ? cmp : -cmp;
      });
    }
    if (dateOrder && dateOrder !== 'None') {
      list.sort((a,b)=>{
        const aa = donationsData.filter(d=>d.donor_id===a.user_id).reduce((m,d)=>{const t=d.created_at?new Date(d.created_at):null;return t && (!m||t>m)?t:m;}, null);
        const bb = donationsData.filter(d=>d.donor_id===b.user_id).reduce((m,d)=>{const t=d.created_at?new Date(d.created_at):null;return t && (!m||t>m)?t:m;}, null);
        const av = aa ? aa.getTime() : 0;
        const bv = bb ? bb.getTime() : 0;
        return (dateOrder === 'Newest First') ? (bv - av) : (av - bv);
      });
    }
    if (qtyOrder && qtyOrder !== 'None') {
      list.sort((a,b)=>{
        const ac = (donationsData.filter(d=>d.donor_id===a.user_id && d.batch_id && (d.status||'')==='Completed').reduce((set,d)=>set.add(String(d.batch_id)), new Set()).size);
        const bc = (donationsData.filter(d=>d.donor_id===b.user_id && d.batch_id && (d.status||'')==='Completed').reduce((set,d)=>set.add(String(d.batch_id)), new Set()).size);
        return (qtyOrder === 'High to Low') ? (bc - ac) : (ac - bc);
      });
    }

    renderDonors(list, donationsData);
  }

  function populateFilters(){
    // Populate location options
    const sel = document.getElementById('donorsCategorySelectMobile');
    if (sel){
      const locs = uniqueSorted(donorsData.map(u=>String(u.address||'').trim()).filter(Boolean));
      const cur = sel.value;
      sel.innerHTML = '<option>All</option>' + locs.map(l=>`<option${l===cur?' selected':''}>${l.replace(/&/g,'&amp;').replace(/</g,'&lt;')}</option>`).join('');
    }
  }

  function bindUI(){
    // Search
    const search = document.getElementById('donationSearch');
    if (search){ search.addEventListener('input', ()=>applyFiltersAndSort()); }
    // Filters: do not auto-apply; only Apply button will trigger applyFiltersAndSort()
    // Quick ranges
    const quick = document.getElementById('quickRangeBtns');
    if (quick){
      quick.addEventListener('click', (e)=>{
        const btn = e.target.closest('button[data-range]'); if (!btn) return;
        const r = btn.getAttribute('data-range');
        const today = new Date();
        const pad=(n)=>String(n).padStart(2,'0');
        const fmt=(d)=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
        let from = new Date(today), to = new Date(today);
        if (r==='today'){ /* from,to already today */ }
        else if (r==='week'){
          const day = today.getDay(); // 0..6 Sun..Sat
          const diff = (day===0?6:day-1); // make Monday start
          from = new Date(today); from.setDate(today.getDate()-diff);
        } else if (r==='month'){
          from = new Date(today.getFullYear(), today.getMonth(), 1);
        }
        const fd=document.getElementById('fromDate'); const td=document.getElementById('toDate');
        if (fd) fd.value = fmt(from); if (td) td.value = fmt(to);
        // Do not apply yet; wait for Apply button
      });
    }
    // Sorts: do not auto-apply; only Apply button will trigger
    // Reset/Apply buttons within dropdowns
    document.querySelectorAll('.dropdown-menu').forEach(menu=>{
      menu.addEventListener('click', (e)=>{
        const btn = e.target.closest('button'); if (!btn) return;
        const label = (btn.textContent||'').trim().toLowerCase();
        if (label==='reset'){
          // Reset filters and sorts
          const fd=document.getElementById('fromDate'); const td=document.getElementById('toDate'); if (fd) fd.value=''; if (td) td.value='';
          ['donorsStatusSelectMobile','donorsDonationActivitySelectMobile','donorsCategorySelectMobile','recipientQuantityOrderSelectMobile','recipientSubmissionDateSelectMobile','recipientDonorOrderSelectMobile','donorsQuantityOrderSelectMobile','donorsSubmissionDateSelectMobile','donorsDonorOrderSelectMobile'].forEach(id=>{ const el = document.getElementById(id); if (el) el.selectedIndex = 0; });
          const search = document.getElementById('donationSearch'); if (search) search.value='';
          // Do not apply yet; wait for Apply button
        } else if (label==='apply'){
          applyFiltersAndSort();
        }
      });
    });
  }

  async function init() {
    try {
      // Clear placeholder rows while loading
      const tbody = document.querySelector("main .table tbody");
      if (tbody)
        tbody.innerHTML = `<tr><td colspan="7" class="text-center py-3">Loading donors...</td></tr>`;

      const [donors, donations] = await Promise.all([ fetchDonors(), fetchDonations() ]);
      donorsData = donors; donationsData = donations;
      populateFilters();
      bindUI();
      applyFiltersAndSort();

      // Import from Excel wiring
      const fileInput = document.getElementById('importDonorsInput');
      const btnDesktop = document.getElementById('importDonorsBtn');
      const btnMobile = document.getElementById('importDonorsBtnMobile');
      function openPicker(){ if (fileInput) fileInput.click(); }
      if (btnDesktop) btnDesktop.addEventListener('click', openPicker);
      if (btnMobile) btnMobile.addEventListener('click', openPicker);

      if (fileInput){
        fileInput.addEventListener('change', async (e) => {
          const file = e.target.files && e.target.files[0];
          if (!file) return;
          try{
            if (typeof XLSX === 'undefined'){
              alert('XLSX library not loaded.');
              return;
            }
            const data = await file.arrayBuffer();
            const wb = XLSX.read(data, { type: 'array' });
            const sheetName = wb.SheetNames[0];
            const ws = wb.Sheets[sheetName];
            const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });

            const res = await fetch(`${API_BASE_URL}/users/index.php?action=importDonors`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
              credentials: 'include',
              body: JSON.stringify({ rows })
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const j = await res.json();
            if (!j?.success) throw new Error(j?.error || 'Import failed');
            const summary = j.data || {};
            alert(`Import completed. Inserted: ${summary.inserted || 0}${(summary.errors && summary.errors.length) ? `, Errors: ${summary.errors.length}` : ''}`);

            const [freshDonors, freshDonations] = await Promise.all([ fetchDonors(), fetchDonations() ]);
            donorsData = freshDonors; donationsData = freshDonations;
            populateFilters();
            applyFiltersAndSort();
          } catch(err){
            console.error('Import failed:', err);
            try{ showToast(`Import failed: ${err.message}`, 'danger'); }catch(_){ }
          } finally {
            e.target.value = '';
          }
        });
      }
    } catch (err) {
      console.error("Failed to load donors:", err);
      const tbody = document.querySelector("main .table tbody");
      if (tbody)
        tbody.innerHTML = `<tr><td colspan="7" class="text-center text-danger">Failed to load donors (${escapeHtml(
          err.message
        )})</td></tr>`;
    }
  }
});
