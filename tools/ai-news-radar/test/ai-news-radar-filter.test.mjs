import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { runOnce } from '../ai-news-radar.mjs';

test('global AI keyword filtering and maxItems cap keep the digest focused', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-news-radar-test-'));
  const feed = buildRssFeed();
  const feedUrl = `data:application/rss+xml;charset=utf-8,${encodeURIComponent(feed)}`;
  const configPath = path.join(tempDir, 'config.json');
  const config = {
    report: {
      title: 'AI Radar Digest',
      timezone: 'UTC',
      hours: 24,
      maxItems: 40,
      maxNews: 100,
      maxReddit: 100,
      maxVideos: 100,
      maxPerSource: 0,
      requireKeyword: true,
      sendWhenEmpty: false
    },
    request: {
      timeoutMs: 5000
    },
    stateFile: path.join(tempDir, 'state.json'),
    translation: {
      enabled: false
    },
    keywords: [
      'ai',
      'artificial intelligence',
      'llm',
      'openai'
    ],
    newsFeeds: [
      {
        name: 'Mixed Test Feed',
        url: feedUrl
      }
    ],
    siteMaps: [],
    jsonSources: [],
    redditFeeds: [],
    youtubeFeeds: [],
    youtubeSearch: {
      enabled: false
    }
  };
  await fs.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);

  const stdout = await captureConsoleLog(() => runOnce({
    args: {
      dryRun: true,
      ignoreState: true
    },
    config,
    configPath
  }));

  assert.match(stdout, /Selected 40 item\(s\) to preview\./);
  assert.doesNotMatch(stdout, /Sports market update/);
  assert.match(stdout, /AI model breakthrough 0/);
  assert.match(stdout, /AI model breakthrough 39/);
  assert.doesNotMatch(stdout, /AI model breakthrough 40/);
});

function buildRssFeed() {
  const items = [];
  const now = Date.now();
  for (let index = 0; index < 45; index += 1) {
    items.push({
      title: `AI model breakthrough ${index}`,
      link: `https://example.test/ai-${index}`,
      description: `New LLM and artificial intelligence result ${index}.`,
      pubDate: new Date(now - index * 1000).toUTCString()
    });
  }

  items.unshift({
    title: 'Sports market update',
    link: 'https://example.test/sports-market-update',
    description: 'Football clubs and ticket prices moved today.',
    pubDate: new Date(now + 1000).toUTCString()
  });

  return `<?xml version="1.0" encoding="UTF-8" ?>
<rss version="2.0">
  <channel>
    <title>Mixed Test Feed</title>
    ${items.map((item) => `
    <item>
      <title>${escapeXml(item.title)}</title>
      <link>${escapeXml(item.link)}</link>
      <description>${escapeXml(item.description)}</description>
      <pubDate>${escapeXml(item.pubDate)}</pubDate>
    </item>`).join('')}
  </channel>
</rss>`;
}

async function captureConsoleLog(callback) {
  const originalLog = console.log;
  const lines = [];
  console.log = (...args) => {
    lines.push(args.map(String).join(' '));
  };
  try {
    await callback();
  } finally {
    console.log = originalLog;
  }
  return lines.join('\n');
}

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}
