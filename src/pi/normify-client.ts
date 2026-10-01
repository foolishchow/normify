// pi companion-only 扩展（dual-side，pi 0.99.2+ 原生 MCP 后）。
// pi 原生 MCP（mcp.json：~/.pi/agent/mcp.json 或 .pi/mcp.json）连 HTTP server 注册 31 工具（mcp__normify__*）；
// 本扩展仅 companion handler（WRITE_TOOLS，计 pi 外部写/edit）——
// pi tool pipeline 对 MCP 工具亦触发 tool_result（pi docs/mcp.md "Permissions"），故外部写计数保留。
// server 侧 SessionState.companionCount 计 normify_* 写（behavior!=='read'）——companion split 完整。
// 与 in-process src/pi/normify.ts 二选一：单 dev 用 in-process（fallback），多 agent dual-side 用本扩展 + 原生 MCP。
import type { ExtensionAPI, ToolResultEvent } from '@earendil-works/pi-coding-agent';
import { companionReminder, parseCompanionConfig, WRITE_TOOLS } from '../companion.js';
import type { CompanionConfig } from '../companion.js';

/**
 * pi companion handler（计 pi 外部 write/edit）。
 * WRITE_TOOLS 正则不匹配 `mcp__normify__*`，故不计 normify 自身写（那些由 server 侧 companionCount 计）。
 * 复刻 src/pi/normify.ts 的 createCompanionHandler（不依赖 catalog/engine，保持 thin）。
 */
export function createCompanionHandler(config: CompanionConfig) {
    let count = 0;
    return (event: ToolResultEvent) => {
        if (!config.enabled) return;                                    // 首检查短路
        if (!WRITE_TOOLS.test(event.toolName)) return;                 // 非 write/edit 外部工具
        count++;
        if (count < config.threshold) return;                          // 未达阈值
        count = 0;                                                     // 达阈值即重置（镜像 DSH L72）
        if (event.isError) return;                                     // 仅 !isError 时注入
        return { content: [...event.content, { type: 'text' as const, text: companionReminder(config.threshold) }] };
    };
}

// pi 扩展入口：companion-only（工具连接经由 pi 原生 MCP mcp.json 配置，非本扩展）。
export default function (pi: ExtensionAPI): void {
    const companionConfig = parseCompanionConfig(process.env);
    pi.on('tool_result', createCompanionHandler(companionConfig));
}
