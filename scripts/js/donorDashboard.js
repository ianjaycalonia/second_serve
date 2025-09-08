(function () {
  "use strict";

  $(function () {
    // Ensure API base URL is defined (fallback to project path)
    const API_BASE_URL =
      typeof window.API_BASE_URL === 'string' && window.API_BASE_URL
        ? window.API_BASE_URL
        : '/Capstone%20Project/php/api';
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
            interaction: { mode: 'index', intersect: false },
            stacked: false,
            scales: { y: { beginAtZero: true, ticks: { precision: 0 } } },
            plugins: { legend: { position: 'bottom' } }
          },
        });
        return donorChart;
      } catch(_){ return null; }
    }

    function lastNDatesLabels(n){
      const labels = [];
      const fmt = (d) => d.toLocaleDateString(undefined, { month:'short', day:'numeric' });
      for (let i=n-1;i>=0;i--){
        const d = new Date(); d.setHours(0,0,0,0); d.setDate(d.getDate()-i);
        labels.push({ key: d.toISOString().slice(0,10), label: fmt(d) });
      }
      return labels;
    }

    function updateChartWith(items){
      const chart = ensureChart(); if (!chart) return;
      const days = lastNDatesLabels(7);
      // Build sets per day for distinct completed batches only
      const perDay = new Map(days.map(d => [d.key, new Set()]));
      if (Array.isArray(items)){
        for (const it of items){
          const s = (it.status||'').trim();
          const b = it.batch_id ? String(it.batch_id) : null;
          if (!b || s !== 'Completed') continue; // batch-based completed only
          const dt = it.created_at ? new Date(it.created_at) : null;
          if (!dt || isNaN(dt)) continue;
          dt.setHours(0,0,0,0);
          const key = dt.toISOString().slice(0,10);
          if (!perDay.has(key)) continue; // outside range
          perDay.get(key).add(b);
        }
      }
      const labels = days.map(d => d.label);
      const dataSeries = days.map(d => (perDay.get(d.key)?.size) || 0);
      const datasets = [
        {
          label: 'Donations Made (completed batches)',
          data: dataSeries,
          borderColor: '#00a0b0',
          backgroundColor: 'rgba(0,160,176,0.18)',
          pointBackgroundColor: '#00a0b0',
          pointBorderColor: '#00a0b0',
          tension: 0.35,
          fill: true,
          pointRadius: 3
        }
      ];
      chart.data.labels = labels;
      chart.data.datasets = datasets;
      chart.update();
    }

    // Donation modal + history logic
    const $modal = $("#donationModal");
    const $form = $("#donationForm");
    const $submitBtn = $("#submitDonationBtn");
    const $itemsContainer = $("#itemsContainer");
    const $addItemBtn = $("#addItemBtn");
    const $datalist = $("#itemsDatalist");

    // No image upload for donors anymore

    function initSelect2($el) {
      if (!$el || !$el.length || !$.fn.select2) return;
      $el.select2({
        tags: true, // allow new entries
        width: "100%",
        placeholder: $el.data("placeholder") || "Search or type new",
        minimumInputLength: 1,
        dropdownParent: $modal, // ensure dropdown displays inside modal
        ajax: {
          delay: 250,
          url: `${API_BASE_URL}/donations/index.php/items`,
          dataType: "json",
          data: function (params) {
            return { q: params.term || "", limit: 20 };
          },
          processResults: function (data) {
            const items = data && data.items ? data.items : [];
            return { results: items.map((n) => ({ id: n, text: n })) };
          },
          cache: true,
        },
        createTag: function (params) {
          const term = (params.term || "").trim();
          if (term === "") return null;
          return { id: term, text: term, newTag: true };
        },
      });
    }

    function initCategorySelect2() {
      const $cat = $("#donationType");
      if (!$cat.length || !$.fn.select2) return;
      // Initialize once
      if ($cat.hasClass('select2-hidden-accessible')) return;
      $cat.select2({
        width: '100%',
        placeholder: 'Select category',
        dropdownParent: $modal,
        tags: false,
        minimumResultsForSearch: 5 // show search when many
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
      <div class="card p-3 border item-row" data-id="${id}">
        <div class="row g-2 align-items-end">
          <div class="col-12 col-md-6">
            <label class="form-label mb-1">Item Name</label>
            <select class="form-select item-name-select" data-placeholder="Search or type new" required></select>
            <div class="invalid-feedback">Item name is required.</div>
          </div>
          <div class="col-6 col-md-2">
            <label class="form-label mb-1">Quantity</label>
            <input type="number" class="form-control item-qty" min="1" required>
            <div class="invalid-feedback">Min 1</div>
          </div>
          <div class="col-6 col-md-3">
            <label class="form-label mb-1">Expiry Date</label>
            <input type="date" class="form-control item-expiry">
          </div>
          <div class="col-12 col-md-1 text-end">
            <label class="form-label mb-1 d-none d-md-block">&nbsp;</label>
            <button type="button" class="btn btn-sm btn-outline-danger d-flex align-items-center justify-content-center w-100 w-md-auto" aria-label="Remove item">
              <i class="bi bi-trash"></i>
              <span class="ms-1 d-inline d-md-none">Remove</span>
            </button>
          </div>
        </div>
      </div>`;
    }

    let __rowId = 1;
    function addItemRow() {
      const id = __rowId++;
      $itemsContainer.append(itemRowTemplate(id));
      initSelect2(
        $itemsContainer.find(`.item-row[data-id="${id}"] .item-name-select`)
      );
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
      const type = $("#donationType").val();
      if (!type) {
        $("#donationType").addClass("is-invalid");
        ok = false;
      }
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
        if (!name) {
          $row.find(".item-name-select").addClass("is-invalid");
          ok = false;
        }
        if (!qty || qty < 1) {
          $row.find(".item-qty").addClass("is-invalid");
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
      fd.append("type", $("#donationType").val());
      rows.each(function () {
        const $row = $(this);
        fd.append(
          "name[]",
          String($row.find(".item-name-select").val() || "").trim()
        );
        fd.append("quantity[]", $row.find(".item-qty").val());
        const expiry = $row.find(".item-expiry").val();
        fd.append("expiry_date[]", expiry || "");
      });
      // No image field appended

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

    function renderMetricsFrom(items){
      try{
        // Total Donations Made: count DISTINCT completed batches only
        let total = 0;
        if (Array.isArray(items)){
          const set = new Set();
          for (const it of items){
            const s = (it.status||'').trim();
            if (it.batch_id && s === 'Completed') set.add(String(it.batch_id));
          }
          total = set.size;
        }
        const byStatus = items.reduce((acc, it) => { const s=(it.status||'').trim(); acc[s]=(acc[s]||0)+1; return acc; }, {});
        const pending = byStatus['Pending']||0;
        const allocated = byStatus['Allocated']||0; // treat as scheduled pickups
        const cancelled = byStatus['Cancelled']||0;
        const elTotal = document.getElementById('totalDonations');
        const elUpcoming = document.getElementById('upcomingDonations');
        const elPending = document.getElementById('activeDonors');
        const elCancelled = document.getElementById('activeRecipients');
        if (elTotal) elTotal.textContent = String(total);
        if (elUpcoming) elUpcoming.textContent = String(allocated);
        if (elPending) elPending.textContent = String(pending);
        if (elCancelled) elCancelled.textContent = String(cancelled);
      }catch(_e){}
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
      $itemsContainer.find(".item-name-select").each(function () {
        if (!$(this).hasClass("select2-hidden-accessible")) {
          initSelect2($(this));
        }
      });
      initCategorySelect2();
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
    fetchHistory(true);

    // If the modal content is already present before opening, prep the category select for better UX
    initCategorySelect2();
  });
})();
