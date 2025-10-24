// Close other open Bootstrap dropdowns when a dropdown is opened
(function () {
  // No global dependencies required other than Bootstrap's JS
  document.addEventListener("DOMContentLoaded", function () {
    function closeOtherDropdowns(openingDropdown) {
      try {
        // First, close any toggles that are currently expanded (aria-expanded="true").
        // This is the most reliable way to identify open dropdowns even when
        // dropdown-menu elements are relocated (appended to body).
        const openToggles = Array.from(
          document.querySelectorAll(
            '[data-bs-toggle="dropdown"][aria-expanded="true"]'
          )
        );

        openToggles.forEach(function (toggle) {
          if (!toggle) return;

          // If this toggle belongs to the openingDropdown, skip it
          const parent = toggle.closest && toggle.closest(".dropdown");
          if (
            openingDropdown &&
            (toggle === openingDropdown ||
              parent === openingDropdown ||
              openingDropdown.contains(toggle))
          )
            return;

          try {
            if (window.bootstrap && bootstrap.Dropdown) {
              const inst =
                bootstrap.Dropdown.getInstance(toggle) ||
                bootstrap.Dropdown.getOrCreateInstance(toggle);
              if (inst && typeof inst.hide === "function") inst.hide();
              else {
                toggle.setAttribute("aria-expanded", "false");
                const dd = toggle.closest(".dropdown");
                if (dd) dd.classList.remove("show");
                const menu = dd && dd.querySelector(".dropdown-menu");
                if (menu) menu.classList.remove("show");
              }
            }
          } catch (e) {
            // ignore per-toggle errors
          }
        });

        // Second, close any dropdown menus that show but do not have an expanded toggle
        // (covers edge cases where menus are appended to body or aria isn't updated yet).
        const openMenus = Array.from(
          document.querySelectorAll(".dropdown-menu.show")
        );
        openMenus.forEach(function (menu) {
          try {
            const parent = menu.closest(".dropdown");
            if (
              openingDropdown &&
              (menu === openingDropdown ||
                parent === openingDropdown ||
                (openingDropdown.contains && openingDropdown.contains(menu)))
            )
              return;

            const toggle =
              parent && parent.querySelector('[data-bs-toggle="dropdown"]');
            if (toggle && window.bootstrap && bootstrap.Dropdown) {
              const inst =
                bootstrap.Dropdown.getInstance(toggle) ||
                bootstrap.Dropdown.getOrCreateInstance(toggle);
              if (inst && typeof inst.hide === "function") {
                inst.hide();
                return;
              }
            }

            // fallback: remove show classes from menu and its parent wrapper
            menu.classList.remove("show");
            if (parent) parent.classList.remove("show");
          } catch (e) {
            // ignore per-menu errors
          }
        });
      } catch (e) {
        // defensive
      }
    }

    // Primary: when a dropdown is about to show (Bootstrap event)
    document.addEventListener(
      "show.bs.dropdown",
      function (ev) {
        try {
          const openingDropdown = ev.target;
          closeOtherDropdowns(openingDropdown);
        } catch (e) {
          // swallow
        }
      },
      true
    );

    // Fallback: handle clicks on dropdown toggles (capture phase) to ensure
    // other open dropdowns close when a toggle is clicked. This covers cases
    // where the Bootstrap event timing or custom markup prevents the handler
    // from seeing .dropdown.show elements yet.
    document.addEventListener(
      "click",
      function (ev) {
        try {
          const toggle =
            ev.target.closest &&
            ev.target.closest('[data-bs-toggle="dropdown"]');
          if (!toggle) return;
          const openingDropdown = toggle.closest && toggle.closest(".dropdown");
          closeOtherDropdowns(openingDropdown);
        } catch (e) {
          // swallow
        }
      },
      true
    );
  });
})();
