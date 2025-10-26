/* eslint-disable no-undef */
(function () {
  "use strict";

  const API_BASE_URL =
    typeof window.API_BASE_URL === "string" && window.API_BASE_URL
      ? window.API_BASE_URL
      : "/Capstone%20Project/php/api";

  const PICKUP_STATUSES = new Set(["Picked Up", "Completed"]);

  let donationRecords = [];
  let filteredRecords = [];
  let donationLineChart = null;
  let pickupBarChart = null;

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

  function getMonthRange() {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const start = `${year}-${String(month).padStart(2, "0")}-01`;
    const endDate = new Date(year, month, 0).getDate();
    const end = `${year}-${String(month).padStart(2, "0")}-${String(endDate).padStart(2, "0")}`;
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

  async function loadTotalWeight() {
    try {
      const resp = await fetchJson(
        `${API_BASE_URL}/dashboard/summary.php`
      );
      const total = resp?.data?.totals?.total_weight_kg ?? 0;
      const el = document.getElementById("totalWeightKg");
      if (el) {
        el.textContent = (Math.round(Number(total) * 100) / 100).toLocaleString(
          undefined,
          { minimumFractionDigits: 0, maximumFractionDigits: 2 }
        );
      }
    } catch (err) {
      console.error("Failed to load total weight", err);
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
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Product In");
      const fname = `product_in_${resp?.data?.start || ""}_${
        resp?.data?.end || ""
      }.xlsx`.replace(/[^a-zA-Z0-9_.-]/g, "_");
      XLSX.writeFile(wb, fname);
    } catch (err) {
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
        "DATE OUT",
        "ITEM",
        "CATEGORY",
        "QUANTITY",
        "MODE",
        "NOTE",
        "PERFORMED BY",
      ];
      const aoa = [headers, ...rows.map((r) => headers.map((h) => r[h] ?? ""))];
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Product Out");
      const fname = `product_out_${resp?.data?.start || ""}_${
        resp?.data?.end || ""
      }.xlsx`.replace(/[^a-zA-Z0-9_.-]/g, "_");
      XLSX.writeFile(wb, fname);
    } catch (err) {
      alert(`Export Out failed: ${err?.message || "Unknown error"}`);
    }
  }

  async function loadPickupTotals() {
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
      const total = rows.reduce((sum, row) => {
        const raw = row?.QUANTITY ?? row?.quantity ?? 0;
        const num = typeof raw === "number" ? raw : raw ? parseFloat(raw) : 0;
        return sum + (Number.isFinite(num) ? num : 0);
      }, 0);
      const el = document.getElementById("totalPickups");
      if (el) {
        el.textContent = formatNumber(total);
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

  async function loadAnalytics() {
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
      if (typeof totals.total_weight_kg !== "undefined") {
        const el = document.getElementById("totalWeightKg");
        if (el) {
          el.textContent = (
            Math.round(Number(totals.total_weight_kg || 0) * 100) / 100
          ).toLocaleString(undefined, {
            minimumFractionDigits: 0,
            maximumFractionDigits: 2,
          });
        }
      }
      const items = Array.isArray(donationsResp?.data?.items)
        ? donationsResp.data.items
        : Array.isArray(donationsResp?.items)
        ? donationsResp.items
        : [];

      donationRecords = items.map(normalizeDonation);
      updateTiles(totals, donationRecords);
      filteredRecords = donationRecords.slice();
    } catch (err) {
      console.error("Failed to load analytics", err);
      filteredRecords = [];
    }
  }

  function updateTiles(totals, records) {
    const totalDonationsEl = document.getElementById("totalDonations");
    const avgValueEl = document.getElementById("avgDonationValue");

    const totalDonations = records.length;
    const quantitySum = records.reduce((sum, r) => sum + (r.quantity || 0), 0);
    const avgDonationValue = totalDonations
      ? quantitySum / totalDonations
      : 0;

    if (totalDonationsEl) {
      totalDonationsEl.textContent = formatNumber(totalDonations);
    }
    if (avgValueEl) {
      avgValueEl.textContent = formatNumber(avgDonationValue, {
        maximumFractionDigits: 2,
      });
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
        label: "Donations",
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
        label: "Pickups",
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
  }

  function init() {
    document.getElementById("exportInBtn")?.addEventListener("click", exportIn);
    document.getElementById("exportOutBtn")?.addEventListener("click", exportOut);
    loadTotalWeight();
    loadAnalytics().finally(() => {
      loadPickupTotals();
    });
    const donationRange = document.getElementById("donationVolumeRange");
    if (donationRange) {
      donationRange.value = volumeState.donations.timeframe;
      donationRange.addEventListener("change", (e) => {
        const val = String(e.target.value || "daily").toLowerCase();
        volumeState.donations.timeframe = val;
        loadVolumeSection("donations");
      });
    }
    const pickupRange = document.getElementById("pickupVolumeRange");
    if (pickupRange) {
      pickupRange.value = volumeState.pickups.timeframe;
      pickupRange.addEventListener("change", (e) => {
        const val = String(e.target.value || "daily").toLowerCase();
        volumeState.pickups.timeframe = val;
        loadVolumeSection("pickups");
      });
    }
    loadVolumeSection("donations");
    loadVolumeSection("pickups");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
