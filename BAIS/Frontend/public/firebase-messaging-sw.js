importScripts("https://www.gstatic.com/firebasejs/12.12.1/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/12.12.1/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyCSHRE5bTfzYvl_WUC-PVAPevSUFDK2jWw",
  authDomain: "react-oauth-7883c.firebaseapp.com",
  projectId: "react-oauth-7883c",
  storageBucket: "react-oauth-7883c.firebasestorage.app",
  messagingSenderId: "1048148448884",
  appId: "1:1048148448884:web:731dd818b1ed1046676321",
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const link = payload.data?.link || payload.fcmOptions?.link || "/";
  self.registration.showNotification(payload.notification?.title || "New notification", {
    body: payload.notification?.body,
    icon: "/favicon.svg",
    data: { link },
  });
});

// Clicking the OS-level notification focuses an already-open app tab if one
// exists, otherwise opens a new one — then navigates to the notification's
// actionUrl either way.
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
