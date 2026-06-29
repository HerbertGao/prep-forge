# legacy-import-foundation 规范

## 目的
待定 - 由归档变更 bootstrap-phase-0-foundation 创建。归档后请更新目的。
## 需求
### 需求:只读导入源
系统必须支持从 `ai-teacher` 的只读快照读取 Phase 0A 所需 Markdown/YAML 数据，并且禁止导入流程反写或修改源仓库。

#### 场景:从本地快照读取
- **当** 操作者提供本地 `ai-teacher` 快照路径并运行导入 dry-run
- **那么** 系统必须扫描受支持的 `teacher/` 和 `materials/` 文件，而不修改源目录中的任何文件

#### 场景:源路径不存在
- **当** 操作者提供不存在或不可读的源路径
- **那么** 系统必须失败并报告源路径错误，禁止创建部分导入结果

#### 场景:源路径结构无效
- **当** 操作者提供的路径存在但结构无效（是文件而非目录、空目录，或 `teacher/` 与 `materials/` 子树都缺失）
- **那么** 系统必须报告清晰的结构错误并失败，禁止创建部分导入结果

#### 场景:仅缺少一个顶层子树
- **当** 路径下只有 `teacher/` 或只有 `materials/` 其中之一
- **那么** 系统必须导入存在的子树、把缺失的子树记为 warning，而不是 hard-fail

### 需求:来源追踪
系统必须为每个可解析或不可解析的数据块保留来源追踪信息，包括 source repo/ref、source path、heading path、line range、raw block、content hash 和 import run。

#### 场景:解析知识点来源
- **当** 导入器从 `teacher/subjects/*/syllabus.md` 解析知识点
- **那么** 每个知识点必须能追溯到对应 source block 和 content hash

#### 场景:保留无法解析内容
- **当** 导入器遇到无法稳定解析的 Markdown 表格或自由文本块
- **那么** 系统必须保留 raw block 并将其记录为 import error 或 quarantine 条目

#### 场景:不支持的文件也要记录
- **当** 扫描目录内存在没有对应 parser 的文件（如 `exam_reference.md`、`practice_*.md`、`keyword_*.md`、`answer_templates.md`、`weakness_checklist.md`、`teacher/system.md`）
- **那么** 系统必须为其生成 source document（status=unsupported）并在导入报告中列出，禁止静默丢弃

### 需求:首版数据覆盖
系统必须覆盖首版真实学习空间所需的核心 `ai-teacher` 文件类型。

#### 场景:导入核心教师文件
- **当** 源快照包含 `teacher/learner_profile.md`、`teacher/exam_plan.md`、`teacher/study_plan.md`、`teacher/dashboard.md`、`teacher/review_queue.md`、`teacher/daily_log.md`、`teacher/session_archive.md` 和 `teacher/phase0_tasks.md`
- **那么** 系统必须为这些文件生成 source documents、source blocks 和结构化候选记录

#### 场景:导入学科文件
- **当** 源快照包含 `teacher/subjects/*/{syllabus,progress,mistakes,key_points}.md`
- **那么** 系统必须解析课程、章节、知识点、进度摘要、错题和关键点候选记录

#### 场景:学科缺少部分文件
- **当** 某学科目录缺少 `{syllabus,progress,mistakes,key_points}` 中的某个文件（真实数据中如 advanced_math 无 key_points.md）
- **那么** 系统必须记录 per-file skipped/warning 并继续导入该学科其余文件，不得整体失败

#### 场景:导入题库文件
- **当** 源快照包含 `materials/*/question_bank/stats.md`、`chapter_*.md` 或紧凑 YAML 题库格式
- **那么** 系统必须解析题库统计、题目、答案、解析和知识点链接候选记录

#### 场景:导入所有学科并标注真实状态
- **当** 源快照包含的学科超出最低覆盖集（高数 00023、离散 02324、操作系统 13180、计算机系统原理 13015 四门在考 + 马原/习概/史纲三门已通过），例如还含第二外语日语 `00840`，且某些课程没有 active syllabus/progress 或处于缺考/重考状态
- **那么** 系统必须为快照中每个学科生成稳定课程记录，并取真实状态（未开始/缺考/重考/在考/已通过）：在考状态来自 `exam_plan.md`；已通过历史课程的 `已通过` 状态可来自 `exam_plan.md`、`learner_profile.md` 或已通过课程清单（任一记录即可），不得因 `exam_plan.md` 未列出而误标为 unmapped；不得跳过、报错或留 undefined 状态

#### 场景:学科目录在 exam_plan 中无对应代码
- **当** 某 `teacher/subjects/<slug>/` 的 slug **既不在** `exam_plan.md` 考试代码表中，**也不属于**已通过课程清单/`learner_profile.md`（陈旧/模板/废弃学科）
- **那么** 系统必须用 slug 生成 provisional course_code、把状态标为 unmapped/未知，并记录 import error/warning，而不是留空 course_code 或 undefined 状态
- **注（状态来源优先级）**：已通过（exam_plan/learner_profile/已通过清单任一）> exam_plan 在考状态（未开始/缺考/重考/在考）> unmapped/未知；同一学科不会同时判为已通过和 unmapped

### 需求:公共内容与个人状态分离
系统必须为每一条导入记录显式标记为公共内容库或个人学习状态，不允许任何已导入记录处于未分类状态；分类按实体而非整文件（混合来源文件如 `exam_plan.md` 同时派生公共的课程/考试轨道实体和个人的考试计划实体）。

#### 场景:题库进入公共内容
- **当** 导入题目、答案、解析、知识点和考频统计
- **那么** 系统必须将它们标记为公共内容库记录

#### 场景:错题进入个人状态
- **当** 导入 learner profile、progress、mistakes、review queue、daily log 或 study plan
- **那么** 系统必须将它们标记为个人学习状态记录

#### 场景:其余文件也必须分类
- **当** 导入 dashboard、exam_plan、phase0_tasks、session_archive、syllabus/章节和 key_points
- **那么** 系统必须按实体分类：dashboard/phase0_tasks/session_archive 及 exam_plan 派生的考试计划实体标记为个人学习状态；exam_plan 派生的课程/考试轨道实体与 syllabus/章节/key_points 标记为公共内容库，不留未分类记录

### 需求:Staging 与显式发布
系统必须先把导入结果写入 staging，经导入报告和 quarantine 审核后再显式发布为 seed，禁止绕过 staging 直接覆盖正式学习状态。

#### 场景:发布是独立步骤
- **当** 导入完成 scan/parse/validate/stage 并生成报告
- **那么** 发布为 demo seed 必须是独立于 staging 的显式步骤；Phase 0 可对已确认或内置 seed 自动发布，但不得在未生成报告的情况下直接写入正式记录

#### 场景:quarantine 不发布
- **当** 某来源块进入 quarantine 或 import error
- **那么** 系统禁止将该块作为已确认 seed 发布，必须保留其原文供人工检查

### 需求:幂等导入
系统必须使用稳定自然键保证同一快照重复导入不会产生重复课程、知识点、题目、错题、复习项或学习日志。稳定自然键不含 content hash：课程使用 `course_code`（由 `exam_plan.md` 考试代码表派生）；source block 使用 `source_path + heading_path + normalized_key`（`normalized_key` = 同一标题下的块序号/行键，避免多行碰撞）；题目优先 `course + src + id`，缺失时退化为 `题干 hash + 章节 + 序号`；知识点使用 `course_code + kp_code`；个人状态实体由所属课程/知识点自然键与来源块稳定身份派生稳定 ID。content hash 仅用于检测某条记录是否变化。

#### 场景:重复导入按自然键去重
- **当** 操作者对已持久化的前一次导入再次导入同一快照，且各实体的稳定自然键不变
- **那么** 导入报告必须将这些记录显示为跳过或未变化，而不是新增重复实体

#### 场景:内容变化判为更新
- **当** 某来源块的 content hash 变化但其稳定自然键不变
- **那么** 导入报告必须将对应实体标记为更新候选（而非删除后新建），并保留新旧差异的可追踪依据

#### 场景:同一文件内多实体
- **当** 单个文件（如 `chapter_*.md`）包含多个题目或知识点
- **那么** 系统必须按各自稳定自然键分别识别和去重，不能仅凭文件级 content hash 判定整文件未变化

### 需求:导入报告
系统必须生成导入报告，展示扫描文件数、解析成功数、quarantine 数、新增/更新/跳过数量和警告。

#### 场景:生成 dry-run 报告
- **当** 操作者运行导入 dry-run
- **那么** 系统必须输出可供 admin 查看或保存的导入报告

#### 场景:发现统计冲突
- **当** `dashboard.md`、`progress.md` 或 `syllabus.md` 中同一课程的知识点总数/完成数不一致，或 `exam_plan.md`、`dashboard.md`、`study_plan.md` 中同一考试的日期冲突
- **那么** 系统必须在导入报告中记录 warning，禁止静默覆盖

#### 场景:无法映射的复习项进入异常
- **当** `review_queue.md` 中的条目无法映射到任何知识点
- **那么** 系统必须将其记录为 import error / quarantine，禁止静默丢弃

#### 场景:错题须关联课程或知识点
- **当** `mistakes.md` 中的错题既无法关联到课程也无法关联到知识点
- **那么** 系统必须将其记录为 import error / quarantine；仅缺题目引用或仅能关联到课程时不算错误，且 `daily_log` 不要求知识点映射（按日期/source block 导入）

