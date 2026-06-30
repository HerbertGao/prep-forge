"""asyncpg 连接池——以 `prep_worker` 角色连库（D2 最小权限角色，G3 迁移建）。

建池失败（角色/库未就绪）不阻塞启动，记 warning 并以 pool=None 继续——
`/v1/prep/generate` 在 pool=None 时返回 503（G3 迁移后才连得上）。
worker 绝不连/查 prep_jobs（D10：jobId 权威=BFF）。
"""

from __future__ import annotations

import logging

import asyncpg

logger = logging.getLogger("ai_worker.db")


async def create_pool(database_url: str | None) -> asyncpg.Pool | None:
    if not database_url:
        logger.warning("AI_WORKER_DATABASE_URL unset — starting without DB pool")
        return None
    try:
        # ponytail: 默认池上限，吞吐不够再调 min_size/max_size
        return await asyncpg.create_pool(dsn=database_url)
    except Exception:
        # 角色/库未就绪不阻塞启动（本组不要求运行期能连）。不打印 DSN（含密码）。
        logger.warning("could not create asyncpg pool (DB not ready?) — continuing without it")
        return None
