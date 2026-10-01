import { companionReminder, parseCompanionConfig, WRITE_TOOLS } from '../companion.js';
/**
 * pi companion handler（计 pi 外部 write/edit）。
 * WRITE_TOOLS 正则不匹配 `mcp__normify__*`，故不计 normify 自身写（那些由 server 侧 companionCount 计）。
 * 复刻 src/pi/normify.ts 的 createCompanionHandler（不依赖 catalog/engine，保持 thin）。
 */
export function createCompanionHandler(config) {
    let count = 0;
    return (event) => {
        if (!config.enabled)
            return; // 首检查短路
        if (!WRITE_TOOLS.test(event.toolName))
            return; // 非 write/edit 外部工具
        count++;
        if (count < config.threshold)
            return; // 未达阈值
        count = 0; // 达阈值即重置（镜像 DSH L72）
        if (event.isError)
            return; // 仅 !isError 时注入
        return { content: [...event.content, { type: 'text', text: companionReminder(config.threshold) }] };
    };
}
// pi 扩展入口：companion-only（工具连接经由 pi 原生 MCP mcp.json 配置，非本扩展）。
export default function (pi) {
    const companionConfig = parseCompanionConfig(process.env);
    pi.on('tool_result', createCompanionHandler(companionConfig));
}
//# sourceMappingURL=normify-client.js.map