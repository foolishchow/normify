// pi-projection 单测：投影函数（schemaToTypebox/objectSchemaToTypebox）+ formatResultText。
// 不接入 npm test（S6 职责），独立运行：node tests/pi-projection.mjs
// import 从编译产物 lib/pi/normify.js（ESM，type:module）。

import { schemaToTypebox, objectSchemaToTypebox, formatResultText, createCompanionHandler } from '../lib/pi/normify.js';

let pass = 0;
let fail = 0;

function assert(name, actual, expected) {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a === e) {
        console.log(`PASS ${name}`);
        pass++;
    } else {
        console.log(`FAIL ${name}\n  expected: ${e}\n  actual:   ${a}`);
        fail++;
    }
}

function assertEq(name, actual, expected) {
    if (actual === expected) {
        console.log(`PASS ${name}`);
        pass++;
    } else {
        console.log(`FAIL ${name}\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`);
        fail++;
    }
}

// === 投影：7 基础形状 ===

// string
assert('string type', schemaToTypebox({ type: 'string' }).type, 'string');
assert('string description', schemaToTypebox({ type: 'string', description: 'd' }).description, 'd');

// number
assert('number type', schemaToTypebox({ type: 'number' }).type, 'number');

// boolean
assert('boolean type', schemaToTypebox({ type: 'boolean' }).type, 'boolean');

// array（带 items）
const arr = schemaToTypebox({ type: 'array', items: { type: 'string' } });
assert('array type', arr.type, 'array');
assert('array items.type', arr.items.type, 'string');

// array（无 items → items=Any）
assert('array no-items type', schemaToTypebox({ type: 'array' }).type, 'array');

// object 无 properties（freeObjectParam → Type.Any，typebox Any schema 无 type 字段）
const free = schemaToTypebox({ type: 'object' });
assert('object no-props -> Any (no type)', free.type, undefined);
assert('object no-props -> Any (no properties)', free.properties, undefined);
const freeDesc = schemaToTypebox({ type: 'object', description: 'free-form' });
assert('object no-props description passthrough', freeDesc.description, 'free-form');

// === objectSchemaToTypebox：对象级 required → 必填/可选 ===

const obj = objectSchemaToTypebox({
    type: 'object',
    properties: {
        name: { type: 'string' },          // required (in required[])
        count: { type: 'number' },         // optional
        flag: { type: 'boolean' },         // optional
        items: { type: 'array', items: { type: 'string' } },  // optional
        meta: { type: 'object', properties: { id: { type: 'string' } } },  // optional nested
    },
    required: ['name'],
});

assert('object type', obj.type, 'object');
assert('object required=[name]', obj.required, ['name']);  // name 必填，count/flag/items/meta 不在 required[]
assert('object additionalProperties=false', obj.additionalProperties, false);
assert('object props.name.type', obj.properties.name.type, 'string');
assert('object props.count.type', obj.properties.count.type, 'number');
assert('object props.items array', obj.properties.items.type, 'array');
assert('object props.items.items.type', obj.properties.items.items.type, 'string');
assert('object props.meta nested object', obj.properties.meta.type, 'object');
assert('object props.meta.properties.id', obj.properties.meta.properties.id.type, 'string');

// === enum → StringEnum（前向兼容，catalog 当前 0 enum，合成触发）===

const en = schemaToTypebox({ type: 'string', enum: ['a', 'b'] });
assert('enum -> type=string', en.type, 'string');
assert('enum -> enum=[a,b]', en.enum, ['a', 'b']);

// === formatResultText：4 形状 ===

// (1) 字符串成功 → 原样
assertEq('fmt string passthrough', formatResultText('hello'), 'hello');

// (2) 简单错误 {ok:false,error:{code,message}} → `[code] message`
assertEq(
    'fmt simple error',
    formatResultText({ ok: false, error: { code: 'args/invalid-topic', message: 'topic must be non-empty' } }),
    '[args/invalid-topic] topic must be non-empty',
);

// (3) 丰富错误 {ok:false,errors[],summary?} → `summary + errors.join('\n')`
assertEq(
    'fmt rich error (with summary)',
    formatResultText({
        ok: false,
        errors: [
            { code: 'l1/duplicate-id', message: 'dup' },
            { code: 'l1/bad-dep', message: 'bad dep' },
        ],
        summary: '2 errors',
    }),
    '2 errors\n[l1/duplicate-id] dup\n[l1/bad-dep] bad dep',
);

// (3b) 丰富错误（无 summary → 无前导空行，F-021 同构）
assertEq(
    'fmt rich error (no summary)',
    formatResultText({
        ok: false,
        errors: [{ code: 'x', message: 'm1' }],
    }),
    '[x] m1',
);

// (4) 成功对象（ok:true）→ JSON.stringify
const okJson = formatResultText({ ok: true, modules: [{ id: 'a' }] });
assertEq('fmt success object -> JSON', okJson, JSON.stringify({ ok: true, modules: [{ id: 'a' }] }, null, 2));

// === S5 A-002：createCompanionHandler（纯函数，无 pi runtime 依赖）===
// threshold=3；mock ToolResultEvent（toolName='write'）；第 3 次 content length===2 + content[1].text 含 [normify]；第 4 次 void
function mockEvent(i) {
    return {
        type: 'tool_result',
        toolCallId: 'c' + i,
        toolName: 'write',
        input: {},
        content: [{ type: 'text', text: 'ok' }],
        isError: false,
    };
}
const handler = createCompanionHandler({ enabled: true, threshold: 3 });

const r1 = handler(mockEvent(1));
assertEq('S5 A-002 ① write #1 (count=1<3) -> void', r1, undefined);

const r2 = handler(mockEvent(2));
assertEq('S5 A-002 ② write #2 (count=2<3) -> void', r2, undefined);

const r3 = handler(mockEvent(3));
assertEq('S5 A-002 ③ write #3 (达阈值 3, !isError) -> content length===2', r3?.content?.length, 2);
assertEq('S5 A-002 ③b content[1].text 含 [normify] 已连续修改', typeof r3?.content?.[1]?.text === 'string' && r3.content[1].text.includes('[normify] 已连续修改'), true);
assertEq('S5 A-002 ③c content[0] 保留原 text ok', r3?.content?.[0]?.text, 'ok');

const r4 = handler(mockEvent(4));
assertEq('S5 A-002 ④ write #4 (计数已重置 count=1<3) -> void (F-057)', r4, undefined);

// S5 A-005（pi 侧）：!config.enabled 短路（F-059）
const offHandler = createCompanionHandler({ enabled: false, threshold: 3 });
for (let i = 1; i <= 3; i++) {
    const r = offHandler(mockEvent(i));
    assertEq('S5 A-005(pi) ①-' + i + ' enabled=false -> void (F-059 短路)', r, undefined);
}

// S5 附加：isError=true 不注入（计数已重置）
const errHandler = createCompanionHandler({ enabled: true, threshold: 1 });
const re = errHandler({ ...mockEvent(1), isError: true });
assertEq('S5 附加 isError=true (达阈值 1) -> void (仅 !isError 注入)', re, undefined);

console.log(`\n=== 结果：${pass} PASS, ${fail} FAIL ===`);
process.exit(fail === 0 ? 0 : 1);
