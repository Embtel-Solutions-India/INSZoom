import { getToken, onMessage } from "firebase/messaging";
import { messaging } from "../firebase";
import { notificationsApi } from "./api";

const VAPID_KEY = import.meta.env.VITE_FIREBASE_VAPID_KEY;
const SW_PATH = "/firebase-messaging-sw.js";
// Remembers which token we've already POSTed to the backend this browser,
// so re-running initializeNotifications() on every login/session-rehydrate
// doesn't spam identical requests (the backend upsert is harmless either
// way — this is purely to keep network traffic quiet).
const LAST_REGISTERED_KEY = "bais_fcm_token_registered";

function browserSupportsMessaging() {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "Notification" in window && Boolean(messaging);
}

function detectBrowser() {
  const ua = navigator.userAgent || "";
  if (ua.includes("Edg/")) return "Edge";
  if (ua.includes("Chrome/") && !ua.includes("Edg/")) return "Chrome";
  if (ua.includes("Firefox/")) return "Firefox";
  if (ua.includes("Safari/") && !ua.includes("Chrome/")) return "Safari";
  return "Unknown";
}

function detectPlatform() {
  return navigator.userAgentData?.platform || navigator.platform || "Unknown";
}

// Push notifications are an enhancement, never a gate — every function below
// resolves to null on any failure instead of throwing, so a caller that
// forgets to .catch() still can't break login/dashboard/documents/profile/
// payments/messages. This flag additionally stops re-attempting the
// registration/subscribe dance again for the rest of this page load once it's
// failed once (e.g. "no active Service Worker") — there's nothing about
// calling it again with the same browser state that would make it succeed,
// so retrying on every login/session-rehydrate within one page load was pure
// wasted work (and console noise) for a browser/deployment where it just
// doesn't work. A fresh page load (e.g. after a deployment that fixes the
// service worker) gets a clean attempt again.
let disabledThisPageLoad = false;

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
}

export async function registerServiceWorker() {
  if (!browserSupportsMessaging()) return null;
  try {
    await navigator.serviceWorker.register(SW_PATH);
    // register() resolving only means the registration exists, not that a
    // worker is actually controlling the page yet (first install, or right
    // after an update, there's a window with a registration but nothing
    // "active") — getToken() below needs an active worker, and calling it
    // too early is exactly what produces FCM's "no active Service Worker"
    // error. .ready resolves once one is actually active — bounded with a
    // timeout so a service worker that never activates can't leave this
    // hanging indefinitely (harmless since nothing awaits it blockingly, but
    // it should still resolve to a clear "unavailable" instead of dangling).
    const registration = await withTimeout(navigator.serviceWorker.ready, 10000);
    if (!registration) {
      console.warn("Notification service worker never became active; disabling push for this page load.");
      disabledThisPageLoad = true;
    }
    return registration;
  } catch (error) {
    console.warn("Notification service worker registration failed:", error.message);
    disabledThisPageLoad = true;
    return null;
  }
}

// Only prompts when permission hasn't been decided yet — never re-prompts
// once the user has granted or denied it, and never throws on denial.
export async function requestPermissionAndGetToken() {
  if (!browserSupportsMessaging() || disabledThisPageLoad) return null;

  if (Notification.permission === "denied") return null;
  if (Notification.permission === "default") {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return null;
  }
  if (Notification.permission !== "granted") return null;

  const registration = await registerServiceWorker();
  if (!registration) return null;

  try {
    const token = await getToken(messaging, { vapidKey: VAPID_KEY, serviceWorkerRegistration: registration });
    return token || null;
  } catch (error) {
    // "no active Service Worker" and similar PushManager.subscribe() failures
    // land here — logged once, then this browser/session stops retrying
    // (see disabledThisPageLoad above) instead of repeating the same failing
    // subscribe attempt on every subsequent login/session-rehydrate.
    console.warn("Unable to obtain FCM token:", error.message);
    disabledThisPageLoad = true;
    return null;
  }
}

export async function sendTokenToBackend(token) {
  if (!token) return null;
  try {
    await notificationsApi.registerDevice(token, { browser: detectBrowser(), platform: detectPlatform() });
    localStorage.setItem(LAST_REGISTERED_KEY, token);
    return token;
  } catch (error) {
    console.warn("Unable to register device token:", error.message);
    return null;
  }
}

// The single entry point called after login/session-rehydrate — safe to
// call repeatedly (no-ops gracefully on unsupported browsers or denied
// permission, and skips the network call if this exact token was already
// sent this browser).
export async function initializeNotifications() {
  const token = await requestPermissionAndGetToken();
  if (!token) return null;
  if (localStorage.getItem(LAST_REGISTERED_KEY) === token) return token;
  return sendTokenToBackend(token);
}

export function onForegroundMessage(callback) {
  if (!browserSupportsMessaging()) return () => {};
  return onMessage(messaging, callback);
}

export async function unregisterCurrentDevice() {
  const token = localStorage.getItem(LAST_REGISTERED_KEY);
  localStorage.removeItem(LAST_REGISTERED_KEY);
  if (!token) return;
  await notificationsApi.unregisterDevice(token).catch(() => {});
}
