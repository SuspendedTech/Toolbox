// The login of the iPhone/iPad app (public, like the login page).
//
// The published app is encrypted (tools/build_ios.py): app.bin holds the page, the
// engine and the app's own files, encrypted with a key made new at every publish.
// keys.json holds that key once per user, locked with a key made from the user's
// login and password (PBKDF2) - only a right password opens it. The opened files go
// into a cache of this device ("st-plain-<version>") that sw.js serves from.
//
// Kept on the device for 30 days: the user's password key (to open the key of a new
// version after an update) and the key of the current version (sample logs).

export const LOCK_KEY = 'st.lock';
export const LOGIN_DAYS = 30;
const enc = new TextEncoder();

export function b64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
export const unb64 = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
const hex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
const sha256 = async (text) => new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(text)));

// the saved login: {login, until, kek, ck, version} or null when there is none or it expired
export function readLock() {
  try {
    const lock = JSON.parse(localStorage.getItem(LOCK_KEY));
    return lock && lock.until > Date.now() ? lock : null;
  } catch {
    return null;
  }
}
export function saveLock(lock) {
  localStorage.setItem(LOCK_KEY, JSON.stringify(lock));
}
// log out: the saved login and the opened files are removed from this device
export async function clearLock() {
  try { localStorage.removeItem(LOCK_KEY); } catch { /* storage unavailable */ }
  for (const k of await caches.keys()) if (k.startsWith('st-plain-')) await caches.delete(k);
}

// iv (12 bytes) + AES-GCM ciphertext -> plain bytes (throws when the key is wrong)
export async function openBox(keyBytes, data, aad) {
  const key = await crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['decrypt']);
  const opt = { name: 'AES-GCM', iv: data.subarray(0, 12) };
  if (aad) opt.additionalData = enc.encode(aad);
  return new Uint8Array(await crypto.subtle.decrypt(opt, key, data.subarray(12)));
}

// the key made from a login and a password (the same as tools/build_ios.py makes)
export async function passwordKey(login, password, iterations) {
  const salt = (await sha256(`st-toolbox-salt:${login}`)).subarray(0, 16);
  const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, 256);
  return new Uint8Array(bits);
}

export const userId = async (login) => hex(await sha256(`st-toolbox-user:${login}`)).slice(0, 32);
