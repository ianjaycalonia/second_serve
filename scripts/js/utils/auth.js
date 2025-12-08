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
        document.body.appendChild(container);
    }
    try {
        const rootStyles = getComputedStyle(document.documentElement);
        const zIndexVar = (rootStyles.getPropertyValue('--toast-z-index') || '').trim();
        container.style.zIndex = zIndexVar || '2147483000';
    } catch (_) {
        container.style.zIndex = '2147483000';
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
    const fullNameWrap = document.getElementById('wrapFullName');
    const recipNameWrap = document.getElementById('wrapRecipientName');
    const addrTextareaWrap = document.getElementById('wrapAddressTextarea');
    const recipAddrPartsWrap = document.getElementById('wrapRecipientAddressParts');
    const populationWrap = document.getElementById('wrapPopulationServed');
    const beneficiarySelect = document.getElementById('registerBeneficiaryCategory');
    const barangayInput = document.getElementById('registerBarangay');
    const citySelect = document.getElementById('registerCity');
    const addressInput = document.getElementById('registerAddress');
    const contactInput = document.getElementById('registerContact');
    const detailsWrapper = document.getElementById('registerDetailsWrapper');
    const orgStep = document.getElementById('registerOrgStep');
    const repStep = document.getElementById('registerRepStep');
    const stepsTrack = document.getElementById('registerStepsTrack');
    const nextBtn = document.getElementById('registerNextBtn');
    const backBtn = document.getElementById('registerBackBtn');
    const tracker = document.getElementById('registerStepTracker');
    const trackerTitle = document.getElementById('registerStepTitle');

    const authModal = document.getElementById('authModal');
    const authTabs = document.getElementById('authTabs');
    const toggleHiddenClass = (el, show) => {
        if (!el) return;
        if (show) {
            el.classList.remove('d-none');
        } else {
            el.classList.add('d-none');
        }
    };
    const updateModalWidth = () => {
        if (!authModal || !authTabs) return;
        const active = authTabs.querySelector('.nav-link.active');
        const isRegister = active?.getAttribute('data-bs-target') === '#register-tab-pane';
        authModal.classList.toggle('register-expanded', !!isRegister);
    };
    if (authTabs) {
        authTabs.addEventListener('shown.bs.tab', updateModalWidth);
    }
    updateModalWidth();
    const setStep = (step) => {
        const makeActive = (el) => {
            if (!el) return;
            el.classList.add('active');
            el.classList.remove('leaving');
        };
        const makeInactive = (el) => {
            if (!el) return;
            el.classList.remove('active');
            el.classList.add('leaving');
            window.setTimeout(() => {
                if (!el.classList.contains('active')) {
                    el.classList.remove('leaving');
                }
            }, 400);
        };

        if (orgStep && repStep) {
            if (step === 1) {
                makeActive(orgStep);
                makeInactive(repStep);
            } else {
                makeInactive(orgStep);
                makeActive(repStep);
            }
        }

        if (detailsWrapper) {
            detailsWrapper.dataset.step = String(step);
            detailsWrapper.classList.toggle('step-2', step === 2);
        }

        if (!tracker || !trackerTitle || !nextBtn || !backBtn) return;
        if (step === 1) {
            tracker.querySelector('.fw-semibold').textContent = 'Step 1 of 2';
            trackerTitle.textContent = 'Organization Details';
            nextBtn.classList.remove('d-none');
            backBtn.classList.add('d-none');
        } else {
            tracker.querySelector('.fw-semibold').textContent = 'Step 2 of 2';
            trackerTitle.textContent = 'Representative Details';
            nextBtn.classList.add('d-none');
            backBtn.classList.remove('d-none');
        }
    };

    const updateVis = () => {
        const v = (roleSel?.value||'').toLowerCase();
        const isDonor = v === 'donor';
        const isRecipient = v === 'recipient';
        const hasRole = isDonor || isRecipient;

        toggleHiddenClass(detailsWrapper, !!v);
        if (v) setStep(1);

        toggleHiddenClass(donorWrap, isDonor);
        toggleHiddenClass(recipWrap, isRecipient);

        if (positionField && positionInput) {
            if (isRecipient) {
                toggleHiddenClass(positionField, true);
                positionInput.required = true;
            } else {
                toggleHiddenClass(positionField, false);
                positionInput.required = false;
                positionInput.classList.remove('is-invalid');
            }
        }

        // Always use split name and split address for both roles
        toggleHiddenClass(fullNameWrap, false);
        toggleHiddenClass(recipNameWrap, true);
        toggleHiddenClass(addrTextareaWrap, false);
        toggleHiddenClass(recipAddrPartsWrap, true);
        toggleHiddenClass(populationWrap, isRecipient);

        if (beneficiarySelect) {
            beneficiarySelect.required = isRecipient;
            if (!isRecipient) {
                beneficiarySelect.classList.remove('is-invalid');
            }
        }

        // Require barangay/city when a role is chosen; keep hidden textarea non-required
        if (barangayInput) barangayInput.required = !!v;
        if (citySelect) citySelect.required = !!v;
        if (addressInput) addressInput.required = false;

        updateNextVisibility();
    };
    roleSel?.addEventListener('change', updateVis);
    updateVis();

    // Hide Next by default; reveal only when Step 1 is valid
    function updateNextVisibility() {
        if (!nextBtn) return;
        const v = (roleSel?.value||'').toLowerCase();
        const isRecipient = v === 'recipient';
        const f1 = document.getElementById('registerOrganization');
        const f2 = barangayInput;
        const f3 = citySelect;
        const fields = [f1, f2, f3].filter(Boolean);
        if (isRecipient) fields.push(beneficiarySelect);

        // Compose hidden address value from parts on each check
        const brgy = (barangayInput?.value||'').trim();
        const city = (citySelect?.value||'').trim();
        if (addressInput) addressInput.value = [brgy, city].filter(Boolean).join(', ');

        // Extra guard: organization must start with a letter or number
        const orgVal = (f1?.value || '').trim();
        const orgStartOK = /^[A-Za-z0-9]/.test(orgVal);
        if (f1 && orgVal) {
            if (!orgStartOK) {
                f1.classList.add('is-invalid');
                showFieldTooltip('registerOrganization', 'Organization name must start with a letter or number');
            } else if (f1.checkValidity()) {
                f1.classList.remove('is-invalid');
                hideFieldTooltip('registerOrganization');
            }
        }

        const ready = orgStartOK && fields.every(el => el && el.value && el.checkValidity());
        if (ready) nextBtn.classList.remove('d-none'); else nextBtn.classList.add('d-none');
    }

    if (nextBtn) nextBtn.classList.add('d-none');
    const orgInputEl = document.getElementById('registerOrganization');
    orgInputEl?.addEventListener('input', () => {
        updateNextVisibility();
        const v = (orgInputEl.value || '').trim();
        if (v && !/^[A-Za-z0-9]/.test(v)) {
            orgInputEl.classList.add('is-invalid');
            showFieldTooltip('registerOrganization', 'Organization name must start with a letter or number');
        }
    });
    orgInputEl?.addEventListener('blur', () => {
        const v = (orgInputEl.value || '').trim();
        if (!v) return; // don't nag on empty before interaction
        if (!/^[A-Za-z0-9]/.test(v) || !orgInputEl.checkValidity()) {
            orgInputEl.classList.add('is-invalid');
            const msg = !/^[A-Za-z0-9]/.test(v) ? 'Organization name must start with a letter or number' : (orgInputEl.validationMessage || 'Please correct this field');
            showFieldTooltip('registerOrganization', msg);
        } else {
            orgInputEl.classList.remove('is-invalid');
            hideFieldTooltip('registerOrganization');
        }
    });
    barangayInput?.addEventListener('input', updateNextVisibility);
    citySelect?.addEventListener('change', updateNextVisibility);
    beneficiarySelect?.addEventListener('change', updateNextVisibility);
    contactInput?.addEventListener('input', () => {
        if (!contactInput) return;
        const digits = (contactInput.value || '').replace(/\D/g, '').slice(0, 11);
        contactInput.value = digits;
        if (digits.length === 11) {
            contactInput.classList.remove('is-invalid');
            hideFieldTooltip('registerContact');
        }
    });
    contactInput?.addEventListener('blur', () => {
        if (!contactInput) return;
        const digits = (contactInput.value || '').trim();
        if (!digits) return;
        if (!/^\d{11}$/.test(digits)) {
            contactInput.classList.add('is-invalid');
            showFieldTooltip('registerContact', 'Contact number must be exactly 11 digits');
        } else {
            contactInput.classList.remove('is-invalid');
            hideFieldTooltip('registerContact');
        }
    });

    if (nextBtn) {
        nextBtn.addEventListener('click', () => {
            const requiredFields = [];
            const addField = (id) => {
                const el = document.getElementById(id);
                if (el) requiredFields.push(el);
            };
            addField('registerOrganization');
            addField('registerBarangay');
            addField('registerCity');
            if ((roleSel?.value || '').toLowerCase() === 'recipient') {
                addField('registerBeneficiaryCategory');
            }
            let ok = true;
            let firstInvalidMessage = '';
            requiredFields.forEach((el) => {
                if (!el.checkValidity()) {
                    el.reportValidity();
                    el.classList.add('is-invalid');
                    if (!firstInvalidMessage) {
                        firstInvalidMessage = el.validationMessage || 'Please correct this field';
                    }
                    ok = false;
                } else {
                    el.classList.remove('is-invalid');
                }
            });
            // Explicit org name leading character rule
            const orgEl = document.getElementById('registerOrganization');
            const orgVal = (orgEl?.value||'').trim();
            if (ok && !/^[A-Za-z0-9]/.test(orgVal)) {
                showError('registerOrganization', 'Organization name must start with a letter or number');
                ok = false;
            }
            if (!ok) {
                if (firstInvalidMessage) {
                    showToast(firstInvalidMessage, { title: 'Validation error', variant: 'danger', delay: 6000 });
                }
                return;
            }
            // Ensure hidden address is composed before proceeding
            const brgyVal = (barangayInput?.value||'').trim();
            const cityVal = (citySelect?.value||'').trim();
            if (addressInput) addressInput.value = [brgyVal, cityVal].filter(Boolean).join(', ');
            setStep(2);
        });
    }
    if (backBtn) {
        backBtn.addEventListener('click', () => setStep(1));
    }
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

// Show a small Bootstrap tooltip on a field
function showFieldTooltip(elementId, message) {
    const msg = String(message || '').trim();
    if (!msg) return;
    // Suppress default browser text the user finds noisy
    if (msg.toLowerCase() === 'please select an item in the list.') return;
    try {
        const el = document.getElementById(elementId);
        if (!el) return;
        el.setAttribute('data-bs-toggle', 'tooltip');
        el.setAttribute('data-bs-placement', 'top');
        // Use Bootstrap 5.3 dynamic content API when available
        let t = bootstrap.Tooltip.getInstance(el);
        if (!t) {
            t = new bootstrap.Tooltip(el, {
                trigger: 'manual',
                customClass: 'is-invalid-tooltip',
                placement: 'top',
                title: msg
            });
        } else if (typeof t.setContent === 'function') {
            t.setContent({ '.tooltip-inner': msg });
        } else {
            // Fallback: dispose and recreate with new title
            t.dispose();
            t = new bootstrap.Tooltip(el, {
                trigger: 'manual',
                customClass: 'is-invalid-tooltip',
                placement: 'top',
                title: msg
            });
        }
        t.show();
    } catch (_) { /* ignore tooltip errors */ }
}

function hideFieldTooltip(elementId) {
    try {
        const el = document.getElementById(elementId);
        if (!el) return;
        const t = bootstrap.Tooltip.getInstance(el);
        if (t) t.hide();
    } catch (_) { /* ignore */ }
}

// Show error message in form
function showError(elementId, message) {
    let errorElement = document.getElementById(`${elementId}Error`);
    if (!errorElement) {
        const input = document.getElementById(elementId);
        if (input) {
            errorElement = document.createElement('div');
            errorElement.id = `${elementId}Error`;
            errorElement.className = 'invalid-feedback';
            const parent = input.parentNode;
            if (parent && parent.classList && parent.classList.contains('input-group')) {
                parent.insertAdjacentElement('afterend', errorElement);
            } else {
                input.parentNode.insertBefore(errorElement, input.nextSibling);
            }
        }
    }
    if (errorElement) errorElement.textContent = message || '';
    const field = document.getElementById(elementId);
    field?.classList.add('is-invalid');
    // Also show a small tooltip on the field, but do not emit a separate
    // generic "Validation error" toast here. Callers like the login AJAX
    // handler already show a more detailed toast, and we want to avoid
    // duplicate banners.
    showFieldTooltip(elementId, message || 'Please correct this field');
}

// Clear error message
function clearError(elementId) {
    const errorElement = document.getElementById(`${elementId}Error`);
    if (errorElement) {
        errorElement.remove();
    }
    document.getElementById(elementId)?.classList.remove('is-invalid');
    hideFieldTooltip(elementId);
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

    // Live password match validation with tooltip
    try {
        const passEl = document.getElementById('registerPassword');
        const confirmEl = document.getElementById('registerConfirmPassword');
        const checkPw = () => {
            if (!passEl || !confirmEl) return;
            const p = passEl.value || '';
            const c = confirmEl.value || '';
            if (c && p !== c) {
                confirmEl.classList.add('is-invalid');
                showFieldTooltip('registerConfirmPassword', 'Passwords do not match');
            } else if (c) {
                confirmEl.classList.remove('is-invalid');
                hideFieldTooltip('registerConfirmPassword');
            }
        };
        passEl?.addEventListener('input', checkPw);
        confirmEl?.addEventListener('input', checkPw);
        confirmEl?.addEventListener('blur', checkPw);
    } catch (_) { /* ignore */ }

    // Clear invalid state + hide tooltip as user corrects inputs
    try {
        document.querySelectorAll('input[required], textarea[required], select[required]').forEach(input => {
            input.addEventListener('input', function () {
                const id = this.getAttribute('id');
                if (this.value) {
                    if (this.checkValidity()) {
                        this.classList.remove('is-invalid');
                        if (id) hideFieldTooltip(id);
                    } else {
                        // live feedback when typed value is invalid (pattern/length)
                        this.classList.add('is-invalid');
                        const msg = this.validationMessage || 'Please correct this field';
                        if (id) showFieldTooltip(id, msg);
                    }
                }
            });
            input.addEventListener('change', function () {
                const id = this.getAttribute('id');
                if (this.checkValidity()) {
                    this.classList.remove('is-invalid');
                    if (id) hideFieldTooltip(id);
                } else {
                    this.classList.add('is-invalid');
                    const msg = this.validationMessage || 'Please select a value';
                    if (id) showFieldTooltip(id, msg);
                }
            });
            input.addEventListener('blur', function () {
                const id = this.getAttribute('id');
                if (!this.value) return; // don't nag until user interacts
                if (!this.checkValidity()) {
                    this.classList.add('is-invalid');
                    const msg = this.validationMessage || 'Please correct this field';
                    if (id) showFieldTooltip(id, msg);
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

            // Reset role selection and hide registration details back to default
            try {
                const roleSel = document.getElementById('registerRole');
                if (roleSel) {
                    roleSel.value = '';
                    roleSel.dispatchEvent(new Event('change'));
                }
            } catch (_) { /* ignore */ }

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

    const shouldPromptPasswordChange = (() => {
        try { return sessionStorage.getItem('password_change_reminder') === '1'; }
        catch (_) { return false; }
    })();
    if (shouldPromptPasswordChange) {
        const fireReminderToast = () => {
            showToast(
                'Please change your password from your profile settings to keep your account secure.',
                { title: 'Password change required', variant: 'warning', delay: 8000 }
            );
            try { sessionStorage.removeItem('password_change_reminder'); } catch (_) {}
        };
        if (document.readyState === 'complete') {
            setTimeout(fireReminderToast, 0);
        } else {
            window.addEventListener('load', () => setTimeout(fireReminderToast, 0), { once: true });
        }
    }

    if (requiredRole) {
        // If not logged in at all, go to login/index
        const userRoleLower = (currentUser?.role || '').toString().trim().toLowerCase();
        window.currentUserRole = function currentUserRole(){
            const u = getCurrentUser();
            return u ? String(u.role || '').toLowerCase() : '';
        };

        window.currentRecipientStatus = function currentRecipientStatus(){
            const u = getCurrentUser();
            if (!u) return '';
            if (u.allocation_status) return String(u.allocation_status).toLowerCase();
            if (u.recipient_status) return String(u.recipient_status).toLowerCase();
            if (u.status) return String(u.status).toLowerCase();
            return '';
        };
        if (!currentUser || !userRoleLower) {
            window.location.href = 'index.html';
            return;
        }
        // If wrong role, send them to their dashboard
        if (userRoleLower !== requiredRole) {
            const dest = (function(role){
                switch(role){
                    case 'admin': return 'admindashboard.html';
                    case 'donor': return 'donordashboard.html';
                    case 'recipient': return 'recipientdashboard.html';
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
    const updateCsrfToken = (token) => {
        try {
            const value = token ? String(token) : '';
            sessionStorage.setItem('csrf_token', value);
            window.CSRF_TOKEN = value || null;
        } catch (_) {
            window.CSRF_TOKEN = token || null;
        }
    };

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
                            if (response.user.must_change_password) {
                                sessionStorage.setItem('password_change_reminder', '1');
                            } else {
                                sessionStorage.removeItem('password_change_reminder');
                            }
                        } catch (_) {}
                    }
                    if (response && response.csrf_token) {
                        updateCsrfToken(response.csrf_token);
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
                    showToast(body, { title, variant: 'danger', delay: 6000 });
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
            
            const role = document.getElementById('registerRole').value;
            let name = document.getElementById('registerName').value.trim();
            const email = document.getElementById('registerEmail').value.trim();
            const password = document.getElementById('registerPassword').value;
            const confirmPassword = document.getElementById('registerConfirmPassword').value;
            const submitBtn = this.querySelector('button[type="submit"]');
            const contactNumber = document.getElementById('registerContact').value.trim();
            const orgName = document.getElementById('registerOrganization').value.trim();
            const address = document.getElementById('registerAddress').value.trim();

            // Compose full name from split fields (applies to all roles)
            const first = (document.getElementById('registerFirstName')?.value || '').trim();
            const middle = (document.getElementById('registerMiddleInitial')?.value || '').trim();
            const last = (document.getElementById('registerLastName')?.value || '').trim();
            const suffix = (document.getElementById('registerSuffix')?.value || '').trim();
            if (first || middle || last || suffix) {
                const parts = [];
                if (first) parts.push(first);
                if (middle) parts.push(middle.replace(/\.+$/g, '') + '.');
                if (last) parts.push(last);
                if (suffix) parts.push(suffix);
                name = parts.join(' ').replace(/\s+/g, ' ').trim();
                const nameInput = document.getElementById('registerName');
                if (nameInput) nameInput.value = name;
            }

            // Always compose address from Barangay + City/Municipality
            {
                const brgy = (document.getElementById('registerBarangay')?.value || '').trim();
                const city = (document.getElementById('registerCity')?.value || '').trim();
                const addrInput = document.getElementById('registerAddress');
                if (addrInput) {
                    addrInput.value = [brgy, city].filter(Boolean).join(', ');
                }
            }
            
            // Clear previous errors
            ['registerName','registerFirstName','registerLastName','registerEmail','registerPassword','registerConfirmPassword','registerRole','registerOrganization','registerAddress','registerContact'].forEach(clearError);
            
            // Validation
            if (!name) {
                const f = (document.getElementById('registerFirstName')?.value || '').trim();
                const l = (document.getElementById('registerLastName')?.value || '').trim();
                if (!f) showError('registerFirstName', 'First name is required');
                if (!l) showError('registerLastName', 'Last name is required');
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
            // 11-digit contact number
            if (!/^\d{11}$/.test(contactNumber)) {
                showError('registerContact', 'Contact number must be 11 digits');
                return;
            }
            
            setLoading(submitBtn, true);
            
            // Determine optional taxonomy fields based on role
            const donorCategoryId = role === 'donor' ? Number(document.getElementById('registerDonorCategory')?.value || '') || undefined : undefined;
            const beneficiaryCategoryId = role === 'recipient' ? Number(document.getElementById('registerBeneficiaryCategory')?.value || '') || undefined : undefined;
            // Recipient population (Population Served)
            let totalResidents;
            if (role === 'recipient') {
                const rawPop = document.getElementById('registerPopulation')?.value || '';
                const n = Number(rawPop);
                if (rawPop !== '' && Number.isFinite(n) && n >= 0) {
                    totalResidents = n;
                }
            }

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
                    organization_name: orgName,
                    contact_number: contactNumber,
                    address,
                    donor_category_id: donorCategoryId,
                    beneficiary_category_id: beneficiaryCategoryId,
                    total_residents: totalResidents
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
                        if (response && response.csrf_token) {
                            updateCsrfToken(response.csrf_token);
                        }
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
            case 'admin': return 'admindashboard.html';
            case 'donor': return 'donordashboard.html';
            case 'recipient': return 'recipientdashboard.html';
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
        const storedToken = (function(){ try { return sessionStorage.getItem('csrf_token'); } catch(_) { return null; } })();
        window.CSRF_TOKEN = storedToken || null;
    } catch(_) {
        window.CURRENT_USER_ID = null;
        window.CURRENT_USER_ROLE = null;
        window.CSRF_TOKEN = null;
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
