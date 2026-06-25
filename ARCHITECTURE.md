# 架构推荐

本文档综合 `~/.claude/agents` 中的软件架构、后端/数据、AI 工程和产品规划 subagent 视角，用于沉淀 prep-forge 的架构基线。`PRODUCT.md` 仍是产品和工程事实来源；本文档负责把架构决策收敛成可执行边界。

## 1. 总体结论

prep-forge 推荐采用：

```text
类型明确的模块化单体
+ PostgreSQL 中心化领域模型
+ 只读 Legacy Markdown 导入层
+ 事件优先学习记录
+ 异步 Python AI worker
```

具体分工：

- Next.js / TypeScript 承担 Web 产品运行时：学生课堂、仪表盘、admin、BFF、课包渲染、课堂状态机和确定性学习状态迁移。
- PostgreSQL 是规范事实来源：考试、课程、知识点、题库、课包、学习状态、错题、复习队列、备课任务、质量门禁和模型调用日志都应作为一等领域对象存储。
- Legacy Markdown 导入层是 Phase 0 前置能力：从 GitHub `HerbertGao/ai-teacher` 或本地 clone 只读读取 Markdown/YAML，确定性解析为结构化记录，保留来源追踪，进入 staging 或 quarantine，不反写原仓库。
- pgvector 只作为 MVP 阶段的证据检索层，用于教材、考纲、真题解析、补充笔记等 chunks 的 embedding 检索。
- S3/R2 兼容对象存储只保存大对象和资产：PDF、DOCX、OCR 图片、公式 SVG/PNG、课包预览图、导入原始材料和渲染产物。
- Python worker 只负责 AI/data/offline 工作：资料摄取、OCR、chunking、embedding、课包草稿生成、数学资源渲染、质量门禁、复杂批改和批量分析。

MVP 不应拆成复杂微服务。先把 schema、legacy import、事件、幂等、质量门禁和可观测性打牢。

## 2. 系统边界

```text
ai-teacher GitHub / local snapshot
        │
        ▼
scripts/import_legacy_ai_teacher.ts
  ├─ scan / parse / validate
  ├─ import staging
  ├─ source refs
  └─ import quarantine
        │
        ▼
apps/web
  ├─ Web UI
  ├─ Product API / BFF
  ├─ Classroom runtime
  ├─ Deterministic event applier
  └─ Admin console
        │
        ▼
PostgreSQL domain database
  ├─ canonical domain state
  ├─ session events
  ├─ prep jobs
  ├─ material chunks + pgvector
  └─ model calls / quality results
        │
        ├──────────────► Object storage
        │                 PDFs / images / formula assets / previews
        │
        └──────────────► services/ai-worker
                          ModelGateway
                          RAG Retriever
                          Math Renderer
                          Quality Gates
                          Prep / Grader / QA agents
```

BFF 是产品命令入口，负责 tenant 隔离、课堂状态机、事件写入、projection 更新、admin 操作和成本展示。Worker 是计算服务，不应成为第二个产品后端。

## 3. Bounded Contexts

| Context | 负责 | 边界规则 |
| --- | --- | --- |
| Curriculum / Exam Catalog | 考试、课程、学科、章节、知识点、前置关系 | 结构化考纲是上游事实源，不由 RAG 替代 |
| Question & Assessment | 题库、选项、官方解、知识点关联、rubric、客观题批改 | 非平凡答案可交给 Grader Agent，但结果必须结构化回写 |
| Lesson Packet Lifecycle | 课包、步骤、rubric、质量状态、公式资产 | 课包是结构化教学程序；只有 `ready` 可进入课堂 |
| Classroom Runtime | study session、课堂状态机、Tutor 交互、session events | 课堂只记录事件，不直接改掌握度 |
| Learning State & Review | 知识点状态、错题、复习项、掌握度、统计 | 从事件确定性派生；核心状态在 PostgreSQL |
| Planning & Scheduling | 学习计划、slots、漏学后的弹性重排 | 从当前日期重排，不把历史缺课堆成债务 |
| Legacy Import & Provenance | `ai-teacher` Markdown/YAML、导入批次、来源块、staging、quarantine | Markdown 是导入源，不是长期业务存储；默认只读不回写 |
| AI Prep / RAG / QA | prep jobs、material chunks、embedding、质量门禁、quarantine | Python worker 可生成和检索，但不能拥有规范学习状态 |
| Observability & Cost | model_calls、错误、延迟、token、成本 | 每次真实模型调用必须记录 |
| Identity / Tenant Shell | users、organizations、enrollments | Phase 0 只保留边界；auth/billing 后置 |

## 4. 事件模型

课堂采用事件优先记录，但不做全量 Event Sourcing。`session_events` 是课堂事实日志；查询和 dashboard 使用关系表 projection。

建议 `session_events` 字段：

```text
id
tenant_id
session_id
enrollment_id
event_type
event_version
sequence
actor_type          -- learner | tutor_agent | grader_agent | system | admin
payload jsonb
idempotency_key
correlation_id
causation_id
model_call_id nullable
occurred_at
created_at
```

关键约束：

- `unique(session_id, sequence)`。
- `unique(session_id, idempotency_key)`，或全局 `unique(idempotency_key)`。
- `event_type + event_version` 必须可校验。
- projection 更新必须和事件插入在同一事务内完成，或通过可靠 outbox 重放。

事件分两类：

- 原始事实事件：`lesson_started`、`step_shown`、`student_answered`、`answer_submitted`、`graded`、`hint_shown`、`lesson_completed`。
- 派生应用结果：`mistake_created`、`review_item_scheduled`、`kp_state_updated`、`plan_rescheduled`。

LLM 不应直接写 `learner_kp_states`。它最多返回 `grading_suggestion`、`mistake_category_suggestion`、`tutor_response` 或事件草案；确定性代码再根据 rubric、题型、分数阈值和当前状态生成正式事件并更新 projection。

## 4.5 Legacy Markdown 导入架构

`ai-teacher` 不是普通资料库，而是首版真实数据源。它同时包含公共内容和个人学习状态：

- 公共内容库：课程、考纲、章节、知识点、题库、答案、解析、考频统计、教材和真题材料。
- 个人学习状态：`learner_profile.md`、考试计划、学习计划、进度、错题、复习队列、每日学习日志、阶段任务清单。

导入层必须先于 Phase 0 产品界面完成。推荐流程：

```text
source snapshot
  -> scan
  -> parse to intermediate JSON
  -> validate
  -> stage
  -> admin review / import report
  -> publish structured records
```

首版数据源：

| 来源 | 目标对象 |
| --- | --- |
| `teacher/learner_profile.md` | 学习者画像、教学偏好、考试目标 |
| `teacher/exam_plan.md`、`teacher/dashboard.md` | 考试轨道、课程、考试日期、倒计时、完成度 |
| `teacher/study_plan.md`、`teacher/phase0_tasks.md` | 学习计划、阶段任务、checklist、重排记录 |
| `teacher/review_queue.md` | 复习项、下次复习日期、轮次、状态 |
| `teacher/daily_log.md`、`teacher/session_archive.md` | 历史学习 session、薄弱点、完成记录 |
| `teacher/subjects/*/syllabus.md` | 章节、知识点、考核层次、考频 |
| `teacher/subjects/*/progress.md` | 知识点学习状态和历史进度 |
| `teacher/subjects/*/mistakes.md` | 错题、错因分类、重练状态 |
| `materials/*/question_bank/stats.md` | 题库统计、题型分布、考频校准 |
| `materials/*/question_bank/chapter_*.md` | 题目、答案、解析、知识点链接 |
| 紧凑 YAML 题库格式 | 首选结构化题库导入格式 |

导入记录建议：

- `import_runs`：一次导入批次，记录 source repo/ref、状态、摘要、dry-run 报告。
- `source_documents`：被扫描的文件，记录 path、sha/hash、大小、来源类型。
- `source_blocks`：可追踪块，记录 heading path、line range、raw text、content hash。
- `imported_entities`：来源块到领域对象的映射，支持 diff、回滚和审计。
- `import_errors`：无法解析、无法映射或需要人工确认的块。

幂等规则：

- `source_path + heading_path + normalized_key + content_hash` 用于稳定识别来源块。
- 题目优先用 `course + src + id` 作为自然键；缺失时使用题干 hash。
- 知识点优先用 `course_code + kp_code`。
- 导入默认 dry-run 生成报告，确认后再 publish。
- 重复导入不得重复创建课程、题目、错题、复习项或学习日志。

质量规则：

- `dashboard.md`、`progress.md`、`syllabus.md` 中的知识点总数和完成数必须交叉校验。
- `review_queue.md` 中不能映射到知识点的条目进入 `import_errors`，不静默丢弃。
- `mistakes.md` 允许暂时没有题目引用，但必须能关联到课程或知识点文本。
- `exam_plan.md`、`dashboard.md`、`study_plan.md` 中同一考试日期冲突时记录 warning。
- Markdown 表格、混合日志或自由文本解析失败时保留 raw block。
- Phase 0/1 不使用 LLM 自动修复历史 Markdown，也不反写 `ai-teacher`。

## 5. AI / RAG 架构

所有模型调用必须经过统一 `ModelGateway`。业务代码不要直接调用 provider SDK。

AI/RAG 不承担首版数据初始化职责。首版先靠 Legacy Import 得到结构化课程、题库、错题、复习和历史学习状态。Phase 2 才让 AI 做受控草稿生成；Phase 3 再做教材、考纲、真题和补充资料的 evidence chunks。

推荐工作流：

```text
Legacy import / real seed
  -> structured courses / KPs / questions / learner state
  -> import report / staging / quarantine

Phase 3 material ingestion
  -> parse / OCR / chunk
  -> metadata 绑定 subject、kp、source、page
  -> embedding
  -> evidence chunks

Planner 选择学习 slot
  -> Prep Agent 生成 lesson packet draft
  -> Math render
  -> QA Agent 校验 schema / KP / 题目 / LaTeX / grounding / safety
  -> ready 或 quarantine

学生开始课堂
  -> Tutor Agent 只在 ready packet 范围内推进
  -> session events
  -> objective question deterministic grading
  -> complex answer -> Grader Agent
  -> deterministic event applier 更新 kp state / mistakes / review_items
  -> Coach 基于负荷和表现给节奏建议
```

Agent 边界：

| 角色 | 输入 | 输出 | 不应做 |
| --- | --- | --- | --- |
| Prep Agent | `prepJobId`、subject、kpCodes、题目、RAG chunks、学习阶段 | `LessonPacketDraft`、公式渲染请求、引用题目/证据、model call logs | 不实时授课，不直接发布 ready |
| Tutor Agent | `sessionId`、当前 step、学生答案、ready packet、学习者简要状态 | tutor message、session event 草案、grader 请求 | 不重新规划课程，不临场生成整节课，不直接改进度 |
| Grader Agent | question、rubric、official solution、student answer、kpCodes | `GradingResult`：score、feedback、errorCategories、confidence | 不批改简单客观题，不直接更新 mastery |
| QA Agent | draft packet、schemas、题库、KP、公式资产、evidence chunks | `QualityGateResult`、ready/quarantine 建议、失败原因 | 不绕过 admin 检查，不静默发布 |
| Coach Agent | session history、review load、missed days、错题趋势、过载信号 | 轻量复习建议、replan 请求、学习者偏好更新 | 不授课、不批改、不直接改计划 |

RAG 检索顺序：

```text
1. 当前课包
2. 结构化知识点和题目数据
3. 学习者记忆
4. RAG 证据 chunks
5. 只在 fallback 时使用通用模型知识
```

多租户检索必须先按 `tenant_id/course_id/subject_id/kp_codes` 等 metadata 过滤，再做向量相似度检索，防止资料泄漏。

## 6. 跨语言契约

TypeScript 和 Python 之间必须使用显式 schema 或 API 契约，不靠隐式字段约定。

建议基础接口：

```ts
type AgentRunContext = {
  tenantId: string
  userId?: string
  sessionId?: string
  lessonPacketId?: string
  prepJobId?: string
  traceId: string
  promptVersion: string
}

type AgentResult<T> = {
  status: 'ok' | 'needs_review' | 'failed'
  data?: T
  modelCallIds: string[]
  warnings: string[]
}
```

MVP 可先用 Zod 定义 JSON Schema，再生成或手写 Pydantic 对应模型；一旦进入真实 worker，schema 需要版本号。

## 7. 数据与存储建议

初始表按领域分层：

- 身份与租户：`users`、`organizations`、`enrollments`。
- 课程结构：`courses`、`subjects`、`chapters`、`knowledge_points`、`knowledge_point_prerequisites`。
- 题库：`questions`、`question_options`、`question_solutions`、`question_kp_links`。
- 课包：`lesson_packets`、`lesson_steps`、`lesson_packet_kp_links`、`formula_assets`。
- 学习运行时：`study_plans`、`study_plan_slots`、`study_sessions`、`learner_kp_states`、`mistakes`、`review_items`。
- 事件账本：`session_events`。
- 导入与来源追踪：`import_runs`、`source_documents`、`source_blocks`、`imported_entities`、`import_errors`。
- Worker 与内容管线：`prep_jobs`、`quality_gate_results`、`material_sources`、`material_chunks`。
- 可观测与成本：`model_calls`，后续可加 `job_runs`、`event_projection_runs`。

对象存储 key 建议 content-addressed，基于 hash 生成。重复渲染同一公式或导入同一材料时不产生重复资产。

导入数据必须显式区分：

- 公共内容库：课程、知识点、题目、答案、解析、考纲、教材、考频。
- 个人学习状态：学习者画像、进度、错题、复习队列、学习日志、学习计划、仪表盘状态。

这条边界是后续多用户化的前提。`ai-teacher` 里的个人错题、复习队列和 daily log 不能混入公共题库事实表。

## 8. Worker 通信

MVP 可以使用 HTTP + PostgreSQL job 表：

```text
Admin/BFF 写入 prep_jobs
BFF 调用 worker POST /v1/prep/generate { jobId, tenantId, subjectId, kpCodes, idempotencyKey }
worker 更新 job 状态并写入草稿/质量结果
BFF/Admin 读取 prep_jobs 和 lesson_packets 展示结果
```

推荐 worker 端点：

- `POST /v1/prep/generate`
- `POST /v1/prep/validate`
- `POST /v1/math/render`
- `POST /v1/ingest/material`
- `POST /v1/grade/evaluate`

后续如果引入队列或 Temporal，保持 job contract 不变。HTTP 触发可以替换成队列消息，但 `job_id`、`idempotency_key`、状态机和结果表不要重写。

## 9. 质量门禁

课包默认从 `draft` 开始。只有通过质量门禁后才能进入 `ready`；失败进入 `quarantine`。

门禁分层：

```text
Schema gate:
  LessonPacket / Step / Question / Event 全部校验

Reference gate:
  kpCodes 存在
  questionIds 存在
  prerequisites 合理

Math gate:
  LaTeX 可渲染
  SVG/PNG/alt text fallback 存在

Pedagogy gate:
  有 diagnostic 或 socratic step
  有 practice/review
  难度、时长、目标匹配

Grounding gate:
  关键解释可追踪到 evidence chunks
  真题/官方答案引用有效

Safety gate:
  无幻觉式来源
  无越权考试作弊引导
  无不当个人化判断

Runtime gate:
  Grader 低置信进入人工/admin review
  差评课包可回到 quarantine
```

## 10. 可观测性与成本

每次真实模型调用都必须写入 `model_calls`。建议字段：

```text
provider
model
task_type
prompt_version
tenant_id
user_id nullable
session_id nullable
lesson_packet_id nullable
prep_job_id nullable
input_tokens
output_tokens
cached_tokens nullable
estimated_cost
latency_ms
status
error_message nullable
request_hash
response_hash
retrieved_chunk_ids
safety_flags
created_at
```

至少监控：

- API 错误率。
- Worker 失败率和 job 延迟。
- 模型调用失败率和成本。
- 事件 projection 失败。
- RAG chunk 新鲜度和 top-k 相关性。
- 质量门禁失败率。
- MathBlock 渲染失败率。

需要用 `correlation_id` 串起 API request、worker job、model_call、quality_gate_result 和 session_event。

## 11. 关键取舍

| 决策 | 得到什么 | 放弃什么 |
| --- | --- | --- |
| 模块化单体优先于微服务 | 开发速度、事务一致性、低运维成本 | 短期不能独立扩缩每个领域模块 |
| 事件优先但不做全量 Event Sourcing | 课堂可审计、可重放，查询仍简单 | 需要维护事件到 projection 的一致性 |
| 预生成课包优先于实时生成整节课 | 质量门禁、成本控制、稳定课堂体验 | 个性化自由度较低 |
| PostgreSQL + pgvector 优先于独立向量库 | MVP 简洁、统一备份、统一权限 | 后续大规模检索可能迁移 |
| TypeScript + Python 分工 | Web 和 AI/data 各用擅长工具 | 必须维护显式 schema/API 契约 |
| 确定性状态机优先于 LLM 自治 | 可解释、可测试、可审计 | 需要把 AI 输出约束为结构化建议 |
| Legacy Import 前置于 RAG | 首版使用真实备考数据、避免 mock 验收失真 | 需要先处理 Markdown/YAML 解析和来源追踪 |
| Phase 0 不引入真实 LLM | 快速验证学习闭环结构 | 暂时不是完整 AI 产品体验 |

## 12. 当前架构基线

当前阶段坚持 Phase 0 范围：

- `ai-teacher` 只读导入器、staging、来源追踪和导入报告。
- monorepo 骨架。
- 共享 schemas。
- 真实 seed dashboard。
- 学科/知识点视图。
- 课包查看器。
- `MathBlock` fallback。
- 课堂骨架。
- local/demo session events。

明确不做：

- 通用聊天机器人。
- 完整 LMS。
- 复杂微服务。
- 生产计费系统。
- 真实 LLM 调用。
- 双向同步 `ai-teacher`。
- GitHub webhook 自动导入。
- Redis / Temporal / 独立向量数据库。
