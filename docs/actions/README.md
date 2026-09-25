# Actions

本目录承载有界的、可实施、可评审、可验收、可归档的工作单元（Action）。一个 Action 记录一次交付切片及其证据；它不重新定义仓库当前的产品、架构、规范或策略权威。

## 权威来源

- [Action 状态](STATUS.md) 是所有正式 Action 状态与位置的唯一权威。
- [Action 候选池](TODO.md) 存放尚未正式到可实施程度的工作。
- 仓库产品/架构/规范权威保持独立，不被 Action 覆盖：
  - [Normify 正式规范 v1.0](../SPEC.zh-CN.md)
  - [多平台适配设计](../MULTIPLATFORM.zh-CN.md)
  - 根目录 `README.md` / `CHANGELOG.md`
- 归档 Action 仅保留历史与证据，不覆盖当前仓库权威。

## 目录

```text
docs/actions/<action-id>/
docs/actions/_archive/complete/<action-id>/
docs/actions/_archive/superseded/<action-id>/
docs/actions/_archive/deferred/<action-id>/
```

活跃 Action 直接置于 `docs/actions/` 下。`blocked` Action 保持活跃，不归档。终态规则见 [归档规则](_archive/README.md)。

## 生命周期

```text
candidate → draft → ready → in_progress → complete
                    ↘ blocked ↗

draft / ready / in_progress / blocked
    → superseded | deferred
```

- `draft`：范围或收尾契约未完成，未授权实施。
- `ready`：需求、设计、计划、验收、验证定义充分，可执行。
- `in_progress`：已明确授权的实施或验证进行中。
- `blocked`：记录具体阻塞、影响、解锁条件与恢复状态，Action 保持活跃。
- `complete`：验收通过、证据记录、持久结论已回流。
- `superseded` / `deferred`：需明确的终态决策。

## Action 内容

按复杂度选文件。保持「需求 / 设计 / 计划 / 验收 / 验证 / 评审」作为不同关切，即便小 Action 合并进更少文件也应区分。每个正式 Action 需一个本地入口，声明其身份、状态指针、目标、非目标、设计输入、交付物、就绪缺口与收尾条件。

维持以下可追溯链：

```text
问题 → 需求 → 技术设计 → 实施任务 → 验收准则 → 验证证据 → 收尾决策
```

不得仅因"代码已存在"就标记 complete。仅在可观察的验收与记录的验证证明结果达成后方可收尾。
