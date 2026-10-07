#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import process from 'node:process';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_DB_PATH = 'data/trend-search-db.json';
const DEFAULT_CONFIG_PATH = 'config.json';
const EXAMPLE_CONFIG_PATH = path.join(__dirname, 'config.example.json');
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const USER_AGENT = 'trend-search/0.1 (offline-first trend engine)';
const CATEGORIES = Object.freeze(['ai', 'beauty', 'tech', 'business']);
const COMMANDS = new Set([
  'init',
  'crawl',
  'run-once',
  'extract-topics',
  'score',
  'get-trends',
  'get-topic-details',
  'export',
  'watch'
]);

const STOPWORDS = new Set([
  'a', 'about', 'after', 'again', 'all', 'also', 'an', 'and', 'are', 'as', 'at',
  'be', 'been', 'before', 'being', 'best', 'between', 'big', 'but', 'by', 'can',
  'could', 'daily', 'day', 'days', 'de', 'do', 'does', 'doing', 'during', 'each',
  'for', 'from', 'get', 'gets', 'go', 'has', 'have', 'how', 'in', 'into', 'is',
  'it', 'its', 'latest', 'launch', 'launched', 'launches', 'make', 'makes',
  'market', 'may', 'more', 'most', 'new', 'news', 'now', 'of', 'on', 'or',
  'over', 'plan', 'plans', 'push', 'pushes', 'report', 'reports', 'says', 'see',
  'set', 'shows', 'than', 'that', 'the', 'their', 'this', 'to', 'today',
  'trend', 'trends', 'under', 'up', 'use', 'uses', 'using', 'via', 'vs', 'week',
  'what', 'when', 'where', 'why', 'will', 'with', 'without', 'out', 'you', 'your',
  'nbsp', 'show', 'hn', 'three', 'first', 'level', 'levels', 'building', 'build',
  'dev', 'team'
]);

const GENERIC_TERMS = new Set([
  'ai', 'beauty', 'business', 'company', 'consumer', 'data', 'digital', 'future',
  'growth', 'industry', 'market', 'platform', 'product', 'software', 'startup',
  'tech', 'technology', 'trend', 'workflow'
]);

const PLATFORM_SOURCE_TYPES = new Set([
  'youtube-search',
  'youtube-invidious',
  'tiktok-search',
  'tiktok-tikwm'
]);

const PLATFORM_KEEP_TERMS = new Set([
  'ai',
  'agent',
  'agents',
  'agentic',
  'automation',
  'automate',
  'claude',
  'chatgpt',
  'gpt',
  'code',
  'coding',
  'workflow',
  'workflows',
  'n8n',
  'cursor',
  'obsidian',
  'ollama',
  'memory',
  'model'
]);

const CANONICAL_REPLACEMENTS = Object.freeze([
  [/artificial intelligence/g, 'ai'],
  [/agentic ai/g, 'ai agents'],
  [/ai agent workflows/g, 'ai agents'],
  [/ai agents workflows/g, 'ai agents'],
  [/\bai agent\b/g, 'ai agents'],
  [/copilots/g, 'copilot'],
  [/passkey/g, 'passkeys'],
  [/skin barrier/g, 'barrier repair'],
  [/barrier skin/g, 'barrier repair'],
  [/operating leverage/g, 'ai operating leverage'],
  [/private assistants/g, 'private ai assistants'],
  [/on device/g, 'on-device'],
  [/ondevice/g, 'on-device']
]);

const CATEGORY_META = Object.freeze({
  ai: {
    audience: 'builders, founders, and AI operators',
    viAudience: 'founder, builder va doi ngu san pham AI',
    keywords: [
      'ai agents',
      'ai agent',
      'agentic workflows',
      'agentic ai',
      'autonomous ai agent',
      'model evals',
      'ai copilot',
      'claude code',
      'claude ai',
      'ai agent builder',
      'multimodal ai',
      'open-source models',
      'tool safety',
      'ai automation'
    ]
  },
  beauty: {
    audience: 'beauty creators, retailers, and product marketers',
    viAudience: 'creator lam dep, retailer va marketer nganh beauty',
    keywords: [
      'barrier repair',
      'peptide lip',
      'skin cycling',
      'spf sticks',
      'scalp care',
      'clean fragrance',
      'creator storefronts',
      'minimal routines'
    ]
  },
  tech: {
    audience: 'product teams, engineers, and IT leaders',
    viAudience: 'doi ngu product, ky su va IT leader',
    keywords: [
      'on-device ai',
      'passkeys',
      'privacy computing',
      'edge inference',
      'developer tools',
      'spatial computing',
      'battery efficiency',
      'security automation'
    ]
  },
  business: {
    audience: 'operators, investors, and growth teams',
    viAudience: 'operator, nha dau tu va doi ngu tang truong',
    keywords: [
      'ai operating leverage',
      'fractional finance',
      'vertical saas',
      'pricing packaging',
      'customer retention',
      'automation roi',
      'sales efficiency',
      'cash discipline'
    ]
  }
});

const SAMPLE_ITEMS = Object.freeze({
  ai: [
    {
      source: 'Seed AI Lab Notes',
      sourceType: 'seed',
      title: 'Open-source AI agents move from demos to reliable browser workflows',
      summary: 'Builders are pairing model evals, memory, and tool safety to make AI agents useful for daily operations.',
      url: 'seed://ai/agents-browser-workflows',
      offsetHours: 6,
      engagementSeed: 92
    },
    {
      source: 'Seed Founder Brief',
      sourceType: 'seed',
      title: 'Small businesses test AI agent copilots for lead research',
      summary: 'Teams want AI automation that gathers prospects, checks websites, and drafts context before sales calls.',
      url: 'seed://ai/agent-copilots-lead-research',
      offsetHours: 16,
      engagementSeed: 74
    },
    {
      source: 'Seed Model Ops',
      sourceType: 'seed',
      title: 'Agentic workflows focus on evals, memory, and tool safety',
      summary: 'The next AI agents conversation is shifting toward reliability, audit trails, and scoped tool permissions.',
      url: 'seed://ai/agentic-workflows-evals-safety',
      offsetHours: 31,
      engagementSeed: 81
    },
    {
      source: 'Seed Product Radar',
      sourceType: 'seed',
      title: 'AI copilots become workflow-specific instead of generic chat boxes',
      summary: 'Vertical copilots for support, research, and internal ops are gaining attention because they own a measurable job.',
      url: 'seed://ai/workflow-specific-copilots',
      offsetHours: 44,
      engagementSeed: 68
    },
    {
      source: 'Seed Dev Tools',
      sourceType: 'seed',
      title: 'Tool safety becomes a core AI agent feature for enterprise pilots',
      summary: 'IT teams want permission scopes, approvals, and rollback logs before letting AI agents touch production systems.',
      url: 'seed://ai/tool-safety-enterprise-pilots',
      offsetHours: 61,
      engagementSeed: 63
    },
    {
      source: 'Seed Research Notes',
      sourceType: 'seed',
      title: 'Model evals get bundled into agentic workflow launches',
      summary: 'Teams are publishing eval harnesses next to AI agent releases to show reliability under repeatable tasks.',
      url: 'seed://ai/model-evals-agent-launches',
      offsetHours: 82,
      engagementSeed: 59
    }
  ],
  beauty: [
    {
      source: 'Seed Beauty Radar',
      sourceType: 'seed',
      title: 'Barrier repair routines trend as shoppers simplify skin care',
      summary: 'Minimal routines, ceramides, and gentle actives are being positioned as the answer to over-exfoliation fatigue.',
      url: 'seed://beauty/barrier-repair-routines',
      offsetHours: 5,
      engagementSeed: 86
    },
    {
      source: 'Seed Creator Commerce',
      sourceType: 'seed',
      title: 'Peptide lip treatments gain traction through creator storefronts',
      summary: 'Beauty creators are using before-after videos and bundle offers to turn peptide lip care into a repeat purchase.',
      url: 'seed://beauty/peptide-lip-creator-storefronts',
      offsetHours: 18,
      engagementSeed: 78
    },
    {
      source: 'Seed Retail Shelf',
      sourceType: 'seed',
      title: 'SPF sticks and scalp care products expand summer beauty baskets',
      summary: 'Portable SPF sticks and scalp care are showing up in routines built around convenience and daily protection.',
      url: 'seed://beauty/spf-sticks-scalp-care',
      offsetHours: 29,
      engagementSeed: 71
    },
    {
      source: 'Seed Beauty Lab',
      sourceType: 'seed',
      title: 'Skin cycling matures into minimal routines with barrier repair',
      summary: 'Consumers are keeping the calendar idea but reducing steps and emphasizing recovery nights.',
      url: 'seed://beauty/skin-cycling-barrier-repair',
      offsetHours: 47,
      engagementSeed: 66
    },
    {
      source: 'Seed Commerce Watch',
      sourceType: 'seed',
      title: 'Creator storefronts reshape beauty discovery for peptide lip and SPF products',
      summary: 'Short-form demos, saved carts, and creator bundles are making product discovery feel closer to guided shopping.',
      url: 'seed://beauty/creator-storefronts-beauty-discovery',
      offsetHours: 69,
      engagementSeed: 60
    }
  ],
  tech: [
    {
      source: 'Seed Tech Radar',
      sourceType: 'seed',
      title: 'On-device AI chips bring private assistants to laptops',
      summary: 'Hardware launches are emphasizing local inference, privacy, and battery efficiency for everyday assistant tasks.',
      url: 'seed://tech/on-device-ai-private-assistants',
      offsetHours: 7,
      engagementSeed: 88
    },
    {
      source: 'Seed Security Notes',
      sourceType: 'seed',
      title: 'Passkeys adoption grows as teams phase out shared passwords',
      summary: 'Security teams are pairing passkeys with device policy and recovery workflows to reduce account takeover risk.',
      url: 'seed://tech/passkeys-shared-passwords',
      offsetHours: 20,
      engagementSeed: 76
    },
    {
      source: 'Seed Edge Compute',
      sourceType: 'seed',
      title: 'Edge inference moves privacy computing from promise to product',
      summary: 'Developers are shipping smaller models locally so sensitive data can stay on device for common tasks.',
      url: 'seed://tech/edge-inference-privacy-computing',
      offsetHours: 34,
      engagementSeed: 73
    },
    {
      source: 'Seed Dev Tools',
      sourceType: 'seed',
      title: 'Developer tools add battery efficiency checks for AI features',
      summary: 'Teams are measuring thermal load, memory pressure, and token cost before enabling always-on AI assistants.',
      url: 'seed://tech/battery-efficiency-ai-features',
      offsetHours: 53,
      engagementSeed: 64
    },
    {
      source: 'Seed Identity Desk',
      sourceType: 'seed',
      title: 'Passkeys pair with security automation in IT rollout plans',
      summary: 'Identity teams want automated exception handling before they remove passwords from critical workflows.',
      url: 'seed://tech/passkeys-security-automation',
      offsetHours: 75,
      engagementSeed: 58
    }
  ],
  business: [
    {
      source: 'Seed Operator Brief',
      sourceType: 'seed',
      title: 'AI operating leverage becomes a board-level metric for SaaS',
      summary: 'Executives are asking which workflows can scale revenue without matching headcount growth one for one.',
      url: 'seed://business/ai-operating-leverage-saas',
      offsetHours: 8,
      engagementSeed: 84
    },
    {
      source: 'Seed Finance Ops',
      sourceType: 'seed',
      title: 'Fractional finance teams use automation to close books faster',
      summary: 'Lean companies are combining fractional finance expertise with repeatable automation for monthly close.',
      url: 'seed://business/fractional-finance-automation-close',
      offsetHours: 21,
      engagementSeed: 73
    },
    {
      source: 'Seed Growth Notes',
      sourceType: 'seed',
      title: 'Pricing packaging work returns as teams chase sales efficiency',
      summary: 'Business leaders are revisiting bundles, usage tiers, and expansion paths to improve payback periods.',
      url: 'seed://business/pricing-packaging-sales-efficiency',
      offsetHours: 38,
      engagementSeed: 69
    },
    {
      source: 'Seed Investor Memo',
      sourceType: 'seed',
      title: 'Vertical SaaS founders pitch AI operating leverage, not generic AI',
      summary: 'Investors are rewarding automation tied to a workflow and measurable margin expansion.',
      url: 'seed://business/vertical-saas-ai-operating-leverage',
      offsetHours: 50,
      engagementSeed: 67
    },
    {
      source: 'Seed CFO Desk',
      sourceType: 'seed',
      title: 'Cash discipline and automation ROI shape 2026 planning cycles',
      summary: 'Operators want projects that lower manual work while keeping cash burn predictable.',
      url: 'seed://business/cash-discipline-automation-roi',
      offsetHours: 73,
      engagementSeed: 56
    }
  ]
});

function printHelp() {
  console.log(`Trend Search Engine

Usage:
  trend-search.mjs init [--root /path/to/workspace] [--force]
  trend-search.mjs crawl [--root /path/to/workspace] [--category ai] [--dry-run]
  trend-search.mjs run-once [--root /path/to/workspace] [--category ai] [--dry-run]
  trend-search.mjs extract-topics [--root /path/to/workspace] [--category ai]
  trend-search.mjs score [--root /path/to/workspace] [--category ai]
  trend-search.mjs get-trends --category ai --limit 20 [--pretty]
  trend-search.mjs get-topic-details --topic-id topic_ai_ai-agents [--pretty]
  trend-search.mjs export [--format json|md] [--out trends.md]
  trend-search.mjs run-once --live --watch --interval-minutes 60

Commands:
  init                Create config.json and data/trend-search-db.json.
  crawl               Collect raw items from configured public sources or seed data.
  run-once            Crawl, extract topics, score, generate angles, and save DB.
  extract-topics      Build trend_topics from existing raw_items.
  score               Recompute scores and trend_angles from existing topics/items.
  get-trends          Print JSON: { "topics": [...] }.
  get-topic-details   Print JSON: { "topic": {...}, "angles": [...] }.
  export              Export current trend topics as JSON or Markdown.
  watch               Alias for run-once --watch.

Options:
  --root <dir>              Workspace root. Default: this tool directory.
  --config <file>           Config path. Default: <root>/config.json.
  --db <file>               DB path. Default from config workspace.dbPath.
  --category <name>         One of: ${CATEGORIES.join(', ')}. Default: all.
  --limit <number>          Output limit. Default: 20.
  --topic-id <id>           Topic id for get-topic-details.
  --hours <number>          Lookback window for extraction/scoring.
  --format <json|md>        Export format. Default: json.
  --out <file>              Export destination. If omitted, prints to stdout.
  --language <vi|en>        Angle language. Default from config.
  --live                    Enable public network crawlers for this run.
  --no-fallback             Do not add seed/sample data when live sources are thin.
  --dry-run                 Print result without writing DB.
  --watch                   Keep running run-once in the current process.
  --interval-minutes <n>    Poll interval for --watch. Default: 60.
  --pretty                  Pretty-print JSON.
  --force                   Let init overwrite existing config/db.
  --help                    Show this help.

The CLI is offline-first. Network crawling only runs with --live or when config.crawler.allowNetwork is true.
`);
}

function parseArgs(argv) {
  const command = argv[0] && !argv[0].startsWith('--') ? argv[0] : '';
  const start = command ? 1 : 0;
  const args = {
    command: command || 'help',
    root: __dirname,
    config: '',
    db: '',
    category: '',
    limit: 20,
    topicId: '',
    hours: null,
    format: 'json',
    out: '',
    language: '',
    live: false,
    noFallback: false,
    dryRun: false,
    watch: false,
    intervalMinutes: 60,
    pretty: false,
    force: false,
    help: false
  };

  if (command && !COMMANDS.has(command)) {
    throw new Error('Unknown command: ' + command);
  }

  for (let index = start; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      index += 1;
      if (index >= argv.length) throw new Error(arg + ' needs a value.');
      return argv[index];
    };

    if (arg === '--help' || arg === '-h') args.help = true;
    else if (arg === '--root') args.root = path.resolve(next());
    else if (arg === '--config') args.config = path.resolve(next());
    else if (arg === '--db') args.db = path.resolve(next());
    else if (arg === '--category') args.category = normalizeCategory(next());
    else if (arg === '--limit') args.limit = Number(next());
    else if (arg === '--topic-id') args.topicId = next();
    else if (arg === '--hours') args.hours = Number(next());
    else if (arg === '--format') args.format = String(next()).toLowerCase();
    else if (arg === '--out') args.out = next();
    else if (arg === '--language') args.language = String(next()).toLowerCase();
    else if (arg === '--live') args.live = true;
    else if (arg === '--no-fallback') args.noFallback = true;
    else if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--watch') args.watch = true;
    else if (arg === '--interval-minutes') args.intervalMinutes = Number(next());
    else if (arg === '--pretty') args.pretty = true;
    else if (arg === '--force') args.force = true;
    else throw new Error('Unknown argument: ' + arg);
  }

  if (args.command === 'watch') {
    args.command = 'run-once';
    args.watch = true;
  }
  if (args.help || args.command === 'help') {
    args.help = true;
    return args;
  }
  if (args.category && !CATEGORIES.includes(args.category)) {
    throw new Error('--category must be one of: ' + CATEGORIES.join(', '));
  }
  if (!Number.isInteger(args.limit) || args.limit < 1) {
    throw new Error('--limit must be a positive integer.');
  }
  if (args.hours !== null && (!Number.isFinite(args.hours) || args.hours <= 0)) {
    throw new Error('--hours must be a positive number.');
  }
  if (!['json', 'md', 'markdown'].includes(args.format)) {
    throw new Error('--format must be json or md.');
  }
  if (!Number.isFinite(args.intervalMinutes) || args.intervalMinutes <= 0) {
    throw new Error('--interval-minutes must be a positive number.');
  }

  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  if (args.command === 'init') {
    await commandInit(args);
    return;
  }

  if (args.watch) {
    for (;;) {
      await dispatch({ ...args, watch: false });
      console.log('Next trend-search run in ' + args.intervalMinutes + ' minute(s).');
      await sleep(args.intervalMinutes * 60 * 1000);
    }
  }

  await dispatch(args);
}

async function dispatch(args) {
  if (args.command === 'crawl') await commandCrawl(args);
  else if (args.command === 'run-once') await commandRunOnce(args);
  else if (args.command === 'extract-topics') await commandExtractTopics(args);
  else if (args.command === 'score') await commandScore(args);
  else if (args.command === 'get-trends') await commandGetTrends(args);
  else if (args.command === 'get-topic-details') await commandGetTopicDetails(args);
  else if (args.command === 'export') await commandExport(args);
  else throw new Error('Unknown command: ' + args.command);
}

async function commandInit(args) {
  const root = path.resolve(args.root || __dirname);
  const configPath = args.config || path.join(root, DEFAULT_CONFIG_PATH);
  const config = defaultConfig();
  const dbPath = args.db || path.resolve(path.dirname(configPath), config.workspace.dbPath || DEFAULT_DB_PATH);
  const db = emptyDb();

  await ensureDir(root);
  await writeJsonIfAllowed(configPath, config, args.force, 'config');
  await writeJsonIfAllowed(dbPath, db, args.force, 'database');

  console.log(formatJson({
    ok: true,
    root,
    configPath,
    dbPath,
    next: [
      'node ' + path.join(__dirname, 'trend-search.mjs') + ' run-once --root ' + root,
      'node ' + path.join(__dirname, 'trend-search.mjs') + ' get-trends --root ' + root + ' --category ai --limit 20'
    ]
  }, true));
}

async function commandCrawl(args) {
  const context = await loadContext(args);
  const startedAt = isoNow();
  const collected = await collectItems(context);
  const run = makeRun('crawl', startedAt, context, {
    rawItemsCollected: collected.items.length,
    warnings: collected.warnings.length
  });

  if (args.dryRun) {
    printJson({
      dryRun: true,
      rawItems: collected.items,
      warnings: collected.warnings,
      run
    }, args.pretty);
    return;
  }

  const db = mergeRawItems(context.db, collected.items, context.config, context.now);
  db.runs.push(run);
  trimRuns(db);
  await saveDb(context.dbPath, db);
  printJson({
    ok: true,
    rawItemsAdded: collected.items.length,
    totalRawItems: db.raw_items.length,
    warnings: collected.warnings,
    dbPath: context.dbPath
  }, args.pretty);
}

async function commandRunOnce(args) {
  const context = await loadContext(args);
  const startedAt = isoNow();
  const collected = await collectItems(context);
  const mergedDb = mergeRawItems(cloneJson(context.db), collected.items, context.config, context.now);
  const analyzed = analyzeTrends({
    db: mergedDb,
    config: context.config,
    args,
    now: context.now
  });
  const run = makeRun('run-once', startedAt, context, {
    rawItemsCollected: collected.items.length,
    rawItemsTotal: analyzed.db.raw_items.length,
    topicCount: analyzed.db.trend_topics.length,
    angleCount: analyzed.db.trend_angles.length,
    warnings: collected.warnings.length
  });
  analyzed.db.runs.push(run);
  trimRuns(analyzed.db);

  if (args.dryRun) {
    printJson({
      dryRun: true,
      topics: filterTopics(analyzed.db.trend_topics, args).slice(0, args.limit),
      rawItemsCollected: collected.items.length,
      warnings: collected.warnings,
      run
    }, args.pretty);
    return;
  }

  await saveDb(context.dbPath, analyzed.db);
  printJson({
    ok: true,
    topics: filterTopics(analyzed.db.trend_topics, args).slice(0, args.limit),
    rawItemsCollected: collected.items.length,
    warnings: collected.warnings,
    dbPath: context.dbPath
  }, args.pretty);
}

async function commandExtractTopics(args) {
  const context = await loadContext(args);
  const startedAt = isoNow();
  const analyzed = analyzeTrends({
    db: cloneJson(context.db),
    config: context.config,
    args,
    now: context.now,
    skipAngles: true
  });
  const run = makeRun('extract-topics', startedAt, context, {
    rawItemsTotal: analyzed.db.raw_items.length,
    topicCount: analyzed.db.trend_topics.length
  });
  analyzed.db.runs.push(run);
  trimRuns(analyzed.db);

  if (args.dryRun) {
    printJson({
      dryRun: true,
      topics: filterTopics(analyzed.db.trend_topics, args).slice(0, args.limit),
      run
    }, args.pretty);
    return;
  }

  await saveDb(context.dbPath, analyzed.db);
  printJson({
    ok: true,
    topicCount: analyzed.db.trend_topics.length,
    dbPath: context.dbPath
  }, args.pretty);
}

async function commandScore(args) {
  const context = await loadContext(args);
  const startedAt = isoNow();
  const analyzed = analyzeTrends({
    db: cloneJson(context.db),
    config: context.config,
    args,
    now: context.now
  });
  const run = makeRun('score', startedAt, context, {
    topicCount: analyzed.db.trend_topics.length,
    angleCount: analyzed.db.trend_angles.length
  });
  analyzed.db.runs.push(run);
  trimRuns(analyzed.db);

  if (args.dryRun) {
    printJson({
      dryRun: true,
      topics: filterTopics(analyzed.db.trend_topics, args).slice(0, args.limit),
      run
    }, args.pretty);
    return;
  }

  await saveDb(context.dbPath, analyzed.db);
  printJson({
    ok: true,
    topicCount: analyzed.db.trend_topics.length,
    angleCount: analyzed.db.trend_angles.length,
    dbPath: context.dbPath
  }, args.pretty);
}

async function commandGetTrends(args) {
  const context = await loadContext(args);
  const topics = filterTopics(context.db.trend_topics, args)
    .slice(0, args.limit)
    .map(publicTopic);
  printJson({ topics }, args.pretty);
}

async function commandGetTopicDetails(args) {
  if (!args.topicId) throw new Error('get-topic-details requires --topic-id <id>.');
  const context = await loadContext(args);
  const topic = context.db.trend_topics.find((item) => item.id === args.topicId);
  if (!topic) {
    printJson({ topic: null, angles: [] }, args.pretty);
    return;
  }
  const angles = context.db.trend_angles
    .filter((angle) => angle.topicId === args.topicId)
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  printJson({
    topic: publicTopic(topic),
    angles
  }, args.pretty);
}

async function commandExport(args) {
  const context = await loadContext(args);
  const topics = filterTopics(context.db.trend_topics, args).slice(0, args.limit);
  const payload = args.format === 'json'
    ? formatJson({ topics, angles: context.db.trend_angles }, args.pretty)
    : renderMarkdownExport(topics, context.db.trend_angles);

  if (!args.out) {
    console.log(payload);
    return;
  }

  const outPath = path.resolve(context.root, args.out);
  await ensureDir(path.dirname(outPath));
  await fs.writeFile(outPath, payload.endsWith('\n') ? payload : payload + '\n', 'utf8');
  printJson({ ok: true, outPath }, args.pretty);
}

async function loadContext(args) {
  const root = path.resolve(args.root || __dirname);
  const configPath = args.config || path.join(root, DEFAULT_CONFIG_PATH);
  const config = await loadConfig(configPath, Boolean(args.config));
  applyRuntimeCrawlerOverrides(config, args);
  const dbPath = args.db || resolveDbPath(config, configPath);
  const db = await loadDb(dbPath);
  const now = new Date();
  return {
    args,
    root,
    config,
    configPath,
    db,
    dbPath,
    now
  };
}

function applyRuntimeCrawlerOverrides(config, args) {
  config.crawler = config.crawler || {};
  if (args.live) config.crawler.allowNetwork = true;
  if (args.noFallback) config.crawler.includeSampleFallback = false;
}

async function loadConfig(configPath, explicit) {
  if (fsSync.existsSync(configPath)) {
    return withConfigDefaults(await readJson(configPath, 'config'));
  }
  if (explicit) {
    throw new Error('Config file does not exist: ' + configPath);
  }
  if (fsSync.existsSync(EXAMPLE_CONFIG_PATH)) {
    return withConfigDefaults(await readJson(EXAMPLE_CONFIG_PATH, 'example config'));
  }
  return defaultConfig();
}

function resolveDbPath(config, configPath) {
  const raw = config.workspace?.dbPath || DEFAULT_DB_PATH;
  if (path.isAbsolute(raw)) return raw;
  return path.resolve(path.dirname(configPath), raw);
}

async function loadDb(dbPath) {
  if (!fsSync.existsSync(dbPath)) return emptyDb();
  const value = await readJson(dbPath, 'database');
  return normalizeDb(value);
}

async function collectItems(context) {
  const config = context.config;
  const crawler = config.crawler || {};
  const warnings = [];
  const selectedCategories = selectedCategoriesFromArgs(context.args, config);
  const collected = [];

  for (const category of selectedCategories) {
    const categoryConfig = config.categories?.[category] || {};
    const categoryItems = [];

    if (crawler.allowNetwork === true) {
      const sources = Array.isArray(categoryConfig.sources) ? categoryConfig.sources : [];
      for (const source of sources) {
        try {
          const sourceItems = await collectFromSource({
            source,
            category,
            config,
            now: context.now
          });
          categoryItems.push(...sourceItems);
        } catch (error) {
          warnings.push(`${category}:${source.name || source.url || 'source'}: ${error.message}`);
        }
      }
    }

    const minItems = Number(config.workspace?.minItemsPerCategory || 5);
    if (crawler.includeSampleFallback !== false && categoryItems.length < minItems) {
      const seedItems = sampleItemsForCategory(category, context.now);
      categoryItems.push(...seedItems);
      if (crawler.allowNetwork === true) {
        warnings.push(`${category}: used seed fallback to reach offline-safe coverage.`);
      }
    }

    collected.push(...categoryItems);
  }

  const maxItemsPerRun = Number(config.crawler?.maxItemsPerRun || 200);
  const deduped = dedupeItems(collected)
    .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime() || a.id.localeCompare(b.id))
    .slice(0, maxItemsPerRun);

  return { items: deduped, warnings };
}

async function collectFromSource({ source, category, config, now }) {
  if (!source || source.enabled === false) return [];
  const type = String(source.type || 'rss').toLowerCase();
  if (['rss', 'google-news-rss', 'google-trends-rss'].includes(type)) {
    return collectRssSource({ source, category, config, now, sourceType: type });
  }
  if (type === 'reddit') {
    return collectRedditSource({ source, category, config, now });
  }
  if (type === 'hackernews' || type === 'hn-algolia') {
    return collectHackerNewsSource({ source, category, config, now });
  }
  if (type === 'github-trending') {
    return collectGithubTrendingSource({ source, category, config, now });
  }
  if (type === 'youtube-search') {
    return collectYoutubeSearchSource({ source, category, config, now });
  }
  if (type === 'youtube-invidious') {
    return collectYoutubeInvidiousSource({ source, category, config, now });
  }
  if (type === 'tiktok-search') {
    return collectTikTokSearchSource({ source, category, config, now });
  }
  if (type === 'tiktok-tikwm') {
    return collectTikwmSource({ source, category, config, now });
  }
  throw new Error('Unsupported source type: ' + (source.type || ''));
}

async function collectRssSource({ source, category, config, now, sourceType }) {
  if (!source.url) throw new Error('RSS source missing url.');
  const text = await fetchText(source.url, {
    timeoutMs: Number(source.timeoutMs || config.crawler?.timeoutMs || 8000),
    userAgent: config.crawler?.userAgent || USER_AGENT
  });
  const maxItems = Number(source.maxItems || config.crawler?.maxItemsPerSource || 20);
  return parseRss(text)
    .slice(0, maxItems)
    .map((item) => normalizeRawItem({
      category,
      source: source.name || hostname(source.url),
      sourceType,
      title: cleanFeedTitle(item.title, sourceType),
      summary: cleanFeedSummary(item.summary, sourceType),
      url: item.url || source.url,
      author: item.author || '',
      publishedAt: item.publishedAt || now.toISOString(),
      collectedAt: now.toISOString(),
      engagementSeed: engagementFromText(item.title + ' ' + item.summary + ' ' + source.url)
    }));
}

async function collectRedditSource({ source, category, config, now }) {
  const maxItems = Number(source.maxItems || config.crawler?.maxItemsPerSource || 20);
  const url = source.url || redditUrlForSource(source, maxItems);
  const payload = await fetchJson(url, {
    timeoutMs: Number(source.timeoutMs || config.crawler?.timeoutMs || 8000),
    userAgent: config.crawler?.userAgent || USER_AGENT
  });
  const children = Array.isArray(payload?.data?.children) ? payload.data.children : [];
  return children.slice(0, maxItems).map((child) => {
    const data = child?.data || {};
    const permalink = data.permalink ? new URL(data.permalink, 'https://www.reddit.com').toString() : url;
    const score = Number(data.ups || data.score || 0);
    const comments = Number(data.num_comments || 0);
    return normalizeRawItem({
      category,
      source: source.name || `r/${data.subreddit || source.subreddit || 'reddit'}`,
      sourceType: 'reddit',
      title: data.title || 'Untitled Reddit post',
      summary: data.selftext || data.link_flair_text || data.url_overridden_by_dest || '',
      url: permalink,
      author: data.author || '',
      publishedAt: data.created_utc ? new Date(Number(data.created_utc) * 1000).toISOString() : now.toISOString(),
      collectedAt: now.toISOString(),
      engagement: {
        score: score + comments * 2,
        reactions: score,
        comments,
        shares: Number(data.num_crossposts || 0)
      }
    });
  });
}

function redditUrlForSource(source, maxItems) {
  const subreddit = String(source.subreddit || '').trim();
  if (!subreddit) throw new Error('Reddit source missing subreddit or url.');
  const sort = String(source.sort || 'hot').replace(/[^a-z_]/gi, '') || 'hot';
  const limit = Math.max(1, Math.min(100, Number(maxItems || 20)));
  const base = `https://api.reddit.com/r/${encodeURIComponent(subreddit)}/${sort}`;
  const params = new URLSearchParams({ limit: String(limit), raw_json: '1' });
  if (source.t) params.set('t', String(source.t));
  return `${base}?${params.toString()}`;
}

async function collectHackerNewsSource({ source, category, config, now }) {
  const maxItems = Number(source.maxItems || config.crawler?.maxItemsPerSource || 20);
  const url = source.url || hackerNewsUrlForSource(source, maxItems);
  const payload = await fetchJson(url, {
    timeoutMs: Number(source.timeoutMs || config.crawler?.timeoutMs || 8000),
    userAgent: config.crawler?.userAgent || USER_AGENT
  });
  const hits = Array.isArray(payload?.hits) ? payload.hits : [];
  return hits.slice(0, maxItems).map((hit) => {
    const title = hit.title || hit.story_title || 'Untitled Hacker News item';
    const objectId = hit.objectID || hit.story_id || shortHash(title);
    const storyUrl = hit.url || hit.story_url || `https://news.ycombinator.com/item?id=${objectId}`;
    const points = Number(hit.points || 0);
    const comments = Number(hit.num_comments || 0);
    return normalizeRawItem({
      category,
      source: source.name || 'Hacker News',
      sourceType: 'hackernews',
      title,
      summary: hit.story_text || hit.comment_text || '',
      url: storyUrl,
      author: hit.author || '',
      publishedAt: parseDateOrEmpty(hit.created_at) || now.toISOString(),
      collectedAt: now.toISOString(),
      engagement: {
        score: points + comments * 2,
        reactions: points,
        comments,
        shares: 0
      }
    });
  });
}

function hackerNewsUrlForSource(source, maxItems) {
  const query = String(source.query || 'AI').trim();
  const params = new URLSearchParams({
    query,
    tags: String(source.tags || 'story'),
    hitsPerPage: String(Math.max(1, Math.min(100, Number(maxItems || 20))))
  });
  return `https://hn.algolia.com/api/v1/search_by_date?${params.toString()}`;
}

async function collectGithubTrendingSource({ source, category, config, now }) {
  const maxItems = Number(source.maxItems || config.crawler?.maxItemsPerSource || 20);
  const url = source.url || githubTrendingUrlForSource(source);
  const html = await fetchText(url, {
    timeoutMs: Number(source.timeoutMs || config.crawler?.timeoutMs || 8000),
    userAgent: config.crawler?.userAgent || USER_AGENT
  });
  return parseGithubTrending(html, {
    category,
    sourceName: source.name || 'GitHub Trending',
    sourceUrl: url,
    maxItems,
    now
  });
}

function githubTrendingUrlForSource(source) {
  const language = String(source.language || '').trim();
  const since = String(source.since || 'daily').trim() || 'daily';
  const base = `https://github.com/trending${language ? '/' + encodeURIComponent(language) : ''}`;
  const params = new URLSearchParams({ since });
  if (source.spokenLanguageCode) params.set('spoken_language_code', String(source.spokenLanguageCode));
  return `${base}?${params.toString()}`;
}

function parseGithubTrending(html, options) {
  const articles = matchBlocks(html, 'article');
  return articles.slice(0, options.maxItems).map((block) => {
    const repoPath = cleanXmlText(matchFirst(block, /<h2[\s\S]*?<a[^>]+href=["']([^"']+)["'][^>]*>/i));
    const repoName = repoPath.replace(/^\/+/, '').replace(/\s+/g, '');
    const description = cleanXmlText(matchFirst(block, /<p[^>]*>([\s\S]*?)<\/p>/i));
    const language = cleanXmlText(matchFirst(block, /itemprop=["']programmingLanguage["'][^>]*>([\s\S]*?)<\/span>/i));
    const starsToday = parseInt((matchFirst(block, /([0-9][0-9,]*)\s+stars?\s+today/i) || '0').replace(/,/g, ''), 10) || 0;
    const totalStars = parseInt((matchFirst(block, /<a[^>]+href=["'][^"']+\/stargazers["'][\s\S]*?([0-9][0-9,]*)/i) || '0').replace(/,/g, ''), 10) || 0;
    const title = repoName ? `${repoName}${description ? ': ' + description : ''}` : description || 'Untitled GitHub Trending repository';
    return normalizeRawItem({
      category: options.category,
      source: options.sourceName,
      sourceType: 'github-trending',
      title,
      summary: [description, language ? `Language: ${language}` : '', starsToday ? `${starsToday} stars today` : ''].filter(Boolean).join('. '),
      url: repoName ? `https://github.com/${repoName}` : options.sourceUrl,
      author: repoName.split('/')[0] || '',
      publishedAt: options.now.toISOString(),
      collectedAt: options.now.toISOString(),
      engagement: {
        score: starsToday * 5 + Math.log1p(totalStars),
        reactions: totalStars,
        comments: 0,
        shares: starsToday
      }
    });
  }).filter((item) => item.title && item.url);
}

async function collectYoutubeSearchSource({ source, category, config, now }) {
  const maxItems = Number(source.maxItems || config.crawler?.maxItemsPerSource || 20);
  const url = source.url || youtubeSearchUrlForSource(source);
  const html = await fetchText(url, {
    timeoutMs: Number(source.timeoutMs || config.crawler?.timeoutMs || 8000),
    userAgent: source.userAgent || config.crawler?.browserUserAgent || browserUserAgent()
  });
  return parseYoutubeSearch(html, {
    category,
    sourceName: source.name || 'YouTube Search',
    sourceUrl: url,
    maxItems,
    now
  });
}

function youtubeSearchUrlForSource(source) {
  const query = String(source.query || '').trim();
  if (!query) throw new Error('YouTube source missing query or url.');
  const params = new URLSearchParams({ search_query: query });
  if (source.searchParams) {
    const extra = new URLSearchParams(String(source.searchParams));
    for (const [key, value] of extra.entries()) params.set(key, value);
  }
  return `https://www.youtube.com/results?${params.toString()}`;
}

function parseYoutubeSearch(html, options) {
  const renderers = extractJsonObjectsAfterKey(html, '"videoRenderer":');
  return renderers.slice(0, options.maxItems).map((renderer) => {
    const videoId = renderer.videoId || '';
    const title = textFromYoutube(renderer.title) || 'Untitled YouTube video';
    const description = textFromYoutube(renderer.detailedMetadataSnippets?.[0]?.snippetText || renderer.descriptionSnippet);
    const views = parseCompactNumber(textFromYoutube(renderer.viewCountText));
    const publishedText = textFromYoutube(renderer.publishedTimeText);
    const channel = textFromYoutube(renderer.ownerText || renderer.longBylineText);
    return normalizeRawItem({
      category: options.category,
      source: options.sourceName,
      sourceType: 'youtube-search',
      title,
      summary: description,
      url: videoId ? `https://www.youtube.com/watch?v=${videoId}` : options.sourceUrl,
      author: channel,
      publishedAt: relativeTimeToIso(publishedText, options.now) || options.now.toISOString(),
      collectedAt: options.now.toISOString(),
      engagement: {
        score: Math.log1p(views) * 12,
        reactions: views,
        comments: 0,
        shares: 0
      }
    });
  }).filter((item) => item.title && item.url);
}

async function collectYoutubeInvidiousSource({ source, category, config, now }) {
  const maxItems = Number(source.maxItems || config.crawler?.maxItemsPerSource || 20);
  const urls = source.url ? [source.url] : invidiousSearchUrlsForSource(source);
  const errors = [];
  let payload = null;
  let usedUrl = urls[0];
  for (const url of urls) {
    try {
      payload = await fetchJson(url, {
        timeoutMs: Number(source.timeoutMs || config.crawler?.timeoutMs || 8000),
        userAgent: source.userAgent || config.crawler?.userAgent || USER_AGENT
      });
      usedUrl = url;
      break;
    } catch (error) {
      errors.push(`${hostname(url)}: ${error.message}`);
    }
  }
  if (!payload) throw new Error(errors.join('; ') || 'No Invidious response.');
  const items = Array.isArray(payload) ? payload : Array.isArray(payload?.items) ? payload.items : [];
  return items
    .filter((item) => !item.type || item.type === 'video')
    .slice(0, maxItems)
    .map((item) => {
      const videoId = item.videoId || item.video_id || '';
      const views = Number(item.viewCount || item.views || 0);
      const publishedAt = item.published ? new Date(Number(item.published) * 1000).toISOString() : relativeTimeToIso(item.publishedText, now) || now.toISOString();
      return normalizeRawItem({
        category,
        source: source.name || 'YouTube Invidious Search',
        sourceType: 'youtube-invidious',
        title: item.title || 'Untitled YouTube video',
        summary: [item.description || item.descriptionHtml || '', item.author ? `Channel: ${item.author}` : '', item.publishedText || ''].filter(Boolean).join('. '),
        url: videoId ? `https://www.youtube.com/watch?v=${videoId}` : usedUrl,
        author: item.author || '',
        publishedAt,
        collectedAt: now.toISOString(),
        engagement: {
          score: Math.log1p(views) * 12,
          reactions: views,
          comments: 0,
          shares: 0
        }
      });
    });
}

function invidiousSearchUrlsForSource(source) {
  const query = String(source.query || '').trim();
  if (!query) throw new Error('Invidious source missing query or url.');
  const instances = Array.isArray(source.instances) && source.instances.length > 0
    ? source.instances
    : [source.instance || 'https://inv.nadeko.net', 'https://yewtu.be', 'https://invidious.nerdvpn.de'];
  return instances.map((instanceValue) => {
    const instance = String(instanceValue).replace(/\/+$/, '');
    const params = new URLSearchParams({
      q: query,
      type: 'video',
      sort_by: String(source.sortBy || 'date')
    });
    return `${instance}/api/v1/search?${params.toString()}`;
  });
}

async function collectTikTokSearchSource({ source, category, config, now }) {
  const maxItems = Number(source.maxItems || config.crawler?.maxItemsPerSource || 20);
  const url = source.url || tikTokSearchUrlForSource(source);
  const html = await fetchText(url, {
    timeoutMs: Number(source.timeoutMs || config.crawler?.timeoutMs || 8000),
    userAgent: source.userAgent || config.crawler?.browserUserAgent || browserUserAgent()
  });
  return parseTikTokSearch(html, {
    category,
    sourceName: source.name || 'TikTok Search',
    sourceUrl: url,
    maxItems,
    now
  });
}

function tikTokSearchUrlForSource(source) {
  if (source.tag) return `https://www.tiktok.com/tag/${encodeURIComponent(String(source.tag).replace(/^#/, ''))}`;
  const query = String(source.query || '').trim();
  if (!query) throw new Error('TikTok source missing query, tag, or url.');
  return `https://www.tiktok.com/search/video?q=${encodeURIComponent(query)}`;
}

function parseTikTokSearch(html, options) {
  const itemStructs = extractJsonObjectsAfterKey(html, '"itemStruct":');
  const parsed = itemStructs.map((item) => tiktokItemToRaw(item, options)).filter(Boolean);
  if (parsed.length > 0) return parsed.slice(0, options.maxItems);

  const regexItems = [];
  const descRegex = /"desc"\s*:\s*"((?:\\.|[^"])*)"/g;
  let match;
  while ((match = descRegex.exec(html)) && regexItems.length < options.maxItems) {
    const title = unescapeJsonString(match[1]);
    if (!title || title.length < 4) continue;
    regexItems.push(normalizeRawItem({
      category: options.category,
      source: options.sourceName,
      sourceType: 'tiktok-search',
      title,
      summary: '',
      url: options.sourceUrl,
      author: '',
      publishedAt: options.now.toISOString(),
      collectedAt: options.now.toISOString(),
      engagementSeed: engagementFromText(title)
    }));
  }
  return regexItems;
}

function tiktokItemToRaw(item, options) {
  const title = cleanText(item.desc || item.contents?.[0]?.desc || '');
  if (!title) return null;
  const stats = item.stats || item.statsV2 || {};
  const author = item.author?.uniqueId || item.author?.nickname || '';
  const videoId = item.id || '';
  const playCount = Number(stats.playCount || stats.play || 0);
  const likeCount = Number(stats.diggCount || stats.digg || 0);
  const commentCount = Number(stats.commentCount || stats.comment || 0);
  const shareCount = Number(stats.shareCount || stats.share || 0);
  return normalizeRawItem({
    category: options.category,
    source: options.sourceName,
    sourceType: 'tiktok-search',
    title,
    summary: '',
    url: author && videoId ? `https://www.tiktok.com/@${author}/video/${videoId}` : options.sourceUrl,
    author,
    publishedAt: item.createTime ? new Date(Number(item.createTime) * 1000).toISOString() : options.now.toISOString(),
    collectedAt: options.now.toISOString(),
    engagement: {
      score: Math.log1p(playCount) * 8 + likeCount * 0.02 + commentCount * 0.4 + shareCount * 0.5,
      reactions: likeCount,
      comments: commentCount,
      shares: shareCount
    }
  });
}

async function collectTikwmSource({ source, category, config, now }) {
  const maxItems = Number(source.maxItems || config.crawler?.maxItemsPerSource || 20);
  const url = source.url || tikwmSearchUrlForSource(source, maxItems);
  const payload = await fetchJson(url, {
    timeoutMs: Number(source.timeoutMs || config.crawler?.timeoutMs || 8000),
    userAgent: source.userAgent || config.crawler?.browserUserAgent || browserUserAgent()
  });
  return extractTikwmVideos(payload)
    .slice(0, maxItems)
    .map((item) => tikwmItemToRaw(item, { category, sourceName: source.name || 'TikWM TikTok Search', sourceUrl: url, now }))
    .filter(Boolean);
}

function tikwmSearchUrlForSource(source, maxItems) {
  const keyword = String(source.query || source.tag || '').replace(/^#/, '').trim();
  if (!keyword) throw new Error('TikWM source missing query, tag, or url.');
  const params = new URLSearchParams({
    keywords: keyword,
    count: String(Math.max(1, Math.min(50, Number(maxItems || 20)))),
    cursor: '0'
  });
  return `https://www.tikwm.com/api/feed/search?${params.toString()}`;
}

function extractTikwmVideos(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.data?.videos)) return payload.data.videos;
  if (Array.isArray(payload?.data?.list)) return payload.data.list;
  return [];
}

function tikwmItemToRaw(item, options) {
  const title = cleanText(item.title || item.desc || item.text || '');
  if (!title) return null;
  const author = item.author?.unique_id || item.author?.nickname || item.author || '';
  const videoId = item.video_id || item.id || item.aweme_id || '';
  const playCount = Number(item.play_count || item.play || item.stats?.playCount || 0);
  const likeCount = Number(item.digg_count || item.like_count || item.stats?.diggCount || 0);
  const commentCount = Number(item.comment_count || item.stats?.commentCount || 0);
  const shareCount = Number(item.share_count || item.stats?.shareCount || 0);
  return normalizeRawItem({
    category: options.category,
    source: options.sourceName,
    sourceType: 'tiktok-tikwm',
    title,
    summary: '',
    url: item.play || item.wmplay || item.hdplay || (author && videoId ? `https://www.tiktok.com/@${author}/video/${videoId}` : options.sourceUrl),
    author: typeof author === 'string' ? author : '',
    publishedAt: item.create_time ? new Date(Number(item.create_time) * 1000).toISOString() : options.now.toISOString(),
    collectedAt: options.now.toISOString(),
    engagement: {
      score: Math.log1p(playCount) * 8 + likeCount * 0.02 + commentCount * 0.4 + shareCount * 0.5,
      reactions: likeCount,
      comments: commentCount,
      shares: shareCount
    }
  });
}

function fetchText(url, options, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https:') ? https : http;
    const request = client.get(url, {
      headers: {
        'user-agent': options.userAgent || USER_AGENT,
        'accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*'
      },
      timeout: options.timeoutMs || 8000
    }, (response) => {
      const status = response.statusCode || 0;
      const location = response.headers.location;
      if (status >= 300 && status < 400 && location) {
        response.resume();
        if (redirectCount >= 3) {
          reject(new Error('Too many redirects.'));
          return;
        }
        const redirected = new URL(location, url).toString();
        fetchText(redirected, options, redirectCount + 1).then(resolve, reject);
        return;
      }
      if (status < 200 || status >= 300) {
        response.resume();
        reject(new Error('HTTP ' + status));
        return;
      }

      const chunks = [];
      response.setEncoding('utf8');
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve(chunks.join('')));
    });

    request.on('timeout', () => {
      request.destroy(new Error('Request timed out.'));
    });
    request.on('error', reject);
  });
}

async function fetchJson(url, options) {
  const text = await fetchText(url, options);
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error('Failed to parse JSON from ' + hostname(url) + ': ' + error.message);
  }
}

function parseRss(xml) {
  const blocks = matchBlocks(xml, 'item').length > 0 ? matchBlocks(xml, 'item') : matchBlocks(xml, 'entry');
  return blocks.map((block) => {
    const title = cleanXmlText(firstTag(block, 'title'));
    const summary = cleanXmlText(firstTag(block, 'description') || firstTag(block, 'summary') || firstTag(block, 'content'));
    const guid = cleanXmlText(firstTag(block, 'guid') || firstTag(block, 'id'));
    const link = cleanXmlText(firstTag(block, 'link')) || atomLink(block) || guid;
    const date = cleanXmlText(firstTag(block, 'pubDate') || firstTag(block, 'published') || firstTag(block, 'updated'));
    const author = cleanXmlText(firstTag(block, 'author') || firstTag(block, 'creator'));
    return {
      title: title || link || 'Untitled item',
      summary,
      url: link,
      publishedAt: parseDateOrEmpty(date),
      author
    };
  }).filter((item) => item.title || item.url);
}

function matchBlocks(xml, tag) {
  const regex = new RegExp(`<${tag}\\b[\\s\\S]*?<\\/${tag}>`, 'gi');
  return xml.match(regex) || [];
}

function matchFirst(value, regex) {
  const match = String(value || '').match(regex);
  return match ? match[1] : '';
}

function firstTag(block, tag) {
  const regex = new RegExp(`<[^:>]*:?${tag}\\b[^>]*>([\\s\\S]*?)<\\/[^:>]*:?${tag}>`, 'i');
  const match = block.match(regex);
  return match ? match[1] : '';
}

function atomLink(block) {
  const match = block.match(/<link\b[^>]*href=["']([^"']+)["'][^>]*>/i);
  return match ? decodeXml(match[1]) : '';
}

function cleanXmlText(value) {
  return decodeXml(String(value || ''))
    .replace(/<!\[CDATA\[|\]\]>/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function decodeXml(value) {
  return String(value || '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#160;/g, ' ')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

function cleanFeedTitle(value, sourceType) {
  const title = cleanText(value);
  if (sourceType !== 'google-news-rss') return title;
  return title.replace(/\s+-\s+[^-]{2,80}$/u, '').trim() || title;
}

function cleanFeedSummary(value, sourceType) {
  const summary = cleanText(value);
  if (sourceType !== 'google-news-rss') return summary;
  return summary
    .replace(/<a\b[\s\S]*?<\/a>/gi, ' ')
    .replace(/\s+-\s+[^-]{2,80}(?=\s|$)/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseDateOrEmpty(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

function sampleItemsForCategory(category, now) {
  return (SAMPLE_ITEMS[category] || []).map((item) => normalizeRawItem({
    category,
    source: item.source,
    sourceType: item.sourceType,
    title: item.title,
    summary: item.summary,
    url: item.url,
    author: 'trend-search seed',
    publishedAt: new Date(now.getTime() - item.offsetHours * HOUR_MS).toISOString(),
    collectedAt: now.toISOString(),
    engagementSeed: item.engagementSeed
  }));
}

function normalizeRawItem(input) {
  const title = cleanText(input.title || 'Untitled trend item');
  const summary = cleanText(input.summary || '');
  const publishedAt = parseDateOrEmpty(input.publishedAt) || isoNow();
  const category = normalizeCategory(input.category || 'tech');
  const url = input.url || `seed://${category}/${slug(title)}`;
  const engagementSeed = Number(input.engagementSeed || engagementFromText(title + summary + url));
  const engagement = normalizeEngagement(input.engagement, engagementSeed);
  const id = 'raw_' + shortHash([category, url, title].join('|'));
  return {
    id,
    category,
    source: input.source || 'Unknown source',
    sourceType: input.sourceType || 'unknown',
    title,
    summary,
    url,
    author: input.author || '',
    publishedAt,
    collectedAt: input.collectedAt || isoNow(),
    engagement,
    keywords: []
  };
}

function normalizeEngagement(value, fallbackSeed) {
  if (!value || typeof value !== 'object') return buildEngagement(fallbackSeed);
  const score = Math.max(1, Math.round(Number(value.score || 0) || Number(fallbackSeed) || 1));
  return {
    score,
    reactions: Math.max(0, Math.round(Number(value.reactions || 0))),
    comments: Math.max(0, Math.round(Number(value.comments || 0))),
    shares: Math.max(0, Math.round(Number(value.shares || 0)))
  };
}

function buildEngagement(seed) {
  const value = Math.max(1, Math.round(Number(seed) || 1));
  return {
    score: value,
    reactions: Math.round(value * 4.7),
    comments: Math.round(value * 0.8),
    shares: Math.round(value * 0.45)
  };
}

function engagementFromText(text) {
  const number = parseInt(shortHash(text).slice(0, 8), 16);
  return 25 + (number % 75);
}

function dedupeItems(items) {
  const byKey = new Map();
  for (const item of items) {
    const key = item.url && !item.url.startsWith('seed://') ? item.url : item.id;
    if (!byKey.has(key)) byKey.set(key, item);
  }
  return [...byKey.values()];
}

function mergeRawItems(db, items, config, now) {
  const existing = new Map(db.raw_items.map((item) => [item.id, item]));
  for (const item of items) {
    existing.set(item.id, {
      ...existing.get(item.id),
      ...item
    });
  }

  const retentionDays = Number(config.workspace?.rawRetentionDays || 45);
  const minTime = now.getTime() - retentionDays * DAY_MS;
  db.raw_items = [...existing.values()]
    .filter((item) => new Date(item.publishedAt).getTime() >= minTime || item.sourceType === 'seed')
    .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime() || a.id.localeCompare(b.id));
  return db;
}

function analyzeTrends({ db, config, args, now, skipAngles = false }) {
  const lookbackHours = Number(args.hours || config.scoring?.lookbackHours || 168);
  const selectedCategories = selectedCategoriesFromArgs(args, config);
  const minTime = now.getTime() - lookbackHours * HOUR_MS;
  const rawItems = db.raw_items.filter((item) => {
    if (!selectedCategories.includes(item.category)) return false;
    const time = new Date(item.publishedAt).getTime();
    return Number.isFinite(time) && time >= minTime;
  });

  const previousTopicsById = new Map(db.trend_topics.map((topic) => [topic.id, topic]));
  const clusters = buildClusters(rawItems, config);
  const topics = scoreClusters({
    clusters,
    rawItems,
    config,
    now,
    previousTopicsById
  });
  const untouchedTopics = db.trend_topics.filter((topic) => !selectedCategories.includes(topic.category));
  db.trend_topics = [...untouchedTopics, ...topics]
    .sort((a, b) => b.score - a.score || b.mentionCount - a.mentionCount || a.id.localeCompare(b.id));

  if (!skipAngles) {
    const untouchedAngles = db.trend_angles.filter((angle) => {
      const topic = db.trend_topics.find((item) => item.id === angle.topicId);
      return topic && !selectedCategories.includes(topic.category);
    });
    const language = args.language || config.output?.language || 'vi';
    db.trend_angles = [
      ...untouchedAngles,
      ...generateAngles(topics, rawItems, language)
    ].sort((a, b) => a.topicId.localeCompare(b.topicId) || b.score - a.score || a.id.localeCompare(b.id));
  }

  db.updatedAt = now.toISOString();
  return { db };
}

function buildClusters(items, config) {
  const clusters = new Map();
  const configuredKeywords = new Set();
  for (const category of CATEGORIES) {
    const keywords = [
      ...(CATEGORY_META[category]?.keywords || []),
      ...(config.categories?.[category]?.keywords || [])
    ];
    for (const keyword of keywords) {
      configuredKeywords.add(category + '::' + canonicalPhrase(keyword));
    }
  }

  for (const item of items) {
    const candidates = extractCandidates(item, config);
    const uniqueCandidates = [...new Set(candidates)].slice(0, 14);
    for (const candidate of uniqueCandidates) {
      const canonical = canonicalPhrase(candidate);
      if (!isUsefulPhrase(canonical)) continue;
      const key = item.category + '::' + canonical;
      const cluster = clusters.get(key) || {
        category: item.category,
        canonical,
        labels: new Map(),
        itemIds: new Set(),
        sources: new Set(),
        engagement: 0,
        publishedTimes: []
      };
      cluster.labels.set(candidate, (cluster.labels.get(candidate) || 0) + 1);
      cluster.itemIds.add(item.id);
      cluster.sources.add(item.source);
      cluster.engagement += Number(item.engagement?.score || 0);
      cluster.publishedTimes.push(new Date(item.publishedAt).getTime());
      clusters.set(key, cluster);
    }
  }

  return [...clusters.values()]
    .filter((cluster) => cluster.itemIds.size >= 2 || configuredKeywords.has(cluster.category + '::' + cluster.canonical))
    .sort((a, b) => b.itemIds.size - a.itemIds.size || a.canonical.localeCompare(b.canonical));
}

function extractCandidates(item, config) {
  const text = normalizeText([item.title, item.summary].filter(Boolean).join(' '));
  const categoryKeywords = [
    ...(CATEGORY_META[item.category]?.keywords || []),
    ...(config.categories?.[item.category]?.keywords || [])
  ];
  const candidates = [];

  for (const keyword of categoryKeywords) {
    const normalizedKeyword = normalizeText(keyword);
    if (normalizedKeyword && text.includes(normalizedKeyword)) {
      candidates.push(normalizedKeyword);
    }
  }

  const titleTokens = tokenize(item.title);
  const summaryTokens = tokenize(item.summary);
  candidates.push(...ngrams(titleTokens, 2, 4));
  candidates.push(...ngrams(summaryTokens, 2, 3).slice(0, 10));

  let output = candidates;
  if (PLATFORM_SOURCE_TYPES.has(item.sourceType)) {
    output = output.filter((value) => {
      const tokens = canonicalPhrase(value).split(/\s+/);
      return tokens.some((token) => PLATFORM_KEEP_TERMS.has(token));
    });
  }

  return output
    .map((value) => value.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .filter((value) => value.length >= 5 && value.length <= 80);
}

function tokenize(text) {
  return normalizeText(text)
    .split(/\s+/)
    .map((token) => token.replace(/^[-_.#]+|[-_.#]+$/g, ''))
    .filter((token) => token.length > 1)
    .filter((token) => !STOPWORDS.has(token));
}

function ngrams(tokens, min, max) {
  const phrases = [];
  for (let size = min; size <= max; size += 1) {
    for (let index = 0; index <= tokens.length - size; index += 1) {
      const slice = tokens.slice(index, index + size);
      if (slice.some((token) => GENERIC_TERMS.has(token)) && slice.length < 3) continue;
      phrases.push(slice.join(' '));
    }
  }
  return phrases;
}

function canonicalPhrase(value) {
  let phrase = normalizeText(value);
  for (const [regex, replacement] of CANONICAL_REPLACEMENTS) {
    phrase = phrase.replace(regex, replacement);
  }
  phrase = phrase
    .split(/\s+/)
    .map((token) => {
      token = token.replace(/^#+/, '');
      if (['agents', 'passkeys', 'evals'].includes(token)) return token;
      if (token.endsWith('ies') && token.length > 5) return token.slice(0, -3) + 'y';
      if (token.endsWith('s') && token.length > 5 && !token.endsWith('ss')) return token.slice(0, -1);
      return token;
    })
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  return phrase;
}

function isUsefulPhrase(phrase) {
  if (!phrase || phrase.length < 3) return false;
  const tokens = phrase.split(/\s+/);
  if (tokens.length === 1 && GENERIC_TERMS.has(tokens[0])) return false;
  if (tokens.every((token) => STOPWORDS.has(token) || GENERIC_TERMS.has(token))) return false;
  return true;
}

function scoreClusters({ clusters, rawItems, config, now, previousTopicsById }) {
  const maxEngagement = Math.max(1, ...clusters.map((cluster) => cluster.engagement));
  const itemsById = new Map(rawItems.map((item) => [item.id, item]));

  return clusters.map((cluster) => {
    const topicId = topicIdFor(cluster.category, cluster.canonical);
    const previous = previousTopicsById.get(topicId);
    const itemIds = [...cluster.itemIds].sort();
    const topicItems = itemIds.map((id) => itemsById.get(id)).filter(Boolean);
    const mentionCount = itemIds.length;
    const recentCount = topicItems.filter((item) => hoursAgo(item.publishedAt, now) <= 48).length;
    const olderCount = Math.max(0, mentionCount - recentCount);
    const recencyAvg = average(topicItems.map((item) => recencyScore(item.publishedAt, now)));
    const sourceDiversity = clamp01(cluster.sources.size / Math.max(2, mentionCount));
    const growth = clamp01((recentCount + 0.35 * recencyAvg) / (olderCount + recentCount + 1) + sourceDiversity * 0.18);
    const engagement = clamp01((Math.log1p(cluster.engagement) / Math.log1p(maxEngagement)) * 0.82 + sourceDiversity * 0.18);
    const novelty = noveltyScore(cluster, previous, now);
    const competition = competitionScore(cluster, config);
    const growthPoints = Math.round(growth * 40);
    const engagementPoints = Math.round(engagement * 30);
    const noveltyPoints = Math.round(novelty * 25);
    const competitionPoints = Math.round(competition * 35);
    const scoreRaw = growthPoints + engagementPoints + noveltyPoints - competitionPoints;
    const score = Math.round(clamp(scoreRaw, 0, 100));
    const times = cluster.publishedTimes.filter(Number.isFinite).sort((a, b) => a - b);
    const label = bestLabel(cluster);
    const keywords = [...new Set([cluster.canonical, ...label.split(/\s+/).filter((token) => !STOPWORDS.has(token))])]
      .slice(0, 8);

    return {
      id: topicId,
      category: cluster.category,
      name: titleCase(label),
      canonicalName: cluster.canonical,
      summary: summarizeTopic(cluster, topicItems),
      keywords,
      score,
      scoreFormula: 'growth + engagement + novelty - competition',
      components: {
        growth: growthPoints,
        engagement: engagementPoints,
        novelty: noveltyPoints,
        competition: competitionPoints,
        raw: scoreRaw
      },
      mentionCount,
      sourceCount: cluster.sources.size,
      itemIds,
      evidence: topicItems
        .sort((a, b) => Number(b.engagement?.score || 0) - Number(a.engagement?.score || 0))
        .slice(0, 5)
        .map((item) => ({
          id: item.id,
          title: item.title,
          source: item.source,
          sourceType: item.sourceType,
          url: item.url,
          publishedAt: item.publishedAt
        })),
      firstSeenAt: previous?.firstSeenAt || (times[0] ? new Date(times[0]).toISOString() : now.toISOString()),
      lastSeenAt: times.length ? new Date(times[times.length - 1]).toISOString() : now.toISOString(),
      updatedAt: now.toISOString()
    };
  }).sort((a, b) => b.score - a.score || b.mentionCount - a.mentionCount || a.id.localeCompare(b.id));
}

function bestLabel(cluster) {
  const labels = [...cluster.labels.entries()].sort((a, b) => b[1] - a[1] || b[0].split(/\s+/).length - a[0].split(/\s+/).length || a[0].localeCompare(b[0]));
  return labels[0]?.[0] || cluster.canonical;
}

function summarizeTopic(cluster, items) {
  const source = [...cluster.sources].sort().slice(0, 3).join(', ');
  const mentionText = `${cluster.itemIds.size} mention(s) across ${cluster.sources.size} source(s)`;
  const topTitle = items.sort((a, b) => Number(b.engagement?.score || 0) - Number(a.engagement?.score || 0))[0]?.title || titleCase(cluster.canonical);
  return `${mentionText}. Lead signal: ${topTitle}. Sources: ${source}.`;
}

function noveltyScore(cluster, previous, now) {
  const tokens = cluster.canonical.split(/\s+/);
  const genericPenalty = tokens.filter((token) => GENERIC_TERMS.has(token)).length / Math.max(1, tokens.length) * 0.25;
  const specificity = clamp01((tokens.length - 1) / 4);
  const previousAgeHours = previous ? hoursAgo(previous.firstSeenAt || previous.updatedAt, now) : 0;
  const historyPenalty = previous ? clamp01(previousAgeHours / (24 * 30)) * 0.28 : 0;
  const firstSeenBonus = previous ? 0.12 : 0.32;
  return clamp01(0.45 + specificity * 0.26 + firstSeenBonus - genericPenalty - historyPenalty);
}

function competitionScore(cluster, config) {
  const hints = config.scoring?.competitionHints || {};
  const directHint = hints[cluster.canonical];
  if (Number.isFinite(directHint)) return clamp01(Number(directHint));

  const tokens = cluster.canonical.split(/\s+/);
  const generic = tokens.filter((token) => GENERIC_TERMS.has(token)).length / Math.max(1, tokens.length);
  const crowdedWords = ['ai', 'skin', 'beauty', 'saas', 'startup', 'passkeys', 'copilot'];
  const crowded = tokens.filter((token) => crowdedWords.includes(token)).length * 0.08;
  const mentionPressure = clamp01(cluster.itemIds.size / 18) * 0.26;
  return clamp01(0.18 + generic * 0.26 + crowded + mentionPressure);
}

function generateAngles(topics, rawItems, language) {
  const itemsById = new Map(rawItems.map((item) => [item.id, item]));
  const vi = String(language || 'vi').toLowerCase().startsWith('vi');
  const angles = [];

  for (const topic of topics) {
    const meta = CATEGORY_META[topic.category] || CATEGORY_META.tech;
    const evidenceTitles = topic.itemIds
      .map((id) => itemsById.get(id)?.title)
      .filter(Boolean)
      .slice(0, 3);
    const audience = vi ? meta.viAudience : meta.audience;
    const base = vi ? viAngleTemplates(topic, audience, evidenceTitles) : enAngleTemplates(topic, audience, evidenceTitles);
    for (const template of base) {
      angles.push({
        id: `angle_${topic.id}_${template.kind}`,
        topicId: topic.id,
        category: topic.category,
        kind: template.kind,
        title: template.title,
        audience,
        format: template.format,
        hook: template.hook,
        outline: template.outline,
        rationale: template.rationale,
        score: Math.max(1, Math.min(100, Math.round(topic.score * template.weight))),
        generatedAt: topic.updatedAt
      });
    }
  }

  return angles;
}

function viAngleTemplates(topic, audience, evidenceTitles) {
  const name = topic.name;
  const evidence = evidenceTitles[0] || name;
  return [
    {
      kind: 'explainer',
      weight: 0.98,
      title: `Vi sao ${name} dang tang toc`,
      format: 'short explainer',
      hook: `${name} khong chi la mot tu khoa moi; tin hieu dang lap lai qua ${topic.mentionCount} mention.`,
      outline: [
        `Mo dau bang tin hieu chinh: ${evidence}`,
        'Giai thich dieu da thay doi trong hanh vi nguoi dung hoac buyer',
        'Chi ra mot cach ung dung thuc te trong 7 ngay toi'
      ],
      rationale: 'Explainer hop voi topic co growth va novelty cao.'
    },
    {
      kind: 'playbook',
      weight: 0.9,
      title: `Playbook ung dung ${name} cho ${audience}`,
      format: 'checklist',
      hook: `Bien ${name} thanh mot thu nghiem nho, do duoc, it rui ro.`,
      outline: [
        'Xac dinh use case co dau ra ro rang',
        'Dat baseline truoc khi thu nghiem',
        'Chay pilot nho va ghi lai metric can cai thien'
      ],
      rationale: 'Playbook phu hop khi can bien trend thanh hanh dong.'
    },
    {
      kind: 'contrarian',
      weight: 0.82,
      title: `Mat trai cua ${name} ma nhieu nguoi bo qua`,
      format: 'contrarian post',
      hook: `Trend nay dang nong, nhung competition score la ${topic.components.competition}.`,
      outline: [
        'Neu ly do trend hap dan',
        'Neu diem de bi thoi phong hoac kho scale',
        'Dua ra dieu kien de van nen theo duoi'
      ],
      rationale: 'Contrarian angle giup tranh noi dung trung lap khi competition tang.'
    },
    {
      kind: 'comparison',
      weight: 0.78,
      title: `${name}: cach moi so voi cach cu`,
      format: 'comparison table',
      hook: `Nguoi doc can biet ${name} thay doi workflow nao, khong chi ten goi nao moi.`,
      outline: [
        'Cot 1: cach lam cu',
        'Cot 2: cach dang noi len',
        'Cot 3: khi nao nen doi'
      ],
      rationale: 'Comparison lam ro novelty va giup user quyet dinh nhanh.'
    }
  ];
}

function enAngleTemplates(topic, audience, evidenceTitles) {
  const name = topic.name;
  const evidence = evidenceTitles[0] || name;
  return [
    {
      kind: 'explainer',
      weight: 0.98,
      title: `Why ${name} is accelerating`,
      format: 'short explainer',
      hook: `${name} is showing repeated signal across ${topic.mentionCount} mention(s), not a one-off headline.`,
      outline: [
        `Open with the strongest signal: ${evidence}`,
        'Explain what changed in user or buyer behavior',
        'Show one practical move to test in the next 7 days'
      ],
      rationale: 'Explainers fit topics with high growth and novelty.'
    },
    {
      kind: 'playbook',
      weight: 0.9,
      title: `${name} playbook for ${audience}`,
      format: 'checklist',
      hook: `Turn ${name} into a small, measurable, low-risk experiment.`,
      outline: [
        'Choose one use case with a clear output',
        'Set a baseline before testing',
        'Run a small pilot and capture the metric'
      ],
      rationale: 'Playbooks convert trend interest into action.'
    },
    {
      kind: 'contrarian',
      weight: 0.82,
      title: `The overlooked downside of ${name}`,
      format: 'contrarian post',
      hook: `This trend is heating up, but its competition component is ${topic.components.competition}.`,
      outline: [
        'Name why the trend is attractive',
        'Name what is overhyped or hard to scale',
        'Give conditions where it is still worth pursuing'
      ],
      rationale: 'Contrarian angles reduce me-too content when competition rises.'
    },
    {
      kind: 'comparison',
      weight: 0.78,
      title: `${name}: the new way vs the old way`,
      format: 'comparison table',
      hook: `Readers need to know which workflow ${name} changes, not only the new label.`,
      outline: [
        'Column 1: old workflow',
        'Column 2: emerging workflow',
        'Column 3: when to switch'
      ],
      rationale: 'Comparison clarifies novelty and decision criteria.'
    }
  ];
}

function filterTopics(topics, args) {
  return topics
    .filter((topic) => !args.category || topic.category === args.category)
    .sort((a, b) => b.score - a.score || b.mentionCount - a.mentionCount || a.id.localeCompare(b.id));
}

function publicTopic(topic) {
  return {
    id: topic.id,
    category: topic.category,
    name: topic.name,
    summary: topic.summary,
    keywords: topic.keywords,
    score: topic.score,
    components: topic.components,
    mentionCount: topic.mentionCount,
    sourceCount: topic.sourceCount,
    firstSeenAt: topic.firstSeenAt,
    lastSeenAt: topic.lastSeenAt,
    updatedAt: topic.updatedAt,
    evidence: topic.evidence
  };
}

function renderMarkdownExport(topics, angles) {
  const lines = ['# Trend Search Export', '', `Generated: ${isoNow()}`, ''];
  for (const topic of topics) {
    lines.push(`## ${topic.name}`);
    lines.push('');
    lines.push(`- Category: ${topic.category}`);
    lines.push(`- Score: ${topic.score}`);
    lines.push(`- Formula: ${topic.scoreFormula}`);
    lines.push(`- Mentions: ${topic.mentionCount}`);
    lines.push(`- Summary: ${topic.summary}`);
    lines.push('');
    const topicAngles = angles
      .filter((angle) => angle.topicId === topic.id)
      .sort((a, b) => b.score - a.score);
    for (const angle of topicAngles) {
      lines.push(`### ${angle.title}`);
      lines.push('');
      lines.push(`Format: ${angle.format}`);
      lines.push('');
      lines.push(angle.hook);
      lines.push('');
      for (const item of angle.outline) {
        lines.push(`- ${item}`);
      }
      lines.push('');
    }
  }
  return lines.join('\n');
}

function defaultConfig() {
  return {
    schemaVersion: 1,
    workspace: {
      dbPath: DEFAULT_DB_PATH,
      rawRetentionDays: 45,
      minItemsPerCategory: 5,
      maxRuns: 50
    },
    crawler: {
      allowNetwork: false,
      includeSampleFallback: true,
      timeoutMs: 8000,
      maxItemsPerSource: 20,
      maxItemsPerRun: 400,
      userAgent: USER_AGENT
    },
    scoring: {
      lookbackHours: 168,
      competitionHints: {
        'ai agents': 0.62,
        'barrier repair': 0.48,
        'on-device ai': 0.54,
        'passkeys': 0.5,
        'ai operating leverage': 0.42
      }
    },
    output: {
      language: 'vi'
    },
    categories: {
      ai: {
        enabled: true,
        keywords: CATEGORY_META.ai.keywords,
        sources: [
          {
            name: 'YouTube AI Agent Search',
            type: 'youtube-invidious',
            query: 'AI agent',
            instances: [
              'https://inv.nadeko.net',
              'https://yewtu.be',
              'https://invidious.nerdvpn.de'
            ],
            maxItems: 20,
            timeoutMs: 8000
          },
          {
            name: 'YouTube Agentic AI Search',
            type: 'youtube-invidious',
            query: 'agentic AI',
            instances: [
              'https://inv.nadeko.net',
              'https://yewtu.be',
              'https://invidious.nerdvpn.de'
            ],
            maxItems: 20,
            timeoutMs: 8000
          },
          {
            name: 'YouTube AI Automation Search',
            type: 'youtube-invidious',
            query: 'AI automation agents',
            instances: [
              'https://inv.nadeko.net',
              'https://yewtu.be',
              'https://invidious.nerdvpn.de'
            ],
            maxItems: 20,
            timeoutMs: 8000
          },
          {
            name: 'TikTok AI Agent Search',
            type: 'tiktok-tikwm',
            query: 'AI agent',
            maxItems: 20,
            timeoutMs: 8000
          },
          {
            name: 'TikTok Agentic AI Search',
            type: 'tiktok-tikwm',
            query: 'agentic AI',
            maxItems: 20,
            timeoutMs: 8000
          },
          {
            name: 'TikTok hashtag aiagent',
            type: 'tiktok-tikwm',
            tag: 'aiagent',
            maxItems: 20,
            timeoutMs: 8000
          },
          {
            name: 'YouTube Direct AI Agent Search',
            type: 'youtube-search',
            enabled: false,
            query: 'AI agent',
            maxItems: 20,
            timeoutMs: 8000
          },
          {
            name: 'TikTok Direct AI Agent Search',
            type: 'tiktok-search',
            enabled: false,
            query: 'AI agent',
            maxItems: 20,
            timeoutMs: 8000
          },
          {
            name: 'Google News AI Agents',
            type: 'google-news-rss',
            enabled: false,
            url: 'https://news.google.com/rss/search?q=%22AI%20agent%22%20OR%20%22agentic%20AI%22%20OR%20%22LLM%20agent%22&hl=en-US&gl=US&ceid=US:en',
            maxItems: 20
          },
          {
            name: 'Google Trends Daily US',
            type: 'google-trends-rss',
            enabled: false,
            url: 'https://trends.google.com/trends/trendingsearches/daily/rss?geo=US',
            maxItems: 20
          }
        ]
      },
      beauty: {
        enabled: true,
        keywords: CATEGORY_META.beauty.keywords,
        sources: [
          {
            name: 'Google News Beauty Trends',
            type: 'google-news-rss',
            url: 'https://news.google.com/rss/search?q=beauty%20trends%20OR%20skincare%20trend%20OR%20makeup%20trend&hl=en-US&gl=US&ceid=US:en',
            maxItems: 20
          },
          {
            name: 'Reddit r/SkincareAddiction',
            type: 'reddit',
            subreddit: 'SkincareAddiction',
            sort: 'hot',
            maxItems: 20
          },
          {
            name: 'Reddit r/MakeupAddiction',
            type: 'reddit',
            subreddit: 'MakeupAddiction',
            sort: 'hot',
            maxItems: 20
          }
        ]
      },
      tech: {
        enabled: true,
        keywords: CATEGORY_META.tech.keywords,
        sources: [
          {
            name: 'Hacker News Developer Tools',
            type: 'hackernews',
            query: 'developer tools',
            maxItems: 20
          },
          {
            name: 'Hacker News Security Automation',
            type: 'hackernews',
            query: 'security automation',
            maxItems: 20
          },
          {
            name: 'Google News Tech Trends',
            type: 'google-news-rss',
            url: 'https://news.google.com/rss/search?q=technology%20trends%20OR%20developer%20tools%20OR%20cybersecurity&hl=en-US&gl=US&ceid=US:en',
            maxItems: 20
          },
          {
            name: 'GitHub Trending',
            type: 'github-trending',
            since: 'daily',
            maxItems: 25,
            timeoutMs: 15000
          },
          {
            name: 'Reddit r/technology',
            type: 'reddit',
            subreddit: 'technology',
            sort: 'hot',
            maxItems: 20
          }
        ]
      },
      business: {
        enabled: true,
        keywords: CATEGORY_META.business.keywords,
        sources: [
          {
            name: 'Google News Business Trends',
            type: 'google-news-rss',
            url: 'https://news.google.com/rss/search?q=business%20trends%20automation%20OR%20startup%20growth%20OR%20AI%20business&hl=en-US&gl=US&ceid=US:en',
            maxItems: 20
          },
          {
            name: 'Hacker News Startups',
            type: 'hackernews',
            query: 'startup growth',
            maxItems: 20
          },
          {
            name: 'Reddit r/startups',
            type: 'reddit',
            subreddit: 'startups',
            sort: 'hot',
            maxItems: 20
          },
          {
            name: 'Reddit r/Entrepreneur',
            type: 'reddit',
            subreddit: 'Entrepreneur',
            sort: 'hot',
            maxItems: 20
          }
        ]
      }
    }
  };
}

function withConfigDefaults(config) {
  const defaults = defaultConfig();
  const merged = {
    ...defaults,
    ...config,
    workspace: {
      ...defaults.workspace,
      ...(config.workspace || {})
    },
    crawler: {
      ...defaults.crawler,
      ...(config.crawler || {})
    },
    scoring: {
      ...defaults.scoring,
      ...(config.scoring || {}),
      competitionHints: {
        ...defaults.scoring.competitionHints,
        ...(config.scoring?.competitionHints || {})
      }
    },
    output: {
      ...defaults.output,
      ...(config.output || {})
    },
    categories: {}
  };

  for (const category of CATEGORIES) {
    merged.categories[category] = {
      ...defaults.categories[category],
      ...(config.categories?.[category] || {}),
      keywords: [
        ...(defaults.categories[category].keywords || []),
        ...(config.categories?.[category]?.keywords || [])
      ]
    };
  }

  return merged;
}

function emptyDb() {
  return {
    schemaVersion: 1,
    updatedAt: isoNow(),
    trend_topics: [],
    trend_angles: [],
    raw_items: [],
    runs: []
  };
}

function normalizeDb(value) {
  const db = {
    ...emptyDb(),
    ...(value || {})
  };
  db.trend_topics = Array.isArray(db.trend_topics) ? db.trend_topics : [];
  db.trend_angles = Array.isArray(db.trend_angles) ? db.trend_angles : [];
  db.raw_items = Array.isArray(db.raw_items) ? db.raw_items : [];
  db.runs = Array.isArray(db.runs) ? db.runs : [];
  return db;
}

function makeRun(command, startedAt, context, stats) {
  const endedAt = isoNow();
  return {
    id: 'run_' + shortHash([command, startedAt, endedAt, JSON.stringify(stats)].join('|')),
    command,
    startedAt,
    endedAt,
    status: 'ok',
    category: context.args.category || 'all',
    configPath: context.configPath,
    dbPath: context.dbPath,
    stats
  };
}

function trimRuns(db) {
  const maxRuns = 50;
  db.runs = db.runs
    .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
    .slice(0, maxRuns)
    .sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime());
}

async function readJson(file, label) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (error) {
    throw new Error(`Failed to read ${label} JSON at ${file}: ${error.message}`);
  }
}

async function writeJsonIfAllowed(file, value, force, label) {
  if (!force && fsSync.existsSync(file)) {
    throw new Error(`${label} already exists at ${file}. Use --force to overwrite.`);
  }
  await writeJson(file, value);
}

async function writeJson(file, value) {
  await ensureDir(path.dirname(file));
  await fs.writeFile(file, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

async function saveDb(dbPath, db) {
  db.updatedAt = isoNow();
  await writeJson(dbPath, db);
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

function printJson(value, pretty) {
  console.log(formatJson(value, pretty));
}

function formatJson(value, pretty) {
  return JSON.stringify(value, null, pretty ? 2 : 0);
}

function extractJsonObjectsAfterKey(text, key) {
  const output = [];
  let cursor = 0;
  while (cursor < text.length) {
    const keyIndex = text.indexOf(key, cursor);
    if (keyIndex === -1) break;
    const start = text.indexOf('{', keyIndex + key.length);
    if (start === -1) break;
    const jsonText = extractBalancedJsonObject(text, start);
    if (!jsonText) {
      cursor = start + 1;
      continue;
    }
    try {
      output.push(JSON.parse(jsonText));
    } catch {
      // Ignore partial objects in heavily escaped hydration blobs.
    }
    cursor = start + Math.max(1, jsonText.length);
  }
  return output;
}

function extractBalancedJsonObject(text, start) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
    } else if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }
  return '';
}

function textFromYoutube(value) {
  if (!value) return '';
  if (typeof value === 'string') return cleanText(value);
  if (value.simpleText) return cleanText(value.simpleText);
  if (Array.isArray(value.runs)) return cleanText(value.runs.map((run) => run.text || '').join(' '));
  if (value.accessibility?.accessibilityData?.label) return cleanText(value.accessibility.accessibilityData.label);
  return '';
}

function parseCompactNumber(value) {
  const text = String(value || '').replace(/,/g, '').toLowerCase();
  const match = text.match(/([0-9]+(?:\.[0-9]+)?)\s*([kmb])?/);
  if (!match) return 0;
  const base = Number(match[1]);
  const suffix = match[2] || '';
  const multiplier = suffix === 'b' ? 1_000_000_000 : suffix === 'm' ? 1_000_000 : suffix === 'k' ? 1_000 : 1;
  return Math.round(base * multiplier);
}

function relativeTimeToIso(value, now) {
  const text = String(value || '').toLowerCase();
  const match = text.match(/([0-9]+)\s+(second|minute|hour|day|week|month|year)s?\s+ago/);
  if (!match) return '';
  const amount = Number(match[1]);
  const unit = match[2];
  const multipliers = {
    second: 1000,
    minute: 60 * 1000,
    hour: HOUR_MS,
    day: DAY_MS,
    week: 7 * DAY_MS,
    month: 30 * DAY_MS,
    year: 365 * DAY_MS
  };
  return new Date(now.getTime() - amount * multipliers[unit]).toISOString();
}

function browserUserAgent() {
  return 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 trend-search/0.1';
}

function unescapeJsonString(value) {
  try {
    return cleanText(JSON.parse(`"${value}"`));
  } catch {
    return cleanText(String(value || '').replace(/\\"/g, '"').replace(/\\n/g, ' '));
  }
}

function selectedCategoriesFromArgs(args, config) {
  if (args.category) return [args.category];
  return CATEGORIES.filter((category) => config.categories?.[category]?.enabled !== false);
}

function normalizeCategory(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9+#.\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function slug(value) {
  return normalizeText(value)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'topic';
}

function topicIdFor(category, canonical) {
  return `topic_${category}_${slug(canonical)}`;
}

function titleCase(value) {
  const keepUpper = new Set(['ai', 'roi', 'spf', 'saas', 'it']);
  return String(value || '')
    .split(/\s+/)
    .map((word) => {
      const lower = word.toLowerCase();
      if (keepUpper.has(lower)) return lower.toUpperCase();
      if (lower.includes('-')) {
        return lower.split('-').map((part) => part ? part[0].toUpperCase() + part.slice(1) : part).join('-');
      }
      return lower ? lower[0].toUpperCase() + lower.slice(1) : lower;
    })
    .join(' ');
}

function shortHash(value) {
  return crypto.createHash('sha1').update(String(value)).digest('hex').slice(0, 12);
}

function hostname(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return 'unknown-host';
  }
}

function isoNow() {
  return new Date().toISOString();
}

function hoursAgo(iso, now) {
  const time = new Date(iso).getTime();
  if (!Number.isFinite(time)) return 999999;
  return Math.max(0, (now.getTime() - time) / HOUR_MS);
}

function recencyScore(iso, now) {
  const age = hoursAgo(iso, now);
  return clamp01(1 / (1 + age / 72));
}

function average(values) {
  const valid = values.filter(Number.isFinite);
  if (valid.length === 0) return 0;
  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

function clamp01(value) {
  return clamp(value, 0, 1);
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function round3(value) {
  return Math.round(value * 1000) / 1000;
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

main().catch((error) => {
  console.error('trend-search error: ' + error.message);
  process.exitCode = 1;
});
