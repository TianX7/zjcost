from datetime import datetime

from sqlalchemy import DateTime, Float, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class RiskSimulation(Base):
    """动态管控-风险模拟历史留痕：每次"开始模拟"保存输入参数与结果。"""

    __tablename__ = "risk_simulations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    weather: Mapped[str] = mapped_column(String(50), nullable=False, default="calm")  # 天气窗口 key
    price: Mapped[str] = mapped_column(String(50), nullable=False, default="flat")   # 建材市场价 key
    schedule: Mapped[str] = mapped_column(String(50), nullable=False, default="normal")  # 施工进度 key
    # 结果字段
    peak: Mapped[float] = mapped_column(Float, nullable=False, default=0)   # 不应对峰值
    after: Mapped[float] = mapped_column(Float, nullable=False, default=0)  # 采取应对后
    level: Mapped[str] = mapped_column(String(20), nullable=False, default="low")  # high / medium / low
    touched: Mapped[str] = mapped_column(Text, nullable=False, default="")  # 不利因子说明（JSON 数组）
    advice: Mapped[str] = mapped_column(Text, nullable=False, default="")   # 系统应对建议（JSON 数组）
    # 统一审计字段
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False,
    )