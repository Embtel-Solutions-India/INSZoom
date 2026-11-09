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
    swRegistrationPromise = navigator.serviceWorker.register("/firebase-messaging-sw.js").then((registration) => {
      // People who already pressed "Enable notifications" keep the old worker until the browser's own daily check; asking now means they get the current one
      // on this very visit (best effort: a failed check changes nothing).
      try { Promise.resolve(registration?.update?.()).catch(() => {}); } catch { /* ignore */ }
      return registration;
    }).catch(() => null);
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

// The sticky button can be closed with its X. Closing only hides it for this browser session (sessionStorage), and it is cleared on
// logout, so a person who closed it and never allowed notifications sees the button again at their next login. Once notifications ARE
// enabled the button never shows (the browser permission + this device's push token are the saved preference).
const DISMISS_KEY = "push_prompt_dismissed";
export function isPushPromptDismissed() {
  try { return sessionStorage.getItem(DISMISS_KEY) === "1"; } catch { return false; }
}
export function dismissPushPrompt() {
  try { sessionStorage.setItem(DISMISS_KEY, "1"); } catch { /* optional */ }
}
export function resetPushPromptDismissal() {
  try { sessionStorage.removeItem(DISMISS_KEY); } catch { /* optional */ }
}

export async function unregisterCurrentDevice() {
  resetPushPromptDismissal();
  const token = localStorage.getItem(LAST_REGISTERED_KEY);
  localStorage.removeItem(LAST_REGISTERED_KEY);
  if (!token) return;
  const { notificationsApi } = await import("./api");
  await notificationsApi.unregisterDevice(token).catch(() => {});
}

// Drives the sticky "Enable notifications" button. 'enabled' (permission
// granted AND this browser's token registered for the signed-in account) is
// the only state that hides it; it comes back by itself if the user later
// blocks/resets notifications in the browser or the token is lost.
export async function getPushStatus() {
  if (needsIosInstall()) return "install_ios"; // iPhone / iPad outside the Home Screen: the button explains how to add it
  if (typeof Notification === "undefined" || !("serviceWorker" in navigator) || !firebaseConfigured()) return "unsupported";
  if (!(await getMessagingInstance())) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  if (Notification.permission !== "granted") return "default";
  const token = await getTokenIfPermissionGranted().catch(() => null);
  if (!token) return "default";
  // Permission granted AND this browser holds a push token: that is "enabled". Registering the token on the account is best-effort
  // (repeated on every visit) and must never bring the button back, e.g. when the first request races the login.
  sendTokenToBackend(token).catch(() => {});
  return "enabled";
}

// ── a new MESSAGE while the Admin app is open and focused ───────────────────────────────────────────────────────────────────────────
// The browser shows a push by itself (through the service worker) only when the app is closed or in the background. While the app is open
// and focused, Firebase hands the message to the page instead and nothing would be shown. The internal team is never e-mailed about a
// message, so a person who is working in the app but NOT on the Messages page must still get the browser notification: this shows it.
// A message in the chat they are looking at is not shown (it appears there live); a message in any other chat is. Only message notifications; never throws.
const MESSAGE_PUSH_TYPES = new Set(["message_received", "attorney_feedback"]);


function isWatchingNow() {
  try { return document.visibilityState === "visible" && document.hasFocus(); } catch { return false; }
}

// ── which chat is open? ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Like WhatsApp: a message is silent ONLY when it belongs to the chat the person is looking at right now (this window focused, this tab showing). A message
// in any OTHER chat - another client, a colleague, the same person in a different case - still notifies, on the Messages page too. The chat screens tell this
// module which chat they are showing (setOpenChat); the push says which chat a message belongs to (conversationId / caseId / senderId / kind).
const asText = (value) => (value ? String(value) : "");
let openChat = null; // { conversationId, caseId, userId, kind } of the chat on screen, or null

export function setOpenChat(chat) {
  openChat = chat && (chat.conversationId || chat.caseId || chat.userId)
    ? { conversationId: asText(chat.conversationId), caseId: asText(chat.caseId), userId: asText(chat.userId), kind: asText(chat.kind) }
    : null;
  markWatching();
}

// Is a message (the push's data) part of that chat?
export function isSameChat(chat, data) {
  if (!chat || !data) return false;
  if (chat.kind && data.kind && chat.kind !== asText(data.kind)) return false; // case messages and attorney feedback are different chats of one case
  const conversationId = asText(data.conversationId);
  const caseId = asText(data.caseId);
  const senderId = asText(data.senderId);
  if (chat.conversationId && conversationId && chat.conversationId === conversationId) return true;
  if (chat.caseId && caseId) return chat.caseId === caseId; // a case chat: one per case
  if (chat.userId && !caseId && senderId) return chat.userId === senderId; // a direct chat with that person
  return false;
}

// With several tabs of the app open, Firebase tells every one of them about a message. The tab that is really showing the chat leaves a short-lived mark (which
// chat) that the other tabs of this browser read, so none of them pops a notification for a chat the person is reading.
const WATCHING_KEY = "immiglance_watching_chat";
const WATCHING_FRESH_MS = 6000;
let iAmWatching = false;
function markWatching() {
  try {
    const watching = Boolean(openChat) && isWatchingNow();
    if (watching) localStorage.setItem(WATCHING_KEY, JSON.stringify({ t: Date.now(), chat: openChat }));
    else if (iAmWatching) localStorage.removeItem(WATCHING_KEY); // just stopped looking: the next message must notify at once
    iAmWatching = watching;
  } catch { /* storage unavailable: each tab simply decides for itself */ }
}
function anotherTabWatches(data) {
  try {
    const mark = JSON.parse(localStorage.getItem(WATCHING_KEY) || "null");
    return Boolean(mark) && Date.now() - Number(mark.t || 0) < WATCHING_FRESH_MS && isSameChat(mark.chat, data);
  } catch { return false; }
}
if (typeof window !== "undefined") {
  setInterval(markWatching, 2000);
  ["focus", "blur", "visibilitychange", "pagehide"].forEach((name) => window.addEventListener(name, markWatching));
}

// ── once per message ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Firebase tells EVERY open tab of the app about a message, and each tab would show its own copy. The first tab to claim a message (its notification id) shows
// it; the others find the claim and stay silent. Claims are kept in localStorage (shared by the tabs of this browser) and serialised with the Web Locks API
// where the browser has it, so two tabs can never both win; old claims are tidied away.
const CLAIM_PREFIX = "immiglance_notified_";
const CLAIM_KEEP_MS = 60 * 60 * 1000;
function takeClaim(key) {
  try {
    if (localStorage.getItem(key)) return false;
    localStorage.setItem(key, String(Date.now()));
    for (let i = localStorage.length - 1; i >= 0; i -= 1) {
      const name = localStorage.key(i);
      if (name && name.startsWith(CLAIM_PREFIX) && Date.now() - Number(localStorage.getItem(name) || 0) > CLAIM_KEEP_MS) localStorage.removeItem(name);
    }
    return true;
  } catch { return true; } // storage unavailable: show it (a missed message is worse than a rare repeat)
}
async function claimNotification(id) {
  if (!id) return true; // nothing to tell messages apart by
  const key = CLAIM_PREFIX + id;
  try {
    if (navigator.locks && typeof navigator.locks.request === "function") return await navigator.locks.request("immiglance-notify-claim", () => takeClaim(key));
  } catch { /* fall through to the plain check */ }
  return takeClaim(key);
}

export async function showMessagePushInForeground(payload) {
  try {
    if (!MESSAGE_PUSH_TYPES.has(payload?.data?.type)) return false;
    // Quiet only for a message in the chat the person is looking at right now (here, or in another tab of this browser); every other message notifies.
    if ((isWatchingNow() && isSameChat(openChat, payload?.data)) || anotherTabWatches(payload?.data)) return false;
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return false;
    const registration = await registerServiceWorker();
    if (!registration || typeof registration.showNotification !== "function") return false;
    if (!(await claimNotification(payload?.data?.notificationId))) return false; // another tab of this browser already showed this very message
    const tag = payload?.data?.tag;
    await registration.showNotification(payload?.notification?.title || payload?.data?.title || "New message", {
      body: payload?.notification?.body || payload?.data?.body,
      icon: "/icon-192.png",
      // the same tag the server sets: one notification per conversation, replaced (and re-alerted) by the next message
      ...(tag ? { tag, renotify: true } : {}),
      // read by the service worker's click handler: it focuses the app and opens this page
      data: { link: payload?.data?.link || payload?.fcmOptions?.link || "/", url: payload?.data?.url },
    });
    return true;
  } catch {
    return false;
  }
}

// ── iPhone / iPad ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Apple lets a website send notifications ONLY after it was added to the Home Screen (iOS / iPadOS 16.4 or newer); in a normal Safari tab the browser
// does not even offer the notification feature. So on an iPhone / iPad that is not running from the Home Screen yet, the "Enable notifications" button
// explains the two steps instead of silently disappearing.
export function isIosDevice() {
  try {
    const ua = navigator.userAgent || "";
    return /iPhone|iPad|iPod/i.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  } catch { return false; }
}
export function isStandalonePwa() {
  try {
    return navigator.standalone === true || (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches);
  } catch { return false; }
}
export function needsIosInstall() {
  return isIosDevice() && !isStandalonePwa();
}
export const IOS_INSTALL_HINT = "To get notifications on your iPhone: tap the Share button in Safari, choose “Add to Home Screen”, then open the app from your Home Screen and tap “Enable notifications”.";
