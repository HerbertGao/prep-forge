## 上下文

Phase 0 已交付并验收：真实 `ai-teacher` 数据在 PostgreSQL（24 表），Web 以 `source=="db"` 展示。共享 `packages/schemas` 已定型 `LessonPacket`/`LessonStep`/`Question`/`SessionEvent`/`GradingResult` 等 Zod。

经本变更三轮 review 核对到的关键事实（直接约束设计）：
- **`origin` 已存在**：所有领域表经 `baseEntityColumns()` 带 `origin originEnum NOT NULL`，枚举 = `imported|system|ai_generated`（无 `projected`），`schema.parity.test` 双向钉死 drizzle pgEnum === Zod `Origin`。投影行复用 `origin=system`，导入行 `origin=imported`。
- **无自然键唯一索引**：`learner_kp_states`/`mistakes`/`review_items` 仅有 `id` 主键。`learner_kp_states` 三个键列均 NOT NULL；`review_items.learner_id/course_code` 可空（`kp_code` notNull）；`mistakes` 多列可空。导入侧 `publish.ts` 由自然键派生稳定 `id` + `ON CONFLICT(id)`。
- **读模型假设每个自然键一行**：`seed.ts` 的 `progressFor`、`buildSubject`（按 `kpCode` last-wins）、`buildDashboard` 内联 `reviewDue=raw.reviewItems.length`、`mistakeCount=raw.mistakes.length`。
- **事件时间**：`session_events.occurred_at` 客户端提供（不可信）；`created_at` 服务端 `defaultNow()` = `transaction_timestamp()`，**同一事务内多事件取值相同**（保证有并列），故 `created_at` 单列非全序，需要次级键。`(session_id, sequence)` 有唯一索引，可作 tiebreaker。
- **`SessionEvent` 是 `z.object`**，`payload = z.unknown().optional()`；`schema.parity.test` 依赖 `SessionEvent.shape`；现有 `schemas.test.ts` 的 valid fixture 是 `lesson_started` 且**无 payload**（payload 约束不能破坏它）。已实测 zod 4.4.3：`z.object({...payload:z.union([...]).optional().nullable()}).superRefine(...)` 仍暴露 `.shape` 且 payload 非必填。
- **`SessionEventType` 冻结 4 值**；`actorType` = `student|system|tutor`。`mistakes` **无 status 列**；`review_items` 有 `status` 文本列。
- **题目身份**：`questions.id = question#${course:src:questionId}`（PK）；`questions_natural_key_uq=(course,src,questionId)`；KP 在 `question_kp_links`。
- `recordSessionEvent`（Phase 0）只写 ledger、`onConflictDoNothing`，从不更新学习状态表。

约束（PRODUCT / ROADMAP §6、§10）：PostgreSQL 是事实来源；进度事件优先、由确定性代码派生；无真实 LLM；**不覆盖历史导入数据**；课堂不退化为聊天框。

## 目标 / 非目标

**目标：** 在 `packages/lesson-runtime` 实现纯确定性、可重放、有聚焦测试的 session 状态机、客观题 grader、event applier、固定间隔复习调度器；课堂围绕 `ready` 课包步骤推进，session events 落 `session_events`，applier 确定性更新学习状态；「完成一节 ready 课包」成为 WVLL 可计数边界；手工种子少量 `ready` 课包；今日任务/上下文恢复 + admin 课包列表与人工确认。

**非目标：** 不生成课包、不做主观题 AI 批改、不接实时 Tutor LLM、不做个性化/自适应/跨课程排程（Phase 2+）；不加 auth/Stripe/RAG/Redis/Temporal；**不扩展 `SessionEventType`、不修改 `Origin` 枚举、不重构导入模型**。

## 决策

**D1 — event applier 落在 `packages/lesson-runtime`，纯函数。** Web server action 事务内：先持久化 `SessionEvent`，再调用 applier 计算状态变更并写库。

**D2 — 事件载荷自带判定结果；`SessionEvent` 保持 `z.object` 信封。** 不用顶层 `z.discriminatedUnion`（移除 `.shape`、破坏 parity）。保持 `z.object`，`payload: z.union([...]).optional().nullable()` + `.superRefine(eventType↔payload)`。载荷变体：
- `step_shown` → `{ stepType: LessonStep["type"], kpCodes: string[] }`（**带 stepType**，让 applier 在「只读 payload」下区分讲解类与练习类步骤）
- `student_answered` → `{ kind:"graded", gradingResult: GradingResult, resolvedKpCodes, modelCallId:null }` | `{ kind:"ungraded", reason, resolvedKpCodes }`
- `lesson_started` / `lesson_completed` → **允许无 payload**；superRefine 仅约束 `step_shown`/`student_answered`，不得破坏现有无 payload fixture。
applier 只读事件载荷，不回读题库现状。

**D3 — 客观题 grader 按 `Question.type` 字符串路由 + 允许清单。** 命中客观题型则比对：`question_options.isCorrect` 优先、为 null 时以 `question_solutions.answer`（notNull）为权威；写 graded 载荷。未命中写 ungraded 载荷、不判分。实现前查 DB `questions.type` 取值填清单。

**D4 — 投影为「全量重折叠」，按全序排列，天然幂等。** applier 对每个 `(learner,kp)` 全量重折叠其全部相关事件，**按全序 `(created_at, session_id, sequence)` 排序**（`created_at` 同值时以 `(session_id,sequence)` 唯一键定序，非 audit-only），重算终态后 upsert 投影行。KP 状态：`taught`（payload `stepType ∈ {explanation, worked_example}` 的 `step_shown` 后，KP 取该步 `kpCodes`，无步级 KP 时回退课包级 `kpCodes` 全集——粗粒度，写 spec）；`practiced`（≥1 次该 KP 判对）；`mastered`（累计判对达阈值 `N`，初定 2）。状态单调。upsert 的 `ON CONFLICT DO UPDATE SET` **按表只列各自派生字段**（`learner_kp_states` = `state`/`score`/`last_applied_session_id`/`last_applied_sequence`；`review_items` = `due_date`/`last_applied_session_id`/`last_applied_sequence`/`last_applied_at`——`learner_kp_states` 无 `due_date` 列、`review_items` 无 `state`/`score` 列），**绝不含 `admin_confirmed_at`**（admin 列由 D11 拥有）。

**D5 — 复习调度：固定间隔阶梯，全序排列，每 KP 单终态行。** 判对 → `dueDate = created_at + ladder[next]`、判错 → 近期档；阶梯与 dueDate 由 D4 同一全序重折叠派生（不再有 created_at 并列歧义）。投影复习项是每 `(learner,course,kp)` 一条 `origin=system` 终态行。导入 `review_items`（`origin=imported`）只读。无 ease factor（**resolve ROADMAP §13 open question**：固定间隔，不引入 spaced-repetition）。

**D6 — 手工种子 `ready` 课包按题目自然键绑定，且必含客观题。** `origin=system`/`status=ready`；`lesson_steps.questionIds` 存完整自然键 `course+src+questionId` 或 `questions.id`（不存裸 id）；KP 覆盖经 `question_kp_links` 校验。**种子课包必须至少含一道允许清单内的客观题**，否则完成它不产生 graded 答案、永远计不进 WVLL（验收须断言完成一节种子课包产出 ≥1 graded 答案）。引用无法解析的课包禁止写 `ready`（跳过/quarantine）。生成属 Phase 2。

**D7 — 投影行身份：派生 id + `ON CONFLICT(id)` 为唯一权威机制。**
- `learner_kp_states` 与投影 `review_items`：`id` 由 `(learner_id,course_code,kp_code,origin)` 派生 + `ON CONFLICT(id)`（沿用 `publish.ts`，id 恒非空、确定）。partial unique index `(learner_id,course_code,kp_code) WHERE origin='system'` **仅作冗余防护**，且因 `review_items.learner_id/course_code` 可空、Postgres NULL 视作相异、**不能**单独保证去重——故权威机制是派生 id，不是 partial-unique。
- `mistakes`（每事件 1:1）：`id`/幂等键由 `(source_session_id,source_sequence,question_ref)` 派生 + `ON CONFLICT(id)`（null-safe）；不依赖 partial-unique 去重。
- applier 禁写 `origin='imported'` 行。
- **读侧合并**（区分 per-KP 投影 与 per-event 错题）：
  - per-KP 投影（KP 状态、复习项）按 `(learner,course,kp)` 合并 imported+system 单行：`progressFor`/`buildSubject` 掌握度取单调 max（改 last-wins）；`reviewDue` 复习项每 KP 单行去重，**同时存在 imported 与 system 行时以 `origin=system` 行的 `due_date` 为准**（系统投影=新节奏；缺 system 行则用 imported）；`due_date` 必须与读路径 `daysUntil` 同一 ISO 格式，避免 TEXT 解析不一致。
  - per-event 错题**不按 KP 折叠**：`mistakeCount` = imported+system 错题行按 mistake `id` 去重后的并集（system 错题是真实新错题，非 imported 的跨源副本）。
  - 13015（导入高完成度 + 维护 session）即 per-KP 合并路径，写 spec 场景。
  - apply 边角（导入侧数据）：导入 `review_items` 的 `course_code` 可空且每 `(course,kp)` 可有多行/`due_date` 可空，合并键以 notNull 的 `(learner, kp_code)` 为准（course 用 coalesce），导入侧多行取最大非空 `due_date`；NULL-due 导入项是否进「待复习」在 apply 时定并补 focused case。
  - dashboard 顶部的 `reviewDue`/`mistakeCount` 是**去重后的总量**（非今日门控量）；今日列表才按 D11 门控（due / `admin_confirmed_at`）——两者口径不同，UI 须分别标注。

**D8 — 单一 demo 学习者、无 auth。** `learnerId` 取 `learner_profiles`（1 行）；`enrollmentId`/`tenantId` 保留可空。

**D9 — Web 复用 Phase 0 资产。** 升级 `/learn/[lessonId]`、新增今日任务/上下文恢复与练习入口、扩展 `/admin`；今日视图复用 Phase 0 dashboard 来源。

**D10 — 完成单元与 WVLL（编码 ROADMAP §2 完整谓词）。** 课包最后一步后 emit `lesson_completed`、课包 `ready→consumed`。WVLL 计数谓词完整覆盖 §2：完成 ready 课包/复习任务 ∧ 产生 events ∧ ≥1 答案被批改（graded）∧ 确定性更新 KP/错题/复习 ∧ 未被质量门禁判失败/quarantine。`lesson_packets.status` 全局态在单 demo learner（D8）下作完成标记；多学习者按 learner 的 `lesson_completed` 计数留待后续；re-seed 须重置 status。

**D11 — admin 人工确认 = 咨询性审计标记，与派生调度解耦（修正「粘滞终态」反模式）。**
追加唯一可空列 `admin_confirmed_at timestamptz`（`mistakes` + `review_items`），**不加 `mistakes.status`**（无读者=死列）。admin 确认错题已处理/复习已完成 = 在对应 `origin=system` 行（`mistakes` 为该**每事件行**、`review_items` 为该**每 KP 终态行**）写 `admin_confirmed_at`，**禁止触碰 `origin=imported` 行**。两条 admin 路径都有功能性读者、都保抗遗忘，机制因身份粒度不同而异：
- **错题（每事件行）**：今日「活跃错题」= `admin_confirmed_at IS NULL` 的错题行；admin 确认即写 `admin_confirmed_at` → 该行离开列表；**同一 KP 后续再答错是新的每事件行**（新 `(source_session_id,source_sequence)`、`admin_confirmed_at` 为空）→ 自然重新浮现，不改写旧行。
- **复习（每 KP 终态行，原地更新，故需时间戳门控）**：applier 在重折叠时把 `review_items.last_applied_at` 写为该 KP **全部已折叠事件 `created_at` 的最大值**（与 tasks 2.5 一致；不等同于仅 dueDate 的调度触发事件——尾随的被动 `step_shown` 也计入）。今日「待复习」= `due_date ≤ today` **且**（`admin_confirmed_at IS NULL` **或** `admin_confirmed_at < last_applied_at`）。admin 确认即写 `admin_confirmed_at`（≥ 当前 `last_applied_at`）→ 该复习项在本周期离开列表；后续答错重折叠把 `due_date` 拉近、`last_applied_at` 前移到确认之后 → `admin_confirmed_at < last_applied_at` → 重新浮现（抗遗忘，13015 即此）。
applier 重折叠覆盖派生字段（含 `last_applied_at`）、**从不写 `admin_confirmed_at`**——admin 列与派生列不相交，无需特殊合并；「确认是否仍有效」由 `admin_confirmed_at` 与派生 `last_applied_at` 的时间比较决定，不靠 applier 改写 admin 列。apply 边角：尚无 `origin=system` 行的纯导入 KP（无学习活动）「确认复习完成」无处落点——fail-safe 行为是该项按导入 `due_date` 浮现直到学习者做它（即生成 system 行）；是否允许 admin 直接 upsert 一条空 system 行在 apply 时定。

**D12 — 可追溯。** `mistakes`（1:1）带 `source_session_id + source_sequence`（兼身份与溯源）。`learner_kp_states` 与投影 `review_items`（每 KP 终态）带 `last_applied_session_id + last_applied_sequence` 作审计指针（非身份）；`review_items` 另带派生 `last_applied_at timestamptz`（最新已折叠事件的 `created_at`），供 D11 的 admin 确认时间戳门控读取。`review_items` **不带** `source_*`（终态行非 1:1）。所有列均 drizzle-only 可空追加：`table ⊇ Zod` 单向、**列追加无需改 parity**；仅 `SessionEvent` Zod 的 payload 改动受 `.shape` 约束（D2，已实测安全）。错题行的 `kp_code` 单列：一题命中多 KP 时，错题行按课程关联（KP 尽力而为），逐 KP 的关注由 `review_items` 承载（applier 对每个 `resolvedKpCode` 各自调度复习），不靠 `mistakes`。

## 风险 / 权衡

- `Question.type` 取值多样 → 查 DB distinct 填允许清单，未知 ungraded；focused test 覆盖。
- 全量重折叠成本 → 单 demo learner、数据量小，可接受；Phase 2 多学习者再评估增量（需服务端单调全局序，非本阶段）。
- `created_at` 并列 → 全序 `(created_at, session_id, sequence)` 消歧，复习 dueDate 可重放。
- `occurred_at` 客户端不可信 → 排序/调度一律服务端 `created_at` + 唯一键 tiebreaker。
- admin 确认与抗遗忘 → `admin_confirmed_at` 咨询化、due-ness 以 `due_date` 为准，避免「completed-but-due」与 Phase 2 reopen 死角。
- 客户端赋 `sequence` 竞争、败者 `onConflictDoNothing` 静默丢弃 → 单 demo learner 缓解；可在同事务服务端赋 `sequence`，低优先。
- `taught` 粗粒度：无步级 KP 时讲解步骤标全部 `kpCodes` taught，略夸大（`pct` 用 `mastered/total` 不受影响）——spec 注明。

## 迁移计划

- 一支 additive drizzle migration：列——`mistakes` 加 `source_session_id`+`source_sequence`+`admin_confirmed_at`（**不加 `status`**——无读者）；投影 `review_items` 加 `last_applied_session_id`+`last_applied_sequence`+`last_applied_at`+`admin_confirmed_at`（**不加 `source_*`**）；`learner_kp_states` 加 `last_applied_session_id`+`last_applied_sequence`。冗余防护索引：`learner_kp_states` partial-unique `(learner,course,kp) WHERE origin='system'`（其键全 notNull，有效）。**去重权威靠派生 id + ON CONFLICT(id)，不依赖可空列 partial-unique。** 无破坏性变更；回滚=删新增列/索引。不碰 `Origin`/`SessionEventType` 枚举与导入模型。
- 同一支 migration 另加一张 additive 独立审计表 `admin_confirmations`（`id`/`entity_type`/`entity_id`/`confirmed_at`/`note`）：以**引用方式**记录内容（题目/答案/KP 映射）的人工确认——`entity_id` 存被确认导入行自身的 id 值，本表**绝不读回也绝不修改** `questions`/`question_solutions`/`question_kp_links`。`id` 派生为 `confirm#<entityType>:<entityId>`，重复确认走 `ON CONFLICT(id)` upsert（不产生重复行）。无 Zod 对应物（无导入来源、非领域对象；parity 为表 ⊇ Zod，故缺它仍绿）。回滚=删表。
- `SessionEvent` Zod：payload 改 union+superRefine（保 `z.object`/`.shape`、payload 仍 optional/nullable、允许无 payload 事件），不改列、不破 parity。
- 种子课包按自然键幂等写入；re-seed 重置 `lesson_packets.status`。
- 不触碰 legacy import 历史导入行。

## 开放问题

- `mastered` 阈值 `N`（初定 2）与复习阶梯档位（1/3/7/14d）——apply 阶段结合真实题量确认。
- 客观题 `type` 的确切字符串集合——apply 时查 DB 落允许清单。
- 「高完成度课程→维护/抗遗忘」的完成度阈值（如 `pct ≥ X`）——apply 时定，写入 6.4 验收。
- 标准 practice（课包外）开 session 走 events→applier（已定）。

## Apply 调查记录（task 1.1，2026-06-29 实测 DATABASE_URL）

- **`questions.type` distinct（15 值）**：单选题 7000 / 単選題 1037 / 填空题 921 / 计算题 736 / 简答题 727 / 多选题 635 / 论述题 309 / 综合题 271 / 证明题 128 / 综合应用题 16 / 应用题 16 / 名词解释 6 / 分析题 6 / 单选題 4 / 材料题 1。
- **客观题允许清单**：单选/多选（含 Unicode 变体）= `{单选题, 単選題, 单选題, 多选题}`。注意「单选」有三个字符变体（`单选题` U+5355/U+9009/U+9898、`単選題` 日文/繁体字、`单选題` 混合）——grader（task 2.3）比对前需归一化或把变体全列入清单。**数据中无 `判断题`**（spec 提到的「判断」题型在真实快照不存在，清单不含它）。
- **种子课程确有客观题**：高数 00023 单选题×320；操作系统 13180 单选题×699 + 多选题×130（两课均满足 D6「至少一道清单内客观题」）。
- **13015（计算机系统原理，重考）维护阈值依据**：`learner_kp_states` 中 13015 = 3 mastered / 3 total = **100%**（全 `origin=imported`）。demo 单 learner = `ai-teacher-self`（`learner_profiles` 单行，task 1.4 确认）。→ 6.4 维护阈值 X 数据支持取较高值（如 `pct ≥ 0.8`），最终值仍按 6.4 deferred 不在本组定。
