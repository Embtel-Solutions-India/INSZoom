import { initializeApp, getApps, getApp } from "firebase/app";
import { getMessaging, getToken, onMessage, isSupported } from "firebase/messaging";

// Public Firebase Web config — apiKey/appId/etc identify the project, they
// are not secrets (Firebase's security boundary is server-side rules/App
// Check, not hiding these values). Never add FIREBASE_PRIVATE_KEY or any
// service-account field here — those stay backend-only (see
// Backend/src/config/firebase-admin.js).
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};
const VAPID_KEY = import.meta.env.VITE_FIREBASE_VAPID_KEY;

const LAST_REGISTERED_KEY = "inszoom_fcm_token_registered";

function firebaseConfigured() {
  return Boolean(
    firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.messagingSenderId && firebaseConfig.appId && VAPID_KEY
  );
}

function getFirebaseApp() {
  if (!firebaseConfigured()) return null;
  return getApps().length ? getApp() : initializeApp(firebaseConfig);
}

let messagingInstancePromise = null;
async function getMessagingInstance() {
  if (messagingInstancePromise) return messagingInstancePromise;
  messagingInstancePromise = (async () => {
    const app = getFirebaseApp();
    if (!app) return null;
    if (!(await isSupported().catch(() => false))) return null;
    return getMessaging(app);
  })();
  return messagingInstancePromise;
}

let swRegistrationPromise = null;
export async function registerServiceWorker() {
  if (!("serviceWorker" in navigator) || !firebaseConfigured()) return null;
  if (!swRegistrationPromise) {
    swRegistrationPromise = navigator.serviceWorker.register("/firebase-messaging-sw.js").catch(() => null);
  }
  return swRegistrationPromise;
}

async function getTokenIfPermissionGranted() {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return null;
  const [registration, messaging] = await Promise.all([registerServiceWorker(), getMessagingInstance()]);
  if (!registration || !messaging) return null;
  try {
    return await getToken(messaging, { vapidKey: VAPID_KEY, serviceWorkerRegistration: registration });
  } catch {
    return null;
  }
}

export async function sendTokenToBackend(token) {
  if (!token) return null;
  const { notificationsApi } = await import("./api");
  await notificationsApi.registerDevice(token, { browser: navigator.userAgent, platform: navigator.platform });
  localStorage.setItem(LAST_REGISTERED_KEY, token);
  return token;
}

// Called on every login/mount (AuthContext.jsx) — must NEVER itself trigger
// the browser's permission prompt. Only proceeds if permission was already
// granted in a past visit (e.g. re-registers a rotated token); if the user
// hasn't decided yet ("default") or denied it, this silently resolves to
// null. The actual prompt only fires from requestPermissionAndGetToken(),
// which must be wired to an explicit user action (a button/toggle).
export async function initializeNotifications() {
  const token = await getTokenIfPermissionGranted();
  if (!token) return null;
  return sendTokenToBackend(token);
}

// USER-DRIVEN ONLY — call this from a click handler (an "Enable
// notifications" action), never from a mount effect or page load.
export async function requestPermissionAndGetToken() {
  if (typeof Notification === "undefined" || !firebaseConfigured()) return null;
  if (Notification.permission === "default") {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return null;
  } else if (Notification.permission !== "granted") {
    return null;
  }
  const token = await getTokenIfPermissionGranted();
  if (!token) return null;
  return sendTokenToBackend(token);
}

// Returns an unsubscribe function synchronously (NotificationContext.jsx
// relies on this from a useEffect cleanup) even though Firebase Messaging
// itself only resolves asynchronously.
export function onForegroundMessage(callback) {
  let unsubscribed = false;
  let detach = () => {};
  getMessagingInstance().then((messaging) => {
    if (!messaging || unsubscribed) return;
    detach = onMessage(messaging, callback);
  });
  return () => {
    unsubscribed = true;
    detach();
  };
}

export async function unregisterCurrentDevice() {
  const token = localStorage.getItem(LAST_REGISTERED_KEY);
  localStorage.removeItem(LAST_REGISTERED_KEY);
  if (!token) return;
  const { notificationsApi } = await import("./api");
  await notificationsApi.unregisterDevice(token).catch(() => {});
}
