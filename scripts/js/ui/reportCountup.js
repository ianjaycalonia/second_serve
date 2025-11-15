/* js/countup-realtime.js */
(function () {
  "use strict";

  // Animate a single element from its current number to a new target
  function animateNumber(el, newValue, duration = 800) {
    const startValue = parseFloat(el.textContent.replace(/,/g, "")) || 0;
    const endValue = Number(newValue) || 0;
    const startTime = performance.now();

    function easeOutCubic(t) {
      return 1 - Math.pow(1 - t, 3);
    }

    function frame(now) {
      const progress = Math.min(1, (now - startTime) / duration);
      const value = startValue + (endValue - startValue) * easeOutCubic(progress);
      el.textContent = value.toLocaleString(undefined, { maximumFractionDigits: 2 });
      if (progress < 1) requestAnimationFrame(frame);
    }

    requestAnimationFrame(frame);
  }

  // Observe elements for real-time value updates
  function observeCountUpElements() {
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (
          mutation.type === "childList" &&
          mutation.target.classList.contains("count-number")
        ) {
          const el = mutation.target;
          const newValue = parseFloat(el.textContent.replace(/,/g, "")) || 0;
          animateNumber(el, newValue);
        }
      });
    });

    document.querySelectorAll(".count-number").forEach((el) => {
      observer.observe(el, { childList: true });
    });
  }

  document.addEventListener("DOMContentLoaded", observeCountUpElements);
})();
