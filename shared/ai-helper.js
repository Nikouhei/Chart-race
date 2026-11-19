/*!
 * ai-helper.js — 「AIでデータを作る」ポップアップ（ツール画面共通）
 *
 * ユーザーがテーマを入れ →「頼む文をコピー」→ ChatGPT・Claude・Gemini などに貼る →
 * AI の返事をそのまま貼り付けて読み込む、までをツールの中で済ませるための部品。
 * AI には何も送らない（コピーと貼り付けだけ。データは外に出ない）。
 *
 * 使い方（ツール側）:
 *   GRSAIHelper.init({
 *     button: document.getElementById('aiHelperBtn'),   // 開くボタン（文言は HTML 側に日本語で書く）
 *     prompt: { ja: theme => '…', en: theme => '…' },   // 頼む文（表示言語で切り替える）
 *     onImport: table => { … },                         // 2次元配列（1行目が見出し）。失敗時は Error を投げる
 *   });
 *   ?ai=1 で開かれたときは自動でポップアップを開き、URL から ai だけを消す（?sample= があるときは開かない）。
 *
 * 計測:
 *   ai_helper_open  { via: tool | lp | skill } … ポップアップを開いた（skill = スキルを入れた AI が案内した ?ai=1&ref=skill）
 *   スキル（/ai/graphrace-studio-data.zip・SKILL.md）のダウンロードは analytics.js が自動で file_save にする
 *   ai_prompt_copy  { via: tool | lp }   … 頼む文をコピーした
 *   file_import     { via: ai_paste, file_ext: csv|tsv|md } … 貼り付けで読み込んだ
 */
(function () {
  "use strict";
  if (window.GRSAIHelper) return;

  var ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/></svg>';
  var cfg = null, overlay = null, via = "tool";

  function track(name, params) { if (window.grsTrack) window.grsTrack(name, params || {}); }
  function isEn() { return !!(window.I18N && !window.I18N.isDefault()); }
  function t(s) { return (window.I18N && window.I18N.translate) ? window.I18N.translate(s) : s; }

  function ensureStyles() {
    if (document.getElementById("grs-ai-style")) return;
    var s = document.createElement("style");
    s.id = "grs-ai-style";
    s.textContent =
      ".grs-ai-btn{display:inline-flex;align-items:center;gap:5px;width:auto;min-width:0;margin:0;padding:5px 10px;border-radius:999px;" +
        "border:1.5px solid var(--accent,#6E62F0);background:#fff;color:var(--accent,#6E62F0);font-size:12px;font-weight:700;line-height:1.2;cursor:pointer;white-space:nowrap}" +
      ".grs-ai-btn:hover{background:color-mix(in srgb,var(--accent,#6E62F0) 10%,#fff)}" +
      ".grs-ai-btn svg{width:14px;height:14px;display:block}" +
      ".grs-ai-ov{position:fixed;inset:0;z-index:5000;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(16,18,22,.45)}" +
      ".grs-ai-ov[hidden]{display:none}" +
      ".grs-ai-box{position:relative;width:520px;max-width:100%;max-height:calc(100vh - 32px);overflow:auto;box-sizing:border-box;padding:22px 22px 18px;" +
        "border-radius:14px;background:#fff;color:#1b1f27;box-shadow:0 16px 40px rgba(16,18,22,.25);font-size:13px;line-height:1.6}" +
      ".grs-ai-box h2{margin:0 30px 4px 0;font-size:17px;display:flex;align-items:center;gap:6px}" +
      ".grs-ai-box h2 svg{width:18px;height:18px;color:var(--accent,#6E62F0)}" +
      ".grs-ai-lead{margin:0 0 14px;color:#5b6270;font-size:12px}" +
      ".grs-ai-step{margin:0 0 14px;padding:12px;border:1px solid #e6e7ea;border-radius:10px}" +
      ".grs-ai-step h3{margin:0 0 8px;font-size:13px;display:flex;gap:8px;align-items:center}" +
      ".grs-ai-num{flex:none;width:20px;height:20px;border-radius:50%;background:var(--accent,#6E62F0);color:#fff;font-size:12px;display:flex;align-items:center;justify-content:center}" +
      ".grs-ai-box input[type=text],.grs-ai-box textarea{width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid #cfd2d8;border-radius:8px;background:#fff;color:#1b1f27;font-size:13px;font-family:inherit}" +
      ".grs-ai-box textarea{min-height:110px;resize:vertical;font-family:ui-monospace,Menlo,monospace;font-size:12px}" +
      ".grs-ai-row{display:flex;gap:8px;margin-top:8px;flex-wrap:wrap}" +
      ".grs-ai-main{flex:1 1 auto;min-height:38px;margin:0;border:0;border-radius:8px;background:var(--accent,#6E62F0);color:#fff;font-size:13px;font-weight:700;cursor:pointer}" +
      ".grs-ai-main:hover{background:var(--accent-strong,#5A4FE0)}" +
      ".grs-ai-note{margin:6px 0 0;font-size:11px;color:#5b6270}" +
      ".grs-ai-msg{margin:6px 0 0;font-size:12px;min-height:1em}" +
      ".grs-ai-msg.is-ok{color:#1a7f37}.grs-ai-msg.is-err{color:#c62828}" +
      ".grs-ai-box details{margin-top:8px;font-size:11px;color:#5b6270}" +
      ".grs-ai-box details pre{white-space:pre-wrap;margin:6px 0 0;padding:8px;background:#f5f6f8;border-radius:6px;max-height:160px;overflow:auto}" +
      ".grs-ai-x{position:absolute;top:10px;right:10px;width:30px;height:30px;min-width:0;margin:0;padding:0;border:0;border-radius:6px;background:transparent;color:#5b6270;font-size:20px;line-height:1;cursor:pointer}" +
      ".grs-ai-x:hover{background:#f0f1f3}" +
      ".grs-ai-skill{margin-top:14px;padding-top:12px;border-top:1px dashed #d8dae0}" +
      ".grs-ai-skill-t{margin:0 0 4px;font-size:12px;font-weight:700}" +
      ".grs-ai-dl{flex:1 1 auto;display:flex;align-items:center;justify-content:center;min-height:34px;padding:0 10px;border:1.5px solid var(--accent,#6E62F0);border-radius:8px;" +
        "color:var(--accent,#6E62F0);background:#fff;font-size:12px;font-weight:700;text-decoration:none}" +
      ".grs-ai-dl:hover{background:color-mix(in srgb,var(--accent,#6E62F0) 10%,#fff)}";
    document.head.appendChild(s);
  }

  function buildPrompt(theme) {
    var fn = (isEn() && cfg.prompt.en) || cfg.prompt.ja;
    return fn(theme);
  }

  function build() {
    ensureStyles();
    overlay = document.createElement("div");
    overlay.className = "grs-ai-ov";
    overlay.hidden = true;
    overlay.innerHTML =
      '<div class="grs-ai-box" role="dialog" aria-modal="true" aria-labelledby="grsAiTitle">' +
        '<button type="button" class="grs-ai-x" aria-label="閉じる">×</button>' +
        '<h2 id="grsAiTitle">' + ICON + '<span>AIでデータを作る</span></h2>' +
        '<p class="grs-ai-lead">ChatGPT・Claude・Gemini などのAIに、このツールで読み込める形でデータを作ってもらえます。</p>' +
        '<div class="grs-ai-step"><h3><span class="grs-ai-num">1</span><span>テーマを入れて、頼む文をコピー</span></h3>' +
          '<input type="text" id="grsAiTheme" maxlength="200" placeholder="例：世界の人口ランキングの推移（1960〜2020年）">' +
          '<div class="grs-ai-row"><button type="button" class="grs-ai-main" id="grsAiCopy">頼む文をコピー</button></div>' +
          '<p class="grs-ai-msg" id="grsAiCopyMsg" aria-live="polite"></p>' +
          '<details><summary>コピーされる文を見る</summary><pre id="grsAiPreview"></pre></details>' +
        '</div>' +
        '<div class="grs-ai-step"><h3><span class="grs-ai-num">2</span><span>AIに貼り付けて送信</span></h3>' +
          '<p class="grs-ai-note" style="margin:0">お使いのAIのチャット欄に貼り付けて送ってください。AIの数値は間違っていることがあるので、大事な用途では出典を確かめてください。</p>' +
        '</div>' +
        '<div class="grs-ai-step" style="margin-bottom:0"><h3><span class="grs-ai-num">3</span><span>AIの返事を貼り付けて読み込む</span></h3>' +
          '<textarea id="grsAiPaste" placeholder="AIの返事をそのまま貼り付けてください（説明文が入っていても大丈夫です）"></textarea>' +
          '<div class="grs-ai-row"><button type="button" class="grs-ai-main" id="grsAiImport">読み込む</button></div>' +
          '<p class="grs-ai-msg" id="grsAiImportMsg" aria-live="polite"></p>' +
        '</div>' +
        '<div class="grs-ai-skill"><p class="grs-ai-skill-t">毎回コピーしたくない方へ：スキルを入れておく</p>' +
          '<p class="grs-ai-note" style="margin:0 0 8px">AIに一度入れておけば、次からは「〇〇の推移をバーチャートレース用に」と頼むだけで、この形のデータが返ってきます。</p>' +
          '<div class="grs-ai-row" style="margin-top:0">' +
            '<a class="grs-ai-dl" href="/ai/graphrace-studio-data.zip" download="graphrace-studio-data.zip">Claude 用（zip）</a>' +
            '<a class="grs-ai-dl" href="/ai/graphrace-studio-data/SKILL.md" download="SKILL.md">Gemini 用（SKILL.md）</a>' +
          '</div>' +
          '<p class="grs-ai-note">Claude：設定 → 機能 → スキル からアップロード。Gemini：カスタマイズ → スキル → 作成 → アップロード。</p>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);

    var theme = overlay.querySelector("#grsAiTheme");
    var preview = overlay.querySelector("#grsAiPreview");
    function refreshPreview() { preview.textContent = buildPrompt(theme.value.trim() || t("（ここにテーマ）")); }
    theme.addEventListener("input", refreshPreview);
    refreshPreview();

    overlay.addEventListener("click", function (e) { if (e.target === overlay) close(); });
    overlay.querySelector(".grs-ai-x").addEventListener("click", close);
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !overlay.hidden) close(); });

    overlay.querySelector("#grsAiCopy").addEventListener("click", function () {
      var msg = overlay.querySelector("#grsAiCopyMsg");
      var v = theme.value.trim();
      if (!v) { setMsg(msg, "テーマを入れてください", false); theme.focus(); return; }
      copyText(buildPrompt(v)).then(function () {
        setMsg(msg, "コピーしました。AIに貼り付けて送信してください", true);
        track("ai_prompt_copy", { via: via });
      }, function () {
        setMsg(msg, "コピーできませんでした。下の「コピーされる文を見る」から手でコピーしてください", false);
        overlay.querySelector("details").open = true;
      });
    });

    overlay.querySelector("#grsAiImport").addEventListener("click", function () {
      var msg = overlay.querySelector("#grsAiImportMsg");
      var raw = overlay.querySelector("#grsAiPaste").value;
      var res = extractTable(raw);
      if (!res) { setMsg(msg, "表のデータが見つかりませんでした。AIの返事全体を貼り付けてください", false); return; }
      try {
        cfg.onImport(res.table);
        applyMeta(extractMeta(raw));
      } catch (err) {
        setMsg(msg, t("読み込めませんでした：") + (err && err.message ? err.message : ""), false);
        return;
      }
      track("file_import", { via: "ai_paste", input_id: "grsAiPaste", file_ext: res.format, file_kind: "data"});
      overlay.querySelector("#grsAiPaste").value = "";
      setMsg(msg, "", true);
      close();
    });
  }

  function setMsg(el, text, ok) {
    el.textContent = text ? t(text) : "";
    el.className = "grs-ai-msg " + (ok ? "is-ok" : "is-err");
  }

  function copyText(text) {
    // Clipboard API が許可されない環境（アプリ内ブラウザなど）では execCommand でやり直す
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).catch(function () { return legacyCopy(text); });
    }
    return legacyCopy(text);
  }
  function legacyCopy(text) {
    return new Promise(function (resolve, reject) {
      var ta = document.createElement("textarea");
      ta.value = text; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      var ok = false; try { ok = document.execCommand("copy"); } catch (e) {}
      document.body.removeChild(ta);
      ok ? resolve() : reject();
    });
  }

  // ── AI の返事から表を取り出す ─────────────────────────
  // 優先順: ```コードブロック → Markdown の表（| 区切り）→ カンマ／タブ区切りの連続した行
  // 返事の「タイトル: …」「出典: …」「単位: …」（英語は Title / Source / Unit）を拾う
  function extractMeta(raw) {
    var text = String(raw || "").replace(/```[\s\S]*?```/g, "");
    var keys = { title: /^(タイトル|title)$/i, source: /^(出典|source|sources)$/i, unit: /^(単位|unit)$/i };
    var meta = {};
    text.split(/\r?\n/).forEach(function (line) {
      var m = line.replace(/^[\s>*\-・#]+/, "").replace(/\*\*/g, "").match(/^([^:：]{1,10})\s*[:：]\s*(.+)$/);
      if (!m) return;
      Object.keys(keys).forEach(function (k) {
        if (!meta[k] && keys[k].test(m[1].trim())) meta[k] = m[2].trim().slice(0, 200);
      });
    });
    return meta;
  }

  // ツール画面のタイトル・出典・単位（数値の後ろに付ける文字）の欄に入れる
  function applyMeta(meta) {
    [["title", "titleInput"], ["source", "sourceInput"], ["unit", "valueSuffix"]].forEach(function (p) {
      var el = document.getElementById(p[1]);
      if (!meta[p[0]] || !el) return;
      el.value = meta[p[0]];
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }

  function extractTable(raw) {
    var text = String(raw || "").replace(/^﻿/, "").replace(/\r\n?/g, "\n");
    if (!text.trim()) return null;
    var m = text.match(/```[^\n]*\n([\s\S]*?)```/);
    if (m) { var r = parseDelimited(m[1]); if (r) return r; }
    var md = parseMarkdownTable(text);
    if (md) return md;
    return parseDelimited(text);
  }

  function parseMarkdownTable(text) {
    var lines = text.split("\n"), block = [], best = [];
    lines.forEach(function (l) {
      if (/^\s*\|.*\|\s*$/.test(l)) block.push(l);
      else { if (block.length > best.length) best = block; block = []; }
    });
    if (block.length > best.length) best = block;
    if (best.length < 2) return null;
    var table = best
      .filter(function (l) { return !/^\s*\|?[\s:|-]+\|?\s*$/.test(l); }) // 区切り行 |---|---|
      .map(function (l) {
        return l.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map(function (c) { return cleanCell(c); });
      });
    return table.length >= 2 ? { table: table, format: "md" } : null;
  }

  function parseDelimited(text) {
    var lines = text.split("\n");
    var tab = lines.filter(function (l) { return l.indexOf("\t") >= 0; }).length;
    var comma = lines.filter(function (l) { return l.indexOf(",") >= 0; }).length;
    var delim = tab > comma ? "\t" : ",";
    // 区切り文字を含む連続した行のうち、一番長いかたまりを表とみなす（前後の説明文を除く）
    var block = [], best = [];
    lines.forEach(function (l) {
      if (l.indexOf(delim) >= 0) block.push(l);
      else if (l.trim() === "" && block.length && delim === ",") { /* 空行は区切りとして扱う */ if (block.length > best.length) best = block; block = []; }
      else { if (block.length > best.length) best = block; block = []; }
    });
    if (block.length > best.length) best = block;
    if (best.length < 2) return null;
    var table = parseCSV(best.join("\n"), delim).map(function (row) { return row.map(cleanCell); });
    return { table: table, format: delim === "\t" ? "tsv" : "csv" };
  }

  // ダブルクォート対応の CSV パーサ（"a,b" や "" のエスケープを扱う）
  function parseCSV(text, delim) {
    var rows = [], row = [], cell = "", q = false;
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
        else cell += c;
      } else if (c === '"' && cell === "") q = true;
      else if (c === delim) { row.push(cell); cell = ""; }
      else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
      else cell += c;
    }
    row.push(cell); rows.push(row);
    return rows.filter(function (r) { return r.some(function (x) { return String(x).trim() !== ""; }); });
  }

  function cleanCell(c) {
    return String(c == null ? "" : c).trim().replace(/^\*\*(.*)\*\*$/, "$1");
  }

  function open(how) {
    if (!overlay) build();
    via = how || "tool";
    overlay.hidden = false;
    track("ai_helper_open", { via: via });
    setTimeout(function () { var el = overlay.querySelector("#grsAiTheme"); if (el) el.focus(); }, 30);
  }
  function close() { if (overlay) overlay.hidden = true; }

  function init(options) {
    cfg = options;
    ensureStyles();
    if (cfg.button) {
      if (!cfg.button.querySelector("svg")) cfg.button.insertAdjacentHTML("afterbegin", ICON);
      cfg.button.addEventListener("click", function () { open("tool"); });
    }
    // LP の「AIで作る」リンク（?ai=1）から来たとき
    // URL から ai を消すのは load の後（page_view・tool_open が ?ai=1 付きの URL で記録されるように）
    if (new URLSearchParams(location.search).get("ai") === "1") {
      var go = function () {
        var params = new URLSearchParams(location.search);
        params.delete("ai");
        var qs = params.toString();
        history.replaceState(history.state, "", location.pathname + (qs ? "?" + qs : "") + location.hash);
        // スキル入りの AI が案内するリンクには ref=skill が付く（どこから開いたかを via で区別）
        var from = params.get("ref") === "skill" ? "skill" : "lp";
        params.delete("ref");
        qs = params.toString();
        history.replaceState(history.state, "", location.pathname + (qs ? "?" + qs : "") + location.hash);
        if (!params.get("sample")) open(from);
      };
      if (document.readyState === "complete") go();
      else window.addEventListener("load", go);
    }
  }

  window.GRSAIHelper = { init: init, open: open, extractTable: extractTable };
})();
