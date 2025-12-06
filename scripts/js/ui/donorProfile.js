(function () {
  const byId = (id) => document.getElementById(id);
  const setVal = (id, v) => {
    const el = byId(id);
    if (el && v !== undefined && v !== null) el.value = String(v);
  };
  const getVal = (id) => {
    const el = byId(id);
    return el ? el.value.trim() : "";
  };

  function showToast(message, variant) {
    try {
      const container = byId("toastContainer");
      if (!container) return;
      const type = (variant || "info").toLowerCase();
      const bgClass =
        type === "success"
          ? "text-bg-success"
          : type === "error" || type === "danger"
          ? "text-bg-danger"
          : type === "warning"
          ? "text-bg-warning"
          : "text-bg-info";
      const toastEl = document.createElement("div");
      toastEl.className = `toast align-items-center ${bgClass}`;
      toastEl.setAttribute("role", "alert");
      toastEl.setAttribute("aria-live", "assertive");
      toastEl.setAttribute("aria-atomic", "true");
      toastEl.innerHTML = `
        <div class="d-flex">
          <div class="toast-body">${String(message || "")}</div>
          <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button>
        </div>`;
      container.appendChild(toastEl);
      const t = bootstrap.Toast.getOrCreateInstance(toastEl, {
        delay: 3000,
      });
      t.show();
    } catch (_) {
      /* ignore */
    }
  }

  function confirmAction({
    title,
    message,
    confirmLabel = "Confirm",
    confirmVariant = "btn-danger",
    onConfirm,
  }) {
    let modalEl = document.getElementById("donorDangerModal");
    if (!modalEl) {
      const wrapper = document.createElement("div");
      wrapper.innerHTML = `
        <div class="modal fade" id="donorDangerModal" tabindex="-1" aria-hidden="true">
          <div class="modal-dialog">
            <div class="modal-content">
              <div class="modal-header">
                <h5 class="modal-title" id="donorDangerTitle"></h5>
                <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
              </div>
              <div class="modal-body" id="donorDangerBody"></div>
              <div class="modal-footer">
                <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
                <button type="button" class="btn" id="donorDangerConfirm"></button>
              </div>
            </div>
          </div>
        </div>`;
      document.body.appendChild(wrapper.firstElementChild);
      modalEl = document.getElementById("donorDangerModal");
    }
    const titleEl = modalEl.querySelector("#donorDangerTitle");
    const bodyEl = modalEl.querySelector("#donorDangerBody");
    const confirmBtn = modalEl.querySelector("#donorDangerConfirm");
    if (titleEl) titleEl.textContent = title || "Confirm Action";
    if (bodyEl) bodyEl.textContent = message || "This action cannot be undone.";
    if (confirmBtn) {
      confirmBtn.className = `btn ${confirmVariant}`;
      confirmBtn.textContent = confirmLabel;
      confirmBtn.onclick = async () => {
        confirmBtn.disabled = true;
        confirmBtn.textContent = "Processing...";
        try {
          await onConfirm();
          const inst = bootstrap.Modal.getInstance(modalEl) || bootstrap.Modal.getOrCreateInstance(modalEl);
          inst.hide();
        } finally {
          confirmBtn.disabled = false;
          confirmBtn.textContent = confirmLabel;
        }
      };
    }
    const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
    modal.show();
  }

  async function loadProfile() {
    try {
      const res = await fetchJson(
        `${API_BASE_URL}/users/index.php?action=getProfile`,
        { method: "GET" }
      );
      const u = res && res.data && res.data.user ? res.data.user : null;
      if (!u) return;
      setVal("donorName", u.name);
      setVal(
        "donorPosition",
        u.position_designation || u.position || u.designation || u.title
      );
      setVal("donorEmail", u.email);
      setVal("donorPhone", u.contact_number);
      setVal("donorOrg", u.organization_name);
      setVal("donorAddress", u.address);
    } catch (_) {}
  }

  async function saveProfile() {
    const btn = byId("saveProfileBtn");
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Saving...";
    }
    try {
      const nameVal = getVal("donorName") || null;
      const payload = {
        name: nameVal,
        contact_person: nameVal,
        position_designation: getVal("donorPosition") || null,
        email: getVal("donorEmail") || null,
        contact_number: getVal("donorPhone") || null,
        organization_name: getVal("donorOrg") || null,
        address: getVal("donorAddress") || null,
      };
      await fetchJson(
        `${API_BASE_URL}/users/index.php?action=updateProfile`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      try {
        const s = sessionStorage.getItem("user");
        const u = s ? JSON.parse(s) : null;
        if (u) {
          if (payload.name) u.name = payload.name;
          if (payload.contact_person)
            u.contact_person = payload.contact_person;
          if (payload.position_designation)
            u.position_designation = payload.position_designation;
          if (payload.email) u.email = payload.email;
          if (payload.contact_number)
            u.contact_number = payload.contact_number;
          if (payload.organization_name)
            u.organization_name = payload.organization_name;
          if (payload.address) u.address = payload.address;
          sessionStorage.setItem("user", JSON.stringify(u));
        }
      } catch (_) {}
      showToast("Profile updated", "success");
    } catch (err) {
      showToast(
        (err && err.message) || "Failed to update profile",
        "danger"
      );
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = "Save Changes";
      }
    }
  }

  function bindPasswordToggles() {
    const cb = byId("showPassword");
    const fields = ["currentPassword", "newPassword", "confirmPassword"]
      .map(byId)
      .filter(Boolean);
    if (cb && !cb.dataset.bound) {
      cb.dataset.bound = "1";
      cb.addEventListener("change", function () {
        fields.forEach((f) => {
          if (f) f.type = cb.checked ? "text" : "password";
        });
      });
    }
  }

  async function updatePassword() {
    const btn = byId("updatePasswordBtn");
    const current = getVal("currentPassword");
    const next = getVal("newPassword");
    const confirm = getVal("confirmPassword");
    if (!current || !next || !confirm) {
      showToast("All password fields are required", "warning");
      return;
    }
    if (next.length < 8) {
      showToast("Password must be at least 8 characters long", "warning");
      return;
    }
    if (next !== confirm) {
      showToast("Passwords do not match", "warning");
      return;
    }
    if (current === next) {
      showToast("New password must be different from current", "warning");
      return;
    }
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Updating...";
    }
    try {
      await fetchJson(
        `${API_BASE_URL}/users/auth.php?action=changePassword`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            currentPassword: current,
            newPassword: next,
            confirmPassword: confirm,
          }),
        }
      );
      ["currentPassword", "newPassword", "confirmPassword"].forEach(
        (id) => {
          const el = byId(id);
          if (el) el.value = "";
        }
      );
      const show = byId("showPassword");
      if (show) {
        show.checked = false;
      }
      bindPasswordToggles();
      showToast("Password updated", "success");
    } catch (err) {
      showToast(
        (err && err.message) || "Failed to update password",
        "danger"
      );
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = "Update Password";
      }
    }
  }

  async function loadActivity() {
    try {
      const res = await fetchJson(`${API_BASE_URL}/users/activity.php`, {
        method: "GET",
      });
      const data = res && res.data ? res.data : null;
      if (!data) return;
      const last = data.last_login ? new Date(data.last_login) : null;
      const lastStr =
        last && !isNaN(last)
          ? last.toLocaleString()
          : data.last_login || "—";
      const lastEl = byId("lastLogin");
      if (lastEl) lastEl.textContent = lastStr;
      const ipEl = byId("ipAddress");
      if (ipEl) ipEl.textContent = data.ip || "—";
      const listEl = byId("activityList");
      const items = [];
      const actions = Array.isArray(data.recent_actions)
        ? data.recent_actions
        : [];
      actions.slice(0, 5).forEach((a) => {
        const when = a.created_at ? new Date(a.created_at) : null;
        const whenStr =
          when && !isNaN(when)
            ? when.toLocaleString()
            : a.created_at || "";
        const body = (a.body || "").toString().trim().slice(0, 120);
        const isDonation =
          (a && a.type === "donation") ||
          body.toLowerCase().startsWith("created donation:");
        const prefix = isDonation ? "" : "Sent message: ";
        items.push(
          `<li>${prefix}${body} <span class="text-muted">(${whenStr})</span></li>`
        );
      });
      if (items.length < 5) {
        const msgs = Array.isArray(data.recent_messages)
          ? data.recent_messages
          : [];
        msgs.slice(0, 5 - items.length).forEach((m) => {
          const when = m.created_at ? new Date(m.created_at) : null;
          const whenStr =
            when && !isNaN(when)
              ? when.toLocaleString()
              : m.created_at || "";
          const body = (m.body || "").toString().slice(0, 80);
          items.push(
            `<li>Message: ${body} <span class=\"text-muted\">(${whenStr})</span></li>`
          );
        });
      }
      listEl.innerHTML = items.length
        ? items.slice(0, 5).join("")
        : '<li class="text-muted">No recent activity</li>';
      const meta = byId("activityMeta");
      if (meta)
        meta.textContent = `Unread messages: ${Number(
          data.unread_messages || 0
        )}`;
    } catch (_) {}
  }

  async function performSelfAction(action) {
    const res = await fetchJson(
      `${API_BASE_URL}/users/index.php?action=${action}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      }
    );
    if (!res?.success) {
      throw new Error(res?.error || "Request failed");
    }
    try {
      sessionStorage.removeItem("user");
    } catch (_) {}
    try {
      localStorage.removeItem("user");
    } catch (_) {}
    showToast(res.message || "Action completed", "success");
    setTimeout(() => {
      window.location.href = "index.html";
    }, 800);
  }

  document.addEventListener("DOMContentLoaded", function () {
    loadProfile();
    loadActivity();
    const saveBtn = byId("saveProfileBtn");
    if (saveBtn && !saveBtn.dataset.bound) {
      saveBtn.dataset.bound = "1";
      saveBtn.addEventListener("click", function (e) {
        e.preventDefault();
        saveProfile();
      });
    }
    bindPasswordToggles();
    const upBtn = byId("updatePasswordBtn");
    if (upBtn && !upBtn.dataset.bound) {
      upBtn.dataset.bound = "1";
      upBtn.addEventListener("click", function (e) {
        e.preventDefault();
        updatePassword();
      });
    }

    const saveSecondary = byId("saveProfileBtnSecondary");
    if (saveSecondary && !saveSecondary.dataset.bound) {
      saveSecondary.dataset.bound = "1";
      saveSecondary.addEventListener("click", function (e) {
        e.preventDefault();
        saveProfile();
      });
    }

    const resetBtn = byId("resetProfileBtn");
    if (resetBtn && !resetBtn.dataset.bound) {
      resetBtn.dataset.bound = "1";
      resetBtn.addEventListener("click", function (e) {
        e.preventDefault();
        loadProfile();
      });
    }
  });
})();
