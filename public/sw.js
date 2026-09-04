const CACHE_NAME = 'booru-explorer-v8.14';
const MEDIA_CACHE = 'booru-media-v8.14';
const MAX_MEDIA_ENTRIES = 400;
const MAX_CACHED_MEDIA_BYTES = 3 * 1024 * 1024;

// Placeholder for respondWith: without it a network or stream abort crashes the SW with "unexpected error"
const offlineResponse = () => new Response(null, { status: 504, statusText: 'Gateway Timeout' });

// respondWith must NEVER reject: an AbortError or stream teardown inside the
// handler otherwise surfaces as "ServiceWorker caught an unexpected error"
// and leaves the page with dead handlers and a spinning loader.
async function safeRespond(request, strategy) {
  try {
    return await strategy();
  } catch (err) {
    if (err && err.name === 'AbortError') {
      const cached = await caches.match(request).catch(() => undefined);
      return cached || offlineResponse();
    }
    console.warn('[ServiceWorker] Ошибка обработки запроса:', request.url, err);
    try {
      const cached = await caches.match(request);
      if (cached) return cached;
    } catch (_) { /* ignore */ }
    return offlineResponse();
  }
}

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
  '/js/router.js',
  '/js/i18n.js',
  '/js/app.js',
  '/js/gallery.js',
  '/js/viewer.js',
  '/js/viewer/index.js',
  '/js/autocomplete.js',
  '/js/mp4box.all.min.js',
  '/js/modules/uiUtils.js',
  '/js/modules/filtersUI.js',
  '/js/modules/navigationUI.js',
  '/js/modules/drawers.js',
  '/js/modules/settingsModal.js',
  '/js/modules/sidebarTags.js',
  '/js/modules/authModal.js',
  '/js/modules/profileUI.js',
  '/js/modules/favoriteAuthorsUI.js',
  '/js/modules/downloadManager.js',
  '/js/modules/wikiModal.js',
  '/js/modules/aiVision.js',
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

// Install the Service Worker and precache the App Shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[ServiceWorker] Кэширование App Shell v8.6');
      return cache.addAll(STATIC_ASSETS).catch(err => {
        console.warn('[ServiceWorker] Не удалось закэшировать часть ресурсов:', err);
      });
    }).then(() => self.skipWaiting())
  );
});

// Activation and cleanup of old cache versions
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

// Media cache cap: LRU by key order (oldest evicted first)
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

// Cache put that never rejects (body may already be consumed on abort)
function putSafe(cache, request, response) {
  try {
    const resClone = response.clone();
    return cache.put(request, resClone).catch(() => {});
  } catch (_) {
    return Promise.resolve();
  }
}

// Intercept requests
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Skip non-GET requests and third-party API calls
  if (event.request.method !== 'GET') return;

  // Proxied thumbnails are immutable (key = md5 of URL) — Cache First,
  // so the gallery opens instantly and works offline
  if (
    url.origin === self.location.origin &&
    (url.pathname.startsWith('/api/proxy') || url.pathname === '/api/video-thumbnail')
  ) {
    event.respondWith(safeRespond(event.request, async () => {
      const cache = await caches.open(MEDIA_CACHE);
      const cached = await cache.match(event.request);
      if (cached) return cached;
      const response = await fetch(event.request);
      if (response && response.status === 200 && isCacheableMediaResponse(response)) {
        putSafe(cache, event.request, response).then(() => trimMediaCache().catch(() => {}));
      }
      return response;
    }));
    return;
  }

  // Cache Favorites (/api/favorites) and search results (/api/posts) requests:
  // Network First with a fallback to the last successful response for offline viewing
  if (url.pathname === '/api/favorites' || url.pathname === '/api/posts') {
    event.respondWith(safeRespond(event.request, async () => {
      try {
        const response = await fetch(event.request);
        if (response && response.status === 200) {
          const cache = await caches.open(CACHE_NAME);
          putSafe(cache, event.request, response);
        }
        return response;
      } catch (networkErr) {
        if (networkErr && networkErr.name === 'AbortError') throw networkErr;
        const cached = await caches.match(event.request);
        return cached || offlineResponse();
      }
    }));
    return;
  }

  // Network First for app static files (HTML, CSS, JS, SVG, JSON)
  if (
    url.origin === self.location.origin &&
    (url.pathname === '/' ||
     url.pathname.endsWith('.html') ||
     url.pathname.endsWith('.css') ||
     url.pathname.endsWith('.js') ||
     url.pathname.endsWith('.svg') ||
     url.pathname.endsWith('.json'))
  ) {
    event.respondWith(safeRespond(event.request, async () => {
      try {
        const networkResponse = await fetch(event.request);
        if (networkResponse && networkResponse.ok && networkResponse.status === 200) {
          const cache = await caches.open(CACHE_NAME);
          putSafe(cache, event.request, networkResponse);
        }
        return networkResponse;
      } catch (networkErr) {
        if (networkErr && networkErr.name === 'AbortError') throw networkErr;
        const cached = await caches.match(event.request);
        return cached || offlineResponse();
      }
    }));
    return;
  }

  // For all other requests (API, video, proxy): direct network request with cache fallback
  event.respondWith(safeRespond(event.request, async () => {
    try {
      return await fetch(event.request);
    } catch (networkErr) {
      if (networkErr && networkErr.name === 'AbortError') throw networkErr;
      const cached = await caches.match(event.request);
      return cached || offlineResponse();
    }
  }));
});
