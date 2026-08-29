from datetime import datetime

from pydantic import BaseModel


class AuditLogOut(BaseModel):
    id: int
    project_id: int
    actor: str
    action: str
    resource_type: str
    resource_id: int | None
    before_json: str | None
    after_json: str | None
    # timestamp 为 DateTime 类型，Pydantic 会自动序列化为 ISO 字符串
    timestamp: datetime
