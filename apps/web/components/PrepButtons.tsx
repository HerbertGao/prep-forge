"use client";

// Admin prep affordances (group G7). Each button drives one "use server" action
// and shows its result inline; the action revalidates /admin so the server
// re-renders the job table / draft list with fresh state.
import { useState, useTransition } from "react";
import {
  confirmDraftReadyAction,
  generateDraftAction,
  revalidateJobAction,
} from "../app/admin/prep-actions";

export function GenerateDraftButton({ kpCode }: { kpCode: string }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await generateDraftAction(kpCode);
            setMsg(r.ok ? `job ${r.job?.status}` : `失败：${r.error ?? "?"}`);
          })
        }
        className="rounded border border-gray-200 px-2 py-0.5 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-40"
      >
        {pending ? "生成中…" : "生成草包"}
      </button>
      {msg && <span className="text-xs text-gray-500">{msg}</span>}
    </span>
  );
}

export function RevalidateJobButton({ jobId }: { jobId: string }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await revalidateJobAction(jobId);
            setMsg(r.ok ? `→ ${r.job?.status}` : `失败：${r.error ?? "?"}`);
          })
        }
        className="rounded border border-amber-200 px-2 py-0.5 text-xs text-amber-700 hover:bg-amber-50 disabled:opacity-40"
      >
        {pending ? "校验中…" : "重新校验"}
      </button>
      {msg && <span className="text-xs text-gray-500">{msg}</span>}
    </span>
  );
}

export function ConfirmDraftButton({ lessonPacketId }: { lessonPacketId: string }) {
  const [pending, start] = useTransition();
  const [done, setDone] = useState(false);
  if (done) return <span className="text-xs text-green-600">已上线（ready）</span>;
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await confirmDraftReadyAction(lessonPacketId);
          if (r.ok) setDone(true);
        })
      }
      className="rounded border border-green-200 px-2 py-0.5 text-xs text-green-700 hover:bg-green-50 disabled:opacity-40"
    >
      {pending ? "确认中…" : "确认上线"}
    </button>
  );
}
