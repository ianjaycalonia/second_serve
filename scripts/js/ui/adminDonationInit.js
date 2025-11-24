(function () {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      window.AdminDonationUI &&
        window.AdminDonationUI.init &&
        window.AdminDonationUI.init();
    });
  } else {
    window.AdminDonationUI &&
      window.AdminDonationUI.init &&
      window.AdminDonationUI.init();
  }
})();
