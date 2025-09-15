// Session and role enforcement + Logout handler
(function(){
  document.addEventListener('DOMContentLoaded', function(){
    try {
      const userRaw = sessionStorage.getItem('user');
      const user = userRaw ? JSON.parse(userRaw) : null;
      const path = (location.pathname || '').toLowerCase();

      // Determine required role by URL
      let requiredRole = null;
      if (path.includes('admindashboard')) requiredRole = 'admin';
      else if (path.includes('donordashboard')) requiredRole = 'donor';
      else if (path.includes('recipientdashboard')) requiredRole = 'recipient';

      // Enforce session exists
      if (!user || !user.role) {
        window.location.href = 'index.html';
        return;
      }

      // Enforce role matches page (only if page is a role dashboard)
      if (requiredRole && user.role !== requiredRole) {
        // Redirect to their own dashboard
        const dest = (function(role){
          switch(role){
            case 'admin': return 'AdminDashboard.html';
            case 'donor': return 'DonorDashboard.html';
            case 'recipient': return 'recipientDashboard.html';
            default: return 'index.html';
          }
        })(user.role);
        if (!path.endsWith(dest.toLowerCase())) {
          window.location.href = dest;
          return;
        }
      }

      // Wire logout button
      const logoutBtn = document.getElementById('logoutBtn');
      if (logoutBtn) {
        logoutBtn.addEventListener('click', async function(e){
          e.preventDefault();
          try {
            await fetch('php/api/auth.php?action=logout', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'include'
            });
          } catch(_) { /* ignore network errors */ }
          try { sessionStorage.removeItem('user'); } catch(_) {}
          window.location.href = 'index.html';
        });
      }
    } catch (err) {
      // On any error, fail-safe to login page
      window.location.href = 'index.html';
    }
  });
})();
