/**
 * Firebase Configuration for Principal's Live Notice Board
 * 
 * You can paste your Firebase credentials into firebaseConfig below,
 * or use the "Cloud Setup" modal in the Admin Console.
 */

export const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId: "YOUR_APP_ID"
};

/**
 * Get active Firebase configuration.
 * Order of priority:
 * 1. URL Query Parameters (?apiKey=...&projectId=...)
 * 2. Custom localStorage credentials (saved via Admin Cloud Setup)
 * 3. Default firebaseConfig object above
 */
export function getActiveFirebaseConfig() {
  // Priority 1: Check URL search parameters
  try {
    if (typeof window !== 'undefined' && window.location && window.location.search) {
      const urlParams = new URLSearchParams(window.location.search);
      const qApiKey = urlParams.get('apiKey');
      const qProjectId = urlParams.get('projectId');
      const qAppId = urlParams.get('appId');
      const qSenderId = urlParams.get('messagingSenderId');

      if (qApiKey && qProjectId) {
        const qConfig = {
          apiKey: qApiKey,
          projectId: qProjectId,
          authDomain: urlParams.get('authDomain') || `${qProjectId}.firebaseapp.com`,
          // Support both old (.appspot.com) and new (.firebasestorage.app) bucket formats
          storageBucket: urlParams.get('storageBucket') || `${qProjectId}.firebasestorage.app`,
          messagingSenderId: qSenderId || '123456789',
          appId: qAppId || '1:123456789:web:app'
        };
        localStorage.setItem('custom_firebase_config', JSON.stringify(qConfig));
        return qConfig;
      }
    }
  } catch (e) {}

  // Priority 2: Check localStorage
  try {
    if (typeof localStorage !== 'undefined') {
      const saved = localStorage.getItem('custom_firebase_config');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && parsed.apiKey && !parsed.apiKey.includes("YOUR_API_KEY")) {
          return parsed;
        }
      }
    }
  } catch (e) {}

  // Priority 3: Fallback to static firebaseConfig
  return firebaseConfig;
}

/**
 * Returns true if active Firebase credentials are valid and non-placeholder.
 */
export function isFirebaseConfigured() {
  const config = getActiveFirebaseConfig();
  return Boolean(
    config &&
    config.apiKey &&
    !config.apiKey.includes("YOUR_API_KEY") &&
    config.projectId &&
    !config.projectId.includes("YOUR_PROJECT_ID")
  );
}

/**
 * Generate a direct self-configuring URL for TV / Phone display screens
 */
export function getShareableDisplayUrl() {
  const config = getActiveFirebaseConfig();
  const baseUrl = `${window.location.origin}/display.html`;
  if (!isFirebaseConfigured()) return baseUrl;

  const params = new URLSearchParams({
    apiKey: config.apiKey,
    projectId: config.projectId,
    appId: config.appId || '',
    messagingSenderId: config.messagingSenderId || ''
  });

  return `${baseUrl}?${params.toString()}`;
}
