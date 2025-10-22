(function () {
  "use strict";

  $(function () {
    const API_BASE_URL =
      typeof window.API_BASE_URL === "string" && window.API_BASE_URL
        ? window.API_BASE_URL
        : "/Capstone%20Project/php/api";

    const $modal = $("#donationModal");
    const $form = $("#donationForm");
    const $submitBtn = $("#submitDonationBtn");
    const $itemsContainer = $("#itemsContainer");
    const $addItemBtn = $("#addItemBtn");

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
        minimumInputLength: 1,
        dropdownParent: $modal,
        ajax: {
          delay: 250,
          url: `${API_BASE_URL}/donations/index.php/items`,
          dataType: "json",
          data: function (params) {
            const $row = $el.closest(".item-row");
            const cat = String($row.find(".item-cat").val() || "").trim();
            return { q: params.term || "", limit: 20, category: cat };
          },
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
          url: `${API_BASE_URL}/donations/index.php/categories`,
          dataType: "json",
          delay: 250,
          processResults: function (data) {
            const items = data && Array.isArray(data.items) ? data.items : [];
            return { results: items.map((t) => ({ id: t, text: t })) };
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
              <div class="col-6">
                <label class="form-label mb-1">Category</label>
                <select class="form-select form-select-sm item-cat" required>
                  <option value="">Select category</option>
                </select>
                <div class="invalid-feedback">Category is required.</div>
              </div>
              <div class="col-6">
                <label class="form-label mb-1">Item Name</label>
                  <select
                    class="form-select item-name-select"
                    data-placeholder="Search or type new"
                    required
                  ></select>
                  <div class="invalid-feedback">Item name is required.</div>
              </div>
            </div>
          </div>
          <div class="col-12">
            <div class="row g-3">
              <div class="col-6">
                <label class="form-label mb-1">Quantity</label>
                <input type="number" class="form-control form-control-sm item-qty" min="1" required />
                <div class="invalid-feedback">Min 1</div>
              </div>
              <div class="col-6">
                <label class="form-label mb-1">Unit</label>
                <select class="form-select form-select-sm item-unit">
                  <option value="">Select unit (optional)</option>
                  <option value="can">can</option>
                  <option value="pack">pack</option>
                  <option value="box">box</option>
                  <option value="piece">piece</option>
                  <option value="bottle">bottle</option>
                  <option value="kg">kg</option>
                  <option value="g">g</option>
                </select>
              </div>
            </div>
          </div>
          <div class="col-12">
            <div class="row g-3">
              <div class="col-4">
                <label class="form-label mb-1">Weight (kg)</label>
                <input type="number" step="0.001" min="0" class="form-control form-control-sm item-weight" placeholder="e.g., 2.5" />
              </div>
              <div class="col-4">
                <label class="form-label mb-1">Cost (₱)</label>
                <input type="number" step="0.01" min="0" class="form-control form-control-sm item-cost" placeholder="e.g., 150.00" />
              </div>
              <div class="col-4">
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
      initRowCategorySelect2($row);
      initSelect2($row.find(".item-name-select"));
    }
    function removeItemRow(btn) {
      $(btn).closest(".item-row").remove();
    }

    $addItemBtn.on("click", addItemRow);
    $itemsContainer.on("click", ".btn-outline-danger", function () {
      removeItemRow(this);
    });

    // Category affects item name suggestions
    $itemsContainer.on("change", ".item-cat", function () {
      const $row = $(this).closest(".item-row");
      const $name = $row.find(".item-name-select");
      $name.val(null).trigger("change");
    });

    // OCR logic (same endpoints and UX)
    function parseLineToNameQty(raw) {
      const s = String(raw || "").trim();
      if (!s) return null;
      let name = s,
        qty = 1;
      const rx = /(.*?)[xX*\-:\\s]+(\d{1,4})$/;
      const m = s.match(rx);
      if (m && m[1]) {
        name = m[1].trim();
        qty = parseInt(m[2], 10) || 1;
      }
      return { name, qty };
    }

    function buildPreviewRow(id, name, qty) {
      return `
        <tr data-id="${id}">
          <td><input type="text" class="form-control form-control-sm ocr-name" value="${name.replace(/"/g, "&quot;")}"></td>
          <td style="max-width:110px"><input type="number" class="form-control form-control-sm ocr-qty" min="1" value="${qty}"></td>
          <td class="text-end"><button type="button" class="btn btn-sm btn-outline-danger ocr-del" aria-label="Remove"><i class="bi bi-trash"></i></button></td>
        </tr>`;
    }

    function runOcrUpload(file) {
      const $status = $("#ocrStatus");
      const $preview = $("#ocrPreview");
      const $tbody = $("#ocrPreviewBody");
      const $apply = $("#ocrApplyBtn");
      const fd = new FormData();
      fd.append("file", file);
      $status.text("Uploading and parsing...").show();
      $.ajax({
        url: `${API_BASE_URL}/donations/index.php/ocr`,
        method: "POST",
        data: fd,
        processData: false,
        contentType: false,
        dataType: "json",
        xhrFields: { withCredentials: true },
        success: function (resp) {
          const lines = Array.isArray(resp?.data) ? resp.data : [];
          const parsed = [];
          for (const line of lines) {
            const p = parseLineToNameQty(line);
            if (p && p.name) parsed.push(p);
          }
          if (!parsed.length) {
            $status.text("No items detected. Ensure each line contains one item name.").fadeOut(4000);
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
          $status.text(`Parsed ${Math.min(parsed.length, MAX)} item(s). Review and click Apply.`).fadeOut(4000);
        },
        error: function (err) {
          const msg = err?.responseJSON?.error || "OCR failed";
          $status.text(msg).fadeOut(4000);
        },
      });
    }

    $(document).on("click", "#ocrUploadBtn", function () {
      const $file = $("#ocrFile");
      if ($file.length) $file.trigger("click");
    });
    $(document).on("change", "#ocrFile", function () {
      const file = this.files && this.files[0];
      if (file) runOcrUpload(file);
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
        const expiry = String($row.find(".item-expiry").val() || "").trim();
        const cat = String($row.find(".item-cat").val() || "").trim();
        if (!name || name.length < 1) { $row.find(".item-name-select").addClass("is-invalid"); ok = false; }
        if (!qty || qty < 1) { $row.find(".item-qty").addClass("is-invalid"); ok = false; }
        if (!expiry) { $row.find(".item-expiry").addClass("is-invalid"); ok = false; }
        if (!cat) { $row.find(".item-cat").addClass("is-invalid"); ok = false; }
      });
      return ok;
    }

    $submitBtn.on("click", function () {
      if (!validateForm()) return;
      const rows = $itemsContainer.find(".item-row");
      setSubmitting(true);
      const fd = new FormData();
      rows.each(function () {
        const $row = $(this);
        fd.append("name[]", String($row.find(".item-name-select").val() || "").trim());
        fd.append("quantity[]", $row.find(".item-qty").val());
        const unit = String($row.find(".item-unit").val() || "").trim();
        fd.append("unit[]", unit);
        const expiry = $row.find(".item-expiry").val();
        fd.append("expiry_date[]", expiry);
        fd.append("type[]", String($row.find(".item-cat").val() || "").trim());
        const w = $row.find(".item-weight").val();
        if (w !== null && w !== undefined && String(w) !== "") fd.append("total_weight[]", w); else fd.append("total_weight[]", "");
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
      if ($itemsContainer.find(".item-row").length === 0) addItemRow();
      $itemsContainer.find(".item-row").each(function () {
        const $row = $(this);
        initRowCategorySelect2($row);
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
