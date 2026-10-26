#!/usr/bin/env node
/*
 * astro build のあとに実行する仕上げ（npm run build に組み込み済み）
 *
 *   1. 下書きページ（routes.mjs の drafts）を本番ビルドから外す
 *   2. まだ Astro に移していない既存ファイルを dist にコピー（Astro が出力したものが優先）
 *   3. 既存HTMLのうち、他言語版が公開済みのページに hreflang を差し込む
 *   3b. 既存HTML（ブログ・あみだくじ）のヘッダーを、Astro の共通ヘッダー（SiteHeader）に置き換える
 *   4. sitemap.xml を作る（言語の対応関係 xhtml:link 入り）
 *   5. 株価レースが出力に紛れ込んでいないか確認（あればビルド失敗）
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT, listLegacyFiles } from './legacy-files.mjs';
import { SITE_URL } from '../src/i18n/config.mjs';
import { PAGES } from '../src/i18n/routes.mjs';
import { includeDrafts, hreflangLinks, pageIdForPath } from '../src/i18n/utils.mjs';

const DIST = path.join(ROOT, 'dist');
const log = (...a) => console.log('[postbuild]', ...a);

if (!fs.existsSync(DIST)) {
  console.error('[postbuild] dist/ がありません。先に astro build を実行してください。');
  process.exit(1);
}

// URL パス → dist 内のファイル
function distFileFor(urlPath) {
  const rel = urlPath.replace(/^\//, '');
  return path.join(DIST, rel === '' || rel.endsWith('/') ? rel + 'index.html' : rel);
}

// 1. 下書きを外す ------------------------------------------------------------
const withDrafts = includeDrafts();
if (!withDrafts) {
  for (const page of PAGES) {
    for (const loc of page.drafts || []) {
      const p = page.paths[loc];
      if (!p) continue;
      const f = distFileFor(p);
      if (fs.existsSync(f)) {
        fs.rmSync(f);
        log(`下書きを除外: ${p}`);
      }
    }
  }
  // 空になったディレクトリを掃除
  const prune = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) prune(path.join(dir, e.name));
    }
    if (dir !== DIST && fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
  };
  prune(DIST);
} else {
  log('下書きも出力します（preview / INCLUDE_DRAFTS=1）');
}

// 2. 既存ファイルをコピー ----------------------------------------------------
const legacy = listLegacyFiles();
const overridden = [];
let copied = 0;
for (const rel of legacy) {
  const dest = path.join(DIST, rel);
  if (fs.existsSync(dest)) {
    if (rel.endsWith('.html')) overridden.push(rel);
    continue;
  }
  // 下書きとして外したページの同名ファイルが直下にあっても戻さない
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(path.join(ROOT, rel), dest);
  copied++;
}
log(`既存ファイルをコピー: ${copied} 件`);
if (overridden.length) {
  log('Astro 版を優先（直下の古いファイルは使われていません。移行済みなら削除してOK）:');
  for (const r of overridden) log('  - ' + r);
}

// 3. 既存HTMLへの hreflang 差し込み -----------------------------------------
const legacyHtml = new Set(legacy.filter((r) => r.endsWith('.html') && !overridden.includes(r)));
for (const rel of legacyHtml) {
  const urlPath = '/' + rel.replace(/index\.html$/, '');
  const hit = pageIdForPath(urlPath);
  if (!hit) continue;
  const links = hreflangLinks(hit.id);
  if (!links.length) continue;
  const file = path.join(DIST, rel);
  let html = fs.readFileSync(file, 'utf-8');
  if (/rel=["']alternate["'][^>]*hreflang=/i.test(html)) continue;
  const tags = links.map((l) => `<link rel="alternate" hreflang="${l.hreflang}" href="${l.href}">`).join('\n  ');
  if (/<link rel="canonical"[^>]*>/i.test(html)) {
    html = html.replace(/(<link rel="canonical"[^>]*>)/i, `$1\n  ${tags}`);
  } else {
    html = html.replace(/<\/head>/i, `  ${tags}\n</head>`);
  }
  fs.writeFileSync(file, html);
  log(`hreflang を追加: ${rel}`);
}

// 3b. 既存HTMLのヘッダーを共通ヘッダーに置き換え ---------------------------------
//   トップ（dist/index.html）に出力された SiteHeader と、そのCSS（gnav.css・言語切替）をそのまま使う。
//   ツールが増えてもここは触らなくてよい（routes.mjs の NAV_TOOLS を足せば全ページに反映される）。
{
  const home = fs.readFileSync(path.join(DIST, 'index.html'), 'utf-8');
  const headerHtml = (home.match(/<header class="site-header gnav"[\s\S]*?<\/header>/) || [])[0];
  const gnavCss = fs.readFileSync(path.join(ROOT, 'src/styles/gnav.css'), 'utf-8');
  const langCss = [...home.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).find((c) => c.includes('.lang-switch[data-astro-cid')) || '';
  if (!headerHtml) {
    console.error('[postbuild] dist/index.html に共通ヘッダーが見つかりません（SiteHeader.astro を確認）');
    process.exit(1);
  }
  // 現在地の印を外したひな形
  const base = headerHtml
    .replace(/ is-active/g, '')
    .replace(/ aria-current="page"/g, '');
  let replaced = 0;
  for (const rel of legacyHtml) {
    if (/(^|\/)app(-[a-z]+)?\//.test(rel)) continue; // ツール画面は対象外
    const file = path.join(DIST, rel);
    let html = fs.readFileSync(file, 'utf-8');
    if (!/<header class="site-header">/.test(html)) continue;
    const urlPath = '/' + rel.replace(/index\.html$/, '');
    let h = base;
    // 現在地: ブログ配下ならブログ、ツールのページならそのツール
    const mark = (href) => {
      h = h.replace(new RegExp(`class="gnav-item" href="${href}"`), `class="gnav-item is-active" href="${href}" aria-current="page"`);
      return h !== base;
    };
    if (urlPath.startsWith('/blog/')) {
      h = h.replace('class="gnav-link" href="/blog/"', 'class="gnav-link is-active" href="/blog/"');
    } else if (mark(urlPath)) {
      h = h.replace('class="gnav-link gnav-trigger"', 'class="gnav-link gnav-trigger is-active"');
    }
    html = html.replace(/<header class="site-header">[\s\S]*?<\/header>/, () => h);
    html = html.replace(/<\/head>/i, () => `<style>${gnavCss}${langCss}</style>\n</head>`);
    fs.writeFileSync(file, html);
    replaced++;
  }
  log(`既存HTMLのヘッダーを共通ヘッダーに置き換え: ${replaced} 件`);
}

// 4. sitemap.xml ------------------------------------------------------------
function walkHtml(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) walkHtml(abs, out);
    else if (e.name.endsWith('.html')) out.push(path.relative(DIST, abs).split(path.sep).join('/'));
  }
  return out;
}

// 履歴の浅いクローン（CI でよくある）だと全ファイルが同じ日付になるので、その場合は lastmod を出さない
const GIT_OK = (() => {
  try {
    const shallow = execFileSync('git', ['rev-parse', '--is-shallow-repository'], { cwd: ROOT, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return shallow === 'false';
  } catch {
    return false;
  }
})();

function gitDate(relSrc) {
  if (!GIT_OK) return null;
  try {
    const out = execFileSync('git', ['log', '-1', '--format=%cs', '--', relSrc], { cwd: ROOT, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return out || null;
  } catch {
    return null;
  }
}

// dist の HTML → 元ファイル（lastmod 用）
function sourceFor(rel) {
  const astro = path.join('src/pages', rel.replace(/\.html$/, '.astro'));
  if (fs.existsSync(path.join(ROOT, astro))) return astro;
  return rel;
}

function priorityFor(urlPath) {
  if (urlPath === '/' || /^\/[a-z]{2}\/$/.test(urlPath)) return '1.0';
  if (/\/(privacy|terms)\.html$/.test(urlPath)) return '0.3';
  if (/\/about\.html$/.test(urlPath)) return '0.5';
  if (urlPath.endsWith('/')) return '0.8';
  return '0.6';
}

const draftPaths = new Set();
for (const page of PAGES) for (const loc of page.drafts || []) if (page.paths[loc]) draftPaths.add(page.paths[loc]);

const entries = [];
for (const rel of walkHtml(DIST)) {
  if (/(^|\/)app(-[a-z]+)?\//.test(rel)) continue; // ツール画面は noindex
  if (/^404\.html$/.test(rel)) continue;
  const html = fs.readFileSync(path.join(DIST, rel), 'utf-8');
  if (/<meta[^>]+name=["']robots["'][^>]+noindex/i.test(html)) continue;
  const urlPath = '/' + rel.replace(/index\.html$/, '');
  if (draftPaths.has(urlPath)) continue;
  const hit = pageIdForPath(urlPath);
  const alternates = hit ? hreflangLinks(hit.id) : [];
  entries.push({ urlPath, loc: SITE_URL + urlPath, lastmod: gitDate(sourceFor(rel)), priority: priorityFor(urlPath), alternates });
}
entries.sort((a, b) => parseFloat(b.priority) - parseFloat(a.priority) || a.urlPath.localeCompare(b.urlPath));

let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n';
for (const e of entries) {
  xml += '  <url>\n';
  xml += `    <loc>${e.loc}</loc>\n`;
  for (const a of e.alternates) xml += `    <xhtml:link rel="alternate" hreflang="${a.hreflang}" href="${a.href}"/>\n`;
  if (e.lastmod) xml += `    <lastmod>${e.lastmod}</lastmod>\n`;
  xml += '    <changefreq>monthly</changefreq>\n';
  xml += `    <priority>${e.priority}</priority>\n`;
  xml += '  </url>\n';
}
xml += '</urlset>\n';
fs.writeFileSync(path.join(DIST, 'sitemap.xml'), xml);
log(`sitemap.xml: ${entries.length} URL`);

// 5. 公開してはいけないものの最終確認 -------------------------------------------
const forbidden = ['stock-race', 'src', 'node_modules', 'analytics', 'build', 'First Coding', '.git', '.github', '.agents', '.claude', '.wrangler'];
const leaked = forbidden.filter((d) => fs.existsSync(path.join(DIST, d)));
// dist 全体を見て、ドット始まりのファイル・フォルダや秘密情報らしいファイル名が無いか確認する
// （.gitkeep は public/ の空フォルダ用、.well-known は将来の正規の公開用なので許可）
const DOT_OK = new Set(['.gitkeep', '.well-known']);
const SECRET_RE = /(^\.env|^\.dev\.vars$|service-account.*\.json$|\.local\.json$|\.(pem|key|p12|pfx)$|credentials?.*\.json$)/i;
(function scan(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = path.relative(DIST, path.join(dir, entry.name)).split(path.sep).join('/');
    if ((entry.name.startsWith('.') && !DOT_OK.has(entry.name)) || SECRET_RE.test(entry.name)) leaked.push(rel);
    else if (entry.isDirectory()) scan(path.join(dir, entry.name));
  }
})(DIST);
if (leaked.length) {
  console.error('[postbuild] 公開してはいけないものが dist に入っています: ' + leaked.join(', '));
  process.exit(1);
}
log('完了');
