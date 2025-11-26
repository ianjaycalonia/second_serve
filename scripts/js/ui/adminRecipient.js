let importInProgress = false;

function setImportLoading(loading, refs) {
  importInProgress = !!loading;
  const btn = refs && refs.importBtn ? refs.importBtn : null;
  const modal = refs && refs.modalEl ? refs.modalEl : null;
  if (btn) {
    if (loading) {
      btn.disabled = true;
      btn.dataset._orig = btn.innerHTML;
      btn.innerHTML =
        '<span class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>Importing...';
    } else {
      btn.disabled = false;
      if (btn.dataset._orig) {
        btn.innerHTML = btn.dataset._orig;
        delete btn.dataset._orig;
      }
    }
  }
  // Disable inputs inside modal during import to prevent edits/double actions
  if (modal) {
    const inputs = modal.querySelectorAll("input, button, select, textarea");
    inputs.forEach((el) => {
      if (el === btn) return; // handled above
      if (loading) {
        if (!el.dataset._disabled) {
          el.dataset._disabled = el.disabled ? "1" : "";
        }
        el.disabled = true;
      } else {
        if (el.dataset._disabled !== undefined) {
          el.disabled = el.dataset._disabled === "1";
          delete el.dataset._disabled;
        }
      }
    });
  }
}

("use strict");

// Global helper: show a simple Bootstrap modal with custom title and HTML body
function showImportModal(title, html) {
  const body = document.getElementById("importResultBody");
  const label = document.getElementById("importResultModalLabel");
  const el = document.getElementById("importResultModal");
  if (!body || !label || !el) {
    console.warn(
      "Import result modal elements not found, falling back to alert"
    );
    const tmp = document.createElement("div");
    tmp.innerHTML = html;
    alert(`${title}\n\n${tmp.textContent}`);
    return;
  }
  label.textContent = title;
  body.innerHTML = html;
  if (window.bootstrap && bootstrap.Modal) {
    const modal = bootstrap.Modal.getOrCreateInstance(el);
    modal.show();
  } else if (window.$) {
    $(el).modal("show");
  } else {
    el.style.display = "block";
  }
}

// Provide a toast helper if one is not already registered globally.
if (typeof window.showToast !== "function") {
  const ensureToastContainer = () => {
    let container = document.getElementById("globalToastContainer");
    if (!container) {
      container = document.createElement("div");
      container.id = "globalToastContainer";
      container.className = "toast-container position-fixed top-0 end-0 p-3";
      document.body.appendChild(container);
    }
    return container;
  };

  window.showToast = function (message, variant = "success", delayMs = 2400) {
    try {
      const container = ensureToastContainer();
      const color = variant === "danger" ? "danger" : variant === "warning" ? "warning" : variant === "info" ? "info" : "success";
      const toastEl = document.createElement("div");
      toastEl.className = `toast align-items-center text-bg-${color} border-0 shadow`;
      toastEl.setAttribute("role", "alert");
      toastEl.setAttribute("aria-live", "assertive");
      toastEl.setAttribute("aria-atomic", "true");
      toastEl.innerHTML = `
        <div class="d-flex">
          <div class="toast-body">${message}</div>
          <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button>
        </div>
      `;
      container.appendChild(toastEl);
      const toast = bootstrap?.Toast?.getOrCreateInstance
        ? bootstrap.Toast.getOrCreateInstance(toastEl, {
            delay: delayMs,
            autohide: true,
          })
        : null;
      if (toast) {
        toastEl.addEventListener("hidden.bs.toast", () => {
          toast.dispose();
          toastEl.remove();
        });
        toast.show();
      } else {
        // Fallback to alert if Bootstrap toast is unavailable
        alert(message);
        toastEl.remove();
      }
    } catch (err) {
      console.warn("Toast display failed", err);
    }
  };
}

(function () {
  "use strict";

  // API base URL (consistent with other admin pages)
  const API_BASE_URL =
    typeof window.API_BASE_URL === "string" && window.API_BASE_URL
      ? window.API_BASE_URL
      : "/php/api";

  let beneficiaryCategoriesCache = null;
  let beneficiaryCategoriesPromise = null;

  async function loadBeneficiaryCategories() {
    if (Array.isArray(beneficiaryCategoriesCache)) {
      return beneficiaryCategoriesCache;
    }
    if (!beneficiaryCategoriesPromise) {
      beneficiaryCategoriesPromise = fetch(
        `${API_BASE_URL}/lookups/index.php/beneficiary-categories?active=1&limit=200`,
        {
          method: "GET",
          headers: { Accept: "application/json" },
          credentials: "include",
          cache: "no-store",
        }
      )
        .then(async (res) => {
          if (!res.ok) {
            throw new Error(`HTTP ${res.status}`);
          }
          const j = await res.json();
          const items = Array.isArray(j?.items)
            ? j.items.map((it) => ({
                id: Number(it.id),
                name: String(it.name || ""),
              }))
            : [];
          beneficiaryCategoriesCache = items;
          return items;
        })
        .catch((err) => {
          beneficiaryCategoriesPromise = null;
          throw err;
        });
    }
    return beneficiaryCategoriesPromise;
  }

  function ensureSelect2(selectEl, modalEl) {
    if (!selectEl || !(window.$ && $.fn?.select2)) {
      return null;
    }
    const $select = window.$(selectEl);
    if (!$select.data("select2")) {
      const config = {
        width: "100%",
        placeholder: selectEl.dataset.placeholder || "Select",
        allowClear: true,
      };
      if (modalEl) {
        config.dropdownParent = window.$(modalEl);
      }
      $select.select2(config);
    }
    return $select;
  }

  function populateBeneficiaryCategoryOptions(selectEl, categories) {
    if (!selectEl) return;
    const list = Array.isArray(categories) ? categories : [];
    const $select = window.$ && $.fn?.select2 ? window.$(selectEl) : null;
    const hasSelect2 = !!($select && $select.data("select2"));
    if (hasSelect2) {
      $select.empty();
      $select.append(new Option("", "", false, false));
    } else {
      selectEl.innerHTML = "";
      const placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = "";
      selectEl.appendChild(placeholder);
    }
    const seen = new Set([""]);
    list.forEach((cat) => {
      if (!cat || cat.id == null) return;
      const id = String(cat.id);
      if (seen.has(id)) return;
      seen.add(id);
      const label = cat.name || `Category ${id}`;
      if (hasSelect2) {
        $select.append(new Option(label, id, false, false));
      } else {
        const opt = document.createElement("option");
        opt.value = id;
        opt.textContent = label;
        selectEl.appendChild(opt);
      }
    });
    selectEl.dataset.optionsLoaded = "1";
  }

  function syncBeneficiaryCategorySelection(selectEl, selectedId, selectedLabel) {
    if (!selectEl) return;
    const raw = selectedId != null && selectedId !== "" ? String(selectedId) : "";
    if (raw) {
      const hasOption = Array.from(selectEl.options).some(
        (opt) => opt.value === raw
      );
      if (!hasOption) {
        const label = selectedLabel || `Category ${raw}`;
        if (window.$ && $.fn?.select2 && window.$(selectEl).data("select2")) {
          window.$(selectEl).append(new Option(label, raw, false, false));
        } else {
          const opt = document.createElement("option");
          opt.value = raw;
          opt.textContent = label;
          selectEl.appendChild(opt);
        }
      }
    }
    if (window.$ && $.fn?.select2 && window.$(selectEl).data("select2")) {
      window.$(selectEl)
        .val(raw || null)
        .trigger("change.select2");
    } else {
      selectEl.value = raw;
    }
  }

  function initializeBeneficiaryCategorySelect(selectEl, modalEl) {
    if (!selectEl) return;
    ensureSelect2(selectEl, modalEl);
    loadBeneficiaryCategories()
      .then((cats) => populateBeneficiaryCategoryOptions(selectEl, cats))
      .catch((err) => console.error("Failed to load beneficiary categories:", err));
  }

  function escapeHtml(str) {
    return String(str || "").replace(
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

  function decodeHtml(str) {
    // Deep-decode HTML entities (handles cases like &amp;#039; → ')
    let s = String(str ?? "");
    for (let i = 0; i < 5; i++) {
      const txt = document.createElement("textarea");
      txt.innerHTML = s;
      const v = txt.value;
      if (v === s) break;
      s = v;
    }
    return s;
  }

  function renderPreviewTable(rows) {
    const tableBody = document.querySelector("#importPreviewTable tbody");
    if (!tableBody) return;
    tableBody.innerHTML = rows.map((r, idx) => rowHtml(r, idx)).join("");
  }

  function fillDown(rows, keys) {
    const out = [];
    const last = {};
    rows.forEach((r) => {
      const nr = { ...r };
      keys.forEach((k) => {
        const v = String(nr[k] ?? "").trim();
        if (v) {
          last[k] = nr[k];
        } else if (last[k] != null) {
          nr[k] = last[k];
        }
      });
      out.push(nr);
    });
    return out;
  }

  // ---- Import Preview & Edit helpers ----
  async function showPreviewAndMaybeImport(rawRows) {
    const modalEl = document.getElementById("importPreviewModal");
    const tableBody = document.querySelector("#importPreviewTable tbody");
    const master = document.getElementById("previewMasterCheck");
    const selAll = document.getElementById("previewSelectAllBtn");
    const deselAll = document.getElementById("previewDeselectAllBtn");
    const validateBtn = document.getElementById("previewValidateBtn");
    const importBtn = document.getElementById("previewImportBtn");
    const status = document.getElementById("previewStatus");
    if (!modalEl || !tableBody) {
      console.warn("Preview modal elements missing");
      return;
    }

    // Normalize rows to expected keys used by backend mapping
    const originalNorm = rawRows.map((r) => normalizeRowKeys(r));

    // Optionally fill-down blank cells for columns typically merged in Excel
    const fillDownKeys = ["name of beneficiary", "advocacy", "type", "address"];
    const fillDownCheck = document.getElementById("previewFillDownCheck");
    let norm =
      fillDownCheck && fillDownCheck.checked
        ? fillDown(originalNorm, fillDownKeys)
        : originalNorm.slice();

    // Render rows
    renderPreviewTable(norm);

    // Helper to show a non-blocking warning banner in the preview modal
    function showPreviewWarning(message) {
      const body = modalEl.querySelector(".modal-body");
      if (!body) return;
      let warn = body.querySelector("#previewWarning");
      if (!warn) {
        warn = document.createElement("div");
        warn.id = "previewWarning";
        warn.className = "alert alert-warning py-2 px-3 mb-2";
        // Insert warning just below the header actions if present, otherwise at top
        const actions = body.querySelector(
          ".d-flex.justify-content-between.align-items-center"
        );
        if (actions && actions.parentNode) {
          actions.parentNode.insertBefore(warn, actions.nextSibling);
        } else {
          body.insertBefore(warn, body.firstChild);
        }
      }
      warn.innerHTML = message;
      warn.style.display = message ? "block" : "none";
    }

    // Propagate known organization email to rows of the same organization where email is blank
    function propagateOrgEmails() {
      const trs = Array.from(tableBody.querySelectorAll("tr"));
      const orgToEmail = new Map();
      const normalizeOrg = (s) =>
        String(s || "")
          .trim()
          .toLowerCase();
      const usedEmails = new Set();
      const makePlaceholder = (org) => {
        let base = normalizeOrg(org).replace(/[^a-z0-9]+/g, "");
        if (!base) base = "imported";
        let candidate = `${base}@noemail.local`;
        let i = 1;
        while (usedEmails.has(candidate)) {
          candidate = `${base}+${i}@noemail.local`;
          i++;
        }
        usedEmails.add(candidate);
        return candidate;
      };
      trs.forEach((tr) => {
        const org = tr.querySelector('input[name="beneficiary"]')?.value || "";
        const email = tr.querySelector('input[name="email"]')?.value || "";
        const key = normalizeOrg(org);
        if (key && String(email).trim() && !orgToEmail.get(key)) {
          const em = String(email).trim();
          orgToEmail.set(key, em);
          usedEmails.add(em);
        }
      });
      // Apply propagation for blank emails
      trs.forEach((tr) => {
        const orgInp = tr.querySelector('input[name="beneficiary"]');
        const emailInp = tr.querySelector('input[name="email"]');
        if (!orgInp || !emailInp) return;
        const key = normalizeOrg(orgInp.value);
        if (!key) return;
        let existing = String(emailInp.value || "").trim();
        let orgEmail = orgToEmail.get(key) || "";
        if (!existing) {
          if (!orgEmail) {
            // No known email for this org anywhere; create a preview placeholder
            orgEmail = makePlaceholder(orgInp.value);
            orgToEmail.set(key, orgEmail);
          }
          emailInp.value = orgEmail; // autofill
          emailInp.dataset.autofilled = "org-email";
          emailInp.classList.add("is-valid");
        }
        usedEmails.add(emailInp.value.trim());
      });

      // Warn if there is only one organization and it has no email at all
      const uniqueOrgs = new Set();
      trs.forEach((tr) => {
        const org = tr.querySelector('input[name="beneficiary"]')?.value || "";
        const key = normalizeOrg(org);
        if (key) uniqueOrgs.add(key);
      });
      if (uniqueOrgs.size === 1) {
        const onlyOrg = Array.from(uniqueOrgs)[0];
        const hasAnyEmail = !!orgToEmail.get(onlyOrg);
        if (!hasAnyEmail) {
          // We will have generated a placeholder above; inform the user instead of warning
          showPreviewWarning(
            "Info: No email found for this organization. A placeholder email has been generated for preview and will be used on import unless you change it."
          );
        } else {
          showPreviewWarning("");
        }
      } else {
        showPreviewWarning("");
      }
    }

    // Wire events
    tableBody.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
      cb.addEventListener("change", updateStatus);
    });
    tableBody.querySelectorAll('input[type="text"]').forEach((inp) => {
      inp.addEventListener("input", (e) => {
        // live-validate the row
        const tr = e.target.closest("tr");
        validateRow(tr);
        updateStatus();
        // Re-run email propagation if org/email fields change
        if (e.target.name === "beneficiary" || e.target.name === "email") {
          propagateOrgEmails();
        }
      });
    });
    if (master) {
      master.checked = true;
      master.addEventListener("change", () => {
        tableBody.querySelectorAll("input.row-check").forEach((cb) => {
          cb.checked = master.checked;
        });
        updateStatus();
      });
    }
    if (selAll)
      selAll.onclick = () => {
        tableBody
          .querySelectorAll("input.row-check")
          .forEach((cb) => (cb.checked = true));
        if (master) master.checked = true;
        updateStatus();
      };
    if (deselAll)
      deselAll.onclick = () => {
        tableBody
          .querySelectorAll("input.row-check")
          .forEach((cb) => (cb.checked = false));
        if (master) master.checked = false;
        updateStatus();
      };
    if (validateBtn)
      validateBtn.onclick = () => {
        tableBody.querySelectorAll("tr").forEach((tr) => validateRow(tr));
        updateStatus();
      };
    if (fillDownCheck)
      fillDownCheck.onchange = () => {
        norm = fillDownCheck.checked
          ? fillDown(originalNorm, fillDownKeys)
          : originalNorm.slice();
        renderPreviewTable(norm);
        // re-wire events after re-render
        tableBody
          .querySelectorAll('input[type="checkbox"]')
          .forEach((cb) => cb.addEventListener("change", updateStatus));
        tableBody.querySelectorAll('input[type="text"]').forEach((inp) =>
          inp.addEventListener("input", (e) => {
            const tr = e.target.closest("tr");
            validateRow(tr);
            updateStatus();
          })
        );
        if (master) {
          master.checked = true;
        }
        updateStatus();
        // After re-render, apply email propagation again
        propagateOrgEmails();
      };

    // Initial email propagation check after first render
    propagateOrgEmails();

    async function doImport() {
      if (importInProgress) return;
      setImportLoading(true, { importBtn, modalEl });
      // Collect selected rows into payload with edited values
      const payload = [];
      tableBody.querySelectorAll("tr").forEach((tr) => {
        const checked = tr.querySelector("input.row-check")?.checked;
        if (!checked) return;
        const obj = collectRow(tr);
        // only include non-empty rows and must have org/name
        if (
          !(
            String(
              obj["name of beneficiary"] ||
                obj["organization_name"] ||
                obj["recipient_name"] ||
                ""
            ).trim() || String(obj["name"] || "").trim()
          )
        )
          return;
        payload.push(obj);
      });
      if (!payload.length) {
        showImportModal(
          "Import Error",
          '<div class="text-danger">No rows selected or rows failed validation.</div>'
        );
        return;
      }

      // POST to backend
      let j;
      try {
        const res = await fetch(
          `${API_BASE_URL}/users/index.php?action=importRecipients`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            credentials: "include",
            body: JSON.stringify({ rows: payload }),
          }
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        j = await res.json();
        if (!j?.success) throw new Error(j?.error || "Import failed");
      } finally {
        setImportLoading(false, { importBtn, modalEl });
      }
      const summary = j.data || {};
      // Close preview modal
      bootstrap.Modal.getOrCreateInstance(modalEl).hide();
      // Show result
      if (summary.errors && summary.errors.length) {
        const list = summary.errors
          .slice(0, 10)
          .map(
            (e) =>
              `<li><code>Row ${e.row}</code>: ${escapeHtml(e.error || "")}</li>`
          )
          .join("");
        const html = `<div class="mb-2">Import completed.</div>
          <div class="mb-2"><span class="badge bg-success me-2">Inserted: ${
            summary.inserted || 0
          }</span>
          <span class="badge bg-danger">Errors: ${
            summary.errors.length
          }</span></div>
          <div class="small text-muted mb-1">First errors:</div>
          <ul class="small">${list}</ul>`;
        showImportModal("Import Result", html);
      } else {
        const inserted = Number(summary.inserted || 0);
        let toastShown = false;
        try {
          if (typeof showToast === "function") {
            const label = inserted === 1 ? "recipient" : "recipients";
            showToast(
              `Imported ${inserted} ${label} successfully.`,
              "success"
            );
            toastShown = true;
          }
        } catch (_) {
          // fall back to modal below
        }
        if (!toastShown) {
          const html = `
            <div class="alert alert-success d-flex align-items-center" role="alert">
              <i class="bi bi-check-circle-fill me-2"></i>
              <div>
                Import completed successfully.
              </div>
            </div>
            <div><span class="badge bg-success">Inserted: ${inserted}</span></div>`;
          showImportModal("Import Success", html);
        }
      }

      // Refresh table
      const fresh = await fetchRecipients();
      renderRecipients(fresh);
    }

    if (importBtn) {
      importBtn.onclick = async () => {
        // Run validation, block import if invalid rows selected
        let invalidSelected = 0;
        let selected = 0;
        tableBody.querySelectorAll("tr").forEach((tr) => {
          const checked = tr.querySelector("input.row-check")?.checked;
          if (!checked) return;
          selected++;
          if (!validateRow(tr)) invalidSelected++;
        });
        if (!selected) {
          showImportModal(
            "Import Error",
            '<div class="text-danger">Please select at least one row.</div>'
          );
          return;
        }
        if (invalidSelected) {
          showImportModal(
            "Import Error",
            `<div class="text-danger">${invalidSelected} selected row(s) have errors. Please fix highlighted rows.</div>`
          );
          return;
        }
        try {
          await doImport();
        } catch (err) {
          showImportModal(
            "Import Error",
            `<div class="text-danger">${escapeHtml(
              err.message || "Import failed"
            )}</div>`
          );
        }
      };
    }

    // Show modal
    bootstrap.Modal.getOrCreateInstance(modalEl).show();
    // Initial validate
    tableBody.querySelectorAll("tr").forEach((tr) => validateRow(tr));
    updateStatus();

    function updateStatus() {
      const total = tableBody.querySelectorAll("tr").length;
      const selected = tableBody.querySelectorAll(
        "input.row-check:checked"
      ).length;
      const invalid = tableBody.querySelectorAll("tr.table-danger").length;
      status.textContent = `${selected}/${total} selected, ${invalid} invalid`;
    }
  }

  function rowHtml(r, idx) {
    const b = escapeHtml(
      decodeHtml(
        String(
          r["name of beneficiary"] ??
            r["beneficiary name"] ??
            r["recipient_name"] ??
            r["organization_name"] ??
            ""
        )
      )
    );
    const advVal = escapeHtml(
      decodeHtml(String(r["advocacy"] ?? r["agency_type"] ?? ""))
    );
    const typeVal = escapeHtml(
      decodeHtml(
        String(
          r["type"] ??
            r["organization_type"] ??
            r["organization type"] ??
            r["org_type"] ??
            r["orgtype"] ??
            r["agency_type"] ??
            r["advocacy"] ??
            ""
        )
      )
    );
    const addr = escapeHtml(
      decodeHtml(String(r["address"] ?? r["addresss"] ?? r["location"] ?? ""))
    );
    const cp = escapeHtml(
      decodeHtml(
        String(r["contact person"] ?? r["contact_person"] ?? r["contact"] ?? "")
      )
    );
    const pos = escapeHtml(
      decodeHtml(String(r["position/designation"] ?? r["position"] ?? ""))
    );
    const cno = escapeHtml(
      decodeHtml(
        String(
          r["contact#"] ??
            r["contact_number"] ??
            r["contact no"] ??
            r["phone"] ??
            ""
        )
      )
    );
    const email = escapeHtml(
      decodeHtml(String(r["email address"] ?? r["email"] ?? ""))
    );
    // Extra fields passed via dataset so they are preserved during import even if not editable in UI
    const totalResidents = escapeHtml(
      decodeHtml(String(r["total residents"] ?? r["total_residents"] ?? ""))
    );
    const ageGroup = escapeHtml(
      decodeHtml(String(r["age group"] ?? r["age_group"] ?? ""))
    );
    const maleCount = escapeHtml(
      decodeHtml(String(r["no of male"] ?? r["male_count"] ?? r["male"] ?? ""))
    );
    const femaleCount = escapeHtml(
      decodeHtml(
        String(r["no of female"] ?? r["female_count"] ?? r["female"] ?? "")
      )
    );
    const externalId = escapeHtml(
      decodeHtml(String(r["external id"] ?? r["external_id"] ?? r["id"] ?? ""))
    );
    return `
      <tr data-index="${idx}"
          data-total-residents="${totalResidents}"
          data-age-group="${ageGroup}"
          data-male-count="${maleCount}"
          data-female-count="${femaleCount}"
          data-external-id="${externalId}">
        <td><input type="checkbox" class="form-check-input row-check" checked></td>
        <td><input type="text" class="form-control form-control-sm" name="beneficiary" value="${b}"></td>
        <td><input type="text" class="form-control form-control-sm" name="advocacy" value="${advVal}"></td>
        <td><input type="text" class="form-control form-control-sm" name="type" value="${typeVal}"></td>
        <td><input type="text" class="form-control form-control-sm" name="address" value="${addr}"></td>
        <td><input type="text" class="form-control form-control-sm" name="contact_person" value="${cp}"></td>
        <td><input type="text" class="form-control form-control-sm" name="position" value="${pos}"></td>
        <td><input type="text" class="form-control form-control-sm" name="contact_no" value="${cno}"></td>
        <td><input type="text" class="form-control form-control-sm" name="email" value="${email}"></td>
      </tr>`;
  }

  function collectRow(tr) {
    const get = (sel) => tr.querySelector(sel)?.value || "";
    const obj = {
      "name of beneficiary": get('input[name="beneficiary"]'),
      advocacy: get('input[name="advocacy"]'),
      type: get('input[name="type"]'),
      address: get('input[name="address"]'),
      "contact person": get('input[name="contact_person"]'),
      "position/designation": get('input[name="position"]'),
      "contact#": get('input[name="contact_no"]'),
      "email address": get('input[name="email"]'),
    };
    // Ensure backend mapping sees organization_type variants
    obj["organization_type"] = obj["type"];
    obj["org_type"] = obj["type"];
    obj["orgtype"] = obj["type"];
    obj["agency_type"] = obj["type"];
    // Add synonymous keys to maximize backend match
    obj["position"] = obj["position/designation"];
    obj["contact_number"] = obj["contact#"];
    obj["contact no"] = obj["contact#"];
    // Include extra fields from dataset so backend can populate recipient_profiles
    const ds = tr.dataset || {};
    if (ds.totalResidents) obj["total residents"] = ds.totalResidents;
    if (ds.ageGroup) obj["age group"] = ds.ageGroup;
    if (ds.maleCount) obj["no of male"] = ds.maleCount;
    if (ds.femaleCount) obj["no of female"] = ds.femaleCount;
    if (ds.externalId) obj["external id"] = ds.externalId;
    return obj;
  }

  function validateRow(tr) {
    const obj = collectRow(tr);
    const hasOrg = String(obj["name of beneficiary"] || "").trim() !== "";
    const hasName = true; // optional for recipients; org/name either OK
    const ok = hasOrg || hasName;
    tr.classList.toggle("table-danger", !ok);
    return ok;
  }

  function normalizeRowKeys(row) {
    // Build a map with multiple normalized variants per key
    const r = {};
    Object.keys(row).forEach((key) => {
      const v = decodeHtml(row[key]);
      const lower = String(key).toLowerCase();
      const trimmed = lower.trim();
      const noNewlines = trimmed.replace(/\s+/g, " "); // collapse multiple spaces/newlines
      const noDots = noNewlines.replace(/\./g, "");
      r[trimmed] = v;
      r[noNewlines] = v;
      r[noDots] = v;
    });
    // Return with original keys we use in preview
    return {
      "name of beneficiary":
        r["name of beneficiary"] ??
        r["beneficiary name"] ??
        r["recipient_name"] ??
        r["organization_name"] ??
        decodeHtml(row["name of beneficiary"]) ??
        decodeHtml(row["organization_name"]) ??
        "",
      advocacy:
        r["advocacy"] ?? r["agency_type"] ?? decodeHtml(row["advocacy"]) ?? "",
      type:
        r["type"] ??
        r["organization_type"] ??
        r["organization type"] ??
        r["org_type"] ??
        r["orgtype"] ??
        r["agency_type"] ??
        r["advocacy"] ??
        decodeHtml(row["type"]) ??
        "",
      address:
        r["address"] ??
        r["addresss"] ??
        r["location"] ??
        decodeHtml(row["address"]) ??
        "",
      "contact person":
        r["contact person"] ??
        r["contact_person"] ??
        r["contact"] ??
        decodeHtml(row["contact person"]) ??
        "",
      "position/designation":
        r["position/designation"] ??
        r["position/ designation"] ??
        r["position / designation"] ??
        r["position designation"] ??
        r["position"] ??
        decodeHtml(row["position/designation"]) ??
        "",
      "contact#":
        r["contact#"] ??
        r["contact_number"] ??
        r["contact no"] ??
        r["contact no."] ??
        r["phone"] ??
        decodeHtml(row["contact#"]) ??
        "",
      "email address":
        r["email address"] ??
        r["email"] ??
        decodeHtml(row["email address"]) ??
        "",
      // Extra fields (optional)
      "total residents":
        r["total residents"] ??
        r["totalresidents"] ??
        r["total no of residents"] ??
        r["total no. of residents"] ??
        decodeHtml(row["total residents"]) ??
        "",
      "age group":
        r["age group"] ?? r["agegroup"] ?? decodeHtml(row["age group"]) ?? "",
      "no of male":
        r["no of male"] ??
        r["male"] ??
        r["male_count"] ??
        decodeHtml(row["no of male"]) ??
        "",
      "no of female":
        r["no of female"] ??
        r["female"] ??
        r["female_count"] ??
        decodeHtml(row["no of female"]) ??
        "",
      "external id":
        r["external id"] ??
        r["externalid"] ??
        r["id"] ??
        decodeHtml(row["external id"]) ??
        "",
    };
  }

  function badge(text, type = "light") {
    return `<span class="badge bg-${type} ${
      type === "light" ? "text-dark" : ""
    }">${text}</span>`;
  }

  // Keep datasets in memory for filtering/sorting
  let recipientsData = [];

  async function fetchRecipients() {
    const res = await fetch(
      `${API_BASE_URL}/users/index.php?action=list&role=recipient&t=${Date.now()}`,
      {
        method: "GET",
        headers: { Accept: "application/json" },
        credentials: "include",
        cache: "no-store",
      }
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const j = await res.json();
    return Array.isArray(j?.data?.items) ? j.data.items : [];
  }

  // Render recipients to match Recipient.html table: Beneficiary, Beneficiary Category, Address, Contact Person, Position, Contact#, Email, Status, Actions
  function renderRecipients(items) {
    const tbody = document.querySelector("main .table tbody");
    if (!tbody) return;
    const rows = items.map((u) => {
      const orgName = decodeHtml(u.organization_name || "");
      const userName = decodeHtml(u.name || "");
      const addr = decodeHtml(u.address || "");
      const recipientName =
        orgName && orgName.trim() ? orgName.trim() : (userName || "").trim();
      const beneficiaryCategory = decodeHtml(
        u.beneficiary_category || u.organization_type || ""
      );
      const contact = (userName || "").trim() || "—";
      const position = decodeHtml(u.position_designation || "");
      const contactNo = decodeHtml(u.contact_number || "");
      const email = decodeHtml(u.email || "");
      const location = (addr || "").trim() || "—";
      const status =
        u.status === "approved"
          ? badge("Active", "success")
          : u.status === "pending"
          ? badge("Pending", "warning")
          : badge("Inactive", "secondary");
      const statusLower = String(u.status || '').toLowerCase();
      const isInactive = statusLower !== 'approved';
      const actionsMenu = `
        <div class="dropdown-menu dropdown-menu-end p-2" style="min-width:auto;">
          <div class="d-flex align-items-center justify-content-center gap-2">
            <button class="btn btn-sm btn-outline-secondary edit-btn" style="width:32px;height:32px;" data-bs-toggle="tooltip" data-bs-placement="top" title="Edit" data-user-id="${u.user_id}">
              <i class="bi bi-pencil-square"></i>
            </button>
            ${statusLower === 'approved' ? `
            <button class="btn btn-sm btn-outline-danger deactivate-btn" style="width:32px;height:32px;" data-bs-toggle="tooltip" data-bs-placement="top" title="Deactivate" data-user-id="${u.user_id}">
              <i class="bi bi-person-x"></i>
            </button>` : ''}
            ${isInactive ? `
            <button class="btn btn-sm btn-outline-success activate-btn" style="width:32px;height:32px;" data-bs-toggle="tooltip" data-bs-placement="top" title="Activate" data-user-id="${u.user_id}">
              <i class="bi bi-person-check"></i>
            </button>` : ''}
          </div>
        </div>`;
      return `
        <tr>
          <td data-label="Name of Beneficiary">${escapeHtml(recipientName)}</td>
          <td class="d-none d-sm-table-cell" data-label="Beneficiary Category">${escapeHtml(
            beneficiaryCategory || "—"
          )}</td>
          <td class="d-none d-sm-table-cell text-break" data-label="Address">${escapeHtml(
            location
          )}</td>
          <td data-label="Contact Person">${escapeHtml(contact)}</td>
          <td class="d-none d-md-table-cell" data-label="Position/Designation">${escapeHtml(
            position || "—"
          )}</td>
          <td class="d-none d-md-table-cell" data-label="Contact#">${escapeHtml(
            contactNo || "—"
          )}</td>
          <td class="d-none d-lg-table-cell email-cell text-nowrap" data-label="Email Address">${escapeHtml(
            email || "—"
          )}</td>
          <td data-label="Status">${status}</td>
          <td data-label="Actions">
            <div class="dropdown recipient-actions d-inline-flex align-items-center">
              <a href="#" class="btn btn-outline-primary btn-sm me-1 view-btn" data-user-id="${u.user_id}" data-bs-toggle="tooltip" data-bs-placement="top" title="View recipient">
                <i class="bi bi-eye-fill"></i>
              </a>
              <button class="btn btn-link p-0" data-bs-toggle="dropdown" aria-expanded="false" aria-label="More actions">
                <i class="bi bi-three-dots-vertical" data-bs-toggle="tooltip" data-bs-placement="top" title="More actions"></i>
              </button>
              ${actionsMenu}
            </div>
          </td>
        </tr>
      `;
    });
    tbody.innerHTML = rows.join("");
    // Initialize tooltips for dynamically added action icons
    try{
      const tips = [].slice.call(document.querySelectorAll('[data-bs-toggle="tooltip"]'));
      tips.forEach(el => {
        if (window.bootstrap && bootstrap.Tooltip) {
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
        }
      });
    }catch(_){ }
  }

  function uniqueSorted(vals){
    return Array.from(new Set(vals.filter(v => v && String(v).trim()))).sort((a,b)=>String(a).localeCompare(String(b)));
  }

  // Derive a city/municipality label from a freeform address
  function extractCity(addr){
    const s = String(addr || '').trim();
    if (!s) return '';
    let t = s.replace(/[\.;]+/g, ',').replace(/\s+/g, ' ').trim();
    // Prefer the last occurrence of a "... City" phrase
    try {
      const re = /([A-Za-z][A-Za-z .-]*?\bCity)\b/gi;
      let m, last = '';
      while ((m = re.exec(t)) !== null) { last = (m[1] || '').trim(); }
      if (last) return last.replace(/\s+/g,' ');
    } catch(_) {}
    // Split by commas and trim parts
    let parts = t.split(',').map(p=>p.trim()).filter(Boolean);
    if (!parts.length) return '';
    // Drop trailing country/province noise
    const drop = /^(philippines|region.*|central visayas|cebu( province)?|province of cebu)$/i;
    while (parts.length && drop.test(parts[parts.length-1])) parts.pop();
    // If any part contains City, extract it
    for (let i=parts.length-1;i>=0;i--){
      const seg = parts[i];
      if (/city\b/i.test(seg)){
        const mm = /([A-Za-z][A-Za-z .-]*?\bCity)\b/i.exec(seg);
        if (mm && mm[1]) return mm[1].replace(/\s+/g,' ').trim();
        return seg.replace(/\s+/g,' ').trim();
      }
    }
    // Otherwise take the last meaningful token (avoid street-level terms)
    const isStreety = /\b(st|street|ave|avenue|rd|road|blvd|purok|sitio|zone|barangay|brgy|at|office)\b/i;
    for (let i=parts.length-1;i>=0;i--){
      const seg = parts[i];
      if (!isStreety.test(seg)) return seg.replace(/\s+/g,' ').trim();
    }
    return parts[0].replace(/\s+/g,' ').trim();
  }

  // Consolidate labels: if two labels include each other (>=9 chars), keep the shorter
  function consolidateLabels(labels){
    const uniq = Array.from(new Set(labels.map(s=>String(s||'').trim()).filter(Boolean)));
    uniq.sort((a,b)=>a.length-b.length || a.localeCompare(b, undefined, {sensitivity:'base'}));
    const kept = [];
    for (const s of uniq){
      const sl = s.toLowerCase();
      let covered = false;
      for (let i=0;i<kept.length;i++){
        const k = kept[i];
        const kl = k.toLowerCase();
        if ((sl.includes(kl) && k.length>=9) || (kl.includes(sl) && s.length>=9)){
          // keep the shorter one
          kept[i] = (k.length <= s.length) ? k : s;
          covered = true;
          break;
        }
      }
      if (!covered) kept.push(s);
    }
    // De-dup after replacements
    return Array.from(new Set(kept));
  }

  function populateFilters(){
    const sel = document.getElementById('recipientCategorySelectMobile');
    if (sel){
      // Build consolidated city list from addresses
      const rawCities = recipientsData.map(u=>extractCity(u.address||'')).filter(Boolean);
      const consolidated = consolidateLabels(rawCities).sort((a,b)=>a.localeCompare(b, undefined, {sensitivity:'base'}));
      const cur = sel.value;
      sel.innerHTML = '<option>All</option>' + consolidated.map(c=>`<option${c===cur?' selected':''}>${c.replace(/&/g,'&amp;').replace(/</g,'&lt;')}</option>`).join('');
    }
  }

  function applyFiltersAndSort(){
    const q = (document.getElementById('donationSearch')?.value || '').trim().toLowerCase();
    const fromStr = document.getElementById('fromDate')?.value || '';
    const toStr = document.getElementById('toDate')?.value || '';
    const statusSel = document.getElementById('recipientStatusSelectMobile');
    const statusFilter = (statusSel && statusSel.value) ? statusSel.value : 'All';
    const actSel = document.getElementById('recipientDonationActivitySelectMobile');
    const activity = (actSel && actSel.value) ? actSel.value : 'All';
    const locSel = document.getElementById('recipientCategorySelectMobile');
    const location = (locSel && locSel.value) ? locSel.value : '';

    // Sort controls
    const qtySel = document.getElementById('recipientQuantityOrderSelectMobile');
    const qtyOrder = qtySel ? qtySel.value : 'None';
    const dateSel = document.getElementById('recipientSubmissionDateSelectMobile');
    const dateOrder = dateSel ? dateSel.value : 'None';
    const nameSel = document.getElementById('recipientDonorOrderSelectMobile');
    const nameOrder = nameSel ? nameSel.value : 'None';

    let list = recipientsData.filter((u)=>{
      const orgName = String(u.organization_name||'');
      const userName = String(u.name||'');
      if (q){
        const L = (orgName + ' ' + userName).toLowerCase();
        if (!L.includes(q)) return false;
      }
      // Date filter (use created_at or updated_at if present)
      const tsRaw = String(u.updated_at || u.created_at || '').trim();
      if (fromStr){
        const from = new Date(fromStr + 'T00:00:00');
        const ts = tsRaw ? new Date(tsRaw) : null;
        if (!ts || ts < from) return false;
      }
      if (toStr){
        const to = new Date(toStr + 'T23:59:59');
        const ts = tsRaw ? new Date(tsRaw) : null;
        if (!ts || ts > to) return false;
      }
      // Location: match by derived consolidated city
      if (location && location !== 'All'){
        const city = extractCity(u.address||'');
        if (!city || city.toLowerCase() !== String(location).toLowerCase()) return false;
      }
      // Status filter: try to match user account status
      if (statusFilter && statusFilter !== 'All'){
        const userStatus = String(u.status||'').toLowerCase();
        if (userStatus !== statusFilter.toLowerCase()) return false;
      }
      // Activity filter: no backend metric; treat as no-op for now
      return true;
    });

    // Sorting
    if (nameOrder && nameOrder !== 'None'){
      list.sort((a,b)=>{
        const an = (a.organization_name || a.name || '').toLowerCase();
        const bn = (b.organization_name || b.name || '').toLowerCase();
        const cmp = an.localeCompare(bn);
        return nameOrder === 'Ascending' ? cmp : -cmp;
      });
    }
    if (dateOrder && dateOrder !== 'None'){
      list.sort((a,b)=>{
        const at = a.updated_at || a.created_at || '';
        const bt = b.updated_at || b.created_at || '';
        const av = at ? new Date(at).getTime() : 0;
        const bv = bt ? new Date(bt).getTime() : 0;
        return dateOrder === 'Newest First' ? (bv - av) : (av - bv);
      });
    }
    if (qtyOrder && qtyOrder !== 'None'){
      // No quantity metric available; keep stable
    }
    renderRecipients(list);
  }

  function bindUI(){
    // Search is live
    const search = document.getElementById('donationSearch');
    if (search){ search.addEventListener('input', ()=>applyFiltersAndSort()); }
    // Filters and sorts: Apply-button gating
    const quick = document.getElementById('quickRangeBtns');
    if (quick){
      quick.addEventListener('click', (e)=>{
        const btn = e.target.closest('button[data-range]'); if (!btn) return;
        const r = btn.getAttribute('data-range');
        const today = new Date();
        const pad=(n)=>String(n).padStart(2,'0');
        const fmt=(d)=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
        let from = new Date(today), to = new Date(today);
        if (r==='today'){ /* no-op */ }
        else if (r==='week'){
          const day = today.getDay();
          const diff = (day===0?6:day-1);
          from = new Date(today); from.setDate(today.getDate()-diff);
        } else if (r==='month'){
          from = new Date(today.getFullYear(), today.getMonth(), 1);
        }
        const fd=document.getElementById('fromDate'); const td=document.getElementById('toDate');
        if (fd) fd.value = fmt(from); if (td) td.value = fmt(to);
        // Wait for Apply
      });
    }
    // Reset/Apply in dropdowns
    document.querySelectorAll('.dropdown-menu').forEach(menu=>{
      menu.addEventListener('click', (e)=>{
        const btn = e.target.closest('button'); if (!btn) return;
        const label = (btn.textContent||'').trim().toLowerCase();
        if (label==='reset'){
          const fd=document.getElementById('fromDate'); const td=document.getElementById('toDate'); if (fd) fd.value=''; if (td) td.value='';
          ['recipientStatusSelectMobile','recipientDonationActivitySelectMobile','recipientCategorySelectMobile','recipientQuantityOrderSelectMobile','recipientSubmissionDateSelectMobile','recipientDonorOrderSelectMobile'].forEach(id=>{ const el=document.getElementById(id); if (el) el.selectedIndex=0; });
          const s=document.getElementById('donationSearch'); if (s) s.value='';
        } else if (label==='apply'){
          applyFiltersAndSort();
        }
      });
    });

    // Delegated actions handlers
    document.addEventListener('click', (e)=>{
      const edit = e.target.closest && e.target.closest('.edit-btn');
      if (edit){
        e.preventDefault();
        const id = Number(edit.getAttribute('data-user-id'));
        const u = (recipientsData||[]).find(x=>Number(x.user_id)===id);
        if (!u){ try{ showToast('Recipient not found', 'danger'); }catch(_){ } return; }
        openEditModal(u);
        return;
      }
      const deactivate = e.target.closest && e.target.closest('.deactivate-btn');
      if (deactivate){
        e.preventDefault();
        const id = Number(deactivate.getAttribute('data-user-id'));
        const u = (recipientsData||[]).find(x=>Number(x.user_id)===id);
        if (!u){ try{ showToast('Recipient not found', 'danger'); }catch(_){ } return; }
        confirmAction({
          title: 'Deactivate Recipient',
          message: `Are you sure you want to deactivate ${escapeHtml(u.organization_name || u.name || 'this recipient')}?`,
          confirmText: 'Deactivate',
          confirmClass: 'btn-danger'
        }).then((ok)=>{ if (ok) deactivateRecipient(id).catch(()=>{}); });
        return;
      }
      const activate = e.target.closest && e.target.closest('.activate-btn');
      if (activate){
        e.preventDefault();
        const id = Number(activate.getAttribute('data-user-id'));
        const u = (recipientsData||[]).find(x=>Number(x.user_id)===id);
        if (!u){ try{ showToast('Recipient not found', 'danger'); }catch(_){ } return; }
        confirmAction({
          title: 'Activate Recipient',
          message: `Activate ${escapeHtml(u.organization_name || u.name || 'this recipient')}?`,
          confirmText: 'Activate',
          confirmClass: 'btn-success'
        }).then((ok)=>{ if (ok) activateRecipient(id).catch(()=>{}); });
        return;
      }
    });
  }

  function ensureConfirmModal(){
    let el = document.getElementById('adminConfirmModal');
    if (el) return el;
    const html = `
      <div class="modal fade" id="adminConfirmModal" tabindex="-1" aria-hidden="true">
        <div class="modal-dialog modal-dialog-centered">
          <div class="modal-content">
            <div class="modal-header">
              <h5 class="modal-title" id="adminConfirmTitle">Confirm</h5>
              <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
            </div>
            <div class="modal-body" id="adminConfirmBody">Are you sure?</div>
            <div class="modal-footer">
              <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
              <button type="button" class="btn btn-primary" id="adminConfirmBtn">Confirm</button>
            </div>
          </div>
        </div>
      </div>`;
    const div = document.createElement('div');
    div.innerHTML = html;
    document.body.appendChild(div.firstElementChild);
    return document.getElementById('adminConfirmModal');
  }

  function confirmAction(opts){
    return new Promise((resolve)=>{
      const el = ensureConfirmModal();
      const titleEl = el.querySelector('#adminConfirmTitle');
      const bodyEl = el.querySelector('#adminConfirmBody');
      const btnEl = el.querySelector('#adminConfirmBtn');
      if (titleEl) titleEl.textContent = String(opts?.title || 'Confirm');
      if (bodyEl) bodyEl.innerHTML = String(opts?.message || 'Are you sure?');
      if (btnEl){
        btnEl.textContent = String(opts?.confirmText || 'Confirm');
        btnEl.className = 'btn ' + (opts?.confirmClass || 'btn-primary');
      }
      const modal = bootstrap.Modal.getOrCreateInstance(el);
      const onCancel = ()=>{ cleanup(); resolve(false); };
      const onOk = ()=>{ cleanup(); modal.hide(); resolve(true); };
      function cleanup(){
        btnEl.removeEventListener('click', onOk);
        el.removeEventListener('hidden.bs.modal', onCancel);
      }
      btnEl.addEventListener('click', onOk);
      el.addEventListener('hidden.bs.modal', onCancel, { once: true });
      modal.show();
    });
  }

  function ensureEditModal(){
    let el = document.getElementById('recipientEditModal');
    if (el) return el;
    const html = `
      <div class="modal fade" id="recipientEditModal" tabindex="-1" aria-hidden="true">
        <div class="modal-dialog">
          <div class="modal-content">
            <div class="modal-header">
              <h5 class="modal-title">Edit Recipient</h5>
              <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
            </div>
            <div class="modal-body">
              <form id="recipientEditForm" class="vstack gap-2">
                <input type="hidden" id="edit_user_id" />
                <div>
                  <label class="form-label">Organization/Beneficiary</label>
                  <input type="text" class="form-control" id="edit_org" />
                </div>
                <div>
                  <label class="form-label">Beneficiary Category</label>
                  <select id="edit_beneficiary_category" class="form-select" data-placeholder="Select a category"></select>
                </div>
                <div>
                  <label class="form-label">Contact Person</label>
                  <input type="text" class="form-control" id="edit_name" />
                </div>
                <div>
                  <label class="form-label">Address</label>
                  <input type="text" class="form-control" id="edit_address" />
                </div>
                <div>
                  <label class="form-label">Position/Designation</label>
                  <input type="text" class="form-control" id="edit_position" />
                </div>
                <div>
                  <label class="form-label">Contact #</label>
                  <input type="text" class="form-control" id="edit_contact_no" />
                </div>
                <div>
                  <label class="form-label">Email</label>
                  <input type="email" class="form-control" id="edit_email" />
                </div>
              </form>
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
              <button type="button" class="btn btn-primary" id="recipientEditSaveBtn">Save</button>
            </div>
          </div>
        </div>
      </div>`;
    const div = document.createElement('div');
    div.innerHTML = html;
    document.body.appendChild(div.firstElementChild);
    return document.getElementById('recipientEditModal');
  }

  function setupEditModalSelects(modalEl){
    if (!modalEl) return;
    const select = modalEl.querySelector('#edit_beneficiary_category');
    const $select = ensureSelect2(select, modalEl);
    if ($select && !$select.data('_changeBound')){
      $select.on('change', () => {
        // no-op; placeholder to ensure event listener exists if needed later
      });
      $select.data('_changeBound', '1');
    }
    loadBeneficiaryCategories()
      .then((cats) => populateBeneficiaryCategoryOptions(select, cats))
      .catch((err) => console.error('Failed to load beneficiary categories:', err));
  }

  function openEditModal(u){
    const el = ensureEditModal();
    el.querySelector('#edit_user_id').value = u.user_id;
    el.querySelector('#edit_org').value = u.organization_name || '';
    el.querySelector('#edit_name').value = u.name || '';
    el.querySelector('#edit_address').value = u.address || '';
    el.querySelector('#edit_position').value = u.position_designation || '';
    el.querySelector('#edit_contact_no').value = u.contact_number || '';
    el.querySelector('#edit_email').value = u.email || '';
    setupEditModalSelects(el);
    const select = el.querySelector('#edit_beneficiary_category');
    Promise.resolve()
      .then(() =>
        loadBeneficiaryCategories()
          .then((cats) => {
            populateBeneficiaryCategoryOptions(select, cats);
          })
          .catch(() => {})
      )
      .finally(() => {
        syncBeneficiaryCategorySelection(
          select,
          u.beneficiary_category_id ?? u.organization_type,
          u.beneficiary_category || u.organization_type
        );
      });
    const modal = bootstrap.Modal.getOrCreateInstance(el);
    const saveBtn = el.querySelector('#recipientEditSaveBtn');
    saveBtn.onclick = async ()=>{
      try{
        saveBtn.disabled = true;
        const categorySelect = el.querySelector('#edit_beneficiary_category');
        const categoryVal = categorySelect
          ? categorySelect.value || null
          : null;
        await updateRecipient({
          user_id: Number(el.querySelector('#edit_user_id').value),
          organization_name: el.querySelector('#edit_org').value.trim(),
          name: el.querySelector('#edit_name').value.trim(),
          address: el.querySelector('#edit_address').value.trim(),
          position_designation: el.querySelector('#edit_position').value.trim(),
          contact_number: el.querySelector('#edit_contact_no').value.trim(),
          email: el.querySelector('#edit_email').value.trim(),
          beneficiary_category_id: categoryVal ? Number(categoryVal) : null,
        });
        modal.hide();
        try{ showToast('Recipient updated successfully', 'success'); }catch(_){ }
      } finally {
        saveBtn.disabled = false;
      }
    };
    modal.show();
  }

  async function updateRecipient(payload){
    const res = await fetch(`${API_BASE_URL}/users/index.php?action=adminUpdateProfile`,{
      method: 'POST',
      headers: { 'Content-Type':'application/json', 'Accept':'application/json' },
      credentials: 'include',
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const j = await res.json();
    if (!j?.success) throw new Error(j?.error || 'Update failed');
    const recipients = await fetchRecipients();
    recipientsData = recipients;
    populateFilters();
    applyFiltersAndSort();
  }

  async function deactivateRecipient(user_id){
    const res = await fetch(`${API_BASE_URL}/users/index.php?action=setStatus`,{
      method: 'POST',
      headers: { 'Content-Type':'application/json', 'Accept':'application/json' },
      credentials: 'include',
      body: JSON.stringify({ user_id, status: 'inactive' })
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const j = await res.json();
    if (!j?.success) throw new Error(j?.error || 'Deactivate failed');
    try{ showToast('Recipient deactivated', 'success'); }catch(_){ }
    const recipients = await fetchRecipients();
    recipientsData = recipients;
    populateFilters();
    applyFiltersAndSort();
  }

  async function activateRecipient(user_id){
    const res = await fetch(`${API_BASE_URL}/users/index.php?action=setStatus`,{
      method: 'POST',
      headers: { 'Content-Type':'application/json', 'Accept':'application/json' },
      credentials: 'include',
      body: JSON.stringify({ user_id, status: 'approved' })
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const j = await res.json();
    if (!j?.success) throw new Error(j?.error || 'Activate failed');
    try{ showToast('Recipient activated', 'success'); }catch(_){ }
    const recipients = await fetchRecipients();
    recipientsData = recipients;
    populateFilters();
    applyFiltersAndSort();
  }

  async function init() {
    try {
      const tbody = document.querySelector("main .table tbody");
      if (tbody) {
        tbody.innerHTML = `<tr><td colspan="9" class="text-center py-3">Loading recipients...</td></tr>`;
      }
      const recipients = await fetchRecipients();
      recipientsData = recipients;
      populateFilters();
      bindUI();
      applyFiltersAndSort();

      // Import from Excel wiring
      const fileInput = document.getElementById("importRecipientsInput");
      const btnDesktop = document.getElementById("importRecipientsBtn");
      const btnMobile = document.getElementById("importRecipientsBtnMobile");

      function openPicker() {
        if (fileInput) fileInput.click();
      }
      if (btnDesktop) btnDesktop.addEventListener("click", openPicker);
      if (btnMobile) btnMobile.addEventListener("click", openPicker);

      // showImportModal is now defined globally above

      if (fileInput) {
        fileInput.addEventListener("change", async (e) => {
          const file = e.target.files && e.target.files[0];
          if (!file) return;
          try {
            if (typeof XLSX === "undefined") {
              showImportModal(
                "Import Error",
                '<div class="text-danger">XLSX library not loaded.</div>'
              );
              return;
            }
            const data = await file.arrayBuffer();
            const wb = XLSX.read(data, { type: "array" });
            // Pick the best worksheet (recognizable headers or most data)
            const expected = [
              "no",
              "no.",
              "organization_name",
              "agency_name",
              "recipient_name",
              "name of beneficiary",
              "beneficiary name",
              "type",
              "organization_type",
              "organization type",
              "org_type",
              "orgtype",
              "agency_type",
              "advocacy",
              "contact person",
              "contact_person",
              "contact",
              "contact#",
              "contact no",
              "contact_number",
              "address",
              "addresss",
              "location",
              "email",
              "email address",
              "name",
              "position/designation",
              "position",
              "total residents",
              "total no of residents",
              "total no. of residents",
              "age group",
              "no of male",
              "no of female",
              "id",
              "external id",
            ];
            let chosen = null;
            let chosenScore = -1;
            wb.SheetNames.forEach((sn) => {
              const ws0 = wb.Sheets[sn];
              const mx = XLSX.utils.sheet_to_json(ws0, {
                header: 1,
                defval: "",
              });
              // score: count non-empty cells
              let cells = 0;
              let headerHit = 0;
              for (let r = 0; r < Math.min(20, mx.length); r++) {
                const row = mx[r] || [];
                cells += row.reduce(
                  (a, v) => a + (String(v).trim() !== "" ? 1 : 0),
                  0
                );
                const rowLower = row.map((c) => String(c).toLowerCase().trim());
                if (rowLower.some((c) => expected.includes(c))) headerHit++;
              }
              const score = headerHit * 1000 + cells; // prioritize header hits
              if (score > chosenScore) {
                chosenScore = score;
                chosen = { name: sn, ws: ws0, matrix: mx };
              }
            });
            const sheetName = chosen ? chosen.name : wb.SheetNames[0];
            const ws = chosen ? chosen.ws : wb.Sheets[sheetName];
            const matrix = chosen
              ? chosen.matrix
              : XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
            // Find header row by looking for any expected header names AND ensuring the next row has data
            let headerRowIdx = 0;
            const top = Math.min(10, matrix.length);
            for (let i = 0; i < top; i++) {
              const rowLower = (matrix[i] || []).map((c) =>
                String(c).toLowerCase().trim()
              );
              const match = rowLower.some((c) => expected.includes(c));
              if (!match) continue;
              // ensure next row has any non-empty cell
              const next = matrix[i + 1] || [];
              const hasDataBelow = next.some((v) => String(v).trim() !== "");
              if (hasDataBelow) {
                headerRowIdx = i;
                break;
              }
            }
            const headerRaw = matrix[headerRowIdx] || [];
            const header = headerRaw.map((h) => String(h).trim());
            const headerLower = header.map((h) => h.toLowerCase());
            const headerHasKnown = headerLower.some((c) =>
              expected.includes(c)
            );
            let rows = [];
            if (headerHasKnown) {
              const dataRows = matrix.slice(headerRowIdx + 1);
              // Build objects with normalized header keys
              rows = dataRows
                .map((r) => {
                  const obj = {};
                  for (let c = 0; c < header.length; c++) {
                    const key = header[c];
                    if (!key) continue;
                    obj[key] = r[c];
                  }
                  return obj;
                })
                .filter((o) =>
                  Object.values(o).some((v) => String(v).trim() !== "")
                );
            } else {
              // Fallback: no recognizable headers found. Treat first non-empty row as data and map by column index.
              // Expected order by columns (0-based) matching user's new sheet:
              // 0: NO.
              // 1: NAME OF BENEFICIARY (organization)
              // 2: ADVOCACY (ignored)
              // 3: TYPE (organization_type)
              // 4: ADDRESS
              // 5: CONTACT PERSON
              // 6: POSITION/DESIGNATION
              // 7: CONTACT NO.
              // 8: EMAIL ADDRESS
              // 9: TOTAL NO. OF RESIDENTS
              // 10: AGE GROUP
              // 11: NO. OF MALE
              // 12: NO. OF FEMALE
              const dataStart = matrix.findIndex((r) =>
                (r || []).some((v) => String(v).trim() !== "")
              );
              const rawRows = dataStart >= 0 ? matrix.slice(dataStart) : [];
              rows = rawRows
                .map((r) => ({
                  "name of beneficiary": r[1] ?? "",
                  advocacy: r[2] ?? "",
                  type: r[3] ?? "",
                  address: r[4] ?? "",
                  "contact person": r[5] ?? "",
                  "position/designation": r[6] ?? "",
                  "contact#": r[7] ?? "",
                  "email address": r[8] ?? "",
                  "total residents": r[9] ?? "",
                  "age group": r[10] ?? "",
                  "no of male": r[11] ?? "",
                  "no of female": r[12] ?? "",
                }))
                .filter((o) =>
                  Object.values(o).some((v) => String(v).trim() !== "")
                );
            }

            // (diagnostics removed)

            if (rows.length === 0) {
              const diag = `
                <div class="mb-2">No data rows detected under the header.</div>
                <div class="small text-muted">Detected header row index: <code>${headerRowIdx}</code></div>
                <div class="small mb-2">Header: <code>${header
                  .map((h) => String(h))
                  .join(" | ")}</code></div>
                <div class="mb-2">Tips:</div>
                <ul class="mb-0">
                  <li>Ensure the header row contains recognizable column names (e.g., <em>Name of Beneficiary</em>, <em>Contact#</em>, <em>Address</em>, <em>Email Address</em>).</li>
                  <li>Ensure the first data row starts immediately below the header (e.g., header in row 2, data starts row 3).</li>
                </ul>`;
              showImportModal("Import Problem", diag);
              return;
            }
            // Show Preview & Edit modal before sending to backend
            await showPreviewAndMaybeImport(rows);
          } catch (err) {
            showImportModal(
              "Import Error",
              `<div class="text-danger">${escapeHtml(
                err.message || "Import failed"
              )}</div>`
            );
          } finally {
            // reset input so selecting the same file again will trigger change
            e.target.value = "";
          }
        });
      }
    } catch (err) {
      console.error("Failed to load recipients:", err);
      const tbody = document.querySelector("main .table tbody");
      if (tbody) {
        tbody.innerHTML = `<tr><td colspan="7" class="text-center text-danger">Failed to load recipients (${escapeHtml(
          err.message
        )})</td></tr>`;
      }
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  // Add Recipient modal submit handler (manual create)
  document.addEventListener('DOMContentLoaded', () => {
    const API_BASE_URL = (typeof window.API_BASE_URL === 'string' && window.API_BASE_URL) ? window.API_BASE_URL : '/php/api';
    const addBtn = document.getElementById('addRecSubmitBtn');
    if (!addBtn) return;
    const addModalEl = document.getElementById('addRecipientModal');
    const addCategorySelect = document.getElementById('addRecCategory');
    initializeBeneficiaryCategorySelect(addCategorySelect, addModalEl);
    syncBeneficiaryCategorySelection(addCategorySelect, '', '');

    if (addModalEl) {
      addModalEl.addEventListener('shown.bs.modal', () => {
        initializeBeneficiaryCategorySelect(addCategorySelect, addModalEl);
        syncBeneficiaryCategorySelection(addCategorySelect, '', '');
      });
    }

    addBtn.addEventListener('click', async () => {
      const org = document.getElementById('addRecOrg')?.value.trim() || '';
      const first = document.getElementById('addRecFirstName')?.value.trim() || '';
      const middle = document.getElementById('addRecMiddleInitial')?.value.trim() || '';
      const last = document.getElementById('addRecLastName')?.value.trim() || '';
      const suffix = document.getElementById('addRecSuffix')?.value.trim() || '';
      const position = document.getElementById('addRecPosition')?.value.trim() || '';
      const nameInput = document.getElementById('addRecName');
      const composeFullName = () => {
        const parts = [];
        if (first) parts.push(first);
        if (middle) {
          const normalized = middle.replace(/\.+$/g, '');
          if (normalized) parts.push(`${normalized}.`);
        }
        if (last) parts.push(last);
        if (suffix) parts.push(suffix);
        return parts.join(' ').replace(/\s+/g, ' ').trim();
      };
      const composedName = composeFullName();
      if (nameInput && composedName) {
        nameInput.value = composedName;
      }
      const name = composedName || nameInput?.value.trim() || '';
      const email = document.getElementById('addRecEmail')?.value.trim() || '';
      const contact_number = document.getElementById('addRecPhone')?.value.trim() || '';
      const brgy = document.getElementById('addRecBarangay')?.value.trim() || '';
      const city = document.getElementById('addRecCity')?.value.trim() || '';
      const addrInput = document.getElementById('addRecAddress');
      const composedAddress = [brgy, city].filter(Boolean).join(', ');
      if (addrInput && composedAddress) {
        addrInput.value = composedAddress;
      }
      const address = composedAddress || addrInput?.value.trim() || '';
      const total_residents = document.getElementById('addRecPopulation')?.value || '';
      const age_group = document.getElementById('addRecAgeGroup')?.value.trim() || '';
      const male_count = document.getElementById('addRecMale')?.value || '';
      const female_count = document.getElementById('addRecFemale')?.value || '';
      const beneficiary_category_id = addCategorySelect?.value || '';
      const fb = document.getElementById('addRecFeedback');
      if (fb) fb.textContent = '';
      if (!org && !name) {
        if (fb) fb.textContent = 'Organization Name or Contact Person is required.';
        return;
      }
      addBtn.disabled = true;
      try {
        const res = await fetch(`${API_BASE_URL}/users/index.php?action=createRecipient`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: JSON.stringify({
            organization_name: org || null,
            name: name || null,
            contact_person: name || null,
            email: email || null,
            contact_number: contact_number || null,
            address: address || null,
            position_designation: position || null,
            total_residents: total_residents ? Number(total_residents) : null,
            age_group: age_group || null,
            male_count: male_count ? Number(male_count) : null,
            female_count: female_count ? Number(female_count) : null,
            beneficiary_category_id: beneficiary_category_id ? Number(beneficiary_category_id) : null,
          })
        });
        const j = await res.json().catch(() => ({ success: false, error: `HTTP ${res.status}` }));
        if (!res.ok || !j?.success) throw new Error(j?.error || `HTTP ${res.status}`);
        const data = j.data || {};
        try {
          const m = document.getElementById('addRecipientModal');
          if (m && window.bootstrap && bootstrap.Modal) bootstrap.Modal.getOrCreateInstance(m).hide();
        } catch (_) {}
        const tmp = data.temporary_password ? `Temporary password: ${String(data.temporary_password)}` : '';
        alert(`Recipient created. ${tmp}`.trim());
        // Simple reload to repopulate list consistently
        window.location.reload();
      } catch (err) {
        if (fb) fb.textContent = err?.message || 'Failed to create recipient';
      } finally {
        addBtn.disabled = false;
      }
    });
  });

})();
