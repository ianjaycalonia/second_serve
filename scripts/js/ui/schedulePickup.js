let eventTypeButtons = [];
let eventTypeInputEl = null;
let recipientsLoadedFromPickup = false;
let donationAutoTriggered = false;
let allowedEventTypes = null;
let currentUserRole = null;
let currentUserData = null;
let currentRunMeta = { runId: null, periodKey: null };
let currentRunPromise = null;
const recipientEligibilityCache = new Map();
const RECIPIENT_ALLOWED_STATUSES = ['acknowledged', 'updated', 'notified', 'allocated', 'scheduled'];
const RECIPIENT_SCHEDULE_REQUIRED_STATUS = 'acknowledged';
const RECIPIENT_SCHEDULE_OK_STATUSES = new Set(['acknowledged','scheduled']);
let scheduleEligibilityWarningShown = false;
let recipientEligibilityChecked = false;
let recipientEligibilityResult = true;
let recipientStatusMap = new Map();
let recipientStatusPromise = null;
let recipientSelfEligibility = { checked: false, eligible: true, status: '' };
let recipientSelfEligibilityPromise = null;

const EVENT_TYPE_PRIORITY = ["admin", "donor", "recipient"];
const KEY_CODES = {
  ENTER: 13,
};

const ROLE_TIME_WINDOWS = Object.freeze({
  admin: { min: '08:00', max: '18:00' },
  donor: { min: '10:00', max: '15:00' },
  recipient: { min: '10:00', max: '15:00' },
  default: { min: '08:00', max: '18:00' },
});

function getTimeWindowForRole(role) {
  const key = typeof role === 'string' ? role.toLowerCase() : '';
  return ROLE_TIME_WINDOWS[key] || ROLE_TIME_WINDOWS.default;
}

function getActiveTimeWindow() {
  return getTimeWindowForRole(currentUserRole || 'admin');
}

function normalizeTimeValue(value) {
  if (!value) return '';
  return String(value).slice(0, 5);
}

function clampTimeToWindow(value, window) {
  const time = normalizeTimeValue(value);
  if (!time) return time;
  if (time < window.min) return window.min;
  if (time > window.max) return window.max;
  return time;
}

function applyTimeWindowToInput(input, window) {
  if (!input || !window) return;
  input.min = window.min;
  input.max = window.max;
  if (input.value) {
    const clamped = clampTimeToWindow(input.value, window);
    if (clamped !== input.value) {
      input.value = clamped;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }
}

function bindTimeConstraintHandlers(input, window, options = {}) {
  if (!input || !window) return;
  if (input.dataset.timeWindowBound === '1') return;

  const { onClamp } = options;

  const enforce = () => {
    const clamped = clampTimeToWindow(input.value, window);
    if (clamped !== input.value) {
      input.value = clamped;
      if (typeof onClamp === 'function') {
        onClamp(clamped);
      }
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
  };

  input.addEventListener('input', enforce);
  input.addEventListener('blur', enforce);
  input.addEventListener('change', enforce);
  input.dataset.timeWindowBound = '1';
}

function computeDefaultTimeWithinWindow(preferred) {
  const window = getActiveTimeWindow();
  const base = preferred ? normalizeTimeValue(preferred) : '';
  if (!base) return window.min;
  return clampTimeToWindow(base, window);
}

function ensureAdminEndAfterStart(adminStart, adminEnd) {
  if (!adminStart || !adminEnd) return;
  if (adminStart.value && adminEnd.value && adminEnd.value < adminStart.value) {
    adminEnd.value = adminStart.value;
  }
}

function applyActiveTimeConstraints(root = document) {
  const scope = root || document;
  const window = getActiveTimeWindow();
  if (!window) return;

  scope.querySelectorAll('.recipient-time').forEach((input) => {
    applyTimeWindowToInput(input, window);
    bindTimeConstraintHandlers(input, window);
  });

  const donorStart = scope.querySelector('#donorStartTime');
  if (donorStart) {
    applyTimeWindowToInput(donorStart, window);
    bindTimeConstraintHandlers(donorStart, window);
  }

  const adminStart = scope.querySelector('#adminStartTime');
  const adminEnd = scope.querySelector('#adminEndTime');
  if (adminStart) {
    applyTimeWindowToInput(adminStart, window);
    bindTimeConstraintHandlers(adminStart, window, {
      onClamp: () => ensureAdminEndAfterStart(adminStart, adminEnd),
    });
  }
  if (adminEnd) {
    applyTimeWindowToInput(adminEnd, window);
    bindTimeConstraintHandlers(adminEnd, window, {
      onClamp: () => ensureAdminEndAfterStart(adminStart, adminEnd),
    });
  }
  ensureAdminEndAfterStart(adminStart, adminEnd);
}

function isTimeWithinWindow(value, window) {
  const time = normalizeTimeValue(value);
  if (!time) return true;
  return time >= window.min && time <= window.max;
}

function formatTimeForDisplay(value) {
  const time = normalizeTimeValue(value);
  if (!time) return '';
  const [hourStr, minute] = time.split(':');
  let hour = Number(hourStr);
  const suffix = hour >= 12 ? 'PM' : 'AM';
  hour = hour % 12 || 12;
  return `${hour}:${minute} ${suffix}`;
}

function getStoredUserRole() {
  try {
    if (
      typeof window !== "undefined" &&
      window.__SESSION_USER &&
      typeof window.__SESSION_USER === "object" &&
      window.__SESSION_USER.role
    ) {
      return String(window.__SESSION_USER.role).toLowerCase();
    }
  } catch (_) {
    /* ignore */
  }
  try {
    if (typeof window !== "undefined" && window.sessionStorage) {
      const raw = window.sessionStorage.getItem("user");
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.role) {
          return String(parsed.role).toLowerCase();
        }
      }
    }
  } catch (_) {
    /* ignore */
  }
  return null;
}

function determineAllowedEventTypes(role) {
  switch (role) {
    case "donor":
      return ["donor"];
    case "recipient":
      return ["recipient"];
    case "admin":
      return ["admin", "donor", "recipient"];
    default:
      return ["admin", "donor", "recipient"];
  }
}

function currentDistributionPeriodKey() {
  const now = new Date();
  const day = now.getDate();
  const weekIndex = day <= 7 ? 1 : day <= 14 ? 2 : day <= 21 ? 3 : 4;
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${now.getFullYear()}-${month}-W${weekIndex}`;
}

async function resolveCurrentRunMeta(forceRefresh = false) {
  if (forceRefresh) {
    currentRunMeta = { runId: null, periodKey: null };
    currentRunPromise = null;
    recipientEligibilityCache.clear();
    recipientStatusMap = new Map();
    recipientStatusPromise = null;
  }
  if (currentRunMeta.periodKey && currentRunPromise === null) {
    return currentRunMeta;
  }
  if (currentRunPromise) {
    return currentRunPromise;
  }
  currentRunPromise = (async () => {
    const periodKey = currentDistributionPeriodKey();
    let runId = null;
    if (currentUserRole === 'admin' && window.AllocationsAPI) {
      if (typeof window.AllocationsAPI.runByPeriod === 'function') {
        try {
          const res = await window.AllocationsAPI.runByPeriod(periodKey);
          const meta = res?.data || res;
          const candidate = Number(meta?.run_id);
          if (Number.isFinite(candidate) && candidate > 0) {
            runId = candidate;
          }
        } catch (_) {/* ignore */}
      }
      if (!runId && typeof window.AllocationsAPI.latestRun === 'function') {
        try {
          const latest = await window.AllocationsAPI.latestRun();
          const row = latest?.data || latest;
          const candidate = Number(row?.run_id);
          if (Number.isFinite(candidate) && candidate > 0) {
            runId = candidate;
          }
        } catch (_) {/* ignore */}
      }
    }
    currentRunMeta = { runId: Number.isFinite(runId) ? runId : null, periodKey };
    currentRunPromise = null;
    return currentRunMeta;
  })();
  return currentRunPromise;
}

function normalizeStatusValue(status) {
  return String(status || '').trim().toLowerCase();
}

function isRecipientStatusEligible(status) {
  const norm = normalizeStatusValue(status);
  return RECIPIENT_ALLOWED_STATUSES.includes(norm);
}

function readableStatus(status) {
  const norm = normalizeStatusValue(status);
  if (!norm) return 'Unknown';
  return norm.replace(/\b([a-z])/g, (m, ch) => ch.toUpperCase());
}

function statusForRecipientId(recipientId, fallbackStatus) {
  const idNum = Number(recipientId);
  if (Number.isFinite(idNum) && recipientStatusMap.has(idNum)) {
    return recipientStatusMap.get(idNum);
  }
  if (fallbackStatus != null) {
    const norm = normalizeStatusValue(fallbackStatus);
    if (norm) return norm;
  }
  return '';
}

function updateRecipientStatusMap(id, status) {
  const idNum = Number(id);
  if (!Number.isFinite(idNum)) return;
  const norm = normalizeStatusValue(status);
  if (!norm) return;
  recipientStatusMap.set(idNum, norm);
}

async function ensureRecipientStatusMap(forceRefresh = false) {
  if (forceRefresh) {
    recipientStatusMap = new Map();
    recipientStatusPromise = null;
  }
  if (recipientStatusMap.size && !forceRefresh) {
    return recipientStatusMap;
  }
  if (recipientStatusPromise) {
    return recipientStatusPromise;
  }
  if (!window.AllocationsAPI || typeof window.AllocationsAPI.listByRun !== 'function') {
    return recipientStatusMap;
  }
  recipientStatusPromise = (async () => {
    try {
      const meta = await resolveCurrentRunMeta();
      const runId = meta?.runId;
      if (!Number.isFinite(runId) || runId <= 0) {
        recipientStatusPromise = null;
        return recipientStatusMap;
      }
      const rows = await window.AllocationsAPI.listByRun(runId) || [];
      recipientStatusMap = new Map();
      rows.forEach(row => {
        const rid = Number(row?.recipient_id);
        const status = normalizeStatusValue(row?.status);
        if (Number.isFinite(rid) && status) {
          recipientStatusMap.set(rid, status);
        }
      });
    } catch (_) {
      recipientStatusMap = new Map();
    } finally {
      recipientStatusPromise = null;
    }
    return recipientStatusMap;
  })();
  return recipientStatusPromise;
}

function recipientStatusBadgeClass(status) {
  const norm = normalizeStatusValue(status);
  switch (norm) {
    case 'acknowledged':
    case 'updated':
    case 'scheduled':
      return 'text-bg-success';
    case 'notified':
    case 'allocated':
      return 'text-bg-info';
    case 'pending':
      return 'text-bg-warning';
    default:
      return 'text-bg-secondary';
  }
}

function clearRecipientEligibilityUi(block) {
  if (!block) return;
  delete block.dataset.recipientStatus;
  delete block.dataset.recipientPeriod;
  delete block.dataset.recipientRunId;
  delete block.dataset.recipientName;
  const statusRow = block.querySelector('.recipient-status-row');
  if (statusRow) {
    statusRow.remove();
  }
}

function updateRecipientEligibilityUi(block, meta) {
  if (!block) return;
  const details = block.querySelector('.recipient-details');
  if (!details) return;
  block.dataset.recipientStatus = meta?.status ? String(meta.status) : '';
  block.dataset.recipientPeriod = meta?.periodKey ? String(meta.periodKey) : '';
  block.dataset.recipientRunId = meta?.runId ? String(meta.runId) : '';
  block.dataset.recipientName = meta?.name ? String(meta.name) : '';

  let statusRow = block.querySelector('.recipient-status-row');
  if (!statusRow) {
    statusRow = document.createElement('div');
    statusRow.className = 'recipient-status-row d-flex justify-content-between align-items-center small mb-2';
    details.prepend(statusRow);
  }
  const statusLabel = meta?.status ? meta.status : 'Unknown';
  const badgeClass = recipientStatusBadgeClass(meta?.status);
  const weekLabel = meta?.periodKey || currentDistributionPeriodKey();
  statusRow.innerHTML = `
    <span>Status: <span class="badge ${badgeClass}">${statusLabel}</span></span>
    <span class="text-muted">Week: ${weekLabel}</span>
  `;
}

function formatEligibilityWarning(meta, fallbackName) {
  const name = meta?.name || fallbackName || 'Recipient';
  switch (meta?.reason) {
    case 'no-allocations':
      return `${name} has no allocations for the current distribution run.`;
    case 'status':
      return `${name} has status "${meta?.status || 'unknown'}" and cannot be scheduled yet.`;
    case 'week':
      return `${name} is not part of the current distribution week.`;
    case 'api':
      return `Could not verify eligibility for ${name}. Please try again later.`;
    case 'name':
      return 'Please select a recipient with a valid name.';
    default:
      return `${name} cannot be scheduled right now.`;
  }
}

async function evaluateRecipientEligibility(recipientId, recipientName) {
  const idNum = Number(recipientId);
  const safeName = (recipientName || '').trim();
  if (!Number.isFinite(idNum) || idNum <= 0) {
    return { eligible: false, reason: 'invalid', status: null, runId: null, periodKey: currentDistributionPeriodKey(), name: safeName };
  }
  if (!safeName) {
    return { eligible: false, reason: 'name', status: null, runId: null, periodKey: currentDistributionPeriodKey(), name: '' };
  }
  const cached = recipientEligibilityCache.get(idNum);
  if (cached) {
    return Object.assign({}, cached, { name: cached.name || safeName });
  }
  if (!window.AllocationsAPI || typeof window.AllocationsAPI.listByRecipient !== 'function') {
    const meta = { eligible: false, reason: 'api', status: null, runId: null, periodKey: currentDistributionPeriodKey(), name: safeName };
    recipientEligibilityCache.set(idNum, meta);
    return meta;
  }
  const runMeta = await resolveCurrentRunMeta();
  let allocations = [];
  try {
    allocations = await window.AllocationsAPI.listByRecipient(idNum);
  } catch (_) {
    const meta = { eligible: false, reason: 'api', status: null, runId: null, periodKey: runMeta.periodKey, name: safeName };
    recipientEligibilityCache.set(idNum, meta);
    return meta;
  }
  if (!Array.isArray(allocations) || allocations.length === 0) {
    const meta = { eligible: false, reason: 'no-allocations', status: null, runId: null, periodKey: runMeta.periodKey, name: safeName };
    recipientEligibilityCache.set(idNum, meta);
    return meta;
  }
  const normalized = allocations
    .map(row => ({
      status: row?.status || '',
      runId: Number(row?.run_id) || null,
      createdAt: row?.created_at || null,
      updatedAt: row?.updated_at || null,
    }));

  let match = null;
  if (runMeta.runId) {
    match = normalized.find(entry => entry.runId === runMeta.runId && isRecipientStatusEligible(entry.status));
    if (!match) {
      const sameRun = normalized.find(entry => entry.runId === runMeta.runId);
      if (sameRun) {
        const meta = { eligible: false, reason: 'status', status: sameRun.status || '', runId: sameRun.runId, periodKey: runMeta.periodKey, name: safeName };
        recipientEligibilityCache.set(idNum, meta);
        return meta;
      }
    }
  }
  if (!match) {
    match = normalized.find(entry => isRecipientStatusEligible(entry.status));
  }
  if (!match) {
    const best = normalized[0] || { status: '' };
    const meta = { eligible: false, reason: runMeta.runId ? 'week' : 'status', status: best.status || '', runId: best.runId || null, periodKey: runMeta.periodKey, name: safeName };
    recipientEligibilityCache.set(idNum, meta);
    return meta;
  }
  const meta = { eligible: true, reason: '', status: match.status || '', runId: runMeta.runId || match.runId || null, periodKey: runMeta.periodKey, name: safeName };
  recipientEligibilityCache.set(idNum, meta);
  updateRecipientStatusMap(idNum, match.status || '');
  return meta;
}

async function ensureRecipientEligibilityForBlock(block, recipientId, recipientName, options = {}) {
  if (!block) return false;
  const silent = !!options.silent;
  const meta = await evaluateRecipientEligibility(recipientId, recipientName);
  if (!meta.eligible) {
    clearRecipientEligibilityUi(block);
    if (!silent) {
      displayInlineScheduleToast(formatEligibilityWarning(meta, recipientName), 'warn');
    }
    return false;
  }
  updateRecipientEligibilityUi(block, meta);
  return true;
}

function getCurrentUser() {
  try {
    if (
      typeof window !== "undefined" &&
      window.__SESSION_USER &&
      typeof window.__SESSION_USER === "object"
    ) {
      return window.__SESSION_USER;
    }
  } catch (_) {
    /* ignore */
  }
  try {
    if (typeof window !== "undefined" && window.sessionStorage) {
      const raw = window.sessionStorage.getItem("user");
      if (raw) {
        return JSON.parse(raw);
      }
    }
  } catch (_) {
    /* ignore */
  }
  return null;
}

function getUserIdValue(user) {
  if (!user) return null;
  const candidates = [user.user_id, user.id, user.userId, user.account_id];
  for (const value of candidates) {
    const num = Number(value);
    if (Number.isFinite(num) && num > 0) return String(num);
    if (typeof value === "string" && value.trim() !== "") return value.trim();
  }
  return null;
}

function getUserDisplayName(user) {
  if (!user) return "You";
  return (
    user.organization_name ||
    user.contact_person ||
    user.name ||
    user.display_name ||
    user.email ||
    "You"
  );
}

function getUserContactInfo(user) {
  if (!user) return null;
  return (
    user.contact_number ||
    user.phone ||
    user.mobile ||
    user.contact ||
    null
  );
}

function resolveDefaultEventType() {
  const list = Array.isArray(allowedEventTypes) && allowedEventTypes.length
    ? allowedEventTypes
    : ["admin", "donor", "recipient"];
  for (const key of EVENT_TYPE_PRIORITY) {
    if (list.includes(key)) {
      return key;
    }
  }
  return list[0];
}

function enforceAllowedEventType(type) {
  const normalized = String(type || "").toLowerCase();
  if (Array.isArray(allowedEventTypes) && allowedEventTypes.includes(normalized)) {
    return normalized;
  }
  return resolveDefaultEventType();
}

function getRecipientStatus() {
  if (recipientSelfEligibility.checked) {
    return recipientSelfEligibility.status || '';
  }
  if (typeof window !== 'undefined' && typeof window.currentRecipientStatus === 'function') {
    const status = window.currentRecipientStatus();
    return status ? status.toLowerCase() : '';
  }
  const user = currentUserData || getCurrentUser();
  const status = user?.recipient_status || user?.status || '';
  return String(status || '').toLowerCase();
}

function isRecipientEligibleForScheduling() {
  if (recipientSelfEligibility.checked) {
    return !!recipientSelfEligibility.eligible;
  }
  const status = getRecipientStatus();
  if (!status) return false;
  return status === RECIPIENT_SCHEDULE_REQUIRED_STATUS;
}

function ensureRecipientSchedulingEligibility() {
  if (currentUserRole !== 'recipient') return true;
  if (recipientSelfEligibility.checked) {
    return !!recipientSelfEligibility.eligible;
  }
  if (!recipientSelfEligibilityPromise) {
    fetchRecipientSelfEligibility().catch(()=>{});
  }
  // Optimistically allow access until eligibility data loads
  return true;
}

function disableSchedulingFormForRecipient() {
  const form = document.getElementById('eventForm');
  if (!form) return;
  form.querySelectorAll('input, textarea, select, button').forEach((el) => {
    if (el.id === 'deleteEventBtn') return;
    if (el.disabled) return;
    el.dataset.disabledByEligibility = '1';
    el.disabled = true;
  });
  const saveBtn = document.getElementById('saveEventBtn');
  if (saveBtn) saveBtn.disabled = true;
  const newBtn = document.getElementById('newEventBtn');
  if (newBtn) {
    newBtn.style.removeProperty('display');
    newBtn.dataset.disabledByEligibility = '1';
    newBtn.disabled = true;
    newBtn.classList.add('disabled');
  }
}

function enableSchedulingFormForRecipient() {
  const form = document.getElementById('eventForm');
  if (!form) return;
  form.querySelectorAll('[data-disabled-by-eligibility="1"]').forEach((el) => {
    el.disabled = false;
    delete el.dataset.disabledByEligibility;
  });
  const saveBtn = document.getElementById('saveEventBtn');
  if (saveBtn && saveBtn.dataset.disabledByEligibility === '1') {
    saveBtn.disabled = false;
    delete saveBtn.dataset.disabledByEligibility;
  }
  const newBtn = document.getElementById('newEventBtn');
  if (newBtn && newBtn.dataset.disabledByEligibility === '1') {
    newBtn.disabled = false;
    newBtn.classList.remove('disabled');
    delete newBtn.dataset.disabledByEligibility;
    newBtn.style.removeProperty('display');
  }
}

function recipientEligibilityMessage() {
  return 'Only recipients with an allocation scheduled for this week can create pickup events. Please contact support if you believe this is an error.';
}

function showScheduleEligibilityWarning() {
  if (scheduleEligibilityWarningShown) return;
  scheduleEligibilityWarningShown = true;
  const message = recipientEligibilityMessage();
  if (typeof window.calendarToast === 'function') {
    window.calendarToast(message, 'warn');
  } else {
    displayInlineScheduleToast(message, 'warn');
  }
}

async function fetchRecipientSelfEligibility(forceRefresh = false) {
  if (currentUserRole !== 'recipient') {
    recipientSelfEligibility = { checked: true, eligible: true, status: '' };
    return recipientSelfEligibility;
  }
  if (!forceRefresh && recipientSelfEligibility.checked) {
    return recipientSelfEligibility;
  }
  if (!forceRefresh && recipientSelfEligibilityPromise) {
    return recipientSelfEligibilityPromise;
  }
  if (forceRefresh) {
    recipientSelfEligibility = { checked: false, eligible: true, status: '' };
    recipientSelfEligibilityPromise = null;
  }
  if (!window.AllocationsAPI || typeof window.AllocationsAPI.listByRecipient !== 'function') {
    recipientSelfEligibility = { checked: true, eligible: false, status: '' };
    disableSchedulingFormForRecipient();
    showScheduleEligibilityWarning();
    return recipientSelfEligibility;
  }
  recipientSelfEligibilityPromise = (async () => {
    let eligible = false;
    let status = '';
    try {
      const runMeta = await resolveCurrentRunMeta();
      const rows = await window.AllocationsAPI.listByRecipient();
      const allocations = Array.isArray(rows) ? rows : [];
      const normalized = allocations.map(r => ({ status: normalizeStatusValue(r?.status), runId: Number(r?.run_id) || null }));
      let match = null;
      if (runMeta?.runId) {
        match = normalized.find(r => r.runId === runMeta.runId && RECIPIENT_SCHEDULE_OK_STATUSES.has(r.status));
        if (!match) {
          const sameRun = normalized.find(r => r.runId === runMeta.runId);
          if (sameRun) {
            status = sameRun.status || '';
          }
        }
      }
      if (!match) {
        match = normalized.find(r => RECIPIENT_SCHEDULE_OK_STATUSES.has(r.status));
      }
      if (match) {
        eligible = !!match && (!runMeta?.runId || match.runId === runMeta.runId);
        status = match.status || RECIPIENT_SCHEDULE_REQUIRED_STATUS;
      } else if (normalized.length) {
        status = normalized[0].status || '';
      }
    } catch (_) {
      eligible = false;
      status = '';
    }
    recipientSelfEligibility = { checked: true, eligible, status };
    recipientSelfEligibilityPromise = null;
    recipientEligibilityChecked = true;
    recipientEligibilityResult = eligible;
    if (!eligible) {
      disableSchedulingFormForRecipient();
      showScheduleEligibilityWarning();
    } else {
      enableSchedulingFormForRecipient();
    }
    return recipientSelfEligibility;
  })();
  return recipientSelfEligibilityPromise;
}

// Expose scheduling eligibility helpers/state to calendar.js
if (typeof window !== 'undefined') {
  window.ensureRecipientSchedulingEligibility = ensureRecipientSchedulingEligibility;
  window.getRecipientSchedulingEligibility = function getRecipientSchedulingEligibility() {
    return { checked: !!recipientSelfEligibility.checked, eligible: !!recipientSelfEligibility.eligible, status: recipientSelfEligibility.status || '' };
  };
  window.recipientEligibilityMessage = recipientEligibilityMessage;
}

function ensureScheduleToastContainer() {
  let container = document.getElementById('scheduleToastContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'scheduleToastContainer';
    container.className = 'position-fixed top-0 end-0 p-3';
    container.style.zIndex = '1080';
    document.body.appendChild(container);
  }
  return container;
}

function displayInlineScheduleToast(message, tone = 'info') {
  const container = ensureScheduleToastContainer();
  const toast = document.createElement('div');
  const toneClass = tone === 'warn' ? 'text-bg-warning' : tone === 'error' ? 'text-bg-danger' : 'text-bg-primary';
  toast.className = `toast align-items-center border-0 ${toneClass}`;
  toast.setAttribute('role', 'alert');
  toast.setAttribute('aria-live', 'assertive');
  toast.setAttribute('aria-atomic', 'true');
  toast.innerHTML = `
    <div class="d-flex">
      <div class="toast-body">${message}</div>
      <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button>
    </div>
  `;
  container.appendChild(toast);
  let instance = null;
  if (typeof bootstrap !== 'undefined' && bootstrap.Toast) {
    instance = bootstrap.Toast.getOrCreateInstance(toast, { delay: 5000 });
    toast.addEventListener('hidden.bs.toast', () => {
      toast.remove();
    });
    instance.show();
  } else {
    toast.classList.add('show');
    setTimeout(() => {
      toast.classList.remove('show');
      toast.remove();
    }, 5000);
  }
}

function initializeEventTypePermissions() {
  if (!Array.isArray(eventTypeButtons)) {
    eventTypeButtons = [];
  }
  currentUserData = getCurrentUser();
  const resolvedRoleRaw = currentUserData?.role || getStoredUserRole() || "admin";
  currentUserRole = String(resolvedRoleRaw || "admin").toLowerCase();
  if (!["admin", "donor", "recipient"].includes(currentUserRole)) {
    currentUserRole = "admin";
  }
  allowedEventTypes = determineAllowedEventTypes(currentUserRole);
  applyActiveTimeConstraints();

  eventTypeButtons.forEach((button) => {
    const btnType = String(button.dataset.type || "").toLowerCase();
    const isAllowed = allowedEventTypes.includes(btnType);
    if (!isAllowed) {
      button.disabled = true;
      button.dataset.locked = "1";
      button.setAttribute("aria-disabled", "true");
      button.classList.add("disabled", "opacity-50");
      if (!button.title) {
        button.title = "Not available for your account";
      }
    } else {
      button.disabled = false;
      delete button.dataset.locked;
      button.removeAttribute("aria-disabled");
      button.classList.remove("disabled", "opacity-50");
      if (button.title === "Not available for your account") {
        button.removeAttribute("title");
      }
    }
  });

  const eligible = ensureRecipientSchedulingEligibility();
  const defaultType = resolveDefaultEventType();
  if (eventTypeInputEl) {
    eventTypeInputEl.value = defaultType;
  }
  return defaultType;
}

document.addEventListener('DOMContentLoaded', () => {
  initSchedulePickupUI();
  ensureBaseDefaults();
  updateRecipientSelections();
  handleAutoLaunchFromDonation();
});

function ensureBaseDefaults(){
  const todayStr = new Date().toISOString().split('T')[0];
  const evDateInput = document.getElementById('evDate');
  if (evDateInput && !evDateInput.value) evDateInput.value = todayStr;

  const donorDateEl = document.getElementById('donorDate');
  if (donorDateEl && !donorDateEl.value) donorDateEl.value = todayStr;
  const adminDateEl = document.getElementById('adminDate');
  if (adminDateEl && !adminDateEl.value) adminDateEl.value = todayStr;

  const now = new Date();
  const nextHour = new Date(now.getTime() + 60 * 60 * 1000);
  const defaultTime = `${String(nextHour.getHours()).padStart(2, '0')}:${String(nextHour.getMinutes()).padStart(2, '0')}`;

  if (!isFromPickup()) {
    document.querySelectorAll('.recipient-date').forEach(input => {
      if (!input.value) input.value = todayStr;
    });
    document.querySelectorAll('.recipient-time').forEach(input => {
      if (!input.value) input.value = defaultTime;
    });
  }

  const donorTime = document.getElementById('donorStartTime');
  if (donorTime && !donorTime.value) donorTime.value = defaultTime;

  const adminStart = document.getElementById('adminStartTime');
  const adminEnd = document.getElementById('adminEndTime');
  if (adminStart && !adminStart.value) adminStart.value = defaultTime;
  if (adminEnd && !adminEnd.value) {
    const twoHours = new Date(nextHour.getTime() + 60 * 60 * 1000);
    adminEnd.value = `${String(twoHours.getHours()).padStart(2, '0')}:${String(twoHours.getMinutes()).padStart(2, '0')}`;
  }
}

// Top-level helpers for preloading recipients from distributionpickup.html
function isFromPickup(){
  try { return new URLSearchParams(window.location.search).get('from') === 'pickup'; } catch(_) { return false; }
}

function getQueryParam(name){
  try {
    return new URLSearchParams(window.location.search).get(name);
  } catch(_) {
    return null;
  }
}

function isFromDonation(){
  const source = (getQueryParam('from') || '').toLowerCase();
  return source === 'donation';
}

function getPickupPayload(){
  let stored = null;
  try {
    const raw = window.sessionStorage ? window.sessionStorage.getItem('schedule_payload_from_pickup') : null;
    if (raw) stored = JSON.parse(raw);
  } catch(_) { stored = null; }
  if (!stored && window.__schedulePayloadFromPickup && typeof window.__schedulePayloadFromPickup === 'object') {
    stored = window.__schedulePayloadFromPickup;
  }
  return stored && Array.isArray(stored.recipients) ? stored : null;
}

async function resolveRecipientIdByName(name){
  try {
    if (!name) return null;
    const params = new URLSearchParams({ action:'list', role:'recipient', q: name });
    const res = await fetch(`/php/api/users/index.php?${params.toString()}`, { credentials:'include' });
    const j = await res.json().catch(()=>null);
    const items = Array.isArray(j?.data?.items) ? j.data.items : [];
    if (!items.length) return null;
    // Prefer exact organization_name match (case-insensitive), else first item
    const lower = String(name).trim().toLowerCase();
    const exact = items.find(u => String(u.organization_name||'').trim().toLowerCase() === lower || String(u.name||'').trim().toLowerCase() === lower);
    const statusMap = await ensureRecipientStatusMap();
    if (!isRecipientStatusEligible(exact?.status)) return null;
    return Number(exact?.user_id || items[0]?.user_id) || null;
  } catch(_) { return null; }
}

async function getValidRecipientsFromPayload(payload){
  if (!payload || !Array.isArray(payload.recipients)) return [];
  const candidates = [];
  const statusMap = await ensureRecipientStatusMap();
  for (const r of payload.recipients){
    const allocs = Array.isArray(r.allocations) ? r.allocations : [];
    const allowedAlloc = allocs.find(a => isRecipientStatusEligible(a?.status));
    if (!allowedAlloc) continue;
    let id = Number(r.recipient_id);
    const text = r.recipient_name || r.organization || (id ? `Recipient #${id}` : 'Recipient');
    if (!Number.isFinite(id) || id <= 0){
      // Try to resolve by name
      id = await resolveRecipientIdByName(text);
    }
    if (Number.isFinite(id) && id > 0) {
      const allocStatus = normalizeStatusValue(allowedAlloc?.status);
      if (allocStatus) {
        updateRecipientStatusMap(id, allocStatus);
      }
      candidates.push({ id, text });
    }
  }
  // Deduplicate by id
  const seen = new Set();
  return candidates.filter(x => { if (seen.has(x.id)) return false; seen.add(x.id); return true; });
}

async function tryAutoPopulateRecipientsFromPickup(){
  if (recipientsLoadedFromPickup || !isFromPickup()) return;
  const payload = getPickupPayload();
  if (!payload) return;
  const recs = await getValidRecipientsFromPayload(payload);
  if (!recs.length) return;

  const container = document.getElementById('recipientSelections');
  if (!container) return;

  const blocks = () => Array.from(container.querySelectorAll('.recipient-selection'));
  while (blocks().length < recs.length) addRecipientField();

  const modalDate = document.getElementById('evDate')?.value || '';

  blocks().forEach((blk, idx) => {
    const rec = recs[idx];
    if (!rec) return;
    const select = blk.querySelector('.recipient-select');
    if (!select) return;
    initRecipientSelect(select);

    let option = select.querySelector(`option[value="${rec.id}"]`);
    if (!option) {
      option = new Option(rec.text, rec.id, true, true);
      select.appendChild(option);
    }

    if (typeof window.$ === 'function' && window.$.fn?.select2) {
      const $sel = window.$(select);
      $sel.val(String(rec.id)).trigger('change');
      $sel.trigger({ type: 'select2:select', params: { data: { id: rec.id, text: rec.text, contact: 'N/A', phone: 'N/A', lastPickup: 'Never' } } });
    } else {
      select.value = String(rec.id);
      ensureRecipientEligibilityForBlock(blk, rec.id, rec.text, { silent: true });
    }

    const dateEl = blk.querySelector('.recipient-date');
    if (dateEl) dateEl.value = modalDate;
    const timeEl = blk.querySelector('.recipient-time');
    if (timeEl) timeEl.value = '';
  });

  updateRecipientSelections();
  recipientsLoadedFromPickup = true;
}

function initSchedulePickupUI() {
  // Event type buttons
  eventTypeButtons = Array.from(document.querySelectorAll('.event-type-btn'));
  eventTypeInputEl = document.getElementById('evType');

  // Initialize event type buttons
  eventTypeButtons.forEach((button) => {
    button.addEventListener('click', function () {
      const requested = this.dataset.type;
      const type = enforceAllowedEventType(requested);
      setEventType(type);
    });
  });

  const defaultType = initializeEventTypePermissions();
  setEventType(defaultType);
  applyActiveTimeConstraints();

  // Add recipient button
  const addRecipientBtn = document.getElementById('addAnotherRecipient');
  if (addRecipientBtn) {
    addRecipientBtn.addEventListener('click', addRecipientField);
  }
  
  // Initialize date and time pickers
  initDateTimePickers();
  
  // Initialize form submission
  const eventForm = document.getElementById('eventForm');
  if (eventForm) {
  }
  
  // Delete handled by calendar.js (with confirm modal and a single toast)
  const deleteBtn = document.getElementById('deleteEventBtn');
  if (deleteBtn) {
  }

  if (currentUserRole !== 'donor') {
    initDonorSelect();
  }

  // Initialize existing recipient selects with Select2 (for the initial block)
  if (currentUserRole !== 'recipient') {
    document.querySelectorAll('.recipient-select').forEach((sel)=>{
      if (typeof window.$ === 'function' && window.$.fn?.select2) {
        const $el = window.$(sel);
        if (!$el.data('select2')) initRecipientSelect(sel);
      }
    });
  }

  // Delegate changes from recipient date/time to keep hidden JSON in sync
  const recContainer = document.getElementById('recipientSelections');
  if (recContainer){
    recContainer.addEventListener('change', (e)=>{
      const t = e.target;
      if (t && (t.classList.contains('recipient-date') || t.classList.contains('recipient-time') || t.classList.contains('recipient-select'))){
        updateRecipientSelections();
      }
    });
    recContainer.addEventListener('input', (e)=>{
      const t = e.target;
      if (t && (t.classList.contains('recipient-date') || t.classList.contains('recipient-time'))){
        updateRecipientSelections();
      }
    });
  }

  const donorTimeInput = document.getElementById('donorStartTime');
  if (donorTimeInput) {
    donorTimeInput.addEventListener('change', updateDonorData);
  }

  const adminStartInput = document.getElementById('adminStartTime');
  const adminEndInput = document.getElementById('adminEndTime');
  if (adminStartInput) {
    adminStartInput.addEventListener('change', () => {
      if (adminEndInput && adminEndInput.value && adminEndInput.value < adminStartInput.value) {
        adminEndInput.value = adminStartInput.value;
      }
    });
  }
  if (adminEndInput) {
    adminEndInput.addEventListener('change', () => {
      if (adminStartInput && adminEndInput.value && adminEndInput.value < adminStartInput.value) {
        adminStartInput.value = adminEndInput.value;
      }
    });
  }

  // When the modal opens from distribution pickup, switch to Recipient and auto-populate
  const modalEl = document.getElementById('eventModal');
  if (modalEl) {
    modalEl.addEventListener('shown.bs.modal', () => {
      // Always show the modal; gate via disabled form + single warning toast
      if (!ensureRecipientSchedulingEligibility()) {
        // Kick off async verification and surface a single warning; do not close modal
        showScheduleEligibilityWarning();
        disableSchedulingFormForRecipient();
      }
      if (isFromPickup()) {
        setEventType(enforceAllowedEventType('recipient'));
        // Delay to ensure select2 is fully mounted
        setTimeout(() => tryAutoPopulateRecipientsFromPickup(), 0);
      }
      applyActiveTimeConstraints();
    });
  }
}

function handleAutoLaunchFromDonation(){
  if (donationAutoTriggered || !isFromDonation()) return;
  donationAutoTriggered = true;

  const donorIdRaw = getQueryParam('donorId');
  const donorName = (getQueryParam('donorName') || '').trim();
  const donorId = Number.isFinite(Number(donorIdRaw)) && Number(donorIdRaw) > 0
    ? String(Number(donorIdRaw))
    : '';

  let attempts = 0;
  let intervalId = 0;
  let listenerAttached = false;

  function cleanup(success = false) {
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = 0;
    }
    const modalEl = document.getElementById('eventModal');
    if (modalEl && listenerAttached) {
      modalEl.removeEventListener('shown.bs.modal', onShown);
      listenerAttached = false;
    }
    if (success) {
      try {
        const url = new URL(window.location.href);
        url.searchParams.delete('from');
        if (donorId) url.searchParams.delete('donorId');
        if (donorName) url.searchParams.delete('donorName');
        window.history.replaceState({}, document.title, url.toString());
      } catch (_) {
        /* ignore */
      }
    }
  }

  function prefillDonorFields() {
    try {
      setEventType(enforceAllowedEventType('donor'));
    } catch (_) {
      /* ignore */
    }

    try {
      const titleInput = document.getElementById('evTitle');
      if (titleInput && donorName && !titleInput.value) {
        titleInput.value = `Pickup with ${donorName}`;
      }
    } catch (_) {
      /* ignore */
    }

    const donorSelect = document.getElementById('evDonor');
    if (donorSelect) {
      try {
        if (typeof window.$ === 'function' && window.$.fn?.select2) {
          const $donor = window.$(donorSelect);
          if (!$donor.data('select2')) {
            initDonorSelect();
          }
        }

        if (donorId) {
          let option = Array.from(donorSelect.options || []).find((opt) => opt.value === donorId);
          if (!option) {
            option = new Option(donorName || `Donor #${donorId}`, donorId, true, true);
            donorSelect.appendChild(option);
          } else {
            option.selected = true;
          }
          if (typeof window.$ === 'function' && window.$.fn?.select2) {
            window.$(donorSelect).val(donorId).trigger('change');
          } else {
            donorSelect.value = donorId;
            donorSelect.dispatchEvent(new Event('change', { bubbles: true }));
          }
        }
      } catch (_) {
        /* ignore */
      }
    }

    try {
      updateDonorData();
    } catch (_) {
      /* ignore */
    }

    setTimeout(() => {
      const donorSection = document.getElementById('wrapDonor');
      if (donorSection) donorSection.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 200);
  }

  function onShown() {
    if (!ensureRecipientSchedulingEligibility()) {
      cleanup();
      showScheduleEligibilityWarning();
      return;
    }
    prefillDonorFields();
    cleanup(true);
  }

  intervalId = window.setInterval(() => {
    attempts += 1;
    const modalEl = document.getElementById('eventModal');
    const newBtn = document.getElementById('newEventBtn');
    if (!(modalEl && newBtn && typeof bootstrap !== 'undefined' && bootstrap.Modal)) {
      if (attempts >= 20) cleanup();
      return;
    }

    if (!listenerAttached) {
      modalEl.addEventListener('shown.bs.modal', onShown);
      listenerAttached = true;
    }

    if (!modalEl.classList.contains('show')) {
      newBtn.click();
    }

    if (attempts >= 20) {
      cleanup();
    }
  }, 250);
}

function setEventType(type) {
  const allowedType = enforceAllowedEventType(type);
  setActiveEventTypeButton(allowedType);
  if (eventTypeInputEl) eventTypeInputEl.value = allowedType;
  setEventTypeUI(allowedType);
  if (allowedType === 'donor') {
    updateDonorData();
  }
  if (allowedType === 'recipient') {
    if (currentUserRole === 'admin') {
      ensureRecipientStatusMap().catch(()=>{});
    }
    if (!ensureRecipientSchedulingEligibility()) {
      showScheduleEligibilityWarning();
      return;
    }
    tryAutoPopulateRecipientsFromPickup();
  }
  applyRoleSpecificFormLock(allowedType);
  applyActiveTimeConstraints();
}

function setActiveEventTypeButton(type) {
  if (!eventTypeButtons.length) return;
  eventTypeButtons.forEach((btn) => {
    const isActive = btn.dataset.type === type;
    btn.classList.toggle('active', isActive);
    if (isActive) {
      btn.classList.remove('btn-outline-secondary');
      if (type === 'recipient') {
        btn.classList.add('btn-primary');
        btn.classList.remove('btn-secondary');
      } else {
        btn.classList.add('btn-secondary');
        btn.classList.remove('btn-primary');
      }
    } else {
      btn.classList.add('btn-outline-secondary');
      btn.classList.remove('btn-primary');
      btn.classList.remove('btn-secondary');
    }
  });
}

function setEventTypeUI(type) {
  const recipientSection = document.getElementById('wrapRecipient');
  const donorSection = document.getElementById('wrapDonor');
  const adminTimes = document.getElementById('wrapAdminTimes');
  const pickupDetails = document.getElementById('wrapPickupDetails');
  const locationInput = document.getElementById('evLocation');
  const isEditing = !!(document.getElementById('evId') && document.getElementById('evId').value);
  const locationLabel = pickupDetails?.querySelector('label[for="evLocation"]');

  const updateLocationLabel = (text, hidden = false) => {
    if (!locationLabel) return;
    locationLabel.textContent = text;
    if (hidden) {
      locationLabel.classList.add('visually-hidden');
    } else {
      locationLabel.classList.remove('visually-hidden');
    }
  };

  const showSection = (el) => {
    if (!el) return;
    el.classList.remove('d-none');
    el.style.removeProperty('display');
  };
  const hideSection = (el) => {
    if (!el) return;
    el.classList.add('d-none');
    el.style.display = 'none';
  };

  switch(type) {
    case 'recipient':
      // Show recipient-specific UI
      showSection(recipientSection);
      hideSection(donorSection);
      hideSection(adminTimes);
      if (pickupDetails) {
        pickupDetails.querySelector('.card-header h6').textContent = 'Pickup Details';
        updateLocationLabel('', true);
      }
      if (locationInput) {
        // Only set a default if not editing or if the field is empty
        if (!isEditing && !locationInput.value) {
          locationInput.value = 'Warehouse';
        }
      }
      break;
      
    case 'donor':
      // Show donor-specific UI
      hideSection(recipientSection);
      showSection(donorSection);
      hideSection(adminTimes);
      if (pickupDetails) {
        pickupDetails.querySelector('.card-header h6').textContent = 'Pickup Information';
        updateLocationLabel('', true);
      }
      if (locationInput) {
        // Preserve existing address while editing; clear only for brand new events with no value yet
        if (!isEditing && !locationInput.value) {
          locationInput.value = '';
        }
      }
      break;
      
    case 'admin':
      // Show admin event UI
      hideSection(recipientSection);
      hideSection(donorSection);
      showSection(adminTimes);
      if (pickupDetails) {
        pickupDetails.querySelector('.card-header h6').textContent = 'Event Details';
        updateLocationLabel('Location');
      }
      if (locationInput) {
        if (!isEditing && !locationInput.value) {
          locationInput.value = 'Warehouse';
        }
      }
      break;
  }
}

function applyRoleSpecificFormLock(activeType) {
  const user = currentUserData || getCurrentUser() || {};
  const userId = getUserIdValue(user) || "self";
  const userName = getUserDisplayName(user);
  const userContact = getUserContactInfo(user);

  const ensureFieldEnabled = (id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.disabled = false;
    el.readOnly = false;
    el.classList.remove('disabled', 'opacity-50');
  };

  const editableFieldIds = ['evTitle', 'evLocation', 'evNotes'];
  editableFieldIds.forEach(ensureFieldEnabled);

  const donorSection = document.getElementById('wrapDonor');
  const donorSelect = document.getElementById('evDonor');
  const donorSummaryId = 'donorSelfSummary';
  const donorSummaryExisting = document.getElementById(donorSummaryId);

  if (currentUserRole === 'donor' && activeType === 'donor') {
    if (donorSelect) {
      donorSelect.innerHTML = '';
      const opt = new Option(userName, userId, true, true);
      donorSelect.appendChild(opt);
      donorSelect.value = String(userId);
      donorSelect.setAttribute('data-locked', '1');
      donorSelect.setAttribute('disabled', 'disabled');
      donorSelect.classList.add('d-none');
    }
    if (donorSection) {
      let summary = donorSummaryExisting;
      if (!summary) {
        summary = document.createElement('div');
        summary.id = donorSummaryId;
        summary.className = 'alert alert-info py-2 px-3 small mb-2';
        donorSection.insertBefore(summary, donorSection.firstElementChild || null);
      }
      summary.textContent = `Donor: ${userName} (auto-selected)`;
    }
    updateDonorData();
  } else {
    if (donorSummaryExisting) donorSummaryExisting.remove();
    if (donorSelect && donorSelect.getAttribute('data-locked') === '1') {
      donorSelect.removeAttribute('data-locked');
      donorSelect.removeAttribute('disabled');
      donorSelect.classList.remove('d-none');
      if (!donorSelect.options.length) {
        donorSelect.appendChild(new Option('', ''));
      }
    }
  }

  const addRecipientBtn = document.getElementById('addAnotherRecipient');
  const recipientContainer = document.getElementById('recipientSelections');
  if (currentUserRole === 'recipient' && activeType === 'recipient') {
    if (addRecipientBtn) addRecipientBtn.classList.add('d-none');
    if (recipientContainer) {
      const blocks = Array.from(recipientContainer.querySelectorAll('.recipient-selection'));
      blocks.slice(1).forEach((el) => el.remove());
      let block = blocks[0];
      if (!block) {
        addRecipientField();
        block = recipientContainer.querySelector('.recipient-selection');
      }
      if (block) {
        const select = block.querySelector('.recipient-select');
        const removeBtn = block.querySelector('.remove-recipient');
        if (removeBtn) removeBtn.classList.add('d-none');
        if (select) {
          select.innerHTML = '';
          const opt = new Option(userName, userId, true, true);
          select.appendChild(opt);
          select.value = String(userId);
          select.setAttribute('data-locked', '1');
          select.setAttribute('disabled', 'disabled');
          select.classList.add('d-none');
        }
        let summary = block.querySelector('.recipient-self-summary');
        if (!summary) {
          summary = document.createElement('div');
          summary.className = 'recipient-self-summary alert alert-info py-2 px-3 small mb-2';
          block.insertBefore(summary, block.firstChild);
        }
        summary.textContent = `Recipient: ${userName} (auto-selected)`;

        const details = block.querySelector('.recipient-details');
        if (details) {
          const contactEl = details.querySelector('.recipient-contact');
          if (contactEl) contactEl.textContent = userContact ? `${userContact}` : 'Not provided';
          const lastPickupEl = details.querySelector('.recipient-last-pickup');
          if (lastPickupEl) lastPickupEl.textContent = '—';
          details.style.display = 'block';
        }
      }
    }
    updateRecipientSelections();
  } else {
    if (addRecipientBtn) addRecipientBtn.classList.remove('d-none');
    if (recipientContainer) {
      recipientContainer.querySelectorAll('.recipient-self-summary').forEach((el) => el.remove());
      recipientContainer.querySelectorAll('.recipient-select[data-locked="1"]').forEach((select) => {
        select.removeAttribute('data-locked');
        select.removeAttribute('disabled');
        select.classList.remove('d-none');
      });
      recipientContainer.querySelectorAll('.remove-recipient.d-none').forEach((btn) => btn.classList.remove('d-none'));
    }
  }
}

function initRecipientSelect(selectEl) {
  if (!selectEl) return;
  const $sel = window.$ ? window.$(selectEl) : null;
  if (!$sel || !$sel.select2) return;
  if (currentUserRole === 'admin') {
    ensureRecipientStatusMap().catch(()=>{});
  }
  $sel.select2({
    dropdownParent: window.$('#eventModal'),
    placeholder: 'Search recipients...',
    allowClear: true,
    width: '100%',
    ajax: {
      url: '/php/api/users/index.php',
      dataType: 'json',
      delay: 250,
      xhrFields: { withCredentials: true },
      data: function (params) {
        return { action: 'list', role: 'recipient', q: params.term || '' };
      },
      processResults: function (data) {
        const items = (data?.data?.items) || [];
        const results = [];
        items.forEach(u => {
          const id = Number(u.user_id);
          if (!Number.isFinite(id) || id <= 0) return;
          const status = statusForRecipientId(id, u.status);
          const allowed = currentUserRole === 'admin' ? isRecipientStatusEligible(status) : true;
          if (!allowed) return;
          results.push({
            id,
            text: u.organization_name || u.name || (`Recipient #${u.user_id}`),
            contact: u.contact_person || 'N/A',
            phone: u.phone || 'N/A',
            lastPickup: 'Never',
            status
          });
        });
        return { results };
      },
      error: function(xhr){ try{ console.warn('Recipient search failed', xhr?.status, xhr?.responseText); }catch(_){} },
      cache: true
    },
    minimumInputLength: 1
  }).on('select2:select', async function(e) {
    const data = e.params?.data || {};
    const block = this.closest('.recipient-selection');
    const name = (data.text || '').trim();
    const idNum = Number(data.id);
    if (!name) {
      displayInlineScheduleToast('Please select a recipient with a valid name.', 'warn');
      if ($sel) {
        $sel.val(null).trigger('change');
      }
      clearRecipientEligibilityUi(block);
      updateRecipientSelections();
      return;
    }
    let eligible = true;
    if (currentUserRole === 'admin') {
      try {
        eligible = await ensureRecipientEligibilityForBlock(block, idNum, name);
      } catch (_) {
        eligible = false;
      }
      if (!eligible) {
        if ($sel) {
          $sel.val(null).trigger('change');
        }
        updateRecipientSelections();
        return;
      }
    } else {
      updateRecipientEligibilityUi(block, { status: '', periodKey: currentDistributionPeriodKey(), runId: null, name, eligible: true });
    }
    const details = block?.querySelector('.recipient-details');
    if (details) {
      const contactEl = details.querySelector('.recipient-contact');
      if (contactEl) contactEl.textContent = `${data.contact || 'N/A'} (${data.phone || 'N/A'})`;
      const pickupEl = details.querySelector('.recipient-last-pickup');
      if (pickupEl) pickupEl.textContent = data.lastPickup || 'Never';
      details.style.display = 'block';
    }
    updateRecipientSelections();
  }).on('select2:clear', function(){
    clearRecipientEligibilityUi(this.closest('.recipient-selection'));
    updateRecipientSelections();
  }).on('change', function(){
    const block = this.closest('.recipient-selection');
    if (!this.value) {
      clearRecipientEligibilityUi(block);
    }
    updateRecipientSelections();
  });
}

function addRecipientField() {
  const recipientSelections = document.getElementById('recipientSelections');
  if (!recipientSelections) return;
  
  const now = new Date();
  const nextHour = new Date(now.getTime() + 60 * 60 * 1000);
  const defaultDate = now.toISOString().split('T')[0];
  const proposedTime = `${String(nextHour.getHours()).padStart(2, '0')}:${String(nextHour.getMinutes()).padStart(2, '0')}`;
  const defaultTime = computeDefaultTimeWithinWindow(proposedTime);
  
  const newRecipient = document.createElement('div');
  newRecipient.className = 'recipient-selection mb-3 p-3 border rounded';
  newRecipient.innerHTML = `
    <div class="d-flex align-items-center gap-2">
      <div class="flex-grow-1" style="min-width: 300px;">
        <select class="form-select recipient-select" data-placeholder="Search recipients...">
          <option></option>
          <!-- Options will be loaded dynamically -->
        </select>
      </div>
      <button type="button" class="btn btn-sm btn-outline-danger remove-recipient" style="height: 38px;">
        <i class="bi bi-x-lg"></i>
      </button>
    </div>
    <div class="recipient-details mt-2 p-2 bg-light rounded">
      <div class="d-flex justify-content-between small mb-2">
        <span>Contact: <span class="recipient-contact text-muted">Not selected</span></span>
        <span>Last Pickup: <span class="recipient-last-pickup text-muted">Never</span></span>
      </div>
      <div class="row g-2">
        <div class="col-md-6">
          <label class="form-label small text-muted mb-1">Pickup Date</label>
          <input type="date" class="form-control form-control-sm recipient-date" value="${defaultDate}" required>
        </div>
        <div class="col-md-6">
          <label class="form-label small text-muted mb-1">Start Time</label>
          <input type="time" class="form-control form-control-sm recipient-time" value="${defaultTime}" required>
        </div>
      </div>
    </div>
  `;
  
  recipientSelections.appendChild(newRecipient);
  
  // Initialize select2 for the new recipient select
  initRecipientSelect(newRecipient.querySelector('.recipient-select'));
  
  // Add remove button handler
  const removeBtn = newRecipient.querySelector('.remove-recipient');
  if (removeBtn) {
    removeBtn.addEventListener('click', function() {
      if (recipientSelections.children.length > 1) {
        newRecipient.remove();
        updateRecipientSelections();
      }
    });
  }
  
  updateRecipientSelections();
  applyActiveTimeConstraints(newRecipient);
}

function updateRecipientSelections() {
  const recipientSelections = document.getElementById('recipientSelections');
  if (!recipientSelections) return;
  
  // Enable/disable remove buttons based on number of recipients
  const removeButtons = recipientSelections.querySelectorAll('.remove-recipient');
  removeButtons.forEach((btn, index) => {
    btn.disabled = removeButtons.length <= 1;
  });
  
  // Update hidden input with selected recipients
  const selectedRecipients = [];
  document.querySelectorAll('.recipient-select').forEach(select => {
    if (select.value) {
      const recipientSelection = select.closest('.recipient-selection');
      const date = recipientSelection.querySelector('.recipient-date').value;
      const time = recipientSelection.querySelector('.recipient-time').value;
      const status = recipientSelection?.dataset.recipientStatus || '';
      const weekKey = recipientSelection?.dataset.recipientPeriod || '';
      const nameFromDataset = recipientSelection?.dataset.recipientName || '';
      let selectedName = select.options[select.selectedIndex]?.text || nameFromDataset;
      if (!selectedName && typeof window.$ === 'function' && window.$.fn?.select2) {
        const data = window.$(select).select2('data');
        if (Array.isArray(data) && data[0]?.text) selectedName = data[0].text;
      }
      
      selectedRecipients.push({
        id: select.value,
        name: selectedName,
        date: date,
        time: time,
        status: status,
        week: weekKey,
        // Combine date and time for sorting/display
        datetime: date && time ? `${date}T${time}` : null
      });
    }
  });
  
  const recipientsInput = document.getElementById('evRecipients');
  if (recipientsInput) {
    recipientsInput.value = JSON.stringify(selectedRecipients);
  }
  
  // Update donor/admin timing data
  updateDonorData();
}

function resetRecipientFields(options = {}) {
  const { date = '', time = '', clearAdditional = true } = options;
  const container = document.getElementById('recipientSelections');
  if (!container) return;

  const blocks = Array.from(container.querySelectorAll('.recipient-selection'));
  if (!blocks.length) {
    addRecipientField();
  }

  const refreshedBlocks = Array.from(container.querySelectorAll('.recipient-selection'));
  refreshedBlocks.forEach((block, idx) => {
    if (idx > 0 && clearAdditional) {
      block.remove();
      return;
    }

    const select = block.querySelector('.recipient-select');
    if (select) {
      if (typeof window.$ === 'function' && window.$.fn?.select2) {
        const $sel = window.$(select);
        if ($sel.data('select2')) {
          $sel.val(null).trigger('change');
        } else {
          select.value = '';
        }
      } else {
        select.value = '';
      }

      Array.from(select.options).forEach((opt, optionIndex) => {
        if (optionIndex === 0) return;
        if (opt.value) opt.remove();
      });
    }

    const contactEl = block.querySelector('.recipient-contact');
    if (contactEl) contactEl.textContent = 'Not selected';
    const pickupEl = block.querySelector('.recipient-last-pickup');
    if (pickupEl) pickupEl.textContent = 'Never';
    const detailWrap = block.querySelector('.recipient-details');
    if (detailWrap) detailWrap.style.removeProperty('display');

    const dateInput = block.querySelector('.recipient-date');
    if (dateInput && date !== null) {
      dateInput.value = date;
    }
    const timeInput = block.querySelector('.recipient-time');
    if (timeInput && time !== null) {
      const value = time ? clampTimeToWindow(time, getActiveTimeWindow()) : computeDefaultTimeWithinWindow('');
      timeInput.value = value;
    }
  });

  recipientsLoadedFromPickup = false;
  updateRecipientSelections();
  applyActiveTimeConstraints();
}

function updateDonorData() {
  const donorSelect = document.getElementById('evDonor');
  const donorTime = document.getElementById('donorStartTime');
  const donorInput = document.getElementById('evDonorData');
  
  if (donorSelect && donorInput) {
    if (donorSelect.value) {
      const win = getActiveTimeWindow();
      const timeValue = donorTime ? clampTimeToWindow(donorTime.value, win) : null;
      if (donorTime) {
        donorTime.value = timeValue || donorTime.value;
        applyTimeWindowToInput(donorTime, win);
      }
      donorInput.value = JSON.stringify({
        id: donorSelect.value,
        name: donorSelect.options[donorSelect.selectedIndex].text,
        time: timeValue || null
      });
    } else {
      donorInput.value = '';
    }
  }
}

function initDonorSelect() {
  const donorSelectEl = document.getElementById('evDonor');
  if (!donorSelectEl) return;

  const $donor = $(donorSelectEl).select2({
    dropdownParent: $('#eventModal'),
    placeholder: 'Search donors...',
    allowClear: true,
    width: '100%',
    ajax: {
      url: '/php/api/users/index.php',
      dataType: 'json',
      delay: 250,
      xhrFields: { withCredentials: true },
      data: (params) => ({ action: 'list', role: 'donor', q: params.term || '' }),
      processResults: (data) => {
        const items = (data?.data?.items) || [];
        return { results: items.map(u => ({
          id: u.user_id,
          text: u.organization_name || u.name || (`Donor #${u.user_id}`),
          address: u.address || null
        })) };
      },
      error: function(xhr){ try{ console.warn('Donor search failed', xhr?.status, xhr?.responseText); }catch(_){} },
      cache: true
    },
    minimumInputLength: 1
  });

  $donor.on('select2:select', function(e) {
    updateDonorData();
    const locInput = document.getElementById('evLocation');
    const data = e.params && e.params.data;
    if (locInput && data && data.address) {
      locInput.value = data.address;
    }
  });
  $donor.on('select2:clear', function() {
    updateDonorData();
    const locInput = document.getElementById('evLocation');
    if (locInput) {
      locInput.value = '';
    }
  });

  donorSelectEl.addEventListener('change', updateDonorData);
}

function initDateTimePickers() {
  // Set minimum date to today for all date inputs
  const today = new Date().toISOString().split('T')[0];
  document.querySelectorAll('.recipient-date').forEach(input => {
    input.min = today;
    if (!isFromPickup() && !input.value) { input.value = today; }
  });
  
  // Set default time to next hour for all time inputs
  const now = new Date();
  const nextHour = new Date(now.getTime() + 60 * 60 * 1000);
  const defaultTime = `${String(nextHour.getHours()).padStart(2, '0')}:${String(nextHour.getMinutes()).padStart(2, '0')}`;
  const clampedDefaultTime = computeDefaultTimeWithinWindow(defaultTime);
  
  document.querySelectorAll('.recipient-time').forEach(input => {
    if (!isFromPickup() && !input.value) {
      input.value = clampedDefaultTime;
    } else if (input.value) {
      input.value = clampTimeToWindow(input.value, getActiveTimeWindow());
    }
    applyTimeWindowToInput(input, getActiveTimeWindow());
  });

  const donorTime = document.getElementById('donorStartTime');
  if (donorTime) {
    if (!donorTime.value) {
      donorTime.value = clampedDefaultTime;
    }
    applyTimeWindowToInput(donorTime, getActiveTimeWindow());
  }

  const adminStart = document.getElementById('adminStartTime');
  const adminEnd = document.getElementById('adminEndTime');
  const timeWindow = getActiveTimeWindow();
  if (adminStart) {
    if (!adminStart.value) {
      adminStart.value = clampedDefaultTime;
    } else {
      adminStart.value = clampTimeToWindow(adminStart.value, timeWindow);
    }
    applyTimeWindowToInput(adminStart, timeWindow);
  }
  if (adminEnd) {
    const twoHours = new Date(nextHour.getTime() + 60 * 60 * 1000);
    const proposedEnd = `${String(twoHours.getHours()).padStart(2, '0')}:${String(twoHours.getMinutes()).padStart(2, '0')}`;
    if (!adminEnd.value) {
      let defaultEnd = clampTimeToWindow(proposedEnd, timeWindow);
      if (adminStart && adminStart.value && defaultEnd < adminStart.value) {
        defaultEnd = adminStart.value;
      }
      adminEnd.value = defaultEnd;
    } else {
      adminEnd.value = clampTimeToWindow(adminEnd.value, timeWindow);
    }
    applyTimeWindowToInput(adminEnd, timeWindow);
    ensureAdminEndAfterStart(adminStart, adminEnd);
  }
}

// Date/time now handled per recipient, no need for global update functions

function handleEventFormSubmit(e) {
  e.preventDefault();
  
  // Show loading state
  const submitBtn = document.querySelector('#eventForm [type="submit"]');
  const originalBtnText = submitBtn.innerHTML;
  submitBtn.disabled = true;
  submitBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-1" role="status" aria-hidden="true"></span> Saving...';
  
  // Collect form data
  const type = document.getElementById('evType').value;
  const recipients = JSON.parse(document.getElementById('evRecipients').value || '[]');
  const donorDataRaw = document.getElementById('evDonorData').value;
  const donorData = donorDataRaw ? JSON.parse(donorDataRaw) : null;
  const adminStart = document.getElementById('adminStartTime') ? document.getElementById('adminStartTime').value : null;
  const adminEnd = document.getElementById('adminEndTime') ? document.getElementById('adminEndTime').value : null;

  if (type === 'recipient' && recipients.length === 0) {
    alert('Please add at least one recipient with a scheduled time.');
    submitBtn.innerHTML = originalBtnText;
    submitBtn.disabled = false;
    return;
  }

  if (type === 'donor' && (!donorData || !donorData.id || !donorData.time)) {
    alert('Please select a donor and provide a start time.');
    submitBtn.innerHTML = originalBtnText;
    submitBtn.disabled = false;
    return;
  }

  if (type === 'admin' && (!adminStart || !adminEnd)) {
    alert('Please provide both start and end times for the admin event.');
    submitBtn.innerHTML = originalBtnText;
    submitBtn.disabled = false;
    return;
  }

  const window = getActiveTimeWindow();
  const timeRangeMessage = `between ${formatTimeForDisplay(window.min)} and ${formatTimeForDisplay(window.max)}`;

  if (type === 'recipient') {
    const invalidRecipient = recipients.some((rec) => rec.time && !isTimeWithinWindow(rec.time, window));
    if (invalidRecipient) {
      alert(`Please select recipient pickup times ${timeRangeMessage}.`);
      submitBtn.innerHTML = originalBtnText;
      submitBtn.disabled = false;
      return;
    }
  }

  if (type === 'donor') {
    if (donorData && donorData.time && !isTimeWithinWindow(donorData.time, window)) {
      alert(`Please select a donor pickup time ${timeRangeMessage}.`);
      submitBtn.innerHTML = originalBtnText;
      submitBtn.disabled = false;
      return;
    }
  }

  if (type === 'admin') {
    if ((adminStart && !isTimeWithinWindow(adminStart, window)) || (adminEnd && !isTimeWithinWindow(adminEnd, window))) {
      alert(`Admin event times must be ${timeRangeMessage}.`);
      submitBtn.innerHTML = originalBtnText;
      submitBtn.disabled = false;
      return;
    }
    if (adminStart && adminEnd && adminEnd < adminStart) {
      alert('End time cannot be earlier than the start time.');
      submitBtn.innerHTML = originalBtnText;
      submitBtn.disabled = false;
      return;
    }
  }

  const formData = {
    id: document.getElementById('evId').value || null,
    title: document.getElementById('evTitle').value,
    type,
    location: document.getElementById('evLocation').value,
    notes: document.getElementById('evNotes').value
  };

  if (type === 'recipient') {
    formData.recipients = recipients;
  } else if (type === 'donor') {
    formData.donor = donorData;
  } else if (type === 'admin') {
    formData.adminTimes = { start: adminStart, end: adminEnd };
  }
  
  // Simulate API call (replace with actual API call)
  setTimeout(() => {
    console.log('Form submitted:', formData);
    
    // Reset form and show success message
    submitBtn.innerHTML = originalBtnText;
    submitBtn.disabled = false;
    
    // Show success message
    const toast = document.createElement('div');
    toast.className = 'position-fixed bottom-0 end-0 m-3 alert alert-success alert-dismissible fade show';
    toast.role = 'alert';
    toast.innerHTML = `
      <i class="bi bi-check-circle-fill me-2"></i>
      <strong>Success!</strong> Event ${formData.id ? 'updated' : 'created'} successfully.
      <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
    `;
    document.body.appendChild(toast);
    
    // Auto-dismiss after 3 seconds
    setTimeout(() => {
      const bsAlert = new bootstrap.Alert(toast);
      bsAlert.close();
    }, 3000);
    
    // Close modal if open
    const modal = bootstrap.Modal.getInstance(document.getElementById('eventModal'));
    if (modal) modal.hide();
    
  }, 1000);
}

// Make functions available globally
window.SchedulePickupUI = {
  init: initSchedulePickupUI,
  addRecipientField,
  updateRecipientSelections,
  resetRecipientFields,
  handleEventFormSubmit,
  updateUI: setEventTypeUI,
  setType: setEventType,
  updateDonorData,
  applyTimeConstraints: applyActiveTimeConstraints,
  getTimeWindowForRole,
  formatTimeForDisplay
};
