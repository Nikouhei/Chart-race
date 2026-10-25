/*
 * グラフ系ツール共通：背景を「白／黒／透過」から選ぶ
 * （バーチャートレース・線グラフレース・円グラフレースで共通）
 *
 * - 白・黒を選ぶと、背景色とあわせて文字・軸などの色を自動で切り替える
 *   （白のときの色は、各ツールの HTML に書いてある初期値）
 * - 「透過」はまだ作っていない。有料機能にするか需要を測るためのボタン
 *     押す → upgrade_click（button_id: transparentExport）※HTML の data-track で送る
 *     「使いたい」と答える → tool_ui_click（button_id: transparentWant）
 *   今後 Polar で有料化するときは、ここに透過書き出しの本体と課金判定を入れる
 * - 計測：白・黒のボタンは id（bgWhite / bgBlack）がそのまま tool_ui_click の button_id になる
 * - 以前の「背景画像」は廃止（古い保存データに残っていても使わない）
 */
(function () {
  'use strict';

  // 黒背景のときの色（白背景のときは HTML の初期値に戻す）
  var DARK = {
    layoutTextColor: '#f2f2f2',
    titleColor: '#f2f2f2',
    sourceColor: '#a8a8a8',
    nameLabelColor: '#eeeeee',
    valueLabelColor: '#eeeeee',
    legendColor: '#eeeeee',
    categoryLegendColor: '#f2f2f2',
    timeCounterColor: '#ffffff',
    axisTextColor: '#a0a0a0',
    axisLineColor: '#555555',
    pieGapColor: '#000000',
    pieCenterColor: '#f2f2f2'
  };
  var BG = { white: '#ffffff', black: '#000000' };

  var STYLE = [
    '.grs-bg-mode{display:flex;gap:2px;padding:3px;border-radius:9px;background:var(--panel-surface-2,#eef0f3)}',
    '.grs-bg-mode button{flex:1;min-width:0;margin:0;padding:7px 6px;border:0;border-radius:6px;background:transparent;color:var(--text-muted,#6b7280);font-size:13px;line-height:1.2;box-shadow:none;cursor:pointer}',
    '.grs-bg-mode button:hover{transform:none}',
    '.grs-bg-mode button.active{background:#fff;color:var(--text-strong,#111);box-shadow:var(--shadow-soft,0 1px 3px rgba(0,0,0,.12))}',
    '.grs-bg-mode small{display:block;font-size:10px;opacity:.75;margin-top:1px}'
  ].join('');

  function $(id) { return document.getElementById(id); }

  function fire(el) {
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function isDark(hex) {
    var m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return false;
    var n = parseInt(m[1], 16);
    var r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    return (0.299 * r + 0.587 * g + 0.114 * b) < 128;
  }

  function currentMode() {
    var bg = $('layoutBackgroundColor');
    return bg && isDark(bg.value) ? 'black' : 'white';
  }

  function syncButtons() {
    var mode = currentMode();
    document.querySelectorAll('.grs-bg-mode [data-bg-mode]').forEach(function (b) {
      var on = b.getAttribute('data-bg-mode') === mode;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  function applyMode(mode) {
    var bg = $('layoutBackgroundColor');
    var useBg = $('enableBackgroundColor');
    if (!bg) return;

    // 文字・軸などの色
    Object.keys(DARK).forEach(function (id) {
      var el = $(id);
      if (!el) return;
      var next = mode === 'black' ? DARK[id] : el.defaultValue;
      if (el.value.toLowerCase() !== String(next).toLowerCase()) { el.value = next; fire(el); }
    });

    // 黒背景で「ダーク」パターンだと見えにくいのでスタンダードへ
    var palette = $('barColorPalette');
    if (palette && mode === 'black' && palette.value === 'dark') { palette.value = 'standard'; fire(palette); }

    if (useBg && !useBg.checked) { useBg.checked = true; fire(useBg); }
    bg.value = BG[mode];
    fire(bg);
    syncButtons();
  }

  function askTransparent() {
    var msg = '透過での書き出しは、有料機能として準備中です。\n使ってみたいですか？（OKを押すと「使いたい」として送信されます）';
    if (window.confirm(msg)) {
      if (window.grsTrack) window.grsTrack('tool_ui_click', { button_id: 'transparentWant', button_label: '透過を使いたい' });
      window.alert('ありがとうございます！今後の開発の参考にします。');
    }
  }

  function init() {
    if (!document.querySelector('.grs-bg-mode')) return;
    var st = document.createElement('style');
    st.textContent = STYLE;
    document.head.appendChild(st);

    // 背景画像は廃止：古い保存データで有効になっていても使わない
    var useImg = $('enableBackgroundImage');
    if (useImg && useImg.checked) { useImg.checked = false; fire(useImg); }

    document.querySelectorAll('.grs-bg-mode [data-bg-mode]').forEach(function (b) {
      b.addEventListener('click', function () {
        var mode = b.getAttribute('data-bg-mode');
        if (mode === 'transparent') { askTransparent(); return; }
        applyMode(mode);
      });
    });

    syncButtons();
    // 保存したプロジェクトの読み込みなどで背景色が変わったときもボタンの表示を合わせる
    setInterval(function () {
      syncButtons();
      var img = $('enableBackgroundImage');
      if (img && img.checked) { img.checked = false; fire(img); }
    }, 1000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
