// Keeps 8-bit Voice working offline. Everything the page needs is cached on
// the first visit; after that the cached copy opens at once while a fresh one
// is fetched in the background for next time.
const CACHE = '8bit-voice-v1.1.0';
const FILES = [
  './',
  'index.html',
  'chipvoice.js',
  'manifest.webmanifest',
  'fonts/pd-body.woff2',
  'fonts/pd-eyebrow.woff2',
  'icons/favicon.svg',
  'icons/favicon-32.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/maskable-512.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('8bit-voice-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const hit = await cache.match(req, { ignoreSearch: req.mode === 'navigate' });
      const fresh = fetch(req)
        .then((res) => {
          if (res.ok && res.type === 'basic') cache.put(req, res.clone());
          return res;
        })
        .catch(() => null);
      if (hit) {
        e.waitUntil(fresh);
        return hit;
      }
      const res = await fresh;
      return res || (req.mode === 'navigate' ? cache.match('index.html') : Response.error());
    }),
  );
});
