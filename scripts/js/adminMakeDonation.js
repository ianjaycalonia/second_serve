(function(){
  'use strict';

  // API base URL (re-use convention from other pages)
  const API_BASE_URL = (typeof window.API_BASE_URL === 'string' && window.API_BASE_URL)
    ? window.API_BASE_URL
    : '/Capstone%20Project/php/api';

  function $(sel){ return document.querySelector(sel); }

  function formatDateYYYYMMDD(d){
    const y = d.getFullYear();
    const m = String(d.getMonth()+1).padStart(2,'0');
    const day = String(d.getDate()).padStart(2,'0');
    return `${y}-${m}-${day}`;
  }

  function showFeedback(msg, type='secondary'){
    const box = $('#amdFeedback');
    if (!box) return;
    box.innerHTML = `<div class="alert alert-${type} py-2 mb-0">${msg}</div>`;
  }

  async function fetchItemNames(q){
    try{
      const url = `${API_BASE_URL}/donations/index.php/items?q=${encodeURIComponent(q||'')}&limit=20&t=${Date.now()}`;
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      return Array.isArray(j?.items) ? j.items : [];
    } catch(err){
      console.warn('Items fetch failed:', err);
      return [];
    }
  }

  async function populateDatalist(q){
    const dl = $('#amdItemsDatalist');
    if (!dl) return;
    const items = await fetchItemNames(q);
    dl.innerHTML = items.map(n => `<option value="${String(n).replace(/"/g,'&quot;')}"></option>`).join('');
  }

  async function submitDonation(){
    const cat = $('#amdCategory')?.value.trim();
    const name = $('#amdItemName')?.value.trim();
    const qty = parseInt($('#amdQuantity')?.value || '0', 10) || 0;
    if (!cat || !name || qty < 1){
      showFeedback('Please fill Category, Item Name, and a Quantity of at least 1.', 'danger');
      return;
    }
    // Default expiry: +30 days
    const d = new Date();
    d.setDate(d.getDate() + 30);
    const expiry = formatDateYYYYMMDD(d);

    const payload = { type: cat, name, quantity: qty, expiry_date: expiry };

    try{
      $('#amdSubmitBtn').disabled = true;
      showFeedback('Submitting donation...', 'secondary');
      const res = await fetch(`${API_BASE_URL}/donations/index.php`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload)
      });
      const j = await res.json().catch(()=>({success:false,error:'Invalid JSON'}));
      if (!res.ok || !j?.success){
        const msg = j?.error || `Request failed (HTTP ${res.status})`;
        throw new Error(msg);
      }
      showFeedback('Donation created successfully.', 'success');
      // Reset form
      $('#adminMakeDonationForm')?.reset();
      // Close in 1.2s
      setTimeout(()=>{
        const el = document.getElementById('adminMakeDonationModal');
        if (window.bootstrap && el){
          bootstrap.Modal.getOrCreateInstance(el).hide();
        }
        showFeedback('');
      }, 1200);
    } catch(err){
      console.error('Create donation failed:', err);
      showFeedback(err.message || 'Failed to create donation', 'danger');
    } finally {
      $('#amdSubmitBtn').disabled = false;
    }
  }

  function init(){
    const nameInput = $('#amdItemName');
    if (nameInput){
      nameInput.addEventListener('focus', ()=> populateDatalist(nameInput.value));
      nameInput.addEventListener('input', ()=> populateDatalist(nameInput.value));
    }
    const submitBtn = $('#amdSubmitBtn');
    if (submitBtn){ submitBtn.addEventListener('click', submitDonation); }
  }

  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
