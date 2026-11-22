// GET /api/img?url=https://...
// CORS を許可していないサイトの画像は canvas に描くと書き出せなくなるので、
// 書き出しのときだけここを通して取り直す（shared/video-export.js の loadImage）。
// 悪用（何でも中継するサーバー）にならないよう、画像だけ・サイズ上限・自サイトからだけに絞る。

const MAX_BYTES = 8 * 1024 * 1024;
const TIMEOUT_MS = 10000;

const ALLOWED_ORIGINS = [
  'https://graphrace-studio.com',
  'https://www.graphrace-studio.com',
  'https://preview-chartrace.kohei-coffee-cake.workers.dev',
];

function isAllowedOrigin(origin) {
  if (!origin) return false;
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  // 開発中（npm run dev / npm run preview）
  return /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}

// ループバック・社内向けアドレスへの中継は断る
function isPrivateHost(host) {
  host = host.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal')) return true;
  if (/^\[?(::1|fc|fd|fe80)/.test(host)) return true;
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(host);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

function err(status, code, origin) {
  const h = { 'content-type': 'text/plain', 'cache-control': 'no-store' };
  if (origin) h['access-control-allow-origin'] = origin;
  return new Response(code, { status, headers: h });
}

export async function handleImageProxy(request, env, ctx) {
  if (request.method !== 'GET') return err(405, 'method_not_allowed');

  // 自サイトのページから以外は断る
  // 同じサイト内の GET は Origin が付かないブラウザもあるので、そのときは Referer で見る
  let origin = request.headers.get('origin');
  if (!origin || origin === 'null') {
    try { origin = new URL(request.headers.get('referer') || '').origin; } catch (e) { origin = ''; }
  }
  if (!isAllowedOrigin(origin)) return err(403, 'forbidden');

  let target;
  try { target = new URL(new URL(request.url).searchParams.get('url') || ''); } catch (e) { return err(400, 'bad_url', origin); }
  if (!/^https?:$/.test(target.protocol) || isPrivateHost(target.hostname)) return err(400, 'bad_url', origin);

  // 同じ画像はエッジのキャッシュから返す（キーは画像URLだけ。Origin で分けない）
  const cache = caches.default;
  const cacheKey = new Request('https://img-proxy.cache/' + encodeURIComponent(target.href));
  let res = await cache.match(cacheKey);

  if (!res) {
    let upstream;
    try {
      upstream = await fetch(target.href, {
        headers: { 'user-agent': 'Mozilla/5.0 (compatible; GraphRaceStudio-ImageFetch)', accept: 'image/*' },
        redirect: 'follow',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cf: { cacheTtl: 86400, cacheEverything: true },
      });
    } catch (e) {
      return err(502, 'fetch_failed', origin);
    }
    if (!upstream.ok) return err(502, 'upstream_' + upstream.status, origin);

    const type = (upstream.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    // SVG はスクリプトを含みうるので扱わない
    if (!type.startsWith('image/') || type.includes('svg')) return err(415, 'not_image', origin);
    const len = Number(upstream.headers.get('content-length') || 0);
    if (len > MAX_BYTES) return err(413, 'too_large', origin);

    const body = await upstream.arrayBuffer();
    if (body.byteLength > MAX_BYTES) return err(413, 'too_large', origin);

    res = new Response(body, {
      headers: {
        'content-type': type,
        'cache-control': 'public, max-age=86400',
        'x-content-type-options': 'nosniff',
      },
    });
    ctx.waitUntil(cache.put(cacheKey, res.clone()));
  }

  const out = new Response(res.body, res);
  out.headers.set('access-control-allow-origin', origin);
  out.headers.set('vary', 'Origin');
  return out;
}
