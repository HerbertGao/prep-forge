"""Worker 运行配置——全部来自 env（D10 信任边界）。

- 共享密钥与 DSN 只在内存读取，绝不写日志（见 main.auth_middleware）。
- DSN 角色须为 `prep_worker`（G3 迁移建；本组只写连接代码，连不上不阻塞）。
"""

from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    # asyncpg DSN，角色 prep_worker（如 postgres://prep_worker:***@host/db）。未设则不建池。
    database_url: str | None
    # worker↔BFF 共享密钥；缺省则 worker 全拒（fail closed）。
    shared_secret: str | None
    # 仅绑回环/私网（D10）；默认 127.0.0.1。
    host: str
    port: int


def load_settings() -> Settings:
    return Settings(
        database_url=os.environ.get("AI_WORKER_DATABASE_URL"),
        shared_secret=os.environ.get("AI_WORKER_SHARED_SECRET"),
        host=os.environ.get("AI_WORKER_HOST", "127.0.0.1"),
        port=int(os.environ.get("AI_WORKER_PORT", "8200")),
    )
