"""Model adapters. One adapter today (Claude CLI); re-export its DTOs."""

from __future__ import annotations

from ai_worker.adapters.claude_cli import (
    AdapterError,
    AdapterResult,
    ClaudeCliAdapter,
    ClaudeCliConfig,
)

__all__ = [
    "AdapterError",
    "AdapterResult",
    "ClaudeCliAdapter",
    "ClaudeCliConfig",
]
