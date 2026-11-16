/*!
 * export-plan.js — 書き出しの無料／有料の判定と、有料化に向けたアンケート
 *
 * 全ツール共通。動画を書き出す前に、次の2つをこのファイルに聞く。
 *   GRSPlan.canUse('hd_max')         … 最高画質（2倍）を使えるか
 *   （MP4 はスマホで再生できる唯一の形式なので、有料化後も無料のまま）
 *   GRSPlan.canUse('no_watermark')   … 透かしを消せるか
 *
 * ── 有料化スイッチ ─────────────────────────────────────
 *   CONFIG.paywallEnabled = false（いま）
 *     透かしなしは全員が使える（有料予定のラベルは出さない）。最高画質は選択肢に出さない。
 *     透かしの有無は export_start の watermark で GA4 に残る。
 *   CONFIG.paywallEnabled = true（販売開始後）
 *     有料機能は誰でも選べる（プレビューも止めない）。「書き出す」を押したとき、
 *     GRSPlan.gate(使われている機能の配列) で判定し、有料パスが無い人には
 *     購入案内を1回だけ出す。使われている有料機能はまとめて一覧表示する。
 *       ・購入する（価格ページへ） ・有料機能を外して書き出す（標準の形に戻す） ・閉じる
 *     止めたときは export_blocked（plan_feature＝機能名をカンマ区切り）を GA4 に送る。
 *     パスの確認は CONFIG.licenseEndpoint（自前の /api/license。Stripe の支払い完了通知で
 *     発行したキーを Cloudflare D1 と照合する）に POST する。未実装なら空のままにしておく。
 *
 * ── アンケート（charts_v2 / derby_v2）────────────────────────
 *   書き出しのエンコード待ちの間に出す2問。1ブラウザにつき回答は1回。
 *   スキップした人には、そのあと3回書き出したら1回だけもう一度出す（合計2回まで）。
 *   送るイベント:
 *     survey_view     アンケートを表示した（回答率の分母）
 *     survey_submit   回答した  survey_id / no_buy_reason または pain_point または use_case / wanted_features / survey_comment
 *     survey_dismiss  スキップした
 *   値はすべて英語のコード（下の QUICK_SURVEYS の value）。カンマ区切りで複数選択を表す。
 */
(function () {
  "use strict";
  if (window.GRSPlan) return;

  var CONFIG = {
    paywallEnabled: true,
    // 価格ページ（言語ごと）。価格ページの公開と同時に paywallEnabled を true にした（2026-11）
    pricingUrls: { ja: "/pricing", en: "/en/pricing" },
    // パス確認のサーバー側エンドポイント（worker/license-api.js。キーを D1 と照合する）
    licenseEndpoint: "/api/license",
    // ライセンスを一度確認したら、次に確認しなおすまでの日数
    licenseRecheckDays: 7
  };

  // 有料予定の機能と表示名
  // 書き出しボタンを押したとき、使われていて、かつパスが無ければ止める機能
  var FEATURES = {
    hd_max: "最高画質",
    hd_1080: "高画質（1080p）",
    no_watermark: "透かしなし",
    transparent_export: "透過書き出し",
    rounded_bar: "角丸バー",
    image_right: "画像の位置：バーの右",
    derby_fanfare: "ファンファーレ",
    derby_sound: "サウンド（歓声・蹄の音）"
  };

  var LS_LICENSE = "grs_license_v1";
  var LS_EXPORTS = "grs_export_count";

  function lsGet(key) {
    try { var v = localStorage.getItem(key); return v ? JSON.parse(v) : null; } catch (e) { return null; }
  }
  function lsSet(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
  }
  function track(name, params) {
    try { if (typeof window.grsTrack === "function") window.grsTrack(name, params || {}); } catch (e) {}
  }

  // ── ライセンス ─────────────────────────────────────────
  function getLicense() {
    var lic = lsGet(LS_LICENSE);
    return lic && lic.key && lic.valid ? lic : null;
  }
  function isPro() { return !!getLicense(); }

  function canUse(feature) {
    if (!FEATURES[feature]) return true;
    if (!CONFIG.paywallEnabled) return true;
    return isPro();
  }

  // 機能に付けるラベル。空文字なら何も付けない
  function badgeText(feature) {
    if (!FEATURES[feature]) return "";
    if (!CONFIG.paywallEnabled) return "";
    return isPro() ? "" : "有料";
  }

  async function activateLicense(key) {
    key = String(key || "").trim();
    if (!key) return { ok: false, message: "ライセンスキーを入力してください" };
    if (!CONFIG.licenseEndpoint) {
      return { ok: false, message: "ライセンスの販売はまだ始まっていません" };
    }
    try {
      var res = await fetch(CONFIG.licenseEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ license_key: key })
      });
      var body = await res.json().catch(function () { return {}; });
      if (res.ok && body && body.valid) {
        lsSet(LS_LICENSE, { key: key, valid: true, checkedAt: Date.now() });
        track("license_activate", { license_result: "ok" });
        return { ok: true };
      }
      track("license_activate", { license_result: "invalid" });
      return { ok: false, message: (body && body.message) || "このライセンスキーは使えません" };
    } catch (e) {
      track("license_activate", { license_result: "error" });
      return { ok: false, message: "通信に失敗しました。時間をおいて試してください" };
    }
  }

  // 保存済みライセンスを定期的に確認しなおす（失効・返金に追従するため）
  function recheckLicense() {
    var lic = lsGet(LS_LICENSE);
    if (!lic || !lic.key || !CONFIG.licenseEndpoint) return;
    if (Date.now() - (lic.checkedAt || 0) < CONFIG.licenseRecheckDays * 864e5) return;
    fetch(CONFIG.licenseEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ license_key: lic.key })
    }).then(function (r) { return r.json(); }).then(function (b) {
      lsSet(LS_LICENSE, { key: lic.key, valid: !!(b && b.valid), checkedAt: Date.now() });
    }).catch(function () {}); // 通信できないときは前回の結果のまま
  }
  recheckLicense();

  // ── 購入案内（paywallEnabled のときだけ使う）────────────────
  function lockedOf(features) {
    return (features || []).filter(function (f, i, a) { return FEATURES[f] && a.indexOf(f) === i && !canUse(f); });
  }
  function pricingUrl() {
    var lang = (document.documentElement.lang || "ja").slice(0, 2);
    return CONFIG.pricingUrls[lang] || CONFIG.pricingUrls.ja;
  }

  // features … 機能キーの配列（1つでも可）。複数ならまとめて一覧で1回だけ出す
  // opts.from … 計測用の表示元／opts.allowStrip … 「有料機能を外して書き出す」を出すか
  // opts.onClose(result) … result は "bought"（パスが有効になった）／ "strip" ／ "cancel"
  function openUpgrade(features, opts) {
    opts = opts || {};
    var list = (Array.isArray(features) ? features : [features]).filter(function (f) { return FEATURES[f]; });
    var featureKeys = list.join(",");
    ensureStyles();
    var back = document.createElement("div");
    back.className = "grsp-backdrop";
    back.innerHTML =
      '<div class="grsp-modal" role="dialog" aria-modal="true" aria-labelledby="grspUpTitle">' +
        '<h3 id="grspUpTitle">有料パスが必要な機能が使われています</h3>' +
        '<ul class="grsp-list">' + list.map(function (f) { return "<li>" + esc(FEATURES[f]) + "</li>"; }).join("") + "</ul>" +
        '<p>書き出すには有料パスが必要です。パスなしで書き出す場合は、これらを標準の設定に戻します。</p>' +
        '<div class="grsp-cta">' +
        '<a class="grsp-btn grsp-primary" target="_blank" rel="noopener" href="' + esc(pricingUrl()) + '" data-track="upgrade_click" data-track-plan-feature="' + esc(featureKeys) + '" data-track-upgrade-from="export_gate">プランを見る</a>' +
        (opts.allowStrip ? '<button type="button" class="grsp-btn grsp-ghost grsp-strip">有料機能を外して書き出す</button>' : "") +
        '</div>' +
        '<details class="grsp-license"><summary>ライセンスキーをお持ちの方</summary>' +
          '<div class="grsp-row"><input type="text" class="grsp-input" placeholder="GRS-XXXX-XXXX-XXXX" autocomplete="off">' +
          '<button type="button" class="grsp-btn grsp-primary grsp-activate">有効にする</button></div>' +
          '<p class="grsp-msg" aria-live="polite"></p>' +
        '</details>' +
        '<div class="grsp-actions"><button type="button" class="grsp-btn grsp-ghost grsp-close">閉じる</button></div>' +
      '</div>';
    document.body.appendChild(back);
    function close(result) {
      back.remove();
      if (opts.onClose) opts.onClose(result);
    }
    back.querySelector(".grsp-close").addEventListener("click", function () { close("cancel"); });
    back.addEventListener("click", function (e) { if (e.target === back) close("cancel"); });
    var strip = back.querySelector(".grsp-strip");
    if (strip) strip.addEventListener("click", function () { close("strip"); });
    back.querySelector(".grsp-activate").addEventListener("click", async function () {
      var msg = back.querySelector(".grsp-msg");
      msg.textContent = "確認中…";
      var r = await activateLicense(back.querySelector(".grsp-input").value);
      if (r.ok) { msg.textContent = "有効になりました"; setTimeout(function () { close("bought"); }, 600); }
      else msg.textContent = r.message;
    });
  }

  // 書き出しボタンを押したときの判定。features … 使われている機能キーの配列
  // 戻り値: Promise<"ok" | "strip" | "cancel">
  //   ok     … そのまま書き出してよい（有料機能が無い／パスが有効／paywall が無効）
  //   strip  … 有料機能を標準に戻して書き出す（呼び出し側が戻す）
  //   cancel … 書き出さない
  function gate(features, opts) {
    opts = opts || {};
    var locked = lockedOf(features);
    if (!locked.length) return Promise.resolve("ok");
    track("export_blocked", { plan_feature: locked.join(","), upgrade_from: opts.from || "export_gate" });
    return new Promise(function (resolve) {
      openUpgrade(locked, {
        from: opts.from || "export_gate",
        allowStrip: opts.allowStrip !== false,
        onClose: function (r) { resolve(r === "bought" ? "ok" : r); }
      });
    });
  }

  // ── アンケート ─────────────────────────────────────────
  function countExport() {
    var n = (lsGet(LS_EXPORTS) || 0) + 1;
    lsSet(LS_EXPORTS, n);
    return n;
  }

  // ── 書き出し待ちのアンケート（charts_v2：グラフ3ツール / derby_v2：格付けダービー）──
  // どちらも2問をタップで答えるだけ。1問目は1つ選択、2問目（欲しい機能）は複数選択。
  // 2問とも選ぶと「送信する」が押せる。「その他」を選ぶと1行の入力欄が出る（任意）。
  //   charts_v2 の1問目は出し分ける：
  //     有料パスが無い人 → no_buy_reason（有料にしなかった理由）
  //     有料パスがある人 → pain_point（いちばん手間取ったところ）
  //   survey_submit  survey_id / use_case・no_buy_reason・pain_point のどれか / wanted_features（カンマ区切り）/ survey_comment
  // 表示のルール：回答したら出さない。スキップは、そのあと3回書き出したら1回だけ再表示（合計2回まで）。
  // 記録は survey_id ごとに持つので、v1 に答えた人にも v2 は1回出る。
  var CHART_WANTED = [
    ["bgm", "BGM・効果音"], ["templates", "デザインのテンプレート"], ["samples", "すぐ使えるサンプルデータ集"],
    ["ai_data", "AIでデータを用意する手順"], ["long", "もっと長い動画"], ["other", "その他"]
  ];
  var QUICK_SURVEYS = {
    charts_v2: {
      head: "書き出しを待つあいだに、2問だけ教えてください",
      questions: function (opts) {
        var first = canUse("no_watermark")
          ? { key: "pain_point", label: "今回、いちばん手間取ったところは？", options: [
              ["data", "データの用意・入力"], ["design", "見た目の調整"], ["images", "画像（国旗・ロゴ）の設定"],
              ["export_time", "書き出しに時間がかかる"], ["none", "特になかった"]
            ] }
          : { key: "no_buy_reason", label: "有料プラン（透かしなし）にしなかった理由は？", options: [
              ["no_need", "透かしがあっても困らない"], ["price", "値段が高い"], ["one_time", "1回しか使わない"],
              ["unaware", "有料プランがあると知らなかった"], ["payment", "支払いが面倒・不安"], ["trying", "まだ試しているだけ"]
            ] };
        return [first, { key: "wanted_features", label: "次にほしい機能は？（いくつでも）", multi: true, options: opts.features || CHART_WANTED }];
      }
    },
    derby_v2: {
      head: "書き出しを待つあいだに、2問だけ教えてください",
      questions: [
        { key: "use_case", label: "何に使う動画ですか？", options: [
          ["event_work", "忘年会・社内イベント"], ["party", "結婚式・パーティー"], ["school", "学校・子ども会"],
          ["sns", "YouTube・SNS"], ["personal", "個人で楽しむ"], ["other", "その他"]
        ] },
        { key: "wanted_features", label: "次にほしい機能は？（いくつでも）", multi: true, options: [
          ["bgm", "BGM"], ["commentary", "実況の音声"], ["photo", "3Dの馬に画像追加"], ["results", "結果発表の演出を増やす"],
          ["more_horses", "出走頭数を増やす"], ["odds", "予想・オッズの表示"], ["other", "その他"]
        ] }
      ]
    }
  };

  function shouldShowFor(lsKey) {
    var s = lsGet(lsKey);
    if (!s) return true;
    if (s.status === "answered") return false;
    if ((s.dismissCount || 0) >= 2) return false;
    var exportsNow = lsGet(LS_EXPORTS) || 0;
    return exportsNow - (s.exportsAtDismiss || 0) >= 3;
  }
  function finishFor(lsKey, status) {
    var s = lsGet(lsKey) || {};
    if (status === "answered") { s.status = "answered"; s.answeredAt = Date.now(); }
    else {
      s.status = "dismissed";
      s.dismissCount = (s.dismissCount || 0) + 1;
      s.exportsAtDismiss = lsGet(LS_EXPORTS) || 0;
    }
    lsSet(lsKey, s);
  }

  function makeQuickSurvey(id) {
    var def = QUICK_SURVEYS[id];
    var lsKey = "grs_survey_" + id;
    function render(container, opts) {
      opts = opts || {};
      ensureStyles();
      var questions = typeof def.questions === "function" ? def.questions(opts) : def.questions;
      var hasMulti = questions.some(function (q) { return q.multi; });
      container.innerHTML =
        '<div class="grsp-survey grsp-quick">' +
          '<div class="grsp-survey-head"><b>' + esc(def.head) + '</b><span>' +
            (hasMulti ? "選んで送信するだけです。" : "タップするだけで送信されます。") + "答えなくても書き出しは止まりません。</span></div>" +
          questions.map(function (q) {
            return '<fieldset class="grsp-q" data-q="' + q.key + '"><legend>' + esc(q.label) + '</legend><div class="grsp-chips">' +
              q.options.map(function (o) {
                return '<label class="grsp-chip"><input type="' + (q.multi ? "checkbox" : "radio") + '" name="grspq_' + q.key + '" value="' + esc(o[0]) + '"><span>' + esc(o[1]) + "</span></label>";
              }).join("") + "</div></fieldset>";
          }).join("") +
          (hasMulti ? '<label class="grsp-q grsp-comment grsp-other" hidden><span>どんな機能ですか？（任意）</span><input type="text" maxlength="60" placeholder="ひとことで教えてください"></label>' : "") +
          '<div class="grsp-actions"><button type="button" class="grsp-btn grsp-ghost grsp-skip" id="grspSkipBtn">今回はスキップ</button>' +
            (hasMulti ? '<button type="button" class="grsp-btn grsp-primary grsp-submit" id="grspSubmitBtn" disabled>送信する</button>' : "") +
          "</div>" +
        "</div>";
      var root = container.querySelector(".grsp-survey");
      var submitBtn = root.querySelector(".grsp-submit");
      var otherBox = root.querySelector(".grsp-other");
      var sent = false;
      // 全問答えていれば { survey_id, 質問key: 値 } を返す（複数選択はカンマ区切り）。未回答があれば null
      function collect() {
        var p = { survey_id: id };
        for (var i = 0; i < questions.length; i++) {
          var q = questions[i];
          var vals = Array.prototype.map.call(root.querySelectorAll('[data-q="' + q.key + '"] input:checked'), function (el) { return el.value; });
          if (!vals.length) return null;
          p[q.key] = vals.join(",");
        }
        return p;
      }
      function send(p) {
        if (sent || !p) return;
        sent = true;
        if (otherBox && !otherBox.hidden) {
          var comment = otherBox.querySelector("input").value.replace(/\s+/g, " ").trim().slice(0, 60);
          if (comment) p.survey_comment = comment;
        }
        var ctx = opts.context || {};
        for (var k in ctx) if (p[k] === undefined) p[k] = ctx[k];
        track("survey_submit", p);
        root.innerHTML = '<p class="grsp-thanks">ご協力ありがとうございました！</p>';
        finishFor(lsKey, "answered");
        if (opts.onDone) opts.onDone("answered");
      }
      root.addEventListener("change", function () {
        if (sent) return;
        // 複数選択の質問で「その他」を選んだら、1行の入力欄を出す
        if (otherBox) otherBox.hidden = !root.querySelector('input[type="checkbox"][value="other"]:checked');
        var p = collect();
        if (submitBtn) submitBtn.disabled = !p;
        else send(p);
      });
      if (submitBtn) submitBtn.addEventListener("click", function () { send(collect()); });
      root.querySelector(".grsp-skip").addEventListener("click", function () {
        track("survey_dismiss", { survey_id: id });
        container.innerHTML = "";
        finishFor(lsKey, "dismissed");
        if (opts.onDone) opts.onDone("dismissed");
      });
      track("survey_view", { survey_id: id });
    }
    return { id: id, shouldShow: function () { return shouldShowFor(lsKey); }, render: render };
  }
  var SURVEYS = {};
  for (var qid in QUICK_SURVEYS) SURVEYS[qid] = makeQuickSurvey(qid);

  // ── 見た目 ───────────────────────────────────────────
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  var stylesAdded = false;
  function ensureStyles() {
    if (stylesAdded) return;
    stylesAdded = true;
    var css =
      ".grsp-backdrop{position:fixed;inset:0;z-index:6000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.62);padding:16px}" +
      ".grsp-modal{width:min(440px,100%);background:#fff;color:#1b1f27;border-radius:10px;padding:22px;box-shadow:0 18px 60px rgba(0,0,0,.45);font-size:14px;line-height:1.6}" +
      ".grsp-modal h3{margin:0 0 10px;font-size:17px}.grsp-modal p{margin:0 0 10px;color:#444}" +
      ".grsp-price{font-size:20px;font-weight:700;color:#1b1f27!important}" +
      ".grsp-btn{display:inline-flex;align-items:center;justify-content:center;width:auto;min-width:96px;margin:0;padding:10px 14px;border:none;border-radius:6px;font-weight:700;font-size:14px;cursor:pointer;text-decoration:none}" +
      ".grsp-primary{background:var(--accent,#6E62F0);color:#fff}.grsp-primary:disabled{background:#c9c9d6;color:#fff;cursor:not-allowed}" +
      ".grsp-ghost{background:#eceef3;color:#333}" +
      ".grsp-cta{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}" +
      ".grsp-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:12px}" +
      ".grsp-license{margin-top:12px}.grsp-license summary{cursor:pointer;color:#555}" +
      ".grsp-row{display:flex;gap:8px;margin-top:8px}.grsp-input{flex:1;min-width:0;padding:9px 10px;border:1px solid #cfd4dc;border-radius:6px;font-size:14px}" +
      ".grsp-msg{min-height:1.4em;font-size:12px;margin:6px 0 0!important}" +
      ".grsp-survey{color:#1b1f27;font-size:13px;line-height:1.5}" +
      ".grsp-survey-head{display:flex;flex-direction:column;gap:2px;margin-bottom:10px}.grsp-survey-head span{color:#666;font-size:12px}" +
      ".grsp-q{border:none;margin:0 0 10px;padding:0;display:block}.grsp-q legend,.grsp-comment>span{font-weight:700;margin-bottom:6px;padding:0;display:block}" +
      ".grsp-chips{display:flex;flex-wrap:wrap;gap:6px}" +
      ".grsp-chip{position:relative;display:inline-flex;cursor:pointer;user-select:none;margin:0;padding:0;font-weight:400}" +
      ".grsp-chip input{position:absolute;opacity:0;pointer-events:none}" +
      ".grsp-chip span{padding:6px 10px;border:1px solid #d3d8e0;border-radius:999px;background:#fff;color:#333;font-size:12.5px;transition:.15s}" +
      ".grsp-chip input:checked+span{background:var(--accent,#6E62F0);border-color:var(--accent,#6E62F0);color:#fff}" +
      ".grsp-chip input:focus-visible+span{outline:2px solid var(--accent,#6E62F0);outline-offset:2px}" +
      ".grsp-chip.is-disabled span{opacity:.4;cursor:not-allowed}" +
      ".grsp-other[hidden]{display:none}.grsp-comment input,.grsp-comment textarea{width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid #d3d8e0;border-radius:6px;font:inherit;resize:vertical}" +
      ".grsp-thanks{margin:8px 0;font-weight:700;color:#16794c}" +
      ".grsp-modal,.grsp-modal *,.grsp-survey,.grsp-survey *{text-transform:none;letter-spacing:normal}";
    var el = document.createElement("style");
    el.textContent = css;
    document.head.appendChild(el);
  }

  window.GRSPlan = {
    config: CONFIG,
    features: FEATURES,
    isPro: isPro,
    canUse: canUse,
    badgeText: badgeText,
    openUpgrade: openUpgrade,
    gate: gate,
    lockedOf: lockedOf,
    activateLicense: activateLicense,
    countExport: countExport,
    survey: SURVEYS.charts_v2, // surveyId を指定しないツール（グラフ3ツール）が使う
    surveys: SURVEYS,
    esc: esc
  };
})();
