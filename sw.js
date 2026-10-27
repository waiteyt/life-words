// 離線快取：程式與詞庫先存起來；看過的照片、台語錄音也留在快取，下次沒網路也能玩
const VERSION = 'lw-v2';
const SHELL = [
  './', 'index.html', 'css/app.css', 'manifest.webmanifest', 'data/words.json',
  'js/app.js', 'js/store.js', 'js/speech.js', 'js/images.js', 'js/parent.js', 'js/sfx.js',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png',
];
const MEDIA_HOSTS = ['upload.wikimedia.org', 'sutian.moe.edu.tw', 'fonts.gstatic.com', 'fonts.googleapis.com'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION && k !== 'lw-media').map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.origin === location.origin) {
    // 自己的檔案：先拿網路上最新的，失敗再用快取
    e.respondWith(fetch(e.request).then(r => {
      const copy = r.clone();
      if (r.status === 200) caches.open(VERSION).then(c => c.put(e.request, copy)).catch(() => {});
      return r;
    }).catch(() => caches.match(e.request)));
    return;
  }
  if (MEDIA_HOSTS.some(h => url.hostname.endsWith(h)) && !e.request.headers.has('range')) {
    // 照片與錄音：有快取就用快取
    e.respondWith(caches.open('lw-media').then(async c => {
      const hit = await c.match(e.request);
      if (hit) return hit;
      const r = await fetch(e.request);
      if (r.status === 200 || r.type === 'opaque') c.put(e.request, r.clone()).catch(() => {});
      return r;
    }));
  }
});
