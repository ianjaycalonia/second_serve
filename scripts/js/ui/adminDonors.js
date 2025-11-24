document.addEventListener("DOMContentLoaded", () => {
  // Base API URL (same as other admin pages)
  const API_BASE_URL =
    typeof window.API_BASE_URL === "string" && window.API_BASE_URL
      ? window.API_BASE_URL
      : "/php/api";

  // In-memory datasets and derived index
  let donorsData = [];
  let donationsData = [];
  let currentEditDonorId = null;
  let confirmActionCallback = null;

  function getModalInstance(id) {
    const el = document.getElementById(id);
    if (!el || !window.bootstrap || !bootstrap.Modal) return null;
    return bootstrap.Modal.getOrCreateInstance(el);
  }

  function setModalContent(el, text) {
    if (!el) return;
    const safe = escapeHtml(String(text ?? ""));
    el.innerHTML = safe.replace(/\n/g, "<br>");
  }

  function showMessageModal(title, message) {
    const titleEl = document.getElementById("donorMessageModalLabel");
    const bodyEl = document.getElementById("donorMessageModalBody");
    if (titleEl) titleEl.textContent = String(title ?? "Notice");
    setModalContent(bodyEl, message ?? "");
    const modal = getModalInstance("donorMessageModal");
    modal?.show();
  }

  function showConfirmModal({
    title = "Confirm Action",
    message = "Are you sure?",
    confirmText = "Confirm",
    confirmVariant = "primary",
    onConfirm = null,
  } = {}) {
    const titleEl = document.getElementById("donorConfirmModalLabel");
    const bodyEl = document.getElementById("donorConfirmModalBody");
    const btn = document.getElementById("donorConfirmModalBtn");
    if (titleEl) titleEl.textContent = String(title);
    setModalContent(bodyEl, message);
    if (btn) {
      btn.textContent = String(confirmText);
      btn.className = `btn btn-${confirmVariant}`;
    }
    confirmActionCallback = typeof onConfirm === "function" ? onConfirm : null;
    const modal = getModalInstance("donorConfirmModal");
    modal?.show();
  }

  function formatUserStatus(status) {
    const s = String(status || "").toLowerCase();
    if (!s) return "—";
    if (s === "approved") return "Active";
    if (s === "inactive") return "Inactive";
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  function formatDetailValue(value) {
    if (value === undefined || value === null) return "&mdash;";
    const str = String(value).trim();
    return str ? escapeHtml(str) : "&mdash;";
  }

  function showDonorDetails(donor) {
    const details = document.getElementById("viewDonorDetails");
    if (details) {
      const rows = [
        ["Organization", donor.organization_name],
        ["Contact Person", donor.name],
        ["Email", donor.email],
        ["Contact Number", donor.contact_number],
        ["Address", donor.address],
        ["Category", donor.donor_category || donor.donor_category_id],
        ["Status", formatUserStatus(donor.status)],
        ["Notes", donor.notes],
      ];
      details.innerHTML = rows
        .map(
          ([label, value]) =>
            `<dt class="col-sm-4">${escapeHtml(label)}</dt><dd class="col-sm-8">${formatDetailValue(value)}</dd>`
        )
        .join("");
    }
    const modal = getModalInstance("viewDonorModal");
    modal?.show();
  }

  // Fetch donors (approved) and donations list, then render donors table
  init();

  async function fetchDonors() {
    const res = await fetch(
      `${API_BASE_URL}/users/index.php?action=list&role=donor&t=${Date.now()}`,
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
      const statusLower = String(u.status || '').toLowerCase();
      const status =
        statusLower === "approved"
          ? badge("Active", "success")
          : statusLower === "inactive"
          ? badge("Inactive", "secondary")
          : badge("Pending", "warning");
      const isApproved = statusLower === 'approved';
      const isInactive = statusLower === 'inactive';
      const actionsMenu = `
        <div class="dropdown-menu dropdown-menu-end p-2" style="min-width:auto;">
          <div class="d-flex align-items-center justify-content-center gap-2">
            <button class="btn btn-sm btn-outline-secondary edit-btn" style="width:32px;height:32px;" data-bs-toggle="tooltip" data-bs-placement="top" title="Edit" data-user-id="${u.user_id}">
              <i class="bi bi-pencil-square"></i>
            </button>
            ${isApproved ? `
            <button class="btn btn-sm btn-outline-danger deactivate-btn" style="width:32px;height:32px;" data-bs-toggle="tooltip" data-bs-placement="top" title="Deactivate" data-user-id="${u.user_id}">
              <i class="bi bi-person-x"></i>
            </button>` : ''}
            ${!isApproved ? `
            <button class="btn btn-sm btn-outline-success activate-btn" style="width:32px;height:32px;" data-bs-toggle="tooltip" data-bs-placement="top" title="Activate" data-user-id="${u.user_id}">
              <i class="bi bi-person-check"></i>
            </button>` : ''}
          </div>
        </div>`;
      return `
        <tr>
          <td>${escapeHtml(name)}</td>
          <td>${escapeHtml(contact)}</td>
          <td>${escapeHtml(location)}</td>
          <td>${total}</td>
          <td>${last}</td>
          <td>${status}</td>
          <td class="text-end">
            <div class="dropdown recipient-actions d-inline-flex align-items-center">
              <a href="#" class="btn btn-outline-primary btn-sm me-1 view-btn" data-user-id="${u.user_id}">
                <i class="bi bi-eye-fill"></i>
              </a>
              <button class="btn btn-link p-0" data-bs-toggle="dropdown" aria-expanded="false" aria-label="More actions">
                <i class="bi bi-three-dots-vertical"></i>
              </button>
              ${actionsMenu}
            </div>
          </td>
        </tr>
      `;
    });
    tbody.innerHTML = rows.join("");
    // Initialize tooltips for dynamically added action icons
    try {
      const tips = Array.from(document.querySelectorAll('[data-bs-toggle="tooltip"]'));
      tips.forEach((el) => {
        if (window.bootstrap && bootstrap.Tooltip) {
          bootstrap.Tooltip.getOrCreateInstance(el);
        }
      });
    } catch (_) {}
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
        const statusToCheck = statusFilter.toLowerCase();
        const userStatus = String(u.status || '').toLowerCase();
        const lastStatus = String(agg.lastStatus || '').toLowerCase();
        if (statusToCheck === 'inactive') {
          if (userStatus !== 'inactive') return false;
        } else if (statusToCheck === 'pending') {
          if (userStatus !== 'pending' && lastStatus !== 'pending') return false;
        } else {
          if (userStatus !== statusToCheck && lastStatus !== statusToCheck) return false;
        }
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
              showMessageModal('Import Donors', 'XLSX library not loaded.');
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
            const msg = `Import completed. Inserted: ${summary.inserted || 0}${(summary.errors && summary.errors.length) ? `, Errors: ${summary.errors.length}` : ''}`;
            showMessageModal('Import Donors', msg);

            const [freshDonors, freshDonations] = await Promise.all([ fetchDonors(), fetchDonations() ]);
            donorsData = freshDonors; donationsData = freshDonations;
            populateFilters();
            applyFiltersAndSort();
          } catch(err){
            try{ showToast(`Import failed: ${err.message}`, 'danger'); }catch(_){ }
          } finally {
            e.target.value = '';
          }
        });
      }

      // Add Donor modal submit handler
      const addBtn = document.getElementById('addDonorSubmitBtn');
      if (addBtn) {
        // Initialize Select2 for donor category with backend lookups
        try {
          const addSel = document.getElementById('addDonorCategory');
          const addModalEl = document.getElementById('addDonorModal');
          if (addSel && window.$ && $.fn.select2) {
            $(addSel).select2({
              width: '100%',
              placeholder: 'Select a category',
              allowClear: true,
              dropdownParent: addModalEl ? $(addModalEl) : undefined,
              ajax: {
                url: `${API_BASE_URL}/lookups/index.php/donor-categories`,
                dataType: 'json',
                delay: 250,
                data: (params) => ({ q: params.term || '', limit: 20, active: 1 }),
                processResults: (data) => ({
                  results: Array.isArray(data?.items)
                    ? data.items.map((it) => ({ id: it.id, text: it.name }))
                    : []
                })
              }
            });
          }

          const editSel = document.getElementById('editDonorCategory');
          const editModalEl = document.getElementById('editDonorModal');
          if (editSel && window.$ && $.fn.select2) {
            $(editSel).select2({
              width: '100%',
              placeholder: 'Select a category',
              allowClear: true,
              dropdownParent: editModalEl ? $(editModalEl) : undefined,
              ajax: {
                url: `${API_BASE_URL}/lookups/index.php/donor-categories`,
                dataType: 'json',
                delay: 250,
                data: (params) => ({ q: params.term || '', limit: 20, active: 1 }),
                processResults: (data) => ({
                  results: Array.isArray(data?.items)
                    ? data.items.map((it) => ({ id: it.id, text: it.name }))
                    : []
                })
              }
            });
          }
        } catch (_) {}

        addBtn.addEventListener('click', async () => {
          const org = document.getElementById('addDonorOrg')?.value.trim() || '';
          const first = document.getElementById('addDonorFirstName')?.value.trim() || '';
          const middle = document.getElementById('addDonorMiddleInitial')?.value.trim() || '';
          const last = document.getElementById('addDonorLastName')?.value.trim() || '';
          const suffix = document.getElementById('addDonorSuffix')?.value.trim() || '';
          const fullNameInput = document.getElementById('addDonorName');
          const composeFullName = () => {
            const parts = [];
            if (first) parts.push(first);
            if (middle) {
              const normalized = middle.replace(/\.+$/g, '');
              if (normalized) parts.push(`${normalized}.`);
            }
            if (last) parts.push(last);
            if (suffix) parts.push(suffix);
            return parts.join(' ').replace(/\s+/g, ' ').trim();
          };
          const composedName = composeFullName();
          if (fullNameInput && composedName) {
            fullNameInput.value = composedName;
          }
          const name = composedName || fullNameInput?.value.trim() || '';
          const email = document.getElementById('addDonorEmail')?.value.trim() || '';
          const contact_number = document.getElementById('addDonorPhone')?.value.trim() || '';
          const brgy = document.getElementById('addDonorBarangay')?.value.trim() || '';
          const city = document.getElementById('addDonorCity')?.value.trim() || '';
          const addrInput = document.getElementById('addDonorAddress');
          const composedAddress = [brgy, city].filter(Boolean).join(', ');
          if (addrInput && composedAddress) {
            addrInput.value = composedAddress;
          }
          const address = composedAddress || addrInput?.value.trim() || '';
          const donor_category_id = document.getElementById('addDonorCategory')?.value || '';
          const fb = document.getElementById('addDonorFeedback');
          if (fb) fb.textContent = '';
          if (!org && !name) {
            if (fb) fb.textContent = 'Organization Name or Contact Person is required.';
            return;
          }
          addBtn.disabled = true;
          try {
            const res = await fetch(`${API_BASE_URL}/users/index.php?action=createDonor`, {
              method: 'POST',
              credentials: 'include',
              headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
              body: JSON.stringify({
                organization_name: org || null,
                name: name || null,
                email: email || null,
                contact_number: contact_number || null,
                address: address || null,
                donor_category_id: donor_category_id ? Number(donor_category_id) : null,
              })
            });
            const j = await res.json().catch(()=>({success:false,error:`HTTP ${res.status}`}));
            if (!res.ok || !j?.success) throw new Error(j?.error || `HTTP ${res.status}`);
            const data = j.data || {};
            // Hide modal
            try {
              const m = document.getElementById('addDonorModal');
              if (m && window.bootstrap && bootstrap.Modal) bootstrap.Modal.getOrCreateInstance(m).hide();
            } catch(_){}
            // Refresh lists
            const [freshDonors, freshDonations] = await Promise.all([ fetchDonors(), fetchDonations() ]);
            donorsData = freshDonors; donationsData = freshDonations;
            populateFilters();
            applyFiltersAndSort();
            // Show temp password
            try { showToast('Donor created successfully.', 'success'); } catch (_){
              showMessageModal('Add Donor', 'Donor created successfully.');
            }
          } catch(err){
            if (fb) fb.textContent = err?.message || 'Failed to create donor';
          } finally {
            addBtn.disabled = false;
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

  async function openDonorModal(userId) {
    const donor = donorsData.find((d) => Number(d.user_id) === Number(userId));
    if (!donor) {
      showMessageModal('View Donor', 'Donor not found.');
      return;
    }
    try {
      const res = await fetch(`${API_BASE_URL}/users/index.php?action=getProfile`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ user_id: userId }),
      });
      const j = await res.json();
      if (!res.ok || !j?.success) throw new Error(j?.error || `HTTP ${res.status}`);
      const data = j?.data?.user || donor;
      showDonorDetails(data);
    } catch (err) {
      showMessageModal('View Donor', `Failed to load donor profile: ${escapeHtml(err?.message || 'Unknown error')}`);
    }
  }

  async function openEditDonor(userId) {
    const donor = donorsData.find((d) => Number(d.user_id) === Number(userId));
    if (!donor) {
      showMessageModal('Edit Donor', 'Donor not found.');
      return;
    }
    currentEditDonorId = Number(userId);
    const orgInput = document.getElementById('editDonorOrg');
    const nameInput = document.getElementById('editDonorName');
    const emailInput = document.getElementById('editDonorEmail');
    const phoneInput = document.getElementById('editDonorPhone');
    const addrInput = document.getElementById('editDonorAddress');
    const fb = document.getElementById('editDonorFeedback');
    const categorySel = document.getElementById('editDonorCategory');
    if (fb) fb.textContent = '';
    if (orgInput) orgInput.value = donor.organization_name || '';
    if (nameInput) nameInput.value = donor.name || '';
    if (emailInput) emailInput.value = donor.email || '';
    if (phoneInput) phoneInput.value = donor.contact_number || '';
    if (addrInput) addrInput.value = donor.address || '';
    if (categorySel && window.$ && $.fn.select2) {
      const val = donor.donor_category_id || null;
      if (val) {
        const option = new Option(donor.donor_category || `Category ${val}`, val, true, true);
        $(categorySel).html(option).trigger('change');
      } else {
        $(categorySel).val(null).trigger('change');
      }
    }
    const modal = getModalInstance('editDonorModal');
    modal?.show();
  }

  async function updateDonorStatus(userId, status) {
    try {
      const res = await fetch(`${API_BASE_URL}/users/index.php?action=setStatus`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ user_id: Number(userId), status }),
      });
      const j = await res.json();
      if (!res.ok || !j?.success) throw new Error(j?.error || `HTTP ${res.status}`);
      const [freshDonors, freshDonations] = await Promise.all([ fetchDonors(), fetchDonations() ]);
      donorsData = freshDonors;
      donationsData = freshDonations;
      populateFilters();
      applyFiltersAndSort();
      showMessageModal('Update Donor Status', `Donor ${status === "inactive" ? "deactivated" : "activated"} successfully.`);
    } catch (err) {
      showMessageModal('Update Donor Status', `Failed to update donor status: ${escapeHtml(err?.message || 'Unknown error')}`);
    }
  }

  document.addEventListener("click", (e) => {
    const view = e.target.closest?.(".view-btn");
    if (view) {
      e.preventDefault();
      const id = Number(view.getAttribute("data-user-id"));
      if (id) openDonorModal(id);
      return;
    }
    const edit = e.target.closest?.(".edit-btn");
    if (edit) {
      e.preventDefault();
      const id = Number(edit.getAttribute("data-user-id"));
      if (id) openEditDonor(id);
      return;
    }
    const deactivate = e.target.closest?.(".deactivate-btn");
    if (deactivate) {
      e.preventDefault();
      const id = Number(deactivate.getAttribute("data-user-id"));
      if (!id) return;
      showConfirmModal({
        title: 'Deactivate Donor',
        message: 'Are you sure you want to deactivate this donor? They will remain visible but marked as inactive.',
        confirmText: 'Deactivate',
        confirmVariant: 'danger',
        onConfirm: () => updateDonorStatus(id, "inactive"),
      });
      return;
    }
    const activate = e.target.closest?.(".activate-btn");
    if (activate) {
      e.preventDefault();
      const id = Number(activate.getAttribute("data-user-id"));
      if (!id) return;
      showConfirmModal({
        title: 'Activate Donor',
        message: 'Reactivate this donor and mark them as active?',
        confirmText: 'Activate',
        confirmVariant: 'success',
        onConfirm: () => updateDonorStatus(id, "approved"),
      });
    }
  });

  const confirmBtn = document.getElementById('donorConfirmModalBtn');
  if (confirmBtn) {
    confirmBtn.addEventListener('click', () => {
      if (confirmActionCallback) {
        const fn = confirmActionCallback;
        confirmActionCallback = null;
        try {
          fn();
        } catch (_) {}
      }
      getModalInstance('donorConfirmModal')?.hide();
    });
  }

  const editForm = document.getElementById('editDonorForm');
  if (editForm) {
    editForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!currentEditDonorId) return;
      const orgInput = document.getElementById('editDonorOrg');
      const nameInput = document.getElementById('editDonorName');
      const emailInput = document.getElementById('editDonorEmail');
      const phoneInput = document.getElementById('editDonorPhone');
      const addrInput = document.getElementById('editDonorAddress');
      const fb = document.getElementById('editDonorFeedback');
      const categorySel = document.getElementById('editDonorCategory');
      const saveBtn = document.getElementById('editDonorSaveBtn');
      if (fb) fb.textContent = '';
      const payload = {
        user_id: Number(currentEditDonorId),
        organization_name: orgInput?.value.trim() || null,
        name: nameInput?.value.trim() || null,
        email: emailInput?.value.trim() || null,
        contact_number: phoneInput?.value.trim() || null,
        address: addrInput?.value.trim() || null,
        donor_category_id: categorySel && $(categorySel).val() ? Number($(categorySel).val()) : null,
      };
      if (saveBtn) saveBtn.disabled = true;
      try {
        const res = await fetch(`${API_BASE_URL}/users/index.php?action=adminUpdateProfile`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(payload),
        });
        const j = await res.json();
        if (!res.ok || !j?.success) throw new Error(j?.error || `HTTP ${res.status}`);
        currentEditDonorId = null;
        getModalInstance('editDonorModal')?.hide();
        const [freshDonors, freshDonations] = await Promise.all([ fetchDonors(), fetchDonations() ]);
        donorsData = freshDonors;
        donationsData = freshDonations;
        populateFilters();
        applyFiltersAndSort();
        showMessageModal('Edit Donor', 'Donor updated successfully.');
      } catch (err) {
        if (fb) fb.textContent = err?.message || 'Failed to update donor';
      } finally {
        if (saveBtn) saveBtn.disabled = false;
      }
    });
  }
});
