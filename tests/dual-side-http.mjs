// dual-side-mode DP2 验收测试（A-003 / A-004 + DSH vs HTTP parity）。
// 启 HTTP MCP server（NORMIFY_TRANSPORT=http），MCP SDK client 连：
//   A-003：initialize → tools/list 返 31 → tools/call normify_help ok。
//   A-004：两并发 session companion 计数互不干扰（session-isolation 抽象 HTTP 复用）。
//   parity：DSH-direct（in-process catalog）vs HTTP-MCP-client 同工作流产出等价 store。
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { buildCatalog } from '../lib/catalog.js';

let pass = 0, fail = 0;
const T = (name, fn) => Promise.resolve(fn()).then(() => { pass++; console.log('PASS ' + name); }, (e) => { fail++; console.log('FAIL ' + name + '\n  ' + (e?.stack || e)); });
const eq = (a, b, m) => assert.strictEqual(a, b, m);

const PORT = String(3939 + Math.floor(Math.random() * 1000));
const root = mkdtempSync(join(tmpdir(), 'normify-http-'));
mkdirSync(join(root, 'normify-demo', 'modules'), { recursive: true });

// 启 HTTP server
const proc = spawn(process.execPath, ['lib/mcp/server.js'], {
    env: { ...process.env, NORMIFY_TRANSPORT: 'http', NORMIFY_PORT: PORT, NORMIFY_ROOT_DIR: root, NORMIFY_DEV_COMPANION_REMINDER: '1', NORMIFY_DEV_COMPANION_REMINDER_AFTER: '3' },
    stdio: ['ignore', 'pipe', 'pipe'],
});
const logs = [];
proc.stdout.on('data', (d) => logs.push(String(d)));
proc.stderr.on('data', (d) => logs.push(String(d)));
// 等 server ready
await new Promise((r) => {
    const t = setInterval(() => { if (logs.some((l) => l.includes('HTTP server'))) { clearInterval(t); r(); } }, 100);
    setTimeout(() => { clearInterval(t); r(); }, 3000);
});

async function makeClient() {
    const transport = new StreamableHTTPClientTransport(new URL('http://127.0.0.1:' + PORT + '/mcp'));
    const client = new Client({ name: 'test-client', version: '1.0' }, { capabilities: {} });
    await client.connect(transport);
    return { client, transport };
}

const shutdown = async () => { try { proc.kill('SIGKILL'); } catch {} rmSync(root, { recursive: true, force: true }); };

await (async () => {
    // A-003：initialize → tools/list 返 31 → normify_help call ok
    await T('A-003 HTTP client initialize ok', async () => {
        const { transport } = await makeClient();
        eq(typeof transport.sessionId, 'string');
    });
    await T('A-003 tools/list 返 31', async () => {
        const { client } = await makeClient();
        const r = await client.listTools();
        eq(Array.isArray(r.tools), true);
        eq(r.tools.length, 31);
        eq(r.tools.some(t => t.name === 'normify_help'), true);
    });
    await T('A-003 tools/call normify_help ok', async () => {
        const { client } = await makeClient();
        const r = await client.callTool({ name: 'normify_help', arguments: {} });
        eq(r.isError, false);
        eq(r.content[0].text.length > 0, true);
    });

    // A-004：两并发 session companion 计数互不干扰
    // 护掌：A 调 2 次 write（count=2<3，无 reminder）；B 调 1 次：独立=count1 无 reminder（content len 1）；
    // 共享 bug=count2+1=3 reset+reminder（content len 2）。用 project_init（write，简单、每调新项目必成）
    await T('A-004 两并发 session companion 互不干扰', async () => {
        const a = await makeClient();
        const b = await makeClient();
        // A 调 2 次 write（project_init，每调新项目）→ count=2<3，无 reminder（content len 1）
        for (const p of ['a1', 'a2']) {
            const r = await a.client.callTool({ name: 'normify_project_init', arguments: { project: p } });
            if (r.isError) console.log('  [debug A ' + p + ' error]', r.content[0]?.text);
            eq(r.isError, false);
            eq(r.content.length, 1); // 无 reminder（count<3）
        }
        // B 调 1 次 write → 独立 count=1 无 reminder（content len 1）；共享 bug count=3 reset+reminder（content len 2）
        const rb = await b.client.callTool({ name: 'normify_project_init', arguments: { project: 'b1' } });
        if (rb.isError) console.log('  [debug B error]', rb.content[0]?.text);
        eq(rb.isError, false);
        eq(rb.content.length, 1); // 独立：无 reminder（抓 shared-count bug）
    });

    // parity：DSH-direct（in-process catalog execute）vs HTTP-MCP-client 同工作流
    // 用 read 工具（module_list）避开 companion 干扰：两路径同 project_init → module_upsert → module_list
    await T('parity DSH-direct vs HTTP-MCP store 等价', async () => {
        // DSH-direct 路径：in-process buildCatalog + execute
        const rootDsh = mkdtempSync(join(tmpdir(), 'normify-dsh-'));
        const cat = buildCatalog({}, { rootDir: rootDsh }, { requireBilingual: true });
        const r1 = await cat.find(e => e.name === 'normify_project_init').execute({ project: 'parity' });
        eq(r1.ok, true);
        await cat.find(e => e.name === 'normify_module_upsert').execute({ project: 'parity', frontmatter: { id: 'm1', name: { zh: 'M1' }, description: { zh: 'd' }, state: 'planned', fingerprint: 'pending', source: [] } });
        await cat.find(e => e.name === 'normify_module_upsert').execute({ project: 'parity', frontmatter: { id: 'm2', name: { zh: 'M2' }, description: { zh: 'd' }, state: 'planned', fingerprint: 'pending', source: [] } });
        const dshList = await cat.find(e => e.name === 'normify_module_list').execute({ project: 'parity' });
        const dshFiles = readdirSync(join(rootDsh, 'normify-parity', 'modules')).map(f => f).sort();

        // HTTP 路径：client tools/call 同工作流
        const rootHttp = mkdtempSync(join(tmpdir(), 'normify-http2-'));
        const proc2 = spawn(process.execPath, ['lib/mcp/server.js'], {
            env: { ...process.env, NORMIFY_TRANSPORT: 'http', NORMIFY_PORT: String(Number(PORT) + 1), NORMIFY_ROOT_DIR: rootHttp },
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        await new Promise((r) => {
            const t = setInterval(() => {
                let out = '';
                proc2.stdout.on('data', (d) => { out += d; });
                proc2.stderr.on('data', (d) => { out += d; });
                if (out.includes('HTTP server')) { clearInterval(t); r(); }
            }, 100);
            setTimeout(() => { clearInterval(t); r(); }, 3000);
        });
        const { client } = await (async () => {
            const tr = new StreamableHTTPClientTransport(new URL('http://127.0.0.1:' + (Number(PORT) + 1) + '/mcp'));
            const cl = new Client({ name: 'parity-client', version: '1.0' }, { capabilities: {} });
            await cl.connect(tr);
            return { client: cl };
        })();
        await client.callTool({ name: 'normify_project_init', arguments: { project: 'parity' } });
        for (const id of ['m1', 'm2']) {
            await client.callTool({ name: 'normify_module_upsert', arguments: { project: 'parity', frontmatter: { id, name: { zh: id.toUpperCase() }, description: { zh: 'd' }, state: 'planned', fingerprint: 'pending', source: [] } } });
        }
        const httpList = await client.callTool({ name: 'normify_module_list', arguments: { project: 'parity' } });
        const httpFiles = readdirSync(join(rootHttp, 'normify-parity', 'modules')).map(f => f).sort();
        proc2.kill('SIGKILL');
        rmSync(rootDsh, { recursive: true, force: true });
        rmSync(rootHttp, { recursive: true, force: true });

        // 文件集一致
        eq(JSON.stringify(dshFiles), JSON.stringify(httpFiles));
        // module_list 返回 count 一致（HTTP 返回 {ok,count,modules}，content[0].text 是 JSON）
        const httpParsed = JSON.parse(httpList.content[0].text);
        eq(dshList.count, httpParsed.count);
    });
})().finally(async () => {
    await shutdown();
    console.log(`\n=== 结果：${pass} PASS, ${fail} FAIL ===`);
    if (fail > 0) process.exit(1);
});
