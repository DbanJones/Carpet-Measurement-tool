/*
 * Offline shell for the flooring estimator.
 *
 * The manifest declares `display: standalone`, so the browser offers "Add to Home Screen" and the
 * app launches chromeless like a native tool — and the normal use is to install it, then carry it
 * into an empty house with no signal to measure up. The project data is already local (the store
 * autosaves to localStorage); only the shell needed caching.
 *
 * The build injects every JS/CSS asset, including the PDF reader and worker. They must be cached
 * during installation: the first page has already loaded its scripts before this worker controls
 * it, and an estimator may first open a PDF while offline.
 * - install: pre-cache the shell and all generated assets; icons are best-effort.
 * - fetch, navigations and index.html: NETWORK FIRST, falling back to the cache when offline. This
 *   is the whole reason a redeployed fix reaches a returning user: index.html names the hashed
 *   bundles, so serving a cached copy for ever would pin the installed app to the build it first
 *   cached — for a tool that carries prices and trade rules, exactly the wrong failure.
 * - fetch, everything else same-origin: cache first, then network, caching what comes back. The
 *   asset names are content-hashed by Vite, so a cached one can never be the wrong version.
 * - activate: drop this app scope's older versions; other apps' caches belong to them.
 *
 * CACHE_VERSION is rewritten at build time by the `sw-build-id` plugin in vite.config.ts with a hash
 * of the built index.html, so every deployment lands in a fresh cache and the previous one is
 * deleted on activate. Served unbuilt (or from public/ directly) it keeps the literal below, which
 * is still correct — just never invalidated.
 */
const CACHE_VERSION = '__BUILD_ID__';
const CACHE_PREFIX = `flooring-estimator-${encodeURIComponent(new URL('./', self.location.href).pathname)}-`;
const CACHE_NAME = `${CACHE_PREFIX}${CACHE_VERSION}`;
const BUILD_ASSETS = /* __PRECACHE_ASSETS__ */ [];
const IMMUTABLE_ASSET_URLS = new Set(BUILD_ASSETS.map((url) => new URL(url, self.location.href).href));
const REQUIRED = ['./', './index.html', ...BUILD_ASSETS];
const OPTIONAL = ['./manifest.webmanifest', './favicon.svg', './apple-touch-icon.png', './icon-192.png', './icon-512.png'];
const SHELL = new URL('./index.html', self.location.href).href;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      // An incomplete new shell must not replace the last working offline version.
      .then(async (cache) => {
        await Promise.all(REQUIRED.map((url) => cache.add(url)));
        await Promise.allSettled(OPTIONAL.map((url) => cache.add(url)));
      })
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith(CACHE_PREFIX) && k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

/** Put a copy of a good response in the cache. Opaque / error responses are not worth keeping. */
function keep(event, request, response) {
  if (response && response.ok && response.type === 'basic') {
    const copy = response.clone();
    event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)).catch(() => {}));
  }
  return response;
}

async function cached(request) {
  const url = typeof request === 'string' ? new URL(request, self.location.href).href : request.url;
  // crossorigin scripts/styles send Origin; installation fetches may not. Static hosts that set
  // Vary: Origin otherwise make a cached bundle miss on the first offline load. A content-hashed
  // build asset has one representation here, regardless of those request headers.
  return (await caches.open(CACHE_NAME)).match(request, { ignoreVary: IMMUTABLE_ASSET_URLS.has(url) });
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
        .then(async (response) => response.ok
          ? keep(event, request, response)
          : (await cached(request)) ?? (await cached(SHELL)) ?? response)
        .catch(async () => (await cached(request)) ?? (await cached(SHELL)) ?? offlineFallback()),
    );
    return;
  }

  // Everything else (hashed assets, the manifest, icons): cache first.
  event.respondWith(
    cached(request).then((response) => {
      if (response) return response;
      return fetch(request)
        .then((response) => keep(event, request, response))
        .catch(() => offlineFallback());
    }),
  );
});
