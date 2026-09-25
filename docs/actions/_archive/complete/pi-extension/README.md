# Pi Extension

- Action: `pi-extension`
- Status: `complete`
- Updated: 2026-09-25
- Status authority: [Action 状态](../../../STATUS.md)
- Design source: [多平台适配设计 §3.2 / §7-S3](../../../../MULTIPLATFORM.zh-CN.md)

## 背景

S0–S2 已交付 catalog + MCP 适配器（DSH / MCP 两入口）。第三个宿主 **pi**（@earendil-works/pi-coding-agent）仍无适配器——catalog 的"跨平台可复用"承诺还差一个验证。pi 扩展 API 与 MCP 不同：工具参数用 **typebox**（`Type.Object`），枚举字段 MUST 用 `StringEnum`（pi 文档：`Type.Union/Type.Literal` 与 Google API 不兼容）；注册经 `pi.registerTool({...})`；扩展为 `export default function (pi: ExtensionAPI)`。catalog 的 `ToolEntry.parameters` 是 JSON Schema（`ObjectSchema`），须**投影**为 typebox。

## 目标

加 `src/pi/normify.ts`（编译到 `lib/pi/normify.js`），实现 **JSON Schema → typebox 投影**（含 `StringEnum`）+ `export default function (pi)` 遍历 `buildCatalog` 注册 31 个工具，`execute` 转调 `ToolEntry.execute`。**证明 catalog 被第三个适配器复用、零工具逻辑重复。**

## 非目标

- SKILL.md 复用 + 各宿主放置说明 → **S4**。
- companion 钩子（计数器 + reminder）迁移 → **S5**。
- `tests/` 接入 `npm test` → **S6**。
- 不改 `src/catalog.ts` / `src/tools.ts` / `src/engine/*` / `src/mcp/`（S0–S2 已稳定，S3 只新增 `src/pi/`）。
- 不改 `ci-contract-check.cjs`（仍读 `lib/catalog.js`）。
- 不加 `bin`/`exports` 入口、不发布（§0）。
- `withFileMutationQueue()`（§3.2 文件变更队列）——pi 单会话串行调工具，并发覆盖风险低；留后续 SHOULD，本 Action 不实现。

## 设计输入与依赖

- **catalog**（S0 产物）：`buildCatalog(env): ToolEntry[]`、`ToolEntry`、`ToolEnv`、`ObjectSchema`、`SchemaNode`。`ToolEntry.parameters` 是编译后 `ObjectSchema`（`toJsonSchema` 已把内联 `required:true` 提升为对象级 `required: string[]`，对象补 `additionalProperties:false`）。
- **pi 扩展 API**（`docs/extensions.md` + `examples/extensions/todo.ts`/`dynamic-tools.ts` 确认）：
  - `export default function (pi: ExtensionAPI)`
  - `pi.registerTool({ name, label, description, promptSnippet?, promptGuidelines?, parameters: Type.Object({...}), async execute(toolCallId, params, signal, onUpdate, ctx) { return { content:[{type:'text',text}], details } } })`
  - typebox：`import { Type } from "typebox"`；`Type.Object`/`Type.String`/`Type.Number`/`Type.Boolean`/`Type.Array`/`Type.Optional`/`Type.Any`
  - `StringEnum([...])` from `@earendil-works/pi-ai`（枚举字段 MUST 用，Google API 兼容）
  - `ExtensionAPI` type from `@earendil-works/pi-coding-agent`
  - **behavior 不映射**：pi 的 `ToolDefinition` 无 annotations 字段（实测 `types.d.ts` 0 处），与 MCP（S2 映射 behavior→readOnlyHint/destructiveHint）不同。`ToolEntry.behavior`（read/write/destroy/idempotent）在 pi 适配器中不使用——pi 无等效提示机制，属平台差异非缺口。
- **schema 类型分布**（grep `src/catalog.ts`）：string×23、number×5、boolean×1、array×9、object×11；`additionalProperties`×3；**0 enum 字段**（StringEnum 投影为前向兼容，单测用合成 enum schema 触发）。
- **tsconfig**（现有）：`include:["src"]`+`rootDir:"src"`+`outDir:"lib"`——`src/pi/normify.ts` 自动编译到 `lib/pi/normify.js`，无需独立 tsconfig。
- **§9 Q3 决断**（本 Action draft 内作出）：pi extension 进本仓库 **`src/pi/normify.ts`**（编译到 `lib/pi/normify.js`，复用主 tsconfig，与 `src/mcp/server.ts` 同构）。§3.2 写的 `pi-extension/` 路径是简写，canonical 源路径为 `src/pi/`。**回流**：Close 时更新 `docs/MULTIPLATFORM.zh-CN.md` §9 Q3 标记 resolved，并修 §3.2 路径为 `src/pi/normify.ts`。
- **依赖**（新加 devDependencies，编译期；运行时由 pi 进程提供）：`@earendil-works/pi-coding-agent`（ExtensionAPI type）、`@earendil-works/pi-ai`（StringEnum runtime）、`typebox`（Type.* runtime）。pi 扩展在 pi 进程内运行，这些 import 运行时解析 pi 的 node_modules；devDeps 仅供 tsc 编译 + 单测。

## 范围与边界

- 新增：`src/pi/normify.ts`（投影函数 + `registerPiTools` + default export）、`tests/pi-projection.mjs`（投影单测）。
- 修改：`package.json`（devDependencies 加 3 个 pi/typebox 包）、`package-lock.json`。
- 不改：`src/catalog.ts`、`src/tools.ts`、`src/engine/*`、`src/mcp/`、`ci-contract-check.cjs`。
- 重建：`lib/pi/normify.js`（+ `.map` + `lib/types/pi/normify.d.ts`）——供单测（A-006 import）+ 构建工件；pi 运行时加载 `src/pi/normify.ts` 源码（pi ts-native，自动发现 .ts glob，F-040）。

## 需求

- R-001 MUST：`src/pi/normify.ts` 经 `import { buildCatalog } from '../catalog.js'` 复用 catalog；不重声明 `register('normify_*')`、不重写工具业务/missing-args/toErrorPayload（已在 `ToolEntry.execute` 内）。
- R-002 MUST：导出 `schemaToTypebox(node: SchemaNode): TSchema` 投影函数，覆盖：`type:'string'`→`Type.String`、`'number'`→`Type.Number`、`'boolean'`→`Type.Boolean`、`'array'`+`items`→`Type.Array(project(items))`、`'object'`+`properties`→`Type.Object({...})`（递归）、`'object'` 无 `properties`→`Type.Any`（free-form）；`enum:[...]`（string 上）→`StringEnum([...])`（前向兼容）；`description` 透传。
- R-003 MUST：导出 `objectSchemaToTypebox(schema: ObjectSchema): TObject`——读对象级 `required: string[]`，属性名在 `required` 内→必填，否则 `Type.Optional`；返回 `Type.Object({...}, { additionalProperties: false })`。
- R-004 MUST：`export default function (pi: ExtensionAPI)` 遍历 `buildCatalog(env)`，对每个 entry 调 `pi.registerTool({ name: entry.name, label: entry.name, description: entry.description, promptSnippet: entry.name（pi 的 description 字段已独立发 LLM，promptSnippet 仅是 Available tools 一级行；27/31 描述 >80 字符，用全描述膨胀 ~6KB 系统提示）, parameters: objectSchemaToTypebox(entry.parameters), execute: async (_id, params) => { const v = await entry.execute(params); return { content:[{type:'text', text: formatResultText(v)}], details: v } } })`。`formatResultText`：字符串原样；对象且 `ok===false`→可读错误文本（简单 `[code] message`，丰富 `summary + errors.join`，镜像 S2 errorText 形状）；其他→`JSON.stringify`。pi 的 `AgentToolResult` 无 `isError` 字段（实测 pi-agent-core），错误经 content 文本传达。
- R-005 MUST：DSH 零回归——`npm test`（5 套 e2e）退出 0、全 PASS（S3 不碰 DSH 路径）。
- R-006 MUST：`tsc --noEmit` 0 错（投影函数 + typebox 类型对真实 pi 包通过）。
- R-007 MUST：`tests/pi-projection.mjs` 单测——(a) 投影：对样本 `ObjectSchema`（含 string/number/boolean/array/object/required/optional）断言投影形状；对合成 `enum:['a','b']` string 字段断言 `.enum` deep-equals `['a','b']` 且 `.type==='string'`（StringEnum 运行时形状，非 anyOf）；(b) `formatResultText` 4 形状：简单错误 `{ok:false,error:{code,message}}`→`[code] message`、丰富错误 `{ok:false,errors[],summary}`→`summary+errors.join`、字符串成功原样、对象成功→JSON；退出 0。
- R-008 MUST：`npm run build` 产出 `lib/pi/normify.js`。
- R-009 SHOULD：手动加载到 pi（软链 `src/pi/normify.ts` 到 `~/.pi/agent/extensions/normify.ts`，pi 自动发现 .ts glob；或 `pi -e ./src/pi/normify.ts`），`/reload` 后 31 个工具可见、call 一个只读工具（`normify_help topic=tools`）成功；若测试环境无 pi，降为代码审查 + 投影单测兑底，记豁免。
- R-010 SHOULD：§6-1 契约不变——`ci-contract-check.cjs` 仍读 `lib/catalog.js`（S3 不碰 catalog），S3 新增的 `lib/pi/normify.js` 不被该脚本扫，脚本仍 exit 0。

## 提议设计

### JSON Schema → typebox 投影

```ts
import { Type, type TSchema, type TObject } from 'typebox';
import { StringEnum } from '@earendil-works/pi-ai';
import type { ObjectSchema, SchemaNode } from '../catalog.js';

// 节点级投影（递归）
export function schemaToTypebox(node: SchemaNode): TSchema {
    if (Array.isArray(node)) return Type.Any(); // SchemaValue[] 兜底（不应出现在 properties 值）
    const t = node.type;
    if (t === 'string') {
        // enum:[...]（前向兼容；当前 catalog 0 enum，单测合成触发）
        if (Array.isArray(node.enum) && node.enum.length > 0)
            return StringEnum(node.enum as [string, ...string[]]);
        return Type.String({ description: node.description });
    }
    if (t === 'number') return Type.Number({ description: node.description });
    if (t === 'boolean') return Type.Boolean({ description: node.description });
    if (t === 'array') return Type.Array(node.items ? schemaToTypebox(node.items) : Type.Any(), { description: node.description });
    if (t === 'object') {
        if (node.properties) return objectSchemaToTypebox(node as ObjectSchema);
        return Type.Any({ description: node.description }); // freeObjectParam：无 properties 的自由对象
    }
    return Type.Any(); // 未知 type 兜底
}

// 对象级投影：对象级 required:string[] → 必填/可选
export function objectSchemaToTypebox(schema: ObjectSchema): TObject {
    const props: Record<string, TSchema> = {};
    const required = new Set(schema.required ?? []);
    for (const [key, sub] of Object.entries(schema.properties ?? {})) {
        const projected = schemaToTypebox(sub);
        props[key] = required.has(key) ? projected : Type.Optional(projected);
    }
    return Type.Object(props, { additionalProperties: false });
}
```

### registerPiTools + default export

```ts
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { buildCatalog } from '../catalog.js';
import type { ToolEnv } from '../catalog.js';

export function registerPiTools(pi: ExtensionAPI, env: ToolEnv): void {
    const catalog = buildCatalog(env);
    for (const entry of catalog) {
        pi.registerTool({
            name: entry.name,
            label: entry.name,
            description: entry.description,
            promptSnippet: entry.name,
            parameters: objectSchemaToTypebox(entry.parameters),
            async execute(_toolCallId, params) {
                const value = await entry.execute(params as Record<string, unknown>);
                // pi 的 AgentToolResult 无 isError 字段（实测 pi-agent-core），错误经 content 文本传达
                return {
                    content: [{ type: 'text', text: formatResultText(value) }],
                    details: value,
                };
            },
        });
    }
}

// 错误载荷 → 可读文本（镜像 S2 errorText 形状）；成功 → 字符串原样 / 对象 JSON
export function formatResultText(value: unknown): string {
    if (typeof value === 'string') return value;
    if (typeof value === 'object' && value !== null && (value as { ok?: unknown }).ok === false) {
        const e = value as { error?: { code?: string; message?: string }; errors?: { code?: string; message?: string }[]; summary?: string };
        if (e.error) return `[${e.error.code ?? '?'}] ${e.error.message ?? ''}`;
        if (Array.isArray(e.errors)) {
            const head = e.summary ? e.summary + '\n' : '';
            return head + e.errors.map(x => `[${x.code ?? '?'}] ${x.message ?? ''}`).join('\n');
        }
    }
    return JSON.stringify(value, null, 2);
}

// env 来源：ExtensionAPI 无 cwd 字段（实测 types.d.ts），rootDir 从环境变量读（与 MCP 同源）
export default function (pi: ExtensionAPI): void {
    const env: ToolEnv = {
        rootDir: process.env.NORMIFY_ROOT_DIR ?? process.cwd(),
        requireBilingual: (process.env.NORMIFY_REQUIRE_BILINGUAL ?? '1') !== '0',
    };
    registerPiTools(pi, env);
}
```

### 投影单测

`tests/pi-projection.mjs`：import `schemaToTypebox`/`objectSchemaToTypebox` from `lib/pi/normify.js`；对样本 `{type:'object', properties:{name:{type:'string'}, count:{type:'number'}, flag:{type:'boolean'}, items:{type:'array', items:{type:'string'}}, meta:{type:'object', properties:{...}}}, required:['name']}` 断言：`name` 必填、`count` Optional、`items` 为 array、`meta` 为 object；对合成 `{type:'string', enum:['a','b']}` 断言投影 `.enum` deep-equals `['a','b']` 且 `.type==='string'`（StringEnum 运行时形状 = `{type:'string',enum:[...]}`，非 anyOf——实测 pi nested pi-ai 确认）。退出 0。

## 实施计划

- P-001：`package.json` devDependencies 加 `@earendil-works/pi-coding-agent`、`@earendil-works/pi-ai`、`typebox`（钉版本）；`npm install`。
- P-002：写 `src/pi/normify.ts`（`schemaToTypebox` + `objectSchemaToTypebox` + `registerPiTools` + default export）。
- P-003：写 `tests/pi-projection.mjs`（投影单测，含 enum 合成）。
- P-004：`npm run build` → 验证 `lib/pi/normify.js` 产出。
- P-005：跑 validation 全链（见 Validation 节）；记录证据。
- P-006：不接入 `npm test`（S6 职责）；不提交直到授权。

## 验收

| ID | Requirement | 可观察条件 | 计划证据 | Status |
| --- | --- | --- | --- | --- |
| A-001 | R-001 | `src/pi/normify.ts` import `buildCatalog` 且无 `register('normify_*')` 字面量 | `grep "import { buildCatalog } from '../catalog.js'" src/pi/normify.ts` 命中且 `grep -c "register('normify" src/pi/normify.ts` = 0 | pass |
| A-002 | R-002/R-003 | 投影函数导出 + 类型检查通过 | `tsc --noEmit` 退出 0（投影对真实 pi/typebox 包） | pass |
| A-003 | R-004 | default export 注册 31 工具（经 buildCatalog） | `grep -c 'pi.registerTool' src/pi/normify.ts` ≥1 且 `grep 'objectSchemaToTypebox(entry.parameters)' src/pi/normify.ts` 命中 | pass |
| A-004 | R-005 | DSH 零回归 | `npm test` 退出 0，5 套 `=== 结果：全部 PASS ===` | pass |
| A-005 | R-006 | 类型检查通过 | `tsc --noEmit` 退出 0 | pass |
| A-006 | R-007 | 投影+formatResultText 单测全过 | `node tests/pi-projection.mjs` 退出 0；stdout 含 PASS 行（投影 7 形状 + enum + formatResultText 4 形状） | pass |
| A-007 | R-008 | build 产出 `lib/pi/normify.js` | `test -f lib/pi/normify.js` 退出 0 | pass |
| A-008 | R-009 | 手动 pi 加载（SHOULD） | 软链 `src/pi/normify.ts` 到 `~/.pi/agent/extensions/normify.ts` + `/reload` + 31 工具可见 + call normify_help 成功；或记录豁免（模块解析失败，见 G-003） | pass |
| A-009 | R-010 | 契约检查不受 S3 影响 | `node ci-contract-check.cjs` 退出 0，输出 `bundle + tool-name contract ok` | pass |

## Validation

计划命令（实际结果待执行）：

```bash
# 与 S0/S1/S2 验证链对齐：install → build → tsc → test → 投影单测 → contract → 静态断言
npm install                       # P-001：装 pi-coding-agent/pi-ai/typebox devDeps
npm run build                     # P-004/A-007：产出 lib/pi/normify.js
npx tsc -p tsconfig.json --noEmit # A-002/A-005：0 错（投影类型对真实包）
npm test                          # A-004：5 套 DSH e2e 全 PASS（零回归）
node tests/pi-projection.mjs      # A-006：投影（含 enum→StringEnum）+ formatResultText 4 形状
node ci-contract-check.cjs        # A-009（R-010）：契约检查不受 S3 影响

# 静态断言（A-001/A-003）
grep "import { buildCatalog } from '../catalog.js'" src/pi/normify.ts   # A-001 命中
grep -c "register('normify" src/pi/normify.ts                            # A-001 = 0
grep -c 'pi.registerTool' src/pi/normify.ts                              # A-003 ≥1
git diff --stat src/engine/ src/catalog.ts src/tools.ts src/mcp/         # 为空（S3 只新增 src/pi/）
```

**实际执行结果（2026-09-25，feat/catalog 分支）**：

```text
# P-001 install
$ npm install            # added 201 packages, exit 0
# typebox@1.3.7 / @earendil-works/pi-ai@0.87.1 / @earendil-works/pi-coding-agent@0.87.1 installed

# A-002/A-005 tsc
$ npx tsc -p tsconfig.json --noEmit   # EXIT 0（0 错）

# A-004 npm test (DSH 零回归)
$ npm test              # 5 套 e2e 全 === 结果：全部 PASS ===，EXIT 0

# A-006 投影+formatResultText 单测
$ node tests/pi-projection.mjs   # 26 PASS, 0 FAIL，EXIT 0
  （string/number/boolean/array/object/required/optional/enum→{type:'string',enum:[...]} + formatResultText 4 形状）

# A-007 build
$ npm run build         # EXIT 0；lib/pi/normify.js (4596B) + lib/types/pi/normify.d.ts (1626B)

# A-009 contract
$ node ci-contract-check.cjs    # bundle + tool-name contract ok，EXIT 0

# A-001/A-003 静态断言
$ grep "import { buildCatalog } from '../catalog.js'" src/pi/normify.ts   # 命中
$ grep -c "register('normify" src/pi/normify.ts                           # 0
$ grep -c 'pi.registerTool' src/pi/normify.ts                             # 2（≥1）
$ git diff --stat src/engine/ src/catalog.ts src/tools.ts src/mcp/        # 空（S3 只新增 src/pi/）

# A-008 headless pi 加载模拟（SHOULD，模块解析+31 工具+真实投影+execute）
$ node -e "..." (registerPiTools + mock pi + call normify_help)
  # 31 tools registered, all normify_*, all TObject+additionalProperties=false
  # normify_help execute({topic:'tools'}) -> content[0].text 含 'tools'，EXIT 0
```

A-008 说明：headless 模拟（mock pi.registerTool 收集 31 def + 调 normify_help execute）验证了模块解析、buildCatalog 产出 31 entry、真实 catalog schema 经 objectSchemaToTypebox 全部产出有效 TObject、execute 转调 entry.execute 返回 AgentToolResult 形状。交互 `/reload`+LLM call 需人驱 pi 会话，headless 已覆盖核心。

## Readiness gaps

- **G-001**（已确认）：3 包均在 npm——`@earendil-works/pi-coding-agent` 0.87.1、`@earendil-works/pi-ai` 0.87.1、`typebox` 1.3.34（pi 运行时用 typebox 1.3.7）。P-001 devDeps 钉版本匹配 pi 运行时（`@earendil-works/*` ^0.87.1、`typebox` ^1.3.7）。`import { Type } from 'typebox'`、`import { StringEnum } from '@earendil-works/pi-ai'`、`import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'` 均可装可编译。
- **G-002**（已确认）：`ExtensionAPI` 接口（`dist/core/extensions/types.d.ts`）**无 `cwd` 字段**——`cwd` 在 `CreateAgentSessionOptions`（SDK 会话创建），不在扩展 API。rootDir 从 `process.env.NORMIFY_ROOT_DIR ?? process.cwd()` 读（与 MCP 同源），设计已去除误导性 cast。
- **G-003**：A-008 手动 pi 加载——测试环境**有 pi**（pi 正运行本 agent），A-008 应尝试执行（软链 `src/pi/normify.ts` 到 `~/.pi/agent/extensions/normify.ts`，pi 自动发现 .ts glob 非 .js；`/reload`，call `normify_help`）。pi 进程的 node_modules 解析 `typebox`（pi 1.3.7）+ `@earendil-works/pi-ai`（pi nested）；`ExtensionAPI` 为 type-only import（运行时擦除）；`import { buildCatalog } from '../catalog.js'` 经 pi ts resolver 解析到 `src/catalog.ts`。仅当模块解析失败时降豁免（投影单测 A-006 + tsc A-002 兑底）；不阻塞 MUST。
- **G-004**（已确认）：`StringEnum` 运行时形状 = `{type:'string', enum:[...]}`（Round 1 实测 pi nested pi-ai，无 `.anyOf`）。catalog 当前 0 enum，投影代码路径存在但无 runtime 触发；单测用合成 `{type:'string', enum:['a','b']}` 断言 `.enum` deep-equals。断言已对齐实测形状，无兜底需要。

## Closure conditions

- 全部 MUST 验收（A-001..A-007）通过并记录证据。
- A-008（SHOULD）通过或记录豁免（G-003）；A-009（SHOULD，R-010）通过：契约检查不受 S3 影响。
- §9 Q3 已决断并回流动 ✅：[MULTIPLATFORM.zh-CN.md](../../../../MULTIPLATFORM.zh-CN.md) §9 Q3 标记 resolved，§3.2 L135 + §7-S3 L251 + §9 Q3 L276 路径已修为 `src/pi/normify.ts`（含 .ts glob 自动发现说明）。
- 状态、路径、导航一致；本 Action 归档前 `STATUS.md` 更新为 `complete`。
- **提交完整性**：实施 commit 须含 `npm run build` 重建的 `lib/pi/normify.js`（+ `.map` + `lib/types/pi/normify.d.ts`）+ `src/pi/normify.ts` + `tests/pi-projection.mjs` + `package.json`（devDeps）+ `package-lock.json`。
- **失败回退**：本次实施作为单 commit 原子提交；任一验收不过即 `git revert` + `npm install` 复位依赖。
