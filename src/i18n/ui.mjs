/*
 * サイト共通 UI の辞書（ヘッダー・フッター・言語切替など、全ページで使う短い文言）
 *
 * ・ページ本文（LP・ブログ・法務）は辞書に入れず、言語ごとのページファイルに直接書く。
 *   英語版は翻訳ではなく英語圏の検索意図に合わせて書き直すため。
 * ・ツール画面（/xxx/app/）の文言は shared/i18n/ 以下の辞書で扱う（別の仕組み）。
 * ・キーが無い言語は日本語にフォールバックする（表示が空にならない）。
 */

export const UI = {
  ja: {
    'brand.logoAlt': 'GraphRace Studio ロゴ',
    'nav.ariaLabel': 'サービスメニュー',
    'nav.barChartRace': 'バーチャートレース',
    'nav.lineChartRace': '線グラフレース',
    'nav.tournament': 'トーナメント表',
    'nav.rankingVideo': 'ランキング動画',
    'nav.horseRace': '格付けダービー',
    'nav.amidakuji': 'あみだくじ',
    'footer.copyright': '© GraphRace Studio — データビジュアライゼーション＆動画演出ツール群',
    'footer.blog': 'ブログ',
    'footer.about': 'このツールについて',
    'footer.terms': '利用規約',
    'footer.privacy': 'プライバシーポリシー',
    'breadcrumb.ariaLabel': 'パンくずリスト',
    'breadcrumb.home': 'ホーム',
    'lang.switcherLabel': '表示言語',
  },
  en: {
    'brand.logoAlt': 'GraphRace Studio logo',
    'nav.ariaLabel': 'Tools',
    'nav.barChartRace': 'Bar Chart Race',
    'nav.lineChartRace': 'Line Chart Race',
    'nav.tournament': 'Tournament Bracket',
    'nav.rankingVideo': 'Ranking Video',
    'nav.horseRace': 'Ranking Derby',
    'nav.amidakuji': 'Ghost Leg (Amidakuji)',
    'footer.copyright': '© GraphRace Studio — Data visualization & video animation tools',
    'footer.blog': 'Blog',
    'footer.about': 'About',
    'footer.terms': 'Terms of Use',
    'footer.privacy': 'Privacy Policy',
    'breadcrumb.ariaLabel': 'Breadcrumb',
    'breadcrumb.home': 'Home',
    'lang.switcherLabel': 'Language',
  },
};
