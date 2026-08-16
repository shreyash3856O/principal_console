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
    const dbInstance = await initDB();
    return new Promise((resolve, reject) => {
      const tx = dbInstance.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(data, 'current_board');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) {
    console.warn("IndexedDB save failed, falling back to localStorage", e);
    try {
      localStorage.setItem('principal_board_data', JSON.stringify(data));
    } catch (err) {
      console.warn("localStorage quota exceeded for local backup", err);
    }
  }
}

async function getLocalStateDB() {
  try {
    const dbInstance = await initDB();
    return new Promise((resolve, reject) => {
      const tx = dbInstance.transaction(STORE_NAME, 'readonly');
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
 * Fetch a single media item (reconstructing chunks if necessary)
 */
async function fetchMediaItem(itemRef) {
  if (!itemRef) return null;
  if (typeof itemRef === 'string') return itemRef;
  
  const itemDocRef = doc(db, COLLECTION_NAME, DOC_ID, 'mediaItems', itemRef.id);
  const itemSnap = await getDoc(itemDocRef);
  if (!itemSnap.exists()) return null;
  
  const itemData = itemSnap.data();
  if (!itemData.isChunked) {
    return itemData.data || null;
  }
  
  // Reconstruct chunked media item
  const chunkPromises = [];
  for (let c = 0; c < itemData.totalChunks; c++) {
    const chunkRef = doc(db, COLLECTION_NAME, DOC_ID, 'mediaItems', `${itemRef.id}_c${c}`);
    chunkPromises.push(getDoc(chunkRef));
  }
  const chunkSnaps = await Promise.all(chunkPromises);
  let fullStr = '';
  chunkSnaps.forEach(cSnap => {
    if (cSnap.exists()) fullStr += (cSnap.data().data || '');
  });
  return fullStr;
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
          
          // Case 1: Subcollection media architecture (New high-capacity format)
          if (Array.isArray(data.mediaRefs)) {
            try {
              const fetchPromises = data.mediaRefs.map(ref => fetchMediaItem(ref));
              const reconstructedImages = await Promise.all(fetchPromises);
              data.images = reconstructedImages.filter(Boolean);
            } catch (err) {
              console.error('Failed to load subcollection media items:', err);
            }
          } 
          // Case 2: Legacy chunked format compatibility
          else if (Array.isArray(data.images) && data.images.some(img => img && img.isChunked)) {
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
              console.error('Failed to reconstruct legacy chunked media:', err);
            }
          }

          // Fetch dedicated custom loop image if stored separately
          if (data.loopConfig && data.loopConfig.hasCustomLoopImageDoc) {
            try {
              const loopImgStr = await fetchMediaItem({ id: 'loop_image_item' });
              if (loopImgStr) {
                data.loopConfig.loopImage = loopImgStr;
              }
            } catch (err) {
              console.error('Failed to load custom loop image doc:', err);
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
 * Upload a media string to subcollection documents (500KB per document chunk)
 */
async function uploadMediaItemToSubcollection(itemId, mediaStr, onProgressBatch) {
  const CHUNK_SIZE = 500000;
  
  if (mediaStr.length <= CHUNK_SIZE) {
    const itemRef = doc(db, COLLECTION_NAME, DOC_ID, 'mediaItems', itemId);
    await setDoc(itemRef, { data: mediaStr, isChunked: false, updatedAt: Date.now() });
  } else {
    const totalChunks = Math.ceil(mediaStr.length / CHUNK_SIZE);
    const BATCH_SIZE = 4;

    for (let batchStart = 0; batchStart < totalChunks; batchStart += BATCH_SIZE) {
      const batchEnd = Math.min(batchStart + BATCH_SIZE, totalChunks);
      const batchWrites = [];

      for (let c = batchStart; c < batchEnd; c++) {
        const chunkStr = mediaStr.substring(c * CHUNK_SIZE, (c + 1) * CHUNK_SIZE);
        const chunkRef = doc(db, COLLECTION_NAME, DOC_ID, 'mediaItems', `${itemId}_c${c}`);
        batchWrites.push(setDoc(chunkRef, { data: chunkStr }));
      }

      await Promise.all(batchWrites);
      if (onProgressBatch) onProgressBatch(batchEnd, totalChunks);
    }

    const itemRef = doc(db, COLLECTION_NAME, DOC_ID, 'mediaItems', itemId);
    await setDoc(itemRef, { isChunked: true, totalChunks, updatedAt: Date.now() });
  }
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
    loopConfig: boardData.loopConfig || {
      enabled: false,
      interval: 30,
      duration: 5,
      type: 'text',
      loopImage: null
    },
    active: true,
    updatedAt: Date.now(),
    postedAtReadable: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
  };

  await setLocalStateDB(payload);
  if (broadcastChannel) broadcastChannel.postMessage(payload);

  if (isFirebaseActive && db) {
    try {
      window.dispatchEvent(new CustomEvent('cloud-upload-start'));

      const mediaRefs = [];
      const totalItems = payload.images.length;
      
      let totalChunksCount = 0;
      payload.images.forEach(img => {
        if (typeof img === 'string') {
          totalChunksCount += Math.ceil(img.length / 500000);
        }
      });
      if (payload.loopConfig && payload.loopConfig.loopImage) {
        totalChunksCount += Math.ceil(payload.loopConfig.loopImage.length / 500000);
      }

      let uploadedChunksSoFar = 0;

      for (let i = 0; i < payload.images.length; i++) {
        const item = payload.images[i];
        const itemId = `item_${i}`;

        await uploadMediaItemToSubcollection(itemId, item, (batchEnd, totalItemChunks) => {
          uploadedChunksSoFar += batchEnd;
          window.dispatchEvent(new CustomEvent('cloud-upload-progress', {
            detail: { uploaded: uploadedChunksSoFar, total: totalChunksCount, mediaIndex: i }
          }));
        });

        mediaRefs.push({ id: itemId, type: item.startsWith('data:video/') ? 'video' : 'image' });
      }

      let hasCustomLoopImageDoc = false;
      let cleanLoopConfig = { ...payload.loopConfig };

      if (payload.loopConfig && payload.loopConfig.loopImage) {
        await uploadMediaItemToSubcollection('loop_image_item', payload.loopConfig.loopImage, null);
        hasCustomLoopImageDoc = true;
        delete cleanLoopConfig.loopImage;
      }
      cleanLoopConfig.hasCustomLoopImageDoc = hasCustomLoopImageDoc;

      // The main document noticeboard/current MUST be tiny (< 5 KB)
      const firestorePayload = {
        title: payload.title,
        message: payload.message,
        imageDuration: payload.imageDuration,
        videoLoops: payload.videoLoops,
        textDuration: payload.textDuration,
        loopConfig: cleanLoopConfig,
        mediaCount: mediaRefs.length,
        mediaRefs: mediaRefs,
        active: true,
        updatedAt: payload.updatedAt,
        postedAtReadable: payload.postedAtReadable
      };

      const docRef = doc(db, COLLECTION_NAME, DOC_ID);
      await setDoc(docRef, firestorePayload);

      console.log('🔥 Published to Firestore successfully with subcollection media isolation');
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
    loopConfig: { enabled: false, interval: 30, duration: 5, type: 'text', loopImage: null },
    active: false,
    updatedAt: Date.now(),
    postedAtReadable: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
  };

  await setLocalStateDB(payload);
  if (broadcastChannel) broadcastChannel.postMessage(payload);

  if (isFirebaseActive && db) {
    try {
      const docRef = doc(db, COLLECTION_NAME, DOC_ID);
      await setDoc(docRef, {
        title: '',
        message: '',
        mediaCount: 0,
        mediaRefs: [],
        active: false,
        updatedAt: Date.now()
      });
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
    loopConfig: { enabled: false, interval: 30, duration: 5, type: 'text', loopImage: null },
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

