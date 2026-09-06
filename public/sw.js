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
 * - install: pre-cache the entry points that ARE known ('./', index.html, the manifest, the icons).
 * - fetch, navigations and index.html: NETWORK FIRST, falling back to the cache when offline. This
 *   is the whole reason a redeployed fix reaches a returning user: index.html names the hashed
 *   bundles, so serving a cached copy for ever would pin the installed app to the build it first
 *   cached — for a tool that carries prices and trade rules, exactly the wrong failure.
 * - fetch, everything else same-origin: cache first, then network, caching what comes back. The
 *   asset names are content-hashed by Vite, so a cached one can never be the wrong version.
 * - activate: drop caches from older versions.
 *
 * CACHE_VERSION is rewritten at build time by the `sw-build-id` plugin in vite.config.ts with a hash
 * of the built index.html, so every deployment lands in a fresh cache and the previous one is
 * deleted on activate. Served unbuilt (or from public/ directly) it keeps the literal below, which
 * is still correct — just never invalidated.
 */
const CACHE_VERSION = '__BUILD_ID__';
const CACHE_NAME = `flooring-estimator-${CACHE_VERSION}`;
const PRECACHE = ['./', './index.html', './manifest.webmanifest', './favicon.svg', './apple-touch-icon.png', './icon-192.png', './icon-512.png'];
const SHELL = new URL('./index.html', self.location.href).href;

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

/** Put a copy of a good response in the cache. Opaque / error responses are not worth keeping. */
function keep(request, response) {
  if (response && response.ok && response.type === 'basic') {
    const copy = response.clone();
    caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
  }
  return response;
}

function offlineFallback() {
  return new Response('Offline and not cached yet — open the app once with a connection.', {
    status: 503,
    headers: { 'Content-Type': 'text/plain' },
  });
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // The shell: network first, so a new deployment is picked up on the next online load.
  const isShell = request.mode === 'navigate' || url.href === SHELL || url.href === new URL('./', self.location.href).href;
  if (isShell) {
    event.respondWith(
      fetch(request)
        .then((response) => keep(request, response))
        .catch(async () => (await caches.match(request)) ?? (await caches.match(SHELL)) ?? offlineFallback()),
    );
    return;
  }

  // Everything else (hashed assets, the manifest, icons): cache first.
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request)
        .then((response) => keep(request, response))
        .catch(() => offlineFallback());
    }),
  );
});
