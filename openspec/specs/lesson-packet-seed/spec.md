# lesson-packet-seed 规范

## 目的
待定 - 由归档变更 phase-1-learning-loop-mvp 创建。归档后请更新目的。
## 需求
### 需求:手工种子 Ready 课包
系统必须提供少量确定性手工编写的 `ready` 课包（`lesson_packets` + `lesson_steps`）。`lesson_steps.questionIds` 必须存完整自然键三元组 `course + src + questionId` 或解析出的 `questions.id`（禁止裸 `questionId`，否则不可唯一解析）；`kpCode` 不属于题目身份；课包对知识点的覆盖必须经 `question_kp_links` 单独校验。这些课包禁止由 AI 生成，且必须通过 schema 校验与题目引用校验后才进入 `ready`。每个种子课包必须至少包含一道允许清单内的客观题，否则完成它产不出 graded 答案、计不进 WVLL。课包生成（draft → ready 的自动备课）不在本阶段范围内。

#### 场景:种子课包为 ready 且题目引用可解析
- **当** 加载种子课包
- **那么** 每个课包的 `status` 必须为 `ready`，且其引用的题目必须能按 `course+src+questionId` 解析到已导入的 `questions`

#### 场景:种子课包含客观题以产出 WVLL
- **当** demo 学习者完成一节种子课包
- **那么** 该课包必须至少含一道客观题、完成时产出 ≥1 graded 答案，从而可计入 WVLL

#### 场景:引用无法解析的课包不得为 ready
- **当** 某种子课包的题目引用无法解析到已导入题目
- **那么** 系统禁止将其写为 `ready`，必须跳过或置 `quarantine` 并记录原因

#### 场景:不在本阶段生成课包
- **当** 需要新的教学内容
- **那么** 系统禁止在本阶段自动生成课包，必须依赖手工种子课包（生成留待 Phase 2）

### 需求:基于导入题库的练习筛选
系统必须支持基于已导入题库，按课程、知识点（经 `question_kp_links`）、题型、错题和考频筛选练习题。课包外的独立练习若产生作答，必须开 lesson session 并经 `session_events` → applier 路径处理，与课堂同一确定性路径，禁止旁路直接改学习状态。

#### 场景:按知识点筛选练习
- **当** 学习者针对某知识点练习
- **那么** 系统必须仅返回经 `question_kp_links` 关联到该知识点的题目

#### 场景:按错题与考频筛选
- **当** 学习者请求复习薄弱点
- **那么** 系统必须能优先返回来自 `mistakes` 的相关题目，并可按导入的考频信息排序

#### 场景:独立练习作答走事件路径
- **当** 学习者在课包外的练习中提交作答
- **那么** 系统必须开 session 并持久化 `student_answered` 事件，由 applier 确定性更新状态，禁止直接写 `learner_kp_states`/`mistakes`/`review_items`

### 需求:Admin 课包检视与人工确认
系统必须提供最小 admin 视图，列出课包及其状态、绑定知识点和步骤数，并提供人工确认题目、答案、知识点映射、错题状态和复习完成的路径。对错题/复习的人工确认 = 在对应 `origin=system` 行（`mistakes` 为该每事件行、`review_items` 为该每 KP 终态行）写 `admin_confirmed_at`，禁止触碰 `origin=imported` 行。确认必须对今日列表有功能性效果且保抗遗忘：错题确认后离开活跃列表（`admin_confirmed_at IS NULL` 为活跃）；复习确认后在本周期离开待复习列表（待复习 = `due_date ≤ today` 且 (`admin_confirmed_at IS NULL` 或 `admin_confirmed_at < last_applied_at`)）。applier 重折叠只覆盖派生字段（含 `last_applied_at`）、从不写 `admin_confirmed_at`。

#### 场景:查看课包列表
- **当** admin 打开课包列表
- **那么** 系统必须展示每个课包的 `status`、绑定知识点和步骤数

#### 场景:人工确认题目与答案
- **当** admin 确认某题目及其答案或知识点映射
- **那么** 系统必须将该确认以追加方式持久化到独立审计表 `admin_confirmations`（按 `confirm#<entityType>:<entityId>` 派生 id 幂等 upsert，以引用方式记录被确认实体），且禁止覆盖或修改原始导入来源数据（`questions`/`question_solutions`/`question_kp_links`）

#### 场景:人工确认错题或复习离开今日列表
- **当** admin 确认某错题已处理或某复习项已完成
- **那么** 系统必须在对应 `origin=system` 行写 `admin_confirmed_at`（禁止触碰 `origin=imported` 行），且该错题/复习项必须本周期离开今日列表

#### 场景:确认后答错仍重新浮现
- **当** 某 KP 的复习已被 admin 确认、之后该 KP 又有答错事件
- **那么** applier 重折叠必须把 `due_date` 拉近、`last_applied_at` 前移到确认时间之后，使 `admin_confirmed_at < last_applied_at` → 该复习项重新到期（抗遗忘）；错题侧则由新的每事件行重新浮现

