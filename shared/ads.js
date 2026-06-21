/**
 * shared/ads.js
 * Google Adsense ポップアップ広告表示スクリプト
 *
 * - ファーストページ（トップページ）では表示しない
 * - 一度閉じたページでは、同一セッション中は再表示しない（ページ単位）
 * - 別ページに遷移した場合は新たに表示される
 * - PC・スマートフォン両対応
 */
(function () {
  'use strict';
  // ─── ページ単位のセッション管理 ───
  var pageKey = 'ad-popup-closed-' + location.pathname;
  try {
    if (sessionStorage.getItem(pageKey)) return;
  } catch (e) {
    // sessionStorage が使えない環境では表示する
  }

  // ─── ページ読み込み完了後に表示 ───
  window.addEventListener('load', function () {
    // 少し遅延させてUX改善（ページ描画完了を待つ）
    setTimeout(showAdPopup, 1500);
  });

  function showAdPopup() {
    // ──────────────────────────────
    //  CSS の注入
    // ──────────────────────────────
    var style = document.createElement('style');
    style.textContent =
      '#ad-popup-overlay{' +
        'position:fixed;top:0;left:0;width:100%;height:100%;' +
        'background:rgba(0,0,0,.45);z-index:99998;' +
        'opacity:0;transition:opacity .3s ease;' +
      '}' +
      '#ad-popup-overlay.visible{opacity:1;}' +

      '#ad-popup-container{' +
        'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%) scale(.92);' +
        'z-index:99999;background:#fff;border-radius:16px;' +
        'box-shadow:0 20px 60px rgba(0,0,0,.25);' +
        'padding:32px 28px 28px;max-width:400px;width:calc(100% - 40px);' +
        'opacity:0;transition:opacity .3s ease,transform .3s ease;' +
      '}' +
      '#ad-popup-container.visible{' +
        'opacity:1;transform:translate(-50%,-50%) scale(1);' +
      '}' +

      '#ad-popup-close{' +
        'position:absolute;top:10px;right:10px;' +
        'width:36px;height:36px;border:none;background:rgba(0,0,0,.06);' +
        'border-radius:50%;font-size:20px;line-height:36px;text-align:center;' +
        'cursor:pointer;color:#555;transition:background .15s ease,color .15s ease;' +
        'display:flex;align-items:center;justify-content:center;' +
      '}' +
      '#ad-popup-close:hover{background:rgba(0,0,0,.12);color:#222;}' +

      '#ad-popup-label{' +
        'display:block;text-align:center;font-size:11px;color:#999;' +
        'margin-bottom:14px;letter-spacing:.5px;' +
      '}' +

      '#ad-popup-ad-slot{' +
        'min-height:250px;display:flex;align-items:center;justify-content:center;' +
        'background:#fafafa;border-radius:10px;overflow:hidden;' +
      '}' +

      /* スマートフォン向け調整 */
      '@media(max-width:480px){' +
        '#ad-popup-container{' +
          'padding:24px 18px 18px;max-width:calc(100% - 32px);border-radius:14px;' +
        '}' +
        '#ad-popup-close{width:40px;height:40px;font-size:22px;line-height:40px;top:8px;right:8px;}' +
        '#ad-popup-ad-slot{min-height:200px;}' +
      '}';
    document.head.appendChild(style);

    // ──────────────────────────────
    //  オーバーレイ
    // ──────────────────────────────
    var overlay = document.createElement('div');
    overlay.id = 'ad-popup-overlay';
    document.body.appendChild(overlay);

    // ──────────────────────────────
    //  ポップアップ本体
    // ──────────────────────────────
    var container = document.createElement('div');
    container.id = 'ad-popup-container';
    container.innerHTML =
      '<button id="ad-popup-close" aria-label="広告を閉じる">&times;</button>' +
      '<span id="ad-popup-label">スポンサーリンク</span>' +
      '<div id="ad-popup-ad-slot">' +
        '<!-- ▼ Google Adsense 広告コード ▼ -->' +
        '<ins class="adsbygoogle"' +
        '     style="display:block;width:100%;min-height:250px"' +
        '     data-ad-client="ca-pub-7525273601757171"' +
        '     data-ad-slot="XXXXXXXXXX"' +
        '     data-ad-format="auto"' +
        '     data-full-width-responsive="true"></ins>' +
        '<!-- ▲ Google Adsense 広告コード ▲ -->' +
      '</div>';
    document.body.appendChild(container);

    // ──────────────────────────────
    //  Adsense 広告の初期化
    //  （adsbygoogle.js は各ページの <head> で既に読み込み済み）
    // ──────────────────────────────
    try {
      (window.adsbygoogle = window.adsbygoogle || []).push({});
    } catch (e) {
      // 広告ブロッカー等でエラーが出る場合があるため握りつぶす
    }

    // ──────────────────────────────
    //  表示アニメーション
    // ──────────────────────────────
    requestAnimationFrame(function () {
      overlay.classList.add('visible');
      container.classList.add('visible');
    });

    // ──────────────────────────────
    //  閉じる処理
    // ──────────────────────────────
    function closePopup() {
      overlay.classList.remove('visible');
      container.classList.remove('visible');
      setTimeout(function () {
        overlay.remove();
        container.remove();
      }, 350);
      // ページ単位でセッションに記録
      try {
        sessionStorage.setItem(pageKey, '1');
      } catch (e) {
        // 無視
      }
    }

    document.getElementById('ad-popup-close').addEventListener('click', closePopup);
    overlay.addEventListener('click', closePopup);
  }
})();
