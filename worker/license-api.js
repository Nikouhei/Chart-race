// /api/license
//   POST { license_key }  … ツールからの照会。→ { valid, plan?, expires_at? }
//   GET  ?session_id=cs_… … 購入完了ページ用。→ { status: 'ready', key, plan, expires_at, valid } / 202 { status: 'pending' }
import { isValid, normalizeKey } from './license.js';

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

const KEY_RE = /^GRS-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/;
const SESSION_RE = /^cs_(test|live)_[A-Za-z0-9]{10,200}$/;

async function checkKey(request, env) {
  let input;
  try {
    input = await request.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }
  const key = normalizeKey(input && input.license_key);
  // 形式が違うもの・無いもの・期限切れ・返金済みは、理由を区別せず同じ「無効」で返す
  if (!KEY_RE.test(key)) return json({ valid: false });
  const row = await env.DB.prepare('SELECT plan, status, expires_at FROM licenses WHERE key = ?').bind(key).first();
  if (!isValid(row)) return json({ valid: false });
  return json({ valid: true, plan: row.plan, expires_at: row.expires_at });
}

// 購入直後は webhook がまだ届いていないことがあるので、無ければ pending を返してページ側で数回引き直す
async function keyBySession(request, env) {
  const sessionId = new URL(request.url).searchParams.get('session_id') || '';
  if (!SESSION_RE.test(sessionId)) return json({ error: 'invalid_session_id' }, 400);
  const row = await env.DB.prepare('SELECT key, plan, status, expires_at FROM licenses WHERE session_id = ?').bind(sessionId).first();
  if (!row) return json({ status: 'pending' }, 202);
  return json({ status: 'ready', key: row.key, plan: row.plan, expires_at: row.expires_at, valid: isValid(row) });
}

export async function handleLicense(request, env) {
  if (request.method === 'POST') return checkKey(request, env);
  if (request.method === 'GET') return keyBySession(request, env);
  return json({ error: 'method_not_allowed' }, 405);
}
