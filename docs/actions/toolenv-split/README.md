# ToolEnv Split

- Action: `toolenv-split`
- Status: `draft`
- Updated: 2026-09-27
- Status authority: [Action Status](../STATUS.md)
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
- **AP-002（SessionState 重塑）**：`SessionState` 由 `env: ToolEnv` 改为 `{ security: SecurityContext; infra: InfraEnv; policy: Policy }`；`pushSnapshot(state, bridge)` 改写 `state.infra.bridge`（非 `state.env.bridge`）。
- **AP-003（adapter + 测试同步）**：DSH(tools.ts)/MCP(server.ts)/pi(normify.ts) + session.ts createSessionState 构造 3 facet 传入 buildCatalog；tests parity-differential/session-isolation/dual-side-http 调用点同步。
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
- **SessionState.env 现状**（session.ts:20）：`env: ToolEnv`（可变 `.bridge`——pushSnapshot 后置）。
- **pushSnapshot 现状**（session.ts:27）：`state.env.bridge = bridge` → 改 `state.infra.bridge = bridge`。
- **createSessionState 现状**（session.ts:83）：从 env + token 构造 SessionState（env 带 userScope）→ 改：从 token 构造 security、从 env 构造 infra+policy。

## Requirements

- **R-001 MUST**：`ToolEnv` 拆为 `SecurityContext`（userScope?/projectAllowlist?）+ `InfraEnv`（rootDir/bridge?）+ `Policy`（requireBilingual）3 接口；字段不跨 facet。
- **R-002 MUST**：`buildCatalog(security: SecurityContext, infra: InfraEnv, policy: Policy)` 改 3 参签名；内部 resolve 闭包 + evidence handler + listProjects 改读对应 facet（非 env.X）。
- **R-003 MUST**：`SessionState` 改 `{ security, infra, policy }`；`pushSnapshot(state, bridge)` 改写 `state.infra.bridge`。
- **R-004 MUST**：向后兼容硬约束——parity 27 + 12 套 npm test + ci-contract + tsc 0 全绿（行为零变；DSH/stdio 无 security 时传 `{}` 或 `undefined` 安全 facet）。
- **R-005 SHOULD**：adapter 构造 facet 的来源显式（session.ts createSessionState：security ← token 解析；infra ← config env；policy ← config env）——auth→security 流向在代码可见。
- **R-006 MAY**：`type ToolEnv = SecurityContext & InfraEnv & Policy` deprecated alias 保留过渡（若本仓内无外部消费者则直接删，R-006 不满足亦可）。

## Proposed design

**Design A（全拆，推荐）**：3 facet 接口 + buildCatalog 3 参 + SessionState 3 字段。adapter + 测试同步。auth→security / config→infra / config→policy 流向显式。

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

**决策门**：readiness review 评估 Design A 的 parity 回归风险是否可接受（~7 call-site 机械改 + SessionState 形状变）；若风险过高 fallback Design B。

## Implementation plan

- **AP-001**：catalog.ts 定义 3 facet 接口 + buildCatalog 3 参 + 内部 resolve/handler/listProjects 改读 facet。删 ToolEnv 或留 deprecated alias（R-006）。
- **AP-002**：session.ts SessionState 改 3 字段 + pushSnapshot 改 state.infra.bridge + createSessionState 改从 token→security / env→infra+policy。
- **AP-003**：4 adapter（tools.ts/MCP server.ts/pi normify.ts + session.ts createSessionState）+ 3 test（parity/session-isolation/dual-side-http）调用点同步。
- 验证：parity 27 + 12 套 + ci-contract + tsc 0。

## Acceptance

| ID | Requirement | Observable condition | Planned evidence | Status |
| --- | --- | --- | --- | --- |
| A-001 | R-001 | `grep "interface SecurityContext\|interface InfraEnv\|interface Policy" src/catalog.ts` 3 行；ToolEnv 字段不跨 facet | grep + tsc | pending |
| A-002 | R-002 | buildCatalog 签名 3 参；resolve/handler/listProjects 读 facet 非 env | grep "env\." src/catalog.ts 仅注释/0 | pending |
| A-003 | R-003 | SessionState `{security,infra,policy}`；pushSnapshot 写 `state.infra.bridge` | grep "state.infra.bridge" + session-isolation 13 PASS | pending |
| A-004 | R-004 | parity 27 + npm test 12 套 + ci-contract + tsc 0 全绿 | 测试输出 | pending |
| A-005 | R-005 | createSessionState: security ← token、infra ← env、policy ← env 显式 | grep session.ts 构造路径 | pending |

## Validation

- AP-001/002：`grep "interface SecurityContext\|InfraEnv\|Policy" src/catalog.ts`（3 行）+ `grep "env\." src/catalog.ts`（业务代码 0）+ `npx tsc --noEmit`（0）。
- AP-003：`node tests/parity-differential.mjs`（27 PASS）+ `npm test`（12 绿）。
- 全程：`node ci-contract-check.cjs`（绿）+ `grep "state.infra.bridge" src/session.ts`（有）。

## Readiness gaps

待 readiness review（K=3 收敛）评估：
- **G-001**：Design A vs B 决策——parity 回归风险（~7 call-site + SessionState 形状变）vs 价值（auth 流向显式）。readiness 定 Design A 可行性。
- **G-002**：R-006 ToolEnv alias 是否保留——本仓内 ToolEnv 外部消费者？（grep `ToolEnv` 本仓 src/tests 外无 → 可直接删）。

## Closure conditions

- 全部 MUST 验收（A-001~A-004）passed；R-005 SHOULD 满足；R-006 MAY 满足或显式不保留 alias。
- parity 27 + 12 套 npm test + ci-contract + tsc 0 全绿（向后兼容硬约束）。
- 持久结论回流：本 README 记录 facet 拆分决策（A vs B）+ ToolEnv alias 去留。
- 状态、路径、导航、归档一致。
