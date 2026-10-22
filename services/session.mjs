// Web Crypto keeps the same verifier in Node tests and Cloudflare Workers.
const encoder = new TextEncoder();
export const COOKIE = 'big_slop_session';
export const SESSION_SECONDS = 12 * 60 * 60;
const hex = bytes => Array.from(new Uint8Array(bytes), b=>b.toString(16).padStart(2,'0')).join('');
const unhex = value => Uint8Array.from(value.match(/../g) || [], b=>parseInt(b,16));
export async function hashPassword(password, salt = crypto.getRandomValues(new Uint8Array(16))) {
  const key = await crypto.subtle.importKey('raw',encoder.encode(password),'PBKDF2',false,['deriveBits']);
  const derived = await crypto.subtle.deriveBits({name:'PBKDF2',salt,iterations:100000,hash:'SHA-256'},key,256);
  return `pbkdf2:100000:${hex(salt)}:${hex(derived)}`;
}
export function configured(config) {
  return typeof config.SESSION_SECRET === 'string' && config.SESSION_SECRET.length >= 32 && /^pbkdf2:100000:[0-9a-f]{32}:[0-9a-f]{64}$/.test(config.STUDIO_PASSWORD_HASH || '');
}
export async function verifyPassword(password, stored) {
  if (typeof password !== 'string' || password.length < 20 || password.length > 256 || !/^pbkdf2:100000:[0-9a-f]{32}:[0-9a-f]{64}$/.test(stored || '')) return false;
  const expected = stored.split(':');
  const actual = (await hashPassword(password, unhex(expected[2]))).split(':')[3];
  let diff = 0; for(let i=0;i<actual.length;i++) diff |= actual.charCodeAt(i)^expected[3].charCodeAt(i);
  return diff === 0;
}
async function signingKey(secret) {
  if (typeof secret !== 'string' || secret.length < 32) throw Error('Studio authentication is not configured.');
  return crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);
}
export async function issueSession(secret, now = Date.now()) {
  const body = `${Math.floor(now/1000)+SESSION_SECONDS}.${hex(crypto.getRandomValues(new Uint8Array(16)))}`;
  return `${body}.${hex(await crypto.subtle.sign('HMAC', await signingKey(secret),encoder.encode(body)))}`;
}
export async function validSession(token, secret, now = Date.now()) {
  if (!/^\d{10}\.[0-9a-f]{32}\.[0-9a-f]{64}$/.test(token || '') || typeof secret !== 'string' || secret.length<32) return false;
  const [expiry,nonce,signature] = token.split('.');
  const remaining = Number(expiry)-Math.floor(now/1000);
  if(remaining<=0 || remaining>SESSION_SECONDS) return false;
  return crypto.subtle.verify('HMAC',await signingKey(secret),unhex(signature),encoder.encode(`${expiry}.${nonce}`));
}
export function readSession(cookies) {
  const matches = (cookies || '').split(';').map(s=>s.trim()).filter(s=>s.startsWith(COOKIE+'='));
  return matches.length === 1 ? matches[0].slice(COOKIE.length+1) : '';
}
export function safeReturn(value) {
  if(typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return '/';
  try {const url=new URL(value,'https://studio.local');return url.origin==='https://studio.local' && !/^\/(login|logout|api\/auth)(\/|$)/.test(url.pathname) ? url.pathname+url.search+url.hash : '/';} catch{return '/';}
}
export function sessionCookie(token, secure, clear=false) {
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${clear?0:SESSION_SECONDS}${secure?'; Secure':''}`;
}
