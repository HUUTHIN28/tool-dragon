#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const DEFAULT_OUT = "video-product";
const DEFAULT_LANGUAGE = "vi";
const SCHEMA_VERSION = "0.1.0";
const MAX_CONTEXT_CHARS = 120_000;
const SCRIPT_FILE = fileURLToPath(import.meta.url);
const TOOL_ROOT = path.resolve(path.dirname(SCRIPT_FILE));
const TOOL_REQUIRE = createRequire(path.join(TOOL_ROOT, "package.json"));
const VENV_DIR = path.join(TOOL_ROOT, ".venv");
const VENV_BIN_DIR = path.join(VENV_DIR, process.platform === "win32" ? "Scripts" : "bin");
const MODEL_CACHE_DIR = path.join(TOOL_ROOT, "models");
const REQUIRED_SPEC_FIELDS = [
  ["videoUnderstanding.summary", (bundle) => text(bundle.videoUnderstanding?.summary)],
  ["productSpec.name", (bundle) => text(bundle.productSpec?.name)],
  ["productSpec.coreFeatures", (bundle) => nonEmptyArray(bundle.productSpec?.coreFeatures)],
  ["buildPlan.stack", (bundle) => nonEmptyArray(bundle.buildPlan?.stack)],
  ["buildPlan.filePlan", (bundle) => nonEmptyArray(bundle.buildPlan?.filePlan)],
  ["buildPlan.implementationSteps", (bundle) => nonEmptyArray(bundle.buildPlan?.implementationSteps)],
  ["buildPlan.verificationSteps", (bundle) => nonEmptyArray(bundle.buildPlan?.verificationSteps)],
];

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
      printHelp();
      return;
    }

    if (args.command === "check") {
      checkCommand(args);
    } else if (args.command === "install-deps") {
      installDepsCommand(args);
    } else if (args.command === "ensure-deps") {
      ensureDepsCommand(args);
    } else if (args.command === "init") {
      initCommand(args);
    } else if (args.command === "context-bundle") {
      contextBundleCommand(args);
    } else if (args.command === "validate-bundle") {
      validateBundleCommand(args);
    } else if (args.command === "build-prompt") {
      buildPromptCommand(args);
    } else if (args.command === "report-bundle") {
      reportBundleCommand(args);
    } else {
      throw new Error(`Unknown command: ${args.command}`);
    }
  } catch (error) {
    console.error(error?.stack || error?.message || String(error));
    process.exit(1);
  }
}

function printHelp() {
  console.log(`
Video To Product Tool

Usage:
  video-to-product.mjs check
  video-to-product.mjs install-deps [--skip-transcription]
  video-to-product.mjs ensure-deps
  video-to-product.mjs init [--root /path/to/project] [--video URL_OR_FILE] [--transcript file] [--subtitle file]
  video-to-product.mjs context-bundle --bundle video-product/product-spec.vi.json [--fetch-subtitles] [--transcribe]
  video-to-product.mjs validate-bundle --bundle video-product/product-spec.vi.json [--pretty]
  video-to-product.mjs build-prompt --bundle video-product/product-spec.vi.json
  video-to-product.mjs report-bundle --bundle video-product/product-spec.vi.json

Init options:
  --root             Target project root. Default: current directory
  --out              Output folder relative to root. Default: ${DEFAULT_OUT}
  --video            Video URL or local video path
  --transcript       Transcript text/SRT/VTT file
  --subtitle         Subtitle text/SRT/VTT file
  --notes            Extra notes file from the user
  --language         Output language. Default: ${DEFAULT_LANGUAGE}
  --target-stack     Optional technology stack hint
  --product-goal     Optional description of what should be built
  --product-name     Optional desired product name

Context options:
  --fetch-subtitles  Try yt-dlp subtitle extraction for video URLs
  --transcribe       If no text context exists, transcribe video/audio with local faster-whisper
  --no-auto-install  Do not install local deps automatically when --fetch-subtitles needs yt-dlp
  --model            faster-whisper model for --transcribe. Default: base
  --max-chars        Max context chars printed. Default: ${MAX_CONTEXT_CHARS}
  --pretty           Pretty-print JSON where applicable

Install options:
  --skip-transcription  Skip faster-whisper install. Default install includes transcription.
`);
}

function parseArgs(argv) {
  const command = argv[0] && !argv[0].startsWith("--") ? argv[0] : "init";
  const start = command === argv[0] ? 1 : 0;
  const args = {
    command,
    root: process.cwd(),
    out: DEFAULT_OUT,
    language: DEFAULT_LANGUAGE,
    video: "",
    transcript: "",
    subtitle: "",
    notes: "",
    targetStack: "",
    productGoal: "",
    productName: "",
    bundle: "",
    fetchSubtitles: false,
    transcribe: false,
    autoInstall: true,
    withTranscription: true,
    transcriptionModel: "base",
    skipNode: false,
    skipPython: false,
    pretty: false,
    maxChars: MAX_CONTEXT_CHARS,
  };

  for (let i = start; i < argv.length; i += 1) {
    const item = argv[i];
    if (item === "--help" || item === "-h") {
      args.help = true;
    } else if (item === "--root") {
      args.root = path.resolve(argv[++i]);
    } else if (item === "--out") {
      args.out = argv[++i] || args.out;
    } else if (item === "--video" || item === "--url") {
      args.video = argv[++i] || "";
    } else if (item === "--transcript") {
      args.transcript = argv[++i] || "";
    } else if (item === "--subtitle" || item === "--subtitles") {
      args.subtitle = argv[++i] || "";
    } else if (item === "--notes") {
      args.notes = argv[++i] || "";
    } else if (item === "--language" || item === "--lang") {
      args.language = argv[++i] || args.language;
    } else if (item === "--target-stack" || item === "--stack") {
      args.targetStack = argv[++i] || "";
    } else if (item === "--product-goal" || item === "--goal") {
      args.productGoal = argv[++i] || "";
    } else if (item === "--product-name" || item === "--name") {
      args.productName = argv[++i] || "";
    } else if (item === "--bundle") {
      args.bundle = argv[++i] || "";
    } else if (item === "--fetch-subtitles") {
      args.fetchSubtitles = true;
    } else if (item === "--transcribe") {
      args.transcribe = true;
    } else if (item === "--no-auto-install") {
      args.autoInstall = false;
    } else if (item === "--model" || item === "--transcription-model") {
      args.transcriptionModel = argv[++i] || args.transcriptionModel;
    } else if (item === "--with-transcription") {
      args.withTranscription = true;
    } else if (item === "--skip-transcription" || item === "--no-transcription") {
      args.withTranscription = false;
    } else if (item === "--skip-node") {
      args.skipNode = true;
    } else if (item === "--skip-python") {
      args.skipPython = true;
    } else if (item === "--pretty") {
      args.pretty = true;
    } else if (item === "--max-chars") {
      args.maxChars = Number(argv[++i] || args.maxChars);
    } else if (item.startsWith("--")) {
      throw new Error("Unknown option: " + item);
    } else if (!args.video) {
      args.video = item;
    } else {
      throw new Error("Unexpected positional argument: " + item);
    }
  }

  args.root = path.resolve(args.root);
  if (!Number.isFinite(args.maxChars) || args.maxChars < 1000) {
    throw new Error("--max-chars must be a number >= 1000");
  }
  return args;
}

function checkCommand(args) {
  const checks = [
    { name: "node", ok: true, detail: process.version },
    checkResolver("yt-dlp", resolveYtDlp(), "run install-deps to install local yt-dlp"),
    checkResolver("ffmpeg", resolveFfmpeg(), "run install-deps to install local ffmpeg-static"),
    checkResolver("tesseract.js", resolveNodePackage("tesseract.js"), "run install-deps to install local OCR package"),
    checkResolver("faster-whisper", resolvePythonModule("faster_whisper"), "run install-deps to install local transcription"),
    checkResolver("faster-whisper-model", resolveWhisperModel("base"), "run install-deps to download local base model"),
  ];

  const payload = {
    ok: checks.filter((item) => ["node", "yt-dlp", "ffmpeg"].includes(item.name)).every((item) => item.ok),
    toolRoot: TOOL_ROOT,
    checks,
    notes: [
      "Base video URL workflow uses local yt-dlp and ffmpeg-static after install-deps.",
      "For videos without subtitles, local faster-whisper transcription is installed by install-deps.",
      "OCR support is installed as tesseract.js for later frame/code extraction workflows.",
    ],
  };
  printJson(payload, args.pretty);
}

function installDepsCommand(args) {
  const results = [];

  if (!args.skipNode) {
    const npm = findExecutable(["npm"]);
    if (!npm) throw new Error("npm is required to install tool Node dependencies.");
    results.push(runProcess(npm, ["install", "--no-audit", "--no-fund"], { cwd: TOOL_ROOT, label: "npm install" }));
  }

  if (!args.skipPython) {
    const python = findExecutable(["python3", "python"]);
    if (!python) throw new Error("python3 is required to install tool Python dependencies.");
    if (!fs.existsSync(path.join(VENV_BIN_DIR, process.platform === "win32" ? "python.exe" : "python"))) {
      results.push(runProcess(python, ["-m", "venv", VENV_DIR], { cwd: TOOL_ROOT, label: "python venv" }));
    }
    const venvPython = resolveVenvPython();
    results.push(runProcess(venvPython, ["-m", "pip", "install", "--upgrade", "pip"], { cwd: TOOL_ROOT, label: "pip upgrade" }));
    const packages = ["yt-dlp"];
    if (args.withTranscription !== false) packages.push("faster-whisper");
    results.push(runProcess(venvPython, ["-m", "pip", "install", ...packages], { cwd: TOOL_ROOT, label: "pip install" }));
    if (args.withTranscription !== false) {
      safeMkdir(MODEL_CACHE_DIR);
      const modelName = args.transcriptionModel || "base";
      const modelDir = path.join(MODEL_CACHE_DIR, modelName);
      const downloadScript = [
        "import sys",
        "from faster_whisper import download_model",
        "download_model(sys.argv[1], output_dir=sys.argv[2])",
        "print(sys.argv[2])",
      ].join("; ");
      results.push(runProcess(venvPython, ["-c", downloadScript, modelName, modelDir], {
        cwd: TOOL_ROOT,
        label: `download faster-whisper model ${modelName}`,
      }));
    }
  }

  const payload = {
    ok: true,
    toolRoot: TOOL_ROOT,
    installed: results.map((item) => item.label),
    checks: dependencyChecks(),
  };
  printJson(payload, args.pretty);
}

function ensureDepsCommand(args) {
  const checks = dependencyChecks();
  const requiredMissing = checks.filter((item) => ["yt-dlp", "ffmpeg", "tesseract.js", "faster-whisper", "faster-whisper-model"].includes(item.name) && !item.ok);
  if (requiredMissing.length > 0) {
    installDepsCommand(args);
    return;
  }
  printJson({ ok: true, toolRoot: TOOL_ROOT, checks }, args.pretty);
}

function initCommand(args) {
  if (!fs.existsSync(args.root) || !fs.statSync(args.root).isDirectory()) {
    throw new Error("Target project root does not exist: " + args.root);
  }

  const outDir = path.resolve(args.root, args.out);
  const bundlePath = path.join(outDir, `product-spec.${args.language}.json`);
  const mdPath = path.join(outDir, `product-spec.${args.language}.md`);
  const runnerPath = path.join(outDir, `codex-runner.${args.language}.md`);
  const sourceInputs = collectSourceInputs(args);
  const shouldFetchSubtitles = /^https?:\/\//i.test(args.video) && !args.transcript && !args.subtitle;
  const shouldTranscribe = Boolean(args.video) && !args.transcript && !args.subtitle;
  const now = new Date().toISOString();

  const bundle = {
    schemaVersion: SCHEMA_VERSION,
    kind: "video-to-product",
    createdAt: now,
    updatedAt: now,
    language: args.language,
    config: {
      root: normalize(args.root),
      out: args.out,
      productGoal: args.productGoal,
      targetStack: args.targetStack,
      source: {
        video: args.video,
        transcript: args.transcript,
        subtitle: args.subtitle,
        notes: args.notes,
      },
    },
    commands: {
      ensureDeps: `${scriptPath()} ensure-deps`,
      contextBundle: `${scriptPath()} context-bundle --bundle ${normalize(path.relative(args.root, bundlePath))}${shouldFetchSubtitles ? " --fetch-subtitles" : ""}${shouldTranscribe ? " --transcribe" : ""}`,
      validateBundle: `${scriptPath()} validate-bundle --bundle ${normalize(path.relative(args.root, bundlePath))} --pretty`,
      buildPrompt: `${scriptPath()} build-prompt --bundle ${normalize(path.relative(args.root, bundlePath))}`,
    },
    sourceInputs,
    videoUnderstanding: {
      summary: "",
      productType: "",
      userProblem: "",
      coreDemoFlow: [],
      technologySignals: splitList(args.targetStack),
      visibleFiles: [],
      visibleCodeNotes: [],
      assumptions: [],
      unknowns: [],
    },
    productSpec: {
      kind: "",
      name: args.productName,
      elevatorPitch: "",
      targetUsers: [],
      coreFeatures: [],
      userFlows: [],
      screens: [],
      dataModel: [],
      apiRoutes: [],
      integrations: [],
      nonGoals: [],
    },
    agentWorkflow: {
      platform: "",
      channels: [],
      triggers: [],
      nodes: [],
      llm: {
        provider: "",
        model: "",
        systemPrompt: "",
        tools: [],
      },
      memory: {
        type: "",
        storage: "",
        retentionPolicy: "",
      },
      integrations: [],
      credentialsNeeded: [],
      workflowArtifacts: [],
      testScenarios: [],
      deployment: [],
    },
    buildPlan: {
      stack: splitList(args.targetStack),
      dependencies: [],
      deliverables: [],
      filePlan: [],
      implementationSteps: [],
      verificationSteps: [],
      risks: [],
    },
    implementation: {
      targetRoot: normalize(args.root),
      status: "not_started",
      createdFiles: [],
      changedFiles: [],
      runCommands: [],
      devServerUrl: "",
      verificationNotes: [],
    },
    validation: emptyValidation(),
  };

  safeMkdir(outDir);
  writeJson(bundlePath, bundle, true);
  writeText(runnerPath, renderRunner(bundle));
  writeText(mdPath, renderMarkdown(bundle));

  printJson({
    ok: true,
    bundle: normalize(bundlePath),
    markdown: normalize(mdPath),
    runner: normalize(runnerPath),
    next: [
      `Read ${normalize(runnerPath)}`,
      `Run: ${bundle.commands.contextBundle}`,
      "Fill videoUnderstanding, productSpec, and buildPlan",
      `Run: ${bundle.commands.validateBundle}`,
      "Implement the product in the target project",
    ],
  }, args.pretty);
}

function contextBundleCommand(args) {
  const bundlePath = resolveBundle(args);
  const bundle = readJson(bundlePath, "bundle");
  const root = path.resolve(bundle.config?.root || path.dirname(bundlePath));
  const source = bundle.config?.source || {};
  const sections = [];

  sections.push(`# Video To Product Context`);
  sections.push(`Bundle: ${normalize(bundlePath)}`);
  sections.push(`Target root: ${normalize(root)}`);
  if (bundle.config?.productGoal) sections.push(`Product goal: ${bundle.config.productGoal}`);
  if (bundle.config?.targetStack) sections.push(`Target stack hint: ${bundle.config.targetStack}`);
  if (source.video) sections.push(`Video: ${source.video}`);

  const transcriptText = readOptionalContextFile(root, source.transcript);
  const subtitleText = readOptionalContextFile(root, source.subtitle);
  const notesText = readOptionalContextFile(root, source.notes);
  const fetchedSubtitle = args.fetchSubtitles ? fetchSubtitles(source.video, bundle.language || DEFAULT_LANGUAGE, { autoInstall: args.autoInstall }) : null;
  const shouldRunTranscription = args.transcribe && !notesText && !transcriptText && !subtitleText && !fetchedSubtitle?.text;
  const autoTranscript = shouldRunTranscription
    ? transcribeVideo(source.video, bundle.language || DEFAULT_LANGUAGE, {
      autoInstall: args.autoInstall,
      model: args.transcriptionModel,
      root,
    })
    : null;

  if (notesText) {
    sections.push(`\n## User Notes\n\n${truncateText(notesText, args.maxChars)}`);
  }
  if (transcriptText) {
    sections.push(`\n## Transcript\n\n${cleanTranscript(transcriptText)}`);
  }
  if (subtitleText) {
    sections.push(`\n## Subtitle\n\n${cleanTranscript(subtitleText)}`);
  }
  if (fetchedSubtitle?.text) {
    sections.push(`\n## Fetched Subtitle\n\n${cleanTranscript(fetchedSubtitle.text)}`);
  }
  if (fetchedSubtitle?.error) {
    sections.push(`\n## Subtitle Fetch Error\n\n${fetchedSubtitle.error}`);
  }
  if (autoTranscript?.text) {
    sections.push(`\n## Auto Transcript\n\n${cleanTranscript(autoTranscript.text)}`);
  }
  if (autoTranscript?.error) {
    sections.push(`\n## Transcription Error\n\n${autoTranscript.error}`);
  }

  if (!notesText && !transcriptText && !subtitleText && !fetchedSubtitle?.text && !autoTranscript?.text) {
    sections.push(`\n## Missing Context\n\nNo transcript, subtitle, notes, or fetched subtitle was available.`);
    sections.push(renderExtractionHints(bundle));
  }

  sections.push(`\n## Codex Task\n\nUse the context above to fill product-spec JSON fields: videoUnderstanding, productSpec, agentWorkflow when relevant, and buildPlan. If this output contains no transcript, subtitle, auto transcript, or user notes, do not browse YouTube or linked websites as a substitute source of truth. Ask the user for a transcript/video file, or proceed only with clearly marked assumptions. Then run validate-bundle and implement the product if the user asked for a working result.`);

  const output = truncateText(sections.join("\n"), args.maxChars);
  process.stdout.write(output.endsWith("\n") ? output : output + "\n");
}

function validateBundleCommand(args) {
  const bundlePath = resolveBundle(args);
  const bundle = readJson(bundlePath, "bundle");
  const validation = validateBundle(bundle);
  bundle.validation = validation;
  bundle.updatedAt = new Date().toISOString();
  writeJson(bundlePath, bundle, true);
  writeText(markdownPathForBundle(bundlePath, bundle), renderMarkdown(bundle));
  printJson(validation, args.pretty);
}

function buildPromptCommand(args) {
  const bundlePath = resolveBundle(args);
  const bundle = readJson(bundlePath, "bundle");
  const validation = validateBundle(bundle);
  const prompt = renderBuildPrompt(bundle, validation);
  process.stdout.write(prompt.endsWith("\n") ? prompt : prompt + "\n");
}

function reportBundleCommand(args) {
  const bundlePath = resolveBundle(args);
  const bundle = readJson(bundlePath, "bundle");
  const mdPath = markdownPathForBundle(bundlePath, bundle);
  writeText(mdPath, renderMarkdown(bundle));
  printJson({ ok: true, report: normalize(mdPath) }, args.pretty);
}

function collectSourceInputs(args) {
  const inputs = [];
  for (const [kind, rawValue] of [
    ["video", args.video],
    ["transcript", args.transcript],
    ["subtitle", args.subtitle],
    ["notes", args.notes],
  ]) {
    if (!rawValue) continue;
    const isUrl = /^https?:\/\//i.test(rawValue);
    const full = isUrl ? rawValue : path.resolve(args.root, rawValue);
    inputs.push({
      kind,
      value: rawValue,
      resolved: normalize(String(full)),
      exists: isUrl ? null : fs.existsSync(full),
      bytes: !isUrl && fs.existsSync(full) && fs.statSync(full).isFile() ? fs.statSync(full).size : null,
    });
  }
  return inputs;
}

function validateBundle(bundle) {
  const errors = [];
  const warnings = [];

  if (bundle.schemaVersion !== SCHEMA_VERSION) {
    warnings.push(`schemaVersion is ${bundle.schemaVersion || "missing"}, expected ${SCHEMA_VERSION}`);
  }
  for (const [field, check] of REQUIRED_SPEC_FIELDS) {
    if (!check(bundle)) errors.push(`Missing required field: ${field}`);
  }
  const hasUiSurface = nonEmptyArray(bundle.productSpec?.screens);
  const hasAgentWorkflow = nonEmptyArray(bundle.agentWorkflow?.nodes) || nonEmptyArray(bundle.agentWorkflow?.triggers);
  if (!hasUiSurface && !hasAgentWorkflow) {
    errors.push("Missing build surface: provide productSpec.screens for an app/UI or agentWorkflow.nodes/triggers for an AI agent/workflow.");
  }
  if (hasAgentWorkflow && !text(bundle.agentWorkflow?.platform)) {
    warnings.push("agentWorkflow.platform is empty; set it to n8n, LangGraph, CrewAI, custom Node/Python agent, or another target runtime.");
  }
  if (!nonEmptyArray(bundle.videoUnderstanding?.assumptions)) {
    warnings.push("videoUnderstanding.assumptions is empty; add assumptions if the video evidence is incomplete.");
  }
  if (!nonEmptyArray(bundle.videoUnderstanding?.unknowns)) {
    warnings.push("videoUnderstanding.unknowns is empty; add unknowns if the video does not reveal implementation details.");
  }
  if (!text(bundle.implementation?.status) || bundle.implementation.status === "not_started") {
    warnings.push("implementation.status is not completed yet.");
  }

  const metrics = {
    featureCount: arrayLength(bundle.productSpec?.coreFeatures),
    screenCount: arrayLength(bundle.productSpec?.screens),
    userFlowCount: arrayLength(bundle.productSpec?.userFlows),
    dataModelCount: arrayLength(bundle.productSpec?.dataModel),
    apiRouteCount: arrayLength(bundle.productSpec?.apiRoutes),
    agentNodeCount: arrayLength(bundle.agentWorkflow?.nodes),
    agentTriggerCount: arrayLength(bundle.agentWorkflow?.triggers),
    workflowArtifactCount: arrayLength(bundle.agentWorkflow?.workflowArtifacts),
    filePlanCount: arrayLength(bundle.buildPlan?.filePlan),
    deliverableCount: arrayLength(bundle.buildPlan?.deliverables),
    implementationStepCount: arrayLength(bundle.buildPlan?.implementationSteps),
    verificationStepCount: arrayLength(bundle.buildPlan?.verificationSteps),
    changedFileCount: arrayLength(bundle.implementation?.changedFiles) + arrayLength(bundle.implementation?.createdFiles),
  };

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    metrics,
    checkedAt: new Date().toISOString(),
  };
}

function renderRunner(bundle) {
  const language = bundle.language || DEFAULT_LANGUAGE;
  const bundleRel = `video-product/product-spec.${language}.json`;
  return `# Video To Product Runner

Use this runner to turn the video context into a buildable product spec, then implement the product.

## Commands

\`\`\`bash
${bundle.commands.ensureDeps}
${bundle.commands.contextBundle}
${bundle.commands.validateBundle}
${bundle.commands.buildPrompt}
\`\`\`

## Source Boundary

Use the CLI output as the source of truth. Do not replace this workflow with Chrome DevTools, YouTube page scraping, linked website browsing, or the demo-video tool. If \`context-bundle\` cannot extract transcript/subtitles/audio and returns only errors or missing context, stop and ask the user for transcript/video context, or continue only with explicit assumptions in \`videoUnderstanding.assumptions\`.

## Pass 1: Video Understanding

Read the output of \`context-bundle\`. Fill \`videoUnderstanding\`:

- \`summary\`: concise explanation of what the video builds or demonstrates
- \`productType\`: app/tool/category
- \`userProblem\`: the user problem being solved
- \`coreDemoFlow\`: chronological demo/build flow
- \`technologySignals\`: frameworks, libraries, services, database, auth, APIs
- \`visibleFiles\`: file names or modules clearly shown
- \`visibleCodeNotes\`: short observations about code structure, not unverifiable full code
- \`assumptions\`: implementation assumptions Codex must make
- \`unknowns\`: details the video does not reveal

## Pass 2: Product Spec

Fill \`productSpec\`:

- \`kind\`: one of \`web_app\`, \`mobile_app\`, \`ai_agent_workflow\`, \`automation\`, \`cli_tool\`, \`library\`, or another concise kind
- \`name\`
- \`elevatorPitch\`
- \`targetUsers\`
- \`coreFeatures\`
- \`userFlows\`
- \`screens\`
- \`dataModel\`
- \`apiRoutes\`
- \`integrations\`
- \`nonGoals\`

If the video shows an AI agent or automation workflow such as n8n, Messenger chatbot, Telegram bot, CRM/Sheets agent, voice agent, LangGraph/CrewAI agent, or a webhook automation, fill \`agentWorkflow\`:

- \`platform\`: e.g. n8n, LangGraph, CrewAI, custom Node agent, custom Python agent
- \`channels\`: Messenger, Telegram, WhatsApp, Zalo, web chat, email, API webhook
- \`triggers\`: webhook/message/schedule/manual events
- \`nodes\`: workflow nodes or agent steps, including inputs, outputs, and routing
- \`llm\`: provider/model/system prompt/tools
- \`memory\`: storage and retention
- \`integrations\`: external services such as Facebook Graph API, Google Sheets, Postgres, CRM, vector DB
- \`credentialsNeeded\`: required secrets and where they are used
- \`workflowArtifacts\`: files to create, e.g. \`n8n-workflow.json\`, \`docker-compose.yml\`, \`webhook-handler.ts\`, \`.env.example\`
- \`testScenarios\`: messages/events to verify the agent behavior
- \`deployment\`: how to run/import/deploy the workflow

Use arrays of objects when detail helps. Example screen item:

\`\`\`json
{
  "name": "Chat",
  "purpose": "Send and receive realtime messages",
  "elements": ["room list", "message feed", "composer"],
  "states": ["empty", "loading", "message sent", "error"]
}
\`\`\`

## Pass 3: Build Plan

Fill \`buildPlan\`:

- \`stack\`
- \`dependencies\`
- \`deliverables\`: concrete artifacts to create, including workflow JSON, source code, docs, env examples, schemas, tests
- \`filePlan\`
- \`implementationSteps\`
- \`verificationSteps\`
- \`risks\`

Then run:

\`\`\`bash
${bundle.commands.validateBundle}
\`\`\`

## Build

After validation passes, implement the product in the target project. If it is an AI agent/workflow, produce importable workflow files and supporting code/docs needed to run it. Do not stop at the spec if the user asked for a working product. After coding, update \`${bundleRel}\` field \`implementation\`, then validate again.
`;
}

function renderMarkdown(bundle) {
  const validation = bundle.validation || emptyValidation();
  return `# Video To Product Spec

Updated: ${bundle.updatedAt || ""}

## Source

- Video: ${bundle.config?.source?.video || ""}
- Transcript: ${bundle.config?.source?.transcript || ""}
- Subtitle: ${bundle.config?.source?.subtitle || ""}
- Notes: ${bundle.config?.source?.notes || ""}
- Product goal: ${bundle.config?.productGoal || ""}
- Target stack hint: ${bundle.config?.targetStack || ""}

## Video Understanding

${bundle.videoUnderstanding?.summary || "_Not filled yet._"}

- Product type: ${bundle.videoUnderstanding?.productType || ""}
- User problem: ${bundle.videoUnderstanding?.userProblem || ""}
- Technologies: ${listInline(bundle.videoUnderstanding?.technologySignals)}

### Demo Flow

${renderList(bundle.videoUnderstanding?.coreDemoFlow)}

### Assumptions

${renderList(bundle.videoUnderstanding?.assumptions)}

### Unknowns

${renderList(bundle.videoUnderstanding?.unknowns)}

## Product Spec

- Kind: ${bundle.productSpec?.kind || ""}
- Name: ${bundle.productSpec?.name || ""}
- Pitch: ${bundle.productSpec?.elevatorPitch || ""}

### Core Features

${renderList(bundle.productSpec?.coreFeatures)}

### Screens

${renderList(bundle.productSpec?.screens)}

### Data Model

${renderList(bundle.productSpec?.dataModel)}

### API Routes

${renderList(bundle.productSpec?.apiRoutes)}

## Agent Workflow

- Platform: ${bundle.agentWorkflow?.platform || ""}
- Channels: ${listInline(bundle.agentWorkflow?.channels)}

### Triggers

${renderList(bundle.agentWorkflow?.triggers)}

### Nodes / Agent Steps

${renderList(bundle.agentWorkflow?.nodes)}

### LLM

${stringifyListItem(bundle.agentWorkflow?.llm || {})}

### Memory

${stringifyListItem(bundle.agentWorkflow?.memory || {})}

### Workflow Artifacts

${renderList(bundle.agentWorkflow?.workflowArtifacts)}

### Agent Test Scenarios

${renderList(bundle.agentWorkflow?.testScenarios)}

## Build Plan

### Stack

${renderList(bundle.buildPlan?.stack)}

### Deliverables

${renderList(bundle.buildPlan?.deliverables)}

### File Plan

${renderList(bundle.buildPlan?.filePlan)}

### Implementation Steps

${renderList(bundle.buildPlan?.implementationSteps)}

### Verification Steps

${renderList(bundle.buildPlan?.verificationSteps)}

## Implementation

- Status: ${bundle.implementation?.status || ""}
- Dev server URL: ${bundle.implementation?.devServerUrl || ""}
- Created files: ${listInline(bundle.implementation?.createdFiles)}
- Changed files: ${listInline(bundle.implementation?.changedFiles)}
- Commands run: ${listInline(bundle.implementation?.runCommands)}

## Validation

- OK: ${Boolean(validation.ok)}
- Errors: ${validation.errors?.length || 0}
- Warnings: ${validation.warnings?.length || 0}

${renderList([...(validation.errors || []), ...(validation.warnings || [])])}
`;
}

function renderBuildPrompt(bundle, validation) {
  return `You are Codex. Build the product inferred from this video spec.

Validation OK: ${validation.ok}
Validation errors: ${(validation.errors || []).join("; ") || "none"}

Product:
${JSON.stringify(bundle.productSpec, null, 2)}

Video understanding:
${JSON.stringify(bundle.videoUnderstanding, null, 2)}

Agent workflow:
${JSON.stringify(bundle.agentWorkflow || {}, null, 2)}

Build plan:
${JSON.stringify(bundle.buildPlan, null, 2)}

Implementation rules:
- Implement in target root: ${bundle.implementation?.targetRoot || bundle.config?.root || process.cwd()}
- Prefer the existing project patterns and dependencies.
- Create a working equivalent product from the video, not a line-for-line copy of proprietary code.
- If the spec is an AI agent/workflow, create importable workflow artifacts plus any supporting code, env examples, setup docs, and test scenarios.
- Run relevant checks and update product-spec implementation fields afterward.
`;
}

function renderExtractionHints(bundle) {
  const video = bundle.config?.source?.video || "<video-url-or-file>";
  return `
## How To Provide Context

If the video has subtitles:

\`\`\`bash
yt-dlp --skip-download --write-auto-subs --write-subs --sub-langs "${bundle.language || DEFAULT_LANGUAGE}.*,en.*" --sub-format vtt "${video}"
\`\`\`

If the video has no subtitles, rerun context-bundle with \`--transcribe\` so this tool downloads/extracts audio and uses local faster-whisper.
`;
}

function fetchSubtitles(video, language, options = {}) {
  if (!video || !/^https?:\/\//i.test(video)) {
    return { error: "fetch-subtitles requires an http(s) video URL." };
  }
  if (!resolveYtDlp() && options.autoInstall !== false) {
    const installed = tryInstallDepsForFetch();
    if (!installed.ok) {
      return { error: `Auto-install failed before subtitle fetch:\n${installed.error}` };
    }
  }
  const ytdlp = resolveYtDlp();
  if (!ytdlp) {
    return { error: "yt-dlp not found. Run install-deps or pass --transcript/--subtitle." };
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "video-to-product-"));
  const outputTemplate = path.join(tempDir, "subtitle.%(ext)s");
  const lang = language ? `${language}.*,en.*` : "en.*";
  const result = spawnSync(ytdlp, [
    "--skip-download",
    "--write-auto-subs",
    "--write-subs",
    "--sub-langs",
    lang,
    "--sub-format",
    "vtt/srt/best",
    "-o",
    outputTemplate,
    video,
  ], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });

  if (result.status !== 0) {
    return { error: firstLines((result.stderr || result.stdout || "").trim(), 20) || "yt-dlp subtitle fetch failed." };
  }

  const files = fs.readdirSync(tempDir)
    .filter((name) => /\.(vtt|srt|txt)$/i.test(name))
    .map((name) => path.join(tempDir, name));
  if (files.length === 0) {
    return { error: "yt-dlp completed but no subtitle file was produced." };
  }
  const text = files.map((file) => fs.readFileSync(file, "utf8")).join("\n\n");
  return { text };
}

function transcribeVideo(video, language, options = {}) {
  if (!video) {
    return { error: "transcribe requires a video URL or local media file." };
  }
  if (!resolveFasterWhisper() && options.autoInstall !== false) {
    const installed = tryInstallDepsForTranscription();
    if (!installed.ok) {
      return { error: `Auto-install failed before transcription:\n${installed.error}` };
    }
  }
  if (!resolveFasterWhisper()) {
    return { error: "faster-whisper is not installed. Run install-deps." };
  }

  const audio = prepareAudioForTranscription(video, options.root || process.cwd());
  if (!audio.ok) return { error: audio.error };

  const python = resolveVenvPython();
  const script = `
import json
import sys
from faster_whisper import WhisperModel

audio_path = sys.argv[1]
language = sys.argv[2] or None
model_name = sys.argv[3] or "base"
download_root = sys.argv[4]
import os
model_path = os.path.join(download_root, model_name)
if not os.path.exists(model_path):
    model_path = model_name
model = WhisperModel(model_path, device="cpu", compute_type="int8", download_root=download_root)
segments, info = model.transcribe(audio_path, language=language, vad_filter=True)
rows = []
for segment in segments:
    text = " ".join(segment.text.split())
    if text:
        rows.append({"start": round(segment.start, 2), "end": round(segment.end, 2), "text": text})
print(json.dumps({"language": getattr(info, "language", None), "segments": rows}, ensure_ascii=False))
`;
  const result = spawnSync(python, ["-c", script, audio.path, normalizeWhisperLanguage(language), options.model || "base", MODEL_CACHE_DIR], {
    cwd: TOOL_ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) {
    const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    return { error: firstLines(output, 40) || "faster-whisper transcription failed." };
  }

  try {
    const payload = JSON.parse(result.stdout);
    const text = (payload.segments || [])
      .map((segment) => `[${formatTime(segment.start)} - ${formatTime(segment.end)}] ${segment.text}`)
      .join("\n");
    return { text };
  } catch (error) {
    return { error: `Unable to parse transcription output: ${error.message}` };
  }
}

function prepareAudioForTranscription(video, root) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "video-to-product-audio-"));
  if (/^https?:\/\//i.test(video)) {
    const ytdlp = resolveYtDlp();
    if (!ytdlp) return { ok: false, error: "yt-dlp missing; run install-deps." };
    const ffmpeg = resolveFfmpeg();
    if (!ffmpeg) return { ok: false, error: "ffmpeg missing; run install-deps." };
    const outputTemplate = path.join(tempDir, "audio.%(ext)s");
    const result = spawnSync(ytdlp, [
      "-x",
      "--audio-format",
      "wav",
      "--audio-quality",
      "0",
      "--ffmpeg-location",
      path.dirname(ffmpeg),
      "-o",
      outputTemplate,
      video,
    ], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    if (result.status !== 0) {
      const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
      return { ok: false, error: firstLines(output, 40) || "yt-dlp audio extraction failed." };
    }
    const audioFile = fs.readdirSync(tempDir)
      .map((name) => path.join(tempDir, name))
      .find((file) => /\.(wav|m4a|mp3|opus|webm)$/i.test(file));
    if (!audioFile) return { ok: false, error: "yt-dlp did not produce an audio file." };
    return { ok: true, path: audioFile };
  }

  const mediaFile = path.isAbsolute(video) ? video : path.resolve(root, video);
  if (!fs.existsSync(mediaFile)) return { ok: false, error: `Local media file does not exist: ${mediaFile}` };
  const ffmpeg = resolveFfmpeg();
  if (!ffmpeg) return { ok: false, error: "ffmpeg missing; run install-deps." };
  const audioFile = path.join(tempDir, "audio.wav");
  const result = spawnSync(ffmpeg, [
    "-y",
    "-i",
    mediaFile,
    "-vn",
    "-ac",
    "1",
    "-ar",
    "16000",
    audioFile,
  ], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) {
    const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    return { ok: false, error: firstLines(output, 40) || "ffmpeg audio extraction failed." };
  }
  return { ok: true, path: audioFile };
}

function readOptionalContextFile(root, value) {
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return "";
  const full = path.isAbsolute(value) ? value : path.resolve(root, value);
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) return "";
  return fs.readFileSync(full, "utf8");
}

function cleanTranscript(raw) {
  const seen = new Set();
  const lines = String(raw)
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^WEBVTT/i.test(line))
    .filter((line) => !/^\d+$/.test(line))
    .filter((line) => !/^\d{1,2}:\d{2}:\d{2}[,.]\d{3}\s+-->\s+\d{1,2}:\d{2}:\d{2}[,.]\d{3}/.test(line))
    .filter((line) => !/^\d{2}:\d{2}[,.]\d{3}\s+-->\s+\d{2}:\d{2}[,.]\d{3}/.test(line))
    .map((line) => line.replace(/<[^>]+>/g, "").trim())
    .filter(Boolean)
    .filter((line) => {
      const key = line.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  return lines.join("\n");
}

function splitList(value) {
  if (!value) return [];
  return String(value)
    .split(/[,;/]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function resolveBundle(args) {
  const bundle = args.bundle || path.join(DEFAULT_OUT, `product-spec.${args.language}.json`);
  return path.resolve(process.cwd(), bundle);
}

function markdownPathForBundle(bundlePath, bundle) {
  const language = bundle.language || DEFAULT_LANGUAGE;
  return path.join(path.dirname(bundlePath), `product-spec.${language}.md`);
}

function emptyValidation() {
  return {
    ok: false,
    errors: [],
    warnings: [],
    metrics: {},
    checkedAt: "",
  };
}

function scriptPath() {
  return SCRIPT_FILE;
}

function checkResolver(name, found, detail) {
  return { name, ok: Boolean(found), detail: found || detail };
}

function dependencyChecks() {
  return [
    { name: "yt-dlp", ok: Boolean(resolveYtDlp()), detail: resolveYtDlp() || "missing" },
    { name: "ffmpeg", ok: Boolean(resolveFfmpeg()), detail: resolveFfmpeg() || "missing" },
    { name: "tesseract.js", ok: Boolean(resolveNodePackage("tesseract.js")), detail: resolveNodePackage("tesseract.js") || "missing" },
    { name: "faster-whisper", ok: Boolean(resolvePythonModule("faster_whisper")), detail: resolvePythonModule("faster_whisper") || "not installed" },
    { name: "faster-whisper-model", ok: Boolean(resolveWhisperModel("base")), detail: resolveWhisperModel("base") || "base model not downloaded" },
  ];
}

function tryInstallDepsForFetch() {
  try {
    installDepsCommand({ pretty: false });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error?.message || String(error) };
  }
}

function tryInstallDepsForTranscription() {
  try {
    installDepsCommand({ pretty: false, withTranscription: true });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error?.message || String(error) };
  }
}

function resolveYtDlp() {
  const local = path.join(VENV_BIN_DIR, process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp");
  if (fs.existsSync(local)) return local;
  return findExecutable(["yt-dlp"]);
}

function resolveVenvPython() {
  const local = path.join(VENV_BIN_DIR, process.platform === "win32" ? "python.exe" : "python");
  if (fs.existsSync(local)) return local;
  throw new Error("Tool Python venv is missing. Run install-deps.");
}

function resolveFfmpeg() {
  try {
    const ffmpeg = TOOL_REQUIRE("ffmpeg-static");
    if (ffmpeg && fs.existsSync(ffmpeg)) return ffmpeg;
  } catch {
    // Fall through to global binary.
  }
  return findExecutable(["ffmpeg"]);
}

function resolveNodePackage(packageName) {
  try {
    return TOOL_REQUIRE.resolve(`${packageName}/package.json`);
  } catch {
    return "";
  }
}

function resolvePythonModule(moduleName) {
  const python = fs.existsSync(path.join(VENV_BIN_DIR, process.platform === "win32" ? "python.exe" : "python"))
    ? path.join(VENV_BIN_DIR, process.platform === "win32" ? "python.exe" : "python")
    : findExecutable(["python3", "python"]);
  if (!python) return "";
  const result = spawnSync(python, ["-c", `import ${moduleName}; print(${moduleName}.__file__)`], {
    cwd: TOOL_ROOT,
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
  if (result.status !== 0) return "";
  return String(result.stdout || "").trim();
}

function resolveFasterWhisper() {
  return resolvePythonModule("faster_whisper");
}

function resolveWhisperModel(modelName = "base") {
  const modelDir = path.join(MODEL_CACHE_DIR, modelName);
  return fs.existsSync(path.join(modelDir, "model.bin")) ? modelDir : "";
}

function normalizeWhisperLanguage(language) {
  const value = String(language || "").toLowerCase();
  if (!value) return "";
  if (value.startsWith("vi")) return "vi";
  if (value.startsWith("en")) return "en";
  return value.split(/[-_]/)[0];
}

function formatTime(seconds) {
  const total = Math.max(0, Number(seconds) || 0);
  const minutes = Math.floor(total / 60);
  const rest = Math.floor(total % 60);
  return `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

function runProcess(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || process.cwd(),
    stdio: "pipe",
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) {
    const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    throw new Error(`${options.label || command} failed with exit ${result.status}\n${firstLines(output, 40)}`);
  }
  return {
    label: options.label || command,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function findExecutable(names) {
  const pathEntries = String(process.env.PATH || "").split(path.delimiter).filter(Boolean);
  for (const name of names) {
    for (const dir of pathEntries) {
      const full = path.join(dir, name);
      if (fs.existsSync(full)) return full;
    }
  }
  return "";
}

function normalize(file) {
  return String(file).replaceAll("\\", "/");
}

function safeMkdir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readJson(file, label) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`Failed to read ${label} JSON at ${file}: ${error.message}`);
  }
}

function writeJson(file, value, pretty = true) {
  safeMkdir(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(value, null, pretty ? 2 : 0) + "\n", "utf8");
}

function writeText(file, value) {
  safeMkdir(path.dirname(file));
  fs.writeFileSync(file, value, "utf8");
}

function printJson(value, pretty = false) {
  process.stdout.write(JSON.stringify(value, null, pretty ? 2 : 0) + "\n");
}

function text(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function nonEmptyArray(value) {
  return Array.isArray(value) && value.length > 0;
}

function arrayLength(value) {
  return Array.isArray(value) ? value.length : 0;
}

function listInline(value) {
  if (!Array.isArray(value) || value.length === 0) return "";
  return value.map((item) => stringifyListItem(item)).join(", ");
}

function renderList(value) {
  if (!Array.isArray(value) || value.length === 0) return "_Not filled yet._";
  return value.map((item) => `- ${stringifyListItem(item)}`).join("\n");
}

function stringifyListItem(item) {
  if (item === null || item === undefined) return "";
  if (typeof item === "string") return item;
  return JSON.stringify(item);
}

function truncateText(value, maxChars) {
  const textValue = String(value);
  if (textValue.length <= maxChars) return textValue;
  return textValue.slice(0, maxChars) + `\n\n[TRUNCATED: ${textValue.length - maxChars} chars omitted]`;
}

function firstLines(value, count) {
  return String(value).split("\n").slice(0, count).join("\n");
}

main();
