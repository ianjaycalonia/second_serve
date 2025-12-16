// Stacked Expiry Images Viewer - Handles multiple expiry images for batches

// Helper function to get element by ID
function getEl(id) {
  return document.getElementById(id);
}

// Helper function to show "no image" message
function showNoImageMessage(titleText) {
  const modalEl = getEl("imageViewerModal");
  if (!modalEl || typeof bootstrap === "undefined" || !bootstrap.Modal) return;

  const m = bootstrap.Modal.getOrCreateInstance(modalEl);
  const img = modalEl.querySelector("#imageViewerImg");
  const info = modalEl.querySelector("#imageViewerInfo");

  if (img) {
    img.style.display = "none";
    img.src = "";
    img.alt = "";
  }

  if (info) {
    info.textContent = "No image available for this donation/batch.";
  }

  try {
    const t = modalEl.querySelector(".modal-title");
    if (t) t.textContent = `${titleText} (none available)`;
  } catch (_) { }

  m.show();
}

// Helper function to show single image
function showSingleImage(btn, src, titleText) {
  const modalEl = getEl("imageViewerModal");
  if (!modalEl || typeof bootstrap === "undefined" || !bootstrap.Modal) return;

  const m = bootstrap.Modal.getOrCreateInstance(modalEl);
  const img = modalEl.querySelector("#imageViewerImg");
  const info = modalEl.querySelector("#imageViewerInfo");

  if (!img || !info) return;

  // Reset image state
  img.style.display = "block";
  img.style.transform = "scale(1)";
  img.alt = titleText;
  info.textContent = "";

  // Set loading state
  img.src = "";
  info.textContent = "Loading...";

  try {
    const t = modalEl.querySelector(".modal-title");
    if (t) t.textContent = titleText;
  } catch (_) { }

  m.show();

  // Load the image
  const tmp = new Image();
  tmp.onload = function () {
    img.src = src;
    info.textContent = "";
  };
  tmp.onerror = function () {
    info.textContent = "Failed to load image.";
  };
  tmp.src = src;
}

// Function to display stacked expiry images for batches
function displayStackedExpiryImages(expiryImages) {
  const stackedModal = getEl("stackedExpiryModal");
  if (!stackedModal || typeof bootstrap === "undefined" || !bootstrap.Modal) return;

  const modalInstance = bootstrap.Modal.getOrCreateInstance(stackedModal);
  const modalTitle = stackedModal.querySelector(".modal-title");
  const modalBody = stackedModal.querySelector(".modal-body");

  if (modalTitle) modalTitle.textContent = `Expiry Date (${expiryImages.length} images)`;

  // Create stacked layout
  modalBody.innerHTML = `
    <div class="expiry-images-stack" style="max-height: 70vh; overflow-y: auto;">
      ${expiryImages.map((url, index) => `
        <div class="expiry-image-item mb-3 text-center">
          <div class="d-flex justify-content-between align-items-center mb-2">
            <span class="badge bg-secondary">Image ${index + 1} of ${expiryImages.length}</span>
            <button class="btn btn-sm btn-outline-primary zoom-btn" data-url="${url}">
              <i class="bi bi-zoom-in"></i> Zoom
            </button>
          </div>
          <img src="${url}" alt="Expiry Date ${index + 1}" class="img-fluid border rounded" 
               style="max-height: 300px; width: auto; cursor: pointer;" 
               onclick="window.open('${url}', '_blank')">
        </div>
      `).join('')}
    </div>
    <div class="mt-3 text-muted small">
      <i class="bi bi-info-circle"></i> Click images to view full size in new tab
    </div>
  `;

  // Add zoom functionality - use the main image viewer modal for zoomed images
  modalBody.querySelectorAll('.zoom-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const url = e.target.closest('.zoom-btn').dataset.url;

      // Close stacked modal and open main image viewer
      modalInstance.hide();

      // Wait for stacked modal to close, then open main viewer
      setTimeout(() => {
        showSingleImage(null, url, "Expiry Date");
      }, 300);
    });
  });

  modalInstance.show();
}

// Function to handle batched expiry images (multiple images case)
async function handleBatchedExpiryImages(btn) {
  const batch = btn.getAttribute("data-batch") || "";
  const id = btn.getAttribute("data-id") || "";
  const originalHtml = btn.innerHTML;

  // 1. Immediate Feedback: Set Spinner
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>';

  try {
    // Fetch expiry images
    let expiryImages = [];

    // Try to get expiry images from button data attribute first
    const expiryImagesAttr = btn.getAttribute("data-expiry-images");
    if (expiryImagesAttr) {
      try {
        expiryImages = JSON.parse(expiryImagesAttr);
      } catch (e) { }
    }

    // Helper to extract best image from an item object
    const getFromItem = (it) => {
      if (!it) return null;
      if (it.expiry_date_images && it.expiry_date_images.length > 0) return it.expiry_date_images;
      if (it.expiry_date_image_url) return [it.expiry_date_image_url];
      if (it.receipt_full_url) return [it.receipt_full_url];
      if (it.image_full_url) return [it.image_full_url];
      if (it.image_url) return [it.image_url];
      return null;
    };

    // If no expiry images from button, try the main donation data (Cache)
    if (expiryImages.length === 0 && (batch || id)) {
      try {
        if (batch && donationCache.byBatch.has(batch)) {
          const arr = donationCache.byBatch.get(batch) || [];
          // Try to find ANY item with ANY useful image
          const any = arr.find((it) => getFromItem(it));
          const found = getFromItem(any);
          if (found) expiryImages = found;
        } else if (id && donationCache.byId.has(String(id))) {
          const it = donationCache.byId.get(String(id));
          const found = getFromItem(it);
          if (found) expiryImages = found;
        }
      } catch (_) { }
    }

    // OPTIMIZATION: If we have ID, prefer fetchDonationDetail (Fast) over fetchAdminList (Slow)
    // This handles the "Single" item case efficiently.
    if (expiryImages.length === 0 && id) {
      try {
        const Api = window.AdminDonationApi;
        if (Api) {
          const row = await Api.fetchDonationDetail(id);
          const found = getFromItem(row);
          if (found) expiryImages = found;
        }
      } catch (e) { }
    }

    // Only fallback to fetchAdminList (Slow) if we strictly rely on batch_id and no ID was available or successful
    if (expiryImages.length === 0 && batch) {
      try {
        const Api = window.AdminDonationApi;
        if (Api) {
          const items = await Api.fetchAdminList();
          const any = items.find((it) => it.batch_id === batch && getFromItem(it));
          const found = getFromItem(any);
          if (found) expiryImages = found;
        }
      } catch (e) { }
    }

    // Handle the expiry images
    if (expiryImages.length > 1) {
      displayStackedExpiryImages(expiryImages);
    } else if (expiryImages.length === 1) {
      showSingleImage(btn, expiryImages[0], "Expiry Date");
    } else {
      showNoImageMessage("Expiry Date");
    }

  } finally {
    // Restore button state
    btn.innerHTML = originalHtml;
    btn.disabled = false;
  }
}
