document.addEventListener("DOMContentLoaded", () => {
  const body = document.body;
  const sidebar = document.querySelector("aside");
  const toggleBtn = document.getElementById("sidebarToggle");
  const backdrop = document.querySelector(".sidebar-backdrop");
  const links = document.querySelectorAll("aside .nav-link");

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
        if (body.classList.contains("sidebar-open")) {
          closeSidebar();
        } else {
          openSidebar();
        }
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

  // Optional: expand sidebar when icon clicked (desktop only)
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
});

const ctx = document.getElementById("lineChart").getContext("2d");
const chart = new Chart(ctx, {
  type: "line",
  data: {
    labels: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
    datasets: [
      {
        label: "Pickups",
        data: [2, 5, 1, 4, 7, 6, 4],
        borderColor: "#00a0b0",
        backgroundColor: "rgba(0, 160, 176, 0.2)",
        tension: 0.4,
        fill: true,
        pointRadius: 5,
        pointHoverRadius: 7,
      },
    ],
  },
  options: {
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      y: {
        beginAtZero: true,
      },
    },
  },
});
