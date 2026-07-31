/**
 * Firebase Configuration for Principal's Live Notice Board
 * 
 * Replace the values below with your Firebase Project configuration details.
 * See README.md for step-by-step instructions on setting up Firebase Firestore.
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
 * Get active Firebase configuration (checks localStorage for custom user credentials first)
 */
export function getActiveFirebaseConfig() {
  try {
    const saved = localStorage.getItem('custom_firebase_config');
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed && parsed.apiKey && !parsed.apiKey.includes("YOUR_API_KEY")) {
        return parsed;
      }
    }
  } catch (e) {}
  return firebaseConfig;
}

/**
 * Returns true if user has provided active Firebase project keys.
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
