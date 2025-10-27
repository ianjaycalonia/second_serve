(function(){
  'use strict';

  const CONFIGS = [
    { key: 'require_ack_checkbox', id: 'cfgMsgAckCheckbox', type: 'checkbox' },
    { key: 'inventory_soon_expire_lead_days', id: 'cfgSoonExpireLead', type: 'int', min: 0 },
    { key: 'allocation_far_recipient_weight', id: 'cfgFarRecipientWeight', type: 'float', min: 0 },
    { key: 'distribution_distributable_percent', id: 'cfgDistributablePercent', type: 'percent' },
    { key: 'recipient_cancellation_hours', id: 'cfgCancellationHours', type: 'int', min: 0 }
  ];

  const state = {
    original: {}
  };

  const CONFIG_KEYS = CONFIGS.map(cfg => cfg.key);

  function byId(id){
    return document.getElementById(id);
  }

  function toast(message, type){
    try {
      if (typeof window.showToast === 'function') {
        window.showToast(message, type);
        return;
      }
    } catch(_){ }
    try { alert(message); } catch(_){ }
  }

  function setBusy(btn, isBusy, busyLabel){
    if (!btn) return;
    if (isBusy) {
      if (!btn.dataset.origLabel) btn.dataset.origLabel = btn.textContent;
      btn.disabled = true;
      if (busyLabel) btn.textContent = busyLabel;
    } else {
      btn.disabled = false;
      if (btn.dataset.origLabel) btn.textContent = btn.dataset.origLabel;
    }
  }

  function toggleFormInputs(disabled){
    const form = document.querySelector('#configurations-tab-pane form');
    if (!form) return;
    const elements = Array.from(form.querySelectorAll('input, select'));
    elements.forEach(el => {
      if (el.id === 'configSaveBtn' || el.id === 'configDiscardBtn') return;
      el.disabled = disabled;
    });
  }

  function applyValue(config, value){
    const el = byId(config.id);
    if (!el) return;
    const val = (value ?? '').toString();
    state.original[config.key] = val;
    if (config.type === 'checkbox') {
      const lc = val.toLowerCase();
      el.checked = lc === '1' || lc === 'true' || lc === 'yes' || lc === 'on';
    } else {
      el.value = val;
    }
  }

  function restoreOriginal(){
    CONFIGS.forEach(cfg => applyValue(cfg, state.original[cfg.key]));
  }

  function readValue(config){
    const el = byId(config.id);
    if (!el) return state.original[config.key] ?? '';
    switch (config.type) {
      case 'checkbox':
        return el.checked ? '1' : '0';
      case 'int': {
        const num = parseInt(el.value, 10);
        const safe = Number.isFinite(num) ? num : parseInt(state.original[config.key] ?? '0', 10) || 0;
        const min = typeof config.min === 'number' ? config.min : null;
        return String(min !== null ? Math.max(min, safe) : safe);
      }
      case 'float': {
        const parsed = parseFloat(el.value);
        let value = Number.isFinite(parsed) ? parsed : parseFloat(state.original[config.key] ?? '0');
        if (!Number.isFinite(value)) value = 0;
        if (typeof config.min === 'number' && value < config.min) value = config.min;
        return value.toString();
      }
      case 'percent': {
        const parsed = parseInt(el.value, 10);
        let value = Number.isFinite(parsed) ? parsed : parseInt(state.original[config.key] ?? '0', 10) || 0;
        value = Math.max(0, Math.min(100, value));
        if (Number(el.value) !== value){
          el.value = String(value);
        }
        return String(value);
      }
      default:
        return (el.value ?? '').toString();
    }
  }

  async function loadSettings(){
    const saveBtn = byId('configSaveBtn');
    const discardBtn = byId('configDiscardBtn');
    setBusy(saveBtn, true, 'Loading...');
    setBusy(discardBtn, true, 'Loading...');
    toggleFormInputs(true);
    try {
      const url = `${API_BASE_URL}/system/settings.php?action=all&keys=${encodeURIComponent(CONFIG_KEYS.join(','))}`;
      const res = await fetchJson(url);
      if (!res?.success){
        throw new Error(res?.error || 'Unable to load configurations');
      }
      const data = res.data || {};
      CONFIGS.forEach(cfg => {
        const value = data.hasOwnProperty(cfg.key) ? data[cfg.key] : '';
        applyValue(cfg, value);
      });
    } catch (err){
      console.error('[Settings] load failed', err, err?.body);
      const msg = err?.message || 'Unable to load configurations. Please try again.';
      toast(msg, 'danger');
    } finally {
      setBusy(saveBtn, false);
      setBusy(discardBtn, false);
      toggleFormInputs(false);
    }
  }

  async function saveSettings(){
    const saveBtn = byId('configSaveBtn');
    const discardBtn = byId('configDiscardBtn');
    setBusy(saveBtn, true, 'Saving...');
    setBusy(discardBtn, true, 'Saving...');
    toggleFormInputs(true);
    try {
      const payload = { settings: {} };
      CONFIGS.forEach(cfg => {
        payload.settings[cfg.key] = readValue(cfg);
      });
      const res = await fetchJson(`${API_BASE_URL}/system/settings.php?action=bulk_update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res?.success){
        throw new Error(res?.error || 'Unable to save configurations.');
      }
      Object.keys(payload.settings).forEach(key => {
        state.original[key] = payload.settings[key];
      });
      toast('Configurations saved successfully.', 'success');
    } catch (err){
      console.error('[Settings] save failed', err, err?.body);
      toast(err?.message || 'Unable to save configurations.', 'danger');
    } finally {
      setBusy(saveBtn, false);
      setBusy(discardBtn, false);
      toggleFormInputs(false);
      restoreOriginal();
    }
  }

  document.addEventListener('DOMContentLoaded', function(){
    const saveBtn = byId('configSaveBtn');
    const discardBtn = byId('configDiscardBtn');
    if (!saveBtn || !discardBtn) return;

    saveBtn.addEventListener('click', function(){ saveSettings(); });
    discardBtn.addEventListener('click', function(){ restoreOriginal(); });

    const pctInput = byId('cfgDistributablePercent');
    if (pctInput){
      const enforce = ()=>{
        let raw = parseInt(pctInput.value, 10);
        if (!Number.isFinite(raw)) raw = 0;
        const clamped = Math.max(0, Math.min(100, raw));
        if (raw !== clamped){
          pctInput.value = String(clamped);
          toast('Distributable inventory percentage cannot exceed 100%.', 'warning');
        }
      };
      pctInput.addEventListener('change', enforce);
      pctInput.addEventListener('blur', enforce);
      pctInput.addEventListener('input', ()=>{
        const val = parseInt(pctInput.value, 10);
        if (Number.isFinite(val) && val > 100){
          pctInput.value = '100';
          toast('Distributable inventory percentage capped at 100%.', 'warning');
        }
      });
    }

    loadSettings();
  });
})();
