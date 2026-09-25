# Setup Guide

- Action: `setup-guide`
- Status: `complete`
- Updated: 2026-09-25
- Status authority: [Action 状态](../../../STATUS.md)
- Design source: [多平台适配设计 §4 / §7-S4](../../../../MULTIPLATFORM.zh-CN.md)

## 背景

S0–S3 已交付 3 个适配器入口（DSH `lib/index.js` / MCP `lib/mcp/server.js` / pi `src/pi/normify.ts`）+ 平台无关 catalog。§4 已声明 SKILL.md 复用策略（正文不改，靠各宿主 skills 目录放置），但缺一份**面向用户的整合安装指南**——当前安装信息散落在 §3.1（MCP）、§3.2（pi）、§4（SKILL.md 放置表）、README。新用户需翻多处才能跑通某个宿主。

## 目标

新增 `docs/MULTIPLATFORM-SETUP.md`：一份整合安装指南，按宿主分节（DSH / MCP / pi），每节含入口路径、启动命令、env 变量、SKILL.md 放置、验证方法。**§9 Q4 回流 + §3.2 stale 修复**：MULTIPLATFORM.zh-CN.md L277 标 Q4 resolved（S3 实施投影函数）+ L145 修 stale `pi.cwd 作为 rootDir`→env var（S3 回流漏此行）。

## 非目标

- 不改 `skills/normify-gen/SKILL.md` 正文（§4 不变量：工具名稳定是可复用前提）。
- 不改任何 `src/` / `lib/` / `tests/` / `package.json`（S4 纯文档，零代码）。
- 不改 `ci-contract-check.cjs`。
- Cursor 自动化（§4："仅 MCP 接入，SKILL.md 手动粘进 .cursor/rules，本次不做自动化"）——SETUP.md 记手动步骤即可。
- companion 钩子迁移 → S5；CI 扩展 → S6。

## 设计输入与依赖

- **§4 放置表**（MULTIPLATFORM.zh-CN.md L181-184）：
  - Claude Code：`~/.claude/skills/normify-gen/SKILL.md`（或项目 `.claude/skills/`）
  - Codex：`~/.codex/skills/normify-gen/SKILL.md`
  - Cursor：无统一 skill 机制；仅 MCP 接入，SKILL.md 手动粘 `.cursor/rules/normify.mdc`
  - pi：`~/.pi/agent/skills/normify-gen/`，或 settings `"skills": ["<repo>/skills"]`
- **§3.1 MCP**（S1/S2 产物）：入口 `lib/mcp/server.js`（源 `src/mcp/server.ts`）；stdio JSON-RPC；env `NORMIFY_ROOT_DIR` / `NORMIFY_REQUIRE_BILINGUAL`。
- **§3.2 pi**（S3 产物）：入口 `src/pi/normify.ts`（pi 自动发现 `.ts` glob）；软链到 `~/.pi/agent/extensions/normify.ts`；env 同上。
- **DSH**（原有）：`lib/index.js` 为 DSH 插件入口；peerDeps cordis/dsh-tools/dsh-skill；companion 钩子在 `src/index.ts`（S5 迁移）。
- **SKILL.md 引用 29 工具名**（grep `skills/normify-gen/SKILL.md`）；catalog 31 工具——29 ⊆ 31（SKILL.md 引用的工具全在 catalog，可复用前提成立）。
- **§9 Q4**（L277）："JSON Schema → typebox 投影"——S3 已选择手写投影函数（`schemaToTypebox`/`objectSchemaToTypebox`）并实施验证（9 验收全过）。S4 回流标 resolved。

## 范围与边界

- 新增：`docs/MULTIPLATFORM-SETUP.md`（整合安装指南）。
- 修改：`docs/MULTIPLATFORM.zh-CN.md`（§9 Q4 L277 标 resolved + §3.2 L145 修 stale `pi.cwd 作为 rootDir`→env var（S3 F-006 证 ExtensionAPI 无 cwd；S3 回流漏此行））
- 不改：`skills/normify-gen/SKILL.md`（git diff 必空）、`src/`、`lib/`、`tests/`、`package.json`、`ci-contract-check.cjs`。
- 无构建工件（纯文档）。

## 需求

- R-001 MUST：新增 `docs/MULTIPLATFORM-SETUP.md`，按宿主分节（DSH / MCP / pi），每节含：入口路径、启动/接入命令、env 变量（`NORMIFY_ROOT_DIR` 默认 cwd / `NORMIFY_REQUIRE_BILINGUAL` 默认 '1'→true）、SKILL.md 放置、验证方法（`normify_help topic=tools` 应见 31 工具）。
- R-002 MUST：SETUP.md 的工具名 / 入口路径 / env 变量与 S0–S3 交付物一致（`lib/index.js` / `lib/mcp/server.js` / `src/pi/normify.ts`；`NORMIFY_ROOT_DIR` / `NORMIFY_REQUIRE_BILINGUAL`）。
- R-003 MUST：`skills/normify-gen/SKILL.md` 不被改动——`git diff --exit-code HEAD -- skills/normify-gen/SKILL.md` 退出 0（捕获 staged + unstaged）。
- R-004 MUST：SKILL.md 引用的工具名 ⊆ catalog——`grep -oE 'normify_[a-z_]+' skills/normify-gen/SKILL.md | sort -u` 的每个名字均在 `buildCatalog()` 产出中（29 ⊆ 31）。
- R-005 MUST：§9 Q4 回流——`docs/MULTIPLATFORM.zh-CN.md` §9 第 4 条改为：`4. **JSON Schema → typebox 投影** ✅ 已决断（S3 实施）：手写投影函数 schemaToTypebox/objectSchemaToTypebox（catalog 单一事实源，避免双份定义漂移；9 验收全过，见 `docs/actions/_archive/complete/pi-extension/README.md`）。`
- R-006 SHOULD：SETUP.md 含"故障排查"小节（模块解析失败 / 工具不见 / env 未生效的常见原因）。

## 提议设计

### `docs/MULTIPLATFORM-SETUP.md` 结构

```markdown
# Normify 多平台安装指南

## 概览
normify 提供 3 个适配器入口（共享同一 catalog，31 个工具零逻辑重复）+ 1 个可复用技能（SKILL.md 正文不改）：
- DSH（DeepSeek Harness）插件：`lib/index.js`
- MCP stdio server（Claude Code / Codex / Cursor）：`lib/mcp/server.js`
- pi 扩展（@earendil-works/pi-coding-agent）：`src/pi/normify.ts`

**前置（所有宿主）**：Node.js ≥18（`package.json` engines）；各宿主另需 `npm install`（见各节——DSH 装 dependencies+peerDeps，MCP 装 dependencies，pi 装以提供 transitive yaml）。

## 环境变量（MCP / pi；DSH 用 DSH Config）
| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `NORMIFY_ROOT_DIR` | `process.cwd()` | normify 结构数据项目根（含 normify-* 目录） |
| `NORMIFY_REQUIRE_BILINGUAL` | `1`（true） | 是否强制 zh/en 双语描述；`0`=关 |

> **DSH** 的 `rootDir`/`requireBilingual` 经 DSH Config（schemastery，`Config = z.object({rootDir, requireBilingual, ...})`）配置，**非环境变量**。MCP/pi 用上表 env 变量。

## 1. DSH（DeepSeek Harness）
- 入口：`lib/index.js`（DSH 插件，peerDeps: @deepseek-ai/cordis / @deepseek-ai/dsh-tools / @deepseek-ai/dsh-skill）
- 安装：`npm install`（DSH 仅用 `yaml`（transitive via engine）；`@modelcontextprotocol/sdk` 供 MCP server，DSH 不用但 npm install 仍装；peerDeps 由 DSH 宿主提供，dsh-tools/dsh-skill 为 optional）
- SKILL.md：插件 `registerSkill` 自动注册（`lib/index.js` 读 `skills/normify-gen/SKILL.md`，经 `ctx.skills.register`；无需手动放置）
- 配置：`rootDir`/`requireBilingual` 经 DSH Config（schemastery）配置（非 env 变量）
- 验证：在 DSH 会话内调 `normify_help topic=tools` → 31 工具

## 2. MCP（Claude Code / Codex / Cursor）
- 入口：`lib/mcp/server.js`（stdio JSON-RPC 2.0 MCP server；协议版本由 SDK 在 initialize 握手时协商）
- 前置：`npm install`（server 运行时需 dependencies: yaml + @modelcontextprotocol/sdk）
- 配置（写入各宿主配置文件）：
  - Claude Code：`.mcp.json` 或 `~/.claude.json`
  - Codex：`~/.codex/config.toml` `[mcp_servers.normify]`
  - Cursor：`.cursor/mcp.json`（或全局）
  - 形状（JSON，Claude Code/Cursor）：`{ "mcpServers": { "normify": { "command": "node", "args": ["<repo>/lib/mcp/server.js"], "env": { "NORMIFY_ROOT_DIR": "<project>", "NORMIFY_REQUIRE_BILINGUAL": "1" } } } }`；Codex 用 TOML `[mcp_servers.normify]` + `command`/`args`/`env` 键
- env：宿主配置 env 传入 `NORMIFY_ROOT_DIR` / `NORMIFY_REQUIRE_BILINGUAL`
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
- env 未生效：`NORMIFY_ROOT_DIR` 需指向含 normify-* 的目录
```

## 实施计划

- P-001：写 `docs/MULTIPLATFORM-SETUP.md`（按上文结构，填充各宿主节）。
- P-002：§9 Q4 回流——`docs/MULTIPLATFORM.zh-CN.md` L277 改为 `✅ 已决断（S3 实施）：手写投影函数 schemaToTypebox/objectSchemaToTypebox（catalog 单一事实源；9 验收全过）`。同时修 §3.2 L145 stale `pi.cwd 作为 rootDir`→`rootDir 从 process.env.NORMIFY_ROOT_DIR ?? process.cwd() 读（ExtensionAPI 无 cwd，S3 F-006）；requireBilingual 从 `(process.env.NORMIFY_REQUIRE_BILINGUAL ?? '1') !== '0'` 读（默认 true，与 MCP §3.1 同）`
- P-003：跑 validation（见 Validation 节）；记录证据。
- P-004：不提交直到授权。

## 验收

| ID | Requirement | 可观察条件 | 计划证据 | Status |
| --- | --- | --- | --- | --- |
| A-001 | R-001 | SETUP.md 存在 + 3 宿主节（DSH/MCP/pi）+ 每节含入口/env/SKILL.md/验证 + Node 前置 | `test -f docs/MULTIPLATFORM-SETUP.md` + grep 各节标题 + grep `NORMIFY_ROOT_DIR`/`normify_help topic=tools` + grep `Node.js ≥18` | pass |
| A-002 | R-002 | SETUP.md 路径/env 与 S0–S3 一致 | grep `lib/index.js`/`lib/mcp/server.js`/`src/pi/normify.ts`/`NORMIFY_REQUIRE_BILINGUAL` 命中 | pass |
| A-003 | R-003 | SKILL.md 未改动 | `git diff --exit-code HEAD -- skills/normify-gen/SKILL.md` 退出 0 | pass |
| A-004 | R-004 | SKILL.md 工具名 ⊆ catalog | 脚本：SKILL.md 29 工具名全在 `buildCatalog()` 31 中 | pass |
| A-005 | R-005 | §9 Q4 标 resolved + §3.2 L145 stale 修复 | `grep "✅ 已决断\|✅ resolved" docs/MULTIPLATFORM.zh-CN.md` 命中第 4 条 且 `grep -c 'pi.cwd 作为 rootDir' docs/MULTIPLATFORM.zh-CN.md` =0 | pass |
| A-006 | R-006 | 故障排查节（SHOULD） | grep `故障排查` docs/MULTIPLATFORM-SETUP.md 命中 | pass |

## Validation

计划命令（实际结果待执行）：

```bash
# A-001 SETUP.md 存在 + 结构
test -f docs/MULTIPLATFORM-SETUP.md
grep -cE '^## (1\. DSH|2\. MCP|3\. pi|环境变量|概览|故障排查)' docs/MULTIPLATFORM-SETUP.md   # ≥6
grep -c 'NORMIFY_ROOT_DIR' docs/MULTIPLATFORM-SETUP.md                                        # ≥1
grep -c 'normify_help topic=tools' docs/MULTIPLATFORM-SETUP.md                                # ≥3（三宿主验证）
grep -c 'Node.js ≥18' docs/MULTIPLATFORM-SETUP.md                                         # ≥1（前置）

# A-002 路径/env 一致
grep 'lib/index.js' docs/MULTIPLATFORM-SETUP.md
grep 'lib/mcp/server.js' docs/MULTIPLATFORM-SETUP.md
grep 'src/pi/normify.ts' docs/MULTIPLATFORM-SETUP.md
grep 'NORMIFY_REQUIRE_BILINGUAL' docs/MULTIPLATFORM-SETUP.md

# A-003 SKILL.md 未改动
git diff --exit-code HEAD -- skills/normify-gen/SKILL.md   # EXIT 0（staged+unstaged）

# A-004 SKILL.md 工具名 ⊆ catalog（脚本）
node --input-type=module -e "
import { buildCatalog } from './lib/catalog.js';
const cat = new Set(buildCatalog({rootDir:'.',requireBilingual:true}).map(e=>e.name));
import { readFileSync } from 'node:fs';
const skill = readFileSync('skills/normify-gen/SKILL.md','utf8');
const refs = new Set([...skill.matchAll(/normify_[a-z_]+/g)].map(m=>m[0]));
const missing = [...refs].filter(n=>!cat.has(n));
console.log('SKILL refs:',refs.size,'catalog:',cat.size,'missing:',missing.length);
process.exit(missing.length?1:0);
"

# A-005 §9 Q4 resolved + §3.2 L145 stale fix
grep -c '✅' docs/MULTIPLATFORM.zh-CN.md   # §9 Q4 行
grep -c 'pi.cwd 作为 rootDir' docs/MULTIPLATFORM.zh-CN.md   # =0（L145 已修）

# A-006 故障排查节（SHOULD）
grep -c '故障排查' docs/MULTIPLATFORM-SETUP.md   # ≥1

# 零代码回归（S4 纯文档）
git diff --stat src/ lib/ tests/ package.json ci-contract-check.cjs   # 空
```

**实际执行结果（2026-09-25，feat/catalog 分支）**：

```text
# A-001 SETUP.md 存在 + 结构
$ test -f docs/MULTIPLATFORM-SETUP.md          # OK
$ grep -cE '^## (1\. DSH|2\. MCP|3\. pi|环境变量|概览|故障排查)' docs/MULTIPLATFORM-SETUP.md   # 6
$ grep -c 'NORMIFY_ROOT_DIR' docs/MULTIPLATFORM-SETUP.md        # 5
$ grep -c 'normify_help topic=tools' docs/MULTIPLATFORM-SETUP.md # 3
$ grep -c 'Node.js ≥18' docs/MULTIPLATFORM-SETUP.md             # 1

# A-002 路径/env 一致
$ grep -c 'lib/index.js' docs/MULTIPLATFORM-SETUP.md            # 3
$ grep -c 'lib/mcp/server.js' docs/MULTIPLATFORM-SETUP.md       # 3
$ grep -c 'src/pi/normify.ts' docs/MULTIPLATFORM-SETUP.md        # 4
$ grep -c 'NORMIFY_REQUIRE_BILINGUAL' docs/MULTIPLATFORM-SETUP.md # 4

# A-003 SKILL.md 未改动
$ git diff --exit-code HEAD -- skills/normify-gen/SKILL.md      # EXIT 0

# A-004 SKILL.md 工具名 ⊆ catalog
$ node --input-type=module -e "..."   # SKILL refs: 29, catalog: 31, missing: 0, EXIT 0

# A-005 §9 Q4 resolved + §3.2 L145 stale fixed
$ grep -c '✅' docs/MULTIPLATFORM.zh-CN.md                      # 5（含 Q4）
$ grep -c 'pi.cwd 作为 rootDir' docs/MULTIPLATFORM.zh-CN.md     # 0（L145 已修）

# A-006 故障排查节（SHOULD）
$ grep -c '故障排查' docs/MULTIPLATFORM-SETUP.md                 # 1

# 零代码回归（S4 纯文档）
$ git diff --stat src/ lib/ tests/ package.json ci-contract-check.cjs   # 空
```

S4 纯文档，零代码改动。6 验收全过（A-001~A-005 MUST + A-006 SHOULD）。

## Readiness gaps

- 无开放 gap。S4 纯文档，依赖 S0–S3 已交付的入口路径 / env / SKILL.md（均已稳定）。§9 Q4 决断由 S3 作出（投影函数已实施），S4 仅回流标记。

## Closure conditions

- 全部 MUST 验收（A-001~A-005）通过并记录证据。
- A-006（SHOULD）通过。
- §9 Q4 回流已执行 ✅：MULTIPLATFORM.zh-CN.md §9 第 4 条（L277）标 ✅ resolved（S3 实施投影函数）；§3.2 L145 stale `pi.cwd 作为 rootDir`→env var 已修。
- `skills/normify-gen/SKILL.md` git diff 空（§4 不变量）。
- 零代码改动（src/lib/tests/package.json 不变）。
- 状态、路径、导航一致；归档前 STATUS.md 更新为 `complete`。
- **提交完整性**：实施 commit 含 `docs/MULTIPLATFORM-SETUP.md`（新增）+ `docs/MULTIPLATFORM.zh-CN.md`（§9 Q4 回流 L277 + §3.2 L145 stale pi.cwd→env var 修复）；无 lib/src/tests/package 改动。
- **失败回退**：单 commit 原子；任一验收不过即 `git revert`。
