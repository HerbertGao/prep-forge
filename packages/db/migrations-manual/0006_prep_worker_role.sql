-- ============================================================================
-- 0006_prep_worker_role.sql  —  prep_worker role + double-trigger hard wall
-- ============================================================================
-- PRIVILEGED MIGRATION — NOT a Drizzle auto-migration.
--
-- Contains CREATE ROLE / ALTER ROLE / GRANT (cluster-level privileged ops that
-- Drizzle does not manage). It MUST be run by a DB SUPERUSER (or the table
-- owner with CREATEROLE) and ONLY AFTER the table migration 0005 has been
-- applied (it depends on lesson_packets/lesson_steps/model_calls + the
-- 'validating' enum value created there).
--
-- The CI / app must NOT auto-apply this. A human (or a privileged deploy step)
-- runs it explicitly. The prep_worker password is SHARED with the ai-worker
-- service via services/ai-worker/.env (see services/ai-worker/.env.example) —
-- source that file so the role and the worker use ONE password, then pass it as
-- a psql variable. $DATABASE_URL here is the privileged (superuser) connection,
-- supplied separately from the prep_worker DSN that lives in that .env:
--
--   set -a; . services/ai-worker/.env; set +a   # loads PREP_WORKER_PASSWORD
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
--        -v prep_worker_password="$PREP_WORKER_PASSWORD" \
--        -f packages/db/migrations-manual/0006_prep_worker_role.sql
--
-- Rollback:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
--        -f packages/db/migrations-manual/0006_prep_worker_role_rollback.sql
--
-- The password is parameterized (:'prep_worker_password') — NEVER hardcode it
-- here. If the variable is unset, the ALTER ROLE below fails and the whole
-- transaction rolls back, so an interrupted run never leaves a usable role.
-- ============================================================================

\set ON_ERROR_STOP on

BEGIN;

-- ----------------------------------------------------------------------------
-- 3.1  Idempotent role creation.
-- Created NOLOGIN first; LOGIN + PASSWORD are enabled together in the ALTER
-- below. Rationale: psql does NOT interpolate :variables inside dollar-quoted
-- DO blocks, so the password cannot live in the DO body. Creating NOLOGIN and
-- enabling LOGIN only alongside the password (outside the DO block, where psql
-- DOES interpolate) means a half-run can never leave a passwordless LOGIN role.
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'prep_worker') THEN
    CREATE ROLE prep_worker NOLOGIN;
  END IF;
END
$$;

-- Enable LOGIN + set password. Outside the DO block so :'prep_worker_password'
-- is interpolated by psql. Idempotent: re-running re-asserts the password.
ALTER ROLE prep_worker WITH LOGIN PASSWORD :'prep_worker_password';

-- ----------------------------------------------------------------------------
-- 3.2  Least-privilege GRANTs.
-- Write set:
--   lesson_packets  INSERT, UPDATE
--   lesson_steps    INSERT, UPDATE, DELETE
--   model_calls     INSERT only (append-only ledger; no UPDATE/DELETE/SELECT)
-- Read set: public question bank + own write tables it actually reads.
--   - SELECT on lesson_packets is REQUIRED: the BEFORE triggers below run
--     SECURITY INVOKER and SELECT the parent packet.
--   - SELECT on lesson_steps is REQUIRED: the worker's delete-stale-steps and
--     upsert WHERE/RETURNING clauses read its columns.
-- NOT granted (default-deny enforced by simply not granting):
--   prep_jobs (no read AND no write), quality_gate_results, admin_confirmations,
--   daily_logs, mistakes, learner_kp_states, review_items, study_plans,
--   learner_profiles, session_events, source_blocks, source_documents,
--   imported_entities, import_runs, import_errors, question_bank_stats, and the
--   curriculum tables. No GRANT ... TO PUBLIC is issued anywhere.
-- ----------------------------------------------------------------------------
GRANT USAGE ON SCHEMA public TO prep_worker;

-- Read-only: public question bank.
GRANT SELECT ON
  questions,
  question_options,
  question_solutions,
  question_kp_links,
  knowledge_points
TO prep_worker;

-- Own write tables.
GRANT SELECT, INSERT, UPDATE         ON lesson_packets TO prep_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON lesson_steps   TO prep_worker;
GRANT INSERT                         ON model_calls    TO prep_worker;

-- ----------------------------------------------------------------------------
-- 3.3  lesson_packets guard trigger.
-- session_user (NOT current_user) so SET ROLE cannot bypass.
--   INSERT and UPDATE: NEW must be origin='ai_generated' AND status='validating'
--     → blocks self-promotion (SET status='ready'/'draft') on both paths.
--   UPDATE additionally: OLD must be origin='ai_generated' AND status='validating'
--     → blocks hijacking a pre-existing system/ready row.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION prep_worker_guard_lesson_packets()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF session_user = 'prep_worker' THEN
    IF NEW.origin <> 'ai_generated' OR NEW.status <> 'validating' THEN
      RAISE EXCEPTION
        'prep_worker may only write lesson_packets with origin=ai_generated, status=validating (got origin=%, status=%)',
        NEW.origin, NEW.status
        USING ERRCODE = 'insufficient_privilege';
    END IF;

    IF TG_OP = 'UPDATE' THEN
      IF OLD.origin <> 'ai_generated' OR OLD.status <> 'validating' THEN
        RAISE EXCEPTION
          'prep_worker may not update a non-(ai_generated,validating) lesson_packet (old origin=%, status=%)',
          OLD.origin, OLD.status
          USING ERRCODE = 'insufficient_privilege';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prep_worker_guard_lesson_packets ON lesson_packets;
CREATE TRIGGER prep_worker_guard_lesson_packets
  BEFORE INSERT OR UPDATE ON lesson_packets
  FOR EACH ROW
  EXECUTE FUNCTION prep_worker_guard_lesson_packets();

-- ----------------------------------------------------------------------------
-- 3.4  lesson_steps guard trigger.
-- session_user gated. Parent lesson_packets row MUST be (ai_generated, validating).
-- Parent NOT FOUND MUST RAISE (a bare NULL<>... comparison would yield NULL and
-- let the row through) — here NOT FOUND is checked explicitly.
--   INSERT: check NEW.lesson_packet_id parent.
--   DELETE: check OLD.lesson_packet_id parent (blocks deleting system steps).
--   UPDATE: check BOTH OLD and NEW parents → blocks the repoint-steal
--     (UPDATE lesson_steps SET lesson_packet_id='<my validating>' WHERE
--      id='<system step>': NEW parent = mine passes, but OLD parent = system
--      ready fails the OLD check).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION prep_worker_guard_lesson_steps()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  parent_origin text;
  parent_status text;
BEGIN
  IF session_user = 'prep_worker' THEN
    -- NEW parent (INSERT / UPDATE).
    IF TG_OP IN ('INSERT', 'UPDATE') THEN
      SELECT lp.origin, lp.status INTO parent_origin, parent_status
        FROM lesson_packets lp
        WHERE lp.id = NEW.lesson_packet_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION
          'prep_worker: lesson_steps NEW parent packet % not found', NEW.lesson_packet_id
          USING ERRCODE = 'insufficient_privilege';
      END IF;
      IF parent_origin <> 'ai_generated' OR parent_status <> 'validating' THEN
        RAISE EXCEPTION
          'prep_worker: lesson_steps NEW parent packet % is (origin=%, status=%); require (ai_generated, validating)',
          NEW.lesson_packet_id, parent_origin, parent_status
          USING ERRCODE = 'insufficient_privilege';
      END IF;
    END IF;

    -- OLD parent (UPDATE / DELETE).
    IF TG_OP IN ('UPDATE', 'DELETE') THEN
      SELECT lp.origin, lp.status INTO parent_origin, parent_status
        FROM lesson_packets lp
        WHERE lp.id = OLD.lesson_packet_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION
          'prep_worker: lesson_steps OLD parent packet % not found', OLD.lesson_packet_id
          USING ERRCODE = 'insufficient_privilege';
      END IF;
      IF parent_origin <> 'ai_generated' OR parent_status <> 'validating' THEN
        RAISE EXCEPTION
          'prep_worker: lesson_steps OLD parent packet % is (origin=%, status=%); require (ai_generated, validating)',
          OLD.lesson_packet_id, parent_origin, parent_status
          USING ERRCODE = 'insufficient_privilege';
      END IF;
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prep_worker_guard_lesson_steps ON lesson_steps;
CREATE TRIGGER prep_worker_guard_lesson_steps
  BEFORE INSERT OR UPDATE OR DELETE ON lesson_steps
  FOR EACH ROW
  EXECUTE FUNCTION prep_worker_guard_lesson_steps();

COMMIT;
