/*
 * Offline shell for the flooring estimator.
 *
 * The manifest declares `display: standalone`, so the browser offers "Add to Home Screen" and the
 * app launches chromeless like a native tool — and the normal use is to install it, then carry it
 * into an empty house with no signal to measure up. The project data is already local (the store
 * autosaves to localStorage); only the shell needed caching.
 *
 * Strategy, deliberately simple and dependency-free (no build plugin, so the hashed asset names are
 * not known ahead of time):
 * - install: pre-cache the entry points that ARE known ('./', index.html, the manifest, the icon).
 * - fetch (same-origin GET only): serve from the cache when it is there, otherwise fetch and put a
 *   copy in the cache. The first online visit therefore caches every hashed asset the app loads.
 * - navigations fall back to the cached index.html, so a deep link or a reload works offline.
 * - activate: drop caches from older versions. Bump CACHE_VERSION when the shell changes.
 */
const CACHE_VERSION = 'v1';
const CACHE_NAME = `flooring-estimator-${CACHE_VERSION}`;
const PRECACHE = ['./', './index.html', './manifest.webmanifest', './favicon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      // one bad entry must not fail the whole install
      .then((cache) => Promise.allSettled(PRECACHE.map((url) => cache.add(url))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request)
        .then((response) => {
          // opaque / error responses are not worth caching
          if (response && response.ok && response.type === 'basic') {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(async () => {
          if (request.mode === 'navigate') {
            const shell = await caches.match('./index.html');
            if (shell) return shell;
          }
          return new Response('Offline and not cached yet — open the app once with a connection.', {
            status: 503,
            headers: { 'Content-Type': 'text/plain' },
          });
        });
    }),
  );
});
