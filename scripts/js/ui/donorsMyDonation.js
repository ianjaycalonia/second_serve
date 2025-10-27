(function () {
  "use strict";

  const API_BASE_URL =
    typeof window.API_BASE_URL === "string" && window.API_BASE_URL
      ? window.API_BASE_URL
      : "/php/api";

  function badge(status) {
    switch (status) {
      case "Pending":
        return '<span class="badge bg-warning text-dark">Pending</span>';
      case "Acknowledged":
        return '<span class="badge bg-info text-dark">Acknowledged</span>';
      case "Picked Up":
        return '<span class="badge bg-primary">Picked Up</span>';
      case "Failed Safety":
        return '<span class="badge bg-danger">Failed Safety</span>';
      case "Completed":
        return '<span class="badge bg-success">Completed</span>';
      case "Cancelled":
        return '<span class="badge bg-dark">Cancelled</span>';
      default:
        return `<span class="badge bg-light text-dark">${
          status || "Unknown"
        }</span>`;
    }
  }

  function ensureToastContainer() {
    let cont = document.getElementById("globalToastContainer");
    if (!cont) {
      cont = document.createElement("div");
      cont.id = "globalToastContainer";
      cont.className = "toast-container position-fixed top-0 end-0 p-3";
      document.body.appendChild(cont);
    }
    return cont;
  }
  function showError(message) {
    try {
      const cont = ensureToastContainer();
      const toast = document.createElement("div");
      toast.className = "toast align-items-center text-white bg-danger border-0";
      toast.setAttribute("role", "alert");
      toast.setAttribute("aria-live", "assertive");
      toast.setAttribute("aria-atomic", "true");
      toast.innerHTML = `
        <div class="d-flex">
          <div class="toast-body">${(message||'').toString()}</div>
          <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button>
        </div>`;
      cont.appendChild(toast);
      if (window.bootstrap?.Toast) {
        const t = new bootstrap.Toast(toast, { delay: 2500 });
        t.show();
      } else {
        // Fallback: simple non-blocking removal
        toast.style.display = 'block';
        setTimeout(()=>{ try{ toast.remove(); }catch(_){} }, 3000);
      }
    } catch (_) { try { console.error(message); } catch(_){} }
  }

  function batchItemRowTemplate(it) {
    const id = it.id || 0;
    const name = escapeHtml(it.name || "");
    const qty = (it.quantity !== undefined && it.quantity !== null && it.quantity !== '') ? it.quantity : 1;
    const expiry = escapeHtml(it.expiry_date || "");
    const cost = (it && it.total_cost != null && it.total_cost !== "") ? Number(it.total_cost) : "";
    return `
      <div class="card p-3 border batch-item-row position-relative" data-id="${
        id > 0 ? id : ""
      }">
        <button type="button" class="btn btn-sm btn-outline-danger position-absolute top-0 end-0 m-2 remove-batch-item z-1" style="z-index: 1;" data-bs-toggle="tooltip" title="Remove Item" aria-label="Remove Item">
          <i class="bi bi-trash"></i>
        </button>
        <div class="row g-2 align-items-end">
          <div class="col-12 col-md-6">
            <label class="form-label mb-1">Item Name</label>
            <select class="form-select batch-item-name" data-initial="${name}" data-placeholder="Search or type new" required></select>
          </div>
          <div class="col-6 col-md-2">
            <label class="form-label mb-1">Quantity</label>
            <input type="number" class="form-control batch-item-qty" min="1" value="${qty}" required>
          </div>
          <div class="col-6 col-md-2">
            <label class="form-label mb-1">Cost (₱)</label>
            <input type="number" class="form-control batch-item-cost" step="0.01" min="0" value="${cost}">
          </div>
          <div class="col-6 col-md-2">
            <label class="form-label mb-1">Expiry Date</label>
            <input type="date" class="form-control batch-item-expiry" value="${expiry}" required>
          </div>
        </div>
      </div>`;
  }

  function initBatchItemSelect2($scope) {
    if (!window.jQuery || !window.jQuery.fn.select2) return;
    const $parent = window.jQuery('#editBatchModal');
    $scope.find('select.batch-item-name').each(function(){
      const $sel = window.jQuery(this);
      if ($sel.hasClass('select2-hidden-accessible')) return;
      const placeholder = $sel.data('placeholder') || 'Search or type new';
      $sel.select2({
        tags: true,
        width: '100%',
        placeholder,
        dropdownParent: $parent,
        minimumInputLength: 1,
        ajax: {
          delay: 250,
          url: `${API_BASE_URL}/donations/index.php/items`,
          dataType: 'json',
          data: (params) => ({ q: params.term || '', limit: 20 }),
          processResults: (data) => {
            const items = data && data.items ? data.items : [];
            return { results: items.map((n) => ({ id: n, text: n })) };
          },
          cache: true,
        },
        createTag: function (params) {
          const term = (params.term || '').trim();
          if (term === '') return null;
          return { id: term, text: term, newTag: true };
        },
      });
      const initial = $sel.data('initial') || '';
      if (initial) {
        if (!$sel.find(`option[value="${initial.replace(/"/g, '&quot;')}"]`).length) {
          $sel.append(new Option(initial, initial, true, true));
        }
        $sel.val(initial).trigger('change');
      }
    });
  }

  async function openBatchEditModal(batchId) {
    try {
      const res = await fetch(
        `${API_BASE_URL}/donations/index.php/batch/${batchId}`,
        {
          method: "GET",
          credentials: "include",
        }
      );
      const data = await res.json();
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || "HTTP " + res.status);
      }
      const items = data?.data?.items || [];
      const cont = document.getElementById("batchItemsContainer");
      cont.innerHTML = items.map((it) => batchItemRowTemplate(it)).join("");
      if (window.jQuery) { initBatchItemSelect2(window.jQuery(cont)); }
      // Initialize tooltips for remove buttons
      try {
        const tooltipTriggerList = Array.prototype.slice.call(
          cont.querySelectorAll('[data-bs-toggle="tooltip"]')
        );
        tooltipTriggerList.forEach(function (el) {
          const existing = bootstrap.Tooltip.getInstance(el);
          if (existing) existing.dispose();
          new bootstrap.Tooltip(el);
        });
      } catch (_) {
        /* ignore */
      }
      document.getElementById("editBatchId").value = batchId;
      const m = new bootstrap.Modal(document.getElementById("editBatchModal"));
      m.show();
    } catch (e) {
      console.error("Failed to open batch edit", e);
      showError("Failed to open batch editor: " + (e?.message || "Unknown error"));
    }
  }

  // Submit batch edit
  (function () {
    const btn = document.getElementById("submitBatchEditBtn");
    if (!btn) return;
    btn.addEventListener("click", async function () {
      const batchId = document.getElementById("editBatchId").value;
      const rows = document.querySelectorAll(
        "#batchItemsContainer .batch-item-row"
      );
      const items = [];
      for (const row of rows) {
        const idAttr = row.getAttribute("data-id");
        const id = idAttr ? parseInt(idAttr, 10) : 0;
        const name = window.jQuery
          ? String(window.jQuery(row).find('.batch-item-name').val() || '')
          : (row.querySelector('.batch-item-name')?.value || '');
        const qty = parseInt(row.querySelector(".batch-item-qty").value, 10);
        const costStr = (row.querySelector(".batch-item-cost")?.value || "").trim();
        const cost = costStr === "" ? null : Number(costStr);
        const expiry = row.querySelector(".batch-item-expiry").value;
        if (!name || !qty || qty < 1 || !expiry) {
          showError("Please ensure all items have name, quantity (>=1), and expiry.");
          return;
        }
        items.push({
          id: id > 0 ? id : 0,
          name,
          quantity: qty,
          expiry_date: expiry,
          total_cost: cost,
        });
      }
      btn.disabled = true;
      try {
        const res = await fetch(
          `${API_BASE_URL}/donations/index.php/batch/${batchId}/edit?_method=PUT`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-HTTP-Method-Override": "PUT",
            },
            credentials: "include",
            body: JSON.stringify({ items }),
          }
        );
        const text = await res.text();
        let j;
        try {
          j = JSON.parse(text);
        } catch (_) {
          j = { success: false, error: "Invalid response", _raw: text };
        }
        if (!res.ok || !j.success) {
          const msg = j.error || `HTTP ${res.status}`;
          throw new Error(
            msg + (j._raw ? `\nServer said: ${j._raw.slice(0, 200)}` : "")
          );
        }
        bootstrap.Modal.getInstance(
          document.getElementById("editBatchModal")
        ).hide();
        await reloadList();
        showSuccess("Batch updated");
      } catch (err) {
        showError("Failed to save batch: " + (err?.message || "Unknown error"));
      } finally {
        btn.disabled = false;
      }
    });
  })();

  function fmtDateTime(s) {
    if (!s) return "";
    const d = new Date(s);
    return isNaN(d) ? s : d.toLocaleString();
  }

  function escapeHtml(str) {
    return (str || "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        }[c])
    );
  }

  function capFirst(str) {
    if (!str) return "";
    try {
      str = String(str);
    } catch (_) {
      return "";
    }
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  function showSuccess(message) {
    try {
      const msgEl = document.getElementById("successModalMessage");
      if (msgEl && typeof message === "string" && message.trim() !== "") {
        msgEl.textContent = message;
      }
      const modalEl = document.getElementById("successModal");
      if (modalEl && window.bootstrap) {
        const m = new bootstrap.Modal(modalEl);
        m.show();
      }
    } catch (_) {
      /* no-op */
    }
  }

  async function fetchAll() {
    const res = await fetch(`${API_BASE_URL}/donations/index.php/list`, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const json = await res.json();
    return json?.data?.items || [];
  }

  function groupByBatch(items) {
    const groups = new Map();
    for (const r of items) {
      const key = r.batch_id ? `b-${r.batch_id}` : `s-${r.id}`;
      if (!groups.has(key))
        groups.set(key, {
          batch_id: r.batch_id || null,
          items: [],
          created_at: r.created_at,
        });
      groups.get(key).items.push(r);
      // track representative created_at for sorting: latest within group
      const t = groups.get(key);
      if (!t.created_at || (r.created_at && r.created_at > t.created_at))
        t.created_at = r.created_at;
    }
    // Sort groups by created_at desc
    return Array.from(groups.values()).sort((a, b) =>
      (b.created_at || "").localeCompare(a.created_at || "")
    );
  }

  function render(groups) {
    const tbody = document.querySelector(".table tbody");
    if (!tbody) return;
    if (!groups.length) {
      tbody.innerHTML =
        '<tr><td colspan="4" class="text-center">No donations logged yet.</td></tr>';
      return;
    }

    let html = "";
    groups.forEach((group) => {
      const isBatch = !!group.batch_id;
      if (isBatch) {
        const count = group.items.length;
        const first = group.items[0] || {};
        const title = `Batch • ${count} item${count > 1 ? "s" : ""}`;
        const anyPending = group.items.some(
          (it) => String(it.status || "").toLowerCase() === "pending"
        );
        html += `
          <tr class="group-row" data-batch-id="${group.batch_id}">
            <td>${escapeHtml(first.type || "")}</td>
            <td>
              <div class="fw-semibold"><button class="btn btn-sm btn-outline-secondary me-2 batch-toggle" type="button" aria-label="Toggle" data-bs-toggle="tooltip" title="Expand to view items">Show</button>${title}</div>
            </td>
            <td class="status-col">${badge(first.status || "Pending")}</td>
            <td>${
              ["pending", "cancelled"].includes(
                String(first.status || "").toLowerCase()
              )
                ? "—"
                : fmtDateTime(group.created_at)
            }</td>
            <td>
              <div class="d-flex align-items-center justify-content-center gap-2">
                ${
                  anyPending
                    ? `
                  <button class="btn btn-sm btn-outline-primary edit-batch" data-batch-id="${
                    group.batch_id
                  }" data-category="${escapeHtml(
                        first.type || ""
                      )}" data-bs-toggle="tooltip" title="Edit Batch" aria-label="Edit Batch">
                    <i class="bi bi-pencil-square"></i>
                  </button>
                  <button class="btn btn-sm btn-outline-danger cancel-batch" data-batch-id="${
                    group.batch_id
                  }" data-bs-toggle="tooltip" title="Cancel Batch" aria-label="Cancel Batch">
                    <i class="bi bi-x-octagon"></i>
                  </button>
                `
                    : ""
                }
              </div>
            </td>
          </tr>
          <tr class="child-container d-none" data-batch-id="${group.batch_id}">
            <td colspan="4" class="p-0">
              <table class="table table-sm mb-0">
                <thead>
                  <tr class="table-light">
                    <th>Item</th>
                    <th>Quantity</th>
                    <th>Expiry</th>
                    <th>Status</th>
                    <th>Reason</th>
                  </tr>
                </thead>
                <tbody>
                  ${group.items
                    .map((r) => {
                      const isPending =
                        String(r.status || "").toLowerCase() === "pending";
                      return `
                    <tr>
                      <td>${escapeHtml(r.name || "")}</td>
                      <td>${r.quantity ?? ""}</td>
                      <td>${escapeHtml(r.expiry_date || "")}</td>
                      <td class="text-center status-col">${badge(r.status)}</td>
                      <td>${
                        r.cancel_reason
                          ? escapeHtml(r.cancel_reason)
                          : r.fail_reason
                          ? escapeHtml(r.fail_reason)
                          : (r.status || "") === "Failed Safety"
                          ? "Failed safety check"
                          : "—"
                      }</td>
                    </tr>
                  `;
                    })
                    .join("")}
                </tbody>
              </table>
            </td>
          </tr>
        `;
      } else {
        const r = group.items[0];
        const isPending = String(r.status || "").toLowerCase() === "pending";
        html += `
          <tr>
            <td>${escapeHtml(r.type || "")}</td>
            <td>${escapeHtml(r.name || "")}</td>
            <td class="text-center status-col">${badge(r.status)}</td>
            <td>${
              ["pending", "cancelled"].includes(
                String(r.status || "").toLowerCase()
              )
                ? "—"
                : fmtDateTime(r.created_at)
            }</td>
            <td>
              ${
                isPending
                  ? `
                <button class="btn btn-sm btn-outline-primary me-1 edit-donation" data-id="${
                  r.id
                }" data-type="${escapeHtml(
                      r.type || ""
                    )}" data-name="${escapeHtml(r.name || "")}" data-qty="${
                      r.quantity ?? ""
                    }" data-expiry="${escapeHtml(
                      r.expiry_date || ""
                    )}" data-bs-toggle="tooltip" title="Edit" aria-label="Edit">
                  <i class="bi bi-pencil-square"></i>
                </button>
              `
                  : ""
              }
            </td>
          </tr>
        `;
      }
    });

    tbody.innerHTML = html;
    // Initialize Bootstrap tooltips for dynamically added icon buttons
    try {
      const tooltipTriggerList = Array.prototype.slice.call(
        document.querySelectorAll('[data-bs-toggle="tooltip"]')
      );
      tooltipTriggerList.forEach(function (el) {
        // If a tooltip instance already exists, dispose before re-initializing
        const existing = bootstrap.Tooltip.getInstance(el);
        if (existing) existing.dispose();
        new bootstrap.Tooltip(el);
      });
    } catch (_) {
      /* no-op if bootstrap tooltip not available */
    }
  }

  let eventsBound = false;
  function bindEvents() {
    if (eventsBound) return;
    eventsBound = true;

    function initEditNameSelect2() {
      const $sel = window.jQuery && window.jQuery('#editNameSelect');
      if (!$sel || !$sel.length || !window.jQuery.fn.select2) return;
      if ($sel.hasClass('select2-hidden-accessible')) return; // already
      $sel.select2({
        tags: true,
        width: '100%',
        placeholder: $sel.data('placeholder') || 'Search or type new',
        dropdownParent: window.jQuery('#editDonationModal'),
        minimumInputLength: 1,
        ajax: {
          delay: 250,
          url: `${API_BASE_URL}/donations/index.php/items`,
          dataType: 'json',
          data: (params) => ({ q: params.term || '', limit: 20 }),
          processResults: (data) => {
            const items = data && data.items ? data.items : [];
            return { results: items.map((n) => ({ id: n, text: n })) };
          },
          cache: true,
        },
        createTag: function (params) {
          const term = (params.term || '').trim();
          if (term === '') return null;
          return { id: term, text: term, newTag: true };
        },
      });
    }
    document.addEventListener("click", function (e) {
      const t = e.target;
      // Toggle batch children
      const batchBtn = t.closest(".batch-toggle");
      if (batchBtn) {
        const row = batchBtn.closest("tr.group-row");
        const batchId = row?.getAttribute("data-batch-id");
        if (!batchId) return;
        const child = document.querySelector(
          `tr.child-container[data-batch-id="${batchId}"]`
        );
        if (!child) return;
        const showing = !child.classList.contains("d-none");
        child.classList.toggle("d-none", showing);
        // Update button label
        const isNowHidden = child.classList.contains("d-none");
        batchBtn.textContent = isNowHidden ? "Show" : "Hide";
        // Update tooltip to reflect action
        const newTitle = isNowHidden
          ? "Expand to view items"
          : "Collapse items";
        batchBtn.setAttribute("title", newTitle);
        batchBtn.setAttribute("aria-label", isNowHidden ? "Show" : "Hide");
        // Refresh Bootstrap tooltip content
        try {
          const tip = bootstrap.Tooltip.getInstance(batchBtn);
          if (tip && typeof tip.setContent === "function") {
            tip.setContent({ ".tooltip-inner": newTitle });
          } else if (tip) {
            tip.dispose();
            new bootstrap.Tooltip(batchBtn);
          } else {
            new bootstrap.Tooltip(batchBtn);
          }
        } catch (_) {
          /* ignore if tooltip not available */
        }
        return;
      }

      // Open Edit modal
      const editBtn = t.closest(".edit-donation");
      if (editBtn) {
        const id = editBtn.getAttribute("data-id");
        const name = editBtn.getAttribute("data-name") || "";
        const qty = editBtn.getAttribute("data-qty") || "";
        const expiry = editBtn.getAttribute("data-expiry") || "";
        const m = new bootstrap.Modal(
          document.getElementById("editDonationModal")
        );
        document.getElementById("editDonationId").value = id;
        // Initialize Select2 and set current value
        initEditNameSelect2();
        if (window.jQuery) {
          const $sel = window.jQuery('#editNameSelect');
          const escaped = name.replace(/"/g, '&quot;');
          if (!$sel.find(`option[value="${escaped}"]`).length) {
            $sel.append(new Option(name, name, true, true));
          }
          $sel.val(name).trigger('change');
        } else {
          const sel = document.getElementById('editNameSelect');
          if (sel) sel.value = name;
        }
        document.getElementById("editQuantity").value = qty;
        document.getElementById("editExpiry").value = expiry || "";
        // Cost is not available from list payload; leave blank for optional update
        const costEl = document.getElementById("editCost"); if (costEl) costEl.value = "";
        m.show();
        return;
      }

      // Open Cancel modal
      const cancelBtn = t.closest(".cancel-donation");
      if (cancelBtn) {
        const id = cancelBtn.getAttribute("data-id");
        const m = new bootstrap.Modal(
          document.getElementById("cancelDonationModal")
        );
        document.getElementById("cancelDonationId").value = id;
        const b = document.getElementById("cancelBatchId");
        if (b) b.value = "";
        document.getElementById("cancelReason").value = "";
        m.show();
        return;
      }

      // Open Cancel Batch modal
      const cancelBatchBtn = t.closest(".cancel-batch");
      if (cancelBatchBtn) {
        const batchId = cancelBatchBtn.getAttribute("data-batch-id");
        const m = new bootstrap.Modal(
          document.getElementById("cancelDonationModal")
        );
        const d = document.getElementById("cancelDonationId");
        if (d) d.value = "";
        const b = document.getElementById("cancelBatchId");
        if (b) b.value = batchId || "";
        document.getElementById("cancelReason").value = "";
        m.show();
        return;
      }

      // Open Edit Batch modal
      const editBatchBtn = t.closest(".edit-batch");
      if (editBatchBtn) {
        const batchId = editBatchBtn.getAttribute("data-batch-id");
        openBatchEditModal(batchId);
        return;
      }

      // Remove batch item row
      const removeItemBtn = t.closest(".remove-batch-item");
      if (removeItemBtn) {
        const row = removeItemBtn.closest(".batch-item-row");
        if (row) {
          row.remove();
        }
        return;
      }

      // Add new batch item (delegated handler ensures it works even if button is rendered after bind)
      const addItemBtn = t.closest("#addBatchItemBtn");
      if (addItemBtn) {
        const cont = document.getElementById("batchItemsContainer");
        if (!cont) return;
        cont.insertAdjacentHTML(
          "beforeend",
          batchItemRowTemplate({
            id: 0,
            name: "",
            quantity: 1,
            expiry_date: "",
          })
        );
        if (window.jQuery) { initBatchItemSelect2(window.jQuery(cont)); }
        // Initialize tooltip for the newly added remove button
        try {
          const lastCard = cont.lastElementChild;
          if (lastCard) {
            const btn = lastCard.querySelector('[data-bs-toggle="tooltip"]');
            if (btn) {
              const existing = bootstrap.Tooltip.getInstance(btn);
              if (existing) existing.dispose();
              new bootstrap.Tooltip(btn);
            }
          }
        } catch (_) {
          /* ignore */
        }
        return;
      }
    });

    // Save edit
    const saveBtn = document.getElementById("saveEditDonationBtn");
    if (saveBtn) {
      saveBtn.addEventListener("click", async function () {
        const id = document.getElementById("editDonationId").value;
        const expiryVal = document.getElementById("editExpiry").value;
        const payload = {
          name: (window.jQuery
            ? String(window.jQuery('#editNameSelect').val() || '')
            : String(document.getElementById('editNameSelect')?.value || '')
          ).trim(),
          quantity: parseInt(document.getElementById("editQuantity").value, 10),
          expiry_date: expiryVal,
          total_cost: (function(){ const v = (document.getElementById("editCost")?.value||"").trim(); return v===""? null : Number(v); })(),
        };
        if (!payload.name || !payload.quantity || payload.quantity < 1 || !expiryVal) {
          showError("Please provide a valid name, quantity, and expiry date.");
          return;
        }
        saveBtn.disabled = true;
        try {
          const res = await fetch(
            `${API_BASE_URL}/donations/index.php/${id}?_method=PUT`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "X-HTTP-Method-Override": "PUT",
              },
              credentials: "include",
              body: JSON.stringify(payload),
            }
          );
          const text = await res.text();
          let j;
          try {
            j = JSON.parse(text);
          } catch (_) {
            j = { success: false, error: "Invalid response", _raw: text };
          }
          if (!res.ok || !j.success) {
            const msg = j.error || `HTTP ${res.status}`;
            throw new Error(
              msg + (j._raw ? `\nServer said: ${j._raw.slice(0, 200)}` : "")
            );
          }
          bootstrap.Modal.getInstance(
            document.getElementById("editDonationModal")
          ).hide();
          await reloadList();
          showSuccess("Donation updated");
        } catch (err) {
          showError("Failed to update donation: " + (err?.message || "Unknown error"));
        } finally {
          saveBtn.disabled = false;
        }
      });
    }

    // Confirm cancel
    const confirmCancel = document.getElementById("confirmCancelDonationBtn");
    if (confirmCancel) {
      confirmCancel.addEventListener("click", async function () {
        const id = (
          document.getElementById("cancelDonationId")?.value || ""
        ).trim();
        const batchId = (
          document.getElementById("cancelBatchId")?.value || ""
        ).trim();
        const reason = (
          document.getElementById("cancelReason").value || ""
        ).trim();
        if (!reason) { showError("Please provide a reason for cancellation."); return; }
        confirmCancel.disabled = true;
        try {
          if (batchId) {
            // Fetch batch items, then cancel pending ones
            const res = await fetch(
              `${API_BASE_URL}/donations/index.php/batch/${batchId}`,
              {
                method: "GET",
                credentials: "include",
              }
            );
            const data = await res.json();
            if (!res.ok || !data?.success) {
              throw new Error(data?.error || "HTTP " + res.status);
            }
            const items = data?.data?.items || [];
            const pendingIds = items
              .filter(
                (it) => String(it.status || "").toLowerCase() === "pending"
              )
              .map((it) => it.id);
            for (const did of pendingIds) {
              const r = await fetch(
                `${API_BASE_URL}/donations/index.php/${did}/cancel`,
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  credentials: "include",
                  body: JSON.stringify({ reason }),
                }
              );
              if (!r.ok) {
                const t = await r.text();
                let j;
                try {
                  j = JSON.parse(t);
                } catch (_) {
                  j = { error: t };
                }
                throw new Error(j?.error || `HTTP ${r.status}`);
              }
            }
          } else if (id) {
            const res = await fetch(
              `${API_BASE_URL}/donations/index.php/${id}/cancel`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({ reason }),
              }
            );
            const text = await res.text();
            let j;
            try {
              j = JSON.parse(text);
            } catch (_) {
              j = { success: false, error: "Invalid response", _raw: text };
            }
            if (!res.ok || !j.success) {
              const msg = j.error || `HTTP ${res.status}`;
              throw new Error(
                msg + (j._raw ? `\nServer said: ${j._raw.slice(0, 200)}` : "")
              );
            }
          } else { showError("Nothing to cancel."); return; }
          bootstrap.Modal.getInstance(
            document.getElementById("cancelDonationModal")
          ).hide();
          await reloadList();
          showSuccess(batchId ? "Batch cancelled" : "Donation cancelled");
        } catch (err) {
          showError("Failed to cancel donation(s): " + (err?.message || "Unknown error"));
        } finally {
          confirmCancel.disabled = false;
        }
      });
    }
  }

  async function reloadList() {
    try {
      const items = await fetchAll();
      const groups = groupByBatch(items);
      render(groups);
    } catch (e) {
      console.error("Reload failed", e);
    }
  }

  async function init() {
    try {
      const items = await fetchAll();
      // Attach absolute image URLs are already provided by API as image_full_url in index.php list
      // Group by batch and render all
      const groups = groupByBatch(items);
      render(groups);
      bindEvents();

      // KPI counters (batch-based)
      const pendingStatuses = new Set(["Pending", "Acknowledged", "Picked Up"]);
      const batchGroups = groups.filter((g) => !!g.batch_id);
      const total = batchGroups.length;
      const pending = batchGroups.filter((g) =>
        g.items.some((it) => pendingStatuses.has(it.status || ""))
      ).length;
      const completed = batchGroups.filter(
        (g) =>
          g.items.length > 0 &&
          g.items.every((it) => (it.status || "") === "Completed")
      ).length;
      const elTotal = document.getElementById("totalDonationsCount");
      const elPending = document.getElementById("pendingPickupsCount");
      const elArrived = document.getElementById("successfulDeliveriesCount");
      if (elTotal) elTotal.textContent = String(total);
      if (elPending) elPending.textContent = String(pending);
      if (elArrived) elArrived.textContent = String(completed);
    } catch (e) {
      console.error("Failed to load donations", e);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
