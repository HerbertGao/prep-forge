// Derived ids for system projection rows (mirrors packages/db/publish.ts: stable
// id from natural key + ON CONFLICT(id) is the dedup authority, design D7).
//
// Imported rows use `${entityType}#${naturalKey}` (legacy-import). System rows
// add a `system#` namespace segment so a projection id can NEVER collide with an
// imported id for the same (learner, course, kp), even though origin is not in
// the imported key.

const sep = ":";

/** learner_kp_states projection id — hashes (learner, course, kp, origin=system). */
export function systemKpStateId(
  learnerId: string,
  courseCode: string,
  kpCode: string,
): string {
  return `learner_kp_state#system#${learnerId}${sep}${courseCode}${sep}${kpCode}`;
}

/** review_items projection id — one terminal row per (learner, course, kp). */
export function systemReviewItemId(
  learnerId: string,
  courseCode: string,
  kpCode: string,
): string {
  return `review_item#system#${learnerId}${sep}${courseCode}${sep}${kpCode}`;
}

/** mistakes id — 1:1 per event, keyed by (source_session_id, source_sequence,
 * question_ref). null-safe (does not rely on a partial-unique index). */
export function systemMistakeId(
  sourceSessionId: string,
  sourceSequence: number,
  questionRef: string | null,
): string {
  return `mistake#system#${sourceSessionId}${sep}${sourceSequence}${sep}${questionRef ?? "_"}`;
}

/**
 * Parse the courseCode out of a question id without re-reading the question bank
 * (the applier may only read event payload — design D2). questions.id is
 * `question#${courseCode}:${src}:${questionId}`, so courseCode is the first
 * segment after the `question#` prefix.
 */
export function courseFromQuestionId(questionId: string): string | null {
  const prefix = "question#";
  if (!questionId.startsWith(prefix)) return null;
  const rest = questionId.slice(prefix.length);
  const idx = rest.indexOf(sep);
  if (idx <= 0) return null;
  return rest.slice(0, idx);
}
