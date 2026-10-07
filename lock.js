// The login page (index.html): opens the encrypted app (see lockcore.js) and goes on
// to app.html. With a saved login (30 days) this happens without a question - also
// after an update, when the new version is opened with the saved password key.
//
// Every step is shown; whatever goes wrong (or takes too long) is shown with a
// "Reset" button that removes the offline copy of the app (not the user's data) and
// starts again. Problems are also kept for More → Problems (the same list as web.js).

import { LOGIN_DAYS, b64, clearLock, openBox, passwordKey, readLock, saveLock, unb64, userId } from './lockcore.js';

const $ = (id) => document.getElementById(id);
const VERSION = document.querySelector('meta[name="st-version"]')?.content || 'dev';
const PLAIN = `st-plain-${VERSION}`;
const SW_WAIT_S = 90;   // the first start downloads the offline copy (about 20 MB)

$('ver').textContent = `version ${VERSION}`;

function keepProblem(text) {
  try {
    const list = JSON.parse(localStorage.getItem('st.problems')) || [];
    list.push(`${new Date().toLocaleTimeString()} ✖ login page: ${text}`);
    localStorage.setItem('st.problems', JSON.stringify(list.slice(-40)));
  } catch { /* storage unavailable */ }
}

function say(text, info = false) {
  $('msg').textContent = text;
  $('msg').className = info ? 'info' : '';
}

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
  say('Resetting…', true);
  try {
    for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
    for (const k of await caches.keys()) await caches.delete(k);
  } catch (e) { keepProblem(`reset: ${e.message}`); }
  location.replace('./');
};

async function fetchBytes(path) {
  let res;
  try {
    res = await fetch(path);
  } catch {
    throw new Error('No internet – the first start needs a connection, later the app works offline.');
  }
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

// the key of this version, opened with a password key (null: login unknown or password wrong)
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

// app.bin -> the files of the app in this device's cache
async function unpack(ck) {
  say('Opening the app: downloading…', true);
  const sealed = await fetchBytes('app.bin');
  say('Opening the app: decrypting…', true);
  const plain = await openBox(ck, sealed);
  const n = new DataView(plain.buffer, plain.byteOffset).getUint32(0, true);
  const head = JSON.parse(new TextDecoder().decode(plain.subarray(4, 4 + n)));
  say('Opening the app: storing…', true);
  await caches.delete(PLAIN);
  const cache = await caches.open(PLAIN);
  let at = 4 + n;
  for (const f of head.files) {
    const body = plain.slice(at, at + f.size);
    at += f.size;
    await cache.put(new URL(f.path, location.href).href, new Response(body, { headers: { 'Content-Type': f.type } }));
  }
  await cache.put(new URL('st-ready', location.href).href, new Response(VERSION));   // written last: all files are in
}

const opened = async () => Boolean(await (await caches.open(PLAIN)).match(new URL('st-ready', location.href).href));

// app.html is served by the offline copy (sw.js) of THIS version: wait until it runs
async function offlineCopy() {
  const t0 = Date.now();
  let reg = await navigator.serviceWorker.getRegistration();
  if (!reg) reg = await navigator.serviceWorker.register('sw.js');
  for (;;) {
    const sw = reg.active;
    if (sw && !reg.installing && !reg.waiting) return;
    if (reg.waiting) reg.waiting.postMessage('activate');   // a newer copy is ready: use it now
    const s = Math.round((Date.now() - t0) / 1000);
    if (s > SW_WAIT_S) {
      throw new Error(`The offline copy is not ready after ${SW_WAIT_S} s (installing: ${Boolean(reg.installing)}, `
        + `waiting: ${Boolean(reg.waiting)}, active: ${Boolean(sw)}). Check the internet and tap Reset.`);
    }
    say(`Preparing the offline copy (first start or update)… ${s} s`, true);
    await new Promise((r) => { setTimeout(r, 500); });
    reg = (await navigator.serviceWorker.getRegistration()) || reg;
  }
}

async function go() {
  await offlineCopy();
  say('Starting…', true);
  location.replace('app.html');
}

async function start() {
  if (!window.isSecureContext || !globalThis.crypto?.subtle || !('serviceWorker' in navigator)) {
    trouble('This app needs its https address (https://…github.io/…).');
    return;
  }
  navigator.serviceWorker.register('sw.js').catch((e) => keepProblem(`service worker: ${e.message}`));
  navigator.storage?.persist?.().catch(() => {});
  let expired = false;
  try { expired = Boolean(localStorage.getItem('st.lock')) && !readLock(); } catch { /* */ }
  const lock = readLock();
  if (lock) {
    try {
      say('Checking the saved login…', true);
      if (lock.version === VERSION && (await opened())) { await go(); return; }
      const ck = await versionKey(lock.login, unb64(lock.kek));
      if (ck) {
        await unpack(ck);
        saveLock({ ...lock, ck: b64(ck), version: VERSION });
        await go();
        return;
      }
      await clearLock();
      say('Your login is no longer valid – log in again.');
    } catch (e) {
      trouble(e.message);
      if (!(e.message || '').startsWith('No internet')) await clearLock();
    }
  } else {
    await clearLock();
    if (expired) say(`Your login has expired (every ${LOGIN_DAYS} days) – log in again.`);
    else say('');
  }
  $('form').hidden = false;
  if (!$('login').value) $('login').focus();
}

$('form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const login = $('login').value.trim().toLowerCase();
  const password = $('password').value;
  $('go').disabled = true;
  say('Checking…', true);
  try {
    const keys = JSON.parse(new TextDecoder().decode(await fetchBytes('keys.json')));
    const kek = await passwordKey(login, password, keys.iterations);
    const ck = await versionKey(login, kek);
    if (!ck) {
      say('Wrong login or password.');
      return;
    }
    await unpack(ck);
    saveLock({ login, until: Date.now() + LOGIN_DAYS * 86400e3, kek: b64(kek), ck: b64(ck), version: VERSION });
    await go();
  } catch (e) {
    trouble(e.message);
  } finally {
    $('go').disabled = false;
  }
});

// nothing happens for long: offer the way out
setTimeout(() => { if ($('form').hidden && !$('msg').textContent.startsWith('Preparing')) $('reset').hidden = false; }, 20000);

start().catch((e) => trouble(e.message));
