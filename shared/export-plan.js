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
 *     ライセンスが無い人は有料機能を選べない。選ぶと購入案内（upgrade_click）を出す。
 *     ライセンスの確認は CONFIG.licenseEndpoint に POST する（Lemon Squeezy の
 *     license-keys/validate を中継するサーバー側の口。未実装なら空のままにしておく）。
 *
 * ── アンケート（pricing_v1）──────────────────────────────
 *   書き出しのエンコード待ちの間に出す。1ブラウザにつき回答は1回。
 *   スキップした人には、そのあと3回書き出したら1回だけもう一度出す（合計2回まで）。
 *   送るイベント:
 *     survey_view     アンケートを表示した（回答率の分母）
 *     survey_submit   回答した  survey_id / use_case / wanted_features / pay_model / survey_comment
 *     survey_dismiss  スキップした
 *   値はすべて英語のコード（下の SURVEY の value）。カンマ区切りで複数選択を表す。
 */
(function () {
  "use strict";
  if (window.GRSPlan) return;

  var CONFIG = {
    paywallEnabled: false,
    // 販売ページ（Lemon Squeezy のチェックアウトURL）。販売開始時に入れる
    buyUrl: "",
    priceLabel: "¥1,980（買い切り）",
    // ライセンス確認のサーバー側エンドポイント（例 "/api/license/validate"）。未実装なら空
    licenseEndpoint: "",
    // ライセンスを一度確認したら、次に確認しなおすまでの日数
    licenseRecheckDays: 7
  };

  // 有料予定の機能と表示名
  var FEATURES = {
    hd_max: "最高画質",
    no_watermark: "透かしなし"
  };

  var LS_LICENSE = "grs_license_v1";
  var LS_SURVEY = "grs_survey_pricing_v1";
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
  function openUpgrade(feature, opts) {
    opts = opts || {};
    track("upgrade_click", { plan: "lifetime", plan_feature: feature, upgrade_from: opts.from || "export_dialog" });
    ensureStyles();
    var back = document.createElement("div");
    back.className = "grsp-backdrop";
    back.innerHTML =
      '<div class="grsp-modal" role="dialog" aria-modal="true" aria-labelledby="grspUpTitle">' +
        '<h3 id="grspUpTitle">' + esc(FEATURES[feature] || "この機能") + 'は有料ライセンスで使えます</h3>' +
        '<p>透かしなし・最高画質の書き出しが、バーチャートレース・線グラフレース・競馬風ランキングの全ツールで使えます。</p>' +
        '<p class="grsp-price">' + esc(CONFIG.priceLabel) + '</p>' +
        (CONFIG.buyUrl ? '<a class="grsp-btn grsp-primary" target="_blank" rel="noopener" href="' + esc(CONFIG.buyUrl) + '" data-track="upgrade_click" data-track-plan="lifetime" data-track-upgrade-from="buy_button">購入ページへ</a>' : "") +
        '<details class="grsp-license"><summary>ライセンスキーをお持ちの方</summary>' +
          '<div class="grsp-row"><input type="text" class="grsp-input" placeholder="XXXX-XXXX-XXXX-XXXX" autocomplete="off">' +
          '<button type="button" class="grsp-btn grsp-primary grsp-activate">有効にする</button></div>' +
          '<p class="grsp-msg" aria-live="polite"></p>' +
        '</details>' +
        '<div class="grsp-actions"><button type="button" class="grsp-btn grsp-ghost grsp-close">閉じる</button></div>' +
      '</div>';
    document.body.appendChild(back);
    function close(result) {
      back.remove();
      if (opts.onClose) opts.onClose(!!result);
    }
    back.querySelector(".grsp-close").addEventListener("click", function () { close(false); });
    back.addEventListener("click", function (e) { if (e.target === back) close(false); });
    back.querySelector(".grsp-activate").addEventListener("click", async function () {
      var msg = back.querySelector(".grsp-msg");
      msg.textContent = "確認中…";
      var r = await activateLicense(back.querySelector(".grsp-input").value);
      if (r.ok) { msg.textContent = "有効になりました"; setTimeout(function () { close(true); }, 600); }
      else msg.textContent = r.message;
    });
  }

  // ── アンケート ─────────────────────────────────────────
  var SURVEY_ID = "pricing_v1";
  var SURVEY = {
    useCase: {
      label: "何に使う動画ですか？（いくつでも）",
      multi: true,
      options: [
        ["youtube", "YouTube（通常の動画）"],
        ["shorts", "ショート・リール・TikTok"],
        ["x", "X（旧Twitter）"],
        ["work", "仕事の資料・プレゼン"],
        ["school", "授業・教材"],
        ["blog", "ブログ・Web記事"],
        ["personal", "個人で楽しむ"],
        ["other", "その他"]
      ]
    },
    features: {
      label: "あったら嬉しいものは？（3つまで）",
      multi: true,
      max: 3,
      options: [
        ["hd", "フルHD・4Kの高画質"],
        ["bgm", "BGM・効果音"],
        ["templates", "デザインのテンプレート"],
        ["datasets", "人口・GDPなどのデータ収録"],
        ["long", "長い動画（数分以上）"],
        ["other", "その他"]
      ]
    },
    payModel: {
      label: "透かしを消して高画質で書き出せる有料版があったら、いちばん近いのは？",
      multi: false,
      options: [
        ["lifetime", "買い切り（約2,000円）なら買いたい"],
        ["pass7", "必要なときだけ使える短期パス（数百円）がいい"],
        ["monthly", "月額でも使いたい"],
        ["none", "無料版で十分"]
      ]
    }
  };

  function countExport() {
    var n = (lsGet(LS_EXPORTS) || 0) + 1;
    lsSet(LS_EXPORTS, n);
    return n;
  }

  function shouldShowSurvey() {
    var s = lsGet(LS_SURVEY);
    if (!s) return true;
    if (s.status === "answered") return false;
    if ((s.dismissCount || 0) >= 2) return false;
    var exportsNow = lsGet(LS_EXPORTS) || 0;
    return exportsNow - (s.exportsAtDismiss || 0) >= 3;
  }

  /*
   * container の中にアンケートを描く。
   *   opts.features   … SURVEY.features.options の差し替え（ツールごとに欲しい機能が違うとき）
   *   opts.context    … survey_submit に一緒に送る値（export_format など）
   *   opts.onDone(status) … "answered" | "dismissed"
   */
  function renderSurvey(container, opts) {
    opts = opts || {};
    ensureStyles();
    var featureOptions = opts.features || SURVEY.features.options;
    var answers = { useCase: [], features: [], payModel: "" };

    function group(key, def, options) {
      var type = def.multi ? "checkbox" : "radio";
      return '<fieldset class="grsp-q" data-q="' + key + '"><legend>' + esc(def.label) + "</legend>" +
        '<div class="grsp-chips">' + options.map(function (o) {
          return '<label class="grsp-chip"><input type="' + type + '" name="grsp_' + key + '" value="' + esc(o[0]) + '"><span>' + esc(o[1]) + "</span></label>";
        }).join("") + "</div></fieldset>";
    }

    container.innerHTML =
      '<div class="grsp-survey">' +
        '<div class="grsp-survey-head"><b>書き出しを待つあいだに、30秒アンケートにご協力ください</b>' +
        '<span>今後の機能と料金の参考にします。答えなくても書き出しは止まりません。</span></div>' +
        group("useCase", SURVEY.useCase, SURVEY.useCase.options) +
        group("features", SURVEY.features, featureOptions) +
        group("payModel", SURVEY.payModel, SURVEY.payModel.options) +
        '<label class="grsp-q grsp-comment"><span>ほかにご意見があれば（任意・100文字まで）</span>' +
          '<textarea maxlength="100" rows="2" placeholder="例）縦向きの棒グラフがほしい"></textarea></label>' +
        '<div class="grsp-actions">' +
          '<button type="button" class="grsp-btn grsp-ghost grsp-skip" id="grspSkipBtn">今回はスキップ</button>' +
          '<button type="button" class="grsp-btn grsp-primary grsp-submit" id="grspSubmitBtn" disabled>送信する</button>' +
        "</div>" +
      "</div>";

    var root = container.querySelector(".grsp-survey");
    var submitBtn = root.querySelector(".grsp-submit");

    function read() {
      answers.useCase = values("useCase");
      answers.features = values("features");
      answers.payModel = values("payModel")[0] || "";
    }
    function values(key) {
      return Array.prototype.map.call(root.querySelectorAll('[data-q="' + key + '"] input:checked'), function (i) { return i.value; });
    }
    function sync() {
      read();
      // 欲しい機能は3つまで。上限に達したら残りを押せなくする
      var max = SURVEY.features.max;
      root.querySelectorAll('[data-q="features"] input').forEach(function (i) {
        i.disabled = !i.checked && answers.features.length >= max;
        i.parentNode.classList.toggle("is-disabled", i.disabled);
      });
      // 最低限「有料版」の質問まで答えたら送れる（料金の判断に要る項目）
      submitBtn.disabled = !answers.payModel;
    }
    root.addEventListener("change", sync);
    sync();

    function finish(status) {
      var s = lsGet(LS_SURVEY) || {};
      if (status === "answered") {
        s.status = "answered";
        s.answeredAt = Date.now();
      } else {
        s.status = "dismissed";
        s.dismissCount = (s.dismissCount || 0) + 1;
        s.exportsAtDismiss = lsGet(LS_EXPORTS) || 0;
      }
      lsSet(LS_SURVEY, s);
      if (opts.onDone) opts.onDone(status);
    }

    submitBtn.addEventListener("click", function () {
      read();
      var comment = root.querySelector("textarea").value.replace(/\s+/g, " ").trim().slice(0, 100);
      var p = {
        survey_id: SURVEY_ID,
        use_case: answers.useCase.join(",") || "(none)",
        wanted_features: answers.features.join(",") || "(none)",
        pay_model: answers.payModel,
        survey_comment: comment || undefined
      };
      var ctx = opts.context || {};
      for (var k in ctx) if (p[k] === undefined) p[k] = ctx[k];
      track("survey_submit", p);
      root.innerHTML = '<p class="grsp-thanks">ご協力ありがとうございました！</p>';
      finish("answered");
    });
    root.querySelector(".grsp-skip").addEventListener("click", function () {
      track("survey_dismiss", { survey_id: SURVEY_ID });
      container.innerHTML = "";
      finish("dismissed");
    });

    track("survey_view", { survey_id: SURVEY_ID });
  }

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
      ".grsp-comment textarea{width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid #d3d8e0;border-radius:6px;font:inherit;resize:vertical}" +
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
    activateLicense: activateLicense,
    countExport: countExport,
    survey: { id: SURVEY_ID, shouldShow: shouldShowSurvey, render: renderSurvey },
    esc: esc
  };
})();
