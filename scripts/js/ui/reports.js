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
  let donorBarChart = null;
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

  function getCategoryLabel(row) {
    if (!row || typeof row !== 'object') return '';
    return (
      row['PRODUCT CATEGORY'] ??
      row['product_category'] ??
      row.product_category ??
      row.category ??
      ''
    );
  }

  function isFoodCategory(label) {
    if (!label) return true;
    return !/^\s*non-food/i.test(String(label));
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
      const totals = { count: 0, groupCount: 0, movementCount: 0 };

      for (const row of rows) {
        const categoryLabel = getCategoryLabel(row);
        if (!isFoodCategory(categoryLabel)) {
          continue;
        }

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

        const movementId = row?.MOVEMENT_ID ?? row?.movement_id ?? row?.Movement_ID ?? null;
        if (movementId != null && !seenMovements.has(String(movementId))) {
          seenMovements.add(String(movementId));
          totals.movementCount += 1;
        }
      }

      const totalPickupsEl = document.getElementById("totalPickups");
      if (totalPickupsEl) {
        totalPickupsEl.textContent = formatNumber(totals.groupCount || totals.count);
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
      category: record?.product_category || record?.category || record?.type || "Uncategorized",
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
      const range = getTimeframeRange(timeframe || currentTimeframe);
      const startIso = formatIsoDate(range.start);
      const endIso = formatIsoDate(range.end);
      const summaryParams = new URLSearchParams({
        start: startIso,
        end: endIso,
        timeframe: (timeframe || currentTimeframe || "daily").toLowerCase(),
      });
      const summaryPromise = fetchJson(
        `${API_BASE_URL}/dashboard/summary.php?${summaryParams.toString()}`
      ).catch(() => ({ data: { totals: {} } }));
      // Get detailed donation items instead of batch data
      const donationsPromise = fetchJson(
        `${API_BASE_URL}/donations/index.php/list`
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
      updateTiles(totals, filteredRecords, timeframe || currentTimeframe);
    } catch (err) {
      console.error("Failed to load analytics", err);
      filteredRecords = [];
    }
  }

  function updateTiles(totals, records, timeframe) {
    const totalDonationsEl = document.getElementById("totalDonations");

    const totalDonations = records.length;

    if (totalDonationsEl) {
      totalDonationsEl.textContent = formatNumber(totalDonations);
    }

    const totalWeightEl = document.getElementById("totalWeightKg");
    if (totalWeightEl) {
      const totalWeight = Number(totals?.total_weight_kg ?? totals?.weight ?? 0);
      totalWeightEl.textContent = formatNumber(totalWeight, {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
      });
      const small = totalWeightEl.parentElement?.querySelector('small');
      if (small) {
        small.textContent = `Food items • ${timeframeLabel(timeframe || currentTimeframe)}`;
      }
    }

    const avgValueEl = document.getElementById("avgDonationValue");
    if (avgValueEl) {
      const avgValue = Number(totals?.avg_donation_value ?? 0);
      const mode = totals?.avg_donation_value_mode || "per_item";
      avgValueEl.textContent = formatNumber(avgValue, { maximumFractionDigits: 2 });
      const small = avgValueEl.parentElement?.querySelector('small');
      if (small) {
        const tfLabel = timeframeLabel(timeframe || currentTimeframe);
        if (mode === "daily_total") {
          small.textContent = `Total donation value • ${tfLabel}`;
        } else if (mode === "average_daily") {
          small.textContent = `Average daily donation value • ${tfLabel}`;
        } else {
          small.textContent = `Average per item • ${tfLabel}`;
        }
      }
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

  function ensureDonorBarChart() {
    const ctx = document.getElementById("donorBarChart");
    if (!ctx) return null;
    if (donorBarChart) return donorBarChart;
    donorBarChart = new Chart(ctx, {
      type: "bar",
      data: { labels: [], datasets: [] },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { 
          legend: { display: false }
        },
        scales: {
          y: { 
            beginAtZero: true, 
            ticks: { precision: 0 }
          },
          x: {
            ticks: {
              maxRotation: 45,
              minRotation: 45
            }
          }
        },
      },
    });
    return donorBarChart;
  }

  function renderDonorBarChart() {
    const chart = ensureDonorBarChart();
    if (!chart) return;
    
    console.log('Rendering donor bar chart, donationRecords:', donationRecords.length);
    
    // Aggregate data by donor
    const donorData = {};
    donationRecords.forEach(record => {
      const donor = record.donor || 'Unknown';
      const quantity = record.quantity || 1;
      donorData[donor] = (donorData[donor] || 0) + quantity;
    });
    
    console.log('Donor data:', donorData);
    
    // Sort by quantity and take top 10
    const sortedDonors = Object.entries(donorData)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);
    
    const labels = sortedDonors.length ? sortedDonors.map(([donor]) => donor) : ['No data'];
    const values = sortedDonors.length ? sortedDonors.map(([, quantity]) => quantity) : [0];
    
    console.log('Donor labels:', labels, 'Donor values:', values);
    
    chart.data.labels = labels;
    chart.data.datasets = [
      {
        label: "Quantity Donated",
        data: values,
        backgroundColor: "rgba(13, 110, 253, 0.8)",
        borderColor: "#0d6efd",
        borderWidth: 1
      }
    ];
    chart.update();
  }

  function createDetailedDonorBarChart() {
    // Aggregate data by donor with more details
    const donorData = {};
    donationRecords.forEach(record => {
      const donor = record.donor || 'Unknown';
      const quantity = record.quantity || 1;
      const category = record.category || 'Uncategorized';
      
      if (!donorData[donor]) {
        donorData[donor] = {
          total: 0,
          categories: {},
          items: []
        };
      }
      donorData[donor].total += quantity;
      donorData[donor].categories[category] = (donorData[donor].categories[category] || 0) + quantity;
      donorData[donor].items.push({
        item: record.item,
        quantity: quantity,
        category: category
      });
    });
    
    // Sort by total quantity and take top 15 for PDF
    const sortedDonors = Object.entries(donorData)
      .sort((a, b) => b[1].total - a[1].total)
      .slice(0, 15);
    
    return sortedDonors;
  }

  async function exportChartsPDF() {
    try {
      const { jsPDF } = window.jspdf;
      const pdf = new jsPDF('l', 'mm', 'a4'); // landscape orientation for proper chart display
      
      // Always use monthly timeframe for PDF export
      const monthlyRange = getTimeframeRange('monthly');
      
      // PAGE 1: Pie Chart with Category Details
      
      // Add title for page 1
      pdf.setFontSize(20);
      pdf.text('Products by Category Analysis', 148, 20, { align: 'center' });
      
      // Add date range (monthly)
      pdf.setFontSize(12);
      pdf.text(`${monthlyRange.start} to ${monthlyRange.end}`, 148, 30, { align: 'center' });
      
      // Capture pie chart - centered with proper aspect ratio
      const pieCanvas = document.getElementById('categoryPieChart');
      if (pieCanvas) {
        const pieImage = pieCanvas.toDataURL('image/png');
        // Same dimensions as bar chart for consistency
        const chartWidth = 140;
        const chartHeight = 80;
        const xPosition = (297 - chartWidth) / 2; // Center in landscape (297mm width)
        pdf.addImage(pieImage, 'PNG', xPosition, 50, chartWidth, chartHeight);
      }
      
      // Add category breakdown table
      pdf.setFontSize(14);
      pdf.text('Category Breakdown', 148, 160, { align: 'center' });
      
      // Aggregate category data
      const categoryData = {};
      donationRecords.forEach(record => {
        const category = record.category || 'Uncategorized';
        const quantity = record.quantity || 1;
        categoryData[category] = (categoryData[category] || 0) + quantity;
      });
      
      const sortedCategories = Object.entries(categoryData)
        .sort((a, b) => b[1] - a[1]);
      
      let yPosition = 170;
      pdf.setFontSize(10);
      
      // Table headers
      pdf.text('Category', 20, yPosition);
      pdf.text('Quantity', 130, yPosition);
      pdf.text('Percentage', 180, yPosition);
      yPosition += 6;
      
      const totalQuantity = Object.values(categoryData).reduce((sum, qty) => sum + qty, 0);
      
      // Table data - limit to fit on page
      sortedCategories.slice(0, 15).forEach(([category, quantity]) => {
        if (yPosition > 190) return; // Stop if we're running out of space
        
        const percentage = ((quantity / totalQuantity) * 100).toFixed(1);
        const truncatedCategory = category.length > 45 ? category.substring(0, 42) + '...' : category;
        
        pdf.text(truncatedCategory, 20, yPosition);
        pdf.text(quantity.toString(), 130, yPosition);
        pdf.text(`${percentage}%`, 180, yPosition);
        yPosition += 5;
      });
      
      // Add category summary
      yPosition += 5;
      pdf.setFontSize(9);
      pdf.text(`Total Categories: ${sortedCategories.length}`, 20, yPosition);
      pdf.text(`Total Items: ${totalQuantity}`, 130, yPosition);
      
      // PAGE 2: Bar Chart with Detailed Donor Information
      pdf.addPage();
      
      // Add title for page 2
      pdf.setFontSize(20);
      pdf.text('Top Donors Analysis', 148, 20, { align: 'center' });
      
      // Add date range (monthly)
      pdf.setFontSize(12);
      pdf.text(`${monthlyRange.start} to ${monthlyRange.end}`, 148, 30, { align: 'center' });
      
      // Capture bar chart - centered with proper aspect ratio
      const barCanvas = document.getElementById('donorBarChart');
      if (barCanvas) {
        const barImage = barCanvas.toDataURL('image/png');
        // Calculate centered position with landscape aspect ratio (wider than tall)
        const chartWidth = 140;
        const chartHeight = 80; // Landscape aspect ratio for bar chart
        const xPosition = (297 - chartWidth) / 2; // Center in landscape (297mm width)
        pdf.addImage(barImage, 'PNG', xPosition, 50, chartWidth, chartHeight);
      }
      
      // Add detailed donor table
      pdf.setFontSize(14);
      pdf.text('Detailed Donor Breakdown', 148, 145, { align: 'center' });
      
      const detailedDonors = createDetailedDonorBarChart();
      
      yPosition = 155;
      pdf.setFontSize(10);
      
      // Table headers
      pdf.text('Donor', 20, yPosition);
      pdf.text('Total', 80, yPosition);
      pdf.text('Top Category', 110, yPosition);
      pdf.text('Items', 180, yPosition);
      yPosition += 6;
      
      // Table data - limit to fit on page
      detailedDonors.slice(0, 15).forEach(([donor, data]) => {
        if (yPosition > 190) return; // Stop if we're running out of space
        
        const topCategory = Object.entries(data.categories)
          .sort((a, b) => b[1] - a[1])[0];
        
        const truncatedDonor = donor.length > 25 ? donor.substring(0, 22) + '...' : donor;
        const truncatedCategory = topCategory[0].length > 35 ? topCategory[0].substring(0, 32) + '...' : topCategory[0];
        
        pdf.text(truncatedDonor, 20, yPosition);
        pdf.text(data.total.toString(), 80, yPosition);
        pdf.text(truncatedCategory, 110, yPosition);
        pdf.text(data.items.length.toString(), 180, yPosition);
        yPosition += 5;
      });
      
      // Add donor summary
      yPosition += 5;
      pdf.setFontSize(9);
      const uniqueDonors = new Set(donationRecords.map(record => record.donor)).size;
      pdf.text(`Total Donors: ${uniqueDonors}`, 20, yPosition);
      pdf.text(`Shown: Top ${Math.min(detailedDonors.length, 15)}`, 80, yPosition);
      
      // Save the PDF with monthly filename
      const filename = `donation_analytics_${formatIsoDate(monthlyRange.start)}_${formatIsoDate(monthlyRange.end)}.pdf`;
      pdf.save(filename);
      
      console.log('PDF exported successfully');
    } catch (error) {
      console.error('Error exporting PDF:', error);
      alert('Failed to export PDF. Please try again.');
    }
  }

  async function refreshDashboard(timeframe) {
    try {
      await Promise.all([
        loadAnalytics(timeframe),
        loadPickupTotals(timeframe),
      ]);
      // Render all charts after data is loaded with a small delay
      setTimeout(() => {
        console.log('About to render charts, donationRecords count:', donationRecords.length);
        renderDonationChart();
        renderPickupChart();
        renderDonorBarChart();
      }, 100);
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
    document.getElementById("exportPdfBtn")?.addEventListener("click", exportChartsPDF);
    
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
