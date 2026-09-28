from datetime import datetime

from pydantic import BaseModel, Field


class MemberCreate(BaseModel):
    user_name: str = Field(..., min_length=1, max_length=100)
    role: str = "viewer"  # owner / editor / viewer


class MemberOut(BaseModel):
    id: int
    project_id: int
    user_name: str
    role: str


class CommentCreate(BaseModel):
    boq_item_id: int | None = None
    author: str = Field(..., min_length=1, max_length=100)
    content: str = Field(..., min_length=1, max_length=2000)


class CommentOut(BaseModel):
    id: int
    project_id: int
    boq_item_id: int | None
    author: str
    content: str
    # created_at 为 DateTime 类型，Pydantic 会自动序列化为 ISO 字符串
    created_at: datetime
