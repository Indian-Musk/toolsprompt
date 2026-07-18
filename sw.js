// public/sw.js

// Import Firebase App and Messaging (use importScripts for compatibility)
importScripts('https://www.gstatic.com/firebasejs/9.22.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.22.1/firebase-messaging-compat.js');

// Firebase config (same as your client config)
firebase.initializeApp({
  apiKey: "AIzaSyCgc0xRtijpyPhOovfwg-MzyahsUFh-hiQ",
  authDomain: "toolsprompt-5b07e.firebaseapp.com",
  projectId: "toolsprompt-5b07e",
  storageBucket: "toolsprompt-5b07e.firebasestorage.app",
  messagingSenderId: "402263780942",
  appId: "1:402263780942:web:1013a347dbb72db6b31d1f",
  measurementId: "G-K4KXR4FZCP"
});

const messaging = firebase.messaging();

// Handle background messages
messaging.onBackgroundMessage((payload) => {
  console.log('[firebase-messaging-sw.js] Received background message ', payload);

  const notificationTitle = payload.notification?.title || payload.data?.title || 'Tools Prompt';
  const notificationOptions = {
    body: payload.notification?.body || payload.data?.body || 'New update!',
    icon: payload.notification?.icon || '/logo.png',
    badge: '/logo.png',
    data: payload.data || {},
    vibrate: [200, 100, 200],
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});

// Optional: Handle notification click
self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(function(clientList) {
        // Try to focus an existing tab
        for (let i = 0; i < clientList.length; i++) {
          const client = clientList[i];
          if (client.url && client.url.includes('/') && 'focus' in client) {
            return client.focus();
          }
        }
        // If no tab, open a new one
        if (clients.openWindow) {
          return clients.openWindow('/');
        }
      })
  );
});