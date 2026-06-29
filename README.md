# prep-forge

prep-forge 是一个 Web 优先、面向考试的 AI 学习系统初始化仓库。

产品基于现有 `ai-teacher` 工作流，核心学习闭环是：

```text
考试计划 -> 考纲 -> 知识点 -> 题库 -> 课包
-> AI 课堂 -> 批改 -> 错题 -> 间隔复习 -> 进度更新 -> 计划重排
```

这个项目不是通用聊天机器人。第一个商业切片面向成人和自学考试用户，从 `ai-teacher` 已有 2026 年 10 月自考备考空间开始。

首版初始化数据来自 GitHub `HerbertGao/ai-teacher` 的只读快照，覆盖 2026 年 10 月自考备考空间：高等数学工本、离散数学、操作系统、计算机系统原理，以及历史已通过课程。Markdown/YAML 是导入源，不是商业版长期业务存储。

## 当前状态

当前仓库已落地 Phase 0A / Phase 0 的最小闭环：pnpm workspace（`apps/web` + `packages/schemas|db|lesson-runtime` + `packages/legacy-import`）、共享 Zod schema、Drizzle/PostgreSQL 数据模型与 migration、只读 `ai-teacher` legacy import 管线（来源追踪 / staging / quarantine / 导入报告 / 自然键幂等）、真实 seed 驱动的 dashboard / 学科页 / 题库摘要 / 课包查看器 / MathBlock fallback / 课堂骨架与 local session events、以及 admin 导入报告页。本地开发与验收说明见下文「本地开发（Phase 0）」。

最新架构结论：在 Web 骨架前先做 Phase 0A，即 `ai-teacher` legacy import 的数据盘点、只读导入、来源追踪、staging/quarantine 和导入报告。RAG 后置到 Phase 3，不承担首版数据初始化。

权威文件：

- `PRODUCT.md`：产品命题、架构、阶段规划和工程规则。
- `ARCHITECTURE.md`：架构推荐、边界、事件模型、AI/RAG 与质量门禁。
- `RODEMAP.md`：分期开发路线图、验收门槛和显式延期项。
- `openspec/config.yaml`：面向 AI coding agent 的紧凑 OpenSpec 上下文和工件规则。
- `CLAUDE.md`：Claude Code 入口。

## 产品方向

系统需要支持：

- 考纲优先的学习计划。
- 知识点状态追踪。
- 结构化题库。
- 异步课包准备。
- 交互式 AI 课堂。
- 由 session events 驱动的确定性进度更新。
- 错题本和间隔复习流程。
- 漏学后的弹性计划重排。
- 对 LaTeX 友好的 Web 数学渲染和 fallback。
- AI 生成内容的 admin 检查、校验和 quarantine。
- 从第一次真实 LLM 集成开始记录模型调用和成本。

## 初始技术方向

规划中的技术栈是混合模式：

- TypeScript 负责产品运行时：Next.js App Router、学生课堂、仪表盘、管理后台、产品 API/BFF、streaming UI、课包渲染和课堂状态机。
- Python 负责 AI、数据和离线任务：FastAPI worker 端点、资料摄取、RAG、embeddings、数学资源生成、agent 工作流、质量门禁和批量批改。
- PostgreSQL 作为规范领域数据库，MVP 阶段可以使用 pgvector 做检索。

RAG 用于解释和证据检索，不能替代 PostgreSQL 中的规范学习模型。

## 计划中的 Monorepo 结构

```text
apps/
  web/                         # Next.js 产品应用
services/
  ai-worker/                   # Python FastAPI / agent worker
packages/
  db/                          # schema、migrations、生成的 client
  schemas/                     # Zod / JSON Schema / 生成的 Pydantic models
  lesson-runtime/              # 课堂状态机
  ui/                          # 共享 React 组件
  config/                      # 共享配置
python_packages/
  ai_teacher_agents/
  ai_teacher_ingestion/
  ai_teacher_math/
docs/
infra/
openspec/
PRODUCT.md
```

## 第一实现阶段

Phase 0A / Phase 0 要先建立朴素、类型明确、可观测的基础：

- 从 `ai-teacher` 只读导入真实 seed 数据。
- 保留导入来源、raw block、content hash 和异常数据列表。
- 初始化 monorepo。
- 创建 `apps/web`，使用 Next.js 和 TypeScript。
- 定义数据库和共享 schema packages。
- 添加 lesson packets、questions、session events、grading results 的 Zod schemas。
- 构建带真实导入数据的 demo dashboard。
- 构建学科/知识点页面和课包查看页面。
- 构建基础课堂骨架。
- 添加 `MathBlock` fallback 渲染。
- 记录 local/demo session events。

Phase 0A / Phase 0 不做 auth、Stripe、生产计费、真实 LLM 调用、RAG、Redis、Temporal、双向同步 `ai-teacher` 或复杂服务编排。

## 本地开发（Phase 0）

monorepo 使用 pnpm workspace。当前结构：

```text
apps/web/                 # Next.js App Router + TypeScript + Tailwind
packages/schemas/         # @prep-forge/schemas — Zod schema 事实来源（Group B 填充）
packages/db/              # @prep-forge/db — Drizzle + PostgreSQL（Group C 填充）
packages/lesson-runtime/  # @prep-forge/lesson-runtime — 课堂状态机（后续填充）
```

> Phase 0 暂不单独拆 `packages/config` / `packages/ui`，由根配置和 `apps/web` 内联承载。

### 前置

- Node >= 22。
- pnpm 10.28.2（推荐 `corepack enable` 后由 `packageManager` 字段自动锁定版本）。
- Docker（用于本地 PostgreSQL）。

### 1. 安装依赖

```bash
pnpm install
```

会解析并安装所有 workspace 包（`apps/*`、`packages/*`）。

### 2. 配置数据库

PostgreSQL 是 Phase 0 的规范事实来源。本地用 Docker 启动一个 Postgres（`infra/docker-compose.yml`，Postgres 16），并配置连接串：

```bash
docker compose -f infra/docker-compose.yml up -d   # 启动本地 Postgres
cp .env.example .env                                # DATABASE_URL 已匹配上面的服务
# 若本机 5432 已被占用，改 compose 的 host 端口（如 55432:5432）并同步 .env 的 DATABASE_URL

# 可选：使用 Neon/Supabase/任意 Postgres 时，改 .env 里的 DATABASE_URL 即可
export $(grep -v '^#' .env | xargs)                 # 让 shell 读到 DATABASE_URL

pnpm db:generate   # 由 packages/db 的 Drizzle schema 生成 migration SQL（离线，无需 DB）
pnpm db:migrate    # 把 migration 应用到 DATABASE_URL 指向的 Postgres
```

`packages/db`（`@prep-forge/db`）的 Drizzle 表与 `@prep-forge/schemas`（Zod，唯一事实来源）保持一致，由 parity 测试 `pnpm --filter @prep-forge/db test` 防漂移。

最小 migration 验证（确认 Phase 0 表已建好）：

```bash
docker compose -f infra/docker-compose.yml exec postgres \
  psql -U prepforge -d prepforge -c "\dt"   # 应列出 import_runs、courses、session_events 等 24 张表
```

导入结果先写入 staging（`imported_entities`），生成报告后用 `pnpm db:seed` 显式发布为 demo seed；`import_errors` / quarantine 行不发布。

### 3. 运行 legacy import 并发布 seed

首版 seed 数据来自 `HerbertGao/ai-teacher` 只读快照（本地 clone 或 fixture）。导入器只读源、保留来源追踪，先 dry-run 看报告，再正式导入并发布到 PostgreSQL：

```bash
# dry-run：只扫描/解析/产报告，不写库（报告 JSON 到 stdout，日志到 stderr）
pnpm import:legacy -- --source <ai-teacher 路径> --dry-run

# 正式导入：写 staging(imported_entities) 并发布到领域表（需先 db:migrate）
pnpm import:legacy -- --source <ai-teacher 路径>
# 等价：tsx scripts/import_legacy_ai_teacher.ts --source <path> [--dry-run]

# 如只 stage 未发布，可单独显式发布已确认的 staging：
pnpm db:seed
```

报告含 scanned / parsed / created / updated / skipped / quarantined / warnings；无法解析或悬挂的块进 `import_errors` / quarantine，不静默丢弃，也不发布。导入按稳定自然键幂等：同一快照重复导入不会重复创建实体，内容变化判为 update。

### 4. 启动 Web

```bash
pnpm dev   # 默认 http://localhost:3000，首屏为学习工作台（无需登录）
```

### 5. 运行检查

```bash
pnpm typecheck   # 覆盖全部 workspace 包
pnpm lint
pnpm test
pnpm build       # 构建 apps/web
```

> 说明：`db:*`、`import:legacy` 与各包 `test` / `typecheck` / `build` 均已可真实运行。`lint` 暂为占位命令（Phase 0 以 strict `typecheck` + 测试 + `build` 作为门禁）。

### 6. 验收检查（Phase 0A / Phase 0）

```bash
pnpm -r test        # schemas + db parity + legacy-import(含 DB 幂等) + MathBlock 聚焦测试
pnpm -r typecheck   # 全 workspace
pnpm build          # apps/web 生产构建（无 DB 时靠 fixture 回退）

# 真实数据端到端：起 Postgres → pnpm db:migrate → pnpm import:legacy -- --source <path> → 打开 / 看 dashboard
```

通过标准：开发者可本地运行；demo learner 在 dashboard / 学科页 / 题库摘要 / 课包查看器看到来自 `ai-teacher` 的真实数据（可追溯到 import run / source block，如四科 00023/02324/13180/13015 含真实状态在考/重考、马原/习概/史纲已通过）；MathBlock 渲染或优雅 fallback 且移动端不溢出；课堂骨架记录 local/demo session events 且不更新正式掌握度；导入幂等、异常块保留可检查；admin 导入报告区分人工导入/系统生成/AI 生成；无 auth/计费/真实 LLM/RAG/Redis/Temporal/webhook/`ai-teacher` 反写。

## OpenSpec 工作流

影响产品行为、架构、领域模型或实现阶段的改动，应使用 OpenSpec。

提出或实现变更前：

1. 阅读 `PRODUCT.md`。
2. 阅读 `openspec/config.yaml`。
3. 保持当前阶段范围收敛。
4. 先定义 schemas 和确定性状态迁移，再做 UI 或 AI 自动化。
5. AI 生成的教育内容必须包含校验和 quarantine 行为。

## 文档参考

本文档参考了 HerbertGao 相关项目的 README 组织方式：

- `gaokao_bot` 和 `gaokao_bot_mini_app`：简洁介绍、功能、技术栈和开发说明。
- `libpku`、`REKCARC-TSC-UHT`、`go-fundamental-programming`：学习资料组织方式和实用入口。

本项目的产品和工程约束以 `PRODUCT.md` 为准。
