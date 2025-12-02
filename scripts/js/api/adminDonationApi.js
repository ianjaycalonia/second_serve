// API layer for Admin Donations (old-school namespace export)
// Attaches functions to window.AdminDonationApi

(function(){
  'use strict';

  const API_BASE_URL = (typeof window !== 'undefined' && typeof window.API_BASE_URL === 'string' && window.API_BASE_URL)
    ? window.API_BASE_URL
    : '/php/api';

  const AUTH_CSRF_ENDPOINT = `${API_BASE_URL}/users/auth.php?action=csrf`;

  function getCsrfToken(){
    let token = '';
    try {
      token = sessionStorage.getItem('csrf_token') || '';
    } catch (_) {
      token = '';
    }
    if (!token && typeof document !== 'undefined' && document.cookie){
      try {
        const cookies = document.cookie.split(';').map(s => s.trim());
        for (const c of cookies){
          if (c.startsWith('XSRF-TOKEN=')) {
            token = decodeURIComponent(c.substring('XSRF-TOKEN='.length));
            break;
          }
        }
      } catch (_) {
        token = '';
      }
    }
    return token;
  }

  async function ensureCsrfToken(){
    let token = getCsrfToken();
    if (token) return token;
    try {
      const res = await fetch(AUTH_CSRF_ENDPOINT, { credentials: 'include' });
      const json = await res.json().catch(() => null);
      token = json?.csrf_token || json?.data?.csrf_token || '';
      if (token) {
        try { sessionStorage.setItem('csrf_token', token); } catch (_) {}
        window.CSRF_TOKEN = token;
      }
    } catch (_) {
      token = '';
    }
    return token;
  }

  async function fetchAdminList() {
    const res = await fetch(`${API_BASE_URL}/donations/index.php/list?t=${Date.now()}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      cache: 'no-store'
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const json = await res.json();
    return json?.data?.items || [];
  }

  async function fetchDonationDetail(id) {
    const res = await fetch(`${API_BASE_URL}/donations/index.php/${encodeURIComponent(id)}`, { credentials: 'include' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const json = await res.json().catch(() => ({}));
    return json?.data || null;
  }

  async function getUserPref(key) {
    try {
      const res = await fetch(`${API_BASE_URL}/users/preferences.php?action=get&key=${encodeURIComponent(key)}`, { credentials: 'include' });
      const j = await res.json().catch(() => null);
      return (j && j.success && j.data) ? (j.data.value || null) : null;
    } catch (_) { return null; }
  }

  async function setUserPref(key, value) {
    try {
      const res = await fetch(`${API_BASE_URL}/users/preferences.php?action=update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ key, value })
      });
      return res.ok;
    } catch (_) { return false; }
  }

  async function listApprovedDonors() {
    const url = `${API_BASE_URL}/users/index.php?action=list&role=donor&status=approved&t=${Date.now()}`;
    const res = await fetch(url, {
      method: 'GET',
      credentials: 'include',
      headers: { 'Accept': 'application/json' },
      cache: 'no-store'
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const json = await res.json();
    return json?.data?.items || [];
  }

  async function deleteDonation(id) {
    const params = new URLSearchParams();
    params.append('_method', 'DELETE');
    const res = await fetch(`${API_BASE_URL}/donations/index.php/${encodeURIComponent(id)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      credentials: 'include',
      body: params.toString()
    });
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try { const j = await res.json(); if (j && j.error) msg = j.error; } catch (_e) { try { msg = await res.text(); } catch (__e) {} }
      throw new Error(msg);
    }
    return true;
  }

  async function deleteDonationBatch(batchId) {
    const params = new URLSearchParams();
    params.append('_method', 'DELETE');
    const res = await fetch(`${API_BASE_URL}/donations/index.php/batch/${encodeURIComponent(batchId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      credentials: 'include',
      body: params.toString()
    });
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try { const j = await res.json(); if (j && j.error) msg = j.error; } catch (_e) { try { msg = await res.text(); } catch (__e) {} }
      throw new Error(msg);
    }
    return true;
  }

  async function updateDonationStatus(id, status) {
    const params = new URLSearchParams();
    params.append('_method', 'PUT');
    params.append('status', status ?? '');
    const res = await fetch(`${API_BASE_URL}/donations/index.php/${encodeURIComponent(id)}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      credentials: 'include',
      body: params.toString()
    });
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try { const j = await res.json(); if (j && j.error) msg = j.error; } catch (_e) { try { msg = await res.text(); } catch (__e) {} }
      throw new Error(msg);
    }
    return true;
  }

  async function updateDonationBatchStatus(batchId, status) {
    const params = new URLSearchParams();
    params.append('_method', 'PUT');
    params.append('status', status ?? '');
    const res = await fetch(`${API_BASE_URL}/donations/index.php/batch/${encodeURIComponent(batchId)}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      credentials: 'include',
      body: params.toString()
    });
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try { const j = await res.json(); if (j && j.error) msg = j.error; } catch (_e) { try { msg = await res.text(); } catch (__e) {} }
      throw new Error(msg);
    }
    return true;
  }

  async function submitFoodSafetyCheck(formData) {
    const token = await ensureCsrfToken();
    if (token && typeof formData?.has === 'function' && !formData.has('csrf_token')) {
      formData.append('csrf_token', token);
    }
    const headers = {};
    if (token) {
      headers['X-CSRF-Token'] = token;
    }
    const res = await fetch(`${API_BASE_URL}/food_safety_checks/index.php`, {
      method: 'POST',
      body: formData,
      credentials: 'include',
      headers
    });
    let json = null;
    try { json = await res.json(); } catch (_) { json = null; }
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try { if (json && json.error) msg = json.error; } catch (_) {}
      throw new Error(msg);
    }
    return json;
  }

  // expose
  window.AdminDonationApi = {
    API_BASE_URL,
    fetchAdminList,
    fetchDonationDetail,
    getUserPref,
    setUserPref,
    listApprovedDonors,
    deleteDonation,
    deleteDonationBatch,
    updateDonationStatus,
    updateDonationBatchStatus,
    submitFoodSafetyCheck,
  };
})();
