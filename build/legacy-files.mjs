/*
 * 「まだ Astro に移していない既存ファイル」を配信対象にするかの判定
 *
 * 既存の HTML・アプリ・画像はリポジトリ直下にそのまま置いたまま、ビルド時に dist へコピーする
 * （postbuild.mjs）。開発サーバー（astro dev）でも同じ判定で配信する（astro.config.mjs）。
 *
 * 除外ルールは .assetsignore を正とし、それに Astro まわりのファイルを足す。
 * 株価レース（stock-race/）は .assetsignore で除外済み。さらに念のため下の NEVER でも除外する。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// リポジトリ直下。Astro のビルド中はこのファイルが dist/ 内に束ねられて動くので、
// 自分の場所ではなく「astro.config.mjs がある場所」を探す（npm スクリプトは直下で動く）
function findRoot() {
  const here = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  for (const dir of [here, process.cwd()]) {
    if (fs.existsSync(path.join(dir, 'astro.config.mjs'))) return dir;
  }
  return process.cwd();
}
export const ROOT = findRoot();

// .assetsignore に無くても絶対に配信しないもの
const NEVER_DIRS = new Set([
  'stock-race', // 未公開。公開の指示があるまで絶対に出さない
  'src', 'public', 'dist', 'build', 'node_modules', '.astro',
  '.git', '.github', '.agents', '.claude', '.vscode', '.idea', '.wrangler', 'First Coding', 'analytics',
]);

// 秘密情報・ローカル設定になりがちなファイル名（どの階層にあっても配信しない）
const SECRET_FILE_PATTERNS = [
  /service-account.*\.json$/i, /\.local\.json$/i, /\.(pem|key|p12|pfx)$/i, /credentials?.*\.json$/i,
];

// ドットで始まるファイル・フォルダ（.env・.dev.vars・.wrangler など）は原則配信しない。
// 例外として出してよいものだけここに書く
const DOT_ALLOW = new Set(['.well-known']);
const isHiddenName = (name) => name.startsWith('.') && !DOT_ALLOW.has(name);
// 開発中（未公開）のツール。本番（main）のビルドからは外し、preview ブランチ・
// INCLUDE_DRAFTS=1・開発サーバーでだけ配信する。公開するときはここから消す。
export const DRAFT_DIRS = new Set([
  // 例: 'xxx-tool', // 開発中のツール
]);

// 判定は src/i18n/utils.mjs の includeDrafts と同じ（main 以外のブランチ・開発中は下書きも出す）
export function includeDraftDirs(env = process.env) {
  if (env.INCLUDE_DRAFTS === '1') return true;
  if (env.INCLUDE_DRAFTS === '0') return false;
  const branch = env.WORKERS_CI_BRANCH || env.CF_PAGES_BRANCH || '';
  if (branch && branch !== 'main') return true;
  return env.NODE_ENV === 'development';
}

const NEVER_FILES = new Set([
  'astro.config.mjs', 'package.json', 'package-lock.json', 'tsconfig.json',
  'wrangler.jsonc', 'vercel.json', '.assetsignore', '.gitignore', '.node-version', '.npmrc',
  'generate-sitemap.js', 'CLAUDE.md',
]);

function globToRegExp(glob) {
  const esc = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp('^' + esc + '$');
}

function loadAssetsIgnore() {
  const file = path.join(ROOT, '.assetsignore');
  const dirs = [];
  const files = [];
  if (!fs.existsSync(file)) return { dirs, files };
  for (let line of fs.readFileSync(file, 'utf-8').split(/\r?\n/)) {
    line = line.trim();
    if (!line || line.startsWith('#')) continue;
    line = line.replace(/^\*\*\//, '').replace(/^\//, '');
    if (line.endsWith('/')) dirs.push(globToRegExp(line.slice(0, -1)));
    else files.push(globToRegExp(line));
  }
  return { dirs, files };
}

const IGNORE = loadAssetsIgnore();

// rel: リポジトリ直下からの相対パス（区切りは /）
export function isServableLegacy(rel) {
  const parts = rel.split('/').filter(Boolean);
  if (!parts.length) return false;
  const base = parts[parts.length - 1];
  if (parts.length > 1 && DRAFT_DIRS.has(parts[0]) && !includeDraftDirs()) return false;
  for (const d of parts.slice(0, -1)) {
    if (NEVER_DIRS.has(d) || isHiddenName(d)) return false;
    if (IGNORE.dirs.some((re) => re.test(d))) return false;
  }
  if (parts.length === 1 && NEVER_FILES.has(base)) return false;
  if (isHiddenName(base)) return false;
  if (SECRET_FILE_PATTERNS.some((re) => re.test(base))) return false;
  if (IGNORE.files.some((re) => re.test(base))) return false;
  return true;
}

// 配信対象の既存ファイルをすべて列挙
export function listLegacyFiles(dir = ROOT, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    const rel = path.relative(ROOT, abs).split(path.sep).join('/');
    if (entry.isDirectory()) {
      if (NEVER_DIRS.has(entry.name) || isHiddenName(entry.name)) continue;
      if (dir === ROOT && DRAFT_DIRS.has(entry.name) && !includeDraftDirs()) continue;
      if (IGNORE.dirs.some((re) => re.test(entry.name))) continue;
      listLegacyFiles(abs, out);
    } else if (entry.isFile() && isServableLegacy(rel)) {
      out.push(rel);
    }
  }
  return out;
}
