(function () {
  "use strict";

  // Lightweight debug: confirm script load
  try {
    console.debug("[receivedItems] script loaded");
  } catch (_) {}

  const AUTO_REFRESH_INTERVAL_MS = 15000;

  // Derive API base URL similar to other scripts
  const API_BASE_URL =
    typeof window.API_BASE_URL === "string" && window.API_BASE_URL
      ? window.API_BASE_URL
      : (function () {
          try {
            const url = new URL("./", window.location.href);
          } catch (_) {}
          return "/php/api";
        })();

  function getStoredUser() {
    try {
      const s = sessionStorage.getItem("user");
      const user = s ? JSON.parse(s) : null;
      try {
        console.debug("[receivedItems] getStoredUser:", user);
      } catch (_) {}
      return user;
    } catch (e) {
      try {
        console.error("[receivedItems] getStoredUser error:", e);
      } catch (_) {}
      return null;
    }
  }

  function qs(sel, root = document) {
    return root.querySelector(sel);
  }

  function fmtDate(iso) {
    const d = new Date(iso);
    return isNaN(d) ? iso || "" : d.toLocaleString();
  }

  function getQueryParam(name) {
    try {
      const u = new URL(window.location.href);
      const param = u.searchParams.get(name);
      try {
        console.debug("[receivedItems] getQueryParam", name, "=", param);
      } catch (_) {}
      return param;
    } catch (e) {
      try {
        console.error("[receivedItems] getQueryParam error:", e);
      } catch (_) {}
      return null;
    }
  }

  async function fetchJson(url, opts = {}) {
    try {
      console.debug("[receivedItems] fetchJson called:", url, opts);
    } catch (_) {}
    const res = await fetch(url, opts);
    const ct = (res.headers.get("content-type") || "").toLowerCase();
    // Try to parse JSON regardless of header correctness
    let bodyText = null;
    let json = null;
    if (ct.includes("application/json")) {
      json = await res.json().catch(() => null);
    } else {
      bodyText = await res.text();
      try {
        json = JSON.parse(bodyText);
      } catch (_) {
        json = null;
      }
    }
    if (!json) {
      const err = new Error(bodyText || `HTTP ${res.status}`);
      err.status = res.status;
      try {
        console.error("[receivedItems] fetchJson parse error:", {
          url,
          status: res.status,
          contentType: ct,
          bodyText,
        });
      } catch (_) {}
      throw err;
    }
    if (!res.ok || json.success === false) {
      const msg = json && json.error ? json.error : `HTTP ${res.status}`;
      const err = new Error(msg);
      err.status = res.status;
      try {
        console.error("[receivedItems] fetchJson API error:", {
          url,
          status: res.status,
          json,
        });
      } catch (_) {}
      throw err;
    }
    try {
      console.debug("[receivedItems] fetchJson success:", {
        url,
        response: json,
      });
    } catch (_) {}
    return json;
  }

  // Show a banner temporarily (only once) and hide after timeout.
  function showTemporaryBanner(bannerEl, msg, className, timeoutMs) {
    if (!bannerEl) return;
    try {
      bannerEl.className = className || "alert alert-info py-2";
      bannerEl.textContent = msg || "";
      bannerEl.style.display = "";
      // Clear any existing timer
      if (bannerEl._riTimer) {
        clearTimeout(bannerEl._riTimer);
        bannerEl._riTimer = null;
      }
      if (timeoutMs && Number.isFinite(timeoutMs) && timeoutMs > 0) {
        bannerEl._riTimer = setTimeout(() => {
          try {
            bannerEl.style.display = "none";
            bannerEl.textContent = "";
          } catch (_) {}
          bannerEl._riTimer = null;
        }, timeoutMs);
      }
    } catch (e) {
      try {
        console.error("[receivedItems] showTemporaryBanner error", e);
      } catch (_) {}
    }
  }

  // Track allocation IDs we've already shown the banner for across this browser session
  const SEEN_ALLOCATIONS_KEY = "riSeenAllocations_v1";
  function loadSeenAllocationIds() {
    try {
      const s = sessionStorage.getItem(SEEN_ALLOCATIONS_KEY);
      if (!s) return new Set();
      const arr = JSON.parse(s);
      if (!Array.isArray(arr)) return new Set();
      return new Set(arr.map((n) => Number(n)).filter(Number.isFinite));
    } catch (e) {
      try {
        console.error("[receivedItems] loadSeenAllocationIds error", e);
      } catch (_) {}
      return new Set();
    }
  }
  function saveSeenAllocationIds(set) {
    try {
      sessionStorage.setItem(
        SEEN_ALLOCATIONS_KEY,
        JSON.stringify(Array.from(set))
      );
    } catch (e) {
      try {
        console.error("[receivedItems] saveSeenAllocationIds error", e);
      } catch (_) {}
    }
  }
  const seenAllocationIds = loadSeenAllocationIds();

  let refreshInFlight = false;
  let refreshQueued = false;
  let refreshPromise = null;
  let autoRefreshTimer = null;

  // Refresh allocation data from server
  function scheduleAutoRefresh(){
    if (autoRefreshTimer) {
      clearTimeout(autoRefreshTimer);
      autoRefreshTimer = null;
    }
    autoRefreshTimer = setTimeout(async () => {
      autoRefreshTimer = null;
      if (document.hidden) {
        scheduleAutoRefresh();
        return;
      }
      try {
        await refreshAllocations();
      } catch (err) {
        try {
          console.error("[receivedItems] auto-refresh failed", err);
        } catch (_) {}
      }
    }, AUTO_REFRESH_INTERVAL_MS);
  }

  function stopAutoRefresh(){
    if (autoRefreshTimer) {
      clearTimeout(autoRefreshTimer);
      autoRefreshTimer = null;
    }
  }

  async function refreshAllocations() {
    stopAutoRefresh();
    if (refreshInFlight) {
      refreshQueued = true;
      return refreshPromise;
    }

    refreshInFlight = true;
    refreshQueued = false;
    const tbody = qs("main table tbody");
    const main = document.querySelector("main");
    let banner = document.getElementById("riFeedback");

    const runRefresh = (async () => {
      try {
      console.debug("[receivedItems] refreshAllocations: starting");
    } catch (_) {}
    try {
      console.debug(
        "[receivedItems] refreshAllocations: tbody exists:",
        !!tbody
      );
    } catch (_) {}
    try {
      console.debug("[receivedItems] refreshAllocations: main exists:", !!main);
    } catch (_) {}
    try {
      console.debug(
        "[receivedItems] refreshAllocations: banner exists:",
        !!banner
      );
    } catch (_) {}

    if (!banner && main) {
      banner = document.createElement("div");
      banner.id = "riFeedback";
      banner.className = "alert alert-info py-2";
      banner.style.marginTop = "0.5rem";
      // Start hidden; only show when we have a non-empty message
      banner.style.display = "none";
      banner.textContent = "";
      main.insertBefore(banner, main.firstChild);
    }
    if (!tbody) {
      try {
        console.error("[receivedItems] refreshAllocations: no tbody found");
      } catch (_) {}
      refreshInFlight = false;
      refreshPromise = null;
      if (refreshQueued) {
        refreshQueued = false;
        refreshAllocations();
      }
      return;
    }

    try {
      const user = getStoredUser();
      const role = user && user.role ? String(user.role).toLowerCase() : "";
      const recipientIdParam = getQueryParam("recipient_id");
      const rid =
        role === "admin" && recipientIdParam ? Number(recipientIdParam) : null;

      let items = [];
      const runIdParam = getQueryParam("run_id");
      let runIdFilter = runIdParam ? Number(runIdParam) : null;

      // Prefer AllocationsAPI if available; fallback to existing fetchJson
      if (
        window.AllocationsAPI &&
        typeof window.AllocationsAPI.listByRecipient === "function"
      ) {
        try {
          try {
            console.debug(
              "[receivedItems] Using AllocationsAPI.listByRecipient",
              { rid }
            );
          } catch (_) {}
          items = await window.AllocationsAPI.listByRecipient(rid || undefined);
        } catch (e) {
          try {
            console.warn(
              "[receivedItems] AllocationsAPI.listByRecipient failed, falling back",
              e
            );
          } catch (_) {}
        }
      }
      if (!Array.isArray(items) || items.length === 0) {
        const ridQuery = rid
          ? `&recipient_id=${encodeURIComponent(String(rid))}`
          : "";
        const url = `${API_BASE_URL}/allocations/index.php?action=list_by_recipient${ridQuery}&t=${Date.now()}`;
        try {
          console.debug(
            "[receivedItems] refreshAllocations: API URL (fallback):",
            url
          );
        } catch (_) {}
        const j = await fetchJson(url, {
          credentials: "include",
          headers: { Accept: "application/json" },
        });
        items = Array.isArray(j?.data?.items) ? j.data.items : [];
      }

      // If no explicit run in URL and user is admin, resolve the latest run; recipients skip this to avoid 403 noise
      if (!runIdFilter) {
        const user = getStoredUser();
        const role = user && user.role ? String(user.role).toLowerCase() : "";
        if (role === "admin") {
          try {
            const latest = await fetchJson(
              `${API_BASE_URL}/allocations/index.php?action=latest_run&t=${Date.now()}`,
              { credentials: "include", headers: { Accept: "application/json" } }
            );
            const r = latest?.data || latest;
            const ridVal = Number(r?.run_id || 0);
            if (Number.isFinite(ridVal) && ridVal > 0) {
              runIdFilter = ridVal;
            }
          } catch (_) {
            // ignore if endpoint restricted
          }
        }
      }

      // Determine the effective run to display
      if (!runIdFilter && Array.isArray(items) && items.length) {
        const runIds = items
          .map((a) => Number(a.run_id || 0))
          .filter((n) => Number.isFinite(n) && n > 0);
        if (runIds.length) {
          runIdFilter = Math.max.apply(null, runIds);
        }
      }
      // Filter items to the effective run to prevent mismatch with admin run
      if (runIdFilter && Array.isArray(items) && items.length) {
        items = items.filter((a) => Number(a.run_id || 0) === runIdFilter);
      }

      try {
        console.debug(
          "[receivedItems] refreshAllocations: items count:",
          items.length
        );
      } catch (_) {}
      try {
        console.debug("[receivedItems] refreshAllocations: items:", items);
      } catch (_) {}

      // Rebuild the table with fresh data
      const rowsHtml = items
        .map((a, idx) => {
          const id = Number(a.allocation_id);
          const runId = Number(a.run_id || 0);
          const status = String(a.status || "Allocated");

          const createdAt = a.created_at ? fmtDate(a.created_at) : "";
          const pickupAt = a.scheduled_pickup_at
            ? fmtDate(a.scheduled_pickup_at)
            : "";
          const chevron = "bi-chevron-up";
          const itemsHtml = (Array.isArray(a.items) ? a.items : [])
            .map((it) => `• ${escapeHtml(`${it.quantity}x ${it.item_name}`)}`)
            .join("<br/>");
          let actionsHtml = "";
          if (status.toLowerCase() === "allocated") {
            actionsHtml = `
            <button type="button" class="btn btn-sm btn-outline-success btn-ack" data-bs-toggle="tooltip" data-bs-placement="top" title="Acknowledge" aria-label="Acknowledge">
              <i class="bi bi-check2-circle"></i>
            </button>
            <button type="button" class="btn btn-sm btn-outline-danger btn-cancel" data-bs-toggle="tooltip" data-bs-placement="top" title="Cancel" aria-label="Cancel">
              <i class="bi bi-x-circle"></i>
            </button>`;
          } else if (
            status.toLowerCase() === "notified" ||
            status.toLowerCase() === "updated"
          ) {
            actionsHtml = `
            <button type="button" class="btn btn-sm btn-outline-success btn-ack" data-bs-toggle="tooltip" data-bs-placement="top" title="Acknowledge" aria-label="Acknowledge">
              <i class="bi bi-check2-circle"></i>
            </button>
            <button type="button" class="btn btn-sm btn-outline-danger btn-cancel" data-bs-toggle="tooltip" data-bs-placement="top" title="Cancel" aria-label="Cancel">
              <i class="bi bi-x-circle"></i>
            </button>`;
          } else if (status.toLowerCase() === "acknowledged") {
            actionsHtml = `
            <button type="button" class="btn btn-sm btn-outline-danger btn-cancel" data-bs-toggle="tooltip" data-bs-placement="top" title="Cancel" aria-label="Cancel">
              <i class="bi bi-x-circle"></i>
            </button>`;
          } else if (
            status.toLowerCase() === "scheduled" ||
            status.toLowerCase() === "picked up"
          ) {
            actionsHtml = `
            <button type="button" class="btn btn-sm btn-outline-success btn-complete" data-bs-toggle="tooltip" data-bs-placement="top" title="Complete" aria-label="Complete">
              <i class="bi bi-check2-circle"></i>
            </button>
            <span class="text-muted">&nbsp;</span>`;
          } else if (
            status.toLowerCase() === "completed" ||
            status.toLowerCase() === "cancelled"
          ) {
            actionsHtml = `<span class="text-muted">No actions</span>`;
          } else {
            actionsHtml = `<span class="text-muted">No actions</span>`;
          }
          return `
          <tr data-aid="${id}" data-run-id="${runId}">
            <td>${createdAt}</td>
            <td>
              <button class="btn btn-sm btn-outline-secondary alloc-toggle" type="button" aria-expanded="false" aria-label="View items">
                <i class="bi ${chevron}"></i>
              </button>
              <div class="d-inline-block ms-2 align-middle items-inline d-none">${itemsHtml}</div>
            </td>
            <td>
              <span class="badge ${statusBadgeClass(status)}">${escapeHtml(
            status
          )}</span>
            </td>
            <td>${pickupAt}</td>
            <td class="d-flex justify-content-center align-items-center gap-2">
              ${actionsHtml}
            </td>
          </tr>`;
        })
        .join("");
      tbody.innerHTML = rowsHtml;

      try {
        console.debug(
          "[receivedItems] refreshAllocations: HTML generated, length:",
          rowsHtml.length
        );
      } catch (_) {}

      // Update banner: only show when we have meaningful text
      if (banner) {
        if (items.length > 0) {
          // Determine allocation IDs present now
          const currentIds = (items || [])
            .map((a) => Number(a.allocation_id))
            .filter(Number.isFinite);
          // Find any new ids we haven't seen yet
          const newIds = currentIds.filter((id) => !seenAllocationIds.has(id));
          if (newIds.length > 0) {
            // Add all current ids to the seen set
            currentIds.forEach((id) => seenAllocationIds.add(id));
            // Persist seen ids so reloads don't re-show the banner
            saveSeenAllocationIds(seenAllocationIds);
            // Show a transient message (only for newly-detected allocations)
            showTemporaryBanner(
              banner,
              `${newIds.length} new allocation${
                newIds.length === 1 ? "" : "s"
              } detected.`,
              "alert alert-success py-2",
              4000
            );
          }
        } else {
          // No items: hide banner to avoid empty visible alert and clear seen ids
          banner.style.display = "none";
          banner.textContent = "";
          seenAllocationIds.clear();
          saveSeenAllocationIds(seenAllocationIds);
        }
      }

      // Reattach all event handlers
      attachEventHandlers();

      // Initialize tooltips
      try {
        const tooltipTriggerList = [].slice.call(
          document.querySelectorAll('[data-bs-toggle="tooltip"]')
        );
        tooltipTriggerList.forEach(function (tooltipTriggerEl) {
          if (window.bootstrap && bootstrap.Tooltip) {
            bootstrap.Tooltip.getOrCreateInstance(tooltipTriggerEl);
          }
        });
      } catch (_) {}

      try {
        console.debug("[receivedItems] refreshed", { count: items.length });
      } catch (_) {}
      return items;
    } catch (e) {
      try {
        console.error("[receivedItems] refresh failed", e);
      } catch (_) {}
      const msg = e && e.message ? e.message : "An error occurred";
      tbody.innerHTML = `<tr><td colspan="5" class="text-center text-danger">Failed to refresh allocations. ${escapeHtml(
        msg
      )}</td></tr>`;
      if (banner) {
        banner.className = "d-none";
      }
      throw e;
    } finally {
      refreshInFlight = false;
      refreshPromise = null;
      if (refreshQueued) {
        refreshQueued = false;
        refreshAllocations();
      } else {
        scheduleAutoRefresh();
      }
    }
    })();

    refreshPromise = runRefresh;
    return runRefresh;
  }

  // Attach event handlers to all buttons
  function attachEventHandlers() {
    const tbody = qs("main table tbody");
    if (!tbody) {
      try {
        console.error("[receivedItems] attachEventHandlers: no tbody found");
      } catch (_) {}
      return;
    }

    const cancelModalEl = document.getElementById("cancelAllocationModal");
    const reasonInput = document.getElementById("cancelAllocationReason");
    const confirmCancelBtn = document.getElementById(
      "confirmCancelAllocationBtn"
    );
    const cancelModal =
      cancelModalEl && window.bootstrap && bootstrap.Modal
        ? bootstrap.Modal.getOrCreateInstance(cancelModalEl)
        : null;
    let pendingCancelAid = null;

    try {
      console.debug("[receivedItems] attachEventHandlers: modal elements:", {
        cancelModalEl: !!cancelModalEl,
        reasonInput: !!reasonInput,
        confirmCancelBtn: !!confirmCancelBtn,
        cancelModal: !!cancelModal,
      });
    } catch (_) {}

    tbody.querySelectorAll("tr[data-aid]").forEach((tr) => {
      const aid = Number(tr.getAttribute("data-aid"));
      const toggleBtn = tr.querySelector(".alloc-toggle");
      const icon = toggleBtn?.querySelector("i");
      const itemsDiv = tr.querySelector(".items-inline");
      const statusBadge = tr.querySelector(".badge");
      const ackBtn = tr.querySelector(".btn-ack");
      const completeBtn = tr.querySelector(".btn-complete");
      const cancelBtn = tr.querySelector(".btn-cancel");

      try {
        console.debug("[receivedItems] attachEventHandlers: allocation", aid, {
          toggleBtn: !!toggleBtn,
          ackBtn: !!ackBtn,
          completeBtn: !!completeBtn,
          cancelBtn: !!cancelBtn,
          status: statusBadge?.textContent,
        });
      } catch (_) {}

      // Toggle inline items
      if (toggleBtn && icon && itemsDiv) {
        toggleBtn.addEventListener("click", () => {
          const isShown = !itemsDiv.classList.contains("d-none");
          if (isShown) {
            itemsDiv.classList.add("d-none");
            icon.classList.remove("bi-chevron-down");
            icon.classList.add("bi-chevron-up");
            toggleBtn.setAttribute("aria-expanded", "false");
          } else {
            itemsDiv.classList.remove("d-none");
            icon.classList.remove("bi-chevron-up");
            icon.classList.add("bi-chevron-down");
            toggleBtn.setAttribute("aria-expanded", "true");
          }
        });
      }

      // Acknowledge
      if (ackBtn) {
        ackBtn.addEventListener("click", async () => {
          try {
            const currentStatus = statusBadge.textContent.toLowerCase();
            if (currentStatus === "acknowledged") {
              showToast("Already acknowledged.");
              return;
            }
            const user = getStoredUser();
            const role =
              user && user.role ? String(user.role).toLowerCase() : "";
            const action =
              role === "admin" ? "acknowledge_admin" : "acknowledge";
            ackBtn.disabled = true;
            let ok = false,
              msg = "";
            try {
              if (
                window.AllocationsAPI &&
                action === "acknowledge" &&
                typeof window.AllocationsAPI.acknowledge === "function"
              ) {
                await window.AllocationsAPI.acknowledge(aid);
                ok = true;
              } else if (
                window.AllocationsAPI &&
                action === "acknowledge_admin" &&
                typeof window.AllocationsAPI.acknowledgeByAdmin === "function"
              ) {
                await window.AllocationsAPI.acknowledgeByAdmin(aid);
                ok = true;
              } else {
                const res = await fetch(
                  `${API_BASE_URL}/allocations/index.php?action=${action}&allocation_id=${encodeURIComponent(String(aid))}`,
                  {
                    method: "POST",
                    credentials: "include",
                    headers: {
                      "Content-Type": "application/json",
                      Accept: "application/json",
                    },
                    body: JSON.stringify({ allocation_id: aid }),
                  }
                );
                const j = await res.json().catch(() => null);
                ok = !!(res.ok && j?.success);
                if (!ok) msg = j?.error || `HTTP ${res.status}`;
              }
            } catch (e) {
              ok = false;
              msg = e?.message || "Failed";
            }
            if (!ok) {
              showToast(`Failed to acknowledge. ${msg}`);
              ackBtn.disabled = false;
              return;
            }
            // Refresh data from server
            await refreshAllocations();
            showToast("Please chat the foodbank to setup your pickup schedule", { delay: 6000 });
            setTimeout(() => {
              const trigger = document.querySelector('[data-messages-trigger], [data-bs-target="#messagesModal"]');
              if (trigger) {
                trigger.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
              }
            }, 150);
          } catch (e) {
            ackBtn.disabled = false;
            showToast("Failed to acknowledge.");
          }
        });
      }

      // Complete via confirmation modal
      if (completeBtn) {
        completeBtn.addEventListener("click", () => {
          const modalEl = document.getElementById("completeConfirmModal");
          const confirmBtn = document.getElementById("confirmCompleteBtn");
          if (!modalEl || !confirmBtn) {
            doComplete();
            return;
          }
          const modal =
            window.bootstrap && bootstrap.Modal
              ? bootstrap.Modal.getOrCreateInstance(modalEl)
              : null;
          if (!modal) {
            doComplete();
            return;
          }

          const newBtn = confirmBtn.cloneNode(true);
          confirmBtn.parentNode.replaceChild(newBtn, confirmBtn);

          newBtn.addEventListener("click", async () => {
            modal.hide();
            await doComplete();
          });

          modal.show();
        });

        async function doComplete() {
          try {
            completeBtn.disabled = true;
            let ok = false,
              msg = "";
            try {
              if (
                window.AllocationsAPI &&
                typeof window.AllocationsAPI.complete === "function"
              ) {
                await window.AllocationsAPI.complete(aid);
                ok = true;
              } else {
                const res = await fetch(
                  `${API_BASE_URL}/allocations/index.php?action=complete`,
                  {
                    method: "POST",
                    credentials: "include",
                    headers: {
                      "Content-Type": "application/json",
                      Accept: "application/json",
                    },
                    body: JSON.stringify({ allocation_id: aid }),
                  }
                );
                const j = await res.json().catch(() => null);
                ok = !!(res.ok && j?.success);
                if (!ok) msg = j?.error || `HTTP ${res.status}`;
              }
            } catch (e) {
              ok = false;
              msg = e?.message || "Failed";
            }
            if (!ok) {
              showToast(`Failed to complete. ${msg}`);
              completeBtn.disabled = false;
              return;
            }
            await refreshAllocations();
            showToast("Allocation completed.");
          } catch (e) {
            completeBtn.disabled = false;
            showToast("Failed to complete.");
          }
        }
      }

      // Cancel
      if (cancelBtn && cancelModal) {
        cancelBtn.addEventListener("click", () => {
          pendingCancelAid = aid;
          if (reasonInput) reasonInput.value = "";
          cancelModal.show();
        });
      }
    });

    // Wire Confirm Cancel button once (avoid duplicate listeners across refreshes)
    if (confirmCancelBtn && cancelModal) {
      const newBtn = confirmCancelBtn.cloneNode(true);
      confirmCancelBtn.parentNode.replaceChild(newBtn, confirmCancelBtn);
      newBtn.addEventListener("click", async () => {
        try {
          const user = getStoredUser();
          const role = user && user.role ? String(user.role).toLowerCase() : "";
          if (role !== "recipient") {
            showToast("Only recipients can cancel allocations here.");
            return;
          }
          if (!pendingCancelAid || !Number.isFinite(pendingCancelAid)) {
            showToast("No allocation selected.");
            return;
          }
          const reason = (reasonInput?.value || "").trim();
          if (!reason) {
            showToast("Please provide a reason for cancellation.");
            try {
              reasonInput?.focus();
            } catch (_) {}
            return;
          }

          newBtn.disabled = true;
          let ok = false,
            msg = "";
          try {
            // Prefer cancel_and_replace so the admin side gets automatic replacement
            if (
              window.AllocationsAPI &&
              typeof window.AllocationsAPI.cancelAndReplace === "function"
            ) {
              await window.AllocationsAPI.cancelAndReplace(
                pendingCancelAid,
                reason
              );
              ok = true;
            } else if (
              window.AllocationsAPI &&
              typeof window.AllocationsAPI.cancel === "function"
            ) {
              await window.AllocationsAPI.cancel(pendingCancelAid, reason);
              ok = true;
            } else {
              // Fallback to direct POST cancel_and_replace, then cancel
              let res = await fetch(
                `${API_BASE_URL}/allocations/index.php?action=cancel_and_replace`,
                {
                  method: "POST",
                  credentials: "include",
                  headers: {
                    "Content-Type": "application/json",
                    Accept: "application/json",
                  },
                  body: JSON.stringify({
                    allocation_id: pendingCancelAid,
                    reason,
                  }),
                }
              );
              let j = await res.json().catch(() => null);
              if (!(res.ok && j?.success)) {
                // Try simple cancel
                res = await fetch(
                  `${API_BASE_URL}/allocations/index.php?action=cancel`,
                  {
                    method: "POST",
                    credentials: "include",
                    headers: {
                      "Content-Type": "application/json",
                      Accept: "application/json",
                    },
                    body: JSON.stringify({
                      allocation_id: pendingCancelAid,
                      reason,
                    }),
                  }
                );
                j = await res.json().catch(() => null);
                ok = !!(res.ok && j?.success);
                if (!ok) msg = j?.error || `HTTP ${res.status}`;
              } else {
                ok = true;
              }
            }
          } catch (e) {
            ok = false;
            msg = e?.message || "Failed";
          }

          if (!ok) {
            showToast(`Failed to cancel allocation. ${msg}`);
            newBtn.disabled = false;
            return;
          }
          try {
            cancelModal.hide();
          } catch (_) {}
          await refreshAllocations();
          showToast("Allocation cancelled.");
        } catch (e) {
          showToast("Failed to cancel allocation.");
        } finally {
          newBtn.disabled = false;
        }
      });
    }
  }

  async function loadAllocations() {
    const tbody = qs("main table tbody");
    const main = document.querySelector("main");
    let banner = document.getElementById("riFeedback");

    try {
      console.debug("[receivedItems] loadAllocations: starting");
    } catch (_) {}
    try {
      console.debug(
        "[receivedItems] loadAllocations: document ready state:",
        document.readyState
      );
    } catch (_) {}
    try {
      console.debug("[receivedItems] loadAllocations: tbody exists:", !!tbody);
    } catch (_) {}
    try {
      console.debug("[receivedItems] loadAllocations: main exists:", !!main);
    } catch (_) {}
    try {
      console.debug(
        "[receivedItems] loadAllocations: banner exists:",
        !!banner
      );
    } catch (_) {}

    if (!banner && main) {
      banner = document.createElement("div");
      banner.id = "riFeedback";
      banner.className = "alert alert-info py-2";
      banner.style.marginTop = "0.5rem";
      // Start hidden; only show when we set a meaningful message
      banner.style.display = "none";
      banner.textContent = "";
      main.insertBefore(banner, main.firstChild);
    }
    if (!tbody) {
      try {
        console.error(
          "[receivedItems] loadAllocations: no tbody found - waiting for DOM"
        );
      } catch (_) {}
      // Don't return here, wait for DOM to be ready
      setTimeout(() => loadAllocations(), 100);
      return;
    }

    try {
      // Load initial data and attach event handlers
      await refreshAllocations();
    } catch (e) {
      try {
        console.error("[receivedItems] load failed", e);
      } catch (_) {}
      const msg = e && e.message ? e.message : "An error occurred";
      tbody.innerHTML = `<tr><td colspan="5" class="text-center text-danger">Failed to load allocations. ${escapeHtml(
        msg
      )}</td></tr>`;
      if (banner) {
        banner.className = "d-none";
      }
    }
  }

  function statusBadgeClass(status) {
    const s = String(status || "").toLowerCase();
    if (s === "acknowledged") return "bg-success";
    if (s === "cancelled") return "bg-danger";
    if (s === "delivered") return "bg-primary";
    if (s === "scheduled") return "bg-warning";
    if (s === "completed") return "bg-info";
    if (s === "picked up") return "bg-secondary";
    return "bg-info"; // Allocated
  }

  function showToast(msg, options) {
    try {
      try {
        console.debug("[receivedItems] showToast:", msg);
      } catch (_) {}
      const toastEl = document.getElementById("feedbackToast");
      if (toastEl) {
        const body = toastEl.querySelector(".toast-body");
        if (body) body.textContent = msg || "Done.";
        const delay = (options && typeof options.delay === "number") ? options.delay : 3500;
        const t = bootstrap.Toast.getOrCreateInstance(toastEl, { delay });
        t.show();
      } else {
        try {
          console.warn("[receivedItems] showToast: no toast element found");
        } catch (_) {}
      }
    } catch (e) {
      try {
        console.error("[receivedItems] showToast error:", e);
      } catch (_) {}
    }
  }

  function escapeHtml(s) {
    return (s || "").replace(/[&<>"']|\n/g, function (c) {
      switch (c) {
        case "&":
          return "&amp;";
        case "<":
          return "&lt;";
        case ">":
          return "&gt;";
        case '"':
          return "&quot;";
        case "'":
          return "&#39;";
        case "\n":
          return "<br/>";
      }
      return c;
    });
  }

  if (document.readyState === "loading") {
    try {
      console.debug("[receivedItems] DOM not ready, adding event listener");
    } catch (_) {}
    document.addEventListener("DOMContentLoaded", loadAllocations);
  } else {
    try {
      console.debug("[receivedItems] DOM ready, loading immediately");
    } catch (_) {}
    loadAllocations();
  }

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      refreshAllocations();
    }
  });

  window.addEventListener("beforeunload", () => {
    stopAutoRefresh();
  });
})();
