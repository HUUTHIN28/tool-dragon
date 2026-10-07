#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const DEFAULT_OUT = "benchmark";
const TEXT_DOC_EXT = /\.(md|mdx|txt|rst|adoc|html?)$/i;
const OFFICE_DOC_EXT = /\.(pdf|doc|docx|xls|xlsx)$/i;
const DOC_EXT = /\.(md|mdx|txt|rst|adoc|html?|pdf|doc|docx|xls|xlsx)$/i;
const QUESTION_TYPE_QUOTAS = Object.freeze({
  factoid: 0.30,
  multi_fact: 0.20,
  cross_section: 0.20,
  conditional: 0.15,
  negation: 0.05,
  aggregation: 0.05,
  unanswerable: 0.05,
});
const QUESTION_TYPES = new Set(Object.keys(QUESTION_TYPE_QUOTAS));

function printHelp() {
  console.log(`
RAG Benchmark Tool

Usage:
  rag-benchmark.mjs init [--root /path/to/project] [--docs docs/ policy.md] [--language vi] [--question-count 50]
  rag-benchmark.mjs context-bundle --bundle benchmark/questions-answers.vi.json
  rag-benchmark.mjs validate-bundle --bundle benchmark/questions-answers.vi.json
  rag-benchmark.mjs score-bundle --bundle benchmark/questions-answers.vi.json
  rag-benchmark.mjs report-bundle --bundle benchmark/questions-answers.vi.json

Legacy standalone commands, optional and not used by the default bundle workflow:
  rag-benchmark.mjs validate --facts facts.json --questions questions.raw.json [--out benchmark.json]
  rag-benchmark.mjs score --benchmark benchmark.json --grades grades.raw.json [--out score-report.json]
  rag-benchmark.mjs report --benchmark benchmark.json --score score-report.json [--out report/rag-benchmark-report.md]

Init options:
  --root                    Project/docs root. Default: current directory
  --out                     Output folder relative to --root. Default: ${DEFAULT_OUT}
  --docs                    Comma-separated docs path list. Positional paths also work
                            Supported: md, mdx, txt, rst, adoc, html, pdf, doc, docx, xls, xlsx
  --language                Target question language. Default: vi
  --question-count          Requested total benchmark questions. Default: 50
  --min-section-questions   Minimum questions per section. Default: 3
  --title                   Optional benchmark title
  --max-files               Max source docs to include. Default: 80
  --max-bytes               Max bytes per source file. Default: 800000
  --chatbot-url             Optional chatbot URL for MCP Chrome DevTools runs
  --chat-input-selector     Optional CSS selector for chatbot input
  --chat-submit-selector    Optional CSS selector for chatbot submit button
  --chat-response-selector  Optional CSS selector for chatbot answer container

Validate options:
  --facts                   facts.json from Fact Extractor
  --questions               questions.raw.json from Question Generator
  --out                     Output benchmark.json. If omitted, prints JSON
  --metrics-out             Optional metrics-only JSON path
  --question-count          Optional expected question count to report in metrics
  --min-section-questions   Minimum section floor. Default: 3
  --pretty                  Pretty-print JSON

Score options:
  --benchmark               benchmark.json from validate
  --grades                  grades.raw.json from LLM evaluator
  --out                     Output score-report.json. If omitted, prints JSON
  --pass-threshold          Score needed to pass a question. Default: 0.8
  --pretty                  Pretty-print JSON

Report options:
  --bundle                  Bundle file. Default for bundle commands: benchmark/questions-answers.vi.json
  --benchmark               benchmark.json from validate
  --score                   score-report.json from score
  --answers                 Optional chatbot-answers.json
  --grades                  Optional grades.raw.json
  --out                     Markdown report path. Default: report/rag-benchmark-report.md
  --title                   Optional report title

Init writes only these files in benchmark/:
  questions-answers.<language>.json
  questions-answers.<language>.md
  codex-runner.<language>.md

context-bundle prints extracted source text to stdout for Codex. It does not create benchmark files.
`);
}

function parseArgs(argv) {
  const command = argv[0] && !argv[0].startsWith("--") ? argv[0] : "init";
  const start = command === argv[0] ? 1 : 0;
  const args = {
    command,
    root: process.cwd(),
    out: command === "init" ? DEFAULT_OUT : "",
    docs: [],
    language: "vi",
    questionCount: null,
    minSectionQuestions: 3,
    title: "",
    maxFiles: 80,
    maxBytes: 800_000,
    pretty: false,
    passThreshold: 0.8,
    chatbotUrl: "",
    chatInputSelector: "",
    chatSubmitSelector: "",
    chatResponseSelector: "",
    reportOut: "report/rag-benchmark-report.md",
  };

  for (let i = start; i < argv.length; i += 1) {
    const item = argv[i];
    if (item === "--help" || item === "-h") {
      args.help = true;
    } else if (item === "--root") {
      args.root = path.resolve(argv[++i]);
    } else if (item === "--out") {
      args.out = argv[++i] || args.out;
    } else if (item === "--docs") {
      args.docs.push(...String(argv[++i] || "").split(",").map((value) => value.trim()).filter(Boolean));
    } else if (item === "--language") {
      args.language = argv[++i] || args.language;
    } else if (item === "--question-count" || item === "--count" || item === "--num-questions") {
      args.questionCount = Number(argv[++i] || args.questionCount);
    } else if (item === "--min-section-questions" || item === "--min-questions-per-section") {
      args.minSectionQuestions = Number(argv[++i] || args.minSectionQuestions);
    } else if (item === "--title") {
      args.title = argv[++i] || "";
    } else if (item === "--max-files") {
      args.maxFiles = Number(argv[++i] || args.maxFiles);
    } else if (item === "--max-bytes") {
      args.maxBytes = Number(argv[++i] || args.maxBytes);
    } else if (item === "--chatbot-url") {
      args.chatbotUrl = argv[++i] || "";
    } else if (item === "--chat-input-selector") {
      args.chatInputSelector = argv[++i] || "";
    } else if (item === "--chat-submit-selector") {
      args.chatSubmitSelector = argv[++i] || "";
    } else if (item === "--chat-response-selector") {
      args.chatResponseSelector = argv[++i] || "";
    } else if (item === "--facts") {
      args.facts = argv[++i];
    } else if (item === "--questions") {
      args.questions = argv[++i];
    } else if (item === "--benchmark") {
      args.benchmark = argv[++i];
    } else if (item === "--bundle") {
      args.bundle = argv[++i];
    } else if (item === "--grades") {
      args.grades = argv[++i];
    } else if (item === "--answers") {
      args.answers = argv[++i];
    } else if (item === "--score") {
      args.score = argv[++i];
    } else if (item === "--metrics-out") {
      args.metricsOut = argv[++i];
    } else if (item === "--pass-threshold") {
      args.passThreshold = Number(argv[++i] || args.passThreshold);
    } else if (item === "--pretty") {
      args.pretty = true;
    } else if (item === "--report-out") {
      args.reportOut = argv[++i] || args.reportOut;
    } else if (item.startsWith("--")) {
      throw new Error("Unknown option: " + item);
    } else {
      args.docs.push(item);
    }
  }

  args.root = path.resolve(args.root);
  if (!Number.isInteger(args.minSectionQuestions) || args.minSectionQuestions < 0) {
    throw new Error("--min-section-questions must be a non-negative integer");
  }
  if (args.command === "init" && args.questionCount === null) {
    args.questionCount = 50;
  }
  if (args.questionCount !== null && (!Number.isInteger(args.questionCount) || args.questionCount < 1)) {
    throw new Error("--question-count must be a positive integer");
  }
  if (!Number.isFinite(args.maxFiles) || args.maxFiles < 1) {
    throw new Error("--max-files must be a positive number");
  }
  if (!Number.isFinite(args.maxBytes) || args.maxBytes < 1) {
    throw new Error("--max-bytes must be a positive number");
  }
  if (!Number.isFinite(args.passThreshold) || args.passThreshold < 0 || args.passThreshold > 1) {
    throw new Error("--pass-threshold must be between 0 and 1");
  }

  return args;
}

function normalize(file) {
  return file.replaceAll("\\", "/");
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

function defaultSkip(name) {
  return [
    ".git",
    "node_modules",
    "dist",
    "build",
    ".next",
    "coverage",
    ".turbo",
    ".understand-anything",
    ".rag-benchmark",
    "benchmark",
  ].includes(name);
}

function walkDocs(dir, root, output = []) {
  if (!fs.existsSync(dir)) return output;
  const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    if (defaultSkip(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkDocs(full, root, output);
    else if (entry.isFile() && DOC_EXT.test(entry.name)) output.push(normalize(path.relative(root, full)));
  }
  return output;
}

function resolveSourceDocs(args) {
  if (!fs.existsSync(args.root) || !fs.statSync(args.root).isDirectory()) {
    throw new Error("Project/docs root does not exist: " + args.root);
  }

  const sources = args.docs.length > 0 ? args.docs : ["."];
  const docs = [];

  for (const source of sources) {
    const full = path.resolve(args.root, source);
    if (!fs.existsSync(full)) {
      throw new Error("Docs path does not exist: " + full);
    }
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      docs.push(...walkDocs(full, args.root));
    } else if (stat.isFile() && DOC_EXT.test(full)) {
      docs.push(normalize(path.relative(args.root, full)));
    }
  }

  const unique = [...new Set(docs)].sort((a, b) => a.localeCompare(b)).slice(0, args.maxFiles);
  if (unique.length === 0) {
    throw new Error("No document files found. Supported: .md, .mdx, .txt, .rst, .adoc, .html, .pdf, .doc, .docx, .xls, .xlsx");
  }
  return unique;
}

function commandExists(command) {
  const result = spawnSync("command", ["-v", command], {
    encoding: "utf8",
    shell: true,
  });
  return result.status === 0;
}

function languageSuffix(language) {
  return String(language || "vi").toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "vi";
}

function questionsAnswersFileBase(language) {
  return `questions-answers.${languageSuffix(language)}`;
}

function runExtractor(command, args, label) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    maxBuffer: 50 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`${label} failed: ${(result.stderr || result.stdout || "").trim()}`);
  }
  return result.stdout || "";
}

function convertWithLibreOffice(full, outDir, convertTo, label) {
  const binary = commandExists("libreoffice") ? "libreoffice" : commandExists("soffice") ? "soffice" : "";
  if (!binary) throw new Error("LibreOffice/soffice not found; cannot extract Office document");
  safeMkdir(outDir);
  const profileDir = path.join(outDir, `.lo-profile-${process.pid}-${Date.now()}`);
  const runtimeDir = path.join(outDir, `.lo-runtime-${process.pid}-${Date.now()}`);
  safeMkdir(profileDir);
  safeMkdir(runtimeDir);
  try {
    fs.chmodSync(runtimeDir, 0o700);
  } catch {
    // Best effort. LibreOffice can still run without strict runtime permissions in many environments.
  }
  const before = new Set(fs.existsSync(outDir) ? fs.readdirSync(outDir) : []);
  const result = spawnSync(binary, [
    "--headless",
    "--nologo",
    "--nofirststartwizard",
    `-env:UserInstallation=${pathToFileURL(profileDir).href}`,
    "--convert-to",
    convertTo,
    "--outdir",
    outDir,
    full,
  ], {
    encoding: "utf8",
    maxBuffer: 50 * 1024 * 1024,
    env: {
      ...process.env,
      HOME: outDir,
      XDG_CONFIG_HOME: outDir,
      XDG_CACHE_HOME: outDir,
      XDG_RUNTIME_DIR: runtimeDir,
      SAL_USE_VCLPLUGIN: "svp",
    },
  });
  if (result.status !== 0) {
    throw new Error(`${label} failed: ${(result.stderr || result.stdout || "").trim()}`);
  }
  const after = fs.readdirSync(outDir)
    .filter((file) => !before.has(file))
    .map((file) => path.join(outDir, file))
    .filter((file) => fs.existsSync(file) && fs.statSync(file).isFile())
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  const output = after[0];
  if (!output) throw new Error(`${label} did not produce an output file`);
  return fs.readFileSync(output, "utf8");
}

function runPythonExtractor(script, full, label) {
  if (!commandExists("python3")) throw new Error("python3 not found; cannot extract " + label);
  const result = spawnSync("python3", ["-c", script, full], {
    encoding: "utf8",
    maxBuffer: 50 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`${label} extraction failed: ${(result.stderr || result.stdout || "").trim()}`);
  }
  return result.stdout || "";
}

const DOCX_EXTRACTOR = String.raw`
import sys, zipfile, xml.etree.ElementTree as ET
path = sys.argv[1]
NS = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
parts = ["word/document.xml"]
with zipfile.ZipFile(path) as z:
    parts += sorted([n for n in z.namelist() if n.startswith("word/header") and n.endswith(".xml")])
    parts += sorted([n for n in z.namelist() if n.startswith("word/footer") and n.endswith(".xml")])
    paragraphs = []
    for part in parts:
        if part not in z.namelist():
            continue
        root = ET.fromstring(z.read(part))
        for p in root.iter(NS + "p"):
            text = []
            for node in p.iter():
                if node.tag == NS + "t" and node.text:
                    text.append(node.text)
                elif node.tag == NS + "tab":
                    text.append("\t")
                elif node.tag == NS + "br":
                    text.append("\n")
            line = "".join(text).strip()
            if line:
                paragraphs.append(line)
print("\n\n".join(paragraphs))
`;

const XLSX_EXTRACTOR = String.raw`
import sys, zipfile, xml.etree.ElementTree as ET, posixpath
path = sys.argv[1]
MAIN = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
REL = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"
PKGREL = "{http://schemas.openxmlformats.org/package/2006/relationships}"

def cell_text(cell, shared):
    typ = cell.attrib.get("t", "")
    if typ == "inlineStr":
        return "".join(t.text or "" for t in cell.iter(MAIN + "t")).strip()
    v = cell.find(MAIN + "v")
    if v is None or v.text is None:
        return ""
    raw = v.text
    if typ == "s":
        try:
            return shared[int(raw)]
        except Exception:
            return raw
    return raw

with zipfile.ZipFile(path) as z:
    names = set(z.namelist())
    shared = []
    if "xl/sharedStrings.xml" in names:
        root = ET.fromstring(z.read("xl/sharedStrings.xml"))
        for si in root.iter(MAIN + "si"):
            shared.append("".join(t.text or "" for t in si.iter(MAIN + "t")))

    rels = {}
    if "xl/_rels/workbook.xml.rels" in names:
        relroot = ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))
        for rel in relroot:
            rid = rel.attrib.get("Id")
            target = rel.attrib.get("Target", "")
            if rid:
                rels[rid] = posixpath.normpath(posixpath.join("xl", target))

    sheets = []
    if "xl/workbook.xml" in names:
        wb = ET.fromstring(z.read("xl/workbook.xml"))
        for sheet in wb.iter(MAIN + "sheet"):
            rid = sheet.attrib.get(REL + "id")
            name = sheet.attrib.get("name", rid or "Sheet")
            target = rels.get(rid)
            if target:
                sheets.append((name, target))
    if not sheets:
        sheets = [(n.rsplit("/", 1)[-1].replace(".xml", ""), n) for n in sorted(names) if n.startswith("xl/worksheets/") and n.endswith(".xml")]

    output = []
    for name, sheet_path in sheets:
        if sheet_path not in names:
            continue
        root = ET.fromstring(z.read(sheet_path))
        rows = []
        width = 0
        for row in root.iter(MAIN + "row"):
            vals = [cell_text(c, shared) for c in row.findall(MAIN + "c")]
            while vals and vals[-1] == "":
                vals.pop()
            if vals:
                width = max(width, len(vals))
                rows.append(vals)
        output.append("# Sheet: " + name)
        if rows:
            for vals in rows:
                vals = vals + [""] * (width - len(vals))
                output.append("| " + " | ".join(v.replace("|", "\\|") for v in vals) + " |")
        output.append("")
print("\n".join(output))
`;

function extractOfficeDocument(root, rel, maxBytes) {
  const full = path.join(root, rel);
  const ext = path.extname(rel).toLowerCase();
  const tempDir = path.join(os.tmpdir(), `rag-benchmark-extract-${process.pid}-${Date.now()}`);
  let content = "";
  let method = "";

  try {
    if (ext === ".pdf") {
      if (!commandExists("pdftotext")) throw new Error("pdftotext not found; cannot extract PDF");
      content = runExtractor("pdftotext", ["-layout", full, "-"], "pdftotext");
      method = "pdftotext -layout";
    } else if (ext === ".docx") {
      content = runPythonExtractor(DOCX_EXTRACTOR, full, "DOCX");
      method = "python3 zipfile DOCX XML extraction";
    } else if (ext === ".xlsx") {
      content = runPythonExtractor(XLSX_EXTRACTOR, full, "XLSX");
      method = "python3 zipfile XLSX XML extraction";
    } else if (ext === ".xls") {
      content = convertWithLibreOffice(full, tempDir, "csv", "LibreOffice spreadsheet conversion");
      method = "libreoffice --convert-to csv";
    } else {
      content = convertWithLibreOffice(full, tempDir, "txt:Text", "LibreOffice document conversion");
      method = "libreoffice --convert-to txt";
    }
  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Temporary extraction cleanup is best effort.
    }
  }

  const truncated = Buffer.byteLength(content, "utf8") > maxBytes;
  const included = truncated ? Buffer.from(content, "utf8").subarray(0, maxBytes).toString("utf8") : content;
  const markdown = [
    `# Extracted document: ${rel}`,
    "",
    `Source format: ${ext.slice(1)}`,
    `Extraction method: ${method}`,
    "",
    "## Extracted text",
    "",
    included.trimEnd(),
    "",
  ].join("\n");

  return {
    content: markdown,
    includedBytes: Buffer.byteLength(markdown, "utf8"),
    truncated,
    extraction: {
      method,
      intermediateFile: null,
      note: "Extracted in memory; no intermediate benchmark file was written.",
    },
  };
}

function readSourceFile(root, rel, maxBytes) {
  const full = path.join(root, rel);
  const stat = fs.statSync(full);
  const ext = path.extname(rel).toLowerCase();

  if (OFFICE_DOC_EXT.test(rel)) {
    const extracted = extractOfficeDocument(root, rel, maxBytes);
    return {
      path: rel,
      bytes: stat.size,
      includedBytes: extracted.includedBytes,
      truncated: extracted.truncated,
      content: extracted.content,
      sourceType: ext.slice(1),
      extraction: extracted.extraction,
    };
  }

  const buffer = fs.readFileSync(full);
  const truncated = buffer.length > maxBytes;
  const content = buffer.subarray(0, maxBytes).toString("utf8");
  return {
    path: rel,
    bytes: stat.size,
    includedBytes: Math.min(buffer.length, maxBytes),
    truncated,
    content,
    sourceType: TEXT_DOC_EXT.test(rel) ? ext.slice(1).replace(".", "") || "text" : "unknown",
    extraction: null,
  };
}

function sourceDocumentsText(files) {
  return files.map((file) => [
    `# FILE: ${file.path}`,
    "",
    file.truncated ? `<!-- Truncated to ${file.includedBytes} bytes from ${file.bytes} bytes. -->` : "",
    file.content.trimEnd(),
    "",
  ].filter((part) => part !== "").join("\n")).join("\n---\n\n");
}

function runId() {
  return "run-" + new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z").replace("T", "-");
}

function factExtractorPrompt() {
  return `# Fact Extractor Prompt

## System

You are a Fact Extractor for a document QA benchmark. Your only job is to decompose a source document into ATOMIC FACTS. You do NOT write questions.

An ATOMIC FACT is a single, independently verifiable statement that cannot be split further without losing meaning. One sentence may contain several atomic facts. Example: "Report a lost card within 24 hours; a backup card may be borrowed for up to 3 days" = TWO facts.

RULES:
1. Extract every atomic fact. Do not summarize, merge, or skip.
2. Each fact must be traceable to exactly one section of the document.
3. Preserve all numbers, durations, deadlines, conditions, and proper nouns verbatim. Never paraphrase a number or named entity.
4. If a fact is conditional ("if X then Y"), keep the condition attached.
5. Do NOT infer facts not explicitly stated in the document.
6. Use stable IDs: S001, S002... for sections and F001, F002... for facts.

OUTPUT: valid JSON only, no markdown fences, no commentary. Schema:

{
  "sections": [
    { "section_id": "S001", "title": "<verbatim section heading>", "source": "<file path>" }
  ],
  "facts": [
    {
      "fact_id": "F001",
      "section_id": "S001",
      "text": "<atomic fact, wording faithful to source>",
      "fact_kind": "scalar | condition | procedure | enumeration | actor_scope"
    }
  ]
}

fact_kind definitions:
- scalar: a single value/duration/threshold.
- condition: a rule with a trigger.
- procedure: an ordered or required action.
- enumeration: one item in a list.
- actor_scope: who or where a policy applies to.

## User

DOCUMENT:
<<<
Paste source context from context-bundle here.
>>>

Extract all atomic facts. Output JSON only.
`;
}

function questionGeneratorPrompt(language, minSectionQuestions, questionCount) {
  return `# Question Generator Prompt

## System

You are a Benchmark Question Generator. You receive a fixed list of atomic facts and the source document. Generate evaluation questions that map ONTO those facts. You may ONLY reference fact_ids that exist in the input.

HARD CONSTRAINTS:
1. Every answerable question must list covered_fact_ids drawn from the provided facts. If you cannot map a question to existing fact_ids, do not write it.
2. expected_answer must be reconstructable from the listed facts alone. Quote numbers, dates, deadlines, entity names, and policy terms verbatim from facts.
3. Every question must contain at least one concrete entity: a document code, a number, a named department, a named procedure, a named policy, or a proper noun. Avoid vague questions such as "what is the policy?"
4. For question_type=unanswerable, covered_fact_ids = [] and the question must be plausibly on-topic but NOT answerable from any fact. expected_answer = "NOT_IN_DOCUMENT".
5. Every question must include grading_criteria so a later LLM judge can grade a chatbot answer without using external knowledge.

QUESTION TYPE QUOTAS:
- factoid        30%   hop_count=1, one fact_id
- multi_fact     20%   hop_count=2+, fact_ids from the SAME section
- cross_section  20%   hop_count=2+, fact_ids from DIFFERENT sections
- conditional    15%   tests escalation, branching, prerequisites, or if/then rules
- negation       5%    asks which case does NOT qualify or is NOT allowed
- aggregation    5%    asks how many, total, full list, or count across facts
- unanswerable   5%    out of scope, no fact maps

COVERAGE REQUIREMENT:
- Generate exactly ${questionCount} questions total unless the facts are too few; if impossible, generate the maximum valid set and explain the shortage in a top-level "notes" array.
- Every section_id must be touched by at least ${minSectionQuestions} answerable questions when possible.
- Maximize unique fact_ids covered. Prefer covering a new fact over re-covering one.

DEDUP:
- Two answerable questions with identical covered_fact_ids sets are duplicates. Keep one.
- For unanswerable questions, deduplicate by normalized question text.

OUTPUT: valid JSON only, no fences, no commentary. Schema:

{
  "questions": [
    {
      "qid": "Q001",
      "question": "<question text, language = ${language}>",
      "expected_answer": "<verbatim-grounded answer | NOT_IN_DOCUMENT>",
      "covered_fact_ids": ["F003", "F004"],
      "source_section_ids": ["S001"],
      "question_type": "factoid | multi_fact | cross_section | conditional | negation | aggregation | unanswerable",
      "hop_count": 1,
      "grading_criteria": {
        "max_score": 1,
        "must_include": [
          "<specific fact, number, entity, condition, or action required for full credit>"
        ],
        "partial_credit": [
          "<acceptable incomplete point, if any>"
        ],
        "must_not_include": [
          "<hallucinated or contradictory claim that should lose credit>"
        ],
        "evidence_fact_ids": ["F003", "F004"]
      }
    }
  ]
}

## User

FACTS:
<<<
Paste questions-answers JSON field facts here.
>>>

DOCUMENT (for phrasing reference only - do NOT introduce facts not in FACTS):
<<<
Paste source context from context-bundle here.
>>>

target_language = ${language}
question_count = ${questionCount}
min_questions_per_section = ${minSectionQuestions}

Generate the benchmark question set. Output JSON only.
`;
}

function answerEvaluatorPrompt() {
  return `# Answer Evaluator Prompt

## System

You are a strict RAG benchmark answer evaluator. You receive benchmark questions, expected answers, grading criteria, and chatbot answers. Grade only against the provided expected_answer and grading_criteria. Do not use external knowledge.

Rules:
1. Score each answer from 0 to 1.
2. Award full credit only when all must_include criteria are satisfied and no must_not_include claim appears.
3. Award partial credit only for criteria listed in partial_credit or clearly implied by must_include.
4. For expected_answer="NOT_IN_DOCUMENT", score 1 only if the chatbot clearly says the answer is not available in the provided documents. Penalize invented facts.
5. Return which criteria were met, which were missing, and any hallucination or contradiction.

OUTPUT: valid JSON only. Schema:

{
  "grades": [
    {
      "qid": "Q001",
      "score": 0.0,
      "passed": false,
      "criteria_results": [
        { "criterion": "<criterion text>", "met": true, "evidence": "<short quote or paraphrase from chatbot answer>" }
      ],
      "missing_criteria": ["<criterion text>"],
      "hallucination_flags": ["<unsupported or contradictory claim>"],
      "rationale": "<brief reason>"
    }
  ]
}

## User

BENCHMARK:
<<<
Paste questions-answers JSON field validation here.
>>>

CHATBOT ANSWERS:
<<<
Paste questions-answers JSON field chatbotAnswers here.
>>>

Grade all answers. Output JSON only.
`;
}

function benchmarkNotes(config = {}) {
  return {
    purpose:
      "Bo benchmark nay dung de do coverage va accuracy cua RAG chatbot. Cau hoi phai bam vao atomic facts, dap an mong doi, va grading criteria.",
    requestedQuestionCount: config.questionCount ?? null,
    targetLanguage: config.language || "vi",
    minimumQuestionsPerSection: config.minSectionQuestions ?? 3,
    questionTypeRatios: {
      factoid: {
        ratio: QUESTION_TYPE_QUOTAS.factoid,
        percent: percent(QUESTION_TYPE_QUOTAS.factoid),
        meaning: "Cau hoi don gian, bam vao 1 fact.",
      },
      multi_fact: {
        ratio: QUESTION_TYPE_QUOTAS.multi_fact,
        percent: percent(QUESTION_TYPE_QUOTAS.multi_fact),
        meaning: "Cau hoi gop nhieu fact trong cung mot section.",
      },
      cross_section: {
        ratio: QUESTION_TYPE_QUOTAS.cross_section,
        percent: percent(QUESTION_TYPE_QUOTAS.cross_section),
        meaning: "Cau hoi can noi fact tu nhieu section khac nhau.",
      },
      conditional: {
        ratio: QUESTION_TYPE_QUOTAS.conditional,
        percent: percent(QUESTION_TYPE_QUOTAS.conditional),
        meaning: "Cau hoi ve dieu kien, leo thang, prerequisite, hoac if/then.",
      },
      negation: {
        ratio: QUESTION_TYPE_QUOTAS.negation,
        percent: percent(QUESTION_TYPE_QUOTAS.negation),
        meaning: "Cau hoi phu dinh: khong duoc, khong ap dung, khong thuoc truong hop nao.",
      },
      aggregation: {
        ratio: QUESTION_TYPE_QUOTAS.aggregation,
        percent: percent(QUESTION_TYPE_QUOTAS.aggregation),
        meaning: "Cau hoi tong hop, dem so luong, liet ke day du, hoac tinh tong.",
      },
      unanswerable: {
        ratio: QUESTION_TYPE_QUOTAS.unanswerable,
        percent: percent(QUESTION_TYPE_QUOTAS.unanswerable),
        meaning: "Cau ngoai tai lieu; dap an dung la NOT_IN_DOCUMENT de do hallucination.",
      },
    },
    generationRules: [
      "Agent 1 phai tach tai lieu thanh atomic facts truoc khi sinh cau hoi.",
      "Moi cau hoi answerable phai gan covered_fact_ids ton tai trong facts.",
      "expected_answer chi duoc suy ra tu covered_fact_ids, khong dung kien thuc ngoai.",
      "Moi cau hoi phai co grading_criteria gom must_include, partial_credit, must_not_include, evidence_fact_ids.",
      "Cau unanswerable phai co covered_fact_ids = [] va expected_answer = NOT_IN_DOCUMENT.",
      "Uu tien phu fact moi va section moi truoc khi hoi lai fact da co.",
    ],
    expectedAnswerRules: [
      "Dap an dung phai duoc tao tu covered_fact_ids, khong tu suy dien ngoai tai lieu.",
      "Giu nguyen so lieu, thoi han, dieu kien, ten rieng, phong ban, quy trinh, va policy term quan trong.",
      "Neu cau hoi gom nhieu fact, expected_answer phai noi du cac fact do theo thu tu logic de chatbot co the bi cham tung phan.",
      "Voi cau hoi phu dinh hoac dieu kien, expected_answer phai noi ro dieu kien ap dung va truong hop khong ap dung neu tai lieu co neu.",
      "Voi cau hoi ngoai tai lieu, expected_answer bat buoc la NOT_IN_DOCUMENT.",
    ],
    perQuestionGradingCriteria: {
      must_include:
        "Danh sach cac y, so lieu, dieu kien, han muc, han thoi gian, ten rieng bat buoc co de dat diem toi da.",
      partial_credit:
        "Cac y co the cho diem mot phan neu chatbot tra loi thieu nhung khong sai.",
      must_not_include:
        "Cac claim sai, bia dat, trai nguoc tai lieu, hoac vuot qua pham vi tai lieu neu xuat hien thi bi tru diem.",
      evidence_fact_ids:
        "Fact IDs lam can cu cham diem; phai khop covered_fact_ids hoac tap con lien quan.",
      max_score: "Mac dinh moi cau toi da 1 diem.",
    },
    deterministicCoverageRules: [
      "Fact coverage = so unique fact_id duoc cau hoi cham toi / tong so facts.",
      "Section coverage = so section_id duoc cau hoi cham toi / tong so sections.",
      "Multi-hop ratio = ty le cau answerable co hop_count >= 2.",
      "Hallucination probe ratio = ty le cau unanswerable.",
      "Coverage do validator tinh bang code, khong de LLM tu ket luan.",
    ],
    correctnessCriteria: {
      fullCredit:
        "Chatbot dat 1 diem khi tra loi du tat ca must_include, khong mau thuan expected_answer, va khong dinh kem thong tin bi cam trong must_not_include.",
      partialCredit:
        "Cho diem mot phan khi cau tra loi chi dat mot phan must_include hoac khop cac muc partial_credit.",
      zeroCredit:
        "Cho 0 diem khi thieu y chinh, sai so lieu/thoi han/dieu kien, hoac bia thong tin trai voi tai lieu.",
      unanswerable:
        "Voi expected_answer = NOT_IN_DOCUMENT, chi dat diem toi da khi chatbot noi ro tai lieu khong co thong tin; neu tu bia dap an thi tru diem.",
      passThreshold: 0.8,
    },
  };
}

function buildManifest(args, outputDir, files) {
  const toolPath = normalize(path.resolve(path.dirname(new URL(import.meta.url).pathname), "rag-benchmark.mjs"));
  const title = args.title || path.basename(args.root);
  const language = languageSuffix(args.language);
  const fileBase = questionsAnswersFileBase(language);
  const artifacts = {
    outputDir: normalize(outputDir),
    bundle: normalize(path.join(outputDir, `${fileBase}.json`)),
    questionsAnswersMarkdown: normalize(path.join(outputDir, `${fileBase}.md`)),
    codexRunnerMarkdown: normalize(path.join(outputDir, `codex-runner.${language}.md`)),
    reportMarkdown: normalize(path.join(args.root, "report", "rag-benchmark-report.md")),
  };
  return {
    schemaVersion: "1.0",
    runId: path.basename(outputDir),
    generatedAt: new Date().toISOString(),
    toolPath,
    project: {
      title,
      root: normalize(args.root),
    },
    config: {
      language: args.language,
      questionCount: args.questionCount,
      minSectionQuestions: args.minSectionQuestions,
      maxFiles: args.maxFiles,
      maxBytesPerFile: args.maxBytes,
      quotas: QUESTION_TYPE_QUOTAS,
      chatbot: {
        url: args.chatbotUrl,
        selectors: {
          input: args.chatInputSelector,
          submit: args.chatSubmitSelector,
          response: args.chatResponseSelector,
        },
      },
    },
    sourceFiles: files.map((file) => ({
      path: file.path,
      sourceType: file.sourceType,
      bytes: file.bytes,
      includedBytes: file.includedBytes,
      truncated: file.truncated,
      extraction: file.extraction,
    })),
    pipeline: [
      "init-questions-answers-bundle",
      "agent-1-extract-atomic-facts",
      "agent-2-generate-fact-mapped-questions",
      "deterministic-validation-and-coverage",
      "optional-chatbot-answer-evaluation",
      "mcp-devtools-chatbot-run",
      "deterministic-score-aggregation",
      "markdown-report-generation",
    ],
    artifacts,
  };
}

function benchmarkBundle(manifest) {
  return {
    schemaVersion: "1.0",
    kind: "rag-questions-answers",
    generatedAt: new Date().toISOString(),
    benchmarkNotes: benchmarkNotes(manifest.config),
    toolPath: manifest.toolPath,
    project: manifest.project,
    config: manifest.config,
    sourceFiles: manifest.sourceFiles,
    artifacts: manifest.artifacts,
    generation: {
      status: "pending",
      sourceContextCommand: `${manifest.toolPath} context-bundle --bundle ${manifest.artifacts.bundle} --pretty`,
      instructions: [
        "Read codex-runner Markdown for the exact generation and chatbot-evaluation workflow.",
        "Run sourceContextCommand when Codex needs extracted source text. Do not paste raw source text into this JSON.",
        "Fill facts.sections, facts.facts, and questions.questions in this file.",
        "Run commands.validate after filling facts/questions.",
      ],
    },
    commands: {
      context: `${manifest.toolPath} context-bundle --bundle ${manifest.artifacts.bundle} --pretty`,
      validateCommand: `${manifest.toolPath} validate-bundle --bundle ${manifest.artifacts.bundle} --pretty`,
      scoreCommand: `${manifest.toolPath} score-bundle --bundle ${manifest.artifacts.bundle} --pretty`,
      reportCommand: `${manifest.toolPath} report-bundle --bundle ${manifest.artifacts.bundle}`,
    },
    facts: {
      sections: [],
      facts: [],
    },
    questions: {
      questions: [],
    },
    validation: null,
    chatbotAnswers: {
      answers: [],
    },
    grades: {
      grades: [],
    },
    scoreReport: null,
    report: {
      markdownPath: manifest.artifacts.reportMarkdown,
    },
  };
}

function selectedQuestions(bundle) {
  return asArray(bundle.validation?.questions).length > 0
    ? asArray(bundle.validation.questions)
    : asArray(bundle.questions?.questions);
}

function formatBenchmarkNotesMarkdown(notes) {
  const typeRows = [
    "| Question type | Target | Meaning |",
    "|---|---:|---|",
  ];
  for (const [type, detail] of Object.entries(notes.questionTypeRatios || {})) {
    typeRows.push(`| ${mdEscape(type)} | ${detail.percent ?? percent(detail.ratio || 0)}% | ${mdEscape(detail.meaning || "")} |`);
  }

  const correctness = notes.correctnessCriteria || {};
  return [
    "## Benchmark Criteria",
    "",
    notes.purpose || "",
    "",
    "| Item | Value |",
    "|---|---:|",
    `| Requested questions | ${notes.requestedQuestionCount ?? "N/A"} |`,
    `| Target language | ${notes.targetLanguage || "vi"} |`,
    `| Minimum questions per section | ${notes.minimumQuestionsPerSection ?? "N/A"} |`,
    "",
    "### Question Type Ratios",
    "",
    typeRows.join("\n"),
    "",
    "### Generation Rules",
    "",
    ...asArray(notes.generationRules).map((rule) => `- ${rule}`),
    "",
    "### Expected Answer Rules",
    "",
    ...asArray(notes.expectedAnswerRules).map((rule) => `- ${rule}`),
    "",
    "### Per-question Grading Fields",
    "",
    `- must_include: ${notes.perQuestionGradingCriteria?.must_include || "N/A"}`,
    `- partial_credit: ${notes.perQuestionGradingCriteria?.partial_credit || "N/A"}`,
    `- must_not_include: ${notes.perQuestionGradingCriteria?.must_not_include || "N/A"}`,
    `- evidence_fact_ids: ${notes.perQuestionGradingCriteria?.evidence_fact_ids || "N/A"}`,
    `- max_score: ${notes.perQuestionGradingCriteria?.max_score || "N/A"}`,
    "",
    "### Deterministic Coverage Rules",
    "",
    ...asArray(notes.deterministicCoverageRules).map((rule) => `- ${rule}`),
    "",
    "### Correctness / Grading Rules",
    "",
    `- Full credit: ${correctness.fullCredit || "N/A"}`,
    `- Partial credit: ${correctness.partialCredit || "N/A"}`,
    `- Zero credit: ${correctness.zeroCredit || "N/A"}`,
    `- Unanswerable: ${correctness.unanswerable || "N/A"}`,
    `- Pass threshold: ${correctness.passThreshold ?? "N/A"}`,
    "",
  ].join("\n");
}

function buildQuestionsAnswersMarkdown(bundle) {
  const questions = selectedQuestions(bundle);
  const metrics = bundle.validation?.metrics;
  const notes = bundle.benchmarkNotes || benchmarkNotes(bundle.config || {});
  const lines = [
    `# ${bundle.project?.title || "RAG Benchmark"} - Questions & Answers`,
    "",
    formatBenchmarkNotesMarkdown(notes),
    `Generated at: ${bundle.updatedAt || bundle.generatedAt || new Date().toISOString()}`,
    "",
    "## Files",
    "",
    `- JSON source of truth: ${bundle.artifacts?.bundle || "questions-answers.vi.json"}`,
    `- Codex runner guide: ${bundle.artifacts?.codexRunnerMarkdown || "codex-runner.vi.md"}`,
    `- Final report: ${bundle.report?.markdownPath || bundle.artifacts?.reportMarkdown || "report/rag-benchmark-report.md"}`,
    "",
    "## Coverage",
    "",
  ];

  if (metrics) {
    lines.push(formatCoverageTable(metrics), "");
  } else {
    lines.push("Coverage is not computed yet. Fill `facts` and `questions`, then run `validate-bundle`.", "");
  }

  lines.push("## Questions", "");

  if (questions.length === 0) {
    lines.push("No questions generated yet.", "");
    return lines.join("\n");
  }

  for (const question of questions) {
    const criteria = question.grading_criteria || {};
    lines.push(
      `### ${question.qid || "Q???"}`,
      "",
      `- Type: ${question.question_type || "unknown"}`,
      `- Hop count: ${question.hop_count ?? "N/A"}`,
      `- Fact IDs: ${asArray(question.covered_fact_ids).join(", ") || "none"}`,
      `- Section IDs: ${asArray(question.source_section_ids).join(", ") || "none"}`,
      "",
      `Question: ${question.question || ""}`,
      "",
      `Expected answer: ${question.expected_answer || ""}`,
      "",
      "Must include:",
      "",
      ...asArray(criteria.must_include).map((item) => `- ${item}`),
      ...(asArray(criteria.must_include).length === 0 ? ["- N/A"] : []),
      "",
      "Partial credit:",
      "",
      ...asArray(criteria.partial_credit).map((item) => `- ${item}`),
      ...(asArray(criteria.partial_credit).length === 0 ? ["- N/A"] : []),
      "",
      "Must not include:",
      "",
      ...asArray(criteria.must_not_include).map((item) => `- ${item}`),
      ...(asArray(criteria.must_not_include).length === 0 ? ["- N/A"] : []),
      "",
    );
  }

  return lines.join("\n");
}

function buildCodexRunnerMarkdown(bundle) {
  const artifacts = bundle.artifacts || {};
  const chatbot = bundle.config?.chatbot || {};
  const selectors = chatbot.selectors || {};
  const bundleFile = artifacts.bundle || "benchmark/questions-answers.vi.json";
  const reportFile = bundle.report?.markdownPath || artifacts.reportMarkdown || "report/rag-benchmark-report.md";
  const contextCommand = bundle.commands?.context || `${bundle.toolPath || "rag-benchmark.mjs"} context-bundle --bundle ${bundleFile} --pretty`;
  const validateCommand = bundle.commands?.validateCommand || `${bundle.toolPath || "rag-benchmark.mjs"} validate-bundle --bundle ${bundleFile} --pretty`;
  const scoreCommand = bundle.commands?.scoreCommand || `${bundle.toolPath || "rag-benchmark.mjs"} score-bundle --bundle ${bundleFile} --pretty`;
  const reportCommand = bundle.commands?.reportCommand || `${bundle.toolPath || "rag-benchmark.mjs"} report-bundle --bundle ${bundleFile}`;
  const sourceRows = asArray(bundle.sourceFiles).map((file) => `- ${file.path} (${file.sourceType || "unknown"})`);

  return [
    `# Codex Runner - ${bundle.project?.title || "RAG Benchmark"}`,
    "",
    "Doc file nay truoc khi generate benchmark hoac truoc khi user yeu cau chay benchmark chatbot.",
    "",
    "## Source Files",
    "",
    `- Questions/answers JSON: ${bundleFile}`,
    `- Human-readable questions: ${artifacts.questionsAnswersMarkdown || "benchmark/questions-answers.vi.md"}`,
    `- Final report output: ${reportFile}`,
    "",
    "Original docs:",
    "",
    ...(sourceRows.length > 0 ? sourceRows : ["- none"]),
    "",
    "## Required Workflow",
    "",
    "1. Read the questions/answers JSON.",
    "2. If `facts` or `questions` are empty, run the source context command below. Use its stdout as temporary context only; do not paste raw source text into the JSON.",
    "3. Use the Fact Extractor Prompt below to fill `facts.sections` and `facts.facts` in the JSON.",
    "4. Use the Question Generator Prompt below to fill `questions.questions` in the JSON. Each question must include expected answer and grading criteria.",
    "5. Run validate command. Fix/regenerate questions until the requested count and coverage checks are acceptable.",
    "6. When running chatbot evaluation, open or start the chatbot web app.",
    "7. Use MCP Chrome DevTools to navigate to the chatbot page.",
    "8. Ask every item in `validation.questions` exactly as written.",
    "9. Capture the newest chatbot answer for each question.",
    "10. Write captured rows into `chatbotAnswers.answers` inside the same JSON file.",
    "11. Use the Answer Evaluator Prompt below with `validation` and `chatbotAnswers` to fill `grades.grades` inside the same JSON file.",
    "12. Run score command.",
    "13. Run report command. The report command must create exactly one Markdown report in the project `report/` folder.",
    "",
    "## Chatbot Target",
    "",
    `- URL: ${chatbot.url || "not provided; inspect the project and start the local app if needed"}`,
    `- Input selector: ${selectors.input || "not provided"}`,
    `- Submit selector: ${selectors.submit || "not provided"}`,
    `- Response selector: ${selectors.response || "not provided"}`,
    "",
    "## Commands",
    "",
    "```bash",
    contextCommand,
    validateCommand,
    scoreCommand,
    reportCommand,
    "```",
    "",
    "## Fact Extractor Prompt",
    "",
    "```text",
    factExtractorPrompt(),
    "```",
    "",
    "## Question Generator Prompt",
    "",
    "```text",
    questionGeneratorPrompt(
      bundle.config?.language || "vi",
      bundle.config?.minSectionQuestions ?? 3,
      bundle.config?.questionCount ?? 50,
    ),
    "```",
    "",
    "## Answer Evaluator Prompt",
    "",
    "```text",
    answerEvaluatorPrompt(),
    "```",
    "",
    "## Output Contract",
    "",
    "- `questions-answers.vi.json` must contain questions, expected answers, grading criteria, validation, chatbot answers, grades, and score report.",
    "- Do not store raw extracted source text in `questions-answers.vi.json`.",
    "- Keep the readable question set in the questions/answers Markdown file.",
    "- Do not create extra benchmark JSON files for facts, prompts, answers, grades, or score reports.",
    "- Put the final chatbot evaluation report at the report path above.",
    "",
  ].join("\n");
}

function markdownPathFromBundlePath(file, suffix) {
  const parsed = path.parse(file);
  return path.join(parsed.dir, `${parsed.name}${suffix}`);
}

function questionsAnswersMarkdownPath(args, bundle) {
  return path.resolve(args.root, bundle.artifacts?.questionsAnswersMarkdown || markdownPathFromBundlePath(bundlePath(args), ".md"));
}

function codexRunnerMarkdownPath(args, bundle) {
  const language = languageSuffix(bundle.config?.language || args.language);
  return path.resolve(args.root, bundle.artifacts?.codexRunnerMarkdown || path.join(path.dirname(bundlePath(args)), `codex-runner.${language}.md`));
}

function refreshBenchmarkMarkdownFiles(args, bundle) {
  writeText(questionsAnswersMarkdownPath(args, bundle), buildQuestionsAnswersMarkdown(bundle));
  writeText(codexRunnerMarkdownPath(args, bundle), buildCodexRunnerMarkdown(bundle));
}

function initRun(args) {
  const outputDir = path.resolve(args.root, args.out);
  const relDocs = resolveSourceDocs(args);
  safeMkdir(outputDir);
  const files = relDocs.map((rel) => readSourceFile(args.root, rel, args.maxBytes));

  const manifest = buildManifest(args, outputDir, files);
  const bundle = benchmarkBundle(manifest, files);
  writeJson(manifest.artifacts.bundle, bundle, true);
  writeText(manifest.artifacts.questionsAnswersMarkdown, buildQuestionsAnswersMarkdown(bundle));
  writeText(manifest.artifacts.codexRunnerMarkdown, buildCodexRunnerMarkdown(bundle));

  console.log("Da sinh RAG benchmark folder: " + outputDir);
  console.log("Tai lieu: " + files.length + " file");
  console.log("So cau hoi yeu cau: " + args.questionCount);
  console.log("Questions/answers JSON: " + manifest.artifacts.bundle);
  console.log("Questions/answers Markdown: " + manifest.artifacts.questionsAnswersMarkdown);
  console.log("Codex runner guide: " + manifest.artifacts.codexRunnerMarkdown);
  return manifest;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeIdList(value) {
  return [...new Set(asArray(value).filter((id) => typeof id === "string" && id.trim()).map((id) => id.trim()))];
}

function normalizeText(value) {
  return String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
}

function stableId(prefix, index) {
  return `${prefix}${String(index + 1).padStart(3, "0")}`;
}

function safeRatio(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : 0;
}

function percent(ratio) {
  return Math.round(ratio * 10000) / 100;
}

function sortedUnique(values) {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function arraysEqual(a, b) {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function hasConcreteEntity(text) {
  const value = String(text || "");
  return (
    /\d/u.test(value) ||
    /\b[A-Z]{2,}[A-Z0-9]*(?:[-_/][A-Z0-9]+)+\b|\b[A-Z]{2,}\d+\b/u.test(value) ||
    /(?:^|[^\p{L}\p{M}])\p{Lu}[\p{L}\p{M}0-9]*(?:\s+\p{Lu}[\p{L}\p{M}0-9]*)+/u.test(value)
  );
}

function hasUsableCriteria(question) {
  const criteria = question.grading_criteria;
  if (!criteria || typeof criteria !== "object" || Array.isArray(criteria)) return false;
  const mustInclude = asArray(criteria.must_include).filter((item) => typeof item === "string" && item.trim());
  const evidence = normalizeIdList(criteria.evidence_fact_ids);
  return mustInclude.length > 0 || question.question_type === "unanswerable" || evidence.length > 0;
}

function dedupKey(question) {
  if (question.question_type === "unanswerable") return "unanswerable:" + normalizeText(question.question);
  return "facts:" + [...question.covered_fact_ids].sort((a, b) => a.localeCompare(b)).join("|");
}

function buildSectionIndex(factsDoc) {
  const sections = [];
  const seen = new Set();
  for (const section of asArray(factsDoc.sections)) {
    if (!section || typeof section.section_id !== "string" || !section.section_id.trim()) continue;
    const id = section.section_id.trim();
    if (seen.has(id)) continue;
    seen.add(id);
    sections.push({ ...section, section_id: id, title: typeof section.title === "string" ? section.title : id });
  }
  for (const fact of asArray(factsDoc.facts)) {
    if (!fact || typeof fact.section_id !== "string" || !fact.section_id.trim()) continue;
    const id = fact.section_id.trim();
    if (seen.has(id)) continue;
    seen.add(id);
    sections.push({ section_id: id, title: id });
  }
  return new Map(sections.map((section) => [section.section_id, section]));
}

function buildFactIndex(factsDoc, sectionsById) {
  const facts = [];
  const seen = new Set();
  for (const fact of asArray(factsDoc.facts)) {
    if (!fact || typeof fact.fact_id !== "string" || !fact.fact_id.trim()) continue;
    const id = fact.fact_id.trim();
    if (seen.has(id)) continue;
    seen.add(id);
    const sectionId = typeof fact.section_id === "string" && fact.section_id.trim() ? fact.section_id.trim() : "UNKNOWN_SECTION";
    if (!sectionsById.has(sectionId)) sectionsById.set(sectionId, { section_id: sectionId, title: sectionId });
    facts.push({
      ...fact,
      fact_id: id,
      section_id: sectionId,
      text: typeof fact.text === "string" ? fact.text : "",
      fact_kind: typeof fact.fact_kind === "string" ? fact.fact_kind : "scalar",
    });
  }
  return new Map(facts.map((fact) => [fact.fact_id, fact]));
}

function normalizeQuestion(rawQuestion, index, factsById) {
  const qid = typeof rawQuestion.qid === "string" && rawQuestion.qid.trim() ? rawQuestion.qid.trim() : stableId("Q", index);
  const coveredFactIds = normalizeIdList(rawQuestion.covered_fact_ids);
  const derivedSectionIds = sortedUnique(coveredFactIds.map((factId) => factsById.get(factId)?.section_id).filter(Boolean));
  const sourceSectionIds = normalizeIdList(rawQuestion.source_section_ids);
  const hopCount = Number.isFinite(Number(rawQuestion.hop_count)) ? Math.max(0, Number(rawQuestion.hop_count)) : coveredFactIds.length;
  return {
    ...rawQuestion,
    qid,
    question: typeof rawQuestion.question === "string" ? rawQuestion.question : "",
    expected_answer: typeof rawQuestion.expected_answer === "string" ? rawQuestion.expected_answer : "",
    covered_fact_ids: coveredFactIds,
    source_section_ids: derivedSectionIds.length > 0 ? derivedSectionIds : sourceSectionIds,
    question_type: typeof rawQuestion.question_type === "string" ? rawQuestion.question_type.trim() : "",
    hop_count: hopCount,
    _derived_section_ids: derivedSectionIds,
  };
}

function collectQuestionFlags(question, factsById) {
  const flags = [];
  const covered = question.covered_fact_ids;
  const sections = question._derived_section_ids;
  const factKinds = covered.map((factId) => factsById.get(factId)?.fact_kind).filter(Boolean);

  if (!question.expected_answer.trim()) flags.push("missing_expected_answer");
  if (!hasUsableCriteria(question)) flags.push("missing_or_weak_grading_criteria");
  if (!hasConcreteEntity(question.question)) flags.push("missing_concrete_entity");
  if (!arraysEqual(normalizeIdList(question.source_section_ids), sections)) flags.push("source_section_ids_mismatch");

  if (question.question_type === "factoid") {
    if (covered.length !== 1 || question.hop_count !== 1) flags.push("factoid_must_cover_one_fact");
  } else if (question.question_type === "multi_fact") {
    if (covered.length < 2 || sections.length !== 1 || question.hop_count < 2) flags.push("multi_fact_must_cover_two_plus_facts_same_section");
  } else if (question.question_type === "cross_section") {
    if (covered.length < 2 || sections.length < 2 || question.hop_count < 2) flags.push("cross_section_must_cover_two_plus_facts_different_sections");
  } else if (question.question_type === "conditional") {
    const hasConditionalFact = factKinds.some((kind) => kind === "condition" || kind === "procedure");
    const hasConditionalWords = /\b(if|when|unless|case|condition|khi|neu|nếu|truong hop|trường hợp|lan|lần)\b/iu.test(question.question);
    if (!hasConditionalFact && !hasConditionalWords) flags.push("conditional_question_lacks_condition_signal");
  } else if (question.question_type === "unanswerable" && question.hop_count !== 0) {
    flags.push("unanswerable_should_have_zero_hops");
  }

  return flags;
}

export function validateBenchmark(factsDoc, questionsDoc, options = {}) {
  const minSectionQuestions = Number.isInteger(options.minSectionQuestions) ? options.minSectionQuestions : 3;
  const requestedQuestionCount = Number.isInteger(options.questionCount) && options.questionCount > 0 ? options.questionCount : null;
  const sectionsById = buildSectionIndex(factsDoc);
  const factsById = buildFactIndex(factsDoc, sectionsById);
  const allSectionIds = [...sectionsById.keys()].sort((a, b) => a.localeCompare(b));
  const allFactIds = [...factsById.keys()].sort((a, b) => a.localeCompare(b));
  const validQuestions = [];
  const droppedQuestions = [];
  const flaggedQuestions = [];
  const seenDedupKeys = new Set();

  for (const [index, rawQuestion] of asArray(questionsDoc.questions).entries()) {
    if (!rawQuestion || typeof rawQuestion !== "object" || Array.isArray(rawQuestion)) {
      droppedQuestions.push({ qid: stableId("Q", index), reason: "question_is_not_an_object" });
      continue;
    }
    const question = normalizeQuestion(rawQuestion, index, factsById);
    const dropReasons = [];

    if (!QUESTION_TYPES.has(question.question_type)) dropReasons.push("unknown_question_type");

    if (question.question_type === "unanswerable") {
      if (question.covered_fact_ids.length !== 0) dropReasons.push("unanswerable_must_not_cover_facts");
      if (question.expected_answer !== "NOT_IN_DOCUMENT") dropReasons.push("unanswerable_expected_answer_must_be_NOT_IN_DOCUMENT");
    } else {
      if (question.covered_fact_ids.length === 0) dropReasons.push("answerable_question_must_cover_at_least_one_fact");
      const unknownFactIds = question.covered_fact_ids.filter((factId) => !factsById.has(factId));
      if (unknownFactIds.length > 0) dropReasons.push("unknown_fact_ids:" + unknownFactIds.join(","));
    }

    const key = dedupKey(question);
    if (seenDedupKeys.has(key)) dropReasons.push("duplicate_question");
    if (dropReasons.length > 0) {
      droppedQuestions.push({ qid: question.qid, question: question.question, reason: dropReasons.join(";") });
      continue;
    }

    seenDedupKeys.add(key);
    const flags = collectQuestionFlags(question, factsById);
    const { _derived_section_ids: _derivedSectionIds, ...cleanQuestion } = question;
    cleanQuestion.validation_flags = flags;
    validQuestions.push(cleanQuestion);
    if (flags.length > 0) flaggedQuestions.push({ qid: question.qid, flags });
  }

  const coveredFacts = new Set();
  const touchedSections = new Set();
  const typeCounts = Object.fromEntries(Object.keys(QUESTION_TYPE_QUOTAS).map((type) => [type, 0]));
  const sectionQuestionCounts = Object.fromEntries(allSectionIds.map((sectionId) => [sectionId, 0]));
  let answerableCount = 0;
  let multiHopCount = 0;

  for (const question of validQuestions) {
    typeCounts[question.question_type] = (typeCounts[question.question_type] || 0) + 1;
    if (question.question_type === "unanswerable") continue;
    answerableCount += 1;
    if (question.hop_count >= 2) multiHopCount += 1;
    for (const factId of question.covered_fact_ids) coveredFacts.add(factId);
    for (const sectionId of question.source_section_ids) {
      touchedSections.add(sectionId);
      sectionQuestionCounts[sectionId] = (sectionQuestionCounts[sectionId] || 0) + 1;
    }
  }

  const typeDistribution = {};
  for (const [type, targetRatio] of Object.entries(QUESTION_TYPE_QUOTAS)) {
    const count = typeCounts[type] || 0;
    typeDistribution[type] = {
      count,
      ratio: safeRatio(count, validQuestions.length),
      percent: percent(safeRatio(count, validQuestions.length)),
      target_ratio: targetRatio,
      target_percent: percent(targetRatio),
    };
  }

  const missingSectionFloor = Object.entries(sectionQuestionCounts)
    .filter(([, count]) => count < minSectionQuestions)
    .map(([section_id, count]) => ({ section_id, count, needed: minSectionQuestions - count }));

  const factCoverageRatio = safeRatio(coveredFacts.size, allFactIds.length);
  const sectionCoverageRatio = safeRatio(touchedSections.size, allSectionIds.length);
  const multiHopRatio = safeRatio(multiHopCount, answerableCount);
  const unanswerableCount = typeCounts.unanswerable || 0;
  const hallucinationProbeRatio = safeRatio(unanswerableCount, validQuestions.length);

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    questions: validQuestions,
    dropped_questions: droppedQuestions,
    flagged_questions: flaggedQuestions,
    metrics: {
      min_section_questions: minSectionQuestions,
      total_sections: allSectionIds.length,
      total_facts: allFactIds.length,
      total_questions_input: asArray(questionsDoc.questions).length,
      total_questions_valid: validQuestions.length,
      requested_question_count: requestedQuestionCount,
      question_count_delta: requestedQuestionCount === null ? null : validQuestions.length - requestedQuestionCount,
      question_count_met: requestedQuestionCount === null ? null : validQuestions.length === requestedQuestionCount,
      total_questions_dropped: droppedQuestions.length,
      total_questions_flagged: flaggedQuestions.length,
      answerable_questions: answerableCount,
      unanswerable_questions: unanswerableCount,
      unique_fact_ids_covered: coveredFacts.size,
      section_ids_touched: touchedSections.size,
      fact_coverage: { ratio: factCoverageRatio, percent: percent(factCoverageRatio) },
      section_coverage: { ratio: sectionCoverageRatio, percent: percent(sectionCoverageRatio) },
      type_distribution: typeDistribution,
      multi_hop_ratio: { ratio: multiHopRatio, percent: percent(multiHopRatio) },
      hallucination_probe_ratio: { ratio: hallucinationProbeRatio, percent: percent(hallucinationProbeRatio) },
      section_question_counts: sectionQuestionCounts,
      missing_section_floor: missingSectionFloor,
    },
  };
}

function clampScore(value) {
  const score = Number(value);
  if (!Number.isFinite(score)) return null;
  return Math.max(0, Math.min(1, score));
}

function buildQuestionIndex(benchmarkDoc) {
  const questions = asArray(benchmarkDoc.questions).filter((question) => question && typeof question.qid === "string" && question.qid.trim());
  return new Map(questions.map((question) => [question.qid.trim(), question]));
}

function criteriaStats(grade) {
  const results = asArray(grade.criteria_results);
  return {
    total: results.length,
    met: results.filter((result) => result && result.met === true).length,
  };
}

export function scoreGrades(benchmarkDoc, gradesDoc, options = {}) {
  const passThreshold = Number.isFinite(options.passThreshold) ? options.passThreshold : 0.8;
  const questionsById = buildQuestionIndex(benchmarkDoc);
  const allQuestions = [...questionsById.values()];
  const invalidGrades = [];
  const scoredGrades = [];
  const seenQids = new Set();

  for (const [index, rawGrade] of asArray(gradesDoc.grades).entries()) {
    if (!rawGrade || typeof rawGrade !== "object" || Array.isArray(rawGrade)) {
      invalidGrades.push({ index, reason: "grade_is_not_an_object" });
      continue;
    }
    const qid = typeof rawGrade.qid === "string" ? rawGrade.qid.trim() : "";
    if (!qid) {
      invalidGrades.push({ index, reason: "missing_qid" });
      continue;
    }
    const question = questionsById.get(qid);
    if (!question) {
      invalidGrades.push({ qid, reason: "unknown_qid" });
      continue;
    }
    const score = clampScore(rawGrade.score);
    if (score === null) {
      invalidGrades.push({ qid, reason: "score_is_not_numeric" });
      continue;
    }
    seenQids.add(qid);
    scoredGrades.push({
      ...rawGrade,
      qid,
      score,
      passed: typeof rawGrade.passed === "boolean" ? rawGrade.passed : score >= passThreshold,
      question_type: question.question_type,
      is_unanswerable: question.question_type === "unanswerable",
    });
  }

  const missingQids = allQuestions.map((question) => question.qid).filter((qid) => !seenQids.has(qid));
  const scoredByQid = new Map(scoredGrades.map((grade) => [grade.qid, grade]));
  const scoreForQuestion = (question) => scoredByQid.get(question.qid)?.score || 0;
  const passForQuestion = (question) => scoreForQuestion(question) >= passThreshold;
  const answerableQuestions = allQuestions.filter((question) => question.question_type !== "unanswerable");
  const unanswerableQuestions = allQuestions.filter((question) => question.question_type === "unanswerable");

  const byType = {};
  for (const question of allQuestions) {
    const type = question.question_type || "unknown";
    byType[type] ||= { count: 0, graded_count: 0, score_sum: 0, pass_count: 0 };
    byType[type].count += 1;
    const grade = scoredByQid.get(question.qid);
    if (grade) {
      byType[type].graded_count += 1;
      byType[type].score_sum += grade.score;
    }
    if (passForQuestion(question)) byType[type].pass_count += 1;
  }

  for (const [type, summary] of Object.entries(byType)) {
    const averageScore = safeRatio(summary.score_sum, summary.count);
    byType[type] = {
      count: summary.count,
      graded_count: summary.graded_count,
      missing_count: summary.count - summary.graded_count,
      average_score: averageScore,
      average_percent: percent(averageScore),
      pass_rate: safeRatio(summary.pass_count, summary.count),
      pass_percent: percent(safeRatio(summary.pass_count, summary.count)),
    };
  }

  let criteriaTotal = 0;
  let criteriaMet = 0;
  let hallucinationFlagCount = 0;
  for (const grade of scoredGrades) {
    const stats = criteriaStats(grade);
    criteriaTotal += stats.total;
    criteriaMet += stats.met;
    hallucinationFlagCount += asArray(grade.hallucination_flags).length;
  }

  const overallAccuracy = safeRatio(allQuestions.reduce((sum, question) => sum + scoreForQuestion(question), 0), allQuestions.length);
  const answerableAccuracy = safeRatio(answerableQuestions.reduce((sum, question) => sum + scoreForQuestion(question), 0), answerableQuestions.length);
  const unanswerableAccuracy = safeRatio(unanswerableQuestions.reduce((sum, question) => sum + scoreForQuestion(question), 0), unanswerableQuestions.length);
  const passRate = safeRatio(allQuestions.filter(passForQuestion).length, allQuestions.length);
  const criteriaRatio = safeRatio(criteriaMet, criteriaTotal);

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    pass_threshold: passThreshold,
    metrics: {
      total_questions: allQuestions.length,
      graded_questions: scoredGrades.length,
      missing_grade_count: missingQids.length,
      invalid_grade_count: invalidGrades.length,
      overall_accuracy: { ratio: overallAccuracy, percent: percent(overallAccuracy) },
      answerable_accuracy: { ratio: answerableAccuracy, percent: percent(answerableAccuracy) },
      unanswerable_accuracy: { ratio: unanswerableAccuracy, percent: percent(unanswerableAccuracy) },
      pass_rate: { ratio: passRate, percent: percent(passRate) },
      criteria_met_ratio: { ratio: criteriaRatio, percent: percent(criteriaRatio), met: criteriaMet, total: criteriaTotal },
      hallucination_flag_count: hallucinationFlagCount,
      by_type: byType,
    },
    missing_qids: missingQids,
    invalid_grades: invalidGrades,
    grades: scoredGrades,
  };
}

function readOptionalJson(file, label) {
  if (!file || !fs.existsSync(file)) return null;
  return readJson(file, label);
}

function mdEscape(value) {
  return String(value ?? "")
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, "<br>")
    .trim();
}

function mdSnippet(value, maxLength = 180) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return mdEscape(text);
  return mdEscape(text.slice(0, maxLength - 1).trimEnd() + "...");
}

function metricPercent(metric) {
  if (typeof metric?.percent === "number") return `${metric.percent}%`;
  return "N/A";
}

function formatCoverageTable(metrics = {}) {
  return [
    "| Metric | Value |",
    "|---|---:|",
    `| Requested questions | ${metrics.requested_question_count ?? "N/A"} |`,
    `| Valid questions | ${metrics.total_questions_valid ?? "N/A"} |`,
    `| Question count met | ${metrics.question_count_met === null || metrics.question_count_met === undefined ? "N/A" : metrics.question_count_met ? "yes" : "no"} |`,
    `| Dropped questions | ${metrics.total_questions_dropped ?? 0} |`,
    `| Flagged questions | ${metrics.total_questions_flagged ?? 0} |`,
    `| Fact coverage | ${metricPercent(metrics.fact_coverage)} |`,
    `| Section coverage | ${metricPercent(metrics.section_coverage)} |`,
    `| Multi-hop ratio | ${metricPercent(metrics.multi_hop_ratio)} |`,
    `| Hallucination probe ratio | ${metricPercent(metrics.hallucination_probe_ratio)} |`,
  ].join("\n");
}

function formatTypeTable(byType = {}) {
  const rows = [
    "| Question type | Count | Graded | Avg score | Pass rate |",
    "|---|---:|---:|---:|---:|",
  ];
  for (const [type, summary] of Object.entries(byType)) {
    rows.push(`| ${mdEscape(type)} | ${summary.count ?? 0} | ${summary.graded_count ?? 0} | ${summary.average_percent ?? 0}% | ${summary.pass_percent ?? 0}% |`);
  }
  return rows.join("\n");
}

function buildGradeIndex(gradesDoc) {
  return new Map(asArray(gradesDoc?.grades).filter((grade) => grade?.qid).map((grade) => [grade.qid, grade]));
}

function buildAnswerIndex(answersDoc) {
  return new Map(asArray(answersDoc?.answers).filter((answer) => answer?.qid).map((answer) => [answer.qid, answer]));
}

function formatQuestionDetails(benchmarkDoc, scoreDoc, answersDoc, gradesDoc) {
  const gradesById = buildGradeIndex(gradesDoc || scoreDoc);
  const answersById = buildAnswerIndex(answersDoc);
  const rows = [
    "| QID | Type | Score | Expected | Chatbot answer | Missing criteria | Hallucination flags |",
    "|---|---|---:|---|---|---|---|",
  ];

  for (const question of asArray(benchmarkDoc.questions)) {
    const grade = gradesById.get(question.qid);
    const answer = answersById.get(question.qid);
    rows.push([
      mdEscape(question.qid),
      mdEscape(question.question_type),
      grade?.score ?? "N/A",
      mdSnippet(question.expected_answer, 140),
      mdSnippet(answer?.answer, 180),
      mdSnippet(asArray(grade?.missing_criteria).join("; "), 160),
      mdSnippet(asArray(grade?.hallucination_flags).join("; "), 160),
    ].join(" | ").replace(/^/, "| ").replace(/$/, " |"));
  }

  return rows.join("\n");
}

function buildMarkdownReport({ benchmarkDoc, scoreDoc, answersDoc, gradesDoc, title }) {
  const scoreMetrics = scoreDoc.metrics || {};
  const coverageMetrics = benchmarkDoc.metrics || {};
  const generatedAt = new Date().toISOString();

  return [
    `# ${title || "RAG Chatbot Benchmark Report"}`,
    "",
    `Generated at: ${generatedAt}`,
    "",
    "## Summary",
    "",
    "| Metric | Value |",
    "|---|---:|",
    `| Total questions | ${scoreMetrics.total_questions ?? coverageMetrics.total_questions_valid ?? "N/A"} |`,
    `| Graded questions | ${scoreMetrics.graded_questions ?? "N/A"} |`,
    `| Overall accuracy | ${metricPercent(scoreMetrics.overall_accuracy)} |`,
    `| Answerable accuracy | ${metricPercent(scoreMetrics.answerable_accuracy)} |`,
    `| Unanswerable accuracy | ${metricPercent(scoreMetrics.unanswerable_accuracy)} |`,
    `| Pass rate | ${metricPercent(scoreMetrics.pass_rate)} |`,
    `| Criteria met | ${metricPercent(scoreMetrics.criteria_met_ratio)} |`,
    `| Hallucination flags | ${scoreMetrics.hallucination_flag_count ?? 0} |`,
    "",
    "## Coverage",
    "",
    formatCoverageTable(coverageMetrics),
    "",
    "## Score By Type",
    "",
    formatTypeTable(scoreMetrics.by_type || {}),
    "",
    "## Dropped And Flagged Questions",
    "",
    `Dropped: ${asArray(benchmarkDoc.dropped_questions).length}`,
    "",
    `Flagged: ${asArray(benchmarkDoc.flagged_questions).length}`,
    "",
    "## Question Details",
    "",
    formatQuestionDetails(benchmarkDoc, scoreDoc, answersDoc, gradesDoc),
    "",
  ].join("\n");
}

function bundlePath(args) {
  return path.resolve(args.root, args.bundle || path.join(DEFAULT_OUT, `${questionsAnswersFileBase(args.language)}.json`));
}

function readBundle(args) {
  const bundle = readJson(bundlePath(args), "rag benchmark bundle");
  return ensureBundleArtifacts(args, bundle);
}

function writeBundle(args, bundle) {
  writeJson(bundlePath(args), bundle, args.pretty);
}

function commandContextBundle(args) {
  const bundle = readBundle(args);
  const root = path.resolve(bundle.project?.root || args.root);
  const relDocs = asArray(bundle.sourceFiles)
    .map((file) => (file && typeof file.path === "string" ? file.path : ""))
    .filter(Boolean);
  if (relDocs.length === 0) {
    throw new Error("context-bundle requires sourceFiles in the questions-answers JSON.");
  }
  const maxBytes = bundle.config?.maxBytesPerFile || args.maxBytes;
  const files = relDocs.map((rel) => readSourceFile(root, rel, maxBytes));
  const context = {
    schemaVersion: "1.0",
    kind: "rag-source-context",
    generatedAt: new Date().toISOString(),
    sourceFiles: files.map((file) => ({
      path: file.path,
      sourceType: file.sourceType,
      bytes: file.bytes,
      includedBytes: file.includedBytes,
      truncated: file.truncated,
      extraction: file.extraction,
    })),
    combinedText: sourceDocumentsText(files),
  };
  console.log(JSON.stringify(context, null, args.pretty ? 2 : 0));
}

function ensureBundleArtifacts(args, bundle) {
  const file = bundlePath(args);
  const language = languageSuffix(bundle.config?.language || args.language);
  const reportMarkdown = path.resolve(args.root, bundle.report?.markdownPath || bundle.artifacts?.reportMarkdown || args.reportOut);
  bundle.artifacts = {
    outputDir: normalize(path.dirname(file)),
    bundle: normalize(file),
    questionsAnswersMarkdown: normalize(bundle.artifacts?.questionsAnswersMarkdown || markdownPathFromBundlePath(file, ".md")),
    codexRunnerMarkdown: normalize(bundle.artifacts?.codexRunnerMarkdown || path.join(path.dirname(file), `codex-runner.${language}.md`)),
    reportMarkdown: normalize(reportMarkdown),
  };
  bundle.report = {
    ...(bundle.report || {}),
    markdownPath: normalize(reportMarkdown),
  };
  bundle.benchmarkNotes ||= benchmarkNotes(bundle.config || {});
  return bundle;
}

function commandValidateBundle(args) {
  const bundle = readBundle(args);
  const result = validateBenchmark(bundle.facts || {}, bundle.questions || {}, {
    minSectionQuestions: bundle.config?.minSectionQuestions ?? args.minSectionQuestions,
    questionCount: bundle.config?.questionCount ?? args.questionCount,
  });
  bundle.validation = result;
  bundle.updatedAt = new Date().toISOString();
  writeBundle(args, bundle);
  refreshBenchmarkMarkdownFiles(args, bundle);
  console.log("Da cap nhat validation trong bundle: " + bundlePath(args));
}

function commandScoreBundle(args) {
  const bundle = readBundle(args);
  if (!bundle.validation) throw new Error("score-bundle requires bundle.validation. Run validate-bundle first.");
  const result = scoreGrades(bundle.validation, bundle.grades || {}, {
    passThreshold: args.passThreshold,
  });
  bundle.scoreReport = result;
  bundle.updatedAt = new Date().toISOString();
  writeBundle(args, bundle);
  refreshBenchmarkMarkdownFiles(args, bundle);
  console.log("Da cap nhat scoreReport trong bundle: " + bundlePath(args));
}

function commandReportBundle(args) {
  const bundle = readBundle(args);
  if (!bundle.validation) throw new Error("report-bundle requires bundle.validation. Run validate-bundle first.");
  if (!bundle.scoreReport) throw new Error("report-bundle requires bundle.scoreReport. Run score-bundle first.");
  const outPath = path.resolve(args.root, args.out || bundle.report?.markdownPath || args.reportOut);
  const markdown = buildMarkdownReport({
    benchmarkDoc: bundle.validation,
    scoreDoc: bundle.scoreReport,
    answersDoc: bundle.chatbotAnswers || null,
    gradesDoc: bundle.grades || null,
    title: args.title,
  });
  writeText(outPath, markdown);
  bundle.report = {
    ...(bundle.report || {}),
    markdownPath: normalize(outPath),
    generatedAt: new Date().toISOString(),
  };
  bundle.updatedAt = new Date().toISOString();
  bundle.artifacts = {
    ...(bundle.artifacts || {}),
    reportMarkdown: normalize(outPath),
  };
  writeBundle(args, bundle);
  refreshBenchmarkMarkdownFiles(args, bundle);
  console.log("Da sinh report: " + outPath);
}

function commandValidate(args) {
  if (!args.facts || !args.questions) throw new Error("validate requires --facts and --questions");
  const factsDoc = readJson(path.resolve(args.root, args.facts), "facts");
  const questionsDoc = readJson(path.resolve(args.root, args.questions), "questions");
  const result = validateBenchmark(factsDoc, questionsDoc, {
    minSectionQuestions: args.minSectionQuestions,
    questionCount: args.questionCount,
  });
  if (args.metricsOut) writeJson(path.resolve(args.root, args.metricsOut), result.metrics, args.pretty);
  if (args.out) writeJson(path.resolve(args.root, args.out), result, args.pretty);
  else console.log(JSON.stringify(result, null, args.pretty ? 2 : 0));
}

function commandScore(args) {
  if (!args.benchmark || !args.grades) throw new Error("score requires --benchmark and --grades");
  const benchmarkDoc = readJson(path.resolve(args.root, args.benchmark), "benchmark");
  const gradesDoc = readJson(path.resolve(args.root, args.grades), "grades");
  const result = scoreGrades(benchmarkDoc, gradesDoc, { passThreshold: args.passThreshold });
  if (args.out) writeJson(path.resolve(args.root, args.out), result, args.pretty);
  else console.log(JSON.stringify(result, null, args.pretty ? 2 : 0));
}

function commandReport(args) {
  if (!args.benchmark || !args.score) throw new Error("report requires --benchmark and --score");
  const benchmarkDoc = readJson(path.resolve(args.root, args.benchmark), "benchmark");
  const scoreDoc = readJson(path.resolve(args.root, args.score), "score report");
  const answersDoc = args.answers ? readOptionalJson(path.resolve(args.root, args.answers), "answers") : null;
  const gradesDoc = args.grades ? readOptionalJson(path.resolve(args.root, args.grades), "grades") : null;
  const outPath = path.resolve(args.root, args.out || args.reportOut);
  const markdown = buildMarkdownReport({
    benchmarkDoc,
    scoreDoc,
    answersDoc,
    gradesDoc,
    title: args.title,
  });
  writeText(outPath, markdown);
  console.log("Da sinh report: " + outPath);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  if (args.command === "init") initRun(args);
  else if (args.command === "context-bundle") commandContextBundle(args);
  else if (args.command === "validate-bundle") commandValidateBundle(args);
  else if (args.command === "score-bundle") commandScoreBundle(args);
  else if (args.command === "report-bundle") commandReportBundle(args);
  else if (args.command === "validate") commandValidate(args);
  else if (args.command === "score") commandScore(args);
  else if (args.command === "report") commandReport(args);
  else throw new Error("Unknown command: " + args.command);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error("Loi: " + (error?.message || String(error)));
    process.exit(1);
  }
}
