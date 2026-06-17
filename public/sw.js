const CACHE_NAME = 'menu-express-v2';
const urlsToCache = [
  '/',
  '/index.html',
  '/registro.html',
  '/manifest.json'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(urlsToCache))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const { url, method } = event.request;

  // Solo cachear GET/HEAD
  if (method !== 'GET' && method !== 'HEAD') {
    return;
  }

  // URLs que deben ser frescas prioritariamente (Network-First)
  const isPriorityApi = url.includes('/api/menu') || url.includes('/api/config') || url.includes('/api/clientes');

  if (isPriorityApi) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          if (response.status === 200) {
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then(cache => {
              cache.put(event.request, responseClone);
            });
          }
          return response;
        })
        .catch(() => 
          caches.match(event.request)
            .then(response => response || new Response('Sin conexión', { status: 503 }))
        )
    );
  } else {
    // Para otros recursos (estáticos), intentamos red primero pero con fallback a caché
    event.respondWith(
      fetch(event.request)
        .then(response => {
          if (response.status === 200) {
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then(cache => {
              cache.put(event.request, responseClone);
            });
          }
          return response;
        })
        .catch(() => 
          caches.match(event.request)
            .then(response => response || new Response('Sin conexión', { status: 503 }))
        )
    );
  }
});
