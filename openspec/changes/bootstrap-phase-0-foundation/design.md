## 上下文

prep-forge 目前是文档和 OpenSpec 配置仓库，还没有可运行应用、monorepo、数据库 schema 或导入器。Phase 0 的首要约束不是“先做一个空 Web shell”，而是让 Web shell 能展示来自 `ai-teacher` 的真实 2026 年 10 月自考备考状态。

`ai-teacher` 数据不是单纯材料库。它包含公共内容库和个人学习状态：

- 公共内容库：课程、考试、章节、知识点、题库、答案、解析、考频统计。
- 个人学习状态：学习者画像、计划、进度、错题、复习队列、学习日志、阶段任务。

因此本变更必须同时建立导入来源追踪、结构化领域模型、Web 展示骨架和 local/demo session event 记录。所有功能仍限定在 Phase 0A/0，不进入 Phase 1 的完整学习闭环。

## 目标 / 非目标

**目标：**

- 初始化可运行的 TypeScript monorepo 和 Next.js Web shell。
- 建立最小 PostgreSQL/Drizzle 数据模型与 migrations。
- 建立共享 Zod schemas，覆盖导入、课程、知识点、题目、课包、session event 和报告。
- 建立只读 legacy import pipeline，将 `ai-teacher` Markdown/YAML 快照解析为结构化 seed 数据。
- 用真实 seed 数据展示 dashboard、学科/知识点、课包查看器、admin 导入报告和基础课堂骨架。
- 提供本地开发命令和聚焦测试，证明导入幂等、schema 校验、MathBlock fallback 和 session event 记录可工作。

**非目标：**

- 不做真实 LLM、RAG、embedding、OCR 或完整教材切片。
- 不做 auth、billing、生产部署、Redis、Temporal 或复杂 worker。
- 不做 GitHub webhook 自动同步。
- 不反写 `ai-teacher`，不做双向同步。
- 不让 LLM 修复、总结或覆盖历史 Markdown。
- 不实现 Phase 1 的完整学习状态迁移、客观题批改闭环或复习调度闭环。
- 不做多用户导入。

## 决策

### 决策 1：本地快照导入优先，GitHub adapter 可插拔

实现入口使用 `scripts/import_legacy_ai_teacher.ts --source <path> --dry-run`，默认读取本地 clone 或 fixture。GitHub Contents API adapter 可以保留接口和配置位，但不作为 Phase 0 的必需路径。

理由：

- 本地快照可测试、可重复、无认证和网络依赖。
- GitHub 私有仓库读取在开发者环境中容易受 token 权限影响，不应阻塞 Phase 0。
- 导入语义应围绕 source refs 和 content hash，而不是围绕具体传输方式。

替代方案：

- 直接调用 GitHub API：更贴近最终来源，但测试和认证成本高。
- 先手写 seed JSON：实现快，但会丢失真实 Markdown 复杂度，无法验证导入风险。

### 决策 2：导入采用 staging + report，不直接覆盖正式学习状态

导入流程分为 scan、parse、validate、stage、report、publish。Phase 0 可以把 staging 中已确认或内置 seed 发布为 demo 数据，但导入器本身必须能生成导入报告和 quarantine 列表；publish 是独立于 stage 的显式步骤，未生成报告不得直接写入正式记录。

关键记录：

- `import_runs`
- `source_documents`
- `source_blocks`
- `imported_entities`
- `import_errors`

稳定自然键（用于幂等与 update/create 判定，**不含** content_hash；content_hash 只作变化检测）：

- 考试轨道：`exam_track`（考期，如 2026-10）。
- 课程/学科：`course_code`（由 `exam_plan.md` 的考试代码表派生，是 slug↔code↔名称 的事实来源；章节再加 `chapter_no`/标题）。
- source block：稳定身份 = `source_path + heading_path + normalized_key`，content_hash 仅用于判断该块是否变化。`normalized_key` = 同一 heading 下按出现顺序的块序号或行键（如表格首列归一化值），保证一个标题下的多行/多块互不碰撞。
- 题目：优先 `course + src + id`，缺失时退化为 `题干 hash + 章节 + 序号`（避免同题干判断题/模板题碰撞）。
- 知识点：`course_code + kp_code`。
- 错题、复习项、学习日志等个人状态：由所属 `course/kp 自然键（若有）+ 来源块稳定身份` 派生稳定 ID。

幂等必须针对**已持久化的前一次导入**验证（不是两次 dry-run 互比）；content_hash 变化时，用稳定身份匹配既有实体判为 update（而非 delete+create），并保留新旧差异。（这细化了 ARCHITECTURE.md §4.5：source block 身份不含 content_hash，content_hash 仅作变化检测；course_code 事实来源是 exam_plan.md。）

理由：

- `review_queue.md`、`daily_log.md` 等文件包含表格和自由文本混合内容，不能假设一次性解析完美。
- 可追溯和可人工确认比解析覆盖率更重要。
- 以后多用户化时需要知道哪些数据来自公共内容、哪些来自个人学习状态。

替代方案：

- 直接 seed 到业务表：开发更快，但无法审计错误解析。
- 保留 Markdown 运行时读取：短期省事，但违反 PostgreSQL 事实源原则。

### 决策 3：Drizzle + PostgreSQL 作为 Phase 0 数据层

使用 `packages/db` 定义 Drizzle schema、migrations 和 seed/import helpers。Phase 0 验收要求一个可连接的 PostgreSQL（Docker Compose 默认，也可用 Neon/Supabase/Postgres URL）；幂等测试针对已持久化的前一次导入运行。PostgreSQL 是 Phase 0 验收的唯一规范 seed 目标（课程/知识点/题库摘要/个人状态）；fixture 只用于 UI 渲染和测试，不能替代 migration + seed/import 验收。仅 session events 可按 local 或 DB 存储。

Schema SoT：`packages/schemas`(Zod) 是唯一事实来源，`packages/db`(Drizzle) 由其派生（`drizzle-zod` 或一个 parity 测试防漂移），避免两套 schema 手工维护导致返工。

`session_events` 即使 Phase 0 只记录 local/demo 事件，也必须先定义稳定信封：`event_type`、`event_version`、`sequence`、`actor_type`、`idempotency_key`、`occurred_at` 和预留 `tenant_id`（demo 事件可填占位值但不应用任何派生）；`correlation_id`、`causation_id`、`model_call_id` 留到 Phase 1/2。这样 Phase 1 的“事件重放一致性”可直接基于 Phase 0 数据验证，不需重建表。

理由：

- Drizzle 与 TypeScript monorepo 和 Zod schema 协作自然。
- Phase 0 schema 仍在快速变化，Drizzle 的代码优先模型便于小步调整。
- PostgreSQL 与后续 pgvector、关系约束和审计记录方向一致。

替代方案：

- Prisma：生态成熟，但 schema/generator 工作流更重。
- SQLite：本地简单，但偏离产品的 PostgreSQL 事实源和后续 pgvector 方向。

### 决策 4：共享 schemas 先于 UI 和导入器

`packages/schemas` 定义运行时 schema 和导出类型，并作为 TS/Drizzle 的唯一 schema 事实来源（见决策 3），包括：

- 导入与来源：`ImportRun`、`SourceDocument`、`SourceBlock`、`ImportedEntity`、`ImportError`、`ImportReport`
- 课程结构：`ExamTrack`、`Course`、`Subject`、`Chapter`、`KnowledgePoint`、`LearnerProfile`
- 题库：`Question`、`QuestionOption`、`QuestionSolution`、`QuestionBankStats`、`QuestionKpLink`
- 个人学习状态：`LearnerKpState`(progress)、`Mistake`、`ReviewItem`、`StudyPlan`、`DailyLogEntry`
- 学习体验：`LessonPacket`(含 `version` 和 `status: draft|ready|consumed|quarantine`)、`LessonStep`、`MathBlock`、`SessionEvent`
- 契约占位（Phase 0 只定义类型与校验，不接入真实运行时）：`GradingResult`、`QualityGateResult`、`ModelCall`

每个领域对象都带稳定自然键（见决策 2）、`origin`(`imported|system|ai_generated`) 和 public/personal 标记字段；导入器、DB seed、Web 页面和测试都使用这些 schemas。

理由：

- Phase 0 的主要风险是导入数据、UI 展示和数据库字段各说各话。
- Zod schema 能先约束文件输入和 UI contract，再逐步接入数据库。

### 决策 5：Web 第一屏是工作台，不做营销页

`apps/web` 默认首页展示学习工作台：考试倒计时、四科进度、待复习/错题摘要、今日建议、导入状态。另提供学科页、课包查看页、课堂骨架页和 admin 导入报告页。

理由：

- 产品是考试导向学习引擎，第一屏应该验证学习闭环信息架构。
- 首版用户是自考备考者，工作台比 landing page 更能暴露真实数据问题。

### 决策 6：MathBlock 首版使用 KaTeX + fallback

数学渲染首版使用 KaTeX 渲染 inline/block LaTeX。失败时显示原始文本、复制入口和错误状态，提供可访问的 alt text，并且不允许撑破移动端布局（用窄视口截图或聚焦测试验证无横向溢出）。

理由：

- 高数和离散题库含大量公式。
- Phase 0 不需要 Python 数学渲染服务，但必须验证 Web 公式展示边界。

### 决策 7：Session events 首版只记录 local/demo 事件

课堂骨架记录 `lesson_started`、`step_shown`、`student_answered`、`lesson_completed` 等 local/demo events，可存数据库或本地开发存储。它不更新正式掌握度，不触发错题和复习调度。

理由：

- Phase 0 需要验证事件结构和课堂骨架。
- 完整确定性状态迁移属于 Phase 1，不应提前扩大范围。

## 风险 / 权衡

- Markdown 解析覆盖率不足 → 使用 source block、raw block、import_errors 和 quarantine 保留证据，不以 100% 解析率作为 Phase 0 验收。
- GitHub 私有仓库认证不稳定 → Phase 0 默认本地快照和 fixture，GitHub adapter 后续接入。
- schema 过度设计 → 只覆盖 Phase 0 页面和导入报告所需字段，复杂 mastery 和重排规则留到 Phase 1。
- UI 做成空壳 → dashboard 验收数值必须来自 import 发布到 PostgreSQL 的 seed 且可追溯到 import run/source block/content hash；fixture 仅用于非验收的本地/测试渲染，不允许用手写 mock 或 fixture 通过验收。
- Drizzle/DB 初始化拖慢 Web 骨架 → 可以先用 schema + fixture 渲染 UI，但最终验收必须包含 PostgreSQL migration 和 seed/import 路径。
- MathBlock 在移动端溢出 → 为公式容器设置滚动/fallback，并加入聚焦测试或截图检查。

## 迁移计划

1. 初始化 monorepo、包管理器、基础 lint/test/build 命令。
2. 创建共享 schemas 和 DB schema/migrations。
3. 创建 legacy import fixtures 和导入 dry-run/report。
4. 创建 seed 发布路径，把导入结果用于 Web 展示。
5. 创建 Next.js 页面和基础 UI。
6. 添加 local/demo session event 记录。
7. 添加 README 和本地运行说明。

回滚策略：本变更是初始 scaffold。若实现失败，可删除新建应用/包目录并保留 OpenSpec 产出物；数据库 migration 未进入生产环境，不需要线上回滚。

## Open Questions

- 首版导入 fixture 是否直接从 `ai-teacher` 抽取脱敏快照，还是在测试中使用最小手写 fixture 表达同样格式？
- UI 组件库是否立即引入 shadcn/ui，还是先用 Tailwind 原生组件降低初始化成本？

（已决议：Phase 0 验收要求可连接的 PostgreSQL，见决策 3。）
