(function(){
  // Use a project-relative path so it works under /Capstone%20Project/
  const API_BASE = 'php/api/taxonomy/index.php';

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
})();
