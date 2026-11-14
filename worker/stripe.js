// Stripe API を fetch で呼ぶ薄いラッパー（SDK は使わない）。
// APIキーは env.STRIPE_SECRET_KEY（.dev.vars / wrangler secret）からだけ読む。ログやエラーに出さない。

// Managed Payments は 2025-03-31.basil 以降。env.STRIPE_API_VERSION で上書きできる
const DEFAULT_API_VERSION = '2025-03-31.basil';

// 入れ子のオブジェクト・配列を Stripe の形式（a[b]=1, a[0][b]=1）に展開する
export function encodeForm(obj, prefix = '', out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) v.forEach((item, i) => (typeof item === 'object' ? encodeForm(item, `${key}[${i}]`, out) : out.append(`${key}[${i}]`, String(item))));
    else if (typeof v === 'object') encodeForm(v, key, out);
    else out.append(key, String(v));
  }
  return out;
}

export class StripeError extends Error {
  constructor(status, body) {
    super(`stripe_${status}`);
    this.name = 'StripeError';
    this.status = status;
    // Stripe のエラー本文（type / code / param / message）。キーは含まれない
    this.detail = body && body.error ? { type: body.error.type, code: body.error.code, param: body.error.param, message: body.error.message } : null;
  }
}

export async function stripeRequest(env, method, path, params) {
  if (!env.STRIPE_SECRET_KEY) throw new StripeError(0, { error: { type: 'config', message: 'STRIPE_SECRET_KEY is not set' } });
  const headers = {
    authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
    'stripe-version': env.STRIPE_API_VERSION || DEFAULT_API_VERSION,
  };
  let url = `https://api.stripe.com/v1${path}`;
  let body;
  if (method === 'GET') {
    if (params) url += `?${encodeForm(params)}`;
  } else {
    headers['content-type'] = 'application/x-www-form-urlencoded';
    body = params ? encodeForm(params).toString() : '';
  }
  const res = await fetch(url, { method, headers, body });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new StripeError(res.status, data);
  return data;
}

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

// 時間をそろえて比較する（先頭の不一致で早く返さない）
function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Stripe-Signature（t=...,v1=...）の検証。rawBody は JSON.parse する前の文字列そのまま。
export async function verifyWebhook(rawBody, header, secret, { toleranceSec = 300, nowSec = Math.floor(Date.now() / 1000) } = {}) {
  if (!secret || !header) return false;
  let t = null;
  const sigs = [];
  for (const part of header.split(',')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k === 't') t = v;
    else if (k === 'v1') sigs.push(v);
  }
  if (!t || !sigs.length || !/^\d+$/.test(t)) return false;
  if (Math.abs(nowSec - Number(t)) > toleranceSec) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const expected = hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${rawBody}`)));
  return sigs.some((s) => safeEqual(s, expected));
}

// lookup_key から有効な price を1件取得する
export async function findPriceByLookupKey(env, lookupKey) {
  const list = await stripeRequest(env, 'GET', '/prices', { lookup_keys: [lookupKey], active: true, limit: 1 });
  return list.data && list.data[0] ? list.data[0] : null;
}
