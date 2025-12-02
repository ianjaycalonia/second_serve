(function(){
  'use strict';
  window.__scheduleAfterCoreInit = function(){
    try {
      if (window.SchedulePickupUI && typeof window.SchedulePickupUI.setType === 'function') {
        window.SchedulePickupUI.setType('donor');
      }
    } catch(_){ }
  };
})();
