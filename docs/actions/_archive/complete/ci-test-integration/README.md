# CI 测试接入

- Action: `ci-test-integration`
- Status: `complete`
- Updated: 2026-09-25
- Status authority: [Action Status](../../../STATUS.md)
- Closure: 2026-09-25 — `complete`（5/5 验收 passed，user 授权归档）。

## Background

多平台迁移（S0–S5）产出了 3 个平台投影测试套件，目前**手动运行**，未接入 `npm test`：

| 套件 | 来源 | 现状 | PASS 数 |
| --- | --- | --- | --- |
| `tests/mcp-smoke.mjs` | S1/S2/S5 | 手动 | 36 |
| `tests/pi-projection.mjs` | S3/S5 | 手动 | 36 |
| `tests/companion-snapshot.mjs` | S5 | 手动 | 3 |

`npm test` 当前仅含 5 套 DSH engine/companion/regression 测试：

```text
engine-e2e && companion-e2e && regression-0.5.2 && regression-0.5.3 && regression-0.5.4
```

设计文档（`docs/MULTIPLATFORM.zh-CN.md` L255）S6 行原列两项：
1. `ci-contract-check.cjs` 同时查 catalog —— **S0 已完成**（脚本读 `lib/catalog.js`，数 31 工具，校验 `normify_project_init`/`normify_help`/`normify_module_batch` 在列，校验名 provider-safe）。
2. 加 `tests/mcp-smoke.mjs` 进 `npm test` —— **本 Action 范围**（且 S3/S5 又新增 pi-projection / companion-snapshot 两套，一并接入）。

### Scope authority（扩展依据）

设计文档 S6 行只列 `mcp-smoke.mjs`，但本 Action 扩展到全 3 套，依据：

- `tests/pi-projection.mjs` 由 S3 `pi-extension`（已归档 complete）产出；`tests/companion-snapshot.mjs` 由 S5 `companion-migration`（已归档 complete）产出——两套已存在且独立 PASS。
- S6 行验收为"CI 全绿"，意图覆盖全部平台投影（MCP/pi/companion）回归，非仅 MCP 一套。
- 该扩展经 Readiness review R1 F-001 escalate，由 user 明确授权（选项 a）采用三套接入。

**问题**：MCP/pi/companion 三平台的回归不被 `npm test` 覆盖；若 catalog/server/projection/companion 被改坏而 DSH engine 测试未触发，CI 仍绿，缺陷逃逸。

## Goal

`npm test` 一次运行覆盖全部 8 套测试（5 DSH + 3 平台投影）；任一套件失败则 `npm test` 非零退出。

## Non-goals

- 不新增测试用例（仅接入现有 3 套）。
- 不修改任何 `tests/*.mjs` 文件内容。
- 不改动 `ci-contract-check.cjs`（S0 已就绪，本 Action 验证其仍通过即可）。
- 不加 `pretest` 自动 build 钩子（保持现有"先 build 后 test"约定，dev 友好）。
- 不发布、不动 tsconfig、不动 SDK 版本。

## Scope

- **仅** `package.json` 的 `scripts.test` 字段：在现有 `&&` 链尾追加 3 个 `node tests/<suite>.mjs`。
- 不触碰其他文件。

## Design inputs

- `package.json`（scripts.test 现状）。
- `tests/mcp-smoke.mjs`、`tests/pi-projection.mjs`、`tests/companion-snapshot.mjs`（已存在且独立 PASS）。
- `ci-contract-check.cjs`（S0 已查 catalog）。
- `docs/MULTIPLATFORM.zh-CN.md` §7 S6 行（L255）。
- 既有约定：所有测试 import `lib/`（编译产物），`npm test` 不含 build，运行前需 `npm run build`。

## Requirements

- **R-001 MUST**：`npm test` 执行全部 8 套测试（5 现有 + mcp-smoke + pi-projection + companion-snapshot）。
- **R-002 MUST**：任一套件非零退出时 `npm test` 整体非零（`&&` 链短路）。
- **R-003 MUST**：不修改任何 `tests/*.mjs` 文件内容（`git diff tests/` 仅可能的非内容变更或为空）。
- **R-004 SHOULD**：套件顺序合理——DSH engine 基线在前，平台投影在后（mcp-smoke → pi-projection → companion-snapshot）。

## Proposed design

在 `package.json` 的 `scripts.test` 现有链尾追加：

```diff
- "test": "node tests/engine-e2e.mjs && node tests/companion-e2e.mjs && node tests/regression-0.5.2.mjs && node tests/regression-0.5.3.mjs && node tests/regression-0.5.4.mjs"
+ "test": "node tests/engine-e2e.mjs && node tests/companion-e2e.mjs && node tests/regression-0.5.2.mjs && node tests/regression-0.5.3.mjs && node tests/regression-0.5.4.mjs && node tests/mcp-smoke.mjs && node tests/pi-projection.mjs && node tests/companion-snapshot.mjs"
```

顺序依据：engine/companion/regression 是 DSH 基线（最快定位 DSH 回归）；mcp-smoke 启动子进程较重置后；pi-projection 纯导入断言；companion-snapshot 最轻收尾。

## Implementation plan

- **P-001** ✅：编辑 `package.json` `scripts.test`，追加 3 个 `&& node tests/<suite>.mjs`。
- **P-002** ✅：`npm run build && npm test`，确认 8 套全跑、退出 0、无 FAIL。
- **P-003** ✅：`git diff --stat tests/` 确认零测试内容变更；`node ci-contract-check.cjs` 确认仍通过。

## Acceptance

| ID | Requirement | Observable condition | Planned evidence | Status |
| --- | --- | --- | --- | --- |
| A-001 | R-001 | `npm test` 输出含全部 8 套的 PASS 汇总 | `npm test` stdout | passed |
| A-002 | R-002 | 人为注入一临时 FAIL（如 `exit 1` 临时塞入某套件首行）后 `npm test` 非零，移除后恢复 | 临时实验 + 退出码 | passed |
| A-003 | R-001 | `node -e "console.log(require('./package.json').scripts.test)"` 含 `mcp-smoke`/`pi-projection`/`companion-snapshot` 三个文件名 | 命令输出 | passed |
| A-004 | R-003 | `git diff --stat tests/` 为空 | git 输出 | passed |
| A-005 | — | `node ci-contract-check.cjs` 退出 0（S0 contract 仍绿） | 命令退出码 + "bundle + tool-name contract ok" | passed |

## Validation

记录计划命令（与实际执行分离）：

- `npm run build`（前置，产物 lib/）
- `npm test`（应跑 8 套）
- `node -e "console.log(require('./package.json').scripts.test)"`
- `git diff --stat tests/`
- `node ci-contract-check.cjs`

### Actual

| Field | Actual value |
| --- | --- |
| Date | 2026-09-25 |
| Commit | （未提交；工作区改动：`package.json` + Action README + STATUS.md） |
| Environment | node + npm；`lib/` 经 `npm run build` 重建 |

| Acceptance | Command or observation | Exit/result | Evidence | Result |
| --- | --- | --- | --- | --- |
| A-001 | `npm test` | `0` | 8 套全跑全 PASS（engine-e2e / companion-e2e / regression-0.5.2/0.5.3/0.5.4 / mcp-smoke 36 / pi-projection 36 / companion-snapshot 3） | passed |
| A-002 | 临时在 `companion-snapshot.mjs` 首行注入 `process.exit(1)`，跑 `npm test`；后 revert | 注入→`1`，revert 后→`0` | 前 7 套照常跑（含 pi-projection 36 PASS），末套短路 → npm test exit 1；revert 后 git diff tests/ 仍空 + npm test exit 0 | passed |
| A-003 | `node -e "console.log(require('./package.json').scripts.test)"` | `0` | 输出含 `tests/mcp-smoke.mjs` / `tests/pi-projection.mjs` / `tests/companion-snapshot.mjs` 三者 true | passed |
| A-004 | `git diff --stat tests/` | `0` | 空输出（注入 probe 已 revert，复检仍空） | passed |
| A-005 | `node ci-contract-check.cjs` | `0` | `bundle + tool-name contract ok` | passed |

## Uncovered areas and residual risks

- `npm test` 不含 `npm run build`（约定先 build 后 test）；CI 工作流（不在本 Action 范围）须 `npm run build && npm test`。本 Action 不加 `pretest` 钩子（dev 友好，Non-goals 已明）。
- 本 Action 未含 CI 工作流文件（如 `.github/workflows/*.yml`）；CI 接入是独立工作。

## Closure judgment

Decision: complete
Reason: 5/5 验收 passed；`npm test` 干净 build 后全绿（8 套）；`tests/` 零内容变更；`ci-contract-check.cjs` 仍绿；无 scope/architecture 越界。持久结论已回流至 `docs/MULTIPLATFORM.zh-CN.md` S6 行 + §9 Q7。user 授权 `in_progress → complete` 并归档。

## Readiness gaps

无。Readiness review：R1 发现 F-001（scope authority——设计文档 S6 行仅列 mcp-smoke，README 扩展到 3 套），user 授权选项 (a) 扩展并记录依据后 R2 clean（0 critical/high/medium）。user 授权 `ready`（override K=3 收敛——trivial Action，单字段编辑无 design 决策）。

## Closure conditions

- 全部 MUST 验收（A-001/A-002/A-003/A-004）passed，SHOULD（R-004 顺序）满足。
- `npm test` 在干净 build 后全绿。
- 持久结论（如有）回流至 `docs/MULTIPLATFORM.zh-CN.md` S6 行标注完成。
- 状态、路径、导航、归档一致。
