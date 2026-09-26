import type { ToolEntry, ToolEnv } from './catalog.js';
import type { CompanionConfig } from './companion.js';
/** 单会话状态。形状跨 stdio/http 一致（dual-side-mode DP2 复用）。 */
export interface SessionState {
    sessionId: string;
    userId: string | undefined;
    projectAllowlist: string[] | undefined;
    companionCount: number;
    companionConfig: CompanionConfig;
    catalog: ToolEntry[];
    /** DP4：会话 ToolEnv（可变 .bridge——pushSnapshot 后置 SessionCacheBridge，catalog 闭包调用时读 env.bridge）。 */
    env: ToolEnv;
}
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
/** 从 env + token 建 SessionState。catalog per-session（env 带 userScope）。 */
export declare function createSessionState(sessionId: string, env: ToolEnv, token: string | undefined, authConfig: Map<string, AuthIdentity>, companionEnv?: NodeJS.ProcessEnv): SessionState;
/** stdio 固定 session id（MCP stdio 协议无 session-id；单连接）。 */
export declare const STDIO_SESSION_ID = "stdio";
