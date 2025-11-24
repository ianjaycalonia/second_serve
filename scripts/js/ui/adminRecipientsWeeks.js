(function () {
  function formatLongDate(d) {
    try {
      return d.toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "2-digit",
      });
    } catch (_) {
      const months = [
        "January",
        "February",
        "March",
        "April",
        "May",
        "June",
        "July",
        "August",
        "September",
        "October",
        "November",
        "December",
      ];
      const mm = months[d.getMonth()] || "";
      const dd = String(d.getDate()).padStart(2, "0");
      const yyyy = d.getFullYear();
      return `${mm} ${dd}, ${yyyy}`;
    }
  }

  function relabelWeeks() {
    try {
      const now = new Date();
      const y = now.getFullYear(),
        m = now.getMonth();
      const starts = [
        new Date(y, m, 1),
        new Date(y, m, 8),
        new Date(y, m, 15),
        new Date(y, m, 22),
      ];
      const ids = ["w1Label", "w2Label", "w3Label", "w4Label"];
      ids.forEach((id, i) => {
        const el = document.getElementById(id);
        if (!el) return;
        const dt = starts[i] || new Date();
        el.textContent = `Week ${i + 1} (${formatLongDate(dt)})`;
      });
      ["w1", "w2", "w3", "w4"].forEach((id, i) => {
        const dz = document.getElementById(id);
        if (!dz) return;
        const dt = starts[i] || new Date();
        dz.setAttribute(
          "aria-label",
          `Week ${i + 1} assignments (${formatLongDate(dt)})`
        );
      });
      [
        ["saveW1", 0],
        ["saveW2", 1],
        ["saveW3", 2],
        ["saveW4", 3],
      ].forEach(([id, idx]) => {
        const b = document.getElementById(id);
        if (!b) return;
        const dt = starts[idx] || new Date();
        const title = `Save Week ${idx + 1} (${formatLongDate(dt)})`;
        b.setAttribute("title", title);
        b.setAttribute("data-bs-original-title", title);
      });
      try {
        if (window.__rl_updateCounts) window.__rl_updateCounts();
      } catch (_) {}
      const w5Col = document.getElementById("w5Col");
      if (w5Col && w5Col.style.display !== "none") {
        const w5Label = document.getElementById("w5Label");
        if (w5Label) {
          const w5Start = new Date(y, m, 29);
          w5Label.textContent = `Week 5 (${formatLongDate(w5Start)})`;
          try {
            if (window.__rl_updateCounts) window.__rl_updateCounts();
          } catch (_) {}
        }
      }
    } catch (_) {}
  }

  function debounce(fn, ms) {
    let t;
    return function () {
      clearTimeout(t);
      t = setTimeout(fn, ms);
    };
  }

  function setupObserver() {
    try {
      const target = document.getElementById("weeksRow");
      if (!target) return;
      const run = debounce(relabelWeeks, 50);
      const obs = new MutationObserver(run);
      obs.observe(target, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
      });
      // Initial relabel and a delayed one after async loads
      relabelWeeks();
      setTimeout(() => {
        try {
          relabelWeeks();
          if (window.__rl_updateCounts) window.__rl_updateCounts();
        } catch (_) {}
      }, 150);
    } catch (_) {
      relabelWeeks();
    }
  }

  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", setupObserver);
  else setupObserver();
})();
