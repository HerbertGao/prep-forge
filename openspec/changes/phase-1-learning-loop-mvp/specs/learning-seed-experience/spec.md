## 修改需求

### 需求:课堂骨架和 Local Session Events
系统必须提供围绕 `ready` 课包步骤推进的课堂，并将 session events 持久化到 PostgreSQL 的 `session_events` 表，作为确定性 event applier 的事实来源。课堂禁止退化为纯聊天框；session events 不再只在本地记录。

#### 场景:开始课堂
- **当** demo 学习者开始一节 `ready` 课包
- **那么** 系统必须创建 lesson session 并将 `lesson_started` 事件持久化到 PostgreSQL（事件类型取自规范集合 `lesson_started`/`step_shown`/`student_answered`/`lesson_completed`）

#### 场景:围绕课包步骤推进
- **当** 学习者在课堂中前进
- **那么** 系统必须按课包 `steps` 顺序展示步骤并为每步持久化 `step_shown` 事件，禁止以自由聊天替代结构化步骤

#### 场景:提交答案并驱动确定性状态更新
- **当** 学习者在课堂中提交答案
- **那么** 系统必须持久化 `student_answered` 事件，并由确定性 event applier（非 LLM）更新 `learner_kp_states`、`mistakes`、`review_items`
