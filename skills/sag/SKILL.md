---
name: sag
description: 编辑 SAG 本地世界目录，校验配置、前台和 SQLite，以运行与留影核对业务要求。
---

- 先读 `docs/manual.md` 和目标世界。直接改已登记的目录，只有初始数据需求变更时才编辑 `initial.sqlite`。
- 在 SAG 根目录运行 `npm run world -- check <世界目录>`。改引擎或工作台时，按 `AGENTS.md` 验证代码和交互。
- 验收时把寓言分给子 agent，逐条记录结论和证据。按验收范围用本地留影或线上日志，汇总未通过和证据不足的条目。
