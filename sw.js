// Offline support: every file of the app is kept on the device. VERSION and FILES
// are filled in by tools/build_ios.py. A new version is downloaded in the background
// and waits until the user taps "Reload" (web.js): the page and the engine never
// come from two different versions.
//
// The app itself is encrypted (app.bin, see lockcore.js): the login page opens it
// into the cache PLAIN, which is served first. A page that is not opened yet (a new
// version, or logged out) gets the login page instead.

const VERSION = 'st-d44ec85efc88';
const PLAIN = VERSION.replace(/^st-/, 'st-plain-');
const FILES = [
 "./",
 "app.bin",
 "icons/icon-180.png",
 "icons/icon-192.png",
 "icons/icon-512.png",
 "index.html",
 "keys.json",
 "lock.js",
 "lockcore.js",
 "manifest.webmanifest",
 "vendor/pyodide/numpy-2.4.6-cp314-cp314-pyemscripten_2026_0_wasm32.whl",
 "vendor/pyodide/pyodide-lock.json",
 "vendor/pyodide/pyodide.asm.mjs",
 "vendor/pyodide/pyodide.asm.wasm",
 "vendor/pyodide/pyodide.mjs",
 "vendor/pyodide/python_stdlib.zip",
 "version.json"
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES)));
});

self.addEventListener('message', (e) => {
  if (e.data === 'activate') self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== PLAIN).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

async function answer(req) {
  const opt = { ignoreSearch: true };
  const hit = (await (await caches.open(PLAIN)).match(req, opt)) || (await (await caches.open(VERSION)).match(req, opt));
  if (hit) return hit;
  if (req.mode === 'navigate') {
    const login = await (await caches.open(VERSION)).match('./');
    if (login) return login;
  }
  return fetch(req);
}

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(answer(e.request));
});
