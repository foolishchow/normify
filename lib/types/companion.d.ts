/** 外部"写文件类"工具名 regex（write/edit/str_replace_editor/apply_patch/patch/multi_edit/create_file/insert/fs_write）。
 *  DSH + pi 用此匹配外部编辑器写工具；MCP 不用（MCP 用 ToolEntry.behavior 代理，无法跨进程见外部工具）。 */
export declare const WRITE_TOOLS: RegExp;
/** 提醒文本模板（与 DSH 原内联字符串逐字节一致，threshold 数字替换）。
 *  golden snapshot：companionReminder(8) === '[normify] 已连续修改 8 个文件：...'（121 字节）。 */
export declare function companionReminder(threshold: number): string;
/** companion 配置（MCP/pi 经 env；DSH 经 DSH Config，不用此函数）。 */
export interface CompanionConfig {
    enabled: boolean;
    threshold: number;
}
/** 从 env 解析 companion 配置（MCP/pi 用）。
 *  - NORMIFY_DEV_COMPANION_REMINDER：'1'=开，其他/undefined=关（默认关，反向于 NORMIFY_REQUIRE_BILINGUAL 的 !== '0' 默认开，因 DSH default=false）
 *  - NORMIFY_DEV_COMPANION_REMINDER_AFTER：默认 8；Number + isFinite 守卫（'abc'→NaN→fallback 8）
 *  阈值解析镜像 DSH Math.max(1, Math.floor(...))。 */
export declare function parseCompanionConfig(env?: NodeJS.ProcessEnv): CompanionConfig;
