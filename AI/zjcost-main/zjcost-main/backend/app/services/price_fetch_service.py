"""Price fetch engine: orchestrates adapters, saves to DB, background scheduler."""

from __future__ import annotations

import logging
import importlib
import threading
import time
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import and_

from app.db.session import SessionLocal
from app.models.material_price import MaterialPrice
from app.services.price_fetch.base import BasePriceFetcher, FetchedPrice
from app.utils.datetime import parse_datetime

logger = logging.getLogger(__name__)

ALL_ADAPTERS: list[BasePriceFetcher] = []
_ADAPTERS_LOADED = False
_ADAPTER_SPECS: tuple[tuple[str, str], ...] = (
    ("app.services.price_fetch.guangcai_adapter", "GuangcaiAdapter"),
    ("app.services.price_fetch.mysteel_adapter", "MysteelAdapter"),
    ("app.services.price_fetch.zaojiatong_adapter", "ZaojiatongAdapter"),
    ("app.services.price_fetch.regional_gov_adapter", "RegionalGovAdapter"),
    ("app.services.price_fetch.web_search_adapter", "WebSearchAdapter"),
)


def _ensure_adapters_loaded() -> None:
    global _ADAPTERS_LOADED
    if _ADAPTERS_LOADED:
        return

    loaded: list[BasePriceFetcher] = []
    for module_name, class_name in _ADAPTER_SPECS:
        try:
            module = importlib.import_module(module_name)
            adapter_cls = getattr(module, class_name)
            loaded.append(adapter_cls())
        except Exception as exc:
            logger.warning("Price adapter unavailable: %s.%s (%s)", module_name, class_name, exc)

    ALL_ADAPTERS[:] = loaded
    _ADAPTERS_LOADED = True


def _adapter_by_name(name: str) -> BasePriceFetcher | None:
    _ensure_adapters_loaded()
    for a in ALL_ADAPTERS:
        if a.source_name == name:
            return a
    return None


def get_available_adapters() -> list[BasePriceFetcher]:
    _ensure_adapters_loaded()
    return [a for a in ALL_ADAPTERS if a.is_available()]


def get_all_adapters() -> list[BasePriceFetcher]:
    _ensure_adapters_loaded()
    return list(ALL_ADAPTERS)


def fetch_prices_from_source(
    source_name: str,
    query: str | None = None,
    region: str = "",
    category: str = "",
    page: int = 1,
) -> tuple[list[FetchedPrice], str | None]:
    adapter = _adapter_by_name(source_name)
    if adapter is None:
        return [], f"Unknown source: {source_name}"
    try:
        prices = adapter.fetch(query=query, region=region, category=category, page=page)
        return prices, None
    except Exception as e:
        return [], str(e)


def fetch_all_sources(
    query: str | None = None,
    region: str = "",
    category: str = "",
) -> dict[str, list[FetchedPrice]]:
    result: dict[str, list[FetchedPrice]] = {}
    for adapter in ALL_ADAPTERS:
        if not adapter.is_available():
            continue
        try:
            prices = adapter.fetch(query=query, region=region, category=category)
            if prices:
                result[adapter.source_name] = prices
        except Exception as e:
            logger.warning("Fetch from %s failed: %s", adapter.source_name, e)
    return result


# ── Built-in reference prices (fallback when web scraping is unavailable) ──

def _with_specialty_reference_prices(data: list[dict[str, Any]]) -> list[dict[str, Any]]:
    try:
        from app.data.specialty_catalog import SPECIALTY_MATERIAL_PRICES
    except Exception:
        return data

    merged = list(data)
    seen: set[tuple[str, str, str, str]] = {
        (
            str(item.get("code", "")),
            str(item.get("name", "")),
            str(item.get("spec", "")),
            str(item.get("region", "")),
        )
        for item in merged
    }
    for item in SPECIALTY_MATERIAL_PRICES:
        key = (
            str(item.get("code", "")),
            str(item.get("name", "")),
            str(item.get("spec", "")),
            str(item.get("region", "")),
        )
        if key in seen:
            continue
        merged.append(dict(item))
        seen.add(key)
    return merged

def _load_reference_prices() -> list[dict[str, Any]]:
    """Load reference prices from JSON file, with hardcoded fallback."""
    import json as _json
    import os as _os
    json_path = _os.path.join(_os.path.dirname(__file__), "price_fetch", "reference_prices.json")
    try:
        with open(json_path, "r", encoding="utf-8") as f:
            data = _json.load(f)
            if isinstance(data, list) and len(data) > 0:
                return _with_specialty_reference_prices(data)
    except Exception:
        pass
    return _with_specialty_reference_prices(_HARDCODED_REFERENCE_PRICES)

_HARDCODED_REFERENCE_PRICES: list[dict[str, Any]] = [
    # 钢材 (Steel)
    {"name": "热轧圆钢", "spec": "HPB300 Φ6.5", "unit": "t", "unit_price": 3850, "region": "区域A", "source": "reference", "category": "钢材"},
    {"name": "热轧圆钢", "spec": "HPB300 Φ8", "unit": "t", "unit_price": 3780, "region": "区域A", "source": "reference", "category": "钢材"},
    {"name": "热轧圆钢", "spec": "HPB300 Φ10", "unit": "t", "unit_price": 3720, "region": "区域A", "source": "reference", "category": "钢材"},
    {"name": "螺纹钢", "spec": "HRB400 Φ12", "unit": "t", "unit_price": 3650, "region": "区域B", "source": "reference", "category": "钢材"},
    {"name": "螺纹钢", "spec": "HRB400 Φ16", "unit": "t", "unit_price": 3580, "region": "区域B", "source": "reference", "category": "钢材"},
    {"name": "螺纹钢", "spec": "HRB400 Φ20", "unit": "t", "unit_price": 3520, "region": "区域B", "source": "reference", "category": "钢材"},
    {"name": "螺纹钢", "spec": "HRB400 Φ25", "unit": "t", "unit_price": 3500, "region": "区域B", "source": "reference", "category": "钢材"},
    {"name": "盘螺", "spec": "HRB400 Φ8", "unit": "t", "unit_price": 3710, "region": "区域C", "source": "reference", "category": "钢材"},
    {"name": "盘螺", "spec": "HRB400 Φ10", "unit": "t", "unit_price": 3680, "region": "区域C", "source": "reference", "category": "钢材"},
    {"name": "工字钢", "spec": "Q235B 25a#", "unit": "t", "unit_price": 3980, "region": "区域A", "source": "reference", "category": "钢材"},
    {"name": "槽钢", "spec": "Q235B 16#", "unit": "t", "unit_price": 3850, "region": "区域A", "source": "reference", "category": "钢材"},
    {"name": "热轧钢板", "spec": "Q235B 10mm", "unit": "t", "unit_price": 4100, "region": "区域B", "source": "reference", "category": "钢材"},
    {"name": "热轧钢板", "spec": "Q235B 20mm", "unit": "t", "unit_price": 4050, "region": "区域B", "source": "reference", "category": "钢材"},
    {"name": "无缝钢管", "spec": "20# Φ108×4.5", "unit": "t", "unit_price": 5200, "region": "区域D", "source": "reference", "category": "钢材"},
    {"name": "焊管", "spec": "Q235B DN50", "unit": "t", "unit_price": 3980, "region": "区域D", "source": "reference", "category": "钢材"},
    # 水泥 (Cement)
    {"name": "普通硅酸盐水泥", "spec": "P.O 42.5 袋装", "unit": "t", "unit_price": 480, "region": "区域A", "source": "reference", "category": "水泥"},
    {"name": "普通硅酸盐水泥", "spec": "P.O 42.5 散装", "unit": "t", "unit_price": 450, "region": "区域A", "source": "reference", "category": "水泥"},
    {"name": "普通硅酸盐水泥", "spec": "P.O 42.5 袋装", "unit": "t", "unit_price": 460, "region": "区域B", "source": "reference", "category": "水泥"},
    {"name": "复合硅酸盐水泥", "spec": "P.C 32.5 袋装", "unit": "t", "unit_price": 380, "region": "区域A", "source": "reference", "category": "水泥"},
    # 混凝土 (Concrete)
    {"name": "商品混凝土", "spec": "C20 泵送", "unit": "m³", "unit_price": 420, "region": "区域A", "source": "reference", "category": "混凝土"},
    {"name": "商品混凝土", "spec": "C25 泵送", "unit": "m³", "unit_price": 445, "region": "区域A", "source": "reference", "category": "混凝土"},
    {"name": "商品混凝土", "spec": "C30 泵送", "unit": "m³", "unit_price": 470, "region": "区域B", "source": "reference", "category": "混凝土"},
    {"name": "商品混凝土", "spec": "C35 泵送", "unit": "m³", "unit_price": 498, "region": "区域B", "source": "reference", "category": "混凝土"},
    {"name": "商品混凝土", "spec": "C40 泵送", "unit": "m³", "unit_price": 530, "region": "区域C", "source": "reference", "category": "混凝土"},
    # 木材 (Wood)
    {"name": "木模板", "spec": "1830×915×15mm", "unit": "张", "unit_price": 58, "region": "区域A", "source": "reference", "category": "木材"},
    {"name": "木方", "spec": "50×100×4000mm", "unit": "m³", "unit_price": 1850, "region": "区域A", "source": "reference", "category": "木材"},
    {"name": "木方", "spec": "50×100×4000mm", "unit": "m³", "unit_price": 1780, "region": "区域B", "source": "reference", "category": "木材"},
    {"name": "胶合板", "spec": "1220×2440×12mm", "unit": "张", "unit_price": 85, "region": "区域A", "source": "reference", "category": "木材"},
    # 砂石 (Sand & Stone)
    {"name": "机制砂", "spec": "中砂", "unit": "m³", "unit_price": 135, "region": "区域A", "source": "reference", "category": "砂石"},
    {"name": "碎石", "spec": "5-31.5mm", "unit": "m³", "unit_price": 128, "region": "区域A", "source": "reference", "category": "砂石"},
    {"name": "碎石", "spec": "5-31.5mm", "unit": "m³", "unit_price": 118, "region": "区域B", "source": "reference", "category": "砂石"},
    # 砖瓦 (Brick)
    {"name": "烧结页岩砖", "spec": "240×115×53mm MU10", "unit": "千块", "unit_price": 580, "region": "区域A", "source": "reference", "category": "砖瓦"},
    {"name": "加气混凝土砌块", "spec": "600×240×200mm", "unit": "m³", "unit_price": 320, "region": "区域B", "source": "reference", "category": "砖瓦"},
    {"name": "加气混凝土砌块", "spec": "600×240×100mm", "unit": "m³", "unit_price": 340, "region": "区域B", "source": "reference", "category": "砖瓦"},
    # 管材 (Pipes)
    {"name": "PVC-U排水管", "spec": "DN110×3.2mm", "unit": "m", "unit_price": 32, "region": "区域A", "source": "reference", "category": "管材"},
    {"name": "PPR给水管", "spec": "DN25×2.8mm S3.2", "unit": "m", "unit_price": 18, "region": "区域A", "source": "reference", "category": "管材"},
    {"name": "PPR给水管", "spec": "DN32×3.6mm S3.2", "unit": "m", "unit_price": 25, "region": "区域A", "source": "reference", "category": "管材"},
    {"name": "镀锌钢管", "spec": "DN25 壁厚3.25mm", "unit": "m", "unit_price": 45, "region": "区域B", "source": "reference", "category": "管材"},
    {"name": "镀锌钢管", "spec": "DN50 壁厚3.5mm", "unit": "m", "unit_price": 68, "region": "区域B", "source": "reference", "category": "管材"},
    # 装饰材料 (Decoration)
    {"name": "内墙乳胶漆", "spec": "白色 18L", "unit": "桶", "unit_price": 380, "region": "区域A", "source": "reference", "category": "装饰材料"},
    {"name": "外墙涂料", "spec": "弹性拉花 25kg", "unit": "桶", "unit_price": 420, "region": "区域A", "source": "reference", "category": "装饰材料"},
    {"name": "地面瓷砖", "spec": "800×800mm 抛光", "unit": "m²", "unit_price": 85, "region": "区域C", "source": "reference", "category": "装饰材料"},
    {"name": "墙面瓷砖", "spec": "300×600mm 釉面", "unit": "m²", "unit_price": 65, "region": "区域C", "source": "reference", "category": "装饰材料"},
    # 防水材料 (Waterproofing)
    {"name": "SBS改性沥青防水卷材", "spec": "3mm 聚酯胎", "unit": "m²", "unit_price": 28, "region": "区域A", "source": "reference", "category": "防水材料"},
    {"name": "SBS改性沥青防水卷材", "spec": "4mm 聚酯胎", "unit": "m²", "unit_price": 35, "region": "区域A", "source": "reference", "category": "防水材料"},
    {"name": "聚合物水泥防水涂料", "spec": "JS-II型 20kg", "unit": "桶", "unit_price": 260, "region": "区域B", "source": "reference", "category": "防水材料"},
    # 保温材料 (Insulation)
    {"name": "挤塑聚苯板", "spec": "XPS B1级 50mm", "unit": "m²", "unit_price": 38, "region": "区域A", "source": "reference", "category": "保温材料"},
    {"name": "岩棉板", "spec": "100kg/m³ 50mm", "unit": "m²", "unit_price": 32, "region": "区域A", "source": "reference", "category": "保温材料"},
    # 门窗 (Doors & Windows)
    {"name": "断桥铝合金窗", "spec": "5+12A+5中空玻璃", "unit": "m²", "unit_price": 650, "region": "区域A", "source": "reference", "category": "门窗"},
    {"name": "塑钢窗", "spec": "60系列 5mm单玻", "unit": "m²", "unit_price": 320, "region": "区域A", "source": "reference", "category": "门窗"},
    {"name": "防盗门", "spec": "钢制 甲级 960×2050", "unit": "樘", "unit_price": 1850, "region": "区域B", "source": "reference", "category": "门窗"},
    # 电气管材
    {"name": "PVC电工套管", "spec": "DN20 中型", "unit": "m", "unit_price": 3.5, "region": "区域A", "source": "reference", "category": "安装材料"},
    {"name": "PVC电工套管", "spec": "DN25 中型", "unit": "m", "unit_price": 5.2, "region": "区域A", "source": "reference", "category": "安装材料"},
    {"name": "铜芯电线", "spec": "BV 2.5mm²", "unit": "m", "unit_price": 2.8, "region": "区域B", "source": "reference", "category": "安装材料"},
    {"name": "铜芯电线", "spec": "BV 4mm²", "unit": "m", "unit_price": 4.2, "region": "区域B", "source": "reference", "category": "安装材料"},
    # More regional variants
    {"name": "螺纹钢", "spec": "HRB400 Φ16", "unit": "t", "unit_price": 3620, "region": "区域C", "source": "reference", "category": "钢材"},
    {"name": "螺纹钢", "spec": "HRB400 Φ16", "unit": "t", "unit_price": 3550, "region": "区域E", "source": "reference", "category": "钢材"},
    {"name": "商品混凝土", "spec": "C30 泵送", "unit": "m³", "unit_price": 460, "region": "区域F", "source": "reference", "category": "混凝土"},
    {"name": "商品混凝土", "spec": "C30 泵送", "unit": "m³", "unit_price": 475, "region": "区域G", "source": "reference", "category": "混凝土"},
    {"name": "普通硅酸盐水泥", "spec": "P.O 42.5 散装", "unit": "t", "unit_price": 445, "region": "区域E", "source": "reference", "category": "水泥"},
    {"name": "碎石", "spec": "5-31.5mm", "unit": "m³", "unit_price": 125, "region": "区域F", "source": "reference", "category": "砂石"},
]


def _match_reference_material(mat: dict, query: str | None, region: str, category: str) -> bool:
    if region and mat.get("region", "") != region:
        # Also try fuzzy region matching (e.g. "区域A地区" contains "区域A")
        if region not in mat.get("region", ""):
            return False
    if category and mat.get("category", "") != category:
        return False
    if query:
        q = query.lower()
        if q not in mat.get("name", "").lower() and q not in mat.get("spec", "").lower():
            return False
    return True


def get_reference_prices(
    query: str | None = None,
    region: str = "",
    category: str = "",
) -> list[FetchedPrice]:
    """Return built-in reference prices as fallback when web scraping is unavailable."""
    from datetime import date
    today = date.today().isoformat()

    results: list[FetchedPrice] = []
    for mat in _load_reference_prices():
        if not _match_reference_material(mat, query, region, category):
            continue
        results.append(FetchedPrice(
            code=str(mat.get("code", "")),
            name=mat["name"],
            spec=mat["spec"],
            unit=mat["unit"],
            unit_price=mat["unit_price"],
            region=mat["region"],
            effective_date=today,
            source=mat["source"],
            raw_data={"category": mat.get("category", "")},
        ))
    return results


def save_fetched_prices(prices: list[FetchedPrice], db=None, replace_source_snapshot: bool = False) -> int:
    close_db = db is None
    if db is None:
        db = SessionLocal()

    try:
        saved = 0
        fetched_at = datetime.now(timezone.utc)
        valid_prices = [p for p in prices if p.unit_price > 0]

        if replace_source_snapshot and valid_prices:
            scopes = {(p.source, p.region) for p in valid_prices}
            for source, region in scopes:
                (
                    db.query(MaterialPrice)
                    .filter(
                        and_(
                            MaterialPrice.source == source,
                            MaterialPrice.region == region,
                        )
                    )
                    .delete(synchronize_session=False)
                )

        for p in valid_prices:
            existing = (
                db.query(MaterialPrice)
                .filter(
                    and_(
                        MaterialPrice.name == p.name,
                        MaterialPrice.spec == p.spec,
                        MaterialPrice.region == p.region,
                        MaterialPrice.source == p.source,
                        MaterialPrice.effective_date == p.effective_date,
                    )
                )
                .first()
            )

            if existing:
                existing.unit_price = p.unit_price
                existing.fetched_at = fetched_at
            else:
                mp = MaterialPrice(
                    code=p.code or "",
                    name=p.name,
                    spec=p.spec,
                    unit=p.unit,
                    unit_price=p.unit_price,
                    source=p.source,
                    region=p.region,
                    effective_date=p.effective_date,
                    fetched_at=fetched_at,
                )
                db.add(mp)
            saved += 1

        db.commit()
        return saved
    except Exception:
        db.rollback()
        raise
    finally:
        if close_db:
            try:
                db.close()
            except Exception:
                pass


class PriceFetchScheduler:
    def __init__(self):
        self._thread: threading.Thread | None = None
        self._stop_event = threading.Event()
        self._interval_hours: int = 24
        self._last_fetch: dict[str, Any] = {}

    def start(self, interval_hours: int = 24):
        if self._thread and self._thread.is_alive():
            return
        self._interval_hours = interval_hours
        self._stop_event.clear()
        self._thread = threading.Thread(target=self._loop, daemon=True)
        self._thread.start()
        logger.info("Price fetch scheduler started (interval=%dh)", interval_hours)

    def stop(self):
        self._stop_event.set()
        if self._thread:
            self._thread.join(timeout=5)
        logger.info("Price fetch scheduler stopped")

    def is_running(self) -> bool:
        return self._thread is not None and self._thread.is_alive()

    def get_status(self) -> dict[str, Any]:
        next_fetch = None
        if self._last_fetch.get("completed_at"):
            last = parse_datetime(self._last_fetch["completed_at"])
            if last is not None:
                next_fetch_ts = last.timestamp() + self._interval_hours * 3600
                next_fetch = datetime.fromtimestamp(next_fetch_ts, tz=timezone.utc).isoformat()

        return {
            "running": self.is_running(),
            "interval_hours": self._interval_hours,
            "last_fetch_at": self._last_fetch.get("completed_at"),
            "last_fetch_success": self._last_fetch.get("success", False),
            "last_fetch_sources": self._last_fetch.get("sources", 0),
            "last_fetch_count": self._last_fetch.get("count", 0),
            "last_fetch_error": self._last_fetch.get("error", ""),
            "next_fetch_at": next_fetch,
        }

    def _loop(self):
        while not self._stop_event.wait(self._interval_hours * 3600):
            self._run_once()

    def _run_once(self):
        started = datetime.now(timezone.utc).isoformat()
        try:
            total = 0
            sources = 0
            for adapter in ALL_ADAPTERS:
                if not adapter.is_available():
                    continue
                try:
                    prices = adapter.fetch()
                    if prices:
                        saved = save_fetched_prices(prices, replace_source_snapshot=True)
                        total += saved
                        sources += 1
                except Exception as e:
                    logger.warning("Scheduler fetch %s failed: %s", adapter.source_name, e)

            # Fallback to reference prices if no online data was collected
            if total == 0:
                try:
                    ref_prices = get_reference_prices()
                    if ref_prices:
                        total = save_fetched_prices(ref_prices, replace_source_snapshot=True)
                        sources = 1  # reference
                except Exception as e:
                    logger.warning("Reference price fallback failed: %s", e)

            self._last_fetch = {
                "started_at": started,
                "completed_at": datetime.now(timezone.utc).isoformat(),
                "success": True,
                "sources": sources,
                "count": total,
                "error": "",
            }
        except Exception as e:
            self._last_fetch = {
                "started_at": started,
                "completed_at": datetime.now(timezone.utc).isoformat(),
                "success": False,
                "sources": 0,
                "count": 0,
                "error": str(e),
            }
