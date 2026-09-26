// session-isolation: 统一 Session 抽象。
// SessionManager + SessionState（stdio 1 session / http N session 同形状，transport 无关）。
// per-session: catalog（带 userScope）+ companionCount + companionConfig + cacheBridge?(future)。
// auth 脚手架：NORMIFY_AUTH_TOKENS=JSON{token:{userId,projects}} → token 解析 {userId, projectAllowlist}；
// 无 token = default user（userId=undefined, allowlist=undefined=全可见，向后兼容）。
// stdio token 经 env NORMIFY_SERVER_TOKEN 注入（scaffolding）；http token 经 transport 元数据（dual-side-mode DP2）。
import type { ToolEntry, SecurityContext, InfraEnv, Policy } from './catalog.js';
import { buildCatalog } from './catalog.js';
import type { CompanionConfig } from './companion.js';
import { parseCompanionConfig } from './companion.js';
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
    catalog: ToolEntry[];                     // per-session buildCatalog(security←identity, infra, policy)
}

/**
 * arch-cleanup AP-003 + toolenv-split：R3 推送快照赋值。use-case 层只赋 infra.bridge = bridge（认 RepoBridge 接口）；
 * SessionCacheBridge 构造留 adapter（mcp/server.ts /snapshot handler）——session.ts 不 import 具体 infrastructure。
 * 不变量：createSessionState 传同一 infra 对象给 buildCatalog + 存 state.infra（字段变更对闭包可见）。
 */
export function pushSnapshot(state: SessionState, bridge: RepoBridge): void {
    state.infra.bridge = bridge;
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

/** 从 identity + infra + policy 建 SessionState。catalog per-session：security←identity（buildCatalog 调用处派生）。 */
export function createSessionState(
    sessionId: string,
    infra: InfraEnv,
    policy: Policy,
    token: string | undefined,
    authConfig: Map<string, AuthIdentity>,
    companionEnv: NodeJS.ProcessEnv = process.env,
): SessionState {
    const identity = resolveSessionAuth(token, authConfig);
    const security: SecurityContext = {
        userScope: identity?.userId,
        projectAllowlist: identity?.projects,
    };
    // 不变量：同一 infra 对象引用传给 buildCatalog（闭包捕获）并存入 state.infra——pushSnapshot 字段变更对闭包可见。
    const catalog = buildCatalog(security, infra, policy);
    return {
        sessionId,
        userId: identity?.userId,
        projectAllowlist: identity?.projects,
        companionCount: 0,
        companionConfig: parseCompanionConfig(companionEnv),
        catalog,
        infra,
        policy,
    };
}

/** stdio 固定 session id（MCP stdio 协议无 session-id；单连接）。 */
export const STDIO_SESSION_ID = 'stdio';
