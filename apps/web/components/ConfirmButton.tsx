"use client";

// Admin advisory-confirm affordance (task 5.3). Only rendered on origin=system
// rows; the server action's WHERE origin='system' is the real guard.
import { useState, useTransition } from "react";
import { confirmContent, confirmMistake, confirmReview } from "../lib/confirm-actions";

export function ConfirmButton({ kind, id }: { kind: "review" | "mistake"; id: string }) {
  const [pending, start] = useTransition();
  const [done, setDone] = useState(false);
  if (done) return <span className="text-xs text-green-600">已确认</span>;
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = kind === "review" ? await confirmReview(id) : await confirmMistake(id);
          if (r.ok) setDone(true);
        })
      }
      className="rounded border border-gray-200 px-2 py-0.5 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-40"
    >
      {pending ? "确认中…" : "确认已处理"}
    </button>
  );
}

// Content review confirm (task 5.2). Same affordance, but it UPSERTs an
// admin_confirmations audit row by reference (entityType + entityId) and shows
// the persisted "已确认于 <ts>" — never touches the imported content rows.
export function ContentConfirmButton({
  entityType,
  entityId,
  label,
  confirmedAt,
}: {
  entityType: "question" | "answer" | "kp_link";
  entityId: string;
  label: string;
  confirmedAt?: string | null;
}) {
  const [pending, start] = useTransition();
  const [at, setAt] = useState<string | null>(confirmedAt ?? null);
  return (
    <span className="inline-flex items-center gap-1">
      <span className="text-gray-500">{label}</span>
      {at ? (
        <span className="text-green-600">已确认于 {at}</span>
      ) : (
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await confirmContent(entityType, entityId);
              if (r.ok) setAt(new Date().toISOString().slice(0, 16).replace("T", " "));
            })
          }
          className="rounded border border-gray-200 px-2 py-0.5 text-gray-600 hover:bg-gray-50 disabled:opacity-40"
        >
          {pending ? "确认中…" : "确认"}
        </button>
      )}
    </span>
  );
}
