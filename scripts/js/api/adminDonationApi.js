// API layer for Admin Donations (old-school namespace export)
// Attaches functions to window.AdminDonationApi

(function(){
  'use strict';

  const API_BASE_URL = (typeof window !== 'undefined' && typeof window.API_BASE_URL === 'string' && window.API_BASE_URL)
    ? window.API_BASE_URL
    : '/Capstone%20Project/php/api';

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
    const res = await fetch(`${API_BASE_URL}/donations/index.php/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      credentials: 'include'
    });
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try { const j = await res.json(); if (j && j.error) msg = j.error; } catch (_e) { try { msg = await res.text(); } catch (__e) {} }
      throw new Error(msg);
    }
    return true;
  }

  async function deleteDonationBatch(batchId) {
    const res = await fetch(`${API_BASE_URL}/donations/index.php/batch/${encodeURIComponent(batchId)}`, {
      method: 'DELETE',
      credentials: 'include'
    });
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try { const j = await res.json(); if (j && j.error) msg = j.error; } catch (_e) { try { msg = await res.text(); } catch (__e) {} }
      throw new Error(msg);
    }
    return true;
  }

  async function updateDonationStatus(id, status) {
    const res = await fetch(`${API_BASE_URL}/donations/index.php/${encodeURIComponent(id)}/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ status })
    });
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try { const j = await res.json(); if (j && j.error) msg = j.error; } catch (_e) { try { msg = await res.text(); } catch (__e) {} }
      throw new Error(msg);
    }
    return true;
  }

  async function updateDonationBatchStatus(batchId, status) {
    const res = await fetch(`${API_BASE_URL}/donations/index.php/batch/${encodeURIComponent(batchId)}/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ status })
    });
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try { const j = await res.json(); if (j && j.error) msg = j.error; } catch (_e) { try { msg = await res.text(); } catch (__e) {} }
      throw new Error(msg);
    }
    return true;
  }

  async function submitFoodSafetyCheck(formData) {
    const res = await fetch(`${API_BASE_URL}/food_safety_checks/index.php`, {
      method: 'POST',
      body: formData,
      credentials: 'include'
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
