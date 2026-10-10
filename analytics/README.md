# analytics — GA4 / Search Console 自動取得

Google 公式の無料API（GA4 Data API・Search Console API）を直接呼び出し、
`analytics/data/` に CSV と分析レポート（`report.md`）を保存する。依存パッケージなし（Node 18 以上）。

```bash
cd ~/Desktop/Chart-Tool
node analytics/fetch-reports.mjs            # 直近28日
node analytics/fetch-reports.mjs --days 7   # 直近7日
```

- `analytics/data/latest/report.md` … ツール別ファネル・判断ラインとの照合・伸びしろクエリなど
- `analytics/data/latest/*.csv` … 生データ（ga4_* / gsc_*）
- `analytics/data/YYYY-MM-DD/` … 実行日ごとのスナップショット

`analytics/` はデプロイ対象外（.assetsignore / build.js で除外）、`analytics/data/` は git 管理外。ログイン情報・クライアントJSONはリポジトリ外の `~/.config/graphrace-studio/` に置く。

---

## 初回セットアップ（10分・すべて無料）

自分の Google アカウントで1回ログインして許可する方式（OAuth）。
GA4・Search Console を普段見ているアカウントでログインすれば、権限の追加は不要。
同じログインで WordPress ブログ側のデータも取れる。

> サービスアカウントの鍵は、組織ポリシー（iam.disableServiceAccountKeyCreation）で作成が禁止されているため使わない。

### 1. Google Cloud の準備（プロジェクト `graphrace-analytics`）

1. 次の3つの API を有効にする（各リンクで「有効にする」）
   - https://console.cloud.google.com/apis/library/analyticsdata.googleapis.com
   - https://console.cloud.google.com/apis/library/analyticsadmin.googleapis.com
   - https://console.cloud.google.com/apis/library/searchconsole.googleapis.com
2. OAuth 同意画面を作る: https://console.cloud.google.com/auth/overview
   - 「開始」→ アプリ名 `analytics-reporter`、サポートメールは自分 → 対象「**外部**」→ 連絡先メール → 作成
3. **アプリを公開する**: https://console.cloud.google.com/auth/audience
   - 「アプリを公開」→ 確認。「テスト」のままだとログインが7日で切れるため
   - （審査は不要。自分しか使わないので「未確認のアプリ」の警告が出るだけ）
4. OAuth クライアントを作る: https://console.cloud.google.com/auth/clients/create
   - アプリケーションの種類「**デスクトップ アプリ**」、名前 `analytics-reporter` → 作成
   - 表示されたダイアログの「JSON をダウンロード」
5. ダウンロードした JSON を所定の場所に置く（ターミナル）

```bash
mkdir -p ~/.config/graphrace-studio
mv ~/Downloads/client_secret_*.json ~/.config/graphrace-studio/oauth-client.json
chmod 600 ~/.config/graphrace-studio/oauth-client.json
```

### 2. ログイン（初回だけ）

```bash
cd ~/Desktop/Chart-Tool
node analytics/fetch-reports.mjs --login
```

ブラウザが開くので、GA4 を管理している Google アカウントを選ぶ。
「Google はこのアプリを確認していません」と出たら「詳細」→「analytics-reporter（安全ではないページ）に移動」→
アクセス項目にすべてチェックして「続行」。ログイン情報は `~/.config/graphrace-studio/token.json` に保存される。

### 3. 接続確認とカスタムディメンション登録（初回だけ）

```bash
node analytics/fetch-reports.mjs --check              # プロパティとサイトが自動検出されればOK
node analytics/fetch-reports.mjs --setup-dimensions   # ボタンIDなどを GA4 の集計軸に登録
```

カスタムディメンションは登録した時点以降のデータにだけ効く（過去分には付かない）。反映まで最大24〜48時間。

---

## 計測しているイベント（shared/analytics.js）

| イベント | いつ送られるか |
|---|---|
| tool_open | ツール画面（/app/・単体ツールページ）を開いた |
| tool_engaged | ツール画面で最初に操作した（1表示につき1回） |
| tool_link_click | LP・ブログ・トップからツールへのリンクを押した |
| preview_start | 再生プレビュー／レース開始 |
| export_start | 書き出し・録画ボタン |
| export_complete | 動画・画像ファイルが実際に保存された |
| file_save / data_download | CSV・Excel・バックアップの保存 |
| file_import | CSV・Excel・画像の読み込み |
| project_save / project_backup / project_import | 保存・バックアップ |
| stock_fetch | 株価レースで株価を取得 |
| tool_ui_click | 上記以外のツール内ボタン（button_id / button_label 付き） |
| js_error | サイトのスクリプトエラー（1表示3件まで） |
| upgrade_click | 有料機能（透かしなし・MP4）を選んで購入案内が出た（有料化スイッチ ON のときだけ） plan_feature 付き |
| license_activate | ライセンスキーの確認（license_result = ok / invalid / error） |
| survey_view | 有料化アンケートを表示した（回答率の分母） |
| survey_submit | アンケートに回答（use_case / wanted_features / pay_model / survey_comment） |
| survey_dismiss | アンケートをスキップした |

バーチャート・線グラフの動画書き出し（`shared/video-export.js`）では、ダイアログの「書き出す」で
`export_start` に `export_format`（webm/mp4）・`watermark`（on/off）・`export_scale`・`export_fps` が付く。
有料化スイッチ（`shared/export-plan.js` の `paywallEnabled`）が OFF の間は、`watermark=off` と
`export_format=mp4` の件数が「有料でも欲しい人」の目安になる。

今後「透かしなしで書き出す」ボタンなどを足すときは、HTML に `data-track` を付けるだけで計測される:

```html
<button data-track="upgrade_click" data-track-plan="lifetime">透かしなしで書き出す</button>
```

JS から送る場合は `window.grsTrack('survey_submit', { price: '1980' })`。

本番（graphrace-studio.com）以外では送信されず、ブラウザのコンソールに `[grs-analytics]` として出るだけ。
本番で GA4 の DebugView に流して確認したいときは、URL に `?grs_debug=1` を付けて開く（`?grs_debug=0` で解除）。

## 設定を固定したいとき

自動検出がうまくいかない場合は `analytics/config.json` を作る:

```json
{ "propertyId": "123456789", "siteUrl": "sc-domain:graphrace-studio.com" }
```
