# Dual-Side Mode 设计

> 状态：草案（2026-09-25 v2，拆分为两 Action）。
> 前置 Action：`session-isolation`（地基，本文 §3–§6）。
> 主 Action：`dual-side-mode`（本文 §7–§10，depends-on `session-isolation`）。
> 上游设计：`docs/MULTIPLATFORM.zh-CN.md`（S0–S6 多平台迁移已完成）。

## 1. 背景与目标

S0–S6 把 normify 拆成"平台无关 catalog + 三适配器"（DSH stdio / MCP stdio / pi in-process），但每用户本地都装一份 catalog/engine/yaml——代码实现不共享。

**Dual-side mode 目标**：normify 做成 server-side 长驻服务，多 agent（Claude Code / Cursor / Codex / pi）作客户端连它；catalog/engine/companion 代码只活一处（服务器），客户端瘦。

"dual-side"：server-side 跑逻辑 + client-side 提供数据（经 Bridge 抽象按需供给）。

## 2. 核心约束（已查清）

### 2.1 rootDir（base）≠ repoRoot（用户源码）

| | rootDir | repoRoot |
| --- | --- | --- |
| 是什么 | normify 图数据 BASE 根 | 用户源码仓库根 |
| 归属 | normify | 用户 |
| dual-side | server 侧（base + user + project 三维定位图） | client 侧（本地 fs），经 Bridge 虚拟化 |

### 2.2 normify 默认不读用户源码

25+ 图编辑工具只读写图数据（`rootDir/.../normify-<slug>/`）。模块 `source` 字段仅存路径字符串。5 个证据工具（fingerprint/sync/validate+repoRoot/module_refresh/build+repoRoot）给定 repoRoot 才读用户源码（经 Bridge）。

### 2.3 pi 原生 MCP（0.99.2+，已解）

pi 0.99.2+ 原生支持 MCP（stdio + streamable HTTP，`mcp.json` 配置，同 Claude Code/Cursor）。原“pi 无内置 MCP client”前提（需 thin 扩展桥接）已过时；`src/pi/normify-client.ts` 裁为 companion-only 扩展（仅计外部写，工具连经由 pi 原生 MCP）。详见 SETUP.md §3b/§4.2。

## 3. 统一 Session 抽象（前置 Action 核心，§session-isolation）

**问题**：现 `src/mcp/server.ts` L24-25 的 `companionConfig`/`companionCount` 是**模块作用域**（所有连接共享）。stdio 单用户没事；HTTP 多用户时计数器跨用户累加 + reminder 跨用户泄漏。

**统一抽象**：两种 transport 都经同一 `SessionManager` / `Map<sessionId, SessionState>`：

```ts
interface SessionState {
  sessionId: string;
  userId: string | undefined;        // from token; undefined = default user（向后兼容）
  companionCount: number;
  companionConfig: CompanionConfig;
  catalog: ToolEntry[];              // per-session buildCatalog(env with userScope)
  cacheBridge?: RepoBridge;         // dual-side-mode P4 per-session
}
```

- **stdio**：synthesize 1 个固定 sessionId（MCP stdio 协议无 session-id；单连接）。`SessionManager` 持 1 个 SessionState。
- **http**：用 `StreamableHTTPServerTransport` 的 `sessionId`（`sessionIdGenerator: randomUUID`）。每连接 1 个 SessionState。
- 同一 `SessionState` 形状、同一 `SessionManager` API——transport 无关。companion bug 在 stdio（1 session）就能验证修好；HTTP 多 session 在 dual-side-mode 自然复用。

## 4. per-user 图隔离（模型 i：完全独立，§session-isolation）

**决断（Q8）**：每用户一棵**完全独立**的图，互不可见，**无合并机制、无共享 main**。各用户维护自己的图副本。

### 4.1 路径模型

```
无 auth（stdio 默认 / 向后兼容）:
  rootDir/normify-<slug>/                      ← S0–S6 测试期望的路径（不变）

有 auth（token → userId）:
  rootDir/<userId>/normify-<slug>/             ← per-user 隔离
```

### 4.2 实现

- `ToolEnv` 加 `userScope?: string`（undefined = default user）。
- `resolveProject(rootDir, args, opts, userScope)`：
  - userScope undefined → `rootDir/normify-<slug>/`（或 `rootDir/<dir>` 若 args.dir 给）——**路径不变，向后兼容**。
  - userScope = "alice" → `rootDir/alice/normify-<slug>/`。
- `listProjects(rootDir, userScope?)`：userScope 给定读 `rootDir/<userScope>/normify-*`（不泄漏其他用户项目）；undefined 读 `rootDir/normify-*`（向后兼容）。
- `buildCatalog(env)` 的 `resolve` 闭包捕获 `env.userScope`；每 session 用自己的 userScope 重建 catalog（catalog 构建廉价，N session × catalog 可接受）。
- userScope 来源：SessionState.userId（token 解析）；default session（无 token）= undefined。
- **路径 arg 逃逸防护**（userScope 给定即 auth 开）：工具 args `root`（tree_list）/`dir`（resolveProject）经 resolve 后校验落在 `rootDir/<userScope>/` 内；绝对路径或 `..` 遍历越界 → 拒绝（`session/path-escape`）。堵 F-002。userScope undefined（无 auth）时 args 不限（向后兼容）。

### 4.3 向后兼容（硬约束）

S0–S6 的 27 PASS（parity）+ 8 套 npm test + companion-snapshot 全用 `rootDir/normify-<slug>/`（无 user 维度）。引入 userScope 后，**无 token = default user = undefined → 路径不变**。`session-isolation` 必须保持全绿。

## 5. 项目隔离 + auth（§session-isolation）

### 5.1 项目隔离（已支持，文档化）

- `rootDir` = BASE；每项目 = `<...>/normify-<slug>/`（文件系统级隔离）。
- 工具 args 已带 `project`（slug）→ `resolveProject` 定位。一服务器多项目 = per-request slug。
- per-user + per-project 二维：`rootDir/<userId>/normify-<slug>/`。

### 5.2 auth（token → userId + project allowlist）

- `NORMIFY_SERVER_TOKEN` 或 token 配置 → 解析 `userId` + 该 token 可访问的 project slug 集合。
- per-request：client 带 token + project；server 校验 token→userId + allowlist 含 project。
- 无 token（stdio 默认）= default user + 全项目可见（向后兼容，本地开发不挡）。
- **路径 arg 逃逸防护与 auth 绑定**：userScope 给定（= 有 token = auth 开）时，`root`/`dir` 必须落 `rootDir/<userScope>/` 内（堵路径遍历跨用户）；userScope undefined（无 token）时 args 不限（向后兼容）。

## 6. session-isolation Action 范围（前置）　✅ 已完成

> 实施完成（2026-09-25）：`src/session.ts`（SessionManager/SessionState/parseAuthConfig/resolveSessionAuth/createSessionState）+ `ToolEnv.userScope?/projectAllowlist?` + `resolveProject` 第 4 参 userScope + `assertWithinScope`（先于 dir-name 校验）+ `listProjects(rootDir, userScope?)` + `src/mcp/server.ts` 经 SessionManager 取 per-session catalog/companionCount。`tests/session-isolation.mjs` 13 PASS。`npm test` 9 套全绿 + parity 27 PASS + ci-contract 绿。阻塞解除：`dual-side-mode` 可复用本抽象。

| 项 | 内容 |
| --- | --- |
| 统一 Session 抽象 | `SessionManager` + `SessionState` + `Map<sessionId, SessionState>`；stdio 1 session / http N session 同形状 |
| companion 修复 | 模块作用域 → per-session（SessionState.companionCount） |
| per-user 图隔离（模型 i） | `ToolEnv.userScope` + `resolveProject` userScope 维度 + per-session catalog |
| 项目隔离 | 文档化（已支持） |
| auth 脚手架 | token → userId + project allowlist（无 token = default + 全可见） |
| transport | **仅 stdio**（1 session 验证抽象）；HTTP 在 dual-side-mode |
| 向后兼容 | 无 token 路径不变；27 PASS + 9 套 npm test 全绿（含 session-isolation 13） |

## 7. Bridge 抽象（dual-side-mode，依赖 session-isolation）　✅ 已完成

> 实施完成（2026-09-25）：`src/bridge.ts`（`RepoBridge` 接口 + `LocalBridge` 包 fs+git + `SessionCacheBridge` DP4 从推送快照读）；`store.ts` 3 engine 函数加可选 `bridge?`（默认 LocalBridge，向后兼容）；`ToolEnv.bridge?`；sync inline `existsSync`→`await bridge.exists`（sync→async 预计算）；`SessionState.env`（可变 .bridge）；`POST /snapshot` 路由（R3 推送→`SessionState.env.bridge=SessionCacheBridge`）。R3 推送选 HTTP `/snapshot` 端点（非 MCP 自定义 method——SDK 不确定 + 不破坏 31 工具约束；R-007 SHOULD fallback）。

证据工具的 repoRoot 访问经 Bridge，图编辑工具的项目数据 fs 不经 Bridge。

```ts
interface RepoBridge {
  readFile(path: string): Promise<{ ok: true; bytes: Buffer } | { ok: false; missing: true }>;
  exists(path: string): Promise<boolean>;
  gitHead(): Promise<{ sha: string | null; error: string | null }>;
  gitChangedFiles(diff?: string): Promise<{ files: string[] | null; error: string | null }>;
}
```

实现：LocalBridge（本地 fs，单用户）/ SessionCacheBridge（R3 推送快照，per-session 缓存，存 SessionState.cacheBridge）/ RemoteBridge（future，live 回调）。

注入 `ToolEnv.bridge`；改 `fingerprintOf`/`gitHead`/`gitChangedFiles` + sync 内联 `existsSync`。25+ 图工具不碰 Bridge。

## 8. transport + 客户端（dual-side-mode）

### 8.1 server HTTP

`src/mcp/server.ts` 加 `NORMIFY_TRANSPORT=stdio|http`（`StreamableHTTPServerTransport`，`sessionIdGenerator`）。catalog/companion/tools-call 逻辑 transport 无关（§3 抽象已统一）。

### 8.2 客户端

| 宿主 | 连法 | 客户端代码 |
| --- | --- | --- |
| Claude Code / Cursor / Codex | 内置 MCP client，config 指向 HTTP URL | 零 |
| pi | thin 扩展 `src/pi/normify-client.ts`（MCP `Client` + `StreamableHTTPClientTransport` → `pi.registerTool` 桥） | 瘦（仅 MCP SDK，不装 catalog/engine/yaml） |

## 9. R3 推送快照（dual-side-mode P4）

证据工具是"快照校验"，不需 live fs。v1 用推送快照，无回调：

```
client 跑 normify_fingerprint(repoRoot, source)
  1. client 从图（server，per-user workspace）读该模块 source 路径列表
  2. client 本地 readFile/git → push {path→bytes, gitHead, gitChangedFiles} 到 server session 缓存（SessionState.cacheBridge）
  3. client 调 normify_fingerprint（MCP tools/call）
  4. server fingerprintOf(bridge=SessionCacheBridge, sources) → 从 session 缓存读字节 → 算 SHA-256
```

推送协议形状（P4 定）：倾向 MCP 自定义 method `normify/pushSnapshot`（单连接，避免第二端口）。

## 10. companion 跨进程（dual-side-mode）

维持 S5 §9 Q5 决断的 split（跨进程不破坏）：
- server-side companion：SessionState.companionCount（§3 已 per-session），计 normify_* 调用（behavior 代理）。
- pi-client-side companion：`createCompanionHandler`（WRITE_TOOLS，计 pi 外部写），在 pi 瘦客户端内（小，不拉 engine）。

## 11. 设计决断

| Q | 决断 | 依据 |
| --- | --- | --- |
| Q1 stdio 留不留 | 留（dual transport） | 单用户本地不 breaking |
| Q2 pi 瘦客户端用 MCP SDK | 是 | 协议语义复用 |
| Q3 rootDir/repoRoot | rootDir=base+user+project 三维；repoRoot 经 Bridge 虚拟化 | §2.1 + §4 + §7 |
| Q4 companion | split（维持 §9 Q5） | §10 |
| Q5 auth | token → userId + project allowlist；无 token=default+全可见 | §5.2 |
| Q6 in-process pi 扩展留不留 | 留（单 dev fallback） | 用户二选一 |
| Q7 Bridge 实现优先级 | v1 LocalBridge + SessionCacheBridge；RemoteBridge future | 证据工具是快照校验 |
| **Q8 隔离模型** | **(i) 完全独立**——每用户一棵独立图，无合并，无共享 main | §4 |
| **Q9 图共享** | **否**——各用户图互不可见；无 publish/merge 工具 | Q8 决断 |

## 12. 实施相（两 Action）

### `session-isolation`（前置）

| 相 | 内容 | 验收（雏形） |
| --- | --- | --- |
| SP1 | `SessionManager` + `SessionState` + `Map<sessionId,SessionState>`；stdio synthesize 1 session | server 启动 + tools/list/call 仍工作 |
| SP2 | `ToolEnv.userScope` + `resolveProject` userScope 维度 + per-session buildCatalog | 无 token 路径不变；27 PASS + 8 套绿 |
| SP3 | companion 模块作用域 → per-session（SessionState.companionCount） | companion 仍触发（stdio 1 session 行为零变） |
| SP4 | auth 脚手架：token → userId + project allowlist；无 token=default | 无 token=全可见；有 token=隔离路径生效 |

### `dual-side-mode`（depends-on session-isolation）

| 相 | 内容 | 验收 |
| --- | --- | --- |
| DP1 | Bridge 接口 + LocalBridge + 改 fingerprintOf/gitHead/gitChangedFiles/sync existsSync + ToolEnv.bridge | parity 27 PASS；8 套绿 |
| DP2 | server HTTP transport（StreamableHTTPServerTransport）+ 多 session 复用 §3 抽象 | 两并发 session companion 互不干扰；DSH vs HTTP parity |
| DP3 | pi 瘦客户端 `src/pi/normify-client.ts`（MCP client + registerPiTools + companion handler） | headless 31 工具 + call |
| DP4 | SessionCacheBridge + R3 推送（`normify/pushSnapshot`） | fingerprint == LocalBridge 直算 |
| DP5 | SETUP.md dual-side 节 + auth + §9 Q8/Q9 回流 + 测试接入 | 文档 + 全绿 |

## 13. 验证策略

- session-isolation：27 PASS + 8 套 npm test 全绿（向后兼容硬约束）；companion 触发行为零变（stdio 1 session）。
- dual-side-mode DP1：parity 仍 27 PASS（LocalBridge 不破坏）。
- DP2：两并发 session 隔离测试（A 写满阈值不影响 B 计数）+ DSH vs HTTP parity。
- DP3：pi 瘦客户端 headless 模拟。
- DP4：SessionCacheBridge vs LocalBridge fingerprint 一致性。

## 14. 开问题

- SessionManager 生命周期（session 过期/清理）——SP1/SP4。
- R3 推送协议形状（MCP method vs HTTP endpoint）——DP4。
- 多项目一服务器的 allowlist 配置格式——SP4。
- pi 瘦客户端 MCP SDK 依赖解析——DP3。
- SessionCacheBridge 缓存粒度/失效——DP4。

---

## toolenv-split 回流（2026-09-27）

上文 `ToolEnv`（session-isolation SP2 加 `userScope`/`projectAllowlist`、dual-side DP1 加 `bridge`）的历史记录保留作演进轨迹。`toolenv-split` Action（已 complete）将 god-port `ToolEnv` 拆为 3 facet：

- `SecurityContext`（`userScope?`/`projectAllowlist?`，源 auth/token）——session-isolation SP2 字段归此。
- `InfraEnv`（`rootDir`/`bridge?`，源 config/R3 推送）——dual-side DP1 `bridge` 归此。
- `Policy`（`requireBilingual`，源 config）。

`buildCatalog(security, infra, policy)` 改 3 参签名；`SessionState` 去 `env: ToolEnv`，identity（`userId`/`projectAllowlist`）留顶层（session 身份），加 `infra`/`policy`；`pushSnapshot` 写 `state.infra.bridge`（原 `state.env.bridge`）。`ToolEnv` 类型已删（无外部代码消费者）。详见 `docs/actions/_archive/complete/toolenv-split/README.md`。
