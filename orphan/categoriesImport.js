(function(){
  function $(sel){ return document.querySelector(sel); }
  function showFeedback(msg, type){
    const el = $('#importCategoriesFeedback'); if (!el) return;
    el.innerHTML = msg ? `<div class="alert alert-${type} py-2 mb-0">${msg}</div>` : '';
  }
  function toTitleCase(s){
    return s.replace(/\w\S*/g, (t)=> t.charAt(0).toUpperCase() + t.slice(1).toLowerCase());
  }
  function fixTypos(s){
    let out = s;
    out = out.replace(/\bCoffe\b/gi, 'Coffee');
    out = out.replace(/\bSweetened\s*B\b/gi, 'Sweetened Beverages');
    // Normalize slashes, collapse spaces
    out = out.replace(/\s*\/\s*/g, '/');
    out = out.replace(/\s+/g, ' ').trim();
    return out;
  }
  function normalizeLabel(raw){
    if (!raw || typeof raw !== 'string') return { parent:'', child:'', canonical:'', raw_label:'' };
    let s = raw.trim();
    // Preserve common uppercase acronyms, otherwise title case
    s = fixTypos(s);
    // Split on LAST ' - ' so "Non - Food - Canned" => parent: "Non - Food", child: "Canned"
    let parent = '', child = '';
    const idx = s.lastIndexOf(' - ');
    if (idx >= 0){
      parent = s.slice(0, idx).trim();
      child = s.slice(idx + 3).trim();
    } else {
      parent = s;
    }
    // Title case words but keep slashes segments as-is
    const tc = (v)=> v.split('/').map(toTitleCase).join('/');
    parent = tc(parent);
    child  = tc(child);
    const canonical = child || parent;
    return { parent, child, canonical, raw_label: raw };
  }
  function findHeaderIndex(headers, target){
    const t = String(target).toLowerCase();
    for (let i=0;i<headers.length;i++){
      const h = String(headers[i]||'').trim().toLowerCase();
      if (h === t) return i;
    }
    // fuzzy contains
    for (let i=0;i<headers.length;i++){
      const h = String(headers[i]||'').trim().toLowerCase();
      if (h.includes('product') && h.includes('category')) return i;
      if (h === 'category') return i;
    }
    return -1;
  }
  async function upsertBulk(items){
    const url = 'php/api/categories/index.php?action=upsert_bulk&debug=1&t=' + Date.now();
    const res = await fetch(url, { method:'POST', headers:{'Content-Type':'application/json','Accept':'application/json'}, credentials:'include', body: JSON.stringify({ items }) });
    let j=null, txt='';
    try{ j = await res.json(); }catch(_){ try{ txt = await res.text(); }catch(__){} }
    if (!res.ok || !j || !j.success){
      const msg = (j && j.error) ? j.error : (txt || ('HTTP '+res.status));
      throw new Error(msg);
    }
    return j.data || {};
  }
  async function readWorkbook(file){
    return new Promise((resolve, reject)=>{
      const reader = new FileReader();
      reader.onload = function(e){
        try{
          const data = new Uint8Array(e.target.result);
          const wb = XLSX.read(data, { type:'array' });
          resolve(wb);
        } catch(err){ reject(err); }
      };
      reader.onerror = reject;
      reader.readAsArrayBuffer(file);
    });
  }
  function extractCategoriesFromWB(wb){
    const out = [];
    const sheetName = wb.SheetNames[0];
    const ws = wb.Sheets[sheetName];
    const json = XLSX.utils.sheet_to_json(ws, { header:1, blankrows:false, defval:'' });
    if (!json || !json.length) return out;
    const headers = json[0];
    const idx = findHeaderIndex(headers, 'product category');
    if (idx < 0) return out;
    for (let r=1;r<json.length;r++){
      const row = json[r]; if (!row) continue;
      const v = String(row[idx]||'').trim();
      if (!v) continue;
      const norm = normalizeLabel(v);
      out.push(norm);
    }
    return out;
  }
  function uniqByCanonicalWithRaw(list){
    const seen = new Map();
    const items = [];
    for (const it of list){
      const key = (it.parent + '>' + it.child + '|' + it.canonical).toLowerCase();
      if (!seen.has(key)) { seen.set(key, true); items.push(it); }
    }
    return items;
  }
  function bindUI(){
    const btn = $('#importCategoriesBtn');
    const inp = $('#importCategoriesInput');
    if (!btn || !inp) return;
    btn.addEventListener('click', ()=>{ inp.click(); });
    inp.addEventListener('change', async ()=>{
      const files = Array.from(inp.files||[]);
      if (!files.length){ showFeedback('No files selected.', 'secondary'); return; }
      showFeedback('Reading files…', 'info');
      try{
        let all = [];
        for (const f of files){
          const wb = await readWorkbook(f);
          const parts = extractCategoriesFromWB(wb);
          all = all.concat(parts);
        }
        if (!all.length){ showFeedback('No categories found in the selected files.', 'warning'); return; }
        // De-dup and build payload
        const unique = uniqByCanonicalWithRaw(all);
        const payload = unique.map(x=>({ raw_label:x.raw_label, parent:x.parent, child:x.child, canonical:x.canonical }));
        const res = await upsertBulk(payload);
        showFeedback(`Done. Parents: ${res.insertedParents||0}, Children: ${res.insertedChildren||0}, Aliases: ${res.aliases||0}, Existing: ${res.existing||0}.`, 'success');
      } catch(err){
        showFeedback('Import failed: ' + (err && err.message ? err.message : String(err)), 'danger');
      } finally {
        inp.value = '';
      }
    });
  }
  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', bindUI);
  } else { bindUI(); }
})();
