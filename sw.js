// sw.js - 离线缓存（导航请求优先走网络，确保修改后的 index.html 能及时生效）
const CACHE_NAME = 'workbench-v4';
const urlsToCache = [
  '.',
  'manifest.json',
  // index.html 不预缓存，改为运行时 network-first，避免始终返回旧缓存导致修复不生效
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
  // 仅处理 GET 请求
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // 导航请求（打开页面 / index.html）：网络优先，失败再回退缓存，保证最新代码生效
  if (req.mode === 'navigate' || url.pathname.endsWith('/') || url.pathname.endsWith('index.html')) {
    event.respondWith(
      fetch(req)
        .then(res => {
          // 成功拿到响应则缓存一份，供离线/失败时使用
          const copy = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(req).then(r => r || caches.match('.')))
    );
    return;
  }

  // 其它静态资源：缓存优先，未命中再走网络并写入缓存
  event.respondWith(
    caches.match(req)
      .then(response => response || fetch(req).then(res => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(req, copy)).catch(() => {});
        return res;
      }))
  );
});
