#!/usr/bin/env node
/**
 * GraphRace Studio - IndexNow URL 一括送信スクリプト
 *
 * 使い方:
 *   全ページ送信（sitemap.xmlから抽出）:
 *     node analytics/submit-indexnow.mjs
 *     npm run indexnow
 *
 *   特定URLのみ送信:
 *     node analytics/submit-indexnow.mjs https://graphrace-studio.com/bar-chart-race/
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

const HOST = "graphrace-studio.com";
const KEY = "97ed0c8df726b2d26ba752cd9f45f2d5";
const KEY_LOCATION = `https://${HOST}/${KEY}.txt`;
const INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow";

// sitemap.xml はビルド時に作られる（build/postbuild.mjs）。
// ローカルでビルド済みなら dist/sitemap.xml、無ければ（GitHub Actions など）公開中のものを読む。
async function extractUrlsFromSitemap() {
  const local = path.join(ROOT, "dist", "sitemap.xml");
  let content;
  if (fs.existsSync(local)) {
    content = fs.readFileSync(local, "utf-8");
  } else {
    // 公開中の sitemap を取りに行く（GitHub Actions ではビルド済みの dist を使うので通常ここは通らない）
    const res = await fetch(`https://${HOST}/sitemap.xml`, {
      cache: "no-store",
      headers: { "User-Agent": "Mozilla/5.0 (compatible; GraphRaceStudio-IndexNow/1.0)" },
    });
    if (!res.ok) throw new Error(`sitemap.xml を取得できませんでした（HTTP ${res.status}）`);
    content = await res.text();
  }
  const matches = [...content.matchAll(/<loc>([^<]+)<\/loc>/g)];
  return matches.map((m) => m[1].trim());
}

async function submitIndexNow(urls) {
  if (!urls || urls.length === 0) {
    console.log("送信対象のURLがありません。");
    return;
  }

  // 重複排除とホストチェック
  const validUrls = Array.from(new Set(urls)).filter((url) => {
    try {
      const u = new URL(url);
      return u.hostname === HOST || u.hostname === `www.${HOST}`;
    } catch {
      return false;
    }
  });

  if (validUrls.length === 0) {
    console.log(`有効な ${HOST} のURLがありません。`);
    return;
  }

  console.log(`IndexNow 送信開始: ${validUrls.length} 件のURL`);
  console.log(`エンドポイント: ${INDEXNOW_ENDPOINT}`);
  console.log(`ホスト: ${HOST}`);
  console.log(`キー場所: ${KEY_LOCATION}`);

  const payload = {
    host: HOST,
    key: KEY,
    keyLocation: KEY_LOCATION,
    urlList: validUrls,
  };

  try {
    const res = await fetch(INDEXNOW_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify(payload),
    });

    const status = res.status;
    const bodyText = await res.text();

    if (status === 200) {
      console.log("送信成功 (HTTP 200: OK)");
      console.log("検索エンジン（Bing、Yandex等）への通知が完了しました。");
    } else if (status === 202) {
      console.log("送信完了 (HTTP 202: Accepted)");
      console.log("リクエストは受理されました。キー検証後に反映されます。");
    } else if (status === 400) {
      console.error(`エラー (HTTP 400: Bad Request) - リクエスト形式が不正です。: ${bodyText}`);
    } else if (status === 403) {
      console.error(`エラー (HTTP 403: Forbidden) - キーファイルが未公開またはキーが無効です。`);
      console.error(`公開URL (${KEY_LOCATION}) が正しくアクセス可能か確認してください。`);
    } else if (status === 422) {
      console.error(`エラー (HTTP 422: Unprocessable Entity) - URLリストに無効なURLが含まれています。: ${bodyText}`);
    } else {
      console.log(`送信結果: HTTP ${status}`);
      if (bodyText) console.log(bodyText);
    }
    if (status !== 200 && status !== 202) process.exitCode = 1;
  } catch (err) {
    console.error(`IndexNow 送信中にエラーが発生しました: ${err.message}`);
    process.exitCode = 1;
  }
}

// 実行部
const args = process.argv.slice(2);
let targetUrls = [];

if (args.length > 0) {
  targetUrls = args;
} else {
  try {
    targetUrls = await extractUrlsFromSitemap();
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}

await submitIndexNow(targetUrls);
