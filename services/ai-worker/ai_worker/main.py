"""ai-worker FastAPI 应用——仅 `/v1/prep/generate`（D3/D6/D10 信任边界）。

信任边界（D10）：
- 仅绑 127.0.0.1/私网（见 config.host，默认回环）。
- 唯一鉴权 = 共享密钥，`hmac.compare_digest` 常量时间比较，绝不进任何日志。
- 禁 /docs、/redoc、/openapi.json；debug=False（不暴露 traceback）。
- worker 不读不写 prep_jobs、不校验 job 状态（jobId 权威=BFF）。

生成逻辑（ModelGateway/产物事务，G5/G6）见 ai_worker.generate。
"""

from __future__ import annotations

import hmac
import logging
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from ai_worker.adapters import AdapterError, ClaudeCliAdapter, ClaudeCliConfig
from ai_worker.adapters.fake import fake_adapter_from_env
from ai_worker.config import Settings, load_settings
from ai_worker.contracts import PrepGenerateRequest, PrepGenerateResult
from ai_worker.db import create_pool
from ai_worker.generate import GenerationError, generate_prep_packet
from ai_worker.model_gateway import GuardrailExceeded, ModelGateway

logger = logging.getLogger("ai_worker")

SECRET_HEADER = "x-worker-secret"


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings: Settings = app.state.settings
    app.state.pool = await create_pool(settings.database_url)
    try:
        yield
    finally:
        if app.state.pool is not None:
            await app.state.pool.close()


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or load_settings()
    # docs/redoc/openapi 全关；debug=False（默认，显式声明）。
    app = FastAPI(debug=False, docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan)
    app.state.settings = settings

    @app.middleware("http")
    async def auth_middleware(request: Request, call_next):
        expected = settings.shared_secret
        if not expected:
            # 未配置密钥 → fail closed（绝不裸奔）。不记密钥本身。
            logger.error("AI_WORKER_SHARED_SECRET unset — rejecting all requests")
            return JSONResponse({"detail": "worker not configured"}, status_code=503)
        provided = request.headers.get(SECRET_HEADER)
        # 常量时间比较；缺头直接拒。密钥两侧均不入日志。
        if provided is None or not hmac.compare_digest(provided.encode(), expected.encode()):
            return JSONResponse({"detail": "unauthorized"}, status_code=401)
        return await call_next(request)

    @app.post("/v1/prep/generate", response_model=PrepGenerateResult)
    async def prep_generate(req: PrepGenerateRequest, request: Request):
        # 入参已由 Pydantic 校验（4.3）。
        pool = request.app.state.pool
        if pool is None:
            # 角色/库未就绪（G3 迁移后才连得上）——非 2xx 让 BFF 置 failed。
            return JSONResponse({"detail": "worker db unavailable"}, status_code=503)
        # 每请求一个 gateway（其内存计数器界定单次 attempt 的调用/token，D6/D8）。
        # AI_WORKER_FAKE_LLM 设置时用确定性 stub（8.4 e2e），否则真 Claude CLI。
        adapter = fake_adapter_from_env() or ClaudeCliAdapter(ClaudeCliConfig.from_env())
        gateway = ModelGateway(pool, adapter)
        try:
            return await generate_prep_packet(pool, gateway, req)
        except (AdapterError, GuardrailExceeded, GenerationError) as exc:
            # 失败/超护栏 → 502（非 2xx），BFF 置 prep_jobs=failed。kind 脱敏、无密钥。
            kind = getattr(exc, "kind", None) or getattr(exc, "error_kind", "generation_error")
            logger.warning("prep generate failed: %s", kind)
            return JSONResponse({"detail": "generation failed", "kind": kind}, status_code=502)

    return app


app = create_app()


if __name__ == "__main__":
    s = load_settings()
    # 仅绑回环/私网（D10）。access log 不含密钥（密钥走 header，路径里没有）。
    uvicorn.run(app, host=s.host, port=s.port)
