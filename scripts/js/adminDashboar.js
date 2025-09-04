let __adminDashChart = null;

async function loadAdminDashboard() {
  try {
    const res = await fetch(`${API_BASE_URL}/dashboard/summary.php`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include'
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const json = await res.json();
    const data = json?.data || {};

    // KPIs
    const totals = data.totals || {};
    const setText = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = (typeof val === 'number') ? val.toLocaleString() : (val ?? '0');
    };
    setText('totalMeals', totals.meals || 0);
    setText('upcomingPickups', totals.upcoming_pickups || 0);
    setText('activeDonors', totals.active_donors || 0);
    setText('activeRecipients', totals.active_recipients || 0);

    // Chart
    const ctx = document.getElementById('lineChart').getContext('2d');
    const labels = data.trend?.labels || ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
    const series = data.trend?.data || [0,0,0,0,0,0,0];

    if (__adminDashChart) {
      __adminDashChart.data.labels = labels;
      __adminDashChart.data.datasets[0].data = series;
      __adminDashChart.update();
    } else {
      __adminDashChart = new Chart(ctx, {
        type: 'line',
        data: {
          labels,
          datasets: [{
            label: 'Donations',
            data: series,
            borderColor: '#0d6efd',
            backgroundColor: 'rgba(13, 110, 253, 0.2)',
            tension: 0.4,
            fill: true,
            pointRadius: 5,
            pointHoverRadius: 7
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: { y: { beginAtZero: true } }
        }
      });
    }
  } catch (e) {
    console.error('Failed to load admin dashboard', e);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', loadAdminDashboard);
} else {
  loadAdminDashboard();
}
