/* eslint-disable no-undef */
(function () {
  "use strict";

  const API_BASE_URL =
    typeof window.API_BASE_URL === "string" && window.API_BASE_URL
      ? window.API_BASE_URL
      : "/Capstone%20Project/php/api";

  const PICKUP_STATUSES = new Set(["Picked Up", "Completed"]);
  const TIMEFRAME_LIMITS = {
    daily: 14,
    weekly: 12,
    monthly: 12,
    yearly: 5,
  };

  let donationRecords = [];
  let filteredRecords = [];
  let donationLineChart = null;
  let pickupBarChart = null;
  let donationTimeframe = "daily";
  let pickupTimeframe = "daily";

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
      updateCharts();
      filteredRecords = donationRecords.slice();
    } catch (err) {
      console.error("Failed to load analytics", err);
      filteredRecords = [];
    }
  }

  function updateTiles(totals, records) {
    const totalDonationsEl = document.getElementById("totalDonations");
    const totalPickupsEl = document.getElementById("totalPickups");
    const avgValueEl = document.getElementById("avgDonationValue");

    const totalDonations = records.length;
    const pickups = records.filter((r) => PICKUP_STATUSES.has(r.status)).length;
    const quantitySum = records.reduce((sum, r) => sum + (r.quantity || 0), 0);
    const avgDonationValue = totalDonations
      ? quantitySum / totalDonations
      : 0;

    if (totalDonationsEl) {
      totalDonationsEl.textContent = formatNumber(totalDonations);
    }
    if (totalPickupsEl) {
      totalPickupsEl.textContent = formatNumber(pickups);
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
      type: "bar",
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

  function getBucketInfo(date, timeframe) {
    const d = new Date(date.getTime());
    if (Number.isNaN(d.getTime())) return null;
    let key;
    let label;
    let ts;
    if (timeframe === "weekly") {
      const day = d.getDay();
      const diff = (day === 0 ? -6 : 1) - day; // Monday as start
      d.setDate(d.getDate() + diff);
      d.setHours(0, 0, 0, 0);
      const weekNumber = getISOWeekNumber(d);
      key = `${d.getFullYear()}-W${String(weekNumber).padStart(2, "0")}`;
      label = `W${weekNumber} ${d.getFullYear()}`;
      ts = d.getTime();
    } else if (timeframe === "monthly") {
      d.setDate(1);
      d.setHours(0, 0, 0, 0);
      key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      label = d.toLocaleDateString(undefined, { month: "short", year: "numeric" });
      ts = d.getTime();
    } else if (timeframe === "yearly") {
      d.setMonth(0, 1);
      d.setHours(0, 0, 0, 0);
      key = String(d.getFullYear());
      label = key;
      ts = d.getTime();
    } else {
      d.setHours(0, 0, 0, 0);
      key = d.toISOString().slice(0, 10);
      label = d.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      });
      ts = d.getTime();
    }
    return { key, label, ts };
  }

  function getISOWeekNumber(date) {
    const tmp = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = tmp.getUTCDay() || 7;
    tmp.setUTCDate(tmp.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
    return Math.ceil(((tmp - yearStart) / 86400000 + 1) / 7);
  }

  function buildSeries(records, timeframe, predicate) {
    const map = new Map();
    records.forEach((rec) => {
      if (predicate && !predicate(rec)) return;
      if (!rec.created_at) return;
      const date = new Date(rec.created_at);
      if (Number.isNaN(date.getTime())) return;
      const info = getBucketInfo(date, timeframe);
      if (!info) return;
      if (!map.has(info.key)) {
        map.set(info.key, { label: info.label, value: 0, ts: info.ts });
      }
      const bucket = map.get(info.key);
      bucket.value += 1;
    });
    const series = Array.from(map.values()).sort((a, b) => a.ts - b.ts);
    const limit = TIMEFRAME_LIMITS[timeframe] || series.length;
    return series.slice(-limit);
  }

  function updateCharts() {
    const donationSeries = buildSeries(donationRecords, donationTimeframe);
    const donationChart = ensureLineChart();
    if (donationChart) {
      donationChart.data.labels = donationSeries.map((p) => p.label);
      donationChart.data.datasets = [
        {
          label: "Donations",
          data: donationSeries.map((p) => p.value),
          borderColor: "#0d6efd",
          backgroundColor: "rgba(13, 110, 253, 0.15)",
          tension: 0.3,
          fill: true,
          pointRadius: 3,
        },
      ];
      donationChart.update();
    }

    const pickupSeries = buildSeries(
      donationRecords,
      pickupTimeframe,
      (rec) => PICKUP_STATUSES.has(rec.status)
    );
    const pickupChart = ensureBarChart();
    if (pickupChart) {
      pickupChart.data.labels = pickupSeries.map((p) => p.label);
      pickupChart.data.datasets = [
        {
          label: "Pickups",
          data: pickupSeries.map((p) => p.value),
          backgroundColor: "rgba(40, 167, 69, 0.6)",
          borderColor: "#28a745",
          borderWidth: 1,
        },
      ];
      pickupChart.update();
    }

    const donationTimeframeLabel = document.getElementById("donationTimeframe");
    if (donationTimeframeLabel) {
      donationTimeframeLabel.textContent =
        donationTimeframe.charAt(0).toUpperCase() + donationTimeframe.slice(1);
    }
    const pickupTimeframeLabel = document.getElementById("pickupTimeframe");
    if (pickupTimeframeLabel) {
      pickupTimeframeLabel.textContent =
        pickupTimeframe.charAt(0).toUpperCase() + pickupTimeframe.slice(1);
    }
  }

  function init() {
    document.getElementById("exportInBtn")?.addEventListener("click", exportIn);
    document.getElementById("exportOutBtn")?.addEventListener("click", exportOut);
    loadTotalWeight();
    loadAnalytics();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
