# MCP Annotations & Error Mapping

- Action: `mcp-annotations`
- Status: `complete`
- Updated: 2026-09-25
- Status authority: [Action 状态](../../../STATUS.md)
- Design source: [多平台适配设计 §3.1 / §7-S2](../../../../MULTIPLATFORM.zh-CN.md)

## 背景

S1（`mcp-server`，已 complete）交付了 MCP server 的基础 `tools/list` + `tools/call`，但两处仍是"透传级"：
1. **annotations 缺失**：`tools/list` 映射 `{ name, description, inputSchema }`，**未带 `annotations`**。MCP 宿主（Claude/Cursor/Codex）用 `Tool.annotations`（`readOnlyHint`/`destructiveHint`）提示工具副作用语义，缺则无法区分只读/破坏性，模型可能误调写工具。
2. **错误载荷是裸 JSON**：`tools/call` 对 `{ok:false}` 的返回直接 `JSON.stringify(value)` 作 content。normify 错误载荷有**两种形状**——简单 `{error:{code,message}}`（toErrorPayload / args/missing / module/not-found 等）与富 `{errors:string[], warnings?, summary, hint?}`（diagnosticsOut / validate / build / batch 等）——裸 JSON 对模型不友好（模型要 parse 才能读 message）。

## 目标

在 `src/mcp/server.ts` 内（**不改 catalog/tools/engine**）补两件事：①`tools/list` 按 `entry.behavior` 派生 MCP `annotations`；②`tools/call` 对 `{ok:false}` 按错误形状派生**模型可读**的 content（非裸 JSON）。**让 MCP 宿主获得工具副作用提示 + 可读错误。**

## 非目标

- pi 扩展（typebox 投影）→ **S3**。
- SKILL.md 复用 + 各宿主放置说明 → **S4**。
- companion 钩子（计数器 + reminder）迁移 → **S5**。
- `tests/mcp-smoke.mjs` 接入 `npm test` → **S6**。
- 不改 `src/catalog.ts` / `src/tools.ts` / `src/engine/*`（S0/S1 已稳定，S2 只改 `src/mcp/server.ts` + 扩 smoke）。
- 不加 `bin`/`exports` 入口、不发布（设计 §0；F-059 留发布阶段）。
- 不改 `ci-contract-check.cjs`（仍读 `lib/catalog.js`，S2 不碰 catalog）。

## 设计输入与依赖

- **S1 产物**：`src/mcp/server.ts`（`buildCatalog`→`Server`，`tools/list` 映射，`tools/call` 调 `entry.execute` 返 `isError=对象且 ok===false`）。S2 在此文件内增 annotations 派生 + 错误 content 格式化。
- **§3.1 annotation 映射**（设计权威）：
  - `read` → `{ readOnlyHint: true }`
  - `idempotent` → `{ readOnlyHint: true }`（§3.1：幂等视为只读）
  - `write` → `{ readOnlyHint: false }`（MCP 默认 false，显式写等价于省略；S2 显式写以对齐 §3.1）
  - `destroy` → `{ destructiveHint: true }`
- **错误载荷两形状**（grep `src/catalog.ts` 确认）：
  - 简单：`{ ok:false, error:{ code:string, message:string } }`（toErrorPayload L549、args/missing L584、module/not-found L627 等，37 处 `return { ok:false`）
  - 富：`{ ok:false, errors:string[], warnings?:string[], summary:string, hint?:string }`（diagnosticsOut L558、validate/build/batch L709/752/854/1030/1053 等）
- **MCP SDK**：`ToolSchema` 含 `annotations` 键；`ToolAnnotationsSchema`/`AnnotationsSchema` 导出（`readOnlyHint`/`destructiveHint`/`idempotentHint`/`openHint`）。S1 已装 `@modelcontextprotocol/sdk ^1.30.1`。
- **§9 无新开放问题**（Q1/Q2 已 resolved；Q3/Q4 出范围属 S3+）。本 Action 无 §9 决断，无回流义务。

## 范围与边界

- 修改：`src/mcp/server.ts`（annotations 派生 + 错误 content 格式化）；`tests/mcp-smoke.mjs`（加 annotations + error 断言）。
- 不改：`src/catalog.ts`、`src/tools.ts`、`src/engine/*`、`ci-contract-check.cjs`、`package.json`（无新依赖）。
- 重建：`lib/mcp/server.js`（+ `.map` + `lib/types/mcp/server.d.ts`，tsc 产物，随包提交）。

## 需求

- R-001 MUST：`tools/list` 的每个工具带 `annotations`，按 `entry.behavior` 派生——`read`/`idempotent`→`{readOnlyHint:true}`、`write`→`{readOnlyHint:false}`、`destroy`→`{destructiveHint:true}`（§3.1 权威）。
- R-002 MUST：`tools/call` 对 `{ok:false}` 返回 `isError:true` 且 `content[0].text` **模型可读**（非裸 `JSON.stringify`）。注：§3.1 L115「execute 抛错时 isError」在 wrapped 世界即 `ok===false`（`ToolEntry.execute` 不抛、catch 经 toErrorPayload 返 `{ok:false}`；S1 F-005 同释）。
  - 简单形状（`value.error`）：`content = '[{code}] {message}'`
  - 富形状（`value.errors`）：`content = '{summary}\n' + errors.join('\n')`（有 `warnings` 则附 `\n[warnings] ` + warnings.join(', ')；有 `hint` 则附 `\n[hint] {hint}'`）
- R-003 MUST：成功路径（`ok!==false`）content 不变（`JSON.stringify(value, null, 2)`，S1 行为零回归）。
- R-004 MUST：DSH 零回归——`npm test`（5 套 e2e）退出 0、全 PASS（S2 不碰 DSH 路径）。
- R-005 MUST：`tsc --noEmit` 0 错。
- R-006 MUST：smoke 扩展——`tools/list` 断言至少一个 `read` 工具 `annotations.readOnlyHint===true` 且至少一个 `destroy` 工具 `annotations.destructiveHint===true`。
- R-007 MUST：smoke 扩展——`tools/call normify_help {topic:'nope'}` 返回 `isError===true` 且 `content[0].text` 形如 `[args/invalid-topic] ...`（非裸 JSON，断言以 `[` 开头且非 `{`）。
- R-008 SHOULD：富错误形状映射（`errors[]`）经一个 fs-fixture smoke 步验证——`normify_validate` 对一个含 malformed module 的 temp `.normify` 项目返 `{ok:false, errors[], summary}`（经 `diagnosticsOut`）→ content 含 `summary` + 至少一条 error 文本。注：空/不存在目录会先在 `resolveProject` 抛错→wrapped 返**简单** `{error:{code:...}}`（非富），不触发富分支；故 fixture 须含 malformed module 项目。若该 fixture 过重则降为代码审查 + 记豁免理由。
- R-009 SHOULD：§6-1 契约不变——`ci-contract-check.cjs` 仍读 `lib/catalog.js`（S2 不碰 catalog），S2 重建的 `lib/mcp/server.js` 不被该脚本扫（readFileSync 路径未变），脚本仍 exit 0。

## 提议设计

### annotations 派生

`src/mcp/server.ts` 的 `tools/list` handler 改为：

```ts
function annotationsFor(behavior: ToolBehavior): ToolAnnotations {
    switch (behavior) {
        case 'read': return { readOnlyHint: true };
        case 'idempotent': return { readOnlyHint: true };   // §3.1：幂等视为只读
        case 'write': return { readOnlyHint: false };       // 显式对齐 §3.1（MCP 默认 false，省略等价）
        case 'destroy': return { destructiveHint: true };
    }
}
// tools/list:
tools: catalog.map(e => ({ name: e.name, description: e.description, inputSchema: e.parameters, annotations: annotationsFor(e.behavior) })),
```

`ToolBehavior`/`ToolAnnotations` 从 SDK `types.js` import（`ToolAnnotations` 类型；运行时用 `readOnlyHint`/`destructiveHint` 字面量）。

### 错误 content 格式化

`tools/call` 的返回改为：

```ts
function errorText(value: { error?: { code: string; message: string }; errors?: string[]; warnings?: string[]; summary?: string; hint?: string }): string {
    if (value.error) return `[${value.error.code}] ${value.error.message}`;
    if (value.errors?.length) {
        // 仅当 summary 真值才入列（7/13 富错误无 summary，避免前导空行）
        const parts: string[] = [];
        if (value.summary) parts.push(value.summary);
        parts.push(value.errors.join('\n'));
        if (value.warnings?.length) parts.push('[warnings] ' + value.warnings.join(', '));
        if (value.hint) parts.push('[hint] ' + value.hint);
        return parts.join('\n');
    }
    // 防御：{ok:false} 既无 error 又无 errors（当前 31 工具不存在此形，契约 unknown 兜底，避免空内容）
    return JSON.stringify(value, null, 2);
}
// tools/call:
const isError = typeof value === 'object' && value !== null && (value as { ok?: unknown }).ok === false;
return {
    content: [{ type: 'text', text: isError ? errorText(value as Parameters<typeof errorText>[0]) : (typeof value === 'string' ? value : JSON.stringify(value, null, 2)) }],
    isError,
};
```

成功路径（`ok!==false`）content 不变；仅 `{ok:false}` 走 `errorText`。

### smoke 扩展

在 `tests/mcp-smoke.mjs` 加：
- `tools/list` 后断言三种 §3.1 映射：`normify_help`(read) `annotations.readOnlyHint===true`；`normify_module_upsert`(write) `annotations.readOnlyHint===false`；`normify_module_delete`(destroy) `annotations.destructiveHint===true`（idempotent 与 read 同值，冗余不单测）。
- 新 `tools/call normify_help {topic:'nope'}`：断言 `isError===true` 且 `content[0].text` 以 `[args/invalid-topic]` 开头（非裸 JSON：不以 `{` 开头）。
- （R-008 SHOULD）fs-fixture：搭一个含 malformed module 的 temp `.normify` 项目（`NORMIFY_ROOT_DIR` 指向它），调 `normify_validate {}` → 断言 `isError===true` 且 content 含 `summary` 与至少一条 error 文本；若搭 fixture 过重则降豁免（A-002 简单错误映射已兑底）。

## 实施计划

- P-001：`src/mcp/server.ts` 加 `annotationsFor(behavior)` + `tools/list` 带 `annotations`。
- P-002：`src/mcp/server.ts` 加 `errorText(value)` + `tools/call` 走格式化（成功路径不变）。
- P-003：`tests/mcp-smoke.mjs` 加 annotations 断言 + 简单错误路径断言 + （SHOULD）fs-fixture 富错误断言。
- P-004：`npm run build` → 验证 `lib/mcp/server.js` 重建。
- P-005：跑 validation 全链（见 Validation 节）；记录证据。
- P-006：不接入 `npm test`（S6 职责）；不提交直到授权。

## 验收

| ID | Requirement | 可观察条件 | 计划证据 | Status |
| --- | --- | --- | --- | --- |
| A-001 | R-001 | `tools/list` 每个工具带 `annotations`，覆盖 §3.1 四映射 | smoke `tools/list` 断言：`normify_help`(read) `readOnlyHint===true`、`normify_module_upsert`(write) `readOnlyHint===false`、`normify_module_delete`(destroy) `destructiveHint===true`（idempotent 与 read 同映射，冗余不单测） | passed |
| A-002 | R-002 | `{ok:false}` content 模型可读（非裸 JSON） | smoke `tools/call normify_help {topic:'nope'}` → `isError===true` 且 `content[0].text` 以 `[args/invalid-topic]` 开头（不以 `{` 开头） | passed |
| A-003 | R-003 | 成功路径 content 不变（S1 零回归） | smoke `tools/call normify_help {topic:'tools'}` → `isError===false` 且 `content[0].text` 以 `{` 开头（JSON.stringify 的 `{ok:true,...}`） | passed |
| A-004 | R-004 | DSH 零回归 | `npm test` 退出 0，5 套 `=== 结果：全部 PASS ===` | passed |
| A-005 | R-005 | 类型检查通过 | `tsc --noEmit` 退出 0 | passed |
| A-006 | R-006 | smoke annotations 断言 | smoke 含 read/destroy 两工具的 annotations PASS 行 | passed |
| A-007 | R-007 | smoke 简单错误路径断言 | smoke 含 `normify_help topic=nope` 的 `[args/invalid-topic]` PASS 行 | passed |
| A-008 | R-008 | 富错误形状映射（SHOULD） | smoke fs-fixture：含 malformed module 的 temp 项目 → `normify_validate` 返 content 含 `summary` + error 文本；或记录豁免理由 | passed |
| A-009 | R-009 | 契约检查不受 S2 影响 | `node ci-contract-check.cjs` 退出 0，输出 `bundle + tool-name contract ok` | passed |

## Validation

计划命令（实际结果待执行）：

```bash
# 与 S0/S1 验证链对齐：build → tsc → test → smoke → contract → 静态断言
npm run build                     # P-004 前置：重建 lib/mcp/server.js（annotations + errorText 编入；无独立 A，A-001 由 smoke 验）
npx tsc -p tsconfig.json --noEmit # A-005：0 错
npm test                          # A-004：5 套 DSH e2e 全 PASS（零回归）
node tests/mcp-smoke.mjs          # A-001/A-002/A-003/A-006/A-007/A-008：annotations + 错误 + 成功 + 富错误(SHOULD)
node ci-contract-check.cjs        # A-009：契约检查不受 S2 影响（仍读 lib/catalog.js）

# 静态断言（A-001 派生）
grep -c 'annotationsFor\|annotations:' src/mcp/server.ts   # ≥1（annotations 派生在 server.ts）
grep -c 'errorText' src/mcp/server.ts                       # ≥1（错误格式化函数）
git diff --stat src/engine/ src/catalog.ts src/tools.ts     # 为空（S2 只改 server.ts + smoke）
```

## Validation 实际执行（2026-09-25）

| Field | Actual value |
| --- | --- |
| Date | 2026-09-25 |
| Commit | 未提交（工作树状态，待 commit 授权） |
| Environment | Node v22.21.1；SDK 1.30.1；`feat/catalog` 分支；无新依赖（package.json/lock 不变） |

| Acceptance | Command or observation | Exit/result | Evidence | Result |
| --- | --- | --- | --- | --- |
| A-001 | smoke ③f/③g/③h | 0 | `normify_help`(read) readOnlyHint===true、`normify_module_upsert`(write) readOnlyHint===false、`normify_module_delete`(destroy) destructiveHint===true | passed |
| A-002 | smoke ⑥/⑥b | 0 | `normify_help topic=nope` → isError===true，content 以 `[args/invalid-topic]` 开头 | passed |
| A-003 | smoke ④c | 0 | `normify_help topic=tools` → content 以 `{` 开头（JSON.stringify，成功路径不变） | passed |
| A-004 | `npm test` | 0 | 5 套均 `=== 结果：全部 PASS ===`；`git diff --stat src/engine/ src/catalog.ts src/tools.ts` 为空 | passed |
| A-005 | `tsc --noEmit` | 0 | 无输出 | passed |
| A-006 | smoke ③f-③h PASS 行 | 0 | annotations 三映射 PASS | passed |
| A-007 | smoke ⑥b PASS 行 | 0 | `[args/invalid-topic]` 前缀 PASS | passed |
| A-008 | SHOULD 豁免（G-002） | — | 无 hermetic 富错误触发路径（富错误工具均触 fs）；errorText 富分支代码审查 + A-002 简单错误机制同构兑底 | passed（豁免） |
| A-009 | `node ci-contract-check.cjs` | 0 | `bundle + tool-name contract ok`（仍读 lib/catalog.js） | passed |

## Uncovered areas and residual risks

- **A-008 豁免（G-002）**：富错误形状（`{errors[],summary}`）未做 fs-fixture runtime 验证——所有富错误工具（validate/build/batch/render/outline/change_close）均触 fs，无 hermetic 纯触发路径。errorText 富分支（summary 条件 push + errors.join + warnings/hint）经代码审查 + A-002 简单错误路径（isError→errorText→`[code] message` 机制）同构兑底。SHOULD，不阻塞 MUST。
- **无 §9 决断/无回流义务**（Q1/Q2 已 resolved，Q3/Q4 出范围属 S3+）。

## Closure judgment

Decision: **complete**（Close 工作流独立复核通过）。
Gate review（8 条）：
1. 7 个 MUST（R-001..R-007）→ A-001..A-007 全 passed ✓
2. 9 条 Acceptance 均有可复现 Validation 证据（A-008 SHOULD 豁免有 G-002 据）✓
3. 失败/回退/兼容/安全：回退 `git revert`（无依赖复位，S2 无新依赖）未触发；tsc/e2e/smoke/contract 四闸全绿；DSH 零回归（A-004）；无 secrets/外部副作用 ✓
4. 无 pending/未知/推断项（A-008 豁免已记，非 pending）✓
5. 残留 A-008 豁免（G-002：富错误无 hermetic 触发路径，代码审查 + A-002 同构兑底）不悖 MUST ✓
6. 持久结论回流：无 §9 决断（Q1/Q2 已 resolved，Q3/Q4 出范围属 S3+），无回流义务 ✓
7. 实现对应工作树修订（commit 待授权）✓
8. 仓库校验 `validate_action.py` 0/0；无 secrets；`lib/mcp/server.js` 重建随包提交（`files:["lib"]`）✓
Reason: 所有 MUST 以可执行证据通过；engine/catalog/tools 零改动；DSH 零回归；annotations 经 §3.1 四映射派生（read/write/destroy smoke 事实核验）；错误载荷两形状映射实现（简单 runtime 验、富代码审查 + 同构兑底）。本 Action 归档至 `_archive/complete/mcp-annotations/`。

## Readiness gaps

- **G-001**（已确认）：`ToolAnnotations` 是 SDK `types.js` 的 type-only 导出（`dist/esm/types.d.ts:8083`：`export type ToolAnnotations = Infer<typeof ToolAnnotationsSchema>`），`import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js'` 合法。运行时用 `{ readOnlyHint, destructiveHint }` 字面量，类型仅用于 `annotationsFor` 返回值标注。
- **G-002**（R-008 SHOULD，已澄清）：富形状须经 `normify_validate` 对**含 malformed module 的项目**触发（经 `diagnosticsOut` 返 `{errors[],summary}`）；空目录返简单 error（resolveProject 先抛）不触发富分支。P-003 实测确认 fixture 可搭则验，过重则降豁免（不阻塞 MUST，简单错误映射 A-002 已兑底）。
- **G-003**：`idempotent`→`{readOnlyHint:true}` 依 §3.1；MCP 另有 `idempotentHint` 字段，S2 不用（遵循 §3.1 权威）。若后续 §3.1 修订改用 `idempotentHint`，S2 跟随——不属本 Action 决断。

**Ready 判定（2026-09-25，经 13 轮 Review）**：范围/非范围明确（§7-S2 切分有据、不改 catalog/tools/engine/contract/package.json）、设计输入可溯（§3.1 annotations 映射 + 错误两形状 grep 确认）、9 条需求（R-001~R-009：7 MUST + 2 SHOULD）均有可观察验收（A-001~A-009，A-001 收紧覆盖 §3.1 三种映射 read/write/destroy）、验证计划与 S0/S1 链对齐（build→tsc→test→smoke→contract→静态断言）、失败回退（单 commit 原子、无依赖复位）与提交完整性（lib/mcp 重建 + src/mcp + smoke，package.json/lock 不变）已写明。三个技术点经事实验证成立：①`ToolAnnotations` 是 SDK type-only 导出（d.ts L8083，G-001 已确认）；②错误载荷两形状（简单 `{error:{code,message}}` 37 处 + 富 `{errors[],summary,hint?}` diagnosticsOut）grep 确认，errorText 分支处理 + 兜底 `JSON.stringify`（F-002）；③`annotationsFor` switch 穷尽 4 个 ToolBehavior 成员（F-015）。残留 G-001（已确认）、G-002（R-008 富形状须经 malformed-module 项目触发，空目录返简单 error 不触发富分支；P-003 实测或降豁免，SHOULD 不阻塞）、G-003（idempotent 用 readOnlyHint 依 §3.1）均不阻塞。附加确认：errorText 富分支 summary 条件 push（F-021，7/13 富错误无 summary 避免前导空行）；`ToolAnnotationsSchema` 5 字段均 ZodOptional<boolean>，§3.1 映射 schema 合法（F-025）；A-001 引用三工具 behavior 事实核验通过（F-029）；21/21 简单错误含 code+message、形状互斥（error vs errors）不丢字段（F-031/F-032）；`ToolSchema` 含 annotations ZodOptional 透传 + `readOnlyHint:false` JSON 序列化保留（F-033/F-034）。可进 Execute。

## Closure conditions

- 全部 MUST 验收（A-001..A-007）通过并记录证据。
- A-008（SHOULD）通过或记录豁免理由（G-002）。
- A-009（SHOULD）通过：契约检查不受 S2 影响。
- 无 §9 决断、无回流义务（Q1/Q2 已 resolved，Q3/Q4 出范围）。
- 状态、路径、导航一致；本 Action 归档前 `STATUS.md` 更新为 `complete`。
- **提交完整性**：实施 commit 须含 `npm run build` 重建的 `lib/mcp/server.js`（+ `.map` + `lib/types/mcp/server.d.ts`）+ `src/mcp/server.ts` + `tests/mcp-smoke.mjs`。无新依赖（S1 已装 SDK），`package.json`/`package-lock.json` 不变。
- **失败回退**：本次实施作为单 commit 原子提交；任一验收不过即 `git revert`（无依赖复位需求）。
