## 为什么

Phase 0 已验收：真实 `ai-teacher` 数据导入 PostgreSQL（14 门课、930 知识点、11813 题、33 复习项），Web 能以 `source=="db"` 展示 dashboard、学科/知识点、课包查看器和课堂骨架。但现在课堂只是骨架，session events 只在本地记录，进度不会真正更新——产品最核心的「学习闭环」还没跑通。

Phase 1 让**一个 demo 学习者基于已导入的真实数据完成一次确定性学习闭环**：学习 → 练习 → 客观题批改 → 错题 → 复习更新，进度由确定性代码（事件派生）修改，而不是 LLM。这是把 prep-forge 从「能展示真实数据」推进到「能产生有效学习闭环（WVLL）」的第一步，也是 Phase 2 AI 备课、Phase 3 RAG 的前置地基。

## 变更内容

- 新增**确定性学习闭环运行时**（填充 `packages/lesson-runtime` stub）：
  - lesson session 创建、课堂步骤推进、答案提交。
  - 客观题（单选/多选/判断）确定性批改，产出 `GradingResult`。
  - 课堂动作产出 `SessionEvent` 并**持久化到 `session_events` 表**（替代 Phase 0 的 local-only 记录）。
  - **event applier**：确定性地从 `session_events` 派生并更新 `learner_kp_states`（unseen → taught → practiced → mastered）、创建 `mistakes`、调度 `review_items`。事件可重放出一致进度。
  - 复习调度采用**固定间隔确定性**规则（答对延后固定档位、答错近期重排），扩展已导入的 `review_items`，不引入 spaced-repetition 参数。
- 新增**今日任务与学习上下文恢复**：
  - 基于导入的 2026-10 考试计划展示倒计时、课程优先级、今日任务。
  - 从 `daily_logs`、`review_items`、`mistakes` 恢复当前学习上下文。
  - 对计算机系统原理（13015，重考、高完成度）这类课程，识别为「维护/抗遗忘」而非从零开始。
- 新增**手工种子 ready 课包**与 admin 视图：
  - 少量确定性手写 `ready` 课包（`lesson_packets`/`lesson_steps`），绑定真实导入的 KP 和题目；**课包生成留给 Phase 2**。
  - 基于导入题库按课程/知识点/题型/错题/考频筛选练习题。
  - admin 课包列表 + 人工确认题目/答案/知识点映射/错题状态/复习完成的最小路径。
- 升级 Phase 0 课堂：课堂 UI 围绕课包步骤推进（非纯聊天框），session events 落 DB。

明确**非目标**（ROADMAP §6）：

- 不生成课包（AI 备课是 Phase 2）。
- 不做主观题复杂 AI 批改（仅客观题确定性批改）。
- 不做个性化规划、不引入实时 Tutor LLM、不做自适应学习算法、不做跨课程智能排程。
- 不做 auth / Stripe / RAG / Redis / Temporal（分别属 Phase 3/4）。
- 新产生的学习数据不覆盖历史导入数据（事件 projection 与导入状态可区分、可追溯）。

## 功能 (Capabilities)

### 新增功能

- `learning-loop-mvp`: 确定性学习闭环——今日任务与上下文恢复、lesson session 生命周期、课堂步骤推进、答案提交、客观题批改、`SessionEvent` 持久化、event applier 更新 `learner_kp_states`/`mistakes`/`review_items`、固定间隔复习调度、事件可重放一致性。
- `lesson-packet-seed`: 手工种子 `ready` 课包（绑定真实 KP/题目）、基于导入题库的练习题筛选、admin 课包列表与人工确认题目/答案/KP映射/错题/复习的最小路径。

### 修改功能

- `learning-seed-experience`: 「课堂骨架和 Local Session Events」需求升级——课堂从 demo 骨架 + 本地事件，变为围绕 ready 课包步骤推进、session events 持久化到 PostgreSQL 的真实闭环入口。

## 影响

- **代码**：填充 `packages/lesson-runtime`（session 状态机、grader、event applier、复习调度器，纯确定性、有聚焦测试）；`apps/web` 升级 `/learn/[lessonId]` 课堂、新增今日任务/上下文恢复与练习入口、扩展 `/admin` 课包列表与确认路径；新增手工种子课包数据与 seed 脚本。
- **数据模型**：开始写入 Phase 0 已建但为空的 `session_events`、`lesson_packets`、`lesson_steps`；确定性更新 `learner_kp_states`、`mistakes`、`review_items`。复用现有 24 表 schema，仅做 additive 可空列/索引补充（`mistakes` 的 `source_session_id`/`source_sequence`、`learner_kp_states`/`review_items` 的 `last_applied_session_id`/`last_applied_sequence` 审计指针、`review_items` 的派生 `last_applied_at`（admin 确认门控输入，非纯审计）、`mistakes`/`review_items` 的 `admin_confirmed_at`）。去重权威 = 派生 id + `ON CONFLICT(id)`；partial unique index 仅作冗余防护、且仅加在键列全 notNull 的 `learner_kp_states`。`SessionEvent` Zod 仅把 `payload` 改为 union+superRefine（保持 `z.object` 与 `.shape`，不破 parity）。**不新增 `origin` 列、不改 `Origin`/`SessionEventType` 枚举、不重构导入模型**（投影行复用现有 `origin=system`，导入行 `origin=imported` 只读）。
- **Schemas**：复用 `packages/schemas` 的 `LessonPacket`/`LessonStep`/`Question`/`SessionEvent`/`GradingResult`；如缺字段则在 Zod + drizzle 两侧显式同步，保持 TS 单一事实来源。
- **领域行为**：首次引入确定性状态迁移（事件 → 进度）。无真实 LLM 调用、无 `ModelCall` 写入（Phase 2 才有）。
- **可追溯性**：事件派生的学习状态与导入来源（source block / import run）保持可区分，历史导入数据只读不被覆盖。
