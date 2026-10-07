# RAG Benchmark Tool

Tool nay tao benchmark cho RAG chatbot tu file tai lieu va ghi output gon trong folder `benchmark/` cua project dang goi tool.

Mac dinh `init` chi tao 3 file trong `benchmark/`:

- `questions-answers.vi.json`: file ket qua sach. Phan dau file co `benchmarkNotes` noi ro tieu chi sinh cau hoi/dap an, ty le loai cau, coverage rules, va tieu chi cham dung/sai. File nay khong chua raw extracted source text.
- `questions-answers.vi.md`: ban markdown de doc nhanh bo cau hoi. Phan dau file co Benchmark Criteria, Question Type Ratios, Expected Answer Rules, Per-question Grading Fields, va Correctness / Grading Rules.
- `codex-runner.vi.md`: huong dan + prompts de Codex sinh facts/questions, lay context tam thoi, mo MCP Chrome DevTools, hoi chatbot, cham diem, roi tao report.

Report cuoi cung duoc tao thanh 1 file:

- `report/rag-benchmark-report.md`

CLI khong tu goi LLM. Khi Codex dung tool nay cho user, Codex khong duoc dung lai sau `init`; Codex phai chay tiep `context-bundle`, sinh facts/questions/expected_answer/grading_criteria vao `questions-answers.vi.json`, chay `validate-bundle`, va cap nhat `questions-answers.vi.md`.

Extraction:

- PDF dung `pdftotext`.
- DOCX/XLSX dung Python stdlib doc XML/ZIP, khong can dependency npm.
- DOC/XLS cu dung LibreOffice headless neu co.
- `context-bundle` trich xuat source text ra stdout cho Codex dung tam thoi; khong tao `benchmark/extracted-docs` va khong ghi raw text vao `questions-answers.vi.json`.

## Chay Init

```bash
/home/thinnh2/.understand-anything/tools/rag-benchmark/rag-benchmark.mjs init \
  --root /path/to/project \
  --docs docs/ policies.md \
  --language vi \
  --question-count 100 \
  --min-section-questions 3 \
  --chatbot-url http://127.0.0.1:3000/chat
```

## Lay Source Context Tam Thoi

```bash
/home/thinnh2/.understand-anything/tools/rag-benchmark/rag-benchmark.mjs context-bundle \
  --bundle benchmark/questions-answers.vi.json \
  --pretty
```

Lenh nay in extracted source text ra stdout cho Codex sinh facts/questions. Khong tao them file benchmark.

## Validate Cau Hoi

Sau khi Codex/LLM dien `facts` va `questions` vao `benchmark/questions-answers.vi.json`:

```bash
/home/thinnh2/.understand-anything/tools/rag-benchmark/rag-benchmark.mjs validate-bundle \
  --bundle benchmark/questions-answers.vi.json \
  --pretty
```

Lenh nay cap nhat `validation` trong JSON va rewrite `questions-answers.vi.md`.

## Score Chatbot

Sau khi Codex luu cau tra loi chatbot vao `chatbotAnswers.answers` va grade vao `grades.grades` trong cung JSON:

```bash
/home/thinnh2/.understand-anything/tools/rag-benchmark/rag-benchmark.mjs score-bundle \
  --bundle benchmark/questions-answers.vi.json \
  --pretty
```

## Chay Chatbot Bang MCP DevTools Va Tao Report

Khi Codex doc `benchmark/codex-runner.vi.md`, no phai:

1. Doc `benchmark/questions-answers.vi.json`.
2. Neu `facts` hoac `questions` rong, chay `context-bundle`, dung prompt trong runner de sinh facts/questions/expected_answer/grading_criteria.
3. Chay `validate-bundle`.
4. Mo hoac start chatbot web app.
5. Dung MCP Chrome DevTools de navigate vao chatbot.
6. Lay tung cau hoi trong `validation.questions`.
7. Gui vao chatbot, doi cau tra loi, luu vao `chatbotAnswers.answers` trong cung JSON.
8. Dung Answer Evaluator Prompt trong runner de tao `grades.grades` trong cung JSON.
9. Chay `score-bundle`.
10. Chay `report-bundle` de tao file Markdown:

```bash
/home/thinnh2/.understand-anything/tools/rag-benchmark/rag-benchmark.mjs report-bundle \
  --bundle benchmark/questions-answers.vi.json
```

Khong tao them cac file benchmark rieng nhu `facts.json`, `questions.raw.json`, `chatbot-answers.json`, `grades.raw.json`, hay `score-report.json`.
