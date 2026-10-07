#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import process from 'node:process';
import tls from 'node:tls';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_CONFIG_PATH = path.join(__dirname, 'config.json');
const EXAMPLE_CONFIG_PATH = path.join(__dirname, 'config.example.json');
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const USER_AGENT = 'ai-news-radar/0.1 (personal email digest)';

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printHelp();
    return;
  }

  const { config, configPath, usedExampleConfig } = await loadConfig(args.config);
  if (usedExampleConfig) {
    console.warn(`No config.json found; using example config: ${configPath}`);
  }

  if (args.watch) {
    const intervalMinutes = Number(args.intervalMinutes ?? config.schedule?.intervalMinutes ?? 60);
    if (!Number.isFinite(intervalMinutes) || intervalMinutes <= 0) {
      throw new Error('--interval-minutes must be a positive number.');
    }

    for (;;) {
      await runOnce({ args, config, configPath });
      console.log(`Next check in ${intervalMinutes} minutes.`);
      await sleep(intervalMinutes * 60 * 1000);
    }
  }

  await runOnce({ args, config, configPath });
}

function parseArgs(argv) {
  const args = {
    config: process.env.AI_NEWS_RADAR_CONFIG,
    dryRun: false,
    ignoreState: false,
    watch: false,
    help: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      index += 1;
      if (index >= argv.length) {
        throw new Error(`${arg} needs a value.`);
      }
      return argv[index];
    };

    if (arg === '--config') args.config = next();
    else if (arg === '--hours') args.hours = Number(next());
    else if (arg === '--interval-minutes') args.intervalMinutes = Number(next());
    else if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--ignore-state') args.ignoreState = true;
    else if (arg === '--watch') args.watch = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }

  return args;
}

function printHelp() {
  console.log(`AI News Radar

Usage:
  node ai-news-radar.mjs --config config.example.json --dry-run
  node ai-news-radar.mjs --config config.local.json
  node ai-news-radar.mjs --config config.local.json --watch --interval-minutes 60

Options:
  --config <file>          JSON config file. Defaults to config.json when present.
  --hours <number>         Lookback window. Defaults to report.hours.
  --dry-run                Print digest instead of sending email.
  --ignore-state           Include items already sent before.
  --watch                  Keep polling in the current process.
  --interval-minutes <n>   Poll interval for --watch. Defaults to 60.
  --help                   Show this help.
`);
}

async function loadConfig(configArg) {
  const requestedPath = configArg ? path.resolve(configArg) : DEFAULT_CONFIG_PATH;
  try {
    return {
      config: JSON.parse(await fs.readFile(requestedPath, 'utf8')),
      configPath: requestedPath,
      usedExampleConfig: false
    };
  } catch (error) {
    if (error.code !== 'ENOENT' || configArg) {
      throw error;
    }
  }

  return {
    config: JSON.parse(await fs.readFile(EXAMPLE_CONFIG_PATH, 'utf8')),
    configPath: EXAMPLE_CONFIG_PATH,
    usedExampleConfig: true
  };
}

export async function runOnce({ args, config, configPath }) {
  const hours = Number(args.hours ?? config.report?.hours ?? 24);
  if (!Number.isFinite(hours) || hours <= 0) {
    throw new Error('--hours or report.hours must be a positive number.');
  }

  const now = new Date();
  const since = new Date(now.getTime() - hours * HOUR_MS);
  const warnings = [];
  const statePath = resolveStatePath(config, configPath);
  const state = await loadState(statePath);

  const collected = await collectItems({ config, since, warnings });
  const deduped = dedupeItems(collected)
    .filter((item) => isRecent(item, since))
    .filter((item) => passesSourceKeywordRule(item, config))
    .sort(comparePublishedDesc);

  const unseen = args.ignoreState ? deduped : deduped.filter((item) => !state.sent[item.id]);
  const skippedSentCount = args.ignoreState ? 0 : deduped.length - unseen.length;
  const maxItems = Number(config.report?.maxItems ?? 0);
  const maxNews = Number(config.report?.maxNews ?? 30);
  const maxReddit = Number(config.report?.maxReddit ?? 20);
  const maxVideos = Number(config.report?.maxVideos ?? 20);
  const maxPerSource = Number(config.report?.maxPerSource ?? 0);
  let news = limitItems(unseen.filter((item) => item.kind === 'news'), maxNews, maxPerSource);
  let reddit = limitItems(unseen.filter((item) => item.kind === 'reddit'), maxReddit, maxPerSource);
  let videos = limitItems(unseen.filter((item) => item.kind === 'video'), maxVideos, maxPerSource);
  ({ news, reddit, videos } = limitReportItems({ news, reddit, videos }, maxItems));
  const selected = [...news, ...reddit, ...videos];
  await maybeTranslateTitles({ config, items: selected, warnings });
  const report = buildReport({ config, news, reddit, videos, warnings, since, now, hours });
  const summary = buildRunSummary({
    totalRecent: deduped.length,
    skippedSentCount,
    selected,
    args
  });

  if (args.dryRun) {
    console.log(summary);
    console.log(report.text);
    return;
  }

  if (selected.length === 0 && config.report?.sendWhenEmpty !== true) {
    console.log(summary);
    console.log('No new unseen items found; email skipped.');
    if (!args.ignoreState && skippedSentCount > 0) {
      console.log('Use --ignore-state to preview/resend items that were already sent.');
    }
    return;
  }

  await sendDigestEmail({ config, report });
  markSent(state, selected);
  await saveState(statePath, state);
  console.log(summary);
  console.log(`Email sent with ${news.length} news item(s), ${reddit.length} Reddit item(s), and ${videos.length} video(s).`);
}

function buildRunSummary({ totalRecent, skippedSentCount, selected, args }) {
  const mode = args.ignoreState ? 'ignore-state' : 'dedupe';
  return [
    `Found ${totalRecent} recent item(s).`,
    `Skipped ${skippedSentCount} already-sent item(s).`,
    `Selected ${selected.length} item(s) to ${args.dryRun ? 'preview' : 'send'}.`,
    `Mode: ${mode}.`
  ].join(' ');
}

function limitItems(items, maxItems, maxPerSource) {
  if (!Number.isFinite(maxItems) || maxItems <= 0) return [];
  if (!Number.isFinite(maxPerSource) || maxPerSource <= 0) return items.slice(0, maxItems);

  const sourceCounts = new Map();
  const limited = [];
  for (const item of items) {
    const count = sourceCounts.get(item.source) ?? 0;
    if (count >= maxPerSource) continue;
    sourceCounts.set(item.source, count + 1);
    limited.push(item);
    if (limited.length >= maxItems) break;
  }
  return limited;
}

function limitReportItems(groups, maxItems) {
  if (!Number.isFinite(maxItems) || maxItems <= 0) return groups;

  const limited = [
    ...groups.news,
    ...groups.reddit,
    ...groups.videos
  ].sort(comparePublishedDesc).slice(0, maxItems);

  return {
    news: limited.filter((item) => item.kind === 'news'),
    reddit: limited.filter((item) => item.kind === 'reddit'),
    videos: limited.filter((item) => item.kind === 'video')
  };
}

function comparePublishedDesc(a, b) {
  return new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
}

async function maybeTranslateTitles({ config, items, warnings }) {
  const translation = config.translation ?? {};
  if (translation.enabled !== true || items.length === 0) return;

  const provider = translation.provider || 'auto';
  const openAiKey = process.env[translation.apiKeyEnv || 'OPENAI_API_KEY'];

  try {
    if ((provider === 'auto' || provider === 'openai') && openAiKey) {
      await translateTitlesWithOpenAI({ config, items, apiKey: openAiKey });
      return;
    }

    if (provider === 'openai') {
      warnings.push(`Title translation skipped: ${translation.apiKeyEnv || 'OPENAI_API_KEY'} is not set.`);
      return;
    }

    await translateTitlesWithMyMemory({ config, items, warnings });
  } catch (error) {
    warnings.push(`Title translation skipped: ${error.message}`);
  }
}

async function translateTitlesWithOpenAI({ config, items, apiKey }) {
  const translation = config.translation ?? {};
  const model = process.env[translation.modelEnv || 'OPENAI_TRANSLATION_MODEL'] || translation.model || 'gpt-4.1-mini';
  const targetLanguage = translation.targetLanguage || 'Vietnamese';
  const titles = items.map((item) => item.title);
  const payload = {
    model,
    input: [
      {
        role: 'system',
        content: [
          {
            type: 'input_text',
            text: [
              `Translate news/video/reddit item titles into ${targetLanguage}.`,
              'Preserve product names, company names, model names, numbers, and acronyms.',
              'Return only a JSON array of strings with the same length and order as the input.'
            ].join(' ')
          }
        ]
      },
      {
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: JSON.stringify(titles)
          }
        ]
      }
    ]
  };

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
      'user-agent': USER_AGENT
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(Number(translation.timeoutMs ?? 30000))
  });

  if (!response.ok) {
    throw new Error(`OpenAI translation failed ${response.status} ${response.statusText}`);
  }

  const result = await response.json();
  const text = extractResponseText(result);
  const translations = JSON.parse(text);
  if (!Array.isArray(translations) || translations.length !== items.length) {
    throw new Error('OpenAI translation returned an invalid JSON array.');
  }

  items.forEach((item, index) => {
    item.titleVi = cleanTranslatedTitle(translations[index]);
  });
}

async function translateTitlesWithMyMemory({ config, items, warnings }) {
  const translation = config.translation ?? {};
  const targetLangCode = translation.targetLangCode || 'vi';
  const sourceLangCode = translation.sourceLangCode || 'en';
  const delayMs = Number(translation.freeProviderDelayMs ?? 250);
  const timeoutMs = Number(translation.timeoutMs ?? 15000);
  const emailParam = translation.freeProviderEmail ? `&de=${encodeURIComponent(translation.freeProviderEmail)}` : '';

  for (const item of items) {
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(item.title)}&langpair=${encodeURIComponent(`${sourceLangCode}|${targetLangCode}`)}${emailParam}`;
    try {
      const response = await fetch(url, {
        headers: {
          accept: 'application/json',
          'user-agent': USER_AGENT
        },
        signal: AbortSignal.timeout(timeoutMs)
      });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      const payload = await response.json();
      const translatedText = payload.responseData?.translatedText;
      if (payload.responseStatus !== 200 || !translatedText) {
        throw new Error(payload.responseDetails || 'empty translation');
      }
      item.titleVi = cleanTranslatedTitle(translatedText);
    } catch (error) {
      warnings.push(`Title translation failed for "${item.title}": ${error.message}`);
    }

    if (delayMs > 0) await sleep(delayMs);
  }
}

function extractResponseText(result) {
  if (typeof result.output_text === 'string') return result.output_text;
  const chunks = [];
  for (const output of result.output ?? []) {
    for (const content of output.content ?? []) {
      if (typeof content.text === 'string') chunks.push(content.text);
    }
  }
  return chunks.join('\n').trim();
}

function cleanTranslatedTitle(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

async function collectItems({ config, since, warnings }) {
  const newsFeeds = Array.isArray(config.newsFeeds) ? config.newsFeeds : [];
  const youtubeFeeds = Array.isArray(config.youtubeFeeds) ? config.youtubeFeeds : [];
  const redditFeeds = Array.isArray(config.redditFeeds) ? config.redditFeeds : [];
  const siteMaps = Array.isArray(config.siteMaps) ? config.siteMaps : [];
  const jsonSources = Array.isArray(config.jsonSources) ? config.jsonSources : [];
  const news = await collectFeedItems({
    feeds: newsFeeds,
    kind: 'news',
    config,
    warnings
  });
  const siteMapNews = await collectSitemapItems({
    siteMaps,
    config,
    warnings
  });
  const reddit = await collectFeedItems({
    feeds: redditFeeds,
    kind: 'reddit',
    config,
    warnings
  });
  const jsonNews = await collectJsonItems({
    jsonSources,
    config,
    warnings
  });
  const feedVideos = await collectFeedItems({
    feeds: youtubeFeeds,
    kind: 'video',
    config,
    warnings
  });
  const searchVideos = await collectYoutubeSearchVideos({ config, since, warnings });

  return [...news, ...siteMapNews, ...jsonNews, ...reddit, ...feedVideos, ...searchVideos];
}

async function collectFeedItems({ feeds, kind, config, warnings }) {
  const settled = await Promise.allSettled(
    feeds
      .filter((feed) => feed.enabled !== false)
      .map(async (feed) => {
        const xml = await fetchText(feed.url, feed.timeoutMs ?? config.request?.timeoutMs);
        return parseFeedXml(xml, feed, kind);
      })
  );

  const items = [];
  for (const result of settled) {
    if (result.status === 'fulfilled') {
      items.push(...result.value);
    } else {
      warnings.push(result.reason?.message ?? String(result.reason));
    }
  }
  return items;
}

async function collectJsonItems({ jsonSources, config, warnings }) {
  const settled = await Promise.allSettled(
    jsonSources
      .filter((source) => source.enabled !== false)
      .map(async (source) => {
        const text = await fetchText(
          source.url,
          source.timeoutMs ?? config.request?.timeoutMs,
          'application/json, */*'
        );
        return parseJsonSource(JSON.parse(text), source);
      })
  );

  const items = [];
  for (const result of settled) {
    if (result.status === 'fulfilled') items.push(...result.value);
    else warnings.push(result.reason?.message ?? String(result.reason));
  }
  return items;
}

function parseJsonSource(payload, source) {
  if (source.type === 'huggingFaceDailyPapers') {
    const maxItems = Number(source.maxItems ?? 30);
    return (Array.isArray(payload) ? payload : [])
      .slice(0, Number.isFinite(maxItems) && maxItems > 0 ? maxItems : 30)
      .map((entry) => {
        const paper = entry.paper ?? entry;
        const paperId = paper.id || paper.arxivId;
        if (!paperId || !paper.title) return null;
        return createItem({
          kind: source.kind || 'news',
          source: source.name,
          sourceUrl: source.url,
          title: paper.title,
          url: `https://huggingface.co/papers/${paperId}`,
          publishedAt: paper.submittedOnDailyAt || paper.publishedAt || entry.publishedAt,
          summary: paper.summary,
          requireKeyword: source.requireKeyword === true
        });
      })
      .filter(Boolean);
  }

  throw new Error(`Unsupported JSON source type: ${source.type || 'missing'}`);
}

async function collectSitemapItems({ siteMaps, config, warnings }) {
  const settled = await Promise.allSettled(
    siteMaps
      .filter((siteMap) => siteMap.enabled !== false)
      .map(async (siteMap) => {
        const xml = await fetchText(siteMap.url, siteMap.timeoutMs ?? config.request?.timeoutMs);
        const parsed = parseSitemapXml(xml, siteMap);
        const nestedLimit = Number(siteMap.maxNestedSitemaps ?? 10);
        const nestedUrls = parsed.nestedUrls.slice(0, nestedLimit);
        const nestedItems = [];

        if (parsed.items.length === 0 && nestedUrls.length > 0 && siteMap.followSitemapIndex !== false) {
          const nestedSettled = await Promise.allSettled(
            nestedUrls.map(async (nestedUrl) => parseSitemapXml(
              await fetchText(nestedUrl, siteMap.timeoutMs ?? config.request?.timeoutMs),
              siteMap
            ).items)
          );
          for (const result of nestedSettled) {
            if (result.status === 'fulfilled') nestedItems.push(...result.value);
            else warnings.push(result.reason?.message ?? String(result.reason));
          }
        }

        return [...parsed.items, ...nestedItems];
      })
  );

  const items = [];
  for (const result of settled) {
    if (result.status === 'fulfilled') items.push(...result.value);
    else warnings.push(result.reason?.message ?? String(result.reason));
  }
  return items;
}

function parseSitemapXml(xml, siteMap) {
  const urlBlocks = matchBlocks(xml, 'url');
  const items = urlBlocks
    .map((block) => {
      const loc = cleanXmlText(extractTag(block, ['loc']));
      const lastmod = cleanXmlText(extractTag(block, ['lastmod']));
      if (!loc || !lastmod || !passesSitemapUrlRules(loc, siteMap)) return null;

      return createItem({
        kind: siteMap.kind || 'news',
        source: siteMap.name,
        sourceUrl: siteMap.url,
        title: titleFromUrl(loc),
        url: loc,
        publishedAt: lastmod,
        summary: `Updated on ${siteMap.name}`,
        requireKeyword: siteMap.requireKeyword === true
      });
    })
    .filter(Boolean);

  const nestedUrls = matchBlocks(xml, 'sitemap')
    .map((block) => cleanXmlText(extractTag(block, ['loc'])))
    .filter(Boolean)
    .filter((url) => passesSitemapIndexRules(url, siteMap));

  return { items, nestedUrls };
}

function passesSitemapUrlRules(url, siteMap) {
  const includes = Array.isArray(siteMap.include) ? siteMap.include : [];
  const excludes = Array.isArray(siteMap.exclude) ? siteMap.exclude : [];
  if (includes.length > 0 && !includes.some((needle) => url.includes(needle))) return false;
  if (excludes.some((needle) => url.includes(needle))) return false;
  return true;
}

function passesSitemapIndexRules(url, siteMap) {
  const includes = Array.isArray(siteMap.sitemapInclude) ? siteMap.sitemapInclude : [];
  const excludes = Array.isArray(siteMap.sitemapExclude) ? siteMap.sitemapExclude : [];
  if (includes.length > 0 && !includes.some((needle) => url.includes(needle))) return false;
  if (excludes.some((needle) => url.includes(needle))) return false;
  return true;
}

function titleFromUrl(value) {
  try {
    const url = new URL(value);
    const segment = url.pathname.split('/').filter(Boolean).at(-1) || url.hostname;
    return decodeURIComponent(segment)
      .replace(/\.[a-z0-9]+$/i, '')
      .replace(/[-_]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/\b\w/g, (char) => char.toUpperCase());
  } catch {
    return String(value);
  }
}

async function collectYoutubeSearchVideos({ config, since, warnings }) {
  const searchConfig = config.youtubeSearch;
  if (!searchConfig?.enabled) return [];

  const apiKey = process.env[searchConfig.apiKeyEnv || 'YOUTUBE_API_KEY'];
  if (!apiKey) {
    warnings.push(`YouTube search enabled but ${searchConfig.apiKeyEnv || 'YOUTUBE_API_KEY'} is not set.`);
    return [];
  }

  const queries = Array.isArray(searchConfig.queries) ? searchConfig.queries : [];
  const maxResults = Math.min(Number(searchConfig.maxResultsPerQuery ?? 5), 50);
  const items = [];

  for (const query of queries) {
    const url = new URL('https://www.googleapis.com/youtube/v3/search');
    url.searchParams.set('part', 'snippet');
    url.searchParams.set('type', 'video');
    url.searchParams.set('order', 'date');
    url.searchParams.set('maxResults', String(maxResults));
    url.searchParams.set('publishedAfter', since.toISOString());
    url.searchParams.set('q', query);
    url.searchParams.set('key', apiKey);

    try {
      const payload = JSON.parse(await fetchText(url.href, config.request?.timeoutMs, 'application/json'));
      for (const result of payload.items ?? []) {
        const videoId = result.id?.videoId;
        const snippet = result.snippet ?? {};
        if (!videoId || !snippet.publishedAt) continue;
        items.push(createItem({
          kind: 'video',
          source: `YouTube Search: ${query}`,
          sourceUrl: 'https://www.youtube.com',
          title: snippet.title,
          url: `https://www.youtube.com/watch?v=${videoId}`,
          publishedAt: snippet.publishedAt,
          summary: snippet.description,
          requireKeyword: false
        }));
      }
    } catch (error) {
      warnings.push(`YouTube search failed for "${query}": ${error.message}`);
    }
  }

  return items;
}

async function fetchText(url, timeoutMs = 20000, accept = 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*') {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      headers: {
        accept,
        'user-agent': USER_AGENT
      },
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`Fetch failed ${response.status} ${response.statusText}: ${url}`);
    }

    return response.text();
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error(`Fetch timed out after ${timeoutMs}ms: ${url}`);
    }
    if (error.message?.startsWith('Fetch failed ')) throw error;
    const cause = error.cause?.code || error.cause?.message;
    const detail = cause ? `${error.message} (${cause})` : error.message;
    throw new Error(`Fetch failed: ${url}: ${detail}`);
  } finally {
    clearTimeout(timer);
  }
}

function parseFeedXml(xml, feed, kind) {
  const blocks = matchBlocks(xml, 'item');
  const isAtom = blocks.length === 0;
  const entryBlocks = isAtom ? matchBlocks(xml, 'entry') : blocks;

  return entryBlocks
    .map((block) => {
      const title = cleanXmlText(extractTag(block, ['title', 'media:title']));
      const summary = cleanSummary(extractTag(block, ['description', 'summary', 'content', 'content:encoded', 'media:description']));
      const publishedAt = cleanXmlText(extractTag(block, ['pubDate', 'published', 'updated', 'dc:date']));
      const url = resolveFeedUrl(extractFeedLink(block, isAtom), feed.url);

      return createItem({
        kind,
        source: feed.name,
        sourceUrl: feed.url,
        title,
        url,
        publishedAt,
        summary,
        requireKeyword: feed.requireKeyword === true
      });
    })
    .filter((item) => item.title && item.url && item.publishedAt);
}

function matchBlocks(xml, tagName) {
  return [...xml.matchAll(new RegExp(`<${tagName}\\b[\\s\\S]*?<\\/${tagName}>`, 'gi'))].map((match) => match[0]);
}

function extractTag(block, tagNames) {
  for (const tagName of tagNames) {
    const escaped = escapeRegExp(tagName);
    const match = block.match(new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}>`, 'i'));
    if (match?.[1]) return match[1];
  }
  return '';
}

function extractFeedLink(block, isAtom) {
  if (isAtom) {
    const alternate = block.match(/<link\b(?=[^>]*\bhref=["']([^"']+)["'])(?=[^>]*(?:\brel=["']alternate["']|>))[^>]*>/i);
    if (alternate?.[1]) return alternate[1];
    const linked = block.match(/<link\b[^>]*\bhref=["']([^"']+)["'][^>]*>/i);
    if (linked?.[1]) return linked[1];
  }
  return cleanXmlText(extractTag(block, ['link', 'guid', 'id']));
}

function cleanXmlText(value) {
  return decodeEntities(stripTags(unwrapCdata(value))).replace(/\s+/g, ' ').trim();
}

function cleanSummary(value) {
  return cleanXmlText(value).slice(0, 500);
}

function unwrapCdata(value) {
  return String(value ?? '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
}

function stripTags(value) {
  return String(value ?? '').replace(/<[^>]+>/g, ' ');
}

function decodeEntities(value) {
  const named = {
    amp: '&',
    apos: "'",
    gt: '>',
    lt: '<',
    nbsp: ' ',
    quot: '"'
  };

  return String(value ?? '').replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity) => {
    const lower = entity.toLowerCase();
    if (lower.startsWith('#x')) return String.fromCodePoint(Number.parseInt(lower.slice(2), 16));
    if (lower.startsWith('#')) return String.fromCodePoint(Number.parseInt(lower.slice(1), 10));
    return named[lower] ?? match;
  });
}

function resolveFeedUrl(value, baseUrl) {
  const cleaned = cleanXmlText(value);
  if (!cleaned) return '';
  try {
    return new URL(cleaned, baseUrl).href;
  } catch {
    return cleaned;
  }
}

function createItem({ kind, source, sourceUrl, title, url, publishedAt, summary, requireKeyword }) {
  const date = new Date(publishedAt);
  const normalizedUrl = normalizeUrl(url);
  const item = {
    id: '',
    kind,
    source,
    sourceUrl,
    title: cleanXmlText(title),
    url,
    normalizedUrl,
    publishedAt: Number.isNaN(date.getTime()) ? '' : date.toISOString(),
    summary: cleanSummary(summary),
    requireKeyword
  };
  item.id = sha1(`${kind}:${normalizedUrl || item.title.toLowerCase()}`);
  return item;
}

function normalizeUrl(value) {
  try {
    const url = new URL(value);
    for (const key of [...url.searchParams.keys()]) {
      if (key.toLowerCase().startsWith('utm_') || key.toLowerCase() === 'fbclid') {
        url.searchParams.delete(key);
      }
    }
    url.hash = '';
    return url.href;
  } catch {
    return String(value ?? '').trim();
  }
}

function sha1(value) {
  return crypto.createHash('sha1').update(value).digest('hex');
}

function dedupeItems(items) {
  const seen = new Map();
  for (const item of items) {
    if (!item.id) continue;
    if (!seen.has(item.id)) seen.set(item.id, item);
  }
  return [...seen.values()];
}

function isRecent(item, since) {
  if (!item.publishedAt) return false;
  return new Date(item.publishedAt).getTime() >= since.getTime();
}

function passesSourceKeywordRule(item, config) {
  const requireKeyword = item.requireKeyword || config.report?.requireKeyword === true;
  if (!requireKeyword) return true;
  const keywords = Array.isArray(config.keywords) ? config.keywords : [];
  if (keywords.length === 0) return true;
  const haystack = `${item.title} ${item.summary}`.toLowerCase();
  return keywords.some((keyword) => matchesKeyword(haystack, keyword));
}

function matchesKeyword(haystack, keyword) {
  const normalized = String(keyword ?? '').trim().toLowerCase();
  if (!normalized) return false;
  if (/^[a-z0-9 ._-]+$/i.test(normalized)) {
    const pattern = normalized
      .split(/\s+/)
      .map((part) => escapeRegExp(part))
      .join('\\s+');
    return new RegExp(`(^|[^a-z0-9])${pattern}($|[^a-z0-9])`, 'i').test(haystack);
  }
  return haystack.includes(normalized);
}

function buildReport({ config, news, reddit, videos, warnings, since, now, hours }) {
  const timezone = config.report?.timezone || 'UTC';
  const title = config.report?.title || 'AI Radar Digest';
  const windowLabel = `${formatDate(since, timezone)} - ${formatDate(now, timezone)} (${hours}h)`;
  const subjectPrefix = config.email?.subjectPrefix || '[AI Radar]';
  const subject = `${subjectPrefix} ${news.length} news, ${reddit.length} reddit, ${videos.length} videos in ${hours}h`;
  const text = buildTextReport({ title, windowLabel, news, reddit, videos, warnings, timezone });
  const html = buildHtmlReport({ title, windowLabel, news, reddit, videos, warnings, timezone });
  return { subject, text, html };
}

function buildTextReport({ title, windowLabel, news, reddit, videos, warnings, timezone }) {
  const lines = [
    title,
    `Window: ${windowLabel}`,
    '',
    `AI news (${news.length})`
  ];
  appendTextItems(lines, news, timezone);
  lines.push('', `Reddit discussions (${reddit.length})`);
  appendTextItems(lines, reddit, timezone);
  lines.push('', `AI videos (${videos.length})`);
  appendTextItems(lines, videos, timezone);

  if (warnings.length > 0) {
    lines.push('', `Warnings (${warnings.length})`);
    for (const warning of warnings) lines.push(`- ${warning}`);
  }

  return lines.join('\n');
}

function appendTextItems(lines, items, timezone) {
  if (items.length === 0) {
    lines.push('- No new items.');
    return;
  }

  items.forEach((item, index) => {
    lines.push(`${index + 1}. [${item.source}] EN: ${item.title}`);
    if (item.titleVi) lines.push(`   VI: ${item.titleVi}`);
    lines.push(`   ${item.url}`);
    lines.push(`   ${formatDate(new Date(item.publishedAt), timezone)}`);
    if (item.summary) lines.push(`   ${item.summary}`);
  });
}

function buildHtmlReport({ title, windowLabel, news, reddit, videos, warnings, timezone }) {
  return `<!doctype html>
<html>
  <body style="font-family: Arial, sans-serif; color: #111827; line-height: 1.5;">
    <h1 style="font-size: 22px; margin: 0 0 8px;">${escapeHtml(title)}</h1>
    <p style="margin: 0 0 20px; color: #4b5563;">${escapeHtml(windowLabel)}</p>
    ${htmlSection('AI news', news, timezone)}
    ${htmlSection('Reddit discussions', reddit, timezone)}
    ${htmlSection('AI videos', videos, timezone)}
    ${warnings.length > 0 ? htmlWarnings(warnings) : ''}
  </body>
</html>`;
}

function htmlSection(title, items, timezone) {
  if (items.length === 0) {
    return `<h2 style="font-size: 18px; margin: 24px 0 8px;">${escapeHtml(title)} (0)</h2><p>No new items.</p>`;
  }

  const rows = items.map((item) => `<li style="margin-bottom: 16px;">
    <div style="font-size: 13px; color: #6b7280;">${escapeHtml(item.source)} - ${escapeHtml(formatDate(new Date(item.publishedAt), timezone))}</div>
    <a href="${escapeHtml(item.url)}" style="font-size: 16px; font-weight: 700; color: #0f62fe;">${escapeHtml(item.title)}</a>
    ${item.titleVi ? `<div style="font-size: 15px; font-weight: 700; color: #111827; margin-top: 2px;">${escapeHtml(item.titleVi)}</div>` : ''}
    ${item.summary ? `<div style="margin-top: 4px;">${escapeHtml(item.summary)}</div>` : ''}
  </li>`).join('');

  return `<h2 style="font-size: 18px; margin: 24px 0 8px;">${escapeHtml(title)} (${items.length})</h2><ol>${rows}</ol>`;
}

function htmlWarnings(warnings) {
  return `<h2 style="font-size: 18px; margin: 24px 0 8px;">Warnings</h2><ul>${warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join('')}</ul>`;
}

function formatDate(date, timezone) {
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: timezone
  }).format(date);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function resolveStatePath(config, configPath) {
  const stateFile = config.stateFile || '.ai-news-radar-state.json';
  if (path.isAbsolute(stateFile)) return stateFile;
  return path.resolve(path.dirname(configPath), stateFile);
}

async function loadState(statePath) {
  try {
    const state = JSON.parse(await fs.readFile(statePath, 'utf8'));
    return pruneState({
      sent: state.sent && typeof state.sent === 'object' ? state.sent : {}
    });
  } catch (error) {
    if (error.code === 'ENOENT') return { sent: {} };
    throw error;
  }
}

function pruneState(state) {
  const cutoff = Date.now() - 45 * DAY_MS;
  const sent = {};
  for (const [id, value] of Object.entries(state.sent)) {
    const sentAt = new Date(value.sentAt ?? value).getTime();
    if (Number.isFinite(sentAt) && sentAt >= cutoff) sent[id] = value;
  }
  return { sent };
}

function markSent(state, items) {
  const sentAt = new Date().toISOString();
  for (const item of items) {
    state.sent[item.id] = {
      sentAt,
      title: item.title,
      url: item.url,
      kind: item.kind,
      publishedAt: item.publishedAt
    };
  }
}

async function saveState(statePath, state) {
  await fs.mkdir(path.dirname(statePath), { recursive: true });
  await fs.writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`);
}

async function sendDigestEmail({ config, report }) {
  const email = resolveEmailConfig(config.email);
  const message = buildMimeMessage({
    from: email.from,
    to: email.to,
    subject: report.subject,
    text: report.text,
    html: report.html
  });

  await sendSmtpMail({
    smtp: email.smtp,
    from: email.from,
    to: email.to,
    rawMessage: message
  });
}

function resolveEmailConfig(emailConfig = {}) {
  const smtp = emailConfig.smtp ?? {};
  const host = smtp.host ?? process.env[smtp.hostEnv || 'SMTP_HOST'];
  const port = Number(smtp.port ?? process.env[smtp.portEnv || 'SMTP_PORT'] ?? 465);
  const secureValue = smtp.secure ?? process.env[smtp.secureEnv || 'SMTP_SECURE'];
  const secure = secureValue === undefined ? port === 465 : parseBoolean(secureValue);
  const user = smtp.user ?? process.env[smtp.userEnv || 'SMTP_USER'];
  const pass = normalizeSmtpPassword({
    host,
    pass: smtp.pass ?? process.env[smtp.passEnv || 'SMTP_PASS']
  });
  const from = emailConfig.from ?? process.env.EMAIL_FROM;
  const to = Array.isArray(emailConfig.to)
    ? emailConfig.to
    : String(process.env.EMAIL_TO ?? '').split(',').map((value) => value.trim()).filter(Boolean);

  const missing = [];
  if (!host) missing.push(smtp.hostEnv || 'SMTP_HOST');
  if (!port) missing.push(smtp.portEnv || 'SMTP_PORT');
  if (!user) missing.push(smtp.userEnv || 'SMTP_USER');
  if (!pass) missing.push(smtp.passEnv || 'SMTP_PASS');
  if (!from) missing.push('email.from or EMAIL_FROM');
  if (to.length === 0) missing.push('email.to or EMAIL_TO');
  if (to.some((address) => address.includes('you@example.com'))) missing.push('real email.to recipient');
  if (from?.includes('your-email@gmail.com')) missing.push('real email.from sender');
  if (missing.length > 0) {
    throw new Error(`Missing email config: ${missing.join(', ')}`);
  }

  return {
    from,
    to,
    smtp: {
      host,
      port,
      secure,
      user,
      pass,
      rejectUnauthorized: smtp.rejectUnauthorized !== false
    }
  };
}

function parseBoolean(value) {
  if (typeof value === 'boolean') return value;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function normalizeSmtpPassword({ host, pass }) {
  if (!pass) return pass;
  if (!String(host ?? '').includes('gmail.com')) return pass;
  return String(pass).replace(/\s+/g, '');
}

function buildMimeMessage({ from, to, subject, text, html }) {
  const boundary = `ai-news-radar-${crypto.randomBytes(12).toString('hex')}`;
  return [
    `From: ${from}`,
    `To: ${to.join(', ')}`,
    `Subject: ${encodeMimeHeader(subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${crypto.randomBytes(16).toString('hex')}@ai-news-radar.local>`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    text,
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    html,
    '',
    `--${boundary}--`,
    ''
  ].join('\r\n');
}

function encodeMimeHeader(value) {
  if (/^[\x00-\x7F]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

async function sendSmtpMail({ smtp, from, to, rawMessage }) {
  let socket = await connectSmtp(smtp);

  try {
    await expectResponse(socket, [220], 'greeting');
    await sendCommand(socket, `EHLO ${smtp.host}`, [250], 'EHLO');

    if (!smtp.secure) {
      await sendCommand(socket, 'STARTTLS', [220], 'STARTTLS');
      socket = await upgradeToTls(socket, smtp);
      await sendCommand(socket, `EHLO ${smtp.host}`, [250], 'EHLO after STARTTLS');
    }

    await sendCommand(socket, 'AUTH LOGIN', [334], 'AUTH LOGIN');
    await sendCommand(socket, Buffer.from(smtp.user).toString('base64'), [334], 'AUTH user');
    await sendCommand(socket, Buffer.from(smtp.pass).toString('base64'), [235], 'AUTH password');
    await sendCommand(socket, `MAIL FROM:<${extractEmailAddress(from)}>`, [250], 'MAIL FROM');
    for (const recipient of to) {
      await sendCommand(socket, `RCPT TO:<${extractEmailAddress(recipient)}>`, [250, 251], `RCPT TO ${recipient}`);
    }
    await sendCommand(socket, 'DATA', [354], 'DATA');
    socket.write(`${dotStuff(rawMessage)}\r\n.\r\n`);
    await expectResponse(socket, [250], 'message body');
    await sendCommand(socket, 'QUIT', [221], 'QUIT');
  } finally {
    socket.end();
  }
}

async function connectSmtp(smtp) {
  const socket = smtp.secure
    ? tls.connect({
        host: smtp.host,
        port: smtp.port,
        servername: smtp.host,
        rejectUnauthorized: smtp.rejectUnauthorized
      })
    : net.connect({
        host: smtp.host,
        port: smtp.port
      });

  socket.setEncoding('utf8');
  socket.setTimeout(30000, () => socket.destroy(new Error('SMTP connection timed out.')));
  await waitForEvent(socket, smtp.secure ? 'secureConnect' : 'connect');
  return socket;
}

async function upgradeToTls(socket, smtp) {
  const secureSocket = tls.connect({
    socket,
    servername: smtp.host,
    rejectUnauthorized: smtp.rejectUnauthorized
  });
  secureSocket.setEncoding('utf8');
  secureSocket.setTimeout(30000, () => secureSocket.destroy(new Error('SMTP connection timed out.')));
  await waitForEvent(secureSocket, 'secureConnect');
  return secureSocket;
}

function waitForEvent(emitter, eventName) {
  return new Promise((resolve, reject) => {
    const onEvent = (...args) => {
      cleanup();
      resolve(...args);
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      emitter.off(eventName, onEvent);
      emitter.off('error', onError);
    };
    emitter.once(eventName, onEvent);
    emitter.once('error', onError);
  });
}

async function sendCommand(socket, command, expectedCodes, label) {
  socket.write(`${command}\r\n`);
  await expectResponse(socket, expectedCodes, label);
}

async function expectResponse(socket, expectedCodes, label) {
  const response = await readSmtpResponse(socket);
  if (!expectedCodes.includes(response.code)) {
    if (label === 'AUTH password' && response.code === 535) {
      throw new Error([
        `SMTP ${label} failed: ${response.text}`,
        '',
        'Gmail rejected the SMTP password. Use a Gmail App Password, not your normal Gmail password:',
        '1. Enable 2-Step Verification for the Google account.',
        '2. Open https://myaccount.google.com/apppasswords',
        '3. Create an app password for "AI News Radar".',
        '4. Set SMTP_PASS to the 16-character app password.'
      ].join('\n'));
    }
    throw new Error(`SMTP ${label} failed: ${response.text}`);
  }
  return response;
}

async function readSmtpResponse(socket) {
  let text = '';
  for (;;) {
    const chunk = await readSocketChunk(socket);
    text += chunk;
    const lines = text.split(/\r?\n/).filter(Boolean);
    const last = lines.at(-1);
    if (last && /^\d{3} /.test(last)) {
      return {
        code: Number(last.slice(0, 3)),
        text: lines.join('\n')
      };
    }
  }
}

function readSocketChunk(socket) {
  return new Promise((resolve, reject) => {
    const onData = (chunk) => {
      cleanup();
      resolve(String(chunk));
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const onEnd = () => {
      cleanup();
      reject(new Error('SMTP connection ended unexpectedly.'));
    };
    const cleanup = () => {
      socket.off('data', onData);
      socket.off('error', onError);
      socket.off('end', onEnd);
    };
    socket.once('data', onData);
    socket.once('error', onError);
    socket.once('end', onEnd);
  });
}

function dotStuff(message) {
  return message.replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..');
}

function extractEmailAddress(value) {
  const match = String(value).match(/<([^>]+)>/);
  return (match?.[1] ?? value).trim();
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
