"""Extensions browsing API (Phase H9).

Read-only REST endpoints for listing and inspecting domain Extensions.
Extensions are statically loaded from ``app/assistant/skills/`` at app startup
(via extension_tools import side-effect); these routes are pure reads.

## Endpoints

- GET /api/skills                   list all registered skills (summary)
- GET /api/skills/{name}            fetch a single skill including body
- GET /api/skills/search            keyword search (trigger/tag AND-match)
- GET /api/skills/search/semantic   embedding-based semantic match
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from app.compat import model_to_dict

logger = logging.getLogger(__name__)

router = APIRouter(tags=["skills"])


# ── Schemas ──────────────────────────────────────────────────────


class ExtensionSummary(BaseModel):
    """Compact skill description — no body, safe for list views."""

    name: str
    title: str
    description: str
    triggers: list[str] = []
    tags: list[str] = []
    version: str = "1.0"


class ExtensionDetail(ExtensionSummary):
    """Full skill including body."""
    body: str


class ExtensionMatch(ExtensionSummary):
    """Semantic / keyword match result with similarity score."""
    score: float = 0.0


class ListExtensionsResponse(BaseModel):
    skills: list[ExtensionSummary]
    total: int


class SearchExtensionsResponse(BaseModel):
    matches: list[ExtensionSummary]
    total: int


class SemanticMatchResponse(BaseModel):
    matches: list[ExtensionMatch]
    total: int


# ── Helpers ──────────────────────────────────────────────────────


def _registry():
    """Lazy-load registry + bootstrap default skills idempotently."""
    from app.assistant.framework.extension_registry import (
        bootstrap_default_skills,
        extension_registry,
    )
    bootstrap_default_skills()
    return extension_registry


def _to_summary(skill) -> ExtensionSummary:
    return ExtensionSummary(
        name=skill.name,
        title=skill.title,
        description=skill.description,
        triggers=list(skill.triggers),
        tags=list(skill.tags),
        version=skill.version,
    )


# ── Endpoints ────────────────────────────────────────────────────


@router.get("/skills", response_model=ListExtensionsResponse)
def list_skills() -> ListExtensionsResponse:
    """List all registered skills (summary, no body)."""
    skills = _registry().all_skills()
    return ListExtensionsResponse(
        skills=[_to_summary(s) for s in skills],
        total=len(skills),
    )


@router.get("/skills/search", response_model=SearchExtensionsResponse)
def search_skills(
    query: str | None = Query(None, description="match against skill triggers (case-insensitive)"),
    tags: str = Query("", description="comma-separated; skill must have ALL tags"),
) -> SearchExtensionsResponse:
    """Keyword + tag search. AND semantics across provided criteria."""
    tag_list = [t.strip() for t in tags.split(",") if t.strip()] if tags else None
    if tag_list:
        tag_list = ["general" if t.lower() == "china" else t for t in tag_list]
    matches = _registry().match(
        query=query or None,
        tags=tag_list,
    )
    return SearchExtensionsResponse(
        matches=[_to_summary(s) for s in matches],
        total=len(matches),
    )


@router.get("/skills/search/semantic", response_model=SemanticMatchResponse)
def search_skills_semantic(
    query: str = Query(..., min_length=1),
    limit: int = Query(5, ge=1, le=50),
    min_similarity: float = Query(0.0, ge=-1.0, le=1.0),
) -> SemanticMatchResponse:
    """Embedding-based semantic skill match."""
    try:
        scored = _registry().match_semantic(
            query=query,
            limit=limit,
            min_similarity=min_similarity,
        )
    except Exception as exc:
        logger.error("semantic skill match failed: %s", exc)
        raise HTTPException(status_code=500, detail="semantic match failed")

    return SemanticMatchResponse(
        matches=[
            ExtensionMatch(score=round(score, 4), **model_to_dict(_to_summary(s)))
            for score, s in scored
        ],
        total=len(scored),
    )


@router.get("/skills/{name}", response_model=ExtensionDetail)
def get_skill(name: str) -> ExtensionDetail:
    """Fetch a single skill including the full body."""
    skill = _registry().get(name)
    if skill is None:
        raise HTTPException(status_code=404, detail=f"skill not found: {name}")
    return ExtensionDetail(
        **model_to_dict(_to_summary(skill)),
        body=skill.body,
    )
