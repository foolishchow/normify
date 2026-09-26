// dual-side-mode DP3 验收测试（A-005 / A-006）。
// 启 HTTP MCP server，fake ExtensionAPI，registerNormifyClient 连：
//   A-005：31 工具注册 + normify_help execute ok（经 HTTP client.callTool）。
//   A-006：pi companion handler：N 次外部写（WRITE_TOOLS）后 reminder；disabled void。
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert';
import { registerNormifyClient } from '../lib/pi/normify-client.js';

// companion handler 在本进程读 process.env（pi 侧），设 enabled + threshold=3
process.env.NORMIFY_DEV_COMPANION_REMINDER = '1';
process.env.NORMIFY_DEV_COMPANION_REMINDER_AFTER = '3';

let pass = 0, fail = 0;
const T = (name, fn) => Promise.resolve().then(() => fn()).then(() => { pass++; console.log('PASS ' + name); }, (e) => { fail++; console.log('FAIL ' + name + '\n  ' + (e?.stack || e)); });
const eq = (a, b, m) => assert.strictEqual(a, b, m);

const PORT = String(4949 + Math.floor(Math.random() * 1000));
const root = mkdtempSync(join(tmpdir(), 'normify-picli-'));
const proc = spawn(process.execPath, ['lib/mcp/server.js'], {
    env: { ...process.env, NORMIFY_TRANSPORT: 'http', NORMIFY_PORT: PORT, NORMIFY_ROOT_DIR: root },
    stdio: ['ignore', 'pipe', 'pipe'],
});
const logs = [];
proc.stdout.on('data', (d) => logs.push(String(d)));
proc.stderr.on('data', (d) => logs.push(String(d)));
await new Promise((r) => {
    const t = setInterval(() => { if (logs.some((l) => l.includes('HTTP server'))) { clearInterval(t); r(); } }, 100);
    setTimeout(() => { clearInterval(t); r(); }, 3000);
});

// fake ExtensionAPI：记录 registerTool + 存 tool_result handler
function makeFakePi() {
    return {
        registered: [],
        toolResultHandler: null,
        registerTool(def) { this.registered.push(def); },
        on(event, handler) { if (event === 'tool_result') this.toolResultHandler = handler; },
    };
}

await (async () => {
    const url = 'http://127.0.0.1:' + PORT + '/mcp';
    const pi = makeFakePi();
    const disconnect = await registerNormifyClient(pi, url);

    // A-005：31 工具注册
    await T('A-005 pi 瘦客户端注册 31 工具', () => {
        eq(pi.registered.length, 31);
        eq(pi.registered.some(t => t.name === 'normify_help'), true);
        // parameters 是 typebox TObject（type=object + properties）
        const p = pi.registered.find(t => t.name === 'normify_help').parameters;
        eq(p.type, 'object');
        eq(typeof p.properties, 'object');
    });

    // A-005：execute 经 client.callTool ok（normify_help 返文本）
    await T('A-005 pi execute normify_help 经 HTTP ok', async () => {
        const entry = pi.registered.find(t => t.name === 'normify_help');
        const r = await entry.execute('id1', {});
        eq(Array.isArray(r.content), true);
        eq(r.content.length > 0, true);
        eq(r.content[0].text.length > 0, true);
    });

    // A-005：write 工具也经 HTTP ok（project_init）
    await T('A-005 pi execute normify_project_init 经 HTTP ok', async () => {
        const entry = pi.registered.find(t => t.name === 'normify_project_init');
        const r = await entry.execute('id2', { project: 'picli-demo' });
        eq(r.details?.isError, false);
    });

    // A-006：companion handler——N 次外部写后 reminder；默认阈值 3
    await T('A-006 companion：3 次外部 write 后 reminder（第 3 次 push）', () => {
        // 模拟 3 次 WRITE_TOOLS tool_result（toolName='edit'，非 isError）
        const mk = () => ({ toolName: 'edit', isError: false, content: [{ type: 'text', text: 'ok' }] });
        let r1 = pi.toolResultHandler(mk()); eq(r1, undefined); // count 1 < 3
        let r2 = pi.toolResultHandler(mk()); eq(r2, undefined); // count 2 < 3
        let r3 = pi.toolResultHandler(mk());                       // count 3 → reset + reminder
        eq(Array.isArray(r3?.content), true);
        eq(r3.content.length, 2); // 原 + reminder
        eq(r3.content[1].text.includes('已连续修改'), true);
    });

    // A-006：companion 计数重置后再 1 次 void（F-034 镜像 DSH 重置）
    await T('A-006 companion 计数重置后 1 次 void', () => {
        const r = pi.toolResultHandler({ toolName: 'edit', isError: false, content: [{ type: 'text', text: 'ok' }] });
        eq(r, undefined); // count 1 < 3（重置后）
    });

    // A-006：非 WRITE_TOOLS 不计
    await T('A-006 companion 非 WRITE_TOOLS 不计', () => {
        const r = pi.toolResultHandler({ toolName: 'bash', isError: false, content: [{ type: 'text', text: 'ok' }] });
        eq(r, undefined);
    });

    await disconnect();
})().finally(() => {
    try { proc.kill('SIGKILL'); } catch {}
    try { rmSync(root, { recursive: true, force: true }); } catch {}
    console.log(`\n=== 结果：${pass} PASS, ${fail} FAIL ===`);
    if (fail > 0) process.exit(1);
});
