document.addEventListener("DOMContentLoaded", () => {
  // Animate from previous to target number
  function animateCountUp(element, target, duration = 1000) {
    const prev = parseFloat(element.dataset.prevValue || "0");
    const start = Number.isFinite(prev) ? prev : 0;
    const end = Number.isFinite(target) ? target : 0;

    if (start === end) return; // skip if same number

    const startTime = performance.now();
    element.dataset.animating = "true"; // mark as animating

    function update(currentTime) {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const value = start + (end - start) * progress;
      element.textContent = Math.round(Math.max(0, value)).toLocaleString();

      if (progress < 1) {
        requestAnimationFrame(update);
      } else {
        element.dataset.prevValue = end;
        element.dataset.animating = "false";
      }
    }

    requestAnimationFrame(update);
  }

  // Watch for number changes on all metric-number elements
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      const el = mutation.target;

      if (
        mutation.type === "childList" &&
        el.classList.contains("metric-number")
      ) {
        // Prevent reacting to its own animation changes
        if (el.dataset.animating === "true") continue;

        // Parse the new value safely
        const newValue = parseFloat(el.textContent.replace(/,/g, ""));
        if (!Number.isFinite(newValue) || newValue < 0) return;

        const prevValue = parseFloat(el.dataset.prevValue || "0");
        if (newValue !== prevValue) {
          animateCountUp(el, newValue);
        }
      }
    }
  });

  // Attach observer to all existing metric-number elements
  document.querySelectorAll(".metric-number").forEach((el) => {
    const val = parseFloat(el.textContent.replace(/,/g, "")) || 0;
    el.dataset.prevValue = val;
    el.dataset.animating = "false";
    observer.observe(el, { childList: true });
  });
});
