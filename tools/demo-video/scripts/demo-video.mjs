#!/usr/bin/env node
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const SCRIPT_FILE = fileURLToPath(import.meta.url);
const TOOL_ROOT = path.resolve(path.dirname(SCRIPT_FILE), "..");
const DEFAULT_OUT_DIR = "demo-video-output";
const DEFAULT_VIEWPORT = { width: 1440, height: 900 };
const TOOL_REQUIRE = createRequire(path.join(TOOL_ROOT, "package.json"));

const DEFAULT_CHAT_MESSAGES = [
  "Xin chao, chatbot co the ho tro gi cho khach hang moi?",
  "Hay tu van mot goi san pham phu hop cho doanh nghiep nho.",
  "Tom tat lai cac loi ich chinh de toi gui cho khach hang.",
];

const BOOLEAN_FLAGS = new Set([
  "burn-subtitles",
  "force",
  "headed",
  "help",
  "pretty",
  "skip-record",
]);

function main() {
  run().catch((error) => {
    console.error(error?.stack || error?.message || String(error));
    process.exit(1);
  });
}

async function run() {
  const { command, options } = parseArgs(process.argv.slice(2));

  if (command === "help" || options.help) {
    printHelp();
    return;
  }

  if (command === "check") {
    await checkCommand(options);
    return;
  }

  if (command === "install-deps") {
    await installDepsCommand(options);
    return;
  }

  if (command === "install-free-tts") {
    await installFreeTtsCommand(options);
    return;
  }

  if (command === "init") {
    await initCommand(options);
    return;
  }

  if (command === "plan") {
    await planCommand(options);
    return;
  }

  if (command === "record") {
    await recordCommand(options);
    return;
  }

  if (command === "voiceover") {
    await voiceoverCommand(options);
    return;
  }

  if (command === "export") {
    await exportCommand(options);
    return;
  }

  if (command === "make") {
    await makeCommand(options);
    return;
  }

  throw new Error(`Unknown command: ${command}\nRun: ${SCRIPT_FILE} --help`);
}

function parseArgs(argv) {
  const command = argv[0] && !argv[0].startsWith("-") ? argv[0] : "help";
  const rest = command === "help" ? argv : argv.slice(1);
  const options = { _: [] };

  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    if (!token.startsWith("--")) {
      options._.push(token);
      continue;
    }

    const eqIndex = token.indexOf("=");
    const rawKey = eqIndex >= 0 ? token.slice(2, eqIndex) : token.slice(2);
    const key = camelCase(rawKey);
    let value = true;

    if (eqIndex >= 0) {
      value = token.slice(eqIndex + 1);
    } else if (!BOOLEAN_FLAGS.has(rawKey) && rest[i + 1] && !rest[i + 1].startsWith("--")) {
      value = rest[i + 1];
      i += 1;
    }

    if (Object.prototype.hasOwnProperty.call(options, key)) {
      if (!Array.isArray(options[key])) options[key] = [options[key]];
      options[key].push(value);
    } else {
      options[key] = value;
    }
  }

  return { command, options };
}

function camelCase(value) {
  return value.replace(/-([a-z])/g, (_, char) => char.toUpperCase());
}

function printHelp() {
  console.log(`
Demo Video

Usage:
  ${SCRIPT_FILE} check [--root /path/to/project]
  ${SCRIPT_FILE} install-deps
  ${SCRIPT_FILE} install-free-tts
  ${SCRIPT_FILE} init [--root /path/to/project] [--out-dir demo-video-output]
  ${SCRIPT_FILE} plan --url <app-url> --goal <goal> [--message "..."] [--out demo-plan.json]
  ${SCRIPT_FILE} record --plan <demo-plan.json> [--headed]
  ${SCRIPT_FILE} voiceover --plan <demo-plan.json> [--provider none|edge|openai|espeak|audio-file]
  ${SCRIPT_FILE} export --recording-manifest <recording.json> [--voiceover-manifest voiceover.json] --out demo.mp4
  ${SCRIPT_FILE} make --url <app-url> --goal <goal> [--message "..."] --out demo.mp4

Core options:
  --root                 Project root. Default: current directory.
  --out-dir              Artifact directory relative to root. Default: ${DEFAULT_OUT_DIR}
  --out                  Output file path for plan/export/make.
  --url                  Browser URL to record.
  --goal                 Demo objective.
  --feature              Feature to mention in the plan. Repeatable.
  --message              Chatbot/customer prompt to send. Repeatable.
  --viewport             Viewport as WIDTHxHEIGHT. Default: ${DEFAULT_VIEWPORT.width}x${DEFAULT_VIEWPORT.height}
  --headed               Show browser while recording. Default: headless recording.
  --provider             Voiceover provider. Default: none.
  --audio-file           Existing narration audio file to merge.
  --burn-subtitles       Burn generated subtitles into the exported MP4.

Examples:
  ${SCRIPT_FILE} install-deps
  ${SCRIPT_FILE} install-free-tts
  ${SCRIPT_FILE} make --url http://127.0.0.1:3000 --goal "Demo chatbot" --message "Tu van san pham" --out demo.mp4
  ${SCRIPT_FILE} voiceover --plan demo-video-output/demo-plan.json --provider edge --voice vi-VN-HoaiMyNeural
  ${SCRIPT_FILE} voiceover --plan demo-video-output/demo-plan.json --provider openai --voice alloy
`);
}

async function checkCommand(options) {
  const root = resolveRoot(options.root);
  const checks = [];
  const ffmpeg = resolveFfmpeg();
  const playwright = await loadPlaywright(root).then(
    () => ({ ok: true, detail: "available" }),
    (error) => ({ ok: false, detail: firstLine(error.message) }),
  );

  checks.push({
    name: "node",
    ok: true,
    detail: process.version,
  });

  checks.push({
    name: "ffmpeg",
    ok: Boolean(ffmpeg),
    detail: ffmpeg ? versionLine(ffmpeg, ["-version"]) : "missing: run demo-video install-deps",
  });

  checks.push({
    name: "playwright",
    ok: playwright.ok,
    detail: playwright.detail,
  });

  const espeak = findExecutable(["espeak-ng", "espeak"]);
  checks.push({
    name: "local TTS",
    ok: Boolean(espeak),
    detail: espeak ? `${espeak} available` : "optional: espeak-ng/espeak not found",
  });

  const edgeTts = resolveEdgeTts();
  checks.push({
    name: "free online TTS",
    ok: Boolean(edgeTts),
    detail: edgeTts ? `${edgeTts} available` : "optional: run demo-video install-free-tts",
  });

  const openaiReady = Boolean(process.env.OPENAI_API_KEY);
  checks.push({
    name: "OpenAI TTS",
    ok: openaiReady,
    detail: openaiReady ? "OPENAI_API_KEY set" : "optional: OPENAI_API_KEY not set",
  });

  const payload = {
    root,
    ok: checks.filter((item) => ["node", "ffmpeg", "playwright"].includes(item.name)).every((item) => item.ok),
    checks,
    installHints: {
      bundled: "demo-video install-deps",
      playwright: "Installs into the demo-video plugin and downloads Chromium.",
      ffmpeg: "Uses bundled ffmpeg-static when demo-video install-deps has completed.",
      freeTts: "demo-video install-free-tts installs edge-tts into the plugin.",
      localTts: "Optional: install espeak-ng for free local voiceover audio.",
    },
  };

  printJson(payload, options.pretty);
}

async function installDepsCommand(options) {
  await ensurePackageJson();
  const npm = findCommand(["npm"]);
  if (!npm) throw new Error("npm is required to install demo-video dependencies.");

  const installArgs = ["install"];
  if (options.noAudit !== false) installArgs.push("--no-audit");
  if (options.noFund !== false) installArgs.push("--no-fund");
  await runProcess(npm, installArgs, { cwd: TOOL_ROOT });

  const npx = findCommand(["npx"]);
  if (!npx) throw new Error("npx is required to install Playwright Chromium.");
  await runProcess(npx, ["playwright", "install", "chromium"], { cwd: TOOL_ROOT });

  printJson({
    ok: true,
    toolRoot: TOOL_ROOT,
    playwright: "installed",
    ffmpeg: resolveFfmpeg() ? "available" : "missing",
  }, options.pretty);
}

async function installFreeTtsCommand(options) {
  const python = findCommand(["python3", "python"]);
  if (!python) throw new Error("python3 is required to install free TTS support.");

  const venvDir = path.join(TOOL_ROOT, ".venv");
  if (!fs.existsSync(path.join(venvDir, "bin", "python"))) {
    await runProcess(python, ["-m", "venv", venvDir], { cwd: TOOL_ROOT });
  }

  const venvPython = path.join(venvDir, "bin", "python");
  await runProcess(venvPython, [
    "-m",
    "pip",
    "install",
    "--timeout",
    "120",
    "--retries",
    "5",
    "edge-tts",
  ], { cwd: TOOL_ROOT });

  printJson({
    ok: true,
    toolRoot: TOOL_ROOT,
    provider: "edge",
    command: resolveEdgeTts(),
    defaultVoice: "vi-VN-HoaiMyNeural",
  }, options.pretty);
}

async function initCommand(options) {
  const root = resolveRoot(options.root);
  const outDir = resolveOutputDir(root, options.outDir);
  await ensureDir(path.join(outDir, "plans"));
  await ensureDir(path.join(outDir, "recording"));
  await ensureDir(path.join(outDir, "voiceover"));
  await ensureDir(path.join(outDir, "exports"));

  const readmePath = path.join(outDir, "README.md");
  if (!fs.existsSync(readmePath) || options.force) {
    await fsp.writeFile(
      readmePath,
      [
        "# Demo Video Artifacts",
        "",
        "Folder nay chua plan, recording, voiceover script/subtitles, va video export.",
        "",
        "- `plans/`: demo plan JSON.",
        "- `recording/`: Playwright browser video va timing manifest.",
        "- `voiceover/`: script, SRT, va optional audio.",
        "- `exports/`: video cuoi.",
        "",
      ].join("\n"),
      "utf8",
    );
  }

  printJson({ ok: true, root, outDir }, options.pretty);
}

async function planCommand(options) {
  const root = resolveRoot(options.root);
  const outDir = resolveOutputDir(root, options.outDir);
  const outPath = resolveMaybeRoot(root, options.out || path.join(outDir, "demo-plan.json"));

  if (!options.url) throw new Error("Missing required option: --url");
  if (!options.goal) throw new Error("Missing required option: --goal");

  const plan = buildPlan({
    root,
    url: String(options.url),
    goal: String(options.goal),
    language: String(options.language || "vi"),
    messages: toStringArray(options.message),
    features: toStringArray(options.feature),
    viewport: parseViewport(options.viewport),
    outDir,
  });

  await writeJsonFile(outPath, plan, { force: options.force });
  printJson({ ok: true, planPath: outPath, steps: plan.steps.length }, options.pretty);
}

async function recordCommand(options) {
  const root = resolveRoot(options.root);
  if (!options.plan) throw new Error("Missing required option: --plan");

  const planPath = resolveMaybeRoot(root, options.plan);
  const plan = await readJsonFile(planPath);
  const outDir = resolveMaybeRoot(root, options.outDir || plan.config?.outputDir || path.join(DEFAULT_OUT_DIR, "recording"));
  const manifest = await recordPlan({ root, plan, planPath, outDir, headed: Boolean(options.headed), pretty: options.pretty });

  printJson({ ok: true, recordingManifest: manifest.manifestPath, videoPath: manifest.videoPath }, options.pretty);
}

async function voiceoverCommand(options) {
  const root = resolveRoot(options.root);
  if (!options.plan) throw new Error("Missing required option: --plan");

  const planPath = resolveMaybeRoot(root, options.plan);
  const plan = await readJsonFile(planPath);
  const recordingManifestPath = options.recordingManifest ? resolveMaybeRoot(root, options.recordingManifest) : null;
  const recordingManifest = recordingManifestPath && fs.existsSync(recordingManifestPath)
    ? await readJsonFile(recordingManifestPath)
    : null;
  if (recordingManifest && !recordingManifest.manifestPath) {
    recordingManifest.manifestPath = recordingManifestPath;
  }
  const outDir = resolveMaybeRoot(root, options.outDir || path.join(DEFAULT_OUT_DIR, "voiceover"));

  const manifest = await buildVoiceover({
    root,
    plan,
    planPath,
    recordingManifest,
    outDir,
    provider: String(options.provider || "none"),
    voice: String(options.voice || plan.narration?.voice || "alloy"),
    model: String(options.model || process.env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts"),
    audioFile: options.audioFile ? resolveMaybeRoot(root, options.audioFile) : null,
  });

  printJson({
    ok: true,
    voiceoverManifest: manifest.manifestPath,
    scriptPath: manifest.scriptPath,
    subtitlesPath: manifest.subtitlesPath,
    audioPath: manifest.audioPath,
  }, options.pretty);
}

async function exportCommand(options) {
  const root = resolveRoot(options.root);
  const result = await exportVideo({
    root,
    recordingManifestPath: options.recordingManifest ? resolveMaybeRoot(root, options.recordingManifest) : null,
    voiceoverManifestPath: options.voiceoverManifest ? resolveMaybeRoot(root, options.voiceoverManifest) : null,
    videoPath: options.video ? resolveMaybeRoot(root, options.video) : null,
    audioFile: options.audioFile ? resolveMaybeRoot(root, options.audioFile) : null,
    subtitlesPath: options.subtitles ? resolveMaybeRoot(root, options.subtitles) : null,
    outPath: resolveMaybeRoot(root, options.out || path.join(DEFAULT_OUT_DIR, "exports", "demo-final.mp4")),
    burnSubtitles: Boolean(options.burnSubtitles),
  });

  printJson({ ok: true, outPath: result.outPath, usedAudio: Boolean(result.audioPath) }, options.pretty);
}

async function makeCommand(options) {
  const root = resolveRoot(options.root);
  if (!options.url) throw new Error("Missing required option: --url");
  if (!options.goal) throw new Error("Missing required option: --goal");

  const outDir = resolveOutputDir(root, options.outDir);
  const runDir = path.join(outDir, "runs", timestampSlug());
  await ensureDir(runDir);

  const plan = buildPlan({
    root,
    url: String(options.url),
    goal: String(options.goal),
    language: String(options.language || "vi"),
    messages: toStringArray(options.message),
    features: toStringArray(options.feature),
    viewport: parseViewport(options.viewport),
    outDir: runDir,
  });

  const planPath = path.join(runDir, "demo-plan.json");
  await writeJsonFile(planPath, plan, { force: true });

  let recording = null;
  if (!options.skipRecord) {
    recording = await recordPlan({
      root,
      plan,
      planPath,
      outDir: path.join(runDir, "recording"),
      headed: Boolean(options.headed),
      pretty: options.pretty,
    });
  }

  const voiceover = await buildVoiceover({
    root,
    plan,
    planPath,
    recordingManifest: recording ? await readJsonFile(recording.manifestPath) : null,
    outDir: path.join(runDir, "voiceover"),
    provider: String(options.provider || "none"),
    voice: String(options.voice || plan.narration?.voice || "alloy"),
    model: String(options.model || process.env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts"),
    audioFile: options.audioFile ? resolveMaybeRoot(root, options.audioFile) : null,
  });

  let exportResult = null;
  if (recording) {
    exportResult = await exportVideo({
      root,
      recordingManifestPath: recording.manifestPath,
      voiceoverManifestPath: voiceover.manifestPath,
      videoPath: null,
      audioFile: options.audioFile ? resolveMaybeRoot(root, options.audioFile) : null,
      subtitlesPath: null,
      outPath: resolveMaybeRoot(root, options.out || path.join(runDir, "exports", "demo-final.mp4")),
      burnSubtitles: Boolean(options.burnSubtitles),
    });
  }

  printJson({
    ok: true,
    runDir,
    planPath,
    recordingManifest: recording?.manifestPath || null,
    voiceoverManifest: voiceover.manifestPath,
    outPath: exportResult?.outPath || null,
  }, options.pretty);
}

function buildPlan({ root, url, goal, language, messages, features, viewport, outDir }) {
  const normalizedMessages = messages.length > 0 ? messages : DEFAULT_CHAT_MESSAGES;
  const normalizedFeatures = features.length > 0
    ? features
    : [
      "Tra loi cau hoi cua khach hang theo ngu canh san pham.",
      "Tu van va tom tat loi ich theo cach de gui cho khach hang.",
    ];

  const steps = [
    {
      id: "open-product",
      action: "goto",
      url,
      waitUntil: "domcontentloaded",
      durationHintSec: 4,
      narration: `Mo san pham va dat boi canh cho demo: ${goal}.`,
    },
    {
      id: "orient-ui",
      action: "wait",
      ms: 1500,
      durationHintSec: 2,
      narration: "Gioi thieu nhanh giao dien chinh va khu vuc khach hang se tuong tac.",
    },
  ];

  normalizedFeatures.forEach((feature, index) => {
    steps.push({
      id: `feature-${String(index + 1).padStart(2, "0")}`,
      action: "wait",
      ms: 900,
      durationHintSec: 2,
      narration: `Nhan manh tinh nang: ${feature}`,
    });
  });

  normalizedMessages.forEach((message, index) => {
    steps.push({
      id: `chat-${String(index + 1).padStart(2, "0")}`,
      action: "chat",
      text: message,
      inputSelector: "{{chatInput}}",
      submitSelector: "{{submitButton}}",
      responseSelector: "{{assistantMessage}}",
      waitForResponseMs: 12000,
      settleMs: 1200,
      durationHintSec: 8,
      narration: `Gui cau hoi mau cho chatbot: ${message}`,
    });
  });

  steps.push({
    id: "wrap-up",
    action: "wait",
    ms: 1200,
    durationHintSec: 4,
    narration: "Ket lai demo bang cac gia tri chinh va cach khach hang co the ung dung ngay.",
  });

  return {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    root,
    meta: {
      title: "Browser Product Demo",
      goal,
      language,
    },
    config: {
      url,
      outputDir: outDir,
      viewport,
      defaultTimeoutMs: 15000,
      slowMoMs: 120,
      selectors: {
        chatInput: "textarea, input[type='text'], [contenteditable='true']",
        submitButton: "button[type='submit'], button:has-text('Send'), button:has-text('Gửi'), button:has-text('Gui')",
        assistantMessage: "[data-role='assistant'], [data-testid*='assistant'], .assistant, .message.assistant, .chat-message.assistant",
      },
    },
    narration: {
      language,
      tone: "than thien, ro rang, huong toi khach hang",
      voice: "alloy",
      intro: `Day la video demo ngan ve san pham, tap trung vao muc tieu: ${goal}.`,
      outro: "Cam on anh chi da theo doi. Video nay co the dung de chia se nhanh gia tri san pham voi khach hang.",
    },
    steps,
  };
}

async function recordPlan({ root, plan, planPath, outDir, headed, pretty }) {
  const playwright = await loadPlaywright(root);
  const { chromium } = playwright;
  const viewport = plan.config?.viewport || DEFAULT_VIEWPORT;
  const recordingDir = path.resolve(outDir);
  const rawVideoDir = path.join(recordingDir, "raw");
  const screenshotDir = path.join(recordingDir, "screenshots");
  await ensureDir(rawVideoDir);
  await ensureDir(screenshotDir);

  const browser = await chromium.launch({
    headless: !headed,
    slowMo: Number(plan.config?.slowMoMs || 0),
  });
  const context = await browser.newContext({
    viewport,
    recordVideo: {
      dir: rawVideoDir,
      size: viewport,
    },
  });
  context.setDefaultTimeout(Number(plan.config?.defaultTimeoutMs || 15000));
  const page = await context.newPage();
  const timings = [];
  const screenshots = [];
  const startedAt = new Date().toISOString();

  try {
    for (const step of plan.steps || []) {
      const stepStart = Date.now();
      process.stderr.write(`demo-video: ${step.id || step.action}\n`);
      await runStep(page, step, plan, { screenshotDir, screenshots });
      timings.push({
        stepId: step.id || null,
        action: step.action || null,
        narration: narrationForStep(step),
        startedAtMs: stepStart,
        endedAtMs: Date.now(),
        durationSec: roundSec((Date.now() - stepStart) / 1000),
      });
    }
  } catch (error) {
    const errorShot = path.join(screenshotDir, `error-${Date.now()}.png`);
    await page.screenshot({ path: errorShot, fullPage: true }).catch(() => {});
    throw new Error(`Recording failed: ${error.message}\nScreenshot: ${errorShot}`);
  } finally {
    await page.waitForTimeout(500).catch(() => {});
  }

  const video = page.video();
  await context.close();
  await browser.close();

  if (!video) throw new Error("Playwright did not create a video artifact.");
  const rawVideoPath = await video.path();
  const videoPath = path.join(recordingDir, "demo-recording.webm");
  await fsp.copyFile(rawVideoPath, videoPath);

  const manifestPath = path.join(recordingDir, "recording.json");
  const manifest = {
    schemaVersion: 1,
    manifestPath,
    planPath,
    videoPath,
    startedAt,
    endedAt: new Date().toISOString(),
    viewport,
    headless: !headed,
    timings: normalizeTimings(timings),
    screenshots,
  };

  await writeJsonFile(manifestPath, manifest, { force: true });

  if (pretty) process.stderr.write(`demo-video: recording saved to ${videoPath}\n`);
  return { manifestPath, videoPath };
}

async function runStep(page, step, plan, context) {
  const action = step.action || step.type;
  const selectors = plan.config?.selectors || {};

  if (action === "goto") {
    await page.goto(step.url || plan.config?.url, {
      waitUntil: step.waitUntil || "domcontentloaded",
      timeout: Number(step.timeoutMs || plan.config?.defaultTimeoutMs || 15000),
    });
    if (step.settleMs) await page.waitForTimeout(Number(step.settleMs));
    return;
  }

  if (action === "wait") {
    if (step.selector) {
      await page.locator(resolveSelector(step.selector, selectors)).first().waitFor({
        state: "visible",
        timeout: Number(step.timeoutMs || plan.config?.defaultTimeoutMs || 15000),
      });
    }
    await page.waitForTimeout(Number(step.ms || step.durationMs || 1000));
    return;
  }

  if (action === "click") {
    const locator = page.locator(resolveSelector(step.selector, selectors)).first();
    await locator.waitFor({ state: "visible", timeout: Number(step.timeoutMs || 15000) });
    await locator.click();
    if (step.settleMs) await page.waitForTimeout(Number(step.settleMs));
    return;
  }

  if (action === "fill" || action === "type") {
    const locator = page.locator(resolveSelector(step.selector, selectors)).first();
    await locator.waitFor({ state: "visible", timeout: Number(step.timeoutMs || 15000) });
    if (action === "fill") {
      await locator.fill(String(step.value ?? step.text ?? ""));
    } else {
      await locator.click();
      await page.keyboard.type(String(step.value ?? step.text ?? ""), { delay: Number(step.delayMs || 20) });
    }
    if (step.settleMs) await page.waitForTimeout(Number(step.settleMs));
    return;
  }

  if (action === "press") {
    await page.keyboard.press(String(step.key || "Enter"));
    if (step.settleMs) await page.waitForTimeout(Number(step.settleMs));
    return;
  }

  if (action === "chat") {
    await runChatStep(page, step, selectors, plan);
    return;
  }

  if (action === "screenshot") {
    const fileName = step.fileName || `${step.id || "screenshot"}.png`;
    const outPath = path.join(context.screenshotDir, safeFileName(fileName));
    await page.screenshot({ path: outPath, fullPage: Boolean(step.fullPage) });
    context.screenshots.push(outPath);
    return;
  }

  if (action === "assert-text") {
    await page.getByText(String(step.text), { exact: Boolean(step.exact) }).waitFor({
      timeout: Number(step.timeoutMs || 15000),
    });
    return;
  }

  throw new Error(`Unsupported step action: ${action}`);
}

async function runChatStep(page, step, selectors, plan) {
  const inputSelector = resolveSelector(step.inputSelector || "{{chatInput}}", selectors);
  const submitSelector = resolveSelector(step.submitSelector || "{{submitButton}}", selectors);
  const responseSelector = resolveSelector(step.responseSelector || "{{assistantMessage}}", selectors);
  const timeout = Number(step.timeoutMs || plan.config?.defaultTimeoutMs || 15000);

  const input = page.locator(inputSelector).last();
  await input.waitFor({ state: "visible", timeout });
  await input.fill(String(step.text || step.value || ""));

  let responseCountBefore = 0;
  const responses = responseSelector ? page.locator(responseSelector) : null;
  if (responses) responseCountBefore = await responses.count().catch(() => 0);

  const submit = page.locator(submitSelector).first();
  if (await submit.count().catch(() => 0)) {
    await submit.click();
  } else {
    await input.press("Enter");
  }

  if (responses && Number(step.waitForResponseMs || 0) > 0) {
    await responses.nth(responseCountBefore).waitFor({
      state: "visible",
      timeout: Number(step.waitForResponseMs || 12000),
    }).catch(async () => {
      await page.waitForTimeout(Math.min(Number(step.waitForResponseMs || 12000), 4000));
    });
  }

  await page.waitForTimeout(Number(step.settleMs || 800));
}

async function buildVoiceover({ root, plan, planPath, recordingManifest, outDir, provider, voice, model, audioFile }) {
  await ensureDir(outDir);
  const segments = buildNarrationSegments(plan, recordingManifest);
  const script = segments.map((segment) => segment.text).filter(Boolean).join("\n\n");
  const scriptPath = path.join(outDir, "voiceover-script.txt");
  const subtitlesPath = path.join(outDir, "voiceover.srt");

  await fsp.writeFile(scriptPath, `${script}\n`, "utf8");
  await fsp.writeFile(subtitlesPath, toSrt(segments), "utf8");

  let audioPath = null;
  if (provider === "none") {
    audioPath = null;
  } else if (provider === "audio-file") {
    if (!audioFile) throw new Error("provider audio-file requires --audio-file");
    audioPath = path.join(outDir, path.basename(audioFile));
    await fsp.copyFile(audioFile, audioPath);
  } else if (provider === "openai") {
    audioPath = await createOpenAiSpeech({ text: script, outDir, voice, model });
  } else if (provider === "edge") {
    audioPath = await createEdgeSpeech({ text: script, outDir, voice: voice || "vi-VN-HoaiMyNeural" });
  } else if (provider === "espeak") {
    audioPath = await createEspeakSpeech({ text: script, outDir });
  } else {
    throw new Error(`Unsupported voiceover provider: ${provider}`);
  }

  const manifest = {
    schemaVersion: 1,
    planPath,
    recordingManifestPath: recordingManifest?.manifestPath || null,
    subtitleAlignment: Array.isArray(recordingManifest?.timings) && recordingManifest.timings.length > 0 ? "recording" : "estimated",
    provider,
    voice,
    model: provider === "openai" ? model : null,
    scriptPath,
    subtitlesPath,
    audioPath,
    segments,
    root,
  };

  const manifestPath = path.join(outDir, "voiceover.json");
  manifest.manifestPath = manifestPath;
  await writeJsonFile(manifestPath, manifest, { force: true });
  return { manifestPath, scriptPath, subtitlesPath, audioPath };
}

function buildNarrationSegments(plan, recordingManifest) {
  const recordedTimings = Array.isArray(recordingManifest?.timings) ? recordingManifest.timings : [];
  if (recordedTimings.length > 0) {
    return buildRecordedNarrationSegments(plan, recordedTimings);
  }

  const segments = [];
  let cursor = 0;

  if (plan.narration?.intro) {
    segments.push({
      id: "intro",
      startSec: 0,
      endSec: 3,
      text: plan.narration.intro,
    });
    cursor = 3;
  }

  const timingByStep = new Map((recordingManifest?.timings || []).map((timing) => [timing.stepId, timing]));
  for (const step of plan.steps || []) {
    const text = narrationForStep(step);
    if (!text) continue;
    const timing = timingByStep.get(step.id);
    const duration = Math.max(1.5, Number(timing?.durationSec || step.durationHintSec || 3));
    segments.push({
      id: step.id || `segment-${segments.length + 1}`,
      startSec: roundSec(cursor),
      endSec: roundSec(cursor + duration),
      text,
    });
    cursor += duration;
  }

  if (plan.narration?.outro) {
    segments.push({
      id: "outro",
      startSec: roundSec(cursor),
      endSec: roundSec(cursor + 4),
      text: plan.narration.outro,
    });
  }

  return segments;
}

function buildRecordedNarrationSegments(plan, timings) {
  const timingByStep = new Map(timings.filter((timing) => timing.stepId).map((timing) => [timing.stepId, timing]));
  const segments = [];
  let cursor = 0;

  for (const step of plan.steps || []) {
    const text = narrationForStep(step);
    if (!text) continue;

    const timing = timingByStep.get(step.id);
    if (timing) {
      const startSec = Number(timing.startSec);
      const endSec = Number(timing.endSec);
      if (Number.isFinite(startSec) && Number.isFinite(endSec) && endSec > startSec) {
        segments.push({
          id: step.id || `segment-${segments.length + 1}`,
          startSec: roundSec(startSec),
          endSec: roundSec(endSec),
          text,
          source: "recording",
        });
        cursor = Math.max(cursor, endSec);
        continue;
      }
    }

    const duration = Math.max(1.5, Number(step.durationHintSec || 3));
    segments.push({
      id: step.id || `segment-${segments.length + 1}`,
      startSec: roundSec(cursor),
      endSec: roundSec(cursor + duration),
      text,
      source: "estimated",
    });
    cursor += duration;
  }

  return segments;
}

function narrationForStep(step) {
  return [step.narrationBefore, step.narration, step.narrationAfter]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

async function createOpenAiSpeech({ text, outDir, voice, model }) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is required for provider openai.");
  }

  const response = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      voice,
      input: text,
      format: "mp3",
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`OpenAI TTS failed: HTTP ${response.status} ${body}`);
  }

  const audioPath = path.join(outDir, "voiceover.mp3");
  const bytes = Buffer.from(await response.arrayBuffer());
  await fsp.writeFile(audioPath, bytes);
  return audioPath;
}

async function createEspeakSpeech({ text, outDir }) {
  const executable = findExecutable(["espeak-ng", "espeak"]);
  if (!executable) throw new Error("espeak-ng/espeak is not installed.");

  const inputPath = path.join(outDir, "voiceover-espeak-input.txt");
  const audioPath = path.join(outDir, "voiceover.wav");
  await fsp.writeFile(inputPath, text, "utf8");

  await runProcess(executable, ["-w", audioPath, "-f", inputPath]);
  return audioPath;
}

async function createEdgeSpeech({ text, outDir, voice }) {
  const executable = resolveEdgeTts();
  if (!executable) {
    throw new Error("edge-tts is not installed. Run: demo-video install-free-tts");
  }

  const audioPath = path.join(outDir, "voiceover-edge.mp3");
  await runProcess(executable, [
    "--voice",
    voice || "vi-VN-HoaiMyNeural",
    "--text",
    text,
    "--write-media",
    audioPath,
  ]);
  return audioPath;
}

async function exportVideo({ root, recordingManifestPath, voiceoverManifestPath, videoPath, audioFile, subtitlesPath, outPath, burnSubtitles }) {
  const ffmpeg = resolveFfmpeg();
  if (!ffmpeg) throw new Error("ffmpeg is required to export MP4. Run: demo-video install-deps");

  const recordingManifest = recordingManifestPath ? await readJsonFile(recordingManifestPath) : null;
  const voiceoverManifest = voiceoverManifestPath ? await readJsonFile(voiceoverManifestPath) : null;
  const inputVideo = videoPath || recordingManifest?.videoPath;
  if (!inputVideo) throw new Error("Missing video input. Pass --video or --recording-manifest.");

  const inputAudio = audioFile || voiceoverManifest?.audioPath || null;
  const inputSubtitles = subtitlesPath || voiceoverManifest?.subtitlesPath || null;
  const finalOut = resolveMaybeRoot(root, outPath);
  await ensureDir(path.dirname(finalOut));

  const args = ["-y", "-i", inputVideo];
  if (inputAudio) args.push("-i", inputAudio);
  if (burnSubtitles && inputSubtitles) {
    args.push("-vf", `subtitles=${escapeFfmpegFilterPath(inputSubtitles)}`);
  }

  if (inputAudio) {
    args.push(
      "-map", "0:v:0",
      "-map", "1:a:0",
      "-c:v", "libx264",
      "-c:a", "aac",
      "-shortest",
      "-pix_fmt", "yuv420p",
      "-movflags", "+faststart",
      finalOut,
    );
  } else {
    args.push(
      "-c:v", "libx264",
      "-pix_fmt", "yuv420p",
      "-movflags", "+faststart",
      finalOut,
    );
  }

  await runProcess(ffmpeg, args);
  return { outPath: finalOut, audioPath: inputAudio, subtitlesPath: inputSubtitles };
}

async function loadPlaywright(root) {
  const bases = [
    TOOL_ROOT,
    root,
    process.cwd(),
    path.resolve(TOOL_ROOT, "..", "..", "repo"),
  ];

  const errors = [];
  for (const base of bases) {
    try {
      const require = createRequire(path.join(base, "package.json"));
      return require("playwright");
    } catch (error) {
      errors.push(`${base}: ${error.message}`);
    }
  }

  try {
    return await import("playwright");
  } catch (error) {
    errors.push(error.message);
  }

  throw new Error([
    "Playwright is not available.",
    "Install bundled dependencies with:",
    "  demo-video install-deps",
    "",
    firstLine(errors.join("\n")),
  ].join("\n"));
}

async function ensurePackageJson() {
  const packageJsonPath = path.join(TOOL_ROOT, "package.json");
  if (!fs.existsSync(packageJsonPath)) {
    throw new Error(`Missing package.json in demo-video tool root: ${packageJsonPath}`);
  }
}

function resolveSelector(value, selectors) {
  return String(value || "")
    .replace(/\{\{([^}]+)\}\}/g, (_, key) => selectors[key.trim()] || "")
    .trim();
}

function parseViewport(value) {
  if (!value) return DEFAULT_VIEWPORT;
  const match = String(value).match(/^(\d+)x(\d+)$/i);
  if (!match) throw new Error(`Invalid --viewport "${value}". Expected WIDTHxHEIGHT.`);
  return { width: Number(match[1]), height: Number(match[2]) };
}

function resolveRoot(value) {
  return path.resolve(value ? String(value) : process.cwd());
}

function resolveOutputDir(root, value) {
  return resolveMaybeRoot(root, value || DEFAULT_OUT_DIR);
}

function resolveMaybeRoot(root, value) {
  const raw = String(value);
  return path.isAbsolute(raw) ? raw : path.resolve(root, raw);
}

async function ensureDir(dir) {
  await fsp.mkdir(dir, { recursive: true });
}

async function readJsonFile(file) {
  return JSON.parse(await fsp.readFile(file, "utf8"));
}

async function writeJsonFile(file, payload, { force = false } = {}) {
  if (!force && fs.existsSync(file)) {
    throw new Error(`Refusing to overwrite existing file without --force: ${file}`);
  }
  await ensureDir(path.dirname(file));
  await fsp.writeFile(file, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function printJson(payload, pretty) {
  console.log(JSON.stringify(payload, null, pretty ? 2 : 0));
}

function toStringArray(value) {
  if (value === undefined || value === null || value === true) return [];
  return (Array.isArray(value) ? value : [value]).map((item) => String(item)).filter(Boolean);
}

function timestampSlug() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function safeFileName(value) {
  return String(value).replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "artifact";
}

function roundSec(value) {
  return Math.round(Number(value) * 100) / 100;
}

function normalizeTimings(timings) {
  if (!timings.length) return [];
  const base = timings[0].startedAtMs;
  return timings.map((timing) => ({
    stepId: timing.stepId,
    action: timing.action,
    narration: timing.narration,
    startSec: roundSec((timing.startedAtMs - base) / 1000),
    endSec: roundSec((timing.endedAtMs - base) / 1000),
    durationSec: timing.durationSec,
  }));
}

function toSrt(segments) {
  return segments.map((segment, index) => [
    String(index + 1),
    `${formatSrtTime(segment.startSec)} --> ${formatSrtTime(segment.endSec)}`,
    wrapSubtitle(segment.text),
    "",
  ].join("\n")).join("\n");
}

function formatSrtTime(sec) {
  const totalMs = Math.max(0, Math.round(Number(sec) * 1000));
  const ms = totalMs % 1000;
  const totalSeconds = Math.floor(totalMs / 1000);
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  return `${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)},${String(ms).padStart(3, "0")}`;
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function wrapSubtitle(text) {
  const words = String(text).replace(/\s+/g, " ").trim().split(" ");
  const lines = [];
  let current = "";
  for (const word of words) {
    if (`${current} ${word}`.trim().length > 64) {
      if (current) lines.push(current);
      current = word;
    } else {
      current = `${current} ${word}`.trim();
    }
  }
  if (current) lines.push(current);
  return lines.join("\n");
}

function resolveFfmpeg() {
  try {
    const ffmpegStatic = TOOL_REQUIRE("ffmpeg-static");
    if (ffmpegStatic && fs.existsSync(ffmpegStatic)) return ffmpegStatic;
  } catch {
    // Fall back to system ffmpeg below.
  }
  return findExecutable(["ffmpeg"]);
}

function resolveEdgeTts() {
  const bundled = path.join(TOOL_ROOT, ".venv", "bin", "edge-tts");
  if (fs.existsSync(bundled)) return bundled;
  return findCommand(["edge-tts"]);
}

function findCommand(candidates) {
  for (const candidate of candidates) {
    for (const args of [["--version"], ["-v"], []]) {
      const result = spawnSync(candidate, args, { stdio: "ignore" });
      if (result.status === 0) return candidate;
    }
  }
  return null;
}

function findExecutable(candidates) {
  for (const candidate of candidates) {
    const result = spawnSync(candidate, ["-version"], { stdio: "ignore" });
    if (result.status === 0 || result.status === 1) return candidate;
  }
  return null;
}

function versionLine(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  return firstLine(result.stdout || result.stderr || "available");
}

function firstLine(value) {
  return String(value || "").split(/\r?\n/).find(Boolean) || "";
}

async function runProcess(command, args, options = {}) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: options.cwd || process.cwd(), stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with code ${code}`));
    });
  });
}

function escapeFfmpegFilterPath(file) {
  return path.resolve(file).replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
}

main();
