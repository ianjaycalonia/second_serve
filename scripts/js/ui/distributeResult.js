(async function () {
  function showMsg(el, msg, type) {
    if (!el) return;
    try {
      el.innerHTML = msg
        ? `<div class="alert alert-${type} py-2 mb-0">${msg}</div>`
        : "";
    } catch (_) {}
  }
  const container = document.getElementById("resultContainer");
  const summary = document.getElementById("resultSummary");
  const feedback = document.getElementById("resultFeedback");
  const API_BASE_URL =
    typeof window.API_BASE_URL === "string" && window.API_BASE_URL
      ? window.API_BASE_URL
      : "/php/api";
  const url = new URL(window.location.href);
  const DEBUG = url.searchParams.get("debug") === "1";
  const runIdRaw = (url.searchParams.get("run_id") || "").trim();
  const runId = parseInt(runIdRaw || "0", 10) || 0;
  let periodKeyParam = (url.searchParams.get("period_key") || "").trim();
  // Back-compat: some links pass period_key in run_id. Normalize it here.
  if (!periodKeyParam && /^\d{4}-\d{2}-W[1-4]$/.test(runIdRaw)) {
    periodKeyParam = runIdRaw;
  }
  if (DEBUG) console.log("[DR] Params", { runIdRaw, runId, periodKeyParam });

  const idsParam = (url.searchParams.get("recipient_ids") || "").trim();
  const recipientIds = idsParam
    ? idsParam
        .split(",")
        .map((s) => parseInt(s, 10))
        .filter((n) => Number.isFinite(n) && n > 0)
    : [];

  try {
    document.getElementById("notifyAllBtn")?.classList.add("d-none");
    document.getElementById("clearLocalBtn")?.classList.add("d-none");
  } catch (_) {}

  if (!container || !summary) {
    return;
  }

  // Auto-load run: prefer explicit period_key, else latest run, unless recipient_ids provided
  if (!runId && !recipientIds.length) {
    try {
      if (/^\d{4}-\d{2}-W[1-4]$/.test(periodKeyParam)) {
        // Resolve by period_key first
        const runUrl = `${API_BASE_URL}/allocations/index.php?action=run_by_period&period_key=${encodeURIComponent(
          periodKeyParam
        )}&t=${Date.now()}`;
        if (DEBUG) console.log("[DR] fetch run_by_period", runUrl);
        const res = await fetch(runUrl, {
          credentials: "include",
          headers: { Accept: "application/json" },
        });
        const j = await res.json().catch(() => null);
        if (DEBUG) console.log("[DR] run_by_period resp", res.status, j);
        if (res.ok && j && j.success && j.data && j.data.run_id) {
          window.__DR_RESOLVED_RUN_ID__ = parseInt(j.data.run_id, 10) || 0;
        } else {
          // Fallback to latest_run
          const latestUrl = `${API_BASE_URL}/allocations/index.php?action=latest_run&t=${Date.now()}`;
          if (DEBUG) console.log("[DR] fetch latest_run", latestUrl);
          const r2 = await fetch(latestUrl, {
            credentials: "include",
            headers: { Accept: "application/json" },
          });
          const j2 = await r2.json().catch(() => null);
          if (DEBUG) console.log("[DR] latest_run resp", r2.status, j2);
          if (r2.ok && j2 && j2.success && j2.data && j2.data.run_id) {
            window.__DR_RESOLVED_RUN_ID__ = parseInt(j2.data.run_id, 10) || 0;
          } else {
            showMsg(
              feedback,
              "No run found. Use Distribute Items → Allocate Now to generate a result set.",
              "warning"
            );
            if (DEBUG) console.warn("[DR] No run found");
            container.innerHTML = "";
            summary.textContent = "";
            return;
          }
        }
      } else {
        // No period_key provided: use latest_run
        const latestUrl = `${API_BASE_URL}/allocations/index.php?action=latest_run&t=${Date.now()}`;
        if (DEBUG) console.log("[DR] fetch latest_run", latestUrl);
        const res = await fetch(latestUrl, {
          credentials: "include",
          headers: { Accept: "application/json" },
        });
        const j = await res.json().catch(() => null);
        if (DEBUG) console.log("[DR] latest_run resp", res.status, j);
        if (res.ok && j && j.success && j.data && j.data.run_id) {
          window.__DR_RESOLVED_RUN_ID__ = parseInt(j.data.run_id, 10) || 0;
        } else {
          showMsg(
            feedback,
            "No run found. Use Distribute Items → Allocate Now to generate a result set.",
            "warning"
          );
          if (DEBUG) console.warn("[DR] No run found");
          container.innerHTML = "";
          summary.textContent = "";
          return;
        }
      }
    } catch (e) {
      showMsg(
        feedback,
        "Failed to load latest run. Use Distribute Items → Allocate Now.",
        "danger"
      );
      if (DEBUG) console.error("[DR] latest/run_by_period error", e);
      container.innerHTML = "";
      summary.textContent = "";
      return;
    }
  }

  // Removed inline loading message per request

  // Fetch recipients metadata for labels
  let recMeta = new Map();
  try {
    const res = await fetch(
      `${API_BASE_URL}/users/index.php?action=list&role=recipient&status=approved`,
      { credentials: "include" }
    );
    const j = await res.json().catch(() => null);
    if (DEBUG) console.log("[DR] users list resp", res.status, j);
    const arr = Array.isArray(j?.data?.items) ? j.data.items : [];
    arr.forEach((u) => {
      const id = Number(u.user_id || u.id) || 0;
      if (id) recMeta.set(id, u);
    });
  } catch (_) {}

  function isHiddenRecipientId(rid) {
    try {
      const u = recMeta.get(Number(rid)) || {};
      const org = String(u.organization_name || u.name || "").trim().toLowerCase();
      const tags = String(u.tags || "").toLowerCase();
      if (org === "foodbank (on-site)") return true;
      return /(^|[^a-z])hidden([^a-z]|$)/.test(tags);
    } catch (_) {
      return false;
    }
  }

  // Load allocations
  const effectiveRunId = runId || window.__DR_RESOLVED_RUN_ID__ || 0;
  if (DEBUG) console.log("[DR] effectiveRunId", effectiveRunId);
  const byRec = [];
  function shouldHideRecipient(items) {
    const forSavedRun = !!effectiveRunId;
    if (!Array.isArray(items) || !items.length) {
      return forSavedRun;
    }
    try {
      const allCancelled = items.every(
        (alloc) => String(alloc.status || "").toLowerCase() === "cancelled"
      );
      if (allCancelled) return true;
      if (!forSavedRun) return false;
      const hasAnyItem = items.some(
        (alloc) =>
          Array.isArray(alloc.items) &&
          alloc.items.some(
            (it) => (Number(it.quantity || 0) || 0) > 0
          )
      );
      return !hasAnyItem;
    } catch (_) {
      return false;
    }
  }
  if (effectiveRunId) {
    try {
      const listUrl = `${API_BASE_URL}/allocations/index.php?action=list_by_run&run_id=${encodeURIComponent(
        String(effectiveRunId)
      )}&t=${Date.now()}`;
      if (DEBUG) console.log("[DR] fetch list_by_run", listUrl);
      const res = await fetch(listUrl, {
        credentials: "include",
        headers: { Accept: "application/json" },
      });
      const j = await res.json().catch(() => null);
      if (DEBUG) console.log("[DR] list_by_run resp", res.status, j);
      if (!res.ok || !j?.success)
        throw new Error(j?.error || `HTTP ${res.status}`);
      const arr = Array.isArray(j?.data?.items) ? j.data.items : [];
      // group by recipient_id
      const map = new Map();
      arr.forEach((a) => {
        const rid = Number(a.recipient_id) || 0;
        if (!map.has(rid)) map.set(rid, []);
        map.get(rid).push(a);
      });
      map.forEach((items, rid) => {
        if (isHiddenRecipientId(rid)) return;
        if (shouldHideRecipient(items)) return;
        byRec.push({ rid, items });
      });
      // Summary
      const recCount = byRec.length;
      const itemCount = byRec.reduce(
        (sum, r) =>
          sum +
          (Array.isArray(r.items)
            ? r.items.reduce(
                (s, a) => s + (Array.isArray(a.items) ? a.items.length : 0),
                0
              )
            : 0),
        0
      );
      if (summary)
        summary.textContent = `Run ${effectiveRunId}: ${recCount} recipients, ${itemCount} items`;
      if (DEBUG) console.log("[DR] summary", { recCount, itemCount });
    } catch (e) {
      showMsg(feedback, e?.message || "Failed to load run", "danger");
      if (DEBUG) console.error("[DR] list_by_run error", e);
    }
  } else {
    // Fallback: explicit recipient_ids
    for (const rid of recipientIds) {
      if (isHiddenRecipientId(rid)) {
        continue;
      }
      try {
        const perUrl = `${API_BASE_URL}/allocations/index.php?action=list_by_recipient&recipient_id=${encodeURIComponent(
          rid
        )}&t=${Date.now()}`;
        if (DEBUG) console.log("[DR] fetch list_by_recipient", perUrl);
        const res = await fetch(perUrl, {
          credentials: "include",
          headers: { Accept: "application/json" },
        });
        const j = await res.json().catch(() => null);
        if (DEBUG) console.log("[DR] list_by_recipient resp", res.status, j);
        if (!res.ok || !j?.success)
          throw new Error(j?.error || `HTTP ${res.status}`);
        const items = Array.isArray(j?.data?.items) ? j.data.items : [];
        if (shouldHideRecipient(items)) {
          return;
        }
        byRec.push({ rid, items });
      } catch (e) {
        byRec.push({ rid, items: [], error: e?.message || "Failed" });
        if (DEBUG) console.error("[DR] list_by_recipient error", e);
      }
    }
  }

  // Lock state - persisted in localStorage PER RUN to avoid accidental global lock
  // Lock state - DB is the single source of truth. No localStorage used.
  let isLocked = false;

  // DB-only truth: Show Notify button ONLY if there is at least one Pending allocation in this run
  const hasPending = byRec.some(
    ({ items }) =>
      Array.isArray(items) &&
      items.some((a) => String(a.status || "").toLowerCase() === "pending")
  );
  if (hasPending) {
    isLocked = false;
    document.getElementById("notifyRunBtn")?.classList.remove("d-none");
  } else {
    isLocked = true;
    document.getElementById("notifyRunBtn")?.classList.add("d-none");
    // applyLock will be called later after inputs are created
  }

  // Apply lock function
  // Hide Actions header if there are no visible action buttons
  function updateActionsHeaderVisibility() {
    try {
      const ths = container.querySelectorAll("table thead th");
      let actionsTh = null;
      ths.forEach((th) => {
        if (
          !actionsTh &&
          String(th.textContent || "")
            .trim()
            .toLowerCase() === "actions"
        ) {
          actionsTh = th;
        }
      });
      if (!actionsTh) return;
      actionsTh.classList.remove("d-none");
    } catch (_) {}
  }

  function applyLock() {
    if (!isLocked) return;
    // Disable and prevent typing in inputs
    container.querySelectorAll(".dr-qty").forEach((el) => {
      el.disabled = true;
      el.readOnly = true; // Extra prevention
    });

    // Auto Allocate: reuse server-side preview to populate items under existing allocations
    document
      .getElementById("autoAllocateBtn")
      ?.addEventListener("click", async () => {
        const btn = document.getElementById("autoAllocateBtn");
        if (btn) btn.disabled = true;
        try {
          const fb = feedback;
          // Determine period_key for this run
          const effRunId = runId || window.__DR_RESOLVED_RUN_ID__ || 0;
          let periodKey =
            periodKeyParam && /^\d{4}-\d{2}-W[1-4]$/.test(periodKeyParam)
              ? periodKeyParam
              : "";
          if (!periodKey && effRunId) {
            try {
              let rows = [];
              if (
                window.AllocationsAPI &&
                typeof window.AllocationsAPI.listRuns === "function"
              ) {
                const jx = await window.AllocationsAPI.listRuns(100);
                rows = Array.isArray(jx?.data?.items)
                  ? jx.data.items
                  : Array.isArray(jx)
                  ? jx
                  : [];
              } else {
                const r = await fetch(
                  `${API_BASE_URL}/allocations/index.php?action=list_runs&limit=100&t=${Date.now()}`,
                  {
                    credentials: "include",
                    headers: { Accept: "application/json" },
                  }
                );
                const jj = await r.json().catch(() => null);
                rows = Array.isArray(jj?.data?.items) ? jj.data.items : [];
              }
              const match = rows.find(
                (x) => parseInt(x.run_id, 10) === effRunId
              );
              if (match && match.period_key)
                periodKey = String(match.period_key);
            } catch (_) {}
          }
          if (!/^\d{4}-\d{2}-W[1-4]$/.test(periodKey)) {
            showMsg(
              fb,
              "Cannot resolve week for preview. Use the Week input to load by period first.",
              "warning"
            );
            return;
          }

          // Collect recipient IDs present on page
          const rids = Array.from(
            document.querySelectorAll("tbody.dr-recipient[data-rec]")
          )
            .map((tb) => parseInt(tb.getAttribute("data-rec") || "0", 10))
            .filter((n) => Number.isFinite(n) && n > 0);
          if (!rids.length) {
            showMsg(fb, "No recipients to auto-allocate.", "secondary");
            return;
          }

          // Request server preview
          let sugg = [];
          try {
            if (
              window.AllocationsAPI &&
              typeof window.AllocationsAPI.previewAllocation === "function"
            ) {
              const jr = await window.AllocationsAPI.previewAllocation(
                periodKey,
                rids
              );
              sugg = Array.isArray(jr?.data?.allocations)
                ? jr.data.allocations
                : Array.isArray(jr)
                ? jr
                : [];
            } else {
              const res = await fetch(
                `${API_BASE_URL}/allocations/index.php?action=preview_allocation`,
                {
                  method: "POST",
                  credentials: "include",
                  headers: {
                    "Content-Type": "application/json",
                    Accept: "application/json",
                  },
                  body: JSON.stringify({
                    period_key: periodKey,
                    recipient_ids: rids,
                  }),
                }
              );
              const j = await res.json().catch(() => null);
              if (!res.ok || !j?.success) {
                throw new Error(j?.error || `HTTP ${res.status}`);
              }
              sugg = Array.isArray(j?.data?.allocations)
                ? j.data.allocations
                : [];
            }
          } catch (e) {
            throw e;
          }
          if (!sugg.length) {
            showMsg(fb, "No suggestions returned for this week.", "warning");
            return;
          }

          // Build map rid -> allocation_id (first existing one on page)
          const allocIdByRid = new Map();
          document
            .querySelectorAll("tbody.dr-recipient[data-rec]")
            .forEach((tb) => {
              const rid = parseInt(tb.getAttribute("data-rec") || "0", 10) || 0;
              const firstRow = tb.querySelector("tr[data-allocation-id]");
              const aId = firstRow
                ? parseInt(
                    firstRow.getAttribute("data-allocation-id") || "0",
                    10
                  ) || 0
                : 0;
              if (rid && aId) allocIdByRid.set(rid, aId);
            });

          // Aggregate suggestions per recipient and item
          const aggByRid = new Map();
          for (const a of sugg) {
            const rid = parseInt(a.recipient_id, 10) || 0;
            if (!rid) continue;
            if (!aggByRid.has(rid)) aggByRid.set(rid, new Map());
            const key = `${a.product_category || ""}\u0001${
              a.product_name || ""
            }`;
            const cur = aggByRid.get(rid).get(key) || 0;
            aggByRid.get(rid).set(key, cur + (Number(a.quantity || 0) || 0));
          }

          // Apply suggestions: create allocation if missing, else add items to existing
          let ok = 0,
            created = 0,
            skipped = 0,
            fail = 0;
          for (const [rid, itemsMap] of aggByRid.entries()) {
            const allocId = allocIdByRid.get(rid) || 0;
            // Build items array once
            const itemsArr = Array.from(itemsMap.entries())
              .map(([key, qty]) => {
                const [cat, name] = key.split("\u0001");
                return {
                  item_name: name,
                  category: cat || null,
                  quantity: qty,
                };
              })
              .filter((it) => it.item_name && it.quantity > 0);
            if (!itemsArr.length) {
              skipped++;
              continue;
            }
            try {
              if (!allocId) {
                // Create a new allocation under current run for this recipient
                const payload = {
                  recipient_id: rid,
                  items: itemsArr,
                  run_id: runId || window.__DR_RESOLVED_RUN_ID__ || null,
                  allocation_code: null,
                  notify_admin: false,
                };
                if (
                  window.AllocationsAPI &&
                  typeof window.AllocationsAPI.createResult === "function"
                ) {
                  try {
                    await window.AllocationsAPI.createResult(
                      payload.recipient_id,
                      payload.items,
                      payload.run_id,
                      payload.allocation_code,
                      payload.notify_admin
                    );
                    created++;
                    ok += itemsArr.length;
                  } catch (_) {
                    fail += itemsArr.length;
                  }
                } else {
                  const rr = await fetch(
                    `${API_BASE_URL}/allocations/index.php?action=create_result`,
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
                  const jj = await rr.json().catch(() => null);
                  if (rr.ok && jj?.success) {
                    created++;
                    ok += itemsArr.length;
                  } else {
                    fail += itemsArr.length;
                  }
                }
              } else {
                // Add items into existing allocation
                for (const it of itemsArr) {
                  if (
                    window.AllocationsAPI &&
                    typeof window.AllocationsAPI.addItem === "function"
                  ) {
                    try {
                      await window.AllocationsAPI.addItem(
                        allocId,
                        it.item_name,
                        it.category,
                        it.quantity
                      );
                      ok++;
                    } catch (_) {
                      fail++;
                    }
                  } else {
                    const rr = await fetch(
                      `${API_BASE_URL}/allocations/index.php?action=add_item`,
                      {
                        method: "POST",
                        credentials: "include",
                        headers: {
                          "Content-Type": "application/json",
                          Accept: "application/json",
                        },
                        body: JSON.stringify({
                          allocation_id: allocId,
                          item_name: it.item_name,
                          category: it.category,
                          quantity: it.quantity,
                        }),
                      }
                    );
                    const jj = await rr.json().catch(() => null);
                    if (rr.ok && jj?.success) ok++;
                    else fail++;
                  }
                }
              }
            } catch (_) {
              fail += itemsArr.length;
            }
          }

          // Show outcome and reload
          try {
            const mEl = document.getElementById("resultAlertModal");
            const bEl = document.getElementById("resultAlertBody");
            if (bEl)
              bEl.textContent = `Auto allocate done. Added ${ok} item${
                ok !== 1 ? "s" : ""
              }. Created ${created} allocation${
                created !== 1 ? "s" : ""
              }. Skipped ${skipped}. Failures: ${fail}.`;
            if (mEl) {
              const m = new bootstrap.Modal(mEl);
              m.show();
            }
          } catch (_) {
            /* ignore */
          }
          setTimeout(() => window.location.reload(), 900);
        } catch (err) {
          showMsg(feedback, err?.message || "Auto allocate failed", "danger");
        } finally {
          if (btn) btn.disabled = false;
        }
      });

    // (autoAllocateBtn handler bound below, outside applyLock)
    // Disable remove buttons
    container.querySelectorAll(".dr-del").forEach((el) => {
      try {
        if (typeof el.disabled !== "undefined") el.disabled = true;
        el.setAttribute("aria-disabled", "true");
        if (el.classList) el.classList.add("disabled");
      } catch (_) {}
    });
    // Update Actions header visibility now that action buttons were hidden
    updateActionsHeaderVisibility();
    const saveBtn = document.getElementById("saveChangesBtn");
    if (saveBtn) saveBtn.disabled = true;
    const notifyBtn = document.getElementById("notifyRunBtn");
    if (notifyBtn) notifyBtn.disabled = true;
  }

  const frag = document.createDocumentFragment();

  // Create unified table wrapper but preserve per-recipient tbodies so existing code
  // (which queries "tbody.dr-recipient[data-rec]") continues to work.
  const unifiedTableWrap = document.createElement("div");
  unifiedTableWrap.className = "table-responsive";
  const table = document.createElement("table");
  table.className = "table table-bordered table-sm align-middle dr-result-table";
  table.innerHTML = `
    <thead class="table-light">
      <tr>
        <th>Recipient</th>
        <th>Status</th>
        <th>Created</th>
        <th>Item</th>
        <th>Unit</th>
        <th>Quantity</th>
        <th>Actions</th>
      </tr>
    </thead>`;

  // Build a tbody per recipient so existing handlers and selectors keep working
  byRec.forEach(({ rid, items, error }) => {
    const meta = recMeta.get(rid) || {};
    const base =
      meta.organization_name && String(meta.organization_name).trim()
        ? String(meta.organization_name).trim()
        : meta.name || `Recipient ${rid}`;

    // Determine highest-level badge (for display in header)
    let badgeHtml = "";
    let isRecipientNotified = false;
    try {
      const statuses = Array.isArray(items)
        ? items.map((a) => String(a.status || "").toLowerCase())
        : [];
      if (statuses.some((s) => s === "notified")) {
        badgeHtml = "<span class='badge bg-info text-dark'>Notified</span>";
        isRecipientNotified = true;
      } else if (statuses.some((s) => s === "completed")) {
        badgeHtml = "<span class='badge bg-primary'>Completed</span>";
      } else if (statuses.some((s) => s === "picked up")) {
        badgeHtml = "<span class='badge bg-secondary'>Picked Up</span>";
      } else if (statuses.some((s) => s === "acknowledged")) {
        badgeHtml = "<span class='badge bg-success'>Acknowledged</span>";
      } else if (statuses.some((s) => s === "updated")) {
        badgeHtml = "<span class='badge bg-warning text-dark'>Updated</span>";
      } else if (statuses.some((s) => s === "cancelled")) {
        badgeHtml = "<span class='badge bg-danger'>Cancelled</span>";
      }
    } catch (_) {}

    // Create tbody for this recipient
    const tb = document.createElement("tbody");
    tb.className = "dr-recipient";
    tb.setAttribute("data-rec", String(rid));

    const totalItems = Array.isArray(items)
      ? items.reduce(
          (sum, alloc) =>
            sum +
            (Array.isArray(alloc.items) ? alloc.items.length : 0),
          0
        )
      : 0;

    let earliestCreated = null;
    const headerNames = [];
    let headerTotalQty = 0;
    if (Array.isArray(items)) {
      items.forEach((a) => {
        const created = a.created_at ? new Date(a.created_at) : null;
        if (created) {
          if (!earliestCreated || created < earliestCreated) {
            earliestCreated = created;
          }
        }
        if (Array.isArray(a.items)) {
          a.items.forEach((it) => {
            const nm = String(it.item_name || it.name || "").trim();
            if (nm) headerNames.push(nm);
            const q = Number(it.quantity || 0) || 0;
            headerTotalQty += q;
          });
        }
      });
    }

    let headerCreatedStr = "";
    if (earliestCreated) {
      headerCreatedStr = `${String(earliestCreated.getDate()).padStart(
        2,
        "0"
      )}/${String(earliestCreated.getMonth() + 1).padStart(2, "0")}/${
        earliestCreated.getFullYear()
      } ${String(earliestCreated.getHours()).padStart(2, "0")}:${String(
        earliestCreated.getMinutes()
      ).padStart(2, "0")}`;
    }

    let headerItemsSummary = "";
    if (headerNames.length) {
      const seen = new Set();
      const uniq = [];
      headerNames.forEach((n) => {
        const key = n.toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          uniq.push(n);
        }
      });
      const maxNames = 3;
      let summary = uniq.slice(0, maxNames).join(", ");
      if (uniq.length > maxNames) summary += ", ...";
      const maxChars = 80;
      if (summary.length > maxChars) {
        summary = summary.slice(0, maxChars - 3) + "...";
      }
      headerItemsSummary = summary;
    }

    const safeHeaderItemsSummary = headerItemsSummary
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

    const headerNotifyBtnHtml = isRecipientNotified
      ? ""
      : `<button class="btn btn-sm btn-outline-info dr-notify-one" data-rec="${rid}" title="Notify">
           <i class="bi bi-bell"></i>
         </button>`;

    const headerTr = document.createElement("tr");
    headerTr.className = "dr-rec-header";
    headerTr.dataset.rec = String(rid);
    headerTr.innerHTML = `
      <td class="bg-light">
        <button type="button" class="btn btn-sm btn-link text-decoration-none dr-rec-toggle" data-rec="${rid}">
          <i class="bi bi-chevron-right me-1 dr-rec-toggle-icon"></i>
          <span class="fw-semibold">${base}</span>
        </button>
      </td>
      <td class="bg-light">${badgeHtml}</td>
      <td class="bg-light">${headerCreatedStr}</td>
      <td class="bg-light">(${totalItems} item${
        totalItems === 1 ? "" : "s"
      })</td>
      <td class="bg-light"></td>
      <td class="bg-light">${headerTotalQty || ""}</td>
      <td class="bg-light text-center">${headerNotifyBtnHtml}</td>`;
    tb.appendChild(headerTr);

    if (!Array.isArray(items) || !items.length) {
      const tr = document.createElement("tr");
      tr.className = "dr-rec-item";
      tr.innerHTML = `
        <td></td>
        <td colspan="6" class="text-muted">No allocations saved for this recipient.${
          error ? ` <span class='badge bg-danger ms-2'>${error}</span>` : ""
        }</td>`;
      tb.appendChild(tr);
    } else {
      // Add one row per item (items nested under allocations)
      items.forEach((a) => {
        const created = a.created_at ? new Date(a.created_at) : null;
        const dt = created
          ? `${String(created.getDate()).padStart(2, "0")}/${String(
              created.getMonth() + 1
            ).padStart(2, "0")}/${created.getFullYear()} ${String(
              created.getHours()
            ).padStart(2, "0")}:${String(created.getMinutes()).padStart(
              2,
              "0"
            )}`
          : "";
        const status = a.status || "Allocated";

        if (Array.isArray(a.items)) {
          a.items.forEach((it) => {
            const tr = document.createElement("tr");
            tr.className = "dr-rec-item";
            tr.dataset.allocationId = String(a.allocation_id || "");
            tr.dataset.itemId = String(it.item_id || "");
            tr.dataset.rec = String(rid);
            tr.dataset.status = String(status).toLowerCase();
            // Expose grouping keys for validation
            const itemNameRaw = String(it.item_name || it.name || "");
            tr.dataset.name = itemNameRaw.trim();
            tr.dataset.category = String(it.category || a.product_category || "");
            tr.dataset.unit = String(it.unit || it.unit_label || "");

            const statusLower = String(status || "").toLowerCase();
            const isNotified = statusLower === "notified";
            // Actions: only per-item Remove button, hidden when notified
            const actionsCell = isNotified
              ? `<td></td>`
              : `<td>
                  <div class="d-flex justify-content-center gap-2">
                    <button type="button" class="btn btn-sm btn-outline-danger dr-del" title="Remove">
                      <i class="bi bi-x"></i>
                    </button>
                  </div>
                </td>`;

            const safeName = itemNameRaw
              .replace(/&/g, "&amp;")
              .replace(/</g, "&lt;")
              .replace(/>/g, "&gt;")
              .replace(/"/g, "&quot;");

            const baseNameAttrs = 'readonly aria-readonly="true" tabindex="-1"';
            const nameAttrs = isNotified
              ? `${baseNameAttrs} disabled aria-disabled="true"`
              : baseNameAttrs;

            const quantityAttrs = isNotified
              ? 'disabled aria-disabled="true"'
              : '';

            const unitLabel = String(it.unit || it.unit_label || "");

            tr.innerHTML = `
              <td></td>
              <td></td>
              <td></td>
              <td>
                <input type="text" class="form-control form-control-sm dr-name" 
                  value="${safeName}" 
                  placeholder="Item name" ${nameAttrs}>
              </td>
              <td>${unitLabel}</td>
              <td>
                <input type="number" class="form-control form-control-sm dr-qty" 
                  value="${it.quantity}" min="0" step="1" inputmode="numeric" pattern="\\d*" required ${quantityAttrs}>
              </td>
              ${actionsCell}`;

            tb.appendChild(tr);
          });
        }
      });
    }

    table.appendChild(tb);
  });

  // Helper to expand/collapse a recipient tbody
  function setRecipientCollapsed(tb, collapsed) {
    try {
      tb.dataset.collapsed = collapsed ? "1" : "0";
      const rows = tb.querySelectorAll("tr.dr-rec-item");
      rows.forEach((tr) => {
        if (collapsed) tr.classList.add("d-none");
        else tr.classList.remove("d-none");
      });
      const icon = tb.querySelector(".dr-rec-toggle-icon");
      if (icon) {
        icon.classList.remove("bi-chevron-right", "bi-chevron-down");
        icon.classList.add(collapsed ? "bi-chevron-right" : "bi-chevron-down");
      }
    } catch (_) {}
  }

  // Collapse all recipients by default (use the in-memory table so this
  // works before we append it into the DOM)
  try {
    table
      .querySelectorAll("tbody.dr-recipient")
      .forEach((tb) => setRecipientCollapsed(tb, true));
  } catch (_) {}

  // Toggle handler for individual recipients
  container.addEventListener("click", function (e) {
    const toggleBtn =
      e.target &&
      (e.target.closest && e.target.closest(".dr-rec-toggle"));
    if (!toggleBtn) return;
    const tb =
      toggleBtn.closest("tbody.dr-recipient") ||
      container.querySelector(
        `tbody.dr-recipient[data-rec="${
          toggleBtn.getAttribute("data-rec") || ""
        }"]`
      );
    if (!tb) return;
    const collapsed = tb.dataset.collapsed !== "0";
    setRecipientCollapsed(tb, !collapsed);
  });

  unifiedTableWrap.appendChild(table);
  frag.appendChild(unifiedTableWrap);
  container.appendChild(frag);

  // Global collapse/expand controls
  document.getElementById("drCollapseAll")?.addEventListener("click", () => {
    table
      .querySelectorAll("tbody.dr-recipient")
      .forEach((tb) => setRecipientCollapsed(tb, true));
  });
  document.getElementById("drExpandAll")?.addEventListener("click", () => {
    table
      .querySelectorAll("tbody.dr-recipient")
      .forEach((tb) => setRecipientCollapsed(tb, false));
  });
  try {
    container.querySelectorAll(".dr-name").forEach((el) => {
      el.readOnly = true;
      el.setAttribute("aria-readonly", "true");
      el.setAttribute("tabindex", "-1");
    });
  } catch (_) {}
  // Hide actions header if appropriate on initial render
  try {
    updateActionsHeaderVisibility();
  } catch (_) {}
  try {
    window.__DR_BYREC__ = byRec;
  } catch (_) {}
  if (DEBUG) console.log("[DR] render complete", { cards: byRec.length });

  // Apply lock after inputs are created
  if (isLocked) {
    applyLock();
  }

  // ==== Quantity validation against available inventory (same item + category, sum of all rows) ====
  const availCache = (window.__invAvailCache = window.__invAvailCache || new Map());
  function keyFor(name, category) {
    return `${(name || '').trim()}\u0001${(category || '').trim()}`;
  }
  async function fetchAvailable(name, category) {
    const k = keyFor(name, category);
    if (availCache.has(k)) return availCache.get(k);
    try {
      const params = new URLSearchParams();
      params.set('group', 'merge');
      params.set('limit', '100');
      if (name) params.set('q', name);
      if (category) params.set('category', category);
      params.set('t', String(Date.now()));
      const url = `${API_BASE_URL}/inventory/index.php/list?${params.toString()}`;
      const res = await fetch(url, { credentials: 'include', headers: { Accept: 'application/json' } });
      const j = await res.json().catch(() => null);
      let available = 0;
      if (res.ok && j?.success && Array.isArray(j?.data?.items)) {
        for (const r of j.data.items) {
          if (String(r.item_name || '') === String(name || '') && String(r.category || '') === String(category || '')) {
            available += Number(r.total_quantity || 0) || 0;
          }
        }
      }
      availCache.set(k, available);
      return available;
    } catch (_) {
      availCache.set(keyFor(name, category), 0);
      return 0;
    }
  }
  function groupSums(excludeEl = null) {
    const sums = new Map();
    container.querySelectorAll('tbody.dr-recipient tr[data-item-id]').forEach((tr) => {
      try {
        if (excludeEl && excludeEl.closest('tr') === tr) return; // handled separately
        const name = tr.dataset.name || '';
        const cat = tr.dataset.category || '';
        const k = keyFor(name, cat);
        const qtyEl = tr.querySelector('.dr-qty');
        const v = parseInt(qtyEl && qtyEl.value ? qtyEl.value : '0', 10) || 0;
        sums.set(k, (sums.get(k) || 0) + v);
      } catch (_) {}
    });
    return sums;
  }
  const previousQuantities = new WeakMap();

  async function validateAndClamp(inputEl) {
    try {
      const tr = inputEl.closest('tr');
      if (!tr) return;
      const name = tr.dataset.name || '';
      const cat = tr.dataset.category || '';
      if (!name) return; // cannot validate without item name
      const k = keyFor(name, cat);
      const otherSums = groupSums(inputEl);
      const others = otherSums.get(k) || 0;
      if (!previousQuantities.has(inputEl)) {
        const initial = parseInt(inputEl.value || '0', 10) || 0;
        previousQuantities.set(inputEl, initial > 0 ? initial : 0);
      }
      let val = parseInt(inputEl.value || '0', 10) || 0;
      if (val < 0) val = 0;
      if (val === 0) {
        const prior = previousQuantities.get(inputEl) || 0;
        if (prior > 0) {
          inputEl.value = String(prior);
          return;
        }
      } else {
        previousQuantities.set(inputEl, val);
      }
      const available = await fetchAvailable(name, cat);
      const maxForThisRow = Math.max(0, available - others);
      if (val > maxForThisRow) {
        inputEl.value = String(maxForThisRow);
        inputEl.classList.add('is-invalid');
        inputEl.setAttribute('title', `Adjusted to available: ${maxForThisRow} (total available ${available})`);
        setTimeout(() => { try { inputEl.classList.remove('is-invalid'); inputEl.removeAttribute('title'); } catch(_){} }, 1200);
      }
    } catch (_) {}
  }
  // Bind listeners
  container.addEventListener('focusin', function(e){
    const qty = e.target && e.target.classList && e.target.classList.contains('dr-qty');
    if (!qty) return;
    const current = Math.max(0, parseInt(e.target.value || '0', 10) || 0);
    if (current > 0) {
      previousQuantities.set(e.target, current);
    } else if (!previousQuantities.has(e.target)) {
      previousQuantities.set(e.target, 0);
    }
  });
  container.addEventListener('input', function(e){
    const qty = e.target && e.target.classList && e.target.classList.contains('dr-qty');
    if (!qty) return;
    // Sanitize non-digits
    const clean = (e.target.value || '').replace(/[^\d]/g, '');
    if (clean !== e.target.value) e.target.value = clean;
    validateAndClamp(e.target);
  });
  // Block non-digit keys for quantity fields
  container.addEventListener('keydown', function(e){
    const t = e.target;
    if (!t || !t.classList || !t.classList.contains('dr-qty')) return;
    const allowed = ['Backspace','Delete','ArrowLeft','ArrowRight','Tab','Home','End'];
    if (allowed.includes(e.key)) return;
    if (/^[0-9]$/.test(e.key)) return;
    // Prevent +/- . e, and any non-digit
    e.preventDefault();
  });
  // Sanitize paste into quantity fields
  container.addEventListener('paste', function(e){
    const t = e.target;
    if (!t || !t.classList || !t.classList.contains('dr-qty')) return;
    e.preventDefault();
    const text = (e.clipboardData || window.clipboardData).getData('text') || '';
    const digits = text.replace(/[^\d]/g, '');
    const start = t.selectionStart || 0;
    const end = t.selectionEnd || 0;
    t.value = (t.value.substring(0, start) + digits + t.value.substring(end));
    validateAndClamp(t);
  });
  // Prevent mouse wheel from changing values accidentally
  container.addEventListener('wheel', function(e){
    const t = e.target;
    if (!t || !t.classList || !t.classList.contains('dr-qty')) return;
    e.preventDefault();
  }, { passive: false });
  container.addEventListener('change', function(e){
    const nameChanged = e.target && e.target.classList && e.target.classList.contains('dr-name');
    if (!nameChanged) return;
    const tr = e.target.closest('tr');
    if (tr) { tr.dataset.name = String(e.target.value || ''); }
    // Revalidate related quantities for this group
    const cat = tr ? (tr.dataset.category || '') : '';
    const name = tr ? (tr.dataset.name || '') : '';
    if (name) {
      // Clear cache for this key to refetch fresh availability next time
      try { availCache.delete(keyFor(name, cat)); } catch(_){}
    }
    const qtyEl = tr && tr.querySelector('.dr-qty');
    if (qtyEl) validateAndClamp(qtyEl);
  });

  // ==== Missing metadata scan (category, unit, weight) with Notify Admin ====
  async function listAdmins() {
    try {
      const r = await fetch(`${API_BASE_URL}/users/index.php?action=list&role=admin&status=approved&t=${Date.now()}`, { credentials: 'include', headers: { Accept: 'application/json' } });
      const j = await r.json().catch(() => null);
      const arr = Array.isArray(j?.data?.items) ? j.data.items : [];
      return arr.map((u) => Number(u.user_id || u.id) || 0).filter((n) => n > 0);
    } catch (_) { return []; }
  }

  async function fetchMissingMetadataIndex(){
    try {
      const res = await fetch(`${API_BASE_URL}/taxonomy/index.php/missing-metadata?limit=500`, {
        method: 'GET',
        credentials: 'include',
        headers: { Accept: 'application/json' }
      });
      const json = await res.json().catch(() => null);
      const items = Array.isArray(json?.items) ? json.items : [];
      const map = new Map();
      items.forEach((it) => {
        const key = (it?.product_name || '').trim().toLowerCase();
        if (!key) return;
        let entry = map.get(key);
        if (!entry) {
          entry = { missingSet: new Set(), sample: it };
          map.set(key, entry);
        }
        const missing = Array.isArray(it?.missing) ? it.missing : [];
        missing.forEach((label) => entry.missingSet.add(String(label || '').toLowerCase()));
      });
      return map;
    } catch (_) {
      return new Map();
    }
  }

  async function scanMissing() {
    try {
      const uniq = new Map();
      container.querySelectorAll('tbody.dr-recipient tr[data-item-id]').forEach((tr) => {
        const name = (tr.dataset.name || '').trim();
        const cat = (tr.dataset.category || '').trim();
        if (!name) return;
        const k = keyFor(name, cat);
        if (!uniq.has(k)) uniq.set(k, { name, category: cat });
      });
      const missingIndex = await fetchMissingMetadataIndex();
      const results = [];
      for (const { name, category } of uniq.values()) {
        const entry = missingIndex.get(name.toLowerCase());
        if (entry && entry.missingSet && entry.missingSet.size) {
          const missingCategory = entry.missingSet.has('category');
          const missingUnit = entry.missingSet.has('unit');
          const missingWeight = entry.missingSet.has('weight');
          if (missingCategory || missingUnit || missingWeight) {
            results.push({ name, category: category || '(none)', missingCategory, missingUnit, missingWeight });
          }
        }
      }
      if (results.length) {
        // Avoid duplicate bell notifications per run in this browser session
        try {
          const effRunId = runId || window.__DR_RESOLVED_RUN_ID__ || 0;
          const guardKey = `dr_missing_meta_notified_${effRunId}`;
          if (String(sessionStorage.getItem(guardKey) || '') !== '1') {
            const admins = await listAdmins();
            const msg = `Products with missing metadata: ${results.map(r => {
              const issues = [];
              if (r.missingCategory) issues.push('category');
              if (r.missingUnit) issues.push('unit');
              if (r.missingWeight) issues.push('weight');
              return `${r.name} [${r.category}] (${issues.join('/')})`;
            }).join(', ')}`;
            for (const uid of admins) {
              try {
                await fetch(`${API_BASE_URL}/communications/notifications.php?action=create`, {
                  method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                  body: JSON.stringify({ user_id: uid, type: 'data_missing', message: msg })
                });
              } catch (_) {}
            }
            sessionStorage.setItem(guardKey, '1');
          }
        } catch (_) {}
      }
    } catch (_) {}
  }
  scanMissing();

  // ==== Per-recipient Notify handler (blue bell) ====
  async function notifyRecipient(rid) {
    try {
      const tb = container.querySelector(`tbody.dr-recipient[data-rec="${rid}"]`);
      // Persist: mark this recipient's allocations for current run as Notified and create notification server-side
      const effRunId = runId || window.__DR_RESOLVED_RUN_ID__ || 0;
      const res = await fetch(`${API_BASE_URL}/allocations/index.php?action=notify_recipient`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ run_id: effRunId, recipient_id: rid })
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      // Lock UI for this recipient and reflect status change
      if (tb) {
        tb.querySelectorAll('.dr-qty').forEach((el) => { try { el.disabled = true; el.readOnly = true; } catch(_){} });
        tb.querySelectorAll('.dr-name').forEach((el) => { try { el.readOnly = true; el.setAttribute('aria-readonly','true'); el.setAttribute('tabindex','-1'); } catch(_){} });
        // Remove all per-item Remove buttons once notified
        tb.querySelectorAll('.dr-del').forEach((btn) => {
          try { btn.remove(); } catch(_){}
        });
        // Update all rows to notified status; update status badge only on header row
        tb.querySelectorAll('tr').forEach((tr) => {
          try {
            tr.setAttribute('data-status', 'notified');
            if (tr.classList && tr.classList.contains('dr-rec-header')) {
              const tds = tr.querySelectorAll('td');
              if (tds && tds[1]) {
                tds[1].innerHTML = "<span class='badge bg-info text-dark'>Notified</span>";
              }
            }
          } catch (_) {}
        });
        const headerNotify = container.querySelector(`.dr-notify-one[data-rec="${rid}"]`);
        if (headerNotify) headerNotify.classList.add('d-none');
        // Re-sync visibility based on new statuses
        try {
          const evt = new Event('dr-sync-notify', { bubbles: true });
          container.dispatchEvent(evt);
        } catch(_){}
      }
    } catch (e) {
      showMsg(feedback, 'Failed to notify recipient.', 'danger');
    }
  }
  container.addEventListener('click', function(e){
    const btn = e.target && (e.target.closest && e.target.closest('.dr-notify-one'));
    if (!btn) return;
    const rid = parseInt(btn.getAttribute('data-rec') || '0', 10) || 0;
    if (rid) notifyRecipient(rid);
  });

  // Async status polling with exponential backoff and visibility awareness
  let __DR_POLL_TIMER__ = null;
  const POLL_MIN_MS = 5000; // 5s min interval
  const POLL_MAX_MS = 60000; // 60s max interval
  const BACKOFF_FACTOR = 1.8; // exponential multiplier
  let pollInterval = POLL_MIN_MS;
  let unchangedCycles = 0;
  let lastPendingState = hasPending; // seed from initial render
  let pollingStopped = false;

  function releaseLockUI() {
    container.querySelectorAll(".dr-qty").forEach((el) => {
      el.disabled = false;
      el.readOnly = false;
    });
    container.querySelectorAll(".dr-name").forEach((el) => {
      el.readOnly = true;
      el.setAttribute("aria-readonly", "true");
      el.setAttribute("tabindex", "-1");
    });
  }

  function scheduleNextPoll() {
    if (pollingStopped) return;
    if (document.hidden) return; // only poll when tab is visible
    try {
      if (__DR_POLL_TIMER__) clearTimeout(__DR_POLL_TIMER__);
    } catch (_) {}
    __DR_POLL_TIMER__ = setTimeout(doPoll, pollInterval);
  }

  async function doPoll() {
    if (pollingStopped) return;
    if (document.hidden) {
      scheduleNextPoll();
      return;
    }
    if (__DR_DIRTY__) {
      scheduleNextPoll();
      return;
    }
    const effRunId = runId || window.__DR_RESOLVED_RUN_ID__ || 0;
    if (!effRunId) {
      scheduleNextPoll();
      return;
    }
    let changed = false;
    try {
      const listUrl = `${API_BASE_URL}/allocations/index.php?action=list_by_run&run_id=${encodeURIComponent(
        String(effRunId)
      )}&t=${Date.now()}`;
      const res = await fetch(listUrl, {
        credentials: "include",
        headers: { Accept: "application/json" },
      });
      const j = await res.json().catch(() => null);
      if (res.ok && j?.success) {
        const arr = Array.isArray(j?.data?.items) ? j.data.items : [];
        const pendingNow = arr.some(
          (a) => String(a.status || "").toLowerCase() === "pending"
        );
        const wantLocked = !pendingNow;
        if (pendingNow !== lastPendingState) {
          lastPendingState = pendingNow;
          changed = true;
          // Update UI to match new state
          if (wantLocked) {
            isLocked = true;
            document.getElementById("notifyRunBtn")?.classList.add("d-none");
            applyLock();
          } else {
            isLocked = false;
            document.getElementById("notifyRunBtn")?.classList.remove("d-none");
            releaseLockUI();
          }
        } else {
          // Keep button visibility consistent
          const btn = document.getElementById("notifyRunBtn");
          if (btn) {
            if (wantLocked) btn.classList.add("d-none");
            else btn.classList.remove("d-none");
          }
        }
      }
    } catch (_) {
      /* ignore errors; rely on backoff */
    }

    if (changed) {
      // Reset backoff on change
      pollInterval = POLL_MIN_MS;
      unchangedCycles = 0;
    } else {
      unchangedCycles++;
      // Increase interval up to a ceiling
      pollInterval = Math.min(
        POLL_MAX_MS,
        Math.floor(pollInterval * BACKOFF_FACTOR)
      );
      // Optional: fully stop after long inactivity; resume on visibility/user action
      if (unchangedCycles >= 12) {
        // ~ a few minutes depending on backoff
        pollingStopped = true;
        try {
          if (__DR_POLL_TIMER__) clearTimeout(__DR_POLL_TIMER__);
        } catch (_) {}
        __DR_POLL_TIMER__ = null;
        return;
      }
    }
    scheduleNextPoll();
  }

  // Resume polling on visibility gain or user action
  function resumePollingNow() {
    if (!document.hidden) {
      pollingStopped = false;
      pollInterval = POLL_MIN_MS;
      unchangedCycles = 0;
      try {
        if (__DR_POLL_TIMER__) clearTimeout(__DR_POLL_TIMER__);
      } catch (_) {}
      __DR_POLL_TIMER__ = null;
      doPoll();
    }
  }
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      try {
        if (__DR_POLL_TIMER__) clearTimeout(__DR_POLL_TIMER__);
      } catch (_) {}
      __DR_POLL_TIMER__ = null;
    } else {
      resumePollingNow();
    }
  });
  window.addEventListener("focus", resumePollingNow);
  container.addEventListener(
    "input",
    () => {
      /* resume if user interacts after dormancy */ if (pollingStopped)
        resumePollingNow();
    },
    { passive: true }
  );

  // Kick off first poll
  scheduleNextPoll();

  // Period search UI
  const pkInput = document.getElementById("periodKeyInput");
  const pkGo = document.getElementById("periodKeyGo");
  function isoWeekNumber(d) {
    // Sunday-first week-of-year (US-style)
    const year = d.getFullYear();
    const jan1 = new Date(year, 0, 1);
    const jan1Dow = jan1.getDay(); // 0=Sun
    const dayMs = 24 * 60 * 60 * 1000;
    const daysSince = Math.floor(
      (new Date(year, d.getMonth(), d.getDate()) - jan1) / dayMs
    );
    return Math.floor((daysSince + jan1Dow) / 7) + 1;
  }
  pkGo?.addEventListener("click", async () => {
    const raw = (pkInput?.value || "").trim();
    // Accept Wxx shorthand
    if (/^W\d{1,2}$/i.test(raw)) {
      const wTarget = parseInt(raw.replace(/^[Ww]/, ""), 10);
      try {
        let rows = [];
        if (
          window.AllocationsAPI &&
          typeof window.AllocationsAPI.listRuns === "function"
        ) {
          const jr = await window.AllocationsAPI.listRuns(24);
          rows = Array.isArray(jr?.data?.items)
            ? jr.data.items
            : Array.isArray(jr)
            ? jr
            : [];
        } else {
          const res = await fetch(
            `${API_BASE_URL}/allocations/index.php?action=list_runs&limit=24&t=${Date.now()}`,
            { credentials: "include", headers: { Accept: "application/json" } }
          );
          const j = await res.json().catch(() => null);
          rows = Array.isArray(j?.data?.items) ? j.data.items : [];
        }
        // Prefer current year, then fallback to any match
        const nowY = new Date().getFullYear();
        let match = rows.find(
          (r) => {
            const d = r.created_at ? new Date(r.created_at) : null;
            return d && d.getFullYear() === nowY && isoWeekNumber(d) === wTarget;
          }
        );
        if (!match) {
          match = rows.find(
            (r) => {
              const d = r.created_at ? new Date(r.created_at) : null;
              return d && isoWeekNumber(d) === wTarget;
            }
          );
        }
        if (match && match.period_key) {
          window.location.href = `DistributeResult.html?run_id=${encodeURIComponent(
            String(match.run_id)
          )}`;
          return;
        }
        // Show modal for no run found
        try {
          const mEl = document.getElementById("resultAlertModal");
          const bEl = document.getElementById("resultAlertBody");
          if (bEl)
            bEl.textContent = `No run found for week W${String(
              wTarget
            ).padStart(2, "0")}.`;
          if (mEl) {
            const m = new bootstrap.Modal(mEl);
            m.show();
          }
        } catch (_) {
          /* ignore */
        }
        return;
      } catch (e) {
        // Show modal for search failure
        try {
          const mEl = document.getElementById("resultAlertModal");
          const bEl = document.getElementById("resultAlertBody");
          if (bEl) bEl.textContent = "Failed to search weeks.";
          if (mEl) {
            const m = new bootstrap.Modal(mEl);
            m.show();
          }
        } catch (_) {
          /* ignore */
        }
      }
      return;
    }
    // Fallback to period_key format
    if (!/^\d{4}-\d{2}-W[1-4]$/.test(raw)) {
      // Show modal for invalid format
      try {
        const mEl = document.getElementById("resultAlertModal");
        const bEl = document.getElementById("resultAlertBody");
        if (bEl)
          bEl.textContent =
            "Enter week as Wxx or YYYY-MM-Wn (e.g., W38 or 2025-09-W3).";
        if (mEl) {
          const m = new bootstrap.Modal(mEl);
          m.show();
        }
      } catch (_) {
        /* ignore */
      }
      return;
    }
    // Redirect using period_key param (not run_id)
    window.location.href = `DistributeResult.html?period_key=${encodeURIComponent(
      String(raw)
    )}`;
  });

  // Hide Save Changes button per request (edits stay local unless other actions persist them)
  try {
    document.getElementById("saveChangesBtn")?.classList.add("d-none");
  } catch (_) {}

  // Utility: ensure a reusable delete-confirm modal exists
  function ensureDeleteConfirmModal() {
    let modal = document.getElementById("drDeleteConfirmModal");
    if (modal) return modal;
    modal = document.createElement("div");
    modal.id = "drDeleteConfirmModal";
    modal.className = "modal fade";
    modal.tabIndex = -1;
    modal.innerHTML = `
            <div class="modal-dialog modal-dialog-centered">
              <div class="modal-content">
                <div class="modal-header">
                  <h5 class="modal-title">Remove item</h5>
                  <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                </div>
                <div class="modal-body">
                  <p>Are you sure you want to remove this item from the allocation?</p>
                </div>
                <div class="modal-footer">
                  <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
                  <button type="button" class="btn btn-danger" id="drDeleteConfirmBtn">Remove</button>
                </div>
              </div>
            </div>`;
    document.body.appendChild(modal);
    return modal;
  }

  function confirmDelete() {
    return new Promise((resolve) => {
      try {
        const modalEl = ensureDeleteConfirmModal();
        const bsModal = new bootstrap.Modal(modalEl);
        const btn = modalEl.querySelector("#drDeleteConfirmBtn");
        const cleanup = () => {
          try {
            btn?.removeEventListener("click", onYes);
          } catch (_) {}
          try {
            modalEl?.removeEventListener("hidden.bs.modal", onHide);
          } catch (_) {}
        };
        const onYes = () => {
          cleanup();
          bsModal.hide();
          resolve(true);
        };
        const onHide = () => {
          cleanup();
          resolve(false);
        };
        btn?.addEventListener("click", onYes, { once: true });
        modalEl.addEventListener("hidden.bs.modal", onHide, { once: true });
        bsModal.show();
      } catch (_) {
        resolve(false);
      }
    });
  }

  // Dirty tracking
  let __DR_DIRTY__ = false;
  function markDirty() {
    __DR_DIRTY__ = true;
  }
  // Mark dirty when any existing editable input changes or delete is requested
  container.addEventListener("input", (e) => {
    const t = e.target;
    if (t && t.classList?.contains("dr-qty")) {
      if (isLocked) {
        e.preventDefault();
        return;
      }
      // Not locked: allow edit and mark as dirty
      markDirty();
    }
  });
  container.addEventListener("keydown", (e) => {
    if (isLocked && e.target.classList?.contains("dr-qty")) {
      e.preventDefault();
    }
    // Save on Enter key for convenience
    if (
      !isLocked &&
      e.target.classList?.contains("dr-qty")
    ) {
      if (e.key === "Enter") {
        e.preventDefault();
        try {
          e.target.blur();
        } catch (_) {}
      }
    }
  });

  // Toast helpers
  function ensureToastContainer() {
    let el = document.getElementById("drToastContainer");
    if (el) return el;
    el = document.createElement("div");
    el.id = "drToastContainer";
    el.className = "toast-container position-fixed top-0 end-0 p-3";
    document.body.appendChild(el);
    return el;
  }
  function showToast(message, type = "success", delayMs = 1800) {
    try {
      const cont = ensureToastContainer();
      const toast = document.createElement("div");
      const bg =
        type === "success"
          ? "text-bg-success"
          : type === "danger"
          ? "text-bg-danger"
          : type === "warning"
          ? "text-bg-warning"
          : "text-bg-info";
      toast.className = `toast align-items-center ${bg} border-0`;
      toast.setAttribute("role", "status");
      toast.setAttribute("aria-live", "polite");
      toast.setAttribute("aria-atomic", "true");
      toast.innerHTML = `
              <div class="d-flex">
                <div class="toast-body">${message}</div>
                <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button>
              </div>`;
      cont.appendChild(toast);
      const t = new bootstrap.Toast(toast, { delay: delayMs, autohide: true });
      toast.addEventListener(
        "hidden.bs.toast",
        () => {
          try {
            toast.remove();
          } catch (_) {}
        },
        { once: true }
      );
      t.show();
    } catch (_) {
      /* ignore toast failures */
    }
  }
  // Notify saver via toast
  function notifySaved(msg = "Edits saved.", type = "success") {
    showToast(msg, type);
  }

  function getRowName(tr) {
    if (!tr) return "";
    const ds = (tr.dataset?.name || "").trim();
    if (ds) return ds;
    const input = tr.querySelector(".dr-name");
    if (input) return (input.value || "").trim();
    return "";
  }

  // Auto-save on blur for name/qty edits
  async function saveRowIfNeeded(tr) {
    if (!tr) return;
    const itemId = parseInt(tr.getAttribute("data-item-id") || "0", 10) || 0;
    const allocId =
      parseInt(tr.getAttribute("data-allocation-id") || "0", 10) || 0;
    const name = getRowName(tr);
    const qty = Math.max(
      0,
      parseInt(tr.querySelector(".dr-qty")?.value || "0", 10) || 0
    );
    // If locked or no meaningful data, skip
    if (isLocked) return;
    try {
      if (itemId > 0) {
        // Existing item: update
        let ok = false;
        if (
          window.AllocationsAPI &&
          typeof window.AllocationsAPI.updateItem === "function"
        ) {
          await window.AllocationsAPI.updateItem(itemId, name, qty);
          ok = true;
        } else {
          const res = await fetch(
            `${API_BASE_URL}/allocations/index.php?action=update_item`,
            {
              method: "PATCH",
              credentials: "include",
              headers: {
                "Content-Type": "application/json",
                Accept: "application/json",
              },
              body: JSON.stringify({
                item_id: itemId,
                item_name: name,
                quantity: qty,
              }),
            }
          );
          const j = await res.json().catch(() => null);
          ok = !!(res.ok && j?.success);
          if (!ok) throw new Error(j?.error || `HTTP ${res.status}`);
        }
        if (ok) {
          __DR_DIRTY__ = false;
          notifySaved("Item updated.");
        }
      } else if (allocId && name && qty > 0) {
        // New row: add
        let newId = 0;
        let ok = false;
        if (
          window.AllocationsAPI &&
          typeof window.AllocationsAPI.addItem === "function"
        ) {
          await window.AllocationsAPI.addItem(
            allocId,
            name,
            null,
            qty
          );
          ok = true; // category null here
        } else {
          const res = await fetch(
            `${API_BASE_URL}/allocations/index.php?action=add_item`,
            {
              method: "POST",
              credentials: "include",
              headers: {
                "Content-Type": "application/json",
                Accept: "application/json",
              },
              body: JSON.stringify({
                allocation_id: allocId,
                item_name: name,
                quantity: qty,
              }),
            }
          );
          const j = await res.json().catch(() => null);
          ok = !!(res.ok && j?.success);
          if (ok) {
            newId = parseInt(j?.data?.item_id || j?.data?.id || "0", 10) || 0;
          }
          if (!ok) throw new Error(j?.error || `HTTP ${res.status}`);
        }
        if (ok) {
          if (newId) tr.setAttribute("data-item-id", String(newId));
          __DR_DIRTY__ = false;
          notifySaved("Item added.");
        }
      }
    } catch (err) {
      const em = err?.message || "Failed to save edit";
      showMsg(feedback, em, "danger");
      showToast(em, "danger", 2500);
    }
  }

  // Delegate blur handling to container (use capture so it fires reliably)
  container.addEventListener(
    "blur",
    (e) => {
      const t = e.target;
      if (!(t && t.classList?.contains("dr-qty"))) return;
      const tr = t.closest("tr");
      if (!tr) return;
      saveRowIfNeeded(tr);
    },
    true
  );
  container.addEventListener("click", async (e) => {
    if (isLocked) return;
    const btn = e.target?.closest?.(".dr-del");
    if (!btn) return;
    const tr = btn.closest("tr");
    if (!tr) return;
    const confirmed = await confirmDelete();
    if (!confirmed) return;
    const itemId = parseInt(tr.getAttribute("data-item-id") || "0", 10) || 0;
    if (itemId > 0) {
      try {
        if (
          window.AllocationsAPI &&
          typeof window.AllocationsAPI.deleteItem === "function"
        ) {
          await window.AllocationsAPI.deleteItem(itemId);
        } else {
          const res = await fetch(
            `${API_BASE_URL}/allocations/index.php?action=delete_item`,
            {
              method: "POST",
              credentials: "include",
              headers: {
                "Content-Type": "application/json",
                Accept: "application/json",
              },
              body: JSON.stringify({ item_id: itemId }),
            }
          );
          const j = await res.json().catch(() => null);
          if (!res.ok || !j?.success)
            throw new Error(j?.error || `HTTP ${res.status}`);
        }
        tr.remove();
      } catch (err) {
        const em = err?.message || "Failed to delete item";
        showMsg(feedback, em, "danger");
        showToast(em, "danger", 2500);
      }
    } else {
      // Unsaved row, just remove from DOM
      tr.remove();
    }
  });
  // Handlers: Save Changes, Notify All (run)
  container.querySelectorAll(".dr-del").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      if (isLocked) return;
      const tr = e.target.closest("tr");
      if (!tr) return;
      const confirmed = confirmDelete();
      if (!confirmed) return;
      const itemId = parseInt(tr.getAttribute("data-item-id") || "0", 10) || 0;
      if (itemId > 0) {
        try {
          if (
            window.AllocationsAPI &&
            typeof window.AllocationsAPI.deleteItem === "function"
          ) {
            await window.AllocationsAPI.deleteItem(itemId);
          } else {
            const res = await fetch(
              `${API_BASE_URL}/allocations/index.php?action=delete_item`,
              {
                method: "POST",
                credentials: "include",
                headers: {
                  "Content-Type": "application/json",
                  Accept: "application/json",
                },
                body: JSON.stringify({ item_id: itemId }),
              }
            );
            const j = await res.json().catch(() => null);
            if (!res.ok || !j?.success)
              throw new Error(j?.error || `HTTP ${res.status}`);
          }
          tr.remove();
        } catch (err) {
          const em = err?.message || "Failed to delete item";
          showMsg(feedback, em, "danger");
          showToast(em, "danger", 2500);
        }
      } else {
        // Unsaved row, just remove from DOM
        tr.remove();
      }
    });
  });

  // Per-recipient Notify button (manual notify) - delegated (single registration)
  container.addEventListener("click", async (e) => {
    const btn = e.target?.closest?.(".dr-notify-one");
    if (!btn) return;
    // Allow notifying even if UI is locked; it's a notification action only
    const rid = parseInt(btn.getAttribute("data-rec") || "0", 10) || 0;
    if (!rid) return;
    btn.disabled = true;
    const tb = container.querySelector(`tbody.dr-recipient[data-rec="${rid}"]`);
    if (!tb) {
      showToast("No recipient rows found.", "warning");
      return;
    }
    const parts = [];
    tb.querySelectorAll("tr").forEach((tr) => {
      const name = getRowName(tr);
      const qty = tr.querySelector(".dr-qty")?.value || "";
      const unit = tr.dataset.unit || "";
      if (name && qty) {
        const unitPart = unit ? ` ${unit}` : "";
        parts.push(`${qty}${unitPart} ${name}`.trim());
      }
    });
    const msg = parts.length
      ? `You have been allocated items. Check your Received Items. Items: ${parts
          .slice(0, 6)
          .join(", ")}${parts.length > 6 ? "…" : ""}`
      : "You have been allocated items. Check your Received Items.";

    // Send notification
    try {
      await fetch(
        `${API_BASE_URL}/communications/notifications.php?action=create`,
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
      showToast("Recipient notified.", "success");

      // Update UI and persist via shared helper
      const ok = await markRecipientNotified(rid, tb);
      if (!ok)
        showToast(
          "Notified locally but failed to persist on server.",
          "warning",
          3000
        );
    } catch (err) {
      showToast(err?.message || "Failed to notify recipient", "danger", 2500);
    } finally {
      try {
        btn.disabled = false;
      } catch (_) {}
    }
  });
  function collectEdits() {
    const rows = container.querySelectorAll("tbody.dr-recipient tr");
    const ops = { add: [], update: [], del: [] };
    rows.forEach((tr) => {
      const itemId = parseInt(tr.getAttribute("data-item-id") || "0", 10) || 0;
      const allocId =
        parseInt(tr.getAttribute("data-allocation-id") || "0", 10) || 0;
      const name = tr.querySelector(".dr-name")?.value?.trim() || "";
      const qty = Math.max(
        0,
        parseInt(tr.querySelector(".dr-qty")?.value || "0", 10) || 0
      );
      // rows already removed via delete handler won't be present here
      if (itemId) {
        ops.update.push({ item_id: itemId, item_name: name, quantity: qty });
      } else if (allocId && name && qty > 0) {
        ops.add.push({
          allocation_id: allocId,
          item_name: name,
          quantity: qty,
        });
      }
    });
    return ops;
  }

  document
    .getElementById("saveChangesBtn")
    ?.addEventListener("click", async () => {
      if (isLocked) return;
      try {
        const ops = collectEdits();
        if (!ops.add.length && !ops.update.length && !ops.del.length) {
          showMsg(feedback, "No changes to save.", "secondary");
          return;
        }
        let ok = 0,
          fail = 0;
        for (const a of ops.add) {
          try {
            if (
              window.AllocationsAPI &&
              typeof window.AllocationsAPI.addItem === "function"
            ) {
              await window.AllocationsAPI.addItem(
                a.allocation_id,
                a.item_name,
                a.category,
                a.quantity
              );
              ok++;
            } else {
              const res = await fetch(
                `${API_BASE_URL}/allocations/index.php?action=add_item`,
                {
                  method: "POST",
                  credentials: "include",
                  headers: {
                    "Content-Type": "application/json",
                    Accept: "application/json",
                  },
                  body: JSON.stringify(a),
                }
              );
              const j = await res.json().catch(() => null);
              if (res.ok && j?.success) ok++;
              else fail++;
            }
          } catch (_) {
            fail++;
          }
        }
        for (const u of ops.update) {
          try {
            if (
              window.AllocationsAPI &&
              typeof window.AllocationsAPI.updateItem === "function"
            ) {
              await window.AllocationsAPI.updateItem(
                u.item_id,
                u.item_name,
                u.quantity
              );
              ok++;
            } else {
              const res = await fetch(
                `${API_BASE_URL}/allocations/index.php?action=update_item`,
                {
                  method: "PATCH",
                  credentials: "include",
                  headers: {
                    "Content-Type": "application/json",
                    Accept: "application/json",
                  },
                  body: JSON.stringify(u),
                }
              );
              const j = await res.json().catch(() => null);
              if (res.ok && j?.success) ok++;
              else fail++;
            }
          } catch (_) {
            fail++;
          }
        }
        for (const d of ops.del) {
          try {
            if (
              window.AllocationsAPI &&
              typeof window.AllocationsAPI.deleteItem === "function"
            ) {
              await window.AllocationsAPI.deleteItem(d.item_id);
              ok++;
            } else {
              const res = await fetch(
                `${API_BASE_URL}/allocations/index.php?action=delete_item`,
                {
                  method: "POST",
                  credentials: "include",
                  headers: {
                    "Content-Type": "application/json",
                    Accept: "application/json",
                  },
                  body: JSON.stringify(d),
                }
              );
              const j = await res.json().catch(() => null);
              if (res.ok && j?.success) ok++;
              else fail++;
            }
          } catch (_) {
            fail++;
          }
        }
        // Success feedback via modal instead of inline alert
        try {
          const mEl = document.getElementById("resultAlertModal");
          const bEl = document.getElementById("resultAlertBody");
          if (bEl)
            bEl.textContent = fail
              ? `Saved ${ok} change${ok !== 1 ? "s" : ""}. Failed: ${fail}.`
              : `Saved ${ok} change${ok !== 1 ? "s" : ""}.`;
          if (mEl) {
            const m = new bootstrap.Modal(mEl);
            m.show();
          }
        } catch (_) {
          /* ignore */
        }
        if (fail === 0) {
          __DR_DIRTY__ = false;
        }
        // Reload to reflect new item IDs after short delay
        setTimeout(() => window.location.reload(), 900);
      } catch (e) {
        showMsg(feedback, e?.message || "Failed to save changes", "danger");
      }
    });

  // Helper: update UI to mark a recipient as notified and persist server-side
  async function markRecipientNotified(rid, tb) {
    if (!rid) return false;
    let persistOk = true;
    try {
      // Update rows and status badge: only header shows status text
      tb.querySelectorAll("tr").forEach((tr) => {
        try {
          tr.setAttribute("data-status", "notified");
          if (tr.classList && tr.classList.contains("dr-rec-header")) {
            const statusTd = tr.querySelector("td:nth-child(2)");
            if (statusTd)
              statusTd.innerHTML =
                "<span class='badge bg-info text-dark'>Notified</span>";
          }
        } catch (_) {}
      });

      // Remove per-item Remove buttons entirely and hide per-recipient bell
      tb.querySelectorAll(".dr-del").forEach((el) => {
        try {
          el.remove();
        } catch (_) {}
      });
      tb.querySelectorAll(".dr-notify-one").forEach((el) => {
        try {
          el.classList.add("d-none");
        } catch (_) {}
      });

      // Update Actions header visibility in case other rows changed
      try {
        updateActionsHeaderVisibility();
      } catch (_) {}

      // Persist notified state server-side for this recipient + run (best-effort)
      try {
        const effRunId = runId || window.__DR_RESOLVED_RUN_ID__ || 0;
        if (effRunId) {
          const resp = await fetch(
            `${API_BASE_URL}/allocations/index.php?action=notify_recipient`,
            {
              method: "POST",
              credentials: "include",
              headers: {
                "Content-Type": "application/json",
                Accept: "application/json",
              },
              body: JSON.stringify({ run_id: effRunId, recipient_id: rid }),
            }
          );
          const j2 = await resp.json().catch(() => null);
          if (!(resp.ok && j2?.success)) persistOk = false;
        }
      } catch (_) {
        persistOk = false;
      }
    } catch (_) {
      // UI attempt failed — still return persistOk flag (likely false)
    }
    return persistOk;
  }

  async function sendNotificationsForRun() {
    // Iterate recipients by tbody markers and post a concise notification
    const bodies = container.querySelectorAll("tbody.dr-recipient[data-rec]");
    let notifiedCount = 0;
    let persistFailures = 0;
    for (const tb of bodies) {
      const rid = parseInt(tb.getAttribute("data-rec") || "0", 10) || 0;
      if (!rid) {
        persistFailures++;
        continue;
      }
      // Skip recipients that have already been marked as notified (e.g. via
      // the single-recipient Notify button). This prevents duplicate
      // notifications if an admin clicks an individual Notify and later
      // clicks Notify All for the same run.
      const alreadyNotified = tb.querySelector('tr[data-status="notified"]');
      if (alreadyNotified) {
        continue;
      }
      const parts = [];
      tb.querySelectorAll("tr").forEach((tr) => {
        const name = getRowName(tr);
        const qty = tr.querySelector(".dr-qty")?.value || "";
        const unit = tr.dataset.unit || "";
        if (name && qty) {
          const unitPart = unit ? ` ${unit}` : "";
          parts.push(`${qty}${unitPart} ${name}`.trim());
        }
      });
      const msg = parts.length
        ? `You have been allocated items. Check your Received Items. Items: ${parts
            .slice(0, 6)
            .join(", ")}${parts.length > 6 ? "…" : ""}`
        : "You have been allocated items. Check your Received Items.";

      // Send notification (best-effort)
      try {
        await fetch(
          `${API_BASE_URL}/communications/notifications.php?action=create`,
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
      } catch (_) {
        /* ignore per-recipient failure */
      }

      // Update UI and persist via shared helper
      try {
        const ok = await markRecipientNotified(rid, tb);
        if (!ok) persistFailures++;
        else notifiedCount++;
      } catch (_) {
        persistFailures++;
      }
    }

    // Update Actions header visibility after mass changes
    try {
      updateActionsHeaderVisibility();
    } catch (_) {}

    // Summary toast
    if (notifiedCount > 0) {
      if (persistFailures === 0) showToast("Recipients notified.", "success");
      else
        showToast(
          `Notified ${notifiedCount} recipients, but failed to persist for ${persistFailures}.`,
          "warning",
          3500
        );
    } else {
      showToast("No recipients were notified.", "warning");
    }
  }
  // (duplicate notifyRunBtn listener removed)

  // (Cancel Run listener removed by request)
  // Dirty modal actions
  document.getElementById("dirtySaveNowBtn")?.addEventListener("click", () => {
    try {
      document.getElementById("saveChangesBtn")?.click();
    } catch (_) {
      /* ignore */
    }
  });
  // Expose notify helper for legacy inline handlers in the HTML
  try {
    if (
      typeof window !== "undefined" &&
      typeof sendNotificationsForRun === "function"
    ) {
      window.sendNotificationsForRun = sendNotificationsForRun;
    }
  } catch (_) {}
})();
