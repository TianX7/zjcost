from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.compat import model_to_dict
from app.db.session import get_db
from app.models.project import Project
from app.models.rule_package import RulePackage
from app.schemas.project import ProjectOut
from app.schemas.rule_package import RulePackageBindRequest, RulePackageCreate, RulePackageOut
from app.services.audit_service import write_audit_log

import json

router = APIRouter(tags=["rule-packages"])


@router.post("/rule-packages", response_model=RulePackageOut)
def create_rule_package(
    payload: RulePackageCreate,
    db: Session = Depends(get_db),
) -> RulePackageOut:
    rp = RulePackage(**model_to_dict(payload))
    db.add(rp)
    db.commit()
    db.refresh(rp)
    return _to_out(rp)


@router.get("/rule-packages", response_model=list[RulePackageOut])
def list_rule_packages(db: Session = Depends(get_db)) -> list[RulePackageOut]:
    rows = db.query(RulePackage).all()
    return [_to_out(r) for r in rows]


@router.put("/rule-packages/{rule_package_id}", response_model=RulePackageOut)
def update_rule_package(
    rule_package_id: int,
    payload: RulePackageCreate,
    db: Session = Depends(get_db),
) -> RulePackageOut:
    rp = db.query(RulePackage).filter(RulePackage.id == rule_package_id).first()
    if not rp:
        raise HTTPException(status_code=404, detail=f"规则包不存在：id={rule_package_id}")
    for key, value in model_to_dict(payload).items():
        setattr(rp, key, value)
    db.commit()
    db.refresh(rp)
    return _to_out(rp)


@router.delete("/rule-packages/{rule_package_id}")
def delete_rule_package(rule_package_id: int, db: Session = Depends(get_db)):
    """删除规则包；已绑定该包的项目将解绑（回到默认费率），需注意影响。"""
    rp = db.query(RulePackage).filter(RulePackage.id == rule_package_id).first()
    if not rp:
        raise HTTPException(status_code=404, detail=f"规则包不存在：id={rule_package_id}")
    bound = db.query(Project).filter(Project.rule_package_id == rule_package_id).count()
    # 解绑引用该规则包的项目
    db.query(Project).filter(Project.rule_package_id == rule_package_id).update(
        {Project.rule_package_id: None},
        synchronize_session=False,
    )
    db.delete(rp)
    db.commit()
    return {
        "ok": True,
        "bound_projects_released": bound,
        "message": f"已删除规则包「{rp.name}」，{bound} 个项目解绑回默认费率",
    }


@router.post("/projects/{project_id}/rule-package:bind", response_model=ProjectOut)
def bind_rule_package(
    project_id: int,
    payload: RulePackageBindRequest,
    db: Session = Depends(get_db),
) -> ProjectOut:
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    rp = db.query(RulePackage).filter(RulePackage.id == payload.rule_package_id).first()
    if not rp:
        raise HTTPException(status_code=404, detail="Rule package not found")

    old_rp_id = project.rule_package_id
    project.rule_package_id = rp.id
    db.commit()
    db.refresh(project)

    write_audit_log(
        db=db,
        project_id=project.id,
        action="bind_rule_package",
        resource_type="project",
        resource_id=project.id,
        before_json=json.dumps({"rule_package_id": old_rp_id}),
        after_json=json.dumps({"rule_package_id": rp.id}),
    )
    # audit_service 仅 flush 不 commit，路由层需显式提交以持久化审计日志
    db.commit()
    db.refresh(project)

    # 从 ORM 对象构建 ProjectOut，避免遗漏必填字段
    project_out = ProjectOut.model_validate(project, from_attributes=True)
    return project_out


def _to_out(rp: RulePackage) -> RulePackageOut:
    return RulePackageOut(
        id=rp.id,
        name=rp.name,
        region=rp.region,
        management_rate=rp.management_rate,
        profit_rate=rp.profit_rate,
        regulatory_rate=rp.regulatory_rate,
        tax_rate=rp.tax_rate,
        regulatory_base=getattr(rp, "regulatory_base", "direct"),
        rounding_rule=rp.rounding_rule,
        version=rp.version,
    )
