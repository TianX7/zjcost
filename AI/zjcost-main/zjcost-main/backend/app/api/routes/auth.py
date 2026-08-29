"""Authentication API — login, register, me."""

import os
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Header, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.main import limiter
from app.models.user import User
from app.services.auth_service import (
    authenticate_user,
    create_access_token,
    decode_access_token,
    hash_password,
)

router = APIRouter(prefix="/auth", tags=["auth"])


# ── Schemas ──

class LoginRequest(BaseModel):
    username: str = Field(max_length=128)
    password: str = Field(max_length=128)


class RegisterRequest(BaseModel):
    username: str = Field(max_length=128)
    password: str = Field(max_length=128)
    display_name: str = ""


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user_id: int
    username: str
    role: str
    display_name: str


class UserOut(BaseModel):
    id: int
    username: str
    display_name: str
    role: str


# ── Auth dependency ──

def get_current_user(
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db),
) -> User | None:
    """Extract current user from Authorization header. Returns None if no/invalid token.

    This is a soft dependency — routes can work without auth in dev mode.
    Use `require_role()` for strict enforcement.
    """
    if not authorization or not authorization.startswith("Bearer "):
        return None
    token = authorization[7:]
    payload = decode_access_token(token)
    if not payload:
        return None
    user_id = int(payload.get("sub", 0))
    return db.query(User).filter(User.id == user_id, User.is_active == 1).first()


def require_role(*allowed_roles: str):
    """FastAPI dependency factory that enforces role-based access."""
    def _check(
        authorization: Optional[str] = Header(None),
        db: Session = Depends(get_db),
    ) -> User:
        user = get_current_user(authorization=authorization, db=db)
        if not user:
            raise HTTPException(status_code=401, detail="认证失败，请登录")
        if user.role not in allowed_roles:
            raise HTTPException(status_code=403, detail=f"权限不足，需要角色: {', '.join(allowed_roles)}")
        return user
    return _check


def require_route_access(
    request: Request,
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db),
) -> User:
    """Enforce coarse app-wide RBAC when auth is enabled.

    Read-only requests allow viewers. Mutating requests require editors or
    owners. 辅助 provider settings contain secrets, so they are owner-only.
    """
    user = get_current_user(authorization=authorization, db=db)
    if not user:
        raise HTTPException(status_code=401, detail="认证失败，请登录")

    path = request.url.path
    method = request.method.upper()
    if path.startswith("/api/assistant/settings") or path.startswith("/api/assistant/test-connection"):
        allowed_roles = {"owner"}
    elif method in {"GET", "HEAD", "OPTIONS"}:
        allowed_roles = {"owner", "editor", "viewer"}
    else:
        allowed_roles = {"owner", "editor"}

    if user.role not in allowed_roles:
        raise HTTPException(status_code=403, detail=f"权限不足，需要角色: {', '.join(sorted(allowed_roles))}")
    return user


# ── Endpoints ──

@router.post("/login", response_model=TokenResponse)
@limiter.limit("5/minute")
def login(request: Request, payload: LoginRequest, db: Session = Depends(get_db)) -> TokenResponse:
    user = authenticate_user(db, payload.username, payload.password)
    if not user:
        raise HTTPException(status_code=401, detail="用户名或密码错误")
    token = create_access_token(user.id, user.username, user.role)
    return TokenResponse(
        access_token=token,
        user_id=user.id,
        username=user.username,
        role=user.role,
        display_name=user.display_name,
    )


@router.post("/register", response_model=TokenResponse)
def register(payload: RegisterRequest, db: Session = Depends(get_db)) -> TokenResponse:
    existing = db.query(User).filter(User.username == payload.username).first()
    if existing:
        raise HTTPException(status_code=400, detail="用户名已存在")

    auth_required = os.getenv("ZJCOST_AUTH_REQUIRED", "false").strip().lower() in {"1", "true", "yes", "on"}
    is_first_user = db.query(User.id).first() is None
    user = User(
        username=payload.username,
        hashed_password=hash_password(payload.password),
        display_name=payload.display_name or payload.username,
        role="owner" if auth_required and is_first_user else "viewer",
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    token = create_access_token(user.id, user.username, user.role)
    return TokenResponse(
        access_token=token,
        user_id=user.id,
        username=user.username,
        role=user.role,
        display_name=user.display_name,
    )


