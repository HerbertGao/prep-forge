# ai-content-prep 规范

## 目的
待定 - 由归档变更 phase-2-ai-content-prep-mvp 创建。归档后请更新目的。
## 需求
### 需求:Admin 从已确认导入数据触发草包生成
系统**必须**允许 admin 选定知识点触发：BFF 创建 `prep_jobs`，worker 生成 `origin='ai_generated'`、`status='validating'` 草稿。practice 步引用**必须**是真实 `questions` 表已导入的题，**且每个被引用的题目（entityType=question）、其答案来源（solution→entityType=answer）、其知识点链接（entityType=kp_link）必须已经过 `admin_confirmations` 确认**。worker **禁止**虚构题目或写学习状态表。

#### 场景:触发生成产出可解析的已确认草稿
- **当** admin 对一个已确认的知识点点击「生成草包」
- **那么** BFF 创建 `prep_jobs`，worker 生成 `validating` 草稿，其引用的每个 `questionId` 都能解析且其题/答案/kp_link 都有 `admin_confirmations` 行

#### 场景:引用未确认题被门拒绝
- **当** 草稿 practice 步引用一个真实但答案/题/kp_link 未确认的题
- **那么** BFF Reference 门拒绝、包置 `quarantine`（确认绑学习者实际解析的内容，不靠 worker 自报的 generationSources）

### 需求:prep_jobs 生命周期由 BFF 独占且可追踪
`prep_jobs.status` 取自 `prep_job_status` `{pending, running, validating, done, failed}`（不含 ready），**全程由 BFF 写、worker 禁止写/读 prep_jobs**。BFF **必须**去重 INSERT（`ON CONFLICT (活跃 job 部分唯一索引) DO NOTHING RETURNING id`；**冲突 0 行返回时 `SELECT` 兜底取既有 jobId**），调 worker 前原子认领（`UPDATE … SET status='running' WHERE id=$1 AND status='pending' RETURNING`），校验后于一个 BFF 事务翻终态。孤儿可停 **`running`** 或 **`validating`**；BFF **必须**提供**可重入「重新校验」**（按 jobId 对账，有持久化 validating 包则从行重建喂门，无则重调/置 failed），且 admin UI **必须**对停在 running/validating 的 job 暴露重校验入口。

#### 场景:同步返回终态并留审计行
- **当** 一次 generate 请求完成
- **那么** HTTP 响应返回终态，`prep_jobs` 留可按 jobId 查询的审计行

#### 场景:running 孤儿可被重入校验收敛
- **当** worker 已 commit validating 包但响应丢失、job 停在 `running`
- **那么** admin 经 UI 入口对该 jobId 触发「重新校验」，BFF 从持久化行重建喂门、推向终态

### 需求:每次真实模型调用用专用连接独立记账
`ModelGateway` **必须**从池取独立连接写 `model_calls`（含 `prepJobId`/`costBasis`/结构化脱敏 error），**commit 后才返回**。失败也落行。业务回滚**禁止**丢账（独立连接）。`model_calls` 对 worker **append-only（只 INSERT，UPDATE 与 DELETE 均不授）**。`error_message` 以结构化白名单为唯一落库路径，剥除 Authorization/key/共享密钥/订阅 token/argv/env。

#### 场景:外层业务回滚不丢成本行
- **当** 调用成功落 `model_calls` 后外层业务事务回滚
- **那么** 该行仍存在

#### 场景:订阅调用成本语义诚实
- **当** Claude CLI 订阅 adapter 调用
- **那么** `estimated_cost` 记 CLI 返回的 `total_cost_usd`（订阅下为 API-等价的摊销成本，非 0）且 `costBasis='subscription_amortized'`，token/延迟取 CLI 的 `usage`/`duration_ms`

### 需求:草稿经三道确定性硬门分流，确认绑学习者实际解析的内容
worker 写 `validating` 草稿后 **BFF 必须**从持久化的 `lesson_packets`+`lesson_steps` 重建 LessonPacket（正常路与孤儿路同源），跑三道**硬门**（复用抽取的 `checkPacketRefs`），输出 `QualityGateResult` 落 `quality_gate_results`，在一个 BFF 事务（持 `pg_advisory_xact_lock(hashtext(jobId))`）翻 `lesson_packets`+`prep_jobs`：
- **Schema 门**：对**重建出的 LessonPacket** 做 `LessonPacket.parse`（Zod），两路同源、parse 失败→quarantine、`schemaPassed` 反映之（孤儿路不再 schema 盲）；transport 响应 parse 是独立的存活检查、不令 `schemaPassed` 失真；
- **Reference 门 + 确认绑定**：每个引用可解析；practice 步含 ≥1 客观题且该题有可解析答案 key + `question_kp_links`；**对每个实际引用的 `step.questionId`**：题轴 `admin_confirmations(question, questionId)`、答案轴**须与 grader 的 `correctLabelSet` 一致**（导入题恒走 option.isCorrect 判分；门断言 import 不变式「解析的 solution.answer 字母集 == option.isCorrect 集」且该 solution 已确认 `admin_confirmations(answer, solutionId)`）、KP 轴 `admin_confirmations(kp_link, linkId)`——**均不取 worker 自写的 generationSources.sourceId**（仅审计）；
- **Math 门**：薄主干无 KaTeX 桥，step **键控 `step.math != null` 即 quarantine**（键控 step.math 字段、**不**扫 mdx/prompt 文本，否则 false-quarantine 含数学样 token 的合法讲解；此门兼任 math 路径的 XSS 门——唯一 raw-HTML sink 是 KaTeX `dangerouslySetInnerHTML`，AI 公式被本门挡）；无 math 字段则通过。
任一硬门失败 → `quarantine`+`issues[]`；全过 → `draft`（不是 ready）。**不设 mdx 净化门**：mdx/prompt 经渲染器自动转义、无 HTML sink，加净化反 false-quarantine 含 `<script>`/`{…}` 样 token 的合法讲解。

#### 场景:缺确认/缺答案 key/缺 kp_links/含公式进 quarantine
- **当** 引用题的题/答案/kp_link 任一未确认，或缺答案 key，或缺 `question_kp_links`，或 step 含 LaTeX
- **那么** 对应硬门失败、包置 `quarantine`

#### 场景:全部通过进 draft
- **当** 三道硬门通过
- **那么** BFF 写包 `status='draft'`

### 需求:AI 草包默认 draft，人工逐包确认才 ready
校验管线**禁止**自动置 ready。`draft → ready` **必须**由 BFF（app 角色）单事务：先 `UPDATE lesson_packets SET status='ready' WHERE id = :lessonPacketId AND origin='ai_generated' AND status='draft' RETURNING id`（**`id=` 谓词必需**，确认一个包禁止牵连上线其他 draft；**RETURNING 0 行则回滚、不写 confirmation**），命中则写 `admin_confirmations`(entityType=`lesson_packet`)（**直写、不复用 confirmContent()**）。

#### 场景:逐包确认不牵连其他 draft
- **当** admin 确认草包 A（库中另有 draft 包 B）
- **那么** A 翻 `ready`，**B 仍为 `draft`**

#### 场景:校验通过不等于上线
- **当** 一个草稿通过全部硬门
- **那么** 停在 `draft`，学习者列表查询（allowlist ready）不含它

### 需求:学习者可见性按状态门控
内容列表查询**必须** allowlist `status='ready'`。单包加载器（`packets.ts` `loadPacket`）**必须** denylist 拒 `draft/quarantine/validating`（**保留 `ready`+`consumed`**——consumed 是已落地可达态；**不得**改单值 allowlist `ready` 否则回归 consumed）。判分/事件 server actions **必须**校验包 `status IN ('ready','consumed')`，防学习者对 draft/validating 包推进自身状态：`resolveStepPayload`（既有 lessonPackets join）加该过滤；`submitAnswer`（当前不 join、按 questionId 直接判分）**须净新增**一次按 client `lessonPacketId` 的状态查询（`persistAndApply` 前）；`recordEvent` 的 start/complete 同理。门绑 client 声称的 packet（与题归属解耦）为已知残留。

#### 场景:validating/draft 包不被学习者加载或推进
- **当** 学习者尝试加载或对一个 `validating`/`draft` 包的 step 调判分/事件 action
- **那么** 加载器返回 notFound、action 拒绝（status 门）；而 `consumed` 包仍可加载复看

### 需求:AI 生成内容绑定结构化来源
每条 AI 内容**必须**记录来源，符合 `GenerationSource` Zod 契约：`sourceType ∈ {question, question_solution}`（**无 kp**）、`sourceId`、`modelCallIds`、`promptVersion`。生成行**必须** `origin='ai_generated'` + `contentHash`。`generationSources` 仅作审计，**确认依据取自门对实际引用的解析**（不取本字段）。

#### 场景:来源记结构化对象
- **当** 生成器引用真实题干或官方解
- **那么** 记 `sourceType ∈ {question, question_solution}` + `sourceId`

### 需求:worker 重试幂等（advisory lock）、活跃 job 去重、每调用记账
worker 产物**必须**持 `pg_advisory_xact_lock(hashtext(jobId))` + jobId 派生 id `ON CONFLICT DO UPDATE` + **先按 `lessonPacketId` 删不在本次集合内的旧 step**。`model_calls` 每调用一行。**per-job 调用次数硬上限守所有 worker 调用口**（初始 claim + 孤儿重调），计数**必须持久化在 `prep_jobs.attempt_count`**（内存计数会被 BFF 重启/重复重校验重置）、BFF 每次调 worker 前原子 `attempt_count+1`，超限→不调 worker、置 failed；token 上限只能单 attempt（gateway 内存计），**跨重试累计 token 不可强制**（model_calls 超时低估、worker 无 prep_jobs 读权）。部分唯一索引 `(kp_code,prompt_version) WHERE status IN ('pending','running','validating')` 保证每 KP+promptVersion 同时一个活跃 job。

#### 场景:并发重调不交错损坏
- **当** 慢调用未结束时 BFF 又重调同 jobId
- **那么** advisory lock 串行化二者，产物不被并发交错破坏

#### 场景:双击只产一个活跃 job
- **当** admin 在一个 job 仍活跃时再次对同 KP 触发
- **那么** 部分唯一索引令第二次 `DO NOTHING`，不产生第二个活跃 job

### 需求:worker 不得越权写学习状态、上线、改写/偷换步骤、改账本
`prep_worker`：`SELECT` 仅公共题库 + 自有表（**不授 admin_confirmations/PII**）；`model_calls` **仅 INSERT**。两个 `session_user` 触发器：`lesson_packets`（INSERT **与** UPDATE 都查 `NEW.origin='ai_generated' AND NEW.status='validating'`，UPDATE 加 OLD 同值）；`lesson_steps`（INS 查 NEW 父、DEL 查 OLD 父、**UPDATE 同时查 OLD 与 NEW 两个父包**均 `ai_generated+validating`，**父行 NOT FOUND 必须 RAISE**）。

#### 场景:自我提升或绕门被拒
- **当** 以 `prep_worker` 对自己的 validating 行 `SET status='ready'` 或 `SET status='draft'`
- **那么** 触发器拒绝（UPDATE 查 NEW.status='validating'）

#### 场景:劫持既有行、偷换/删 system 步骤、改账本被拒
- **当** 以 `prep_worker` ①`SET origin/status` 改 `origin='system'` 行 ②改写/删 `system ready` 包的 step ③`UPDATE lesson_steps SET lesson_packet_id='<自有 validating 包>' WHERE id='<system 包的 step>'`（repoint 偷步）④`UPDATE`/`DELETE` `model_calls`
- **那么** 分别被 OLD 守卫 / lesson_steps 父包 OLD 守卫 / 缺授权拒绝

#### 场景:读 PII/确认表被拒
- **当** 以 `prep_worker` `SELECT daily_logs` 或 `SELECT admin_confirmations`
- **那么** 被拒；`SELECT questions` 允许

### 需求:TS 与 Python 契约不漂移，worker 仅凭密钥鉴权
契约以 Zod 为 SoT，`z.toJSONSchema()` 导出，Python 锁定版本生成 Pydantic；CI 两侧「重生成 + diff」。transport 信封**不进** PAIRS；DB-row 契约进且列含全部 Zod 字段。`LessonPacketStatus` Zod 与 pgEnum 同步含 `validating`。`OBJECTIVE_QUESTION_TYPES` 不得在 Python 手抄。worker **必须**只绑 `127.0.0.1`/私网、常量时间比较校验共享密钥；**不校验 job 状态**（无 prep_jobs 读权限）。

#### 场景:漂移被 CI 捕获
- **当** 改 Zod 未重生成
- **那么** CI diff 失败

#### 场景:无密钥请求被拒
- **当** 请求未携带正确共享密钥
- **那么** worker 拒绝

### 需求:模型成本与失败可查且受 per-job 护栏约束
系统**必须**能从 `model_calls` 按 `prepJobId` 查每 job 成本/token/失败率。薄主干护栏 = **per-job 调用次数硬上限**（`prep_jobs.attempt_count` 持久化跨请求兜超时）+ 单 attempt token 上限 + 活跃 job 部分唯一索引去重。按窗口主闸 + ¥预算推迟 Phase 2.x。

#### 场景:单 job 超硬上限被终止
- **当** job 调用次数或 token 超 per-job 上限
- **那么** ModelGateway abort、BFF 置 `failed`

