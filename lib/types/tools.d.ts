import type { InfraEnv, Policy } from './catalog.js';
import type { Context } from '@deepseek-ai/cordis';
/** DSH 适配器：遍历 buildCatalog 产出的 ToolEntry，补 DSH 专属字段后注册。
 *  toolenv-split：registerTools(ctx, infra, policy)——无 auth（security=undefined）；DSH harness 经 apply(ctx, config) 调用。 */
export declare function registerTools(ctx: Context, infra: InfraEnv, policy: Policy): void;
