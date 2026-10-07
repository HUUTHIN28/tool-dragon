# Video Generator Engine

Local-only CLI for deterministic short-form video planning and render fallbacks.
It creates angle, script, voice manifest, subtitles, scene timeline, metadata,
thumbnail artifacts, and MP4 renders when a local ffmpeg binary is available.
It does not call internet services or paid APIs.

## Install

Install the local ffmpeg binary used by the renderer:

```bash
cd /home/thinnh2/.understand-anything/tools/video-generator
npm install
```

## Commands

```bash
/home/thinnh2/.understand-anything/tools/video-generator/video-generator.mjs --help
```

Initialize a target project root:

```bash
/home/thinnh2/.understand-anything/tools/video-generator/video-generator.mjs init \
  --root /path/to/project
```

Create planning artifacts only:

```bash
/home/thinnh2/.understand-anything/tools/video-generator/video-generator.mjs plan \
  --root /path/to/project \
  --topic "AI Agent Memory" \
  --category ai \
  --duration 60 \
  --pretty
```

Generate a full local video result. If ffmpeg exists but media assets are missing,
the command renders a generated 9:16 caption video with local espeak narration
when available, otherwise silent audio. If ffmpeg is missing, it writes a
placeholder draft artifact and JSON manifest instead of failing.

```bash
/home/thinnh2/.understand-anything/tools/video-generator/video-generator.mjs generate-video \
  --root /path/to/project \
  --topic "AI Agent Memory" \
  --category ai \
  --duration 60 \
  --pretty
```

Generate ten category videos:

```bash
/home/thinnh2/.understand-anything/tools/video-generator/video-generator.mjs generate-batch-videos \
  --root /path/to/project \
  --category ai \
  --count 10 \
  --pretty
```

Check local availability:

```bash
/home/thinnh2/.understand-anything/tools/video-generator/video-generator.mjs check \
  --root /path/to/project \
  --pretty
```

## Output

Default target-root folders:

- `video-generator-output/runs/<id>/angle.json`
- `video-generator-output/runs/<id>/script.md`
- `video-generator-output/runs/<id>/voice/voice-manifest.json`
- `video-generator-output/runs/<id>/subtitles.srt`
- `video-generator-output/runs/<id>/scene-timeline.json`
- `video-generator-output/runs/<id>/metadata.json`
- `video-generator-output/runs/<id>/thumbnail.svg`
- `video-generator-output/runs/<id>/render/render-manifest.json`

When ffmpeg rendering succeeds, `video_path` points to `render/final.mp4` and
`status` is `rendered`. When ffmpeg is missing, `video_path` points to
`render/final-video-placeholder.txt` and `status` is `placeholder`.

## Real Render Inputs

For richer ffmpeg rendering, add at least one video file and one audio file under:

```text
video-generator-assets/<category>/
```

or pass them directly:

```bash
/home/thinnh2/.understand-anything/tools/video-generator/video-generator.mjs render \
  --run-dir video-generator-output/runs/ai-ai-agent-memory-60s \
  --video /path/to/background.mp4 \
  --audio /path/to/voiceover.wav
```

If these assets are missing, the renderer creates a generated background and uses
local espeak narration when available. If no TTS binary is available, it falls
back to a silent audio track so MP4 export still completes.

Kokoro TTS is a placeholder provider in v1. The CLI writes a voice manifest and
silent/audio fallback strategy; it does not synthesize narration by itself.
