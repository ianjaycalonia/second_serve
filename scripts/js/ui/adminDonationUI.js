// AdminDonationUI.js (old-school global). Consolidated helpers, rendering, bindings, and init.
(function () {
  "use strict";
  const Api = window.AdminDonationApi || {};

  // Cache + state
  const donationCache = { byBatch: new Map(), byId: new Map() };
  let __pollTimer = 0,
    __lastSig = "",
    __page = 1,
    __pageSize = 20;

  // Helpers
  function getEl(id) {
    return document.getElementById(id);
  }
  function notifyToast(message, type){
    try{
      const cont = ensureToastContainer();
      const toast = document.createElement('div');
      const bg = type === 'success' ? 'bg-success' : type === 'warning' ? 'bg-warning' : type === 'info' ? 'bg-info' : 'bg-danger';
      const textClass = (type === 'warning' || type === 'info') ? 'text-dark' : 'text-white';
      const closeClass = textClass === 'text-white' ? 'btn-close btn-close-white' : 'btn-close';
      toast.className = 'toast align-items-center ' + textClass + ' border-0 ' + bg;
      toast.setAttribute('role','alert'); toast.setAttribute('aria-live','assertive'); toast.setAttribute('aria-atomic','true');
      toast.innerHTML = `<div class="d-flex"><div class="toast-body">${(message||'').toString()}</div><button type="button" class="${closeClass} me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button></div>`;
      cont && cont.appendChild(toast);
      if (window.bootstrap?.Toast) { new bootstrap.Toast(toast, { delay: 2500 }).show(); }
      else { toast.style.display='block'; setTimeout(()=>{ try{ toast.remove(); }catch(_){} }, 3000); }
    } catch(_) { }
  }
  function ensureToastContainer() {
    try {
      let cont = document.getElementById('globalToastContainer');
      if (!cont) {
        cont = document.createElement('div');
        cont.id = 'globalToastContainer';
        cont.className = 'toast-container position-fixed top-0 end-0 p-3';
        try { cont.style.zIndex = '1085'; } catch(_) {}
        document.body.appendChild(cont);
      }
      return cont;
    } catch (_) { return null; }
  }
  function showError(message){
    try{
      const cont = ensureToastContainer();
      const toast = document.createElement('div');
      toast.className = 'toast align-items-center text-white bg-danger border-0';
      toast.setAttribute('role','alert'); toast.setAttribute('aria-live','assertive'); toast.setAttribute('aria-atomic','true');
      toast.innerHTML = `<div class="d-flex"><div class="toast-body">${(message||'').toString()}</div><button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button></div>`;
      cont && cont.appendChild(toast);
      if (window.bootstrap?.Toast) { new bootstrap.Toast(toast, { delay: 2500 }).show(); }
      else { toast.style.display='block'; setTimeout(()=>{ try{ toast.remove(); }catch(_){} }, 3000); }
    } catch(_) { try { console.error(message); } catch(_){} }
  }
  // debounce helper
  function debounce(fn, wait) {
    let t;
    return function (...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), wait);
    };
  }
  function cleanupModals() {
    try {
      document.querySelectorAll(".modal-backdrop").forEach((n) => n.remove());
      document.body.classList.remove("modal-open");
      document.body.style.removeProperty("overflow");
      document.body.style.removeProperty("padding-right");
    } catch (_) {}
  }
  // Date helpers: format to yyyy-mm-dd for <input type=date>
  function toISODate(d) {
    try {
      if (!d) return "";
      const dt = d instanceof Date ? d : new Date(d);
      if (isNaN(dt)) return "";
      const y = dt.getFullYear();
      const m = String(dt.getMonth() + 1).padStart(2, "0");
      const day = String(dt.getDate()).padStart(2, "0");
      return `${y}-${m}-${day}`;
    } catch (_) {
      return "";
    }
  }

  async function compressImageIfPossible(file, overrides) {
    if (!(file instanceof File)) return file;
    const compressor = window.imageCompression;
    if (typeof compressor !== "function") return file;
    const defaults = {
      maxSizeMB: 1.2,
      maxWidthOrHeight: 1600,
      useWebWorker: true,
      initialQuality: 0.8,
      fileType: file.type || "image/jpeg",
    };
    const options = overrides ? Object.assign({}, defaults, overrides) : defaults;
    try {
      const compressed = await compressor(file, options);
      return compressed instanceof File
        ? compressed
        : new File([compressed], file.name, { type: options.fileType });
    } catch (err) {
      if (window.__DEBUG) console.warn("[Donations] image compression failed", err);
      return file;
    }
  }

  async function buildCompressedFormData(form) {
    const original = new FormData(form);
    const result = new FormData();
    for (const [key, value] of original.entries()) {
      if (value instanceof File && value.size > 0 && /^image\//i.test(value.type)) {
        const compressed = await compressImageIfPossible(value);
        result.append(key, compressed, compressed.name || value.name);
      } else {
        result.append(key, value);
      }
    }
    return result;
  }
  // Ensure cleanup runs whenever any Bootstrap modal finishes hiding
  try {
    document.addEventListener(
      "hidden.bs.modal",
      function () {
        cleanupModals();
      },
      true
    );
    // When a modal is shown, ensure we don't accumulate multiple backdrops
    document.addEventListener(
      "shown.bs.modal",
      function () {
        try {
          const backs = Array.from(
            document.querySelectorAll(".modal-backdrop")
          );
          // Keep only the last backdrop if multiples exist
          if (backs.length > 1) {
            backs.slice(0, backs.length - 1).forEach((n) => n.remove());
          }
        } catch (_) {}
      },
      true
    );
  } catch (_) {}
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
  function escapeHtml(s) {
    return (s || "").replace(
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
  function decodeHtml(s) {
    try {
      // Use the browser to decode existing entities like &#039; or &amp;
      const el = document.createElement("textarea");
      el.innerHTML = String(s || "");
      return el.value;
    } catch (_) {
      return String(s || "");
    }
  }
  function capFirst(s) {
    if (!s) return "";
    s = String(s);
    return s[0].toUpperCase() + s.slice(1);
  }
  function fmtDateTime(s) {
    if (!s) return "";
    const d = new Date(s);
    return isNaN(d) ? s : d.toLocaleString();
  }
  function groupByBatch(items) {
    const m = new Map();
    for (const r of items) {
      const k = r.batch_id ? `b-${r.batch_id}` : `s-${r.id}`;
      if (!m.has(k))
        m.set(k, {
          batch_id: r.batch_id || null,
          items: [],
          created_at: r.created_at,
        });
      m.get(k).items.push(r);
      const g = m.get(k);
      if (!g.created_at || (r.created_at && r.created_at > g.created_at))
        g.created_at = r.created_at;
    }
    return [...m.values()];
  }

  // Sort helpers (driven by Sort dropdown Apply button)
  function readSort() {
    const date = (getEl("sortDate")?.value || "").trim();
    const itemName = (getEl("sortItemName")?.value || "").trim();
    const quantity = (getEl("sortQuantity")?.value || "").trim();
    const organization = (getEl("sortOrganization")?.value || "").trim();
    return { date, itemName, quantity, organization };
  }
  function sortGroups(groups) {
    const s = readSort();
    const out = Array.isArray(groups) ? groups.slice() : [];
    if (!out.length) return out;

    function safeStr(v) {
      return (v == null ? "" : String(v)).toLowerCase();
    }
    function groupOrg(g) {
      const first = (g && g.items && g.items[0]) || {};
      return first.donor_org || first.organization_name || "";
    }
    function groupItemName(g) {
      const first = (g && g.items && g.items[0]) || {};
      return first.name || "";
    }
    function groupQty(g) {
      try {
        return (Array.isArray(g.items) ? g.items : []).reduce(
          (sum, it) => sum + (Number(it.quantity) || 0),
          0
        );
      } catch (_) {
        return 0;
      }
    }

    if (s.date) {
      const dir = s.date === "asc" ? 1 : -1;
      out.sort((a, b) =>
        dir * (safeStr(a.created_at).localeCompare(safeStr(b.created_at)))
      );
    } else if (s.organization) {
      const dir = s.organization === "asc" ? 1 : -1;
      out.sort((a, b) =>
        dir * safeStr(groupOrg(a)).localeCompare(safeStr(groupOrg(b)))
      );
    } else if (s.itemName) {
      const dir = s.itemName === "asc" ? 1 : -1;
      out.sort((a, b) =>
        dir * safeStr(groupItemName(a)).localeCompare(safeStr(groupItemName(b)))
      );
    } else if (s.quantity) {
      const dir = s.quantity === "asc" ? 1 : -1;
      out.sort((a, b) => dir * (groupQty(a) - groupQty(b)));
    } else {
      // Default: latest created first
      out.sort((a, b) =>
        safeStr(b.created_at).localeCompare(safeStr(a.created_at))
      );
    }
    return out;
  }

  // Rendering
  function renderTable(items) {
    const tbody = document.querySelector("main .table tbody");
    if (!tbody) return;
    if (!items.length) {
      tbody.innerHTML =
        '<tr><td colspan="7" class="text-center py-4">No donations match the current filters.</td></tr>';
      updatePagination(0);
      return;
    }
    const baseGroups = groupByBatch(items);
    const groups = sortGroups(baseGroups);
    const totalGroups = groups.length;
    const pageSize = __pageSize || 20;
    const totalPages =
      totalGroups > 0 ? Math.max(1, Math.ceil(totalGroups / pageSize)) : 1;
    if (__page < 1) __page = 1;
    if (__page > totalPages) __page = totalPages;
    donationCache.byBatch.clear();
    donationCache.byId.clear();
    groups.forEach((g) => {
      if (g.batch_id && g.items.length > 1) {
        donationCache.byBatch.set(g.batch_id, g.items.slice());
        g.items.forEach((it) => {
          if (it?.id) donationCache.byId.set(String(it.id), it);
        });
      } else if (g.items[0]?.id) {
        donationCache.byId.set(String(g.items[0].id), g.items[0]);
      }
    });

    const startIdx = (__page - 1) * pageSize;
    const endIdx = startIdx + pageSize;
    const pageGroups = totalGroups > 0 ? groups.slice(startIdx, endIdx) : [];

    const rows = [];
    pageGroups.forEach((gr) => {
      const isBatch = !!gr.batch_id && gr.items.length > 1;
      if (isBatch) {
        const first = gr.items[0] || {},
          donor = escapeHtml(decodeHtml(first.donor_org || "—")),
          created = fmtDateTime(gr.created_at),
          statusHtml = badge(first.status || "");
        const da = `data-batch="${gr.batch_id}" data-status="${
          first.status ?? ""
        }"`;
        const fwi =
            gr.items.find(
              (it) => it && (it.receipt_full_url || it.image_full_url)
            ) || first,
          img = fwi.receipt_full_url || fwi.image_full_url || "",
          hasReceiptImage = gr.items.some(
            (it) => ((it?.receipt_full_url || it?.image_full_url || "").trim().length) > 0
          );
        const isFailed = (first.status || "") === "Failed Safety",
          isCancelled = (first.status || "") === "Cancelled",
          fail = (first.fail_reason || "").trim(),
          cancel = (first.cancel_reason || "").trim();
        const showReceipt =
          first.status === "Picked Up" || first.status === "Completed";
        const showImportedMsg = (items) =>
          (items || []).some(
            (it) => String(it?.source || "").toLowerCase() === "imported"
          );
        const missingReceiptLabel = showImportedMsg(gr.items)
          ? "Imported by an admin"
          : "Imported by an admin";
        const canAttemptView = hasReceiptImage;
        const viewBtnHtml = canAttemptView
          ? `<div class="d-flex justify-content-center" style="gap:5px;"><button class="btn btn-sm btn-outline-secondary view-image-btn" data-img="${img}" ${da} title="View receipt image" data-bs-toggle="tooltip">View</button></div>`
          : "";
        let imgCell = '';
        if (isCancelled && cancel) {
          imgCell = `<div class="small text-muted text-center">${escapeHtml(decodeHtml(cancel))}</div>`;
        } else if (isFailed) {
          imgCell = `<div class="small text-danger text-center">${escapeHtml(decodeHtml(fail || "Failed safety check"))}</div>`;
        } else if (canAttemptView) {
          imgCell = viewBtnHtml;
        } else if (showReceipt) {
          imgCell = `<div class="small text-muted text-center">${escapeHtml(decodeHtml(missingReceiptLabel))}</div>`;
        } else {
          imgCell = '<div class="d-flex justify-content-center">—</div>';
        }
        const actions = [
          '<button class="btn btn-sm btn-outline-secondary batch-toggle" type="button" title="Toggle batch items" data-bs-toggle="tooltip"><i class="bi bi-eye"></i></button>'
        ];
        if (first.status === "Pending")
          actions.push(
            `<button class="btn btn-sm btn-outline-primary action-ack" ${da} title="Acknowledge donation" data-bs-toggle="tooltip"><i class="bi bi-hand-thumbs-up"></i></button>`
          );
        if (first.status === "Acknowledged")
          actions.push(
            `<button class="btn btn-sm btn-outline-warning action-fs" ${da} title="Perform safety check" data-bs-toggle="tooltip"><i class="bi bi-clipboard-check"></i></button>`
          );
        if (first.status === "Picked Up")
          actions.push(
            `<button class="btn btn-sm btn-outline-success action-receive" ${da} title="Mark as received" data-bs-toggle="tooltip"><i class="bi bi-check2-circle"></i></button>`
          );
        actions.push(
          `<button class="btn btn-sm btn-outline-danger action-delete" ${da} title="Delete donation" data-bs-toggle="tooltip"><i class="bi bi-trash"></i></button>`
        );
        rows.push(`
          <tr class="table-active group-row" data-batch-id="${gr.batch_id}">
            <td class="py-2 align-middle">${donor}</td>
            <td class="py-2"><div class="fw-semibold">Batch • ${
              gr.items.length
            } item${gr.items.length > 1 ? "s" : ""}</div></td>
            <td class="py-2 align-middle">—</td>
            <td class="py-2 align-middle">${created}</td>
            <td class="py-2 align-middle">${statusHtml}</td>
            <td class="py-2 align-middle">${imgCell}</td>
            <td class="py-2 align-middle"><div class="d-flex justify-content-center" style="gap:5px;">${actions.join(
              ""
            )}</div></td>
          </tr>
          <tr class="child-container d-none" data-batch-id="${gr.batch_id}">
            <td colspan="7" class="p-0">
              <table class="table table-sm mb-0">
                <thead><tr class="table-light"><th>Item</th><th>Type</th><th>Qty</th><th>Expiry</th><th>Status</th></tr></thead>
                <tbody>
                  ${gr.items
                    .map(
                      (r) =>
                        `<tr><td>${escapeHtml(
                          decodeHtml(r.name || "")
                        )}</td><td>${escapeHtml(
                          decodeHtml(capFirst(r.type || ""))
                        )}</td><td>${r.quantity ?? ""}</td><td>${escapeHtml(
                          decodeHtml(r.expiry_date || "")
                        )}</td><td>${badge(r.status)}</td></tr>`
                    )
                    .join("")}
                </tbody>
              </table>
            </td>
          </tr>`);
      } else {
        const r = gr.items[0],
          donor = escapeHtml(decodeHtml(r.donor_org || "—")),
          item = escapeHtml(decodeHtml(r.name || "")),
          qty = (r.quantity ?? "") + "",
          created = fmtDateTime(gr.created_at),
          statusHtml = badge(r.status || ""),
          img = r.receipt_full_url || r.image_full_url || "",
          hasReceiptImage = (img || "").trim().length > 0,
          batch = r.batch_id ? String(r.batch_id) : "";
        const isFailed = (r.status || "") === "Failed Safety",
          fail = (r.fail_reason || "").trim(),
          showReceipt = r.status === "Picked Up" || r.status === "Completed",
          isCancelled = (r.status || "") === "Cancelled",
          cancel = (r.cancel_reason || "").trim(),
          needFail = isFailed && !fail;
        const missingReceiptLabel =
          String(r?.source || "").toLowerCase() === "imported"
            ? "Imported by an admin"
            : "Imported by an admin";
        const canAttemptViewSingle = hasReceiptImage;
        const viewBtnHtmlSingle = canAttemptViewSingle
          ? `<div class="d-flex justify-content-center" style="gap:5px;"><button class="btn btn-sm btn-outline-secondary view-image-btn" data-img="${img}" data-id="${
              r.id ?? ""
            }" data-batch="${batch}" data-status="${
              r.status ?? ""
            }" title="View receipt image" data-bs-toggle="tooltip">View</button></div>`
          : "";
        const failHtml = `<div class="small text-danger text-center" ${
          needFail ? `data-need-fail-reason="1" data-id="${r.id ?? ""}"` : ""
        }>${escapeHtml(decodeHtml(fail || "Failed safety check"))}</div>`;
        let imgCell = '';
        if (isCancelled && cancel) {
          imgCell = `<div class="small text-muted text-center">${escapeHtml(decodeHtml(cancel))}</div>`;
        } else if (isFailed) {
          imgCell = failHtml;
        } else if (canAttemptViewSingle) {
          imgCell = viewBtnHtmlSingle;
        } else if (showReceipt) {
          imgCell = `<div class="small text-muted text-center">${escapeHtml(decodeHtml(missingReceiptLabel))}</div>`;
        } else {
          imgCell = '<div class="d-flex justify-content-center">—</div>';
        }
        const da = `data-id="${
          r.id ?? ""
        }" data-batch="${batch}" data-status="${r.status ?? ""}"`;
        const actions = [];
        if (r.status === "Pending")
          actions.push(
            `<button class="btn btn-sm btn-outline-primary action-ack" ${da} title="Acknowledge donation" data-bs-toggle="tooltip"><i class="bi bi-hand-thumbs-up"></i></button>`
          );
        if (r.status === "Acknowledged")
          actions.push(
            `<button class="btn btn-sm btn-outline-warning action-fs" ${da} title="Perform safety check" data-bs-toggle="tooltip"><i class="bi bi-clipboard-check"></i></button>`
          );
        if (r.status === "Picked Up")
          actions.push(
            `<button class="btn btn-sm btn-outline-success action-receive" ${da} title="Mark as received" data-bs-toggle="tooltip"><i class="bi bi-check2-circle"></i></button>`
          );
        actions.push(
          `<button class="btn btn-sm btn-outline-danger action-delete" ${da} title="Delete donation" data-bs-toggle="tooltip"><i class="bi bi-trash"></i></button>`
        );
        rows.push(
          `<tr><td>${donor}</td><td>${item}</td><td>${qty}</td><td>${created}</td><td>${statusHtml}</td><td>${imgCell}</td><td><div class="d-flex justify-content-center" style="gap:5px;">${actions.join(
            ""
          )}</div></td></tr>`
        );
      }
    });
    tbody.innerHTML = rows.join("");

    updatePagination(totalGroups);

    // fill missing fail reasons
    try {
      tbody
        .querySelectorAll('[data-need-fail-reason="1"][data-id]')
        .forEach(async (el) => {
          const id = el.getAttribute("data-id");
          if (!id) return;
          try {
            const row = await Api.fetchDonationDetail(id);
            const reason =
              row && row.fail_reason ? String(row.fail_reason).trim() : "";
            if (reason) el.textContent = reason;
          } catch (_) {}
        });
    } catch (_) {}
  }

  function updatePagination(totalCount) {
    try {
      const pager = getEl("donationsPagination");
      const sizeSelect = getEl("donationsPageSize");
      if (sizeSelect) {
        const val = String(__pageSize || 20);
        if (sizeSelect.value !== val) sizeSelect.value = val;
      }
      if (!pager) return;
      const pageSize = __pageSize || 20;
      const totalPages =
        totalCount > 0 ? Math.max(1, Math.ceil(totalCount / pageSize)) : 1;
      const currentPage = totalCount > 0 ? __page : 0;

      pager.innerHTML = "";

      const makeLi = (disabled, page, label, aria, title) => {
        const li = document.createElement("li");
        li.className = "page-item" + (disabled ? " disabled" : "");
        if (disabled || page === null) {
          li.innerHTML = `<span class="page-link">${label}</span>`;
        } else {
          li.innerHTML = `<button class="page-link" type="button" data-page="${page}" aria-label="${aria}" title="${title}">${label}</button>`;
        }
        return li;
      };

      const prevDisabled = currentPage <= 1 || !totalCount;
      pager.appendChild(
        makeLi(prevDisabled, currentPage - 1, "«", "Previous", "Previous page")
      );

      const infoLabel =
        totalCount > 0
          ? "Page " + currentPage + " of " + totalPages
          : "Page 0 of 0";
      pager.appendChild(makeLi(true, null, infoLabel, "", ""));

      const nextDisabled =
        !totalCount || currentPage >= totalPages || currentPage === 0;
      pager.appendChild(
        makeLi(nextDisabled, currentPage + 1, "»", "Next", "Next page")
      );
    } catch (_) {}
  }

  // Filters
  function readFilters() {
    const donor = (
      getEl("filterOrgSelect")?.value ||
      getEl("donationsDonorSelectDesktop")?.value ||
      getEl("donationsDonorSelectMobile")?.value ||
      ""
    ).trim();
    const status = (
      getEl("filterStatusSelect")?.value ||
      getEl("donationsStatusSelectDesktop")?.value ||
      getEl("donationsStatusSelectMobile")?.value ||
      ""
    ).trim();
    const category = (
      getEl("donationsCategorySelectDesktop")?.value ||
      getEl("donationsCategorySelectMobile")?.value ||
      ""
    ).trim();
    const date = (
      getEl("donationsDateSelectDesktop")?.value ||
      getEl("donationsDateSelectMobile")?.value ||
      ""
    ).trim();
    const search = (getEl("donationSearch")?.value || "").trim();
    const source = (getEl("filterSourceSelect")?.value || "").trim();
    const hasBatch = !!getEl("checkIsBatch")?.checked;
    const hasReceipt = !!getEl("checkHasReceipt")?.checked;
    const from = (getEl("fromDate")?.value || "").trim();
    const to = (getEl("toDate")?.value || "").trim();
    return { donor, status, category, date, search, from, to, source, hasBatch, hasReceipt };
  }
  function applyFilters(items) {
    const f = readFilters();
    let out = Array.isArray(items) ? items.slice() : [];
    if (f.donor && f.donor.toLowerCase() !== "all") {
      const q = f.donor.toLowerCase();
      out = out.filter((r) =>
        (r.donor_org || r.organization_name || "").toLowerCase().includes(q)
      );
    }
    if (f.status && f.status.toLowerCase() !== "all") {
      out = out.filter(
        (r) => (r.status || "").toLowerCase() === f.status.toLowerCase()
      );
    }
    if (f.category && !["all", "other"].includes(f.category.toLowerCase())) {
      out = out.filter(
        (r) => (r.type || "").toLowerCase() === f.category.toLowerCase()
      );
    }
    if (f.date) {
      const now = new Date(),
        today = now.toISOString().slice(0, 10);
      if (f.date === "Today") {
        out = out.filter((r) => {
          const d = r.created_at ? new Date(r.created_at) : null;
          return d && !isNaN(d) && d.toISOString().slice(0, 10) === today;
        });
      } else if (f.date === "This Week") {
        const s = new Date(now);
        s.setDate(now.getDate() - 6);
        s.setHours(0, 0, 0, 0);
        out = out.filter((r) => {
          const d = r.created_at ? new Date(r.created_at) : null;
          return d && !isNaN(d) && d >= s && d <= now;
        });
      } else if (f.date === "This Month") {
        const s = new Date(now.getFullYear(), now.getMonth(), 1),
          e = new Date(
            now.getFullYear(),
            now.getMonth() + 1,
            0,
            23,
            59,
            59,
            999
          );
        out = out.filter((r) => {
          const d = r.created_at ? new Date(r.created_at) : null;
          return d && !isNaN(d) && d >= s && d <= e;
        });
      }
    }
    // Search box: match donor organization OR item name
    if (f.search && String(f.search).trim() !== "") {
      const q = String(f.search).toLowerCase();
      out = out.filter((r) => {
        const donor = (r.donor_org || r.organization_name || "").toLowerCase();
        const name = (r.name || "").toLowerCase();
        return donor.includes(q) || name.includes(q);
      });
    }
    // Date range filter (from/to) - ISO YYYY-MM-DD
    if (f.from || f.to) {
      const fFrom = f.from ? new Date(f.from) : null;
      const fTo = f.to ? new Date(f.to) : null;
      out = out.filter((r) => {
        const created = r.created_at ? new Date(r.created_at) : null;
        if (!created || isNaN(created)) return false;
        if (
          fFrom &&
          created <
            new Date(fFrom.getFullYear(), fFrom.getMonth(), fFrom.getDate())
        )
          return false;
        if (fTo) {
          // include entire 'to' day
          const toEnd = new Date(
            fTo.getFullYear(),
            fTo.getMonth(),
            fTo.getDate(),
            23,
            59,
            59,
            999
          );
          if (created > toEnd) return false;
        }
        return true;
      });
    }
    // Properties: batch-only and has receipt
    if (f.hasBatch) {
      out = out.filter((r) => !!r.batch_id);
    }
    if (f.hasReceipt) {
      out = out.filter(
        (r) =>
          (r.receipt_full_url || r.image_full_url || "").toString().trim() !==
          ""
      );
    }
    if (f.source) {
      const src = String(f.source).toLowerCase();
      out = out.filter(
        (r) => String(r.source || "").toLowerCase() === src
      );
    }
    return out;
  }
  async function populateCategorySelects(items) {
    try {
      const desktop = getEl("donationsCategorySelectDesktop"),
        mobile = getEl("donationsCategorySelectMobile");
      const FIXED = [
        "Bakery",
        "Beverage - Juices/Coffee/Tea",
        "Beverage - Sweetened Beverages",
        "Beverage - Water",
        "Confectionary",
        "Dairy",
        "Fats & Oils",
        "Fruits & Vegetables",
        "Grains/Grain Products",
        "Non-Food - Baby Products",
        "Non-Food - Cleaning Products",
        "Non-Food - Others",
        "Non-Food - Personal Hygiene",
        "Non-Food - Pet Food",
        "Prepared Foods",
        "Processed Cereals/ Cereal Products",
        "Protein-Animal Based",
        "Ready-To-Eat Savories",
        "Sauces/Condiments/Seasonings",
        "Special Nutritional Uses",
        "Sweeteners",
      ];
      const dynamic = [
        ...new Set(
          (Array.isArray(items) ? items : [])
            .map((it) =>
              it && typeof it.type === "string" ? it.type.trim() : ""
            )
            .filter((v) => v && v.toLowerCase() !== "all")
        ),
      ];
      const seen = new Set(),
        merged = [];
      const pu = (l) => {
        const k = String(l).toLowerCase();
        if (!seen.has(k)) {
          seen.add(k);
          merged.push(l);
        }
      };
      FIXED.forEach(pu);
      dynamic.forEach(pu);
      [desktop, mobile].forEach((sel) => {
        if (!sel) return;
        const prev = sel.value || "All";
        const frag = document.createDocumentFragment();
        const opt = document.createElement("option");
        opt.value = opt.textContent = "All";
        frag.appendChild(opt);
        merged.forEach((l) => {
          const o = document.createElement("option");
          o.value = o.textContent = l;
          frag.appendChild(o);
        });
        sel.innerHTML = "";
        sel.appendChild(frag);
        sel.value = [...sel.options].some((o) => o.value === prev)
          ? prev
          : "All";
      });
    } catch (e) {
      console.warn("populateCategorySelects failed:", e);
    }
  }
  async function populateDonorSelects(items) {
    const desktop = getEl("donationsDonorSelectDesktop"),
      mobile = getEl("donationsDonorSelectMobile");
    function build(labels) {
      const uniq = [...new Set(labels.filter(Boolean))].sort((a, b) =>
        a.localeCompare(b)
      );
      [desktop, mobile].forEach((sel) => {
        if (!sel) return;
        const prev = sel.value || "All";
        const frag = document.createDocumentFragment();
        const opt = document.createElement("option");
        opt.value = opt.textContent = "All";
        frag.appendChild(opt);
        uniq.forEach((l) => {
          const o = document.createElement("option");
          o.value = o.textContent = l;
          frag.appendChild(o);
        });
        sel.innerHTML = "";
        sel.appendChild(frag);
        sel.value = [...sel.options].some((o) => o.value === prev)
          ? prev
          : "All";
      });
    }
    try {
      const labelsFromItems = (Array.isArray(items) ? items : [])
        .map((r) => (r.donor_org || r.organization_name || "").trim())
        .filter(Boolean);
      build(labelsFromItems);
      const users = await Api.listApprovedDonors();
      const labelsFromUsers = users
        .map((u) =>
          u.organization_name && u.organization_name.trim()
            ? u.organization_name.trim()
            : (u.name || "").trim()
        )
        .filter(Boolean);
      build([...new Set([...(labelsFromItems || []), ...labelsFromUsers])]);
    } catch (err) {
      console.warn(
        "Donor users list fetch failed; using donor names from items only:",
        err
      );
    }
  }
  function populateOrgFilter(items) {
    try {
      const sel = getEl("filterOrgSelect");
      if (!sel) return;
      const labels = [
        ...new Set(
          (Array.isArray(items) ? items : [])
            .map((r) => (r.donor_org || r.organization_name || "").trim())
            .filter(Boolean)
        ),
      ].sort((a, b) => a.localeCompare(b));
      const prev = sel.value || "";
      const frag = document.createDocumentFragment();
      const optAll = document.createElement("option");
      optAll.value = "";
      optAll.textContent = "All";
      frag.appendChild(optAll);
      labels.forEach((l) => {
        const o = document.createElement("option");
        o.value = l;
        o.textContent = l;
        frag.appendChild(o);
      });
      sel.innerHTML = "";
      sel.appendChild(frag);
      sel.value = [...sel.options].some((o) => o.value === prev) ? prev : "";
    } catch (e) {
      console.warn("populateOrgFilter failed:", e);
    }
  }

  // Auto refresh
  function anyModalOpen() {
    try {
      return !!document.querySelector(".modal.show");
    } catch (_) {
      return false;
    }
  }
  function expandedBatches() {
    const ids = [];
    document.querySelectorAll("tr.child-container").forEach((tr) => {
      const id = tr.getAttribute("data-batch-id");
      if (id && !tr.classList.contains("d-none")) ids.push(id);
    });
    return ids;
  }
  function restoreExpanded(ids) {
    ids.forEach((bid) => {
      const child = document.querySelector(
        `tr.child-container[data-batch-id="${bid}"]`
      );
      const btn = document.querySelector(
        `tr.group-row[data-batch-id="${bid}"] .batch-toggle`
      );
      if (child && child.classList.contains("d-none"))
        child.classList.remove("d-none");
      if (btn) {
        const icon = btn.querySelector("i.bi");
        if (icon) icon.className = "bi bi-eye-slash";
      }
    });
  }
  function sig(items) {
    try {
      return (Array.isArray(items) ? items : [])
        .map((it) =>
          [
            it.id || "",
            it.batch_id || "",
            it.status || "",
            it.fail_reason || "",
          ].join(":")
        )
        .sort()
        .join("|");
    } catch (_) {
      return "";
    }
  }
  async function refreshOnce() {
    try {
      const items = await Api.fetchAdminList();
      window.__adminDonationRaw = Array.isArray(items) ? items.slice() : [];
      try {
        await populateCategorySelects(window.__adminDonationRaw);
      } catch (_) {}
      try {
        populateOrgFilter(window.__adminDonationRaw);
      } catch (_) {}
      const filtered = applyFilters(window.__adminDonationRaw);
      const s = sig(filtered);
      if (s === __lastSig || anyModalOpen()) return;
      const open = expandedBatches();
      renderTable(filtered);
      restoreExpanded(open);
      __lastSig = s;
    } catch (_) {}
  }
  function startDonationAutoRefresh() {
    if (__pollTimer) return;
    try {
      __lastSig = sig(applyFilters(window.__adminDonationRaw || []));
    } catch (_) {
      __lastSig = "";
    }
    __pollTimer = window.setInterval(refreshOnce, 10000);
    refreshOnce();
  }

  // Modals / next steps
  function showAckNextStepsModal(donorId, donorTitle) {
    try {
      (async () =>
        (await Api.getUserPref("ackNextStepsDontShow")) === "1")().then(
        (skip) => {
          if (skip) return;
          const el = getEl("ackNextStepsModal"),
            msg = getEl("messagesModal");
          if (!el || typeof bootstrap === "undefined" || !bootstrap.Modal)
            return;
          try {
            document
              .querySelectorAll(".modal-backdrop")
              .forEach((n) => n.remove());
            document.body.classList.remove("modal-open");
            document.body.style.removeProperty("overflow");
            document.body.style.removeProperty("padding-right");
          } catch (_) {}
          const m = bootstrap.Modal.getOrCreateInstance(el),
            open = getEl("ackOpenMessagesBtn"),
            schedule = getEl("ackSchedulePickupBtn"),
            chk = getEl("ackDontShowAgain");
          if (chk) chk.checked = false;
          if (open) {
            open.onclick = async () => {
              try {
                if (chk?.checked) {
                  await Api.setUserPref("ackNextStepsDontShow", "1");
                }
                if (msg && bootstrap?.Modal) {
                  bootstrap.Modal.getOrCreateInstance(msg).show();
                }
                m.hide();
              } catch (_) {
                // Fallback: open modal only
                if (msg && bootstrap?.Modal) {
                  bootstrap.Modal.getOrCreateInstance(msg).show();
                }
              }
            };
          }
          if (schedule)
            schedule.onclick = async () => {
              try {
                if (chk && chk.checked)
                  await Api.setUserPref("ackNextStepsDontShow", "1");
              } catch (_) {}
              const params = new URLSearchParams({ from: "donation" });
              if (Number.isFinite(Number(donorId)) && Number(donorId) > 0) {
                params.set("donorId", String(donorId));
              }
              if (donorTitle) {
                params.set("donorName", donorTitle);
              }
              try {
                m.hide();
              } catch (_) {}
              window.location.href = `schedule.html?${params.toString()}`;
            };
          m.show();
        }
      );
    } catch (_) {}
  }

  // Bindings
  function bindImageViewer() {
    document.addEventListener("click", async (e) => {
      const btn = e.target.closest(".view-image-btn");
      if (!btn) return;
      const modalEl = getEl("imageViewerModal"),
        img = getEl("imageViewerImg"),
        info = getEl("imageViewerInfo");
      if (!(modalEl && typeof bootstrap !== "undefined" && bootstrap.Modal))
        return;
      const m = bootstrap.Modal.getOrCreateInstance(modalEl);
      if (img) {
        img.style.transform = "scale(1)";
        img.src = "";
        img.alt = "Loading receipt...";
      }
      if (info) info.textContent = "Loading image...";
      m.show();
      const batch = btn.getAttribute("data-batch") || "",
        id = btn.getAttribute("data-id") || "";
      let src = btn.getAttribute("data-img") || "";
      if (!src && (batch || id)) {
        try {
          if (batch && donationCache.byBatch.has(batch)) {
            const arr = donationCache.byBatch.get(batch) || [];
            const any = arr.find(
              (it) => it && (it.receipt_full_url || it.image_full_url)
            );
            if (any) src = any.receipt_full_url || any.image_full_url || "";
          } else if (id && donationCache.byId.has(String(id))) {
            const it = donationCache.byId.get(String(id));
            src =
              it.receipt_full_url || it.image_full_url || it.image_url || "";
          }
        } catch (_) {}
      }
      if (!src && (batch || id)) {
        try {
          const items = await Api.fetchAdminList();
          if (batch) {
            const any = items.find(
              (it) =>
                it.batch_id === batch &&
                (it.receipt_full_url || it.image_full_url)
            );
            if (any) src = any.receipt_full_url || any.image_full_url || "";
          } else if (id) {
            const it = items.find((it) => String(it.id) === String(id));
            if (it) src = it.receipt_full_url || it.image_full_url || "";
          }
        } catch (_) {}
      }
      if (!src && id) {
        try {
          const row = await Api.fetchDonationDetail(id);
          if (row) src = row.receipt_full_url || row.image_full_url || "";
        } catch (_) {}
      }
      if (!src) {
        if (img) {
          img.alt = "No receipt uploaded yet";
          img.removeAttribute("src");
        }
        try {
          const t = modalEl.querySelector(".modal-title");
          if (t) t.textContent = "Receipt Image (none available)";
        } catch (_) {}
        if (info)
          info.textContent = "No image available for this donation/batch.";
        return;
      }
      const tmp = new Image();
      tmp.onload = () => {
        img.src = src;
        img.alt = "Receipt";
        try {
          const t = modalEl.querySelector(".modal-title");
          if (t) t.textContent = "Receipt Image";
        } catch (_) {}
        if (info) info.textContent = ""; // Do not show the URL
      };
      tmp.onerror = () => {
        img.alt = "Failed to load receipt image";
        try {
          const t = modalEl.querySelector(".modal-title");
          if (t) t.textContent = "Receipt Image (failed to load)";
        } catch (_) {}
        if (info) info.textContent = "Failed to load image."; // Generic message, no URL
      };
      tmp.src = src;
    });
    const img = getEl("imageViewerImg"),
      zin = getEl("imgZoomInBtn"),
      zout = getEl("imgZoomOutBtn"),
      zreset = getEl("imgZoomResetBtn");
    let scale = 1;
    const apply = () => {
      if (img) img.style.transform = `scale(${scale})`;
    };
    if (zin)
      zin.addEventListener("click", () => {
        scale = Math.min(5, scale + 0.25);
        apply();
      });
    if (zout)
      zout.addEventListener("click", () => {
        scale = Math.max(0.25, scale - 0.25);
        apply();
      });
    if (zreset)
      zreset.addEventListener("click", () => {
        scale = 1;
        apply();
      });
  }
  function bindGroupToggle() {
    document.addEventListener("click", (e) => {
      const btn = e.target.closest(".batch-toggle");
      if (!btn) return;
      const bid = btn.closest(".group-row").getAttribute("data-batch-id");
      const child = document.querySelector(
        `.child-container[data-batch-id="${bid}"]`
      );
      if (child) {
        child.classList.toggle("d-none");
        const icon = btn.querySelector("i.bi");
        if (icon) {
          icon.className = child.classList.contains("d-none")
            ? "bi bi-eye"
            : "bi bi-eye-slash";
        }
      }
    });
  }
  function bindDeleteConfirm() {
    const modal = getEl("deleteConfirmModal"),
      confirm = getEl("deleteConfirmBtn");
    if (!(modal && confirm)) return;
    confirm.addEventListener("click", async function () {
      const id = this.getAttribute("data-id") || "",
        batch = this.getAttribute("data-batch") || "";
      try {
        if (batch && !id) await Api.deleteDonationBatch(batch);
        else if (id) await Api.deleteDonation(id);
        else return;
        try {
          bootstrap.Modal.getOrCreateInstance(modal).hide();
          cleanupModals();
        } catch (_) {
          cleanupModals();
        }
        const items = await Api.fetchAdminList();
        window.__adminDonationRaw = Array.isArray(items) ? items.slice() : [];
        renderTable(applyFilters(window.__adminDonationRaw));
      } catch (err) {
        console.error("Delete failed:", err);
        try {
          const body = modal.querySelector(".modal-body");
          if (body)
            body.innerHTML = `<div class="text-danger">Failed to delete: ${escapeHtml(
              err.message || "Unknown error"
            )}</div>`;
        } catch (_) {}
      }
    });
  }
  function bindFoodSafetySubmit() {
    async function handle(result) {
      const form = getEl("foodSafetyForm");
      if (!form) return;
      const btnSubmit = getEl("foodSafetySubmitBtn"),
        btnFail = getEl("foodSafetyFailBtn"),
        modal = getEl("foodSafetyModal");
      const fd = await buildCompressedFormData(form);
      fd.set("result", result);
      const receipt = getEl("fsReceipt");
      const packaging = getEl("fsPackaging");
      const spoilage = getEl("fsSpoilage");
      
      // Validate checkboxes for passed result
      if (result === "passed") {
        if (!packaging.checked) {
          showError("Packaging must be confirmed as in good condition to pass the safety check.");
          return;
        }
        if (!spoilage.checked) {
          showError("No signs of spoilage must be confirmed to pass the safety check.");
          return;
        }
        if (
          !(receipt && receipt.files && receipt.files.length)
        ) { 
          showError("Receipt image is required for a Passed check."); 
          return; 
        }
      }
      if (result === "failed") {
        const reason = (getEl("fsFailReasonHidden")?.value || "").trim();
        if (!reason) { showError("Failure reason is required when marking as Failed."); return; }
        fd.set("fail_reason", reason);
      }
      const st = getEl("fsStorage"),
        pk = getEl("fsPackaging"),
        sp = getEl("fsSpoilage");
      if (st && st.value) fd.set("storage", st.value);
      if (pk) fd.set("packaging_ok", pk.checked ? "1" : "0");
      if (sp) fd.set("spoilage_ok", sp.checked ? "1" : "0");
      if (btnSubmit) btnSubmit.disabled = true;
      if (btnFail) btnFail.disabled = true;
      try {
        await Api.submitFoodSafetyCheck(fd);
        if (modal && bootstrap?.Modal) {
          try {
            bootstrap.Modal.getOrCreateInstance(modal).hide();
          } finally {
            cleanupModals();
          }
        }
        try {
          const fm = getEl("fsFailReasonModal");
          if (fm && bootstrap?.Modal)
            bootstrap.Modal.getOrCreateInstance(fm).hide();
        } catch (_) {}
        try {
          const successMsg =
            result === "passed"
              ? "Items updated. Status set to Picked Up."
              : "Food safety recorded as Failed.";
          notifyToast(successMsg, result === "passed" ? "success" : "warning");
        } catch (_) {}
        const newStatus = result === "passed" ? "Picked Up" : "Failed Safety",
          failVal =
            result === "failed"
              ? (getEl("fsFailReasonHidden")?.value || "").trim()
              : "",
          batchId = getEl("fsBatchId")?.value || "",
          donationId = getEl("fsDonationId")?.value || "";
        const acts = (ds) => {
          const p = [];
          if (newStatus === "Pending")
            p.push(
              `<button class="btn btn-sm btn-outline-warning action-fs" ${ds}><i class="bi bi-clipboard-check"></i></button>`
            );
          if (newStatus === "Picked Up")
            p.push(
              `<button class="btn btn-sm btn-outline-success action-receive" ${ds}><i class="bi bi-check2-circle"></i></button>`
            );
          p.push(
            `<button class="btn btn-sm btn-outline-danger action-delete" ${ds}><i class="bi bi-trash"></i></button>`
          );
          return `<div class="btn-group btn-group-sm" role="group">${p.join(
            ""
          )}</div>`;
        };
        if (batchId) {
          const arr = donationCache.byBatch.get(batchId) || [];
          arr.forEach((it) => {
            it.status = newStatus;
            if (failVal) it.fail_reason = failVal;
          });
          donationCache.byBatch.set(batchId, arr);
          const row = document.querySelector(
            `tr.group-row[data-batch-id="${batchId}"]`
          );
          if (row) {
            const stc = row.querySelector("td:nth-child(5)");
            if (stc) stc.innerHTML = badge(newStatus);
            const rc = row.querySelector("td:nth-child(6)");
            if (rc && result === "failed")
              rc.innerHTML = `<div class="small text-danger text-center">${escapeHtml(
                failVal || "Failed safety check"
              )}</div>`;
            const ac = row.querySelector("td:nth-child(7)");
            const ds = `data-batch="${batchId}" data-status="${newStatus}"`;
            if (ac) ac.innerHTML = acts(ds);
          }
          const child = document.querySelector(
            `tr.child-container[data-batch-id="${batchId}"]`
          );
          if (child)
            child.querySelectorAll("tbody tr").forEach((tr) => {
              const td = tr.querySelector("td:nth-child(5)");
              if (td) td.innerHTML = badge(newStatus);
            });
        } else if (donationId) {
          const it = donationCache.byId.get(String(donationId));
          if (it) {
            it.status = newStatus;
            if (failVal) it.fail_reason = failVal;
            donationCache.byId.set(String(donationId), it);
          }
          const btn =
            document.querySelector(`.action-delete[data-id="${donationId}"]`) ||
            document.querySelector(`.action-fs[data-id="${donationId}"]`) ||
            document.querySelector(`.action-receive[data-id="${donationId}"]`);
          if (btn) {
            const tr = btn.closest("tr");
            if (tr) {
              const stc = tr.querySelector("td:nth-child(5)");
              if (stc) stc.innerHTML = badge(newStatus);
              const rc = tr.querySelector("td:nth-child(6)");
              if (rc && result === "failed")
                rc.innerHTML = `<div class="small text-danger text-center">${escapeHtml(
                  failVal || "Failed safety check"
                )}</div>`;
              const ac = tr.querySelector("td:nth-child(7)");
              const ds = `data-id="${donationId}" data-batch="" data-status="${newStatus}"`;
              if (ac) ac.innerHTML = acts(ds);
            }
          } else {
            const items = await Api.fetchAdminList();
            renderTable(items);
          }
        }
        try {
          const items = await Api.fetchAdminList();
          window.__adminDonationRaw = Array.isArray(items) ? items.slice() : [];
          renderTable(applyFilters(window.__adminDonationRaw));
        } catch (_) {}
      } catch (err) {
        console.error("Food safety submit failed:", err);
        showError("Failed to submit food safety check: " + err.message);
      } finally {
        if (btnSubmit) btnSubmit.disabled = false;
        if (btnFail) btnFail.disabled = false;
        const h = getEl("fsFailReasonHidden");
        if (h) h.value = "";
      }
    }
    const ok = getEl("foodSafetySubmitBtn");
    if (ok) ok.addEventListener("click", () => handle("passed"));
    const fail = getEl("foodSafetyFailBtn");
    if (fail)
      fail.addEventListener("click", () => {
        const fm = getEl("fsFailReasonModal"),
          fin = getEl("fsFailReasonInput"),
          cfm = getEl("fsFailReasonConfirmBtn"),
          hid = getEl("fsFailReasonHidden"),
          base = getEl("foodSafetyModal");
        if (!(fm && cfm)) return;
        try {
          let baseModal = null;
          if (base)
            try {
              baseModal = bootstrap.Modal.getOrCreateInstance(base);
              baseModal.hide();
              cleanupModals();
            } catch (_) {
              cleanupModals();
            }
          const m = bootstrap.Modal.getOrCreateInstance(fm);
          if (fin) {
            fin.value = "";
            setTimeout(() => fin.focus(), 200);
          }
          cfm.replaceWith(cfm.cloneNode(true));
          const btn = getEl("fsFailReasonConfirmBtn"),
            cancel = fm.querySelector('[data-bs-dismiss="modal"]');
          if (cancel) {
            cancel.addEventListener(
              "click",
              () => {
                try {
                  if (baseModal) baseModal.show();
                } catch (_) {}
              },
              { once: true }
            );
          }
          btn.addEventListener("click", async () => {
            const reason = (fin?.value || "").trim();
            if (!reason) { showError("Failure reason is required."); return; }
            if (hid) hid.value = reason;
            try {
              m.hide();
              cleanupModals();
            } catch (_) {
              cleanupModals();
            }
            await handle("failed");
          });
          m.show();
        } catch (_) {}
      });
  }
  function bindActions() {
    document.addEventListener("click", async (e) => {
      const ack = e.target.closest(".action-ack");
      if (ack) {
        const id = ack.getAttribute("data-id") || "",
          batch = ack.getAttribute("data-batch") || "";
        try {
          if (batch && !id) {
            await Api.updateDonationBatchStatus(batch, "Acknowledged");
            const arr = donationCache.byBatch.get(batch) || [];
            arr.forEach((it) => (it.status = "Acknowledged"));
            donationCache.byBatch.set(batch, arr);
            const row = document.querySelector(
              `tr.group-row[data-batch-id="${batch}"]`
            );
            if (row) {
              const st = row.querySelector("td:nth-child(5)");
              if (st) st.innerHTML = badge("Acknowledged");
              const ac = row.querySelector("td:nth-child(7)");
              const ds = `data-batch="${batch}" data-status="Acknowledged"`;
              const parts = [
                `<button class="btn btn-sm btn-outline-warning action-fs" ${ds}><i class="bi bi-clipboard-check"></i></button>`,
                `<button class="btn btn-sm btn-outline-danger action-delete" ${ds}><i class="bi bi-trash"></i></button>`,
              ];
              if (ac)
                ac.innerHTML = `<div class="d-flex justify-content-center" style="gap:5px;">${parts.join(
                  ""
                )}</div>`;
            }
            // derive donor id and title from batch items
            let donorId = null,
              donorTitle = "";
            try {
              if (arr && arr.length) {
                const first = arr[0] || {};
                if (first.donor_id) donorId = Number(first.donor_id);
                donorTitle = (
                  first.donor_org ||
                  first.organization_name ||
                  ""
                ).trim();
              }
            } catch (_) {}
            // fallback: fetch from list if cache lacks donor_id/title
            if (!donorId || !donorTitle) {
              try {
                const items = await Api.fetchAdminList();
                const any = (Array.isArray(items) ? items : []).find(
                  (it) => String(it.batch_id || "") === String(batch)
                );
                if (any) {
                  if (!donorId && any.donor_id) donorId = Number(any.donor_id);
                  if (!donorTitle)
                    donorTitle = (
                      any.donor_org ||
                      any.organization_name ||
                      ""
                    ).trim();
                }
              } catch (_) {}
            }
            showAckNextStepsModal(donorId, donorTitle);
          } else if (id) {
            await Api.updateDonationStatus(id, "Acknowledged");
            const it = donationCache.byId.get(String(id));
            if (it) {
              it.status = "Acknowledged";
              donationCache.byId.set(String(id), it);
            }
            const ref =
                document.querySelector(`.action-ack[data-id="${id}"]`) ||
                document.querySelector(`.action-delete[data-id="${id}"]`),
              tr = ref ? ref.closest("tr") : null;
            if (tr) {
              const st = tr.querySelector("td:nth-child(5)");
              if (st) st.innerHTML = badge("Acknowledged");
              const ac = tr.querySelector("td:nth-child(7)");
              const ds = `data-id="${id}" data-batch="" data-status="Acknowledged"`;
              const parts = [
                `<button class="btn btn-sm btn-outline-warning action-fs" ${ds}><i class="bi bi-clipboard-check"></i></button>`,
                `<button class="btn btn-sm btn-outline-danger action-delete" ${ds}><i class="bi bi-trash"></i></button>`,
              ];
              if (ac)
                ac.innerHTML = `<div class="d-flex justify-content-center" style="gap:5px;">${parts.join(
                  ""
                )}</div>`;
            }
            // derive donor id and title from single donation row
            let donorId = null,
              donorTitle = "";
            try {
              const it2 = donationCache.byId.get(String(id));
              if (it2) {
                if (it2.donor_id) donorId = Number(it2.donor_id);
                donorTitle = (
                  it2.donor_org ||
                  it2.organization_name ||
                  ""
                ).trim();
              }
            } catch (_) {}
            // fallback: fetch exact donation to resolve donor_id/title
            if (!donorId || !donorTitle) {
              try {
                const row = await Api.fetchDonationDetail(id);
                if (row) {
                  if (!donorId && row.donor_id) donorId = Number(row.donor_id);
                  if (!donorTitle)
                    donorTitle = (
                      row.donor_org ||
                      row.organization_name ||
                      ""
                    ).trim();
                }
              } catch (_) {}
            }
            showAckNextStepsModal(donorId, donorTitle);
          }
        } catch (err) {
          console.error("Acknowledge failed:", err);
          showError("Failed to acknowledge donation: " + (err?.message || "Unknown error"));
        }
        return;
      }
      const del = e.target.closest(".action-delete");
      if (del) {
        const id = del.getAttribute("data-id") || "",
          batch = del.getAttribute("data-batch") || "",
          modal = getEl("deleteConfirmModal"),
          confirm = getEl("deleteConfirmBtn"),
          txt = getEl("deleteConfirmText");
        if (modal && confirm) {
          confirm.setAttribute("data-id", id);
          confirm.setAttribute("data-batch", batch);
          if (txt) {
            txt.textContent =
              !!batch && !id
                ? "Are you sure you want to delete this entire batch? This action cannot be undone."
                : "Are you sure you want to delete this donation? This action cannot be undone.";
          }
          try {
            bootstrap.Modal.getOrCreateInstance(modal).show();
          } catch (_) {}
        }
        return;
      }
      const fs = e.target.closest(".action-fs");
      if (fs) {
        const id = fs.getAttribute("data-id") || "",
          batch = fs.getAttribute("data-batch") || "",
          elDon = getEl("fsDonationId"),
          elBatch = getEl("fsBatchId");
        if (elDon) elDon.value = id;
        if (elBatch) elBatch.value = batch;
        const container = getEl("fsBatchItems");
        if (container) {
          let items = [];
          if (batch && donationCache.byBatch.has(batch))
            items = donationCache.byBatch.get(batch) || [];
          else if (id && donationCache.byId.has(String(id)))
            items = [donationCache.byId.get(String(id))];
          if (!items.length) items = id ? [{ id, name: "", quantity: "" }] : [];
          container.innerHTML = items
            .map((it, idx) => {
              const did = String(it?.id || "");
              const qtyVal = (it && typeof it.quantity !== 'undefined') ? Number(it.quantity) : '';
              const title = `${idx + 1}. ${escapeHtml(it?.name || "")}`;
              return (
                `<div class="border rounded p-2 d-flex flex-column gap-2">
                   <div class="fw-semibold">${title}</div>
                   <div class="row g-2 align-items-center">
                     <div class="col-6 col-sm-4">
                       <label class="form-label mb-1" for="fsQty_${did}">Quantity</label>
                       <input type="number" min="0" step="1" class="form-control form-control-sm" id="fsQty_${did}" name="quantity_override[${did}]" value="${qtyVal !== '' ? qtyVal : ''}" />
                     </div>
                   </div>
                   <input type="hidden" name="item_ids[]" value="${did}">
                   <label class="form-label mb-1">Expiry date photo (one per item)</label>
                   <input type="file" class="form-control" name="expiry_item_photo[${did}]" accept="image/*" capture="environment">
                 </div>`
              );
            })
            .join("");
        }
        const modal = getEl("foodSafetyModal");
        if (modal && bootstrap?.Modal)
          bootstrap.Modal.getOrCreateInstance(modal).show();
        return;
      }
      const recv = e.target.closest(".action-receive");
      if (recv) {
        const id = recv.getAttribute("data-id") || "",
          batch = recv.getAttribute("data-batch") || "",
          modal = getEl("receiveConfirmModal"),
          confirm = getEl("receiveConfirmBtn");
        if (modal && confirm && bootstrap?.Modal) {
          confirm.setAttribute("data-id", id);
          confirm.setAttribute("data-batch", batch);
          bootstrap.Modal.getOrCreateInstance(modal).show();
        } else {
          await completeDonation({ id, batch });
        }
        return;
      }
    });
  }
  async function completeDonation({ id, batch }) {
    const newStatus = "Completed";
    try {
      if (batch) await Api.updateDonationBatchStatus(batch, newStatus);
      else if (id) await Api.updateDonationStatus(id, newStatus);
      const acts = (ds) =>
        `<div class="btn-group btn-group-sm" role="group"><button class="btn btn-sm btn-outline-danger action-delete" ${ds}><i class="bi bi-trash"></i></button></div>`;
      if (batch) {
        const arr = donationCache.byBatch.get(batch) || [];
        arr.forEach((it) => (it.status = newStatus));
        donationCache.byBatch.set(batch, arr);
        const row = document.querySelector(
          `tr.group-row[data-batch-id="${batch}"]`
        );
        if (row) {
          const st = row.querySelector("td:nth-child(5)");
          if (st) st.innerHTML = badge(newStatus);
          const ac = row.querySelector("td:nth-child(7)");
          const ds = `data-batch="${batch}" data-status="${newStatus}"`;
          if (ac) ac.innerHTML = acts(ds);
        }
        const child = document.querySelector(
          `tr.child-container[data-batch-id="${batch}"]`
        );
        if (child)
          child.querySelectorAll("tbody tr").forEach((tr) => {
            const td = tr.querySelector("td:nth-child(5)");
            if (td) td.innerHTML = badge(newStatus);
          });
      } else if (id) {
        const it = donationCache.byId.get(String(id));
        if (it) {
          it.status = newStatus;
          donationCache.byId.set(String(id), it);
        }
        const btn =
          document.querySelector(`.action-delete[data-id="${id}"]`) ||
          document.querySelector(`.action-fs[data-id="${id}"]`) ||
          document.querySelector(`.action-receive[data-id="${id}"]`);
        if (btn) {
          const tr = btn.closest("tr");
          if (tr) {
            const st = tr.querySelector("td:nth-child(5)");
            if (st) st.innerHTML = badge(newStatus);
            const ac = tr.querySelector("td:nth-child(7)");
            const ds = `data-id="${id}" data-batch="" data-status="${newStatus}"`;
            if (ac) ac.innerHTML = acts(ds);
          }
        }
      }
      try {
        const items = await Api.fetchAdminList();
        window.__adminDonationRaw = Array.isArray(items) ? items.slice() : [];
        renderTable(applyFilters(window.__adminDonationRaw));
      } catch (_) {}
    } catch (err) {
      console.error("Failed to update status:", err);
      showError("Failed to update status: " + (err?.message || "Unknown error"));
    }
  }
  function bindReceiveConfirm() {
    const modal = getEl("receiveConfirmModal"),
      btn = getEl("receiveConfirmBtn");
    if (!(modal && btn)) return;
    btn.addEventListener("click", async function () {
      const id = this.getAttribute("data-id") || "",
        batch = this.getAttribute("data-batch") || "";
      const t = this.textContent;
      this.disabled = true;
      this.textContent = "Completing...";
      try {
        await completeDonation({ id, batch });
        try {
          bootstrap.Modal.getOrCreateInstance(modal).hide();
        } catch (_) {}
      } finally {
        this.disabled = false;
        this.textContent = t;
      }
    });
  }
  function bindFilters() {
    // Search input (debounced, live)
    const searchEl = getEl("donationSearch");
    if (searchEl) {
      const handler = debounce(() => {
        __page = 1;
        renderTable(applyFilters(window.__adminDonationRaw || []));
      }, 200);
      searchEl.addEventListener("input", handler);
    }

    // Quick range buttons (Today / This Week / This Month)
    const quickWrap = getEl("quickRangeBtns");
    if (quickWrap) {
      quickWrap.addEventListener("click", function (e) {
        const btn = e.target.closest && e.target.closest("[data-range]");
        if (!btn) return;
        const range = btn.getAttribute("data-range");
        const now = new Date();
        let from = null,
          to = null;
        if (range === "today") {
          from = to = now;
        } else if (range === "week") {
          to = now;
          from = new Date(now);
          from.setDate(now.getDate() - 6);
        } else if (range === "month") {
          to = now;
          from = new Date(now.getFullYear(), now.getMonth(), 1);
        }
        try {
          const fd = getEl("fromDate");
          const td = getEl("toDate");
          if (fd) fd.value = from ? toISODate(from) : "";
          if (td) td.value = to ? toISODate(to) : "";
          // visual active state: make this button primary and others outline
          Array.from(quickWrap.querySelectorAll("[data-range]")).forEach(
            (b) => {
              if (b === btn) {
                b.classList.remove("btn-outline-secondary");
                b.classList.add("btn-primary");
              } else {
                b.classList.remove("btn-primary");
                b.classList.add("btn-outline-secondary");
              }
            }
          );
        } catch (_) {}
      });
    }

    // from/to change listeners: just clear quick-range visual state
    const fdEl = getEl("fromDate");
    const tdEl = getEl("toDate");
    function clearQuickRangeState() {
      const quick = getEl("quickRangeBtns");
      if (!quick) return;
      Array.from(quick.querySelectorAll("[data-range]")).forEach((b) => {
        b.classList.remove("btn-primary");
        b.classList.add("btn-outline-secondary");
      });
    }
    if (fdEl)
      fdEl.addEventListener("change", () => {
        clearQuickRangeState();
      });
    if (tdEl)
      tdEl.addEventListener("change", () => {
        clearQuickRangeState();
      });

    // Filter Apply / Reset buttons
    const filterApplyBtn = getEl("donationFilterApplyBtn");
    const filterResetBtn = getEl("donationFilterResetBtn");
    if (filterApplyBtn) {
      filterApplyBtn.addEventListener("click", () => {
        __page = 1;
        renderTable(applyFilters(window.__adminDonationRaw || []));
      });
    }
    if (filterResetBtn) {
      filterResetBtn.addEventListener("click", () => {
        try {
          const form = document.getElementById("filterForm");
          if (form && typeof form.reset === "function") form.reset();
        } catch (_) {}
        clearQuickRangeState();
        __page = 1;
        renderTable(applyFilters(window.__adminDonationRaw || []));
      });
    }
  }

  function bindSortControls() {
    const sortApplyBtn = getEl("donationSortApplyBtn");
    const sortResetBtn = getEl("donationSortResetBtn");
    if (sortApplyBtn) {
      sortApplyBtn.addEventListener("click", () => {
        __page = 1;
        renderTable(applyFilters(window.__adminDonationRaw || []));
      });
    }
    if (sortResetBtn) {
      sortResetBtn.addEventListener("click", () => {
        ["sortDate", "sortItemName", "sortQuantity", "sortOrganization"].forEach(
          (id) => {
            const el = getEl(id);
            if (el) el.value = "";
          }
        );
        __page = 1;
        renderTable(applyFilters(window.__adminDonationRaw || []));
      });
    }
  }
  function bindPagination() {
    const sizeSelect = getEl("donationsPageSize");
    if (sizeSelect) {
      sizeSelect.addEventListener("change", () => {
        const val = parseInt(sizeSelect.value, 10);
        if (!Number.isFinite(val) || val <= 0) return;
        __pageSize = val;
        __page = 1;
        renderTable(applyFilters(window.__adminDonationRaw || []));
      });
    }
    const pager = getEl("donationsPagination");
    if (pager) {
      pager.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-page]");
        if (!btn) return;
        const target = parseInt(btn.getAttribute("data-page"), 10);
        if (!Number.isFinite(target) || target < 1) return;
        const items = applyFilters(window.__adminDonationRaw || []);
        const totalGroups = sortGroups(groupByBatch(items)).length;
        const pageSize = __pageSize || 20;
        const maxPage =
          totalGroups > 0
            ? Math.max(1, Math.ceil(totalGroups / pageSize))
            : 1;
        if (target > maxPage) return;
        __page = target;
        renderTable(items);
      });
    }
  }
  function bindRestoreAckPrompt() {
    const restore = getEl("restoreAckPromptBtn");
    if (!restore) return;
    restore.addEventListener("click", async function (e) {
      try {
        if (e && typeof e.preventDefault === "function") e.preventDefault();
      } catch (_) {}
      try {
        await Api.setUserPref("ackNextStepsDontShow", "");
        notifyToast("Acknowledge prompt will show again next time.", "success");
      } catch (err) {
        console.error("Failed to reset acknowledge prompt preference:", err);
        notifyToast("Failed to reset preference.", "danger");
      }
    });
  }

  // init
  async function init() {
    try {
      const items = await Api.fetchAdminList();
      window.__adminDonationRaw = Array.isArray(items) ? items.slice() : [];
      try {
        [
          "donationsDonorSelectDesktop",
          "donationsDonorSelectMobile",
          "donationsStatusSelectDesktop",
          "donationsStatusSelectMobile",
          "donationsCategorySelectDesktop",
          "donationsCategorySelectMobile",
          "donationsDateSelectDesktop",
          "donationsDateSelectMobile",
        ].forEach((id) => {
          const el = getEl(id);
          if (el && el.options && el.options.length) el.selectedIndex = 0;
        });
      } catch (_) {}
      await populateDonorSelects(window.__adminDonationRaw);
      await populateCategorySelects(window.__adminDonationRaw);
      populateOrgFilter(window.__adminDonationRaw);
      renderTable(applyFilters(window.__adminDonationRaw));
      bindImageViewer();
      bindGroupToggle();
      bindDeleteConfirm();
      bindFoodSafetySubmit();
      bindActions();
      bindReceiveConfirm();
      bindFilters();
      bindSortControls();
      bindPagination();
      bindRestoreAckPrompt();
      startDonationAutoRefresh();
    } catch (err) {
      console.error("Failed to load donations list:", err);
      const tbody = document.querySelector("main .table tbody");
      if (tbody)
        tbody.innerHTML = `<tr><td colspan="7" class="text-center text-danger">Failed to load donations (${escapeHtml(
          err.message
        )})</td></tr>`;
    }
  }

  // Expose global
  window.AdminDonationUI = {
    donationCache,
    getEl,
    badge,
    escapeHtml,
    capFirst,
    fmtDateTime,
    groupByBatch,
    renderTable,
    readFilters,
    applyFilters,
    populateCategorySelects,
    populateDonorSelects,
    populateOrgFilter,
    showAckNextStepsModal,
    init,
  };
})();
