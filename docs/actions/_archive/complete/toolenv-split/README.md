# ToolEnv Split

- Action: `toolenv-split`
- Status: `complete`
- Updated: 2026-09-27
- Status authority: [Action Status](../../../STATUS.md)
- Design source: arch-cleanup R-005 deferred 项（god-port 异味）+ ToolEnv 字段用法 grep 实证（见 Design inputs）

## Background

`ToolEnv`（`catalog.ts:24`）是 buildCatalog 的唯一入参，5 字段混 3 类关注点：

```ts
export interface ToolEnv {
    rootDir: string;              // InfraEnv：图 DB 根（config）
    requireBilingual: boolean;   // Policy：双语策略（config）
    userScope?: string;           // SecurityContext：用户图隔离维度（auth/token）
    projectAllowlist?: string[]; // SecurityContext：项目 allowlist（auth/token）
    bridge?: RepoBridge;          // InfraEnv：repoRoot 桥（config / R3 推送）
}
```

arch-cleanup 审计标注为 god-port（infrastructure + policy + security 混合一处）。readiness 评估 ROI 偏低（buildCatalog 单源签名改带 parity 回归风险）→ defer 独立 Action。本 Action 正式化该 defer 项。

**现状问题**（grep 实证）：
- adapter（DSH/MCP/pi）+ session.ts 构造一个 blob 传入 buildCatalog，auth→security 流程不可见（session.ts 把 userId/allowlist 与 rootDir/bridge/requireBilingual 混进同一 env）。
- SecurityContext 字段（userScope/projectAllowlist）仅在 resolve 闭包 + listProjects 用（2 处），与 InfraEnv(bridge, 9 处) / Policy(5 处) 混在一起，读者无法从类型看出关注点边界。
- pushSnapshot 改 `state.env.bridge`——infrastructure 写入点藏在泛化的 `env` 字段里，不够显式。

## Goal

把 ToolEnv 拆为 3 个单一职责 facet 接口，buildCatalog 显式接 3 facet，使 auth→security / config→infra / config→policy 的流向在 adapter + session.ts 可见 + 可独立测试。非为拆而拆：拆后 adapter 构造 facet 的来源（auth vs config）显式化。

## Non-goals

- 不改 catalog 内部业务逻辑（resolve/evidence/tool handler 行为零变）。
- 不改 engine 层（validateProject/buildProject/closeChange/refreshModules opts 不动；它们已各自接 bridge/requireBilingual）。
- 不拆 catalog.ts 文件（规模问题，parity 风险，另议）。
- 不抽 GraphStore port（engine node:fs 读写 rootDir 图数据，已知妥协）。
- 不改 ToolEntry 结构 / 31 工具契约（ci-contract 约束）。
- 不发布、不动 SDK 版本。

## Scope

- **AP-001（类型拆分）**：catalog.ts 定义 `SecurityContext`/`InfraEnv`/`Policy` 3 接口；`buildCatalog(security, infra, policy)` 改 3 参签名；内部 resolve 闭包改捕获 `(security, infra)`，evidence handler 用 `infra.bridge` + `policy.requireBilingual`。
- **AP-002（SessionState 重塑）**：`SessionState` 去掉 `env: ToolEnv`，改为保留顶层 `userId`/`projectAllowlist`（session 身份，不丢）+ 新增 `infra: InfraEnv` + `policy: Policy`（替 env）；`pushSnapshot(state, bridge)` 改写 `state.infra.bridge`（非 `state.env.bridge`）。**去重**：env 不再存 userScope（原顶层与 env 双存的重复消除）；buildCatalog 调用处从顶层 identity 派生 SecurityContext。
- **AP-003（adapter + 测试同步）**：DSH(tools.ts)/MCP(server.ts)/pi(normify.ts) + session.ts createSessionState 构造 3 facet 传入 buildCatalog；createSessionState 签名改（env→infra+policy，security←token）；tests parity-differential/session-isolation/dual-side-http buildCatalog + createSessionState 调用点同步。实际影响面 ~15 call-site（7 buildCatalog + 8 createSessionState）。
- **AP-004（向后兼容 alias，可选）**：`type ToolEnv = SecurityContext & InfraEnv & Policy`（deprecated alias，平滑外部消费者；若本仓内无外部消费者则直接删 ToolEnv）。

## Design inputs

- **ToolEnv 字段用法**（grep 实证，catalog.ts）：
  - `env.rootDir`：resolve 闭包 L608（resolveProject）+ listProjects L618。源 config。4 ref。
  - `env.requireBilingual`：validate/build/closeChange opts L855/867/1073/1697。源 config。5 ref。
  - `env.userScope`：resolve 闭包 L608（resolveProject 第 4 参）+ listProjects L618 + allowlist 错误信息 L605。源 auth。4 ref。
  - `env.projectAllowlist`：resolve 闭包 L603-604（allowlist 校验）。源 auth。2 ref。
  - `env.bridge`：6 evidence handler L855/867/885/1219/1528/1693。源 config/R3 推送。9 ref。
- **buildCatalog 调用者**（4 adapter + 3 test）：
  - `src/tools.ts:30`（DSH）— `buildCatalog(env)`，无 security。
  - `src/session.ts:106` — `buildCatalog(sessionEnv)`，per-session security from token。
  - `src/pi/normify.ts:84` — `buildCatalog(env)`，无 security。
  - `src/mcp/server.ts` — 构造 baseEnv → createSessionState → buildCatalog（http per-session security from token）。
  - `tests/parity-differential.mjs:63` — `buildCatalog({rootDir, requireBilingual})`。
  - `tests/session-isolation.mjs:91-92` — `buildCatalog(envA/envB)`（per-user scope）。
  - `tests/dual-side-http.mjs:91` — `buildCatalog({rootDir, requireBilingual})`。
- **SecurityContext 两字段总是一起用**（allowlist 校验需 userScope + projectAllowlist 同时给定）→ 同属一 facet ✓。
- **SessionState.env 现状**（session.ts:20）：`env: ToolEnv`（可变 `.bridge`——pushSnapshot 后置）。**重复存 identity**：顶层 `userId`/`projectAllowlist`（L13-14）与 `env.userScope`/`env.projectAllowlist`（createSessionState L106-108）同值双存。
- **pushSnapshot 现状**（session.ts:27）：`state.env.bridge = bridge` → 改 `state.infra.bridge = bridge`。
- **createSessionState 现状**（session.ts:83）：从 env + token 构造 SessionState（env 带 userScope）→ 改：identity ← token（顶层 userId/projectAllowlist，保留）；infra ← env.rootDir/bridge；policy ← env.requireBilingual；buildCatalog 调用处从 identity 派生 SecurityContext `{userScope: identity.userId, projectAllowlist: identity.projects}`。

## Requirements

- **R-001 MUST**：`ToolEnv` 拆为 `SecurityContext`（userScope?/projectAllowlist?）+ `InfraEnv`（rootDir/bridge?）+ `Policy`（requireBilingual）3 接口；字段不跨 facet。
- **R-002 MUST**：`buildCatalog(security: SecurityContext, infra: InfraEnv, policy: Policy)` 改 3 参签名；内部 resolve 闭包 + evidence handler + listProjects 改读对应 facet（非 env.X）。
- **R-003 MUST**：`SessionState` 去掉 `env: ToolEnv`，改为顶层 `userId`/`projectAllowlist`（保留，session 身份）+ `infra: InfraEnv` + `policy: Policy`；`pushSnapshot(state, bridge)` 改写 `state.infra.bridge`。**去重**：identity 单存顶层（不再双存于 env）；buildCatalog 从顶层 identity 派生 SecurityContext。**不变量**：createSessionState 必须把**同一** `infra` 对象引用传给 buildCatalog（闭包捕获）并存入 `state.infra`——pushSnapshot 是字段变更（`state.infra.bridge = bridge`，非重赋整个 infra），闭包经引用见更新（镜像 current `sessionEnv` 单对象模式；若 executor 误用 spread 副本 `{...infra}` 传 buildCatalog，闭包捕获副本 → pushSnapshot 改原对象 → dual-side 坏）。
- **R-004 MUST**：向后兼容硬约束——parity 27 + 12 套 npm test + ci-contract + tsc 0 全绿（行为零变；DSH/stdio 无 security 时传 `{}` 或 `undefined` 安全 facet）。
- **R-005 SHOULD**：adapter 构造 facet 的来源显式（session.ts createSessionState：identity ← token 解析（顶层 userId/projectAllowlist）；infra ← config env；policy ← config env；buildCatalog 调用处派生 security）——auth→identity 流向在代码可见，identity 留顶层供未来 logging/access/审计。
- **R-006 MAY**：`type ToolEnv = SecurityContext & InfraEnv & Policy` deprecated alias 保留过渡（若本仓内无外部消费者则直接删，R-006 不满足亦可）。

## Proposed design

**Design A（全拆，F-002 授权 A″）**：3 facet 接口 + buildCatalog 3 参 + SessionState 去 env 拆 infra/policy（保留顶层 identity）。adapter + 测试同步。auth→identity（顶层）/ config→infra / config→policy 流向显式；buildCatalog 调用处从 identity 派生 security。

**F-002 决策（user 授权 A″，2026-09-27）**：identity（userId/projectAllowlist）是 session 身份（超出 catalog 用途——未来 logging/access/审计），留顶层；SecurityContext 在 buildCatalog 调用处从顶层 identity 派生（非存储 facet）。去重：env 不再存 userScope。打破原 README A′（identity 合进 security facet）会让 session 身份退化为 catalog 输入，关注点错位。

```ts
// catalog.ts
export interface SecurityContext { userScope?: string; projectAllowlist?: string[]; }
export interface InfraEnv { rootDir: string; bridge?: RepoBridge; }
export interface Policy { requireBilingual: boolean; }
export function buildCatalog(security: SecurityContext, infra: InfraEnv, policy: Policy): ToolEntry[] {
    const resolve = (args, create = false) => {
        if (security.userScope !== undefined && security.projectAllowlist !== undefined && args.project && !/[\/\\:]/.test(args.project)) {
            if (!security.projectAllowlist.includes(args.project)) throw new NormifyError('session/project-not-allowed', ...);
        }
        return resolveProject(infra.rootDir, { project: args.project, dir: args.dir }, { create }, security.userScope);
    };
    // evidence handlers: infra.bridge ?? new LocalBridge(args.repoRoot); policy.requireBilingual
    // listProjects(infra.rootDir, security.userScope)
}
```

**Design B（类型拆，签名不动，低风险 fallback）**：3 facet 接口 + `type ToolEnv = SecurityContext & InfraEnv & Policy` + buildCatalog(env: ToolEnv) 不变。零 call-site 改动，但价值仅文档级（facet 命名），auth 流向仍不可见。

**决策门（已决）**：F-002 user 授权 A″（顶层 identity + 派生 security）。G-001 Design A 可行（parity 回归风险可控：~15 call-site 机械改 + SessionState 去 env，identity 保留→session-isolation 5 处 st.userId 断言不动）。Design B（类型拆签名不动）不再考虑（A″ 已最小 breakage 且达 god-port 拆分目标）。

## Implementation plan

- **AP-001**：catalog.ts 定义 3 facet 接口 + buildCatalog 3 参 + 内部 resolve/handler/listProjects 改读 facet。删 ToolEnv 或留 deprecated alias（R-006）。
- **AP-002**：session.ts SessionState 去 env + 加 infra/policy（顶层 identity 保留）+ pushSnapshot 改 state.infra.bridge + createSessionState 改从 token→identity(顶层) / env→infra+policy / buildCatalog 派生 security。
- **AP-003**：4 adapter（tools.ts/MCP server.ts/pi normify.ts + session.ts createSessionState）+ 3 test（parity/session-isolation/dual-side-http）调用点同步。
- 验证：parity 27 + 12 套 + ci-contract + tsc 0。

## Acceptance

| ID | Requirement | Observable condition | Planned evidence | Status |
| --- | --- | --- | --- | --- |
| A-001 | R-001 | `grep "interface SecurityContext\|interface InfraEnv\|interface Policy" src/catalog.ts` 3 行；ToolEnv 字段不跨 facet | grep + tsc | **passed** |
| A-002 | R-002 | buildCatalog 3 参；resolve/handler/listProjects 读 facet 非 env | `grep "env\." src/catalog.ts` 业务代码 0 | **passed** |
| A-003 | R-003 | SessionState 去 env + 加 `infra`/`policy`（顶层 identity 保留）；pushSnapshot 写 `state.infra.bridge`；createSessionState 传同一 infra 给 buildCatalog + 存 state.infra（不变量） | grep `env: ToolEnv` src/session.ts 空 + session-isolation 13 PASS（5 处 st.userId 不动）+ dual-side-snapshot 5 PASS（pushSnapshot 后闭包见 bridge） | **passed** |
| A-004 | R-004 | parity 27 + npm test 12 套 + ci-contract + tsc 0 全绿 | 测试输出 | **passed** |
| A-005 | R-005 | createSessionState: identity←token（顶层）、infra←env、policy←env；buildCatalog 从 identity 派生 security 显式 | grep session.ts 构造路径 | **passed** |

## Validation

- AP-001/002：`grep "interface SecurityContext\|InfraEnv\|Policy" src/catalog.ts`（3 行）+ `grep "env\." src/catalog.ts`（业务代码 0）+ `npx tsc --noEmit`（0）。
- AP-003：`node tests/parity-differential.mjs`（27 PASS）+ `npm test`（12 绿）。
- 全程：`node ci-contract-check.cjs`（绿）+ `grep "state.infra.bridge" src/session.ts`（有）。

## Execution

user 2026-09-27 授权 in_progress → 执行 AP-001~AP-003。实施按 A″（identity 留顶层 + 派生 security）。

- **AP-001（catalog.ts）**：Python 脚本机械 rename 19 处 `env.X`→facet.X（rootDir→infra 3 / bridge→infra 6 / requireBilingual→policy 4 / userScope→security 4 / projectAllowlist→security 2）；`ToolEnv` 接口拆 `SecurityContext`+`InfraEnv`+`Policy` 3 接口；`buildCatalog(security, infra, policy)` 3 参签名；删 `ToolEnv`。无局部 env 变量 shadow（grep 实证 env 仅签名处）→ 脚本替换安全。
- **AP-002（session.ts）**：`SessionState` 去 `env: ToolEnv` → 顶层 `userId`/`projectAllowlist`（保留）+ `infra: InfraEnv` + `policy: Policy`；`pushSnapshot(state, bridge)` 写 `state.infra.bridge`（非 `state.env.bridge`）；`createSessionState(sessionId, infra, policy, token, authConfig, ...)` 改 5 参——identity←token（顶层 userId/projectAllowlist），buildCatalog 调用处从 identity 派生 `SecurityContext`，同一 infra 对象传 buildCatalog + 存 state.infra（不变量保闭包见 pushSnapshot 字段变更）。
- **AP-003（adapter + tests）**：DSH `registerTools(ctx, infra, policy)` + index.ts `apply` 拆参；pi `registerPiTools(pi, infra, policy)` + default export 拆 `infra`/`policy`；MCP server `baseInfra`+`basePolicy` 替 `baseEnv`，2 处 `createSessionState` 调用改参序。tests：parity/session-isolation(5 处 createSessionState + 2 处 buildCatalog)/dual-side-http buildCatalog 调用同步。
- 执行期注释修复：server.ts/pi normify.ts L3 注释 `ToolEnv 从环境变量读` → `InfraEnv/Policy 从环境变量读`；pi normify.ts L80 注释 `buildCatalog(env)` → `buildCatalog({}, infra, policy)`。

验收结果（2026-09-27）：
- `grep interface SecurityContext/InfraEnv/Policy src/catalog.ts` → 3（+ 注释 2）✓
- `grep env\. src/catalog.ts`（业务代码）→ 0 ✓
- `grep env: ToolEnv src/session.ts` → 0 ✓
- `grep state.infra.bridge src/session.ts` → 1 ✓
- `grep -rn ToolEnv src/` → 0（仅注释已修）✓
- `npx tsc --noEmit` → 0 ✓
- `node tests/parity-differential.mjs` → 27 PASS ✓
- `npm test` → 12 套全绿 ✓
- `node ci-contract-check.cjs` → 绿 ✓
- session-isolation 13 PASS（5 处 st.userId 断言不动——A″ 保留顶层 identity 验证）✓
- dual-side-snapshot 5 PASS（pushSnapshot 写 state.infra.bridge 后闭包见 bridge——不变量验证）✓

## Readiness gaps

无（R6 通过，K=3 于 R4 达成，R5/R6 额外审查仍 clean）。Readiness review 记录（R1–R6）：

- **R1**：F-001 low（call-site ~7→~15：7 buildCatalog + 8 createSessionState，auto-fix）+ **F-002 medium+ambiguous**（SessionState 重复存 identity：顶层 `userId`/`projectAllowlist` 与 `env.userScope`/`env.projectAllowlist` 同值双存）→ stop+escalate → user 授权 **A″**：identity 留顶层（session 身份语义完整，供未来 logging/access/审计），SecurityContext 在 buildCatalog 调用处从顶层 identity 派生；去重 env.userScope。session-isolation 5 处 st.userId 断言不动。F-002 是关键决策（避免 A′ 把 session 身份降格为 catalog 输入的关注点错位）。
- **R2**：0 medium+（`registerTools`/`registerPiTools` 实证为内部 helper：DSH harness 调 `apply(ctx,config)`、pi 调 extension factory；删 ToolEnv 只影响 src/ 5 文件，无外部 breakage）→ 1/3。
- **R3**：F-003 low（doc backflow：SERVER-MODE/MULTIPLATFORM 9 行引 ToolEnv 历史里程碑记录 → auto-fix：closure 加交叉引用注「ToolEnv 后由 toolenv-split 拆为 SecurityContext/InfraEnv/Policy」，不重写历史）→ 2/3。
- **R4**：0 medium+（ToolEnv 全引用面 5 src+6 lib+9 doc 全覆盖；tests 不直接引类型；DSH 无 security→`{}` SecurityContext→向后兼容；parity 机械）→ **3/3 ✅ K=3 达成**。
- **R5（额外）**：F-004 low（闭包捕获不变量未文档化 → auto-fix：R-003 加「createSessionState 传**同一** infra 对象给 buildCatalog + 存 state.infra，pushSnapshot 字段变更非重赋，镜像 current sessionEnv 单对象模式；防粗心 spread 副本致 dual-side 坏」+ A-003 加验收「dual-side-snapshot 5 PASS 验 pushSnapshot 后闭包见 bridge」）。
- **R6（额外）**：0 medium+（catalog.ts 19 处 `env.`→facet 映射全无歧义：rootDir→infra(3)/bridge→infra(6)/requireBilingual→policy(4)/userScope→security(4)/projectAllowlist→security(2)；无字段跨 facet；无内部 helper 接 env；env 字面量无散落；createSessionState bridge 传播同 current 行为）。

**K=3 于 R4 达成（R2/R3/R4 连续 0 medium+）；R5/R6 额外 scrutin 仍仅 low。** user 2026-09-27 授权 status → `ready`。

## Closure conditions

- 全部 MUST 验收（A-001~A-004）passed；R-005 SHOULD 满足；R-006 MAY 满足或显式不保留 alias。
- parity 27 + 12 套 npm test + ci-contract + tsc 0 全绿（向后兼容硬约束）。
- 持久结论回流：
  - 本 README 记录 facet 拆分决策（A″：identity 留顶层 + 派生 security）+ ToolEnv 删除。
  - doc backflow：SERVER-MODE.md / MULTIPLATFORM.zh-CN.md 9 行引 ToolEnv（历史里程碑记录：session-isolation 加 userScope、dual-side 加 bridge）——保留作历史，加交叉引用注「ToolEnv 后由 toolenv-split 拆为 SecurityContext/InfraEnv/Policy」（不重写历史）。
- 状态、路径、导航、归档一致。
