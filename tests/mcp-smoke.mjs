// MCP smoke test：启动 server（stdio 子进程），走 newline-delimited JSON-RPC 2.0，
// 验证 tools/list 返回 31 个工具 + tools/call 只读成功 + tools/call 未知工具报错。
// S5：加 companion 提醒钩子断言（A-001 enabled + A-005 disabled），3 spawn（spawnServer helper）。
// 不接入 npm test（S6 职责），独立运行：node tests/mcp-smoke.mjs
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const HERE = fileURLToPath(import.meta.url);
const REPO = resolve(HERE, '..', '..');
const SERVER = resolve(REPO, 'lib', 'mcp', 'server.js');

// S5 F-043：spawnServer helper —— spawn + send/notify + cleanup（3 spawn 共用）
// extraEnv: 追加 env（NORMIFY_DEV_COMPANION_* 等）；rootDir: NORMIFY_ROOT_DIR（undefined→server 用 cwd）
function spawnServer({ extraEnv = {}, rootDir } = {}) {
    const env = { ...process.env, ...extraEnv };
    if (rootDir !== undefined) env.NORMIFY_ROOT_DIR = rootDir;
    const child = spawn('node', [SERVER], { cwd: REPO, env, stdio: ['pipe', 'pipe', 'pipe'] });
    let buf = '';
    let id = 0;
    const pending = new Map();
    child.stdout.on('data', (chunk) => {
        buf += chunk.toString();
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, i).trim();
            buf = buf.slice(i + 1);
            if (!line) continue;
            let msg;
            try { msg = JSON.parse(line); } catch { continue; }
            if (msg.id !== undefined && pending.has(msg.id)) {
                const { resolve: rj, reject } = pending.get(msg.id);
                pending.delete(msg.id);
                if (msg.error) reject(Object.assign(new Error(msg.error.message ?? 'rpc error'), { rpc: msg.error }));
                else rj(msg.result);
            }
        }
    });
    child.stderr.on('data', () => { /* server 诊断日志，不影响断言 */ });
    function send(method, params) {
        const myId = ++id;
        return new Promise((res, rej) => {
            pending.set(myId, { resolve: res, reject: rej });
            child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: myId, method, params }) + '\n');
        });
    }
    function notify(method, params) {
        child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
    }
    function cleanup() { child.kill('SIGTERM'); }
    return { child, send, notify, cleanup };
}

const PASS = [];
function assert(cond, label) {
    if (cond) { PASS.push(label); console.log('PASS  ' + label); }
    else { console.log('FAIL  ' + label); throw new Error('assert 失败: ' + label); }
}

// === spawn #1：现有断言（repo rootDir，companion disabled by default）===
const s1 = spawnServer({ rootDir: REPO });
let timer;
try {
    timer = setTimeout(() => { throw new Error('smoke 超时 15s'); }, 15000);

    // ① initialize 握手
    const init = await s1.send('initialize', {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'normify-smoke', version: '0.0.0' },
    });
    assert(typeof init?.protocolVersion === 'string', '① initialize 握手成功（server 返回 protocolVersion）');
    assert(typeof init?.serverInfo?.name === 'string', '①b server 返回 serverInfo.name');

    s1.notify('notifications/initialized', {});

    // ③ tools/list —— 31 个工具
    const list = await s1.send('tools/list', {});
    assert(Array.isArray(list.tools) && list.tools.length === 31, '③ tools/list 返回恰好 31 个工具');
    const names = list.tools.map(t => t.name);
    assert(names.includes('normify_help'), '③b 含 normify_help');
    assert(names.includes('normify_module_batch'), '③c 含 normify_module_batch');
    assert(names.includes('normify_project_init'), '③d 含 normify_project_init');
    assert(list.tools.every(t => t.inputSchema && t.inputSchema.type === 'object'), '③e 每个工具 inputSchema 带 type:object');
    const byName = Object.fromEntries(list.tools.map(t => [t.name, t]));
    assert(byName['normify_help']?.annotations?.readOnlyHint === true, '③f normify_help(read) annotations.readOnlyHint===true');
    assert(byName['normify_module_upsert']?.annotations?.readOnlyHint === false, '③g normify_module_upsert(write) annotations.readOnlyHint===false');
    assert(byName['normify_module_delete']?.annotations?.destructiveHint === true, '③h normify_module_delete(destroy) annotations.destructiveHint===true');

    // ④ tools/call normify_help {topic:'tools'}
    const call = await s1.send('tools/call', { name: 'normify_help', arguments: { topic: 'tools' } });
    assert(call.isError === false, '④ call normify_help(topic=tools) → isError===false');
    assert(call.content && call.content.length > 0 && typeof call.content[0].text === 'string' && call.content[0].text.length > 0, '④b content[0].text 非空');
    assert(call.content[0].text.startsWith('{'), '④c 成功路径 content 以 { 开头（JSON，非 errorText）');
    // S5 A-005（spawn #1 部分）：companion disabled → normify_help(read) content length===1（无 reminder 段）
    assert(call.content.length === 1, '④d S5 A-005 companion disabled → content length===1（无 reminder）');

    // ⑤ tools/call 未知工具 'nope'
    const unk = await s1.send('tools/call', { name: 'nope', arguments: {} });
    assert(unk.isError === true, '⑤ call 未知工具 nope → isError===true');

    // ⑥ tools/call normify_help {topic:'nope'}
    const err = await s1.send('tools/call', { name: 'normify_help', arguments: { topic: 'nope' } });
    assert(err.isError === true, '⑥ call normify_help(topic=nope) → isError===true');
    assert(typeof err.content?.[0]?.text === 'string' && err.content[0].text.startsWith('[args/invalid-topic]'), '⑥b content 以 [args/invalid-topic] 开头');
    assert(!err.content[0].text.startsWith('{'), '⑥c content 不以 { 开头（非裸 JSON）');

    console.log('SKIP  A-008 富错误 fs-fixture：豁免（G-002，无 hermetic 触发路径，代码审查 + A-002 兑底）');
} finally {
    if (timer) clearTimeout(timer);
    s1.cleanup();
}

// === S5 A-001：spawn #2 companion enabled（temp rootDir + AFTER=3）===
// normify_project_init {project:'test'} behavior=write 幂等 ×3 全 ok:true（实测）；
// 第 3 次 content length===2 + content[1].text 含 [normify]；第 4 次 length===1（计数重置）
const tmpA1 = mkdtempSync(join(tmpdir(), 'normify-s5-a1-'));
const s2 = spawnServer({
    rootDir: tmpA1,
    extraEnv: { NORMIFY_DEV_COMPANION_REMINDER: '1', NORMIFY_DEV_COMPANION_REMINDER_AFTER: '3' },
});
try {
    timer = setTimeout(() => { throw new Error('A-001 超时 10s'); }, 10000);
    await s2.send('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'normify-smoke', version: '0.0.0' } });
    s2.notify('notifications/initialized', {});

    // 第 1 次（count=1 < 3）
    const c1 = await s2.send('tools/call', { name: 'normify_project_init', arguments: { project: 'test' } });
    assert(c1.isError === false, 'S5 A-001 ① project_init #1 → isError===false（companion count=1）');
    assert(c1.content.length === 1, 'S5 A-001 ① content length===1（未达阈值，无 reminder）');

    // 第 2 次（count=2 < 3）
    const c2 = await s2.send('tools/call', { name: 'normify_project_init', arguments: { project: 'test' } });
    assert(c2.isError === false, 'S5 A-001 ② project_init #2 → isError===false（count=2）');
    assert(c2.content.length === 1, 'S5 A-001 ② content length===1（未达阈值）');

    // 第 3 次（count=3 == threshold → reset + inject，!isError）
    const c3 = await s2.send('tools/call', { name: 'normify_project_init', arguments: { project: 'test' } });
    assert(c3.isError === false, 'S5 A-001 ③ project_init #3 → isError===false（达阈值，!isError 注入）');
    assert(c3.content.length === 2, 'S5 A-001 ③ content length===2（原 content[0] + reminder content[1]，F-058）');
    assert(typeof c3.content[1]?.text === 'string' && c3.content[1].text.includes('[normify] 已连续修改'), 'S5 A-001 ③b content[1].text 含 [normify] 已连续修改');

    // 第 4 次（count=1 < 3，计数已重置）
    const c4 = await s2.send('tools/call', { name: 'normify_project_init', arguments: { project: 'test' } });
    assert(c4.isError === false, 'S5 A-001 ④ project_init #4 → isError===false（计数已重置 count=1）');
    assert(c4.content.length === 1, 'S5 A-001 ④ content length===1（重置后不注入）');
} finally {
    if (timer) clearTimeout(timer);
    s2.cleanup();
    rmSync(tmpA1, { recursive: true, force: true });
}

// === S5 A-005：spawn #3 companion disabled（temp rootDir，env 不设 NORMIFY_DEV_COMPANION_*）===
// 写工具 ×3 → 0 注入（证明 disabled；read 工具不区分 disabled vs read-skip，故用写工具）
const tmpA5 = mkdtempSync(join(tmpdir(), 'normify-s5-a5-'));
const s3 = spawnServer({ rootDir: tmpA5 });
try {
    timer = setTimeout(() => { throw new Error('A-005 超时 10s'); }, 10000);
    await s3.send('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'normify-smoke', version: '0.0.0' } });
    s3.notify('notifications/initialized', {});

    for (let i = 1; i <= 3; i++) {
        const r = await s3.send('tools/call', { name: 'normify_project_init', arguments: { project: 'test' } });
        assert(r.isError === false, 'S5 A-005 ①-' + i + ' project_init → isError===false（disabled）');
        assert(r.content.length === 1, 'S5 A-005 ①-' + i + ' content length===1（disabled 无 reminder，F-060）');
        assert(!r.content[0].text.includes('[normify]'), 'S5 A-005 ①-' + i + ' content[0].text 不含 [normify]');
    }
} finally {
    if (timer) clearTimeout(timer);
    s3.cleanup();
    rmSync(tmpA5, { recursive: true, force: true });
}

console.log('=== 结果：全部 PASS（' + PASS.length + ' 项，A-008 豁免）===');
