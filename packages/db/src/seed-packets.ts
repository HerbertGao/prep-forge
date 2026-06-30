// 手工种子 ready 课包 (设计决策 D6) — 确定性手工编写的 LessonPacket fixture，
// 绝非 AI 生成（生成属 Phase 2）。每个课包 origin=system / status=ready，
// lesson_steps.questionIds 存完整派生 id `question#course:src:questionId`（不存裸
// questionId），且至少含一道允许清单内客观题，完成它才产得出 graded 答案、计入 WVLL。
//
// 写入前过 LessonPacket Zod 校验 + 把每个引用解析到真实 questions 表；引用无法解析的
// 课包禁止写 ready（置 quarantine 并记录原因）。有效课包按派生 id 幂等写入，re-seed
// 重置 lesson_packets.status。
import { LessonPacket } from "@prep-forge/schemas";
import { eq, inArray } from "drizzle-orm";
import { type Database, createDb } from "./client";
import { lessonPackets, lessonSteps, questions } from "./schema";

/**
 * 客观题允许清单的单一事实来源 = @prep-forge/schemas 的 OBJECTIVE_QUESTION_TYPES。
 * 在此 re-export 供 verify-packets 使用，杜绝两处字面量漂移（否则一个 packet 可能过 verify
 * 却永远判不了分）。清单内容：单选三个 Unicode 变体 + 多选题，无「判断题」。
 */
export { OBJECTIVE_QUESTION_TYPES } from "@prep-forge/schemas";

const packetId = (key: string): string => `lesson_packet#${key}`;
const stepId = (key: string, seq: number): string => `lesson_step#${key}:${seq}`;

/**
 * 三个确定性课包：高数(00023) ×1、操作系统(13180) ×2。每个课包的 practice 步引用真实
 * 客观题（派生 id），其 kpCodes 经 question_kp_links 与所引题目对齐。
 */
export const SEED_PACKETS: LessonPacket[] = [
  LessonPacket.parse({
    id: packetId("00023:limits-intro"),
    origin: "system",
    visibility: "public",
    version: 1,
    status: "ready",
    courseCode: "00023",
    title: "高等数学（一）· 极限与连续入门",
    kpCodes: ["AM01-05", "AM01-07"],
    objectives: ["理解函数极限的直观含义", "掌握用极限定义判断连续性"],
    steps: [
      {
        id: stepId("00023:limits-intro", 1),
        type: "explanation",
        prompt: "什么是函数的极限？",
        mdx: "极限刻画自变量趋近某点时函数值的逼近趋势，是微积分的基石。",
      },
      {
        id: stepId("00023:limits-intro", 2),
        type: "worked_example",
        prompt: "用极限的定义分析一个分段函数在分界点的连续性。",
        mdx: "先求左右极限，再与函数值比较：三者相等即连续。",
      },
      {
        id: stepId("00023:limits-intro", 3),
        type: "practice",
        prompt: "完成下列单选题，巩固极限与连续。",
        questionIds: [
          "question#00023:2006年10月真题:Q-01-167",
          "question#00023:2006年10月真题:Q-01-168",
        ],
      },
    ],
  }),
  LessonPacket.parse({
    id: packetId("13180:os-intro"),
    origin: "system",
    visibility: "public",
    version: 1,
    status: "ready",
    courseCode: "13180",
    title: "操作系统 · 操作系统引论",
    kpCodes: ["OS01-02", "OS01-03"],
    objectives: ["理解操作系统的定义与目标", "区分操作系统的基本特征"],
    steps: [
      {
        id: stepId("13180:os-intro", 1),
        type: "explanation",
        prompt: "操作系统在计算机系统中扮演什么角色？",
        mdx: "操作系统是管理硬件资源、为用户与程序提供服务的系统软件。",
      },
      {
        id: stepId("13180:os-intro", 2),
        type: "practice",
        prompt: "完成下列单选题，检验对操作系统基本概念的掌握。",
        questionIds: [
          "question#13180:2004年4月真题:Q-01-001",
          "question#13180:2004年4月真题:Q-01-002",
        ],
      },
    ],
  }),
  LessonPacket.parse({
    id: packetId("13180:process-and-scheduling"),
    origin: "system",
    visibility: "public",
    version: 1,
    status: "ready",
    courseCode: "13180",
    title: "操作系统 · 进程与处理机调度",
    kpCodes: ["OS02-07", "OS03-01"],
    objectives: ["理解进程的状态转换", "掌握常见处理机调度算法的特点"],
    steps: [
      {
        id: stepId("13180:process-and-scheduling", 1),
        type: "explanation",
        prompt: "进程与处理机调度之间是什么关系？",
        mdx: "调度器在就绪进程间分配处理机，调度策略直接影响系统吞吐与响应。",
      },
      {
        id: stepId("13180:process-and-scheduling", 2),
        type: "practice",
        prompt: "完成下列单选题，巩固进程与调度。",
        questionIds: [
          "question#13180:2004年4月真题:Q-02-001",
          "question#13180:2004年4月真题:Q-03-001",
        ],
      },
    ],
  }),
];

export type SeedPacketsResult = {
  ready: number;
  quarantined: number;
  issues: string[];
};

const referencedQuestionIds = (packet: LessonPacket): string[] =>
  packet.steps.flatMap((s) => s.questionIds ?? []);

/**
 * Resolve every referenced questionId against the real questions table, then
 * upsert each packet idempotently by derived id. Unresolved refs → status
 * quarantine (never written as ready); resolvable → ready. The packet upsert
 * always overwrites status, so re-seed resets a previously-consumed packet.
 */
export async function seedPackets(db: Database): Promise<SeedPacketsResult> {
  const result: SeedPacketsResult = { ready: 0, quarantined: 0, issues: [] };

  for (const packet of SEED_PACKETS) {
    const refIds = referencedQuestionIds(packet);
    const found = refIds.length
      ? new Set(
          (
            await db
              .select({ id: questions.id })
              .from(questions)
              .where(inArray(questions.id, refIds))
          ).map((r) => r.id),
        )
      : new Set<string>();
    const unresolved = refIds.filter((id) => !found.has(id));
    const status = unresolved.length > 0 ? ("quarantine" as const) : ("ready" as const);

    const { id, steps, ...rest } = packet;
    const packetRow = { id, ...rest, status };
    const { id: _omitId, ...packetSet } = packetRow;

    await db.transaction(async (tx) => {
      await tx
        .insert(lessonPackets)
        .values(packetRow)
        .onConflictDoUpdate({ target: lessonPackets.id, set: packetSet });
      // ponytail: upsert steps by stable id — no delete pass; hand-authored
      // fixtures never drop steps, so stale-step cleanup isn't needed. Add a
      // delete-by-packet pass here if a future fixture removes a step.
      for (const [i, step] of steps.entries()) {
        const stepRow = {
          id: step.id,
          lessonPacketId: id,
          sequence: i + 1,
          type: step.type,
          prompt: step.prompt ?? null,
          mdx: step.mdx ?? null,
          math: step.math ?? null,
          questionIds: step.questionIds ?? null,
        };
        const { id: _omitStepId, ...stepSet } = stepRow;
        await tx
          .insert(lessonSteps)
          .values(stepRow)
          .onConflictDoUpdate({ target: lessonSteps.id, set: stepSet });
      }
    });

    if (status === "quarantine") {
      result.quarantined += 1;
      result.issues.push(`packet ${id} quarantined: unresolved refs ${unresolved.join(", ")}`);
    } else {
      result.ready += 1;
    }
  }

  return result;
}

async function main(): Promise<void> {
  const db = createDb();
  const r = await seedPackets(db);
  console.log(`[db:seed-packets] ready=${r.ready} quarantined=${r.quarantined}`);
  for (const issue of r.issues) console.warn(`[db:seed-packets] ${issue}`);
  process.exit(0);
}

// Run only when invoked directly (tsx src/seed-packets.ts), not when imported.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error("[db:seed-packets] failed:", err);
    process.exit(1);
  });
}
