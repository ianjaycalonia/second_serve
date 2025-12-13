(function () {
  // Use the flattened project root
  const API_ROOT = (window.API_BASE_URL || "php/api").replace(/^\//, "");
  const API_BASE = API_ROOT + "/taxonomy/index.php";

  function authHeaders() {
    return { "Content-Type": "application/json" };
  }
  async function apiGet(path, params) {
    const qs = params ? "?" + new URLSearchParams(params).toString() : "";
    const res = await fetch(API_BASE + path + qs, { credentials: "include" });
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      throw new Error("Unexpected response: " + text.slice(0, 120));
    }
  }

  function openDeactivateModal({ type, id, name }) {
    pendingDeactivate = { type, id };
    if (deactivateText) {
      deactivateText.textContent =
        type === "category"
          ? `Deactivate category “${name || "this category"}”?`
          : `Deactivate unit “${name || "this unit"}”?`;
    }
    if (deactivateConfirmBtn) {
      deactivateConfirmBtn.disabled = false;
      deactivateConfirmBtn.textContent = "Deactivate";
    }
    if (deactivateModal && window.bootstrap?.Modal) {
      window.bootstrap.Modal.getOrCreateInstance(deactivateModal).show();
    } else {
      const fallback = window.confirm(
        type === "category"
          ? `Deactivate category "${name}"?`
          : `Deactivate unit "${name}"?`
      );
      if (fallback) {
        handleDeactivateConfirmed();
      } else {
        pendingDeactivate = null;
      }
    }
  }

  async function handleDeactivateConfirmed() {
    if (!pendingDeactivate) return;
    const { type, id } = pendingDeactivate;
    const endpoint = type === "category" ? `/categories/${id}` : `/units/${id}`;
    const label = type === "category" ? "Category" : "Unit";
    let originalText = null;
    try {
      if (deactivateConfirmBtn) {
        originalText = deactivateConfirmBtn.textContent;
        deactivateConfirmBtn.disabled = true;
        deactivateConfirmBtn.textContent = "Deactivating...";
      }
      await apiSend("DELETE", endpoint);
      showToast(`${label} deactivated`, "success");
      if (deactivateModal && window.bootstrap?.Modal) {
        window.bootstrap.Modal.getOrCreateInstance(deactivateModal).hide();
      }
      if (type === "category") {
        loadCategories();
      } else {
        loadUnits();
      }
    } catch (err) {
      showToast(String(err?.message || err || "Failed to deactivate"), "danger");
    } finally {
      if (deactivateConfirmBtn) {
        deactivateConfirmBtn.disabled = false;
        deactivateConfirmBtn.textContent = originalText || "Deactivate";
      }
      pendingDeactivate = null;
    }
  }
  async function apiSend(method, path, body) {
    const res = await fetch(API_BASE + path, {
      method,
      headers: authHeaders(),
      credentials: "include",
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error("Unexpected response: " + text.slice(0, 120));
      }
    }

    const success = data && typeof data === "object" ? data.success : undefined;
    if (!res.ok || success === false) {
      const message =
        (data && typeof data === "object" && (data.error || data.message)) ||
        `Request failed (HTTP ${res.status})`;
      const err = new Error(message);
      err.status = res.status;
      err.data = data;
      throw err;
    }

    return data;
  }

  // Categories
  const catBody = document.getElementById("catTableBody");
  const catSearch = document.getElementById("catSearch");
  const catActive = document.getElementById("catActiveFilter");
  const catAddBtn = document.getElementById("catAddBtn");
  const catEditModal = document.getElementById("catEditModal");
  const catEditTitle = document.getElementById("catEditTitle");
  const catCodeInput = document.getElementById("catCodeInput");
  const catPrimaryInput = document.getElementById("catPrimaryInput");
  const catSecondaryInput = document.getElementById("catSecondaryInput");
  const catEditFeedback = document.getElementById("catEditFeedback");

  let editingCatId = null;

  function initTableTooltips(root) {
    try {
      if (!root || !(window.bootstrap && bootstrap.Tooltip)) return;
      const els = [].slice.call(root.querySelectorAll('[data-bs-toggle="tooltip"]'));
      els.forEach((el) => {
        try {
          const existing = bootstrap.Tooltip.getInstance(el);
          if (existing) existing.dispose();
          const cls =
            (el.closest && el.closest("table"))
              ? "table-tooltip"
              : (el.getAttribute && el.getAttribute("data-bs-custom-class")) || "custom-tooltip";
          bootstrap.Tooltip.getOrCreateInstance(el, {
            customClass: cls,
            container: "body",
            boundary: "viewport",
            fallbackPlacements: ["right", "left", "bottom", "top"],
            trigger: "hover focus",
            delay: { show: 150, hide: 50 },
          });
        } catch (_) {}
      });
    } catch (_) {}
  }

  async function loadCategories() {
    if (!catBody) return;
    catBody.innerHTML =
      '<tr><td colspan="5" class="text-center text-muted py-3">Loading...</td></tr>';
    try {
      const data = await apiGet("/categories", {
        q: catSearch.value.trim(),
        active: catActive.value,
      });
      const items = data && data.items ? data.items : [];
      if (!items.length) {
        catBody.innerHTML =
          '<tr><td colspan="5" class="text-center text-muted py-3">No categories</td></tr>';
        return;
      }
      catBody.innerHTML = items
        .map(
          (c) =>
            `<tr class="${c.is_active ? "" : "table-light text-muted"}">
        <td>${escapeHtml(c.code || "")}</td>
        <td>${escapeHtml(c.primary_name || "")}</td>
        <td>${escapeHtml(c.secondary_name || "")}</td>
        <td>${
          c.is_active
            ? "Yes"
            : '<span class="badge text-bg-secondary">Inactive</span>'
        }</td>
        <td class="fit-content">
          <button class="btn btn-sm btn-outline-secondary me-1" data-action="cat-edit" data-id="${
            c.category_id
          }" data-bs-toggle="tooltip" data-bs-placement="top" title="Edit category"><i class="bi bi-pencil"></i></button>
          ${
            c.is_active
              ? `<button class="btn btn-sm btn-outline-danger" data-action="cat-deactivate" data-id="${c.category_id}" data-bs-toggle="tooltip" data-bs-placement="top" title="Deactivate category"><i class="bi bi-slash-circle"></i></button>`
              : `<button class="btn btn-sm btn-outline-success" data-action="cat-activate" data-id="${c.category_id}" data-bs-toggle="tooltip" data-bs-placement="top" title="Activate category"><i class="bi bi-check-circle"></i></button>`
          }
        </td>
      </tr>`
        )
        .join("");
      initTableTooltips(catBody);
    } catch (err) {
      catBody.innerHTML =
        '<tr><td colspan="5" class="text-danger py-3">Failed to load categories</td></tr>';
      showToast(String(err.message || err), "danger");
    }
  }

  // Units
  const unitBody = document.getElementById("unitTableBody");
  const unitSearch = document.getElementById("unitSearch");
  const unitActive = document.getElementById("unitActiveFilter");
  const unitAddBtn = document.getElementById("unitAddBtn");
  const unitEditModal = document.getElementById("unitEditModal");
  const unitEditTitle = document.getElementById("unitEditTitle");
  const unitCodeInput = document.getElementById("unitCodeInput");
  const unitLabelInput = document.getElementById("unitLabelInput");
  const unitEditFeedback = document.getElementById("unitEditFeedback");

  let editingUnitId = null;

  async function loadUnits() {
    if (!unitBody) return;
    unitBody.innerHTML =
      '<tr><td colspan="4" class="text-center text-muted py-3">Loading...</td></tr>';
    try {
      const data = await apiGet("/units", {
        q: unitSearch.value.trim(),
        active: unitActive.value,
      });
      const items = data && data.items ? data.items : [];
      if (!items.length) {
        unitBody.innerHTML =
          '<tr><td colspan="4" class="text-center text-muted py-3">No units</td></tr>';
        return;
      }
      unitBody.innerHTML = items
        .map(
          (u) =>
            `<tr class="${u.is_active ? "" : "table-light text-muted"}">
        <td>${escapeHtml(u.code || "")}</td>
        <td>${escapeHtml(u.label || "")}</td>
        <td>${
          u.is_active
            ? "Yes"
            : '<span class="badge text-bg-secondary">Inactive</span>'
        }</td>
        <td class="fit-content">
          <button class="btn btn-sm btn-outline-secondary me-1" data-action="unit-edit" data-id="${
            u.unit_id
          }" data-bs-toggle="tooltip" data-bs-placement="top" title="Edit unit"><i class="bi bi-pencil"></i></button>
          ${
            u.is_active
              ? `<button class="btn btn-sm btn-outline-danger" data-action="unit-deactivate" data-id="${u.unit_id}" data-bs-toggle="tooltip" data-bs-placement="top" title="Deactivate unit"><i class="bi bi-slash-circle"></i></button>`
              : `<button class="btn btn-sm btn-outline-success" data-action="unit-activate" data-id="${u.unit_id}" data-bs-toggle="tooltip" data-bs-placement="top" title="Activate unit"><i class="bi bi-check-circle"></i></button>`
          }
        </td>
      </tr>`
        )
        .join("");
      initTableTooltips(unitBody);
    } catch (err) {
      unitBody.innerHTML =
        '<tr><td colspan="4" class="text-danger py-3">Failed to load units</td></tr>';
      showToast(String(err.message || err), "danger");
    }
  }

  // Assignment/Missing Metadata
  const assignmentBody = document.getElementById("assignmentTableBody");
  const masterRefreshBtn = document.getElementById("masterRefreshBtn");
  const masterSearchInput = document.getElementById("masterSearch");
  const masterPageSizeSelect = document.getElementById("masterPageSize");
  const masterPrevBtn = document.getElementById("masterPrevBtn");
  const masterNextBtn = document.getElementById("masterNextBtn");
  const masterPaginationInfo = document.getElementById("masterPaginationInfo");

  let masterPage = 1;
  let masterPageSize = masterPageSizeSelect ? parseInt(masterPageSizeSelect.value, 10) || 20 : 20;
  let masterTotal = 0;

  const assignModalEl = document.getElementById("assignmentModal");
  const assignItemNameInput = document.getElementById("assignItemNameInput");
  const assignItemContext = document.getElementById("assignItemContext");
  const assignWeightInput = document.getElementById("assignWeightInput");
  const assignUnitCostInput = document.getElementById("assignUnitCostInput");
  const assignFeedback = document.getElementById("assignFeedback");
  const assignSaveBtn = document.getElementById("assignSaveBtn");
  const assignRemoveModal = document.getElementById("assignmentRemoveModal");
  const assignRemoveProductLabel = document.getElementById("assignmentRemoveProduct");
  const assignRemoveConfirmBtn = document.getElementById("assignmentRemoveConfirmBtn");
  const deactivateModal = document.getElementById("deactivateConfirmModal");
  const deactivateText = document.getElementById("deactivateConfirmText");
  const deactivateConfirmBtn = document.getElementById("deactivateConfirmBtn");
  const $assignCategorySelect = window.jQuery
    ? window.jQuery("#assignCategorySelect")
    : null;
  const $assignUnitSelect = window.jQuery
    ? window.jQuery("#assignUnitSelect")
    : null;
  let currentAssignment = null;
  let pendingRemovalProduct = null;
  let pendingDeactivate = null;

  if (deactivateConfirmBtn)
    deactivateConfirmBtn.addEventListener("click", () => {
      if (!pendingDeactivate) return;
      handleDeactivateConfirmed();
    });
  if (assignRemoveModal)
    assignRemoveModal.addEventListener("hidden.bs.modal", () => {
      pendingRemovalProduct = null;
    });
  if (assignRemoveConfirmBtn)
    assignRemoveConfirmBtn.addEventListener("click", () => {
      if (!pendingRemovalProduct) return;
      handleAssignmentRemoval(pendingRemovalProduct);
    });

  function ensureAssignmentSelect2() {
    if (!window.jQuery) return;
    if (!$assignCategorySelect || !$assignCategorySelect.length) return;
    if (!$assignUnitSelect || !$assignUnitSelect.length) return;
    const dropdownParent = assignModalEl ? window.jQuery(assignModalEl) : undefined;
    if (!$assignCategorySelect.hasClass("select2-hidden-accessible")) {
      $assignCategorySelect.select2({
        tags: true,
        width: "100%",
        dropdownParent,
        placeholder:
          $assignCategorySelect.data("placeholder") || "Select or create category",
        ajax: {
          delay: 250,
          url: API_BASE + "/categories",
          dataType: "json",
          data: (params) => ({ q: params.term || "", active: 1 }),
          processResults: (data) => {
            const items = Array.isArray(data?.items) ? data.items : [];
            return {
              results: items.map((c) => ({
                id: "cat:" + c.category_id,
                text: c.secondary_name
                  ? `${c.primary_name} - ${c.secondary_name}`
                  : c.primary_name,
              })),
            };
          },
          xhrFields: { withCredentials: true },
          cache: true,
        },
        createTag: (params) => {
          const term = (params.term || "").trim();
          if (!term) return null;
          return { id: "newcat:" + term, text: term, newTag: true };
        },
      });
    }
    if (!$assignUnitSelect.hasClass("select2-hidden-accessible")) {
      $assignUnitSelect.select2({
        tags: true,
        width: "100%",
        dropdownParent,
        placeholder:
          $assignUnitSelect.data("placeholder") || "Select or create unit",
        ajax: {
          delay: 250,
          url: API_BASE + "/units",
          dataType: "json",
          data: (params) => ({ q: params.term || "", active: 1 }),
          processResults: (data) => {
            const items = Array.isArray(data?.items) ? data.items : [];
            return {
              results: items.map((u) => ({
                id: "unit:" + u.unit_id,
                text: u.label ? `${u.code} (${u.label})` : u.code,
              })),
            };
          },
          xhrFields: { withCredentials: true },
          cache: true,
        },
        createTag: (params) => {
          const term = (params.term || "").trim();
          if (!term) return null;
          return { id: "newunit:" + term, text: term, newTag: true };
        },
      });
    }
  }

  function openAssignmentModal(item) {
    if (!assignModalEl || !item) return;
    ensureAssignmentSelect2();
    currentAssignment = item;
    if (assignItemNameInput)
      assignItemNameInput.value = item.product_name || "";
    if (assignItemContext)
      assignItemContext.textContent = `Donation #${item.donation_id || "—"} · Item ID ${item.donation_item_id}`;
    if (assignWeightInput)
      assignWeightInput.value = item.total_weight != null ? String(item.total_weight) : "";
    if (assignUnitCostInput) {
      const costValue =
        item.unit_cost != null && item.unit_cost !== ""
          ? item.unit_cost
          : null;
      assignUnitCostInput.value = costValue != null ? String(costValue) : "";
    }
    if ($assignCategorySelect) {
      $assignCategorySelect.val(null).trigger("change");
      if (item.category_id && item.category_label) {
        const opt = new Option(item.category_label, "cat:" + item.category_id, true, true);
        $assignCategorySelect.append(opt).trigger("change");
      }
    }
    if ($assignUnitSelect) {
      $assignUnitSelect.val(null).trigger("change");
      if (item.unit_id && item.unit_label) {
        const opt = new Option(item.unit_label, "unit:" + item.unit_id, true, true);
        $assignUnitSelect.append(opt).trigger("change");
      }
    }
    if (assignFeedback) assignFeedback.textContent = "";
    new bootstrap.Modal(assignModalEl).show();
  }

  async function handleAssignmentRemoval(productName) {
    if (!productName) return;
    let originalText = null;
    try {
      if (assignRemoveConfirmBtn) {
        originalText = assignRemoveConfirmBtn.textContent;
        assignRemoveConfirmBtn.disabled = true;
        assignRemoveConfirmBtn.textContent = "Removing...";
      }
      await apiSend("DELETE", `/master-items`, { product_name: productName });
      showToast(`Removed incomplete entries for ${productName}`, "success");
      pendingRemovalProduct = null;
      loadMasterItems();
    } catch (err) {
      showToast(String(err?.message || err || "Failed to remove entries"), "danger");
    } finally {
      if (assignRemoveConfirmBtn) {
        assignRemoveConfirmBtn.disabled = false;
        assignRemoveConfirmBtn.textContent = originalText || "Remove";
      }
    }
  }

  async function loadSingleMissingItem(donationItemId) {
    try {
      const resp = await apiGet(`/missing-metadata/${donationItemId}`);
      if (!resp?.success) {
        const msg = resp?.error || "Failed to load item";
        showToast(msg, "danger");
        return null;
      }
      return resp.item;
    } catch (err) {
      showToast(String(err.message || err), "danger");
      return null;
    }
  }

  function formatDateString(value) {
    if (!value) return "—";
    try {
      const d = new Date(value);
      if (Number.isNaN(d.getTime())) return value;
      return d.toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    } catch (_) {
      return value;
    }
  }

  function formatNumber(value, decimals = 2) {
    if (value === null || value === undefined || Number.isNaN(value)) return "—";
    try {
      return Number(value).toLocaleString(undefined, {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      });
    } catch (_) {
      return String(value);
    }
  }

  async function loadMasterItems(forcePage) {
    if (!assignmentBody) return;
    if (typeof forcePage === "number" && forcePage >= 1) {
      masterPage = forcePage;
    }
    assignmentBody.innerHTML =
      '<tr><td colspan="10" class="text-center text-muted py-3">Loading...</td></tr>';
    try {
      const query = masterSearchInput ? masterSearchInput.value.trim() : "";
      const params = {
        page: masterPage,
        page_size: masterPageSize,
      };
      if (query) params.q = query;
      const data = await apiGet("/master-items", params);
      if (!data?.success) {
        const msg = data?.error ? escapeHtml(data.error) : "Failed to load items";
        assignmentBody.innerHTML = `<tr><td colspan="10" class="text-danger py-3">${msg}</td></tr>`;
        updatePaginationUI(0, 0, 0);
        return;
      }
      const items = Array.isArray(data.items) ? data.items : [];
      const total = Number.isFinite(data.total) ? Number(data.total) : 0;
      const page = Number.isFinite(data.page) ? Number(data.page) : 1;
      const pageSize = Number.isFinite(data.page_size) ? Number(data.page_size) : masterPageSize;
      masterTotal = total;
      masterPage = page;
      masterPageSize = pageSize > 0 ? pageSize : masterPageSize;
      if (!items.length) {
        assignmentBody.innerHTML =
          '<tr><td colspan="10" class="text-center text-muted py-3">No items found.</td></tr>';
        updatePaginationUI(total, page, pageSize);
        return;
      }

      const rows = items
        .map((item) => {
          const hasMissing = !!item.missing_any;
          const statusBadge = hasMissing
            ? `<span class="badge text-bg-warning">Missing: ${escapeHtml(
                (item.missing_labels || []).join(", ") || "Metadata"
              )}</span>`
            : '<span class="badge text-bg-success">Complete</span>';
          const rowClass = hasMissing ? "table-warning" : "";
          const unitLabel = item.unit_label || item.unit_code || "—";
          const totalWeight = item.total_weight_kg != null ? Number(item.total_weight_kg) : null;
          const editBtn = item.sample_donation_item_id
            ? `<button type="button" class="btn btn-sm btn-outline-primary" data-action="assign-edit" data-id="${item.sample_donation_item_id}" data-bs-toggle="tooltip" data-bs-placement="top" title="Edit metadata">
                <i class="bi bi-pencil"></i>
              </button>`
            : "";
          const removeBtn = `<button type="button" class="btn btn-sm btn-outline-danger" data-action="assign-remove" data-product="${escapeHtml(
            item.product_name || ""
          )}" data-bs-toggle="tooltip" data-bs-placement="top" title="Remove incomplete entries"><i class="bi bi-trash"></i></button>`;
          return `
            <tr class="${rowClass}">
              <td>${escapeHtml(item.product_name || "—")}</td>
              <td>${escapeHtml(item.primary_category || "—")}</td>
              <td>${escapeHtml(item.secondary_category || "—")}</td>
              <td>${escapeHtml(unitLabel)}</td>
              <td class="text-end">${formatNumber(item.unit_cost, 2)}</td>
              <td class="text-end">${formatNumber(totalWeight, 3)}</td>
              <td>${formatDateString(item.first_recorded)}</td>
              <td>${formatDateString(item.last_restocked)}</td>
              <td>${statusBadge}</td>
              <td class="text-center">
                <div class="d-inline-flex gap-2">
                  ${editBtn}
                  ${removeBtn}
                </div>
              </td>
            </tr>`;
        })
        .join("");
      assignmentBody.innerHTML = rows;
      updatePaginationUI(total, page, pageSize);

      initTableTooltips(assignmentBody);

      Array.from(assignmentBody.querySelectorAll('button[data-action="assign-edit"]')).forEach((btn) => {
        btn.addEventListener("click", () => {
          const id = parseInt(btn.getAttribute("data-id") || "0", 10) || 0;
          if (!id) return;
          loadSingleMissingItem(id).then((item) => {
            if (item) openAssignmentModal(item);
          });
        });
      });
      Array.from(
        assignmentBody.querySelectorAll('button[data-action="assign-remove"]')
      ).forEach((btn) => {
        btn.addEventListener("click", () => {
          const name = btn.getAttribute("data-product") || "";
          if (!name) return;
          pendingRemovalProduct = name;
          if (assignRemoveProductLabel)
            assignRemoveProductLabel.textContent = name;
          if (assignRemoveConfirmBtn) {
            assignRemoveConfirmBtn.disabled = false;
            assignRemoveConfirmBtn.textContent = "Remove";
          }
          if (assignRemoveModal && window.bootstrap?.Modal) {
            window.bootstrap.Modal.getOrCreateInstance(assignRemoveModal).show();
          } else {
            const fallback = window.confirm(
              `This will remove all donation items for "${name}" that lack metadata. Continue?`
            );
            if (!fallback) {
              pendingRemovalProduct = null;
              return;
            }
            handleAssignmentRemoval(name);
          }
        });
      });
    } catch (err) {
      assignmentBody.innerHTML =
        '<tr><td colspan="10" class="text-danger py-3">Failed to load items</td></tr>';
      showToast(String(err.message || err), "danger");
      updatePaginationUI(0, 0, masterPageSize);
    }
  }

  function updatePaginationUI(total, page, pageSize) {
    if (masterPaginationInfo) {
      if (!total) {
        masterPaginationInfo.textContent = "Showing 0-0 of 0";
      } else {
        const start = (page - 1) * pageSize + 1;
        const end = Math.min(start + pageSize - 1, total);
        masterPaginationInfo.textContent = `Showing ${start}-${end} of ${total}`;
      }
    }
    const hasPrev = page > 1;
    const maxPage = pageSize > 0 ? Math.ceil(total / pageSize) : 1;
    const hasNext = page < maxPage;
    if (masterPrevBtn) masterPrevBtn.disabled = !hasPrev;
    if (masterNextBtn) masterNextBtn.disabled = !hasNext;
  }

  if (masterRefreshBtn)
    masterRefreshBtn.addEventListener("click", () => loadMasterItems(1));
  if (masterSearchInput)
    masterSearchInput.addEventListener("input", debounce(() => loadMasterItems(1), 300));
  if (masterPageSizeSelect)
    masterPageSizeSelect.addEventListener("change", () => {
      const value = parseInt(masterPageSizeSelect.value, 10);
      if (Number.isFinite(value) && value > 0) {
        masterPageSize = value;
        loadMasterItems(1);
      }
    });
  if (masterPrevBtn)
    masterPrevBtn.addEventListener("click", () => {
      if (masterPage > 1) loadMasterItems(masterPage - 1);
    });
  if (masterNextBtn)
    masterNextBtn.addEventListener("click", () => {
      const maxPage = masterPageSize > 0 ? Math.ceil(masterTotal / masterPageSize) : 1;
      if (masterPage < maxPage) loadMasterItems(masterPage + 1);
    });

  const assignmentTabTrigger = document.getElementById("assignment-tab");
  if (assignmentTabTrigger) {
    assignmentTabTrigger.addEventListener("shown.bs.tab", loadMasterItems);
  }

  function activateAssignmentTabFromHash() {
    if (!assignmentTabTrigger) return;
    const hash = (window.location.hash || "").toLowerCase();
    if (hash === "#assignment") {
      const tab = new bootstrap.Tab(assignmentTabTrigger);
      tab.show();
    }
  }

  window.addEventListener("hashchange", activateAssignmentTabFromHash);
  activateAssignmentTabFromHash();

  if (assignSaveBtn) {
    assignSaveBtn.addEventListener("click", async () => {
      if (!currentAssignment) return;
      assignSaveBtn.disabled = true;
      assignSaveBtn.innerHTML =
        '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Saving...';
      assignFeedback.textContent = "";
      try {
        let categoryPayload = {};
        if ($assignCategorySelect) {
          const val = $assignCategorySelect.val();
          if (typeof val === "string" && val) {
            if (val.startsWith("cat:")) {
              categoryPayload.category_id = parseInt(val.slice(4), 10) || null;
            } else if (val.startsWith("newcat:")) {
              categoryPayload.category_label = val.slice(7).trim();
            }
          }
        }
        let unitPayload = {};
        if ($assignUnitSelect) {
          const val = $assignUnitSelect.val();
          if (typeof val === "string" && val) {
            if (val.startsWith("unit:")) {
              unitPayload.unit_id = parseInt(val.slice(5), 10) || null;
            } else if (val.startsWith("newunit:")) {
              unitPayload.unit_label = val.slice(8).trim();
            }
          }
        }
        const weightRaw = assignWeightInput ? assignWeightInput.value.trim() : "";
        const nameRaw = assignItemNameInput ? assignItemNameInput.value.trim() : "";
        const unitCostRaw = assignUnitCostInput ? assignUnitCostInput.value.trim() : "";
        const payload = Object.assign({}, categoryPayload, unitPayload, {
          weight: weightRaw === "" ? null : parseFloat(weightRaw),
        });
        if (nameRaw && nameRaw !== (currentAssignment.product_name || "")) {
          payload.new_product_name = nameRaw;
        }
        if (unitCostRaw !== "") {
          const uc = parseFloat(unitCostRaw);
          if (!Number.isNaN(uc) && uc >= 0) payload.unit_cost = uc;
        }
        const res = await fetch(
          `${API_BASE}/missing-metadata/${currentAssignment.donation_item_id}`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify(payload),
          }
        );
        const text = await res.text();
        let data;
        try {
          data = JSON.parse(text);
        } catch {
          data = { success: false, error: text };
        }
        if (!res.ok || data?.success === false) {
          const msg = data?.error || `Failed to save (HTTP ${res.status})`;
          assignFeedback.textContent = msg;
          showToast(msg, "danger");
        } else {
          showToast("Metadata updated successfully", "success");
          bootstrap.Modal.getInstance(assignModalEl)?.hide();
          loadMasterItems();
        }
      } catch (err) {
        const msg = String(err.message || err);
        assignFeedback.textContent = msg;
        showToast(msg, "danger");
      } finally {
        assignSaveBtn.disabled = false;
        assignSaveBtn.textContent = "Save";
      }
    });
  }

  // Helpers
  function escapeHtml(s) {
    return String(s).replace(
      /[&<>"]/g,
      (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[m])
    );
  }
  function showModal(el) {
    new bootstrap.Modal(el).show();
  }
  function hideModal(el) {
    bootstrap.Modal.getInstance(el)?.hide();
  }
  function showToast(msg, variant) {
    const el = document.getElementById("taxonomyToast");
    const body = document.getElementById("taxonomyToastBody");
    if (!el || !body) return;
    body.textContent = msg || "Done.";
    el.classList.remove(
      "text-bg-dark",
      "text-bg-success",
      "text-bg-danger",
      "text-bg-warning"
    );
    el.classList.add(
      variant === "success"
        ? "text-bg-success"
        : variant === "warning"
        ? "text-bg-warning"
        : variant === "danger"
        ? "text-bg-danger"
        : "text-bg-dark"
    );
    bootstrap.Toast.getOrCreateInstance(el, { delay: 2500 }).show();
  }

  // Wire events
  if (catSearch)
    catSearch.addEventListener("input", debounce(loadCategories, 250));
  if (catActive) catActive.addEventListener("change", loadCategories);
  if (catAddBtn)
    catAddBtn.addEventListener("click", () => {
      editingCatId = null;
      catEditTitle.textContent = "Add Category";
      catCodeInput.value = "";
      catPrimaryInput.value = "";
      catSecondaryInput.value = "";
      catEditFeedback.textContent = "";
      showModal(catEditModal);
    });
  if (catBody)
    catBody.addEventListener("click", async (e) => {
      const btn = e.target.closest("button[data-action]");
      if (!btn) return;
      const id = parseInt(btn.getAttribute("data-id"), 10);
      const action = btn.getAttribute("data-action");
      if (action === "cat-edit") {
        // Simple fetch current row from table DOM instead of API
        const row = btn.closest("tr");
        editingCatId = id;
        catEditTitle.textContent = "Edit Category";
        catCodeInput.value = row.children[0].textContent.trim();
        catPrimaryInput.value = row.children[1].textContent.trim();
        catSecondaryInput.value = row.children[2].textContent.trim();
        catEditFeedback.textContent = "";
        showModal(catEditModal);
      } else if (action === "cat-deactivate") {
        const row = btn.closest("tr");
        const name = row ? row.children[1].textContent.trim() : "this category";
        openDeactivateModal({ type: "category", id, name });
      } else if (action === "cat-activate") {
        try {
          await apiSend("PUT", `/categories/${id}`, { is_active: true });
          showToast("Category activated", "success");
        } catch (err) {
          showToast(String(err.message || err), "danger");
        }
        loadCategories();
      }
    });
  const catSaveBtn = document.getElementById("catSaveBtn");
  if (catSaveBtn)
    catSaveBtn.addEventListener("click", async () => {
      const code = catCodeInput.value.trim();
      const primary = catPrimaryInput.value.trim();
      const secondary = catSecondaryInput.value.trim();
      if (!primary) {
        catEditFeedback.textContent = "Primary is required";
        return;
      }
      try {
        if (editingCatId) {
          await apiSend("PUT", `/categories/${editingCatId}`, {
            code: code || null,
            primary_name: primary,
            secondary_name: secondary || null,
          });
          showToast("Category updated", "success");
        } else {
          await apiSend("POST", `/categories`, {
            code: code || null,
            primary_name: primary,
            secondary_name: secondary || null,
          });
          showToast("Category added", "success");
        }
        hideModal(catEditModal);
        loadCategories();
      } catch (err) {
        const message = String(err.message || err || "Failed to save category");
        if (message.toLowerCase().includes("code")) {
          catEditFeedback.textContent = message;
        } else {
          catEditFeedback.textContent = "";
        }
        showToast(message, "danger");
      }
    });

  if (unitSearch)
    unitSearch.addEventListener("input", debounce(loadUnits, 250));
  if (unitActive) unitActive.addEventListener("change", loadUnits);
  if (unitAddBtn)
    unitAddBtn.addEventListener("click", () => {
      editingUnitId = null;
      unitEditTitle.textContent = "Add Unit";
      unitCodeInput.value = "";
      unitLabelInput.value = "";
      unitEditFeedback.textContent = "";
      showModal(unitEditModal);
    });
  if (unitBody)
    unitBody.addEventListener("click", async (e) => {
      const btn = e.target.closest("button[data-action]");
      if (!btn) return;
      const id = parseInt(btn.getAttribute("data-id"), 10);
      const action = btn.getAttribute("data-action");
      if (action === "unit-edit") {
        const row = btn.closest("tr");
        editingUnitId = id;
        unitEditTitle.textContent = "Edit Unit";
        unitCodeInput.value = row.children[0].textContent.trim();
        unitLabelInput.value = row.children[1].textContent.trim();
        unitEditFeedback.textContent = "";
        showModal(unitEditModal);
      } else if (action === "unit-deactivate") {
        const row = btn.closest("tr");
        const name = row ? row.children[0].textContent.trim() : "this unit";
        openDeactivateModal({ type: "unit", id, name });
      } else if (action === "unit-activate") {
        try {
          await apiSend("PUT", `/units/${id}`, { is_active: true });
          showToast("Unit activated", "success");
        } catch (err) {
          showToast(String(err.message || err), "danger");
        }
        loadUnits();
      }
    });
  const unitSaveBtn = document.getElementById("unitSaveBtn");
  if (unitSaveBtn)
    unitSaveBtn.addEventListener("click", async () => {
      const code = unitCodeInput.value.trim();
      const label = unitLabelInput.value.trim();
      if (!code) {
        unitEditFeedback.textContent = "Code is required";
        return;
      }
      try {
        if (editingUnitId) {
          await apiSend("PUT", `/units/${editingUnitId}`, {
            code,
            label: label || null,
          });
          showToast("Unit updated", "success");
        } else {
          await apiSend("POST", `/units`, { code, label: label || null });
          showToast("Unit added", "success");
        }
        hideModal(unitEditModal);
        loadUnits();
      } catch (err) {
        unitEditFeedback.textContent = "";
        const message = String(err.message || err || "Failed to save unit");
        showToast(message, "danger");
      }
    });

  function debounce(fn, ms) {
    let t;
    return function () {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, arguments), ms);
    };
  }

  // Initial loads
  loadCategories();
  loadUnits();
  loadMasterItems();
})();
