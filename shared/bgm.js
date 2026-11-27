/*
 * GRSBgm — チャートレース（バー・線・円）共通の BGM
 *
 * - 曲は shared/audio/bgm/<mood>-<a|b>.mp3（各約60秒）。動画が長ければ同じ曲をクロスフェードでつないでくり返す
 * - しめくくり音（<mood>-end.mp3）は「音の鳴り終わり」が動画の最後にそろうように置き、
 *   BGM はその少し前から小さくして入れ替える（動画の最後の約5秒）
 * - 書き出し: mix() が AudioBuffer を作り、shared/video-export.js の adapter.getAudio() から渡す
 * - プレビュー: attachPreview() がツールの再生位置を見て、同じミックスを鳴らす
 * - 有料: FREE_TRACKS 以外は shared/export-plan.js の機能 "bgm"
 * 曲は ElevenLabs（Eleven Music）で生成。
 */
(function () {
  "use strict";

  var BASE = (function () {
    var s = document.currentScript && document.currentScript.src;
    return s ? s.replace(/[^/]*$/, "") + "audio/bgm/" : "/shared/audio/bgm/";
  })();

  // gain: 曲ごとの音量合わせ（RMS ≒ -18dB にそろえる。ピークを超えない範囲）
  // loopEnd: くり返しに使う範囲の終わり（末尾の無音を除く）秒
  var MOODS = {
    epic:    { label: "壮大（オーケストラ）", ending: { gain: 0.99, soundEnd: 3.3 } },
    pop:     { label: "明るいポップ",         ending: { gain: 1.05, soundEnd: 3.9 } },
    tech:    { label: "テック・エレクトロ",   ending: { gain: 0.98, soundEnd: 5.4 } },
    tense:   { label: "緊張感・接戦",         ending: { gain: 1.08, soundEnd: 5.1 } },
    comical: { label: "コミカル",             ending: { gain: 1.04, soundEnd: 2.9 } }
  };
  var TRACKS = {
    "epic-a":    { gain: 0.85, loopEnd: 59.5 },
    "epic-b":    { gain: 0.79, loopEnd: 59.2 },
    "pop-a":     { gain: 0.92, loopEnd: 59.7 },
    "pop-b":     { gain: 0.71, loopEnd: 59.6 },
    "tech-a":    { gain: 0.87, loopEnd: 59.8 },
    "tech-b":    { gain: 0.79, loopEnd: 59.3 },
    "tense-a":   { gain: 0.97, loopEnd: 60.0 },
    "tense-b":   { gain: 0.71, loopEnd: 59.8 },
    "comical-a": { gain: 1.12, loopEnd: 59.6 },
    "comical-b": { gain: 0.98, loopEnd: 59.5 }
  };
  var FREE_TRACKS = { "comical-a": true, "tense-a": true };
  var ORDER = ["epic-a", "epic-b", "pop-a", "pop-b", "tech-a", "tech-b", "tense-a", "tense-b", "comical-a", "comical-b"];

  var LOOP_XFADE = 1.5;    // くり返しのつなぎ目（秒）
  var BGM_FADE = 1.2;      // しめくくり音の前に BGM を小さくする時間（秒）
  var END_LEAD = 0.15;     // しめくくり音の鳴り終わりを最後のフレームより少し前に置く（秒）
  var TAIL_FADE = 0.8;     // しめくくり音なしのときの最後のフェードアウト（秒）
  var RATE = 48000;

  function moodOf(id) { return String(id || "").replace(/-[ab]$/, ""); }
  function isTrack(id) { return !!TRACKS[id]; }
  function isPaid(id) { return isTrack(id) && !FREE_TRACKS[id]; }
  function trackLabel(id) {
    var m = MOODS[moodOf(id)];
    return m ? m.label + " " + id.slice(-1).toUpperCase() : "";
  }

  // ── 読み込み（デコード済みを使い回す）──
  var cache = {};
  function load(name) {
    if (!cache[name]) {
      cache[name] = fetch(BASE + name + ".mp3")
        .then(function (r) { if (!r.ok) throw new Error("bgm " + r.status); return r.arrayBuffer(); })
        .then(function (ab) { return new OfflineAudioContext(2, RATE, RATE).decodeAudioData(ab); })
        .catch(function (e) { delete cache[name]; throw e; });
    }
    return cache[name];
  }

  /*
   * totalSec 秒ぶんの音を作る。opts: { volume: 0〜1, ending: true/false }
   */
  async function mix(id, totalSec, opts) {
    if (!isTrack(id) || !(totalSec > 0)) return null;
    opts = opts || {};
    var vol = opts.volume == null ? 0.8 : Math.max(0, Math.min(1, opts.volume));
    var mood = moodOf(id), meta = TRACKS[id], endMeta = MOODS[mood].ending;
    var useEnding = opts.ending !== false;
    var main = await load(id);
    var end = useEnding ? await load(mood + "-end").catch(function () { return null; }) : null;

    var T = totalSec;
    var ctx = new OfflineAudioContext(2, Math.max(1, Math.ceil(T * RATE)), RATE);
    var master = ctx.createGain();
    master.gain.value = vol;
    master.connect(ctx.destination);

    // しめくくり音の位置。動画が短すぎるときはしめくくり音だけ（先頭から）
    var endStart = null;
    if (end) {
      var soundEnd = Math.min(endMeta.soundEnd, end.duration);
      endStart = Math.max(0, T - END_LEAD - soundEnd);
    }
    var bgmEnd = endStart == null ? T : endStart + 0.4;   // しめくくり音に少し重ねてから消す

    // BGM 本体：同じ曲をクロスフェードでつなぐ
    var bus = ctx.createGain();
    bus.gain.value = meta.gain;
    bus.connect(master);
    var seg = Math.min(meta.loopEnd, main.duration);
    var step = seg - LOOP_XFADE;
    if (bgmEnd > 0.05) {
      for (var t = 0, k = 0; t < bgmEnd; t += step, k++) {
        var src = ctx.createBufferSource();
        src.buffer = main;
        var g = ctx.createGain();
        var len = Math.min(seg, bgmEnd - t);
        if (k > 0) { g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(1, t + LOOP_XFADE); }
        else g.gain.setValueAtTime(1, 0);
        if (t + seg < bgmEnd) {   // 次の回とのつなぎ目で消えていく
          g.gain.setValueAtTime(1, t + seg - LOOP_XFADE);
          g.gain.linearRampToValueAtTime(0, t + seg);
        }
        src.connect(g); g.connect(bus);
        src.start(t, 0, len);
      }
      // 終わり方：しめくくり音の前にフェード、無いときは最後にフェード
      var fadeLen = endStart == null ? Math.min(TAIL_FADE, T / 4) : Math.min(BGM_FADE, bgmEnd / 2);
      bus.gain.setValueAtTime(meta.gain, Math.max(0, bgmEnd - fadeLen));
      bus.gain.linearRampToValueAtTime(0.0001, bgmEnd);
    }

    if (end) {
      var es = ctx.createBufferSource();
      es.buffer = end;
      var eg = ctx.createGain();
      eg.gain.value = endMeta.gain;
      es.connect(eg); eg.connect(master);
      es.start(endStart, 0, Math.max(0.01, T - endStart));
    }
    return ctx.startRendering();
  }

  // ── プレビュー ──────────────────────────────────────
  /*
   * opts.getState() が { playing, sec, total, rate, trackId, volume, ending } を返す。
   * sec/total は「書き出したときの時間」（倍速の影響なし）。rate は倍速（音もその速さで鳴らす）
   */
  function attachPreview(opts) {
    var actx = null, src = null, gainNode = null, startedAt = 0, startedSec = 0, curRate = 1;
    var key = "", buf = null, pending = null, wanted = "";

    function stop() {
      if (src) { try { src.stop(); } catch (e) {} src.disconnect(); src = null; }
    }
    function curSec() { return startedSec + (actx.currentTime - startedAt) * curRate; }
    function start(sec, rate) {
      stop();
      if (!buf || sec >= buf.duration) return;
      src = actx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = rate;
      src.connect(gainNode);
      startedAt = actx.currentTime; startedSec = sec; curRate = rate;
      src.start(0, Math.max(0, sec));
    }
    function tick() {
      requestAnimationFrame(tick);
      var s;
      try { s = opts.getState(); } catch (e) { return; }
      if (!s || !s.playing || !isTrack(s.trackId) || !(s.total > 0)) { stop(); return; }
      if (!actx) {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        actx = new AC();
        gainNode = actx.createGain();
        gainNode.connect(actx.destination);
      }
      if (actx.state === "suspended") actx.resume();
      var k = [s.trackId, s.total.toFixed(2), s.volume, s.ending].join("|");
      if (k !== key) {
        if (wanted !== k) {
          wanted = k; stop();
          pending = mix(s.trackId, s.total, { volume: s.volume, ending: s.ending }).then(function (b) {
            if (wanted === k) { buf = b; key = k; }
          }).catch(function (e) { console.warn("[bgm]", e); });
        }
        return;
      }
      var rate = s.rate > 0 ? s.rate : 1;
      // 鳴らし始め直後は音声側の時計が進み出すまで少し遅れるので、ずれの判定を待つ
      var settling = src && actx.currentTime - startedAt < 0.6;
      if (!src || rate !== curRate || (!settling && Math.abs(curSec() - s.sec) > 0.25)) start(s.sec, rate);
    }
    requestAnimationFrame(tick);
    return { stop: stop };
  }

  window.GRSBgm = {
    TRACKS: ORDER.slice(),
    isTrack: isTrack,
    isPaid: isPaid,
    isFree: function (id) { return !!FREE_TRACKS[id]; },
    label: trackLabel,
    load: load,
    mix: mix,
    attachPreview: attachPreview
  };
})();
