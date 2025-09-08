document.addEventListener("DOMContentLoaded", () => {
  const body = document.body;
  const sidebar = document.querySelector("aside");
  const toggleBtn = document.getElementById("sidebarToggle");
  const backdrop = document.querySelector(".sidebar-backdrop");
  const links = document.querySelectorAll("aside .nav-link");
  const isMobile = () => window.matchMedia("(max-width: 768px)").matches;

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
