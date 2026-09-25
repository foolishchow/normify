# Session Isolation

- Action: `session-isolation`
- Status: `ready`
- Updated: 2026-09-25
- Status authority: [Action Status](../STATUS.md)
- Design source: [Dual-Side Mode 设计 §3–§6](../../SERVER-MODE.md)
- Blocks: `dual-side-mode`（dual-side 的 HTTP 多 session 复用本 Action 的 Session 抽象）

## Background

现 `src/mcp/server.ts` 的 `companionConfig`/`companionCount` 是**模块作用域**（L24-25，所有连接共享）。stdio 单用户没事；一旦上 HTTP 多用户，companion 计数器跨用户累加 + reminder 跨用户泄漏。

dual-side mode（多 agent 连同一 server）的前置地基：先把"会话/用户/项目"三维隔离抽象出来，在 stdio 单 session 下验证抽象成立，HTTP 多 session 在 `dual-side-mode` 自然复用。

## Goal

- 统一 Session 抽象（`SessionManager` + `SessionState`），stdio 1 session / http N session 同形状。
- per-user 图隔离（模型 i：每用户一棵完全独立图，无合并，无共享 main）。
- 修 companion 模块作用域 bug → per-session。
- auth 脚手架（token → userId + project allowlist）。
- 向后兼容：无 token = default user = 路径不变，27 PASS + 8 套 npm test 全绿。

## Non-goals

- 不做 HTTP transport（在 `dual-side-mode` DP2）。
- 不做 Bridge / SessionCacheBridge（在 `dual-side-mode` DP1/DP4）。
- 不做 pi 瘦客户端（在 `dual-side-mode` DP3）。
- 不做图合并/publish 工具（模型 i 决断：无合并）。
- 不发布、不动 SDK 版本。

## Scope

- 新增 `src/session.ts`（或 `src/mcp/session.ts`）：`SessionManager` + `SessionState` + `Map<sessionId, SessionState>`。
- 改 `src/catalog.ts`：`ToolEnv` 加 `userScope?: string`；`resolveProject` 加 userScope 维度；per-session buildCatalog（env 带 userScope）。
- 改 `src/mcp/server.ts`：模块作用域 companion → `SessionManager` per-session；stdio synthesize 1 sessionId。
- 改 `src/engine/store.ts`：`resolveProject` 签名加 userScope（路径 `<rootDir>/[<userScope>/]normify-<slug>/`）；`listProjects(rootDir, userScope?)` 同加 userScope（读 `<rootDir>/[<userScope>/]normify-*`，不泄漏其他用户项目）。
- 新增路径 arg 逃逸防护（auth 开启时）：工具 args `root`（tree_list）/`dir`（resolveProject）经 resolve 后校验落在 `rootDir/<userScope>/` 内，越界拒绝（`session/path-escape`）。
- 新增 auth 脚手架：token → `{userId, projectAllowlist}` 解析（无 token = default user + 全可见）。

## Design inputs

- `docs/SERVER-MODE.md` §3（Session 抽象）/ §4（per-user 隔离模型 i）/ §5（项目隔离 + auth）/ §6（本 Action 范围）/ §11（Q8/Q9 决断）。
- `src/mcp/server.ts` L15,19,24-25,57,74-78（现模块作用域 env/catalog/companionConfig/companionCount + handler）。
- `src/catalog.ts`（ToolEnv:23 + buildCatalog:566 + resolve 闭包）。
- `src/engine/store.ts`（resolveProject:27 + listProjects:68）。
- `tests/parity-differential.mjs`（27 PASS，向后兼容基线）。
- S0–S6 的 8 套 npm test（向后兼容基线）。

## Requirements

- **R-001 MUST**：`SessionManager` + `SessionState`（sessionId/userId/companionCount/companionConfig/catalog/cacheBridge?）+ `Map<sessionId, SessionState>` 抽象成立；stdio synthesize 1 固定 sessionId。
- **R-002 MUST**：companion 状态从模块作用域 → per-session（`SessionState.companionCount`）；stdio 1 session 下 companion 触发行为零变。
- **R-003 MUST**：`ToolEnv.userScope?: string` + 全 rootDir 路径维度隔离：
  - `resolveProject(rootDir, args, opts, userScope)`：userScope undefined → `rootDir/normify-<slug>/`（路径不变）；userScope="alice" → `rootDir/alice/normify-<slug>/`。
  - `listProjects(rootDir, userScope?)`：userScope undefined → `rootDir/normify-*`（向后兼容）；userScope="alice" → `rootDir/alice/normify-*`（不泄漏其他用户项目，堵 F-001）。
  - **路径 arg 逃逸防护**（userScope 给定即 auth 开）：工具 args `root`（tree_list）/`dir`（resolveProject）经 resolve 后必须落在 `rootDir/<userScope>/` 内；绝对路径或 `..` 遍历越界 → 拒绝（error `session/path-escape`）。userScope undefined（无 auth）时 args 不限（向后兼容，堵 F-002）。
- **R-004 MUST**：per-session buildCatalog（env 带 userScope，catalog 廉价重建）；不同 userScope 的 catalog 解析到不同图路径。
- **R-005 MUST**：auth 脚手架——token → `{userId, projectAllowlist}`；无 token = default user（userId=undefined）+ 全项目可见；有 token = 路径加 userScope + allowlist 校验。
- **R-006 MUST**：向后兼容——无 token（stdio 默认）路径 `rootDir/normify-<slug>/` 不变；`tests/parity-differential.mjs` 仍 27 PASS；8 套 npm test 全绿；ci-contract 绿。
- **R-007 SHOULD**：`SessionManager` 提供 session 过期/清理钩子（TTL 或 onclose），不留无主 SessionState 累积。

## Proposed design

见 `docs/SERVER-MODE.md` §3–§6：

- §3 统一 Session 抽象：`SessionState` 形状 + `SessionManager` + stdio/http 同 API。
- §4 per-user 图隔离（模型 i）：路径 `rootDir/[<userId>/]normify-<slug>/`；`ToolEnv.userScope`；per-session catalog。
- §5 项目隔离（slug）+ auth（token → userId + allowlist，无 token=default+全可见）。
- §6 本 Action 仅 stdio（1 session 验证抽象）。

## Implementation plan

- **SP-001**：`src/session.ts`——`SessionManager` + `SessionState` + `Map`；stdio synthesize 1 sessionId；server.ts 模块作用域 env/catalog/companion 改经 SessionManager 取。
- **SP-002**：`ToolEnv.userScope` + `resolveProject`/`listProjects` userScope 维度 + per-session buildCatalog + 路径 arg 逃逸防护（resolve 后校验落 userScope 内）；验证无 userScope 路径不变（parity 27 PASS）。
- **SP-003**：companion 模块作用域 → `SessionState.companionCount`；handler 经 SessionManager 取 session 计数；stdio companion 行为零变。
- **SP-004**：auth 脚手架——token 解析（`{userId, projectAllowlist}`）+ 注入 SessionState.userId；无 token=default；有 token 路径加 userScope + allowlist 校验。

## Acceptance

| ID | Requirement | Observable condition | Planned evidence | Status |
| --- | --- | --- | --- | --- |
| A-001 | R-001 | `SessionManager.get(sessionId)` 返 SessionState；stdio 启动后存在 1 session | 代码 + 启动日志 | pending |
| A-002 | R-002 | companion 计数从 SessionState 取（非模块作用域）；stdio 1 session 触发行为与改前一致 | companion-snapshot + 行为对比 | pending |
| A-003 | R-003 | `resolveProject` userScope：undefined → `rootDir/normify-<slug>/`；"x" → `rootDir/x/normify-<slug>/` | 路径单测 | pending |
| A-003b | R-003 | `listProjects` userScope：undefined → `rootDir/normify-*`；"x" → `rootDir/x/normify-*`（不含其他用户项目） | 路径单测 | pending |
| A-003c | R-003 | 路径 arg 逃逸防护：userScope 给定时 `dir=/etc/passwd`/`dir=../bob/...` 拒绝；`dir=normify-x`（相对、scope 内）ok；userScope undefined 时 args 不限 | 逃逸单测 | pending |
| A-004 | R-004 | 两个 userScope 不同的 catalog 各自解析到不同图路径（互不可见） | 双 session 路径断言 | pending |
| A-005 | R-005 | 无 token=default+全可见；有 token=userScope+allowlist 校验（越权 project 被拒） | auth 单测 | pending |
| A-006 | R-006 | `node tests/parity-differential.mjs` 27 PASS；`npm test` 8 套绿；`node ci-contract-check.cjs` 绿 | 测试输出 | pending |
| A-007 | R-007 | session 过期/清理钩子存在（TTL 或 onclose） | 代码审查 | pending |

## Validation

记录计划命令（与实际执行分离）：

- SP1：`node lib/mcp/server.js`（stdio）+ NDJSON initialize/tools-list/tools-call 仍工作。
- SP2：`node tests/parity-differential.mjs`（27 PASS，路径不变）+ 路径单测（userScope undefined vs "x"）。
- SP3：`node tests/companion-snapshot.mjs`（3 PASS）+ companion 触发行为对比。
- SP4：auth 单测（token 解析 + allowlist 校验 + 无 token default）。
- 全程：`npm test`（8 套）+ `node ci-contract-check.cjs`。

## Readiness gaps

无（ready 授权后）。Readiness review 4 轮：
- R1 抓 F-001（`listProjects` 跨用户项目列表泄漏）+ F-002（`root`/`dir` 绝对路径/`..` 遍历逃逸 userScope）两 medium+ambiguous finding → escalate → user 授权选项 (a) → 修 R-003 覆盖全 rootDir 扫描 + 路径 arg 逃逸防护（`session/path-escape`）。
- R2/R3/R4 三轮 clean（0 critical/high/medium）→ K=3 收敛 → `pass`。
- auth config 格式 + enforcement 点（SP4 细节）、`src/session.ts` 位置（SP1 定）、SessionManager 生命周期（R-007 SHOULD）为 execute 阶段细节，非 readiness blocker。

## Closure conditions

- 全部 MUST 验收（A-001~A-006）passed，SHOULD（A-007 session 清理）满足或显式豁免。
- 27 PASS + 8 套 npm test + ci-contract 全绿（向后兼容硬约束）。
- 持久结论回流：`docs/SERVER-MODE.md` 标 session-isolation 阶段完成 + §11 Q8/Q9 已决断。
- 状态、路径、导航、归档一致。
- `dual-side-mode` 的阻塞解除（HTTP 多 session 可复用本抽象）。
