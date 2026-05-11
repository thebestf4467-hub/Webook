const CACHE = ‘webook-v1’;
const ASSETS = [
‘/Webook/’,
‘/Webook/index.html’
];

self.addEventListener(‘install’, e => {
e.waitUntil(
caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())
);
});

self.addEventListener(‘activate’, e => {
e.waitUntil(
caches.keys().then(keys =>
Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
).then(() => self.clients.claim())
);
});

self.addEventListener(‘fetch’, e => {
// للطلبات من Firebase — لا تعترضها
if (e.request.url.includes(‘firebase’) ||
e.request.url.includes(‘googleapis’) ||
e.request.url.includes(‘gstatic’)) {
return;
}
e.respondWith(
caches.match(e.request).then(cached => cached || fetch(e.request))
);
});
