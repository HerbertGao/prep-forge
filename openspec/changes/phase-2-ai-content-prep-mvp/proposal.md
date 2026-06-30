## 为什么

Phase 1 已在真实 ai-teacher 导入数据上跑通确定性学习闭环，但 `ready` 课包是手工种的（`seed-packets.ts` 里 3 个）。ROADMAP §7 的目标是把**已确认的**导入数据用 AI 加工成可教学课包，并把备课、数学渲染和质量校验移出课堂实时路径。

这是 prep-forge 的第一个架构拐点——三个「第一次」同时发生：①第一个 Python 服务（`services/ai-worker`，FastAPI）；②第一次真实 LLM 调用（`ModelGateway` + `model_calls` 成本日志）；③第一次 AI 生成教育内容（草稿，质量门控，quarantine 路径）。

本提案**只做薄主干**：用**单一生成类型**（为一个知识点生成一个 draft 课包）把整条管线 + TS↔Python 边界 + 成本日志端到端跑通。难、新、风险高的是 Python 边界 + 真金白银 + AI 安全生命周期，不是生成类型的多样性；其余生成类型是同一管线的 Phase 2.x 增量。§7 退出门槛也只要求这一条。

## 变更内容

- **新增 `services/ai-worker`（FastAPI，仓库首个 Python lane）**：暴露**仅** `POST /v1/prep/generate`。校验跑在 BFF（复用 TS 逻辑，见下）；`/v1/math/render` 推迟到首个含公式产物。
- **新增 `ModelGateway`**（worker 内库模块）：**用连接池里的专用连接独立 commit `model_calls`、commit 后才返回结果**，业务回滚也不丢账（同连接 savepoint 会被外层回滚带走）；`model_calls` 对 worker **append-only（只 INSERT）** 防账本被改写绕护栏。首版 adapter = **Claude CLI 复用订阅**（`subprocess` argv `shell=False` + prompt 走 stdin 防 shell 注入；**默认拒绝白名单 `--tools ""` 空-allowlist 模式**（preflight 锁定 CLI 2.1.x 的真实旗标，而非 `--allowedTools`）锁死工具防 agentic RCE+凭据外泄（黑名单漏 Read 可读 `/proc/self/environ` 偷密码）；`error_message` 结构化白名单脱敏）。**preflight spike** 验 `claude -p`（json/stream-json 任一）能稳定出 token usage，**皆失败则本变更阻塞/重定范围**（不把非目标 OpenRouter 当现成退路）。
- **新增 DB 支持的 `prep_jobs`**（独立 `prep_job_status` 枚举 `pending→running→validating→done/failed`，**不含 ready**；**`prep_jobs.status` 全程由 BFF 写、worker 不碰**，状态机单一权威）：审计 + 状态机，同步 HTTP、无 broker/poller。**活跃 job 去重用部分唯一索引** `(kp_code,prompt_version) WHERE status IN active`（双击/并发同-KP 只产一个活跃 job；终态后可再生成——避开随机 nonce 去重失效 / 无 nonce 永久锁死 quarantine 后无法重生成 的两难）。
- **新增 `model_calls`、`quality_gate_results` 表**，并扩展接线 `ModelCall`（补 prepJobId/costBasis/promptVersion/requestHash）/`QualityGateResult` Zod 契约（含纳入 parity）。
- **新增 admin「生成草包」入口**：选一个**已确认**知识点 → 建 `prep_jobs` → 调 worker → 按 jobId 查 `prep_jobs` 展示终态（draft/quarantine/failed）。
- **新增 BFF 三道确定性硬门**（从持久化行重建喂门、正常路与孤儿路同源；复用**抽取后**的 `verify-packets`/`seed-packets`，不在 Python 重写）：①schema ②引用可解析 + **对每个实际引用的 questionId 逐一查确认**（题轴 `(question,questionId)`、答案轴按真实解析的 solution id 查 `(answer,solutionId)`、KP 轴 `(kp_link,linkId)`——**不取 worker 自写的 generationSources**）+ ≥1 客观题有答案 key + `question_kp_links`（保 WVLL+§7 已确认）③数学（薄主干**含公式即 quarantine**；此门**兼任 math 路径的 XSS 门**——唯一 raw-HTML sink 是 KaTeX `dangerouslySetInnerHTML`）。任一失败 → `quarantine`+原因；全过 → `draft`。**不建 mdx 净化门**：mdx/prompt 经渲染器自动转义、无 sink，净化反 false-quarantine 含 `<script>` 样 token 的合法讲解。worker 写 `validating`，BFF 在一个持 advisory lock 的事务里翻 `lesson_packets`+`prep_jobs` 终态。
- **新增 `draft → ready` 逐包人工确认**：由 BFF（app 角色）单事务写 `admin_confirmations`(entityId=该包) + `UPDATE lesson_packets SET status='ready' WHERE id = :lessonPacketId AND origin='ai_generated' AND status='draft'`。**`id=` 谓词必需**（否则一次确认批量上线所有 draft，违反 §7「无人工审核批量发布」）。**管线永不自动 ready**——worker 被 DB 触发器限死在 `validating`。**学习者可见性门控**：内容列表 allowlist `ready`；单包加载器 `packets.ts:131` denylist **加 `validating`**（保留 ready+consumed，**不**改单值 allowlist 否则回归 consumed）；判分/事件 server actions 加 `status IN ('ready','consumed')`。
- **新增 AI 内容来源绑定（provenance）**：`GenerationSource` Zod 契约（薄主干 `{sourceType ∈ {question, question_solution}, sourceId, modelCallIds, promptVersion}`——**删 `kp`**（scope 理由：薄主干仅从题干/官方解生成，KP 作来源属 Phase 2.x；与确认门无关，门只绑实际解析）。§7「绑定来源」由 sourceType/sourceId 满足；「已确认」由 BFF Reference 门**绑实际引用的 questionId/solution/kp_link**强制。role/context 分级、daily_log、kp 随**授自由文本读 + KP 确认路径的 Phase 2.x 变更**再上。
- **新增 TS↔Python 契约管线**：Zod 作 SoT → `z.toJSONSchema()` 导出 `contracts/*.json` → 锁版本 `datamodel-code-generator` 生成 Pydantic；两侧 CI「重生成 + `git diff`」抓漂移；运行时两端各 `parse`。契约带 `schemaVersion` + 常量 `tenantId`；单态信封（不用泛型 `AgentResult<T>`）。
- **新增 `prep_worker` 最小权限角色 + 双触发器**作硬墙：写集 `lesson_packets` INS/UPD、`lesson_steps` INS/UPD/DEL、`model_calls` **仅 INSERT**（append-only），**不授 prep_jobs 写、不授 admin_confirmations SELECT**；**SELECT 仅公共题库内容**，对 `daily_logs/mistakes/learner_*/source_blocks/imported_entities` **无任何权限**（PII 不喂外部模型做成 DB 硬墙）。两个 `session_user` 触发器：`lesson_packets`（INSERT 与 UPDATE **都查 NEW=ai_generated+validating** 封死自我提升、UPDATE 加 **OLD** 守卫封死劫持既有行）+ `lesson_steps`（join 父包、NOT FOUND RAISE，封死改写/删 system 包步骤——此前完全无保护）。幂等 `DO`-block 建角色使 CI 可跑负权限测试。DDL 仍 Drizzle 独占。
- **新增 worker 信任边界**：worker 仅绑 127.0.0.1/私网、用常量时间比较校验 BFF 共享密钥。**worker 不校验 job 状态**（无 prep_jobs 读权限、BFF 已认领到 running；唯一鉴权=共享密钥，jobId 生命周期权威=BFF）。
- **新增成本护栏**：薄主干 = **per-job 调用/token 硬上限**（超限→job failed）+ 活跃 job 去重；薄主干无自动化触发、跨 job 失控不可达。按窗口主闸 + 并发预留原语 + ¥预算推迟到自动化（Phase 2.x）。数字先占位、实测重定。
- **新增 Python CI lane**：ruff/mypy/pytest + 契约重生成 diff（锁版本）+ `prep_worker` 负权限测试（全 deny-list + 置 ready 被拒 + 读 PII 被拒）+ 在真实迁移库上真执行的 e2e。

## 功能 (Capabilities)

### 新增功能
- `ai-content-prep`: AI 辅助内容加工管线——`services/ai-worker`（FastAPI，仅 generate）、`prep_jobs` 生命周期、`ModelGateway` + `model_calls` 专用连接记账、BFF 三道确定性校验门（确认绑实际引用）→ `draft`/`quarantine`、AI 内容 provenance（结构化来源，进契约）、`draft → ready` BFF 逐包人工确认、TS↔Python Zod→Pydantic 契约与防漂移、`prep_worker` 角色 + 双触发器硬边界、worker 信任边界、per-job 成本护栏。范围限定为单一生成类型（单 KP → 一个引用真实已确认导入客观题的 draft 课包）。

### 修改功能
（无。`draft → ready` 复用 `admin_confirmations` 机制但需求归入新能力；确定性学习闭环 `learning-loop-mvp` 的学习状态写路径不变。）

## 影响

- **新增目录**：`services/ai-worker/`（Python/FastAPI）、`packages/schemas/contracts/*.json`。
- **新增 Drizzle 迁移**：`prep_jobs`（`prep_job_status` 枚举 + 活跃 job 部分唯一索引 `(kp_code,prompt_version) WHERE status IN active` + `attempt_count`（per-job 重试 cap 持久化））、`model_calls`（`numeric(12,6)` 成本、`prep_job_id` FK+索引、对 worker append-only）、`quality_gate_results` 表 + `lesson_packets` 的 `validating` 状态值（**含同步进 Zod `LessonPacketStatus`**）+ `generationSources` jsonb 列；幂等 `prep_worker` 角色 + GRANT + `lesson_packets`/`lesson_steps` 双触发器（建表后）。
- **新增/扩展契约**：`PrepJobRecord`(DB-row)/`PrepGenerateResult`(transport)/`GenerationSource` Zod；扩展 `ModelCall`；`ModelCall`/`QualityGateResult`/`PrepJobRecord` 纳入 parity `PAIRS`（transport 信封不进）。
- **复用既有纪律**：`schema.parity.test.ts`、`seed-packets.ts`（派生 id+`ON CONFLICT`+引用解析+quarantine）、`verify-packets.ts`（≥1 客观题 + kp_links）、`admin_confirmations`、`imported_entities`、`OBJECTIVE_QUESTION_TYPES`（保持 TS 单一 SoT，不跨语言手抄）。
- **CI 加固**：Python lane + 契约 diff（锁版本）+ 负权限测试 + 真执行 e2e。
- **明确不触碰**：learner 状态写路径（确定性闭环不变）；worker 永不拥有学习状态、永不置 ready。
- **非目标**（§7 + 薄主干）：变式题/错因归类/复习建议/题库 Markdown 重解析（Phase 2.x）；**provenance 的 role/context 分级 + daily_log 来源 + superRefine + provenance 门**（薄主干 worker 无自由文本读权限，随授读权限的 Phase 2.x 再上）；**按窗口护栏作主闸 + 并发预留原语**（薄主干 per-job 闸已覆盖，随自动化 Phase 2.x 再上）；**OpenRouter adapter + ¥单价表 + ¥日预算**（推迟到 OpenRouter 落地）；**`/v1/math/render` + Python→Node KaTeX 桥**（推迟到首个含公式产物）；quarantine 的 regenerate 出口（Phase 4）；全自动夜间系统；完整 RAG；无人工审核批量发布；LLM 自动 ready；反写/双向同步 ai-teacher。
