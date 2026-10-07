---
name: video-to-product
description: Use when the user explicitly says video-to-product, build-from-video, create a product from a video, or wants Codex to read a technology/tutorial/demo video, infer the product being built, produce a technical product spec, and implement a working app, feature, AI agent, n8n workflow, chatbot automation, webhook workflow, or other runnable/importable product artifact. Do not use for creating, recording, or editing demo videos.
---

# Video To Product

Use this skill when the user wants Codex to understand a video and create the product shown in it, for example: "xem video nay roi build app chat nhu trong video", "doc tutorial video va tao san pham", "video-to-product", "tao app tu video", or "tao workflow n8n/AI agent/chatbot nhu video".

The tool follows the same integration style as `rag-benchmark`: a reusable CLI lives in this repository, and this skill tells Codex how to use it. The CLI does not call an LLM by itself. Codex must continue after the CLI prepares context.

## Guardrail

When this skill triggers, the first task action must be the local CLI workflow below. Do not substitute browser browsing, Chrome DevTools, YouTube page inspection, or the `demo-video` workflow for the CLI. Use browser tools only later for verifying a built web product, not for extracting the video/product spec.

If this skill was installed during the current Codex session and is not in the session's available-skill list yet, start a new Codex chat/session or run the CLI commands manually.

## Tool

External CLI:

```bash
/home/thinnh2/.understand-anything/tools/video-to-product/video-to-product.mjs
```

Default output inside the target project:

```text
video-product/product-spec.vi.json
video-product/product-spec.vi.md
video-product/codex-runner.vi.md
```

`product-spec.vi.json` is the clean build bundle. It should contain the inferred product, stack, UI screens or AI agent workflow, flows, data model, API routes, workflow nodes, prompts, credentials, implementation plan, verification plan, and final implementation status. It must not contain raw transcript text; use `context-bundle` stdout as temporary context.

Dependencies are installed into the tool itself, not globally:

```bash
/home/thinnh2/.understand-anything/tools/video-to-product/video-to-product.mjs ensure-deps
```

`context-bundle --fetch-subtitles --transcribe` auto-runs the local installer if dependencies are missing, tries subtitles first, then falls back to local faster-whisper transcription when no text context exists.

## Workflow: Create Product From Video

1. Treat the current workspace as the target project root unless the user gives another path.
2. If the user gives a transcript, subtitle, notes file, local video path, or URL, pass it into `init`.
3. Run `ensure-deps` when the task starts, or rely on `context-bundle --fetch-subtitles` auto-install for URL-only videos:

```bash
/home/thinnh2/.understand-anything/tools/video-to-product/video-to-product.mjs ensure-deps
```

4. Run:

```bash
/home/thinnh2/.understand-anything/tools/video-to-product/video-to-product.mjs init \
  --root <project-root> \
  --video <video-url-or-file> \
  --transcript <optional-transcript-file> \
  --subtitle <optional-subtitle-file> \
  --notes <optional-notes-file> \
  --language vi \
  --target-stack <optional-stack-hint> \
  --product-goal <what-the-user-wants-built>
```

If the user does not specify language, use Vietnamese when the user writes Vietnamese.

5. Read `video-product/codex-runner.vi.md`.
6. Run the `contextBundle` command from the generated bundle/runner. For URL-only videos this command includes `--fetch-subtitles --transcribe` automatically:

```bash
/home/thinnh2/.understand-anything/tools/video-to-product/video-to-product.mjs context-bundle \
  --bundle video-product/product-spec.vi.json
```

If there is only a video URL and no transcript/subtitle, try:

```bash
/home/thinnh2/.understand-anything/tools/video-to-product/video-to-product.mjs context-bundle \
  --bundle video-product/product-spec.vi.json \
  --fetch-subtitles \
  --transcribe
```

If the fetch fails because of sandboxed network access and fetching subtitles is necessary, rerun with escalated command approval. If subtitles still are not available, ask the user for a transcript/video file or proceed with explicit assumptions from whatever notes are available.

7. Use the temporary context plus the runner prompt to fill these bundle fields:
   - `videoUnderstanding`
   - `productSpec`
   - `agentWorkflow` when the video shows an AI agent, n8n workflow, chatbot automation, webhook workflow, CRM/Sheets agent, or similar non-UI automation
   - `buildPlan`
8. Run:

```bash
/home/thinnh2/.understand-anything/tools/video-to-product/video-to-product.mjs validate-bundle \
  --bundle video-product/product-spec.vi.json \
  --pretty
```

9. If validation has errors, improve the bundle and validate again.
10. Run:

```bash
/home/thinnh2/.understand-anything/tools/video-to-product/video-to-product.mjs build-prompt \
  --bundle video-product/product-spec.vi.json
```

11. Implement the app/feature/agent/workflow in the target project. For AI agent videos, create runnable or importable artifacts such as n8n workflow JSON, docker-compose, `.env.example`, webhook handlers, prompts, schema, setup docs, and test scripts. Do not stop at the spec when the user asked to create the product.
12. Run relevant install/build/test/dev-server checks for the target project.
13. Update bundle field `implementation` with files changed, commands run, dev server URL if any, and status.
14. Run `validate-bundle` once more so `product-spec.vi.md` reflects the final result.

## Rules

- Codex is the builder. The CLI prepares and validates the video-derived spec.
- Prefer building a working equivalent product, not copying proprietary code, workflows, or assets line-for-line from the video.
- Do not force every video into a web app. If the video builds an AI agent or automation workflow, produce workflow artifacts and supporting code/docs instead.
- For n8n-like videos, prefer generating importable n8n workflow JSON plus setup instructions, credential placeholders, and test webhook/message scenarios.
- If video evidence is incomplete, make assumptions explicit in `videoUnderstanding.assumptions` and `videoUnderstanding.unknowns`.
- For code visible in video frames, record only short observations unless the user provides source files or transcript. Do not claim exact code if the video does not show it clearly.
- When the requested product is a web app, start the local dev server after implementation and verify with browser/devtools when feasible.
- Prefer Vietnamese output when the user writes Vietnamese.
- Keep the reusable CLI at `/home/thinnh2/.understand-anything/tools/video-to-product/`; generated spec files belong in the target project's `video-product/` folder.
