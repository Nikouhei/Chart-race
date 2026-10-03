/*!
 * analytics.js — GraphRace Studio の行動計測（GA4 カスタムイベント）
 *
 * 各ページの gtag スニペットの「後」に読み込むだけで動く。HTML 側の個別改修は不要。
 *   <script src="../shared/analytics.js?v=20261003" defer></script>
 *
 * ── 送るイベント（GA4 のイベント名）──────────────────────────
 *   tool_open        ツール画面を開いた            （/app/ や単体ツールページ）
 *   tool_engaged     ツール画面で最初に操作した    （1ページ表示につき1回）
 *   tool_link_click  LP・ブログ・トップからツールへのリンクを押した
 *   tool_ui_click    ツール内のボタン操作（下の SEMANTIC に無いもの全部）
 *   preview_start    再生プレビュー／レース開始
 *   export_start     書き出し・録画ボタンを押した
 *   export_complete  動画／画像ファイルが実際に保存された
 *   file_save        CSV・Excel・バックアップ等のデータ保存
 *   file_import      CSV／Excel／画像などをファイル選択で読み込んだ
 *   project_save / project_backup / project_import / data_download / stock_fetch
 *   js_error         このサイトのスクリプトで起きたエラー（1ページ3件まで）
 *
 * ── 今後ボタンを足すとき ─────────────────────────────────
 *   HTML に data-track を付けるだけで、そのイベント名で送られる。
 *     <button data-track="upgrade_click" data-track-plan="lifetime">透かしなしで書き出す</button>
 *     → gtag('event','upgrade_click',{ plan:'lifetime', tool_name:..., ... })
 *   JS から直接送る場合は window.grsTrack('survey_submit', { price:'1980' })
 *
 * ── 本番以外では送信しない ───────────────────────────────
 *   graphrace-studio.com 以外（localhost・*.pages.dev）では送信せず console に出すだけ。
 *   本番で DebugView に流したいときは URL に ?grs_debug=1 を付ける（以後そのブラウザで有効）。
 */
(function () {
  "use strict";
  if (window.__grsAnalytics) return;
  window.__grsAnalytics = true;

  var HOST = location.hostname;
  var IS_PROD = /(^|\.)graphrace-studio\.com$/.test(HOST);
  var DEBUG = false;
  try {
    if (/[?&]grs_debug=1/.test(location.search)) localStorage.setItem("grs_debug", "1");
    if (/[?&]grs_debug=0/.test(location.search)) localStorage.removeItem("grs_debug");
    DEBUG = localStorage.getItem("grs_debug") === "1";
  } catch (e) {}

  // ── ページの分類 ──────────────────────────────────────
  var TOOLS = [
    [/^\/bar-chart-race(\/|$)/, "bar_chart_race"],
    [/^\/regular-chart(\/|$)/, "line_chart_race"],
    [/^\/stock-race\/app-bar(\/|$)/, "stock_race_bar"],
    [/^\/stock-race(\/|$)/, "stock_race_line"],
    [/^\/horse-race-ranking-maker(\/|$)/, "horse_race"],
    [/^\/ranking-video-maker(\/|$)/, "ranking_video"],
    [/^\/tournament-bracket-animator(\/|$)/, "tournament_bracket"],
    [/^\/amidakuji-maker(\/|$)/, "amidakuji"]
  ];
  // LP とツールが1ページに同居しているもの
  var SINGLE_PAGE_TOOLS = { horse_race: 1, amidakuji: 1 };

  function classify(pathname) {
    var tool = "";
    for (var i = 0; i < TOOLS.length; i++) {
      if (TOOLS[i][0].test(pathname)) { tool = TOOLS[i][1]; break; }
    }
    var type;
    if (/^\/blog(\/|$)/.test(pathname)) type = "blog";
    else if (pathname === "/" || pathname === "/index.html") type = "home";
    else if (tool && /\/app(-bar)?(\/|$)/.test(pathname)) type = "app";
    else if (tool && SINGLE_PAGE_TOOLS[tool]) type = "tool_page";
    else if (tool) type = "lp";
    else type = "other";
    return { tool: tool, type: type };
  }

  var PAGE = classify(location.pathname);
  var IS_TOOL_SCREEN = PAGE.type === "app" || PAGE.type === "tool_page";
  var OPENED_AT = Date.now();

  // ── 送信 ──────────────────────────────────────────────
  function track(name, params) {
    var p = { tool_name: PAGE.tool || "none", page_type: PAGE.type };
    if (params) for (var k in params) if (params[k] !== undefined && params[k] !== null && params[k] !== "") p[k] = params[k];
    if (DEBUG && IS_PROD) p.debug_mode = true;
    if (!IS_PROD || DEBUG) { try { console.log("[grs-analytics]", name, p); } catch (e) {} }
    if (!IS_PROD) return;
    if (typeof window.gtag === "function") window.gtag("event", name, p);
  }
  window.grsTrack = track;

  function clip(s, n) {
    s = String(s || "").replace(/\s+/g, " ").trim();
    return s.length > n ? s.slice(0, n) : s;
  }
  function secSinceOpen() { return Math.round((Date.now() - OPENED_AT) / 1000); }

  // ── ツール画面を開いた／最初に操作した ─────────────────────
  if (IS_TOOL_SCREEN) {
    track("tool_open", { from_sample: /[?&]sample=1/.test(location.search) ? "yes" : "no" });
  }
  var engaged = false;
  function markEngaged(how) {
    if (engaged || !IS_TOOL_SCREEN) return;
    engaged = true;
    track("tool_engaged", { engage_action: how, seconds_to_engage: secSinceOpen() });
  }

  // ── ボタンID → 意味のあるイベント名 ───────────────────────
  // 値が関数なら tool_name を見て出し分け。ここに無いボタンは tool_ui_click で送る。
  var SEMANTIC = {
    startBtn: "preview_start",
    "rv-play": "preview_start",
    "tt-play": "preview_start",
    btnAllStart: "preview_start",
    recBtn: ["export_start", { export_format: "webm" }],
    btnConfirmDownloadImage: ["export_start", { export_format: "png" }],
    saveProjectBtn: "project_save",
    exportProjectBtn: "project_backup",
    importProjectBtn: "project_import",
    stockFetchBtn: "stock_fetch"
  };
  // data-corner-action などの属性値 → イベント名
  var SEMANTIC_ACTION = {
    "download-csv": ["data_download", { file_ext: "csv" }],
    "download-excel": ["data_download", { file_ext: "xlsx" }]
  };

  // 連打（再生／一時停止の往復など）で同じボタンを短時間に何度も送らない
  var lastSent = {};
  function throttled(key, ms) {
    var now = Date.now();
    if (lastSent[key] && now - lastSent[key] < ms) return true;
    lastSent[key] = now;
    return false;
  }

  function buttonKey(el) {
    return el.getAttribute("data-track-id") || el.id ||
      el.getAttribute("data-corner-action") || el.getAttribute("data-action") ||
      el.getAttribute("data-mode") || el.getAttribute("data-tab") || el.getAttribute("name") || "";
  }
  function dataTrackParams(el) {
    var out = {};
    for (var i = 0; i < el.attributes.length; i++) {
      var a = el.attributes[i];
      if (a.name.indexOf("data-track-") === 0 && a.name !== "data-track-id") {
        out[a.name.slice(11).replace(/-/g, "_")] = clip(a.value, 100);
      }
    }
    return out;
  }

  function extOf(name) {
    var m = /\.([a-z0-9]{2,5})(?:$|\?)/i.exec(String(name || ""));
    return m ? m[1].toLowerCase() : "";
  }
  function kindOf(ext) {
    if (/^(webm|mp4|mov|gif)$/.test(ext)) return "video";
    if (/^(png|jpe?g|webp|svg)$/.test(ext)) return "image";
    if (/^(csv|xlsx?|tsv)$/.test(ext)) return "data";
    if (/^(json|grs)$/.test(ext)) return "project";
    return "other";
  }
  // ファイル名から日時などの数字を落として、集計しやすくする
  function normalizeFileName(name) {
    return clip(String(name || "").replace(/[_-]?\d{6,}/g, "").replace(/\d{4}-\d{2}-\d{2}[T_ ]?[\d:.-]*/g, ""), 60);
  }

  function trackDownload(fileName, via) {
    var ext = extOf(fileName);
    var kind = kindOf(ext);
    var p = { file_ext: ext, file_kind: kind, file_name: normalizeFileName(fileName), via: via, seconds_since_open: secSinceOpen() };
    track(kind === "video" || kind === "image" ? "export_complete" : "file_save", p);
  }

  // ── クリックの委譲 ─────────────────────────────────────
  document.addEventListener("click", function (ev) {
    var t = ev.target;
    if (!t || !t.closest) return;

    // 1) data-track 指定（最優先）
    var tracked = t.closest("[data-track]");
    if (tracked) {
      var name = tracked.getAttribute("data-track");
      if (name && !throttled("dt:" + name + buttonKey(tracked), 500)) {
        var p1 = dataTrackParams(tracked);
        p1.button_id = buttonKey(tracked) || undefined;
        p1.button_label = clip(tracked.textContent, 40) || undefined;
        track(name, p1);
      }
      markEngaged("click");
      return;
    }

    // 2) リンク
    var a = t.closest("a[href]");
    if (a) {
      if (a.hasAttribute("download")) {
        trackDownload(a.getAttribute("download") || a.href, "link");
        markEngaged("download");
        return;
      }
      var url;
      try { url = new URL(a.href, location.href); } catch (e) { return; }
      if (url.origin !== location.origin) return;
      var dest = classify(url.pathname);
      if (!dest.tool) return;
      if (url.pathname === location.pathname) return;
      // ツール間の切替（app → 別app）も、LP→app の遷移もここで拾える
      track("tool_link_click", {
        target_tool: dest.tool,
        target_page_type: dest.type,
        link_text: clip(a.textContent, 40),
        link_url: clip(url.pathname + url.search, 100)
      });
      return;
    }

    // 3) ツール画面のボタン
    if (!IS_TOOL_SCREEN) return;
    var btn = t.closest("button, [role='button'], [role='tab'], input[type='button'], input[type='submit']");
    if (!btn) return;
    var key = buttonKey(btn);
    var label = clip(btn.getAttribute("aria-label") || btn.textContent || btn.value, 40);
    markEngaged("click");

    var sem = SEMANTIC[btn.id] || SEMANTIC_ACTION[btn.getAttribute("data-corner-action")];
    if (sem) {
      var evName = typeof sem === "string" ? sem : sem[0];
      var extra = typeof sem === "string" ? {} : sem[1];
      if (throttled("s:" + evName + key, 1500)) return;
      var p2 = { button_id: key, button_label: label, seconds_since_open: secSinceOpen() };
      for (var k in extra) p2[k] = extra[k];
      if (evName === "stock_fetch") {
        var q = document.getElementById("stockRangePreset");
        if (q && q.value) p2.stock_range = clip(q.value, 30);
      }
      track(evName, p2);
      return;
    }
    if (throttled("b:" + (key || label), 1000)) return;
    track("tool_ui_click", { button_id: key || "(no-id)", button_label: label });
  }, true);

  // ── プログラムから a.click() される保存（動画書き出し・PNG・CSV など）──
  // DOM に挿入されていない <a download> の click() はドキュメントまで伝播しないため、ここで拾う
  try {
    var origClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      try {
        if (this.hasAttribute("download") && !this.isConnected) {
          trackDownload(this.getAttribute("download") || this.download, "script");
        }
      } catch (e) {}
      return origClick.apply(this, arguments);
    };
  } catch (e) {}

  // ── ファイル読み込み ──────────────────────────────────
  document.addEventListener("change", function (ev) {
    var el = ev.target;
    if (!el || el.tagName !== "INPUT") return;
    if (el.type === "file") {
      if (!el.files || !el.files.length) return;
      var f = el.files[0];
      var ext = extOf(f.name);
      track("file_import", { input_id: el.id || el.name || "(no-id)", file_ext: ext, file_kind: kindOf(ext), file_count: el.files.length });
      markEngaged("file_import");
    } else if (IS_TOOL_SCREEN) {
      markEngaged("input");
    }
  }, true);
  document.addEventListener("paste", function () { markEngaged("paste"); }, true);

  // ── このサイトのスクリプトで起きたエラー（書き出し失敗の発見用）──
  var errCount = 0;
  window.addEventListener("error", function (ev) {
    if (errCount >= 3) return;
    var src = ev && ev.filename ? String(ev.filename) : "";
    if (src && src.indexOf(location.origin) !== 0) return; // 拡張機能などは除外
    errCount++;
    track("js_error", { error_message: clip(ev && ev.message, 100), error_source: clip(src.replace(location.origin, ""), 80), error_line: ev && ev.lineno });
  });
})();
