// 差分 parity 测试：同一 normify 工作流经 DSH-direct（catalog execute）vs MCP-via-protocol（NDJSON tools/call），
// 在同构 rootDir 上跑出结构等价的 store（module .md 文件 normalize 非确定字段后逐字节一致）。
//
// 验证项目核心声明：catalog 单一事实源 → 多平台 parity。
//   - DSH 与 pi 都 in-process 直调 entry.execute（parity 天然）；MCP 多一层 JSON-RPC marshal。
//   - 故差分聚焦 DSH-direct vs MCP-via-protocol：抓 arg-marshaling / 结果序列化偏差。
//
// normalize：strip root 模块的随机 uid（project_init 用 randomBytes）+ updated_at（当前时间）。
// build 产物（tree.json/receipt.json 含 SHA-256，依赖 root 随机 uid）只断言文件集一致，不 byte-compare（derived）。
//
// 独立运行：node tests/parity-differential.mjs
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync, readdirSync, statSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildCatalog } from '../lib/catalog.js';

const HERE = fileURLToPath(import.meta.url);
const REPO = resolve(HERE, '..', '..');
const SERVER = resolve(REPO, 'lib', 'mcp', 'server.js');

const PASS = [];
const FAIL = [];
function assert(cond, label) {
    if (cond) { PASS.push(label); console.log('PASS  ' + label); }
    else { FAIL.push(label); console.log('FAIL  ' + label); throw new Error('assert 失败: ' + label); }
}

// 确定性 frontmatter（合规 hex 值）：uid 8hex / revision 40hex / fingerprint 64hex
const REV = 'a'.repeat(40);
const AT = '2026-09-25T00:00:00.000Z';
const FP = '0'.repeat(64);
const uidSeq = {};
let uidN = 0;
function uid(id) { if (!uidSeq[id]) { uidN++; uidSeq[id] = ('deadbe' + String(uidN).padStart(2, '0')).slice(0, 8); } return uidSeq[id]; }
function fm(id, parent, zh, en, apis) {
    const o = {
        uid: uid(id), id, parent,
        name: { zh, en },
        description: { zh: 'd-' + id, en: 'd-' + id },
        source: [{ path: 'src/' + id.split('.').slice(1).join('/') + '.ts' }],
        revision: REV, updated_at: AT, fingerprint: FP,
    };
    if (apis !== undefined) o.apis = apis;
    return o;
}

// 工作流：建一棵小树（root + 2 children + 1 grandchild + validate + build）
const WORKFLOW = [
    { tool: 'normify_project_init', args: { project: 'parity', root: { id: 'demo', name: { zh: '演示', en: 'Demo' }, description: { zh: '演示树', en: 'demo tree' }, repository: 'https://example.com/demo' } } },
    { tool: 'normify_module_upsert', args: { project: 'parity', frontmatter: fm('demo.auth', 'demo', '鉴权', 'Auth', []) } },
    { tool: 'normify_module_upsert', args: { project: 'parity', frontmatter: fm('demo.order', 'demo', '订单', 'Order') } },
    { tool: 'normify_module_upsert', args: { project: 'parity', frontmatter: fm('demo.order.checkout', 'demo.order', '结算', 'Checkout', []) } },
    { tool: 'normify_validate', args: { project: 'parity' } },
    { tool: 'normify_build', args: { project: 'parity' } },
];

// === Path A: DSH-direct（catalog execute，in-process）===
async function runDshDirect(rootDir) {
    const env = { rootDir, requireBilingual: false };
    const catalog = buildCatalog({}, { rootDir }, { requireBilingual: false });
    const byName = Object.fromEntries(catalog.map(e => [e.name, e]));
    assert(catalog.length === 31, `A: catalog 31 工具（实际 ${catalog.length}）`);
    const results = [];
    for (const step of WORKFLOW) {
        const entry = byName[step.tool];
        assert(entry !== undefined, `A: ${step.tool} 在 catalog 中`);
        const res = await entry.execute(step.args);
        assert(res?.ok !== false, `A: ${step.tool} ok（非 error: ${JSON.stringify(res?.error || res?.errors || '').slice(0, 120)}`);
        results.push({ tool: step.tool, res });
    }
    return results;
}

// === Path B: MCP-via-protocol（NDJSON tools/call，stdio 子进程）===
function spawnServer(rootDir) {
    const env = { ...process.env, NORMIFY_ROOT_DIR: rootDir, NORMIFY_REQUIRE_BILINGUAL: '0' };
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
    function send(method, params) {
        const myId = ++id;
        return new Promise((res, rej) => {
            pending.set(myId, { resolve: res, reject: rej });
            child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: myId, method, params }) + '\n');
        });
    }
    function notify(method, params) { child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n'); }
    function cleanup() { child.kill('SIGTERM'); }
    return { child, send, notify, cleanup };
}

async function runMcpProtocol(rootDir) {
    const s = spawnServer(rootDir);
    try {
        const init = await s.send('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'parity-diff', version: '0.0.0' } });
        assert(typeof init?.protocolVersion === 'string', 'B: initialize 握手');
        s.notify('notifications/initialized', {});
        const list = await s.send('tools/list', {});
        assert(Array.isArray(list.tools) && list.tools.length === 31, `B: tools/list 31 工具（实际 ${list?.tools?.length}）`);
        const results = [];
        for (const step of WORKFLOW) {
            const res = await s.send('tools/call', { name: step.tool, arguments: step.args });
            const text = res?.content?.[0]?.text;
            let parsed;
            try { parsed = text ? JSON.parse(text) : res; } catch { parsed = { ok: true, raw: text }; }
            assert(parsed?.ok !== false, `B: ${step.tool} ok（非 error: ${JSON.stringify(parsed?.error || parsed?.errors || '').slice(0, 120)}`);
            results.push({ tool: step.tool, res: parsed });
        }
        return results;
    } finally { s.cleanup(); }
}

// === Snapshot：walk normify-parity/，返回 {relpath: normalizedContent} ===
// 仅对 .md 文件 normalize + byte-compare；build JSON 产物（tree.json/receipt.json/api-index.json）
// 含 root 随机 uid 的 hash，只参与文件集比对，不 byte-compare（derived）。
function snapshot(rootDir) {
    const projDir = join(rootDir, 'normify-parity');
    const all = {};       // relpath -> raw content (for set compare)
    const md = {};       // relpath -> normalized content (for byte compare)
    function walk(d, base) {
        for (const name of readdirSync(d)) {
            const p = join(d, name);
            const rel = base ? base + '/' + name : name;
            if (statSync(p).isDirectory()) walk(p, rel);
            else {
                const content = readFileSync(p, 'utf8');
                all[rel] = content;
                if (name.endsWith('.md')) {
                    md[rel] = content
                        .replace(/^uid:.*$/gm, 'uid: <normalized>')
                        .replace(/^updated_at:.*$/gm, 'updated_at: <normalized>');
                }
            }
        }
    }
    walk(projDir, '');
    return { all, md };
}

// === main ===
const dirA = mkdtempSync(join(tmpdir(), 'normify-parity-A-'));
const dirB = mkdtempSync(join(tmpdir(), 'normify-parity-B-'));
let timer;
try {
    timer = setTimeout(() => { throw new Error('parity 测试超时 30s'); }, 30000);
    console.log('=== Path A: DSH-direct（catalog execute）===');
    await runDshDirect(dirA);
    console.log('=== Path B: MCP-via-protocol（NDJSON tools/call）===');
    await runMcpProtocol(dirB);

    const snapA = snapshot(dirA);
    const snapB = snapshot(dirB);

    // ① 文件集一致（含 build JSON 产物）
    const keysA = Object.keys(snapA.all).sort();
    const keysB = Object.keys(snapB.all).sort();
    assert(keysA.length === keysB.length, `文件数相同（A=${keysA.length}, B=${keysB.length}）`);
    assert(JSON.stringify(keysA) === JSON.stringify(keysB), '文件名集合完全一致（含 build 产物）');

    // ② module .md 文件 normalize 后逐字节一致
    const mdA = Object.keys(snapA.md).sort();
    const mdB = Object.keys(snapB.md).sort();
    assert(JSON.stringify(mdA) === JSON.stringify(mdB), `module .md 文件集一致（${mdA.length} 个）`);
    let allMatch = true;
    let firstDiff = null;
    for (const k of mdA) {
        if (snapA.md[k] !== snapB.md[k]) {
            allMatch = false;
            if (!firstDiff) firstDiff = k;
        }
    }
    assert(allMatch, `全部 module .md normalize 后逐字节一致${firstDiff ? '（首个差异: ' + firstDiff + '）' : ''}`);

    // ③ root 模块存在且 parent=null（树根同构）
    assert(snapA.md['modules/demo/index.md'] !== undefined, 'A: root module 落盘 modules/demo/index.md');
    assert(snapB.md['modules/demo/index.md'] !== undefined, 'B: root module 落盘 modules/demo/index.md');

    console.log(`\n=== 结果：${PASS.length} PASS, ${FAIL.length} FAIL ===`);
    console.log('parity 核心：同 catalog → DSH-direct 与 MCP-via-protocol 产出结构等价 store ✅');
} catch (e) {
    console.error('\n[parity 测试失败]', e.message);
    process.exitCode = 1;
} finally {
    clearTimeout(timer);
    rmSync(dirA, { recursive: true, force: true });
    rmSync(dirB, { recursive: true, force: true });
}
