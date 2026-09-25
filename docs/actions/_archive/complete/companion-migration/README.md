- Action: `companion-migration`
- Title: S5 — 迁移伴随开发提醒钩子到 MCP / pi 适配器
- Status: `complete`
- Type: feature（代码 + 测试 + 文档回流）
- Priority: medium
- Created: 2026-09-25
- Owner: foolishchow
- Design source: [多平台适配设计 §5 / §7-S5 / §8](../../../../MULTIPLATFORM.zh-CN.md)
- Status authority: [Action 状态](../../../STATUS.md)

## 1. 背景

`src/index.ts` 的 `installCompanionReminder(ctx, config)` 监听 DSH 私有事件 `ctx.on('tools/post-execute', ...)`，在连续 N 个**外部写工具**（write/edit/str_replace_editor/apply_patch/...，经 `WRITE_TOOLS` regex 匹配）后向 `result.content` 追加提醒文本，提示运行 `normify_sync` + `normify_change_close`。

当前仅 DSH 入口有此钩子；MCP server（S1）与 pi 扩展（S3）未实现。S5 将此钩子迁移到两个新适配器，DSH 入口保持不动（§5.3）。

## 2. 目标

1. **MCP server**：在 `src/mcp/server.ts` 的 `tools/call` handler 内加计数器 + 提醒注入。
2. **pi extension**：在 `src/pi/normify.ts` 注册 `pi.on('tool_result', ...)` handler，过滤写工具后计数 + 经 `ToolResultEventResult.content` 追加提醒。
3. **DSH**：`installCompanionReminder` 不动（§5.3）。
4. **共享提醒文本**：提取 DSH 内联的 reminder 字符串为共享 helper（防三份漂移）。
5. **配置源**：MCP/pi 的开关 + 阈值经 env 变量（DSH 用 DSH Config）。
6. **§6.3 stale 回流**：`docs/MULTIPLATFORM.zh-CN.md` §6.3 L236 `pi 下默认 pi.cwd` → env var（S4 修了 §3.2 L145 漏此行）。
7. **§9 回流**：S5 决断（MCP 语义代理 + 配置源）标 resolved。

## 3. 关键设计约束（实测）

### 3.1 DSH 原始实现（`src/index.ts` L58–83）

```ts
const WRITE_TOOLS = /^(write|edit|str_replace_editor|apply_patch|patch|multi_edit|create_file|insert|fs_write)$/i;
// ctx.on('tools/post-execute', (exec, result, next) => { ... })
//   匹配 exec.name (外部工具名) → ++writes → 达阈值 → 追加 reminder 到 result.content
```

- `config.devCompanionReminder`（默认 false，opt-in）
- `config.devCompanionReminderAfter`（默认 8，`Math.max(1, Math.floor(...))`）
- 提醒文本：`'[normify] 已连续修改 ' + threshold + ' 个文件：结构树可能已漂移。建议运行 normify_sync（v2：脏模块/新增文件建议/破坏性 API 变更），收尾用 normify_change_close（0 error 强制）同步模块与渲染数据。'`
- 计数器：模块闭包 `let writes = 0`，达阈值后重置为 0

### 3.2 MCP server 架构限制（核心分歧）

MCP server 是 stdio 进程，**只收到对自身工具的 `tools/call`**（normify_*）。它**无法**见到宿主或其他 MCP server 的 write/edit 调用。DSH 的 `WRITE_TOOLS` regex（外部工具名）在 MCP 下匹配 **0 个**（normify 工具名均以 `normify_` 前缀，无 write/edit/patch 裸名）。

**pi REPLACE 实测**：`agent-session.js` L258 `const content = hookResult?.content ?? result.content ?? []`——handler 返回 `content` 则**替换**原 content（非追加）。handler 须 `return { content: [...event.content, {type:'text', text: reminder}] }`（读原 content 再拼接）。

**S5 决断方向（§9 Q1，待执行定夺）**：MCP companion 改用 `ToolEntry.behavior !== 'read'`（write/idempotent/destroy=17，5 idempotent 全落盘证 modify-files）作代理——**语义不同**（计 normify 自身写工具，非外部编辑器写）。且提醒文本"结构树可能已漂移"为**外部编辑**设计（用户改源码→树漂移→建议 sync）；normify 自身写工具是**更新**结构非漂移，文本语义**反向**。Q1 须决断：MCP 跳过（N/A）/换文本/标注失配。

### 3.3 pi 事件模型（可复刻 DSH 语义）

实测 `@earendil-works/pi-coding-agent` `dist/core/extensions/types.d.ts`：

- `pi.on('tool_result', handler: ExtensionHandler<ToolResultEvent, ToolResultEventResult>)`（L940）
- `ToolResultEvent`（L726）：`{ type, toolCallId, toolName, input, content[], isError, usage? }`
- `ToolResultEventResult`（L835）：`{ content?, details?, isError?, usage? }` — handler **可返回改写后的 content**
- 事件覆盖**所有工具**：`BashToolResultEvent` / `EditToolResultEvent` / `WriteToolResultEvent` / ... / `CustomToolResultEvent`（normify_* 走 Custom）

→ pi 用 `WRITE_TOOLS.test(event.toolName)` 匹配 write/edit（pi 内置工具），**复刻 DSH 语义**（计外部编辑器写）。normify_* 自身工具（Custom）不匹配 regex，不计入——与 DSH 一致（DSH 也只计外部写，normify 工具调用不触发 reminder）。

### 3.4 配置源（§9 Q2，待执行定夺）

- DSH：`Config = z.object({ devCompanionReminder, devCompanionReminderAfter, ... })`（schemastery）
- MCP/pi：env 变量（倾向）
  - `NORMIFY_DEV_COMPANION_REMINDER`：`process.env.NORMIFY_DEV_COMPANION_REMINDER === '1'`（**默认关**——undefined/其他→false；**反向**于 `NORMIFY_REQUIRE_BILINGUAL` 的 `!== '0'` 默认开，因 DSH default=false）
  - `NORMIFY_DEV_COMPANION_REMINDER_AFTER`：默认 `8`
- 阈值解析（镜像 DSH `Math.max(1, Math.floor(...))` + **NaN 守卫**）：`const after = Math.floor(Number(process.env.NORMIFY_DEV_COMPANION_REMINDER_AFTER ?? '8')); const threshold = Math.max(1, Number.isFinite(after) ? after : 8);`（`Number('abc')`=NaN→`Number.isFinite` false→fallback 8，防 NaN 破计数器）

### 3.5 §6.3 stale（S4 漏修）

`docs/MULTIPLATFORM.zh-CN.md` §6.3 L236：

```
3. **`rootDir` 语义**：DSH 下默认 `.`；MCP 下默认 `process.cwd()`；pi 下默认 `pi.cwd`。
```

`pi.cwd` 已 stale（S3 F-006 证 ExtensionAPI 无 cwd；S4 修了 §3.2 L145 漏 §6.3）。S5 回流修为 `process.env.NORMIFY_ROOT_DIR ?? process.cwd()`。

## 4. Requirements

- R-001：MCP server 在 `tools/call` handler 内加 companion 计数器（模块作用域）+ 达阈值后向返回 `content` 数组追加 reminder 段 `{type:'text', text: companionReminder(threshold)}`（形状与 DSH L79 `{type:'text', text:reminder}` + MCP L58 一致）。**计数语义镜像 DSH**：`entry.behavior !== 'read'` → ++count（计 attempt，无论成功失败，镜像 DSH L71 `writes++` before nextFn）；**仅 !isError 时注入** reminder（镜像 DSH L77 `decision.kind==='accept'` 成功才追加）；**达阈值时重置 count=0**（镜像 DSH L72 `writes=0` 在 L76 nextFn **前**——达阈值即重置，**无论后续是否成功注入**；若「注入后重置」则 Nth 失败时计数卡 N→后续每次超阈值，bug）。
- R-002：pi extension 注册 `pi.on('tool_result', ...)`，`WRITE_TOOLS.test(event.toolName)` 匹配 → 计数 → 达阈值返回 `ToolResultEventResult.content`（`[...event.content, {type:'text', text: reminder}]`，因 pi L258 REPLACE）。**handler 逻辑提取为纯导出函数** `createCompanionHandler(config: { enabled: boolean; threshold: number }): (event: ToolResultEvent) => ToolResultEventResult | void`（**闭包计数器**——factory 内 `let count = 0`，每次 createCompanionHandler 调用新建独立计数器，**非模块作用域**；对比 MCP 模块作用域 `let companionCount`；镜像 S3 `formatResultText` F-039 提取先例），供 `tests/pi-projection.mjs` hermetic 测试（无 pi runtime 依赖）；**返回策略**：**`!config.enabled` → `void`**（F-059，首检查短路，不计数不注入）；非 WRITE_TOOLS 匹配 → `void`（不计）；匹配但 count<threshold → `void`；匹配且 count==threshold → **达阈值时重置 count=0**（F-034，镜像 DSH L72 在 nextFn 前）；**仅 `!event.isError` 时返回** `{content:[...event.content, {type:'text',text:reminder}]}`（镜像 DSH `decision.kind==='accept'` 成功-only；isError=true 时返回 void，计数已重置）。默认导出内 `pi.on('tool_result', handler)` 调用之。
- R-003：DSH `installCompanionReminder` **hook 逻辑不变**（`ctx.on('tools/post-execute')` / nextFn / decision / content spread 全保留）；**唯一允许的改动**：(a) reminder 文本来源从内联字符串改为 `companionReminder(threshold)`；(b) `WRITE_TOOLS` 常量从内联改为 import 共享 helper（DSH+pi 共用，MCP 不用）；(c) 加 `import { companionReminder, WRITE_TOOLS } from './companion.js'`。合计 ≤3 行 diff（删 WRITE_TOOLS 定义 + 改 reminder 行 + 加 import）。非 hook 逻辑改动。
- R-004：提醒文本提取为共享 helper `src/companion.ts`（独立模块，**非 catalog 导出**——catalog.ts 已 88KB/1760 行不膨胀），三适配器共用，字节一致。
- R-005：配置源——MCP/pi 经 env（`NORMIFY_DEV_COMPANION_REMINDER` / `NORMIFY_DEV_COMPANION_REMINDER_AFTER`），默认关 + 阈值 8；DSH 仍用 Config。
- R-006：§6.3 L236 stale `pi.cwd`→env var 回流 + §5.2 stale（"末尾追加"→pi REPLACE；"pi settings"→env；"async"→sync）+ **SETUP.md env 表加 NORMIFY_DEV_COMPANION_* 2 行 + MCP 节 companion 语义差异注**（Q1 文档标注）+ §9 S5 决断标 resolved。

## 5. Validation

# A-001 MCP companion 单测：连续 N 次 normify 写工具（behavior!==read）后，返回 content 含 reminder 文本
# A-002 pi companion 单测：连续 N 次 write/edit tool_result 事件后，ToolResultEventResult.content 末尾含 reminder
# A-003 DSH hook 逻辑不变：installCompanionReminder 的 ctx.on/nextFn/decision/content spread 逻辑保留；允许 ≤3 行 diff（reminder 文本→companionReminder + WRITE_TOOLS→import + import 行）
# A-004 提醒文本字节一致：`companionReminder(threshold)` 输出与 golden snapshot（P-001 前从 DSH 原文复制）逐字节相等（P-001 后 DSH 原文已消失，不能 grep src/index.ts 比对）
# A-005 默认关：MCP/pi 在 env 未设时 companion 不激活（0 计数 + 0 注入）
# A-006 §6.3 + §5.2 + §9 + SETUP.md 回流：L236 `pi.cwd`=0；§5.2 "末尾追加"→"返回 {content:[...event.content,reminder]}（pi REPLACE）"+"pi settings"→"env 变量"（Q2 决断）+"async handler"→"sync createCompanionHandler"；**SETUP.md env 表加 2 行**（F-048，匹配 S4 格式 `| 变量 | 默认 | 说明 |`）：`| \`NORMIFY_DEV_COMPANION_REMINDER\` | 0（关） | companion 提醒钩子开关；1=开 |` + `| \`NORMIFY_DEV_COMPANION_REMINDER_AFTER\` | 8 | 触发提醒的连续写工具数 |`；**SETUP.md MCP 节加 companion 语义差异注**（F-047，Q1 文档标注）——文本如："> **MCP companion 语义**：MCP server 仅见自身 normify_* 工具调用，无法跨进程监听外部编辑器写；companion 改用 `behavior!=='read'` 代理（计 normify 写/destroy/idempotent），语义不同于 DSH/pi（计外部 write/edit）。提醒文本保留 R-004 字节一致。"；**SETUP.md pi 节 env bullet 加 `export NORMIFY_DEV_COMPANION_REMINDER=1; export NORMIFY_DEV_COMPANION_REMINDER_AFTER=8`**（pi companion 经 env，F-049）；**SETUP.md DSH 节 config bullet 加 `devCompanionReminder`/`devCompanionReminderAfter`**（F-050）——文本如："- 配置：`rootDir`/`requireBilingual`/`devCompanionReminder`（默认关）/`devCompanionReminderAfter`（默认 8）经 DSH Config（schemastery）配置（非 env 变量）"；§9 S5 决断标 ✅ resolved

| A-ID | Requirement | Severity | Method | Status |
| --- | --- | --- | --- | --- |
| A-001 | R-001 | MUST | `tests/mcp-smoke.mjs` 加 companion 断言：**新增第 2 个 spawn**（`env: {...process.env, NORMIFY_ROOT_DIR:<mkdtempSync temp>, NORMIFY_DEV_COMPANION_REMINDER:'1', NORMIFY_DEV_COMPANION_REMINDER_AFTER:'3'}`——**须用 temp rootDir**，repo 无 normify 项目；现有 spawn 保留 for A-005 env-unset）→ 发 3 次 `tools/call`（`normify_project_init` `{project:'test'}`，behavior=write 幂等 ×3 实测全 ok:true，**非 normify_build**——build 对无项目 rootDir ok:false error:project/required）→ 第 3 次（!isError）返回 `content` 数组 **length===2**（原 content[0] + reminder content[1]），**`content[1].text` 含 `[normify] 已连续修改`**（F-058，非 content[0] text.contains——reminder 是 push 的第 2 段）；第 4 次计数已重置不注入（content length===1） | pass |
| A-002 | R-002 | MUST | `tests/pi-projection.mjs`：L5 import 加 `createCompanionHandler`（`import { schemaToTypebox, objectSchemaToTypebox, formatResultText, createCompanionHandler } from '../lib/pi/normify.js'`）；`createCompanionHandler({enabled:true, threshold:3})` → 调 3 次 mock `ToolResultEvent`（`{type:'tool_result', toolCallId:'c'+i, toolName:'write', input:{}, content:[{type:'text',text:'ok'}], isError:false}`）→ 第 N 次返回 `content`（**length===2**：原 event.content[0] + reminder[1] `[...event.content, {type:'text', text:reminder}]`，pi L258 REPLACE 语义）`content[1].text` 含 `[normify]`（F-061，镜像 A-001 length===2）；第 N+1 次计数已重置不注入 | pass |
| A-003 | R-003 | MUST | `git diff HEAD -- src/index.ts` ≤3 行（删 WRITE_TOOLS 定义 L62 + 改 reminder 行 L73 + 加 import）；hook 逻辑（ctx.on/nextFn/decision/content spread/writes=0 达阈值重置在 nextFn 前）逐行比对不变 | pass |
| A-004 | R-004 | MUST | `tests/companion-snapshot.mjs`（**standalone 新文件**，不并入 npm test——S6 职责）：`import { companionReminder } from '../lib/companion.js'`；`companionReminder(8)` 与 golden snapshot `'[normify] 已连续修改 8 个文件：结构树可能已漂移。建议运行 normify_sync（v2：脏模块/新增文件建议/破坏性 API 变更），收尾用 normify_change_close（0 error 强制）同步模块与渲染数据。'` 逐字节 `===` | pass |
| A-005 | R-005 | MUST | `tests/mcp-smoke.mjs`（**新增第 3 个 spawn**，env 不设 `NORMIFY_DEV_COMPANION_*` 但**设 NORMIFY_ROOT_DIR=<temp>**——写工具须 temp rootDir 否则 project_init 脏 repo；用写工具 `normify_project_init` ×N 证明 disabled→0 注入，read 工具不区分 disabled vs read-skip）→ `content` **length===1**（无第 2 段 reminder，F-060）且 `content[0].text` 不含 `[normify]`；`tests/pi-projection.mjs`：`createCompanionHandler({enabled:false, threshold:8})` → N 次 mock event（toolName='write'）→ 全 void；`parseCompanionConfig({NORMIFY_DEV_COMPANION_REMINDER_AFTER:'abc'})`→threshold fallback 8（F-008） | pass |
| A-006 | R-006 | MUST | `grep -c 'pi 下默认 \`pi.cwd\`' docs/MULTIPLATFORM.zh-CN.md` = 0；§5.2 stale=0（REPLACE/env/sync）；**SETUP.md 4 项**：env 表含 `NORMIFY_DEV_COMPANION_REMINDER`/`_AFTER`（F-048）+ MCP 节含 companion 语义差异注（F-047）+ pi 节 env bullet 含 `export NORMIFY_DEV_COMPANION_*`（F-049）+ DSH 节 config bullet 含 `devCompanionReminder`（F-050）；§9 S5 标 ✅ resolved | pass |

**实际执行结果（2026-09-25，feat/catalog 分支，commit 待提交）**：

```text
# P-001 companion.ts + DSH 提取
$ npx tsc -p tsconfig.json --noEmit   # 0 错误
$ git diff src/index.ts               # 3 处改动（+import / -WRITE_TOOLS inline / reminder→companionReminder），hook 逻辑不动

# A-001 MCP companion（mcp-smoke.mjs spawn #2，temp rootDir + AFTER=3）
$ node tests/mcp-smoke.mjs
  PASS S5 A-001 ③ content length===2（原 content[0] + reminder content[1]）
  PASS S5 A-001 ③b content[1].text 含 [normify] 已连续修改
  PASS S5 A-001 ④ content length===1（重置后不注入）
  # 36 PASS（含现有 17 + companion 19）

# A-002 pi companion（pi-projection.mjs createCompanionHandler 纯函数）
$ node tests/pi-projection.mjs
  PASS S5 A-002 ③ content length===2（pi L258 REPLACE 语义）
  PASS S5 A-002 ③b content[1].text 含 [normify]
  PASS S5 A-002 ④ void（计数已重置）
  # 36 PASS（含现有 26 + companion 10）

# A-003 DSH hook 逻辑不变
$ git diff src/index.ts  # 仅 3 处提取（import + WRITE_TOOLS + reminder），ctx.on/nextFn/decision/content spread/writes=0 逐行不变

# A-004 golden snapshot
$ node tests/companion-snapshot.mjs
  PASS companionReminder(8) === golden snapshot（逐字节，121 字节）
  # 3 PASS

# A-005 默认关 + env 守卫
$ node tests/mcp-smoke.mjs  # spawn #1（env-unset）+ spawn #3（disabled）
  PASS ④d companion disabled → content length===1
  PASS S5 A-005 ①-1/2/3 content length===1（disabled 无 reminder）
  PASS S5 A-005(pi) ①-1/2/3 enabled=false -> void（F-059 短路）

# A-006 §6.3 + §5.2 + §9 + SETUP.md 回流
$ grep -c 'pi 下默认 `pi.cwd`' docs/MULTIPLATFORM.zh-CN.md   # 0
$ grep -c '末尾追加 reminder|从 pi settings 读|async (event, ctx)' docs/MULTIPLATFORM.zh-CN.md  # 0
$ grep -c '✅ 已决断（S5' docs/MULTIPLATFORM.zh-CN.md  # 2（Q5+Q6）
$ grep -c 'NORMIFY_DEV_COMPANION_REMINDER' docs/MULTIPLATFORM-SETUP.md  # 4（env 表 2 + pi export + MCP 注）
$ grep -c 'MCP companion 语义' docs/MULTIPLATFORM-SETUP.md  # 1
$ grep -c 'devCompanionReminder' docs/MULTIPLATFORM-SETUP.md  # 1（DSH config）

# 全链回归
$ npm test  # 5 套全 PASS
$ node ci-contract-check.cjs  # bundle + tool-name contract ok（companion.ts 非工具源，31 契约不变）
```

S5 代码 + 测试 + 文档回流。6 验收全过（A-001~A-006 MUST）。

## 6. Closure

S5 完成条件：

- §5.1 MCP server 内计数器 + 提醒注入实现，单测过（A-001）
- §5.2 pi `tool_result` handler 实现，单测过（A-002）
- §5.3 DSH `installCompanionReminder` hook 逻辑不动（A-003，仅 reminder 文本来源提取）
- 共享 `companionReminder(threshold)` helper 提取，三适配器字节一致（A-004）
- 默认关语义 + env 配置解析健壮（A-005）
- 共享 reminder helper 提取，三处字节一致（A-004）
- 默认关语义（A-005）
- §9 S5 决断回流（Q1 MCP 语义代理 + Q2 配置源 env）+ §6.3 L236 stale + §5.2 stale（REPLACE/env/sync）+ **SETUP.md env 表 + MCP 节 companion 注**修复（A-006）
- §9 S5 决断标 ✅ resolved（含 MCP 语义代理说明）
- `npm run build` 0 错误；`npm test` 全 PASS；`ci-contract-check.cjs` ok
- 提交信息：`feat(companion): migrate dev-companion reminder to MCP + pi (S5)`

## 7. Plan

- P-001：提取共享 helper `src/companion.ts`（`companionReminder(threshold: number): string` + `parseCompanionConfig(env: NodeJS.ProcessEnv = process.env): {enabled: boolean, threshold: number}` + `WRITE_TOOLS` 常量；**导出子集**：DSH import `companionReminder, WRITE_TOOLS`（不用 parseCompanionConfig——用 Config）；MCP import `companionReminder, parseCompanionConfig`（不用 WRITE_TOOLS——用 behavior）；pi import 三者全用）；`src/index.ts` 改 `const reminder = companionReminder(threshold)`（**1 行 diff，hook 逻辑不动**——R-003 边界已决断：逻辑不变，仅文本来源提取）
- P-002：MCP server `src/mcp/server.ts` 加 `import { companionReminder, parseCompanionConfig } from '../companion.js'`（**不用 WRITE_TOOLS**——MCP 用 behavior 代理）；加 companion（模块作用域 `parseCompanionConfig()` + `let companionCount` + handler 重构如 F-038）；**`tests/mcp-smoke.mjs` 重构**——提取 `spawnServer({env, rootDir})` helper：`mkdtempSync`→`spawn('node',[SERVER],{cwd:REPO,env:{...process.env,NORMIFY_ROOT_DIR:rootDir,...env},stdio:['pipe','pipe','pipe']})`→返回 `{send(method,params), child, cleanup()}`（`send` 封装 JSON-RPC write+read NDJSON，`cleanup` = `child.kill('SIGTERM')` + `rmSync(temp,{recursive:true})`）；现有单 spawn（L12）改调 `spawnServer({env:{},rootDir:REPO})`；新增 A-001/A-005 各一个 spawn（3 spawn 总计）；**temp rootDir**：A-001/A-005 用 `mkdtempSync` 临时 dir 作 rootDir，测后 cleanup：模块作用域 `const companionConfig = parseCompanionConfig()` + `let companionCount = 0`；`tools/call` handler **重构**——把 inline `return {content:[{type:'text',text:...}], isError}` 拆为 `const content = [{type:'text', text:...}]` 变量；execute 后若 `companionConfig.enabled && entry.behavior!=='read'` → ++count → 达阈值时 reset count=0（F-034）+ 仅 !isError 时 `content.push({type:'text',text:companionReminder(threshold)})`（F-010）；`return {content, isError}`；`tests/mcp-smoke.mjs` 加 companion 断言（A-001/A-005）
- P-003：pi extension `src/pi/normify.ts` 加 `import { companionReminder, parseCompanionConfig, WRITE_TOOLS } from '../companion.js'`（**三者全用**——pi 用 WRITE_TOOLS 匹配 + parseCompanionConfig 读 env + companionReminder 生成文本）；内**定义并导出** `createCompanionHandler(config): (event)=>ToolResultEventResult|void`（pi-specific，用 ToolResultEvent 类型，**不在 companion.ts**——companion.ts 仅平台无关的 companionReminder/parseCompanionConfig/WRITE_TOOLS）；默认导出（L102-110）内 `registerPiTools(pi, env)` 后加 `pi.on('tool_result', createCompanionHandler(companionConfig))`（companionConfig 从 env 读，F-007/F-008）；`tests/pi-projection.mjs` 加 companion 断言（A-002/A-005，测纯函数非 pi.on 注册）
- P-004：执行全链验收——`npm run build`（0 错误）+ `npm test`（5 套 engine-e2e/companion-e2e/regression-0.5.2/0.5.3/0.5.4，**不含 mcp-smoke/pi-projection——S6 接入 npm test**）+ **手动** `node tests/mcp-smoke.mjs`（A-001/A-005）+ `node tests/pi-projection.mjs`（A-002/A-005）+ `node ci-contract-check.cjs`（companion.ts 非工具源，31 契约不变）+ A-003（`git diff HEAD -- src/index.ts` ≤3 行）+ A-004（`companionReminder(8)` golden snapshot `===`）+ A-006（§6.3 L236 `pi.cwd`=0 + §5.2 stale=0 + §9 S5 标 ✅）；不提交直到授权

## 8. Open Questions / Risks

- **§9 Q1（决断方向）**：MCP 用 behavior 代理（behavior!==read）+ 文档标注语义差异（无法跨进程见外部工具是 MCP 架构固有约束）；F-002 文本失配经文档标注解决（reminder 文本保留 R-004 字节一致，不改文本）。待执行定夺。
- **§9 Q2（决断方向）**：MCP/pi 用 env 变量（`NORMIFY_DEV_COMPANION_REMINDER`/`_AFTER`），与 §3.1 NORMIFY_ROOT_DIR/REQUIRE_BILINGUAL 一致；DSH 仍用 DSH Config。待执行定夺。
- **风险 R1**：MCP server 重启丢计数（与 DSH 单会话语义一致，§8 已识别，文档说明，非阻断）。
- **风险 R2 ✅ 已实测**：pi `agent-session.js` L258 `hookResult?.content ?? result.content`——**REPLACE**（handler 返 content 则替换原）。handler 须读 `event.content` 再拼接 `[...event.content, reminder]` 返回（非仅返 `[reminder]`，否则原 content 被覆盖）。
- **风险 R4（idempotent 语义张力）**：S2 MCP annotation 标 idempotent→`readOnlyHint:true`（§3.1"幂等视为只读"，LLM 提示用）；S5 companion 代理 `behavior!=='read'` 计 idempotent 为写（5 idempotent 全改文件，文件计数用）。**两关注不同**：annotation=LLM 侧效提示（idempotent=可重复=对 LLM 像 read）；companion=文件修改计数（idempotent 落盘=写）。文档（SETUP.md/§5.1）须标注此区分，非矛盾。
- **风险 R3 ✅ 已决断**：R-003 松为"hook 逻辑不变"（非文件字节不变）；允许 src/index.ts 1 行 diff（reminder 文本→companionReminder(threshold)）。R-004 字节一致经共享 helper 保证（三适配器 import 同一函数）。

## 9. Cross-References

- §5 伴随开发提醒钩子迁移（L191–229）
- §7-S5 路线图（L253）
- §8 风险：companion 重启丢计数（L268）
- §6.3 rootDir 语义 stale（L236，S5 回流）
- S3 `src/pi/normify.ts`（pi 适配器，companion 将加于此）
- S1 `src/mcp/server.ts`（MCP 适配器，companion 将加于此）
- DSH `src/index.ts` L54–83（`installCompanionReminder` 原始实现）
