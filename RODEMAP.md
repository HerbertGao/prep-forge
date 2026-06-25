# 分期开发路线图

> 文件名沿用用户指定的 `RODEMAP.md`。本文档聚焦阶段承诺、决策门槛和明确不做什么；产品与工程细节仍以 `PRODUCT.md` 为准，架构边界见 `ARCHITECTURE.md`。

## 1. 产品意图

prep-forge 要构建的是 Web 优先、面向考试的 AI 学习系统，而不是通用聊天机器人或完整 LMS。

第一个商业切片：

```text
成人 / 自学考试用户
从 ai-teacher 既有 2026 年 10 月自考备考数据开始
用真实导入数据、结构化课包和事件驱动学习闭环验证价值
```

首版不再使用手写 mock 作为主验收数据。GitHub `HerbertGao/ai-teacher` 中已经有学习者画像、考试计划、课程进度、题库、错题、复习队列、学习日志和阶段任务清单，应作为 Phase 0 的真实初始化数据。

核心闭环：

```text
考试计划 -> 考纲 -> 知识点 -> 题库 -> 课包
-> AI 课堂 -> 批改 -> 错题 -> 间隔复习 -> 进度更新 -> 计划重排
```

## 2. 北极星指标

建议北极星指标：

```text
WVLL: Weekly Verified Learning Loops
每周有效学习闭环数
```

一次有效学习闭环计数条件：

- 学习者完成一节 `ready` 课包或复习任务。
- 产生 `session_events`。
- 至少提交一次答案并被批改。
- 确定性代码更新知识点状态、错题或复习队列。
- 课包未被质量门禁判定为失败或 `quarantine`。

护栏指标：

| 类别 | 指标 |
| --- | --- |
| 学习质量 | 知识点掌握率、复习命中率、错题复错率下降 |
| 产品使用 | 周活学习者、每周学习闭环/人、D7/D30 留存 |
| 内容质量 | 课包 ready 通过率、quarantine 率、用户差评率 |
| 成本 | 每个有效学习闭环模型成本、模型调用失败率 |
| 可靠性 | 课堂完成率、事件重放一致性、MathBlock 渲染失败率 |

## 3. 总体路线

| Phase | 产品目标 | 优先范围 | 退出门槛 |
| --- | --- | --- | --- |
| Phase 0A | ai-teacher 数据盘点与导入契约 | GitHub/本地只读导入、Markdown/YAML 解析、source refs、staging、quarantine、导入报告 | 可从 `ai-teacher` 初始化真实学习空间；重复导入幂等；异常块不丢失 |
| Phase 0 | 打地基：可运行、类型明确、可观测 | monorepo、Next.js shell、核心 schemas、DB schema、真实 seed dashboard、知识点页、课包查看器、MathBlock、课堂骨架、local events | 本地可运行；demo learner 看到来自 `ai-teacher` 的真实 dashboard/知识点/题库/课包；events 可写入 |
| Phase 1 | 跑通真实导入数据学习闭环 MVP | 今日任务、session 创建、步骤推进、答案提交、客观题批改、事件驱动状态迁移、错题、复习调度、admin 导入报告 | 一个学习者能基于真实导入数据完成学习闭环，进度/错题/复习项确定性更新 |
| Phase 2 | AI 辅助内容加工与离线备课 | Python worker、`/prep/generate`、`/prep/validate`、`/math/render`、`prep_jobs`、导入题库加工、草稿生成、课包校验与 quarantine | Admin 可从已确认导入数据生成/校验课包；AI 输出有来源绑定和 draft/ready/quarantine 分流 |
| Phase 3 | 让生成和回答有证据 grounding | 教材/考纲/真题材料 chunking、metadata、embeddings、按 KP 检索、agent/model run 记录引用 chunks | Prep/QA 可按 subject/KP 检索 evidence chunks，并记录引用来源；RAG 不覆盖结构化学习状态 |
| Phase 4 | 小规模商业 beta | auth、profiles/enrollments、Stripe gate、成本日志仪表盘、课程反馈、夜间备课、admin quarantine/regenerate、导入差异对比 | beta 用户可订阅、选课、学习、保留进度；第二个学习空间能复用导入机制；成本和质量可运营 |

现在不承诺日历日期。仓库还没有 scaffold 和历史 velocity，合理方式是用阶段验收门槛推进；Phase 0 完成后再做 sprint 级排期。

## 4. Phase 0A — ai-teacher 数据盘点与导入契约

目标：先解决首版真实数据从哪里来、如何进入系统、如何校验和追溯。

范围：

- 读取 GitHub `HerbertGao/ai-teacher` 或本地 clone 的只读快照。
- 建立 `scripts/import_legacy_ai_teacher.ts` 或等价导入入口。
- 支持扫描和解析：
  - `teacher/learner_profile.md`
  - `teacher/exam_plan.md`
  - `teacher/study_plan.md`
  - `teacher/dashboard.md`
  - `teacher/review_queue.md`
  - `teacher/daily_log.md`
  - `teacher/phase0_tasks.md`
  - `teacher/session_archive.md`
  - `teacher/subjects/*/{syllabus,progress,mistakes,key_points}.md`
  - `materials/*/question_bank/stats.md`
  - `materials/*/question_bank/chapter_*.md`
  - 紧凑 YAML 题库格式
- 为每条导入记录保留 source repo/ref、文件路径、标题路径、行号范围、raw block、content hash。
- 建立 `import_runs`、`source_documents`、`source_blocks`、`imported_entities`、`import_errors` 或等价模型。
- 生成导入报告，标记新增、更新、跳过、无法解析和需要人工确认的数据块。
- 显式区分公共内容库和个人学习状态。

首版必须至少覆盖：

- 高等数学工本 `00023`。
- 离散数学 `02324`。
- 操作系统 `13180`。
- 计算机系统原理 `13015`。
- 已通过历史课程：马克思主义基本原理、习近平思想概论、中国近现代史纲要。

非目标：

- 不做双向同步。
- 不反写或自动修复 `ai-teacher`。
- 不做 GitHub webhook 自动同步。
- 不要求一次性解析完整教材正文。
- 不做 AI 自动生成课程内容。
- 不把 Markdown 直接当成最终业务模型。

验收门槛：

- 可以从 `ai-teacher` 初始化出一个真实学习空间。
- 可以看到真实考试日期、课程进度、复习队列、错题或薄弱点、历史学习日志。
- 重复导入不会产生重复课程、题目、错题、复习项或学习日志。
- 无法结构化的数据进入待确认或原文保留区。
- 导入报告可以被 admin 检查。

主要风险：

- Markdown 格式混杂，表格和自由文本并存。
- 题库 Markdown 和 YAML 同时存在，事实源优先级不清。
- `dashboard.md`、`study_plan.md`、`progress.md` 中统计数字不一致。
- 公共内容和个人学习状态混在原仓库目录中。

## 5. Phase 0 — Web 骨架和领域模型

目标：创建可运行、类型明确、可观测的产品地基。

范围：

- 初始化 monorepo。
- 创建 `apps/web`，使用 Next.js + TypeScript。
- 创建 PostgreSQL schema / migrations。
- 定义 Zod schemas：
  - `LessonPacket`
  - `LessonStep`
  - `Question`
  - `SessionEvent`
  - `GradingResult`
  - `QualityGateResult`
  - `ModelCall`
- 构建来自 `ai-teacher` 导入数据的真实 seed dashboard。
- 构建 `/subjects/[subjectCode]` 知识点列表。
- 构建带 `MathBlock` fallback 的课包查看器。
- 构建基础课堂骨架。
- 记录 local/demo session events。
- 构建 admin 导入报告和异常数据列表的最小视图。

非目标：

- 不做 auth。
- 不做 Stripe。
- 不做真实 LLM 调用。
- 不做 RAG。
- 不做 Redis / Temporal。
- 不做生产部署。
- 不做多用户导入。
- 不做完整教材解析。

验收门槛：

- 开发者可以本地运行 Web app。
- Demo learner 可以看到来自 `ai-teacher` 的 dashboard、知识点列表、题库摘要和示例课包。
- 系统能区分人工导入数据、系统生成数据和 AI 生成数据。
- 课程、知识点、题目、错题、复习项、学习日志都有稳定 ID。
- MathBlock 有 fallback，且不会在移动端撑破页面。
- Session events 可以持久化或本地记录。
- 核心 schemas/types 有聚焦测试。

主要风险：

- 过度架构化。
- ORM/DB 选择拖慢。
- schema 返工。
- 数学渲染低估。
- 导入数据异常被 UI 静默吞掉。

## 6. Phase 1 — 真实导入数据学习闭环 MVP

目标：一个学习者可以基于真实导入数据完成一次学习、练习、错题和复习更新闭环。

范围：

- 基于导入的 2026 年 10 月考试计划展示倒计时、课程优先级和今日任务。
- 从 `daily_log`、`review_queue` 和 `mistakes` 恢复当前学习上下文。
- 基于导入题库按课程、知识点、题型、错题和考频做练习。
- lesson session 创建。
- 课堂步骤推进。
- 答案提交。
- 客观题确定性批改。
- event applier 更新 `learner_kp_states`。
- 错题创建。
- 复习项调度。
- admin 课包列表。
- 人工确认题目、答案、知识点映射、错题状态和复习完成。

非目标：

- 不生成课包。
- 不做主观题复杂 AI 批改。
- 不做个性化规划。
- 不引入实时 Tutor LLM。
- 不做自适应学习算法。
- 不做跨课程智能排程。

验收门槛：

- 用户可以开始课程、回答练习、完成课程。
- 完成一节 `ready` 课包后，事件可重放出一致进度。
- KP 状态、错题、复习项由确定性代码更新。
- 课堂 UI 不是纯聊天框，而是围绕课包步骤推进。
- 新产生的数据不会覆盖历史导入数据。
- 对计算机系统原理这类已有高完成度课程，系统能识别其维护和抗遗忘性质，而不是从零开始。

主要风险：

- 事件模型漏字段。
- 状态迁移不稳定。
- 课堂 UI 退化成普通 chat。
- 复习调度规则过早复杂化。
- 历史导入状态和新事件 projection 混在一起导致不可追溯。

## 7. Phase 2 — AI 辅助内容加工和离线备课

目标：把已确认的导入数据加工为可教学课包，并把备课、数学渲染和质量校验移出课堂实时路径。

范围：

- 创建 `services/ai-worker`，使用 FastAPI。
- 添加 `POST /prep/generate`。
- 添加 `POST /prep/validate`。
- 添加 `POST /math/render`。
- 添加 DB 支持的 `prep_jobs`。
- 添加 admin 生成课包按钮。
- 添加 schema/math/question refs 校验。
- 添加 `ready` / `quarantine` 分流。
- 所有真实模型调用走 `ModelGateway` 并写 `model_calls`。
- 支持题库 Markdown/YAML 的结构化解析和人工确认。
- 基于已确认题目、错题、复习记录生成讲解、变式题、错因归类和复习建议草稿。
- AI 输出必须绑定来源题目、来源错题、来源知识点或来源学习日志。

非目标：

- 不做全自动夜间系统。
- 不做完整 RAG，可先使用 PostgreSQL 全文检索或简单 BM25。
- 不追求完美内容生成。
- 不让 worker 直接拥有学习状态。
- 不做无人工审核的批量内容发布。
- 不做高风险考试预测。

验收门槛：

- Admin 可以从真实导入数据触发生成课包草稿。
- Job 状态可追踪。
- 有效课包进入 `ready`。
- 无效课包进入 `quarantine`，并记录原因。
- 模型调用成本、延迟和失败状态可查。
- AI 生成内容与原始导入内容边界清晰，默认是 `draft`，人工确认后才进入正式学习流。

主要风险：

- TypeScript / Python schema 漂移。
- AI 生成幻觉。
- LaTeX 渲染失败。
- Admin 审核负担。
- Worker 重试导致重复写入。
- AI 把导入数据摘要误当成教材证据。

## 8. Phase 3 — RAG 摄取和证据 grounding

目标：让课包生成有可追踪证据支持。

范围：

- 对教材、考试大纲、历年真题、补充资料建立 evidence chunks。
- 解析文档为 chunks。
- 为 chunks 存储 metadata：
  - tenant
  - course
  - subject
  - kpCodes
  - source type
  - source id
  - page
- 生成 embeddings。
- 按 subject/KP 检索。
- 在 model calls 或 agent runs 中记录引用 chunks。
- 增加小型 retrieval eval。

非目标：

- 不让向量库替代 PostgreSQL。
- 不做泛化 OCR/知识库平台。
- 不开放无边界问答。
- 不让 Tutor 越过 ready packet 临时生成整节课。
- 不承担首版数据初始化。
- 不直接决定学习进度、错题状态或题库答案。

验收门槛：

- Chunks 有完整 metadata。
- Prep Agent 可以按 KP 检索相关 chunks。
- 课包生成记录引用来源。
- QA Agent 可以检查关键解释是否有 evidence 支撑。
- 有基础 eval 检查 top-k 相关性、错误引用率和无关 chunk 比例。

主要风险：

- KP 标注错误。
- 材料质量差。
- embedding 成本和延迟。
- RAG 被误用为事实来源。
- 多租户检索过滤不严导致资料泄漏。

## 9. Phase 4 — 商业 beta

目标：小规模真实用户可付费或授权进入课程，并形成可运营闭环。

范围：

- 添加 auth。
- 添加 user profiles 和 enrollments。
- 添加 Stripe subscription gate。
- 添加模型成本日志仪表盘。
- 添加用户对课程质量的反馈。
- 添加夜间定时备课。
- 添加 admin quarantine 和 regenerate 控制。
- 添加基础支持和运营视图。
- 添加导入差异对比、导入回滚和第二学习空间初始化流程。

非目标：

- 不做移动 App。
- 不做完整 LMS。
- 不做社区。
- 不做企业级复杂多租户权限。
- 不做真人教师排课。

验收门槛：

- Beta 用户可以订阅或被授权进入课程。
- 用户可以选课、学习已准备课包，并保留进度。
- Admin 可以看到成本、质量反馈、quarantine 和 regenerate。
- 夜间备课失败可恢复。
- 单位学习闭环成本可估算。
- 第二个学习空间可以复用同一套导入与初始化机制。

主要风险：

- 内容质量影响留存。
- 单位经济模型不清。
- 支付、隐私、支持压力增加。
- AI 教育内容风险需要运营兜底。

## 10. 优先级规则

实现顺序遵守：

```text
legacy import contract
  -> schemas/types
  -> deterministic state transitions
  -> UI flows
  -> admin inspection
  -> AI automation
```

原则：

- 先固定领域对象和事件契约，再写复杂 UI。
- 先跑通确定性学习闭环，再接真实 LLM。
- AI 先进入后台/admin 路径，再进入课堂实时路径。
- RAG 先服务 Prep 和 QA，不直接变成课堂自由问答。
- 导入先保证可追溯、可重复、可人工修正，再追求完整解析。
- 每阶段都必须明确非目标，防止范围滑向通用聊天机器人或完整 LMS。

简单 RICE 使用方式：

```text
Reach: 影响多少学习闭环或 admin 操作
Impact: 是否直接提升 WVLL 或降低质量/成本风险
Confidence: 是否已有 PRODUCT.md / demo / 用户证据支持
Effort: 是否可在当前阶段内完成并验证
```

优先做高 Impact、高 Confidence、低 Effort 的基础能力；低 Confidence 的 AI 自动化必须先做 spike 或 admin-only。

## 11. 指标面板

学习指标：

- WVLL。
- 每学习者每周学习闭环数。
- 知识点掌握率。
- 复习命中率。
- 错题复错率。

质量指标：

- 课包 ready 通过率。
- quarantine 率。
- 用户差评率。
- Grader 低置信率。
- MathBlock 渲染失败率。

成本指标：

- 每个有效学习闭环模型成本。
- 每个 prep job 模型成本。
- token 使用量。
- 模型调用失败率。
- worker 重试次数。

可靠性指标：

- 课堂完成率。
- session event 写入失败率。
- projection 重放一致性。
- legacy import 幂等通过率。
- import quarantine 率。
- worker job 延迟。
- RAG top-k 相关性。

商业 beta 指标：

- 订阅转化。
- D7 / D30 留存。
- 每用户每周有效学习闭环。
- 支持请求量。
- 每用户 AI 成本。

## 12. 显式延期项

| 能力 | 进入时机 | 延期原因 |
| --- | --- | --- |
| Auth | Phase 4，或真实 beta 前 | Phase 0-3 先验证学习闭环和内容管线 |
| Stripe | Phase 4 | 在第一个有用学习闭环跑通前不做计费 |
| RAG | Phase 3 | 先稳定结构化领域模型和课包生命周期 |
| GitHub webhook 自动同步 | Phase 4 之后再评估 | Phase 0 只做快照导入，避免双向状态冲突 |
| 双向同步 `ai-teacher` | 不作为 MVP | Markdown 是导入源，不是商业版生产状态存储 |
| 完整教材解析 | Phase 3 | 首版先导入考纲、题库、错题、复习和日志 |
| Redis | 有明确队列、缓存或 session 加速需求时 | MVP 可先用 PostgreSQL job 表 |
| Temporal | 备课 workflow 复杂到需要 durable orchestration 时 | 早期手动/admin 触发更简单 |
| 独立向量库 | pgvector 无法满足规模或性能时 | MVP 统一在 PostgreSQL 降低复杂度 |
| Mobile App | beta 之后再评估 | 当前目标是 Web-first |
| 社区/社交 | MVP 之外 | 不直接帮助验证学习闭环 |
| 完整 LMS | 不作为当前方向 | 产品要做考试导向 AI 学习引擎 |

## 13. Open Questions

- Phase 0A 首版导入源优先使用 GitHub Contents API，还是要求用户提供本地 clone？
- Phase 0 ORM 选择 Prisma 还是 Drizzle？
- 导入 staging 到正式 publish 的 admin 确认粒度是按文件、按实体，还是按导入批次？
- `MathBlock` 首版使用 KaTeX 还是先做文本/SVG fallback？
- Phase 1 的复习调度先用固定间隔，还是引入简化版 spaced repetition？
- Phase 2 真实 LLM provider 和成本阈值如何设定？
- Phase 3 的 retrieval eval 用哪些 KP 和标准答案集？
- Phase 4 beta 的质量门槛、成本门槛和支持流程是什么？
