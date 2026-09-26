# Arch Cleanup

- Action: `arch-cleanup`
- Status: `draft`
- Updated: 2026-09-26
- Status authority: [Action Status](../STATUS.md)
- Design source: clean-architecture 依赖方向审计（基于代码 grep 实证，见 Design inputs）

## Background

dual-side-mode 完成后做了一次 clean architecture 审计。整体依赖方向正确（catalog use-case 层对 adapter SDK 零依赖 → 多平台 parity 地基；engine 无反向依赖 catalog/session/adapter），但有**一处真依赖反转违规** + 两处端口边界异味：

1. `src/engine/store.ts:12` import `LocalBridge`（具体 infrastructure 实现），并在 `gitHead`/`gitChangedFiles`/`fingerprintOf` 内 `bridge ?? new LocalBridge(repoRoot)` 兜底构造——**内层（engine/domain）创建外层（infrastructure）具体对象**，依赖反转未到位。
2. `src/mcp/server.ts` 的 `/snapshot` handler 解析 body + 构造 `SessionCacheBridge` + 赋值 `SessionState.env.bridge`——应用逻辑落在 interface-adapter 层。
3. `ToolEnv`（`catalog.ts:24`）是 god-port：`{rootDir, requireBilingual, userScope, projectAllowlist, bridge}` 混 infrastructure（rootDir/bridge）+ policy（requireBilingual）+ security（userScope/allowlist）。

审计中标注为"务实妥协"的项（engine 直接 node:fs 读写 rootDir 图数据——领域即文件存储；catalog 1806 行单文件——单源换 parity；engine/edit.ts 821 + template.ts 1767 巨石）**不在本 Action 范围**——它们是规模/组织问题，非架构违规，且大改带 parity 回归风险。

## Goal

- engine 层对 infrastructure 具体类零依赖（仅认 `RepoBridge` 接口）——修掉唯一真违规。
- `pushSnapshot` 应用逻辑归 use-case 层（session.ts），adapter 只做协议解码 + 委托。
- （可选）`ToolEnv` 按关注点拆分，提升可测试性 + 关注点分离。

## Non-goals

- 不拆 catalog.ts（1806 行）——规模/组织问题，单源是 parity 前提，拆分带漂移风险；另议。
- 不拆 engine/edit.ts（821）/ template.ts（1767）——内部巨石，对外 API 不变，无架构收益。
- 不抽 `GraphStore` port（engine 对 rootDir 图数据的 fs 访问）——领域即文件存储，所有部署 rootDir=本地 fs，收益低成本高；列为已知妥协。
- 不动 4 adapter 的 catalog 消费方式（buildCatalog(env) 契约不变）。
- 不发布、不动 SDK 版本。

## Scope

- AP-001：`src/engine/store.ts` 三函数（`gitHead`/`gitChangedFiles`/`fingerprintOf`）签名改 `bridge: RepoBridge` 必传（去 `?? new LocalBridge` 兜底 + 去 `import LocalBridge`）。
- AP-002：catalog 的 resolve 闭包 + sync/fingerprint 工具 handler 承接"默认 LocalBridge 构造"（`env.bridge ?? new LocalBridge(repoRoot)`），从 engine 上移到 use-case。
- AP-003：`pushSnapshot(state, data)` 抽到 `src/session.ts`（构造 `SessionCacheBridge` + 赋 `state.env.bridge`）；`mcp/server.ts` 的 `/snapshot` handler 改调它。
- AP-004（可选）：`ToolEnv` 拆 `SecurityContext`（userScope/projectAllowlist）+ `InfraEnv`（rootDir/bridge）+ `Policy`（requireBilingual）；`buildCatalog` 接拆分后的 params；4 adapter + 测试同步。

## Design inputs

- 依赖方向实证（grep，2026-09-26）：
  - catalog.ts use-case 层零 adapter SDK 依赖（无 `@modelcontextprotocol`/`@earendil-works/pi` import）✓。
  - engine 无反向依赖 catalog/session/mcp/pi（grep `engine/*.ts` 全空，除 store→bridge）。
  - `src/engine/store.ts:12` `import { LocalBridge } from '../bridge.js'` + L302/306/310 `bridge ?? new LocalBridge(repoRoot)`——**唯一真违规**。
  - `src/bridge.ts:12` `RepoBridge` 接口 + L24 `LocalBridge` + L75 `SessionCacheBridge`（2 实现，bridge.ts 0 内部 import，叶子模块）。
  - `src/mcp/server.ts` `/snapshot` handler 构造 SessionCacheBridge + 赋 `state.env.bridge`。
  - `src/catalog.ts:24` `ToolEnv{rootDir, requireBilingual, userScope?, projectAllowlist?, bridge?}`。
- parity 约束基线：`tests/parity-differential.mjs`（27 PASS，DSH-direct vs MCP-protocol 等价）+ `npm test` 12 套绿 + ci-contract 绿。
- `src/session.ts`（SessionState/SessionManager/createSessionState）——AP-003 落点。
- `src/catalog.ts` resolve 闭包（L594）+ sync 工具（L884+）+ fingerprint 工具（L1186+）——AP-002 落点。
- engine engine 3 函数调用者清单（AP-001 影响面）：`catalog.ts`（sync/fingerprint）+ `engine/validate.ts:312` + `engine/edit.ts:660,690` + `engine/companion.ts:103` + `tests/companion-e2e.mjs:34`。

## Requirements

- **R-001 MUST**：`src/engine/store.ts` 零 `import LocalBridge`（具体）；`gitHead`/`gitChangedFiles`/`fingerprintOf` 签名 `bridge: RepoBridge` 必传（无默认兜底）。engine 层对 infrastructure 具体类的依赖 = 0（仅认 `RepoBridge` 接口）。
- **R-002 MUST**：默认 LocalBridge 构造上移到 use-case 层——catalog resolve 闭包 + 工具 handler 内 `env.bridge ?? new LocalBridge(repoRoot)`；DSH/stdio（env.bridge undefined）行为零变（parity 27 PASS 不破坏）。
- **R-003 MUST**：`pushSnapshot(state, data)` 在 `src/session.ts`（use-case）；`mcp/server.ts` 的 `/snapshot` handler 改为协议解码 + 委托 `pushSnapshot`；SessionCacheBridge 构造不在 adapter 层。
- **R-004 MUST**：向后兼容——parity 27 PASS + 12 套 npm test + ci-contract 全绿（同 session-isolation/dual-side-mode 硬约束）。
- **R-005 MAY**：`ToolEnv` 拆 `SecurityContext{userScope, projectAllowlist}` + `InfraEnv{rootDir, bridge}` + `Policy{requireBilingual}`；`buildCatalog(security, infra, policy)` 或等价；session-isolation 测试可独立注入 security（不强制 userScope 即可测 allowlist）。若 ROI 不足或破坏面过大，可 defer 到独立 Action。
- **R-006 SHOULD**：审计标注的"已知妥协"（engine 直接 node:fs 读写 rootDir 图数据 / catalog 单文件 / edit+template 巨石）在本 Action README 或设计文档显式记录为"已知妥协，非本 Action 范围"，防未来误判为"应保持的设计"。

## Proposed design

- **AP-001/002（LocalBridge 上移）**：store.ts 三函数签名 `(..., bridge: RepoBridge)` 必传，去 `?? new LocalBridge(repoRoot)`。catalog resolve 闭包内：`const repoBridge = env.bridge ?? new LocalBridge(String(args.repoRoot)); fingerprintOf(repoRoot, sources, repoBridge)`（sync/fingerprint 工具同）。validate.ts/edit.ts/companion.ts 调用点：这几处不经 catalog resolve 闭包——它们调 `fingerprintOf(repoRoot, m.source)` 无 bridge。**决策点**：要么 (a) validate/edit/companion 也经 bridge 注入（需透传 RepoBridge 到 validateProject/buildProject/companion opts，面较大），要么 (b) 这几处保留 `new LocalBridge(repoRoot)` 构造但**在调用点**（不在 engine 内）——即 engine 函数必传 bridge，调用方负责构造。倾向 (b)：engine 纯接口依赖；调用方（catalog 工具 / validate / edit / companion）各自 `?? new LocalBridge`。Readiness review 定。
- **AP-003（pushSnapshot）**：`src/session.ts` 加 `export function pushSnapshot(state: SessionState, data: { files, gitHead?, gitChangedFiles? }): void`，内部 `state.env.bridge = new SessionCacheBridge(data)`。server.ts `/snapshot` handler：`const st = sessionManager.get(body.sessionId); if (!st) 404; pushSnapshot(st, body);`。
- **AP-004（ToolEnv 拆，MAY）**：`SecurityContext` + `InfraEnv` + `Policy` 三接口；`buildCatalog(infra, policy, security?)`。影响面：4 adapter 调用点 + session.ts createSessionState + 测试。Readiness review 评 ROI。

## Implementation plan

- **AP-001**：store.ts 三函数签名改 `bridge: RepoBridge` 必传 + 去 import LocalBridge。
- **AP-002**：catalog resolve 闭包 + sync/fingerprint 工具承接默认 LocalBridge 构造；validate.ts/edit.ts/companion.ts 调用点按决策 (b) 各自构造（或透传）。验证 parity 27 PASS + 12 套绿。
- **AP-003**：`src/session.ts` 加 `pushSnapshot`；server.ts `/snapshot` handler 改委托。验证 dual-side-snapshot 5 PASS。
- **AP-004（若 MAY 转 SHOULD）**：拆 ToolEnv + 4 adapter + 测试同步。Readiness review 定是否进本 Action。
- 全程：`npm test` 12 套绿 + parity 27 + ci-contract + tsc 0。

## Acceptance

| ID | Requirement | Observable condition | Planned evidence | Status |
| --- | --- | --- | --- | --- |
| A-001 | R-001 | `grep -n "LocalBridge" src/engine/*.ts` 全空（engine 零具体依赖）；store 三函数签名 `bridge: RepoBridge` 必传 | grep + tsc | pending |
| A-002 | R-002 | catalog resolve 闭包 + sync/fingerprint 工具内 `env.bridge ?? new LocalBridge`；DSH/stdio 行为零变 | parity 27 PASS + mcp-smoke 36 + companion-snapshot 3 | pending |
| A-003 | R-003 | `pushSnapshot` 在 `src/session.ts`；server.ts `/snapshot` handler 仅解码 + 委托（无 SessionCacheBridge 构造） | grep "SessionCacheBridge" src/mcp/server.ts 空 + dual-side-snapshot 5 PASS | pending |
| A-004 | R-004 | parity 27 + npm test 12 套 + ci-contract + tsc 0 全绿 | 测试输出 | pending |
| A-005 | R-005 | ToolEnv 拆分（若进本 Action）：buildCatalog 接拆分后 params；session-isolation 测试可独立注入 security | session-isolation 13 PASS（改后） | pending |
| A-006 | R-006 | "已知妥协"清单在设计文档或本 README 显式记录 | grep "已知妥协" | pending |

## Validation

记录计划命令（与实际执行分离）：

- AP-001/002：`grep -n "LocalBridge" src/engine/*.ts`（空）+ `npx tsc --noEmit`（0）+ `node tests/parity-differential.mjs`（27 PASS）+ `npm test`（12 绿）。
- AP-003：`grep -n "SessionCacheBridge" src/mcp/server.ts`（空）+ `node tests/dual-side-snapshot.mjs`（5 PASS）。
- AP-004（若进）：`node tests/session-isolation.mjs`（13 PASS，改后）。
- 全程：`node ci-contract-check.cjs`（绿）。

## Readiness gaps

- **AP-002 决策点**：validate.ts/edit.ts/companion.ts 的 `fingerprintOf`/`gitHead` 调用（不经 catalog resolve 闭包）如何承接 bridge——(a) 透传 RepoBridge 到 validateProject/buildProject/companion opts（面较大但最纯），还是 (b) 这几处调用点各自 `new LocalBridge`（engine 仍纯，调用方负责）。倾向 (b)。Readiness review 定。
- **AP-004 是否进本 Action**：ToolEnv 拆分影响面（4 adapter + session + 测试），ROI vs 成本——Readiness review 评，可 defer 独立 Action。
- 设计文档未经 review；Readiness review 需核验：签名变更影响面、向后兼容、pushSnapshot 抽象边界、ToolEnv 拆分决策。

## Closure conditions

- 全部 MUST 验收（A-001~A-004）passed；R-005 MAY 满足或显式 defer 独立 Action；R-006 SHOULD 满足。
- parity 27 + 12 套 npm test + ci-contract + tsc 0 全绿（向后兼容硬约束）。
- 持久结论回流：本 README 记录"已知妥协"清单（engine node:fs / catalog 单文件 / edit+template 巨石）。
- 状态、路径、导航、归档一致。
