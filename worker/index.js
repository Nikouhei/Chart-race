// /api/* だけを処理する Worker。それ以外のパスは run_worker_first の対象外なので、
// Cloudflare が dist/（静的アセット）を直接返す。
import { handleCheckout } from './checkout.js';
import { handleWebhook } from './webhook.js';
import { handleLicense } from './license-api.js';

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

const routes = {
  '/api/checkout': handleCheckout,
  '/api/stripe-webhook': handleWebhook,
  '/api/license': handleLicense,
};

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    const handler = routes[pathname];
    if (!handler) return json({ error: 'not_found' }, 404);
    try {
      return await handler(request, env, ctx);
    } catch (err) {
      // 秘密情報を含みうるので、メッセージ本体は出さず種類だけ記録する
      console.error('[api] unhandled', pathname, err && err.name);
      return json({ error: 'internal_error' }, 500);
    }
  },
};
