"""Single-KP draft generation (G6, D7/D9).

The thin-trunk generate path:
  1. read the KP's REAL objective questions (questions + options + kp_links) as
     `prep_worker` and pin ≥1 as the practice step — the worker NEVER lets the
     model choose which questions are referenced (anti-hallucination: the model
     writes prose, the worker pins the refs);
  2. build a grounding prompt and call Claude via the G5 ModelGateway;
  3. parse the (possibly non-strict) model JSON into teaching steps — robustly,
     raising on garbage so a half-baked packet never reaches the DB;
  4. assemble a LessonPacket with derived ids (`lesson_packet#prep:<jobId>` /
     `lesson_step#prep:<jobId>:<seq>`), validate it against the contract, then
  5. write the artifact in ONE tx holding `pg_advisory_xact_lock(hashtext(jobId))`
     (D4): upsert packet (`origin='ai_generated' status='validating'`, past the
     G3 triggers) → delete-pass stale steps → upsert steps → generation_sources
     + content_hash.

The worker does NOT verify "confirmed" (no admin_confirmations read — that's the
BFF Reference gate, D5) and never touches prep_jobs (D10). Failure / guardrail →
raise; the BFF then sets prep_jobs=failed.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from hashlib import sha256

from pydantic import ValidationError

from ai_worker.contracts import PrepGenerateRequest, PrepGenerateResult

# Worker-owned prompt version (the request carries no prompt_version; BFF's
# active-job dedup key is its own concern). Bumped when the prompt changes.
PROMPT_VERSION = "prep-gen-v1"
TASK_TYPE = "prep_generate"

# Pin at most this many real objective questions into the practice step.
MAX_PRACTICE_QUESTIONS = 2

# Teaching step types the model may emit; anything else (incl. practice /
# math_block) is coerced to explanation — the worker owns the practice step and
# the thin trunk emits no math (math gate would quarantine it anyway, D5).
_TEACHING_TYPES = frozenset(
    {"explanation", "worked_example", "hint", "summary", "socratic_question", "diagnostic_question"}
)


class GenerationError(Exception):
    """Generation could not produce a valid packet → raise; BFF sets failed."""

    def __init__(self, kind: str, detail: str = "") -> None:
        super().__init__(f"{kind}: {detail}")
        self.kind = kind


@dataclass(frozen=True)
class _Question:
    id: str
    type: str
    stem: str
    course_code: str


def _packet_id(job_id: str) -> str:
    return f"lesson_packet#prep:{job_id}"


def _step_id(job_id: str, seq: int) -> str:
    return f"lesson_step#prep:{job_id}:{seq}"


def _j(value: object) -> str | None:
    """jsonb bind: JSON-encode a present value, leave None as SQL NULL."""
    return json.dumps(value, ensure_ascii=False) if value is not None else None


# --- 1. read real objective questions for the KP -------------------------------

# "Objective" = has a resolvable answer key (an option with is_correct=true).
# This is the property the BFF Reference gate (grader.correctLabelSet) actually
# checks, and it deliberately avoids hand-copying OBJECTIVE_QUESTION_TYPES into
# Python (contract-drift rule, spec §"contracts"). A slightly-imperfect pick is
# safe: the BFF hard gate is the wall — a bad pick just quarantines.
_KP_QUESTIONS_SQL = """
SELECT q.id AS id, q.type AS type, q.stem AS stem, q.course_code AS course_code
FROM question_kp_links kl
JOIN questions q ON q.id = kl.question_id
WHERE kl.kp_code = $1
  AND kl.origin = 'imported'
  AND q.origin = 'imported'
  AND EXISTS (
    SELECT 1 FROM question_options o
    WHERE o.question_id = q.id AND o.origin = 'imported' AND o.is_correct IS TRUE
  )
ORDER BY q.id
LIMIT $2
"""

_OPTIONS_SQL = """
SELECT question_id, label, content
FROM question_options
WHERE question_id = ANY($1::text[])
  AND origin = 'imported'
ORDER BY question_id, label
"""


async def _load_kp_questions(pool, kp_code: str) -> list[_Question]:
    async with pool.acquire() as conn:
        rows = await conn.fetch(_KP_QUESTIONS_SQL, kp_code, MAX_PRACTICE_QUESTIONS)
    return [
        _Question(id=r["id"], type=r["type"], stem=r["stem"], course_code=r["course_code"])
        for r in rows
    ]


async def _load_options(pool, question_ids: list[str]) -> dict[str, list[tuple[str, str]]]:
    async with pool.acquire() as conn:
        rows = await conn.fetch(_OPTIONS_SQL, question_ids)
    by_q: dict[str, list[tuple[str, str]]] = {}
    for r in rows:
        by_q.setdefault(r["question_id"], []).append((r["label"], r["content"]))
    return by_q


# --- 2. grounding prompt -------------------------------------------------------


def _build_prompt(
    kp_code: str, questions: list[_Question], options: dict[str, list[tuple[str, str]]]
) -> str:
    blocks: list[str] = []
    for q in questions:
        opt_lines = "\n".join(f"{label}. {content}" for label, content in options.get(q.id, []))
        blocks.append(f"题目：{q.stem}\n选项：\n{opt_lines}")
    course_code = questions[0].course_code
    questions_text = "\n\n".join(blocks)
    # Answer keys are deliberately withheld from the prompt — teach the concept,
    # never reveal which option is correct.
    return (
        "你是一名学科备课助手。请根据知识点和真实练习题，生成结构化的讲解课包内容。\n\n"
        f"知识点编码：{kp_code}\n课程编码：{course_code}\n\n"
        "学习者随后将练习以下真实题目（不要复述题目，也不要透露答案，只围绕考点讲解）：\n"
        f"{questions_text}\n\n"
        "要求：\n"
        "1. 生成 2-4 个讲解步骤，type 仅限 explanation / worked_example / hint / summary。\n"
        "2. 每步含简体中文 prompt（一句引导问题）与 mdx（讲解正文，纯文本，"
        "禁止 LaTeX、公式、$ 符号、HTML 标签）。\n"
        "3. 只返回 JSON，结构如下，不要任何额外说明或代码围栏：\n"
        '{"title": "课包标题", "objectives": ["目标1"], '
        '"steps": [{"type": "explanation", "prompt": "...", "mdx": "..."}]}'
    )


# --- 3. robust model-output parsing -------------------------------------------


def _extract_json(text: str) -> dict:
    text = (text or "").strip()
    if not text:
        raise GenerationError("bad_model_json", "empty model output")
    # Strip a ```json ... ``` fence if present.
    if text.startswith("```"):
        fence_end = text.rfind("```")
        inner = text[text.find("\n") + 1 : fence_end] if fence_end > 0 else text
        text = inner.strip()
    try:
        data = json.loads(text)
    except (ValueError, TypeError):
        # Fall back to the first {...} span (model wrapped JSON in prose).
        start, end = text.find("{"), text.rfind("}")
        if start < 0 or end <= start:
            raise GenerationError("bad_model_json", "no JSON object in model output")
        try:
            data = json.loads(text[start : end + 1])
        except (ValueError, TypeError) as exc:
            raise GenerationError("bad_model_json", "model output not parseable as JSON") from exc
    if not isinstance(data, dict):
        raise GenerationError("bad_model_json", "model JSON is not an object")
    return data


def _parse_teaching_steps(data: dict) -> tuple[str | None, list[str] | None, list[dict]]:
    raw_steps = data.get("steps")
    if not isinstance(raw_steps, list) or not raw_steps:
        raise GenerationError("bad_model_json", "missing non-empty steps[]")
    steps: list[dict] = []
    for raw in raw_steps:
        if not isinstance(raw, dict):
            continue
        step_type = raw.get("type")
        if step_type not in _TEACHING_TYPES:
            step_type = "explanation"
        prompt = raw.get("prompt") if isinstance(raw.get("prompt"), str) else None
        mdx = raw.get("mdx") if isinstance(raw.get("mdx"), str) else None
        if not (prompt and prompt.strip()) and not (mdx and mdx.strip()):
            continue  # a step with no text carries nothing
        steps.append({"type": step_type, "prompt": prompt, "mdx": mdx})
    if not steps:
        raise GenerationError("bad_model_json", "no usable teaching step in model output")

    title = data.get("title")
    title = title.strip() if isinstance(title, str) and title.strip() else None
    raw_obj = data.get("objectives")
    objectives = (
        [o.strip() for o in raw_obj if isinstance(o, str) and o.strip()]
        if isinstance(raw_obj, list)
        else None
    )
    return title, (objectives or None), steps


# --- 4. assemble + 5. write artifact ------------------------------------------

_UPSERT_PACKET_SQL = """
INSERT INTO lesson_packets (
    id, origin, visibility, version, status, subject_code, course_code,
    title, kp_codes, prerequisites, estimated_minutes, difficulty, objectives,
    generation_sources, source_block_id, content_hash
) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11, $12, $13::jsonb,
    $14::jsonb, $15, $16
)
ON CONFLICT (id) DO UPDATE SET
    origin = EXCLUDED.origin, visibility = EXCLUDED.visibility,
    version = EXCLUDED.version, status = EXCLUDED.status,
    subject_code = EXCLUDED.subject_code, course_code = EXCLUDED.course_code,
    title = EXCLUDED.title, kp_codes = EXCLUDED.kp_codes,
    prerequisites = EXCLUDED.prerequisites, estimated_minutes = EXCLUDED.estimated_minutes,
    difficulty = EXCLUDED.difficulty, objectives = EXCLUDED.objectives,
    generation_sources = EXCLUDED.generation_sources,
    source_block_id = EXCLUDED.source_block_id, content_hash = EXCLUDED.content_hash
"""

# Delete steps of THIS packet not in the current set (retry with fewer steps must
# not leave stale rows). OLD parent = our validating packet → past the trigger.
_DELETE_STALE_STEPS_SQL = """
DELETE FROM lesson_steps WHERE lesson_packet_id = $1 AND id <> ALL($2::text[])
"""

_UPSERT_STEP_SQL = """
INSERT INTO lesson_steps (id, lesson_packet_id, sequence, type, prompt, mdx, math, question_ids)
VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb)
ON CONFLICT (id) DO UPDATE SET
    lesson_packet_id = EXCLUDED.lesson_packet_id, sequence = EXCLUDED.sequence,
    type = EXCLUDED.type, prompt = EXCLUDED.prompt, mdx = EXCLUDED.mdx,
    math = EXCLUDED.math, question_ids = EXCLUDED.question_ids
"""


def _content_hash(packet: dict) -> str:
    canonical = json.dumps(
        {
            "title": packet["title"],
            "kpCodes": packet["kpCodes"],
            "steps": [
                {
                    "id": s["id"],
                    "type": s["type"],
                    "prompt": s.get("prompt"),
                    "mdx": s.get("mdx"),
                    "questionIds": s.get("questionIds"),
                }
                for s in packet["steps"]
            ],
        },
        ensure_ascii=False,
        sort_keys=True,
    )
    return sha256(canonical.encode()).hexdigest()


async def _write_artifact(pool, job_id: str, packet: dict, sources: list[dict]) -> None:
    keep_ids = [s["id"] for s in packet["steps"]]
    async with pool.acquire() as conn:
        async with conn.transaction():
            # D4: serialize concurrent re-calls of the same job; held for the tx.
            await conn.execute("SELECT pg_advisory_xact_lock(hashtext($1::text))", job_id)
            # Packet first — the lesson_steps trigger looks up the parent (NOT
            # FOUND → RAISE), so it must already exist as ai_generated+validating.
            await conn.execute(
                _UPSERT_PACKET_SQL,
                packet["id"],
                packet["origin"],
                packet["visibility"],
                packet["version"],
                packet["status"],
                packet.get("subjectCode"),
                packet.get("courseCode"),
                packet["title"],
                _j(packet["kpCodes"]),
                _j(packet.get("prerequisites")),
                packet.get("estimatedMinutes"),
                packet.get("difficulty"),
                _j(packet.get("objectives")),
                _j(sources),  # generation_sources jsonb column (D9, audit-only)
                packet.get("sourceBlockId"),
                packet.get("contentHash"),
            )
            await conn.execute(_DELETE_STALE_STEPS_SQL, packet["id"], keep_ids)
            for seq, step in enumerate(packet["steps"], start=1):
                await conn.execute(
                    _UPSERT_STEP_SQL,
                    step["id"],
                    packet["id"],
                    seq,
                    step["type"],
                    step.get("prompt"),
                    step.get("mdx"),
                    _j(step.get("math")),
                    _j(step.get("questionIds")),
                )


async def generate_prep_packet(pool, gateway, req: PrepGenerateRequest) -> PrepGenerateResult:
    job_id = req.jobId
    packet_id = _packet_id(job_id)

    questions = await _load_kp_questions(pool, req.kpCode)
    if not questions:
        raise GenerationError("no_objective_questions", f"kp {req.kpCode} has no answerable question")
    options = await _load_options(pool, [q.id for q in questions])

    prompt = _build_prompt(req.kpCode, questions, options)
    call = await gateway.call(
        prep_job_id=job_id,
        task_type=TASK_TYPE,
        prompt=prompt,
        prompt_version=PROMPT_VERSION,
        lesson_packet_id=packet_id,
    )

    title, objectives, teaching = _parse_teaching_steps(_extract_json(call.text))

    steps: list[dict] = []
    for i, t in enumerate(teaching, start=1):
        steps.append(
            {"id": _step_id(job_id, i), "type": t["type"], "prompt": t["prompt"], "mdx": t["mdx"]}
        )
    # Worker-pinned practice step — references ONLY the real questions we picked.
    steps.append(
        {
            "id": _step_id(job_id, len(teaching) + 1),
            "type": "practice",
            "prompt": "完成下列练习题，巩固本知识点。",
            "questionIds": [q.id for q in questions],
        }
    )

    # generation_sources (D9): structured, audit-only. The BFF confirmation gate
    # binds to the actually-resolved questionId/solution/kp_link, NOT this field.
    sources = [
        {
            "sourceType": "question",
            "sourceId": q.id,
            "modelCallIds": [call.model_call_id],
            "promptVersion": PROMPT_VERSION,
        }
        for q in questions
    ]

    # NB: generationSources is NOT a LessonPacket field (it lives on the envelope
    # + the lesson_packets.generation_sources column) — keep it off this dict so
    # the contract's extra='forbid' passes.
    packet: dict = {
        "id": packet_id,
        "origin": "ai_generated",
        "visibility": "public",
        "version": 1,
        "status": "validating",
        "courseCode": questions[0].course_code,
        "title": title or f"知识点 {req.kpCode} · AI 草稿",
        "kpCodes": [req.kpCode],
        "objectives": objectives,
        "steps": steps,
    }
    packet["contentHash"] = _content_hash(packet)

    # Validate against the contract BEFORE any DB write — a malformed packet must
    # never hit lesson_packets (raise, don't persist a half-baked draft).
    try:
        result = PrepGenerateResult(
            schemaVersion="1",
            tenantId=req.tenantId,
            jobId=job_id,
            lessonPacket=packet,  # type: ignore[arg-type]  # pydantic coerces the dict
            generationSources=sources,  # type: ignore[arg-type]  # pydantic coerces dicts
        )
    except ValidationError as exc:
        raise GenerationError("invalid_packet", "assembled packet failed contract validation") from exc

    await _write_artifact(pool, job_id, packet, sources)
    return result
