// sw.js - 离线缓存（导航请求始终走网络取最新，跨域 API 请求一律走网络不缓存，配合 index.html 版本探测自动刷新）
const CACHE_NAME = 'workbench-v47';
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
        // 【v21.62】删除旧缓存（v46 及以前），它们里面可能存着过期的 Supabase API 响应
        keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const isSameOrigin = url.origin === self.location.origin;

  // 【v21.62 修复】跨域请求（如 Supabase REST API）一律直连网络、绝不缓存。
  // 旧版会把 Supabase 查询结果写进 Cache API，导致普通打开时 SW 直接回放旧数据，
  // 只有 Ctrl+Shift+R 绕过 SW 才能拿到最新数据（“强制刷新后数据才对”的根因）。
  if (!isSameOrigin) {
    event.respondWith(fetch(req, { cache: 'no-store' }));
    return;
  }

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

  // 同域静态资源（vendor/ 等）：缓存优先，未命中再走网络并写入缓存
  event.respondWith(
    caches.match(req)
      .then(response => response || fetch(req, { cache: 'no-store' }).then(res => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(req, copy)).catch(() => {});
        return res;
      }).catch(() => response))
  );
});
