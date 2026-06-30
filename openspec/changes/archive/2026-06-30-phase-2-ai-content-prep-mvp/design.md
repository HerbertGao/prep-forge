## 上下文

Phase 1 已在真实 ai-teacher 导入数据上跑通确定性学习闭环（事件 → 纯 fold → applier 幂等投影写回，LLM 不碰学习状态）。`ready` 课包是 `seed-packets.ts` 手工种的 3 个。Phase 2（ROADMAP §7）要把**已确认的**导入数据 AI 加工为课包，并把备课/校验移出课堂实时路径。

仓库首个 Python 服务、首次真实 LLM 调用、首次 AI 生成内容、**首次把 `origin=ai_generated` 内容写进 `lesson_steps`**。既有可复用纪律：

- **Zod = 单一事实来源 + parity**（`schema.parity.test.ts` table⊇Zod、pgEnum 值集相等、必填→notNull；只加 Drizzle 列蒙混 CI、pgEnum 加值不进 Zod→红）。
- **派生 id + `ON CONFLICT` + `pg_advisory_xact_lock`**（seed-packets、applier、admin_confirmations）。
- `origin` 含 `ai_generated`；`lesson_packet_status` 含 `draft/ready/consumed/quarantine`（**本变更加 `validating`，须进 Zod `LessonPacketStatus.options`**）；`lesson_steps` 无 origin/status 列。
- `admin_confirmations.entityType ∈ {question, answer, kp_link}`（confirm-actions.ts 硬类型，**无 kp**；entity_id：question→`questions.id`、answer→`question_solutions.id`、kp_link→`question_kp_links.id`）。
- **渲染器实况（决定 XSS 威胁模型）**：`Classroom.tsx:166`/`StepContent.tsx:67` 把 `{step.mdx}`/`prompt` 作 **React 文本子节点、自动转义**（无 HTML sink）；全仓唯一 `dangerouslySetInnerHTML` 在 `MathBlock.tsx:46`、喂 KaTeX 渲染的 `step.math`（`katex` `trust:false`+`throwOnError:true`）。
- `verify-packets:47-57` = 「客观题须有 kp_links」；`OBJECTIVE_QUESTION_TYPES`@`questions.ts:78`。

`prep_jobs`/`model_calls`/`quality_gate_results` 表均新建。

## 目标 / 非目标

**目标：** 薄主干端到端——admin 选**已确认** KP → BFF 独占 `prep_jobs` 生命周期 → worker 生成 draft（写 `status='validating'`）→ BFF 三道确定性硬门 → `draft`｜`quarantine` → 人工逐包 `draft→ready` → 进 Phase-1 课堂闭环。

**非目标（薄主干）：** 变式题/错因/复习建议/题库重解析；provenance role/context 分级 + daily_log/kp 来源；**输出 mdx 净化器**（mdx 是自动转义文本、无 sink，净化反误杀合法内容——见 D5；真 sink 在 math 路径由门3 兜）；按窗口护栏主闸 + ¥预算 + OpenRouter；`/v1/math/render` + Python→Node KaTeX 桥；quarantine 的 regenerate 出口（Phase 4）；worker 拥有学习状态、反写 ai-teacher、LLM 自动 ready。

## 决策

### D1 — TS↔Python 契约：Zod=SoT → JSON Schema → Pydantic + CI diff
Zod 作 SoT，`z.toJSONSchema()` 导出 `contracts/*.json`，Python 锁定版本 `datamodel-code-generator` 生成 Pydantic；两侧 CI「重生成 + `git diff --exit-code`」。FastAPI 用 Pydantic 校验入参、BFF 用 Zod parse worker 返回。
- **transport 信封**（`PrepGenerateResult` 单态、端点 req/resp，带 `schemaVersion`+常量 `tenantId`）**不进 PAIRS**。**DB-row 契约**（`ModelCall`→model_calls、`QualityGateResult`→quality_gate_results、`PrepJobRecord`→prep_jobs，无 transport 字段）进 `PAIRS`，列含全部 Zod 字段（camelCase 字段名对齐，如 `latencyMs`）。
- 扩展 `ModelCall`：补 `prepJobId`(nullable FK)、`costBasis`(**text**，metered/subscription_amortized)、`promptVersion`、`requestHash`。
- `LessonPacketStatus` Zod 加 `validating`。`QualityGateResult` 保持三 bool（`schemaPassed/mathRenderPassed/questionRefsPassed`）对齐三道门——**注**：薄主干 `mathRenderPassed` 语义 = 「无禁止公式」（Phase 2.x 上 KaTeX 桥后才是「渲染成功」）；第 4 个净化布尔不加（净化门已删，见 D5）。

### D2 — DB 硬墙：双触发器（INSERT/UPDATE 查 NEW、UPDATE 加 OLD、父包 repoint 双查）+ 最小权限 + append-only
`prep_worker` 角色（幂等 `DO`-block；密码 secret；回滚 `REVOKE`/`DROP ROLE`）。
- **写授权**：`lesson_packets` INS/UPD；`lesson_steps` INS/UPD/DEL；`model_calls` **仅 INSERT**（UPDATE/DELETE 都不授）。**不授 prep_jobs 写**。
- **读授权**：`SELECT` 仅 `questions/question_options/question_solutions/question_kp_links/knowledge_points` + 自有表。**不授 admin_confirmations SELECT**（确认门 BFF 执行）。不授 daily_logs/mistakes/learner_*/session_events/source_blocks/imported_entities。
- **触发器（`session_user='prep_worker'`，防 SET ROLE 旁路）**：
  1. `lesson_packets` `BEFORE INSERT OR UPDATE`：INSERT **与** UPDATE 都要求 `NEW.origin='ai_generated' AND NEW.status='validating'`（NEW 查封自我提升 `SET status='ready'/'draft'`）；UPDATE **额外**要求 `OLD.origin='ai_generated' AND OLD.status='validating'`（封劫持既有 system 行）。
  2. `lesson_steps` `BEFORE INSERT OR UPDATE OR DELETE`，**父行 NOT FOUND 必须 RAISE**：INSERT 查 `NEW.lesson_packet_id` 父包、DELETE 查 `OLD.lesson_packet_id` 父包、**UPDATE 须同时查 `OLD` 与 `NEW` 两个父包**均为 `ai_generated+validating`——否则 worker 可 `UPDATE lesson_steps SET lesson_packet_id='<我的 validating 包>' WHERE id='<system ready 包的 step>'`（NEW 父=自己→放行）从线上 system 包**偷走/删步**。
- DDL 由 Drizzle 独占。残留（runtime-only）：worker asyncpg 列名手抄无静态 SoT，靠 8.4 e2e 三路打满每列兜。

### D3 — Job 模型：BFF 独占 prep_jobs，worker 只产物，门输入统一 DB 重建
同步 HTTP。`prep_jobs.status`（`prep_job_status` `{pending,running,validating,done,failed}`，不含 ready）**全程由 BFF 写**：
1. admin → BFF 去重 INSERT：`INSERT … ON CONFLICT (活跃 job 部分唯一索引) DO NOTHING RETURNING id`；**冲突 0 行返回时 `SELECT id WHERE kp_code=… AND prompt_version=… AND status IN ('pending','running','validating')` 兜底**取既有 jobId（`DO NOTHING` 不 RETURNING 冲突行）。
2. BFF 原子认领 `UPDATE … SET status='running' WHERE id=$1 AND status='pending' RETURNING`（无返回即拒）→ `POST /v1/prep/generate {jobId, kpCode}`。
3. worker 写 `lesson_packets(validating)`+`lesson_steps`+`model_calls`（不碰 prep_jobs），返回。
4. BFF 置 `running→validating`，**从持久化的 `lesson_packets`+`lesson_steps` 重建 LessonPacket** 跑门，一个 BFF 事务写 `quality_gate_results`+翻 `lesson_packets`(draft/quarantine)+翻 `prep_jobs`(done/failed)。
- **门输入统一从 DB 重建（正常路与孤儿路同源）**：正常路也从 worker 刚 commit 的库行重建喂门（**不**喂 HTTP 响应对象）→ 只剩一条装配路，孤儿路退化为「重跑同管线」，消除「响应对象 vs DB 重建对象不等价 → 同包终态随响应是否丢失而变」的不确定性。**门1（Schema 门）= 对重建出的 LessonPacket 做 `LessonPacket.parse`（Zod），两路都跑、parse 失败→quarantine，`schemaPassed` 反映它**（孤儿路不再 schema 盲、`schemaPassed` 不谎报）。worker HTTP 响应的 Pydantic/Zod parse 是**独立的 transport 存活检查**（正常路才有），孤儿路允许缺席、**不**令 `schemaPassed` 失真。
- **TOCTOU 关窗**：滞后 worker 可在 BFF 读包过门后、翻终态前 overwrite 包。BFF 门事务**取同一 `pg_advisory_xact_lock(hashtext(jobId))`**（与 D4 worker 产物事务同锁）+ 翻转 `UPDATE … WHERE status='validating'`，关掉「塞未过门内容」窗口。
- **孤儿恢复（owner=BFF，按 jobId 对账）**：孤儿可停 **`running`**（worker 已 commit 包但响应丢失——最高频）**或 `validating`**。BFF 可重入「重新校验」（app 角色）：有持久化 validating 包则重建喂门推向终态；无则重调 worker（**计入 per-job cap**，见 D4）或置 failed。
- 超时天花板：browser→Next→worker→`claude -p` 30–90s，枚举抬高每跳超时。

### D4 — 幂等：advisory lock + 产物覆盖（含删旧 step）+ 成本追加 + 活跃 job 去重 + 独立重试计数
- worker 产物事务**持 `pg_advisory_xact_lock(hashtext(jobId))`**（超时重调可与慢调用并发，串行化防交错损坏）；jobId 派生 id `ON CONFLICT DO UPDATE` + **先按 `lessonPacketId` 删不在本次集合内的旧 step**。
- 重试 = BFF 在 worker 失败/超时对同 jobId 重调（含孤儿重校验的重调）。`model_calls` 每 attempt 一行。
- **per-job cap 守所有 worker 调用口**（初始 claim + 孤儿重调）：因 gateway commit-后-才-返回，超时时 model_call 行可能尚未落（LLM 未返回），按 model_calls 计数会低估 → 计数器**必须持久化在 `prep_jobs.attempt_count`**（孤儿「重新校验」是独立 BFF 请求，内存计数会被 BFF 重启/重复点按钮重置 → 超时无界），BFF **每次调 worker 前** `UPDATE prep_jobs SET attempt_count=attempt_count+1 WHERE id=$1 RETURNING attempt_count`，≥ cap 即置 failed、不调 worker。**注**：可强制的是「调用次数上限跨请求（attempt_count）+ 单 attempt token 上限（gateway 内存计）」；**跨重试累计 token 上限不可达**（worker 无 prep_jobs 读权、model_calls 超时低估），D8 措辞照此收敛。
- **活跃 job 去重 = 部分唯一索引** `(kp_code,prompt_version) WHERE status IN ('pending','running','validating')`；`idempotency_key` 非唯一审计列（避开随机 nonce 去重失效 / 无 nonce 永久锁死 两难）。

### D5 — 校验门：三道确定性硬门，确认绑学习者实际解析的内容
worker 写 `validating` 草稿后 BFF 从 DB 重建喂门（复用抽取的 `checkPacketRefs(db,packet)`，注：`verify-packets:47-57` 只覆盖 kp_links，答案 key 检查为净新增），输出 `QualityGateResult` 落 `quality_gate_results`，一个 BFF 事务翻 status：
1. **Schema 门**：worker 出口 Pydantic、BFF 入口 Zod。
2. **Reference 门 + 确认绑定**：每个引用解析到真实 `questions`；practice 步含 ≥1 客观题且该题有可解析答案 key（option.isCorrect 或 solution）+ `question_kp_links`。**确认绑定到学习者实际解析的内容，不靠 worker 自写的 generationSources（仅审计）**：对**每个实际引用的 `step.questionId`**——
   - **题轴**：`admin_confirmations(entity_type='question', entity_id=questionId)` 有行。
   - **答案轴（须与 grader 一致）**：客观题判分键由 `grader.ts:57-72` 的 `correctLabelSet` 决定——导入数据**每个 option 都带 isCorrect**（`questionBank.ts:144`），故 grader **恒走 option.isCorrect 路**（即便 solution 行也存在；仅全 isCorrect=null 才回落 solution）。门**复用 `correctLabelSet`** 推实际判分键来源。因 option.isCorrect 与 solution.answer **同源自 import 的 `rq.answer`**，门对 option-graded 题**显式断言该 import 不变式**（解析的 solution.answer 字母集 == option.isCorrect 集）**且要求该 solution 已确认** `admin_confirmations(answer, solutionId)`——既确认学习者实际判分键的代理、又把「未声明的 import 不变式」变成门内显式断言（Phase 2.x option 键与 solution 解耦时不静默失效）。**不取 generationSources.sourceId**。注：原「有 solution 行 ⇒ 确认 solution」分支与 grader 真实条件相反，已对齐。
   - **KP 轴**：对该题的 `question_kp_links` 行查 `admin_confirmations(entity_type='kp_link', entity_id=linkId)`（§7「已确认」含 kp 映射）。
   `sourceType→entity_type`：question→question、question_solution→answer（仅 audit 对照）。
3. **Math 门**：薄主干无 KaTeX 桥——step **键控 `step.math != null`（或 `type='math_block'`）即 quarantine**（键控 step.math 字段、**不**扫 mdx/prompt 文本里的 `$...$` 样 token，否则 false-quarantine 含数学样文本的合法讲解）；无 math 字段则通过。**此门兼任 math sink 的 XSS 门**：唯一原始 HTML 注入点是 `MathBlock` 的 `dangerouslySetInnerHTML(KaTeX(step.math))`，AI 的 `math` 被本门 quarantine → 永不渲染。**前瞻**：Phase 2.x 放开本门收 AI 公式时，XSS 安全墙必须留 math 路径——`mathRender.ts` 现仅显式设 `throwOnError:true`、`trust`/`strict` **走 KaTeX 默认**（默认 trust=false），届时须**显式置** `trust:false`+`strict`+禁 `\html/\href`（别把「今天靠默认」误记成「已硬化」）；**不能**靠 mdx 净化（mdx 是 React 自动转义文本、非 sink）。
- 任一硬门失败 → `quarantine`+`issues[]`；全过 → `draft`。**只产 draft/quarantine、永不自动 ready**。
- **不建输出净化门**：`mdx`/`prompt` 经 `Classroom.tsx:166`/`StepContent.tsx:67` 自动转义、无 HTML sink；加「含 `<script>` 即 quarantine」反会 false-quarantine 含 `<script>`/`{…}` 样 token 的合法讲解（OS/代码类 KP）。XSS 由门3（math sink）+ 渲染器自动转义双兜底；前瞻防御（若 Phase 2.x 改真 MDX 编译）随那个变更再加。

### D6 — ModelGateway：专用连接记账 + Claude CLI no-tools 默认拒绝 + preflight 硬前置
- **专用连接记账**：gateway 从池取独立连接写 `model_calls` 独立 commit、commit 后才返回；成败都落行（只 INSERT）；写失败响亮报错；`error_message` **结构化白名单为唯一落库路径**（status/error_code 枚举，剥 Authorization/key/共享密钥/订阅 token/argv/env）。保留 `request_hash` 非原始 prompt。
- **Claude CLI 双重注入面**：①`subprocess` argv `shell=False`+固定 argv+prompt 走 stdin；②`claude -p` agentic 模式——**默认拒绝白名单**（`--tools ""` 空-allowlist / permission-mode 全拒；**不用黑名单**，黑名单漏 Read 可读 `/proc/self/environ` 偷 DSN 密码+共享密钥）+ 专用低权用户 + 凭据隔离目录。
- **preflight 硬前置**：`claude -p`（json 或 stream-json 任一）出 token usage；**皆失败→本变更阻塞、重定范围纳入最小 OpenRouter 路径**。实现首步跑 spike + 锁 CLI 版本 + 定义 timeout/kill/未登录/缺 binary。

### D7 — 范围薄主干 A + 首个生成目标
单 KP 的 draft 课包，引用既有**已确认**导入客观题。**demo KP 须为非公式纯概念学科**（如操作系统 13180——数学 00023 必含 LaTeX、门3 全 quarantine、到不了 happy path）；e2e happy 路用录制/stub 的模型响应保确定（真 LLM 非确定 + 门3 会 flaky）。其余生成类型 + provenance 分级 + 按窗口闸 + OpenRouter + 数学桥 = Phase 2.x。

### D8 — 成本护栏：薄主干 = per-job 硬上限（独立 BFF 计数器）+ 活跃 job 去重
薄主干无自动化触发，失控只能是单 job 重试循环 → **per-job 调用/token 硬上限**（守所有 worker 调用口，超时由 D4 独立 BFF 计数器兜，超限→ModelGateway abort→BFF 置 failed）+ 活跃 job 部分唯一索引去重。按窗口主闸 + ¥预算 + OpenRouter 推迟 Phase 2.x。§11 指标从 `model_calls` 按 `prepJobId` 聚合。

### D9 — provenance：薄主干只记结构化来源（无 kp/role）
草稿行 `origin='ai_generated'`+`contentHash`。`GenerationSource` = `{sourceType ∈ {question, question_solution}, sourceId, modelCallIds, promptVersion}`——**删 `kp`**（理由是 **scope**：薄主干 worker 仅从题干/官方解生成，KP 作来源随 Phase 2.x 授读权限再上；**与确认门无关**——门已改为只绑实际解析的 questionId/solution/kp_link、从不读 generationSources.sourceType。注：admin_confirmations **有** `kp_link` 类型，此处删的 `kp` 指 knowledge_point 实体本身无确认类型）。无 role/context/daily_log/superRefine。§7「绑定来源」由 sourceType/sourceId 满足；「已确认」由 D5 Reference 门**绑实际解析的 questionId/solution/kp_link** 强制（generationSources 仅审计、不作确认依据）。
- **Phase 2.x 前瞻**：`z.toJSONSchema()` 静默丢 superRefine——届时 role⇒结构化 规则须 BFF 门强制。
- jsonb `generationSources` 列写/读端按契约 parse（运行时守护、不进 LessonPacket parity）。

### D10 — worker 信任边界
worker 仅绑 `127.0.0.1`/私网；`hmac.compare_digest` 常量时间比较校验共享密钥（不进日志）；FastAPI `debug=False`、禁 `/docs`、关 traceback。**worker 不读不写 prep_jobs、不校验 job 状态**（唯一鉴权=共享密钥，jobId 权威=BFF）。残留（accepted）：持密钥者可用任意 jobId 驱动生成（成本/DoS），产物=孤儿 validating、BFF 不认领则永不上线。**admin BFF 入口（generate 花钱 + draft→ready 发布）本阶段无用户鉴权（Phase 4）**——与 worker 同一私网约束：Phase 4 auth 前 admin 入口与 worker 都勿暴露到不可信网络。

### D11 — draft→ready 权威：BFF 逐包写
BFF（app 角色）单事务：**先** `UPDATE lesson_packets SET status='ready' WHERE id = :lessonPacketId AND origin='ai_generated' AND status='draft' RETURNING id`——**`id=` 谓词必需**（否则一次确认批量上线所有 draft，违反 §7「无人工审核批量发布」）；**RETURNING 命中 0 行（已 ready/id 错）则回滚、不写 confirmation**（免孤儿审计行）；命中则写一行 `admin_confirmations`(entityType=`lesson_packet`, entityId=该包)。`entityType='lesson_packet'` 是 admin_confirmations 第 4 个值——**须直写、不可复用 `confirmContent()`**（其 question/answer/kp_link 三分支存在性校验会拒 lesson_packet）。worker 被 D2 触发器挡死、无法置 ready。已知语义重载（确认伴随状态翻转）记为已知。

### D12 — 学习者可见性：列表 allowlist、单包加载器 denylist
- **内容列表查询**（dashboard 可学列表 `loadReadyPackets`）：allowlist `status='ready'`（已是）。
- **单包加载器 `loadPacket`（packets.ts:131）**：现为 denylist 仅拒 draft/quarantine、**会泄漏 `validating`**。修复 = denylist **加 `validating`**（保留 `ready`+`consumed`——`consumed` 是 Phase-1 真实可达态，learn/page.tsx:34 复看、admin/page.tsx:203 载入；**不可改单值 allowlist `ready`**，否则回归 consumed）。
- **判分/事件 server actions**（学习者推进自身状态的口，须挡 draft/validating 包）：`resolveStepPayload`（actions.ts:126，**既有** innerJoin lessonPackets）加 `status IN ('ready','consumed')`；`submitAnswer`（actions.ts:269，**当前不 join lessonPackets**——按 questionId 直接判分）须**净新增**一次按 client 传入 `lessonPacketId` 的状态查询并校验 `IN ('ready','consumed')`（在 `persistAndApply` 之前）；`recordEvent` 的 start/complete 子类同理校验。**已知残留（accepted）**：门绑 client 声称的 packet、与 questionId 实际归属解耦（一题可被多包引用），且 `practice` 页本就不按包状态门控地暴露整库练习 → 「draft 包污染」威胁本被开放练习稀释、submitAnswer 不回内容、completePacket 已 gate ready，残留低。

## 风险 / 权衡
- 多 SoT 漂移：DDL↔asyncpg（runtime-only，8.4 打满每列）、validating 双侧加、transport vs DB-row parity。
- 跨服务一致性：门输入统一 DB 重建（D3，消等价性不确定）；BFF 门事务与 worker 产物事务同 advisory lock（TOCTOU + 并发重调）。
- **XSS**：真 sink = math 路径（KaTeX `dangerouslySetInnerHTML`），薄主干由门3 quarantine 兜 + mdx 自动转义；Phase 2.x 放开门3 须把安全墙留 math 路径（D5）。
- 硬墙：双触发器（lesson_packets NEW+OLD、lesson_steps 父包 OLD+NEW repoint 双查、NOT FOUND RAISE）+ append-only + 最小权限；负测试覆盖全 deny-list + 自提升/劫持/repoint/改账本被拒。
- **残留（accepted）**：lesson_packets 无 prep_jobs FK（持密钥写无主 validating 包，BFF 不认领则永不上线，Phase 4 前私网可接受）；admin_confirmations 语义重载；泄密钥跨-KP 成本-DoS。
- 前瞻矛盾（§7 全范围 vs deny-list PII 墙）：此墙是薄主干属性，Phase 2.x PII 生成需另设 PII 安全路径（本地模型/确定性抽取/脱敏），非给 worker 授 PII SELECT。
- Claude CLI 依赖：preflight 硬前置，皆失败则阻塞。

## 迁移计划
1. schemas：扩展 `ModelCall`(text cost_basis)、新增 `PrepJobRecord`/`PrepGenerateResult`/`GenerationSource`(无 kp)、`LessonPacketStatus` 加 `validating`；导出 `contracts/*.json`；`PAIRS` 补 DB-row 契约。
2. Drizzle（先建表）：`prep_jobs`(枚举+活跃 job 部分唯一索引，idempotency_key 非唯一，**`attempt_count integer NOT NULL DEFAULT 0`**)、`model_calls`(numeric+prep_job_id FK+索引+text cost_basis)、`quality_gate_results`；`lesson_packets` 加 `validating`+`generationSources` jsonb。
3. Drizzle（后建角色）：幂等 `prep_worker` + GRANT（lesson_steps DEL、model_calls 仅 INSERT、不授 prep_jobs/admin_confirmations）+ `lesson_packets`(NEW+OLD)/`lesson_steps`(父包 OLD+NEW+NOT FOUND RAISE) 双触发器。
4. `services/ai-worker`（FastAPI debug=False + asyncpg prep_worker + Pydantic + ModelGateway：专用连接、argv/stdin、no-tools 白名单、preflight；只写 包/steps/model_calls + 产物 advisory lock）。
5. BFF：去重 INSERT(+SELECT 兜底) + 原子认领 + 调 worker + 三道门（从 DB 重建 + 抽取 checkPacketRefs + 确认绑实际 questionId/solution/kp_link）+ 同 advisory lock 翻 lesson_packets+prep_jobs + 可重入重新校验（含 admin UI 触发入口）+ 逐包 draft→ready（id= + rowcount 检查）；**修 packets.ts:131 加 validating denylist + server actions 加 status 门**。
6. CI：Python lane + 契约双侧 diff(锁版本) + 负权限测试 + 真执行 e2e(三路覆盖每列 + 确认 A 后 B 仍 draft + 非公式 demo KP + stub 模型)。
- **回滚**：全程附加、不改 learner 写路径；停 admin 入口 + 不部署 worker 即回 Phase 1；`REVOKE`/`DROP ROLE`。

## 待解决问题
- per-job 护栏占位数字（实测重定）。
- preflight spike 结论（不能稳定出 token 则阻塞重定范围）——实现首步跑。
- 薄主干首个 KP 的**已确认**前置：确认目标 KP 的题目（entityType=question）、官方解（entityType=answer）、kp_link（entityType=kp_link）；demo 先确认一个**非公式** KP（如 OS 13180）的这组实体。
