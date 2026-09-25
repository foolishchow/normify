# Catalog Extraction

- Action: `catalog-extraction`
- Status: `complete`
- Updated: 2026-09-25
- Status authority: [Action 状态](../../../STATUS.md)
- Design source: [多平台适配设计 §2 / §3.3 / §7-S0](../../../../MULTIPLATFORM.zh-CN.md)

## 背景

Normify 当前是 DSH 专用插件：31 个 `normify_*` 工具的注册逻辑与 DSH `ctx.tools.register` 调用耦合在 `src/tools.ts` 的 `registerTools()` 内。要让工具同时在 Claude Code / Codex / Cursor / pi 运行，必须先解除这层耦合。

幸运的是 `registerTools()` 内部已经构造了一个平台无关中间结构 `toolCatalog: ToolCatalogEntry[]`——只是随后立即调用 DSH 注册 API。本 Action 把"构造目录"与"调用宿主注册 API"拆开：抽出 `src/catalog.ts` 暴露 `buildCatalog(env): ToolEntry[]`，`tools.ts` 退化为遍历 catalog 调 DSH `tools.register`。这是 MCP server 与 pi extension 的共同地基。

## 目标

抽出平台无关的 `src/catalog.ts`，使 31 个工具定义成为单一事实源；DSH 入口退化为它的一个适配器，**行为零回归**。

## 非目标

- 不实现 MCP server（S1）。
- 不实现 pi extension（S3）。
- 不迁移伴随开发提醒钩子（S5）。
- 不改动 `src/engine/*` 任何源码。
- 不改动 `skills/normify-gen/SKILL.md`。
- 不调整 `package.json` 的 `peerDependencies` / 发布形态。
- 不解决 [MULTIPLATFORM.zh-CN.md §9](../../../../MULTIPLATFORM.zh-CN.md#9-待对齐的开放问题) 中影响后续步骤的开放问题（Q2/Q3/Q4）；仅 Q1（catalog 位置）在本 Action 内决断。

## 设计输入

- [多平台适配设计](../../../../MULTIPLATFORM.zh-CN.md) §2 目标架构、§3.3 DSH 入口退化、§7 S0。
- `src/tools.ts`：现 `registerTools()` 实现（31 个 `register(...)` 调用 + `toolCatalog` 中间结构）。
- `src/engine/reference.ts`：`toolReference` / `topicReference` 依赖 `toolCatalog` 提供 `normify_help` 的工具速查。
- `tests/*.mjs`：5 套 e2e，验收回归基线。
- `ci-contract-check.cjs`：grep `lib/tools.js` 的 `register('...')` 断言恰好 31 个工具名。

## 范围与边界

- 改 `src/tools.ts`：抽出 31 个工具定义到 `src/catalog.ts`；`registerTools` 改为遍历 catalog。
- 新增 `src/catalog.ts`：导出 `ToolEntry` 接口与 `buildCatalog(env)`。
- 改 `ci-contract-check.cjs`：`readFileSync` 路径 `lib/tools.js → lib/catalog.js`（regex 不变，见 P-005）。
- 不动 `src/index.ts`（`registerTools` 签名/调用不变）。
- 不动 `src/engine/*`、`skills/`、`tests/`（除非契约脚本需同步）。

## Requirements

- **R-001 MUST**：新增 `src/catalog.ts`，导出 `ToolEntry` 接口与 `buildCatalog(env: ToolEnv): ToolEntry[]`，包含全部 31 个工具定义。`ToolEntry.execute` = **platform-agnostic wrapped 版**（必填参数缺失校验 + `toErrorPayload` 兜底 + 调原业务函数），语义与现状逐一对应——这是多平台单一事实源：DSH / MCP / pi 三适配层共享同一份 execute 内部逻辑（missing-args + toErrorPayload）；**各适配器的结果呈现（DSH `output.render` / MCP `content`+`isError` / pi `content`+`details`）仍属其自身职责，S1/S3 定**。
- **R-002 MUST**：`src/tools.ts` 的 `registerTools(ctx, env)` 改为：`const catalog = buildCatalog(env);` 遍历 catalog 对每个 entry 调 DSH `tools.register`，**仅补 DSH 专属字段**（`readOnly`/`idempotent`/`destructive`/`output.render`/`isConcurrencySafe`，均由 `behavior` 派生）；`execute` 直接用 `entry.execute`（已含 missing-args/toErrorPayload，不在 tools.ts 重裹）。
- **R-003 MUST**：`src/engine/*` 目录下所有文件 `git diff` 为空（引擎零改动）。
- **R-004 MUST**：DSH 行为零回归——5 套 e2e 全 PASS（`engine-e2e` / `companion-e2e` / `regression-0.5.2/.3/.4`）。
- **R-005 MUST**：工具名集合不变——`ci-contract-check.cjs` 通过（恰好 31 个、含 `normify_project_init`/`normify_help`/`normify_module_batch`，全部 `[a-zA-Z0-9_-]+`）。
- **R-006 MUST**：`normify_help` 的 `topic:"tools"` 与 `topic:"tool:<name>"` 仍由 `buildCatalog` 构造的 `catalog` 数组派生且行为不变——`normify_help` 的 `execute` 闭包捕获 `buildCatalog` 内局部 `catalog`（自引用，运行时已填满）；`tools.ts` 不再持有 `toolCatalog` 变量；`reference.ts` 调用点不破坏。
- **R-007 SHOULD**：`buildCatalog` 内部不引用 `@deepseek-ai/cordis` 的 `Context` 类型（catalog 必须平台无关；`ToolEnv` 接口可留在 `tools.ts` 或迁至 `catalog.ts`）。
- **R-008 SHOULD**：catalog 化后 `ci-contract-check.cjs` 维持有效。脚本现读 `lib/tools.js`，抽取后 `register('...')` 字面量在 `lib/catalog.js`，故脚本 `readFileSync` 路径**必改** `tools.js → catalog.js`（≥1 行）；保留 `buildCatalog` 内 `register('normify_xxx', {...}, ...)` 调用形可避免 regex 改动。

## Proposed design

### 文件位置决断（§9 Q1）

catalog 放 `src/catalog.ts`（与 `tools.ts` 同级），不放 `src/engine/catalog.ts`。理由：catalog 依赖 engine 但**不属于 engine**（engine 是确定性校验/编译/渲染核心，catalog 是工具注册描述层）。

### `ToolEntry` 接口

```ts
export interface ToolEntry {
  name: string;
  description: string;
  behavior: 'read' | 'write' | 'destroy' | 'idempotent';
  parameters: ObjectSchema;  // JSON Schema，MCP inputSchema 直接复用
  // wrapped 版：先校验必填参数缺失（读 parameters.required，parent 允许显式 null），
  // 抛错/业务错误经 toErrorPayload 转 {ok:false,error:{code,message}}，再调原业务函数。
  // platform-agnostic —— DSH/MCP/pi 三适配层直接用，不重裹。
  execute: (args: Record<string, unknown>) => Promise<unknown>;
}
```

> `ObjectSchema`、`SchemaNode` 等类型现已在 `tools.ts` 内部定义；本 Action 将其迁至 `catalog.ts`（或 `catalog.ts` import `tools.ts` 的导出）。倾向前者（catalog 自洽）。

### `buildCatalog(env)` 结构

把 `tools.ts` 现有 `registerTools` 内的局部 `register = <A>(key, def, execute) => { toolCatalog.push(...); 构造 wrapped; tools.register(...); }` 拆为两段：

1. `catalog.ts` 的 `buildCatalog`：构造 `ToolEntry[]`，闭包捕获 `env`（rootDir / requireBilingual）；每个 entry 的 `execute` = **wrapped 版**（missing-args 校验 + `toErrorPayload` + 调原业务 `execute`）。原 `register` 局部里的 `wrapped` 逻辑整体迁入 `buildCatalog`。
2. `tools.ts` 的 `registerTools`：`const catalog = buildCatalog(env);` 然后 for-each 调 DSH `tools.register({ ...entry, /* DSH 专属字段 */ })`——`execute` 直接用 `entry.execute`，不在 tools.ts 重裹。

### DSH 包装层（不变量）

DSH `tools.register` 调用所需的 `readOnly`/`idempotent`/`destructive`/`output.render`/`isConcurrencySafe` 由 `behavior` 派生（DSH 专属，非 platform-agnostic），逻辑与现状逐字一致（见 [MULTIPLATFORM.zh-CN.md §3.3](../../../../MULTIPLATFORM.zh-CN.md) 代码示例）。missing-args 校验与 `toErrorPayload` **不在**此层（已在 `ToolEntry.execute` 内，三平台共享）。

### `normify_help` 的自引用（核心技术点）

现状：`toolCatalog: ToolCatalogEntry[]` 是 `registerTools()` 的**局部变量**（`src/tools.ts:578`），随每个 `register(...)` 调用 push 填充；`normify_help` 的 `execute` 闭包（`:1771/:1773/:1788`）**内省这个数组**——即 `normify_help` 是 31 个工具之一，却要内省它自己所属的 catalog。`toolCatalog` **未导出**，`tools.ts` 外部无消费者。

抽取后的正确结构：

- `buildCatalog(env)` 内部 `const catalog: ToolEntry[] = []` + 局部 `register(...)` push 填充（与今天同形）；
- `normify_help` 的 `execute` 闭包**捕获这个正在构造中的 `catalog`**——运行时被调用时数组早已填满，自省成立；
- `tools.ts` **不再维护任何 `toolCatalog` 变量**；`registerTools` 只 `const catalog = buildCatalog(env)` 后遍历调 DSH `tools.register`。

`reference.ts` 的 `topicReference(topic, catalog)` / `toolReference(entry)` 形参类型为 `ToolCatalogEntry`；`ToolEntry` 是其结构超集（多 `execute`），按结构兼容直接传入，`reference.ts` 签名**不改**。

### `ci-contract-check.cjs` 调整

现状 grep `lib/tools.js` 的 `register('...')`。catalog 化后字面量在 `lib/catalog.js`，`lib/tools.js` 不再含任何 `register('...')`。脚本 **必须**改 `readFileSync` 路径 `tools.js → catalog.js`（至少 1 行）；保留 `buildCatalog` 内 `register('normify_xxx', {...}, ...)` 调用形可避免 regex 改动：

```js
const src = fs.readFileSync('lib/catalog.js','utf8');   // 原为 'lib/tools.js'
const names = [...src.matchAll(/register\('([^']+)'\)/g)].map(m=>m[1]);   // regex 不变
```

**注**：原正则 `/register\('([^']+)'\)/g` 兼配 `buildCatalog` 内的 `register('normify_xxx', ...)` 调用形（设计决断：保留此形，避免 regex 变更）。

实现时选择对契约脚本改动最小的写法（保留 `buildCatalog` 内 `register('normify_xxx', {...}, ...)` 调用形可避免 regex 变更；但 `readFileSync` 路径必改 `tools.js → catalog.js`）。

## Implementation plan

- **P-001**：在 `src/catalog.ts` 定义 `ToolEntry` 接口，迁入类型（`SchemaNode`/`ObjectSchema`/`ToolDef`/`ToolBehavior`/`ToolEnv`）与 `src/tools.ts:349-569` 段全部模块作用域 helper（共 21 个，含参数构造器 `str`/`strOpt`/`numOpt`/`boolOpt`/`params`/`l10nParam`/`sourceParam`/`apiParam`/`depParam`/`l10nOptParam`/`layoutGroupParam`/`layoutHintParam`/`strArray`/`strArrayOpt`/`objArrayParam`/`freeObjectParam`/`moduleParams`/`projectParams`、schema 转换 `toJsonSchema`、错误与诊断 `toErrorPayload`/`diagnosticsOut`）——**以源码行段为权威范围，实施时 `tsc` 报“not defined”的函数即在该段内一并迁入**。不搬则 catalog.ts 须从 tools.ts import → 传递依赖 cordis → 违反 R-007。
- **P-002**：把 `tools.ts` 的 31 个 `register(...)` 调用及其闭包依赖（内层 `resolve`/`register`/`toolCatalog` + 参数 `env`）整体迁移到 `buildCatalog(env)` 内部；`buildCatalog` 返回 `ToolEntry[]`。P-001 已迁的 helper 在 `buildCatalog` 内直接可用。
- **P-003**：`tools.ts` 的 `registerTools` 改为：`const catalog = buildCatalog(env);` 遍历 catalog 调 DSH `tools.register({ ...entry, /* DSH 专属字段 */ })`；`execute` 直接用 `entry.execute`（不在 tools.ts 重裹）。
- **P-004**：确认 `reference.ts` / `index.ts` import 路径正确（`normify_help` 的 execute 闭包捕获 `buildCatalog` 内局部 `catalog`；`reference.ts` 形参 `ToolCatalogEntry` 按结构兼容接收 `ToolEntry`，签名不改）。
- **P-005**：改 `ci-contract-check.cjs` 的 `readFileSync` 路径 `lib/tools.js → lib/catalog.js`（≥1 行）；regex 不变。
- **P-006**：跑 §Validation 三条命令，全绿方算完成。

## Acceptance

| ID | Requirement | 可观察条件 | 实际证据（2026-09-25） | Status |
| --- | --- | --- | --- | --- |
| A-001 | R-003 | `git diff --stat src/engine/` 输出为空 | `git diff --stat src/engine/` 无输出（未改动） | passed |
| A-002 | R-004 | `npm test` 退出 0，5 套全 PASS | 5 套均输出 `=== 结果：全部 PASS ===`，退出 0 | passed |
| A-003 | R-005 | `node ci-contract-check.cjs` 退出 0 | 输出 `bundle + tool-name contract ok`，退出 0 | passed |
| A-004 | R-001 | `buildCatalog(env)` 返回恰好 31 个 `ToolEntry` | `node -e ...buildCatalog(...).length` 输出 `31`，退出 0 | passed |
| A-005 | R-002 | `lib/tools.js` 的 `registerTools` 调 `buildCatalog` 并遍历调 `tools.register`（31 个 `register('normify_*')` 字面量已迁入 catalog） | `grep -c 'buildCatalog' lib/tools.js`=3 ≥1；`grep -c 'tools.register' lib/tools.js`=2 ≥1；`grep -c "register('normify" lib/tools.js`=0 | passed |
| A-006 | R-006 | `normify_help` 的 `topic:tools` 与 `topic:tool:normify_module_batch` 行为不变 | regression-0.5.4.mjs ④a/b/c/d/e 全 PASS（④c 也过） | passed |
| A-007 | R-007 | `src/catalog.ts` 不 import `@deepseek-ai/cordis` | `grep -c '@deepseek-ai/cordis' src/catalog.ts` = 0 | passed |
| A-008 | R-008 | `ci-contract-check.cjs` 退出 0 且报 31 个工具 | 输出 `bundle + tool-name contract ok`；脚本改动 1 行（`readFileSync` 路径 `tools.js→catalog.js`） | passed |

## Validation

计划命令（实际结果待执行）：

```bash
npm run build                      # 重建 lib/（emit），与 CI 顺序一致；不重建则 npm test 跑旧产物
npx tsc -p tsconfig.json --noEmit   # 类型检查（belt-and-suspenders，build 已含）
npm test                            # 跑重建后的 lib/，5 套 e2e
node ci-contract-check.cjs          # 读重建后的 lib/catalog.js

git diff --stat src/engine/         # 期望为空（引擎零改动）
grep -n "@deepseek-ai/cordis" src/catalog.ts   # 期望无输出
```

## Validation 实际执行（2026-09-25）

| Field | Actual value |
| --- | --- |
| Date | 2026-09-25 |
| Commit | 未提交（工作树状态，待 commit 授权） |
| Environment | Node v22.21.1；`npm install` 已装；`feat/catalog` 分支 |

| Acceptance | Command or observation | Exit/result | Evidence | Result |
| --- | --- | --- | --- | --- |
| A-001 | `git diff --stat src/engine/` | 0 | 无输出（engine 零改动） | passed |
| A-002 | `npm test` | 0 | 5 套均 `=== 结果：全部 PASS ===` | passed |
| A-003 | `node ci-contract-check.cjs` | 0 | `bundle + tool-name contract ok` | passed |
| A-004 | `node -e "...buildCatalog(...).length"` | 0 | 输出 `31` | passed |
| A-005 | `grep -c buildCatalog/tools.register/register('normify lib/tools.js` | 0 | 3 / 2 / 0 | passed |
| A-006 | `npm test`（regression-0.5.4 ④a-e） | 0 | ④a/b/c/d/e PASS | passed |
| A-007 | `grep -c '@deepseek-ai/cordis' src/catalog.ts` | 1（grep 无匹配） | 0 | passed |
| A-008 | `node ci-contract-check.cjs` + `git diff ci-contract-check.cjs` | 0 | 改动 1 行（`readFileSync` 路径） | passed |

## Uncovered areas and residual risks

- **F-023（未修，低）**：A-006 原只引 ④a/b/d/e，实际 ④c 也 PASS（A-002 兑底）。非阻塞。
- **F-024（预存，超范围）**：`package-lock.json` 未跟踪；实施 commit 须附带提交以钉版本。
- **持久结论回流**：§9 Q1 已决断（`src/catalog.ts`）；收尾（Close）时更新 `docs/MULTIPLATFORM.zh-CN.md` §9 标记 Q1 resolved。

## Closure judgment

Decision: **complete**（Close 工作流独立复核通过）。
Gate review（8 条）：
1. 6 个 MUST（R-001..R-006）→ A-001..A-006 全 passed ✓
2. 8 条 Acceptance 均有可复现 Validation 证据（命令+结果已录）✓
3. 失败/回退/兼容/安全义务：回退 `git revert` 未触发（无失败）；失败路径 tsc/e2e/contract 三闸全绿；兼容 DSH 零回归（A-002/A-006）；无 secrets/外部副作用 ✓
4. 无 pending/未知/推断项 ✓
5. 残留风险 F-023（A-006 ④c，A-002 兑底）、F-024（package-lock 预存超范围）已记、不悖 MUST ✓
6. 持久结论回流：§9 Q1 已标记 resolved（见 `docs/MULTIPLATFORM.zh-CN.md` §9）✓
7. 实现对应已复核修订（工作树状态，commit 待授权）✓
8. 仓库校验 `validate_action.py` 0/0；无 secrets/无关改动；`lib/` 产物按 F-020 随包提交 ✓
Reason: 所有 MUST 与 SHOULD 均以可执行证据通过；engine 零改动；DSH 行为零回归；`normify_help` 自引用闭包与 `ToolEntry.execute` platform-agnostic wrapped 决断经实现验证成立。本 Action 归档至 `_archive/complete/catalog-extraction/`。
## Readiness gaps

- **G-001**（已澄清，非阻塞）：类型迁移无循环依赖风险——`src/index.ts` 仅 `import { registerTools }`（不 import `ToolEnv`），`tests/` 全部从 `lib/engine/*` 导入（不碰 `tools.ts`）。`ToolEnv`/`SchemaNode`/`ObjectSchema`/`ToolDef`/`ToolBehavior` 可直接迁至 `catalog.ts`，`tools.ts` 反向 `import type`，无环。
- **G-002**：§9 Q2/Q3/Q4（MCP 产物路径、pi extension 是否进本仓库、JSON Schema→typebox 投影）影响后续 Action，不阻塞本 Action。

**Ready 判定（2026-09-25，经 25 轮 Review）**：范围/非范围明确、设计输入可溯、8 条需求（R-001~R-008）均有可观察验收（A-001~A-008）、验证计划充分（含 build 与 CI 对齐）、失败回退与提交完整性已写明、跨文档一致（§3.3/§6/README 索引同步）。两个核心技术点（`normify_help` 自引用闭包、`ToolEntry.execute` platform-agnostic wrapped）正确。残留 F-023（A-006 漏 ④c，A-002 兜底）、F-024（package-lock 未跟踪，预存超范围）均不阻塞。可进 Execute。

## Closure conditions

- 全部 MUST 验收（A-001..A-006）通过并记录证据。
- A-007/A-008（SHOULD）通过或记录豁免理由。
- §9 Q1 已在本 Action 决断（catalog 放 `src/catalog.ts`，见设计小节）；收尾时回流 = 更新 [MULTIPLATFORM.zh-CN.md](../../../../MULTIPLATFORM.zh-CN.md) §9 标记 Q1 resolved。
- 状态、路径、导航一致；本 Action 归档前 `STATUS.md` 更新为 `complete`。
- **提交完整性**：实施 commit 须含 `npm run build` 重建的 `lib/` 产物（`lib/` 随包跟踪、51 文件；src 与 lib 同提交，避免 fresh clone 的 `npm test` 因 `lib/catalog.js` ENOENT 失败）。
- **失败回退**：本次实施作为单 commit 原子提交；任一验收不过即 `git revert` 或丢弃 `feat/catalog` 分支，不留半成品。
