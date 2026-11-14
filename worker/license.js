// ライセンスキーの生成と D1 の操作。日時はすべて Unix 秒。

// 0 / O / 1 / I など紛らわしい文字を除いた 32 文字（32 = 2^5 なので乱数の偏りが出ない）
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generateKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  const chars = [...bytes].map((b) => ALPHABET[b & 31]);
  return `GRS-${chars.slice(0, 4).join('')}-${chars.slice(4, 8).join('')}-${chars.slice(8, 12).join('')}`;
}

// 入力の揺れ（小文字・空白・全角ハイフン）をそろえる
export function normalizeKey(input) {
  return String(input || '')
    .trim()
    .toUpperCase()
    .replace(/[\s‐-―−－]/g, '-');
}

export const nowSec = () => Math.floor(Date.now() / 1000);

// session_id ごとに1件だけ発行する。すでにあればそれを返す（created=false）。
export async function issueLicense(db, { email, plan, expiresAt, subscriptionId, customerId, sessionId, paymentIntent }) {
  const t = nowSec();
  for (let attempt = 0; attempt < 5; attempt++) {
    const key = generateKey();
    try {
      await db
        .prepare(
          `INSERT INTO licenses (key, email, plan, status, expires_at, subscription_id, customer_id, session_id, payment_intent, created_at, updated_at)
           VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(session_id) DO NOTHING`,
        )
        .bind(key, email, plan, expiresAt, subscriptionId || null, customerId || null, sessionId, paymentIntent || null, t, t)
        .run();
    } catch (err) {
      // key の衝突（極めてまれ）だけ作り直す。それ以外は上へ
      if (/UNIQUE constraint failed: licenses\.key/.test(String(err && err.message))) continue;
      throw err;
    }
    const row = await db.prepare('SELECT * FROM licenses WHERE session_id = ?').bind(sessionId).first();
    return { license: row, created: row.key === key };
  }
  throw new Error('key_generation_failed');
}

export function isValid(row, at = nowSec()) {
  return !!row && row.status !== 'refunded' && row.expires_at > at;
}
