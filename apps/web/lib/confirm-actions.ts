"use server";

// Admin advisory confirmation (task 5.3, design D11). Writes admin_confirmed_at
// ONLY on origin=system rows — the WHERE origin='system' guard makes it
// structurally impossible to touch an origin=imported history row. The applier
// never writes this column, so resurfacing stays automatic: a later wrong answer
// advances review last_applied_at past the confirm (or creates a new per-event
// mistake row), and the gate (lib/merge.ts) brings the item back.
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { createDb, schema } from "@prep-forge/db";
import { confirmId } from "./packets";

export async function confirmReview(id: string): Promise<{ ok: boolean }> {
  try {
    const db = createDb();
    const updated = await db
      .update(schema.reviewItems)
      .set({ adminConfirmedAt: new Date() })
      .where(and(eq(schema.reviewItems.id, id), eq(schema.reviewItems.origin, "system")))
      .returning({ id: schema.reviewItems.id });
    revalidatePath("/");
    revalidatePath("/admin");
    return { ok: updated.length > 0 };
  } catch (e) {
    console.error("[confirm] review failed:", e);
    return { ok: false };
  }
}

export async function confirmMistake(id: string): Promise<{ ok: boolean }> {
  try {
    const db = createDb();
    const updated = await db
      .update(schema.mistakes)
      .set({ adminConfirmedAt: new Date() })
      .where(and(eq(schema.mistakes.id, id), eq(schema.mistakes.origin, "system")))
      .returning({ id: schema.mistakes.id });
    revalidatePath("/");
    revalidatePath("/admin");
    return { ok: updated.length > 0 };
  } catch (e) {
    console.error("[confirm] mistake failed:", e);
    return { ok: false };
  }
}

// Content review confirmation (task 5.2). Records that a human checked an
// imported question / answer / KP mapping, BY REFERENCE — it verifies the
// referenced row exists, then UPSERTs an admin_confirmations row under the
// derived idempotent id and NEVER writes to questions/question_solutions/
// question_kp_links. Re-confirming refreshes confirmed_at, no dup.
export async function confirmContent(
  entityType: "question" | "answer" | "kp_link",
  entityId: string,
  note?: string,
): Promise<{ ok: boolean }> {
  try {
    const db = createDb();
    const exists =
      entityType === "question"
        ? (
            await db
              .select({ id: schema.questions.id })
              .from(schema.questions)
              .where(eq(schema.questions.id, entityId))
              .limit(1)
          ).length > 0
        : entityType === "answer"
          ? (
              await db
                .select({ id: schema.questionSolutions.id })
                .from(schema.questionSolutions)
                .where(eq(schema.questionSolutions.id, entityId))
                .limit(1)
            ).length > 0
          : (
              await db
                .select({ id: schema.questionKpLinks.id })
                .from(schema.questionKpLinks)
                .where(eq(schema.questionKpLinks.id, entityId))
                .limit(1)
            ).length > 0;
    if (!exists) return { ok: false };

    await db
      .insert(schema.adminConfirmations)
      .values({ id: confirmId(entityType, entityId), entityType, entityId, note: note ?? null })
      .onConflictDoUpdate({
        target: schema.adminConfirmations.id,
        set: { confirmedAt: new Date(), note: note ?? null },
      });
    revalidatePath("/admin");
    return { ok: true };
  } catch (e) {
    console.error("[confirm] content failed:", e);
    return { ok: false };
  }
}
