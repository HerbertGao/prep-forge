import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { prepJobStatusEnum } from "./common";
import { lessonPackets } from "./lesson";

// Phase 2 AI content-prep tables — mirror @prep-forge/schemas contracts
// (ModelCall / QualityGateResult / PrepJobRecord). Column property names are
// camelCase and MUST equal the Zod field names so the parity test compares key
// sets. Tables may carry EXTRA columns (e.g. quality_gate_results.prepJobId).
// G2 builds TABLES ONLY — the prep_worker role + triggers are a separate
// migration (G3).

// prep_jobs — BFF owns the lifecycle (D3); worker never reads/writes it.
// Active-job dedup is the partial-unique index on (kp_code, prompt_version);
// idempotency_key is a NON-UNIQUE audit column; attempt_count persists the
// per-job call cap across requests (D4).
export const prepJobs = pgTable(
  "prep_jobs",
  {
    id: text("id").primaryKey(),
    status: prepJobStatusEnum("status").notNull(),
    kpCode: text("kp_code").notNull(),
    promptVersion: text("prompt_version").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    attemptCount: integer("attempt_count").notNull().default(0),
    failureReason: text("failure_reason"),
    lessonPacketId: text("lesson_packet_id").references(() => lessonPackets.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("prep_jobs_active_kp_prompt_uq")
      .on(t.kpCode, t.promptVersion)
      .where(sql`${t.status} in ('pending', 'running', 'validating')`),
  ],
);

// model_calls — append-only cost ledger (D6). estimated_cost numeric(12,6);
// error_message holds the structured/truncated whitelist (sanitized at the
// gateway, see D6). prep_job_id FK + index for §11 per-job aggregation.
export const modelCalls = pgTable(
  "model_calls",
  {
    id: text("id").primaryKey(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    taskType: text("task_type").notNull(),
    userId: text("user_id"),
    lessonPacketId: text("lesson_packet_id"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    estimatedCost: numeric("estimated_cost", { precision: 12, scale: 6 }),
    latencyMs: integer("latency_ms"),
    status: text("status").notNull(),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    prepJobId: text("prep_job_id").references(() => prepJobs.id),
    costBasis: text("cost_basis"),
    promptVersion: text("prompt_version"),
    requestHash: text("request_hash"),
  },
  (t) => [index("model_calls_prep_job_id_idx").on(t.prepJobId)],
);

// quality_gate_results — three deterministic hard gates (D5). PK = qg#<jobId>
// (derived, one row per job). prep_job_id is an EXTRA column (not on the Zod
// contract; table ⊇ Zod holds).
export const qualityGateResults = pgTable("quality_gate_results", {
  id: text("id").primaryKey(), // qg#<jobId>
  lessonPacketId: text("lesson_packet_id").references(() => lessonPackets.id),
  prepJobId: text("prep_job_id").references(() => prepJobs.id),
  schemaPassed: boolean("schema_passed").notNull(),
  mathRenderPassed: boolean("math_render_passed").notNull(),
  questionRefsPassed: boolean("question_refs_passed").notNull(),
  score: numeric("score"),
  passed: boolean("passed").notNull(),
  issues: jsonb("issues"),
});
