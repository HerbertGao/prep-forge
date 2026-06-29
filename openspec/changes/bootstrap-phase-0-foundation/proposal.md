## 为什么

prep-forge 目前只有产品和架构文档，还没有可实现的 Phase 0 变更边界。首版又必须从 `HerbertGao/ai-teacher` 的真实 Markdown/YAML 数据开始，而不能用手写 mock 验收产品基础。

这个变更把 Phase 0A 和 Phase 0 的最小闭环合并成一个可 review 的启动变更：先建立只读 legacy import 契约和来源追踪，再创建类型明确的 Web/DB/schema 基础，并用导入数据驱动第一个 dashboard、学科页和课包查看体验。

## 变更内容

- 新增 `ai-teacher` 只读 legacy import 基础：
  - 支持本地快照或 GitHub 快照作为导入源。
  - 定义 import run、source document、source block、imported entity、import error / quarantine 的结构化模型。
  - 解析首版需要的学习者画像、考试计划、dashboard、study plan、review queue、daily log、session archive、phase0 tasks、subject syllabus/progress/mistakes/key_points、question bank 统计和章节题库（含高数 00023、离散 02324、操作系统 13180、计算机系统原理 13015 四门本考期科目，以及马原、习概、史纲三门已通过历史课程）。
  - 保留 source repo/ref、source path、heading path、line range、raw block、content hash 和导入批次。
  - 区分公共内容库和个人学习状态，并为课程/知识点/题目/错题/复习项/学习日志生成稳定自然键。
  - 生成 dry-run/import report；导入结果先进入 staging，经报告/quarantine 后再发布为 demo seed，并保证重复导入按稳定自然键幂等。
- 新增 Phase 0 产品基础：
  - 初始化 monorepo、Next.js Web shell、共享 schema package 和最小数据库 schema/migrations。
  - 定义 Phase 0 需要的核心 schemas：课程/考试/知识点、题目、课包、session event、导入记录、导入报告。
  - 保持 PostgreSQL 为规范事实来源；legacy Markdown/YAML 只作为导入源。
- 新增真实 seed 学习体验：
  - 用导入数据展示 dashboard、2026 年 10 月自考考期、四科进度、复习/错题摘要。
  - 展示学科/知识点列表和题库摘要。
  - 展示一个示例课包查看器，包含 MathBlock fallback。
  - 提供基础课堂骨架并记录 local/demo session events。
  - 提供最小 admin 导入报告和异常数据列表视图。
- 明确不做：
  - 不做真实 LLM 调用。
  - 不做 RAG、embedding 或完整教材切片。
  - 不做 auth、billing、生产部署、Redis、Temporal。
  - 不做 GitHub webhook 自动同步。
  - 不反写或双向同步 `ai-teacher`。
  - 不让 LLM 自动修复历史 Markdown。
  - 不做多用户导入。

## 功能 (Capabilities)

### 新增功能

- `legacy-import-foundation`: 只读导入 `ai-teacher` Markdown/YAML 快照，保留来源追踪、导入报告、staging/quarantine 和幂等语义。
- `product-foundation`: 建立 Phase 0 monorepo、Web shell、共享 schemas、数据库模型和本地开发基础。
- `learning-seed-experience`: 用真实导入数据展示首版 dashboard、学科/知识点、课包查看器、课堂骨架和 local/demo session events。

### 修改功能

无。当前项目没有既有规范能力。

## 影响

- 代码结构：新增 `apps/web`、`packages/schemas`、`packages/db`、`packages/lesson-runtime`、`scripts` 和必要开发配置。Phase 0 暂不单独拆分 `packages/config` 和 `packages/ui`，由根配置与 `apps/web` 内联承载，待出现第二个消费者再拆分。
- 数据模型：新增导入来源追踪、课程/考试/知识点、题库、学习状态摘要、课包和 session event 的最小 schema。
- OpenSpec：新增三个能力规格，约束 Phase 0A/0 的可观察行为和非目标。
- 运行方式：项目从纯文档仓库变为可本地运行的 Phase 0 Web 应用。
- 外部系统：只读读取 `ai-teacher` 快照；不写入、不同步、不创建 webhook。
