/*
 * AI 向けスキル（ai-skill/<名前>/）を dist/ai/ に配る形で書き出す（build/postbuild.mjs から呼ぶ）
 *
 *   dist/ai/<名前>.zip       … Claude 用。zip の中は「<名前>/SKILL.md」（フォルダごと）
 *   dist/ai/<名前>/SKILL.md  … Gemini 用。Gemini の「スキル → アップロード」は SKILL.md 単体を受け付ける
 *
 * zip は外部ライブラリを使わず、Node の zlib（deflate・crc32）で作る。
 * 中身が同じなら毎回同じバイト列になるよう、日時は固定にする（キャッシュ・差分のため）。
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const FIXED_DOS_TIME = 0;            // 00:00:00
const FIXED_DOS_DATE = (2026 - 1980) << 9 | 1 << 5 | 1; // 2026-01-01

function listFiles(dir, base = dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.name.startsWith('.')) return [];
    return e.isDirectory() ? listFiles(full, base) : [path.relative(base, full).split(path.sep).join('/')];
  }).sort();
}

function makeZip(entries) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const comp = zlib.deflateRawSync(data, { level: 9 });
    const crc = zlib.crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);        // version needed
    local.writeUInt16LE(0x0800, 6);    // UTF-8 のファイル名
    local.writeUInt16LE(8, 8);         // deflate
    local.writeUInt16LE(FIXED_DOS_TIME, 10);
    local.writeUInt16LE(FIXED_DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBuf, comp);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(FIXED_DOS_TIME, 12);
    central.writeUInt16LE(FIXED_DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(comp.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + comp.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuf, end]);
}

const PROD_ORIGIN = 'https://graphrace-studio.com';

// siteOrigin を渡すと、スキル内の本番URLをその URL に置き換える
// （preview で配るスキルは preview のツールを開かせる。本番にまだない機能を試すため）
export function buildSkillZips(root, dist, { siteOrigin = PROD_ORIGIN } = {}) {
  const readText = (file) => {
    const buf = fs.readFileSync(file);
    if (siteOrigin === PROD_ORIGIN || !/\.(md|txt)$/i.test(file)) return buf;
    return Buffer.from(buf.toString('utf8').split(PROD_ORIGIN).join(siteOrigin), 'utf8');
  };
  const src = path.join(root, 'ai-skill');
  if (!fs.existsSync(src)) return [];
  const outDir = path.join(dist, 'ai');
  const made = [];
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    if (!e.isDirectory() || e.name.startsWith('.')) continue;
    const skillDir = path.join(src, e.name);
    if (!fs.existsSync(path.join(skillDir, 'SKILL.md'))) continue;
    const files = listFiles(skillDir);
    const zip = makeZip(files.map((f) => ({ name: `${e.name}/${f}`, data: readText(path.join(skillDir, f)) })));
    fs.mkdirSync(path.join(outDir, e.name), { recursive: true });
    fs.writeFileSync(path.join(outDir, `${e.name}.zip`), zip);
    fs.writeFileSync(path.join(outDir, e.name, 'SKILL.md'), readText(path.join(skillDir, 'SKILL.md')));
    made.push(e.name);
  }
  return made;
}
