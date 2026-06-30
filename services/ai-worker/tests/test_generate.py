"""G6 generate self-checks: pin real questions, robust model-JSON parse, derived
ids, advisory-lock artifact tx with delete-pass. Fake pool/conn + fake gateway —
never the real (paid) CLI or a live DB.
"""

from __future__ import annotations

import asyncio
import json

import pytest

from ai_worker.contracts import PrepGenerateRequest
from ai_worker.generate import GenerationError, generate_prep_packet

_REQ = PrepGenerateRequest(schemaVersion="1", tenantId="t", jobId="job-1", kpCode="OS01-02")

_Q_ROWS = [
    {"id": "question#13180:src:Q1", "type": "单选题", "stem": "OS 是什么？", "course_code": "13180"},
    {"id": "question#13180:src:Q2", "type": "单选题", "stem": "进程是什么？", "course_code": "13180"},
]
_OPT_ROWS = [
    {"question_id": "question#13180:src:Q1", "label": "A", "content": "系统软件"},
    {"question_id": "question#13180:src:Q1", "label": "B", "content": "应用软件"},
]

_GOOD_MODEL_JSON = json.dumps(
    {
        "title": "操作系统引论",
        "objectives": ["理解 OS 角色"],
        "steps": [
            {"type": "explanation", "prompt": "OS 干什么？", "mdx": "管理硬件资源。"},
            {"type": "worked_example", "prompt": "举例", "mdx": "调度进程的过程。"},
        ],
    },
    ensure_ascii=False,
)


class _FakeTx:
    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False


class _FakeConn:
    def __init__(self, q_rows, opt_rows) -> None:
        self._q_rows = q_rows
        self._opt_rows = opt_rows
        self.executed: list[tuple] = []  # (sql, args)
        self.fetched: list[tuple] = []  # (sql, args)

    def transaction(self):
        return _FakeTx()

    async def fetch(self, sql: str, *args):
        self.fetched.append((sql, args))
        if "question_kp_links" in sql:
            return list(self._q_rows)
        if "question_options" in sql:
            ids = set(args[0])
            return [r for r in self._opt_rows if r["question_id"] in ids]
        raise AssertionError(f"unexpected fetch: {sql[:40]}")

    async def execute(self, sql: str, *args):
        self.executed.append((sql, args))


class _FakeAcquire:
    def __init__(self, conn) -> None:
        self._conn = conn

    async def __aenter__(self):
        return self._conn

    async def __aexit__(self, *exc):
        return False


class _FakePool:
    def __init__(self, q_rows=_Q_ROWS, opt_rows=_OPT_ROWS) -> None:
        self.conn = _FakeConn(q_rows, opt_rows)

    def acquire(self):
        return _FakeAcquire(self.conn)


class _FakeCall:
    def __init__(self, text: str) -> None:
        self.text = text
        self.model_call_id = "mc#fake1"


class _FakeGateway:
    def __init__(self, text: str) -> None:
        self._text = text
        self.calls: list[dict] = []

    async def call(self, **kwargs):
        self.calls.append(kwargs)
        return _FakeCall(self._text)


def _run(pool, gateway, req=_REQ):
    return asyncio.run(generate_prep_packet(pool, gateway, req))


def _exec_for(conn, needle: str):
    return [(sql, args) for sql, args in conn.executed if needle in sql]


def test_happy_path_pins_real_questions_and_validating_draft():
    pool, gw = _FakePool(), _FakeGateway(_GOOD_MODEL_JSON)
    res = _run(pool, gw)

    p = res.lessonPacket
    assert p.id == "lesson_packet#prep:job-1"
    assert p.origin.value == "ai_generated" and p.status.value == "validating"
    assert p.kpCodes == ["OS01-02"]
    # teaching steps + one worker-pinned practice step
    assert [s.type.value for s in p.steps] == ["explanation", "worked_example", "practice"]
    practice = p.steps[-1]
    assert practice.id == "lesson_step#prep:job-1:3"
    # practice references EXACTLY the real questions the worker picked
    assert practice.questionIds == ["question#13180:src:Q1", "question#13180:src:Q2"]
    assert p.contentHash
    # generation sources are structured + audit-only
    assert [s.sourceType.value for s in res.generationSources] == ["question", "question"]
    assert [m.root for m in res.generationSources[0].modelCallIds] == ["mc#fake1"]
    # gateway called once with the derived packet id + prompt version
    assert len(gw.calls) == 1
    assert gw.calls[0]["lesson_packet_id"] == "lesson_packet#prep:job-1"


def test_question_selection_filters_to_imported_rows():
    pool, gw = _FakePool(), _FakeGateway(_GOOD_MODEL_JSON)
    _run(pool, gw)
    q_sql = next(sql for sql, _args in pool.conn.fetched if "question_kp_links" in sql)
    opt_sql = next(sql for sql, _args in pool.conn.fetched if "FROM question_options" in sql)
    assert "kl.origin = 'imported'" in q_sql
    assert "q.origin = 'imported'" in q_sql
    assert "o.origin = 'imported'" in q_sql
    assert "origin = 'imported'" in opt_sql


def test_artifact_tx_takes_advisory_lock_and_writes_packet_then_steps():
    pool, gw = _FakePool(), _FakeGateway(_GOOD_MODEL_JSON)
    _run(pool, gw)
    conn = pool.conn

    lock = _exec_for(conn, "pg_advisory_xact_lock")
    assert len(lock) == 1 and lock[0][1] == ("job-1",)  # locked on jobId

    pkt = _exec_for(conn, "INSERT INTO lesson_packets")
    assert len(pkt) == 1
    # validating + ai_generated land in the upsert args (past the G3 trigger)
    assert "validating" in pkt[0][1] and "ai_generated" in pkt[0][1]

    steps = _exec_for(conn, "INSERT INTO lesson_steps")
    assert len(steps) == 3  # 2 teaching + 1 practice


def test_delete_pass_runs_with_keep_ids_before_step_upserts():
    pool, gw = _FakePool(), _FakeGateway(_GOOD_MODEL_JSON)
    _run(pool, gw)
    conn = pool.conn

    dele = _exec_for(conn, "DELETE FROM lesson_steps")
    assert len(dele) == 1
    # keep-set = exactly this attempt's step ids → stale rows of a prior attempt go
    keep = dele[0][1][1]
    assert keep == [
        "lesson_step#prep:job-1:1",
        "lesson_step#prep:job-1:2",
        "lesson_step#prep:job-1:3",
    ]
    # ordering: packet upsert → delete-pass → step upserts (parent must exist
    # before the lesson_steps trigger's parent lookup, and stale steps go first)
    idx_pkt = next(i for i, (sql, _) in enumerate(conn.executed) if "INSERT INTO lesson_packets" in sql)
    idx_del = next(i for i, (sql, _) in enumerate(conn.executed) if "DELETE FROM lesson_steps" in sql)
    idx_step = next(i for i, (sql, _) in enumerate(conn.executed) if "INSERT INTO lesson_steps" in sql)
    assert idx_pkt < idx_del < idx_step


def test_no_objective_questions_raises_no_write():
    pool, gw = _FakePool(q_rows=[]), _FakeGateway(_GOOD_MODEL_JSON)
    with pytest.raises(GenerationError) as ei:
        _run(pool, gw)
    assert ei.value.kind == "no_objective_questions"
    assert pool.conn.executed == []  # nothing written
    assert gw.calls == []  # never even called the model


def test_bad_model_json_raises_and_writes_nothing():
    pool, gw = _FakePool(), _FakeGateway("sorry, I cannot help with that")
    with pytest.raises(GenerationError) as ei:
        _run(pool, gw)
    assert ei.value.kind == "bad_model_json"
    assert _exec_for(pool.conn, "INSERT INTO lesson_packets") == []  # no half-baked packet


def test_fenced_json_is_parsed():
    fenced = f"```json\n{_GOOD_MODEL_JSON}\n```"
    pool, gw = _FakePool(), _FakeGateway(fenced)
    res = _run(pool, gw)
    assert res.lessonPacket.title == "操作系统引论"


def test_unknown_step_type_coerced_to_explanation():
    bad_type = json.dumps(
        {"steps": [{"type": "math_block", "mdx": "讲解正文"}]}, ensure_ascii=False
    )
    pool, gw = _FakePool(), _FakeGateway(bad_type)
    res = _run(pool, gw)
    assert res.lessonPacket.steps[0].type.value == "explanation"
