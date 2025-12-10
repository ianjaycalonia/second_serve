document.addEventListener("DOMContentLoaded", () => {
  // Base API URL (same as other admin pages)
  const API_BASE_URL =
    typeof window.API_BASE_URL === "string" && window.API_BASE_URL
      ? window.API_BASE_URL
      : "/php/api";

  // In-memory datasets and derived index
  let donorsData = [];
  let donationsData = [];
  let donorCategoryMap = new Map();
  let currentEditDonorId = null;

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

  function isValidEmail(email) {
    const s = String(email || "").trim();
    if (!s) return false;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
  }

  function uniqueSorted(values) {
    if (!Array.isArray(values)) return [];
    return Array.from(
      new Set(
        values
          .map((v) => (v == null ? "" : String(v).trim()))
          .filter((v) => v !== "")
      )
    ).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  }

  function getModalInstance(id) {
    const el = document.getElementById(id);
    if (!el) return null;
    if (window.bootstrap && bootstrap.Modal) {
      return bootstrap.Modal.getOrCreateInstance(el);
    }
    if (window.$) {
      // jQuery fallback
      return {
        show() {
          $(el).modal('show');
        },
        hide() {
          $(el).modal('hide');
        },
      };
    }
    return {
      show() {
        el.style.display = 'block';
      },
      hide() {
        el.style.display = 'none';
      },
    };
  }

  function formatUserStatus(status) {
    const s = String(status || "").toLowerCase();
    if (!s) return "—";
    if (s === "approved") return "Active";
    if (s === "inactive") return "Inactive";
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  function formatDetailValue(value) {
    if (value === undefined || value === null) return "&mdash;";
    const str = String(value).trim();
    return str ? escapeHtml(str) : "&mdash;";
  }

  // Donor import helpers (modal + loading state)
  let donorImportInProgress = false;

  function setDonorImportLoading(loading, refs) {
    donorImportInProgress = !!loading;
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
    if (modal) {
      const inputs = modal.querySelectorAll("input, button, select, textarea");
      inputs.forEach((el) => {
        if (el === btn) return;
        if (loading) {
          if (!el.dataset._disabled) {
            el.dataset._disabled = el.disabled ? "1" : "";
          }
          el.disabled = true;
        } else if (el.dataset._disabled !== undefined) {
          el.disabled = el.dataset._disabled === "1";
          delete el.dataset._disabled;
        }
      });
    }
  }

  function showDonorImportModal(title, html) {
    const body = document.getElementById("donorImportResultBody");
    const label = document.getElementById("donorImportResultModalLabel");
    const el = document.getElementById("donorImportResultModal");
    if (!body || !label || !el) {
      console.warn(
        "Donor import result modal elements not found, falling back to alert"
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

  function loadDonorCategoryMap() {
    return fetch(`${API_BASE_URL}/lookups/index.php/donor-categories?limit=200&active=1`, {
      method: "GET",
      headers: { Accept: "application/json" },
      credentials: "include",
    })
      .then((res) => {
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        return res.json();
      })
      .then((data) => {
        if (!data?.success || !Array.isArray(data?.items)) {
          return;
        }
        donorCategoryMap = new Map(
          data.items.map((item) => [Number(item.id), String(item.name)])
        );
      })
      .catch(() => {
        // Leave map empty on failure; fallback logic will handle names from donorsData
      });
  }

  function getDonorCategoryName(donor) {
    if (!donor) return "—";
    const id = donor.donor_category_id || donor.donor_category;
    if (id && donorCategoryMap.has(Number(id))) {
      return donorCategoryMap.get(Number(id));
    }
    if (donor.donor_category && typeof donor.donor_category === "string") {
      return donor.donor_category;
    }
    if (id) {
      return `Category ${id}`;
    }
    return "—";
  }

  function attachNameFieldValidation(){
    const miInput = document.getElementById('addDonorMiddleInitial');
    const lastInput = document.getElementById('addDonorLastName');
    const FIRST_INITIAL_REGEX = /^[A-Za-z]{0,2}$/;
    const LAST_NAME_REGEX = /^[A-Za-z]+(?:[ '\-][A-Za-z]+)*$/;

    if (miInput){
      const validateMi = () => {
        const val = miInput.value || '';
        const hasVal = val.length > 0;
        if (hasVal && !FIRST_INITIAL_REGEX.test(val)) {
          miInput.setCustomValidity('Use up to two letters only.');
          miInput.classList.add('is-invalid');
        } else {
          miInput.setCustomValidity('');
          miInput.classList.remove('is-invalid');
        }
      };
      miInput.addEventListener('input', validateMi);
      miInput.addEventListener('blur', validateMi);
      validateMi();
    }

    if (lastInput){
      const validateLast = () => {
        const val = lastInput.value || '';
        if (!val) {
          lastInput.setCustomValidity('Last name is required.');
        } else if (!LAST_NAME_REGEX.test(val)) {
          lastInput.setCustomValidity('Use letters with optional spaces, apostrophes, or hyphens.');
        } else {
          lastInput.setCustomValidity('');
        }
      };
      lastInput.addEventListener('input', validateLast);
      lastInput.addEventListener('blur', validateLast);
      validateLast();
    }
  }

  function showDonorDetails(donor) {
    const categoryName = getDonorCategoryName(donor);
    const details = document.getElementById("viewDonorDetails");
    if (details) {
      const rows = [
        ["Organization", donor.organization_name],
        ["Contact Person", donor.name],
        ["Email", donor.email],
        ["Contact Number", donor.contact_number],
        ["Address", donor.address],
        ["Category", categoryName],
        ["Status", formatUserStatus(donor.status)],
        ["Notes", donor.notes],
      ];
      details.innerHTML = rows
        .map(
          ([label, value]) =>
            `<dt class="col-sm-4">${escapeHtml(label)}</dt><dd class="col-sm-8">${formatDetailValue(value)}</dd>`
        )
        .join("");
    }
    const modal = document.getElementById("viewDonorModal");
    if (modal) modal.style.display = "block";
  }

  // Fetch donors (approved) and donations list, then render donors table
  init();
  attachNameFieldValidation();

  async function fetchDonors() {
    const res = await fetch(
      `${API_BASE_URL}/users/index.php?action=list&role=donor&t=${Date.now()}`,
      {
        method: "GET",
        credentials: "include",
        headers: { Accept: "application/json" },
        cache: "no-store",
      }
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const j = await res.json();
    return Array.isArray(j?.data?.items) ? j.data.items : [];
  }

  async function fetchDonations() {
    const res = await fetch(
      `${API_BASE_URL}/donations/index.php/list?t=${Date.now()}`,
      {
        method: "GET",
        credentials: "include",
        headers: { Accept: "application/json" },
        cache: "no-store",
      }
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const j = await res.json();
    return Array.isArray(j?.data?.items) ? j.data.items : [];
  }

  function badge(text, type = "light") {
    return `<span class="badge bg-${type} ${
      type === "light" ? "text-dark" : ""
    }">${text}</span>`;
  }

  function donationKey(donation) {
    if (!donation || typeof donation !== "object") return null;
    if (donation.batch_id) return `batch:${String(donation.batch_id)}`;
    if (donation.donation_id) return `single:${String(donation.donation_id)}`;
    if (donation.id) return `single:${String(donation.id)}`;
    return null;
  }

  function buildDonorAggregates(donations) {
    const map = new Map();
    donations.forEach((d) => {
      const donorId = d.donor_id;
      if (!donorId) return;
      const entry = map.get(donorId) || {
        completed: new Set(),
        last: null,
        lastStatus: null,
      };
      const status = (d.status || "").trim();
      const createdAt = d.created_at ? new Date(d.created_at) : null;
      if (createdAt && (!entry.last || createdAt > entry.last)) {
        entry.last = createdAt;
        entry.lastStatus = status || null;
      }
      if (status === "Completed") {
        const key = donationKey(d);
        if (key) entry.completed.add(key);
      }
      map.set(donorId, entry);
    });
    return map;
  }

  function renderDonors(donors, donations) {
    const tbody = document.querySelector("main .table tbody");
    if (!tbody) return;
    // Aggregate donations per donor_id for metrics and last activity/status
    const byDonor = buildDonorAggregates(donations);

    const rows = donors.map((u) => {
      const name =
        u.organization_name && u.organization_name.trim()
          ? u.organization_name.trim()
          : (u.name || "").trim();
      const contact = (u.name || "").trim() || "—";
      const location = (u.address || "").trim() || "—";
      const category = escapeHtml(getDonorCategoryName(u));
      const agg = byDonor.get(u.user_id) || {
        completed: new Set(),
        last: null,
        lastStatus: null,
      };
      const total = agg.completed.size; // total completed donations (batch or single)
      const last = agg.last ? agg.last.toLocaleDateString() : "—";
      const statusLower = String(u.status || '').toLowerCase();
      const status =
        statusLower === "approved"
          ? badge("Active", "success")
          : statusLower === "inactive"
          ? badge("Inactive", "secondary")
          : badge("Pending", "warning");
      const isApproved = statusLower === 'approved';
      const isInactive = statusLower === 'inactive';
      const actionsButtons = `
        <div class="d-inline-flex align-items-center justify-content-end gap-2">
          <button class="btn btn-sm btn-outline-secondary edit-btn" style="width:32px;height:32px;" data-bs-toggle="tooltip" data-bs-placement="top" title="Edit" data-user-id="${u.user_id}">
            <i class="bi bi-pencil-square"></i>
          </button>
          ${isApproved ? `
          <button class="btn btn-sm btn-outline-danger deactivate-btn" style="width:32px;height:32px;" data-bs-toggle="tooltip" data-bs-placement="top" title="Deactivate" data-user-id="${u.user_id}">
            <i class="bi bi-person-x"></i>
          </button>` : ''}
          ${!isApproved ? `
          <button class="btn btn-sm btn-outline-success activate-btn" style="width:32px;height:32px;" data-bs-toggle="tooltip" data-bs-placement="top" title="Activate" data-user-id="${u.user_id}">
            <i class="bi bi-person-check"></i>
          </button>` : ''}
        </div>`;
      return `
        <tr>
          <td>${escapeHtml(name)}</td>
          <td>${escapeHtml(contact)}</td>
          <td>${escapeHtml(location)}</td>
          <td>${category}</td>
          <td>${total}</td>
          <td>${last}</td>
          <td>${status}</td>
          <td class="text-end">
            ${actionsButtons}
          </td>
        </tr>
      `;
    });
    tbody.innerHTML = rows.join("");
    // Initialize tooltips for dynamically added action icons
    try {
      const tips = Array.from(
        document.querySelectorAll('[data-bs-toggle="tooltip"]')
      );
      tips.forEach((el) => {
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
    } catch (_) {}
  }

  // ---- Donor Import Preview & Edit helpers ----

  function normalizeDonorImportRow(row) {
    const out = {
      donor: "",
      donor_category: "",
      contact_person: "",
      contact_number: "",
      address: "",
      email: "",
      notes: "",
    };
    if (!row || typeof row !== "object") return out;
    Object.keys(row).forEach((key) => {
      const rawVal = row[key];
      const v = rawVal == null ? "" : String(rawVal);
      if (!v.trim()) return;
      const lower = String(key).toLowerCase().trim();
      const simple = lower.replace(/\s+/g, " ");
      const canon = lower.replace(/[\s._-]+/g, "");
      if (
        [
          "donor",
          "donorname",
          "nameofdonor",
          "organizationname",
          "company",
          "org",
          "organisationname",
        ].includes(canon)
      ) {
        if (!out.donor) out.donor = v;
        return;
      }
      if (
        [
          "donorcategory",
          "category",
          "type",
        ].includes(canon)
      ) {
        if (!out.donor_category) out.donor_category = v;
        return;
      }
      if (
        [
          "contactperson",
          "contact_person",
          "contact",
        ].includes(canon)
      ) {
        if (!out.contact_person) out.contact_person = v;
        return;
      }
      if (
        [
          "contactnumber",
          "contactno",
          "contactno.",
          "contact#",
          "phone",
          "mobile",
        ].includes(canon)
      ) {
        if (!out.contact_number) out.contact_number = v;
        return;
      }
      if (["address", "location"].includes(canon)) {
        if (!out.address) out.address = v;
        return;
      }
      if (["email", "emailaddress"].includes(canon)) {
        if (!out.email) out.email = v;
        return;
      }
      if (["notes", "remarks"].includes(canon)) {
        if (!out.notes) out.notes = v;
      }
    });
    return out;
  }

  function renderDonorPreviewTable(rows) {
    const tbody = document.querySelector(
      "#donorImportPreviewTable tbody"
    );
    if (!tbody) return;
    const esc = (v) => escapeHtml(String(v == null ? "" : v));
    const html = rows
      .map((r, idx) => {
        return `
      <tr data-index="${idx}">
        <td><input type="checkbox" class="form-check-input donor-row-check" checked></td>
        <td><input type="text" class="form-control form-control-sm" name="donor" value="${esc(
          r.donor
        )}"></td>
        <td><input type="text" class="form-control form-control-sm" name="donor_category" value="${esc(
          r.donor_category
        )}"></td>
        <td><input type="text" class="form-control form-control-sm" name="contact_person" value="${esc(
          r.contact_person
        )}"></td>
        <td><input type="text" class="form-control form-control-sm" name="contact_number" value="${esc(
          r.contact_number
        )}"></td>
        <td><input type="text" class="form-control form-control-sm" name="address" value="${esc(
          r.address
        )}"></td>
      </tr>`;
      })
      .join("");
    tbody.innerHTML = html;
  }

  function collectDonorPreviewRow(tr) {
    const get = (name) =>
      tr.querySelector(`input[name="${name}"]`)?.value.trim() || "";
    const donor = get("donor");
    const donor_category = get("donor_category");
    const contact_person = get("contact_person");
    const contact_number = get("contact_number");
    const address = get("address");
    const obj = {
      organization_name: donor,
      donor_category,
      contact_person,
      contact_number,
      address,
    };
    return obj;
  }

  function validateDonorPreviewRow(tr) {
    if (!tr) return false;
    const donorInp = tr.querySelector('input[name="donor"]');
    const donorVal = donorInp?.value.trim() || "";
    const ok = !!donorVal;
    tr.classList.toggle("table-danger", !ok);
    return ok;
  }

  async function showDonorPreviewAndMaybeImport(rawRows) {
    const modalEl = document.getElementById("donorImportPreviewModal");
    const tableBody = document.querySelector(
      "#donorImportPreviewTable tbody"
    );
    const master = document.getElementById("donorPreviewMasterCheck");
    const selAll = document.getElementById("donorPreviewSelectAllBtn");
    const deselAll = document.getElementById("donorPreviewDeselectAllBtn");
    const importBtn = document.getElementById("donorPreviewImportBtn");
    const status = document.getElementById("donorPreviewStatus");
    if (!modalEl || !tableBody || !importBtn) {
      console.warn("Donor import preview elements missing");
      return;
    }

    const normalized = (rawRows || [])
      .map((r) => normalizeDonorImportRow(r))
      .filter((r) =>
        Object.values(r).some((v) => String(v || "").trim() !== "")
      );
    if (!normalized.length) {
      showDonorImportModal(
        "Import Error",
        '<div class="text-danger">No data rows detected in the selected sheet.</div>'
      );
      return;
    }

    renderDonorPreviewTable(normalized);

    function updateStatus() {
      const total = tableBody.querySelectorAll("tr").length;
      const selected = tableBody.querySelectorAll(
        "input.donor-row-check:checked"
      ).length;
      const invalid = tableBody.querySelectorAll("tr.table-danger").length;
      if (status) {
        status.textContent = `${selected}/${total} selected, ${invalid} invalid`;
      }
    }

    tableBody.querySelectorAll("tr").forEach((tr) => {
      validateDonorPreviewRow(tr);
    });

    tableBody
      .querySelectorAll("input.donor-row-check")
      .forEach((cb) => cb.addEventListener("change", updateStatus));
    tableBody.querySelectorAll('input[type="text"]').forEach((inp) => {
      inp.addEventListener("input", (e) => {
        const tr = e.target.closest("tr");
        validateDonorPreviewRow(tr);
        updateStatus();
      });
    });

    if (master) {
      master.checked = true;
      master.addEventListener("change", () => {
        tableBody
          .querySelectorAll("input.donor-row-check")
          .forEach((cb) => {
            cb.checked = master.checked;
          });
        updateStatus();
      });
    }
    if (selAll)
      selAll.onclick = () => {
        tableBody
          .querySelectorAll("input.donor-row-check")
          .forEach((cb) => (cb.checked = true));
        if (master) master.checked = true;
        updateStatus();
      };
    if (deselAll)
      deselAll.onclick = () => {
        tableBody
          .querySelectorAll("input.donor-row-check")
          .forEach((cb) => (cb.checked = false));
        if (master) master.checked = false;
        updateStatus();
      };

    async function doImport() {
      if (donorImportInProgress) return;
      setDonorImportLoading(true, { importBtn, modalEl });
      const payload = [];
      tableBody.querySelectorAll("tr").forEach((tr) => {
        const checked = tr.querySelector("input.donor-row-check")?.checked;
        if (!checked) return;
        if (!validateDonorPreviewRow(tr)) return;
        const obj = collectDonorPreviewRow(tr);
        if (!String(obj.organization_name || "").trim()) return;
        payload.push(obj);
      });
      if (!payload.length) {
        setDonorImportLoading(false, { importBtn, modalEl });
        showDonorImportModal(
          "Import Error",
          '<div class="text-danger">No rows selected or rows failed validation.</div>'
        );
        return;
      }

      let j;
      try {
        const res = await fetch(
          `${API_BASE_URL}/users/index.php?action=importDonors`,
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
        setDonorImportLoading(false, { importBtn, modalEl });
      }

      const summary = j.data || {};
      // Close preview modal
      if (window.bootstrap && bootstrap.Modal) {
        bootstrap.Modal.getOrCreateInstance(modalEl).hide();
      }

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
        showDonorImportModal("Import Result", html);
      } else {
        const inserted = Number(summary.inserted || 0);
        let toastShown = false;
        try {
          if (typeof showToast === "function") {
            const label = inserted === 1 ? "donor" : "donors";
            showToast(`Imported ${inserted} ${label} successfully.`, {
              title: "Import Donors",
              variant: "success",
            });
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
          showDonorImportModal("Import Success", html);
        }
      }

      // Refresh donors list
      const [freshDonors, freshDonations] = await Promise.all([
        fetchDonors(),
        fetchDonations(),
      ]);
      donorsData = freshDonors;
      donationsData = freshDonations;
      populateFilters();
      applyFiltersAndSort();
    }

    importBtn.onclick = async () => {
      // Validate selected rows before import
      let invalidSelected = 0;
      let selected = 0;
      tableBody.querySelectorAll("tr").forEach((tr) => {
        const checked = tr.querySelector("input.donor-row-check")?.checked;
        if (!checked) return;
        selected++;
        if (!validateDonorPreviewRow(tr)) invalidSelected++;
      });
      if (!selected) {
        showDonorImportModal(
          "Import Error",
          '<div class="text-danger">Please select at least one row.</div>'
        );
        return;
      }
      if (invalidSelected) {
        showDonorImportModal(
          "Import Error",
          `<div class="text-danger">${invalidSelected} selected row(s) have errors. Please fix highlighted rows.</div>`
        );
        return;
      }
      try {
        await doImport();
      } catch (err) {
        showDonorImportModal(
          "Import Error",
          `<div class="text-danger">${escapeHtml(
            err.message || "Import failed"
          )}</div>`
        );
      }
    };

    if (window.bootstrap && bootstrap.Modal) {
      bootstrap.Modal.getOrCreateInstance(modalEl).show();
    } else if (window.$) {
      $(modalEl).modal("show");
    } else {
      modalEl.style.display = "block";
    }

    updateStatus();
  }

  function getValueFrom(ids, fallback = "") {
    const list = Array.isArray(ids) ? ids : [ids];
    for (const id of list) {
      const el = document.getElementById(id);
      if (el && el.value != null) return String(el.value);
    }
    return fallback;
  }

  function setInputValue(ids, value) {
    (Array.isArray(ids) ? ids : [ids]).forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.value = value;
    });
  }

  function resetSelects(ids) {
    (Array.isArray(ids) ? ids : [ids]).forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.selectedIndex = 0;
    });
  }

  function resetFilterControls() {
    setInputValue(['filterDateFrom','filterDateTo','fromDate','toDate'], '');
    resetSelects([
      'donorsStatusSelectMobile','donorsDonationActivitySelectMobile','donorsCategorySelectMobile',
      'filterStatusSelect','filterLocationSelect'
    ]);
    const search = document.getElementById('donationSearch');
    if (search) search.value = '';
  }

  function resetSortControls() {
    resetSelects([
      'recipientQuantityOrderSelectMobile','recipientSubmissionDateSelectMobile','recipientDonorOrderSelectMobile',
      'donorsQuantityOrderSelectMobile','donorsSubmissionDateSelectMobile','donorsDonorOrderSelectMobile',
      'sortTotalDonation','sortLastDonationDate','sortDonorName'
    ]);
  }

  function closeDropdownFromButton(btn) {
    if (!btn) return;
    const menu = btn.closest('.dropdown-menu');
    if (!menu) return;
    const toggle = menu.parentElement?.querySelector('[data-bs-toggle="dropdown"]');
    if (toggle && window.bootstrap?.Dropdown) {
      const inst = bootstrap.Dropdown.getInstance(toggle) || bootstrap.Dropdown.getOrCreateInstance(toggle);
      inst?.hide();
    } else {
      menu.classList.remove('show');
      menu.parentElement?.classList.remove('show');
    }
  }

  function applyFiltersAndSort(){
    const q = (document.getElementById('donationSearch')?.value || '').trim().toLowerCase();
    const fromStr = getValueFrom(['filterDateFrom','fromDate']).trim();
    const toStr = getValueFrom(['filterDateTo','toDate']).trim();
    const statusVal = getValueFrom(['filterStatusSelect','donorsStatusSelectMobile']).trim();
    const statusFilter = statusVal ? statusVal : 'All';
    const activityRaw = getValueFrom(['donorsDonationActivitySelectMobile']).trim();
    const activity = activityRaw ? activityRaw : 'All';
    const locVal = getValueFrom(['filterLocationSelect','donorsCategorySelectMobile']).trim();
    const location = locVal && locVal.toLowerCase() !== 'all' ? locVal : '';

    // Sort controls (desktop + legacy IDs)
    const qtyOrderRaw = getValueFrom(['sortTotalDonation','donorsQuantityOrderSelectMobile','recipientQuantityOrderSelectMobile']).trim();
    const dateOrderRaw = getValueFrom(['sortLastDonationDate','donorsSubmissionDateSelectMobile','recipientSubmissionDateSelectMobile']).trim();
    const nameOrderRaw = getValueFrom(['sortDonorName','donorsDonorOrderSelectMobile','recipientDonorOrderSelectMobile']).trim();

    const qtyOrder = (() => {
      const lc = qtyOrderRaw.toLowerCase();
      if (lc === 'desc' || lc === 'high to low' || lc === 'highest to lowest') return 'desc';
      if (lc === 'asc' || lc === 'low to high' || lc === 'lowest to highest') return 'asc';
      return 'none';
    })();

    const dateOrder = (() => {
      const lc = dateOrderRaw.toLowerCase();
      if (lc === 'newest' || lc === 'newest first' || lc === 'desc') return 'desc';
      if (lc === 'oldest' || lc === 'oldest first' || lc === 'asc') return 'asc';
      return 'none';
    })();

    const nameOrder = (() => {
      const lc = nameOrderRaw.toLowerCase();
      if (lc === 'asc' || lc === 'ascending' || lc === 'a to z') return 'asc';
      if (lc === 'desc' || lc === 'descending' || lc === 'z to a') return 'desc';
      return 'none';
    })();

    // Build aggregates map once
    const byDonor = buildDonorAggregates(donationsData);

    // Filter donors
    let list = donorsData.filter((u) => {
      const name = (u.organization_name || u.name || '').toLowerCase();
      if (q && !name.includes(q)) return false;
      const agg = byDonor.get(u.user_id) || {
        completed: new Set(),
        last: null,
        lastStatus: null,
      };
      // Date range on last donation date
      if (fromStr) {
        const from = new Date(fromStr + 'T00:00:00');
        if (!agg.last || agg.last < from) return false;
      }
      if (toStr) {
        const to = new Date(toStr + 'T23:59:59');
        if (!agg.last || agg.last > to) return false;
      }
      // Location filter
      if (location) {
        const donorLocation = String(u.address || '').trim();
        if (donorLocation.toLowerCase() !== location.toLowerCase()) return false;
      }
      // Donation activity by total completed batches
      const total = agg.completed.size;
      if (activity === 'Low' && !(total >= 1 && total < 3)) return false;
      if (activity === 'Medium' && !(total >= 3 && total < 10)) return false;
      if (activity === 'High' && !(total >= 10)) return false;
      // Status filter (based on last donation status when available)
      if (statusFilter && statusFilter !== 'All') {
        const statusToCheck = statusFilter.toLowerCase();
        const userStatus = String(u.status || '').toLowerCase();
        const lastStatus = String(agg.lastStatus || '').toLowerCase();
        if (statusToCheck === 'inactive') {
          if (userStatus !== 'inactive') return false;
        } else if (statusToCheck === 'pending') {
          if (userStatus !== 'pending' && lastStatus !== 'pending') return false;
        } else {
          if (userStatus !== statusToCheck && lastStatus !== statusToCheck) return false;
        }
      }
      return true;
    });

    // Sort: apply in priority order (quantity, date, donor name) if set
    list = list.slice();
    if (nameOrder === 'asc' || nameOrder === 'desc') {
      list.sort((a,b)=>{
        const an = (a.organization_name || a.name || '').toLowerCase();
        const bn = (b.organization_name || b.name || '').toLowerCase();
        const cmp = an.localeCompare(bn);
        return nameOrder === 'asc' ? cmp : -cmp;
      });
    }
    if (dateOrder === 'asc' || dateOrder === 'desc') {
      list.sort((a,b)=>{
        const aggA = byDonor.get(a.user_id) || {
          completed: new Set(),
          last: null,
          lastStatus: null,
        };
        const aggB = byDonor.get(b.user_id) || {
          completed: new Set(),
          last: null,
          lastStatus: null,
        };
        const aa = aggA.last;
        const bb = aggB.last;
        const av = aa ? aa.getTime() : 0;
        const bv = bb ? bb.getTime() : 0;
        return dateOrder === 'desc' ? (bv - av) : (av - bv);
      });
    }
    if (qtyOrder === 'asc' || qtyOrder === 'desc') {
      list.sort((a,b)=>{
        const aggA = byDonor.get(a.user_id) || {
          completed: new Set(),
          last: null,
          lastStatus: null,
        };
        const aggB = byDonor.get(b.user_id) || {
          completed: new Set(),
          last: null,
          lastStatus: null,
        };
        const ac = aggA.completed.size;
        const bc = aggB.completed.size;
        return qtyOrder === 'desc' ? (bc - ac) : (ac - bc);
      });
    }

    renderDonors(list, donationsData);
  }

  function populateFilters(){
    // Populate location options
    const selects = [
      document.getElementById('filterLocationSelect'),
      document.getElementById('donorsCategorySelectMobile'),
    ].filter(Boolean);
    if (!selects.length) return;
    const locs = uniqueSorted(
      donorsData.map((u) => String(u.address || '').trim()).filter(Boolean)
    );
    selects.forEach((sel) => {
      const cur = sel.value || '';
      const optionsHtml = locs
        .map((l) => {
          const selected = cur && cur === l ? ' selected' : '';
          const safe = escapeHtml(l);
          return `<option value="${safe}"${selected}>${safe}</option>`;
        })
        .join('');
      sel.innerHTML = `<option value="">All</option>${optionsHtml}`;
      if (cur && !locs.includes(cur)) {
        sel.selectedIndex = 0;
      }
    });
  }

  function bindUI(){
    // Search
    const search = document.getElementById('donationSearch');
    if (search){ search.addEventListener('input', ()=>applyFiltersAndSort()); }
    // Filters: do not auto-apply; only Apply button will trigger applyFiltersAndSort()
    // Quick ranges
    const quick = document.getElementById('quickRangeBtns');
    if (quick){
      quick.addEventListener('click', (e)=>{
        const btn = e.target.closest('button[data-range]'); if (!btn) return;
        const r = btn.getAttribute('data-range');
        const today = new Date();
        const pad=(n)=>String(n).padStart(2,'0');
        const fmt=(d)=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
        let from = new Date(today), to = new Date(today);
        if (r==='today'){ /* from,to already today */ }
        else if (r==='week'){
          const day = today.getDay(); // 0..6 Sun..Sat
          const diff = (day===0?6:day-1); // make Monday start
          from = new Date(today); from.setDate(today.getDate()-diff);
        } else if (r==='month'){
          from = new Date(today.getFullYear(), today.getMonth(), 1);
        }
        setInputValue(['filterDateFrom','fromDate'], fmt(from));
        setInputValue(['filterDateTo','toDate'], fmt(to));
        // Do not apply yet; wait for Apply button
      });
    }
    // Sorts: do not auto-apply; only Apply button will trigger
    const filterApplyBtn = document.getElementById('donorsFilterApplyBtn');
    if (filterApplyBtn){
      filterApplyBtn.addEventListener('click', () => {
        applyFiltersAndSort();
        closeDropdownFromButton(filterApplyBtn);
      });
    }
    const filterResetBtn = document.getElementById('donorsFilterResetBtn');
    if (filterResetBtn){
      filterResetBtn.addEventListener('click', () => {
        resetFilterControls();
      });
    }
    const sortApplyBtn = document.getElementById('donorsSortApplyBtn');
    if (sortApplyBtn){
      sortApplyBtn.addEventListener('click', () => {
        applyFiltersAndSort();
        closeDropdownFromButton(sortApplyBtn);
      });
    }
    const sortResetBtn = document.getElementById('donorsSortResetBtn');
    if (sortResetBtn){
      sortResetBtn.addEventListener('click', () => {
        resetSortControls();
      });
    }
    // Reset/Apply buttons within dropdowns
    document.querySelectorAll('.dropdown-menu').forEach(menu=>{
      menu.addEventListener('click', (e)=>{
        const btn = e.target.closest('button'); if (!btn) return;
        if (btn.matches('#donorsFilterResetBtn, #donorsFilterApplyBtn, #donorsSortResetBtn, #donorsSortApplyBtn')) {
          return;
        }
        const label = (btn.textContent||'').trim().toLowerCase();
        if (label==='reset'){
          // Reset filters and sorts
          resetFilterControls();
          resetSortControls();
          // Do not apply yet; wait for Apply button
        } else if (label==='apply'){
          applyFiltersAndSort();
        }
      });
    });
  }

  async function init() {
    try {
      // Clear placeholder rows while loading
      const tbody = document.querySelector("main .table tbody");
      if (tbody)
        tbody.innerHTML = `<tr><td colspan="8" class="text-center py-3">Loading donors...</td></tr>`;

      const [categories, donors, donations] = await Promise.all([
        loadDonorCategoryMap(),
        fetchDonors(),
        fetchDonations(),
      ]);
      donorsData = donors; donationsData = donations;
      populateFilters();
      bindUI();
      applyFiltersAndSort();

      // Import from Excel wiring
      const fileInput = document.getElementById('importDonorsInput');
      const btnDesktop = document.getElementById('importDonorsBtn');
      const btnMobile = document.getElementById('importDonorsBtnMobile');
      function openPicker(){ if (fileInput) fileInput.click(); }
      if (btnDesktop) btnDesktop.addEventListener('click', openPicker);
      if (btnMobile) btnMobile.addEventListener('click', openPicker);

      if (fileInput){
        fileInput.addEventListener('change', async (e) => {
          const file = e.target.files && e.target.files[0];
          if (!file) return;
          try{
            if (typeof XLSX === 'undefined'){
              try { showToast('XLSX library not loaded.', { title: 'Import Donors', variant: 'danger' }); } catch (_) {
                console.error('XLSX library not loaded.');
              }
              return;
            }
            const data = await file.arrayBuffer();
            const wb = XLSX.read(data, { type: 'array' });
            // Detect the header row similarly to recipient import so we handle blank top rows
            const expected = [
              'donor',
              'donor name',
              'name of donor',
              'organization name',
              'donor category',
              'donorcategory',
              'category',
              'contact person',
              'contact_person',
              'contact',
              'contact number',
              'contact no',
              'contact no.',
              'contact#',
              'phone',
              'mobile',
              'address',
              'location',
              'email',
              'email address',
            ];
            let chosen = null;
            let chosenScore = -1;
            wb.SheetNames.forEach((sn) => {
              const ws0 = wb.Sheets[sn];
              const mx = XLSX.utils.sheet_to_json(ws0, {
                header: 1,
                defval: '',
              });
              let cells = 0;
              let headerHit = 0;
              for (let r = 0; r < Math.min(20, mx.length); r++) {
                const row = mx[r] || [];
                cells += row.reduce(
                  (a, v) => a + (String(v).trim() !== '' ? 1 : 0),
                  0
                );
                const rowLower = row.map((c) => String(c).toLowerCase().trim());
                if (rowLower.some((c) => expected.includes(c))) headerHit++;
              }
              const score = headerHit * 1000 + cells; // prioritize header hits
              if (score > chosenScore) {
                chosenScore = score;
                chosen = { name: sn, matrix: mx };
              }
            });
            const sheetName = chosen ? chosen.name : wb.SheetNames[0];
            const matrix = chosen
              ? chosen.matrix
              : XLSX.utils.sheet_to_json(wb.Sheets[sheetName], {
                  header: 1,
                  defval: '',
                });
            // Find header row by looking for expected header cells and ensuring the next row has data
            let headerRowIdx = 0;
            const top = Math.min(10, matrix.length);
            for (let i = 0; i < top; i++) {
              const rowLower = (matrix[i] || []).map((c) =>
                String(c).toLowerCase().trim()
              );
              const match = rowLower.some((c) => expected.includes(c));
              if (!match) continue;
              const next = matrix[i + 1] || [];
              const hasDataBelow = next.some((v) => String(v).trim() !== '');
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
                  Object.values(o).some((v) => String(v).trim() !== '')
                );
            } else {
              // Fallback: treat first non-empty row as header
              const dataStart = matrix.findIndex((r) =>
                (r || []).some((v) => String(v).trim() !== '')
              );
              if (dataStart >= 0) {
                const hdr = matrix[dataStart] || [];
                const dataRows = matrix.slice(dataStart + 1);
                rows = dataRows
                  .map((r) => {
                    const obj = {};
                    for (let c = 0; c < hdr.length; c++) {
                      const key = String(hdr[c] || '').trim();
                      if (!key) continue;
                      obj[key] = r[c];
                    }
                    return obj;
                  })
                  .filter((o) =>
                    Object.values(o).some((v) => String(v).trim() !== '')
                  );
              }
            }
            if (!rows.length) {
              showDonorImportModal(
                'Import Error',
                '<div class="text-danger">No data rows were found in the selected sheet.</div>'
              );
              return;
            }
            await showDonorPreviewAndMaybeImport(rows);
          } catch(err){
            try{ showToast(`Import failed: ${err.message}`, 'danger'); }catch(_){ console.error(err); }
          } finally {
            e.target.value = '';
          }
        });
      }

      // Add Donor modal submit handler
      const addBtn = document.getElementById('addDonorSubmitBtn');
      if (addBtn) {
        // Initialize Select2 for donor category with backend lookups
        try {
          const addSel = document.getElementById('addDonorCategory');
          const addModalEl = document.getElementById('addDonorModal');
          if (addSel && window.$ && $.fn.select2) {
            $(addSel).select2({
              width: '100%',
              placeholder: 'Select a category',
              allowClear: true,
              dropdownParent: addModalEl ? $(addModalEl) : undefined,
              ajax: {
                url: `${API_BASE_URL}/lookups/index.php/donor-categories`,
                dataType: 'json',
                delay: 250,
                data: (params) => ({ q: params.term || '', limit: 20, active: 1 }),
                processResults: (data) => ({
                  results: Array.isArray(data?.items)
                    ? data.items.map((it) => ({ id: it.id, text: it.name }))
                    : []
                })
              }
            });
          }

          const editSel = document.getElementById('editDonorCategory');
          const editModalEl = document.getElementById('editDonorModal');
          if (editSel && window.$ && $.fn.select2) {
            $(editSel).select2({
              width: '100%',
              placeholder: 'Select a category',
              allowClear: true,
              dropdownParent: editModalEl ? $(editModalEl) : undefined,
              ajax: {
                url: `${API_BASE_URL}/lookups/index.php/donor-categories`,
                dataType: 'json',
                delay: 250,
                data: (params) => ({ q: params.term || '', limit: 20, active: 1 }),
                processResults: (data) => ({
                  results: Array.isArray(data?.items)
                    ? data.items.map((it) => ({ id: it.id, text: it.name }))
                    : []
                })
              }
            });
          }
        } catch (_) {}

        addBtn.addEventListener('click', async () => {
          const org = document.getElementById('addDonorOrg')?.value.trim() || '';
          const first = document.getElementById('addDonorFirstName')?.value.trim() || '';
          const middle = document.getElementById('addDonorMiddleInitial')?.value.trim() || '';
          const last = document.getElementById('addDonorLastName')?.value.trim() || '';
          const suffix = document.getElementById('addDonorSuffix')?.value.trim() || '';
          const fullNameInput = document.getElementById('addDonorName');
          const FIRST_NAME_REGEX = /^[A-Za-z]+(?:[A-Za-z]*[0-9]+)?$/;
          const MIDDLE_INITIAL_REGEX = /^[A-Za-z]{0,2}$/;
          const LAST_NAME_REGEX = /^[A-Za-z]+(?:[ '-][A-Za-z]+)*$/;
          const CONTACT_NUMBER_REGEX = /^\(0\d{3}-\d{3}-\d{4}\)$/;
          const phoneArea = document.getElementById('addDonorPhoneArea')?.value.trim() || '';
          const phonePrefix = document.getElementById('addDonorPhonePrefix')?.value.trim() || '';
          const phoneLine = document.getElementById('addDonorPhoneLine')?.value.trim() || '';
          const composedPhone = (phoneArea && phonePrefix && phoneLine)
            ? `(${phoneArea}-${phonePrefix}-${phoneLine})`
            : '';
          const hiddenPhoneInput = document.getElementById('addDonorPhone');
          if (hiddenPhoneInput) {
            hiddenPhoneInput.value = composedPhone;
          }
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
          if (fullNameInput && composedName) {
            fullNameInput.value = composedName;
          }
          const name = composedName || fullNameInput?.value.trim() || '';
          const email = document.getElementById('addDonorEmail')?.value.trim() || '';
          const contact_number = composedPhone;
          const brgy = document.getElementById('addDonorBarangay')?.value.trim() || '';
          const city = document.getElementById('addDonorCity')?.value.trim() || '';
          const addrInput = document.getElementById('addDonorAddress');
          const street = addrInput?.value.trim() || '';
          const addressParts = [street, brgy, city].filter(Boolean);
          const address = addressParts.join(', ');
          const donor_category_id = document.getElementById('addDonorCategory')?.value || '';
          const fb = document.getElementById('addDonorFeedback');
          if (fb) fb.textContent = '';
          const showRequiredError = (message) => {
            if (fb) fb.textContent = message;
            try {
              showToast(message, { title: 'Add Donor', variant: 'danger' });
            } catch (_) {
              console.warn('Toast unavailable:', message);
            }
          };
          if (!first) {
            showRequiredError('First name is required.');
            return;
          }
          if (!FIRST_NAME_REGEX.test(first)) {
            showRequiredError('First name must start with letters and may only include numbers at the end.');
            return;
          }
          if (middle && !MIDDLE_INITIAL_REGEX.test(middle)) {
            showRequiredError('Middle initial may only contain up to two letters.');
            return;
          }
          if (!last) {
            showRequiredError('Last name is required.');
            return;
          }
          if (!LAST_NAME_REGEX.test(last)) {
            showRequiredError('Last name may only include letters, spaces, hyphens, or apostrophes.');
            return;
          }
          if (!org && !name) {
            if (fb) fb.textContent = 'Organization Name or Contact Person is required.';
            return;
          }
          if (!email) {
            showRequiredError('Email is required.');
            return;
          }
          if (!isValidEmail(email)) {
            try { showToast('Please enter a valid email address.', 'danger'); } catch (_) {
              console.warn('Toast unavailable: invalid email');
            }
            return;
          }
          if (!phoneArea || !phonePrefix || !phoneLine) {
            showRequiredError('Complete all contact number fields.');
            return;
          }
          if (!CONTACT_NUMBER_REGEX.test(contact_number)) {
            showRequiredError('Contact number must follow the format (0991-007-1270).');
            return;
          }
          if (!brgy) {
            showRequiredError('Barangay is required.');
            return;
          }
          if (!city) {
            showRequiredError('City / Municipality is required.');
            return;
          }
          if (!donor_category_id) {
            showRequiredError('Donor category is required.');
            return;
          }
          const existingDonors = Array.isArray(donorsData) ? donorsData : [];
          const emailLower = email.toLowerCase();
          const orgLower = org.toLowerCase();
          const nameLower = name.toLowerCase();
          let emailExists = false;
          let orgExists = false;
          let contactExists = false;
          if (emailLower) {
            emailExists = existingDonors.some((d) =>
              String(d.email || '').trim().toLowerCase() === emailLower
            );
          }
          if (orgLower) {
            orgExists = existingDonors.some((d) =>
              String(d.organization_name || '').trim().toLowerCase() === orgLower
            );
          }
          if (nameLower) {
            contactExists = existingDonors.some((d) =>
              String(d.name || '').trim().toLowerCase() === nameLower
            );
          }
          if (emailExists) {
            let msg = 'A donor with this email already exists.';
            if (orgExists || contactExists) {
              msg += ' Please review the organization name and contact person before creating another record.';
            }
            try { showToast(msg, { title: 'Duplicate donor', variant: 'danger' }); } catch (_) {
              console.warn('Toast unavailable:', msg);
            }
            return;
          }
          if (orgExists || contactExists) {
            const fields = [];
            if (orgExists) fields.push('organization name');
            if (contactExists) fields.push('contact person');
            const msg = `A donor with the same ${fields.join(' and ')} already exists.`;
            try { showToast(msg, { title: 'Duplicate donor', variant: 'danger' }); } catch (_) {
              console.warn('Toast unavailable:', msg);
            }
            return;
          }
          addBtn.disabled = true;
          try {
            const res = await fetch(`${API_BASE_URL}/users/index.php?action=createDonor`, {
              method: 'POST',
              credentials: 'include',
              headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
              body: JSON.stringify({
                organization_name: org || null,
                name: name || null,
                email: email || null,
                contact_number: contact_number || null,
                address: address || null,
                donor_category_id: donor_category_id ? Number(donor_category_id) : null,
              })
            });
            const j = await res.json().catch(()=>({success:false,error:`HTTP ${res.status}`}));
            if (!res.ok || !j?.success) throw new Error(j?.error || `HTTP ${res.status}`);
            const data = j.data || {};
            // Hide modal
            try {
              const m = document.getElementById('addDonorModal');
              if (m && window.bootstrap && bootstrap.Modal) bootstrap.Modal.getOrCreateInstance(m).hide();
            } catch(_){}
            // Refresh lists
            const [freshDonors, freshDonations] = await Promise.all([ fetchDonors(), fetchDonations() ]);
            donorsData = freshDonors; donationsData = freshDonations;
            populateFilters();
            applyFiltersAndSort();
            // Show temp password
            try { showToast('Donor created successfully.', 'success'); } catch (_){
              console.log('Donor created successfully.');
            }
          } catch(err){
            if (fb) fb.textContent = err?.message || 'Failed to create donor';
          } finally {
            addBtn.disabled = false;
          }
        });
      }
    } catch (err) {
      console.error("Failed to load donors:", err);
      const tbody = document.querySelector("main .table tbody");
      if (tbody)
        tbody.innerHTML = `<tr><td colspan="8" class="text-center text-danger">Failed to load donors (${escapeHtml(
          err.message
        )})</td></tr>`;
    }
  }

  async function openDonorModal(userId) {
    const donor = donorsData.find((d) => Number(d.user_id) === Number(userId));
    if (!donor) {
      try { showToast('Donor not found.', { title: 'View Donor', variant: 'danger' }); } catch (_){ console.warn('Donor not found.'); }
      return;
    }
    try {
      const res = await fetch(`${API_BASE_URL}/users/index.php?action=adminGetProfile`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ user_id: userId }),
      });
      const j = await res.json();
      if (!res.ok || !j?.success) throw new Error(j?.error || `HTTP ${res.status}`);
      const data = j?.data?.user || donor;
      showDonorDetails(data);
    } catch (err) {
      try {
        showToast(`Failed to load donor profile: ${err?.message || 'Unknown error'}`, { title: 'View Donor', variant: 'danger' });
      } catch (_) {
        console.error('Failed to load donor profile:', err);
      }
    }
  }

  async function openEditDonor(userId) {
    const donor = donorsData.find((d) => Number(d.user_id) === Number(userId));
    if (!donor) {
      try { showToast('Donor not found.', { title: 'Edit Donor', variant: 'danger' }); } catch (_){ console.warn('Donor not found.'); }
      return;
    }
    currentEditDonorId = Number(userId);
    const orgInput = document.getElementById('editDonorOrg');
    const hiddenNameInput = document.getElementById('editDonorName');
    const firstInput = document.getElementById('editDonorFirstName');
    const middleInput = document.getElementById('editDonorMiddleInitial');
    const lastInput = document.getElementById('editDonorLastName');
    const suffixInput = document.getElementById('editDonorSuffix');
    const emailInput = document.getElementById('editDonorEmail');
    const hiddenPhoneInput = document.getElementById('editDonorPhone');
    const phoneAreaInput = document.getElementById('editDonorPhoneArea');
    const phonePrefixInput = document.getElementById('editDonorPhonePrefix');
    const phoneLineInput = document.getElementById('editDonorPhoneLine');
    const streetInput = document.getElementById('editDonorAddress');
    const brgyInput = document.getElementById('editDonorBarangay');
    const citySelect = document.getElementById('editDonorCity');
    const fb = document.getElementById('editDonorFeedback');
    const categorySel = document.getElementById('editDonorCategory');
    if (fb) fb.textContent = '';
    if (orgInput) orgInput.value = donor.organization_name || '';
    const fullName = (donor.name || '').trim();
    if (hiddenNameInput) hiddenNameInput.value = fullName;
    if (firstInput || middleInput || lastInput || suffixInput) {
      let first = '';
      let middle = '';
      let last = '';
      let suffix = '';
      if (fullName) {
        const parts = fullName.split(/\s+/).filter(Boolean);
        if (parts.length === 1) {
          first = parts[0];
        } else if (parts.length >= 2) {
          first = parts[0];
          last = parts[parts.length - 1];
          if (parts.length > 2) {
            middle = parts.slice(1, -1).join(' ');
          }
        }
      }
      if (firstInput) firstInput.value = first;
      if (lastInput) lastInput.value = last;
      if (middleInput) {
        const mi = middle.replace(/[^A-Za-z]/g, '').slice(0, 2);
        middleInput.value = mi;
      }
      if (suffixInput) suffixInput.value = suffix;
    }
    if (emailInput) emailInput.value = donor.email || '';
    const rawPhone = String(donor.contact_number || '').trim();
    if (hiddenPhoneInput) hiddenPhoneInput.value = rawPhone;
    const digits = rawPhone.replace(/\D/g, '');
    let area = '';
    let prefix = '';
    let line = '';
    if (digits.length === 11) {
      area = digits.slice(0, 4);
      prefix = digits.slice(4, 7);
      line = digits.slice(7, 11);
    }
    if (phoneAreaInput) phoneAreaInput.value = area;
    if (phonePrefixInput) phonePrefixInput.value = prefix;
    if (phoneLineInput) phoneLineInput.value = line;

    const address = String(donor.address || '').trim();
    let street = '';
    let brgy = '';
    let city = '';
    if (address) {
      const parts = address.split(',').map((p) => p.trim()).filter(Boolean);
      if (parts.length === 1) {
        brgy = parts[0];
      } else if (parts.length === 2) {
        brgy = parts[0];
        city = parts[1];
      } else if (parts.length >= 3) {
        street = parts[0];
        brgy = parts[1];
        city = parts.slice(2).join(', ');
      }
    }
    if (streetInput) streetInput.value = street;
    if (brgyInput) brgyInput.value = brgy;
    if (citySelect) {
      const options = Array.from(citySelect.options || []);
      const match = options.find((opt) => String(opt.value).trim() === city);
      citySelect.value = match ? city : '';
    }
    if (categorySel && window.$ && $.fn.select2) {
      const val = donor.donor_category_id || null;
      if (val) {
        const option = new Option(getDonorCategoryName(donor), val, true, true);
        $(categorySel).html(option).trigger('change');
      } else {
        $(categorySel).val(null).trigger('change');
      }
    }
    const modal = getModalInstance('editDonorModal');
    modal?.show();
  }

  async function updateDonorStatus(userId, status) {
    try {
      const res = await fetch(`${API_BASE_URL}/users/index.php?action=setStatus`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ user_id: Number(userId), status }),
      });
      const j = await res.json();
      if (!res.ok || !j?.success) throw new Error(j?.error || `HTTP ${res.status}`);
      const [freshDonors, freshDonations] = await Promise.all([ fetchDonors(), fetchDonations() ]);
      donorsData = freshDonors;
      donationsData = freshDonations;
      populateFilters();
      applyFiltersAndSort();
      try {
        showToast(`Donor ${status === "inactive" ? "deactivated" : "activated"} successfully.`, { title: 'Update Donor Status', variant: 'success' });
      } catch (_) {
        console.log(`Donor ${status === "inactive" ? "deactivated" : "activated"} successfully.`);
      }
    } catch (err) {
      try {
        showToast(`Failed to update donor status: ${err?.message || 'Unknown error'}`, { title: 'Update Donor Status', variant: 'danger' });
      } catch (_) {
        console.error('Failed to update donor status:', err);
      }
    }
  }

  document.addEventListener("click", (e) => {
    const edit = e.target.closest?.(".edit-btn");
    if (edit) {
      e.preventDefault();
      const id = Number(edit.getAttribute("data-user-id"));
      if (id) openEditDonor(id);
      return;
    }
    const deactivate = e.target.closest?.(".deactivate-btn");
    if (deactivate) {
      e.preventDefault();
      const id = Number(deactivate.getAttribute("data-user-id"));
      if (!id) return;
      updateDonorStatus(id, "inactive");
      return;
    }
    const activate = e.target.closest?.(".activate-btn");
    if (activate) {
      e.preventDefault();
      const id = Number(activate.getAttribute("data-user-id"));
      if (!id) return;
      updateDonorStatus(id, "approved");
    }
  });

  const editForm = document.getElementById('editDonorForm');
  if (editForm) {
    editForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!currentEditDonorId) return;
      const orgInput = document.getElementById('editDonorOrg');
      const hiddenNameInput = document.getElementById('editDonorName');
      const firstInput = document.getElementById('editDonorFirstName');
      const middleInput = document.getElementById('editDonorMiddleInitial');
      const lastInput = document.getElementById('editDonorLastName');
      const suffixInput = document.getElementById('editDonorSuffix');
      const emailInput = document.getElementById('editDonorEmail');
      const phoneAreaInput = document.getElementById('editDonorPhoneArea');
      const phonePrefixInput = document.getElementById('editDonorPhonePrefix');
      const phoneLineInput = document.getElementById('editDonorPhoneLine');
      const hiddenPhoneInput = document.getElementById('editDonorPhone');
      const streetInput = document.getElementById('editDonorAddress');
      const brgyInput = document.getElementById('editDonorBarangay');
      const citySelect = document.getElementById('editDonorCity');
      const fb = document.getElementById('editDonorFeedback');
      const categorySel = document.getElementById('editDonorCategory');
      const saveBtn = document.getElementById('editDonorSaveBtn');
      if (fb) fb.textContent = '';

      const FIRST_NAME_REGEX = /^[A-Za-z]+(?:[A-Za-z]*[0-9]+)?$/;
      const MIDDLE_INITIAL_REGEX = /^[A-Za-z]{0,2}$/;
      const LAST_NAME_REGEX = /^[A-Za-z]+(?:[ '-][A-Za-z]+)*$/;
      const CONTACT_NUMBER_REGEX = /^\(0\d{3}-\d{3}-\d{4}\)$/;

      const org = orgInput?.value.trim() || '';
      const first = firstInput?.value.trim() || '';
      const middle = middleInput?.value.trim() || '';
      const last = lastInput?.value.trim() || '';
      const suffix = suffixInput?.value.trim() || '';
      const email = emailInput?.value.trim() || '';
      const phoneArea = phoneAreaInput?.value.trim() || '';
      const phonePrefix = phonePrefixInput?.value.trim() || '';
      const phoneLine = phoneLineInput?.value.trim() || '';
      const street = streetInput?.value.trim() || '';
      const brgy = brgyInput?.value.trim() || '';
      const city = citySelect?.value.trim() || '';

      const showEditError = (message) => {
        if (fb) fb.textContent = message;
        try {
          showToast(message, { title: 'Edit Donor', variant: 'danger' });
        } catch (_) {
          console.warn('Toast unavailable:', message);
        }
      };

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

      if (!first) {
        showEditError('First name is required.');
        return;
      }
      if (!FIRST_NAME_REGEX.test(first)) {
        showEditError('First name must start with letters and may only include numbers at the end.');
        return;
      }
      if (middle && !MIDDLE_INITIAL_REGEX.test(middle)) {
        showEditError('Middle initial may only contain up to two letters.');
        return;
      }
      if (!last) {
        showEditError('Last name is required.');
        return;
      }
      if (!LAST_NAME_REGEX.test(last)) {
        showEditError('Last name may only include letters, spaces, hyphens, or apostrophes.');
        return;
      }

      const composedName = composeFullName();
      if (hiddenNameInput && composedName) {
        hiddenNameInput.value = composedName;
      }
      const name = composedName || hiddenNameInput?.value.trim() || '';

      if (!org && !name) {
        showEditError('Organization Name or Contact Person is required.');
        return;
      }
      if (!email) {
        showEditError('Email is required.');
        return;
      }
      if (!isValidEmail(email)) {
        showEditError('Please enter a valid email address.');
        return;
      }
      if (!phoneArea || !phonePrefix || !phoneLine) {
        showEditError('Complete all contact number fields.');
        return;
      }
      const composedPhone = `(${phoneArea}-${phonePrefix}-${phoneLine})`;
      if (hiddenPhoneInput) hiddenPhoneInput.value = composedPhone;
      if (!CONTACT_NUMBER_REGEX.test(composedPhone)) {
        showEditError('Contact number must follow the format (09XX-XXX-XXXX).');
        return;
      }
      if (!brgy) {
        showEditError('Barangay is required.');
        return;
      }
      if (!city) {
        showEditError('City / Municipality is required.');
        return;
      }

      const addressParts = [street, brgy, city].filter(Boolean);
      const address = addressParts.join(', ');

      const payload = {
        user_id: Number(currentEditDonorId),
        organization_name: org || null,
        name: name || null,
        email: email || null,
        contact_number: composedPhone || null,
        address: address || null,
        donor_category_id: categorySel && $(categorySel).val() ? Number($(categorySel).val()) : null,
      };
      if (saveBtn) saveBtn.disabled = true;
      try {
        const res = await fetch(`${API_BASE_URL}/users/index.php?action=adminUpdateProfile`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(payload),
        });
        const j = await res.json();
        if (!res.ok || !j?.success) throw new Error(j?.error || `HTTP ${res.status}`);
        currentEditDonorId = null;
        getModalInstance('editDonorModal')?.hide();
        const [freshDonors, freshDonations] = await Promise.all([ fetchDonors(), fetchDonations() ]);
        donorsData = freshDonors;
        donationsData = freshDonations;
        populateFilters();
        applyFiltersAndSort();
        try {
          showToast('Donor updated successfully.', { title: 'Edit Donor', variant: 'success' });
        } catch (_) {
          console.log('Donor updated successfully.');
        }
      } catch (err) {
        if (fb) fb.textContent = err?.message || 'Failed to update donor';
        try {
          showToast(err?.message || 'Failed to update donor', { title: 'Edit Donor', variant: 'danger' });
        } catch (_) {
          console.error('Failed to update donor:', err);
        }
      } finally {
        if (saveBtn) saveBtn.disabled = false;
      }
    });
  }
});
