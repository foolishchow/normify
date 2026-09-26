import type { ExtensionAPI, ToolResultEvent } from '@earendil-works/pi-coding-agent';
import { type TSchema } from 'typebox';
import type { CompanionConfig } from '../companion.js';
/** JSON Schema（server tools/list 返的 inputSchema）→ typebox（pi.registerTool 要 TSchema）。 */
export declare function jsonSchemaToTypebox(node: unknown): TSchema;
/** pi companion handler（复刻 src/pi/normify.ts 的 createCompanionHandler；不依赖 catalog/engine）。 */
export declare function createCompanionHandler(config: CompanionConfig): (event: ToolResultEvent) => {
    content: (import("@earendil-works/pi-ai").TextContent | import("@earendil-works/pi-ai").ImageContent)[];
} | undefined;
/** 连 HTTP server + 注册 31 工具 + companion handler。返回 disconnect 闭包（测试/清理用）。 */
export declare function registerNormifyClient(pi: ExtensionAPI, url: string): Promise<() => Promise<void>>;
export default function (pi: ExtensionAPI): Promise<void>;
