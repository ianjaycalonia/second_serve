/* eslint-disable no-undef */
(function () {
  "use strict";

  const API_BASE_URL =
    typeof window.API_BASE_URL === "string" && window.API_BASE_URL
      ? window.API_BASE_URL
      : "/php/api";

  const PICKUP_STATUSES = new Set(["Picked Up", "Completed"]);

  let donationRecords = [];
  let filteredRecords = [];
  let donationLineChart = null;
  let pickupBarChart = null;
  let currentTimeframe = 'daily';

  const volumeState = {
    donations: {
      timeframe: 'daily',
      labels: [],
      values: [],
      loading: false
    },
    pickups: {
      timeframe: 'daily',
      labels: [],
      values: [],
      loading: false
    }
  };

  function pad2(num) {
    return String(num).padStart(2, "0");
  }

  function sanitizeFilename(name) {
    return name.replace(/[<>:"/\\|?*]+/g, "").replace(/\s{2,}/g, " ").trim();
  }

  function buildExportFilename(prefix, isoStart, fallback) {
    try {
      if (isoStart) {
        const dt = new Date(`${isoStart}T00:00:00`);
        if (!Number.isNaN(dt.getTime())) {
          const monthName = dt.toLocaleString(undefined, { month: "long" });
          const year = dt.getFullYear();
          const raw = `${prefix} ${monthName}, ${year}.xlsx`;
          return sanitizeFilename(raw);
        }
      }
    } catch (_) {}
    const raw = `${prefix} ${fallback || "export"}.xlsx`;
    return sanitizeFilename(raw);
  }

  function getMonthRange() {
    const input = document.getElementById("exportMonthInput");
    let baseDate = null;
    if (input && input.value) {
      const parsed = new Date(`${input.value}-01T00:00:00`);
      if (!Number.isNaN(parsed.getTime())) {
        baseDate = parsed;
      }
    }
    if (!baseDate) {
      baseDate = new Date();
    }
    const year = baseDate.getFullYear();
    const monthIdx = baseDate.getMonth(); // 0-based
    const nextMonth = new Date(year, monthIdx + 1, 1);
    const endDate = new Date(nextMonth - 1).getDate();
    const monthStr = pad2(monthIdx + 1);
    const start = `${year}-${monthStr}-01`;
    const end = `${year}-${monthStr}-${pad2(endDate)}`;
    return { start, end };
  }

  function getTimeframeRange(timeframe) {
    const end = new Date();
    end.setHours(23, 59, 59, 999);
    const start = new Date(end);
    switch ((timeframe || '').toLowerCase()) {
      case 'weekly':
        start.setDate(end.getDate() - 6);
        break;
      case 'monthly':
        start.setDate(end.getDate() - 29);
        break;
      case 'yearly':
        start.setDate(end.getDate() - 364);
        break;
      case 'daily':
      default:
        // same day
        break;
    }
    start.setHours(0, 0, 0, 0);
    return { start, end };
  }

  async function fetchJson(url, options = {}) {
    const res = await fetch(url, {
      credentials: "include",
      headers: { Accept: "application/json", ...(options.headers || {}) },
      ...options,
    });
    const data = await res
      .json()
      .catch(() => ({ success: false, error: `HTTP ${res.status}` }));
    if (!res.ok || data?.success === false) {
      const message = data?.error || `HTTP ${res.status}`;
      throw new Error(message);
    }
    return data;
  }

  function ensureToastContainer() {
    let container = document.getElementById("reportsToastContainer");
    if (!container) {
      container = document.createElement("div");
      container.id = "reportsToastContainer";
      container.className = "toast-container position-fixed top-0 end-0 p-3";
      document.body.appendChild(container);
    }
    return container;
  }

  function showToast(message, variant = "success", delayMs = 2400) {
    try {
      const container = ensureToastContainer();
      const color = variant === "danger" ? "danger" : variant === "warning" ? "warning" : "success";
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
      const toast = bootstrap.Toast.getOrCreateInstance(toastEl, {
        delay: delayMs,
        autohide: true,
      });
      toastEl.addEventListener("hidden.bs.toast", () => {
        toast.dispose();
        toastEl.remove();
      });
      toast.show();
    } catch (err) {
      console.warn("Toast display failed", err);
    }
  }

  function formatIsoDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function timeframeLabel(tf) {
    if (!tf) return '';
    return tf.charAt(0).toUpperCase() + tf.slice(1);
  }

  async function fetchVolumeData(type, timeframe) {
    const params = new URLSearchParams({ type, timeframe });
    const resp = await fetchJson(`${API_BASE_URL}/reports/volume.php?${params.toString()}`);
    if (!resp?.success) {
      throw new Error(resp?.error || 'Failed to load volume data');
    }
    const series = resp?.data?.series || {};
    const labels = Array.isArray(series.labels) ? series.labels : [];
    const values = Array.isArray(series.values) ? series.values.map((v) => Number(v) || 0) : [];
    return { labels, values };
  }

  async function loadVolumeSection(kind) {
    const state = volumeState[kind];
    if (!state) return;
    state.loading = true;
    try {
      const { labels, values } = await fetchVolumeData(kind === 'donations' ? 'donations' : 'pickups', state.timeframe);
      state.labels = labels;
      state.values = values;
    } catch (err) {
      console.error(`Failed to load ${kind} volume`, err);
      state.labels = [];
      state.values = [];
    } finally {
      state.loading = false;
      if (kind === 'donations') {
        renderDonationChart();
      } else {
        renderPickupChart();
      }
    }
  }

  async function exportIn() {
    try {
      const { start, end } = getMonthRange();
      const url = new URL(
        `${API_BASE_URL}/inventory/index.php/report-in`,
        window.location.origin
      );
      url.searchParams.set("start", start);
      url.searchParams.set("end", end);
      url.searchParams.set("t", String(Date.now()));
      const resp = await fetchJson(url.toString());
      const rows = Array.isArray(resp?.data?.rows) ? resp.data.rows : [];
      const headers = [
        "ENTRY DATE",
        "DONATED/PURCHASED",
        "DONOR NAME",
        "DONOR CATEGORY",
        "PRODUCT NAME",
        "PRODUCT CATEGORY",
        "QUANTITY",
        "PACKED BY",
        "TOTAL WEIGHT(KG)",
        "TOTAL COST(P)",
        "EXPIRY DATE",
        "ENTRY BY",
      ];
      const aoa = [headers, ...rows.map((r) => headers.map((h) => r[h] ?? ""))];
      const ws = XLSX.utils.aoa_to_sheet(aoa);

      const headerStyle = {
        fill: {
          patternType: "solid",
          fgColor: { rgb: "C6EFCE" },
        },
        font: {
          bold: true,
          color: { rgb: "000000" },
        },
        alignment: {
          horizontal: "center",
          vertical: "center",
        },
      };
      headers.forEach((_, idx) => {
        const cellAddress = XLSX.utils.encode_cell({ r: 0, c: idx });
        const cell = ws[cellAddress];
        if (cell) {
          cell.s = headerStyle;
        }
      });

      ws["!cols"] = [
        { wch: 14 },
        { wch: 18 },
        { wch: 24 },
        { wch: 18 },
        { wch: 28 },
        { wch: 26 },
        { wch: 10 },
        { wch: 16 },
        { wch: 16 },
        { wch: 14 },
        { wch: 14 },
        { wch: 22 },
      ];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Product In");
      const fname = buildExportFilename(
        "Product In",
        resp?.data?.start || start,
        `${resp?.data?.start || start}_${resp?.data?.end || end}`
      );
      XLSX.writeFile(wb, fname, { cellStyles: true });
      const modalEl = document.getElementById("exportModal");
      if (modalEl) {
        const modalInstance =
          bootstrap.Modal.getInstance(modalEl) ||
          bootstrap.Modal.getOrCreateInstance(modalEl);
        modalInstance.hide();
      }
      showToast("Product In report exported.");
    } catch (err) {
      console.error("Export Product In failed", err);
      alert(`Export In failed: ${err?.message || "Unknown error"}`);
    }
  }

  async function exportOut() {
    try {
      const { start, end } = getMonthRange();
      const url = new URL(
        `${API_BASE_URL}/inventory/index.php/report-out`,
        window.location.origin
      );
      url.searchParams.set("start", start);
      url.searchParams.set("end", end);
      url.searchParams.set("t", String(Date.now()));
      const resp = await fetchJson(url.toString());
      const rows = Array.isArray(resp?.data?.rows) ? resp.data.rows : [];
      const headers = [
        "DATE",
        "BENEFICIARY AGENCY",
        "PRODUCT NAME",
        "PRODUCT CATEGORY",
        "QUANTITY",
        "UNIT",
        "TOTAL WEIGHT (KG)",
        "ENTRY BY",
      ];
      const currentUserName = (() => {
        try {
          const stored = sessionStorage.getItem("user");
          if (!stored) return "";
          const parsed = JSON.parse(stored);
          return parsed?.name || "";
        } catch (_) {
          return "";
        }
      })();
      const aoa = [
        headers,
        ...rows.map((r) =>
          headers.map((h) => {
            if (h === "TOTAL WEIGHT (KG)") {
              const raw = r[h];
              if (typeof raw === "number" && Number.isFinite(raw)) {
                return Number(raw.toFixed(3));
              }
              const parsed = parseFloat(raw);
              return Number.isFinite(parsed) ? Number(parsed.toFixed(3)) : "";
            }
            if (h === "ENTRY BY") {
              return currentUserName || r[h] || "";
            }
            return r[h] ?? "";
          })
        ),
      ];
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      const headerStyle = {
        fill: {
          patternType: "solid",
          fgColor: { rgb: "BDD7EE" },
        },
        font: {
          bold: true,
          color: { rgb: "000000" },
        },
        alignment: {
          horizontal: "center",
          vertical: "center",
        },
      };
      headers.forEach((_, idx) => {
        const cellAddress = XLSX.utils.encode_cell({ r: 0, c: idx });
        const cell = ws[cellAddress];
        if (cell) {
          cell.s = headerStyle;
        }
      });
      ws["!cols"] = [
        { wch: 12 },
        { wch: 28 },
        { wch: 24 },
        { wch: 26 },
        { wch: 12 },
        { wch: 10 },
        { wch: 16 },
        { wch: 26 },
      ];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Product Out");
      const fname = buildExportFilename(
        "Product Out",
        resp?.data?.start || start,
        `${resp?.data?.start || start}_${resp?.data?.end || end}`
      );
      XLSX.writeFile(wb, fname, { cellStyles: true });
      const modalEl = document.getElementById("exportModal");
      if (modalEl) {
        const modalInstance =
          bootstrap.Modal.getInstance(modalEl) ||
          bootstrap.Modal.getOrCreateInstance(modalEl);
        modalInstance.hide();
      }
      showToast("Product Out report exported.");
    } catch (err) {
      alert(`Export Out failed: ${err?.message || "Unknown error"}`);
    }
  }

  async function loadPickupTotals(timeframe) {
    try {
      const range = getTimeframeRange(timeframe || currentTimeframe);
      const start = formatIsoDate(range.start);
      const end = formatIsoDate(range.end);
      const url = new URL(
        `${API_BASE_URL}/inventory/index.php/report-out`,
        window.location.origin
      );
      url.searchParams.set("start", start);
      url.searchParams.set("end", end);
      url.searchParams.set("t", String(Date.now()));
      const resp = await fetchJson(url.toString());
      const rows = Array.isArray(resp?.data?.rows) ? resp.data.rows : [];
      const seenGroups = new Set();
      const seenMovements = new Set();
      const totals = { quantity: 0, weight: 0, count: 0, groupCount: 0, movementCount: 0 };

      for (const row of rows) {
        // Unique pickup grouping (recipient + date)
        const recipientId = row?.RECIPIENT_ID ?? row?.recipient_id ?? row?.recipient_user_id ?? null;
        const dateOut = row?.DATE ?? row?.date_out ?? row?.created_at ?? null;
        const normalizedDate = dateOut ? String(dateOut).slice(0, 10) : '';
        const groupKey = `${recipientId ?? 'unknown'}|${normalizedDate}`;
        if (!seenGroups.has(groupKey)) {
          seenGroups.add(groupKey);
          totals.groupCount += 1;
        }
        totals.count += 1;

        // Aggregate strictly by movement to avoid double counting with repack expansion
        const movementId = row?.MOVEMENT_ID ?? row?.movement_id ?? row?.Movement_ID ?? null;
        // Prefer precise movement metadata; fall back to row-level values if missing
        let weightRaw = row?.MOVEMENT_WEIGHT;
        if (weightRaw == null) {
          weightRaw = row?.["TOTAL WEIGHT (KG)"] ?? row?.TOTAL_WEIGHT_KG ?? row?.total_weight ?? row?.total_weight_kg ?? null;
        }
        let qtyRaw = row?.MOVEMENT_QTY;
        if (qtyRaw == null) {
          qtyRaw = row?.QUANTITY ?? row?.quantity ?? null;
        }

        const parseNum = (v) => (typeof v === 'number' ? v : v != null ? parseFloat(v) : NaN);
        const weightNum = parseNum(weightRaw);
        const qtyNum = parseNum(qtyRaw);

        if (movementId != null) {
          if (!seenMovements.has(String(movementId))) {
            seenMovements.add(String(movementId));
            totals.movementCount += 1;
            if (Number.isFinite(weightNum)) totals.weight += weightNum;
            if (Number.isFinite(qtyNum)) totals.quantity += qtyNum;
          }
        } else {
          // Legacy fallback: no movement id; add row-level values directly
          if (Number.isFinite(weightNum)) totals.weight += weightNum;
          if (Number.isFinite(qtyNum)) totals.quantity += qtyNum;
        }
      }

      const totalPickupsEl = document.getElementById("totalPickups");
      if (totalPickupsEl) {
        totalPickupsEl.textContent = formatNumber(totals.groupCount || totals.count);
      }

      const totalWeightEl = document.getElementById("totalWeightKg");
      if (totalWeightEl) {
        totalWeightEl.textContent = formatNumber(totals.weight, {
          minimumFractionDigits: 0,
          maximumFractionDigits: 2,
        });
        try {
          const small = totalWeightEl.parentElement?.querySelector('small');
          if (small) small.textContent = timeframeLabel(timeframe || currentTimeframe);
        } catch(_) {}
      }

      const avgValueEl = document.getElementById("avgDonationValue");
      if (avgValueEl) {
        // Average weight per Product Out movement
        const divisor = totals.movementCount > 0 ? totals.movementCount : (seenGroups.size || totals.count);
        const avg = divisor > 0 ? totals.weight / divisor : 0;
        avgValueEl.textContent = formatNumber(avg, { maximumFractionDigits: 2 });
      }
    } catch (err) {
      console.error("Failed to load pickup totals", err);
    }
  }

  function formatNumber(val, options = {}) {
    const num = Number(val);
    if (!Number.isFinite(num)) return "0";
    return num.toLocaleString(undefined, options);
  }

  function normalizeDonation(record) {
    return {
      id: record?.id ?? null,
      donor: record?.donor_org || record?.donor_name || "—",
      recipient: record?.recipient_name || "—",
      item: record?.name || "—",
      quantity: Number(record?.quantity ?? 0) || 0,
      status: record?.status || "Unknown",
      created_at: record?.created_at || null,
      notes: record?.remarks || record?.note || "",
      is_group: Boolean(record?.is_group),
    };
  }

  function filterRecordsByTimeframe(records, timeframe) {
    if (!Array.isArray(records) || !records.length) return [];
    const { start, end } = getTimeframeRange(timeframe || currentTimeframe);
    return records.filter((rec) => {
      if (!rec?.created_at) return false;
      const dt = new Date(rec.created_at);
      if (Number.isNaN(dt.getTime())) return false;
      return dt >= start && dt <= end;
    });
  }

  async function loadAnalytics(timeframe) {
    try {
      const summaryPromise = fetchJson(
        `${API_BASE_URL}/dashboard/summary.php`
      ).catch(() => ({ data: { totals: {} } }));
      const donationsPromise = fetchJson(
        `${API_BASE_URL}/donations/index.php/list?group=batch`
      );
      const [summaryResp, donationsResp] = await Promise.all([
        summaryPromise,
        donationsPromise,
      ]);

      const totals = summaryResp?.data?.totals || {};
      const items = Array.isArray(donationsResp?.data?.items)
        ? donationsResp.data.items
        : Array.isArray(donationsResp?.items)
        ? donationsResp.items
        : [];

      donationRecords = items.map(normalizeDonation);
      filteredRecords = filterRecordsByTimeframe(donationRecords, timeframe);
      updateTiles(totals, filteredRecords);
    } catch (err) {
      console.error("Failed to load analytics", err);
      filteredRecords = [];
    }
  }

  function updateTiles(totals, records) {
    const totalDonationsEl = document.getElementById("totalDonations");

    const totalDonations = records.length;

    if (totalDonationsEl) {
      totalDonationsEl.textContent = formatNumber(totalDonations);
    }

  }

  function ensureLineChart() {
    const ctx = document.getElementById("lineChart");
    if (!ctx) return null;
    if (donationLineChart) return donationLineChart;
    donationLineChart = new Chart(ctx, {
      type: "line",
      data: { labels: [], datasets: [] },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          y: { beginAtZero: true, ticks: { precision: 0 } },
        },
      },
    });
    return donationLineChart;
  }

  function ensureBarChart() {
    const ctx = document.getElementById("barChart");
    if (!ctx) return null;
    if (pickupBarChart) return pickupBarChart;
    pickupBarChart = new Chart(ctx, {
      type: "line",
      data: { labels: [], datasets: [] },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          y: { beginAtZero: true, ticks: { precision: 0 } },
        },
      },
    });
    return pickupBarChart;
  }

  function renderDonationChart() {
    const chart = ensureLineChart();
    if (!chart) return;
    const state = volumeState.donations;
    const labels = state.labels.length ? state.labels : ['No data'];
    const values = state.labels.length ? state.values : [0];
    chart.data.labels = labels;
    chart.data.datasets = [
      {
        label: "Product In",
        data: values,
        borderColor: "#0d6efd",
        backgroundColor: "rgba(13, 110, 253, 0.15)",
        tension: 0.3,
        fill: true,
        pointRadius: 4,
      },
    ];
    chart.update();
    const tfLabel = document.getElementById("donationTimeframe");
    if (tfLabel) {
      tfLabel.textContent = timeframeLabel(state.timeframe);
    }
    const tfBadge = document.getElementById("donationVolumeBadge");
    if (tfBadge) {
      tfBadge.textContent = timeframeLabel(state.timeframe);
    }
  }

  function renderPickupChart() {
    const chart = ensureBarChart();
    if (!chart) return;
    const state = volumeState.pickups;
    const labels = state.labels.length ? state.labels : ['No data'];
    const values = state.labels.length ? state.values : [0];
    chart.data.labels = labels;
    chart.data.datasets = [
      {
        label: "Product Out",
        data: values,
        borderColor: "#28a745",
        backgroundColor: "rgba(40, 167, 69, 0.15)",
        tension: 0.3,
        fill: true,
        pointRadius: 4,
      },
    ];
    chart.update();
    const tfLabel = document.getElementById("pickupTimeframe");
    if (tfLabel) {
      tfLabel.textContent = timeframeLabel(state.timeframe);
    }
    const tfBadge = document.getElementById("pickupVolumeBadge");
    if (tfBadge) {
      tfBadge.textContent = timeframeLabel(state.timeframe);
    }
  }

  async function refreshDashboard(timeframe) {
    try {
      await Promise.all([
        loadAnalytics(timeframe),
        loadPickupTotals(timeframe),
      ]);
    } catch (err) {
      console.error("Dashboard refresh failed", err);
    }
  }

  function applyGlobalTimeframe(timeframe) {
    currentTimeframe = timeframe;
    volumeState.donations.timeframe = timeframe;
    volumeState.pickups.timeframe = timeframe;
    refreshDashboard(timeframe);
    loadVolumeSection("donations");
    loadVolumeSection("pickups");
  }

  function init() {
    document.getElementById("exportInBtn")?.addEventListener("click", exportIn);
    document.getElementById("exportOutBtn")?.addEventListener("click", exportOut);
    const exportModalEl = document.getElementById("exportModal");
    const exportInput = document.getElementById("exportMonthInput");
    if (exportInput && !exportInput.value) {
      const now = new Date();
      exportInput.value = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}`;
    }
    if (exportModalEl) {
      exportModalEl.addEventListener("shown.bs.modal", () => {
        const input = document.getElementById("exportMonthInput");
        if (input && !input.value) {
          const now = new Date();
          input.value = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}`;
        }
      });
    }
    const timeframeSelect = document.getElementById("analyticsTimeframeSelect");
    if (timeframeSelect) {
      const initial = String(timeframeSelect.value || currentTimeframe).toLowerCase();
      currentTimeframe = initial;
      volumeState.donations.timeframe = initial;
      volumeState.pickups.timeframe = initial;
      timeframeSelect.addEventListener("change", (e) => {
        const val = String(e.target.value || initial).toLowerCase();
        applyGlobalTimeframe(val);
      });
    }
    refreshDashboard(currentTimeframe).then(() => {
      loadVolumeSection("donations");
      loadVolumeSection("pickups");
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
