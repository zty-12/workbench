// sw.js - v21.42
// (1) 导航请求一律走网络（cache:reload 穿透 HTTP 缓存），保证每次打开都是最新页面
// (2) 在返回的 HTML 末尾注入「数据新鲜度补丁」，修复「每天打开都是旧数据，需 Ctrl+Shift+R」
//     index.html 一个字节都不用动，补丁随 SW 升级即时生效
const CACHE_NAME = 'workbench-v42';
const urlsToCache = ['.', 'manifest.json'];

const PATCH = `<script>
/* WB_FRESH_PATCH_V2142 */
(function () {
  if (window.__wbFreshPatch) return;
  window.__wbFreshPatch = '21.42';
  console.log('v21.42 数据新鲜度补丁已注入');
  var of = window.fetch;
  window.fetch = function (i, n) {
    n = n || {};
    try { return of.call(this, i, Object.assign({}, n, { cache: 'no-store' })); }
    catch (e) { return of.call(this, i, n); }
  };
  var cur = 'home', last = 0, busy = false;
  function hook() {
    if (typeof window.navigateTo !== 'function' || window.navigateTo.__h) return;
    var o = window.navigateTo;
    var w = function (p) { if (typeof p === 'string') cur = p; return o.apply(this, arguments); };
    w.__h = true;
    window.navigateTo = w;
  }
  function refresh(tag, render, retry) {
    if (busy || document.visibilityState === 'hidden') return;
    if (typeof window.loadFromSupabase !== 'function') return;
    if (!retry && Date.now() - last < 60000) return;
    busy = true;
    Promise.resolve().then(function () { return window.loadFromSupabase(); }).then(function (r) {
      if (r === false) {
        if ((retry || 0) < 3) setTimeout(function () { busy = false; refresh(tag, render, (retry || 0) + 1); }, 3000);
        else busy = false;
        return;
      }
      last = Date.now();
      if (render) { try { window.renderPage(cur); } catch (e) {} }
      console.log('v21.42 已拉取云端最新数据（' + tag + '）');
    }).catch(function (e) {
      console.warn('v21.42 补丁拉取失败', e && e.message);
    }).then(function () { busy = false; });
  }
  window.addEventListener('load', function () {
    hook();
    var n = 0, t = setInterval(function () {
      if (typeof window.loadFromSupabase === 'function') {
        clearInterval(t); hook();
        setTimeout(function () { refresh('页面打开', true, 0); }, 500);
      } else if (++n > 40) { clearInterval(t); }
    }, 250);
  });
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') refresh('页面重新可见', cur === 'home', 0);
  });
  window.addEventListener('focus', function () { refresh('窗口获得焦点', cur === 'home', 0); });
  var day = new Date().toDateString();
  setInterval(function () {
    var k = new Date().toDateString();
    if (k !== day) { day = k; last = 0; refresh('跨天', true, 0); }
  }, 60000);
})();
</script>`;

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
      return Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)));
    }).then(() => self.clients.claim())
      .then(() => {
        // 升级/首次安装后刷新一次页面，让注入补丁立刻生效
        // （SW 仅在版本变化时 activate，不会形成刷新循环）
        return self.clients.matchAll({ type: 'window' }).then(list => {
          list.forEach(c => { try { c.navigate(c.url); } catch (e) {} });
        });
      })
  );
});

self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

function injectPatch(html) {
  if (html.indexOf('WB_FRESH_PATCH_V2142') !== -1) return html;
  const i = html.lastIndexOf('</body>');
  if (i === -1) return html;
  return html.slice(0, i) + PATCH + html.slice(i);
}

async function handleNavigate(req) {
  const net = fetch(req, { cache: 'reload' }).then(async res => {
    if ((res.headers.get('content-type') || '').indexOf('text/html') === -1) return res;
    let body;
    try { body = await res.text(); } catch (e) { return res; }
    const h = new Headers(res.headers);
    // 文本已解压、长度已变：必须去掉这两个头，否则浏览器解压失败会白屏
    h.delete('content-length');
    h.delete('content-encoding');
    const out = new Response(injectPatch(body), { status: res.status, statusText: res.statusText, headers: h });
    caches.open(CACHE_NAME).then(c => c.put(req, out.clone())).catch(() => {});
    return out;
  });

  const to = new Promise((_, rej) => setTimeout(() => rej(new Error('sw-timeout')), 5000));
  try {
    return await Promise.race([net, to]);
  } catch (e) {
    const cached = (await caches.match(req)) || (await caches.match('.'));
    if (cached) return cached;
    return net;
  }
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (req.mode === 'navigate' || url.pathname.endsWith('/') || url.pathname.endsWith('index.html')) {
    event.respondWith(handleNavigate(req));
    return;
  }

  event.respondWith(
    caches.match(req).then(r => r || fetch(req).then(res => {
      const copy = res.clone();
      caches.open(CACHE_NAME).then(c => c.put(req, copy)).catch(() => {});
      return res;
    }))
  );
});
