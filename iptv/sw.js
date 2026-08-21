/* sw.js - yalnızca uygulama dosyalarini önbelleğe alir.
   Yayın akışları (.m3u8, .ts, segmentler) Hiç önbelleklenmez; canlı yayında
   eski parça sunmak donmaya yol açar. */
var CACHE = 'nomads-iptv-v1';
var SHELL = [
  './', './index.html',
  './css/app.css',
  './js/compat.js', './js/store.js', './js/http.js', './js/m3u.js', './js/xmltv.js',
  './js/nav.js', './js/vlist.js', './js/player.js', './js/ui.js',
  './js/screens.js', './js/settings-screen.js', './js/app.js',
  './vendor/hls.min.js', './vendor/mpegts.js',
  './manifest.webmanifest', './version.json'
];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) {
    return c.addAll(SHELL)['catch'](function () { /* biri eksikse kurulum yine de bitsin */ });
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.map(function (k) { return k === CACHE ? null : caches['delete'](k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;

  var url;
  try { url = new URL(req.url); } catch (err) { return; }

  /* baska sunucular (yayınlar, logolar, EPG) dokunmadan geçsin */
  if (url.origin !== self.location.origin) return;

  /* vekil ucu ve medya uzantilari asla önbelleğe girmesin */
  if (url.pathname.indexOf('/proxy') === 0) return;
  if (/\.(m3u8?|ts|mp4|mpd|xml|gz)$/i.test(url.pathname)) return;

  e.respondWith(
    caches.match(req).then(function (hit) {
      if (hit) {
        /* arka planda tazele */
        fetch(req).then(function (res) {
          if (res && res.status === 200) caches.open(CACHE).then(function (c) { c.put(req, res.clone()); });
        })['catch'](function () {});
        return hit;
      }
      return fetch(req).then(function (res) {
        if (res && res.status === 200 && res.type === 'basic') {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      });
    })
  );
});
