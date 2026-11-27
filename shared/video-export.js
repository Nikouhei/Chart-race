/*!
 * video-export.js — SVG / HTML で描いているツールの動画書き出し（WebM / MP4 / 透過MOV / PNG連番）
 *
 * バーチャートレース・線グラフレースは d3 で SVG に描き、タイトル・年号・凡例は HTML。
 * canvas ではないので、競馬ツールのように captureStream で録画することはできない。
 * そこで書き出し中は「時刻を1フレームずつ進める → DOM をその時刻の絵にする →
 * canvas に描き写す → WebCodecs でエンコード」を繰り返す。実時間で録画しないので、
 * PC が遅くてもコマ落ちせず、プレビューと同じ動きの動画になる。
 *
 * ── 使い方（ツール側）────────────────────────────────────
 *   <script src="../../shared/export-plan.js?v=..." defer></script>
 *   <script src="../../shared/video-export.js?v=..." defer></script>
 *   GRSVideoExport.attach({
 *     button: document.getElementById('exportVideoBtn'),
 *     fileBase: 'bar-chart-race',
 *     adapter: {
 *       isReady()            データがあり書き出せるか
 *       getStage()           描き写す要素（#chartArea）
 *       getSize()            { width, height } キャンバスの論理サイズ（px）
 *       getDurationMs()      アニメーションの長さ（最後の静止は含めない）
 *       beginExport(opts)    再生を止め、書き出し用の状態にする（Promise 可）。
 *                            opts = { watermark, fps, size }
 *       renderAt(tMs, dtMs)  DOM を時刻 tMs の絵にする。dtMs は前フレームからの経過
 *       endExport()          元のプレビューに戻す
 *       paintFrame(ctx, w, h, opts)  （任意）canvas で描くツール用。今の絵を ctx に w×h で描く。
 *                            これがあると DOM の描き写し（Painter）は使わない。
 *                            opts.preview=true は設定画面の見本用（opts.watermark で透かしの有無）
 *       ownWatermark         （任意）true ならツールが自分で透かしを描く。共通の透かしは重ねず、
 *                            有無は beginExport(opts).watermark で渡す
 *       getAudio(sec, rate)  （任意）動画に入れる音。長さ sec 秒・サンプルレート rate の
 *                            AudioBuffer（Promise 可）を返す。null なら音なし。
 *                            MP4 は AAC（無理なら Opus）、WebM は Opus でエンコードする。
 *                            ブラウザが音声のエンコードに対応していなければ、音なしで書き出す
 *     },
 *     scales: [1]            （任意）選べる画質。1つだけなら画質の欄を出さない（既定 [0.75, 1.5]）
 *     paidScales: [1.5]      （任意）有料の画質。既定は scales 未指定なら [1.5]、指定ありなら []
 *     fpsOptions: [30]       （任意）選べる fps。1つだけなら欄を出さない（既定 [30, 60]）
 *     previewMark: false     （任意）プレビューに共通の透かしを重ねない
 *     surveyId: "derby_v2"   （任意）書き出し中に出すアンケート（GRSPlan.surveys のキー）
 *     free: true             （任意）無料ツール（ランキング動画）。透かしの欄を出さず常に透かしなし、
 *                            課金判定・プランの状態表示もしない。export-plan.js はアンケートのためだけに読む
 *     defaultWatermark()     （任意）透かしの初期値 "on" / "off"。null なら前回の選択
 *     trackParams()          （任意）書き出すボタンの計測に足すパラメータ { 名前: 値 }
 *   });
 *
 * ── 描き写せるもの ──────────────────────────────────────
 *   HTML: 背景色・背景画像（cover）・角丸・テキスト（折り返し含む）・-webkit-text-stroke（文字の後ろに描く）・
 *         <img>（object-fit: fill / contain / cover）・overflow: hidden の切り抜き（角丸込み）・
 *         transform / opacity（getBoundingClientRect の位置で描くので、移動・拡大は反映される）
 *   SVG : g / rect / circle / ellipse / line / path / polyline / polygon / text(+tspan) / image
 *         塗り・線・破線・不透明度・transform・preserveAspectRatio・
 *         CSS clip-path の circle() / inset(... round ...)
 *   グラデーション・フィルター・マスクは描かない（今のツールでは使っていない）。
 *   外部画像は CORS を許可しているサーバーのものだけ動画に入る（flagcdn は可）。
 *   許可していない画像は動画から抜け、完了画面でその件数を知らせる。
 *
 * ── 透過 ───────────────────────────────────────────────
 *   ステージに .grs-transparent が付いていると背景を塗らず、形式の選択肢が次の3つに替わる。
 *   MP4 に透過は無いので出さない。
 *     透過MOV（おすすめ）… 'png '。1コマずつの透過PNGをそのまま MOV に入れる。iMovie だけ読めない
 *     透過MOV（iMovie用）… QuickTime Animation（'rle '・32bit ARGB）。PowerDirector だけ読めない。
 *                Premiere は差分フレームありの Animation を読めないので、全フレームをキーフレームにする
 *     PNG連番  … 透過PNGを無圧縮の ZIP にまとめる
 *   2つの MOV は弱点が重ならないので両方を出す。ブラウザのエンコーダーは ProRes を作れず、
 *   透過WebM は実機の編集ソフトでほとんど透過しなかったので出さない。
 *   MOV の構造は、9本の編集ソフトで確認した ffmpeg の出力と同じにしている（qtMoov の注）。
 *   export_format は mov_png_alpha / mov_animation_alpha / png_sequence になる。
 *
 * 計測: 書き出すボタンは data-track="export_start"（export_format / watermark /
 *       export_scale / export_fps を付ける）。保存は a.click() なので export_complete は自動。
 *       失敗は js_error（error_source=video-export）で送る。
 */
(function () {
  "use strict";
  if (window.GRSVideoExport) return;

  var SCRIPT_SRC = (document.currentScript && document.currentScript.src) || "";
  var SHARED_BASE = SCRIPT_SRC ? SCRIPT_SRC.replace(/[^/]*$/, "") : "/shared/";
  var VENDOR = {
    mp4: SHARED_BASE + "vendor/mp4-muxer-5.2.2.js",
    webm: SHARED_BASE + "vendor/webm-muxer-5.1.4-alpha.js"
  };
  var LOGO_URL = SHARED_BASE + "../Logo/GraphRace_Studio_Logo.png";

  // 動画の上限（長辺）。H.264 のハードウェアエンコーダは 4096 前後が上限の機種が多い
  var MAX_LONG_SIDE = 3840;
  var MAX_SHORT_SIDE = 2160;

  function track(name, params) {
    try { if (typeof window.grsTrack === "function") window.grsTrack(name, params || {}); } catch (e) {}
  }
  function plan() { return window.GRSPlan; }
  // 計測用: 画面サイズ → アスペクト比のラベル（プリセットに近ければその名前、そうでなければ custom）
  function aspectLabel(w, h) {
    if (!w || !h) return "unknown";
    var r = w / h, list = [["1:1", 1], ["9:16", 9 / 16], ["16:9", 16 / 9], ["3:4", 3 / 4], ["4:3", 4 / 3]];
    for (var i = 0; i < list.length; i++) if (Math.abs(r - list[i][1]) / list[i][1] < 0.01) return list[i][0];
    return "custom";
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // 裏タブでも止まらない「次のタスクまで待つ」。setTimeout は裏タブで1秒に1回まで絞られる
  var yieldChannel = null, yieldQueue = [];
  function yieldTask() {
    if (!yieldChannel) {
      yieldChannel = new MessageChannel();
      yieldChannel.port1.onmessage = function () { var r = yieldQueue.shift(); if (r) r(); };
    }
    return new Promise(function (res) { yieldQueue.push(res); yieldChannel.port2.postMessage(0); });
  }

  var scriptPromises = {};
  function loadScript(url) {
    if (!scriptPromises[url]) {
      scriptPromises[url] = new Promise(function (res, rej) {
        var s = document.createElement("script");
        s.src = url;
        s.onload = res;
        s.onerror = function () { delete scriptPromises[url]; rej(new Error("ライブラリを読み込めませんでした")); };
        document.head.appendChild(s);
      });
    }
    return scriptPromises[url];
  }

  // ════════════════════════════════════════════════════════
  //  画像の読み込み（canvas を汚さないよう CORS 付きで読む）
  // ════════════════════════════════════════════════════════
  var imgCache = new Map(); // 絶対URL → { state:'loading'|'ok'|'fail', img, promise }

  function absUrl(href) {
    try { return new URL(href, document.baseURI).href; } catch (e) { return href; }
  }

  function loadImageOnce(url, bust) {
    return new Promise(function (res) {
      var img = new Image();
      var isInline = /^(data|blob):/i.test(url);
      if (!isInline) img.crossOrigin = "anonymous";
      var timer = setTimeout(function () { res(null); }, 12000);
      img.onload = function () {
        clearTimeout(timer);
        (img.decode ? img.decode().catch(function () {}) : Promise.resolve()).then(function () { res(img); });
      };
      img.onerror = function () { clearTimeout(timer); res(null); };
      img.src = bust && !isInline ? url + (url.indexOf("?") >= 0 ? "&" : "?") + "grsx=1" : url;
    });
  }

  function proxyUrl(url) {
    try {
      var u = new URL(url);
      if (!/^https?:$/.test(u.protocol) || u.origin === location.origin) return "";
      if (location.protocol === "file:") return "";
      return location.origin + "/api/img?url=" + encodeURIComponent(u.href);
    } catch (e) { return ""; }
  }

  function loadImage(href) {
    var url = absUrl(href);
    var ent = imgCache.get(url);
    if (ent) return ent.promise;
    ent = { state: "loading", img: null, promise: null };
    imgCache.set(url, ent);
    ent.promise = loadImageOnce(url, false).then(function (img) {
      // プレビューが CORS なしで読んだ応答がキャッシュに残っていると失敗することがあるので、URLを変えて1回だけ再挑戦
      return img || loadImageOnce(url, true);
    }).then(function (img) {
      // 配信元が CORS を許可していない画像は、自サイトの Worker（/api/img）経由で取り直す
      return img || (proxyUrl(url) ? loadImageOnce(proxyUrl(url), false) : null);
    }).then(function (img) {
      ent.img = img;
      ent.state = img ? "ok" : "fail";
      return ent;
    });
    return ent.promise;
  }

  function cssUrl(value) {
    var m = /url\(\s*(['"]?)(.*?)\1\s*\)/.exec(value || "");
    return m ? m[2] : "";
  }
  function svgHref(el) {
    return el.getAttribute("href") || el.getAttributeNS("http://www.w3.org/1999/xlink", "href") || "";
  }

  // ステージ内の画像で、まだ読んでいないものを読み終えるまで待つ
  function ensureImages(stage) {
    var pending = [];
    var imgs = stage.querySelectorAll("image");
    for (var i = 0; i < imgs.length; i++) {
      var h = svgHref(imgs[i]);
      if (h && !imgCache.has(absUrl(h))) pending.push(loadImage(h));
    }
    var htmlImgs = stage.querySelectorAll("img");
    for (var j = 0; j < htmlImgs.length; j++) {
      var src = htmlImgs[j].currentSrc || htmlImgs[j].src;
      if (src && !imgCache.has(absUrl(src))) pending.push(loadImage(src));
    }
    var bg = cssUrl(getComputedStyle(stage).backgroundImage);
    if (bg && !imgCache.has(absUrl(bg))) pending.push(loadImage(bg));
    return pending.length ? Promise.all(pending) : null;
  }

  function failedImageCount() {
    var n = 0;
    imgCache.forEach(function (e) { if (e.state === "fail") n++; });
    return n;
  }

  // ════════════════════════════════════════════════════════
  //  DOM → canvas
  // ════════════════════════════════════════════════════════
  function num(v, d) { var n = parseFloat(v); return Number.isFinite(n) ? n : d; }
  function isTransparent(c) {
    return !c || c === "transparent" || /^rgba\(.*,\s*0(\.0+)?\)$/.test(c);
  }
  // 背景「透過」のステージか（ツールが applyLayoutAppearance で付ける）
  function isAlphaStage(stage) { return !!(stage && stage.classList && stage.classList.contains("grs-transparent")); }
  function fontOf(cs) {
    return (cs.fontStyle || "normal") + " " + (cs.fontWeight || "400") + " " + (cs.fontSize || "16px") + " " + (cs.fontFamily || "sans-serif");
  }
  function colorOf(paint, cs) {
    if (!paint || paint === "none" || /^url\(/.test(paint)) return null;
    if (/^currentcolor$/i.test(paint)) return cs.color;
    return paint;
  }
  // text-shadow / filter: drop-shadow() の先頭1つ（計算済みの値）を {color, x, y, blur} にする
  function parseShadow(v) {
    var s = String(v || "");
    var m = /(rgba?\([^)]*\))\s+(-?[\d.]+)px\s+(-?[\d.]+)px(?:\s+([\d.]+)px)?/i.exec(s) ||
      /(-?[\d.]+)px\s+(-?[\d.]+)px(?:\s+([\d.]+)px)?\s+(rgba?\([^)]*\))/i.exec(s);
    if (!m) return null;
    return /^rgb/i.test(m[1])
      ? { color: m[1], x: num(m[2], 0), y: num(m[3], 0), blur: num(m[4], 0) }
      : { color: m[4], x: num(m[1], 0), y: num(m[2], 0), blur: num(m[3], 0) };
  }
  // 文字の影だけを描く。canvas は影の元の絵も描いてしまうので、元の絵を画面の外へ逃がして影だけ画面内に落とす
  // （draw は、文字の形を塗りつぶしで描くだけの関数。色は呼び出し側で決めない）
  function paintTextShadow(ctx, sh, alpha, draw) {
    if (!sh) return;
    var FAR = 20000;
    var m = ctx.getTransform();
    var k = Math.hypot(m.a, m.b);
    ctx.save();
    ctx.setTransform(m.a, m.b, m.c, m.d, m.e - FAR, m.f);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = ctx.strokeStyle = "#000";
    ctx.shadowColor = sh.color;
    ctx.shadowBlur = sh.blur * k;
    ctx.shadowOffsetX = FAR + sh.x * k;
    ctx.shadowOffsetY = sh.y * k;
    draw();
    ctx.restore();
  }
  function parseDash(v) {
    if (!v || v === "none") return [];
    var parts = String(v).split(/[\s,]+/).map(function (x) { return num(x, 0); });
    return parts.some(function (x) { return x > 0; }) ? parts : [];
  }
  function lenAttr(el, name, cs) {
    var raw = el.getAttribute(name);
    if (raw == null || raw === "") return 0;
    var first = String(raw).trim().split(/[\s,]+/)[0];
    if (/em$/.test(first)) return num(first, 0) * num(cs.fontSize, 16);
    if (/%$/.test(first)) return 0;
    return num(first, 0);
  }
  function roundRectPath(x, y, w, h, rx, ry) {
    var p = new Path2D();
    rx = Math.max(0, Math.min(rx, w / 2));
    ry = Math.max(0, Math.min(ry == null ? rx : ry, h / 2));
    if (!rx || !ry) { p.rect(x, y, w, h); return p; }
    p.moveTo(x + rx, y);
    p.lineTo(x + w - rx, y);
    p.ellipse(x + w - rx, y + ry, rx, ry, 0, -Math.PI / 2, 0);
    p.lineTo(x + w, y + h - ry);
    p.ellipse(x + w - rx, y + h - ry, rx, ry, 0, 0, Math.PI / 2);
    p.lineTo(x + rx, y + h);
    p.ellipse(x + rx, y + h - ry, rx, ry, 0, Math.PI / 2, Math.PI);
    p.lineTo(x, y + ry);
    p.ellipse(x + rx, y + ry, rx, ry, 0, Math.PI, Math.PI * 1.5);
    p.closePath();
    return p;
  }

  // CSS clip-path（circle / inset）を、要素の箱 (x,y,w,h) に対するパスにする
  function clipPathFor(value, x, y, w, h) {
    if (!value || value === "none") return null;
    var m = /^circle\(\s*([\d.]+)(%|px)?(?:\s+at\s+([\d.]+)(%|px)?\s+([\d.]+)(%|px)?)?\s*\)/.exec(value);
    if (m) {
      var ref = Math.sqrt(w * w + h * h) / Math.SQRT2;
      var r = m[2] === "px" ? num(m[1], 0) : ref * num(m[1], 50) / 100;
      var cx = m[3] == null ? x + w / 2 : (m[4] === "px" ? x + num(m[3], 0) : x + w * num(m[3], 50) / 100);
      var cy = m[5] == null ? y + h / 2 : (m[6] === "px" ? y + num(m[5], 0) : y + h * num(m[5], 50) / 100);
      var p = new Path2D();
      p.arc(cx, cy, r, 0, Math.PI * 2);
      return p;
    }
    m = /^inset\(\s*([^)]*?)\s*\)/.exec(value);
    if (m) {
      var body = m[1].split(/\s+round\s+/);
      var off = body[0].trim().split(/\s+/).map(function (t) { return /%$/.test(t) ? num(t, 0) / 100 : num(t, 0); });
      var o = off[0] || 0;
      var inset = function (v, size) { return v < 1 && /%/.test(body[0]) ? size * v : v; };
      var ix = inset(o, w), iy = inset(o, h);
      var rad = body[1] ? num(body[1], 0) : 0;
      return roundRectPath(x + ix, y + iy, w - ix * 2, h - iy * 2, rad);
    }
    return null;
  }

  function Painter(ctx, stage, outW) {
    this.ctx = ctx;
    this.stage = stage;
    this.W = stage.offsetWidth;
    this.H = stage.offsetHeight;
    this.S = outW / this.W;
  }

  Painter.prototype.local = function (r) {
    return { x: (r.left - this.sr.left) / this.k, y: (r.top - this.sr.top) / this.k, w: r.width / this.k, h: r.height / this.k };
  };

  Painter.prototype.paint = function () {
    var ctx = this.ctx, stage = this.stage;
    this.sr = stage.getBoundingClientRect();
    if (!this.sr.width || !this.W) throw new Error("プレビューが画面に表示されていないため書き出せません");
    this.k = this.sr.width / this.W;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    if (isAlphaStage(stage)) {
      ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    } else {
      // MP4 などに透明は無いので、ステージが透明なら「プレビューで後ろに見えている色」で塗る
      var bg = "#ffffff";
      for (var el = stage; el && el.nodeType === 1; el = el.parentElement) {
        var c = getComputedStyle(el).backgroundColor;
        if (!isTransparent(c)) { bg = c; break; }
      }
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    }
    this.paintHtml(stage, 1, true);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
  };

  Painter.prototype.base = function () { var S = this.S; this.ctx.setTransform(S, 0, 0, S, 0, 0); };

  Painter.prototype.paintBox = function (el, cs, alpha) {
    var ctx = this.ctx;
    var hasColor = !isTransparent(cs.backgroundColor);
    var bgUrl = cssUrl(cs.backgroundImage);
    if (!hasColor && !bgUrl) return;
    var L = this.local(el.getBoundingClientRect());
    if (L.w <= 0 || L.h <= 0) return;
    var rad = num(cs.borderTopLeftRadius, 0);
    var path = roundRectPath(L.x, L.y, L.w, L.h, rad);
    this.base();
    ctx.globalAlpha = alpha;
    if (hasColor) { ctx.fillStyle = cs.backgroundColor; ctx.fill(path); }
    if (bgUrl) {
      var ent = imgCache.get(absUrl(bgUrl));
      if (ent && ent.state === "ok") {
        var img = ent.img, iw = img.naturalWidth, ih = img.naturalHeight;
        var mode = cs.backgroundSize;
        var s = mode === "contain" ? Math.min(L.w / iw, L.h / ih) : Math.max(L.w / iw, L.h / ih);
        var dw = iw * s, dh = ih * s;
        ctx.save();
        ctx.clip(path);
        ctx.drawImage(img, L.x + (L.w - dw) / 2, L.y + (L.h - dh) / 2, dw, dh);
        ctx.restore();
      }
    }
  };

  Painter.prototype.paintHtml = function (el, alpha, isRoot) {
    var cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") return;
    var a = alpha * num(cs.opacity, 1);
    if (a <= 0.002) return;
    this.paintBox(el, cs, a);

    // 重なり順: 位置指定なしの子 → 位置指定ありの子（z-index 順）
    var flow = [], positioned = [];
    var nodes = el.childNodes;
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      if (n.nodeType === 3) { flow.push(n); continue; }
      if (n.nodeType !== 1) continue;
      if (n.getAttribute("data-grs-skip") != null) continue; // プレビュー用の透かしなど、動画に描かないもの
      var ccs = getComputedStyle(n);
      if (ccs.position !== "static") positioned.push({ n: n, z: ccs.zIndex === "auto" ? 0 : num(ccs.zIndex, 0), i: i });
      else flow.push(n);
    }
    positioned.sort(function (p, q) { return p.z - q.z || p.i - q.i; });
    var self = this;
    // overflow: hidden の要素は、子をその箱（角丸込み）で切り抜く。ステージ自体は書き出しの枠で切れるので除く
    var clip = !isRoot && (cs.overflowX !== "visible" || cs.overflowY !== "visible");
    if (clip) {
      var B = this.local(el.getBoundingClientRect());
      if (B.w <= 0 || B.h <= 0) return;
      this.ctx.save();
      this.base();
      this.ctx.clip(roundRectPath(B.x, B.y, B.w, B.h, num(cs.borderTopLeftRadius, 0)));
    }
    var draw = function (n) {
      if (n.nodeType === 3) self.paintText(n, cs, a);
      else if (n.tagName.toLowerCase() === "svg") self.paintSvgRoot(n, a);
      else if (n.tagName.toLowerCase() === "img") self.paintImgEl(n, a);
      else self.paintHtml(n, a, false);
    };
    flow.forEach(draw);
    positioned.forEach(function (p) { draw(p.n); });
    if (clip) this.ctx.restore();
  };

  Painter.prototype.paintImgEl = function (el, alpha) {
    var ent = imgCache.get(absUrl(el.currentSrc || el.src));
    if (!ent || ent.state !== "ok") return;
    var L = this.local(el.getBoundingClientRect());
    if (L.w <= 0 || L.h <= 0) return;
    var cs = getComputedStyle(el), ctx = this.ctx, img = ent.img;
    this.base();
    ctx.globalAlpha = alpha * num(cs.opacity, 1);
    var fit = cs.objectFit, iw = img.naturalWidth, ih = img.naturalHeight;
    if ((fit !== "contain" && fit !== "cover") || !iw || !ih) {
      ctx.drawImage(img, L.x, L.y, L.w, L.h);
      return;
    }
    // object-position は中央のみ対応
    var s = fit === "contain" ? Math.min(L.w / iw, L.h / ih) : Math.max(L.w / iw, L.h / ih);
    var dw = iw * s, dh = ih * s;
    ctx.save();
    ctx.beginPath();
    ctx.rect(L.x, L.y, L.w, L.h);
    ctx.clip();
    ctx.drawImage(img, L.x + (L.w - dw) / 2, L.y + (L.h - dh) / 2, dw, dh);
    ctx.restore();
  };

  Painter.prototype.paintText = function (node, cs, alpha) {
    var text = node.data;
    if (!text || !text.trim()) return;
    var ctx = this.ctx;
    var range = document.createRange();
    range.selectNodeContents(node);
    var rects = Array.prototype.filter.call(range.getClientRects(), function (r) { return r.width > 0; });
    if (!rects.length) return;
    var lines;
    if (rects.length === 1) {
      lines = [{ text: text, rect: rects[0] }];
    } else {
      // 折り返している: 1文字ずつ位置を取り、同じ高さのものを1行にまとめる
      lines = [];
      var cur = null;
      for (var i = 0; i < text.length; i++) {
        range.setStart(node, i);
        range.setEnd(node, i + 1);
        var rr = range.getClientRects()[0];
        if (!rr) continue;
        if (!cur || Math.abs(rr.top - cur.rect.top) > 1) {
          cur = { text: "", rect: { left: rr.left, top: rr.top, width: rr.width, height: rr.height } };
          lines.push(cur);
        }
        cur.text += text[i];
      }
    }
    this.base();
    ctx.globalAlpha = alpha;
    ctx.font = fontOf(cs);
    ctx.fillStyle = cs.color;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    var strokeW = num(cs.webkitTextStrokeWidth, 0);
    if (strokeW > 0) {
      ctx.strokeStyle = cs.webkitTextStrokeColor;
      ctx.lineWidth = strokeW;
      ctx.lineJoin = "round";
    }
    for (var j = 0; j < lines.length; j++) {
      var t = lines[j].text.replace(/\s+/g, " ").trim();
      if (!t) continue;
      var L = this.local(lines[j].rect);
      var m = ctx.measureText(t);
      var asc = m.fontBoundingBoxAscent, desc = m.fontBoundingBoxDescent;
      if (!Number.isFinite(asc)) { asc = num(cs.fontSize, 16) * 0.88; desc = num(cs.fontSize, 16) * 0.24; }
      var baseY = L.y + (L.h - (asc + desc)) / 2 + asc;
      paintTextShadow(ctx, parseShadow(cs.textShadow), alpha, function () {
        if (strokeW > 0) ctx.strokeText(t, L.x, baseY);
        ctx.fillText(t, L.x, baseY);
      });
      if (strokeW > 0) ctx.strokeText(t, L.x, baseY);
      ctx.fillText(t, L.x, baseY);
    }
  };

  Painter.prototype.paintSvgRoot = function (svg, alpha) {
    var cs = getComputedStyle(svg);
    if (cs.display === "none" || cs.visibility === "hidden") return;
    var a = alpha * num(cs.opacity, 1);
    var L = this.local(svg.getBoundingClientRect());
    var ctx = this.ctx;
    ctx.save();
    if (cs.overflow !== "visible") {
      this.base();
      ctx.beginPath();
      ctx.rect(L.x, L.y, L.w, L.h);
      ctx.clip();
    }
    this.ox = L.x;
    this.oy = L.y;
    for (var i = 0; i < svg.children.length; i++) this.paintSvg(svg.children[i], a);
    ctx.restore();
  };

  Painter.prototype.setCTM = function (el) {
    var m = el.getCTM && el.getCTM();
    if (!m) return false;
    var S = this.S;
    this.ctx.setTransform(S * m.a, S * m.b, S * m.c, S * m.d, S * (m.e + this.ox), S * (m.f + this.oy));
    return true;
  };

  Painter.prototype.fillStroke = function (path, cs, alpha) {
    var ctx = this.ctx;
    var fill = colorOf(cs.fill, cs);
    if (fill) {
      ctx.globalAlpha = alpha * num(cs.fillOpacity, 1);
      ctx.fillStyle = fill;
      ctx.fill(path, cs.fillRule === "evenodd" ? "evenodd" : "nonzero");
    }
    var stroke = colorOf(cs.stroke, cs);
    var sw = num(cs.strokeWidth, 1);
    if (stroke && sw > 0) {
      ctx.globalAlpha = alpha * num(cs.strokeOpacity, 1);
      ctx.strokeStyle = stroke;
      ctx.lineWidth = sw;
      ctx.lineCap = cs.strokeLinecap || "butt";
      ctx.lineJoin = cs.strokeLinejoin || "miter";
      ctx.miterLimit = num(cs.strokeMiterlimit, 4);
      ctx.setLineDash(parseDash(cs.strokeDasharray));
      ctx.lineDashOffset = num(cs.strokeDashoffset, 0);
      ctx.stroke(path);
      ctx.setLineDash([]);
    }
  };

  Painter.prototype.paintSvg = function (el, alpha) {
    var tag = el.tagName.toLowerCase();
    if (/^(defs|title|desc|style|script|clippath|mask|lineargradient|radialgradient|pattern|filter|marker|symbol|metadata)$/.test(tag)) return;
    var cs = getComputedStyle(el);
    if (cs.display === "none") return;
    var a = alpha * num(cs.opacity, 1);
    if (a <= 0.002) return;
    if (tag === "g" || tag === "a" || tag === "svg" || tag === "switch") {
      for (var i = 0; i < el.children.length; i++) this.paintSvg(el.children[i], a);
      return;
    }
    if (cs.visibility === "hidden") return;
    if (!this.setCTM(el)) return;
    var p;
    switch (tag) {
      case "rect": {
        var w = el.width.baseVal.value, h = el.height.baseVal.value;
        if (w <= 0 || h <= 0) return;
        var rxa = el.getAttribute("rx"), rya = el.getAttribute("ry");
        var rx = num(rxa, NaN), ry = num(rya, NaN);
        if (!Number.isFinite(rx)) rx = Number.isFinite(ry) ? ry : 0;
        if (!Number.isFinite(ry)) ry = rx;
        p = roundRectPath(el.x.baseVal.value, el.y.baseVal.value, w, h, rx, ry);
        break;
      }
      case "circle":
        p = new Path2D();
        p.arc(el.cx.baseVal.value, el.cy.baseVal.value, Math.max(0, el.r.baseVal.value), 0, Math.PI * 2);
        break;
      case "ellipse":
        p = new Path2D();
        p.ellipse(el.cx.baseVal.value, el.cy.baseVal.value, Math.max(0, el.rx.baseVal.value), Math.max(0, el.ry.baseVal.value), 0, 0, Math.PI * 2);
        break;
      case "line":
        p = new Path2D();
        p.moveTo(el.x1.baseVal.value, el.y1.baseVal.value);
        p.lineTo(el.x2.baseVal.value, el.y2.baseVal.value);
        // 線分に塗りは無い
        this.fillStroke(p, { fill: "none", stroke: cs.stroke, strokeWidth: cs.strokeWidth, strokeOpacity: cs.strokeOpacity, strokeLinecap: cs.strokeLinecap, strokeLinejoin: cs.strokeLinejoin, strokeMiterlimit: cs.strokeMiterlimit, strokeDasharray: cs.strokeDasharray, strokeDashoffset: cs.strokeDashoffset, color: cs.color }, a);
        return;
      case "path": {
        var d = el.getAttribute("d");
        if (!d) return;
        try { p = new Path2D(d); } catch (e) { return; }
        break;
      }
      case "polyline":
      case "polygon": {
        var pts = el.points;
        if (!pts || !pts.numberOfItems) return;
        p = new Path2D();
        for (var j = 0; j < pts.numberOfItems; j++) {
          var pt = pts.getItem(j);
          if (j) p.lineTo(pt.x, pt.y); else p.moveTo(pt.x, pt.y);
        }
        if (tag === "polygon") p.closePath();
        break;
      }
      case "text":
        this.paintSvgText(el, cs, a);
        return;
      case "image":
        this.paintSvgImage(el, cs, a);
        return;
      default:
        return;
    }
    this.fillStroke(p, cs, a);
  };

  var BASELINE = {
    central: "middle", middle: "middle", mathematical: "middle",
    hanging: "hanging", "text-before-edge": "top", "text-top": "top",
    "text-after-edge": "bottom", "text-bottom": "bottom", ideographic: "ideographic"
  };

  Painter.prototype.paintSvgText = function (el, cs, alpha) {
    var ctx = this.ctx;
    var segs = [];
    for (var i = 0; i < el.childNodes.length; i++) {
      var n = el.childNodes[i];
      if (n.nodeType === 3) {
        if (n.data) segs.push({ text: n.data, cs: cs, dx: 0, dy: 0 });
      } else if (n.nodeType === 1 && n.tagName.toLowerCase() === "tspan") {
        var tcs = getComputedStyle(n);
        if (tcs.display === "none") continue;
        segs.push({ text: n.textContent, cs: tcs, dx: lenAttr(n, "dx", tcs), dy: lenAttr(n, "dy", tcs), alpha: num(tcs.opacity, 1) });
      }
    }
    segs = segs.filter(function (s) { return s.text && s.text.replace(/\s+/g, "") !== "" || s.dx; });
    if (!segs.length) return;
    var x0 = lenAttr(el, "x", cs) + lenAttr(el, "dx", cs);
    var y0 = lenAttr(el, "y", cs) + lenAttr(el, "dy", cs);
    var total = 0;
    segs.forEach(function (s) {
      s.text = s.text.replace(/\s+/g, " ");
      ctx.font = fontOf(s.cs);
      s.w = ctx.measureText(s.text).width;
      total += s.dx + s.w;
    });
    // 先頭・末尾の空白は SVG でも詰められる
    var anchor = cs.textAnchor;
    var x = anchor === "middle" ? x0 - total / 2 : anchor === "end" ? x0 - total : x0;
    ctx.textAlign = "left";
    ctx.textBaseline = BASELINE[cs.dominantBaseline] || "alphabetic";
    var y = y0;
    // 影は filter: drop-shadow() で付けている（text 要素の値。tspan には付かない）
    var shadow = parseShadow(cs.filter);
    for (var j = 0; j < segs.length; j++) {
      var s = segs[j];
      x += s.dx;
      y += s.dy;
      ctx.font = fontOf(s.cs);
      if (shadow) {
        var sx = x, sy = y, ss = s;
        paintTextShadow(ctx, shadow, alpha * (s.alpha == null ? 1 : s.alpha), function () {
          if (num(ss.cs.strokeWidth, 0) > 0) { ctx.lineWidth = num(ss.cs.strokeWidth, 0); ctx.lineJoin = "round"; ctx.strokeText(ss.text, sx, sy); }
          ctx.fillText(ss.text, sx, sy);
        });
      }
      var fill = colorOf(s.cs.fill, s.cs);
      var stroke = colorOf(s.cs.stroke, s.cs);
      var sw = num(s.cs.strokeWidth, 0);
      var a = alpha * (s.alpha == null ? 1 : s.alpha);
      var strokeFirst = /^stroke/.test(s.cs.paintOrder || "");
      var doStroke = function () {
        if (!stroke || sw <= 0) return;
        ctx.globalAlpha = a * num(s.cs.strokeOpacity, 1);
        ctx.strokeStyle = stroke;
        ctx.lineWidth = sw;
        ctx.lineJoin = s.cs.strokeLinejoin || "miter";
        ctx.strokeText(s.text, x, y);
      };
      if (strokeFirst) doStroke();
      if (fill) {
        ctx.globalAlpha = a * num(s.cs.fillOpacity, 1);
        ctx.fillStyle = fill;
        ctx.fillText(s.text, x, y);
      }
      if (!strokeFirst) doStroke();
      x += s.w;
    }
  };

  Painter.prototype.paintSvgImage = function (el, cs, alpha) {
    var href = svgHref(el);
    if (!href) return;
    var ent = imgCache.get(absUrl(href));
    if (!ent || ent.state !== "ok") return;
    var x = el.x.baseVal.value, y = el.y.baseVal.value, w = el.width.baseVal.value, h = el.height.baseVal.value;
    if (w <= 0 || h <= 0) return;
    var img = ent.img, iw = img.naturalWidth || w, ih = img.naturalHeight || h;
    var par = el.preserveAspectRatio && el.preserveAspectRatio.baseVal;
    var align = par ? par.align : 6, slice = par ? par.meetOrSlice === 2 : false;
    var dx = x, dy = y, dw = w, dh = h;
    if (align !== 1) {
      var s = slice ? Math.max(w / iw, h / ih) : Math.min(w / iw, h / ih);
      dw = iw * s; dh = ih * s;
      var ax = ((align - 2) % 3) / 2, ay = Math.floor((align - 2) / 3) / 2;
      dx = x + (w - dw) * ax;
      dy = y + (h - dh) * ay;
    }
    var ctx = this.ctx;
    ctx.save();
    var clip = clipPathFor(cs.clipPath, x, y, w, h);
    if (clip) ctx.clip(clip);
    if (slice) { var r = new Path2D(); r.rect(x, y, w, h); ctx.clip(r); }
    ctx.globalAlpha = alpha;
    ctx.drawImage(img, dx, dy, dw, dh);
    ctx.restore();
  };

  // ════════════════════════════════════════════════════════
  //  透かし
  //  画面全体に薄くかける（端だけに置くと切り取られて消されるため）。
  //  色は背景の明るさで黒／白を自動で選ぶ。位置は時刻だけで決まるので、
  //  同じフレームは何度書き出しても同じ絵になる。
  //  MARK_STYLE: "tile"（斜めに敷き詰め）/ "center"（中央に大きく）/
  //              "band"（斜めに1本）/ "grid"（ロゴだけ格子）/ "drift"（tile がゆっくり流れる）
  // ════════════════════════════════════════════════════════
  var MARK_TEXT = "GraphRace Studio";
  var MARK_STYLE = "tile";
  var MARK_OPACITY = { tile: 0.10, center: 0.16, band: 0.14, grid: 0.12, drift: 0.13 };
  var MARK_ANGLE = -24 * Math.PI / 180;
  var markTone = "#000000";
  var logoPromise = null, logoImg = null;
  function loadLogo() {
    if (!logoPromise) {
      logoPromise = loadImage(LOGO_URL).then(function (e) { logoImg = e.state === "ok" ? e.img : null; });
    }
    return logoPromise;
  }

  // 背景色から透かしの色（黒 or 白）を決める
  function setMarkToneFrom(stage) {
    var c = "";
    try {
      var el = stage;
      while (el && el.nodeType === 1) {
        var bg = getComputedStyle(el).backgroundColor;
        if (bg && !isTransparent(bg)) { c = bg; break; }
        el = el.parentElement;
      }
    } catch (e) {}
    var lum = luminance(c);
    markTone = lum < 0.5 ? "#ffffff" : "#000000";
    // 透過のときは後ろの色が分からないので、文字と同じ色味にする
    if (isAlphaStage(stage)) markTone = luminance(getComputedStyle(stage).color) < 0.5 ? "#000000" : "#ffffff";
  }

  function rgbOf(c) { return /rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(c || ""); }
  function luminance(c) {
    var m = rgbOf(c);
    return m ? (0.2126 * m[1] + 0.7152 * m[2] + 0.0722 * m[3]) / 255 : 1;
  }

  // ロゴ＋文字の1単位を (0,0) 中心に描く。h は文字の高さの目安
  function markUnit(ctx, h, withText) {
    var logo = logoImg ? h * 1.1 : 0;
    var gap = logoImg && withText ? h * 0.3 : 0;
    ctx.font = "800 " + Math.round(h) + "px Inter, 'Noto Sans JP', 'Hiragino Kaku Gothic ProN', sans-serif";
    var tw = withText ? ctx.measureText(MARK_TEXT).width : 0;
    var w = logo + gap + tw, x = -w / 2;
    if (logoImg) {
      // ロゴは色付きなので、透かしの色で塗りつぶしたシルエットにする
      ctx.drawImage(markLogoMask(Math.ceil(logo)), x, -logo / 2, logo, logo);
    }
    if (withText) {
      ctx.textBaseline = "middle";
      ctx.textAlign = "left";
      ctx.fillStyle = markTone;
      ctx.fillText(MARK_TEXT, x + logo + gap, h * 0.04);
    }
    return w;
  }

  var maskCache = { key: "", canvas: null };
  function markLogoMask(px) {
    var key = px + markTone;
    if (maskCache.key === key) return maskCache.canvas;
    var c = document.createElement("canvas");
    c.width = c.height = Math.max(1, px);
    var g = c.getContext("2d");
    g.drawImage(logoImg, 0, 0, c.width, c.height);
    g.globalCompositeOperation = "source-in";
    g.fillStyle = markTone;
    g.fillRect(0, 0, c.width, c.height);
    maskCache = { key: key, canvas: c };
    return c;
  }

  function drawWatermark(ctx, W, H, tSec, style) {
    style = style || MARK_STYLE;
    var short = Math.min(W, H), diag = Math.sqrt(W * W + H * H);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = MARK_OPACITY[style] || 0.13;
    ctx.translate(W / 2, H / 2);
    if (style === "center") {
      var hc = short * 0.075;
      ctx.font = "800 " + Math.round(hc) + "px sans-serif";
      var est = (logoImg ? hc * 1.4 : 0) + ctx.measureText(MARK_TEXT).width;
      var k = (short * 0.86) / est;
      markUnit(ctx, hc * Math.min(1.6, k), true);
    } else if (style === "band") {
      ctx.rotate(Math.atan2(-H, W) * 0.55);
      var hb = short * 0.07;
      ctx.font = "800 " + Math.round(hb) + "px sans-serif";
      var estB = (logoImg ? hb * 1.4 : 0) + ctx.measureText(MARK_TEXT).width;
      markUnit(ctx, hb * Math.min(2.2, (diag * 0.5) / estB), true);
    } else if (style === "grid") {
      var hg = short * 0.09, sx = short * 0.3, sy = short * 0.3;
      for (var gy = -Math.ceil(H / 2 / sy) - 1; gy <= Math.ceil(H / 2 / sy) + 1; gy++) {
        for (var gx = -Math.ceil(W / 2 / sx) - 1; gx <= Math.ceil(W / 2 / sx) + 1; gx++) {
          ctx.save();
          ctx.translate(gx * sx + (gy % 2 ? sx / 2 : 0), gy * sy);
          markUnit(ctx, hg / 1.1, false);
          ctx.restore();
        }
      }
    } else {
      // tile / drift: 斜めに千鳥で敷き詰める
      ctx.rotate(MARK_ANGLE);
      var ht = short * 0.043;
      ctx.font = "800 " + Math.round(ht) + "px sans-serif";
      var unitW = (logoImg ? ht * 1.4 : 0) + ctx.measureText(MARK_TEXT).width;
      var stepX = unitW * 1.84, stepY = ht * 8;
      var off = style === "drift" ? (tSec * short * 0.025) % stepX : 0;
      var nx = Math.ceil(diag / 2 / stepX) + 1, ny = Math.ceil(diag / 2 / stepY) + 1;
      for (var ty = -ny; ty <= ny; ty++) {
        for (var tx = -nx; tx <= nx; tx++) {
          ctx.save();
          ctx.translate(tx * stepX + (ty % 2 ? stepX / 2 : 0) + off, ty * stepY);
          markUnit(ctx, ht, true);
          ctx.restore();
        }
      }
    }
    ctx.restore();
  }

  // プレビューにも同じ透かしを重ねる（ステージの上に canvas を1枚置く）。
  // 動画の描き写しでは data-grs-skip で無視し、透かしの有無は書き出し設定に従う。
  function attachPreviewMark(stage) {
    if (!stage || stage.querySelector("canvas.grs-preview-mark")) return;
    var cv = document.createElement("canvas");
    cv.className = "grs-preview-mark";
    cv.setAttribute("aria-hidden", "true");
    cv.setAttribute("data-grs-skip", "");
    cv.style.cssText = "position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;z-index:50";
    if (getComputedStyle(stage).position === "static") stage.style.position = "relative";
    stage.appendChild(cv);
    var pending = false;
    function draw() {
      pending = false;
      var w = stage.offsetWidth, h = stage.offsetHeight;
      if (!w || !h) return;
      var dpr = Math.min(2, window.devicePixelRatio || 1);
      var cw = Math.round(w * dpr), ch = Math.round(h * dpr);
      if (cv.width !== cw || cv.height !== ch) { cv.width = cw; cv.height = ch; }
      var g = cv.getContext("2d");
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, cw, ch);
      setMarkToneFrom(stage);
      drawWatermark(g, cw, ch, 0);
    }
    function schedule() { if (!pending) { pending = true; requestAnimationFrame(draw); } }
    loadLogo().then(schedule);
    try { new ResizeObserver(schedule).observe(stage); } catch (e) { window.addEventListener("resize", schedule); }
    // 背景色やサイズの設定変更（style 属性）に追従する
    new MutationObserver(schedule).observe(stage, { attributes: true, attributeFilter: ["style", "class"] });
    schedule();
  }

  // ════════════════════════════════════════════════════════
  //  エンコード
  // ════════════════════════════════════════════════════════
  function even(n) { n = Math.max(2, Math.round(n)); return n % 2 ? n - 1 : n; }

  function outputSize(size, scale) {
    var w = size.width * scale, h = size.height * scale;
    var long = Math.max(w, h), short = Math.min(w, h);
    var k = Math.min(1, MAX_LONG_SIDE / long, MAX_SHORT_SIDE / short);
    return { width: even(w * k), height: even(h * k) };
  }

  function bitrateFor(w, h, fps) {
    // グラフは平坦な色が多いので低めで足りる。文字の輪郭が崩れない程度を下限にする
    return Math.round(Math.min(30e6, Math.max(2.5e6, w * h * fps * 0.11)));
  }

  var CODECS = {
    mp4: [
      ["avc1.640033", "avc"], ["avc1.64002A", "avc"], ["avc1.4D0033", "avc"],
      ["avc1.42E033", "avc"], ["avc1.42001F", "avc"]
    ],
    webm: [
      ["vp09.00.51.08", "V_VP9"], ["vp09.00.41.08", "V_VP9"], ["vp09.00.10.08", "V_VP9"], ["vp8", "V_VP8"]
    ]
  };

  async function pickConfig(format, w, h, fps) {
    if (typeof VideoEncoder === "undefined") return null;
    var bitrate = bitrateFor(w, h, fps);
    var list = CODECS[format] || [];
    for (var i = 0; i < list.length; i++) {
      var cfg = { codec: list[i][0], width: w, height: h, bitrate: bitrate, framerate: fps, latencyMode: "quality" };
      if (format === "mp4") cfg.avc = { format: "avc" };
      try {
        var r = await VideoEncoder.isConfigSupported(cfg);
        if (r && r.supported) return { config: cfg, muxCodec: list[i][1] };
      } catch (e) {}
    }
    return null;
  }

  var supportCache = {};
  function formatSupported(format, size) {
    if (format === "png" || format === "mov" || format === "mov_rle") return Promise.resolve(true);
    var key = format + ":" + size.width + "x" + size.height;
    if (!supportCache[key]) supportCache[key] = pickConfig(format, size.width, size.height, 30).then(function (c) { return !!c; });
    return supportCache[key];
  }

  // ── 音声 ─────────────────────────────────────────────
  var AUDIO_RATE = 48000;   // Opus は 48kHz が前提。AAC も 48kHz で揃える
  var AUDIO_CODECS = {
    mp4: [["mp4a.40.2", "aac"], ["opus", "opus"]],
    webm: [["opus", "opus"]]
  };
  async function pickAudioConfig(format) {
    if (typeof AudioEncoder === "undefined" || typeof AudioData === "undefined") return null;
    var list = AUDIO_CODECS[format] || [];
    for (var i = 0; i < list.length; i++) {
      var cfg = { codec: list[i][0], sampleRate: AUDIO_RATE, numberOfChannels: 2, bitrate: 160000 };
      try {
        var r = await AudioEncoder.isConfigSupported(cfg);
        if (r && r.supported) return { config: cfg, muxCodec: list[i][1] };
      } catch (e) {}
    }
    return null;
  }
  /* ツールが作った音（AudioBuffer）を先にすべてエンコードしておく。
     映像より先に終わらせ、映像のチャンクが出てくるたびに同じ時刻までの音を muxer に渡す */
  async function encodeAudio(adapter, format, sec) {
    if (typeof adapter.getAudio !== "function") return null;
    var pick = await pickAudioConfig(format);
    if (!pick) return { skipped: true };
    var buf = await adapter.getAudio(sec, AUDIO_RATE);
    if (!buf) return null;
    var chunks = [], err = null;
    var enc = new AudioEncoder({
      output: function (chunk, meta) { chunks.push({ chunk: chunk, meta: meta }); },
      error: function (e) { err = e; }
    });
    enc.configure(pick.config);
    var ch = Math.min(2, buf.numberOfChannels);
    var L = buf.getChannelData(0), R = buf.getChannelData(ch > 1 ? 1 : 0);
    var STEP = 4800;   // 0.1秒ずつ
    for (var off = 0; off < buf.length; off += STEP) {
      var n = Math.min(STEP, buf.length - off);
      var data = new Float32Array(n * 2);
      data.set(L.subarray(off, off + n), 0);
      data.set(R.subarray(off, off + n), n);
      var ad = new AudioData({ format: "f32-planar", sampleRate: buf.sampleRate, numberOfFrames: n,
        numberOfChannels: 2, timestamp: Math.round(off * 1e6 / buf.sampleRate), data: data });
      enc.encode(ad);
      ad.close();
      if (err) throw err;
      if (enc.encodeQueueSize > 20) await new Promise(function (res) { enc.addEventListener("dequeue", res, { once: true }); });
    }
    await enc.flush();
    try { enc.close(); } catch (e) {}
    if (err) throw err;
    return { muxCodec: pick.muxCodec, chunks: chunks };
  }

  /*
   * 1本書き出す。opts: { adapter, format, watermark, scale, fps, holdSec, onProgress, signal }
   * 戻り値: { blob, fileExt, frames, failedImages }
   */
  // フレーム数の計算（アニメーション＋最後の静止）
  function frameTiming(opts) {
    var durationMs = Math.max(0, opts.adapter.getDurationMs());
    var frameMs = 1000 / opts.fps;
    var animFrames = Math.max(1, Math.ceil(durationMs / frameMs) + 1);
    var holdFrames = Math.round((opts.holdSec || 0) * opts.fps);
    return { durationMs: durationMs, frameMs: frameMs, total: animFrames + holdFrames, keyEvery: opts.fps * 2 };
  }

  // 全フレームを順に ctx へ描き、1枚ごとに emit(i) を呼ぶ
  async function paintFrames(opts, ctx, size, timing, emit) {
    var adapter = opts.adapter, fps = opts.fps, total = timing.total;
    var ownMark = !!adapter.ownWatermark;
    var custom = typeof adapter.paintFrame === "function";
    var stage = custom ? null : adapter.getStage();
    var painter = custom ? null : new Painter(ctx, stage, size.width);
    var started = performance.now();
    for (var i = 0; i < total; i++) {
      if (opts.signal && opts.signal.aborted) throw new DOMException("cancelled", "AbortError");
      // 最後の静止部分も毎フレーム描く（順位の入れ替わりが落ち着くまで動かすため）。
      // 透かしも止めずに動かし続ける（止まると切り取られやすい）
      await adapter.renderAt(Math.min(timing.durationMs, i * timing.frameMs), i === 0 ? 0 : timing.frameMs);
      if (custom) {
        await adapter.paintFrame(ctx, size.width, size.height, {});
      } else {
        var waiting = ensureImages(stage);
        if (waiting) await waiting;
        painter.paint();
      }
      if (opts.watermark && !ownMark) drawWatermark(ctx, size.width, size.height, i / fps);
      await emit(i);
      if (i % 3 === 0 || i === total - 1) {
        var elapsed = performance.now() - started;
        if (opts.onProgress) opts.onProgress({ done: i + 1, total: total, etaMs: elapsed / (i + 1) * (total - i - 1) });
        await yieldTask();
      }
    }
  }

  var crcTable = null;
  function crc32(bytes) {
    if (!crcTable) {
      crcTable = new Uint32Array(256);
      for (var n = 0; n < 256; n++) {
        var c = n;
        for (var k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        crcTable[n] = c >>> 0;
      }
    }
    var crc = 0xffffffff;
    for (var i = 0; i < bytes.length; i++) crc = crcTable[(crc ^ bytes[i]) & 255] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }

  function pngChunk(type, data) {
    var body = new Uint8Array(4 + data.length);
    for (var i = 0; i < 4; i++) body[i] = type.charCodeAt(i);
    body.set(data, 4);
    var head = new DataView(new ArrayBuffer(4)), tail = new DataView(new ArrayBuffer(4));
    head.setUint32(0, data.length);
    tail.setUint32(0, crc32(body));
    return [head.buffer, body, tail.buffer];
  }

  // RGBA の画素から PNG を作る。canvas.toBlob はブラウザの空き時間に回されるので、
  // 別のタブにいると1枚1秒かかる（書き出しが止まって見える）。ここで直接組み立てる
  async function encodePng(rgba, W, H, raw) {
    var stride = W * 4;
    for (var y = 0, si = 0, di = 0; y < H; y++) {
      raw[di++] = 2; // 行フィルタ Up（真上の行との差）。グラフは縦に同じ色が続くのでよく縮む
      for (var x = 0; x < stride; x++, si++) raw[di++] = rgba[si] - (y ? rgba[si - stride] : 0);
    }
    var deflated = await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream("deflate"))).arrayBuffer();
    var ihdr = new DataView(new ArrayBuffer(13));
    ihdr.setUint32(0, W);
    ihdr.setUint32(4, H);
    ihdr.setUint8(8, 8);  // 8bit
    ihdr.setUint8(9, 6);  // RGBA
    var signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    return new Blob([signature].concat(
      pngChunk("IHDR", new Uint8Array(ihdr.buffer)),
      pngChunk("IDAT", new Uint8Array(deflated)),
      pngChunk("IEND", new Uint8Array(0))
    ), { type: "image/png" });
  }

  // PNG連番を ZIP（無圧縮）にまとめる。PNG はもう圧縮されているので縮める意味がない
  function pngZipWriter(ctx, size) {
    var parts = [], central = [], offset = 0, count = 0;
    function header(size) { return new DataView(new ArrayBuffer(size)); }
    // ローカルヘッダーと中央ディレクトリで共通の部分（version needed から extra length まで）
    function common(v, p, crc, size, nameLen) {
      v.setUint16(p, 20, true);       // version needed
      v.setUint16(p + 2, 0x0800, true); // UTF-8
      v.setUint16(p + 4, 0, true);    // 無圧縮
      v.setUint16(p + 6, 0, true);    // 時刻
      v.setUint16(p + 8, 0x21, true); // 日付（1980-01-01）
      v.setUint32(p + 10, crc, true);
      v.setUint32(p + 14, size, true);
      v.setUint32(p + 18, size, true);
      v.setUint16(p + 22, nameLen, true);
    }
    var enc = new TextEncoder();
    var W = size.width, H = size.height, raw = new Uint8Array((W * 4 + 1) * H);
    return {
      add: async function (i) {
        var blob = await encodePng(ctx.getImageData(0, 0, W, H).data, W, H, raw);
        var crc = crc32(new Uint8Array(await blob.arrayBuffer()));
        var name = enc.encode("frame_" + String(i + 1).padStart(6, "0") + ".png");
        var local = header(30);
        local.setUint32(0, 0x04034b50, true);
        common(local, 4, crc, blob.size, name.length);
        parts.push(local.buffer, name, blob);
        var dir = header(46);
        dir.setUint32(0, 0x02014b50, true);
        dir.setUint16(4, 20, true);
        common(dir, 6, crc, blob.size, name.length);
        dir.setUint32(42, offset, true);
        central.push(dir.buffer, name);
        offset += 30 + name.length + blob.size;
        count++;
      },
      finish: async function () {
        var dirSize = central.reduce(function (n, b) { return n + b.byteLength; }, 0);
        var end = header(22);
        end.setUint32(0, 0x06054b50, true);
        end.setUint16(8, count, true);
        end.setUint16(10, count, true);
        end.setUint32(12, dirSize, true);
        end.setUint32(16, offset, true);
        return { blob: new Blob(parts.concat(central, [end.buffer]), { type: "application/zip" }), fileExt: "zip" };
      },
      close: function () {}
    };
  }

  // QuickTime Animation の1フレーム（全行を書くキーフレーム）を out に書き、バイト数を返す。
  // 行の形: スキップ符号(1=飛ばさない) → 符号の列 → 0xFF。符号は 正=その数だけ生の画素、
  // -2以下=次の1画素をその数だけ繰り返す。画素は ARGB でアルファは非乗算。最後に 0 で終わる
  function encodeRleFrame(rgba, W, H, out) {
    var px = new Uint32Array(rgba.buffer, rgba.byteOffset, W * H);
    var MAX = 127, o = 6, p;
    function put(si) {
      si *= 4;
      out[o++] = rgba[si + 3]; out[o++] = rgba[si]; out[o++] = rgba[si + 1]; out[o++] = rgba[si + 2];
    }
    for (var y = 0; y < H; y++) {
      var row = y * W, x = 0;
      out[o++] = 1;
      while (x < W) {
        var v = px[row + x], run = 1;
        while (run < MAX && x + run < W && px[row + x + run] === v) run++;
        if (run >= 2) {
          out[o++] = 256 - run;
          put(row + x);
          x += run;
          continue;
        }
        // 次に同じ色が続くところまでを生の画素で書く
        var start = x++;
        while (x < W && x - start < MAX && !(x + 1 < W && px[row + x] === px[row + x + 1])) x++;
        out[o++] = x - start;
        for (p = start; p < x; p++) put(row + p);
      }
      out[o++] = 0xff;
    }
    out[o++] = 0;
    // 先頭: サイズ4バイト＋ヘッダー2バイト（0 = 全行を書く）
    out[0] = o >>> 24; out[1] = (o >>> 16) & 255; out[2] = (o >>> 8) & 255; out[3] = o & 255;
    out[4] = 0; out[5] = 0;
    return o;
  }

  // QuickTime の atom を組み立てる小さな道具。数値は big endian
  function atom(type, parts) {
    var bytes = [0, 0, 0, 0, type.charCodeAt(0), type.charCodeAt(1), type.charCodeAt(2), type.charCodeAt(3)];
    (parts || []).forEach(function (p) { for (var i = 0; i < p.length; i++) bytes.push(p[i]); });
    var n = bytes.length;
    bytes[0] = n >>> 24; bytes[1] = (n >>> 16) & 255; bytes[2] = (n >>> 8) & 255; bytes[3] = n & 255;
    return bytes;
  }
  function u16(n) { return [(n >>> 8) & 255, n & 255]; }
  function u32(n) { return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]; }
  function u64(n) { return u32(Math.floor(n / 4294967296)).concat(u32(n % 4294967296)); }
  function fourcc(s) { return [s.charCodeAt(0), s.charCodeAt(1), s.charCodeAt(2), s.charCodeAt(3)]; }
  function zeros(n) { return new Array(n).fill(0); }
  function pascal(s, len) {
    var out = [s.length];
    for (var i = 0; i < s.length; i++) out.push(s.charCodeAt(i));
    return len ? out.concat(zeros(len - out.length)) : out;
  }
  // moov の値は ffmpeg の出力とそろえている。編集ソフトでの確認はこの形で通っていて、
  // 以前の独自の形（vmhd が Straight alpha など）では Final Cut Pro の背景が白くなった
  function qtMoov(W, H, fps, sizes, codec) {
    var count = sizes.length, TS = fps * 512, DELTA = 512;
    var movieDuration = Math.round(count * 1000 / fps);
    var matrix = [].concat(u32(0x10000), u32(0), u32(0), u32(0), u32(0x10000), u32(0), u32(0), u32(0), u32(0x40000000));
    var mvhd = atom("mvhd", [u32(0), u32(0), u32(0), u32(1000), u32(movieDuration), u32(0x10000), u16(0x100), zeros(10), matrix, zeros(24), u32(2)]);
    var tkhd = atom("tkhd", [u32(3), u32(0), u32(0), u32(1), u32(0), u32(movieDuration), zeros(8), u16(0), u16(0), u16(0), u16(0), matrix, u32(W * 65536), u32(H * 65536)]);
    var edts = atom("edts", [atom("elst", [u32(0), u32(1), u32(movieDuration), u32(0), u32(0x10000)])]);
    var mdhd = atom("mdhd", [u32(0), u32(0), u32(0), u32(TS), u32(count * DELTA), u16(0x7fff), u16(0)]);
    var mhlr = atom("hdlr", [u32(0), fourcc("mhlr"), fourcc("vide"), u32(0), u32(0), u32(0), pascal("VideoHandler")]);
    var vmhd = atom("vmhd", [u32(1), u16(0), u16(0), u16(0), u16(0)]);
    var dhlr = atom("hdlr", [u32(0), fourcc("dhlr"), fourcc("url "), u32(0), u32(0), u32(0), pascal("DataHandler")]);
    var dinf = atom("dinf", [atom("dref", [u32(0), u32(1), atom("url ", [u32(1)])])]);
    var entry = atom(codec.fourcc, [
      zeros(6), u16(1), u16(0), u16(0), fourcc("FFMP"), u32(512), u32(512), u16(W), u16(H),
      u32(72 * 65536), u32(72 * 65536), u32(0), u16(1), pascal(codec.name, 32), u16(32), u16(0xffff),
      atom("fiel", [[1, 0]]), atom("pasp", [u32(1), u32(1)])
    ]);
    var stsd = atom("stsd", [u32(0), u32(1), entry]);
    var stts = atom("stts", [u32(0), u32(1), u32(count), u32(DELTA)]);
    var stsc = atom("stsc", [u32(0), u32(1), u32(1), u32(count), u32(1)]);
    var stszBytes = new Array(count * 4);
    sizes.forEach(function (n, i) {
      u32(n).forEach(function (b, k) { stszBytes[i * 4 + k] = b; });
    });
    var stsz = atom("stsz", [u32(0), u32(0), u32(count), stszBytes]);
    // 全フレームが1つの chunk。ftyp(20)・wide(8)・mdat のヘッダー(8) の直後から始まる
    var stco = atom("stco", [u32(0), u32(1), u32(36)]);
    // stss を書かない = 全フレームがキーフレーム
    var stbl = atom("stbl", [stsd, stts, stsc, stsz, stco]);
    var minf = atom("minf", [vmhd, dhlr, dinf, stbl]);
    var mdia = atom("mdia", [mdhd, mhlr, minf]);
    return atom("moov", [mvhd, atom("trak", [tkhd, edts, mdia])]);
  }

  // 透過MOV。encodeFrame が RGBA の画素から1フレーム分の Blob を作る。moov は最後にまとめて書く
  function movWriter(ctx, size, fps, codec, encodeFrame) {
    var W = size.width, H = size.height;
    var ftyp = atom("ftyp", [fourcc("qt  "), u32(0x200), fourcc("qt  ")]);
    var parts = [], sizes = [], mdatSize = 8;
    return {
      add: async function () {
        var frame = await encodeFrame(ctx.getImageData(0, 0, W, H).data);
        parts.push(frame);
        sizes.push(frame.size);
        mdatSize += frame.size;
      },
      finish: async function () {
        // ftyp の直後に wide（8バイト）を置き、4GB を超えたら mdat のヘッダーに使う
        var head = mdatSize < 4294967296
          ? atom("wide").concat(u32(mdatSize), fourcc("mdat"))
          : u32(1).concat(fourcc("mdat"), u64(mdatSize + 8));
        var moov = qtMoov(W, H, fps, sizes, codec);
        return {
          blob: new Blob([new Uint8Array(ftyp.concat(head))].concat(parts, [new Uint8Array(moov)]), { type: "video/quicktime" }),
          fileExt: "mov"
        };
      },
      close: function () {}
    };
  }

  function pngMovWriter(ctx, size, fps) {
    var W = size.width, H = size.height;
    var raw = new Uint8Array(H * (W * 4 + 1));
    return movWriter(ctx, size, fps, { fourcc: "png ", name: "png" }, function (rgba) {
      return encodePng(rgba, W, H, raw);
    });
  }

  function rleMovWriter(ctx, size, fps) {
    var W = size.width, H = size.height;
    var buf = new Uint8Array(H * (W * 4 + Math.ceil(W / 127) + 2) + 7);
    return movWriter(ctx, size, fps, { fourcc: "rle ", name: "qtrle" }, function (rgba) {
      return new Blob([buf.subarray(0, encodeRleFrame(rgba, W, H, buf))]);
    });
  }

  async function encodeTransparent(opts) {
    var adapter = opts.adapter, fps = opts.fps;
    var size = outputSize(adapter.getSize(), opts.scale);
    var stage = adapter.getStage();
    if (opts.watermark) { await loadLogo(); setMarkToneFrom(stage); }
    try { if (document.fonts && document.fonts.ready) await document.fonts.ready; } catch (e) {}

    var timing = frameTiming(opts);
    var canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    var ctx = canvas.getContext("2d", { willReadFrequently: true });
    var writer = opts.format === "mov" ? pngMovWriter(ctx, size, fps)
      : opts.format === "mov_rle" ? rleMovWriter(ctx, size, fps) : pngZipWriter(ctx, size);

    await adapter.beginExport({ watermark: !!opts.watermark, fps: fps, size: size });
    var out;
    try {
      await paintFrames(opts, ctx, size, timing, writer.add);
      out = await writer.finish();
    } finally {
      writer.close();
      try { await adapter.endExport(); } catch (e) {}
    }
    return { blob: out.blob, fileExt: out.fileExt, frames: timing.total, failedImages: failedImageCount(), size: size, audioSkipped: false };
  }

  async function encodeVideo(opts) {
    if (opts.transparent) return encodeTransparent(opts);
    var adapter = opts.adapter;
    var size = outputSize(adapter.getSize(), opts.scale);
    var fps = opts.fps;
    var pick = await pickConfig(opts.format, size.width, size.height, fps);
    if (!pick) throw new Error(opts.format === "mp4" ? "このブラウザでは MP4 を書き出せません" : "このブラウザでは WebM を書き出せません");
    await loadScript(opts.format === "mp4" ? VENDOR.mp4 : VENDOR.webm);
    if (opts.watermark && !adapter.ownWatermark) { await loadLogo(); setMarkToneFrom(adapter.getStage()); }
    try { if (document.fonts && document.fonts.ready) await document.fonts.ready; } catch (e) {}

    var timing = frameTiming(opts);
    var total = timing.total;
    var keyEvery = timing.keyEvery;

    // 音は映像の総尺ぶん。作れなかった・ブラウザが対応していないときは音なしで続ける
    var audio = null, audioSkipped = false;
    try {
      audio = await encodeAudio(adapter, opts.format, total / fps);
      if (audio && audio.skipped) { audio = null; audioSkipped = true; }
    } catch (e) {
      try { console.warn("[video-export] 音声を入れられませんでした", e); } catch (e2) {}
      audio = null; audioSkipped = true;
    }
    var audioMux = audio ? { codec: audio.muxCodec, numberOfChannels: 2, sampleRate: AUDIO_RATE } : undefined;

    var target, muxer;
    if (opts.format === "mp4") {
      target = new window.Mp4Muxer.ArrayBufferTarget();
      muxer = new window.Mp4Muxer.Muxer({
        target: target,
        video: { codec: pick.muxCodec, width: size.width, height: size.height, frameRate: fps },
        audio: audioMux,
        fastStart: "in-memory",
        firstTimestampBehavior: "offset"
      });
    } else {
      target = new window.WebMMuxer.ArrayBufferTarget();
      muxer = new window.WebMMuxer.Muxer({
        target: target,
        video: { codec: pick.muxCodec, width: size.width, height: size.height, frameRate: fps },
        audio: audioMux ? { codec: "A_OPUS", numberOfChannels: 2, sampleRate: AUDIO_RATE } : undefined,
        firstTimestampBehavior: "offset"
      });
    }
    // 音のチャンクは、映像のチャンクと同じ時刻まで追いつくように少しずつ渡す
    var audioIdx = 0;
    function feedAudio(untilUs) {
      if (!audio) return;
      while (audioIdx < audio.chunks.length && audio.chunks[audioIdx].chunk.timestamp <= untilUs) {
        var a = audio.chunks[audioIdx++];
        muxer.addAudioChunk(a.chunk, a.meta);
      }
    }

    var encodeError = null;
    var encoder = new VideoEncoder({
      output: function (chunk, meta) { feedAudio(chunk.timestamp); muxer.addVideoChunk(chunk, meta); },
      error: function (e) { encodeError = e; }
    });
    encoder.configure(pick.config);

    var canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    var ctx = canvas.getContext("2d", { alpha: false });

    await adapter.beginExport({ watermark: !!opts.watermark, fps: fps, size: size });
    try {
      await paintFrames(opts, ctx, size, timing, async function (i) {
        if (encodeError) throw encodeError;
        var frame = new VideoFrame(canvas, { timestamp: Math.round(i * 1e6 / fps), duration: Math.round(1e6 / fps) });
        encoder.encode(frame, { keyFrame: i % keyEvery === 0 });
        frame.close();
        while (encoder.encodeQueueSize > 4) {
          await new Promise(function (res) { encoder.addEventListener("dequeue", res, { once: true }); });
        }
      });
      await encoder.flush();
      if (encodeError) throw encodeError;
      feedAudio(Infinity);
      muxer.finalize();
    } finally {
      try { if (encoder.state !== "closed") encoder.close(); } catch (e) {}
      try { await adapter.endExport(); } catch (e) {}
    }
    var mime = opts.format === "mp4" ? "video/mp4" : "video/webm";
    return { blob: new Blob([target.buffer], { type: mime }), fileExt: opts.format, frames: total, failedImages: failedImageCount(), size: size, audioSkipped: audioSkipped };
  }

  // ════════════════════════════════════════════════════════
  //  書き出しダイアログ
  // ════════════════════════════════════════════════════════
  var stylesAdded = false;
  function ensureStyles() {
    if (stylesAdded) return;
    stylesAdded = true;
    var css =
      ".grsx-backdrop{position:fixed;inset:0;z-index:5500;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.62);padding:max(16px,env(safe-area-inset-top)) 16px max(16px,env(safe-area-inset-bottom));box-sizing:border-box}" +
      ".grsx-modal{position:relative;width:min(560px,100%);max-height:calc(100vh - 32px);max-height:calc(100dvh - 32px);overflow:auto;overscroll-behavior:contain;background:#f7f7f9;color:#1b1f27;border-radius:10px;padding:20px 22px;box-shadow:0 18px 60px rgba(0,0,0,.45);font-size:14px;line-height:1.55;box-sizing:border-box}" +
      ".grsx-head{position:sticky;top:-20px;z-index:2;display:flex;align-items:center;justify-content:space-between;gap:12px;margin:-20px -22px 12px;padding:14px 12px 10px 22px;background:#f7f7f9;border-bottom:1px solid #e6e8ee}" +
      ".grsx-modal h3{margin:0;font-size:18px}" +
      ".grsx-x{flex:none;width:44px;height:44px;margin:0;padding:0;border:none;border-radius:8px;background:#e9ebf0;color:#333;font-size:24px;line-height:1;cursor:pointer}" +
      ".grsx-x:hover{background:#e6e8ee}" +
      ".grsx-thumb[hidden],.grsx-field[hidden]{display:none}.grsx-thumb{display:flex;justify-content:center;background:#e9ebf0;border-radius:8px;padding:10px;margin-bottom:14px}" +
      ".grsx-thumb canvas{max-width:100%;max-height:240px;border-radius:4px;box-shadow:0 1px 4px rgba(0,0,0,.18)}" +
      ".grsx-field{display:grid;grid-template-columns:96px 1fr;gap:6px 12px;align-items:center;margin-bottom:10px}" +
      ".grsx-field>span{font-weight:700;font-size:13px}" +
      ".grsx-seg{display:flex;flex-wrap:wrap;gap:6px}" +
      ".grsx-seg label{position:relative;cursor:pointer;margin:0;padding:0;display:inline-flex}" +
      ".grsx-seg input{position:absolute;opacity:0;pointer-events:none}" +
      ".grsx-seg label>b{display:inline-flex;align-items:center;gap:6px;padding:7px 12px;border:1px solid #d0d5de;border-radius:6px;background:#fff;font-weight:600;font-size:13px}" +
      ".grsx-seg input:checked+b{border-color:var(--accent,#6E62F0);box-shadow:0 0 0 1px var(--accent,#6E62F0) inset;color:var(--accent,#6E62F0)}" +
      ".grsx-seg input:focus-visible+b{outline:2px solid var(--accent,#6E62F0);outline-offset:2px}" +
      ".grsx-seg input:disabled+b{opacity:.45;cursor:not-allowed}" +
      ".grsx-tag{font-size:10.5px;font-weight:700;padding:1px 6px;border-radius:999px;background:#eef0f4;color:#5b6472}" +
      ".grsx-tag.free{background:#e6f6ee;color:#16794c}.grsx-tag.paid{background:#fff3e0;color:#b25e00}.grsx-tag.lock{background:#fde8e8;color:#b42318}" +
      ".grsx-select{padding:7px 10px;border:1px solid #d0d5de;border-radius:6px;background:#fff;font-size:13px;width:auto;max-width:100%}" +
      ".grsx-note{font-size:12px;color:#5b6472;margin:6px 0 0}" +
      ".grsx-webm-note{margin:-4px 0 10px;color:#9a3412}" +
      ".grsx-summary{font-size:12.5px;color:#333;background:#fff;border:1px solid #e3e6ec;border-radius:6px;padding:8px 10px;margin:12px 0 0}" +
      ".grsx-warn{font-size:12.5px;color:#9a3412;background:#fff7ed;border:1px solid #fed7aa;border-radius:6px;padding:8px 10px;margin:10px 0 0}" +
      ".grsx-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:16px}" +
      ".grsx-btn{width:auto;min-width:104px;margin:0;padding:10px 16px;border:none;border-radius:6px;font-weight:700;font-size:14px;cursor:pointer}" +
      ".grsx-primary{background:var(--accent,#6E62F0);color:#fff}.grsx-primary:disabled{background:#b9bccb;cursor:not-allowed}" +
      ".grsx-ghost{background:#e4e6ec;color:#222}" +
      ".grsx-bar{height:10px;background:#e4e6ec;border-radius:999px;overflow:hidden;margin:6px 0}" +
      ".grsx-bar i{display:block;height:100%;width:0;background:var(--accent,#6E62F0);transition:width .2s}" +
      ".grsx-progress-text{display:flex;justify-content:space-between;font-size:12.5px;color:#444}" +
      ".grsx-survey{margin-top:16px;padding-top:14px;border-top:1px solid #e1e4ea}" +
      ".grsx-done{font-size:15px;font-weight:700;color:#16794c;margin:0 0 4px}" +
      ".grsx-modal,.grsx-modal *{text-transform:none;letter-spacing:normal}" +
      "@media (max-width:520px){.grsx-field{grid-template-columns:1fr}}";
    var el = document.createElement("style");
    el.textContent = css;
    document.head.appendChild(el);
  }

  function tagHtml(feature) {
    var P = plan();
    var t = P ? P.badgeText(feature) : "";
    if (!t) return "";
    // 有料化後は金の冠アイコン（shared/export-plan.js の GRSPlan.crownHtml）
    if (P && P.config.paywallEnabled && P.crownHtml) return P.crownHtml();
    return '<em class="grsx-tag paid">' + esc(t) + "</em>";
  }

  function fmtSec(ms) {
    var s = Math.max(0, Math.round(ms / 1000));
    return s < 60 ? s + "秒" : Math.floor(s / 60) + "分" + String(s % 60).padStart(2, "0") + "秒";
  }
  function fmtMB(bytes) { return (bytes / 1048576).toFixed(bytes < 10485760 ? 1 : 0) + "MB"; }

  var state = { busy: false };

  function openDialog(cfg) {
    var adapter = cfg.adapter;
    ensureStyles();
    var P = plan();
    var last = {};
    try { last = JSON.parse(localStorage.getItem("grs_export_prefs") || "{}") || {}; } catch (e) {}

    var back = document.createElement("div");
    back.className = "grsx-backdrop";
    back.innerHTML =
      '<div class="grsx-modal" role="dialog" aria-modal="true" aria-labelledby="grsxTitle">' +
        '<div class="grsx-head"><h3 id="grsxTitle">動画を書き出す</h3>' +
        '<button type="button" class="grsx-x" id="grsxCloseX" aria-label="閉じる">×</button></div>' +
        '<div class="grsx-body"></div>' +
      "</div>";
    document.body.appendChild(back);
    var body = back.querySelector(".grsx-body");
    var abort = null;
    var closed = false;

    // 別タブで購入・有効化されたら、開いたままのこの画面からも冠を外し、状態の一行を出す
    function onLicenseChange(e) {
      if (!e.detail || !e.detail.pro) return;
      var opts = back.querySelectorAll("option");
      for (var i = 0; i < opts.length; i++) opts[i].textContent = opts[i].textContent.replace(/ 👑$/, "");
      var crowns = body.querySelectorAll(".grs-crown, .grsx-tag.paid");
      for (var j = 0; j < crowns.length; j++) crowns[j].remove();
      if (!cfg.free && P && P.statusHtml && !body.querySelector(".grsp-status")) body.insertAdjacentHTML("afterbegin", P.statusHtml());
    }
    window.addEventListener("grs-license-change", onLicenseChange);
    function close() {
      if (state.busy) { if (abort) abort.abort(); return; }
      closed = true;
      back.remove();
      window.removeEventListener("grs-license-change", onLicenseChange);
      document.removeEventListener("keydown", onKey, true);
      if (cfg.button) cfg.button.focus();
    }
    // ダイアログを開いている間は、ツール側のショートカット（Space で再生など）に届けない。
    // 伝播だけ止めるので、入力欄への文字入力やラジオの矢印キー操作はそのまま効く
    function onKey(e) {
      if (!document.body.contains(back)) return;
      if (document.querySelector(".grsp-backdrop")) return; // 購入案内を上に出しているとき
      e.stopPropagation();
      if (e.key === "Escape") { e.preventDefault(); if (!state.busy) close(); }
    }
    document.addEventListener("keydown", onKey, true);
    back.querySelector("#grsxCloseX").addEventListener("click", close);

    if (typeof VideoEncoder === "undefined" || typeof VideoFrame === "undefined") {
      body.innerHTML =
        '<p>このブラウザは動画の書き出しに対応していません。<br>パソコンの <b>Chrome / Edge の最新版</b>でお試しください（Safari は 16.4 以降で MP4 のみ対応）。</p>' +
        '<div class="grsx-actions"><button type="button" class="grsx-btn grsx-ghost" id="grsxCloseBtn">閉じる</button></div>';
      body.querySelector("#grsxCloseBtn").addEventListener("click", close);
      track("js_error", { error_message: "VideoEncoder unsupported", error_source: "video-export" });
      return;
    }

    // ── 設定画面 ──
    var size0 = adapter.getSize();
    var alpha = typeof adapter.paintFrame !== "function" && isAlphaStage(adapter.getStage());
    function scaleLabel(s) { var o = outputSize(size0, s); return o.width + "×" + o.height; }
    var SCALE_NAMES = { "0.75": "標準（540p）", "1.5": "高画質（HD）", "2": "最高画質（2K）" };
    // 有料の選択肢は語尾に冠を付ける（<option> の中には画像を置けないので絵文字）
    var CROWN = " 👑";
    var scales = (cfg.scales && cfg.scales.length) ? cfg.scales : [0.75, 1.5];
    // 有料の画質。ツールが画質を指定していなければ、高画質（1.5倍＝1080p）を有料にする
    var paidScales = cfg.paidScales || (cfg.scales ? [] : [1.5]);
    var fpsList = (cfg.fpsOptions && cfg.fpsOptions.length) ? cfg.fpsOptions : [30, 60];
    var FPS_NAMES = { "30": "30fps（標準）", "60": "60fps（なめらか・ファイル大）" };
    var scaleOptions = scales.map(function (s) {
      return '<option value="' + s + '">' + (SCALE_NAMES[String(s)] || "標準（" + scaleLabel(s) + "）") +
        (P && P.config.paywallEnabled && paidScales.indexOf(s) >= 0 && !P.canUse("hd_1080") ? CROWN : "") + "</option>";
    }).join("") +
      // 最高画質は有料化（paywallEnabled）してから出す。画質を固定しているツールには出さない
      (!cfg.scales && P && P.config.paywallEnabled ? '<option value="2">' + SCALE_NAMES["2"] + (P.canUse("hd_max") ? "" : CROWN) + "</option>" : "");
    var fpsOptions = fpsList.map(function (f) { return '<option value="' + f + '">' + (FPS_NAMES[String(f)] || f + "fps") + "</option>"; }).join("");
    // LINE などのアプリ内ブラウザでは保存できないことが多いので、書き出す前に知らせる（shared/export-cta.js）
    var inAppNote = (window.GRSExportCTA && window.GRSExportCTA.inAppDialogHtml) ? window.GRSExportCTA.inAppDialogHtml() : "";
    // 有料プランが有効なら「有料プラン有効（〜まで）」を一番上に出す
    var planStatus = (!cfg.free && P && P.statusHtml) ? P.statusHtml() : "";
    body.innerHTML = planStatus + inAppNote +
      '<div class="grsx-thumb"><canvas id="grsxThumb"></canvas></div>' +
      '<div class="grsx-field"><span>形式</span><div class="grsx-seg" data-name="format">' +
        (alpha
          ? '<label><input type="radio" name="grsxFormat" value="mov"><b>透過MOV <em class="grsx-tag">おすすめ</em></b></label>' +
            '<label><input type="radio" name="grsxFormat" value="mov_rle"><b>透過MOV <em class="grsx-tag">iMovie用</em></b></label>' +
            '<label><input type="radio" name="grsxFormat" value="png"><b>PNG連番 <em class="grsx-tag">上級者向け</em></b></label>'
          : '<label><input type="radio" name="grsxFormat" value="mp4"><b>MP4 <em class="grsx-tag">おすすめ</em></b></label>' +
            '<label><input type="radio" name="grsxFormat" value="webm"><b>WebM <em class="grsx-tag">PC向け</em></b></label>') +
      "</div></div>" +
      '<p class="grsx-note" id="grsxAlphaNote" hidden></p>' +
      '<p class="grsx-note grsx-webm-note" id="grsxWebmNote" hidden>WebM はスマホで再生できないことがあります。</p>' +
      '<div class="grsx-field"' + (cfg.free ? " hidden" : "") + '><span>透かし</span><div class="grsx-seg" data-name="mark">' +
        '<label><input type="radio" name="grsxMark" value="on"><b>あり</b></label>' +
        '<label><input type="radio" name="grsxMark" value="off"><b>なし ' +
          // 有料化前は「β版特典」として無料で消せることを控えめに伝える
          (P && !P.config.paywallEnabled ? '<em class="grsx-tag free">β版特典</em>' : tagHtml("no_watermark")) + "</b></label>" +
      "</div></div>" +
      '<div class="grsx-field"' + (scales.length < 2 && !(P && P.config.paywallEnabled && !cfg.scales) ? " hidden" : "") + '><span>画質</span><select class="grsx-select" id="grsxScale">' +
        scaleOptions +
      "</select></div>" +
      '<div class="grsx-field"' + (fpsList.length < 2 ? " hidden" : "") + '><span>なめらかさ</span><select class="grsx-select" id="grsxFps">' +
        fpsOptions +
      "</select></div>" +
      '<div class="grsx-field"><span>最後に止める</span><select class="grsx-select" id="grsxHold">' +
        '<option value="0">止めない</option><option value="1">1秒</option><option value="2">2秒</option><option value="3">3秒</option><option value="5">5秒</option>' +
      "</select></div>" +
      '<p class="grsx-summary" id="grsxSummary"></p>' +
      '<p class="grsx-warn" id="grsxSupport" hidden></p>' +
      '<div class="grsx-actions">' +
        '<button type="button" class="grsx-btn grsx-ghost" id="grsxCancelBtn">キャンセル</button>' +
        '<button type="button" class="grsx-btn grsx-primary" id="grsxStartBtn" data-track="export_start">書き出す</button>' +
      "</div>";

    var thumb = body.querySelector("#grsxThumb");
    var startBtn = body.querySelector("#grsxStartBtn");
    var supportEl = body.querySelector("#grsxSupport");
    function radio(name, v) {
      var el = body.querySelector('input[name="' + name + '"][value="' + v + '"]');
      if (el) el.checked = true;
    }
    function val(name) { var el = body.querySelector('input[name="' + name + '"]:checked'); return el ? el.value : ""; }

    // 形式は MP4 を最初に選ぶ（スマホで再生・写真アプリに保存できるため）。書き出せないブラウザだけ WebM にする
    radio("grsxFormat", alpha ? "mov" : "mp4");
    // ツール側に透かしの設定がある場合（格付けダービーのリアル競馬風）はそれに合わせる
    var mark0 = (typeof cfg.defaultWatermark === "function" && cfg.defaultWatermark()) || last.mark;
    radio("grsxMark", cfg.free || (mark0 === "off" && (!P || P.canUse("no_watermark"))) ? "off" : "on");
    var scaleSel = body.querySelector("#grsxScale");
    scaleSel.value = String(last.scale || scales[0]);
    if (!scaleSel.value) scaleSel.value = String(scales[0]);
    var fpsSel = body.querySelector("#grsxFps");
    fpsSel.value = String(last.fps || fpsList[0]);
    if (!fpsSel.value) fpsSel.value = String(fpsList[0]);
    body.querySelector("#grsxHold").value = String(last.hold != null ? last.hold : 2);

    function current() {
      return {
        format: val("grsxFormat") || "webm",
        mark: val("grsxMark") || "on",
        scale: num(body.querySelector("#grsxScale").value, 1),
        fps: num(body.querySelector("#grsxFps").value, 30),
        hold: num(body.querySelector("#grsxHold").value, 2)
      };
    }

    // サムネイル: いまのプレビューの絵＋（選んでいれば）透かし
    function drawThumb() {
      var c = current();
      var stage = adapter.getStage();
      if (alpha) thumb.style.background = "repeating-conic-gradient(#d9d9d9 0 25%,#fff 0 50%) 0 0/16px 16px";
      // スマホで設定タブを開いているときなど、プレビューが非表示なら見本は出さない
      thumb.parentNode.hidden = !stage.getBoundingClientRect().width;
      if (thumb.parentNode.hidden) return;
      var s = size0;
      var tw = Math.min(480, s.width), th = Math.round(tw * s.height / s.width);
      thumb.width = tw;
      thumb.height = th;
      var tctx = thumb.getContext("2d");
      if (typeof adapter.paintFrame === "function") {
        try {
          adapter.paintFrame(tctx, tw, th, { preview: true, watermark: c.mark === "on" });
          if (c.mark === "on" && !adapter.ownWatermark) {
            loadLogo().then(function () { if (closed) return; adapter.paintFrame(tctx, tw, th, { preview: true, watermark: true }); setMarkToneFrom(stage); drawWatermark(tctx, tw, th, 0); });
          }
        } catch (e) {}
        return;
      }
      var draw = function () {
        try {
          new Painter(tctx, stage, tw).paint();
          if (c.mark === "on") { setMarkToneFrom(stage); drawWatermark(tctx, tw, th, 0); }
        } catch (e) {}
      };
      draw();
      var w = ensureImages(stage);
      Promise.all([w, c.mark === "on" ? loadLogo() : null]).then(function () { if (!closed) draw(); });
    }

    var supportToken = 0;
    function refresh() {
      var c = current();
      var out = outputSize(size0, c.scale);
      var durMs = adapter.getDurationMs() + c.hold * 1000;
      var estBytes = bitrateFor(out.width, out.height, c.fps) * 0.55 * durMs / 8000;
      if (alpha) {
        estBytes = out.width * out.height * (c.format === "mov_rle" ? 0.2 : 0.12) * c.fps * durMs / 1000;
      }
      body.querySelector("#grsxSummary").innerHTML =
        "長さ 約" + esc(fmtSec(durMs)) + "・" + out.width + "×" + out.height + "・" + c.fps + "fps・推定 " + esc(fmtMB(estBytes)) + " 前後";
      body.querySelector("#grsxWebmNote").hidden = alpha || c.format !== "webm";
      var alphaNote = body.querySelector("#grsxAlphaNote");
      alphaNote.hidden = !alpha;
      alphaNote.textContent = !alpha ? "" : {
        mov: "PowerDirector・Filmora・CapCut など向け",
        mov_rle: "iMovie・Final Cut Pro 向け",
        png: "1コマずつの透過PNGをZIPで書き出します（連番読み込み用）"
      }[c.format];
      startBtn.setAttribute("data-track-export-format", alpha ? { mov: "mov_png_alpha", mov_rle: "mov_animation_alpha", png: "png_sequence" }[c.format] : c.format);
      startBtn.setAttribute("data-track-watermark", c.mark);
      startBtn.setAttribute("data-track-export-scale", c.scale + "x");
      startBtn.setAttribute("data-track-export-fps", String(c.fps));
      startBtn.setAttribute("data-track-aspect-ratio", aspectLabel(size0.width, size0.height));
      if (typeof cfg.trackParams === "function") {
        var tp = cfg.trackParams() || {};
        Object.keys(tp).forEach(function (k) { startBtn.setAttribute("data-track-" + k.replace(/_/g, "-"), String(tp[k])); });
      }
      var token = ++supportToken;
      formatSupported(c.format, out).then(function (ok) {
        if (token !== supportToken || closed) return;
        supportEl.hidden = ok;
        supportEl.textContent = ok ? "" : c.format === "mp4"
          ? "このブラウザでは、この画質の MP4 を書き出せません。WebM を選ぶか、画質を下げてください。"
          : "このブラウザでは、この画質の WebM を書き出せません。MP4 を選ぶか、画質を下げてください。";
        startBtn.disabled = !ok;
      });
    }

    body.addEventListener("change", function (e) {
      var t = e.target;
      // 書き出しが始まると中身がアンケートに替わるので、設定画面の入力だけを扱う
      if (!body.querySelector("#grsxScale") || !/^grsx/.test(t.name || t.id || "")) return;
      // 有料機能の選択・プレビューは止めない（判定は「書き出す」を押したとき。run() を参照）
      if (t.name === "grsxMark") drawThumb();
      refresh();
    });
    body.querySelector("#grsxCancelBtn").addEventListener("click", close);
    startBtn.addEventListener("click", function () { run(current()); });
    drawThumb();
    refresh();
    // MP4 を書き出せないブラウザでは、最初から WebM にしておく
    formatSupported("mp4", outputSize(size0, current().scale)).then(function (ok) {
      if (ok || closed || val("grsxFormat") !== "mp4") return;
      radio("grsxFormat", "webm");
      refresh();
    });
    startBtn.focus({ preventScroll: true });

    // ── 書き出し ──
    async function run(c) {
      // 有料化後：使われている有料機能をここでまとめて判定する（購入案内は1回だけ）
      if (P && P.config.paywallEnabled && !cfg.free) {
        var used = [];
        if (c.scale >= 2) used.push("hd_max");
        if (paidScales.indexOf(c.scale) >= 0) used.push("hd_1080");
        if (c.mark === "off") used.push("no_watermark");
        if (typeof adapter.paintFrame !== "function" && isAlphaStage(adapter.getStage())) used.push("transparent_export");
        if (typeof adapter.getPaidFeatures === "function") {
          try { used = used.concat(adapter.getPaidFeatures(c) || []); } catch (e) {}
        }
        var verdict = await P.gate(used, { from: "export_gate" });
        if (verdict === "cancel") return;
        if (verdict === "strip") {
          // 使えない有料機能をすべて標準に戻して書き出す
          var locked = P.lockedOf(used);
          c = Object.assign({}, c);
          if (locked.indexOf("hd_max") >= 0) c.scale = 1.5;
          if (locked.indexOf("hd_1080") >= 0) c.scale = scales[0];
          if (locked.indexOf("no_watermark") >= 0) c.mark = "on";
          if (locked.indexOf("transparent_export") >= 0) {
            var whiteBtn = document.querySelector('[data-bg-mode="white"]');
            if (whiteBtn) whiteBtn.click();
          }
          if (typeof adapter.stripPaidFeatures === "function") {
            try { adapter.stripPaidFeatures(locked); } catch (e) {}
          }
        }
      }
      try { localStorage.setItem("grs_export_prefs", JSON.stringify(c)); } catch (e) {}
      if (P) P.countExport();
      state.busy = true;
      abort = new AbortController();
      var SV = P ? ((cfg.surveyId && P.surveys && P.surveys[cfg.surveyId]) || P.survey) : null;
      var showSurvey = !!(SV && SV.shouldShow());
      body.innerHTML =
        '<div class="grsx-progress">' +
          '<div class="grsx-progress-text"><span id="grsxPhase">準備しています…</span><span id="grsxEta"></span></div>' +
          '<div class="grsx-bar"><i id="grsxBar"></i></div>' +
          '<p class="grsx-note">書き出し中はこの画面を閉じないでください。別のタブに移っても続きます。</p>' +
          '<div class="grsx-actions" id="grsxRunActions"><button type="button" class="grsx-btn grsx-ghost" id="grsxAbortBtn">中止</button></div>' +
        "</div>" +
        (showSurvey ? '<div class="grsx-survey" id="grsxSurvey"></div>' : "");
      back.querySelector("#grsxCloseX").hidden = true;
      body.querySelector("#grsxAbortBtn").addEventListener("click", function () { abort.abort(); });
      // アンケートを出すときは、書き出しが速く終わっても答える時間が残るよう、
      // 実際の進み具合をバーの 0〜90% に縮めて表示し、終わったあと 5 秒かけて 100% にする。
      // 回答・スキップしたらすぐ完了画面に進む。
      var surveyPending = false, surveyDoneResolve = null;
      var surveyDone = new Promise(function (res) { surveyDoneResolve = res; });
      if (showSurvey) {
        surveyPending = true;
        SV.render(body.querySelector("#grsxSurvey"), {
          features: cfg.surveyFeatures,
          context: { export_format: c.format, watermark: c.mark },
          onDone: function () { surveyPending = false; surveyDoneResolve(); }
        });
      }
      var BAR_SCALE = showSurvey ? 0.9 : 1;
      var bar = body.querySelector("#grsxBar"), phase = body.querySelector("#grsxPhase"), eta = body.querySelector("#grsxEta");
      var result = null, error = null;
      try {
        result = await encodeVideo({
          adapter: adapter,
          format: c.format,
          transparent: alpha,
          watermark: c.mark === "on",
          scale: c.scale,
          fps: c.fps,
          holdSec: c.hold,
          signal: abort.signal,
          onProgress: function (p) {
            var r = p.done / p.total * BAR_SCALE;
            bar.style.width = (r * 100).toFixed(1) + "%";
            phase.textContent = "書き出し中… " + Math.floor(r * 100) + "%";
            eta.textContent = p.done > 10 ? "残り 約" + fmtSec(p.etaMs) : "";
          }
        });
      } catch (e) {
        error = e;
      }
      if (!error && surveyPending) {
        eta.textContent = "";
        await new Promise(function (res) {
          var t0 = performance.now(), PAD_MS = 5000, timer = null;
          var finish = function () { clearInterval(timer); res(); };
          timer = setInterval(function () {
            var k = Math.min(1, (performance.now() - t0) / PAD_MS);
            var r = BAR_SCALE + (1 - BAR_SCALE) * k;
            bar.style.width = (r * 100).toFixed(1) + "%";
            phase.textContent = "書き出し中… " + Math.floor(r * 100) + "%";
            if (k >= 1 || abort.signal.aborted) finish();
          }, 100);
          surveyDone.then(finish);
        });
      }
      state.busy = false;
      back.querySelector("#grsxCloseX").hidden = false;
      var runBox = body.querySelector(".grsx-progress");
      if (error) {
        var cancelled = error && error.name === "AbortError";
        if (!cancelled) {
          try { console.error("[video-export]", error); } catch (e2) {}
          track("js_error", {
            error_message: String(error && error.message || error).slice(0, 100), error_source: "video-export",
            export_format: c.format, export_scale: c.scale + "x", export_fps: String(c.fps), watermark: c.mark,
            aspect_ratio: aspectLabel(size0.width, size0.height)
          });
        }
        runBox.innerHTML =
          (cancelled ? "<p>書き出しを中止しました。</p>"
            : '<p class="grsx-warn">書き出しに失敗しました：' + esc(error && error.message || error) + "</p>") +
          '<div class="grsx-actions"><button type="button" class="grsx-btn grsx-ghost" id="grsxBackBtn">設定に戻る</button>' +
          '<button type="button" class="grsx-btn grsx-primary" id="grsxCloseBtn">閉じる</button></div>';
        runBox.querySelector("#grsxCloseBtn").addEventListener("click", close);
        runBox.querySelector("#grsxBackBtn").addEventListener("click", function () { close(); openDialog(cfg); });
        return;
      }
      var fileName = (cfg.fileBase || "graphrace") + "-" + stamp() + "." + result.fileExt;
      var url = URL.createObjectURL(result.blob);
      var save = function () {
        var a = document.createElement("a");
        a.href = url;
        a.download = fileName;
        a.click();
      };
      save();
      runBox.innerHTML =
        '<p class="grsx-done">書き出しが完了しました</p>' +
        '<p class="grsx-note">' + esc(fileName) + "（" + esc(fmtMB(result.blob.size)) + "・" + result.size.width + "×" + result.size.height + "）を保存しました。</p>" +
        (result.audioSkipped ? '<p class="grsx-warn">このブラウザは音声の書き出しに対応していないため、音なしで保存しました。音を入れるにはパソコンの Chrome または Edge をお使いください。</p>' : "") +
        (result.failedImages ? '<p class="grsx-warn">画像 ' + result.failedImages + " 件は、画像のあるサイトが読み出しを許可していないため動画に入れられませんでした。画像をアップロードするか、別の画像URLに替えてください。</p>" : "") +
        '<div class="grsx-actions"><button type="button" class="grsx-btn grsx-ghost" id="grsxResaveBtn">もう一度保存</button>' +
        '<button type="button" class="grsx-btn grsx-primary" id="grsxCloseBtn">閉じる</button></div>';
      runBox.querySelector("#grsxResaveBtn").addEventListener("click", save);
      runBox.querySelector("#grsxCloseBtn").addEventListener("click", function () {
        close();
        setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
      });
    }
  }

  function stamp() {
    var d = new Date();
    var p = function (n) { return String(n).padStart(2, "0"); };
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + "-" + p(d.getHours()) + p(d.getMinutes());
  }

  function attach(cfg) {
    if (!cfg || !cfg.button || !cfg.adapter) return;
    if (cfg.previewMark !== false) { try { attachPreviewMark(cfg.adapter.getStage()); } catch (e) {} }
    cfg.button.addEventListener("click", function () {
      if (state.busy) return;
      if (!cfg.adapter.isReady()) {
        if (cfg.onNotReady) cfg.onNotReady();
        return;
      }
      openDialog(cfg);
    });
  }

  window.GRSVideoExport = {
    attach: attach,
    encode: encodeVideo,          // 検証・他ツール用
    paintStage: function (ctx, stage, outW) { new Painter(ctx, stage, outW).paint(); },
    ensureImages: ensureImages,
    drawWatermark: drawWatermark,
    _setMarkTone: function (stage) { setMarkToneFrom(stage); },
    _loadLogo: function () { return loadLogo(); },
    _codecs: CODECS,               // 検証用（対応コーデックの差し替え）
    get busy() { return state.busy; }
  };
})();
