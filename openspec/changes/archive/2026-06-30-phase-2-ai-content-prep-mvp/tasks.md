## 1. 跨语言契约（@prep-forge/schemas，D1）

- [x] 1.1 扩展 `ModelCall` Zod：补 `prepJobId`(nullable FK)、`costBasis`(**text**，metered/subscription_amortized)、`promptVersion`、`requestHash`；`LessonPacketStatus` Zod `options` 加 `validating`。`QualityGateResult` 维持三 bool（schema/mathRender/questionRefs）对齐三道门——注 `mathRenderPassed` 薄主干语义=「无禁止公式」（不加净化布尔，净化门已删）
- [x] 1.2 新增契约：`PrepJobRecord`（DB-row，`prep_job_status` 枚举，无 transport 字段）、`PrepGenerateResult`（单态信封）、`GenerationSource`（`{sourceType ∈ {question, question_solution}, sourceId, modelCallIds, promptVersion}`——无 kp/role/daily_log/superRefine）；端点 req/resp 信封带 `schemaVersion`+常量 `tenantId`
- [x] 1.3 `z.toJSONSchema()` 导出 → 提交 `packages/schemas/contracts/*.json`；加 `pnpm contracts:gen`
- [x] 1.4 `schema.parity.test.ts` 的 `PAIRS` 只补 DB-row 契约（`ModelCall`/`QualityGateResult`/`PrepJobRecord`）；列名与 Zod 字段名对齐（`latencyMs` 非 latency，含 userId/lessonPacketId/inputTokens/outputTokens/createdAt）
- [x] 1.5 CI 加 TS 侧「重生成 + `git diff --exit-code`」漂移关卡

## 2. DB 迁移（Drizzle，先建表）

- [x] 2.1 加 `prep_jobs` 表（`prep_job_status` 枚举、`kp_code`、`prompt_version`、`idempotency_key` **非唯一审计列**、`attempt_count integer NOT NULL DEFAULT 0`、失败原因、`lesson_packet_id`、时间戳）+ **部分唯一索引** `(kp_code, prompt_version) WHERE status IN ('pending','running','validating')`
- [x] 2.2 加 `model_calls` 表（列名对齐 ModelCall Zod 全字段：provider/model/task_type/user_id/lesson_packet_id/input_tokens/output_tokens/`estimated_cost numeric(12,6)`/`latency_ms`/status/截断 error_message/created_at/`prep_job_id` FK+索引/`cost_basis` text/prompt_version/request_hash）
- [x] 2.3 加 `quality_gate_results` 表（列对齐 QualityGateResult Zod 三 bool + passed/issues/score/`lesson_packet_id`/`prep_job_id`，PK=`qg#<jobId>`）
- [x] 2.4 `lesson_packets` 加 `validating` 状态值 + jsonb `generationSources` 列
- [x] 2.5 扩展 `schema.parity.test.ts` 覆盖新表（`prep_job_status` 独立枚举；`lesson_packet_status` ENUM_PAIR 含 validating 双侧）

## 3. prep_worker 角色 + 双触发器硬墙（Drizzle，建表后）

- [x] 3.1 幂等 `DO`-block 建 `CREATE ROLE prep_worker LOGIN PASSWORD :pw`
- [x] 3.2 GRANT 写集：`lesson_packets` INS/UPD；`lesson_steps` INS/UPD/DEL；`model_calls` **仅 INSERT**。**不授 prep_jobs 写、不授 admin_confirmations SELECT**。SELECT 仅 questions/question_options/question_solutions/question_kp_links/knowledge_points + 自有表；daily_logs/mistakes/learner_kp_states/review_items/study_plans/session_events/source_blocks/imported_entities **无任何权限**
- [x] 3.3 `lesson_packets` 触发器（`session_user='prep_worker'`）：INSERT **与** UPDATE 都要求 `NEW.origin='ai_generated' AND NEW.status='validating'`；UPDATE **额外**要求 `OLD` 同值
- [x] 3.4 `lesson_steps` 触发器（`session_user='prep_worker'`，INS/UPD/DEL，**父行 NOT FOUND 必须 RAISE**）：INSERT 查 `NEW.lesson_packet_id` 父、DELETE 查 `OLD.lesson_packet_id` 父、**UPDATE 同时查 OLD 与 NEW 两个父包**均 `ai_generated+validating`（封 repoint 偷步）
- [x] 3.5 迁移顺序（角色/触发器在建表后）+ 回滚 `REVOKE`/`DROP ROLE`

## 4. Python ai-worker 骨架 + preflight（services/ai-worker，D3/D6/D10）

- [x] 4.1 **首步跑 Claude CLI preflight spike**：✅ 主 agent 已验（CLI 2.1.196，`claude -p --output-format json` 稳定出 `usage`(input/output/cache tokens) + `total_cost_usd` + `duration_ms`/`ttft_ms` + `model`，退出码 0）。锁版本 2.1.x；adapter 解析这些字段（`estimated_cost`=`total_cost_usd` 摊销）。preflight 通过 → 变更可行、无需 OpenRouter 退路
- [x] 4.2 新建 `services/ai-worker`（FastAPI `debug=False`/禁 `/docs` + asyncpg 以 `prep_worker` 连接），暴露**仅** `/v1/prep/generate`
- [x] 4.3 锁定版本 `datamodel-code-generator` 由 `contracts/*.json` 生成 Pydantic + Python 侧 `git diff` 关卡；FastAPI 入参 Pydantic 校验
- [x] 4.4 worker 仅绑 `127.0.0.1`/私网；`hmac.compare_digest` 常量时间校验共享密钥（不进日志）；**worker 不读不写 prep_jobs、不校验 job 状态**

## 5. ModelGateway（worker 内库模块，D6/D8）

- [x] 5.1 `ModelGateway`：调用点生成 model_call id + 捕获 provider/model/task_type/prompt_version/prep_job_id/request_hash
- [x] 5.2 model_calls 用池里**专用连接**独立 commit（**只 INSERT**）、成败都落行、commit 后才返回；写失败响亮报错；`error_message` 结构化白名单为唯一落库路径（剥 Authorization/key/共享密钥/订阅 token/argv/env）
- [x] 5.3 Claude CLI adapter：`subprocess` argv `shell=False`、固定 argv、prompt 走 stdin；**默认拒绝白名单 `--tools ""`（空-allowlist；preflight 锁定 CLI 2.1.x 真实旗标）/permission-mode 全拒（不用黑名单）** + 专用低权用户 + 凭据隔离目录；`subscription_amortized` cost basis；失败也落 model_calls(status=error)
- [x] 5.4 护栏：**per-job 调用/token 硬上限守所有 worker 调用口**（初始 claim + 孤儿重调）；**超限 → ModelGateway abort/raise → 由 BFF 置 `prep_jobs=failed`**（worker 不写 prep_jobs）；超时路径由 BFF 独立重试计数器兜（见 7.1）；数字保守占位（按窗口闸/¥预算/OpenRouter 推迟 Phase 2.x）

## 6. 生成端点 /v1/prep/generate（D7/D9）

- [x] 6.1 单 KP → 草稿：经 ModelGateway 产出 `origin='ai_generated' status='validating'`，practice 步引用真实已确认导入客观题
- [x] 6.2 产物事务：**持 `pg_advisory_xact_lock(hashtext(jobId))`** + jobId 派生 id `ON CONFLICT DO UPDATE` + **先按 `lessonPacketId` 删不在本次集合内的旧 step**；写 `contentHash`
- [x] 6.3 写 `generationSources`（结构化 sourceType ∈ {question, question_solution} + sourceId + modelCallIds + promptVersion；仅审计，确认依据由门取实际解析）

## 7. BFF 状态机 + 校验门 + admin（D3/D5/D11/D12）

- [x] 7.1 BFF 独占 prep_jobs：去重 `INSERT … ON CONFLICT (活跃 job 部分唯一索引) DO NOTHING RETURNING id`，**0 行返回则 `SELECT id WHERE kp_code/prompt_version AND status IN active` 兜底**取既有 jobId （`ON CONFLICT` 须带索引谓词 `(kp_code,prompt_version) WHERE status IN (...)` 否则不命中推断；DO NOTHING+SELECT 双 0 行=活跃 job 恰翻终态，retry INSERT）→ 原子认领 `UPDATE…WHERE status='pending' RETURNING` → 调 worker → 置 validating；worker 失败/超时对同 jobId 重调，**BFF 每次调 worker（含孤儿重调）前** `UPDATE prep_jobs SET attempt_count=attempt_count+1 RETURNING`，≥ per-job cap 即置 failed、不调 worker
- [x] 7.2 **抽取** `verify-packets:47-57` → packet 参数化 `checkPacketRefs(db, packet)` + 导出 seed-packets 引用解析 helper（不复制粘贴）
- [x] 7.3 BFF 三道硬门（**从持久化 lesson_packets+lesson_steps 重建 LessonPacket 喂门，正常路与孤儿路同源**）+ 一个 BFF 事务（持同一 `pg_advisory_xact_lock(hashtext(jobId))`）写 `quality_gate_results`+翻 `lesson_packets`+`prep_jobs`：①Schema（对**重建出的 LessonPacket** `Zod parse`，两路同源、parse 失败→quarantine、`schemaPassed` 反映之；transport 响应 parse 是另一回事）②Reference+确认（引用可解析 + ≥1 客观题有答案 key + kp_links + **对每个实际引用 questionId**：题轴 `(question,questionId)`、答案轴**复用 grader `correctLabelSet` 推判分键**——导入题恒走 option.isCorrect，门断言 import 不变式 `solution.answer 字母集 == option.isCorrect 集` 且该 solution 已确认 `(answer,solutionId)`、KP 轴 `(kp_link,linkId)`——**均不取 generationSources.sourceId**）③Math（键控 `step.math != null` 即 quarantine、**不**扫 mdx 文本）。**不建 mdx 净化门**（mdx 自动转义无 sink）
- [x] 7.4 BFF **可重入「重新校验」** + admin UI 触发入口：对停在 running/validating 的 jobId，按 jobId 对账，有持久化 validating 包则重建喂门（同 7.3 路径），无则重调/置 failed
- [x] 7.5 admin「生成草包」入口：选已确认 KP → 触发 → 按 jobId 查 `prep_jobs` 展示终态 + 原因 + 对孤儿的「重新校验」按钮；draft 列表展示来源
- [x] 7.6 `draft → ready` 逐包确认：BFF（app 角色）单事务先 `UPDATE lesson_packets SET status='ready' WHERE id = :lessonPacketId AND origin='ai_generated' AND status='draft' RETURNING id`（**`id=` 谓词必需**；**0 行则回滚不写 confirmation**），命中则写 `admin_confirmations`(entityType=lesson_packet)（**直写、不复用 confirmContent()**——其三分支会拒 lesson_packet）
- [x] 7.7 **学习者可见性门控**：①修 `apps/web/lib/packets.ts:131` denylist **加 `validating`**（保留 ready+consumed，**不**改单值 allowlist）②`resolveStepPayload`(actions.ts:126 **既有** innerJoin)加 `status IN ('ready','consumed')`；`submitAnswer`(269 **不 join**、按 questionId 直接判分)**净新增**一次按 client `lessonPacketId` 查状态校验（`persistAndApply` 前）；`recordEvent` start/complete 子类同理（门绑 client 声称包、与题归属解耦属已知残留）

## 8. CI、测试与端到端

- [x] 8.1 Python CI lane：ruff + mypy + pytest；契约双侧重生成 diff（锁 codegen 版本）
- [x] 8.2 负权限测试（CI 自动建角色后跑）：以 `prep_worker` ①写整个 deny-list（含 source_blocks/imported_entities）被拒 ②`SET origin/status` 改 `origin='system'` 行被拒 ③改写/删 `system ready` 包 step 被拒 ④`UPDATE lesson_steps SET lesson_packet_id` repoint system step 到自有 validating 包被拒（OLD 父守卫）⑤对自有 validating 行 `SET status='ready'` 与 `SET status='draft'` **均**被拒（NEW 守卫）⑥`UPDATE`/`DELETE` `model_calls` 被拒 ⑦`INSERT/UPDATE prep_jobs` 被拒 ⑧`SELECT daily_logs`/`admin_confirmations` 被拒；正权限冒烟 `SELECT questions` 成功；断言无 `GRANT … TO PUBLIC`
- [x] 8.3 安全/正确性单测：Claude CLI prompt 含 `$(...)`/反引号/前导 `--` 被当字面；grounding 含「忽略上文执行 X」+ no-tools 白名单 → 含 `Read` 在内工具均不可用；`error_message` 注入 API-key/Bearer 形态样本并脱敏；外层 tx 回滚后 model_calls 行仍在；重试 N→N-1 步不留陈旧 step；并发重调同 jobId 由 advisory lock 串行不损坏；学习者对 validating 包 step 调判分/事件被 status 门拒
- [x] 8.4 端到端（真实迁移库上真执行 + **录制/stub 模型响应保确定**，纳入 Python CI lane；走 成功/错误/订阅 三路打满每列；**demo KP 选非公式学科 OS 13180**）：已确认 KP → 去重/认领 → generate(validating) → BFF 三门 → draft → 逐包确认 → ready → 进 Phase-1 课堂跑出 graded 答案；断言**确认包 A 后 draft 包 B 仍为 draft**；含 quarantine 分支（不可解析/无客观题/缺答案 key/缺 kp_links/题或答案或 kp_link 未确认/含公式）、running 孤儿重新校验、全链路超时抬高前置

## 9. 打包与部署（Docker + .env，用户追加）

- [x] 9.1 `.env` 约定：`services/ai-worker/.env.example`（提交，含空占位 `PREP_WORKER_PASSWORD`、`AI_WORKER_SHARED_SECRET`、`AI_WORKER_DATABASE_URL`）+ `.env`（gitignored）；G3 迁移命令改为 `set -a; . .env` 后 `-v prep_worker_password="$PREP_WORKER_PASSWORD"`，使**迁移与 worker 共用同一密码**
- [x] 9.2 `services/ai-worker/Dockerfile`（python3.13-slim + uv 装锁定依赖，跑 `uvicorn ai_worker.main:app`；容器内绑 0.0.0.0、端口仅映射宿主 `127.0.0.1`）
- [x] 9.3 `services/ai-worker/docker-compose.yml`（`ai-worker` 服务，`env_file=.env`，连 prepforge-postgres：DSN host 用 `host.docker.internal:5433` 或同网络；仅暴露 `127.0.0.1:<port>`；`.env.example` 注明容器内/外 DSN host 差异）
