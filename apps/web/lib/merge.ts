// Pure read-side merge + today-gating + WVLL predicate (tasks 4.2/4.3/4.6,
// design D7/D10/D11). No DB, no JSX — unit-testable (merge.test.ts).
//
// per-KP projections (KP states, review items) merge imported+system rows into
// ONE display row; per-event mistakes are NOT KP-collapsed (deduped by id only).

export type KpRank = "unseen" | "taught" | "practiced" | "mastered";
const RANK: Record<KpRank, number> = { unseen: 0, taught: 1, practiced: 2, mastered: 3 };

/**
 * per-KP: merge imported+system kp-state rows by MONOTONIC MAX rank (design D7;
 * replaces the old last-wins Map in buildSubject/progressFor).
 */
export function mergeKpStateByMax(
  rows: ReadonlyArray<{ kpCode: string; state: KpRank }>,
): Map<string, KpRank> {
  const out = new Map<string, KpRank>();
  for (const r of rows) {
    const cur = out.get(r.kpCode);
    if (!cur || RANK[r.state] > RANK[cur]) out.set(r.kpCode, r.state);
  }
  return out;
}

export interface ReviewRowLike {
  id: string;
  learnerId: string | null;
  courseCode: string | null;
  kpCode: string;
  origin: string;
  dueDate: string | null;
  adminConfirmedAt?: Date | null;
  lastAppliedAt?: Date | null;
}

export interface MergedReview {
  id: string; // the system-row id when one exists (target for admin confirm)
  learnerId: string | null;
  courseCode: string | null;
  kpCode: string;
  origin: string;
  dueDate: string | null;
  adminConfirmedAt: Date | null;
  lastAppliedAt: Date | null;
}

/** Largest parseable due date string, preserving a legacy due marker if needed. */
export function maxDue(dues: ReadonlyArray<string | null>): string | null {
  let best: string | null = null;
  let bestT = -Infinity;
  let legacyDue: string | null = null;
  for (const d of dues) {
    if (!d) continue;
    const t = Date.parse(d);
    if (Number.isNaN(t)) {
      if (legacyDue === null && d.trim()) legacyDue = d;
      continue;
    }
    if (t <= bestT) continue;
    bestT = t;
    best = d;
  }
  return best ?? legacyDue;
}

/**
 * per-KP: merge review rows by the KP natural key (courseCode, kpCode) — mirrors
 * mergeKpStateByMax. learnerId is dropped from the key (single demo learner, D8)
 * so an imported row with a NULL/divergent learnerId still merges with its system
 * row. When both an imported and a system row exist, the origin=system row wins
 * entirely (its due_date = the new rhythm); imported-only collapses to its max
 * non-null due_date.
 */
export function mergeReviews(rows: ReadonlyArray<ReviewRowLike>): MergedReview[] {
  // courseCode is in the key so two courses sharing a kpCode don't collapse. A
  // null courseCode (imported edge, design D7:49) coalesces to its kp's
  // representative non-null course (system preferred) so it joins that course's
  // row instead of splitting off — distinct non-null courses still stay separate.
  const courseByKp = new Map<string, string>();
  for (const r of rows) {
    if (r.courseCode == null) continue;
    if (!courseByKp.has(r.kpCode) || r.origin === "system") courseByKp.set(r.kpCode, r.courseCode);
  }
  const byKey = new Map<string, ReviewRowLike[]>();
  for (const r of rows) {
    const keyCourse = r.courseCode ?? courseByKp.get(r.kpCode) ?? "";
    const key = `${keyCourse}|${r.kpCode}`;
    const g = byKey.get(key);
    if (g) g.push(r);
    else byKey.set(key, [r]);
  }
  const out: MergedReview[] = [];
  for (const group of byKey.values()) {
    const system = group.find((r) => r.origin === "system");
    const course = system?.courseCode ?? group.find((r) => r.courseCode)?.courseCode ?? null;
    if (system) {
      out.push({
        id: system.id,
        learnerId: system.learnerId,
        courseCode: course,
        kpCode: system.kpCode,
        origin: "system",
        dueDate: system.dueDate,
        adminConfirmedAt: system.adminConfirmedAt ?? null,
        lastAppliedAt: system.lastAppliedAt ?? null,
      });
    } else {
      const first = group[0]!;
      out.push({
        id: first.id,
        learnerId: first.learnerId,
        courseCode: course,
        kpCode: first.kpCode,
        origin: "imported",
        dueDate: maxDue(group.map((r) => r.dueDate)),
        adminConfirmedAt: null,
        lastAppliedAt: null,
      });
    }
  }
  return out;
}

/** due_date ≤ today (calendar day). null-due → not in today list; present but
 * unparseable legacy 待复习 → treated as due (design D7 边角). */
export function isDueOnOrBeforeToday(dueDate: string | null, now: Date = new Date()): boolean {
  if (!dueDate) return false;
  const t = Date.parse(dueDate);
  if (Number.isNaN(t)) return true;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const due = new Date(t);
  const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate()).getTime();
  return dueDay <= today;
}

/** admin gate (design D11): unconfirmed, OR confirmed before a later re-fold
 * advanced last_applied_at past the confirmation (anti-forgetting resurface). */
export function reviewPassesAdminGate(r: {
  adminConfirmedAt: Date | null;
  lastAppliedAt: Date | null;
}): boolean {
  if (!r.adminConfirmedAt) return true;
  if (!r.lastAppliedAt) return false;
  return r.adminConfirmedAt.getTime() < r.lastAppliedAt.getTime();
}

/** 待复习 = due_date ≤ today AND (admin_confirmed_at IS NULL OR < last_applied_at). */
export function isReviewDueToday(r: MergedReview, now?: Date): boolean {
  return isDueOnOrBeforeToday(r.dueDate, now) && reviewPassesAdminGate(r);
}

/** per-event 活跃错题 = admin_confirmed_at IS NULL (never KP-collapsed). */
export function isMistakeActive(m: { adminConfirmedAt?: Date | null }): boolean {
  return !m.adminConfirmedAt;
}

export interface WvllInput {
  /** true only when this transaction performed the ready→consumed transition. */
  readyPacketConsumed: boolean;
  sessionEventCount: number;
  gradedAnswerCount: number;
  /** applier deterministically updated KP/mistake/review for this session. */
  deterministicUpdate: boolean;
}

export interface WvllResult {
  countable: boolean;
  checks: {
    readyPacket: boolean;
    eventsProduced: boolean;
    answerGraded: boolean;
    deterministicUpdate: boolean;
    notQuarantined: boolean;
  };
}

/**
 * WVLL countable predicate, encoding ROADMAP §2 fully (design D10): a completed
 * ready packet/review ∧ session_events produced ∧ ≥1 answer graded ∧
 * deterministic KP/mistake/review update ∧ not quality-failed/quarantine.
 */
export function wvllCountable(i: WvllInput): WvllResult {
  const checks = {
    // must be a true ready→consumed transition in this completion transaction;
    // missing or already-consumed packet rows never count as ready by default.
    readyPacket: i.readyPacketConsumed,
    eventsProduced: i.sessionEventCount > 0,
    answerGraded: i.gradedAnswerCount >= 1,
    deterministicUpdate: i.deterministicUpdate,
    notQuarantined: i.readyPacketConsumed,
  };
  return { countable: Object.values(checks).every(Boolean), checks };
}
