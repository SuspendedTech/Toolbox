// Offline support: every file of the app is kept on the device. VERSION and FILES
// are filled in by tools/build_ios.py. A new version is downloaded in the background
// and waits until the user taps "Reload" (web.js): the page and the engine never
// come from two different versions.
//
// The app itself is encrypted (app.bin, see lockcore.js): the login page opens it
// into the cache PLAIN, which is served first. A page that is not opened yet (a new
// version, or logged out) gets the login page instead.

const VERSION = 'st-8b663e1354ce';
const PLAIN = VERSION.replace(/^st-/, 'st-plain-');
const FILES = {
 "./": "8138ffbcd52b99705128",
 "app.bin": "f135da1fae7d8e418ecc",
 "icons/icon-180.png": "547a0aecf920175d186e",
 "icons/icon-192.png": "9df50d180831927de843",
 "icons/icon-512.png": "a5388c74a4da583412e5",
 "index.html": "8138ffbcd52b99705128",
 "keys.json": "6e0a13a4f82155ec6596",
 "lock.js": "63b7488cce13bce3c9a0",
 "lockcore.js": "8d940dbcadef37f12b56",
 "manifest.webmanifest": "97622974c71c2f8ebd9d",
 "vendor/pyodide/numpy-2.4.6-cp314-cp314-pyemscripten_2026_0_wasm32.whl": "73df573135588852a0b5",
 "vendor/pyodide/pyodide-lock.json": "1e3ab483e68041c15b73",
 "vendor/pyodide/pyodide.asm.mjs": "f7cdc8ece80678ceb712",
 "vendor/pyodide/pyodide.asm.wasm": "cc36e3cab04fdfc9a63f",
 "vendor/pyodide/pyodide.mjs": "6f1d60f7bf529beb300f",
 "vendor/pyodide/python_stdlib.zip": "2411ab860c91ea4b0ca0",
 "version.json": "ab4d543502a5ba881c66"
};            // file -> its SHA-256 (start)
const LIST = 'st-files.json';       // FILES as kept in the cache, written when all files are in

// A new version: the files it shares with the offline copy of an older version (same
// SHA-256, e.g. Pyodide - most of the 20 MB) are copied from there, the others are
// downloaded, past the browser's own cache (no stale file from an earlier version).
async function sha(buf) {          // the start of the SHA-256, as build_ios.py writes it
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', buf));
  return Array.from(d, (b) => b.toString(16).padStart(2, '0')).join('').slice(0, 20);
}

async function fill() {
  const cache = await caches.open(VERSION);
  const have = new Map();           // file -> the older cache that has it
  for (const k of await caches.keys()) {
    if (k === VERSION || !k.startsWith('st-') || k.startsWith('st-plain-')) continue;
    try {
      const old = await caches.open(k);
      const list = await (await old.match(LIST))?.json();
      for (const [f, sha] of Object.entries(list || {})) if (FILES[f] === sha && !have.has(f)) have.set(f, old);
    } catch { /* an unreadable older copy: its files are downloaded */ }
  }
  await Promise.all(Object.keys(FILES).map(async (f) => {
    const kept = await have.get(f)?.match(f);
    if (kept) return cache.put(f, kept);
    const res = await fetch(f, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`${f}: ${res.status}`);
    // a stale copy from a CDN right after publishing would be copied into every later
    // version: refuse it - the install fails, the old version stays, the update is retried
    if (await sha(await res.clone().arrayBuffer()) !== FILES[f]) throw new Error(`${f}: not the published file`);
    return cache.put(f, res);
  }));
  await cache.put(LIST, new Response(JSON.stringify(FILES), { headers: { 'Content-Type': 'application/json' } }));
}

self.addEventListener('install', (e) => {
  e.waitUntil(fill());
});

self.addEventListener('message', (e) => {
  if (e.data === 'activate') self.skipWaiting();
  if (e.data === 'version') e.ports[0]?.postMessage(VERSION);   // the login page asks which version serves it
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
