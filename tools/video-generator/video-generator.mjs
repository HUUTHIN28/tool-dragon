#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_FILE = fileURLToPath(import.meta.url);
const TOOL_ROOT = path.dirname(SCRIPT_FILE);
const requireFromTool = createRequire(import.meta.url);
const DEFAULT_OUT_DIR = "video-generator-output";
const DEFAULT_CONFIG_DIR = "video-generator-config";
const DEFAULT_ASSET_DIR = "video-generator-assets";
const DEFAULT_DURATION_SEC = 60;
const DEFAULT_LANGUAGE = "vi";
const DEFAULT_ASPECT_RATIO = "9:16";
const CATEGORIES = ["ai", "beauty", "tech", "business"];
const BOOLEAN_FLAGS = new Set(["force", "help", "pretty"]);
const VIDEO_EXT = new Set([".mp4", ".webm", ".mov", ".m4v", ".mkv"]);
const AUDIO_EXT = new Set([".wav", ".mp3", ".m4a", ".aac", ".ogg"]);
const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".webp", ".svg"]);

const CATEGORY_PROFILES = Object.freeze({
  ai: {
    viewer: "builders, founders, and operators adopting AI workflows",
    tone: "clear, tactical, future-aware",
    promise: "turn an abstract AI idea into a practical operating system",
    colors: ["#101827", "#38bdf8", "#a3e635"],
    hooks: [
      "Most AI projects do not fail because the model is weak; they fail because the workflow has no memory.",
      "The next AI advantage is not a bigger prompt. It is a tighter feedback loop.",
      "If an agent cannot remember what changed, it cannot improve what matters.",
    ],
    beats: [
      "name the pain in plain language",
      "show the hidden system behind the idea",
      "break the idea into three repeatable moves",
      "connect the moves to a daily workflow",
      "close with one concrete next step",
    ],
    tags: ["ai", "agents", "automation", "workflow", "productivity"],
  },
  beauty: {
    viewer: "creators, salon owners, and beauty shoppers",
    tone: "polished, specific, trust-building",
    promise: "make a beauty topic feel useful, visual, and easy to act on",
    colors: ["#3b1025", "#f9a8d4", "#fde68a"],
    hooks: [
      "The best beauty routine is not longer. It is better sequenced.",
      "A small product choice can change the whole finish.",
      "Good beauty advice starts with the problem, not the trend.",
    ],
    beats: [
      "open with a visible problem",
      "explain the ingredient or technique",
      "show the application order",
      "describe the expected finish",
      "close with a simple routine rule",
    ],
    tags: ["beauty", "routine", "skincare", "style", "creator"],
  },
  tech: {
    viewer: "engineers, technical leads, and product teams",
    tone: "precise, confident, implementation-minded",
    promise: "turn a technical topic into an understandable build decision",
    colors: ["#111827", "#60a5fa", "#facc15"],
    hooks: [
      "The useful question is not whether the tech is new. It is where it reduces friction.",
      "A good architecture choice should make tomorrow easier to debug.",
      "The fastest systems are usually the systems with the fewest surprises.",
    ],
    beats: [
      "define the technical problem",
      "explain the architecture tradeoff",
      "show the core implementation move",
      "identify the failure mode",
      "close with a practical adoption rule",
    ],
    tags: ["technology", "software", "architecture", "developer", "systems"],
  },
  business: {
    viewer: "founders, operators, and growth teams",
    tone: "commercial, concise, decision-oriented",
    promise: "translate a business topic into a sharper operating decision",
    colors: ["#172554", "#22c55e", "#f8fafc"],
    hooks: [
      "Growth gets easier when the team can see the constraint.",
      "A better business plan starts with one sharper customer promise.",
      "Revenue problems often hide inside handoff problems.",
    ],
    beats: [
      "state the business tension",
      "name the customer or operating constraint",
      "show the leverage point",
      "define the metric to watch",
      "close with a decision the team can make today",
    ],
    tags: ["business", "growth", "strategy", "operations", "startup"],
  },
});

const BATCH_TOPICS = Object.freeze({
  ai: [
    "AI Agent Memory",
    "RAG Evaluation Loops",
    "Multi Agent Workflows",
    "Prompt Version Control",
    "AI Customer Support QA",
    "Autonomous Research Agents",
    "Local First AI Tools",
    "AI Workflow Observability",
    "Vector Search Quality",
    "Agentic Browser Automation",
    "AI Knowledge Graphs",
    "Synthetic Data Review",
  ],
  beauty: [
    "Glass Skin Routine",
    "Barrier Repair Basics",
    "Soft Glam Makeup",
    "SPF Reapplication Tips",
    "Scalp Care Routine",
    "Fragrance Layering",
    "Minimal Travel Kit",
    "Salon Client Retention",
    "Color Safe Haircare",
    "Product Texture Guide",
  ],
  tech: [
    "Frontend Performance Budget",
    "API Contract Testing",
    "Postgres Index Strategy",
    "Edge Runtime Tradeoffs",
    "Design System Tokens",
    "Zero Downtime Deploys",
    "Observability Dashboards",
    "Type Safe Refactors",
    "Feature Flag Cleanup",
    "Security Review Checklist",
  ],
  business: [
    "Customer Onboarding Funnel",
    "Pricing Page Experiment",
    "Retention Metric Review",
    "Sales Handoff Workflow",
    "Founder Weekly Review",
    "Pipeline Forecast Ritual",
    "Support Cost Reduction",
    "Product Launch Brief",
    "Market Positioning Sprint",
    "Ops Automation Backlog",
  ],
});

function printHelp() {
  console.log(`
Video Generator Engine

Usage:
  ${SCRIPT_FILE} check [--root /path/to/project] [--pretty]
  ${SCRIPT_FILE} init [--root /path/to/project] [--out-dir video-generator-output] [--force]
  ${SCRIPT_FILE} plan --topic "AI Agent Memory" --category ai --duration 60 [--root /path/to/project]
  ${SCRIPT_FILE} generate --topic "AI Agent Memory" --category ai --duration 60
  ${SCRIPT_FILE} render --run-dir video-generator-output/runs/ai-ai-agent-memory-60s
  ${SCRIPT_FILE} generate-video --topic "AI Agent Memory" --category ai --duration 60
  ${SCRIPT_FILE} generate-batch-videos --category ai --count 10

Core options:
  --root             Target project root. Default: current directory.
  --out-dir          Output directory relative to root. Default: ${DEFAULT_OUT_DIR}
  --asset-dir        Asset directory with category folders. Default: video-generator-assets or tool assets.
  --topic            Video topic.
  --category         One of: ${CATEGORIES.join(", ")}. Default: ai
  --duration         Seconds, 60s, 1m, or HH:MM:SS. Default: ${DEFAULT_DURATION_SEC}
  --language         Script language hint. Default: ${DEFAULT_LANGUAGE}
  --aspect-ratio     9:16, 16:9, or 1:1. Default: ${DEFAULT_ASPECT_RATIO}
  --provider         TTS provider placeholder. Default: kokoro
  --voice            Voice name placeholder. Default: kokoro-default
  --video            Existing video asset for render.
  --audio            Existing audio asset for render.
  --out              Final render output path for render/generate-video.
  --count            Batch count for generate-batch-videos. Default: 5
  --pretty           Pretty-print JSON.
  --force            Overwrite init template files.

Examples:
  ${SCRIPT_FILE} init --root /tmp/video-gen
  ${SCRIPT_FILE} generate-video --topic "AI Agent Memory" --category ai --duration 60 --pretty
  ${SCRIPT_FILE} generate-batch-videos --category ai --count 10 --pretty

Notes:
  This tool is local-only and dependency-free. It never calls internet APIs.
  Kokoro TTS is a v1 placeholder provider. The tool writes a voice manifest and uses a
  silent/audio placeholder strategy until real narration audio is supplied.
`);
}

function parseArgs(argv) {
  const command = argv[0] && !argv[0].startsWith("-") ? argv[0] : "help";
  const rest = command === "help" && argv[0] !== "help" ? argv : argv.slice(1);
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

function main() {
  const { command, options } = parseArgs(process.argv.slice(2));

  if (command === "help" || options.help) {
    printHelp();
    return;
  }

  if (command === "check") {
    checkCommand(options);
    return;
  }

  if (command === "init") {
    initCommand(options);
    return;
  }

  if (command === "plan" || command === "generate") {
    const artifacts = createPipeline(options);
    printJson(summarizePlan(artifacts), options.pretty);
    return;
  }

  if (command === "render" || command === "generate-video-render") {
    const render = renderCommand(options);
    printJson(render, options.pretty);
    return;
  }

  if (command === "generate-video") {
    const artifacts = createPipeline(options);
    const render = renderFromArtifacts(artifacts, options);
    printJson(render, options.pretty);
    return;
  }

  if (command === "generate-batch-videos") {
    const batch = generateBatchVideos(options);
    printJson(batch, options.pretty);
    return;
  }

  throw new Error(`Unknown command: ${command}\nRun: ${SCRIPT_FILE} --help`);
}

function checkCommand(options) {
  const root = resolveRoot(options.root);
  const ffmpeg = findFfmpeg(root);
  const kokoro = findExecutable(["kokoro", "kokoro-tts", "kokoro-tts-cli"]);
  const espeak = findEspeak(root);
  const remotion = findRemotion(root);
  const projectAssetDir = resolveAssetDir(root, options.assetDir, false);
  const toolAssetDir = path.join(TOOL_ROOT, "assets");
  const projectAssets = summarizeAssets(projectAssetDir);
  const toolAssets = summarizeAssets(toolAssetDir);

  const checks = [
    {
      name: "node",
      ok: true,
      detail: process.version,
    },
    {
      name: "ffmpeg",
      ok: Boolean(ffmpeg),
      detail: ffmpeg ? versionLine(ffmpeg, ["-version"]) : "missing: install @ffmpeg-installer/ffmpeg in tools/video-generator or system ffmpeg",
    },
    {
      name: "remotion",
      ok: Boolean(remotion),
      detail: remotion || "optional: not required for local placeholder pipeline",
    },
    {
      name: "tts_kokoro",
      ok: Boolean(kokoro),
      detail: kokoro ? `${kokoro} available` : "placeholder only: Kokoro binary not found",
    },
    {
      name: "tts_local_espeak",
      ok: Boolean(espeak),
      detail: espeak ? `${espeak} available` : "optional: espeak not found",
    },
    {
      name: "project_assets",
      ok: projectAssets.exists,
      detail: projectAssets.exists ? assetDetail(projectAssets) : `missing: ${projectAssetDir}`,
    },
    {
      name: "tool_assets",
      ok: toolAssets.exists,
      detail: toolAssets.exists ? assetDetail(toolAssets) : `missing: ${toolAssetDir}`,
    },
  ];

  printJson({
    ok: true,
    root,
    local_only: true,
    render_ready: Boolean(ffmpeg),
    checks,
    fallback: {
      enabled: true,
      detail: "If media assets are missing but ffmpeg exists, the renderer creates a generated background video and uses local espeak TTS when available, otherwise silent audio.",
    },
  }, options.pretty);
}

function initCommand(options) {
  const root = resolveRoot(options.root);
  const outDir = resolveOutDir(root, options.outDir);
  const configDir = path.join(root, DEFAULT_CONFIG_DIR);
  const assetDir = path.join(root, DEFAULT_ASSET_DIR);

  ensureDir(path.join(outDir, "runs"));
  ensureDir(path.join(outDir, "renders"));
  ensureDir(path.join(outDir, "batches"));
  ensureDir(configDir);

  for (const category of CATEGORIES) {
    ensureDir(path.join(assetDir, category));
    writeIfMissing(path.join(assetDir, category, "README.md"), categoryAssetReadme(category), options.force);
  }

  writeIfMissing(path.join(outDir, "README.md"), outputReadme(), options.force);
  writeIfMissing(path.join(configDir, "video-generator.config.json"), JSON.stringify(defaultConfig(), null, 2) + "\n", options.force);

  printJson({
    ok: true,
    root,
    out_dir: outDir,
    config_path: path.join(configDir, "video-generator.config.json"),
    asset_dir: assetDir,
    categories: CATEGORIES,
  }, options.pretty);
}

function createPipeline(options) {
  const root = resolveRoot(options.root);
  const topic = stringOption(options.topic || options._[0], "AI Agent Memory");
  const category = normalizeCategory(options.category || "ai");
  const durationSec = parseDuration(options.duration || DEFAULT_DURATION_SEC);
  const language = stringOption(options.language, DEFAULT_LANGUAGE);
  const aspectRatio = stringOption(options.aspectRatio, DEFAULT_ASPECT_RATIO);
  const provider = stringOption(options.provider, "kokoro");
  const voice = stringOption(options.voice, "kokoro-default");
  const outDir = resolveOutDir(root, options.outDir);
  const runDir = resolveRunDir(root, outDir, options.runDir, options.runId, topic, category, durationSec);

  ensureDir(runDir);
  ensureDir(path.join(runDir, "voice"));
  ensureDir(path.join(runDir, "render"));

  const id = `${category}-${slugify(topic)}-${durationSec}s`;
  const profile = CATEGORY_PROFILES[category];
  const seed = hashString(`${topic}|${category}|${durationSec}|${language}`);
  const dimensions = dimensionsForAspectRatio(aspectRatio);
  const angle = buildAngle({ id, topic, category, durationSec, language, profile, seed });
  const timeline = buildTimeline({ id, topic, category, durationSec, language, profile, seed, dimensions, angle });

  const paths = {
    runDir,
    anglePath: path.join(runDir, "angle.json"),
    scriptPath: path.join(runDir, "script.md"),
    voiceManifestPath: path.join(runDir, "voice", "voice-manifest.json"),
    subtitlesPath: path.join(runDir, "subtitles.srt"),
    sceneTimelinePath: path.join(runDir, "scene-timeline.json"),
    metadataPath: path.join(runDir, "metadata.json"),
    thumbnailPath: path.join(runDir, "thumbnail.svg"),
  };

  const script = buildScriptMarkdown({ angle, timeline, paths });
  const subtitles = buildSrt(timeline.scenes);
  const voiceManifest = buildVoiceManifest({ root, provider, voice, language, timeline, paths });
  const metadata = buildMetadata({ id, topic, category, durationSec, language, angle, timeline, paths });
  const thumbnail = buildThumbnailSvg({ title: metadata.title, category, topic, profile, durationSec, dimensions });

  writeJson(paths.anglePath, angle);
  writeText(paths.scriptPath, script);
  writeJson(paths.voiceManifestPath, voiceManifest);
  writeText(paths.subtitlesPath, subtitles);
  writeJson(paths.sceneTimelinePath, timeline);
  writeJson(paths.metadataPath, metadata);
  writeText(paths.thumbnailPath, thumbnail);

  return { root, outDir, runDir, topic, category, durationSec, paths, angle, timeline, metadata };
}

function renderCommand(options) {
  const root = resolveRoot(options.root);
  const runDir = options.runDir
    ? resolveMaybeRoot(root, String(options.runDir))
    : inferRunDirFromMetadata(root, options.metadata);
  if (!runDir) throw new Error("render requires --run-dir or --metadata");

  const metadataPath = options.metadata ? resolveMaybeRoot(root, String(options.metadata)) : path.join(runDir, "metadata.json");
  if (!fs.existsSync(metadataPath)) throw new Error(`Missing metadata file: ${metadataPath}`);
  const metadata = readJson(metadataPath, "metadata");
  const artifacts = {
    root,
    outDir: resolveOutDir(root, options.outDir),
    runDir,
    topic: metadata.topic || "",
    category: normalizeCategory(metadata.category || options.category || "ai"),
    durationSec: metadata.duration_sec || DEFAULT_DURATION_SEC,
    paths: {
      metadataPath,
      thumbnailPath: resolveMaybeRoot(root, metadata.artifacts?.thumbnail_path || path.join(runDir, "thumbnail.svg")),
      sceneTimelinePath: resolveMaybeRoot(root, metadata.artifacts?.scene_timeline_path || path.join(runDir, "scene-timeline.json")),
      subtitlesPath: resolveMaybeRoot(root, metadata.artifacts?.subtitles_path || path.join(runDir, "subtitles.srt")),
      scriptPath: resolveMaybeRoot(root, metadata.artifacts?.script_path || path.join(runDir, "script.md")),
      voiceManifestPath: resolveMaybeRoot(root, metadata.artifacts?.voice_manifest_path || path.join(runDir, "voice", "voice-manifest.json")),
    },
    metadata,
  };
  return renderFromArtifacts(artifacts, options);
}

function renderFromArtifacts(artifacts, options) {
  const root = artifacts.root;
  const category = artifacts.category;
  const renderDir = path.join(artifacts.runDir, "render");
  ensureDir(renderDir);

  const ffmpeg = findFfmpeg(root);
  const espeak = findEspeak(root);
  const assetDir = resolveAssetDir(root, options.assetDir, true);
  const categoryAssetDirs = [
    path.join(assetDir, category),
    path.join(TOOL_ROOT, "assets", category),
  ];
  const explicitVideo = options.video ? resolveMaybeRoot(root, String(options.video)) : null;
  const explicitAudio = options.audio ? resolveMaybeRoot(root, String(options.audio)) : null;
  const videoAsset = existingFile(explicitVideo) || findFirstMedia(categoryAssetDirs, VIDEO_EXT);
  const audioAsset = existingFile(explicitAudio) || findFirstMedia(categoryAssetDirs, AUDIO_EXT);
  const imageAsset = findFirstMedia(categoryAssetDirs, IMAGE_EXT);
  const outPath = options.out
    ? resolveMaybeRoot(root, String(options.out))
    : path.join(renderDir, "final.mp4");

  const reasons = [];
  if (!ffmpeg) reasons.push("ffmpeg_not_found");
  if (!videoAsset) reasons.push("video_asset_not_found_generated_background_available");
  if (!audioAsset) reasons.push(espeak ? "audio_asset_not_found_generated_tts_available" : "audio_asset_not_found_generated_silence_available");

  let status = "placeholder";
  let videoPath = path.join(renderDir, "final-video-placeholder.txt");
  let thumbnailPath = artifacts.paths.thumbnailPath;
  let ffmpegLog = "";

  if (ffmpeg && videoAsset && audioAsset) {
    ensureDir(path.dirname(outPath));
    const result = spawnSync(ffmpeg, [
      "-y",
      "-i",
      videoAsset,
      "-i",
      audioAsset,
      "-shortest",
      "-map",
      "0:v:0",
      "-map",
      "1:a:0",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-movflags",
      "+faststart",
      outPath,
    ], { encoding: "utf8" });

    ffmpegLog = [result.stdout || "", result.stderr || ""].join("\n").trim();
    if (result.status === 0 && fs.existsSync(outPath)) {
      status = "rendered";
      videoPath = outPath;
      const extractedThumb = path.join(renderDir, "thumbnail.jpg");
      const thumbResult = spawnSync(ffmpeg, [
        "-y",
        "-ss",
        "00:00:01",
        "-i",
        outPath,
        "-frames:v",
        "1",
        extractedThumb,
      ], { encoding: "utf8" });
      if (thumbResult.status === 0 && fs.existsSync(extractedThumb)) thumbnailPath = extractedThumb;
    } else {
      reasons.push("ffmpeg_render_failed");
      writeText(path.join(renderDir, "ffmpeg.log"), ffmpegLog + "\n");
    }
  } else if (ffmpeg) {
    ensureDir(path.dirname(outPath));
    const generated = renderGeneratedVideo({ ffmpeg, espeak, artifacts, outPath, renderDir });
    ffmpegLog = generated.ffmpegLog;
    if (generated.ok && fs.existsSync(outPath)) {
      status = "rendered";
      videoPath = outPath;
      if (generated.audioPath) markVoiceManifestGenerated(artifacts, generated.audioPath, generated.audioMode, espeak);
      reasons.push(generated.audioMode === "tts" ? "rendered_with_generated_background_and_tts_audio" : "rendered_with_generated_background_and_silent_audio");
      const extractedThumb = path.join(renderDir, "thumbnail.jpg");
      const thumbResult = spawnSync(ffmpeg, [
        "-y",
        "-ss",
        "00:00:01",
        "-i",
        outPath,
        "-frames:v",
        "1",
        extractedThumb,
      ], { encoding: "utf8" });
      if (thumbResult.status === 0 && fs.existsSync(extractedThumb)) thumbnailPath = extractedThumb;
    } else {
      reasons.push("ffmpeg_generated_render_failed");
      writeText(path.join(renderDir, "ffmpeg.log"), ffmpegLog + "\n");
    }
  }

  if (status !== "rendered") {
    writeText(videoPath, placeholderVideoText({
      artifacts,
      reasons,
      ffmpeg,
      videoAsset,
      audioAsset,
      imageAsset,
    }));
  }

  const renderManifestPath = path.join(renderDir, "render-manifest.json");
  const renderManifest = {
    schema_version: "1.0",
    kind: "video_render_manifest",
    status,
    local_only: true,
    video_path: videoPath,
    thumbnail_path: thumbnailPath,
    metadata_path: artifacts.paths.metadataPath,
    script_path: artifacts.paths.scriptPath,
    subtitles_path: artifacts.paths.subtitlesPath,
    scene_timeline_path: artifacts.paths.sceneTimelinePath,
    voice_manifest_path: artifacts.paths.voiceManifestPath,
    assets: {
      asset_dir: assetDir,
      video_asset: videoAsset,
      audio_asset: audioAsset,
      image_asset: imageAsset,
      generated_assets_dir: path.join(renderDir, "generated"),
    },
    availability: {
      ffmpeg_path: ffmpeg,
      can_render_mp4: status === "rendered",
    },
    fallback_reasons: reasons,
  };
  writeJson(renderManifestPath, renderManifest);

  const metadata = {
    ...artifacts.metadata,
    status,
    render: renderManifest,
    artifacts: {
      ...(artifacts.metadata.artifacts || {}),
      video_path: videoPath,
      thumbnail_path: thumbnailPath,
      render_manifest_path: renderManifestPath,
    },
    updated_at: new Date().toISOString(),
  };
  writeJson(artifacts.paths.metadataPath, metadata);

  return {
    ok: true,
    status,
    video_path: videoPath,
    thumbnail_path: thumbnailPath,
    metadata_path: artifacts.paths.metadataPath,
    angle_path: artifacts.paths.anglePath || path.join(artifacts.runDir, "angle.json"),
    script_path: artifacts.paths.scriptPath,
    voice_manifest_path: artifacts.paths.voiceManifestPath,
    subtitles_path: artifacts.paths.subtitlesPath,
    scene_timeline_path: artifacts.paths.sceneTimelinePath,
    render_manifest_path: renderManifestPath,
    run_dir: artifacts.runDir,
    fallback_reasons: reasons,
  };
}

function renderGeneratedVideo({ ffmpeg, espeak, artifacts, outPath, renderDir }) {
  const timeline = artifacts.timeline || readJson(artifacts.paths.sceneTimelinePath, "scene timeline");
  const profile = CATEGORY_PROFILES[artifacts.category] || CATEGORY_PROFILES.ai;
  const generatedDir = path.join(renderDir, "generated");
  const textDir = path.join(generatedDir, "text");
  ensureDir(textDir);

  const duration = Math.max(1, Number(timeline.duration_sec || artifacts.durationSec || DEFAULT_DURATION_SEC));
  const width = Number(timeline.width || 1080);
  const height = Number(timeline.height || 1920);
  const fps = Number(timeline.fps || 30);
  const [bg, accent, text] = profile.colors;
  const fontFile = findFontFile();
  const titleSize = Math.round(height * 0.04);
  const bodySize = Math.round(height * 0.024);

  const filters = [
    `drawbox=x=0:y=0:w=${Math.round(width * 0.08)}:h=ih:color=${hexToFfmpegColor(accent)}@1:t=fill`,
    `drawbox=x=${Math.round(width * 0.08)}:y=${Math.round(height * 0.12)}:w=${Math.round(width * 0.84)}:h=${Math.round(height * 0.76)}:color=black@0.18:t=fill`,
  ];

  timeline.scenes.forEach((scene, index) => {
    const titleFile = path.join(textDir, `${scene.id}-title.txt`);
    const bodyFile = path.join(textDir, `${scene.id}-body.txt`);
    writeText(titleFile, wrapWords(scene.on_screen_text || scene.label || artifacts.topic, 18).slice(0, 3).join("\n"));
    writeText(bodyFile, wrapWords(scene.narration || "", 30).slice(0, 6).join("\n"));
    const start = Number(scene.start_sec || 0);
    const end = Number(scene.end_sec || duration);
    const enable = `between(t,${start},${end})`;
    filters.push(drawTextFilter({
      file: titleFile,
      fontFile,
      color: accent,
      fontSize: titleSize,
      lineSpacing: 18,
      x: Math.round(width * 0.14),
      y: Math.round(height * 0.24),
      box: true,
      enable,
    }));
    filters.push(drawTextFilter({
      file: bodyFile,
      fontFile,
      color: text,
      fontSize: bodySize,
      lineSpacing: 14,
      x: Math.round(width * 0.14),
      y: Math.round(height * 0.60),
      box: true,
      enable,
    }));
    filters.push(`drawtext=${fontFile ? `fontfile=${escapeFfmpegFilterValue(fontFile)}:` : ""}text='${String(index + 1).padStart(2, "0")}/${String(timeline.scenes.length).padStart(2, "0")}':fontcolor=${hexToFfmpegColor(text)}@0.78:fontsize=${Math.round(bodySize * 0.72)}:x=${Math.round(width * 0.80)}:y=${Math.round(height * 0.90)}:enable='${enable}'`);
  });

  const generatedAudio = createGeneratedAudio({ ffmpeg, espeak, artifacts, timeline, generatedDir, duration });
  const audioPath = generatedAudio.audioPath;

  const filterGraph = filters.join(",");
  const args = [
    "-y",
    "-f",
    "lavfi",
    "-i",
    `color=c=${hexToFfmpegColor(bg)}:s=${width}x${height}:r=${fps}:d=${duration}`,
    "-i",
    audioPath,
    "-vf",
    filterGraph,
    "-t",
    String(duration),
    "-map",
    "0:v:0",
    "-map",
    "1:a:0",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-movflags",
    "+faststart",
    outPath,
  ];
  const result = spawnSync(ffmpeg, args, { encoding: "utf8" });
  let ffmpegLog = [
    generatedAudio.log || "",
    result.stdout || "",
    result.stderr || "",
  ].join("\n").trim();

  if (result.status === 0) {
    return { ok: true, audioPath, audioMode: generatedAudio.mode, ffmpegLog };
  }

  const simpleResult = spawnSync(ffmpeg, [
    "-y",
    "-f",
    "lavfi",
    "-i",
    `color=c=${hexToFfmpegColor(bg)}:s=${width}x${height}:r=${fps}:d=${duration}`,
    "-i",
    audioPath,
    "-t",
    String(duration),
    "-map",
    "0:v:0",
    "-map",
    "1:a:0",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-movflags",
    "+faststart",
    outPath,
  ], { encoding: "utf8" });
  ffmpegLog = [
    ffmpegLog,
    simpleResult.stdout || "",
    simpleResult.stderr || "",
  ].join("\n").trim();

  return { ok: simpleResult.status === 0, audioPath, audioMode: generatedAudio.mode, ffmpegLog };
}

function createGeneratedAudio({ ffmpeg, espeak, artifacts, timeline, generatedDir, duration }) {
  const textPath = path.join(generatedDir, "narration.txt");
  const ttsPath = path.join(generatedDir, "voiceover.wav");
  const silentPath = path.join(generatedDir, "silent-audio.wav");
  const narration = timeline.scenes.map((scene) => scene.narration).join("\n\n");
  writeText(textPath, narration);

  if (espeak) {
    const language = normalizeEspeakLanguage(artifacts.metadata?.language || artifacts.language || timeline.language || DEFAULT_LANGUAGE);
    const result = spawnSync(espeak, [
      "-v",
      language,
      "-s",
      "165",
      "-w",
      ttsPath,
      "-f",
      textPath,
    ], { encoding: "utf8" });
    if (result.status === 0 && fs.existsSync(ttsPath)) {
      return {
        mode: "tts",
        audioPath: ttsPath,
        log: [result.stdout || "", result.stderr || ""].join("\n").trim(),
      };
    }
  }

  const result = spawnSync(ffmpeg, [
    "-y",
    "-f",
    "lavfi",
    "-i",
    "anullsrc=channel_layout=stereo:sample_rate=44100",
    "-t",
    String(duration),
    "-c:a",
    "pcm_s16le",
    silentPath,
  ], { encoding: "utf8" });
  return {
    mode: "silent",
    audioPath: silentPath,
    log: [result.stdout || "", result.stderr || ""].join("\n").trim(),
  };
}

function markVoiceManifestGenerated(artifacts, audioPath, audioMode, espeak) {
  const file = artifacts.paths.voiceManifestPath;
  if (!file || !fs.existsSync(file)) return;
  const manifest = readJson(file, "voice manifest");
  const timeline = artifacts.timeline || readJson(artifacts.paths.sceneTimelinePath, "scene timeline");
  const isTts = audioMode === "tts";
  writeJson(file, {
    ...manifest,
    status: isTts ? "generated_tts_audio" : "generated_silent_audio",
    strategy: isTts ? "local_espeak_tts_audio_track" : "generated_silent_audio_track",
    audio_path: audioPath,
    tts_engine: {
      ...(manifest.tts_engine || {}),
      espeak_binary: espeak,
      available: Boolean(isTts),
      note: isTts
        ? "Generated narration locally with espeak-ng."
        : "No local TTS binary was available; the renderer generated a silent WAV track so MP4 export can complete.",
    },
    segments: timeline.scenes.map((scene) => ({
      id: scene.id,
      start_sec: scene.start_sec,
      end_sec: scene.end_sec,
      text: scene.narration,
    })),
  });
}

function drawTextFilter({ file, fontFile, color, fontSize, lineSpacing, x, y, box, enable }) {
  return [
    "drawtext=",
    fontFile ? `fontfile=${escapeFfmpegFilterValue(fontFile)}:` : "",
    `textfile=${escapeFfmpegFilterValue(file)}`,
    `:fontcolor=${hexToFfmpegColor(color)}`,
    `:fontsize=${fontSize}`,
    `:line_spacing=${lineSpacing}`,
    `:x=${x}`,
    `:y=${y}`,
    box ? ":box=1:boxcolor=black@0.38:boxborderw=28" : "",
    `:enable='${enable}'`,
  ].join("");
}

function generateBatchVideos(options) {
  const root = resolveRoot(options.root);
  const category = normalizeCategory(options.category || "ai");
  const count = parsePositiveInt(options.count || 5, "--count");
  const topics = normalizeTopicList(options.topic);
  const selectedTopics = topics.length > 0 ? expandTopics(topics, count, category) : defaultBatchTopics(category, count);
  const videos = [];

  for (let i = 0; i < count; i += 1) {
    const topic = selectedTopics[i];
    const itemOptions = {
      ...options,
      root,
      topic,
      category,
      runId: `${category}-${String(i + 1).padStart(2, "0")}-${slugify(topic)}-${parseDuration(options.duration || DEFAULT_DURATION_SEC)}s`,
    };
    const artifacts = createPipeline(itemOptions);
    const render = renderFromArtifacts(artifacts, itemOptions);
    videos.push({
      index: i + 1,
      topic,
      ...render,
    });
  }

  const outDir = resolveOutDir(root, options.outDir);
  const batchDir = path.join(outDir, "batches");
  ensureDir(batchDir);
  const batchManifestPath = path.join(batchDir, `${category}-${count}-videos.json`);
  const manifest = {
    schema_version: "1.0",
    kind: "video_batch_manifest",
    category,
    count,
    generated_at: new Date().toISOString(),
    local_only: true,
    videos,
  };
  writeJson(batchManifestPath, manifest);

  return {
    ok: true,
    category,
    count,
    batch_manifest_path: batchManifestPath,
    videos,
  };
}

function buildAngle({ id, topic, category, durationSec, language, profile, seed }) {
  const hook = pick(profile.hooks, seed);
  const beatOffset = seed % profile.beats.length;
  const beats = rotate(profile.beats, beatOffset);
  return {
    schema_version: "1.0",
    kind: "video_angle",
    id,
    topic,
    category,
    language,
    duration_sec: durationSec,
    title: titleCase(topic),
    target_viewer: profile.viewer,
    tone: profile.tone,
    hook,
    core_angle: `${titleCase(topic)} as a practical system, not a vague trend.`,
    viewer_promise: profile.promise,
    retention_devices: [
      "open loop in the hook",
      "three-part middle structure",
      "clear final action",
    ],
    story_beats: beats,
    call_to_action: `Map one ${topic.toLowerCase()} decision into a repeatable checklist today.`,
    generator: "video-generator-local-v1",
  };
}

function buildTimeline({ id, topic, category, durationSec, language, profile, seed, dimensions, angle }) {
  const sceneCount = clamp(Math.round(durationSec / 10), 4, 8);
  const durations = distributeDuration(durationSec, sceneCount);
  const labels = sceneLabels(sceneCount);
  let cursor = 0;
  const scenes = [];

  for (let i = 0; i < sceneCount; i += 1) {
    const start = cursor;
    const end = cursor + durations[i];
    const beat = angle.story_beats[i % angle.story_beats.length];
    const narration = narrationForScene({
      index: i,
      count: sceneCount,
      topic,
      category,
      language,
      angle,
      beat,
      durationSec: durations[i],
    });
    scenes.push({
      id: `scene-${String(i + 1).padStart(2, "0")}`,
      label: labels[i],
      start_sec: start,
      end_sec: end,
      duration_sec: durations[i],
      beat,
      narration,
      on_screen_text: conciseOnScreenText(topic, i, sceneCount),
      visual_prompt: visualPrompt({ topic, category, profile, beat, index: i, seed }),
      asset_role: i === 0 ? "hook_background" : i === sceneCount - 1 ? "cta_background" : "b_roll",
      motion: pick(["slow push in", "left to right pan", "quick jump cut", "subtle parallax"], seed + i),
    });
    cursor = end;
  }

  return {
    schema_version: "1.0",
    kind: "scene_timeline",
    id,
    topic,
    category,
    language,
    duration_sec: durationSec,
    aspect_ratio: dimensions.aspectRatio,
    width: dimensions.width,
    height: dimensions.height,
    fps: 30,
    scenes,
  };
}

function buildScriptMarkdown({ angle, timeline }) {
  const lines = [
    `# ${angle.title}`,
    "",
    `Topic: ${angle.topic}`,
    `Category: ${angle.category}`,
    `Duration: ${angle.duration_sec}s`,
    "",
    "## Angle",
    "",
    angle.hook,
    "",
    `Promise: ${angle.viewer_promise}`,
    "",
    "## Narration",
    "",
  ];

  for (const scene of timeline.scenes) {
    lines.push(`### ${scene.id} (${formatClock(scene.start_sec)} - ${formatClock(scene.end_sec)})`);
    lines.push(scene.narration);
    lines.push("");
  }

  lines.push("## CTA");
  lines.push(angle.call_to_action);
  lines.push("");
  return lines.join("\n");
}

function buildSrt(scenes) {
  return scenes.map((scene, index) => [
    String(index + 1),
    `${formatSrtTime(scene.start_sec)} --> ${formatSrtTime(scene.end_sec)}`,
    wrapSubtitle(scene.narration),
    "",
  ].join("\n")).join("\n");
}

function buildVoiceManifest({ root, provider, voice, language, timeline, paths }) {
  const kokoro = findExecutable(["kokoro", "kokoro-tts", "kokoro-tts-cli"]);
  const espeak = findEspeak(root);
  return {
    schema_version: "1.0",
    kind: "voice_manifest",
    provider,
    voice,
    language,
    status: "placeholder",
    local_only: true,
    tts_engine: {
      name: provider,
      kokoro_binary: kokoro,
      espeak_binary: espeak,
      available: Boolean(kokoro || espeak),
      note: espeak
        ? "Local espeak-ng is available for deterministic offline narration."
        : "Kokoro is a placeholder provider in v1. This CLI does not synthesize paid or online TTS.",
    },
    strategy: espeak ? "local_espeak_ready" : kokoro ? "external_kokoro_ready_but_not_invoked" : "silent_audio_placeholder_until_voiceover_exists",
    expected_audio_path: path.join(paths.runDir, "voice", "voiceover.wav"),
    audio_path: null,
    script_path: paths.scriptPath,
    subtitles_path: paths.subtitlesPath,
    segments: timeline.scenes.map((scene) => ({
      id: scene.id,
      start_sec: scene.start_sec,
      end_sec: scene.end_sec,
      text: scene.narration,
    })),
  };
}

function buildMetadata({ id, topic, category, durationSec, language, angle, timeline, paths }) {
  const tags = Array.from(new Set([...CATEGORY_PROFILES[category].tags, ...topic.toLowerCase().split(/\s+/).filter(Boolean)])).slice(0, 12);
  return {
    schema_version: "1.0",
    kind: "video_metadata",
    id,
    status: "planned",
    local_only: true,
    title: angle.title,
    topic,
    category,
    language,
    duration_sec: durationSec,
    description: `${angle.title}: ${angle.viewer_promise}.`,
    tags,
    hashtags: tags.slice(0, 6).map((tag) => `#${tag.replace(/[^a-z0-9]/gi, "")}`),
    angle_summary: angle.core_angle,
    scene_count: timeline.scenes.length,
    artifacts: {
      run_dir: paths.runDir,
      angle_path: paths.anglePath,
      script_path: paths.scriptPath,
      voice_manifest_path: paths.voiceManifestPath,
      subtitles_path: paths.subtitlesPath,
      scene_timeline_path: paths.sceneTimelinePath,
      metadata_path: paths.metadataPath,
      thumbnail_path: paths.thumbnailPath,
      video_path: null,
    },
    generated_at: new Date().toISOString(),
  };
}

function buildThumbnailSvg({ title, category, topic, profile, durationSec, dimensions }) {
  const [bg, accent, text] = profile.colors;
  const safeTitle = escapeXml(title);
  const safeTopic = escapeXml(topic);
  const lines = wrapWords(title, 18).slice(0, 3);
  const titleSpans = lines.map((line, index) => {
    const y = 42 + index * 10;
    return `<text x="8" y="${y}%" font-size="56" font-weight="700" font-family="Arial, sans-serif" fill="${text}">${escapeXml(line)}</text>`;
  }).join("\n  ");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${dimensions.width}" height="${dimensions.height}" viewBox="0 0 ${dimensions.width} ${dimensions.height}" role="img" aria-label="${safeTitle}">
  <rect width="100%" height="100%" fill="${bg}"/>
  <rect x="0" y="0" width="${Math.round(dimensions.width * 0.08)}" height="100%" fill="${accent}"/>
  <circle cx="${Math.round(dimensions.width * 0.84)}" cy="${Math.round(dimensions.height * 0.18)}" r="${Math.round(dimensions.width * 0.13)}" fill="${accent}" opacity="0.32"/>
  <text x="8" y="18%" font-size="28" font-weight="700" font-family="Arial, sans-serif" fill="${accent}" letter-spacing="3">${escapeXml(category.toUpperCase())} / ${durationSec}S</text>
  ${titleSpans}
  <text x="8" y="82%" font-size="30" font-family="Arial, sans-serif" fill="${text}" opacity="0.86">${safeTopic}</text>
</svg>
`;
}

function narrationForScene({ index, count, topic, category, language, angle, beat }) {
  if (language === "vi") {
    if (index === 0) {
      return `Trong ${angle.duration_sec} giay, hay nhin ${topic} nhu mot he thong thuc thi, khong phai mot y tuong mo ho. ${angle.hook}`;
    }
    if (index === count - 1) {
      return `Buoc tiep theo rat gon: chon mot quy trinh nho, viet thanh checklist, va do xem ${topic} co lam quy trinh do nhanh hon hay ro hon khong.`;
    }
    return `Canh ${index + 1} tap trung vao viec ${beat}. Voi ${topic}, diem quan trong la bien no thanh mot thao tac co dau vao, dau ra, va tieu chi kiem tra.`;
  }

  if (index === 0) {
    return `In ${angle.duration_sec} seconds, frame ${topic} as an operating system, not a vague idea. ${angle.hook}`;
  }
  if (index === count - 1) {
    return `The next step is simple: choose one small workflow, turn it into a checklist, and measure whether ${topic} makes it faster or clearer.`;
  }
  return `Scene ${index + 1} focuses on how to ${beat}. For ${topic}, the useful move is to define inputs, outputs, and a check that proves the system worked.`;
}

function visualPrompt({ topic, category, profile, beat, index, seed }) {
  const setting = pick([
    "clean editorial workspace",
    "close-up interface detail",
    "split-second before and after comparison",
    "simple dashboard with one highlighted metric",
    "hands-on workflow scene",
  ], seed + index);
  return `${category} video scene for ${topic}: ${setting}, ${profile.tone}, visual beat: ${beat}`;
}

function conciseOnScreenText(topic, index, count) {
  if (index === 0) return titleCase(topic);
  if (index === count - 1) return "One workflow. One checklist. One metric.";
  return ["Input", "System", "Signal", "Decision", "Action"][index % 5];
}

function sceneLabels(count) {
  const base = ["Hook", "Problem", "System", "Example", "Proof", "Workflow", "Decision", "CTA"];
  return base.slice(0, count);
}

function placeholderVideoText({ artifacts, reasons, ffmpeg, videoAsset, audioAsset, imageAsset }) {
  return [
    "Video Generator Placeholder Draft",
    "",
    `Topic: ${artifacts.topic}`,
    `Category: ${artifacts.category}`,
    `Status: placeholder`,
    "",
    "Why a real MP4 was not rendered:",
    ...reasons.map((reason) => `- ${reason}`),
    "",
    "Availability:",
    `- ffmpeg: ${ffmpeg || "missing"}`,
    `- video asset: ${videoAsset || "missing"}`,
    `- audio asset: ${audioAsset || "missing"}`,
    `- image asset: ${imageAsset || "missing"}`,
    "",
    "Useful artifacts:",
    `- metadata: ${artifacts.paths.metadataPath}`,
    `- scene timeline: ${artifacts.paths.sceneTimelinePath}`,
    `- script: ${artifacts.paths.scriptPath}`,
    `- subtitles: ${artifacts.paths.subtitlesPath}`,
    `- voice manifest: ${artifacts.paths.voiceManifestPath}`,
    "",
    "To render a richer video, add real b-roll and a voiceover to the category asset folder,",
    "or pass --video and --audio to render/generate-video. With ffmpeg installed, the tool can render",
    "a generated caption video even when assets are missing.",
    "",
  ].join("\n");
}

function summarizePlan(artifacts) {
  return {
    ok: true,
    status: "planned",
    run_dir: artifacts.runDir,
    angle_path: artifacts.paths.anglePath,
    script_path: artifacts.paths.scriptPath,
    voice_manifest_path: artifacts.paths.voiceManifestPath,
    subtitles_path: artifacts.paths.subtitlesPath,
    scene_timeline_path: artifacts.paths.sceneTimelinePath,
    metadata_path: artifacts.paths.metadataPath,
    thumbnail_path: artifacts.paths.thumbnailPath,
  };
}

function summarizeAssets(assetDir) {
  const summary = {
    exists: fs.existsSync(assetDir),
    asset_dir: assetDir,
    video_count: 0,
    audio_count: 0,
    image_count: 0,
    categories: {},
  };
  if (!summary.exists) return summary;

  for (const category of CATEGORIES) {
    const dir = path.join(assetDir, category);
    const files = fs.existsSync(dir) ? walkFiles(dir).filter((file) => fs.statSync(file).isFile()) : [];
    const categorySummary = {
      exists: fs.existsSync(dir),
      video_count: files.filter((file) => VIDEO_EXT.has(path.extname(file).toLowerCase())).length,
      audio_count: files.filter((file) => AUDIO_EXT.has(path.extname(file).toLowerCase())).length,
      image_count: files.filter((file) => IMAGE_EXT.has(path.extname(file).toLowerCase())).length,
    };
    summary.categories[category] = categorySummary;
    summary.video_count += categorySummary.video_count;
    summary.audio_count += categorySummary.audio_count;
    summary.image_count += categorySummary.image_count;
  }
  return summary;
}

function assetDetail(summary) {
  return `videos=${summary.video_count}, audio=${summary.audio_count}, images=${summary.image_count}`;
}

function defaultConfig() {
  return {
    schema_version: "1.0",
    tool: "video-generator",
    local_only: true,
    defaults: {
      out_dir: DEFAULT_OUT_DIR,
      asset_dir: DEFAULT_ASSET_DIR,
      category: "ai",
      duration_sec: DEFAULT_DURATION_SEC,
      language: DEFAULT_LANGUAGE,
      aspect_ratio: DEFAULT_ASPECT_RATIO,
      tts_provider: "kokoro",
      tts_strategy: "silent_audio_fallback",
    },
  };
}

function outputReadme() {
  return [
    "# Video Generator Output",
    "",
    "This folder stores local pipeline artifacts.",
    "",
    "- `runs/`: per-video angle, script, voice manifest, subtitles, scene timeline, metadata, and render output.",
    "- `renders/`: optional shared render exports.",
    "- `batches/`: batch manifests from `generate-batch-videos`.",
    "",
  ].join("\n");
}

function categoryAssetReadme(category) {
  return [
    `# ${category} assets`,
    "",
    "Optional local assets for the video generator.",
    "",
    "Add at least one video file and one audio file here to enable real ffmpeg rendering.",
    "Supported video: mp4, webm, mov, m4v, mkv.",
    "Supported audio: wav, mp3, m4a, aac, ogg.",
    "Supported images: png, jpg, jpeg, webp, svg.",
    "",
  ].join("\n");
}

function resolveRoot(value) {
  return path.resolve(String(value || process.cwd()));
}

function resolveOutDir(root, outDir) {
  return resolveMaybeRoot(root, String(outDir || DEFAULT_OUT_DIR));
}

function resolveAssetDir(root, assetDir, preferExisting) {
  if (assetDir) return resolveMaybeRoot(root, String(assetDir));
  const projectAssetDir = path.join(root, DEFAULT_ASSET_DIR);
  if (preferExisting && !fs.existsSync(projectAssetDir)) return path.join(TOOL_ROOT, "assets");
  return projectAssetDir;
}

function resolveRunDir(root, outDir, runDir, runId, topic, category, durationSec) {
  if (runDir) return resolveMaybeRoot(root, String(runDir));
  const id = runId || `${category}-${slugify(topic)}-${durationSec}s`;
  return path.join(outDir, "runs", id);
}

function resolveMaybeRoot(root, value) {
  const raw = String(value);
  return path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(root, raw);
}

function inferRunDirFromMetadata(root, metadata) {
  if (!metadata) return null;
  const metadataPath = resolveMaybeRoot(root, String(metadata));
  return path.dirname(metadataPath);
}

function normalizeCategory(value) {
  const category = String(value || "ai").toLowerCase().trim();
  if (!CATEGORIES.includes(category)) {
    throw new Error(`Unknown category: ${category}. Expected one of: ${CATEGORIES.join(", ")}`);
  }
  return category;
}

function parseDuration(value) {
  if (typeof value === "number") return Math.max(1, Math.round(value));
  const raw = String(value || DEFAULT_DURATION_SEC).trim().toLowerCase();
  if (/^\d+$/.test(raw)) return Number(raw);
  if (/^\d+s$/.test(raw)) return Number(raw.slice(0, -1));
  if (/^\d+m$/.test(raw)) return Number(raw.slice(0, -1)) * 60;
  if (/^\d+:\d{2}$/.test(raw)) {
    const [minutes, seconds] = raw.split(":").map(Number);
    return minutes * 60 + seconds;
  }
  if (/^\d+:\d{2}:\d{2}$/.test(raw)) {
    const [hours, minutes, seconds] = raw.split(":").map(Number);
    return hours * 3600 + minutes * 60 + seconds;
  }
  throw new Error(`Invalid --duration: ${value}`);
}

function parsePositiveInt(value, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${label} must be a positive integer`);
  return parsed;
}

function stringOption(value, fallback) {
  if (Array.isArray(value)) return String(value[value.length - 1] || fallback);
  return String(value || fallback);
}

function normalizeTopicList(value) {
  if (!value) return [];
  const list = Array.isArray(value) ? value : [value];
  return list.flatMap((item) => String(item).split(",")).map((item) => item.trim()).filter(Boolean);
}

function expandTopics(topics, count, category) {
  const out = [];
  for (let i = 0; i < count; i += 1) {
    out.push(topics[i % topics.length] || `${titleCase(category)} Video ${i + 1}`);
  }
  return out;
}

function defaultBatchTopics(category, count) {
  const base = BATCH_TOPICS[category] || BATCH_TOPICS.ai;
  const out = [];
  for (let i = 0; i < count; i += 1) {
    out.push(base[i % base.length] || `${titleCase(category)} Video ${i + 1}`);
  }
  return out;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeIfMissing(file, text, force) {
  ensureDir(path.dirname(file));
  if (force || !fs.existsSync(file)) writeText(file, text);
}

function writeText(file, text) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, text, "utf8");
}

function writeJson(file, value) {
  writeText(file, JSON.stringify(value, null, 2) + "\n");
}

function readJson(file, label) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`Failed to read ${label} JSON at ${file}: ${error.message}`);
  }
}

function printJson(value, pretty) {
  console.log(JSON.stringify(value, null, pretty ? 2 : 0));
}

function findExecutable(candidates) {
  const pathDirs = String(process.env.PATH || "").split(path.delimiter).filter(Boolean);
  for (const candidate of candidates) {
    if (candidate.includes(path.sep)) {
      if (isExecutable(candidate)) return candidate;
      continue;
    }
    for (const dir of pathDirs) {
      const full = path.join(dir, candidate);
      if (isExecutable(full)) return full;
    }
  }
  return null;
}

function findFfmpeg(root) {
  const system = findExecutable(["ffmpeg"]);
  if (system) return system;

  const localBins = [
    path.join(TOOL_ROOT, "node_modules", ".bin", "ffmpeg"),
    path.join(root, "node_modules", ".bin", "ffmpeg"),
  ];
  for (const bin of localBins) {
    if (isExecutable(bin)) return bin;
  }

  try {
    const installer = requireFromTool("@ffmpeg-installer/ffmpeg");
    if (installer?.path && isExecutable(installer.path)) return installer.path;
  } catch {
    // Local npm dependency is optional until installed.
  }

  try {
    const requireFromRoot = createRequire(path.join(root, "package.json"));
    const installer = requireFromRoot("@ffmpeg-installer/ffmpeg");
    if (installer?.path && isExecutable(installer.path)) return installer.path;
  } catch {
    // Root npm dependency is optional.
  }

  return null;
}

function findEspeak(root) {
  const system = findExecutable(["espeak-ng", "espeak"]);
  if (system) return system;

  const localBins = [
    path.join(TOOL_ROOT, "vendor", "espeak-ng", "usr", "bin", "espeak-ng"),
    path.join(root, "tools", "video-generator", "vendor", "espeak-ng", "usr", "bin", "espeak-ng"),
  ];
  for (const bin of localBins) {
    if (isExecutable(bin)) return bin;
  }
  return null;
}

function isExecutable(file) {
  try {
    fs.accessSync(file, fs.constants.X_OK);
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

function findFontFile() {
  const candidates = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf",
    "/usr/share/fonts/truetype/freefont/FreeSans.ttf",
  ];
  return candidates.find((file) => fs.existsSync(file)) || null;
}

function hexToFfmpegColor(value) {
  const hex = String(value || "#000000").trim().replace(/^#/, "");
  if (/^[0-9a-f]{6}$/i.test(hex)) return `0x${hex}`;
  return "0x000000";
}

function escapeFfmpegFilterValue(value) {
  return String(value)
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'");
}

function normalizeEspeakLanguage(language) {
  const raw = String(language || DEFAULT_LANGUAGE).toLowerCase();
  if (raw.startsWith("vi")) return "vi";
  if (raw.startsWith("en")) return "en";
  return raw.replace(/[^a-z-]/g, "") || "en";
}

function findRemotion(root) {
  const cli = findExecutable(["remotion"]);
  if (cli) return cli;
  const localBin = path.join(root, "node_modules", ".bin", "remotion");
  if (isExecutable(localBin)) return localBin;
  const packageJsonPath = path.join(root, "package.json");
  if (fs.existsSync(packageJsonPath)) {
    try {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
      const deps = {
        ...(packageJson.dependencies || {}),
        ...(packageJson.devDependencies || {}),
      };
      if (deps.remotion || deps["@remotion/cli"]) return "package.json dependency present";
    } catch {
      return null;
    }
  }
  return null;
}

function versionLine(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  const text = `${result.stdout || ""}\n${result.stderr || ""}`.trim();
  return text.split(/\r?\n/).find(Boolean) || command;
}

function existingFile(file) {
  if (!file) return null;
  return fs.existsSync(file) && fs.statSync(file).isFile() ? file : null;
}

function findFirstMedia(dirs, extensions) {
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    const files = walkFiles(dir).filter((file) => extensions.has(path.extname(file).toLowerCase())).sort();
    if (files.length > 0) return files[0];
  }
  return null;
}

function walkFiles(dir, output = []) {
  if (!fs.existsSync(dir)) return output;
  const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(full, output);
    else if (entry.isFile()) output.push(full);
  }
  return output;
}

function hashString(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function pick(items, seed) {
  return items[seed % items.length];
}

function rotate(items, offset) {
  return items.map((_, index) => items[(index + offset) % items.length]);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function distributeDuration(total, count) {
  const base = Math.floor(total / count);
  const remainder = total % count;
  return Array.from({ length: count }, (_, index) => base + (index < remainder ? 1 : 0));
}

function dimensionsForAspectRatio(value) {
  const ratio = String(value || DEFAULT_ASPECT_RATIO);
  if (ratio === "16:9") return { aspectRatio: ratio, width: 1920, height: 1080 };
  if (ratio === "1:1") return { aspectRatio: ratio, width: 1080, height: 1080 };
  return { aspectRatio: "9:16", width: 1080, height: 1920 };
}

function formatClock(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatSrtTime(totalSeconds) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")},000`;
}

function wrapSubtitle(text) {
  return wrapWords(text, 44).join("\n");
}

function wrapWords(text, maxChars) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  for (const word of words) {
    if (!line) {
      line = word;
    } else if (`${line} ${word}`.length <= maxChars) {
      line = `${line} ${word}`;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function titleCase(value) {
  return String(value)
    .replace(/[-_]+/g, " ")
    .trim()
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function slugify(value) {
  const slug = String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "video";
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error("Error: " + (error?.message || String(error)));
    process.exit(1);
  }
}
