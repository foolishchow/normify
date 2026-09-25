// MCP server (stdio)：把 normify catalog 暴露给 Claude / Cursor / Codex 等宿主。
// 平台无关：直接复用 buildCatalog + ToolEntry.execute（不重声明工具、不重裹 execute）。
// ToolEnv 从环境变量读：NORMIFY_ROOT_DIR（默认 cwd）、NORMIFY_REQUIRE_BILINGUAL（默认 '1'→true）。
// session-isolation：经 SessionManager（src/session.ts）建 1 stdio session（固定 id），
//   catalog/companionCount 改 per-session（堵多用户共享 bug）；userScope 经 token 注入（auth 脚手架）。
//   http 多 session 复用同一 SessionManager（dual-side-mode DP2）。
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { buildCatalog } from '../catalog.js';
import type { ToolBehavior, ToolEnv } from '../catalog.js';
import { companionReminder } from '../companion.js';
import { SessionManager, STDIO_SESSION_ID, createSessionState, parseAuthConfig } from '../session.js';

// 服务器级配置（非 per-session）：rootDir base + requireBilingual + authConfig + companionEnv
const baseEnv: ToolEnv = {
    rootDir: process.env.NORMIFY_ROOT_DIR ?? process.cwd(),
    requireBilingual: (process.env.NORMIFY_REQUIRE_BILINGUAL ?? '1') !== '0',
};
const authConfig = parseAuthConfig(process.env);

// session-isolation：SessionManager（stdio 1 session / http N session 同形状）
const sessionManager = new SessionManager();
// stdio：synthesize 1 固定 session（MCP stdio 协议无 session-id；单连接）。token 经 env 注入（scaffolding）。
const stdioState = createSessionState(STDIO_SESSION_ID, baseEnv, process.env.NORMIFY_SERVER_TOKEN, authConfig);
sessionManager.create(stdioState);

// §3.1 behavior → MCP annotations 映射：read/idempotent→readOnlyHint:true、write→readOnlyHint:false、destroy→destructiveHint:true
function annotationsFor(behavior: ToolBehavior): ToolAnnotations {
    switch (behavior) {
        case 'read': return { readOnlyHint: true };
        case 'idempotent': return { readOnlyHint: true };   // §3.1：幂等视为只读
        case 'write': return { readOnlyHint: false };       // 显式对齐 §3.1（MCP 默认 false，省略等价）
        case 'destroy': return { destructiveHint: true };
    }
}

// {ok:false} 错误载荷 → 模型可读文本（非裸 JSON）
// 简单形状 {error:{code,message}} → '[code] message'
// 富形状 {errors[],summary?,warnings?,hint?} → summary + errors.join('\n') [+ warnings/hint]
// 防御：既无 error 又无 errors（当前 31 工具不存在，契约 unknown 兜底）→ JSON.stringify
function errorText(value: { error?: { code: string; message: string }; errors?: string[]; warnings?: string[]; summary?: string; hint?: string }): string {
    if (value.error) return `[${value.error.code}] ${value.error.message}`;
    if (value.errors?.length) {
        // 仅当 summary 真值才入列（7/13 富错误无 summary，避免前导空行）
        const parts: string[] = [];
        if (value.summary) parts.push(value.summary);
        parts.push(value.errors.join('\n'));
        if (value.warnings?.length) parts.push('[warnings] ' + value.warnings.join(', '));
        if (value.hint) parts.push('[hint] ' + value.hint);
        return parts.join('\n');
    }
    return JSON.stringify(value, null, 2);
}

// tsconfig 无 resolveJsonModule → 用 readFileSync 读版本（lib/mcp/server.js → ../../package.json）
const version = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version;
const server = new Server({ name: 'normify', version }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => {
    const state = sessionManager.get(STDIO_SESSION_ID)!;
    return { tools: state.catalog.map(e => ({ name: e.name, description: e.description, inputSchema: e.parameters, annotations: annotationsFor(e.behavior) })) };
});

server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const state = sessionManager.get(STDIO_SESSION_ID)!;
    const entry = state.catalog.find(e => e.name === req.params.name);
    if (!entry) return { content: [{ type: 'text', text: `未知工具：${req.params.name}` }], isError: true };
    const value = await entry.execute(req.params.arguments ?? {});
    // ToolEntry.execute 是 wrapped（不抛业务错）：返 {ok:true,...} | {ok:false,error} | string | 对象
    // isError 仅当「对象且 ok===false」；字符串/无 ok 字段的对象视为成功（避免把字符串结果误判为 error）。
    const isError = typeof value === 'object' && value !== null && (value as { ok?: unknown }).ok === false;
    const content = [{ type: 'text' as const, text: isError ? errorText(value as Parameters<typeof errorText>[0]) : (typeof value === 'string' ? value : JSON.stringify(value, null, 2)) }];
    // §5.1 S5 companion（session-isolation：per-session 计数）：companionConfig.enabled && behavior!=='read' → ++count → 达阈值重置 + 仅 !isError 时 push reminder
    if (state.companionConfig.enabled && entry.behavior !== 'read') {
        state.companionCount++;
        if (state.companionCount >= state.companionConfig.threshold) {
            state.companionCount = 0;
            if (!isError) content.push({ type: 'text', text: companionReminder(state.companionConfig.threshold) });
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
