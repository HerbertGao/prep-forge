// 验证种子课包 (task 3.3 / spec 场景「种子课包为 ready 且题目引用可解析」「含客观题以产出
// WVLL」)。对每个种子课包断言：(a) lesson_packets.status = ready；(b) 每个 step 引用的
// questionId 都能解析到已导入 questions；(c) 至少一道引用题目是允许清单内客观题——因此完成
// 这节课包至少产出一个 graded 答案，可计入 WVLL。任一断言失败即非零退出。
import { inArray } from "drizzle-orm";
import { type Database, createDb } from "./client";
import {
  OBJECTIVE_QUESTION_TYPES,
  type PacketWithSteps,
  referencedQuestionIds,
  SEED_PACKETS,
} from "./seed-packets";
import { lessonPackets, questionKpLinks, questions } from "./schema";

const OBJECTIVE = new Set<string>(OBJECTIVE_QUESTION_TYPES);

/**
 * Reference checks for ONE packet (extracted so seed verify + the Phase 2 BFF
 * Reference gate share one definition, never a copy): every referenced
 * questionId resolves to a real `questions` row, ≥1 is an allowlisted objective
 * question (so completion yields a graded answer), and each objective question
 * has ≥1 `question_kp_links` row. Returns one failure string per problem,
 * prefixed with the packet id; empty ⇒ refs are sound. The BFF gate layers
 * answer-key + admin_confirmations binding ON TOP of this (those are net-new,
 * see design D5 — verify-packets only ever covered refs + kp_links presence).
 */
export async function checkPacketRefs(db: Database, packet: PacketWithSteps): Promise<string[]> {
  const failures: string[] = [];
  const refIds = referencedQuestionIds(packet);
  const qrows = refIds.length
    ? await db
        .select({ id: questions.id, type: questions.type })
        .from(questions)
        .where(inArray(questions.id, refIds))
    : [];
  const typeById = new Map(qrows.map((q) => [q.id, q.type]));

  const unresolved = refIds.filter((id) => !typeById.has(id));
  if (unresolved.length > 0) {
    failures.push(`${packet.id}: unresolved question refs ${unresolved.join(", ")}`);
  }

  const objectiveIds = refIds.filter((id) => OBJECTIVE.has(typeById.get(id) ?? ""));
  if (objectiveIds.length < 1) {
    failures.push(`${packet.id}: no allowlisted objective question (completion yields no graded answer)`);
  }
  if (objectiveIds.length > 0) {
    const links = await db
      .select({ questionId: questionKpLinks.questionId })
      .from(questionKpLinks)
      .where(inArray(questionKpLinks.questionId, objectiveIds));
    const linkedQuestionIds = new Set(links.map((l) => l.questionId));
    const missingLinks = objectiveIds.filter((id) => !linkedQuestionIds.has(id));
    if (missingLinks.length > 0) {
      failures.push(`${packet.id}: objective questions without question_kp_links ${missingLinks.join(", ")}`);
    }
  }
  return failures;
}

export async function verifyPackets(db: Database): Promise<string[]> {
  const failures: string[] = [];

  const ids = SEED_PACKETS.map((p) => p.id);
  const rows = await db
    .select({ id: lessonPackets.id, status: lessonPackets.status })
    .from(lessonPackets)
    .where(inArray(lessonPackets.id, ids));
  const statusById = new Map(rows.map((r) => [r.id, r.status]));

  for (const packet of SEED_PACKETS) {
    const status = statusById.get(packet.id);
    if (status !== "ready") {
      failures.push(`${packet.id}: status is ${status ?? "MISSING"}, expected ready`);
    }
    failures.push(...(await checkPacketRefs(db, packet)));
  }

  return failures;
}

async function main(): Promise<void> {
  const db = createDb();
  const failures = await verifyPackets(db);
  if (failures.length > 0) {
    console.error("[db:verify-packets] FAILED:");
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log(`[db:verify-packets] OK — ${SEED_PACKETS.length} ready packets, all refs resolve, each has ≥1 linked objective question`);
  process.exit(0);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error("[db:verify-packets] failed:", err);
    process.exit(1);
  });
}
