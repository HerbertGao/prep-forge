"""Claude CLI adapter (D6) — the only real model call path in the thin trunk.

Two injection surfaces are closed here:
  1. subprocess: `asyncio.create_subprocess_exec` (shell=False) + a FIXED argv;
     the prompt goes via STDIN, never argv → `$(...)`, backticks, leading `--`
     are inert.
  2. `claude -p` agentic mode: `--tools ""` disables ALL built-in tools (the
     documented empty allowlist — verified via `claude -p --help`, CLI 2.1.196).
     A default-deny allowlist, not a denylist: a denylist that missed `Read`
     would let the model read /proc/self/environ and lift the DB password.
  Plus credential isolation: the child env carries only PATH + an isolated HOME/
  CLAUDE_CONFIG_DIR — the worker's own secrets (DSN, shared secret) are NOT
  forwarded. ponytail: a dedicated low-priv OS user is deployment-level
  (Dockerfile USER / systemd User=), the library enforces argv + env isolation.

Cost basis is `subscription_amortized`: under a subscription `total_cost_usd` is
the API-equivalent amortized cost (non-zero), not a metered charge.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import os
from dataclasses import dataclass

PROVIDER = "anthropic"
COST_BASIS = "subscription_amortized"


class AdapterError(Exception):
    """A model call that did not yield a usable result.

    Carries only structured, secret-free fields: `error_kind` (timeout |
    spawn_failed | cli_nonzero | bad_output | model_error), an optional
    `status_code`, and a short `detail` that must never include stderr / argv /
    env (the gateway redacts it again before it reaches the DB).
    """

    def __init__(
        self,
        error_kind: str,
        *,
        status_code: int | None = None,
        detail: str | None = None,
    ) -> None:
        super().__init__(f"{error_kind}: {detail or ''}")
        self.error_kind = error_kind
        self.status_code = status_code
        self.detail = detail


@dataclass(frozen=True)
class AdapterResult:
    text: str
    model: str
    input_tokens: int | None
    output_tokens: int | None
    estimated_cost: float | None  # CLI total_cost_usd (amortized under subscription)
    latency_ms: int | None
    cost_basis: str


@dataclass(frozen=True)
class ClaudeCliConfig:
    cli_path: str = "claude"
    model: str | None = None  # None → CLI default (subscription)
    timeout_s: float = 90.0
    claude_home: str | None = None  # isolated HOME for credentials
    claude_config_dir: str | None = None

    @classmethod
    def from_env(cls) -> "ClaudeCliConfig":
        return cls(
            cli_path=os.environ.get("AI_WORKER_CLAUDE_CLI", "claude"),
            model=os.environ.get("AI_WORKER_CLAUDE_MODEL") or None,
            timeout_s=float(os.environ.get("AI_WORKER_CLAUDE_TIMEOUT_S", "90")),
            claude_home=os.environ.get("AI_WORKER_CLAUDE_HOME") or None,
            claude_config_dir=os.environ.get("AI_WORKER_CLAUDE_CONFIG_DIR") or None,
        )


class ClaudeCliAdapter:
    provider = PROVIDER

    def __init__(self, config: ClaudeCliConfig | None = None) -> None:
        self._config = config or ClaudeCliConfig()

    @property
    def model_label(self) -> str:
        # Used for the model_calls row on the error path (model NOT NULL) when
        # the CLI never returned a model name.
        return self._config.model or "unknown"

    def _child_env(self) -> dict[str, str]:
        # Whitelist, not inherit: strips AI_WORKER_DATABASE_URL / shared secret /
        # PREP_WORKER_PASSWORD etc. from the child so even a tool escape can't
        # read them from the env.
        env: dict[str, str] = {"PATH": os.environ.get("PATH", "/usr/bin:/bin")}
        home = self._config.claude_home or os.environ.get("HOME")
        if home:
            env["HOME"] = home
        if self._config.claude_config_dir:
            env["CLAUDE_CONFIG_DIR"] = self._config.claude_config_dir
        return env

    async def invoke(self, prompt: str) -> AdapterResult:
        # Fixed argv; `--tools ""` (empty allowlist) last so the variadic option
        # can't swallow a following flag. Prompt is NOT here — it goes via stdin.
        argv = [self._config.cli_path, "-p", "--output-format", "json"]
        if self._config.model:
            argv += ["--model", self._config.model]
        argv += ["--tools", ""]

        try:
            proc = await asyncio.create_subprocess_exec(
                *argv,
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env=self._child_env(),
            )
        except (FileNotFoundError, PermissionError) as exc:
            raise AdapterError("spawn_failed", detail="claude CLI not found or not executable") from exc

        try:
            stdout, _stderr = await asyncio.wait_for(
                proc.communicate(prompt.encode()), timeout=self._config.timeout_s
            )
        except asyncio.TimeoutError as exc:
            proc.kill()
            with contextlib.suppress(ProcessLookupError):
                await proc.wait()
            raise AdapterError("timeout", detail=f"claude CLI exceeded {self._config.timeout_s}s") from exc

        if proc.returncode != 0:
            # stderr deliberately dropped (may echo argv / env / secrets).
            raise AdapterError("cli_nonzero", status_code=proc.returncode, detail="claude CLI exited nonzero")

        try:
            data = json.loads(stdout.decode())
        except (ValueError, UnicodeDecodeError) as exc:
            raise AdapterError("bad_output", detail="claude CLI returned non-JSON") from exc

        if data.get("is_error"):
            raise AdapterError("model_error", detail="claude reported is_error")

        usage = data.get("usage") or {}
        model = (
            data.get("model")
            or next(iter((data.get("modelUsage") or {}).keys()), None)
            or self.model_label
        )
        return AdapterResult(
            text=data.get("result", ""),
            model=model,
            input_tokens=usage.get("input_tokens"),
            output_tokens=usage.get("output_tokens"),
            estimated_cost=data.get("total_cost_usd"),
            latency_ms=data.get("duration_ms"),
            cost_basis=COST_BASIS,
        )
