// 英語ページの更新履歴（src/components/UpdateHistory.astro で表示）。
// 日本語版LP・トップの「更新履歴」を足したら、ここにも英語で足す（新しいものを上に）。
// 日本語ブログ・あみだくじなど英語版のないものは載せない。
const PRICING = '<a href="/en/pricing.html">paid plans</a>';

const PAID_CHART = (extra) => ({ date: '2026-11-21', isNew: true, text: `Launched ${PRICING} (7-Day Pass, monthly and yearly): export without the watermark and in higher quality. Also added ${extra}, plus “Create data with AI”. You can still create and export everything for free, as before.` });
const TEXT_STYLE = { date: '2026-11-07', isNew: true, text: 'Text is easier to read: choose a shadow strength, text outlines now scale with the font size, labels can be bold, and the “Title & source” settings have their own section.' };
const VIDEO_EXPORT = { date: '2026-10-10', text: 'Added video export: save your animation as an MP4 or WebM file, including from a phone browser.' };
const SAVE_BUTTON = { date: '2026-10-17', text: 'Added a “Save video” button to the timeline, and a save prompt when the preview finishes. If the page is opened inside an in-app browser (such as LINE), you are told up front that saving may not work.' };
const BGM = { date: '2026-11-27', isNew: true, text: 'Added background music: hear it in the preview and export it straight into your MP4 or WebM video. Tracks loop smoothly for longer videos and finish with a clean closing sting.' };
const CHART_HISTORY = [
  { date: '2026-07-10', text: 'Added support for a category column, with automatic colors per group and a legend.' },
  { date: '2026-07-01', text: 'You can now switch your data between the bar chart race and the line chart race.' },
  { date: '2026-06-29', text: 'Improved CSV / Excel import, including files with uncommon text encodings.' },
  { date: '2026-06-27', text: 'Added design options for playback, such as background color and grid lines.' },
  { date: '2026-06-25', text: 'Added backups: your work is saved automatically in your browser and can be restored.' },
  { date: '2026-06-24', text: 'Optimized for mobile: faster and easier to use on smartphones.' },
  { date: '2026-06-23', text: 'Added font and size settings.' },
  { date: '2026-06-20', text: 'GraphRace Studio launched.' },
];

export const UPDATES_EN = {
  home: [
    { date: '2026-11-27', isNew: true, text: 'Ranking Video: added video export. Save your countdown as an MP4 or WebM file — no screen recording needed. It is free, with no watermark.' },
    { date: '2026-11-27', isNew: true, text: 'Ranking Derby: reorganized the settings panel into clear sections so it is easier to find what you need.' },
    { date: '2026-11-27', isNew: true, text: 'Bar, line and pie chart races: added background music. Export it into your MP4 or WebM video, ending with a clean closing sting.' },
    { date: '2026-11-24', isNew: true, text: 'Bar chart race: you can now adjust how round the corners are (0–100%) on rounded bars. Bars are sorted largest first by default, so your data appears in ranking order right away.' },
    { date: '2026-11-21', isNew: true, text: `Launched ${PRICING} (7-Day Pass, monthly and yearly) for watermark-free, higher-quality exports. Everything can still be created and exported for free. Also added transparent-background export and rounded bars to the chart races, fanfare volume and export quality to Ranking Derby, and “Create data with AI”.` },
    { date: '2026-11-07', isNew: true, text: 'Bar, line and pie chart races: clearer text with a new shadow-strength option and outlines that scale with the font size. The line chart race no longer jumps when the axis maximum is set to “Auto”.' },
    { date: '2026-10-26', text: 'Released the Pie Chart Race maker: pie and donut charts whose shares change over time, saved as MP4 or WebM.' },
    { date: '2026-10-24', text: 'Bar and line chart races: legend settings now live in one “Legend” section, with position, direction and background options.' },
    { date: '2026-10-23', text: 'GraphRace Studio is now available in English.' },
    { date: '2026-10-17', text: 'Ranking Derby: videos can now be saved as MP4, rendered frame by frame so they stay smooth even on slower devices.' },
    { date: '2026-10-10', text: 'Bar and line chart races: export your animation as an MP4 or WebM video, including from a phone browser.' },
    { date: '2026-08-02', text: 'Ranking Derby: added the 3D mode, where horses race on a realistic course. Switch modes with one click and keep your entries and settings.' },
    { date: '2026-07-07', text: 'Released the Ranking Video maker, where ranking cards slide across the screen.' },
    { date: '2026-07-04', text: 'Released the Tournament Bracket animator.' },
    { date: '2026-06-20', text: 'GraphRace Studio launched.' },
  ],
  'bar-chart-race': [
    BGM,
    { date: '2026-11-24', isNew: true, text: 'You can now adjust how round the corners are (0–100%) on rounded bars. Bars are sorted largest first by default, so your data appears in ranking order right away.' },
    PAID_CHART('transparent-background export (MOV), rounded bars, images to the right of the bars, a total value display'),
    TEXT_STYLE,
    { date: '2026-10-24', text: 'Added a “Legend” section to the settings, gathering the category legend options (position, direction, text, background).' },
    SAVE_BUTTON,
    VIDEO_EXPORT,
    { date: '2026-10-01', text: 'Added video length presets (15, 30, 60 seconds or custom) and playback speeds (1x–8x), and made CSV import more reliable.' },
    ...CHART_HISTORY.filter((e) => e.date !== '2026-06-20'),
    { date: '2026-06-21', text: 'Added layout options for vertical social media videos.' },
    { date: '2026-06-20', text: 'GraphRace Studio launched.' },
  ],
  'line-chart-race': [
    BGM,
    PAID_CHART('transparent-background export (MOV), text color for transparent exports, a total value display'),
    { ...TEXT_STYLE, text: TEXT_STYLE.text + ' The line no longer jumps when the axis maximum is set to “Auto”.' },
    { date: '2026-10-24', isNew: true, text: 'Added a “Legend” section to the settings. The category legend now has the same position, direction and background options as the bar chart race.' },
    SAVE_BUTTON,
    VIDEO_EXPORT,
    { date: '2026-09-28', text: 'Choose where names and values appear (line ends, legend, both or hidden), set the legend position, and customize text size and color.' },
    { date: '2026-09-25', text: 'Added video length presets, playback speeds, a legend toggle and Y-axis guide lines.' },
    ...CHART_HISTORY.filter((e) => e.date !== '2026-06-20'),
    { date: '2026-06-22', text: 'Added icons and the latest value at the end of each line.' },
    { date: '2026-06-20', text: 'GraphRace Studio launched.' },
  ],
  'pie-chart-race': [
    BGM,
    PAID_CHART('transparent-background export (MOV), text color for transparent exports'),
    TEXT_STYLE,
    { date: '2026-10-26', isNew: true, text: 'Released the Pie Chart Race maker: switch between pie and donut, group small items into “Other”, fine-tune labels and the legend, and save as MP4 or WebM.' },
  ],
  'horse-race-ranking-maker': [
    { date: '2026-11-27', isNew: true, text: 'Tidied up the settings panel into clear sections: Play & save, Horses, Race, Screen & overlays, Intro & sound, and Results. Every section can be collapsed. The rider icon size now updates as soon as you move the slider.' },
    { date: '2026-11-21', isNew: true, text: `Launched ${PRICING} (7-Day Pass, monthly and yearly): export without the watermark, in 1080p, and with sound. Also added an export quality option, fanfare volume and crown decorations on the race card, and fixed the race title not showing before the start in 3D.` },
    { date: '2026-10-17', isNew: true, text: 'Videos can now be saved as MP4, rendered frame by frame so they stay smooth even on slower devices and play right away on phones.' },
    { date: '2026-08-02', isNew: true, text: 'Added the 3D mode, where horses race on a realistic course. Switch modes with the buttons at the top; your entries and race settings carry over.' },
    { date: '2026-07-18', text: 'Released Ranking Derby, a horse-race style ranking video maker.' },
  ],
  'ranking-video': [
    { date: '2026-11-27', isNew: true, text: 'Added video export: save your countdown as an MP4 or WebM file with no screen recording. Free, with no watermark.' },
    { date: '2026-11-21', isNew: true, text: `Launched ${PRICING} for other tools. The Ranking Video maker is not affected: every feature stays free, with no watermark.` },
    { date: '2026-07-07', isNew: true, text: 'Released the Ranking Video maker, where ranking cards slide in from the right.' },
  ],
  tournament: [
    { date: '2026-11-21', isNew: true, text: `Launched ${PRICING} for other tools. The Tournament Bracket animator is not affected: every feature stays free, with no watermark.` },
    { date: '2026-08-30', isNew: true, text: 'Added card background colors (white, soft gray, cream, lavender or a custom color).' },
    { date: '2026-08-14', text: 'Added card and image size settings.' },
    { date: '2026-07-04', text: 'Released the Tournament Bracket animator, where winners advance with animation.' },
  ],
};
