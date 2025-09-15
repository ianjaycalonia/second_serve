document.addEventListener("DOMContentLoaded", () => {
  // Base API URL (same as other admin pages)
  const API_BASE_URL =
    typeof window.API_BASE_URL === "string" && window.API_BASE_URL
      ? window.API_BASE_URL
      : "/Capstone%20Project/php/api";

  // Fetch donors (approved) and donations list, then render donors table
  init();

  async function fetchDonors() {
    const res = await fetch(
      `${API_BASE_URL}/users.php?action=list&role=donor&status=active&t=${Date.now()}`,
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
    // Aggregate donations per donor_id: count DISTINCT completed batches only (exclude singles)
    const byDonor = new Map();
    donations.forEach((d) => {
      const id = d.donor_id;
      if (!id) return;
      // Only count items that are part of a batch and Completed
      if (!d.batch_id || (d.status || "") !== "Completed") return;
      const cur = byDonor.get(id) || { batches: new Set(), last: null };
      cur.batches.add(String(d.batch_id));
      const ts = d.created_at ? new Date(d.created_at) : null;
      if (ts && (!cur.last || ts > cur.last)) cur.last = ts;
      byDonor.set(id, cur);
    });

    const rows = donors.map((u) => {
      const name =
        u.organization_name && u.organization_name.trim()
          ? u.organization_name.trim()
          : (u.name || "").trim();
      const contact = (u.name || "").trim() || "—";
      const location = (u.address || "").trim() || "—";
      const agg = byDonor.get(u.user_id) || { batches: new Set(), last: null };
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
          <td>
            <a href="#" class="mm-open-chat" data-user-id="${u.user_id}">${escapeHtml(name)}</a>
          </td>
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

    // Delegate click: open chat when donor name is clicked
    tbody.addEventListener('click', async (e) => {
      const a = e.target.closest('a.mm-open-chat[data-user-id]');
      if (!a) return;
      e.preventDefault();
      const userId = Number(a.getAttribute('data-user-id')) || 0;
      if (!userId) return;
      try {
        // Ensure messages modal exists and is initialized by auth.js
        let modalEl = document.getElementById('messagesModal');
        if (!modalEl) {
          modalEl = document.createElement('div');
          modalEl.id = 'messagesModal';
          modalEl.className = 'modal fade';
          modalEl.tabIndex = -1;
          modalEl.setAttribute('aria-hidden', 'true');
          modalEl.innerHTML = '<div class="modal-dialog modal-dialog-scrollable modal-lg"><div class="modal-content"><div class="modal-header"><h5 class="modal-title" id="messagesModalLabel">Messages</h5><button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button></div><div class="modal-body"></div></div></div>';
          document.body.appendChild(modalEl);
          if (window.__initMessagesModal) { try { window.__initMessagesModal(modalEl); } catch(_){} }
        }
        // Create or get direct conversation
        const res = await fetch(`${API_BASE_URL}/messages.php?action=get_or_create_direct`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ other_user_id: userId })
        });
        const json = await res.json();
        const convId = json && json.success && json.data && json.data.conversation ? json.data.conversation.id : null;
        // Set pending selection early as a safety net and enable single-channel focus
        if (convId) {
          window.__pendingConversationId = convId;
          window.__limitToSingleChannel = true;
        }
        // Show the modal
        const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
        modal.show();
        // If controller exposes opener, select immediately and also retry once shortly after show
        if (convId) {
          if (window.__openConversation) {
            try { await window.__openConversation(convId); } catch(_){}
            setTimeout(async ()=>{ try { await window.__openConversation(convId); } catch(_){} }, 300);
          }
        }
      } catch(err) {
        console.error('Failed to open chat:', err);
      }
    });
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

  async function init() {
    try {
      // Clear placeholder rows while loading
      const tbody = document.querySelector("main .table tbody");
      if (tbody)
        tbody.innerHTML = `<tr><td colspan="7" class="text-center py-3">Loading donors...</td></tr>`;

      const [donors, donations] = await Promise.all([ fetchDonors(), fetchDonations() ]);
      renderDonors(donors, donations);

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

            const res = await fetch(`${API_BASE_URL}/users.php?action=importDonors`, {
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
            renderDonors(freshDonors, freshDonations);
          } catch(err){
            console.error('Import failed:', err);
            alert(`Import failed: ${err.message}`);
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
