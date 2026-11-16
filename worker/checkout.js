// POST /api/checkout  { lookup_key, lang, source? }  →  { url }（Stripe の Checkout 画面）
import { PLANS, LANGS } from './plans.js';
import { StripeError, stripeRequest, findPriceByLookupKey } from './stripe.js';

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
  const metadata = source ? { plan, lang, source } : { plan, lang };

  // 戻り先は自分のオリジン（クライアントからは受け取らない）
  const origin = new URL(request.url).origin;
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
    const session =await stripeRequest(env, 'POST', '/checkout/sessions', params);
    return json({ url: session.url });
  } catch (err) {
    if (err instanceof StripeError) {
      console.error('[checkout] stripe error', err.status, JSON.stringify(err.detail));
      return json({ error: 'checkout_failed' }, 502);
    }
    throw err;
  }
}
