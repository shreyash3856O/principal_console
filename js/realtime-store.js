/**
 * Realtime Data Store for Principal's Live Notice Board
 * 
 * Primary Mode: Firebase Firestore `onSnapshot` (True Push Realtime for multi-device sync across network)
 * Fallback Mode: BroadcastChannel + LocalStorage (Instant local tab sync before Firebase API keys are added)
 */

import { firebaseConfig, isFirebaseConfigured } from './firebase-config.js';

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
let isCloudActive = false;

const broadcastChannel = typeof BroadcastChannel !== 'undefined' 
  ? new BroadcastChannel('principal_notice_board_channel') 
  : null;

/**
 * Initialize backend connection
 */
export function initStore() {
  if (isFirebaseConfigured()) {
    try {
      const app = initializeApp(firebaseConfig);
      db = getFirestore(app);
      isCloudActive = true;
      console.log('⚡ Firebase Firestore Realtime Sync Initialized');
    } catch (err) {
      console.warn('⚠️ Firebase init error, reverting to local BroadcastChannel fallback:', err);
      isCloudActive = false;
    }
  } else {
    console.info('ℹ️ Firebase credentials not set. Operating in Local Realtime Broadcast Mode.');
    isCloudActive = false;
  }

  return { isCloudActive };
}

/**
 * Subscribe to realtime board changes
 * @param {Function} callback Called immediately and whenever data updates live
 * @returns {Function} Unsubscribe function
 */
export function subscribeToBoard(callback) {
  let firebaseUnsub = null;

  if (isCloudActive && db) {
    const docRef = doc(db, COLLECTION_NAME, DOC_ID);
    
    firebaseUnsub = onSnapshot(
      docRef,
      (docSnap) => {
        if (docSnap.exists()) {
          const data = docSnap.data();
          callback(data, { source: 'cloud', isOnline: true });
        } else {
          // Document doesn't exist yet, return empty state
          callback(getEmptyState(), { source: 'cloud', isOnline: true });
        }
      },
      (error) => {
        console.error('Firestore subscription error:', error);
        // Fall back to local storage if Firestore has connection error
        const localData = getLocalState();
        callback(localData, { source: 'local-fallback', isOnline: false, error });
      }
    );
  } else {
    // Local Broadcast / LocalStorage Fallback
    const initialData = getLocalState();
    callback(initialData, { source: 'local', isOnline: false });

    // Listen to BroadcastChannel
    const channelHandler = (event) => {
      if (event.data) {
        callback(event.data, { source: 'local-broadcast', isOnline: false });
      }
    };

    if (broadcastChannel) {
      broadcastChannel.addEventListener('message', channelHandler);
    }

    // Listen to window storage event (for cross-tab sync)
    const storageHandler = (e) => {
      if (e.key === 'principal_board_data' && e.newValue) {
        try {
          const data = JSON.parse(e.newValue);
          callback(data, { source: 'local-storage', isOnline: false });
        } catch (err) {}
      }
    };
    window.addEventListener('storage', storageHandler);

    return () => {
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
    images: boardData.images || [], // Array of compressed base64 image strings
    active: true,
    updatedAt: Date.now(),
    postedAtReadable: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
  };

  // Always save to localStorage & BroadcastChannel for zero-latency local state
  localStorage.setItem('principal_board_data', JSON.stringify(payload));
  if (broadcastChannel) {
    broadcastChannel.postMessage(payload);
  }

  // Push to Firebase Firestore if cloud mode is active
  if (isCloudActive && db) {
    const docRef = doc(db, COLLECTION_NAME, DOC_ID);
    await setDoc(docRef, payload);
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

  localStorage.setItem('principal_board_data', JSON.stringify(payload));
  if (broadcastChannel) {
    broadcastChannel.postMessage(payload);
  }

  if (isCloudActive && db) {
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
