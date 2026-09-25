# Action 归档

本目录保留终态 Action 作为历史记录与验证证据。归档内容不覆盖当前产品、架构、规范、策略或操作权威。

使用以下终态位置：

```text
complete/<action-id>/
superseded/<action-id>/
deferred/<action-id>/
```

- 仅在验收、验证、持久结论回流与仓库检查完成后归档 `complete`。
- 归档 `superseded` 时链接到取代它的 Action 或已接受决策。
- 归档 `deferred` 时记录原因与可观察的重新激活条件。
- 不归档 `blocked`；保持其在活跃 Action 目录。
- 不重开已归档 Action。创建引用归档记录的新 Action。

当首个 Action 进入对应终态时再创建子目录。不为保留空目录而添加 `.gitkeep`。
