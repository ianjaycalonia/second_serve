(function(){
  // Use the flattened project root
  const API_BASE = '/php/api/taxonomy/index.php';

  function authHeaders(){
    return { 'Content-Type': 'application/json' };
  }
  async function apiGet(path, params){
    const qs = params ? ('?' + new URLSearchParams(params).toString()) : '';
    const res = await fetch(API_BASE + path + qs, { credentials: 'include' });
    const text = await res.text();
    try { return JSON.parse(text); } catch { throw new Error('Unexpected response: ' + text.slice(0,120)); }
  }
  async function apiSend(method, path, body){
    const res = await fetch(API_BASE + path, {
      method,
      headers: authHeaders(),
      credentials: 'include',
      body: body? JSON.stringify(body) : undefined
    });
    const text = await res.text();
    try { return JSON.parse(text); } catch { throw new Error('Unexpected response: ' + text.slice(0,120)); }
  }

  // Categories
  const catBody = document.getElementById('catTableBody');
  const catSearch = document.getElementById('catSearch');
  const catActive = document.getElementById('catActiveFilter');
  const catAddBtn = document.getElementById('catAddBtn');
  const catEditModal = document.getElementById('catEditModal');
  const catEditTitle = document.getElementById('catEditTitle');
  const catPrimaryInput = document.getElementById('catPrimaryInput');
  const catSecondaryInput = document.getElementById('catSecondaryInput');
  const catEditFeedback = document.getElementById('catEditFeedback');

  let editingCatId = null;

  async function loadCategories(){
    if (!catBody) return;
    catBody.innerHTML = '<tr><td colspan="4" class="text-center text-muted py-3">Loading...</td></tr>';
    try {
      const data = await apiGet('/categories', { q: catSearch.value.trim(), active: catActive.value });
      const items = data && data.items ? data.items : [];
      if (!items.length) { catBody.innerHTML = '<tr><td colspan="4" class="text-center text-muted py-3">No categories</td></tr>'; return; }
      catBody.innerHTML = items.map(c=>
      `<tr class="${c.is_active? '' : 'table-light text-muted'}">
        <td>${escapeHtml(c.primary_name||'')}</td>
        <td>${escapeHtml(c.secondary_name||'')}</td>
        <td>${c.is_active? 'Yes' : '<span class="badge text-bg-secondary">Inactive</span>'}</td>
        <td class="text-end">
          <button class="btn btn-sm btn-outline-secondary me-1" data-action="cat-edit" data-id="${c.category_id}">Edit</button>
          ${c.is_active? `<button class="btn btn-sm btn-outline-danger" data-action="cat-deactivate" data-id="${c.category_id}">Deactivate</button>` : `<button class="btn btn-sm btn-outline-success" data-action="cat-activate" data-id="${c.category_id}">Activate</button>`}
        </td>
      </tr>`
      ).join('');
    } catch (err){
      catBody.innerHTML = '<tr><td colspan="4" class="text-danger py-3">Failed to load categories</td></tr>';
      showToast(String(err.message||err), 'danger');
    }
  }

  // Units
  const unitBody = document.getElementById('unitTableBody');
  const unitSearch = document.getElementById('unitSearch');
  const unitActive = document.getElementById('unitActiveFilter');
  const unitAddBtn = document.getElementById('unitAddBtn');
  const unitEditModal = document.getElementById('unitEditModal');
  const unitEditTitle = document.getElementById('unitEditTitle');
  const unitCodeInput = document.getElementById('unitCodeInput');
  const unitLabelInput = document.getElementById('unitLabelInput');
  const unitEditFeedback = document.getElementById('unitEditFeedback');

  let editingUnitId = null;

  async function loadUnits(){
    if (!unitBody) return;
    unitBody.innerHTML = '<tr><td colspan="4" class="text-center text-muted py-3">Loading...</td></tr>';
    try {
      const data = await apiGet('/units', { q: unitSearch.value.trim(), active: unitActive.value });
      const items = data && data.items ? data.items : [];
      if (!items.length) { unitBody.innerHTML = '<tr><td colspan="4" class="text-center text-muted py-3">No units</td></tr>'; return; }
      unitBody.innerHTML = items.map(u=>
      `<tr class="${u.is_active? '' : 'table-light text-muted'}">
        <td>${escapeHtml(u.code||'')}</td>
        <td>${escapeHtml(u.label||'')}</td>
        <td>${u.is_active? 'Yes' : '<span class="badge text-bg-secondary">Inactive</span>'}</td>
        <td class="text-end">
          <button class="btn btn-sm btn-outline-secondary me-1" data-action="unit-edit" data-id="${u.unit_id}">Edit</button>
          ${u.is_active? `<button class="btn btn-sm btn-outline-danger" data-action="unit-deactivate" data-id="${u.unit_id}">Deactivate</button>` : `<button class="btn btn-sm btn-outline-success" data-action="unit-activate" data-id="${u.unit_id}">Activate</button>`}
        </td>
      </tr>`
      ).join('');
    } catch (err){
      unitBody.innerHTML = '<tr><td colspan="4" class="text-danger py-3">Failed to load units</td></tr>';
      showToast(String(err.message||err), 'danger');
    }
  }

  // Assignment/Missing Metadata
  const assignmentBody = document.getElementById('assignmentTableBody');
  const assignmentRefreshBtn = document.getElementById('assignmentRefreshBtn');
  const assignmentCountBadge = document.getElementById('assignmentCountBadge');

  const assignModalEl = document.getElementById('assignmentModal');
  console.log('assignModalEl:', assignModalEl);
  const assignItemName = document.getElementById('assignItemName');
  const assignItemContext = document.getElementById('assignItemContext');
  const assignWeightInput = document.getElementById('assignWeightInput');
  const assignFeedback = document.getElementById('assignFeedback');
  const assignSaveBtn = document.getElementById('assignSaveBtn');
  const $assignCategorySelect = window.jQuery ? window.jQuery('#assignCategorySelect') : null;
  const $assignUnitSelect = window.jQuery ? window.jQuery('#assignUnitSelect') : null;
  let currentAssignment = null;

  function ensureAssignmentSelect2(){
    if (!$assignCategorySelect || !$assignCategorySelect.length || !$assignUnitSelect || !$assignUnitSelect.length) return;
    const dropdownParent = assignModalEl ? window.jQuery(assignModalEl) : null;
    if (!$assignCategorySelect.hasClass('select2-hidden-accessible')) {
      $assignCategorySelect.select2({
        tags: true,
        width: '100%',
        placeholder: $assignCategorySelect.data('placeholder') || 'Select or create category',
        dropdownParent: dropdownParent || undefined,
        ajax: {
          delay: 250,
          url: API_BASE + '/categories',
          dataType: 'json',
          data: params => ({ q: params.term || '', active: 1 }),
          processResults: data => {
            const items = Array.isArray(data?.items) ? data.items : [];
            return {
              results: items.map(c => ({ id: 'cat:' + c.category_id, text: c.secondary_name ? `${c.primary_name} - ${c.secondary_name}` : c.primary_name }))
            };
          },
          xhrFields: { withCredentials: true },
          cache: true,
        },
        createTag: function(params){
          const term = (params.term || '').trim();
          if (!term) return null;
          return { id: 'newcat:' + term, text: term, newTag: true };
        }
      });
    }
    if (!$assignUnitSelect.hasClass('select2-hidden-accessible')) {
      $assignUnitSelect.select2({
        tags: true,
        width: '100%',
        placeholder: $assignUnitSelect.data('placeholder') || 'Select or create unit',
        dropdownParent: dropdownParent || undefined,
        ajax: {
          delay: 250,
          url: API_BASE + '/units',
          dataType: 'json',
          data: params => ({ q: params.term || '', active: 1 }),
          processResults: data => {
            const items = Array.isArray(data?.items) ? data.items : [];
            return {
              results: items.map(u => ({ id: 'unit:' + u.unit_id, text: u.label ? `${u.code} (${u.label})` : u.code }))
            };
          },
          xhrFields: { withCredentials: true },
          cache: true,
        },
        createTag: function(params){
          const term = (params.term || '').trim();
          if (!term) return null;
          return { id: 'newunit:' + term, text: term, newTag: true };
        }
      });
    }
  }

  function openAssignmentModal(item){
    console.log('Opening assignment modal for item', item.product_name);
    if (!assignModalEl) {
      console.error('Assignment modal element not found');
      return;
    }
    ensureAssignmentSelect2();
    const modal = new bootstrap.Modal(assignModalEl);
    currentAssignment = item;
    if (assignItemName) assignItemName.textContent = item.product_name || 'Unnamed Item';
    if (assignItemContext) assignItemContext.textContent = `Donation #${item.donation_id} · Item ID ${item.donation_item_id}`;
    if (assignWeightInput) assignWeightInput.value = item.total_weight != null ? String(item.total_weight) : '';
    if (assignFeedback) assignFeedback.textContent = '';
    if ($assignCategorySelect) {
      if ($assignCategorySelect.hasClass('select2-hidden-accessible')) {
        $assignCategorySelect.val(null).trigger('change');
        if (item.category_id) {
          const label = item.category_label || 'Category #' + item.category_id;
          const option = new Option(label, 'cat:' + item.category_id, true, true);
          $assignCategorySelect.append(option).trigger('change');
        }
      } else {
        $assignCategorySelect.val(item.category_id ? ('cat:' + item.category_id) : '');
      }
    }
    if ($assignUnitSelect) {
      if ($assignUnitSelect.hasClass('select2-hidden-accessible')) {
        $assignUnitSelect.val(null).trigger('change');
        if (item.unit_id) {
          const label = item.unit_label || 'Unit #' + item.unit_id;
          const option = new Option(label, 'unit:' + item.unit_id, true, true);
          $assignUnitSelect.append(option).trigger('change');
        }
      } else {
        $assignUnitSelect.val(item.unit_id ? ('unit:' + item.unit_id) : '');
      }
    }
    modal.show();
  }

  async function loadAssignments(){
    if (!assignmentBody) return;
    assignmentBody.innerHTML = '<tr><td colspan="7" class="text-center text-muted py-3">Loading...</td></tr>';
    try {
      const data = await apiGet('/missing-metadata', {});
      if (data && data.success === false) {
        const msg = data.error ? escapeHtml(data.error) : 'Failed to load items';
        assignmentBody.innerHTML = `<tr><td colspan="7" class="text-danger py-3">${msg}</td></tr>`;
        if (assignmentCountBadge) {
          assignmentCountBadge.style.display = 'none';
          assignmentCountBadge.textContent = '';
        }
        return;
      }
      const items = Array.isArray(data?.items) ? data.items : [];
      if (assignmentCountBadge) {
        if (items.length > 0) {
          assignmentCountBadge.textContent = String(items.length);
          assignmentCountBadge.style.display = '';
        } else {
          assignmentCountBadge.style.display = 'none';
          assignmentCountBadge.textContent = '';
        }
      }
      if (!items.length) {
        assignmentBody.innerHTML = '<tr><td colspan="7" class="text-center text-muted py-3">All items have metadata assigned.</td></tr>';
        return;
      }
      const rows = items.map(it => {
        const donor = escapeHtml(it.donor_name || '—');
        const missing = Array.isArray(it.missing) ? it.missing.join(', ') : '';
        const missingHtml = missing ? `<span class="badge text-bg-warning">${escapeHtml(missing)}</span>` : '<span class="badge text-bg-success">Complete</span>';
        const submitted = it.submitted_at ? new Date(it.submitted_at).toLocaleString() : '—';
        const expiry = it.expiry_date ? new Date(it.expiry_date).toLocaleDateString() : '—';
        return `
          <tr>
            <td>
              <div class="fw-semibold">${escapeHtml(it.product_name || 'Unnamed Item')}</div>
              <div class="small text-muted">Donation #${it.donation_id || '—'} · Item ID ${it.donation_item_id}</div>
            </td>
            <td>${missingHtml}</td>
            <td>${donor}</td>
            <td class="text-center">${it.quantity || 0}</td>
            <td>${expiry}</td>
            <td>${submitted}</td>
            <td class="text-end">
              <button type="button" class="btn btn-sm btn-outline-primary" data-action="assign-edit" data-id="${it.donation_item_id}">Edit</button>
            </td>
          </tr>
        `;
      }).join('');
      assignmentBody.innerHTML = rows;
      assignmentBody.querySelectorAll('button[data-action="assign-edit"]').forEach(btn => {
        btn.addEventListener('click', () => {
          console.log('Edit button clicked');
          const id = parseInt(btn.getAttribute('data-id'), 10);
          console.log('ID:', id);
          const item = items.find(it => Number(it.donation_item_id) === id);
          console.log('Item:', item);
          if (!item) return;
          openAssignmentModal(item);
        });
      });
    } catch (err) {
      assignmentBody.innerHTML = '<tr><td colspan="7" class="text-danger py-3">Failed to load items</td></tr>';
      showToast(String(err.message || err), 'danger');
    }
  }

  if (assignmentRefreshBtn) assignmentRefreshBtn.addEventListener('click', loadAssignments);

  const assignmentTabTrigger = document.getElementById('assignment-tab');
  if (assignmentTabTrigger) {
    assignmentTabTrigger.addEventListener('shown.bs.tab', loadAssignments);
  }

  function activateAssignmentTabFromHash() {
    if (!assignmentTabTrigger) return;
    const hash = (window.location.hash || '').toLowerCase();
    if (hash === '#assignment') {
      const tab = new bootstrap.Tab(assignmentTabTrigger);
      tab.show();
    }
  }

  window.addEventListener('hashchange', activateAssignmentTabFromHash);
  activateAssignmentTabFromHash();

  if (assignSaveBtn) {
    assignSaveBtn.addEventListener('click', async () => {
      if (!currentAssignment) return;
      assignSaveBtn.disabled = true;
      assignSaveBtn.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Saving...';
      assignFeedback.textContent = '';
      try {
        let categoryPayload = {};
        if ($assignCategorySelect) {
          const val = $assignCategorySelect.val();
          if (val && typeof val === 'string') {
            if (val.startsWith('cat:')) {
              categoryPayload.category_id = parseInt(val.slice(4), 10) || null;
            } else if (val.startsWith('newcat:')) {
              categoryPayload.category_label = val.slice(7).trim();
            }
          }
        }
        let unitPayload = {};
        if ($assignUnitSelect) {
          const val = $assignUnitSelect.val();
          if (val && typeof val === 'string') {
            if (val.startsWith('unit:')) {
              unitPayload.unit_id = parseInt(val.slice(5), 10) || null;
            } else if (val.startsWith('newunit:')) {
              unitPayload.unit_label = val.slice(8).trim();
            }
          }
        }
        const weightRaw = assignWeightInput ? assignWeightInput.value.trim() : '';
        const payload = Object.assign({}, categoryPayload, unitPayload, { weight: weightRaw === '' ? null : parseFloat(weightRaw) });
        const res = await fetch(`${API_BASE}/missing-metadata/${currentAssignment.donation_item_id}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'include',
          body: JSON.stringify(payload),
        });
        const text = await res.text();
        let data;
        try { data = JSON.parse(text); } catch { data = { success: false, error: text }; }
        if (!res.ok || data?.success === false) {
          const msg = data?.error || `Failed to save (HTTP ${res.status})`;
          assignFeedback.textContent = msg;
          showToast(msg, 'danger');
        } else {
          showToast('Metadata updated successfully', 'success');
          const modal = bootstrap.Modal.getInstance(assignModalEl);
          if (modal) modal.hide();
          loadAssignments();
        }
      } catch (err) {
        const msg = String(err.message || err);
        assignFeedback.textContent = msg;
        showToast(msg, 'danger');
      } finally {
        assignSaveBtn.disabled = false;
        assignSaveBtn.textContent = 'Save';
      }
    });
  }

  // Helpers
  function escapeHtml(s){ return String(s).replace(/[&<>"]/g, m=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;"})[m]); }
  function showModal(el){ new bootstrap.Modal(el).show(); }
  function hideModal(el){ bootstrap.Modal.getInstance(el)?.hide(); }
  function showToast(msg, variant){
    const el = document.getElementById('taxonomyToast');
    const body = document.getElementById('taxonomyToastBody');
    if (!el || !body) return;
    body.textContent = msg || 'Done.';
    el.classList.remove('text-bg-dark','text-bg-success','text-bg-danger','text-bg-warning');
    el.classList.add(variant==='success' ? 'text-bg-success' : variant==='warning' ? 'text-bg-warning' : variant==='danger' ? 'text-bg-danger' : 'text-bg-dark');
    bootstrap.Toast.getOrCreateInstance(el, { delay: 2500 }).show();
  }

  // Wire events
  if (catSearch) catSearch.addEventListener('input', debounce(loadCategories, 250));
  if (catActive) catActive.addEventListener('change', loadCategories);
  if (catAddBtn) catAddBtn.addEventListener('click', ()=>{
    editingCatId = null;
    catEditTitle.textContent = 'Add Category';
    catPrimaryInput.value = '';
    catSecondaryInput.value = '';
    catEditFeedback.textContent = '';
    showModal(catEditModal);
  });
  if (catBody) catBody.addEventListener('click', async (e)=>{
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const id = parseInt(btn.getAttribute('data-id'),10);
    const action = btn.getAttribute('data-action');
    if (action === 'cat-edit'){
      // Simple fetch current row from table DOM instead of API
      const row = btn.closest('tr');
      editingCatId = id;
      catEditTitle.textContent = 'Edit Category';
      catPrimaryInput.value = row.children[0].textContent.trim();
      catSecondaryInput.value = row.children[1].textContent.trim();
      catEditFeedback.textContent = '';
      showModal(catEditModal);
    } else if (action === 'cat-deactivate'){
      try { await apiSend('DELETE', `/categories/${id}`); showToast('Category deactivated','success'); } catch(err){ showToast(String(err.message||err),'danger'); }
      loadCategories();
    } else if (action === 'cat-activate'){
      try { await apiSend('PUT', `/categories/${id}`, { is_active: true }); showToast('Category activated','success'); } catch(err){ showToast(String(err.message||err),'danger'); }
      loadCategories();
    }
  });
  const catSaveBtn = document.getElementById('catSaveBtn');
  if (catSaveBtn) catSaveBtn.addEventListener('click', async ()=>{
    const primary = catPrimaryInput.value.trim();
    const secondary = catSecondaryInput.value.trim();
    if (!primary){ catEditFeedback.textContent = 'Primary is required'; return; }
    try {
      if (editingCatId){
        await apiSend('PUT', `/categories/${editingCatId}`, { primary_name: primary, secondary_name: secondary||null });
        showToast('Category updated','success');
      } else {
        await apiSend('POST', `/categories`, { primary_name: primary, secondary_name: secondary||null });
        showToast('Category added','success');
      }
      hideModal(catEditModal);
      loadCategories();
    } catch (err){
      catEditFeedback.textContent = String(err.message||err);
      showToast('Failed to save category','danger');
    }
  });

  if (unitSearch) unitSearch.addEventListener('input', debounce(loadUnits, 250));
  if (unitActive) unitActive.addEventListener('change', loadUnits);
  if (unitAddBtn) unitAddBtn.addEventListener('click', ()=>{
    editingUnitId = null;
    unitEditTitle.textContent = 'Add Unit';
    unitCodeInput.value = '';
    unitLabelInput.value = '';
    unitEditFeedback.textContent = '';
    showModal(unitEditModal);
  });
  if (unitBody) unitBody.addEventListener('click', async (e)=>{
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const id = parseInt(btn.getAttribute('data-id'),10);
    const action = btn.getAttribute('data-action');
    if (action === 'unit-edit'){
      const row = btn.closest('tr');
      editingUnitId = id;
      unitEditTitle.textContent = 'Edit Unit';
      unitCodeInput.value = row.children[0].textContent.trim();
      unitLabelInput.value = row.children[1].textContent.trim();
      unitEditFeedback.textContent = '';
      showModal(unitEditModal);
    } else if (action === 'unit-deactivate'){
      try { await apiSend('DELETE', `/units/${id}`); showToast('Unit deactivated','success'); } catch(err){ showToast(String(err.message||err),'danger'); }
      loadUnits();
    } else if (action === 'unit-activate'){
      try { await apiSend('PUT', `/units/${id}`, { is_active: true }); showToast('Unit activated','success'); } catch(err){ showToast(String(err.message||err),'danger'); }
      loadUnits();
    }
  });
  const unitSaveBtn = document.getElementById('unitSaveBtn');
  if (unitSaveBtn) unitSaveBtn.addEventListener('click', async ()=>{
    const code = unitCodeInput.value.trim();
    const label = unitLabelInput.value.trim();
    if (!code){ unitEditFeedback.textContent = 'Code is required'; return; }
    try {
      if (editingUnitId){
        await apiSend('PUT', `/units/${editingUnitId}`, { code, label: label||null });
        showToast('Unit updated','success');
      } else {
        await apiSend('POST', `/units`, { code, label: label||null });
        showToast('Unit added','success');
      }
      hideModal(unitEditModal);
      loadUnits();
    } catch (err){
      unitEditFeedback.textContent = String(err.message||err);
      showToast('Failed to save unit','danger');
    }
  });

  function debounce(fn, ms){ let t; return function(){ clearTimeout(t); t=setTimeout(()=>fn.apply(this, arguments), ms); } }

  // Initial loads
  loadCategories();
  loadUnits();
  loadAssignments();
})();
