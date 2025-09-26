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

  function bindActions() {
    document.addEventListener("click", async function (e) {
      const btnRec = e.target.closest(".inv-issue-recipient");
      const btnOn = e.target.closest(".inv-issue-onsite");
      const btnTag = e.target.closest(".inv-edit-tags");
      if (!btnRec && !btnOn) return;
      const itemName = btnRec
        ? btnRec.getAttribute("data-item-name") || ""
        : btnOn?.getAttribute("data-item-name") || "";
      const category = btnRec
        ? btnRec.getAttribute("data-category") || ""
        : btnOn?.getAttribute("data-category") || "";
      if (!itemName || !category) return;

      try {
        if (btnTag) {
          /* handled in separate branch below */
        }
        const qtyStr = prompt(
          `Enter quantity to issue for ${itemName} (${category}):`
        );
        if (qtyStr === null) return; // cancelled
        const quantity = parseInt(qtyStr, 10);
        if (!quantity || quantity <= 0) {
          alert("Invalid quantity");
          return;
        }

        let payload = { item_name: itemName, category, quantity };
        if (btnRec) {
          const recStr = prompt("Enter recipient user_id:");
          const rid = parseInt(recStr, 10);
          if (!rid) {
            alert("Invalid recipient id");
            return;
          }
          payload.mode = "recipient";
          payload.recipient_id = rid;
        } else {
          payload.mode = "onsite";
          const note =
            prompt("Optional note for on-site giveaway (or leave blank):") ||
            "";
          payload.note = note;
        }

        const res = await fetch(
          `${API_BASE_URL}/inventory/index.php/move-out-group`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify(payload),
          }
        );
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json.success) {
          const msg = json?.error || `HTTP ${res.status}`;
          throw new Error(msg);
        }
        // Reload current page
        const p = window.__inventoryLast?.pagination?.page || 1;
        await loadAndRender(p);
      } catch (err) {
        console.error("Issue stock failed:", err);
        alert("Failed to issue stock: " + (err?.message || "Unknown error"));
      }
    });
  }

  // Separate delegation for tag editing to avoid quantity prompt
  document.addEventListener("click", async function (e) {
    const btnTag = e.target.closest(".inv-edit-tags");
    if (!btnTag) return;
    const itemName = btnTag.getAttribute("data-item-name") || "";
    const category = btnTag.getAttribute("data-category") || "";
    const currentTags = btnTag.getAttribute("data-tags") || "";
    try {
      const tags = prompt(
        `Edit tags for ${itemName} (${category}). Use commas to separate.`,
        currentTags
      );
      if (tags === null) return; // cancelled
      const res = await fetch(
        `${API_BASE_URL}/inventory/index.php/update-tags`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            scope: "group",
            item_name: itemName,
            category: category,
            tags: String(tags || "").trim(),
          }),
        }
      );
      const j = await res
        .json()
        .catch(() => ({ success: false, error: `HTTP ${res.status}` }));
      if (!res.ok || !j?.success) {
        throw new Error(j?.error || `HTTP ${res.status}`);
      }
      const p = window.__inventoryLast?.pagination?.page || 1;
      await loadAndRender(p);
    } catch (err) {
      console.error("Update tags failed:", err);
      alert("Failed to update tags: " + (err?.message || "Unknown error"));
    }
  });

  function badge(status) {
    switch (status) {
      case "Expired":
        return '<span class="badge bg-danger">Expired</span>';
      case "Expiring Soon":
        return '<span class="badge bg-warning text-dark">Expiring Soon</span>';
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
      document.getElementById("categorySelectDesktop")?.value ||
      document.getElementById("categorySelectMobile")?.value ||
      "All";
    const date =
      document.getElementById("dateSelectDesktop")?.value ||
      document.getElementById("dateSelectMobile")?.value ||
      "All";
    const q = document.getElementById("searchInventoryInput")?.value || "";
    return { category, date, q };
  }

  function renderTable(items) {
    const tbody = document.querySelector("main .table tbody");
    if (!tbody) return;
    if (!Array.isArray(items) || items.length === 0) {
      tbody.innerHTML =
        '<tr><td colspan="7" class="text-center py-4">No inventory items match the current filters.</td></tr>';
      return;
    }
    const rows = items.map((r) => {
      const item = escapeHtml(r.item_name || "");
      const cat = escapeHtml(r.category || "");
      const qty = (r.total_quantity ?? r.quantity ?? 0) + "";
      const soonest = escapeHtml(r.earliest_expiry || "—");
      const tagsRaw = r.tags_concat || r.tags || "" || "";
      const tags = escapeHtml(tagsRaw);
      const status = badge(r.derived_status || "In Stock");
      const data = `data-item-name="${item}" data-category="${cat}" data-tags="${tags}"`;
      const actions = `
        <div class="d-flex justify-content-center" style="gap:6px;">
          <button type="button" class="btn btn-sm btn-outline-warning inv-edit-tags" ${data} title="Edit Tags"><i class="bi bi-tags"></i></button>
          <button type="button" class="btn btn-sm btn-outline-success inv-issue-recipient" ${data} title="Give to Recipient"><i class="bi bi-box-arrow-up-right"></i></button>
          <button type="button" class="btn btn-sm btn-outline-secondary inv-issue-onsite" ${data} title="On-site Giveaway"><i class="bi bi-people"></i></button>
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

  async function loadAndRender(page = 1) {
    try {
      const filters = getFilters();
      const data = await fetchInventory({ ...filters, page, limit: 25 });
      window.__inventoryLast = data;
      renderTable(data.items || []);
      renderPagination(data.pagination || { page: 1, pages: 1 });
    } catch (err) {
      console.error("Failed to load inventory:", err);
      const tbody = document.querySelector("main .table tbody");
      if (tbody) {
        tbody.innerHTML = `<tr><td colspan="7" class="text-center text-danger">Failed to load inventory (${escapeHtml(
          err.message
        )}). You must be logged in as Admin to view inventory.</td></tr>`;
      }
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

  function bindFilters() {
    [
      "categorySelectDesktop",
      "categorySelectMobile",
      "dateSelectDesktop",
      "dateSelectMobile",
      "searchInventoryInput",
    ].forEach((id) => {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener("change", () => loadAndRender(1));
      }
    });
    const pag = document.getElementById("inventoryPagination");
    if (pag) {
      pag.addEventListener("click", (e) => {
        const btn = e.target.closest("button[data-page]");
        if (!btn || btn.disabled) return;
        const p = parseInt(btn.getAttribute("data-page") || "1", 10) || 1;
        loadAndRender(p);
      });
    }
  }

  function ensureSearchBox() {
    // Add a search input next to the title bar if not present
    const bar = document.querySelector("main > .d-flex");
    if (!bar) return;
    if (document.getElementById("searchInventoryInput")) return;
    const wrapper = document.createElement("div");
    wrapper.className = "ms-auto";
    wrapper.innerHTML =
      '<input id="searchInventoryInput" class="form-control form-control-sm" placeholder="Search items or category">';
    bar.appendChild(wrapper);
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
    return (h || "").toLowerCase().trim().replace(/\s+/g, "_");
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

    submitBtn.addEventListener("click", () => {
      // Half-functional: simulate sending data and close modal
      const count = previewData.rows.length;
      alert(
        `Import ready: ${count} rows parsed. Server endpoint not yet wired.`
      );
      try {
        const modalEl = document.getElementById("importInventoryModal");
        if (modalEl && typeof bootstrap !== "undefined" && bootstrap.Modal) {
          bootstrap.Modal.getOrCreateInstance(modalEl).hide();
        }
      } catch (_) {}
    });
  }

  async function init() {
    ensureSearchBox();
    bindFilters();
    bindActions();
    loadAndRender(1);
    bindImportModal();
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
