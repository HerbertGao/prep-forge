CREATE INDEX "question_kp_links_course_code_idx" ON "question_kp_links" USING btree ("course_code");--> statement-breakpoint
CREATE INDEX "question_options_question_id_idx" ON "question_options" USING btree ("question_id");--> statement-breakpoint
CREATE INDEX "question_solutions_question_id_idx" ON "question_solutions" USING btree ("question_id");