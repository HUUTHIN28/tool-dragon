#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const DEFAULT_OUT = "docs/understand-portal";

function parseArgs(argv) {
  const args = {
    root: process.cwd(),
    out: DEFAULT_OUT,
    title: "",
    maxFiles: 80,
    maxFields: 220,
    maxSignals: 180,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (item === "--root") args.root = path.resolve(argv[++i]);
    else if (item === "--out") args.out = argv[++i];
    else if (item === "--title") args.title = argv[++i];
    else if (item === "--max-files") args.maxFiles = Number(argv[++i] || args.maxFiles);
    else if (item === "--max-fields") args.maxFields = Number(argv[++i] || args.maxFields);
    else if (item === "--max-signals") args.maxSignals = Number(argv[++i] || args.maxSignals);
    else if (item === "--help" || item === "-h") {
      printHelp();
      process.exit(0);
    }
  }

  args.out = path.resolve(args.root, args.out);
  return args;
}

function printHelp() {
  console.log(`
Understand Docs Portal

Usage:
  /home/thinnh2/.understand-anything/tools/understand-docs/understand-docs.mjs [--root /path/to/project] [--out docs/understand-portal]

Options:
  --root         Project root. Default: current working directory.
  --out          Output folder, relative to root unless absolute. Default: ${DEFAULT_OUT}
  --title        Project title shown in the portal. Default: package.json name or folder name.
  --max-files    Max files scanned per screen import graph. Default: 80
  --max-fields   Max field rows per screen. Default: 220
  --max-signals  Max logic/API signal rows per group. Default: 180

Serve after generation:
  python3 -m http.server 5174 --bind 127.0.0.1 --directory docs/understand-portal
`);
}

function nearestExistingParent(target) {
  let current = path.resolve(target);
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) return current;
    current = parent;
  }
  return current;
}

function validateArgs(args) {
  const placeholderRoot = args.root === '/path/to/project' || args.root === '/path/to/other-project' || args.root.includes('/path/to/');
  if (placeholderRoot) {
    console.error('Lỗi: --root đang là đường dẫn ví dụ, không phải project thật.');
    console.error('Hãy thay /path/to/other-project bằng đường dẫn thật, ví dụ:');
    console.error('  /home/thinnh2/.understand-anything/tools/understand-docs/understand-docs.mjs --root /home/thinnh2/Documents/VNEXT/sendo-ecsite-fe --out docs/understand-portal');
    process.exit(1);
  }

  if (!fs.existsSync(args.root) || !fs.statSync(args.root).isDirectory()) {
    console.error(`Lỗi: project root không tồn tại hoặc không phải thư mục: ${args.root}`);
    console.error('Hãy truyền --root là thư mục gốc của project thật.');
    process.exit(1);
  }

  const parent = nearestExistingParent(args.out);
  try {
    fs.accessSync(parent, fs.constants.W_OK);
  } catch {
    console.error(`Lỗi: không có quyền ghi vào thư mục output hoặc thư mục cha: ${parent}`);
    console.error('Hãy chọn --out nằm trong project bạn có quyền ghi, hoặc chạy ở user có quyền ghi.');
    process.exit(1);
  }
}

function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function normalize(file) {
  return file.replaceAll("\\", "/");
}

function exists(root, file) {
  return fs.existsSync(path.join(root, file));
}

function walk(dir, shouldSkip = defaultSkip) {
  const output = [];
  if (!fs.existsSync(dir)) return output;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (shouldSkip(full, entry)) continue;
    if (entry.isDirectory()) output.push(...walk(full, shouldSkip));
    else output.push(full);
  }
  return output;
}

function defaultSkip(full, entry) {
  const name = entry.name;
  return (
    name === "node_modules" ||
    name === ".git" ||
    name === ".next" ||
    name === "dist" ||
    name === "build" ||
    name === "coverage" ||
    name === ".turbo" ||
    name === ".understand-anything"
  );
}

function compact(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function titleCase(value) {
  return value
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .trim();
}

function routeFromAppFile(relFile) {
  const normalized = normalize(relFile);
  if (normalized.startsWith("src/app/") || normalized.startsWith("app/")) {
    const appRoot = normalized.startsWith("src/app/") ? "src/app/" : "app/";
    const withoutRoot = normalized.slice(appRoot.length);
    const withoutLeaf = withoutRoot.replace(/\/page\.(tsx|ts|jsx|js|mdx)$/, "");
    const parts = withoutLeaf
      .split("/")
      .filter(Boolean)
      .filter((part) => !/^\(.+\)$/.test(part))
      .map((part) => part.replace(/^\[(.+)\]$/, ":$1"));
    return `/${parts.join("/")}`.replace(/\/$/, "") || "/";
  }

  if (normalized.startsWith("src/pages/") || normalized.startsWith("pages/")) {
    const pagesRoot = normalized.startsWith("src/pages/") ? "src/pages/" : "pages/";
    const withoutRoot = normalized.slice(pagesRoot.length);
    const withoutExt = withoutRoot.replace(/\.(tsx|ts|jsx|js|mdx)$/, "");
    const parts = withoutExt
      .split("/")
      .filter(Boolean)
      .filter((part) => part !== "index")
      .map((part) => part.replace(/^\[(.+)\]$/, ":$1"));
    return `/${parts.join("/")}`.replace(/\/$/, "") || "/";
  }

  return "/";
}

function screenGroup(route) {
  const r = route.toLowerCase();
  if (r === "/" || r === "/:locale" || r.includes("/403") || r.includes("/404") || r.includes("/500")) return "system";
  if (/(login|password|email-verification|auth|forgot|reset)/.test(r)) return "auth";
  if (/(staff|handle|sousa|tool|total|search-page-staff)/.test(r)) return "staff";
  if (/(search\/|shipping|spn|statistic|auction-rule)/.test(r)) return "shared";
  return "client";
}

function routeTitle(route) {
  if (route === "/") return "Route gốc / Redirect";
  const leaf = route.split("/").filter(Boolean).pop() || "home";
  return titleCase(leaf.replace(/^:/, ""));
}

function discoverScreens(root) {
  const candidates = [
    ...walk(path.join(root, "src/app")),
    ...walk(path.join(root, "app")),
    ...walk(path.join(root, "src/pages")),
    ...walk(path.join(root, "pages")),
  ];

  const routeFiles = candidates
    .map((file) => normalize(path.relative(root, file)))
    .filter((file) => /(^|\/)page\.(tsx|ts|jsx|js|mdx)$/.test(file) || /(^|\/)index\.(tsx|ts|jsx|js|mdx)$/.test(file))
    .filter((file) => !file.includes(".test.") && !file.includes(".spec."));

  return routeFiles
    .map((file) => {
      const route = routeFromAppFile(file);
      const id = route === "/" ? "system-home" : route.replace(/^\/+/, "").replace(/[:/]/g, "-").replace(/^-+|-+$/g, "");
      return {
        id: id || "system-home",
        title: routeTitle(route),
        route,
        group: screenGroup(route),
        appFile: file,
        primaryFiles: [file],
      };
    })
    .sort((a, b) => a.route.localeCompare(b.route));
}

function loadUnderstandGraph(root) {
  return readJson(path.join(root, ".understand-anything/knowledge-graph.json"), null);
}

function graphMetrics(graph, discoveredScreens) {
  if (!graph) {
    return [
      { label: "Màn phát hiện", value: String(discoveredScreens.length) },
      { label: "Knowledge graph", value: "Không có" },
    ];
  }

  const importEdges = (graph.edges || []).filter((edge) => /import/i.test(edge.type || edge.label || "")).length;
  return [
    { label: "File trong graph", value: String((graph.nodes || []).filter((node) => node.type === "file").length || (graph.nodes || []).length) },
    { label: "Node đồ thị", value: String((graph.nodes || []).length) },
    { label: "Cạnh đồ thị", value: String((graph.edges || []).length) },
    { label: "Cạnh import", value: String(importEdges || "N/A") },
    { label: "Màn phát hiện", value: String(discoveredScreens.length) },
  ];
}

function graphLayers(graph) {
  if (!graph?.layers) return [];
  if (Array.isArray(graph.layers)) {
    return graph.layers.map((layer) => ({
      name: layer.name || layer.id || "Layer",
      count: layer.count || layer.nodes?.length || 0,
      description: layer.description || "Layer lấy từ Understand Anything.",
    }));
  }
  return Object.entries(graph.layers).map(([name, value]) => ({
    name,
    count: Array.isArray(value) ? value.length : value?.count || 0,
    description: value?.description || "Layer lấy từ Understand Anything.",
  }));
}

function resolveImport(root, spec, fromFile) {
  if (!spec.startsWith("@/") && !spec.startsWith(".")) return null;
  const base = spec.startsWith("@/")
    ? path.join(root, "src", spec.slice(2))
    : path.resolve(path.dirname(path.join(root, fromFile)), spec);

  const candidates = [
    base,
    `${base}.tsx`,
    `${base}.ts`,
    `${base}.jsx`,
    `${base}.js`,
    `${base}.mjs`,
    path.join(base, "index.tsx"),
    path.join(base, "index.ts"),
    path.join(base, "index.jsx"),
    path.join(base, "index.js"),
  ];

  const found = candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
  if (!found) return null;
  const rel = normalize(path.relative(root, found));
  if (!rel.startsWith("src/") && !rel.startsWith("app/") && !rel.startsWith("pages/")) return null;
  return rel;
}

function collectFiles(root, seedFiles, maxFiles) {
  const queue = seedFiles.filter((file) => exists(root, file));
  const seen = new Set(queue);

  for (let index = 0; index < queue.length && queue.length < maxFiles; index += 1) {
    const file = queue[index];
    const text = fs.readFileSync(path.join(root, file), "utf8");
    for (const match of text.matchAll(/import(?:\s+type)?[\s\S]*?from\s+['"]([^'"]+)['"]/g)) {
      const resolved = resolveImport(root, match[1], file);
      if (resolved && !seen.has(resolved)) {
        seen.add(resolved);
        queue.push(resolved);
      }
    }
  }

  return [...seen].sort();
}

function nearby(lines, index, pattern, radius = 8) {
  const start = Math.max(0, index - radius);
  const end = Math.min(lines.length - 1, index + radius);
  for (let i = index; i >= start; i -= 1) {
    const match = lines[i].match(pattern);
    if (match) return compact(match[1] || match[0]);
  }
  for (let i = index + 1; i <= end; i += 1) {
    const match = lines[i].match(pattern);
    if (match) return compact(match[1] || match[0]);
  }
  return "";
}

function componentNear(lines, index) {
  return nearby(lines, index, /<([A-Z][A-Za-z0-9.]*)\b/, 10).replace(/^Form\.Item$/, "Form.Item") || "Field";
}

function labelNear(lines, index) {
  return (
    nearby(lines, index, /label=\{t\(['"]([^'"]+)['"]\)\}/, 8) ||
    nearby(lines, index, /label=['"]([^'"]+)['"]/, 8) ||
    nearby(lines, index, /label=\{([^}]+)\}/, 8) ||
    nearby(lines, index, /placeholder=\{t\(['"]([^'"]+)['"]\)\}/, 6) ||
    nearby(lines, index, /placeholder=['"]([^'"]+)['"]/, 6) ||
    "-"
  );
}

function collectProp(lines, index, propName, radius = 14) {
  const start = Math.max(0, index - radius);
  const end = Math.min(lines.length - 1, index + radius);
  const propPattern = new RegExp(`\\b${propName}=`);

  for (let i = start; i <= end; i += 1) {
    if (!propPattern.test(lines[i])) continue;
    const chunk = [];
    let braceBalance = 0;
    for (let j = i; j <= Math.min(end, i + 8); j += 1) {
      chunk.push(lines[j]);
      for (const char of lines[j]) {
        if (char === "{") braceBalance += 1;
        if (char === "}") braceBalance -= 1;
      }
      if (j > i && braceBalance <= 0) break;
      if (lines[j].includes("/>") || lines[j].includes(">")) {
        if (braceBalance <= 0) break;
      }
    }
    return compact(chunk.join(" "));
  }
  return "";
}

function visibilityNear(lines, index) {
  const signals = [];
  const start = Math.max(0, index - 36);
  const end = Math.min(lines.length - 1, index + 8);

  for (let i = start; i <= end; i += 1) {
    const line = compact(lines[i]);
    if (!line) continue;
    const conditional =
      line.match(/^\{(.+?)\s*&&\s*\($/) ||
      line.match(/^\{(.+?)\s*\?\s*\($/) ||
      line.match(/^\{(.+?)\s*&&\s*</) ||
      line.match(/^\{(.+?)\s*\?\s*</) ||
      line.match(/^if\s*\((.+?)\)/);

    if (conditional) signals.push(`Render có điều kiện: ${conditional[1]}`);

    if (
      /\b(profile|permissions|SCREENACCESS|isStaffJ|isMobile|width|height|activeKey|activeView|has[A-Z]|is[A-Z]|role|type|searchParams|customer)\b/.test(line) &&
      /(\?|\&\&|\|\||includes|===|!==|==|!=|>=|<=|>|<)/.test(line)
    ) {
      signals.push(`Tín hiệu hiện/ẩn gần field: ${line}`);
    }
  }

  return [...new Set(signals)].slice(0, 6).join(" | ");
}

function relatedEventsNear(lines, index) {
  const events = [
    collectProp(lines, index, "onChange", 10),
    collectProp(lines, index, "onClick", 10),
    collectProp(lines, index, "onBlur", 10),
    collectProp(lines, index, "onSearch", 10),
  ].filter(Boolean);
  return [...new Set(events)].slice(0, 4).join(" | ");
}

function pushUnique(items, item, keyFn) {
  const key = keyFn(item);
  if (!items.some((existing) => keyFn(existing) === key)) items.push(item);
}

function extractFromFile(root, file) {
  const text = fs.readFileSync(path.join(root, file), "utf8");
  const lines = text.split(/\r?\n/);
  const result = {
    fields: [],
    handlers: [],
    hooks: [],
    state: [],
    effects: [],
    routeParams: [],
    apiSignals: [],
  };

  lines.forEach((line, index) => {
    const lineNo = index + 1;
    const clean = compact(line);
    const source = `${file}:${lineNo}`;

    const nameMatches = [
      ...line.matchAll(/\bname=["']([^"']+)["']/g),
      ...line.matchAll(/\bname=\{`([^`]+)`\}/g),
      ...line.matchAll(/\bname=\{['"]([^'"]+)['"]\}/g),
    ];

    for (const match of nameMatches) {
      const field = {
        name: match[1],
        component: componentNear(lines, index),
        label: labelNear(lines, index),
        source,
        snippet: clean,
        visibility: visibilityNear(lines, index),
        disabled: collectProp(lines, index, "disabled"),
        event: relatedEventsNear(lines, index),
      };
      field.note =
        field.visibility || field.disabled || field.event
          ? "Có tín hiệu điều kiện hoặc tương tác gần field."
          : "Chưa thấy điều kiện hiện/ẩn gần field trong vùng quét.";
      pushUnique(result.fields, field, (item) => `${item.name}|${item.source}`);
    }

    const handlerMatch =
      line.match(/\b(?:const|function)\s+((?:handle|on)[A-Z][A-Za-z0-9_]*)\b/) ||
      line.match(/\b(onFinish|onChange|onClick|onSubmit)=\{?([A-Za-z0-9_]+)?/);
    if (handlerMatch) {
      pushUnique(
        result.handlers,
        { name: handlerMatch[1] || handlerMatch[2] || "handler", source, snippet: clean },
        (item) => `${item.name}|${item.source}`,
      );
    }

    for (const match of line.matchAll(/\b(use[A-Z][A-Za-z0-9_]*)\s*\(/g)) {
      const hookName = match[1];
      const target = hookName === "useState" ? result.state : hookName === "useEffect" ? result.effects : result.hooks;
      pushUnique(target, { name: hookName, source, snippet: clean }, (item) => `${item.name}|${item.source}`);
    }

    for (const match of line.matchAll(/searchParams\.get\(['"]([^'"]+)['"]\)/g)) {
      pushUnique(result.routeParams, { name: match[1], source, snippet: clean }, (item) => `${item.name}|${item.source}`);
    }

    if (
      /\b(mutate|refetch|fetchQuery|setQueryData|invalidateQueries|removeQueries|cancelQueries|nookies|sessionStorage|localStorage|BroadcastChannel|router\.push|router\.replace|window\.open)\b/.test(
        line,
      )
    ) {
      pushUnique(result.apiSignals, { source, snippet: clean }, (item) => `${item.source}|${item.snippet}`);
    }
  });

  return result;
}

function limit(items, count) {
  return items.slice(0, count);
}

function buildSourceDetails(root, screens, args) {
  const details = {};

  for (const screen of screens) {
    const files = collectFiles(root, screen.primaryFiles, args.maxFiles);
    const combined = {
      files,
      fields: [],
      handlers: [],
      hooks: [],
      state: [],
      effects: [],
      routeParams: [],
      apiSignals: [],
    };

    for (const file of files) {
      const extracted = extractFromFile(root, file);
      for (const key of ["fields", "handlers", "hooks", "state", "effects", "routeParams", "apiSignals"]) {
        for (const item of extracted[key]) {
          pushUnique(combined[key], item, (value) =>
            key === "apiSignals" ? `${value.source}|${value.snippet}` : `${value.name || value.snippet}|${value.source}`,
          );
        }
      }
    }

    details[screen.id] = {
      files,
      fields: limit(combined.fields, args.maxFields),
      handlers: limit(combined.handlers, args.maxSignals),
      hooks: limit(combined.hooks, args.maxSignals),
      state: limit(combined.state, args.maxSignals),
      effects: limit(combined.effects, args.maxSignals),
      routeParams: limit(combined.routeParams, args.maxSignals),
      apiSignals: limit(combined.apiSignals, args.maxSignals),
    };
  }

  return details;
}

function enrichScreensWithImports(root, screens) {
  return screens.map((screen) => {
    const text = exists(root, screen.appFile) ? fs.readFileSync(path.join(root, screen.appFile), "utf8") : "";
    const localImports = [...text.matchAll(/import(?:\s+type)?[\s\S]*?from\s+['"]([^'"]+)['"]/g)]
      .map((match) => resolveImport(root, match[1], screen.appFile))
      .filter(Boolean)
      .slice(0, 8);
    return {
      ...screen,
      primaryFiles: [...new Set([screen.appFile, ...localImports])],
    };
  });
}

function buildData(root, args) {
  const pkg = readJson(path.join(root, "package.json"), {});
  const graph = loadUnderstandGraph(root);
  const screens = enrichScreensWithImports(root, discoverScreens(root));
  const title = args.title || pkg.name || path.basename(root);

  const groups = [
    { id: "auth", title: "Màn xác thực", description: "Đăng nhập, mật khẩu và xác thực người dùng." },
    { id: "client", title: "Màn khách hàng", description: "Các màn chính dành cho khách hàng/người dùng cuối." },
    { id: "shared", title: "Màn dùng chung", description: "Các màn dùng chung giữa nhiều role hoặc nhiều flow." },
    { id: "staff", title: "Màn staff", description: "Các workflow dành cho staff/admin/vận hành." },
    { id: "system", title: "Màn hệ thống", description: "Route gốc, redirect và trang lỗi." },
  ].filter((group) => screens.some((screen) => screen.group === group.id));

  return {
    generatedAt: new Date().toISOString(),
    project: {
      title,
      root: normalize(root),
      description: `Tài liệu chi tiết theo màn cho ${title}, sinh từ source code và Understand Anything knowledge graph nếu có.`,
      metrics: graphMetrics(graph, screens),
      layers: graphLayers(graph),
    },
    groups,
    screens,
    sourceDetails: buildSourceDetails(root, screens, args),
  };
}

function htmlTemplate(title) {
  return `<!doctype html>
<html lang="vi">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Tài liệu ${escapeForHtml(title)}</title>
    <link rel="stylesheet" href="./styles.css" />
  </head>
  <body>
    <div class="app-shell">
      <aside class="sidebar">
        <div class="brand">
          <span class="brand-mark">UA</span>
          <div>
            <h1>Tài liệu dự án</h1>
            <p>Sinh từ Understand Anything + source code</p>
          </div>
        </div>
        <label class="search">
          <span>Tìm kiếm</span>
          <input id="searchInput" type="search" placeholder="Tìm màn, route, file, field..." />
        </label>
        <nav class="nav" id="nav"></nav>
      </aside>
      <main class="content">
        <section class="hero">
          <div>
            <p class="eyebrow">${escapeForHtml(title)}</p>
            <h2 id="pageTitle">Cổng tài liệu</h2>
            <p id="pageSubtitle">Tổng quan và tài liệu chi tiết từng màn, gồm input, logic, hiện/ẩn, disable, event, hook và API signal.</p>
          </div>
          <div class="hero-actions">
            <button id="overviewButton" type="button">Tổng quan</button>
            <button id="printButton" type="button">In</button>
          </div>
        </section>
        <section id="mainPanel" class="panel"></section>
      </main>
    </div>
    <script src="./data.js"></script>
    <script src="./official-docs.generated.js"></script>
    <script src="./app.js"></script>
  </body>
</html>
`;
}

function escapeForHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const appJs = String.raw`
const data = window.UNDERSTAND_DOCS_DATA;
const officialDocs = window.UNDERSTAND_OFFICIAL_DOCS || { overview: null, screens: {} };
const nav = document.getElementById("nav");
const mainPanel = document.getElementById("mainPanel");
const pageTitle = document.getElementById("pageTitle");
const pageSubtitle = document.getElementById("pageSubtitle");
const searchInput = document.getElementById("searchInput");
const overviewButton = document.getElementById("overviewButton");
const printButton = document.getElementById("printButton");

let activeId = "overview";
let query = "";

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function files(items) {
  if (!items || items.length === 0) return '<p class="empty">Chưa liên kết file nào.</p>';
  return '<div class="file-list">' + items.map((item) => '<span class="file-chip">' + escapeHtml(item) + '</span>').join("") + '</div>';
}

function section(title, description, body) {
  return '<section class="section"><div class="section-header"><h3>' + escapeHtml(title) + '</h3>' + (description ? '<p>' + escapeHtml(description) + '</p>' : '') + '</div><div class="section-body">' + body + '</div></section>';
}

function paragraphList(items) {
  if (!items || items.length === 0) return '<p class="empty">Chưa có nội dung chính thức. Hãy chạy workflow Codex agent trong codex-brief.md.</p>';
  return '<div class="official-list">' + items.map((item) => '<p>' + escapeHtml(item) + '</p>').join("") + '</div>';
}

function officialOverview() {
  const doc = officialDocs.overview;
  if (!doc) return '<p class="empty">Portal đang ở trạng thái inventory tự động. Sau khi Codex agent tổng hợp, phần này sẽ thành tài liệu chính thức.</p>';
  const blocks = [
    ["Tổng quan nghiệp vụ", doc.summary],
    ["Kiến trúc và luồng router", doc.architecture],
    ["Luồng dữ liệu chính", doc.dataFlows],
    ["Rủi ro và điểm cần chú ý", doc.risks],
  ];
  return blocks.map(([title, items]) => '<h4 class="split-title">' + escapeHtml(title) + '</h4>' + paragraphList(items)).join("");
}

function officialScreenDoc(screen) {
  const doc = officialDocs.screens?.[screen.id];
  if (!doc) return '<p class="empty">Chưa có tài liệu chính thức cho màn này. Agent con cần đọc route, component, hook và API liên quan rồi gửi kết quả cho agent tổng hợp.</p>';
  const fieldRows = (doc.fields || []).map((field) => '<tr><td><code>' + escapeHtml(field.name || '-') + '</code></td><td>' + escapeHtml(field.type || '-') + '</td><td>' + escapeHtml(field.source || '-') + '</td><td>' + escapeHtml(field.defaultValue || '-') + '</td><td>' + escapeHtml(field.validation || '-') + '</td><td>' + escapeHtml(field.visibility || '-') + '</td><td>' + escapeHtml(field.disabled || '-') + '</td><td>' + escapeHtml(field.apiMapping || '-') + '</td></tr>').join("");
  const fields = fieldRows ? '<div class="source-table-wrap"><table class="source-table"><thead><tr><th>Field</th><th>Kiểu dữ liệu</th><th>Nguồn dữ liệu</th><th>Default</th><th>Validation</th><th>Hiện/ẩn</th><th>Disable/readonly</th><th>Mapping API</th></tr></thead><tbody>' + fieldRows + '</tbody></table></div>' : '<p class="empty">Agent chưa ghi chi tiết field cho màn này.</p>';
  const blocks = [
    ["Mục đích màn", doc.purpose],
    ["Luồng nghiệp vụ", doc.businessFlow],
    ["Điều kiện hiện/ẩn item", doc.visibilityRules],
    ["Event và handler", doc.events],
    ["API, query, mutation, store", doc.apis],
    ["Rủi ro khi sửa", doc.risks],
  ];
  return blocks.map(([title, items]) => '<h4 class="split-title">' + escapeHtml(title) + '</h4>' + paragraphList(items)).join("") + '<h4 class="split-title">Input, field và dữ liệu</h4>' + fields;
}

function sourceItems(items) {
  if (!items || items.length === 0) return '<p class="empty">Chưa bóc tách được tín hiệu source.</p>';
  return '<div class="source-signal-list">' + items.map((item) => '<div class="source-signal">' + (item.name ? '<strong>' + escapeHtml(item.name) + '</strong>' : '') + '<code>' + escapeHtml(item.source || '-') + '</code><span>' + escapeHtml(item.snippet || '') + '</span></div>').join("") + '</div>';
}

function fieldTable(fields) {
  if (!fields || fields.length === 0) return '<p class="empty">Chưa bóc tách được field name nào từ source cho màn này.</p>';
  return '<div class="source-table-wrap"><table class="source-table"><thead><tr><th>Field</th><th>Component</th><th>Label / Placeholder</th><th>Khi nào hiện/ẩn</th><th>Khi nào disable</th><th>Sự kiện</th><th>Source</th><th>Tín hiệu code</th></tr></thead><tbody>' +
    fields.map((field) => '<tr><td><code>' + escapeHtml(field.name) + '</code></td><td>' + escapeHtml(field.component || '-') + '</td><td>' + escapeHtml(field.label || '-') + '</td><td>' + escapeHtml(field.visibility || field.note || 'Luôn render trong vùng code được quét, hoặc điều kiện nằm ngoài vùng gần field.') + '</td><td>' + (field.disabled ? '<code>' + escapeHtml(field.disabled) + '</code>' : 'Không thấy prop disabled gần field.') + '</td><td>' + (field.event ? '<code>' + escapeHtml(field.event) + '</code>' : 'Không thấy event gần field.') + '</td><td><code>' + escapeHtml(field.source || '-') + '</code></td><td><code>' + escapeHtml(field.snippet || '-') + '</code></td></tr>').join("") +
    '</tbody></table></div>';
}

function logicBlocks(source) {
  if (!source) return '<p class="empty">Chưa có inventory source generated cho màn này.</p>';
  const blocks = [
    ["Handler và event", source.handlers],
    ["Hook, query và mutation", source.hooks],
    ["State local", source.state],
    ["useEffect / side effect", source.effects],
    ["Param trên URL", source.routeParams],
    ["API, cache, cookie/storage và điều hướng", source.apiSignals],
  ];
  return '<div class="source-detail-grid">' + blocks.map(([title, items], index) => '<details ' + (index < 2 ? 'open' : '') + '><summary>' + escapeHtml(title) + ' (' + (items?.length || 0) + ')</summary>' + sourceItems(items) + '</details>').join("") + '</div>';
}

function inventory(source) {
  if (!source) return '<p class="empty">Chưa có inventory source generated cho màn này.</p>';
  return '<div class="source-metric-grid">' +
    metric("File đã quét", source.files?.length || 0) +
    metric("Field", source.fields?.length || 0) +
    metric("Handler", source.handlers?.length || 0) +
    metric("Hook/query", source.hooks?.length || 0) +
    metric("State/effect", (source.state?.length || 0) + (source.effects?.length || 0)) +
    metric("Route/API signal", (source.routeParams?.length || 0) + (source.apiSignals?.length || 0)) +
    '</div><h4 class="split-title">File được quét từ route và import graph</h4>' + files(source.files);
}

function metric(label, value) {
  return '<div class="metric-card"><strong>' + escapeHtml(value) + '</strong><span>' + escapeHtml(label) + '</span></div>';
}

function filteredScreens() {
  const q = query.trim().toLowerCase();
  if (!q) return data.screens;
  return data.screens.filter((screen) => {
    const source = data.sourceDetails[screen.id] || {};
    const haystack = [screen.title, screen.route, screen.group, screen.appFile, ...(screen.primaryFiles || []), ...(source.fields || []).map((field) => field.name)].join(" ").toLowerCase();
    return haystack.includes(q);
  });
}

function renderNav() {
  const screens = filteredScreens();
  const byGroup = new Map();
  for (const screen of screens) {
    if (!byGroup.has(screen.group)) byGroup.set(screen.group, []);
    byGroup.get(screen.group).push(screen);
  }
  const overview = '<div class="nav-section"><button class="nav-button ' + (activeId === 'overview' ? 'active' : '') + '" data-id="overview"><strong>Tổng quan</strong><span>' + escapeHtml(data.project.description) + '</span></button></div>';
  const groups = data.groups.map((group) => {
    const groupScreens = byGroup.get(group.id) || [];
    if (query && groupScreens.length === 0) return "";
    return '<div class="nav-section"><h2 class="nav-title">' + escapeHtml(group.title) + ' (' + groupScreens.length + ')</h2>' + groupScreens.map((screen) => '<button class="nav-button ' + (activeId === screen.id ? 'active' : '') + '" data-id="' + escapeHtml(screen.id) + '"><strong>' + escapeHtml(screen.title) + '</strong><span>' + escapeHtml(screen.route) + '</span></button>').join("") + '</div>';
  }).join("");
  nav.innerHTML = overview + groups;
  nav.querySelectorAll("[data-id]").forEach((button) => button.addEventListener("click", () => setActive(button.getAttribute("data-id"))));
}

function renderOverview() {
  pageTitle.textContent = "Tổng quan dự án";
  pageSubtitle.textContent = data.project.description;
  const metrics = '<div class="metric-grid">' + data.project.metrics.map((item) => metric(item.label, item.value)).join("") + '</div>';
  const groups = '<div class="screen-grid">' + data.groups.map((group) => {
    const count = data.screens.filter((screen) => screen.group === group.id).length;
    return '<article class="screen-card" data-group="' + escapeHtml(group.id) + '"><h4>' + escapeHtml(group.title) + '</h4><span class="route">' + count + ' màn</span><p>' + escapeHtml(group.description) + '</p></article>';
  }).join("") + '</div>';
  const layers = data.project.layers?.length ? '<div class="layer-grid">' + data.project.layers.map((layer) => '<article class="layer-card"><span class="layer-count">' + escapeHtml(layer.count) + ' node</span><h4>' + escapeHtml(layer.name) + '</h4><p>' + escapeHtml(layer.description || '') + '</p></article>').join("") + '</div>' : '<p class="empty">Không tìm thấy layer từ Understand Anything.</p>';
  mainPanel.innerHTML = section("Tài liệu chính thức", "Phần này do Codex agent tổng hợp sau khi các agent con phân tích từng màn.", officialOverview()) + section("Chỉ số dự án", "Tổng hợp từ source code và Understand Anything knowledge graph nếu có.", metrics) + section("Nhóm màn", "Các màn được phát hiện tự động từ route.", groups) + section("Layer từ Understand Anything", "Nếu project đã chạy Understand Anything, layer trong graph sẽ hiển thị ở đây.", layers);
  mainPanel.querySelectorAll("[data-group]").forEach((card) => card.addEventListener("click", () => {
    const first = data.screens.find((screen) => screen.group === card.getAttribute("data-group"));
    if (first) setActive(first.id);
  }));
}

function renderScreen(screen) {
  const source = data.sourceDetails[screen.id];
  pageTitle.textContent = screen.title;
  pageSubtitle.textContent = "Route " + screen.route + " - " + screen.appFile;
  const summary = '<div class="two-col"><div><span class="route">' + escapeHtml(screen.route) + '</span><p>Đây là tài liệu tự động sinh cho màn, gồm file route, import graph, field, logic hiện/ẩn, disable, event và các tín hiệu API/state.</p></div><div><h4 class="split-title">Nhóm màn</h4><div class="tag-list"><span class="tag">' + escapeHtml(screen.group) + '</span></div></div></div>';
  const filesBody = '<h4 class="split-title">File chính</h4>' + files(screen.primaryFiles) + '<div style="height:18px"></div><h4 class="split-title">Route entry</h4>' + files([screen.appFile]);
  mainPanel.innerHTML =
    section("Tài liệu chính thức của màn", "Nội dung nghiệp vụ do agent con phân tích và agent tổng hợp chuẩn hoá.", officialScreenDoc(screen)) +
    section("Tóm tắt màn", "Màn này được phát hiện từ route/file nào.", summary) +
    section("File và ownership", "Route entry, file import trực tiếp và file hỗ trợ.", filesBody) +
    section("Inventory bóc tách từ source", "Sinh từ route entry, file chính và import graph gần màn.", inventory(source)) +
    section("Field, hiện/ẩn, disable và sự kiện", "Danh sách field name bóc tách từ code, kèm điều kiện render/disable/event gần field nếu có.", fieldTable(source?.fields)) +
    section("Logic bóc tách từ source", "Handler, hook/query/mutation, state, URL param, cache, cookie/storage và điều hướng tìm thấy trong source.", logicBlocks(source));
}

function setActive(id) {
  activeId = id;
  renderNav();
  if (id === "overview") renderOverview();
  else {
    const screen = data.screens.find((item) => item.id === id);
    if (screen) renderScreen(screen);
    else renderOverview();
  }
}

searchInput.addEventListener("input", (event) => {
  query = event.target.value;
  renderNav();
});
overviewButton.addEventListener("click", () => setActive("overview"));
printButton.addEventListener("click", () => window.print());
renderNav();
renderOverview();
`;

const css = String.raw`
:root {
  color-scheme: light;
  --bg: #f4f7fb;
  --surface: #fff;
  --surface-soft: #f8fafc;
  --ink: #172033;
  --muted: #637083;
  --subtle: #d9e2ec;
  --accent: #0f766e;
  --accent-strong: #0b5d56;
  --accent-soft: #dff5f1;
  --blue: #2457c5;
  --blue-soft: #e8eefc;
  --shadow: 0 20px 45px rgba(27, 39, 61, 0.08);
}
* { box-sizing: border-box; }
body {
  margin: 0;
  min-height: 100vh;
  background: linear-gradient(135deg, rgba(15,118,110,.08), rgba(36,87,197,.06)), var(--bg);
  color: var(--ink);
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
button, input { font: inherit; }
.app-shell { display: grid; grid-template-columns: 320px minmax(0, 1fr); min-height: 100vh; }
.sidebar { position: sticky; top: 0; height: 100vh; overflow: auto; padding: 24px; background: rgba(255,255,255,.9); border-right: 1px solid var(--subtle); backdrop-filter: blur(16px); }
.brand { display: flex; gap: 12px; align-items: center; margin-bottom: 24px; }
.brand-mark { display: grid; place-items: center; width: 44px; height: 44px; border-radius: 8px; background: var(--ink); color: white; font-weight: 800; }
.brand h1 { margin: 0; font-size: 18px; }
.brand p { margin: 4px 0 0; color: var(--muted); font-size: 12px; }
.search { display: grid; gap: 8px; margin-bottom: 20px; color: var(--muted); font-size: 12px; font-weight: 800; text-transform: uppercase; }
.search input { width: 100%; border: 1px solid var(--subtle); border-radius: 8px; padding: 11px 12px; outline: none; }
.search input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
.nav-section { margin-bottom: 18px; }
.nav-title { margin: 0 0 8px; color: var(--muted); font-size: 12px; font-weight: 800; text-transform: uppercase; }
.nav-button { display: block; width: 100%; border: 0; border-radius: 8px; margin-bottom: 4px; padding: 10px 12px; background: transparent; color: var(--ink); text-align: left; cursor: pointer; }
.nav-button:hover { background: var(--surface-soft); }
.nav-button.active { background: var(--accent-soft); color: var(--accent-strong); font-weight: 700; }
.nav-button strong { display: block; font-size: 13px; line-height: 1.3; }
.nav-button span { display: block; margin-top: 3px; color: var(--muted); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.content { min-width: 0; padding: 32px; }
.hero { display: flex; justify-content: space-between; gap: 24px; max-width: 1180px; margin: 0 auto 24px; }
.eyebrow { margin: 0 0 8px; color: var(--accent); font-size: 12px; font-weight: 800; text-transform: uppercase; }
.hero h2 { margin: 0; font-size: 34px; line-height: 1.12; }
.hero p:last-child { max-width: 760px; margin: 10px 0 0; color: var(--muted); line-height: 1.7; }
.hero-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.hero-actions button { border: 1px solid var(--subtle); border-radius: 8px; padding: 10px 14px; background: var(--surface); cursor: pointer; }
.panel { max-width: 1180px; margin: 0 auto; }
.section { margin-bottom: 20px; border: 1px solid var(--subtle); border-radius: 8px; background: var(--surface); box-shadow: var(--shadow); overflow: hidden; }
.section-header { padding: 20px 22px; border-bottom: 1px solid var(--subtle); background: var(--surface-soft); }
.section-header h3 { margin: 0; font-size: 18px; }
.section-header p { margin: 7px 0 0; color: var(--muted); line-height: 1.6; }
.section-body { padding: 22px; }
.metric-grid, .source-metric-grid, .layer-grid, .screen-grid { display: grid; gap: 12px; }
.metric-grid, .source-metric-grid { grid-template-columns: repeat(5, minmax(0, 1fr)); }
.layer-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.screen-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.metric-card, .layer-card, .screen-card, .file-chip, .source-signal { border: 1px solid var(--subtle); border-radius: 8px; background: var(--surface); }
.metric-card { padding: 16px; }
.metric-card strong { display: block; font-size: 24px; }
.metric-card span { display: block; margin-top: 4px; color: var(--muted); font-size: 12px; font-weight: 800; text-transform: uppercase; }
.layer-card, .screen-card { padding: 16px; }
.screen-card { cursor: pointer; }
.screen-card:hover { border-color: var(--accent); }
.layer-count, .tag { display: inline-block; border-radius: 999px; padding: 4px 8px; background: var(--blue-soft); color: var(--blue); font-size: 12px; font-weight: 800; }
.route { display: inline-block; max-width: 100%; margin-bottom: 10px; border-radius: 8px; padding: 5px 8px; background: var(--surface-soft); color: var(--blue); font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 12px; overflow-wrap: anywhere; }
.two-col { display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(280px, .8fr); gap: 18px; }
.file-list, .tag-list { display: flex; flex-wrap: wrap; gap: 8px; }
.file-chip { max-width: 100%; padding: 8px 10px; color: var(--blue); font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 12px; overflow-wrap: anywhere; }
.split-title { margin: 0 0 12px; font-size: 14px; text-transform: uppercase; }
.source-table-wrap { overflow: auto; border: 1px solid var(--subtle); border-radius: 8px; }
.source-table { width: 100%; min-width: 1420px; border-collapse: collapse; font-size: 12px; }
.source-table th, .source-table td { border-bottom: 1px solid var(--subtle); padding: 10px; text-align: left; vertical-align: top; }
.source-table th { position: sticky; top: 0; background: var(--surface-soft); color: var(--muted); font-size: 11px; text-transform: uppercase; }
.source-table code, .source-signal code { color: var(--blue); font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; overflow-wrap: anywhere; }
.source-detail-grid { display: grid; gap: 12px; }
.source-detail-grid details { border: 1px solid var(--subtle); border-radius: 8px; background: var(--surface); }
.source-detail-grid summary { cursor: pointer; padding: 13px 14px; font-weight: 800; }
.source-signal-list { display: grid; gap: 8px; max-height: 520px; overflow: auto; padding: 0 14px 14px; }
.official-list { display: grid; gap: 8px; margin-bottom: 16px; }
.official-list p { margin: 0; border-left: 3px solid var(--accent); padding: 8px 10px; background: var(--surface-soft); color: var(--ink); line-height: 1.6; }
.source-signal { display: grid; gap: 4px; padding: 10px; background: var(--surface-soft); }
.source-signal span, .layer-card p, .screen-card p { color: var(--muted); font-size: 13px; line-height: 1.55; overflow-wrap: anywhere; }
.empty { padding: 30px; color: var(--muted); text-align: center; }
@media (max-width: 980px) {
  .app-shell { grid-template-columns: 1fr; }
  .sidebar { position: static; height: auto; }
  .content { padding: 20px; }
  .hero, .two-col { display: block; }
  .hero-actions { margin-top: 16px; }
  .metric-grid, .source-metric-grid, .layer-grid, .screen-grid { grid-template-columns: 1fr; }
}
@media print {
  body { background: white; }
  .sidebar, .hero-actions, .search { display: none; }
  .app-shell { display: block; }
  .content { padding: 0; }
  .section { box-shadow: none; break-inside: avoid; }
}
`;

function buildAgentTasks(data) {
  const screenTasks = data.screens.map((screen) => {
    const source = data.sourceDetails[screen.id] || {};
    return {
      id: "screen-" + screen.id,
      type: "screen-analysis",
      title: screen.title,
      route: screen.route,
      group: screen.group,
      appFile: screen.appFile,
      files: source.files || screen.primaryFiles || [screen.appFile],
      output: {
        screenId: screen.id,
        writeTarget: "Trả kết quả về parent Codex; parent/agent tổng hợp sẽ cập nhật docs/understand-portal/official-docs.generated.js",
        requiredSections: [
          "purpose",
          "businessFlow",
          "fields",
          "visibilityRules",
          "events",
          "apis",
          "risks",
        ],
      },
      prompt:
        "Đọc kỹ code của màn " +
        screen.title +
        " (" +
        screen.route +
        "). Trả tài liệu tiếng Việt có dấu, nêu field/input, kiểu dữ liệu, default, validation, source data, mapping API, điều kiện hiện/ẩn, disable/readonly, event, query/mutation/store và rủi ro khi sửa.",
    };
  });

  return {
    version: 1,
    generatedAt: data.generatedAt,
    project: data.project,
    agentOutput: {
      manifestFile: "docs/understand-portal/agent-manifest.json",
      taskFile: "docs/understand-portal/agent-tasks.json",
      reportsDirectory: "docs/understand-portal/agent-reports",
      reportFilePattern: "{screenId}.json",
      reviewReportFile: "docs/understand-portal/agent-reports/review-report.json",
      finalOutputFile: "docs/understand-portal/official-docs.generated.js",
    },
    strategy: {
      description:
        "Codex parent đọc manifest này, spawn agent con để phân tích từng màn hoặc từng batch nhỏ, sau đó spawn/mời một agent tổng hợp chuẩn hoá thành tài liệu chính thức.",
      recommendedMaxParallelAgents: 6,
      batchingRule:
        "Nếu số màn lớn hơn 6, chia theo group hoặc 3-5 màn/agent; màn phức tạp nên dùng 1 agent riêng.",
      finalOutputFile: "docs/understand-portal/official-docs.generated.js",
    },
    tasks: screenTasks,
    reviewTask: {
      id: "screen-docs-reviewer",
      type: "review",
      inputFiles: [
        "docs/understand-portal/agent-tasks.json",
        "docs/understand-portal/agent-manifest.json",
        "docs/understand-portal/agent-reports/*.json hoặc kết quả trả về từ từng screen-analysis agent",
      ],
      outputFile: "docs/understand-portal/agent-reports/review-report.json",
      samplingRule:
        "Với mỗi màn, chọn một vài keyword/claim quan trọng từ tài liệu agent con sinh ra: field name, API endpoint, permission, điều kiện hiện/ẩn, event, route param, storage/cookie/store. Đối chiếu trực tiếp với source refs hoặc grep trong files của task.",
      passCriteria: [
        "Các keyword/claim chính có source thật trong file được giao.",
        "Không phát hiện field/API/permission/điều kiện hiện/ẩn bị bịa hoặc mapping sai.",
        "Claim mơ hồ phải được đánh dấu là chưa chắc, không đưa thẳng vào tài liệu chính thức.",
      ],
      failureProtocol: [
        "Không gửi kết quả lỗi cho aggregator.",
        "Gửi feedback quay lại đúng screen-analysis agent đã tạo report bằng send_input, nêu rõ claim sai và source cần kiểm tra.",
        "Yêu cầu agent đó sửa report của chính màn được giao.",
        "Reviewer kiểm lại phần đã sửa. Chỉ khi không còn lỗi blocking mới cho phép aggregation.",
      ],
      reviewOutputShape: {
        status: "pass | needs_revision",
        checkedScreens: [
          {
            screenId: "string",
            status: "pass | needs_revision",
            sampledKeywords: ["string"],
            findings: [
              {
                severity: "blocking | warning",
                claim: "string",
                reason: "string",
                expectedSource: "string",
                sendBackToAgent: "screen task id",
              },
            ],
          },
        ],
      },
    },
    aggregationTask: {
      id: "official-docs-aggregator",
      type: "aggregation",
      inputFiles: [
        "docs/understand-portal/data.js",
        "docs/understand-portal/agent-tasks.json",
        ".understand-anything/knowledge-graph.json nếu có",
      ],
      outputFile: "docs/understand-portal/official-docs.generated.js",
      outputShape: {
        overview: {
          summary: ["string"],
          architecture: ["string"],
          dataFlows: ["string"],
          risks: ["string"],
        },
        screens: {
          "[screenId]": {
            purpose: ["string"],
            businessFlow: ["string"],
            fields: [
              {
                name: "string",
                type: "string",
                source: "string",
                defaultValue: "string",
                validation: "string",
                visibility: "string",
                disabled: "string",
                apiMapping: "string",
              },
            ],
            visibilityRules: ["string"],
            events: ["string"],
            apis: ["string"],
            risks: ["string"],
          },
        },
      },
    },
  };
}

function emptyOfficialDocsTemplate() {
  return [
    "window.UNDERSTAND_OFFICIAL_DOCS = {",
    "  overview: null,",
    "  screens: {},",
    "};",
    "",
  ].join("\n");
}

function codexBriefTemplate(data) {
  const screens = data.screens
    .map((screen) => "- " + screen.title + ": " + screen.route + " (" + screen.appFile + ")")
    .join("\n");

  return [
    "# Codex Brief - Enrich Understand Docs Portal",
    "",
    "Portal đã được sinh tự động từ tool Understand Docs Portal.",
    "",
    "## Mục tiêu",
    "",
    "Dùng Codex để đọc source code + Understand Anything knowledge graph rồi nâng cấp portal thành bộ tài liệu chi tiết, giống dạng tài liệu nghiệp vụ đầy đủ:",
    "",
    "- Tổng quan kiến trúc dự án",
    "- Danh sách màn/route theo nhóm",
    "- Với từng màn: input/field, kiểu dữ liệu, validation, default value, source data",
    "- Khi nào field/item hiển thị hoặc ẩn",
    "- Khi nào field/item disable hoặc readonly",
    "- Event liên quan: onChange, onClick, onSubmit, onBlur, onSearch",
    "- API/query/mutation/store/cookie/sessionStorage/localStorage liên quan",
    "- Luồng dữ liệu và logic nghiệp vụ của từng màn",
    "- Rủi ro kiến trúc và điểm cần chú ý khi sửa code",
    "- Toàn bộ mô tả bằng tiếng Việt có dấu",
    "",
    "## Project",
    "",
    "- Tên: " + data.project.title,
    "- Root: " + data.project.root,
    "- Số màn phát hiện: " + data.screens.length,
    "- Portal output: docs/understand-portal",
    "",
    "## Các màn đã phát hiện",
    "",
    screens,
    "",
    "## Workflow Codex nhiều agent",
    "",
    "Sau khi CLI quét xong route và import graph, Codex phải dùng manifest sau:",
    "",
    "- `docs/understand-portal/agent-tasks.json`: danh sách task phân tích từng màn.",
    "- `docs/understand-portal/official-docs.generated.js`: file tài liệu chính thức để portal render.",
    "",
    "Quy trình bắt buộc:",
    "",
    "1. Parent Codex đọc `agent-tasks.json` và `data.js`.",
    "2. Parent Codex spawn agent con cho từng màn, hoặc chia batch 3-5 màn/agent nếu số màn quá lớn.",
    "3. Mỗi agent con chỉ đọc source thuộc màn được giao: route, component, hook, API, store, validation, permission.",
    "4. Mỗi agent con trả kết quả theo contract: purpose, businessFlow, fields, visibilityRules, events, apis, risks.",
    "5. Parent Codex giữ các agent con còn mở, chưa đóng thread.",
    "6. Parent Codex spawn một review agent theo `reviewTask` để kiểm mẫu keyword/claim chính trong tài liệu từng màn so với source.",
    "7. Nếu reviewer phát hiện sai, parent gửi feedback quay lại đúng agent con đã sinh report đó để sửa. Reviewer kiểm lại đến khi không còn lỗi blocking.",
    "8. Chỉ sau khi reviewer pass, parent mới spawn/mời agent tổng hợp hoặc tự tổng hợp nếu ít màn.",
    "9. Agent tổng hợp cập nhật `official-docs.generated.js` đúng shape trong `agent-tasks.json.aggregationTask.outputShape`.",
    "10. Verify portal vẫn chạy ở `http://127.0.0.1:5174/`.",
    "",
    "## Prompt dùng với Codex",
    "",
    "Dán prompt dưới đây cho Codex trong project cần sinh tài liệu. Prompt này đã ghi rõ quyền dùng multi-agent để Codex runtime được phép spawn agent con:",
    "",
    "```text",
    "Hãy dùng workflow multi-agent/agent con của understand-docs để sinh tài liệu chi tiết cho dự án này. Đây là yêu cầu rõ ràng: Codex được phép spawn agent con để phân tích từng màn và dùng một agent/lượt tổng hợp để tạo tài liệu chính thức.",
    "",
    "Dựa vào Understand Anything knowledge graph, source code và portal đã sinh tại docs/understand-portal, hãy enrich tài liệu thành bộ tài liệu chi tiết bằng tiếng Việt có dấu.",
    "",
    "Yêu cầu:",
    "1. Đọc .understand-anything/knowledge-graph.json nếu có.",
    "2. Đọc docs/understand-portal/data.js và docs/understand-portal/agent-tasks.json để biết các màn tool đã phát hiện.",
    "3. Spawn agent con để phân tích từng màn hoặc từng batch nhỏ theo agent-tasks.json/agent-manifest.json. Không tự làm single-agent nếu đã có quyền multi-agent.",
    "4. Mỗi agent con phải đọc source code của route/component/hook/API liên quan và trả tài liệu nghiệp vụ.",
    "5. Trước khi tổng hợp, spawn một review agent để kiểm tra một vài keyword/claim chính của report từng màn với source code.",
    "6. Nếu review agent thấy sai, gửi lại feedback cho chính agent con đã sinh report đó để sửa; review lại đến khi không còn lỗi blocking.",
    "7. Sau khi reviewer pass, mới dùng agent tổng hợp chuẩn hoá kết quả và cập nhật docs/understand-portal/official-docs.generated.js.",
    "8. Mỗi màn phải có:",
    "   - Mục đích màn",
    "   - File chính và ownership",
    "   - Input/field/item trên màn",
    "   - Kiểu dữ liệu từng field",
    "   - Giá trị default, source data, mapping API param",
    "   - Validation/rules",
    "   - Khi nào hiện/ẩn",
    "   - Khi nào disable/readonly",
    "   - Event liên quan",
    "   - API/query/mutation/store/cookie/storage liên quan",
    "   - Luồng xử lý submit/search/update",
    "   - Ghi chú rủi ro khi sửa logic",
    "9. Giữ portal chạy được bằng static server.",
    "10. Không chỉ liệt kê code thô; hãy giải thích nghiệp vụ theo source.",
    "",
    "Sau khi sửa, verify bằng DevTools tại http://127.0.0.1:5174/.",
    "```",
    "",
    "## Cách chạy portal",
    "",
    "```bash",
    "python3 -m http.server 5174 --bind 127.0.0.1 --directory docs/understand-portal",
    "```",
    "",
  ].join("\n");
}
function writePortal(args, data) {
  try {
    fs.mkdirSync(args.out, { recursive: true });
  } catch (error) {
    console.error(`Lỗi: không tạo được thư mục output: ${args.out}`);
    console.error(error?.message || String(error));
    process.exit(1);
  }
  fs.writeFileSync(path.join(args.out, "index.html"), htmlTemplate(data.project.title));
  fs.writeFileSync(path.join(args.out, "styles.css"), css);
  const agentTasks = buildAgentTasks(data);
  const agentReportsDir = path.join(args.out, "agent-reports");
  fs.mkdirSync(agentReportsDir, { recursive: true });
  fs.writeFileSync(path.join(args.out, "app.js"), appJs);
  fs.writeFileSync(path.join(args.out, "data.js"), `window.UNDERSTAND_DOCS_DATA = ${JSON.stringify(data, null, 2)};\n`);
  fs.writeFileSync(path.join(args.out, "agent-tasks.json"), JSON.stringify(agentTasks, null, 2) + "\n");
  fs.writeFileSync(path.join(args.out, "agent-manifest.json"), JSON.stringify(agentTasks, null, 2) + "\n");
  fs.writeFileSync(path.join(agentReportsDir, ".gitkeep"), "");
  fs.writeFileSync(path.join(args.out, "official-docs.generated.js"), emptyOfficialDocsTemplate());
  fs.writeFileSync(path.join(args.out, "codex-brief.md"), codexBriefTemplate(data));
}

function displayPath(root, target) {
  const rel = normalize(path.relative(root, target));
  return rel.startsWith("..") ? normalize(target) : rel || ".";
}

const args = parseArgs(process.argv.slice(2));
validateArgs(args);
const data = buildData(args.root, args);
writePortal(args, data);

console.log(`Đã sinh portal tài liệu: ${displayPath(args.root, args.out)}`);
console.log(`Số màn phát hiện: ${data.screens.length}`);
console.log(`Chạy thử: python3 -m http.server 5174 --bind 127.0.0.1 --directory ${displayPath(args.root, args.out)}`);
