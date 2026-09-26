import type { RepoBridge } from './bridge.js';
/** toolenv-split：SecurityContext（auth/token 源，session-isolation）——用户图隔离 + 项目 allowlist。 */
export interface SecurityContext {
    /** 用户图隔离维度。undefined=default user（向后兼容，路径 rootDir/normify-<slug>/）。给定则路径 rootDir/<userScope>/normify-<slug>/。 */
    userScope?: string;
    /** auth 项目 allowlist。undefined=全可见（无 auth）。给定则 project slug 必须在列。 */
    projectAllowlist?: string[];
}
/** toolenv-split：InfraEnv（config 源）——图 DB 根 + repoRoot 桥。 */
export interface InfraEnv {
    rootDir: string;
    /** 仓库桥。undefined=LocalBridge(repoRoot)（DSH/stdio，向后兼容）；SessionCacheBridge（DP4）从 R3 推送快照读（经 pushSnapshot 置 session.infra.bridge）。 */
    bridge?: RepoBridge;
}
/** toolenv-split：Policy（config 源）——双语策略。 */
export interface Policy {
    requireBilingual: boolean;
}
/** JSON Schema 节点（作者态：属性级内联 required: true；编译后对象级为 required: string[]）。 */
export interface SchemaNode {
    type?: string;
    description?: string;
    required?: boolean | string[];
    properties?: Record<string, SchemaNode>;
    items?: SchemaNode;
    additionalProperties?: boolean;
    [key: string]: unknown;
}
/** 递归的 schema 取值：节点本身或节点数组（items/required 等子结构）。 */
export type SchemaValue = SchemaNode | SchemaValue[];
/** params() 编译出的对象级 JSON Schema。 */
export type ObjectSchema = SchemaNode & {
    required?: string[];
};
/** 工具行为标记：read=只读；write=写入；destroy=破坏性；idempotent=幂等。 */
export type ToolBehavior = 'read' | 'write' | 'destroy' | 'idempotent';
/** register() 的工具定义。 */
export interface ToolDef {
    description: string;
    behavior: ToolBehavior;
    parameters?: ObjectSchema;
}
/** 平台无关工具目录条目：DSH / MCP / pi 三适配层共享。 */
export interface ToolEntry {
    name: string;
    description: string;
    behavior: ToolBehavior;
    parameters: ObjectSchema;
    execute: (args: Record<string, unknown>) => Promise<unknown>;
}
export declare function buildCatalog(security: SecurityContext, infra: InfraEnv, policy: Policy): ToolEntry[];
