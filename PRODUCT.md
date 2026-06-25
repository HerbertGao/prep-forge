# PRODUCT.md — AI 教师商业化 Web 产品

> Codex / Claude Code 的项目初始化文档。  
> 在出现更细分的规格文档之前，本文件是产品与工程的事实来源。

---

## 0. 使命

基于现有 `ai-teacher` 工作流，构建一个商业化、Web 优先的 AI 学习产品。

它不是通用聊天机器人，而是一个**面向考试的 AI 学习引擎**：

```text
考试计划 -> 考纲 -> 知识点 -> 题库 -> 课包 -> AI 课堂
-> 批改 -> 错题 -> 间隔复习 -> 进度更新 -> 计划重排
```

系统需要保留当前个人 Markdown 项目里最有价值的思路：

- 先按考纲组织，而不是先按教材组织。
- 由历年真题和题库驱动学习。
- 使用苏格拉底式教学，而不是直接灌答案。
- 支持课程、练习、复习、模拟考试流程。
- 支持错题本和间隔复习闭环。
- 支持弹性日程：漏学几天不会变成心理债务，计划可以从当前日期重排。
- 低峰期自动备课，白天低成本授课。

商业版必须适合 Web 使用、支持多用户、可观测，并最终具备收费能力。

### 0.1 首版真实数据源

首版初始化数据来自 GitHub `HerbertGao/ai-teacher` 的只读快照，而不是手写 mock。

该仓库已经包含：

- 学习者画像和教学偏好。
- 2026 年 10 月自考考期计划。
- 高等数学工本 `00023`、离散数学 `02324`、操作系统 `13180`、计算机系统原理 `13015` 的考纲、进度和题库。
- 已通过历史课程：马克思主义基本原理、习近平思想概论、中国近现代史纲要。
- 错题、复习队列、每日学习日志、阶段任务清单和题库统计。

规则：

- Markdown/YAML 是导入源，不是商业版长期业务存储。
- Phase 0A 必须先建立只读导入、来源追踪、staging、quarantine 和导入报告。
- 导入不反写 `ai-teacher`，不做双向同步。
- 无法结构化的内容必须保留 raw block 并进入待确认状态，不能静默丢弃。

---

## 1. 产品命题

### 1.1 我们要做什么

为成人和自学考试用户构建一个 Web 应用，能力包括：

1. 理解学习者的考试目标。
2. 制定并重排学习计划。
3. 异步准备高质量课包。
4. 在浏览器里运行交互式 AI 课程。
5. 使用结构化题库和 RAG 支持的知识检索。
6. 批改答案并记录错题。
7. 安排间隔复习。
8. 按知识点追踪掌握度。
9. 提供进度、风险、下一步行动的仪表盘。

### 1.2 第一阶段不做什么

不要一开始就做：

- 覆盖所有主题的通用 AI 家教。
- 纯聊天 UI。
- 完整 LMS 克隆。
- 移动 App。
- 真人教师排课。
- 社交或社区功能。
- 复杂微服务架构。
- 无数据库、只靠 Markdown 的生产系统。

第一个商业切片应该窄、有用、可防守。

推荐第一个目标：

```text
自学考试备考，从 ai-teacher 已有 2026 年 10 月考期真实数据开始。
```

高数学科仍需尽早纳入，因为它会迫使系统正确处理 LaTeX、分步推理、例题、批改和 Web 渲染。但首版验收不只看高数，还要能展示 2026 年 10 月考期四科备考空间。

---

## 2. 技术方向

### 2.1 语言决策

使用混合技术栈：

```text
TypeScript = 产品系统和 Web 运行时
Python     = AI / 数据 / 离线 worker 系统
```

#### TypeScript 负责

- Web 应用。
- 学生课堂。
- 仪表盘。
- 管理后台。
- 产品 API / BFF。
- 登录和计费集成。
- 实时 AI 流式 UI。
- 课包渲染。
- 课堂状态机。

#### Python 负责

- 夜间备课。
- RAG 摄取。
- PDF / DOCX / OCR 处理。
- embedding 任务。
- AI agent 工作流。
- LaTeX / 数学资源生成。
- 质量门禁。
- 批量批改和分析。

### 2.2 初始推荐栈

#### Web / 产品层

- Next.js App Router。
- TypeScript。
- Tailwind CSS。
- shadcn/ui。
- TanStack Query，或在合适场景使用 server actions。
- Zod 做运行时校验。
- Vercel AI SDK，或一个兼容的小型流式抽象，用于 AI 课堂响应。

#### 数据库 / 存储

- PostgreSQL 作为主要事实来源。
- pgvector 用于 MVP 阶段向量检索。
- 只有在确实需要队列、缓存或会话加速时再引入 Redis。
- S3 兼容存储，优先 Cloudflare R2 或 S3，用于 PDF、图片、公式资源和预览图。

#### Python worker

- FastAPI 提供 worker HTTP 端点。
- Pydantic 定义 schema。
- 适合时使用 LangGraph 编排 agent。
- LlamaIndex 可用于 ingestion / RAG 工具，但不能拥有核心业务逻辑。
- Temporal 后续用于持久化长工作流；MVP 可以先从手动任务或简单定时 worker 命令开始。

#### 计费 / 登录

- 早期登录可选 Clerk 或 Supabase Auth。
- 后续商业订阅使用 Stripe Billing。
- 在第一个有用学习闭环跑通前，不实现计费。

#### 可观测性

- 从第一天开始把所有模型调用记录到数据库。
- 添加 Sentry 记录应用错误。
- 后续按需要添加 Langfuse / LangSmith / OpenTelemetry 风格 tracing。

---

## 3. 核心架构

```text
apps/web
  ↓
Product API / BFF
  ↓
PostgreSQL domain database
  ↓                      ↘
Learning state engine      Python AI worker
  ↓                         ↓
Web classroom            Nightly prep / RAG / math rendering
  ↓                         ↓
Session events           Ready lesson packets
  ↓                         ↓
Progress / mistakes / review queue
```

关键规则：

> 结构化学习状态属于 PostgreSQL。RAG 支持解释和证据检索，但不能替代规范领域模型。

---

## 4. 领域原则

### 4.1 知识点状态机

每个学习者在每个知识点上都有独立状态：

```text
unseen -> taught -> practiced -> mastered
```

建议内部枚举：

```ts
type KpState = 'unseen' | 'taught' | 'practiced' | 'mastered'
```

默认迁移规则：

- `unseen` -> `taught`：学习者完成覆盖该知识点的课程步骤。
- `taught` -> `practiced`：学习者至少尝试一道相关题目。
- `practiced` -> `mastered`：相关练习分数达到配置阈值，默认 `0.8`。
- 任何状态都可以创建或更新错题和复习项。

不要让 LLM 直接修改进度。LLM 可以生成结构化事件，确定性代码负责把事件应用到状态。

### 4.2 事件优先的学习记录

每个课堂动作都应该记录为 session event。

示例：

```json
{"type":"lesson_started","packetId":"LP-AM02-03-001"}
{"type":"step_shown","stepId":"diagnostic-001"}
{"type":"student_answered","stepId":"diagnostic-001","answer":"固定 y，只看 x 变化"}
{"type":"graded","questionId":"Q-AM02-031","kpCode":"AM02-03","score":0.8}
{"type":"mistake_created","kpCode":"AM02-03","category":"concept_confusion"}
{"type":"lesson_completed","minutes":47}
```

派生状态包括：

- 进度。
- 仪表盘。
- 错题本。
- 复习队列。
- 学习统计。

### 4.3 弹性日程

漏学的日期不要自动变成堆积债务。

计划器行为：

```text
如果学习者停止学习数天：
  不要把旧课程全部堆到今天。
  从当前日期重排计划。
  保留考试约束。
  必要时先加入轻量复习或诊断，再进入新内容。
```

---

## 5. AI Agent 设计

不要构建一个全能 agent。使用边界清晰的角色。

### 5.1 Planner Agent

负责：

- 选择下一批学习时段。
- 在漏学后重排计划。
- 平衡新课、复习、练习和模拟考试。
- 遵守考试日期、学习者状态和准备度。

输出：

```json
{
  "slots": [
    {
      "subjectCode": "advanced_math",
      "kpCodes": ["AM02-03"],
      "mode": "lesson",
      "estimatedMinutes": 60,
      "reason": "高频知识点，前置路径已满足。"
    }
  ]
}
```

### 5.2 Prep Agent

负责离线备课：

- 生成课包草稿。
- 绑定知识点。
- 选择或引用题目。
- 创建苏格拉底式教学步骤。
- 生成例题讲解。
- 生成批改 rubric。
- 请求数学资源渲染。

该 agent 异步运行，优先在低峰时段执行。

### 5.3 Tutor Agent

负责实时课堂互动：

- 使用选定的 ready 课包。
- 提问并回应学习者答案。
- 除非学习者直接提出旁支问题，否则留在课包范围内。
- 不重新规划课程。
- 不在课堂时间临时发明一整节新课。
- 产出结构化事件。

### 5.4 Grader Agent

负责批改非平凡答案：

- 主观题答案。
- 证明步骤。
- 计算推理。
- 简答评分。
- 错误类别提取。

简单客观题应使用确定性代码批改。

### 5.5 Coach Agent

负责学习支持：

- 检测过载。
- 建议轻量复习。
- 维护学习动量。
- 更新学习者特征。
- 在合适时建议计划重排。

### 5.6 QA Agent

负责质量门禁：

- 课包完整性。
- 知识点对齐。
- 难度和时长合理性。
- 数学渲染通过 / 失败。
- 题目引用有效性。
- 教学质量。
- 安全与幻觉检查。

课包必须通过质量门禁才能进入 ready 队列。

---

## 6. 课包规格

课包是核心商业内容资产。

它不是普通 Markdown 文件，而是可被 Web UI 渲染、可被 Tutor Agent 执行的结构化教学程序。

### 6.1 课包状态

```text
draft -> ready -> consumed
       ↘ quarantine
```

- `draft`：已生成但未批准。
- `ready`：已批准，可用于课堂。
- `consumed`：已被学习者完成。
- `quarantine`：校验失败或收到差评。

### 6.2 最小课包 JSON

```json
{
  "id": "LP-AM02-03-001",
  "version": 1,
  "subjectCode": "advanced_math",
  "title": "偏导数的定义与基本计算",
  "kpCodes": ["AM02-03"],
  "prerequisites": ["AM02-01", "AM02-02"],
  "estimatedMinutes": 60,
  "difficulty": "medium",
  "objectives": [
    "理解偏导数是固定其他变量后的导数",
    "能计算基础二元函数的偏导数",
    "能区分偏导数与普通一元导数"
  ],
  "steps": [
    {
      "id": "diagnostic-001",
      "type": "diagnostic_question",
      "prompt": "如果 z=f(x,y)，只让 x 变化、y 不变，你觉得此时函数像几元函数？"
    },
    {
      "id": "explain-001",
      "type": "explanation",
      "mdx": "固定 y 后，对 x 求导，这就是对 x 的偏导。"
    },
    {
      "id": "math-001",
      "type": "math_block",
      "latex": "\\frac{\\partial z}{\\partial x}=\\lim_{\\Delta x\\to 0}\\frac{f(x+\\Delta x,y)-f(x,y)}{\\Delta x}"
    },
    {
      "id": "practice-001",
      "type": "practice",
      "questionIds": ["Q-AM02-031", "Q-AM02-044"]
    }
  ],
  "rubric": {
    "masteryThreshold": 0.8,
    "kpStateOnComplete": "taught",
    "kpStateOnPracticePass": "mastered"
  },
  "quality": {
    "schemaPassed": true,
    "mathRenderPassed": true,
    "questionRefsPassed": true,
    "score": 0.9
  }
}
```

### 6.3 必需步骤类型

初始步骤类型：

```ts
type LessonStepType =
  | 'diagnostic_question'
  | 'socratic_question'
  | 'explanation'
  | 'math_block'
  | 'worked_example'
  | 'practice'
  | 'hint'
  | 'summary'
  | 'review_prompt'
```

### 6.4 课包校验规则

以下情况课包无效：

- 没有知识点。
- 引用了不存在的知识点。
- 引用了不存在的题目。
- 没有诊断或苏格拉底式步骤。
- 没有练习或复习活动。
- 超过配置的时长上限。
- 包含无法渲染的 LaTeX。
- 跳过声明的前置知识且没有复习。
- 与当前学习者阶段不匹配。

---

## 7. 数学与 LaTeX 渲染

数学支持是一等产品要求。

### 7.1 渲染策略

每个数学表达式存储：

```text
LaTeX source
KaTeX/HTML render when possible
SVG fallback
PNG fallback
Alt text
Render status
```

建议表：

```text
formula_assets
- id
- latex
- display_mode        inline | block
- render_engine       katex | mathjax | matplotlib | other
- render_status       pending | rendered | failed
- html
- svg_url
- png_url
- alt_text
- width
- height
- content_hash
- created_at
```

前端渲染顺序：

```text
1. 如果有预渲染 SVG，优先使用
2. KaTeX 客户端渲染
3. PNG fallback
4. 纯文本 fallback
```

### 7.2 Web MathBlock 组件要求

`MathBlock` 必须：

- 支持 inline 和 block 数学。
- 避免移动端横向撑破页面。
- 支持复制 LaTeX source。
- 使用可访问的 alt text。
- 渲染失败时显示 fallback。
- 后续可用 Playwright screenshot 检查。

---

## 8. RAG 与知识架构

不要把 RAG 当作主要事实来源。

使用四层知识结构。

### 8.0 Legacy 导入层

`ai-teacher` 的 Markdown/YAML 数据先通过确定性导入进入 PostgreSQL staging，再由 admin 确认发布为规范结构数据。

导入层记录：

- source repo/ref。
- 文件路径。
- 标题路径。
- 行号范围。
- raw block。
- content hash。
- 导入批次和错误信息。

Phase 0/1 不使用 LLM 自动修复历史 Markdown。RAG 不承担首版数据初始化职责。

### 8.1 规范结构层

存储在 PostgreSQL：

- 考试轨道。
- 学科。
- 章节。
- 知识点。
- 前置关系。
- 题库。
- 官方答案。
- 学习者进度。
- 错题。
- 复习日程。
- 导入来源追踪和 staging/quarantine 状态。

### 8.2 检索证据层

存储为 chunks + embeddings：

- 教材段落。
- 考试大纲段落。
- 历年真题解析。
- 补充笔记。
- 导入的 Markdown / MDX 内容。

每个 chunk 必须包含 metadata：

```json
{
  "tenantId": "global-or-org-id",
  "courseId": "course-id",
  "subjectCode": "advanced_math",
  "kpCodes": ["AM02-03"],
  "sourceType": "textbook",
  "sourceId": "material-id",
  "page": 123
}
```

### 8.3 学习者记忆层

存储为结构化表，也可选配嵌入摘要：

- 反复错题。
- 答题模式。
- 薄弱概念。
- 偏好的教学方式。
- 中断和重排历史。
- 复习表现。

### 8.4 检索顺序

课堂和备课时按以下顺序使用信息：

```text
1. 当前课包
2. 结构化知识点和题目数据
3. 学习者记忆
4. RAG 证据 chunks
5. 只在 fallback 时使用通用模型知识
```

---

## 9. 初始数据库模型

使用 PostgreSQL migrations。ORM 可以选择 Prisma 或 Drizzle。

初始实体：

```text
users
organizations
enrollments
courses
subjects
chapters
knowledge_points
questions
question_options
question_solutions
question_kp_links
lesson_packets
lesson_steps
formula_assets
study_plans
study_plan_slots
learner_kp_states
study_sessions
session_events
mistakes
review_items
prep_jobs
model_calls
quality_gate_results
material_sources
material_chunks
```

### 9.1 必需模型调用日志

每次 LLM 调用都必须记录：

```text
model_calls
- id
- provider
- model
- task_type
- user_id nullable
- lesson_packet_id nullable
- input_tokens
- output_tokens
- estimated_cost
- latency_ms
- status
- error_message nullable
- created_at
```

商业 AI 产品必须从一开始追踪成本。

---

## 10. Web 应用页面

### 10.1 学生页面

初始页面：

```text
/dashboard
/learn
/learn/[sessionId]
/subjects
/subjects/[subjectCode]
/mistakes
/review
/progress
/settings
```

### 10.2 管理页面

初始页面：

```text
/admin
/admin/courses
/admin/knowledge-points
/admin/questions
/admin/lesson-packets
/admin/prep-jobs
/admin/model-calls
/admin/quality
```

Admin 需要尽早出现，因为 AI 生成的教育内容必须能被检查和隔离。

---

## 11. 课堂 UX

课堂不应只是一个普通聊天窗口。

推荐布局：

```text
┌──────────────────────────────────────────────┐
│ Header: course, lesson title, exam countdown  │
├───────────────────┬──────────────────────────┤
│ Lesson steps       │ Tutor interaction         │
│ - goal             │ - AI prompt               │
│ - diagnosis        │ - learner answer          │
│ - explanation      │ - hints / grading         │
│ - practice         │                            │
├───────────────────┴──────────────────────────┤
│ Answer box / formula viewer / scratch area     │
└──────────────────────────────────────────────┘
```

Tutor Agent 应该按课包步骤推进，并产出 session events。

---

## 12. 夜间备课工作流

长期目标：

```text
Scheduled workflow
  ↓
Select next slots
  ↓
Generate draft lesson packets
  ↓
Attach questions and RAG evidence
  ↓
Render math assets
  ↓
Run schema and quality gates
  ↓
Generate Web preview
  ↓
Publish ready packets
  ↓
Record report and cost
```

MVP 可以先手动执行：

```text
Admin clicks “Generate next lesson packet”
```

然后再自动化。

### 12.1 备课任务状态

```text
pending -> running -> draft_created -> validating -> ready
                                 ↘ failed
                                 ↘ quarantine
```

---

## 13. 建议 monorepo 结构

```text
prep-forge/
├── apps/
│   └── web/                         # Next.js 产品应用
│
├── services/
│   └── ai-worker/                   # Python FastAPI / agent worker
│
├── packages/
│   ├── db/                          # DB schema、migrations、生成的 client
│   ├── schemas/                     # JSON Schema / Zod / 生成的 Pydantic models
│   ├── lesson-runtime/              # TS 课堂状态机
│   ├── ui/                          # 共享 React 组件
│   └── config/                      # 共享配置
│
├── python_packages/
│   ├── ai_teacher_agents/           # Planner / Prep / QA / Grader agents
│   ├── ai_teacher_ingestion/        # 资料摄取和 RAG
│   └── ai_teacher_math/             # LaTeX 渲染和校验
│
├── scripts/
│   ├── import_legacy_ai_teacher.ts  # 导入现有 Markdown 项目数据
│   ├── seed_from_legacy_import.ts
│   └── check_schemas.ts
│
├── docs/
│   ├── architecture.md
│   ├── lesson-packet-spec.md
│   ├── agent-contracts.md
│   └── rag-design.md
│
├── infra/
│   ├── docker-compose.yml
│   └── README.md
│
└── PRODUCT.md
```

---

## 14. 开发阶段

### Phase 0A — ai-teacher 数据盘点与导入契约

目标：把 GitHub `ai-teacher` 只读快照转成可追溯、可重复、可人工确认的首版初始化数据。

任务：

- [ ] 读取 `teacher/`、`materials/` 和紧凑 YAML 题库格式。
- [ ] 建立 import runs、source documents、source blocks、imported entities 和 import errors。
- [ ] 解析 learner profile、exam plan、study plan、dashboard、review queue、daily log、phase0 tasks、subject syllabus/progress/mistakes 和 question bank。
- [ ] 区分公共内容库和个人学习状态。
- [ ] 生成导入报告和 quarantine 列表。
- [ ] 保证重复导入幂等。

验收标准：

- 可以初始化 2026 年 10 月自考考期真实学习空间。
- 能导入高数、离散、操作系统、计算机系统原理和历史已通过课程。
- 无法解析内容被保留并可检查。
- 不反写 `ai-teacher`。

### Phase 0 — Web 骨架和领域模型

目标：创建可运行的 Web shell 和数据模型。

任务：

- [ ] 初始化 monorepo。
- [ ] 创建 `apps/web`，使用 Next.js + TypeScript。
- [ ] 创建 PostgreSQL schema / migrations。
- [ ] 为 Lesson Packet、Question、Session Event、Grading Result 定义 Zod schemas。
- [ ] 用 legacy import seed data 构建 `/dashboard`。
- [ ] 构建 `/subjects/[subjectCode]` 知识点列表。
- [ ] 构建带 `MathBlock` 的课包查看器。
- [ ] 构建基础课堂骨架。
- [ ] 将 session events 写入本地或数据库。
- [ ] 构建最小 admin 导入报告页面。

验收标准：

- 开发者可以在本地运行 Web 应用。
- Demo 学习者可以看到来自 `ai-teacher` 的仪表盘、知识点列表、题库摘要和示例课包。
- 数学公式可以渲染，或优雅 fallback。
- Session events 可以写入。

### Phase 1 — 学习闭环 MVP

目标：一个学习者可以完成一节已准备好的课程。

任务：

- [ ] 实现 lesson session 创建。
- [ ] 实现课堂步骤推进。
- [ ] 实现答案提交。
- [ ] 实现客观题确定性批改。
- [ ] 实现事件应用，更新知识点状态。
- [ ] 实现错题创建。
- [ ] 实现复习项调度。
- [ ] 添加 admin 课包列表。

验收标准：

- 用户可以开始课程、回答练习、完成课程，并看到进度更新。

### Phase 2 — Python worker 和离线备课

目标：在课堂之外生成并校验课包。

任务：

- [ ] 创建 `services/ai-worker`，使用 FastAPI。
- [ ] 添加端点：`POST /prep/generate`。
- [ ] 添加端点：`POST /prep/validate`。
- [ ] 添加端点：`POST /math/render`。
- [ ] 添加 DB 支持的 `prep_jobs` 表。
- [ ] 添加 admin 按钮，请求生成课包。
- [ ] 添加课包校验和 quarantine。

验收标准：

- Admin 可以请求生成课包草稿。
- 有效课包变为 ready。
- 无效课包进入 quarantine，并记录原因。

### Phase 3 — RAG 摄取

目标：加入有证据支撑的课包生成。

任务：

- [ ] 对教材、考纲、历年真题和补充资料做 evidence chunking。
- [ ] 将文档解析成 chunks。
- [ ] 存储带 metadata 的 chunks。
- [ ] 生成 embeddings。
- [ ] 按 subject / KP 检索。
- [ ] 在 model calls 或 agent runs 中记录检索到的 chunks。

验收标准：

- Prep agent 可以为某个知识点检索相关 chunks，并在内部引用来源。

### Phase 4 — 商业 beta

目标：小规模付费 beta。

任务：

- [ ] 添加 auth。
- [ ] 添加 user profiles 和 enrollments。
- [ ] 添加 Stripe subscription gate。
- [ ] 添加模型成本日志仪表盘。
- [ ] 添加用户对课程质量的反馈。
- [ ] 添加夜间定时备课。
- [ ] 添加 admin quarantine 和 regenerate 控制。

验收标准：

- 真实 beta 用户可以订阅、选课、学习已准备课程，并保留进度。

---

## 15. AI 编码 agent 规则

当 Codex / Claude Code 在本项目工作时：

1. 先读 `PRODUCT.md`。
2. 不要构建通用聊天机器人。
3. 不要只用 Markdown 存储商业学习者状态。
4. 不要允许 LLM 在没有结构化事件的情况下直接修改进度表。
5. 优先小而可 review 的提交。
6. 先创建 types / schemas，再实现 UI 流程。
7. TypeScript 和 Python 之间通过显式 schema 或 API 连接，不靠隐含假设。
8. 为状态迁移和 schema 校验添加测试。
9. 添加真实 LLM 调用时，必须记录 model calls 和 costs。
10. 对所有 AI 生成的教育内容，都要包含校验或 quarantine 路径。

---

## 16. 给 Codex / Claude Code 的初始实现提示

创建仓库后，可将以下内容作为第一个工作提示：

```text
你正在 prep-forge 上工作。阅读 PRODUCT.md，只实现 Phase 0A 和 Phase 0 的最小闭环。

目标：
1. 初始化 PRODUCT.md 中描述的 monorepo 结构。
2. 添加只读 ai-teacher legacy import 契约和最小导入 fixture。
3. 在 apps/web 创建 Next.js TypeScript 应用。
4. 在 packages/db 下添加最小 PostgreSQL schema package。
5. 在 packages/schemas 下添加共享 Zod schemas：
   - LessonPacket
   - LessonStep
   - Question
   - SessionEvent
   - GradingResult
6. 构建带 legacy seed 数据的 dashboard 页面。
7. 构建带 MathBlock fallback 渲染的课包查看页面。
8. 构建基础课堂页面，可以展示课程步骤并记录 local session events。
9. 构建最小 admin 导入报告页面。
10. 暂不添加 auth、Stripe、RAG 或真实 LLM 调用。
11. 添加本地开发 README 说明。
12. 保持实现简单且类型明确。

实现后总结：
- 创建了哪些文件
- 如何本地运行
- 满足了哪些 Phase 0 验收标准
- Phase 1 还剩什么
```

---

## 17. 产品质量线

只有系统能稳定回答以下问题时，产品才算成功：

1. 学习者正在准备什么考试？
2. 当前正在学习哪个知识点？
3. 为什么这是下一节最合适的课？
4. 哪些题目能证明掌握度？
5. 学习者错在哪里？
6. 学习者什么时候应该复习？
7. 本次 session 后学习者进度发生了什么变化？
8. AI 互动花了多少钱？
9. Admin 能否检查并隔离糟糕的 AI 生成内容？
10. 漏学几天后，计划能否优雅恢复？

如果一个功能不能帮助回答这些问题，它大概率不属于 MVP。

---

## 18. 最终产品方向

长期产品是：

```text
一个 Web 优先、面向考试的 AI 学习系统，具备异步备课、结构化学习状态、
RAG 支撑的内容 grounding、数学友好渲染、AI 辅助教学、确定性进度更新、
以及商业 SaaS 运营能力。
```

第一版实现应该朴素、类型明确、可观测、有用。

不要追逐魔法。先把能稳定复现魔法的机器造出来。
