// MCP smoke test：启动 server（stdio 子进程），走 newline-delimited JSON-RPC 2.0，
// 验证 tools/list 返回 31 个工具 + tools/call 只读成功 + tools/call 未知工具报错。
// 不接入 npm test（S6 职责），独立运行：node tests/mcp-smoke.mjs
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(import.meta.url);
const REPO = resolve(HERE, '..', '..');
const SERVER = resolve(REPO, 'lib', 'mcp', 'server.js');

const child = spawn('node', [SERVER], { cwd: REPO, stdio: ['pipe', 'pipe', 'pipe'] });

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
        // 无 id 的为 notification，不期望从 server 收到，忽略
    }
});
child.stderr.on('data', (d) => { /* server 诊断日志，不影响断言 */ });

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

const PASS = [];
function assert(cond, label) {
    if (cond) { PASS.push(label); console.log('PASS  ' + label); }
    else { console.log('FAIL  ' + label); throw new Error('assert 失败: ' + label); }
}

let timer;
try {
    timer = setTimeout(() => { child.kill('SIGTERM'); throw new Error('smoke 超时 10s'); }, 10000);

    // ① initialize 握手（请求→响应）
    const init = await send('initialize', {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'normify-smoke', version: '0.0.0' },
    });
    assert(typeof init?.protocolVersion === 'string', '① initialize 握手成功（server 返回 protocolVersion）');
    assert(typeof init?.serverInfo?.name === 'string', '①b server 返回 serverInfo.name');

    // ② notifications/initialized（notification，无响应；MCP 规定 server 收此才接受后续请求）
    notify('notifications/initialized', {});

    // ③ tools/list —— 31 个工具
    const list = await send('tools/list', {});
    assert(Array.isArray(list.tools) && list.tools.length === 31, '③ tools/list 返回恰好 31 个工具');
    const names = list.tools.map(t => t.name);
    assert(names.includes('normify_help'), '③b 含 normify_help');
    assert(names.includes('normify_module_batch'), '③c 含 normify_module_batch');
    assert(names.includes('normify_project_init'), '③d 含 normify_project_init');
    assert(list.tools.every(t => t.inputSchema && t.inputSchema.type === 'object'), '③e 每个工具 inputSchema 带 type:object');

    // ④ tools/call normify_help {topic:'tools'}（只读、纯——不触 fs/requireBilingual）
    const call = await send('tools/call', { name: 'normify_help', arguments: { topic: 'tools' } });
    assert(call.isError === false, '④ call normify_help(topic=tools) → isError===false');
    assert(call.content && call.content.length > 0 && typeof call.content[0].text === 'string' && call.content[0].text.length > 0, '④b content[0].text 非空');

    // ⑤ tools/call 未知工具 'nope'
    const unk = await send('tools/call', { name: 'nope', arguments: {} });
    assert(unk.isError === true, '⑤ call 未知工具 nope → isError===true');

    console.log('=== 结果：全部 PASS（' + PASS.length + ' 项）===');
} finally {
    if (timer) clearTimeout(timer);
    child.kill('SIGTERM');
}
