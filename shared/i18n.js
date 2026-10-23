/*
 * GraphRace Studio — ツール画面（/xxx/app/）用の多言語化
 *
 * 役割分担:
 *   - LP・ブログ・トップ・法務などSEOページの多言語化は Astro（src/i18n/）が担当する。
 *     日本語はルート、英語は /en/ … の言語別URL＋hreflang。
 *   - ツール画面は noindex なので URL は1つのまま。?lang=en のように言語を受け取り、
 *     このファイルと辞書（shared/i18n/<言語>/<名前>.js）で表示だけを切り替える。
 *
 * 言語の決め方: URL の ?lang= → URL の先頭（/en/ など）→ 日本語。
 *   ・ブラウザの言語設定で自動的に切り替えることはしない（サイト方針）
 *   ・localStorage にも覚えない（以前英語を見た人が日本語LPから来ても英語になる、を防ぐ）
 *   ・英語LPからツールへのリンクには必ず ?lang=en を付ける。ツール間の移動では引き継ぐ（registry.js）
 *
 * 辞書の読み込み: <script src="../../shared/i18n.js" data-i18n-bundles="common,bar-chart-race"></script>
 *   日本語以外のときだけ shared/i18n/<言語>/common.js などを同期で読み込む（日本語の人は追加の通信なし）。
 *   辞書ファイルの中身: I18N.register('en', { 'app.export.title': 'Export video', ... });
 *
 * 翻訳のしかた（2通り。ふだんは①でよい）:
 *   ① 日本語の文言そのものを鍵にする「文言辞書」— 既存のHTMLやJSに手を入れずに訳せる
 *      I18N.registerText('en', { '設定': 'Settings', '保存': 'Save' });
 *      I18N.registerPatterns('en', [[/^(\d+)行 \/ (\d+)期間$/, '$1 rows / $2 periods']]);
 *      ページ内の文字・placeholder・title・aria-label・alt と、あとからJSで差し込まれた文字、
 *      alert / confirm / prompt の文言を自動で置き換える。日本語の文言を変えたら辞書の鍵も直すこと
 *      （直し忘れても日本語のまま出るだけで壊れない。localhost では訳のない日本語を console に出す）。
 *      ユーザーのデータ（グラフ・表の中身）は I18N.skip('#chartArea, ...') で訳さない場所に指定する。
 *   ② キーで引く — 文の組み立てが言語で大きく違うときなど
 *   <h2 data-i18n="app.export.title">動画を書き出す</h2>      ← 日本語は HTML にそのまま書いておく
 *   <input data-i18n-attr="placeholder:app.data.searchPh">
 *   JS からは I18N.t('app.export.done', { name: file })  ※ {name} を差し込める
 *   キーの命名: <面>.<区画>.<要素>  例) app.banner.restore / tool.barChartRace.label
 *   日本語版の文言は辞書に入れなくてよい（キーが無いときは HTML の元の文言を残す）。
 */
(function () {
  var DEFAULT_LOCALE = 'ja';
  // 対応している言語。Astro 側の src/i18n/config.mjs と揃える
  var SUPPORTED = ['ja', 'en'];
  // 言語 → URL の先頭（日本語はルート）
  var PATH_PREFIX = { ja: '', en: '/en' };
  // 言語 → toLocaleString 等に渡す文字列
  var BCP47 = { ja: 'ja-JP', en: 'en-US' };

  var dictionaries = {};
  var resolvedLocale = null;

  function readQueryLang() {
    try {
      var v = new URLSearchParams(window.location.search).get('lang');
      return v ? v.trim().toLowerCase().slice(0, 2) : '';
    } catch (e) {
      return '';
    }
  }

  // 言語別URL（/en/... ）に置いたページ（例: 英語版の格付けダービー）は URL の先頭で決める
  function readPathLang() {
    try {
      var m = window.location.pathname.match(/^\/([a-z]{2})\//);
      return m ? m[1] : '';
    } catch (e) {
      return '';
    }
  }

  function resolveLocale() {
    if (resolvedLocale) return resolvedLocale;
    var q = readQueryLang();
    if (SUPPORTED.indexOf(q) < 0) q = readPathLang();
    resolvedLocale = SUPPORTED.indexOf(q) >= 0 ? q : DEFAULT_LOCALE;
    return resolvedLocale;
  }

  function interpolate(text, params) {
    if (!params) return text;
    return String(text).replace(/\{(\w+)\}/g, function (m, name) {
      return Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : m;
    });
  }

  function lookup(key) {
    var cur = dictionaries[resolveLocale()];
    if (cur && Object.prototype.hasOwnProperty.call(cur, key)) return cur[key];
    var def = dictionaries[DEFAULT_LOCALE];
    if (def && Object.prototype.hasOwnProperty.call(def, key)) return def[key];
    return null;
  }

  var I18N = {
    DEFAULT_LOCALE: DEFAULT_LOCALE,
    SUPPORTED: SUPPORTED.slice(),

    register: function (locale, dict) {
      if (!locale || !dict) return;
      var existing = dictionaries[locale] || (dictionaries[locale] = {});
      Object.keys(dict).forEach(function (k) { existing[k] = dict[k]; });
    },

    getLocale: function () { return resolveLocale(); },

    isDefault: function () { return resolveLocale() === DEFAULT_LOCALE; },

    formatLocale: function () { return BCP47[resolveLocale()] || 'ja-JP'; },

    // キー → 文言。辞書に無ければ fallback（省略時はキー文字列）を返す。
    t: function (key, params, fallback) {
      if (!key) return '';
      var v = lookup(key);
      if (v === null) v = (fallback !== undefined) ? fallback : key;
      return interpolate(v, params);
    },

    has: function (key) { return lookup(key) !== null; },

    // ツール画面への URL に今の言語を付ける（日本語なら何もしない）。ツール間の移動に使う。
    withLang: function (url) {
      var loc = resolveLocale();
      if (loc === DEFAULT_LOCALE || !url) return url;
      try {
        var u = new URL(url, window.location.href);
        u.searchParams.set('lang', loc);
        // 相対で渡されたら相対のまま返す
        return /^[a-z]+:\/\//i.test(url) ? u.href : u.pathname + u.search + u.hash;
      } catch (e) {
        return url + (url.indexOf('?') >= 0 ? '&' : '?') + 'lang=' + loc;
      }
    },

    // サイト内のページ（LP など）のパスを今の言語版に直す。例) '/bar-chart-race/' → '/en/bar-chart-race/'
    // その言語版がまだ無いページに使わないこと（リンク切れになる）。
    sitePath: function (path) {
      var prefix = PATH_PREFIX[resolveLocale()] || '';
      if (!path || path.charAt(0) !== '/') return path;
      return prefix + path;
    },

    // [data-i18n]（中身の文字）と [data-i18n-attr="attr:key;attr:key"]（属性）を差し替える。
    // 日本語表示のときは何もしない（HTML に書かれた日本語をそのまま使う）。
    apply: function (root) {
      root = root || document;
      try { document.documentElement.setAttribute('lang', resolveLocale()); } catch (e) {}
      if (resolveLocale() === DEFAULT_LOCALE) return;

      Array.prototype.forEach.call(root.querySelectorAll('[data-i18n]'), function (el) {
        var key = el.getAttribute('data-i18n');
        var v = key ? lookup(key) : null;
        if (v !== null) el.textContent = v;
      });

      Array.prototype.forEach.call(root.querySelectorAll('[data-i18n-html]'), function (el) {
        // 辞書側で用意した、信頼できるHTMLだけを入れる（ユーザー入力は絶対に入れない）
        var key = el.getAttribute('data-i18n-html');
        var v = key ? lookup(key) : null;
        if (v !== null) el.innerHTML = v;
      });

      Array.prototype.forEach.call(root.querySelectorAll('[data-i18n-attr]'), function (el) {
        (el.getAttribute('data-i18n-attr') || '').split(';').forEach(function (pair) {
          var parts = pair.split(':');
          if (parts.length !== 2) return;
          var attr = parts[0].trim();
          var v = lookup(parts[1].trim());
          if (attr && v !== null) el.setAttribute(attr, v);
        });
      });
    }
  };

  // ── 文言辞書（日本語の文言 → 訳）────────────────────────────
  var texts = {};      // { locale: { '日本語': '訳' } }
  var patterns = {};   // { locale: [[RegExp, '置換後'], ...] }
  var skipSelectors = ['[data-i18n-skip]', 'script', 'style', 'noscript', 'code', 'pre', '.lang-switch'];
  var ATTRS = ['placeholder', 'title', 'aria-label', 'alt', 'data-column-tooltip'];
  var JP = /[\u3040-\u30ff\u3400-\u9fff\uff01-\uff5e]/;

  function norm(s) { return String(s).replace(/\s+/g, ' ').trim(); }

  function translateString(str) {
    if (str == null) return str;
    var loc = resolveLocale();
    if (loc === DEFAULT_LOCALE) return str;
    var raw = String(str);
    if (!JP.test(raw)) return raw;
    var key = norm(raw);
    var dict = texts[loc];
    var hit = dict && Object.prototype.hasOwnProperty.call(dict, key) ? dict[key] : null;
    if (hit === null) {
      var list = patterns[loc] || [];
      for (var i = 0; i < list.length; i++) {
        if (list[i][0].test(key)) {
          // 3つめに { raw: true } を付けると、差し込む部分（馬名などユーザーの入力）を訳さない
          var raw2 = list[i][2] && list[i][2].raw;
          hit = key.replace(list[i][0], typeof list[i][1] === 'function' ? list[i][1] : function () {
            var args = arguments, rep = list[i][1];
            return rep.replace(/\$(\d)/g, function (m, n) { var v = args[+n]; return v == null ? '' : (raw2 ? v : translateString(v)); });
          });
          break;
        }
      }
    }
    if (hit === null) return raw;
    // 前後の空白は元のまま残す（レイアウトが変わらないように）
    var lead = raw.match(/^\s*/)[0], trail = raw.match(/\s*$/)[0];
    return lead + hit + trail;
  }

  function isSkipped(el) {
    if (!el || el.nodeType !== 1) return false;
    try { return !!el.closest(skipSelectors.join(',')); } catch (e) { return false; }
  }

  function translateElementAttrs(el) {
    for (var i = 0; i < ATTRS.length; i++) {
      var v = el.getAttribute(ATTRS[i]);
      if (v && JP.test(v)) {
        var t = translateString(v);
        if (t !== v) el.setAttribute(ATTRS[i], t);
      }
    }
    // 入力欄の初期値のうち、ツールが用意した文言（data-i18n-value 付き）も訳す。例) 円グラフの「その他」「合計」
    if (el.hasAttribute('data-i18n-value') && !el.__grsValueDone) {
      el.__grsValueDone = true;
      var dv = el.getAttribute('value');
      if (dv && el.value === dv && JP.test(dv)) {
        var tdv = translateString(dv);
        if (tdv !== dv) { el.setAttribute('value', tdv); el.value = tdv; }
      }
    }
    if (el.tagName === 'INPUT' && /^(button|submit|reset)$/i.test(el.type) && JP.test(el.value)) {
      var tv = translateString(el.value);
      if (tv !== el.value) el.value = tv;
    }
  }

  function translateTree(root) {
    if (!root || resolveLocale() === DEFAULT_LOCALE) return;
    if (root.nodeType === 3) {
      if (root.parentElement && (isSkipped(root.parentElement) || root.parentElement.nodeName === 'TEXTAREA')) return;
      var tv = translateString(root.nodeValue);
      if (tv !== root.nodeValue) root.nodeValue = tv;
      return;
    }
    if (root.nodeType !== 1 && root.nodeType !== 9) return;
    if (root.nodeType === 1 && isSkipped(root)) return;
    if (root.nodeType === 1) translateElementAttrs(root);
    var walker = document.createTreeWalker(root, 5 /* ELEMENT | TEXT */, {
      acceptNode: function (n) {
        if (n.nodeType === 1) return isSkipped(n) ? 2 /* REJECT（子も見ない） */ : 1;
        // textarea の中身は入力値なので訳さない（placeholder などの属性は訳す）
        if (n.parentNode && n.parentNode.nodeName === 'TEXTAREA') return 3;
        return JP.test(n.nodeValue) ? 1 : 3;
      }
    });
    var n;
    while ((n = walker.nextNode())) {
      if (n.nodeType === 1) { translateElementAttrs(n); continue; }
      var t = translateString(n.nodeValue);
      if (t !== n.nodeValue) n.nodeValue = t;
    }
  }

  // 訳がまだ無い日本語を探す（開発用。localhost では読み込み後に console に出す）
  function findMissing(root) {
    var out = [];
    var walker = document.createTreeWalker(root || document.body, 5, {
      acceptNode: function (n) {
        if (n.nodeType === 1) return isSkipped(n) ? 2 : 1;
        if (n.parentNode && n.parentNode.nodeName === 'TEXTAREA') return 3;
        return JP.test(n.nodeValue) ? 1 : 3;
      }
    });
    var n;
    while ((n = walker.nextNode())) {
      if (n.nodeType === 1) {
        for (var i = 0; i < ATTRS.length; i++) {
          var v = n.getAttribute(ATTRS[i]);
          if (v && JP.test(v) && translateString(v) === v) out.push('@' + ATTRS[i] + ': ' + norm(v));
        }
        continue;
      }
      var s = norm(n.nodeValue);
      if (s && translateString(s) === s) out.push(s);
    }
    return out.filter(function (v, i, a) { return a.indexOf(v) === i; });
  }

  // ── ファイル選択欄 ───────────────────────────────────────
  // <input type="file"> の「ファイルを選択」「選択されていません」はブラウザの言語で出るため、
  // 日本語以外の表示では自前のボタンに置き換える（本物の input は隠して、押したら開く）。
  var fileStyleAdded = false;
  function addFileStyle() {
    if (fileStyleAdded) return;
    fileStyleAdded = true;
    var st = document.createElement('style');
    st.textContent =
      '.grs-file-wrap{display:inline-flex;align-items:center;gap:9px;min-width:0;max-width:100%;}' +
      '.grs-file-wrap input[type=file]{position:absolute!important;width:1px!important;height:1px!important;opacity:0!important;pointer-events:none!important;overflow:hidden;}' +
      'button.grs-file-btn{width:auto;flex:0 0 auto;margin:0;padding:8px 12px;border:1px solid var(--btn-border,#d0d4dc);border-radius:7px;' +
      'background:var(--btn-bg,#f3f4f6);color:var(--text-strong,#111);font-weight:500;font-size:12px;line-height:1.2;cursor:pointer;white-space:nowrap;}' +
      'button.grs-file-btn:hover{background:var(--btn-bg-hover,#e9ebef);}' +
      '.grs-file-name{font-size:12px;color:var(--text-muted,#888);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;}';
    (document.head || document.documentElement).appendChild(st);
  }

  function replaceFileInput(input) {
    if (input.__grsFile || input.hidden || input.type !== 'file' || isSkipped(input)) return;
    input.__grsFile = true;
    addFileStyle();
    var wrap = document.createElement('span');
    wrap.className = 'grs-file-wrap';
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'grs-file-btn';
    btn.textContent = translateString('ファイルを選択');
    btn.addEventListener('click', function () { input.click(); });
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);
    wrap.appendChild(btn);
    // すぐ横にファイル名の表示が無いときだけ、選んだファイル名を出す
    var hasOwnName = input.parentNode && wrap.parentNode && wrap.parentNode.querySelector('.file-name-display');
    if (!hasOwnName) {
      var name = document.createElement('span');
      name.className = 'grs-file-name';
      var update = function () {
        var f = input.files && input.files[0];
        name.textContent = f ? f.name : translateString('選択されていません');
      };
      input.addEventListener('change', update);
      update();
      wrap.appendChild(name);
    }
  }

  function replaceFileInputs(root) {
    if (!root || resolveLocale() === DEFAULT_LOCALE || root.nodeType !== 1 && root.nodeType !== 9) return;
    if (root.nodeType === 1 && root.matches && root.matches('input[type=file]')) { replaceFileInput(root); return; }
    var list = root.querySelectorAll ? root.querySelectorAll('input[type=file]') : [];
    for (var i = 0; i < list.length; i++) replaceFileInput(list[i]);
  }

  I18N.registerText = function (locale, dict) {
    if (!locale || !dict) return;
    var cur = texts[locale] || (texts[locale] = {});
    Object.keys(dict).forEach(function (k) { cur[norm(k)] = dict[k]; });
  };
  I18N.registerPatterns = function (locale, list) {
    if (!locale || !list) return;
    var cur = patterns[locale] || (patterns[locale] = []);
    list.forEach(function (p) { if (p && p[0] instanceof RegExp) cur.push(p); });
  };
  // 訳さない場所（グラフや表など、ユーザーのデータが入る所）
  I18N.skip = function (selector) { if (selector) skipSelectors.push(selector); };
  I18N.translate = translateString;
  I18N.translateTree = translateTree;
  I18N.missing = findMissing;

  window.I18N = I18N;

  // 辞書の読み込み（日本語以外のときだけ）。このスクリプトは defer/async なしで読み込むこと。
  (function loadBundles() {
    var loc = resolveLocale();
    if (loc === DEFAULT_LOCALE) return;
    var me = document.currentScript;
    var list = me && me.getAttribute('data-i18n-bundles');
    if (!list) return;
    var base = me.src.replace(/i18n\.js(\?.*)?$/, 'i18n/' + loc + '/');
    var ver = (me.src.match(/\?v=([\w.-]+)/) || [])[1];
    list.split(',').forEach(function (name) {
      name = name.trim();
      if (!/^[\w-]+$/.test(name)) return;
      // パース中に同期で読み込み、後続のスクリプトより先に辞書を登録させる
      document.write('<script src="' + base + name + '.js' + (ver ? '?v=' + ver : '') + '"><\/script>');
    });
  })();

  function start() {
    I18N.apply(document);
    if (resolveLocale() === DEFAULT_LOCALE) return;
    try { document.title = translateString(document.title); } catch (e) {}
    translateTree(document.body);
    replaceFileInputs(document.body);
    // ツール画面のロゴなど「サイトのトップへ」のリンクは、その言語のトップ（/en/ など）へ
    Array.prototype.forEach.call(document.querySelectorAll('a[data-i18n-home]'), function (a) {
      a.setAttribute('href', I18N.sitePath('/'));
    });
    // あとから JS で差し込まれた文字も訳す
    try {
      new MutationObserver(function (records) {
        for (var i = 0; i < records.length; i++) {
          var r = records[i];
          if (r.type === 'childList') {
            for (var j = 0; j < r.addedNodes.length; j++) { translateTree(r.addedNodes[j]); replaceFileInputs(r.addedNodes[j]); }
          } else if (r.type === 'characterData') {
            translateTree(r.target);
          } else if (r.type === 'attributes' && r.target.nodeType === 1 && !isSkipped(r.target)) {
            translateElementAttrs(r.target);
          }
        }
      }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
    } catch (e) {}
    // 開発中だけ: 訳の無い日本語を console に出す
    if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) {
      setTimeout(function () {
        var m = findMissing();
        if (m.length) try { console.info('[i18n] 訳がない文言 ' + m.length + ' 件', m); } catch (e) {}
      }, 1500);
    }
  }

  // alert / confirm / prompt の文言も訳す（日本語以外のときだけ差し替える）
  if (resolveLocale() !== DEFAULT_LOCALE) {
    ['alert', 'confirm', 'prompt'].forEach(function (name) {
      var orig = window[name];
      if (typeof orig !== 'function') return;
      window[name] = function (msg) {
        var args = Array.prototype.slice.call(arguments);
        if (args.length) args[0] = translateString(msg);
        if (name === 'prompt' && args.length > 1 && typeof args[1] === 'string') args[1] = translateString(args[1]);
        return orig.apply(window, args);
      };
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
