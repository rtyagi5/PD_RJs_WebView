/* eslint-disable no-restricted-globals */
// ---------------------------------------------
// public/service-worker.js
//
// src/serviceWorker.js is CRA's REGISTRATION HELPER, not a service worker. It
// fetches /service-worker.js — this file. CRA 5 does not generate one without
// cra-template-pwa, so before this existed, registering the helper would have
// fetched a 404 and cached nothing. Hand-written rather than adding
// craco/workbox because CRA copies public/ verbatim and the assets that matter
// have fixed, predictable paths.
//
// What this is for: every cold start re-downloads ~33MB of model assets
// (4.7MB MoveNet + 9MB MediaPipe task + 19MB WASM) on top of the JS bundle.
//
// Deliberately runtime caching, not precaching on install: precaching would
// front-load all 33MB on first visit, which is worse for a patient on a poor
// connection. Assets are cached as they are actually fetched, so the first
// session costs what it costs today and every later one is served locally.
// ---------------------------------------------

// Bump on every deploy. A stale worker pinning patients to an old build is
// worse than no caching at all.
const CACHE_VERSION = 'v1';
const ASSET_CACHE = `rr-assets-${CACHE_VERSION}`;
const MODEL_CACHE = `rr-models-${CACHE_VERSION}`;
const KEEP = new Set([ASSET_CACHE, MODEL_CACHE]);

/** Large, immutable model/WASM assets — safe to serve from cache indefinitely. */
function isModelAsset(pathname) {
  return pathname.includes('/models/movenet/') || pathname.includes('/mediapipe/');
}

/** Anything that must always hit the network. */
function isNeverCacheable(url) {
  // The exercise token is single-use and activity state is live; serving either
  // from cache would replay a stale session.
  if (url.search.includes('token=')) return true;
  return (
    url.pathname.includes('/exercise-service/') ||
    url.pathname.includes('/user-service/') ||
    url.pathname.includes('/__dev/')
  );
}

self.addEventListener('install', (event) => {
  // No precache list; do not activate until the page asks (see SKIP_WAITING),
  // so an in-progress exercise is never swapped out underneath the patient.
  event.waitUntil(Promise.resolve());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((n) => !KEEP.has(n)).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

// The page posts this when the patient accepts an update prompt.
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }

  // Cross-origin (CDN fallbacks, analytics) is left entirely alone.
  if (url.origin !== self.location.origin) return;
  if (isNeverCacheable(url)) return;

  // Model + WASM assets: cache-first. These are the whole point of this worker.
  if (isModelAsset(url.pathname)) {
    event.respondWith(
      caches.open(MODEL_CACHE).then(async (cache) => {
        const hit = await cache.match(request);
        if (hit) return hit;
        const res = await fetch(request);
        // Only cache a complete, successful response. A 206 or an opaque error
        // cached here would break model loading until the cache is cleared.
        if (res && res.status === 200 && res.type === 'basic') {
          cache.put(request, res.clone());
        }
        return res;
      })
    );
    return;
  }

  // Navigations: network-first so a new deployment is picked up immediately,
  // falling back to the cached shell when offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(ASSET_CACHE).then((c) => c.put(request, copy)).catch(() => {});
          return res;
        })
        .catch(async () => {
          const cache = await caches.open(ASSET_CACHE);
          return (await cache.match(request)) || (await cache.match('index.html')) || Response.error();
        })
    );
    return;
  }

  // Everything else same-origin (hashed JS/CSS, images, fonts): cache-first.
  // Filenames carry a content hash, so a new build requests new URLs and old
  // entries are dropped when CACHE_VERSION is bumped.
  event.respondWith(
    caches.open(ASSET_CACHE).then(async (cache) => {
      const hit = await cache.match(request);
      if (hit) return hit;
      try {
        const res = await fetch(request);
        if (res && res.status === 200 && res.type === 'basic') {
          cache.put(request, res.clone());
        }
        return res;
      } catch (e) {
        const fallback = await cache.match(request);
        if (fallback) return fallback;
        throw e;
      }
    })
  );
});
