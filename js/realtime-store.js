/**
 * Realtime Data Store for Principal's Live Notice Board
 * 
 * Multi-Device Sync Modes:
 * 1. Firebase Firestore Engine (when credentials are provided via firebase-config.js or Admin Cloud Setup Modal)
 * 2. Public Cloud WebSocket Engine (Zero-config instant multi-device push across the Internet for non-Firebase setups)
 * 3. Local Storage + BroadcastChannel (Instant single-device local tab sync)
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

let db = null;
let isFirebaseActive = false;
let cloudWs = null;
let cloudWsListeners = [];

const broadcastChannel = typeof BroadcastChannel !== 'undefined' 
  ? new BroadcastChannel('principal_notice_board_channel') 
  : null;

// Public WebSocket Relay for zero-config multi-device push across different computers/TVs
const PUBLIC_WS_URL = 'wss://demo.piesocket.com/v3/shree_lrt_noticeboard_channel_v2?api_key=VCXSpRpdUZJhOZBENGuiUDCYwq7PbgWKSdZE2FFY&notify_self=0';

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
      console.warn('⚠️ Firebase init error, falling back to Public Cloud WebSocket Relay:', err);
      isFirebaseActive = false;
    }
  } else {
    isFirebaseActive = false;
    console.info('⚡ Operating in Zero-Config Public Cloud Realtime Mode (Multi-Device Sync Ready).');
  }

  // Connect Public Cloud WebSocket Relay
  initCloudWebSocket();

  return { isCloudActive: isFirebaseActive || true, isFirebaseActive };
}

function initCloudWebSocket() {
  try {
    cloudWs = new WebSocket(PUBLIC_WS_URL);
    cloudWs.onopen = () => {
      console.log('🌐 Connected to Public Cloud Realtime Relay (Multi-Device Active)');
    };
    cloudWs.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload && payload.updatedAt) {
          // Update local storage cache
          localStorage.setItem('principal_board_data', JSON.stringify(payload));
          // Notify active listeners on display screen live!
          cloudWsListeners.forEach(cb => cb(payload, { source: 'cloud-relay', isOnline: true }));
        }
      } catch (e) {}
    };
    cloudWs.onclose = () => {
      // Reconnect automatically after 3 seconds
      setTimeout(initCloudWebSocket, 3000);
    };
  } catch (e) {}
}

/**
 * Subscribe to realtime board changes
 */
export function subscribeToBoard(callback) {
  let firebaseUnsub = null;

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
  } else {
    // Initial load from local state / cloud cache
    const initialData = getLocalState();
    callback(initialData, { source: 'cloud-relay', isOnline: true });

    // Register Cloud WebSocket listener
    cloudWsListeners.push(callback);

    // Listen to local BroadcastChannel
    const channelHandler = (event) => {
      if (event.data) {
        callback(event.data, { source: 'local-broadcast', isOnline: true });
      }
    };

    if (broadcastChannel) {
      broadcastChannel.addEventListener('message', channelHandler);
    }

    // Storage event for local cross-tab
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
      cloudWsListeners = cloudWsListeners.filter(cb => cb !== callback);
      if (broadcastChannel) {
        broadcastChannel.removeEventListener('message', channelHandler);
      }
      window.removeEventListener('storage', storageHandler);
    };
  }

  return () => {
    if (firebaseUnsub) firebaseUnsub();
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

  // 1. Save to local storage
  localStorage.setItem('principal_board_data', JSON.stringify(payload));
  
  // 2. Broadcast via Local BroadcastChannel
  if (broadcastChannel) {
    broadcastChannel.postMessage(payload);
  }

  // 3. Broadcast via Cloud WebSocket Relay across DIFFERENT devices over the Internet!
  if (cloudWs && cloudWs.readyState === WebSocket.OPEN) {
    try {
      cloudWs.send(JSON.stringify(payload));
    } catch (e) {}
  }

  // 4. Push to Firebase Firestore if configured
  if (isFirebaseActive && db) {
    const docRef = doc(db, COLLECTION_NAME, DOC_ID);
    await setDoc(docRef, payload);
  }

  return payload;
}

/**
 * Clear the notice board
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

  localStorage.setItem('principal_board_data', JSON.stringify(payload));
  if (broadcastChannel) {
    broadcastChannel.postMessage(payload);
  }

  if (cloudWs && cloudWs.readyState === WebSocket.OPEN) {
    try {
      cloudWs.send(JSON.stringify(payload));
    } catch (e) {}
  }

  if (isFirebaseActive && db) {
    const docRef = doc(db, COLLECTION_NAME, DOC_ID);
    await setDoc(docRef, payload);
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
