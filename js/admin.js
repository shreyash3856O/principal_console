/**
 * Admin Console Logic for Principal's Live Notice Board
 */

import { verifyPasscode, updatePasscode, compressImage, showToast } from './utils.js';
import { initStore, subscribeToBoard, updateBoard, clearBoard } from './realtime-store.js';
import { getShareableDisplayUrl } from './firebase-config.js';

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
  setupCopyDisplayLink();
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

  // Cloud upload progress events
  window.addEventListener('cloud-upload-start', () => {
    postBtn.innerHTML = '☁️ Uploading media to cloud...';
  });
  window.addEventListener('cloud-upload-success', () => {
    postBtn.innerHTML = '✅ Live on Cloud!';
    setTimeout(() => {
      postBtn.disabled = false;
      postBtn.innerHTML = '🚀 Post to Board Live';
    }, 1500);
  });
  window.addEventListener('cloud-upload-error', () => {
    postBtn.disabled = false;
    postBtn.innerHTML = '🚀 Post to Board Live';
  });

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
    postBtn.innerHTML = '⌛ Saving locally...';

    try {
      await updateBoard({
        title,
        message,
        images: currentImages,
        imageDuration: parseInt(document.getElementById('imageDurationSelect').value, 10),
        videoLoops: parseInt(document.getElementById('videoLoopsSelect').value, 10),
        textDuration: parseInt(document.getElementById('textDurationSelect').value, 10)
      });

      // If no cloud upload was needed (text/no media), reset button manually
      if (postBtn.innerHTML === '⌛ Saving locally...') {
        showToast('Posted! The display board updated instantly.', 'success');
        postBtn.disabled = false;
        postBtn.innerHTML = '🚀 Post to Board Live';
      } else {
        showToast('Posted! Media uploading to cloud...', 'success', 3000);
      }
    } catch (err) {
      console.error('Post error:', err);
      showToast('Failed to post announcement: ' + (err.message || 'Unknown error'), 'error');
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
  // Image Dropzone
  const imageDropzone = document.getElementById('imageDropzone');
  const imageFileInput = document.getElementById('imageFileInput');

  imageDropzone.addEventListener('click', () => imageFileInput.click());

  ['dragenter', 'dragover'].forEach(eventName => {
    imageDropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      imageDropzone.classList.add('drag-over');
    });
  });

  ['dragleave', 'drop'].forEach(eventName => {
    imageDropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      imageDropzone.classList.remove('drag-over');
    });
  });

  imageDropzone.addEventListener('drop', (e) => {
    const files = e.dataTransfer.files;
    handleFiles(files);
  });

  imageFileInput.addEventListener('change', (e) => {
    handleFiles(e.target.files);
    imageFileInput.value = ''; 
  });

  // Video Dropzone
  const videoDropzone = document.getElementById('videoDropzone');
  const videoFileInput = document.getElementById('videoFileInput');

  videoDropzone.addEventListener('click', () => videoFileInput.click());

  ['dragenter', 'dragover'].forEach(eventName => {
    videoDropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      videoDropzone.classList.add('drag-over');
    });
  });

  ['dragleave', 'drop'].forEach(eventName => {
    videoDropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      videoDropzone.classList.remove('drag-over');
    });
  });

  videoDropzone.addEventListener('drop', (e) => {
    const files = e.dataTransfer.files;
    handleFiles(files);
  });

  videoFileInput.addEventListener('change', (e) => {
    handleFiles(e.target.files);
    videoFileInput.value = ''; 
  });
}

async function handleFiles(files) {
  const validFiles = Array.from(files).filter(f => f.type.startsWith('image/') || f.type === 'video/mp4');
  if (validFiles.length === 0) {
    showToast('Please select valid files (JPG, PNG, WebP, MP4).', 'error');
    return;
  }

  showToast(`Processing ${validFiles.length} file(s)...`, 'info', 2000);

  for (const file of validFiles) {
    try {
      if (file.type.startsWith('image/')) {
        const compressedBase64 = await compressImage(file, 1280, 0.82);
        currentImages.push(compressedBase64);
      } else if (file.type === 'video/mp4') {
        const reader = new FileReader();
        const base64 = await new Promise((resolve, reject) => {
          reader.onload = () => resolve(reader.result);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
        currentImages.push(base64);
      }
    } catch (err) {
      console.error('File processing error:', err);
      showToast(`Failed to process file: ${file.name}`, 'error');
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
    
    const isVideo = imgSrc.startsWith('data:video/');
    const mediaHTML = isVideo 
      ? `<video src="${imgSrc}" style="width: 100%; height: 100%; object-fit: cover;" muted></video>`
      : `<img src="${imgSrc}" alt="Upload preview ${idx + 1}" />`;

    thumb.innerHTML = `
      ${mediaHTML}
      <button type="button" class="remove-thumb-btn" title="Remove media">&times;</button>
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
      if (boardData.imageDuration) {
        document.getElementById('imageDurationSelect').value = boardData.imageDuration;
      }
      if (boardData.videoLoops !== undefined) {
        document.getElementById('videoLoopsSelect').value = boardData.videoLoops;
      }
      if (boardData.textDuration !== undefined) {
        document.getElementById('textDurationSelect').value = boardData.textDuration;
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
  const prevMediaWrapper = document.getElementById('prevMediaWrapper');
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
      prevMediaWrapper.style.display = 'block';
      previewTextOnlyFallback.style.display = 'none';

      const imgSrc = currentImages[0];
      const isVideo = imgSrc.startsWith('data:video/');
      if (isVideo) {
        prevMediaWrapper.innerHTML = `
          <video src="${imgSrc}" class="slideshow-bg-blur" autoplay muted loop style="display:block;"></video>
          <video src="${imgSrc}" class="slideshow-image" autoplay muted loop style="display:block;"></video>
        `;
      } else {
        prevMediaWrapper.innerHTML = `
          <img src="${imgSrc}" class="slideshow-bg-blur" style="display:block;" />
          <img src="${imgSrc}" class="slideshow-image" style="display:block;" />
        `;
      }
    } else {
      prevMediaWrapper.style.display = 'none';
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
  const saveStatus = document.getElementById('cloudSaveStatus');

  if (!modal) return;

  const apiKeyInput = document.getElementById('cfgApiKey');
  const projectIdInput = document.getElementById('cfgProjectId');
  const storageBucketInput = document.getElementById('cfgStorageBucket');
  const appIdInput = document.getElementById('cfgAppId');
  const senderIdInput = document.getElementById('cfgSenderId');

  // Populate inputs from saved credentials
  const populateInputs = () => {
    try {
      const saved = localStorage.getItem('custom_firebase_config');
      if (saved) {
        const cfg = JSON.parse(saved);
        if (apiKeyInput) apiKeyInput.value = cfg.apiKey || '';
        if (projectIdInput) projectIdInput.value = cfg.projectId || '';
        if (storageBucketInput) storageBucketInput.value = cfg.storageBucket || '';
        if (appIdInput) appIdInput.value = cfg.appId || '';
        if (senderIdInput) senderIdInput.value = cfg.messagingSenderId || '';
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

  // Close on overlay click
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.style.display = 'none';
  });

  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const apiKey = apiKeyInput ? apiKeyInput.value.trim() : '';
      const projectId = projectIdInput ? projectIdInput.value.trim() : '';
      const appId = appIdInput ? appIdInput.value.trim() : '';
      const messagingSenderId = senderIdInput ? senderIdInput.value.trim() : '';

      if (!apiKey || !projectId || !appId || !messagingSenderId) {
        showToast('All fields are required.', 'error');
        return;
      }

      const cfg = {
        apiKey,
        projectId,
        authDomain: `${projectId}.firebaseapp.com`,
        storageBucket: storageBucketInput && storageBucketInput.value.trim()
          ? storageBucketInput.value.trim()
          : `${projectId}.firebasestorage.app`,
        messagingSenderId,
        appId
      };

      localStorage.setItem('custom_firebase_config', JSON.stringify(cfg));
      
      if (saveStatus) {
        saveStatus.textContent = '✅ Credentials saved! Reloading to connect Firebase...';
        saveStatus.style.display = 'block';
      }
      showToast('🔥 Firebase Connected! Reloading...', 'success');
      setTimeout(() => location.reload(), 1200);
    });
  }

  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      localStorage.removeItem('custom_firebase_config');
      showToast('Firebase credentials cleared.', 'info');
      modal.style.display = 'none';
      setTimeout(() => location.reload(), 800);
    });
  }
}

/**
 * Setup Copy Display Link for TV / Phone Auto-Config
 */
function setupCopyDisplayLink() {
  const copyBtn = document.getElementById('copyDisplayLinkBtn');
  if (!copyBtn) return;

  copyBtn.addEventListener('click', () => {
    const url = getShareableDisplayUrl();
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(() => {
        showToast('📋 TV Sync Link copied! Open this link on your phone/TV to auto-connect.', 'success', 6000);
      }).catch(() => {
        prompt('Copy this TV Sync URL to open on your phone or Smart TV:', url);
      });
    } else {
      prompt('Copy this TV Sync URL to open on your phone or Smart TV:', url);
    }
  });
}
