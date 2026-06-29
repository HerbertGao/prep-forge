// Server-only practice-filter data access (task 4.5, lesson-packet-seed spec).
//
// Filter the imported question bank by course / knowledge point (via
// question_kp_links) / type / 错题 weak-points, ranked by 考频 (KP exam
// frequency). Scoped by course so we never load the whole 13k-question bank.
import { eq, inArray } from "drizzle-orm";
import { createDb, schema } from "@prep-forge/db";
import type { PacketQuestionView } from "./packets";

export type PracticeFilters = {
  courseCode?: string;
  kpCode?: string;
  type?: string;
  mistakes?: boolean;
};

export type PracticeData = {
  source: "db" | "fixture";
  courses: { courseCode: string; name: string }[];
  types: string[];
  kps: { kpCode: string; title: string }[];
  questions: PracticeQuestion[];
};

export type PracticeQuestion = PacketQuestionView & { examFrequency: string | null };

const MAX_RESULTS = 50;

/** ★★★ → 3 for descending 考频 sort; non-star strings rank low. */
function freqRank(f: string | null): number {
  if (!f) return 0;
  const stars = (f.match(/★/g) ?? []).length;
  return stars > 0 ? stars : 0;
}

export async function loadPractice(filters: PracticeFilters): Promise<PracticeData> {
  let db: ReturnType<typeof createDb>;
  try {
    db = createDb();
  } catch {
    return { source: "fixture", courses: [], types: [], kps: [], questions: [] };
  }
  try {
    const courseRows = await db
      .select({ courseCode: schema.courses.courseCode, name: schema.courses.name })
      .from(schema.courses);
    const courses = courseRows.sort((a, b) => a.courseCode.localeCompare(b.courseCode));

    const code = filters.courseCode;
    if (!code) return { source: "db", courses, types: [], kps: [], questions: [] };

    const [qRows, kpRows, linkRows] = await Promise.all([
      db.select().from(schema.questions).where(eq(schema.questions.courseCode, code)),
      db
        .select({ kpCode: schema.knowledgePoints.kpCode, title: schema.knowledgePoints.title, examFrequency: schema.knowledgePoints.examFrequency })
        .from(schema.knowledgePoints)
        .where(eq(schema.knowledgePoints.courseCode, code)),
      db
        .select({ questionId: schema.questionKpLinks.questionId, kpCode: schema.questionKpLinks.kpCode })
        .from(schema.questionKpLinks)
        .where(eq(schema.questionKpLinks.courseCode, code)),
    ]);

    const types = [...new Set(qRows.map((q) => q.type))].sort();
    const kps = kpRows
      .map((k) => ({ kpCode: k.kpCode, title: k.title }))
      .sort((a, b) => a.kpCode.localeCompare(b.kpCode));
    const freqByKp = new Map(kpRows.map((k) => [k.kpCode, k.examFrequency]));

    const kpByQ = new Map<string, string[]>();
    for (const l of linkRows) {
      const a = kpByQ.get(l.questionId) ?? [];
      a.push(l.kpCode);
      kpByQ.set(l.questionId, a);
    }

    // 错题 weak-points: KPs the learner has a mistake on (mistake.questionRef is a
    // placeholder in the import, so KP intersection is the usable signal).
    let mistakeKps: Set<string> | null = null;
    if (filters.mistakes) {
      const ms = await db
        .select({ kpCode: schema.mistakes.kpCode })
        .from(schema.mistakes)
        .where(eq(schema.mistakes.courseCode, code));
      mistakeKps = new Set(ms.map((m) => m.kpCode).filter((k): k is string => Boolean(k)));
    }

    let filtered = qRows;
    if (filters.type) filtered = filtered.filter((q) => q.type === filters.type);
    if (filters.kpCode) filtered = filtered.filter((q) => (kpByQ.get(q.id) ?? []).includes(filters.kpCode!));
    if (mistakeKps) filtered = filtered.filter((q) => (kpByQ.get(q.id) ?? []).some((k) => mistakeKps!.has(k)));

    // best (max) 考频 among a question's KPs, for ranking.
    const qFreq = (id: string): string | null => {
      const codes = kpByQ.get(id) ?? [];
      let best: string | null = null;
      let bestR = -1;
      for (const c of codes) {
        const f = freqByKp.get(c) ?? null;
        if (freqRank(f) > bestR) {
          bestR = freqRank(f);
          best = f;
        }
      }
      return best;
    };
    filtered.sort((a, b) => freqRank(qFreq(b.id)) - freqRank(qFreq(a.id)) || a.id.localeCompare(b.id));
    const top = filtered.slice(0, MAX_RESULTS);

    // resolve options + solutions only for the shown questions.
    const ids = top.map((q) => q.id);
    const [optRows, solRows] = await Promise.all([
      ids.length
        ? db.select().from(schema.questionOptions).where(inArray(schema.questionOptions.questionId, ids))
        : Promise.resolve([]),
      ids.length
        ? db.select().from(schema.questionSolutions).where(inArray(schema.questionSolutions.questionId, ids))
        : Promise.resolve([]),
    ]);
    const optByQ = new Map<string, { label: string; content: string; isCorrect: boolean | null }[]>();
    for (const o of optRows) {
      const a = optByQ.get(o.questionId) ?? [];
      a.push({ label: o.label, content: o.content, isCorrect: o.isCorrect });
      optByQ.set(o.questionId, a);
    }
    const solByQ = new Map(solRows.map((s) => [s.questionId, s]));

    const questions: PracticeQuestion[] = top.map((q) => ({
      id: q.id,
      stem: q.stem,
      type: q.type,
      options: (optByQ.get(q.id) ?? []).sort((a, b) => a.label.localeCompare(b.label)),
      answer: solByQ.get(q.id)?.answer ?? null,
      explanation: solByQ.get(q.id)?.explanation ?? null,
      kpCodes: kpByQ.get(q.id) ?? [],
      examFrequency: qFreq(q.id),
    }));

    return { source: "db", courses, types, kps, questions };
  } catch (e) {
    console.error("[practice] load failed:", e);
    return { source: "fixture", courses: [], types: [], kps: [], questions: [] };
  }
}
