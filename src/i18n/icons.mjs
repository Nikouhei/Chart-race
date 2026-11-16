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
  // 用途・安心ポイント（トップページ）
  phone: '<rect x="7" y="3" width="10" height="18" rx="2"/><path d="M11 17.5h2"/>',
  gamepad: '<rect x="2.5" y="7" width="19" height="10" rx="5"/><path d="M7 10.5v3M5.5 12h3"/><path d="M15.5 11h.01M17.5 13h.01"/>',
  briefcase: '<rect x="3" y="7.5" width="18" height="12" rx="2"/><path d="M9 7.5V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v1.5"/><path d="M3 13h18"/>',
  cap: '<path d="M2.5 9.5L12 5l9.5 4.5L12 14z"/><path d="M6.5 11.5V16c1.5 1.5 3.5 2 5.5 2s4-.5 5.5-2v-4.5"/><path d="M21.5 9.5V14"/>',
  lock: '<rect x="5" y="11" width="14" height="9.5" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  save: '<path d="M5 4h11l4 4v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z"/><path d="M8 4v5h7V4"/><path d="M7.5 20v-7h9v7"/>',
  shield: '<path d="M12 3l7.5 3v5.5c0 4.5-3 8-7.5 9.5-4.5-1.5-7.5-5-7.5-9.5V6z"/><path d="M9 12l2.2 2.2L15 10.5"/>',
  // LP の特長カード
  camera: '<rect x="3" y="7" width="12" height="10" rx="2"/><path d="M15 10.5l6-3v9l-6-3z"/>',
  shuffle: '<path d="M3 7h3.5c5 0 6 10 11 10H21"/><path d="M3 17h3.5c1.6 0 2.8-1 3.8-2.4M13.7 9.4c1-1.4 2.2-2.4 3.8-2.4H21"/><path d="M18.5 4.5L21 7l-2.5 2.5M18.5 14.5L21 17l-2.5 2.5"/>',
  megaphone: '<path d="M4 10v4h3l8 4V6l-8 4z"/><path d="M18 9.5a4 4 0 0 1 0 5"/><path d="M7.5 14v4.5H10v-3.3"/>',
  video: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M10 9.5v5l4.5-2.5z"/>',
  bolt: '<path d="M13 3L5 13.5h6L10 21l8-10.5h-6z"/>',
  play: '<circle cx="12" cy="12" r="9"/><path d="M10 8.5v7l5.5-3.5z"/>',
  sizes: '<rect x="3" y="8" width="11" height="8" rx="1.5"/><rect x="16" y="4" width="5" height="16" rx="1.5"/>',
  table: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M3.5 9.5h17M3.5 14.5h17M9.5 9.5v10"/>',
  sliders: '<path d="M4 7h9M17 7h3M4 12h3M11 12h9M4 17h11M19 17h1"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="17" r="2"/>',
  donut: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><path d="M12 3v5M19.8 16.5l-4.3-2.5"/>',
  lineFlag: '<path d="M3 18l5-5 4 3 5-7"/><path d="M17 9V3h4.5l-1 1.75 1 1.75H17"/>',
  swap: '<path d="M4 8h14M15 5l3 3-3 3"/><path d="M20 16H6M9 13l-3 3 3 3"/>',
  browser: '<rect x="3" y="4.5" width="18" height="15" rx="2"/><path d="M3 9h18"/><path d="M6 6.75h.01M8.5 6.75h.01"/><path d="M9.5 14.5l2 2 3.5-4"/>',
};

export function iconSvg(name) {
  const body = ICONS[name];
  if (!body) throw new Error(`[icons] 未定義のアイコン: ${name}`);
  return `<svg class="grs-icon" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;
}
