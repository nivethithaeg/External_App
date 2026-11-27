/* Firebase Cloud Messaging background handler. Config is passed via the registration query string. */
importScripts('https://www.gstatic.com/firebasejs/11.1.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/11.1.0/firebase-messaging-compat.js');
const p = new URL(self.location.href).searchParams;
firebase.initializeApp({ apiKey: p.get('apiKey'), authDomain: p.get('authDomain'), projectId: p.get('projectId'), messagingSenderId: p.get('messagingSenderId'), appId: p.get('appId') });
const messaging = firebase.messaging();
messaging.onBackgroundMessage((payload) => {
  const n = payload.notification || {};
  self.registration.showNotification(n.title || 'PlaynX', { body: n.body, icon: '/favicon.png' });
});
