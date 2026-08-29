"""辅助 insight analysis endpoint."""

import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.assistant.agents.legacy_utils import VALID_CONTEXT_TYPES
from app.assistant.agents.v2.insight_handler_v2 import InsightHandlerV2
from app.assistant.framework.context import HandlerContext
from app.db.session import get_db
from app.schemas.zh_insight import ZhAnalyzeRequest, ZhAnalyzeResponse

logger = logging.getLogger(__name__)

router = APIRouter(tags=["zh"])


@router.post(
    "/projects/{project_id}/zh-analyze",
    response_model=ZhAnalyzeResponse,
)
def zh_analyze(
    project_id: int,
    payload: ZhAnalyzeRequest,
    db: Session = Depends(get_db),
) -> ZhAnalyzeResponse:
    """Generate 辅助 insight for the given project context (V2 — tool-calling)."""
    if payload.context_type not in VALID_CONTEXT_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid context_type. Must be one of: {', '.join(sorted(VALID_CONTEXT_TYPES))}",
        )

    data = {**payload.context_data, "project_id": project_id}
    try:
        import app.assistant.tools  # noqa: F401 — ensure tools registered

        ctx = HandlerContext(
            db=db,
            project_id=project_id,
            metadata={"context_type": payload.context_type, "context_data": data},
        )
        handler = InsightHandlerV2()
        result = handler.run(ctx, payload.context_data.get("question", ""))
        insight = result.answer if result.success else None
    except Exception:
        logger.exception("zh_analyze 错误")
        return ZhAnalyzeResponse(insight=None, zh_available=False)

    return ZhAnalyzeResponse(
        insight=insight,
        zh_available=insight is not None,
    )
