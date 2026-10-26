# Rules
- エディタはAntigravity IDEを使用しています。

## Git・公開に関するルール【必須】
- **コミット・pushは、ユーザーから明示的な指示があるまで行わない。** 修正が終わったら変更内容を報告し、指示を待つ。
- **株価レース（`stock-race/` 配下、`stock_race_*` 関連）は、ユーザーの指示があるまで絶対に公開しない。**
  - `stock-race/` をコミット・pushしない（git 管理に入れない）。
  - `.assetsignore` の `stock-race/` 除外を外さない。
  - メインサイト（トップ・LP・ブログ・sitemap.xml など）から株価レースへのリンクを張らない。
  - `build/build.js` の株価レース再生成処理もコミットしない。
  - `stock-race/` は `build/legacy-files.mjs` でも配信対象から外しており、`dist/` に入るとビルドが失敗するようにしてある。この除外も外さない。

## サイト構成と多言語化（2026-10 から Astro へ段階移行中）
- **SEOページ（トップ・LP・ブログ・法務）は Astro（`src/pages/`）へ1ページずつ移している。** 移行済みのページは `src/pages/` 側を編集する（直下の同名HTMLは使われない。ビルド時に「Astro 版を優先」と表示される）。
  - 移行済み: トップ（`src/pages/index.astro`）、ツールLP6つ（`src/pages/bar-chart-race/` `regular-chart/` `pie-chart-race/` `tournament-bracket-animator/` `ranking-video-maker/` `horse-race-ranking-maker/` の `index.astro`）、法務（`src/pages/about.astro` `terms.astro` `privacy.astro`）。旧 HTML は削除済み
  - 未移行: ブログ、あみだくじ（どちらも英語版は作らない）
  - 英語の法務ページ（`src/pages/en/about.astro` など）は日本語版の英訳。日本語版を変えたら英語版もそろえる
  - **`.astro` のページを直すときの注意**: `<script>`・`<style>` には必ず `is:inline` を付ける（付けないと Astro が書き換えて動きが変わる）。本文（タグの外）に `{` `}` をそのまま書かない（Astro の式として扱われる。必要なら `{'{'}` のように書く）。中の相対パスは使わず `/shared/...` のような絶対パスで書く。
  - 英語版を作らないもの: ブログ、あみだくじ（2026-10 決定）
- まだ移していない既存HTML・ツール画面（`/xxx/app/`）・画像は直下のまま。ビルド時に `build/postbuild.mjs` が `dist/` にコピーする。除外ルールは `.assetsignore` と `build/legacy-files.mjs`。
- **開発中（未公開）のツール**は `build/legacy-files.mjs` の `DRAFT_DIRS` に入れ、`shared/registry.js` では `draft: true` を付ける。本番（main）のビルドには入らず、preview ブランチ・`npm run build:preview`・`npm run dev` でだけ見られる。いま該当: なし（円グラフレースは 2026-10 に公開済み）。公開するときは両方から外す。
- ビルド: `npm run build`（= `astro build` ＋ `build/postbuild.mjs`）。配信するのは `dist/`。下書きも見たいときは `npm run build:preview`、開発中は `npm run dev`。
- URL: 日本語はルートのまま、英語は `/en/`（他の言語も `/xx/`）。ブラウザ言語やIPでの自動リダイレクトはしない。
- **言語ごとのURLの対応関係は `src/i18n/routes.mjs` に書く。** hreflang・canonical・言語切替・sitemap はここから自動で作られる。
  - 英語版を作ったら `paths` に `en` を足し、確認が済むまで `drafts: ['en']` にしておく（本番ビルドでは出力されない。preview ブランチでは noindex で出る）。
  - 新しい言語は `src/i18n/config.mjs` と `src/i18n/ui.mjs`、`shared/i18n.js` の `SUPPORTED` に足す。
- **ヘッダーのメニュー**（PC はメガメニュー、スマホはハンバーガー）は `src/i18n/routes.mjs` の `NAV_CATEGORIES` / `NAV_TOOLS` から作る。新しいツールは `PAGES` と `NAV_TOOLS` に1行ずつ足し、ツール名・一行説明を `ui.mjs` に日英で足す。部品は `src/components/SiteHeader.astro`、見た目は `src/styles/gnav.css`。未移行の既存HTML（ブログ・あみだくじ）のヘッダーはビルド時に `build/postbuild.mjs` が同じものに置き換える（直下のHTMLのヘッダーを手で直す必要はない）。GA4: メニューを開くと `nav_menu_open`。
- ヘッダー・フッター・言語切替などの共通文言は `src/i18n/ui.mjs`。ページ本文は辞書にせず、言語ごとのページファイルに直接書く（英語版は翻訳ではなく英語圏の検索意図に合わせて書く）。
- `sitemap.xml` はビルド時に自動生成（直下の `sitemap.xml` と `generate-sitemap.js` は旧方式で、もう使っていない）。
- **ツール画面（`/xxx/app/`）は URL を言語で分けず、`?lang=en` で表示を切り替える**（`shared/i18n.js`）。
  - 文言は HTML・JS に日本語のまま書く。英語は「日本語の文言 → 英語」の文言辞書で自動的に置き換わる（画面の文字・placeholder・title・aria-label・後から JS で入る文字・alert/confirm/prompt）。
  - 辞書: `shared/i18n/en/common.js`（共通部品：書き出し・購入案内・アンケート等）、`shared/i18n/en/chart-race.js`（バーチャート・線グラフ・円グラフの画面）。ツールごとに増やす。
  - 読み込み: `<script src=".../shared/i18n.js?v=..." data-i18n-bundles="common,chart-race">`（日本語表示のときは辞書を読み込まない）。
  - **日本語の文言を変えたり足したりしたら、英語辞書にも同じ文言を足す。** 数字などが入る文は `registerPatterns` に正規表現で書く。直し忘れても日本語のまま出るだけで壊れない。localhost で `?lang=en` を開くと、訳のない日本語が console に `[i18n] 訳がない文言` として出る。
  - グラフ・表の中身などユーザーのデータは訳さない（`I18N.skip('#chartArea, ...')`）。グラフ内にツールが自分で描く文字（例: 順位「1位」）は `I18N.translate('1位')` を通す。
  - CSS の `content` で出す文字は CSS 変数にして、辞書ファイルで差し替える。
  - 英語表示のサンプルデータは `samples/sample-en.json`（`?sample=1&lang=en`）。
  - **格付けダービーの英語版（`/en/horse-race-ranking-maker/`）は、LP の文章だけ `src/pages/en/horse-race-ranking-maker/index.astro` に英語で書き、ツール部分（見た目・設定パネル・スクリプト）はビルドのたびに日本語版 `src/pages/horse-race-ranking-maker/index.astro` から自動で取り出す**（`build/legacy-tool.mjs`）。ツールを直すときは日本語版だけ直し、新しい日本語の文言は `shared/i18n/en/horse-race.js` に足す（訳がないとビルド時に `[i18n] … 訳がない文言` と出る）。キャンバスに描く文字は `_t()` を通す。
  - 英語LPからツールへのリンクには必ず `?lang=en` を付ける。ツール間の移動では自動で引き継ぐ（`shared/registry.js`）。
- 課金判定は言語に依存させない（プラン表は全言語共通）。
- GA4: 全イベントと page_view に `site_language`（表示言語）が付く。言語切替ボタンは `language_switch`（パラメータなし。2言語なので行き先はページの言語から分かる）。
- `shared/` 以下のファイルを変えたら、読み込んでいる全ページの `?v=` を更新する（1年キャッシュのため）。

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

## 確認用プレビュー（previewブランチ）のルール
- 確認用のブランチは **`preview` の1本だけ** を使う。機能ごとに `preview/xxx` のようなブランチは作らない。
- 確認URLは常に https://preview-chartrace.kohei-coffee-cake.workers.dev/ （Cloudflare Workers Builds のプレビュー。`noindex` ヘッダー付きで配信される）。
- 確認したい変更ができたら「最新の main ＋ その変更」で `preview` を上書きして push する（preview は確認専用なので強制上書きしてよい。大事な変更を preview にだけ置かない）。
- ユーザーが確認してOKを出したら main にコミット・push して公開する。
- robots.txt は本番と共用なので、プレビュー用に書き換えない（本番が検索されなくなる）。
