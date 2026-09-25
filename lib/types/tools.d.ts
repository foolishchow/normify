import type { ToolEnv } from './catalog.js';
import type { Context } from '@deepseek-ai/cordis';
/** DSH 适配器：遍历 buildCatalog 产出的 ToolEntry，补 DSH 专属字段后注册。
 *  execute 直接用 entry.execute（已含 missing-args + toErrorPayload，platform-agnostic）。 */
export declare function registerTools(ctx: Context, env: ToolEnv): void;
