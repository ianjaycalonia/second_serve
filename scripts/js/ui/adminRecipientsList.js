(function () {
  "use strict";

  const API_BASE_URL =
    typeof window.API_BASE_URL === "string" && window.API_BASE_URL
      ? window.API_BASE_URL
      : "/php/api";

  const qs = (s, r = document) => r.querySelector(s);
  const qsa = (s, r = document) => Array.from(r.querySelectorAll(s));
  // Track recipients whose allocation is considered locked (cannot return to pool unless cancelled)
  const lockedIds = new Set();

  function toast(msg, type = "secondary") {
    try {
      const container = document.getElementById("rlToastContainer");
      if (!container || !window.bootstrap) throw new Error("no container");
      const color =
        {
          success: "success",
          danger: "danger",
          warning: "warning",
          info: "info",
        }[type] || "secondary";
      const div = document.createElement("div");
      div.className = "toast align-items-center text-bg-" + color;
      div.setAttribute("role", "alert");
      div.setAttribute("aria-live", "assertive");
      div.setAttribute("aria-atomic", "true");
      div.innerHTML = `
        <div class="d-flex">
          <div class="toast-body">${String(msg || "")}</div>
          <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button>
        </div>`;
      container.appendChild(div);
      const t = new bootstrap.Toast(div, { autohide: true, delay: 2500 });
      t.show();
      div.addEventListener("hidden.bs.toast", () => div.remove());
      return;
    } catch (_) {}
    // Fallback
    try {
      alert(String(msg || ""));
    } catch (_) {}
  }

  try { window.__rl_updateCounts = updateCounts; } catch (_) {}

  async function clearUnsavedAcrossWeeks() {
    try {
      const pool = qs('#pool');
      const dropIds = ['w1','w2','w3','w4'];
      let moved = 0;
      for (const did of dropIds) {
        const dz = qs('#' + did);
        if (!dz) continue;
        qsa('.rcard[data-user-id]', dz).forEach((card) => {
          const id = parseInt(card.getAttribute('data-user-id') || '0', 10);
          if (!id) return;
          if (lockedIds.has(id)) return; // keep saved (locked) recipients
          card.remove();
          let poolCard = qs(`#pool .rcard[data-user-id="${id}"]`);
          if (!poolCard) {
            const user = window.__rl_usersById?.get(id);
            if (user && pool) {
              poolCard = createCard(user);
              pool.appendChild(poolCard);
            }
          }
          if (poolCard) {
            delete poolCard.dataset.locked;
            poolCard.style.display = '';
          }
          moved++;
        });
      }
      updateCounts();
      toast(moved ? `Cleared ${moved} unsaved recipient(s)` : 'No unsaved recipients to clear', moved ? 'success' : 'info');
    } catch (e) {
      toast('Failed to clear unsaved recipients', 'danger');
    }
  }

  // Determine recipient tag flags (infant/elderly/medicine) from user record
  function recipientFlags(user) {
    const txt = [
      String(user.tags || "").toLowerCase(),
      String(user.organization_type || "").toLowerCase(),
      String(user.age_group || "").toLowerCase(),
    ].join(" ");
    const hasInfant = /infant|baby|toddler|daycare|orphan/.test(txt);
    const hasElderly = /elder|senior|aged|home for the aged/.test(txt);
    const hasMedicine =
      /med|medicine|clinic|health|pharma|vitamin|paracetamol/.test(txt);
    return { hasInfant, hasElderly, hasMedicine };
  }

  async function confirmAction(message, title = "Confirm") {
    // Creates a temporary Bootstrap modal for confirmation; resolves true/false
    try {
      const id = "rlTempConfirmModal_" + Date.now();
      const wrap = document.createElement("div");
      wrap.innerHTML = `
        <div class="modal fade" id="${id}" tabindex="-1" aria-hidden="true">
          <div class="modal-dialog">
            <div class="modal-content">
              <div class="modal-header">
                <h5 class="modal-title">${title}</h5>
                <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
              </div>
              <div class="modal-body">${message}</div>
              <div class="modal-footer">
                <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
                <button type="button" class="btn btn-primary" data-role="confirm">Proceed</button>
              </div>
            </div>
          </div>
        </div>`;
      document.body.appendChild(wrap);
      const modalEl = wrap.firstElementChild;
      const m = bootstrap.Modal.getOrCreateInstance(modalEl);
      return await new Promise((resolve) => {
        modalEl.addEventListener(
          "hidden.bs.modal",
          () => {
            wrap.remove();
            resolve(false);
          },
          { once: true }
        );
        const btn = modalEl.querySelector('[data-role="confirm"]');
        btn.addEventListener(
          "click",
          () => {
            resolve(true);
            m.hide();
          },
          { once: true }
        );
        m.show();
      });
    } catch (_) {
      return window.confirm(String(message || "Proceed?"));
    }
  }

  function currentWeekStamp() {
    const basis = window.__WEEK_START === "monday" ? "monday" : "sunday";
    const starts = upcomingWeekStartDates(basis);
    const d0 = starts[0] || new Date();
    const wn = weekNumber(d0, basis);
    return `${d0.getFullYear()}-W${wn}`;
  }
  async function handleWeekRollover() {
    try {
      const stamp = currentWeekStamp();
      const prev = localStorage.getItem("rl_last_week_stamp");
      if (prev && prev !== stamp) {
        // Clear last week's assignments (W1) on the server so recipients go back to pool
        try {
          await apiSavePlan({ W1: [] }, currentMonth());
          toast("Rolled over: cleared last week's assignments", "info");
        } catch (_) {
          /* ignore server error but continue */
        }
        // Ping backend to notify admins about the new week start (1, 8, 15, 22)
        try {
          await fetch(`${API_BASE_URL}/recipients/index.php?action=notify_new_week`, {
            method: "POST",
            credentials: "include",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            body: JSON.stringify({ stamp }),
          });
        } catch (_) {
          /* notification is best-effort */
        }
      }
      localStorage.setItem("rl_last_week_stamp", stamp);
    } catch (_) {}
  }

  function createCard(user) {
    const el = document.createElement("div");
    el.className = "rcard";
    el.draggable = true;
    el.setAttribute("data-user-id", String(user.user_id));
    const org =
      user.organization_name && user.organization_name.trim()
        ? user.organization_name.trim()
        : "";
    const typ =
      user.organization_type && String(user.organization_type).trim()
        ? String(user.organization_type).trim()
        : "";
    const label = org
      ? typ
        ? `${org} - ${typ}`
        : org
      : user.name || "Recipient " + user.user_id;
    el.innerHTML = `<i class="bi bi-person-badge"></i><span class="small text-muted">${label}</span>`;
    return el;
  }

  function setupDragSources(container) {
    container.addEventListener("dragstart", (e) => {
      const t = e.target;
      if (!(t instanceof HTMLElement)) return;
      if (!t.classList.contains("rcard")) return;
      const id = t.getAttribute("data-user-id") || "";
      e.dataTransfer?.setData("text/plain", id);
      e.dataTransfer?.setDragImage(t, 10, 10);
    });
  }

  function setupDropzone(el) {
    function findBeforeElement(container, clientY) {
      const cards = qsa(":scope > .rcard", container);
      for (const card of cards) {
        const rect = card.getBoundingClientRect();
        const midpoint = rect.top + rect.height / 2;
        if (clientY < midpoint) return card;
      }
      return null; // append at end
    }
    el.addEventListener("dragover", (e) => {
      e.preventDefault();
      el.classList.add("drag-over");
      e.dataTransfer.dropEffect = "move";
    });
    el.addEventListener("dragleave", () => el.classList.remove("drag-over"));
    el.addEventListener("drop", (e) => {
      e.preventDefault();
      el.classList.remove("drag-over");
      const id = parseInt(e.dataTransfer?.getData("text/plain") || "0", 10);
      if (!id) return;
      const user = window.__rl_usersById?.get(id);
      if (!user) return;
      // Remove existing from any week
      const existingAssigned = document.querySelector(
        `.dropzone .rcard[data-user-id="${id}"]`
      );
      if (existingAssigned && existingAssigned.parentElement !== el) {
        existingAssigned.remove();
      }
      let card = el.querySelector(`.rcard[data-user-id="${id}"]`);
      if (!card) {
        // may be from pool
        card = createCard(user);
      } else {
        // moving within same week: detach to reinsert at new position
        card.remove();
      }
      const before = findBeforeElement(el, e.clientY);
      if (before) el.insertBefore(card, before);
      else el.appendChild(card);
      const poolCard = qs(`#pool .rcard[data-user-id="${id}"]`);
      if (poolCard) {
        poolCard.style.display =
          "none"; /* keep hidden; may be locked later after save */
      }
      updateCounts();
    });
  }

  function setupPoolDnD() {
    const poolWrap = qs(".rpool-scroll");
    const pool = qs("#pool");
    if (!poolWrap || !pool) return;
    poolWrap.addEventListener("dragover", (e) => {
      e.preventDefault();
      poolWrap.classList.add("drag-over");
      e.dataTransfer.dropEffect = "move";
    });
    poolWrap.addEventListener("dragleave", () =>
      poolWrap.classList.remove("drag-over")
    );
    poolWrap.addEventListener("drop", (e) => {
      e.preventDefault();
      poolWrap.classList.remove("drag-over");
      const id = parseInt(e.dataTransfer?.getData("text/plain") || "0", 10);
      if (!id) return;
      // If locked, do not allow returning to pool unless explicitly unlocked (cancellation TBD)
      if (lockedIds.has(id)) {
        toast(
          "Recipient is locked. Cancel allocation to return to pool.",
          "warning"
        );
        return;
      }
      // remove from any week
      const assigned = document.querySelector(
        `.dropzone .rcard[data-user-id="${id}"]`
      );
      if (assigned) assigned.remove();
      // show in pool
      let poolCard = qs(`#pool .rcard[data-user-id="${id}"]`);
      if (!poolCard) {
        const user = window.__rl_usersById?.get(id);
        if (user) {
          poolCard = createCard(user);
          pool.appendChild(poolCard);
        }
      }
      if (poolCard) {
        // If previously marked locked, keep hidden; else show
        if (poolCard.dataset.locked === "1") poolCard.style.display = "none";
        else poolCard.style.display = "";
      }
      updateCounts();
    });
  }

  function filterPool(term) {
    const t = String(term || "").toLowerCase();
    qsa("#pool .rcard").forEach((el) => {
      const lbl = (el.textContent || "").toLowerCase();
      // Do not reveal locked entries via search
      if (el.dataset.locked === "1") {
        el.style.display = "none";
        return;
      }
      el.style.display = (!t || lbl.includes(t)) ? "" : "none";
    });
  }

  function clearWeek(dropId) {
    const dz = qs("#" + dropId);
    const pool = qs("#pool");
    if (!dz || !pool) return;
    qsa(".rcard[data-user-id]", dz).forEach((card) => {
      const id = parseInt(card.getAttribute("data-user-id") || "0", 10);
      card.remove();
      let poolCard = qs(`#pool .rcard[data-user-id="${id}"]`);
      if (poolCard) poolCard.style.display = "";
      else {
        const user = window.__rl_usersById?.get(id);
        if (user) pool.appendChild(createCard(user));
      }
    });
    updateCounts();
  }

  function collectWeekIds(dropId) {
    return qsa(`#${dropId} .rcard[data-user-id]`)
      .map((el) => parseInt(el.getAttribute("data-user-id") || "0", 10))
      .filter(Boolean);
  }
  function currentMonth() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }
  function isoWeekNumber(date) {
    const d = new Date(
      Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())
    );
    const dayNum = d.getUTCDay() || 7; // Sun=7
    d.setUTCDate(d.getUTCDate() + 4 - dayNum); // nearest Thursday
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  }
  function monthWeekStartDates(month, weekStart) {
    // month: 'YYYY-MM', weekStart: 'sunday'|'monday'
    const m = /^(\d{4})-(\d{2})$/.exec(String(month));
    if (!m) return [];
    const year = parseInt(m[1], 10),
      mon = parseInt(m[2], 10);
    const wsDow = weekStart === "monday" ? 1 : 0; // 0=Sun..6=Sat
    const first = new Date(year, mon - 1, 1);
    const firstDow = first.getDay();
    const offset = (firstDow - wsDow + 7) % 7;
    const firstWeekStart = new Date(year, mon - 1, 1 - offset);
    return [0, 1, 2, 3].map(
      (i) =>
        new Date(
          firstWeekStart.getFullYear(),
          firstWeekStart.getMonth(),
          firstWeekStart.getDate() + i * 7
        )
    );
  }
  function startOfWeek(date, weekStart) {
    const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const targetDow = weekStart === "monday" ? 1 : 0; // 0=Sun,1=Mon
    const dow = d.getDay();
    const diff = (dow - targetDow + 7) % 7;
    d.setDate(d.getDate() - diff);
    d.setHours(0, 0, 0, 0);
    return d;
  }
  // Base date helpers (user-entered exact start date)
  function formatYMD(d) {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }
  function getBaseDate() {
    try {
      const el = document.getElementById("rlBaseDate");
      let d = null;
      if (el && el.value) {
        d = new Date(el.value + "T00:00:00");
      }
      if (!d || isNaN(d)) {
        d =
          window.__RL_BASE_DATE instanceof Date
            ? window.__RL_BASE_DATE
            : new Date();
      }
      d.setHours(0, 0, 0, 0);
      window.__RL_BASE_DATE = d;
      return d;
    } catch (_) {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      window.__RL_BASE_DATE = d;
      return d;
    }
  }
  function upcomingWeekStartDates(weekStart) {
    // Ignore alignment; use exact base date + 7-day intervals
    const base = getBaseDate();
    return [0, 1, 2, 3].map(
      (i) =>
        new Date(base.getFullYear(), base.getMonth(), base.getDate() + i * 7)
    );
  }
  function isoWeekNumber(date) {
    const d = new Date(
      Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())
    );
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  }
  function weekNumber(date, basis) {
    const b = basis === "monday" ? "monday" : "sunday";
    if (b === "monday") return isoWeekNumber(date);
    // Sunday-based week numbering: Week 1 starts on the Sunday of the week containing Jan 1
    const year = date.getFullYear();
    const start = startOfWeek(date, "sunday");
    const jan1 = new Date(year, 0, 1);
    const yearWeek0 = startOfWeek(jan1, "sunday");
    const diffDays = Math.floor((start - yearWeek0) / 86400000);
    return Math.floor(diffDays / 7) + 1;
  }
  function focusWeekKeyFor(month, weekStart) {
    // In upcoming model, current week is always W1
    return "W1";
  }

  function applyWeekFocusAndButtons() {
    try {
      const month = currentMonth();
      const basis = window.__WEEK_START === "monday" ? "monday" : "sunday";
      const starts = upcomingWeekStartDates(basis);
      const focusKey = "W1";
      const idx = 0;
      const drops = ["w1", "w2", "w3", "w4"];
      const labels = ["w1Label", "w2Label", "w3Label", "w4Label"];
      // Highlight
      drops.forEach((id, i) => {
        const dz = qs("#" + id);
        dz?.classList.toggle("current-week", i === idx);
        const lab = qs("#" + labels[i]);
        if (lab) {
          // ensure base text shows week number
          try {
            lab.classList.add("week-label");
          } catch (_) {}
          // remove existing badge
          const ex = lab.querySelector(".badge.badge-current");
          if (ex) ex.remove();
          if (i === idx) {
            const b = document.createElement("span");
            b.className = "badge badge-current text-bg-info";
            b.textContent = "Current";
            lab.appendChild(b);
          }
        }
      });
      // Buttons enabled/locked from server (Save, Clear, Auto)
      const locks = window.__rl_locks || {};
      const groups = [
        { key: "W1", save: "saveW1", clear: "clearW1", auto: "autoW1" },
        { key: "W2", save: "saveW2", clear: "clearW2", auto: "autoW2" },
        { key: "W3", save: "saveW3", clear: "clearW3", auto: "autoW3" },
        { key: "W4", save: "saveW4", clear: "clearW4", auto: "autoW4" },
      ];
      groups.forEach((g) => {
        const disabled = !!locks[g.key];
        const s = qs("#" + g.save);
        if (s) s.disabled = disabled;
        const c = qs("#" + g.clear);
        if (c) c.disabled = disabled;
        const a = qs("#" + g.auto);
        if (a) a.disabled = disabled;
      });
      // No need to reorder columns; W1 is rendered first and is the current week
      // Scroll focus into view (first time only per load)
      if (!window.__rl_focus_scrolled) {
        const focusDz = qs("#" + drops[idx]);
        try {
          focusDz?.scrollIntoView({ behavior: "smooth", block: "nearest" });
        } catch (_) {}
        window.__rl_focus_scrolled = true;
      }
    } catch (_) {}
  }

  function reorderWeekColumns(focusIdx) {
    try {
      const row = qs("main .row.g-3");
      if (!row) return;
      // Collect the 4 columns and map them to indices 0..3 based on dropzone ids
      const colNodes = Array.from(row.children).filter(
        (el) => el.classList && el.classList.contains("col-12")
      );
      if (colNodes.length < 4) return;
      // Determine current order based on presence of #w1..#w4 inside
      const colsByIdx = new Array(4);
      colNodes.forEach((col) => {
        if (col.querySelector("#w1")) colsByIdx[0] = col;
        else if (col.querySelector("#w2")) colsByIdx[1] = col;
        else if (col.querySelector("#w3")) colsByIdx[2] = col;
        else if (col.querySelector("#w4")) colsByIdx[3] = col;
      });
      if (colsByIdx.some((c) => !c)) return;
      // Build new order starting from focusIdx
      // Keep original order (W1..W4)
    } catch (_) {}
  }
  function updateWeekLabels() {
    try {
      const basis = window.__WEEK_START === "monday" ? "monday" : "sunday";
      const starts = upcomingWeekStartDates(basis);
      const ids = ["w1Label", "w2Label", "w3Label", "w4Label"];
      starts.forEach((dt, i) => {
        const end = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate() + 6);
        const el = qs("#" + ids[i]);
        if (el)
          el.textContent = `Week ${i + 1} (${formatYMD(dt)} – ${formatYMD(
            end
          )})`;
      });
      // Update aria-labels of dropzones and button titles with date ranges
      const dzIds = ["w1", "w2", "w3", "w4"];
      dzIds.forEach((id, i) => {
        const dz = qs("#" + id);
        if (!dz) return;
        const dt = starts[i] || new Date();
        const end = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate() + 6);
        dz.setAttribute(
          "aria-label",
          `Week ${i + 1} assignments (${formatYMD(dt)} – ${formatYMD(end)})`
        );
      });
      const btns = [
        ["saveW1", 0],
        ["saveW2", 1],
        ["saveW3", 2],
        ["saveW4", 3],
      ];
      btns.forEach(([id, idx]) => {
        const b = qs("#" + id);
        if (!b) return;
        const dt = starts[idx] || new Date();
        const end = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate() + 6);
        const title = `Save Week ${idx + 1} (${formatYMD(dt)} – ${formatYMD(
          end
        )})`;
        b.setAttribute("title", title);
        b.setAttribute("data-bs-original-title", title);
      });
      // Apply focus/highlight and button states after updating labels
      applyWeekFocusAndButtons();
    } catch (_) {}
  }
  async function apiGetPlan(month) {
    const ws = window.__WEEK_START === "monday" ? "monday" : "sunday";
    const res = await fetch(
      `${API_BASE_URL}/recipients/index.php?action=get_plan&month=${encodeURIComponent(
        month || currentMonth()
      )}&week_start=${encodeURIComponent(ws)}`,
      { credentials: "include" }
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const j = await res.json();
    if (!j?.success) throw new Error(j?.error || "Failed to load plan");
    return j.data;
  }
  async function apiSavePlan(weeksObj, month) {
    const body = { month: month || currentMonth(), weeks: weeksObj || {} };
    const res = await fetch(
      `${API_BASE_URL}/recipients/index.php?action=save_plan`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        credentials: "include",
        body: JSON.stringify(body),
      }
    );
    const j = await res
      .json()
      .catch(() => ({ success: false, error: `HTTP ${res.status}` }));
    if (!res.ok || !j?.success)
      throw new Error(j?.error || `HTTP ${res.status}`);
    return true;
  }

  async function restoreFromServer() {
    const map = window.__rl_usersById || new Map();
    const pool = qs("#pool");
    // Show pool cards initially
    qsa("#pool .rcard").forEach((c) => (c.style.display = ""));
    try {
      const data = await apiGetPlan(currentMonth());
      window.__rl_locks = data?.locks || {};
      const weeks = data?.weeks || {};
      // Rebuild locked set from server plan
      lockedIds.clear();
      [
        ["W1", "w1"],
        ["W2", "w2"],
        ["W3", "w3"],
        ["W4", "w4"],
      ].forEach(([key, drop]) => {
        const dz = qs("#" + drop);
        if (!dz) return;
        dz.innerHTML = "";
        const ids = Array.isArray(weeks[key]) ? weeks[key] : [];
        ids.forEach((id) => {
          const user = map.get(id);
          if (!user) return;
          dz.appendChild(createCard(user));
          const poolCard = qs(`#pool .rcard[data-user-id="${id}"]`);
          if (poolCard) poolCard.style.display = "none";
          // Mark as locked in pool representation
          if (poolCard) poolCard.dataset.locked = "1";
          lockedIds.add(Number(id));
        });
      });
      updateCounts();
    } catch (e) {
      toast("Failed to load plan from server", "danger");
    }
  }

  function updateCounts() {
    try {
      const max = 10;
      const pairs = [
        ["w1", "w1Label"],
        ["w2", "w2Label"],
        ["w3", "w3Label"],
        ["w4", "w4Label"],
      ];
      pairs.forEach(([dropId, labelId]) => {
        const dz = qs("#" + dropId);
        const lbl = qs("#" + labelId);
        if (!dz || !lbl) return;
        const count = qsa(".rcard[data-user-id]", dz).length;
        // remove existing count badge
        const old = lbl.querySelector(".badge.badge-count");
        if (old) old.remove();
        const b = document.createElement("span");
        b.className = "badge badge-count text-bg-secondary ms-2";
        b.textContent = String(count);
        lbl.appendChild(b);
      });
    } catch (_) {}
  }

  async function markStatuses() {
    try {
      const res = await fetch(
        `${API_BASE_URL}/inventory/index.php/movements?mode=recipient&days=31&limit=500`,
        { credentials: "include" }
      );
      const j = await res.json();
      if (!res.ok || !j?.success) return;
      const items = Array.isArray(j?.data?.items) ? j.data.items : [];
      // Build set of recipient_ids that had allocations in the last 31 days
      const allocatedSet = new Set(
        items
          .filter((r) => String(r.direction).toLowerCase() === "out")
          .map((r) => Number(r.recipient_id || 0) || 0)
      );
      // Apply classes
      qsa(".dropzone .rcard").forEach((card) => {
        const id = parseInt(card.getAttribute("data-user-id") || "0", 10);
        card.classList.remove(
          "status-allocated",
          "status-completed",
          "status-cancelled"
        );
        if (allocatedSet.has(id)) card.classList.add("status-allocated");
      });
    } catch (_) {
      /* ignore */
    }
  }

  async function saveWeekKey(weekKey, dropId) {
    const ids = collectWeekIds(dropId);
    // Disallow saving an empty column
    if (ids.length === 0) {
      toast(
        `Cannot save ${weekKey}: column is empty. Add at least 1 recipient.`,
        "warning"
      );
      return;
    }
    // If not at the computed target per week, ask for confirmation instead of blocking
    const total =
      typeof window.__rl_totalRecipients === "number" &&
      window.__rl_totalRecipients > 0
        ? window.__rl_totalRecipients
        : (function () {
            try {
              const poolCount = qsa(
                "#pool .rcard[data-user-id]"
              ).length;
              const weekCount = qsa(
                ".dropzone .rcard[data-user-id]"
              ).length;
              return poolCount + weekCount;
            } catch (_) {
              return 0;
            }
          })();
    const target = total > 0 ? Math.ceil(total / 4) : 0;
    if (target > 0 && ids.length !== target) {
      const ok = await confirmAction(
        `This week has ${ids.length}/${target} recipients. Do you want to proceed?`,
        "Not exactly target per week"
      );
      if (!ok) return;
    }
    try {
      await apiSavePlan({ [weekKey]: ids }, currentMonth());
      toast(`Saved ${weekKey} (${ids.length})`, "success");
      // Lock saved recipients so they do not return to pool unless cancelled
      ids.forEach((id) => {
        const poolCard = qs(`#pool .rcard[data-user-id="${id}"]`);
        if (poolCard) {
          poolCard.dataset.locked = "1";
          poolCard.style.display = "none";
        }
        lockedIds.add(Number(id));
      });
      // Mark this week as locked in the local locks map so buttons update
      try {
        window.__rl_locks = window.__rl_locks || {};
        window.__rl_locks[weekKey] = true;
      } catch (_) {}
      applyWeekFocusAndButtons();
      
    } catch (e) {
      toast(`Failed to save ${weekKey}: ${e.message || e}`, "danger");
    }
  }

  function autoFill(dropId, count) {
    const dz = qs("#" + dropId);
    const pool = qs("#pool");
    if (!dz || !pool) return;
    // Determine dynamic target per week based on total recipients divided by 4
    const total =
      typeof window.__rl_totalRecipients === "number" &&
      window.__rl_totalRecipients > 0
        ? window.__rl_totalRecipients
        : (function () {
            try {
              const poolCount = qsa(
                "#pool .rcard[data-user-id]"
              ).length;
              const weekCount = qsa(
                ".dropzone .rcard[data-user-id]"
              ).length;
              return poolCount + weekCount;
            } catch (_) {
              return 0;
            }
          })();
    const target =
      typeof count === "number" && count > 0
        ? count
        : total > 0
        ? Math.ceil(total / 4)
        : 0;
    if (!target) {
      toast("No recipients available to auto-assign", "warning");
      return;
    }
    const currentInWeek = qsa(".rcard[data-user-id]", dz).length;
    const remaining = Math.max(0, target - currentInWeek);
    if (remaining <= 0) {
      toast(
        `Week already has ${currentInWeek}/${target} recipient(s)`,
        "info"
      );
      return;
    }
    // Visible candidates in pool
    const cards = qsa("#pool .rcard").filter(
      (el) => el.style.display !== "none"
    );
    if (!cards.length) {
      toast("No recipients available in pool", "warning");
      return;
    }
    // Partition by tags
    const byId = window.__rl_usersById || new Map();
    const infant = [],
      elderly = [],
      medicine = [],
      others = [],
      any = [];
    for (const c of cards) {
      const id = parseInt(c.getAttribute("data-user-id") || "0", 10);
      if (!Number.isFinite(id) || id <= 0) continue;
      if (dz.querySelector(`.rcard[data-user-id="${id}"]`)) continue; // skip already assigned in target week
      const user = byId.get(id);
      if (!user) continue;
      const f = recipientFlags(user);
      if (f.hasInfant) infant.push({ id, card: c, user });
      else if (f.hasElderly) elderly.push({ id, card: c, user });
      else if (f.hasMedicine) medicine.push({ id, card: c, user });
      else others.push({ id, card: c, user });
      any.push({ id, card: c, user });
    }
    // Simple shuffle helper
    function shuffle(arr) {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
    }
    shuffle(infant);
    shuffle(elderly);
    shuffle(medicine);
    shuffle(others);
    shuffle(any);
    const takeFrom = (arr, n, taken) => {
      for (let i = 0; i < arr.length && taken.length < n; i++) {
        taken.push(arr[i]);
      }
    };
    const selected = [];
    // Priority picks: 2 infants, 2 elderly, 1 medicine
    takeFrom(infant, 2, selected);
    takeFrom(elderly, 2, selected);
    takeFrom(medicine, 1, selected);
    // Fill remaining with others (not in the three tags)
    const need = Math.max(0, remaining - selected.length);
    const poolOthers = others.filter(
      (o) => !selected.some((s) => s.id === o.id)
    );
    for (let i = 0; i < poolOthers.length && selected.length < remaining; i++)
      selected.push(poolOthers[i]);
    // If still short, fill from any remaining candidates
    if (selected.length < remaining) {
      const used = new Set(selected.map((s) => s.id));
      for (const cand of any) {
        if (used.has(cand.id)) continue;
        selected.push(cand);
        if (selected.length >= remaining) break;
      }
    }
    // Commit selection to target week
    let added = 0;
    for (const it of selected) {
      const { id, card, user } = it;
      if (!dz.querySelector(`.rcard[data-user-id="${id}"]`)) {
        dz.appendChild(createCard(user));
        card.style.display = "none";
        added++;
      }
    }
    updateCounts();
    toast(
      added
        ? `Auto added ${added} recipient(s)`
        : "No recipients were added to this week",
      added ? "success" : "warning"
    );
  }

  async function fetchRecipients() {
    const res = await fetch(
      `${API_BASE_URL}/users/index.php?action=list&role=recipient&status=approved&t=${Date.now()}`,
      {
        method: "GET",
        headers: { Accept: "application/json" },
        credentials: "include",
        cache: "no-store",
      }
    );
    const j = await res.json();
    if (!res.ok || !j?.success)
      throw new Error(j?.error || `HTTP ${res.status}`);
    return Array.isArray(j?.data?.items) ? j.data.items : [];
  }

  async function init() {
    try {
      // Removed outdated local-only save notice (server persistence enabled)

      // setup drag handlers
      setupDragSources(document);
      ["w1", "w2", "w3", "w4"].forEach((id) => {
        const el = qs("#" + id);
        if (el) setupDropzone(el);
      });
      setupPoolDnD();

      // Set dynamic week-of-year labels initially (Sunday-only basis)
      updateWeekLabels();

      // load recipients
      const items = await fetchRecipients();
      window.__rl_usersById = new Map();
      const pool = qs("#pool");
      pool.innerHTML = "";
      // Exclude Foodbank (On-site) from the pool permanently
      const filtered = items.filter((u) => {
        const org = String(u.organization_name || u.name || "")
          .trim()
          .toLowerCase();
        const tags = String(u.tags || "").toLowerCase();
        const isHidden = org === "foodbank (on-site)" || /(^|[^a-z])hidden([^a-z]|$)/.test(tags);
        return !isHidden;
      });
      // Remember total eligible recipients for dynamic per-week targets
      try {
        window.__rl_totalRecipients = filtered.length;
      } catch (_) {}
      // Render cards
      filtered.forEach((u) => {
        window.__rl_usersById.set(Number(u.user_id), u);
        const card = createCard(u);
        pool.appendChild(card);
      });

      // Load plan from server (fallback to local if needed)
      await restoreFromServer();

      // wire search, clear and auto buttons
      qs("#poolSearch")?.addEventListener("input", (e) =>
        filterPool(e.target.value)
      );
      qs("#clearW1")?.addEventListener("click", () => {
        clearWeek("w1");
        console.info("Cleared week 1");
      });
      qs("#clearW2")?.addEventListener("click", () => {
        clearWeek("w2");
        console.info("Cleared week 2");
      });
      qs("#clearW3")?.addEventListener("click", () => {
        clearWeek("w3");
        console.info("Cleared week 3");
      });
      qs("#clearW4")?.addEventListener("click", () => {
        clearWeek("w4");
        console.info("Cleared week 4");
      });
      qs("#autoW1")?.addEventListener("click", () => autoFill("w1"));
      qs("#autoW2")?.addEventListener("click", () => autoFill("w2"));
      qs("#autoW3")?.addEventListener("click", () => autoFill("w3"));
      qs("#autoW4")?.addEventListener("click", () => autoFill("w4"));
      const reloadBtn = qs('#reloadBtn');
      if (reloadBtn) {
        try {
          reloadBtn.setAttribute('title', 'Clear unsaved recipients');
          reloadBtn.setAttribute('data-bs-original-title', 'Clear unsaved recipients');
        } catch (_) {}
        reloadBtn.addEventListener('click', async () => {
          await clearUnsavedAcrossWeeks();
        });
      }
      qs("#saveW1")?.addEventListener("click", () => saveWeekKey("W1", "w1"));
      qs("#saveW2")?.addEventListener("click", () => saveWeekKey("W2", "w2"));
      qs("#saveW3")?.addEventListener("click", () => saveWeekKey("W3", "w3"));
      qs("#saveW4")?.addEventListener("click", () => saveWeekKey("W4", "w4"));
      // auto all: fill every week up to its dynamic target (no save here)
      qs("#autoAllBtn")?.addEventListener("click", async () => {
        try {
          toast("Auto-filling all weeks…", "info");
          const dzIds = ["w1", "w2", "w3", "w4"];
          // Let autoFill compute per-week targets from the total recipients
          dzIds.forEach((id) => {
            autoFill(id);
          });
          updateCounts();
          toast("Auto-filled all weeks. Click Save All to persist.", "success");
        } catch (e) {
          toast("Auto all failed", "danger");
        }
      });
      // save all
      qs("#saveAllBtn")?.addEventListener("click", async () => {
        const raw = {
          W1: collectWeekIds("w1"),
          W2: collectWeekIds("w2"),
          W3: collectWeekIds("w3"),
          W4: collectWeekIds("w4"),
        };
        // Disallow saving if any column is empty
        const emptyKeys = Object.entries(raw)
          .filter(([k, ids]) => Array.isArray(ids) && ids.length === 0)
          .map(([k]) => k);
        if (emptyKeys.length) {
          toast(
            `Cannot save: the following week(s) are empty: ${emptyKeys.join(
              ", "
            )}`,
            "warning"
          );
          return;
        }
        const weeks = {};
        const truncated = [];
        Object.entries(raw).forEach(([k, ids]) => {
          if (!Array.isArray(ids)) {
            weeks[k] = [];
            return;
          }
          if (ids.length > 10) {
            weeks[k] = ids.slice(0, 10);
            truncated.push(`${k} (kept 10 of ${ids.length})`);
          } else {
            // Accept fewer than 10; save exactly what is in the week (including empty to clear)
            weeks[k] = ids;
          }
        });
        try {
          await apiSavePlan(weeks, currentMonth());
          // Lock all saved recipients across all weeks
          const allKeys = ["W1", "W2", "W3", "W4"];
          allKeys.forEach((k) => {
            (weeks[k] || []).forEach((id) => {
              const poolCard = qs(`#pool .rcard[data-user-id="${id}"]`);
              if (poolCard) {
                poolCard.dataset.locked = "1";
                poolCard.style.display = "none";
              }
              lockedIds.add(Number(id));
            });
          });
          if (truncated.length) {
            toast(
              `Saved all weeks. Truncated: ${truncated.join(", ")}`,
              "warning"
            );
          } else {
            toast("All weeks saved", "success");
          }
          await restoreFromServer();
          applyWeekFocusAndButtons();
          try {
            const allWeeksHaveEntries = Object.values(weeks).every(
              (ids) => Array.isArray(ids) && ids.length > 0
            );
            const pool = document.getElementById('pool');
            const noPoolVisible = (() => {
              if (!pool) return false;
              const cards = Array.from(pool.querySelectorAll('.rcard'));
              return cards.every((el) => el.style.display === 'none');
            })();
            if (allWeeksHaveEntries && noPoolVisible) {
              setTimeout(() => { window.location.href = 'DistributeItems.html'; }, 600);
            }
          } catch (_) {}
        } catch (e) {
          toast("Failed to save all weeks", "danger");
        }
      });

      // Expose a placeholder unlock function for future allocation cancellation
      window.__rl_unlockRecipient = function (id) {
        try {
          id = Number(id) || 0;
          if (!id) return;
          lockedIds.delete(id);
          const poolCard = qs(`#pool .rcard[data-user-id="${id}"]`);
          if (poolCard) {
            delete poolCard.dataset.locked;
          }
        } catch (_) {}
      };

      // Enable Bootstrap tooltips for icon-only buttons (robust: dispose/recreate and auto-hide on interactions)
      try {
        // Dispose existing tooltip instances if any
        if (Array.isArray(window.__rl_tooltips)) {
          window.__rl_tooltips.forEach((inst) => {
            try {
              inst.dispose();
            } catch (_) {}
          });
        }
        const ttEls = qsa('[data-bs-toggle="tooltip"]');
        const instances = [];
        ttEls.forEach((el) => {
          try {
            const cls =
              (el.closest && el.closest("table"))
                ? "table-tooltip"
                : (el.getAttribute && el.getAttribute("data-bs-custom-class")) || "custom-tooltip";
            instances.push(
              new bootstrap.Tooltip(el, {
                customClass: cls,
                container: "body",
                boundary: "viewport",
                fallbackPlacements: ["right", "left", "bottom", "top"],
                trigger: "hover focus",
                delay: { show: 150, hide: 50 },
              })
            );
          } catch (_) {}
        });
        window.__rl_tooltips = instances;

        // Helper to hide all tooltips
        function hideAllTooltips() {
          try {
            (window.__rl_tooltips || []).forEach((inst) => {
              try {
                inst.hide();
              } catch (_) {}
            });
          } catch (_) {}
        }
        // Bind global listeners once to avoid stuck tooltips
        if (!window.__rl_tt_bindings) {
          window.__rl_tt_bindings = true;
          // Hide on any document click (capture to run early)
          document.addEventListener("click", hideAllTooltips, true);
          // Hide on scrolls within the page
          document.addEventListener("scroll", hideAllTooltips, true);
          // Hide when any Bootstrap modal is shown/hidden
          document.addEventListener("shown.bs.modal", hideAllTooltips);
          document.addEventListener("hide.bs.modal", hideAllTooltips);
          // Cleanup on unload
          window.addEventListener("beforeunload", () => {
            try {
              (window.__rl_tooltips || []).forEach((inst) => {
                try {
                  inst.dispose();
                } catch (_) {}
              });
            } catch (_) {}
            window.__rl_tooltips = [];
          });
        }
      } catch (_) {
        /* bootstrap may not be defined yet */
      }
      // Ensure labels are set even if settings endpoint had issues
      updateWeekLabels();
    } catch (err) {
      console.error("Recipients List init failed:", err);
      toast(err.message || "Failed to load recipients", "danger");
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

/* === Label override: show Month name dd, yyyy for week starts === */
(function () {
  try {
    if (typeof formatLongDate !== "function") {
      function formatLongDate(d) {
        try {
          return d.toLocaleDateString("en-US", {
            year: "numeric",
            month: "long",
            day: "2-digit",
          });
        } catch (_) {
          const months = [
            "January",
            "February",
            "March",
            "April",
            "May",
            "June",
            "July",
            "August",
            "September",
            "October",
            "November",
            "December",
          ];
          const mm = months[d.getMonth()] || "";
          const dd = String(d.getDate()).padStart(2, "0");
          const yyyy = d.getFullYear();
          return `${mm} ${dd}, ${yyyy}`;
        }
      }
      // expose globally in this scope
      try {
        window.formatLongDate = formatLongDate;
      } catch (_) {}
    }

    // Keep original for fallback, then override
    var __oldUpdateWeekLabels =
      typeof updateWeekLabels === "function"
        ? updateWeekLabels
        : function () {};
    updateWeekLabels = function () {
      try {
        const now = new Date();
        const y = now.getFullYear(),
          m = now.getMonth();
        const starts = [
          new Date(y, m, 1),
          new Date(y, m, 8),
          new Date(y, m, 15),
          new Date(y, m, 22),
        ];

        // Labels for W1..W4
        const ids = ["w1Label", "w2Label", "w3Label", "w4Label"];
        for (let i = 0; i < ids.length; i++) {
          const el = document.getElementById(ids[i]);
          if (!el) continue;
          const dt = starts[i] || new Date();
          el.textContent = `Week ${i + 1} (${formatLongDate(dt)})`;
        }

        // Aria labels
        const dzIds = ["w1", "w2", "w3", "w4"];
        for (let i = 0; i < dzIds.length; i++) {
          const dz = document.getElementById(dzIds[i]);
          if (!dz) continue;
          const dt = starts[i] || new Date();
          dz.setAttribute(
            "aria-label",
            `Week ${i + 1} assignments (${formatLongDate(dt)})`
          );
        }

        // Button titles
        const btns = [
          ["saveW1", 0],
          ["saveW2", 1],
          ["saveW3", 2],
          ["saveW4", 3],
        ];
        for (const [id, idx] of btns) {
          const b = document.getElementById(id);
          if (!b) continue;
          const dt = starts[idx] || new Date();
          const title = `Save Week ${idx + 1} (${formatLongDate(dt)})`;
          b.setAttribute("title", title);
          b.setAttribute("data-bs-original-title", title);
        }

        // Preserve existing focus/button state logic
        try {
          applyWeekFocusAndButtons();
        } catch (_) {}
        try { updateCounts(); } catch (_) {}
      } catch (e) {
        try {
          __oldUpdateWeekLabels();
        } catch (_) {}
      }
    };
  } catch (_) {}
})();
