// pi companion-only 扩展验收（pi 0.99.2+ 原生 MCP 后）。
// pi 原生 MCP 连 server 注册 31 工具（非本扩展职责）；本测试验：
//   A-006①：default 出口注册 tool_result handler（wiring）。
//   A-006②：N 次外部写（WRITE_TOOLS）后 reminder（第 3 次 push）+ 计数重置。
//   A-006③：非 WRITE_TOOLS 不计。
//   A-006④：isError=true 达阈值 void（仅 !isError 注入）。
// companion handler 行为：A-006 覆 createCompanionHandler from normify-client.js（独立实现，不依赖 catalog/engine）。
process.env.NORMIFY_DEV_COMPANION_REMINDER = '1';
process.env.NORMIFY_DEV_COMPANION_REMINDER_AFTER = '3';

import assert from 'node:assert';
import defaultExport, { createCompanionHandler } from '../lib/pi/normify-client.js';

let pass = 0, fail = 0;
const T = (name, fn) => Promise.resolve().then(() => fn()).then(() => { pass++; console.log('PASS ' + name); }, (e) => { fail++; console.log('FAIL ' + name + '\n  ' + (e?.stack || e)); });
const eq = (a, b, m) => assert.strictEqual(a, b, m);

// fake ExtensionAPI：存 tool_result handler
function makeFakePi() {
    return {
        toolResultHandler: null,
        on(event, handler) { if (event === 'tool_result') this.toolResultHandler = handler; },
    };
}

await (async () => {
    // A-006①：default 出口注册 tool_result handler
    await T('A-006① default 出口注册 tool_result handler（wiring）', () => {
        const pi = makeFakePi();
        defaultExport(pi);
        eq(typeof pi.toolResultHandler, 'function');
    });

    // 经 default 出口注册的 handler 测行为（wiring 真接 createCompanionHandler）
    const pi = makeFakePi();
    defaultExport(pi);
    const h = pi.toolResultHandler;
    const mk = (tool = 'edit', isErr = false) => ({ toolName: tool, isError: isErr, content: [{ type: 'text', text: 'ok' }] });

    // A-006②：3 次外部 write 后 reminder（第 3 次 push）+ 重置
    await T('A-006② 3 次外部 write 后 reminder（第 3 次 push）+ 重置', () => {
        eq(h(mk()), undefined);            // count 1 < 3
        eq(h(mk()), undefined);            // count 2 < 3
        const r3 = h(mk());                // count 3 → reset + reminder
        eq(Array.isArray(r3?.content), true);
        eq(r3.content.length, 2);          // 原 + reminder
        eq(r3.content[1].text.includes('已连续修改'), true);
    });

    // A-006②b：计数重置后再 1 次 void（F-034 镜像 DSH 重置）
    await T('A-006②b 计数重置后 1 次 void', () => {
        eq(h(mk()), undefined);            // count 1 < 3（重置后）
    });

    // A-006③：非 WRITE_TOOLS 不计（bash 不匹配）
    await T('A-006③ 非 WRITE_TOOLS 不计', () => {
        eq(h(mk('bash')), undefined);
    });

    // A-006④：isError=true 达阈值 void（仅 !isError 注入）
    await T('A-006④ isError=true 达阈值 void（仅 !isError 注入）', () => {
        // 先 2 次 !isError 凑到 count=2，第 3 次 isError=true → 达阈值但不注入
        const local = createCompanionHandler({ enabled: true, threshold: 3 });
        eq(local(mk('edit', false)), undefined);   // 1
        eq(local(mk('edit', false)), undefined);   // 2
        eq(local(mk('edit', true)), undefined);     // 3 达阈值但 isError → void（仍重置）
        eq(local(mk('edit', false)), undefined);   // 重置后 1
    });

    console.log(`\n=== 结果：${pass} PASS, ${fail} FAIL ===`);
    if (fail > 0) process.exit(1);
})();
