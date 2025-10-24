(function () {
  "use strict";

  const API_BASE_URL =
    typeof window.API_BASE_URL === "string" && window.API_BASE_URL
      ? window.API_BASE_URL
      : "/Capstone%20Project/php/api";

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

  function updateRowImmediate(itemName, category, updater) {
    try {
      const tbody = document.querySelector("main .table tbody");
      if (!tbody) return;
      const rows = tbody.querySelectorAll("tr");
      for (const tr of rows) {
        const tds = tr.querySelectorAll("td");
        if (tds.length < 7) continue;
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

  // Submit Discard
  document.addEventListener("click", async function (e) {
    const submit = e.target.closest("#discardSubmitBtn");
    if (!submit) return;
    try {
      const ctx = window.__discardCtx || { itemName: "", category: "" };
      const qtyEl = document.getElementById("discardQty");
      const noteEl = document.getElementById("discardNote");
      const fb = document.getElementById("discardFeedback");
      const qty = parseInt(qtyEl && qtyEl.value ? qtyEl.value : "0", 10) || 0;
      const note = (noteEl && noteEl.value ? noteEl.value : "").trim();
      if (qty <= 0) { if (fb) fb.textContent = "Quantity must be at least 1."; return; }
      if (note.length === 0) { if (fb) fb.textContent = "Reason is required."; return; }
      fb && (fb.textContent = "");
      submit.disabled = true;
      // Call group move-out with mode 'discarded'
      const resp = await fetch(`${API_BASE_URL}/inventory/index.php/move-out-group`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ item_name: ctx.itemName, category: ctx.category, quantity: qty, mode: "discarded", note })
      });
      const jr = await resp.json().catch(() => null);
      if (!resp.ok || jr?.success === false) {
        throw new Error(jr?.error || `HTTP ${resp.status}`);
      }
      // Save last successful discard for immediate UI update on modal close
      window.__discardLast = { itemName: ctx.itemName, category: ctx.category, qty };
      // Close discard modal and show success
      try {
        const dm = document.getElementById("discardModal");
        if (dm && typeof bootstrap !== "undefined" && bootstrap.Modal) {
          bootstrap.Modal.getOrCreateInstance(dm).hide();
        }
        document.querySelectorAll(".modal-backdrop").forEach((el)=>{ try{ el.remove(); }catch(_){} });
      } catch (_) {}
      try {
        const body = document.getElementById("discardSuccessBody");
        if (body) { body.textContent = `Discarded ${qty} × ${ctx.itemName} (${ctx.category}).`; }
        const sm = document.getElementById("discardSuccessModal");
        if (sm && typeof bootstrap !== "undefined" && bootstrap.Modal) {
          bootstrap.Modal.getOrCreateInstance(sm).show();
        }
      } catch (_) {}
      // Refresh table
      await loadAndRender(1);
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
      json.data || { items: [], pagination: { page: 1, pages: 1, total: 0 } }
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
    // Sorting selections from Sort dropdown
    const qtyOrder = document.getElementById("quantityOrderSelectMobile")?.value || "None";
    const submOrder = document.getElementById("submissionDateSelectMobile")?.value || "None";
    const nameOrder = document.getElementById("donorOrderSelectMobile")?.value || "None";
    const hideExpired = !!document.getElementById("hideExpiredToggle")?.checked;
    return { category, q, fromDate, toDate, qtyOrder, submOrder, nameOrder, hideExpired };
  }

  function renderTable(items) {
    const tbody = document.querySelector("main .table tbody");
    if (!tbody) return;
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
        '<tr><td colspan="7" class="text-center py-4">No inventory items match the current filters.</td></tr>';
      return;
    }
    const rows = filtered.map((r) => {
      const item = escapeHtml(r.item_name || "");
      const cat = escapeHtml(r.category || "");
      const qty = (r.total_quantity ?? r.quantity ?? 0) + "";
      const soonest = escapeHtml(r.earliest_expiry || "—");
      const tagsRaw = r.tags_concat || r.tags || "" || "";
      const tags = escapeHtml(tagsRaw);
      const status = badge(r.derived_status || "In Stock");
      const data = `data-item-name="${item}" data-category="${cat}" data-tags="${tags}"`;
      const actions = `
        <div class="dropdown text-center">
          <button class="btn btn-sm btn-outline-secondary" type="button" data-bs-toggle="dropdown" aria-expanded="false" title="Actions">
            <i class="bi bi-three-dots-vertical"></i>
          </button>
          <div class="dropdown-menu p-2 text-center">
            <div class="d-flex align-items-center justify-content-center" style="gap:6px;">
              <button type="button" class="btn btn-sm btn-outline-warning inv-edit-tags" ${data} title="Edit Tags"><i class="bi bi-tags"></i></button>
              <button type="button" class="btn btn-sm btn-outline-secondary inv-issue-onsite" ${data} title="On-site Giveaway"><i class="bi bi-people"></i></button>
              <button type="button" class="btn btn-sm btn-outline-danger inv-discard" ${data} title="Discard"><i class="bi bi-trash"></i></button>
            </div>
          </div>
        </div>`;
      return `
        <tr>
          <td>${item}</td>
          <td>${cat}</td>
          <td>${qty}</td>
          <td>${soonest}</td>
          <td>${tags || "—"}</td>
          <td>${status}</td>
          <td>${actions}</td>
        </tr>
      `;
    });
    tbody.innerHTML = rows.join("");
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
    // Sorting: build one combined comparator so priority sticks
    const qtySel = (filters.qtyOrder || "None").toLowerCase();
    const dtSel = (filters.submOrder || "None").toLowerCase();
    const nameSel = (filters.nameOrder || "None").toLowerCase();
    const toQty = (r) => Number(r.total_quantity ?? r.quantity ?? 0) || 0;
    const toDate = (r) => {
      const s = r.earliest_expiry || r.added_at || r.created_at || "";
      const d = new Date(s);
      return isNaN(d.getTime()) ? new Date(0) : d;
    };
    const toName = (r) => String(r.item_name || "").toLowerCase();
    if (["high to low", "low to high", "newest first", "oldest first", "ascending", "descending"].some((v) => [qtySel, dtSel, nameSel].includes(v))) {
      arr.sort((a, b) => {
        // Quantity primary when set
        if (["high to low", "low to high"].includes(qtySel)) {
          const A = toQty(a), B = toQty(b);
          if (A !== B) return qtySel === "high to low" ? B - A : A - B;
        }
        // Date secondary when set
        if (["newest first", "oldest first"].includes(dtSel)) {
          const A = toDate(a).getTime(), B = toDate(b).getTime();
          if (A !== B) return dtSel === "newest first" ? B - A : A - B;
        }
        // Name tertiary when set
        if (["ascending", "descending"].includes(nameSel)) {
          const A = toName(a), B = toName(b);
          if (A !== B) return nameSel === "ascending" ? (A < B ? -1 : 1) : (A > B ? -1 : 1);
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
        const data = await fetchInventory({ category: filters.category, q: filters.q, page, limit });
        const items = applyClientFiltersAndSort(data.items || [], filters);
        window.__inventoryLast = { items, pagination: data.pagination };
        renderTable(items);
        renderPagination(data.pagination || { page: 1, pages: 1 });
        return;
      }

      // Hide expired ON: build a client-side non-expired collection across all server pages
      const key = JSON.stringify({ k: "inv", category: filters.category, q: filters.q });
      const cache =
        window.__invNonExpiredCache || (window.__invNonExpiredCache = {});
      let items = Array.isArray(cache[key]?.items) ? cache[key].items : null;
      if (!items) {
        // Fetch page 1 with max chunk (100)
        const first = await fetchInventory({ category: filters.category, q: filters.q, page: 1, limit: 100 });
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
        cache[key] = { items, ts: Date.now() };
      }
      // Client-side paginate non-expired
      const total = items.length;
      const pages = Math.max(1, Math.ceil(total / limit));
      const cur = Math.min(Math.max(1, page), pages);
      const start = (cur - 1) * limit;
      const sortedFiltered = applyClientFiltersAndSort(items, filters);
      const slice = sortedFiltered.slice(start, start + limit);
      window.__inventoryLast = {
        items: slice,
        pagination: { page: cur, pages, total },
      };
      renderTable(slice);
      renderPagination({ page: cur, pages });
    } catch (err) {
      console.error("Failed to load inventory:", err);
      const tbody = document.querySelector("main .table tbody");
      if (tbody) {
        tbody.innerHTML = `<tr><td colspan="7" class="text-center text-danger">Failed to load inventory (${escapeHtml(
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

  // Simple debounce for live search
  function debounce(fn, delay = 300) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn.apply(null, args), delay); };
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
            const qSel = document.getElementById("quantityOrderSelectMobile");
            const dSel = document.getElementById("submissionDateSelectMobile");
            const nSel = document.getElementById("donorOrderSelectMobile");
            if (qSel) qSel.value = "None";
            if (dSel) dSel.value = "None";
            if (nSel) nSel.value = "None";
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

  async function createOnsiteAllocation(itemName, category, quantity, note) {
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
          null
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

    // Ensure no orphan backdrops, then show success modal
    try {
      // Remove any lingering bootstrap backdrops
      document.querySelectorAll(".modal-backdrop").forEach((el) => {
        try {
          el.remove();
        } catch (_) {}
      });
      const body = document.getElementById("onsiteSuccessBody");
      if (body) {
        body.textContent = `Issued ${quantity} × ${itemName} (${category}). Allocation marked as Completed.`;
      }
      const sm = document.getElementById("onsiteSuccessModal");
      if (sm && typeof bootstrap !== "undefined" && bootstrap.Modal) {
        const inst = bootstrap.Modal.getOrCreateInstance(sm);
        inst.show();
        // When hidden, clean up any stray backdrops again
        sm.addEventListener(
          "hidden.bs.modal",
          () => {
            document.querySelectorAll(".modal-backdrop").forEach((el) => {
              try {
                el.remove();
              } catch (_) {}
            });
          },
          { once: true }
        );
      }
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
    const fileInput = document.getElementById("importFileInput");
    const headEl = document.getElementById("importPreviewHead");
    const bodyEl = document.getElementById("importPreviewBody");
    const statusEl = document.getElementById("importParseStatus");
    const submitBtn = document.getElementById("importInventorySubmitBtn");
    if (!fileInput || !headEl || !bodyEl || !submitBtn) return;

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

    submitBtn.addEventListener("click", async () => {
      try {
        submitBtn.disabled = true;
        // Map preview rows to expected payload fields
        const header = Array.isArray(previewData.header)
          ? previewData.header
          : [];
        const rows = Array.isArray(previewData.rows) ? previewData.rows : [];
        if (!header.length || !rows.length) {
          try {
            const b = document.getElementById("importResultBody");
            if (b) b.textContent = "No parsed rows to import.";
            const m = document.getElementById("importResultModal");
            if (m && typeof bootstrap !== "undefined" && bootstrap.Modal) {
              bootstrap.Modal.getOrCreateInstance(m).show();
            }
          } catch (_) {}
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
        const iItem = pick("item_name", "name", "product_name");
        const iCat = pick("category", "product_category");
        const iQty = ix("quantity");
        const iExpiry = ix("expiry_date");
        const iTags = ix("tags");
        const iUnit = pick("unit", "packed_by");
        const iTW = pick("total_weight", "total_weight_kg");
        const iTC = pick("total_cost", "total_cost_p");
        const iBatch = ix("source_batch_id");
        const iEntryDate = pick("entry_date", "added_at");
        const iDonEmail = ix("donor_email");
        const iDonOrg = pick("donor_org", "donor_organization", "donor_name");
        const iDonCategory = ix("donor_category");
        const iDonName = ix("donor_name");
        const iEntryBy = ix("entry_by");
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
            expiry_date: (iExpiry >= 0 ? r[iExpiry] || "" : "")
              .toString()
              .trim(),
            tags: (iTags >= 0 ? r[iTags] || "" : "").toString().trim(),
          };
          // Prefer explicit unit column when present and non-empty; otherwise use unit derived from QUANTITY tail
          if (iUnit >= 0) {
            const unitVal = (r[iUnit] || "").toString().trim();
            if (unitVal) rowObj.unit = unitVal;
            else if (derivedUnit) rowObj.unit = derivedUnit;
          } else if (derivedUnit) {
            rowObj.unit = derivedUnit;
          }
          if (iTW >= 0) rowObj.total_weight = (r[iTW] || "").toString().trim();
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
          try {
            const b = document.getElementById("importResultBody");
            if (b) b.textContent = "No valid rows (need item_name and quantity>=1).";
            const m = document.getElementById("importResultModal");
            if (m && typeof bootstrap !== "undefined" && bootstrap.Modal) {
              bootstrap.Modal.getOrCreateInstance(m).show();
            }
          } catch (_) {}
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
        // Close modal
        try {
          const modalEl = document.getElementById("importInventoryModal");
          if (modalEl && typeof bootstrap !== "undefined" && bootstrap.Modal) {
            bootstrap.Modal.getOrCreateInstance(modalEl).hide();
          }
        } catch (_) {}
        // Refresh table
        const p = window.__inventoryLast?.pagination?.page || 1;
        await loadAndRender(p);
        // Report summary via modal (show first few error reasons if any)
        try { if (errs.length) console.error("Inventory import errors:", errs); } catch (_) {}
        const firstErrors = errs
          .slice(0, 5)
          .map((e) => `#${e?.row ?? "?"}: ${e?.error ?? "unknown error"}`)
          .join("\n");
        const msg = `Imported ${inserted} row(s).${
          errs.length ? ` Skipped ${errs.length} invalid.` : ""
        }${firstErrors ? `\n\nSample errors:\n${firstErrors}` : ""}`;
        try {
          const b = document.getElementById("importResultBody");
          if (b) b.textContent = msg;
          const m = document.getElementById("importResultModal");
          if (m && typeof bootstrap !== "undefined" && bootstrap.Modal) {
            bootstrap.Modal.getOrCreateInstance(m).show();
          }
        } catch (_) {}
      } catch (err) {
        console.error("Import failed:", err);
        try {
          const b = document.getElementById("importResultBody");
          if (b) b.textContent = "Import failed: " + (err?.message || "Unknown error");
          const m = document.getElementById("importResultModal");
          if (m && typeof bootstrap !== "undefined" && bootstrap.Modal) {
            bootstrap.Modal.getOrCreateInstance(m).show();
          }
        } catch (_) {}
      } finally {
        submitBtn.disabled = false;
      }
    });
  }

  // Rebind import handlers whenever the modal is opened (defensive against cache/init issues)
  try {
    const importModal = document.getElementById("importInventoryModal");
    if (importModal) {
      importModal.addEventListener("shown.bs.modal", () => {
        try { bindImportModal(); } catch (_) {}
      });
    }
  } catch (_) {}

  async function init() {
    // init
    bindFilters();
    bindActions();
    await loadCategories();
    loadAndRender(1);
    bindImportModal();
    // When the Import Result modal is closed, refresh the table immediately
    try {
      const irm = document.getElementById("importResultModal");
      if (irm) {
        irm.addEventListener("hidden.bs.modal", () => {
          try { window.__invNonExpiredCache = {}; } catch (_) {}
          const p = window.__inventoryLast?.pagination?.page || 1;
          loadAndRender(p);
        });
      }
    } catch (_) {}
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
            // Close modal
            const m = document.getElementById("tagEditModal");
            if (m && typeof bootstrap !== "undefined" && bootstrap.Modal) {
              bootstrap.Modal.getOrCreateInstance(m).hide();
            }
            try { window.__invNonExpiredCache = {}; } catch (_) {}
            const p = window.__inventoryLast?.pagination?.page || 1;
            await loadAndRender(p);
          } catch (err) {
            console.error("Tag save failed:", err);
            const fb = document.getElementById("tagEditFeedback");
            if (fb) fb.textContent = err?.message || "Failed to update tags.";
          }
        });
      }
    } catch (_) {}
    // No export bindings here; exports will live in ReportAndAnalytics.html
    // Bind modal submit
    const submit = document.getElementById("onsiteIssueSubmitBtn");
    if (submit) {
      submit.addEventListener("click", async () => {
        const btn = submit;
        const qtyEl = document.getElementById("onsiteQty");
        const noteEl = document.getElementById("onsiteNote");
        const fb = document.getElementById("onsiteIssueFeedback");
        const mEl = document.getElementById("onsiteIssueModal");
        const ctx = window.__onsiteCtx || {};
        const itemName = ctx.itemName || "";
        const category = ctx.category || "";
        const quantity = parseInt(qtyEl?.value || "0", 10) || 0;
        const note = String(noteEl?.value || "").trim();
        if (!itemName || !category) {
          if (fb) fb.textContent = "Invalid item context.";
          return;
        }
        if (!quantity || quantity <= 0) {
          if (fb) fb.textContent = "Quantity must be at least 1.";
          return;
        }
        const cleanup = () => {
          try {
            document.querySelectorAll(".modal-backdrop").forEach((el) => {
              try {
                el.remove();
              } catch (_) {}
            });
            if (document && document.body) {
              document.body.classList.remove("modal-open");
              try {
                document.body.style.removeProperty("padding-right");
              } catch (_) {}
            }
          } catch (_) {}
        };
        try {
          btn.disabled = true;
          if (fb) fb.textContent = "";
          updateRowImmediate(itemName, category, (tr, tds) => {
            const cur = parseInt((tds[2].textContent || "0").replace(/[^0-9]/g, ''), 10) || 0;
            const next = Math.max(0, cur - quantity);
            tds[2].textContent = String(next);
          });
          // Hide the entry modal first to avoid stacked backdrops
          if (mEl && typeof bootstrap !== "undefined" && bootstrap.Modal) {
            bootstrap.Modal.getOrCreateInstance(mEl).hide();
          }
          cleanup();
          await createOnsiteAllocation(itemName, category, quantity, note);
          // Reload table
          try { window.__invNonExpiredCache = {}; } catch (_) {}
          const p = window.__inventoryLast?.pagination?.page || 1;
          await loadAndRender(p);
        } catch (err) {
          console.error("On-site allocation failed:", err);
          if (fb) fb.textContent = err?.message || "Failed to save allocation.";
        } finally {
          btn.disabled = false;
          cleanup();
        }
      });
    }
    // Auto-refresh when tab becomes visible again
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        const p = window.__inventoryLast?.pagination?.page || 1;
        loadAndRender(p);
      }
    });
    // Add a manual Refresh button next to Import if not present
    try {
      const filtersBar = document.querySelector("main .d-flex.flex-wrap");
      if (filtersBar && !document.getElementById("invRefreshBtn")) {
        const btnWrap = document.createElement("div");
        btnWrap.className = "ms-0";
        btnWrap.innerHTML =
          '<button id="invRefreshBtn" type="button" class="btn btn-sm btn-outline-secondary"><i class="bi bi-arrow-clockwise"></i> Refresh</button>';
        filtersBar.appendChild(btnWrap);
        btnWrap
          .querySelector("#invRefreshBtn")
          .addEventListener("click", () => {
            const p = window.__inventoryLast?.pagination?.page || 1;
            loadAndRender(p);
          });
      }
    } catch (_) {}
  }

  document.addEventListener("DOMContentLoaded", init);
})();
