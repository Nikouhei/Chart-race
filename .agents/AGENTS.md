# Rules
- エディタはAntigravity IDEを使用しています。

## SEO・パフォーマンスの最優先ルール
**※対象：SEOページ（トップページやaboutページなど）のみ。ツールページ（bar-chart-race, regular-chart等）には本ルールは適用不要です。**

上記のSEOページにおいて新規ページや画像の追加・改修を行う際は、必ず以下のSEOおよびCore Web Vitals対策を最優先で実施すること：
1. **画像のフォーマット**: 画像は必ず次世代フォーマット（WebP等）を使用する。
2. **遅延読み込み**: 画像には `<img loading="lazy" decoding="async">` を標準で付与する（ファーストビューを除く）。
3. **CLS（レイアウトシフト）対策**: `<img>` タグには必ず明示的な `width` と `height` を指定する。
4. **アクセシビリティ**: 適切な `alt` 属性を必ず設定する。

## 計測（GA4）ルール【必須・機能追加とセットで実装する】
ツールの新規追加、または既存ツールへの機能追加（ボタン・書き出し・読み込み・設定項目など、ユーザー操作が増える変更）を行うときは、**計測イベントの実装を同じ作業の中で必ず行う**。計測なしで完了扱いにしない。完了報告では、追加・変更したイベント名を明記する。

### 新しいツール・ページを追加するとき
1. `<head>` 先頭に既存ページと同じ gtag スニペット（本番ドメインのみ config する版）と `<script src="(相対パス)shared/analytics.js?v=YYYYMMDD" defer></script>` を入れる（ブログ記事・LPも同様）。
2. `shared/analytics.js` の `TOOLS`（パス → tool_name）に追加する。LP とツールが1ページ同居なら `SINGLE_PAGE_TOOLS` にも追加。
3. 同じ対応表を `analytics/fetch-reports.mjs` の `TOOLS` / `SINGLE_PAGE_TOOLS` / `TOOL_LABEL` にも追加する。
4. 主要ボタンを意味のあるイベントに割り当てる（下記）。

### ボタン・機能を追加するとき
- 意味のある操作には `data-track="イベント名"` を付ける（任意で `data-track-xxx="値"` がパラメータになる）。既存IDのボタンなら `shared/analytics.js` の `SEMANTIC` に追加してもよい。
- イベント名の使い分け:
  - 再生・プレビュー開始 → `preview_start`
  - 書き出し・録画ボタン → `export_start`（`data-track-export-format="mp4"` など形式を付ける）
  - 透かしなし書き出し・購入・ライセンス入力 → `upgrade_click` / `license_activate`
  - アンケート送信 → `survey_submit`
  - 新しい種類の操作 → snake_case の新しいイベント名（GA4 の上限があるので乱造しない。似た操作は既存名＋パラメータで区別）
- `<a download>` や `a.click()` による保存は自動で `export_complete` / `file_save` になるので、保存処理側に計測コードは不要。`showSaveFilePicker` など別の保存方法を使う場合は、保存成功時に `window.grsTrack('export_complete', { file_ext, file_kind })` を呼ぶ。
- `<input type="file">` の読み込みは自動で `file_import` になる。
- 新しいパラメータを追加したら `analytics/fetch-reports.mjs` の `CUSTOM_DIMENSIONS` に追記し、`node analytics/fetch-reports.mjs --setup-dimensions` の実行をユーザーに案内する。

### 共通
- `shared/analytics.js` を変更したら、全ページの `?v=` を更新する（/shared/* は1年キャッシュのため）。
- 動作確認: localhost で開くと送信せず console に `[grs-analytics] イベント名 {...}` が出るので、追加したイベントが出ることを確認する。
- 詳細は analytics/README.md。
