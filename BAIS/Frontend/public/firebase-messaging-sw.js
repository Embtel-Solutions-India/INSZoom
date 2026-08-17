importScripts("https://www.gstatic.com/firebasejs/12.12.1/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/12.12.1/firebase-messaging-compat.js");

// Values below are the public Firebase Web config (apiKey/appId/etc are
// project identifiers, not secrets — see Firebase's own docs) for the BAIS
// client portal's Web App registration in the shared white-cedar-504623-u1
// project. A service worker in /public is served as a static file, not run
// through Vite's env-var pipeline, so these can't be injected from
// import.meta.env at build time — they're kept in sync with
// BAIS/Frontend/.env's VITE_FIREBASE_* values by hand.
firebase.initializeApp({
  apiKey: "AIzaSyBgLRH9QGJaQfKyLdPG1hp6bKwDcMqPsIU",
  authDomain: "white-cedar-504623-u1.firebaseapp.com",
  projectId: "white-cedar-504623-u1",
  storageBucket: "white-cedar-504623-u1.firebasestorage.app",
  messagingSenderId: "839144138598",
  appId: "1:839144138598:web:11ce1750713d8e253acaa7",
});

const messaging = firebase.messaging();

// Fires only when no BAIS tab is focused (foreground messages are handled
// in-app instead — see notificationService.js's onForegroundMessage, used
// by NotificationBell.jsx — so the same notification is never shown twice).
messaging.onBackgroundMessage((payload) => {
  const link = payload.data?.link || payload.fcmOptions?.link || "/";
  self.registration.showNotification(payload.notification?.title || "New notification", {
    body: payload.notification?.body,
    icon: "/favicon.svg",
    data: { link },
  });
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const link = event.notification.data?.link || "/";
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin)) {
          client.postMessage({ type: "notification-click", link });
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(link);
      return undefined;
    })
  );
});
