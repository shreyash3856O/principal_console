/**
 * Smart Board TV Display Logic for Principal's Live Notice Board
 */

import { getFormattedDateTime, formatTimestamp } from './utils.js';
import { initStore, subscribeToBoard } from './realtime-store.js';

let slideshowInterval = null;
let currentSlideIndex = 0;
let activeImages = [];

document.addEventListener('DOMContentLoaded', () => {
  initStore();
  setupLiveClock();
  setupFullscreenToggle();
  setupRealtimeSubscription();
});

/**
 * Live Clock & Date Update Loop
 */
function setupLiveClock() {
  const timeEl = document.getElementById('clockTime');
  const dateEl = document.getElementById('clockDate');

  function update() {
    const { timeStr, dateStr } = getFormattedDateTime();
    if (timeEl) timeEl.textContent = timeStr;
    if (dateEl) dateEl.textContent = dateStr;
  }

  update();
  setInterval(update, 1000);
}

/**
 * Realtime Backend Listener
 */
function setupRealtimeSubscription() {
  const statusBadge = document.getElementById('footerStatusBadge');

  subscribeToBoard((data, meta) => {
    // Update Connection Status Badge
    if (statusBadge) {
      const isCloud = meta && (meta.source === 'cloud' || meta.source === 'global-cloud' || meta.source === 'firebase-cloud' || meta.source === 'cloud-relay' || meta.isOnline);
      if (isCloud) {
        statusBadge.innerHTML = '<span style="color:#10b981;">●</span> Cloud Live Sync';
      } else {
        statusBadge.innerHTML = '<span style="color:#f59e0b;">●</span> Local Sync';
      }
    }

    renderNoticeBoard(data);
  });
}

/**
 * Render Notice Board UI with payload
 */
function renderNoticeBoard(data) {
  const activeView = document.getElementById('activeNoticeView');
  const emptyView = document.getElementById('emptyNoticeView');
  const slideshowContainer = document.getElementById('slideshowContainer');
  const dotsContainer = document.getElementById('slideshowDots');

  const tickerBar = document.getElementById('tickerBar');
  const tickerTrack = document.getElementById('tickerTrack');

  const titleText = (data && data.title) ? data.title.trim() : '';
  const bodyText = (data && data.message) ? data.message.trim() : '';
  activeImages = (data && Array.isArray(data.images)) ? data.images : [];

  const hasTextNotice = !!(titleText || bodyText);
  const hasImages = activeImages.length > 0;
  const isActive = data && data.active && (hasTextNotice || hasImages);

  if (!isActive) {
    // Show Calm Empty State
    stopSlideshow();
    if (activeView) activeView.style.display = 'none';
    if (emptyView) emptyView.style.display = 'flex';
    if (tickerBar) tickerBar.style.display = 'none';
    return;
  }

  // Show Active Announcement Canvas
  if (emptyView) emptyView.style.display = 'none';
  if (activeView) activeView.style.display = 'block';

  // 1. Text Notice Handling (News Ticker Banner at bottom)
  if (hasTextNotice && tickerBar && tickerTrack) {
    tickerBar.style.display = 'flex';
    const cleanBody = bodyText.replace(/\n/g, '  •  ');
    const fullText = titleText 
      ? `📢 ${titleText.toUpperCase()}${cleanBody ? ' — ' + cleanBody : ''}`
      : `📢 ${cleanBody}`;

    tickerTrack.textContent = `${fullText}          ${fullText}          ${fullText}`;

    const charCount = fullText.length;
    const duration = Math.max(16, Math.min(50, charCount * 0.28));
    tickerTrack.style.animationDuration = `${duration}s`;
  } else {
    if (tickerBar) tickerBar.style.display = 'none';
  }

  // 2. Image Slideshow / Text Notice Card Handling
  if (hasImages) {
    setupSlideshow(activeImages, slideshowContainer, dotsContainer);
  } else {
    stopSlideshow();
    const logoSrc = document.querySelector('.display-crest')?.src || '';
    const postedTime = data.postedAtReadable ? `Posted at ${data.postedAtReadable}` : 'OFFICIAL ANNOUNCEMENT';

    slideshowContainer.innerHTML = `
      <div style="width:100%; height:100%; display:flex; align-items:center; justify-content:center; padding:2rem; background: linear-gradient(135deg, #ffffff 0%, #f8fafc 100%); color: #0f172a; border-radius: var(--radius-lg);">
        <div style="max-width:800px; width:100%; text-align:center; background: rgba(255, 255, 255, 0.95); padding: 3rem 2.5rem; border-radius: 1.25rem; border: 2px solid rgba(153, 0, 0, 0.15); box-shadow: 0 20px 40px rgba(153, 0, 0, 0.08);">
          ${logoSrc ? `<img src="${logoSrc}" alt="College Logo" style="width:90px; height:90px; object-fit:contain; margin-bottom:1.25rem; filter: drop-shadow(0 6px 16px rgba(153, 0, 0, 0.2));" />` : ''}
          <div style="font-size:0.8rem; font-weight:800; color:var(--primary-accent); text-transform:uppercase; letter-spacing:0.12em; margin-bottom:0.5rem;">${postedTime}</div>
          <h2 style="font-size:2.2rem; color:#990000; font-weight:800; line-height:1.25; margin-bottom:1rem;">${titleText || 'Official Notice'}</h2>
          <p style="font-size:1.25rem; color:#1e293b; line-height:1.7; white-space: pre-wrap; word-break: break-word;">${bodyText}</p>
        </div>
      </div>
    `;
    dotsContainer.innerHTML = '';
  }
}

/**
 * Automatic Image Slideshow Engine (Landscape with Glass Backdrop Blur)
 */
function setupSlideshow(images, container, dotsContainer) {
  stopSlideshow();
  container.innerHTML = '';
  dotsContainer.innerHTML = '';
  currentSlideIndex = 0;

  images.forEach((imgSrc, idx) => {
    const slideItem = document.createElement('div');
    slideItem.className = `slide-item ${idx === 0 ? 'active' : ''}`;

    // Background blurred image for pillarbox glass aesthetic
    const bgBlur = document.createElement('img');
    bgBlur.src = imgSrc;
    bgBlur.className = 'slideshow-bg-blur';
    bgBlur.alt = '';

    // Main foreground fitted image
    const mainImg = document.createElement('img');
    mainImg.src = imgSrc;
    mainImg.className = 'slideshow-image';
    mainImg.alt = `Notice board image ${idx + 1}`;

    slideItem.appendChild(bgBlur);
    slideItem.appendChild(mainImg);
    container.appendChild(slideItem);
  });

  // Handle edge case: 1 image vs multiple images
  if (images.length === 1) {
    dotsContainer.style.display = 'none';
    return; // Static image presentation, no rotation timer
  }

  // Multiple images: Render indicator dots
  dotsContainer.style.display = 'flex';
  images.forEach((_, idx) => {
    const dot = document.createElement('div');
    dot.className = `dot ${idx === 0 ? 'active' : ''}`;
    dotsContainer.appendChild(dot);
  });

  // Start 5-second rotation timer
  slideshowInterval = setInterval(() => {
    currentSlideIndex = (currentSlideIndex + 1) % images.length;
    updateSlideshowUI(container, dotsContainer, currentSlideIndex);
  }, 5000);
}

function updateSlideshowUI(container, dotsContainer, index) {
  const slideElements = container.querySelectorAll('.slide-item');
  const dotElements = dotsContainer.querySelectorAll('.dot');

  slideElements.forEach((slide, idx) => {
    if (idx === index) {
      slide.classList.add('active');
    } else {
      slide.classList.remove('active');
    }
  });

  dotElements.forEach((dot, idx) => {
    if (idx === index) {
      dot.classList.add('active');
    } else {
      dot.classList.remove('active');
    }
  });
}

function stopSlideshow() {
  if (slideshowInterval) {
    clearInterval(slideshowInterval);
    slideshowInterval = null;
  }
}

/**
 * Fullscreen Browser API Handler & Glassy Header Toggle
 */
function setupFullscreenToggle() {
  const fullscreenBtn = document.getElementById('fullscreenBtn');
  const displayScreen = document.getElementById('displayScreen');
  if (!fullscreenBtn) return;

  const getFullscreenElement = () => 
    document.fullscreenElement || 
    document.webkitFullscreenElement || 
    document.mozFullScreenElement || 
    document.msFullscreenElement;

  const toggleFullscreen = () => {
    if (!getFullscreenElement()) {
      const docEl = document.documentElement;
      if (docEl.requestFullscreen) {
        docEl.requestFullscreen().catch(err => console.warn('Fullscreen request failed:', err));
      } else if (docEl.webkitRequestFullscreen) {
        docEl.webkitRequestFullscreen();
      } else if (docEl.msRequestFullscreen) {
        docEl.msRequestFullscreen();
      }
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen();
      } else if (document.webkitExitFullscreen) {
        document.webkitExitFullscreen();
      } else if (document.msExitFullscreen) {
        document.msExitFullscreen();
      }
    }
  };

  fullscreenBtn.addEventListener('click', toggleFullscreen);

  // Update button text and glassy header class on fullscreen change
  const updateFullscreenUI = () => {
    const isFS = !!getFullscreenElement();
    if (displayScreen) {
      displayScreen.classList.toggle('is-fullscreen', isFS);
    }

    if (isFS) {
      fullscreenBtn.innerHTML = '<span>⤓</span> Exit Fullscreen';
      fullscreenBtn.title = 'Exit Fullscreen mode';
    } else {
      fullscreenBtn.innerHTML = '<span>⤢</span> Fullscreen';
      fullscreenBtn.title = 'Enter Fullscreen mode for TV Smart Board';
    }
  };

  ['fullscreenchange', 'webkitfullscreenchange', 'mozfullscreenchange', 'MSFullscreenChange'].forEach(evt => {
    document.addEventListener(evt, updateFullscreenUI);
  });
}
