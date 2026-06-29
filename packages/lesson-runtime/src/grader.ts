// Objective-question grader (task 2.3, design D3). Deterministic, no LLM.
//
// Routes by Question.type against the allowlist from the real snapshot (design
// "Apply 调查记录" task 1.1): 单选 has THREE Unicode variants, plus 多选题; there
// is NO 判断题 in the data. Objective → compare submitted labels to the answer
// key (question_options.isCorrect preferred, else question_solutions.answer).
// Subjective/unknown → ungraded (never a fabricated score).
import { eq } from "drizzle-orm";
import { schema } from "@prep-forge/db";
import type { Database } from "@prep-forge/db";
import { OBJECTIVE_QUESTION_TYPES } from "@prep-forge/schemas";
import type {
  GradedAnswerPayload,
  GradingResult,
  UngradedAnswerPayload,
} from "@prep-forge/schemas";

/** The objective-type allowlist — single source of truth in @prep-forge/schemas. */
export const OBJECTIVE_TYPES = OBJECTIVE_QUESTION_TYPES;

export function isObjectiveType(type: string): boolean {
  return OBJECTIVE_TYPES.has(type.trim());
}

export interface QuestionGradingInput {
  /** the question's canonical id (`question#...`). */
  questionId: string;
  type: string;
  options: ReadonlyArray<{ label: string; isCorrect: boolean | null }>;
  /** question_solutions.answer; null when no solution row exists. */
  solutionAnswer: string | null;
  /** resolved from question_kp_links. */
  kpCodes: ReadonlyArray<string>;
}

// ponytail: option labels are single letters (A/B/C…) in the real snapshot;
// extract A–Z and compare as sets. Upgrade if non-letter labels ever appear.
function lettersOf(s: string): Set<string> {
  return new Set(s.toUpperCase().match(/[A-Z]/g) ?? []);
}

// Solution prose can contain English words ("B (correct)") after the actual
// label; only parse the leading label run, while keeping common "A、B" / "AB".
function leadingSolutionLetters(s: string): Set<string> {
  const labelRun = s.trim().toUpperCase().match(/^[A-Z](?:[A-Z]|\s*[、,，/|;；]\s*[A-Z])*/)?.[0] ?? "";
  return lettersOf(labelRun);
}

function submittedLabelSet(submitted: string | ReadonlyArray<string>): Set<string> {
  const out = new Set<string>();
  const items = Array.isArray(submitted) ? submitted : [submitted as string];
  for (const item of items) for (const l of lettersOf(item)) out.add(l);
  return out;
}

/** The authoritative correct-label set, or null when no answer key is available. */
function correctLabelSet(q: QuestionGradingInput): Set<string> | null {
  const known = q.options.filter((o) => o.isCorrect !== null);
  if (known.length > 0) {
    // Normalize option labels through the SAME lettersOf extractor the submitted
    // and solution sides use — otherwise "A." / "(A)" never matches a submitted "A".
    const out = new Set<string>();
    for (const o of q.options) {
      if (o.isCorrect === true) for (const l of lettersOf(o.label)) out.add(l);
    }
    return out;
  }
  if (q.solutionAnswer && q.solutionAnswer.trim()) {
    return leadingSolutionLetters(q.solutionAnswer);
  }
  return null;
}

function sameSet(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

/**
 * Pure grader: payload variant only, no DB. Objective → graded; subjective /
 * unknown / no-answer-key → ungraded (never fabricates a score).
 */
export function gradeAnswer(
  q: QuestionGradingInput,
  submitted: string | ReadonlyArray<string>,
): GradedAnswerPayload | UngradedAnswerPayload {
  const resolvedKpCodes = [...q.kpCodes];
  if (!isObjectiveType(q.type)) {
    return { kind: "ungraded", reason: `unsupported question type: ${q.type}`, resolvedKpCodes };
  }
  const correct = correctLabelSet(q);
  if (!correct) {
    return {
      kind: "ungraded",
      reason: "no answer key (no option.isCorrect and no solution)",
      resolvedKpCodes,
    };
  }
  if (correct.size === 0) {
    // populated answer key but no correct label (all-false options / a solution
    // with no A–Z letters) → no real key; ungraded, never a fabricated wrong verdict.
    return {
      kind: "ungraded",
      reason: "answer key resolved to no correct label",
      resolvedKpCodes,
    };
  }
  const isCorrect = sameSet(correct, submittedLabelSet(submitted));
  const gradingResult: GradingResult = {
    questionId: q.questionId,
    kpCode: q.kpCodes[0] ?? null,
    score: isCorrect ? 1 : 0,
    correct: isCorrect,
    modelCallId: null,
  };
  return { kind: "graded", gradingResult, resolvedKpCodes, modelCallId: null };
}

/**
 * DB-backed entry the web layer calls at event-write time: fetch the question +
 * options + solution + kp links, then grade purely. Reading the question bank is
 * the GRADER's job (the applier is what must not re-read it).
 */
export async function gradeQuestion(
  db: Database,
  questionId: string,
  submitted: string | ReadonlyArray<string>,
): Promise<GradedAnswerPayload | UngradedAnswerPayload> {
  const q = (
    await db
      .select({ type: schema.questions.type })
      .from(schema.questions)
      .where(eq(schema.questions.id, questionId))
      .limit(1)
  )[0];
  const links = await db
    .select({ kpCode: schema.questionKpLinks.kpCode })
    .from(schema.questionKpLinks)
    .where(eq(schema.questionKpLinks.questionId, questionId));
  const kpCodes = links.map((l) => l.kpCode);
  if (!q) {
    return { kind: "ungraded", reason: `question not found: ${questionId}`, resolvedKpCodes: kpCodes };
  }
  const options = await db
    .select({ label: schema.questionOptions.label, isCorrect: schema.questionOptions.isCorrect })
    .from(schema.questionOptions)
    .where(eq(schema.questionOptions.questionId, questionId));
  const sol = (
    await db
      .select({ answer: schema.questionSolutions.answer })
      .from(schema.questionSolutions)
      .where(eq(schema.questionSolutions.questionId, questionId))
      .limit(1)
  )[0];
  return gradeAnswer(
    { questionId, type: q.type, options, solutionAnswer: sol?.answer ?? null, kpCodes },
    submitted,
  );
}
