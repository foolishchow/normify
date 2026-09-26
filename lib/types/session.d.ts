import type { ToolEntry, InfraEnv, Policy } from './catalog.js';
import type { CompanionConfig } from './companion.js';
import type { RepoBridge } from './bridge.js';
/** SessionState：同形状（stdio 1/http N）。 */
export interface SessionState {
    sessionId: string;
    /** 顶层 identity（session 身份，供未来 logging/access/审计）。from token; undefined = default user。 */
    userId: string | undefined;
    /** 顶层 identity。undefined = all projects（无 auth）。 */
    projectAllowlist: string[] | undefined;
    /** toolenv-split：InfraEnv（config/R3 推送源；可变 .bridge——pushSnapshot 后置 SessionCacheBridge，catalog 闭包读 infra.bridge）。 */
    infra: InfraEnv;
    /** toolenv-split：Policy（config 源）。 */
    policy: Policy;
    companionCount: number;
    companionConfig: CompanionConfig;
    catalog: ToolEntry[];
}
/**
 * arch-cleanup AP-003 + toolenv-split：R3 推送快照赋值。use-case 层只赋 infra.bridge = bridge（认 RepoBridge 接口）；
 * SessionCacheBridge 构造留 adapter（mcp/server.ts /snapshot handler）——session.ts 不 import 具体 infrastructure。
 * 不变量：createSessionState 传同一 infra 对象给 buildCatalog + 存 state.infra（字段变更对闭包可见）。
 */
export declare function pushSnapshot(state: SessionState, bridge: RepoBridge): void;
/** token 解析出的身份。 */
export interface AuthIdentity {
    userId: string;
    projects: string[];
}
/** auth config：NORMIFY_AUTH_TOKENS = JSON {token: {userId, projects}}。无 env → 空 map（无 auth）。 */
export declare function parseAuthConfig(env?: NodeJS.ProcessEnv): Map<string, AuthIdentity>;
/** token → 身份；无 token = undefined（default user）。 */
export declare function resolveSessionAuth(token: string | undefined, authConfig: Map<string, AuthIdentity>): AuthIdentity | undefined;
/** SessionManager：Map<sessionId, SessionState> + onclose 钩子（R-007 SHOULD）。 */
export declare class SessionManager {
    private sessions;
    private oncloseHooks;
    get(sessionId: string): SessionState | undefined;
    create(state: SessionState): SessionState;
    setOnclose(sessionId: string, hook: (() => void) | undefined): void;
    delete(sessionId: string): void;
    size(): number;
}
/** 从 identity + infra + policy 建 SessionState。catalog per-session：security←identity（buildCatalog 调用处派生）。 */
export declare function createSessionState(sessionId: string, infra: InfraEnv, policy: Policy, token: string | undefined, authConfig: Map<string, AuthIdentity>, companionEnv?: NodeJS.ProcessEnv): SessionState;
/** stdio 固定 session id（MCP stdio 协议无 session-id；单连接）。 */
export declare const STDIO_SESSION_ID = "stdio";
