// pi 扩展适配器：把 normify catalog 暴露给 @earendil-works/pi-coding-agent。
// 平台无关：直接复用 buildCatalog + ToolEntry.execute（不重声明工具、不重裹 execute）。
// InfraEnv/Policy 从环境变量读：NORMIFY_ROOT_DIR（默认 cwd）、NORMIFY_REQUIRE_BILINGUAL（默认 '1'→true）。
// pi 运行时加载本源文件（.ts，自动发现 glob）；lib/pi/normify.js 供单测 + 构建工件。
import { Type } from 'typebox';
import { StringEnum } from '@earendil-works/pi-ai';
import { buildCatalog } from '../catalog.js';
import { companionReminder, parseCompanionConfig, WRITE_TOOLS } from '../companion.js';
/**
 * 节点级 JSON Schema → typebox 投影（递归）。
 * 覆盖 string/number/boolean/array/object；string 上的 enum → StringEnum（前向兼容）。
 */
export function schemaToTypebox(node) {
    const t = node.type;
    if (t === 'string') {
        // enum:[...]（前向兼容；当前 catalog 0 enum，单测合成触发）
        if (Array.isArray(node.enum) && node.enum.length > 0)
            return StringEnum(node.enum);
        return Type.String({ description: node.description });
    }
    if (t === 'number')
        return Type.Number({ description: node.description });
    if (t === 'boolean')
        return Type.Boolean({ description: node.description });
    if (t === 'array')
        return Type.Array(node.items ? schemaToTypebox(node.items) : Type.Any(), {
            description: node.description,
        });
    if (t === 'object') {
        if (node.properties)
            return objectSchemaToTypebox(node);
        return Type.Any({ description: node.description }); // freeObjectParam：无 properties 的自由对象
    }
    return Type.Any(); // 未知 type 兜底
}
/**
 * 对象级投影：读对象级 required: string[]，属性名在 required 内→必填，否则 Type.Optional。
 * 返回 Type.Object({...}, { additionalProperties: false })（closed object，与 catalog 编译形态一致）。
 */
export function objectSchemaToTypebox(schema) {
    const props = {};
    const required = new Set(schema.required ?? []);
    for (const [key, sub] of Object.entries(schema.properties ?? {})) {
        const projected = schemaToTypebox(sub);
        props[key] = required.has(key) ? projected : Type.Optional(projected);
    }
    return Type.Object(props, { additionalProperties: false });
}
/**
 * 错误载荷 → 可读文本（镜像 S2 MCP errorText 形状）；成功 → 字符串原样 / 对象 JSON。
 * pi 的 AgentToolResult 无 isError 字段（实测 pi-agent-core），错误经 content 文本传达。
 * - 简单错误 {ok:false,error:{code,message}} → `[code] message`
 * - 丰富错误 {ok:false,errors[],summary?} → `summary? + errors.join('\n')`
 * - 字符串成功 → 原样
 * - 其他（含 ok:true 成功对象）→ JSON.stringify
 */
export function formatResultText(value) {
    if (typeof value === 'string')
        return value;
    if (typeof value === 'object' && value !== null && value.ok === false) {
        const e = value;
        if (e.error)
            return `[${e.error.code ?? '?'}] ${e.error.message ?? ''}`;
        if (Array.isArray(e.errors)) {
            const head = e.summary ? e.summary + '\n' : '';
            return head + e.errors.map((x) => `[${x.code ?? '?'}] ${x.message ?? ''}`).join('\n');
        }
    }
    return JSON.stringify(value, null, 2);
}
/**
 * 遍历 buildCatalog({}, infra, policy)，对每个 entry 调 pi.registerTool。
 * execute 转调 entry.execute（已含 missing-args + toErrorPayload，平台无关），结果经 formatResultText 入 content。
 */
export function registerPiTools(pi, infra, policy) {
    const catalog = buildCatalog({}, infra, policy);
    for (const entry of catalog) {
        pi.registerTool({
            name: entry.name,
            label: entry.name,
            description: entry.description,
            promptSnippet: entry.name,
            parameters: objectSchemaToTypebox(entry.parameters),
            async execute(_toolCallId, params) {
                const value = await entry.execute(params);
                return {
                    content: [{ type: 'text', text: formatResultText(value) }],
                    details: value,
                };
            },
        });
    }
}
// §5.2 S5 pi companion handler（纯导出函数，可 hermetic 测，镜像 S3 formatResultText F-039 提取先例）。
// 闭包计数器（factory per-call 新建）；WRITE_TOOLS 匹配外部 write/edit（pi 复刻 DSH 语义）；
// 达阈值时重置 count=0（F-034，镜像 DSH L72 在 nextFn 前）；仅 !event.isError 时返回改写 content
// （pi L258 REPLACE：hookResult?.content ?? result.content——handler 须读 event.content 再拼接）。
export function createCompanionHandler(config) {
    let count = 0;
    return (event) => {
        if (!config.enabled)
            return; // F-059 首检查短路
        if (!WRITE_TOOLS.test(event.toolName))
            return; // 非 write/edit 外部工具
        count++;
        if (count < config.threshold)
            return; // 未达阈值
        count = 0; // F-034 达阈值即重置（镜像 DSH L72）
        if (event.isError)
            return; // 仅 !isError 时注入（镜像 DSH accept）
        return { content: [...event.content, { type: 'text', text: companionReminder(config.threshold) }] };
    };
}
// env 来源：ExtensionAPI 无 cwd 字段（实测 types.d.ts），rootDir 从环境变量读（与 MCP 同源）
export default function (pi) {
    const infra = {
        rootDir: process.env.NORMIFY_ROOT_DIR ?? process.cwd(),
    };
    const policy = {
        requireBilingual: (process.env.NORMIFY_REQUIRE_BILINGUAL ?? '1') !== '0',
    };
    registerPiTools(pi, infra, policy);
    // §5.2 S5 companion 提醒钩子：pi.on('tool_result') 覆盖所有工具（bash/edit/write/.../Custom），
    // WRITE_TOOLS 匹配外部 write/edit（pi 复刻 DSH 语义；normify_* 走 Custom 不匹配 regex，不计）。
    // handler 返回改写 content（pi L258 REPLACE：hookResult?.content ?? result.content）。
    const companionConfig = parseCompanionConfig(process.env);
    pi.on('tool_result', createCompanionHandler(companionConfig));
}
//# sourceMappingURL=normify.js.map