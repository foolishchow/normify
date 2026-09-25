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
    // A-001/A-006: §3.1 annotations 三映射（read→readOnlyHint:true、write→readOnlyHint:false、destroy→destructiveHint:true）
    const byName = Object.fromEntries(list.tools.map(t => [t.name, t]));
    assert(byName['normify_help']?.annotations?.readOnlyHint === true, '③f normify_help(read) annotations.readOnlyHint===true');
    assert(byName['normify_module_upsert']?.annotations?.readOnlyHint === false, '③g normify_module_upsert(write) annotations.readOnlyHint===false');
    assert(byName['normify_module_delete']?.annotations?.destructiveHint === true, '③h normify_module_delete(destroy) annotations.destructiveHint===true');

    // ④ tools/call normify_help {topic:'tools'}（只读、纯——不触 fs/requireBilingual）
    const call = await send('tools/call', { name: 'normify_help', arguments: { topic: 'tools' } });
    assert(call.isError === false, '④ call normify_help(topic=tools) → isError===false');
    assert(call.content && call.content.length > 0 && typeof call.content[0].text === 'string' && call.content[0].text.length > 0, '④b content[0].text 非空');
    // A-003: 成功路径 content 不变（JSON.stringify 的 {ok:true,...}，以 { 开头）
    assert(call.content[0].text.startsWith('{'), '④c 成功路径 content 以 { 开头（JSON，非 errorText）');

    // ⑤ tools/call 未知工具 'nope'
    const unk = await send('tools/call', { name: 'nope', arguments: {} });
    assert(unk.isError === true, '⑤ call 未知工具 nope → isError===true');

    // ⑥ tools/call normify_help {topic:'nope'}（A-002/A-007：简单错误→模型可读 [code] message）
    const err = await send('tools/call', { name: 'normify_help', arguments: { topic: 'nope' } });
    assert(err.isError === true, '⑥ call normify_help(topic=nope) → isError===true');
    assert(typeof err.content?.[0]?.text === 'string' && err.content[0].text.startsWith('[args/invalid-topic]'), '⑥b content 以 [args/invalid-topic] 开头（模型可读，非裸 JSON）');
    assert(!err.content[0].text.startsWith('{'), '⑥c content 不以 { 开头（非裸 JSON）');

    // A-008（SHOULD）豁免：富错误形状（{errors[],summary}）须经含 malformed module 的 fs-fixture 项目触发
    //   （normify_validate/build/batch 等富错误工具均触 fs；无 hermetic 纯触发路径，G-002 允许降代码审查）。
    //   errorText 富分支经代码审查 + 简单错误路径 A-002 兑底（isError→errorText→[code] message 机制同构）。
    console.log('SKIP  A-008 富错误 fs-fixture：豁免（G-002，无 hermetic 触发路径，代码审查 + A-002 兑底）');

    console.log('=== 结果：全部 PASS（' + PASS.length + ' 项，A-008 豁免）===');
} finally {
    if (timer) clearTimeout(timer);
    child.kill('SIGTERM');
}
