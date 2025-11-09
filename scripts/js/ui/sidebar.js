function getCurrentUser() {
  try {
    const s = sessionStorage.getItem("user");
    return s ? JSON.parse(s) : null;
  } catch (_) {
    return null;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const body = document.body;
  const sidebar = document.querySelector("aside");
  // Defensive: ensure required elements exist before using classList
  if (!body) return; // nothing to do without body
  if (!sidebar) {
    // No sidebar present on this page; nothing to initialize
    return;
  }
  const toggleBtn = document.getElementById("sidebarToggle");
  const backdrop = document.querySelector(".sidebar-backdrop");
  const isMobile = () => window.matchMedia("(max-width: 768px)").matches;

  // Harden initial state: ensure backdrop is hidden and body not marked open
  try {
    if (backdrop) backdrop.style.display = "none";
    document.body.classList.remove("sidebar-open");
  } catch (_) {}

  // Build sidebar items by role before wiring behaviors
  try {
    if (sidebar) {
      const user = getCurrentUser();
      const role = (user?.role || "").toString().trim().toLowerCase();
      if (role === "donor") {
        sidebar.innerHTML = `
          <a
            href="DonorDashboard.html"
            class="nav-link d-flex align-items-center dashboard-link"
            data-bs-toggle="tooltip"
            data-bs-placement="right"
            data-bs-custom-class="custom-tooltip"
            data-bs-title="Dashboard"
          >
            <img
              src="images/home.gif"
              alt="Dashboard Icon"
              class="dashboard-icon"
              width="35"
              height="35"
            />

            <span class="sidebar-text">Dashboard</span>
          </a>
          <a
            href="MyDonations.html"
            class="nav-link d-flex align-items-center dashboard-link"
            data-bs-toggle="tooltip"
            data-bs-placement="right"
            data-bs-custom-class="custom-tooltip"
            data-bs-title="My Donations"
          >
            <img
              src="images/charity.gif"
              alt="Dashboard Icon"
              class="dashboard-icon"
              width="35"
              height="35"
            />

            <span class="sidebar-text">My Donations</span>
          </a>
          <a
            href="Schedule.html"
            class="nav-link d-flex align-items-center dashboard-link"
            data-bs-toggle="tooltip"
            data-bs-placement="right"
            data-bs-custom-class="custom-tooltip"
            data-bs-title="Schedule"
          >
            <img
              src="images/calendar.gif"
              alt="Dashboard Icon"
              class="dashboard-icon"
              width="35"
              height="35"
            />

            <span class="sidebar-text">Schedule</span>
          </a>
        `;
      } else if (role === "recipient") {
        // Match existing filenames/casing used in recipient pages
        sidebar.innerHTML = `
          <a
            href="recipientDashboard.html"
            class="nav-link active d-flex align-items-center dashboard-link"
            data-bs-toggle="tooltip"
            data-bs-placement="right"
            data-bs-custom-class="custom-tooltip"
            data-bs-title="Dashboard"
          >
            <img
              src="images/home.gif"
              alt="Dashboard Icon"
              class="dashboard-icon"
              width="35"
              height="35"
            />

            <span class="sidebar-text">Dashboard</span>
          </a>
          <a
            href="ReceivedItems.html"
            class="nav-link d-flex align-items-center dashboard-link"
            data-bs-toggle="tooltip"
            data-bs-placement="right"
            data-bs-custom-class="custom-tooltip"
            data-bs-title="Received Items"
          >
            <img
              src="images/received_items.gif"
              alt="Dashboard Icon"
              class="dashboard-icon"
              width="35"
              height="35"
            />

            <span class="sidebar-text">Received Items</span>
          </a>
          <a
            href="Schedule.html"
            class="nav-link d-flex align-items-center dashboard-link"
            data-bs-toggle="tooltip"
            data-bs-placement="right"
            data-bs-custom-class="custom-tooltip"
            data-bs-title="Schedule"
          >
            <img
              src="images/calendar.gif"
              alt="Dashboard Icon"
              class="dashboard-icon"
              width="35"
              height="35"
            />

            <span class="sidebar-text">Schedule</span>
          </a>
        `;
      }
    }
  } catch (_) {}

  // Re-query links after potential re-render
  const links = document.querySelectorAll("aside .nav-link");

  // --- NEW: Set active link based on current page URL ---
  try {
    // Get the current page filename (e.g., "MyDonations.html")
    const currentPage = window.location.pathname.split("/").pop();

    if (currentPage) {
      links.forEach((link) => {
        const linkHref = link.getAttribute("href");
        if (linkHref) {
          // Get the link's filename, removing any query parameters
          const linkPage = linkHref.split("/").pop().split("?")[0];

          // Check if the link's page matches the current page
          if (linkPage === currentPage) {
            link.classList.add("active");
          } else {
            link.classList.remove("active"); // Ensure all others are not active
          }
        }
      });
    }
  } catch (err) {
    console.error("Error setting active sidebar link:", err);
  }
  // --- END OF NEW BLOCK ---

  // Initialize robust tooltips for sidebar links
  function initSidebarTooltips() {
    try {
      // Dispose previous instances to prevent duplicates/sticky tooltips
      if (Array.isArray(window.__sidebar_tooltips)) {
        window.__sidebar_tooltips.forEach((inst) => {
          try {
            inst.dispose();
          } catch (_) {}
        });
      }
      const triggers = document.querySelectorAll('[data-bs-toggle="tooltip"]');
      const list = [];
      triggers.forEach((el) => {
        try {
          list.push(
            new bootstrap.Tooltip(el, {
              customClass: "custom-tooltip",
              container: "body",
              boundary: "viewport",
              fallbackPlacements: ["right", "left", "bottom", "top"],
              trigger: "hover focus",
              delay: { show: 150, hide: 50 },
            })
          );
        } catch (_) {}
      });
      window.__sidebar_tooltips = list;
      // Bind global one-time listeners to hide all tooltips on interactions
      if (!window.__sidebar_tt_bound) {
        window.__sidebar_tt_bound = true;
        const hideAll = () => {
          try {
            (window.__sidebar_tooltips || []).forEach((t) => {
              try {
                t.hide();
              } catch (_) {}
            });
          } catch (_) {}
        };
        document.addEventListener("click", hideAll, true);
        document.addEventListener("scroll", hideAll, true);
        document.addEventListener("shown.bs.modal", hideAll);
        document.addEventListener("hide.bs.modal", hideAll);
        // When any tooltip is about to show, hide all others first
        document.addEventListener("show.bs.tooltip", (ev) => {
          try {
            (window.__sidebar_tooltips || []).forEach((t) => {
              try {
                if (t._element !== ev.target) t.hide();
              } catch (_) {}
            });
          } catch (_) {}
        });
        // Also hide on mouse leaving the sidebar region
        try {
          sidebar?.addEventListener("mouseleave", hideAll);
        } catch (_) {}
        window.addEventListener("beforeunload", () => {
          try {
            (window.__sidebar_tooltips || []).forEach((t) => {
              try {
                t.dispose();
              } catch (_) {}
            });
          } catch (_) {}
          window.__sidebar_tooltips = [];
        });
      }
    } catch (_) {}
  }

  function showTooltips() {
    initSidebarTooltips();
    (window.__sidebar_tooltips || []).forEach((t) => {
      try {
        t.enable();
      } catch (_) {}
    });
  }

  function hideTooltips() {
    (window.__sidebar_tooltips || []).forEach((t) => {
      try {
        t.hide();
        t.disable();
      } catch (_) {}
    });
  }

  function openSidebar() {
    body.classList.add("sidebar-open");
    try {
      if (backdrop) backdrop.style.display = "none"; // keep hidden per mobile UX
      // Force aside visible in off-canvas mode
      if (isMobile() && sidebar) {
        sidebar.style.display = "block";
        sidebar.style.transform = "translateX(0)";
      }
    } catch (_) {}
    hideTooltips();
  }

  function closeSidebar() {
    body.classList.remove("sidebar-open");
    try {
      if (backdrop) backdrop.style.display = "none";
      if (isMobile() && sidebar) {
        sidebar.style.transform = "translateX(-100%)";
        // Delay hiding to allow transform to apply; but ensure it's not blocking
        setTimeout(() => {
          try {
            sidebar.style.display = "none";
          } catch (_) {}
        }, 150);
      }
    } catch (_) {}
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

      try {
        if (sidebar) {
          sidebar.style.display = ""; // This clears the 'display: none'
          sidebar.style.transform = ""; // This clears the 'transform: translateX'
        }
      } catch (_) {}

      sidebar.classList.add("collapsed");
      body.classList.add("sidebar-collapsed");
      showTooltips();
    }
  });

  links.forEach((link) => {
    link.addEventListener("click", (e) => {
      hideTooltips();
      try {
        // Ensure DistributeResult.html is always loaded fresh (avoid stale cached HTML)
        const hrefRaw = link.getAttribute("href") || "";
        if (hrefRaw && /(^|\/)DistributeResult\.html(\?|$)/i.test(hrefRaw)) {
          // Build absolute URL and append cache-busting param if missing
          const url = new URL(hrefRaw, window.location.href);
          if (!url.searchParams.has("v")) {
            url.searchParams.set("v", String(Date.now()));
            e.preventDefault();
            window.location.href = url.toString();
            return; // stop further handling
          }
        }
      } catch (_) {
        /* ignore */
      }
      if (!isMobile() && sidebar.classList.contains("collapsed")) {
        e.preventDefault();
        sidebar.classList.remove("collapsed");
        body.classList.remove("sidebar-collapsed");
        hideTooltips();
        return;
      }

      // -- REMOVED the click-based 'active' class logic from here --
    });
  });

  // Initial tooltip state
  if (sidebar.classList.contains("collapsed")) {
    showTooltips();
  } else {
    hideTooltips();
  }
});
