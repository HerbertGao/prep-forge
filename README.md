# prep-forge

prep-forge 是一个 Web 优先、面向考试的 AI 学习系统初始化仓库。

产品基于现有 `ai-teacher` 工作流，核心学习闭环是：

```text
考试计划 -> 考纲 -> 知识点 -> 题库 -> 课包
-> AI 课堂 -> 批改 -> 错题 -> 间隔复习 -> 进度更新 -> 计划重排
```

这个项目不是通用聊天机器人。第一个商业切片面向成人和自学考试用户，从 `ai-teacher` 已有 2026 年 10 月自考备考空间开始。

首版初始化数据来自 GitHub `HerbertGao/ai-teacher` 的只读快照，覆盖 2026 年 10 月自考备考空间：高等数学工本、离散数学、操作系统、计算机系统原理，以及历史已通过课程。Markdown/YAML 是导入源，不是商业版长期业务存储。

## 当前状态

当前仓库包含产品方向、架构基线、分期路线图和 OpenSpec 配置，已经可以进入规格驱动实现阶段，但还没有 scaffold 可运行应用。

最新架构结论：在 Web 骨架前先做 Phase 0A，即 `ai-teacher` legacy import 的数据盘点、只读导入、来源追踪、staging/quarantine 和导入报告。RAG 后置到 Phase 3，不承担首版数据初始化。

权威文件：

- `PRODUCT.md`：产品命题、架构、阶段规划和工程规则。
- `ARCHITECTURE.md`：架构推荐、边界、事件模型、AI/RAG 与质量门禁。
- `RODEMAP.md`：分期开发路线图、验收门槛和显式延期项。
- `openspec/config.yaml`：面向 AI coding agent 的紧凑 OpenSpec 上下文和工件规则。
- `CLAUDE.md`：Claude Code 入口。

## 产品方向

系统需要支持：

- 考纲优先的学习计划。
- 知识点状态追踪。
- 结构化题库。
- 异步课包准备。
- 交互式 AI 课堂。
- 由 session events 驱动的确定性进度更新。
- 错题本和间隔复习流程。
- 漏学后的弹性计划重排。
- 对 LaTeX 友好的 Web 数学渲染和 fallback。
- AI 生成内容的 admin 检查、校验和 quarantine。
- 从第一次真实 LLM 集成开始记录模型调用和成本。

## 初始技术方向

规划中的技术栈是混合模式：

- TypeScript 负责产品运行时：Next.js App Router、学生课堂、仪表盘、管理后台、产品 API/BFF、streaming UI、课包渲染和课堂状态机。
- Python 负责 AI、数据和离线任务：FastAPI worker 端点、资料摄取、RAG、embeddings、数学资源生成、agent 工作流、质量门禁和批量批改。
- PostgreSQL 作为规范领域数据库，MVP 阶段可以使用 pgvector 做检索。

RAG 用于解释和证据检索，不能替代 PostgreSQL 中的规范学习模型。

## 计划中的 Monorepo 结构

```text
apps/
  web/                         # Next.js 产品应用
services/
  ai-worker/                   # Python FastAPI / agent worker
packages/
  db/                          # schema、migrations、生成的 client
  schemas/                     # Zod / JSON Schema / 生成的 Pydantic models
  lesson-runtime/              # 课堂状态机
  ui/                          # 共享 React 组件
  config/                      # 共享配置
python_packages/
  ai_teacher_agents/
  ai_teacher_ingestion/
  ai_teacher_math/
docs/
infra/
openspec/
PRODUCT.md
```

## 第一实现阶段

Phase 0A / Phase 0 要先建立朴素、类型明确、可观测的基础：

- 从 `ai-teacher` 只读导入真实 seed 数据。
- 保留导入来源、raw block、content hash 和异常数据列表。
- 初始化 monorepo。
- 创建 `apps/web`，使用 Next.js 和 TypeScript。
- 定义数据库和共享 schema packages。
- 添加 lesson packets、questions、session events、grading results 的 Zod schemas。
- 构建带真实导入数据的 demo dashboard。
- 构建学科/知识点页面和课包查看页面。
- 构建基础课堂骨架。
- 添加 `MathBlock` fallback 渲染。
- 记录 local/demo session events。

Phase 0A / Phase 0 不做 auth、Stripe、生产计费、真实 LLM 调用、RAG、Redis、Temporal、双向同步 `ai-teacher` 或复杂服务编排。

## OpenSpec 工作流

影响产品行为、架构、领域模型或实现阶段的改动，应使用 OpenSpec。

提出或实现变更前：

1. 阅读 `PRODUCT.md`。
2. 阅读 `openspec/config.yaml`。
3. 保持当前阶段范围收敛。
4. 先定义 schemas 和确定性状态迁移，再做 UI 或 AI 自动化。
5. AI 生成的教育内容必须包含校验和 quarantine 行为。

## 文档参考

本文档参考了 HerbertGao 相关项目的 README 组织方式：

- `gaokao_bot` 和 `gaokao_bot_mini_app`：简洁介绍、功能、技术栈和开发说明。
- `libpku`、`REKCARC-TSC-UHT`、`go-fundamental-programming`：学习资料组织方式和实用入口。

本项目的产品和工程约束以 `PRODUCT.md` 为准。
