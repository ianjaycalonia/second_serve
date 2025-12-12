(function () {
  "use strict";

  const API_BASE_URL =
    typeof window.API_BASE_URL === "string" && window.API_BASE_URL
      ? window.API_BASE_URL
      : "/php/api";

  const repackState = {
    categories: [],
    categoryLookup: {},
    units: [],
    unitLookup: {},
    templates: [],
    templateLookup: {},
    currentTemplateId: null,
    run: {
      template: null,
      kits: 0,
      allocations: {},
      maxKits: null,
      lotCache: Object.create(null),
    },
    lotModal: null,
    toast: null,
  };

  const RUN_QUANTITY_HELP_DEFAULT = "Select a template to calculate the maximum kits automatically.";

  const REPACK_TOAST_VARIANTS = ["primary", "success", "warning", "danger", "info", "secondary"];

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

  function escapeAttr(str){
    return (str || "")
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function formatWholeQuantity(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return "0";
    return String(Math.round(num));
  }

  function showRepackToast(message, variant = "primary") {
    try {
      const toastEl = document.getElementById("repackToast");
      if (!toastEl || typeof bootstrap === "undefined") return;
      const classes = toastEl.classList;
      if (classes && typeof classes.remove === "function") {
        REPACK_TOAST_VARIANTS.forEach((v) => classes.remove(`text-bg-${v}`));
        if (variant && REPACK_TOAST_VARIANTS.includes(variant)) {
          classes.add(`text-bg-${variant}`);
        } else {
          classes.add("text-bg-primary");
        }
      }
      const body = document.getElementById("repackToastBody");
      if (body) body.textContent = message;
      repackState.toast = bootstrap.Toast.getOrCreateInstance(toastEl);
      repackState.toast.show();
    } catch (_) {}
  }

  function buildCategoryLabel(primary, secondary) {
    const p = (primary || "").trim();
    const s = (secondary || "").trim();
    if (!p && !s) return "";
    return s ? `${p} - ${s}` : p;
  }

  async function ensureRepackReferenceData(force = false) {
    if (!force && repackState.categories.length && repackState.units.length) return;
    const categoryUrl = `${API_BASE_URL}/taxonomy/index.php/categories?active=1&t=${Date.now()}`;
    const unitUrl = `${API_BASE_URL}/taxonomy/index.php/units?active=1&t=${Date.now()}`;
    try {
      const [catRes, unitRes] = await Promise.all([
        fetch(categoryUrl, { credentials: "include", headers: { Accept: "application/json" } }),
        fetch(unitUrl, { credentials: "include", headers: { Accept: "application/json" } }),
      ]);
      const catJson = await catRes.json().catch(() => ({}));
      const unitJson = await unitRes.json().catch(() => ({}));
      repackState.categories = Array.isArray(catJson?.items)
        ? catJson.items.map((row) => ({
            id: Number(row.category_id),
            primary: row.primary_name || row.name || "",
            secondary: row.secondary_name || "",
            label: buildCategoryLabel(row.primary_name || row.name || "", row.secondary_name || ""),
          }))
        : [];
      repackState.units = Array.isArray(unitJson?.items)
        ? unitJson.items.map((row) => ({
            id: Number(row.unit_id),
            code: row.code || "",
            label: (row.label || row.code || "").trim(),
          }))
        : [];
      repackState.categoryLookup = Object.create(null);
      repackState.unitLookup = Object.create(null);
      repackState.categories.forEach((c) => {
        if (c.label) repackState.categoryLookup[c.label.toLowerCase()] = c.id;
      });
      repackState.units.forEach((u) => {
        if (u.label) repackState.unitLookup[u.label.toLowerCase()] = u.id;
        if (u.code) repackState.unitLookup[u.code.toLowerCase()] = u.id;
      });
      syncRepackDatalists();
    } catch (err) {
      console.error("Failed to load taxonomy for repack module", err);
      showRepackToast("Failed to load taxonomy (categories/units)", "danger");
    }
  }

  function setRunQuantityHelp(message) {
    const helpEl = document.getElementById("repackRunQuantityHelp");
    if (helpEl) helpEl.textContent = message || RUN_QUANTITY_HELP_DEFAULT;
  }

  function syncRepackDatalists() {
    const catList = document.getElementById("repackCategoryOptions");
    if (catList) {
      catList.innerHTML = repackState.categories
        .filter((c) => c.label)
        .map((c) => `<option value="${escapeHtml(c.label)}"></option>`)
        .join("");
    }
    const unitList = document.getElementById("repackUnitOptions");
    if (unitList) {
      unitList.innerHTML = repackState.units
        .filter((u) => u.label)
        .map((u) => `<option value="${escapeHtml(u.label)}"></option>`)
        .join("");
    }
  }

  function toCategoryId(label) {
    if (!label) return null;
    const match = repackState.categoryLookup[label.trim().toLowerCase()];
    return Number.isInteger(match) ? match : null;
  }

  function toUnitId(label) {
    if (!label) return null;
    const key = label.trim().toLowerCase();
    const match = repackState.unitLookup[key];
    return Number.isInteger(match) ? match : null;
  }

  function clearTemplateForm() {
    const form = document.getElementById("repackTemplateForm");
    if (!form) return;
    form.reset();
    const idField = document.getElementById("repackTemplateId");
    if (idField) idField.value = "";
    const componentsContainer = document.getElementById("repackComponentsContainer");
    if (componentsContainer) {
      try {
        if (window.jQuery && window.jQuery.fn?.select2) {
          componentsContainer.querySelectorAll(".component-name-select").forEach((sel) => {
            try {
              window.jQuery(sel).select2("destroy");
            } catch (_) {}
          });
        }
      } catch (_) {}
      componentsContainer.innerHTML = "";
    }
    repackState.currentTemplateId = null;
  }

  function initComponentNameSelect(selectEl, rowEl) {
    if (!selectEl) return;
    const placeholder = selectEl.dataset.placeholder || "Search inventory items";
    if (window.jQuery && window.jQuery.fn?.select2) {
      const $select = window.jQuery(selectEl);
      if ($select.hasClass("select2-hidden-accessible")) {
        return;
      }
      const $parent = window.jQuery("#repackTemplatesModal");
      $select
        .select2({
          width: "100%",
          placeholder,
          allowClear: true,
          minimumInputLength: 1,
          dropdownParent: $parent.length ? $parent : undefined,
          ajax: {
            delay: 250,
            url: `${API_BASE_URL}/inventory/index.php/list`,
            dataType: "json",
            xhrFields: { withCredentials: true },
            data: (params) => ({
              q: params.term || "",
              group: "merge",
              limit: 20,
            }),
            processResults: (resp) => {
              const items = Array.isArray(resp?.data?.items) ? resp.data.items : [];
              const results = items
                .map((item) => {
                  const name = String(item?.item_name || item?.product_name || "").trim();
                  if (!name) return null;
                  return {
                    id: name,
                    text: name,
                    data: item,
                  };
                })
                .filter(Boolean);
              return { results };
            },
          },
        })
        .on("select2:open", () => {
          const search = document.querySelector(".select2-container--open .select2-search__field");
          if (search) {
            search.dispatchEvent(new Event("input", { bubbles: true }));
          }
        })
        .on("select2:select", (ev) => {
          try {
            const data = ev?.params?.data || {};
            if (rowEl) {
              const productId = data?.data?.product_id;
              if (productId != null) {
                rowEl.dataset.productId = String(productId);
              } else {
                delete rowEl.dataset.productId;
              }
            }
          } catch (_) {}
        })
        .on("select2:clear", () => {
          if (rowEl) {
            delete rowEl.dataset.productId;
          }
        });
    } else if (!selectEl.dataset.loaded) {
      fetch(`${API_BASE_URL}/inventory/index.php/list?group=merge&limit=50`, {
        credentials: "include",
        headers: { Accept: "application/json" },
      })
        .then((res) => res.json().catch(() => null))
        .then((json) => {
          const items = Array.isArray(json?.data?.items) ? json.data.items : [];
          const opts = ['<option value=""></option>'];
          items.forEach((item) => {
            const name = String(item?.item_name || item?.product_name || "").trim();
            if (!name) return;
            opts.push(`<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`);
          });
          selectEl.innerHTML = opts.join("");
          selectEl.dataset.loaded = "1";
        })
        .catch(() => {});
    }
  }

  function addComponentRow(component, focus = false) {
    const tpl = document.getElementById("repackComponentRowTemplate");
    const container = document.getElementById("repackComponentsContainer");
    if (!tpl || !container) return;
    const clone = tpl.content.firstElementChild.cloneNode(true);
    const index = container.children.length;
    clone.setAttribute("data-index", String(index));
    if (component?.product_id != null) {
      clone.dataset.productId = String(component.product_id);
    }
    const nameSelect = clone.querySelector(".component-name-select");
    const qtyInput = clone.querySelector(".component-qty");
    if (nameSelect) {
      nameSelect.innerHTML = '<option value=""></option>';
    }
    if (component) {
      if (nameSelect) {
        const value = component.product_name || "";
        if (value) {
          const opt = document.createElement("option");
          opt.value = value;
          opt.textContent = value;
          opt.selected = true;
          nameSelect.appendChild(opt);
        }
      }
      if (qtyInput) qtyInput.value = Number(component.quantity_per_kit || 0) || 1;
      clone.dataset.componentId = component.kit_component_id ? String(component.kit_component_id) : "";
    }
    const removeBtn = clone.querySelector(".component-remove-btn");
    if (removeBtn) {
      removeBtn.addEventListener("click", () => {
        try {
          if (nameSelect && window.jQuery && window.jQuery.fn?.select2) {
            const $sel = window.jQuery(nameSelect);
            if ($sel.hasClass("select2-hidden-accessible")) {
              $sel.select2("destroy");
            }
          }
        } catch (_) {}
        clone.remove();
      });
    }
    container.appendChild(clone);
    initComponentNameSelect(nameSelect, clone);
    if (focus && nameSelect) {
      setTimeout(() => {
        try {
          if (window.jQuery && window.jQuery.fn?.select2) {
            const $sel = window.jQuery(nameSelect);
            if ($sel.hasClass("select2-hidden-accessible")) {
              $sel.select2("open");
              return;
            }
          }
        } catch (_) {}
        nameSelect.focus();
      }, 0);
    }
  }

  function populateTemplateForm(template) {
    clearTemplateForm();
    if (!template) return;
    repackState.currentTemplateId = template.kit_template_id || template.id || null;
    const idField = document.getElementById("repackTemplateId");
    if (idField) idField.value = repackState.currentTemplateId || "";
    const nameField = document.getElementById("repackTemplateName");
    const codeField = document.getElementById("repackTemplateCode");
    const descField = document.getElementById("repackTemplateDescription");
    const outName = document.getElementById("repackOutputName");
    const outQty = document.getElementById("repackOutputQuantity");
    const outUnit = document.getElementById("repackOutputUnit");
    const outCat = document.getElementById("repackOutputCategory");
    const activeChk = document.getElementById("repackTemplateActive");
    if (nameField) nameField.value = template.name || "";
    if (codeField) codeField.value = template.code || "";
    if (descField) descField.value = template.description || "";
    if (outName) outName.value = template.output_product_name || "";
    if (outQty) outQty.value = template.output_quantity_per_kit || 1;
    if (outUnit) outUnit.value = template.output_unit_label || "";
    if (outCat) outCat.value = template.output_category_label || "";
    if (activeChk) activeChk.checked = Boolean(template.is_active ?? true);
    if (Array.isArray(template.components)) {
      template.components.forEach((component) => addComponentRow(component));
    }
  }

  function getTemplateFormData() {
    const data = {};
    data.id = repackState.currentTemplateId;
    const nameField = document.getElementById("repackTemplateName");
    const codeField = document.getElementById("repackTemplateCode");
    const descField = document.getElementById("repackTemplateDescription");
    const outName = document.getElementById("repackOutputName");
    const outQty = document.getElementById("repackOutputQuantity");
    const outUnit = document.getElementById("repackOutputUnit");
    const outCat = document.getElementById("repackOutputCategory");
    const activeChk = document.getElementById("repackTemplateActive");
    data.name = String(nameField?.value || "").trim();
    data.code = String(codeField?.value || "").trim();
    data.description = String(descField?.value || "").trim();
    data.output_product_name = String(outName?.value || "").trim();
    data.output_quantity_per_kit = parseInt(outQty?.value || "0", 10) || 0;
    const unitLabel = String(outUnit?.value || "").trim();
    const catLabel = String(outCat?.value || "").trim();
    data.output_unit_id = toUnitId(unitLabel);
    data.output_unit_label = unitLabel;
    data.output_category_id = toCategoryId(catLabel);
    data.output_category_label = catLabel;
    data.is_active = Boolean(activeChk?.checked);
    const componentsContainer = document.getElementById("repackComponentsContainer");
    const components = [];
    if (componentsContainer) {
      componentsContainer.querySelectorAll(".component-row").forEach((row, idx) => {
        const nameSelect = row.querySelector(".component-name-select");
        const qtyInput = row.querySelector(".component-qty");
        const productName = String(nameSelect?.value || "").trim();
        const qty = parseInt(qtyInput?.value || "0", 10) || 0;
        if (!productName || qty <= 0) return;
        const comp = {
          kit_component_id: row.dataset.componentId ? parseInt(row.dataset.componentId, 10) : undefined,
          position: idx + 1,
          product_name: productName,
          quantity_per_kit: qty,
        };
        const productIdRaw = row.dataset.productId;
        if (productIdRaw != null && productIdRaw !== "") {
          const parsed = parseInt(productIdRaw, 10);
          if (!Number.isNaN(parsed)) {
            comp.product_id = parsed;
          }
        }
        components.push(comp);
      });
    }
    data.components = components;
    return data;
  }

  async function fetchTemplates(force = false) {
    if (!force && repackState.templates.length) return repackState.templates;
    try {
      const res = await fetch(`${API_BASE_URL}/repack/index.php/templates`, {
        credentials: "include",
        headers: { Accept: "application/json" },
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        throw new Error(json?.error || `HTTP ${res.status}`);
      }
      const items = Array.isArray(json?.data?.items) ? json.data.items : [];
      repackState.templates = items;
      repackState.templateLookup = Object.create(null);
      items.forEach((tpl) => {
        const id = tpl.kit_template_id || tpl.id;
        if (id != null) repackState.templateLookup[id] = tpl;
      });
      renderTemplateList();
      return items;
    } catch (err) {
      console.error("Failed to load repack templates", err);
      showRepackToast("Failed to fetch repack templates", "danger");
      return [];
    }
  }

  function renderTemplateList(filterText = "") {
    const listEl = document.getElementById("repackTemplateList");
    if (!listEl) return;
    const search = filterText.trim().toLowerCase();
    const items = repackState.templates.filter((tpl) => {
      if (!search) return true;
      const haystack = `${tpl.name || ""} ${tpl.code || ""}`.toLowerCase();
      return haystack.includes(search);
    });
    if (!items.length) {
      listEl.innerHTML = '<div class="text-muted small px-2 py-3">No templates found.</div>';
      return;
    }
    listEl.innerHTML = items
      .map((tpl) => {
        const id = tpl.kit_template_id || tpl.id;
        const activeBadge = tpl.is_active ? '' : '<span class="badge bg-secondary ms-2">Inactive</span>';
        return `
          <button type="button" class="list-group-item list-group-item-action" data-template-id="${id}">
            <div class="fw-semibold">${escapeHtml(tpl.name || "(no name)")}${activeBadge}</div>
            <div class="small text-muted">${escapeHtml(tpl.code || "")}</div>
          </button>`;
      })
      .join("");
  }

  async function saveTemplate() {
    const feedback = document.getElementById("repackTemplateFormFeedback");
    if (feedback) feedback.textContent = "";
    
    // Clear any previous error highlights
    document.querySelectorAll('.is-invalid').forEach(el => el.classList.remove('is-invalid'));
    
    const data = getTemplateFormData();
    let isValid = true;
    
    // Validate required fields
    if (!data.name) {
      document.getElementById("repackTemplateName").classList.add('is-invalid');
      isValid = false;
    }
    if (!data.output_product_name) {
      document.getElementById("repackOutputName").classList.add('is-invalid');
      isValid = false;
    }
    if (!data.output_quantity_per_kit || data.output_quantity_per_kit <= 0) {
      document.getElementById("repackOutputQuantity").classList.add('is-invalid');
      isValid = false;
    }
    if (!data.output_category_id) {
      document.getElementById("repackOutputCategory").classList.add('is-invalid');
      isValid = false;
    }
    if (!data.output_unit_id) {
      document.getElementById("repackOutputUnit").classList.add('is-invalid');
      isValid = false;
    }
    if (!Array.isArray(data.components) || !data.components.length) {
      // No specific element to highlight for components, keep the feedback message
      if (feedback) feedback.textContent = "Add at least one component.";
      return;
    }
    
    if (!isValid) {
      return;
    }
    const payload = {
      name: data.name,
      code: data.code || null,
      description: data.description || null,
      output_product_name: data.output_product_name,
      output_quantity_per_kit: data.output_quantity_per_kit,
      output_category_id: data.output_category_id,
      output_unit_id: data.output_unit_id,
      is_active: data.is_active,
      components: data.components.map((comp) => {
        const payloadComp = {
          product_name: comp.product_name,
          quantity_per_kit: comp.quantity_per_kit,
        };
        if (comp.product_id != null) {
          payloadComp.product_id = comp.product_id;
        }
        return payloadComp;
      }),
    };
    const isUpdate = Boolean(data.id);
    const url = isUpdate
      ? `${API_BASE_URL}/repack/index.php/templates/${data.id}`
      : `${API_BASE_URL}/repack/index.php/templates`;
    const method = isUpdate ? "PUT" : "POST";
    try {
      const res = await fetch(url, {
        method,
        credentials: "include",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        throw new Error(json?.error || `HTTP ${res.status}`);
      }
      showRepackToast(`Template ${isUpdate ? "updated" : "created"}.`, "success");
      await fetchTemplates(true);
      if (isUpdate) {
        const id = data.id;
        const tpl = repackState.templateLookup[id];
        populateTemplateForm(tpl || null);
      } else {
        clearTemplateForm();
      }
    } catch (err) {
      console.error("Failed to save template", err);
      if (feedback) feedback.textContent = err?.message || "Failed to save template.";
      showRepackToast("Failed to save template", "danger");
    }
  }

  function bindTemplateModalEvents() {
    const listEl = document.getElementById("repackTemplateList");
    if (listEl && !listEl.dataset.bound) {
      listEl.dataset.bound = "1";
      listEl.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-template-id]");
        if (!btn) return;
        const id = btn.getAttribute("data-template-id");
        const tpl = repackState.templateLookup[id];
        populateTemplateForm(tpl || null);
      });
    }
    const categoryAddBtn = document.getElementById("repackCategoryAddButton");
    if (categoryAddBtn && !categoryAddBtn.dataset.bound) {
      categoryAddBtn.dataset.bound = "1";
      categoryAddBtn.addEventListener("click", async () => {
        const catInput = document.getElementById("repackOutputCategory");
        const feedbackEl = document.getElementById("repackCategoryAddFeedback");
        if (feedbackEl) feedbackEl.textContent = "";
        const raw = String(catInput?.value || "").trim();
        if (!raw) {
          if (feedbackEl) feedbackEl.textContent = "Type a category first.";
          catInput?.focus();
          return;
        }
        const parts = raw.split(/\s*-\s*/);
        const primary = String(parts[0] || "").trim();
        const secondary = parts.length > 1 ? String(parts.slice(1).join(" - ") || "").trim() : "";
        if (!primary) {
          if (feedbackEl) feedbackEl.textContent = "Primary name is required.";
          catInput?.focus();
          return;
        }
        const label = secondary ? `${primary} - ${secondary}` : primary;
        categoryAddBtn.disabled = true;
        try {
          const res = await fetch(`${API_BASE_URL}/taxonomy/index.php/categories`, {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify({ primary_name: primary, secondary_name: secondary || null }),
          });
          const json = await res.json().catch(() => null);
          if (!res.ok || json?.success === false) {
            const errMsg = json?.error || `HTTP ${res.status}`;
            if (feedbackEl) feedbackEl.textContent = errMsg;
            return;
          }
          const newId = Number(json?.data?.category_id ?? json?.category_id ?? 0) || null;
          await ensureRepackReferenceData(true);
          syncRepackDatalists();
          if (newId != null) {
            repackState.categoryLookup[label.toLowerCase()] = newId;
          }
          if (catInput) {
            catInput.value = label;
            catInput.dispatchEvent(new Event("input", { bubbles: true }));
          }
          showRepackToast("Category saved.", "success");
        } catch (err) {
          if (feedbackEl) feedbackEl.textContent = err?.message || "Failed to add category.";
        } finally {
          categoryAddBtn.disabled = false;
        }
      });
    }
    const addComponentBtn = document.getElementById("repackAddComponentBtn");
    if (addComponentBtn && !addComponentBtn.dataset.bound) {
      addComponentBtn.dataset.bound = "1";
      addComponentBtn.addEventListener("click", () => addComponentRow(null, true));
    }
    const resetBtn = document.getElementById("repackTemplateResetBtn");
    if (resetBtn && !resetBtn.dataset.bound) {
      resetBtn.dataset.bound = "1";
      resetBtn.addEventListener("click", () => {
        clearTemplateForm();
        const feedback = document.getElementById("repackTemplateFormFeedback");
        if (feedback) feedback.textContent = "";
      });
    }
    const saveBtn = document.getElementById("repackTemplateSaveBtn");
    if (saveBtn && !saveBtn.dataset.bound) {
      saveBtn.dataset.bound = "1";
      saveBtn.addEventListener("click", saveTemplate);
    }
    const searchInput = document.getElementById("repackTemplateSearchInput");
    if (searchInput && !searchInput.dataset.bound) {
      searchInput.dataset.bound = "1";
      searchInput.addEventListener("input", (e) => {
        renderTemplateList(e.target.value || "");
      });
    }
    const refreshBtn = document.getElementById("repackTemplatesRefreshBtn");
    if (refreshBtn && !refreshBtn.dataset.bound) {
      refreshBtn.dataset.bound = "1";
      refreshBtn.addEventListener("click", async () => {
        await fetchTemplates(true);
        renderTemplateList(document.getElementById("repackTemplateSearchInput")?.value || "");
      });
    }
    const modalEl = document.getElementById("repackTemplatesModal");
    if (modalEl && !modalEl.dataset.clearBound) {
      modalEl.dataset.clearBound = "1";
      modalEl.addEventListener("hidden.bs.modal", () => {
        clearTemplateForm();
        const feedback = document.getElementById("repackTemplateFormFeedback");
        if (feedback) feedback.textContent = "";
        const searchInputEl = document.getElementById("repackTemplateSearchInput");
        if (searchInputEl) {
          const previous = searchInputEl.value;
          searchInputEl.value = "";
          if (previous) {
            renderTemplateList("");
          }
        }
      });
    }
  }

  async function openTemplateModal() {
    await ensureRepackReferenceData();
    await fetchTemplates();
    bindTemplateModalEvents();
    const modalEl = document.getElementById("repackTemplatesModal");
    if (modalEl && typeof bootstrap !== "undefined") {
      bootstrap.Modal.getOrCreateInstance(modalEl).show();
    }
  }

  // ---------------------------------------------------------------------------
  // Repack Run Workflow
  // ---------------------------------------------------------------------------

  function resetRunState() {
    repackState.run.template = null;
    repackState.run.kits = 0;
    repackState.run.allocations = {};
    repackState.run.maxKits = null;
    repackState.run.lotCache = Object.create(null);
  }

  function populateRunTemplateOptions(preferredId = null) {
    const select = document.getElementById("repackRunTemplateSelect");
    if (!select) return null;
    const activeTemplates = repackState.templates.filter((tpl) => Boolean(tpl.is_active));
    if (!activeTemplates.length) {
      select.innerHTML = '<option value="">No active templates available</option>';
      select.disabled = true;
      return null;
    }
    select.disabled = false;
    select.innerHTML = activeTemplates
      .map((tpl) => {
        const id = tpl.kit_template_id || tpl.id;
        const label = tpl.code ? `${tpl.name} (${tpl.code})` : tpl.name;
        return `<option value="${id}">${escapeHtml(label || "Template")}</option>`;
      })
      .join("");
    const desired = preferredId && activeTemplates.find((tpl) => String(tpl.kit_template_id || tpl.id) === String(preferredId));
    const selected = desired || activeTemplates[0];
    if (selected) {
      const selectedId = String(selected.kit_template_id || selected.id);
      select.value = selectedId;
    }
    return selected || null;
  }

  function renderRunSummary() {
    const summary = document.getElementById("repackOutputSummary");
    if (!summary) return;
    const template = repackState.run.template;
    const kits = repackState.run.kits || 0;
    const fields = summary.querySelectorAll("dd[data-field]");
    fields.forEach((dd) => {
      dd.textContent = "—";
    });
    if (!template || !kits) return;
    const product = template.output_product_name || "";
    const category = template.output_category_label || "";
    const unit = template.output_unit_label || "";
    const unitsProduced = (Number(template.output_quantity_per_kit || 0) || 0) * kits;
    const map = {
      product,
      category,
      unit,
      units: formatWholeQuantity(unitsProduced),
    };
    Object.entries(map).forEach(([key, value]) => {
      const dd = summary.querySelector(`dd[data-field="${key}"]`);
      if (dd) dd.textContent = value || "—";
    });
  }

  function renderRunComponentsTable() {
    const tableBody = document.querySelector("#repackComponentsTable tbody");
    const statusEl = document.getElementById("repackAllocationStatus");
    if (!tableBody) return;
    const template = repackState.run.template;
    tableBody.innerHTML = "";
    if (!template) {
      if (statusEl) statusEl.textContent = "Select a template to begin.";
      return;
    }
    const kits = Number(repackState.run.kits || 0);
    if (!Number.isFinite(kits) || kits <= 0) {
      if (statusEl) statusEl.textContent = "Enter kits to produce.";
      return;
    }
    const rows = [];
    let allSatisfied = true;
    template.components.forEach((component) => {
      const componentId = component.kit_component_id;
      const required = (Number(component.quantity_per_kit || 0) || 0) * kits;
      const allocation = repackState.run.allocations[componentId] || { lots: [] };
      const availableTotal = allocation.lots.reduce(
        (sum, lot) => sum + Number((lot.available ?? lot.quantity ?? 0) || 0),
        0
      );
      const allocated = allocation.lots.reduce((sum, lot) => sum + Number(lot.quantity || 0), 0);
      if (allocated !== required) allSatisfied = false;
      const lotsSummary = allocation.lots.length
        ? allocation.lots
            .map((lot) => {
              const availableLabel = Number.isFinite(Number(lot.available))
                ? ` / ${formatWholeQuantity(lot.available)} available`
                : "";
              return `Lot #${lot.inventory_id}: ${formatWholeQuantity(lot.quantity)}${availableLabel}`;
            })
            .join("<br>")
        : "No lots selected";
      rows.push(`
        <tr data-component-id="${componentId}">
          <td>
            <div class="fw-semibold">${escapeHtml(component.product_name || "")}</div>
            <div class="small text-muted">${escapeHtml(component.category_label || "")}</div>
          </td>
          <td class="text-nowrap">${formatWholeQuantity(required)} ${escapeHtml(component.unit_label || "")}</td>
          <td class="text-nowrap">${
            Number.isFinite(availableTotal) && availableTotal > 0
              ? escapeHtml(formatWholeQuantity(availableTotal))
              : availableTotal === 0
              ? "0"
              : "—"
          } ${escapeHtml(component.unit_label || "")}</td>
          <td class="text-nowrap">
            ${formatWholeQuantity(allocated)} ${escapeHtml(component.unit_label || "")}
            <div class="small text-muted">${lotsSummary}</div>
          </td>
          <td class="text-end">
            <button type="button" class="btn btn-sm btn-outline-primary repack-allocate-btn" data-component-id="${componentId}">
              Allocate Lots
            </button>
          </td>
        </tr>
      `);
    });
    tableBody.innerHTML = rows.join("");
    if (statusEl) {
      statusEl.textContent = allSatisfied
        ? "All components allocated."
        : "Allocate lots for each component.";
    }
    updateRunSubmitState();
  }

  function updateRunSubmitState(message = "") {
    const submitBtn = document.getElementById("repackRunSubmitBtn");
    const feedbackEl = document.getElementById("repackRunFeedback");
    if (feedbackEl) feedbackEl.textContent = message || "";
    if (!submitBtn) return;
    const template = repackState.run.template;
    if (!template) {
      submitBtn.disabled = true;
      return;
    }
    const kits = Number(repackState.run.kits || 0);
    if (!Number.isFinite(kits) || kits <= 0) {
      submitBtn.disabled = true;
      if (feedbackEl && !message) feedbackEl.textContent = "Enter a valid number of kits to produce (1 or more).";
      return;
    }
    let unsatisfied = null;
    const allSatisfied = template.components.every((component) => {
      const required = (Number(component.quantity_per_kit || 0) || 0) * kits;
      const allocation = repackState.run.allocations[component.kit_component_id] || { lots: [] };
      const allocated = allocation.lots.reduce((sum, lot) => sum + Number(lot.quantity || 0), 0);
      const satisfied = allocated === required && required > 0;
      if (!satisfied && !unsatisfied) {
        unsatisfied = {
          name: component.product_name || "Component",
          required,
          allocated,
        };
      }
      return satisfied;
    });
    submitBtn.disabled = !allSatisfied;
    if (!allSatisfied && feedbackEl) {
      if (unsatisfied) {
        feedbackEl.textContent = `Not enough quantity for ${unsatisfied.name}.`;
      } else if (!message) {
        feedbackEl.textContent = "Allocate lots for every component.";
      }
    }
  }

  async function fetchTemplateDetail(templateId) {
    try {
      const res = await fetch(`${API_BASE_URL}/repack/index.php/templates/${templateId}`, {
        credentials: "include",
        headers: { Accept: "application/json" },
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        throw new Error(json?.error || `HTTP ${res.status}`);
      }
      const tpl = json.data;
      if (tpl) {
        const id = tpl.kit_template_id || tpl.id;
        // Update cached template collection
        repackState.templateLookup[id] = tpl;
        const idx = repackState.templates.findIndex((t) => (t.kit_template_id || t.id) === id);
        if (idx >= 0) {
          repackState.templates[idx] = tpl;
        } else {
          repackState.templates.push(tpl);
        }
      }
      return tpl;
    } catch (err) {
      console.error("Failed to load template detail", err);
      showRepackToast("Failed to load template detail", "danger");
      return null;
    }
  }

  function setRunTemplate(template) {
    repackState.run.template = template;
    repackState.run.allocations = {};
    repackState.run.maxKits = null;
    repackState.run.lotCache = Object.create(null);
    const inputEl = document.getElementById("repackRunQuantity");
    const requested = Number(inputEl?.value || 0);
    repackState.run.kits = template ? (requested > 0 ? requested : 0) : 0;
    if (inputEl) inputEl.value = repackState.run.kits || '';
    renderRunSummary();
    renderRunComponentsTable();
  }

  async function handleRunTemplateChange() {
    const select = document.getElementById("repackRunTemplateSelect");
    if (!select) return;
    const templateId = select.value;
    if (!templateId) {
      resetRunState();
      renderRunSummary();
      renderRunComponentsTable();
      return;
    }
    let template = repackState.templateLookup[templateId];
    if (!template || !Array.isArray(template.components)) {
      template = await fetchTemplateDetail(templateId);
    }
    setRunTemplate(template || null);
  }

  function handleRunQuantityChange() {
    const input = document.getElementById("repackRunQuantity");
    if (!input) return;
    
    // Parse the input value, default to 0 if invalid
    let value = parseInt(input.value.trim() || "0", 10) || 0;
    
    // Update the input field and state
    input.value = value > 0 ? String(value) : '';
    repackState.run.kits = value > 0 ? value : 0;
    
    // Only update the UI if we have a valid number of kits
    if (repackState.run.kits > 0) {
      recomputeAllocationsForCurrentKits();
      renderRunSummary();
      renderRunComponentsTable();
    } else {
      // Clear the UI if no valid number is entered
      renderRunSummary();
      renderRunComponentsTable();
    }
    
    // Update the submit button state
    updateRunSubmitState();
  }

  async function fetchComponentLots(component) {
    if (!component) return [];
    const url = new URL(`${API_BASE_URL}/inventory/index.php/list`, window.location.origin);
    url.searchParams.set("q", component.product_name || "");
    if (component.category_label) {
      url.searchParams.set("category", component.category_label);
    }
    url.searchParams.set("limit", "200");
    url.searchParams.set("group", "none");
    try {
      const res = await fetch(url.toString(), {
        credentials: "include",
        headers: { Accept: "application/json" },
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        throw new Error(json?.error || `HTTP ${res.status}`);
      }
      const items = Array.isArray(json?.data?.items) ? json.data.items : [];
      const productName = (component.product_name || "").toLowerCase();
      const categoryLabel = (component.category_label || "").toLowerCase();
      const now = new Date();
      return items
        .filter((item) => {
          const nameMatch = String(item.item_name || item.product_name || "").toLowerCase() === productName;
          const catMatch = categoryLabel
            ? String(item.category || "").toLowerCase() === categoryLabel
            : true;
          const hasQuantity = Number(item.quantity || item.total_quantity || 0) > 0;
          const expiryDate = item.expiry_date || item.earliest_expiry;
          const isNotExpired = !expiryDate || new Date(expiryDate) >= now;
          
          return nameMatch && catMatch && hasQuantity && isNotExpired;
        })
        .map((item) => ({
          inventory_id: Number(item.id || item.inventory_id),
          quantity: Number(item.quantity || item.total_quantity || 0) || 0,
          expiry_date: item.expiry_date || item.earliest_expiry || null,
          added_at: item.added_at || item.created_at || null,
        }))
        .sort((a, b) => {
          const expA = a.expiry_date ? new Date(a.expiry_date).getTime() : Infinity;
          const expB = b.expiry_date ? new Date(b.expiry_date).getTime() : Infinity;
          return expA - expB;
        });
    } catch (err) {
      console.error("Failed to load lots for component", err);
      showRepackToast("Failed to load lots", "danger");
      return [];
    }
  }

  function renderLotModalTable(filter = "") {
    const context = repackState.lotModal;
    const tbody = document.querySelector("#repackLotTable tbody");
    const summary = document.getElementById("repackLotSummary");
    if (!context || !tbody) return;
    const search = filter.trim().toLowerCase();
    context.lastFilter = filter;
    if (!Array.isArray(context.selection)) context.selection = [];
    const selectionMap = new Map(
      context.selection.map((lot) => [Number(lot.inventory_id), Number(lot.quantity || 0)])
    );
    const allocated = context.selection.reduce((sum, lot) => sum + Number(lot.quantity || 0), 0);
    const rows = context.lots
      .filter((lot) => {
        if (!search) return true;
        return String(lot.inventory_id).includes(search);
      })
      .map((lot) => {
        const lotId = Number(lot.inventory_id);
        const selectedQty = selectionMap.get(lotId) || 0;
        const checkedAttr = selectedQty > 0 ? " checked" : "";
        const allocationLabel = selectedQty > 0
          ? `${formatWholeQuantity(selectedQty)} allocated / ${formatWholeQuantity(lot.quantity || 0)} available`
          : `${formatWholeQuantity(lot.quantity || 0)} available`;
        return `
          <tr data-lot-id="${lotId}" data-available="${lot.quantity}">
            <td>#${lotId}</td>
            <td>${formatWholeQuantity(lot.quantity)}</td>
            <td>${lot.expiry_date ? escapeHtml(lot.expiry_date) : "—"}</td>
            <td class="text-center">
              <div class="form-check m-0">
                <input class="form-check-input repack-lot-toggle" type="checkbox" data-lot-id="${lotId}"${checkedAttr} aria-label="Use lot #${lotId}" />
              </div>
              <div class="small text-muted">${allocationLabel}</div>
            </td>
          </tr>
        `;
      });
    tbody.innerHTML = rows.length
      ? rows.join("")
      : '<tr><td colspan="4" class="text-center text-muted py-3">No lots found.</td></tr>';

    tbody.querySelectorAll(".repack-lot-toggle").forEach((toggle) => {
      toggle.addEventListener("change", (event) => {
        const lotId = Number(event.target.dataset.lotId);
        if (!Number.isFinite(lotId)) return;
        setLotSelection(lotId, Boolean(event.target.checked));
      });
    });

    if (summary) {
      const remaining = Math.max(Number(context.required || 0) - allocated, 0);
      summary.textContent = `Allocated ${formatWholeQuantity(allocated)} / ${formatWholeQuantity(context.required)}${
        remaining > 0 ? ` · Remaining ${formatWholeQuantity(remaining)}` : ""
      }`;
    }
  }

  function setLotSelection(lotId, selected) {
    const context = repackState.lotModal;
    if (!context) return;
    if (!Array.isArray(context.selection)) context.selection = [];
    const feedback = document.getElementById("repackLotFeedback");
    if (feedback) feedback.textContent = "";
    const required = Number(context.required || 0);
    const lot = context.lots.find((item) => Number(item.inventory_id) === lotId);
    const currentTotal = context.selection.reduce((sum, lot) => sum + Number(lot.quantity || 0), 0);
    const existingEntry = context.selection.find((item) => Number(item.inventory_id) === lotId);
    const totalWithoutLot = existingEntry ? currentTotal - Number(existingEntry.quantity || 0) : currentTotal;

    if (!selected) {
      context.selection = context.selection.filter((item) => Number(item.inventory_id) !== lotId);
      commitLotSelection();
      renderLotModalTable(context.lastFilter || "");
      return;
    }

    if (!lot) {
      commitLotSelection();
      renderLotModalTable(context.lastFilter || "");
      return;
    }

    const remaining = required - totalWithoutLot;
    if (remaining <= 0) {
      if (feedback) feedback.textContent = "Requirement already satisfied. Unselect another lot to reassign.";
      commitLotSelection();
      renderLotModalTable(context.lastFilter || "");
      return;
    }

    const assignable = Math.min(Number(lot.quantity || 0), remaining);
    if (assignable <= 0) {
      if (feedback) feedback.textContent = "No quantity remaining to allocate for this lot.";
      commitLotSelection();
      renderLotModalTable(context.lastFilter || "");
      return;
    }

    context.selection = context.selection.filter((item) => Number(item.inventory_id) !== lotId);
    context.selection.push({
      inventory_id: lotId,
      quantity: assignable,
      available: Number(lot.quantity || 0) || 0,
    });
    commitLotSelection();
    renderLotModalTable(context.lastFilter || "");
  }

  function buildLotAllocation(lots, required, preferredIds = []) {
    if (!Array.isArray(lots) || !lots.length || required <= 0) {
      return { assignments: [], remaining: Math.max(required, 0) };
    }

    const order = [];
    preferredIds
      .filter((id) => Number.isFinite(id))
      .forEach((id) => {
        if (!order.includes(id)) order.push(id);
      });
    lots.forEach((lot) => {
      const id = Number(lot.inventory_id);
      if (!Number.isFinite(id)) return;
      if (!order.includes(id)) order.push(id);
    });

    let remaining = Math.max(0, Number(required) || 0);
    const assignments = [];

    order.forEach((lotId) => {
      if (remaining <= 0) return;
      const lot = lots.find((item) => Number(item.inventory_id) === lotId);
      if (!lot) return;
      const available = Number(lot.quantity ?? lot.available ?? 0) || 0;
      if (available <= 0) return;
      const assignable = Math.min(available, remaining);
      if (assignable > 0) {
        assignments.push({ inventory_id: lotId, quantity: assignable, available });
        remaining -= assignable;
      }
    });

    return { assignments, remaining };
  }

  function recomputeAllocationsForCurrentKits() {
    const template = repackState.run.template;
    if (!template) return;
    const kits = Math.max(1, Number(repackState.run.kits || 1));
    template.components.forEach((component) => {
      const componentId = component.kit_component_id;
      const required = (Number(component.quantity_per_kit || 0) || 0) * kits;
      const cachedLots = repackState.run.lotCache?.[componentId];
      if (!Array.isArray(cachedLots) || !cachedLots.length || required <= 0) {
        return;
      }
      const preferred = (repackState.run.allocations[componentId]?.lots || [])
        .map((lot) => Number(lot.inventory_id))
        .filter(Number.isFinite);
      const { assignments } = buildLotAllocation(cachedLots, required, preferred);
      if (assignments.length) {
        repackState.run.allocations[componentId] = {
          lots: assignments.map((entry) => ({
            inventory_id: Number(entry.inventory_id),
            quantity: Number(entry.quantity || 0),
            available: Number(entry.available || 0),
          })),
        };
      } else {
        delete repackState.run.allocations[componentId];
      }
    });
  }

  function autoFillLotSelection() {
    const ctx = repackState.lotModal;
    if (!ctx) return;
    const required = Math.max(0, Number(ctx.required || 0));
    const lots = Array.isArray(ctx.lots) ? ctx.lots : [];
    const preferred = Array.isArray(ctx.selection)
      ? ctx.selection.map((sel) => Number(sel.inventory_id)).filter(Number.isFinite)
      : [];
    const { assignments, remaining } = buildLotAllocation(lots, required, preferred);
    ctx.selection = assignments;
    ctx.unmetRequirement = remaining;
  }

  function commitLotSelection() {
    const ctx = repackState.lotModal;
    if (!ctx) return;
    if (!Array.isArray(ctx.selection)) ctx.selection = [];
    const required = Number(ctx.required || 0);
    const total = ctx.selection.reduce((sum, lot) => sum + Number(lot.quantity || 0), 0);
    const lotsById = Array.isArray(ctx.lots)
      ? new Map(ctx.lots.map((lot) => [Number(lot.inventory_id), Number(lot.quantity || 0) || 0]))
      : new Map();
    if (total === required && required > 0) {
      repackState.run.allocations[ctx.componentId] = {
        lots: ctx.selection.map((lot) => ({
          inventory_id: Number(lot.inventory_id),
          quantity: Number(lot.quantity || 0),
          available: Number(lot.available ?? lotsById.get(Number(lot.inventory_id)) ?? lot.quantity ?? 0) || 0,
        })),
      };
    } else {
      delete repackState.run.allocations[ctx.componentId];
    }
    if (!repackState.run.lotCache) repackState.run.lotCache = Object.create(null);
    repackState.run.lotCache[ctx.componentId] = Array.isArray(ctx.lots) ? ctx.lots : [];
    renderRunComponentsTable();
    updateRunSubmitState();
  }

  function openLotModalForComponent(componentId) {
    const template = repackState.run.template;
    if (!template) return;
    const component = template.components.find((c) => c.kit_component_id === componentId);
    if (!component) return;
    const kits = repackState.run.kits || 1;
    const required = (Number(component.quantity_per_kit || 0) || 0) * kits;
    const existing = repackState.run.allocations[componentId]?.lots || [];
    repackState.lotModal = {
      component,
      componentId,
      required,
      lots: [],
      selection: existing.map((lot) => ({ ...lot })),
    };
    const headerName = document.getElementById("repackLotComponentName");
    const requirementEl = document.getElementById("repackLotRequirement");
    if (headerName) headerName.textContent = component.product_name || "Component";
    if (requirementEl) requirementEl.textContent = `Required: ${required}`;
    const feedback = document.getElementById("repackLotFeedback");
    if (feedback) feedback.textContent = "";
    const searchInput = document.getElementById("repackLotSearchInput");
    if (searchInput) searchInput.value = "";
    fetchComponentLots(component).then((lots) => {
      repackState.lotModal.lots = lots;
      if (!repackState.run.lotCache) repackState.run.lotCache = Object.create(null);
      repackState.run.lotCache[componentId] = lots;
      autoFillLotSelection();
      commitLotSelection();
      renderLotModalTable();
    });
    const modalEl = document.getElementById("repackLotModal");
    if (modalEl && typeof bootstrap !== "undefined") {
      repackState.lotModal.modal = bootstrap.Modal.getOrCreateInstance(modalEl);
      repackState.lotModal.modal.show();
    }
  }

  function applyLotSelection() {
    const ctx = repackState.lotModal;
    if (!ctx) return;
    if (!Array.isArray(ctx.selection)) ctx.selection = [];
    const feedback = document.getElementById("repackLotFeedback");
    if (feedback) feedback.textContent = "";
    const total = ctx.selection.reduce((sum, lot) => sum + Number(lot.quantity || 0), 0);
    if (total !== Number(ctx.required || 0)) {
      if (feedback) feedback.textContent = `Allocate lots totaling exactly ${ctx.required}.`;
      return;
    }
    commitLotSelection();
    if (ctx.modal) ctx.modal.hide();
    renderRunComponentsTable();
    updateRunSubmitState();
  }

  async function executeRepackRun() {
    const template = repackState.run.template;
    if (!template) return;
    const kits = Math.max(1, Number(repackState.run.kits || 0));
    const submitBtn = document.getElementById("repackRunSubmitBtn");
    const feedback = document.getElementById("repackRunFeedback");
    if (feedback) feedback.textContent = "";
    const note = String(document.getElementById("repackRunNote")?.value || "").trim() || null;
    const componentsPayload = [];
    const templateId = template.kit_template_id || template.id;
    for (const component of template.components) {
      const required = (Number(component.quantity_per_kit || 0) || 0) * kits;
      const allocation = repackState.run.allocations[component.kit_component_id];
      if (!allocation || !allocation.lots.length) {
        if (feedback) feedback.textContent = "Allocate lots for every component.";
        return;
      }
      const total = allocation.lots.reduce((sum, lot) => sum + Number(lot.quantity || 0), 0);
      if (total !== required) {
        if (feedback) feedback.textContent = `Component ${component.product_name} allocation mismatch.`;
        return;
      }
      componentsPayload.push({
        kit_component_id: component.kit_component_id,
        lots: allocation.lots.map((lot) => ({
          inventory_id: lot.inventory_id,
          quantity: Number(lot.quantity || 0),
        })),
      });
    }
    if (submitBtn) submitBtn.disabled = true;
    try {
      const res = await fetch(`${API_BASE_URL}/repack/index.php/templates/${templateId}/produce`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          kits_produced: kits,
          note,
          components: componentsPayload,
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        throw new Error(json?.error || `HTTP ${res.status}`);
      }
      showRepackToast(`Repack run completed: produced ${kits} kit${kits === 1 ? "" : "s"}.`, "success");
      const modalEl = document.getElementById("repackRunModal");
      if (modalEl && typeof bootstrap !== "undefined") {
        bootstrap.Modal.getOrCreateInstance(modalEl).hide();
      }
      resetRunState();
      renderRunSummary();
      renderRunComponentsTable();
      try { window.__invNonExpiredCache = {}; } catch (_) {}
      loadAndRender(window.__inventoryLast?.pagination?.page || 1);
    } catch (err) {
      console.error("Failed to execute repack", err);
      if (feedback) feedback.textContent = err?.message || "Failed to execute repack.";
      showRepackToast("Failed to execute repack", "danger");
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  }

  async function openRunModal() {
    await ensureRepackReferenceData();
    await fetchTemplates(true);
    resetRunState();
    const selected = populateRunTemplateOptions();
    const qtyEl = document.getElementById("repackRunQuantity");
    if (qtyEl) qtyEl.value = "1";
    const noteEl = document.getElementById("repackRunNote");
    if (noteEl) noteEl.value = "";
    if (selected) {
      let template = repackState.templateLookup[selected.kit_template_id || selected.id];
      if (!template || !Array.isArray(template.components)) {
        template = await fetchTemplateDetail(selected.kit_template_id || selected.id);
      }
      setRunTemplate(template || null);
    } else {
      setRunTemplate(null);
    }
    bindRunModalEvents();
    const modalEl = document.getElementById("repackRunModal");
    if (modalEl && typeof bootstrap !== "undefined") {
      bootstrap.Modal.getOrCreateInstance(modalEl).show();
    }
  }

  function bindRunModalEvents() {
    const templateSelect = document.getElementById("repackRunTemplateSelect");
    if (templateSelect && !templateSelect.dataset.bound) {
      templateSelect.dataset.bound = "1";
      templateSelect.addEventListener("change", handleRunTemplateChange);
    }
    const quantityInput = document.getElementById("repackRunQuantity");
    if (quantityInput && !quantityInput.dataset.bound) {
      quantityInput.dataset.bound = "1";
      quantityInput.addEventListener("change", handleRunQuantityChange);
      quantityInput.addEventListener("input", handleRunQuantityChange);
    }
    const submitBtn = document.getElementById("repackRunSubmitBtn");
    if (submitBtn && !submitBtn.dataset.bound) {
      submitBtn.dataset.bound = "1";
      submitBtn.addEventListener("click", executeRepackRun);
    }
    const refreshBtn = document.getElementById("repackRunRefreshTemplateBtn");
    if (refreshBtn && !refreshBtn.dataset.bound) {
      refreshBtn.dataset.bound = "1";
      refreshBtn.addEventListener("click", async () => {
        const select = document.getElementById("repackRunTemplateSelect");
        if (!select) return;
        const id = select.value;
        if (!id) return;
        const tpl = await fetchTemplateDetail(id);
        setRunTemplate(tpl || null);
      });
    }
    const table = document.getElementById("repackComponentsTable");
    if (table && !table.dataset.bound) {
      table.dataset.bound = "1";
      table.addEventListener("click", (e) => {
        const btn = e.target.closest(".repack-allocate-btn");
        if (!btn) return;
        const componentId = parseInt(btn.getAttribute("data-component-id") || "0", 10) || 0;
        if (!componentId) return;
        openLotModalForComponent(componentId);
      });
    }
    const lotSearch = document.getElementById("repackLotSearchInput");
    if (lotSearch && !lotSearch.dataset.bound) {
      lotSearch.dataset.bound = "1";
      lotSearch.addEventListener("input", (e) => {
        renderLotModalTable(e.target.value || "");
      });
    }
    const lotReload = document.getElementById("repackLotReloadBtn");
    if (lotReload && !lotReload.dataset.bound) {
      lotReload.dataset.bound = "1";
      lotReload.addEventListener("click", async () => {
        const ctx = repackState.lotModal;
        if (!ctx) return;
        const lots = await fetchComponentLots(ctx.component);
        repackState.lotModal.lots = lots;
        if (!repackState.run.lotCache) repackState.run.lotCache = Object.create(null);
        repackState.run.lotCache[ctx.componentId] = lots;
        renderLotModalTable(document.getElementById("repackLotSearchInput")?.value || "");
      });
    }
    const lotApply = document.getElementById("repackLotApplyBtn");
    if (lotApply && !lotApply.dataset.bound) {
      lotApply.dataset.bound = "1";
      lotApply.addEventListener("click", applyLotSelection);
    }
  }

  // ---------------------------------------------------------------------------
  // Repack Operation History
  // ---------------------------------------------------------------------------

  repackState.operations = {
    items: [],
    lookup: {},
    selectedId: null,
  };

  async function fetchRepackOperations(force = false) {
    if (!force && repackState.operations.items.length) return repackState.operations.items;
    try {
      const res = await fetch(`${API_BASE_URL}/repack/index.php/operations?limit=50`, {
        credentials: "include",
        headers: { Accept: "application/json" },
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        throw new Error(json?.error || `HTTP ${res.status}`);
      }
      const items = Array.isArray(json?.data?.items) ? json.data.items : [];
      repackState.operations.items = items;
      repackState.operations.lookup = Object.create(null);
      items.forEach((op) => {
        if (op && op.repack_id != null) {
          repackState.operations.lookup[op.repack_id] = op;
        }
      });
      return items;
    } catch (err) {
      console.error("Failed to load repack operations", err);
      showRepackToast("Failed to load repack operations", "danger");
      return [];
    }
  }

  async function fetchOperationDetail(repackId) {
    try {
      const res = await fetch(`${API_BASE_URL}/repack/index.php/operations/${repackId}`, {
        credentials: "include",
        headers: { Accept: "application/json" },
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        throw new Error(json?.error || `HTTP ${res.status}`);
      }
      const op = json.data;
      if (op) {
        repackState.operations.lookup[repackId] = op;
      }
      return op;
    } catch (err) {
      console.error("Failed to load operation detail", err);
      showRepackToast("Failed to load run details", "danger");
      return null;
    }
  }

  function renderOperationsTable() {
    const tbody = document.querySelector("#repackOpsTable tbody");
    if (!tbody) return;
    const rows = repackState.operations.items.map((op) => {
      const id = op.repack_id;
      const kits = op.kits_produced || op.kits || op.total_output_quantity || 0;
      return `
        <tr data-repack-id="${id}">
          <td>${id}</td>
          <td>${escapeHtml(op.kit_name || op.template_name || "")}</td>
          <td>${kits}</td>
          <td>${escapeHtml(op.performed_by_name || "")}</td>
          <td>${escapeHtml(op.created_at || "")}</td>
        </tr>
      `;
    });
    tbody.innerHTML = rows.length
      ? rows.join("")
      : '<tr><td colspan="5" class="text-center text-muted py-3">No repack runs recorded.</td></tr>';
  }

  function renderOperationDetails(op) {
    const inputsList = document.getElementById("repackOpsInputsList");
    const outputsList = document.getElementById("repackOpsOutputsList");
    if (inputsList) {
      inputsList.innerHTML = Array.isArray(op?.inputs) && op.inputs.length
        ? op.inputs
            .map(
              (input) =>
                `<li class="list-group-item d-flex justify-content-between align-items-center">
                  <span>${escapeHtml(input.product_name_snapshot || "")}</span>
                  <span class="badge bg-light text-dark">${input.quantity_used}</span>
                </li>`
            )
            .join("")
        : '<li class="list-group-item text-muted">No inputs recorded.</li>';
    }
    if (outputsList) {
      outputsList.innerHTML = Array.isArray(op?.outputs) && op.outputs.length
        ? op.outputs
            .map(
              (output) =>
                `<li class="list-group-item d-flex justify-content-between align-items-center">
                  <span>${escapeHtml(output.product_name_snapshot || "")}</span>
                  <span class="badge bg-light text-dark">${output.quantity_produced}</span>
                </li>`
            )
            .join("")
        : '<li class="list-group-item text-muted">No outputs recorded.</li>';
    }
  }

  async function handleOperationRowClick(repackId) {
    let op = repackState.operations.lookup[repackId];
    if (!op || !op.inputs || !op.outputs) {
      op = await fetchOperationDetail(repackId);
    }
    if (!op) return;
    repackState.operations.selectedId = repackId;
    renderOperationDetails(op);
  }

  async function openOperationsModal() {
    await fetchRepackOperations(true);
    renderOperationsTable();
    renderOperationDetails(null);
    bindOperationsModalEvents();
    const modalEl = document.getElementById("repackOpsModal");
    if (modalEl && typeof bootstrap !== "undefined") {
      bootstrap.Modal.getOrCreateInstance(modalEl).show();
    }
  }

  function bindRepackEntryPoints() {
    const tplBtn = document.getElementById("repackTemplatesOpenBtn");
    if (tplBtn && !tplBtn.dataset.bound) {
      tplBtn.dataset.bound = "1";
      tplBtn.addEventListener("click", (e) => {
        e.preventDefault();
        openTemplateModal();
      });
    }
    const runBtn = document.getElementById("repackRunOpenBtn");
    if (runBtn && !runBtn.dataset.bound) {
      runBtn.dataset.bound = "1";
      runBtn.addEventListener("click", (e) => {
        e.preventDefault();
        openRunModal();
      });
    }
    const opsBtn = document.getElementById("repackOpsOpenBtn");
    if (opsBtn && !opsBtn.dataset.bound) {
      opsBtn.dataset.bound = "1";
      opsBtn.addEventListener("click", (e) => {
        e.preventDefault();
        openOperationsModal();
      });
    }
    bindTemplateModalEvents();
    bindRunModalEvents();
    bindOperationsModalEvents();
  }

  function bindOperationsModalEvents() {
    const tbody = document.querySelector("#repackOpsTable tbody");
    if (tbody && !tbody.dataset.bound) {
      tbody.dataset.bound = "1";
      tbody.addEventListener("click", async (e) => {
        const row = e.target.closest("tr[data-repack-id]");
        if (!row) return;
        const id = parseInt(row.getAttribute("data-repack-id") || "0", 10) || 0;
        if (!id) return;
        handleOperationRowClick(id);
      });
    }
    const refreshBtn = document.getElementById("repackOpsRefreshBtn");
    if (refreshBtn && !refreshBtn.dataset.bound) {
      refreshBtn.dataset.bound = "1";
      refreshBtn.addEventListener("click", async () => {
        await fetchRepackOperations(true);
        renderOperationsTable();
        renderOperationDetails(null);
      });
    }
  }

  function updateRowImmediate(itemName, category, updater) {
    try {
      const tbody = document.querySelector("main .table tbody");
      if (!tbody) return;
      const rows = tbody.querySelectorAll("tr");
      for (const tr of rows) {
        const tds = tr.querySelectorAll("td");
        if (tds.length < 8) continue;
        const nameText = (tds[0].textContent || "").trim();
        const catText = (tds[1].textContent || "").trim();
        if (nameText === itemName && catText === category) {
          updater(tr, tds);
          break;
        }
      }
    } catch (_) {}
  }

  async function loadCategoriesIntoSelect(id, items) {
    const sel = document.getElementById(id);
    if (!sel) return;
    const current = sel.value;
    const opts = ["<option>All</option>"];
    const names = Array.from(
      new Set(
        (items || []).map((c) => String(c.name || "").trim()).filter(Boolean)
      )
    ).sort();
    for (const n of names) {
      opts.push(`<option>${escapeHtml(n)}</option>`);
    }
    sel.innerHTML = opts.join("");
    if (names.includes(current)) {
      sel.value = current;
    }
  }

  async function loadCategories() {
    try {
      const url = `${API_BASE_URL}/categories/index.php?action=list&active=1&debug=1&t=${Date.now()}`;
      const res = await fetch(url, {
        credentials: "include",
        headers: { Accept: "application/json" },
      });
      const j = await res.json().catch(() => null);
      const items = Array.isArray(j?.data?.items) ? j.data.items : [];
      await loadCategoriesIntoSelect("inventoryCategorySelectDesktop", items);
      await loadCategoriesIntoSelect("inventoryCategorySelectMobile", items);
    } catch (_) {
      // leave existing options
    }
  }

  function bindActions() {
    document.addEventListener("click", async function (e) {
      const btnOn = e.target.closest(".inv-issue-onsite");
      const btnTag = e.target.closest(".inv-edit-tags");
      if (!btnOn) return;
      const itemName = btnOn.getAttribute("data-item-name") || "";
      const category = btnOn.getAttribute("data-category") || "";
      if (!itemName || !category) return;

      try {
        if (btnTag) {
          /* handled in separate branch below */
        }
        // Open modal and store context
        window.__onsiteCtx = { itemName, category };
        const meta = document.getElementById("onsiteIssueItemMeta");
        if (meta) meta.textContent = `${itemName} (${category})`;
        const qtyEl = document.getElementById("onsiteQty");
        if (qtyEl) qtyEl.value = "1";
        const noteEl = document.getElementById("onsiteNote");
        if (noteEl) noteEl.value = "";
        const fb = document.getElementById("onsiteIssueFeedback");
        if (fb) fb.textContent = "";
        
        // Load lots for this item
        loadOnsiteLots(itemName, category);
        
        const mEl = document.getElementById("onsiteIssueModal");
        if (mEl && typeof bootstrap !== "undefined" && bootstrap.Modal) {
          bootstrap.Modal.getOrCreateInstance(mEl).show();
        }
      } catch (err) {
        console.error("Open onsite modal failed:", err);
      }
    });
  }

  // Separate delegation for tag editing to use modal instead of prompt
  document.addEventListener("click", async function (e) {
    const btnTag = e.target.closest(".inv-edit-tags");
    if (!btnTag) return;
    const itemName = btnTag.getAttribute("data-item-name") || "";
    const category = btnTag.getAttribute("data-category") || "";
    const currentTags = btnTag.getAttribute("data-tags") || "";
    try {
      // Store context
      window.__tagCtx = { itemName, category };
      const meta = document.getElementById("tagEditMeta");
      if (meta) meta.textContent = `${itemName} (${category})`;
      const input = document.getElementById("tagEditInput");
      if (input) input.value = currentTags;
      const fb = document.getElementById("tagEditFeedback");
      if (fb) fb.textContent = "";
      const modalEl = document.getElementById("tagEditModal");
      if (modalEl && typeof bootstrap !== "undefined" && bootstrap.Modal) {
        bootstrap.Modal.getOrCreateInstance(modalEl).show();
      }
    } catch (err) {
      console.error("Open tag edit modal failed:", err);
    }
  });

  async function openRepackInventoryView(itemName, category) {
    const modalEl = document.getElementById("repackInventoryViewModal");
    if (!modalEl || typeof bootstrap === "undefined") return;
    const metaEl = document.getElementById("repackInventoryViewMeta");
    const tbody = document.querySelector("#repackInventoryViewTable tbody");
    const feedbackEl = document.getElementById("repackInventoryViewFeedback");
    const lotWrapper = document.getElementById("repackInventoryViewLotChooserWrapper");
    const lotSelect = document.getElementById("repackInventoryViewLotSelect");
    const lotFeedback = document.getElementById("repackInventoryViewLotFeedback");

    if (feedbackEl) feedbackEl.textContent = "";
    if (lotFeedback) lotFeedback.textContent = "";

    if (metaEl) {
      const parts = [];
      const nameLabel = String(itemName || "").trim();
      if (nameLabel) parts.push(nameLabel);
      const catLabel = String(category || "").trim();
      if (catLabel) parts.push(catLabel);
      metaEl.textContent = parts.length ? parts.join(" · ") : "";
    }

    if (tbody) {
      tbody.innerHTML =
        '<tr><td colspan="3" class="text-center text-muted">Select a kit lot to view its components.</td></tr>';
    }

    if (lotWrapper) {
      lotWrapper.classList.remove("d-none");
    }
    if (lotSelect) {
      lotSelect.disabled = true;
      lotSelect.innerHTML = '<option value="">Loading lots...</option>';
    }

    const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
    modal.show();

    try {
      // Load lots for this kit item using the existing lot-details endpoint
      const url = new URL(`${API_BASE_URL}/inventory/index.php/lot-details`, window.location.origin);
      url.searchParams.set("item_name", itemName || "");
      url.searchParams.set("category", category || "");
      const res = await fetch(url.toString(), {
        method: "GET",
        credentials: "include",
        headers: { Accept: "application/json" },
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const json = await res.json().catch(() => null);
      if (!json || json.success === false) {
        throw new Error(json?.error || "Unable to load lot details.");
      }
      const lots = Array.isArray(json?.data?.lots) ? json.data.lots : [];

      if (!lotSelect) {
        return;
      }

      if (!lots.length) {
        lotSelect.innerHTML = '<option value="">No lots found for this kit.</option>';
        lotSelect.disabled = true;
        if (feedbackEl) {
          feedbackEl.textContent = "No inventory lots were found for this kit item.";
        }
        return;
      }

      // Populate selector with lots
      const options = [];
      options.push('<option value="">Select a lot…</option>');
      lots.forEach((lot) => {
        const invId = lot.lot_id != null ? String(lot.lot_id) : "";
        if (!invId) return;
        const qty = formatWholeQuantity(lot.quantity ?? 0);
        const unit = escapeHtml(lot.unit || "");
        const expiry = lot.expiry_date ? formatDate(lot.expiry_date) : "No expiry";
        const status = escapeHtml(lot.status || "");
        const label = `Lot #${invId} — ${qty} ${unit || ""} • ${expiry} • ${status}`;
        options.push(`<option value="${escapeAttr(invId)}">${escapeHtml(label)}</option>`);
      });
      lotSelect.innerHTML = options.join("");
      lotSelect.disabled = false;

      // If only one lot, auto-select and load components immediately
      const effectiveLots = lots.filter((lot) => lot.lot_id != null);
      if (effectiveLots.length === 1) {
        const onlyId = String(effectiveLots[0].lot_id);
        lotSelect.value = onlyId;
        await loadRepackComponentsForLot(onlyId, itemName, category);
      } else if (lotFeedback) {
        lotFeedback.textContent = "Choose a lot to see the exact components used for that run.";
      }
    } catch (err) {
      console.error("Failed to load lots for kit components view", err);
      if (lotSelect) {
        lotSelect.innerHTML = '<option value="">Failed to load lots</option>';
        lotSelect.disabled = true;
      }
      if (feedbackEl) {
        feedbackEl.textContent = err?.message || "Failed to load lots for this kit.";
      }
    }
  }

  async function loadRepackComponentsForLot(inventoryId, itemName, category) {
    const tbody = document.querySelector("#repackInventoryViewTable tbody");
    const feedbackEl = document.getElementById("repackInventoryViewFeedback");
    const metaEl = document.getElementById("repackInventoryViewMeta");

    if (feedbackEl) feedbackEl.textContent = "";
    if (tbody) {
      tbody.innerHTML =
        '<tr><td colspan="3" class="text-center text-muted">Loading components for selected lot...</td></tr>';
    }

    try {
      await ensureRepackReferenceData();
      await fetchTemplates();

      const url = new URL(
        `${API_BASE_URL}/repack/index.php/lookup/template-by-output-lot`,
        window.location.origin
      );
      url.searchParams.set("inventory_id", String(inventoryId || ""));
      const res = await fetch(url.toString(), {
        credentials: "include",
        headers: { Accept: "application/json" },
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json || json.success === false) {
        throw new Error(json?.error || `HTTP ${res.status}`);
      }
      const template = (json.data && (json.data.template || json.data)) || null;

      if (!template || !Array.isArray(template.components) || !template.components.length) {
        if (tbody) {
          tbody.innerHTML =
            '<tr><td colspan="3" class="text-center text-muted">No component definition found for this kit lot.</td></tr>';
        }
        if (feedbackEl) {
          feedbackEl.textContent =
            "No component snapshot was found for the selected kit lot.";
        }
        return;
      }

      if (metaEl) {
        const parts = [];
        const nameLabel = String(itemName || template.output_product_name || "").trim();
        if (nameLabel) parts.push(nameLabel);
        const catLabel = String(template.output_category_label || category || "").trim();
        if (catLabel) parts.push(catLabel);
        metaEl.textContent = parts.length ? parts.join(" · ") : metaEl.textContent;
      }

      if (tbody) {
        const rows = template.components.map((component) => {
          const name = escapeHtml(component.product_name || "");
          const qty = formatWholeQuantity(component.quantity_per_kit || 0);
          const unitLabel = escapeHtml(component.unit_label || "-");
          const catLabel = component.category_label
            ? `<div class="small text-muted">${escapeHtml(component.category_label || "")}</div>`
            : "";
          return `
            <tr>
              <td>
                <div class="fw-semibold">${name}</div>
                ${catLabel}
              </td>
              <td class="text-nowrap">${qty}</td>
              <td class="text-nowrap">${unitLabel}</td>
            </tr>
          `;
        });
        tbody.innerHTML = rows.join("");
      }
    } catch (err) {
      console.error("Failed to load repack components for selected lot", err);
      if (tbody) {
        tbody.innerHTML =
          '<tr><td colspan="3" class="text-center text-danger">Failed to load components.</td></tr>';
      }
      if (feedbackEl) {
        feedbackEl.textContent = err?.message || "Failed to load components for selected lot.";
      }
    }
  }

  document.addEventListener("click", async function (e) {
    const btnRepack = e.target.closest(".inv-view-repack");
    if (btnRepack) {
      e.preventDefault();
      const itemName = btnRepack.getAttribute("data-item-name") || "";
      const category = btnRepack.getAttribute("data-category") || "";
      await openRepackInventoryView(itemName, category);
      return;
    }
    const btnLot = e.target.closest(".inv-view-lots");
    if (!btnLot) return;
    e.preventDefault();
    const itemName = btnLot.getAttribute("data-item-name") || "";
    const category = btnLot.getAttribute("data-category") || "";
    const totalLots = parseInt(btnLot.getAttribute("data-total-lots") || "0", 10) || 0;
    await openLotDetails(itemName, category, totalLots);
  });

  // Change kit components view when a lot is selected in the Kit Components modal
  (function bindRepackInventoryViewLotChange() {
    try {
      const select = document.getElementById("repackInventoryViewLotSelect");
      if (!select) return;
      if (select.dataset.bound === "1") return;
      select.dataset.bound = "1";
      select.addEventListener("change", async function () {
        const inventoryId = this.value || "";
        if (!inventoryId) {
          const tbody = document.querySelector("#repackInventoryViewTable tbody");
          if (tbody) {
            tbody.innerHTML =
              '<tr><td colspan="3" class="text-center text-muted">Select a kit lot to view its components.</td></tr>';
          }
          return;
        }
        try {
          const metaEl = document.getElementById("repackInventoryViewMeta");
          const metaText = metaEl ? metaEl.textContent || "" : "";
          let itemName = "";
          let category = "";
          if (metaText) {
            const parts = metaText.split(" · ");
            if (parts.length > 0) itemName = parts[0];
            if (parts.length > 1) category = parts[1];
          }
          await loadRepackComponentsForLot(inventoryId, itemName, category);
        } catch (err) {
          console.error("Lot selection change failed", err);
        }
      });
    } catch (_) {}
  })();

  async function openLotDetails(itemName, category, totalLots){
    const modalEl = document.getElementById("inventoryLotsModal");
    if (!modalEl || typeof bootstrap === "undefined" || !bootstrap.Modal) return;
    const modal = bootstrap.Modal.getOrCreateInstance(modalEl);

    const titleEl = document.getElementById("inventoryLotsModalLabel");
    const metaEl = document.getElementById("lotDetailsMeta");
    const loadingEl = document.getElementById("lotDetailsLoading");
    const emptyEl = document.getElementById("lotDetailsEmpty");
    const tableWrapper = document.getElementById("lotDetailsTableWrapper");
    const tbody = document.getElementById("lotDetailsTableBody");
    if (!loadingEl || !emptyEl || !tbody) {
      modal.show();
      return;
    }

    if (titleEl){
      const lotLabel = totalLots > 1 ? `${totalLots} lots` : "Lot details";
      titleEl.textContent = `${itemName} • ${lotLabel}`;
    }
    if (metaEl){
      metaEl.textContent = category ? `Category: ${category}` : "Uncategorised";
    }

    loadingEl.classList.remove("d-none");
    emptyEl.classList.add("d-none");
    if (tableWrapper){
      tableWrapper.classList.add("d-none");
    }
    tbody.innerHTML = "";

    modal.show();

    try {
      const url = new URL(`${API_BASE_URL}/inventory/index.php/lot-details`, window.location.origin);
      url.searchParams.set("item_name", itemName);
      url.searchParams.set("category", category || "");
      const res = await fetch(url.toString(), {
        method: "GET",
        credentials: "include",
        headers: { Accept: "application/json" },
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const json = await res.json();
      if (!json?.success) {
        throw new Error(json?.error || "Unable to load lot details.");
      }
      const lots = Array.isArray(json?.data?.lots) ? json.data.lots : [];
      loadingEl.classList.add("d-none");
      if (!lots.length) {
        emptyEl.textContent = "No lots found for this item.";
        emptyEl.classList.remove("d-none");
        if (tableWrapper){
          tableWrapper.classList.add("d-none");
        }
        return;
      }

      emptyEl.classList.add("d-none");
      const rows = lots.map((lot) => {
        const lotId = lot.lot_id ? escapeHtml(String(lot.lot_id)) : "—";
        const quantity = escapeHtml(String(lot.quantity ?? 0));
        const unit = escapeHtml(lot.unit || "—");
        const added = lot.added_at ? formatDateTime(lot.added_at) : "—";
        const expiry = lot.expiry_date ? formatDate(lot.expiry_date) : "—";
        const status = escapeHtml(lot.status || "—");
        return `
          <tr>
            <td>${lotId}</td>
            <td class="text-end">${quantity}</td>
            <td>${unit}</td>
            <td>${added}</td>
            <td>${expiry}</td>
            <td>${status}</td>
          </tr>`;
      }).join("");
      tbody.innerHTML = rows;
      if (tableWrapper){
        tableWrapper.classList.remove("d-none");
      }
    } catch (err) {
      console.error("Failed to load lot details", err);
      loadingEl.classList.add("d-none");
      emptyEl.textContent = err?.message || "Failed to load lot details.";
      emptyEl.classList.remove("d-none");
      if (tableWrapper){
        tableWrapper.classList.add("d-none");
      }
    }
  }

  // When discard modal is closed, apply immediate visual deduction if available
  (function bindDiscardHiddenImmediateUpdate(){
    try {
      const dm = document.getElementById("discardModal");
      if (!dm) return;
      dm.addEventListener("hidden.bs.modal", function(){
        try {
          const info = window.__discardLast;
          if (!info || !info.itemName || !info.category || !info.qty) return;
          updateRowImmediate(info.itemName, info.category, (tr, tds) => {
            try {
              const qCell = tds[2];
              const current = parseInt((qCell.textContent || "0").replace(/[^0-9-]/g, ""), 10) || 0;
              const next = Math.max(0, current - Number(info.qty || 0));
              qCell.textContent = String(next);
            } catch (_) {}
          });
        } finally {
          try { window.__discardLast = null; } catch (_) {}
        }
      });
    } catch (_) {}
  })();

  // Delegated handler: Add quantity action (fires a custom event for app code to handle)
  document.addEventListener("click", function (e) {
    const el = e.target.closest(".inv-add");
    if (!el) return;
    e.preventDefault();
    const itemName = el.getAttribute("data-item-name") || "";
    const category = el.getAttribute("data-category") || "";
    const tags = el.getAttribute("data-tags") || "";
    try {
      window.dispatchEvent(
        new CustomEvent("inventory:add", { detail: { itemName, category, tags } })
      );
    } catch (_) {}
    // Close any open dropdown
    try {
      const dd = el.closest(".dropdown");
      const btn = dd && dd.querySelector("[data-bs-toggle=dropdown]");
      if (btn && typeof bootstrap !== "undefined") {
        const inst = bootstrap.Dropdown.getOrCreateInstance(btn);
        inst.hide();
      }
    } catch (_) {}
  });

  // Delegated handler: Discard quantity (opens modal, requires note)
  document.addEventListener("click", function (e) {
    const el = e.target.closest(".inv-discard");
    if (!el) return;
    e.preventDefault();
    const itemName = el.getAttribute("data-item-name") || "";
    const category = el.getAttribute("data-category") || "";
    // Store context
    window.__discardCtx = { itemName, category };
    try {
      const meta = document.getElementById("discardItemMeta");
      if (meta) meta.textContent = `${itemName} (${category})`;
      const qtyEl = document.getElementById("discardQty");
      if (qtyEl) qtyEl.value = "1";
      const noteEl = document.getElementById("discardNote");
      if (noteEl) noteEl.value = "";
      const fb = document.getElementById("discardFeedback");
      if (fb) fb.textContent = "";
      
      // Load lots for this item
      loadDiscardLots(itemName, category);
      
      const mEl = document.getElementById("discardModal");
      if (mEl && typeof bootstrap !== "undefined" && bootstrap.Modal) {
        bootstrap.Modal.getOrCreateInstance(mEl).show();
      }
      // Close dropdown after opening modal
      const dd = el.closest(".dropdown");
      const btn = dd && dd.querySelector("[data-bs-toggle=dropdown]");
      if (btn && typeof bootstrap !== "undefined") {
        const inst = bootstrap.Dropdown.getOrCreateInstance(btn);
        inst.hide();
      }
    } catch (_) {}
  });

  // Load lots for discard modal
  async function loadDiscardLots(itemName, category) {
    const lotSelect = document.getElementById("discardLot");
    if (!lotSelect) return;
    
    lotSelect.innerHTML = '<option value="">Loading lots...</option>';
    lotSelect.disabled = true;
    
    try {
      const url = new URL(`${API_BASE_URL}/inventory/index.php/lot-details`, window.location.origin);
      url.searchParams.set('item_name', itemName);
      url.searchParams.set('category', category);
      
      const resp = await fetch(url, { credentials: 'include' });
      if (!resp.ok) throw new Error('Failed to load lots');
      
      const json = await resp.json();
      const lots = Array.isArray(json?.data?.lots) ? json.data.lots : [];
      
      lotSelect.innerHTML = '<option value="">Any lot</option>';
      lots.forEach(lot => {
        const option = document.createElement('option');
        option.value = lot.lot_id;
        const qty = lot.quantity || 0;
        const expiry = lot.expiry_date ? formatDate(lot.expiry_date) : 'No expiry';
        option.textContent = `Lot #${lot.lot_id} — ${qty} units • ${expiry}`;
        try { option.dataset.qty = String(qty); } catch(_) {}
        lotSelect.appendChild(option);
      });
      
      lotSelect.disabled = false;
    } catch (err) {
      console.error('Failed to load discard lots:', err);
      lotSelect.innerHTML = '<option value="">Failed to load lots</option>';
      lotSelect.disabled = true;
    }
  }

  // Load lots for on-site giveaway modal
  async function loadOnsiteLots(itemName, category) {
    const lotSelect = document.getElementById("onsiteLot");
    if (!lotSelect) return;
    
    lotSelect.innerHTML = '<option value="">Loading lots...</option>';
    lotSelect.disabled = true;
    
    try {
      const url = new URL(`${API_BASE_URL}/inventory/index.php/lot-details`, window.location.origin);
      url.searchParams.set('item_name', itemName);
      url.searchParams.set('category', category);
      
      const resp = await fetch(url, { credentials: 'include' });
      if (!resp.ok) throw new Error('Failed to load lots');
      
      const json = await resp.json();
      const lots = Array.isArray(json?.data?.lots) ? json.data.lots : [];
      
      lotSelect.innerHTML = '<option value="">Select a lot...</option>';
      lots.forEach(lot => {
        const option = document.createElement('option');
        option.value = lot.lot_id;
        const qty = lot.quantity || 0;
        const expiry = lot.expiry_date ? formatDate(lot.expiry_date) : 'No expiry';
        option.textContent = `Lot #${lot.lot_id} — ${qty} units • ${expiry}`;
        try { option.dataset.qty = String(qty); } catch (_) {}
        lotSelect.appendChild(option);
      });
      
      lotSelect.disabled = false;
    } catch (err) {
      console.error('Failed to load onsite lots:', err);
      lotSelect.innerHTML = '<option value="">Failed to load lots</option>';
      lotSelect.disabled = true;
    }
  }

  // Submit Discard
  document.addEventListener("click", async function (e) {
    const submit = e.target.closest("#discardSubmitBtn");
    if (!submit) return;
    try {
      const ctx = window.__discardCtx || { itemName: "", category: "" };
      const qtyEl = document.getElementById("discardQty");
      const noteEl = document.getElementById("discardNote");
      const lotEl = document.getElementById("discardLot");
      const fb = document.getElementById("discardFeedback");
      const qty = parseInt(qtyEl && qtyEl.value ? qtyEl.value : "0", 10) || 0;
      const note = (noteEl && noteEl.value ? noteEl.value : "").trim();
      const lotId = lotEl ? lotEl.value : "";
      if (qty <= 0) { if (fb) fb.textContent = "Quantity must be at least 1."; return; }
      if (note.length === 0) { if (fb) fb.textContent = "Reason is required."; return; }
      fb && (fb.textContent = "");
      submit.disabled = true;
      // Call group move-out with mode 'discarded'
      const payload = { item_name: ctx.itemName, category: ctx.category, quantity: qty, mode: "discarded", note };
      if (lotId) payload.inventory_id = parseInt(lotId, 10);
      const resp = await fetch(`${API_BASE_URL}/inventory/index.php/move-out-group`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(payload)
      });
      const jr = await resp.json().catch(() => null);
      if (!resp.ok || jr?.success === false) {
        throw new Error(jr?.error || `HTTP ${resp.status}`);
      }
      // Save last successful discard for immediate UI update on modal close (disabled; use fresh reload)
      window.__discardLast = null;
      // Close discard modal and show success
      try {
        const dm = document.getElementById("discardModal");
        if (dm && typeof bootstrap !== "undefined" && bootstrap.Modal) {
          bootstrap.Modal.getOrCreateInstance(dm).hide();
        }
        document.querySelectorAll(".modal-backdrop").forEach((el)=>{ try{ el.remove(); }catch(_){} });
      } catch (_) {}
      // Show success toast instead of modal
      try {
        showToast(`Discarded ${qty} × ${ctx.itemName} (${ctx.category})`, 'success');
      } catch (_) {}
      // Invalidate any cached non-expired collection to avoid stale totals
      try {
        if (window.__invNonExpiredCache) {
          window.__invNonExpiredCache = {};
        }
      } catch (_) {}
      // Refresh table: keep current page and add small delay to allow DB commit
      const curPage = (window.__inventoryLast && window.__inventoryLast.pagination && window.__inventoryLast.pagination.page) ? Number(window.__inventoryLast.pagination.page) : 1;
      await new Promise(r => setTimeout(r, 250));
      await loadAndRender(curPage || 1);
      // Safety: follow-up refresh to eliminate transient race conditions
      setTimeout(() => { try { loadAndRender(curPage || 1); } catch(_){} }, 700);
    } catch (err) {
      const fb = document.getElementById("discardFeedback");
      if (fb) fb.textContent = err?.message || "Failed to discard.";
    } finally {
      const submitBtn = document.getElementById("discardSubmitBtn");
      if (submitBtn) submitBtn.disabled = false;
    }
  });

  function badge(status) {
    switch (status) {
      case "Expired":
        return '<span class="badge bg-danger">Expired</span>';
      case "Expiring Soon":
      case "Soon To Expire":
      case "Soon to Expire":
        return '<span class="badge bg-warning text-dark">Soon To Expire</span>';
      default:
        return '<span class="badge bg-success">In Stock</span>';
    }
  }

  async function fetchInventory(params = {}) {
    const url = new URL(
      `${API_BASE_URL}/inventory/index.php/list`,
      window.location.origin
    );
    const qp = new URLSearchParams();
    if (params.q) qp.set("q", params.q);
    if (params.category && params.category !== "All")
      qp.set("category", params.category);
    if (params.date && params.date !== "All") qp.set("date", params.date);
    // Request grouped view to merge same items
    qp.set("group", "merge");
    if (params.page) qp.set("page", params.page);
    if (params.limit) qp.set("limit", params.limit);
    // Cache-buster to ensure freshest data
    qp.set("t", String(Date.now()));
    // Enable backend debug messages during development
    qp.set("debug", "1");
    url.search = qp.toString();
    const res = await fetch(url.toString(), {
      method: "GET",
      credentials: "include",
      cache: "no-store",
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const json = await res.json();
    if (!json || json.success !== true)
      throw new Error(json?.error || "Failed to load inventory");
    return (
      json.data || { items: [], pagination: { page: 1, pages: 1, total: 0 }, config: {} }
    );
  }

  function getFilters() {
    const category =
      document.getElementById("inventoryCategorySelectDesktop")?.value ||
      document.getElementById("inventoryCategorySelectMobile")?.value ||
      "All";
    const q = document.getElementById("donationSearch")?.value || "";
    // Date range filters (from/to) come from inputs inside the Filters dropdown
    const fromDate = document.getElementById("fromDate")?.value || "";
    const toDate = document.getElementById("toDate")?.value || "";
    // Status filter
    const status = document.getElementById("filterStatusSelect")?.value || "";
    // Stock level filter
    const stockLevel = document.getElementById("filterStockLevel")?.value || "";
    // Category filter from dropdown
    const filterCategory = document.getElementById("filterCategorySelect")?.value || "";
    // Tag checkboxes
    const checkRepackKit = !!document.getElementById("checkRepackKit")?.checked;
    const checkHasTags = !!document.getElementById("checkHasTags")?.checked;
    // Sorting selections from Sort dropdown
    const sortExpiration = document.getElementById("sortExpiration")?.value || "None";
    const sortQuantity = document.getElementById("sortQuantity")?.value || "None";
    const sortCategory = document.getElementById("sortCategory")?.value || "None";
    const sortItemName = document.getElementById("sortItemName")?.value || "None";
    const hideExpired = !!document.getElementById("hideExpiredToggle")?.checked;
    return { category, q, fromDate, toDate, status, stockLevel, filterCategory, checkRepackKit, checkHasTags, sortExpiration, sortQuantity, sortCategory, sortItemName, hideExpired };
  }

  function applyConfig(meta = {}) {
    try {
      const leadDays = Number(meta?.config?.soon_expire_lead_days ?? meta?.soon_expire_lead_days ?? NaN);
      const el = document.getElementById("inventorySoonLeadNotice");
      if (el) {
        if (Number.isFinite(leadDays)) {
          const label = leadDays === 0
            ? 'Items expiring today are flagged as "Expiring Soon".'
            : `Items expiring within ${leadDays} day${leadDays === 1 ? '' : 's'} are flagged as "Expiring Soon".`;
          el.textContent = label;
          el.classList.remove('d-none');
        } else {
          el.textContent = '';
          el.classList.add('d-none');
        }
      }
    } catch (_) {}
  }

  // Helper function to format date
  function formatDate(dateStr) {
    if (!dateStr) return '—';
    try {
      const date = new Date(dateStr);
      return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
    } catch (e) {
      return dateStr;
    }
  }

  function formatDateTime(dateTimeStr){
    if (!dateTimeStr) return '—';
    try {
      const date = new Date(dateTimeStr);
      if (isNaN(date.getTime())) return dateTimeStr;
      return date.toLocaleString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch (_) {
      return dateTimeStr;
    }
  }

  // Helper function to create status badge with tooltip
  function statusBadge(status, breakdown) {
    if (!breakdown) return badge(status);
    
    const total = (breakdown.expired || 0) + (breakdown.soon || 0) + (breakdown.in_stock || 0);
    if (total <= 0) return badge(status);
    
    const tooltip = [];
    if (breakdown.expired) tooltip.push(`Expired: ${breakdown.expired}`);
    if (breakdown.soon) tooltip.push(`Expiring Soon: ${breakdown.soon}`);
    if (breakdown.in_stock) tooltip.push(`In Stock: ${breakdown.in_stock}`);
    
    return `
      <span data-bs-toggle="tooltip" data-bs-html="true" title="${tooltip.join('<br>')}">
        ${badge(status)}
      </span>`;
  }

  // Compute available (non-expired) quantity for an inventory row.
  // For grouped rows, this uses the status_breakdown fields so that expired
  // quantities (already moved to expired_inventory) do not inflate the
  // visible "Quantity" column or stock-level filters.
  function getAvailableQuantity(row) {
    const breakdown = row && row.status_breakdown;
    if (breakdown && typeof breakdown === "object") {
      const soon = Number(breakdown.soon ?? 0) || 0;
      const inStock = Number(breakdown.in_stock ?? 0) || 0;
      return soon + inStock;
    }
    return Number(row.total_quantity ?? row.quantity ?? 0) || 0;
  }

  function renderTable(items, meta) {
    const tbody = document.querySelector("main .table tbody");
    if (!tbody) return;
    applyConfig(meta);
    
    // Apply Hide Expired filter if toggle is on
    let filtered = Array.isArray(items) ? [...items] : [];
    try {
      const hide = document.getElementById("hideExpiredToggle");
      if (hide && hide.checked) {
        filtered = filtered.filter(
          (r) => String(r.derived_status || "In Stock") !== "Expired"
        );
      }
    } catch (_) {}
    
    if (!Array.isArray(filtered) || filtered.length === 0) {
      tbody.innerHTML =
        '<tr><td colspan="8" class="text-center py-4">No inventory items match the current filters.</td></tr>';
      return;
    }
    
    const rows = filtered.map((r) => {
      const rawItemName = r.item_name || "";
      const displayItem = escapeHtml(rawItemName);
      const rawCategory = r.category || "";
      const displayCategory = escapeHtml(rawCategory);
      const totalQty = getAvailableQuantity(r);
      const qty = formatWholeQuantity(totalQty);
      const unit = escapeHtml(r.unit || "");
      const soonest = formatDate(r.earliest_expiry);
      const tagsRaw = r.tags_concat || r.tags || "" || "";
      const tags = escapeHtml(tagsRaw);
      const status = statusBadge(r.derived_status || "In Stock", r.status_breakdown);
      const totalLots = Number(r.total_lots ?? 0);
      const dataAttributes = `data-item-name="${escapeAttr(rawItemName)}" data-category="${escapeAttr(rawCategory)}" data-tags="${escapeAttr(tagsRaw)}" data-total-lots="${escapeAttr(String(totalLots))}"`;
      const lotButton = totalLots > 1
        ? `<button type="button" class="btn btn-sm btn-outline-info inv-view-lots" ${dataAttributes} title="View lots" data-bs-toggle="tooltip"><i class="bi bi-eye"></i></button>`
        : "";
      const isRepackKit = (tagsRaw || "").toLowerCase().includes("repack kit");
      const repackButton = isRepackKit
        ? `<button type="button" class="btn btn-sm btn-outline-primary inv-view-repack" ${dataAttributes} title="View kit components" data-bs-toggle="tooltip"><i class="bi bi-box-seam"></i></button>`
        : "";

      // Status breakdown is still available in the tooltip on the status badge
      
      const actions = `
        <div class="dropdown text-center">
          <button class="btn btn-sm btn-outline-secondary" type="button" data-bs-toggle="dropdown" aria-expanded="false" title="Actions">
            <i class="bi bi-three-dots-vertical" data-bs-toggle="tooltip" data-bs-placement="top" title="More actions"></i>
          </button>
          <div class="dropdown-menu p-2 text-center">
            <div class="d-flex align-items-center justify-content-center" style="gap:6px;">
              ${lotButton}
              ${repackButton}
              <button type="button" class="btn btn-sm btn-outline-warning inv-edit-tags" ${dataAttributes} title="Edit Tags" data-bs-toggle="tooltip"><i class="bi bi-tags"></i></button>
              <button type="button" class="btn btn-sm btn-outline-secondary inv-issue-onsite" ${dataAttributes} title="On-site Giveaway" data-bs-toggle="tooltip"><i class="bi bi-people"></i></button>
              <button type="button" class="btn btn-sm btn-outline-danger inv-discard" ${dataAttributes} title="Discard" data-bs-toggle="tooltip"><i class="bi bi-trash"></i></button>
            </div>
          </div>
        </div>`;
        
      return `
        <tr>
          <td>
            <div class="fw-medium">${displayItem}</div>
            ${totalLots > 1 ? `<small class="text-muted">${totalLots} lots</small>` : ''}
          </td>
          <td>${displayCategory}</td>
          <td class="text-nowrap">${qty}</td>
          <td class="text-nowrap">${unit || '—'}</td>
          <td class="text-nowrap">${soonest}</td>
          <td>${tags || "—"}</td>
          <td>${status}</td>
          <td>${actions}</td>
        </tr>
      `;
    });
    
    tbody.innerHTML = rows.join("");

    // Initialize tooltips
    if (typeof bootstrap !== "undefined") {
      const tooltipTriggerList = [].slice.call(
        tbody.querySelectorAll('[data-bs-toggle="tooltip"]')
      );
      tooltipTriggerList.map(function (tooltipTriggerEl) {
        const cls =
          (tooltipTriggerEl.closest && tooltipTriggerEl.closest("table"))
            ? "table-tooltip"
            : (tooltipTriggerEl.getAttribute && tooltipTriggerEl.getAttribute("data-bs-custom-class")) || "custom-tooltip";
        return new bootstrap.Tooltip(tooltipTriggerEl, {
          customClass: cls,
          container: "body",
          boundary: "viewport",
          fallbackPlacements: ["right", "left", "bottom", "top"],
          trigger: "hover focus",
          delay: { show: 150, hide: 50 },
        });
      });
    }
  }

  function getPageSize() {
    const sel = document.getElementById("pageSizeSelect");
    const stored =
      parseInt(localStorage.getItem("inventory_page_size") || "0", 10) || 0;
    let val = stored || 20;
    if (sel) {
      const s = parseInt(sel.value || "0", 10) || 0;
      if (s) val = s;
    }
    return Math.max(1, Math.min(100, val));
  }

  function applyClientFiltersAndSort(items, filters) {
    let arr = Array.isArray(items) ? [...items] : [];
    
    // Status filter
    const status = (filters.status || "").trim();
    if (status) {
      arr = arr.filter((r) => {
        const itemStatus = String(r.derived_status || "In Stock").toLowerCase();
        if (status === "in_stock") return itemStatus === "in stock";
        if (status === "soon_expire") {
          // Backend uses "Expiring Soon"; support legacy label as well.
          return itemStatus === "expiring soon" || itemStatus === "soon to expire";
        }
        if (status === "expired") return itemStatus === "expired";
        return true;
      });
    }
    
    // Stock level filter
    const stockLevel = (filters.stockLevel || "").trim();
    if (stockLevel) {
      arr = arr.filter((r) => {
        const qty = getAvailableQuantity(r);
        const totalLots = Number(r.total_lots ?? 0) || 0;
        if (stockLevel === "low") return qty < 5;
        if (stockLevel === "high") return qty > 50;
        if (stockLevel === "multi_lot") return totalLots > 1;
        return true;
      });
    }
    
    // Category filter from dropdown
    const filterCategory = (filters.filterCategory || "").trim();
    if (filterCategory) {
      arr = arr.filter((r) => String(r.category || "").toLowerCase() === filterCategory.toLowerCase());
    }
    
    // Tag filters
    const checkRepackKit = filters.checkRepackKit;
    const checkHasTags = filters.checkHasTags;
    if (checkRepackKit || checkHasTags) {
      arr = arr.filter((r) => {
        const tags = String(r.tags_concat || r.tags || "").toLowerCase();
        if (checkRepackKit && !tags.includes("repack kit")) return false;
        if (checkHasTags && !tags.trim()) return false;
        return true;
      });
    }
    
    // Date range filter: use earliest_expiry if present
    const from = (filters.fromDate || "").trim();
    const to = (filters.toDate || "").trim();
    const parseD = (s) => {
      const d = new Date(s);
      return isNaN(d.getTime()) ? null : d;
    };
    const dFrom = from ? parseD(from) : null;
    const dTo = to ? parseD(to) : null;
    if (dFrom || dTo) {
      arr = arr.filter((r) => {
        const s = r.earliest_expiry || r.added_at || r.created_at || "";
        const d = parseD(s);
        if (!d) return false;
        if (dFrom && d < dFrom) return false;
        if (dTo) {
          const dToEnd = new Date(dTo);
          dToEnd.setHours(23, 59, 59, 999);
          if (d > dToEnd) return false;
        }
        return true;
      });
    }
    
    // Sorting: use sort* fields from Sort dropdown
    const expSel = (filters.sortExpiration || "").toLowerCase(); // "asc" | "desc" | ""
    const qtySel = (filters.sortQuantity || "").toLowerCase();
    const catSel = (filters.sortCategory || "").toLowerCase();
    const nameSel = (filters.sortItemName || "").toLowerCase();
    const toQty = (r) => getAvailableQuantity(r);
    const toDate = (r) => {
      const s = r.earliest_expiry || r.added_at || r.created_at || "";
      const d = new Date(s);
      return isNaN(d.getTime()) ? new Date(0) : d;
    };
    const toName = (r) => String(r.item_name || "").toLowerCase();
    const toCat = (r) => String(r.category || "").toLowerCase();
    if ([expSel, qtySel, catSel, nameSel].some((v) => v === "asc" || v === "desc")) {
      arr.sort((a, b) => {
        // 1) Expiration date (Soonest / Latest)
        if (expSel === "asc" || expSel === "desc") {
          const A = toDate(a).getTime(), B = toDate(b).getTime();
          if (A !== B) return expSel === "asc" ? A - B : B - A;
        }
        // 2) Quantity (Lowest / Highest)
        if (qtySel === "asc" || qtySel === "desc") {
          const A = toQty(a), B = toQty(b);
          if (A !== B) return qtySel === "asc" ? A - B : B - A;
        }
        // 3) Category (A–Z / Z–A)
        if (catSel === "asc" || catSel === "desc") {
          const A = toCat(a), B = toCat(b);
          if (A !== B) return catSel === "asc" ? (A < B ? -1 : 1) : (A > B ? -1 : 1);
        }
        // 4) Item name (A–Z / Z–A)
        if (nameSel === "asc" || nameSel === "desc") {
          const A = toName(a), B = toName(b);
          if (A !== B) return nameSel === "asc" ? (A < B ? -1 : 1) : (A > B ? -1 : 1);
        }
        return 0;
      });
    }
    return arr;
  }

  async function loadAndRender(page = 1) {
    // Prevent overlapping refreshes
    if (window.__invLoading) return;
    window.__invLoading = true;
    try {
      const filters = getFilters();
      const limit = getPageSize();
      const hideExpired = !!filters.hideExpired;
      if (!hideExpired) {
        // Normal server-side pagination
        const data = await fetchInventory({
          category: filters.category,
          q: filters.q,
          page,
          limit
        });
        const items = applyClientFiltersAndSort(data.items || [], filters);
        window.__inventoryLast = { items, pagination: data.pagination };
        renderTable(items, data);
        renderPagination(data.pagination || { page: 1, pages: 1 });
        return;
      }

      // Hide expired ON: build a client-side non-expired collection across all server pages
      const key = JSON.stringify({ k: "inv", category: filters.category, q: filters.q });
      const cache = window.__invNonExpiredCache || (window.__invNonExpiredCache = {});
      let cacheEntry = cache[key];
      let items = Array.isArray(cacheEntry?.items) ? cacheEntry.items : null;
      let configMeta = cacheEntry?.config || {};
      if (!items) {
        // Fetch page 1 with max chunk (100)
        const first = await fetchInventory({ category: filters.category, q: filters.q, page: 1, limit: 100 });
        configMeta = first?.config || {};
        const totalPages = Math.max(1, first?.pagination?.pages || 1);
        const collected = [];
        const filterFn = (arr) =>
          (arr || []).filter(
            (r) => String(r.derived_status || "In Stock") !== "Expired"
          );
        collected.push(...filterFn(first.items));
        for (let p = 2; p <= totalPages; p++) {
          const next = await fetchInventory({ category: filters.category, q: filters.q, page: p, limit: 100 });
          collected.push(...filterFn(next.items));
        }
        items = collected;
        cacheEntry = { items, ts: Date.now(), config: configMeta };
        cache[key] = cacheEntry;
      }
      const meta = { config: configMeta || cacheEntry?.config || {} };
      // Apply all client-side filters/sorts, then paginate the resulting set
      const sortedFiltered = applyClientFiltersAndSort(items, filters);
      const total = sortedFiltered.length;
      const pages = Math.max(1, Math.ceil(Math.max(1, total) / limit));
      const cur = Math.min(Math.max(1, page), pages);
      const start = (cur - 1) * limit;
      const slice = sortedFiltered.slice(start, start + limit);
      window.__inventoryLast = {
        items: slice,
        pagination: { page: cur, pages, total },
      };
      renderTable(slice, meta);
      renderPagination({ page: cur, pages });
    } catch (err) {
      console.error("Failed to load inventory:", err);
      const tbody = document.querySelector("main .table tbody");
      if (tbody) {
        tbody.innerHTML = `<tr><td colspan="8" class="text-center text-danger">Failed to load inventory (${escapeHtml(
          err.message
        )}). You must be logged in as Admin to view inventory.</td></tr>`;
      }
    } finally {
      window.__invLoading = false;
    }
  }

  function renderPagination(p) {
    const container = document.getElementById("inventoryPagination");
    if (!container) return;
    const page = p.page || 1,
      pages = p.pages || 1;
    if (pages <= 1) {
      container.innerHTML = "";
      return;
    }
    const btn = (label, target, disabled = false) =>
      `<button class="btn btn-sm btn-outline-secondary ${
        disabled ? "disabled" : ""
      }" data-page="${target}" ${disabled ? "disabled" : ""}>${label}</button>`;
    const parts = [];
    parts.push(btn("Prev", Math.max(1, page - 1), page <= 1));
    parts.push(`<span class="mx-2 small">Page ${page} of ${pages}</span>`);
    parts.push(btn("Next", Math.min(pages, page + 1), page >= pages));
    container.innerHTML = parts.join("");
  }

  // Show a toast notification
  function showToast(message, type = 'success') {
    const toast = document.createElement('div');
    toast.className = `toast align-items-center text-white bg-${type} border-0 position-fixed`;
    toast.style.top = '20px';
    toast.style.right = '20px';
    toast.style.zIndex = '12002';
    toast.style.maxWidth = '350px';  // Ensure toast doesn't get too wide
    toast.role = 'alert';
    toast.setAttribute('aria-live', 'assertive');
    toast.setAttribute('aria-atomic', 'true');
    
    toast.innerHTML = `
      <div class="d-flex">
        <div class="toast-body">
          ${message}
        </div>
        <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button>
      </div>
    `;
    
    document.body.appendChild(toast);
    const bsToast = new bootstrap.Toast(toast, { autohide: true, delay: 5000 });
    bsToast.show();
    
    toast.addEventListener('hidden.bs.toast', () => {
      document.body.removeChild(toast);
    });
  }

  // Update button to show loading state
  function setButtonLoading(button, isLoading) {
    if (!button) return;
    
    if (isLoading) {
      button.disabled = true;
      button.innerHTML = `
        <span class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>
        ${button.getAttribute('data-original-text') || button.textContent}
      `;
    } else {
      button.disabled = false;
      const originalText = button.getAttribute('data-original-text');
      if (originalText) {
        button.textContent = originalText;
      }
    }
  }

  // Simple debounce for live search
  function debounce(fn, delay = 300) {
    let timeoutId;
    return function(...args) {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => fn.apply(this, args), delay);
    };
  }

  function bindFilters() {
    // Pagination buttons
    const pag = document.getElementById("inventoryPagination");
    if (pag) {
      pag.addEventListener("click", (e) => {
        const btn = e.target.closest("button[data-page]");
        if (!btn || btn.disabled) return;
        const p = parseInt(btn.getAttribute("data-page") || "1", 10) || 1;
        loadAndRender(p);
      });
    }
    // Hide expired toggle should apply instantly
    const hide = document.getElementById("hideExpiredToggle");
    if (hide) {
      hide.addEventListener("change", () => loadAndRender(1));
    }
    // Quick range buttons to set date inputs (no auto-apply)
    const qr = document.getElementById("quickRangeBtns");
    if (qr) {
      qr.addEventListener("click", (e) => {
        const b = e.target.closest("button[data-range]");
        if (!b) return;
        const now = new Date();
        let from = "", to = "";
        const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        if (b.dataset.range === "today") {
          from = fmt(today);
          to = fmt(today);
        } else if (b.dataset.range === "week") {
          const start = new Date(today);
          start.setDate(start.getDate() - start.getDay()); // Sunday
          const end = new Date(start);
          end.setDate(start.getDate() + 6);
          from = fmt(start);
          to = fmt(end);
        } else if (b.dataset.range === "month") {
          const start = new Date(today.getFullYear(), today.getMonth(), 1);
          const end = new Date(today.getFullYear(), today.getMonth() + 1, 0);
          from = fmt(start);
          to = fmt(end);
        }
        const fEl = document.getElementById("fromDate");
        const tEl = document.getElementById("toDate");
        if (fEl) fEl.value = from;
        if (tEl) tEl.value = to;
      });
    }
    // Filter Apply/Reset buttons inside filters dropdown
    (function bindFilterApplyReset() {
      const form = document.getElementById("filterForm");
      if (!form) return;
      const menu = form.closest(".dropdown-menu");
      if (!menu) return;
      const btns = menu.querySelectorAll(".btn");
      let btnReset = null, btnApply = null;
      btns.forEach((b) => {
        const label = (b.textContent || "").trim().toLowerCase();
        if (label === "reset") btnReset = b;
        if (label === "apply") btnApply = b;
      });
      if (btnReset) {
        btnReset.addEventListener("click", () => {
          try {
            const f = document.getElementById("fromDate");
            const t = document.getElementById("toDate");
            if (f) f.value = "";
            if (t) t.value = "";
            const catM = document.getElementById("inventoryCategorySelectMobile");
            const catD = document.getElementById("inventoryCategorySelectDesktop");
            if (catM) catM.value = "All";
            if (catD) catD.value = "All";
            // Reset new filters
            const statusSel = document.getElementById("filterStatusSelect");
            const stockLevelSel = document.getElementById("filterStockLevel");
            const filterCatSel = document.getElementById("filterCategorySelect");
            const checkRepack = document.getElementById("checkRepackKit");
            const checkHasTags = document.getElementById("checkHasTags");
            if (statusSel) statusSel.value = "";
            if (stockLevelSel) stockLevelSel.value = "";
            if (filterCatSel) filterCatSel.value = "";
            if (checkRepack) checkRepack.checked = false;
            if (checkHasTags) checkHasTags.checked = false;
          } catch (_) {}
        });
      }
      if (btnApply) {
        btnApply.addEventListener("click", () => {
          loadAndRender(1);
        });
      }
    })();
    // Sort Apply/Reset buttons inside sort dropdown
    ;(function bindSortApplyReset() {
      const form = document.getElementById("sortForm");
      if (!form) return;
      const menu = form.closest(".dropdown-menu");
      if (!menu) return;
      const btns = menu.querySelectorAll(".btn");
      let btnReset = null, btnApply = null;
      btns.forEach((b) => {
        const label = (b.textContent || "").trim().toLowerCase();
        if (label === "reset") btnReset = b;
        if (label === "apply") btnApply = b;
      });
      if (btnReset) {
        btnReset.addEventListener("click", () => {
          try {
            const expSel = document.getElementById("sortExpiration");
            const qtySel = document.getElementById("sortQuantity");
            const catSel = document.getElementById("sortCategory");
            const nameSel = document.getElementById("sortItemName");
            if (expSel) expSel.value = "";
            if (qtySel) qtySel.value = "";
            if (catSel) catSel.value = "";
            if (nameSel) nameSel.value = "";
          } catch (_) {}
        });
      }
      if (btnApply) {
        btnApply.addEventListener("click", () => {
          loadAndRender(1);
        });
      }
    })();
    // Live search: independent from Apply button
    const searchEl = document.getElementById("donationSearch");
    if (searchEl) {
      const doSearch = debounce(() => loadAndRender(1), 250);
      searchEl.addEventListener("input", doSearch);
      searchEl.addEventListener("keyup", (e) => {
        if (e.key === "Enter") loadAndRender(1);
      });
    }

    // Populate category dropdown for filter
    async function populateFilterCategories() {
      const select = document.getElementById("filterCategorySelect");
      if (!select) return;
      try {
        const res = await fetch(`${API_BASE_URL}/taxonomy/index.php/categories?active=1&t=${Date.now()}`, {
          credentials: "include",
          headers: { Accept: "application/json" },
        });
        const json = await res.json().catch(() => ({}));
        const categories = Array.isArray(json?.items) ? json.items : [];
        const options = ['<option value="">All</option>'];
        categories.forEach((cat) => {
          const label = cat.secondary_name 
            ? `${cat.primary_name || cat.name} - ${cat.secondary_name}`
            : (cat.primary_name || cat.name || "");
          if (label) {
            options.push(`<option value="${escapeHtml(label)}">${escapeHtml(label)}</option>`);
          }
        });
        select.innerHTML = options.join("");
      } catch (err) {
        console.error("Failed to load categories for filter:", err);
      }
    }

    // Initialize categories on page load
    populateFilterCategories();

    // Keep other filters/sorting on Apply; Page size select remains immediate below
    // Page size select
    const pageSize = document.getElementById("pageSizeSelect");
    if (pageSize) {
      // Initialize from localStorage if available
      try {
        const stored =
          parseInt(localStorage.getItem("inventory_page_size") || "0", 10) || 0;
        if (stored && [20, 30, 50].includes(stored)) {
          pageSize.value = String(stored);
        }
      } catch (_) {}
      pageSize.addEventListener("change", () => {
        const v = parseInt(pageSize.value || "0", 10) || 20;
        try {
          localStorage.setItem("inventory_page_size", String(v));
        } catch (_) {}
        loadAndRender(1);
      });
    }
  }

  // Compute current week's period key (YYYY-MM-Wn) using Sunday as week start
  function currentPeriodKey() {
    const today = new Date();
    const y = today.getFullYear();
    const m = today.getMonth(); // 0-based
    const monthStr = `${y}-${String(m + 1).padStart(2, "0")}`;
    const first = new Date(y, m, 1);
    const weekStartDow = 0; // Sunday
    const firstDow = first.getDay();
    const offset = (firstDow - weekStartDow + 7) % 7;
    const firstWeekStart = new Date(y, m, 1 - offset);
    let wIndex = 1;
    let cursor = new Date(firstWeekStart);
    while (
      new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 7) <=
      new Date(y, m + 1, 1)
    ) {
      const next = new Date(
        cursor.getFullYear(),
        cursor.getMonth(),
        cursor.getDate() + 7
      );
      if (today >= cursor && today < next) break;
      wIndex++;
      cursor = next;
    }
    const w = `W${Math.min(4, Math.max(1, wIndex))}`;
    return `${monthStr}-${w}`;
  }

  async function getFoodbankRecipientId() {
    // Auto-lookup by approved recipients
    try {
      const url = `${API_BASE_URL}/users/index.php?action=list&role=recipient&status=approved&limit=500&t=${Date.now()}`;
      const res = await fetch(url, {
        credentials: "include",
        headers: { Accept: "application/json" },
      });
      const j = await res.json().catch(() => null);
      const arr = Array.isArray(j?.data?.items) ? j.data.items : [];
      // Try exact organization_name match first
      const exact = arr.find(
        (u) =>
          String(u.organization_name || "")
            .trim()
            .toLowerCase() === "foodbank (on-site)"
      );
      if (exact && exact.user_id) {
        return Number(exact.user_id);
      }
      // Fallback: find any tagged 'onsite'
      const tagged = arr.find((u) =>
        String(u.tags || "")
          .toLowerCase()
          .includes("onsite")
      );
      if (tagged && tagged.user_id) {
        return Number(tagged.user_id);
      }
    } catch (_) {}
    return NaN;
  }

  async function ensureRunForPeriod(periodKey, note) {
    // Prefer AllocationsAPI
    try {
      if (
        window.AllocationsAPI &&
        typeof window.AllocationsAPI.runByPeriod === "function"
      ) {
        const j = await window.AllocationsAPI.runByPeriod(periodKey);
        const runId = parseInt(j?.data?.run_id || j?.run_id || 0, 10) || 0;
        if (runId) return runId;
      }
    } catch (_) {
      /* fall back to fetch */
    }
    // Fallback: GET run_by_period
    try {
      const r = await fetch(
        `${API_BASE_URL}/allocations/index.php?action=run_by_period&period_key=${encodeURIComponent(
          periodKey
        )}&t=${Date.now()}`,
        { credentials: "include", headers: { Accept: "application/json" } }
      );
      const j = await r.json().catch(() => null);
      const runId = parseInt(j?.data?.run_id || 0, 10) || 0;
      if (runId) return runId;
    } catch (_) {
      /* ignore */
    }
    // Create run
    try {
      if (
        window.AllocationsAPI &&
        typeof window.AllocationsAPI.createRun === "function"
      ) {
        const cj = await window.AllocationsAPI.createRun(
          note || "On-site giveaway",
          periodKey
        );
        const runId = parseInt(cj?.data?.run_id || cj?.run_id || 0, 10) || 0;
        if (runId) return runId;
      }
    } catch (_) {
      /* fall back */
    }
    const cr = await fetch(
      `${API_BASE_URL}/allocations/index.php?action=create_run`,
      {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          note: note || "On-site giveaway",
          period_key: periodKey,
        }),
      }
    );
    const cj = await cr.json().catch(() => null);
    if (!cr.ok || !cj?.success)
      throw new Error(cj?.error || `HTTP ${cr.status}`);
    return parseInt(cj?.data?.run_id || 0, 10) || 0;
  }

  async function createOnsiteAllocation(itemName, category, quantity, note, lotId = null) {
    const periodKey = currentPeriodKey();
    // Prefer new atomic endpoint
    let allocationId = 0;
    try {
      if (
        window.AllocationsAPI &&
        typeof window.AllocationsAPI.onsiteIssue === "function"
      ) {
        const j = await window.AllocationsAPI.onsiteIssue(
          itemName,
          category,
          quantity,
          note || "",
          periodKey,
          lotId ? parseInt(lotId, 10) : null
        );
        if (j?.success === false)
          throw new Error(j?.error || "On-site issue failed");
        allocationId = Number(j?.data?.allocation_id || 0) || 0;
      }
    } catch (e) {
      /* fallback to fetch below */
    }
    if (!allocationId) {
      const resp = await fetch(
        `${API_BASE_URL}/allocations/index.php?action=onsite_issue`,
        {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            item_name: itemName,
            category,
            quantity,
            note: note || "",
            period_key: periodKey,
            ...(lotId && { inventory_id: parseInt(lotId, 10) }),
          }),
        }
      );
      const jr = await resp.json().catch(() => null);
      if (!resp.ok || jr?.success === false)
        throw new Error(jr?.error || `HTTP ${resp.status}`);
      allocationId = Number(jr?.data?.allocation_id || 0) || 0;
    }
    if (!allocationId) {
      throw new Error("Unable to create onsite allocation.");
    }

    // Show success toast
    try {
      const message = `Successfully issued ${quantity} × ${itemName} (${category}).`;
      showToast(message, 'success');
    } catch (_) {}
    return true;
  }

  // --- Import (CSV) ---
  function parseCsv(text) {
    // Simple CSV parser: handles commas and basic quoted fields
    const rows = [];
    let i = 0,
      field = "",
      inQuotes = false,
      row = [];
    while (i < text.length) {
      const c = text[i++];
      if (inQuotes) {
        if (c === '"') {
          if (text[i] === '"') {
            field += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          field += c;
        }
      } else {
        if (c === '"') {
          inQuotes = true;
        } else if (c === ",") {
          row.push(field);
          field = "";
        } else if (c === "\n") {
          row.push(field);
          rows.push(row);
          row = [];
          field = "";
        } else if (c === "\r") {
          /* ignore CR, handle on next LF */
        } else {
          field += c;
        }
      }
    }
    if (field.length || row.length) {
      row.push(field);
      rows.push(row);
    }
    return rows.filter((r) => r.some((v) => (v || "").trim() !== ""));
  }

  function normalizeHeader(h) {
    const s = (h || "").toLowerCase().trim();
    // Replace any non-alphanumeric with underscores, collapse repeats
    return s.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  }

  function bindImportModal() {
    let fileInput = document.getElementById("importFileInput");
    const headEl = document.getElementById("importPreviewHead");
    const bodyEl = document.getElementById("importPreviewBody");
    const statusEl = document.getElementById("importParseStatus");
    let submitBtn = document.getElementById("importInventorySubmitBtn");
    if (!fileInput || !headEl || !bodyEl || !submitBtn) return;

    // Replace elements with clones to remove any previously attached listeners
    const fileClone = fileInput.cloneNode(true);
    fileInput.parentNode.replaceChild(fileClone, fileInput);
    fileInput = fileClone;
    const submitClone = submitBtn.cloneNode(true);
    submitBtn.parentNode.replaceChild(submitClone, submitBtn);
    submitBtn = submitClone;

    submitBtn.disabled = true;
    let previewData = { header: [], rows: [] };

    fileInput.addEventListener("change", async (e) => {
      submitBtn.disabled = true;
      headEl.innerHTML = "";
      bodyEl.innerHTML =
        '<tr><td class="text-center text-muted">Parsing...</td></tr>';
      statusEl.textContent = "";
      const file = e.target.files && e.target.files[0];
      if (!file) {
        bodyEl.innerHTML =
          '<tr><td class="text-center text-muted">No file loaded.</td></tr>';
        return;
      }
      try {
        let rows = [];
        const nameLower = (file.name || "").toLowerCase();
        if (nameLower.endsWith(".xlsx")) {
          // Parse XLSX via SheetJS
          const ab = await file.arrayBuffer();
          const wb = XLSX.read(ab, { type: "array" });
          const firstSheetName = wb.SheetNames && wb.SheetNames[0];
          if (!firstSheetName) throw new Error("No sheets in workbook");
          const ws = wb.Sheets[firstSheetName];
          rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false });
        } else {
          const text = await file.text();
          rows = parseCsv(text);
        }
        if (!rows.length) {
          bodyEl.innerHTML =
            '<tr><td class="text-center text-muted">Empty file.</td></tr>';
          return;
        }
        const header = rows[0].map(normalizeHeader);
        const dataRows = rows.slice(1);
        previewData = { header, rows: dataRows };
        // Render header (show original or normalized? we'll show normalized)
        headEl.innerHTML =
          "<tr>" +
          header.map((h) => `<th>${h || "col"}</th>`).join("") +
          "</tr>";
        // Render first up to 50 rows
        const maxRows = Math.min(50, dataRows.length);
        const html = [];
        for (let r = 0; r < maxRows; r++) {
          const row = dataRows[r];
          html.push(
            "<tr>" +
              header
                .map((_, i) => `<td>${escapeHtml(row[i] || "")}</td>`)
                .join("") +
              "</tr>"
          );
        }
        bodyEl.innerHTML = html.join("");
        statusEl.textContent = `Parsed ${dataRows.length} rows. Showing first ${maxRows}.`;
        submitBtn.disabled = dataRows.length === 0;
      } catch (err) {
        console.error("CSV parse failed:", err);
        bodyEl.innerHTML =
          '<tr><td class="text-center text-danger">Failed to parse file.</td></tr>';
        statusEl.textContent = err?.message || "Parse error";
      }
    });

    // Store original button text
    submitBtn.setAttribute('data-original-text', submitBtn.textContent.trim());
    
    submitBtn.addEventListener("click", async () => {
      try {
        setButtonLoading(submitBtn, true);
        // Map preview rows to expected payload fields
        const header = Array.isArray(previewData.header)
          ? previewData.header
          : [];
        const rows = Array.isArray(previewData.rows) ? previewData.rows : [];
        if (!header.length || !rows.length) {
          showToast("No valid data found in the import file.", "warning");
          return;
        }
        const ix = (name) => header.indexOf(String(name || "").toLowerCase());
        const pick = (...keys) => {
          for (const k of keys) {
            const i = ix(k);
            if (i >= 0) return i;
          }
          return -1;
        };
        const findBySubstring = (...patterns) => {
          const lookups = patterns
            .map((p) => String(p || "").toLowerCase())
            .filter(Boolean);
          if (!lookups.length) return -1;
          for (let i = 0; i < header.length; i++) {
            const col = header[i];
            if (!col) continue;
            const value = String(col).toLowerCase();
            if (lookups.some((p) => value.includes(p))) {
              return i;
            }
          }
          return -1;
        };
        const iItem = pick("item_name", "name", "product_name");
        const iCat = pick("category", "product_category");
        const iQty = ix("quantity");
        const iExpiry = ix("expiry_date");
        const iTags = ix("tags");
        const iUnit = pick("unit", "packed_by");
        const iUW = (() => {
          const idx = pick("unit_weight", "unit_weight_kg", "weight_per_unit", "weight");
          return idx >= 0 ? idx : findBySubstring("weight");
        })();
        const iTC = (() => {
          const idx = pick("total_cost", "total_cost_p", "cost", "cost_php", "cost_p");
          return idx >= 0 ? idx : findBySubstring("cost", "price");
        })();
        const iBatch = ix("source_batch_id");
        const iEntryDate = pick("entry_date", "added_at");
        const iDonEmail = ix("donor_email");
        const iDonOrg = pick("donor_org", "donor_organization", "donor_name");
        const iDonName = ix("donor_name");
        const iDonCategory = ix("donor_category");
        const iEntryBy = ix("entry_by");
        const normalizeUnit = (value) => {
          const val = String(value || '').trim().toLowerCase();
          if (!val) return '';
          if (val === 'packet') return 'pack';
          if (val === 'packets') return 'packs';
          return val;
        };
        const payloadRows = [];
        for (const r of rows) {
          const item = (r[iItem] ?? r[0] ?? "").toString().trim();
          const qtyRaw = (r[iQty] ?? "").toString().trim();
          // Always try to extract a leading integer from quantity (e.g., '2 can' -> 2)
          let qty = 0;
          let tailUnitFromQty = "";
          if (qtyRaw !== "") {
            const m = qtyRaw.match(/^(\d+)/);
            if (m) {
              qty = parseInt(m[1], 10) || 0;
              // Also capture text after the number to possibly use as unit if none provided
              const tail = qtyRaw.slice(m[0].length).trim();
              if (tail) tailUnitFromQty = tail;
            } else {
              // Fallback to direct int parse
              qty = parseInt(qtyRaw, 10) || 0;
            }
          }
          let derivedUnit = tailUnitFromQty;
          if (!item || qty <= 0) continue; // skip invalid rows
          const rowObj = {
            item_name: item,
            category: (iCat >= 0 ? r[iCat] || "" : "").toString().trim(),
            quantity: qty,
            expiry_date: (iExpiry >= 0 ? (r[iExpiry] || "9999-12-31").toString().trim() : "9999-12-31"),
            tags: (iTags >= 0 ? r[iTags] || "" : "").toString().trim(),
          };
          // Prefer explicit unit column when present and non-empty; otherwise use unit derived from QUANTITY tail
          if (iUnit >= 0) {
            const unitVal = normalizeUnit(r[iUnit]);
            if (unitVal) rowObj.unit = unitVal;
            else if (derivedUnit) rowObj.unit = normalizeUnit(derivedUnit);
          } else if (derivedUnit) {
            rowObj.unit = normalizeUnit(derivedUnit);
          }
          if (iUW >= 0) rowObj.unit_weight = (r[iUW] || "").toString().trim();
          if (iTC >= 0) rowObj.total_cost = (r[iTC] || "").toString().trim();
          if (iBatch >= 0)
            rowObj.source_batch_id = (r[iBatch] || "").toString().trim();
          if (iDonEmail >= 0)
            rowObj.donor_email = (r[iDonEmail] || "").toString().trim();
          if (iDonOrg >= 0) {
            const val = (r[iDonOrg] || "").toString().trim();
            // Use as donor_org; also send donor_name if absent to help matching
            rowObj.donor_org = val;
            if (!("donor_name" in rowObj) && iDonName < 0)
              rowObj.donor_name = val;
          }
          if (iDonName >= 0)
            rowObj.donor_name = (r[iDonName] || "").toString().trim();
          if (iDonCategory >= 0)
            rowObj.donor_category = (r[iDonCategory] || "").toString().trim();
          if (iEntryBy >= 0)
            rowObj.entry_by = (r[iEntryBy] || "").toString().trim();
          if (iEntryDate >= 0)
            rowObj.entry_date = (r[iEntryDate] || "").toString().trim();
          payloadRows.push(rowObj);
        }
        if (!payloadRows.length) {
          showToast("No valid rows to import. Ensure each row has an item name and quantity >= 1.", "warning");
          return;
        }
        const url = `${API_BASE_URL}/inventory/index.php/import`;
        const res = await fetch(url, {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({ rows: payloadRows }),
        });
        const j = await res.json().catch(() => null);
        if (!res.ok || !j || j.success !== true) {
          throw new Error(j?.error || `HTTP ${res.status}`);
        }
        const inserted = j?.data?.inserted ?? 0;
        const errs = Array.isArray(j?.data?.errors) ? j.data.errors : [];
        // Report summary via toast
        try {
          if (errs.length) console.error("Inventory import errors:", errs);
          
          let message = `Successfully imported ${inserted} row(s)`;
          let type = 'success';
          
          if (errs.length > 0) {
            const errorCount = errs.length;
            message += `, with ${errorCount} error${errorCount > 1 ? 's' : ''}`;
            type = 'warning';
            
            // Show first error in toast if there are any
            const firstError = errs[0];
            if (firstError) {
              message += `: ${firstError.error || 'Unknown error'}`;
              if (firstError.row) {
                message += ` (row ${firstError.row})`;
              }
              
              // Add a note if there are more errors
              if (errorCount > 1) {
                message += `, and ${errorCount - 1} more`;
              }
            }
          }
          
          showToast(message, type);
          
          // Close modal after a short delay to allow toast to be seen
          setTimeout(() => {
            try {
              const modalEl = document.getElementById("importInventoryModal");
              if (modalEl && typeof bootstrap !== "undefined" && bootstrap.Modal) {
                const modal = bootstrap.Modal.getInstance(modalEl) || bootstrap.Modal.getOrCreateInstance(modalEl);
                modal.hide();
                
                // Reset form and preview
                const form = modalEl.querySelector('form');
                if (form) form.reset();
                const previewBody = document.getElementById("importPreviewBody");
                if (previewBody) previewBody.innerHTML = '<tr><td colspan="10" class="text-center text-muted">No data to preview</td></tr>';
                const previewHead = document.getElementById("importPreviewHead");
                if (previewHead) previewHead.innerHTML = '';
                const statusEl = document.getElementById("importParseStatus");
                if (statusEl) statusEl.textContent = 'Upload a CSV file to preview';
              }
            } catch (e) {
              console.error("Error cleaning up after import:", e);
            }
          }, 500);
          
          // Refresh table
          try { window.__invNonExpiredCache = {}; } catch (_) {}
          const p = window.__inventoryLast?.pagination?.page || 1;
          await loadAndRender(p);
        } catch (_) {}
      } catch (err) {
        console.error("Import failed:", err);
        showToast(`Import failed: ${err?.message || 'Unknown error'}`, 'danger');
      } finally {
        setButtonLoading(submitBtn, false);
      }
    });
  }

  // Bind import handlers on page load
  try {
    bindImportModal();
  } catch (e) {
    console.error("Failed to bind import handlers:", e);
    showToast("Failed to initialize import functionality. Please refresh the page.", 'danger');
  }

  // Wire tag edit save button
  try {
    const save = document.getElementById("tagEditSaveBtn");
    if (save) {
      save.addEventListener("click", async () => {
        try {
          const ctx = window.__tagCtx || {};
          const itemName = ctx.itemName || "";
          const category = ctx.category || "";
          const input = document.getElementById("tagEditInput");
          const fb = document.getElementById("tagEditFeedback");
          const tags = String(input?.value || "").trim();
          if (!itemName || !category) {
            if (fb) fb.textContent = "Invalid item context.";
            return;
          }
          updateRowImmediate(itemName, category, (tr, tds) => {
            tds[4].textContent = tags || "—";
            const btn = tr.querySelector(".inv-edit-tags");
            if (btn) btn.setAttribute("data-tags", tags);
          });
          const res = await fetch(`${API_BASE_URL}/inventory/index.php/update-tags`, {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ scope: "group", item_name: itemName, category, tags })
          });
          const j = await res.json().catch(() => ({ success:false, error:`HTTP ${res.status}` }));
          if (!res.ok || !j?.success) throw new Error(j?.error || `HTTP ${res.status}`);
          const modal = document.getElementById("tagEditModal");
          if (modal && typeof bootstrap !== "undefined" && bootstrap.Modal) {
            bootstrap.Modal.getOrCreateInstance(modal).hide();
          }
          try { window.__invNonExpiredCache = {}; } catch (_) {}
          const page = window.__inventoryLast?.pagination?.page || 1;
          await loadAndRender(page);
        } catch (err) {
          console.error("Tag save failed:", err);
          const fb = document.getElementById("tagEditFeedback");
          if (fb) fb.textContent = err?.message || "Failed to update tags.";
        }
      });
    }
  } catch (_) {}

  // No export bindings here; exports will live in ReportAndAnalytics.html

  (function bindOnsiteModalSubmit() {
    const submit = document.getElementById("onsiteIssueSubmitBtn");
    if (!submit) return;
    submit.addEventListener("click", async () => {
      const btn = submit;
      const qtyEl = document.getElementById("onsiteQty");
      const noteEl = document.getElementById("onsiteNote");
      const lotEl = document.getElementById("onsiteLot");
      const fb = document.getElementById("onsiteIssueFeedback");
      const modalEl = document.getElementById("onsiteIssueModal");
      const ctx = window.__onsiteCtx || {};
      const itemName = ctx.itemName || "";
      const category = ctx.category || "";
      const quantity = parseInt(qtyEl?.value || "0", 10) || 0;
      const note = String(noteEl?.value || "").trim();
      const lotId = lotEl ? lotEl.value : "";
      if (!itemName || !category) {
        if (fb) fb.textContent = "Invalid item context.";
        return;
      }
      if (!lotId) {
        if (fb) fb.textContent = "Please select a lot.";
        return;
      }
      if (!quantity || quantity <= 0) {
        if (fb) fb.textContent = "Quantity must be at least 1.";
        return;
      }
      if (note.length === 0) {
        if (fb) fb.textContent = "Note is required.";
        return;
      }
      // Prevent issuing more than available in the selected lot
      try {
        const selectedOpt = lotEl?.options?.[lotEl.selectedIndex];
        const available = selectedOpt && selectedOpt.dataset && selectedOpt.dataset.qty
          ? parseInt(selectedOpt.dataset.qty, 10) || 0
          : 0;
        if (available > 0 && quantity > available) {
          if (fb) fb.textContent = `Quantity exceeds available stock (${available}).`;
          return;
        }
      } catch (_) {
        // If we cannot read dataset, continue to server-side validation
      }
      const cleanup = () => {
        try {
          document.querySelectorAll(".modal-backdrop").forEach((el) => {
            try { el.remove(); } catch (_) {}
          });
          if (document && document.body) {
            document.body.classList.remove("modal-open");
            try { document.body.style.removeProperty("padding-right"); } catch (_) {}
          }
        } catch (_) {}
      };
      try {
        btn.disabled = true;
        if (fb) fb.textContent = "";
        if (modalEl && typeof bootstrap !== "undefined" && bootstrap.Modal) {
          bootstrap.Modal.getOrCreateInstance(modalEl).hide();
        }
        cleanup();
        await createOnsiteAllocation(itemName, category, quantity, note, lotId);
        try { window.__invNonExpiredCache = {}; } catch (_) {}
        const page = window.__inventoryLast?.pagination?.page || 1;
        await loadAndRender(page);
      } catch (err) {
        console.error("On-site allocation failed:", err);
        if (fb) fb.textContent = err?.message || "Failed to save allocation.";
      } finally {
        btn.disabled = false;
        cleanup();
      }
    });
  })();

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      const page = window.__inventoryLast?.pagination?.page || 1;
      loadAndRender(page);
    }
  });

  async function init() {
    bindFilters();
    bindActions();
    bindRepackEntryPoints();
    await loadCategories();
    loadAndRender(1);
    bindImportModal();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
