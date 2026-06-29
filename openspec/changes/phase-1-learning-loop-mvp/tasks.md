## 1. 数据模型与基础（additive，向后兼容；不碰 Origin/SessionEventType 枚举与导入模型）

- [x] 1.1 查 DB 中 `questions.type` 的 distinct 取值，确定客观题型允许清单；确认种子课程（高数/操作系统）确有清单内客观题；确认 13015 导入 `learner_kp_states` 的 `mastered/total` pct 足够高再定 6.4 维护阈值 X
- [x] 1.2 一支 additive drizzle migration，仅追加可空列/索引：
  - 列：`mistakes` 加 `source_session_id`+`source_sequence`+`admin_confirmed_at`（**不加 `status`**——无读者）；投影 `review_items` 加 `last_applied_session_id`+`last_applied_sequence`+`last_applied_at`+`admin_confirmed_at`（**不加 `source_*`**——终态行非 1:1）；`learner_kp_states` 加 `last_applied_session_id`+`last_applied_sequence`
  - 冗余防护索引：`learner_kp_states` partial-unique `(learner_id,course_code,kp_code) WHERE origin='system'`（键全 notNull，有效）
  - **去重权威 = 派生 id + `ON CONFLICT(id)`**（null-safe）；`review_items`/`mistakes` 键列可空、不靠 partial-unique 去重
  - **不新增 `origin` 列、不加 `projected` 值、不加 `level` 列**
- [x] 1.3 `SessionEvent` Zod 改动须保持 `z.object`/`.shape`、`payload` 仍 `.optional().nullable()`（见 2.1）；列追加无需改 `schema.parity.test`（`table ⊇ Zod` 单向）
- [x] 1.4 确认 demo `learnerId` 取自导入的 `learner_profiles`（单行），`enrollmentId`/`tenantId` 保留可空不派生

## 2. lesson-runtime：确定性核心（纯函数 + focused tests）

- [x] 2.1 `SessionEvent` payload：保持 `z.object` 信封，`payload: z.union([...]).optional().nullable()` + `.superRefine(eventType↔payload)`（禁止顶层 `discriminatedUnion`）；变体 `step_shown→{stepType, kpCodes}`、`student_answered→{kind:"graded",gradingResult,resolvedKpCodes,modelCallId:null}|{kind:"ungraded",reason,resolvedKpCodes}`；**`lesson_started`/`lesson_completed` 允许无 payload**（不破坏现有无 payload fixture，加一个无 payload 的 focused test）
- [x] 2.2 session 状态机：创建 session、按课包 `steps` 顺序推进、生成通过校验的事件（单调 `sequence` + `idempotencyKey`）；`step_shown` 冻结该步 `stepType` + `kpCodes`
- [x] 2.3 客观题 grader：按 type 允许清单比对，`question_options.isCorrect` 优先、为 null 时以 `question_solutions.answer` 为权威；客观题写 graded、未知/主观写 ungraded（不编造 `score`）
- [x] 2.4 event applier：**仅读事件 payload**，对每个 `(learner,kp)` 全量重折叠其全部相关事件、按**全序 `(created_at, session_id, sequence)`** 排序、重算终态后经**派生 id + `ON CONFLICT(id)`** upsert 投影行（`origin=system`）；`SET` **按表只列各自派生字段**（`learner_kp_states`=`state`/`score`/`last_applied_*`；`review_items`=`due_date`/`last_applied_*`），**绝不含 `admin_confirmed_at`**；禁写 `origin=imported` 行；`taught` 据 payload `stepType ∈ {explanation,worked_example}` 触发
- [x] 2.5 固定间隔复习调度器：基准服务端 `created_at`、全序 `(created_at,session_id,sequence)`（禁用 `Date.now()`/`occurredAt`）；每 `(learner,course,kp)` 一条 `origin=system` 终态行经派生 id upsert，并写 `last_applied_at` = 最新已折叠事件 `created_at`（供 admin 确认门控）；不 UPDATE 导入行；无 ease factor
- [x] 2.6 `mistakes` 幂等：派生 id `(source_session_id,source_sequence,question_ref)` + `ON CONFLICT(id)`（null-safe，不靠 partial-unique）
- [x] 2.7 重放一致性测试：同一组 `session_events` 全量重折叠（全序），KP 状态/错题/复习项（含 dueDate）与首次一致；含 `created_at` 并列用 `(session_id,sequence)` 定序的用例
- [x] 2.8 定义并导出 lesson-runtime 公共 API（供 web server action 调用）

## 3. 手工种子 ready 课包

- [x] 3.1 编写 2–3 个确定性课包 fixture（高数 + 操作系统），`origin=system`/`status=ready`，`lesson_steps.questionIds` 存完整自然键 `course+src+questionId`（或 `questions.id`），KP 覆盖经 `question_kp_links` 校验；**每个课包至少含一道允许清单内客观题**
- [x] 3.2 seed 脚本：写入前过 schema + 题目引用校验，引用无法解析的课包跳过/置 `quarantine`；有效课包按自然键幂等写入；re-seed 重置 `lesson_packets.status`
- [x] 3.3 验证种子课包为 `ready`、引用可解析，且完成一节种子课包产出 ≥1 graded 答案（可计入 WVLL）

## 4. Web：课堂闭环

- [x] 4.1 升级 `/learn/[lessonId]`：加载 ready 课包、按步骤推进、持久化 `session_events`（payload 按 2.1）、事件持久化后（事务内）调用 applier
- [x] 4.2 完成课包：走完最后一步 emit `lesson_completed`、课包 `ready→consumed`；WVLL 计数谓词完整覆盖 ROADMAP §2
- [x] 4.3 今日任务视图：复用 Phase 0 dashboard 考试/倒计时来源，展示倒计时、课程优先级、今日任务（复习项「待复习」= `due_date ≤ today` 且 (`admin_confirmed_at IS NULL` 或 `admin_confirmed_at < last_applied_at`)；错题「活跃」= `admin_confirmed_at IS NULL`）
- [x] 4.4 学习上下文恢复：从 `daily_logs`/`review_items`/`mistakes` 派生；高完成度课程（13015 重考，按 6.4 阈值）标记为维护
- [x] 4.5 基于导入题库的练习筛选入口（按课程/知识点经 `question_kp_links`/题型/错题/考频）；课包外作答也开 session 走 events→applier
- [x] 4.6 读侧合并（区分 per-KP 投影与 per-event 错题）：per-KP——`progressFor`、`buildSubject`（按 `kpCode` 取单调 max 而非 last-wins）、`reviewDue` 按 `(learner,course,kp)` 合并 imported+system 单行（同 KP 两行时 `origin=system` 的 `due_date` 为准、ISO 格式一致）；per-event——`mistakeCount` 按 mistake `id` 去重并集、**不按 KP 折叠**（system 错题是真实新错题）

## 5. Admin 与人工确认

- [x] 5.1 扩展 `/admin`：课包列表（`status`/绑定知识点/步骤数）
- [x] 5.2 人工确认题目/答案/知识点映射路径，记录确认且不覆盖导入来源数据
- [x] 5.3 人工确认错题/复习：在对应 `origin=system` 行写 `admin_confirmed_at`，禁止触碰 `origin=imported` 行；确认后该错题/复习项本周期离开今日列表；applier 重折叠不写 admin 列，后续答错（复习把 `due_date` 拉近且 `last_applied_at` 前移过确认时间 / 错题新建行）仍重新浮现

## 6. 集成验证（对 ROADMAP §6 退出门槛）

- [x] 6.1 端到端：demo 学习者开始课程 → 答客观题 → 批改（payload 冻结 grade）→ 错题 → 复习更新，进度由确定性代码更新
- [x] 6.2 完成一节 ready 课包后 emit `lesson_completed`、课包置 `consumed`、产出 ≥1 graded 答案；全量重折叠（全序）重放事件得到一致进度（含复习 dueDate）
- [x] 6.3 KP 状态/错题/复习项由 applier 派生；`origin=imported` 行不被改写；读侧合并后无重复计数；admin 确认为咨询性、答错后 KP 重新浮现；派生状态可追溯到 session+sequence
- [x] 6.4 课堂 UI 围绕课包步骤推进（非纯聊天框）；计算机系统原理按既定完成度阈值（`pct ≥ X`，apply 时定）识别为维护/抗遗忘
- [x] 6.5 `openspec-cn validate --strict` 通过；lesson-runtime focused tests（重放幂等、全序定序、读侧合并、无 payload 事件、admin 咨询性不阻止重新浮现）+ `pnpm -r typecheck` 通过
