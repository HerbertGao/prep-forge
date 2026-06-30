// Server-only lesson-packet data-access (tasks 4.1/4.2, 5.1).
//
// DB-first like lib/seed.ts: load the real ready packets (lesson_packets +
// lesson_steps) and resolve each practice step's questions from the question
// bank for display + grading. Falls back to the system sample packet when no DB
// is reachable so `next build`/`dev` work offline (the sample's fake question
// ids simply grade as ungraded — see actions.ts).
import { eq, inArray } from "drizzle-orm";
import { createDb, schema } from "@prep-forge/db";
import type { LessonStep } from "@prep-forge/schemas";
import { SAMPLE_LESSON_PACKET, SAMPLE_QUESTIONS } from "./sampleLessonPacket";
import type { SeedSource } from "./types";

export type PacketQuestionView = {
  id: string;
  stem: string;
  type: string;
  options: { label: string; content: string; isCorrect: boolean | null }[];
  answer: string | null;
  explanation: string | null;
  kpCodes: string[];
  // The confirmed imported rows' OWN ids (admin audit, design D11): the solution
  // row's id and each kp-link row's id. Optional so other PacketQuestionView
  // producers (lib/practice.ts) need not resolve them. Admin confirm writes one
  // admin_confirmations row per concrete row id — never the question id for all.
  solutionId?: string | null;
  kpLinks?: { id: string; kpCode: string }[];
};

export type PacketStepView = {
  id: string;
  type: LessonStep["type"];
  prompt: string | null;
  mdx: string | null;
  math: LessonStep["math"] | null;
  /** resolved per-step KP set (practice steps); empty ⇒ classroom falls back to
   * packet kpCodes for the step_shown payload (design D4 coarse-grained taught). */
  kpCodes: string[];
  questions: PacketQuestionView[];
};

export type PacketView = {
  id: string;
  title: string;
  courseCode: string | null;
  status: string;
  kpCodes: string[];
  objectives: string[];
  steps: PacketStepView[];
};

export type PacketSummary = {
  id: string;
  title: string;
  courseCode: string | null;
  status: string;
  kpCodes: string[];
  stepCount: number;
};

// Packet ids contain `#` and `:` (`lesson_packet#00023:limits-intro`), which
// break Next dynamic-route params even percent-encoded — so the /learn/[lessonId]
// segment carries a base64url slug instead of the raw id.
export function packetSlug(id: string): string {
  return Buffer.from(id, "utf8").toString("base64url");
}

/** Inverse of packetSlug; falls back to the raw param for non-slug ids. */
export function idFromSlug(slug: string): string {
  try {
    const decoded = Buffer.from(slug, "base64url").toString("utf8");
    if (packetSlug(decoded) === slug) return decoded;
  } catch {
    // not a slug
  }
  return slug;
}

/** The system sample packet as a PacketView (offline / no-DB fallback). */
function sampleView(): PacketView {
  const p = SAMPLE_LESSON_PACKET;
  return {
    id: p.id,
    title: p.title,
    courseCode: p.courseCode ?? null,
    status: p.status,
    kpCodes: p.kpCodes,
    objectives: p.objectives ?? [],
    steps: p.steps.map((s) => ({
      id: s.id,
      type: s.type,
      prompt: s.prompt ?? null,
      mdx: s.mdx ?? null,
      math: s.math ?? null,
      kpCodes: [],
      questions: (s.questionIds ?? []).map((qid) => {
        const q = SAMPLE_QUESTIONS[qid];
        return {
          id: qid,
          stem: q?.stem ?? qid,
          type: q?.type ?? "unknown",
          options: (q?.options ?? []).map((o) => ({
            label: o.label,
            content: o.content,
            isCorrect: o.isCorrect ?? null,
          })),
          answer: q?.answer ?? null,
          explanation: q?.explanation ?? null,
          kpCodes: [],
        };
      }),
    })),
  };
}

/** Load one packet (ready or consumed) with resolved questions; null = notFound. */
export async function loadPacket(
  id: string,
): Promise<{ source: SeedSource; packet: PacketView } | null> {
  let db: ReturnType<typeof createDb>;
  try {
    db = createDb();
  } catch {
    return id === SAMPLE_LESSON_PACKET.id ? { source: "fixture", packet: sampleView() } : null;
  }
  try {
    const packetRow = (
      await db.select().from(schema.lessonPackets).where(eq(schema.lessonPackets.id, id)).limit(1)
    )[0];
    // draft/quarantine packets are not learnable.
    if (!packetRow || packetRow.status === "draft" || packetRow.status === "quarantine") {
      return id === SAMPLE_LESSON_PACKET.id ? { source: "fixture", packet: sampleView() } : null;
    }
    const stepRows = await db
      .select()
      .from(schema.lessonSteps)
      .where(eq(schema.lessonSteps.lessonPacketId, id));
    stepRows.sort((a, b) => a.sequence - b.sequence);

    const qIds = [
      ...new Set(
        stepRows.flatMap((s) => ((s.questionIds as string[] | null) ?? []) as string[]),
      ),
    ];
    const [qRows, optRows, solRows, linkRows] = await Promise.all([
      qIds.length
        ? db.select().from(schema.questions).where(inArray(schema.questions.id, qIds))
        : Promise.resolve([]),
      qIds.length
        ? db
            .select()
            .from(schema.questionOptions)
            .where(inArray(schema.questionOptions.questionId, qIds))
        : Promise.resolve([]),
      qIds.length
        ? db
            .select()
            .from(schema.questionSolutions)
            .where(inArray(schema.questionSolutions.questionId, qIds))
        : Promise.resolve([]),
      qIds.length
        ? db
            .select()
            .from(schema.questionKpLinks)
            .where(inArray(schema.questionKpLinks.questionId, qIds))
        : Promise.resolve([]),
    ]);

    const optByQ = new Map<string, { label: string; content: string; isCorrect: boolean | null }[]>();
    for (const o of optRows) {
      const a = optByQ.get(o.questionId) ?? [];
      a.push({ label: o.label, content: o.content, isCorrect: o.isCorrect });
      optByQ.set(o.questionId, a);
    }
    const solByQ = new Map(solRows.map((s) => [s.questionId, s]));
    const kpByQ = new Map<string, string[]>();
    const kpLinksByQ = new Map<string, { id: string; kpCode: string }[]>();
    for (const l of linkRows) {
      const a = kpByQ.get(l.questionId) ?? [];
      a.push(l.kpCode);
      kpByQ.set(l.questionId, a);
      const ls = kpLinksByQ.get(l.questionId) ?? [];
      ls.push({ id: l.id, kpCode: l.kpCode });
      kpLinksByQ.set(l.questionId, ls);
    }
    const qById = new Map(qRows.map((q) => [q.id, q]));

    const steps: PacketStepView[] = stepRows.map((s) => {
      const sqIds = ((s.questionIds as string[] | null) ?? []) as string[];
      const questions = sqIds.map((qid) => {
        const q = qById.get(qid);
        const opts = (optByQ.get(qid) ?? []).sort((a, b) => a.label.localeCompare(b.label));
        const sol = solByQ.get(qid);
        return {
          id: qid,
          stem: q?.stem ?? qid,
          type: q?.type ?? "unknown",
          options: opts,
          answer: sol?.answer ?? null,
          explanation: sol?.explanation ?? null,
          kpCodes: kpByQ.get(qid) ?? [],
          solutionId: sol?.id ?? null,
          kpLinks: kpLinksByQ.get(qid) ?? [],
        };
      });
      const stepKp = [...new Set(questions.flatMap((q) => q.kpCodes))];
      return {
        id: s.id,
        type: s.type,
        prompt: s.prompt,
        mdx: s.mdx,
        math: (s.math as LessonStep["math"] | null) ?? null,
        kpCodes: stepKp,
        questions,
      };
    });

    return {
      source: "db",
      packet: {
        id: packetRow.id,
        title: packetRow.title,
        courseCode: packetRow.courseCode,
        status: packetRow.status,
        kpCodes: (packetRow.kpCodes as string[] | null) ?? [],
        objectives: (packetRow.objectives as string[] | null) ?? [],
        steps,
      },
    };
  } catch (e) {
    console.error("[packets] load failed, falling back to sample:", e);
    return id === SAMPLE_LESSON_PACKET.id ? { source: "fixture", packet: sampleView() } : null;
  }
}

/** Packet summaries for a status filter (dashboard ready list / admin list). */
async function loadSummaries(onlyReady: boolean): Promise<{ source: SeedSource; packets: PacketSummary[] }> {
  try {
    const db = createDb();
    const rows = await db.select().from(schema.lessonPackets);
    const stepCounts = await db
      .select({ id: schema.lessonSteps.lessonPacketId })
      .from(schema.lessonSteps);
    const countById = new Map<string, number>();
    for (const r of stepCounts) countById.set(r.id, (countById.get(r.id) ?? 0) + 1);
    if (rows.length === 0) throw new Error("no packets");
    const packets = rows
      .filter((r) => (onlyReady ? r.status === "ready" : true))
      .map((r) => ({
        id: r.id,
        title: r.title,
        courseCode: r.courseCode,
        status: r.status,
        kpCodes: (r.kpCodes as string[] | null) ?? [],
        stepCount: countById.get(r.id) ?? 0,
      }))
      .sort((a, b) => a.id.localeCompare(b.id));
    return { source: "db", packets };
  } catch (e) {
    console.error("[packets] summary load failed, using sample:", e);
    const p = SAMPLE_LESSON_PACKET;
    return {
      source: "fixture",
      packets: [
        {
          id: p.id,
          title: p.title,
          courseCode: p.courseCode ?? null,
          status: p.status,
          kpCodes: p.kpCodes,
          stepCount: p.steps.length,
        },
      ],
    };
  }
}

/** Ready packets for the dashboard "可学课包" list (task 4.1 entry). */
export const loadReadyPackets = () => loadSummaries(true);

/** All packets for the admin packet list (task 5.1). */
export const loadAllPackets = () => loadSummaries(false);

/** Derived idempotent id for an admin_confirmations row (task 5.2). Re-confirming
 * the same entity upserts under the same id. Reader + writer MUST share this. */
export const confirmId = (entityType: string, entityId: string): string =>
  `confirm#${entityType}:${entityId}`;

/** Content confirmations (task 5.2) keyed by derived id → formatted ts; empty
 * when no DB so the admin page still renders the confirm affordance offline. */
export async function loadContentConfirmations(): Promise<Map<string, string>> {
  try {
    const db = createDb();
    const rows = await db.select().from(schema.adminConfirmations);
    return new Map(
      rows.map((r) => [r.id, r.confirmedAt.toISOString().slice(0, 16).replace("T", " ")]),
    );
  } catch {
    return new Map();
  }
}
