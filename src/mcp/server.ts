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
import type { ToolEnv } from '../catalog.js';

const env: ToolEnv = {
    rootDir: process.env.NORMIFY_ROOT_DIR ?? process.cwd(),
    requireBilingual: (process.env.NORMIFY_REQUIRE_BILINGUAL ?? '1') !== '0',
};
const catalog = buildCatalog(env);
// tsconfig 无 resolveJsonModule → 用 readFileSync 读版本（lib/mcp/server.js → ../../package.json）
const version = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version;
const server = new Server({ name: 'normify', version }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: catalog.map(e => ({ name: e.name, description: e.description, inputSchema: e.parameters })),
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const entry = catalog.find(e => e.name === req.params.name);
    if (!entry) return { content: [{ type: 'text', text: `未知工具：${req.params.name}` }], isError: true };
    const value = await entry.execute(req.params.arguments ?? {});
    // ToolEntry.execute 是 wrapped（不抛业务错）：返 {ok:true,...} | {ok:false,error} | string | 对象
    // isError 仅当「对象且 ok===false」；字符串/无 ok 字段的对象视为成功（避免把字符串结果误判为 error）。
    // 当前 31 工具全返 {ok:...} 对象，但契约是 Promise<unknown>，精确判定不依赖该隐式不变量。
    const isError = typeof value === 'object' && value !== null && (value as { ok?: unknown }).ok === false;
    return {
        content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }],
        isError,
    };
});

// main guard：smoke 可能用相对路径 spawn，resolve(argv[1]) 对齐 fileURLToPath(import.meta.url) 的绝对路径
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const transport = new StdioServerTransport();
    await server.connect(transport);
}
