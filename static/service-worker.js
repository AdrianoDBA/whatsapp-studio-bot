const CACHE = 'bot-studio-v3';
const PRECACHE_URLS = [
  '/comecar',
  '/manifest.json',
  '/static/manifest.json',
  '/static/icon-192.png',
  '/static/icon-512.png',
  '/static/qr-comecar.png'
];

// ============================================================================
// INDEXEDDB NO CELULAR (PWA OFFLINE STORAGE)
// Database: BotStudio (v1)
// Stores: contacts (key: wa_id), ensaios (key: id), fila_offline (autoIncrement)
// ============================================================================
function openStudioDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("BotStudio", 1);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains("contacts")) {
        db.createObjectStore("contacts", { keyPath: "wa_id" });
      }
      if (!db.objectStoreNames.contains("ensaios")) {
        db.createObjectStore("ensaios", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("fila_offline")) {
        db.createObjectStore("fila_offline", { autoIncrement: true });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// Inicializa IndexedDB na ativação
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(PRECACHE_URLS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      openStudioDB().catch((e) => console.log('[ServiceWorker IDB init error]', e)),
      caches.keys().then((keys) =>
        Promise.all(
          keys.map((key) => {
            if (key !== CACHE && !key.startsWith('studio-bot-')) {
              return caches.delete(key);
            }
            return null;
          })
        )
      )
    ])
  );
  self.clients.claim();
});

// Cache-first strategy with network fallback
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/webhook') || url.pathname.startsWith('/lgpd/')) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        // Refresh cache in background
        fetch(event.request)
          .then((networkResponse) => {
            if (networkResponse && networkResponse.status === 200) {
              caches.open(CACHE).then((cache) => cache.put(event.request, networkResponse));
            }
          })
          .catch(() => {});
        return cachedResponse;
      }

      return fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const clone = networkResponse.clone();
            caches.open(CACHE).then((cache) => cache.put(event.request, clone));
          }
          return networkResponse;
        })
        .catch(() => caches.match('/comecar'));
    })
  );
});
