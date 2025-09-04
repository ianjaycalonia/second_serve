(function(){
  'use strict';

  $(function(){
    // Chart init (if canvas exists)
    try {
      const canvas = document.getElementById('lineChart');
      if (canvas && window.Chart){
        const ctx = canvas.getContext('2d');
        new Chart(ctx, {
          type: 'line',
          data: {
            labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
            datasets: [{
              label: 'Pickups',
              data: [2, 5, 1, 4, 7, 6, 4],
              borderColor: '#0d6efd',
              backgroundColor: 'rgba(13, 110, 253, 0.2)',
              tension: 0.4,
              fill: true,
              pointRadius: 5,
              pointHoverRadius: 7
            }]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: { y: { beginAtZero: true } }
          }
        });
      }
    } catch (_e) { /* no-op */ }

    // Donation modal + history logic
    const $modal = $('#donationModal');
    const $form = $('#donationForm');
    const $submitBtn = $('#submitDonationBtn');
    const $itemsContainer = $('#itemsContainer');
    const $addItemBtn = $('#addItemBtn');
    const $datalist = $('#itemsDatalist');

    function initSelect2($el){
      if (!$el || !$el.length || !$.fn.select2) return;
      $el.select2({
        tags: true, // allow new entries
        width: '100%',
        placeholder: $el.data('placeholder') || 'Search or type new',
        minimumInputLength: 1,
        dropdownParent: $modal, // ensure dropdown displays inside modal
        ajax: {
          delay: 250,
          url: `${API_BASE_URL}/donations/index.php/items`,
          dataType: 'json',
          data: function(params){ return { q: params.term || '', limit: 20 }; },
          processResults: function(data){
            const items = (data && data.items) ? data.items : [];
            return { results: items.map(n => ({ id: n, text: n })) };
          },
          cache: true
        },
        createTag: function(params){
          const term = (params.term || '').trim();
          if (term === '') return null;
          return { id: term, text: term, newTag: true };
        }
      });
    }

    function setSubmitting(isLoading){
      if (isLoading){
        $submitBtn.prop('disabled', true).html('<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Submitting...');
      } else {
        $submitBtn.prop('disabled', false).text('Submit Donation');
      }
    }

    // Dynamic items UI
    function itemRowTemplate(id){
      return `
      <div class="card p-3 border position-relative item-row" data-id="${id}">
        <div class="row g-2 align-items-end">
          <div class="col-md-7">
            <label class="form-label mb-1">Item Name</label>
            <select class="form-select item-name-select" data-placeholder="Search or type new" required></select>
            <div class="invalid-feedback">Item name is required.</div>
          </div>
          <div class="col-md-3">
            <label class="form-label mb-1">Quantity</label>
            <input type="number" class="form-control item-qty" min="1" required>
            <div class="invalid-feedback">Min 1</div>
          </div>
          <div class="col-md-2">
            <label class="form-label mb-1">Expiry Date</label>
            <input type="date" class="form-control item-expiry">
          </div>
        </div>
        <button type="button" class="btn btn-sm btn-outline-danger position-absolute" style="top:8px; right:8px" aria-label="Remove item">Remove</button>
      </div>`;
    }

    let __rowId = 1;
    function addItemRow(){
      const id = __rowId++;
      $itemsContainer.append(itemRowTemplate(id));
      initSelect2($itemsContainer.find(`.item-row[data-id="${id}"] .item-name-select`));
    }
    function removeItemRow(btn){ $(btn).closest('.item-row').remove(); }

    $addItemBtn.on('click', addItemRow);
    $itemsContainer.on('click', '.btn-outline-danger', function(){ removeItemRow(this); });

  function showToast(msg, variant){
    try{
      const body = document.getElementById('toastBody');
      body.textContent = msg || 'Done';
      const el = document.getElementById('feedbackToast');
      el.className = 'toast align-items-center text-bg-' + (variant || 'dark') + ' border-0';
      bootstrap.Toast.getOrCreateInstance(el).show();
    }catch(_){ alert(msg); }
  }

  function validateForm(){
    let ok = true;
    $form.find('.is-invalid').removeClass('is-invalid');
    const type = $('#donationType').val();
    if (!type){ $('#donationType').addClass('is-invalid'); ok = false; }
    // At least one item row
    const rows = $itemsContainer.find('.item-row');
    if (rows.length === 0){ showToast('Add at least one donation item.', 'danger'); return false; }
    rows.each(function(){
      const $row = $(this);
      const name = String($row.find('.item-name-select').val() || '').trim();
      const qty = parseInt($row.find('.item-qty').val(), 10);
      if (!name){ $row.find('.item-name-select').addClass('is-invalid'); ok = false; }
      if (!qty || qty < 1){ $row.find('.item-qty').addClass('is-invalid'); ok = false; }
    });
    return ok;
  }

    // Submit: single multipart request to /batch with arrays for items (no receipt image)
    $submitBtn.on('click', function(){
    if (!validateForm()) return;
    const rows = $itemsContainer.find('.item-row');
    setSubmitting(true);
    const fd = new FormData();
    fd.append('type', $('#donationType').val());
    rows.each(function(){
      const $row = $(this);
      fd.append('name[]', String($row.find('.item-name-select').val() || '').trim());
      fd.append('quantity[]', $row.find('.item-qty').val());
      const expiry = $row.find('.item-expiry').val();
      fd.append('expiry_date[]', expiry || '');
    });

    $.ajax({
      url: `${API_BASE_URL}/donations/index.php/batch`,
      method: 'POST',
      data: fd,
      processData: false,
      contentType: false,
      dataType: 'json',
      xhrFields: { withCredentials: true },
      success: function(){
        showToast('Donation submitted successfully', 'success');
        $form[0].reset();
        $itemsContainer.empty();
        addItemRow();
        const modal = bootstrap.Modal.getInstance($modal[0]);
        modal?.hide();
        fetchHistory(true);
      },
      error: function(err){
        const msg = err?.responseJSON?.error || 'Failed to submit donation';
        showToast(msg, 'danger');
      },
      complete: function(){ setSubmitting(false); }
    });
  });

    // History listing with simple pagination
    const PAGE_SIZE = 50;
    let __items = [];
    let __page = 1;

  function badge(status){
    switch(status){
      case 'Pending': return '<span class="badge bg-warning text-dark">Pending</span>';
      case 'Allocated': return '<span class="badge bg-info text-dark">Allocated</span>';
      case 'Completed': return '<span class="badge bg-success">Completed</span>';
      case 'Cancelled': return '<span class="badge bg-secondary">Cancelled</span>';
      default: return `<span class="badge bg-light text-dark">${status||'Unknown'}</span>`;
    }
  }

  function fmtDate(s){
    if(!s) return '';
    const d = new Date(s);
    return isNaN(d) ? s : d.toLocaleDateString();
  }

  function imageCell(url){
    if (!url) return '';
    const safe = String(url).replace(/"/g, '&quot;');
    return `<a href="${safe}" target="_blank" rel="noopener" class="d-inline-flex align-items-center flex-shrink-0"><img src="${safe}" class="img-thumbnail" style="max-height:40px; width:auto"></a>`;
  }

  function renderPage(){
    const start = (Math.max(1,__page)-1) * PAGE_SIZE;
    const pageItems = __items.slice(start, start + PAGE_SIZE);
    const groups = new Map();
    pageItems.forEach(r => {
      const key = r.batch_id ? `b-${r.batch_id}` : `s-${r.id}`;
      if (!groups.has(key)) groups.set(key, { batch_id: r.batch_id || null, items: [] });
      groups.get(key).items.push(r);
    });

    let htmlRows = '';
    groups.forEach(group => {
      const isBatch = !!group.batch_id;
      if (isBatch){
        const count = group.items.length;
        const first = group.items[0] || {};
        if (count <= 1){
          const r = first;
          htmlRows += `
            <tr>
              <td>${r.name || ''}</td>
              <td>${r.type || ''}</td>
              <td>${r.quantity ?? ''}</td>
              <td>${fmtDate(r.expiry_date)}</td>
              <td>${badge(r.status)}</td>
              <td>${ imageCell(r.image_full_url) }</td>
            </tr>
          `;
        } else {
          const title = `Donation • ${count} item${count>1?'s':''}`;
          htmlRows += `
            <tr class="table-active group-row" data-batch-id="${group.batch_id}">
              <td colspan="4" class="py-2">
                <div class="fw-semibold"><button class="btn btn-sm btn-outline-secondary me-2 batch-toggle" type="button" aria-label="Toggle">Show</button>${title}</div>
              </td>
              <td class="py-2 align-middle">${badge(first.status || 'Pending')}</td>
              <td class="py-2 align-middle">${imageCell(first.image_full_url)}</td>
            </tr>
            <tr class="child-container d-none" data-batch-id="${group.batch_id}">
              <td colspan="6" class="p-0">
                <table class="table table-sm mb-0">
                  <tbody>
                    ${group.items.map(r => `
                      <tr>
                        <td>${r.name || ''}</td>
                        <td style="width:10%">${r.type || ''}</td>
                        <td style="width:8%">${r.quantity ?? ''}</td>
                        <td style="width:14%">${fmtDate(r.expiry_date)}</td>
                        <td style="width:14%">${badge(r.status)}</td>
                        <td style="width:14%">${ imageCell(r.image_full_url) }</td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              </td>
            </tr>
          `;
        }
      } else {
        const r = group.items[0];
        htmlRows += `
          <tr>
            <td>${r.name || ''}</td>
            <td>${r.type || ''}</td>
            <td>${r.quantity ?? ''}</td>
            <td>${fmtDate(r.expiry_date)}</td>
            <td>${badge(r.status)}</td>
            <td>${ imageCell(r.image_full_url) }</td>
          </tr>
        `;
      }
    });
    document.getElementById('donationHistoryBody').innerHTML = htmlRows || '<tr><td colspan="6" class="text-center text-muted">No donations yet</td></tr>';

    // Pagination controls
    const totalPages = Math.max(1, Math.ceil(__items.length / PAGE_SIZE));
    const $pg = $('#historyPagination');
    let html = '';
    function li(p, label, disabled, active){ return `<li class="page-item ${disabled?'disabled':''} ${active?'active':''}"><a class="page-link" href="#" data-page="${p}">${label}</a></li>`; }
    html += li(__page-1, '«', __page<=1, false);
    for(let p=1;p<=totalPages && p<=7;p++){ html += li(p, p, false, p===__page); }
    html += li(__page+1, '»', __page>=totalPages, false);
    $pg.html(html);
  }

    function setHistoryLoading(on){ $('#historySpinner').toggleClass('d-none', !on); }

    function fetchHistory(reset){
    if (reset) __page = 1;
    setHistoryLoading(true);
    $.ajax({
      url: `${API_BASE_URL}/donations/index.php/list`,
      method: 'GET',
      dataType: 'json',
      xhrFields: { withCredentials: true },
      success: function(resp){
        __items = resp?.data?.items || [];
        // Populate datalist from unique item names (legacy fallback, kept harmless)
        const names = Array.from(new Set(__items.map(x => (x.name||'').trim()).filter(Boolean))).sort();
        $datalist.html(names.map(n => `<option value="${n}"></option>`).join(''));
        renderPage();
      },
      error: function(err){ showToast(err.responseJSON?.error || 'Failed to load history', 'danger'); },
      complete: function(){ setHistoryLoading(false); }
    });
  }

    // Events delegated on document
    $(document).on('click', '#historyPagination a.page-link', function(e){
    e.preventDefault();
    const p = parseInt(this.dataset.page, 10);
    if (!isNaN(p)) { __page = p; renderPage(); }
  });

    $(document).on('click', '.batch-toggle', function(){
    const $groupRow = $(this).closest('tr.group-row');
    const batchId = $groupRow.data('batch-id');
    const $child = $(`tr.child-container[data-batch-id="${batchId}"]`);
    const showing = !$child.hasClass('d-none');
    $child.toggleClass('d-none', showing);
    $(this).text(showing ? 'Show' : 'Hide');
  });

    $('#refreshHistoryBtn').on('click', function(){ fetchHistory(true); });

    // When modal becomes visible, ensure at least one item row exists and init Select2
    $modal.on('shown.bs.modal', function(){
      if ($itemsContainer.find('.item-row').length === 0) addItemRow();
      $itemsContainer.find('.item-name-select').each(function(){
        if (!$(this).hasClass('select2-hidden-accessible')){ initSelect2($(this)); }
      });
    });

    // History listing remains defined above; no duplicates below

    // Safety: if modal content is already in DOM, pre-create one row once on ready
    if ($itemsContainer.length && $itemsContainer.find('.item-row').length === 0) {
      addItemRow();
    }

    // Initial load
    fetchHistory(true);
  });
})();
