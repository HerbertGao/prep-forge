"""Deterministic stub adapter (8.4 e2e) — NEVER calls the paid CLI.

Enabled via the AI_WORKER_FAKE_LLM env var so an e2e run gets a fixed model
response (no real, non-deterministic, $-costing CLI call):
  - "1" / "ok" → a fixed non-formula OS-13180 teaching-step JSON (success path);
  - "error"    → raise AdapterError so the error model_calls row + 502 path is
    exercised deterministically.
The success result carries non-null usage + a `subscription_amortized` cost
basis so the success path fills every model_calls column (8.4: 三路打满每列).
"""

from __future__ import annotations

import json
import os

from ai_worker.adapters.claude_cli import COST_BASIS, AdapterError, AdapterResult

FAKE_MODEL = "fake-os-13180"

# Demo KP 13180 is a non-formula concept subject (design D7): plain prose, no
# LaTeX / $ — so the BFF math gate (D5) passes and the packet reaches `draft`.
_FAKE_RESULT_JSON = json.dumps(
    {
        "title": "操作系统引论 · AI 草稿",
        "objectives": ["理解操作系统在计算机系统中的角色"],
        "steps": [
            {
                "type": "explanation",
                "prompt": "操作系统是做什么的？",
                "mdx": "操作系统管理硬件资源，向上层程序提供统一的接口与抽象。",
            },
            {
                "type": "worked_example",
                "prompt": "举一个进程调度的例子",
                "mdx": "当多个进程同时就绪时，调度器按既定策略挑选下一个运行的进程。",
            },
        ],
    },
    ensure_ascii=False,
)


class FakeAdapter:
    """In-process stub matching the ClaudeCliAdapter duck type."""

    provider = "anthropic"
    model_label = FAKE_MODEL

    def __init__(self, mode: str = "ok") -> None:
        self._mode = mode

    async def invoke(self, prompt: str) -> AdapterResult:
        if self._mode == "error":
            raise AdapterError("model_error", detail="fake adapter error mode")
        return AdapterResult(
            text=_FAKE_RESULT_JSON,
            model=FAKE_MODEL,
            input_tokens=128,
            output_tokens=64,
            estimated_cost=0.0042,  # non-zero amortized cost (cost honesty)
            latency_ms=12,
            cost_basis=COST_BASIS,
        )


def fake_adapter_from_env() -> FakeAdapter | None:
    """Return a stub when AI_WORKER_FAKE_LLM is set, else None (use the real CLI)."""
    val = os.environ.get("AI_WORKER_FAKE_LLM", "").strip().lower()
    if val in ("", "0", "false"):
        return None
    return FakeAdapter(mode="error" if val == "error" else "ok")
