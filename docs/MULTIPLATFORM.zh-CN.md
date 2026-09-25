# Normify 多平台适配设计（草稿）

> 把 Normify 的 31 个 `normify_*` 工具与 `normify-gen` 技能从 DSH 专用扩展为**多宿主可运行**：
> Claude Code / OpenAI Codex / Cursor / pi。引擎层零改动，只在工具注册层加薄适配器。
>
> 状态：**草案**（待对齐后实施）｜ 不变更 v1.0 规范语义、不破坏现有 DSH 集成。

---

## 0. 文档性质与范围

### 0.1 文档性质

本文档是 Normify 多平台适配的**实施计划**，是后续提交的实现依据。规范用语遵循 RFC 2119：

- **MUST / MUST NOT**：强制要求（违反即视为实现缺陷）；
- **SHOULD / SHOULD NOT**：强烈建议；
- **MAY**：可选。

### 0.2 在范围内

1. 在**不修改 `src/engine/*` 任何源码**的前提下，让 31 个工具与 `normify-gen` 技能可在四个宿主运行。
2. 抽出平台无关的**工具目录（catalog）**中间层，DSH 入口退化为它的一个适配器。
3. 新增 **MCP server**（覆盖 Claude Code / Codex / Cursor）。
4. 新增 **pi extension**（覆盖 pi）。
5. 复用 `skills/normify-gen/SKILL.md`（不改一个字，靠各宿主的 skills 目录放置）。
6. 迁移「伴随开发提醒钩子」到 MCP / pi 各自的事件模型。

### 0.3 不在范围内（本次不做）

- **不发布 npm 包**（包名 / 多包拆分等发布形态留待后续讨论）。
- 不改动 `src/engine/*` 的任何业务逻辑、校验规则、产物格式。
- 不改动 `skills/normify-gen/SKILL.md` 正文（工具名稳定是其可复用的前提）。
- 不实现 Cursor 的非 MCP 集成（如 `.cursor/rules`）；Cursor 仅通过 MCP 接入。
- 不新增工具、不改工具语义、不改工具参数 schema。

---

## 1. 现状：耦合点体检

### 1.1 已天然解耦的部分（零改动）

| 模块 | 依赖 | 结论 |
| --- | --- | --- |
| `src/engine/*.ts`（约 5800 行） | 仅 Node 内置（`fs`/`path`/`crypto`/`child_process`） | **已 100% 与 DSH 解耦**；5 套 e2e 测试不经过 DSH 即可跑通 |
| `vendor/schemastery` | 相对路径加载，本就不依赖宿主包名解析 | 可继续用于 DSH 入口；其他入口不使用 |
| `skills/normify-gen/SKILL.md` | frontmatter 仅 `{name, description}`，符合 [Agent Skills](https://agentskills.io) 标准 | 跨平台可直接复用 |

### 1.2 唯一需要适配的耦合点

| 文件 | DSH 依赖 | 适配策略 |
| --- | --- | --- |
| `src/tools.ts`（1791 行） | `import type { Context } from '@deepseek-ai/cordis'`（仅类型）；运行时 `(ctx as unknown as {tools?}).tools.register(...)` | 抽出 `buildCatalog(env): ToolEntry[]`；`registerTools()` 退化为遍历 catalog 调 DSH `tools.register` |
| `src/index.ts`（152 行） | `ctx.tools` / `ctx.skills.register` / `ctx.logger` / `ctx.effect` / `ctx.on('tools/post-execute')` | DSH 入口保持；新入口（MCP / pi）各自实现工具暴露、技能放置、companion 钩子 |

### 1.3 关键设计资产

`src/tools.ts` 的 `registerTools()` 内部已存在一个**平台无关中间结构**：

```ts
const toolCatalog: ToolCatalogEntry[] = [];
const register = <A>(key, def, execute) => {
  toolCatalog.push({ name: key, description: def.description, behavior: def.behavior, parameters: def.parameters });
  // …然后才调用 DSH 的 tools.register
};
```

这意味着把"构造目录"与"调用宿主注册 API"拆开，**改动集中在 `registerTools` 一个函数内**，31 个工具定义本身不动。

---

## 2. 目标架构

```
                        ┌─────────────────────────────────────┐
                        │   src/engine/*  (零改动，确定性引擎)  │
                        └─────────────────┬───────────────────┘
                                          │
                        ┌─────────────────┴───────────────────┐
                        │   src/catalog.ts  (新，平台无关)      │
                        │   buildCatalog(env): ToolEntry[]     │
                        │   ToolEntry = { name, description,   │
                        │     behavior, parameters(JSONSchema),│
                        │     execute }                       │
                        └──┬──────────┬──────────┬───────────┘
                           │          │          │
              ┌────────────┴──┐  ┌─────┴──────┐  ┌┴─────────────────┐
              │ DSH 入口(旧)  │  │ MCP server │  │ pi extension     │
              │ src/index.ts  │  │ mcp/server │  │ pi/normify.ts    │
              │ registerTools│  │ .ts        │  │ pi.registerTool  │
              │ + ctx.skills  │  │ stdio      │  │ + skills 目录放置 │
              └───────────────┘  └────────────┘  └──────────────────┘
                    │                  │                │
                 DSH            Claude/Codex/Cursor     pi
              (不变)              (MCP 协议)        (extension API)
```

**不变量**：
- 四个入口共享同一个 `buildCatalog()`，工具名 / 描述 / 参数 / 行为**完全一致**。
- 任何 bug 修复或新工具（未来）只在 `buildCatalog()` 改一次，四宿主同时受益。

---

## 3. 平台适配方案

### 3.1 MCP server（覆盖 Claude Code / Codex / Cursor）

**协议选型**：官方 `@modelcontextprotocol/sdk`（TS，社区主流，跟协议演进）。

**入口**：`src/mcp/server.ts`（编译到 `lib/mcp/server.js`），stdio transport。

**职责**：
- `tools/list`：遍历 `buildCatalog(env)`，映射成 `{ name, description, inputSchema }`（normify 的 `ObjectSchema` 本就是 JSON Schema，几乎零转换）。
- `tools/call`：按 `name` 找到 `ToolEntry`，调用 `execute(args)`，返回 `{ content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }`。
- 错误：`execute` 抛错时返回 `isError: true` 的 MCP 错误载荷（与 DSH `toErrorPayload` 同语义）。

**behavior → annotations 映射**（MCP `Tool.annotations`）：
- `read` → `{ readOnlyHint: true }`
- `idempotent` → `{ readOnlyHint: true }`（幂等只读）
- `write` → `{ readOnlyHint: false }`
- `destroy` → `{ destructiveHint: true }`

**配置**（用户侧，写入各宿主配置）：
```jsonc
// Claude Code (.mcp.json 或 ~/.claude.json)
// Codex    (~/.codex/config.toml [mcp_servers.normify])
// Cursor   (.cursor/mcp.json 或全局)
{ "mcpServers": { "normify": { "command": "node", "args": ["<repo>/lib/mcp/server.js"] } } }
```

**env 来源**：`NORMIFY_ROOT_DIR` 环境变量（缺省 `process.cwd()`）；`NORMIFY_REQUIRE_BILINGUAL`（缺省 `true`）。MUST NOT 依赖 DSH 的 `Config`/schemastery。

### 3.2 pi extension（覆盖 pi）

**入口**：`src/pi/normify.ts`（编译到 `lib/pi/normify.js` 供单测+构建工件；pi 运行时加载 .ts 源——自动发现 `~/.pi/agent/extensions/*.ts` glob）。软链 `src/pi/normify.ts` 到 `~/.pi/agent/extensions/normify.ts` 或 `.pi/extensions/`。

**职责**：
- `export default function (pi: ExtensionAPI)`：遍历 `buildCatalog(env)`，对每个 entry 调 `pi.registerTool({...})`。
- `parameters`：normify `ObjectSchema` → typebox。枚举字段 MUST 用 `StringEnum([...])`（pi 文档：`Type.Union/Type.Literal` 与 Google API 不兼容）。
- `execute(toolCallId, params, signal, onUpdate, ctx)`：转调 `entry.execute(params)`；返回 `{ content: [{type:'text', text}], details: result }`。
- `promptSnippet`：`<name>: <description>`（一行，进系统提示词的 Available tools）。
- `promptGuidelines`：可选；从 SKILL.md 摘取关键铁律（如"0 error 强制收尾"）放进 Guidelines。
- **文件变更队列**：工具若改结构数据文件（`module_upsert`/`batch`/`delete` 等）SHOULD 用 `withFileMutationQueue()` 参与与内置 `edit`/`write` 的同文件队列，避免并发覆盖。

**env 来源**：`rootDir` 从 `process.env.NORMIFY_ROOT_DIR ?? process.cwd()` 读（ExtensionAPI 无 cwd 字段，S3 F-006）；`requireBilingual` 从 `(process.env.NORMIFY_REQUIRE_BILINGUAL ?? '1') !== '0'` 读（默认 true，与 MCP §3.1 同）。

**技能放置**：把 `skills/normify-gen/` 软链或拷贝到 `~/.pi/agent/skills/`；pi 能直接读 Claude/Codex 的 skills 目录，所以也可在 settings 里 `"skills": ["<repo>/skills"]`。

### 3.3 DSH 入口（保持不变）

`src/index.ts` 的 `apply()` 继续用 `registerTools(ctx, config)` + `registerSkill(ctx)` + `installCompanionReminder(ctx, config)`。改造后 `registerTools` 内部变成：

```ts
export function registerTools(ctx: Context, env: ToolEnv): void {
  const catalog = buildCatalog(env);
  const tools = (ctx as unknown as { tools?: ToolService }).tools;
  if (!tools?.register) return;
  for (const entry of catalog) {
    tools.register({
      ...entry,
      readOnly: entry.behavior === 'read',
      idempotent: entry.behavior === 'read' || entry.behavior === 'idempotent' || entry.behavior === 'destroy',
      destructive: entry.behavior === 'destroy',
      output: { schema: {}, render: (_a, v) => [{ type: 'text', text: typeof v === 'string' ? v : JSON.stringify(v, null, 2) }] },
      // execute 由 ...entry 提供（ToolEntry.execute 已是 wrapped：missing-args + toErrorPayload），不重裹
      ...(entry.behavior === 'read' ? { isConcurrencySafe: () => true } : {}),
    });
  }
}
```

**DSH 行为不变量**：改造后 `npm test` 的 5 套 e2e MUST 全部继续 PASS；`ci-contract-check.cjs` 的"恰好 31 个工具名"断言 MUST 继续 PASS（它 grep 的是 `lib/tools.js` 的 `register('...')`，需要在 catalog 化后调整该检查脚本，见 §6）。

---

## 4. SKILL.md 复用策略

`skills/normify-gen/SKILL.md` 正文通篇引用具名工具（`normify_module_upsert` 等）。**只要各入口暴露同名工具，技能指令原样有效**。

| 宿主 | 放置方式 |
| --- | --- |
| Claude Code | `~/.claude/skills/normify-gen/SKILL.md`（或项目 `.claude/skills/`） |
| Codex | `~/.codex/skills/normify-gen/SKILL.md` |
| Cursor | 无统一 skill 机制；仅 MCP 接入，SKILL.md 正文可手动粘进 `.cursor/rules/normify.mdc`（本次不做自动化） |
| pi | `~/.pi/agent/skills/normify-gen/`，或 settings `"skills": ["<repo>/skills"]` |

**不变量**：SKILL.md 正文 MUST NOT 被改动（任何平台差异由工具适配器吸收，而非改写技能指令）。

---

## 5. 伴随开发提醒钩子迁移

原 `installCompanionReminder`（`src/index.ts`）监听 DSH 私有事件 `tools/post-execute`，连续 N 个写工具后追加提醒文本。

### 5.1 MCP server（server 进程内有状态）

MCP server 是常驻 stdio 进程，计数器可直接放模块作用域：

```ts
let writeCount = 0;
const WRITE_TOOLS = /^(write|edit|...)$/i;
// 在 tools/call handler 里，execute 后判断 entry.behavior !== 'read' 则 ++writeCount；
// 达阈值则把 reminder 作为额外 content 段拼进返回。
```

MUST：计数器与 server 生命周期绑定；server 重启清零（与 DSH 单会话语义一致）。

### 5.2 pi extension（同进程事件）

pi 的 `pi.on('tool_call' | 'tool_result', ...)` 事件可拦截 / 改写结果：

```ts
pi.on('tool_result', async (event, ctx) => {
  if (WRITE_TOOLS.test(event.toolName)) {
    writeCount++;
    if (writeCount >= threshold) {
      writeCount = 0;
      // 在 event.result.content 末尾追加 reminder 文本
    }
  }
});
```

MUST：阈值 `devCompanionReminderAfter` 从 pi settings 读（缺省 8）；默认关闭（与 DSH 一致）。

### 5.3 DSH 入口

保持原 `installCompanionReminder` 不动（它已用 DSH 事件，无需迁移）。

---

## 6. 契约与约束

1. **工具名稳定**：31 个 `normify_*` 名称 MUST 在四个入口完全一致（SKILL.md 依赖之）。`ci-contract-check.cjs` 的 `readFileSync` 路径改为 `lib/catalog.js`（原 `lib/tools.js`，见 S0 P-005），regex 不变。
2. **参数 schema 一致**：同一 `ToolEntry.parameters` 同时喂给 DSH / MCP / typebox(pi)。MCP 的 `inputSchema` 直接用；pi 需 JSON Schema → typebox 投影（枚举用 `StringEnum`）。
3. **`rootDir` 语义**：DSH 下默认 `.`（工作目录）；MCP 下默认 `process.cwd()`；pi 下默认 `pi.cwd`。三者语义一致（都是"当前项目根"）。
4. **零容忍收尾不变**：`normify_validate` / `normify_build` / `normify_change_close` 的 0-error 门禁是引擎行为，与宿主无关，四个入口共享。
5. **产物路径汇报**：MCP / pi 入口返回的文本里 MUST 继续带绝对路径（`normify.html` / `tree.json` 等），让各宿主的 `read`/`open` 工具能打开——原 SKILL.md 第 9 节已强调。

---

## 7. 落地步骤（分阶段，每步可独立验收）

每步完成后 MUST 跑 `npm test` 全绿，方可进入下一步。

| 步 | 内容 | 验收 | 风险 |
| --- | --- | --- | --- |
| **S0** | 抽 `src/catalog.ts`：`buildCatalog(env): ToolEntry[]`；`src/tools.ts` 的 `registerTools` 退化为遍历 catalog | DSH e2e 5 套全 PASS；`tsc --noEmit` 0 错；`ci-contract-check.cjs` 通过 | 零（DSH 行为不变） |
| **S1** | 加 `src/mcp/server.ts` + `@modelcontextprotocol/sdk` 依赖；实现 `tools/list` + `tools/call` | 新增 `tests/mcp-smoke.mjs`：启动 server，列出 31 个工具，call 一个只读工具断言返回 | 低 |
| **S2** | behavior → MCP annotations 映射；错误载荷映射 | smoke test 覆盖 readOnly/destructive 标记与一个 error 路径 | 低 |
| **S3** | 加 `src/pi/normify.ts`；JSON Schema → typebox 投影（含 `StringEnum`）+ formatResultText | 手动加载到 pi（软链 .ts），`/reload` 后 31 个工具可见；call 一个工具 | 低 ✅ |
| **S4** | 复用 SKILL.md：写各宿主放置说明（新增 `docs/MULTIPLATFORM-SETUP.md`） | 文档审查 | 零 |
| **S5** | 迁移 companion 钩子：MCP server 内计数器 + pi `tool_result` 事件 | 单测：连续 N 次写工具后返回含 reminder | 低 |
| **S6** | CI 扩展：`ci-contract-check.cjs` 同时查 catalog；加 `tests/mcp-smoke.mjs` 进 `npm test` | CI 全绿 | 低 |

**总工作量预估**：2–3 天（S0–S6）。

---

## 8. 风险与回退

| 风险 | 影响 | 缓解 / 回退 |
| --- | --- | --- |
| catalog 化破坏 DSH 行为 | DSH 用户回归 | S0 后立即跑全量 e2e；任何一项不过即回退该步 |
| MCP SDK 版本与某宿主兼容性 | 某宿主连不上 | 锁定 SDK 版本；smoke test 覆盖 stdio 握手 |
| JSON Schema → typebox 投影丢类型 | pi 下某工具参数错位 | 投影函数单测覆盖每个工具的 `parameters`；枚举强制 `StringEnum` |
| 同名工具在 MCP / pi 行为微差（并发标记等） | 模型困惑 | 行为标记是提示性，非语义；文档说明各宿主并发模型差异 |
| companion 钩子在 MCP server 重启丢计数 | 提醒不连续 | 与 DSH 单会话语义一致，文档说明；非阻断 |

---

## 9. 待对齐的开放问题

1. **S0 的 catalog 文件位置** ✅ resolved：放 `src/catalog.ts`（与 `tools.ts` 同级，非 `src/engine/catalog.ts`）——catalog 依赖 engine 但不是 engine 的一部分。决断由 `catalog-extraction` Action 作出并验证（8 条验收全过，见 `docs/actions/_archive/complete/catalog-extraction/README.md`）。
2. **MCP server 入口产物路径** ✅ resolved：`lib/mcp/server.js`（源 `src/mcp/server.ts`，复用现有 tsconfig，少一个构建步骤）。决断由 `mcp-server` Action 作出并验证（9 条验收全过，见 `docs/actions/_archive/complete/mcp-server/README.md`）。
3. **pi extension 是否进本仓库** ✅ 已决断（S3）：进本仓库 `src/pi/normify.ts`（复用主 tsconfig，编译到 `lib/pi/normify.js`；与 `src/mcp/` 同构）。pi 运行时加载 .ts 源（自动发现 .ts glob）。
4. **JSON Schema → typebox 投影** ✅ 已决断（S3 实施）：手写投影函数 schemaToTypebox/objectSchemaToTypebox（catalog 单一事实源，避免双份定义漂移；9 验收全过，见 `docs/actions/_archive/complete/pi-extension/README.md`）。

---

## 10. 版本

- 草案 v1：2026-09-25，初始对齐版。待讨论确认 §9 后进入 S0。
