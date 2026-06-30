"""信任边界自检（D10）：共享密钥门 + 入参校验 + 关 /docs。

无 DB（database_url=None → pool=None），lifespan 仍正常起停。
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from ai_worker.config import Settings
from ai_worker.main import SECRET_HEADER, create_app

SECRET = "test-shared-secret"
_VALID_BODY = {"schemaVersion": "1", "tenantId": "t", "jobId": "j", "kpCode": "13180"}


def _client(secret: str | None = SECRET) -> TestClient:
    settings = Settings(database_url=None, shared_secret=secret, host="127.0.0.1", port=8200)
    return TestClient(create_app(settings))


def test_missing_secret_rejected():
    with _client() as c:
        r = c.post("/v1/prep/generate", json=_VALID_BODY)
        assert r.status_code == 401


def test_wrong_secret_rejected():
    with _client() as c:
        r = c.post("/v1/prep/generate", json=_VALID_BODY, headers={SECRET_HEADER: "nope"})
        assert r.status_code == 401


def test_unconfigured_secret_fails_closed():
    with _client(secret=None) as c:
        r = c.post("/v1/prep/generate", json=_VALID_BODY, headers={SECRET_HEADER: "anything"})
        assert r.status_code == 503


def test_valid_secret_invalid_body_422():
    with _client() as c:
        r = c.post("/v1/prep/generate", json={"schemaVersion": "1"}, headers={SECRET_HEADER: SECRET})
        assert r.status_code == 422  # Pydantic 入参校验


def test_valid_secret_no_db_503():
    # No DB pool (database_url=None) → generate route returns 503, not 501.
    with _client() as c:
        r = c.post("/v1/prep/generate", json=_VALID_BODY, headers={SECRET_HEADER: SECRET})
        assert r.status_code == 503  # worker db unavailable (G3 migration not run)


def test_docs_disabled():
    with _client() as c:
        for path in ("/docs", "/redoc", "/openapi.json"):
            assert c.get(path, headers={SECRET_HEADER: SECRET}).status_code == 404
