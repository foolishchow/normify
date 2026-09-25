// MCP server (stdio)：把 normify catalog 暴露给 Claude / Cursor / Codex 等宿主。
// 平台无关：直接复用 buildCatalog + ToolEntry.execute（不重声明工具、不重裹 execute）。
// ToolEnv 从环境变量读：NORMIFY_ROOT_DIR（默认 cwd）、NORMIFY_REQUIRE_BILINGUAL（默认 '1'→true）。
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { buildCatalog } from '../catalog.js';
import { companionReminder, parseCompanionConfig } from '../companion.js';
const env = {
    rootDir: process.env.NORMIFY_ROOT_DIR ?? process.cwd(),
    requireBilingual: (process.env.NORMIFY_REQUIRE_BILINGUAL ?? '1') !== '0',
};
const catalog = buildCatalog(env);
// §5.1 S5 companion 提醒钩子（MCP behavior 代理）：MCP server 仅见自身 normify_* 调用，
// 无法跨进程监听外部编辑器写；改用 ToolEntry.behavior !== 'read' 代理（语义不同于 DSH/pi）。
// 计 attempt（达阈值即重置 count=0，镜像 DSH L72 在 nextFn 前）；仅 !isError 时注入 reminder 段。
const companionConfig = parseCompanionConfig(process.env);
let companionCount = 0;
// §3.1 behavior → MCP annotations 映射：read/idempotent→readOnlyHint:true、write→readOnlyHint:false、destroy→destructiveHint:true
function annotationsFor(behavior) {
    switch (behavior) {
        case 'read': return { readOnlyHint: true };
        case 'idempotent': return { readOnlyHint: true }; // §3.1：幂等视为只读
        case 'write': return { readOnlyHint: false }; // 显式对齐 §3.1（MCP 默认 false，省略等价）
        case 'destroy': return { destructiveHint: true };
    }
}
// {ok:false} 错误载荷 → 模型可读文本（非裸 JSON）
// 简单形状 {error:{code,message}} → '[code] message'
// 富形状 {errors[],summary?,warnings?,hint?} → summary + errors.join('\n') [+ warnings/hint]
// 防御：既无 error 又无 errors（当前 31 工具不存在，契约 unknown 兜底）→ JSON.stringify
function errorText(value) {
    if (value.error)
        return `[${value.error.code}] ${value.error.message}`;
    if (value.errors?.length) {
        // 仅当 summary 真值才入列（7/13 富错误无 summary，避免前导空行）
        const parts = [];
        if (value.summary)
            parts.push(value.summary);
        parts.push(value.errors.join('\n'));
        if (value.warnings?.length)
            parts.push('[warnings] ' + value.warnings.join(', '));
        if (value.hint)
            parts.push('[hint] ' + value.hint);
        return parts.join('\n');
    }
    return JSON.stringify(value, null, 2);
}
// tsconfig 无 resolveJsonModule → 用 readFileSync 读版本（lib/mcp/server.js → ../../package.json）
const version = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version;
const server = new Server({ name: 'normify', version }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: catalog.map(e => ({ name: e.name, description: e.description, inputSchema: e.parameters, annotations: annotationsFor(e.behavior) })),
}));
server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const entry = catalog.find(e => e.name === req.params.name);
    if (!entry)
        return { content: [{ type: 'text', text: `未知工具：${req.params.name}` }], isError: true };
    const value = await entry.execute(req.params.arguments ?? {});
    // ToolEntry.execute 是 wrapped（不抛业务错）：返 {ok:true,...} | {ok:false,error} | string | 对象
    // isError 仅当「对象且 ok===false」；字符串/无 ok 字段的对象视为成功（避免把字符串结果误判为 error）。
    // 当前 31 工具全返 {ok:...} 对象，但契约是 Promise<unknown>，精确判定不依赖该隐式不变量。
    // §3.1「execute 抛错时 isError」在 wrapped 世界即 ok===false（ToolEntry.execute 不抛、catch 经 toErrorPayload 返 {ok:false}）
    const isError = typeof value === 'object' && value !== null && value.ok === false;
    const content = [{ type: 'text', text: isError ? errorText(value) : (typeof value === 'string' ? value : JSON.stringify(value, null, 2)) }];
    // §5.1 S5 companion：companionConfig.enabled && behavior!=='read' → ++count → 达阈值重置 + 仅 !isError 时 push reminder
    if (companionConfig.enabled && entry.behavior !== 'read') {
        companionCount++;
        if (companionCount >= companionConfig.threshold) {
            companionCount = 0;
            if (!isError)
                content.push({ type: 'text', text: companionReminder(companionConfig.threshold) });
        }
    }
    return {
        content,
        isError,
    };
});
// main guard：smoke 可能用相对路径 spawn，resolve(argv[1]) 对齐 fileURLToPath(import.meta.url) 的绝对路径
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const transport = new StdioServerTransport();
    await server.connect(transport);
}
//# sourceMappingURL=server.js.map