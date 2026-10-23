/*
 * 多言語化の基本設定（Astro の設定・ビルドスクリプト・ページから共通で読む）
 *
 * 言語を増やすとき:
 *   1. LOCALES に1行足す（path は URL の先頭に付く文字。日本語だけは空＝ルート）
 *   2. src/i18n/ui.mjs に同じ言語コードの辞書を足す
 *   3. src/i18n/routes.mjs で、その言語のページを持つものに paths を足す
 */

export const SITE_URL = 'https://graphrace-studio.com';

// 既定の言語（URL に接頭辞を付けない言語）
export const DEFAULT_LOCALE = 'ja';

// x-default（どの言語にも当てはまらない人に見せるページ）に使う言語
export const X_DEFAULT_LOCALE = 'en';

export const LOCALES = {
  ja: { label: '日本語', short: 'JA', htmlLang: 'ja', hreflang: 'ja', ogLocale: 'ja_JP', bcp47: 'ja-JP', path: '' },
  en: { label: 'English', short: 'EN', htmlLang: 'en', hreflang: 'en', ogLocale: 'en_US', bcp47: 'en-US', path: 'en' },
};

export const LOCALE_CODES = Object.keys(LOCALES);
