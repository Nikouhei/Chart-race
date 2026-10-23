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
  '.git', '.github', '.agents', '.claude', '.vscode', 'First Coding', 'analytics',
]);
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
  for (const d of parts.slice(0, -1)) {
    if (NEVER_DIRS.has(d)) return false;
    if (IGNORE.dirs.some((re) => re.test(d))) return false;
  }
  if (parts.length === 1 && NEVER_FILES.has(base)) return false;
  if (IGNORE.files.some((re) => re.test(base))) return false;
  return true;
}

// 配信対象の既存ファイルをすべて列挙
export function listLegacyFiles(dir = ROOT, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    const rel = path.relative(ROOT, abs).split(path.sep).join('/');
    if (entry.isDirectory()) {
      if (NEVER_DIRS.has(entry.name)) continue;
      if (IGNORE.dirs.some((re) => re.test(entry.name))) continue;
      listLegacyFiles(abs, out);
    } else if (entry.isFile() && isServableLegacy(rel)) {
      out.push(rel);
    }
  }
  return out;
}
