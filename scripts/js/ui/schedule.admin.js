(function(){
  'use strict';
  window.__scheduleAfterCoreInit = function(){
    try {
      if (window.SchedulePickupUI && typeof window.SchedulePickupUI.setType === 'function') {
        let defaultType = 'admin';
        if (typeof window.isFromPickup === 'function' && window.isFromPickup()) {
          defaultType = 'recipient';
        }
        window.SchedulePickupUI.setType(defaultType);
      }
    } catch(_){ }
  };
})();
