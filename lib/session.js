import { buildCatalog } from './catalog.js';
import { parseCompanionConfig } from './companion.js';
/**
 * arch-cleanup AP-003：R3 推送快照赋值。use-case 层只赋 env.bridge = bridge（认 RepoBridge 接口）；
 * SessionCacheBridge 构造留 adapter（mcp/server.ts /snapshot handler）——session.ts 不 import 具体 infrastructure。
 */
export function pushSnapshot(state, bridge) {
    state.env.bridge = bridge;
}
/** auth config：NORMIFY_AUTH_TOKENS = JSON {token: {userId, projects}}。无 env → 空 map（无 auth）。 */
export function parseAuthConfig(env = process.env) {
    const raw = env.NORMIFY_AUTH_TOKENS;
    const map = new Map();
    if (!raw)
        return map;
    try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
            for (const [token, v] of Object.entries(parsed)) {
                const val = v;
                if (val && typeof val.userId === 'string' && Array.isArray(val.projects)) {
                    map.set(token, { userId: val.userId, projects: val.projects });
                }
            }
        }
    }
    catch { /* malformed → 空 map（无 auth，向后兼容） */ }
    return map;
}
/** token → 身份；无 token = undefined（default user）。 */
export function resolveSessionAuth(token, authConfig) {
    if (token === undefined || token === '')
        return undefined;
    return authConfig.get(token);
}
/** SessionManager：Map<sessionId, SessionState> + onclose 钩子（R-007 SHOULD）。 */
export class SessionManager {
    sessions = new Map();
    oncloseHooks = new Map();
    get(sessionId) {
        return this.sessions.get(sessionId);
    }
    create(state) {
        this.sessions.set(state.sessionId, state);
        return state;
    }
    setOnclose(sessionId, hook) {
        this.oncloseHooks.set(sessionId, hook);
    }
    delete(sessionId) {
        const h = this.oncloseHooks.get(sessionId);
        if (h)
            h();
        this.oncloseHooks.delete(sessionId);
        this.sessions.delete(sessionId);
    }
    size() {
        return this.sessions.size;
    }
}
/** 从 env + token 建 SessionState。catalog per-session（env 带 userScope）。 */
export function createSessionState(sessionId, env, token, authConfig, companionEnv = process.env) {
    const identity = resolveSessionAuth(token, authConfig);
    const sessionEnv = {
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
//# sourceMappingURL=session.js.map