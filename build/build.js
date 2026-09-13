#!/usr/bin/env node
"use strict";
/*
 * GraphRace Studio デプロイ用ビルドスクリプト
 * -------------------------------------------------
 * ソース（このリポジトリ）は今まで通り可読のまま編集する。
 * このスクリプトは dist/ にビルド成果物を出力する。
 *   1. 全ツールの JS（外部ファイル + インラインscript）を Terser でミニファイ
 *   2. horse-race-ranking-maker の「開始時に1回しか呼ばれない関数」だけを
 *      javascript-obfuscator で難読化してからミニファイ
 *      （毎フレーム実行される applyCamera / renderPreviewFrame /
 *        getInterpolatedYearData / laneLateralAt は対象外＝速度に影響しない）
 *
 * 実行: npm run build
 * 出力: dist/ （.assetsignore と同じ考え方で除外したファイルを反映）
 */

const fs = require("fs");
const path = require("path");
const { minify } = require("terser");
const JavaScriptObfuscator = require("javascript-obfuscator");
const acorn = require("acorn");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "dist");

const IGNORE_DIRS = new Set([".git", ".agents", ".claude", "First Coding", "node_modules", "dist", "build"]);
const IGNORE_FILE_PATTERNS = [
  /^\.DS_Store$/,
  /\.bak$/,
  /\.orig$/,
  /\.swp$/,
  /^スクリーンショット/,
  /^generate-sitemap\.js$/,
];

const OBFUSCATE_TARGETS = {
  "horse-race-ranking-maker/real3d.js": [
    "laneSolveStep",
    "laneTargets",
    "laneBuildTo",
    "cornerCamPos",
    "splitScrollP",
    "buildShotPlan",
    "fitCamera",
  ],
  "horse-race-ranking-maker/index.html": ["buildRace"],
};

const OBFUSCATOR_OPTIONS = {
  compact: true,
  controlFlowFlattening: true,
  controlFlowFlatteningThreshold: 0.75,
  deadCodeInjection: true,
  deadCodeInjectionThreshold: 0.4,
  identifierNamesGenerator: "hexadecimal",
  renameGlobals: false,
  selfDefending: false,
  stringArray: true,
  stringArrayEncoding: ["rc4"],
  stringArrayThreshold: 0.75,
  splitStrings: true,
  splitStringsChunkLength: 8,
  numbersToExpressions: true,
  simplify: true,
  transformObjectKeys: false,
  unicodeEscapeSequence: false,
};

const stats = { obfuscated: [], minifiedJs: 0, minifiedInline: 0, copied: 0, warnings: [] };

function shouldIgnoreDir(name) {
  return IGNORE_DIRS.has(name);
}
function shouldIgnoreFile(name) {
  return IGNORE_FILE_PATTERNS.some((re) => re.test(name));
}

function findFunctionRanges(code, names) {
  const ranges = [];
  let ast;
  try {
    ast = acorn.parse(code, { ecmaVersion: "latest", sourceType: "script" });
  } catch (e) {
    return { ranges, error: e.message };
  }
  const remaining = new Set(names);
  (function walk(node) {
    if (!node || typeof node.type !== "string") return;
    if (node.type === "FunctionDeclaration" && node.id && remaining.has(node.id.name)) {
      ranges.push({ name: node.id.name, start: node.start, end: node.end });
      remaining.delete(node.id.name);
    }
    for (const key in node) {
      if (key === "start" || key === "end" || key === "loc" || key === "range") continue;
      const val = node[key];
      if (Array.isArray(val)) {
        for (const item of val) {
          if (item && typeof item.type === "string") walk(item);
        }
      } else if (val && typeof val.type === "string") {
        walk(val);
      }
    }
  })(ast);
  return { ranges, error: null };
}

function obfuscateTargetFunctions(code, names, label, foundNamesOut) {
  const { ranges, error } = findFunctionRanges(code, names);
  if (error) {
    stats.warnings.push(`${label} :: acornパース失敗 (${error})`);
    return code;
  }
  if (ranges.length === 0) return code;
  ranges.sort((a, b) => b.start - a.start);
  let out = code;
  for (const r of ranges) {
    const original = out.slice(r.start, r.end);
    let obfuscated;
    try {
      obfuscated = JavaScriptObfuscator.obfuscate(original, OBFUSCATOR_OPTIONS).getObfuscatedCode();
    } catch (e) {
      stats.warnings.push(`${label} :: ${r.name}() の難読化に失敗 (${e.message})`);
      continue;
    }
    out = out.slice(0, r.start) + obfuscated + out.slice(r.end);
    stats.obfuscated.push(`${label} :: ${r.name}()`);
    if (foundNamesOut) foundNamesOut.add(r.name);
  }
  return out;
}

async function minifyJs(code, label) {
  const result = await minify(code, {
    compress: { passes: 2 },
    mangle: true,
    format: { comments: false },
  });
  if (result.error) {
    stats.warnings.push(`${label} のミニファイに失敗 (${result.error.message})`);
    return code;
  }
  return result.code;
}

async function processExternalJs(relPath, code) {
  const targets = OBFUSCATE_TARGETS[relPath];
  let out = code;
  if (targets) {
    const found = new Set();
    out = obfuscateTargetFunctions(out, targets, relPath, found);
    for (const name of targets) {
      if (!found.has(name)) stats.warnings.push(`${relPath} :: ${name}() が見つからなかった`);
    }
  }
  out = await minifyJs(out, relPath);
  stats.minifiedJs++;
  return out;
}

function extractScriptBlocks(html) {
  const re = /<script([^>]*)>([\s\S]*?)<\/script>/gi;
  const blocks = [];
  let m;
  while ((m = re.exec(html)) !== null) {
    const [full, attrs, body] = m;
    if (/\bsrc\s*=/i.test(attrs)) continue;
    if (/type\s*=\s*["']application\/ld\+json["']/i.test(attrs)) continue;
    if (!body.trim()) continue;
    blocks.push({ start: m.index, end: m.index + full.length, attrs, body });
  }
  return blocks;
}

async function processHtml(relPath, html) {
  const targets = OBFUSCATE_TARGETS[relPath];
  const blocks = extractScriptBlocks(html);
  if (blocks.length === 0) return html;

  const foundAcrossBlocks = new Set();
  let out = "";
  let cursor = 0;
  for (const blk of blocks) {
    out += html.slice(cursor, blk.start);
    let body = blk.body;
    if (targets) {
      body = obfuscateTargetFunctions(body, targets, relPath, foundAcrossBlocks);
    }
    let minified;
    try {
      minified = await minifyJs(body, relPath);
    } catch (e) {
      stats.warnings.push(`${relPath} のインラインscript処理に失敗 (${e.message})`);
      minified = body;
    }
    stats.minifiedInline++;
    out += `<script${blk.attrs}>${minified}</script>`;
    cursor = blk.end;
  }
  out += html.slice(cursor);

  if (targets) {
    for (const name of targets) {
      if (!foundAcrossBlocks.has(name)) stats.warnings.push(`${relPath} :: ${name}() が見つからなかった`);
    }
  }
  return out;
}

async function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (shouldIgnoreDir(entry.name)) continue;
      await walk(path.join(dir, entry.name));
      continue;
    }
    if (shouldIgnoreFile(entry.name)) continue;
    const abs = path.join(dir, entry.name);
    const rel = path.relative(ROOT, abs).split(path.sep).join("/");
    const outAbs = path.join(OUT, rel);
    fs.mkdirSync(path.dirname(outAbs), { recursive: true });

    const ext = path.extname(entry.name).toLowerCase();
    if (ext === ".js") {
      const code = fs.readFileSync(abs, "utf-8");
      const out = await processExternalJs(rel, code);
      fs.writeFileSync(outAbs, out, "utf-8");
    } else if (ext === ".html") {
      const html = fs.readFileSync(abs, "utf-8");
      const out = await processHtml(rel, html);
      fs.writeFileSync(outAbs, out, "utf-8");
    } else {
      fs.copyFileSync(abs, outAbs);
      stats.copied++;
    }
  }
}

(async () => {
  if (fs.existsSync(OUT)) fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  await walk(ROOT);

  console.log("=== ビルド完了 ===");
  console.log(`ミニファイした外部JS: ${stats.minifiedJs}`);
  console.log(`ミニファイしたインラインscript: ${stats.minifiedInline}`);
  console.log(`そのままコピーしたファイル: ${stats.copied}`);
  console.log(`難読化した関数 (${stats.obfuscated.length}):`);
  for (const o of stats.obfuscated) console.log("  - " + o);
  if (stats.warnings.length) {
    console.log("\n=== 警告 ===");
    for (const w of stats.warnings) console.log("  ! " + w);
  }
})();
