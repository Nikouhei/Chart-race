/*
 * 多言語化のヘルパー（Astro ページとビルドスクリプトの両方から使う。Node だけで動くように書く）
 */
import { SITE_URL, DEFAULT_LOCALE, X_DEFAULT_LOCALE, LOCALES } from './config.mjs';
import { UI } from './ui.mjs';
import { PAGES } from './routes.mjs';

// 下書きを出力に含めるか。
//  ・INCLUDE_DRAFTS=1 を付けてビルドしたとき
//  ・Cloudflare の main 以外のブランチ（preview）でビルドしたとき
//  ・astro dev のとき
export function includeDrafts(env = process.env) {
  if (env.INCLUDE_DRAFTS === '1') return true;
  if (env.INCLUDE_DRAFTS === '0') return false;
  const branch = env.WORKERS_CI_BRANCH || env.CF_PAGES_BRANCH || '';
  if (branch && branch !== 'main') return true;
  return env.NODE_ENV === 'development';
}

export function getPage(id) {
  return PAGES.find((p) => p.id === id) || null;
}

export function isDraft(page, locale) {
  return !!(page && page.drafts && page.drafts.includes(locale));
}

// その言語のページが公開済み（下書きを含めるなら下書きも）なら URL パスを返す
export function pathFor(id, locale, { drafts = false } = {}) {
  const page = getPage(id);
  if (!page || !page.paths[locale]) return null;
  if (isDraft(page, locale) && !drafts) return null;
  return page.paths[locale];
}

export function homePath(locale) {
  const p = LOCALES[locale] && LOCALES[locale].path;
  return p ? `/${p}/` : '/';
}

// 公開済みの言語版だけを並べる（hreflang・sitemap 用。下書きは絶対に含めない）
export function publishedAlternates(id) {
  const page = getPage(id);
  if (!page) return [];
  return Object.keys(LOCALES)
    .filter((loc) => page.paths[loc] && !isDraft(page, loc))
    .map((loc) => ({ locale: loc, hreflang: LOCALES[loc].hreflang, path: page.paths[loc], url: SITE_URL + page.paths[loc] }));
}

// hreflang の <link> に出す一覧。2言語以上そろったときだけ出す（1言語だけなら不要）。
export function hreflangLinks(id) {
  const alts = publishedAlternates(id);
  if (alts.length < 2) return [];
  const links = alts.map((a) => ({ hreflang: a.hreflang, href: a.url }));
  const xd = alts.find((a) => a.locale === X_DEFAULT_LOCALE) || alts.find((a) => a.locale === DEFAULT_LOCALE);
  if (xd) links.push({ hreflang: 'x-default', href: xd.url });
  return links;
}

// URL パス → ページ id（sitemap・既存HTMLへの hreflang 差し込み用）
export function pageIdForPath(urlPath) {
  const norm = (s) => s.replace(/index\.html$/, '');
  const target = norm(urlPath);
  for (const page of PAGES) {
    for (const loc of Object.keys(page.paths)) {
      if (norm(page.paths[loc]) === target) return { id: page.id, locale: loc };
    }
  }
  return null;
}

export function t(locale, key) {
  const cur = UI[locale];
  if (cur && Object.prototype.hasOwnProperty.call(cur, key)) return cur[key];
  const def = UI[DEFAULT_LOCALE];
  if (def && Object.prototype.hasOwnProperty.call(def, key)) return def[key];
  return key;
}

export function useTranslations(locale) {
  return (key) => t(locale, key);
}
