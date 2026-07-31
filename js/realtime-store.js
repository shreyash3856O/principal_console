/**
 * Realtime Data Store for Principal's Live Notice Board
 * 
 * Cross-Device Sync via Global Cloud REST API (jsonblob.com)
 * - Admin publishes → PUT to cloud endpoint
 * - Display page polls cloud endpoint every 2s → instant updates without refresh
 * - Works across any device, any network, anywhere in the world
 * 
 * Optional: Firebase Firestore (when credentials are provided)
 */

// ─── Cloud REST API Endpoint ───────────────────────────────────
const CLOUD_API = 'https://jsonblob.com/api/jsonBlob/019fb9aa-6bde-70bf-a1f8-381beb412783';

// ─── State ─────────────────────────────────────────────────────
let db = null;
let isFirebaseActive = false;
let lastSeenTimestamp = 0;
let pollTimer = null;

const broadcastChannel = (typeof BroadcastChannel !== 'undefined')
  ? new BroadcastChannel('principal_notice_board_channel')
  : null;

// ─── Initialize ────────────────────────────────────────────────
export function initStore() {
  // Try Firebase if user has configured custom credentials via localStorage
  try {
    const saved = localStorage.getItem('custom_firebase_config');
    if (saved) {
      const cfg = JSON.parse(saved);
      if (cfg && cfg.apiKey && !cfg.apiKey.includes('YOUR_')) {
        // Dynamically import Firebase only when credentials exist
        Promise.all([
          import('https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js'),
          import('https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js')
        ]).then(([appModule, fsModule]) => {
          const app = appModule.initializeApp(cfg);
          db = fsModule.getFirestore(app);
          isFirebaseActive = true;
          console.log('⚡ Firebase Firestore Realtime Sync Initialized');
        }).catch(err => {
          console.warn('Firebase init failed, using Cloud REST Engine:', err);
        });
      }
    }
  } catch (e) {}

  console.log('🌐 Global Cloud REST Engine Active (Multi-Device Sync Ready)');
  return { isCloudActive: true, isFirebaseActive };
}

// ─── Subscribe to Board Updates ────────────────────────────────
export function subscribeToBoard(callback) {

  // Immediately load from local cache first for instant render
  const cached = getLocalState();
  if (cached.updatedAt) {
    lastSeenTimestamp = cached.updatedAt;
    callback(cached, { source: 'cache', isOnline: true });
  }

  // Core polling function - fetches latest data from cloud
  async function pollCloud() {
    try {
      const res = await fetch(CLOUD_API, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
        cache: 'no-store'
      });
      if (!res.ok) return;

      const data = await res.json();
      if (data && data.updatedAt && data.updatedAt !== lastSeenTimestamp) {
        lastSeenTimestamp = data.updatedAt;
        // Save to local cache
        localStorage.setItem('principal_board_data', JSON.stringify(data));
        // Push update to UI
        callback(data, { source: 'cloud', isOnline: true });
      }
    } catch (err) {
      // Network error — silently retry on next poll
    }
  }

  // 1. First cloud fetch immediately
  pollCloud();

  // 2. Poll every 2 seconds for near-realtime updates
  pollTimer = setInterval(pollCloud, 2000);

  // 3. Instant fetch when screen unlocked / tab focused (mobile wake-up)
  const onVisible = () => { if (!document.hidden) pollCloud(); };
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('focus', pollCloud);

  // 4. Local BroadcastChannel for same-device instant sync
  const onBroadcast = (e) => {
    if (e.data && e.data.updatedAt) {
      lastSeenTimestamp = e.data.updatedAt;
      callback(e.data, { source: 'cloud', isOnline: true });
    }
  };
  if (broadcastChannel) broadcastChannel.addEventListener('message', onBroadcast);

  // 5. localStorage cross-tab sync
  const onStorage = (e) => {
    if (e.key === 'principal_board_data' && e.newValue) {
      try {
        const d = JSON.parse(e.newValue);
        if (d.updatedAt && d.updatedAt !== lastSeenTimestamp) {
          lastSeenTimestamp = d.updatedAt;
          callback(d, { source: 'cloud', isOnline: true });
        }
      } catch (_) {}
    }
  };
  window.addEventListener('storage', onStorage);

  // Cleanup
  return () => {
    if (pollTimer) clearInterval(pollTimer);
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('focus', pollCloud);
    if (broadcastChannel) broadcastChannel.removeEventListener('message', onBroadcast);
    window.removeEventListener('storage', onStorage);
  };
}

// ─── Publish Notice ────────────────────────────────────────────
export async function updateBoard(boardData) {
  const payload = {
    title: boardData.title || '',
    message: boardData.message || '',
    images: boardData.images || [],
    active: true,
    updatedAt: Date.now(),
    postedAtReadable: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
  };

  lastSeenTimestamp = payload.updatedAt;

  // 1. Local cache (instant)
  localStorage.setItem('principal_board_data', JSON.stringify(payload));
  if (broadcastChannel) broadcastChannel.postMessage(payload);

  // 2. Push to Global Cloud REST API → syncs to ALL devices worldwide
  try {
    await fetch(CLOUD_API, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    console.log('✅ Published to Global Cloud');
  } catch (err) {
    console.warn('Cloud push error (will retry):', err);
  }

  // 3. Firebase Firestore (if configured)
  if (isFirebaseActive && db) {
    try {
      const fsModule = await import('https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js');
      const docRef = fsModule.doc(db, 'noticeboard', 'current');
      await fsModule.setDoc(docRef, payload);
    } catch (e) {}
  }

  return payload;
}

// ─── Clear Board ───────────────────────────────────────────────
export async function clearBoard() {
  const payload = {
    title: '',
    message: '',
    images: [],
    active: false,
    updatedAt: Date.now(),
    postedAtReadable: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
  };

  lastSeenTimestamp = payload.updatedAt;

  localStorage.setItem('principal_board_data', JSON.stringify(payload));
  if (broadcastChannel) broadcastChannel.postMessage(payload);

  try {
    await fetch(CLOUD_API, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  } catch (err) {}

  if (isFirebaseActive && db) {
    try {
      const fsModule = await import('https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js');
      const docRef = fsModule.doc(db, 'noticeboard', 'current');
      await fsModule.setDoc(docRef, payload);
    } catch (e) {}
  }

  return payload;
}

// ─── Helpers ───────────────────────────────────────────────────
function getLocalState() {
  try {
    const raw = localStorage.getItem('principal_board_data');
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  return { title: '', message: '', images: [], active: false, updatedAt: null };
}
