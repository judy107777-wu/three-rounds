/*
 * 離線快取
 * 負責：把整個 APP 的檔案存在本機，沒有網路也打得開
 * 不負責：任何資料（練習紀錄都在 IndexedDB，本來就是本機的）
 *
 * Gemini 的呼叫完全不碰：AI 檢查本來就需要連網，快取只會拿到過期的答案。
 */

const CACHE_NAME = 'three-rounds-v1';

const SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'src/styles.css',
  'src/app.js',
  'src/ai-review.js',
  'src/compare.js',
  'src/export.js',
  'src/metrics.js',
  'src/recorder.js',
  'src/session.js',
  'src/speech.js',
  'src/storage.js',
  'src/ui-common.js',
  'src/ui-history.js',
  'src/ui-review.js',
  'src/ui-settings.js',
  'src/ui-today.js',
  'src/ui-transcript.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // 只管自己的檔案。外部服務（Gemini）一律直接走網路。
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request)
        .then((response) => {
          if (response && response.ok && response.type === 'basic') {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => caches.match('index.html'));
    }),
  );
});
