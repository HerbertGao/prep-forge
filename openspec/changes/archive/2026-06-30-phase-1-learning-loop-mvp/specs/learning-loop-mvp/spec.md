## 新增需求

### 需求:今日任务与学习上下文
系统必须基于导入的 2026 年 10 月考试计划，向 demo 学习者展示考试倒计时、课程优先级和今日任务，并从已导入的 `daily_logs`、`review_items`、`mistakes` 恢复当前学习上下文。系统禁止用手写 mock 替代导入数据，且必须复用 Phase 0 dashboard 的考试/倒计时数据来源，禁止另立第二来源。

#### 场景:展示考试倒计时与今日任务
- **当** demo 学习者打开今日视图
- **那么** 系统必须展示来自导入考试计划的距考天数、按考试状态排序的课程优先级，以及今日任务（复习项「待复习」= `due_date ≤ today` 且 (`admin_confirmed_at IS NULL` 或 `admin_confirmed_at < last_applied_at`)；错题「活跃」= `admin_confirmed_at IS NULL` 的行）

#### 场景:恢复学习上下文
- **当** demo 学习者返回学习
- **那么** 系统必须从 `daily_logs`、`review_items`、`mistakes` 派生当前上下文，而非从零开始

#### 场景:高完成度课程识别为维护
- **当** 课程已有高完成度（如计算机系统原理 13015，重考）
- **那么** 系统必须将其呈现为维护/抗遗忘，禁止当作未开始课程从零重排

### 需求:Lesson Session 生命周期与步骤推进
系统必须支持创建 lesson session、按 `ready` 课包的 `steps` 顺序推进，并将每个课堂动作作为 `SessionEvent` 持久化到 PostgreSQL 的 `session_events` 表。事件信封必须通过共享 `SessionEvent` schema 校验后才持久化，且禁止扩展 `SessionEventType` 枚举。

#### 场景:开始课程创建 session
- **当** demo 学习者开始一节 `ready` 课包
- **那么** 系统必须创建 lesson session 并将 `lesson_started` 事件持久化到 `session_events`（带 `sessionId`、单调 `sequence`、`idempotencyKey`）

#### 场景:按课包步骤推进
- **当** 学习者在课堂中前进到下一步
- **那么** 系统必须按课包 `steps` 顺序展示对应步骤并持久化 `step_shown` 事件，且该事件的 `payload` 必须冻结该步的 `stepType` 与覆盖的 `kpCodes`；禁止以自由聊天替代结构化步骤

#### 场景:重复提交幂等
- **当** 同一动作因重试以相同 `idempotencyKey` 重复提交
- **那么** 系统禁止写入重复的 `session_events` 行

### 需求:完成课程与课包消费
系统必须在学习者走完 `ready` 课包最后一步后 emit `lesson_completed` 事件并将该课包状态由 `ready` 迁移为 `consumed`。「完成一节 ready 课包」作为可计数的有效学习闭环（WVLL）边界，其计数谓词必须完整覆盖 ROADMAP §2：完成一节 `ready` 课包或复习任务、产生 `session_events`、至少一次答案被批改、确定性代码更新了知识点状态/错题/复习队列、且课包未被质量门禁判失败或 `quarantine`。`lesson_packets.status` 的 `ready→consumed` 在本阶段按单 demo 学习者（无 auth）作为完成标记；多学习者按 learner 的 `lesson_completed` 事件计数留待后续。

#### 场景:完成课包
- **当** 学习者走完课包最后一步
- **那么** 系统必须持久化 `lesson_completed` 事件，并将课包状态迁移为 `consumed`

#### 场景:完成计入 WVLL 边界
- **当** 一节 `ready` 课包被完成、产生了 session events、至少一次答案被批改、确定性代码更新了 KP 状态/错题/复习队列、且未被质量门禁判失败或 `quarantine`
- **那么** 系统必须将该次完成识别为一个可计数的有效学习闭环（任一条件不满足则不计数）

### 需求:答案提交与客观题确定性批改
系统必须在学习者提交答案时持久化 `student_answered` 事件，并由确定性代码（非 LLM）对客观题（单选、多选；真实快照无判断题）批改。批改在**写入事件时**完成。客观题写 graded 载荷变体 `{ kind:"graded", gradingResult, resolvedKpCodes, modelCallId:null }`；主观/未知题型写 ungraded 变体 `{ kind:"ungraded", reason, resolvedKpCodes }`，禁止编造 `score`。客观题答案优先比对 `question_options.isCorrect`，当其为 null 时以 `question_solutions.answer` 为权威。`SessionEvent` 必须保持 `z.object` 信封、`payload` 仍可空，载荷形状经 `union + superRefine(eventType↔payload)` 约束（禁止顶层 `discriminatedUnion`，以免破坏 `schema.parity` 对 `.shape` 的依赖）。

#### 场景:客观题判对
- **当** 学习者对一道客观题提交的选项与权威答案一致
- **那么** 系统必须在 `student_answered.payload` 写入 `correct=true`、`score=1` 的 `GradingResult` 与对应 `resolvedKpCodes`

#### 场景:客观题判错
- **当** 学习者提交的客观题答案与权威答案不一致
- **那么** 系统必须在事件 payload 写入 `correct=false`、`score=0` 的 `GradingResult`，并记录可用于错题归类的信息

#### 场景:主观题不自动判分
- **当** 提交的题目类型不属于受支持的客观题型
- **那么** 系统必须写 ungraded 载荷变体（含 `reason`、`resolvedKpCodes`），禁止给出自动分数或编造 `score`（Phase 2 才接 AI 批改）

### 需求:事件驱动的确定性状态迁移
系统必须由确定性 event applier **仅依据 `session_events` 的有序事件载荷**（不回读题库现状）派生并写入 `learner_kp_states`（`unseen`→`taught`→`practiced`→`mastered`）、`mistakes`、`review_items`。学习进度禁止由 LLM 修改。applier 必须对每个 `(learner, kp)` **全量重折叠**其全部相关事件、按**全序 `(created_at, session_id, sequence)`** 排序（`created_at` 为服务端时间，同值时以唯一键 `(session_id, sequence)` 定序）、重算终态后经派生 id + `ON CONFLICT(id)` upsert 投影行（不用 per-session 指针做增量）；重放同一组事件必须得到一致终态。投影行的 upsert `SET` 只含派生字段，禁止覆盖 admin 列。

#### 场景:讲解步骤推进掌握度
- **当** 某 `step_shown` 事件的 payload `stepType ∈ {explanation, worked_example}`
- **那么** applier 必须依据 payload 的 `stepType`（不回读 `lesson_steps`）将该步 `kpCodes`（无步级 KP 时回退课包级 `kpCodes` 全集）的 `learner_kp_states.state` 至少推进到 `taught`

#### 场景:练习答对推进掌握度
- **当** `student_answered.payload` 的 `GradingResult` 判对
- **那么** applier 必须将相关 KP 推进到 `practiced`，并在累计判对达确定性阈值后推进到 `mastered`

#### 场景:答错创建错题（幂等）
- **当** `student_answered.payload` 判错
- **那么** applier 必须创建关联到课程或知识点的 `mistakes` 行（二者皆缺禁止创建），并以 `(source_session_id, source_sequence, question_ref)` 为幂等键，禁止重放时重复创建

#### 场景:投影状态与导入状态读侧合并
- **当** 某 KP 同时存在导入行（`origin=imported`）与 applier 投影行（`origin=system`，如 13015 维护 session）
- **那么** 系统必须在读侧合并为单一展示态（掌握度取二者单调 max），禁止覆盖导入行，也禁止因双行而重复计数

#### 场景:事件可重放出一致进度
- **当** 对同一组 `session_events` 重新运行 applier
- **那么** 派生的 `learner_kp_states` / `mistakes` / `review_items` 必须与首次运行一致（幂等）

### 需求:固定间隔确定性复习调度
系统必须以固定间隔确定性规则调度复习：基准锚定服务端 `created_at`（禁用 `Date.now()` 与客户端 `occurredAt`），判对按固定档位延后、判错按近期档位重排，阶梯位置由**全序 `(created_at, session_id, sequence)`** 的全量重折叠派生（消除 `created_at` 并列歧义，保证 dueDate 可重放）。投影复习项是**每 `(learner,course,kp)` 一条 `origin=system` 终态行**（非每事件一行），按派生 id + `ON CONFLICT(id)` upsert，且 applier 必须把该行 `last_applied_at` 持久化为该 KP 全部已折叠事件 `created_at` 的最大值（供 admin 确认门控）。导入的 `review_items`（`origin=imported`）只读，禁止 UPDATE。本阶段禁止引入 spaced-repetition 参数（如 ease factor）。复习项必须映射到知识点。

#### 场景:答对延后复习
- **当** 某 KP 的练习判对
- **那么** 系统必须以触发事件服务端 `created_at` 为基准、按固定档位向后设置投影 `review_items.dueDate`

#### 场景:答错近期重排
- **当** 某 KP 的练习判错
- **那么** 系统必须以 `created_at` 为基准将该 KP 的投影复习项（每 KP 单终态行）重排到近期档位

#### 场景:不覆盖导入复习项
- **当** 调度需要更新某个已导入的复习节奏
- **那么** 系统禁止 UPDATE `origin=imported` 行，必须以 `origin=system` 投影行表达新节奏，读侧再合并

#### 场景:复习项必须映射到知识点
- **当** 调度产生的复习项无法映射到某个知识点
- **那么** 系统禁止创建该复习项

### 需求:学习状态可追溯且不覆盖历史导入数据
系统派生的学习状态必须可追溯到产生它的 session 与事件序列，并且禁止改写或删除 `origin=imported` 的历史导入行。追溯列按行类型划分：1:1 的 `mistakes` 用 `source_session_id + source_sequence`（兼身份）；累积型 `learner_kp_states` 与每 KP 终态 `review_items` 用 `last_applied_session_id + last_applied_sequence`（审计指针，不带 `source_*`）。

#### 场景:新事件不覆盖导入状态
- **当** event applier 写入派生的学习状态
- **那么** 系统禁止改写或删除来自 legacy import（`origin=imported`）的历史行，只能写/更新 `origin=system` 投影行

#### 场景:派生状态可追溯到 session 与 sequence
- **当** 查看某条派生的学习状态
- **那么** 系统必须能将其追溯到对应的 `session_id` 与事件 `sequence`
