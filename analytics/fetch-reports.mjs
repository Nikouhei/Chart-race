#!/usr/bin/env node
/*
 * GraphRace Studio — GA4 / Search Console 自動取得スクリプト（無料・依存パッケージなし）
 * ---------------------------------------------------------------------------
 * Google 公式の無料API（GA4 Data API / Search Console API）を直接呼び、
 * analytics/data/ に CSV と分析レポート（report.md）を書き出す。
 *
 * 認証は「自分の Google アカウントで1回ログイン（OAuth）」が基本。
 * サービスアカウントの鍵（~/.config/graphrace-studio/service-account.json）があればそちらを優先する。
 *
 *   node analytics/fetch-reports.mjs --login      # 初回だけ：ブラウザで Google にログインして許可
 *   node analytics/fetch-reports.mjs              # 直近28日
 *   node analytics/fetch-reports.mjs --days 7     # 直近7日
 *   node analytics/fetch-reports.mjs --check      # 接続確認だけ（プロパティ・サイトの自動検出結果を表示）
 *   node analytics/fetch-reports.mjs --setup-dimensions
 *                                                 # GA4 にカスタムディメンションを一括登録（要: 編集者権限）
 *
 * 出力:
 *   analytics/data/latest/   … 毎回上書きされる最新版（ここを見れば常に最新）
 *   analytics/data/YYYY-MM-DD/ … 実行日ごとのスナップショット（推移比較用）
 *
 * 設定は analytics/config.json（無ければ自動検出）。初回セットアップは analytics/README.md を参照。
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, cpSync, rmSync } from "node:fs";
import { createSign, createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { exec } from "node:child_process";
import { dirname, resolve, join } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(HERE, "data");

// ── 設定 ─────────────────────────────────────────────────────
const DEFAULTS = {
  // サービスアカウントの鍵。リポジトリの外に置く（誤コミット・誤デプロイ防止）
  keyFile: "~/.config/graphrace-studio/service-account.json",
  // OAuth（自分のアカウントでログイン）用。Google Cloud で作る「デスクトップアプリ」のクライアントJSON
  oauthClientFile: "~/.config/graphrace-studio/oauth-client.json",
  // --login で保存されるリフレッシュトークン
  tokenFile: "~/.config/graphrace-studio/token.json",
  // GA4 の測定ID。propertyId が空ならこのIDを持つプロパティを自動で探す
  measurementId: "G-NS736Y3MY9",
  propertyId: "",
  // Search Console のプロパティ。空なら graphrace-studio.com を含むものを自動で選ぶ
  siteUrl: "",
  siteDomain: "graphrace-studio.com",
};

function loadConfig() {
  const p = join(HERE, "config.json");
  const cfg = existsSync(p) ? { ...DEFAULTS, ...JSON.parse(readFileSync(p, "utf8")) } : { ...DEFAULTS };
  if (process.env.GRS_KEY_FILE) cfg.keyFile = process.env.GRS_KEY_FILE;
  for (const k of ["keyFile", "oauthClientFile", "tokenFile"]) cfg[k] = cfg[k].replace(/^~(?=\/|$)/, homedir());
  return cfg;
}

function parseArgs(argv) {
  const a = { days: 28, check: false, setupDimensions: false, login: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--days") a.days = Math.max(1, parseInt(argv[++i], 10) || 28);
    else if (argv[i] === "--check") a.check = true;
    else if (argv[i] === "--setup-dimensions") a.setupDimensions = true;
    else if (argv[i] === "--login") a.login = true;
  }
  return a;
}

// ── 認証（サービスアカウント JWT → アクセストークン）────────────────
const SCOPES_READ = [
  "https://www.googleapis.com/auth/analytics.readonly",
  "https://www.googleapis.com/auth/webmasters.readonly",
];
const SCOPE_EDIT = "https://www.googleapis.com/auth/analytics.edit";

function b64url(input) {
  return Buffer.from(input).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

async function getAccessToken(key, scopes) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(JSON.stringify({
    iss: key.client_email,
    scope: scopes.join(" "),
    aud: key.token_uri || "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  }));
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claim}`);
  const sig = signer.sign(key.private_key).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
  const res = await fetch(key.token_uri || "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${header}.${claim}.${sig}` }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`アクセストークン取得に失敗: ${JSON.stringify(json)}`);
  return json.access_token;
}

async function api(token, method, url, body) {
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  if (!res.ok) {
    const msg = json?.error?.message || text;
    const err = new Error(`${res.status} ${msg}`);
    err.status = res.status;
    throw err;
  }
  return json;
}

// ── 認証（自分の Google アカウントで OAuth ログイン）──────────────────
const SCOPES_OAUTH = [...SCOPES_READ, SCOPE_EDIT];

function readOAuthClient(cfg) {
  if (!existsSync(cfg.oauthClientFile)) {
    throw new Error(`OAuth クライアントのファイルが見つかりません: ${cfg.oauthClientFile}\nanalytics/README.md の「初回セットアップ」の手順で作成・配置してください。`);
  }
  const j = JSON.parse(readFileSync(cfg.oauthClientFile, "utf8"));
  const c = j.installed || j.web || j;
  if (!c.client_id || !c.client_secret) throw new Error(`${cfg.oauthClientFile} に client_id / client_secret がありません。「デスクトップアプリ」のクライアントJSONか確認してください。`);
  return { client_id: c.client_id, client_secret: c.client_secret, token_uri: c.token_uri || "https://oauth2.googleapis.com/token" };
}

async function oauthLogin(cfg) {
  const client = readOAuthClient(cfg);
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  const state = b64url(randomBytes(16));

  const server = createServer();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const redirectUri = `http://127.0.0.1:${server.address().port}`;
  const authUrl = "https://accounts.google.com/o/oauth2/v2/auth?" + new URLSearchParams({
    client_id: client.client_id, redirect_uri: redirectUri, response_type: "code",
    scope: SCOPES_OAUTH.join(" "), access_type: "offline", prompt: "consent",
    code_challenge: challenge, code_challenge_method: "S256", state,
  });

  const code = await new Promise((resolveCode, reject) => {
    server.on("request", (req, res) => {
      const u = new URL(req.url, redirectUri);
      if (!u.searchParams.has("code") && !u.searchParams.has("error")) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      if (u.searchParams.get("error") || u.searchParams.get("state") !== state) {
        res.end("<p>ログインに失敗しました。ターミナルに戻ってください。</p>");
        reject(new Error(`ログインが拒否されました: ${u.searchParams.get("error") || "state 不一致"}`));
      } else {
        res.end("<p style='font:16px sans-serif'>✅ ログインできました。このタブを閉じてターミナルに戻ってください。</p>");
        resolveCode(u.searchParams.get("code"));
      }
    });
    console.log("ブラウザで Google のログイン画面を開きます。開かない場合は次のURLを手動で開いてください:\n\n" + authUrl + "\n");
    const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start \"\"" : "xdg-open";
    exec(`${opener} "${authUrl}"`);
  });
  server.close();

  const res = await fetch(client.token_uri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, code_verifier: verifier, redirect_uri: redirectUri, client_id: client.client_id, client_secret: client.client_secret }),
  });
  const json = await res.json();
  if (!res.ok || !json.refresh_token) throw new Error(`トークン取得に失敗: ${JSON.stringify(json)}`);
  mkdirSync(dirname(cfg.tokenFile), { recursive: true });
  writeFileSync(cfg.tokenFile, JSON.stringify({ refresh_token: json.refresh_token, scope: json.scope, created_at: new Date().toISOString() }, null, 2), { mode: 0o600 });
  console.log(`✅ ログイン情報を保存しました: ${cfg.tokenFile}\n次は: node analytics/fetch-reports.mjs --check`);
}

async function refreshAccessToken(cfg) {
  const client = readOAuthClient(cfg);
  const saved = JSON.parse(readFileSync(cfg.tokenFile, "utf8"));
  const res = await fetch(client.token_uri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: saved.refresh_token, client_id: client.client_id, client_secret: client.client_secret }),
  });
  const json = await res.json();
  if (!res.ok) {
    if (json.error === "invalid_grant") throw new Error("ログインの有効期限が切れています。もう一度 `node analytics/fetch-reports.mjs --login` を実行してください（OAuth 同意画面が「テスト」のままだと7日で切れます。README 参照）。");
    throw new Error(`アクセストークン更新に失敗: ${JSON.stringify(json)}`);
  }
  return json.access_token;
}

// サービスアカウントの鍵があればそれを、無ければ OAuth ログイン情報を使う
async function authorize(cfg, needEdit) {
  if (existsSync(cfg.keyFile)) {
    const key = JSON.parse(readFileSync(cfg.keyFile, "utf8"));
    console.log(`認証: サービスアカウント ${key.client_email}`);
    return getAccessToken(key, needEdit ? [...SCOPES_READ, SCOPE_EDIT] : SCOPES_READ);
  }
  if (existsSync(cfg.tokenFile)) {
    console.log("認証: Google アカウント（OAuth）");
    return refreshAccessToken(cfg);
  }
  throw new Error(`まだログインしていません。先に \`node analytics/fetch-reports.mjs --login\` を実行してください（初回は analytics/README.md の手順で OAuth クライアントを作成）。`);
}

// ── 自動検出 ─────────────────────────────────────────────────
async function detectPropertyId(token, measurementId) {
  const sums = await api(token, "GET", "https://analyticsadmin.googleapis.com/v1beta/accountSummaries?pageSize=200");
  const props = (sums.accountSummaries || []).flatMap((a) => a.propertySummaries || []);
  if (!props.length) throw new Error("見られる GA4 プロパティがありません。ログインした Google アカウント（またはサービスアカウント）に GA4 の閲覧権限があるか確認してください。");
  for (const p of props) {
    try {
      const ds = await api(token, "GET", `https://analyticsadmin.googleapis.com/v1beta/${p.property}/dataStreams`);
      if ((ds.dataStreams || []).some((s) => s.webStreamData?.measurementId === measurementId)) {
        return { id: p.property.split("/")[1], name: p.displayName };
      }
    } catch { /* 権限の無いプロパティは飛ばす */ }
  }
  if (props.length === 1) return { id: props[0].property.split("/")[1], name: props[0].displayName };
  throw new Error(`${measurementId} を持つプロパティが見つかりません。config.json の propertyId に数字のプロパティIDを書いてください。候補: ${props.map((p) => `${p.displayName}=${p.property}`).join(", ")}`);
}

async function detectSiteUrl(token, domain) {
  const json = await api(token, "GET", "https://searchconsole.googleapis.com/webmasters/v3/sites");
  const sites = (json.siteEntry || []).filter((s) => s.permissionLevel !== "siteUnverifiedUser").map((s) => s.siteUrl);
  const hit = sites.find((s) => s === `sc-domain:${domain}`) || sites.find((s) => s.includes(domain));
  if (!hit) throw new Error(`Search Console に ${domain} が見つかりません。ログインしたアカウントが Search Console でそのサイトの権限を持っているか確認してください。見えているサイト: ${sites.join(", ") || "なし"}`);
  return hit;
}

// ── GA4 ──────────────────────────────────────────────────────
async function ga4(token, propertyId, { start, end, dimensions, metrics, limit = 10000, orderBy, filter }) {
  const body = {
    dateRanges: [{ startDate: start, endDate: end }],
    dimensions: dimensions.map((name) => ({ name })),
    metrics: metrics.map((name) => ({ name })),
    limit,
    keepEmptyRows: false,
  };
  if (orderBy) body.orderBys = [{ metric: { metricName: orderBy }, desc: true }];
  if (filter) body.dimensionFilter = filter;
  const json = await api(token, "POST", `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`, body);
  return (json.rows || []).map((r) => {
    const o = {};
    dimensions.forEach((d, i) => { o[d] = r.dimensionValues[i].value; });
    metrics.forEach((m, i) => { o[m] = Number(r.metricValues[i].value); });
    return o;
  });
}

// ── Search Console ───────────────────────────────────────────
async function gsc(token, siteUrl, { start, end, dimensions, rowLimit = 1000 }) {
  const json = await api(token, "POST",
    `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
    { startDate: start, endDate: end, dimensions, rowLimit, dataState: "all" });
  return (json.rows || []).map((r) => {
    const o = {};
    dimensions.forEach((d, i) => { o[d] = r.keys[i]; });
    o.clicks = r.clicks;
    o.impressions = r.impressions;
    o.ctr = Math.round(r.ctr * 10000) / 100; // %
    o.position = Math.round(r.position * 10) / 10;
    return o;
  });
}

// ── ページ → ツール分類（shared/analytics.js と同じ規則）────────────────
const TOOLS = [
  [/^\/bar-chart-race(\/|$)/, "bar_chart_race"],
  [/^\/regular-chart(\/|$)/, "line_chart_race"],
  [/^\/stock-race\/app-bar(\/|$)/, "stock_race_bar"],
  [/^\/stock-race(\/|$)/, "stock_race_line"],
  [/^\/horse-race-ranking-maker(\/|$)/, "horse_race"],
  [/^\/ranking-video-maker(\/|$)/, "ranking_video"],
  [/^\/tournament-bracket-animator(\/|$)/, "tournament_bracket"],
  [/^\/amidakuji-maker(\/|$)/, "amidakuji"],
];
const SINGLE_PAGE_TOOLS = new Set(["horse_race", "amidakuji"]);
const TOOL_LABEL = {
  bar_chart_race: "バーチャートレース", line_chart_race: "線グラフレース", stock_race_line: "株価レース(線)",
  stock_race_bar: "株価レース(バー)", horse_race: "競馬風ランキング", ranking_video: "ランキング発表動画",
  tournament_bracket: "トーナメント表", amidakuji: "あみだくじ",
};
function classify(path) {
  const p = String(path || "").replace(/^https?:\/\/[^/]+/, "").split("?")[0];
  const tool = (TOOLS.find(([re]) => re.test(p)) || [])[1] || "";
  let type = "other";
  if (/^\/blog(\/|$)/.test(p)) type = "blog";
  else if (p === "/" || p === "/index.html") type = "home";
  else if (tool && /\/app(-bar)?(\/|$)/.test(p)) type = "app";
  else if (tool && SINGLE_PAGE_TOOLS.has(tool)) type = "tool_page";
  else if (tool) type = "lp";
  return { tool, type };
}

// ── 出力ユーティリティ ─────────────────────────────────────────
function toCsv(rows) {
  if (!rows.length) return "";
  const cols = Object.keys(rows[0]);
  const esc = (v) => {
    const s = v === undefined || v === null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return "﻿" + [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n") + "\n";
}
function ymd(d) { return d.toISOString().slice(0, 10); }
function daysAgo(n) { const d = new Date(); d.setUTCDate(d.getUTCDate() - n); return ymd(d); }
const pct = (a, b) => (b ? `${Math.round((a / b) * 1000) / 10}%` : "—");
const sum = (rows, k) => rows.reduce((s, r) => s + (Number(r[k]) || 0), 0);
function mdTable(rows, cols, headers) {
  if (!rows.length) return "_データなし_\n";
  return [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((r) => `| ${cols.map((c) => String(r[c] ?? "").replace(/\|/g, "\\|")).join(" | ")} |`),
  ].join("\n") + "\n";
}

// ── カスタムディメンション（GA4 の画面で params を見るために必要）────────
const CUSTOM_DIMENSIONS = [
  ["tool_name", "ツール名"], ["page_type", "ページ種別"], ["button_id", "ボタンID"], ["button_label", "ボタン表示名"],
  ["file_kind", "ファイル種別"], ["file_ext", "拡張子"], ["export_format", "書き出し形式"], ["target_tool", "遷移先ツール"],
  ["target_page_type", "遷移先ページ種別"], ["engage_action", "最初の操作"], ["input_id", "入力欄ID"], ["via", "保存経路"],
  ["from_sample", "サンプルから開始"], ["plan", "プラン"],
  ["error_message", "エラー内容"], ["error_source", "エラー発生ファイル"], ["error_line", "エラー行番号"],
];
const CUSTOM_METRICS = [["seconds_since_open", "ツールを開いてからの秒数", "SECONDS"], ["seconds_to_engage", "最初の操作までの秒数", "SECONDS"]];

async function setupDimensions(token, propertyId) {
  const base = `https://analyticsadmin.googleapis.com/v1beta/properties/${propertyId}`;
  const existing = await api(token, "GET", `${base}/customDimensions?pageSize=200`);
  const have = new Set((existing.customDimensions || []).map((d) => d.parameterName));
  for (const [param, name] of CUSTOM_DIMENSIONS) {
    if (have.has(param)) { console.log(`  = ${param}（登録済み）`); continue; }
    await api(token, "POST", `${base}/customDimensions`, { parameterName: param, displayName: name, scope: "EVENT" });
    console.log(`  + ${param} を登録`);
  }
  const em = await api(token, "GET", `${base}/customMetrics?pageSize=200`);
  const haveM = new Set((em.customMetrics || []).map((d) => d.parameterName));
  for (const [param, name, unit] of CUSTOM_METRICS) {
    if (haveM.has(param)) { console.log(`  = ${param}（登録済み）`); continue; }
    await api(token, "POST", `${base}/customMetrics`, { parameterName: param, displayName: name, measurementUnit: unit, scope: "EVENT" });
    console.log(`  + ${param} を登録`);
  }
}

// ── メイン ───────────────────────────────────────────────────
async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cfg = loadConfig();
  if (args.login) { await oauthLogin(cfg); return; }
  const token = await authorize(cfg, args.setupDimensions);

  let propertyId = cfg.propertyId, propertyName = "";
  if (!propertyId) {
    const p = await detectPropertyId(token, cfg.measurementId);
    propertyId = p.id; propertyName = p.name;
  }
  console.log(`GA4 プロパティ: ${propertyId} ${propertyName}`);
  let siteUrl = cfg.siteUrl, gscError = "";
  try {
    if (!siteUrl) siteUrl = await detectSiteUrl(token, cfg.siteDomain);
    console.log(`Search Console: ${siteUrl}`);
  } catch (e) { gscError = e.message; console.warn(`⚠ Search Console: ${e.message}`); }

  if (args.setupDimensions) {
    console.log("カスタムディメンションを登録します…");
    await setupDimensions(token, propertyId);
    console.log("完了。反映まで最大24〜48時間かかります。");
    return;
  }
  if (args.check) { console.log("接続OK"); return; }

  const end = daysAgo(1);              // GA4: 昨日まで
  const start = daysAgo(args.days);
  const gscEnd = daysAgo(3);           // GSC: 2〜3日遅れて確定する
  const gscStart = daysAgo(args.days + 2);
  const range = { start, end };
  const out = {};

  console.log(`GA4 取得中（${start} 〜 ${end}）…`);
  out.ga4_daily = await ga4(token, propertyId, { ...range, dimensions: ["date"], metrics: ["activeUsers", "sessions", "engagedSessions", "screenPageViews"] });
  out.ga4_daily.sort((a, b) => a.date.localeCompare(b.date));
  out.ga4_pages = await ga4(token, propertyId, { ...range, dimensions: ["pagePath"], metrics: ["screenPageViews", "activeUsers", "userEngagementDuration"], orderBy: "screenPageViews" });
  out.ga4_pages.forEach((r) => { const c = classify(r.pagePath); r.tool = c.tool; r.page_type = c.type; r.avg_engagement_sec = r.activeUsers ? Math.round(r.userEngagementDuration / r.activeUsers) : 0; });
  out.ga4_sources = await ga4(token, propertyId, { ...range, dimensions: ["sessionDefaultChannelGroup", "sessionSource"], metrics: ["sessions", "activeUsers", "engagedSessions"], orderBy: "sessions" });
  out.ga4_landing = await ga4(token, propertyId, { ...range, dimensions: ["landingPage", "sessionDefaultChannelGroup"], metrics: ["sessions", "engagedSessions"], orderBy: "sessions", limit: 500 });
  out.ga4_devices = await ga4(token, propertyId, { ...range, dimensions: ["deviceCategory"], metrics: ["activeUsers", "sessions"] });
  out.ga4_countries = await ga4(token, propertyId, { ...range, dimensions: ["country"], metrics: ["activeUsers"], orderBy: "activeUsers", limit: 30 });
  // イベント × ページ（カスタムディメンション未登録でも集計できる形）
  out.ga4_events_by_page = await ga4(token, propertyId, { ...range, dimensions: ["eventName", "pagePath"], metrics: ["eventCount", "totalUsers"], orderBy: "eventCount" });
  out.ga4_events_by_page.forEach((r) => { const c = classify(r.pagePath); r.tool = c.tool; r.page_type = c.type; });

  // ボタン単位の内訳（カスタムディメンション登録後に取れる）
  const notes = [];
  try {
    out.ga4_buttons = await ga4(token, propertyId, { ...range, dimensions: ["eventName", "customEvent:tool_name", "customEvent:button_id", "customEvent:button_label"], metrics: ["eventCount", "totalUsers"], orderBy: "eventCount", limit: 2000 });
  } catch (e) {
    out.ga4_buttons = [];
    notes.push("ボタン単位の内訳はまだ取れません（カスタムディメンション未登録、または登録から24時間以内）。`node analytics/fetch-reports.mjs --setup-dimensions` を一度実行してください。");
  }
  try {
    out.ga4_tool_links = await ga4(token, propertyId, { ...range, dimensions: ["pagePath", "customEvent:target_tool", "customEvent:target_page_type"], metrics: ["eventCount", "totalUsers"], orderBy: "eventCount", filter: { filter: { fieldName: "eventName", stringFilter: { value: "tool_link_click" } } } });
  } catch { out.ga4_tool_links = []; }

  if (!gscError) {
    console.log(`Search Console 取得中（${gscStart} 〜 ${gscEnd}）…`);
    const g = { start: gscStart, end: gscEnd };
    out.gsc_daily = await gsc(token, siteUrl, { ...g, dimensions: ["date"] });
    out.gsc_queries = await gsc(token, siteUrl, { ...g, dimensions: ["query"], rowLimit: 1000 });
    out.gsc_pages = await gsc(token, siteUrl, { ...g, dimensions: ["page"], rowLimit: 1000 });
    out.gsc_query_page = await gsc(token, siteUrl, { ...g, dimensions: ["query", "page"], rowLimit: 5000 });
    out.gsc_countries = await gsc(token, siteUrl, { ...g, dimensions: ["country"], rowLimit: 50 });
    out.gsc_devices = await gsc(token, siteUrl, { ...g, dimensions: ["device"], rowLimit: 10 });
  }

  // ── 書き出し ──
  const today = ymd(new Date());
  const snapDir = join(DATA_DIR, today);
  const latestDir = join(DATA_DIR, "latest");
  mkdirSync(snapDir, { recursive: true });
  for (const [name, rows] of Object.entries(out)) writeFileSync(join(snapDir, `${name}.csv`), toCsv(rows));
  const report = buildReport({ out, start, end, gscStart, gscEnd, propertyId, siteUrl, gscError, notes, days: args.days });
  writeFileSync(join(snapDir, "report.md"), report);
  writeFileSync(join(snapDir, "meta.json"), JSON.stringify({ fetchedAt: new Date().toISOString(), propertyId, siteUrl, ga4: { start, end }, gsc: { start: gscStart, end: gscEnd } }, null, 2));
  rmSync(latestDir, { recursive: true, force: true });
  cpSync(snapDir, latestDir, { recursive: true });
  console.log(`\n✅ 保存しました: analytics/data/${today}/ （最新版は analytics/data/latest/）`);
  console.log(`   レポート: analytics/data/latest/report.md`);
}

// ── レポート（report.md）────────────────────────────────────────
const FUNNEL = [
  ["lp_view", "LP表示"], ["tool_open", "ツールを開いた"], ["tool_engaged", "操作した"],
  ["preview_start", "プレビュー再生"], ["export_start", "書き出しボタン"], ["export_complete", "書き出し完了"],
  ["upgrade_click", "透かしなし/購入ボタン"],
];

function buildReport({ out, start, end, gscStart, gscEnd, propertyId, siteUrl, gscError, notes, days }) {
  const L = [];
  L.push(`# GraphRace Studio 計測レポート（直近${days}日）`, "");
  L.push(`- GA4: ${start} 〜 ${end}（property ${propertyId}）`);
  L.push(`- Search Console: ${gscError ? "取得できず — " + gscError : `${gscStart} 〜 ${gscEnd}（${siteUrl}）`}`);
  L.push(`- 取得日時: ${new Date().toLocaleString("ja-JP", { timeZone: "Asia/Taipei" })}（台北時間）`, "");
  for (const n of notes) L.push(`> ⚠ ${n}`, "");

  // サマリー
  const d = out.ga4_daily;
  L.push("## サマリー", "");
  L.push(mdTable([{
    users: sum(d, "activeUsers"), sessions: sum(d, "sessions"), pv: sum(d, "screenPageViews"),
    engaged: pct(sum(d, "engagedSessions"), sum(d, "sessions")),
    clicks: out.gsc_daily ? sum(out.gsc_daily, "clicks") : "—", imps: out.gsc_daily ? sum(out.gsc_daily, "impressions") : "—",
  }], ["users", "sessions", "pv", "engaged", "clicks", "imps"], ["ユーザー", "セッション", "PV", "エンゲージ率", "検索クリック", "検索表示回数"]));

  // ツール別ファネル
  const ev = out.ga4_events_by_page;
  const tools = Object.keys(TOOL_LABEL);
  const funnelRows = [];
  for (const t of tools) {
    const evOf = (name, pageTypes) => sum(ev.filter((r) => r.tool === t && r.eventName === name && (!pageTypes || pageTypes.includes(r.page_type))), "eventCount");
    const usersOf = (name) => sum(ev.filter((r) => r.tool === t && r.eventName === name), "totalUsers");
    const row = {
      tool: TOOL_LABEL[t],
      lp_view: SINGLE_PAGE_TOOLS.has(t) ? evOf("page_view", ["tool_page"]) : evOf("page_view", ["lp"]),
      tool_open: evOf("tool_open"),
      tool_engaged: evOf("tool_engaged"),
      preview_start: evOf("preview_start"),
      export_start: evOf("export_start"),
      export_complete: evOf("export_complete"),
      export_users: usersOf("export_complete"),
      upgrade_click: evOf("upgrade_click"),
    };
    row.open_rate = pct(row.tool_open, row.lp_view);
    row.engage_rate = pct(row.tool_engaged, row.tool_open);
    row.export_rate = pct(row.export_complete, row.tool_engaged);
    if (row.lp_view || row.tool_open) funnelRows.push(row);
  }
  L.push("## ツール別ファネル", "");
  L.push("LP表示 → ツールを開いた → 操作した → プレビュー → 書き出しボタン → 書き出し完了。単体ページ型（競馬風・あみだくじ）は LP表示＝ツールページ表示。", "");
  L.push(mdTable(funnelRows,
    ["tool", "lp_view", "tool_open", "open_rate", "tool_engaged", "engage_rate", "preview_start", "export_start", "export_complete", "export_users", "export_rate", "upgrade_click"],
    ["ツール", "LP表示", "開いた", "LP→開", "操作", "開→操作", "プレビュー", "書出ボタン", "書出完了", "書出UU", "操作→書出", "購入系"]));

  // 判断ライン
  const totalExport = sum(funnelRows, "export_complete");
  const totalUpgrade = sum(funnelRows, "upgrade_click");
  L.push("## 判断ラインとの照合", "");
  L.push(`- ツールページ訪問（LP+ツール画面のPV）: **${sum(out.ga4_pages.filter((r) => r.tool), "screenPageViews")}**（目安: 月1,000〜3,000 で価格判断のデータが揃う）`);
  L.push(`- 書き出し完了: **${totalExport}** 回（目安: 月100件で価格・市場の判断材料）`);
  L.push(`- 透かしなし／購入ボタン: **${totalUpgrade}** 回（目安: 月30回以上なら有料化の価値あり）`, "");

  // ボタン内訳
  if (out.ga4_buttons.length) {
    L.push("## よく押されたボタン（上位30）", "");
    L.push(mdTable(out.ga4_buttons.slice(0, 30), ["eventName", "customEvent:tool_name", "customEvent:button_id", "customEvent:button_label", "eventCount", "totalUsers"], ["イベント", "ツール", "ボタンID", "表示名", "回数", "UU"]));
  }

  // ブログ → ツール
  if (out.ga4_tool_links.length) {
    const fromBlog = out.ga4_tool_links.filter((r) => classify(r.pagePath).type === "blog");
    L.push("## ブログ・LPからツールへの遷移", "");
    L.push(mdTable((fromBlog.length ? fromBlog : out.ga4_tool_links).slice(0, 20), ["pagePath", "customEvent:target_tool", "customEvent:target_page_type", "eventCount"], ["元ページ", "遷移先ツール", "遷移先種別", "クリック"]));
  }

  // 流入元
  L.push("## 流入元（上位15）", "");
  L.push(mdTable(out.ga4_sources.slice(0, 15).map((r) => ({ ...r, er: pct(r.engagedSessions, r.sessions) })), ["sessionDefaultChannelGroup", "sessionSource", "sessions", "activeUsers", "er"], ["チャネル", "参照元", "セッション", "ユーザー", "エンゲージ率"]));

  // ページ
  L.push("## ページ別（上位25）", "");
  L.push(mdTable(out.ga4_pages.slice(0, 25), ["pagePath", "page_type", "screenPageViews", "activeUsers", "avg_engagement_sec"], ["ページ", "種別", "PV", "ユーザー", "平均滞在(秒)"]));

  // GSC
  if (out.gsc_queries) {
    L.push("## 検索クエリ（クリック上位25）", "");
    L.push(mdTable([...out.gsc_queries].sort((a, b) => b.clicks - a.clicks).slice(0, 25), ["query", "clicks", "impressions", "ctr", "position"], ["クエリ", "クリック", "表示", "CTR%", "平均順位"]));
    const chances = out.gsc_queries.filter((r) => r.impressions >= 20 && r.position > 4 && r.position <= 20).sort((a, b) => b.impressions - a.impressions).slice(0, 20);
    L.push("## 伸びしろクエリ（表示20回以上・平均4〜20位）", "", "タイトル・見出しの調整や記事追加で上位を狙える候補。", "");
    L.push(mdTable(chances, ["query", "impressions", "clicks", "ctr", "position"], ["クエリ", "表示", "クリック", "CTR%", "平均順位"]));
    L.push("## 検索流入ページ（クリック上位20）", "");
    L.push(mdTable([...out.gsc_pages].sort((a, b) => b.clicks - a.clicks).slice(0, 20).map((r) => ({ ...r, page: r.page.replace(/^https?:\/\/[^/]+/, "") })), ["page", "clicks", "impressions", "ctr", "position"], ["ページ", "クリック", "表示", "CTR%", "平均順位"]));
  }

  L.push("", "---", "CSV は同じフォルダにあります（ga4_*.csv / gsc_*.csv）。");
  return L.join("\n");
}

main().catch((e) => { console.error(`\n❌ ${e.message}`); process.exit(1); });
