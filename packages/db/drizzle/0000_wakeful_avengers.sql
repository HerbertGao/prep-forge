CREATE TYPE "public"."actor_type" AS ENUM('student', 'system', 'tutor');--> statement-breakpoint
CREATE TYPE "public"."course_exam_status" AS ENUM('未开始', '缺考', '重考', '在考', '已通过', 'unmapped');--> statement-breakpoint
CREATE TYPE "public"."import_error_severity" AS ENUM('error', 'warning', 'quarantine');--> statement-breakpoint
CREATE TYPE "public"."import_run_status" AS ENUM('running', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."imported_entity_status" AS ENUM('staged', 'published', 'quarantine', 'error');--> statement-breakpoint
CREATE TYPE "public"."kp_state" AS ENUM('unseen', 'taught', 'practiced', 'mastered');--> statement-breakpoint
CREATE TYPE "public"."lesson_packet_status" AS ENUM('draft', 'ready', 'consumed', 'quarantine');--> statement-breakpoint
CREATE TYPE "public"."lesson_step_type" AS ENUM('diagnostic_question', 'socratic_question', 'explanation', 'math_block', 'worked_example', 'practice', 'hint', 'summary', 'review_prompt');--> statement-breakpoint
CREATE TYPE "public"."origin" AS ENUM('imported', 'system', 'ai_generated');--> statement-breakpoint
CREATE TYPE "public"."session_event_type" AS ENUM('lesson_started', 'step_shown', 'student_answered', 'lesson_completed');--> statement-breakpoint
CREATE TYPE "public"."source_document_status" AS ENUM('parsed', 'unsupported', 'skipped', 'error');--> statement-breakpoint
CREATE TYPE "public"."visibility" AS ENUM('public', 'personal');--> statement-breakpoint
CREATE TABLE "import_errors" (
	"id" text PRIMARY KEY NOT NULL,
	"import_run_id" text NOT NULL,
	"source_document_id" text,
	"source_block_id" text,
	"source_path" text,
	"heading_path" jsonb,
	"raw_block" text,
	"severity" "import_error_severity" NOT NULL,
	"kind" text NOT NULL,
	"message" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"source_repo" text,
	"source_ref" text,
	"source_root_path" text NOT NULL,
	"dry_run" boolean NOT NULL,
	"status" "import_run_status" NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "imported_entities" (
	"id" text PRIMARY KEY NOT NULL,
	"origin" "origin" NOT NULL,
	"visibility" "visibility" NOT NULL,
	"import_run_id" text NOT NULL,
	"source_block_id" text NOT NULL,
	"entity_type" text NOT NULL,
	"natural_key" text NOT NULL,
	"content_hash" text NOT NULL,
	"status" "imported_entity_status" NOT NULL,
	"payload" jsonb
);
--> statement-breakpoint
CREATE TABLE "source_blocks" (
	"id" text PRIMARY KEY NOT NULL,
	"import_run_id" text NOT NULL,
	"source_document_id" text NOT NULL,
	"source_path" text NOT NULL,
	"heading_path" jsonb NOT NULL,
	"normalized_key" text NOT NULL,
	"line_range" jsonb NOT NULL,
	"raw_block" text NOT NULL,
	"content_hash" text NOT NULL,
	"source_repo" text,
	"source_ref" text
);
--> statement-breakpoint
CREATE TABLE "source_documents" (
	"id" text PRIMARY KEY NOT NULL,
	"import_run_id" text NOT NULL,
	"source_path" text NOT NULL,
	"source_repo" text,
	"source_ref" text,
	"status" "source_document_status" NOT NULL,
	"content_hash" text
);
--> statement-breakpoint
CREATE TABLE "chapters" (
	"id" text PRIMARY KEY NOT NULL,
	"origin" "origin" NOT NULL,
	"visibility" "visibility" NOT NULL,
	"course_code" text NOT NULL,
	"chapter_no" text NOT NULL,
	"title" text NOT NULL,
	"source_block_id" text,
	"content_hash" text
);
--> statement-breakpoint
CREATE TABLE "courses" (
	"id" text PRIMARY KEY NOT NULL,
	"origin" "origin" NOT NULL,
	"visibility" "visibility" NOT NULL,
	"course_code" text NOT NULL,
	"slug" text,
	"name" text NOT NULL,
	"exam_track" text,
	"exam_status" "course_exam_status" NOT NULL,
	"source_block_id" text,
	"content_hash" text
);
--> statement-breakpoint
CREATE TABLE "exam_tracks" (
	"id" text PRIMARY KEY NOT NULL,
	"origin" "origin" NOT NULL,
	"visibility" "visibility" NOT NULL,
	"exam_track" text NOT NULL,
	"title" text,
	"exam_date" text,
	"source_block_id" text,
	"content_hash" text
);
--> statement-breakpoint
CREATE TABLE "knowledge_points" (
	"id" text PRIMARY KEY NOT NULL,
	"origin" "origin" NOT NULL,
	"visibility" "visibility" NOT NULL,
	"course_code" text NOT NULL,
	"kp_code" text NOT NULL,
	"title" text NOT NULL,
	"chapter_no" text,
	"exam_frequency" text,
	"source_block_id" text,
	"content_hash" text
);
--> statement-breakpoint
CREATE TABLE "learner_profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"origin" "origin" NOT NULL,
	"visibility" "visibility" NOT NULL,
	"learner_id" text NOT NULL,
	"display_name" text,
	"exam_track" text,
	"preferences" jsonb,
	"source_block_id" text,
	"content_hash" text
);
--> statement-breakpoint
CREATE TABLE "subjects" (
	"id" text PRIMARY KEY NOT NULL,
	"origin" "origin" NOT NULL,
	"visibility" "visibility" NOT NULL,
	"subject_code" text NOT NULL,
	"course_code" text,
	"name" text NOT NULL,
	"exam_track" text,
	"source_block_id" text,
	"content_hash" text
);
--> statement-breakpoint
CREATE TABLE "question_bank_stats" (
	"id" text PRIMARY KEY NOT NULL,
	"origin" "origin" NOT NULL,
	"visibility" "visibility" NOT NULL,
	"course_code" text NOT NULL,
	"src" text,
	"declared_count" integer,
	"parsed_count" integer,
	"type_distribution" jsonb,
	"source_block_id" text,
	"content_hash" text
);
--> statement-breakpoint
CREATE TABLE "question_kp_links" (
	"id" text PRIMARY KEY NOT NULL,
	"origin" "origin" NOT NULL,
	"visibility" "visibility" NOT NULL,
	"question_id" text NOT NULL,
	"course_code" text NOT NULL,
	"kp_code" text NOT NULL,
	"source_block_id" text,
	"content_hash" text
);
--> statement-breakpoint
CREATE TABLE "question_options" (
	"id" text PRIMARY KEY NOT NULL,
	"origin" "origin" NOT NULL,
	"visibility" "visibility" NOT NULL,
	"question_id" text NOT NULL,
	"label" text NOT NULL,
	"content" text NOT NULL,
	"is_correct" boolean,
	"source_block_id" text,
	"content_hash" text
);
--> statement-breakpoint
CREATE TABLE "question_solutions" (
	"id" text PRIMARY KEY NOT NULL,
	"origin" "origin" NOT NULL,
	"visibility" "visibility" NOT NULL,
	"question_id" text NOT NULL,
	"answer" text NOT NULL,
	"explanation" text,
	"source_block_id" text,
	"content_hash" text
);
--> statement-breakpoint
CREATE TABLE "questions" (
	"id" text PRIMARY KEY NOT NULL,
	"origin" "origin" NOT NULL,
	"visibility" "visibility" NOT NULL,
	"course_code" text NOT NULL,
	"src" text NOT NULL,
	"question_id" text NOT NULL,
	"stem_hash" text,
	"chapter_no" text,
	"sequence" integer,
	"stem" text NOT NULL,
	"type" text NOT NULL,
	"source_block_id" text,
	"content_hash" text
);
--> statement-breakpoint
CREATE TABLE "lesson_packets" (
	"id" text PRIMARY KEY NOT NULL,
	"origin" "origin" NOT NULL,
	"visibility" "visibility" NOT NULL,
	"version" integer NOT NULL,
	"status" "lesson_packet_status" NOT NULL,
	"subject_code" text,
	"course_code" text,
	"title" text NOT NULL,
	"kp_codes" jsonb NOT NULL,
	"prerequisites" jsonb,
	"estimated_minutes" integer,
	"difficulty" text,
	"objectives" jsonb,
	"source_block_id" text,
	"content_hash" text
);
--> statement-breakpoint
CREATE TABLE "lesson_steps" (
	"id" text PRIMARY KEY NOT NULL,
	"lesson_packet_id" text NOT NULL,
	"sequence" integer NOT NULL,
	"type" "lesson_step_type" NOT NULL,
	"prompt" text,
	"mdx" text,
	"math" jsonb,
	"question_ids" jsonb
);
--> statement-breakpoint
CREATE TABLE "session_events" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" text,
	"session_id" text NOT NULL,
	"enrollment_id" text,
	"event_type" "session_event_type" NOT NULL,
	"event_version" integer NOT NULL,
	"sequence" integer NOT NULL,
	"actor_type" "actor_type" NOT NULL,
	"payload" jsonb,
	"idempotency_key" text NOT NULL,
	"correlation_id" text,
	"causation_id" text,
	"model_call_id" text,
	"lesson_packet_id" text,
	"step_id" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "daily_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"origin" "origin" NOT NULL,
	"visibility" "visibility" NOT NULL,
	"learner_id" text,
	"date" text NOT NULL,
	"content" text NOT NULL,
	"source_block_id" text,
	"content_hash" text
);
--> statement-breakpoint
CREATE TABLE "learner_kp_states" (
	"id" text PRIMARY KEY NOT NULL,
	"origin" "origin" NOT NULL,
	"visibility" "visibility" NOT NULL,
	"learner_id" text NOT NULL,
	"course_code" text NOT NULL,
	"kp_code" text NOT NULL,
	"state" "kp_state" NOT NULL,
	"score" double precision,
	"source_block_id" text,
	"content_hash" text
);
--> statement-breakpoint
CREATE TABLE "mistakes" (
	"id" text PRIMARY KEY NOT NULL,
	"origin" "origin" NOT NULL,
	"visibility" "visibility" NOT NULL,
	"learner_id" text,
	"course_code" text,
	"kp_code" text,
	"question_ref" text,
	"category" text,
	"note" text,
	"source_block_id" text,
	"content_hash" text
);
--> statement-breakpoint
CREATE TABLE "review_items" (
	"id" text PRIMARY KEY NOT NULL,
	"origin" "origin" NOT NULL,
	"visibility" "visibility" NOT NULL,
	"learner_id" text,
	"course_code" text,
	"kp_code" text NOT NULL,
	"due_date" text,
	"status" text,
	"source_block_id" text,
	"content_hash" text
);
--> statement-breakpoint
CREATE TABLE "study_plans" (
	"id" text PRIMARY KEY NOT NULL,
	"origin" "origin" NOT NULL,
	"visibility" "visibility" NOT NULL,
	"learner_id" text,
	"exam_track" text,
	"title" text,
	"slots" jsonb,
	"source_block_id" text,
	"content_hash" text
);
--> statement-breakpoint
ALTER TABLE "import_errors" ADD CONSTRAINT "import_errors_import_run_id_import_runs_id_fk" FOREIGN KEY ("import_run_id") REFERENCES "public"."import_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_errors" ADD CONSTRAINT "import_errors_source_document_id_source_documents_id_fk" FOREIGN KEY ("source_document_id") REFERENCES "public"."source_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_errors" ADD CONSTRAINT "import_errors_source_block_id_source_blocks_id_fk" FOREIGN KEY ("source_block_id") REFERENCES "public"."source_blocks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imported_entities" ADD CONSTRAINT "imported_entities_import_run_id_import_runs_id_fk" FOREIGN KEY ("import_run_id") REFERENCES "public"."import_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imported_entities" ADD CONSTRAINT "imported_entities_source_block_id_source_blocks_id_fk" FOREIGN KEY ("source_block_id") REFERENCES "public"."source_blocks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_blocks" ADD CONSTRAINT "source_blocks_import_run_id_import_runs_id_fk" FOREIGN KEY ("import_run_id") REFERENCES "public"."import_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_blocks" ADD CONSTRAINT "source_blocks_source_document_id_source_documents_id_fk" FOREIGN KEY ("source_document_id") REFERENCES "public"."source_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_documents" ADD CONSTRAINT "source_documents_import_run_id_import_runs_id_fk" FOREIGN KEY ("import_run_id") REFERENCES "public"."import_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chapters" ADD CONSTRAINT "chapters_source_block_id_source_blocks_id_fk" FOREIGN KEY ("source_block_id") REFERENCES "public"."source_blocks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "courses" ADD CONSTRAINT "courses_source_block_id_source_blocks_id_fk" FOREIGN KEY ("source_block_id") REFERENCES "public"."source_blocks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_tracks" ADD CONSTRAINT "exam_tracks_source_block_id_source_blocks_id_fk" FOREIGN KEY ("source_block_id") REFERENCES "public"."source_blocks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_points" ADD CONSTRAINT "knowledge_points_source_block_id_source_blocks_id_fk" FOREIGN KEY ("source_block_id") REFERENCES "public"."source_blocks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learner_profiles" ADD CONSTRAINT "learner_profiles_source_block_id_source_blocks_id_fk" FOREIGN KEY ("source_block_id") REFERENCES "public"."source_blocks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subjects" ADD CONSTRAINT "subjects_source_block_id_source_blocks_id_fk" FOREIGN KEY ("source_block_id") REFERENCES "public"."source_blocks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_bank_stats" ADD CONSTRAINT "question_bank_stats_source_block_id_source_blocks_id_fk" FOREIGN KEY ("source_block_id") REFERENCES "public"."source_blocks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_kp_links" ADD CONSTRAINT "question_kp_links_source_block_id_source_blocks_id_fk" FOREIGN KEY ("source_block_id") REFERENCES "public"."source_blocks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_options" ADD CONSTRAINT "question_options_source_block_id_source_blocks_id_fk" FOREIGN KEY ("source_block_id") REFERENCES "public"."source_blocks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_solutions" ADD CONSTRAINT "question_solutions_source_block_id_source_blocks_id_fk" FOREIGN KEY ("source_block_id") REFERENCES "public"."source_blocks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_source_block_id_source_blocks_id_fk" FOREIGN KEY ("source_block_id") REFERENCES "public"."source_blocks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_packets" ADD CONSTRAINT "lesson_packets_source_block_id_source_blocks_id_fk" FOREIGN KEY ("source_block_id") REFERENCES "public"."source_blocks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_steps" ADD CONSTRAINT "lesson_steps_lesson_packet_id_lesson_packets_id_fk" FOREIGN KEY ("lesson_packet_id") REFERENCES "public"."lesson_packets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_logs" ADD CONSTRAINT "daily_logs_source_block_id_source_blocks_id_fk" FOREIGN KEY ("source_block_id") REFERENCES "public"."source_blocks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learner_kp_states" ADD CONSTRAINT "learner_kp_states_source_block_id_source_blocks_id_fk" FOREIGN KEY ("source_block_id") REFERENCES "public"."source_blocks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mistakes" ADD CONSTRAINT "mistakes_source_block_id_source_blocks_id_fk" FOREIGN KEY ("source_block_id") REFERENCES "public"."source_blocks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_items" ADD CONSTRAINT "review_items_source_block_id_source_blocks_id_fk" FOREIGN KEY ("source_block_id") REFERENCES "public"."source_blocks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "study_plans" ADD CONSTRAINT "study_plans_source_block_id_source_blocks_id_fk" FOREIGN KEY ("source_block_id") REFERENCES "public"."source_blocks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "source_blocks_identity_uq" ON "source_blocks" USING btree ("source_path","heading_path","normalized_key");--> statement-breakpoint
CREATE UNIQUE INDEX "chapters_natural_key_uq" ON "chapters" USING btree ("course_code","chapter_no");--> statement-breakpoint
CREATE UNIQUE INDEX "courses_natural_key_uq" ON "courses" USING btree ("course_code");--> statement-breakpoint
CREATE UNIQUE INDEX "exam_tracks_natural_key_uq" ON "exam_tracks" USING btree ("exam_track");--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_points_natural_key_uq" ON "knowledge_points" USING btree ("course_code","kp_code");--> statement-breakpoint
CREATE UNIQUE INDEX "learner_profiles_natural_key_uq" ON "learner_profiles" USING btree ("learner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "subjects_natural_key_uq" ON "subjects" USING btree ("subject_code");--> statement-breakpoint
CREATE UNIQUE INDEX "questions_natural_key_uq" ON "questions" USING btree ("course_code","src","question_id");--> statement-breakpoint
CREATE UNIQUE INDEX "session_events_session_sequence_uq" ON "session_events" USING btree ("session_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "session_events_session_idempotency_uq" ON "session_events" USING btree ("session_id","idempotency_key");