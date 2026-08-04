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
  getDoc,
  onSnapshot 
} from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js';

const COLLECTION_NAME = 'noticeboard';
const DOC_ID = 'current';

let db = null;
let isFirebaseActive = false;

const broadcastChannel = (typeof BroadcastChannel !== 'undefined')
  ? new BroadcastChannel('principal_notice_board_channel')
  : null;

const DB_NAME = 'NoticeBoardDB';
const STORE_NAME = 'board_store';

function initDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = (e) => {
      e.target.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function setLocalStateDB(data) {
  try {
    const db = await initDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(data, 'current_board');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) {
    console.warn("IndexedDB save failed, falling back to localStorage", e);
    localStorage.setItem('principal_board_data', JSON.stringify(data));
  }
}

async function getLocalStateDB() {
  try {
    const db = await initDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get('current_board');
      req.onsuccess = () => resolve(req.result || getEmptyState());
      req.onerror = () => resolve(getEmptyState());
    });
  } catch (e) {
    return getLocalState();
  }
}

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
      async (docSnap) => {
        if (docSnap.exists()) {
          let data = docSnap.data();
          
          // Reconstruct any chunked media items from Firestore subcollection
          if (Array.isArray(data.images) && data.images.some(img => img && img.isChunked)) {
            try {
              const reconstructedImages = [];
              for (let i = 0; i < data.images.length; i++) {
                const imgItem = data.images[i];
                if (imgItem && imgItem.isChunked) {
                  const chunkPromises = [];
                  for (let c = 0; c < imgItem.totalChunks; c++) {
                    const chunkRef = doc(db, COLLECTION_NAME, DOC_ID, 'chunks', `${imgItem.chunkPrefix}${c}`);
                    chunkPromises.push(getDoc(chunkRef));
                  }
                  const chunkSnaps = await Promise.all(chunkPromises);
                  let fullMediaStr = '';
                  chunkSnaps.forEach(cSnap => {
                    if (cSnap.exists()) fullMediaStr += (cSnap.data().data || '');
                  });
                  reconstructedImages.push(fullMediaStr);
                } else {
                  reconstructedImages.push(imgItem);
                }
              }
              data.images = reconstructedImages;
            } catch (err) {
              console.error('Failed to reconstruct chunked media:', err);
            }
          }

          setLocalStateDB(data);
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
    getLocalStateDB().then(initialData => {
      callback(initialData, { source: 'local', isOnline: false });
    });

    const channelHandler = (event) => {
      if (event.data) {
        callback(event.data, { source: 'local', isOnline: false });
      }
    };
    if (broadcastChannel) broadcastChannel.addEventListener('message', channelHandler);

    return () => {
      if (broadcastChannel) broadcastChannel.removeEventListener('message', channelHandler);
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
    imageDuration: boardData.imageDuration || 5,
    videoLoops: boardData.videoLoops || 1,
    textDuration: boardData.textDuration !== undefined ? boardData.textDuration : 0,
    active: true,
    updatedAt: Date.now(),
    postedAtReadable: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
  };

  await setLocalStateDB(payload);
  if (broadcastChannel) broadcastChannel.postMessage(payload);

  if (isFirebaseActive && db) {
    try {
      window.dispatchEvent(new CustomEvent('cloud-upload-start'));

      const firestoreImages = [];
      const now = Date.now();
      // Increased to 750 KB to reduce total chunk count for large files
      const chunkSize = 750000;
      // Upload at most 4 chunks concurrently to avoid exhausting the Firestore write stream
      const BATCH_SIZE = 4;

      for (let i = 0; i < payload.images.length; i++) {
        const item = payload.images[i];
        if (typeof item === 'string' && item.length > chunkSize) {
          const totalChunks = Math.ceil(item.length / chunkSize);

          // Upload in sequential batches of BATCH_SIZE
          for (let batchStart = 0; batchStart < totalChunks; batchStart += BATCH_SIZE) {
            const batchEnd = Math.min(batchStart + BATCH_SIZE, totalChunks);
            const batchWrites = [];

            for (let c = batchStart; c < batchEnd; c++) {
              const chunkStr = item.substring(c * chunkSize, (c + 1) * chunkSize);
              const chunkRef = doc(db, COLLECTION_NAME, DOC_ID, 'chunks', `m${now}_${i}_c${c}`);
              batchWrites.push(setDoc(chunkRef, { data: chunkStr }));
            }

            // Wait for this batch to complete before starting the next
            await Promise.all(batchWrites);

            // Dispatch progress so admin.js can update the button label
            window.dispatchEvent(new CustomEvent('cloud-upload-progress', {
              detail: { uploaded: batchEnd, total: totalChunks, mediaIndex: i }
            }));
          }

          firestoreImages.push({
            isChunked: true,
            chunkPrefix: `m${now}_${i}_c`,
            totalChunks
          });
        } else {
          firestoreImages.push(item);
        }
      }

      const firestorePayload = { ...payload, images: firestoreImages };
      const docRef = doc(db, COLLECTION_NAME, DOC_ID);
      await setDoc(docRef, firestorePayload);

      console.log('🔥 Published to Firestore successfully with chunking');
      window.dispatchEvent(new CustomEvent('cloud-upload-success'));
    } catch (e) {
      console.error('❌ Firebase publish error:', e);
      let friendlyError = e;
      if (e && (e.code === 'permission-denied' || (e.message && e.message.includes('permission')))) {
        friendlyError = new Error('Permission Denied! In Firebase Console -> Firestore Database -> Rules, set "allow read, write: if true;"');
      }
      window.dispatchEvent(new CustomEvent('cloud-upload-error', { detail: friendlyError }));
      throw friendlyError;
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
    imageDuration: 5,
    videoLoops: 1,
    textDuration: 0,
    active: false,
    updatedAt: Date.now(),
    postedAtReadable: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
  };

  await setLocalStateDB(payload);
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
