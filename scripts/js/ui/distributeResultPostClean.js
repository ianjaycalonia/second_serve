(function () {
  function fmtMDY(d) {
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const yyyy = d.getFullYear();
    return mm + "-" + dd + "-" + yyyy;
  }
  function computeRangeFromPeriodKey(pk) {
    // pk: YYYY-MM-Wn, fixed buckets: 1-7, 8-14, 15-21, 22-end
    try {
      const m = /^(\d{4})-(\d{2})-W([1-4])$/i.exec(String(pk || ""));
      if (!m) return null;
      const y = parseInt(m[1], 10),
        mo = parseInt(m[2], 10) - 1,
        w = parseInt(m[3], 10);
      const startDay = w === 1 ? 1 : w === 2 ? 8 : w === 3 ? 15 : 22;
      const start = new Date(y, mo, startDay);
      start.setHours(0, 0, 0, 0);
      const end = new Date(y, mo + 1, 0); // last day of month
      const endDay =
        w === 1 ? 7 : w === 2 ? 14 : w === 3 ? 21 : end.getDate();
      const endDate = new Date(y, mo, endDay);
      endDate.setHours(0, 0, 0, 0);
      return { start: start, end: endDate };
    } catch (_) {
      return null;
    }
  }
  function getAPI() {
    return typeof window.API_BASE_URL === "string" && window.API_BASE_URL
      ? window.API_BASE_URL
      : "/php/api";
  }
  function resolvedRunId() {
    try {
      const u = new URL(location.href);
      const rid = parseInt(u.searchParams.get("run_id") || "0", 10) || 0;
      return rid || window.__DR_RESOLVED_RUN_ID__ || 0;
    } catch (_) {
      return window.__DR_RESOLVED_RUN_ID__ || 0;
    }
  }

  document.addEventListener("DOMContentLoaded", function () {
    try {
      // Week Select2 (AJAX via list_runs), formats label with MM-DD-YYYY
      if (window.jQuery && jQuery.fn.select2) {
        const $week = jQuery("#drWeekSelect");
        $week
          .select2({
            theme: "bootstrap-5",
            placeholder: "Search run…",
            allowClear: true,
            ajax: {
              transport: function (params, success, failure) {
                const API = getAPI();
                const url =
                  API +
                  "/allocations/index.php?action=list_runs&limit=50&t=" +
                  Date.now();
                fetch(url, {
                  credentials: "include",
                  headers: { Accept: "application/json" },
                })
                  .then((r) => r.json())
                  .then((j) => success(j))
                  .catch(failure);
              },
              processResults: function (data) {
                const rows = Array.isArray(data?.data?.items)
                  ? data.data.items
                  : [];
                const out = rows.map((r) => {
                  const pk = String(r.period_key || "");
                  const range = computeRangeFromPeriodKey(pk);
                  const rid = parseInt(r.run_id || 0, 10) || 0;
                  const labelCore = range
                    ? pk +
                      " • " +
                      fmtMDY(range.start) +
                      " to " +
                      fmtMDY(range.end)
                    : pk;
                  const label =
                    (rid ? "Run #" + rid + " • " : "") + labelCore;
                  return { id: rid || pk, text: label, pk, rid };
                });
                return { results: out };
              },
            },
            width: "resolve",
          })
          .on("select2:select", function (e) {
            try {
              const data = e.params.data;
              const rid = parseInt(data?.rid || data?.id || 0, 10) || 0;
              if (rid) {
                const url = new URL(location.href);
                url.searchParams.set("run_id", String(rid));
                url.searchParams.delete("period_key");
                location.href = url.toString();
              } else if (data?.pk) {
                // Fallback: if no run_id, use period_key path
                const pk = data.pk;
                const inp = document.getElementById("periodKeyInput");
                if (inp) inp.value = pk;
                const btn = document.getElementById("periodKeyGo");
                if (btn) btn.click();
              }
            } catch (_) {}
          });

        // Removed top-bar single-recipient controls; per-recipient Notify button remains injected below
      }
    } catch (_) {}
  });
})();

(function () {
  try {
    // Give distributeResult.js a tick to set window.__DR_RESOLVED_RUN_ID__
    setTimeout(function () {
      try {
        var url = new URL(window.location.href);
        var rid =
          parseInt(url.searchParams.get("run_id") || "0", 10) || 0;
        var eff = rid || window.__DR_RESOLVED_RUN_ID__ || 0;
        if (eff > 0) {
          localStorage.setItem("dr_last_run_id", String(eff));
        }
      } catch (_) {}
    }, 0);
  } catch (_) {}
})();

(function () {
  document.addEventListener("DOMContentLoaded", function () {
    try {
      var btn = document.getElementById("notifyRunBtn");
      if (!btn) return;
      // Ensure visible and clickable
      btn.classList.remove("d-none");
      btn.disabled = false;
      // Add a capturing handler to bypass any internal isLocked gating
      btn.addEventListener(
        "click",
        async function (e) {
          try {
            e.stopImmediatePropagation();
            e.preventDefault();
            var API_BASE_URL =
              typeof window.API_BASE_URL === "string" && window.API_BASE_URL
                ? window.API_BASE_URL
                : "/php/api";
            var url = new URL(window.location.href);
            var runIdRaw = (url.searchParams.get("run_id") || "").trim();
            var runId = parseInt(runIdRaw || "0", 10) || 0;
            if (!runId) runId = window.__DR_RESOLVED_RUN_ID__ || 0;
            if (!runId) {
              var fb = document.getElementById("resultFeedback");
              if (fb)
                fb.innerHTML =
                  '<div class="alert alert-danger py-2 mb-0">Run not resolved. Load by week (Wxx) first.</div>';
              return;
            }
            // Build recipient_ids to notify: Pending/Allocated/Updated only; exclude Cancelled
            var byRec = Array.isArray(window.__DR_BYREC__)
              ? window.__DR_BYREC__
              : [];
            var recipientsToNotify = byRec
              .filter(function (r) {
                return Array.isArray(r.items);
              })
              .filter(function (r) {
                return r.items.some(function (a) {
                  var s = String(a.status || "").toLowerCase();
                  return (
                    s !== "cancelled" &&
                    (s === "pending" ||
                      s === "allocated" ||
                      s === "updated")
                  );
                });
              })
              .map(function (r) {
                return parseInt(r.rid, 10) || 0;
              })
              .filter(function (n) {
                return Number.isFinite(n) && n > 0;
              });
            var payload = { run_id: runId };
            if (recipientsToNotify.length)
              payload.recipient_ids = recipientsToNotify;
            var res = await fetch(
              API_BASE_URL + "/allocations/index.php?action=notify_run",
              {
                method: "POST",
                credentials: "include",
                headers: {
                  "Content-Type": "application/json",
                  Accept: "application/json",
                },
                body: JSON.stringify(payload),
              }
            );
            var j = null;
            try {
              j = await res.json();
            } catch (_) {}
            if (res.ok && j && j.success) {
              try {
                // Hide the button and disable it
                btn.classList.add("d-none");
                btn.disabled = true;
                // Use the client-side helper to send per-recipient notifications,
                // update UI immediately, and persist per recipient.
                if (
                  window &&
                  typeof window.sendNotificationsForRun === "function"
                ) {
                  // Fire-and-forget; it shows a summary toast when done
                  try {
                    window.sendNotificationsForRun();
                  } catch (_) {}
                } else {
                  // Fallback: show a simple toast
                  try {
                    if (window.showToast)
                      showToast("Recipients notified.", "success");
                  } catch (_) {}
                }
              } catch (_) {}
            } else {
              var fb2 = document.getElementById("resultFeedback");
              if (fb2)
                fb2.innerHTML =
                  '<div class="alert alert-danger py-2 mb-0">' +
                  (j && j.error ? j.error : "HTTP " + res.status) +
                  "</div>";
            }
          } catch (err) {
            var fb3 = document.getElementById("resultFeedback");
            if (fb3)
              fb3.innerHTML =
                '<div class="alert alert-danger py-2 mb-0">Failed to notify.</div>';
          }
        },
        true
      );
    } catch (_) {}
  });
})();
