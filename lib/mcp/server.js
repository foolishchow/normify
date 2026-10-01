// MCP server：把 normify catalog 暴露给 Claude / Cursor / Codex / pi 等宿主。
// 平台无关：直接复用 buildCatalog + ToolEntry.execute（不重声明工具、不重裹 execute）。
// InfraEnv/Policy 从环境变量读：NORMIFY_ROOT_DIR（默认 cwd）、NORMIFY_REQUIRE_BILINGUAL（默认 '1'→true）。
// session-isolation：经 SessionManager（src/session.ts）建 session，catalog/companionCount per-session。
// dual-side-mode DP2：NORMIFY_TRANSPORT=stdio（默认，1 session）| http（StreamableHTTPServerTransport，
//   stateful transport-per-session，每会话独立 Server + SessionState，多 agent 连同一 server）。
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { readFileSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { companionReminder } from '../companion.js';
import { SessionManager, STDIO_SESSION_ID, createSessionState, parseAuthConfig, pushSnapshot } from '../session.js';
import { SessionCacheBridge } from '../bridge.js';
// 服务器级配置（非 per-session）：rootDir base + requireBilingual + authConfig
const baseInfra = {
    rootDir: process.env.NORMIFY_ROOT_DIR ?? process.cwd(),
};
const basePolicy = {
    requireBilingual: (process.env.NORMIFY_REQUIRE_BILINGUAL ?? '1') !== '0',
};
const authConfig = parseAuthConfig(process.env);
const version = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version;
const sessionManager = new SessionManager();
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
function errorText(value) {
    if (value.error)
        return `[${value.error.code}] ${value.error.message}`;
    if (value.errors?.length) {
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
// 注册 MCP handlers，用 getState 闭包取当前 session 的 SessionState（stdio=http 同形状，transport 无关）
function registerHandlers(server, getState) {
    server.setRequestHandler(ListToolsRequestSchema, async () => {
        const state = getState();
        return { tools: state.catalog.map(e => ({ name: e.name, description: e.description, inputSchema: e.parameters, annotations: annotationsFor(e.behavior) })) };
    });
    server.setRequestHandler(CallToolRequestSchema, async (req) => {
        const state = getState();
        const entry = state.catalog.find(e => e.name === req.params.name);
        if (!entry)
            return { content: [{ type: 'text', text: `未知工具：${req.params.name}` }], isError: true };
        const value = await entry.execute(req.params.arguments ?? {});
        const isError = typeof value === 'object' && value !== null && value.ok === false;
        const content = [{ type: 'text', text: isError ? errorText(value) : (typeof value === 'string' ? value : JSON.stringify(value, null, 2)) }];
        // §5.1 S5 companion（session-isolation per-session 计数）：companionConfig.enabled && behavior!=='read' → ++count → 达阈值重置 + 仅 !isError 时 push reminder
        if (state.companionConfig.enabled && entry.behavior !== 'read') {
            state.companionCount++;
            if (state.companionCount >= state.companionConfig.threshold) {
                state.companionCount = 0;
                if (!isError)
                    content.push({ type: 'text', text: companionReminder(state.companionConfig.threshold) });
            }
        }
        return { content, isError };
    });
}
function buildServer() {
    return new Server({ name: 'normify', version }, { capabilities: { tools: {} } });
}
const transportMode = (process.env.NORMIFY_TRANSPORT ?? 'stdio').toLowerCase();
if (transportMode === 'http') {
    // DP2 HTTP：transport-per-session（SDK stateful 模式；同 transport 二次 initialize 被拒 400 → 每会话独立 transport+Server）
    const port = Number(process.env.NORMIFY_PORT ?? '3000');
    // sessionId → { transport, server }；token 经 env 注入（DP2 scaffolding，DP4 改 per-session header）
    const sessions = new Map();
    const token = process.env.NORMIFY_SERVER_TOKEN;
    const httpServer = createHttpServer((req, res) => {
        // DP4 R3 推送快照：POST /snapshot {sessionId, files:{path:base64}, gitHead?, gitChangedFiles?}
        // → 置 SessionState.env.bridge = SessionCacheBridge（catalog 闭包调用时读 env.bridge）
        if (req.method === 'POST' && req.url?.startsWith('/snapshot')) {
            const chunks = [];
            req.on('data', (c) => chunks.push(c));
            req.on('end', () => {
                try {
                    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
                    const st = body.sessionId ? sessionManager.get(body.sessionId) : undefined;
                    if (!st) {
                        res.writeHead(404);
                        res.end(JSON.stringify({ ok: false, error: 'session not found' }));
                        return;
                    }
                    pushSnapshot(st, new SessionCacheBridge({ files: body.files ?? {}, gitHead: body.gitHead, gitChangedFiles: body.gitChangedFiles }));
                    res.writeHead(200, { 'content-type': 'application/json' });
                    res.end(JSON.stringify({ ok: true, files: Object.keys(body.files ?? {}).length }));
                }
                catch (e) {
                    res.writeHead(400);
                    res.end(JSON.stringify({ ok: false, error: String(e) }));
                }
            });
            return;
        }
        // 读 body（NDJSON 或 JSON-RPC 批）
        const chunks = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => {
            const bodyRaw = Buffer.concat(chunks).toString('utf8');
            let parsedBody = undefined;
            if (bodyRaw.length > 0) {
                try {
                    parsedBody = JSON.parse(bodyRaw);
                }
                catch { /* 交给 transport 兜底 */ }
            }
            const sid = typeof req.headers['mcp-session-id'] === 'string' ? req.headers['mcp-session-id'] : undefined;
            const entry = sid ? sessions.get(sid) : undefined;
            if (entry) {
                // 后续请求：路由到已有 transport
                entry.transport.handleRequest(req, res, parsedBody).catch((e) => { console.error('mcp handleRequest:', e); if (!res.headersSent) {
                    res.writeHead(500);
                    res.end();
                } });
                return;
            }
            // 新 initialize（无 sid）：建新 transport+Server，handleRequest 后 sid 落定
            const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID() });
            const server = buildServer();
            registerHandlers(server, () => {
                const st = sessionManager.get(transport.sessionId ?? '');
                if (!st)
                    throw new Error('session not found: ' + transport.sessionId);
                return st;
            });
            server.connect(transport).then(() => {
                transport.handleRequest(req, res, parsedBody).then(() => {
                    const newSid = transport.sessionId;
                    if (newSid) {
                        sessions.set(newSid, { transport, server });
                        // 建 SessionState（per-session catalog + companionCount；token 经 env，DP4 改 header）
                        if (!sessionManager.get(newSid)) {
                            sessionManager.create(createSessionState(newSid, baseInfra, basePolicy, token, authConfig));
                        }
                        // R-007 SHOULD：transport onclose → session 清理
                        transport.onclose = () => { sessions.delete(newSid); sessionManager.delete(newSid); };
                    }
                }).catch((e) => { console.error('mcp handleRequest (new):', e); if (!res.headersSent) {
                    res.writeHead(500);
                    res.end();
                } });
            }).catch((e) => { console.error('mcp connect:', e); if (!res.headersSent) {
                res.writeHead(500);
                res.end();
            } });
        });
    });
    httpServer.listen(port, () => {
        console.log(`normify MCP HTTP server on :${port} (rootDir=${baseInfra.rootDir})`);
    });
}
else {
    // stdio（默认，1 session）：synthesize 固定 STDIO_SESSION_ID
    const stdioState = createSessionState(STDIO_SESSION_ID, baseInfra, basePolicy, process.env.NORMIFY_SERVER_TOKEN, authConfig);
    sessionManager.create(stdioState);
    const server = buildServer();
    registerHandlers(server, () => sessionManager.get(STDIO_SESSION_ID));
    if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
        const transport = new StdioServerTransport();
        await server.connect(transport);
    }
}
//# sourceMappingURL=server.js.map