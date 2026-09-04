from datetime import datetime

from sqlalchemy import DateTime, Float, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class QuotaItem(Base):
    __tablename__ = "quota_items"
    # 唯一约束：同专业下定额编码唯一（section 7）
    __table_args__ = (
        UniqueConstraint("discipline", "quota_code", name="uq_quota_item_discipline_code"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    # 常用查询字段添加索引（section 6）
    quota_code: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    discipline: Mapped[str] = mapped_column(String(50), nullable=False, default="土建", index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    unit: Mapped[str] = mapped_column(String(50), nullable=False)
    labor_qty: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    material_qty: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    machine_qty: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    # ── Extended business knowledge fields ──
    work_content: Mapped[str] = mapped_column(Text, nullable=False, default="")  # 工作内容描述
    applicable_scope: Mapped[str] = mapped_column(Text, nullable=False, default="")  # 适用范围与条件
    chapter: Mapped[str] = mapped_column(String(100), nullable=False, default="")  # 所属章节/分部
    version: Mapped[str] = mapped_column(String(50), nullable=False, default="")  # 定额版本（如"2018通用版"）
    base_price: Mapped[float] = mapped_column(Float, nullable=False, default=0)  # 综合单价（元）= 回收 + 加工 + 运输
    has_resource_details: Mapped[int] = mapped_column(Integer, nullable=False, default=0)  # 1=有明细
    # ── 循环材料三级计价（回收价 / 加工价 / 运输价） ──
    recycle_price: Mapped[float] = mapped_column(Float, nullable=False, default=0)  # 回收价（元/单位）
    process_price: Mapped[float] = mapped_column(Float, nullable=False, default=0)  # 加工价（元/单位）
    transport_price: Mapped[float] = mapped_column(Float, nullable=False, default=0)  # 运输价（元/单位）
    # ── 旧材料（遗址修复材料）扩展字段 ──
    # 获取方式：recycle=当地回收旧材料 / reproduce=原材料复现 / 空字符串=普通定额
    acquisition_method: Mapped[str] = mapped_column(
        String(20), nullable=False, default="", index=True,
    )
    origin_note: Mapped[str] = mapped_column(
        Text, nullable=False, default="",  # 来源说明（回收地点或复现依据）
    )
    heritage_site: Mapped[str] = mapped_column(
        String(255), nullable=False, default="",  # 关联遗址/文物名称
    )
    relic_level: Mapped[str] = mapped_column(
        String(50), nullable=False, default="",  # 文物等级（国家级/省级/市县级/一般）
    )
    repair_part: Mapped[str] = mapped_column(
        String(255), nullable=False, default="",  # 修复部位（如屋面、墙体、梁架）
    )
    condition_grade: Mapped[str] = mapped_column(
        String(50), nullable=False, default="",  # 成新率/成色（如 8成新、85%）
    )
    batch_no: Mapped[str] = mapped_column(
        String(100), nullable=False, default="",  # 批次号
    )
    inspection_report_no: Mapped[str] = mapped_column(
        String(100), nullable=False, default="",  # 检测报告编号
    )
    # 补充审计字段（section 3），nullable=True 保持向后兼容
    created_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=True,
    )
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), server_default=func.now(),
        onupdate=func.now(), nullable=True,
    )
