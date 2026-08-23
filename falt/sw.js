/* Service worker för fältsystemet — appen ska gå att öppna även med dålig täckning. */
const CACHE = 'falt-v10';
const SKAL = [
  './', './index.html', './app.css', './manifest.webmanifest', './icon.svg', './icon-maskable.svg',
  './config.js', './js/app.js', './js/api.js', './js/ui.js', './js/state.js',
  './js/dorr.js', './js/karta.js', './js/geo.js', './js/listor.js', './js/dashboard.js', './js/admin.js',
  './leaflet/leaflet.js', './leaflet/leaflet.css',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SKAL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((k) => Promise.all(k.filter((n) => n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => { const k = res.clone(); caches.open(CACHE).then((c) => c.put('./index.html', k)); return res; })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  // Nätverk först för app-filerna så en ny version når ut, med cachen som reserv.
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) { const k = res.clone(); caches.open(CACHE).then((c) => c.put(req, k)); }
        return res;
      })
      .catch(() => caches.match(req))
  );
});
