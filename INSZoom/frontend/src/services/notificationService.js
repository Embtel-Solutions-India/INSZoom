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

export async function registerServiceWorker() {
  if (!browserSupportsMessaging()) return null;
  try {
    return await navigator.serviceWorker.register(SW_PATH);
  } catch (error) {
    console.warn("Notification service worker registration failed:", error.message);
    return null;
  }
}

// Only prompts when permission hasn't been decided yet — never re-prompts
// once the user has granted or denied it, and never throws on denial.
export async function requestPermissionAndGetToken() {
  if (!browserSupportsMessaging()) return null;

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
    console.warn("Unable to obtain FCM token:", error.message);
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
