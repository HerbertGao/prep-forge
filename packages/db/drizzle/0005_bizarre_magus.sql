CREATE TYPE "public"."prep_job_status" AS ENUM('pending', 'running', 'validating', 'done', 'failed');--> statement-breakpoint
ALTER TYPE "public"."lesson_packet_status" ADD VALUE 'validating' BEFORE 'draft';--> statement-breakpoint
CREATE TABLE "model_calls" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"task_type" text NOT NULL,
	"user_id" text,
	"lesson_packet_id" text,
	"input_tokens" integer,
	"output_tokens" integer,
	"estimated_cost" numeric(12, 6),
	"latency_ms" integer,
	"status" text NOT NULL,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"prep_job_id" text,
	"cost_basis" text,
	"prompt_version" text,
	"request_hash" text
);
--> statement-breakpoint
CREATE TABLE "prep_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"status" "prep_job_status" NOT NULL,
	"kp_code" text NOT NULL,
	"prompt_version" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"failure_reason" text,
	"lesson_packet_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quality_gate_results" (
	"id" text PRIMARY KEY NOT NULL,
	"lesson_packet_id" text,
	"prep_job_id" text,
	"schema_passed" boolean NOT NULL,
	"math_render_passed" boolean NOT NULL,
	"question_refs_passed" boolean NOT NULL,
	"score" numeric,
	"passed" boolean NOT NULL,
	"issues" jsonb
);
--> statement-breakpoint
ALTER TABLE "lesson_packets" ADD COLUMN "generation_sources" jsonb;--> statement-breakpoint
ALTER TABLE "model_calls" ADD CONSTRAINT "model_calls_prep_job_id_prep_jobs_id_fk" FOREIGN KEY ("prep_job_id") REFERENCES "public"."prep_jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prep_jobs" ADD CONSTRAINT "prep_jobs_lesson_packet_id_lesson_packets_id_fk" FOREIGN KEY ("lesson_packet_id") REFERENCES "public"."lesson_packets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_gate_results" ADD CONSTRAINT "quality_gate_results_lesson_packet_id_lesson_packets_id_fk" FOREIGN KEY ("lesson_packet_id") REFERENCES "public"."lesson_packets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_gate_results" ADD CONSTRAINT "quality_gate_results_prep_job_id_prep_jobs_id_fk" FOREIGN KEY ("prep_job_id") REFERENCES "public"."prep_jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "model_calls_prep_job_id_idx" ON "model_calls" USING btree ("prep_job_id");--> statement-breakpoint
CREATE UNIQUE INDEX "prep_jobs_active_kp_prompt_uq" ON "prep_jobs" USING btree ("kp_code","prompt_version") WHERE "prep_jobs"."status" in ('pending', 'running', 'validating');