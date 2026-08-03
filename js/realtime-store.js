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
import { 
  getStorage, 
  ref as storageRef, 
  uploadBytes, 
  getDownloadURL 
} from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js';

const COLLECTION_NAME = 'noticeboard';
const DOC_ID = 'current';

let db = null;
let storage = null;
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
      storage = getStorage(app);
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
      const cloudPayload = { ...payload };

      if (cloudPayload.images && cloudPayload.images.length > 0) {

        // Fast-fail if Storage is not initialized
        if (!storage) {
          throw new Error('Firebase Storage not initialized. Please re-save your Firebase config with a valid Storage Bucket URL.');
        }

        window.dispatchEvent(new CustomEvent('cloud-upload-start'));
        console.log('⬆️ Starting upload of', cloudPayload.images.length, 'files to Firebase Storage...');

        const uploadedImages = [];
        for (let i = 0; i < cloudPayload.images.length; i++) {
          const imgSrc = cloudPayload.images[i];
          if (imgSrc.startsWith('data:')) {
            const isVideo = imgSrc.startsWith('data:video/');
            const mimeType = isVideo ? 'video/mp4' : 'image/jpeg';
            const fileExt = isVideo ? 'mp4' : 'jpg';
            const fileName = `noticeboard/media_${Date.now()}_${i}.${fileExt}`;

            console.log(`⬆️ Uploading file ${i + 1}/${cloudPayload.images.length} (${fileExt}, ~${Math.round(imgSrc.length / 1024)}KB base64)...`);

            // Convert base64 data URL to Blob
            const res = await fetch(imgSrc);
            const blob = await res.blob();
            console.log(`📦 Blob size: ${Math.round(blob.size / 1024)} KB`);

            const sRef = storageRef(storage, fileName);

            // Upload with 15s timeout — fail fast so user sees the error
            const uploadResult = await Promise.race([
              uploadBytes(sRef, blob, { contentType: mimeType }),
              new Promise((_, reject) =>
                setTimeout(() => reject(new Error(
                  `Upload timed out after 15s for file ${i + 1}. ` +
                  `Check: (1) Firebase Storage is enabled in your project, ` +
                  `(2) Storage rules allow writes, ` +
                  `(3) Storage Bucket URL in Cloud Setup is correct.`
                )), 15000)
              )
            ]);

            const downloadUrl = await getDownloadURL(uploadResult.ref);
            uploadedImages.push(downloadUrl);
            console.log(`✅ Uploaded file ${i + 1}:`, downloadUrl);
          } else {
            // Already a cloud URL
            uploadedImages.push(imgSrc);
          }
        }
        cloudPayload.images = uploadedImages;
      }

      const docRef = doc(db, COLLECTION_NAME, DOC_ID);
      await setDoc(docRef, cloudPayload);
      console.log('🔥 Published to Firebase Firestore successfully');

      window.dispatchEvent(new CustomEvent('cloud-upload-success'));
    } catch (e) {
      console.error('❌ Firebase publish error:', e.message);
      window.dispatchEvent(new CustomEvent('cloud-upload-error', { detail: e }));
      throw e;
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
