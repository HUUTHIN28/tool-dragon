# Understand Docs Portal Tool

Tool này sinh một portal tài liệu HTML tĩnh cho một dự án frontend khác, dựa trên:

- Route/page files trong `src/app`, `app`, `src/pages`, `pages`
- Import graph gần từng màn
- `.understand-anything/knowledge-graph.json` nếu dự án đã chạy Understand Anything
- Field `name`, label/placeholder, điều kiện hiện/ẩn, prop `disabled`, event, hook/query/mutation, state, URL param, cookie/storage/cache/navigation signal

## Chạy cho dự án bất kỳ


```bash
/home/thinnh2/.understand-anything/tools/understand-docs/understand-docs.mjs --root /path/to/other-project --out docs/understand-portal
```

Sau đó trong project kia:

```bash
python3 -m http.server 5174 --bind 127.0.0.1 --directory docs/understand-portal
```

## Tuỳ chọn

```bash
/home/thinnh2/.understand-anything/tools/understand-docs/understand-docs.mjs \
  --root /path/to/project \
  --out docs/understand-portal \
  --title "Tên dự án" \
  --max-files 80 \
  --max-fields 220 \
  --max-signals 180
```

## Output

Tool sẽ sinh:

- `index.html`
- `styles.css`
- `app.js`
- `data.js`
- `agent-tasks.json` và `agent-manifest.json`: manifest để Codex chia agent con theo từng màn hoặc batch nhỏ.
- `agent-reports/`: thư mục dành cho report từng agent con nếu muốn lưu dạng JSON.
- `official-docs.generated.js`: nơi agent tổng hợp ghi tài liệu chính thức để portal render.
- `codex-brief.md`: prompt/workflow cho Codex.

Portal chạy offline, không cần backend và không cần dependency npm mới.

## Workflow với Codex agent

Lưu ý: CLI Node chỉ sinh portal và manifest. Agent con chỉ được tạo bởi Codex runtime. Khi gọi Codex, hãy nói rõ "dùng multi-agent/agent con" để Codex được phép spawn agent.

Prompt khuyến nghị:

```text
Hãy dùng workflow multi-agent/agent con của understand-docs để sinh tài liệu chi tiết cho dự án này. Codex được phép spawn agent con để phân tích từng màn và dùng một agent/lượt tổng hợp để tạo tài liệu chính thức.
```

1. Chạy CLI để quét route/import graph và sinh portal.
2. Mở `docs/understand-portal/agent-tasks.json`.
3. Codex parent spawn agent con theo từng màn, hoặc batch 3-5 màn nếu dự án nhiều route.
4. Mỗi agent con đọc source chi tiết của màn được giao và trả về: mục đích màn, field/input, kiểu dữ liệu, default, validation, hiện/ẩn, disable/readonly, event, API/query/mutation/store, rủi ro.
5. Một review agent kiểm tra mẫu keyword/claim chính trong report từng màn với source code.
6. Nếu reviewer phát hiện sai, feedback được gửi lại đúng agent con đã sinh report đó để sửa, rồi review lại.
7. Khi reviewer pass, một agent tổng hợp chuẩn hoá kết quả và cập nhật `docs/understand-portal/official-docs.generated.js`.
8. Chạy static server để xem tài liệu chính thức trên web.
