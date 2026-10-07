---
name: rag-benchmark
description: Use when the user wants to generate a RAG chatbot benchmark from documentation files, including atomic facts, benchmark questions, expected answers, grading criteria, coverage metrics, and chatbot answer score reports.
metadata:
  short-description: Generate and score RAG chatbot benchmark sets
---

# RAG Benchmark

Use this skill when the user wants to create benchmark questions for a RAG chatbot from documentation files, or wants to grade chatbot answers against a benchmark.

Supported source documents: `.md`, `.mdx`, `.txt`, `.rst`, `.adoc`, `.html`, `.pdf`, `.doc`, `.docx`, `.xls`, `.xlsx`. PDF/Office files are extracted in-memory or in a temp directory; do not create `benchmark/extracted-docs`.

## Tool

External CLI:

```bash
/home/thinnh2/.understand-anything/tools/rag-benchmark/rag-benchmark.mjs
```

The CLI does not call an LLM by itself. `init` prepares clean target files only. When the user asks to generate a benchmark, Codex must continue after `init`: run `context-bundle`, use the prompts in `codex-runner.<language>.md`, fill facts/questions/expected answers/grading criteria in `questions-answers.<language>.json`, then run `validate-bundle`.

Default output inside the target project's `benchmark/` folder:

```text
benchmark/questions-answers.vi.json
benchmark/questions-answers.vi.md
benchmark/codex-runner.vi.md
```

`questions-answers.vi.json` is the clean benchmark result file. Its top-level `benchmarkNotes` must explain question-generation criteria, expected-answer rules, question type ratios, coverage rules, and correctness/grading rules. It must contain source file metadata, facts, questions, expected answers, grading criteria, validation, chatbot answers, grades, and score report. It must NOT contain raw extracted source text.

`questions-answers.vi.md` must start with the same benchmark criteria in human-readable form before the question list.

No other benchmark files should be created for facts, raw questions, chatbot answers, grades, or score reports. Keep those values inside `questions-answers.vi.json`.

The final chatbot evaluation report must be one Markdown file:

```text
report/rag-benchmark-report.md
```

## Workflow: Generate Benchmark

1. Treat the current workspace as the document/project root unless the user gives another path.
2. If the user gives document paths, pass them with `--docs` or as positional paths.
3. Run:

```bash
/home/thinnh2/.understand-anything/tools/rag-benchmark/rag-benchmark.mjs init \
  --root <project-root> \
  --docs <docs-paths> \
  --language vi \
  --question-count <number-of-questions> \
  --min-section-questions 3 \
  --chatbot-url <optional-chatbot-url>
```

If the user asks for a number of questions, pass that value as `--question-count`. If they do not specify a count, use the CLI default.

4. Read `benchmark/codex-runner.vi.md`.
5. Read the generated `benchmark/questions-answers.vi.json`.
6. Run source context command:

```bash
/home/thinnh2/.understand-anything/tools/rag-benchmark/rag-benchmark.mjs context-bundle \
  --bundle benchmark/questions-answers.vi.json \
  --pretty
```

Use this stdout as temporary generation context. Do not write raw source text into `questions-answers.vi.json`.

7. Perform the two LLM passes using prompts in `codex-runner.vi.md`:
   - Fact Extractor pass writes into bundle field `facts`.
   - Question Generator pass writes into bundle field `questions`.
   - Every question must include `question`, `expected_answer`, `covered_fact_ids`, `question_type`, `hop_count`, and `grading_criteria`.
8. Run the validator command:

```bash
/home/thinnh2/.understand-anything/tools/rag-benchmark/rag-benchmark.mjs validate-bundle \
  --bundle benchmark/questions-answers.vi.json \
  --pretty
```

9. Read bundle field `validation` and report:
   - fact coverage
   - section coverage
   - type distribution
   - multi-hop ratio
   - hallucination/unanswerable probe ratio
   - dropped questions and flagged questions
10. If the valid question count does not match the requested count, coverage is weak, or `missing_section_floor` is non-empty, regenerate or supplement bundle field `questions`, then validate again.
11. The benchmark generation task is not complete until `questions-answers.vi.json` contains valid generated questions and `questions-answers.vi.md` shows those questions.

## Workflow: Grade Chatbot Answers

When the user asks Codex to run the chatbot benchmark or to check chatbot quality:

1. Read `benchmark/codex-runner.vi.md`.
2. Read `benchmark/questions-answers.vi.json`, especially fields `validation`, `commands`, and `config.chatbot`.
3. If `validation` is empty, run the Generate Benchmark workflow first.
4. Use MCP Chrome DevTools. This is mandatory for browser chatbot runs.
5. If `config.chatbot.url` is empty, inspect the project, start the local dev server if needed, identify the chatbot route, then navigate with MCP Chrome DevTools.
6. Use MCP snapshot to find the chat input, submit button, and newest assistant response. Prefer selectors from `config.chatbot.selectors` when present.
7. For every question in `validation.questions`, submit the exact question text to the chatbot and capture the newest answer.
8. Save answers in bundle field `chatbotAnswers.answers` inside `questions-answers.vi.json` as:

```json
{
  "answers": [
    {
      "qid": "Q001",
      "question": "...",
      "answer": "...",
      "askedAt": "ISO timestamp",
      "source": "mcp_chrome_devtools",
      "browserEvidence": {
        "url": "http://127.0.0.1:3000/chat",
        "responseSelector": "selector or accessible description"
      }
    }
  ]
}
```

9. Use the Answer Evaluator Prompt in `codex-runner.vi.md`, plus `validation` and `chatbotAnswers`, to produce bundle field `grades.grades` in the same JSON file.
10. Run:

```bash
/home/thinnh2/.understand-anything/tools/rag-benchmark/rag-benchmark.mjs score-bundle \
  --bundle benchmark/questions-answers.vi.json \
  --pretty
```

11. Generate the final Markdown report in the target project's `report/` folder:

```bash
/home/thinnh2/.understand-anything/tools/rag-benchmark/rag-benchmark.mjs report-bundle \
  --bundle benchmark/questions-answers.vi.json
```

12. Report:
   - overall accuracy percentage
   - answerable-question accuracy
   - unanswerable/hallucination-probe accuracy
   - pass rate by question type
   - failed or missing criteria
   - hallucination flags

## Rules

- Do not stop after `init` when the user asked to generate a benchmark. `init` is only preparation.
- Do not let the generator judge coverage. Only `validate-bundle` computes coverage.
- Questions must reference existing fact IDs. Unknown fact IDs are invalid.
- `unanswerable` questions must have `covered_fact_ids: []` and `expected_answer: "NOT_IN_DOCUMENT"`.
- Every generated question should include `grading_criteria`.
- Respect the user's requested question count by passing `--question-count` and checking `metrics.question_count_met`.
- For chatbot browser evaluation, use MCP Chrome DevTools and run every question in bundle field `validation.questions`.
- After scoring, always create `report/rag-benchmark-report.md` in the target project.
- Prefer Vietnamese output when the user writes Vietnamese, unless they request another language.
- Do not place the reusable CLI inside the user's project. The CLI lives at `/home/thinnh2/.understand-anything/tools/rag-benchmark/`.
- Generated benchmark files should live in the target project's `benchmark/` folder and should be limited to `questions-answers.<language>.json`, `questions-answers.<language>.md`, and `codex-runner.<language>.md`.
