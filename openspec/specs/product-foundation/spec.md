# product-foundation 规范

## 目的
待定 - 由归档变更 bootstrap-phase-0-foundation 创建。归档后请更新目的。
## 需求
### 需求:Monorepo 初始化
系统必须提供可本地运行的 TypeScript monorepo 基础结构，包含 Web 应用、共享 schemas、数据库包和课堂运行时包的目录边界。

#### 场景:安装依赖
- **当** 开发者按 README 执行依赖安装命令
- **那么** 包管理器必须能解析 workspace 并安装所有 Phase 0 依赖

#### 场景:运行基础检查
- **当** 开发者运行项目定义的 lint、typecheck 或 test 命令
- **那么** 命令必须覆盖新增 workspace 包并返回明确结果

### 需求:Web Shell
系统必须提供 Next.js Web shell，并默认显示学习工作台而不是营销页。

#### 场景:启动开发服务器
- **当** 开发者启动 Web 开发服务器并打开首页
- **那么** 首页必须显示基于 seed 数据的学习工作台入口

#### 场景:无认证访问
- **当** 开发者在 Phase 0 打开本地 Web 应用
- **那么** 系统必须允许访问 demo 学习空间，禁止要求登录或订阅

### 需求:共享 Schema
系统必须在共享 schema 包中定义 Phase 0 需要的运行时校验和类型。

#### 场景:校验导入记录
- **当** 导入器产生 import run、source document、source block、import report 或 import error 数据
- **那么** 数据必须通过共享 schema 校验后才能被 seed 或 UI 使用

#### 场景:校验学习对象
- **当** Web 页面读取课程、考试、知识点、题目、课包、个人学习状态（错题、复习项、知识点状态）或 session event 数据
- **那么** 数据必须符合共享 schema 定义

### 需求:数据库基础
系统必须提供最小 PostgreSQL 数据模型和 migration 路径，用于存储导入来源、课程、知识点、题库、课包、session event 以及个人学习状态（learner KP 状态、错题、复习项、学习计划、学习日志），每个领域实体都带稳定 ID。

#### 场景:运行 migration
- **当** 开发者配置 PostgreSQL 连接并运行 migration
- **那么** 数据库必须创建 Phase 0 所需表结构

#### 场景:写入 seed 数据
- **当** 导入结果被发布为 demo seed
- **那么** 系统必须能将结构化课程、知识点、题目摘要和学习状态摘要写入 PostgreSQL（fixture 仅用于 UI 渲染和测试，不能替代 PostgreSQL seed/import 验收；仅 session events 允许 local 或 DB 存储）

### 需求:数据来源区分
系统必须为每条领域记录标记数据来源类型（人工导入、系统生成、AI 生成），并能在 UI/admin 中区分展示。

#### 场景:标记导入来源
- **当** 导入器发布一条 seed 记录
- **那么** 该记录必须带 `origin` 标记（首版为人工导入或系统生成；Phase 0 没有 AI 生成数据）

#### 场景:区分示例课包来源
- **当** 系统展示并非来自 `ai-teacher` 导入的示例课包（课包属于 Phase 2 产物，首版由系统/fixture 提供）
- **那么** 该课包必须标记为系统/fixture 来源，不得冒充人工导入的真实数据

### 需求:本地开发文档
系统必须提供本地运行说明，覆盖依赖安装、数据库准备、导入 seed、启动 Web 和运行检查。

#### 场景:新开发者启动项目
- **当** 新开发者阅读 README 或开发文档
- **那么** 文档必须说明如何从空仓库启动 Phase 0 Web 应用

