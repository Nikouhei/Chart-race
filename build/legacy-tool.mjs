/*
 * 1ページに LP とツールが同居している既存ページ（格付けダービー）から、
 * ツール部分を取り出して他言語版のページに埋め込むための部品。
 *
 * ツールの HTML・CSS・JS は日本語版（src/pages/horse-race-ranking-maker/index.astro）が正。
 * 英語版はビルドのたびにそこから作るので、ツールを直すときは日本語版だけ直せばよい。
 *   ・ツールの見た目（<style>）
 *   ・ツール本体（<section id="tool"> … </section>）… 文言はビルド時に英語へ置き換える
 *   ・ツールのスクリプト … 実行時に shared/i18n.js が文言を置き換える
 * 相対パス（assets/・vendor/・real3d.js・../shared/）は日本語版の場所を指す絶対パスに直す。
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './legacy-files.mjs';
import { createTranslator, translateHtml } from './i18n-node.mjs';

function between(src, startRe, endStr, from = 0) {
  const m = startRe.exec(src.slice(from));
  if (!m) return null;
  const start = from + m.index;
  const end = src.indexOf(endStr, start);
  if (end < 0) return null;
  return { start, end: end + endStr.length, text: src.slice(start, end + endStr.length) };
}

// スクリプトの中の相対パス
function rewriteJsPaths(code, base) {
  return code
    .replace(/(["'`])\.\.\/shared\//g, '$1/shared/')
    .replace(/(["'`])(vendor\/|assets\/|real3d\.js)/g, `$1${base}$2`)
    .replace(/assetsBase\s*:\s*"assets"/g, `assetsBase:"${base}assets"`);
}

// HTML の属性の相対パス（${...} で組み立てているものは触らない）
function rewriteHtmlPaths(html, base) {
  return html
    .replace(/(src|href|srcset|poster)="\.\.\/shared\//g, '$1="/shared/')
    .replace(/(src|href|srcset|poster)="(?!https?:|\/|#|data:|mailto:|blob:|\$\{)([^"]+)"/g, `$1="${base}$2"`);
}

export function horseRaceParts(locale) {
  const dir = 'horse-race-ranking-maker';
  const base = `/${dir}/`;
  // 日本語版は Astro のページ（src/pages/horse-race-ranking-maker/index.astro）。ツール部分の HTML・CSS・JS はそのまま書かれている
  const srcFile = path.join('src', 'pages', dir, 'index.astro');
  const src = fs.readFileSync(path.join(ROOT, srcFile), 'utf-8');

  const style = between(src, /<style is:inline>/, '</style>');
  const section = between(src, /<section class="umarace" id="tool"/, '</section>');
  const scriptTag = '<script is:inline>';
  const scriptStart = src.indexOf(scriptTag, section ? section.end : 0);
  const scriptEnd = src.indexOf('</script>', scriptStart);
  if (!style || !section || scriptStart < 0 || scriptEnd < 0) {
    throw new Error(`${srcFile} からツール部分を取り出せませんでした（構造が変わった？）`);
  }
  let script = src.slice(scriptStart + scriptTag.length, scriptEnd);
  script = rewriteJsPaths(script, base);
  // 相対パスが残っていたら、英語版では読み込めないのでビルドを止める
  const leftover = script.match(/["'`](\.\/)?(assets|vendor)\/[^"'`]*/);
  if (leftover) throw new Error(`${dir} のスクリプトに相対パスが残っています: ${leftover[0]}`);

  const translate = createTranslator(locale, ['common', 'horse-race']);
  const tool = translateHtml(rewriteHtmlPaths(section.text, base), translate);
  if (tool.missing.length) {
    console.warn(`[i18n] ${dir} のツール部分に訳がない文言 ${tool.missing.length} 件:`, tool.missing);
  }

  // <style> の中の url(相対パス) も直す
  const css = style.text
    .replace(/^<style[^>]*>/, '').replace(/<\/style>$/, '')
    .replace(/url\((["']?)(?!https?:|\/|data:)([^"')]+)\1\)/g, `url($1${base}$2$1)`);

  return { css, toolHtml: tool.html, script };
}

// 日本語版ページの最初の <style> を取り出す（英語版で同じ見た目を使うため）。url(相対) はそのページの場所を基準に直す
export function legacyCss(relFile) {
  // 日本語版LPを Astro に移したあとは src/pages/<ツール>/index.astro を読む
  const astro = path.join('src', 'pages', relFile.replace(/\.html$/, '.astro'));
  const file = fs.existsSync(path.join(ROOT, relFile)) ? relFile : astro;
  const src = fs.readFileSync(path.join(ROOT, file), 'utf-8');
  const style = between(src, /<style(?: is:inline)?>/, '</style>');
  if (!style) throw new Error(`${relFile} に <style> がありません`);
  const base = '/' + path.posix.dirname(relFile).replace(/^\.$/, '') + '/';
  return style.text
    .replace(/^<style[^>]*>/, '').replace(/<\/style>$/, '')
    .replace(/url\((["']?)(?!https?:|\/|data:)([^"')]+)\1\)/g, (m, q, p) => `url(${q}${path.posix.normalize(base + p)}${q})`);
}
