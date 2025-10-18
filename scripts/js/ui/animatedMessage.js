// js/letterAnimation.js
(function() {
  'use strict';

  // Cache the letter element
  const letterImg = document.querySelector('.letter-icon');
  if (!letterImg) return;

  const gifSrc = letterImg.getAttribute('src');
  let staticFrame = null;

  // Capture the first frame (for frozen state)
  const tempImg = new Image();
  tempImg.src = gifSrc;
  tempImg.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = tempImg.width;
    canvas.height = tempImg.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(tempImg, 0, 0);
    staticFrame = canvas.toDataURL('image/png');
  };

  // --- Play the letter GIF ---
  function playLetter() {
    letterImg.src = gifSrc + '?t=' + Date.now(); // force reload to replay
  }

  // --- Freeze the GIF ---
  function freezeLetter() {
    if (staticFrame) {
      letterImg.src = staticFrame;
    }
  }

  // --- Public API ---
  window.LetterAnimation = {
    update: function(totalUnread) {
      if (totalUnread > 0) {
        playLetter();
      } else {
        freezeLetter();
      }
    }
  };
})();
