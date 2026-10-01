import type { ExtensionAPI, ToolResultEvent } from '@earendil-works/pi-coding-agent';
import type { CompanionConfig } from '../companion.js';
/**
 * pi companion handler（计 pi 外部 write/edit）。
 * WRITE_TOOLS 正则不匹配 `mcp__normify__*`，故不计 normify 自身写（那些由 server 侧 companionCount 计）。
 * 复刻 src/pi/normify.ts 的 createCompanionHandler（不依赖 catalog/engine，保持 thin）。
 */
export declare function createCompanionHandler(config: CompanionConfig): (event: ToolResultEvent) => {
    content: (import("@earendil-works/pi-ai").TextContent | import("@earendil-works/pi-ai").ImageContent)[];
} | undefined;
export default function (pi: ExtensionAPI): void;
