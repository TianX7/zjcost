"""Schemas for 辅助 insight and chat endpoints."""

from typing import Any, Optional

from pydantic import BaseModel, Field


class ZhAnalyzeRequest(BaseModel):
    context_type: str = Field(
        ...,
        description="One of: scan, match, calc, validation, provenance, dashboard",
    )
    context_data: dict[str, Any] = Field(default_factory=dict)


class ZhAnalyzeResponse(BaseModel):
    insight: Optional[str] = Field(
        None,
        description="辅助-generated insight text, or null if 辅助 unavailable",
    )
    zh_available: bool = Field(default=False)


class ChatMessage(BaseModel):
    role: str = "user"
    content: str = ""


class ZhChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=2000)
    history: list[ChatMessage] = Field(default_factory=list)


class ZhChatResponse(BaseModel):
    reply: Optional[str] = Field(
        None,
        description="辅助-generated reply, or null if 辅助 unavailable",
    )
    zh_available: bool = Field(default=False)
