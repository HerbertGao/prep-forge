# CLAUDE.md

本仓库使用 `PRODUCT.md` 和 `openspec/config.yaml` 作为 Claude Code 的主要项目指令。

开始修改前：

1. 阅读 `PRODUCT.md`。
2. 阅读 `openspec/config.yaml`。
3. 如果工作会改变产品行为、架构、schemas、领域模型或阶段范围，先使用 OpenSpec 工作流。

关键规则：

- 不要构建通用聊天机器人。
- 不要只用 Markdown 存储商业学习者状态。
- 首版真实数据来自 `HerbertGao/ai-teacher` 只读快照；Markdown/YAML 只能作为导入源。
- Legacy import 必须保留 source path、heading、raw block、content hash、导入批次和异常记录。
- 不要反写或双向同步 `ai-teacher`，除非用户明确提出新的变更。
- 实现开始后，PostgreSQL 是规范学习状态来源。
- TypeScript 和 Python 之间使用显式 schemas 或 API 连接。
- LLM 可以产出结构化事件或建议；进度变更由确定性代码应用。
- AI 生成的教育内容必须有校验或 quarantine 路径。
- 引入真实 LLM 集成时，记录模型调用和预估成本。
- 除非已接受的 OpenSpec change 另有说明，Phase 0A/Phase 0 只聚焦 legacy import、类型明确的 monorepo 基础和真实 seed 展示。

常用入口：

- 产品事实来源：`PRODUCT.md`
- 架构推荐：`ARCHITECTURE.md`
- 分期路线图：`ROADMAP.md`
- Agent-facing OpenSpec 上下文：`openspec/config.yaml`
- 人类读者入口：`README.md`
- Claude OpenSpec 命令：`.claude/commands/opsx/`
