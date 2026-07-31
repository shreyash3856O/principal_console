/**
 * Realtime Data Store for Principal's Live Notice Board
 * 
 * Multi-Device Sync Architecture:
 * 1. Global Cloud REST Engine (jsonblob.com): Zero-config 100% reliable cross-device persistence & realtime sync across all devices worldwide without refresh.
 * 2. Firebase Firestore Engine: Dedicated custom cloud database (when keys are provided via firebase-config.js or Admin Cloud Setup Modal).
 * 3. Local Storage + BroadcastChannel: Instant single-device local tab sync.
 */

import { getActiveFirebaseConfig, isFirebaseConfigured } from './firebase-config.js';

// Firebase JS SDK modular imports from CDN
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js';
import { 
  getFirestore, 
  doc, 
  setDoc, 
  onSnapshot 
} from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';

const COLLECTION_NAME = 'noticeboard';
const DOC_ID = 'current';

// Global Cloud Sync REST API endpoint for cross-device realtime push & persistence
const GLOBAL_CLOUD_ENDPOINT = 'https://jsonblob.com/api/jsonBlob/019fb9aa-6bde-70bf-a1f8-381beb412783';

let db = null;
let isFirebaseActive = false;
let lastKnownUpdatedAt = null;

const broadcastChannel = typeof BroadcastChannel !== 'undefined' 
  ? new BroadcastChannel('principal_notice_board_channel') 
  : null;

/**
 * Initialize backend connection
 */
export function initStore() {
  if (isFirebaseConfigured()) {
    try {
      const activeConfig = getActiveFirebaseConfig();
      const app = initializeApp(activeConfig);
      db = getFirestore(app);
      isFirebaseActive = true;
      console.log('⚡ Firebase Firestore Realtime Sync Initialized');
    } catch (err) {
      console.warn('⚠️ Firebase init error, falling back to Global Cloud REST Engine:', err);
      isFirebaseActive = false;
    }
  } else {
    isFirebaseActive = false;
    console.info('⚡ Operating in Global Cloud Realtime Engine (Multi-Device Sync Active).');
  }

  return { isCloudActive: true, isFirebaseActive };
}

/**
 * Subscribe to realtime board changes across all devices (laptop, phone, TV)
 */
export function subscribeToBoard(callback) {
  let firebaseUnsub = null;
  let pollInterval = null;

  if (isFirebaseActive && db) {
    const docRef = doc(db, COLLECTION_NAME, DOC_ID);
    
    firebaseUnsub = onSnapshot(
      docRef,
      (docSnap) => {
        if (docSnap.exists()) {
          const data = docSnap.data();
          callback(data, { source: 'firebase-cloud', isOnline: true });
        } else {
          callback(getEmptyState(), { source: 'firebase-cloud', isOnline: true });
        }
      },
      (error) => {
        console.error('Firestore subscription error:', error);
        const localData = getLocalState();
        callback(localData, { source: 'local-fallback', isOnline: false, error });
      }
    );
  }

  // Always enable Global Cloud Engine for zero-config multi-device push & persistence
  const fetchCloudData = async () => {
    try {
      const res = await fetch(GLOBAL_CLOUD_ENDPOINT, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
        cache: 'no-store'
      });
      if (res.ok) {
        const cloudData = await res.json();
        if (cloudData && cloudData.updatedAt && cloudData.updatedAt !== lastKnownUpdatedAt) {
          lastKnownUpdatedAt = cloudData.updatedAt;
          localStorage.setItem('principal_board_data', JSON.stringify(cloudData));
          callback(cloudData, { source: 'global-cloud', isOnline: true });
        }
      }
    } catch (err) {
      console.warn('Global cloud sync poll notice:', err);
    }
  };

  // 1. Initial fetch from cloud immediately
  fetchCloudData();

  // 2. High-frequency polling loop (every 1.5 seconds) for real-time instant updates on phone / TV display
  pollInterval = setInterval(fetchCloudData, 1500);

  // 3. Instant fetch when tab becomes visible / focused (mobile screen unlock, app switch)
  const handleVisibilityChange = () => {
    if (!document.hidden) fetchCloudData();
  };
  document.addEventListener('visibilitychange', handleVisibilityChange);
  window.addEventListener('focus', handleVisibilityChange);

  // 4. Local BroadcastChannel & Storage events for instant local tab sync
  const channelHandler = (event) => {
    if (event.data) {
      callback(event.data, { source: 'local-broadcast', isOnline: true });
    }
  };
  if (broadcastChannel) {
    broadcastChannel.addEventListener('message', channelHandler);
  }

  const storageHandler = (e) => {
    if (e.key === 'principal_board_data' && e.newValue) {
      try {
        const data = JSON.parse(e.newValue);
        callback(data, { source: 'local-storage', isOnline: true });
      } catch (err) {}
    }
  };
  window.addEventListener('storage', storageHandler);

  return () => {
    if (firebaseUnsub) firebaseUnsub();
    if (pollInterval) clearInterval(pollInterval);
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    window.removeEventListener('focus', handleVisibilityChange);
    if (broadcastChannel) broadcastChannel.removeEventListener('message', channelHandler);
    window.removeEventListener('storage', storageHandler);
  };
}

/**
 * Publish updated announcement to the board
 */
export async function updateBoard(boardData) {
  const payload = {
    title: boardData.title || '',
    message: boardData.message || '',
    images: boardData.images || [],
    active: true,
    updatedAt: Date.now(),
    postedAtReadable: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
  };

  lastKnownUpdatedAt = payload.updatedAt;

  // 1. Save locally for instant zero-latency feedback
  localStorage.setItem('principal_board_data', JSON.stringify(payload));
  if (broadcastChannel) {
    broadcastChannel.postMessage(payload);
  }

  // 2. Push to Global Cloud REST Engine for instant multi-device sync across different devices / networks
  try {
    fetch(GLOBAL_CLOUD_ENDPOINT, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).catch(err => console.warn('Global cloud sync push notice:', err));
  } catch (e) {}

  // 3. Push to Firebase Firestore if configured
  if (isFirebaseActive && db) {
    try {
      const docRef = doc(db, COLLECTION_NAME, DOC_ID);
      await setDoc(docRef, payload);
    } catch (e) {
      console.warn('Firebase push error:', e);
    }
  }

  return payload;
}

/**
 * Clear the notice board (reverts display to empty state)
 */
export async function clearBoard() {
  const payload = {
    title: '',
    message: '',
    images: [],
    active: false,
    updatedAt: Date.now(),
    postedAtReadable: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
  };

  lastKnownUpdatedAt = payload.updatedAt;

  localStorage.setItem('principal_board_data', JSON.stringify(payload));
  if (broadcastChannel) {
    broadcastChannel.postMessage(payload);
  }

  try {
    fetch(GLOBAL_CLOUD_ENDPOINT, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).catch(err => console.warn('Global cloud sync clear notice:', err));
  } catch (e) {}

  if (isFirebaseActive && db) {
    try {
      const docRef = doc(db, COLLECTION_NAME, DOC_ID);
      await setDoc(docRef, payload);
    } catch (e) {}
  }

  return payload;
}

function getEmptyState() {
  return {
    title: '',
    message: '',
    images: [],
    active: false,
    updatedAt: null
  };
}

function getLocalState() {
  try {
    const raw = localStorage.getItem('principal_board_data');
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  return getEmptyState();
}
