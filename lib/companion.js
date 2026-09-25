// 共享 companion 提醒钩子 helper（平台无关）。
// DSH / MCP / pi 三适配器共用 reminder 文本 + WRITE_TOOLS regex + env 配置解析，
// 避免三份漂移。DSH installCompanionReminder 的 hook 逻辑不变（仅文本来源 + WRITE_TOOLS 提取到此）。
/** 外部"写文件类"工具名 regex（write/edit/str_replace_editor/apply_patch/patch/multi_edit/create_file/insert/fs_write）。
 *  DSH + pi 用此匹配外部编辑器写工具；MCP 不用（MCP 用 ToolEntry.behavior 代理，无法跨进程见外部工具）。 */
export const WRITE_TOOLS = /^(write|edit|str_replace_editor|apply_patch|patch|multi_edit|create_file|insert|fs_write)$/i;
/** 提醒文本模板（与 DSH 原内联字符串逐字节一致，threshold 数字替换）。
 *  golden snapshot：companionReminder(8) === '[normify] 已连续修改 8 个文件：...'（121 字节）。 */
export function companionReminder(threshold) {
    return '[normify] 已连续修改 ' + threshold + ' 个文件：结构树可能已漂移。建议运行 normify_sync（v2：脏模块/新增文件建议/破坏性 API 变更），收尾用 normify_change_close（0 error 强制）同步模块与渲染数据。';
}
/** 从 env 解析 companion 配置（MCP/pi 用）。
 *  - NORMIFY_DEV_COMPANION_REMINDER：'1'=开，其他/undefined=关（默认关，反向于 NORMIFY_REQUIRE_BILINGUAL 的 !== '0' 默认开，因 DSH default=false）
 *  - NORMIFY_DEV_COMPANION_REMINDER_AFTER：默认 8；Number + isFinite 守卫（'abc'→NaN→fallback 8）
 *  阈值解析镜像 DSH Math.max(1, Math.floor(...))。 */
export function parseCompanionConfig(env = process.env) {
    const enabled = env.NORMIFY_DEV_COMPANION_REMINDER === '1';
    const after = Math.floor(Number(env.NORMIFY_DEV_COMPANION_REMINDER_AFTER ?? '8'));
    const threshold = Math.max(1, Number.isFinite(after) ? after : 8);
    return { enabled, threshold };
}
//# sourceMappingURL=companion.js.map