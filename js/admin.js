/**
 * Admin Console Logic for Principal's Live Notice Board
 */

import { verifyPasscode, updatePasscode, compressImage, showToast } from './utils.js';
import { initStore, subscribeToBoard, updateBoard, clearBoard } from './realtime-store.js';
import { getShareableDisplayUrl } from './firebase-config.js';

// Application State
let currentImages = [];
let customLoopImage = null;
let isUnlocked = false;
let draggedIndex = null;

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
  setupLoopSettings();
  setupRealtimePreview();
});

/**
 * Periodic Loop Settings Setup
 */
function setupLoopSettings() {
  const enableCheck = document.getElementById('enableLoopCheck');
  const settingsFields = document.getElementById('loopSettingsFields');
  const contentTypeSelect = document.getElementById('loopContentTypeSelect');
  const customGroup = document.getElementById('customLoopImageGroup');

  const loopDropzone = document.getElementById('loopImageDropzone');
  const loopFileInput = document.getElementById('loopFileInput');
  const loopPreview = document.getElementById('loopImagePreview');
  const loopImgThumb = document.getElementById('loopImgThumb');
  const loopImgName = document.getElementById('loopImgName');
  const removeLoopBtn = document.getElementById('removeLoopImgBtn');

  if (!enableCheck) return;

  enableCheck.addEventListener('change', () => {
    settingsFields.style.display = enableCheck.checked ? 'flex' : 'none';
  });

  contentTypeSelect.addEventListener('change', () => {
    customGroup.style.display = contentTypeSelect.value === 'image' ? 'block' : 'none';
  });

  loopDropzone.addEventListener('click', () => loopFileInput.click());

  ['dragenter', 'dragover'].forEach(evt => {
    loopDropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      loopDropzone.classList.add('drag-over');
    });
  });

  ['dragleave', 'drop'].forEach(evt => {
    loopDropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      loopDropzone.classList.remove('drag-over');
    });
  });

  loopDropzone.addEventListener('drop', (e) => {
    const files = e.dataTransfer.files;
    if (files.length > 0) handleLoopFile(files[0]);
  });

  loopFileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) handleLoopFile(e.target.files[0]);
    loopFileInput.value = '';
  });

  removeLoopBtn.addEventListener('click', () => {
    customLoopImage = null;
    loopPreview.style.display = 'none';
    loopImgThumb.src = '';
  });

  async function handleLoopFile(file) {
    if (!file.type.startsWith('image/')) {
      showToast('Please select a valid image file for the loop flyer.', 'error');
      return;
    }
    try {
      showToast('Compressing custom loop flyer...', 'info', 1500);
      const base64 = await compressImage(file, 1280, 0.85);
      customLoopImage = base64;
      loopImgThumb.src = base64;
      loopImgName.textContent = file.name || 'Custom Flyer Attached';
      loopPreview.style.display = 'flex';
      showToast('Loop flyer attached!', 'success');
    } catch (err) {
      console.error('Loop image processing error:', err);
      showToast('Failed to process loop image', 'error');
    }
  }
}


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

  window.addEventListener('cloud-upload-start', () => {
    postBtn.innerHTML = '☁️ Uploading media to cloud...';
  });
  window.addEventListener('cloud-upload-progress', (e) => {
    const { uploaded, total } = e.detail;
    const pct = Math.round((uploaded / total) * 100);
    postBtn.innerHTML = `☁️ Uploading... ${pct}% (${uploaded}/${total} chunks)`;
  });
  window.addEventListener('cloud-upload-success', () => {
    postBtn.innerHTML = '✅ Live on Cloud!';
    setTimeout(() => {
      postBtn.disabled = false;
      postBtn.innerHTML = '🚀 Post to Board Live';
    }, 1500);
  });
  window.addEventListener('cloud-upload-error', (e) => {
    postBtn.disabled = false;
    postBtn.innerHTML = '🚀 Post to Board Live';
    const errMsg = (e.detail && e.detail.message) ? e.detail.message : 'Cloud upload failed';
    showToast('❌ ' + errMsg, 'error', 7000);
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

    const enableLoop = document.getElementById('enableLoopCheck') ? document.getElementById('enableLoopCheck').checked : false;
    const loopInterval = parseInt(document.getElementById('loopIntervalSelect').value, 10) || 30;
    const loopDuration = parseInt(document.getElementById('loopDurationSelect').value, 10) || 5;
    const loopType = document.getElementById('loopContentTypeSelect') ? document.getElementById('loopContentTypeSelect').value : 'text';

    const loopConfig = {
      enabled: enableLoop,
      interval: loopInterval,
      duration: loopDuration,
      type: loopType,
      loopImage: customLoopImage
    };

    postBtn.disabled = true;
    postBtn.innerHTML = '⌛ Saving locally...';

    try {
      await updateBoard({
        title,
        message,
        images: currentImages,
        imageDuration: parseInt(document.getElementById('imageDurationSelect').value, 10),
        videoLoops: parseInt(document.getElementById('videoLoopsSelect').value, 10),
        textDuration: parseInt(document.getElementById('textDurationSelect').value, 10),
        loopConfig
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
  if (!grid) return;
  grid.innerHTML = '';

  currentImages.forEach((imgSrc, idx) => {
    const thumb = document.createElement('div');
    thumb.className = 'preview-thumb';
    thumb.draggable = true;
    
    const isVideo = typeof imgSrc === 'string' && imgSrc.startsWith('data:video/');
    const mediaHTML = isVideo 
      ? `<video src="${imgSrc}" style="width: 100%; height: 100%; object-fit: cover;" muted></video>`
      : `<img src="${imgSrc}" alt="Upload preview ${idx + 1}" />`;

    thumb.innerHTML = `
      <div class="thumb-order-badge">#${idx + 1}</div>
      ${mediaHTML}
      <div class="thumb-media-tag">${isVideo ? '🎥 Video' : '📷 Image'}</div>
      <div class="thumb-actions">
        ${idx > 0 ? `<button type="button" class="move-thumb-btn move-left-btn" title="Move Earlier">◀</button>` : ''}
        ${idx < currentImages.length - 1 ? `<button type="button" class="move-thumb-btn move-right-btn" title="Move Later">▶</button>` : ''}
        <button type="button" class="remove-thumb-btn" title="Remove media">&times;</button>
      </div>
    `;

    // Move Left Action
    const moveLeftBtn = thumb.querySelector('.move-left-btn');
    if (moveLeftBtn) {
      moveLeftBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        swapMediaItems(idx, idx - 1);
      });
    }

    // Move Right Action
    const moveRightBtn = thumb.querySelector('.move-right-btn');
    if (moveRightBtn) {
      moveRightBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        swapMediaItems(idx, idx + 1);
      });
    }

    // Remove Action
    thumb.querySelector('.remove-thumb-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      currentImages.splice(idx, 1);
      renderImagePreviews();
      updateLivePreviewFromForm();
    });

    // Drag & Drop Handlers
    thumb.addEventListener('dragstart', (e) => {
      draggedIndex = idx;
      e.dataTransfer.effectAllowed = 'move';
      thumb.classList.add('dragging');
    });

    thumb.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      thumb.classList.add('drag-over-item');
    });

    thumb.addEventListener('dragleave', () => {
      thumb.classList.remove('drag-over-item');
    });

    thumb.addEventListener('drop', (e) => {
      e.preventDefault();
      thumb.classList.remove('drag-over-item');
      if (draggedIndex !== null && draggedIndex !== idx) {
        reorderMediaItems(draggedIndex, idx);
      }
    });

    thumb.addEventListener('dragend', () => {
      thumb.classList.remove('dragging');
      draggedIndex = null;
    });

    grid.appendChild(thumb);
  });
}

function swapMediaItems(fromIdx, toIdx) {
  if (fromIdx < 0 || fromIdx >= currentImages.length || toIdx < 0 || toIdx >= currentImages.length) return;
  const temp = currentImages[fromIdx];
  currentImages[fromIdx] = currentImages[toIdx];
  currentImages[toIdx] = temp;
  renderImagePreviews();
  updateLivePreviewFromForm();
}

function reorderMediaItems(fromIdx, toIdx) {
  const item = currentImages.splice(fromIdx, 1)[0];
  currentImages.splice(toIdx, 0, item);
  renderImagePreviews();
  updateLivePreviewFromForm();
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
      
      // Prefill Loop Config if present
      if (boardData.loopConfig) {
        const enableCheck = document.getElementById('enableLoopCheck');
        const fields = document.getElementById('loopSettingsFields');
        const typeSelect = document.getElementById('loopContentTypeSelect');
        const group = document.getElementById('customLoopImageGroup');

        if (enableCheck) {
          enableCheck.checked = !!boardData.loopConfig.enabled;
          fields.style.display = enableCheck.checked ? 'flex' : 'none';
        }
        if (boardData.loopConfig.interval) {
          document.getElementById('loopIntervalSelect').value = boardData.loopConfig.interval;
        }
        if (boardData.loopConfig.duration) {
          document.getElementById('loopDurationSelect').value = boardData.loopConfig.duration;
        }
        if (boardData.loopConfig.type && typeSelect) {
          typeSelect.value = boardData.loopConfig.type;
          group.style.display = typeSelect.value === 'image' ? 'block' : 'none';
        }
        if (boardData.loopConfig.loopImage) {
          customLoopImage = boardData.loopConfig.loopImage;
          const preview = document.getElementById('loopImagePreview');
          const thumb = document.getElementById('loopImgThumb');
          if (preview && thumb) {
            thumb.src = customLoopImage;
            preview.style.display = 'flex';
          }
        }
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
