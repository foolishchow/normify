import type { TSchema, TObject } from 'typebox';
import type { ExtensionAPI, ToolResultEvent } from '@earendil-works/pi-coding-agent';
import type { ObjectSchema, SchemaNode, InfraEnv, Policy } from '../catalog.js';
import type { CompanionConfig } from '../companion.js';
/**
 * 节点级 JSON Schema → typebox 投影（递归）。
 * 覆盖 string/number/boolean/array/object；string 上的 enum → StringEnum（前向兼容）。
 */
export declare function schemaToTypebox(node: SchemaNode): TSchema;
/**
 * 对象级投影：读对象级 required: string[]，属性名在 required 内→必填，否则 Type.Optional。
 * 返回 Type.Object({...}, { additionalProperties: false })（closed object，与 catalog 编译形态一致）。
 */
export declare function objectSchemaToTypebox(schema: ObjectSchema): TObject;
/**
 * 错误载荷 → 可读文本（镜像 S2 MCP errorText 形状）；成功 → 字符串原样 / 对象 JSON。
 * pi 的 AgentToolResult 无 isError 字段（实测 pi-agent-core），错误经 content 文本传达。
 * - 简单错误 {ok:false,error:{code,message}} → `[code] message`
 * - 丰富错误 {ok:false,errors[],summary?} → `summary? + errors.join('\n')`
 * - 字符串成功 → 原样
 * - 其他（含 ok:true 成功对象）→ JSON.stringify
 */
export declare function formatResultText(value: unknown): string;
/**
 * 遍历 buildCatalog({}, infra, policy)，对每个 entry 调 pi.registerTool。
 * execute 转调 entry.execute（已含 missing-args + toErrorPayload，平台无关），结果经 formatResultText 入 content。
 */
export declare function registerPiTools(pi: ExtensionAPI, infra: InfraEnv, policy: Policy): void;
export declare function createCompanionHandler(config: CompanionConfig): (event: ToolResultEvent) => {
    content: (import("@earendil-works/pi-ai").TextContent | import("@earendil-works/pi-ai").ImageContent)[];
} | undefined;
export default function (pi: ExtensionAPI): void;
