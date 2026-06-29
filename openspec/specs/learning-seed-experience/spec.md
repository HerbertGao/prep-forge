# learning-seed-experience 规范

## 目的
待定 - 由归档变更 bootstrap-phase-0-foundation 创建。归档后请更新目的。
## 需求
### 需求:真实 Seed Dashboard
系统必须使用 legacy import seed 数据展示首版学习工作台，禁止仅使用手写 mock 通过 Phase 0 验收。

#### 场景:展示考试空间
- **当** demo 学习者打开 dashboard
- **那么** 系统必须展示 2026 年 10 月自考考期、目标课程和考试倒计时信息

#### 场景:展示课程进度
- **当** demo 学习者查看 dashboard
- **那么** 系统必须展示高等数学工本 `00023`、离散数学 `02324`、操作系统 `13180` 和计算机系统原理 `13015` 的进度摘要，并按取自 `exam_plan.md` 的真实状态（在考/缺考/重考/已通过等，重考是本考期的一种参考状态）区分展示

#### 场景:展示学习风险
- **当** 导入数据包含复习队列、错题或薄弱点
- **那么** dashboard 必须展示待复习、错题或薄弱点摘要

#### 场景:Dashboard 数据可追溯到导入
- **当** 验证 dashboard 是否满足“非手写 mock”要求
- **那么** dashboard 展示的考期、进度和风险数值必须读自带 `source_block_id` 的**已发布领域记录**（对应 `imported_entities` 中 `status = published` 的行；staged/quarantine/error 不得满足验收），可由数值 → 已发布 imported_entity → source block → content hash 核对；fixture 不能用于 dashboard 验收路径

#### 场景:统计冲突时的展示
- **当** dashboard、progress 或 syllabus 对同一课程的进度数不一致，或多文件考试日期冲突
- **那么** dashboard 必须按权威来源取值（进度数取 progress.md、考试日期取 exam_plan.md）并标注冲突，不静默选择

### 需求:学科和知识点视图
系统必须提供学科/知识点页面，用于查看导入的课程结构、章节、知识点、考频和学习状态。

#### 场景:打开学科页面
- **当** demo 学习者打开某个学科页面
- **那么** 系统必须展示该学科的章节和知识点列表

#### 场景:查看知识点状态
- **当** 导入数据包含知识点进度
- **那么** 知识点列表必须展示基于规范状态机 `unseen | taught | practiced | mastered` 的状态摘要（UI 文案可本地化为未学习/已学习/已练习/已掌握），并定义 progress.md 词汇到该枚举的映射；无法映射的词汇必须落到明确默认值并记 warning（或进入 import_errors），不得静默默认

### 需求:题库摘要
系统必须展示导入题库的摘要信息，包括题目数量、题型分布、来源范围和知识点覆盖。

#### 场景:查看题库摘要
- **当** demo 学习者或 admin 查看学科题库信息
- **那么** 系统必须展示来自 `stats.md` 或导入报告的题库统计；当 `stats.md` 声称的题量与实际解析题量不一致时记 warning，不静默展示陈旧数字

### 需求:课包查看器
系统必须提供一个示例课包查看器，用结构化课包步骤展示教学内容和练习题。

#### 场景:查看示例课包
- **当** demo 学习者打开课包查看页面
- **那么** 系统必须展示课包目标、关联知识点、步骤、题目和答案/解析区域

#### 场景:渲染数学公式
- **当** 课包或题目包含 LaTeX 公式
- **那么** 系统必须尝试渲染公式，并在渲染失败时展示可读 fallback 和可访问 alt text

#### 场景:移动端不溢出
- **当** 在窄视口（移动端宽度）查看含长公式的课包
- **那么** 公式容器必须滚动或换行，不得横向撑破页面（用窄视口截图或聚焦测试验证）

### 需求:课堂骨架和 Local Session Events
系统必须提供基础课堂骨架，并记录 local/demo session events 以验证事件结构。

#### 场景:开始 demo 课堂
- **当** demo 学习者开始示例课包
- **那么** 系统必须记录 `lesson_started` session event（事件类型取自规范集合 `lesson_started`/`step_shown`/`student_answered`/`lesson_completed`）

#### 场景:提交 demo 答案
- **当** demo 学习者在课堂骨架中提交答案
- **那么** 系统必须记录 `student_answered` session event（取自上述规范事件集合），但禁止更新正式掌握度

### 需求:Admin 导入报告视图
系统必须提供最小 admin 视图，用于查看导入报告、warning 和 quarantine 条目。

#### 场景:查看导入报告
- **当** admin 打开导入报告页面
- **那么** 系统必须展示导入批次、扫描文件数、解析成功数、quarantine 数和 warning 摘要

#### 场景:查看异常块
- **当** 导入报告包含无法解析的 source block
- **那么** admin 必须能看到 source path、heading path、raw block 摘要和错误原因

#### 场景:区分数据来源
- **当** admin 查看已发布的 seed 数据
- **那么** 界面必须区分人工导入数据、系统生成数据和 AI 生成数据

