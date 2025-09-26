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

(function () {
  "use strict";

  // API base URL (consistent with other admin pages)
  const API_BASE_URL =
    typeof window.API_BASE_URL === "string" && window.API_BASE_URL
      ? window.API_BASE_URL
      : "/Capstone%20Project/php/api";

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
        console.warn("Import errors:", summary.errors);
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
        const html = `
          <div class="alert alert-success d-flex align-items-center" role="alert">
            <i class="bi bi-check-circle-fill me-2"></i>
            <div>
              Import completed successfully.
            </div>
          </div>
          <div><span class="badge bg-success">Inserted: ${
            summary.inserted || 0
          }</span></div>`;
        showImportModal("Import Success", html);
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
          console.error(err);
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

  async function fetchRecipients() {
    const res = await fetch(
      `${API_BASE_URL}/users/index.php?action=list&role=recipient&status=approved&t=${Date.now()}`,
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

  // Render recipients to match Recipient.html table: Beneficiary, Type, Address, Contact Person, Position, Contact#, Email, Status, Actions
  function renderRecipients(items) {
    const tbody = document.querySelector("main .table tbody");
    if (!tbody) return;
    const rows = items.map((u) => {
      const orgName = decodeHtml(u.organization_name || "");
      const userName = decodeHtml(u.name || "");
      const addr = decodeHtml(u.address || "");
      const recipientName =
        orgName && orgName.trim() ? orgName.trim() : (userName || "").trim();
      const orgType = decodeHtml(u.organization_type || "");
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
      return `
        <tr>
          <td data-label="Name of Beneficiary">${escapeHtml(recipientName)}</td>
          <td class="d-none d-sm-table-cell" data-label="Type">${escapeHtml(
            orgType || "—"
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
          <td class="d-none d-lg-table-cell text-break" data-label="Email Address">${escapeHtml(
            email || "—"
          )}</td>
          <td data-label="Status">${status}</td>
          <td data-label="Actions"><a href="#" data-user-id="${
            u.user_id
          }">View / Edit</a></td>
        </tr>
      `;
    });
    tbody.innerHTML = rows.join("");
  }

  async function init() {
    try {
      const tbody = document.querySelector("main .table tbody");
      if (tbody) {
        tbody.innerHTML = `<tr><td colspan="9" class="text-center py-3">Loading recipients...</td></tr>`;
      }
      const recipients = await fetchRecipients();
      renderRecipients(recipients);

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

            // Diagnostics in console
            console.info("[Import] Detected header row index:", headerRowIdx);
            console.info("[Import] Header:", header);
            console.info("[Import] Parsed rows count:", rows.length);
            console.info("[Import] First 3 rows:", rows.slice(0, 3));

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
            console.error("Import failed:", err);
            showImportModal(
              "Import Error",
              `<div class="text-danger">${escapeHtml(
                err.message || "Unknown error"
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
})();
