from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.comment import Comment
from app.models.project import Project
from app.models.project_member import ProjectMember
from app.schemas.collaboration import CommentCreate, CommentOut, MemberCreate, MemberOut

router = APIRouter(tags=["collaboration"])

# 合法的成员角色
VALID_MEMBER_ROLES = {"owner", "editor", "viewer"}


def _must_get_project(project_id: int, db: Session) -> Project:
    """校验项目存在性，不存在则抛 404。"""
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


# --- Members ---

@router.post("/projects/{project_id}/members", response_model=MemberOut)
def add_member(
    project_id: int,
    payload: MemberCreate,
    db: Session = Depends(get_db),
) -> MemberOut:
    # 校验项目存在
    _must_get_project(project_id, db)
    # 校验角色合法性
    if payload.role not in VALID_MEMBER_ROLES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid role. Must be one of: {', '.join(sorted(VALID_MEMBER_ROLES))}",
        )
    m = ProjectMember(
        project_id=project_id,
        user_name=payload.user_name,
        role=payload.role,
    )
    db.add(m)
    db.commit()
    db.refresh(m)
    return MemberOut(id=m.id, project_id=m.project_id, user_name=m.user_name, role=m.role)


@router.get("/projects/{project_id}/members", response_model=list[MemberOut])
def list_members(
    project_id: int,
    db: Session = Depends(get_db),
) -> list[MemberOut]:
    rows = db.query(ProjectMember).filter(ProjectMember.project_id == project_id).all()
    return [MemberOut(id=r.id, project_id=r.project_id, user_name=r.user_name, role=r.role) for r in rows]


# --- Comments ---

@router.post("/projects/{project_id}/comments", response_model=CommentOut)
def add_comment(
    project_id: int,
    payload: CommentCreate,
    db: Session = Depends(get_db),
) -> CommentOut:
    # 校验项目存在
    _must_get_project(project_id, db)
    c = Comment(
        project_id=project_id,
        boq_item_id=payload.boq_item_id,
        author=payload.author,
        content=payload.content,
        # created_at 字段为 DateTime 类型，需传入 datetime 对象
        created_at=datetime.now(timezone.utc),
    )
    db.add(c)
    db.commit()
    db.refresh(c)
    return _comment_out(c)


@router.get("/projects/{project_id}/comments", response_model=list[CommentOut])
def list_comments(
    project_id: int,
    db: Session = Depends(get_db),
) -> list[CommentOut]:
    rows = (
        db.query(Comment)
        .filter(Comment.project_id == project_id)
        .order_by(Comment.id.desc())
        .all()
    )
    return [_comment_out(r) for r in rows]


def _comment_out(c: Comment) -> CommentOut:
    return CommentOut(
        id=c.id,
        project_id=c.project_id,
        boq_item_id=c.boq_item_id,
        author=c.author,
        content=c.content,
        created_at=c.created_at,
    )
