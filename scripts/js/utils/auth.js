// API Base URL
// Use a relative path so it works regardless of domain or spaces in folder name
const API_BASE_URL = '/php/api';

// Auth router endpoint under php/api/users/
const AUTH_API_URL = `${API_BASE_URL}/users/auth.php`;

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

// Show Bootstrap toast messages (defaults to success styling)
function showToast(message, options = {}) {
    const { title = 'Notification', variant = 'success', delay = 5000 } = options;
    const allowedVariants = new Set(['primary','secondary','success','danger','warning','info','light','dark']);
    const variantClass = allowedVariants.has(variant) ? variant : 'primary';

    let container = document.getElementById('toastContainer');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toastContainer';
        container.className = 'toast-container position-fixed top-0 end-0 p-3';
        container.style.zIndex = '1100';
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `toast align-items-center text-bg-${variantClass} border-0 shadow`;
    toast.setAttribute('role', 'alert');
    toast.setAttribute('aria-live', 'assertive');
    toast.setAttribute('aria-atomic', 'true');
    toast.innerHTML = `
        <div class="d-flex">
            <div class="toast-body">
                ${title ? `<div class="fw-semibold">${title}</div>` : ''}
                <div>${message || ''}</div>
            </div>
            <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button>
        </div>
    `;

    container.appendChild(toast);
    const toastInstance = bootstrap.Toast.getOrCreateInstance(toast, { delay, autohide: true });
    toast.addEventListener('hidden.bs.toast', () => {
        toast.remove();
    });
    toastInstance.show();
}

// Toggle registration fields by role (donor vs recipient)
document.addEventListener('DOMContentLoaded', function(){
    const roleSel = document.getElementById('registerRole');
    const donorWrap = document.getElementById('wrapDonorCategory');
    const recipWrap = document.getElementById('wrapBeneficiaryCategory');
    const positionField = document.getElementById('positionField');
    const positionInput = document.getElementById('registerPosition');
    const toggleHiddenClass = (el, show) => {
        if (!el) return;
        if (show) {
            el.classList.remove('d-none');
        } else {
            el.classList.add('d-none');
        }
    };
    const updateVis = () => {
        const v = (roleSel?.value||'').toLowerCase();
        toggleHiddenClass(donorWrap, v === 'donor');
        toggleHiddenClass(recipWrap, v === 'recipient');
        if (positionField && positionInput) {
            if (v === 'recipient') {
                toggleHiddenClass(positionField, true);
                positionInput.required = true;
            } else {
                toggleHiddenClass(positionField, false);
                positionInput.required = false;
                positionInput.classList.remove('is-invalid');
            }
        }
    };
    roleSel?.addEventListener('change', updateVis);
    updateVis();
});

function setupCapsLockDetection(inputId, hintId) {
    const input = document.getElementById(inputId);
    const hint = document.getElementById(hintId);
    if (!input || !hint) return;

    const set = (on) => {
        if (on) {
            hint.classList.remove('d-none');
        } else {
            hint.classList.add('d-none');
        }
    };

    input.addEventListener('keydown', (e) => {
        if (typeof e.getModifierState === 'function') {
            set(e.getModifierState('CapsLock'));
        }
    });
    input.addEventListener('keyup', (e) => {
        if (typeof e.getModifierState === 'function') {
            set(e.getModifierState('CapsLock'));
        } else {
            set(false);
        }
    });
    input.addEventListener('blur', () => set(false));
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
    const message = (error && (error.responseJSON?.error || error.responseText)) || 'An error occurred. Please try again.';
    // Prefer a Bootstrap modal instead of alert for better UX
    showBootstrapError(message, inferErrorTitle(error));
}

// Show a Bootstrap modal for errors (created on-demand and reused)
function showBootstrapError(message, title) {
    try {
        const t = title || 'Error';
        let modalEl = document.getElementById('globalErrorModal');
        if (!modalEl) {
            modalEl = document.createElement('div');
            modalEl.id = 'globalErrorModal';
            modalEl.className = 'modal fade';
            modalEl.tabIndex = -1;
            modalEl.setAttribute('aria-hidden', 'true');
            modalEl.innerHTML = `
              <div class="modal-dialog">
                <div class="modal-content">
                  <div class="modal-header">
                    <h5 class="modal-title"></h5>
                    <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                  </div>
                  <div class="modal-body">
                    <div class="alert alert-danger mb-0" role="alert"></div>
                  </div>
                  <div class="modal-footer">
                    <button type="button" class="btn btn-primary" data-bs-dismiss="modal">OK</button>
                  </div>
                </div>
              </div>`;
            document.body.appendChild(modalEl);
        }
        const titleEl = modalEl.querySelector('.modal-title');
        const bodyAlert = modalEl.querySelector('.modal-body .alert');
        if (titleEl) titleEl.textContent = t;
        if (bodyAlert) bodyAlert.textContent = String(message || '');

        const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
        modal.show();
    } catch (e) {
        // Fallback to alert if Bootstrap is not available for some reason
        try { alert(title ? (title + ': ' + message) : (message || 'Error')); } catch(_) {}
    }
}

// Infer a reasonable error title based on HTTP status or known error strings
function inferErrorTitle(xhrLike) {
    try {
        const status = xhrLike && (xhrLike.status || xhrLike.responseJSON?.status);
        const txt = (xhrLike && (xhrLike.responseJSON?.error || xhrLike.responseText || '')) || '';
        const s = typeof status === 'number' ? status : 0;
        const lower = String(txt).toLowerCase();
        if (s === 401 || lower.includes('invalid credentials') || lower.includes('wrong password') || lower.includes('unauthorized')) return 'Login Failed';
        if (s === 400) return 'Bad Request';
        if (s === 403) return 'Forbidden';
        if (s === 404) return 'Not Found';
        if (s >= 500) return 'Server Error';
        return 'Error';
    } catch (_) {
        return 'Error';
    }
}

// Handle modal tab switching when clicking login/signup buttons
document.addEventListener('DOMContentLoaded', function() {
    // Route guard: enforce session + role-based access on protected pages
    const path = (location.pathname || '').toLowerCase();

    setupCapsLockDetection('loginPassword', 'loginPasswordCapsHint');
    setupCapsLockDetection('registerPassword', 'registerPasswordCapsHint');
    setupCapsLockDetection('registerConfirmPassword', 'registerConfirmCapsHint');

    const attachPasswordToggles = () => {
        document.querySelectorAll('[data-password-toggle]').forEach(btn => {
            if (btn.dataset.toggleBound === '1') return;
            btn.dataset.toggleBound = '1';
            btn.addEventListener('click', () => {
                const targetId = btn.getAttribute('data-password-toggle');
                const input = targetId ? document.getElementById(targetId) : null;
                if (!input) return;
                const isHidden = input.getAttribute('type') === 'password';
                input.setAttribute('type', isHidden ? 'text' : 'password');
                const icon = btn.querySelector('i');
                if (icon) {
                    icon.classList.toggle('bi-eye', !isHidden);
                    icon.classList.toggle('bi-eye-slash', isHidden);
                }
                btn.setAttribute('aria-pressed', isHidden ? 'true' : 'false');
            });
        });
    };
    attachPasswordToggles();

    // Clear invalid state when user starts typing in any required field
    try {
        document.querySelectorAll('input[required], textarea[required], select[required]').forEach(input => {
            input.addEventListener('input', function () {
                if (this.value && this.classList.contains('is-invalid')) {
                    this.classList.remove('is-invalid');
                }
            });
        });
    } catch (_) { /* ignore */ }

    const authModalEl = document.getElementById('authModal');
    if (authModalEl) {
        authModalEl.addEventListener('shown.bs.modal', attachPasswordToggles, { once: false });

        authModalEl.addEventListener('hidden.bs.modal', () => {
            try {
                const loginFormEl = document.getElementById('loginForm');
                if (loginFormEl) loginFormEl.reset();
                const registerFormEl = document.getElementById('registerForm');
                if (registerFormEl) registerFormEl.reset();
            } catch (_) { /* ignore reset errors */ }

            document.querySelectorAll('.is-invalid').forEach(el => el.classList.remove('is-invalid'));
            document.querySelectorAll('.invalid-feedback').forEach(el => el.remove());
        });
    }

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
                // Protect Inventory page for admins only
                /(^|\/)inventory\.html$/i,
                /(^|\/)inventorymovements\.html$/i,
                /(^|\/)taxonomy\.html$/i,
                /(^|\/)recipientslist\.html$/i,
                /(^|\/)distributeitems\.html$/i,
                /(^|\/)distributeresult\.html$/i,
                // Admin profile/settings
                /(^|\/)adminprofile\.html$/i,
                /(^|\/)adminsettings\.html$/i,
            ]},
            // Donor pages
            { role: 'donor', patterns: [
                /(^|\/)donordashboard\.html$/i,
                /(^|\/)mydonations\.html$/i,
                /(^|\/)schedulepickups\.html$/i,
                /(^|\/)donationhistory\.html$/i,
                // Donor profile/settings
                /(^|\/)donorprofile\.html$/i,
                /(^|\/)donorsettings\.html$/i,
            ]},
            // Recipient pages
            { role: 'recipient', patterns: [
                /(^|\/)recipientdashboard\.html$/i,
                /(^|\/)receiveditems\.html$/i,
                /(^|\/)recipienthistory\.html$/i,
                // Recipient profile/settings
                /(^|\/)recipientprofile\.html$/i,
                /(^|\/)recipientsettings\.html$/i,
            ]},
        ];
        for (const { role, patterns } of RULES) {
            if (patterns.some(rx => rx.test(p))) return role;
        }
        return null;
    };

    const requiredRole = getRequiredRoleByPath(path);
    const stored = (() => { try { return sessionStorage.getItem('user'); } catch(_) { return null; } })();
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
    if (authModalEl) {
        authModalEl.addEventListener('show.bs.modal', function(event) {
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

            // Populate donor/beneficiary categories lazily on modal open
            try {
                const donorSel = document.getElementById('registerDonorCategory');
                if (donorSel && donorSel.options.length <= 1) {
                    fetch(`${API_BASE_URL}/lookups/index.php/donor-categories?active=1&limit=200`, { credentials: 'include' })
                        .then(r => r.json()).then(j => {
                            const items = Array.isArray(j?.items) ? j.items : [];
                            items.forEach(it => {
                                const opt = document.createElement('option');
                                opt.value = String(it.id);
                                opt.textContent = String(it.name || '');
                                donorSel.appendChild(opt);
                            });
                        }).catch(() => {});
                }
                const beneSel = document.getElementById('registerBeneficiaryCategory');
                if (beneSel && beneSel.options.length <= 1) {
                    fetch(`${API_BASE_URL}/lookups/index.php/beneficiary-categories?active=1&limit=200`, { credentials: 'include' })
                        .then(r => r.json()).then(j => {
                            const items = Array.isArray(j?.items) ? j.items : [];
                            items.forEach(it => {
                                const opt = document.createElement('option');
                                opt.value = String(it.id);
                                opt.textContent = String(it.name || '');
                                beneSel.appendChild(opt);
                            });
                        }).catch(() => {});
                }
            } catch(_) { /* ignore */ }
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
                url: `${AUTH_API_URL}?action=login`,
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
                error: function(xhr) {
                    const msg = (xhr && (xhr.responseJSON?.error || xhr.responseText)) ? String(xhr.responseJSON?.error || xhr.responseText) : 'Login failed';
                    const lower = msg.toLowerCase();
                    let title = 'Login Failed';
                    let body = msg;
                    // Map backend granular messages to field-level errors
                    if (lower.includes('email not found')) {
                        showError('loginEmail', 'Email not found');
                        title = 'Email not found';
                        body = 'We could not find an account with that email address.';
                    } else if (lower.includes('selected role does not match')) {
                        showError('loginRole', 'Selected role does not match this account');
                        title = 'Role mismatch';
                        body = 'The selected role does not match your account. Please choose the correct role.';
                    } else if (lower.includes('incorrect password')) {
                        showError('loginPassword', 'Incorrect password');
                        title = 'Incorrect password';
                        body = 'The password you entered is incorrect. Please try again.';
                    } else if (lower.includes('system error occurred')) {
                        // Generic system error for inactive/blocked accounts
                        title = 'System Error';
                        body = 'We were unable to complete your request due to a system error. Please try again later or contact the system administrator.';
                    } else if (lower.includes('pending approval')) {
                        // Pending accounts: clearly indicate approval is still required
                        title = 'Pending Approval';
                        body = 'Your account is pending admin approval. Please wait until an administrator approves your registration.';
                    }
                    showBootstrapError(body, title);
                },
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
            
            // Determine optional taxonomy fields based on role
            const donorCategoryId = role === 'donor' ? Number(document.getElementById('registerDonorCategory')?.value || '') || undefined : undefined;
            const beneficiaryCategoryId = role === 'recipient' ? Number(document.getElementById('registerBeneficiaryCategory')?.value || '') || undefined : undefined;

            // Call register API
            $.ajax({
                url: `${AUTH_API_URL}?action=register`,
                type: 'POST',
                data: JSON.stringify({
                    name,
                    email,
                    password,
                    confirmPassword,
                    role,
                    organization_name: document.getElementById('registerOrganization').value.trim() || undefined,
                    contact_number: document.getElementById('registerContact').value.trim() || undefined,
                    address: document.getElementById('registerAddress').value.trim() || undefined,
                    donor_category_id: donorCategoryId,
                    beneficiary_category_id: beneficiaryCategoryId
                }),
                contentType: 'application/json',
                dataType: 'json',
                success: function(response) {
                    const successMsg = response?.message || 'Registration successful!';
                    showToast(successMsg, { title: 'Registration Successful', variant: 'success' });
                    const authModalEl = document.getElementById('authModal');
                    if (authModalEl) {
                        const modalInstance = bootstrap.Modal.getInstance(authModalEl) || bootstrap.Modal.getOrCreateInstance(authModalEl);
                        modalInstance.hide();
                    }
                    const u = response && response.user ? response.user : null;
                    const approved = u && String(u.status||'').toLowerCase() === 'approved';
                    if (approved) {
                        try { sessionStorage.setItem('user', JSON.stringify(u)); } catch(_) {}
                        const dest = response?.redirect || getDashboardUrl(u.role);
                        if (dest) { window.location.href = dest; return; }
                    }
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
            const s = sessionStorage.getItem('user');
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
    // Expose current user globals for modules like the messages modal
    try {
        const u = (function(){ try { return JSON.parse(sessionStorage.getItem('user')); } catch(_) { return null; } })();
        window.CURRENT_USER_ID = u && u.user_id ? Number(u.user_id) : null;
        window.CURRENT_USER_ROLE = u && u.role ? String(u.role).toLowerCase() : null;
    } catch(_) {
        window.CURRENT_USER_ID = null;
        window.CURRENT_USER_ROLE = null;
    }

    // Wire up logout buttons (reuse across all pages)
    const wireLogout = () => {
        document.querySelectorAll('.logout-btn').forEach(btn => {
            // Avoid duplicate listeners
            if (btn.dataset.logoutBound === '1') return;
            btn.dataset.logoutBound = '1';

            btn.addEventListener('click', async (e) => {
                e.preventDefault();
                try {
                    await fetch(`${AUTH_API_URL}?action=logout`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        credentials: 'include'
                    });
                } catch(_) { /* ignore */ }
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

            // Messaging modal is handled by scripts/js/messages.js (decoupled)

            const modalEl = document.querySelector(targetSel);
            if (!modalEl) {
                return; // do not throw; keep UX safe
            }
            // Use Bootstrap API to show (works even if data attributes exist)
            const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
            modal.show();
            e.preventDefault();
        } catch(err) {
            // Fail-safe: do not propagate to avoid global crashes
            e.preventDefault();
        }
    }, true);

    // Close DOMContentLoaded handler (messaging is now fully decoupled)
});
