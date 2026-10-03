#!/usr/bin/env node
/*
 * google-analytics-mcp — GA4 / Search Console を Claude から直接問い合わせる MCP サーバー（依存パッケージなし）
 * ---------------------------------------------------------------------------
 * Claude デスクトップアプリ（または Claude Code）に登録すると、チャットで
 * 「graphrace-studio.com の先週の検索クエリを分析して」のように頼むだけで、Claude がこのサーバー経由で
 * GA4 Data API / Search Console API を呼び出す。
 *
 * 認証は analytics/fetch-reports.mjs --login で保存したログイン情報を共用する:
 *   ~/.config/graphrace-studio/oauth-client.json
 *   ~/.config/graphrace-studio/token.json
 *
 * 登録: node analytics/install-mcp.mjs  （Claude デスクトップアプリの設定に追記）→ アプリを再起動
 * stdout は MCP の通信専用。ログは stderr に出す。
 */

import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";

const CONF_DIR = join(homedir(), ".config", "graphrace-studio");
const CLIENT_FILE = process.env.GRS_OAUTH_CLIENT || join(CONF_DIR, "oauth-client.json");
const TOKEN_FILE = process.env.GRS_TOKEN_FILE || join(CONF_DIR, "token.json");
const log = (...a) => process.stderr.write(a.join(" ") + "\n");

// ── 認証 ─────────────────────────────────────────────────────
let cachedToken = null; // { value, exp }
async function accessToken() {
  if (cachedToken && cachedToken.exp > Date.now() + 60_000) return cachedToken.value;
  if (!existsSync(CLIENT_FILE) || !existsSync(TOKEN_FILE)) {
    throw new Error("Google にログインしていません。ターミナルで `node ~/Desktop/Chart-Tool/analytics/fetch-reports.mjs --login` を実行してください。");
  }
  const j = JSON.parse(readFileSync(CLIENT_FILE, "utf8"));
  const c = j.installed || j.web || j;
  const { refresh_token } = JSON.parse(readFileSync(TOKEN_FILE, "utf8"));
  const res = await fetch(c.token_uri || "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token, client_id: c.client_id, client_secret: c.client_secret }),
  });
  const json = await res.json();
  if (!res.ok) {
    if (json.error === "invalid_grant") throw new Error("ログインの有効期限が切れています。ターミナルで `node ~/Desktop/Chart-Tool/analytics/fetch-reports.mjs --login` を再実行してください。");
    throw new Error(`アクセストークン更新に失敗: ${JSON.stringify(json)}`);
  }
  cachedToken = { value: json.access_token, exp: Date.now() + (json.expires_in || 3600) * 1000 };
  return cachedToken.value;
}

async function api(method, url, body) {
  const token = await accessToken();
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  if (!res.ok) throw new Error(`${res.status} ${json?.error?.message || text}`);
  return json;
}

// ── プロパティ／サイトの解決（数字ID・測定ID・ドメインのどれでも指定できる）────────
let propertyCache = null;
async function listProperties() {
  if (propertyCache) return propertyCache;
  const sums = await api("GET", "https://analyticsadmin.googleapis.com/v1beta/accountSummaries?pageSize=200");
  const out = [];
  for (const a of sums.accountSummaries || []) {
    for (const p of a.propertySummaries || []) {
      const id = p.property.split("/")[1];
      let streams = [];
      try {
        const ds = await api("GET", `https://analyticsadmin.googleapis.com/v1beta/${p.property}/dataStreams`);
        streams = (ds.dataStreams || []).filter((s) => s.webStreamData).map((s) => ({ measurementId: s.webStreamData.measurementId, url: s.webStreamData.defaultUri }));
      } catch { /* 権限なし */ }
      out.push({ propertyId: id, name: p.displayName, account: a.displayName, streams });
    }
  }
  propertyCache = out;
  return out;
}

async function resolveProperty(input) {
  const s = String(input || "").trim();
  if (/^\d+$/.test(s)) return s;
  const props = await listProperties();
  const norm = (x) => String(x || "").toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
  const hit = props.find((p) => p.streams.some((st) => st.measurementId === s))
    || props.find((p) => p.streams.some((st) => norm(st.url) === norm(s)))
    || props.find((p) => p.streams.some((st) => norm(st.url).includes(norm(s))) || p.name.toLowerCase().includes(s.toLowerCase()));
  if (!hit) throw new Error(`GA4 プロパティ「${s}」が見つかりません。候補: ${props.map((p) => `${p.name}(${p.propertyId}: ${p.streams.map((x) => x.url).join(",")})`).join(" / ")}`);
  return hit.propertyId;
}

let siteCache = null;
async function resolveSite(input) {
  const s = String(input || "").trim();
  if (!siteCache) {
    const json = await api("GET", "https://searchconsole.googleapis.com/webmasters/v3/sites");
    siteCache = (json.siteEntry || []).filter((x) => x.permissionLevel !== "siteUnverifiedUser").map((x) => x.siteUrl);
  }
  if (siteCache.includes(s)) return s;
  const d = s.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
  const hit = siteCache.find((x) => x === `sc-domain:${d}`) || siteCache.find((x) => x.toLowerCase().includes(d));
  if (!hit) throw new Error(`Search Console のサイト「${s}」が見つかりません。候補: ${siteCache.join(", ")}`);
  return hit;
}

// ── 日付 ─────────────────────────────────────────────────────
// GA4 は "7daysAgo" "yesterday" "today" を直接受け付ける。GSC 用に YYYY-MM-DD へ変換する
function toYmd(v, fallbackDaysAgo) {
  const d = new Date();
  const s = String(v || "").trim();
  let n = fallbackDaysAgo;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (s === "today") n = 0;
  else if (s === "yesterday") n = 1;
  else if (/^(\d+)daysAgo$/.test(s)) n = Number(RegExp.$1);
  d.setDate(d.getDate() - n);
  return d.toLocaleDateString("sv-SE", { timeZone: "Asia/Taipei" });
}

// ── GA4 フィルター（簡易表記 → API 形式）────────────────────────────
// [{ field:"pagePath", op:"contains", value:"/blog/" }, ...]  op: exact|contains|begins_with|ends_with|regex|in|not_contains|not_exact
function buildFilter(list) {
  if (!list || !list.length) return undefined;
  const one = (f) => {
    const op = (f.op || "exact").toLowerCase();
    let filter;
    if (op === "in") filter = { fieldName: f.field, inListFilter: { values: [].concat(f.value).map(String) } };
    else {
      const base = op.replace(/^not_/, "");
      const matchType = { exact: "EXACT", contains: "CONTAINS", begins_with: "BEGINS_WITH", ends_with: "ENDS_WITH", regex: "FULL_REGEXP" }[base] || "EXACT";
      filter = { fieldName: f.field, stringFilter: { value: String(f.value), matchType, caseSensitive: false } };
    }
    return op.startsWith("not_") ? { notExpression: { filter } } : { filter };
  };
  return list.length === 1 ? one(list[0]) : { andGroup: { expressions: list.map(one) } };
}

function rowsFromGa4(json, dims, mets) {
  return (json.rows || []).map((r) => {
    const o = {};
    dims.forEach((d, i) => { o[d] = r.dimensionValues[i].value; });
    mets.forEach((m, i) => { o[m] = Number(r.metricValues[i].value); });
    return o;
  });
}

// ── ツール定義 ──────────────────────────────────────────────────
const TOOLS = [
  {
    name: "list_sites",
    description: "ログイン中の Google アカウントで見られる GA4 プロパティ（ID・名前・計測URL・測定ID）と Search Console のサイト一覧を返す。どのサイトを分析できるか分からないときに最初に呼ぶ。",
    inputSchema: { type: "object", properties: {} },
    run: async () => {
      const props = await listProperties();
      let sites = [];
      try { await resolveSite("__none__"); } catch { /* 一覧取得のため */ }
      sites = siteCache || [];
      return { ga4_properties: props, search_console_sites: sites };
    },
  },
  {
    name: "ga4_report",
    description: [
      "GA4 Data API の runReport を実行する。任意のディメンション×指標で集計できる。",
      "property: 数字のプロパティID / 測定ID(G-XXXX) / ドメイン（例 graphrace-studio.com, nikou-in-taiwan.com）のどれでも可。",
      "日付は YYYY-MM-DD / today / yesterday / NdaysAgo。",
      "よく使うディメンション: date, pagePath, landingPage, eventName, sessionDefaultChannelGroup, sessionSource, sessionMedium, deviceCategory, country, pageTitle, firstUserSource。",
      "よく使う指標: activeUsers, newUsers, sessions, engagedSessions, engagementRate, screenPageViews, eventCount, totalUsers, userEngagementDuration, averageSessionDuration, bounceRate, keyEvents。",
      "カスタムイベントのパラメータは customEvent:<param>（例 customEvent:tool_name, customEvent:button_id。GA4 側でカスタムディメンション登録済みのもののみ）。",
      "GraphRace Studio の主なイベント: tool_open, tool_engaged, tool_ui_click, tool_link_click, preview_start, export_start, export_complete, file_save, file_import, data_download, project_save, stock_fetch, upgrade_click, js_error。",
    ].join("\n"),
    inputSchema: {
      type: "object",
      properties: {
        property: { type: "string", description: "プロパティID / 測定ID / ドメイン" },
        start_date: { type: "string", default: "28daysAgo" },
        end_date: { type: "string", default: "yesterday" },
        dimensions: { type: "array", items: { type: "string" }, default: [] },
        metrics: { type: "array", items: { type: "string" }, default: ["activeUsers"] },
        filters: {
          type: "array",
          description: "ディメンションの絞り込み（AND）。例 [{field:'eventName',op:'exact',value:'export_complete'},{field:'pagePath',op:'contains',value:'/blog/'}]。op: exact|contains|begins_with|ends_with|regex|in|not_exact|not_contains",
          items: { type: "object", properties: { field: { type: "string" }, op: { type: "string" }, value: {} }, required: ["field", "value"] },
        },
        order_by: { type: "string", description: "降順に並べる指標名（省略時は先頭の指標）。ディメンション名なら昇順" },
        limit: { type: "integer", default: 100, description: "最大 10000" },
        compare_previous: { type: "boolean", default: false, description: "true なら同じ長さの直前期間も取得して比較列を付ける" },
      },
      required: ["property"],
    },
    run: async (a) => {
      const propertyId = await resolveProperty(a.property);
      const dims = a.dimensions || [];
      const mets = a.metrics && a.metrics.length ? a.metrics : ["activeUsers"];
      const start = a.start_date || "28daysAgo", end = a.end_date || "yesterday";
      const ranges = [{ startDate: start, endDate: end, name: "current" }];
      if (a.compare_previous) {
        const s = new Date(toYmd(start, 28)), e = new Date(toYmd(end, 1));
        const len = Math.round((e - s) / 86400000) + 1;
        const pe = new Date(s); pe.setDate(pe.getDate() - 1);
        const ps = new Date(pe); ps.setDate(ps.getDate() - (len - 1));
        ranges.push({ startDate: ps.toISOString().slice(0, 10), endDate: pe.toISOString().slice(0, 10), name: "previous" });
      }
      const ob = a.order_by || mets[0];
      const body = {
        dateRanges: ranges,
        dimensions: dims.map((name) => ({ name })),
        metrics: mets.map((name) => ({ name })),
        limit: Math.min(a.limit || 100, 10000),
        metricAggregations: ["TOTAL"],
        orderBys: [mets.includes(ob) ? { metric: { metricName: ob }, desc: true } : { dimension: { dimensionName: ob } }],
      };
      const f = buildFilter(a.filters);
      if (f) body.dimensionFilter = f;
      const json = await api("POST", `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`, body);
      const dimsOut = a.compare_previous ? [...dims, "dateRange"] : dims;
      const rows = rowsFromGa4(json, dimsOut, mets);
      const totals = (json.totals || []).map((t) => {
        const o = {};
        if (a.compare_previous) o.dateRange = t.dimensionValues?.find((x) => x.value)?.value;
        mets.forEach((m, i) => { o[m] = Number(t.metricValues[i].value); });
        return o;
      });
      return { propertyId, dateRanges: ranges, rowCount: json.rowCount || 0, totals, rows };
    },
  },
  {
    name: "ga4_realtime",
    description: "GA4 のリアルタイムレポート（直近30分）。例 dimensions:['unifiedScreenName'] metrics:['activeUsers']、dimensions:['eventName'] metrics:['eventCount']。",
    inputSchema: {
      type: "object",
      properties: {
        property: { type: "string" },
        dimensions: { type: "array", items: { type: "string" }, default: ["unifiedScreenName"] },
        metrics: { type: "array", items: { type: "string" }, default: ["activeUsers"] },
        limit: { type: "integer", default: 50 },
      },
      required: ["property"],
    },
    run: async (a) => {
      const propertyId = await resolveProperty(a.property);
      const dims = a.dimensions || ["unifiedScreenName"], mets = a.metrics || ["activeUsers"];
      const json = await api("POST", `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runRealtimeReport`, {
        dimensions: dims.map((name) => ({ name })), metrics: mets.map((name) => ({ name })), limit: a.limit || 50,
      });
      return { propertyId, rows: rowsFromGa4(json, dims, mets) };
    },
  },
  {
    name: "gsc_query",
    description: [
      "Search Console の検索パフォーマンス（clicks, impressions, ctr, position）を取得する。",
      "site: ドメイン（graphrace-studio.com / nikou-in-taiwan.com）または sc-domain:… / https://… 形式。",
      "dimensions: query, page, date, country, device, searchAppearance の組み合わせ。",
      "データは2〜3日遅れで確定するため end_date の既定は 3daysAgo。日付は YYYY-MM-DD / NdaysAgo。",
      "filters 例: [{dimension:'page',op:'contains',value:'/blog/'}, {dimension:'query',op:'notContains',value:'graphrace'}]。op: equals|contains|notContains|notEquals|includingRegex|excludingRegex",
    ].join("\n"),
    inputSchema: {
      type: "object",
      properties: {
        site: { type: "string" },
        start_date: { type: "string", default: "30daysAgo" },
        end_date: { type: "string", default: "3daysAgo" },
        dimensions: { type: "array", items: { type: "string" }, default: ["query"] },
        filters: { type: "array", items: { type: "object", properties: { dimension: { type: "string" }, op: { type: "string" }, value: { type: "string" } }, required: ["dimension", "value"] } },
        search_type: { type: "string", default: "web", description: "web|image|video|news|discover|googleNews" },
        row_limit: { type: "integer", default: 100, description: "最大 25000" },
        order_by: { type: "string", default: "clicks", description: "clicks|impressions|ctr|position（position は昇順）" },
      },
      required: ["site"],
    },
    run: async (a) => {
      const siteUrl = await resolveSite(a.site);
      const startDate = toYmd(a.start_date || "30daysAgo", 30), endDate = toYmd(a.end_date || "3daysAgo", 3);
      const dims = a.dimensions && a.dimensions.length ? a.dimensions : ["query"];
      const body = { startDate, endDate, dimensions: dims, rowLimit: Math.min(a.row_limit || 100, 25000), type: a.search_type || "web", dataState: "all" };
      if (a.filters && a.filters.length) {
        body.dimensionFilterGroups = [{ groupType: "and", filters: a.filters.map((f) => ({ dimension: f.dimension, operator: f.op || "equals", expression: f.value })) }];
      }
      const json = await api("POST", `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`, body);
      let rows = (json.rows || []).map((r) => {
        const o = {};
        dims.forEach((d, i) => { o[d] = r.keys[i]; });
        o.clicks = r.clicks; o.impressions = r.impressions;
        o.ctr = Math.round(r.ctr * 10000) / 100; o.position = Math.round(r.position * 10) / 10;
        return o;
      });
      const ob = a.order_by || "clicks";
      rows.sort((x, y) => (ob === "position" ? x[ob] - y[ob] : y[ob] - x[ob]));
      const totals = { clicks: rows.reduce((s, r) => s + r.clicks, 0), impressions: rows.reduce((s, r) => s + r.impressions, 0) };
      return { siteUrl, startDate, endDate, rowCount: rows.length, totals_of_returned_rows: totals, rows };
    },
  },
  {
    name: "gsc_inspect_url",
    description: "Search Console の URL 検査。指定 URL のインデックス状況・最終クロール日・正規URL・モバイル対応などを返す。",
    inputSchema: { type: "object", properties: { site: { type: "string" }, url: { type: "string" } }, required: ["site", "url"] },
    run: async (a) => {
      const siteUrl = await resolveSite(a.site);
      const json = await api("POST", "https://searchconsole.googleapis.com/v1/urlInspection/index:inspect", { inspectionUrl: a.url, siteUrl, languageCode: "ja" });
      return json.inspectionResult || json;
    },
  },
];

// ── MCP（JSON-RPC over stdio）────────────────────────────────────
function send(msg) { process.stdout.write(JSON.stringify(msg) + "\n"); }

async function handle(msg) {
  const { id, method, params } = msg;
  if (id === undefined) return; // 通知（notifications/initialized など）は応答不要
  try {
    if (method === "initialize") {
      return send({ jsonrpc: "2.0", id, result: {
        protocolVersion: params?.protocolVersion || "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "google-analytics", version: "1.0.0" },
        instructions: "GA4 と Search Console をログイン中の Google アカウント権限で問い合わせる。サイトはドメイン名（graphrace-studio.com / nikou-in-taiwan.com）で指定できる。分からなければ list_sites を呼ぶ。",
      } });
    }
    if (method === "ping") return send({ jsonrpc: "2.0", id, result: {} });
    if (method === "tools/list") {
      return send({ jsonrpc: "2.0", id, result: { tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) } });
    }
    if (method === "tools/call") {
      const tool = TOOLS.find((t) => t.name === params?.name);
      if (!tool) return send({ jsonrpc: "2.0", id, error: { code: -32602, message: `unknown tool: ${params?.name}` } });
      try {
        const result = await tool.run(params.arguments || {});
        return send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(result) }] } });
      } catch (e) {
        log(`[${tool.name}] ${e.message}`);
        return send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: `エラー: ${e.message}` }], isError: true } });
      }
    }
    send({ jsonrpc: "2.0", id, error: { code: -32601, message: `method not found: ${method}` } });
  } catch (e) {
    send({ jsonrpc: "2.0", id, error: { code: -32603, message: e.message } });
  }
}

const rl = createInterface({ input: process.stdin });
rl.on("line", (line) => {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  handle(msg);
});
log("google-analytics MCP server started");
