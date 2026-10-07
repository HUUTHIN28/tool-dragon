#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const SCRIPT_FILE = fileURLToPath(import.meta.url);
const TOOL_ROOT = path.dirname(SCRIPT_FILE);
const requireFromTool = createRequire(import.meta.url);
const DEFAULT_MODEL = "gemini-3.1-flash-tts-preview";
const DEFAULT_VOICE = "Kore";
const DEFAULT_OUTPUT_DIR = "video-voiceover-output";
const DEFAULT_STYLE = "Natural, warm, clear Vietnamese narration with steady pacing and crisp articulation.";
const BOOLEAN_FLAGS = new Set(["help", "pretty", "keep-temp"]);
const AUDIO_MODES = new Set(["mix", "replace"]);
const SUBTITLE_MODES = new Set(["burn", "soft", "both", "sidecar"]);
let geminiApiKeySource = process.env.GEMINI_API_KEY ? "environment" : null;

function printHelp() {
  console.log(`
Gemini Video Voiceover

Usage:
  ${SCRIPT_FILE} check [--root /path/to/project] [--pretty]
  ${SCRIPT_FILE} dry-run --video input.mp4 --script-file narration.txt [options]
  ${SCRIPT_FILE} voiceover --video input.mp4 --script-file narration.txt [options]

Required for voiceover:
  --video            Existing input video.
  --script           Inline narration text, or use --script-file.
  --script-file      UTF-8 plain-text or SRT narration file.
  GEMINI_API_KEY     Gemini API key from the environment or a supported .env file.

Options:
  --root             Target project root. Default: current directory.
  --output           Final MP4 path. Default: a timestamped run directory.
  --model            Gemini TTS model. Default: ${DEFAULT_MODEL}
  --voice            Gemini prebuilt voice. Default: ${DEFAULT_VOICE}
  --style            Natural-language performance direction for Gemini TTS.
  --language         Subtitle language code. Default: vi
  --audio-mode       mix or replace. Default: mix
  --original-volume  Original soundtrack volume in mix mode. Default: 0.18
  --voice-volume     Narration volume. Default: 1.0
  --subtitle-mode    burn, soft, both, or sidecar. Default: both
  --fit-to-video     true or false. Default: true
  --sync-to-srt      true or false. Generate and place each SRT cue separately. Default: false
  --reuse-manifest   Reuse matching raw cue audio from a previous synchronized run.
  --pretty           Pretty-print JSON output.

Examples:
  GEMINI_API_KEY=... ${SCRIPT_FILE} voiceover \
    --video ./input.mp4 --script-file ./narration.txt --voice Kore --pretty

  ${SCRIPT_FILE} dry-run \
    --video ./input.mp4 --script "Xin chào, đây là phần thuyết minh." --pretty
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
    const key = rawKey.replace(/-([a-z])/g, (_, char) => char.toUpperCase());
    let value = true;

    if (eqIndex >= 0) {
      value = token.slice(eqIndex + 1);
    } else if (!BOOLEAN_FLAGS.has(rawKey) && rest[i + 1] && !rest[i + 1].startsWith("--")) {
      value = rest[i + 1];
      i += 1;
    }
    options[key] = value;
  }
  return { command, options };
}

async function main() {
  const { command, options } = parseArgs(process.argv.slice(2));
  geminiApiKeySource = loadGeminiApiKey(resolveRoot(options.root));
  if (command === "help" || options.help) {
    printHelp();
    return;
  }
  if (command === "check") {
    printJson(checkCommand(options), options.pretty);
    return;
  }
  if (command === "dry-run" || command === "voiceover") {
    const result = await voiceoverCommand(options, command === "dry-run");
    printJson(result, options.pretty);
    return;
  }
  throw new Error(`Unknown command: ${command}`);
}

function checkCommand(options) {
  const root = resolveRoot(options.root);
  const ffmpeg = findFfmpeg(root);
  const ffmpegInfo = ffmpeg ? inspectFfmpeg(ffmpeg) : null;
  return {
    status: ffmpeg && process.env.GEMINI_API_KEY ? "ready" : "needs_setup",
    root,
    node: process.version,
    ffmpeg_path: ffmpeg,
    ffmpeg_version: ffmpegInfo?.version ?? null,
    subtitle_burn_supported: ffmpegInfo?.hasSubtitlesFilter ?? false,
    gemini_api_key_configured: Boolean(process.env.GEMINI_API_KEY),
    gemini_api_key_source: geminiApiKeySource,
    gemini_api_key_env: "GEMINI_API_KEY",
    gemini_env_file: path.join(TOOL_ROOT, ".env"),
    default_model: DEFAULT_MODEL,
    default_voice: DEFAULT_VOICE,
    missing: [
      ...(!ffmpeg ? ["ffmpeg"] : []),
      ...(!process.env.GEMINI_API_KEY ? ["GEMINI_API_KEY"] : []),
    ],
  };
}

async function voiceoverCommand(options, dryRun) {
  const root = resolveRoot(options.root);
  const videoPath = resolveRequiredFile(root, options.video, "--video");
  const scriptInput = readScript(root, options);
  const audioMode = String(options.audioMode ?? "mix").toLowerCase();
  const subtitleMode = String(options.subtitleMode ?? "both").toLowerCase();
  const fitToVideo = parseBoolean(options.fitToVideo, true);
  const syncToSrt = parseBoolean(options.syncToSrt, false);
  const originalVolume = parseVolume(options.originalVolume, 0.18, "--original-volume");
  const voiceVolume = parseVolume(options.voiceVolume, 1, "--voice-volume");
  const model = String(options.model ?? DEFAULT_MODEL);
  const voice = String(options.voice ?? DEFAULT_VOICE);
  const language = String(options.language ?? "vi");
  const style = String(options.style ?? DEFAULT_STYLE);
  const reuseManifest = options.reuseManifest
    ? resolveRequiredFile(root, options.reuseManifest, "--reuse-manifest")
    : null;

  if (!AUDIO_MODES.has(audioMode)) {
    throw new Error(`--audio-mode must be one of: ${[...AUDIO_MODES].join(", ")}`);
  }
  if (!SUBTITLE_MODES.has(subtitleMode)) {
    throw new Error(`--subtitle-mode must be one of: ${[...SUBTITLE_MODES].join(", ")}`);
  }
  if (scriptInput.text.length > 24000) {
    throw new Error("Narration is longer than 24,000 characters. Split it into smaller videos or scripts.");
  }
  if (syncToSrt && !scriptInput.isSrt) {
    throw new Error("--sync-to-srt requires an SRT script file with explicit cue timings.");
  }

  const ffmpeg = findFfmpeg(root);
  if (!ffmpeg) {
    throw new Error("ffmpeg is required. Run npm install in the video-voiceover tool directory.");
  }
  const probe = probeMedia(ffmpeg, videoPath);
  if (!probe.durationSec || probe.durationSec <= 0) {
    throw new Error(`Could not determine video duration: ${videoPath}`);
  }

  const runId = `${slug(path.parse(videoPath).name)}-${timestampId()}`;
  const runDir = path.join(root, DEFAULT_OUTPUT_DIR, runId);
  fs.mkdirSync(runDir, { recursive: true });
  const outputPath = options.output
    ? path.resolve(root, String(options.output))
    : path.join(runDir, `${path.parse(videoPath).name}-voiceover.mp4`);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  const subtitlesPath = path.join(runDir, "subtitles.srt");
  const audioPath = path.join(runDir, "gemini-voice.wav");
  const manifestPath = path.join(runDir, "manifest.json");
  const subtitleResult = scriptInput.isSrt
    ? normalizeSrt(scriptInput.raw, probe.durationSec)
    : buildSrt(scriptInput.text, probe.durationSec);
  const subtitleCues = parseSrtCues(subtitleResult.srt, probe.durationSec);
  fs.writeFileSync(subtitlesPath, subtitleResult.srt, "utf8");

  const baseManifest = {
    schema_version: "1.0",
    status: dryRun ? "planned" : "generating",
    provider: "gemini",
    model,
    voice,
    language,
    style,
    input_video_path: videoPath,
    input_script_path: scriptInput.path,
    video_duration_sec: round(probe.durationSec),
    source_has_audio: probe.hasAudio,
    audio_mode: audioMode,
    original_volume: originalVolume,
    voice_volume: voiceVolume,
    subtitle_mode: subtitleMode,
    fit_to_video: fitToVideo,
    sync_to_srt: syncToSrt,
    reuse_manifest_path: reuseManifest,
    output_video_path: outputPath,
    narration_audio_path: audioPath,
    subtitles_path: subtitlesPath,
    subtitle_segments: subtitleResult.segmentCount,
    created_at: new Date().toISOString(),
  };

  if (dryRun) {
    writeJson(manifestPath, baseManifest);
    return {
      status: "planned",
      video_path: outputPath,
      audio_path: audioPath,
      subtitles_path: subtitlesPath,
      manifest_path: manifestPath,
      api_call_made: false,
      cue_count: subtitleCues.length,
      ...pick(baseManifest, ["model", "voice", "video_duration_sec", "source_has_audio", "audio_mode", "subtitle_mode", "sync_to_srt"]),
    };
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(`GEMINI_API_KEY is not configured. Add it to ${path.join(TOOL_ROOT, ".env")} or export it in the environment; never pass it on the command line.`);
  }

  let pcm;
  let syncResult = null;
  if (syncToSrt) {
    syncResult = await generateSrtSyncedNarration({
      apiKey,
      model,
      voice,
      style,
      language,
      ffmpeg,
      cues: subtitleCues,
      runDir,
      audioPath,
      videoDurationSec: probe.durationSec,
      reuseManifest,
    });
    pcm = syncResult.pcm;
  } else {
    const prompt = buildTtsPrompt(scriptInput.text, style, language);
    pcm = await generateGeminiSpeech({ apiKey, model, voice, prompt });
    writeWaveFile(audioPath, pcm.data, pcm.sampleRate ?? 24000, pcm.channels ?? 1, pcm.sampleWidth ?? 2);
  }
  const audioProbe = probeMedia(ffmpeg, audioPath);
  if (!audioProbe.durationSec) {
    throw new Error("Gemini returned audio, but its duration could not be determined.");
  }

  const render = renderVideo({
    ffmpeg,
    videoPath,
    audioPath,
    subtitlesPath,
    outputPath,
    videoDurationSec: probe.durationSec,
    narrationDurationSec: audioProbe.durationSec,
    sourceHasAudio: probe.hasAudio,
    audioMode,
    subtitleMode,
    originalVolume,
    voiceVolume,
    fitToVideo,
    language,
  });

  const manifest = {
    ...baseManifest,
    status: "rendered",
    narration_duration_sec: round(audioProbe.durationSec),
    narration_mime_type: pcm.mimeType,
    narration_sample_rate: pcm.sampleRate ?? 24000,
    api_call_count: syncResult?.apiCallCount ?? 1,
    reused_segment_count: syncResult?.reusedSegmentCount ?? 0,
    synced_segments: syncResult?.segments ?? null,
    ffmpeg_command: render.redactedCommand,
    completed_at: new Date().toISOString(),
  };
  writeJson(manifestPath, manifest);
  return {
    status: "rendered",
    video_path: outputPath,
    audio_path: audioPath,
    subtitles_path: subtitlesPath,
    manifest_path: manifestPath,
    model,
    voice,
    video_duration_sec: round(probe.durationSec),
    narration_duration_sec: round(audioProbe.durationSec),
    source_has_audio: probe.hasAudio,
    audio_mode: audioMode,
    subtitle_mode: subtitleMode,
    sync_to_srt: syncToSrt,
  };
}

async function generateSrtSyncedNarration(config) {
  const {
    apiKey, model, voice, style, language, ffmpeg,
    cues, runDir, audioPath, videoDurationSec, reuseManifest,
  } = config;
  if (!cues.length) throw new Error("SRT does not contain any valid narration cues.");

  const segmentDir = path.join(runDir, "segments");
  fs.mkdirSync(segmentDir, { recursive: true });
  const segments = [];
  const reusableSegments = loadReusableSegments(reuseManifest);
  const usedReusable = new Set();
  let apiCallCount = 0;
  let reusedSegmentCount = 0;

  for (let index = 0; index < cues.length; index += 1) {
    const cue = cues[index];
    const rawPath = path.join(segmentDir, `${pad(index + 1, 3)}-raw.wav`);
    const reusableIndex = reusableSegments.findIndex((item, candidateIndex) => (
      !usedReusable.has(candidateIndex)
      && item.text === cue.text
      && item.raw_audio_path
      && fs.existsSync(item.raw_audio_path)
    ));
    let source = "gemini";
    if (reusableIndex >= 0) {
      fs.copyFileSync(reusableSegments[reusableIndex].raw_audio_path, rawPath);
      usedReusable.add(reusableIndex);
      reusedSegmentCount += 1;
      source = "reused";
    } else {
      const prompt = buildTtsPrompt(cue.text, style, language);
      const generated = await generateGeminiSpeech({ apiKey, model, voice, prompt });
      writeWaveFile(
        rawPath,
        generated.data,
        generated.sampleRate ?? 24000,
        generated.channels ?? 1,
        generated.sampleWidth ?? 2,
      );
      apiCallCount += 1;
    }
    const rawProbe = probeMedia(ffmpeg, rawPath);
    if (!rawProbe.durationSec) {
      throw new Error(`Gemini returned audio for SRT cue ${index + 1}, but its duration could not be determined.`);
    }
    const trimmedPath = path.join(segmentDir, `${pad(index + 1, 3)}-trimmed.wav`);
    trimNarrationSilence(ffmpeg, rawPath, trimmedPath);
    const trimmedProbe = probeMedia(ffmpeg, trimmedPath);
    if (!trimmedProbe.durationSec) {
      throw new Error(`Could not trim narration audio for SRT cue ${index + 1}.`);
    }
    segments.push({
      index: index + 1,
      start_sec: round(cue.startSec),
      end_sec: round(cue.endSec),
      cue_duration_sec: round(cue.endSec - cue.startSec),
      raw_duration_sec: round(rawProbe.durationSec),
      trimmed_duration_sec: round(trimmedProbe.durationSec),
      raw_audio_path: rawPath,
      audio_path: trimmedPath,
      source,
      text: cue.text,
    });
  }

  assembleSrtNarration({ ffmpeg, segments, audioPath, videoDurationSec });
  return {
    pcm: { mimeType: "audio/wav", sampleRate: 24000, channels: 1, sampleWidth: 2 },
    segments,
    apiCallCount,
    reusedSegmentCount,
  };
}

function loadReusableSegments(manifestPath) {
  if (!manifestPath) return [];
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    return Array.isArray(manifest.synced_segments) ? manifest.synced_segments : [];
  } catch (error) {
    throw new Error(`Could not read --reuse-manifest: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function trimNarrationSilence(ffmpeg, inputPath, outputPath) {
  const filter = [
    "silenceremove=start_periods=1:start_silence=0.06:start_threshold=-50dB",
    "areverse",
    "silenceremove=start_periods=1:start_silence=0.10:start_threshold=-50dB",
    "areverse",
  ].join(",");
  const result = spawnSync(ffmpeg, [
    "-y", "-hide_banner", "-loglevel", "error",
    "-i", inputPath,
    "-af", filter,
    "-c:a", "pcm_s16le", "-ar", "24000", "-ac", "1",
    outputPath,
  ], { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
  if (result.status !== 0 || !fs.existsSync(outputPath)) {
    const detail = tail(`${result.stderr ?? ""}\n${result.stdout ?? ""}`, 20);
    throw new Error(`Could not trim narration silence.\n${detail}`);
  }
}

function assembleSrtNarration({ ffmpeg, segments, audioPath, videoDurationSec }) {
  const args = ["-y", "-hide_banner"];
  for (const segment of segments) args.push("-i", segment.audio_path);

  const filters = [];
  const concatLabels = [];
  let cursor = 0;
  let gapIndex = 0;

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    if (segment.start_sec < cursor - 0.01) {
      throw new Error(`SRT cue ${segment.index} overlaps the previous cue; synchronized narration requires non-overlapping cues.`);
    }
    const gap = segment.start_sec - cursor;
    if (gap > 0.01) {
      const gapLabel = `gap${gapIndex}`;
      filters.push(`anullsrc=channel_layout=mono:sample_rate=24000,atrim=duration=${round(gap)},asetpts=PTS-STARTPTS[${gapLabel}]`);
      concatLabels.push(`[${gapLabel}]`);
      gapIndex += 1;
    }

    const cueDuration = segment.end_sec - segment.start_sec;
    const speechWindow = Math.max(0.25, cueDuration - 0.18);
    const tempo = segment.trimmed_duration_sec > speechWindow
      ? segment.trimmed_duration_sec / speechWindow
      : 1;
    const cueFilters = [
      "aformat=sample_rates=24000:channel_layouts=mono",
      ...atempoFilters(tempo),
      "apad",
      `atrim=duration=${round(cueDuration)}`,
      "asetpts=PTS-STARTPTS",
    ];
    filters.push(`[${index}:a:0]${cueFilters.join(",")}[cue${index}]`);
    concatLabels.push(`[cue${index}]`);
    segment.applied_tempo = round(tempo);
    segment.fitted_duration_sec = round(cueDuration);
    cursor = segment.end_sec;
  }

  const tailGap = videoDurationSec - cursor;
  if (tailGap > 0.01) {
    const gapLabel = `gap${gapIndex}`;
    filters.push(`anullsrc=channel_layout=mono:sample_rate=24000,atrim=duration=${round(tailGap)},asetpts=PTS-STARTPTS[${gapLabel}]`);
    concatLabels.push(`[${gapLabel}]`);
  }
  filters.push(`${concatLabels.join("")}concat=n=${concatLabels.length}:v=0:a=1,apad,atrim=duration=${round(videoDurationSec)}[aout]`);

  args.push(
    "-filter_complex", filters.join(";"),
    "-map", "[aout]",
    "-c:a", "pcm_s16le",
    "-ar", "24000",
    "-ac", "1",
    audioPath,
  );
  const result = spawnSync(ffmpeg, args, { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
  if (result.status !== 0 || !fs.existsSync(audioPath)) {
    const detail = tail(`${result.stderr ?? ""}\n${result.stdout ?? ""}`, 40);
    throw new Error(`Could not assemble SRT-synchronized narration.\n${detail}`);
  }
}

function readScript(root, options) {
  if (options.script && options.scriptFile) {
    throw new Error("Use either --script or --script-file, not both.");
  }
  if (options.scriptFile) {
    const scriptPath = path.resolve(root, String(options.scriptFile));
    if (!fs.existsSync(scriptPath) || !fs.statSync(scriptPath).isFile()) {
      throw new Error(`--script-file does not exist: ${scriptPath}`);
    }
    const raw = fs.readFileSync(scriptPath, "utf8").trim();
    if (!raw) throw new Error("Narration script is empty.");
    const isSrt = path.extname(scriptPath).toLowerCase() === ".srt" || looksLikeSrt(raw);
    return { raw, text: isSrt ? stripSrt(raw) : raw, path: scriptPath, isSrt };
  }
  const raw = String(options.script ?? "").trim();
  if (!raw) throw new Error("Provide narration using --script or --script-file.");
  const isSrt = looksLikeSrt(raw);
  return { raw, text: isSrt ? stripSrt(raw) : raw, path: null, isSrt };
}

function buildTtsPrompt(script, style, language) {
  const languageLabel = language.toLowerCase().startsWith("vi") ? "Vietnamese" : language;
  return [
    `Perform the transcript as an exact ${languageLabel} voice-over.`,
    `Director's notes: ${style}`,
    "Do not add, omit, translate, summarize, or comment on any words.",
    "Transcript:",
    script,
  ].join("\n\n");
}

async function generateGeminiSpeech({ apiKey, model, voice, prompt }) {
  const response = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      model,
      input: prompt,
      response_format: { type: "audio" },
      generation_config: {
        speech_config: [{ voice }],
      },
    }),
  });
  const raw = await response.text();
  let json;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error(`Gemini returned non-JSON response (${response.status}).`);
  }
  if (!response.ok) {
    const message = json?.error?.message ?? `HTTP ${response.status}`;
    throw new Error(`Gemini TTS request failed: ${message}`);
  }

  const audio = findAudioPayload(json);
  if (!audio?.data) {
    throw new Error("Gemini TTS response did not contain inline audio data.");
  }
  const buffer = Buffer.from(audio.data, "base64");
  if (!buffer.length) throw new Error("Gemini TTS returned an empty audio payload.");
  return {
    data: isWave(buffer) ? extractWavePcm(buffer) : buffer,
    mimeType: audio.mimeType ?? audio.mime_type ?? "audio/L16",
    sampleRate: Number(audio.sampleRate ?? audio.sample_rate ?? 24000),
    channels: Number(audio.channels ?? 1),
    sampleWidth: 2,
  };
}

function findAudioPayload(value) {
  if (!value || typeof value !== "object") return null;
  if (value.output_audio?.data) return value.output_audio;
  if (value.outputAudio?.data) return value.outputAudio;
  if ((value.type === "audio" || String(value.mimeType ?? value.mime_type ?? "").startsWith("audio/")) && value.data) {
    return value;
  }
  if (value.inlineData?.data && String(value.inlineData.mimeType ?? "").startsWith("audio/")) {
    return value.inlineData;
  }
  for (const child of Array.isArray(value) ? value : Object.values(value)) {
    const found = findAudioPayload(child);
    if (found) return found;
  }
  return null;
}

function renderVideo(config) {
  const {
    ffmpeg, videoPath, audioPath, subtitlesPath, outputPath, videoDurationSec,
    narrationDurationSec, sourceHasAudio, audioMode, subtitleMode,
    originalVolume, voiceVolume, fitToVideo, language,
  } = config;
  const args = ["-y", "-hide_banner", "-i", videoPath, "-i", audioPath];
  const includeSoft = subtitleMode === "soft" || subtitleMode === "both";
  const includeBurn = subtitleMode === "burn" || subtitleMode === "both";
  if (includeSoft) args.push("-i", subtitlesPath);

  const tempo = fitToVideo ? narrationDurationSec / videoDurationSec : 1;
  const narrationFilters = [
    ...atempoFilters(tempo),
    `volume=${voiceVolume}`,
    "apad",
    `atrim=duration=${round(videoDurationSec)}`,
  ];
  let audioFilter;
  if (audioMode === "mix" && sourceHasAudio) {
    audioFilter = [
      `[0:a:0]volume=${originalVolume},atrim=duration=${round(videoDurationSec)}[bg]`,
      `[1:a:0]${narrationFilters.join(",")}[vo]`,
      `[bg][vo]amix=inputs=2:duration=longest:dropout_transition=2[aout]`,
    ].join(";");
  } else {
    audioFilter = `[1:a:0]${narrationFilters.join(",")}[aout]`;
  }
  args.push("-filter_complex", audioFilter, "-map", "0:v:0", "-map", "[aout]");

  if (includeSoft) {
    args.push("-map", "2:0", "-c:s", "mov_text", "-metadata:s:s:0", `language=${subtitleLanguage(language)}`);
  }
  if (includeBurn) {
    const escaped = escapeSubtitleFilterPath(subtitlesPath);
    args.push(
      "-vf",
      `subtitles=filename='${escaped}':force_style='FontName=DejaVu Sans,FontSize=20,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=2,Shadow=0,Alignment=2,MarginV=28'`,
      "-c:v", "libx264", "-preset", "medium", "-crf", "20",
    );
  } else {
    args.push("-c:v", "copy");
  }
  args.push(
    "-c:a", "aac", "-b:a", "192k",
    "-t", String(round(videoDurationSec)),
    "-movflags", "+faststart",
    outputPath,
  );

  const result = spawnSync(ffmpeg, args, { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
  if (result.status !== 0 || !fs.existsSync(outputPath)) {
    const detail = tail(`${result.stderr ?? ""}\n${result.stdout ?? ""}`, 40);
    throw new Error(`ffmpeg render failed.\n${detail}`);
  }
  return { redactedCommand: [ffmpeg, ...args].join(" ") };
}

function buildSrt(text, durationSec) {
  const segments = splitNarration(text);
  const weights = segments.map(segmentWeight);
  const totalWeight = weights.reduce((sum, value) => sum + value, 0) || 1;
  let cursor = 0;
  const entries = segments.map((segment, index) => {
    const remaining = durationSec - cursor;
    const calculated = durationSec * (weights[index] / totalWeight);
    const segmentDuration = index === segments.length - 1 ? remaining : Math.max(0.8, calculated);
    const start = cursor;
    const end = Math.min(durationSec, start + segmentDuration);
    cursor = end;
    return `${index + 1}\n${srtTime(start)} --> ${srtTime(end)}\n${wrapSubtitle(segment)}\n`;
  });
  return { srt: `${entries.join("\n").trim()}\n`, segmentCount: segments.length };
}

function normalizeSrt(raw, durationSec) {
  const normalized = raw.replace(/\r\n/g, "\n").trim();
  const blocks = normalized.split(/\n{2,}/).filter(Boolean);
  const valid = blocks.filter(block => /\d{2}:\d{2}:\d{2},\d{3}\s+-->\s+\d{2}:\d{2}:\d{2},\d{3}/.test(block));
  if (!valid.length) return buildSrt(stripSrt(raw), durationSec);
  return { srt: `${valid.join("\n\n")}\n`, segmentCount: valid.length };
}

function splitNarration(text) {
  const initial = text
    .replace(/\r\n/g, "\n")
    .split(/\n+|(?<=[.!?…])\s+/u)
    .map(value => value.trim())
    .filter(Boolean);
  const result = [];
  for (const item of initial) {
    if (item.length <= 110) {
      result.push(item);
      continue;
    }
    const words = item.split(/\s+/u);
    let current = "";
    for (const word of words) {
      if (current && `${current} ${word}`.length > 90) {
        result.push(current);
        current = word;
      } else {
        current = current ? `${current} ${word}` : word;
      }
    }
    if (current) result.push(current);
  }
  return result.length ? result : [text.trim()];
}

function segmentWeight(value) {
  const words = value.match(/[\p{L}\p{N}]+/gu)?.length ?? 1;
  const punctuationPause = (value.match(/[,;:—–]/g)?.length ?? 0) * 0.35;
  return Math.max(1, words + punctuationPause);
}

function wrapSubtitle(text) {
  if (text.length <= 52) return text;
  const words = text.split(/\s+/u);
  const lines = [];
  let line = "";
  for (const word of words) {
    if (line && `${line} ${word}`.length > 52 && lines.length < 1) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines.join("\n");
}

function looksLikeSrt(value) {
  return /\d{2}:\d{2}:\d{2},\d{3}\s+-->\s+\d{2}:\d{2}:\d{2},\d{3}/.test(value);
}

function parseSrtCues(raw, durationSec) {
  const blocks = raw.replace(/\r\n/g, "\n").trim().split(/\n{2,}/).filter(Boolean);
  const cues = [];
  for (const block of blocks) {
    const lines = block.split("\n");
    const timingIndex = lines.findIndex(line => /-->/.test(line));
    if (timingIndex < 0) continue;
    const match = lines[timingIndex].match(/(\d{2}:\d{2}:\d{2},\d{3})\s+-->\s+(\d{2}:\d{2}:\d{2},\d{3})/);
    if (!match) continue;
    const startSec = parseSrtTime(match[1]);
    const endSec = Math.min(parseSrtTime(match[2]), durationSec);
    const text = lines.slice(timingIndex + 1).join(" ").trim();
    if (!text || endSec <= startSec || startSec >= durationSec) continue;
    cues.push({ startSec, endSec, text });
  }
  return cues;
}

function parseSrtTime(value) {
  const match = String(value).match(/^(\d{2}):(\d{2}):(\d{2}),(\d{3})$/);
  if (!match) throw new Error(`Invalid SRT timestamp: ${value}`);
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(match[4]) / 1000;
}

function stripSrt(raw) {
  return raw
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map(block => block.split("\n").filter(line => !/^\d+$/.test(line.trim()) && !/-->/.test(line)).join(" ").trim())
    .filter(Boolean)
    .join("\n");
}

function srtTime(seconds) {
  const totalMs = Math.max(0, Math.round(seconds * 1000));
  const hours = Math.floor(totalMs / 3600000);
  const minutes = Math.floor((totalMs % 3600000) / 60000);
  const secs = Math.floor((totalMs % 60000) / 1000);
  const ms = totalMs % 1000;
  return `${pad(hours, 2)}:${pad(minutes, 2)}:${pad(secs, 2)},${pad(ms, 3)}`;
}

function atempoFilters(tempo) {
  if (!Number.isFinite(tempo) || Math.abs(tempo - 1) < 0.01) return [];
  const filters = [];
  let value = tempo;
  while (value > 2) {
    filters.push("atempo=2");
    value /= 2;
  }
  while (value < 0.5) {
    filters.push("atempo=0.5");
    value /= 0.5;
  }
  filters.push(`atempo=${value.toFixed(6)}`);
  return filters;
}

function writeWaveFile(file, pcmData, sampleRate, channels, sampleWidth) {
  const dataSize = pcmData.length;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * channels * sampleWidth, 28);
  header.writeUInt16LE(channels * sampleWidth, 32);
  header.writeUInt16LE(sampleWidth * 8, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataSize, 40);
  fs.writeFileSync(file, Buffer.concat([header, pcmData]));
}

function isWave(buffer) {
  return buffer.length > 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WAVE";
}

function extractWavePcm(buffer) {
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString("ascii", offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    if (id === "data") return buffer.subarray(offset + 8, offset + 8 + size);
    offset += 8 + size + (size % 2);
  }
  throw new Error("Gemini returned a WAV file without a PCM data chunk.");
}

function probeMedia(ffmpeg, file) {
  const result = spawnSync(ffmpeg, ["-hide_banner", "-i", file], { encoding: "utf8", maxBuffer: 5 * 1024 * 1024 });
  const output = `${result.stderr ?? ""}\n${result.stdout ?? ""}`;
  const match = output.match(/Duration:\s*(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)/);
  const durationSec = match
    ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])
    : null;
  return { durationSec, hasAudio: /Stream #[^\n]+Audio:/i.test(output), detail: output };
}

function inspectFfmpeg(ffmpeg) {
  const version = spawnSync(ffmpeg, ["-version"], { encoding: "utf8" });
  const filters = spawnSync(ffmpeg, ["-hide_banner", "-filters"], { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
  return {
    version: String(version.stdout ?? version.stderr ?? "").split("\n")[0] || null,
    hasSubtitlesFilter: /\bsubtitles\b/.test(`${filters.stdout ?? ""}\n${filters.stderr ?? ""}`),
  };
}

function findFfmpeg(root) {
  const candidates = [
    process.env.FFMPEG_PATH,
    path.join(TOOL_ROOT, "node_modules", "@ffmpeg-installer", process.platform === "win32" ? "win32-x64" : "linux-x64", process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg"),
    path.join(path.dirname(TOOL_ROOT), "video-generator", "node_modules", "@ffmpeg-installer", process.platform === "win32" ? "win32-x64" : "linux-x64", process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg"),
    path.join(root, "node_modules", "@ffmpeg-installer", process.platform === "win32" ? "win32-x64" : "linux-x64", process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg"),
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  try {
    const installer = requireFromTool("@ffmpeg-installer/ffmpeg");
    if (installer?.path && fs.existsSync(installer.path)) return installer.path;
  } catch {}
  const system = spawnSync("ffmpeg", ["-version"], { encoding: "utf8" });
  return system.status === 0 ? "ffmpeg" : null;
}

function escapeSubtitleFilterPath(value) {
  return path.resolve(value).replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\\'").replace(/,/g, "\\,");
}

function loadGeminiApiKey(root) {
  if (process.env.GEMINI_API_KEY) return "environment";
  const candidates = [...new Set([
    path.join(root, ".env"),
    path.join(TOOL_ROOT, ".env"),
  ])];
  for (const file of candidates) {
    const values = readEnvFile(file);
    if (values.GEMINI_API_KEY) {
      process.env.GEMINI_API_KEY = values.GEMINI_API_KEY;
      return file;
    }
  }
  return null;
}

function readEnvFile(file) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return {};
  const values = {};
  const content = fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const normalized = line.startsWith("export ") ? line.slice(7).trim() : line;
    const separator = normalized.indexOf("=");
    if (separator < 1) continue;
    const key = normalized.slice(0, separator).trim();
    if (key !== "GEMINI_API_KEY") continue;
    let value = normalized.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, "").trim();
    }
    if (value) values[key] = value;
  }
  return values;
}

function subtitleLanguage(value) {
  const normalized = String(value).toLowerCase();
  const map = { vi: "vie", en: "eng", ja: "jpn", ko: "kor", zh: "zho", fr: "fra", de: "deu", es: "spa" };
  return map[normalized] ?? (normalized.length === 3 ? normalized : "und");
}

function resolveRequiredFile(root, value, flag) {
  if (!value) throw new Error(`${flag} is required.`);
  const resolved = path.resolve(root, String(value));
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    throw new Error(`${flag} does not exist: ${resolved}`);
  }
  return resolved;
}

function resolveRoot(value) {
  return path.resolve(value ? String(value) : process.cwd());
}

function parseBoolean(value, fallback) {
  if (value === undefined) return fallback;
  if (typeof value === "boolean") return value;
  if (["1", "true", "yes", "on"].includes(String(value).toLowerCase())) return true;
  if (["0", "false", "no", "off"].includes(String(value).toLowerCase())) return false;
  throw new Error(`Expected a boolean value, received: ${value}`);
}

function parseVolume(value, fallback, flag) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 4) {
    throw new Error(`${flag} must be between 0 and 4.`);
  }
  return parsed;
}

function timestampId() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function slug(value) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "video";
}

function round(value) {
  return Math.round(Number(value) * 1000) / 1000;
}

function pad(value, length) {
  return String(value).padStart(length, "0");
}

function tail(value, lineCount) {
  return String(value).split("\n").slice(-lineCount).join("\n").trim();
}

function pick(source, keys) {
  return Object.fromEntries(keys.map(key => [key, source[key]]));
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function printJson(value, pretty) {
  console.log(JSON.stringify(value, null, pretty ? 2 : 0));
}

main().catch(error => {
  const payload = { status: "error", error: error instanceof Error ? error.message : String(error) };
  console.error(JSON.stringify(payload, null, 2));
  process.exitCode = 1;
});
