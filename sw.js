// Offline support: every file of the app is kept on the device. VERSION and FILES
// are filled in by tools/build_ios.py. A new version is downloaded in the background
// and waits until the user taps "Reload" (web.js): the page and the engine never
// come from two different versions.
//
// The app itself is encrypted (app.bin, see lockcore.js): the login page opens it
// into the cache PLAIN, which is served first. A page that is not opened yet (a new
// version, or logged out) gets the login page instead.

const VERSION = 'st-bff57f7892c1';
const PLAIN = VERSION.replace(/^st-/, 'st-plain-');
const FILES = {
 "./": "fc2b4470fbf41ec73280",
 "app.bin": "a761186c2afe2b464bf6",
 "icons/icon-180.png": "547a0aecf920175d186e",
 "icons/icon-192.png": "9df50d180831927de843",
 "icons/icon-512.png": "a5388c74a4da583412e5",
 "index.html": "fc2b4470fbf41ec73280",
 "keys.json": "c3f9b18f9f9e2e6f1591",
 "lock.js": "fe1890a83bfc715acc2c",
 "lockcore.js": "8d940dbcadef37f12b56",
 "manifest.webmanifest": "97622974c71c2f8ebd9d",
 "vendor/pyodide/numpy-2.4.6-cp314-cp314-pyemscripten_2026_0_wasm32.whl": "73df573135588852a0b5",
 "vendor/pyodide/pyodide-lock.json": "1e3ab483e68041c15b73",
 "vendor/pyodide/pyodide.asm.mjs": "f7cdc8ece80678ceb712",
 "vendor/pyodide/pyodide.asm.wasm": "cc36e3cab04fdfc9a63f",
 "vendor/pyodide/pyodide.mjs": "6f1d60f7bf529beb300f",
 "vendor/pyodide/python_stdlib.zip": "2411ab860c91ea4b0ca0",
 "version.json": "f965f03a53e08c8befe0"
};            // file -> its SHA-256 (start)
const LIST = 'st-files.json';       // FILES as kept in the cache, written when all files are in
const SIZES = {"./": 4110, "app.bin": 1155974, "icons/icon-180.png": 1197, "icons/icon-192.png": 1272, "icons/icon-512.png": 3772, "index.html": 4110, "keys.json": 413, "lock.js": 13222, "lockcore.js": 2866, "manifest.webmanifest": 368, "vendor/pyodide/numpy-2.4.6-cp314-cp314-pyemscripten_2026_0_wasm32.whl": 4214393, "vendor/pyodide/pyodide-lock.json": 119077, "vendor/pyodide/pyodide.asm.mjs": 1250344, "vendor/pyodide/pyodide.asm.wasm": 9598218, "vendor/pyodide/pyodide.mjs": 17931, "vendor/pyodide/python_stdlib.zip": 5163819, "version.json": 27};            // file -> bytes: the loading bar of the login page asks for `got` of TOTAL
const TOTAL = Object.keys(FILES).reduce((s, f) => s + (SIZES[f] || 0), 0);
let got = 0;

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
    if (kept) {
      await cache.put(f, kept);
      got += SIZES[f] || 0;
      return;
    }
    const res = await fetch(f, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`${f}: ${res.status}`);
    const parts = [];
    for (const r = res.body.getReader(); ;) {
      const { done, value } = await r.read();
      if (done) break;
      parts.push(value);
      got += value.length;
    }
    const body = await new Blob(parts).arrayBuffer();
    // a stale copy from a CDN right after publishing would be copied into every later
    // version: refuse it - the install fails, the old version stays, the update is retried
    if (await sha(body) !== FILES[f]) throw new Error(`${f}: not the published file`);
    const head = new Headers(res.headers);
    head.delete('Content-Length');
    head.delete('Content-Encoding');
    await cache.put(f, new Response(body, { headers: head }));
  }));
  await cache.put(LIST, new Response(JSON.stringify(FILES), { headers: { 'Content-Type': 'application/json' } }));
}

self.addEventListener('install', (e) => {
  e.waitUntil(fill());
});

self.addEventListener('message', (e) => {
  if (e.data === 'activate') self.skipWaiting();
  if (e.data === 'version') e.ports[0]?.postMessage(VERSION);   // the login page asks which version serves it
  if (e.data === 'progress') e.ports[0]?.postMessage([got, TOTAL]);
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
