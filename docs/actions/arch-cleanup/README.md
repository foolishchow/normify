# Arch Cleanup

- Action: `arch-cleanup`
- Status: `ready`
- Updated: 2026-09-27
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
- `pushSnapshot` 赋值逻辑归 use-case 层（session.ts，只接 RepoBridge）；adapter 负责解码 + 构造 SessionCacheBridge。
- （可选）`ToolEnv` 按关注点拆分，提升可测试性 + 关注点分离。

## Non-goals

- 不拆 catalog.ts（1806 行）——规模/组织问题，单源是 parity 前提，拆分带漂移风险；另议。
- 不拆 engine/edit.ts（821）/ template.ts（1767）——内部巨石，对外 API 不变，无架构收益。
- 不抽 `GraphStore` port（engine 对 rootDir 图数据的 fs 访问）——领域即文件存储，所有部署 rootDir=本地 fs，收益低成本高；列为已知妥协。
- 不动 4 adapter 的 catalog 消费方式（buildCatalog(env) 契约不变）。
- 不发布、不动 SDK 版本。

## Scope

- AP-001：`src/engine/store.ts` 三函数（`gitHead`/`gitChangedFiles`/`fingerprintOf`）签名改 `bridge: RepoBridge` 必传（去 `?? new LocalBridge` 兜底 + 去 `import LocalBridge`）。
- AP-002：6 个 evidence 工具 handler（sync/fingerprint/validate/build/module_refresh/change_close）承接"默认 LocalBridge 构造"（`env.bridge ?? new LocalBridge(args.repoRoot)`），从 engine 上移到 use-case；resolve 闭包不动（rootDir 项目解析）。
- AP-003：`pushSnapshot(state, bridge: RepoBridge)` 抽到 `src/session.ts`（只赋值 `state.env.bridge = bridge`，认 RepoBridge 接口）；`mcp/server.ts` 的 `/snapshot` handler 解码 body + 构造 SessionCacheBridge + 调 pushSnapshot。
- AP-004（已 defer）：`ToolEnv` 拆分移出本 Action（R-005 defer，非目标）。

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
- **R-002 MUST**：默认 LocalBridge 构造上移到 use-case 层 + engine 内部透传：(i) 6 个 evidence 工具 handler（sync/fingerprint/validate/build/module_refresh/change_close）内 `env.bridge ?? new LocalBridge(args.repoRoot)`（resolve 闭包不动——它是 rootDir 项目解析，不碰 repoRoot）；(ii) `validateProject`/`buildProject`/`refreshModules`/`closeChange` opts 加 `bridge?: RepoBridge`，catalog 工具调用时传入（透传到内部 `fingerprintOf`/`gitHead`）；(iii) **`closeChange` 保留 `gitHead` 调用（经 bridge）**——它戳 `revision.after`（change_close 的真特性，不可移除）。DSH/stdio（env.bridge undefined）行为零变（parity 27 PASS 不破坏）。
- **R-003 MUST**：`pushSnapshot(state, bridge: RepoBridge)` 在 `src/session.ts`（use-case，只做 `state.env.bridge = bridge` 赋值）；`mcp/server.ts` 的 `/snapshot` handler 解码 body + 构造 `new SessionCacheBridge(data)`（adapter 层，adapter→infrastructure 允许）+ 调 `pushSnapshot(state, bridge)`。session.ts 只认 `RepoBridge` 接口（不 import SessionCacheBridge 具体类）。
- **R-004 MUST**：向后兼容——parity 27 PASS + 12 套 npm test + ci-contract + tsc 0 全绿（同 session-isolation/dual-side-mode 硬约束）。
- **R-005（已 defer）**：`ToolEnv` 拆 SecurityContext+InfraEnv+Policy **移出本 Action**（ROI 偏低：buildCatalog 单源签名改带 parity 回归风险，收益仅测试性微增；现状测试不卡）。列为非目标，未来独立 Action 再议。
- **R-006 SHOULD**：审计标注的"已知妥协"（engine 直接 node:fs 读写 rootDir 图数据 / catalog 单文件 / edit+template 巨石）在本 README 显式记录为"已知妥协，非本 Action 范围"，防未来误判为"应保持的设计"。

## Proposed design

**F-001 决策（user 授权 (a) 全透传，2026-09-26；R2 纠正 R1 误判）**：store.ts 必传 bridge（全纯）+ validate/edit/**closeChange** 全透传 RepoBridge；closeChange 保留 gitHead（经 bridge）戳 revision.after（无特性丢失）。R1 曾误判 companion.ts:103 gitHead 为 reminder handler 可选戳、提 a-3 移除——R2 实测推翻（该调用在 closeChange，是真特性）→ 重新授权 (a) 全透传。

- **AP-001/002（LocalBridge 上移 + engine 内透传）**：store.ts 三函数签名 `(..., bridge: RepoBridge)` 必传，去 `?? new LocalBridge` + 去 `import LocalBridge`。6 个 evidence 工具 handler（sync/fingerprint 已传；validate/build/module_refresh/change_close 待加）内 `const repoBridge = args.repoRoot ? (env.bridge ?? new LocalBridge(String(args.repoRoot))) : undefined` + 传给 engine 函数。`validateProject`/`buildProject`/`refreshModules`/`closeChange` opts 加 `bridge?: RepoBridge`，engine 内部透传到 `fingerprintOf`/`gitHead`。**`closeChange` 保留 `gitHead(bridge)` 调用**（戳 revision.after，特性不丢）。reminder handler（`createCompanionHandler`，在 adapter 层）本就不调 gitHead，不动。
- **AP-003（pushSnapshot，F-002 修正）**：`src/session.ts` 加 `export function pushSnapshot(state: SessionState, bridge: RepoBridge): void { state.env.bridge = bridge; }`（use-case，只赋值，认 RepoBridge 接口）。`mcp/server.ts` `/snapshot` handler：解码 body → `new SessionCacheBridge(body)`（adapter 构造，允许 adapter→infrastructure）→ `pushSnapshot(state, bridge)`。session.ts 不 import SessionCacheBridge。
- **AP-004（ToolEnv 拆，F-003 defer）**：**移出本 Action**（R-005 defer，非目标）。未来独立 Action 评估 ROI。
- **AP-005（已知妥协记录，R-006）**：本 README Non-goals 节已显式记录（engine node:fs / catalog 单文件 / edit+template 巨石）= 已知妥协。

## Implementation plan

- **AP-001**：store.ts 三函数签名改 `bridge: RepoBridge` 必传 + 去 `import LocalBridge` + 去 `?? new LocalBridge` 兜底。
- **AP-002**：(i) 6 个 evidence 工具 handler（sync/fingerprint 已传；validate/build/module_refresh/change_close 待加）承接 `args.repoRoot ? (env.bridge ?? new LocalBridge(args.repoRoot)) : undefined`；(ii) `validateProject`/`buildProject`/`refreshModules`/`closeChange` opts 加 `bridge?: RepoBridge`，catalog 工具透传；closeChange 内 `gitHead(repoRoot)` → `gitHead(repoRoot, bridge)`（经 bridge，保留 revision.after 戳）。验证 parity 27 PASS + 12 套绿 + companion-snapshot 3 PASS + change_close 回归。
- **AP-003**：`src/session.ts` 加 `pushSnapshot(state, bridge: RepoBridge)`；server.ts `/snapshot` handler 改为构造 SessionCacheBridge + 调 pushSnapshot。验证 dual-side-snapshot 5 PASS。
- **AP-005**：本 README Non-goals 已记已知妥协（R-006 满足）。
- 全程：`npm test` 12 套绿 + parity 27 + ci-contract + tsc 0。

## Acceptance

| ID | Requirement | Observable condition | Planned evidence | Status |
| --- | --- | --- | --- | --- |
| A-001 | R-001 | `grep -n "LocalBridge" src/engine/*.ts` 全空（engine 零具体依赖）；store 三函数签名 `bridge: RepoBridge` 必传 | grep + tsc | pending |
| A-002 | R-002 | 6 个 evidence 工具 handler（sync/fingerprint/validate/build/module_refresh/change_close）内 `args.repoRoot ? (env.bridge ?? new LocalBridge) : undefined`；validateProject/buildProject/refreshModules/closeChange opts 加 `bridge?` 透传；closeChange 保留 `gitHead(bridge)` 戳 revision.after | grep "bridge" src/engine/companion.ts 有 + closeChange 调 `gitHead(repoRoot, bridge)` + parity 27 + mcp-smoke 36 + companion-snapshot 3 | pending |
| A-003 | R-003 | `pushSnapshot(state, bridge: RepoBridge)` 在 session.ts（只赋值）；server.ts `/snapshot` 构造 SessionCacheBridge + 调 pushSnapshot | grep "SessionCacheBridge" src/session.ts 空 + dual-side-snapshot 5 PASS | pending |
| A-004 | R-004 | parity 27 + npm test 12 套 + ci-contract + tsc 0 全绿 | 测试输出 | pending |
| A-005 | R-006 | "已知妥协"清单在本 README 显式记录（Non-goals 节） | grep "已知妥协" | pending |

## Validation

记录计划命令（与实际执行分离）：

- AP-001/002：`grep -n "LocalBridge" src/engine/*.ts`（空）+ `npx tsc --noEmit`（0）+ `node tests/parity-differential.mjs`（27 PASS）+ `npm test`（12 绿）。
- AP-003：`grep -n "SessionCacheBridge" src/mcp/server.ts`（空）+ `node tests/dual-side-snapshot.mjs`（5 PASS）。
- AP-004（若进）：`node tests/session-isolation.mjs`（13 PASS，改后）。
- 全程：`node ci-contract-check.cjs`（绿）。

## Readiness gaps

无（R5 通过，K=3 连续 clean 达成）。Readiness review 记录（R1–R5）：

- **R1**：F-001（medium+ambiguous）— R-001（engine=0 LocalBridge）与 option (b)（部分修 store-only）自相矛盾（(b) 让 validate/edit/companion 仍 import LocalBridge）→ stop+escalate → user 初授权 (c)+a-3。
- **R2**：F-004（critical）— R1 事实错误：`companion.ts:103 gitHead` 误判为 reminder handler 可选戳 → 实测在 `closeChange` 戳 `revision.after`（change_close 真特性，a-3 会静默丢特性）→ re-escalate → user 重新授权 **(a) 全透传**：validate/edit/**closeChange** 全透传 RepoBridge，closeChange 保留 `gitHead(bridge)`。F-004 是关键拦截（避免特性丢失）。同时 auto-fix F-002（AP-003 `pushSnapshot(state, bridge)` 只赋值，SessionCacheBridge 构造留 adapter）+ F-003（AP-004 ToolEnv 拆 defer 独立 Action，R-005 非目标）。
- **R3**：0 medium+（call-site 清单 grep 实证完整：validate.ts:312 + edit.ts:660,690(refreshModules) + companion.ts:103(closeChange) + catalog.ts:886/904/1220(已传) + tests companion-e2e:34(待更新) + dual-side-snapshot:80(已传)，无遗漏；edit.ts:660 在 opts 函数可透传；closeChange 保留 gitHead 经 bridge 戳 revision.after 无特性损失；reminder handler 在 adapter 层不动）→ clean round 1/3。
- **R4**：F-005（low，unambiguous）— R-002(i) 措辞 "catalog resolve 闭包"错（resolve 闭包是 rootDir 项目解析，不碰 repoRoot）；且仅列 sync/fingerprint 2 个，漏 validate/build/module_refresh/change_close 4 个 evidence 工具 handler（bridge 构造真落点）→ auto-fix：R-002(i) 重写为 6 evidence handler + resolve 闭包不动。low 不重置计数器 → clean round 2/3。
- **R5**：0 medium+（patchModule 不调 fingerprintOf/gitHead，R-002(ii) 列 refreshModules 正确；store.ts L13 `import type RepoBridge` 是 port 抽象，依赖反转正确，删 L12 LocalBridge 后零具体 infrastructure；node:fs 为 rootDir 图数据，R-006 已记录妥协；session.ts 不 import SessionCacheBridge，pushSnapshot 只赋值，A-003 一致）→ clean round 3/3 ✅。

**K=3 达成（R3/R4/R5 连续 0 medium+）→ readiness review PASS。** user 2026-09-27 授权 status → `ready`。

## Closure conditions

- 全部 MUST 验收（A-001~A-004）passed；R-005 MAY 满足或显式 defer 独立 Action；R-006 SHOULD 满足。
- parity 27 + 12 套 npm test + ci-contract + tsc 0 全绿（向后兼容硬约束）。
- 持久结论回流：本 README 记录"已知妥协"清单（engine node:fs / catalog 单文件 / edit+template 巨石）。
- 状态、路径、导航、归档一致。
