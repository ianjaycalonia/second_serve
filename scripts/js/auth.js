// API Base URL
// Use a relative path so it works regardless of domain or spaces in folder name
const API_BASE_URL = '/Capstone%20Project/php/api';

// Show loading state
function setLoading(button, isLoading) {
    const originalText = button.innerHTML;
    if (isLoading) {
        button.disabled = true;
        button.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Processing...';
    } else {
        button.disabled = false;
        button.innerHTML = originalText;
    }
}

// Show error message in form
function showError(elementId, message) {
    let errorElement = document.getElementById(`${elementId}Error`);
    if (!errorElement) {
        const input = document.getElementById(elementId);
        errorElement = document.createElement('div');
        errorElement.id = `${elementId}Error`;
        errorElement.className = 'invalid-feedback d-block';
        input.parentNode.insertBefore(errorElement, input.nextSibling);
    }
    errorElement.textContent = message;
    document.getElementById(elementId).classList.add('is-invalid');
}

// Clear error message
function clearError(elementId) {
    const errorElement = document.getElementById(`${elementId}Error`);
    if (errorElement) {
        errorElement.remove();
    }
    document.getElementById(elementId)?.classList.remove('is-invalid');
}

// Handle API response
function handleApiResponse(response, successCallback) {
    if (response.redirect) {
        window.location.href = response.redirect;
    } else if (successCallback) {
        successCallback(response);
    }
}

// Handle API error
function handleApiError(error) {
    console.error('API Error:', error);
    alert(error.responseJSON?.error || 'An error occurred. Please try again.');
}

// Handle modal tab switching when clicking login/signup buttons
document.addEventListener('DOMContentLoaded', function() {
    // Route guard: enforce session + role-based access on protected pages
    const path = (location.pathname || '').toLowerCase();

    const getRequiredRoleByPath = (p) => {
        const RULES = [
            // Admin pages (anchor to exact filenames)
            { role: 'admin', patterns: [
                /(^|\/)admindashboard\.html$/i,
                /(^|\/)donation\.html$/i,
                /(^|\/)donors\.html$/i,
                /(^|\/)recipient\.html$/i,
                /(^|\/)reportandanalytics\.html$/i,
                /(^|\/)scheduling\.html$/i,
            ]},
            // Donor pages
            { role: 'donor', patterns: [
                /(^|\/)donordashboard\.html$/i,
                /(^|\/)donorsmydonation\.html$/i,
                /(^|\/)schedulepickups\.html$/i,
                /(^|\/)donationhistory\.html$/i,
            ]},
            // Recipient pages
            { role: 'recipient', patterns: [
                /(^|\/)recipientdashboard\.html$/i,
                /(^|\/)availabledonation\.html$/i,
                /(^|\/)recipienthistory\.html$/i,
            ]},
        ];
        for (const { role, patterns } of RULES) {
            if (patterns.some(rx => rx.test(p))) return role;
        }
        return null;
    };

    const requiredRole = getRequiredRoleByPath(path);
    const stored = (() => { try { return sessionStorage.getItem('user') || localStorage.getItem('user'); } catch(_) { return null; } })();
    const currentUser = stored ? (() => { try { return JSON.parse(stored); } catch(_) { return null; } })() : null;

    if (requiredRole) {
        // If not logged in at all, go to login/index
        const userRoleLower = (currentUser?.role || '').toString().trim().toLowerCase();
        if (!currentUser || !userRoleLower) {
            window.location.href = 'index.html';
            return;
        }
        // If wrong role, send them to their dashboard
        if (userRoleLower !== requiredRole) {
            const dest = (function(role){
                switch(role){
                    case 'admin': return 'AdminDashboard.html';
                    case 'donor': return 'DonorDashboard.html';
                    case 'recipient': return 'recipientDashboard.html';
                    default: return 'index.html';
                }
            })(userRoleLower);
            window.location.href = dest;
            return;
        }
    }
    const authModal = document.getElementById('authModal');
    if (authModal) {
        authModal.addEventListener('show.bs.modal', function(event) {
            const button = event.relatedTarget;
            const authMode = button?.getAttribute('data-auth-mode');
            const preRole = button?.getAttribute('data-role');

            // Clear form and errors when modal is shown
            document.querySelectorAll('.is-invalid').forEach(el => el.classList.remove('is-invalid'));
            document.querySelectorAll('.invalid-feedback').forEach(el => el.remove());

            // Default to login tab
            if (authMode === 'register') {
                const registerTab = new bootstrap.Tab(document.getElementById('register-tab'));
                registerTab.show();
            } else {
                const loginTab = new bootstrap.Tab(document.getElementById('login-tab'));
                loginTab.show();
            }

            // Preselect role when provided
            if (preRole) {
                const roleSelect = document.getElementById('loginRole');
                if (roleSelect) {
                    roleSelect.value = preRole;
                }
            }
        });
    }

    // Form submission handlers
    const loginForm = document.getElementById('loginForm');
    if (loginForm) {
        loginForm.addEventListener('submit', function(e) {
            e.preventDefault();
            
            const email = document.getElementById('loginEmail').value.trim();
            const password = document.getElementById('loginPassword').value;
            const role = document.getElementById('loginRole').value;
            const submitBtn = this.querySelector('button[type="submit"]');
            
            // Clear previous errors
            ['loginEmail', 'loginPassword', 'loginRole'].forEach(clearError);
            
            // Basic validation
            if (!email) {
                showError('loginEmail', 'Email is required');
                return;
            }
            if (!password) {
                showError('loginPassword', 'Password is required');
                return;
            }
            if (!role) {
                showError('loginRole', 'Please select a role');
                return;
            }
            
            setLoading(submitBtn, true);
            
            // Call login API
            $.ajax({
                url: `${API_BASE_URL}/auth_api.php?action=login`,
                type: 'POST',
                data: JSON.stringify({ email, password, role }),
                contentType: 'application/json',
                dataType: 'json',
                success: function(response) {
                    // Ensure session is saved before any redirect
                    if (response && response.user) {
                        try {
                            sessionStorage.setItem('user', JSON.stringify(response.user));
                        } catch (_) {}
                    }
                    const dest = response?.redirect || (response?.user ? getDashboardUrl(response.user.role) : null);
                    if (dest) {
                        window.location.href = dest;
                    }
                },
                error: handleApiError,
                complete: function() {
                    setLoading(submitBtn, false);
                }
            });
        });
    }

    const registerForm = document.getElementById('registerForm');
    if (registerForm) {
        registerForm.addEventListener('submit', function(e) {
            e.preventDefault();
            
            const name = document.getElementById('registerName').value.trim();
            const email = document.getElementById('registerEmail').value.trim();
            const password = document.getElementById('registerPassword').value;
            const confirmPassword = document.getElementById('registerConfirmPassword').value;
            const role = document.getElementById('registerRole').value;
            const submitBtn = this.querySelector('button[type="submit"]');
            
            // Clear previous errors
            ['registerName', 'registerEmail', 'registerPassword', 'registerConfirmPassword', 'registerRole'].forEach(clearError);
            
            // Validation
            if (!name) {
                showError('registerName', 'Name is required');
                return;
            }
            if (!email) {
                showError('registerEmail', 'Email is required');
                return;
            }
            if (!/\S+@\S+\.\S+/.test(email)) {
                showError('registerEmail', 'Please enter a valid email');
                return;
            }
            if (!password) {
                showError('registerPassword', 'Password is required');
                return;
            }
            if (password.length < 8) {
                showError('registerPassword', 'Password must be at least 8 characters');
                return;
            }
            if (password !== confirmPassword) {
                showError('registerConfirmPassword', 'Passwords do not match');
                return;
            }
            if (!role) {
                showError('registerRole', 'Please select a role');
                return;
            }
            
            setLoading(submitBtn, true);
            
            // Call register API
            $.ajax({
                url: `${API_BASE_URL}/auth_api.php?action=register`,
                type: 'POST',
                data: JSON.stringify({
                    name,
                    email,
                    password,
                    confirmPassword,
                    role,
                    organization_name: document.getElementById('registerOrganization').value.trim() || undefined,
                    contact_number: document.getElementById('registerContact').value.trim() || undefined,
                    address: document.getElementById('registerAddress').value.trim() || undefined
                }),
                contentType: 'application/json',
                dataType: 'json',
                success: function(response) {
                    // Store user like login does, then redirect if provided
                    if (response && response.user) {
                        try { sessionStorage.setItem('user', JSON.stringify(response.user)); } catch (_) {}
                    }
                    const dest = response?.redirect || (response?.user ? getDashboardUrl(response.user.role) : null);
                    if (dest) {
                        window.location.href = dest;
                        return;
                    }
                    // Fallback: no redirect, show success message (legacy flow)
                    handleApiResponse(response, function() {
                        const loginTab = new bootstrap.Tab(document.getElementById('login-tab'));
                        loginTab.show();
                        registerForm.reset();
                        const successAlert = `
                            <div class="alert alert-success alert-dismissible fade show" role="alert">
                                Registration successful! You can now log in.
                                <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
                            </div>
                        `;
                        const alertContainer = document.createElement('div');
                        alertContainer.innerHTML = successAlert;
                        document.querySelector('#login-tab-pane').prepend(alertContainer.firstElementChild);
                    });
                },
                error: function(xhr) {
                    const error = xhr.responseJSON?.error || 'Registration failed';
                    if (error.includes('already registered')) {
                        showError('registerEmail', error);
                    } else {
                        handleApiError(xhr);
                    }
                },
                complete: function() {
                    setLoading(submitBtn, false);
                }
            });
        });
    }
    
    // Helper function to get dashboard URL based on role
    function getDashboardUrl(role) {
        switch(role) {
            case 'admin': return 'AdminDashboard.html';
            case 'donor': return 'DonorDashboard.html';
            case 'recipient': return 'recipientDashboard.html';
            default: return 'index.html';
        }
    }

    // Populate greeting placeholders from stored session
    const getStoredUser = () => {
        try {
            // Prefer sessionStorage (set on login), fallback to localStorage if used somewhere else
            const s = sessionStorage.getItem('user') || localStorage.getItem('user');
            return s ? JSON.parse(s) : null;
        } catch (_) { return null; }
    };

    const populateGreeting = () => {
        const user = getStoredUser();
        if (!user) return;
        const displayName = user.name || user.organization_name || user.email || 'User';
        // Only update when different to avoid triggering needless mutation cycles
        document.querySelectorAll('.user-name').forEach(el => {
            if (el.textContent !== displayName) {
                el.textContent = displayName;
            }
        });
        if (user.role) {
            document.querySelectorAll('.user-role').forEach(el => {
                if (el.textContent !== user.role) {
                    el.textContent = user.role;
                }
            });
        }
    };

    populateGreeting();

    // Wire up logout buttons (reuse across all pages)
    const wireLogout = () => {
        document.querySelectorAll('.logout-btn').forEach(btn => {
            // Avoid duplicate listeners
            if (btn.dataset.logoutBound === '1') return;
            btn.dataset.logoutBound = '1';

            btn.addEventListener('click', async (e) => {
                e.preventDefault();
                try {
                    await fetch(`${API_BASE_URL}/auth_api.php?action=logout`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        credentials: 'include'
                    });
                } catch(_) { /* ignore */ }
                try { localStorage.removeItem('user'); } catch(_) {}
                try { sessionStorage.removeItem('user'); } catch(_) {}
                window.location.href = 'index.html';
            });
        });
    };

    // Initial binding and also observe future DOM changes (e.g., SPA fragments)
    wireLogout();
    let __authSyncInProgress = false;
    let __authRaf = 0;
    const runSync = () => {
        if (__authSyncInProgress) return;
        __authSyncInProgress = true;
        try {
            // Perform only necessary updates
            wireLogout();
            populateGreeting();
        } finally {
            __authSyncInProgress = false;
        }
    };
    const mo = new MutationObserver(() => {
        // Debounce to next frame and avoid recursive loops from our own mutations
        if (__authSyncInProgress) return;
        if (__authRaf) cancelAnimationFrame(__authRaf);
        __authRaf = requestAnimationFrame(() => {
            __authRaf = 0;
            runSync();
        });
    });
    mo.observe(document.body, { childList: true, subtree: true });

    // Global safe modal trigger for bell/mail icons and any data-bs-toggle="modal" links
    // Prevents crashes if target modal is missing and ensures consistent behavior
    document.addEventListener('click', function(e){
        try {
            // Find the closest anchor with modal toggle
            const anchor = e.target.closest('a[data-bs-toggle="modal"]');
            if (!anchor) return;

            // Only handle our bell/mail or general modal triggers
            const targetSel = anchor.getAttribute('data-bs-target');
            if (!targetSel) return; // let Bootstrap handle if any

            // Always prevent default navigation for href="#"
            const href = (anchor.getAttribute('href') || '').trim();
            if (href === '#' || href === '') e.preventDefault();

            const modalEl = document.querySelector(targetSel);
            if (!modalEl) {
                console.warn('Modal target not found:', targetSel);
                return; // do not throw; keep UX safe
            }
            // Use Bootstrap API to show (works even if data attributes exist)
            const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
            modal.show();
            e.preventDefault();
        } catch(err) {
            console.error('Modal trigger handler error:', err);
            // Fail-safe: do not propagate to avoid global crashes
            e.preventDefault();
        }
    }, true);
});
