(function () {
  try {
    var url = new URL(window.location.href);
    // Ensure a cache-busting param is present so this HTML isn't served stale
    if (!url.searchParams.get("v")) {
      url.searchParams.set("v", String(Date.now()));
      // Use location.replace to avoid history clutter
      window.location.replace(url.toString());
      return; // stop further execution on this old document
    }
    function syncNotifyVisibility() {
      try {
        var container = document.getElementById("resultContainer");
        if (!container) return;
        container
          .querySelectorAll("tbody.dr-recipient[data-rec]")
          .forEach(function (tb) {
            try {
              var rid = tb.getAttribute("data-rec") || "";
              var hasPending = !!tb.querySelector(
                'tr[data-status="pending"]'
              );
              var btn = container.querySelector(
                '.dr-notify-one[data-rec="' + rid + '"]'
              );
              if (!btn) return;
              if (hasPending) btn.classList.remove("d-none");
              else btn.classList.add("d-none");
            } catch (_) {}
          });
      } catch (_) {}
    }
    var hasRun = (url.searchParams.get("run_id") || "").trim() !== "";
    var hasPk = (url.searchParams.get("period_key") || "").trim() !== "";
    var hasIds =
      (url.searchParams.get("recipient_ids") || "").trim() !== "";
    if (!hasRun && !hasPk && !hasIds) {
      var last =
        parseInt(localStorage.getItem("dr_last_run_id") || "0", 10) || 0;
      if (last > 0) {
        url.searchParams.set("run_id", String(last));
        // Update URL without reload; subsequent scripts will read it
        history.replaceState(null, "", url.toString());
      }
    }
  } catch (_) {}
})();

(function () {
  function removeLegacyWeekUI() {
    try {
      var input = document.getElementById("periodKeyInput");
      var btn = document.getElementById("periodKeyGo");
      if (btn) {
        try {
          btn.remove();
        } catch (_) {}
      }
      if (input) {
        // Remove tip near the input if it starts with "Tip:"
        try {
          var parent = input.parentElement;
          if (parent) {
            var sibs = Array.from(parent.querySelectorAll("*"));
            sibs.forEach(function (n) {
              try {
                if ((n.textContent || "").trim().startsWith("Tip:"))
                  n.remove();
              } catch (_) {}
            });
          }
        } catch (_) {}
        try {
          input.remove();
        } catch (_) {}
      }
      // Also remove any row that contains these legacy controls
      try {
        var rows = document.querySelectorAll(".card .row, .row");
        rows.forEach(function (r) {
          try {
            if (
              r.querySelector("#periodKeyInput") ||
              r.querySelector("#periodKeyGo")
            ) {
              r.remove();
            }
          } catch (_) {}
        });
      } catch (_) {}
    } catch (_) {}
  }
  function syncNotifyVisibility() {
    try {
      var container = document.getElementById("resultContainer");
      if (!container) return;
      container
        .querySelectorAll("tbody.dr-recipient[data-rec]")
        .forEach(function (tb) {
          try {
            var rid = tb.getAttribute("data-rec") || "";
            var hasPending = !!tb.querySelector('tr[data-status="pending"]');
            var btn = container.querySelector(
              '.dr-notify-one[data-rec="' + rid + '"]'
            );
            if (!btn) return;
            if (hasPending) btn.classList.remove("d-none");
            else btn.classList.add("d-none");
          } catch (_) {}
        });
    } catch (_) {}
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", removeLegacyWeekUI);
  } else {
    removeLegacyWeekUI();
  }
})();

(function () {
  function syncNotifyVisibility() {
    try {
      var runBtn = document.getElementById("notifyRunBtn");
      var hide = !runBtn || runBtn.classList.contains("d-none");
      var container = document.getElementById("resultContainer");
      if (!container) return;
      container
        .querySelectorAll(".dr-notify-one")
        .forEach(function (btn) {
          if (hide) btn.classList.add("d-none");
          else btn.classList.remove("d-none");
        });
    } catch (_) {}
  }
  function getAPI() {
    return typeof window.API_BASE_URL === "string" && window.API_BASE_URL
      ? window.API_BASE_URL
      : "/php/api";
  }
  function lockRecipientUI(rid) {
    try {
      const container = document.getElementById("resultContainer");
      if (!container) return;
      // Disable inputs in this recipient's table
      const tb = container.querySelector(
        'tbody.dr-recipient[data-rec="' + rid + '"]'
      );
      if (tb) {
        tb.querySelectorAll(".dr-name, .dr-qty").forEach((el) => {
          el.disabled = true;
          el.readOnly = true;
        });
        // Hide delete buttons in this tbody
        tb.querySelectorAll(".dr-del").forEach((btn) => {
          const cell = btn.parentElement;
          if (cell) cell.style.display = "none";
        });
      }
      // Hide Notify button itself
      const notifyBtn = container.querySelector(
        '.dr-notify-one[data-rec="' + rid + '"]'
      );
      if (notifyBtn) {
        notifyBtn.classList.add("d-none");
      }
    } catch (_) {}
  }
  async function notifyOne(rid) {
    try {
      const container = document.getElementById("resultContainer");
      if (!container) return;
      const tb = container.querySelector(
        'tbody.dr-recipient[data-rec="' + rid + '"]'
      );
      let msg = "You have been allocated items.";
      try {
        const parts = [];
        if (tb) {
          tb.querySelectorAll("tr").forEach((tr) => {
            const name =
              tr.querySelector(".dr-name")?.value?.trim() || "";
            const qty = tr.querySelector(".dr-qty")?.value?.trim() || "";
            if (name && qty) {
              parts.push(qty + "x " + name);
            }
          });
        }
        if (parts.length) {
          msg =
            "You have been allocated items. Items: " +
            parts.slice(0, 6).join(", ") +
            (parts.length > 6 ? "…" : "");
        }
      } catch (_) {}
      const API = getAPI();
      const res = await fetch(
        API + "/communications/notifications.php?action=create",
        {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            user_id: rid,
            type: "allocation_ready",
            message: msg,
          }),
        }
      );
      if (!res.ok) throw new Error("HTTP " + res.status);
      // UI lock for this recipient only
      lockRecipientUI(rid);
      // Feedback modal
      try {
        const mEl = document.getElementById("resultAlertModal");
        const bEl = document.getElementById("resultAlertBody");
        if (bEl) bEl.textContent = "Recipient notified and locked.";
        if (mEl && window.bootstrap) {
          window.bootstrap.Modal.getOrCreateInstance(mEl).show();
        }
      } catch (_) {}
    } catch (err) {
      const fb = document.getElementById("resultFeedback");
      if (fb)
        fb.innerHTML =
          '<div class="alert alert-danger py-2 mb-0">Failed to notify recipient.</div>';
    }
  }
  function ensureButtons() {
    try {
      const container = document.getElementById("resultContainer");
      if (!container) return;
      container
        .querySelectorAll("tbody.dr-recipient[data-rec]")
        .forEach((tb) => {
          try {
            const rid =
              parseInt(tb.getAttribute("data-rec") || "0", 10) || 0;
            if (!rid) return;
            // Find header row for this card: go up to parent card div then query its header flex row
            const card = tb.closest("div.mb-3") || tb.closest("div");
            if (!card) return;
            const headerRow = card.querySelector(
              "div.d-flex.align-items-center.justify-content-between.mb-1"
            );
            if (!headerRow) return;
            // Target actions container and append Notify beside existing controls
            const actions = headerRow.querySelector(".d-flex.gap-2");
            if (!actions) {
              setTimeout(() => ensureButtons(), 100);
              return;
            }
            // Dedupe existing buttons for this recipient (keep one, prefer the one under actions)
            const existingAll = container.querySelectorAll(
              `.dr-notify-one[data-rec="${rid}"]`
            );
            if (existingAll.length > 0) {
              // If one already exists under actions, remove others; else move first into actions and remove the rest
              let keep = actions.querySelector(
                `.dr-notify-one[data-rec="${rid}"]`
              );
              if (!keep) {
                keep = existingAll[0];
                try {
                  actions.appendChild(keep);
                } catch (_) {}
              }
              existingAll.forEach((btn) => {
                if (btn !== keep) {
                  try {
                    btn.remove();
                  } catch (_) {}
                }
              });
              return;
            }
            // Create a new button if none exists
            const n = document.createElement("button");
            var runBtn = document.getElementById("notifyRunBtn");
            var hide = !runBtn || runBtn.classList.contains("d-none");
            n.className =
              "btn btn-sm btn-outline-primary dr-notify-one" +
              (hide ? " d-none" : "");
            n.setAttribute("data-rec", String(rid));
            n.innerHTML = '<i class="bi bi-megaphone"></i> Notify';
            n.addEventListener("click", () => notifyOne(rid));
            actions.appendChild(n);
          } catch (_) {}
        });
    } catch (_) {}
  }
  function initInject() {
    try {
      ensureButtons();
      syncNotifyVisibility();
      const container = document.getElementById("resultContainer");
      if (container && window.MutationObserver) {
        const obs = new MutationObserver(() => ensureButtons());
        obs.observe(container, { childList: true, subtree: true });
      }
      // Extra: schedule a couple of retries to cover late async renders on first navigation
      setTimeout(function () {
        ensureButtons();
        syncNotifyVisibility();
      }, 50);
      setTimeout(function () {
        ensureButtons();
        syncNotifyVisibility();
      }, 150);
      // Render-wait loop: poll for cards rendered (via __DR_BYREC__)
      (function waitForRender(maxMs) {
        let waited = 0;
        let delay = 100;
        function tick() {
          try {
            const hasFlag =
              typeof window.__DR_BYREC__ !== "undefined" &&
              Array.isArray(window.__DR_BYREC__);
            if (hasFlag) {
              ensureButtons();
              return;
            }
            waited += delay;
            if (waited >= maxMs) return;
            setTimeout(tick, delay);
            delay = Math.min(800, Math.floor(delay * 1.6));
          } catch (_) {
            /* stop on error */
          }
        }
        tick();
      })(5000);
    } catch (_) {}
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initInject);
  } else {
    initInject();
  }
  // Handle BFCache / back-forward navigation and SPA-like transitions
  try {
    window.addEventListener("pageshow", () =>
      setTimeout(function () {
        ensureButtons();
        syncNotifyVisibility();
      }, 0)
    );
  } catch (_) {}
  try {
    var nb = document.getElementById("notifyRunBtn");
    if (nb) {
      nb.addEventListener("click", function () {
        setTimeout(syncNotifyVisibility, 0);
      });
      if (window.MutationObserver) {
        var ob = new MutationObserver(function () {
          syncNotifyVisibility();
        });
        ob.observe(nb, { attributes: true, attributeFilter: ["class"] });
      }
    }
  } catch (_) {}
})();

(function () {
  function computeWeekBadgeHTML() {
    try {
      var url = new URL(window.location.href);
      var pk = (url.searchParams.get("period_key") || "").trim();
      if (!/^\d{4}-\d{2}-W[1-4]$/i.test(pk)) {
        var rid =
          parseInt(url.searchParams.get("run_id") || "0", 10) || 0;
        var effRunId = rid || window.__DR_RESOLVED_RUN_ID__ || 0;
        if (effRunId) {
          var API_BASE_URL =
            typeof window.API_BASE_URL === "string" && window.API_BASE_URL
              ? window.API_BASE_URL
              : "/php/api";
          // NOTE: synchronous fetch is not available; return a placeholder and let async resolver update later
        }
      }
      var m = /W([1-4])$/i.exec(pk || "");
      if (m) {
        var n = parseInt(m[1], 10) || 1;
        var color =
          n === 1
            ? "primary"
            : n === 2
            ? "danger"
            : n === 3
            ? "warning"
            : "info";
        return (
          " <span class='badge bg-" +
          color +
          " text-uppercase ms-2'>W" +
          n +
          "</span>"
        );
      }
    } catch (_) {}
    return "";
  }
  function applyWeekBadges(badgeHtml) {
    try {
      if (!badgeHtml) return;
      var container = document.getElementById("resultContainer");
      if (!container) return;
      var headers = container.querySelectorAll(".fw-semibold");
      headers.forEach(function (el) {
        try {
          if (el.dataset && el.dataset.weekBadgeApplied === "1") return;
          var html = el.innerHTML || "";
          if (html.indexOf("<span") >= 0) {
            // Insert before the first existing span (before status/error badges)
            el.innerHTML = html.replace(
              /\s*<span/i,
              badgeHtml + " <span"
            );
          } else {
            el.innerHTML = html + badgeHtml;
          }
          if (el.dataset) el.dataset.weekBadgeApplied = "1";
        } catch (_) {}
      });
    } catch (_) {}
  }
  function resolvePeriodKeyAsyncAndApply() {
    try {
      var url = new URL(window.location.href);
      var pk = (url.searchParams.get("period_key") || "").trim();
      var badge = computeWeekBadgeHTML();
      if (badge) {
        applyWeekBadges(badge);
        return;
      }
      var rid = parseInt(url.searchParams.get("run_id") || "0", 10) || 0;
      var effRunId = rid || window.__DR_RESOLVED_RUN_ID__ || 0;
      if (!effRunId) return;
      var API_BASE_URL =
        typeof window.API_BASE_URL === "string" && window.API_BASE_URL
          ? window.API_BASE_URL
          : "/php/api";
      fetch(
        API_BASE_URL +
          "/allocations/index.php?action=list_runs&limit=100&t=" +
          Date.now(),
        {
          credentials: "include",
          headers: { Accept: "application/json" },
        }
      )
        .then(function (r) {
          return r.json().catch(function () {
            return null;
          });
        })
        .then(function (j) {
          try {
            var rows = Array.isArray(j && j.data && j.data.items)
              ? j.data.items
              : [];
            var match = rows.find(function (x) {
              return parseInt(x.run_id, 10) === effRunId;
            });
            var pk2 =
              match && match.period_key ? String(match.period_key) : "";
            if (pk2) {
              var m = /W([1-4])$/i.exec(pk2);
              if (m) {
                var n = parseInt(m[1], 10) || 1;
                var color =
                  n === 1
                    ? "primary"
                    : n === 2
                    ? "danger"
                    : n === 3
                    ? "warning"
                    : "info";
                var b =
                  " <span class='badge bg-" +
                  color +
                  " text-uppercase ms-2'>W" +
                  n +
                  "</span>";
                applyWeekBadges(b);
              }
            }
          } catch (_) {}
        })
        .catch(function () {
          /* ignore */
        });
    } catch (_) {}
  }
  document.addEventListener("DOMContentLoaded", function () {
    try {
      var badge = computeWeekBadgeHTML();
      // Apply once now
      applyWeekBadges(badge);
      // Observe for content rendered by distributeResult.js
      var container = document.getElementById("resultContainer");
      if (container && window.MutationObserver) {
        var obs = new MutationObserver(function () {
          applyWeekBadges(badge);
        });
        obs.observe(container, { childList: true, subtree: true });
      }
      // Also resolve asynchronously via list_runs if needed
      if (!badge) {
        setTimeout(resolvePeriodKeyAsyncAndApply, 0);
      }
    } catch (_) {}
  });
})();
