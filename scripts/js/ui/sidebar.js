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
  const toggleBtn = document.getElementById("sidebarToggle");
  const backdrop = document.querySelector(".sidebar-backdrop");
  const isMobile = () => window.matchMedia("(max-width: 768px)").matches;

  // --- MOBILE & DESKTOP FIX FOR SIDEBAR ---
  if (sidebar) {
    // Mobile fix on page load
    if (isMobile()) {
      sidebar.classList.remove("collapsed");
      body.classList.remove("sidebar-collapsed");
      sidebar.querySelectorAll(".sidebar-text").forEach((el) => {
        el.style.display = "inline";
      });
      sidebar.style.transform = "translateX(-100%)";
      sidebar.style.display = "none";
    } else {
      // Desktop fix on page load
      sidebar.classList.add("collapsed");
      body.classList.add("sidebar-collapsed");
      sidebar.querySelectorAll(".sidebar-text").forEach((el) => {
        el.style.display = "none";
      });
    }

    // Resize listener
    window.addEventListener("resize", () => {
      if (isMobile()) {
        closeSidebar();
        sidebar.classList.remove("collapsed");
        body.classList.remove("sidebar-collapsed");
        sidebar.querySelectorAll(".sidebar-text").forEach((el) => {
          el.style.display = "inline";
        });
        hideTooltips();
     } else {
        closeSidebar();
        sidebar.style.display = "block"; 
        sidebar.style.transform = "";    

        sidebar.classList.add("collapsed");
        body.classList.add("sidebar-collapsed");

        // Restore text display and spacing
        sidebar.querySelectorAll(".sidebar-text").forEach((el) => {
          el.style.removeProperty("display");
        });
       sidebar.querySelectorAll(".dashboard-link").forEach((link) => {
      if (isMobile()) {
        link.style.gap = "10px"; // always 10px on mobile
      } else {
        const collapsed = sidebar.classList.contains("collapsed");
        link.style.gap = collapsed ? "0" : "10px"; // restore gap based on collapsed state
      }
    });
        showTooltips();
      }

    });
  }

  // Harden initial state: ensure backdrop is hidden and body not marked open
try {
  if (backdrop) backdrop.style.display = "none";  // hide it by default
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

  // --- Set active link based on current page URL ---
  try {
    const currentPage = window.location.pathname.split("/").pop();
    if (currentPage) {
      links.forEach((link) => {
        const linkHref = link.getAttribute("href");
        if (linkHref) {
          const linkPage = linkHref.split("/").pop().split("?")[0];
          if (linkPage === currentPage) {
            link.classList.add("active");
          } else {
            link.classList.remove("active");
          }
        }
      });
    }
  } catch (err) {
    console.error("Error setting active sidebar link:", err);
  }

  // --- Tooltip initialization and show/hide functions ---
  function initSidebarTooltips() {
    try {
      if (Array.isArray(window.__sidebar_tooltips)) {
        window.__sidebar_tooltips.forEach((inst) => {
          try { inst.dispose(); } catch (_) {}
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
      if (!window.__sidebar_tt_bound) {
        window.__sidebar_tt_bound = true;
        const hideAll = () => {
          try {
            (window.__sidebar_tooltips || []).forEach((t) => { try { t.hide(); } catch (_) {} });
          } catch (_) {}
        };
        document.addEventListener("click", hideAll, true);
        document.addEventListener("scroll", hideAll, true);
        document.addEventListener("shown.bs.modal", hideAll);
        document.addEventListener("hide.bs.modal", hideAll);
        document.addEventListener("show.bs.tooltip", (ev) => {
          try {
            (window.__sidebar_tooltips || []).forEach((t) => { if (t._element !== ev.target) t.hide(); });
          } catch (_) {}
        });
        try { sidebar?.addEventListener("mouseleave", hideAll); } catch (_) {}
        window.addEventListener("beforeunload", () => {
          try { (window.__sidebar_tooltips || []).forEach((t) => { t.dispose(); }); } catch (_) {}
          window.__sidebar_tooltips = [];
        });
      }
    } catch (_) {}
  }

  function showTooltips() {
    initSidebarTooltips();
    (window.__sidebar_tooltips || []).forEach((t) => { try { t.enable(); } catch (_) {} });
  }

  function hideTooltips() {
    (window.__sidebar_tooltips || []).forEach((t) => { try { t.hide(); t.disable(); } catch (_) {} });
  }

  // --- Sidebar open/close for mobile ---
  function openSidebar() {
    body.classList.add("sidebar-open");
    try {
      if (backdrop) backdrop.style.display = "none";
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
        setTimeout(() => { try { sidebar.style.display = "none"; } catch (_) {} }, 150);
      }
    } catch (_) {}
    hideTooltips();
  }

  // --- Toggle button ---
 if (toggleBtn) {
  toggleBtn.addEventListener("click", () => {
    const isMobile = window.innerWidth <= 768;

    if (isMobile) {
  // MOBILE TOGGLE
  if (sidebar.style.display === "none" || sidebar.style.display === "") {
    sidebar.style.display = "block";
    sidebar.style.transform = "translateX(0)";
    if (backdrop) backdrop.style.display = "block"; // show gray overlay only on toggle
  } else {
    sidebar.style.transform = "translateX(-100%)";
    if (backdrop) backdrop.style.display = "none"; // hide gray overlay
    setTimeout(() => {
      sidebar.style.display = "none";
    }, 300);
  }

    } else {
      // DESKTOP TOGGLE
      // DESKTOP TOGGLE
      const collapsed = sidebar.classList.toggle("collapsed");
      body.classList.toggle("sidebar-collapsed");

      // Restore text and spacing
      sidebar.querySelectorAll(".sidebar-text").forEach((el) => {
        el.style.removeProperty("display");
      });
     sidebar.querySelectorAll(".dashboard-link").forEach((link) => {
  link.style.gap = sidebar.classList.contains("collapsed") ? "0" : "10px";
});
      // Tooltips
      if (collapsed) showTooltips();
      else hideTooltips();
    }
  });
}
  if (backdrop) {
  backdrop.addEventListener("click", () => {
    closeSidebar();
    if (backdrop) backdrop.style.display = "none"; // hide gray overlay
  });
}


  // --- Click links ---
  links.forEach((link) => {
    link.addEventListener("click", (e) => {
      hideTooltips();
      try {
        const hrefRaw = link.getAttribute("href") || "";
        if (hrefRaw && /(^|\/)DistributeResult\.html(\?|$)/i.test(hrefRaw)) {
          const url = new URL(hrefRaw, window.location.href);
          if (!url.searchParams.has("v")) {
            url.searchParams.set("v", String(Date.now()));
            e.preventDefault();
            window.location.href = url.toString();
            return;
          }
        }
      } catch (_) {}
      if (!isMobile() && sidebar.classList.contains("collapsed")) {
        e.preventDefault();
        sidebar.classList.remove("collapsed");
        body.classList.remove("sidebar-collapsed");

        // Reset sidebar text display and spacing
        sidebar.querySelectorAll(".sidebar-text").forEach((el) => {
          el.style.removeProperty("display");
        });
        sidebar.querySelectorAll(".dashboard-link").forEach((link) => {
          link.style.gap = sidebar.classList.contains("collapsed") ? "0" : "10px";
        });
        hideTooltips();
        return;
      }
    });
  });

  // Initial tooltip state
  if (sidebar.classList.contains("collapsed")) showTooltips();
  else hideTooltips();
});
