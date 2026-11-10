/* フェイク着信 PWA用サービスワーカー
   音声・画像・アイコンなどのアセットをキャッシュして読み込みを速くする。
   静的配信の都合でこのファイルは assets/ 配下に置かれるため、SWの
   スコープも assets/ 以下に限られ、ページ本体はキャッシュ対象にならない。
   フルスクリーン起動はマニフェスト＋Apple用メタタグ側の仕組みで効く。 */
var CACHE_NAME = 'fake-call-v1';
var CORE_ASSETS = [
  'miruku.jpg',
  'icon-192.png',
  'icon-512.png',
  'icon-maskable-512.png',
  'apple-touch-icon.png',
  'manifest.webmanifest',
  'audio/ringtone.wav',
  'audio/a1.mp3',
  'audio/a2.mp3',
  'audio/a3.mp3',
  'audio/a4.mp3',
  'audio/b1.mp3',
  'audio/b2.mp3',
  'audio/b3.mp3',
  'audio/b4.mp3',
  'audio/c1.mp3',
  'audio/c2.mp3',
  'audio/c3.mp3'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(CORE_ASSETS);
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (key) {
        if (key !== CACHE_NAME) return caches.delete(key);
        return null;
      }));
    }).then(function () {
      return self.clients.claim();
    })
  );
});

self.addEventListener('fetch', function (event) {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then(function (cached) {
      if (cached) return cached;
      return fetch(event.request).then(function (res) {
        if (res && res.ok && new URL(event.request.url).origin === self.location.origin) {
          var copy = res.clone();
          caches.open(CACHE_NAME).then(function (cache) { cache.put(event.request, copy); });
        }
        return res;
      });
    })
  );
});
