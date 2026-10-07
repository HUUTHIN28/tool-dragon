---
name: demo-video
description: Use when the user wants Codex to plan, record, and export a browser product demo video with optional voiceover. The workflow uses the local Demo Video CLI, Playwright for browser recording, and ffmpeg for final video export.
metadata:
  short-description: Record browser product demo videos
---

# Demo Video

Use this skill when the user asks to create a product demo video, chatbot demo, browser walkthrough,
client demo, sales demo, or narrated screen recording.

## Tool

External CLI:

```bash
/home/thinnh2/plugins/demo-video/scripts/demo-video.mjs
```

The CLI does not call an LLM by itself. Codex is responsible for understanding the user's product,
planning the demo story, and editing the generated plan when needed. The CLI handles local artifacts:
JSON plan, Playwright recording, narration script, subtitles, optional TTS audio, and ffmpeg export.

## Cost Rules

- Default to free/local operation.
- Do not use paid TTS providers unless the user explicitly asks for it or provides an API key for that purpose.
- `provider none` writes a voiceover script and `.srt` subtitles only.
- `provider edge` uses free online Edge TTS with no API key; run `demo-video install-free-tts` first.
- `provider openai` requires `OPENAI_API_KEY` and may cost money.
- `provider espeak` is local/free if `espeak-ng` or `espeak` is installed, but voice quality is basic.
- `--audio-file` can use a narration file the user already recorded.

## Workflow

1. Treat the target app root as the current workspace unless the user gives `--root`.
2. If the app is not already running, inspect the project and start its dev server before recording.
3. Run prerequisite check:

```bash
/home/thinnh2/plugins/demo-video/scripts/demo-video.mjs check --root <project-root>
```

If `playwright` or `ffmpeg` is missing, install bundled tool dependencies once:

```bash
demo-video install-deps
```

This installs Playwright, Chromium, and `ffmpeg-static` inside the demo-video plugin. It does not
install OS-level packages. After installation, run `demo-video check --root <project-root>` again.

For free test voiceover with no API key, install Edge TTS once:

```bash
demo-video install-free-tts
```

Then prefer `--provider edge --voice vi-VN-HoaiMyNeural` for Vietnamese test narration. This
requires internet but does not require an API key.

4. Create a plan:

```bash
/home/thinnh2/plugins/demo-video/scripts/demo-video.mjs plan \
  --root <project-root> \
  --url <app-url> \
  --goal "<demo goal>" \
  --message "<chatbot/customer prompt>" \
  --out demo-video-output/demo-plan.json
```

Use multiple `--message` flags for chatbot demos. If the user describes important features, pass
each one as `--feature`.

5. Read the generated plan and adjust selectors if the app has known CSS/data-testid selectors.
Common fields to adjust:

```json
{
  "config": {
    "selectors": {
      "chatInput": "textarea, input[type='text'], [contenteditable='true']",
      "submitButton": "button[type='submit']",
      "assistantMessage": "[data-role='assistant'], .assistant, .message.assistant"
    }
  }
}
```

6. Record:

```bash
/home/thinnh2/plugins/demo-video/scripts/demo-video.mjs record \
  --root <project-root> \
  --plan demo-video-output/demo-plan.json
```

Use `--headed` when the user wants to watch the browser while recording.

7. Create voiceover assets:

```bash
/home/thinnh2/plugins/demo-video/scripts/demo-video.mjs voiceover \
  --root <project-root> \
  --plan demo-video-output/demo-plan.json \
  --recording-manifest demo-video-output/recording/recording.json \
  --provider edge \
  --voice vi-VN-HoaiMyNeural
```

8. Export:

```bash
/home/thinnh2/plugins/demo-video/scripts/demo-video.mjs export \
  --recording-manifest demo-video-output/recording/recording.json \
  --voiceover-manifest demo-video-output/voiceover/voiceover.json \
  --out demo-final.mp4
```

If `ffmpeg` is missing, run `demo-video install-deps`; the tool uses bundled `ffmpeg-static`.

## One-shot Command

For simple demos, use `make`:

```bash
/home/thinnh2/plugins/demo-video/scripts/demo-video.mjs make \
  --root <project-root> \
  --url <app-url> \
  --goal "<demo goal>" \
  --message "<chatbot/customer prompt>" \
  --out demo-final.mp4
```

The one-shot command still defaults to `--provider none`, so it creates a final video plus script
and subtitle artifacts without paid TTS.

## Review Before Recording

Before recording client-facing output, ensure:

- The app has test/demo data and no private customer data visible.
- The plan avoids passwords, tokens, admin-only data, and destructive actions.
- Login, OTP, CAPTCHA, and payment steps are handled manually or removed from the plan.
- The viewport and language match the intended customer.
- The generated script sounds like a sales/customer demo, not internal engineering notes.

Prefer Vietnamese output when the user writes Vietnamese, unless they request another language.
