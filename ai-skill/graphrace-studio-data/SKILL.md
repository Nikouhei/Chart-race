---
name: graphrace-studio-data
description: Creates time-series ranking data (CSV) for GraphRace Studio's bar chart race, line chart race and pie chart race video tools. Use whenever the user wants data for a bar chart race, racing bar chart, line chart race, pie chart race or a "ranking over time" video, or asks for something like "how X changed over the years as a chart/video" — even if they don't say CSV or name the tool. Also triggers on Japanese requests such as バーチャートレース, 線グラフレース, 円グラフレース, ランキング動画, 〇〇の推移.
---

# GraphRace Studio data

Make CSV that loads directly into GraphRace Studio (https://graphrace-studio.com), a free browser tool that turns data into ranking videos. The tool reads columns **by position**, so the column layout must be exact.

## Before making data: check the theme

A race needs **several items competing in every period**. A single series over time (e.g. "Japan's GDP over the years", "the population of Tokyo") is **not** race data — never return a CSV with only one item.

- If the theme names one thing, or is too vague to choose the items (e.g. "economy", "sports"), **do not make data yet**. Ask the user one short question and offer 2–3 concrete race themes, e.g. 「日本のGDPの推移」→「GDP上位国のランキング推移」「日本の都道府県別GDPの推移」のどちらにしますか？
- Also ask when the period, region or measure is unclear and the choice changes the data a lot. Otherwise pick sensible defaults and say what you chose.

## Ask about extra columns

Before (or together with) the first CSV, ask the user once whether they want:

- **Category column** — groups items for colouring and a legend (e.g. continent, league, company type). Suggest a concrete grouping.
- **Image column** — an icon next to each bar.

If the user already said, or wants the data right away, make it without those columns and mention they can be added. Rules for image URLs:

- Use only images that may be reused in a published video: country flags from `https://flagcdn.com/w320/<code>.png` (public domain), or URLs the user gives you. Do not use logos, photos or images taken from websites, Wikipedia or search results — you cannot confirm the user may use them in a video.
- If no such image exists for the items (companies, people, products…), leave the column empty and tell the user so: e.g. 「企業ロゴなどは使ってよい画像URLを確認できないため、画像列は空欄にしています。使える画像があればURLを入れてください。」

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

With a category column, insert it as **column B** (header exactly `Category`, or `カテゴリ` in Japanese) and the image URL moves to column C:

```
Name,Category,Image URL,2000,2001,2002
Japan,Asia,https://flagcdn.com/w320/jp.png,4968,4374,4182
United States,North America,https://flagcdn.com/w320/us.png,10251,10582,10936
```

1. **Column A – name.** Short, common names that read well in a video ("South Korea", not "Republic of Korea"). Write names in the user's language (Japanese user → 日本, アメリカ, 韓国).
2. **Category (optional).** A few groups (about 2–8), short names in the user's language.
3. **Image URL.** Always keep this column, even when empty. See "Ask about extra columns" for which URLs are allowed (`<ISO 3166-1 alpha-2, lowercase>` for flags, e.g. `jp`, `us`, `gb`). Never guess image URLs.
4. **Then one column per period**, oldest → newest, left → right.
   - Header row: years as plain numbers (`2000`, not `2000年`, `FY2000` or `'00`). Dates like `2024-01` are fine for monthly data.
5. **Values: plain numbers only.** No thousands separators, units, `%`, currency symbols or text. State the unit in your reply instead.
6. **Unknown values: leave the cell empty.** No `-`, `N/A`, `null` or `0` as a placeholder.
7. Wrap names containing commas in double quotes.
8. Header labels follow the user's language (`項目名,画像URL,…` for Japanese).

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

1. Three lines, exactly in this form (the tool reads them and fills its title, source and unit fields). Use the Japanese labels when replying in Japanese:
   ```
   Title: <a short video title, e.g. GDP Ranking of Countries (1980–2023)>
   Source: <source names, short, e.g. IMF World Economic Outlook (Oct 2025)>
   Unit: <the unit as it should appear after each number, e.g. billion USD>
   ```
   (日本語: `タイトル: …` / `出典: …` / `単位: …`。単位は数字の後ろに付ける形で、例: `億ドル`、`万人`、`%`)
2. The CSV in **a single code block** (```csv). Nothing else inside the block.
3. Any estimated values, and whether images were left empty and why, in a few short lines.
4. How to load it — give the matching tool URL with `?ai=1&ref=skill` (add `&lang=en` when replying in English), e.g.
   `https://graphrace-studio.com/bar-chart-race/app/?ai=1&ref=skill`
   and tell the user: "Open this link, paste my whole reply into box 3, and press Load." (In Japanese: 「このリンクを開き、3番の欄にこの返事を丸ごと貼り付けて「読み込む」を押してください。」)
   If you can save files, you may also offer the CSV as a file; the tool loads CSV/Excel from the Data tab.
