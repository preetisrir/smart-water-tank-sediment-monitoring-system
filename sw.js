/* =========================================================
   SmartTank Progressive Web App (PWA) Service Worker
   Scope: /
   Caching Strategies:
     - App Shell & Static Assets: Stale-While-Revalidate / Cache-First
     - Web Fonts: Cache-First
     - Navigation Requests: Network-First with Offline App Shell Fallback
     - Telemetry & API Queries: Network-First with Offline Data Cache Fallback
   ========================================================= */

const CACHE_VERSION = 'v1.1.0';
const STATIC_CACHE = `smarttank-static-${CACHE_VERSION}`;
const RUNTIME_CACHE = `smarttank-runtime-${CACHE_VERSION}`;
const DATA_CACHE = `smarttank-data-${CACHE_VERSION}`;

// Core assets required for standalone offline operation
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/style.css',
  '/script.js',
  '/manifest.json',
  '/icon.svg',
  '/pwa-192x192.png',
  '/pwa-512x512.png',
  '/pwa-maskable-512x512.png',
  '/apple-touch-icon.png',
  '/favicon.ico'
];

// Install Event: Precache App Shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => {
      return cache.addAll(PRECACHE_ASSETS);
    }).then(() => {
      return self.skipWaiting();
    })
  );
});

// Activate Event: Purge old cache versions and claim clients
self.addEventListener('activate', (event) => {
  const currentCaches = [STATIC_CACHE, RUNTIME_CACHE, DATA_CACHE];
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (!currentCaches.includes(cacheName)) {
            console.log(`[PWA SW] Deleting outdated cache: ${cacheName}`);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
      return self.clients.claim();
    })
  );
});

// Fetch Event Handler with Strategy Routing
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Ignore non-HTTP/HTTPS requests (e.g. chrome-extension://)
  if (!url.protocol.startsWith('http')) {
    return;
  }

  // 1. Navigation Requests (Page Load / Refresh): Network-First, fall back to App Shell
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => {
        return caches.match('/index.html');
      })
    );
    return;
  }

  // 2. Google Fonts & Static CDNs: Cache-First
  if (url.hostname.includes('fonts.googleapis.com') || url.hostname.includes('fonts.gstatic.com')) {
    event.respondWith(
      caches.open(RUNTIME_CACHE).then((cache) => {
        return cache.match(request).then((cachedResponse) => {
          if (cachedResponse) return cachedResponse;
          return fetch(request).then((networkResponse) => {
            if (networkResponse.status === 200) {
              cache.put(request, networkResponse.clone());
            }
            return networkResponse;
          }).catch(() => cachedResponse);
        });
      })
    );
    return;
  }

  // 3. API Telemetry & Data Endpoints (/api/*): Network-First with Data Cache Fallback
  if (url.pathname.startsWith('/api/')) {
    // Only cache GET requests (safe for caching)
    if (request.method === 'GET') {
      event.respondWith(
        fetch(request)
          .then((networkResponse) => {
            if (networkResponse && networkResponse.status === 200) {
              const responseToCache = networkResponse.clone();
              caches.open(DATA_CACHE).then((cache) => {
                cache.put(request, responseToCache);
              });
            }
            return networkResponse;
          })
          .catch(async () => {
            // Offline fallback for API
            const cachedResponse = await caches.match(request);
            if (cachedResponse) {
              return cachedResponse;
            }
            // Return structured offline JSON response
            return new Response(
              JSON.stringify({
                offline: true,
                message: 'Operating in offline mode. Real-time updates paused until connectivity is restored.',
                timestamp: new Date().toISOString()
              }),
              {
                status: 200,
                headers: { 'Content-Type': 'application/json' }
              }
            );
          })
      );
      return;
    }

    // For POST/PUT/DELETE mutations when offline, let request attempt or return friendly offline error
    event.respondWith(
      fetch(request).catch(() => {
        return new Response(
          JSON.stringify({
            detail: 'You are currently offline. Control actions require an active connection.',
            offline: true
          }),
          {
            status: 503,
            statusText: 'Service Unavailable (Offline)',
            headers: { 'Content-Type': 'application/json' }
          }
        );
      })
    );
    return;
  }

  // 4. Static App Shell & Local Assets: Stale-While-Revalidate
  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      const fetchPromise = fetch(request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseToCache = networkResponse.clone();
            caches.open(STATIC_CACHE).then((cache) => {
              cache.put(request, responseToCache);
            });
          }
          return networkResponse;
        })
        .catch(() => cachedResponse);

      return cachedResponse || fetchPromise;
    })
  );
});

// Message listener for skipWaiting or manual cache purge
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
