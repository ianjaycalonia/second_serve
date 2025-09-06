document.addEventListener("DOMContentLoaded", () => {
  const body = document.body;
  const sidebar = document.querySelector("aside");
  const toggleBtn = document.getElementById("sidebarToggle");
  const backdrop = document.querySelector(".sidebar-backdrop");
  const links = document.querySelectorAll("aside .nav-link");

  // Base API URL (same as other admin pages)
  const API_BASE_URL =
    typeof window.API_BASE_URL === "string" && window.API_BASE_URL
      ? window.API_BASE_URL
      : "/Capstone%20Project/php/api";

  function openSidebar() {
    body.classList.add("sidebar-open");
    if (backdrop) backdrop.style.display = "block";
  }
  function closeSidebar() {
    body.classList.remove("sidebar-open");
    if (backdrop) backdrop.style.display = "none";
  }

  if (toggleBtn) {
    toggleBtn.addEventListener("click", () => {
      if (window.innerWidth < 768) {
        body.classList.contains("sidebar-open")
          ? closeSidebar()
          : openSidebar();
      } else {
        sidebar.classList.toggle("collapsed");
        body.classList.toggle("sidebar-collapsed");
      }
    });
  }
  if (backdrop) {
    backdrop.addEventListener("click", closeSidebar);
  }
  window.addEventListener("resize", () => {
    if (window.innerWidth < 768) {
      closeSidebar();
      sidebar.classList.remove("collapsed");
      body.classList.remove("sidebar-collapsed");
    } else {
      closeSidebar();
    }
  });
  window.addEventListener("resize", () => {
    if (window.innerWidth > 768) {
      closeSidebar();
      sidebar.classList.add("collapsed");
      body.classList.add("sidebar-collapsed");
    } else {
      closeSidebar();
    }
  });
  links.forEach((link) => {
    link.addEventListener("click", (e) => {
      if (window.innerWidth >= 768 && sidebar.classList.contains("collapsed")) {
        e.preventDefault();
        sidebar.classList.remove("collapsed");
        body.classList.remove("sidebar-collapsed");
      }
      links.forEach((l) => l.classList.remove("active"));
      link.classList.add("active");
    });
  });

  // Fetch donors (approved) and donations list, then render donors table
  init();

  async function fetchDonors() {
    const res = await fetch(
      `${API_BASE_URL}/user_api.php?action=list&role=donor&status=approved&t=${Date.now()}`,
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

      const [donors, donations] = await Promise.all([
        fetchDonors(),
        fetchDonations(),
      ]);
      renderDonors(donors, donations);
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
