#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const DEFAULT_OUT = ".understand-code/runs";
const TEXT_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|json|md|mdx|css|scss|sass|html|yml|yaml|toml|env|txt)$/i;

function parseArgs(argv) {
  const args = {
    root: process.cwd(),
    out: DEFAULT_OUT,
    task: "",
    taskFile: "",
    title: "",
    maxFiles: 80,
    maxBytes: 1_000_000,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (item === "--root") args.root = path.resolve(argv[++i]);
    else if (item === "--out") args.out = argv[++i];
    else if (item === "--task") args.task = argv[++i] || "";
    else if (item === "--task-file") args.taskFile = argv[++i] || "";
    else if (item === "--title") args.title = argv[++i] || "";
    else if (item === "--max-files") args.maxFiles = Number(argv[++i] || args.maxFiles);
    else if (item === "--max-bytes") args.maxBytes = Number(argv[++i] || args.maxBytes);
    else if (item === "--help" || item === "-h") {
      printHelp();
      process.exit(0);
    }
  }
  args.root = path.resolve(args.root);
  args.out = path.resolve(args.root, args.out);
  if (args.taskFile) args.task = fs.readFileSync(path.resolve(args.root, args.taskFile), "utf8");
  args.task = args.task.trim();
  return args;
}

function printHelp() {
  console.log(`
Understand Code Workflow

Usage:
  /home/thinnh2/.understand-anything/tools/understand-code/understand-code.mjs --root /path/to/project --task "Sửa ..."

Options:
  --root        Project root. Default: current directory.
  --out         Output run folder root. Default: ${DEFAULT_OUT}
  --task        Task/request text.
  --task-file   Read task text from a file relative to root.
  --title       Optional run title.
  --max-files   Max relevant files to include in manifest. Default: 80
  --max-bytes   Max bytes to scan per file. Default: 1000000
`);
}

function normalize(file) {
  return file.replaceAll("\\", "/");
}

function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function safeRead(file, maxBytes) {
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > maxBytes) return "";
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

function defaultSkip(entryName) {
  return [
    "node_modules",
    ".git",
    ".next",
    "dist",
    "build",
    "coverage",
    ".turbo",
    ".understand-code",
  ].includes(entryName);
}

function walk(dir, root, maxBytes, output = []) {
  if (!fs.existsSync(dir)) return output;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (defaultSkip(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, root, maxBytes, output);
    else if (TEXT_EXT.test(entry.name)) {
      const stat = fs.statSync(full);
      if (stat.size <= maxBytes) output.push(normalize(path.relative(root, full)));
    }
  }
  return output;
}

function tokenize(text) {
  return [...new Set(String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[^a-z0-9_./:-]+/)
    .filter((word) => word.length >= 3)
    .filter((word) => !["the", "and", "for", "with", "this", "that", "you", "toi", "cho", "cac", "nhung", "khi", "sua", "task", "code"].includes(word))
  )].slice(0, 80);
}

function scoreFile(root, rel, terms, maxBytes) {
  const lowerPath = rel.toLowerCase();
  const text = safeRead(path.join(root, rel), maxBytes).toLowerCase();
  let score = 0;
  const hits = [];
  for (const term of terms) {
    if (lowerPath.includes(term)) {
      score += 8;
      hits.push({ term, where: "path" });
    }
    const index = text.indexOf(term);
    if (index >= 0) {
      score += 2;
      if (hits.length < 12) hits.push({ term, where: "content" });
    }
  }
  if (/src\/app|pages\//.test(rel)) score += 2;
  if (/api|service|query|hook|store|middleware|provider/i.test(rel)) score += 2;
  if (/test|spec|playwright|vitest|jest/i.test(rel)) score += 1;
  return { rel, score, hits };
}

function classify(rel) {
  if (/\.test\.|\.spec\.|__tests__|tests\//i.test(rel)) return "test";
  if (/src\/app|pages\//i.test(rel)) return "route";
  if (/component|template|ui|page/i.test(rel)) return "ui";
  if (/api|service|query|mutation|request|http/i.test(rel)) return "api";
  if (/hook|store|context|provider/i.test(rel)) return "state";
  if (/middleware|auth|guard|permission/i.test(rel)) return "runtime";
  if (/package\.json|config|env|docker|ci|workflow/i.test(rel)) return "config";
  return "source";
}

function graphSummary(root, relevantFiles) {
  const graph = readJson(path.join(root, ".understand-anything/knowledge-graph.json"), null);
  if (!graph) return { available: false };
  const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
  const edges = Array.isArray(graph.edges) ? graph.edges : [];
  const relevant = new Set(relevantFiles.map((item) => item.path));
  const graphHits = nodes
    .filter((node) => relevant.has(normalize(node.path || node.file || node.id || "")))
    .slice(0, 80)
    .map((node) => ({
      id: node.id,
      type: node.type,
      path: normalize(node.path || node.file || ""),
      label: node.label || node.name || "",
    }));
  return {
    available: true,
    nodeCount: nodes.length,
    edgeCount: edges.length,
    relevantNodeCount: graphHits.length,
    relevantNodes: graphHits,
  };
}

function detectCommands(root, pkg) {
  const scripts = pkg?.scripts || {};
  const entries = Object.entries(scripts);
  return {
    installHint: fs.existsSync(path.join(root, "pnpm-lock.yaml")) ? "pnpm install" : fs.existsSync(path.join(root, "yarn.lock")) ? "yarn install" : "npm install",
    scripts,
    likelyChecks: entries
      .filter(([name]) => /test|lint|type|build|check|e2e|playwright|vitest|jest/i.test(name))
      .map(([name, value]) => ({ command: "npm run " + name, script: value })),
  };
}

function routeFromFile(rel) {
  const file = normalize(rel);
  if (file.startsWith("src/app/") || file.startsWith("app/")) {
    const root = file.startsWith("src/app/") ? "src/app/" : "app/";
    const leaf = file.slice(root.length).replace(/\/(page|layout)\.(tsx|ts|jsx|js|mdx)$/, "").replace(/^(page|layout)\.(tsx|ts|jsx|js|mdx)$/, "");
    const parts = leaf.split("/").filter(Boolean).filter((part) => !/^\(.+\)$/.test(part)).map((part) => part.replace(/^\[(.+)\]$/, ":$1"));
    return "/" + parts.join("/");
  }
  if (file.startsWith("src/pages/") || file.startsWith("pages/")) {
    const root = file.startsWith("src/pages/") ? "src/pages/" : "pages/";
    const leaf = file.slice(root.length).replace(/\.(tsx|ts|jsx|js|mdx)$/, "");
    const parts = leaf.split("/").filter(Boolean).filter((part) => part !== "index").map((part) => part.replace(/^\[(.+)\]$/, ":$1"));
    return "/" + parts.join("/");
  }
  return "";
}

function buildManifest(args) {
  if (!fs.existsSync(args.root) || !fs.statSync(args.root).isDirectory()) {
    throw new Error("Project root không tồn tại: " + args.root);
  }
  if (!args.task) throw new Error("Thiếu --task hoặc --task-file.");

  const pkg = readJson(path.join(args.root, "package.json"), {});
  const terms = tokenize(args.task);
  const files = walk(args.root, args.root, args.maxBytes);
  const ranked = files
    .map((rel) => scoreFile(args.root, rel, terms, args.maxBytes))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.rel.localeCompare(b.rel))
    .slice(0, args.maxFiles);
  const relevantFiles = ranked.map((item) => ({
    path: item.rel,
    role: classify(item.rel),
    score: item.score,
    route: routeFromFile(item.rel),
    evidence: item.hits,
  }));
  const now = new Date().toISOString();
  const runId = now.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z").replace("T", "-");
  const runDir = path.join(args.out, "run-" + runId);

  return {
    schemaVersion: "1.0",
    runId: "run-" + runId,
    generatedAt: now,
    project: {
      title: args.title || pkg.name || path.basename(args.root),
      root: normalize(args.root),
      packageManagerHint: fs.existsSync(path.join(args.root, "pnpm-lock.yaml")) ? "pnpm" : fs.existsSync(path.join(args.root, "yarn.lock")) ? "yarn" : "npm",
    },
    task: {
      title: args.title || args.task.split(/\r?\n/)[0].slice(0, 120),
      request: args.task,
      keywords: terms,
    },
    understandAnything: graphSummary(args.root, relevantFiles),
    commands: detectCommands(args.root, pkg),
    relevantFiles,
    workflow: {
      phaseOrder: [
        "impact-check",
        "parallel-plan-and-test-risk",
        "implementation",
        "review-and-mcp-verification",
        "cleanup-temporary-artifacts",
      ],
      agentPermission:
        "Sub-agents are a Codex runtime feature. This manifest is the contract; Codex parent must spawn agents only when the user explicitly permits multi-agent work.",
      mcpDevToolsPolicy: {
        requiredWhen:
          "Task touches route/page/component/template/UI, browser-visible behavior, auth guard, middleware redirect, form interaction, query params, localStorage/sessionStorage/cookie behavior, or the user explicitly asks for UI verification.",
        parentFallback:
          "If the review agent cannot access MCP Chrome DevTools, parent Codex must run the MCP DevTools verification before final response.",
        skipOnlyWhen:
          "Only skip DevTools when the change is provably non-UI/non-browser logic. The reviewer must state why it is not applicable.",
        evidenceRequired: [
          "URL/page opened or reason no route is available",
          "MCP snapshot or screenshot observation",
          "Interaction/result checked",
          "Console/network issue check when relevant"
        ],
      },
      cleanupPolicy: {
        runAfterReviewVerdict: "pass",
        deleteTemporaryArtifacts: true,
        deleteFiles: [
          "impact-report.md",
          "implementation-plan.md",
          "test-risk-matrix.md",
          "implementation-report.md"
        ],
        keepFiles: [
          "workflow-manifest.json",
          "codex-brief.md",
          "review-verification-report.md",
          "cleanup-after-review.mjs"
        ],
        note:
          "Plan/test-risk/implementation artifacts are temporary coordination files. Delete them after review passes so the project does not keep extra generated docs.",
      },
    },
    agents: {
      impactChecker: {
        skill: "understand-code-impact",
        agentFile: "/home/thinnh2/.codex/skills/understand-code-impact/agents/impact-checker.agent.md",
        output: "impact-report.md",
        mission:
          "Xác định chính xác những phần cần sửa, file cần đọc/sửa, ownership, dependency, rủi ro blast radius. Không code.",
      },
      planner: {
        skill: "understand-code-plan",
        agentFile: "/home/thinnh2/.codex/skills/understand-code-plan/agents/planner.agent.md",
        input: "impact-report.md",
        output: "implementation-plan.md",
        runMode: "parallel-after-impact",
      },
      testRiskDesigner: {
        skill: "understand-code-test-risk",
        agentFile: "/home/thinnh2/.codex/skills/understand-code-test-risk/agents/test-risk.agent.md",
        input: "impact-report.md",
        output: "test-risk-matrix.md",
        runMode: "parallel-after-impact",
      },
      implementer: {
        skill: "understand-code-implement",
        agentFile: "/home/thinnh2/.codex/skills/understand-code-implement/agents/implementer.agent.md",
        input: ["impact-report.md", "implementation-plan.md", "test-risk-matrix.md"],
        output: "code changes in workspace plus implementation-report.md",
      },
      reviewer: {
        skill: "understand-code-review",
        agentFile: "/home/thinnh2/.codex/skills/understand-code-review/agents/reviewer.agent.md",
        input: ["test-risk-matrix.md", "implementation-report.md", "git diff"],
        output: "review-verification-report.md",
        mcp: ["chrome_devtools for UI checks when a browser/dev server is relevant"],
      },
    },
    artifacts: {
      runDir: normalize(runDir),
      manifest: "workflow-manifest.json",
      impactReport: "impact-report.md",
      plan: "implementation-plan.md",
      testRiskMatrix: "test-risk-matrix.md",
      implementationReport: "implementation-report.md",
      reviewReport: "review-verification-report.md",
      codexBrief: "codex-brief.md",
    },
  };
}

function codexBrief(manifest) {
  return [
    "# Understand Code Brief",
    "",
    "Hãy dùng workflow multi-agent của understand-code cho task này. Đây là yêu cầu rõ ràng: Codex được phép spawn agent con theo manifest.",
    "",
    "## Task",
    "",
    manifest.task.request,
    "",
    "## Workflow bắt buộc",
    "",
    "1. Parent Codex đọc `workflow-manifest.json` và `.understand-anything/knowledge-graph.json` nếu có.",
    "2. Spawn `understand-code-impact` trước để xác định phần cần sửa. Không code ở bước này.",
    "3. Sau impact report, spawn song song:",
    "   - `understand-code-plan`: tạo implementation plan.",
    "   - `understand-code-test-risk`: tạo test case, tài liệu test và risk matrix.",
    "4. Sau khi plan + test-risk xong, spawn `understand-code-implement` để code theo plan.",
    "5. Sau khi code xong, spawn `understand-code-review` để review diff theo test-risk matrix.",
    "6. Reviewer phải chạy verification phù hợp. Nếu task chạm UI/route/component/browser behavior thì bắt buộc dùng MCP Chrome DevTools để kiểm tra giao diện và logic.",
    "7. Nếu reviewer không dùng được MCP Chrome DevTools nhưng task cần UI check, parent Codex phải tự chạy MCP DevTools trước final; không được im lặng bỏ qua.",
    "8. Nếu reviewer phát hiện lỗi, parent gửi feedback lại đúng implementer để sửa, rồi reviewer kiểm lại.",
    "9. Khi reviewer pass, chạy cleanup để xoá các artifact tạm: impact-report.md, implementation-plan.md, test-risk-matrix.md, implementation-report.md.",
    "10. Chỉ trả final khi review không còn lỗi blocking hoặc nêu rõ blocker chưa xử lý được.",
    "",
    "## Output mong muốn",
    "",
    "- `impact-report.md`",
    "- `implementation-plan.md`",
    "- `test-risk-matrix.md`",
    "- `implementation-report.md`",
    "- `review-verification-report.md`",
    "",
    "Các file plan/test-risk/implementation report là tạm thời và sẽ bị xoá sau khi reviewer pass. Giữ lại `workflow-manifest.json`, `codex-brief.md` và `review-verification-report.md`.",
    "",
  ].join("\n");
}

function cleanupScript(manifest) {
  const files = manifest.workflow.cleanupPolicy.deleteFiles;
  return [
    "#!/usr/bin/env node",
    "import fs from \"node:fs\";",
    "import path from \"node:path\";",
    "const runDir = path.dirname(new URL(import.meta.url).pathname);",
    "const files = " + JSON.stringify(files, null, 2) + ";",
    "for (const file of files) {",
    "  const target = path.join(runDir, file);",
    "  if (fs.existsSync(target)) fs.rmSync(target, { force: true });",
    "}",
    "console.log(\"Đã xoá artifact tạm sau review pass.\");",
    "",
  ].join("\n");
}

function writeRun(args, manifest) {
  const runDir = manifest.artifacts.runDir;
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, "workflow-manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  fs.writeFileSync(path.join(runDir, "codex-brief.md"), codexBrief(manifest));
  fs.writeFileSync(path.join(runDir, "cleanup-after-review.mjs"), cleanupScript(manifest));
  fs.chmodSync(path.join(runDir, "cleanup-after-review.mjs"), 0o755);
}

try {
  const args = parseArgs(process.argv.slice(2));
  const manifest = buildManifest(args);
  writeRun(args, manifest);
  console.log("Đã sinh Understand Code workflow: " + manifest.artifacts.runDir);
  console.log("File liên quan gợi ý: " + manifest.relevantFiles.length);
  console.log("Brief: " + path.join(manifest.artifacts.runDir, "codex-brief.md"));
} catch (error) {
  console.error("Lỗi: " + (error?.message || String(error)));
  process.exit(1);
}
