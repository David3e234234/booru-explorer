const CACHE_NAME = 'booru-explorer-v6.5';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/css/variables.css',
  '/css/main.css',
  '/css/components.css',
  '/css/viewer.css',
  '/js/state.js',
  '/js/api.js',
  '/js/app.js',
  '/js/gallery.js',
  '/js/viewer.js',
  '/js/autocomplete.js',
  '/icons/icon.svg'
];

// Установка Service Worker и предварительное кэширование App Shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[ServiceWorker] Кэширование App Shell v5.0');
      return cache.addAll(STATIC_ASSETS).catch(err => {
        console.warn('[ServiceWorker] Не удалось закэшировать часть ресурсов:', err);
      });
    }).then(() => self.skipWaiting())
  );
});

// Активация и очистка старых версий кэша
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('[ServiceWorker] Удаление устаревшего кэша:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Перехват запросов (Network First для статики с фоллбэком на кэш)
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Игнорируем не-GET запросы и сторонние API вызовы
  if (event.request.method !== 'GET') return;

  // Кэширование запросов Избранного (/api/favorites)
  if (url.pathname === '/api/favorites') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const resClone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, resClone));
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Network First для статических файлов приложения (HTML, CSS, JS, SVG, JSON)
  if (
    url.origin === self.location.origin &&
    (url.pathname === '/' ||
     url.pathname.endsWith('.html') ||
     url.pathname.endsWith('.css') ||
     url.pathname.endsWith('.js') ||
     url.pathname.endsWith('.svg') ||
     url.pathname.endsWith('.json'))
  ) {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const resClone = networkResponse.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, resClone));
          }
          return networkResponse;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Для прочих запросов (API, видео, прокси) - прямой сетевой запрос с фоллбэком на кэш
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});
