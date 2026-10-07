---
name: trend-search
description: Use when the user wants to discover, score, inspect, or write from trends across AI, beauty, tech, or business using the local Trend Search Engine.
metadata:
  short-description: Offline-first trend discovery and angle generation
---

# Trend Search

Use this skill when the user asks for trend discovery, trend research, trend scoring,
content angles, topic opportunities, or fresh topic ideas in `ai`, `beauty`, `tech`,
or `business`.

The CLI is deterministic and offline-first. It does not need an LLM and does not call
an LLM by itself. Use `--live` when the user asks for current or real-world trend
signals. For AI Agent trends, live mode defaults to YouTube search through public
Invidious API endpoints and TikTok search through the public TikWM endpoint. Direct
YouTube/TikTok page scrapers exist but are disabled by default because those pages
often block bots. Google News RSS, Google Trends daily RSS, Reddit, Hacker News,
GitHub Trending, and generic RSS adapters still exist for custom config, but they are
not the default AI Agent source mix. If network is unavailable or live sources are
thin, the CLI falls back to seed/sample data unless `--no-fallback` is passed.
If YouTube public Invidious instances return `401`/`403`, report that limitation and
use TikTok results; production-stable YouTube coverage should use a YouTube Data API
or `yt-dlp` provider later.

Prefer Vietnamese output when the user writes Vietnamese, unless they request another
language.

## Tool

External CLI:

```bash
/home/thinnh2/.understand-anything/tools/trend-search/trend-search.mjs
```

Default reusable workspace inside the tool:

```text
/home/thinnh2/.understand-anything/tools/trend-search/
```

Default DB:

```text
data/trend-search-db.json
```

DB schema:

```text
trend_topics, trend_angles, raw_items, runs
```

## Workflow: Init

If the target workspace has not been initialized, run:

```bash
/home/thinnh2/.understand-anything/tools/trend-search/trend-search.mjs init \
  --root <target-root>
```

For the reusable tool workspace, use:

```bash
/home/thinnh2/.understand-anything/tools/trend-search/trend-search.mjs init \
  --root /home/thinnh2/.understand-anything/tools/trend-search
```

Use `--force` only when the user explicitly wants to overwrite the existing config/DB.

## Workflow: Get Trends

1. Run the pipeline. Use `--live` when the user asks for current/real trend signals:

```bash
/home/thinnh2/.understand-anything/tools/trend-search/trend-search.mjs run-once \
  --root <target-root> \
  --category ai \
  --live \
  --pretty
```

Use `--no-fallback` only when the user explicitly wants to exclude local seed data.

2. Fetch ranked topics:

```bash
/home/thinnh2/.understand-anything/tools/trend-search/trend-search.mjs get-trends \
  --root <target-root> \
  --category ai \
  --limit 20 \
  --pretty
```

The command prints JSON:

```json
{
  "topics": []
}
```

Use the returned `topics` to answer the user. Mention that scores are deterministic
heuristics using:

```text
growth + engagement + novelty - competition
```

## Workflow: Get Topic Details

When the user picks a topic or asks for content angles, run:

```bash
/home/thinnh2/.understand-anything/tools/trend-search/trend-search.mjs get-topic-details \
  --root <target-root> \
  --topic-id <topic-id> \
  --pretty
```

The command prints JSON:

```json
{
  "topic": {},
  "angles": []
}
```

Use `topic.evidence` for citations/source context and `angles` as deterministic draft
angles. Codex may then refine copy, positioning, or recommendations for the user's
audience.

## Workflow: Watch

For recurring checks:

```bash
/home/thinnh2/.understand-anything/tools/trend-search/trend-search.mjs run-once \
  --root <target-root> \
  --watch \
  --interval-minutes 60
```

## Rules

- Do not claim the results are live web research unless `--live` was used or
  `crawler.allowNetwork` is true, and the returned evidence includes non-seed
  source types such as `youtube-invidious`, `youtube-search`, `tiktok-tikwm`,
  `tiktok-search`, `google-news-rss`, `google-trends-rss`, `reddit`, `hackernews`,
  `github-trending`, or `rss`.
- If the user specifically asks for TikTok/YouTube trend checks, keep the default AI
  source mix focused on `youtube-invidious` and `tiktok-tikwm`; do not add GitHub
  unless the user asks for developer/repo trends.
- If the output relies on seed data, say it is an offline/local heuristic run.
- Do not need an LLM to run the CLI.
- Use Vietnamese in the final explanation when the user writes Vietnamese.
- Keep generated recommendations tied to `topic.score`, `components`, `evidence`, and
  `angles`.
