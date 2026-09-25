# MCP Server

- Action: `mcp-server`
- Status: `complete`
- Updated: 2026-09-25
- Status authority: [Action 状态](../../../STATUS.md)
- Design source: [多平台适配设计 §2 / §3.1 / §7-S1](../../../../MULTIPLATFORM.zh-CN.md)

## 背景

S0（`catalog-extraction`，已 complete）抽出平台无关的 `src/catalog.ts`，暴露 `buildCatalog(env): ToolEntry[]`——31 个工具的 `name`/`description`/`behavior`/`parameters`(ObjectSchema)/`execute`(wrapped：missing-args + toErrorPayload + 业务) 均平台无关。但当前只有 DSH 适配器 `src/tools.ts` 消费它；catalog 的"跨平台可复用"承诺尚未被第二个适配器验证。MCP（Model Context Protocol）是 Claude / Cursor / Codex 等宿主的标准工具协议，是验证复用、打通第二平台的最小一步。

## 目标

加 `src/mcp/server.ts`（编译到 `lib/mcp/server.js`），用 `@modelcontextprotocol/sdk` 实现一个 stdio MCP server，通过 `tools/list` 暴露 31 个 normify 工具、`tools/call` 调 `ToolEntry.execute`。**证明 catalog 被第二个适配器复用、零工具逻辑重复。**

## 非目标

- behavior → MCP annotations（`readOnly`/`destructive` 提示标记）映射 → **S2**（§7-S2；§3.1 的 annotation bullets 归 S2，不归 S1）。
- 错误载荷 `{ok:false,error:{code,message}}` → MCP `isError`/结构化 error 的精修 → **S2**。
- pi 扩展（`lib/pi/normify.js` + typebox 投影）→ **S3**。
- SKILL.md 复用 + 各宿主放置说明 → **S4**。
- companion 钩子（计数器 + reminder）迁移到 MCP server → **S5**。
- `tests/mcp-smoke.mjs` 接入 `npm test` → **S6**（S1 的 smoke 为独立命令，不进 `npm test`，避免每次跑 DSH e2e 都启 server）。
- 不修改 `src/catalog.ts` / `src/tools.ts` / `src/engine/`（S0 已稳定，S1 只消费）。
- 不加 `package.json` 的 `bin`/`exports` 入口、不发布 npm（设计 §0「暂不发布」）；§3.1 宿主配置用 `node <repo>/lib/mcp/server.js` 直路径，`files:["lib",...]` 已 wholesale 含 `lib/mcp/`。`bin` 入口留发布阶段。

## 设计输入与依赖

- **catalog**（S0 产物）：`src/catalog.ts` 导出 `buildCatalog(env: ToolEnv): ToolEntry[]`、`ToolEntry`、`ToolEnv`、`ObjectSchema`。`ToolEntry.parameters` 是 `ObjectSchema`（JSON-Schema-shaped `SchemaNode & { required?: string[] }`），可直接作 MCP `inputSchema`。
- **`@modelcontextprotocol/sdk`**（新依赖，TS）：提供 `Server`、`StdioServerTransport`、`ListToolsRequestSchema`/`CallToolRequestSchema`。
- **tsconfig**（现有）：`include:["src"]`、`rootDir:"src"`、`outDir:"lib"`——`src/mcp/server.ts` 自动编译到 `lib/mcp/server.js`，无需独立 tsconfig。
- **§9 Q2 决断**（本 Action draft 内作出）：MCP 入口产物路径 = `lib/mcp/server.js`（源 `src/mcp/server.ts`，复用现有 tsconfig，少一个构建步骤，与 `lib/catalog.js` 同构）。倾向项被 tsconfig 事实确认（`include:["src"]`+`rootDir:"src"`+`outDir:"lib"`）。注：§3.1 L110 写的 `mcp/server.ts` 是简写，canonical 源路径为 `src/mcp/server.ts`（tsconfig `rootDir:"src"`）。**回流**：Close 时更新 `docs/MULTIPLATFORM.zh-CN.md` §9 Q2 标记 resolved，并修 §3.1 L110 路径为 `src/mcp/server.ts`。
- 不解决 [MULTIPLATFORM.zh-CN.md §9](../../../../MULTIPLATFORM.zh-CN.md#9-待对齐的开放问题) 中影响后续步骤的开放问题（Q3/Q4）；仅 Q2 在本 Action 内决断。

## 范围与边界

- 新增：`src/mcp/server.ts`、`tests/mcp-smoke.mjs`、`@modelcontextprotocol/sdk` 依赖、`package-lock.json` 更新。
- 修改：`package.json`（dependencies + 版本）。
- 不改：`src/catalog.ts`、`src/tools.ts`、`src/engine/*`、`ci-contract-check.cjs`（仍读 `lib/catalog.js`，S1 不碰 catalog）。

## 需求

- R-001 MUST：`src/mcp/server.ts` 通过 `import { buildCatalog } from '../catalog.js'` 复用 catalog；不重声明任何 `register('normify_*')` 字面量、不重写工具业务逻辑或 missing-args/toErrorPayload（已在 `ToolEntry.execute` 内）。
- R-002 MUST：`npm run build` 产出 `lib/mcp/server.js`（复用现有 tsconfig，Q2）。隐含前置：`npm install` 已装 `@modelcontextprotocol/sdk`（vendor-ts 环境下 build.sh 不自动装，见 F-026）。
- R-003 MUST：DSH 零回归——`npm test`（5 套 e2e）退出 0、全 PASS。
- R-004 MUST：`tsc --noEmit` 0 错。
- R-005 MUST：`tests/mcp-smoke.mjs`——启 server（stdio 子进程）、完成 MCP `initialize` 握手、`tools/list` 返回恰好 31 个工具且名称与 catalog 一致；`tools/call` 一个只读工具（`normify_help` topic=tools）返回 `isError === false` 且 `content` 非空。
- R-006 MUST：`tools/call` 未知工具名 → 返回 `isError === true`（错误路径可观察）。
- R-007 SHOULD：`@modelcontextprotocol/sdk` 在 `package.json` **`dependencies`**（非 devDependencies）中钉定具体版本（`package-lock.json` 锁定）。理由：server 被 `node lib/mcp/server.js` 独立 spawn，运行时须从 `node_modules` 解析 SDK——与 DSH 的 cordis/schemastery（devDeps，经 bundle patch 注入）不同。
- R-008 SHOULD：server 从环境变量读 `ToolEnv`：`NORMIFY_ROOT_DIR`（默认 `process.cwd()`）、`NORMIFY_REQUIRE_BILINGUAL`（默认 `'1'`→true），并在文件头注释说明。
- R-009 SHOULD：§6-1 契约不变——`ci-contract-check.cjs` 仍读 `lib/catalog.js`（S1 不碰 catalog），S1 新增的 `lib/mcp/server.js` 不被该脚本扫（readFileSync 路径未变），脚本仍 exit 0。

## 提议设计

### 入口与运行时

`src/mcp/server.ts`：

```ts
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { buildCatalog } from '../catalog.js';
import type { ToolEnv } from '../catalog.js';

// ToolEnv 从环境变量读：NORMIFY_ROOT_DIR（默认 cwd）、NORMIFY_REQUIRE_BILINGUAL（默认 '1'→true）
const env: ToolEnv = {
    rootDir: process.env.NORMIFY_ROOT_DIR ?? process.cwd(),
    requireBilingual: (process.env.NORMIFY_REQUIRE_BILINGUAL ?? '1') !== '0',
};
const catalog = buildCatalog(env);
// tsconfig 无 resolveJsonModule → 用 readFileSync 读版本（lib/mcp/server.js → ../../package.json）
const version = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version;
const server = new Server({ name: 'normify', version }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: catalog.map(e => ({ name: e.name, description: e.description, inputSchema: e.parameters })),
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const entry = catalog.find(e => e.name === req.params.name);
    if (!entry) return { content: [{ type: 'text', text: `未知工具：${req.params.name}` }], isError: true };
    const value = await entry.execute(req.params.arguments ?? {});
    // ToolEntry.execute 是 wrapped（不抛业务错）：返 {ok:true,...} | {ok:false,error} | string | 对象
    // isError 仅当「对象且 ok===false」；字符串/无 ok 字段的对象视为成功（避免把字符串结果误判为 error）。
    // 当前 31 工具全返 {ok:...} 对象，但契约是 Promise<unknown>，精确判定不依赖该隐式不变量。
    const isError = typeof value === 'object' && value !== null && (value as { ok?: unknown }).ok === false;
    return {
        content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }],
        isError,
    };
});

// main guard：smoke 可能用相对路径 spawn，resolve(argv[1]) 对齐 fileURLToPath(import.meta.url) 的绝对路径
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const transport = new StdioServerTransport();
    await server.connect(transport);
}
```

### 结果映射

- `tools/list`：`inputSchema = entry.parameters`（ObjectSchema 已是 JSON Schema；`params()` helper 显式 `type:'object'`，31/31 用 `params(...)`，顶层 `type:'object'` 必在，透传安全）。
- `tools/call`：`entry.execute(args)` 返回 `{ok:true,...}` | `{ok:false,error}` | 字符串/对象。映射：`isError = (value.ok === false)`；`content[0].text` = 字符串直传、对象 `JSON.stringify(value, null, 2)`。
- **§6-5 兑现**：engine 业务函数返回载荷已含绝对路径（`normify.html`/`tree.json` 等，宿主无关的引擎行为）；MCP `content[0].text = JSON.stringify(value)` 原样保留，各宿主 `read`/`open` 工具可打开。S1 不动 engine，透传即满足。
- 错误载荷精修（`code`→MCP structured error、`{ok:false}`→`isError` 外加 `content` 内结构化 error）留 S2。

### smoke test

`tests/mcp-smoke.mjs`：`child_process.spawn('node', [path.resolve('lib/mcp/server.js')])`（绝对路径，与 main guard 的 `resolve(argv[1])` 对齐），子进程 stdio 走 **newline-delimited JSON-RPC 2.0**（MCP TS SDK `StdioServerTransport` 默认帧，每行一个 JSON 对象，无 `Content-Length` 头）：`initialize`（请求→响应，client 带 `protocolVersion`+`capabilities`+`clientInfo`，接受 server 协商返回的版本）→ `notifications/initialized`（notification，无响应——MCP 规定 server 收此才接受后续请求）→ `tools/list`（断言 31 个、含 `normify_help`/`normify_module_batch`）→ `tools/call` normify_help `{topic:'tools'}`（断言 `isError===false`、content 非空）→ `tools/call` 未知 `nope`（断言 `isError===true`）→ teardown kill。最小 client：逐行 `JSON.stringify(msg)+'\n'` 写 stdin、按行收集 stdout `JSON.parse`。**cleanup 纪律**：整体裹 `try { ... } finally { child.kill('SIGTERM') }`，任一断言中途抛错也回收子进程（不泄漏）。**超时保护**：整体 10s deadline（`setTimeout(() => { child.kill('SIGTERM'); throw new Error('smoke timeout') }, 10000)` 并在 finally 清 `clearTimeout`），server 挂起/握手卡住不无限阻塞。复用现有 `tests/` 的断言风格（现有 .mjs 无 stdio JSON-RPC 先例，手写最小 client）。

## 实施计划

- P-001：`package.json` 加 `@modelcontextprotocol/sdk` 钉定版本；`npm install`（更新 `package-lock.json`）。
- P-002：写 `src/mcp/server.ts`（buildCatalog → MCP server、tools/list + tools/call、env-var ToolEnv、stdio main guard）。
- P-003：写 `tests/mcp-smoke.mjs`（spawn 子进程、initialize 握手、list→31、call read→ok、call unknown→error、teardown）。
- P-004：`npm run build` → 验证 `lib/mcp/server.js` 产出。
- P-005：跑 validation 全链（见 Validation 节：install→build→tsc→test→smoke→contract→静态断言）；记录证据。
- P-006：不把 smoke 接入 `npm test`（S6 职责）；不提交直到授权。

## 验收

| ID | Requirement | 可观察条件 | 计划证据 | Status |
| --- | --- | --- | --- | --- |
| A-001 | R-001 | `src/mcp/server.ts` import `buildCatalog` 且无 `register('normify_*')` 字面量 | `grep "import { buildCatalog } from '../catalog.js'" src/mcp/server.ts` 命中（精确 import 行，非注释）且 `grep -c "register('normify" src/mcp/server.ts` = 0 | passed |
| A-002 | R-002 | `npm run build` 产出 `lib/mcp/server.js` | `test -f lib/mcp/server.js` 退出 0 | passed |
| A-003 | R-003 | DSH 零回归 | `npm test` 退出 0，5 套 `=== 结果：全部 PASS ===` | passed |
| A-004 | R-004 | 类型检查通过 | `tsc --noEmit` 退出 0 | passed |
| A-005 | R-005 | smoke：list 31 + call 只读成功 | `node tests/mcp-smoke.mjs` 退出 0；stdout 含 `PASS` 行（31 工具 / call normify_help ok / call unknown error），与现有 .mjs PASS 惯例对齐 | passed |
| A-006 | R-006 | smoke：未知工具报错 | `node tests/mcp-smoke.mjs` 退出 0；stdout 含 unknown-tool 步 `PASS` 行（断言 `isError===true`），与 A-005 同 smoke、同 PASS 惯例 | passed |
| A-007 | R-007 | SDK 钉版本 | `grep '@modelcontextprotocol/sdk' package.json` 有具体版本号 | passed |
| A-008 | R-008 | env-var 读 ToolEnv | `grep -c 'NORMIFY_ROOT_DIR' src/mcp/server.ts` ≥1 且 `grep -c 'NORMIFY_REQUIRE_BILINGUAL' src/mcp/server.ts` ≥1（两变量各命中，不靠单行双匹配） | passed |
| A-009 | R-009 | 契约检查不受 S1 影响 | `node ci-contract-check.cjs` 退出 0，输出 `bundle + tool-name contract ok` | passed |

## Validation

计划命令（实际结果待执行）：

**环境约束（F-026）**：`@modelcontextprotocol/sdk` 是 runtime dep（`lib/mcp/server.js` 运行时 import），不在 `scripts/build.sh` 的 vendor-ts 预置集（typescript/types-node/cordis/schemastery/cosmokit/yaml）内。vendor-ts 本地环境下 `npm run build` 不自动装它——**`npm install` 是 `build`/`test`/smoke 的硬前置**（下序第一步已如此）；CI/npm 路径由 `build.sh` 自动 `npm install` 兜底。

```bash
# 与 S0 验证链对齐：build → tsc → test → smoke → contract → 静态断言
npm install                       # P-001：装 @modelcontextprotocol/sdk，更新 package-lock.json
npm run build                     # P-004 / A-002：产出 lib/mcp/server.js（复用 tsconfig）
npx tsc -p tsconfig.json --noEmit # A-004：0 错
npm test                          # A-003：5 套 DSH e2e 全 PASS（零回归）
node tests/mcp-smoke.mjs          # A-005/A-006：MCP stdio smoke，31 工具 + call ok + call unknown error
node ci-contract-check.cjs        # A-009：契约检查不受 S1 影响，输出 bundle + tool-name contract ok

# 静态断言（A-001 / A-002 / A-007 / A-008）
grep "import { buildCatalog } from '../catalog.js'" src/mcp/server.ts  # A-001 命中
grep -c "register('normify" src/mcp/server.ts                     # A-001 = 0
test -f lib/mcp/server.js                                         # A-002 exit 0
grep '@modelcontextprotocol/sdk' package.json                     # A-007 有版本号
grep -c 'NORMIFY_ROOT_DIR' src/mcp/server.ts           # A-008 ≥1
grep -c 'NORMIFY_REQUIRE_BILINGUAL' src/mcp/server.ts  # A-008 ≥1
```

## Validation 实际执行（2026-09-25）

| Field | Actual value |
| --- | --- |
| Date | 2026-09-25 |
| Commit | 未提交（工作树状态，待 commit 授权） |
| Environment | Node v22.21.1；`@modelcontextprotocol/sdk` ^1.30.1（resolved 1.30.1，94 包）；`feat/catalog` 分支 |

| Acceptance | Command or observation | Exit/result | Evidence | Result |
| --- | --- | --- | --- | --- |
| A-001 | `grep "import { buildCatalog } from '../catalog.js'" src/mcp/server.ts` + `grep -c "register('normify" src/mcp/server.ts` | 0 | import 命中 L10；register('normify 计数 = 0 | passed |
| A-002 | `test -f lib/mcp/server.js` | 0 | 存在；另含 `lib/mcp/server.js.map` + `lib/types/mcp/server.d.ts` | passed |
| A-003 | `npm test` | 0 | 5 套均 `=== 结果：全部 PASS ===`；`git diff --stat src/engine/` 为空（引擎零改动） | passed |
| A-004 | `npx tsc -p tsconfig.json --noEmit` | 0 | 无输出 | passed |
| A-005 | `node tests/mcp-smoke.mjs` | 0 | 10 项 PASS（initialize 握手 / tools/list 31 + 含 3 工具 + inputSchema type:object / call normify_help isError===false + content 非空） | passed |
| A-006 | smoke ⑤ `tools/call nope` | 0 | `PASS  ⑤ call 未知工具 nope → isError===true` | passed |
| A-007 | `grep '@modelcontextprotocol/sdk' package.json` | 0 | `"@modelcontextprotocol/sdk": "^1.30.1"`（dependencies，非 devDeps） | passed |
| A-008 | `grep -c NORMIFY_ROOT_DIR / NORMIFY_REQUIRE_BILINGUAL src/mcp/server.ts` | 0 | 2 / 2（两变量各命中） | passed |
| A-009 | `node ci-contract-check.cjs` | 0 | `bundle + tool-name contract ok`（脚本仍读 lib/catalog.js，不受 lib/mcp/ 影响） | passed |

## Uncovered areas and residual risks

- **G-001（已落地确认）**：SDK 1.30.1 实际导出与设计 import 路径一致——`Server`@`server/index.js`、`StdioServerTransport`@`server/stdio.js`、`ListToolsRequestSchema`/`CallToolRequestSchema`@`types.js` 均命中；`LATEST_PROTOCOL_VERSION="2025-11-25"`，smoke 用此握手成功。无需 high-level `server.tool()` 替代（手动 `setRequestHandler` 工作正常）。
- **F-059（未修，出范围）**：`package.json` 未加 `bin`/`exports` 入口（设计 §0 暂不发布）；§3.1 宿主配置用 `node <repo>/lib/mcp/server.js` 直路径，`files:["lib"]` 已含 lib/mcp/。非阻塞，留发布阶段。
- **持久结论回流**：§9 Q2 已决断（`lib/mcp/server.js`，复用 tsconfig）；收尾（Close）时更新 `docs/MULTIPLATFORM.zh-CN.md` §9 标记 Q2 resolved，并修 §3.1 L110 路径为 `src/mcp/server.ts`。

## Closure judgment

Decision: **complete**（Close 工作流独立复核通过）。
Gate review（8 条）：
1. 6 个 MUST（R-001..R-006）→ A-001..A-006 全 passed ✓
2. 9 条 Acceptance 均有可复现 Validation 证据（命令+结果已录）✓
3. 失败/回退/兼容/安全义务：回退 `git revert`+`npm install` 未触发（无失败）；tsc/e2e/smoke/contract 四闸全绿；DSH 零回归（A-003）；无 secrets/外部副作用 ✓
4. 无 pending/未知/推断项 ✓
5. 残留 F-059（`bin`/`exports` 推迟发布阶段，出范围）、G-001（SDK 1.30.1 实际导出与设计一致，已落地确认）均不悖 MUST ✓
6. 持久结论回流：§9 Q2 已标 resolved；§3.1 L110 + §7-S1 L249 路径已修为 `src/mcp/server.ts` ✓
7. 实现对应工作树修订（commit 待授权）✓
8. 仓库校验 `validate_action.py` 0/0；无 secrets；`lib/mcp/` 产物随包提交（`files:["lib"]`）✓
Reason: 所有 MUST 与 SHOULD 均以可执行证据通过；engine 零改动；DSH 零回归；catalog 跨平台复用经第二个适配器（MCP）验证成立——`src/mcp/server.ts` `import buildCatalog`、0 重注册、31 工具经 `tools/list` 暴露、`tools/call` 经 `ToolEntry.execute` 返回（platform-agnostic wrapped 不重裹）。本 Action 归档至 `_archive/complete/mcp-server/`。

## Readiness gaps

- **G-001**：`@modelcontextprotocol/sdk` 的具体版本、ESM 子路径（`/server/index.js`、`/server/stdio.js`、`/types.js`）与 `Server` 构造/capabilities 形状（`{ capabilities: { tools: {} } }`）按 1.x 示例书写。execute 时以 `npm install` 后实际导出为准：若子路径或 `setRequestHandler`/`StdioServerTransport` API 不同则调整 import 与调用，不改设计（buildCatalog→list/call、isError=对象且 ok===false 不变，见 F-042）；若该版本提供 high-level `server.tool(name, schema, handler)` 注册式 API，P-002 可改用它替代手动 `setRequestHandler`，仍调 `entry.execute`、不重裹。
- **G-002**（已澄清，非阻塞）：`inputSchema = entry.parameters` 透传安全——`params()` helper 显式 `return toJsonSchema({ type:'object', properties })`，且 31/31 register 调用均用 `params(...)` 作 `parameters`（grep 确认），顶层 `type:'object'` 必在。execute 时抽检 1-2 个 entry 即可兑底；若极端个别 entry 缺 `type`（不在 params 家族），映射处补 `{ ...e.parameters, type:'object' }`（不改 catalog）。
- **G-003**：§9 Q3（pi extension 是否进本仓库）、Q4（JSON Schema→typebox 投影）影响 S3+，不阻塞本 Action。

**Ready 判定（2026-09-25，经 20 轮 Review）**：范围/非范围明确（§7-S1/S2 切分有据）、设计输入可溯（catalog/tsconfig/§3.1/§6/§9-Q2）、9 条需求（R-001~R-009）均有可观察验收（A-001~A-009，验收收紧至精确 import 行/双变量各命中）、验证计划与 S0 链对齐（install→build→tsc→test→smoke→contract→静态断言）并标注 vendor-ts 环境约束（F-026：`npm install` 硬前置）、失败回退与提交完整性已写明（含 `package.json`+`lib/`+`package-lock.json`）、跨文档一致（§3.1 路径简写已标、§6-1/§6-5 已认领、Closure 含 A-009）。smoke 失败路径覆盖完整（cleanup try/finally + 10s 超时 deadline）。五个技术点经事实验证成立：①`inputSchema = entry.parameters` 透传安全（`params()` 显式 `type:'object'`、31/31 用 `params(...)`）；②`isError` 精确化——仅「对象且 ok===false」判 error，字符串/无 ok 对象视为成功（F-042，避免把字符串结果误判）；③MCP 握手两步——`initialize` 请求→响应 + `notifications/initialized` 通知后才接受 `tools/list`（F-046，smoke 客户端驱动，server 端 SDK 自动）；④`@modelcontextprotocol/sdk` 必须在 `dependencies`——server 独立 spawn runtime 解析（非 vendor-ts 集）；⑤main guard 用 `resolve(argv[1]) === fileURLToPath(import.meta.url)` + smoke 绝对路径 spawn（F-056，避免相对路径致 guard 不触发→server 不 connect）。残留 G-001（SDK 版本/API 面，execute 时以实际导出为准，设计稳定；isError 措辞已同步 F-042「对象且 ok===false」）、G-002（已澄清）、G-003（出范围）均不阻塞。发布面（`bin`/`exports` 入口）显式推迟至发布阶段（F-059）；A-006 验收已收紧至外部可观察（stdout PASS 行 + 退出 0，F-068）；smoke 环境隔离确认（normify_help 纯，不触 missing-args/requireBilingual/rootDir，F-067）。可进 Execute。

## Closure conditions

- 全部 MUST 验收（A-001..A-006）通过并记录证据。
- A-007/A-008/A-009（SHOULD）通过或记录豁免理由。
- §9 Q2 已在本 Action 决断（`lib/mcp/server.js`，复用 tsconfig）；Close 时回流 = 更新 [MULTIPLATFORM.zh-CN.md](../../../../MULTIPLATFORM.zh-CN.md) §9 标记 Q2 resolved。
- 状态、路径、导航一致；本 Action 归档前 `STATUS.md` 更新为 `complete`。
- **提交完整性**：实施 commit 须含 `npm run build` 重建的 `lib/` 产物（含新 `lib/mcp/server.js` + `lib/types/mcp/` d.ts）+ `package.json`（加 `@modelcontextprotocol/sdk` 依赖）+ `package-lock.json`（SDK 版本锁定）。src 与 lib 同提交，避免 fresh clone 的 smoke 因 `lib/mcp/server.js` ENOENT 失败。
- **失败回退**：本次实施作为单 commit 原子提交；任一验收不过即 `git revert`，并 `npm install` 复位依赖。
