/*
 * Chart Studio 共有ツールレジストリ
 * 各ツール(アプリ)が <head> で読み込み、ツール間のデータ引き継ぎと切替に使う。
 * 将来ツールを増やす時は CHART_TOOLS に1エントリ足すだけでよい。
 *   - id:   ツール識別子（切替ドロップダウンの値と一致）
 *   - label: 切替ドロップダウンに表示する名称
 *   - path:  そのツールの app/ への相対パス（各アプリは /<tool>/app/ にある前提）
 *   - kind:  'animated' | 'static'（参考情報）
 */
(function () {
  window.CHART_TOOLS = [
    { id: 'bar-chart-race', label: 'バーチャートレース', path: '../../bar-chart-race/app/', kind: 'animated' },
    { id: 'regular-chart',  label: '線グラフレース', path: '../../regular-chart/app/', kind: 'static' }
  ];

  // 編集中プロジェクトの一時引き継ぎ枠。保存済み一覧(chartToolSavedProjects)とは別管理。
  var ACTIVE_KEY = 'chartToolActiveProject';

  // 現在の編集内容を保存して対象ツールへ遷移する。
  // payload は各アプリの makeProjectPayload() の戻り値（data:{columns,rows} 共通スキーマ）。
  window.saveActiveProjectAndGo = function (toolId, payload) {
    var target = window.CHART_TOOLS.filter(function (t) { return t.id === toolId; })[0];
    if (!target) return;
    try {
      if (payload) localStorage.setItem(ACTIVE_KEY, JSON.stringify(payload));
      else localStorage.removeItem(ACTIVE_KEY);
    } catch (e) {
      // localStorage が使えない/容量超過でも遷移自体は行う
    }
    window.location.href = target.path;
  };

  // 起動時に呼ぶ。引き継ぎ payload があれば返し、枠は消費(削除)する。無ければ null。
  window.consumeActiveProject = function () {
    var raw;
    try {
      raw = localStorage.getItem(ACTIVE_KEY);
      if (raw) localStorage.removeItem(ACTIVE_KEY);
    } catch (e) {
      return null;
    }
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  };

  // === 離脱時の自動下書き保存（摩擦ゼロ方式）=========================
  // 閉じる/更新/戻る等での離脱時にページ破棄の瞬間 localStorage へ黙って保存し、
  // 次回起動時に「前回の続きを復元」を控えめなバナーで提案する。
  // ポップアップで保存可否を尋ねることはしない（ブラウザ仕様上、離脱時に
  // 確認待ち＋保存処理を挟めないため）。下書きは保存済み一覧とは別枠で管理。
  var DRAFT_PREFIX = 'chartToolDraft:';

  // 編集中スナップショット(makeProjectPayload 互換)を下書きとして保存。
  window.saveSessionDraft = function (toolId, payload) {
    if (!toolId || !payload) return;
    try {
      localStorage.setItem(DRAFT_PREFIX + toolId, JSON.stringify({
        savedAt: new Date().toISOString(),
        payload: payload
      }));
    } catch (e) {
      // 容量超過・プライベートモード等は黙って無視（離脱を妨げない）
    }
  };

  // 下書きを取得。{ savedAt, payload } か、無ければ null。
  window.loadSessionDraft = function (toolId) {
    var raw;
    try { raw = localStorage.getItem(DRAFT_PREFIX + toolId); }
    catch (e) { return null; }
    if (!raw) return null;
    try {
      var parsed = JSON.parse(raw);
      return (parsed && parsed.payload) ? parsed : null;
    } catch (e) { return null; }
  };

  // 下書きを破棄。
  window.clearSessionDraft = function (toolId) {
    try { localStorage.removeItem(DRAFT_PREFIX + toolId); }
    catch (e) {}
  };

  // 起動時に呼ぶ。下書きがあれば復元バナーを表示する。
  // onRestore(payload) には各アプリの loadProjectPayload 等を渡す。
  // 引き継ぎ(consumeActiveProject)で復元した時は呼ばないこと。
  window.offerSessionDraftRestore = function (toolId, onRestore) {
    var draft = window.loadSessionDraft(toolId);
    if (!draft || !draft.payload) return;

    var when = '';
    try {
      var fmtLocale = (window.I18N && window.I18N.formatLocale) ? window.I18N.formatLocale() : 'ja-JP';
      when = new Date(draft.savedAt).toLocaleString(fmtLocale, {
        month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
      });
    } catch (e) {}

    // スマホ幅では縦積みに切り替えるためのレスポンシブCSSを一度だけ注入する。
    // インラインスタイルより優先度が低いため !important で上書きする。
    if (!document.getElementById('cts-restore-style')) {
      var st = document.createElement('style');
      st.id = 'cts-restore-style';
      st.textContent =
        '@media (max-width:480px){' +
        '.cts-restore-bar{flex-direction:column !important;align-items:stretch !important;gap:10px !important;}' +
        '.cts-restore-bar .cts-restore-btns{width:100%;}' +
        '.cts-restore-bar .cts-restore-btns button{flex:1 1 0;}' +
        '}';
      (document.head || document.documentElement).appendChild(st);
    }

    var bar = document.createElement('div');
    bar.setAttribute('role', 'status');
    bar.className = 'cts-restore-bar';
    bar.style.cssText = [
      'position:fixed', 'left:50%', 'top:16px', 'transform:translateX(-50%)',
      'z-index:2500', 'display:flex', 'align-items:center', 'gap:14px',
      'max-width:calc(100vw - 32px)', 'padding:12px 14px 12px 18px',
      'background:#1f2430', 'color:#eef1f6', 'border:1px solid #3a4150',
      'border-radius:10px', 'box-shadow:0 12px 40px rgba(0,0,0,0.38)',
      'font-size:13px', 'line-height:1.5', 'font-family:inherit'
    ].join(';');

    var msg = document.createElement('span');
    msg.textContent = when
      ? '前回の続き（' + when + '）が残っています。'
      : '前回の続きが残っています。';
    msg.style.cssText = 'flex:1;min-width:0;';

    function makeBtn(label, primary) {
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.style.cssText = [
        'flex:0 0 auto', 'width:auto', 'margin:0', 'padding:7px 14px',
        'border:none', 'border-radius:6px', 'cursor:pointer',
        'font-size:13px', 'font-weight:bold',
        primary ? 'background:var(--accent,#6E62F0);color:#fff'
                : 'background:#39404e;color:#cfd6e2'
      ].join(';');
      return b;
    }

    var restoreBtn = makeBtn('復元', true);
    var discardBtn = makeBtn('破棄', false);

    function remove() { if (bar.parentNode) bar.parentNode.removeChild(bar); }

    restoreBtn.addEventListener('click', function () {
      window.clearSessionDraft(toolId);
      remove();
      try { onRestore(draft.payload); } catch (e) {}
    });
    discardBtn.addEventListener('click', function () {
      window.clearSessionDraft(toolId);
      remove();
    });

    var btns = document.createElement('div');
    btns.className = 'cts-restore-btns';
    btns.style.cssText = 'display:flex;gap:10px;flex:0 0 auto;';
    btns.appendChild(restoreBtn);
    btns.appendChild(discardBtn);

    bar.appendChild(msg);
    bar.appendChild(btns);

    if (document.body) document.body.appendChild(bar);
    else document.addEventListener('DOMContentLoaded', function () {
      document.body.appendChild(bar);
    });
  };

  // 切替ドロップダウン(<select id="chartToolSwitcher">)に option を流し込む共通処理。
  // currentId を selected にする。
  window.populateChartToolSwitcher = function (selectEl, currentId) {
    if (!selectEl) return;
    selectEl.innerHTML = window.CHART_TOOLS.map(function (t) {
      var sel = t.id === currentId ? ' selected' : '';
      return '<option value="' + t.id + '"' + sel + '>' + t.label + '</option>';
    }).join('');
  };
})();
