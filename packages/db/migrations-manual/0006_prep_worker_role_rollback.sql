-- ============================================================================
-- 0006_prep_worker_role_rollback.sql  —  rollback of 0006_prep_worker_role.sql
-- ============================================================================
-- PRIVILEGED — run by a DB SUPERUSER (or table owner with CREATEROLE):
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
--        -f packages/db/migrations-manual/0006_prep_worker_role_rollback.sql
--
-- Drops the guard triggers + functions and removes the prep_worker role. The
-- role section is guarded so the script is safe to re-run after the role is
-- already gone.
-- ============================================================================

\set ON_ERROR_STOP on

BEGIN;

-- Triggers + functions (independent of role existence).
DROP TRIGGER IF EXISTS prep_worker_guard_lesson_steps   ON lesson_steps;
DROP TRIGGER IF EXISTS prep_worker_guard_lesson_packets ON lesson_packets;
DROP FUNCTION IF EXISTS prep_worker_guard_lesson_steps();
DROP FUNCTION IF EXISTS prep_worker_guard_lesson_packets();

-- Role: explicitly REVOKE every grant, then DROP. DROP OWNED BY also clears any
-- privileges granted to (and objects owned by — none here) the role in this
-- database, so DROP ROLE does not fail on a lingering dependency.
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'prep_worker') THEN
    EXECUTE 'REVOKE ALL PRIVILEGES ON '
         || 'questions, question_options, question_solutions, question_kp_links, '
         || 'knowledge_points, lesson_packets, lesson_steps, model_calls '
         || 'FROM prep_worker';
    EXECUTE 'REVOKE USAGE ON SCHEMA public FROM prep_worker';
    EXECUTE 'DROP OWNED BY prep_worker';
    EXECUTE 'DROP ROLE prep_worker';
  END IF;
END
$$;

COMMIT;
