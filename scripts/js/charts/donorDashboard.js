(function () {
  "use strict";

  $(function () {
    // Ensure API base URL is defined (fallback to project path)
    const API_BASE_URL =
      typeof window.API_BASE_URL === "string" && window.API_BASE_URL
        ? window.API_BASE_URL
        : "/Capstone%20Project/php/api";
    // Chart helpers
    let donorChart = null;
    function ensureChart() {
      try {
        const canvas = document.getElementById("lineChart");
        if (!canvas || !window.Chart) return null;
        if (donorChart) return donorChart;
        const ctx = canvas.getContext("2d");
        donorChart = new Chart(ctx, {
          type: "line",
          data: { labels: [], datasets: [] },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: "index", intersect: false },
            stacked: false,
            scales: { y: { beginAtZero: true, ticks: { precision: 0 } } },
            plugins: { legend: { position: "bottom" } },
          },
        });

        // OCR tab handlers
        function parseLineToNameQty(raw) {
          const s = String(raw || "").trim();
          if (!s) return null;
          let name = s,
            qty = 1;
          const rx = /(.*?)[xX*\-:\s]+(\d{1,4})$/;
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
          <td><input type="text" class="form-control form-control-sm ocr-name" value="${name.replace(
            /"/g,
            "&quot;"
          )}"></td>
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
                $status
                  .text(
                    "No items detected. Ensure each line contains one item name."
                  )
                  .fadeOut(4000);
                $preview.hide();
                return;
              }
              // Populate preview table
              $tbody.empty();
              let counter = 1;
              const MAX = 50;
              for (const it of parsed.slice(0, MAX)) {
                $tbody.append(buildPreviewRow(counter++, it.name, it.qty));
              }
              $apply.prop("disabled", false);
              $preview.show();
              $status
                .text(
                  `Parsed ${Math.min(
                    parsed.length,
                    MAX
                  )} item(s). Review and click Apply.`
                )
                .fadeOut(4000);
            },
            error: function (err) {
              const msg = err?.responseJSON?.error || "OCR failed";
              $status.text(msg).fadeOut(4000);
            },
          });
        }

        // Click upload -> open file picker
        $(document).on("click", "#ocrUploadBtn", function () {
          const $file = $("#ocrFile");
          if ($file.length) {
            $file.trigger("click");
          }
        });

        // Auto-start upload when a file is selected
        $(document).on("change", "#ocrFile", function () {
          const file = this.files && this.files[0];
          if (file) {
            runOcrUpload(file);
          }
        });

        // Remove row in preview
        $(document).on("click", ".ocr-del", function () {
          $(this).closest("tr").remove();
        });

        // Apply preview to Normal Entry tab
        $(document).on("click", "#ocrApplyBtn", function () {
          const $rows = $("#ocrPreviewBody tr");
          if (!$rows.length) {
            showToast("No items to apply.", "warning");
            return;
          }
          // Switch to Normal Entry
          const tabTrigger = document.querySelector("#tab-entry-tab");
          if (tabTrigger) new bootstrap.Tab(tabTrigger).show();
          // Clear and add items
          $itemsContainer.empty();
          $rows.each(function () {
            const name = String($(this).find(".ocr-name").val() || "").trim();
            const qty = Math.max(
              1,
              parseInt($(this).find(".ocr-qty").val(), 10) || 1
            );
            if (!name) return;
            addItemRow();
            const $row = $itemsContainer.find(".item-row").last();
            const $select = $row.find(".item-name-select");
            const opt = new Option(name, name, true, true);
            $select.append(opt).trigger("change");
            $row.find(".item-qty").val(qty);
            // Expiry left empty for donor to fill (required)
          });
          showToast(
            "OCR items applied. Please set expiry dates then submit.",
            "info"
          );
        });
        return donorChart;
      } catch (_) {
        return null;
      }
    }

    function lastNDatesLabels(n) {
      const labels = [];
      const fmt = (d) =>
        d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
      for (let i = n - 1; i >= 0; i--) {
        const d = new Date();
        d.setHours(0, 0, 0, 0);
        d.setDate(d.getDate() - i);
        labels.push({ key: d.toISOString().slice(0, 10), label: fmt(d) });
      }
      return labels;
    }

    function updateChartWith(items) {
      const chart = ensureChart();
      if (!chart) return;
      const days = lastNDatesLabels(7);
      // Build sets per day for distinct completed batches only
      const perDay = new Map(days.map((d) => [d.key, new Set()]));
      if (Array.isArray(items)) {
        for (const it of items) {
          const s = (it.status || "").trim();
          const b = it.batch_id ? String(it.batch_id) : null;
          if (!b || s !== "Completed") continue; // batch-based completed only
          const dt = it.created_at ? new Date(it.created_at) : null;
          if (!dt || isNaN(dt)) continue;
          dt.setHours(0, 0, 0, 0);
          const key = dt.toISOString().slice(0, 10);
          if (!perDay.has(key)) continue; // outside range
          perDay.get(key).add(b);
        }
      }
      const labels = days.map((d) => d.label);
      const dataSeries = days.map((d) => perDay.get(d.key)?.size || 0);
      const datasets = [
        {
          label: "Donations Made (completed batches)",
          data: dataSeries,
          borderColor: "#00a0b0",
          backgroundColor: "rgba(0,160,176,0.18)",
          pointBackgroundColor: "#00a0b0",
          pointBorderColor: "#00a0b0",
          tension: 0.35,
          fill: true,
          pointRadius: 3,
        },
      ];
      chart.data.labels = labels;
      chart.data.datasets = datasets;
      chart.update();
    }

    // Summary wiring via donor_summary API (faster, scoped to donor)
    function updateTilesFromSummary(totals) {
      try {
        const elTotal = document.getElementById("totalDonations");
        const elUpcoming = document.getElementById("upcomingDonations");
        const elPending = document.getElementById("activeDonors");
        const elCancelled = document.getElementById("activeRecipients");
        if (elTotal) elTotal.textContent = String(totals?.total ?? 0);
        if (elUpcoming)
          elUpcoming.textContent = String(totals?.upcoming_pickups ?? 0);
        if (elPending) elPending.textContent = String(totals?.pending ?? 0);
        if (elCancelled)
          elCancelled.textContent = String(totals?.cancelled ?? 0);
      } catch (_) {}
    }

    function updateChartFromSummary(trend) {
      const chart = ensureChart();
      if (!chart) return;
      try {
        const labels = Array.isArray(trend?.labels) ? trend.labels : [];
        const data = Array.isArray(trend?.data) ? trend.data : [];
        chart.data.labels = labels;
        chart.data.datasets = [
          {
            label: "Donations Made (completed batches) ",
            data: data,
            borderColor: "#00a0b0",
            backgroundColor: "rgba(0,160,176,0.18)",
            pointBackgroundColor: "#00a0b0",
            pointBorderColor: "#00a0b0",
            tension: 0.35,
            fill: true,
            pointRadius: 3,
          },
        ];
        chart.update();
      } catch (_) {}
    }

    function fetchSummary() {
      $.ajax({
        url: `${API_BASE_URL}/dashboard/donor_summary.php`,
        method: "GET",
        dataType: "json",
        xhrFields: { withCredentials: true },
        success: function (resp) {
          const totals = resp?.data?.totals || {};
          const trend = resp?.data?.trend || {};
          updateTilesFromSummary(totals);
          updateChartFromSummary(trend);
        },
        error: function () {
          // Fallback to history-based computation
          fetchHistory(true);
        },
      });
    }

    // Donation modal + history logic
    const $modal = $("#donationModal");
    const TAXO_BASE_URL = `${API_BASE_URL}/taxonomy/index.php`;
    const $form = $("#donationForm");
    const $submitBtn = $("#submitDonationBtn");
    const $itemsContainer = $("#itemsContainer");
    const $addItemBtn = $("#addItemBtn");
    const $datalist = $("#itemsDatalist");

    // Unit selection removed from donor modal

    // No image upload for donors anymore

    function initSelect2($el) {
      if (!$el || !$el.length || !$.fn.select2) return;
      $el.select2({
        tags: true, // allow new entries, but we'll validate length
        width: "100%",
        placeholder: $el.data("placeholder") || "Search or type new",
        minimumInputLength: 0,
        dropdownParent: $modal, // ensure dropdown displays inside modal
        ajax: {
          delay: 250,
          url: `${API_BASE_URL}/donations/index.php/items`,
          dataType: "json",
          data: function (params) {
            const $row = $el.closest(".item-row");
            const catId = String($row.find('.item-cat').val() || '').trim();
            return { q: params.term || "", limit: 20, category_id: catId };
          },
          processResults: function (data) {
            const items = data && data.items ? data.items : [];
            return { results: items.map((n) => ({ id: n, text: n })) };
          },
          xhrFields: { withCredentials: true },
          error: function (xhr) {
            try {
              const msg =
                xhr?.responseJSON?.error || "Failed to load item suggestions";
              // Non-intrusive console warning to aid debugging if suggestions fail (e.g., not authenticated)
              console.warn("Select2 items AJAX error:", msg);
            } catch (_) {
              /* ignore */
            }
          },
          cache: true,
        },
        createTag: function (params) {
          const term = (params.term || "").trim();
          if (term.length < 1) return null; // enforce min length for free-typed names (>=1)
          return { id: term, text: term, newTag: true };
        },
      });
      // Trigger initial fetch when the dropdown opens
      $el.on('select2:open', function(){
        const $search = $(".select2-container--open .select2-search__field");
        if ($search.length) { $search.trigger('input'); }
      });
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

    // (Image upload removed for donors)

    // Dynamic items UI
    function itemRowTemplate(id) {
      return `
      <div class="card card-accent p-3 item-row donation-card" data-id="${id}">
        <div class="row g-3 gap-2 align-items-center">
          <div class="col-12">
            <div class="row g-3">
              <div class="col-6">
                <label class="form-label mb-1">Item Name</label>
                  <select
                    class="form-select item-name-select"
                    data-placeholder="Search or type new"
                    required
                  ></select>
                  <div class="invalid-feedback">Item name is required.</div>
              </div>
              <div class="col-6">
                <label class="form-label mb-1">Quantity</label>
                <input type="number" class="form-control form-control-sm item-qty" min="1" required />
                <div class="invalid-feedback">Min 1</div>
              </div>
            </div>
          </div>
          <div class="col-12">
            <div class="row g-3">
              <div class="col-6">
                <label class="form-label mb-1">Cost (₱)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  class="form-control form-control-sm item-cost"
                  placeholder="e.g., 150.00"
                />
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
            <input
              type="text"
              class="form-control form-control-sm item-remarks"
              maxlength="500"
              placeholder="Optional notes for this item"
            />
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
    }
    function removeItemRow(btn) {
      $(btn).closest(".item-row").remove();
    }

    $addItemBtn.on("click", addItemRow);
    $itemsContainer.on("click", ".btn-outline-danger", function () {
      removeItemRow(this);
    });

    function showToast(msg, variant) {
      try {
        const body = document.getElementById("toastBody");
        body.textContent = msg || "Done";
        const el = document.getElementById("feedbackToast");
        el.className =
          "toast align-items-center text-bg-" +
          (variant || "dark") +
          " border-0";
        bootstrap.Toast.getOrCreateInstance(el).show();
      } catch (_) {
        alert(msg);
      }
    }

    function validateForm() {
      let ok = true;
      $form.find(".is-invalid").removeClass("is-invalid");
      $("#donationType").removeClass("is-invalid");
      // At least one item row
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
        if (!name || name.length < 1) {
          $row.find(".item-name-select").addClass("is-invalid");
          ok = false;
        }
        if (!qty || qty < 1) {
          $row.find(".item-qty").addClass("is-invalid");
          ok = false;
        }
        if (!expiry) {
          $row.find(".item-expiry").addClass("is-invalid");
          ok = false;
        }
      });
      return ok;
    }

    // Submit: single multipart request to /batch with arrays for items (no images)
    $submitBtn.on("click", function () {
      if (!validateForm()) return;
      const rows = $itemsContainer.find(".item-row");
      setSubmitting(true);
      const fd = new FormData();
      rows.each(function () {
        const $row = $(this);
        fd.append(
          "name[]",
          String($row.find(".item-name-select").val() || "").trim()
        );
        fd.append("quantity[]", $row.find(".item-qty").val());
        const expiry = $row.find(".item-expiry").val();
        fd.append("expiry_date[]", expiry);
        // No category/unit/weight fields submitted; backend infers them by item name
        const c = $row.find(".item-cost").val();
        if (c !== null && c !== undefined && String(c) !== "")
          fd.append("total_cost[]", c);
        else fd.append("total_cost[]", "");
        fd.append(
          "remarks[]",
          String($row.find(".item-remarks").val() || "").trim()
        );
      });
      // No image field appended; no batch-level category/remarks

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
          $form[0].reset();
          $itemsContainer.empty();
          addItemRow();
          const modal = bootstrap.Modal.getInstance($modal[0]);
          modal?.hide();
          // nothing to reset related to images
          fetchHistory(true);
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

    // History listing with simple pagination
    const PAGE_SIZE = 3; // Only show last 3 batches on dashboard
    let __items = [];
    let __page = 1;

    function badge(status) {
      switch (status) {
        case "Pending":
          return '<span class="badge bg-warning text-dark">Pending</span>';
        case "Allocated":
          return '<span class="badge bg-info text-dark">Allocated</span>';
        case "Completed":
          return '<span class="badge bg-success">Completed</span>';
        case "Cancelled":
          return '<span class="badge bg-secondary">Cancelled</span>';
        default:
          return `<span class="badge bg-light text-dark">${
            status || "Unknown"
          }</span>`;
      }
    }

    function fmtDate(s) {
      if (!s) return "";
      const d = new Date(s);
      return isNaN(d) ? s : d.toLocaleDateString();
    }

    function imageCell(url) {
      if (!url) return "";
      const safe = String(url).replace(/"/g, "&quot;");
      return `<a href="${safe}" target="_blank" rel="noopener" class="d-inline-flex align-items-center flex-shrink-0"><img src="${safe}" class="img-thumbnail" style="max-height:40px; width:auto"></a>`;
    }

    // (removed unused donation-history helpers)

    function renderMetricsFrom(items) {
      try {
        // Total Donations Made: count DISTINCT completed batches only
        let total = 0;
        if (Array.isArray(items)) {
          const set = new Set();
          for (const it of items) {
            const s = (it.status || "").trim();
            if (it.batch_id && s === "Completed") set.add(String(it.batch_id));
          }
          total = set.size;
        }
        // Pending Donations: count DISTINCT batches that have at least one 'Pending' item
        let pending = 0;
        if (Array.isArray(items)) {
          const pendingBatches = new Set();
          for (const it of items) {
            const s = (it.status || "").trim();
            if (s === "Pending" && it.batch_id) {
              pendingBatches.add(String(it.batch_id));
            }
          }
          pending = pendingBatches.size;
        }
        // Scheduled Pickups: count DISTINCT batches in 'Acknowledged' (pickup to be scheduled/ongoing)
        let allocated = 0;
        if (Array.isArray(items)) {
          const ackBatches = new Set();
          for (const it of items) {
            const s = (it.status || "").trim();
            if (s === "Acknowledged" && it.batch_id) {
              ackBatches.add(String(it.batch_id));
            }
          }
          allocated = ackBatches.size;
        }
        // For cancelled, keep simple item counts (unchanged)
        const byStatus = items.reduce((acc, it) => {
          const s = (it.status || "").trim();
          acc[s] = (acc[s] || 0) + 1;
          return acc;
        }, {});
        const cancelled = byStatus["Cancelled"] || 0;
        const elTotal = document.getElementById("totalDonations");
        const elUpcoming = document.getElementById("upcomingDonations");
        const elPending = document.getElementById("activeDonors");
        const elCancelled = document.getElementById("activeRecipients");
        if (elTotal) elTotal.textContent = String(total);
        if (elUpcoming) elUpcoming.textContent = String(allocated);
        if (elPending) elPending.textContent = String(pending);
        if (elCancelled) elCancelled.textContent = String(cancelled);
      } catch (_e) {}
    }

    // (removed unused donation-history rendering)

    // (removed unused spinner toggling)

    function fetchHistory(reset) {
      if (reset) __page = 1;
      $.ajax({
        url: `${API_BASE_URL}/donations/index.php/list`,
        method: "GET",
        dataType: "json",
        xhrFields: { withCredentials: true },
        success: function (resp) {
          const items = resp?.data?.items || [];
          // Update metrics for this donor
          renderMetricsFrom(items);
          // Update chart to reflect live metrics
          updateChartWith(items);
        },
        error: function (err) {
          showToast(
            err.responseJSON?.error || "Failed to load history",
            "danger"
          );
        },
        complete: function () {},
      });
    }

    // (removed unused donation-history events)

    // (removed modal-specific donation-history rendering)

    // When modal becomes visible, ensure at least one item row exists and init Select2
    $modal.on("shown.bs.modal", function () {
      if ($itemsContainer.find(".item-row").length === 0) addItemRow();
      $itemsContainer.find(".item-row").each(function () {
        const $row = $(this);
        const $name = $row.find(".item-name-select");
        if ($name.length && !$name.hasClass("select2-hidden-accessible")) {
          initSelect2($name);
        }
      });
    });

    // History listing remains defined above; no duplicates below

    // Safety: if modal content is already in DOM, pre-create one row once on ready
    if (
      $itemsContainer.length &&
      $itemsContainer.find(".item-row").length === 0
    ) {
      addItemRow();
    }

    // Initial load
    fetchSummary();
    // Keep history fetch as fallback/refresh for detailed views
    fetchHistory(true);

    // If content exists pre-open, ensure row selects are initialized
    // No category/unit initialization needed on ready
  });
})();
