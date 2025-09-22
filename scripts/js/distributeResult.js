(async function(){
        function showMsg(el, msg, type){ if (!el) return; try { el.innerHTML = msg ? `<div class="alert alert-${type} py-2 mb-0">${msg}</div>` : ''; } catch(_){} }
        const container = document.getElementById('resultContainer');
        const summary = document.getElementById('resultSummary');
        const feedback = document.getElementById('resultFeedback');
        const API_BASE_URL = (typeof window.API_BASE_URL === 'string' && window.API_BASE_URL) ? window.API_BASE_URL : '/Capstone%20Project/php/api';
        const url = new URL(window.location.href);
        const DEBUG = url.searchParams.get('debug') === '1';
        const runIdRaw = (url.searchParams.get('run_id')||'').trim();
        const runId = parseInt(runIdRaw||'0',10)||0;
        let periodKeyParam = (url.searchParams.get('period_key') || '').trim();
        // Back-compat: some links pass period_key in run_id. Normalize it here.
        if (!periodKeyParam && /^\d{4}-\d{2}-W[1-4]$/.test(runIdRaw)){
          periodKeyParam = runIdRaw;
        }
        if (DEBUG) console.log('[DR] Params', { runIdRaw, runId, periodKeyParam });

        const idsParam = (url.searchParams.get('recipient_ids') || '').trim();
        const recipientIds = idsParam ? idsParam.split(',').map(s=>parseInt(s,10)).filter(n=>Number.isFinite(n)&&n>0) : [];

        try{
          document.getElementById('notifyAllBtn')?.classList.add('d-none');
          document.getElementById('clearLocalBtn')?.classList.add('d-none');
        } catch(_){}

        if (!container || !summary){ return; }

        // Auto-load run: prefer explicit period_key, else latest run, unless recipient_ids provided
        if (!runId && !recipientIds.length){
          try {
            if (/^\d{4}-\d{2}-W[1-4]$/.test(periodKeyParam)){
              // Resolve by period_key first
              const runUrl = `${API_BASE_URL}/allocations.php?action=run_by_period&period_key=${encodeURIComponent(periodKeyParam)}&t=${Date.now()}`;
              if (DEBUG) console.log('[DR] fetch run_by_period', runUrl);
              const res = await fetch(runUrl, { credentials:'include', headers:{'Accept':'application/json'} });
              const j = await res.json().catch(()=>null);
              if (DEBUG) console.log('[DR] run_by_period resp', res.status, j);
              if (res.ok && j && j.success && j.data && j.data.run_id){
                window.__DR_RESOLVED_RUN_ID__ = parseInt(j.data.run_id,10)||0;
              } else {
                // Fallback to latest_run
                const latestUrl = `${API_BASE_URL}/allocations.php?action=latest_run&t=${Date.now()}`;
                if (DEBUG) console.log('[DR] fetch latest_run', latestUrl);
                const r2 = await fetch(latestUrl, { credentials:'include', headers:{'Accept':'application/json'} });
                const j2 = await r2.json().catch(()=>null);
                if (DEBUG) console.log('[DR] latest_run resp', r2.status, j2);
                if (r2.ok && j2 && j2.success && j2.data && j2.data.run_id){
                  window.__DR_RESOLVED_RUN_ID__ = parseInt(j2.data.run_id,10)||0;
                } else {
                  showMsg(feedback, 'No run found. Use Distribute Items → Allocate Now to generate a result set.', 'warning');
                  if (DEBUG) console.warn('[DR] No run found');
                  container.innerHTML = '';
                  summary.textContent = '';
                  return;
                }
              }
            } else {
              // No period_key provided: use latest_run
              const latestUrl = `${API_BASE_URL}/allocations.php?action=latest_run&t=${Date.now()}`;
              if (DEBUG) console.log('[DR] fetch latest_run', latestUrl);
              const res = await fetch(latestUrl, { credentials:'include', headers:{'Accept':'application/json'} });
              const j = await res.json().catch(()=>null);
              if (DEBUG) console.log('[DR] latest_run resp', res.status, j);
              if (res.ok && j && j.success && j.data && j.data.run_id){
                window.__DR_RESOLVED_RUN_ID__ = parseInt(j.data.run_id,10)||0;
              } else {
                showMsg(feedback, 'No run found. Use Distribute Items → Allocate Now to generate a result set.', 'warning');
                if (DEBUG) console.warn('[DR] No run found');
                container.innerHTML = '';
                summary.textContent = '';
                return;
              }
            }
          } catch(e){
            showMsg(feedback, 'Failed to load latest run. Use Distribute Items → Allocate Now.', 'danger');
            if (DEBUG) console.error('[DR] latest/run_by_period error', e);
            container.innerHTML = '';
            summary.textContent = '';
            return;
          }
        }

        // Removed inline loading message per request

        // Fetch recipients metadata for labels
        let recMeta = new Map();
        try{
          const res = await fetch(`${API_BASE_URL}/users.php?action=list&role=recipient&status=approved`, { credentials:'include' });
          const j = await res.json().catch(()=>null);
          if (DEBUG) console.log('[DR] users list resp', res.status, j);
          const arr = Array.isArray(j?.data?.items) ? j.data.items : [];
          arr.forEach(u => { const id = Number(u.user_id||u.id)||0; if (id) recMeta.set(id, u); });
        } catch(_){ }

        // Load allocations
        const byRec = [];
        const effectiveRunId = runId || window.__DR_RESOLVED_RUN_ID__ || 0;
        if (DEBUG) console.log('[DR] effectiveRunId', effectiveRunId);
        if (effectiveRunId){
          try{
            const listUrl = `${API_BASE_URL}/allocations.php?action=list_by_run&run_id=${encodeURIComponent(String(effectiveRunId))}&t=${Date.now()}`;
            if (DEBUG) console.log('[DR] fetch list_by_run', listUrl);
            const res = await fetch(listUrl, { credentials:'include', headers:{'Accept':'application/json'} });
            const j = await res.json().catch(()=>null);
            if (DEBUG) console.log('[DR] list_by_run resp', res.status, j);
            if (!res.ok || !j?.success) throw new Error(j?.error || `HTTP ${res.status}`);
            const arr = Array.isArray(j?.data?.items) ? j.data.items : [];
            // group by recipient_id
            const map = new Map();
            arr.forEach(a => { const rid = Number(a.recipient_id)||0; if (!map.has(rid)) map.set(rid, []); map.get(rid).push(a); });
            map.forEach((items, rid) => byRec.push({ rid, items }));
            // Summary
            const recCount = byRec.length;
            const itemCount = byRec.reduce((sum, r) => sum + (Array.isArray(r.items) ? r.items.reduce((s,a)=> s + (Array.isArray(a.items)?a.items.length:0), 0) : 0), 0);
            if (summary) summary.textContent = `Run ${effectiveRunId}: ${recCount} recipients, ${itemCount} items`;
            if (DEBUG) console.log('[DR] summary', { recCount, itemCount });
          } catch(e){ showMsg(feedback, e?.message||'Failed to load run', 'danger'); if (DEBUG) console.error('[DR] list_by_run error', e); }
        } else {
          // Fallback: explicit recipient_ids
          for (const rid of recipientIds){
            try{
              const perUrl = `${API_BASE_URL}/allocations.php?action=list_by_recipient&recipient_id=${encodeURIComponent(rid)}&t=${Date.now()}`;
              if (DEBUG) console.log('[DR] fetch list_by_recipient', perUrl);
              const res = await fetch(perUrl, { credentials:'include', headers:{'Accept':'application/json'} });
              const j = await res.json().catch(()=>null);
              if (DEBUG) console.log('[DR] list_by_recipient resp', res.status, j);
              if (!res.ok || !j?.success) throw new Error(j?.error || `HTTP ${res.status}`);
              const items = Array.isArray(j?.data?.items) ? j.data.items : [];
              byRec.push({ rid, items });
            } catch(e){ byRec.push({ rid, items: [], error: e?.message || 'Failed' }); if (DEBUG) console.error('[DR] list_by_recipient error', e); }
          }
        }

        // Lock state - persisted in localStorage PER RUN to avoid accidental global lock
        let isLocked = false;
        const effectiveIdForLock = (runId || window.__DR_RESOLVED_RUN_ID__ || 0);
        const LOCK_KEY = `distributeResultLocked:${effectiveIdForLock}`;
        // Clean up old global key if it exists (from previous versions)
        try { if (localStorage.getItem('distributeResultLocked')) localStorage.removeItem('distributeResultLocked'); } catch(_) {}

        // Check if run is already notified (server-driven). Our enum currently doesn't include 'Notified',
        // but keep this for forward compatibility. We'll primarily rely on the per-run lock key.
        const isAlreadyNotified = byRec.some(({ items }) => Array.isArray(items) && items.some(a => String(a.status||'').toLowerCase() === 'notified'));
        if (isAlreadyNotified){
          isLocked = true;
          try { localStorage.setItem(LOCK_KEY, 'true'); } catch(_) {}
          document.getElementById('notifyRunBtn')?.classList.add('d-none');
          // applyLock will be called later after inputs are created
        } else {
          // Restore lock state from localStorage for THIS run only
          let storedLock = null;
          try { storedLock = localStorage.getItem(LOCK_KEY); } catch(_) {}
          if (storedLock === 'true') {
            isLocked = true;
            document.getElementById('notifyRunBtn')?.classList.add('d-none');
          } else {
            // Ensure notify button is visible when not locked
            document.getElementById('notifyRunBtn')?.classList.remove('d-none');
          }
        }

        // Apply lock function
        function applyLock(){
          if (!isLocked) return;
          // Disable and prevent typing in inputs
          container.querySelectorAll('.dr-name, .dr-qty').forEach(el => {
            el.disabled = true;
            el.readOnly = true; // Extra prevention
          });

        // Auto Allocate: reuse server-side preview to populate items under existing allocations
        document.getElementById('autoAllocateBtn')?.addEventListener('click', async ()=>{
          const btn = document.getElementById('autoAllocateBtn');
          if (btn) btn.disabled = true;
          try{
            const fb = feedback;
            // Determine period_key for this run
            const effRunId = (runId || window.__DR_RESOLVED_RUN_ID__ || 0);
            let periodKey = periodKeyParam && /^\d{4}-\d{2}-W[1-4]$/.test(periodKeyParam) ? periodKeyParam : '';
            if (!periodKey && effRunId){
              try{
                const r = await fetch(`${API_BASE_URL}/allocations.php?action=list_runs&limit=100&t=${Date.now()}`, { credentials:'include', headers:{'Accept':'application/json'} });
                const jj = await r.json().catch(()=>null);
                const rows = Array.isArray(jj?.data?.items) ? jj.data.items : [];
                const match = rows.find(x => parseInt(x.run_id,10) === effRunId);
                if (match && match.period_key) periodKey = String(match.period_key);
              } catch(_){ }
            }
            if (!/^\d{4}-\d{2}-W[1-4]$/.test(periodKey)){
              showMsg(fb, 'Cannot resolve week for preview. Use the Week input to load by period first.', 'warning');
              return;
            }

            // Collect recipient IDs present on page
            const rids = Array.from(document.querySelectorAll('tbody.dr-recipient[data-rec]')).map(tb => parseInt(tb.getAttribute('data-rec')||'0',10)).filter(n=>Number.isFinite(n)&&n>0);
            if (!rids.length){ showMsg(fb, 'No recipients to auto-allocate.', 'secondary'); return; }

            // Request server preview
            const res = await fetch(`${API_BASE_URL}/allocations.php?action=preview_allocation`, {
              method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
              body: JSON.stringify({ period_key: periodKey, recipient_ids: rids })
            });
            const j = await res.json().catch(()=>null);
            if (!res.ok || !j?.success){ throw new Error(j?.error || `HTTP ${res.status}`); }
            const sugg = Array.isArray(j?.data?.allocations) ? j.data.allocations : [];
            if (!sugg.length){ showMsg(fb, 'No suggestions returned for this week.', 'warning'); return; }

            // Build map rid -> allocation_id (first existing one on page)
            const allocIdByRid = new Map();
            document.querySelectorAll('tbody.dr-recipient[data-rec]').forEach(tb => {
              const rid = parseInt(tb.getAttribute('data-rec')||'0',10)||0;
              const firstRow = tb.querySelector('tr[data-allocation-id]');
              const aId = firstRow ? parseInt(firstRow.getAttribute('data-allocation-id')||'0',10)||0 : 0;
              if (rid && aId) allocIdByRid.set(rid, aId);
            });

            // Aggregate suggestions per recipient and item
            const aggByRid = new Map();
            for (const a of sugg){
              const rid = parseInt(a.recipient_id,10)||0;
              if (!rid) continue;
              if (!aggByRid.has(rid)) aggByRid.set(rid, new Map());
              const key = `${a.product_category||''}\u0001${a.product_name||''}`;
              const cur = aggByRid.get(rid).get(key) || 0;
              aggByRid.get(rid).set(key, cur + (Number(a.quantity||0)||0));
            }

            // Apply suggestions: create allocation if missing, else add items to existing
            let ok=0, created=0, skipped=0, fail=0;
            for (const [rid, itemsMap] of aggByRid.entries()){
              const allocId = allocIdByRid.get(rid) || 0;
              // Build items array once
              const itemsArr = Array.from(itemsMap.entries()).map(([key, qty]) => {
                const [cat, name] = key.split('\u0001');
                return { item_name: name, category: cat || null, quantity: qty };
              }).filter(it => it.item_name && it.quantity>0);
              if (!itemsArr.length){ skipped++; continue; }
              try{
                if (!allocId){
                  // Create a new allocation under current run for this recipient
                  const payload = { recipient_id: rid, items: itemsArr, run_id: (runId || window.__DR_RESOLVED_RUN_ID__ || null), allocation_code: null, notify_admin: false };
                  const rr = await fetch(`${API_BASE_URL}/allocations.php?action=create_result`, {
                    method:'POST', credentials:'include', headers:{'Content-Type':'application/json','Accept':'application/json'},
                    body: JSON.stringify(payload)
                  });
                  const jj = await rr.json().catch(()=>null);
                  if (rr.ok && jj?.success){ created++; ok += itemsArr.length; }
                  else { fail += itemsArr.length; }
                } else {
                  // Add items into existing allocation
                  for (const it of itemsArr){
                    const rr = await fetch(`${API_BASE_URL}/allocations.php?action=add_item`, {
                      method:'POST', credentials:'include', headers:{'Content-Type':'application/json','Accept':'application/json'},
                      body: JSON.stringify({ allocation_id: allocId, item_name: it.item_name, category: it.category, quantity: it.quantity })
                    });
                    const jj = await rr.json().catch(()=>null);
                    if (rr.ok && jj?.success) ok++; else fail++;
                  }
                }
              } catch(_){ fail += itemsArr.length; }
            }

            // Show outcome and reload
            try{
              const mEl = document.getElementById('resultAlertModal');
              const bEl = document.getElementById('resultAlertBody');
              if (bEl) bEl.textContent = `Auto allocate done. Added ${ok} item${ok!==1?'s':''}. Created ${created} allocation${created!==1?'s':''}. Skipped ${skipped}. Failures: ${fail}.`;
              if (mEl){ const m = new bootstrap.Modal(mEl); m.show(); }
            }catch(_){ /* ignore */ }
            setTimeout(()=>window.location.reload(), 900);
          } catch(err){
            showMsg(feedback, err?.message || 'Auto allocate failed', 'danger');
          } finally {
            if (btn) btn.disabled = false;
          }
        });

        // (autoAllocateBtn handler bound below, outside applyLock)
          // Hide add button containers
          container.querySelectorAll('.dr-add-item').forEach(btn => {
            btn.classList.add('d-none');
            btn.parentElement.style.display = 'none';
          });
          // Hide remove button cells
          container.querySelectorAll('.dr-del').forEach(el => {
            el.parentElement.style.display = 'none';
          });
          const saveBtn = document.getElementById('saveChangesBtn'); if (saveBtn) saveBtn.disabled = true;
          const notifyBtn = document.getElementById('notifyRunBtn'); if (notifyBtn) notifyBtn.disabled = true;
        }

        const frag = document.createDocumentFragment();
        byRec.forEach(({rid, items, error}) => {
          const meta = recMeta.get(rid) || {};
          const base = (meta.organization_name && String(meta.organization_name).trim()) ? String(meta.organization_name).trim() : (meta.name || `Recipient ${rid}`);
          const card = document.createElement('div'); card.className = 'mb-3';
          // Determine highest status badge to show per recipient
          let badgeHtml = '';
          try{
            const statuses = Array.isArray(items) ? items.map(a => String(a.status||'').toLowerCase()) : [];
            if (statuses.some(s => s === 'completed')){
              badgeHtml = " <span class='badge bg-primary ms-2'>Completed</span>";
            } else if (statuses.some(s => s === 'picked up')){
              badgeHtml = " <span class='badge bg-secondary ms-2'>Picked Up</span>";
            } else if (statuses.some(s => s === 'acknowledged')){
              badgeHtml = " <span class='badge bg-success ms-2'>Acknowledged</span>";
            }
          } catch(_){ }
          const header = `${base}${badgeHtml} ${error?`<span class='badge bg-danger ms-2'>${error}</span>`:''}`;
          card.innerHTML = `
            <div class="d-flex align-items-center justify-content-between mb-1">
              <div class="fw-semibold">${header}</div>
              <div class="d-flex gap-2">
                <button class="btn btn-sm btn-outline-success dr-add-item" data-rec="${rid}"><i class="bi bi-plus-circle"></i> Add Item</button>
              </div>
            </div>
            <div class="table-responsive">
              <table class="table table-sm table-striped align-middle mb-0">
                <thead class="table-light"><tr><th>Status</th><th>Created</th><th style="width:45%">Item</th><th style="width:120px">Qty</th><th style="width:40px"></th></tr></thead>
                <tbody class="dr-recipient" data-rec="${rid}"></tbody>
              </table>
            </div>`;
          const tbody = card.querySelector('tbody.dr-recipient');
          if (!items.length){
            const tr = document.createElement('tr');
            tr.innerHTML = `<td colspan="4" class="text-muted">No allocations saved for this recipient.</td>`;
            tbody.appendChild(tr);
          } else {
            // One row per item for clarity
            items.forEach(a => {
              const created = a.created_at ? new Date(a.created_at) : null;
              const dt = created ? `${String(created.getDate()).padStart(2,'0')}/${String(created.getMonth()+1).padStart(2,'0')}/${created.getFullYear()} ${String(created.getHours()).padStart(2,'0')}:${String(created.getMinutes()).padStart(2,'0')}` : '';
              const status = a.status || 'Allocated';
              if (Array.isArray(a.items)){
                a.items.forEach(it => {
                  const tr = document.createElement('tr');
                  tr.setAttribute('data-allocation-id', String(a.allocation_id||''));
                  tr.setAttribute('data-item-id', String(it.item_id||''));
                  tr.innerHTML = `
                    <td>${status}</td>
                    <td>${dt}</td>
                    <td><input type="text" class="form-control form-control-sm dr-name" value="${(it.item_name||'').replace(/"/g,'&quot;')}" placeholder="Item name"></td>
                    <td><input type="number" class="form-control form-control-sm dr-qty" value="${it.quantity}" min="0" step="1"></td>
                    <td><button type="button" class="btn btn-sm btn-outline-danger dr-del" title="Remove"><i class="bi bi-x"></i></button></td>`;
                  tbody.appendChild(tr);
                });
              }
            });
          }
          frag.appendChild(card);
        });
        container.appendChild(frag);
        try { window.__DR_BYREC__ = byRec; } catch(_) {}
        if (DEBUG) console.log('[DR] render complete', { cards: byRec.length });

        // Apply lock after inputs are created
        if (isLocked){ applyLock(); }

        // Period search UI
        const pkInput = document.getElementById('periodKeyInput');
        const pkGo = document.getElementById('periodKeyGo');
        function isoWeekNumber(d){
          // Sunday-first week-of-year (US-style)
          const year = d.getFullYear();
          const jan1 = new Date(year, 0, 1);
          const jan1Dow = jan1.getDay(); // 0=Sun
          const dayMs = 24*60*60*1000;
          const daysSince = Math.floor((new Date(year, d.getMonth(), d.getDate()) - jan1) / dayMs);
          return Math.floor((daysSince + jan1Dow) / 7) + 1;
        }
        pkGo?.addEventListener('click', async ()=>{
          const raw = (pkInput?.value||'').trim();
          // Accept Wxx shorthand
          if (/^W\d{1,2}$/i.test(raw)){
            const wTarget = parseInt(raw.replace(/^[Ww]/,''),10);
            try{
              const res = await fetch(`${API_BASE_URL}/allocations.php?action=list_runs&limit=24&t=${Date.now()}`, { credentials:'include', headers:{'Accept':'application/json'} });
              const j = await res.json().catch(()=>null);
              const rows = Array.isArray(j?.data?.items) ? j.data.items : [];
              // Prefer current year, then fallback to any match
              const nowY = (new Date()).getFullYear();
              let match = rows.find(r => { const d=r.created_at?new Date(r.created_at):null; return d && d.getFullYear()===nowY && isoWeekNumber(d)===wTarget; });
              if (!match){ match = rows.find(r => { const d=r.created_at?new Date(r.created_at):null; return d && isoWeekNumber(d)===wTarget; }); }
              if (match && match.period_key){ window.location.href = `DistributeResult.html?run_id=${encodeURIComponent(String(match.run_id))}`; return; }
              // Show modal for no run found
              try{
                const mEl = document.getElementById('resultAlertModal');
                const bEl = document.getElementById('resultAlertBody');
                if (bEl) bEl.textContent = `No run found for week W${String(wTarget).padStart(2,'0')}.`;
                if (mEl){ const m = new bootstrap.Modal(mEl); m.show(); }
              }catch(_){ /* ignore */ }
              return;
            } catch(e){
              // Show modal for search failure
              try{
                const mEl = document.getElementById('resultAlertModal');
                const bEl = document.getElementById('resultAlertBody');
                if (bEl) bEl.textContent = 'Failed to search weeks.';
                if (mEl){ const m = new bootstrap.Modal(mEl); m.show(); }
              }catch(_){ /* ignore */ }
            }
            return;
          }
          // Fallback to period_key format
          if (!/^\d{4}-\d{2}-W[1-4]$/.test(raw)){
            // Show modal for invalid format
            try{
              const mEl = document.getElementById('resultAlertModal');
              const bEl = document.getElementById('resultAlertBody');
              if (bEl) bEl.textContent = 'Enter week as Wxx or YYYY-MM-Wn (e.g., W38 or 2025-09-W3).';
              if (mEl){ const m = new bootstrap.Modal(mEl); m.show(); }
            }catch(_){ /* ignore */ }
            return;
          }
          // Redirect using period_key param (not run_id)
          window.location.href = `DistributeResult.html?period_key=${encodeURIComponent(String(raw))}`;
        });

        // Dirty tracking
        let __DR_DIRTY__ = false;
        function markDirty(){ __DR_DIRTY__ = true; }
        // Mark dirty when any existing editable input changes or delete is requested
        container.addEventListener('input', (e)=>{
          const t = e.target;
          if (t && (t.classList?.contains('dr-name') || t.classList?.contains('dr-qty')) && !isLocked){
            e.preventDefault();
            return;
          }
        });
        container.addEventListener('keydown', (e)=>{
          if (isLocked && (e.target.classList?.contains('dr-name') || e.target.classList?.contains('dr-qty'))){
            e.preventDefault();
          }
        });
        container.addEventListener('click', async (e)=>{
          if (isLocked) return;
          const btn = e.target?.closest?.('.dr-del');
          if (!btn) return;
          const tr = btn.closest('tr'); if (!tr) return;
          const itemId = parseInt(tr.getAttribute('data-item-id')||'0',10)||0;
          if (itemId > 0){
            try{
              const res = await fetch(`${API_BASE_URL}/allocations.php?action=delete_item`, {
                method:'POST', credentials:'include', headers:{'Content-Type':'application/json','Accept':'application/json'},
                body: JSON.stringify({ item_id: itemId })
              });
              const j = await res.json().catch(()=>null);
              if (!res.ok || !j?.success) throw new Error(j?.error || `HTTP ${res.status}`);
              tr.remove();
            } catch(err){ showMsg(feedback, err?.message || 'Failed to delete item', 'danger'); }
          } else {
            // Unsaved row, just remove from DOM
            tr.remove();
          }
        });
        // Handlers: Add Item, Save Changes, Notify All (run)
        container.querySelectorAll('.dr-add-item').forEach(btn => {
          btn.addEventListener('click', (e)=>{
            if (isLocked) return;
            const rid = parseInt(e.currentTarget.getAttribute('data-rec')||'0',10)||0;
            const tb = container.querySelector(`tbody.dr-recipient[data-rec="${rid}"]`);
            if (!tb) return;
            // We need an allocation_id to attach new item; pick the first allocation row for this recipient
            const firstRow = tb.querySelector('tr[data-allocation-id]');
            const allocId = firstRow ? parseInt(firstRow.getAttribute('data-allocation-id')||'0',10)||0 : 0;
            const tr = document.createElement('tr');
            tr.setAttribute('data-allocation-id', String(allocId||''));
            tr.setAttribute('data-item-id', '');
            const __now = new Date();
            const __dt = `${String(__now.getDate()).padStart(2,'0')}/${String(__now.getMonth()+1).padStart(2,'0')}/${__now.getFullYear()} ${String(__now.getHours()).padStart(2,'0')}:${String(__now.getMinutes()).padStart(2,'0')}`;
            tr.innerHTML = `
              <td>Allocated</td>
              <td>${__dt}</td>
              <td><input type="text" class="form-control form-control-sm dr-name" value="" placeholder="Item name"></td>
              <td><input type="number" class="form-control form-control-sm dr-qty" value="0" min="0" step="1"></td>
              <td><button type="button" class="btn btn-sm btn-outline-danger dr-del" title="Remove"><i class="bi bi-x"></i></button></td>`;
            tb.appendChild(tr);
            tr.querySelector('.dr-name')?.addEventListener('input', markDirty);
            tr.querySelector('.dr-qty')?.addEventListener('input', markDirty);
            // delete handler is delegated globally below
            markDirty();
          });
        });
        function collectEdits(){
          const rows = container.querySelectorAll('tbody.dr-recipient tr');
          const ops = { add: [], update: [], del: [] };
          rows.forEach(tr => {
            const itemId = parseInt(tr.getAttribute('data-item-id')||'0',10)||0;
            const allocId = parseInt(tr.getAttribute('data-allocation-id')||'0',10)||0;
            const name = tr.querySelector('.dr-name')?.value?.trim() || '';
            const qty = Math.max(0, parseInt(tr.querySelector('.dr-qty')?.value||'0',10)||0);
            // rows already removed via delete handler won't be present here
            if (itemId){ ops.update.push({ item_id: itemId, item_name: name, quantity: qty }); }
            else if (allocId && name && qty>0){ ops.add.push({ allocation_id: allocId, item_name: name, quantity: qty }); }
          });
          return ops;
        }

        document.getElementById('saveChangesBtn')?.addEventListener('click', async ()=>{
          if (isLocked) return;
          try{
            const ops = collectEdits();
            if (!ops.add.length && !ops.update.length && !ops.del.length){ showMsg(feedback, 'No changes to save.', 'secondary'); return; }
            let ok=0, fail=0;
            for (const a of ops.add){
              const res = await fetch(`${API_BASE_URL}/allocations.php?action=add_item`, { method:'POST', credentials:'include', headers:{'Content-Type':'application/json','Accept':'application/json'}, body: JSON.stringify(a) });
              const j = await res.json().catch(()=>null); if (res.ok && j?.success) ok++; else fail++;
            }
            for (const u of ops.update){
              const res = await fetch(`${API_BASE_URL}/allocations.php?action=update_item`, { method:'PATCH', credentials:'include', headers:{'Content-Type':'application/json','Accept':'application/json'}, body: JSON.stringify(u) });
              const j = await res.json().catch(()=>null); if (res.ok && j?.success) ok++; else fail++;
            }
            for (const d of ops.del){
              const res = await fetch(`${API_BASE_URL}/allocations.php?action=delete_item`, { method:'POST', credentials:'include', headers:{'Content-Type':'application/json','Accept':'application/json'}, body: JSON.stringify(d) });
              const j = await res.json().catch(()=>null); if (res.ok && j?.success) ok++; else fail++;
            }
            // Success feedback via modal instead of inline alert
            try{
              const mEl = document.getElementById('resultAlertModal');
              const bEl = document.getElementById('resultAlertBody');
              if (bEl) bEl.textContent = fail ? `Saved ${ok} change${ok!==1?'s':''}. Failed: ${fail}.` : `Saved ${ok} change${ok!==1?'s':''}.`;
              if (mEl){ const m = new bootstrap.Modal(mEl); m.show(); }
            }catch(_){ /* ignore */ }
            if (fail === 0){ __DR_DIRTY__ = false; }
            // Reload to reflect new item IDs after short delay
            setTimeout(()=>window.location.reload(), 900);
          } catch(e){ showMsg(feedback, e?.message || 'Failed to save changes', 'danger'); }
        });

        async function sendNotificationsForRun(){
          // Iterate recipients by tbody markers and post a concise notification
          const bodies = container.querySelectorAll('tbody.dr-recipient[data-rec]');
          for (const tb of bodies){
            const rid = parseInt(tb.getAttribute('data-rec')||'0',10)||0; if (!rid) continue;
            const parts = [];
            tb.querySelectorAll('tr').forEach(tr => {
              const name = tr.querySelector('.dr-name')?.value?.trim() || '';
              const qty = tr.querySelector('.dr-qty')?.value || '';
              if (name && qty){ parts.push(`${qty}x ${name}`); }
            });
            const msg = parts.length ? `You have been allocated items. Check your Received Items. Items: ${parts.slice(0,6).join(', ')}${parts.length>6?'…':''}` : 'You have been allocated items. Check your Received Items.';
            try{
              await fetch(`${API_BASE_URL}/notifications.php?action=create`, {
                method:'POST', credentials:'include', headers:{'Content-Type':'application/json','Accept':'application/json'},
                body: JSON.stringify({ user_id: rid, type: 'allocation_ready', message: msg })
              });
            } catch(_){ /* ignore per-recipient failure */ }
          }
        }

        document.getElementById('notifyRunBtn')?.addEventListener('click', async ()=>{
          if (isLocked) return;
          const effectiveRunId = (runId || window.__DR_RESOLVED_RUN_ID__ || 0);
          if (__DR_DIRTY__){
            try{ const m = new bootstrap.Modal(document.getElementById('dirtyModal')); m.show(); }catch(_){ /* fallback ignored */ }
            return;
          }
          if (!effectiveRunId){ showMsg(feedback, 'Run not resolved. Load by Week (Wxx) first.', 'danger'); return; }
          try{
            const res = await fetch(`${API_BASE_URL}/allocations.php?action=notify_run`, {
              method:'POST', credentials:'include', headers:{'Content-Type':'application/json','Accept':'application/json'},
              body: JSON.stringify({ run_id: effectiveRunId })
            });
            const j = await res.json().catch(()=>null);
            if (!res.ok || !j?.success) throw new Error(j?.error || `HTTP ${res.status}`);
            await sendNotificationsForRun();
            // Success feedback via modal
            try{
              const mEl = document.getElementById('resultAlertModal');
              const bEl = document.getElementById('resultAlertBody');
              if (bEl) bEl.textContent = 'Recipients notified.';
              if (mEl){ const m = new bootstrap.Modal(mEl); m.show(); }
            }catch(_){ /* ignore */ }
            document.getElementById('notifyRunBtn')?.classList.add('d-none');
            // Lock everything
            isLocked = true;
            try { localStorage.setItem(LOCK_KEY, 'true'); } catch(_) {}
            applyLock();
          } catch(e){ showMsg(feedback, e?.message || 'Failed to notify', 'danger'); }
        });

        // (Cancel Run listener removed by request)

        // Dirty modal actions
        document.getElementById('dirtySaveNowBtn')?.addEventListener('click', ()=>{
          try{
            document.getElementById('dirtyModal')?.querySelector('[data-bs-dismiss="modal"]')?.click();
            document.getElementById('saveChangesBtn')?.click();
          } catch(_){ /* ignore */ }
        });
      })();
