ALTER TABLE "learner_kp_states" ADD COLUMN "last_applied_session_id" text;--> statement-breakpoint
ALTER TABLE "learner_kp_states" ADD COLUMN "last_applied_sequence" integer;--> statement-breakpoint
ALTER TABLE "mistakes" ADD COLUMN "source_session_id" text;--> statement-breakpoint
ALTER TABLE "mistakes" ADD COLUMN "source_sequence" integer;--> statement-breakpoint
ALTER TABLE "mistakes" ADD COLUMN "admin_confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "review_items" ADD COLUMN "last_applied_session_id" text;--> statement-breakpoint
ALTER TABLE "review_items" ADD COLUMN "last_applied_sequence" integer;--> statement-breakpoint
ALTER TABLE "review_items" ADD COLUMN "last_applied_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "review_items" ADD COLUMN "admin_confirmed_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "learner_kp_states_system_natural_uq" ON "learner_kp_states" USING btree ("learner_id","course_code","kp_code") WHERE "learner_kp_states"."origin" = 'system';