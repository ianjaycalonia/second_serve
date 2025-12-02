(function () {
  "use strict";

  $(function () {
    const API_BASE_URL =
      typeof window.API_BASE_URL === "string" && window.API_BASE_URL
        ? window.API_BASE_URL
        : "/php/api";

    const $modal = $("#donationModal");
    const TAXO_BASE_URL = `${API_BASE_URL}/taxonomy/index.php`;
    const $form = $("#donationForm");
    const $submitBtn = $("#submitDonationBtn");
    const $itemsContainer = $("#itemsContainer");
    const $addItemBtn = $("#addItemBtn");
    const $donorSelect = $("#donationDonorSelect");

    let expiryLeadDays = 0;
    let expiryMinDate = "";
    let expiryLeadLoaded = false;
    let expiryLeadToastShown = false;
    const itemCostCache = Object.create(null);

    function formatDateInput(date) {
      if (!(date instanceof Date) || isNaN(date.getTime())) return "";
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, "0");
      const day = String(date.getDate()).padStart(2, "0");
      return `${year}-${month}-${day}`;
    }

    function computeExpiryMinDate(days) {
      const base = new Date();
      base.setHours(0, 0, 0, 0);
      const safeDays = Number.isFinite(days) ? Math.max(0, days) : 0;
      base.setDate(base.getDate() + safeDays);
      return formatDateInput(base);
    }

    function warnLeadAdjustment() {
      if (!expiryLeadDays || expiryLeadToastShown) return;
      expiryLeadToastShown = true;
      const msg =
        expiryLeadDays === 1
          ? "Expiry date must be at least 1 day from today."
          : `Expiry date must be at least ${expiryLeadDays} days from today.`;
      showToast(msg, "warning");
    }

    function enforceExpiryLead($field, shouldWarn = true) {
      if (!$field || !expiryLeadLoaded || !expiryMinDate) return true;
      const value = String($field.val() || "").trim();
      if (!value) return true;
      if (value < expiryMinDate) {
        $field.val(expiryMinDate);
        if (shouldWarn) warnLeadAdjustment();
      }
      $field.removeClass("is-invalid");
      return true;
    }

    function applyExpiryConstraints($inputs) {
      if (!$inputs || !$inputs.length || !expiryLeadLoaded) return;
      if (expiryMinDate) {
        $inputs.each(function () {
          this.setAttribute("min", expiryMinDate);
          enforceExpiryLead($(this), false);
        });
      } else {
        $inputs.each(function () {
          this.removeAttribute("min");
        });
      }
    }

    async function loadExpiryLeadTime() {
      if (expiryLeadLoaded) return;
      let days = 0;
      try {
        const res = await fetch(
          `${API_BASE_URL}/system/settings.php?action=get&key=expiry_lead_time_days&t=${Date.now()}`,
          {
            method: "GET",
            credentials: "include",
            headers: { Accept: "application/json" },
          }
        );
        if (res.ok) {
          const payload = await res.json().catch(() => null);
          if (payload?.success) {
            const raw =
              payload?.data?.value !== undefined
                ? payload.data.value
                : payload?.value;
            const parsed = parseInt(raw, 10);
            if (Number.isFinite(parsed) && parsed >= 0) {
              days = parsed;
            }
          }
        }
      } catch (err) {
        console.warn(
          "[InventoryDonationModal] Unable to load expiry lead time",
          err
        );
      } finally {
        expiryLeadDays = days;
        expiryMinDate = computeExpiryMinDate(days);
        expiryLeadLoaded = true;
        applyExpiryConstraints($itemsContainer.find(".item-expiry"));
      }
    }

    function showToast(msg, variant) {
      try {
        const body = document.getElementById("toastBody");
        if (body) body.textContent = msg || "Done";
        const el = document.getElementById("feedbackToast");
        if (el) {
          el.className =
            "toast align-items-center text-bg-" + (variant || "dark") + " border-0";
          bootstrap.Toast.getOrCreateInstance(el).show();
        } else {
          alert(msg);
        }
      } catch (_) {
        alert(msg);
      }
    }

    async function fetchUnitCostByName(name) {
      const raw = (name || "").trim();
      if (!raw) return null;
      const key = raw.toLowerCase();
      if (Object.prototype.hasOwnProperty.call(itemCostCache, key)) {
        return itemCostCache[key];
      }
      let cost = null;
      try {
        const url = `${TAXO_BASE_URL}/master-items?` +
          new URLSearchParams({ q: raw, page_size: "20" }).toString();
        const res = await fetch(url, {
          method: "GET",
          credentials: "include",
          headers: { Accept: "application/json" },
        });
        if (res.ok) {
          const data = await res.json().catch(() => null);
          const items = Array.isArray(data?.items) ? data.items : [];
          if (items.length) {
            const needle = raw.toLowerCase();
            const exact =
              items.find((it) =>
                String(it.product_name || "")
                  .toLowerCase()
                  .trim() === needle
              ) || items[0];
            if (
              exact &&
              exact.unit_cost !== null &&
              exact.unit_cost !== undefined &&
              !Number.isNaN(Number(exact.unit_cost))
            ) {
              cost = Number(exact.unit_cost);
            }
          }
        }
      } catch (_) {
        // ignore lookup errors; leave cost as null
      }
      itemCostCache[key] = cost;
      return cost;
    }

    async function autoFillCostForRow($row) {
      if (!$row || !$row.length) return;
      const $name = $row.find(".item-name-select");
      const $qty = $row.find(".item-qty");
      const $cost = $row.find(".item-cost");
      if (!$name.length || !$qty.length || !$cost.length) return;
      const existing = String($cost.val() || "").trim();
      const autoFlag = String($cost.attr("data-auto") || "").toLowerCase();
      const canOverride = existing === "" || autoFlag === "1" || autoFlag === "true";
      if (!canOverride) return;
      const nameVal = String($name.val() || "").trim();
      if (!nameVal) return;
      const qtyVal = Number($qty.val() || "0");
      const unitCost = await fetchUnitCostByName(nameVal);
      if (typeof unitCost === "number" && !Number.isNaN(unitCost)) {
        let total = unitCost;
        if (Number.isFinite(qtyVal) && qtyVal > 0) {
          total = unitCost * qtyVal;
        }
        $cost.val(total.toFixed(2));
        $cost.attr("data-auto", "1");
      }
    }

    function initRowUnitSelect2($row){
      const $unit = $row.find('.item-unit');
      if (!$unit.length || !$.fn.select2) return;
      if ($unit.hasClass('select2-hidden-accessible')) return;
      $unit.select2({
        width: '100%',
        placeholder: 'Select unit (optional)',
        dropdownParent: $modal,
        allowClear: true,
        minimumInputLength: 0,
        ajax: {
          url: `${TAXO_BASE_URL}/units`,
          dataType: 'json',
          delay: 250,
          data: function(params){ return { q: params.term || '', active: 1 }; },
          processResults: function(data){
            const items = Array.isArray(data?.items) ? data.items : [];
            return { results: items.map(u => ({ id: u.unit_id, text: u.label || u.code })) };
          },
          xhrFields: { withCredentials: true },
          cache: true,
        }
      });
      // Lock unit after selection: show only the chosen one and disable control
      $unit.on('select2:select', function(){
        const data = $unit.select2('data');
        if (Array.isArray(data) && data.length) {
          const sel = data[0];
          $unit.find('option').remove();
          const opt = new Option(sel.text, sel.id, true, true);
          $unit.append(opt).trigger('change.select2');
          $unit.prop('disabled', true);
        }
      });
    }

    function initDonorSelect() {
      if (!$donorSelect.length || !$.fn.select2) return;
      if ($donorSelect.hasClass("select2-hidden-accessible")) return;
      $donorSelect.select2({
        width: "100%",
        placeholder: $donorSelect.data("placeholder") || "Select donor (optional)",
        dropdownParent: $modal,
        allowClear: true,
        minimumInputLength: 0,
        ajax: {
          delay: 250,
          url: `${API_BASE_URL}/users/index.php`,
          dataType: "json",
          data: function (params) {
            return {
              action: "list",
              role: "donor",
              status: "approved",
              q: params.term || "",
            };
          },
          processResults: function (resp) {
            const items = Array.isArray(resp?.data?.items) ? resp.data.items : [];
            return {
              results: items.map(function (item) {
                const org = (item.organization_name || "").trim();
                const fallback = (item.name || "Unknown donor").trim();
                return {
                  id: item.user_id,
                  text: org !== "" ? org : fallback,
                };
              }),
            };
          },
          xhrFields: { withCredentials: true },
          cache: true,
        },
      });
      $donorSelect.on('select2:open', function(){
        const $search = $(".select2-container--open .select2-search__field");
        if ($search.length) { $search.trigger('input'); }
      });
    }

    initDonorSelect();
    loadExpiryLeadTime();

    function setSubmitting(isLoading) {
      if (isLoading) {
        $submitBtn
          .prop("disabled", true)
          .html(
            '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Submitting...'
          );
      } else {
        $submitBtn.prop("disabled", false).text("Submit Donation");
      }
    }

    // Select2 helpers (identical behavior)
    function initSelect2($el) {
      if (!$el || !$el.length || !$.fn.select2) return;
      $el.select2({
        tags: true,
        width: "100%",
        placeholder: $el.data("placeholder") || "Search or type new",
        minimumInputLength: 0,
        dropdownParent: $modal,
        ajax: {
          delay: 250,
          url: `${API_BASE_URL}/donations/index.php/items`,
          dataType: "json",
          data: function (params) { return { q: params.term || "", limit: 20 }; },
          processResults: function (data) {
            const items = data && data.items ? data.items : [];
            return { results: items.map((n) => ({ id: n, text: n })) };
          },
          xhrFields: { withCredentials: true },
          error: function (xhr) {
            try {
              const msg = xhr?.responseJSON?.error || "Failed to load item suggestions";
              console.warn("Select2 items AJAX error:", msg);
            } catch (_) {}
          },
          cache: true,
        },
        createTag: function (params) {
          const term = (params.term || "").trim();
          if (term.length < 1) return null;
          return { id: term, text: term, newTag: true };
        },
      });
      // Auto-trigger an initial fetch on open
      $el.on('select2:open', function(){
        const $search = $(".select2-container--open .select2-search__field");
        if ($search.length) { $search.trigger('input'); }
      });
      $el.on("change", function () {
        const $row = $el.closest(".item-row");
        autoFillCostForRow($row);
      });
    }

    function initRowCategorySelect2($row) {
      const $cat = $row.find(".item-cat");
      if (!$cat.length || !$.fn.select2) return;
      if ($cat.hasClass("select2-hidden-accessible")) return;
      $cat.select2({
        width: "100%",
        placeholder: "Select category",
        dropdownParent: $modal,
        tags: false,
        allowClear: true,
        minimumInputLength: 0,
        ajax: {
          url: `${TAXO_BASE_URL}/categories`,
          dataType: "json",
          delay: 250,
          data: function(params){ return { q: params.term || '', active: 1 }; },
          processResults: function (data) {
            const items = Array.isArray(data?.items) ? data.items : [];
            return { results: items.map((c) => {
              const label = c?.secondary_name ? `${c.primary_name} - ${c.secondary_name}` : `${c.primary_name}`;
              return { id: c.category_id, text: label };
            }) };
          },
          xhrFields: { withCredentials: true },
          cache: true,
        },
      });
      $cat.on("select2:open", function () {
        const $search = $(".select2-container--open .select2-search__field");
        if ($search.length) {
          $search.trigger("input");
        }
      });
    }

    // Dynamic items UI (copied template)
    function itemRowTemplate(id) {
      return `
      <div class="card card-accent p-3 item-row donation-card" data-id="${id}">
        <div class="row g-3 gap-2 align-items-center">
          <div class="col-12">
            <div class="row g-3">
              <div class="col-5">
                <label class="form-label mb-1">Item Name</label>
                  <select
                    class="form-select item-name-select"
                    data-placeholder="Search or type new"
                    required
                  ></select>
                  <div class="invalid-feedback">Item name is required.</div>
              </div>
              <div class="col-3">
                <label class="form-label mb-1">Quantity</label>
                <input type="number" class="form-control form-control-sm item-qty" min="1" required />
                <div class="invalid-feedback">Min 1</div>
              </div>
              <div class="col-4">
                <label class="form-label mb-1">Mode</label>
                <select class="form-select form-select-sm item-mode">
                  <option value="donated" selected>Donated</option>
                  <option value="purchased">Purchased</option>
                </select>
              </div>
            </div>
          </div>
          <div class="col-12">
            <div class="row g-3">
              <div class="col-6">
                <label class="form-label mb-1">Cost (₱)</label>
                <input type="number" step="0.01" min="0" class="form-control form-control-sm item-cost" placeholder="e.g., 150.00" />
              </div>
              <div class="col-6">
                <label class="form-label">Expiry Date</label>
                <input type="date" class="form-control form-control-sm item-expiry" required />
                <div class="invalid-feedback">Expiry date is required.</div>
              </div>
            </div>
          </div>
          <div class="col-12">
            <label class="form-label mb-1">Remarks</label>
            <input type="text" class="form-control form-control-sm item-remarks" maxlength="500" placeholder="Optional notes for this item" />
          </div>
          <div class="d-flex justify-content-end align-items-center">
            <button type="button" class="btn btn-sm btn-outline-danger d-flex align-items-center gap-2" aria-label="Remove item">
              <i class="bi bi-trash"></i>
              <span>Remove Item</span>
            </button>
          </div>
        </div>
      </div>`;
    }

    let __rowId = 1;
    function addItemRow() {
      const id = __rowId++;
      $itemsContainer.append(itemRowTemplate(id));
      const $row = $itemsContainer.find(`.item-row[data-id="${id}"]`);
      initSelect2($row.find(".item-name-select"));
      applyExpiryConstraints($row.find(".item-expiry"));
    }
    function removeItemRow(btn) {
      $(btn).closest(".item-row").remove();
    }

    $addItemBtn.on("click", addItemRow);
    $itemsContainer.on("click", ".btn-outline-danger", function () {
      removeItemRow(this);
    });
    $itemsContainer.on("change blur", ".item-expiry", function () {
      enforceExpiryLead($(this));
    });
    $itemsContainer.on("change blur", ".item-qty", function () {
      const $row = $(this).closest(".item-row");
      autoFillCostForRow($row);
    });
    $itemsContainer.on("input change", ".item-cost", function () {
      $(this).removeAttr("data-auto");
    });

    // Removed category-dependent item suggestion handler

    // OCR logic (same endpoints and UX)
    const OCR_STOPWORDS = new Set([
      "qty",
      "quantity",
      "total",
      "subtotal",
      "amount",
      "price",
      "page",
      "date",
      "donor",
      "recipient",
      "address",
      "contact",
      "phone",
      "email",
      "remarks",
      "note",
      "notes",
      "signature",
      "approved",
      "prepared",
      "time",
      "code",
      "ref",
      "reference",
      "invoice",
      "receipt",
      "number",
      "no",
      "item",
      "items",
      "description",
      "unit",
      "units",
      "weight",
      "status",
      "type",
      "summary",
      "table",
      "list",
      "value",
      "values",
    ]);
    const KNOWN_ITEM_FETCH_LIMIT = 500;
    const ocrKnownItems = { ready: false, attempted: false, entries: [] };
    let ocrKnownItemsPromise = null;

    function normaliseItemLabel(str) {
      return String(str || "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    }

    function tokensFromNorm(norm) {
      return norm ? norm.split(" ").filter((token) => token && token.length >= 2) : [];
    }

    function tidyCandidateName(name) {
      return String(name || "")
        .replace(/\s{2,}/g, " ")
        .replace(/[|,:;\-]+/g, " ")
        .trim();
    }

    function ensureKnownItemsLoaded() {
      if (ocrKnownItems.ready || ocrKnownItems.attempted) {
        return ocrKnownItemsPromise || Promise.resolve(ocrKnownItems);
      }
      if (ocrKnownItemsPromise) return ocrKnownItemsPromise;

      const url = `${API_BASE_URL}/donations/index.php/items?limit=${KNOWN_ITEM_FETCH_LIMIT}`;
      ocrKnownItemsPromise = fetch(url, {
        method: "GET",
        credentials: "include",
        headers: { Accept: "application/json" },
      })
        .then((res) => res.json().catch(() => null))
        .then((data) => {
          const items = Array.isArray(data?.items) ? data.items : [];
          const entries = [];
          const seen = new Set();
          for (const label of items) {
            const norm = normaliseItemLabel(label);
            if (!norm || seen.has(norm)) continue;
            seen.add(norm);
            const tokens = tokensFromNorm(norm);
            entries.push({ label, norm, tokens, tokenSet: new Set(tokens) });
          }
          ocrKnownItems.entries = entries;
          ocrKnownItems.ready = entries.length > 0;
          ocrKnownItems.attempted = true;
          return ocrKnownItems;
        })
        .catch((err) => {
          console.warn("[InventoryDonationModal] Failed to load inventory item names", err);
          ocrKnownItems.entries = [];
          ocrKnownItems.ready = false;
          ocrKnownItems.attempted = true;
          return ocrKnownItems;
        })
        .finally(() => {
          ocrKnownItemsPromise = null;
        });

      return ocrKnownItemsPromise;
    }

    function matchesKnownItem(norm, tokens) {
      if (!ocrKnownItems.ready || !ocrKnownItems.entries.length) return false;
      for (const entry of ocrKnownItems.entries) {
        if (entry.norm === norm) return true;
        if (entry.norm.length >= 5 && (entry.norm.includes(norm) || norm.includes(entry.norm))) {
          return true;
        }
        if (!tokens || !tokens.length || !entry.tokens.length) continue;
        let overlap = 0;
        for (const token of tokens) {
          if (entry.tokenSet.has(token)) {
            overlap += 1;
            if (overlap >= Math.min(2, tokens.length, entry.tokenSet.size)) return true;
          }
        }
        if (tokens.length === 1 && entry.tokenSet.has(tokens[0]) && tokens[0].length >= 4) {
          return true;
        }
      }
      return false;
    }

    function isLikelyInventoryLine(name, qty) {
      if (!Number.isFinite(qty) || qty <= 0) return false;
      const cleaned = tidyCandidateName(name);
      if (!cleaned) return false;
      const letters = (cleaned.match(/[a-z]/gi) || []).length;
      if (letters < 2) return false;
      const norm = normaliseItemLabel(cleaned);
      if (!norm || OCR_STOPWORDS.has(norm)) return false;
      const tokens = tokensFromNorm(norm);
      if (!tokens.length) return false;
      const informativeTokens = tokens.filter((t) => !OCR_STOPWORDS.has(t));
      if (!informativeTokens.length) return false;
      if (matchesKnownItem(norm, informativeTokens)) return true;
      if (informativeTokens.length >= 2) return true;
      if (informativeTokens.length === 1 && informativeTokens[0].length >= 4) return true;
      return false;
    }

    function parseLineToNameQty(raw) {
      const original = String(raw || "").trim();
      if (!original) return null;

      const normaliseQty = (val) => {
        const num = parseInt(val, 10);
        return Number.isFinite(num) && num > 0 ? num : null;
      };

      const sanitised = original.replace(/\|/g, " ").replace(/\t+/g, " ").replace(/\s{2,}/g, " ").trim();
      if (!sanitised) return null;

      const patterns = [
        {
          regex:
            /^(.*?)(?:\bqty|\bquantity)\s*[:\-]?\s*(\d{1,4})(?:\s*(?:pcs?|pieces?|units?|kg|kgs|g|grams|lbs?|lb|packs?|boxes?|bags?))?(?:\b.*)?$/i,
          type: "nameFirst",
        },
        {
          regex:
            /^(?:\bqty|\bquantity)\s*[:\-]?\s*(\d{1,4})(?:\s*(?:pcs?|pieces?|units?|kg|kgs|g|grams|lbs?|lb|packs?|boxes?|bags?))?[\s,;:*\\-|]+(.+)$/i,
          type: "qtyFirst",
        },
        {
          regex:
            /^(.*?)[\s,;:*\-xX]+(\d{1,4})(?:\s*(?:pcs?|pieces?|units?|kg|kgs|g|grams|lbs?|lb|packs?|boxes?|bags?))?$/i,
          type: "nameFirst",
        },
        {
          regex:
            /^(\d{1,4})(?:\s*(?:pcs?|pieces?|units?|kg|kgs|g|grams|lbs?|lb|packs?|boxes?|bags?))?[\s,;:*\-xX]+(.+)$/i,
          type: "qtyFirst",
        },
      ];

      for (const { regex, type } of patterns) {
        const match = sanitised.match(regex);
        if (!match) continue;
        const qty = normaliseQty(type === "nameFirst" ? match[2] : match[1]);
        let candidateName = type === "nameFirst" ? match[1] : match[2];
        candidateName = tidyCandidateName(candidateName);
        if (!candidateName || qty === null) continue;
        if (isLikelyInventoryLine(candidateName, qty)) {
          return { name: candidateName, qty };
        }
      }

      return null;
    }

    function buildPreviewRow(id, name, qty) {
      return `
        <tr data-id="${id}">
          <td><input type="text" class="form-control form-control-sm ocr-name" value="${name.replace(/"/g, "&quot;")}"></td>
          <td style="max-width:110px"><input type="number" class="form-control form-control-sm ocr-qty" min="1" value="${qty}"></td>
          <td class="text-end"><button type="button" class="btn btn-sm btn-outline-danger ocr-del" aria-label="Remove"><i class="bi bi-trash"></i></button></td>
        </tr>`;
    }

    function normaliseLines(text) {
      return String(text || "")
        .split(/\r?\n/)
        .map((line) => line.replace(/\s{2,}/g, " ").trim())
        .filter(Boolean);
    }

    async function extractTextFromImage(file, report) {
      if (!window.Tesseract || !Tesseract.recognize) {
        throw new Error("Image OCR library not loaded");
      }
      report("Recognizing text in image (this may take a few seconds)...");
      const result = await Tesseract.recognize(file, "eng", {
        logger: (msg) => {
          if (msg && typeof msg.progress === "number" && msg.status) {
            const pct = Math.round(msg.progress * 100);
            report(`${msg.status} ${pct}%`);
          }
        },
      });
      return result?.data?.text || "";
    }

    async function extractTextFromPdf(file, report) {
      if (!window.pdfjsLib) {
        throw new Error("PDF processing library not loaded");
      }
      try {
        if (window.pdfjsLib.GlobalWorkerOptions && !window.pdfjsLib.GlobalWorkerOptions.workerSrc) {
          window.pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js";
        }
      } catch (_) {}
      report("Reading PDF pages...");
      const buf = await file.arrayBuffer();
      const pdf = await window.pdfjsLib.getDocument({ data: buf }).promise;
      let text = "";
      for (let i = 1; i <= pdf.numPages; i += 1) {
        report(`Extracting text (page ${i}/${pdf.numPages})...`);
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        const strings = content.items ? content.items.map((item) => item.str || "") : [];
        text += strings.join(" ") + "\n";
      }
      return text;
    }

    async function extractTextFromFile(file, report) {
      const mime = (file && file.type ? String(file.type).toLowerCase() : "").trim();
      if (!file) throw new Error("No file selected");
      if (!mime || mime === "text/plain") {
        report("Reading text file...");
        return await file.text();
      }
      if (mime === "application/pdf" || file.name?.toLowerCase().endsWith(".pdf")) {
        return await extractTextFromPdf(file, report);
      }
      if (mime.startsWith("image/")) {
        return await extractTextFromImage(file, report);
      }
      // Fallback for edge cases: try text read
      try {
        report("Attempting to read file as text...");
        return await file.text();
      } catch (_) {
        throw new Error("Unsupported file type for OCR");
      }
    }

    function runOcrUpload(file) {
      const $status = $("#ocrStatus");
      const $preview = $("#ocrPreview");
      const $tbody = $("#ocrPreviewBody");
      const $apply = $("#ocrApplyBtn");
      $apply.prop("disabled", true);
      $preview.hide();
      $tbody.empty();
      const updateStatus = (msg) => {
        if (!msg) return;
        $status.text(msg).show();
      };
      updateStatus("Processing file...");
      extractTextFromFile(file, updateStatus)
        .then((text) => {
          const lines = normaliseLines(text);
          const parsed = [];
          for (const line of lines) {
            const p = parseLineToNameQty(line);
            if (p && p.name) parsed.push(p);
          }
          if (!parsed.length) {
            updateStatus("No items detected. Make sure each line has a name and quantity (e.g., 'Rice 10').");
            setTimeout(() => $status.fadeOut(4000), 500);
            $preview.hide();
            return;
          }
          $tbody.empty();
          let counter = 1;
          const MAX = 50;
          for (const it of parsed.slice(0, MAX)) {
            $tbody.append(buildPreviewRow(counter++, it.name, it.qty));
          }
          $apply.prop("disabled", false);
          $preview.show();
          updateStatus(`Parsed ${Math.min(parsed.length, MAX)} item(s). Review and click Apply.`);
          setTimeout(() => $status.fadeOut(4000), 800);
        })
        .catch((err) => {
          const message = err && err.message ? err.message : "OCR failed";
          updateStatus(message);
          setTimeout(() => $status.fadeOut(4000), 2000);
        });
    }

    $(document).on("click", "#ocrUploadBtn", function () {
      ensureKnownItemsLoaded();
      const $file = $("#ocrFile");
      if ($file.length) $file.trigger("click");
    });
    $(document).on("change", "#ocrFile", function () {
      ensureKnownItemsLoaded();
      const file = this.files && this.files[0];
      if (file) {
        runOcrUpload(file);
      }
    });
    $(document).on("click", ".ocr-del", function () {
      $(this).closest("tr").remove();
    });
    $(document).on("click", "#ocrApplyBtn", function () {
      const $rows = $("#ocrPreviewBody tr");
      if (!$rows.length) {
        showToast("No items to apply.", "warning");
        return;
      }
      const tabTrigger = document.querySelector("#tab-entry-tab");
      if (tabTrigger) new bootstrap.Tab(tabTrigger).show();
      $itemsContainer.empty();
      $rows.each(function () {
        const name = String($(this).find(".ocr-name").val() || "").trim();
        const qty = Math.max(1, parseInt($(this).find(".ocr-qty").val(), 10) || 1);
        if (!name) return;
        addItemRow();
        const $row = $itemsContainer.find(".item-row").last();
        const $select = $row.find(".item-name-select");
        const opt = new Option(name, name, true, true);
        $select.append(opt).trigger("change");
        $row.find(".item-qty").val(qty);
      });
      showToast("OCR items applied. Please set expiry dates then submit.", "info");
    });

    function validateForm() {
      let ok = true;
      $form.find(".is-invalid").removeClass("is-invalid");
      const rows = $itemsContainer.find(".item-row");
      if (rows.length === 0) {
        showToast("Add at least one donation item.", "danger");
        return false;
      }
      rows.each(function () {
        const $row = $(this);
        const name = String($row.find(".item-name-select").val() || "").trim();
        const qty = parseInt($row.find(".item-qty").val(), 10);
        const $expiryField = $row.find(".item-expiry");
        const expiry = String($expiryField.val() || "").trim();
        if (!name || name.length < 1) { $row.find(".item-name-select").addClass("is-invalid"); ok = false; }
        if (!qty || qty < 1) { $row.find(".item-qty").addClass("is-invalid"); ok = false; }
        if (!expiry) {
          $expiryField.addClass("is-invalid");
          ok = false;
        } else {
          enforceExpiryLead($expiryField, true);
        }
        // Category removed from form
      });
      return ok;
    }

    $submitBtn.on("click", function () {
      if (!validateForm()) return;
      const rows = $itemsContainer.find(".item-row");
      setSubmitting(true);
      const fd = new FormData();
      const donorIdVal = $donorSelect.length ? String($donorSelect.val() || "").trim() : "";
      if (donorIdVal !== "") {
        fd.append("donor_id", donorIdVal);
      }
      rows.each(function () {
        const $row = $(this);
        fd.append("name[]", String($row.find(".item-name-select").val() || "").trim());
        fd.append("quantity[]", $row.find(".item-qty").val());
        // Per-item procurement_type
        try {
          const mode = String($row.find('.item-mode').val() || 'donated').toLowerCase();
          fd.append('procurement_type[]', (mode === 'purchased' ? 'purchased' : 'donated'));
        } catch (_) {
          fd.append('procurement_type[]', 'donated');
        }
        const expiry = $row.find(".item-expiry").val();
        fd.append("expiry_date[]", expiry);
        // Removed category/unit/weight fields
        const c = $row.find(".item-cost").val();
        if (c !== null && c !== undefined && String(c) !== "") fd.append("total_cost[]", c); else fd.append("total_cost[]", "");
        fd.append("remarks[]", String($row.find(".item-remarks").val() || "").trim());
      });

      $.ajax({
        url: `${API_BASE_URL}/donations/index.php/batch`,
        method: "POST",
        data: fd,
        processData: false,
        contentType: false,
        dataType: "json",
        xhrFields: { withCredentials: true },
        success: function () {
          showToast("Donation submitted successfully", "success");
          try { $form[0].reset(); } catch (_) {}
          if ($donorSelect.length) {
            $donorSelect.val(null).trigger("change");
          }
          $itemsContainer.empty();
          addItemRow();
          const modal = bootstrap.Modal.getInstance($modal[0]);
          modal?.hide();
          // If inventory list is present, refresh
          try {
            if (typeof window.loadAndRender === "function") {
              window.loadAndRender(1);
            }
          } catch (_) {}
        },
        error: function (err) {
          const msg = err?.responseJSON?.error || "Failed to submit donation";
          showToast(msg, "danger");
        },
        complete: function () {
          setSubmitting(false);
        },
      });
    });

    // Ensure at least one row when modal opens and init selects
    $modal.on("shown.bs.modal", function () {
      initDonorSelect();
      expiryLeadToastShown = false;
      loadExpiryLeadTime();
      applyExpiryConstraints($itemsContainer.find(".item-expiry"));
      if ($itemsContainer.find(".item-row").length === 0) addItemRow();
      $itemsContainer.find(".item-row").each(function () {
        const $row = $(this);
        const $name = $row.find(".item-name-select");
        if ($name.length && !$name.hasClass("select2-hidden-accessible")) {
          initSelect2($name);
        }
      });
    });

    // Pre-create one row if content is present before opening
    if ($itemsContainer.length && $itemsContainer.find(".item-row").length === 0) {
      addItemRow();
    }
  });
})();
