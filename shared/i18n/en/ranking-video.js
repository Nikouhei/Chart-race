/*
 * ランキング動画メーカー（ranking-video-maker）の英語辞書
 * 英語表示のサンプル（GRS_RANKING_SAMPLE）もここに置く。画像は日本語版と同じものを使う。
 */
window.GRS_RANKING_SAMPLE = [
  { name: 'Shinichi', desc: 'A classic bowl with a double soup of chicken and dried sardines. There’s a line from 7 a.m.', img: '../中華そば しんいち.jpeg' },
  { name: 'Kogane', desc: 'Famous for rich pork-and-seafood tsukemen with extra-thick house-made noodles.', img: '../麺屋 こがね.jpeg' },
  { name: 'Tomoshibi', desc: 'The finest light shio ramen: a clear clam broth with hand-rolled thin noodles.', img: '../らぁめん 灯火.jpeg' },
  { name: 'Yukiguni', desc: 'An aged soup blended from three kinds of miso. The seared chashu is a must.', img: '../味噌屋 雪國.jpeg' },
  { name: 'Goriki-ya', desc: 'Iekei style with plenty of chicken oil. Add spinach and nori, like the regulars.', img: '../家系 剛力家.jpeg' },
];

I18N.registerText('en', {
  'ランキング動画メーカー｜GraphRace Studio': 'Ranking Video Maker | GraphRace Studio',
  'ランキング動画メーカー': 'Ranking Video Maker',
  '設定': 'Settings',
  'プレビュー': 'Preview',
  // タイトル
  'タイトル': 'Title',
  'タイトル（動画の冒頭に表示）': 'Title (shown at the start)',
  '例：好きなラーメンランキングTOP5': 'e.g. Top 5 Ramen Shops',
  '好きなラーメンランキングTOP5': 'Top 5 Ramen Shops',
  'サブタイトル（任意）': 'Subtitle (optional)',
  '例：2026年版・独断と偏見': 'e.g. 2026 edition, totally biased',
  // 項目
  'ランキング項目': 'Ranking items',
  '項目を追加': 'Add item',
  '上の行が1位。📷から画像をアップロード（自動で縮小されます）': 'The top row is #1. Upload an image with 📷 (resized automatically).',
  '登場順': 'Reveal order',
  '最下位から': 'From last place',
  '1位から': 'From #1',
  '名称': 'Name',
  '説明': 'Description',
  '画像を追加': 'Add image',
  '画像を変更': 'Change image',
  '画像を削除': 'Remove image',
  '上へ': 'Move up',
  '下へ': 'Move down',
  '削除': 'Delete',
  '画像の収め方': 'Image fit',
  '埋める': 'Fill',
  '収める': 'Fit',
  'この画像は読み込めませんでした。JPEG / PNG / WebP / GIF 形式の画像をお使いください（HEIC等はブラウザで表示できない場合があります）。':
    'This image couldn’t be loaded. Please use JPEG, PNG, WebP or GIF (HEIC may not display in browsers).',
  // キャンバス
  'キャンバス': 'Canvas',
  'アスペクト比': 'Aspect ratio',
  '16:9（横）': '16:9 (landscape)',
  '9:16（縦）': '9:16 (vertical)',
  'サイズ (幅 × 高さ px)': 'Size (W × H px)',
  '背景': 'Background',
  'ダーク': 'Dark',
  'ライト': 'Light',
  'ソフト': 'Soft',
  'アクセント': 'Accent',
  // デザイン
  'デザイン': 'Design',
  'ブルー': 'Blue', 'パープル': 'Purple', 'ティール': 'Teal', 'コーラル': 'Coral', 'ピンク': 'Pink',
  'レッド': 'Red', 'アンバー': 'Amber', 'グリーン': 'Green', 'ネイビー': 'Navy', 'スレート': 'Slate',
  'フォント': 'Font',
  'ゴシック': 'Sans-serif',
  '丸ゴシック': 'Rounded',
  'ポップ': 'Pop',
  '手書き風': 'Handwritten',
  '明朝': 'Serif',
  '等幅': 'Monospace',
  '角丸': 'Rounded corners',
  '角なし': 'Square corners',
  '標準': 'Standard',
  '丸め': 'Round',
  '文字サイズ': 'Text size',
  '順位': 'Rank',
  // 再生
  '再生位置': 'Playback position',
  '再生': 'Play',
  '一時停止': 'Pause',
  'リセット': 'Reset',
  '速度': 'Speed',
  '動画として保存する場合は、再生中の画面をOSの画面録画機能（macOS: Shift+Cmd+5 / Windows: Win+G など）でキャプチャしてください。':
    'To save a video, record the screen while it plays with your OS screen recorder (macOS: Shift+Cmd+5 / Windows: Win+G).',
});

I18N.registerPatterns('en', [
  [/^第(\d+)位$/, '#$1'],
  [/^(\d+)位$/, '#$1'],
  [/^項目は最大(\d+)件までです$/, 'You can add up to $1 items'],
]);
