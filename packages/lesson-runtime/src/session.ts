// Lesson session state machine (task 2.2, design D10). Creates a session and
// emits SessionEvents that pass the shared envelope schema, with a monotonic
// `sequence` and a stable `idempotencyKey` per action. step_shown freezes the
// step's `stepType` + covering `kpCodes` so the applier never re-reads the
// lesson/question bank.
//
// The builder only produces validated event envelopes; the web layer (group D)
// persists them and calls the applier. occurredAt is client-supplied (untrusted
// for ordering — the applier orders by server created_at), so the clock is
// injectable for deterministic tests.
import { SessionEvent } from "@prep-forge/schemas";
import type {
  GradedAnswerPayload,
  LessonStep,
  StepShownPayload,
  UngradedAnswerPayload,
} from "@prep-forge/schemas";

export interface SessionContext {
  sessionId: string;
  /** null for free practice opened outside a ready packet (task 4.5). */
  lessonPacketId?: string | null;
  tenantId?: string | null;
  enrollmentId?: string | null;
  /** packet-level KP set — step_shown falls back to this when a step has none. */
  packetKpCodes?: ReadonlyArray<string>;
  /** occurredAt source; defaults to wall clock. */
  now?: () => string;
}

export class LessonSessionBuilder {
  private seq = 0;
  private readonly ctx: Required<Pick<SessionContext, "sessionId">> & SessionContext;
  private readonly now: () => string;

  constructor(ctx: SessionContext) {
    this.ctx = ctx;
    this.now = ctx.now ?? (() => new Date().toISOString());
  }

  /** Current next sequence number (monotonic, starts at 0). */
  get nextSequence(): number {
    return this.seq;
  }

  private emit(
    eventType: SessionEvent["eventType"],
    actorType: SessionEvent["actorType"],
    idempotencyKey: string,
    extra: { stepId?: string | null; payload?: SessionEvent["payload"] } = {},
  ): SessionEvent {
    const seq = this.seq;
    const ev = SessionEvent.parse({
      id: `${this.ctx.sessionId}:evt:${seq}`,
      sessionId: this.ctx.sessionId,
      enrollmentId: this.ctx.enrollmentId ?? null,
      eventType,
      eventVersion: 1,
      sequence: seq,
      actorType,
      idempotencyKey,
      occurredAt: this.now(),
      tenantId: this.ctx.tenantId ?? null,
      lessonPacketId: this.ctx.lessonPacketId ?? null,
      stepId: extra.stepId ?? null,
      payload: extra.payload ?? null,
    });
    this.seq += 1;
    return ev;
  }

  /** lesson_started — no payload (lifecycle event). */
  start(): SessionEvent {
    return this.emit("lesson_started", "student", `${this.ctx.sessionId}:started`);
  }

  /**
   * step_shown — freezes stepType + covering kpCodes. `kpCodes` should be the
   * step's resolved KP set; when empty/omitted it falls back to packetKpCodes
   * (design D4: coarse-grained taught when a step carries no step-level KP).
   */
  showStep(step: Pick<LessonStep, "id" | "type">, kpCodes?: ReadonlyArray<string>): SessionEvent {
    const kp = kpCodes && kpCodes.length > 0 ? kpCodes : (this.ctx.packetKpCodes ?? []);
    const payload: StepShownPayload = { stepType: step.type, kpCodes: [...kp] };
    return this.emit("step_shown", "system", `${this.ctx.sessionId}:step:${step.id}`, {
      stepId: step.id,
      payload,
    });
  }

  /**
   * student_answered — carries the grader's payload (graded|ungraded). The
   * grader (grader.ts) produces the payload at write time; this only envelopes it.
   */
  answer(
    stepId: string | null,
    questionId: string,
    payload: GradedAnswerPayload | UngradedAnswerPayload,
  ): SessionEvent {
    return this.emit("student_answered", "student", `${this.ctx.sessionId}:answer:${stepId ?? "_"}:${questionId}`, {
      stepId,
      payload,
    });
  }

  /** lesson_completed — no payload; the packet ready→consumed move is group D's. */
  complete(): SessionEvent {
    return this.emit("lesson_completed", "system", `${this.ctx.sessionId}:completed`);
  }
}
