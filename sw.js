// sw.js - 离线缓存（导航请求始终走网络取最新，配合 index.html 版本探测自动刷新）
const CACHE_NAME = 'workbench-v46';
const urlsToCache = [
  '.',
  'manifest.json',
  // index.html 不预缓存为离线兜底之外的副本；导航始终走网络 no-store 保证最新
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(urlsToCache))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // 导航请求（打开页面 / index.html / 带 _= 探测参数的请求）：始终向网络取最新，绝不返回旧缓存副本
  const isNav = req.mode === 'navigate' || url.pathname.endsWith('/') || url.pathname.endsWith('index.html');
  if (isNav) {
    event.respondWith(
      fetch(req, { cache: 'no-store' })   // 【v21.55】no-store 真正绕过 HTTP 缓存；旧的 cache:'reload' 遇 304 会沿用旧副本
        .catch(() => caches.match(req))
        .catch(() => caches.match('.'))
    );
    return;
  }
  // 其它静态资源：缓存优先，未命中再走网络并写入缓存
  event.respondWith(
    caches.match(req)
      .then(response => response || fetch(req, { cache: 'no-store' }).then(res => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(req, copy)).catch(() => {});
        return res;
      }).catch(() => response))
  );
});
