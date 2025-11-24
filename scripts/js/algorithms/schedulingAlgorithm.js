(function(){
  'use strict';
  const Scheduling = {};
  const CANCELLED_STATUSES = new Set(['cancelled', 'canceled', 'declined', 'no show']);

  function toRecipientIdArray(value){
    return (Array.isArray(value) ? value : [])
      .map(v => Number.parseInt(v, 10))
      .filter(Number.isFinite);
  }

  function normalizeWeekEntries(entry){
    return toRecipientIdArray(entry).map(Number);
  }

  function buildWeekMap(source){
    return {
      W1: normalizeWeekEntries(source?.W1),
      W2: normalizeWeekEntries(source?.W2),
      W3: normalizeWeekEntries(source?.W3),
      W4: normalizeWeekEntries(source?.W4),
    };
  }

  // Normalize extended weeks plan (weeks_ex) into a simple W1..W4 map of recipient IDs
  Scheduling.normalizeWeeksExToMap = function(weeksEx){
    const map = { W1: [], W2: [], W3: [], W4: [] };
    if (!weeksEx) return map;
    if (!Array.isArray(weeksEx)) {
      return buildWeekMap(weeksEx);
    }
    if (weeksEx.length && typeof weeksEx[0] === 'object' && !Array.isArray(weeksEx[0])){
      weeksEx.forEach(w => {
        const idx = Number(w.week_index || w.index || w.week || 0);
        const key = idx===1?'W1':idx===2?'W2':idx===3?'W3':idx===4?'W4':null;
        if (key){ map[key] = toRecipientIdArray(w.recipient_ids || w.ids); }
      });
    } else if (weeksEx.length && Array.isArray(weeksEx[0])){
      const keys = ['W1','W2','W3','W4'];
      keys.forEach((k,i)=>{ map[k] = toRecipientIdArray(weeksEx[i] || []); });
    }
    return map;
  };

  // Derive a Set of cancelled recipient_ids from a list of allocation items
  // items: [{ recipient_id, status, ... }]
  Scheduling.computeCancelledSet = function(items){
    try{
      const out = new Set();
      (Array.isArray(items)?items:[]).forEach(a => {
        const id = parseInt(a?.recipient_id,10)||0; if (!id) return;
        const s = String(a?.status||'').trim().toLowerCase();
        if (CANCELLED_STATUSES.has(s)) out.add(id);
      });
      return out;
    } catch(_){ return new Set(); }
  };

  // One-shot planner: normalize weeks, resolve current bucket, and pick Selected ids
  // weeksEx: server plan (various shapes)
  // cancelledIds: Array<number> of carryovers (optional)
  // baseDate: optional Date used to resolve the current bucket
  Scheduling.planForAllocation = function(weeksEx, cancelledIds, baseDate){
    const weeksMap = Scheduling.normalizeWeeksExToMap(weeksEx);
    const currentBucket = baseDate
      ? Scheduling.getCurrentBucketFromDate(baseDate)
      : Scheduling.getCurrentBucketNow();
    const cancelledSet = new Set(Array.isArray(cancelledIds)? cancelledIds.map(v=>parseInt(v,10)).filter(Number.isFinite) : []);
    const selectedIds = Scheduling.buildSelectedIds(weeksMap, cancelledSet, { currentBucket });
    return { weeksMap, currentBucket, selectedIds };
  };

  // Build a full ordered candidate list (no cap) by priority rules
  // Priority: cancelledSet first, then current bucket, then next buckets wrap-around
  Scheduling.planOrder = function(weeksMap, cancelledSet, currentBucket){
    const map = buildWeekMap(weeksMap || {});
    const cur = currentBucket || Scheduling.getCurrentBucketNow();
    const order = ['W1','W2','W3','W4'];
    const curIdx = ({W1:0,W2:1,W3:2,W4:3})[cur] ?? 0;
    const nextOrder = [ order[(curIdx+1)%4], order[(curIdx+2)%4], order[(curIdx+3)%4] ];
    const out=[]; const push=(id)=>{ if(!out.includes(id)) out.push(id); };
    const carry = cancelledSet instanceof Set ? Array.from(cancelledSet) : [];
    carry.forEach(id=>push(id));
    map[cur].forEach(id=>push(id));
    nextOrder.forEach(b=> map[b].forEach(id=>{ if (cur!=='W1' && b==='W1' && (cancelledSet instanceof Set ? !cancelledSet.has(id) : true)) { /* keep rule symmetry */ } push(id); }));
    return out;
  };

  // Replace recipients in the current Selected list when some cancel or complete
  // Args:
  // - selectedIds: current array of selected recipient IDs
  // - weeksMap: normalized weeks map
  // - options: { cancelledSet?: Set, completedSet?: Set, currentBucket?: 'W1'|'W2'|'W3'|'W4', targetCount?: number }
  // Returns a new array of selected IDs of length <= targetCount, filled by priority order
  Scheduling.replaceSelected = function(selectedIds, weeksMap, options){
    const target = Math.max(1, parseInt(options?.targetCount||10,10)||10);
    const cancelled = options?.cancelledSet instanceof Set ? options.cancelledSet : new Set();
    const completed = options?.completedSet instanceof Set ? options.completedSet : new Set();
    const currentBucket = options?.currentBucket || Scheduling.getCurrentBucketNow();
    const exclusions = new Set([...(cancelled||[]), ...(completed||[])]);
    // keep existing ones not excluded
    const remaining = (Array.isArray(selectedIds)?selectedIds:[])
      .map(v=>parseInt(v,10)).filter(Number.isFinite)
      .filter(id => !exclusions.has(id));
    if (remaining.length >= target) return remaining.slice(0, target);
    // build candidate order and fill
    const order = Scheduling.planOrder(weeksMap, cancelled, currentBucket)
      .filter(id => !exclusions.has(id) && !remaining.includes(id));
    const need = target - remaining.length;
    const fillers = order.slice(0, need);
    return remaining.concat(fillers);
  };

  // Week bucket by fixed ranges 1-7 W1, 8-14 W2, 15-21 W3, 22+ W4
  Scheduling.weekIndexForDate = function(d){
    const day = d.getDate(); return day<=7?1:day<=14?2:day<=21?3:4;
  };
  Scheduling.getCurrentBucketFromDate = function(date){
    const idx = Scheduling.weekIndexForDate(date||new Date());
    return idx===1?'W1':idx===2?'W2':idx===3?'W3':'W4';
  };
  Scheduling.getCurrentBucketNow = function(){ return Scheduling.getCurrentBucketFromDate(new Date()); };

  // Period key helpers
  Scheduling.getPeriodKeyFromDate = function(date){
    const d = new Date(date||new Date());
    const mm = String(d.getMonth()+1).padStart(2,'0');
    const key = `W${Scheduling.weekIndexForDate(d)}`;
    return `${d.getFullYear()}-${mm}-${key}`;
  };
  Scheduling.getPreviousPeriodKeyFromDate = function(date){
    const d = new Date(date||new Date());
    let y = d.getFullYear(); let m = d.getMonth()+1; // 1..12
    let idx = Scheduling.weekIndexForDate(d) - 1;
    if (idx < 1){ idx = 4; m -= 1; if (m<1){ m=12; y-=1; } }
    return `${y}-${String(m).padStart(2,'0')}-W${idx}`;
  };

  // Build Selected deterministically: cancelled -> current week -> others (max 10)
  Scheduling.buildSelectedIds = function(weeksMap, cancelledSet, options){
    const map = buildWeekMap(weeksMap || {});
    const cur = (options?.currentBucket) || Scheduling.getCurrentBucketNow();
    const order = ['W1','W2','W3','W4'];
    const curIdx = ({W1:0,W2:1,W3:2,W4:3})[cur] ?? 0;
    const nextOrder = [ order[(curIdx+1)%4], order[(curIdx+2)%4], order[(curIdx+3)%4] ];
    const isCancelled = (id)=> (cancelledSet instanceof Set) && cancelledSet.has(id);
    const out=[]; const add=(id)=>{ if (out.length<10 && !out.includes(id) && !isCancelled(id)) out.push(id); };
    // Prefer current bucket (excluding cancelled), then subsequent buckets. Keep prior rule on W1 only when not current.
    map[cur].forEach(add);
    nextOrder.forEach(b=>{ map[b].forEach(add); });
    return out;
  };

  try { window.Scheduling = Object.assign({}, window.Scheduling||{}, Scheduling); } catch(_){}
})();
