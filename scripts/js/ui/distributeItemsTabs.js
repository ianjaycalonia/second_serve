(function () {
  function ensureAllocActive() {
    try {
      var allocPane = document.getElementById("di-alloc");
      var recPane = document.getElementById("di-recipients");
      var allocTab = document.getElementById("di-alloc-tab");
      var recTab = document.getElementById("di-recipients-tab");
      var active =
        allocPane &&
        allocPane.classList.contains("active") &&
        allocPane.classList.contains("show");
      if (!active) {
        if (recPane) {
          recPane.classList.remove("active", "show");
        }
        if (recTab) {
          recTab.classList.remove("active");
          recTab.setAttribute("aria-selected", "false");
        }
        if (allocPane) {
          allocPane.classList.add("active", "show");
        }
        if (allocTab) {
          allocTab.classList.add("active");
          allocTab.setAttribute("aria-selected", "true");
        }
      }
    } catch (_) {}
  }
  function onNext() {
    try {
      if (typeof buildAllocCarouselFromSelected === "function")
        buildAllocCarouselFromSelected();
    } catch (_) {}
    try {
      var allocTab = document.getElementById("di-alloc-tab");
      if (allocTab && window.bootstrap && window.bootstrap.Tab) {
        var t = window.bootstrap.Tab.getOrCreateInstance(allocTab);
        t.show();
      } else if (allocTab) {
        allocTab.click();
      }
    } catch (_) {}
    ensureAllocActive();
    try {
      if (typeof attachAllocGlobalControls === "function")
        attachAllocGlobalControls();
    } catch (_) {}
    try {
      if (typeof initAllocSelects === "function") initAllocSelects();
    } catch (_) {}
    try {
      if (typeof attachAllocateNow === "function") attachAllocateNow();
    } catch (_) {}
  }
  function bind() {
    var btn = document.getElementById("diNextTabBtn");
    if (!btn || btn.__fallbackBound) return;
    btn.__fallbackBound = true;
    btn.addEventListener("click", function (e) {
      try {
        if (e) e.preventDefault();
      } catch (_) {}
      onNext();
    });
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bind);
  } else {
    bind();
  }
})();
