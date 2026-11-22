// 期間限定セール。期間中は Checkout にクーポンを自動で付ける（お客さんのコード入力は不要）。
// クーポンは Stripe 側に同じ ID で作っておく（サンドボックスと本番の両方）。
// 料金ページの表示期間は src/components/PricingPage.astro の SALE と合わせる。
export const SALE = {
  coupon: 'BF2026', // 30%OFF・duration once（月額/年額は初回の支払いだけ割引）
  promo: 'bf2026', // metadata に入れて、セール経由の購入を見分ける
  start: Date.parse('2026-11-22T00:00:00+09:00'),
  end: Date.parse('2026-12-01T00:00:00+09:00'), // 11/30 23:59:59 JST まで
};

export function isSaleActive(now = Date.now()) {
  return now >= SALE.start && now < SALE.end;
}
