// POST /api/stripe-webhook
// 署名検証 → イベントIDで冪等化 → イベントごとの処理。success_url だけではキーを発行しない。
//
// 冪等化の方針: 各処理自体を何度流しても同じ結果になるように書き（session_id の UNIQUE、UPDATE は条件付き）、
// 処理が最後まで成功したときだけ stripe_events に記録する。途中で失敗したら 500 を返して Stripe に再送させる。
import { PLAN_IDS, PASS7_SECONDS, GRACE_SECONDS } from './plans.js';
import { stripeRequest, verifyWebhook } from './stripe.js';
import { issueLicense, nowSec } from './license.js';
import { sendLicenseEmail } from './mail.js';

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

// --- Stripe オブジェクトからの取り出し（API バージョン差を吸収） ---------------------------------

// サブスクの現在の期間の終わり（basil 以降は items 側、それ以前は subscription 直下）
const subscriptionPeriodEnd = (sub) => (sub.items && sub.items.data && sub.items.data[0] && sub.items.data[0].current_period_end) || sub.current_period_end || null;

const invoiceSubscriptionId = (inv) =>
  (inv.parent && inv.parent.subscription_details && inv.parent.subscription_details.subscription) ||
  inv.subscription ||
  (inv.lines && inv.lines.data && inv.lines.data[0] && inv.lines.data[0].parent && inv.lines.data[0].parent.subscription_item_details && inv.lines.data[0].parent.subscription_item_details.subscription) ||
  null;

const invoicePeriodEnd = (inv) => Math.max(0, ...((inv.lines && inv.lines.data) || []).map((l) => (l.period && l.period.end) || 0));

// --- イベントごとの処理 -------------------------------------------------------------------------

// 支払い完了 → キー発行＋メール。コンビニ等の遅延決済は async_payment_succeeded で改めて来る
async function onCheckoutPaid(event, env) {
  const s = event.data.object;
  if (s.payment_status !== 'paid' && s.payment_status !== 'no_payment_required') return;

  const plan = (s.metadata && s.metadata.plan) || s.client_reference_id;
  if (!PLAN_IDS.has(plan)) throw new Error('unknown_plan');
  const email = (s.customer_details && s.customer_details.email) || s.customer_email;
  if (!email) throw new Error('missing_email');

  let expiresAt;
  if (plan === 'pass7') {
    expiresAt = event.created + PASS7_SECONDS; // 支払い完了時に「7日後」
  } else {
    if (!s.subscription) throw new Error('missing_subscription');
    expiresAt = subscriptionPeriodEnd(await stripeRequest(env, 'GET', `/subscriptions/${s.subscription}`));
    if (!expiresAt) throw new Error('missing_period_end');
  }

  const { license } = await issueLicense(env.DB, {
    email,
    plan,
    expiresAt,
    subscriptionId: s.subscription,
    customerId: s.customer,
    sessionId: s.id,
    paymentIntent: s.payment_intent,
  });
  // 失敗して再送されたときもメールを送り直せるよう、created に関わらず送る（記録は最後なので二重にはならない）
  await sendLicenseEmail(env, { to: license.email, key: license.key, plan: license.plan, expiresAt: license.expires_at, lang: s.metadata && s.metadata.lang });
}

// サブスクの更新の支払い成功 → 期限を現在の期間の終わりまで延ばす。
// 返金済みは復活させない。MAX で、遅れて届いた古い請求書が期限を縮めないようにする
async function onInvoicePaid(event, env) {
  const inv = event.data.object;
  const subId = invoiceSubscriptionId(inv);
  const end = invoicePeriodEnd(inv);
  if (!subId || !end) return;
  // 初回の請求書が checkout.session.completed より先に届いた場合は該当なし（発行時に期間を取るので問題ない）
  await env.DB.prepare("UPDATE licenses SET expires_at = MAX(expires_at, ?), status = 'active', updated_at = ? WHERE subscription_id = ? AND status != 'refunded'")
    .bind(end, nowSec(), subId)
    .run();
}

// 更新の支払い失敗 → 初回の失敗だけ猶予を付ける（Smart Retries の失敗のたびに延びないよう active のときだけ）
async function markPastDue(env, subId) {
  const t = nowSec();
  await env.DB.prepare("UPDATE licenses SET status = 'past_due', expires_at = MAX(expires_at, ?), updated_at = ? WHERE subscription_id = ? AND status = 'active'")
    .bind(t + GRACE_SECONDS, t, subId)
    .run();
}

async function onInvoicePaymentFailed(event, env) {
  const subId = invoiceSubscriptionId(event.data.object);
  if (subId) await markPastDue(env, subId);
}

// 解約・回収の打ち切り → 期限（猶予中ならその終わり）で失効。期限は変えない
async function markCanceled(env, subId) {
  await env.DB.prepare("UPDATE licenses SET status = 'canceled', updated_at = ? WHERE subscription_id = ? AND status NOT IN ('refunded', 'canceled')")
    .bind(nowSec(), subId)
    .run();
}

async function onSubscriptionDeleted(event, env) {
  await markCanceled(env, event.data.object.id);
}

// 状態の同期。期限は延ばさない（更新の支払いが済む前に current_period_end だけ先に進むため。延長は invoice.paid だけ）
async function onSubscriptionUpdated(event, env) {
  const sub = event.data.object;
  if (sub.status === 'past_due') await markPastDue(env, sub.id);
  else if (sub.status === 'unpaid' || sub.status === 'canceled' || sub.status === 'incomplete_expired') await markCanceled(env, sub.id);
}

// 返金 → 即停止。Stripe 側の判断による返金もあるので手動停止に頼らない
async function licensesForCharge(env, charge) {
  const pi = charge.payment_intent;
  if (pi) {
    const { results } = await env.DB.prepare('SELECT key, subscription_id FROM licenses WHERE payment_intent = ?').bind(pi).all();
    if (results.length) return results;
  }
  // サブスクの更新分の支払い: payment_intent → 請求書 → サブスクをたどる
  let invoiceId = charge.invoice || null;
  if (!invoiceId && pi) {
    const payments = await stripeRequest(env, 'GET', '/invoice_payments', { payment: { type: 'payment_intent', payment_intent: pi }, limit: 1 });
    const invoice = payments.data && payments.data[0] && payments.data[0].invoice;
    invoiceId = typeof invoice === 'string' ? invoice : invoice && invoice.id;
  }
  if (!invoiceId) return [];
  const inv = await stripeRequest(env, 'GET', `/invoices/${invoiceId}`);
  const subId = invoiceSubscriptionId(inv);
  if (!subId) return [];
  const { results } = await env.DB.prepare('SELECT key, subscription_id FROM licenses WHERE subscription_id = ?').bind(subId).all();
  return results;
}

// 返金したサブスクは続けて課金されないよう、Stripe 側も即解約する（解約済みなら何もしない）。
// キーの停止を先に済ませてから呼ぶ。失敗したら例外にして Stripe に再送させる（どちらも繰り返しても結果は同じ）
async function cancelSubscription(env, subId) {
  const sub = await stripeRequest(env, 'GET', `/subscriptions/${subId}`);
  if (sub.status === 'canceled') return;
  await stripeRequest(env, 'DELETE', `/subscriptions/${subId}`);
}

async function onChargeRefunded(event, env) {
  const charge = event.data.object;
  if (!(charge.amount_refunded > 0)) return;
  const licenses = await licensesForCharge(env, charge);
  if (!licenses.length) {
    // 該当キーなし（発行前の返金など）。再送しても結果は同じなので 200 で受けて記録だけ残す
    console.warn('[webhook] charge.refunded: 該当するライセンスなし', event.id);
    return;
  }
  const t = nowSec();
  for (const { key } of licenses) {
    await env.DB.prepare("UPDATE licenses SET status = 'refunded', expires_at = MIN(expires_at, ?), updated_at = ? WHERE key = ?").bind(t, t, key).run();
  }
  for (const subId of new Set(licenses.map((l) => l.subscription_id).filter(Boolean))) await cancelSubscription(env, subId);
}

const HANDLERS = {
  'checkout.session.completed': onCheckoutPaid,
  'checkout.session.async_payment_succeeded': onCheckoutPaid,
  // checkout.session.async_payment_failed: キーを発行しないので何もしない（受けるだけ）
  'invoice.paid': onInvoicePaid,
  'invoice.payment_failed': onInvoicePaymentFailed,
  'customer.subscription.updated': onSubscriptionUpdated,
  'customer.subscription.deleted': onSubscriptionDeleted,
  'charge.refunded': onChargeRefunded,
};

export async function handleWebhook(request, env) {
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const raw = await request.text();
  const ok = await verifyWebhook(raw, request.headers.get('stripe-signature'), env.STRIPE_WEBHOOK_SECRET);
  if (!ok) return json({ error: 'invalid_signature' }, 400);

  let event;
  try {
    event = JSON.parse(raw);
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }
  if (!event || !event.id || !event.type) return json({ error: 'invalid_event' }, 400);

  const seen = await env.DB.prepare('SELECT 1 AS x FROM stripe_events WHERE event_id = ?').bind(event.id).first();
  if (seen) return json({ received: true, duplicate: true });

  const handler = HANDLERS[event.type];
  if (!handler) return json({ received: true, ignored: true });

  try {
    await handler(event, env);
  } catch (err) {
    // 顧客情報を含みうる本文は出さず、イベントと原因の種類だけ記録する。500 で Stripe に再送させる
    console.error('[webhook] failed', event.type, event.id, err && err.message, err && err.detail ? JSON.stringify(err.detail) : '');
    return json({ error: 'handler_failed' }, 500);
  }
  await env.DB.prepare('INSERT OR IGNORE INTO stripe_events (event_id, type, processed_at) VALUES (?, ?, ?)').bind(event.id, event.type, nowSec()).run();
  return json({ received: true });
}
