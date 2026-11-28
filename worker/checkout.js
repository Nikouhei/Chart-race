// POST /api/checkout  { lookup_key, lang, source? }  →  { url }（Stripe の Checkout 画面）
import { PLANS, LANGS } from './plans.js';
import { StripeError, stripeRequest, findPriceByLookupKey } from './stripe.js';
import { activeSale, saleById } from './sale.js';

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

export async function handleCheckout(request, env) {
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  let input;
  try {
    input = await request.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }
  const planDef = PLANS[input && input.lookup_key];
  const langDef = LANGS[input && input.lang];
  if (!planDef) return json({ error: 'invalid_lookup_key' }, 400);
  if (!langDef) return json({ error: 'invalid_lang' }, 400);
  const { plan, mode } = planDef;
  const lang = input.lang;
  // どのページから料金ページへ来たか（例: bar-chart-race）。分析用。形式が合わなければ捨てる
  const source = typeof input.source === 'string' && /^[a-z0-9-]{1,40}$/.test(input.source) ? input.source : '';
  // 戻り先は自分のオリジン（クライアントからは受け取らない）
  const reqUrl = new URL(request.url);
  const origin = reqUrl.origin;

  // セール中ならクーポンを付ける。preview・localhost だけは期間外でも force_sale で試せる
  const h = reqUrl.hostname;
  const isTestHost = h === 'localhost' || h === '127.0.0.1' || h.startsWith('preview-');
  // 指定があればそれを優先（期間中の別セールより先に見る）
  const forced = isTestHost && input.force_sale ? saleById(input.force_sale) : null;
  const sale = forced || activeSale();
  const metadata = source ? { plan, lang, source } : { plan, lang };
  if (sale) metadata.promo = sale.promo;
  const prefix = lang === 'en' ? '/en' : '';
  const params = {
    mode,
    'managed_payments': { enabled: true },
    line_items: [{ price: '', quantity: 1 }], // price は下で lookup_key から解決して入れる
    currency: langDef.currency, // 同じ price に JPY / USD 両方登録済み
    locale: langDef.locale,
    // 発行は webhook だけで行う。success_url は表示用（session_id でキーを引く）
    success_url: `${origin}${prefix}/thanks?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}${prefix === '/en' ? '/en/pricing' : '/pricing'}`,
    client_reference_id: plan,
    metadata,
  };
  // 更新・返金のイベントからプランをたどれるよう、subscription / payment_intent 側にも持たせる
  if (mode === 'subscription') params.subscription_data = { metadata };
  else params.payment_intent_data = { metadata };

  try {
    const price = await findPriceByLookupKey(env, input.lookup_key);
    if (!price) return json({ error: 'price_not_found' }, 404);
    params.line_items[0].price = price.id;
    let session;
    if (sale) {
      try {
        session = await stripeRequest(env, 'POST', '/checkout/sessions', { ...params, discounts: [{ coupon: sale.coupon }] });
      } catch (err) {
        // クーポンが無い・期限切れなどでも購入は止めない（通常価格で続ける）
        if (!(err instanceof StripeError)) throw err;
        console.error('[checkout] sale coupon failed, falling back', err.status, JSON.stringify(err.detail));
      }
    }
    if (!session) session = await stripeRequest(env, 'POST', '/checkout/sessions', params);
    return json({ url: session.url });
  } catch (err) {
    if (err instanceof StripeError) {
      console.error('[checkout] stripe error', err.status, JSON.stringify(err.detail));
      return json({ error: 'checkout_failed' }, 502);
    }
    throw err;
  }
}
