// session-isolation: 统一 Session 抽象。
// SessionManager + SessionState（stdio 1 session / http N session 同形状，transport 无关）。
// per-session: catalog（带 userScope）+ companionCount + companionConfig + cacheBridge?(future)。
// auth 脚手架：NORMIFY_AUTH_TOKENS=JSON{token:{userId,projects}} → token 解析 {userId, projectAllowlist}；
// 无 token = default user（userId=undefined, allowlist=undefined=全可见，向后兼容）。
// stdio token 经 env NORMIFY_SERVER_TOKEN 注入（scaffolding）；http token 经 transport 元数据（dual-side-mode DP2）。
import type { ToolEntry, ToolEnv } from './catalog.js';
import { buildCatalog } from './catalog.js';
import type { CompanionConfig } from './companion.js';
import { parseCompanionConfig } from './companion.js';
import type { RepoBridge } from './bridge.js';

/** SessionState：同形状（stdio 1/http N）。 */
export interface SessionState {
    sessionId: string;
    userId: string | undefined;              // from token; undefined = default user
    projectAllowlist: string[] | undefined;  // undefined = all projects（无 auth）
    companionCount: number;
    companionConfig: CompanionConfig;
    catalog: ToolEntry[];                     // per-session buildCatalog(env with userScope)
    /** DP4：会话 ToolEnv（可变 .bridge——pushSnapshot 后置 SessionCacheBridge，catalog 闭包调用时读 env.bridge）。 */
    env: ToolEnv;
}

/**
 * arch-cleanup AP-003：R3 推送快照赋值。use-case 层只赋 env.bridge = bridge（认 RepoBridge 接口）；
 * SessionCacheBridge 构造留 adapter（mcp/server.ts /snapshot handler）——session.ts 不 import 具体 infrastructure。
 */
export function pushSnapshot(state: SessionState, bridge: RepoBridge): void {
    state.env.bridge = bridge;
}

/** token 解析出的身份。 */
export interface AuthIdentity {
    userId: string;
    projects: string[]; // allowlist
}

/** auth config：NORMIFY_AUTH_TOKENS = JSON {token: {userId, projects}}。无 env → 空 map（无 auth）。 */
export function parseAuthConfig(env: NodeJS.ProcessEnv = process.env): Map<string, AuthIdentity> {
    const raw = env.NORMIFY_AUTH_TOKENS;
    const map = new Map<string, AuthIdentity>();
    if (!raw) return map;
    try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
            for (const [token, v] of Object.entries(parsed)) {
                const val = v as { userId?: unknown; projects?: unknown };
                if (val && typeof val.userId === 'string' && Array.isArray(val.projects)) {
                    map.set(token, { userId: val.userId, projects: val.projects as string[] });
                }
            }
        }
    }
    catch { /* malformed → 空 map（无 auth，向后兼容） */ }
    return map;
}

/** token → 身份；无 token = undefined（default user）。 */
export function resolveSessionAuth(token: string | undefined, authConfig: Map<string, AuthIdentity>): AuthIdentity | undefined {
    if (token === undefined || token === '') return undefined;
    return authConfig.get(token);
}

/** SessionManager：Map<sessionId, SessionState> + onclose 钩子（R-007 SHOULD）。 */
export class SessionManager {
    private sessions = new Map<string, SessionState>();
    private oncloseHooks = new Map<string, (() => void) | undefined>();

    get(sessionId: string): SessionState | undefined {
        return this.sessions.get(sessionId);
    }
    create(state: SessionState): SessionState {
        this.sessions.set(state.sessionId, state);
        return state;
    }
    setOnclose(sessionId: string, hook: (() => void) | undefined): void {
        this.oncloseHooks.set(sessionId, hook);
    }
    delete(sessionId: string): void {
        const h = this.oncloseHooks.get(sessionId);
        if (h) h();
        this.oncloseHooks.delete(sessionId);
        this.sessions.delete(sessionId);
    }
    size(): number {
        return this.sessions.size;
    }
}

/** 从 env + token 建 SessionState。catalog per-session（env 带 userScope）。 */
export function createSessionState(
    sessionId: string,
    env: ToolEnv,
    token: string | undefined,
    authConfig: Map<string, AuthIdentity>,
    companionEnv: NodeJS.ProcessEnv = process.env,
): SessionState {
    const identity = resolveSessionAuth(token, authConfig);
    const sessionEnv: ToolEnv = {
        rootDir: env.rootDir,
        requireBilingual: env.requireBilingual,
        userScope: identity?.userId,
        projectAllowlist: identity?.projects,
    };
    const catalog = buildCatalog(sessionEnv);
    return {
        sessionId,
        userId: identity?.userId,
        projectAllowlist: identity?.projects,
        companionCount: 0,
        companionConfig: parseCompanionConfig(companionEnv),
        catalog,
        env: sessionEnv,
    };
}

/** stdio 固定 session id（MCP stdio 协议无 session-id；单连接）。 */
export const STDIO_SESSION_ID = 'stdio';
