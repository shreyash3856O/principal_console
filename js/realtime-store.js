/**
 * Realtime Data Store for Principal's Live Notice Board
 * 
 * Supports:
 * - Firebase Firestore (True realtime push across all devices when configured)
 * - LocalStorage & BroadcastChannel (Local tab-to-tab fallback)
 */

import { getActiveFirebaseConfig, isFirebaseConfigured } from './firebase-config.js';
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

const broadcastChannel = (typeof BroadcastChannel !== 'undefined')
  ? new BroadcastChannel('principal_notice_board_channel')
  : null;

/**
 * Initialize store
 */
export function initStore() {
  if (isFirebaseConfigured()) {
    try {
      const cfg = getActiveFirebaseConfig();
      const app = initializeApp(cfg);
      db = getFirestore(app);
      isFirebaseActive = true;
      console.log('⚡ Firebase Firestore Realtime Sync Connected:', cfg.projectId);
    } catch (err) {
      console.warn('⚠️ Firebase init error:', err);
      isFirebaseActive = false;
    }
  } else {
    isFirebaseActive = false;
    console.info('ℹ️ Firebase credentials not provided. Operating in Local Mode.');
  }

  return { isCloudActive: isFirebaseActive, isFirebaseActive };
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
          localStorage.setItem('principal_board_data', JSON.stringify(data));
          callback(data, { source: 'firebase', isOnline: true });
        } else {
          callback(getEmptyState(), { source: 'firebase', isOnline: true });
        }
      },
      (error) => {
        console.error('Firestore subscription error:', error);
        callback(getLocalState(), { source: 'local-fallback', isOnline: false, error });
      }
    );
  } else {
    // Local / BroadcastChannel Mode
    const initialData = getLocalState();
    callback(initialData, { source: 'local', isOnline: false });

    const channelHandler = (event) => {
      if (event.data) {
        callback(event.data, { source: 'local', isOnline: false });
      }
    };
    if (broadcastChannel) broadcastChannel.addEventListener('message', channelHandler);

    const storageHandler = (e) => {
      if (e.key === 'principal_board_data' && e.newValue) {
        try {
          const data = JSON.parse(e.newValue);
          callback(data, { source: 'local', isOnline: false });
        } catch (err) {}
      }
    };
    window.addEventListener('storage', storageHandler);

    return () => {
      if (broadcastChannel) broadcastChannel.removeEventListener('message', channelHandler);
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

  localStorage.setItem('principal_board_data', JSON.stringify(payload));
  if (broadcastChannel) broadcastChannel.postMessage(payload);

  if (isFirebaseActive && db) {
    try {
      const docRef = doc(db, COLLECTION_NAME, DOC_ID);
      await setDoc(docRef, payload);
      console.log('🔥 Published to Firebase Firestore successfully');
    } catch (e) {
      console.error('Firebase publish error:', e);
    }
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
  if (broadcastChannel) broadcastChannel.postMessage(payload);

  if (isFirebaseActive && db) {
    try {
      const docRef = doc(db, COLLECTION_NAME, DOC_ID);
      await setDoc(docRef, payload);
    } catch (e) {
      console.error('Firebase clear error:', e);
    }
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
