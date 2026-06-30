"""ModelGateway — per-attempt cost ledger + guardrails (D6/D8).

Construct ONE gateway per `/v1/prep/generate` request: its in-memory counters
bound the calls/tokens of a single attempt. Cross-request caps are the BFF's job
(`prep_jobs.attempt_count`, D4) — not here.

Accounting (D6):
  - a DEDICATED pool connection, its own transaction, COMMIT before returning,
    decoupled from any business tx — so a business rollback never drops a cost
    row;
  - a row on BOTH success and failure (worker has INSERT-only on model_calls);
  - a failed write RAISES loudly (no silent cost loss);
  - `error_message` is a structured whitelist (error_kind / status_code /
    redacted+truncated detail) — the ONLY thing that reaches the column; raw
    stderr / argv / env never land.
"""

from __future__ import annotations

import json
import re
import uuid
from dataclasses import dataclass
from decimal import Decimal
from hashlib import sha256

from ai_worker.adapters import AdapterError, AdapterResult

# ponytail: conservative placeholders — 待解决问题: 实测重定. A single thin-trunk
# generate needs ~1 call; these are a runaway-loop backstop, not a tuned budget.
DEFAULT_MAX_CALLS_PER_ATTEMPT = 3
DEFAULT_MAX_TOKENS_PER_ATTEMPT = 200_000

_ERROR_DETAIL_MAX = 200

# Defense-in-depth: strip credential shapes from any text before it can land in
# error_message. The primary guard is that callers never pass stderr/argv/env;
# this catches anything that slips through.
_SECRET_PATTERNS = [
    re.compile(r"sk-[A-Za-z0-9._\-]+"),
    re.compile(r"(?i)bearer\s+[A-Za-z0-9._\-]+"),
    re.compile(r"(?i)authorization:\s*\S+"),
    re.compile(r"eyJ[A-Za-z0-9._\-]{10,}"),  # JWT / subscription token
    re.compile(r"(postgres(?:ql)?://[^\s:/@]+:)[^\s/@]+(@)"),  # DSN password
]

_INSERT_SQL = """
INSERT INTO model_calls (
    id, provider, model, task_type, user_id, lesson_packet_id,
    input_tokens, output_tokens, estimated_cost, latency_ms,
    status, error_message, prep_job_id, cost_basis, prompt_version, request_hash
) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16
)
"""


class GuardrailExceeded(Exception):
    """Per-attempt call/token cap hit → abort; BFF then sets prep_jobs=failed."""

    def __init__(self, kind: str, detail: str) -> None:
        super().__init__(f"{kind}: {detail}")
        self.kind = kind


@dataclass(frozen=True)
class ModelCallResult:
    model_call_id: str  # so the caller can record it in generationSources.modelCallIds
    text: str
    model: str
    input_tokens: int | None
    output_tokens: int | None
    estimated_cost: float | None
    latency_ms: int | None
    cost_basis: str


def _redact(text: str) -> str:
    def _sub(m: re.Match[str]) -> str:
        # Two-group patterns (DSN) keep prefix + "@"; zero-group patterns nuke all.
        return f"{m.group(1)}[redacted]{m.group(2)}" if m.groups() else "[redacted]"

    for pat in _SECRET_PATTERNS:
        text = pat.sub(_sub, text)
    return text


def sanitize_error(error_kind: str, status_code: int | None, detail: str | None) -> str:
    payload: dict[str, object] = {"error_kind": error_kind}
    if status_code is not None:
        payload["status_code"] = status_code
    if detail:
        payload["detail"] = _redact(str(detail))[:_ERROR_DETAIL_MAX]
    return json.dumps(payload, ensure_ascii=False, sort_keys=True)


class ModelGateway:
    def __init__(
        self,
        pool,
        adapter,
        *,
        max_calls: int = DEFAULT_MAX_CALLS_PER_ATTEMPT,
        max_tokens: int = DEFAULT_MAX_TOKENS_PER_ATTEMPT,
    ) -> None:
        self._pool = pool
        self._adapter = adapter
        self._max_calls = max_calls
        self._max_tokens = max_tokens
        self._call_count = 0
        self._token_total = 0

    async def call(
        self,
        *,
        prep_job_id: str | None,
        task_type: str,
        prompt: str,
        prompt_version: str,
        lesson_packet_id: str | None = None,
        user_id: str | None = None,
    ) -> ModelCallResult:
        # Pre-call call-count guardrail: no call is made, so no row.
        self._call_count += 1
        if self._call_count > self._max_calls:
            raise GuardrailExceeded("call_cap", f"per-attempt call cap {self._max_calls} exceeded")

        model_call_id = f"mc#{uuid.uuid4().hex}"
        request_hash = sha256(prompt.encode()).hexdigest()  # hash, never the prompt
        provider = self._adapter.provider

        try:
            result: AdapterResult = await self._adapter.invoke(prompt)
        except AdapterError as exc:
            await self._record(
                model_call_id=model_call_id,
                provider=provider,
                model=self._adapter.model_label,
                task_type=task_type,
                status="error",
                input_tokens=None,
                output_tokens=None,
                estimated_cost=None,
                latency_ms=None,
                error_message=sanitize_error(exc.error_kind, exc.status_code, exc.detail),
                prep_job_id=prep_job_id,
                cost_basis=None,
                prompt_version=prompt_version,
                request_hash=request_hash,
                lesson_packet_id=lesson_packet_id,
                user_id=user_id,
            )
            raise

        await self._record(
            model_call_id=model_call_id,
            provider=provider,
            model=result.model,
            task_type=task_type,
            status="ok",
            input_tokens=result.input_tokens,
            output_tokens=result.output_tokens,
            estimated_cost=result.estimated_cost,
            latency_ms=result.latency_ms,
            error_message=None,
            prep_job_id=prep_job_id,
            cost_basis=result.cost_basis,
            prompt_version=prompt_version,
            request_hash=request_hash,
            lesson_packet_id=lesson_packet_id,
            user_id=user_id,
        )

        # Post-call token guardrail: the row is already committed (cost honesty —
        # the tokens were spent), THEN abort.
        self._token_total += (result.input_tokens or 0) + (result.output_tokens or 0)
        if self._token_total > self._max_tokens:
            raise GuardrailExceeded("token_cap", f"per-attempt token cap {self._max_tokens} exceeded")

        return ModelCallResult(
            model_call_id=model_call_id,
            text=result.text,
            model=result.model,
            input_tokens=result.input_tokens,
            output_tokens=result.output_tokens,
            estimated_cost=result.estimated_cost,
            latency_ms=result.latency_ms,
            cost_basis=result.cost_basis,
        )

    async def _record(
        self,
        *,
        model_call_id: str,
        provider: str,
        model: str,
        task_type: str,
        status: str,
        input_tokens: int | None,
        output_tokens: int | None,
        estimated_cost: float | None,
        latency_ms: int | None,
        error_message: str | None,
        prep_job_id: str | None,
        cost_basis: str | None,
        prompt_version: str,
        request_hash: str,
        lesson_packet_id: str | None,
        user_id: str | None,
    ) -> None:
        # numeric(12,6) wants Decimal, not float.
        cost = Decimal(str(estimated_cost)) if estimated_cost is not None else None
        # Dedicated connection + own transaction: commits on context exit, BEFORE
        # this returns. INSERT-only (worker has no UPDATE/DELETE on model_calls).
        async with self._pool.acquire() as conn:
            async with conn.transaction():
                await conn.execute(
                    _INSERT_SQL,
                    model_call_id,
                    provider,
                    model,
                    task_type,
                    user_id,
                    lesson_packet_id,
                    input_tokens,
                    output_tokens,
                    cost,
                    latency_ms,
                    status,
                    error_message,
                    prep_job_id,
                    cost_basis,
                    prompt_version,
                    request_hash,
                )
