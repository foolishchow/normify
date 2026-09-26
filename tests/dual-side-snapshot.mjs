// dual-side-mode DP4 验收测试（A-007 / A-008）。
// A-007：client 推快照 → HTTP normify_fingerprint 经 SessionCacheBridge 算 == LocalBridge 直算（同 source 字节）。
// A-008：server rootDir ≠ client repo（server 无 client fs）；fingerprint 仍工作 → 证经 cache 非直读 fs。
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { fingerprintOf } from '../lib/engine/store.js';
import { LocalBridge } from '../lib/bridge.js';

let pass = 0, fail = 0;
const T = (name, fn) => Promise.resolve().then(() => fn()).then(() => { pass++; console.log('PASS ' + name); }, (e) => { fail++; console.log('FAIL ' + name + '\n  ' + (e?.stack || e)); });
const eq = (a, b, m) => assert.strictEqual(a, b, m);

const PORT = String(5949 + Math.floor(Math.random() * 1000));
// server rootDir（图数据，不含 client 源码）
const serverRoot = mkdtempSync(join(tmpdir(), 'normify-snap-srv-'));
// client repo（源码，server 看不到）
const clientRepo = mkdtempSync(join(tmpdir(), 'normify-snap-cli-'));
mkdirSync(join(clientRepo, 'src'), { recursive: true });
writeFileSync(join(clientRepo, 'src', 'a.ts'), 'export const a = 1;\n');
writeFileSync(join(clientRepo, 'src', 'b.ts'), 'export const b = 2;\n');

const proc = spawn(process.execPath, ['lib/mcp/server.js'], {
    env: { ...process.env, NORMIFY_TRANSPORT: 'http', NORMIFY_PORT: PORT, NORMIFY_ROOT_DIR: serverRoot },
    stdio: ['ignore', 'pipe', 'pipe'],
});
const logs = [];
proc.stdout.on('data', (d) => logs.push(String(d)));
proc.stderr.on('data', (d) => logs.push(String(d)));
await new Promise((r) => {
    const t = setInterval(() => { if (logs.some((l) => l.includes('HTTP server'))) { clearInterval(t); r(); } }, 100);
    setTimeout(() => { clearInterval(t); r(); }, 3000);
});

await (async () => {
    const url = 'http://127.0.0.1:' + PORT + '/mcp';
    const transport = new StreamableHTTPClientTransport(new URL(url));
    const client = new Client({ name: 'snap-client', version: '1.0' }, { capabilities: {} });
    await client.connect(transport);
    const sessionId = transport.sessionId;

    // 建项目 + 模块（source 指向 client repo 的 src/a.ts, src/b.ts）
    await client.callTool({ name: 'normify_project_init', arguments: { project: 'snap' } });
    await client.callTool({ name: 'normify_module_upsert', arguments: { project: 'snap', frontmatter: { id: 'mod', name: { zh: 'M' }, description: { zh: 'd' }, state: 'active', fingerprint: 'pending', source: [{ path: 'src/a.ts' }, { path: 'src/b.ts' }] } } });

    // A-008 前提：server rootDir 不含 client 源码（server 无 client fs）
    await T('A-008 server rootDir 无 client 源码（隔离前提）', () => {
        eq(existsSync(join(serverRoot, 'src', 'a.ts')), false);
        eq(existsSync(join(serverRoot, 'src', 'b.ts')), false);
    });

    // client 本地读字节 + 推快照到 server session
    const fs = await import('node:fs/promises');
    const aBytes = (await fs.readFile(join(clientRepo, 'src', 'a.ts'))).toString('base64');
    const bBytes = (await fs.readFile(join(clientRepo, 'src', 'b.ts'))).toString('base64');
    const snapshot = {
        sessionId,
        files: { 'src/a.ts': aBytes, 'src/b.ts': bBytes },
        gitHead: { sha: '0'.repeat(40), error: null },
        gitChangedFiles: { files: ['src/a.ts', 'src/b.ts'], error: null },
    };
    const pushRes = await fetch('http://127.0.0.1:' + PORT + '/snapshot', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(snapshot) });
    await T('A-007 pushSnapshot 200 ok', async () => {
        eq(pushRes.status, 200);
        const j = await pushRes.json();
        eq(j.ok, true);
        eq(j.files, 2);
    });

    // HTTP normify_fingerprint（server 经 SessionCacheBridge 算；repoRoot dummy——bridge 忽略）
    const httpFp = await client.callTool({ name: 'normify_fingerprint', arguments: { repoRoot: '/', source: [{ path: 'src/a.ts' }, { path: 'src/b.ts' }] } });
    const httpParsed = JSON.parse(httpFp.content[0].text);

    // LocalBridge 直算（client repo 本地）
    const localBridge = new LocalBridge(clientRepo);
    const direct = await fingerprintOf(clientRepo, [{ path: 'src/a.ts' }, { path: 'src/b.ts' }], localBridge);

    await T('A-007 SessionCacheBridge fingerprint == LocalBridge 直算', () => {
        eq(httpParsed.ok, true);
        eq(httpParsed.fingerprint, direct.hash);
        eq(httpParsed.fingerprint !== null, true);
    });

    await T('A-008 HTTP fingerprint 在 server 无 client fs 时仍工作（经 cache）', () => {
        // server rootDir 无 src/a.ts，但 fingerprint ok → 证经 SessionCacheBridge 非直读 fs
        eq(httpParsed.ok, true);
    });

    // 缺文件场景：只推 a.ts，fingerprint 报 missing b.ts
    await fetch('http://127.0.0.1:' + PORT + '/snapshot', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId, files: { 'src/a.ts': aBytes } }) });
    const httpFp2 = await client.callTool({ name: 'normify_fingerprint', arguments: { repoRoot: '/', source: [{ path: 'src/a.ts' }, { path: 'src/b.ts' }] } });
    await T('A-007 缺文件 → missing 上报（cache 一致性）', () => {
        const p = JSON.parse(httpFp2.content[0].text);
        eq(p.ok, false);
        eq(p.missing.includes('src/b.ts'), true);
    });

    await client.close();
})().finally(() => {
    try { proc.kill('SIGKILL'); } catch {}
    try { rmSync(serverRoot, { recursive: true, force: true }); } catch {}
    try { rmSync(clientRepo, { recursive: true, force: true }); } catch {}
    console.log(`\n=== 结果：${pass} PASS, ${fail} FAIL ===`);
    if (fail > 0) process.exit(1);
});
