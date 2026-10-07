# Trend Search Engine

Tool nay la trend-search engine offline-first cho Codex. No crawl raw items, extract topic,
cluster, score theo cong thuc `growth + engagement + novelty - competition`, tao content
angles va xuat JSON de Codex dung tiep.

CLI khong can dependency npm va khong tu goi LLM. Mac dinh crawler khong dung network.
Dung `--live` hoac bat `"crawler.allowNetwork": true` de quet public source thuc te.
Voi AI Agent, default live source hien tap trung vao YouTube + TikTok:

- YouTube search via public Invidious API (`youtube-invidious`) by default; direct YouTube page scrape (`youtube-search`) is available but disabled by default.
- TikTok search via public TikWM endpoint (`tiktok-tikwm`) by default; direct TikTok search/hashtag page scrape (`tiktok-search`) is available but disabled by default.
- Google News RSS / Google Trends daily RSS co adapter nhung disabled mac dinh cho AI
- Generic RSS/Atom feeds, Reddit, Hacker News, GitHub Trending van con adapter neu tu them source vao config

Neu network loi hoac du lieu qua it, tool van fallback seed data tru khi dung `--no-fallback`.
YouTube public Invidious instances co the tra `401`/`403`; khi do output se co warning.
Muon on dinh production thi nen them YouTube Data API hoac `yt-dlp` provider sau.

## Files

- `trend-search.mjs`: CLI Node ESM tu-contained.
- `config.example.json`: config mau.
- `data/trend-search-db.json`: DB JSON mau voi schema `trend_topics`, `trend_angles`, `raw_items`, `runs`.
- `codex-skill/SKILL.md`: skill de Codex goi CLI theo workflow on dinh.

## Init workspace

Mac dinh workspace la chinh folder tool:

```bash
cd /home/thinnh2/.understand-anything
node tools/trend-search/trend-search.mjs init --root tools/trend-search --force
```

Hoac tao workspace rieng trong project/tmp:

```bash
node tools/trend-search/trend-search.mjs init --root /tmp/trend-search-demo
```

Lenh init tao:

```text
config.json
data/trend-search-db.json
```

## Chay pipeline mot lan

```bash
node tools/trend-search/trend-search.mjs run-once --root /tmp/trend-search-demo --pretty
```

Chay quet live source thuc te:

```bash
node tools/trend-search/trend-search.mjs run-once \
  --root /tmp/trend-search-demo \
  --category ai \
  --live \
  --pretty
```

Chi lay live data, khong chen seed fallback:

```bash
node tools/trend-search/trend-search.mjs run-once \
  --root /tmp/trend-search-demo \
  --category ai \
  --live \
  --no-fallback \
  --pretty
```

Dry-run khong ghi DB:

```bash
node tools/trend-search/trend-search.mjs run-once --root /tmp/trend-search-demo --dry-run --pretty
```

Pipeline gom:

1. `crawl`: lay RSS neu config cho phep, fallback seed data.
2. `extract-topics`: tach phrase, normalize keyword, cluster theo category.
3. `score`: tinh score deterministic.
4. `angle`: tao content angles deterministic de Codex/LLM co the mo rong sau.

## Lay trends

```bash
node tools/trend-search/trend-search.mjs get-trends \
  --root /tmp/trend-search-demo \
  --category ai \
  --limit 20 \
  --pretty
```

Output:

```json
{
  "topics": []
}
```

## Lay chi tiet topic

```bash
node tools/trend-search/trend-search.mjs get-topic-details \
  --root /tmp/trend-search-demo \
  --topic-id topic_ai_ai-agents \
  --pretty
```

Output:

```json
{
  "topic": {},
  "angles": []
}
```

## Crawl rieng

```bash
node tools/trend-search/trend-search.mjs crawl --root /tmp/trend-search-demo --category tech --pretty
```

## Recompute topics/scores

```bash
node tools/trend-search/trend-search.mjs extract-topics --root /tmp/trend-search-demo --category ai --pretty
node tools/trend-search/trend-search.mjs score --root /tmp/trend-search-demo --category ai --pretty
```

## Watch mode

```bash
node tools/trend-search/trend-search.mjs run-once \
  --root /tmp/trend-search-demo \
  --watch \
  --interval-minutes 60
```

## Export

```bash
node tools/trend-search/trend-search.mjs export \
  --root /tmp/trend-search-demo \
  --format md \
  --out trend-export.md
```

## Config notes

- Categories supported: `ai`, `beauty`, `tech`, `business`.
- DB path mac dinh: `data/trend-search-db.json`, relative voi config file.
- `competitionHints` la placeholder heuristic cho search-result/market competition.
- `sources[].type` supports `youtube-invidious`, `youtube-search`, `tiktok-tikwm`, `tiktok-search`, `rss`, `google-news-rss`, `google-trends-rss`, `reddit`, `hackernews`, and `github-trending`.
- Live crawling requires either `--live` or `"crawler.allowNetwork": true`.
- Angle generation hien deterministic local. Codex skill co the dung topic detail de viet ban
  phan tich sau bang LLM, nhung CLI khong phu thuoc LLM.
