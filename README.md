# 🏫 Principal's Live Notice Board

> A complete, real-time two-page notice board system designed for educational institutions. Allows a school principal to post announcements, text notices, and photo slideshows from any phone, tablet, or PC, pushing updates **instantly** to a Smart TV / digital notice board outside their office.

---

## 🌟 Key Features & Highlights

- **⚡ True Realtime Push Sync**: Powered by Firebase Firestore's `onSnapshot` subscription engine. Updates appear on the TV display in milliseconds without page refreshes or polling.
- **🔒 Passcode Gate Protected Admin Console (`admin.html`)**: Client-side authentication barrier with instant passcode verification, lock capability, and customizable security code.
- **🖼️ Multi-Image Upload & Canvas Compression**: Drag-and-drop or browse multiple images with client-side JPEG compression, thumbnail preview cards, and individual image removal before posting.
- **👁️ Live Preview Panel**: Side-by-side mirror display on the admin page that updates in real time as the principal types or attaches photos.
- **📺 Smart TV Display Board (`display.html`)**: High-contrast, large-typography executive screen optimized for viewing from across a room. Includes an automatic 5-second image slideshow, indicator dots, live clock & date, and empty state mode.
- **⤢ True Fullscreen Browser API**: One-click native browser fullscreen button (`requestFullscreen()`) with auto-hiding toggle tailored for smart TVs and kiosk displays.
- **🔄 Zero-Setup Local Fallback Engine**: Works instantly out of the box locally via `BroadcastChannel` and `LocalStorage` sync even before cloud API keys are entered!

---

## 📁 System Architecture & Files

```
Display_Board/
├── index.html            # Launcher Portal with quick links to Admin & Display
├── admin.html            # Principal's Control Console (Passcode, Form, Drag&Drop, Preview)
├── display.html          # Smart Board Screen for TV / Kiosk Display
├── css/
│   ├── common.css        # Glassmorphism, institutional palette, buttons, toasts
│   ├── admin.css         # Admin form, dropzone, thumbnail preview styling
│   └── display.css       # TV display layout, high contrast typography, slideshow
├── js/
│   ├── firebase-config.js# Firebase API key configuration & validator
│   ├── realtime-store.js # Realtime engine (Firestore onSnapshot + BroadcastChannel fallback)
│   ├── utils.js          # Image compressor, passcode manager, datetime formatters, toasts
│   ├── admin.js          # Admin console controller & event handlers
│   └── display.js        # Smart Board TV controller, clock, slideshow engine & fullscreen API
└── assets/
    └── crest.svg         # Official academic emblem vector asset
```

---

## ⚡ How Realtime Sync Works

1. **Firestore Push Subscription (`onSnapshot`)**:
   - The backend uses a single shared document `noticeboard/current` in Firebase Firestore.
   - When the Principal clicks **"Post to Board"** on `admin.html`, `setDoc()` writes the announcement payload directly to Firestore.
   - The TV display page (`display.html`) maintains an active WebSocket / HTTP long-poll listener via Firestore's `onSnapshot()`.
   - The instant Firestore receives the new document state, it pushes the updated data to all open `display.html` screens worldwide within ~100ms.

2. **Dual-Mode Fallback Engine**:
   - If Firebase API keys have not been configured yet, the system automatically uses browser `BroadcastChannel` and `storage` events.
   - This allows instant side-by-side testing between browser tabs on your computer without any initial setup required!

---

## 🚀 Step-by-Step Backend Setup (Firebase Firestore)

Follow these steps to connect your notice board to Firebase cloud database for multi-device sync across networks:

### Step 1: Create a Free Firebase Project
1. Go to the [Firebase Console](https://console.firebase.google.com/).
2. Click **Add project** (or **Create a project**).
3. Name your project (e.g. `school-notice-board`) and click **Continue**.
4. Disable Google Analytics (optional) and click **Create project**.

### Step 2: Set Up Firestore Database
1. In the left navigation menu of your project, click **Build** → **Firestore Database**.
2. Click **Create database**.
3. Select a location closest to your school and click **Next**.
4. Start in **Start in test mode** for initial testing, or configure standard rules:
   ```js
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /noticeboard/{document} {
         allow read, write: if true;
       }
     }
   }
   ```
5. Click **Create**.

### Step 3: Register Web App & Get Configuration Keys
1. On your Firebase Project Overview page, click the **Web icon (`</>`)** to add an app.
2. Enter an App nickname (e.g. `Principal Board Web`) and click **Register app**.
3. Copy the `firebaseConfig` object shown in the SDK setup section:
   ```javascript
   const firebaseConfig = {
     apiKey: "AIzaSy...",
     authDomain: "school-notice-board.firebaseapp.com",
     projectId: "school-notice-board",
     storageBucket: "school-notice-board.appspot.com",
     messagingSenderId: "123456789",
     appId: "1:123456789:web:abcdef..."
   };
   ```

### Step 4: Add Keys to Project Code
Open `js/firebase-config.js` in your editor and paste your credentials into the `firebaseConfig` object:

```javascript
export const firebaseConfig = {
  apiKey: "AIzaSy...",
  authDomain: "school-notice-board.firebaseapp.com",
  projectId: "school-notice-board",
  storageBucket: "school-notice-board.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abcdef..."
};
```
Save the file. Both pages will automatically switch from local mode to **Cloud Realtime Sync**!

---

## 🔑 How to Change the Admin Passcode

- **Default Passcode**: `1234`
- **Method 1 (UI)**:
  1. Open `admin.html` and unlock the console.
  2. Click the **🔑 Passcode** button in the header.
  3. Enter the current passcode followed by your new 4+ digit security code.
  4. The code is saved to your browser's persistent `localStorage`.
- **Method 2 (Code Default)**:
  Edit line 6 of `js/utils.js`:
  ```javascript
  const DEFAULT_PASSCODE = '9876'; // Set your default code here
  ```

> *Security Note*: The passcode gate is a client-side access control suitable for office convenience. To upgrade to multi-user enterprise auth in the future, Firebase Authentication (`signInWithEmailAndPassword`) can be integrated cleanly into `admin.js`.

---

## 🌐 How to Deploy & Host

Since this is a lightweight static web app using ES modules, you can host it for free on any platform:

### Option A: Local Network / Vite Development Server
Run locally in your terminal:
```bash
npm install
npm run dev
```
Open `http://localhost:5173/admin.html` on the principal's computer/phone and `http://localhost:5173/display.html` on the TV browser.

### Option B: Free Cloud Hosting (Vercel / Netlify / GitHub Pages)
1. Push the project repository to GitHub.
2. Import the repository into [Vercel](https://vercel.com) or [Netlify](https://netlify.com).
3. Set build command to empty/none or `npm run build` and output directory to `./`.
4. Deploy! You will receive a HTTPS URL accessible from anywhere (e.g. `https://school-notice-board.vercel.app/display.html`).

---

## 🛡️ Edge Cases Handled

1. **Empty / Incomplete Announcements**:
   - If principal clicks post with no title, message, or photos, a validation toast prevents empty submissions.
   - If principal clicks "Clear Board", display page smoothly reverts to a calm empty state ("No Active Announcements") with the school emblem watermark.
2. **Single vs Multiple Images**:
   - **0 images**: Content container expands to full width.
   - **1 image**: Displayed as a clean static photo frame without rotation or dot indicators.
   - **Multiple images**: Automatic smooth 5-second crossfade rotation with active dot indicators.
3. **Very Long Announcement Messages**:
   - Announcement text card handles multi-line overflow using custom styled scrolling and balanced typography so text never breaks layout.
4. **Temporary Network Disconnection**:
   - If internet drops momentarily on the TV, the display retains the last received notice in state without crashing or blanking out, and the status badge indicates offline sync status.
