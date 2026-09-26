import { buildCatalog } from './catalog.js';
/** DSH 适配器：遍历 buildCatalog 产出的 ToolEntry，补 DSH 专属字段后注册。
 *  toolenv-split：registerTools(ctx, infra, policy)——无 auth（security=undefined）；DSH harness 经 apply(ctx, config) 调用。 */
export function registerTools(ctx, infra, policy) {
    const catalog = buildCatalog({}, infra, policy);
    const tools = ctx.tools;
    if (tools === undefined || tools.register === undefined)
        return;
    for (const entry of catalog) {
        const behavior = entry.behavior;
        tools.register({
            ...entry,
            readOnly: behavior === 'read',
            idempotent: behavior === 'read' || behavior === 'idempotent' || behavior === 'destroy',
            destructive: behavior === 'destroy',
            output: {
                schema: {},
                render: (_args, value) => [
                    { type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) },
                ],
            },
            ...(behavior === 'read' ? { isConcurrencySafe: () => true } : {}),
        });
    }
}
//# sourceMappingURL=tools.js.map