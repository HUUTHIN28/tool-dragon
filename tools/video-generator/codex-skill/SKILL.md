---
name: video-generator
description: Use when the user wants Codex to generate local short-form video plans, script artifacts, batch video drafts, or safe ffmpeg render attempts without internet or paid APIs.
metadata:
  short-description: Generate local video pipeline artifacts and draft renders
---

# Video Generator

Use this skill when the user asks to create, generate, plan, batch, or render
short-form videos from a topic/category. This tool is for local deterministic
artifacts, not browser recording. For browser product demos, use the demo-video
tool instead.

## Tool

External CLI:

```bash
/home/thinnh2/.understand-anything/tools/video-generator/video-generator.mjs
```

The CLI does not call an LLM, internet service, paid API, or TTS service. It
creates local artifacts: angle, script, Kokoro placeholder voice manifest,
subtitles `.srt`, scene timeline JSON, metadata JSON, thumbnail SVG, and a render
manifest. If ffmpeg exists but media assets are missing, it renders a generated
9:16 caption video with local espeak narration when available, otherwise silent
audio. If ffmpeg is missing, it creates a placeholder draft instead of failing.

Default target-project output:

```text
video-generator-output/
video-generator-config/
video-generator-assets/
```

## Workflow: generate_video

1. Treat the current workspace as the target root unless the user gives another path.
2. Run a local check when the user asks for render readiness:

```bash
/home/thinnh2/.understand-anything/tools/video-generator/video-generator.mjs check \
  --root <target-root> \
  --pretty
```

3. For a single video, run:

```bash
/home/thinnh2/.understand-anything/tools/video-generator/video-generator.mjs generate-video \
  --root <target-root> \
  --topic "<topic>" \
  --category <ai|beauty|tech|business> \
  --duration <seconds> \
  --pretty
```

4. Read the JSON output and report these fields:
   - `status`
   - `video_path`
   - `thumbnail_path`
   - `metadata_path`
   - `script_path`
   - `subtitles_path`
   - `fallback_reasons`
5. If `status` is `placeholder`, explain that ffmpeg is missing. If `status` is
   `rendered` with generated fallback reasons, explain that no source b-roll or
   voiceover was available, so the tool created a generated caption video and
   local TTS narration when available. Do not ask for internet or paid API keys
   unless the user explicitly requests that integration.

Example:

```bash
/home/thinnh2/.understand-anything/tools/video-generator/video-generator.mjs generate-video \
  --topic "AI Agent Memory" \
  --category ai \
  --duration 60 \
  --pretty
```

## Workflow: generate_batch_videos

1. Use `--category` from the user. If omitted, use `ai`.
2. Use `--count` from the user. If omitted, use the CLI default.
3. Run:

```bash
/home/thinnh2/.understand-anything/tools/video-generator/video-generator.mjs generate-batch-videos \
  --root <target-root> \
  --category <category> \
  --count <count> \
  --pretty
```

4. Report `batch_manifest_path`, number of videos, and the first few `video_path`
   values. Mention placeholder status if real renders were not available.

## Quality Checker

Before marking a video task complete, verify:

- `metadata_path` exists and has `schema_version`, `topic`, `category`,
  `duration_sec`, `artifacts`, and `status`.
- `script_path` exists and has a hook, scene narration, and CTA.
- `subtitles_path` exists and has valid SRT time ranges.
- `scene_timeline_path` exists and scene durations sum to the requested duration.
- `voice_manifest_path` exists and records Kokoro placeholder strategy.
- `thumbnail_path` exists.
- `video_path` exists. It may be a real `.mp4` or a placeholder `.txt` draft.
- If `status` is `rendered`, confirm ffmpeg succeeded and render manifest points
  to the final video.
- If `status` is `placeholder`, confirm `fallback_reasons` explain why.
- If generated fallback assets were used, confirm the MP4 still exists and the
  render manifest records `can_render_mp4: true`.

## Rules

- Prefer Vietnamese output when the user writes Vietnamese, unless they request
  another language.
- Keep operation local and deterministic.
- Do not request paid APIs or API keys for the default flow.
- If ffmpeg is missing and the user asks to make the tool fully render-ready,
  run `npm install` in the tool directory to install `@ffmpeg-installer/ffmpeg`.
- Kokoro TTS is placeholder-only in v1; the tool writes the manifest and silent
  audio strategy.
- Use `init` before larger projects when the target root lacks
  `video-generator-output`, `video-generator-config`, or `video-generator-assets`.
- Keep generated user-project artifacts in the target root, not inside the reusable
  tool directory.
