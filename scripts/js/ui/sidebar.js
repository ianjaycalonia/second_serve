function getCurrentUser(){
  try{ const s = sessionStorage.getItem('user'); return s ? JSON.parse(s) : null; }catch(_){ return null; }
}

document.addEventListener("DOMContentLoaded", () => {
  const body = document.body;
  const sidebar = document.querySelector("aside");
  const toggleBtn = document.getElementById("sidebarToggle");
  const backdrop = document.querySelector(".sidebar-backdrop");
  const isMobile = () => window.matchMedia("(max-width: 768px)").matches;

  // Build sidebar items by role before wiring behaviors
  try {
    if (sidebar) {
      const user = getCurrentUser();
      const role = (user?.role || '').toString().trim().toLowerCase();
      if (role === 'donor') {
        sidebar.innerHTML = `
          <a href="DonorDashboard.html" class="nav-link"><i class="bi bi-house-door-fill me-2"></i><span>Dashboard</span></a>
          <a href="MyDonations.html" class="nav-link"><i class="bi bi-box2-heart-fill me-2"></i><span>My Donations</span></a>
          <a href="Schedule.html" class="nav-link"><i class="bi bi-calendar2-week-fill me-2"></i><span>Schedule</span></a>
        `;
      } else if (role === 'recipient') {
        // Match existing filenames/casing used in recipient pages
        sidebar.innerHTML = `
          <a href="recipientDashboard.html" class="nav-link"><i class="bi bi-house-door-fill me-2"></i><span>Dashboard</span></a>
          <a href="ReceivedItems.html" class="nav-link"><i class="bi bi-box-seam me-2"></i><span>Received Items</span></a>
          <a href="Schedule.html" class="nav-link"><i class="bi bi-calendar2-week-fill me-2"></i><span>Schedule</span></a>
        `;
      } else {
        // Admin (default: keep admin links if already present in the HTML)
        // No-op: assume AdminDashboard.html set of links are present in page markup
      }
    }
  } catch(_){}

  // Re-query links after potential re-render
  const links = document.querySelectorAll("aside .nav-link");

  const tooltipTriggerList = document.querySelectorAll(
    '[data-bs-toggle="tooltip"]'
  );

  const tooltipList = [...tooltipTriggerList].map(
    (el) =>
      new bootstrap.Tooltip(el, {
        customClass: "custom-tooltip",
      })
  );

  function showTooltips() {
    tooltipList.forEach((t) => {
      t.enable();
    });
  }

  function hideTooltips() {
    tooltipList.forEach((t) => {
      t.hide();
      t.disable();
    });
  }

  function openSidebar() {
    body.classList.add("sidebar-open");
    if (backdrop) backdrop.style.display = "block";
    hideTooltips();
  }

  function closeSidebar() {
    body.classList.remove("sidebar-open");
    if (backdrop) backdrop.style.display = "none";
    hideTooltips();
  }

  if (toggleBtn) {
    toggleBtn.addEventListener("click", () => {
      if (isMobile()) {
        body.classList.contains("sidebar-open")
          ? closeSidebar()
          : openSidebar();
      } else {
        sidebar.classList.toggle("collapsed");
        body.classList.toggle("sidebar-collapsed");
        if (sidebar.classList.contains("collapsed")) {
          showTooltips();
        } else {
          hideTooltips();
        }
      }
    });
  }

  if (backdrop) {
    backdrop.addEventListener("click", closeSidebar);
  }

  window.addEventListener("resize", () => {
    if (isMobile()) {
      closeSidebar();
      sidebar.classList.remove("collapsed");
      body.classList.remove("sidebar-collapsed");
      hideTooltips();
    } else {
      closeSidebar();
      sidebar.classList.add("collapsed");
      body.classList.add("sidebar-collapsed");
      showTooltips();
    }
  });

  links.forEach((link) => {
    link.addEventListener("click", (e) => {
      hideTooltips();
      if (!isMobile() && sidebar.classList.contains("collapsed")) {
        e.preventDefault();
        sidebar.classList.remove("collapsed");
        body.classList.remove("sidebar-collapsed");
        hideTooltips();
        return;
      }
      links.forEach((l) => l.classList.remove("active"));
      link.classList.add("active");
    });
  });

  if (sidebar.classList.contains("collapsed")) {
    showTooltips();
  } else {
    hideTooltips();
  }
});
