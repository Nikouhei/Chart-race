/*!
 * origin-guard.js — 無断複製サイト検知バナー
 *
 * サイトを丸ごとコピーして別ドメインで公開する「模倣サイト」対策。
 * 許可ドメイン以外で読み込まれた場合のみ、ページ上部に公式サイトへの案内帯を出す。
 *
 * 方針：
 *   ・リダイレクトはしない（開発環境やプレビューでの誤作動の実害を避けるため）
 *   ・閲覧者に「本家はここ」と伝えることで、模倣サイトの流入価値そのものを削ぐ
 *   ・JSを切られれば無効化されるが、コピーサイトは自動複製がほとんどで
 *     このスクリプトごとコピーされるため、実運用では十分に機能する
 */
(function () {
  "use strict";

  var OFFICIAL_ORIGIN = "https://graphrace-studio.com";

  // 完全一致で許可する本番ホスト
  var ALLOW_EXACT = [
    "graphrace-studio.com",
    "www.graphrace-studio.com",
    "localhost",
    "127.0.0.1",
    "[::1]",
    "0.0.0.0"
  ];

  // 後方一致で許可するホスト（デプロイプレビュー環境）
  var ALLOW_SUFFIX = [
    ".pages.dev",      // Cloudflare Pages
    ".workers.dev",    // Cloudflare Workers
    ".vercel.app",     // Vercel プレビュー
    ".localhost"
  ];

  function isAllowed() {
    // file:// での閲覧・ローカル確認は対象外
    if (location.protocol === "file:") return true;

    var host = location.hostname;
    if (!host) return true;
    host = host.toLowerCase();

    for (var i = 0; i < ALLOW_EXACT.length; i++) {
      if (host === ALLOW_EXACT[i]) return true;
    }
    for (var j = 0; j < ALLOW_SUFFIX.length; j++) {
      if (host.slice(-ALLOW_SUFFIX[j].length) === ALLOW_SUFFIX[j]) return true;
    }
    return false;
  }

  function showNotice() {
    var bar = document.createElement("div");
    bar.setAttribute("role", "alert");
    bar.style.cssText = [
      "position:fixed", "top:0", "left:0", "right:0", "z-index:2147483647",
      "background:#b91c1c", "color:#fff",
      "font:600 14px/1.6 system-ui,-apple-system,'Hiragino Sans','Noto Sans JP',sans-serif",
      "padding:12px 16px", "text-align:center",
      "box-shadow:0 2px 12px rgba(0,0,0,.35)"
    ].join(";");

    var msg = document.createElement("span");
    msg.textContent = "このページは GraphRace Studio の無断複製です。公式サイトはこちら → ";
    bar.appendChild(msg);

    var link = document.createElement("a");
    link.href = OFFICIAL_ORIGIN + location.pathname;
    link.textContent = "graphrace-studio.com";
    link.rel = "noopener";
    link.style.cssText = "color:#fff;text-decoration:underline;font-weight:700";
    bar.appendChild(link);

    document.body.appendChild(bar);
    // 帯のぶんだけ本文を押し下げ、コンテンツが隠れないようにする
    document.body.style.paddingTop = bar.offsetHeight + "px";
  }

  if (isAllowed()) return;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", showNotice);
  } else {
    showNotice();
  }
})();
