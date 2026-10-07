#!/usr/bin/env node

import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_CONFIG = path.join(__dirname, 'config.local.json');
const NEWS_SCRIPT = path.join(__dirname, 'ai-news-radar.mjs');
const TELEGRAM_MAX_MESSAGE = 3500;

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  printHelp();
  process.exit(0);
}

const token = process.env.TELEGRAM_BOT_TOKEN;
const allowedChatIds = parseAllowedChatIds(process.env.TELEGRAM_ALLOWED_CHAT_IDS || args.allowedChatIds);
let offset = Number(process.env.TELEGRAM_OFFSET || 0);
let running = false;

if (!token) {
  console.error('Missing TELEGRAM_BOT_TOKEN. Create a bot with @BotFather and export TELEGRAM_BOT_TOKEN first.');
  process.exit(1);
}

console.log('AI News Radar Telegram bot started.');
if (allowedChatIds.size === 0) {
  console.log('TELEGRAM_ALLOWED_CHAT_IDS is not set. The bot will show chat IDs but refuse to run news commands.');
}

while (true) {
  try {
    const updates = await telegram('getUpdates', {
      offset,
      timeout: 30,
      allowed_updates: ['message']
    });

    for (const update of updates.result ?? []) {
      offset = update.update_id + 1;
      await handleUpdate(update);
    }
  } catch (error) {
    console.error(`Telegram polling error: ${error.message}`);
    await sleep(3000);
  }
}

function parseArgs(argv) {
  const parsed = {
    config: process.env.AI_NEWS_RADAR_CONFIG || DEFAULT_CONFIG,
    allowedChatIds: ''
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      index += 1;
      if (index >= argv.length) throw new Error(`${arg} needs a value.`);
      return argv[index];
    };

    if (arg === '--config') parsed.config = path.resolve(next());
    else if (arg === '--allowed-chat-ids') parsed.allowedChatIds = next();
    else if (arg === '--help' || arg === '-h') parsed.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }

  return parsed;
}

function printHelp() {
  console.log(`AI News Radar Telegram Bot

Usage:
  TELEGRAM_BOT_TOKEN=... node telegram-bot.mjs --config config.local.json

Options:
  --config <file>              AI News Radar config file. Defaults to config.local.json.
  --allowed-chat-ids <ids>     Comma-separated Telegram chat IDs allowed to run commands.
  --help                       Show this help.

Commands in Telegram:
  tin tức
  tin tuc
  /news
  tin tức 48
  tin tức 48 gửi lại
`);
}

function parseAllowedChatIds(value) {
  return new Set(
    String(value || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
  );
}

async function handleUpdate(update) {
  const message = update.message;
  if (!message?.chat?.id) return;

  const chatId = String(message.chat.id);
  const text = String(message.text || '').trim();
  if (!text) return;

  if (isStartCommand(text)) {
    await sendMessage(chatId, [
      'AI News Radar bot.',
      `Chat ID cua ban: ${chatId}`,
      '',
      'Lenh:',
      '- tin tuc',
      '- tin tức',
      '- /news',
      '- tin tức 48',
      '',
      allowedChatIds.size === 0
        ? 'Bot chua duoc cap quyen chay lenh. Hay set TELEGRAM_ALLOWED_CHAT_IDS bang chat ID tren.'
        : 'Bot da san sang neu chat ID nay nam trong TELEGRAM_ALLOWED_CHAT_IDS.'
    ].join('\n'));
    return;
  }

  const command = parseNewsCommand(text);
  if (!command) {
    await sendMessage(chatId, 'Gui "tin tức" hoac /news de chay AI News Radar va gui email.');
    return;
  }

  if (!isAllowed(chatId)) {
    await sendMessage(chatId, [
      'Chat nay chua duoc phep chay lenh.',
      `Chat ID: ${chatId}`,
      'Set TELEGRAM_ALLOWED_CHAT_IDS=<chat id> roi restart bot.'
    ].join('\n'));
    return;
  }

  if (running) {
    await sendMessage(chatId, 'Dang co mot lan cap nhat tin tuc dang chay. Doi no xong roi goi lai nhe.');
    return;
  }

  running = true;
  await sendMessage(chatId, `Dang cap nhat tin tuc ${command.hours}h va gui email...`);

  try {
    const result = await runNewsRadar(command.hours, command.ignoreState);
    const status = result.code === 0 ? 'Xong.' : 'Lenh bi loi.';
    await sendLongMessage(chatId, `${status}\n\n${summarizeCommandOutput(result)}`);
  } finally {
    running = false;
  }
}

function isStartCommand(text) {
  return /^\/start\b/i.test(text) || /^\/id\b/i.test(text);
}

function parseNewsCommand(text) {
  const normalized = stripVietnameseMarks(text).toLowerCase();
  const isNews =
    normalized === 'tin tuc' ||
    normalized.startsWith('tin tuc ') ||
    normalized.startsWith('/news') ||
    normalized.startsWith('/tintuc');

  if (!isNews) return null;

  const hoursMatch = normalized.match(/\b(\d{1,4})\b/);
  const hours = hoursMatch ? Number(hoursMatch[1]) : Number(process.env.TELEGRAM_NEWS_HOURS || 24);
  const ignoreState = /\b(gui lai|resend|ignore state|ignore-state|all)\b/.test(normalized);
  return {
    hours: Number.isFinite(hours) && hours > 0 ? hours : 24,
    ignoreState
  };
}

function stripVietnameseMarks(value) {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D');
}

function isAllowed(chatId) {
  return allowedChatIds.has(chatId);
}

function runNewsRadar(hours, ignoreState) {
  const childArgs = [NEWS_SCRIPT, '--config', args.config, '--hours', String(hours)];
  if (ignoreState) childArgs.push('--ignore-state');

  return new Promise((resolve) => {
    const child = spawn(process.execPath, childArgs, {
      cwd: __dirname,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('close', (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

function summarizeCommandOutput(result) {
  const combined = [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join('\n\n');
  if (!combined) return `Exit code: ${result.code}`;
  const lines = combined.split(/\r?\n/);
  const important = lines.filter((line) =>
    /^(Found|Skipped|Selected|Mode:|Email sent|No new|SMTP|Error:|Warnings|Use --ignore-state)/i.test(line)
  );
  const summary = important.length > 0 ? important.join('\n') : lines.slice(-16).join('\n');
  return trimForTelegram(summary);
}

function trimForTelegram(value) {
  const text = String(value);
  if (text.length <= TELEGRAM_MAX_MESSAGE) return text;
  return `${text.slice(0, TELEGRAM_MAX_MESSAGE - 80)}\n...\n(output da rut gon)`;
}

async function sendLongMessage(chatId, text) {
  const chunks = [];
  let remaining = String(text);
  while (remaining.length > TELEGRAM_MAX_MESSAGE) {
    chunks.push(remaining.slice(0, TELEGRAM_MAX_MESSAGE));
    remaining = remaining.slice(TELEGRAM_MAX_MESSAGE);
  }
  chunks.push(remaining);

  for (const chunk of chunks) {
    await sendMessage(chatId, chunk);
  }
}

async function sendMessage(chatId, text) {
  await telegram('sendMessage', {
    chat_id: chatId,
    text,
    disable_web_page_preview: true
  });
}

async function telegram(method, payload) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(45000)
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.ok === false) {
    throw new Error(body.description || `${method} failed with ${response.status}`);
  }
  return body;
}
