import type { ExtensionAPI, ExtensionHandler, ToolResultEvent, ToolResultEventResult } from '@earendil-works/pi-coding-agent';
import type { CompanionConfig } from '../companion.js';
/**
 * pi companion handler（计 pi 外部 write/edit）。
 * WRITE_TOOLS 不匹配 `mcp__normify__*`，故不计 normify 自身写（那些由 server 侧 companionCount 计）。
 * 独立实现（不依赖 catalog/engine，保持 thin）。
 */
export declare function createCompanionHandler(config: CompanionConfig): ExtensionHandler<ToolResultEvent, ToolResultEventResult>;
export default function (pi: ExtensionAPI): void;
