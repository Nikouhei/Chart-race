/*
 * Chart Studio 共有 i18n スケルトン（下地のみ）
 *
 * 目的: 将来の多言語化（3言語以上）を低コストで載せられる「仕組みと規約」だけを用意する。
 *       現時点では辞書を一切登録しない＝何も翻訳しないので、表示・挙動は完全に現状維持。
 *
 * 役割分担（プラットフォーム方針）:
 *   - LP/法務ページの多言語SEO（言語別URL `/ja/ /en/` + hreflang + og:locale）は
 *     将来 WordPress(WPML/Polylang) が担当する。本ファイルは触れない。
 *   - アプリ(/app/) の UI 文言はこのクライアントサイド i18n が担当する。
 *   - LP→アプリのロケール継承は URL クエリ ?lang=<locale> を受け口にする（getLocale 参照）。
 *
 * キー命名規約: <面>.<区画>.<要素>   例) app.banner.restore / tool.barChartRace.label
 * ルール: 新規のユーザー可視文言はハードコードせず、必ずキー化して辞書から引くこと。
 *
 * 将来の使い方（今回は呼ばない）:
 *   I18N.register('en', { 'app.banner.restore': 'Restore', ... });
 *   <h1 data-i18n="lp.hero.title"></h1>
 *   <input data-i18n-attr="placeholder:form.name.ph">
 */
(function () {
  var DEFAULT_LOCALE = 'ja';
  var LOCALE_KEY = 'chartToolLocale';

  // ロケール → toLocaleString 等に渡す BCP47 文字列。未知は <locale> をそのまま使い、
  // それも空なら既定の 'ja-JP' を返す（＝挙動不変の保証）。
  var BCP47 = {
    ja: 'ja-JP',
    en: 'en-US'
  };

  // 登録済み辞書。{ locale: { key: text } }。今回は空のまま。
  var dictionaries = {};

  // 解決済みロケールのキャッシュ（1ページ内で一貫させる）。
  var resolvedLocale = null;

  function readQueryLang() {
    try {
      var params = new URLSearchParams(window.location.search);
      var v = params.get('lang');
      return v ? v.trim().toLowerCase().slice(0, 2) : '';
    } catch (e) {
      return '';
    }
  }

  function readStoredLang() {
    try {
      var v = localStorage.getItem(LOCALE_KEY);
      return v ? v.trim().toLowerCase().slice(0, 2) : '';
    } catch (e) {
      return '';
    }
  }

  // ロケール解決順: ?lang= → localStorage → 既定(ja)。
  // ?lang= で指定された場合は localStorage に記憶（WordPress 製 LP からの継承の定着）。
  //
  // 【意図的に navigator.language は見ない】翻訳辞書がまだ無い現段階で navigator 検出を
  // 入れると、非日本語ブラウザで日付書式(formatLocale)が変わり「挙動不変」を破る。
  // ブラウザ言語の自動検出は、実翻訳が揃う後続フェーズで resolveLocale に追加する。
  function resolveLocale() {
    if (resolvedLocale) return resolvedLocale;

    var fromQuery = readQueryLang();
    if (fromQuery) {
      try { localStorage.setItem(LOCALE_KEY, fromQuery); } catch (e) {}
      resolvedLocale = fromQuery;
      return resolvedLocale;
    }

    resolvedLocale = readStoredLang() || DEFAULT_LOCALE;
    return resolvedLocale;
  }

  var I18N = {
    DEFAULT_LOCALE: DEFAULT_LOCALE,

    // 将来ロケール辞書を足す入口。dict は { key: text } のフラットなオブジェクト。
    register: function (locale, dict) {
      if (!locale || !dict) return;
      var existing = dictionaries[locale] || (dictionaries[locale] = {});
      Object.keys(dict).forEach(function (k) { existing[k] = dict[k]; });
    },

    // 現在のロケール（2字）。未登録ロケールでも返すが、t() は ja → キー文字列の順でフォールバックする。
    getLocale: function () {
      return resolveLocale();
    },

    // toLocaleString / Intl に渡す BCP47 文字列。マップ済みはそれを、未知の2字は
    // そのロケール文字列を（Intl が解釈可能）、空なら既定の 'ja-JP' を返す。
    formatLocale: function () {
      var loc = resolveLocale();
      return BCP47[loc] || loc || 'ja-JP';
    },

    // キー → 文言。現ロケール辞書 → 既定(ja)辞書 → キー文字列、の順で引く（壊れない）。
    t: function (key) {
      if (!key) return '';
      var loc = resolveLocale();
      var cur = dictionaries[loc];
      if (cur && Object.prototype.hasOwnProperty.call(cur, key)) return cur[key];
      var def = dictionaries[DEFAULT_LOCALE];
      if (def && Object.prototype.hasOwnProperty.call(def, key)) return def[key];
      return key;
    },

    // [data-i18n]（textContent）と [data-i18n-attr="attr:key;attr:key"]（属性）を一括差替。
    // documentElement.lang も解決ロケールに合わせる。
    // 今は data-i18n 対象要素が無いので無害。辞書登録後に意味を持つ。
    apply: function (root) {
      root = root || document;

      try {
        document.documentElement.setAttribute('lang', resolveLocale());
      } catch (e) {}

      var textNodes = root.querySelectorAll('[data-i18n]');
      Array.prototype.forEach.call(textNodes, function (el) {
        var key = el.getAttribute('data-i18n');
        if (key) el.textContent = I18N.t(key);
      });

      var attrNodes = root.querySelectorAll('[data-i18n-attr]');
      Array.prototype.forEach.call(attrNodes, function (el) {
        var spec = el.getAttribute('data-i18n-attr') || '';
        spec.split(';').forEach(function (pair) {
          var parts = pair.split(':');
          if (parts.length !== 2) return;
          var attr = parts[0].trim();
          var key = parts[1].trim();
          if (attr && key) el.setAttribute(attr, I18N.t(key));
        });
      });
    }
  };

  window.I18N = I18N;

  // 自動適用。対象要素ゼロでも documentElement.lang を整えるだけで害はない。
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { I18N.apply(document); });
  } else {
    I18N.apply(document);
  }
})();
