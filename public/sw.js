// AI 每日精选 — Service Worker
// Cache-first for static assets, network-first for API
// Version bumped on each deploy to invalidate stale caches

const CACHE = 'ai-daily-v__BUILD__';
const STATIC = ['/', '/style.css', '/enhancements.js', '/app.js'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(STATIC))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // API calls — always network
  if (url.pathname.startsWith('/api/')) return;
  // share page — always network
  if (url.pathname.startsWith('/share/')) return;
  // Cache-first for static
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request).then(res => {
      if (res.ok && ['/', '/style.css', '/enhancements.js', '/app.js'].includes(url.pathname)) {
        caches.open(CACHE).then(c => c.put(e.request, res.clone()));
      }
      return res;
    }))
  );
});
