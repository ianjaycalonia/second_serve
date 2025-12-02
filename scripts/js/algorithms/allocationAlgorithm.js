(function(){
  'use strict';
  const Allocation = {};
  let distributableFraction = 0.9;

  function toRecipientId(value){
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? String(parsed) : null;
  }

  function toRecipientIdArray(list){
    return (Array.isArray(list) ? list : [])
      .map(toRecipientId)
      .filter(id => id !== null);
  }

  function normalizeTotalItems(totalItems){
    const val = Number(totalItems);
    return Number.isFinite(val) && val > 0 ? val : 0;
  }

  // Create an in-memory allocation state for the given recipient IDs
  Allocation.createState = function(recipientIds){
    const ids = toRecipientIdArray(recipientIds);
    const itemsByRecipient = Object.create(null);
    ids.forEach(id => { itemsByRecipient[id] = []; });
    return { recipients: ids, itemsByRecipient };
  };

  // Add a single item to a specific recipient
  // item: { name: string, category?: string, qty?: number }
  Allocation.addItem = function(state, recipientId, item){
    if (!state || !state.itemsByRecipient) return false;
    const rid = toRecipientId(recipientId);
    if (!rid || !(rid in state.itemsByRecipient)) return false;
    const name = String(item?.name||'').trim();
    if (!name) return false;
    const category = String(item?.category||'').trim();
    const qty = Math.max(1, parseInt(item?.qty||1,10)||1);
    state.itemsByRecipient[rid].push({ name, category, qty });
    return true;
  };

  // Add the same item to all recipients in the state
  Allocation.addItemToAll = function(state, item){
    if (!state || !state.itemsByRecipient) return 0;
    let added = 0;
    for (const rid of Object.keys(state.itemsByRecipient)){
      if (Allocation.addItem(state, rid, item)) added++;
    }
    return added;
  };

  // Get items for recipient
  Allocation.getRecipientItems = function(state, recipientId){
    const rid = toRecipientId(recipientId);
    if (!rid) return [];
    const list = state?.itemsByRecipient?.[rid];
    return Array.isArray(list) ? list.slice() : [];
  };

  // Replace entire recipient list (e.g., when Selected changes)
  Allocation.resetRecipients = function(state, recipientIds){
    if (!state) return Allocation.createState(recipientIds);
    const ids = toRecipientIdArray(recipientIds);
    return Allocation.createState(ids);
  };

  // Utility: largest remainder rounding to hit an exact integer total
  function largestRemainderRound(values, targetTotal){
    const n = values.length;
    if (n === 0) return [];
    const target = Math.max(0, Math.round(targetTotal || 0));
    const floors = values.map(v => Math.floor(Math.max(0, v)));
    let sum = floors.reduce((a,b)=>a+b,0);
    let remaining = Math.max(0, target - sum);
    const remainders = values.map((v,i)=> ({ i, r: v - floors[i] }));
    remainders.sort((a,b)=> b.r - a.r);
    for (let k=0; k<remainders.length && remaining>0; k++){
      floors[remainders[k].i] += 1;
      remaining--;
    }
    // If we somehow overshot (due to negative scaling etc.), trim from smallest remainders
    if (remaining < 0){
      const asc = values.map((v,i)=> ({ i, r: v - floors[i] })).sort((a,b)=> a.r - b.r);
      let need = -remaining;
      for (let k=0; k<asc.length && need>0; k++){
        if (floors[asc[k].i] > 0){ floors[asc[k].i] -= 1; need--; }
      }
    }
    return floors;
  }

  // Build a population map from recipient profile fields
  // list: Array of recipient objects as returned by Users API (joined with recipient_profiles)
  // Prefers total_residents, else male_count+female_count, else common fallbacks
  Allocation.buildPopulationMap = function(list){
    const map = new Map();
    try{
      const arr = Array.isArray(list) ? list : [];
      arr.forEach(u => {
        const id = parseInt(u.user_id||u.id,10)||0; if (!id) return;
        const totalResidents = Number(u.total_residents);
        const maleCnt = Number(u.male_count);
        const femaleCnt = Number(u.female_count);
        let pop = NaN;
        if (Number.isFinite(totalResidents) && totalResidents > 0){
          pop = totalResidents;
        } else if ((Number.isFinite(maleCnt) && maleCnt >= 0) || (Number.isFinite(femaleCnt) && femaleCnt >= 0)){
          const m = Number.isFinite(maleCnt) ? maleCnt : 0;
          const f = Number.isFinite(femaleCnt) ? femaleCnt : 0;
          const sum = m + f; if (sum > 0) pop = sum;
        }
        if (!(Number.isFinite(pop) && pop>0)){
          const candidates = [u.population, u.pop, u.beneficiaries, u.household_size, u.people, u.residents, u.members, u.population_total]
            .map(x=>Number(x))
            .filter(v=>Number.isFinite(v) && v>0);
          if (candidates.length) pop = candidates[0];
        }
        if (Number.isFinite(pop) && pop>0){ map.set(id, pop); }
      });
    } catch(_){ }
    return map;
  };

  // Map selected ids to the shape expected by allocateItems
  Allocation.recipientsWithPopulation = function(ids, popMap){
    try{
      const arr = toRecipientIdArray(ids);
      const pm = (popMap instanceof Map) ? popMap : new Map();
      return arr.map(id => ({ id, population: pm.get(Number(id)) }));
    } catch(_){ return []; }
  };

  // Core allocation algorithm per spec
  // recipients: Array<{ id: number|string, population?: number }>
  // returns: Array<{ id: string, allocation: number }>
  Allocation.allocateItems = function(totalItems, recipients){
    try{
      const recs = Array.isArray(recipients)? recipients.slice() : [];
      if (!recs.length) return [];
      const total = normalizeTotalItems(totalItems);
      const allocatable = Math.floor(total * distributableFraction);
      if (allocatable <= 0) return recs.map(r => ({ id: String(r.id), allocation: 0 }));

      // Baseline based on a fixed 10-bucket policy
      const baseline = allocatable / 10; // keep as float; scaling/rounding later

      // Partition recipients by population availability
      const withPop = [];
      const noPop = [];
      recs.forEach(r => {
        const pop = Number(r.population);
        if (Number.isFinite(pop) && pop > 0) withPop.push({ id: String(r.id), population: pop });
        else noPop.push({ id: String(r.id) });
      });

      // Average population across with-pop recipients
      let avgPop = 0;
      if (withPop.length){
        const sumPop = withPop.reduce((s,r) => s + r.population, 0);
        avgPop = sumPop / withPop.length;
      }

      // Initial raw allocations
      const raws = recs.map(r => {
        const id = String(r.id);
        const pop = Number(r.population);
        if (!(Number.isFinite(pop) && pop > 0) || avgPop === 0){
          // No population data or no average available -> baseline
          return { id, raw: baseline };
        }
        const weight = pop / avgPop; // may be <1 or >1
        return { id, raw: weight * baseline };
      });

      // Proportionally scale raw allocations to sum to allocatable
      const sumRaw = raws.reduce((s,x)=> s + x.raw, 0) || 1;
      const scale = allocatable / sumRaw;
      const scaled = raws.map(x => ({ id: x.id, val: x.raw * scale }));

      // Largest remainder rounding to integers summing to allocatable
      const values = scaled.map(x => x.val);
      const ints = largestRemainderRound(values, allocatable);

      return scaled.map((x,idx) => ({ id: x.id, allocation: ints[idx] }));
    } catch(_){
      // Fallback: equal split among recipients, floor, and adjust
      const recs = Array.isArray(recipients)? recipients.slice() : [];
      if (!recs.length) return [];
      const total = normalizeTotalItems(totalItems);
      const allocatable = Math.floor(total * distributableFraction);
      const base = allocatable / recs.length;
      const ints = largestRemainderRound(recs.map(()=>base), allocatable);
      return recs.map((r,i)=> ({ id: String(r.id), allocation: ints[i] }));
    }
  };

  Allocation.setDistributableFraction = function (fraction) {
    try {
      const val = Number(fraction);
      if (!Number.isFinite(val)) return distributableFraction;
      const clamped = Math.min(Math.max(val, 0), 1);
      distributableFraction = clamped;
      return distributableFraction;
    } catch (_) {
      return distributableFraction;
    }
  };

  Allocation.getDistributableFraction = function () {
    return distributableFraction;
  };

  try { window.Allocation = Object.assign({}, window.Allocation||{}, Allocation); } catch(_){ }
})();
