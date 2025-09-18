/**
 * Admin Dashboard Functionality
 * Handles fetching and displaying admin dashboard statistics
 */

document.addEventListener('DOMContentLoaded', function() {
    // Set the username in the welcome message
    try {
        const user = JSON.parse(sessionStorage.getItem('user') || '{}');
        const userNameElement = document.querySelector('.user-name');
        if (userNameElement && user.name) {
            userNameElement.textContent = user.name.split(' ')[0]; // Show just first name
        }
        
        // Load dashboard data
        loadDashboardData();
        
        // Set up auto-refresh every 5 minutes
        setInterval(loadDashboardData, 5 * 60 * 1000);
    } catch (error) {
        console.error('Error initializing dashboard:', error);
    }
});

/**
 * Fetches and displays dashboard data from the API
 */
async function loadDashboardData() {
    try {
        const apiUrl = '/Capstone%20Project/php/api/dashboard/summary.php';
        const token = sessionStorage.getItem('token');
        
        const headers = {
            'Accept': 'application/json',
            'Authorization': token ? `Bearer ${token}` : ''
        };
        
        const response = await fetch(apiUrl, {
            method: 'GET',
            headers: headers,
            credentials: 'include',
            cache: 'no-store'
        });
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const responseData = await response.json();
        const data = responseData.data || {};
        const totals = data.totals || {};
        const trend = data.trend || {};
        
        const safeNumber = (num) => {
            const n = Number(num);
            return !isNaN(n) ? n.toLocaleString() : '0';
        };
        
        // Use number of completed batches (distinct batch_id with status Completed)
        const completedCount = Number(totals.completed_batches || 0);
        
        // Update the dashboard stats
        document.getElementById('totalDonations').textContent = safeNumber(completedCount);
        document.getElementById('upcomingDonations').textContent = safeNumber(totals.upcoming_pickups || 0);
        document.getElementById('activeDonors').textContent = safeNumber(totals.active_donors || 0);
        document.getElementById('activeRecipients').textContent = safeNumber(totals.active_recipients || 0);

        // Update the chart if we have trend data
        if (trend.labels && trend.data && Array.isArray(trend.labels) && Array.isArray(trend.data)) {
            const chartData = trend.labels.map((label, index) => ({
                d: label,
                cnt: trend.data[index] || 0
            }));
            updateChart(chartData);
        }
        
    } catch (error) {
        console.error('Error loading dashboard data:', error);
        
        // Show error to user
        const errorElement = document.createElement('div');
        errorElement.className = 'alert alert-danger';
        errorElement.textContent = 'Failed to load dashboard data. Please try again.';
        
        const main = document.querySelector('main');
        if (main && !document.querySelector('.alert-danger')) {
            main.prepend(errorElement);
        }
    }
}

/**
 * Updates the chart with the weekly trend data
 * @param {Array} trendData - Array of {d: dateString, cnt: count} objects
 */
function updateChart(trendData) {
    const ctx = document.getElementById('lineChart');
    if (!ctx) return;

    // Extract labels and data from trendData
    const labels = trendData.map(item => item.d); // Already contains day names
    const counts = trendData.map(item => item.cnt);

    // Get or initialize the chart
    let chart = Chart.getChart(ctx);
    
    if (chart) {
        // Update existing chart data
        chart.data.labels = labels;
        chart.data.datasets[0].data = counts;
        chart.update();
    } else {
        // Create new chart
        chart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Donations',
                    data: counts,
                    borderColor: '#00a0b0',
                    backgroundColor: 'rgba(0, 160, 176, 0.1)',
                    borderWidth: 2,
                    tension: 0.3,
                    fill: true,
                    pointBackgroundColor: '#00a0b0',
                    pointBorderColor: '#fff',
                    pointHoverBackgroundColor: '#fff',
                    pointHoverBorderColor: '#00a0b0'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: false
                    },
                    tooltip: {
                        backgroundColor: 'rgba(0, 0, 0, 0.8)',
                        titleFont: { weight: 'normal' },
                        bodyFont: { weight: 'bold' },
                        padding: 10,
                        displayColors: false
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        grid: {
                            display: true,
                            drawBorder: false,
                            color: 'rgba(0, 0, 0, 0.05)'
                        },
                        ticks: {
                            stepSize: 1,
                            padding: 5
                        }
                    },
                    x: {
                        grid: {
                            display: false,
                            drawBorder: false
                        },
                        ticks: {
                            padding: 10
                        }
                    }
                },
                elements: {
                    line: {
                        borderJoinStyle: 'round'
                    },
                    point: {
                        radius: 4,
                        hoverRadius: 6,
                        hitRadius: 10
                    }
                },
                animation: {
                    duration: 1000
                }
            }
        });
    }
}
