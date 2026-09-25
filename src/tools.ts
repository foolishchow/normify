import { buildCatalog } from './catalog.js';
import type { ToolEntry, ToolEnv, ToolBehavior, ObjectSchema } from './catalog.js';
import type { Context } from '@deepseek-ai/cordis';

/** dsh-tools 服务的注册面（可选外部服务）。 */
interface ToolService {
    register?: (def: ToolRegistration) => void;
}

/** 交给 tools.register 的注册对象。 */
interface ToolRegistration {
    name: string;
    description: string;
    behavior: ToolBehavior;
    parameters?: ObjectSchema;
    readOnly: boolean;
    idempotent: boolean;
    destructive: boolean;
    output: {
        schema: Record<string, unknown>;
        render: (args: Record<string, unknown>, value: unknown) => { type: string; text: string | undefined }[];
    };
    execute: (args: Record<string, unknown>) => Promise<unknown>;
    isConcurrencySafe?: () => boolean;
}

/** DSH 适配器：遍历 buildCatalog 产出的 ToolEntry，补 DSH 专属字段后注册。
 *  execute 直接用 entry.execute（已含 missing-args + toErrorPayload，platform-agnostic）。 */
export function registerTools(ctx: Context, env: ToolEnv): void {
    const catalog = buildCatalog(env);
    const tools = (ctx as unknown as { tools?: ToolService }).tools;
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
