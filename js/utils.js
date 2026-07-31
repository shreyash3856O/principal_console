/**
 * Utility functions for Principal's Live Notice Board
 */

// Default Admin Passcode (can be changed in localStorage)
const DEFAULT_PASSCODE = '1234';

/**
 * Check if the provided passcode is valid
 */
export function verifyPasscode(enteredCode) {
  const storedCode = localStorage.getItem('principal_board_passcode') || DEFAULT_PASSCODE;
  return enteredCode === storedCode;
}

/**
 * Update the stored admin passcode
 */
export function updatePasscode(oldCode, newCode) {
  if (!verifyPasscode(oldCode)) {
    return { success: false, message: 'Current passcode is incorrect.' };
  }
  if (!newCode || newCode.trim().length < 4) {
    return { success: false, message: 'New passcode must be at least 4 characters.' };
  }
  localStorage.setItem('principal_board_passcode', newCode.trim());
  return { success: true, message: 'Passcode updated successfully!' };
}

/**
 * Toast Notification System
 */
export function showToast(message, type = 'info', duration = 4000) {
  let container = document.querySelector('.toast-container');
  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  
  const icon = type === 'success' ? '✓' : type === 'error' ? '✕' : 'ℹ';
  
  toast.innerHTML = `
    <div style="font-weight: 700; font-size: 1.1rem; line-height: 1;">${icon}</div>
    <div style="flex: 1; font-size: 0.9rem;">${message}</div>
  `;

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = 'fadeOut 0.4s cubic-bezier(0.4, 0, 0.2, 1) forwards';
    setTimeout(() => toast.remove(), 400);
  }, duration);
}

/**
 * Compress an uploaded File/Blob to JPEG Base64 to stay well within Firestore's 1MB payload limits
 */
export function compressImage(file, maxWidth = 1000, quality = 0.7) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target.result;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;

        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }

        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        // Convert canvas to Data URL (JPEG)
        const compressedBase64 = canvas.toDataURL('image/jpeg', quality);
        resolve(compressedBase64);
      };
      img.onerror = (err) => reject(err);
    };
    reader.onerror = (err) => reject(err);
  });
}

/**
 * Format current date & time for TV Display
 */
export function getFormattedDateTime(dateObj = new Date()) {
  const timeStr = dateObj.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true
  });

  const dateStr = dateObj.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });

  return { timeStr, dateStr };
}

/**
 * Format timestamp into relative or concise time string
 */
export function formatTimestamp(ts) {
  if (!ts) return 'Never';
  const date = typeof ts === 'number' ? new Date(ts) : ts.toDate ? ts.toDate() : new Date(ts);
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  }) + ' • ' + date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
