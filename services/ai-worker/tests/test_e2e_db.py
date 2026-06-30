"""G8 8.4 worker e2e on the REAL migrated DB (DB-gated; SKIPS without DSNs).

Drives the FULL worker stack through the FastAPI TestClient (HTTP envelope +
shared-secret auth + Pydantic + generate + ModelGateway + asyncpg + the G3
triggers/grants) against a real PostgreSQL, with the DETERMINISTIC stub adapter
(AI_WORKER_FAKE_LLM) — never the paid CLI. This is the cross-cut that validates
the worker's hand-written asyncpg column lists against the real tables (design
D2 "runtime-only asyncpg, 8.4 打满每列").

Covered (design D6/D7/D9 + 8.3/8.4):
  - success path fills EVERY model_calls column incl. subscription cost basis;
    validating packet + worker-pinned practice step land;
  - error path lands a sanitized error row + no half-baked packet (502);
  - the cost row survives an outer business-tx rollback (dedicated connection);
  - a retry with FEWER steps deletes the stale step (real delete-pass + trigger).

Two DSNs (both set in CI after migrations + the 0006 role):
  AI_WORKER_DATABASE_URL                 — the prep_worker role (worker writes)
  AI_WORKER_PRIVILEGED_DATABASE_URL / DATABASE_URL — owner (fixtures + verify)
The worker writes model_calls.prep_job_id (FK → prep_jobs): a non-active
prep_jobs row (status='done') is seeded per call, mimicking the BFF.
"""

from __future__ import annotations

import asyncio
import json
import os
import uuid

import asyncpg
import pytest
from fastapi.testclient import TestClient

from ai_worker.adapters.fake import FAKE_MODEL, FakeAdapter
from ai_worker.config import Settings
from ai_worker.contracts import PrepGenerateRequest
from ai_worker.generate import generate_prep_packet
from ai_worker.main import SECRET_HEADER, create_app
from ai_worker.model_gateway import ModelGateway

WORKER_DSN = os.environ.get("AI_WORKER_DATABASE_URL")
PRIV_DSN = os.environ.get("AI_WORKER_PRIVILEGED_DATABASE_URL") or os.environ.get("DATABASE_URL")
SECRET = "e2e-shared-secret"

KP = "OS13180-e2e"
COURSE = "13180"  # demo: non-formula OS subject (design D7)
QID = "question#13180:e2e:Q1"
SOL_ID = "question_solution#13180:e2e:Q1"
LINK_ID = "question_kp_link#13180:e2e:Q1"


async def _probe() -> bool:
    conn = await asyncpg.connect(PRIV_DSN)
    try:
        await conn.execute("SELECT 1 FROM model_calls LIMIT 1")
        await conn.execute("SELECT 1 FROM lesson_packets LIMIT 1")
        await conn.execute("SELECT 1 FROM prep_jobs LIMIT 1")
    finally:
        await conn.close()
    w = await asyncpg.connect(WORKER_DSN)
    await w.close()
    return True


def _can_run() -> bool:
    if not (WORKER_DSN and PRIV_DSN):
        return False
    try:
        return asyncio.run(_probe())
    except Exception:
        return False


_RUN = _can_run()
if os.environ.get("CI") and WORKER_DSN and PRIV_DSN and not _RUN:
    # CI wired both DSNs but the DB/role isn't ready → fail loudly, never green-skip.
    raise RuntimeError("worker e2e DSNs set but DB/role not ready (run migrations + 0006_prep_worker_role)")

pytestmark = pytest.mark.skipif(
    not _RUN,
    reason="worker e2e needs AI_WORKER_DATABASE_URL + a privileged DSN on a migrated DB with prep_worker",
)


# --- fixtures (privileged) -----------------------------------------------------


async def _seed() -> None:
    conn = await asyncpg.connect(PRIV_DSN)
    try:
        await conn.execute(
            "INSERT INTO questions (id, origin, visibility, course_code, src, question_id, stem, type) "
            "VALUES ($1,'imported','public',$2,'e2e','Q1',$3,'单选题') ON CONFLICT (id) DO NOTHING",
            QID,
            COURSE,
            "操作系统的基本职能是什么？",
        )
        await conn.execute(
            "INSERT INTO question_options (id, origin, visibility, question_id, label, content, is_correct) "
            "VALUES ($1,'imported','public',$2,'A','应用软件',false) ON CONFLICT (id) DO NOTHING",
            f"{QID}:A",
            QID,
        )
        await conn.execute(
            "INSERT INTO question_options (id, origin, visibility, question_id, label, content, is_correct) "
            "VALUES ($1,'imported','public',$2,'B','管理硬件资源的系统软件',true) ON CONFLICT (id) DO NOTHING",
            f"{QID}:B",
            QID,
        )
        await conn.execute(
            "INSERT INTO question_solutions (id, origin, visibility, question_id, answer) "
            "VALUES ($1,'imported','public',$2,'B') ON CONFLICT (id) DO NOTHING",
            SOL_ID,
            QID,
        )
        await conn.execute(
            "INSERT INTO question_kp_links (id, origin, visibility, question_id, course_code, kp_code) "
            "VALUES ($1,'imported','public',$2,$3,$4) ON CONFLICT (id) DO NOTHING",
            LINK_ID,
            QID,
            COURSE,
            KP,
        )
    finally:
        await conn.close()


async def _cleanup() -> None:
    conn = await asyncpg.connect(PRIV_DSN)
    try:
        # FK-safe order: model_calls/qgr (→ prep_jobs) → steps (→ packets) → packets → jobs → question bank.
        await conn.execute("DELETE FROM model_calls WHERE prep_job_id LIKE 'e2e-%'")
        await conn.execute("DELETE FROM quality_gate_results WHERE prep_job_id LIKE 'e2e-%'")
        await conn.execute("DELETE FROM lesson_steps WHERE lesson_packet_id LIKE 'lesson_packet#prep:e2e-%'")
        await conn.execute("DELETE FROM lesson_packets WHERE id LIKE 'lesson_packet#prep:e2e-%'")
        await conn.execute("DELETE FROM prep_jobs WHERE id LIKE 'e2e-%'")
        await conn.execute("DELETE FROM question_kp_links WHERE question_id = $1", QID)
        await conn.execute("DELETE FROM question_solutions WHERE question_id = $1", QID)
        await conn.execute("DELETE FROM question_options WHERE question_id = $1", QID)
        await conn.execute("DELETE FROM questions WHERE id = $1", QID)
    finally:
        await conn.close()


@pytest.fixture(scope="module", autouse=True)
def _seed_and_cleanup():
    asyncio.run(_seed())
    yield
    asyncio.run(_cleanup())


async def _create_job(conn: asyncpg.Connection, job_id: str) -> None:
    # status='done' (terminal) keeps it OUT of the active-job partial-unique
    # index so parallel e2e jobs on the same KP don't collide; the worker never
    # reads prep_jobs (D10) — this row only satisfies the model_calls FK.
    await conn.execute(
        "INSERT INTO prep_jobs (id, status, kp_code, prompt_version, idempotency_key) "
        "VALUES ($1,'done',$2,'e2e',$1) ON CONFLICT (id) DO NOTHING",
        job_id,
        KP,
    )


def _job_id(tag: str) -> str:
    return f"e2e-{tag}-{uuid.uuid4().hex[:10]}"


def _client(database_url: str) -> TestClient:
    settings = Settings(database_url=database_url, shared_secret=SECRET, host="127.0.0.1", port=8200)
    return TestClient(create_app(settings))


# --- tests ---------------------------------------------------------------------


def test_http_success_fills_every_model_calls_column(monkeypatch):
    monkeypatch.setenv("AI_WORKER_FAKE_LLM", "1")
    job_id = _job_id("ok")
    asyncio.run(_with_job(job_id))

    with _client(WORKER_DSN) as c:
        r = c.post(
            "/v1/prep/generate",
            json={"schemaVersion": "1", "tenantId": "demo", "jobId": job_id, "kpCode": KP},
            headers={SECRET_HEADER: SECRET},
        )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["lessonPacket"]["status"] == "validating"

    pkt, steps, mc = asyncio.run(_verify(job_id))
    # validating + ai_generated artifact persisted.
    assert pkt["origin"] == "ai_generated" and pkt["status"] == "validating"
    assert pkt["course_code"] == COURSE and pkt["content_hash"]
    # worker-pinned practice step references EXACTLY the real seeded question.
    practice = steps[-1]
    assert practice["type"] == "practice"
    assert json.loads(practice["question_ids"]) == [QID]
    # every model_calls column filled on the success path (三路打满每列).
    assert mc is not None
    assert mc["status"] == "ok"
    assert mc["model"] == FAKE_MODEL
    assert mc["input_tokens"] == 128 and mc["output_tokens"] == 64
    assert float(mc["estimated_cost"]) == 0.0042
    assert mc["latency_ms"] == 12
    assert mc["cost_basis"] == "subscription_amortized"  # 订阅路
    assert mc["prep_job_id"] == job_id
    assert mc["request_hash"] and mc["error_message"] is None


def test_http_error_path_lands_sanitized_row_no_packet(monkeypatch):
    monkeypatch.setenv("AI_WORKER_FAKE_LLM", "error")
    job_id = _job_id("err")
    asyncio.run(_with_job(job_id))

    with _client(WORKER_DSN) as c:
        r = c.post(
            "/v1/prep/generate",
            json={"schemaVersion": "1", "tenantId": "demo", "jobId": job_id, "kpCode": KP},
            headers={SECRET_HEADER: SECRET},
        )
    assert r.status_code == 502, r.text

    _pkt, _steps, mc = asyncio.run(_verify(job_id))
    # error model_calls row landed (structured whitelist), no cost, and NO packet.
    assert mc is not None and mc["status"] == "error"
    assert mc["estimated_cost"] is None
    assert '"error_kind"' in mc["error_message"]
    assert _pkt is None  # gateway raised before _write_artifact — no half-baked draft


def test_cost_row_survives_outer_business_tx_rollback():
    job_id = _job_id("rollback")
    asyncio.run(_gateway_then_rollback(job_id))

    _pkt, _steps, mc = asyncio.run(_verify(job_id))
    assert mc is not None and mc["status"] == "ok"  # committed on its own connection


def test_retry_with_fewer_steps_deletes_stale_step():
    job_id = _job_id("deletepass")
    asyncio.run(_run_delete_pass(job_id))


# --- async helpers -------------------------------------------------------------


async def _with_job(job_id: str) -> None:
    conn = await asyncpg.connect(PRIV_DSN)
    try:
        await _create_job(conn, job_id)
    finally:
        await conn.close()


async def _verify(job_id: str):
    packet_id = f"lesson_packet#prep:{job_id}"
    conn = await asyncpg.connect(PRIV_DSN)
    try:
        pkt = await conn.fetchrow(
            "SELECT origin, status, course_code, content_hash FROM lesson_packets WHERE id=$1",
            packet_id,
        )
        steps = await conn.fetch(
            "SELECT id, type, question_ids FROM lesson_steps WHERE lesson_packet_id=$1 ORDER BY sequence",
            packet_id,
        )
        mc = await conn.fetchrow(
            "SELECT status, model, input_tokens, output_tokens, estimated_cost, latency_ms, "
            "cost_basis, prep_job_id, request_hash, error_message FROM model_calls WHERE prep_job_id=$1",
            job_id,
        )
        return pkt, list(steps), mc
    finally:
        await conn.close()


async def _gateway_then_rollback(job_id: str) -> None:
    pool = await asyncpg.create_pool(WORKER_DSN)
    priv = await asyncpg.connect(PRIV_DSN)
    throwaway = f"lesson_packet#prep:e2e-rollback-throwaway-{job_id}"
    try:
        await _create_job(priv, job_id)
        gw = ModelGateway(pool, FakeAdapter("ok"))
        tx = priv.transaction()
        await tx.start()
        # An outer business write on a SEPARATE connection that we then discard.
        await priv.execute(
            "INSERT INTO lesson_packets (id, origin, visibility, version, status, title, kp_codes) "
            "VALUES ($1,'ai_generated','public',1,'validating',$2,$3::jsonb)",
            throwaway,
            "throwaway",
            json.dumps([KP]),
        )
        # The gateway commits model_calls on its OWN pooled connection.
        await gw.call(prep_job_id=job_id, task_type="prep_generate", prompt="p", prompt_version="e2e")
        await tx.rollback()
        # The outer write is gone; the committed cost row is independent.
        assert await priv.fetchval("SELECT 1 FROM lesson_packets WHERE id=$1", throwaway) is None
    finally:
        await priv.close()
        await pool.close()


class _FixedCall:
    def __init__(self, text: str) -> None:
        self.text = text
        self.model_call_id = "mc#e2e"


class _FixedGateway:
    """Fake gateway with controllable step count — writes NO model_calls row."""

    def __init__(self, text: str) -> None:
        self._text = text

    async def call(self, **_kwargs):
        return _FixedCall(self._text)


_TWO_TEACHING = json.dumps(
    {"steps": [{"type": "explanation", "mdx": "一"}, {"type": "explanation", "mdx": "二"}]},
    ensure_ascii=False,
)
_ONE_TEACHING = json.dumps({"steps": [{"type": "explanation", "mdx": "一"}]}, ensure_ascii=False)


async def _run_delete_pass(job_id: str) -> None:
    pool = await asyncpg.create_pool(WORKER_DSN)
    priv = await asyncpg.connect(PRIV_DSN)
    packet_id = f"lesson_packet#prep:{job_id}"
    req = PrepGenerateRequest(schemaVersion="1", tenantId="demo", jobId=job_id, kpCode=KP)
    try:
        # First attempt: 2 teaching + 1 worker-pinned practice = 3 steps.
        await generate_prep_packet(pool, _FixedGateway(_TWO_TEACHING), req)
        n1 = await priv.fetchval("SELECT count(*) FROM lesson_steps WHERE lesson_packet_id=$1", packet_id)
        assert n1 == 3
        # Retry same job, fewer steps: 1 teaching + practice = 2 → the stale 3rd row is deleted.
        await generate_prep_packet(pool, _FixedGateway(_ONE_TEACHING), req)
        ids = [
            r["id"]
            for r in await priv.fetch("SELECT id FROM lesson_steps WHERE lesson_packet_id=$1", packet_id)
        ]
        assert len(ids) == 2
        assert f"lesson_step#prep:{job_id}:3" not in ids  # stale step gone (real delete-pass)
    finally:
        await priv.close()
        await pool.close()
