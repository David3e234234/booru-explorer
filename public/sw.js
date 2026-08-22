const CACHE_NAME = 'booru-explorer-v7.2';
const MEDIA_CACHE = 'booru-media-v7.2';
const MAX_MEDIA_ENTRIES = 400;
const MAX_CACHED_MEDIA_BYTES = 3 * 1024 * 1024;

// Заглушка для respondWith: без нее обрыв сети или потока падает с "неожиданной ошибкой" SW
const offlineResponse = () => new Response(null, { status: 504, statusText: 'Gateway Timeout' });

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
  '/js/modules/uiUtils.js',
  '/js/modules/filtersUI.js',
  '/js/modules/navigationUI.js',
  '/js/modules/drawers.js',
  '/js/modules/settingsModal.js',
  '/js/modules/sidebarTags.js',
  '/js/modules/authModal.js',
  '/js/modules/profileUI.js',
  '/js/modules/favoriteAuthorsUI.js',
  '/js/modules/subscriptionsUI.js',
  '/js/modules/pushManager.js',
  '/js/viewer/imageZoom.js',
  '/js/viewer/videoPlayer.js',
  '/js/viewer/viewerSidebar.js',
  '/icons/favicon.png',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/maskable-512.png',
  '/icons/apple-touch-icon.png',
  '/icons/icon.svg'
];

// Установка Service Worker и предварительное кэширование App Shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[ServiceWorker] Кэширование App Shell v7.2');
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
          if (key !== CACHE_NAME && key !== MEDIA_CACHE) {
            console.log('[ServiceWorker] Удаление устаревшего кэша:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Ограничение кэша медиа: LRU по порядку ключей (старые вытесняются первыми)
async function trimMediaCache() {
  const cache = await caches.open(MEDIA_CACHE);
  const keys = await cache.keys();
  if (keys.length > MAX_MEDIA_ENTRIES) {
    await Promise.all(keys.slice(0, keys.length - MAX_MEDIA_ENTRIES).map(k => cache.delete(k)));
  }
}

function isCacheableMediaResponse(response) {
  const type = response.headers.get('content-type') || '';
  if (!type.startsWith('image/')) return false;
  const len = parseInt(response.headers.get('content-length') || '0', 10);
  return len === 0 || len <= MAX_CACHED_MEDIA_BYTES;
}

// Перехват запросов
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Игнорируем не-GET запросы и сторонние API вызовы
  if (event.request.method !== 'GET') return;

  // Миниатюры через прокси неизменяемы (ключ = md5 от URL) — Cache First,
  // чтобы галерея открывалась мгновенно и была доступна офлайн
  if (
    url.origin === self.location.origin &&
    (url.pathname === '/api/proxy' || url.pathname === '/api/video-thumbnail')
  ) {
    event.respondWith(
      caches.open(MEDIA_CACHE).then(cache =>
        cache.match(event.request).then(cached => {
          if (cached) return cached;
          return fetch(event.request).then(response => {
            if (response && response.status === 200 && isCacheableMediaResponse(response)) {
              const resClone = response.clone();
              cache.put(event.request, resClone).then(() => trimMediaCache());
            }
            return response;
          }).catch(() => offlineResponse());
        })
      )
    );
    return;
  }

  // Кэширование запросов Избранного (/api/favorites) и выдачи поиска (/api/posts):
  // Network First с фоллбэком на последний успешный ответ для офлайн-просмотра
  if (url.pathname === '/api/favorites' || url.pathname === '/api/posts') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const resClone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, resClone));
          return response;
        })
        .catch(() => caches.match(event.request))
        .then((cached) => cached || offlineResponse())
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
        .then((cached) => cached || offlineResponse())
    );
    return;
  }

  // Для прочих запросов (API, видео, прокси) - прямой сетевой запрос с фоллбэком на кэш
  event.respondWith(
    fetch(event.request)
      .catch(() => caches.match(event.request))
      .then((cached) => cached || offlineResponse())
  );
});

// ── Push-уведомления ──

self.addEventListener('push', (event) => {
  let payload = { title: 'Booru Explorer', body: 'Новые посты по вашим подпискам', url: '/' };
  try {
    if (event.data) {
      payload = { ...payload, ...event.data.json() };
    }
  } catch (err) {
    if (event.data) payload.body = event.data.text();
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: '/icons/icon-192.png',
      badge: '/icons/favicon.png',
      tag: 'booru-subscriptions',
      data: { url: payload.url || '/' },
      renotify: true
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const targetUrl = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.navigate(targetUrl).catch(() => {});
          return client.focus();
        }
      }
      return self.clients.openWindow(targetUrl);
    })
  );
});
