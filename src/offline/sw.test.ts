/**
 * Tests for the offline shell, `public/sw.js`.
 *
 * The service worker is plain JS served verbatim (no bundler, no import), so it is loaded here the
 * way the browser loads it — as source, into a fake worker global — and its real `fetch` handler is
 * driven against stub caches and a stub network.
 *
 * The rule under test is the one that matters for a pricing tool: a returning user must pick up a
 * NEW BUILD. The first version of this worker was cache-first for everything, index.html included,
 * with a hard-coded cache version, so an estimator who opened the tool once kept that build's
 * prices and trade rules for ever, and clearing site data was the only escape.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath, URL as NodeURL } from 'node:url';

const SW_SOURCE = readFileSync(fileURLToPath(new NodeURL('../../public/sw.js', import.meta.url)), 'utf8');
const ORIGIN = 'https://example.test/app/';

/** Just enough of a Response for the worker: `ok`, `type`, `clone()` and a readable marker. */
class FakeResponse {
  constructor(
    readonly marker: string,
    readonly ok = true,
    readonly type = 'basic',
  ) {}
  clone(): FakeResponse {
    return new FakeResponse(this.marker, this.ok, this.type);
  }
}

interface FetchEvent {
  request: { url: string; method: string; mode: string };
  respondWith: (p: Promise<unknown>) => void;
}

/** Load sw.js into a fake worker global and return the handles a test needs to drive it. */
function loadWorker(options: { network: (url: string) => FakeResponse | null }) {
  const listeners = new Map<string, (event: unknown) => void>();
  const caches = new Map<string, Map<string, FakeResponse>>();
  const networkCalls: string[] = [];

  const keyOf = (req: string | { url: string }) => (typeof req === 'string' ? new URL(req, ORIGIN).href : req.url);

  const cachesApi = {
    open: async (name: string) => {
      const store = caches.get(name) ?? new Map<string, FakeResponse>();
      caches.set(name, store);
      return {
        add: async (url: string) => {
          const res = options.network(new URL(url, ORIGIN).href);
          if (!res) throw new Error('404');
          store.set(keyOf(url), res);
        },
        put: async (req: string | { url: string }, res: FakeResponse) => {
          store.set(keyOf(req), res);
        },
      };
    },
    match: async (req: string | { url: string }) => {
      for (const store of caches.values()) {
        const hit = store.get(keyOf(req));
        if (hit) return hit;
      }
      return undefined;
    },
    keys: async () => [...caches.keys()],
    delete: async (name: string) => caches.delete(name),
  };

  const self = {
    location: { href: `${ORIGIN}sw.js`, origin: 'https://example.test' },
    addEventListener: (type: string, fn: (event: unknown) => void) => listeners.set(type, fn),
    skipWaiting: () => undefined,
    clients: { claim: async () => undefined },
  };

  const fetchStub = async (req: string | { url: string }) => {
    const url = keyOf(req);
    networkCalls.push(url);
    const res = options.network(url);
    if (!res) throw new Error('offline');
    return res;
  };

  // eslint-disable-next-line @typescript-eslint/no-implied-eval -- this is exactly how a browser loads it
  new Function('self', 'caches', 'fetch', 'Response', 'URL', SW_SOURCE)(self, cachesApi, fetchStub, FakeResponse, URL);

  const fire = async (type: string, event: Record<string, unknown>) => {
    const fn = listeners.get(type);
    if (!fn) throw new Error(`no ${type} listener registered`);
    const waited: Promise<unknown>[] = [];
    fn({ ...event, waitUntil: (p: Promise<unknown>) => waited.push(p) });
    await Promise.all(waited);
  };

  const request = async (url: string, mode = 'no-cors'): Promise<FakeResponse> => {
    let answered: Promise<FakeResponse> | undefined;
    const event: FetchEvent = {
      request: { url: new URL(url, ORIGIN).href, method: 'GET', mode },
      respondWith: (p) => {
        answered = p as Promise<FakeResponse>;
      },
    };
    listeners.get('fetch')!(event);
    if (!answered) throw new Error('the worker did not answer the request');
    return answered;
  };

  return { fire, request, networkCalls, caches, install: () => fire('install', {}) };
}

/** A deployment: index.html carries a marker, and there is one hashed asset. */
function deployment(marker: string) {
  return (url: string): FakeResponse | null => {
    if (url === `${ORIGIN}` || url === `${ORIGIN}index.html`) return new FakeResponse(`index:${marker}`);
    if (url === `${ORIGIN}assets/app-${marker}.js`) return new FakeResponse(`asset:${marker}`);
    if (url.endsWith('.webmanifest') || url.endsWith('.svg') || url.endsWith('.png')) return new FakeResponse('icon');
    return null;
  };
}

describe('offline shell (public/sw.js)', () => {
  it('serves a new deployment to a returning user instead of the build it first cached', async () => {
    let network = deployment('v1');
    const sw = loadWorker({ network: (url) => network(url) });
    await sw.install();

    // first visit: the cached shell is the one that was precached
    expect((await sw.request('./', 'navigate')).marker).toBe('index:v1');

    // the site is redeployed; index.html now names a different bundle
    network = deployment('v2');
    expect((await sw.request('./', 'navigate')).marker).toBe('index:v2');
    expect((await sw.request('./index.html', 'no-cors')).marker).toBe('index:v2');
  });

  it('falls back to the cached shell when the network is gone, so the app still opens on site', async () => {
    const online = deployment('v1');
    let offline = false;
    const sw = loadWorker({ network: (url) => (offline ? null : online(url)) });
    await sw.install();
    await sw.request('./', 'navigate');

    offline = true;
    const answer = await sw.request('./', 'navigate');
    expect(answer.marker).toBe('index:v1');
    // a deep link works too: the shell answers for any navigation
    expect((await sw.request('./whatever', 'navigate')).marker).toBe('index:v1');
  });

  it('serves hashed assets from the cache without touching the network: their names carry the version', async () => {
    const sw = loadWorker({ network: deployment('v1') });
    await sw.install();
    const url = './assets/app-v1.js';
    expect((await sw.request(url)).marker).toBe('asset:v1');
    await new Promise((r) => setTimeout(r, 0)); // let the cache write settle
    const before = sw.networkCalls.length;
    expect((await sw.request(url)).marker).toBe('asset:v1');
    expect(sw.networkCalls.length).toBe(before); // second time: no network at all
  });

  it('drops the previous cache on activate, so old assets do not pile up for ever', async () => {
    const sw = loadWorker({ network: deployment('v1') });
    sw.caches.set('flooring-estimator-old', new Map([[`${ORIGIN}stale.js`, new FakeResponse('stale')]]));
    await sw.install();
    await sw.fire('activate', {});
    expect([...sw.caches.keys()]).not.toContain('flooring-estimator-old');
    expect([...sw.caches.keys()]).toHaveLength(1);
  });

  it('carries a build id placeholder for the build to stamp, so each deployment gets its own cache', () => {
    // vite.config.ts rewrites __BUILD_ID__ with a hash of the built index.html; without it the cache
    // name is a constant and `activate` never has an older cache to delete.
    expect(SW_SOURCE).toContain("const CACHE_VERSION = '__BUILD_ID__'");
  });
});
