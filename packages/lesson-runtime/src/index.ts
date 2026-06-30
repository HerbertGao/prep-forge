// @prep-forge/lesson-runtime — Phase 1 deterministic learning-loop core.
//
// Public API (task 2.8) the web server action (group D) calls:
//   - session machine: build validated SessionEvents (LessonSessionBuilder).
//   - grader: objective deterministic grading (gradeAnswer pure / gradeQuestion DB).
//   - pure fold: foldEvents(orderedEvents) -> mutations (DB-free, replay-safe).
//   - DB applier: applyLearnerState / loadFoldEvents / writeMutations.
// The web layer persists an event then calls applyLearnerState in one transaction.
export const LESSON_RUNTIME_PACKAGE = "@prep-forge/lesson-runtime";

export {
  OBJECTIVE_TYPES,
  isObjectiveType,
  gradeAnswer,
  gradeQuestion,
} from "./grader";
export type { QuestionGradingInput } from "./grader";

export { LessonSessionBuilder } from "./session";
export type { SessionContext } from "./session";

export {
  foldEvents,
  MASTERY_THRESHOLD,
  REVIEW_LADDER_DAYS,
  REVIEW_WRONG_DAYS,
} from "./fold";
export type {
  FoldEvent,
  FoldResult,
  KpStateMutation,
  MistakeMutation,
  ReviewMutation,
} from "./fold";

export {
  applyLearnerState,
  loadFoldEvents,
  writeMutations,
  getDemoLearnerId,
  DEMO_LEARNER_FALLBACK,
} from "./applier";

export {
  systemKpStateId,
  systemReviewItemId,
  systemMistakeId,
  courseFromQuestionId,
} from "./ids";
