# Understand Code Workflow Tool

Tool này tạo manifest coding workflow dựa trên task, source code và Understand Anything graph nếu có.

CLI không tự spawn agent. Agent con là khả năng runtime của Codex. CLI sinh `workflow-manifest.json` và `codex-brief.md` để Codex parent điều phối.

## Chạy

```bash
/home/thinnh2/.understand-anything/tools/understand-code/understand-code.mjs \
  --root /path/to/project \
  --task "Mô tả task cần sửa"
```

Output mặc định:

```text
<project>/.understand-code/runs/run-.../
```

## Pipeline

1. Impact checker đọc task + Understand graph để xác định phần cần sửa.
2. Planner và Test-risk designer chạy song song sau impact.
3. Implementer code theo plan.
4. Reviewer review diff theo test-risk matrix.
5. Nếu task chạm UI/route/component/browser behavior, reviewer bắt buộc dùng MCP Chrome DevTools để test giao diện và logic; nếu reviewer không dùng được thì parent Codex phải chạy DevTools trước final.
6. Nếu sai, feedback quay lại implementer để sửa rồi review lại.
7. Khi reviewer pass, chạy `cleanup-after-review.mjs` để xoá artifact tạm như plan, test case/risk matrix và implementation report.
