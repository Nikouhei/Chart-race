/*!
 * export-cta.js — 「動画を保存」への導線（バーチャートレース・線グラフレース共通）
 *
 * 書き出しボタン（#exportVideoBtn）は設定パネルの「動画」タブの中にあり、
 * タイムラインの再生ボタンで見ている人には見つけにくい。そこで次の2つを足す。
 *   1. タイムラインバーの右端に「動画を保存」ボタン（#timelineExportBtn）
 *   2. プレビューを最後まで再生したら、保存を案内するカード（#endExportBtn）
 * どちらも GRSVideoExport.attach で #exportVideoBtn と同じ書き出しダイアログを開く。
 *
 * 使い方（ツール側）:
 *   const extraButtons = GRSExportCTA.init({ startBtn, timelineBar });
 *     timelineBar を渡さないツール（格付けダービー）は cardHost にカードを置く場所を渡す。
 *     その場合タイムラインのボタンは作らず、カードのボタンだけを返す。
 *   extraButtons.forEach(b => GRSVideoExport.attach({ ...cfg, button: b }));
 *   再生開始時  GRSExportCTA.hideEnd()
 *   再生完了時  GRSExportCTA.showEnd()
 *
 * 計測: 3つのボタンはどれも tool_ui_click（button_id で区別）。
 *   exportVideoBtn … パネル内 / timelineExportBtn … タイムライン / endExportBtn … 再生完了カード
 *   endExportClose … カードを閉じた
 *   書き出し本体は従来どおり export_start / export_complete。
 *
 * アプリ内ブラウザの案内:
 *   LINE・Instagram・Facebook・X のアプリ内ブラウザは、ファイルのダウンロードを止めることが多く、
 *   書き出した動画を保存できない。作り始める前に気付けるよう、ツールを開いた時点で上部に案内を出す
 *   （書き出し画面にも同じ案内を出す。video-export.js が GRSExportCTA.inApp() を見る）。
 *   LINE は URL に openExternalBrowser=1 を付けると普段のブラウザで開き直せるので、そのボタンを出す。
 */
(function () {
  "use strict";
  if (window.GRSExportCTA) return;

  var ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></svg>';
  var card = null, tlBtn = null, closedByUser = false;

  function ensureStyles() {
    if (document.getElementById("grs-export-cta-style")) return;
    var s = document.createElement("style");
    s.id = "grs-export-cta-style";
    s.textContent =
      "#timelineExportBtn{flex:none;width:auto;min-width:0;height:40px;margin:0;padding:0 14px;display:flex;align-items:center;gap:6px;" +
        "border-radius:999px;border:1.5px solid var(--accent,#6E62F0);background:#fff;color:var(--accent,#6E62F0);" +
        "font-size:13px;font-weight:700;line-height:1;white-space:nowrap;cursor:pointer;box-shadow:none}" +
      "#timelineExportBtn svg{width:16px;height:16px;display:block}" +
      "#timelineExportBtn:hover:not(:disabled){background:color-mix(in srgb,var(--accent,#6E62F0) 10%,#fff)}" +
      "#timelineExportBtn:disabled{border-color:#d4d4d4;color:#b0b0b0;background:#fff;cursor:default}" +
      "#timelineExportBtn.is-attn{background:var(--accent,#6E62F0);color:#fff;animation:grsCtaPulse 1.6s ease-out 2}" +
      "@keyframes grsCtaPulse{0%{box-shadow:0 0 0 0 color-mix(in srgb,var(--accent,#6E62F0) 45%,transparent)}100%{box-shadow:0 0 0 12px transparent}}" +
      ".grs-end-card{position:absolute;right:20px;bottom:calc(100% + 14px);z-index:950;width:300px;max-width:calc(100vw - 32px);box-sizing:border-box;" +
        "padding:16px 16px 14px;border-radius:12px;background:#fff;color:#1b1f27;border:1px solid rgba(16,18,22,.08);" +
        "box-shadow:0 10px 30px rgba(16,18,22,.16);opacity:0;transform:translateY(8px);transition:opacity .18s ease,transform .18s ease}" +
      ".grs-end-card.is-in{opacity:1;transform:none}" +
      ".grs-end-card[hidden]{display:none}" +
      ".grs-end-title{margin:0 22px 4px 0;font-size:14px;font-weight:700;line-height:1.5}" +
      ".grs-end-sub{margin:0 0 12px;font-size:12px;line-height:1.6;color:#5b6270}" +
      "#endExportBtn{width:100%;min-height:42px;margin:0;display:flex;align-items:center;justify-content:center;gap:8px;" +
        "border:0;border-radius:8px;background:var(--accent,#6E62F0);color:#fff;font-size:14px;font-weight:700;cursor:pointer}" +
      "#endExportBtn:hover{background:var(--accent-strong,#5A4FE0)}" +
      "#endExportBtn svg{width:16px;height:16px;display:block}" +
      "#endExportClose{position:absolute;top:8px;right:8px;width:28px;height:28px;min-width:0;margin:0;padding:0;border:0;border-radius:6px;" +
        "background:transparent;color:#8a909c;font-size:18px;line-height:28px;text-align:center;cursor:pointer}" +
      "#endExportClose:hover{background:#f1f2f4;color:#1b1f27}" +
      "@media (max-width:900px){" +
        "#timelineExportBtn{width:40px;height:40px;padding:0;justify-content:center;border-radius:50%}" +
        "#timelineExportBtn span{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}" +
        "#timelineExportBtn svg{width:18px;height:18px}" +
        ".grs-end-card{left:16px;right:16px;width:auto;max-width:none;bottom:calc(100% + 10px)}" +
      "}" +
      // プレビューの枠の中に置く場合（格付けダービー）
      ".grs-end-card.in-stage{left:auto;right:12px;bottom:12px;width:min(300px,calc(100% - 24px));padding:14px 14px 12px}" +
      ".grs-end-card.in-stage .grs-end-sub{margin-bottom:10px}" +
      // スマホではプレビュー枠が小さいので、ボタンだけの細い帯にして絵を隠しすぎないようにする
      "@media (max-width:600px){" +
        ".grs-end-card.in-stage{left:8px;right:8px;bottom:8px;width:auto;padding:6px;border-radius:10px}" +
        ".grs-end-card.in-stage .grs-end-title,.grs-end-card.in-stage .grs-end-sub{display:none}" +
        ".grs-end-card.in-stage #endExportBtn{width:calc(100% - 36px);min-height:38px;font-size:13px}" +
        ".grs-end-card.in-stage #endExportClose{top:50%;right:6px;transform:translateY(-50%)}" +
      "}";
    document.head.appendChild(s);
  }

  function init(opts) {
    opts = opts || {};
    var startBtn = opts.startBtn, bar = opts.timelineBar, host = opts.cardHost || bar;
    if (!host) return [];
    ensureStyles();

    if (bar) {
      tlBtn = document.createElement("button");
      tlBtn.type = "button";
      tlBtn.id = "timelineExportBtn";
      tlBtn.title = "動画を書き出す（MP4 / WebM）";
      tlBtn.innerHTML = ICON + "<span>動画を保存</span>";
      bar.appendChild(tlBtn);
    }

    card = document.createElement("div");
    card.className = "grs-end-card" + (host !== bar ? " in-stage" : "");
    card.hidden = true;
    card.setAttribute("role", "status");
    card.innerHTML =
      '<button type="button" id="endExportClose" aria-label="閉じる">×</button>' +
      '<p class="grs-end-title">このまま動画にして保存できます</p>' +
      '<p class="grs-end-sub">いまのプレビューをそのまま MP4 の動画ファイルにします。画面録画は要りません。</p>' +
      '<button type="button" id="endExportBtn">' + ICON + "<span>この動画を保存</span></button>";
    host.appendChild(card);
    var endBtn = card.querySelector("#endExportBtn");
    card.querySelector("#endExportClose").addEventListener("click", function () { closedByUser = true; hideEnd(); });
    endBtn.addEventListener("click", hideEnd);

    if (startBtn) {
      var sync = function () {
        if (tlBtn) tlBtn.disabled = startBtn.disabled;
        if (startBtn.disabled) hideEnd();
      };
      new MutationObserver(sync).observe(startBtn, { attributes: true, attributeFilter: ["disabled"] });
      sync();
    }
    return tlBtn ? [tlBtn, endBtn] : [endBtn];
  }

  // 再生完了時。×で閉じた人には、そのページを開いている間は出さない（ボタンの強調だけ）
  function showEnd() {
    if (!card || (tlBtn && tlBtn.disabled)) return;
    if (window.GRSVideoExport && window.GRSVideoExport.busy) return;
    if (tlBtn) {
      tlBtn.classList.remove("is-attn");
      void tlBtn.offsetWidth; // アニメーションをやり直す
      tlBtn.classList.add("is-attn");
    }
    if (closedByUser) return;
    card.hidden = false;
    requestAnimationFrame(function () { if (card) card.classList.add("is-in"); });
  }

  function hideEnd() {
    if (tlBtn) tlBtn.classList.remove("is-attn");
    if (!card) return;
    card.classList.remove("is-in");
    card.hidden = true;
  }

  // ── アプリ内ブラウザの判定と案内 ─────────────────────────
  function inApp() {
    var ua = navigator.userAgent || "";
    var name = /\bLine\//i.test(ua) ? "LINE"
      : /Instagram/i.test(ua) ? "Instagram"
      : /FBAN|FBAV|FB_IAB|FBIOS/i.test(ua) ? "Facebook"
      : /Twitter/i.test(ua) ? "X" : "";
    if (!name) return null;
    var url = "";
    if (name === "LINE") {
      try {
        var u = new URL(location.href);
        u.searchParams.set("openExternalBrowser", "1");
        url = u.toString();
      } catch (e) {}
    }
    return { name: name, externalUrl: url };
  }
  // 案内の文面（ツール上部のバナーと書き出し画面で共通）
  function inAppHtml(info, opts) {
    opts = opts || {};
    var how = info.externalUrl
      ? '<a class="grs-inapp-btn" href="' + info.externalUrl + '">Safari・Chromeで開き直す</a>'
      : '<span class="grs-inapp-how">右上の「…」メニューから「ブラウザで開く」を選んでください。</span>';
    return '<p class="grs-inapp-text"><b>' + info.name + "のアプリ内ブラウザでは、作った動画を保存できないことがあります。</b>" +
      "SafariやChromeで開いてからお使いください。" + (opts.lossNote ? "（開き直すと、ここで入力した内容は引き継がれません）" : "") + "</p>" + how;
  }
  function ensureInAppStyles() {
    if (document.getElementById("grs-inapp-style")) return;
    var s = document.createElement("style");
    s.id = "grs-inapp-style";
    s.textContent =
      ".grs-inapp{position:fixed;left:12px;right:12px;top:12px;z-index:7000;max-width:560px;margin:0 auto;box-sizing:border-box;" +
        "padding:12px 40px 12px 14px;border-radius:10px;background:#fff8e6;color:#3d3216;border:1px solid #f0d58a;" +
        "box-shadow:0 8px 24px rgba(0,0,0,.18);font-size:13px;line-height:1.6}" +
      ".grs-inapp-text{margin:0 0 8px}.grs-inapp-text b{display:block}" +
      ".grs-inapp-btn{display:inline-block;padding:8px 14px;border-radius:8px;background:#06c755;color:#fff!important;font-weight:700;text-decoration:none}" +
      ".grs-inapp-how{display:block;font-weight:700}" +
      ".grs-inapp-x{position:absolute;top:6px;right:6px;width:30px;height:30px;min-width:0;margin:0;padding:0;border:0;background:transparent;color:#7a6a3a;font-size:18px;cursor:pointer}" +
      // 書き出し画面の中に出すとき
      ".grs-inapp.in-dialog{position:static;max-width:none;margin:0 0 14px;padding:12px 14px;box-shadow:none}";
    document.head.appendChild(s);
  }
  // ツール上部のバナー。閉じたらそのタブを開いている間は出さない
  function showInAppBanner() {
    var info = inApp();
    if (!info) return;
    try { if (sessionStorage.getItem("grs_inapp_closed")) return; } catch (e) {}
    ensureInAppStyles();
    var el = document.createElement("div");
    el.className = "grs-inapp";
    el.setAttribute("role", "note");
    el.innerHTML = inAppHtml(info) + '<button type="button" class="grs-inapp-x" id="inAppClose" aria-label="閉じる">×</button>';
    document.body.appendChild(el);
    el.querySelector(".grs-inapp-x").addEventListener("click", function () {
      el.remove();
      try { sessionStorage.setItem("grs_inapp_closed", "1"); } catch (e) {}
    });
  }
  // 書き出し画面用。アプリ内ブラウザでなければ空文字
  function inAppDialogHtml() {
    var info = inApp();
    if (!info) return "";
    ensureInAppStyles();
    return '<div class="grs-inapp in-dialog" role="note">' + inAppHtml(info, { lossNote: true }) + "</div>";
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", showInAppBanner, { once: true });
  else showInAppBanner();

  window.GRSExportCTA = { init: init, showEnd: showEnd, hideEnd: hideEnd, inApp: inApp, inAppDialogHtml: inAppDialogHtml };
})();
