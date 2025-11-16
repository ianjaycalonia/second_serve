(() => {
  'use strict';

  const API_URL = '/php/api/dashboard/recipient_summary.php';
  let chartInstance = null;
  let refreshTimer = null;

  function getStoredUser() {
    try {
      return JSON.parse(sessionStorage.getItem('user') || '{}');
    } catch (_) {
      return {};
    }
  }

  function setWelcomeName() {
    const user = getStoredUser();
    const userNameElement = document.querySelector('.user-name');
    if (userNameElement && user?.name) {
      const first = String(user.name).trim().split(' ')[0];
      if (first) userNameElement.textContent = first;
    }
  }

  function safeNumber(value) {
    const num = Number(value);
    return Number.isFinite(num) ? num.toLocaleString() : '0';
  }

  function updateTiles(totals) {
    const elReceived = document.getElementById('totalDonations');
    const elUpcoming = document.getElementById('upcomingDonations');
    const elPending = document.getElementById('activeDonors');
    const elMissed = document.getElementById('activeRecipients');

    if (elReceived) elReceived.textContent = safeNumber(totals?.received ?? 0);
    if (elUpcoming) elUpcoming.textContent = safeNumber(totals?.upcoming ?? 0);
    if (elPending) elPending.textContent = safeNumber(totals?.pending ?? 0);
    if (elMissed) elMissed.textContent = safeNumber(totals?.missed ?? 0);
  }

  function ensureChart() {
    const ctx = document.getElementById('lineChart');
    if (!ctx) return null;
    if (chartInstance) return chartInstance;
    chartInstance = new Chart(ctx, {
      type: 'line',
      data: {
        labels: [],
        datasets: [
          {
            label: 'Completed Deliveries',
            data: [],
            borderColor: '#0d6efd',
            backgroundColor: 'rgba(13, 110, 253, 0.15)',
            borderWidth: 2,
            tension: 0.35,
            fill: true,
            pointRadius: 4,
            pointHoverRadius: 6,
            pointBackgroundColor: '#0d6efd',
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            displayColors: false,
            backgroundColor: 'rgba(0,0,0,0.8)',
            padding: 10,
          },
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: { precision: 0 },
            grid: { color: 'rgba(0,0,0,0.05)' },
          },
          x: {
            grid: { display: false },
          },
        },
      },
    });
    return chartInstance;
  }

  function updateChart(labels, data) {
    const chart = ensureChart();
    if (!chart) return;
    chart.data.labels = Array.isArray(labels) ? labels : [];
    chart.data.datasets[0].data = Array.isArray(data) ? data : [];
    chart.update();
  }

  function showError(message) {
    const main = document.querySelector('main');
    if (!main) return;
    if (main.querySelector('.alert-dashboard-error')) return;
    const alert = document.createElement('div');
    alert.className = 'alert alert-danger alert-dashboard-error';
    alert.textContent = message || 'Failed to load dashboard data. Please try again later.';
    main.prepend(alert);
  }

  async function loadDashboardData() {
    try {
      const response = await fetch(API_URL, {
        method: 'GET',
        credentials: 'include',
        headers: { Accept: 'application/json' },
        cache: 'no-store',
      });

      if (!response.ok) {
        if (response.status === 401) {
          showError('Your session has expired. Please sign in again.');
          return;
        }
        throw new Error(`HTTP ${response.status}`);
      }

      const payload = await response.json();
      if (!payload?.success) {
        throw new Error(payload?.error || 'Failed to load dashboard data');
      }

      const totals = payload?.data?.totals || {};
      const trend = payload?.data?.trend || {};

      updateTiles(totals);
      updateChart(trend.labels || [], trend.data || []);
    } catch (error) {
      console.error('Recipient dashboard load error:', error);
      showError('Unable to load dashboard data. Please try again.');
    }
  }

  function startAutoRefresh() {
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(loadDashboardData, 5 * 60 * 1000);
  }

  function init() {
    setWelcomeName();
    const hasMetrics = document.getElementById('totalDonations');
    if (!hasMetrics) return;
    loadDashboardData();
    startAutoRefresh();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
