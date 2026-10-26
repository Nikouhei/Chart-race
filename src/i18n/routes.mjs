/*
 * ページ対応表（言語ごとの URL の対応関係）
 *
 * hreflang・言語切替・sitemap の alternate・ヘッダーのリンク先は、すべてこの表から作る。
 * ここに無いページも sitemap には自動で載る（ただし他言語との対応関係は付かない）。
 *
 *   id     : ページの識別子（Astro ページの pageId と一致させる）
 *   paths  : 言語コード → URL パス（その言語のページが無ければ書かない）
 *   drafts : まだ公開しない言語。本番ビルドでは出力から外し、hreflang・sitemap・言語切替にも出さない。
 *            （preview ブランチと INCLUDE_DRAFTS=1 のときだけ出力。robots noindex 付き）
 *
 * 英語版を公開するとき: paths に en を足す → 作って確認 → drafts から 'en' を消す。
 */

export const PAGES = [
  { id: 'home', paths: { ja: '/', en: '/en/' } },

  // ツールの LP
  { id: 'bar-chart-race', paths: { ja: '/bar-chart-race/', en: '/en/bar-chart-race/' } },
  { id: 'line-chart-race', paths: { ja: '/regular-chart/', en: '/en/regular-chart/' } },
  { id: 'pie-chart-race', paths: { ja: '/pie-chart-race/', en: '/en/pie-chart-race/' } },
  { id: 'tournament', paths: { ja: '/tournament-bracket-animator/', en: '/en/tournament-bracket-animator/' } },
  { id: 'ranking-video', paths: { ja: '/ranking-video-maker/', en: '/en/ranking-video-maker/' } },
  { id: 'horse-race', paths: { ja: '/horse-race-ranking-maker/', en: '/en/horse-race-ranking-maker/' } },
  { id: 'amidakuji', paths: { ja: '/amidakuji-maker/' } },

  // ブログ・サイト情報
  { id: 'blog', paths: { ja: '/blog/' } },
  { id: 'about', paths: { ja: '/about.html', en: '/en/about.html' } },
  { id: 'terms', paths: { ja: '/terms.html', en: '/en/terms.html' } },
  { id: 'privacy', paths: { ja: '/privacy.html', en: '/en/privacy.html' } },
];

// ヘッダーのツールメニュー（カテゴリごと。並び順もこの通り）
//   PC はメガメニュー、スマホはハンバーガーのドロワーに、カテゴリ見出し付きで出る。
//   新しいツールは PAGES に足したうえで、ここに1行足すだけ（下書きの言語は自動で隠れる）。
//   cat: NAV_CATEGORIES の id / key: ツール名 / desc: 一行説明（どちらも ui.mjs）/ icon: 絵文字
export const NAV_CATEGORIES = [
  { id: 'graph', key: 'nav.cat.graph' },
  { id: 'ranking', key: 'nav.cat.ranking' },
  { id: 'other', key: 'nav.cat.other' },
];
export const NAV_TOOLS = [
  { id: 'bar-chart-race', cat: 'graph', icon: '📊', key: 'nav.barChartRace', desc: 'nav.desc.barChartRace' },
  { id: 'line-chart-race', cat: 'graph', icon: '📈', key: 'nav.lineChartRace', desc: 'nav.desc.lineChartRace' },
  { id: 'pie-chart-race', cat: 'graph', icon: '🥧', key: 'nav.pieChartRace', desc: 'nav.desc.pieChartRace' },
  { id: 'tournament', cat: 'ranking', icon: '🏆', key: 'nav.tournament', desc: 'nav.desc.tournament' },
  { id: 'ranking-video', cat: 'ranking', icon: '🥇', key: 'nav.rankingVideo', desc: 'nav.desc.rankingVideo' },
  { id: 'horse-race', cat: 'ranking', icon: '🏇', key: 'nav.horseRace', desc: 'nav.desc.horseRace' },
  { id: 'amidakuji', cat: 'other', icon: '🎲', key: 'nav.amidakuji', desc: 'nav.desc.amidakuji' },
];

// フッターのリンク
export const FOOTER_LINKS = [
  { id: 'blog', key: 'footer.blog' },
  { id: 'about', key: 'footer.about' },
  { id: 'terms', key: 'footer.terms' },
  { id: 'privacy', key: 'footer.privacy' },
];
