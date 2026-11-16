// サイト共通の線画アイコン（絵文字の代わり）。24x24、線は currentColor、大きさは font-size（1em）に合わせる。
// 使い方（.astro）: <span class="..." aria-hidden="true" set:html={iconSvg('bars')} />
// 足すときは下の ICONS に名前と中身（<path> など）を1行足す。線の太さ・角の丸みは svg 側でそろえている。
const ICONS = {
  // ツール
  bars: '<rect x="4" y="4.5" width="15" height="3.5" rx="1"/><rect x="4" y="10.25" width="10" height="3.5" rx="1"/><rect x="4" y="16" width="6" height="3.5" rx="1"/>',
  line: '<path d="M4 4v16h16"/><path d="M7.5 15l4-4.5 3 2.5 5-6"/>',
  pie: '<path d="M11 5a8 8 0 1 0 8 8h-8z"/><path d="M14.5 3.5a6 6 0 0 1 6 6h-6z"/>',
  trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0z"/><path d="M8 6H5a3 3 0 0 0 3 4"/><path d="M16 6h3a3 3 0 0 1-3 4"/><path d="M12 13v4"/><path d="M8.5 20h7"/><path d="M10 17h4"/>',
  podium: '<path d="M9 20V8h6v12"/><path d="M9 13H3v7"/><path d="M15 15.5h6V20"/><path d="M2 20h20"/>',
  flag: '<path d="M5 21V4"/><path d="M5 4h14v9H5"/><path d="M9.67 4v9M14.33 4v9M5 8.5h14"/>',
  ladder: '<path d="M6 3v18M12 3v18M18 3v18"/><path d="M6 8h6M12 13h6M6 17h6"/>',
  // 有料機能
  noWatermark: '<path d="M12 3.5s6 6 6 10.5a6 6 0 0 1-12 0c0-4.5 6-10.5 6-10.5z"/><path d="M4 4l16 16"/>',
  sparkle: '<path d="M12 3c.6 4.8 4.2 8.4 9 9-4.8.6-8.4 4.2-9 9-.6-4.8-4.2-8.4-9-9 4.8-.6 8.4-4.2 9-9z"/>',
  hd: '<rect x="3" y="4.5" width="18" height="12" rx="2"/><path d="M8.5 20h7M12 16.5V20"/><path d="M8 8.5v4M8 10.5h2.5M10.5 8.5v4"/><path d="M13.5 8.5v4h1a2 2 0 0 0 0-4z"/>',
  transparent: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M5 5h7v7H5zM12 12h7v7h-7z" fill="currentColor" stroke="none" opacity=".3"/>',
  pill: '<rect x="3" y="8" width="18" height="8" rx="4"/>',
  image: '<rect x="3.5" y="5" width="17" height="14" rx="2"/><circle cx="8.5" cy="10" r="1.5"/><path d="M20.5 15.5l-4.5-4.5-7.5 8"/>',
  music: '<path d="M9 18V5.5l10-2V16"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/>',
  sound: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6"/><path d="M18 6.5a7.5 7.5 0 0 1 0 11"/>',
  gift: '<rect x="4" y="10" width="16" height="10" rx="1"/><path d="M3 7h18v3H3zM12 7v13"/><path d="M12 7c-1.5-3.5-5.5-3.5-5-1 .3 1 2 1 5 1zM12 7c1.5-3.5 5.5-3.5 5-1-.3 1-2 1-5 1z"/>',
};

export function iconSvg(name) {
  const body = ICONS[name];
  if (!body) throw new Error(`[icons] 未定義のアイコン: ${name}`);
  return `<svg class="grs-icon" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;
}
