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

> **DSH** 的 `rootDir`/`requireBilingual` 经 DSH Config（schemastery，`Config = z.object({rootDir, requireBilingual, ...})`）配置，**非环境变量**。MCP/pi 用上表 env 变量。

## 1. DSH（DeepSeek Harness）

- 入口：`lib/index.js`（DSH 插件，peerDeps: @deepseek-ai/cordis / @deepseek-ai/dsh-tools / @deepseek-ai/dsh-skill）
- 安装：`npm install`（DSH 仅用 `yaml`（transitive via engine）；`@modelcontextprotocol/sdk` 供 MCP server，DSH 不用但 npm install 仍装；peerDeps 由 DSH 宿主提供，dsh-tools/dsh-skill 为 optional）
- 配置：`rootDir`/`requireBilingual` 经 DSH Config（schemastery）配置（非 env 变量）
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
- env：宿主配置 env 传入 `NORMIFY_ROOT_DIR` / `NORMIFY_REQUIRE_BILINGUAL`（见形状 `env` 键）
- SKILL.md 放置：
  - Claude Code：`~/.claude/skills/normify-gen/SKILL.md`（或 `.claude/skills/`）
  - Codex：`~/.codex/skills/normify-gen/SKILL.md`
  - Cursor：手动粘 SKILL.md 正文到 `.cursor/rules/normify.mdc`（无统一 skill 机制）
- 验证：宿主内调 `normify_help topic=tools` → 31 工具

## 3. pi（@earendil-works/pi-coding-agent）

- 入口：`src/pi/normify.ts`（pi 自动发现 .ts glob，非 .js）
- 前置：`npm install`（pi 加载 src/pi/normify.ts → catalog → engine/policy+frontmatter → `yaml`，需 repo node_modules 提供；typebox/pi-ai 由 repo devDeps 或 pi node_modules 解析）
- 安装：软链 `src/pi/normify.ts` → `~/.pi/agent/extensions/normify.ts`（或 `pi -e ./src/pi/normify.ts`）
- env：启动 pi 前在 shell 导出（`export NORMIFY_ROOT_DIR=<project>`；`export NORMIFY_REQUIRE_BILINGUAL=1`），或经 pi settings 配置
- SKILL.md：`~/.pi/agent/skills/normify-gen/`，或 settings `"skills": ["<repo>/skills"]`
- 验证：pi 会话 `/reload` 后调 `normify_help topic=tools` → 31 工具

## 故障排查（SHOULD）

- 工具不见：检查入口路径 + 宿主 env；MCP 需 stdio 握手；pi 需 .ts（非 .js）+ /reload
- 模块解析失败（pi）：确保 repo 已 `npm install`（transitive yaml 经 catalog→engine）；typebox/@earendil-works/pi-ai 由 pi node_modules 或 repo devDeps 解析
- env 未生效：`NORMIFY_ROOT_DIR` 需指向含 normify-* 的目录（DSH 用 DSH Config，非 env 变量）
