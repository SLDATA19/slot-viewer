/* 差枚ビューア用サービスワーカー v2: アプリ本体だけキャッシュし、
 * GitHub APIへの問い合わせは毎回ネットワークへ行く（データの鮮度優先）。 */
var CACHE = "slot-viewer-v7";
var SHELL = ["./", "index.html", "app.js", "manifest.webmanifest", "icon-192.png", "icon-512.png"];

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }));
});

self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; })
      .map(function (k) { return caches.delete(k); }));
  }));
});

self.addEventListener("fetch", function (e) {
  var url = new URL(e.request.url);
  if (url.hostname === "api.github.com") return; // データは常に生で取る
  e.respondWith(
    caches.match(e.request).then(function (hit) {
      return hit || fetch(e.request).then(function (res) {
        if (res.ok && e.request.method === "GET") {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
        }
        return res;
      });
    })
  );
});
