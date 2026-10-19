/* Service worker — cache zasobów statycznych (gra działa bez internetu w LAN). */

const CACHE_NAME = 'familiada-v1';
const ASSETS = [
  '/',
  '/shared/styles.css',
  '/shared/socket-client.js',
  '/tv/index.html',
  '/tv/tv.css',
  '/tv/tv.js',
  '/player/index.html',
  '/player/player.css',
  '/player/player.js',
  '/host/index.html',
  '/host/host.css',
  '/host/host.js',
  '/manifest.json',
  '/socket.io/socket.io.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // Nie cache'ujemy API ani WebSocketów
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/socket.io/')) return;

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request)
        .then((response) => {
          if (response.ok && url.origin === self.location.origin) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => caches.match('/'));
    })
  );
});
