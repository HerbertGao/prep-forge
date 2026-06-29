## 1. Monorepo 和开发基础

- [x] 1.1 初始化 pnpm workspace、根 `package.json`、TypeScript 配置和基础脚本。
- [x] 1.2 创建 `apps/web` Next.js 应用，并配置 App Router、TypeScript、Tailwind 和基础 layout。
- [x] 1.3 创建 `packages/schemas`、`packages/db` 和 `packages/lesson-runtime` 的目录和包入口（Phase 0 不单独拆 `packages/config`/`packages/ui`，用根配置和 `apps/web` 内联承载）。
- [x] 1.4 添加本地开发文档，说明安装依赖、配置数据库、运行导入、启动 Web 和运行检查。

## 2. 共享 Schemas

- [x] 2.1 定义 legacy import schemas：`ImportRun`、`SourceDocument`、`SourceBlock`、`ImportedEntity`、`ImportError`、`ImportReport`；每个领域对象带稳定自然键、`origin`(`imported|system|ai_generated`) 和 public/personal 标记。
- [x] 2.2 定义课程结构 schemas：`ExamTrack`、`Course`、`Subject`、`Chapter`、`KnowledgePoint`、`LearnerProfile`。
- [x] 2.3 定义题库 schemas：`Question`、`QuestionOption`、`QuestionSolution`、`QuestionBankStats`、`QuestionKpLink`。
- [x] 2.4 定义个人学习状态 schemas：`LearnerKpState`、`Mistake`、`ReviewItem`、`StudyPlan`、`DailyLogEntry`（带稳定 ID 和 public/personal 标记）。
- [x] 2.5 定义学习体验 schemas：`LessonPacket`（含 `version` 和 `status: draft|ready|consumed|quarantine`）、`LessonStep`、`MathBlock`、`SessionEvent`（含 `event_type`、`event_version`、`sequence`、`actor_type`、`idempotency_key`、`occurred_at`、预留 `tenant_id`）。
- [x] 2.6 定义契约占位 schemas（仅类型与校验，不接真实运行时）：`GradingResult`、`QualityGateResult`、`ModelCall`。
- [x] 2.7 声明 schema SoT：Zod 为唯一来源，Drizzle 由其派生（`drizzle-zod` 或 parity 测试防漂移）。
- [x] 2.8 为核心 schemas 添加聚焦单元测试，覆盖有效数据、缺字段和类型错误。

## 3. 数据库基础

- [x] 3.1 选择并配置 Drizzle + PostgreSQL，创建 `packages/db` schema 和 migration 命令。
- [x] 3.2 建立 import provenance 表：`import_runs`、`source_documents`、`source_blocks`、`imported_entities`、`import_errors`。
- [x] 3.3 建立 Phase 0 领域表：课程/考试/章节/知识点、题库摘要、课包、session events，以及个人学习状态表（learner_kp_states、mistakes、review_items、study_plans、daily_logs），均带稳定 ID、`origin` 和 public/personal 区分。
- [x] 3.4 添加 seed/import 写入 helper：导入结果先写入 staging（imported_entities），生成报告后再显式发布为 demo seed；import_errors/quarantine 行不得发布。
- [x] 3.5 添加数据库初始化说明和最小 migration 验证命令。

## 4. Legacy Import Foundation

- [x] 4.1 创建 `scripts/import_legacy_ai_teacher.ts`，支持 `--source <path>`、`--dry-run` 和报告输出。
- [x] 4.2 实现 source scanner，扫描 `teacher/`、`teacher/subjects/*` 和 `materials/*/question_bank`；对扫描目录内匹配不到 parser 的文件也记为 `source_document`（status=unsupported）并在报告中列出；路径不存在/不可读或结构无效（非目录/空/两个顶层子树都缺）时 hard-fail，仅缺一个顶层子树时导入存在子树并 warning；均不静默丢弃。
- [x] 4.3 实现 source block 提取，记录 source path、heading path、line range、raw block 和 content hash。
- [x] 4.4 实现核心 Markdown parser，解析 learner profile、exam plan、dashboard、study plan、review queue、daily log、session archive、phase0 tasks。
- [x] 4.5 实现 subject parser，解析 syllabus、progress、mistakes、key_points；某学科缺少其中某文件时记 per-file skipped/warning 并继续，不报错；从 `exam_plan.md` 考试代码表把学科 slug 映射到 `course_code`；把 progress.md 状态词汇映射到 `unseen|taught|practiced|mastered`，无法映射的词汇落到明确默认值并记 warning（或 import_errors），不静默。
- [x] 4.6 实现 question bank parser，解析 `stats.md`、`chapter_*.md` 和紧凑 YAML 题库格式。
- [x] 4.7 按实体（非整文件）显式分类为公共内容库或个人学习状态：dashboard/phase0_tasks/session_archive 及 exam_plan 的考试计划→个人；exam_plan 派生的课程/考试轨道、syllabus/chapters/key_points→公共；learner_profile/progress/mistakes/review_queue/daily_log/study_plan→个人；不留未分类记录。
- [x] 4.8 实现 import report，统计 scanned、parsed、created、updated、skipped、quarantined 和 warnings。
- [x] 4.9 添加导入幂等测试：针对已持久化的前一次导入再次导入，验证 source block、课程（`course_code`）、考试轨道（`exam_track`）、题目（`course+src+id`，缺失时 `题干 hash + 章节 + 序号`）、知识点（`course_code+kp_code`）和个人状态实体各按稳定自然键不重复创建，且 content_hash 变化被判为 update 而非新建。
- [x] 4.10 为快照中所有学科生成稳定课程记录（4 门本考期 + 3 门已通过为最低覆盖；额外学科如第二外语日语 `00840` 也要导入）；在考状态取自 `exam_plan.md`，已通过状态可取自 exam_plan/learner_profile/已通过课程清单；slug 不在 exam_plan 代码表时给 provisional course_code + 状态 unmapped/未知 + warning，状态枚举 未开始/缺考/重考/在考/已通过/unmapped，不留 undefined 状态。
- [x] 4.11 实现跨文件一致性 warning：dashboard/progress/syllabus 知识点总数/完成数漂移、exam_plan/dashboard/study_plan 考试日期冲突、stats.md 声称题量与实际解析题量不一致；并按类型处理悬挂引用：review_queue 无法映射到知识点 → import_errors；mistakes 必须能关联到课程或知识点（二者皆无才报错）；daily_log 不要求知识点映射（按日期/source block 导入，仅无法挂到 source block 时报错），均不静默丢弃。

## 5. Web Seed Experience

- [x] 5.1 创建 seed 数据加载层，优先使用导入结果；fixture 仅用于本地/测试渲染，Phase 0 验收要求 dashboard 数据来自 import 发布到 PostgreSQL 的记录（可追溯到 import run/source block）。
- [x] 5.2 实现 dashboard 首页，展示 2026 年 10 月考期、各在考科目进度（含真实状态：在考/缺考/重考）、待复习/错题/薄弱点摘要；统计/日期冲突时按权威来源取值（进度数取 progress.md、日期取 exam_plan.md）并标注冲突；展示值可追溯到导入记录。
- [x] 5.3 实现 `/subjects/[subjectCode]` 页面，展示章节、知识点、考频和状态摘要。
- [x] 5.4 实现题库摘要展示，包含题量、题型分布、来源范围和知识点覆盖。
- [x] 5.5 实现课包查看器页面，展示课包目标、步骤、题目和答案/解析区域。
- [x] 5.6 实现 `MathBlock` inline/block 渲染和失败 fallback，提供可访问 alt text 和复制 LaTeX source 入口，并用窄视口截图/聚焦测试验证移动端不横向撑破页面。
- [x] 5.7 实现基础课堂骨架，支持开始 demo 课包、显示步骤、提交答案。
- [x] 5.8 记录 local/demo session events：`lesson_started`、`step_shown`、`student_answered`、`lesson_completed`。
- [x] 5.9 确保 demo session events 不更新正式掌握度、错题或复习队列。

## 6. Admin 导入报告

- [x] 6.1 实现 admin 导入报告页面，展示导入批次、扫描文件数、成功数、quarantine 数和 warnings。
- [x] 6.2 实现异常块列表，展示 source path、heading path、raw block 摘要和错误原因。
- [x] 6.3 在 UI 中明确区分人工导入数据、系统生成数据和 AI 生成数据。

## 7. 验证和验收

- [x] 7.1 运行 schema 单元测试、导入 parser 测试和幂等测试。
- [x] 7.2 运行 typecheck、lint 和 build，确保 workspace 基础可用。
- [x] 7.3 手动验证本地 Web：dashboard、学科页、题库摘要、课包查看器、课堂骨架、admin 导入报告。
- [x] 7.4 验证 Phase 0 非目标：没有 auth、billing、真实 LLM、RAG、Redis、Temporal、GitHub webhook 或 `ai-teacher` 反写。
- [x] 7.5 更新 README，记录本地启动、导入 dry-run、seed 发布和验收检查命令。
