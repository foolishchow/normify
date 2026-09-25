# Action 状态

本文档是所有正式 Action 当前状态与位置的唯一权威。

## 状态模型

| 状态 | 含义 |
| --- | --- |
| `draft` | 范围或收尾定义未完成；未授权实施。 |
| `ready` | 需求、设计、计划、验收、验证定义充分，可执行。 |
| `in_progress` | 已明确授权的实施或验证进行中。 |
| `blocked` | 具体条件阻碍进展；Action 保持活跃。 |
| `complete` | 必备验收通过、证据已记录、持久结论已回流。 |
| `superseded` | 另一个 Action 或已接受决策取代了本工作。 |
| `deferred` | 明确决策推迟了本工作。 |

## 维护规则

- 创建正式 Action 时添加且仅添加一行；初始用 `draft`。
- 保持 Action README 状态与本表一致。
- 状态、摘要、日期、路径、导航、归档位置作为一次连贯变更同步更新。
- `draft` / `ready` / `in_progress` / `blocked` 置于 `docs/actions/<action-id>/` 下。
- 终态 Action 移入对应 `_archive/` 位置。
- 变更状态需明确授权且满足目标门禁。
- `complete` 前需必备验收通过、实际验证证据、持久结论回流。

## Actions

_（无活跃 Action。）_

## Archive

| Action | Status | Path | Summary | Updated |
| --- | --- | --- | --- | --- |
| `catalog-extraction` | `complete` | [README](_archive/complete/catalog-extraction/README.md) | 抽出平台无关的 `src/catalog.ts`，`tools.ts` 退化为 DSH 适配器，DSH 行为零回归。8 条验收全过，§9 Q1 已回流。 | 2026-09-25 |
| `mcp-server` | `complete` | [README](_archive/complete/mcp-server/README.md) | 加 `src/mcp/server.ts`（MCP stdio server，`tools/list`+`tools/call` 复用 catalog），证明目录跨平台可复用。9 条验收全过，§9 Q2 已回流。 | 2026-09-25 |
| `mcp-annotations` | `complete` | [README](_archive/complete/mcp-annotations/README.md) | S2：`tools/list` 按 behavior 派生 MCP annotations + `tools/call` 错误载荷模型可读格式化。7 MUST+2 SHOULD 验收全过（A-008 豁免），无 §9 决断。 | 2026-09-25 |
| `pi-extension` | `complete` | [README](_archive/complete/pi-extension/README.md) | S3：加 `src/pi/normify.ts`（pi 扩展，JSON Schema→typebox 投影含 StringEnum + formatResultText 错误格式化），`pi.registerTool` 复用 catalog。9 条验收全过（A-008 headless 模拟），§9 Q3 已回流。 | 2026-09-25 |
| `setup-guide` | `complete` | [README](_archive/complete/setup-guide/README.md) | S4：新增 `docs/MULTIPLATFORM-SETUP.md`（各宿主安装指南，DSH/MCP/pi + env 区分 DSH Config）+ §9 Q4 回流 + §3.2 L145 stale 修复。纯文档零代码，6 验收全过。 | 2026-09-25 |
| `companion-migration` | `complete` | [README](_archive/complete/companion-migration/README.md) | S5：迁移 companion 提醒钩子到 MCP（behavior 代理）+ pi（tool_result REPLACE）+ 共享 `src/companion.ts`（companionReminder/parseCompanionConfig/WRITE_TOOLS）+ §6.3/§5.2/§9 Q5Q6/SETUP.md 4 项回流。代码+测试，6 验收全过。 | 2026-09-25 |
