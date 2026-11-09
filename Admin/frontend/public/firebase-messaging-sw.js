importScripts("https://www.gstatic.com/firebasejs/12.12.1/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/12.12.1/firebase-messaging-compat.js");

// Values below are the public Firebase Web config (apiKey/appId/etc are
// project identifiers, not secrets — see Firebase's own docs) for INSZoom's
// own Web App registration (a different appId from Immiglance's) in the same
// shared white-cedar-504623-u1 project. A service worker in /public is
// served as a static file, not run through Vite's env-var pipeline, so
// these can't be injected from import.meta.env at build time — they're
// kept in sync with INSZoom/frontend/.env's VITE_FIREBASE_* values by hand.
firebase.initializeApp({
  apiKey: "AIzaSyBgLRH9QGJaQfKyLdPG1hp6bKwDcMqPsIU",
  authDomain: "white-cedar-504623-u1.firebaseapp.com",
  projectId: "white-cedar-504623-u1",
  storageBucket: "white-cedar-504623-u1.firebasestorage.app",
  messagingSenderId: "839144138598",
  appId: "1:839144138598:web:6c21c955aff3aa003acaa7",
});

// A new version of this worker takes over at once (it used to wait until every tab of the app was closed), so a fix to how notifications are shown reaches
// phones and computers that already allowed notifications without the person having to do anything.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

const messaging = firebase.messaging();

// Fires only when no INSZoom tab is focused (foreground messages are
// handled in-app instead — see notificationService.js's
// onForegroundMessage, used by NotificationContext.jsx — so the same
// notification is never shown twice).
messaging.onBackgroundMessage(async (payload) => {
  const link = payload.data?.link || payload.fcmOptions?.link || "/";
  const tag = payload.data?.tag;
  const title = payload.notification?.title || payload.data?.title || "New notification";
  const body = payload.notification?.body || payload.data?.body;
  // Firebase has ALREADY shown this notification itself (the push carries a "notification" part) just before it calls this handler. Showing it again with the
  // re-alert flag would make the phone / computer alert twice for one message, so when the very same notification is already on screen nothing more is done here.
  // A push Firebase did not show (no notification part) is still shown below.
  try {
    const shown = await self.registration.getNotifications();
    if (shown.some((existing) => existing.title === title && (existing.body || "") === (body || "") && Date.now() - (existing.timestamp || 0) < 15000)) return;
  } catch (error) {
    /* if the check cannot be made, show it: a missed message is worse than a rare repeat */
  }
  await self.registration.showNotification(title, {
    body,
    icon: "/icon-192.png", // a PNG: phones do not reliably draw an SVG notification icon
    // Same tag as the one the server sets: the browser shows ONE notification per conversation (and re-alerts on a new
    // message) instead of two copies or a growing pile.
    ...(tag ? { tag, renotify: true } : {}),
    // `url` = absolute address on this person's own portal (set by the server); `link` = in-app path.
    data: { link, url: payload.data?.url },
  });
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const link = event.notification.data?.link || "/";
  const url = event.notification.data?.url;
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin)) {
          client.postMessage({ type: "notification-click", link });
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(url || link);
      return undefined;
    })
  );
});
