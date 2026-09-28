"""HandlerTrace — persists every handler run for observability and cost tracking.

Each row = one handler.run() invocation, storing:
- who/what/when
- token usage (input + output)
- tool calls made
- duration
- success/error status
- estimated cost
"""

from datetime import datetime

from sqlalchemy import DateTime, Float, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class HandlerTrace(Base):
    __tablename__ = "handler_traces"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    # Context
    project_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    user_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    handler_name: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    parent_trace_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)

    # Task
    instruction: Mapped[str] = mapped_column(Text, nullable=True)
    model: Mapped[str] = mapped_column(String(100), nullable=True)
    provider: Mapped[str] = mapped_column(String(50), nullable=True)

    # Token usage
    input_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    output_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    total_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # Cost (USD cents)
    estimated_cost_cents: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)

    # Execution
    turns_used: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    tool_calls_made: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    duration_ms: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # Result
    success: Mapped[int] = mapped_column(Integer, nullable=False, default=1)  # 1=success, 0=failure
    error: Mapped[str | None] = mapped_column(String(500), nullable=True)
    answer_preview: Mapped[str | None] = mapped_column(String(500), nullable=True)

    # Steps JSON (compact)
    steps_json: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Timestamps —— 统一使用 DateTime(timezone=True)
    started_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False,
    )
    finished_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True,
    )
