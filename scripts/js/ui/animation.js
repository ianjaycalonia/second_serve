document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll('.card-hovered').forEach(card => {
    const img = card.querySelector('.login-icon');
    if (!img) return;

    const gifSrc = img.getAttribute('src');

    // On load: freeze the first frame (by cloning the GIF into a canvas)
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const tempImg = new Image();
    tempImg.src = gifSrc;
    tempImg.onload = () => {
      canvas.width = tempImg.width;
      canvas.height = tempImg.height;
      ctx.drawImage(tempImg, 0, 0, tempImg.width, tempImg.height);
      img.src = canvas.toDataURL("image/png"); // replace with static first frame
    };

    // When hovered → restore GIF animation
    card.addEventListener('mouseenter', () => {
      img.src = gifSrc + '?t=' + new Date().getTime(); // reload GIF
    });

    // When mouse leaves → freeze again
    card.addEventListener('mouseleave', () => {
      tempImg.src = gifSrc;
      tempImg.onload = () => {
        ctx.drawImage(tempImg, 0, 0, tempImg.width, tempImg.height);
        img.src = canvas.toDataURL("image/png");
      };
    });
  });
});
document.addEventListener("DOMContentLoaded", () => {
  // Select all links with dashboard GIF icons
  const dashboardLinks = document.querySelectorAll('.dashboard-link');

  dashboardLinks.forEach(dashboardLink => {
    const img = dashboardLink.querySelector('.dashboard-icon');
    if (!img) return;

    const gifSrc = img.getAttribute('src');

    // Create canvas to freeze GIF
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const tempImg = new Image();
    tempImg.src = gifSrc;
    tempImg.onload = () => {
      canvas.width = tempImg.width;
      canvas.height = tempImg.height;
      ctx.drawImage(tempImg, 0, 0, tempImg.width, tempImg.height);
      img.src = canvas.toDataURL("image/png"); // freeze first frame
    };

    // Hover → play GIF
    dashboardLink.addEventListener('mouseenter', () => {
      img.src = gifSrc + '?t=' + new Date().getTime(); // force reload GIF
    });

    // Mouse leaves → freeze GIF
    dashboardLink.addEventListener('mouseleave', () => {
      tempImg.src = gifSrc;
      tempImg.onload = () => {
        ctx.drawImage(tempImg, 0, 0, tempImg.width, tempImg.height);
        img.src = canvas.toDataURL("image/png");
      };
    });

    // If link is active, keep GIF playing
    if (dashboardLink.classList.contains('active')) {
      img.src = gifSrc;
    }
  });
});


