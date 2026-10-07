# Video To Product Tool

Tool nay giup Codex bien mot video cong nghe/tutorial/demo thanh mot spec san pham roi tiep tuc code ra san pham that. San pham co the la web app, mobile app, CLI, AI agent, n8n workflow, chatbot Messenger/Telegram/Zalo, webhook automation, hoac mot workflow LLM co import/export artifact.

Thiet ke giong `tools/rag-benchmark`: CLI khong tu goi LLM. CLI chi tao bundle, lay transcript/subtitle/notes lam context, validate spec, va sinh prompt build. Codex la phan doc context, dien spec, validate, roi sua code trong project dich.

## Output mac dinh

Trong project dich, tool tao folder:

```text
video-product/
  product-spec.vi.json
  product-spec.vi.md
  codex-runner.vi.md
```

`product-spec.vi.json` la file chinh. No luu:

- video dang gioi thieu san pham gi
- cong nghe/stack nao duoc thay trong video
- UI screens, user flows, data model, API routes
- AI agent/workflow: triggers, nodes, prompts, memory, credentials, integrations, deployment
- build plan va verification steps
- trang thai implementation sau khi Codex code xong

Raw transcript/subtitle khong duoc ghi vao bundle; lenh `context-bundle` in context ra stdout de Codex dung tam thoi.

## Cai dependency vao chinh tool

Chay mot lan:

```bash
/home/thinnh2/.understand-anything/tools/video-to-product/video-to-product.mjs install-deps
```

Lenh nay cai vao trong `tools/video-to-product/`:

- `node_modules/`: `ffmpeg-static`, `tesseract.js`
- `.venv/`: `yt-dlp`, `faster-whisper`
- `models/base/`: faster-whisper model mac dinh de transcribe local

Mac dinh lenh tren cai ca transcription local. Neu muon ban cai nhe hon, bo qua speech-to-text:

```bash
/home/thinnh2/.understand-anything/tools/video-to-product/video-to-product.mjs install-deps --skip-transcription
```

Sau do Codex chi can goi tool. Khi `context-bundle --fetch-subtitles` thay thieu `yt-dlp`, no se tu thu chay cai dependency local truoc. Khi co `--transcribe`, tool tu tai/tach audio va dung local `faster-whisper`.

## Chay nhanh

Neu co transcript/subtitle san:

```bash
/home/thinnh2/.understand-anything/tools/video-to-product/video-to-product.mjs init \
  --root /path/to/project \
  --video "https://youtube.com/watch?v=..." \
  --transcript /path/to/transcript.txt \
  --language vi \
  --target-stack "Next.js, Tailwind, Supabase" \
  --product-goal "Build app chat giong demo trong video"
```

Lay context cho Codex:

```bash
/home/thinnh2/.understand-anything/tools/video-to-product/video-to-product.mjs context-bundle \
  --bundle video-product/product-spec.vi.json
```

Sau khi Codex dien spec vao JSON:

```bash
/home/thinnh2/.understand-anything/tools/video-to-product/video-to-product.mjs validate-bundle \
  --bundle video-product/product-spec.vi.json \
  --pretty
```

Sinh prompt build tu spec:

```bash
/home/thinnh2/.understand-anything/tools/video-to-product/video-to-product.mjs build-prompt \
  --bundle video-product/product-spec.vi.json
```

## Neu chi co YouTube URL

Tool co the thu lay subtitle bang local `yt-dlp`, roi fallback sang local transcription neu them `--transcribe`. Neu dependency chua co, tool se tu cai khi chay lenh nay:

```bash
/home/thinnh2/.understand-anything/tools/video-to-product/video-to-product.mjs context-bundle \
  --bundle video-product/product-spec.vi.json \
  --fetch-subtitles \
  --transcribe
```

`init` tu them `--fetch-subtitles --transcribe` vao command runner khi ban chi dua video URL ma khong dua transcript/subtitle.

## Video AI agent / n8n workflow

Voi video kieu "tao chatbot Messenger tren n8n", Codex khong nen ep thanh web app. Bundle se co them `agentWorkflow`:

```text
agentWorkflow.platform        n8n / LangGraph / CrewAI / custom Node/Python
agentWorkflow.channels        Messenger, Telegram, web chat, email, API webhook
agentWorkflow.triggers        webhook, message received, schedule, manual
agentWorkflow.nodes           cac node/step trong workflow
agentWorkflow.llm             provider, model, system prompt, tools
agentWorkflow.memory          memory/storage/retention
agentWorkflow.integrations    Google Sheets, Facebook Graph API, CRM, Postgres, vector DB
agentWorkflow.workflowArtifacts n8n-workflow.json, docker-compose.yml, .env.example, webhook code
```

Khi build, Codex phai tao artifact chay duoc/import duoc, vi du:

```text
workflows/messenger-sales-agent.n8n.json
docker-compose.yml
.env.example
README.md
scripts/test-webhook.mjs
```

## Gan vao Codex nhu rag-benchmark

Skill nam o:

```text
/home/thinnh2/.understand-anything/tools/video-to-product/codex-skill/SKILL.md
```

De Codex tu nhan tool trong cac phien sau, copy folder skill vao:

```text
~/.codex/skills/video-to-product/SKILL.md
```

Trong phien nay, minh da lam buoc copy nay neu quyen ghi ngoai sandbox duoc cho phep.

## Dung mau nay de tao tool khac

Pattern toi thieu:

```text
tools/my-tool/
  my-tool.mjs
  README.md
  codex-skill/
    SKILL.md
```

Trong `SKILL.md`, tro thang toi CLI bang duong dan tuyet doi, mo ta khi nao Codex phai dung tool, va viet workflow ro rang:

```text
1. Chay CLI init de tao bundle
2. Doc runner/bundle
3. Codex dien noi dung ma CLI khong tu sinh
4. Chay validate
5. Codex tiep tuc lam viec chinh, khong dung o buoc init
```

Sau do cai skill:

```bash
install -D -m 0644 tools/my-tool/codex-skill/SKILL.md ~/.codex/skills/my-tool/SKILL.md
```
