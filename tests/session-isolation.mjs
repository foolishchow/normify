// session-isolation 验收测试（A-001 / A-003 / A-003b / A-003c / A-004 / A-005 / A-007）。
// 验证：统一 Session 抽象 + per-user 图隔离（模型 i）+ 路径 arg 逃逸防护 + auth allowlist + session 清理钩子。
// 向后兼容硬约束：无 userScope（无 auth）路径不变（由 parity 27 + 8 套 npm test 覆盖，此处聚焦隔离新增行为）。
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert';
import { SessionManager, createSessionState, parseAuthConfig, resolveSessionAuth, STDIO_SESSION_ID } from '../lib/session.js';
import { resolveProject, listProjects, NormifyError } from '../lib/engine/store.js';
import { buildCatalog } from '../lib/catalog.js';

let pass = 0, fail = 0;
const T = (name, fn) => Promise.resolve(fn()).then(() => { pass++; console.log('PASS ' + name); }, (e) => { fail++; console.log('FAIL ' + name + '\n  ' + (e?.stack || e)); });
const eq = (a, b, m) => assert.strictEqual(a, b, m);

// 临时 rootDir：alice/bob 两用户各建 1 项目
const root = mkdtempSync(join(tmpdir(), 'normify-sess-'));
const authTokens = JSON.stringify({
    'tok-alice': { userId: 'alice', projects: ['demo-repo', 'auth'] },
    'tok-bob': { userId: 'bob', projects: ['demo-repo'] },
});

// 预置 alice/demo + bob/demo（直接建目录，不经工具，隔离纯路径行为）
mkdirSync(join(root, 'alice', 'normify-demo', 'modules'), { recursive: true });
mkdirSync(join(root, 'bob', 'normify-demo', 'modules'), { recursive: true });
mkdirSync(join(root, 'normify-default', 'modules'), { recursive: true });

await (async () => {
    // A-001 SessionManager：create + get + 1 session 存在
    await T('A-001 SessionManager.get(STDIO_SESSION_ID) 返 SessionState 含 catalog', async () => {
        const mgr = new SessionManager();
        const env = { rootDir: root, requireBilingual: true };
        const auth = parseAuthConfig({ NORMIFY_AUTH_TOKENS: authTokens });
        const st = createSessionState(STDIO_SESSION_ID, env, undefined, auth);
        mgr.create(st);
        const got = mgr.get(STDIO_SESSION_ID);
        eq(got?.sessionId, STDIO_SESSION_ID);
        eq(got?.catalog.length > 0, true);
        eq(got?.userId, undefined);       // 无 token = default
        eq(mgr.size(), 1);
    });

    // A-003 resolveProject userScope → 路径落 rootDir/<userScope>/normify-<slug>/
    await T('A-003 resolveProject(userScope=alice) → root/alice/normify-demo', async () => {
        const p = await resolveProject(root, { project: 'demo' }, {}, 'alice');
        eq(p.dir, join(root, 'alice', 'normify-demo'));
        eq(p.slug, 'demo');
    });
    await T('A-003 对照 无 userScope → root/normify-<slug>（向后兼容）', async () => {
        const p = await resolveProject(root, { project: 'default' }, {});
        eq(p.dir, join(root, 'normify-default'));
    });

    // A-003b listProjects userScope → 仅该用户项目
    await T('A-003b listProjects(userScope=alice) 仅列 alice 的', () => {
        const a = listProjects(root, 'alice');
        eq(a.length, 1);
        eq(a[0].slug, 'demo');
        const b = listProjects(root, 'bob');
        eq(b.length, 1);
        // 无 userScope 列全部顶层（向后兼容：含 normify-default + alice/ + bob/ 目录扫到的）
        const all = listProjects(root);
        eq(all.some(x => x.slug === 'default'), true);
    });

    // A-003c 路径 arg 逃逸防护：绝对路径 + `..` 遍历 → session/path-escape
    await T('A-003c 绝对路径 dir 越界 → session/path-escape', async () => {
        await assert.rejects(
            () => resolveProject(root, { dir: '/etc/passwd' }, {}, 'alice'),
            (e) => e instanceof NormifyError && e.code === 'session/path-escape',
        );
    });
    await T('A-003c `..` 遍历越界 → session/path-escape', async () => {
        // dir 以 '..' 开头 → resolve(root/alice, '../bob/normify-demo') = root/bob/normify-demo → 越界 alice scope
        await assert.rejects(
            () => resolveProject(root, { dir: '../bob/normify-demo' }, {}, 'alice'),
            (e) => e instanceof NormifyError && e.code === 'session/path-escape',
        );
    });
    await T('A-003c 对照 无 userScope 时绝对路径不限（向后兼容）', async () => {
        // 无 auth：绝对路径 dir 走原有行为（resolve 到该路径；只要 modules 存在即 ok）
        const p = await resolveProject(root, { dir: join(root, 'normify-default') }, {});
        eq(p.slug, 'default');
    });

    // A-004 两 userScope catalog → resolve 不同路径（per-session catalog 隔离）
    await T('A-004 alice vs bob catalog project_init 同 slug 落不同 scope 路径', async () => {
        // 无 allowlist（仅 userScope）→ 可自由 create，证明 catalog 闭包经 env.userScope 注入 resolveProject
        const envA = { rootDir: root, requireBilingual: true, userScope: 'alice' };
        const envB = { rootDir: root, requireBilingual: true, userScope: 'bob' };
        const catA = buildCatalog(envA);
        const catB = buildCatalog(envB);
        const rA = await catA.find(e => e.name === 'normify_project_init').execute({ project: 'a4' });
        const rB = await catB.find(e => e.name === 'normify_project_init').execute({ project: 'a4' });
        eq(rA.ok, true);
        eq(rB.ok, true);
        eq(rA.dir, join(root, 'alice', 'normify-a4'));
        eq(rB.dir, join(root, 'bob', 'normify-a4'));
    });

    // A-005 auth allowlist：token → userId + projectAllowlist；非 allowlist 项目 → session/project-not-allowed
    await T('A-005 parseAuthConfig + resolveSessionAuth：tok-alice → alice + [demo-repo,auth]', () => {
        const auth = parseAuthConfig({ NORMIFY_AUTH_TOKENS: authTokens });
        const id = resolveSessionAuth('tok-alice', auth);
        eq(id?.userId, 'alice');
        eq(JSON.stringify(id?.projects), JSON.stringify(['demo-repo', 'auth']));
        eq(resolveSessionAuth(undefined, auth), undefined); // 无 token = default
        eq(resolveSessionAuth('bogus', auth), undefined);   // 未知 token = default
    });
    await T('A-005 createSessionState(token) → userId + projectAllowlist 注入 SessionState', () => {
        const auth = parseAuthConfig({ NORMIFY_AUTH_TOKENS: authTokens });
        const st = createSessionState('s1', { rootDir: root, requireBilingual: true }, 'tok-alice', auth);
        eq(st.userId, 'alice');
        eq(JSON.stringify(st.projectAllowlist), JSON.stringify(['demo-repo', 'auth']));
    });
    await T('A-005 allowlist 拒绝：bob 调 auth（不在 bob allowlist）→ session/project-not-allowed', async () => {
        // bob allowlist=[demo-repo]，调 'auth' → resolve 闭包 allowlist 校验先于项目存在性
        const auth = parseAuthConfig({ NORMIFY_AUTH_TOKENS: authTokens });
        const st = createSessionState('s-bob', { rootDir: root, requireBilingual: true }, 'tok-bob', auth);
        const r = await st.catalog.find(e => e.name === 'normify_module_list').execute({ project: 'auth' });
        eq(r.ok, false);
        eq(r.error.code, 'session/project-not-allowed');
    });
    await T('A-005 对照 无 auth（无 token）→ allowlist undefined，不限项目', async () => {
        const auth = parseAuthConfig({}); // 无 env
        const st = createSessionState('s-def', { rootDir: root, requireBilingual: true }, undefined, auth);
        eq(st.projectAllowlist, undefined);
        eq(st.userId, undefined);
    });

    // A-007 session 清理钩子（SHOULD）：delete 触发 onclose
    await T('A-007 SessionManager.delete 触发 onclose 钩子', () => {
        const mgr = new SessionManager();
        let closed = false;
        const env = { rootDir: root, requireBilingual: true };
        const st = createSessionState('s-temp', env, undefined, parseAuthConfig({}));
        mgr.create(st);
        mgr.setOnclose('s-temp', () => { closed = true; });
        mgr.delete('s-temp');
        eq(closed, true);
        eq(mgr.get('s-temp'), undefined);
    });
})().finally(() => {
    try { rmSync(root, { recursive: true, force: true }); } catch {}
    console.log(`\n=== 结果：${pass} PASS, ${fail} FAIL ===`);
    if (fail > 0) process.exit(1);
});
