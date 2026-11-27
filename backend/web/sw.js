/* PlaynX service worker: makes the site installable and lets it open offline.
 * It never stores API responses, payments or anything personal: only the app's own files. */
const VERSION = 'playnx-v2';
const SHELL = ['/', '/favicon.png', '/manifest.webmanifest', '/icons/icon-192.png'];

self.addEventListener('install', (e) => { e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request; const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return; // payments, Google, fonts and anything cross-site go straight to the network
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/socket.io') || url.pathname === '/sw.js' || url.pathname.startsWith('/firebase-')) return;
  if (req.mode === 'navigate') { // pages: the network first, so people always see the latest; the saved shell when offline
    e.respondWith(fetch(req).catch(() => caches.match('/').then((r) => r || Response.error())));
    return;
  }
  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/')) { // built files have unique names, so they are safe to keep
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => { if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); } return res; })));
  }
});
