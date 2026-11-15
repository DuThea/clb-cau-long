/* Service Worker – sinh tự động lúc build (vite.config.js). Không sửa file dist/sw.js trực tiếp.
 * Chiến lược offline-first:
 *  - Cài đặt: tải sẵn (precache) toàn bộ file của bản build -> mở app không cần mạng.
 *  - Điều hướng: luôn trả index.html từ cache; bản mới đến qua SW mới (tên cache theo phiên bản).
 *  - File khác cùng origin: cache trước, không có thì tải mạng rồi lưu lại.
 */
const VERSION = '__VERSION__';
const CACHE = `bcm-${VERSION}`;
const PRECACHE = __PRECACHE__;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(PRECACHE.map((u) => new Request(u, { cache: 'reload' }))))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('bcm-') && k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

// Trang gửi 'SKIP_WAITING' khi người dùng bấm "Cập nhật"
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      const cached = await caches.match('./index.html', { ignoreSearch: true });
      if (cached) return cached;
      return fetch(req);
    })());
    return;
  }

  event.respondWith((async () => {
    const cached = await caches.match(req, { ignoreSearch: true });
    if (cached) return cached;
    const res = await fetch(req);
    if (res.ok && res.type === 'basic') {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(req, copy));
    }
    return res;
  })());
});
