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
    // Expose current user globals for modules like the messages modal
    try {
        const u = (function(){ try { return JSON.parse(sessionStorage.getItem('user') || localStorage.getItem('user')); } catch(_) { return null; } })();
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

            // Special-case: messages icon
            if (targetSel === '#messagesModal') {
                // If the modal does not exist, inject it dynamically
                let modalEl = document.querySelector('#messagesModal');
                if (!modalEl) {
                    modalEl = document.createElement('div');
                    modalEl.id = 'messagesModal';
                    modalEl.className = 'modal fade';
                    modalEl.tabIndex = -1;
                    modalEl.setAttribute('aria-hidden', 'true');
                    modalEl.innerHTML = `
                      <div class="modal-dialog modal-dialog-scrollable modal-lg">
                        <div class="modal-content">
                          <div class="modal-header">
                            <h5 class="modal-title" id="messagesModalLabel">Messages</h5>
                            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                          </div>
                          <div class="modal-body"></div>
                        </div>
                      </div>`;
                    document.body.appendChild(modalEl);
                    // Initialize controller if available
                    if (window.__initMessagesModal) {
                        try { window.__initMessagesModal(modalEl); } catch(_) {}
                    }
                }
                // fall through to default modal handling
            }

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

    // Messages unread badge (like notifications) with 10s polling
    (function(){
        let badgeTimer = 0;
        const BADGE_MS_VISIBLE = 10000;
        const BADGE_MS_HIDDEN = 30000;
        function ensureBadges(){
            document.querySelectorAll('a[data-bs-target="#messagesModal"]').forEach(anchor => {
                if (anchor.querySelector('.messages-badge')) return;
                const span = document.createElement('span');
                span.className = 'messages-badge position-absolute translate-middle badge rounded-pill bg-danger';
                span.style.top = '6px';
                span.style.right = '2px';
                span.style.display = 'none';
                span.style.fontSize = '0.6rem';
                anchor.style.position = 'relative';
                anchor.appendChild(span);
            });
        }
        async function fetchUnreadTotal(){
            try {
                const res = await fetch('php/api/messages_api.php?action=list_conversations', { credentials: 'include' });
                const json = await res.json();
                if (!json || !json.success) return 0;
                const items = (json.data && Array.isArray(json.data.items)) ? json.data.items : [];
                return items.reduce((sum, c) => sum + (Number(c.unread_count)||0), 0);
            } catch(_) { return 0; }
        }
        async function refreshBadge(){
            ensureBadges();
            // If messages modal is open, suppress the badge display (user can see messages)
            const modalOpen = !!window.__messagesModalOpen;
            const total = modalOpen ? 0 : await fetchUnreadTotal();
            document.querySelectorAll('.messages-badge').forEach(span => {
                if (total > 0) {
                    span.textContent = total > 99 ? '99+' : String(total);
                    span.style.display = '';
                } else {
                    span.style.display = 'none';
                }
            });
        }
        // Expose manual refresh for modal actions
        window.__refreshMessagesBadge = refreshBadge;
        // Initialize now and start polling (visibility-aware)
        ensureBadges();
        refreshBadge();
        function startBadgeTimer(ms){ if (badgeTimer) clearInterval(badgeTimer); badgeTimer = setInterval(refreshBadge, ms); }
        startBadgeTimer(document.hidden ? BADGE_MS_HIDDEN : BADGE_MS_VISIBLE);
        document.addEventListener('visibilitychange', ()=>{
            if (document.hidden) {
                startBadgeTimer(BADGE_MS_HIDDEN);
            } else {
                // immediate refresh on return and speed back up
                refreshBadge();
                startBadgeTimer(BADGE_MS_VISIBLE);
            }
        });
        // Keep badges present if nav changes
        const mo = new MutationObserver(() => ensureBadges());
        mo.observe(document.body, { childList: true, subtree: true });
    })();

    // Messages Modal Controller (lightweight). Can be initialized for an existing or newly injected modal.
    (function(){
        function initFor(modalEl){
            if (!modalEl || modalEl.__messagesBound) return; // prevent double-binding
            modalEl.__messagesBound = true;

        const apiBase = 'php/api/messages_api.php';
        const POLL_MS = 10000; // global cadence
        const MODAL_POLL_MS = 5000; // faster updates while the chat modal is open
        let convs = [];
        let activeId = null;
        let messages = [];
        let lastId = null;
        let pollTimer = 0;
        let isTickRunning = false;
        let uiInitialized = false;

        const qs = (sel, root=document) => root.querySelector(sel);

        async function apiGet(params){
            const url = apiBase + '?' + new URLSearchParams(params).toString();
            const res = await fetch(url, { credentials: 'include' });
            return res.json();
        }
        async function apiPost(action, body){
            const res = await fetch(apiBase + '?action=' + encodeURIComponent(action), {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify(body||{})
            });
            return res.json();
        }
        async function apiPatch(action, params){
            const url = apiBase + '?' + new URLSearchParams(Object.assign({ action }, params||{})).toString();
            const res = await fetch(url, { method: 'PATCH', credentials: 'include' });
            return res.json();
        }

        function getCurrentRole(){
            try {
                const s = sessionStorage.getItem('user') || localStorage.getItem('user');
                const u = s ? JSON.parse(s) : null;
                return (u && u.role) ? String(u.role).toLowerCase() : null;
            } catch(_) { return null; }
        }

        function ensureMessageTheme(){
            // Inject a one-time style tag for modal theming
            if (document.getElementById('messages-theme-override')) return;
            const style = document.createElement('style');
            style.id = 'messages-theme-override';
            style.textContent = `
                /* Active channel highlight in modal */
                #messagesModal .list-group-item.active,
                #messagesModal .list-group-item.active:focus,
                #messagesModal .list-group-item.active:hover {
                    background-color: #35b4c1 !important;
                    border-color: #35b4c1 !important;
                    color: #fff !important;
                }
                #messagesModal .list-group-item.active .fw-semibold { color: #fff !important; }
                /* Primary buttons inside modal */
                #messagesModal .btn-primary { background-color: #35b4c1 !important; border-color: #35b4c1 !important; }
                #messagesModal .btn-primary:hover, #messagesModal .btn-primary:focus { background-color: #2aa4b0 !important; border-color: #2aa4b0 !important; }
            `;
            document.head.appendChild(style);
        }

        function buildUI(){
            const body = qs('.modal-body', modalEl);
            if (!body) return;
            ensureMessageTheme();
            const role = getCurrentRole();
            const leftPanel = (role && role !== 'admin')
              ? `
                  <div class="mb-2 fw-semibold">Conversations</div>
                  <div id="mm-pinned" class="list-group small mb-2">
                    <a href="#" id="mm-foodbank" class="list-group-item list-group-item-action active">
                      <i class="bi bi-shield-lock me-1"></i> Food Bank
                    </a>
                  </div>
                  <div id="mm-conversations" class="list-group small"></div>
                `
              : `
                  <div class="d-flex justify-content-between align-items-center mb-2">
                    <input id="mm-search" class="form-control form-control-sm" placeholder="Search conversations"/>
                    <button id="mm-new" class="btn btn-sm btn-outline-primary ms-2" title="New direct"><i class="bi bi-chat"></i></button>
                  </div>
                  <div id="mm-search-results" class="list-group small mb-2" style="display:none;"></div>
                  <div id="mm-conversations" class="list-group small"></div>
                `;

            body.innerHTML = `
              <div class="d-flex" style="min-height:320px; max-height:60vh;">
                <div class="border-end pe-3 me-3" style="width: 260px; overflow:auto;">
                  ${leftPanel}
                </div>
                <div class="flex-grow-1 d-flex flex-column">
                  <div id="mm-messages" class="flex-grow-1 overflow-auto mb-2"></div>
                  <div class="input-group">
                    <input id="mm-input" type="text" class="form-control" placeholder="Type a message..."/>
                    <button id="mm-send" class="btn btn-primary" type="button"><i class="bi bi-send"></i></button>
                  </div>
                </div>
              </div>`;
            bindUI();
        }

        function renderConversations(){
            const wrap = qs('#mm-conversations', modalEl);
            if (!wrap) return;
            wrap.innerHTML = '';
            const role = getCurrentRole();
            // For non-admin users, avoid rendering any additional channels to prevent duplicates with the pinned Food Bank
            if (role && role !== 'admin') return;
            convs.forEach(c => {
                const last = c.last_message ? JSON.parse(c.last_message) : null;
                const a = document.createElement('a');
                a.href = '#';
                a.className = 'list-group-item list-group-item-action' + (activeId===c.id?' active':'');
                const title = c.display_title || c.title || ('Conversation #'+c.id);
                a.innerHTML = `
                  <div class="d-flex justify-content-between align-items-center">
                    <div class="fw-semibold" style="color: var(--body-text-color);">${title}</div>
                    ${Number(c.unread_count)>0?`<span class="badge rounded-pill bg-primary">${c.unread_count}</span>`:''}
                  </div>
                  <div class="text-muted small">${last? (last.body||'[attachment]') : 'No messages yet'}</div>`;
                a.addEventListener('click', (e)=>{ e.preventDefault(); selectConversation(c.id); });
                wrap.appendChild(a);
            });
        }

        function renderMessages(){
            const wrap = qs('#mm-messages', modalEl);
            if (!wrap) return;
            wrap.innerHTML = '';
            messages.forEach(m => {
                const div = document.createElement('div');
                div.className = 'd-flex mb-2 ' + ((window.CURRENT_USER_ID && Number(m.sender_id)===Number(window.CURRENT_USER_ID))?'justify-content-end':'');
                const isMine = (window.CURRENT_USER_ID && Number(m.sender_id)===Number(window.CURRENT_USER_ID));
                const style = isMine
                  ? 'background: var(--hover-color); border:1px solid var(--secondary-color);'
                  : 'background: #fff; border:1px solid #edf2f7;';
                div.innerHTML = `<div class="p-2 rounded" style="max-width:80%; white-space:pre-wrap; ${style}">${escapeHtml(m.body||'')}
                  <div class="text-muted small mt-1">${fmtTime(m.created_at)}</div></div>`;
                wrap.appendChild(div);
            });
            wrap.scrollTop = wrap.scrollHeight;
        }

        function escapeHtml(s){ return (s||'').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c])); }
        function fmtTime(ts){ try { return new Date(ts.replace(' ','T')).toLocaleString(); } catch(e){ return ts; } }

        async function loadConversations(){
            const res = await apiGet({ action:'list_conversations' });
            if (res.success){ convs = res.data.items || []; renderConversations(); }
            // update global badge after loading
            if (window.__refreshMessagesBadge) { try { window.__refreshMessagesBadge(); } catch(_){} }
        }
        async function selectConversation(id){ activeId = id; await markRead(); await loadMessages(true); renderConversations(); }
        async function loadMessages(reset){
            if (!activeId) return;
            const res = await apiGet({ action:'list_messages', conversation_id: activeId, limit: 100, after_id: reset? '' : (lastId||'') });
            if (!res.success) return;
            const items = res.data.items || [];
            if (reset) messages = items; else messages = messages.concat(items);
            if (messages.length) lastId = messages[messages.length-1].id;
            renderMessages();
        }
        async function markRead(){ if (!activeId) return; await apiPatch('mark_read', { conversation_id: activeId }); await loadConversations(); }
        async function send(){
            if (!activeId) return;
            const input = qs('#mm-input', modalEl);
            const text = (input.value||'').trim();
            if (!text) return;
            const res = await apiPost('send_message', { conversation_id: activeId, body: text });
            if (res.success){ input.value=''; await loadMessages(); await loadConversations(); }
        }

        function bindUI(){
            const sendBtn = qs('#mm-send', modalEl);
            const input = qs('#mm-input', modalEl);
            const newBtn = qs('#mm-new', modalEl);
            if (sendBtn) sendBtn.addEventListener('click', send);
            if (input) input.addEventListener('keydown', (e)=>{ if (e.key==='Enter' && !e.shiftKey){ e.preventDefault(); send(); } });
            if (newBtn) newBtn.addEventListener('click', async ()=>{
                const other = Number(prompt('Enter user ID to chat with:'));
                if (!other) return;
                const res = await apiPost('get_or_create_direct', { other_user_id: other });
                if (res.success){ await loadConversations(); await selectConversation(res.data.conversation.id); }
            });
            const fb = qs('#mm-foodbank', modalEl);
            if (fb) fb.addEventListener('click', async (e)=>{
                e.preventDefault();
                const res = await apiPost('get_or_create_direct', {}); // backend defaults to admin
                if (res.success){ await loadConversations(); await selectConversation(res.data.conversation.id); }
            });

            // Admin donor search: debounce input and render results list
            const searchInput = qs('#mm-search', modalEl);
            const resultsBox = qs('#mm-search-results', modalEl);
            let searchTimer = 0;
            async function runSearch(q){
                if (!q || q.trim().length < 2) { if (resultsBox){ resultsBox.style.display='none'; resultsBox.innerHTML=''; } return; }
                try {
                    const url = 'php/api/user_api.php?action=list&role=donor&q=' + encodeURIComponent(q.trim());
                    const res = await fetch(url, { credentials: 'include' });
                    const json = await res.json();
                    const items = (json && json.success && json.data && Array.isArray(json.data.items)) ? json.data.items : [];
                    if (!resultsBox) return;
                    resultsBox.innerHTML = '';
                    items.slice(0, 10).forEach(u => {
                        const a = document.createElement('a');
                        a.href = '#';
                        a.className = 'list-group-item list-group-item-action';
                        const label = (u.organization_name && u.organization_name.trim()) ? u.organization_name : (u.name || ('User #' + u.user_id));
                        a.textContent = label;
                        a.addEventListener('click', async (e)=>{
                            e.preventDefault();
                            const r = await apiPost('get_or_create_direct', { other_user_id: Number(u.user_id) });
                            if (r.success){
                                resultsBox.style.display='none';
                                resultsBox.innerHTML='';
                                searchInput.value = '';
                                await loadConversations();
                                await selectConversation(r.data.conversation.id);
                            }
                        });
                        resultsBox.appendChild(a);
                    });
                    resultsBox.style.display = items.length ? 'block' : 'none';
                } catch(_) {
                    if (resultsBox){ resultsBox.style.display='none'; resultsBox.innerHTML=''; }
                }
            }
            if (searchInput) {
                searchInput.addEventListener('input', ()=>{
                    if (searchTimer) clearTimeout(searchTimer);
                    searchTimer = setTimeout(()=> runSearch(searchInput.value), 300);
                });
            }
        }

        function startPolling(){
            stopPolling();
            pollTimer = window.setInterval(async ()=>{
                if (isTickRunning) return;
                isTickRunning = true;
                try {
                    await Promise.all([
                        loadConversations(),
                        loadMessages()
                    ]);
                    if (activeId && window.__messagesModalOpen) {
                        try { await markRead(); } catch(_){}
                    }
                } catch(_){}
                finally { isTickRunning = false; }
            }
            , MODAL_POLL_MS);
        }
        function stopPolling(){ if (pollTimer){ clearInterval(pollTimer); pollTimer=0; } }

        async function initOnceUI(){
            if (uiInitialized) return; uiInitialized = true;
            buildUI();
            await loadConversations();
            const role = getCurrentRole();
            if (role && role !== 'admin') {
                // ensure admin chat exists and is opened
                try {
                    const res = await apiPost('get_or_create_direct', {});
                    if (res.success) { await selectConversation(res.data.conversation.id); }
                } catch(_){}
            }
        }

        modalEl.addEventListener('shown.bs.modal', async ()=>{
            window.__messagesModalOpen = true;
            await initOnceUI();
            // Immediate refresh so donors see updates without any manual action
            try {
                await Promise.all([
                    loadConversations(),
                    (async ()=>{ await loadMessages(true); })()
                ]);
            } catch(_){}
            startPolling();
            if (window.__refreshMessagesBadge) window.__refreshMessagesBadge();
        });
        modalEl.addEventListener('hidden.bs.modal', ()=>{ window.__messagesModalOpen = false; stopPolling(); if (window.__refreshMessagesBadge) window.__refreshMessagesBadge(); });
        }

        // Expose global initializer for dynamically injected modal
        window.__initMessagesModal = initFor;

        // Auto-initialize if modal already exists in DOM
        const existing = document.getElementById('messagesModal');
        if (existing) initFor(existing);
    })();
});
