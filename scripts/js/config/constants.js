(function(){
  try{
    if (!window.APP_VERSION) window.APP_VERSION = '20250925';
    if (!window.API_BASE_URL) window.API_BASE_URL = '/Capstone%20Project/php/api';
    // Set this to the actual recipient_id of the Foodbank (must exist in Users as an approved recipient)
    if (typeof window.FOOD_BANK_RECIPIENT_ID === 'undefined') window.FOOD_BANK_RECIPIENT_ID = 1;
  }catch(_){ /* ignore */ }
})();
