"use server";

// Admin-triggered prep actions (group G7, design D3/D11). Thin "use server"
// wrappers over lib/prep — they revalidate /admin so the job table + draft list
// reflect the new state. No user auth this phase (D10: admin BFF entries share
// the worker's private-network constraint until Phase 4).
import { revalidatePath } from "next/cache";
import { confirmDraftReady, generateDraftForKp, type JobView, reconcileJob } from "../../lib/prep";

export async function generateDraftAction(
  kpCode: string,
): Promise<{ ok: boolean; job?: JobView; error?: string }> {
  try {
    const job = await generateDraftForKp(kpCode);
    revalidatePath("/admin");
    return { ok: true, job };
  } catch (e) {
    console.error("[prep-actions] generate failed:", e);
    return { ok: false, error: String((e as Error)?.message ?? e) };
  }
}

export async function revalidateJobAction(
  jobId: string,
): Promise<{ ok: boolean; job?: JobView; error?: string }> {
  try {
    const job = await reconcileJob(jobId);
    revalidatePath("/admin");
    return { ok: true, job };
  } catch (e) {
    console.error("[prep-actions] revalidate failed:", e);
    return { ok: false, error: String((e as Error)?.message ?? e) };
  }
}

export async function confirmDraftReadyAction(
  lessonPacketId: string,
): Promise<{ ok: boolean; error?: string }> {
  const r = await confirmDraftReady(lessonPacketId);
  revalidatePath("/admin");
  revalidatePath("/");
  return r.ok ? r : { ok: false, error: "确认上线失败，请刷新后重试。" };
}
