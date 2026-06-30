"""ModelGateway self-checks (G5): record on success AND failure, error_message
sanitization, per-attempt caps. Uses a fake pool/conn + fake adapters — never
the real (paid) CLI.
"""

from __future__ import annotations

import asyncio
from decimal import Decimal
from hashlib import sha256

import pytest

from ai_worker.adapters import AdapterError, AdapterResult
from ai_worker.model_gateway import GuardrailExceeded, ModelGateway, sanitize_error

# model_calls columns in INSERT order (see _INSERT_SQL).
_COLS = [
    "id", "provider", "model", "task_type", "user_id", "lesson_packet_id",
    "input_tokens", "output_tokens", "estimated_cost", "latency_ms",
    "status", "error_message", "prep_job_id", "cost_basis", "prompt_version", "request_hash",
]


def _row(args: tuple) -> dict:
    return dict(zip(_COLS, args))


class _FakeTx:
    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False


class _FakeConn:
    def __init__(self, rows: list) -> None:
        self._rows = rows
        self.fail = False

    def transaction(self):
        return _FakeTx()

    async def execute(self, _sql: str, *args):
        if self.fail:
            raise RuntimeError("db write failed")
        self._rows.append(args)


class _FakeAcquire:
    def __init__(self, conn: _FakeConn) -> None:
        self._conn = conn

    async def __aenter__(self):
        return self._conn

    async def __aexit__(self, *exc):
        return False


class _FakePool:
    def __init__(self) -> None:
        self.rows: list = []
        self.conn = _FakeConn(self.rows)

    def acquire(self):
        return _FakeAcquire(self.conn)


class _OkAdapter:
    provider = "anthropic"
    model_label = "test-model"

    async def invoke(self, _prompt: str) -> AdapterResult:
        return AdapterResult("2+2 is 4", "claude-x", 10, 5, 0.0123, 1500, "subscription_amortized")


class _ErrAdapter:
    provider = "anthropic"
    model_label = "test-model"

    async def invoke(self, _prompt: str) -> AdapterResult:
        api_key_sample = "sk-" + "secret123"
        bearer_sample = "Bearer " + "abc.def"
        raise AdapterError("cli_nonzero", status_code=1, detail=f"leak {api_key_sample} and {bearer_sample}")


def test_success_records_ok_row():
    pool = _FakePool()
    gw = ModelGateway(pool, _OkAdapter())
    res = asyncio.run(gw.call(prep_job_id="job1", task_type="gen", prompt="2+2?", prompt_version="v1"))

    assert res.model_call_id.startswith("mc#")
    assert len(pool.rows) == 1
    row = _row(pool.rows[0])
    assert row["status"] == "ok"
    assert row["estimated_cost"] == Decimal("0.0123")
    assert row["cost_basis"] == "subscription_amortized"
    assert row["input_tokens"] == 10 and row["output_tokens"] == 5
    assert row["latency_ms"] == 1500
    assert row["error_message"] is None
    assert row["request_hash"] == sha256(b"2+2?").hexdigest()
    assert "2+2?" not in str(pool.rows[0])  # prompt never stored, only its hash


def test_failure_records_error_row_and_sanitizes():
    pool = _FakePool()
    gw = ModelGateway(pool, _ErrAdapter())
    with pytest.raises(AdapterError):
        asyncio.run(gw.call(prep_job_id="job1", task_type="gen", prompt="p", prompt_version="v1"))

    assert len(pool.rows) == 1  # failure still lands a row
    row = _row(pool.rows[0])
    assert row["status"] == "error"
    assert row["estimated_cost"] is None
    em = row["error_message"]
    assert "sk-" + "secret123" not in em
    assert "Bearer " + "abc.def" not in em
    assert "[redacted]" in em
    assert '"error_kind": "cli_nonzero"' in em


def test_sanitize_strips_secrets_keeps_structure():
    api_key_sample = "sk-" + "AbC123"
    bearer_sample = "Bearer " + "xyz.987"
    auth_header_sample = "Authorization: " + "Bearer " + "abc.def trailing"
    dsn_sample = "postgres://u:" + "pw" + "@h/db"
    out = sanitize_error(
        "cli_nonzero",
        1,
        f"token {api_key_sample} {bearer_sample} dsn {dsn_sample}\n{auth_header_sample}\nnext",
    )
    assert api_key_sample not in out
    assert bearer_sample not in out
    assert "abc.def" not in out
    assert "next" in out
    assert ":pw@" not in out
    assert '"error_kind": "cli_nonzero"' in out
    assert '"status_code": 1' in out


def test_call_cap_aborts_before_calling():
    pool = _FakePool()
    gw = ModelGateway(pool, _OkAdapter(), max_calls=1)
    asyncio.run(gw.call(prep_job_id="j", task_type="t", prompt="a", prompt_version="v"))
    with pytest.raises(GuardrailExceeded):
        asyncio.run(gw.call(prep_job_id="j", task_type="t", prompt="b", prompt_version="v"))
    assert len(pool.rows) == 1  # second made no call → no row


def test_token_cap_records_then_aborts():
    pool = _FakePool()
    gw = ModelGateway(pool, _OkAdapter(), max_tokens=5)  # ok adapter spends 10+5=15
    with pytest.raises(GuardrailExceeded):
        asyncio.run(gw.call(prep_job_id="j", task_type="t", prompt="a", prompt_version="v"))
    assert len(pool.rows) == 1  # row committed (cost honesty) before abort
    assert _row(pool.rows[0])["status"] == "ok"


def test_record_write_failure_raises_loudly():
    pool = _FakePool()
    pool.conn.fail = True
    gw = ModelGateway(pool, _OkAdapter())
    with pytest.raises(RuntimeError):
        asyncio.run(gw.call(prep_job_id="j", task_type="t", prompt="a", prompt_version="v"))
