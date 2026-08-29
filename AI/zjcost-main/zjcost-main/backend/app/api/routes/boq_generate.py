"""辅助-powered BOQ item generation endpoint with multi-standard support."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.assistant.agents.legacy_utils import generate_boq_items_with_agent
from app.db.session import get_db
from app.models.project import Project
from app.schemas.boq_generate import (
    BoqSuggestionOut,
    GenerateRequest,
    GenerateResponse,
)
from app.services.boq_generate_service import _detect_floors

router = APIRouter(tags=["boq-generate"])


@router.post(
    "/projects/{project_id}/zh-generate-boq",
    response_model=GenerateResponse,
)
def zh_generate_boq(
    project_id: int,
    payload: GenerateRequest,
    db: Session = Depends(get_db),
) -> GenerateResponse:
    """Generate BOQ item suggestions from a natural language description.

    Supports both GB50500 and HKSMM4 standards based on project configuration.
    The suggestions are returned for user review; they are NOT
    automatically inserted into the project.
    """
    # 校验项目存在，不存在则返回 404，而非静默使用默认值
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    standard_type = project.standard_type or "GB50500"

    suggestions = generate_boq_items_with_agent(payload.description, standard_type)
    return GenerateResponse(
        description=payload.description,
        floors_detected=_detect_floors(payload.description),
        total_items=len(suggestions),
        suggestions=[
            BoqSuggestionOut(
                code=s.code,
                name=s.name,
                characteristics=s.characteristics,
                unit=s.unit,
                quantity=s.quantity,
                division=s.division,
                reason=s.reason,
            )
            for s in suggestions
        ],
    )
