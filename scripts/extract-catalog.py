#!/usr/bin/env python3
"""Mechanical extraction: tools.ts -> catalog.ts + thin tools.ts (DSH adapter).
Implements Action catalog-extraction P-001..P-006."""
import pathlib, re, sys

SRC = pathlib.Path('src/tools.ts')
text = SRC.read_text(encoding='utf-8')

# --- section markers (by unique strings) ---
I_TOOL_ENV   = text.index('export interface ToolEnv {')
I_TOOLSERVICE_CMT = text.index('/** dsh-tools 服务的注册面')
I_PROJECTARGS_CMT = text.index('/** 结构数据项目定位')
I_STR_FN     = text.index('function str(description: string): SchemaNode {')
I_REGISTERTOOLS = text.index('export function registerTools(ctx: Context, env: ToolEnv): void {')

imports_block = text[:I_TOOL_ENV]            # lines 1.. before ToolEnv
move_types    = text[I_TOOL_ENV:I_TOOLSERVICE_CMT]   # ToolEnv..ToolDef
stay_types    = text[I_TOOLSERVICE_CMT:I_PROJECTARGS_CMT]  # ToolService..ToolRegistration
arg_ifaces    = text[I_PROJECTARGS_CMT:I_STR_FN]      # ProjectArgs..TreeSnapshot
helpers_block = text[I_STR_FN:I_REGISTERTOOLS]        # 21 helpers
register_body = text[I_REGISTERTOOLS:]                # export function registerTools...EOF

# --- build catalog.ts imports (drop cordis) ---
imp_lines = imports_block.split('\n')
# remove the cordis type import line and the blank line around it
catalog_imports = []
skip_blank_after_cordis = False
for ln in imp_lines:
    if "@deepseek-ai/cordis" in ln:
        skip_blank_after_cordis = True
        continue
    if skip_blank_after_cordis and ln.strip() == '':
        skip_blank_after_cordis = False
        continue
    skip_blank_after_cordis = False
    catalog_imports.append(ln)
catalog_imports = '\n'.join(catalog_imports).rstrip() + '\n'

# --- ToolEntry interface (new) ---
tool_entry = (
    "\n/** 平台无关工具目录条目：DSH / MCP / pi 三适配层共享。 */\n"
    "export interface ToolEntry {\n"
    "    name: string;\n"
    "    description: string;\n"
    "    behavior: ToolBehavior;\n"
    "    parameters: ObjectSchema;\n"
    "    // wrapped 版：先校验必填参数缺失（读 parameters.required，parent 允许显式 null），\n"
    "    // 抛错/业务错误经 toErrorPayload 转 {ok:false,error:{code,message}}，再调原业务函数。\n"
    "    // platform-agnostic —— 各适配器直接用，不重裹。\n"
    "    execute: (args: Record<string, unknown>) => Promise<unknown>;\n"
    "}\n"
)

# --- transform register body into buildCatalog ---
body = register_body
# 1. signature
body = body.replace(
    'export function registerTools(ctx: Context, env: ToolEnv): void {',
    'export function buildCatalog(env: ToolEnv): ToolEntry[] {', 1)
# 2. toolCatalog local -> catalog
body = body.replace(
    '    const toolCatalog: ToolCatalogEntry[] = [];',
    '    const catalog: ToolEntry[] = [];', 1)

# 3. replace the whole register local with the new version (push ToolEntry, no tools.register)
OLD_REGISTER_LOCAL = """    const register = <A>(key: string, def: ToolDef, execute: (args: A) => Promise<unknown>): void => {
        toolCatalog.push({ name: key, description: def.description, behavior: def.behavior, parameters: def.parameters });
        const tools = (ctx as unknown as { tools?: ToolService }).tools;
        if (tools === undefined || tools.register === undefined)
            return;
        const behavior = def.behavior;
        const wrapped = async (rawArgs: unknown): Promise<unknown> => {
            try {
                const args = (rawArgs ?? {}) as Record<string, unknown>;
                const required = def.parameters?.required ?? [];
                // `parent` 允许显式 null（根模块）；其余必填参数不允许 null/空串。
                const missing = required.filter(r => {
                    const value = args[r];
                    if (value === undefined || value === '')
                        return true;
                    if (value === null)
                        return r !== 'parent';
                    return false;
                });
                if (missing.length > 0) {
                    return { ok: false, error: { code: 'args/missing', message: '缺少必填参数: ' + missing.join(', ') } };
                }
                return await execute(args as A);
            }
            catch (error) {
                return toErrorPayload(error);
            }
        };
        tools.register({
            ...def,
            name: key,
            behavior,
            // 旧版行为标记保留（文档/兼容），新版 dsh 0.1.5+ 不再读取这三个字段。
            readOnly: behavior === 'read',
            idempotent: behavior === 'read' || behavior === 'idempotent' || behavior === 'destroy',
            destructive: behavior === 'destroy',
            output: {
                schema: {},
                render: (_args, value) => [
                    { type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) },
                ],
            },
            execute: wrapped,
            // 只读工具可被 dsh 0.1.5+ 的并发调度器并行调用；写工具保持独占。
            ...(behavior === 'read' ? { isConcurrencySafe: () => true } : {}),
        });
    };"""

NEW_REGISTER_LOCAL = """    const register = <A>(key: string, def: ToolDef, execute: (args: A) => Promise<unknown>): void => {
        const behavior = def.behavior;
        const wrapped = async (rawArgs: unknown): Promise<unknown> => {
            try {
                const args = (rawArgs ?? {}) as Record<string, unknown>;
                const required = def.parameters?.required ?? [];
                // `parent` 允许显式 null（根模块）；其余必填参数不允许 null/空串。
                const missing = required.filter(r => {
                    const value = args[r];
                    if (value === undefined || value === '')
                        return true;
                    if (value === null)
                        return r !== 'parent';
                    return false;
                });
                if (missing.length > 0) {
                    return { ok: false, error: { code: 'args/missing', message: '缺少必填参数: ' + missing.join(', ') } };
                }
                return await execute(args as A);
            }
            catch (error) {
                return toErrorPayload(error);
            }
        };
        catalog.push({ name: key, description: def.description, behavior, parameters: def.parameters!, execute: wrapped });
    };"""

assert OLD_REGISTER_LOCAL in body, "register local block not found verbatim"
body = body.replace(OLD_REGISTER_LOCAL, NEW_REGISTER_LOCAL, 1)

# 4. normify_help self-reference: toolCatalog -> catalog (3 spots)
body = body.replace('toolCatalog.find', 'catalog.find')
body = body.replace('toolCatalog.length', 'catalog.length')
body = body.replace('topicReference(topic, toolCatalog)', 'topicReference(topic, catalog)')
assert 'toolCatalog' not in body, f"toolCatalog still present: {[l for l in body.split(chr(10)) if 'toolCatalog' in l]}"

# 5. add `return catalog;` before final closing brace
# the body ends with:  ...\n}\n  (the function's closing brace)
# find the last '}' which closes buildCatalog
body = body.rstrip()
if body.endswith('}'):
    body = body[:-1].rstrip() + '\n    return catalog;\n}\n'
else:
    body = body + '\n    return catalog;\n'

# --- assemble catalog.ts ---
catalog_ts = (
    catalog_imports + '\n' +
    move_types.rstrip() + '\n' +
    tool_entry + '\n' +
    arg_ifaces.rstrip() + '\n' +
    helpers_block.rstrip() + '\n' +
    body
)
# ensure single trailing newline
catalog_ts = catalog_ts.rstrip() + '\n'

# --- assemble new tools.ts (thin DSH adapter) ---
NEW_TOOLS = '''import { buildCatalog } from './catalog.js';
import type { ToolEntry, ToolEnv } from './catalog.js';
import type { Context } from '@deepseek-ai/cordis';

''' + stay_types.rstrip() + '''

/** DSH 适配器：遍历 buildCatalog 产出的 ToolEntry，补 DSH 专属字段后注册。
 *  execute 直接用 entry.execute（已含 missing-args + toErrorPayload，platform-agnostic）。 */
export function registerTools(ctx: Context, env: ToolEnv): void {
    const catalog = buildCatalog(env);
    const tools = (ctx as unknown as { tools?: ToolService }).tools;
    if (tools === undefined || tools.register === undefined)
        return;
    for (const entry of catalog) {
        const behavior = entry.behavior;
        tools.register({
            ...entry,
            readOnly: behavior === 'read',
            idempotent: behavior === 'read' || behavior === 'idempotent' || behavior === 'destroy',
            destructive: behavior === 'destroy',
            output: {
                schema: {},
                render: (_args, value) => [
                    { type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) },
                ],
            },
            ...(behavior === 'read' ? { isConcurrencySafe: () => true } : {}),
        });
    }
}
'''

# --- write ---
pathlib.Path('src/catalog.ts').write_text(catalog_ts, encoding='utf-8')
SRC.write_text(NEW_TOOLS.strip() + '\n', encoding='utf-8')

# --- report ---
n_reg_normify = catalog_ts.count("register('normify_")
n_reg = catalog_ts.count("register('")
print(f"catalog.ts: {len(catalog_ts.splitlines())} lines")
print(f"tools.ts:   {len(NEW_TOOLS.splitlines())} lines")
print(f"catalog imports cordis? {'@deepseek-ai/cordis' in catalog_ts}")
print(f"tools register calls in catalog.ts (register('normify_): {n_reg_normify}")
print(f"register(' in catalog.ts: {n_reg}")
