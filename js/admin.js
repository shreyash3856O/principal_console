/**
 * Admin Console Logic for Principal's Live Notice Board
 */

import { verifyPasscode, updatePasscode, compressImage, showToast } from './utils.js';
import { initStore, subscribeToBoard, updateBoard, clearBoard } from './realtime-store.js';

// Application State
let currentImages = [];
let isUnlocked = false;

document.addEventListener('DOMContentLoaded', () => {
  const { isCloudActive, isFirebaseActive } = initStore();
  updateSyncBadge(isCloudActive, isFirebaseActive);

  initTheme();
  setupThemeToggle();
  setupPasscodeGate();
  setupCloudModal();
  setupFormListeners();
  setupDropzone();
  setupRealtimePreview();
});

/**
 * Dark Mode Theme Initialization & Toggle
 * Persists preference in localStorage. Only applies to Admin Console.
 */
function initTheme() {
  const savedTheme = localStorage.getItem('admin_theme') || 'light';
  document.documentElement.setAttribute('data-theme', savedTheme);
  updateThemeButtonText(savedTheme);
}

function setupThemeToggle() {
  const toggleBtn = document.getElementById('themeToggleBtn');
  if (!toggleBtn) return;

  toggleBtn.addEventListener('click', () => {
    const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    
    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('admin_theme', newTheme);
    updateThemeButtonText(newTheme);
    showToast(`Switched to ${newTheme === 'dark' ? 'Dark' : 'Light'} Mode`, 'info');
  });
}

function updateThemeButtonText(theme) {
  const toggleBtn = document.getElementById('themeToggleBtn');
  if (!toggleBtn) return;
  if (theme === 'dark') {
    toggleBtn.innerHTML = '☀️ Light Mode';
  } else {
    toggleBtn.innerHTML = '🌙 Dark Mode';
  }
}

/**
 * Passcode Auth Gate Setup
 */
function setupPasscodeGate() {
  const modal = document.getElementById('passcodeModal');
  const input = document.getElementById('passcodeInput');
  const unlockBtn = document.getElementById('unlockBtn');
  const errorMsg = document.getElementById('passcodeError');
  const lockBtn = document.getElementById('lockConsoleBtn');
  const changePasscodeBtn = document.getElementById('changePasscodeBtn');

  // Check if session is already unlocked
  if (sessionStorage.getItem('admin_unlocked') === 'true') {
    isUnlocked = true;
    modal.style.display = 'none';
  } else {
    modal.style.display = 'flex';
    setTimeout(() => input.focus(), 100);
  }

  const handleUnlock = () => {
    const code = input.value.trim();
    if (verifyPasscode(code)) {
      isUnlocked = true;
      sessionStorage.setItem('admin_unlocked', 'true');
      modal.style.display = 'none';
      errorMsg.style.display = 'none';
      input.value = '';
      showToast('Welcome Principal! Console Unlocked.', 'success');
    } else {
      errorMsg.textContent = 'Incorrect passcode. Please try again.';
      errorMsg.style.display = 'block';
      input.value = '';
      input.focus();
    }
  };

  unlockBtn.addEventListener('click', handleUnlock);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleUnlock();
  });

  if (lockBtn) {
    lockBtn.addEventListener('click', () => {
      sessionStorage.removeItem('admin_unlocked');
      isUnlocked = false;
      modal.style.display = 'flex';
      input.focus();
      showToast('Console Locked', 'info');
    });
  }

  if (changePasscodeBtn) {
    changePasscodeBtn.addEventListener('click', () => {
      const oldCode = prompt('Enter CURRENT passcode:');
      if (oldCode === null) return;
      const newCode = prompt('Enter NEW passcode (min 4 chars):');
      if (newCode === null) return;

      const res = updatePasscode(oldCode, newCode);
      if (res.success) {
        showToast(res.message, 'success');
      } else {
        showToast(res.message, 'error');
      }
    });
  }
}

/**
 * Form Inputs & Live Preview bindings
 */
function setupFormListeners() {
  const titleInput = document.getElementById('noticeTitle');
  const messageInput = document.getElementById('noticeMessage');
  const postBtn = document.getElementById('postBtn');
  const clearBtn = document.getElementById('clearBtn');

  // Live input preview updates
  titleInput.addEventListener('input', updateLivePreviewFromForm);
  messageInput.addEventListener('input', updateLivePreviewFromForm);

  // Post Announcement Action
  postBtn.addEventListener('click', async () => {
    const title = titleInput.value.trim();
    const message = messageInput.value.trim();

    // Edge case validation
    if (!title && !message && currentImages.length === 0) {
      showToast('Please enter a Title, Message, or upload at least one image before posting.', 'error');
      return;
    }

    postBtn.disabled = true;
    postBtn.innerHTML = '⌛ Pushing Live...';

    try {
      await updateBoard({
        title,
        message,
        images: currentImages
      });

      showToast('Posted! The display board updated instantly.', 'success');
    } catch (err) {
      console.error('Post error:', err);
      showToast('Failed to post announcement: ' + (err.message || 'Unknown error'), 'error');
    } finally {
      postBtn.disabled = false;
      postBtn.innerHTML = '🚀 Post to Board Live';
    }
  });

  // Clear Board Action
  clearBtn.addEventListener('click', async () => {
    if (!confirm('Are you sure you want to clear the notice board? The display will revert to the empty state.')) {
      return;
    }

    clearBtn.disabled = true;
    try {
      await clearBoard();
      
      // Clear form inputs
      titleInput.value = '';
      messageInput.value = '';
      currentImages = [];
      renderImagePreviews();
      updateLivePreviewFromForm();

      showToast('Board cleared! TV Display restored to calm empty state.', 'info');
    } catch (err) {
      showToast('Failed to clear board: ' + err.message, 'error');
    } finally {
      clearBtn.disabled = false;
    }
  });
}

/**
 * Image Upload & Drag-and-Drop Area
 */
function setupDropzone() {
  const dropzone = document.getElementById('imageDropzone');
  const fileInput = document.getElementById('fileInput');

  dropzone.addEventListener('click', () => fileInput.click());

  ['dragenter', 'dragover'].forEach(eventName => {
    dropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.add('drag-over');
    });
  });

  ['dragleave', 'drop'].forEach(eventName => {
    dropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.remove('drag-over');
    });
  });

  dropzone.addEventListener('drop', (e) => {
    const files = e.dataTransfer.files;
    handleImageFiles(files);
  });

  fileInput.addEventListener('change', (e) => {
    handleImageFiles(e.target.files);
    fileInput.value = ''; // Reset input
  });
}

async function handleImageFiles(files) {
  const validFiles = Array.from(files).filter(f => f.type.startsWith('image/'));
  if (validFiles.length === 0) {
    showToast('Please select valid image files (JPG, PNG, WebP).', 'error');
    return;
  }

  showToast(`Processing ${validFiles.length} image(s)...`, 'info', 2000);

  for (const file of validFiles) {
    try {
      // Compress client side to base64
      const compressedBase64 = await compressImage(file, 1280, 0.82);
      currentImages.push(compressedBase64);
    } catch (err) {
      console.error('Image processing error:', err);
      showToast(`Failed to process image: ${file.name}`, 'error');
    }
  }

  renderImagePreviews();
  updateLivePreviewFromForm();
}

function renderImagePreviews() {
  const grid = document.getElementById('previewsGrid');
  grid.innerHTML = '';

  currentImages.forEach((imgSrc, idx) => {
    const thumb = document.createElement('div');
    thumb.className = 'preview-thumb';
    thumb.innerHTML = `
      <img src="${imgSrc}" alt="Upload preview ${idx + 1}" />
      <button type="button" class="remove-thumb-btn" title="Remove image">&times;</button>
    `;

    thumb.querySelector('.remove-thumb-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      currentImages.splice(idx, 1);
      renderImagePreviews();
      updateLivePreviewFromForm();
    });

    grid.appendChild(thumb);
  });
}

/**
 * Live Preview Side-Panel Sync
 */
function setupRealtimePreview() {
  // Subscribe to current stored notice board data to prefill form if empty
  subscribeToBoard((boardData) => {
    const titleInput = document.getElementById('noticeTitle');
    const messageInput = document.getElementById('noticeMessage');

    // Only populate form if fields are currently untouched
    if (boardData && boardData.active && !titleInput.value && !messageInput.value && currentImages.length === 0) {
      titleInput.value = boardData.title || '';
      messageInput.value = boardData.message || '';
      if (Array.isArray(boardData.images)) {
        currentImages = [...boardData.images];
        renderImagePreviews();
      }
      updateLivePreviewFromForm();
    }
  });
}

function updateLivePreviewFromForm() {
  const title = document.getElementById('noticeTitle').value.trim();
  const message = document.getElementById('noticeMessage').value.trim();

  const previewEmpty = document.getElementById('prevEmptyState');
  const previewContent = document.getElementById('prevActiveContent');
  const previewImage = document.getElementById('prevImage');
  const previewImageBgBlur = document.getElementById('prevImageBgBlur');
  const previewTextOnlyFallback = document.getElementById('prevTextOnlyFallback');
  const previewTitleOnly = document.getElementById('prevTitleOnly');
  const previewBodyOnly = document.getElementById('prevBodyOnly');

  const previewTickerBar = document.getElementById('prevTickerBar');
  const previewTickerTrack = document.getElementById('prevTickerTrack');

  const hasText = !!(title || message);
  const hasImages = currentImages.length > 0;
  const hasContent = hasText || hasImages;

  if (!hasContent) {
    previewEmpty.style.display = 'flex';
    previewContent.style.display = 'none';
    if (previewTickerBar) previewTickerBar.style.display = 'none';
  } else {
    previewEmpty.style.display = 'none';
    previewContent.style.display = 'block';

    // 1. Ticker Banner Preview
    if (hasText && previewTickerBar && previewTickerTrack) {
      previewTickerBar.style.display = 'flex';
      const textString = title ? `📢 ${title.toUpperCase()} — ${message}` : `📢 ${message}`;
      previewTickerTrack.textContent = `${textString}          ${textString}`;
    } else {
      if (previewTickerBar) previewTickerBar.style.display = 'none';
    }

    // 2. Main Landscape Image Canvas Preview
    if (hasImages) {
      previewImage.style.display = 'block';
      previewImageBgBlur.style.display = 'block';
      previewTextOnlyFallback.style.display = 'none';

      previewImage.src = currentImages[0];
      previewImageBgBlur.src = currentImages[0];
    } else {
      previewImage.style.display = 'none';
      previewImageBgBlur.style.display = 'none';
      previewTextOnlyFallback.style.display = 'block';

      previewTitleOnly.textContent = title || 'Official Announcement';
      previewBodyOnly.textContent = message || '';
    }
  }
}

function updateSyncBadge(isCloudActive, isFirebaseActive) {
  const badge = document.getElementById('syncStatusBadge');
  const banner = document.getElementById('configBanner');

  if (isFirebaseActive) {
    if (badge) {
      badge.className = 'badge badge-live';
      badge.textContent = '🔥 Firebase Firestore Active';
    }
    if (banner) banner.style.display = 'none';
  } else if (isCloudActive) {
    if (badge) {
      badge.className = 'badge badge-live';
      badge.textContent = '🌐 Multi-Device Cloud Sync Active';
    }
    if (banner) banner.style.display = 'none';
  } else {
    if (badge) {
      badge.className = 'badge badge-demo';
      badge.textContent = 'Local Mode';
    }
    if (banner) banner.style.display = 'flex';
  }
}

/**
 * Cloud Setup Modal Setup
 */
function setupCloudModal() {
  const openBtn = document.getElementById('cloudSetupBtn');
  const closeBtn = document.getElementById('closeCloudModalBtn');
  const modal = document.getElementById('cloudModal');
  const form = document.getElementById('cloudConfigForm');
  const clearBtn = document.getElementById('clearCloudConfigBtn');

  if (!modal) return;

  const apiKeyInput = document.getElementById('cfgApiKey');
  const projectIdInput = document.getElementById('cfgProjectId');
  const authDomainInput = document.getElementById('cfgAuthDomain');

  // Load current saved credentials if existing
  const populateInputs = () => {
    try {
      const saved = localStorage.getItem('custom_firebase_config');
      if (saved) {
        const cfg = JSON.parse(saved);
        if (apiKeyInput) apiKeyInput.value = cfg.apiKey || '';
        if (projectIdInput) projectIdInput.value = cfg.projectId || '';
        if (authDomainInput) authDomainInput.value = cfg.authDomain || '';
      }
    } catch (e) {}
  };

  if (openBtn) {
    openBtn.addEventListener('click', () => {
      populateInputs();
      modal.style.display = 'flex';
    });
  }

  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      modal.style.display = 'none';
    });
  }

  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const apiKey = apiKeyInput ? apiKeyInput.value.trim() : '';
      const projectId = projectIdInput ? projectIdInput.value.trim() : '';
      const authDomain = authDomainInput ? authDomainInput.value.trim() : `${projectId}.firebaseapp.com`;

      if (!apiKey || !projectId) {
        showToast('API Key and Project ID are required.', 'error');
        return;
      }

      const cfg = {
        apiKey,
        projectId,
        authDomain,
        storageBucket: `${projectId}.appspot.com`,
        messagingSenderId: '123456789',
        appId: '1:123456789:web:app'
      };

      localStorage.setItem('custom_firebase_config', JSON.stringify(cfg));
      showToast('Firebase Credentials Saved! Connecting to Cloud...', 'success');
      modal.style.display = 'none';
      setTimeout(() => location.reload(), 1000);
    });
  }

  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      localStorage.removeItem('custom_firebase_config');
      showToast('Custom credentials reset to Public Cloud Relay Mode.', 'info');
      modal.style.display = 'none';
      setTimeout(() => location.reload(), 1000);
    });
  }
}
