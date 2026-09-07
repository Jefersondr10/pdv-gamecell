const CACHE_PREFIX = 'atacadoapple-static-';
const CACHE_VERSION = 'v5';
const CACHE_NAME = `${CACHE_PREFIX}${CACHE_VERSION}`;
const MAX_RUNTIME_ENTRIES = 120;

const PRECACHE = [
  '/offline.html',
  '/manifest.webmanifest',
  '/favicon.svg',
  '/icons/atacadoapple-192.png',
  '/icons/atacadoapple-512.png',
  '/icons/atacadoapple-maskable-512.png',
  '/apple-touch-icon.png',
  '/wasm/zxing_reader.wasm',
];

const PRECACHE_PATHS = new Set(PRECACHE);

async function trimRuntimeEntries(cache) {
  const requests = await cache.keys();
  const runtimeRequests = requests.filter((request) => {
    const url = new URL(request.url);
    return !PRECACHE_PATHS.has(url.pathname);
  });
  const overflow = runtimeRequests.length - MAX_RUNTIME_ENTRIES;

  if (overflow <= 0) return;

  await Promise.all(
    runtimeRequests.slice(0, overflow).map((request) => cache.delete(request)),
  );
}

function isCacheableStaticResponse(response) {
  const cacheControl = response.headers.get('cache-control') || '';
  return (
    response.ok &&
    response.status === 200 &&
    response.type === 'basic' &&
    !/\bno-store\b/i.test(cacheControl)
  );
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      await cache.addAll(PRECACHE);
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
          .map((key) => caches.delete(key)),
      );

      const cache = await caches.open(CACHE_NAME);
      await trimRuntimeEntries(cache);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (
    url.pathname.startsWith('/api/') ||
    url.searchParams.has('_rsc') ||
    request.headers.has('rsc') ||
    request.headers.get('accept')?.includes('text/x-component')
  ) {
    return;
  }
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(async () => {
        const cache = await caches.open(CACHE_NAME);
        return cache.match('/offline.html');
      }),
    );
    return;
  }

  const isStaticAsset =
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.startsWith('/icons/') ||
    url.pathname === '/favicon.svg' ||
    url.pathname === '/manifest.webmanifest' ||
    url.pathname === '/apple-touch-icon.png' ||
    url.pathname.startsWith('/wasm/');

  if (!isStaticAsset) return;

  const cachePromise = caches.open(CACHE_NAME);
  const resultPromise = cachePromise.then(async (cache) => {
    const cached = await cache.match(request);
    if (cached) {
      return { cache, cacheCopy: null, response: cached };
    }

    const response = await fetch(request);
    return {
      cache,
      cacheCopy: isCacheableStaticResponse(response) ? response.clone() : null,
      response,
    };
  });

  const cacheWritePromise = resultPromise
    .then(async ({ cache, cacheCopy }) => {
      if (!cacheCopy) return;

      await cache.put(request, cacheCopy);
      await trimRuntimeEntries(cache);
    })
    .catch(() => undefined);

  event.waitUntil(cacheWritePromise);
  event.respondWith(resultPromise.then(({ response }) => response));
});
