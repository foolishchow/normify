// S5 A-004：companionReminder golden snapshot——DSH(8) 原文逐字节比对。
// P-001 后 DSH 原文已消失（替换为 companionReminder(threshold) 调用），故用 golden snapshot 比对。
// standalone，不并入 npm test（S6 职责）。运行：node tests/companion-snapshot.mjs
import { companionReminder } from '../lib/companion.js';

let pass = 0, fail = 0;
function assertEq(name, actual, expected) {
    if (actual === expected) { console.log('PASS  ' + name); pass++; }
    else { console.log('FAIL  ' + name + '\n  expected: ' + JSON.stringify(expected) + '\n  actual:   ' + JSON.stringify(actual)); fail++; throw new Error(name); }
}

// golden snapshot：从 DSH src/index.ts 原内联字符串复制（threshold=8 替换后，121 字节）
const snapshot = '[normify] 已连续修改 8 个文件：结构树可能已漂移。建议运行 normify_sync（v2：脏模块/新增文件建议/破坏性 API 变更），收尾用 normify_change_close（0 error 强制）同步模块与渲染数据。';

const actual = companionReminder(8);
assertEq('companionReminder(8) === golden snapshot（逐字节）', actual, snapshot);
assertEq('companionReminder(8) 长度 121', actual.length, 121);

// threshold=1 边界（DSH Math.max(1,...) 最小值）
const a1 = companionReminder(1);
assertEq('companionReminder(1) 含 "已连续修改 1 个文件"', a1.includes('已连续修改 1 个文件'), true);

console.log('\n=== 结果：' + pass + ' PASS, ' + fail + ' FAIL ===');
process.exit(fail === 0 ? 0 : 1);
