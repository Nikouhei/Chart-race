// 期間限定セール。期間中は Checkout にクーポンを自動で付ける（お客さんのコード入力は不要）。
// クーポンは Stripe 側に同じ ID で作っておく（サンドボックスと本番の両方。有効期限は付けず、期間はここで判定する）。
// 期間・割引を変えるときは src/components/PricingPage.astro の SALES と shared/export-plan.js の CONFIG.sales もそろえる（3か所）。
export const SALES = [
  {
    id: 'bf', // ブラックフライデー
    coupon: 'BF2026', // 30%OFF・duration once（月額/年額は初回の支払いだけ割引）
    promo: 'bf2026', // metadata に入れて、セール経由の購入を見分ける
    start: Date.parse('2026-11-22T00:00:00+09:00'),
    end: Date.parse('2026-12-01T00:00:00+09:00'), // 11/30 23:59:59 JST まで（Stripe のクーポン BF2026 の有効期限 11/30 と合わせる）
  },
  {
    id: 'cw', // サイバーウィーク
    coupon: 'CW2026', // 20%OFF・duration once・有効期限なし
    promo: 'cw2026',
    start: Date.parse('2026-12-01T00:00:00+09:00'), // 日本時間 12/1 0:00 から
    end: Date.parse('2026-12-08T00:00:00-08:00'), // 米国太平洋時間 12/7 23:59:59 まで（日本時間 12/8 16:59:59）
  },
];

// いま開催中のセール（無ければ null）
export function activeSale(now = Date.now()) {
  return SALES.find((s) => now >= s.start && now < s.end) || null;
}

// preview・localhost で期間外に試すとき用。true なら最後のセール、文字列なら同じ id のセール
export function saleById(id) {
  if (id === true) return SALES[SALES.length - 1];
  return SALES.find((s) => s.id === id) || null;
}
