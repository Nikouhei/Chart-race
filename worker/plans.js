// プランの定義。価格IDは書かない（lookup_key から Stripe に問い合わせる。本番は別IDになるため）。
export const PLANS = {
  grs_pass7: { plan: 'pass7', mode: 'payment' }, // 7日パス（1回払い・自動更新なし）
  grs_monthly: { plan: 'monthly', mode: 'subscription' },
  grs_yearly: { plan: 'yearly', mode: 'subscription' },
};

export const PLAN_IDS = new Set(['pass7', 'monthly', 'yearly']);

export const LANGS = { ja: { currency: 'jpy', locale: 'ja' }, en: { currency: 'usd', locale: 'en' } };

export const PASS7_SECONDS = 7 * 24 * 60 * 60;
// 更新の支払いに失敗してから失効するまでの猶予（2026-11-14 決定: 3日）
export const GRACE_SECONDS = 3 * 24 * 60 * 60;
