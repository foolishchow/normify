// dual-side-mode DP3：pi 瘦客户端扩展。
// 连 HTTP MCP server（NORMIFY_MCP_URL），tools/list → 31 工具 → pi.registerTool 桥；
// execute 转发 client.callTool（不在本地装 catalog/engine/yaml，仅 MCP SDK + typebox 转换）。
// companion handler（WRITE_TOOLS，计 pi 外部写），语义同 in-process src/pi/normify.ts（§10 split）。
// 与 in-process normify.ts 二选一：单 dev 用 in-process（fallback），多 agent 用瘦客户端连 server。
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { ExtensionAPI, ToolResultEvent } from '@earendil-works/pi-coding-agent';
import { Type, type TSchema } from 'typebox';
import { companionReminder, parseCompanionConfig, WRITE_TOOLS } from '../companion.js';
import type { CompanionConfig } from '../companion.js';

/** JSON Schema（server tools/list 返的 inputSchema）→ typebox（pi.registerTool 要 TSchema）。 */
export function jsonSchemaToTypebox(node: unknown): TSchema {
    if (!node || typeof node !== 'object') return Type.Any();
    const n = node as Record<string, unknown>;
    if (Array.isArray(n.enum)) return Type.Union((n.enum as unknown[]).map((v) => Type.Literal(v as string | number | boolean)));
    if (n.const !== undefined) return Type.Literal(n.const as string | number | boolean);
    switch (n.type) {
        case 'string': return Type.String();
        case 'boolean': return Type.Boolean();
        case 'number':
        case 'integer': return Type.Number();
        case 'array': return Type.Array(jsonSchemaToTypebox(n.items));
        case 'object': {
            const props: Record<string, TSchema> = {};
            const required = Array.isArray(n.required) ? (n.required as string[]) : [];
            for (const [k, v] of Object.entries((n.properties ?? {}) as Record<string, unknown>)) {
                const t = jsonSchemaToTypebox(v);
                props[k] = required.includes(k) ? t : Type.Optional(t);
            }
            return Type.Object(props);
        }
        default: return Type.Any();
    }
}

/** pi companion handler（复刻 src/pi/normify.ts 的 createCompanionHandler；不依赖 catalog/engine）。 */
export function createCompanionHandler(config: CompanionConfig) {
    let count = 0;
    return (event: ToolResultEvent) => {
        if (!config.enabled) return;
        if (!WRITE_TOOLS.test(event.toolName)) return;
        count++;
        if (count < config.threshold) return;
        count = 0;
        if (event.isError) return;
        return { content: [...event.content, { type: 'text' as const, text: companionReminder(config.threshold) }] };
    };
}

/** 连 HTTP server + 注册 31 工具 + companion handler。返回 disconnect 闭包（测试/清理用）。 */
export async function registerNormifyClient(pi: ExtensionAPI, url: string): Promise<() => Promise<void>> {
    const transport = new StreamableHTTPClientTransport(new URL(url));
    const client = new Client({ name: 'normify-pi-client', version: '1.0' }, { capabilities: {} });
    await client.connect(transport);
    const { tools } = await client.listTools();
    for (const tool of tools) {
        pi.registerTool({
            name: tool.name,
            label: tool.name,
            description: tool.description ?? '',
            promptSnippet: tool.name,
            parameters: jsonSchemaToTypebox(tool.inputSchema),
            async execute(_toolCallId, params) {
                const r = await client.callTool({ name: tool.name, arguments: (params ?? {}) as Record<string, unknown> });
                return {
                    content: r.content as Array<{ type: 'text'; text: string }>,
                    details: r,
                };
            },
        });
    }
    const companionConfig = parseCompanionConfig(process.env);
    pi.on('tool_result', createCompanionHandler(companionConfig));
    return async () => { await client.close(); };
}

// pi 扩展入口：NORMIFY_MCP_URL（默认 http://127.0.0.1:3000/mcp）。
export default async function (pi: ExtensionAPI): Promise<void> {
    const url = process.env.NORMIFY_MCP_URL ?? 'http://127.0.0.1:3000/mcp';
    await registerNormifyClient(pi, url);
}
