#!/usr/bin/env node
/*
 * google-analytics MCP サーバーを Claude デスクトップアプリに登録する。
 *   node analytics/install-mcp.mjs
 * 既存の設定はバックアップ（.bak-日時）を取ってから追記する。実行後、Claude アプリを完全に終了して再起動。
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SERVER = resolve(dirname(fileURLToPath(import.meta.url)), "mcp-server.mjs");
const CONFIG = platform() === "darwin"
  ? join(homedir(), "Library", "Application Support", "Claude", "claude_desktop_config.json")
  : platform() === "win32"
    ? join(process.env.APPDATA || "", "Claude", "claude_desktop_config.json")
    : join(homedir(), ".config", "Claude", "claude_desktop_config.json");

let cfg = {};
if (existsSync(CONFIG)) {
  const raw = readFileSync(CONFIG, "utf8");
  try { cfg = raw.trim() ? JSON.parse(raw) : {}; } catch (e) {
    console.error(`設定ファイルが JSON として読めません（手で直してから再実行してください）: ${CONFIG}\n${e.message}`);
    process.exit(1);
  }
  const bak = `${CONFIG}.bak-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  copyFileSync(CONFIG, bak);
  console.log(`バックアップ: ${bak}`);
} else {
  mkdirSync(dirname(CONFIG), { recursive: true });
}

cfg.mcpServers = cfg.mcpServers || {};
// デスクトップアプリは PATH が最小限で起動するため、node は絶対パスで指定する
cfg.mcpServers["google-analytics"] = { command: process.execPath, args: [SERVER] };
writeFileSync(CONFIG, JSON.stringify(cfg, null, 2) + "\n");

console.log(`✅ 登録しました: ${CONFIG}`);
console.log(`   command: ${process.execPath}`);
console.log(`   args:    ${SERVER}`);
console.log("\n次: Claude アプリを完全に終了（⌘Q）して再起動してください。");
console.log("\nClaude Code（ターミナル版）でも使う場合は次も実行:");
console.log(`   claude mcp add google-analytics -s user -- "${process.execPath}" "${SERVER}"`);
