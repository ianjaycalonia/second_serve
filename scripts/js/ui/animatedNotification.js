  document.addEventListener("DOMContentLoaded", () => {
    const bellImg = document.querySelector('.bell-icon');
    if (!bellImg) return;

    const gifSrc = bellImg.getAttribute('src');
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const tempImg = new Image();
    tempImg.src = gifSrc;

    // On load → freeze the first frame initially
    tempImg.onload = () => {
      canvas.width = tempImg.width;
      canvas.height = tempImg.height;
      ctx.drawImage(tempImg, 0, 0, tempImg.width, tempImg.height);
      bellImg.src = canvas.toDataURL("image/png"); // show static first frame
    };

    // Function to freeze current GIF frame
    function freezeBell() {
      tempImg.src = gifSrc;
      tempImg.onload = () => {
        ctx.drawImage(tempImg, 0, 0, tempImg.width, tempImg.height);
        bellImg.src = canvas.toDataURL("image/png");
      };
    }

    // Function to play the bell GIF animation
    function playBell() {
      bellImg.src = gifSrc + '?t=' + new Date().getTime(); // reload to restart animation
    }

    // --- Hook into your notification update system ---
    // When the render() function updates notifications, run this check
    const observer = new MutationObserver(() => {
      const badge = document.getElementById('notificationsBadge');
      const unread = badge && badge.textContent && parseInt(badge.textContent) > 0;
      if (unread) {
        playBell(); // has unread → play animation
      } else {
        freezeBell(); // none → freeze visually
      }
    });

    // Observe badge changes (text or visibility)
    const badgeEl = document.getElementById('notificationsBadge');
    if (badgeEl) {
      observer.observe(badgeEl, { childList: true, characterData: true, subtree: true });
    }
  });
