/**
 * Smart Board TV Display Logic for Principal's Live Notice Board
 */

import { getFormattedDateTime } from './utils.js';
import { initStore, subscribeToBoard } from './realtime-store.js';

let slideshowTimeout = null;
let currentSlideIndex = 0;
let activeImages = [];

let interruptionIntervalTimer = null;
let interruptionResumeTimer = null;
let isInterrupted = false;

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
      if (meta && meta.source === 'cloud') {
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

  window.currentImageDuration = data && data.imageDuration ? data.imageDuration * 1000 : 5000;
  window.currentVideoLoops = data && data.videoLoops ? data.videoLoops : 1;
  window.currentTextDuration = data && data.textDuration !== undefined ? data.textDuration * 1000 : 0;
  window.currentLoopConfig = data && data.loopConfig ? data.loopConfig : null;

  if (!isActive) {
    // Show Calm Empty State
    stopSlideshow();
    stopInterruptionTimer();
    if (activeView) activeView.style.display = 'none';
    if (emptyView) emptyView.style.display = 'flex';
    if (tickerBar) tickerBar.style.display = 'none';
    return;
  }

  // Show Active Announcement Canvas
  if (emptyView) emptyView.style.display = 'none';
  if (activeView) activeView.style.display = 'block';

  // 1. Text Notice Handling (Only appears on News Ticker Banner if provided)
  if (hasTextNotice && tickerBar && tickerTrack) {
    tickerBar.style.display = 'flex';
    const cleanBody = bodyText.replace(/\n/g, '  •  ');
    const fullText = titleText 
      ? `📢 ${titleText.toUpperCase()}${cleanBody ? ' — ' + cleanBody : ''}`
      : `📢 ${cleanBody}`;

    // Repeat text string to ensure continuous loop
    tickerTrack.textContent = `${fullText}          ${fullText}          ${fullText}`;

    // Adjust marquee animation duration dynamically for slow, smooth reading speed
    const charCount = fullText.length;
    const duration = Math.max(45, Math.min(160, charCount * 0.75));
    tickerTrack.style.animationDuration = `${duration}s`;
  } else {
    // No text notice provided -> Hide ticker bar completely
    if (tickerBar) tickerBar.style.display = 'none';
  }

  // 2. Build Slides List
  const slides = [];
  
  if (hasTextNotice && window.currentTextDuration > 0) {
    slides.push({
      type: 'text',
      title: titleText,
      message: bodyText
    });
  }

  activeImages.forEach(imgSrc => {
    slides.push({
      type: (typeof imgSrc === 'string' && imgSrc.startsWith('data:video/')) ? 'video' : 'image',
      src: imgSrc
    });
  });

  window.activeSlides = slides;

  // 3. Slideshow Handling
  if (slides.length > 0) {
    setupSlideshow(slides, slideshowContainer, dotsContainer);
  } else {
    stopSlideshow();
    if (hasTextNotice) {
       slideshowContainer.innerHTML = `
         <div style="width:100%; height:100%; display:flex; align-items:center; justify-content:center; text-align:center; padding:3rem 2rem; background:#ffffff;">
           <div style="max-width:920px;">
             <img src="assets/logo.png" style="width:130px; height:130px; object-fit:contain; opacity:0.95; margin-bottom:1.5rem; filter: drop-shadow(0 6px 16px rgba(153, 0, 0, 0.25));" />
             <h2 style="font-size:3.2rem; color:var(--primary-accent); font-weight:800; line-height:1.2; margin-bottom:1.25rem;">Official Notice Active</h2>
             <p style="font-size:1.85rem; color:#0f172a; font-weight:600; line-height:1.6; max-width:900px; margin:0 auto;">See scrolling ticker below</p>
           </div>
         </div>
       `;
    } else {
       slideshowContainer.innerHTML = '';
    }
    dotsContainer.innerHTML = '';
  }

  // 4. Setup Periodic Announcement Interruption Loop
  setupInterruptionTimer(titleText, bodyText, window.currentLoopConfig);
}

/**
 * Automatic Slideshow Engine
 */
function setupSlideshow(slides, container, dotsContainer) {
  stopSlideshow();
  container.innerHTML = '';
  dotsContainer.innerHTML = '';
  currentSlideIndex = 0;

  slides.forEach((slide, idx) => {
    const slideItem = document.createElement('div');
    slideItem.className = `slide-item ${idx === 0 ? 'active' : ''}`;

    if (slide.type === 'video') {
      const bgBlur = document.createElement('video');
      bgBlur.src = slide.src;
      bgBlur.className = 'slideshow-bg-blur';
      bgBlur.muted = true; // Background must always be muted

      const mainVideo = document.createElement('video');
      mainVideo.src = slide.src;
      mainVideo.className = 'slideshow-image';
      mainVideo.muted = true; // Best for autoplay without interaction
      // Single video loops infinitely, multiple videos play once per slide
      mainVideo.loop = (slides.length === 1); 

      mainVideo.onloadeddata = () => {
        if (mainVideo.videoWidth >= mainVideo.videoHeight) {
          slideItem.classList.add('is-landscape');
        } else {
          slideItem.classList.add('is-portrait');
        }
      };

      slideItem.appendChild(bgBlur);
      slideItem.appendChild(mainVideo);
    } else if (slide.type === 'image') {
      const bgBlur = document.createElement('img');
      bgBlur.src = slide.src;
      bgBlur.className = 'slideshow-bg-blur';
      bgBlur.alt = '';

      const mainImg = document.createElement('img');
      mainImg.src = slide.src;
      mainImg.className = 'slideshow-image';
      mainImg.alt = `Notice board media ${idx + 1}`;

      mainImg.onload = () => {
        if (mainImg.naturalWidth >= mainImg.naturalHeight) {
          slideItem.classList.add('is-landscape');
        } else {
          slideItem.classList.add('is-portrait');
        }
      };

      slideItem.appendChild(bgBlur);
      slideItem.appendChild(mainImg);
    } else if (slide.type === 'text') {
      slideItem.classList.add('is-landscape'); // For layout
      slideItem.innerHTML = `
        <div style="width:100%; height:100%; display:flex; align-items:center; justify-content:center; text-align:center; padding:3rem 2rem; background:#ffffff;">
          <div style="max-width:920px;">
            <img src="assets/logo.png" style="width:130px; height:130px; object-fit:contain; opacity:0.95; margin-bottom:1.5rem; filter: drop-shadow(0 6px 16px rgba(153, 0, 0, 0.25));" />
            <h2 style="font-size:3.2rem; color:var(--primary-accent); font-weight:800; line-height:1.2; margin-bottom:1.25rem;">${slide.title || 'Official Notice'}</h2>
            <p style="font-size:1.85rem; color:#0f172a; font-weight:600; line-height:1.6; max-width:900px; margin:0 auto;">${slide.message}</p>
          </div>
        </div>
      `;
    }

    container.appendChild(slideItem);
  });

  if (slides.length > 1) {
    dotsContainer.style.display = 'flex';
    slides.forEach((_, idx) => {
      const dot = document.createElement('div');
      dot.className = `dot ${idx === 0 ? 'active' : ''}`;
      dotsContainer.appendChild(dot);
    });
  } else {
    dotsContainer.style.display = 'none';
  }

  playCurrentSlide();
}

function playCurrentSlide() {
  const container = document.getElementById('slideshowContainer');
  const dotsContainer = document.getElementById('slideshowDots');
  updateSlideshowUI(container, dotsContainer, currentSlideIndex);

  const slideElements = container.querySelectorAll('.slide-item');
  const currentSlide = slideElements[currentSlideIndex];
  
  // Pause all videos
  container.querySelectorAll('video').forEach(v => v.pause());

  if (isInterrupted) return; // If currently interrupted, hold playback until interruption ends

  // Check if current slide has a video
  const videos = currentSlide.querySelectorAll('video');
  if (videos.length > 0) {
    videos.forEach(v => {
      v.play().catch(e => console.warn("Video play failed:", e));
    });

    if (window.activeSlides.length > 1) {
       const mainVideo = currentSlide.querySelector('.slideshow-image');
       let currentLoopCount = 0;
       mainVideo.onended = () => {
         currentLoopCount++;
         if (currentLoopCount < (window.currentVideoLoops || 1)) {
           mainVideo.currentTime = 0;
           mainVideo.play().catch(e => console.warn("Video replay failed:", e));
         } else {
           nextSlide();
         }
       };
    }
  } else {
    if (window.activeSlides.length > 1) {
      let delay = 5000;
      if (window.activeSlides[currentSlideIndex].type === 'text') {
        delay = window.currentTextDuration || 5000;
      } else {
        delay = window.currentImageDuration || 5000;
      }
      slideshowTimeout = setTimeout(() => nextSlide(), delay);
    }
  }
}

function nextSlide() {
  currentSlideIndex = (currentSlideIndex + 1) % window.activeSlides.length;
  playCurrentSlide();
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
  if (slideshowTimeout) {
    clearTimeout(slideshowTimeout);
    slideshowTimeout = null;
  }
  const container = document.getElementById('slideshowContainer');
  if (container) {
    container.querySelectorAll('video').forEach(v => {
      v.pause();
      v.onended = null;
    });
  }
}

/**
 * Setup Periodic Interruption Announcement Loop (e.g. Pause Video every 30 seconds)
 */
function setupInterruptionTimer(title, message, loopConfig) {
  stopInterruptionTimer();

  if (!loopConfig || !loopConfig.enabled) {
    return;
  }

  const intervalMs = (loopConfig.interval || 30) * 1000;
  const durationMs = (loopConfig.duration || 5) * 1000;

  interruptionIntervalTimer = setInterval(() => {
    triggerInterruption(title, message, loopConfig, durationMs);
  }, intervalMs);
}

let interruptionFlyerCycleTimer = null;

function triggerInterruption(title, message, loopConfig, durationMs) {
  isInterrupted = true;

  const container = document.getElementById('slideshowContainer');
  if (container) {
    // Pause any playing videos
    container.querySelectorAll('video').forEach(v => v.pause());
  }

  // Freeze image/text slideshow timeout during interruption
  if (slideshowTimeout) {
    clearTimeout(slideshowTimeout);
    slideshowTimeout = null;
  }

  if (interruptionFlyerCycleTimer) {
    clearInterval(interruptionFlyerCycleTimer);
    interruptionFlyerCycleTimer = null;
  }

  const overlay = document.getElementById('interruptionOverlay');
  const content = document.getElementById('interruptionContent');

  if (overlay && content) {
    const loopImgs = (loopConfig && Array.isArray(loopConfig.loopImages) && loopConfig.loopImages.length > 0)
      ? loopConfig.loopImages
      : (loopConfig && loopConfig.loopImage ? [loopConfig.loopImage] : []);

    if (loopConfig.type === 'image' && loopImgs.length > 0) {
      if (loopImgs.length === 1) {
        content.innerHTML = `<img src="${loopImgs[0]}" alt="Announcement Loop Flyer" />`;
      } else {
        let flyerIdx = 0;
        const renderFlyer = () => {
          content.innerHTML = `<img src="${loopImgs[flyerIdx]}" alt="Announcement Loop Flyer ${flyerIdx + 1}" style="max-width: 95%; max-height: 90%; object-fit: contain; animation: fadeInInterruption 0.4s ease;" />`;
          flyerIdx = (flyerIdx + 1) % loopImgs.length;
        };
        renderFlyer();
        const cycleInterval = Math.max(3000, Math.floor(durationMs / loopImgs.length));
        interruptionFlyerCycleTimer = setInterval(renderFlyer, cycleInterval);
      }
    } else {
      content.innerHTML = `
        <div style="max-width: 900px; text-align: center; background: #ffffff; padding: 3rem; border-radius: 16px; border: 4px solid var(--primary-accent); box-shadow: 0 25px 60px rgba(0,0,0,0.5);">
          <img src="assets/logo.png" style="width: 110px; height: 110px; object-fit: contain; margin-bottom: 1.25rem;" />
          <div style="font-size: 0.85rem; font-weight: 800; color: var(--primary-accent); letter-spacing: 0.15em; text-transform: uppercase; margin-bottom: 0.5rem;">Shree L.R Tiwari College of Engineering</div>
          <h2 style="font-size: 2.8rem; font-weight: 800; color: #0f172a; line-height: 1.25; margin-bottom: 1rem;">${title || 'Important Notice'}</h2>
          <p style="font-size: 1.6rem; font-weight: 600; color: #334155; line-height: 1.6;">${message || ''}</p>
        </div>
      `;
    }

    overlay.style.display = 'flex';
  }

  interruptionResumeTimer = setTimeout(() => {
    endInterruption();
  }, durationMs);
}

function endInterruption() {
  isInterrupted = false;
  if (interruptionFlyerCycleTimer) {
    clearInterval(interruptionFlyerCycleTimer);
    interruptionFlyerCycleTimer = null;
  }

  const overlay = document.getElementById('interruptionOverlay');
  if (overlay) overlay.style.display = 'none';

  // Resume slideshow / video playback from exact current slide
  playCurrentSlide();
}

function stopInterruptionTimer() {
  if (interruptionIntervalTimer) {
    clearInterval(interruptionIntervalTimer);
    interruptionIntervalTimer = null;
  }
  if (interruptionResumeTimer) {
    clearTimeout(interruptionResumeTimer);
    interruptionResumeTimer = null;
  }
  if (interruptionFlyerCycleTimer) {
    clearInterval(interruptionFlyerCycleTimer);
    interruptionFlyerCycleTimer = null;
  }
  isInterrupted = false;
  const overlay = document.getElementById('interruptionOverlay');
  if (overlay) overlay.style.display = 'none';
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
    const isFS = !!getFullscreenElement() || (window.innerHeight >= screen.height - 10) || window.matchMedia('(display-mode: fullscreen)').matches;
    if (displayScreen) {
      displayScreen.classList.toggle('is-fullscreen', isFS);
    }
    document.documentElement.classList.toggle('is-fullscreen', isFS);
    document.body.classList.toggle('is-fullscreen', isFS);

    if (isFS) {
      fullscreenBtn.innerHTML = '<span>⤓</span> Exit Fullscreen';
      fullscreenBtn.title = 'Exit Fullscreen mode';
    } else {
      fullscreenBtn.innerHTML = '<span>⤢</span> Fullscreen';
      fullscreenBtn.title = 'Enter Fullscreen mode for TV Smart Board';
    }
  };

  ['fullscreenchange', 'webkitfullscreenchange', 'mozfullscreenchange', 'MSFullscreenChange', 'resize'].forEach(evt => {
    document.addEventListener(evt, updateFullscreenUI);
    window.addEventListener(evt, updateFullscreenUI);
  });
  updateFullscreenUI();
}

