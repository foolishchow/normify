# Normify 多平台安装指南

本指南说明如何在 DeepSeek Harness（DSH）、MCP 宿主（Claude Code / Codex / Cursor）和 pi（@earendil-works/pi-coding-agent）中接入 normify。三个适配器共享同一 catalog（31 个工具，零逻辑重复）。

## 概览

normify 提供 3 个适配器入口（共享同一 catalog，31 个工具零逻辑重复）+ 1 个可复用技能（SKILL.md 正文不改）：
- DSH（DeepSeek Harness）插件：`lib/index.js`
- MCP stdio server（Claude Code / Codex / Cursor）：`lib/mcp/server.js`
- pi 扩展（@earendil-works/pi-coding-agent）：`src/pi/normify.ts`

**前置（所有宿主）**：Node.js ≥18（`package.json` engines）；各宿主另需 `npm install`（见各节——DSH 装 dependencies（仅用 yaml）+ peerDeps，MCP 装 dependencies（yaml + @modelcontextprotocol/sdk），pi 装以提供 transitive yaml）。

## 环境变量（MCP / pi；DSH 用 DSH Config）

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `NORMIFY_ROOT_DIR` | `process.cwd()` | normify 结构数据项目根（含 normify-* 目录） |
| `NORMIFY_REQUIRE_BILINGUAL` | `1`（true） | 是否强制 zh/en 双语描述；`0`=关 |
| `NORMIFY_DEV_COMPANION_REMINDER` | `0`（关） | companion 提醒钩子开关；`1`=开 |
| `NORMIFY_DEV_COMPANION_REMINDER_AFTER` | `8` | 触发提醒的连续写工具数 |

> **DSH** 的 `rootDir`/`requireBilingual` 经 DSH Config（schemastery，`Config = z.object({rootDir, requireBilingual, ...})`）配置，**非环境变量**。MCP/pi 用上表 env 变量。

## 1. DSH（DeepSeek Harness）

- 入口：`lib/index.js`（DSH 插件，peerDeps: @deepseek-ai/cordis / @deepseek-ai/dsh-tools / @deepseek-ai/dsh-skill）
- 安装：`npm install`（DSH 仅用 `yaml`（transitive via engine）；`@modelcontextprotocol/sdk` 供 MCP server，DSH 不用但 npm install 仍装；peerDeps 由 DSH 宿主提供，dsh-tools/dsh-skill 为 optional）
- 配置：`rootDir`/`requireBilingual`/`devCompanionReminder`（默认关）/`devCompanionReminderAfter`（默认 8）经 DSH Config（schemastery）配置（非 env 变量）
- SKILL.md：插件 `registerSkill` 自动注册（`lib/index.js` 读 `skills/normify-gen/SKILL.md`，经 `ctx.skills.register`；无需手动放置）
- 验证：在 DSH 会话内调 `normify_help topic=tools` → 31 工具

## 2. MCP（Claude Code / Codex / Cursor）

- 入口：`lib/mcp/server.js`（stdio JSON-RPC 2.0 MCP server；协议版本由 SDK 在 initialize 握手时协商）
- 前置：`npm install`（server 运行时需 dependencies: yaml + @modelcontextprotocol/sdk）
- 配置（写入各宿主配置文件）：
  - Claude Code：`.mcp.json` 或 `~/.claude.json`
  - Codex：`~/.codex/config.toml` `[mcp_servers.normify]`
  - Cursor：`.cursor/mcp.json`（或全局）
  - 形状（JSON，Claude Code/Cursor）：`{ "mcpServers": { "normify": { "command": "node", "args": ["<repo>/lib/mcp/server.js"], "env": { "NORMIFY_ROOT_DIR": "<project>", "NORMIFY_REQUIRE_BILINGUAL": "1" } } } }`；Codex 用 TOML `[mcp_servers.normify]` + `command`/`args`/`env` 键
- env：宿主配置 env 传入 `NORMIFY_ROOT_DIR` / `NORMIFY_REQUIRE_BILINGUAL`（见形状 `env` 键）；可选 `NORMIFY_DEV_COMPANION_REMINDER`/`_AFTER`（companion 提醒钩子）
- **MCP companion 语义**：MCP server 仅见自身 normify_* 工具调用，无法跨进程监听外部编辑器写；companion 改用 `behavior!=='read'` 代理（计 normify 写/destroy/idempotent），语义不同于 DSH/pi（计外部 write/edit）。提醒文本保留 R-004 字节一致。
- SKILL.md 放置：
  - Claude Code：`~/.claude/skills/normify-gen/SKILL.md`（或 `.claude/skills/`）
  - Codex：`~/.codex/skills/normify-gen/SKILL.md`
  - Cursor：手动粘 SKILL.md 正文到 `.cursor/rules/normify.mdc`（无统一 skill 机制）
- 验证：宿主内调 `normify_help topic=tools` → 31 工具

## 3. pi（@earendil-works/pi-coding-agent）

- 入口：`src/pi/normify.ts`（pi 自动发现 .ts glob，非 .js）
- 前置：`npm install`（pi 加载 src/pi/normify.ts → catalog → engine/policy+frontmatter → `yaml`，需 repo node_modules 提供；typebox/pi-ai 由 repo devDeps 或 pi node_modules 解析）
- 安装：软链 `src/pi/normify.ts` → `~/.pi/agent/extensions/normify.ts`（或 `pi -e ./src/pi/normify.ts`）
- env：启动 pi 前在 shell 导出（`export NORMIFY_ROOT_DIR=<project>`；`export NORMIFY_REQUIRE_BILINGUAL=1`；可选 `export NORMIFY_DEV_COMPANION_REMINDER=1; export NORMIFY_DEV_COMPANION_REMINDER_AFTER=8`），或经 pi settings 配置
- SKILL.md：`~/.pi/agent/skills/normify-gen/`，或 settings `"skills": ["<repo>/skills"]`
- 验证：pi 会话 `/reload` 后调 `normify_help topic=tools` → 31 工具

## 4. Dual-Side Mode（多 agent 连同一 server）

- 场景：多 agent（Claude Code / Cursor / Codex / pi）共享单一 catalog/engine 实现；server 长驻，agent 作瘦客户端。
- 设计：`docs/SERVER-MODE.md`。per-user 图隔离（模型 i：路径 `rootDir/[<userId>/]normify-<slug>/`）；Bridge 抽象 repoRoot 访问（LocalBridge=本地 fs；SessionCacheBridge=R3 推送快照，server 不访 client fs）。

### 4.1 起 server（stdio 或 http）

```bash
# stdio（单用户本地，向后兼容；config 指向 command）
NORMIFY_ROOT_DIR=<project> node lib/mcp/server.js

# http（多 agent；多 session 复用 SessionManager）
NORMIFY_TRANSPORT=http NORMIFY_PORT=3000 NORMIFY_ROOT_DIR=<rootDir> node lib/mcp/server.js
```

- env：`NORMIFY_ROOT_DIR`（图数据库根，≠ repoRoot）、`NORMIFY_TRANSPORT`（`stdio` 默认 / `http`）、`NORMIFY_PORT`（http 默认 3000）、`NORMIFY_REQUIRE_BILINGUAL`（默认 1）。
- auth（可选）：`NORMIFY_AUTH_TOKENS`=`JSON {"tok":{"userId":"alice","projects":["demo-repo"]}}` → token→userId+projectAllowlist；无 token=default user+全可见（向后兼容）。stdio token 经 `NORMIFY_SERVER_TOKEN` 注入。

### 4.2 客户端连法

| 宿主 | 连法 |
| --- | --- |
| Claude Code / Cursor / Codex | MCP config 指向 `http://<host>:<port>/mcp`（内置 MCP client，零代码）|
| pi | 瘦客户端扩展 `src/pi/normify-client.ts`（MCP `StreamableHTTPClientTransport` → `pi.registerTool` 桥；`NORMIFY_MCP_URL=http://<host>:<port>/mcp`）|

### 4.3 R3 推送快照（证据工具经 SessionCacheBridge）

证据工具（`normify_fingerprint`/`sync`/`validate`+repoRoot/`module_refresh`/`build`+repoRoot）是快照校验，不需 live fs。client 调前先推快照：

```bash
curl -X POST http://<host>:<port>/snapshot -H 'content-type: application/json' \
  -d '{"sessionId":"<mcp-session-id>","files":{"src/a.ts":"<base64>"},"gitHead":{"sha":"...","error":null},"gitChangedFiles":{"files":[...],"error":null}}'
```

- server 置 `SessionState.env.bridge = SessionCacheBridge`（catalog 闭包调用时读 `env.bridge`）；`normify_fingerprint` 等经 cache 算，不直读 client fs。
- 与 stdio 路径（LocalBridge 直读本地 fs）向后兼容；无 `env.bridge` 时回退 LocalBridge。

### 4.4 companion split

- server-side：`SessionState.companionCount`（per-session，计 normify_* `behavior!=='read'` 调用）。
- pi-client-side：`createCompanionHandler`（WRITE_TOOLS，计 pi 外部写/edit），在瘦客户端内（不拉 engine）。

### 4.5 验证

- `npm test`：12 套全绿（含 dual-side-http 5 / dual-side-pi-client 6 / dual-side-snapshot 5）。
- parity：`node tests/parity-differential.mjs`（27 PASS，DSH-direct vs MCP-protocol 等价）。
- 两并发 HTTP session companion 互不干扰（`tests/dual-side-http.mjs` A-004）。
- SessionCacheBridge fingerprint == LocalBridge 直算（`tests/dual-side-snapshot.mjs` A-007）。

## 故障排查（SHOULD）

- 工具不见：检查入口路径 + 宿主 env；MCP 需 stdio 握手；pi 需 .ts（非 .js）+ /reload
- 模块解析失败（pi）：确保 repo 已 `npm install`（transitive yaml 经 catalog→engine）；typebox/@earendil-works/pi-ai 由 pi node_modules 或 repo devDeps 解析
- env 未生效：`NORMIFY_ROOT_DIR` 需指向含 normify-* 的目录（DSH 用 DSH Config，非 env 变量）
