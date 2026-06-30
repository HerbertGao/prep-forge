# ai-worker — prep-forge 离线 AI 内容预备 worker（FastAPI + asyncpg）。
# 锁定依赖经 `uv sync --frozen` 安装；非 root 运行（配合 G5 adapter 低权假设）。
FROM python:3.13-slim

# uv 二进制（官方镜像，版本钉死保证确定性；与生成 uv.lock 的宿主版本一致）。
COPY --from=ghcr.io/astral-sh/uv:0.11.25 /uv /uvx /usr/local/bin/

ENV UV_PROJECT_ENVIRONMENT=/app/.venv \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    PATH="/app/.venv/bin:$PATH"

WORKDIR /app

# 仅装锁定依赖层（虚拟项目 package=false：装依赖不构建本包；--no-dev 去掉 codegen/pytest）。
# 先拷锁文件命中 Docker 层缓存：源码变动不触发重新装依赖。
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

# 应用源码（含已生成提交的 contracts/ Pydantic；运行期不需 dev codegen）。
COPY ai_worker ./ai_worker

# 非 root 运行。
RUN useradd --create-home --uid 10001 appuser \
 && chown -R appuser:appuser /app
USER appuser

# 容器内绑 0.0.0.0；对宿主的暴露由 compose 的 ports 限定回环（127.0.0.1）。
# ponytail: 端口固定 8200（= config.AI_WORKER_PORT 默认）；要改端口同时改 compose ports。
EXPOSE 8200
CMD ["uvicorn", "ai_worker.main:app", "--host", "0.0.0.0", "--port", "8200"]
