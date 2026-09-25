# Dual-Side Mode

- Action: `dual-side-mode`
- Status: `draft`
- Updated: 2026-09-25
- Status authority: [Action Status](../STATUS.md)
- Design source: [Dual-Side Mode 设计 §7–§10](../../SERVER-MODE.md)
- Depends-on: `session-isolation`（必须先 complete——HTTP 多 session 复用其 Session 抽象 + per-user 隔离 + auth）

## Background

`session-isolation` 完成后，normify 已具备统一 Session 抽象（stdio 1 session / http N session 同形状）+ per-user 图隔离（模型 i）+ auth。本 Action 在其上构建 dual-side mode：HTTP transport + pi 瘦客户端 + Bridge + R3 推送，让多 agent（Claude Code/Cursor/Codex/pi）连同一 server 共享单一 catalog/engine 实现。

## Goal

- server 支持 HTTP transport（`NORMIFY_TRANSPORT=http`），多 session 复用 `session-isolation` 的 Session 抽象。
- pi 瘦客户端连 HTTP server，31 工具注册 + call。
- Bridge 抽象 repoRoot 访问（LocalBridge + SessionCacheBridge per-session），server 不主动访问 client fs。
- R3 推送快照协议，证据工具经 SessionCacheBridge 算。

## Non-goals

- 不做 Session 抽象 / per-user 隔离 / auth（已在 `session-isolation`）。
- 不做 RemoteBridge live 回调（future）。
- 不做图合并/publish（模型 i 决断：无合并）。
- 不取代 S0–S6 的三 single-user 适配器（保留）。
- 不发布、不动 SDK 版本。

## Scope

- DP1：Bridge 接口 + LocalBridge + 改 fingerprintOf/gitHead/gitChangedFiles + sync existsSync + ToolEnv.bridge。
- DP2：`src/mcp/server.ts` 加 HTTP transport（`StreamableHTTPServerTransport`，env 选 stdio|http），多 session 复用 SessionManager。
- DP3：`src/pi/normify-client.ts`（MCP client + registerPiTools 桥 + companion handler）。
- DP4：SessionCacheBridge + R3 推送（`normify/pushSnapshot`）。
- DP5：SETUP.md dual-side 节 + auth 配置 + §9 Q8/Q9 回流 + 测试接入。

## Design inputs

- `docs/SERVER-MODE.md` §7（Bridge）/ §8（transport + 客户端）/ §9（R3 推送）/ §10（companion split）/ §11（Q1–Q7）/ §12 DP1–DP5。
- `session-isolation` Action（前置，提供 SessionManager/SessionState/userScope/auth）。
- `src/catalog.ts`（ToolEnv + 5 证据工具 + buildCatalog）。
- `src/engine/store.ts`（fingerprintOf:322 / gitChangedFiles:301 / gitHead:289）。
- `src/mcp/server.ts`（现 stdio + companion，session-isolation 后已 per-session）。
- `src/pi/normify.ts`（in-process 扩展 fallback + 复用 createCompanionHandler）。
- `tests/parity-differential.mjs`（parity 基线）。
- `@modelcontextprotocol/sdk` v1.30.1（`StreamableHTTPServerTransport`/`StreamableHTTPClientTransport`）。

## Requirements

- **R-001 MUST**：Bridge 抽象不破坏现状——LocalBridge 包 fs 后 `tests/parity-differential.mjs` 仍 27 PASS，8 套 npm test 仍绿（DP1）。
- **R-002 MUST**：`NORMIFY_TRANSPORT=http` 起 server，`tools/list` 返 31；`=stdio` 仍工作（dual transport）（DP2）。
- **R-003 MUST**：HTTP 模式下两并发 session 隔离——A 的 companion 计数不影响 B（复用 session-isolation 抽象）；DSH-direct vs HTTP-MCP-client parity 成立（DP2）。
- **R-004 MUST**：pi 瘦客户端连 HTTP server，31 工具注册 + call `normify_help` ok（DP3）。
- **R-005 MUST**：pi 瘦客户端带 companion handler（WRITE_TOOLS，计 pi 外部写），语义同 in-process `src/pi/normify.ts`（DP3）。
- **R-006 MUST**：SessionCacheBridge 算的 fingerprint == LocalBridge 直算（同 source）（DP4）。
- **R-007 SHOULD**：R3 推送走 MCP 自定义 method `normify/pushSnapshot`（单连接）（DP4）。
- **R-008 MUST**：server 不主动访问 client fs；只持 rootDir 图数据 + session 推的快照（DP4/P5）。
- **R-009 MUST**：dual-side 节写入 `docs/MULTIPLATFORM-SETUP.md`；§9 增 Q8/Q9 回流 `docs/MULTIPLATFORM.zh-CN.md`（DP5）。

## Proposed design

见 `docs/SERVER-MODE.md` §7–§10：
- §7 Bridge 接口（RepoBridge）+ 注入 ToolEnv.bridge + 改造面有界（3 engine 函数 + sync existsSync）。
- §8 server HTTP transport（env 选）+ pi 瘦客户端用 MCP SDK `StreamableHTTPClientTransport`。
- §9 R3 推送快照（client 读图 source 列表 → 本地读 → push SessionState.cacheBridge → server 算）。
- §10 companion split（维持 §9 Q5 决断，跨进程不破坏）。

## Implementation plan

- **DP-001**：Bridge 接口 + LocalBridge + 改 fingerprintOf/gitHead/gitChangedFiles 签名 + sync existsSync + ToolEnv.bridge + validate/build 透传。验证 parity 27 PASS + npm test 8 绿。
- **DP-002**：`src/mcp/server.ts` 加 `StreamableHTTPServerTransport`（env 选 stdio|http）；多 session 复用 `session-isolation` 的 SessionManager。parity Path B 改 HTTP client；两并发 session 隔离测试。
- **DP-003**：`src/pi/normify-client.ts`（MCP client + registerPiTools 桥 + createCompanionHandler）。headless 模拟 fake ExtensionAPI + HTTP server。
- **DP-004**：SessionCacheBridge + R3 推送协议（`normify/pushSnapshot` MCP method）。双 bridge fingerprint 一致性。
- **DP-005**：SETUP.md dual-side 节 + auth 配置 + §9 Q8/Q9 回流 + 测试接入 npm test。

## Acceptance

| ID | Requirement | Observable condition | Planned evidence | Status |
| --- | --- | --- | --- | --- |
| A-001 | R-001 | LocalBridge 改造后 `node tests/parity-differential.mjs` 仍 27 PASS | 测试输出 | pending |
| A-002 | R-001 | `npm test` 8 套仍全绿 | npm test exit 0 | pending |
| A-003 | R-002 | `NORMIFY_TRANSPORT=http` 起 server，`tools/list` 返 31；`=stdio` 仍工作 | spawn + NDJSON/HTTP | pending |
| A-004 | R-003 | 两并发 session companion 互不干扰；DSH vs HTTP parity 文件集一致 + .md normalize 逐字节一致 | 隔离测试 + parity HTTP 变体 | pending |
| A-005 | R-004 | pi 瘦客户端连 HTTP server，31 工具 + call ok | headless 模拟日志 | pending |
| A-006 | R-005 | pi 瘦客户端 companion：N 次外部写后 reminder；disabled void | headless 模拟 | pending |
| A-007 | R-006 | SessionCacheBridge 算 == LocalBridge 直算 | 双 bridge 对比 | pending |
| A-008 | R-008 | server 代码 grep 无主动 client fs 访问（跨 session 缓存外） | 代码审查 | pending |
| A-009 | R-009 | SETUP.md 含 dual-side 节；§9 含 Q8/Q9 | grep | pending |

## Validation

记录计划命令（与实际执行分离）：

- DP1：`node tests/parity-differential.mjs`（27 PASS）+ `npm test`（8 绿）+ `node ci-contract-check.cjs`。
- DP2：`NORMIFY_TRANSPORT=http node lib/mcp/server.js` + HTTP client `tools/list`/`tools/call`；两并发 session 隔离；parity HTTP 变体。
- DP3：headless 模拟（fake `ExtensionAPI` + HTTP server）。
- DP4：双 bridge fingerprint 对比；端到端 pi client → server → SessionCacheBridge。
- DP5：`grep dual-side docs/MULTIPLATFORM-SETUP.md`；`grep "Q8\|Q9" docs/MULTIPLATFORM.zh-CN.md`。

## Readiness gaps

- **依赖 `session-isolation` complete**——本 Action 不能在 session-isolation 之前 ready/execute。
- R3 推送协议形状（§9 / §14）：HTTP endpoint vs MCP method——倾向 MCP method，DP4 review 定。
- SessionCacheBridge 缓存粒度/失效——DP4 设计。
- pi 瘦客户端 MCP SDK 依赖解析（pi 加载 .ts）——DP3 验证。
- 设计文档已写（§7–§10），未经 review；Readiness review 需核验：依赖声明、Bridge 注入面、transport 选择、R3 协议、companion split 是否完整。

## Closure conditions

- 全部 MUST 验收（A-001~A-009）passed；R-007 SHOULD 满足或显式豁免。
- parity（LocalBridge + HTTP 变体）全绿；8 套 npm test 不破坏；ci-contract 绿。
- 两并发 session 隔离验证通过（复用 session-isolation 抽象）。
- 持久结论回流：SETUP.md dual-side 节 + §9 Q8/Q9。
- 状态、路径、导航、归档一致。
