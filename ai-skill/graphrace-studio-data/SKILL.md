---
name: graphrace-studio-data
description: Creates time-series ranking data (CSV) for GraphRace Studio's bar chart race, line chart race and pie chart race video tools. Use whenever the user wants data for a bar chart race, racing bar chart, line chart race, pie chart race or a "ranking over time" video, or asks for something like "how X changed over the years as a chart/video" — even if they don't say CSV or name the tool. Also triggers on Japanese requests such as バーチャートレース, 線グラフレース, 円グラフレース, ランキング動画, 〇〇の推移.
---

# GraphRace Studio data

Make CSV that loads directly into GraphRace Studio (https://graphrace-studio.com), a free browser tool that turns data into ranking videos. The tool reads columns **by position**, so the column layout must be exact.

## Pick the tool

| What the user wants | Tool | Tool URL |
|---|---|---|
| Bars that grow and overtake each other (default when unclear) | Bar chart race | `https://graphrace-studio.com/bar-chart-race/app/` |
| Lines that draw over time | Line chart race | `https://graphrace-studio.com/regular-chart/app/` |
| Shares of a whole changing over time | Pie chart race | `https://graphrace-studio.com/pie-chart-race/app/` |

## CSV layout (all three tools)

```
Name,Image URL,2000,2001,2002
Japan,https://flagcdn.com/w320/jp.png,4968,4374,4182
United States,https://flagcdn.com/w320/us.png,10251,10582,10936
```

1. **Column A – name.** Short, common names that read well in a video ("South Korea", not "Republic of Korea"). Write names in the user's language (Japanese user → 日本, アメリカ, 韓国).
2. **Column B – image URL.**
   - Countries/territories: `https://flagcdn.com/w320/<ISO 3166-1 alpha-2, lowercase>.png` (e.g. `jp`, `us`, `gb`).
   - Anything else: leave **empty** unless you have verified the URL exists. Never guess image URLs.
3. **Column C onward – one column per period**, oldest → newest, left → right.
   - Header row: years as plain numbers (`2000`, not `2000年`, `FY2000` or `'00`). Dates like `2024-01` are fine for monthly data.
4. **Values: plain numbers only.** No thousands separators, units, `%`, currency symbols or text. State the unit in your reply instead.
5. **Unknown values: leave the cell empty.** No `-`, `N/A`, `null` or `0` as a placeholder.
6. Wrap names containing commas in double quotes.
7. Header labels for A and B follow the user's language (`項目名,画像URL,…` for Japanese).

### Tool-specific notes

- **Bar chart race:** about 10–30 items. More items mean more overtaking, which is more fun to watch; the tool can limit how many bars it shows.
- **Line chart race:** about 3–10 items. Too many lines become unreadable.
- **Pie chart race:** about 3–10 items. Each period's values must be parts of the same whole in the same unit. Prefer raw amounts over percentages when you have them.
- Aim for **10+ periods** so the animation has room to move.

## Accuracy

- Prefer official or well-known sources (World Bank, IMF, UN, OECD, national statistics offices, Our World in Data). If you can browse or run code, fetch real data instead of writing numbers from memory.
- If you fill gaps by estimation or interpolation, say which items/periods.
- If the request is too large to produce reliably by hand (roughly more than 1,500 cells), say so and either narrow the scope with the user or, if you can run code, generate the CSV from a source API.

## Reply format

1. One short line on what the data is and its unit.
2. The CSV in **a single code block** (```csv). Nothing else inside the block.
3. Sources, and any estimated values, in a few short lines.
4. How to load it — give the matching tool URL with `?ai=1&ref=skill` (add `&lang=en` when replying in English), e.g.
   `https://graphrace-studio.com/bar-chart-race/app/?ai=1&ref=skill`
   and tell the user: "Open this link, paste my whole reply into box 3, and press Load." (In Japanese: 「このリンクを開き、3番の欄にこの返事を丸ごと貼り付けて「読み込む」を押してください。」)
   If you can save files, you may also offer the CSV as a file; the tool loads CSV/Excel from the Data tab.
