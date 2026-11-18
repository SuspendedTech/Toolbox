// The login page (index.html): opens the encrypted app (see lockcore.js) and goes on
// to pc.html on a computer, app.html on a phone or iPad (the choice made in either is kept:
// st.ui). With a saved login this happens without a question - also after an update, when
// the key of the new version is fetched with the saved login.
//
// The key of a version (tools/build_ios.py): on GitHub from keys.json with the password
// (30 days), on baribalbike.com (<meta name="st-auth" content="server">) from key.php with
// the site account (until the last day of the licence, renewed at every opening online;
// the server checks the licence and a blocked account).
//
// One loading bar from here to the ready app: 0..COPY the offline copy (sw.js), up to
// OPEN the app opened, the rest is the engine (web.js, the position goes on in sessionStorage).
// Whatever goes wrong (or takes too long) is shown with a "Reset" button that removes
// the offline copy of the app (not the user's data) and starts again. Problems are also
// kept for More → Problems (the same list as web.js).

import { LOGIN_DAYS, b64, clearLock, openBox, passwordKey, readLock, saveLock, unb64, userId } from './lockcore.js';

window.stLock = true;   // lock.html: this script started
const $ = (id) => document.getElementById(id);
const VERSION = document.querySelector('meta[name="st-version"]')?.content || 'dev';
const SERVER = document.querySelector('meta[name="st-auth"]')?.content === 'server';
const PLAIN = `st-plain-${VERSION}`;
const SW_WAIT_S = 90;   // the first start downloads the offline copy (about 25 MB)
const COPY = 0.4;
const OPEN = 0.5;
const NO_NET = 'No internet – the first start needs a connection, later the app works offline.';

$('ver').textContent = `version ${VERSION}`;

let bar = 0;
let moved = Date.now();
function setBar(x) {
  bar = Math.max(bar, x);
  moved = Date.now();
  $('bar').firstChild.style.width = `${bar * 100}%`;
}
// the form or the bar
function ask(on) {
  $('form').hidden = !on;
  $('bar').hidden = on;
  if (on && !$('login').value) $('login').focus();
}

function keepProblem(text) {
  try {
    const list = JSON.parse(localStorage.getItem('st.problems')) || [];
    list.push(`${new Date().toLocaleTimeString()} ✖ login page: ${text}`);
    localStorage.setItem('st.problems', JSON.stringify(list.slice(-40)));
  } catch { /* storage unavailable */ }
}

const say = (text) => { $('msg').textContent = text; };

// something went wrong: shown, kept, and the way out offered
function trouble(text) {
  say(text);
  keepProblem(text);
  $('reset').hidden = false;
}

addEventListener('error', (e) => trouble(`${e.message} (${(e.filename || '').split('/').pop()}:${e.lineno})`));
addEventListener('unhandledrejection', (e) => trouble(String(e.reason?.message || e.reason)));

// Reset: the offline copy of the app goes (service worker, caches); the saved data
// (runs, bikes, workbooks) and the login stay
$('reset').onclick = async () => {
  say('');
  try { sessionStorage.removeItem('st.starts'); } catch { /* */ }
  try {
    for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
    for (const k of await caches.keys()) await caches.delete(k);
  } catch (e) { keepProblem(`reset: ${e.message}`); }
  location.replace('./');
};

// Safari on iPhone/iPad: how to put the app on the home screen (× hides it for good)
const iOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
try {
  if (iOS && !navigator.standalone && !localStorage.getItem('st.a2hs')) $('a2hs').hidden = false;
} catch { /* storage unavailable */ }
$('a2hs-x').onclick = () => {
  $('a2hs').hidden = true;
  try { localStorage.setItem('st.a2hs', '1'); } catch { /* */ }
};

async function fetchBytes(path) {
  let res;
  try {
    res = await fetch(path);
  } catch {
    throw new Error(NO_NET);
  }
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

// GitHub: the key of this version, opened with a password key (null: login unknown or password wrong)
async function versionKey(login, kek) {
  const keys = JSON.parse(new TextDecoder().decode(await fetchBytes('keys.json')));
  const wrapped = keys.users[await userId(login)];
  if (!wrapped) return null;
  try {
    return await openBox(kek, unb64(wrapped), 'st-key');
  } catch {
    return null;
  }
}

// baribalbike.com: {ck, token, until, features} for {login, password} or {token}; a refusal is thrown with its text
async function serverKey(body) {
  let res;
  try {
    res = await fetch('key.php', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } catch {
    throw new Error(NO_NET);
  }
  const a = await res.json().catch(() => ({ error: `key.php: ${res.status}` }));
  if (a.error) throw Object.assign(new Error(a.error), { refused: res.status === 401 || res.status === 403 });
  return a;
}

// app.bin of this version: from the offline copy (filled before), else from the internet
async function appBin() {
  try {
    const kept = await (await caches.open(`st-${VERSION}`)).match('app.bin');
    if (kept) return new Uint8Array(await kept.arrayBuffer());
  } catch { /* not there: downloaded */ }
  return fetchBytes('app.bin');
}

// gzip-packed (tools/build_ios.py packs the app before encrypting it)
async function gunzip(bytes) {
  if (typeof DecompressionStream === 'undefined') throw new Error('This browser is too old for the app – update iOS.');
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// app.bin -> the files of the app in this device's cache
async function unpack(ck) {
  let plain = await openBox(ck, await appBin());
  if (plain[0] === 0x1f && plain[1] === 0x8b && plain[2] === 0x08) plain = await gunzip(plain);
  const n = new DataView(plain.buffer, plain.byteOffset).getUint32(0, true);
  const head = JSON.parse(new TextDecoder().decode(plain.subarray(4, 4 + n)));
  await caches.delete(PLAIN);
  const cache = await caches.open(PLAIN);
  let at = 4 + n;
  for (const [i, f] of head.files.entries()) {
    const body = plain.slice(at, at + f.size);
    at += f.size;
    await cache.put(new URL(f.path, location.href).href, new Response(body, { headers: { 'Content-Type': f.type } }));
    setBar(COPY + (OPEN - COPY) * (i + 1) / head.files.length);
  }
  await cache.put(new URL('st-ready', location.href).href, new Response(VERSION));   // written last: all files are in
}

const opened = async () => Boolean(await (await caches.open(PLAIN)).match(new URL('st-ready', location.href).href));

// a question to a service worker ('version', 'progress'); null: no answer
function swAsk(sw, what) {
  if (!sw) return Promise.resolve(null);
  return new Promise((resolve) => {
    const ch = new MessageChannel();
    ch.port1.onmessage = (e) => resolve(e.data);
    sw.postMessage(what, [ch.port2]);
    setTimeout(() => resolve(null), 1000);
  });
}

// app.html is served by the offline copy (sw.js) of THIS version: wait until it runs
async function offlineCopy() {
  const t0 = Date.now();
  let reg = await navigator.serviceWorker.getRegistration();
  if (!reg) reg = await navigator.serviceWorker.register('sw.js');
  for (;;) {
    const sw = reg.active;
    if (sw && !reg.installing && !reg.waiting) break;
    // this version already serves the page (after an update iOS may keep showing the
    // registration's old state until the app is restarted)
    if (await swAsk(navigator.serviceWorker.controller, 'version') === `st-${VERSION}`) break;
    if (reg.waiting) reg.waiting.postMessage('activate');   // a newer copy is ready: use it now
    if (Date.now() - t0 > SW_WAIT_S * 1000 && Date.now() - moved > 20000) {
      throw new Error(`The offline copy is not ready after ${Math.round((Date.now() - t0) / 1000)} s (installing: `
        + `${Boolean(reg.installing)}, waiting: ${Boolean(reg.waiting)}, active: ${Boolean(sw)}). Check the internet and tap Reset.`);
    }
    const p = await swAsk(reg.installing, 'progress');
    if (p?.[1]) setBar(COPY * Math.min(1, p[0] / p[1]));
    await new Promise((r) => { setTimeout(r, 300); });
    reg = (await navigator.serviceWorker.getRegistration()) || reg;
  }
  setBar(COPY);
}

// Times the app was started from here in this window; more than 3 within 20 s is a loop.
function looping() {
  const now = Date.now();
  let starts = [];
  try { starts = JSON.parse(sessionStorage.getItem('st.starts')) || []; } catch { /* */ }
  starts = starts.filter((t) => now - t < 20000);
  starts.push(now);
  try { sessionStorage.setItem('st.starts', JSON.stringify(starts)); } catch { /* */ }
  return starts.length > 3;
}

async function go() {
  if (looping()) {
    trouble('The app keeps coming back here. Close the app and open it again, or tap Reset (your runs, bikes and workbooks stay).');
    return;
  }
  await offlineCopy();
  try { sessionStorage.setItem('st.bar', String(bar)); } catch { /* */ }
  let ui = null;
  try { ui = localStorage.getItem('st.ui'); } catch { /* */ }
  location.replace((ui || (iOS || /Android|Mobi/i.test(navigator.userAgent) ? 'phone' : 'pc')) === 'pc' ? 'pc.html' : 'app.html');
}

// a login ({login, ck, until, kek | token}): this version opened with it, then the app
async function open(lock) {
  await offlineCopy();
  await unpack(unb64(lock.ck));
  saveLock({ ...lock, version: VERSION });
  try { localStorage.removeItem('st.loggedOut'); } catch { /* */ }
  await go();
}

async function start() {
  if (!window.isSecureContext || !globalThis.crypto?.subtle || !('serviceWorker' in navigator)) {
    trouble('This app needs its https address.');
    return;
  }
  navigator.serviceWorker.register('sw.js').catch((e) => keepProblem(`service worker: ${e.message}`));
  navigator.storage?.persist?.().catch(() => {});
  let expired = false;
  try { expired = Boolean(localStorage.getItem('st.lock')) && !readLock(); } catch { /* */ }
  let out = false;
  try { out = Boolean(localStorage.getItem('st.loggedOut')); } catch { /* */ }
  let lock = readLock();
  // baribalbike.com: the app follows the account logged in on the website; another one there
  // replaces the saved login (offline or not logged in there: the saved login stays)
  if (SERVER && !out && lock) {
    const who = await fetch('key.php', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: '{"site":1,"who":1}', signal: AbortSignal.timeout?.(4000) }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (who?.login && who.login !== lock.login) lock = null;
  }
  if (lock) {
    try {
      if (lock.version === VERSION && (await opened())) { await go(); return; }
      const a = SERVER ? await serverKey({ token: lock.token }) : null;
      const ck = SERVER ? a.ck : await versionKey(lock.login, unb64(lock.kek));
      if (ck) {
        await open({ ...lock, ck: SERVER ? ck : b64(ck), ...(a?.features && { features: a.features }), ...(a?.until && { until: a.until }) });
        return;
      }
      await clearLock();
      say('Your login is no longer valid – log in again.');
    } catch (e) {
      if (e.refused) {
        await clearLock();
        say(e.message);
      } else {
        trouble(e.message);
        if (!e.message.startsWith('No internet')) await clearLock();
      }
    }
  } else {
    await clearLock();
    if (SERVER && !out) {
      try {
        const a = await serverKey({ site: 1 });
        await open({ login: a.login, until: a.until, token: a.token, ck: a.ck, features: a.features });
        return;
      } catch { /* not logged in on the website: the form */ }
    }
    say(expired ? 'Your login has expired – log in again.' : '');
  }
  ask(true);
}

$('form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const login = $('login').value.trim().toLowerCase();
  const password = $('password').value;
  say('');
  ask(false);
  try {
    if (SERVER) {
      const a = await serverKey({ login, password });
      await open({ login, until: a.until, token: a.token, ck: a.ck, features: a.features });
      return;
    }
    const keys = JSON.parse(new TextDecoder().decode(await fetchBytes('keys.json')));
    const kek = await passwordKey(login, password, keys.iterations);
    const ck = await versionKey(login, kek);
    if (!ck) throw Object.assign(new Error('Wrong login or password.'), { refused: true });
    await open({ login, until: Date.now() + LOGIN_DAYS * 86400e3, kek: b64(kek), ck: b64(ck) });
  } catch (e) {
    if (e.refused) say(e.message);
    else trouble(e.message);
    ask(true);
  }
});

// nothing moves for long: offer the way out
setInterval(() => { if ($('form').hidden && Date.now() - moved > 20000) $('reset').hidden = false; }, 5000);

start().catch((e) => trouble(e.message));
