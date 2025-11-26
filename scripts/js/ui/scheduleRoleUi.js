(function () {
  "use strict";

  const root = typeof window !== "undefined" ? window : globalThis;
  const API_BASE =
    (root && typeof root.API_BASE_URL === "string" && root.API_BASE_URL) ||
    "/php/api";

  const getStoredUser = () => {
    try {
      const raw = root.sessionStorage ? root.sessionStorage.getItem("user") : null;
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  };

  const persistUser = (user) => {
    if (!user || !root.sessionStorage) return;
    try {
      root.sessionStorage.setItem("user", JSON.stringify(user));
    } catch (_) {
      /* ignore quota errors */
    }
  };

  const fetchUserProfile = async () => {
    try {
      const res = await fetch(
        `${API_BASE}/users/index.php?action=getProfile`,
        {
          credentials: "include",
          headers: { Accept: "application/json" },
        }
      );
      if (!res.ok) return null;
      const json = await res.json().catch(() => null);
      const user = json?.data?.user || null;
      if (user) persistUser(user);
      return user;
    } catch (_) {
      return null;
    }
  };

  const resolveCurrentUser = async () => {
    const cached = getStoredUser();
    if (cached) return cached;
    return await fetchUserProfile();
  };

  const replaceAccountMenu = (role) => {
    const menu = document.getElementById("accountMenu");
    if (!menu || !role) return;
    const lower = role.toLowerCase();
    if (lower === "admin") return; // keep default admin menu

    let body = "";
    if (lower === "donor") {
      body = `
        <li>
          <a class="dropdown-item" href="donorprofile.html">
            <i class="bi bi-person me-2"></i>Profile
          </a>
        </li>
        <li><hr class="dropdown-divider" /></li>
        <li>
          <a class="dropdown-item text-danger logout-btn" href="#">
            <i class="bi bi-box-arrow-right me-2"></i>Logout
          </a>
        </li>`;
    } else if (lower === "recipient") {
      body = `
        <li>
          <a class="dropdown-item" href="recipientprofile.html">
            <i class="bi bi-person me-2"></i>Profile
          </a>
        </li>
        <li><hr class="dropdown-divider" /></li>
        <li>
          <a class="dropdown-item text-danger logout-btn" href="#">
            <i class="bi bi-box-arrow-right me-2"></i>Logout
          </a>
        </li>`;
    }
    if (body) menu.innerHTML = body;
  };

  const donorSidebarMarkup = () => `
    <a
      href="donordashboard.html"
      class="nav-link d-flex align-items-center dashboard-link"
      data-bs-toggle="tooltip"
      data-bs-placement="right"
      data-bs-custom-class="custom-tooltip"
      data-bs-title="Dashboard"
    >
      <img src="images/home.gif" alt="Dashboard Icon" class="dashboard-icon" width="35" height="35" />
      <span class="sidebar-text">Dashboard</span>
    </a>
    <a
      href="mydonations.html"
      class="nav-link d-flex align-items-center dashboard-link"
      data-bs-toggle="tooltip"
      data-bs-placement="right"
      data-bs-custom-class="custom-tooltip"
      data-bs-title="My Donations"
    >
      <img src="images/charity.gif" alt="My Donations" class="dashboard-icon" width="35" height="35" />
      <span class="sidebar-text">My Donations</span>
    </a>
    <a
      href="schedule.html"
      class="nav-link active d-flex align-items-center dashboard-link"
      data-bs-toggle="tooltip"
      data-bs-placement="right"
      data-bs-custom-class="custom-tooltip"
      data-bs-title="Schedule"
    >
      <img src="images/calendar.gif" alt="Schedule" class="dashboard-icon" width="35" height="35" />
      <span class="sidebar-text">Schedule</span>
    </a>`;

  const recipientSidebarMarkup = () => `
    <a
      href="recipientdashboard.html"
      class="nav-link d-flex align-items-center dashboard-link"
      data-bs-toggle="tooltip"
      data-bs-placement="right"
      data-bs-custom-class="custom-tooltip"
      data-bs-title="Dashboard"
    >
      <img src="images/home.gif" alt="Dashboard Icon" class="dashboard-icon" width="35" height="35" />
      <span class="sidebar-text">Dashboard</span>
    </a>
    <a
      href="receiveditems.html"
      class="nav-link d-flex align-items-center dashboard-link"
      data-bs-toggle="tooltip"
      data-bs-placement="right"
      data-bs-custom-class="custom-tooltip"
      data-bs-title="Received Items"
    >
      <img src="images/received_items.gif" alt="Received Items" class="dashboard-icon" width="35" height="35" />
      <span class="sidebar-text">Received Items</span>
    </a>
    <a
      href="schedule.html"
      class="nav-link active d-flex align-items-center dashboard-link"
      data-bs-toggle="tooltip"
      data-bs-placement="right"
      data-bs-custom-class="custom-tooltip"
      data-bs-title="Schedule"
    >
      <img src="images/calendar.gif" alt="Schedule" class="dashboard-icon" width="35" height="35" />
      <span class="sidebar-text">Schedule</span>
    </a>`;

  const refreshSidebarTooltips = () => {
    if (!(root.bootstrap && typeof root.bootstrap.Tooltip === "function")) return;
    try {
      document
        .querySelectorAll('[data-bs-toggle="tooltip"]')
        .forEach((el) => {
          const existing = root.bootstrap.Tooltip.getInstance(el);
          if (existing) existing.dispose();
          root.bootstrap.Tooltip.getOrCreateInstance(el, {
            customClass: "custom-tooltip",
            container: "body",
            boundary: "viewport",
            fallbackPlacements: ["right", "left", "bottom", "top"],
            trigger: "hover focus",
            delay: { show: 150, hide: 50 },
          });
        });
    } catch (_) {
      /* ignore */
    }
  };

  const applySidebarForRole = (role) => {
    const aside = document.querySelector("aside.sidebar");
    if (!aside) return;
    const lower = role.toLowerCase();
    if (lower === "admin") return;
    if (aside.dataset.roleApplied === lower) return;

    let html = "";
    if (lower === "donor") html = donorSidebarMarkup();
    else if (lower === "recipient") html = recipientSidebarMarkup();
    if (!html) return;

    aside.innerHTML = html;
    aside.dataset.roleApplied = lower;
    refreshSidebarTooltips();
  };

  const revealSidebar = () => {
    const aside = document.querySelector("aside.sidebar");
    if (!aside) return;
    aside.removeAttribute("data-role-pending");
    aside.style.removeProperty("visibility");
  };

  document.addEventListener("DOMContentLoaded", async () => {
    try {
      const user = await resolveCurrentUser();
      const role = user?.role ? String(user.role).toLowerCase() : null;
      if (role) {
        replaceAccountMenu(role);
        applySidebarForRole(role);
      }
    } finally {
      revealSidebar();
    }
  });
})();
