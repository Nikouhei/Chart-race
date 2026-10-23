/*
 * ビルド時に使う翻訳（shared/i18n.js の「文言辞書」と同じ動き）
 * 英語版ページの HTML をあらかじめ訳しておくのに使う。検索エンジンが最初に受け取る HTML から英語にするため。
 * 辞書ファイル（shared/i18n/<言語>/*.js）をそのまま読み込む。
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { ROOT } from './legacy-files.mjs';

const JP = /[぀-ヿ㐀-鿿！-～]/;
const norm = (s) => String(s).replace(/\s+/g, ' ').trim();

export function createTranslator(locale, bundles) {
  const texts = {};
  const patterns = [];
  const translate = (str) => {
    if (str == null) return str;
    const raw = String(str);
    if (!JP.test(raw)) return raw;
    const key = norm(raw);
    let hit = Object.prototype.hasOwnProperty.call(texts, key) ? texts[key] : null;
    if (hit === null) {
      for (const [re, rep, opt] of patterns) {
        if (!re.test(key)) continue;
        hit = typeof rep === 'function'
          ? key.replace(re, rep)
          : key.replace(re, (...args) => rep.replace(/\$(\d)/g, (m, n) => {
              const v = args[+n];
              return v == null ? '' : (opt && opt.raw ? v : translate(v));
            }));
        break;
      }
    }
    if (hit === null) return raw;
    const lead = raw.match(/^\s*/)[0];
    const trail = raw.match(/\s*$/)[0];
    return lead + hit + trail;
  };
  const I18N = {
    register() {},
    skip() {},
    registerText(loc, dict) { if (loc === locale) for (const k of Object.keys(dict)) texts[norm(k)] = dict[k]; },
    registerPatterns(loc, list) { if (loc === locale) for (const p of list) if (p && Object.prototype.toString.call(p[0]) === '[object RegExp]') patterns.push(p); }, // vm の中の正規表現は instanceof で判定できない
    translate: (s) => translate(s),
    isDefault: () => false,
    getLocale: () => locale,
  };
  const context = vm.createContext({ I18N, window: {}, document: { documentElement: { style: { setProperty() {} } } }, RegExp });
  for (const name of bundles) {
    const file = path.join(ROOT, 'shared', 'i18n', locale, name + '.js');
    vm.runInContext(fs.readFileSync(file, 'utf-8'), context, { filename: file });
  }
  return translate;
}

const ATTRS = ['placeholder', 'title', 'aria-label', 'alt'];

// HTML の文字と属性を訳す（<script>・<style> の中身とコメントは対象外）
export function translateHtml(html, translate) {
  const parts = html.split(/(<!--[\s\S]*?-->|<script\b[\s\S]*?<\/script>|<style\b[\s\S]*?<\/style>|<[^>]+>)/i);
  const missing = new Set();
  const out = parts.map((part) => {
    if (!part) return part;
    if (part.startsWith('<!--') || /^<(script|style)\b/i.test(part)) return part;
    if (part.startsWith('<')) {
      const hasValueFlag = /\sdata-i18n-value\b/.test(part);
      return part.replace(/(\s)([\w-]+)="([^"]*)"/g, (m, sp, name, val) => {
        if (!JP.test(val)) return m;
        if (ATTRS.includes(name) || (name === 'value' && hasValueFlag)) {
          const t = translate(val);
          if (t === val) missing.add('@' + name + ': ' + norm(val));
          return `${sp}${name}="${t.replace(/"/g, '&quot;')}"`;
        }
        return m;
      });
    }
    if (!JP.test(part)) return part;
    const t = translate(part);
    if (t === part) missing.add(norm(part));
    return t.replace(/&(?![a-z#0-9]+;)/gi, '&amp;').replace(/</g, '&lt;');
  });
  return { html: out.join(''), missing: [...missing] };
}
