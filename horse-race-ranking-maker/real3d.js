/* =====================================================================
   格付けダービー ─ リアル競馬風ランキング動画エンジン (3D)
   ---------------------------------------------------------------------
   index.html から「リアル競馬風」に切り替えたときだけ読み込まれる。
   初期表示では読まないので、通常の競馬風(2D)の表示速度には影響しない。

   このファイルは描画エンジンだけを持ち、UI は一切持たない。
   出走馬もレース設定もホスト側(index.html)の共通ストアが唯一の真実で、
   ここへは Real3D.applyConfig() で渡ってくる。
   画面への反映(タイムライン・実況ラベル等)は on() のイベントで返す。

   前提: three.js r128 / GLTFLoader / SkeletonUtils が先に読み込まれていること。

   設計方針 (プロトタイプから引き継ぎ):
   - フレーム番号駆動 (t = frame / FPS) : プレビューと書き出しの一致を保証
   - 進行度(0..1)ベース : 動画長・コース長が変わってもカメラ台本が崩れない
   - mixer.update(delta) は使わない : シークしても結果が変わらないようにするため

   © 2026 Koh — GraphRace Studio (https://graphrace-studio.com/)
   本ファイルは https://graphrace-studio.com/horse-race-ranking-maker/ 専用の描画エンジンです。
   無断複製・転載・改変配布を禁じます。 Fingerprint: GRS-HRM-8f3a2e91-R3D
   ===================================================================== */
(function(global){
"use strict";

const FPS = 30;
/* ゲート待機: カウントダウン無しなら 0.3秒でスタート。
   カウントダウン有効時は 3秒(3→2→1)がそのまま待機時間になる */
const GATE_SEC = 0.3, RESULT_SEC = 2, COUNTDOWN_SEC = 3;
function gateSecOf(){ return (cfg && cfg.countdown) ? COUNTDOWN_SEC : GATE_SEC; }

function clamp(v,a,b){return Math.min(b,Math.max(a,isNaN(v)?a:v));}

/* 見せ方の設定。レースの中身(cfg)とは別に持つ。
   コースマップや隊列パネルの表示はレースを組み直さずに切り替えられる */
/* showMark = 透かし(ロゴ+名前)を出すか。
   いまはホストが誰でも切れるようにしているが、将来は有料ユーザー限定・
   都度課金にする想定。判定はホスト側に置き、エンジンは言われたとおり描く */
const view={ aspect:"16:9", showMap:true, showField:true, showMark:true };
const ASPECTS={ "16:9":16/9, "9:16":9/16, "1:1":1 };
function currentAspect(){ return ASPECTS[view.aspect] || 16/9; }

/* ホストへの通知。エンジンは画面のどこにも直接書き込まない */
const listeners={frame:[],playing:[],shot:[],ready:[],ended:[]};
function emit(name,payload){
  for(const fn of (listeners[name]||[]).slice()){
    try{ fn(payload); }catch(e){ console.error("[real3d] "+name+" ハンドラで例外:",e); }
  }
}

/* 走路の半幅[m]。全長24mはJRAの芝コース(20〜30m)の実寸レンジ。
   16頭のゲート(1.35m×16=21.6m)が収まる幅から決めている。
   ラチ・距離標・スタンド位置・走行レーンの内外clampは全てここから導出する */
const TRACK_HALF = 12;

/* 走路の内側を指す単位ベクトル。
   コースの回り方(左/右)で内外が反転するので、必ずこれを通して求める。
   直接 (tan.z,0,-tan.x) と書くと右回りで内外が逆になる */
function normalOf(tan){
  const h = course ? course.hand : 1;
  return new THREE.Vector3(tan.z*h, 0, -tan.x*h);
}
const GATE_LANE_W = 1.35;   // ゲート1房の幅 = 発走直後の馬間隔[m]

/* ================= コースプリセット =================
   「コースを選ぶ = レース距離と尺が決まる」方式。
   馬の速度は実測ベースで固定し、動画の長さはそこから逆算する
   (距離が短いほど平均速度が速いのも実際どおり)。

   straight/radius はオーバルの実寸[m]。raceLen との組み合わせで
   スタート地点が決まる = どのコーナーから走り出すかが決まる。 */
const COURSE_PRESETS = {
  short: { label:"ショート", raceLen:469,  straight:210, radius:64,  runOut:60,  speed:17.5,
           note:"向正面から118mの助走→ワンターン→最終直線150m。ゴール後も60mの直線が残る" },
  local: { label:"小回り",   raceLen:1000, straight:299, radius:64,  runOut:110, speed:17.4,
           note:"1周1000mをちょうど1周。地方競馬場サイズ。助走→1〜2角→向正面→3〜4角→最終直線189m" },
  tokyo: { label:"広い",     raceLen:2400, straight:600, radius:167, runOut:150, speed:16.7,
           note:"東京競馬場に近い構成 (1周2249m)。スタンド前から助走300m、2コーナーを回って最終直線450m" },
};

/* ---------- 乱数 (シード付き・決定論) ---------- */
function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;
  let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;
  return((t^t>>>14)>>>0)/4294967296;}}

/* ---------- コース曲線 (スタジアム型オーバル) ----------
   弧長 d[m] → 位置/接線。 raceLen に応じて直線・半円を構成 */
class Course {
  /* hand: +1 = 左回り / -1 = 右回り。
     z を反転させてオーバルを鏡像にすることで実現する。
     弧長・直線長・コーナー半径・スタート/ゴール位置は一切変わらないので、
     タイム・着差・戦術パラメータはそのまま通用する */
  constructor(raceLen, straight, radius, runOut, hand){
    this.raceLen = raceLen;
    this.hand = (hand===-1) ? -1 : 1;
    this.straight=straight; this.radius=radius;
    this.runOut = runOut || 0;
    this.total = 2*this.straight + 2*Math.PI*this.radius;
    /* ゴール板はホームストレートの終端ではなく、そこから runOut だけ手前に置く。
       実際の競馬場と同じく、ゴール後もしばらく直線が続く区間(ウイニングラン)を
       確保するため。ここが0だとゴールした瞬間にコーナーへ入るので、
       決勝線を過ぎた馬が全部内側に倒れた姿勢で映ってしまう。
       スタート = ゴールから raceLen 手前 */
    this.dGoal  = this.straight - this.runOut;
    this.dStart = ((this.dGoal - raceLen) % this.total + this.total) % this.total;
  }
  // 弧長d(m) → {pos:Vector3, tan:Vector3}  y=0平面
  point(d){
    d = ((d % this.total) + this.total) % this.total;
    const L=this.straight, R=this.radius;
    let x,z,tx,tz;
    if(d < L){ x=-L/2+d; z=R; tx=1; tz=0; }
    else if(d < L+Math.PI*R){
      const a=(d-L)/R;
      x=L/2+R*Math.sin(a); z=R*Math.cos(a);
      tx=Math.cos(a); tz=-Math.sin(a);
    }
    else if(d < 2*L+Math.PI*R){
      x=L/2-(d-L-Math.PI*R); z=-R; tx=-1; tz=0;
    } else {
      const a=(d-2*L-Math.PI*R)/R;
      x=-L/2-R*Math.sin(a); z=-R*Math.cos(a);
      tx=-Math.cos(a); tz=Math.sin(a);
    }
    const h=this.hand;   // 右回りは z を反転した鏡像
    return { pos:new THREE.Vector3(x,0,z*h), tan:new THREE.Vector3(tx,0,tz*h) };
  }
  /* 弧長d における曲率 (1/R)。直線=0、コーナー=1/radius。
     馬の旋回時の傾き(リーン)を出すのに使う。
     コーナーの出入り口で急に切り替わらないよう、前後8mを均して滑らかにする */
  curvature(d){
    const L=this.straight, R=this.radius, T=this.total;
    const on=(x)=>{ x=((x%T)+T)%T; return (x<L || (x>=L+Math.PI*R && x<2*L+Math.PI*R)) ? 0 : 1/R; };
    let sum=0; const N=5, span=8;
    for(let k=0;k<N;k++) sum+=on(d + (k/(N-1)-0.5)*span);
    return sum/N;
  }
  /* スタート地点から最初のコーナー入口までの直線距離[m]。
     実際の競馬場は必ずここに助走区間があり、0だとゲートを出た瞬間に
     曲がることになって隊列が作れない。プリセット設計時の検証用 */
  runUpMeters(){
    const L=this.straight, T=this.total, R=this.radius;
    let d=this.dStart;
    for(let i=0;i<2000;i++){
      if(this.curvature(d)>0) return i;   // 1mずつ進めてコーナーに入った地点
      d=(d+1)%T;
    }
    return 0;
  }
  // 進行度p(0..1) + レーンオフセット(m, +で外側) → 位置と接線
  sample(p, lane=0){
    const d = this.dStart + p*this.raceLen;
    const {pos,tan} = this.point(d);
    /* 法線 = 接線を右90°回転 → コース内側を向く (回り方で符号が反転)。
       したがって lane は「正が内、負が外」。
       normalOf() はグローバルな course を見るため、
       コース生成中(まだ course に代入されていない)に呼ぶと向きを誤る */
    const n = new THREE.Vector3(tan.z*this.hand, 0, -tan.x*this.hand);
    pos.addScaledVector(n, lane);
    return {pos, tan};
  }
}

/* ---------- レース展開エンジン ----------
   着順は保証しつつ、道中はノイズで入れ替わる。ゴール接近でノイズ減衰 */
class RacePlan {
  constructor(numHorses, finishOrder, seed, styleOverrides, algo){
    // finishOrder[i] = 馬iの着順(1始まり)
    // styleOverrides[i] = "auto" | "oonige" | "nige" | "senko" | "sashi" | "oikomi"
    // algo = "drama"(波乱: 演出重視) | "real"(リアル: 実戦シミュレーション)
    this.n = numHorses;
    this.algo = algo || "drama";
    const rng = mulberry32(seed);
    this.horses = [];

    /* ============ 脚質の割り当て ============
       大逃げ: 逃げのうち、2番手以下を大きく引き離して単騎で行く
       逃げ:   道中先頭を引っ張る
       先行:   好位2〜4番手
       差し:   中団待機から伸びる
       追込:   最後方待機からの末脚
       手動指定された馬はそれを尊重し、「自動」の馬だけシードで抽選。
       自動枠には最低1頭の逃げを保証 (手動で逃げがいる場合は不要)

       [波乱] 見せ場ブースト(kick)と叩き合い(duel)で山場を演出。
              仕掛けは短く鋭く、直線でドラマが起きる
       [リアル] kickなし。各馬はスタートからゴールまで役割を一貫遂行し、
              仕掛け窓を広く取った持続的なロングスパートで
              自然に順位が入れ替わる。人工的な山は作らない */
    const STYLE_SETS={
      drama:{
        /* 大逃げは逃げの延長線上。道中の位置を大きく前に取り、
           見せ場ブーストも逃げより早く・大きくして後続を突き放す。
           着順どおりに決着させる仕組みは他の脚質とまったく同じなので、
           1着なら逃げ切り、下位なら失速して飲み込まれる形になる */
        oonige:{name:"大逃げ",earlyM:[ 32.0,4.0], moveM:[200, 30], kick:{atM:330,widthM:90,amp:3.0}},
        nige:  {name:"逃げ", earlyM:[ 16.0,3.0], moveM:[160, 30], kick:{atM:270,widthM:70,amp:2.0}},
        senko: {name:"先行", earlyM:[  6.0,4.0], moveM:[300,130], kick:null},
        sashi: {name:"差し", earlyM:[ -6.0,4.5], moveM:[260, 70], kick:{atM:200,widthM:60,amp:0.9}},
        oikomi:{name:"追込", earlyM:[-16.0,5.0], moveM:[180, 35], kick:{atM:110,widthM:45,amp:1.3}},
      },
      real:{
        /* 実戦の隊列: 逃げが単騎で前、後ろは脚質ごとの「団子(集団)」を作る。
           earlyM = [基準となる前後位置(m), そこからのばらつき(±m)]
           脚質どうしは大きく離し、同じ脚質の中はほどよくばらけさせることで、
           中継で見る「いくつかの塊が間隔を空けて連なる」隊列になる。
           以前は全体が17mほどしかなく、16頭では1頭あたり1.1m間隔=横一線に
           見えていた。実際の中盤は先頭から最後尾まで40〜60mある。
           moveM = [仕掛け開始, 仕掛け完了] の残り距離(m)

           逃げ:   スタートからゴールまで先頭。前に行かせない勝負根性。
                   スタミナ型なので早めから粘り、最後まで渋太い
           大逃げ: 逃げのさらに前。テンから飛ばして単騎で大きく離し、
                   後続とは常に馬群ひとつぶんの差を空けて走る。
                   離した脚は使ってしまっているので、仕掛けどころで
                   後続が押し上げてくると差は急速に詰まっていく
           先行:   3〜4番手の好位。直線で一気に先頭に立って押し切る
           差し:   中団〜後方待機。3〜4コーナーからロングスパート
           追込:   後方・最後尾で待機。直線で脚を爆発、ゴール寸前で決着 */
        oonige:{name:"大逃げ",earlyM:[ 40.0,3.0], moveM:[520, 45], kick:null, ten:[3.5,1.0]},
        nige:  {name:"逃げ", earlyM:[ 20.0,2.5], moveM:[420, 30], kick:null, ten:[2.0,0.8]},
        senko: {name:"先行", earlyM:[  8.0,4.0], moveM:[330, 60], kick:null, ten:[0.7,0.4]},
        sashi: {name:"差し", earlyM:[ -7.0,5.0], moveM:[620,110], kick:null, ten:null},
        oikomi:{name:"追込", earlyM:[-20.0,6.0], moveM:[240, 15], kick:null, ten:null},
      },
    };
    const STYLES=STYLE_SETS[this.algo] || STYLE_SETS.drama;
    const ov = styleOverrides || [];
    const styleKeys = new Array(numHorses).fill(null);
    const autoIdx = [];
    let manualNige = 0, manualOonige = 0;
    for(let i=0;i<numHorses;i++){
      const v = ov[i];
      if(v && v!=="auto" && STYLES[v]){
        styleKeys[i]=v;
        // 大逃げも「前に行く馬」なので、逃げの保証数にはこちらも数える
        if(v==="nige"||v==="oonige") manualNige++;
        if(v==="oonige") manualOonige++;
      } else autoIdx.push(i);
    }
    // 自動枠の抽選プール: 逃げの保証数を確保してから残りを配分
    const pool=[];
    const nigeNeed=Math.max(0, (numHorses>=13?3:numHorses>=8?2:1) - manualNige);
    for(let k=0;k<Math.min(nigeNeed, autoIdx.length);k++) pool.push("nige");
    /* 自動枠の逃げのうち1頭だけを、たまに大逃げへ格上げする。
       ・「2番手以下を大きく引き離す」脚質なので、複数いると成立しない。
         だから自動で作るのは最大1頭
       ・手動で大逃げを指定した馬がいるなら、自動では作らない (指定を優先)
       抽選は本流とは別の乱数列で引く。こうすると大逃げが出なかった回は
       乱数の消費が増えず、同じシードで以前とまったく同じ展開が再現される */
    const OONIGE_CHANCE=0.30;
    if(!manualOonige && pool.length && mulberry32((seed>>>0)^0x5f3a7b1)()<OONIGE_CHANCE){
      pool[0]="oonige";
    }
    while(pool.length<autoIdx.length){
      const r=rng();
      pool.push(r<0.40?"senko" : r<0.72?"sashi" : "oikomi");
    }
    // プールをシャッフルして自動枠に割り当て
    for(let k=pool.length-1;k>0;k--){
      const j=(rng()*(k+1))|0;[pool[k],pool[j]]=[pool[j],pool[k]];}
    autoIdx.forEach((horse,p)=>{ styleKeys[horse]=pool[p]; });
    this.styleNames = styleKeys.map(k=>STYLES[k].name);

    /* --- ゴールの着差を抽選 ---
       表記はJRA成績表と同じ書式 (「馬身」は付けず、端数は 1.1/2 のドット表記)。
       数値は 1馬身 = 2.4m 換算 */
    const MARGINS=[
      ["ハナ",0.10],["アタマ",0.25],["クビ",0.45],["1/2",1.2],
      ["3/4",1.8],["1",2.4],["1.1/2",3.6],["2",4.8],
      ["2.1/2",6.0],["3",7.2],["4",9.6],["5",12.0],
      ["7",16.8],["大差",24.0],
    ];
    const cumMeters=[0];
    this.marginNames=[];
    for(let r=2;r<=numHorses;r++){
      const k=(rng()*MARGINS.length)|0;
      cumMeters.push(cumMeters[r-2]+MARGINS[k][1]);
      this.marginNames.push(MARGINS[k][0]);
    }
    this.cumMeters=cumMeters;

    for(let i=0;i<numHorses;i++){
      const rank = finishOrder[i];
      const st = STYLES[styleKeys[i]];
      // 道中の位置: 脚質の基準位置 + ばらつき (m)
      const earlyMeters = st.earlyM[0] + (rng()-0.5)*2*st.earlyM[1];
      // 仕掛けのタイミング: 脚質基準に個体差
      // (リアルは役割を一貫させるため個体差を小さく取る)
      const jitW = this.algo==="real" ? 14 : 40;
      const jit=()=> (rng()-0.5)*jitW;
      const moveStartM = st.moveM[0]+jit();
      const moveEndM   = Math.max(12, st.moveM[1]+jit()*0.5);
      // 見せ場ブースト: 仕掛け中に一瞬だけ余計に伸びる山 (m)
      const kick = st.kick
        ? {atM:st.kick.atM+jit()*0.5, widthM:st.kick.widthM,
           amp:st.kick.amp*(0.7+rng()*0.6)}
        : null;
      const finalMeters = cumMeters[rank-1];
      // テンの主張 (リアル): ハナを取りに行く序盤の一時加速
      const tenMeters = st.ten ? st.ten[0]+(rng()-0.5)*2*st.ten[1] : 0;
      /* 道中の位置取り変化 (リアルのみ・約1〜2割の馬):
         中盤以降にじわりと押し上げる / 少し控える。
         それ以外の馬は役割どおりの位置を一定に保つ */
      let driftMeters=0, driftWin=null;
      const isFront = styleKeys[i]==="nige" || styleKeys[i]==="oonige";
      if(this.algo==="real" && !isFront && rng()<0.15){
        const advance = earlyMeters < -5 ? true : rng()<0.5; // 後方は押し上げのみ
        driftMeters = advance ? 1.8+rng()*2.4 : -(1.5+rng()*1.8);
        const start = 0.38+rng()*0.14;          // レースの38〜52%地点から
        driftWin = [start, Math.min(0.80, start+0.26+rng()*0.10)];
      }
      // 道中の微揺れ
      const waves=[];
      for(let w=0;w<2;w++){
        waves.push({ f:3+rng()*3, ph:rng()*Math.PI*2, amp:0.0012+rng()*0.0015 });
      }
      // 叩き合い: 波乱モードのみ・1-2着がクビ以内のときだけ
      // (リアルモードでは人工的な揺れを加えず、僅差でも滑らかに決着する)
      const gap12=cumMeters[1]??99;
      const duel = (this.algo==="drama" && rank<=2 && gap12<=0.5)
        ? {amp:Math.min(0.0022, gap12*0.004+0.0008), ph:(rank===1?0:Math.PI)}
        : null;
      this.horses.push({ rank, earlyMeters, moveStartM, moveEndM, kick,
                         finalMeters, tenMeters, driftMeters, driftWin,
                         waves, duel });
    }
  }
  /* コース長確定後、メートル指定を進行度に換算。
     各馬が自分のタイミングで「道中位置 → 最終着差位置」へ遷移する */
  bindCourse(raceLen){
    this.raceLen=raceLen;
    /* 戦術パラメータの距離補正
       ------------------------------------------------------------
       仕掛けどころ(残り600m前後)は実戦では距離に依らずほぼ絶対値。
       なので基準1200m以上ではそのまま使い、短いコースでのみ比率で縮める。
       こうしないと「残り620mから仕掛け」が469mのコースで進行度マイナスになり、
       スタート時点で全馬が全開 = 脚質の描き分けが消える。

       縮めるのは「レースのどのタイミングか」を表す量だけ。
       着差・隊列の間隔・ブーストの伸び幅は物理距離なので据え置く。 */
    const k = Math.min(1, raceLen/1200);
    this.tacticK = k;
    const m=(x)=>1-x*k/raceLen; // 残りx[m](距離補正込み) → 進行度
    for(const h of this.horses){
      h.earlyOffset = h.earlyMeters/raceLen;
      h.finalOffset = -h.finalMeters/raceLen;
      /* --- 仕掛けの完了を「その馬自身のゴール」に合わせて後ろへ延ばす ---
         進行度は base(先頭基準の時計) + offset で、offset が定数になった時点で
         全馬の間隔が凍る = 順位が動かなくなる。従来は全馬が同じ地点で
         凍っていたため、1着がゴールする数秒前から最後尾まで並びが固定され、
         後方の決着も「もう決まった隊列がただ流れてくる」だけになっていた。

         その馬が線を越えるのは base = 1 + 着差/raceLen (= finishBase)。
         そこから SETTLE_M 手前までは動き続けてよい。
         後ろの馬ほど finishBase が大きいので、上位が入線した後も
         下位はまだ動いている = 後方の攻防が最後まで続く。

         最終着順は崩れない: 各馬は自分のゴール手前 SETTLE_M で
         必ず finalOffset に収束し、そこから線までは一定の間隔で走る。
         進行度は単調増加を保証してあるので、収束点より前に線を越えることもない */
      const SETTLE_M = 12;
      h.finishBase = 1 + h.finalMeters/raceLen;
      h.move=[m(h.moveStartM),
              Math.max(m(h.moveEndM), h.finishBase - SETTLE_M/raceLen)];
      h.tenOffset = h.tenMeters/raceLen;
      h.driftOffset = h.driftMeters/raceLen;
      if(h.kick){
        h.kickCenter=m(h.kick.atM);
        h.kickSigma=h.kick.widthM*k/raceLen;
        h.kickAmp=h.kick.amp/raceLen;
      }
    }
    /* --- 進行度の単調性を保証する ---
       「道中の位置 → 最終着差の位置」への遷移が、着差の大きさに対して
       窓が狭すぎると d(進行度)/d(時刻) が負になり、馬が後ろ向きに滑る。
       歩容は走行距離で駆動しているので、同時に脚のコマも止まって見える。
       (着差の合計が大きい回 × 短いコース で顕著に出ていた)

       遷移窓の最大傾きは 1.5/幅 なので、必要な幅を逆算して前へ広げる。
       広げきれない場合もあるが、そのぶん傾きは緩和される。
       BUDGET_* = 先頭のペースに対して各項が食ってよい速度の割合 */
    const BUDGET_MOVE = 0.45, BUDGET_KICK = 0.12;
    for(const h of this.horses){
      const dOff = Math.abs(h.finalOffset - h.earlyOffset)
                 + Math.abs(h.driftOffset || 0);
      const need = dOff*1.5/BUDGET_MOVE;
      if(h.move[1]-h.move[0] < need) h.move[0] = Math.max(0, h.move[1]-need);
      if(h.kick){
        // ガウス山の最大傾きは 0.858*amp/sigma。同じ制約に収める
        const minSigma = 0.858*Math.abs(h.kickAmp)/BUDGET_KICK;
        if(h.kickSigma < minSigma) h.kickSigma = minSigma;
      }
    }
    // ノイズ減衰と叩き合いの窓 (残り距離基準)
    this.calmStart=m(320);      // 残り320mで道中の微揺れが消え始める
    this.duelRise=[m(200), m(150)];
    this.duelFade=[m(55),  m(12)];
    /* リアルモードの道中フェーズ:
       テン:     序盤の先行争い。短く収束して隊列が固まる
       押し上げ: 残り600m→350m。勝負どころで隊列が詰まる
                 (道中は動かさない: 3〜4コーナーからの押し上げに限定) */
    this.tenCenter = Math.min(0.18, 130*k/raceLen);
    this.tenSigma  = 90*k/raceLen;
    this.squeeze   = [m(600), m(350)];
  }
  // 時刻t(0..1) → 馬iの進行度
  /* 隊列の広がり具合 (0..1)。
     実戦では、発走後しばらくは全馬が固まって走り、ペースが落ち着くにつれて
     脚質どおりの位置に散って縦長になっていく。
     以前は発走90mで隊列が完成し、そのまま最後まで同じ縦長を保っていたので、
     序盤から後方勢が離れすぎていた。

     ここが返すのは「脚質による前後差」に掛ける倍率。
     最終着差(finalOffset)には掛けないので、ゴールの着差は影響を受けない */
  spreadGrow(base){
    const START=0.30;   // 発走直後の広がり (完成形の30%)
    return START + (1-START)*smoothstep(120/this.raceLen, 0.50, base);
  }

  progress(i, t){
    const h = this.horses[i];
    const base = t / 0.96;   // 先頭基準: t=0.96で進行度1.0
    const grow = this.spreadGrow(base);
    let offset;
    if(this.algo==="real"){
      /* --- リアル: 実戦のレース運び ---
         1. テン: 逃げ・先行がハナを主張して飛び出す (一時的な加速)
         2. 道中: 縦長の隊列をほぼ保つ。約3割の馬だけ、
            ゆっくり押し上げる/控える位置取りの変化をする
         3. 3〜4角: 残り850mから隊列が圧縮 (後方勢の押し上げ)
         4. 直線: ロングスパートで各馬の役割どおりに決着へ */
      let e0 = h.earlyOffset;
      if(h.driftWin){ // 道中の位置取り変化 (数百mかけて緩やかに)
        e0 += h.driftOffset * smoothstep(h.driftWin[0], h.driftWin[1], base);
      }
      const sq = smoothstep(this.squeeze[0], this.squeeze[1], base);
      // 序盤は密→中盤以降に縦長へ。勝負どころではやや圧縮
      const effEarly = e0 * grow * (1 - 0.28*sq);
      const s = smoothstep(h.move[0], h.move[1], base);
      offset = effEarly + (h.finalOffset - effEarly)*s;
      if(h.tenOffset){ // テンの主張: 出して行って、折り合って落ち着く
        const d=(base-this.tenCenter)/this.tenSigma;
        offset += h.tenOffset*Math.exp(-d*d);
      }
    } else {
      /* --- 波乱: 演出重視 (従来) --- */
      const s = smoothstep(h.move[0], h.move[1], base);
      const e0 = h.earlyOffset * grow;   // 序盤は密→中盤以降に縦長へ
      offset = e0 + (h.finalOffset - e0)*s;
      // 見せ場ブースト: ガウス山 (逃げの突き放し / 差し・追込の急伸)
      if(h.kick){
        const d=(base-h.kickCenter)/h.kickSigma;
        offset += h.kickAmp*Math.exp(-d*d);
      }
      // 叩き合い: 1-2着僅差のときだけ、ゴール前で鼻面の出し入れ
      if(h.duel){
        const win = smoothstep(this.duelRise[0],this.duelRise[1],base)
                  *(1-smoothstep(this.duelFade[0],this.duelFade[1],base));
        offset += Math.sin(base*46 + h.duel.ph) * h.duel.amp * win;
      }
    }
    /* 道中の微揺れ。残り320mでいったん静まるが、完全には消さず
       LATE_LEVEL だけ残して自分のゴール直前まで持たせる。
       これで上位が入線した後も、後方では馬体を併せる動きが続く。
       自分のゴール手前 (SETTLE_M と同じ幅) で必ず0になるので着順は動かない */
    const LATE_LEVEL = 0.5;
    const mid  = 1-smoothstep(this.calmStart, this.calmStart+120/this.raceLen, base);
    const own  = 1-smoothstep(h.finishBase-30/this.raceLen, h.finishBase-12/this.raceLen, base);
    const calm = Math.max(mid, LATE_LEVEL) * own;
    const noiseGain = this.algo==="real" ? 0.22 : 1;
    let noise=0;
    for(const w of h.waves) noise += Math.sin(base*w.f*Math.PI*2+w.ph)*w.amp;
    offset += noise * calm * noiseGain * Math.min(1, base*6);
    /* ゲート発走: スタート時点は全馬横一線 (offset=0)。
       最初の90mで脚質どおりの隊列が形成される */
    const rampIn = smoothstep(0, 90/this.raceLen, base);
    return Math.max(0, base + offset*rampIn);
  }
}
/* ================= レーンの前進積分 =================
   進路取りは「前が塞がれたら外へ、空いたら内へ、ただし併走中の馬の進路は
   横切らない」という逐次的なルールなので、前のステップの結果が必要になる。
   そこでレース開始からのレーン状態を固定グリッド上に積み上げてキャッシュする。

   グリッドはフレームではなくレース時刻の等間隔なので、
   frame → 同じ step → 同じ値。再生位置をどこへ動かしても結果は同一で、
   書き出しの決定論も保たれる。設定やシードを変えた時だけ捨てる */
let laneTrace=null, laneDtT=0, laneDtSec=0, laneSideMem=null;
const LANE_CLEAR=0.9;    // 併走とみなす横の間隔 (レーン単位)
const LANE_SIDE=2.6;     // 馬体が並んでいるとみなす前後の間隔 [m]
const LANE_OUT=1.45;     // 進路を変える速さ [レーン単位/秒]
const LANE_RET=0.55;     // 内へ戻す速さ
const LANE_STEP=-1.35, LANE_IN=TRACK_HALF-1.7;   // 内ラチ沿いを基準に、外へ広がる
const LANE_INNER=TRACK_HALF-1.55, LANE_OUTER=-(TRACK_HALF-0.5);
const LGAP=1.05;            // 保証する横間隔[m]
const LONG0=2.5, LONG1=3.4; // 前後この範囲で馬体が重なり得る
/* 【重要】横方向の最大速度[m/s]。押し分け(接触)ぶんも含めた上限。
   全速で走る馬が横へ動ける速さは実際にはせいぜい1〜2m/s。

   以前は押し分けを毎フレームゼロから解き直しており、上限が無かった。
   8反復の緩和は入力にわずかな変化があると解が大きく動くため、
   接触した瞬間に1フレームで最大1.15m(=34m/s。前進速度より速い)横へ飛んでいた。
   ここを積分に載せて上限をかけるのが、横ズレを止める要。 */
const LAT_MAX=2.5;

function laneResetTrace(){ laneTrace=null; laneSideMem=null; }

/* 1グリッド分の横位置を解く。
     1. 各馬が行きたい横位置(target)へ、上限速度の範囲で寄せる
     2. その配置で押し分けを解く(8反復)
     3. 押し分けを含めた1ステップの総移動量を、もう一度上限で抑える ← 飛びを止める要
   3で抑えた結果すれ違いが残っても、次のステップで押し分けが効き続けるので
   0.2〜0.4秒かけて解消する。実際の馬も瞬間的に真横へは動けない */
function laneSolveStep(n, P, target, Lprev, dt){
  const cap=LAT_MAX*dt;
  const clampLane=(v)=>Math.min(LANE_INNER, Math.max(LANE_OUTER, v));
  const rate=(from,to)=>from+Math.max(-cap, Math.min(cap, to-from));
  const L=new Array(n);
  for(let i=0;i<n;i++) L[i]=rate(Lprev[i], target[i]);

  for(let it=0; it<8; it++){
    for(let i=0;i<n;i++)for(let j=i+1;j<n;j++){
      const dp=(P[i]-P[j])*cfg.raceLen;
      const along=1-smoothstep(LONG0, LONG1, Math.abs(dp));
      if(along<=0) continue;
      const dl=L[i]-L[j];
      const need=LGAP-Math.abs(dl);
      if(need<=0) continue;
      /* 押し分ける向き:
         離れている間は実際の左右、重なりかけたら接触前の左右(laneSideMem)を使う。
         これが無いと重なった瞬間に符号が反転し、相手をすり抜けて反対側へ飛ぶ */
      const trust=smoothstep(0.35, 1.05, Math.abs(dl));
      const dir=trust*Math.tanh(dl/0.30)
              + (1-trust)*Math.tanh(laneSideMem[i][j]/0.45);
      const wI=1/(1+Math.exp(dp/0.5));   // iが後ろ→1。後ろの馬が多めに避ける
      const push=need*along*0.34;
      L[i]=clampLane(L[i]+dir*push*(0.30+0.55*wI));
      L[j]=clampLane(L[j]-dir*push*(0.30+0.55*(1-wI)));
    }
  }
  for(let i=0;i<n;i++) L[i]=clampLane(rate(Lprev[i], L[i]));
  return L;
}

/* 各馬が行きたい横位置[m]。混雑度(U)から決まる隊列 + 発走直後の枠なり */
function laneTargets(n, U, mlS, tb){
  const toPack=smoothstep(0, 140/cfg.raceLen, tb);
  const out=new Array(n);
  for(let i=0;i<n;i++){
    // 完全に並んだ場合の重なり回避 (馬ごとの微小な定位置バイアス)
    const bias=(((i*0.618034)%1)-0.5)*0.45;
    const dyn=LANE_IN+(Math.min(mlS,U[i])+bias)*LANE_STEP;
    /* 発走直後はゲートの枠順どおりに横一線。
       最初の140mで内ラチ沿いの隊列へ収束する (実戦の枠なり〜内へ寄せる動き)。
       laneは正が内側。馬番1が最内になるよう内→外の順に並べる */
    const gate=((n-1)/2-(cfg.gates[i]-1))*GATE_LANE_W;
    out[i]=gate+(dyn-gate)*toPack;
  }
  return out;
}

/* ペアごとの「最後に前後が十分離れていたときの左右関係」を更新する。
   接触中はこの値が更新されないので、押し分けの向きが反転しない。
   毎ステップ前向きに更新するだけなので、過去へ遡る探索は不要 */
function laneUpdateSideMem(n, P, L){
  for(let i=0;i<n;i++)for(let j=i+1;j<n;j++)
    if(Math.abs((P[i]-P[j])*cfg.raceLen)>LONG1) laneSideMem[i][j]=L[i]-L[j]+0.02;
}

const __grsMark_8f3a2e91_c = "GRS-HRM-8f3a2e91-R3D";
function laneBuildTo(tNow){
  const n=cfg.n;
  if(!laneTrace){
    const raceSec=cfg.raceLen/cfg.speed;
    /* 積分の時間刻み[秒]。接触の解消はここの粒度で進むので、
       レーン判断だけだった頃の0.3秒(=9フレーム)では粗すぎる */
    laneDtSec=0.1;
    laneDtT=laneDtSec/raceSec;
    const P0=new Array(n), U0=new Array(n).fill(0);
    for(let i=0;i<n;i++) P0[i]=plan.progress(i,0);
    laneSideMem=[]; for(let i=0;i<n;i++) laneSideMem.push(new Array(n).fill(0));
    const L0=laneTargets(n, U0, 3.0, 0);
    laneUpdateSideMem(n, P0, L0);
    laneTrace=[{P:P0, U:U0, L:L0}];
  }
  const K=Math.floor(tNow/laneDtT);
  /* K+2 まで積む。Catmull-Rom 補間が前後1点ずつ余分に要る。
     先が無いと、順再生(まだ積んでいない)と巻き戻し(既に積んである)で
     値が変わってしまうため、必ず先まで積んでから読む */
  for(let k=laneTrace.length; k<=K+2; k++){
    const prev=laneTrace[k-1], U=prev.U, P=new Array(n);
    const ts=Math.min(1.005, k*laneDtT);
    for(let i=0;i<n;i++) P[i]=plan.progress(i,ts);
    // 直線に近いほど前を広く見て、外への持ち出しも許す
    const tb=Math.min(1.005, ts/0.96);
    const stg=smoothstep(1-420/cfg.raceLen, 1-200/cfg.raceLen, tb);
    const gapS=5.0+7.0*stg;
    const mlS=Math.min(12, 3.0+5.0*stg+Math.max(0,n-10)*0.3);
    const next=U.slice();
    for(let i=0;i<n;i++){
      let blocked=false;
      for(let j=0;j<n && !blocked;j++){
        if(j===i) continue;
        const d=(P[j]-P[i])*cfg.raceLen;               // +なら j が前
        if(d<=0 || d>gapS) continue;
        if(Math.abs(U[j]-U[i])<LANE_CLEAR) blocked=true; // 真正面が塞がっている
      }
      /* 移動先の可否は「行こうとしている側」だけを見る。
         今ふさいでいる馬(同じレーンの前方)は、まさに避けようとしている
         相手なので判定から外す。ここを両側で見ると、真後ろについた馬が
         外へ動き出せず縦一列のまま抜き合うことになる */
      const canMove=(target,outward)=>{
        for(let j=0;j<n;j++){
          if(j===i) continue;
          if(Math.abs((P[j]-P[i])*cfg.raceLen)>LANE_SIDE) continue; // 馬体が並んでいない
          if(outward ? (U[j]<=U[i]) : (U[j]>=U[i])) continue;       // 進行方向の側にいない
          if(Math.abs(U[j]-target)<LANE_CLEAR) return false;         // 併走中の馬の進路を横切る
        }
        return true;
      };
      if(blocked){
        /* 基本は外へ回る。外も併走馬で塞がっている時に限り、
           内が空いていれば内へ潜る (実戦の「内を突く」)。
           外を優先するのは、内は空いていても詰まるリスクが高いため */
        const outT=Math.min(mlS, U[i]+LANE_OUT*laneDtSec);
        if(canMove(outT,true)) next[i]=outT;
        else if(U[i]>0){
          const inT=Math.max(0, U[i]-LANE_OUT*laneDtSec);
          if(canMove(inT,false)) next[i]=inT;
        }
      }else if(U[i]>0){
        // 直線では自分の進路を保つ (内へ切り込まない)
        const tgt=Math.max(0, U[i]-LANE_RET*(1-stg)*laneDtSec);
        if(canMove(tgt,false)) next[i]=tgt;
      }
    }
    // 横位置は「上限速度つきの状態」として前向きに積む
    const L=laneSolveStep(n, P, laneTargets(n, next, mlS, tb), prev.L, laneDtSec);
    laneUpdateSideMem(n, P, L);
    laneTrace.push({P, U:next, L});
  }
}

/* 各馬の横位置[m]。正が内側。
   グリッド間は Catmull-Rom で補間する。線形だと継ぎ目で横速度が不連続になり、
   そこがカクつきとして残るため。前後1点ずつ余分に使うので K-1〜K+2 を参照する */
function laneLateralAt(tNow){
  laneBuildTo(tNow);
  const n=cfg.n, K=Math.floor(tNow/laneDtT), last=laneTrace.length-1;
  const at=(k)=>laneTrace[Math.max(0,Math.min(k,last))].L;
  const p0=at(K-1), p1=at(K), p2=at(K+1), p3=at(K+2);
  const w=Math.max(0,Math.min(1,(tNow-K*laneDtT)/laneDtT));
  const w2=w*w, w3=w2*w;
  const h00=2*w3-3*w2+1, h10=w3-2*w2+w, h01=-2*w3+3*w2, h11=w3-w2;
  const out=new Array(n);
  for(let i=0;i<n;i++){
    const a=p1[i], b=p2[i];
    const m0=0.5*(b-p0[i]), m1=0.5*(p3[i]-a);
    // Catmull-Rom はわずかに行き過ぎることがあるので、ラチの内側へ収め直す
    out[i]=Math.min(LANE_INNER, Math.max(LANE_OUTER,
      h00*a + h10*m0 + h01*b + h11*m1));
  }
  return out;
}

function smoothstep(a,b,x){
  const t=Math.min(1,Math.max(0,(x-a)/(b-a)));
  return t*t*(3-2*t);
}

/* ---------- カラーパレット ----------
   パレットは「毛色の決め方」そのもの。色ピッカーの値の解釈が変わる。

   リアル : 実在の4毛色テクスチャのうち、指定色に一番近いものを貼る。
            ピッカーの初期値は各テクスチャの実測代表色なので見た目と一致する。
   カラー : 芦毛(ほぼ純白)のテクスチャに指定色を乗算する。
            毛並みの陰影は残したまま任意の色にできる = 16頭すべて見分けがつく */
const COAT_TEX=[
  /* hex はテクスチャの実測中央値。mane はたてがみ・尻尾のフラット色 */
  {key:"brown_white", label:"鹿毛",   hex:0x702918, mane:0x302b29},
  {key:"white",       label:"芦毛",   hex:0xfcfbfc, mane:0xc8c6c1},
  {key:"brown_black", label:"青鹿毛", hex:0x552c14, mane:0x39342f},
  {key:"black_white", label:"青毛",   hex:0x262626, mane:0x393939},
];
/* プロトタイプ時代の毛色パターン定義。既定の配色はここで決めていた。
   統合後は「カラー」の16色を出走馬の既定の馬体色として index.html が持ち、
   「リアル」は上の COAT_TEX を順に割り当てるので、この表はもう参照されていない。
   （配色を2か所で持つと食い違うため、持ち主をホスト側に一本化した）
   数値そのものは由来の記録として残してある */
const PALETTES={
  real:{ label:"リアル（実在の毛色）", mode:"real",
    colors:[...Array(16).keys()].map(i=>COAT_TEX[i%4].hex)},
  /* 芝(緑)の上で見分けることが目的なので、中間の緑は入れない。
     馬体は面積が小さく背景に埋もれやすいため、彩度と明度の差を優先している */
  color:{ label:"カラー（識別重視）", mode:"color",
    colors:[0xe6194b,0x2f6fd8,0xf2efe6,0xffc21e,0x9932cc,
            0xff6a00,0x00c2d4,0xf05fb0,0x232323,0x6b4ae0,0x8f2020,0xa9b2ba,
            0x0090d8,0xb5651d,0xff3d7f,0x4a2f7a]},
};
/* 色の相対輝度 (0-1): 番号などの文字色を自動で反転させるのに使う */
function lumaOf(hex){
  const r=(hex>>16&255)/255, g=(hex>>8&255)/255, b=(hex&255)/255;
  return 0.2126*r + 0.7152*g + 0.0722*b;
}
function scaleHex(hex,k){
  const f=v=>Math.max(0,Math.min(255,Math.round(v*k)));
  return (f(hex>>16&255)<<16)|(f(hex>>8&255)<<8)|f(hex&255);
}
/* 指定色に一番近い毛色テクスチャ。暗い色どうしを取り違えないよう
   明度の差を色相より重く見る（鹿毛と青毛はRGB距離だと意外に近い） */
function nearestCoat(hex){
  let best=COAT_TEX[0], bestD=Infinity;
  const r=hex>>16&255, g=hex>>8&255, b=hex&255;
  for(const c of COAT_TEX){
    const dr=r-(c.hex>>16&255), dg=g-(c.hex>>8&255), db=b-(c.hex&255);
    const dl=(lumaOf(hex)-lumaOf(c.hex))*255;
    const d=dr*dr+dg*dg+db*db + 2*dl*dl;
    if(d<bestD){bestD=d; best=c;}
  }
  return best;
}
/* 色ピッカーの値 → 実際に貼るテクスチャと乗算色 */
function coatSpecOf(hex, mode){
  if(mode==="color")
    return {key:"white", tint:hex, mane:scaleHex(hex,0.80)};
  const c=nearestCoat(hex);
  return {key:c.key, tint:0xffffff, mane:c.mane};
}

/* 名札スプライト (Canvasテクスチャ → 動画に焼き込める方式) */
function makeNameSprite(name, coat, gateNo){
  const cv=document.createElement("canvas"); cv.width=512; cv.height=128;
  const c=cv.getContext("2d");
  c.fillStyle="rgba(8,14,10,0.82)";
  c.beginPath(); c.roundRect(6,14,500,100,18); c.fill();
  c.fillStyle="#"+coat.toString(16).padStart(6,"0");
  c.beginPath(); c.arc(60,64,30,0,Math.PI*2); c.fill();
  c.strokeStyle="#e3b34c"; c.lineWidth=4; c.stroke();
  // 馬番をドット内に (毛色が明るいか暗いかで文字色を反転)
  if(gateNo){
    c.fillStyle = lumaOf(coat)>0.55 ? "#111" : "#fff";
    c.font="bold 34px sans-serif"; c.textAlign="center";
    c.fillText(gateNo, 60, 77);
    c.textAlign="left";
  }
  c.fillStyle="#f2f6f2";
  c.font="bold 52px 'Hiragino Kaku Gothic ProN', sans-serif";
  c.fillText(name, 110, 82, 380);
  const tex=new THREE.CanvasTexture(cv);
  const sp=new THREE.Sprite(new THREE.SpriteMaterial({map:tex,depthTest:false}));
  sp.scale.set(4.2,1.05,1);
  return sp;
}
/* 名札の高さ: 団子で重ならないよう馬ごとに3段へ振り分ける */
function nameTierY(index){ return 3.2 + (index%3)*1.05; }
function makeLeaderLine(nameY){
  const line=new THREE.Mesh(
    new THREE.CylinderGeometry(0.025,0.025, nameY-2.6),
    new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,opacity:0.55}));
  line.position.set(0,(nameY+2.6)/2 - 0.25,0);
  return line;
}
/* 接地感用の丸い偽影。シャドウマップを入れる前の代用品で、
   本物の影が出ている今は隠してある (太陽が斜めなので本物は馬の斜め後ろに落ち、
   真下の黒い円と二重に見えてしまう)。
   影を切って軽くしたいときはここを true に戻せば元の見た目に戻る。
   update() 側の opacity/position の計算はそのまま残してある */
const FAKE_CONTACT_SHADOW=false;
function makeGroundShadow(){
  const sh=new THREE.Mesh(
    new THREE.CircleGeometry(1.3,20),
    new THREE.MeshBasicMaterial({color:0x000000,transparent:true,opacity:0.28}));
  sh.rotation.x=-Math.PI/2; sh.position.y=0.02;
  sh.visible=FAKE_CONTACT_SHADOW;
  return sh;
}

/* ---------- 馬CGアセット ----------
   horse.glb        : モデル本体 + 走行クリップ horse.gallop (歩幅2.82m / 実測)
   horse-motions.glb: 頭振り・尻尾振り (加算ブレンド用。読めなくても走行は成立する)
   textures/        : 毛色4種。GLB内には placeholder しか入っていないので必須

   【色空間】このツールは outputEncoding を既定(Linear)のまま使っており、
   ハードコードした16進色をそのまま画面に出す前提で見た目が調整されている。
   そこへ sRGB 指定のテクスチャを混ぜると馬だけ暗く沈むので、
   GLTFLoader が自動で付ける sRGBEncoding を剥がして周囲に合わせている。 */
/* 既定はこのモジュールと同じ場所の assets/。init({assetsBase}) で差し替えられる */
const HORSE_ASSET={ glb:"assets/horse.glb", motions:"assets/horse-motions.glb",
                    texDir:"assets/textures", ext:"webp" };
function setAssetsBase(base){
  if(!base) return;
  const b=base.replace(/\/+$/,"");
  HORSE_ASSET.glb=b+"/horse.glb";
  HORSE_ASSET.motions=b+"/horse-motions.glb";
  HORSE_ASSET.texDir=b+"/textures";
}
const HORSE={ ready:false, source:null, gallop:null, idle:null, flicks:[], coatTex:{} };

/* 待機ポーズは「バインドポーズを保つクリップ」を組み立てて使う。
   Blender で静止アクションを作るとリグの制約と干渉して蹄が5cm沈んだため、
   読み込み直後のボーンの姿勢から直接作る方が正確 */
function buildRestClip(root, name="horse.idle", duration=0.5){
  const tracks=[], times=[0,duration];
  root.traverse(o=>{
    if(!o.isBone) return;
    const p=o.position.toArray(), q=o.quaternion.toArray(), s=o.scale.toArray();
    tracks.push(new THREE.VectorKeyframeTrack(`${o.name}.position`,times,[...p,...p]));
    tracks.push(new THREE.QuaternionKeyframeTrack(`${o.name}.quaternion`,times,[...q,...q]));
    tracks.push(new THREE.VectorKeyframeTrack(`${o.name}.scale`,times,[...s,...s]));
  });
  return new THREE.AnimationClip(name, duration, tracks);
}

/* three のローダーは失敗時に ProgressEvent を渡してくることがあり、
   e.message が undefined になる。どのURLで何が起きたかを必ず残す */
function loadErrorText(url, e){
  const detail = (e && (e.message || e.type)) || String(e);
  return url + " … " + detail;
}
/* 失敗の原因を切り分ける。file:// なのか、置き場所が違うのかで対処が正反対になる */
async function diagnoseAssets(){
  const urls=[HORSE_ASSET.glb, HORSE_ASSET.motions,
    ...COAT_TEX.map(c=>`${HORSE_ASSET.texDir}/coat_${c.key}.${HORSE_ASSET.ext}`)];
  if(location.protocol==="file:")
    return "file:// で開いています。ブラウザの制限で GLB もテクスチャも読めません。\n"
         + "ローカルサーバー経由（http://）で開き直してください。";
  const lines=[];
  for(const u of urls){
    try{ const r=await fetch(u,{method:"HEAD"}); lines.push(`${r.status}  ${u}`); }
    catch(err){ lines.push(`接続不可  ${u}`); }
  }
  return "各ファイルの応答:\n"+lines.join("\n");
}

async function loadHorseAsset(){
  // dispose() 後の再 init() でも通るので、読み込み済みなら 3.5MB を再解析しない
  if(HORSE.ready) return;
  const loader=new THREE.GLTFLoader(), texLoader=new THREE.TextureLoader();
  const [gltf, motions] = await Promise.all([
    loader.loadAsync(HORSE_ASSET.glb)
      .catch(e=>{ throw new Error(loadErrorText(HORSE_ASSET.glb, e)); }),
    // 頭振り・尻尾振りは無くても走行は成立する。読めなければ黙って諦める
    loader.loadAsync(HORSE_ASSET.motions).catch(e=>{
      console.warn("[horse] 読み込み失敗: "+loadErrorText(HORSE_ASSET.motions, e)); return null; }),
    ...COAT_TEX.map(async c=>{
      const url=`${HORSE_ASSET.texDir}/coat_${c.key}.${HORSE_ASSET.ext}`;
      const t=await texLoader.loadAsync(url)
        .catch(e=>{ throw new Error(loadErrorText(url, e)); });
      t.flipY=false;                 // glTF の UV 規約。既定 true のままだと上下反転する
      t.encoding=THREE.LinearEncoding;
      t.needsUpdate=true;
      HORSE.coatTex[c.key]=t;
    }),
  ]);

  HORSE.source=gltf.scene;
  HORSE.source.traverse(o=>{
    if(!o.isMesh || !o.material) return;
    // スキンメッシュはバウンディングボックスが更新されず、画面内なのに消えることがある
    o.frustumCulled=false;
    for(const k of ["map","emissiveMap"])
      if(o.material[k]) o.material[k].encoding=THREE.LinearEncoding;
    // 角膜が transmission=1 だと透過の背景用にシーン全体をもう一度描画する。
    // opacity 0.02 の層なので切っても見た目は変わらないが描画時間は半分になる
    if(o.material.transmission>0) o.material.transmission=0;
    o.material.needsUpdate=true;
  });

  HORSE.gallop=gltf.animations.find(a=>a.name==="horse.gallop") || gltf.animations[0];
  HORSE.idle=buildRestClip(HORSE.source);
  if(motions){
    for(const c of motions.animations){
      if(!/head|tail/.test(c.name)) continue;   // walk は不採用
      const a=c.clone(); THREE.AnimationUtils.makeClipAdditive(a);
      a.name=c.name+".additive";
      HORSE.flicks.push(a);
    }
  }
  HORSE.ready=true;
}

/* ---------- 馬アクター (CGモデル版) ----------
   BlockHorse と同じ update(pos, tan, distTraveled, standing, lean) を実装する。

   【決定論】書き出しとプレビューを一致させるため mixer.update(delta) は使わない。
   action.time を毎フレーム直接決め、mixer.update(0) で評価だけさせる
   (r128 の AnimationAction._updateTime は deltaTime===0 のとき time を素通しする)。

   【歩容の駆動】脚のピッチは走行速度から切り離し、一定に保つ。
   クリップは元のCGアセットの脚さばきをそのまま使っており、1完歩で 2.82m しか
   進まない。走行速度 16.8m/s との差 (毎秒2.4ストライド × 2.82m = 6.77m/s) は
   前向きの横滑りとして受け入れる。歩幅を移動距離に合わせたクリップも作ったが、
   脚を伸ばすぶん走行中に蹄が 9cm 地面へめり込むので、そちらは採らなかった。

   時計に実時間 (frame/FPS) を使ってはいけない。ゴール前のスローはレース時刻の
   進みを遅くして作っているので、実時間で回すと体だけスローになり脚が置いていかれる。
   raceClockSec を使えば体と脚が同じ倍率で遅くなる。 */
const GAIT_BLEND_M = 3.0;   // 立ち姿→ギャロップを混ぜる距離[m] (17m/sで約0.18秒)

class GLBHorse {
  constructor(scene, index, name, coat, gateNo, mode){
    this.group=new THREE.Group();
    /* モデルは +Z が前。BlockHorse の規約(+X が前)へ内側のGroupで吸収する */
    const yaw=new THREE.Group(); yaw.rotation.y=Math.PI/2;
    const model=THREE.SkeletonUtils.clone(HORSE.source);
    yaw.add(model); this.group.add(yaw);

    /* 毛色とたてがみ色は必ずセットで変える。
       マテリアルを複製しないと1頭変えただけで全頭変わる
       (map の実体は共有されるので VRAM は増えない) */
    let bodyMat=null, hairMat=null;
    model.traverse(o=>{
      if(!o.isMesh || !o.material) return;
      if(o.material.name==="horse.body.coat" || o.material.name==="horse.hair.baked"){
        o.material=o.material.clone();
        if(o.material.name==="horse.body.coat") bodyMat=o.material; else hairMat=o.material;
      }
    });
    const spec=coatSpecOf(coat, mode);
    if(bodyMat){ bodyMat.map=HORSE.coatTex[spec.key]; bodyMat.color.setHex(spec.tint);
                 bodyMat.needsUpdate=true; }
    if(hairMat){ hairMat.color.setHex(spec.mane); hairMat.needsUpdate=true; }

    this.mixer=new THREE.AnimationMixer(model);
    this.aRun=this.mixer.clipAction(HORSE.gallop);
    this.aIdle=this.mixer.clipAction(HORSE.idle);
    for(const a of [this.aRun,this.aIdle]){ a.play(); a.setEffectiveWeight(0); }
    this.runDur=HORSE.gallop.duration;
    /* 待機中の頭振り・尻尾振り(加算ブレンド)。
       周期と位相を馬ごとにずらして、16頭の動きが揃わないようにする */
    this.flicks=HORSE.flicks.map((c,k)=>{
      const a=this.mixer.clipAction(c);
      a.blendMode=THREE.AdditiveAnimationBlendMode;
      a.play(); a.setEffectiveWeight(0);
      return { act:a, dur:c.duration,
               period:3.4+1.9*(((index*0.618034+k*0.37)%1)),
               offset:5*((index*0.7548776+k*0.21)%1) };
    });

    /* 影を投げるのは馬体だけ。名札のスプライトとリーダー線は対象外
       (Sprite は既定で castShadow=false、線は MeshBasicMaterial) */
    model.traverse(o=>{ if(o.isMesh) o.castShadow=true; });

    this.shadow=makeGroundShadow();
    this.group.add(this.shadow);

    const nameY=nameTierY(index);
    this.nameSprite=makeNameSprite(name, coat, gateNo);
    this.nameSprite.position.set(0,nameY,0);
    this.group.add(this.nameSprite);
    if(index%3>0) this.group.add(makeLeaderLine(nameY));

    /* 脚のピッチ[ストライド/秒]。走行速度とは連動させない。
       元アセットのギャロップは1周期 0.417秒 = 毎秒2.4ストライド。
       1完歩で進むのは 2.82m (実測) なので、16.8m/s では毎秒 10.0m 前へ滑る */
    this.cadence=1/this.runDur;
    this.phaseOffset=index*0.173;   // 決定論のため乱数を使わない
    scene.add(this.group);
  }

  update(pos, tan, distTraveled, standing=false, lean=0){
    this.group.position.copy(pos);
    this.group.rotation.set(0,0,0);
    this.group.rotation.y = Math.atan2(tan.x, tan.z) - Math.PI/2;
    const roll=-lean;
    this.group.rotateX(roll);
    this.shadow.rotation.x=-Math.PI/2-roll;   // 影は接地面に貼り付けたまま

    /* 立ち姿 → ギャロップ は「走った距離」で混ぜる。
       時間で混ぜるとシークやコマ送りで結果が変わってしまう */
    const w = standing ? 0 : smoothstep(0, GAIT_BLEND_M, distTraveled);
    this.aIdle.setEffectiveWeight(1-w);
    this.aRun.setEffectiveWeight(w);

    /* 積算せずレース時刻から毎フレーム引き直す。だからシークしても絵は変わらない */
    const gait=(((raceClockSec*this.cadence + this.phaseOffset)%1)+1)%1;
    this.aRun.time=gait*this.runDur;

    /* ゲート内では頭を振り、尾を振る。
       進行度が動かない区間なので、ここだけは待機時間で駆動する。
       積算せずフレーム番号から毎回引き直すこと（シークしても結果が変わらない） */
    const tStand = standing ? Math.min(frame, gateFrames)/FPS : 0;
    for(const f of this.flicks){
      const ph=((tStand+f.offset)%f.period);
      const on = standing && ph<f.dur;
      f.act.setEffectiveWeight(on?1:0);
      f.act.time = on ? ph : 0;
    }

    this.mixer.update(0);   // 時間は進めない。上で決めた time を評価するだけ

    // 空中期は影を薄く (上下動はクリップに焼き込まれているので位置は触らない)
    const air=Math.max(0,Math.sin(gait*Math.PI*2))*w;
    this.shadow.material.opacity=0.28-air*0.12;
    this.shadow.position.y=0.02;
  }
  dispose(scene){
    scene.remove(this.group);
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.group.children[0].children[0]);
    this.nameSprite.material.map.dispose();
    this.nameSprite.material.dispose();
  }
}

/* ---------- 馬アクター (積み木版・フォールバック) ----------
   horse.glb を読めなかったときだけ使う。オフラインや配置ミスでも
   ツール自体は動き続ける */
class BlockHorse {
  constructor(scene, index, name, coat, gateNo){
    this.group = new THREE.Group();
    const mat  = new THREE.MeshLambertMaterial({color:coat});
    const dark = new THREE.MeshLambertMaterial({color:0x1a1208});

    // 実寸基準: 体長~2.4m 肩高~1.6m (差し替え時のカメラ距離互換のため)
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.0,0.85,0.8), mat);
    body.position.set(0,1.25,0);
    const neck = new THREE.Mesh(new THREE.BoxGeometry(0.7,0.9,0.45), mat);
    neck.position.set(0.95,1.75,0); neck.rotation.z=-0.5;
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.75,0.4,0.38), mat);
    head.position.set(1.45,2.05,0); head.rotation.z=-0.25;
    const earL = new THREE.Mesh(new THREE.ConeGeometry(0.08,0.22,4), dark);
    earL.position.set(1.2,2.35,0.12);
    const earR = earL.clone(); earR.position.z=-0.12;
    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.12,0.9,5), dark);
    tail.position.set(-1.1,1.35,0); tail.rotation.z=Math.PI/2.4;
    this.group.add(body,neck,head,earL,earR,tail);

    // 脚: 付け根で回転させる (ギャロップ4拍子)
    this.legs=[];
    const legGeo = new THREE.BoxGeometry(0.16,0.95,0.16);
    legGeo.translate(0,-0.45,0); // 付け根を回転軸に
    const legPos=[[ 0.75,0.28],[ 0.75,-0.28],[-0.75,0.28],[-0.75,-0.28]];
    // ローテーショナルギャロップの位相: 後→後→前→前
    const phase=[0.0,0.12,0.5,0.62];
    for(let l=0;l<4;l++){
      const leg=new THREE.Mesh(legGeo, l<2?mat:mat);
      leg.position.set(legPos[l][0],0.95,legPos[l][1]);
      this.group.add(leg);
      this.legs.push({mesh:leg, ph:phase[l]});
    }

    // 影 (この時点の子は馬体だけ。名札とリーダー線は下で足すので含まれない)
    this.group.traverse(o=>{ if(o.isMesh) o.castShadow=true; });
    this.shadow = makeGroundShadow();
    this.group.add(this.shadow);

    const nameY = nameTierY(index);
    this.nameSprite = makeNameSprite(name, coat, gateNo);
    this.nameSprite.position.set(0,nameY,0);
    this.group.add(this.nameSprite);
    if(index%3>0) this.group.add(makeLeaderLine(nameY));

    this.strideLen = 6.5; // 1完歩の距離[m] : 足滑り防止の基準
    this.phase = Math.random()*0; // 決定論のため0固定。位相差はindexで付与
    this.phaseOffset = index*0.173;
    scene.add(this.group);
  }
  /* ============ 差し替えインターフェース ============
     GLBHorse もこの規約どおりに実装してある。
     引数の意味と単位を固定してあるので、内部表現には依存しない。

       pos           : ワールド座標 [m] (y=0が接地面)
       tan           : 進行方向の単位ベクトル
       distTraveled  : スタートからの走行距離 [m] ← 歩容はこれで駆動する
       standing      : true でゲート内の静止ポーズ
       lean          : 旋回で内側に倒す角度 [rad] (直線では0)

     【前方向の規約】このクラスはローカル +X が前。
     glTFは -Z 前が一般的なので、差し替え時はモデルを Group で包み、
     そのGroupに rotation.y = Math.PI/2 を持たせて吸収すること。

     【歩容】時間ではなく距離で駆動する。CGのアニメーションクリップに
     差し替える場合も timeScale ではなく
       action.time = ((distTraveled/strideLen + phaseOffset) % 1) * clip.duration
     の形にする (書き出しの決定論を守るため mixer.update(delta) は使わない)。
     strideLen はモーションのルートが1周期で進む距離を実測して入れる。 */
  update(pos, tan, distTraveled, standing=false, lean=0){
    this.group.position.copy(pos);
    this.group.rotation.set(0,0,0);
    this.group.rotation.y = Math.atan2(tan.x, tan.z) - Math.PI/2;
    /* 進行方向まわりのロール = 内傾。+Xが前なので x軸まわりに倒す。
       このクラスのローカル+Zは「外側」を向くので、内側へ倒すには負の回転。
       (遠心力は外向きの見かけの力。実際の馬・自転車は
        重力+地面反力の合力を接地点に通すため、内側へ傾ける) */
    const roll = -lean;
    this.group.rotateX(roll);
    this.shadow.rotation.x = -Math.PI/2 - roll; // 影は接地面に貼り付けたまま
    if(standing){
      for(const l of this.legs) l.mesh.rotation.z = 0;
      this.group.position.y = 0;
      this.shadow.material.opacity = 0.28;
      this.shadow.position.y = 0.02;
      return;
    }
    // 足滑り防止: 移動距離 → 歩容位相
    const gait = (distTraveled/this.strideLen + this.phaseOffset) % 1;
    for(const l of this.legs){
      l.mesh.rotation.z = Math.sin((gait - l.ph)*Math.PI*2)*0.85;
    }
    // 上下動 (1完歩1周期) + 空中期に影を薄く
    const bounce = Math.sin(gait*Math.PI*2);
    this.group.position.y = Math.max(0,bounce)*0.12;
    this.shadow.material.opacity = 0.28 - Math.max(0,bounce)*0.12;
    this.shadow.position.y = 0.02 - this.group.position.y;
  }
  dispose(scene){ scene.remove(this.group); }
}

/* ---------- カメラ台本 (進行度ベース・制作者固定) ----------
   各ショットは「先頭」「集団中心」など順位ベースで狙う → ランダム展開に強い */
/* 各ショットは「カメラ位置」と「注視点」を返す。
   ワンテイクモードでは境界の前後でこれらを補間し、
   カメラが飛行しながら次の構図へ移る (カット切り替えなし) */
/* ================= カメラ台本 =================
   カットの定義。順番と長さは、コース形状からapplySettingsで組み立てる
   (コーナーが1つのコースと2つのコースで構成が変わるため) */
const SHOT_DEFS = {
  start: { name:"スタート全景", fitAll:true, safe:0.97,
    fn:(ctx)=>{
      /* 発走の全景。進行方向の「左手前」に立ち、横一線の全馬を映す。
         左は normalOf(内側)ではなく世界座標で固定して求める:
         回り方でカメラが内外に鏡映りしてしまうのを避け、
         右回りでも左回りでも常に進行方向の左手前になる */
      const g=ctx.course.sample(0,0), t=g.tan;
      const left=new THREE.Vector3(t.z,0,-t.x);   // 進行方向の左
      const follow=smoothstep(0, 0.012, ctx.tBase);
      const anchor=new THREE.Vector3(g.pos.x,0,g.pos.z)
        .lerp(new THREE.Vector3(ctx.packCenter.x,0,ctx.packCenter.z), follow);
      const pos=new THREE.Vector3(
        anchor.x + t.x*20 + left.x*13, 5.0,
        anchor.z + t.z*20 + left.z*13);
      return { pos, look:new THREE.Vector3(anchor.x, 1.6, anchor.z) };
    }},
  approach: { name:"コーナー手前 定点", framing:34, cut:true, fitAll:true, safe:0.94,
    /* カット固有の値(cornerAt など)は ctx ではなく第2引数の sh から取る。
       遷移中は「前のカットのfn」も呼ばれるため、ctxに入れてしまうと
       現在のカットの値を見に行き、未定義 = NaN でカメラが飛ぶ */
    fn:(ctx, sh)=>{
      /* コーナー入口・走路の外側に据えた定点。遠くから迫ってくる集団を迎える。
         接近に応じた引き(ズームアウト)は fitAll の自動フィットが行う */
      return { pos:cornerCamPos(ctx, sh), look:new THREE.Vector3(
        ctx.packCenter.x, 1.6, ctx.packCenter.z) };
    }},
  slide: { name:"コーナー 定点追従", framing:34, fitAll:true, safe:0.94,
    fn:(ctx, sh)=>{
      /* 定点はそのまま。視線だけで、コーナーを回る集団を追い続ける
         (カメラごと動かすと地面が流れて酔うため、実際の中継と同じく
          三脚のパンで見送る形にしている) */
      return { pos:cornerCamPos(ctx, sh),
               look:new THREE.Vector3(ctx.fitCenter.x, 1.5, ctx.fitCenter.z) };
    }},
  /* 前カット(コーナー定点追従)とはワンカットで繋がず切り替える。
     定点は直線の延長線上にあり、集団がコーナーを進むほど遠ざかるので、
     ブレンドすると遠方から一気に飛んでくる不自然な動きになる */
  cornerwide: { name:"コーナー引き絵", fitAll:true, safe:0.9, cut:true,
    fn:(ctx)=>{
      /* コーナーを曲がり切るまでを、馬場の内側・斜め上から見下ろすカット。
         「定点追従」の望遠アップから、群れ全体が弧を描く画へ引く。

         カメラは集団の内側を一定の距離を保って併走する。
         以前はコーナーの一点に据え置き、そこからの距離を
         コーナー半径に比例させていた(radius*0.7)。この作りだと
         半径167mの2400mでは内側へ117mも離れてしまい、
         馬が豆粒になっていた(小回りは45mなので気づきにくかった)。

         距離を実寸で固定したので、どのコースでも同じ寄り具合になる。
         全馬を収める(fitAll)ので、隊列が縦長でも切れない */
      // 内側へ30m・高さ10m ≒ 見下ろし16°。低い位置から弧を横目に見る画
      const IN_D=30, CAM_H=10;
      const c=ctx.course.sample(ctx.midP, 0);
      const inN=normalOf(c.tan);
      return { pos:new THREE.Vector3(c.pos.x+inN.x*IN_D, CAM_H, c.pos.z+inN.z*IN_D),
               look:new THREE.Vector3(ctx.fitCenter.x, 1.4, ctx.fitCenter.z) };
    }},
  /* 前カットとはワンカットで繋がず切り替える。
     分割画面は画面構成そのものが変わるカットなので、
     ブレンドすると1画面のまま中途半端にカメラが飛ぶだけの数秒になる */
  split: { name:"隊列スクロール（分割画面）", split:true, cut:true,
    fn:(ctx, sh)=>{
      /* 実描画は renderFrame の分割画面ブロック。
         ここはカット遷移のブレンド用に、下段と同じ構図を返しておく */
      const sp=ctx.course.sample(splitScrollP(ctx, sh), 0);
      const n=normalOf(sp.tan);
      const d=SPLIT_CAM_D;   // +n = 馬場の内側。内から外を向いて撮る
      return { pos:new THREE.Vector3(sp.pos.x+n.x*d, 3.0, sp.pos.z+n.z*d),
               look:new THREE.Vector3(sp.pos.x, 1.5, sp.pos.z) };
    }},
  front: { name:"正面（内から回り込み）", framing:26, fit:true, safe:0.95,
    fn:(ctx)=>{
      /* 最終コーナー。1位を中心に、カメラがぐるっと回り込む。
           内側(右回りなら馬の右) → 正面 → 外側の前方(馬の左手前)
         回り込みは前半で一気に進めて早く正面に入り、
         そのあとはゆっくり外前方へ抜けて最終直線のアングルへ渡す。
         角度は進行方向tからの回転角。+が内側、-が外側 */
      const q=Math.pow(Math.max(0,Math.min(1,ctx.frontU)), 0.40);
      const deg=100*(1-q) - 55*q;
      const r=Math.PI/180*deg;
      const l=ctx.leaderPos, t=ctx.leaderTan, n=normalOf(t);
      const dist=21-5*q;
      const c=Math.cos(r), sn=Math.sin(r);
      return { pos:new THREE.Vector3(
                 l.x + (t.x*c + n.x*sn)*dist, 3.4+1.6*q,
                 l.z + (t.z*c + n.z*sn)*dist),
               look:new THREE.Vector3(l.x, 1.5, l.z) };
    }},
  stretch: { name:"最終直線（1位基準トラッキング）", fit:true, safe:0.97, cut:true,
    fn:(ctx)=>{
      /* 1位(仮想先頭点)を基準に並走スクロール。
         1位は常にフレーム内(前方端)に固定され、
         後続は差に応じて画面奥へ連なる。
         差が開くと注視点を後ろへ・距離を広げて後続もできるだけ収めるが、
         優先順位はあくまで「1位を絶対に切らない」 */
      const l=ctx.leaderPos, t=ctx.leaderTan;
      const n=normalOf(t);
      const side=-1; // +1=スタンド側 / -1=内ラチ側
      const portrait = ctx.aspect < 1;
      const dirF = portrait? 15 : 10;
      const dirS = (portrait? 7.5 : 14)*side;
      const dirH = portrait? 7 : 5.5;
      const off=new THREE.Vector3(
        t.x*dirF + n.x*dirS, dirH, t.z*dirF + n.z*dirS);
      // 注視点: 1位の少し後ろ (差が開くほど後ろへ→後続が画面に入る)
      // 注視点を後ろへ引きすぎると全体が遠くなるので、控えめに
      const back=Math.min(18, Math.max(8, ctx.spreadM*0.35));
      const look=new THREE.Vector3(l.x - t.x*back, 1.4, l.z - t.z*back);
      /* 距離: 1位〜注視点周辺が収まる幅を確保。
         画角は自分のカットの値(CAM_FOV)で計算する。ctx.cam.fov は
         前フレーム(前カット)の値が残っていることがあるため */
      const vHalf=Math.tan(CAM_FOV*Math.PI/360);
      const hHalf=vHalf*ctx.aspect;
      const dir=off.clone().normalize();
      const sinT=Math.max(0.15, Math.abs(dir.x*t.z - dir.z*t.x));
      const lateral=back*0.8*sinT + 4.5;
      const scale=Math.max(1, (lateral/hHalf*1.1)/off.length());
      return { pos:new THREE.Vector3(
                 l.x - t.x*back*0.5 + off.x*scale,
                 dirH*Math.max(1,scale*0.85),
                 l.z - t.z*back*0.5 + off.z*scale),
               look };
    }},
  goal: { name:"ゴール真横", framing:15, cut:true,
    /* 画角は「決勝線までの距離」で決め打ちする。
       既定では注視点(=1位)までの距離で決まるため、1位が近づくほど画角が開く。
       そこへ「収める」補正が重なり、ゴール前でズームイン・アウトを繰り返していた。
       ここを線の位置に固定すると、pos も固定なので画角は完全に一定になる */
    framingLook:(ctx)=>{
      const a=ctx.course.sample(1, TRACK_HALF*0.55);
      return new THREE.Vector3(a.pos.x, 1.4, a.pos.z);
    },
    /* 自動補正はすべて切る。決勝線カメラは構図が動かないことが正しく、
       補正が入ると必ずズームになる（それがカクつきの元でもあった） */
    holdFrame:true,
    fn:(ctx)=>{
      /* 決勝線の真横・スタンド側に据えた望遠カメラ。

         注視点は「馬が実際に走っているレーンの決勝線上」に置く。
         走路の中心を見ると、内ラチ沿いを通る馬とは10m近くずれて
         そのぶん寄りが甘くなるため。
         1位が線に届いたらそこで固定するので、以降は2着・3着が
         次々とフレームへ飛び込んできて着順が読める。

         holdFrame により、このカットだけは「対象を収める」自動補正を切る。
         入れておくと、線を通過して遠ざかる勝ち馬を追いかけて画角が
         際限なく開き、いちばん盛り上がる場面で全馬が豆粒になっていた。
         画作りは framing(=写る幅15m)だけで決まる */
      const g=ctx.course.sample(1.0,0);
      const n=normalOf(g.tan);
      const pos=new THREE.Vector3(g.pos.x-n.x*14, 2.6, g.pos.z-n.z*14);
      // 視線は決勝線まで。1位が通過した後はそこで止める
      const a=ctx.course.sample(Math.min(1, ctx.leaderP), TRACK_HALF*0.55);
      return { pos, look:new THREE.Vector3(a.pos.x, 1.4, a.pos.z) };
    }},
};

/* ワンテイク合成: 進行度tBaseから現在ショットと遷移状態を求め、
   境界付近では前後ショットの pos/look を滑らかに補間する */
const ONE_TAKE = true;        // false にすると従来のカット切り替え

const SPLIT_CAM_D=TRACK_HALF+10;   // 分割画面の下段カメラ: 内ラチから馬場内へ10m
/* スクロールの端点を本物の先頭/最後尾まで届かせる余白[m]。
   headP/tailP のずれ(実測 1.5〜3.1m)を吸収する。splitScrollP を参照 */
const SPLIT_EDGE_M=3.0;

/* コーナー手前の定点カメラの位置。
   直線をそのまま延長した先・少し外側に据えるので、
   直線を走ってくる集団をほぼ正面から捉えられる (中継の名物アングル)。
   コースの外側に立つ点は左右どちらの回りでも同じ */
function cornerCamPos(ctx, sh){
  const e=ctx.course.sample(sh.cornerAt, 0);
  const t=e.tan, n=normalOf(e.tan);
  return new THREE.Vector3(
    e.pos.x + t.x*46 - n.x*14, 4.2,
    e.pos.z + t.z*46 - n.z*14);
}

/* 分割画面の下段が今どこを映しているか (先頭 → 最後尾へ片道スクロール)。
   カット内の進行度だけから決まる純関数なので、再生の仕方に依らない */
function splitScrollP(ctx, sh){
  /* 先頭→最後尾へ、カットの全尺をかけて片道で流す。

     以前は長いカット(2400mの向正面=約33秒)に限り16秒で一往復する
     振り子にしていたが、直線の途中で最後尾に着いてしまい、
     そこから先頭へ引き返す不自然な動きになっていた。
     カットが長いぶんは速さで吸収する = ゆっくり流す。

     smoothstep なので出だしと終わりが緩やかになり、
     一定速でなめるよりカメラワークとして落ち着く。
     tBase だけから決まる純関数なので決定論は保たれる */
  const u=smoothstep(sh.from, sh.until, ctx.tBase);
  if(window.__keibaDebug) window.__keibaDebug.splitU=u;
  /* 端点はカメラ用の連続版(headP/tailP)を使う。
     最後尾が入れ替わってもスクロールが折れないため。

     【ただし headP は本物の先頭より後ろにある】
     headP は「端の近くにいる馬を指数重みで混ぜた点」なので、
     実測で先頭より 1.5〜2.8m 後ろ、tailP は最後尾より 1.8〜3.1m 前にある。
     そのまま端点にすると、スクロール開始時に先頭馬が画面の端で見切れる。
     定数のマージンを足して本物の端まで届かせる
     (定数なので微分は増えず、headP を使う意味は保たれる) */
  const m=SPLIT_EDGE_M/cfg.raceLen;
  const a=ctx.headP+m, b=ctx.tailP-m;
  return clamp(a-(a-b)*u, 0, 1);
}

let SHOTS=[];
/* コース形状からカット割りを組み立てる。
   ・コーナーが2つ(向正面がある)コース → 向正面を分割画面にする
   ・コーナーが1つのコース → スタート後の長い助走を分割画面にする
   どちらも「長い直線は分割画面」というご指定どおりの割り当て */
const __grsMark_8f3a2e91_d = "GRS-HRM-8f3a2e91-R3D";
function buildShotPlan(){
  const L=cfg.raceLen, sec=(p)=>p*L/cfg.speed;   // 進行度 → 秒
  // コーナー区間を実測
  const segs=[]; let inC=false, s0=0;
  for(let p=0;p<=1+1e-9;p+=2/L){
    const c=course.curvature(course.dStart+p*L)>1e-6;
    if(c&&!inC){inC=true;s0=p;}
    if(!c&&inC){inC=false;segs.push([s0,p]);}
  }
  if(inC) segs.push([s0,1]);
  const c1=segs[0]||[0.35,0.6], cN=segs[segs.length-1]||c1;
  const MIN_SPLIT=6;               // 分割画面を使う最短秒数(遷移ぶんを除いた実尺)
  const p_of=(t)=>t*cfg.speed/L;   // 秒 → 進行度
  const cuts=[];   // 組み立て中のカット列 (RacePlanのplanと名前が衝突しないように)
  const push=(def,until,extra)=>{
    const from=cuts.length? cuts[cuts.length-1].until : 0;
    cuts.push(Object.assign({}, def, {from, until:Math.max(from,until)}, extra||{}));
  };

  /* 分割画面は「最終直線ではない、いちばん長い直線」に置く。
     ・コーナーが2つあるコース → 向正面
     ・コーナーが1つのコース   → スタート後の助走
     どちらに置くかで、前後のカットの長さも変える
     (助走に置く場合は全景と定点を詰めて、分割画面の尺を確保する) */
  const runUp=c1[0], mid=Math.max(0, cN[0]-c1[1]);
  const onMid = mid>=runUp;
  /* スタート全景を長めに取り、定点はコーナー直前の数秒だけ受け持つ */
  const approachL = Math.min(runUp*0.35, p_of(3.2));
  const startEnd  = Math.max(runUp*0.25, runUp-approachL);
  // 遷移で前後が食われるので、実際に映る尺で判定する
  const SPLIT_TR=TRANSITION*0.45;   // 分割画面の出入りは短めに切り替える
  const splitLen = onMid ? mid : runUp-startEnd-approachL;
  const useSplit = sec(splitLen)-sec(SPLIT_TR)*2 >= MIN_SPLIT;

  push(SHOT_DEFS.start, startEnd);
  if(useSplit && !onMid){
    push(SHOT_DEFS.split, c1[0]-approachL, {trans:SPLIT_TR});
    push(SHOT_DEFS.approach, c1[0]+0.015, {cornerAt:c1[0], trans:SPLIT_TR});
  }else{
    push(SHOT_DEFS.approach, c1[0]+0.015, {cornerAt:c1[0]});
  }
  /* 「最後尾がコーナーに入る」= 先頭が c1 入口 + 隊列の全長 だけ進んだ時。
     隊列の広がりは展開によって変わるので、実際の進行度から測る */
  const spreadAt=(base)=>{
    const t=Math.max(0, Math.min(1, base*0.96));
    let hi=-1, lo=2;
    for(let i=0;i<cfg.n;i++){ const q=plan.progress(i,t);
      if(q>hi)hi=q; if(q<lo)lo=q; }
    return Math.max(0, hi-lo);
  };
  /* 定点追従(アップ) → コーナー引き絵(俯瞰) → 分割/最終直線。
     追従は「先頭がコーナーに入って数秒」まで持たせ、引き絵に切り替えて
     最後尾が曲がり切る(=コーナー出口を全馬が通過)まで見送る。
     隊列は全長20m前後と密集しているため、最低秒数の下限も置く */
  const cornerMidP=(c1[0]+c1[1])/2;
  const tailOut=c1[1]+spreadAt(c1[1]);              // 最後尾がコーナーを出る
  // 定点追従(アップ)は最低4秒。コーナーが長い(2400mの1〜2角)ときは
  // コーナー前半を追従、後半を引き絵に配分する
  const cornerSpan=c1[1]-c1[0];
  const slideEnd=Math.min(
    Math.max(c1[0]+p_of(4), c1[0]+cornerSpan*0.4),
    onMid? cN[0]-p_of(8) : (1-120/L));
  const wideHi = onMid? Math.min(cN[0]-p_of(4), cN[0]) : (1-95/L);
  const wideEnd=Math.min(Math.max(tailOut, slideEnd+p_of(4)), wideHi);
  push(SHOT_DEFS.slide, slideEnd, {cornerAt:c1[0]});
  push(SHOT_DEFS.cornerwide, wideEnd, {cornerMidP});
  if(useSplit && onMid){
    push(SHOT_DEFS.split, cN[0], {trans:SPLIT_TR});
    // 最終コーナーは内側から正面をとらえ、最終直線へ橋渡しする
    push(SHOT_DEFS.front, Math.min(cN[1], 1-60/L), {trans:SPLIT_TR});
  }
  push(SHOT_DEFS.stretch, 1-45/L);   // ゴール真横へは残り45mで切替
  push(SHOT_DEFS.goal, 1.01, {trans:p_of(0.8)});
  SHOTS=cuts;
}

let TRANSITION = 0.045;       // 遷移幅 (コース長に応じてapplySettingsで再計算)

/* --- 1位を必ず画面に収める ---
   各カットは「注視点」と「そこからカメラを置く向き」で構図を決めている。
   向きと注視点はそのままに、カメラを後ろへ下げるだけで画角を広げるので、
   カットの設計(アングル・高さの比率)は崩れない。

   カメラを注視点から距離Dだけ後ろに置くとき、点Pの画面内座標は
     奥行き z = a·e + D 、横 x = a·r 、縦 y = a·u   (a = P - 注視点)
   で、xとyはDに依存しない。よって「収まる」条件 |x| <= z*tan(画角)は
   Dについて一次不等式になり、必要なDが閉じた形で求まる。
   毎フレーム独立に解くので履歴を持たず、決定論も保たれる */
const CAM_SAFE=0.86;          // 画面端に取る余白 (1=端ぎりぎり)

/* なめらかな最大値 (log-sum-exp)。
   ------------------------------------------------------------------
   フィット距離を素の Math.max で決めると、「どの馬が距離を決めているか」が
   入れ替わる瞬間に微分が飛ぶ。距離そのものは連続なので画は飛ばないが、
   寄り引きの速度が不連続になり、カクッと折れて見える。
   (実測: 16頭で入れ替わりが1カットに6回、最大 0.15 m/frame^2)

   log-sum-exp は上位が競っているときだけ滑らかに混ぜ、
   1点が明らかに支配的なら通常の最大値に一致する。履歴を持たないので決定論も保つ。
   結果は必ず真の最大値**以上**になる = 馬が見切れる方向へは動かない。
   k は「この幅[m]以内で競っている点どうしを混ぜる」意味。 */
const FIT_SOFT_M=0.9;
/* 「必ず収める」対象を先頭から何m後ろまで混ぜるか (mustSee の説明を参照)。
   大きいほど先頭交代がなめらかになるが、そのぶん画が引き気味になる */
let LEAD_BLEND_M=8.0;
function softMax(values, k=FIT_SOFT_M){
  let m=-Infinity;
  for(const v of values) if(v>m) m=v;
  if(!(k>0) || !isFinite(m)) return m;
  let s=0;
  for(const v of values) s+=Math.exp((v-m)/k);
  return m + k*Math.log(s);
}

function fitCamera(ctx, pos, look, must, want, safe, fov){
  const e=look.clone().sub(pos); const D0=e.length();
  if(!(D0>1e-6)) return pos;
  e.divideScalar(D0);
  const r=new THREE.Vector3().crossVectors(e,new THREE.Vector3(0,1,0));
  if(r.lengthSq()<1e-8) return pos;   // 真下を向いている時は何もしない
  r.normalize();
  const u=new THREE.Vector3().crossVectors(r,e).normalize();
  const vH=Math.tan((fov||ctx.cam.fov)*Math.PI/360)*(safe||CAM_SAFE), hH=vH*ctx.aspect;
  /* 横と縦のどちらが効くかも入れ替わりの元になるので、ここも softMax にする。
     点が重み P.w を持つ場合は「要求を出さない状態(=D0)」との間で混ぜる。
     w=0 なら D0 を返す = 何も要求しないのと同じ (mustSee の説明を参照) */
  const need=(P)=>{
    const a=P.clone().sub(look), ae=a.dot(e);
    const raw=softMax([Math.abs(a.dot(r))/hH - ae, Math.abs(a.dot(u))/vH - ae]);
    return P.w===undefined ? raw : D0 + P.w*(raw - D0);
  };
  const ds=[D0];
  for(const P of must) ds.push(need(P));                // 必須: 絶対に収める
  const D=softMax(ds);
  const dw=ds.slice();
  for(const P of want) dw.push(need(P));                // 任意: 入れば入れる
  // 引きすぎない上限。want が空(fitAll)なら softMax([D])===D なので素通り
  return look.clone().addScaledVector(e, -Math.min(softMax(dw), D*1.3));
}

/* 「収まっているか」の真偽判定 (allInside) はここにあったが削除した。
   真偽で分岐して補正を出し入れすると、切り替わる瞬間に画角が段差で飛ぶ。
   判定をやめ、常に「必要量となめらかな最大値を取る」形に統一してある。
   検算に使いたくなったら、その場で書くこと。復活させて分岐に使わないように */

/* pos から look を向いたとき、画面内に馬が1頭でもいるか */
function anyVisible(ctx, pos, look, fov){
  const e=look.clone().sub(pos); const D=e.length();
  if(!(D>1e-6)) return false;
  e.divideScalar(D);
  const r=new THREE.Vector3().crossVectors(e,new THREE.Vector3(0,1,0));
  if(r.lengthSq()<1e-8) return true;    // 真下向きは判定対象外
  r.normalize();
  const u=new THREE.Vector3().crossVectors(r,e).normalize();
  const vH=Math.tan((fov||ctx.cam.fov)*Math.PI/360), hH=vH*ctx.aspect;
  for(const P of ctx.allSee){
    const a=P.clone().sub(pos), z=a.dot(e);
    if(z<=0.1) continue;
    if(Math.abs(a.dot(r))<=z*hH && Math.abs(a.dot(u))<=z*vH) return true;
  }
  return false;
}

/* カットが framing(=画面に収めたい横幅[m]) を持つとき、
   注視点までの距離からその幅ちょうどになる画角を求める。
   距離が縮むほど画角が広がるので、被写体の見かけの大きさが一定に保たれる
   (中継のズームアウトと同じ挙動。定点カメラでは唯一の寄り引き手段) */
function fovForFraming(ctx, pos, look, framing){
  const D=pos.distanceTo(look);
  if(!(D>1e-3)) return CAM_FOV;
  const vHalf=(framing/2)/D/ctx.aspect;
  const f=2*Math.atan(vHalf)*180/Math.PI;
  return Math.max(6, Math.min(62, f));
}

/* 指定した点をすべて収めるのに必要な画角[deg]。
   定点カメラは動かせないので、収まらないときは画角を広げて対応する */
function fovToContain(ctx, pos, look, pts, safe){
  const e=look.clone().sub(pos); const D=e.length();
  if(!(D>1e-6)) return 0;
  e.divideScalar(D);
  const r=new THREE.Vector3().crossVectors(e,new THREE.Vector3(0,1,0));
  if(r.lengthSq()<1e-8) return 0;
  r.normalize();
  const u=new THREE.Vector3().crossVectors(r,e).normalize();
  let vH=0;
  for(const P of pts){
    const a=P.clone().sub(pos), z=a.dot(e);
    if(z<=0.1) continue;
    // 重み付きの点は要求も比例して薄める。w=0 なら 0 = 最大値に効かない
    const w=(P.w===undefined)?1:P.w;
    vH=Math.max(vH, w*Math.abs(a.dot(u))/z, w*Math.abs(a.dot(r))/z/ctx.aspect);
  }
  return 2*Math.atan(vH/(safe||CAM_SAFE))*180/Math.PI;
}

function applyCamera(ctx, tBase){
  let idx=SHOTS.length-1;
  for(let i=0;i<SHOTS.length;i++){ if(tBase<=SHOTS[i].until){idx=i;break;} }
  const cur=SHOTS[idx].fn(ctx, SHOTS[idx]);
  let pos=cur.pos, look=cur.look, label=SHOTS[idx].name;
  /* framingLook を持つカットは、画角を「その点までの距離」で決める。
     注視点(look)は被写体を追わせたまま、画角だけ固定したいときに使う */
  const fLook=SHOTS[idx].framingLook ? SHOTS[idx].framingLook(ctx) : look;
  let fov=SHOTS[idx].framing
    ? fovForFraming(ctx, pos, fLook, SHOTS[idx].framing) : CAM_FOV;
  // cut 指定のカットは前カットと繋がず、ばっさり切り替える (定点切替)
  if(ONE_TAKE && idx>0 && !SHOTS[idx].cut){
    const boundary=SHOTS[idx-1].until, TR=SHOTS[idx].trans||TRANSITION;
    if(tBase < boundary+TR){
      const blend=smoothstep(boundary, boundary+TR, tBase);
      const prev=SHOTS[idx-1].fn(ctx, SHOTS[idx-1]);
      const pf=SHOTS[idx-1].framing
        ? fovForFraming(ctx, prev.pos, prev.look, SHOTS[idx-1].framing) : CAM_FOV;
      pos=prev.pos.lerp(cur.pos, blend);
      look=prev.look.lerp(cur.look, blend);
      fov=pf+(fov-pf)*blend;
      label=SHOTS[idx-1].name+" → "+SHOTS[idx].name;
    }
  }
  /* 対象が切れないようカメラを後ろへ下げる。
     fit = 1位を絶対に収める (2,3着は任意) / fitAll = 全馬を収める。
     遷移中は前後どちらかのカットが対象なら適用する */
  /* 画角固定のカットでも、対象がはみ出すときは画角だけ広げて必ず収める
     (カメラ位置は動かさないので定点の性格は保たれる) */
  /* holdFrame は「補正をやめて構図を固定する度合い」。
     真偽値でも 0〜1 でも受ける。1 で補正なし。
     決勝線カメラのように途中で切り替わるものは 0〜1 で渡すこと。
     真偽値のまま切り替えると、その1フレームで補正が丸ごと消えて
     画角が段差で飛ぶ（実測 26.8°→23.1°＝14%のズームイン） */
  const holdRaw = typeof SHOTS[idx].holdFrame==="function"
    ? SHOTS[idx].holdFrame(ctx) : SHOTS[idx].holdFrame;
  const hold = holdRaw===true ? 1 : !holdRaw ? 0
             : Math.max(0, Math.min(1, holdRaw));
  if(SHOTS[idx].framing && hold<1){
    const pts=SHOTS[idx].fitAll ? ctx.allSee : ctx.mustSee;
    const want=fovToContain(ctx, pos, look, pts, SHOTS[idx].safe);
    fov=Math.min(78, fov + Math.max(0, want-fov)*(1-hold));
  }
  const near = ONE_TAKE && idx>0 && !SHOTS[idx].cut
             && tBase < SHOTS[idx-1].until+(SHOTS[idx].trans||TRANSITION)
             ? SHOTS[idx-1] : null;
  const eff = SHOTS[idx].framing ? null
            : (SHOTS[idx].fit||SHOTS[idx].fitAll ? SHOTS[idx]
            : (near && (near.fit||near.fitAll) ? near : null));
  if(eff){
    /* 画角は必ず引数で渡す。ctx.cam.fov は前フレームの値が残っており、
       カット切替の直後(前カットが望遠だった場合など)に極端な引きになる */
    if(eff.fitAll) pos=fitCamera(ctx, pos, look, ctx.allSee, [], eff.safe, fov);
    else           pos=fitCamera(ctx, pos, look, ctx.mustSee, ctx.wantSee, eff.safe, fov);
  }
  /* ================= 最後の砦 =================
     ここまでの構図(カット固有の計算・遷移のブレンド・画角補正)を全部通した
     最終的な pos/look/fov に対して、実際の1位が画面に入っているかを検算する。

     途中の補正はカットごとに別々の前提で計算しているため、
     遷移中や画角の上限に当たった場合に取りこぼしが出る。
     ここは「出来上がった画」だけを見るので、経路によらず必ず成立する。

     1. まず画角を広げて収める (定点の性格を壊さない)
     2. それでも足りなければカメラを後ろへ引く
     holdFrame のカット(決勝線通過後のゴールカメラ)は対象外。
     勝ち馬が線を過ぎて画面から抜けていくのは意図した画なので */
  /* 【重要】ここを if で分岐させないこと。
     「収まっていなければ広げる」という分岐は、判定のしきい値(0.985)と
     広げるときの余白(0.97)が食い違うため、条件が切り替わる瞬間に画角が段差で飛ぶ。
     実測で 1フレームに 2.47°、しかも往復するので画面がカクッと鳴っていた。

     分岐をやめ、常に「必要な画角となめらかな最大値を取る」形にする。
     必要量が現在の画角を下回っている間は素通りするので、通常時の画は変わらない。
     カメラを引く側も同様で、fitCamera は必要距離が今より短ければ現状を返す */
  if(hold<1){
    const FOV_SOFT_DEG=1.2;   // 画角を混ぜる幅[deg]
    const want=Math.min(72, softMax(
      [fov, fovToContain(ctx, pos, look, ctx.mustSee, 0.97)], FOV_SOFT_DEG));
    fov = fov + (want-fov)*(1-hold);
    pos = pos.clone().lerp(
      fitCamera(ctx, pos, look, ctx.mustSee, [], 0.97, fov), 1-hold);
  }
  /* holdFrame のカットでは、たとえ全馬が枠外へ抜けても引き戻さない。
     決勝線カメラは線を映し続けるのが正しく、引くと構図が壊れる。
     この状態は最後尾の入線直後の一瞬だけで、すぐ結果発表に切り替わる */
  ctx.cam.fov=fov; ctx.cam.updateProjectionMatrix();
  ctx.cam.position.copy(pos);
  ctx.cam.lookAt(look);
  return label;
}

/* ---------- シーン構築 ----------
   viewport はホストから渡される入れ物、stage はそこに敷くアスペクト比固定の枠。
   枠はこのモジュールが作る (ホストのCSSに寸法計算を持たせると
   カメラの画角計算と食い違うため、比率はエンジン側で握る) */
let viewport=null;
const stage=document.createElement("div");
stage.className="r3d-stage";
const renderer=new THREE.WebGLRenderer({antialias:true, preserveDrawingBuffer:true});
/* 影 (接地感)。
   ※ outputEncoding は既定(Linear)のまま。ここを sRGB にすると画面全体が
     浮いて16頭の毛色を全部調整し直すことになるため、影だけを足している。
     色空間の扱いは HANDOFF §「色空間の扱い」を参照 */
renderer.shadowMap.enabled=true;
renderer.shadowMap.type=THREE.PCFSoftShadowMap;
stage.prepend(renderer.domElement);
const scene=new THREE.Scene();
scene.background=new THREE.Color(0x9ec8e8);
scene.fog=new THREE.Fog(0x9ec8e8, 300, 900);
const CAM_FOV=45;   // 通常カットの画角 (分割画面の下段だけ望遠に切り替える)
const cam=new THREE.PerspectiveCamera(CAM_FOV,1,0.1,2000);
/* 環境光と太陽の比率。
   影を入れるまでは環境光0.9・太陽1.0だったが、この比率だと影の中も
   環境光でほぼ埋まってしまい、落ちた影が「少し暗い緑」にしかならない。
   芝の緑が飽和(G=255にクリップ)していた問題も同時に起きていた。

   そこで「日向の明るさの合計」を保ったまま比率だけ振り直してある:
     旧 0.9 + 1.00*sin42° = 1.569  (影の残光 0.9/1.569 = 57%)
     新 0.6 + 1.35*sin42° = 1.503  (影の残光 0.6/1.503 = 40%)
   日向の見た目はほぼ変わらず、影だけがはっきり出る。
   毛色の識別性を落とさない上限として 0.6 を選んでいる
   (0.45 まで下げると影は締まるが、日陰側の馬体が沈んで色が判別しにくい) */
scene.add(new THREE.HemisphereLight(0xdfefff,0x3a5a3a,0.6));
const sun=new THREE.DirectionalLight(0xfff2d8,1.35);

/* ---------- 太陽と影のシャドウカメラ ----------
   平行光の影は正射影カメラ1台で焼く。オーバルは最大2400m あるので
   全体を1枚で覆うと 1テクセルが1m を超えて影が溶ける。
   そこで「隊列の周りだけ」を覆う箱を毎フレーム動かす (updateSunShadow)。

   SUN_ELEV_DEG を下げるほど影が長く伸びて午後らしくなるが、
   同時に馬の陰影も変わる。方位は既存の (120,*,80) を維持して、
   高度だけ 54° → 42° に下げてある */
const SUN_AZI=new THREE.Vector3(120,0,80).normalize();
const SUN_ELEV_DEG=42;
const SUN_DIR=new THREE.Vector3(                       // 注視点から太陽へ向かう単位ベクトル
  SUN_AZI.x, Math.tan(SUN_ELEV_DEG*Math.PI/180), SUN_AZI.z).normalize();
const SHADOW_MAP=4096;   // 180m四方を4096px → 4.4cm/テクセル (馬体2.4mに対して十分)
const SHADOW_HALF=90;    // シャドウカメラが覆う範囲の半径[m]。隊列の最大長から決めている
const SHADOW_DIST=320;   // 隊列中心から光源までの距離[m]。near/far はこれを挟む
sun.castShadow=true;
sun.shadow.mapSize.set(SHADOW_MAP,SHADOW_MAP);
sun.shadow.camera.left=-SHADOW_HALF; sun.shadow.camera.right =SHADOW_HALF;
sun.shadow.camera.top = SHADOW_HALF; sun.shadow.camera.bottom=-SHADOW_HALF;
sun.shadow.camera.near=SHADOW_DIST-160; sun.shadow.camera.far=SHADOW_DIST+200;
/* normalBias は面の法線方向へサンプル位置をずらす。スキンメッシュ(馬)の
   自己遮蔽によるアクネはこれで消える。bias 単体で消そうとすると
   影が接地点から離れて浮いて見える */
sun.shadow.bias=-0.0004;
sun.shadow.normalBias=0.03;
scene.add(sun); scene.add(sun.target);

/* 補助光 (フィル)。影は落とさない。
   太陽と反対の方位から、高度をわざと低く (12°) 入れる。
     ・水平面 (馬場) には sin12°=0.21 しか乗らない → 地面の影のコントラストは保たれる
     ・垂直面 (馬の脇腹) には cos12°=0.98 で正面から当たる → 日陰側が持ち上がる
   撮影のフィルライトと同じ考え方。これが無いと、逆光のカットで
   鹿毛・青鹿毛が黒く潰れて毛色が判別できない (実測で日陰側が34%暗くなる)。
   色は空の照り返し寄りの淡い青白。芝の照り返し色にすると馬が緑に転ぶ */
const fill=new THREE.DirectionalLight(0xdfe6ee, 0.38);
fill.position.set(-SUN_AZI.x, Math.tan(12*Math.PI/180), -SUN_AZI.z)
             .normalize().multiplyScalar(300);
scene.add(fill);

/* three の lookAt が作る基底と同じものを先に組んでおく。
   z=SUN_DIR / x=cross(up,z) / y=cross(z,x) */
const _sRight=new THREE.Vector3().crossVectors(new THREE.Vector3(0,1,0),SUN_DIR).normalize();
const _sUp   =new THREE.Vector3().crossVectors(SUN_DIR,_sRight).normalize();
const _sTgt  =new THREE.Vector3();
/* シャドウカメラを隊列の中心へ移す。
   中心をそのまま入れるとカメラが動くたびに影の縁が1テクセル分ちらつくので
   (shadow crawling)、光源基底の上でテクセル単位に量子化してから置く。
   量子化幅は毎フレーム同じ = 決定論を壊さない */
function updateSunShadow(center){
  const texel=(2*SHADOW_HALF)/SHADOW_MAP;
  const a=Math.round(center.dot(_sRight)/texel)*texel;
  const b=Math.round(center.dot(_sUp)/texel)*texel;
  const c=center.dot(SUN_DIR);                    // 奥行き方向は量子化不要
  _sTgt.set(0,0,0).addScaledVector(_sRight,a).addScaledVector(_sUp,b)
                   .addScaledVector(SUN_DIR,c);
  sun.target.position.copy(_sTgt); sun.target.updateMatrixWorld();
  sun.position.copy(_sTgt).addScaledVector(SUN_DIR,SHADOW_DIST);
  sun.updateMatrixWorld();
}
updateSunShadow(new THREE.Vector3(0,0,0));

let courseObjects=[], horses=[], course=null, plan=null, cfg=null;

/* ================= 馬場の面 =================
   引き絵で走路が「緑の板」に見えないよう、3つを分けて作る。

   1. 芝の細かい粗さ  … CanvasTexture を実寸でタイリング
   2. 刈り分けの縞    … 頂点カラー (走路を横切る帯が進行方向に並ぶ。JRAと同じ向き)
   3. 走路/内馬場/場外 … 色をはっきり分ける。走路が一番明るく彩度が高い
                        (実際に一番手入れされているのは走路) */
const TURF_TILE_M = 6;     // 芝テクスチャの実寸周期[m]
const MOW_M       = 20;    // 刈り分け1帯の長さ[m]
const APRON_M     = 1.6;   // 走路の外へはみ出させる路肩の幅[m]
const WEAR_M      = 4.5;   // 内ラチ沿いが荒れている幅[m]

/* 芝の色。map と頂点カラーは掛け算になるので、テクスチャの平均輝度(約0.91)
   のぶんだけ明るめの値を持たせてある。ここを直接いじると
   テクスチャを外したときと明るさが食い違うので注意 */
const TURF_BASE  = 0x6dae5f;   // 走路
const TURF_WORN  = 0x87a35c;   // 内ラチ沿い: 擦れて土が透け黄土寄りになる
const TURF_APRON = 0x578f4c;   // 路肩: 刈っていない濃い芝
const INFIELD_C  = 0x51894d;   // 内馬場: 走路より暗く彩度も低い
const OUTSIDE_C  = 0x4a7d4a;   // 場外: さらに暗い

/* 芝テクスチャ。TURF_TILE_M 四方でタイリングする。
   継ぎ目を出さないため、1本のストロークを上下左右にも複製して描く
   (9倍描くので、コース設定を変えるたびに作り直さないようキャッシュする)。
   乱数はシード付き = 毎回まったく同じ絵になる */
let _turfTex=null;
function turfTexture(){
  if(_turfTex) return _turfTex;
  const S=256, rng=mulberry32(7);
  const cv=document.createElement("canvas"); cv.width=cv.height=S;
  const c=cv.getContext("2d");
  c.fillStyle="#f0f0f0"; c.fillRect(0,0,S,S);
  /* 低周波のムラ (生育と刈りのばらつき)。
     これが無いと、細かい筋だけになって近景で砂嵐のように見える */
  for(let i=0;i<110;i++){
    const x=rng()*S, y=rng()*S, r0=18+rng()*34;
    const v=Math.round(230+rng()*20);
    for(const dx of [-S,0,S]) for(const dy of [-S,0,S]){
      const g=c.createRadialGradient(x+dx,y+dy,0,x+dx,y+dy,r0);
      g.addColorStop(0,`rgba(${v},${v},${v},0.5)`);
      g.addColorStop(1,`rgba(${v},${v},${v},0)`);
      c.fillStyle=g; c.fillRect(x+dx-r0,y+dy-r0,r0*2,r0*2);
    }
  }
  /* 芝の筋。明暗の幅を狭く取る (広げるとピクセル単位のちらつきになる) */
  c.lineCap="round";
  for(let i=0;i<1500;i++){
    const x=rng()*S, y=rng()*S, a=rng()*Math.PI*2;
    const len=2+rng()*5;
    c.lineWidth=0.8+rng()*1.2;
    const v=Math.round(218+rng()*34);
    c.strokeStyle=`rgb(${v},${v},${v})`;
    for(const dx of [-S,0,S]) for(const dy of [-S,0,S]){
      c.save(); c.translate(x+dx,y+dy); c.rotate(a);
      c.beginPath(); c.moveTo(-len/2,0); c.lineTo(len/2,0); c.stroke();
      c.restore();
    }
  }
  _turfTex=new THREE.CanvasTexture(cv);
  _turfTex.wrapS=_turfTex.wrapT=THREE.RepeatWrapping;
  _turfTex.anisotropy=renderer.capabilities.getMaxAnisotropy();
  return _turfTex;
}
/* 同じ画像を別の繰り返し幅で使うためのクローン。
   repeat はテクスチャごとの値なので、走路・内馬場・場外で使い回せない */
function turfTextureRepeat(rx,ry){
  const t=turfTexture().clone(); t.needsUpdate=true; t.repeat.set(rx,ry);
  return t;
}

/* ================= スタンドまわりのテクスチャ =================
   どれも自前のシード付き乱数で描き、結果をキャッシュする。
   buildCourse の rngC を消費すると、キャッシュの有無で乱数の進み方が変わり
   木の配置がコース設定のたびに動いてしまう */

/* 観客。以前は暗い背景に色付きの丸を撒いただけで、引き絵では
   色ノイズの帯にしか見えなかった。頭と胴を分けて描き、段ごとに並べる */
/* 【縮尺を必ず合わせる】このテクスチャは実寸 CROWD_TILE_M 四方の客席を表す。
   横と縦で px/m が違うと人が潰れる。最初 512x256 で作ったところ、
   横21px/m・縦10px/m になって、観客が「縦長の色の棒」に見えた */
const CROWD_TILE_M=24;
let _crowdTex=null;
function crowdTexture(){
  if(_crowdTex) return _crowdTex;
  const S=512, rng=mulberry32(23);
  const PX=S/CROWD_TILE_M;                              // 21.3 px/m
  const cv=document.createElement("canvas"); cv.width=cv.height=S;
  const c=cv.getContext("2d");
  c.fillStyle="#4b515a"; c.fillRect(0,0,S,S);           // 座席
  const ROWS=Math.round(CROWD_TILE_M/0.95), rowH=S/ROWS;  // 1段0.95m
  for(let r=0;r<ROWS;r++){
    const y=S-(r+1)*rowH;
    c.fillStyle="rgba(0,0,0,0.30)";                     // 段鼻の影
    c.fillRect(0,y+rowH-1.5,S,1.5);
    const n=Math.round(CROWD_TILE_M/0.52);              // 1人あたり0.52m
    for(let i=0;i<n;i++){
      if(rng()<0.12) continue;                          // 空席
      const x=(i+0.5+(rng()-0.5)*0.5)*(S/n);
      const body=`hsl(${(rng()*360)|0},${(30+rng()*45)|0}%,${(38+rng()*34)|0}%)`;
      const skin=`hsl(${(24+rng()*14)|0},${(30+rng()*18)|0}%,${(52+rng()*22)|0}%)`;
      for(const dx of [-S,0,S]){                        // 横は繰り返すので端を跨いで描く
        c.fillStyle=body;                               // 胴 (肩幅0.45m × 高さ0.65m)
        c.fillRect(x+dx-0.225*PX, y+rowH-0.80*PX, 0.45*PX, 0.65*PX);
        c.fillStyle=skin;                               // 頭 (半径0.16m)
        c.beginPath(); c.arc(x+dx, y+rowH-0.86*PX, 0.16*PX, 0, Math.PI*2); c.fill();
      }
    }
  }
  _crowdTex=new THREE.CanvasTexture(cv);
  _crowdTex.wrapS=THREE.RepeatWrapping;
  _crowdTex.wrapT=THREE.ClampToEdgeWrapping;
  _crowdTex.anisotropy=renderer.capabilities.getMaxAnisotropy();
  return _crowdTex;
}

/* スタンドの躯体の外壁。
   窓を1つずつ抜いた格子ではなく、階ごとの水平連窓にしてある。
   格子だと引き絵で細かい網目になって建物に見えないうえ、
   ガラスを暗くすると壁全体が黒い塊になる */
const FACADE_TILE_W=28, FACADE_TILE_H=14;   // 1タイルの実寸[m] (4層)
let _facadeTex=null;
function facadeTexture(w,h){
  if(!_facadeTex){
    const S=256;
    const cv=document.createElement("canvas"); cv.width=cv.height=S;
    const c=cv.getContext("2d");
    c.fillStyle="#c9ccce"; c.fillRect(0,0,S,S);              // コンクリート
    const FLOORS=4, fh=S/FLOORS;
    for(let f=0;f<FLOORS;f++){
      const y=f*fh;
      c.fillStyle="#6f8496"; c.fillRect(0, y+fh*0.30, S, fh*0.46);   // 連窓
      c.fillStyle="rgba(255,255,255,0.22)";                          // 空の映り込み
      c.fillRect(0, y+fh*0.30, S, fh*0.13);
      c.fillStyle="rgba(0,0,0,0.18)";                                // 庇の影
      c.fillRect(0, y+fh*0.30, S, fh*0.05);
      c.fillStyle="#b4b8bb";                                         // 方立
      for(let k=0;k<S;k+=S/22) c.fillRect(k, y+fh*0.30, 1.5, fh*0.46);
    }
    _facadeTex=new THREE.CanvasTexture(cv);
    _facadeTex.wrapS=_facadeTex.wrapT=THREE.RepeatWrapping;
    _facadeTex.anisotropy=renderer.capabilities.getMaxAnisotropy();
  }
  const t=_facadeTex.clone(); t.needsUpdate=true;
  t.repeat.set(Math.max(1,Math.round(w/FACADE_TILE_W)),
               Math.max(1,Math.round(h/FACADE_TILE_H)));
  return t;
}

/* ================= 部材をまとめる小道具 =================
   examples/js の BufferGeometryUtils は読み込んでいないので、自前で頂点を積む。
   発走ゲートのように「小さな静止部材が何十個も集まる」ものは、
   1つずつ Mesh にするとそれだけでドローコールが数十になる。

   使い方: const d=newParts(); pushBox(d,...); pushBar(d,...); partsMesh(d,mat) */
function newParts(){ return {pos:[], nrm:[], uv:[], idx:[]}; }
/* 単位立方体の6面。各面は外から見て反時計回り (法線が外を向く) */
const _BOXF=[
  {n:[ 1,0,0], v:[[ 1,-1, 1],[ 1,-1,-1],[ 1, 1,-1],[ 1, 1, 1]]},
  {n:[-1,0,0], v:[[-1,-1,-1],[-1,-1, 1],[-1, 1, 1],[-1, 1,-1]]},
  {n:[0, 1,0], v:[[-1, 1, 1],[ 1, 1, 1],[ 1, 1,-1],[-1, 1,-1]]},
  {n:[0,-1,0], v:[[-1,-1,-1],[ 1,-1,-1],[ 1,-1, 1],[-1,-1, 1]]},
  {n:[0,0, 1], v:[[-1,-1, 1],[ 1,-1, 1],[ 1, 1, 1],[-1, 1, 1]]},
  {n:[0,0,-1], v:[[ 1,-1,-1],[-1,-1,-1],[-1, 1,-1],[ 1, 1,-1]]},
];
/* 軸に沿った直方体。sx,sy,sz は全長 (半分ではない) */
function pushBox(d, sx,sy,sz, cx,cy,cz){
  for(const f of _BOXF){
    const b=d.pos.length/3;
    for(const v of f.v){
      d.pos.push(cx+v[0]*sx/2, cy+v[1]*sy/2, cz+v[2]*sz/2);
      d.nrm.push(f.n[0],f.n[1],f.n[2]);
      d.uv.push(0,0);
    }
    d.idx.push(b,b+1,b+2, b,b+2,b+3);
  }
}
/* 2点を結ぶ角材。斜材 (トラスの筋交い・台車のブレース) 用。
   軸に直交する基底を作ってから断面を回す */
const _pbA=new THREE.Vector3(), _pbR=new THREE.Vector3(), _pbU=new THREE.Vector3();
function pushBar(d, ax,ay,az, bx,by,bz, t){
  _pbA.set(bx-ax,by-ay,bz-az);
  const len=_pbA.length(); if(len<1e-6) return;
  _pbA.divideScalar(len);
  _pbU.set(Math.abs(_pbA.y)>0.9?1:0, Math.abs(_pbA.y)>0.9?0:1, 0);
  _pbR.crossVectors(_pbU,_pbA).normalize();
  _pbU.crossVectors(_pbA,_pbR).normalize();
  const mx=(ax+bx)/2, my=(ay+by)/2, mz=(az+bz)/2;
  for(const f of _BOXF){
    const b=d.pos.length/3;
    for(const v of f.v){
      const px=v[0]*t/2, py=v[1]*t/2, pz=v[2]*len/2;
      d.pos.push(mx + _pbR.x*px + _pbU.x*py + _pbA.x*pz,
                 my + _pbR.y*px + _pbU.y*py + _pbA.y*pz,
                 mz + _pbR.z*px + _pbU.z*py + _pbA.z*pz);
      d.nrm.push(_pbR.x*f.n[0]+_pbU.x*f.n[1]+_pbA.x*f.n[2],
                 _pbR.y*f.n[0]+_pbU.y*f.n[1]+_pbA.y*f.n[2],
                 _pbR.z*f.n[0]+_pbU.z*f.n[1]+_pbA.z*f.n[2]);
      d.uv.push(0,0);
    }
    d.idx.push(b,b+1,b+2, b,b+2,b+3);
  }
}
/* +X を向く板 (ゲートの馬房の仕切り)。UV は実寸で渡してタイリングさせる。
   両面から見えるので、材質側を DoubleSide にして使うこと */
function pushPanelX(d, x, y0,y1, z0,z1, uMax,vMax){
  const b=d.pos.length/3;
  const P=[[z1,y0,0,0],[z0,y0,uMax,0],[z0,y1,uMax,vMax],[z1,y1,0,vMax]];
  for(const p of P){ d.pos.push(x,p[1],p[0]); d.nrm.push(1,0,0); d.uv.push(p[2],p[3]); }
  d.idx.push(b,b+1,b+2, b,b+2,b+3);
}
/* +Z を向く板。テクスチャアトラスから切り出すので UV を明示で渡す */
function pushQuad(d, cx,cy,cz, w,h, u0,v0,u1,v1){
  const b=d.pos.length/3;
  const P=[[-1,-1,u0,v0],[1,-1,u1,v0],[1,1,u1,v1],[-1,1,u0,v1]];
  for(const p of P){
    d.pos.push(cx+p[0]*w/2, cy+p[1]*h/2, cz);
    d.nrm.push(0,0,1);
    d.uv.push(p[2],p[3]);
  }
  d.idx.push(b,b+1,b+2, b,b+2,b+3);
}
function partsMesh(d, mat){
  const g=new THREE.BufferGeometry();
  g.setAttribute("position",new THREE.Float32BufferAttribute(d.pos,3));
  g.setAttribute("normal",  new THREE.Float32BufferAttribute(d.nrm,3));
  g.setAttribute("uv",      new THREE.Float32BufferAttribute(d.uv,2));
  g.setIndex(d.idx);
  return new THREE.Mesh(g,mat);
}

/* ゲートの仕切り板の金網。
   【alphaTest で本当に抜かない】遠景でミップマップが平均化されると
   アルファが 0.5 付近に寄り、板がまだらに消えてちらつく。
   スタート全景では40〜80m先に見えるので、抜かずに模様だけ乗せる */
let _meshTex=null;
function gateMeshTexture(){
  if(_meshTex) return _meshTex;
  const S=64;
  const cv=document.createElement("canvas"); cv.width=cv.height=S;
  const c=cv.getContext("2d");
  c.fillStyle="#c8ccd0"; c.fillRect(0,0,S,S);
  c.strokeStyle="#8d949b"; c.lineWidth=2.5;
  for(let k=0;k<=S;k+=S/4){
    c.beginPath(); c.moveTo(k,0); c.lineTo(k,S); c.stroke();
    c.beginPath(); c.moveTo(0,k); c.lineTo(S,k); c.stroke();
  }
  _meshTex=new THREE.CanvasTexture(cv);
  _meshTex.wrapS=_meshTex.wrapT=THREE.RepeatWrapping;
  _meshTex.anisotropy=Math.min(4, renderer.capabilities.getMaxAnisotropy());
  return _meshTex;
}

/* 前扉。緑の枠に横桟が入った作り。
   単色の板にすると、閉じているあいだゲートの前面が緑一色の壁に見える */
let _doorTex=null;
function gateDoorTexture(){
  if(_doorTex) return _doorTex;
  const W=64,H=96;
  const cv=document.createElement("canvas"); cv.width=W; cv.height=H;
  const c=cv.getContext("2d");
  c.fillStyle="#2f5d3a"; c.fillRect(0,0,W,H);            // 枠
  c.fillStyle="#24462c"; c.fillRect(6,6,W-12,H-12);      // 奥まった面
  c.fillStyle="#3c7449";                                  // 横桟
  for(let k=0;k<4;k++) c.fillRect(6, 12+k*20, W-12, 9);
  _doorTex=new THREE.CanvasTexture(cv);
  _doorTex.anisotropy=Math.min(4, renderer.capabilities.getMaxAnisotropy());
  return _doorTex;
}

/* 馬番プレートは16枚まとめて1枚のアトラスにする (ドローコール16→1) */
function gateNumberAtlas(n, cols){
  const CELL=64, rows=Math.ceil(n/cols);
  const cv=document.createElement("canvas");
  cv.width=cols*CELL; cv.height=rows*CELL;
  const c=cv.getContext("2d");
  for(let i=0;i<n;i++){
    const x=(i%cols)*CELL, y=Math.floor(i/cols)*CELL;
    c.fillStyle="#e8bb2c"; c.fillRect(x,y,CELL,CELL);
    c.fillStyle="#6b5510"; c.fillRect(x,y,CELL,3);
    c.fillStyle="#141414";
    c.font=`bold ${i+1<10?46:38}px sans-serif`;
    c.textAlign="center"; c.textBaseline="middle";
    c.fillText(String(i+1), x+CELL/2, y+CELL/2+2);
  }
  const t=new THREE.CanvasTexture(cv);
  t.anisotropy=Math.min(4, renderer.capabilities.getMaxAnisotropy());
  return t;
}

/* ターフビジョンの画面。レース間の表示を想定して、距離と枠色の一覧を出す。
   キャッシュしないのは、距離と頭数で内容が変わるため */
function turfVisionTexture(){
  /* 512x128。画面の実寸は最大52m×12.4mなので約10px/m あり、これで十分。
     以前は 1024x256 で、走査線(1pxおき)まで描いていた。
     細かい模様は遠景でちらつくだけで、負荷に見合わない */
  const W=512, H=128;
  const cv=document.createElement("canvas"); cv.width=W; cv.height=H;
  const c=cv.getContext("2d");
  c.fillStyle="#12161d"; c.fillRect(0,0,W,H);
  c.fillStyle="#1b4d8f"; c.fillRect(0,0,W,26);          // ヘッダ帯
  c.fillStyle="#ffffff"; c.font="bold 17px sans-serif";
  c.textBaseline="middle";
  c.textAlign="left";  c.fillText("RACE", 12, 14);
  c.textAlign="right"; c.fillText(`${course.raceLen}m`, W-12, 14);
  /* 枠色の一覧。遠目には「色の並んだ大画面」として読めればよい。
     【枠2は黒】なので、縁取りを付けないと画面の地に溶けて欠けて見える */
  const n=cfg? cfg.n : 10;
  const bw=(W-20)/n;
  for(let i=0;i<n;i++){
    const w=WAKU[wakuOf(i+1,n)-1];
    const x=10+i*bw+1, bwi=bw-2;
    c.fillStyle="#9aa4b0"; c.fillRect(x-1, 41, bwi+2, 70);   // 縁取り
    c.fillStyle=w.bg;      c.fillRect(x,   42, bwi,   68);
    /* 【文字はブロック幅に合わせて縮める】
       固定サイズにしていたため、16頭のときに2桁の馬番がブロックから
       はみ出して隣と繋がり、番号と枠色がずれて見えていた */
    c.fillStyle=w.fg; c.font=`bold ${Math.min(33, bwi*0.62)|0}px sans-serif`;
    c.textAlign="center";
    c.fillText(String(i+1), x+bwi/2, 77);
  }
  const t=new THREE.CanvasTexture(cv);
  t.anisotropy=Math.min(4, renderer.capabilities.getMaxAnisotropy());
  return t;
}

function buildCourse(){
  for(const o of courseObjects) scene.remove(o);
  courseObjects=[];
  const add=(...objs)=>{for(const o of objs){scene.add(o);courseObjects.push(o);}};
  const rngC=mulberry32(42); // 装飾配置用 (シード固定=毎回同じ景観)
  /* かつてここに SEG=240 という「1周を何分割するか」の定数があり、
     走路の芝目もラチも距離標もこれを基準にしていた。全長に比例して
     刻みが変わってしまうため、今はどれもメートル基準で刻んでいる */
  const HALF=TRACK_HALF;

  /* スタンドと木々は「ホームストレートの外側」「向正面の外側」という
     向きを持った装飾。オーバルは180°回転対称なので、右回り(鏡像)では
     この一式をまとめて180°回せば正しい側に来る。
     鏡像スケール(scale.z=-1)は法線が裏返って陰影が壊れるので使わない */
  const deco=new THREE.Group();
  deco.rotation.y = course.hand>0 ? 0 : Math.PI;
  add(deco);
  const addDeco=(...objs)=>{ for(const o of objs) deco.add(o); };

  // ---- 場外の地面 ----
  /* 走路とはっきり色を分ける。以前は「明度差が大きいと境界が段差に見える」
     という理由で芝に寄せていたが、そのせいでコースの形が読めなくなっていた。
     段差に見える原因は色ではなく、走路(y=0)と地面(y=-0.06)の6cmの崖なので、
     走路の側に路肩(APRON_M)を張り出させて隠す方で解決している。
     テクスチャは遠くまで続くので、走路より粗く刻んでモアレを避ける */
  const ground=new THREE.Mesh(
    new THREE.PlaneGeometry(2600,2600),
    new THREE.MeshLambertMaterial({color:OUTSIDE_C,
      map:turfTextureRepeat(2600/(TURF_TILE_M*2), 2600/(TURF_TILE_M*2))}));
  ground.rotation.x=-Math.PI/2; ground.position.y=-0.06;
  ground.receiveShadow=true;   // 地面は受けるだけ (投げると自分自身に落ちる)
  add(ground);

  // ---- 内馬場 (走路の内側: 明るい芝 + 池) ----
  {
    const L=course.straight, R=course.radius;
    const shape=new THREE.Shape();
    const rIn=R-HALF+0.4; // 内ラチの下まで延長 (土台がのぞく隙間を作らない)
    shape.moveTo(-L/2, rIn);
    shape.lineTo(L/2, rIn);
    shape.absarc(L/2,0,rIn,Math.PI/2,-Math.PI/2,true);
    shape.lineTo(-L/2,-rIn);
    shape.absarc(-L/2,0,rIn,-Math.PI/2,Math.PI/2,true);
    /* ShapeGeometry の UV は形状の x,y (=メートル) がそのまま入るので、
       repeat に 1/実寸周期 を入れれば走路と同じ密度の芝目になる */
    const infield=new THREE.Mesh(new THREE.ShapeGeometry(shape,48),
      new THREE.MeshLambertMaterial({color:INFIELD_C,
        map:turfTextureRepeat(1/TURF_TILE_M, 1/TURF_TILE_M)}));
    infield.rotation.x=-Math.PI/2; infield.position.y=-0.02;
    infield.receiveShadow=true;
    add(infield);
    // 池
    const pond=new THREE.Mesh(new THREE.CircleGeometry(Math.min(40,rIn*0.4),32),
      new THREE.MeshLambertMaterial({color:0x4a7fa8}));
    pond.rotation.x=-Math.PI/2; pond.position.set(-L/4,0.0,0);
    add(pond);
  }

  /* ---- 馬場: 走路のリボン ----
     1周を1枚のメッシュで張り、色は頂点カラーで持たせる
     (刈り分けの縞 × 幅方向の荒れ を1つの属性にまとめられる)。

     【帯の長さは必ずメートルで決める】
     以前は「240分割のうち6セグメントごと」だったため、帯の長さが
     コースの全長に比例していた (小回り25m / 広い56m)。広いコースでは
     縞が間延びして刈り分けに見えなかった。

     【帯の数は必ず偶数にする】
     奇数だと1周して戻ったところで同じ明るさの帯が隣り合い、
     そこだけ倍の幅の帯ができてしまう。 */
  {
    const bands=Math.max(2, Math.round(course.total/MOW_M/2)*2);
    const PER=10;                 // 1帯あたりの分割数 (帯の境目が必ず分割の境目に来る)
    const segLen=course.total/(bands*PER);
    /* 芝テクスチャの進行方向の周期。1周でちょうど整数回繰り返すよう
       TURF_TILE_M から微調整する。単純に d/TURF_TILE_M にすると
       1周して戻ったところで UV が飛び、走路を横切る継ぎ目の線が1本出る
       (例: 1周1000m / 6m = 166.67回 → 0.67タイルぶんのずれ)。
       ずれは 0.5%未満なので、芝目の細かさは見た目には変わらない */
    const tileV=course.total/Math.max(1,Math.round(course.total/TURF_TILE_M));

    /* 幅方向の断面。t は内向き法線に沿ったオフセット[m] なので
       +HALF が内ラチ際、-HALF が外ラチ際 (course.sample の規約と同じ)。
       内ラチ沿いは実際に最も傷むので、そこだけ色を変えて手前まで補間させる */
    const CROSS=[
      {t:-HALF-APRON_M, c:TURF_APRON, apron:true},  // 外の路肩
      {t:-HALF,         c:TURF_BASE },              // 外ラチ際
      {t: 0,            c:TURF_BASE },              // 中央
      {t: HALF-WEAR_M,  c:TURF_BASE },              // 荒れの始まり
      {t: HALF,         c:TURF_WORN },              // 内ラチ際
      {t: HALF+APRON_M, c:TURF_APRON, apron:true},  // 内の路肩
    ];
    const NC=CROSS.length;
    const verts=[], uvs=[], cols=[], idx=[];
    const _col=new THREE.Color();
    let vi=0;
    for(let b=0;b<bands;b++){
      // 路肩は刈っていないので縞を乗せない (走路の縁が1本の線として立つ)
      const mow = (b%2) ? 0.94 : 1.06;   // 明暗差 約13%
      for(let k=0;k<=PER;k++){
        const d=(b*PER+k)*segLen;
        const {pos,tan}=course.point(d);
        const n=normalOf(tan);
        for(const col of CROSS){
          const p=pos.clone().addScaledVector(n,col.t);
          verts.push(p.x,0,p.z);
          uvs.push((col.t+HALF+APRON_M)/TURF_TILE_M, d/tileV);
          _col.setHex(col.c); if(!col.apron) _col.multiplyScalar(mow);
          cols.push(_col.r,_col.g,_col.b);
        }
      }
      /* 帯ごとに頂点を作り直しているので、帯の境目で色が補間されず
         刈り分けの線がはっきり出る (頂点を共有すると2mかけて滲む)。

         【巻き方向は回り方で反転させる】右回りは z を反転した鏡像なので、
         同じ頂点順のままだと三角形の表裏が裏返り、上から見ると
         背面カリングで走路が消える */
      for(let k=0;k<PER;k++){
        for(let ci=0;ci<NC-1;ci++){
          const a=vi+k*NC+ci, bb=a+1, cc=a+NC, dd=cc+1;
          if(course.hand>0) idx.push(a,cc,bb, bb,cc,dd);
          else              idx.push(a,bb,cc, bb,dd,cc);
        }
      }
      vi+=(PER+1)*NC;
    }
    const g=new THREE.BufferGeometry();
    g.setAttribute("position",new THREE.Float32BufferAttribute(verts,3));
    g.setAttribute("uv",      new THREE.Float32BufferAttribute(uvs,2));
    g.setAttribute("color",   new THREE.Float32BufferAttribute(cols,3));
    /* 走路は完全な水平面なので法線は真上で確定。computeVertexNormals に
       任せると巻き方向の間違いが「暗くなるだけ」で表に出ず気付きにくい */
    const nrm=new Float32Array(verts.length);
    for(let i=1;i<nrm.length;i+=3) nrm[i]=1;
    g.setAttribute("normal", new THREE.BufferAttribute(nrm,3));
    g.setIndex(idx);
    const turf=new THREE.Mesh(g, new THREE.MeshLambertMaterial({
      color:0xffffff, vertexColors:true, map:turfTexture()}));
    /* 走路は受けるだけ。投げると、y=0 の走路リボンが y=-0.06 の場外の地面へ
       走路の形の黒い帯を落として、コースの外側が不自然に暗くなる */
    turf.receiveShadow=true;
    add(turf);
  }

  /* ---- ラチ ----
     内ラチと外ラチは作りを変える。内ラチは常に画面に入るので上桟を太くし
     支柱も詰める。外ラチは少し高くして間隔を空ける。

     【支柱の間隔はメートルで決める】
     以前は「240分割のうち2セグメントごと」だったため間隔が全長に比例し、
     小回り8.3m / 広い18.7m になっていた。18.7m間隔では柵ではなく点線に見える。

     【桟は1つのジオメトリにまとめる】
     以前は1セグメントに1本ずつ Mesh を作っていて、これだけで480ドローコール
     あった。断面を走路に沿って掃引して1本に繋ぐ。 */
  const railMat=new THREE.MeshLambertMaterial({color:0xf7f7f2});
  {
    // side は内向き法線に沿ったオフセット[m] (+が内側 / -が外側)
    const RAILS=[
      { side: HALF+0.5, postM:4.0,   // 内ラチ: 中継に必ず映る側
        top:{y:1.15,w:0.15,h:0.11}, mid:{y:0.62,w:0.07,h:0.06} },
      { side:-HALF-0.5, postM:6.0,   // 外ラチ: 少し高く、間隔は広い
        top:{y:1.30,w:0.11,h:0.09}, mid:{y:0.70,w:0.06,h:0.05} },
    ];
    const SAMPLE_M=2;   // 掃引の刻み[m]。半径64mのコーナーで矢高0.8cm
    const rPos=[], rNrm=[], rIdx=[];

    /* 走路に沿って角材を1本通す。
       断面の面ごとに頂点を分けること。共有して computeVertexNormals に
       任せると角が丸まって、角材ではなく細い筒に見える。
       底面は絶対に見えないので張らない (頂点と三角形が25%減る) */
    const sweepBar=(side,y,w,h)=>{
      const N=Math.max(8, Math.round(course.total/SAMPLE_M));
      /* [横,縦] は ±1。w/2 h/2 を掛けて使う。
         a→b→(次のリングのa) が外から見て反時計回りになる並び (左回り基準) */
      const faces=[
        {a:[ 1, 1], b:[-1, 1], nrm:"up" },   // 天面
        {a:[ 1,-1], b:[ 1, 1], nrm:"in" },   // 内向きの側面
        {a:[-1, 1], b:[-1,-1], nrm:"out"},   // 外向きの側面
      ];
      for(const f of faces){
        const base=rPos.length/3;
        for(let s=0;s<=N;s++){
          const d=(s%N)/N*course.total;      // s=N は s=0 と同じ位置 → 輪が閉じる
          const {pos,tan}=course.point(d);
          const n=normalOf(tan);
          const p=pos.clone().addScaledVector(n,side);
          const nv = f.nrm==="up" ? [0,1,0]
                   : f.nrm==="in" ? [n.x,0,n.z] : [-n.x,0,-n.z];
          for(const [cn,cu] of [f.a,f.b]){
            rPos.push(p.x+n.x*cn*w/2, y+cu*h/2, p.z+n.z*cn*w/2);
            rNrm.push(nv[0],nv[1],nv[2]);
          }
        }
        // 右回りは z を反転した鏡像なので巻き方向も反転させる (走路と同じ理由)
        for(let s=0;s<N;s++){
          const a=base+s*2, b=a+1, c=a+2, e=a+3;
          if(course.hand>0) rIdx.push(a,b,c, b,e,c);
          else              rIdx.push(a,c,b, b,c,e);
        }
      }
    };

    /* 支柱。足元を広げた回転体にする。ただの角柱だと下端が芝に接している
       だけで「地面に置いてある」ように見え、刺さって見えない。
       高さ1.0で作っておき、ラチごとに Y だけ伸ばして使う */
    const postGeo=new THREE.LatheGeometry([
      new THREE.Vector2(0.105,0.00),
      new THREE.Vector2(0.075,0.06),
      new THREE.Vector2(0.055,0.16),
      new THREE.Vector2(0.050,0.97),
      new THREE.Vector2(0.000,1.00),
    ], 6);
    const nPosts=RAILS.reduce((a,r)=>a+Math.max(4,Math.round(course.total/r.postM)),0);
    const postMesh=new THREE.InstancedMesh(postGeo,railMat,nPosts);
    let pi=0; const m4=new THREE.Matrix4();
    for(const r of RAILS){
      const M=Math.max(4,Math.round(course.total/r.postM));
      const H=r.top.y+0.05;
      for(let k=0;k<M;k++){
        const {pos,tan}=course.point((k/M)*course.total);
        const p=pos.clone().addScaledVector(normalOf(tan),r.side);
        m4.makeScale(1,H,1); m4.setPosition(p.x,0,p.z);
        postMesh.setMatrixAt(pi++,m4);
      }
      sweepBar(r.side, r.top.y, r.top.w, r.top.h);
      sweepBar(r.side, r.mid.y, r.mid.w, r.mid.h);
    }
    postMesh.count=pi;
    postMesh.castShadow=true; postMesh.receiveShadow=true;
    add(postMesh);

    const rg=new THREE.BufferGeometry();
    rg.setAttribute("position",new THREE.Float32BufferAttribute(rPos,3));
    rg.setAttribute("normal",  new THREE.Float32BufferAttribute(rNrm,3));
    rg.setIndex(rIdx);
    const rails=new THREE.Mesh(rg,railMat);
    rails.castShadow=true; rails.receiveShadow=true;
    add(rails);
  }

  /* ---- 距離標 (200mごと) ----
     内ラチの内側に立てる。実際のJRAと同じ位置。
     ※以前のコメントは「ゴール前カメラの視線を横切るので外側に設置」と
       書いてあったが、コードは一貫して内側 (HALF+1.4) に置いていた。
       一番ゴールに近い標識でも200m手前なので、寄りのカットには入らない。

     【範囲】残り距離が1周を超えると同じ場所に重なるので、そこで打ち切る。
     以前は 1000m 固定で、広いコース(2400m)では前半1400mに1本も立たなかった */
  {
    const maxM=Math.min(course.raceLen-100, course.total-200);
    for(let m=200; m<=maxM; m+=200){
      const p=course.sample(1 - m/course.raceLen, HALF+1.6);
      const pole=new THREE.Mesh(new THREE.CylinderGeometry(0.055,0.07,2.35,6),
        new THREE.MeshLambertMaterial({color:0xf2f2ee}));
      pole.position.copy(p.pos); pole.position.y=1.175;
      pole.castShadow=true;
      // 残り距離の数字を入れた板。200m単位を青、400m単位を赤で帯分けする
      const cv=document.createElement("canvas"); cv.width=256; cv.height=160;
      const c=cv.getContext("2d");
      c.fillStyle="#f4f4f0"; c.fillRect(0,0,256,160);
      c.fillStyle = m%400===0 ? "#d8262c" : "#2a55b8";
      c.fillRect(0,0,256,30);
      c.fillStyle="#14181a"; c.font="bold 104px sans-serif";
      c.textAlign="center"; c.textBaseline="middle";
      c.fillText(String(m), 128, 104);
      const plate=new THREE.Mesh(new THREE.PlaneGeometry(0.9,0.5625),
        new THREE.MeshLambertMaterial({map:new THREE.CanvasTexture(cv),
                                       side:THREE.DoubleSide}));
      plate.position.copy(p.pos); plate.position.y=2.05;
      /* PlaneGeometry の法線はローカル+Z。ヨーを走路の向き+90°にすると
         法線が走路を横断する向き(法線 n)になり、コースの内外どちらからも読める */
      plate.rotation.y=Math.atan2(p.tan.x,p.tan.z)+Math.PI/2;
      plate.castShadow=true;
      add(pole,plate);
    }
  }

  // ---- ゴール板 (紅白ポール + 白板) ----
  const gp=course.sample(1.0,0);
  const gn=normalOf(gp.tan);
  {
    const cv=document.createElement("canvas"); cv.width=32; cv.height=256;
    const c=cv.getContext("2d");
    for(let i=0;i<8;i++){c.fillStyle=i%2?"#ffffff":"#d8262c";c.fillRect(0,i*32,32,32);}
    const tex=new THREE.CanvasTexture(cv);
    const pole=new THREE.Mesh(new THREE.CylinderGeometry(0.14,0.14,8,10),
      new THREE.MeshLambertMaterial({map:tex}));
    pole.position.copy(gp.pos).addScaledVector(gn,HALF+0.8); pole.position.y=4;
    const board=new THREE.Mesh(new THREE.BoxGeometry(0.12,1.2,2.4),
      new THREE.MeshLambertMaterial({color:0xffffff}));
    board.position.copy(pole.position); board.position.y=6.8;
    pole.castShadow=true; board.castShadow=true;
    add(pole,board);
    /* ゴールライン(決勝線)を馬場に引く。
       PlaneGeometryのローカルX = 走路を横断する向き、ローカルY = 進行方向。
       幅と長さが逆だと、走路を横切る線ではなく進行方向へ24m伸びる線になる */
    const line=new THREE.Mesh(new THREE.PlaneGeometry(HALF*2,0.35),
      new THREE.MeshBasicMaterial({color:0xffffff}));
    line.rotation.x=-Math.PI/2;
    line.rotation.z=Math.atan2(gp.tan.x,gp.tan.z);
    line.position.copy(gp.pos); line.position.y=0.01;
    add(line);
  }

  // ---- 発走ゲート (馬房ごとの扉付き・再生開始時に扉が開く) ----
  gateDoors=[];
  {
    const sp=course.sample(0,0);
    const gate=new THREE.Group();
    gateGroup=gate;
    gate.userData.base=sp.pos.clone();
    /* 発走後にゲートを退避させる向き (走路の外側)。
       normalOf() は内側なので反転させる。回り方が変わっても外側のまま */
    gate.userData.inward=normalOf(sp.tan).negate();
    gate.position.copy(sp.pos);
    gate.rotation.y=Math.atan2(sp.tan.x,sp.tan.z); // ローカル+Z=進行方向, +X=レーン方向
    /* 実物の構成に寄せてある:
         下部の台車フレーム（Xブレース＋車輪）
         → 馬房の金網の仕切り
         → 前面の緑のトラス梁に黄色い馬番プレートが下がる
         → 端に発走委員台
       部材はすべて材質ごとに1つのジオメトリへまとめる。
       1つずつ Mesh にすると、16頭で90ドローコールを超える */
    const nHorses=cfg? cfg.n : 10;
    const laneW=GATE_LANE_W, W=nHorses*laneW;
    /* ZF は馬房の前端。1.15 だと**馬の鼻先(局所z=1.49)が閉じた扉を24cm貫通する**。
       馬体の前後は -0.88〜1.49 なので、扉より前に出ないところまで前へ出してある */
    const ZF=1.55, ZB=-1.95;            // 馬房の前端 / 後端 (局所z)
    const HP=2.05;                      // 仕切りの高さ
    /* 緑の上桟。扉の上端(1.98)との間を空けないと、扉と梁が同じ緑で
       つながって見え、トラスが消える */
    const YT=2.62;

    const green=new THREE.MeshLambertMaterial({color:0x2f5d3a});
    const steel=new THREE.MeshLambertMaterial({color:0x9aa1a8});
    const dark =new THREE.MeshLambertMaterial({color:0x53585d});
    const white=new THREE.MeshLambertMaterial({color:0xdfe3e6});
    /* 金網は両側から見えるので DoubleSide。
       UV は実寸(1マス0.30m)で渡すので texture.repeat は使わない */
    const panelMat=new THREE.MeshLambertMaterial({
      map:gateMeshTexture(), side:THREE.DoubleSide});
    const MESH_M=0.30;

    const gG=newParts(), gS=newParts(), gD=newParts(), gW=newParts(), gN=newParts();

    // ---- 馬房の仕切り (金網) ----
    for(let i=0;i<=nHorses;i++){
      const x=(i-nHorses/2)*laneW;
      pushPanelX(gN, x, 0.35, HP, ZB, ZF, (ZF-ZB)/MESH_M, (HP-0.35)/MESH_M);
      // 網の四周の枠と、前端の白い柱
      pushBar(gS, x,0.35,ZB, x,0.35,ZF, 0.05);
      pushBar(gS, x,HP,  ZB, x,HP,  ZF, 0.05);
      pushBar(gS, x,0.35,ZB, x,HP,  ZB, 0.05);
      pushBox(gW, 0.09,YT+0.06,0.09, x, (YT+0.06)/2, ZF);   // 前端の白い柱
    }

    /* ---- 前扉 (観音開き。個別に回すので1枚ずつ Mesh のまま) ----
       材質とジオメトリは全扉で使い回す。1枚ずつ作ると32個増える */
    const doorMat=new THREE.MeshLambertMaterial({map:gateDoorTexture()});
    const doorGeo=new THREE.BoxGeometry(laneW/2-0.04,1.72,0.07);
    for(let i=0;i<nHorses;i++){
      // ゲート局所+X は左回りで内側・右回りで外側。1番房を必ず最内へ置く
      const cx=course.hand*((nHorses-1)/2-i)*laneW;
      for(const s of [-1,1]){
        const hinge=new THREE.Group();
        hinge.position.set(cx+s*laneW/2, 1.12, ZF+0.10);
        const door=new THREE.Mesh(doorGeo,doorMat);
        door.position.x=-s*(laneW/4-0.02); // ヒンジから内側へ
        hinge.add(door);
        gate.add(hinge);
        gateDoors.push({hinge, dir:s});
      }
    }

    // ---- 前面の緑のトラス梁 ----
    {
      const yTop=YT, yBot=YT-0.46, x0=-W/2-0.35, x1=W/2+0.35;
      pushBar(gG, x0,yTop,ZF, x1,yTop,ZF, 0.15);      // 上弦
      pushBar(gG, x0,yBot,ZF, x1,yBot,ZF, 0.12);      // 下弦
      // 筋交い: 半房ごとに向きを交互にしたジグザグ
      const step=laneW/2;
      for(let x=x0; x<x1-1e-6; x+=step){
        const xe=Math.min(x+step,x1);
        const up=Math.round((x-x0)/step)%2===0;
        pushBar(gG, x, up?yBot:yTop, ZF, xe, up?yTop:yBot, ZF, 0.07);
      }
      // 後面は上弦だけ (実物も後ろは開いている)
      pushBar(gG, x0,yTop,ZB, x1,yTop,ZB, 0.15);
      // 前後をつなぐ梁
      for(let i=0;i<=nHorses;i++)
        pushBar(gG, (i-nHorses/2)*laneW,yTop,ZF, (i-nHorses/2)*laneW,yTop,ZB, 0.07);
    }

    // ---- 馬番プレート (アトラス1枚・1ドローコール) ----
    {
      const cols=Math.min(4,nHorses), rows=Math.ceil(nHorses/cols);
      const gP=newParts();
      for(let i=0;i<nHorses;i++){
        const cx=course.hand*((nHorses-1)/2-i)*laneW;
        const u0=(i%cols)/cols, u1=u0+1/cols;
        /* キャンバスの上下とUVの上下は逆。行は下から数える */
        const row=Math.floor(i/cols);
        const v1=1-row/rows, v0=v1-1/rows;
        pushQuad(gP, cx, YT-0.23, ZF+0.10, 0.46,0.46, u0,v0,u1,v1);
      }
      /* 数字は必ず読めてほしいので MeshBasicMaterial (陰影を受けない)。
         下の traverse も basic は影の対象から外している */
      gate.add(partsMesh(gP, new THREE.MeshBasicMaterial({
        map:gateNumberAtlas(nHorses,cols)})));
    }

    // ---- 下部の台車フレーム ----
    {
      const y=0.16, x0=-W/2-0.45, x1=W/2+0.45;
      pushBar(gD, x0,y,ZF, x1,y,ZF, 0.17);
      pushBar(gD, x0,y,ZB, x1,y,ZB, 0.17);
      for(let i=0;i<=nHorses;i++){
        const x=(i-nHorses/2)*laneW;
        pushBar(gD, x,y,ZF, x,y,ZB, 0.11);
        // 床面のXブレース。実物で最も目につく部分
        const xn=x+laneW;
        if(i<nHorses){
          pushBar(gD, x,y-0.03,ZB, xn,y-0.03,ZF, 0.06);
          pushBar(gD, x,y-0.03,ZF, xn,y-0.03,ZB, 0.06);
        }
      }
      // 車輪
      for(const sx of [x0+0.5, x1-0.5]) for(const sz of [ZF-0.3, ZB+0.3]){
        const wheel=new THREE.Mesh(new THREE.CylinderGeometry(0.20,0.20,0.11,10),dark);
        wheel.rotation.z=Math.PI/2;
        wheel.position.set(sx,0.20,sz);
        gate.add(wheel);
      }
    }

    // ---- 発走委員台 (1番房の側の端) ----
    {
      const px=course.hand*(W/2+0.95);
      pushBox(gW, 1.25,0.08,1.5, px, 1.62, (ZF+ZB)/2);     // 床
      pushBox(gW, 1.25,0.75,0.07, px, 2.02, (ZF+ZB)/2+0.72); // 手すり(前)
      pushBox(gW, 0.07,0.75,1.5,  px+0.59, 2.02, (ZF+ZB)/2); // 手すり(横)
      for(const sz of [-0.65,0.65]) for(const sx of [-0.55,0.55])
        pushBox(gW, 0.08,1.62,0.08, px+sx, 0.81, (ZF+ZB)/2+sz);  // 脚
    }

    gate.add(partsMesh(gG,green), partsMesh(gS,steel), partsMesh(gD,dark),
             partsMesh(gW,white), partsMesh(gN,panelMat));
    /* 馬番プレートだけは MeshBasicMaterial (影を受けると数字が読めなくなる)。
       仕切り・扉・梁はすべて投げて受ける */
    gate.traverse(o=>{
      if(!o.isMesh || o.material.isMeshBasicMaterial) return;
      o.castShadow=true; o.receiveShadow=true;
    });
    add(gate);
  }

  /* ---- スタンド (ホームストレート外側) ----
     東京競馬場のフジビュースタンドが下敷き。手前から順に
       前壁 → 傾斜した観客席 → 躯体(窓のある建物) → 片持ちの大屋根
     以前は「灰色の箱3段 + その後ろに浮いた平板の屋根」で、
     ホームストレートのカットでは色ノイズの帯にしか見えていなかった。

     ※スタンドの位置(外ラチから38m後方)は変えていない。
       最終直線トラッキングのカメラの飛行経路と干渉させないため */
  {
    const L=course.straight, R=course.radius;
    const standLen=L*0.9, standZ=R+HALF+38;
    /* 高さは直線長から出す。1周1000mの小回りに30mのスタンドを建てると
       オーバルに対して大きすぎるため */
    const bodyH=clamp(L/600*30, 14, 30);

    const concrete=new THREE.MeshLambertMaterial({color:0xb9bcbe});
    const trim    =new THREE.MeshLambertMaterial({color:0xe9e9e5});

    /* 【スタンドは影に参加させない】
       シャドウカメラは隊列の周り180m四方しか覆っていない (§P0)。
       一方スタンドは最長540mあるので、影を受けさせると
       「シャドウマップの端」がそのまま壁の上の巨大な明暗の境目として出る。
       実際、屋根が外壁に落とす影が中央180mだけに現れて、
       両端が唐突に明るくなっていた。

       投げる側も切ってよい。スタンドは外ラチから38m後方にあり、
       高さ31m・太陽高度42°でも影は34mしか伸びない(=外ラチに4m届かない)。
       どのカットにも入らないので失うものが無い */
    const noShadow=o=>{ o.castShadow=false; o.receiveShadow=false; return o; };

    // 前壁 (最前列の下。走路側から見たときの土台)
    const front=noShadow(new THREE.Mesh(new THREE.BoxGeometry(standLen,1.6,1.2),concrete));
    front.position.set(0,0.8,standZ);
    addDeco(front);

    /* 観客席: 1枚の傾斜面に観客テクスチャを貼る。
       段床を実際にモデリングすると頂点が増えるだけで、
       この距離では段の陰影よりテクスチャの粒のほうが効く */
    const seatD=22, seatY0=1.6, seatY1=1.6+11;   // 奥行き22m / 11m せり上がる
    {
      const hw=standLen/2;
      const A=[-hw,seatY0,standZ], B=[hw,seatY0,standZ];
      const C=[hw,seatY1,standZ+seatD], D=[-hw,seatY1,standZ+seatD];
      const g=new THREE.BufferGeometry();
      g.setAttribute("position",new THREE.Float32BufferAttribute(
        [...A,...B,...C,...D],3));
      /* 横方向は実寸 CROWD_TILE_M ごとに繰り返す。
         縦は 0..1 のまま = 傾斜面の長さ sqrt(22²+11²)=24.6m に1タイル。
         テクスチャ側の想定24mとの差2.5%は見た目に出ない */
      g.setAttribute("uv",new THREE.Float32BufferAttribute(
        [0,0, standLen/CROWD_TILE_M,0, standLen/CROWD_TILE_M,1, 0,1],2));
      // A,C,B / A,D,C の順で法線が走路側(+y,-z)を向く
      g.setIndex([0,2,1, 0,3,2]);
      g.computeVertexNormals();
      addDeco(noShadow(new THREE.Mesh(g,new THREE.MeshLambertMaterial({
        map:crowdTexture()}))));
    }

    // 躯体: 連窓の並んだ建物。観客席の後ろから立ち上がる
    {
      const body=noShadow(new THREE.Mesh(new THREE.BoxGeometry(standLen,bodyH,18),
        new THREE.MeshLambertMaterial({map:facadeTexture(standLen,bodyH)})));
      body.position.set(0,bodyH/2,standZ+seatD+9);
      addDeco(body);
    }

    /* 大屋根: 躯体から観客席の上へ片持ちで張り出す。
       以前は後ろに立てた9本の細い円柱の上に平板が乗っているだけで、
       屋根が観客席を覆っていなかった */
    {
      /* 張り出しは観客席の奥半分だけ。全部覆うと最前列まで日陰に入り、
         せっかくの観客の色が沈む (実際のスタンドも前方は露天のことが多い) */
      const overhang=seatD*0.55;
      const roofY=bodyH+1.0, roofZ=standZ+seatD-overhang/2;
      const slab=noShadow(new THREE.Mesh(
        new THREE.BoxGeometry(standLen+8,0.9,overhang),trim));
      slab.position.set(0,roofY,roofZ);
      addDeco(slab);
      // 先端の垂れ壁。これが無いと屋根が「浮いた板」に見える
      const fascia=noShadow(new THREE.Mesh(
        new THREE.BoxGeometry(standLen+8,2.2,1.0),trim));
      fascia.position.set(0,roofY-1.2,roofZ-overhang/2+0.5);
      addDeco(fascia);
    }
  }

  /* ---- ターフビジョン (内馬場・スタンドに向けて立てる) ----
     実際の東京競馬場と同じく内馬場側に置く。ホームストレートのカットで
     必ず背景に入るので、これがあるかないかで競馬場らしさが大きく変わる */
  {
    const L=course.straight, R=course.radius;
    const screenW=clamp(L*0.09, 18, 52), screenH=screenW/4.2;
    const baseY=6, z=R-HALF-25;         // 内ラチから25m内側
    const steel=new THREE.MeshLambertMaterial({color:0x4a4f55});
    /* 画面はスタンド側(deco局所の +z)を向く。骨組みはその裏側 = -z 側に置く。
       +z 側に置くと骨組みが画面の手前に来て、スタンドからは黒い板しか見えない。

       【骨組みの前面は画面と絶対に同一平面にしないこと】
       最初 frame を z-0.6・厚み1.2 で置いたため、前面がちょうど z = 画面 になり、
       Zファイティングで画面の遠い側が黒いブロックだらけになった
       (近い側は無事なので、テクスチャやミップマップの不具合に見えて紛らわしい)。
       FRAME_GAP のぶん必ず引っ込めておく */
    const FRAME_GAP=0.3;
    const frameD=1.2;
    for(const s of [-1,1]){             // 支柱
      const leg=new THREE.Mesh(new THREE.BoxGeometry(1.1,baseY,1.1),steel);
      leg.position.set(s*screenW*0.36, baseY/2, z-FRAME_GAP-0.55);
      leg.castShadow=true; leg.receiveShadow=true;
      addDeco(leg);
    }
    const frame=new THREE.Mesh(
      new THREE.BoxGeometry(screenW+1.4,screenH+1.4,frameD),steel);
    frame.position.set(0, baseY+screenH/2, z-FRAME_GAP-frameD/2);
    frame.castShadow=true;
    addDeco(frame);
    /* 画面は MeshBasicMaterial。自発光する面なので、周りの陰影を受けると
       曇った灰色の板になってしまう */
    const scr=new THREE.Mesh(new THREE.PlaneGeometry(screenW,screenH),
      new THREE.MeshBasicMaterial({map:turfVisionTexture()}));
    scr.position.set(0, baseY+screenH/2, z);
    addDeco(scr);
  }

  // ---- 木々 (向正面の外側と遠景に散らす) ----
  {
    const trunkMat=new THREE.MeshLambertMaterial({color:0x6b4a2f});
    const leafMats=[0x2f6b33,0x39793a,0x2a5f30].map(c=>new THREE.MeshLambertMaterial({color:c}));
    const L=course.straight, R=course.radius;
    for(let k=0;k<26;k++){
      const along=(rngC()-0.5)*L*1.4;
      const away=R+HALF+8+rngC()*30;
      const x=along, z=-away; // 向正面側
      const h=3+rngC()*3;
      const trunk=new THREE.Mesh(new THREE.CylinderGeometry(0.18,0.26,h*0.45),trunkMat);
      trunk.position.set(x,h*0.22,z);
      const crown=new THREE.Mesh(new THREE.SphereGeometry(h*0.42,7,6),
        leafMats[(rngC()*3)|0]);
      crown.position.set(x,h*0.62,z);
      crown.scale.y=1.25;
      trunk.castShadow=true; crown.castShadow=true;
      addDeco(trunk,crown);
    }
  }
}

/* ---------- 状態と再生制御 (フレーム番号駆動) ---------- */
let frame=0, playing=false, totalFrames=0;
let raceFrames=0, resultsStartFrame=0;
let gateFrames=0, gateDoors=[], gateGroup=null;
let timeWarp=null;
/* 脚を回すための時計[秒]。実時間ではなく「レース時刻」で測る (GLBHorse の説明を参照)。
   renderFrame が毎フレーム引き直す。積算しないので決定論は保たれる */
let raceClockSec=0;

/* フレーム番号 → レース時刻t (スロー区間で進みが遅くなる単調写像) */
function raceTOfFrame(f){
  if(!timeWarp) return f/raceFrames;
  const {tA,tB,k,Rn,fA,fB}=timeWarp;
  if(f<fA)  return f/Rn;
  if(f<fB)  return tA + (f-fA)/(k*Rn);
  return tB + (f-fB)/Rn;
}
/* レース時刻t → フレーム番号 (逆写像) */
function frameOfRaceT(t){
  if(!timeWarp) return t*raceFrames;
  const {tA,tB,k,Rn,fA,fB}=timeWarp;
  if(t<tA) return t*Rn;
  if(t<tB) return fA + (t-tA)*k*Rn;
  return fB + (t-tB)*Rn;
}

/* ---------- 結果発表オーバーレイ ----------
   WebGL内の全画面板に描く (HTMLオーバーレイだと動画書き出しに映らないため) */
const ovScene=new THREE.Scene();
const ovCam=new THREE.OrthographicCamera(-1,1,1,-1,0,10);
let ovPlane=null, ovTexAspect=1;

function buildResultsBoard(){
  // 着順順に並べ替え
  /* 着差: plan.marginNames[k] = (k+2)着が (k+1)着 から離された差。
     1着は前がいないので表示しない (競馬の成績表と同じ書式) */
  const margins = (plan && plan.marginNames) ? plan.marginNames : [];
  const rows=[...Array(cfg.n).keys()]
    .map(i=>({name:cfg.names[i], rank:cfg.order[i], color:cfg.colors[i],
              gate: cfg.gates[i],
              margin: cfg.order[i]>=2 ? (margins[cfg.order[i]-2]||"") : ""}))
    .sort((a,b)=>a.rank-b.rank);
  /* 13頭以上は行を詰めて横に広げる。板は画面高さ基準で拡縮されるので、
     縦に伸ばすとそのぶん細長くなって文字が小さくなるため */
  const big = rows.length>12;
  const topH=big?106:118, rowH=big?54:64, pad=40, headH=110;
  /* 掲示板の内容は競馬風(2D)と同じ「結果発表設定」で決まる。
     消した項目のぶんは馬名の描画幅に回して、余白が空いたままにならないようにする */
  const board=cfg.board||{};
  const showColor=board.color!==false, showMargin=board.margin!==false;
  const MARGIN_COL=showMargin?160:0;   // 右端に確保する着差カラムの幅(px)
  const NAME_X=showColor?274:220;      // 勝負服色ドットを消したぶん馬名を左へ寄せる
  const W=big?940:820, H=headH + Math.min(3,rows.length)*topH + Math.max(0,rows.length-3)*rowH + pad*2;
  const cv=document.createElement("canvas"); cv.width=W; cv.height=H;
  const c=cv.getContext("2d");
  // 背景パネル
  c.fillStyle="rgba(8,13,10,0.88)";
  c.beginPath(); c.roundRect(0,0,W,H,26); c.fill();
  c.strokeStyle="#e3b34c"; c.lineWidth=5;
  c.beginPath(); c.roundRect(6,6,W-12,H-12,22); c.stroke();
  // タイトル (長い文字列でも枠からはみ出さないよう最大幅を渡す)
  c.fillStyle="#e3b34c";
  c.font="bold 56px 'Hiragino Kaku Gothic ProN', sans-serif";
  c.textAlign="center";
  c.fillText(board.title||"結果発表", W/2, 76, W-200);
  c.textAlign="left";
  // 着差カラムの見出し (JRA式は数字だけになるため単位の手掛かりを残す)
  if(showMargin){
    c.textAlign="right";
    c.fillStyle="rgba(160,178,168,0.7)";
    c.font="bold 22px 'Hiragino Kaku Gothic ProN', sans-serif";
    c.fillText("着差", W-52, 84);
    c.textAlign="left";
  }
  const medal={1:"#e8c24a",2:"#c9ced4",3:"#c78a4e"};
  let y=headH+pad*0.4;
  for(const r of rows){
    const isTop=r.rank<=3;
    const rh=isTop?topH:rowH;
    const cy=y+rh/2;
    // 着順バッジ
    c.fillStyle=isTop?medal[r.rank]:"#3a4a42";
    c.beginPath(); c.arc(86, cy, isTop?40:24, 0, Math.PI*2); c.fill();
    c.fillStyle=isTop?"#1a1408":"#cfd8d2";
    c.font=`bold ${isTop?46:26}px sans-serif`;
    c.textAlign="center";
    c.fillText(r.rank, 86, cy+(isTop?16:9));
    c.textAlign="left";
    // 馬番プレート (ゲートの番号と対応)
    const pw=isTop?52:38, ph=isTop?46:32;
    c.fillStyle="#f2c530";
    c.beginPath(); c.roundRect(158-pw/2, cy-ph/2, pw, ph, 6); c.fill();
    c.fillStyle="#111"; c.font=`bold ${isTop?34:24}px sans-serif`;
    c.textAlign="center"; c.fillText(r.gate, 158, cy+(isTop?12:8));
    c.textAlign="left";
    // 勝負服色ドット
    if(showColor){
      c.fillStyle="#"+r.color.toString(16).padStart(6,"0");
      c.beginPath(); c.arc(220, cy, isTop?26:16, 0, Math.PI*2); c.fill();
      c.strokeStyle="rgba(255,255,255,0.5)"; c.lineWidth=2; c.stroke();
    }
    // 馬名 (右の着差カラム分だけ描画幅を詰める)
    c.fillStyle=isTop?medal[r.rank]:"#e8efe9";
    c.font=`bold ${isTop?58:34}px 'Hiragino Kaku Gothic ProN', sans-serif`;
    c.fillText(r.name, NAME_X, cy+(isTop?20:12), W-NAME_X-36-MARGIN_COL);
    // 着差 (右端・等幅寄りに右揃え)
    if(showMargin&&r.margin){
      c.textAlign="right";
      c.fillStyle=isTop?"rgba(227,179,76,0.95)":"rgba(160,178,168,0.9)";
      c.font=`bold ${isTop?36:26}px 'Hiragino Kaku Gothic ProN', sans-serif`;
      c.fillText(r.margin, W-52, cy+(isTop?13:9));
      c.textAlign="left";
    }
    // 区切り線
    c.strokeStyle="rgba(255,255,255,0.08)"; c.lineWidth=1;
    c.beginPath(); c.moveTo(40,y+rh); c.lineTo(W-40,y+rh); c.stroke();
    y+=rh;
  }
  const tex=new THREE.CanvasTexture(cv);
  ovTexAspect=W/H;
  if(ovPlane){ ovPlane.material.map.dispose(); ovPlane.material.map=tex; }
  else{
    ovPlane=new THREE.Mesh(new THREE.PlaneGeometry(1,1),
      new THREE.MeshBasicMaterial({map:tex,transparent:true,opacity:0,depthTest:false}));
    ovScene.add(ovPlane);
  }
  ovPlane.material.needsUpdate=true;
}

/* ---------- 透かし (ロゴ + 名前) ----------
   書き出し動画に焼き込む必要があるので、HTMLではなくWebGLのオーバーレイに置く。
   ロゴは data URI で埋め込む。別オリジンから読むとキャンバスが汚染され、
   フレームを取り出す toBlob / toDataURL が例外を投げるため。

   置き場所は上端。下側は俯瞰図(左下)と隊列パネル(下中央)でほぼ埋まっていて、
   16:9 では右下に幅0.26NDC(画面の13%)しか空かない。上端は3つの画面比率すべてで空いている。

   動きは frame の関数だけで決める。実時間で動かすと「同じフレーム=同じ絵」が壊れ、
   書き出しとプレビューが一致しなくなる */
const MARK_TEXT="GraphRace Studio";
const MARK_LOGO="data:image/webp;base64,UklGRtoKAABXRUJQVlA4WAoAAAAQAAAAXwAAXwAAQUxQSJQEAAABGTNt28babZ8X0f/Q46mGGm3bxvYmtW3btm3btm3btm3btm3bthu8+e55nvs85a8VJ9/o6VPjjhPrjfV+cdqICZiAUvnhvQfd86I0s68lpTu7mNlXckwxQE1gOab2uQ+85QVPe8jj3lEhCSMbB95WeMU9Ltct7x0Zfu+o6Yx65JmqZ/RjIRuaRt6rRE5naUNKOfLTmkT3POpOEqDDuPL+JDUMrWcpB30Ivmhi+NIXPAnJ4WWN/OhOgrhPBS96kqS33c4He8IDDAzMwRSwHFMwDYTeDaRvkXCXx3iQracEDMAAxdQQK/rLAEYzszkNLwJO0ig+GuGr9m8RfwxH9rjzeOD1YHa1NBH7e1eqkP/DRD8fI13QgojNfSxd0KGopOFFUobeTE7ysmaWMhSPS2AreEPa5NfVEzd2cqm0YU6zEVxiGwnpTp8CBmoKX/uQOfVtb+r2iAVkyRjCRfpWPtCPzOF5TnqA4bm9a3afSEYvRtI7iv5Mr3C2f8bn1odmb0kGFXAsmBudWrv1pGd/JSTOZjVKnOjVp1LABIUQ3EKWPENYkuFeIHVr4J7VT5/Wgv8KaWBuoZbgff8lRN2EVccjeFFJQuIszgSPC0nRyMLyEN6CtJ3UQASfu1NSNLKa20L4CEuKRRU2h/RC+NuTPoEaKOgH/jVz0qJ0MVUk//m0sF1ZjgJhdecRFB0WNzWkVwoe9WdIOP5OtDU3szmk2UHw2HC1SPLF25kO4n+741Oshg6keClz+gXx5+qQXHODCVQdHFEeKSSI0lw00J/BEeUjTkV6lkaU9TeE3+ZkmCTav7vjWayGRrGHQIJNYER6oJeQngom28dzSLq5EMG/W/kKyVbcDfFTNqIk3AQY5lThOK1IWcPtSnsJpKK64PKhKxzOSOWQ85p7Xe46Acgvrlnz0nzQiXU2UJTM3vfvlyQqecsZXtCp0mNelwE9msbGZlZ9Eg/zYktdKPolY3ubRHyfRWXk6gBmUa+xwgXmV/CgtAKOBWLPQMNvE5nNDKpQ3mUczwMyl7iN3k1tYIMb2Ri69auUohtM5iUelBaDgjqBbmkKSI+ysiy+mM3FjI+s71q9kXxhLpfxykwmvsMBWkp4wFTeE5u5iC0C21WLUUjY0dbMJxWoQBV4xybOkpf8Na3Wcfle9wyLknCNWX3Oo9I8+Nr/LQYiYQ0H8whKi0NzeMrO9iF6zSSKffLxMDebnISGnSt4pB58ouWVeiXJ5neeWNTFkGsU1K68DgmVpvQ2TzSCaG0nLUYgYS8bsRjMRWxgkfCGRZxCJZ+aQe0YNAbFXbUo8meZh4QWFdskIc5R3aR/EuruKTpnk5hAnehaR/S24lpRqZOqAMyJ7jn14RoTkXCuhXwpIoITYnVS3KdziZoSFnOqqLrjAqiTYk5SPdTKRE8rLonIXMwwJ1B1MjcGV3sYEtqto7RIrIBhGKgWvkbBMrDyhAzLMjNAIWSZgA7Hymfl0xyl0RyuEs1WBmZkOehnPkTHqVXAckzzj+NVs+qBmSmohuwlkjChnlTAQEFR0EovelIkPAr3190I559uw48TAVZQOCAgBgAAECAAnQEqYABgAD5RIo5Eo6IhFAqu9DgFBLYAZsDw/27pNpp9681mqv3L8VfkB0lR1+rb+X+WPtr/uXse8wT9KOlJ5gP0//6X9393f+4epX0AP5T/iOsH/r3+L9gf+Nf7L0r/2y+En9tf2i9lr/yZrd9AFMROcT9pw6qnmjeQD6k9Sb+qdYz0Hv2Ico5EmQLpqMyayILA7OcKMfP7vE7YXfJYyesvunm3vup7Ekqo6QUj6eXH/Ab4GzW30EiXTnB3dID5MsOBD2pd6zjaDRI9u/F+HsaAfrB/dG6rfVdu1TiEfeQDqizgn5BwfPz/rU5fmxb+9vBMGuv4uBbOKMvCu3ERX2pFu3DPIAD+/u6vTSpL+7lQLOn/0s225xwmIZzkge2s2/m4JbJGFyG315bX+BPa3Bftxe3Ls9kZFAudb0P9Tdfzzs9c9M8nT8qH+9UZnNCkj5px/FQlnHTnke81JMXGhH+ECvaAjDPpMlK83ufstFVYjooZ0jI9ytTbBhpn+s6HWdJWwd/3uc8nV5lJrUfHNOztD3t/OypbYZRGtEjzwDMePgVarJJDMCuUnLfRwSLx2BT3UBSQl1X54PuW1f6XhIj/KTEds+BhrlfMOdYQhBZhwX5cANATqaq4i/S/+lwcvr2h83Bf5tS9fp7k7I+72jF3ANiZ5HzsvkcOCf7T6AwXvlFI56Vj+9MgtFJkRCpzX8KKZrEn2Vs77Igfrcxw5RNjUmn6ngYBj33sBkF0kiLuCaGcYFJe9g1juCmS8V8LZrCSt6oa8MCXwzQ4ND88wPotK/+XfuuuJ3yGALM6lNj1c5v3/iUVABfmyRrtL2cj6GR3/3cMN8CKuPzI6dqeyba7zgy0WMp4Ez2qXWhPVqMXA2JW7e7PBILFkyIIY34juHUc+p9vn1Z7mCrZ/7HYFz2AwdkOsA35qPGDw1GMVPHOvWCoXTEivPfZV7lpoM0HhK0Y0CvBZZ4vZMPUeC3UWOff8/QL3yvcfGlIHFVB7ZNsD8CVx7Xjs8av7p+kH6ZBcMJx+oifUNBNQ1iPaxly0XuyrK079gWhoVRlHH0J382zVwhwdePUdQnag3R7cIcL6uVdbfIlCqdcP5XcTt6BNGAQhwphnLfhdBVFVTxErgLYqXGJV1sJOI/OOatrTp7xfsNX8ANuqZ051GciQTb/qn9rDfaDlxE4lZr/O0k6iA0UwYyjjLzai8X0LcfneNc5fEqBRQMRbk/a5NtaC/4nishgH52aYYEIthrJUwm0U/vstFIold/fe+d4tnBUSaBmNwJ1jRX3ZxzH58dPL5r8+1OFYBTXcu4Hpmlv5SOsgoPGTlYwL02dd83a1pY6saUU7u3mMPi1qlo9Y5HCeYhDqJ2RLbuzRAp7LH7i7gdM12iMfWAWFvaKRmChjV9B3wM4kHZJGW3WIsI0AgcyTmixxNX/N0wJW4S3/wbv/+bX//zX9//5p+n7+X9jW/1PHSRErLDgco3Z1t9GXsX2/Mxu++f+g6v+/9RrXAiAkG1uE3gw4YBZ+Cz9HiArDrxKLFtxup8JsrRdwDoUgJIn6RuUY3aPjd9xhiXYXHm0jJ0sCE+mrypgL+h7h/HZ7FJJGFRitjxT/ZNBjJ2hUtzUQxa1R0gvWrQaddeW9n/uDHX931ihzCA9x/xZ+0DNm5mP9HvX+32OxQH0hpBMkYCOlpCiloqjSYx/CLyN6uCTuI93KwLmsuT8yzlNL6/8aASbCu8YS0XD9keZPmUgkfDbhN/X1RhOvJhPzg/fBv/o9rl6/mq4LskIRkr5oOWUk51SL8AN0knOHSzUfphWiW5fFLb7NsGccRVRgP9EoSWsK6GDGOgER6S9sZJ8GOGFfs6o0RgddhBkRIwHSoLDkw2/rAG3HTj6i5p49a+rgAUBI7ekLAYltn8mgeeDEPQTMdjUKh8McXvi+2SEN6PI7Ns0RSdBMLEyVaVIwS5BndLO9kpm7B9PU0J9a6DBVX7AyATojRecdn17otXTh5YIRXdgJjvY+fL8LoU5vT+rOenV0SaR9e7cv+A9/p6dvYwXWXrMq2YBSzddSbiPYn8hj0JeILBccE9zM8TpqbrGmT6WAAA=";
/* 濃さと大きさ。最初 0.20 / 0.07 で入れたが、実寸では読めなかった。
   効いていたのは濃さより大きさで、画面幅の11%に16文字は小さすぎた。
   MARK_H は画面高さに対する比 (NDCの全高=2なので 0.21 は高さの10.5%)。
   縦長・正方形では下の wMax が先に効くので、MARK_H だけ上げても
   大きくならない。両方を一緒に動かすこと */
const MARK_OPACITY=0.32;
const MARK_H=0.21;
/* 縁を回る速さ [NDC/秒]。画面の幅は NDC で 2 なので、0.10 なら横断に約16秒。
   尺で割らず絶対速度にしてあるので、動画が長ければそのぶん周回数が増える */
const MARK_SPEED=0.10;
/* 上辺を通る高さ。画面の上端ではなく、経過時間とショット名の表示より下を通す。
   板の上端が y=0.80 (画面上部から10%) に来る。

   ここを HTML の実測から決めてはいけない。#hud / #shotLabel は px 指定なので、
   プレビューの大きさで画面に占める割合が変わる。実測に追従させると
   「同じフレーム = 同じ絵」がウィンドウの大きさに依存して壊れ、
   プレビューと書き出しで透かしの位置がずれる。

   固定値なので、避けられるかどうかはプレビューの大きさ次第。
   #hud は上端16px + 高さ約34px = 50px を占めるので、
   キャンバス高が 500px 以上なら重ならない (1-2*50/500 = 0.80)。
   書き出し動画には #hud 自体が映らないので、そちらでは常に問題ない */
const MARK_TOP_Y=0.72;
let markPlane=null, markAspect=1;

function buildWatermark(img){
  const H=128, LOGO=96, GAP=20, PAD=10, TEXT_Y=H/2+2;
  const FONT="bold 62px 'Hiragino Kaku Gothic ProN', sans-serif";
  // 幅は文字を測ってから決める (canvas.width を変えると状態が消えるので別物で測る)
  const meas=document.createElement("canvas").getContext("2d");
  meas.font=FONT;
  const tw=Math.ceil(meas.measureText(MARK_TEXT).width);
  const tx=PAD+(img?LOGO+GAP:0);
  const cv=document.createElement("canvas");
  cv.width=tx+tw+PAD; cv.height=H;
  const c=cv.getContext("2d");
  /* 空の水色にも芝の緑にも乗るよう、暗い影を敷いてから白を置く。
     不透明度を上げずに読ませるための措置 */
  c.shadowColor="rgba(0,0,0,0.55)"; c.shadowBlur=8; c.shadowOffsetY=2;
  if(img) c.drawImage(img, PAD, (H-LOGO)/2, LOGO, LOGO);
  c.font=FONT; c.textBaseline="middle";
  c.lineWidth=7; c.strokeStyle="rgba(0,0,0,0.5)";
  c.strokeText(MARK_TEXT, tx, TEXT_Y);
  c.shadowBlur=0; c.shadowOffsetY=0;
  c.fillStyle="#ffffff";
  c.fillText(MARK_TEXT, tx, TEXT_Y);

  markAspect=cv.width/cv.height;
  const t=new THREE.CanvasTexture(cv);
  /* 画面とほぼ1:1で貼る板なのでミップマップは要らない。
     作ると縮小時に段が混ざって滲む (ターフビジョンで踏んだのと同じ轍) */
  t.generateMipmaps=false;
  t.minFilter=THREE.LinearFilter; t.magFilter=THREE.LinearFilter;
  markPlane=new THREE.Mesh(new THREE.PlaneGeometry(1,1),
    new THREE.MeshBasicMaterial({map:t, transparent:true,
      opacity:MARK_OPACITY, depthTest:false}));
  ovScene.add(markPlane);
}
/* ロゴが読めなくても名前だけで透かしは出す (透かしが消えるほうが困る) */
function loadWatermark(){
  // dispose() 後の再 init() で板が二重に積まれないようにする
  if(markPlane) return Promise.resolve();
  return new Promise(res=>{
    const img=new Image();
    img.onload =()=>{ buildWatermark(img); res(); };
    img.onerror=()=>{ console.warn("[watermark] ロゴを読めなかった。文字だけで続行");
                      buildWatermark(null); res(); };
    img.src=MARK_LOGO;
  });
}

/* ---------- コース俯瞰図 (左下ミニマップ) ----------
   中継のコースマップと同じ役割。オーバルの形・スタート位置・
   走ってきた軌跡・現在地を、走路の実寸から起こして描く。

   平面のままだと図面に見えるので、少し傾けて厚みを付けている:
     ・水平回転(MAP_ROT)と縦の圧縮(MAP_TILT)で斜め見下ろしにする
     ・輪郭を下へずらして塗り、コースの厚み(側面)を出す
   走路の幅は実寸(24m)のままだと縮尺1/2で線にしか見えないので誇張する。
   倍率ではなく描画幅[px]で決めるため、コースを変えても太さは一定になる
   (実寸のまま倍率をかけると、小さいコースだけ極端に太くなってしまう)。

   結果発表と同じくWebGL内の板に描くので、書き出し動画にも焼き込まれる */
let mapPlane=null, mapCanvas=null, mapTex=null, mapGeom=null, mapAspect=1;
const MAP_W=460, MAP_H=210, MAP_PAD=16;
const MAP_TILT=0.56;    // 縦の圧縮 (1=真上、小さいほど寝かせる)
const MAP_ROT=-0.22;    // 水平回転[rad]
const MAP_DEPTH=10;     // コースの厚み[px]
const MAP_TRACK_PX=30;  // 走路の描画幅[px] (実寸ではなく見た目で決める)
const MAP_RIM=1.7;      // 走路の外側に付ける芝の縁(走路半幅の倍率)

/* コース形状をキャンバス座標へ変換する。
   1周ぶんを内ラチ・外ラチ・外縁の3本サンプリングして外接矩形に収める */
function buildMiniMapGeom(){
  const N=360;
  const cosR=Math.cos(MAP_ROT), sinR=Math.sin(MAP_ROT);
  // 水平回転 → 縦を圧縮 = 斜め見下ろし
  const proj=(x,z)=>[x*cosR-z*sinR, (x*sinR+z*cosR)*MAP_TILT];
  const raw=(d,off)=>{
    const {pos,tan}=course.point(d);
    const o=off*course.hand;
    return proj(pos.x+tan.z*o, pos.z-tan.x*o);       // +off が内側
  };
  const usableW=MAP_W-MAP_PAD*2, usableH=MAP_H-MAP_PAD*2-MAP_DEPTH;
  const box=(pts)=>{ let x0=1e9,x1=-1e9,y0=1e9,y1=-1e9;
    for(const [x,y] of pts){ if(x<x0)x0=x; if(x>x1)x1=x; if(y<y0)y0=y; if(y>y1)y1=y; }
    return [x0,x1,y0,y1]; };

  // 1) まず中心線で仮の縮尺を出し、走路の描画幅[px]から誇張幅[m]を決める
  const mid=[];
  for(let k=0;k<=N;k++) mid.push(raw(course.total*k/N, 0));
  let [ax0,ax1,ay0,ay1]=box(mid);
  const sc0=Math.min(usableW/(ax1-ax0), usableH/(ay1-ay0));
  const hw=Math.max(TRACK_HALF, MAP_TRACK_PX/2/sc0);
  const rim=hw*MAP_RIM;

  // 2) 外縁まで含めて確定させる
  const inner=[], outer=[], edge=[];
  for(let k=0;k<=N;k++){
    const d=course.total*k/N;
    inner.push(raw(d, hw)); outer.push(raw(d,-hw)); edge.push(raw(d,-rim));
  }
  const [x0,x1,y0,y1]=box(edge);
  const sc=Math.min(usableW/(x1-x0), usableH/(y1-y0));
  const ox=(MAP_W-(x1-x0)*sc)/2-x0*sc;
  const oy=(MAP_H-MAP_DEPTH-(y1-y0)*sc)/2-y0*sc;
  const fit=([x,y])=>[x*sc+ox, y*sc+oy];
  mapGeom={ inner:inner.map(fit), outer:outer.map(fit), edge:edge.map(fit),
            at:(d,off=0)=>fit(raw(d,off||0)), hw };
}

function drawMiniMap(leadP){
  if(!mapCanvas){
    mapCanvas=document.createElement("canvas");
    mapCanvas.width=MAP_W; mapCanvas.height=MAP_H;
    mapAspect=MAP_W/MAP_H;
  }
  const c=mapCanvas.getContext("2d");
  c.clearRect(0,0,MAP_W,MAP_H);
  const path=(pts,dy=0)=>{ c.beginPath();
    for(let k=0;k<pts.length;k++){ const [x,y]=pts[k];
      k?c.lineTo(x,y+dy):c.moveTo(x,y+dy); }
    c.closePath(); };

  /* 厚み(側面): 外縁をそのまま下へずらして塗り、上に本体を重ねる。
     はみ出した下側だけが側面として残る */
  path(mapGeom.edge, MAP_DEPTH); c.fillStyle="#1d3320"; c.fill();

  // 走路の外側の芝 → 走路 → 内側の馬場内 の順に重ねてリングを作る
  path(mapGeom.edge);  c.fillStyle="#3c6b3f"; c.fill();
  path(mapGeom.outer); c.fillStyle="#cdbf92"; c.fill();   // 芝コースの張り替え色
  path(mapGeom.inner); c.fillStyle="#4d7f4a"; c.fill();

  c.lineJoin="round";
  path(mapGeom.edge);  c.strokeStyle="rgba(0,0,0,0.35)";      c.lineWidth=1.5; c.stroke();
  path(mapGeom.outer); c.strokeStyle="rgba(255,255,255,0.6)"; c.lineWidth=1.4; c.stroke();
  path(mapGeom.inner); c.stroke();

  /* 走った軌跡: スタート地点から現在地まで、走路の中心線を赤でなぞる。
     1周を超えるコースでは2周目も同じ線の上に重なる (中継と同じ表現) */
  const dS=course.dStart, run=Math.max(0,Math.min(1,leadP))*course.raceLen;
  const STEPS=Math.max(2, Math.round(run/6));
  c.beginPath();
  for(let k=0;k<=STEPS;k++){
    const [x,y]=mapGeom.at(dS+run*k/STEPS);
    k?c.lineTo(x,y):c.moveTo(x,y);
  }
  c.strokeStyle="rgba(0,0,0,0.3)"; c.lineWidth=5; c.lineCap="round"; c.stroke();
  c.strokeStyle="#e2483c"; c.lineWidth=3; c.stroke();

  /* スタート地点(赤)とゴール板(白)。走路を横断する短い線で示す */
  const tick=(d,col)=>{
    const a=mapGeom.at(d, mapGeom.hw*0.92), b=mapGeom.at(d,-mapGeom.hw*0.92);
    c.beginPath(); c.moveTo(a[0],a[1]); c.lineTo(b[0],b[1]);
    c.strokeStyle=col; c.lineWidth=3; c.lineCap="round"; c.stroke();
  };
  tick(course.dGoal, "#ffffff");
  tick(dS, "#e2483c");

  // 現在地 (白丸)
  const [cx,cy]=mapGeom.at(dS+run);
  c.beginPath(); c.arc(cx,cy,6.5,0,Math.PI*2);
  c.fillStyle="#ffffff"; c.fill();
  c.strokeStyle="rgba(0,0,0,0.5)"; c.lineWidth=2; c.stroke();

  if(!mapTex){
    mapTex=new THREE.CanvasTexture(mapCanvas);
    mapPlane=new THREE.Mesh(new THREE.PlaneGeometry(1,1),
      new THREE.MeshBasicMaterial({map:mapTex,transparent:true,depthTest:false}));
    ovScene.add(mapPlane);
  }
  mapTex.needsUpdate=true;
}

/* ---------- 隊列パネル (中央下) ----------
   中継の「真上から見た馬の位置関係」。
   横軸 = 先頭からの遅れ[m]、縦軸 = 走路上の横位置(内ラチが上)。
   3Dの状態(進行度とレーン)をそのまま2Dに落としているので、
   画面の馬の動きとリアルタイムに一致する。

   見た目は中継のパネルに寄せている:
     ・枠色の丸 + 馬番、白フチ
     ・右側に進行方向を示す小さな三角
     ・右端にシェブロン、枠線や余計なラベルは置かない */
let fieldPlane=null, fieldCanvas=null, fieldTex=null, fieldAspect=1;

/* 分割画面の境界線。上下の画をはっきり分けるための細い黒帯。
   オーバーレイ(正射影・NDC)に置くので、書き出し動画にもそのまま乗る */
let splitLine=null;
const SPLIT_Y=0.75;          // 下段の高さ比 (ビューポート分割と同じ値)
const SPLIT_LINE_PX=3;       // 線の太さ[px]
function showSplitLine(H){
  if(!splitLine){
    splitLine=new THREE.Mesh(new THREE.PlaneGeometry(1,1),
      new THREE.MeshBasicMaterial({color:0x000000, transparent:true, depthTest:false}));
    ovScene.add(splitLine);
  }
  const hN=(SPLIT_LINE_PX/H)*2;              // px → NDC(全高=2)
  splitLine.scale.set(2, hN, 1);             // 横は画面いっぱい
  splitLine.position.set(0, -1+SPLIT_Y*2, 0);
  splitLine.material.opacity=1;
  splitLine.visible=true;
}
/* ---------- スタートのカウントダウン (3→2→1) ----------
   ゲート待機の残り秒を画面中央に出す。オーバーレイに置くので
   分割画面でも結果発表でも位置がぶれず、書き出し動画にも乗る */
let cdPlane=null, cdCanvas=null, cdTex=null, cdShown=null;
const CD_PX=420;
function showCountdown(n, frac){
  if(!cdCanvas){
    cdCanvas=document.createElement("canvas");
    cdCanvas.width=CD_PX; cdCanvas.height=CD_PX;
  }
  if(cdShown!==n){                      // 数字が変わった時だけ描き直す
    const c=cdCanvas.getContext("2d");
    c.clearRect(0,0,CD_PX,CD_PX);
    c.font=`bold ${CD_PX*0.72}px sans-serif`;
    c.textAlign="center"; c.textBaseline="middle";
    c.lineWidth=CD_PX*0.055; c.strokeStyle="rgba(8,11,10,0.85)";
    c.strokeText(n, CD_PX/2, CD_PX/2+CD_PX*0.02);
    c.fillStyle="#ffffff";
    c.fillText(n, CD_PX/2, CD_PX/2+CD_PX*0.02);
    cdShown=n;
    if(cdTex) cdTex.needsUpdate=true;
  }
  if(!cdTex){
    cdTex=new THREE.CanvasTexture(cdCanvas);
    cdPlane=new THREE.Mesh(new THREE.PlaneGeometry(1,1),
      new THREE.MeshBasicMaterial({map:cdTex,transparent:true,depthTest:false}));
    ovScene.add(cdPlane);
  }
  /* 1秒ごとに大きく出て少し縮む。最後の2割で消えていく */
  const a=currentAspect();
  const hN=0.62*(1.18-0.18*Math.min(1,frac*3));
  cdPlane.scale.set(hN/a, hN, 1);
  cdPlane.position.set(0,0,0);
  cdPlane.material.opacity=frac>0.8 ? (1-frac)/0.2 : 1;
  cdPlane.visible=true;
}

/* マーカーを大きく取るぶん、キャンバスも縦に広げてある。
   将来マーカーを画像に差し替えられるよう、位置と大きさの計算は
   MARKER_R だけを見ればよい形にしてある */
const FLD_W=1500, FLD_H=210, FLD_PADX=70, FLD_PADY=44;
const MARKER_R=30;

/* 中継のパネルは馬個別の勝負服ではなく枠色を使う。
   false にすると出走馬リストで選んだ色になる */
const FIELD_USE_WAKU=true;

/* JRAの枠色。1白 2黒 3赤 4青 5黄 6緑 7橙 8桃 */
const WAKU=[
  {bg:"#ffffff", fg:"#111111"}, {bg:"#1a1a1a", fg:"#ffffff"},
  {bg:"#e2483c", fg:"#ffffff"}, {bg:"#2f6fd0", fg:"#ffffff"},
  {bg:"#f5d327", fg:"#111111"}, {bg:"#3f9e57", fg:"#ffffff"},
  {bg:"#ef8a2b", fg:"#ffffff"}, {bg:"#f3a7bd", fg:"#111111"},
];
/* 馬番 → 枠番。頭数を8枠に割り振る (余りは外枠から2頭ずつ入る)。
   例: 13頭なら 1,2,3 が単独、4-5/6-7/8-9/10-11/12-13 が2頭ずつ */
function wakuOf(gateNo, n){
  if(n<=8) return Math.min(8, gateNo);
  const base=Math.floor(n/8), rem=n%8, single=8-rem;
  const flat=single*base;
  return gateNo<=flat ? Math.ceil(gateNo/base)
                      : single + Math.ceil((gateNo-flat)/(base+1));
}

function drawFieldPanel(states, leadP, gap){
  if(!fieldCanvas){
    fieldCanvas=document.createElement("canvas");
    fieldCanvas.width=FLD_W; fieldCanvas.height=FLD_H;
    fieldAspect=FLD_W/FLD_H;
  }
  const c=fieldCanvas.getContext("2d");
  c.clearRect(0,0,FLD_W,FLD_H);

  /* 横のスケールは隊列の実長そのものに対応させる = 相対距離表示。
     先頭が右端(xR)、最後尾が左端(xL)に張り付き、間の馬は比率で並ぶ。
     前フレームの値を持ち越すと再生の仕方で結果が変わってしまうので、
     隊列長(時刻に対して滑らかに変化する)から毎回決める。
     gap≈0 の序盤でゼロ割・過剰拡大が起きないよう、小さな下限だけ置く
     (下限より詰まっている間は集団が右寄りになる=団子ガード) */
  const span=Math.max(10, gap);

  /* 背景は枠のない帯。上下に向かって透明へ抜くことで、
     芝の上でも数字が読めて、かつパネルの輪郭は目立たない */
  const g=c.createLinearGradient(0,0,0,FLD_H);
  g.addColorStop(0,   "rgba(52,58,55,0)");
  g.addColorStop(0.28,"rgba(52,58,55,0.30)");
  g.addColorStop(0.72,"rgba(52,58,55,0.30)");
  g.addColorStop(1,   "rgba(52,58,55,0)");
  c.fillStyle=g; c.fillRect(0,0,FLD_W,FLD_H);

  // 進行方向のシェブロン (右端)
  c.strokeStyle="rgba(255,255,255,0.75)"; c.lineWidth=5; c.lineCap="round";
  c.lineJoin="round";
  for(let k=0;k<2;k++){
    const x=FLD_W-50+k*19, y=FLD_H/2;
    c.beginPath(); c.moveTo(x-12,y-16); c.lineTo(x,y); c.lineTo(x-12,y+16); c.stroke();
  }

  const INNER=TRACK_HALF-1.55, OUTER=-(TRACK_HALF-0.5);
  const yOf=(lane)=>FLD_PADY+(INNER-lane)/(INNER-OUTER)*(FLD_H-FLD_PADY*2);
  const xR=FLD_W-FLD_PADX-MARKER_R*1.6, xL=FLD_PADX;
  const xOf=(p)=>xR-((leadP-p)*cfg.raceLen/span)*(xR-xL);

  /* 後ろの馬から描く = 前の馬が上に重なる。
     中継と同じで、先頭が誰かひと目で分かるようにするため */
  const idx=[...Array(cfg.n).keys()].sort((a,b)=>states[a].p-states[b].p);
  for(const i of idx){
    const x=xOf(states[i].p), y=yOf(states[i].lane);
    if(x<-60) continue;                     // 大きく離れた馬は枠外
    const r=MARKER_R;
    let bg,fg;
    if(FIELD_USE_WAKU){
      const w=WAKU[wakuOf(cfg.gates[i], cfg.n)-1];
      bg=w.bg; fg=w.fg;
    }else{
      bg="#"+cfg.colors[i].toString(16).padStart(6,"0");
      fg=lumaOf(cfg.colors[i])>0.55 ? "#111111" : "#ffffff";
    }
    // 進行方向を示す三角 (丸の下に敷いてから丸を重ねる)
    c.beginPath();
    c.moveTo(x+r*0.34, y-r*0.60); c.lineTo(x+r*1.58, y); c.lineTo(x+r*0.34, y+r*0.60);
    c.closePath();
    c.fillStyle=bg; c.fill();
    c.strokeStyle="rgba(255,255,255,0.95)"; c.lineWidth=3.5; c.stroke();
    // 馬番の丸 (足元に落とす影で、重なっても前後関係が読める)
    c.save();
    c.shadowColor="rgba(0,0,0,0.55)"; c.shadowBlur=8; c.shadowOffsetY=2;
    c.beginPath(); c.arc(x,y,r,0,Math.PI*2);
    c.fillStyle=bg; c.fill();
    c.restore();
    c.beginPath(); c.arc(x,y,r,0,Math.PI*2); c.stroke();
    c.fillStyle=fg;
    c.font=`bold ${cfg.gates[i]>9?r*1.15:r*1.32}px sans-serif`;
    c.textAlign="center"; c.textBaseline="middle";
    c.fillText(cfg.gates[i], x, y+1);
  }
  c.textAlign="left"; c.textBaseline="alphabetic";

  if(!fieldTex){
    fieldTex=new THREE.CanvasTexture(fieldCanvas);
    fieldPlane=new THREE.Mesh(new THREE.PlaneGeometry(1,1),
      new THREE.MeshBasicMaterial({map:fieldTex,transparent:true,depthTest:false}));
    ovScene.add(fieldPlane);
  }
  fieldTex.needsUpdate=true;
}

/* 馬の見た目だけを作り直す。コース・展開・再生位置には触らない。
   毛色パターンの切り替えを即座に反映するために applySettings から分けてある。
   CGモデルを読めていれば必ずそちらを使う (BlockHorse は読み込み失敗時の保険) */
function rebuildHorseActors(){
  for(const h of horses) h.dispose(scene);
  horses=[];
  for(let i=0;i<cfg.n;i++)
    horses.push(HORSE.ready
      ? new GLBHorse(scene,i,cfg.names[i],cfg.colors[i],cfg.gates[i],cfg.coatMode)
      : new BlockHorse(scene,i,cfg.names[i],cfg.colors[i],cfg.gates[i]));
}

/* ホストから渡された最新の入力。表示の切り替えなどで組み直すときに再利用する */
let lastInput=null;

/* ホストの共通ストアの内容からレースを組み立てる。
   input = { horses:[{name,color:"#rrggbb",gate,style}]  ← 並びがそのまま着順
             coursePreset, handed, algo, seed, coatMode, countdown,
             board:{title,color,margin} }  ← 結果発表の見せ方(競馬風と共通の設定)
   出走馬の並び・馬番・脚質の意味は競馬風(2D)とまったく同じで、
   ここで解釈をずらさないことが2ツールの互換の要になっている */
function applySettings(input){
  if(input) lastInput=input;
  const src=lastInput;
  if(!src || !Array.isArray(src.horses) || src.horses.length<2)
    throw new Error("[real3d] 出走馬が2頭以上必要です");
  /* コースを選ぶ = レース距離・オーバル寸法・馬の速度が決まる。
     動画の尺はユーザー指定ではなく、そこから逆算される */
  const pre = COURSE_PRESETS[src.coursePreset] || COURSE_PRESETS.short;
  const raceSec = pre.raceLen / pre.speed;
  cfg = {
    n: clamp(src.horses.length,2,16),
    duration: raceSec + RESULT_SEC, // 仮。ゲート待機と着差を足して最後に確定させる
    preset: pre,
    raceLen: pre.raceLen,
    straight: pre.straight, radius: pre.radius, speed: pre.speed,
    runOut: pre.runOut,
    hand: src.handed==="right" ? -1 : 1,
    seed: +src.seed|0,
    algo: src.algo==="real" ? "real" : "drama",
    // 毛色の決め方。real=4テクスチャから選ぶ / color=芦毛テクスチャに着色
    coatMode: src.coatMode==="color" ? "color" : "real",
    countdown: !!src.countdown,   // gateSecOf() が見る。総尺が変わるのでcfg側に持つ
    /* 結果発表の見せ方。競馬風と同じ設定を受け取る。
       アイコン画像だけは3Dの馬に貼れないので、こちらには渡ってこない */
    board: {
      title : (src.board&&src.board.title) || "結果発表",
      color : !src.board || src.board.color !==false,
      margin: !src.board || src.board.margin!==false,
    },
    names: [], order: [], colors: [], styles: [], gates: []
  };
  cfg.duration += gateSecOf();
  src.horses.slice(0,cfg.n).forEach((h,i)=>{
    cfg.names.push(h.name || `${i+1}番`);
    cfg.order.push(i+1); // 配列の並び = 最終着順 (先頭が1着)
    // 馬番: ゲート位置と表示番号。着順とは独立 (指定がなければ並び順)
    cfg.gates.push(+h.gate || (i+1));
    cfg.colors.push(parseInt(String(h.color||"#8a4b2e").slice(1),16)||0);
    cfg.styles.push(h.style || "auto");
  });

  course=new Course(cfg.raceLen, cfg.straight, cfg.radius, cfg.runOut, cfg.hand);
  // カット遷移は秒で決める (距離基準だと短いコースで遷移が支配的になる)
  TRANSITION = 1.5*cfg.speed/cfg.raceLen;
  buildMiniMapGeom();   // 俯瞰図はコース形状から起こす
  plan=new RacePlan(cfg.n, cfg.order, cfg.seed, cfg.styles, cfg.algo);
  plan.bindCourse(cfg.raceLen);
  buildShotPlan();   // カット割りはコース形状と隊列の広がりから組む
  laneResetTrace();             // レーンの積分結果は設定ごとに作り直す
  buildCourse();
  rebuildHorseActors();

  /* 時間配分: ゲート待機 → レース → 最後尾がゴール → 結果発表
     ------------------------------------------------------------
     以前は総尺を先に決めて逆算していたが、それだと着差の合計が大きい回に
     最後尾のゴールが総尺をはみ出し、結果発表が出ないまま動画が終わっていた。
     レース区間 t∈[0,1] に収まる後続の遅れは raceLen の約4%分しかなく、
     実速度化でこの4%が秒数として短くなったため頻発するようになった。

     そこで順序を逆にして、レース尺 → 最後尾のゴール → 結果発表 の順に
     積み上げ、総尺は最後に確定させる。着差が大きい回はそのぶん動画が伸びる
     (実際の中継も後続がゴールするまで映すので、挙動としても自然) */
  const resultSec=RESULT_SEC, gateSec=gateSecOf();
  gateFrames=Math.round(gateSec*FPS);
  raceFrames=Math.round((cfg.raceLen/cfg.speed)*FPS); // t∈[0,1] にあてるフレーム数

  /* --- ゴール瞬間のスローモーション (タイムリマップ) ---
     1着がゴールする LEAD_M 手前から、3着が線を越えた TAIL_M 後まで。

     倍率を固定していたが、実速度化で破綻したので秒数指定に変えた。
     以前は「1200mを16.8秒」= 71m/s だったので16mの通過が0.22秒しかなく、
     7.7倍に伸ばして約1.7秒に収まっていた。実速度(17m/s)では同じ16mに
     0.9秒かかるため、同じ倍率だと7秒近い間延びしたスローになる。

     そこで「スロー区間が何秒に見えるか」を先に決め、倍率はそこから逆算する。
     着差が大きい回は等倍のままにする(伸ばす必要がない)。
     フレーム→レース時刻の写像は単調・決定論なので書き出し互換 */
  {
    const SLOW_SEC = 3.0;   // スロー区間の見かけの長さ[秒]
    const LEAD_M   = 8;     // 1着ゴールの何m手前から入るか
    const TAIL_M   = 2;     // 最終対象馬がゴールした何m後まで続けるか

    // 3着まで映す (3頭に満たない場合は最下位まで)
    const lastIdx = Math.min(cfg.n, 3) - 1;
    const gTop = plan.cumMeters[lastIdx] || 0;   // 1着から3着までの実距離[m]

    const tA = 0.96*(1 - LEAD_M/cfg.raceLen);
    const tB = 0.96*(1 + (gTop+TAIL_M)/cfg.raceLen);
    const naturalSec = (LEAD_M + gTop + TAIL_M)/cfg.speed; // 等倍なら何秒か
    const k = Math.max(1, SLOW_SEC/naturalSec);            // 等倍より速くはしない
    const w = tB-tA;
    const Rn = raceFrames/(1-w + w*k); // 通常区間の実効フレームレート係数
    timeWarp = { tA, tB, k, Rn,
      fA: tA*Rn, fB: tA*Rn + w*k*Rn };
  }

  /* 最後尾がゴールする時刻を求め、その直後に結果を出す。
     総尺はここから確定するので、何頭でどんな着差でも必ず全馬のゴールが映る。

     以前は「gateFrames+raceFrames」を下限に置いていた。これは進行度t=1
     (先頭が線の4%先まで走り切る)に対応する時刻で、着差が小さい回では
     こちらが効いてしまい、最後尾が通過してから数秒間、
     誰も走っていない決勝線を映し続けることになっていた。
     下限をやめ、最後尾の入線を基準に決める */
  const lastGap = plan.cumMeters[cfg.n-1]/cfg.raceLen;
  const allGoalFrame = gateFrames + Math.ceil(frameOfRaceT(0.96*(1+lastGap)));
  resultsStartFrame = allGoalFrame + Math.round(FPS*0.6);   // 入線の余韻 0.6秒
  totalFrames = resultsStartFrame + Math.round(resultSec*FPS);
  cfg.duration = totalFrames/FPS;
  buildResultsBoard();

  frame=0; playing=false;
  emit("playing",false);
  renderFrame();
}

function renderFrame(){
  /* ゲート待機 → 扉が開いてレース開始。
     レース時刻はゲート分を差し引いたフレームから算出 */
  const standing = frame < gateFrames;
  const t=raceTOfFrame(Math.max(0, frame-gateFrames));
  /* t は等倍なら raceFrames フレームで 0→1 進む。秒に直せば
     「スローがかかっていない世界でのレース経過時間」になる */
  raceClockSec = t*raceFrames/FPS;
  // 扉: レース開始の0.25秒前から開き始め、開始と同時に全開
  const doorOpen=smoothstep(gateFrames-FPS*0.25, gateFrames, frame);
  for(const d of gateDoors) d.hinge.rotation.y = d.dir*1.5*doorOpen;
  // 全馬の進行度を先に算出（レーンは進行度の前後関係から動的に決める）
  let leaderP=-1, leaderIdx=0, sumX=0,sumZ=0, sumTx=0,sumTz=0;
  const states=[];
  for(let i=0;i<cfg.n;i++){
    const p=plan.progress(i,t);
    states.push({p});
    if(p>leaderP){leaderP=p;leaderIdx=i;}
  }

  /* ================= レーンの決定: 追い越しは外から =================
     各馬の横位置を、レース開始から現在まで前向きに積分して求める(laneLateralAt)。
     ルールは3つだけで、実戦の進路取りはここから自然に出てくる。

       1. 自分の真正面(同じレーン)の前方に馬がいる間は、外へ出る
       2. 前が空いていれば内へ戻る (内ラチ沿いが最短なので)
       3. 1も2も、移動先に併走中の馬がいれば動かない

     3が肝で、これがあるために「真横に並んでいる馬の進路を横切る」動きが
     原理的に起きない。結果として、
       ・前を塞がれた馬は外へ回ってから抜く = 追い越しは外から
       ・前の馬が外を回っていれば内は空いているので、内から抜ける
       ・抜かれた馬が外へ押し出されることはない (先に居た側が進路を保つ)

     以前は「自分より前にいる馬の数」から毎フレーム独立にレーンを決めていた。
     この方式だと追い抜いた瞬間に2頭の「前にいる馬の数」が入れ替わり、
     レーンも交換される = すれ違うように内外が入れ替わっていた。

     馬同士の当たり判定(押し分け)も、以前はここで毎フレームゼロから解いていたが、
     上限速度が無いため接触の瞬間に1フレームで最大1.15m(=34m/s)横へ飛んでいた。
     現在は積分側(laneSolveStep)に移し、横速度に上限をかけてある。 */
  const laneM=laneLateralAt(Math.max(0, Math.min(1.005, t)));
  for(let i=0;i<cfg.n;i++) states[i].lane=laneM[i];

  /* 馬同士の当たり判定(押し分け)はここには無い。laneSolveStep へ移してある。
     ここで毎フレーム解き直すと、横速度に上限をかけられないため。 */

  for(let i=0;i<cfg.n;i++){
    const {pos,tan}=course.sample(states[i].p, states[i].lane);
    Object.assign(states[i],{pos,tan});
    sumX+=pos.x; sumZ+=pos.z; sumTx+=tan.x; sumTz+=tan.z;
  }
  for(let i=0;i<cfg.n;i++){
    const s=states[i];
    /* 旋回の内傾: tan(θ) = v^2 / (R*g)。
       コーナーが急なショートコースほど深く倒れ、直線では0に戻る。
       これがないと、急なコーナーを直立のまま滑っていく「模型」に見える */
    const curv = course.curvature(course.dStart + s.p*cfg.raceLen);
    // 右回りでは倒す向きも反転する (常にコースの内側へ倒れる)
    const lean = standing ? 0 : Math.atan(cfg.speed*cfg.speed*curv/9.8)*course.hand;
    horses[i].update(s.pos, s.tan, s.p*cfg.raceLen, standing, lean);
  }
  /* --- 仮想先頭点 ---
     カメラの基準を「先頭の馬」にすると、先頭が入れ替わった瞬間に
     基準点が隣のレーンへ飛び、カメラがワープする。
     そこで先頭付近の馬を進行度で重み付けした連続的な重心を使う。
     先頭交代時も滑らかに遷移し、フレーム単位の決定論も保たれる */
  let vw=0, vp=0, vlane=0;
  const TAU=0.0025; // 混合の鋭さ: 小さいほど先頭単独に近い
  for(const s of states){
    const w=Math.exp((s.p-leaderP)/TAU);
    vw+=w; vp+=w*s.p; vlane+=w*s.lane;
  }
  vp/=vw; vlane/=vw;
  const vSample=course.sample(vp, vlane);

  /* 隊列全体の情報: 最終直線での全頭フィット用 */
  let minP=Infinity;
  for(const s of states){ if(s.p<minP) minP=s.p; }

  /* 隊列の先頭端・最後尾端 (カメラ専用の連続版)。
     素の max/min のままだと、その位置にいる馬が入れ替わる瞬間に微分が飛び、
     注視点と寄り引きがカクッと折れる (実測 0.073 m/frame^2)。
     仮想先頭点と同じ指数重みで、端の近くにいる馬を混ぜた連続的な端点にする。
     着順・HUD・隊列パネルは本物の leaderP / minP を使い続ける */
  const EDGE_TAU=4.0/cfg.raceLen;      // 端から何m以内の馬を混ぜるか
  let hwSum=0, hpSum=0, twSum=0, tpSum=0;
  for(const s of states){
    const a=Math.exp((s.p-leaderP)/EDGE_TAU); hwSum+=a; hpSum+=a*s.p;
    const b=Math.exp((minP-s.p)/EDGE_TAU);    twSum+=b; tpSum+=b*s.p;
  }
  const headP=hpSum/hwSum, tailP=tpSum/twSum;
  const midSample=course.sample((headP+tailP)/2, 0);

  // カメラ台本 (ノイズを含まない決定論的な進行度で進める)
  const tBase=Math.min(1.005, t/0.96);

  /* ゲート撤去: 発走後、先頭が250m通過したあたりから内馬場へ牽引され、
     400m地点で完全に退場 (周回コースで2周目に残らないように) */
  if(gateGroup){
    const gone=smoothstep(250/cfg.raceLen, 400/cfg.raceLen, tBase);
    const u=gateGroup.userData;
    gateGroup.position.copy(u.base).addScaledVector(u.inward, gone*22);
    gateGroup.visible = gone < 1;
  }
  /* カメラに必ず収めたい点。1位は馬体の四隅と背の高さまで見る
     (中心点だけだと体半分がはみ出す)。2,3着は入れば入れる扱い。

     基準は「仮想先頭点」ではなく実際に先頭を走っている馬。
     仮想先頭点は全馬の重み付き平均なのでカメラの動きは滑らかになるが、
     実際の1位とは最大10mずれる。ここを仮想点にしていたため、
     「1位は必ず収める」補正が実際の1位を外して見切れていた。
     カメラの位置と視線は従来どおり仮想先頭点ベース = 滑らかさは維持 */
  /* 【重要】先頭1頭ぶんの箱だけを持たせないこと。
     先頭が入れ替わった瞬間に対象の箱が隣のレーンへ飛び、画角が段差で変わる
     (実測 1フレームに 2.5°、しかも往復するので画面がカクッと鳴る)。

     そこで全馬ぶんの箱を持ち、先頭との差で指数的に重み付けする。
     重み w は先頭の馬が常にちょうど 1、後ろほど 0 に近づく。
     w=0 の馬は「要求を出さない」のと同じ扱いなので、
     先頭が入れ替わっても要求の中身が連続に入れ替わる。
     w は Vector3 に持たせ、fitCamera / fovToContain が読む */
  const mustSee=[], wantSee=[];
  {
    const LEAD_TAU=LEAD_BLEND_M/cfg.raceLen;
    for(let i=0;i<cfg.n;i++){
      const w=Math.exp((states[i].p-leaderP)/LEAD_TAU);
      if(w<1e-3) continue;            // 影響が1000分の1未満。切っても連続性は保たれる
      const s=states[i], lp=s.pos, lt=s.tan, ln=normalOf(lt);
      for(const f of [-1.4, 2.2]) for(const sd of [-1.3, 1.3]) for(const hy of [0.2, 2.7]){
        const v=new THREE.Vector3(lp.x+lt.x*f+ln.x*sd, hy, lp.z+lt.z*f+ln.z*sd);
        v.w=w; mustSee.push(v);
      }
    }
    const rank=[...Array(cfg.n).keys()].sort((a,b)=>states[b].p-states[a].p);
    for(const k of [1,2]) if(rank[k]!==undefined){
      const q=states[rank[k]].pos;
      wantSee.push(new THREE.Vector3(q.x,0.2,q.z), new THREE.Vector3(q.x,2.5,q.z));
    }
  }
  // 全馬の足元と頭上。全景系カット(fitAll)のフレーミングに使う
  let shot=SHOTS[SHOTS.length-1];
  for(const sh of SHOTS){ if(tBase<=sh.until){shot=sh;break;} }
  // 正面カットの進み具合 (0=回り込み前 1=正面)。遷移中も前カット側で使う
  const fSh=SHOTS.find(x=>x.name===SHOT_DEFS.front.name);
  const frontU=fSh? Math.max(0,Math.min(1,(tBase-fSh.from)/Math.max(1e-6,fSh.until-fSh.from))) : 0;
  const allSee=[];
  let laneSum=0;
  for(let i=0;i<cfg.n;i++){
    const q=states[i].pos;
    allSee.push(new THREE.Vector3(q.x,0.2,q.z), new THREE.Vector3(q.x,2.6,q.z));
    laneSum+=states[i].lane;
  }
  const ctx={
    /* 隊列が走っている横位置の平均 (+が内側)。
       中心線ではなく「実際に馬がいる面」を基準に寄り引きを決めるために使う */
    laneAvg: laneSum/cfg.n,
    course, cam,
    leaderPos:vSample.pos, leaderTan:vSample.tan,
    packCenter:new THREE.Vector3(sumX/cfg.n,1.2,sumZ/cfg.n),
    packTan:new THREE.Vector3(sumTx,0,sumTz).normalize(),
    fitCenter:midSample.pos,              // 先頭〜最後尾の中間点
    spreadM:(headP-tailP)*cfg.raceLen,    // 隊列の全長(m)
    aspect:currentAspect(),
    tBase, frontU,
    leaderP, minP,                        // 本物。着順・ゴール判定に使う
    headP, tailP,                         // カメラ用の連続版
    midP:(headP+tailP)/2,
    mustSee, wantSee, allSee,
  };
  // 検証用フック (window.__keibaDebug を用意した時だけ値が入る)
  if(window.__keibaDebug){ window.__keibaDebug.mustSee=mustSee;
    window.__keibaDebug.leaderP=leaderP;
    window.__keibaDebug.lx=vSample.pos.x; window.__keibaDebug.lz=vSample.pos.z;
    window.__keibaDebug.allFin = minP>=1;
    window.__keibaDebug.beforeLine = leaderP<1; }
  const label=applyCamera(ctx, tBase);
  emit("shot",label);

  /* 影のシャドウカメラを隊列に追従させる。
     基準は先頭〜最後尾の中間点。先頭に合わせると、隊列が伸びたとき
     後方の馬がシャドウカメラの外へ出て影が消える */
  updateSunShadow(ctx.fitCenter);

  /* 経過時間・残り距離・再生位置はホストに渡すだけ。
     3Dの絵の外側(HTML)に出るのでプレビュー専用で、書き出し動画には映らない */
  const remain=Math.max(0,Math.round((1-leaderP)*cfg.raceLen/50)*50);
  emit("frame",{frame, totalFrames, sec:frame/FPS, duration:totalFrames/FPS,
                remain, finished:leaderP>=1});

  /* --- 分割画面 (向正面の長い直線) ---
     上1/4: 全馬が収まる全体像 / 下3/4: 先頭→最後尾へ横をスクロール。
     中継の分割ワイプと同じ構図。三.jsのビューポートとシザーで2回描く。
     スクロール位置はカット内の進行度から直接決まる純関数なので決定論 */
  /* 分割画面は切替と同時に始める。
     ブレンドするカットなら遷移が終わるのを待つが、cut のカットは
     待つ必要がなく、待つとその間だけ1画面のフォールバック構図が映る */
  const splitOn = shot.split &&
    (shot.cut || tBase > shot.from + (shot.trans||TRANSITION));
  if(splitOn){
    const a=currentAspect();
    const sz=renderer.getSize(new THREE.Vector2());
    const W=sz.x, H=sz.y;
    renderer.setScissorTest(true);

    /* 下3/4: 馬に寄った真横のアップで、先頭から最後尾までワンカットで流す。
       カメラは外ラチの外側に固定距離で置いたまま、望遠で切り取る
       (寄るために走路へ踏み込むわけにはいかないため、実際の中継の
        トラックサイド望遠と同じ考え方)。
       画角は「画面内に何メートル入れたいか」から毎フレーム逆算するので、
       画面比率が変わっても寄り具合は一定になる */
    const scrollP=splitScrollP(ctx, shot);
    if(window.__keibaDebug) window.__keibaDebug.splitP=scrollP;
    /* 【中心線ではなく馬が走っている面を基準にする】
       以前は course.sample(scrollP, 0) = 中心線を狙い、画角も
       中心線までの距離(22m)で計算していた。ところが馬は内ラチ寄り
       (レーン +8〜10.4m) を走り、カメラは内側にいるので実際の距離は
       11.9〜14.9m しかない。結果、画面に入る幅は 13m ではなく約6.5m、
       さらに見下ろし角がずれて脚が下に見切れていた。
       馬のいる面を狙えば距離が SPLIT_CAM_D どおりになり、
       SHOW_M が文字どおりの意味になる */
    const sp=course.sample(scrollP, ctx.laneAvg);
    const sn=normalOf(sp.tan);
    const SHOW_M=9;                        // 画面に入れる横幅[m] ≒ 馬3頭
    const camDist=SPLIT_CAM_D;
    const paneA=a/SPLIT_Y;
    const vHalf=(SHOW_M/2)/camDist/paneA;  // 必要な縦の画角(tan)
    cam.fov=2*Math.atan(vHalf)*180/Math.PI;
    cam.aspect=paneA; cam.updateProjectionMatrix();
    /* 狙う高さは馬体の中心(約1.0m)より少し下。レーンの内外で馬までの距離が
       ±3mばらつき、内寄りの馬ほど大きく・低く映るため、その分の余裕を下に取る */
    cam.position.set(sp.pos.x+sn.x*camDist, 2.4, sp.pos.z+sn.z*camDist);
    cam.lookAt(sp.pos.x, 1.05, sp.pos.z);
    renderer.setViewport(0,0,W,Math.round(H*SPLIT_Y));
    renderer.setScissor(0,0,W,Math.round(H*SPLIT_Y));
    renderer.render(scene,cam);
    if(window.__keibaDebug){          // 検証用: 下段カメラの姿勢を控えておく
      window.__keibaDebug.botPos=cam.position.clone();
      window.__keibaDebug.botQuat=cam.quaternion.clone();
      window.__keibaDebug.botFov=cam.fov;
      window.__keibaDebug.laneAvg=ctx.laneAvg;
    }

    /* 上1/4: 隊列の全体像。ほぼ真横・わずかに上から見る。

       カメラの位置(距離と高さ)は固定し、画角のほうを毎フレーム計算して
       1位から最後尾までが余裕を持って収まるようにする。
       以前は逆に「画角45°固定・距離を伸ばして収める」作りだったため、
       上帯は横に4倍広いぶん隊列が横幅の2〜3割しか占めず、
       馬が豆粒になっていた。

       カメラは下段と同じく馬場の内側に置く。外側に置くと進行方向が
       下段と逆に流れ、同じ画面の上下で馬が反対向きに走って見える */
    const TOP_D=26, TOP_H=5.5;     // 内側へ26m・高さ5.5m ≒ 見下ろし9°
    const TOP_FOV_MAX=46;          // これ以上広げると歪むので、超える分は距離で稼ぐ
    const mp=course.sample(ctx.midP, 0);
    const mn=normalOf(mp.tan);
    const topA=a/(1-SPLIT_Y);                     // 上帯のアスペクト = W/(H*(1-SPLIT_Y))
    const look=new THREE.Vector3(mp.pos.x, 1.5, mp.pos.z);
    const sub={cam, aspect:topA};
    const place=(d)=>new THREE.Vector3(
      mp.pos.x+mn.x*d, 1.5+(TOP_H-1.5)*d/TOP_D, mp.pos.z+mn.z*d);
    let tp=place(TOP_D);
    // safe=0.72 → 隊列の両端に画面の約28%ぶんの余白が残る
    let topFov=fovToContain(sub, tp, look, ctx.allSee, 0.72);
    /* 画角の上限を超える場合(縦長比率では上帯が横に狭い)は、
       画角を広げる代わりにカメラを下げて距離で稼ぐ。
       見下ろし角が変わらないよう、高さも距離に比例させる */
    if(topFov>TOP_FOV_MAX){
      const k=Math.tan(topFov*Math.PI/360)/Math.tan(TOP_FOV_MAX*Math.PI/360);
      tp=place(TOP_D*k);
      topFov=TOP_FOV_MAX;
    }
    cam.fov=Math.max(9, topFov); cam.aspect=topA; cam.updateProjectionMatrix();
    cam.position.copy(tp);
    cam.lookAt(look);
    if(window.__keibaDebug){          // 検証用: 上段カメラの姿勢を控えておく
      window.__keibaDebug.topPos=cam.position.clone();
      window.__keibaDebug.topMidP=ctx.midP;
      window.__keibaDebug.topFov=cam.fov;
      window.__keibaDebug.topQuat=cam.quaternion.clone();
    }
    renderer.setViewport(0,Math.round(H*SPLIT_Y),W,H-Math.round(H*SPLIT_Y));
    renderer.setScissor(0,Math.round(H*SPLIT_Y),W,H-Math.round(H*SPLIT_Y));
    renderer.render(scene,cam);

    renderer.setScissorTest(false);
    renderer.setViewport(0,0,W,H);
    cam.fov=CAM_FOV; cam.aspect=a; cam.updateProjectionMatrix();
    showSplitLine(H);                 // 上下の境目に細い黒線
  }else{
    renderer.render(scene,cam);
    if(splitLine) splitLine.visible=false;
  }

  /* --- 結果発表オーバーレイ ---
     全馬ゴール後(resultsStartFrame)から0.6秒かけてフェードイン。
     WebGLに合成しているので、書き出し動画にもそのまま焼き込まれる */
  const fade=smoothstep(resultsStartFrame, resultsStartFrame+FPS*0.3, frame);
  // オフにした時は板を隠す (下の描画ブロックは checked の時しか通らないため)
  if(mapPlane)   mapPlane.visible=false;
  if(fieldPlane) fieldPlane.visible=false;
  let hudCenterY=null;   // 俯瞰図と隊列パネルを揃える共通の中心線(俯瞰図側で確定)

  /* --- スタートのカウントダウン --- */
  if(cdPlane) cdPlane.visible=false;
  if(cfg.countdown && frame < gateFrames){
    const remain=(gateFrames-frame)/FPS;              // 残り秒
    const n=Math.max(1, Math.min(COUNTDOWN_SEC, Math.ceil(remain)));
    showCountdown(n, Math.min(1, Math.max(0, n-remain)));  // その数字が出てからの経過(0..1)
  }

  /* --- コース俯瞰図 (左下) ---
     先頭の進行度で軌跡と現在地を更新する。結果発表が出たら引っ込める */
  if(mapGeom && view.showMap){
    drawMiniMap(leaderP);
    const a=currentAspect();
    let hN=0.42, wN=hN*mapAspect/a;
    // 縦長・正方形では横に伸びすぎるので、横幅を画面の約1/3(NDC全幅=2の1/3)で頭打ち
    const wMax=0.66;
    if(wN>wMax){ hN*=wMax/wN; wN=wMax; }
    mapPlane.scale.set(wN,hN,1);
    hudCenterY = -1+hN/2+0.04;                 // この中心線に隊列パネルも合わせる
    mapPlane.position.set(-1+wN/2+0.04, hudCenterY, 0);
    mapPlane.material.opacity=1-fade;
    mapPlane.visible=fade<1;
  }

  /* --- 隊列パネル (中央下) --- */
  if(states && states.length && view.showField){
    drawFieldPanel(states, leaderP, (leaderP-minP)*cfg.raceLen);
    /* 幅を基準に置く。縦長のアスペクトでは横がはみ出すので、
       その場合だけ幅で頭打ちにして全体を縮める (結果発表の板と同じ扱い) */
    const a=currentAspect(), ar=view.aspect;
    let hN=0.27, wN=hN*fieldAspect/a;
    // 16:9 は従来どおり(中央やや右・広め)。縦長/正方形は俯瞰図を避けて狭め・右寄せ
    let cx=0.20, wMax=1.5;
    if(ar!=="16:9"){ cx=0.35; wMax=1.16; }
    if(wN>wMax){ const k=wMax/wN; wN*=k; hN*=k; }
    fieldPlane.scale.set(wN,hN,1);
    // 俯瞰図と同じ中心線に合わせる(俯瞰図OFF時のみ従来の下端合わせ)
    const fy = (hudCenterY!==null) ? hudCenterY : (-1+hN/2+0.03);
    fieldPlane.position.set(cx, fy, 0);
    fieldPlane.material.opacity=1-fade;
    fieldPlane.visible=fade<1;
  }

  if(ovPlane){
    ovPlane.material.opacity=fade;
    ovPlane.visible=fade>0;
    if(fade>0){
      // 板のサイズ: 画面高さの85%を上限に、テクスチャの縦横比を維持
      const a=currentAspect();
      let hN=1.7;
      let wN=hN*ovTexAspect/a;
      if(wN>1.9){ const k=1.9/wN; wN*=k; hN*=k; }
      ovPlane.scale.set(wN,hN,1);
      // わずかに下から浮き上がる演出
      ovPlane.position.y=(1-fade)*-0.08;
    }
  }
  /* --- 透かし ---
     画面の縁を一定速度で回り続ける (左上→右上→右下→左下→左上)。止まらない。
     周回数は尺ではなく速度で決まるので、短い動画では1周しないこともある。
     尺で割ると短い動画ほど速くなってしまうため、こちらを優先している */
  if(markPlane){
    /* OFF のときは板を隠すだけ。位置の計算は続けているので、
       途中で戻しても流れる位置が飛ばない (frame の関数のままでいる) */
    markPlane.visible=view.showMark;
    const a=currentAspect(), PAD_N=0.03;
    let hN=MARK_H, wN=hN*markAspect/a;
    /* 縦長では横に伸びすぎるので幅で頭打ちにして全体を縮める。
       1.4 = 画面幅の70%。ここを下げると MARK_H を上げても
       縦長・正方形だけ大きくならない */
    const wMax=1.4;
    if(wN>wMax){ const k=wMax/wN; wN*=k; hN*=k; }
    markPlane.scale.set(wN,hN,1);
    const xMax=Math.max(0, 1-wN/2-PAD_N), yMax=Math.max(0, 1-hN/2-PAD_N);
    /* 下の2辺は画面の下端ではなく、俯瞰図・隊列パネルの上を通す。
       下端まで下ろすと左下で俯瞰図と丸かぶりする。
       判定に .visible ではなくチェックボックスを使うのは、結果発表で板が消えるときに
       透かしの高さが跳ねないようにするため (位置と大きさは消えても保持される) */
    let botLimit=-1;
    if(mapPlane   && view.showMap)
      botLimit=Math.max(botLimit, mapPlane.position.y+mapPlane.scale.y/2);
    if(fieldPlane && view.showField)
      botLimit=Math.max(botLimit, fieldPlane.position.y+fieldPlane.scale.y/2);
    /* 板を大きくすると下辺の通り道が上がるので、上辺を追い越さないよう抑える。
       追い越すと周の長さが負になり、位置の計算が破綻する */
    const yTop=Math.min(MARK_TOP_Y, yMax);
    const yBot=Math.min(yTop, Math.max(-yMax, botLimit+hN/2+0.02));
    /* 周の長さに沿って一定速度で進む。角では向きだけが変わり、速さは変わらない */
    const sideW=2*xMax, sideH=yTop-yBot;
    const per=2*(sideW+sideH);
    let d=per>0 ? (frame/FPS*MARK_SPEED)%per : 0;
    let mx, my;
    if(d<sideW){                 mx=-xMax+d;        my=yTop;        }
    else if((d-=sideW)<sideH){   mx= xMax;          my=yTop-d;      }
    else if((d-=sideH)<sideW){   mx= xMax-d;        my=yBot;        }
    else {      d-=sideW;        mx=-xMax;          my=yBot+d;      }
    markPlane.position.set(mx,my,0);
    if(window.__keibaDebug){ window.__keibaDebug.mark=markPlane;
      window.__keibaDebug.markPer=per; }
  }

  if((ovPlane&&ovPlane.visible) || (mapPlane&&mapPlane.visible)
     || (fieldPlane&&fieldPlane.visible) || (splitLine&&splitLine.visible)
     || (cdPlane&&cdPlane.visible) || (markPlane&&markPlane.visible)){
    renderer.autoClear=false;
    renderer.render(ovScene,ovCam);
    renderer.autoClear=true;
  }
}

/* 再生: 実時間からフレーム番号を算出する。
   - モニターのリフレッシュレート(60Hz/120Hz等)に依存せず、指定秒数どおり再生される
   - 描画自体は常に frame → renderFrame() の決定論を維持 (書き出し互換) */
let playStartWall=0, playStartFrame=0, rafId=0;
function startClock(){ playStartWall=performance.now(); playStartFrame=frame; }
function tick(){
  rafId=requestAnimationFrame(tick);
  if(playing){
    const elapsed=(performance.now()-playStartWall)/1000;
    const f=playStartFrame+Math.floor(elapsed*FPS);
    if(f===frame) return;           // 高リフレッシュ環境: 同一フレームは再描画しない
    frame=Math.min(f,totalFrames);
    const done=frame>=totalFrames;
    if(done){ playing=false; emit("playing",false); }
    renderFrame();
    if(done) emit("ended");         // 録画の停止はホストがこれを見て行う
  }
}

/* =====================================================================
   公開API
   ---------------------------------------------------------------------
   ホスト(index.html)から触れるのはここだけ。
   ・入力  … applyConfig() で共通ストアの内容を丸ごと受け取る
   ・出力  … on() のイベントで返す (DOMには一切書き込まない)
   ===================================================================== */

/* 選択中のコースの実寸と尺。ホストがパネルの説明文に使う。
   尺は距離÷実速度で決まり、着差のぶんだけ伸びるので applyConfig 後の値を返す */
function courseInfoText(){
  if(!cfg || !course) return "";
  const pre=cfg.preset;
  const lap=2*pre.straight + 2*Math.PI*pre.radius;
  const total=totalFrames/FPS;        // 着差ぶん伸びた実際の総尺
  const mm=x=> x<60 ? `${x.toFixed(1)}秒`
    : `${Math.floor(x/60)}分${(x%60).toFixed(1).padStart(4,"0")}秒`;
  return `1周${lap.toFixed(0)}m・直線${pre.straight}m／`
    + `${pre.raceLen}mを${(pre.raceLen/lap).toFixed(2)}周／`
    + `動画の長さ ${mm(total)}`;
}

/* 書き出し時の解像度。比率ごとに固定する。
   プレビューは表示サイズなりに描くが、それを録ると小さい画面ほど
   低解像度の動画になってしまう(スマホでは720pを下回る)。
   競馬風(2D)が画面サイズに関係なく1280x720で書き出すのに合わせる */
const EXPORT_SIZES={"16:9":[1280,720],"9:16":[720,1280],"1:1":[1080,1080]};
let exporting=false;

/* アスペクト比を固定し、余白は黒帯(レターボックス)で埋める。
   比率はエンジンが握る。ホストのCSSに任せるとカメラの画角計算と食い違う */
function resize(){
  if(!viewport || exporting) return;   // 書き出し中は解像度を動かさない
  const availW=viewport.clientWidth, availH=viewport.clientHeight;
  if(availW<=0 || availH<=0) return;
  const a=currentAspect();
  let w=availW, h=w/a;
  if(h>availH){ h=availH; w=h*a; }
  stage.style.width=Math.floor(w)+"px";
  stage.style.height=Math.floor(h)+"px";
  renderer.setSize(Math.floor(w),Math.floor(h));
  renderer.setPixelRatio(Math.min(devicePixelRatio,2));
  cam.aspect=a; cam.updateProjectionMatrix();
  if(cfg) renderFrame();
}

let inited=false, resizeBound=null;

global.Real3D={
  /* 毛色の一覧。「リアル」の毛色は4種に丸められるので、
     ホストはこれを使って毛色セレクトを組み立てる。
     テーブルの持ち主はこのモジュールだけ (二重管理を避けるため) */
  COATS: COAT_TEX.map(c=>({hex:"#"+c.hex.toString(16).padStart(6,"0"), label:c.label})),
  /* 指定色に一番近い毛色。自由色から毛色を割り出したいときに使う */
  nearestCoat(hexStr){
    const c=nearestCoat(parseInt(String(hexStr).slice(1),16)||0);
    return {hex:"#"+c.hex.toString(16).padStart(6,"0"), label:c.label};
  },
  /* コースの一覧。ラベルと距離をホストのセレクトに出すために公開する */
  COURSES: Object.keys(COURSE_PRESETS).map(id=>({
    id, label:COURSE_PRESETS[id].label, raceLen:COURSE_PRESETS[id].raceLen,
    /* ゲート待機と結果発表を除いた走破時間[秒]。おおよその尺の目安になる */
    raceSec: COURSE_PRESETS[id].raceLen/COURSE_PRESETS[id].speed,
    note: COURSE_PRESETS[id].note,
  })),
  FPS,

  /* 馬のCGモデル(約3.5MB)を読み込んで描画を始める。
     読めなかった場合も throw せず、積み木の馬(BlockHorse)で続行して
     {fallback:true, reason} を返す。file:// では fetch がCORSで弾かれる */
  async init(opts){
    opts=opts||{};
    if(inited) return {fallback:!HORSE.ready};
    inited=true;
    setAssetsBase(opts.assetsBase);
    viewport=opts.viewport;
    if(!viewport) throw new Error("[real3d] init には viewport が必要です");
    viewport.appendChild(stage);
    let result={fallback:false};
    try{
      await loadHorseAsset();
    }catch(e){
      console.error("[real3d] 馬モデルを読み込めなかった:", e);
      result={fallback:true, reason:(await diagnoseAssets())+"\n\n"+(e.message||e)};
    }
    // 透かしは data URI なので即座に解決する。1フレーム目から乗るよう先に作っておく
    await loadWatermark();
    resizeBound=()=>resize();
    addEventListener("resize",resizeBound);
    resize();
    tick();
    emit("ready",result);
    return result;
  },

  /* 出走馬とレース設定を渡してレースを組み直す。
     input の形は applySettings() のコメントを参照 */
  applyConfig(input){ applySettings(input); },

  /* 毛色だけの差し替え。展開にも尺にも影響しないので、レースは組み直さず
     馬の見た目と結果発表の板だけを作り直す(再生位置は動かない)。
     colors は "#rrggbb" の配列、coatMode は "real"(4毛色に丸める) か "color"(着色) */
  setCoats(o){
    if(!cfg || !o) return;
    if(Array.isArray(o.colors))
      o.colors.slice(0,cfg.n).forEach((hex,i)=>{
        cfg.colors[i]=parseInt(String(hex).slice(1),16)||0;
      });
    if(o.coatMode) cfg.coatMode = o.coatMode==="color" ? "color" : "real";
    rebuildHorseActors();
    buildResultsBoard();   // 板にも勝負服色が出ているので合わせて描き直す
    renderFrame();
  },

  /* 見せ方だけの変更。レースは組み直さないので再生位置も動かない */
  setView(v){
    v=v||{};
    const aspectChanged=(v.aspect!=null && v.aspect!==view.aspect);
    if(v.aspect!=null && ASPECTS[v.aspect]) view.aspect=v.aspect;
    if(v.showMap!=null)   view.showMap=!!v.showMap;
    if(v.showField!=null) view.showField=!!v.showField;
    if(v.showMark!=null)  view.showMark=!!v.showMark;
    if(aspectChanged) resize();
    else if(cfg) renderFrame();
  },

  play(){
    if(!cfg) return;
    if(frame>=totalFrames) frame=0;
    playing=true; startClock(); emit("playing",true);
  },
  pause(){ if(playing){ playing=false; emit("playing",false); } },
  toggle(){ playing ? this.pause() : this.play(); },
  restart(){ this.pause(); frame=0; if(cfg) renderFrame(); },
  /* シークは常に一時停止してから。再生中に飛ばすと壁時計の基準がずれる */
  seekFrame(f){
    if(!cfg) return;
    this.pause();
    frame=clamp(Math.round(f),0,totalFrames);
    renderFrame();
  },
  seekSec(s){ this.seekFrame(s*FPS); },

  state(){ return {frame, totalFrames, duration:totalFrames/FPS, playing, ready:!!cfg}; },
  courseInfo: courseInfoText,
  canvas(){ return renderer.domElement; },
  resize,

  /* 録画の前後で呼ぶ。書き出し中だけ描画解像度を固定値へ上げる。
     setSize の第3引数を false にしてCSS寸法は据え置くので、
     画面上の見た目は変わらないまま、captureStream に流れる絵だけが高精細になる。
     カメラは比率しか見ていないので、構図もカット割りも一切変わらない */
  setExportMode(on){
    if(on===exporting) return this.canvas();
    exporting=!!on;
    if(exporting){
      const [w,h]=EXPORT_SIZES[view.aspect]||EXPORT_SIZES["16:9"];
      renderer.setPixelRatio(1);
      renderer.setSize(w,h,false);
      cam.aspect=currentAspect(); cam.updateProjectionMatrix();
      if(cfg) renderFrame();
    }else{
      resize();
    }
    return this.canvas();
  },

  on(name,fn){ (listeners[name]||(listeners[name]=[])).push(fn); },
  off(name,fn){
    const a=listeners[name]; if(!a) return;
    const i=a.indexOf(fn); if(i>=0) a.splice(i,1);
  },

  /* ツールを切り替えても描画ループとGPUリソースを残さない。
     戻ってきたら init() からやり直す */
  dispose(){
    playing=false;
    if(rafId) cancelAnimationFrame(rafId);
    rafId=0;
    if(resizeBound) removeEventListener("resize",resizeBound);
    for(const h of horses) h.dispose(scene);
    horses=[];
    renderer.dispose();
    if(stage.parentNode) stage.parentNode.removeChild(stage);
    viewport=null; cfg=null; inited=false;
    for(const k in listeners) listeners[k].length=0;
  },
};
})(window);
