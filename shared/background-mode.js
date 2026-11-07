/*
 * グラフ系ツール共通：背景を「白／黒／透過」から選ぶ
 * （バーチャートレース・線グラフレース・円グラフレースで共通）
 *
 * - 白・黒を選ぶと、背景色とあわせて文字・軸などの色を自動で切り替える
 *   （白のときの色は、各ツールの HTML に書いてある初期値）
 * - 「透過」は背景色をオフにする。重ねる映像の明るさは分からないので、文字を白＋黒フチにして
 *   どの映像の上でも読めるようにする（どちらも設定で変えられる）。明るい映像には「文字色」で
 *   黒＋白フチに切り替える（透過のときだけ出る。計測は id がそのまま tool_ui_click の button_id）。プレビューは市松模様で見せ、
 *   書き出し（shared/video-export.js）は #chartArea の .grs-transparent を見て透過で書き出す
 *     押す → upgrade_click（button_id: transparentExport）※HTML の data-track で送る
 *   今後 Polar で有料化するときは、ここに課金判定を入れる
 * - 文字のフチ（textOutlineWidth / textOutlineColor）と影（textShadowStrength）は #chartArea の .grs-outlined と CSS 変数で付ける。
 *   計測：太さを変えると tool_ui_click（button_id: textOutlineWidth）、影の強さを変えると tool_ui_click（button_id: textShadowStrength）
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
  // 透過のときの色（フチを付けるので文字はすべて白）
  var OVERLAY = {
    layoutTextColor: '#ffffff',
    titleColor: '#ffffff',
    sourceColor: '#ffffff',
    nameLabelColor: '#ffffff',
    valueLabelColor: '#ffffff',
    legendColor: '#ffffff',
    categoryLegendColor: '#ffffff',
    timeCounterColor: '#ffffff',
    axisTextColor: '#ffffff',
    axisLineColor: '#888888',
    pieGapColor: '#000000',
    pieCenterColor: '#ffffff'
  };
  // 透過で文字を黒にするときの色（明るい映像の上で使う。縁と影は白にする）
  var OVERLAY_DARK = {
    layoutTextColor: '#111111',
    titleColor: '#111111',
    sourceColor: '#111111',
    nameLabelColor: '#111111',
    valueLabelColor: '#111111',
    legendColor: '#111111',
    categoryLegendColor: '#111111',
    timeCounterColor: '#111111',
    axisTextColor: '#111111',
    axisLineColor: '#777777',
    pieGapColor: '#ffffff',
    pieCenterColor: '#111111'
  };
  var OVERLAY_OUTLINE = 3; // px
  var OVERLAY_SHADOW = 50; // %

  var STYLE = [
    '.grs-bg-mode{display:flex;gap:2px;padding:3px;border-radius:9px;background:var(--panel-surface-2,#eef0f3)}',
    '.grs-bg-mode button{flex:1;min-width:0;margin:0;padding:7px 6px;border:0;border-radius:6px;background:transparent;color:var(--text-muted,#6b7280);font-size:13px;line-height:1.2;box-shadow:none;cursor:pointer}',
    '.grs-bg-mode button:hover{transform:none}',
    '.grs-bg-mode button.active{background:#fff;color:var(--text-strong,#111);box-shadow:var(--shadow-soft,0 1px 3px rgba(0,0,0,.12))}',
    '.grs-bg-mode small{display:block;font-size:10px;opacity:.75;margin-top:1px}',
    // 透過のプレビュー用の市松模様（style 属性の background-* より優先する）。書き出しには写らない
    '#chartArea.grs-transparent{background-image:repeating-conic-gradient(#ccc 0 25%,#fff 0 50%)!important;background-size:16px 16px!important;background-position:0 0!important;background-repeat:repeat!important}',
    // 文字のフチ。線を文字の後ろに描くので、太くしても文字は細らない。
    // 太さは文字サイズに比例（大きい年号は太く、小さい軸の数字は細く）。フチは半透明
    '#chartArea.grs-outlined{--grs-outline-px:clamp(1px,calc(var(--grs-outline-scale) * .04em),calc(var(--grs-outline-scale) * 1.5px));-webkit-text-stroke:var(--grs-outline-px) var(--grs-outline-color);paint-order:stroke fill}',
    '#chartArea.grs-outlined text{-webkit-text-stroke:0;stroke:var(--grs-outline-color);stroke-width:var(--grs-outline-px);stroke-linejoin:round;paint-order:stroke fill}',
    // 影（フチとは別に付けられる）。HTML は text-shadow、SVG の文字は filter: drop-shadow
    '#chartArea.grs-shadowed{text-shadow:0 .05em .15em var(--grs-shadow-color)}',
    '#chartArea.grs-shadowed text{text-shadow:none;filter:drop-shadow(0 .05em .15em var(--grs-shadow-color))}'
  ].join('');

  function $(id) { return document.getElementById(id); }

  function fire(el) {
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function setValue(el, next) {
    if (String(el.value).toLowerCase() !== String(next).toLowerCase()) { el.value = next; fire(el); }
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
    var useBg = $('enableBackgroundColor');
    if (useBg && !useBg.checked) return 'transparent';
    return bg && isDark(bg.value) ? 'black' : 'white';
  }

  function syncButtons() {
    var mode = currentMode();
    document.querySelectorAll('.grs-bg-mode [data-bg-mode]').forEach(function (b) {
      var on = b.getAttribute('data-bg-mode') === mode;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    // 透過のときは下の「文字色」（白／黒）で決めるので、テキスト色の欄は隠す
    var textInput = $('layoutTextColor');
    var textField = textInput && textInput.closest('.setting-field');
    if (textField) textField.style.display = mode === 'transparent' ? 'none' : '';
    var tone = $('grsTextTone');
    if (tone) {
      tone.style.display = mode === 'transparent' ? '' : 'none';
      var text = $('layoutTextColor');
      var current = text && isDark(text.value) ? 'dark' : 'light';
      tone.querySelectorAll('[data-text-tone]').forEach(function (b) {
        var on = b.getAttribute('data-text-tone') === current;
        b.classList.toggle('active', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
    }
  }

  // 透過のときの文字色（白＋黒フチ／黒＋白フチ）。太さなど自分で変えた設定は戻さない
  function applyTone(tone) {
    var colors = tone === 'dark' ? OVERLAY_DARK : OVERLAY;
    Object.keys(colors).forEach(function (id) {
      var el = $(id);
      if (el) setValue(el, colors[id]);
    });
    var outlineC = $('textOutlineColor');
    if (outlineC) setValue(outlineC, tone === 'dark' ? '#ffffff' : '#000000');
    syncButtons();
  }

  function applyMode(mode) {
    var bg = $('layoutBackgroundColor');
    var useBg = $('enableBackgroundColor');
    if (!bg) return;

    // 透過のまま押し直しても、自分で変えた色やフチは戻さない
    if (mode === 'transparent' && currentMode() === 'transparent') return;

    // 文字・軸などの色
    var colors = mode === 'transparent' ? OVERLAY : mode === 'black' ? DARK : null;
    Object.keys(DARK).forEach(function (id) {
      var el = $(id);
      if (!el) return;
      var next = colors ? colors[id] : el.defaultValue;
      setValue(el, next);
    });

    // 黒系の背景で「ダーク」パターンだと見えにくいのでスタンダードへ
    var palette = $('barColorPalette');
    if (palette && mode !== 'white' && palette.value === 'dark') { palette.value = 'standard'; fire(palette); }

    // 線グラフの右端のラベル。線の色のままだと黒フチに沈むので、透過では白文字にする
    var useLineColor = $('labelUseLineColor');
    if (useLineColor) {
      var wantLineColor = mode === 'transparent' ? false : useLineColor.defaultChecked;
      if (useLineColor.checked !== wantLineColor) { useLineColor.checked = wantLineColor; fire(useLineColor); }
    }

    // 文字のフチ
    var outlineW = $('textOutlineWidth'), outlineC = $('textOutlineColor'), shadowS = $('textShadowStrength');
    if (outlineW) setValue(outlineW, mode === 'transparent' ? OVERLAY_OUTLINE : 0);
    if (shadowS) setValue(shadowS, mode === 'transparent' ? OVERLAY_SHADOW : 0);
    if (outlineC) setValue(outlineC, '#000000');

    if (mode === 'transparent') {
      if (useBg && useBg.checked) { useBg.checked = false; fire(useBg); }
      syncButtons();
      return;
    }

    if (useBg && !useBg.checked) { useBg.checked = true; fire(useBg); }
    bg.value = BG[mode];
    fire(bg);
    syncButtons();
  }

  function init() {
    if (!document.querySelector('.grs-bg-mode')) return;
    var st = document.createElement('style');
    st.textContent = STYLE;
    document.head.appendChild(st);

    document.querySelectorAll('.grs-bg-mode [data-bg-mode]').forEach(function (b) {
      b.addEventListener('click', function () {
        applyMode(b.getAttribute('data-bg-mode'));
      });
    });

    // 透過のときだけ出す「文字色」（背景の3択の下に差し込む）
    var bgRow = document.querySelector('.grs-bg-mode');
    bgRow = bgRow && bgRow.closest('.setting-row');
    if (bgRow && !$('grsTextTone')) {
      var row = document.createElement('div');
      row.className = 'setting-row';
      row.id = 'grsTextTone';
      row.style.display = 'none';
      row.innerHTML = '<div class="setting-field" style="flex:1 1 100%;"><span>文字色</span>' +
        '<div class="grs-bg-mode" role="group" aria-label="文字色">' +
        '<button type="button" id="textToneLight" data-text-tone="light">白</button>' +
        '<button type="button" id="textToneDark" data-text-tone="dark">黒</button>' +
        '</div></div>';
      bgRow.parentNode.insertBefore(row, bgRow.nextSibling);
      row.querySelectorAll('[data-text-tone]').forEach(function (b) {
        b.addEventListener('click', function () { applyTone(b.getAttribute('data-text-tone')); });
      });
    }

    var outline = $('textOutlineWidth');
    if (outline) outline.addEventListener('change', function () {
      if (window.grsTrack) window.grsTrack('tool_ui_click', { button_id: 'textOutlineWidth', button_label: '文字のフチ' });
    });

    var shadow = $('textShadowStrength');
    if (shadow) shadow.addEventListener('change', function () {
      if (window.grsTrack) window.grsTrack('tool_ui_click', { button_id: 'textShadowStrength', button_label: '影の強さ' });
    });

    syncButtons();
    // 保存したプロジェクトの読み込みなどで背景色が変わったときもボタンの表示を合わせる
    setInterval(function () {
      syncButtons();
    }, 1000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
