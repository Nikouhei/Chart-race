/*
 * 全ツール共通の英語辞書
 *   ・shared/ の共通部品（動画書き出し・購入案内・アンケート・前回の続き・アプリ内ブラウザ案内など）
 *   ・時間の表記など、どのツールでも出る短い文言
 * 鍵は画面に出る日本語そのもの（空白の違いは無視）。各ツール固有の文言は shared/i18n/en/<名前>.js へ。
 */
I18N.register('en', {
  'tool.barChartRace.label': 'Bar Chart Race',
  'tool.lineChartRace.label': 'Line Chart Race',
  'tool.pieChartRace.label': 'Pie Chart Race',
});

I18N.registerText('en', {
  // ── 共通の短い文言 ──
  'GraphRace Studio ロゴ': 'GraphRace Studio logo',
  '閉じる': 'Close',
  'キャンセル': 'Cancel',
  'はい': 'Yes',
  'いいえ': 'No',
  'その他': 'Other',
  '＋': '+',
  '－': '–',
  '・': ' · ',
  '有料': 'Pro',
  'ファイルを選択': 'Choose file',
  '選択されていません': 'No file chosen',

  // ── 前回の続き（shared/registry.js）──
  '前回の続きが残っています。': 'You have unsaved work from last time.',
  '復元': 'Restore',
  '破棄': 'Discard',
  '前回の続き': 'Last session',
  '引き継いだデータ': 'Carried-over data',

  // ── 無断複製の案内（shared/origin-guard.js）──
  'このページは GraphRace Studio の無断複製です。公式サイトはこちら →': 'This page is an unauthorized copy of GraphRace Studio. Official site →',

  // ── 動画書き出し（shared/video-export.js）──
  '動画を書き出す': 'Export video',
  '動画を書き出す（MP4 / WebM）': 'Export video (MP4 / WebM)',
  'このブラウザは動画の書き出しに対応していません。': 'This browser can’t export video.',
  'パソコンの': 'Please try the latest',
  'Chrome / Edge の最新版': 'Chrome or Edge on a computer',
  'でお試しください（Safari は 16.4 以降で MP4 のみ対応）。': '(Safari 16.4+ supports MP4 only).',
  '形式': 'Format',
  'おすすめ': 'Recommended',
  'PC向け': 'For PC',
  'WebM はスマホで再生できないことがあります。': 'WebM may not play on phones.',
  '透かし': 'Watermark',
  'あり': 'On',
  'なし': 'Off',
  'β版特典': 'Free during beta',
  '画質': 'Quality',
  '標準': 'Standard',
  '高画質': 'High',
  '最高画質': 'Best',
  'なめらかさ': 'Frame rate',
  '30fps（標準）': '30 fps (standard)',
  '60fps（なめらか・ファイル大）': '60 fps (smoother, larger file)',
  '最後に止める': 'Hold last frame',
  '止めない': 'None',
  '書き出す': 'Export',
  '準備しています…': 'Preparing…',
  '書き出し中はこの画面を閉じないでください。別のタブに移っても続きます。': 'Keep this window open while exporting. It continues if you switch tabs.',
  '中止': 'Stop',
  '書き出しを中止しました。': 'Export stopped.',
  '設定に戻る': 'Back to settings',
  '書き出しが完了しました': 'Export complete',
  'もう一度保存': 'Save again',
  'ライブラリを読み込めませんでした': 'Couldn’t load a required library',
  'プレビューが画面に表示されていないため書き出せません': 'Can’t export because the preview isn’t visible on screen',
  'このブラウザでは MP4 を書き出せません': 'This browser can’t export MP4',
  'このブラウザでは WebM を書き出せません': 'This browser can’t export WebM',
  'このブラウザでは、この画質の MP4 を書き出せません。WebM を選ぶか、画質を下げてください。': 'This browser can’t export MP4 at this quality. Choose WebM or a lower quality.',
  'このブラウザでは、この画質の WebM を書き出せません。MP4 を選ぶか、画質を下げてください。': 'This browser can’t export WebM at this quality. Choose MP4 or a lower quality.',

  // ── 書き出し後の案内・アプリ内ブラウザ（shared/export-cta.js）──
  '動画を保存': 'Save video',
  'このまま動画にして保存できます': 'Save this as a video',
  'いまのプレビューをそのまま MP4 の動画ファイルにします。画面録画は要りません。': 'Turns the current preview into an MP4 file. No screen recording needed.',
  'この動画を保存': 'Save this video',
  'Safari・Chromeで開き直す': 'Open in Safari or Chrome',
  '右上の「…」メニューから「ブラウザで開く」を選んでください。': 'Tap the “…” menu at the top right and choose “Open in browser”.',
  'SafariやChromeで開いてからお使いください。': 'Please open this page in Safari or Chrome.',
  '（開き直すと、ここで入力した内容は引き継がれません）': '(Anything you entered here won’t carry over.)',

  // ── 購入案内・ライセンス（shared/export-plan.js）──
  '¥1,980（買い切り）': '¥1,980 (one-time)',
  'この機能': 'This feature',
  '透かしなし': 'No watermark',
  '透かしなし・最高画質の書き出しが、バーチャートレース・線グラフレース・競馬風ランキングの全ツールで使えます。': 'Export without a watermark and in the best quality across all tools: Bar Chart Race, Line Chart Race and Horse Race Ranking.',
  '購入ページへ': 'Buy now',
  'ライセンスキーをお持ちの方': 'I have a license key',
  '有効にする': 'Activate',
  '確認中…': 'Checking…',
  '有効になりました': 'Activated',
  'ライセンスキーを入力してください': 'Enter your license key',
  'ライセンスの販売はまだ始まっていません': 'Licenses aren’t on sale yet',
  'このライセンスキーは使えません': 'This license key isn’t valid',
  '通信に失敗しました。時間をおいて試してください': 'Connection failed. Please try again later.',

  // ── 書き出し中のアンケート（shared/export-plan.js）──
  '書き出しを待つあいだに、30秒アンケートにご協力ください': 'While you wait: a 30-second survey',
  '今後の機能と料金の参考にします。答えなくても書き出しは止まりません。': 'It helps us plan features and pricing. Your export keeps running either way.',
  '何に使う動画ですか？（いくつでも）': 'What is this video for? (select all that apply)',
  'YouTube（通常の動画）': 'YouTube (regular videos)',
  'ショート・リール・TikTok': 'Shorts / Reels / TikTok',
  'X（旧Twitter）': 'X (Twitter)',
  '仕事の資料・プレゼン': 'Work / presentations',
  '授業・教材': 'Teaching / class materials',
  'ブログ・Web記事': 'Blog / web articles',
  '個人で楽しむ': 'Just for fun',
  'あったら嬉しいものは？（3つまで）': 'What would you like to see? (up to 3)',
  'フルHD・4Kの高画質': 'Full HD / 4K quality',
  'BGM・効果音': 'Music / sound effects',
  'デザインのテンプレート': 'Design templates',
  '人口・GDPなどのデータ収録': 'Built-in datasets (population, GDP, etc.)',
  '縦向きの棒グラフ': 'Vertical bar charts',
  '長い動画（数分以上）': 'Longer videos (several minutes+)',
  '透かしを消して高画質で書き出せる有料版があったら、いちばん近いのは？': 'If there were a paid version with no watermark and higher quality, which fits you best?',
  '買い切り（約2,000円）なら買いたい': 'I’d buy a one-time license (about $15)',
  '必要なときだけ使える短期パス（数百円）がいい': 'I’d prefer a short pass when I need it (a few dollars)',
  '月額でも使いたい': 'I’d pay monthly',
  '無料版で十分': 'The free version is enough',
  'ほかにご意見があれば（任意・100文字まで）': 'Anything else? (optional, up to 100 characters)',
  '例）縦向きの棒グラフがほしい': 'e.g. I want vertical bar charts',
  '今回はスキップ': 'Skip',
  '送信する': 'Send',
  'ご協力ありがとうございました！': 'Thank you!',
  '書き出しを待つあいだに、2問だけ教えてください': 'While you wait: just 2 quick questions',
  '何に使う動画ですか？': 'What is this video for?',
  '忘年会・社内イベント': 'Office party / company event',
  '結婚式・パーティー': 'Wedding / party',
  '学校・子ども会': 'School / kids’ event',
  'YouTube・SNS': 'YouTube / social media',
  '欲しい機能は？（いくつでも）': 'Features you’d like (select all that apply)',
  'BGM・実況の音声': 'Music / commentary audio',
  'フルHDの高画質': 'Full HD quality',
  '3Dの馬に画像追加': 'Images on the 3D horses',
  '結果発表の演出を増やす': 'More results-announcement effects',
});

I18N.registerPatterns('en', [
  // 時間（「1分05秒」「12秒」）
  [/^(\d+)分(\d+)秒$/, '$1m $2s'],
  [/^(\d+)秒$/, '$1s'],
  [/^(\d+)分$/, '$1 min'],
  [/^約(.+)$/, 'about $1'],
  // 前回の続き
  [/^前回の続き（(.+)）が残っています。$/, 'You have unsaved work from last time ($1).'],
  // 書き出しダイアログ
  [/^(.+?)（(\d+×\d+)）・有料$/, '$1 ($2) · Pro'],
  [/^(.+?)（(\d+×\d+)）$/, '$1 ($2)'],
  [/^([\d.]+)倍$/, '$1×'],
  [/^長さ 約(.+?)・(\d+×\d+)・(\d+)fps・推定 (.+?) 前後$/, 'Length about $1 · $2 · $3 fps · about $4'],
  [/^書き出し中… (\d+)%$/, 'Exporting… $1%'],
  [/^残り 約(.+)$/, 'About $1 left'],
  [/^書き出しに失敗しました：(.*)$/, 'Export failed: $1'],
  [/^(.+)（(.+?)・(\d+×\d+)）を保存しました。$/, 'Saved $1 ($2 · $3).'],
  [/^画像 (\d+) 件は、画像のあるサイトが読み出しを許可していないため動画に入れられませんでした。画像をアップロードするか、別の画像URLに替えてください。$/,
    '$1 image(s) couldn’t be included because their website doesn’t allow it. Upload the images or use different image URLs.'],
  // 購入案内
  [/^(.+)は有料ライセンスで使えます$/, '$1 is available with a paid license'],
  // アンケートの説明
  [/^(選んで送信するだけです。|タップするだけで送信されます。)答えなくても書き出しは止まりません。$/, function (m, a) {
    return (a === '選んで送信するだけです。' ? 'Just pick and send. ' : 'Just tap to send. ') + 'Your export keeps running either way.';
  }],
  // アプリ内ブラウザ
  [/^(.+)のアプリ内ブラウザでは、作った動画を保存できないことがあります。$/, 'Videos may not save in the $1 in-app browser.'],
]);
