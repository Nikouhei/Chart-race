/*
 * 格付けダービー（競馬風ランキング動画メーカー）の英語辞書
 *   ・設定パネルや状況表示は自動で置き換わる
 *   ・キャンバスに描く文字（実況テロップ・結果掲示板・着差・順位）はツール側で _t() を通して訳す
 *   ・英語版のページは /en/horse-race-ranking-maker/（ツール部分は日本語版からビルド時に自動で作る）
 */

// 英語表示の既定の馬名はツール側（horse-race-ranking-maker/index.html の DEFAULT_NAMES_EN）にある

I18N.registerText('en', {
  // ── ツールの見出し ──
  '格付け': 'Ranking ',
  'ダービー': 'Derby',
  '格付けダービー': 'Ranking Derby',
  'GraphRace Studio 格付けダービー': 'GraphRace Studio Ranking Derby',
  '順位を決めて、走らせるだけ。競馬中継風ランキング動画メーカー': 'Set the finishing order and hit start. A horse-race-style ranking video maker.',
  '実際の競馬場のような3Dコースを、CGの馬が走るランキング動画メーカー': 'A ranking video maker with CG horses racing on a realistic 3D track.',
  'ツールの切り替え': 'Switch mode',
  '競馬風': '2D Race',
  'リアル競馬風': '3D Real Race',

  // ── 動画設定 ──
  '動画設定': 'Video',
  '画面サイズ': 'Aspect ratio',
  '画面サイズについて': 'About aspect ratio',
  'YouTubeなど横長の動画向け': 'Landscape videos such as YouTube',
  '3:4・1:1': '3:4 / 1:1',
  'SNSのタイムライン投稿向け': 'Social media feed posts',
  'ショート・リールなど縦長向け': 'Vertical videos such as Shorts and Reels',
  '16:9 横長': '16:9 landscape',
  '3:4 縦長': '3:4 portrait',
  '9:16 縦長': '9:16 vertical',
  '1:1 正方形': '1:1 square',
  '実況テロップ': 'Commentary captions',
  '表示する': 'Show',
  '表示しない': 'Hide',
  '馬上アイコンの大きさ': 'Rider icon size',
  '馬上アイコンの大きさについて': 'About rider icon size',
  '馬の背に乗せた丸いアイコン画像の大きさです。': 'Size of the round icon image on each horse’s back.',
  '名前ラベルの大きさは変わりません。': 'Name labels stay the same size.',
  '再生タイムライン': 'Timeline',
  '▶ レース開始': '▶ Start race',
  '▶ 再開': '▶ Resume',
  '⏸ 一時停止': '⏸ Pause',
  'レースを動画ファイル（MP4 / WebM）にして保存します': 'Save the race as a video file (MP4 / WebM)',
  '⬇ 動画を保存（MP4 / WebM）': '⬇ Save video (MP4 / WebM)',

  // ── 出走馬 ──
  '出走馬(上から最終順位)': 'Horses (top = winner)',
  '出走馬の設定方法': 'How to set up horses',
  '⠿ ドラッグ': '⠿ Drag',
  '最終順位を入れ替えます': 'Change the finishing order',
  '数字': 'Number',
  '出走枠。画面のどこを走るかで、着順とは別に決められます': 'Post position — where the horse runs on screen, separate from the finishing order',
  '脚質': 'Running style',
  '大逃げ・逃げ・先行・差し・追込から選ぶ道中の位置取り。大逃げは2番手以下を大きく引き離します。自動なら抽選で決まり、大逃げは出ても1頭だけです':
    'Position during the race: runaway, leader, stalker, closer or deep closer. A runaway pulls far ahead of the pack. On Auto it’s drawn at random, with at most one runaway.',
  '頭数': 'Field size',
  '2〜16頭': '2–16 horses',
  '展開は毎回ランダムですが、必ずこの順位でゴールします。': 'The race plays out differently every time, but always finishes in this order.',
  '毛色': 'Coat',
  '毛色について': 'About coats',
  'リアル': 'Real',
  'カラー': 'Color',
  '鹿毛・芦毛・青鹿毛・青毛の4種から選びます': 'Choose from bay, gray, dark bay or black',
  '白い毛並みに馬体色を乗せるので、16頭すべて見分けられます。競馬風で決めた色がそのまま使われます': 'Tints a white coat with each horse’s color so all 16 are easy to tell apart. Uses the colors from 2D Race.',
  'どちらを選んでも、もう一方の設定は消えません。': 'Switching keeps the other setting.',
  '＋ 出走馬を追加': '+ Add horse',
  '設定は自動保存されます。': 'Settings are saved automatically.',
  '初期状態に戻す': 'Reset',
  '保存された設定を消して初期状態に戻します。よろしいですか？': 'This clears your saved settings and resets everything. Continue?',
  'ドラッグで最終順位を入れ替え': 'Drag to change the finishing order',
  'アイコン画像を設定': 'Set icon image',
  '馬体色': 'Horse color',
  '出走枠': 'Post position',
  '削除': 'Remove',
  '自動': 'Auto',
  '大逃げ': 'Runaway',
  '逃げ': 'Leader',
  '先行': 'Stalker',
  '差し': 'Closer',
  '追込': 'Deep closer',
  '鹿毛': 'Bay',
  '芦毛': 'Gray',
  '青鹿毛': 'Dark bay',
  '青毛': 'Black',
  'リアル（実在の毛色）': 'Real (natural coats)',
  'カラー（識別重視）': 'Color (easy to tell apart)',
  'ホース': 'Horse ',

  // ── レース設定 ──
  'レース設定': 'Race',
  'レース名': 'Race name',
  '第1回 ランキング杯': 'The 1st Ranking Cup',
  'ランキング杯': 'Ranking Cup',
  'レース時間': 'Race length',
  'ショート 約15秒': 'Short (~15s)',
  'スタンダード 約25秒': 'Standard (~25s)',
  'ロング 約40秒': 'Long (~40s)',
  'コース': 'Track',
  'コースについて': 'About tracks',
  'コースの距離で動画の長さが決まります。': 'The track distance sets the video length.',
  '下に出る1周の長さや直線の距離は、選んだコースの実測値です。': 'The lap and straight lengths shown below are the track’s actual measurements.',
  'ショート': 'Short',
  '小回り': 'Small track',
  '広い': 'Large track',
  '回り': 'Direction',
  '右回り': 'Clockwise',
  '左回り': 'Counterclockwise',
  '展開の派手さ': 'Race drama',
  '展開の派手さについて': 'About race drama',
  'おだやか': 'Calm',
  '順位どおりの順当な流れ': 'Runs mostly in finishing order',
  'ふつう': 'Normal',
  'ほどよく順位が入れ替わります': 'Positions change now and then',
  '波乱': 'Dramatic',
  '仕掛け合いが増え、道中の変動が大きくなります': 'More moves and bigger swings mid-race',
  '大波乱': 'Chaotic',
  '大逃げ・大まくり・失速、なんでもあり': 'Runaways, big late moves, collapses — anything goes',
  'どれを選んでも、ゴールの着順は設定どおりです。': 'Whatever you choose, horses finish in your order.',
  '展開': 'Race style',
  '展開について': 'About race style',
  '見せ場を作る仕掛けや叩き合いを入れて、直線でドラマが起きるようにします': 'Adds moves and duels so there’s drama down the stretch',
  '人工的な山を作らず、各馬が脚質どおりの役割を最後まで貫きます': 'No staged drama — each horse sticks to its running style to the end',
  'カウントダウン': 'Countdown',
  'カウントダウンについて': 'About the countdown',
  'スタート前に3秒のカウントダウンを入れます。': 'Adds a 3-second countdown before the start.',
  'なしにすると、いきなり走り出します。': 'Turn it off to start right away.',
  '展開シード': 'Race seed',
  '展開シードについて': 'About the race seed',
  '同じ着順のまま、道中の展開だけを変えたいときに数字を変えます。': 'Change the number to get a different race with the same finishing order.',
  '同じ数字なら、何度でも同じレースが再現されます。': 'The same number always replays the same race.',

  // ── 画面表示 ──
  '画面表示': 'Display',
  'コースマップ': 'Track map',
  '隊列パネル': 'Position panel',
  '透かし（ロゴ）': 'Watermark (logo)',
  '透かしについて': 'About the watermark',
  '画面を流れる「GraphRace Studio」のロゴです。': 'The “GraphRace Studio” logo that scrolls across the screen.',
  'いまは無料で消せますが、今後は有料プラン限定になる予定です。': 'You can remove it for free for now; later this will be a paid feature.',
  '表示した内容はそのまま動画にも記録されます。カメラワークは自動です。': 'Everything shown here is included in the video. Camera work is automatic.',

  // ── 結果発表 ──
  '結果発表設定': 'Results',
  '掲示板タイトル': 'Board title',
  '結果発表': 'Results',
  'アイコン画像': 'Icon images',
  '着差': 'Margin',
  '着差について': 'About margins',
  '1つ上の馬との差を、ハナ・クビ・1馬身のような競馬の表記で掲示板に出します。': 'Shows the gap to the horse ahead in racing terms like nose, neck or 1 length.',
  'リアル競馬風ではアイコン画像は使われません。設定は競馬風に戻すと残っています。': 'Icon images aren’t used in 3D Real Race. They’re still there when you switch back to 2D Race.',
  'ハナ': 'Nose',
  'アタマ': 'Head',
  'クビ': 'Neck',
  '1/2馬身': '½ length',
  '3/4馬身': '¾ length',
  '1馬身': '1 length',
  '1.1/2馬身': '1½ lengths',
  '2馬身': '2 lengths',
  '2.1/2馬身': '2½ lengths',
  '大差': 'Distance',

  // ── 3D の読み込み ──
  '3Dの馬を読み込んでいます…': 'Loading 3D horses…',
  '初回のみ約4MBを読み込みます。': 'The first time loads about 4 MB.',
  '2回目以降はキャッシュから開きます。': 'After that it opens from cache.',
  '3Dモデルを読み込めませんでした。簡易表示で続けます。': 'Couldn’t load the 3D models. Continuing in simple mode.',
  '3Dツールを読み込めませんでした。通信環境をご確認ください。': 'Couldn’t load the 3D tool. Please check your connection.',
  '3Dの読み込みが終わってから書き出してください。': 'Please wait for 3D to finish loading before exporting.',

  // ── 状況表示 ──
  '出走馬を設定して「レース開始」を押してください。': 'Set up your horses and press “Start race”.',
  '画面サイズを変更しました。「レース開始」を押してください。': 'Aspect ratio changed. Press “Start race”.',
  'ゴール！もう一度走らせると展開が変わります。': 'Finish! Run it again for a different race.',
  'ゴール！シードを変えると展開が変わります。': 'Finish! Change the seed for a different race.',
  '「レース開始」を押すと走り出します。': 'Press “Start race” to begin.',
  'レース中…設定した順位でゴールします。': 'Racing… horses will finish in your order.',
  '一時停止中。クリックで再開します。': 'Paused. Click to resume.',
  '出走馬は2頭以上必要です。': 'You need at least 2 horses.',
  '動画を書き出しています…': 'Exporting video…',
  '書き出しが終わりました。': 'Export finished.',

  // ── 実況テロップ（固定の文） ──
  'まもなくスタート!': 'They’re about to start!',
  '各馬一斉にスタート!': 'And they’re off!',
  'ゴール前!接戦だーッ!!': 'It’s neck and neck at the wire!!',
});

I18N.registerPatterns('en', [
  // 実況テロップ（馬名はそのまま差し込む）
  [/^先頭は(.+)!(.+)が続く!$/, '$1 takes the lead! $2 follows!', { raw: true }],
  [/^(.+)がレースを引っ張る展開!$/, '$1 is setting the pace!', { raw: true }],
  [/^第4コーナーを回った!先頭(.+)!$/, 'Around the final turn — $1 in front!', { raw: true }],
  [/^最後の直線!(.+)か!\?(.+)が迫る!$/, 'Down the stretch! Is it $1? $2 closing in!', { raw: true }],
  // 結果掲示板
  [/^(\d+)着$/, function (m, n) {
    n = +n;
    var suf = (n % 100 >= 11 && n % 100 <= 13) ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th');
    return n + suf;
  }],
  [/^(\d+)馬身$/, '$1 lengths'],
  [/^(\d+)番$/, 'Horse $1'],
  // 頭数
  [/^出走馬は(\d+)頭以上必要です$/, 'You need at least $1 horses'],
  [/^出走馬は(\d+)頭までです$/, 'Up to $1 horses'],
  [/^毛色: (.*)$/, 'Coat: $1'],
  // コース
  [/^(ショート|小回り|広い) (\d+)m・約(.+)$/, function (m, name, len, time) {
    return I18N.translate(name) + ' · ' + len + 'm · ~' + I18N.translate(time);
  }],
  [/^(\d+)分([\d.]+)秒$/, '$1m $2s'],
  [/^([\d.]+)秒$/, '$1s'],
  [/^1周(\d+)m・直線(\d+)m／(\d+)mを([\d.]+)周／動画の長さ (.+)$/, function (m, lap, st, len, laps, total) {
    return 'Lap ' + lap + 'm · straight ' + st + 'm / ' + len + 'm = ' + laps + ' laps / video length ' + I18N.translate(total);
  }],
  // 3D の読み込み
  [/^3Dエンジンを読み込んでいます… \((\d+)\/(\d+)\)$/, 'Loading the 3D engine… ($1/$2)'],
  [/^読み込みに失敗しました: (.*)$/, 'Failed to load: $1', { raw: true }],
]);
