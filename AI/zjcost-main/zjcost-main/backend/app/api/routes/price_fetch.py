"""Price fetch API: manage sources, trigger fetches, control scheduler."""

from __future__ import annotations

import logging
import threading
import time
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.schemas.price_fetch import (
    FetchRequest,
    FetchResponse,
    FetchResult,
    ImportToMaterialPricesRequest,
    PreviewPriceItem,
    PreviewResponse,
    PriceSourceInfo,
    SchedulerStartRequest,
    SchedulerStatus,
    SourceHealthInfo,
)
from app.services.price_fetch_service import (
    PriceFetchScheduler,
    _adapter_by_name,
    fetch_prices_from_source,
    get_all_adapters,
    get_reference_prices,
    save_fetched_prices,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/price-fetch", tags=["price-fetch"])

_scheduler: PriceFetchScheduler | None = None
_scheduler_lock = threading.Lock()
_last_fetch_status: dict = {}


def _iso_or_none(value) -> str | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.isoformat()
    return str(value)


def get_scheduler() -> PriceFetchScheduler:
    global _scheduler
    with _scheduler_lock:
        if _scheduler is None:
            _scheduler = PriceFetchScheduler()
        return _scheduler


@router.get("/sources", response_model=list[PriceSourceInfo])
def list_sources(db: Session = Depends(get_db)):
    from sqlalchemy import func

    from app.models.material_price import MaterialPrice

    try:
        source_stats = {}
        rows = (
            db.query(
                MaterialPrice.source,
                func.count(MaterialPrice.id).label("cnt"),
                func.max(MaterialPrice.fetched_at).label("last_fetch"),
            )
            .group_by(MaterialPrice.source)
            .all()
        )
        for source, cnt, last_fetch in rows:
            source_stats[source] = {"count": cnt, "last_fetch": last_fetch}
    except Exception:
        source_stats = {}
    # db 由 Depends(get_db) 管理生命周期，这里不应手动 close

    result: list[PriceSourceInfo] = []
    for adapter in get_all_adapters():
        stats = source_stats.get(adapter.source_name, {})
        result.append(PriceSourceInfo(
            source_name=adapter.source_name,
            display_name=adapter.display_name,
            available=True,
            supports_regions=adapter.supported_regions,
            supports_categories=adapter.supported_categories,
            last_success_at=_iso_or_none(stats.get("last_fetch")),
            total_prices_fetched=stats.get("count", 0),
            error=None,
        ))

    reference_stats = source_stats.get("reference", {})
    result.append(PriceSourceInfo(
        source_name="reference",
        display_name="内置参考价",
        available=True,
        supports_regions=[],
        supports_categories=[],
        last_success_at=_iso_or_none(reference_stats.get("last_fetch")),
        total_prices_fetched=reference_stats.get("count", 0),
        error=None,
    ))
    return result


@router.post("/fetch", response_model=FetchResponse)
def trigger_fetch(body: FetchRequest = FetchRequest()):
    started = datetime.now(timezone.utc)
    sources = body.source_names or [adapter.source_name for adapter in get_all_adapters()]
    results: list[FetchResult] = []
    total_fetched = 0
    total_saved = 0

    for source_name in sources:
        t0 = time.time()
        error = None
        fetched = 0
        saved = 0
        prices = []
        try:
            if source_name == "reference":
                prices = get_reference_prices(
                    query=body.query,
                    region=body.region,
                    category=body.category,
                )
                fetched = len(prices)
                if not prices:
                    error = "未找到匹配的内置材料参考价"
            else:
                prices, err = fetch_prices_from_source(
                    source_name,
                    query=body.query,
                    region=body.region,
                    category=body.category,
                )
                if err:
                    error = err
                else:
                    fetched = len(prices)

            if source_name != "reference" and fetched == 0:
                ref_prices = get_reference_prices(
                    query=body.query,
                    region=body.region,
                    category=body.category,
                )
                if ref_prices and not error:
                    error = "在线采集无结果，已切换为内置参考价"
                prices = ref_prices
                fetched = len(prices)

            if prices:
                saved = save_fetched_prices(prices, replace_source_snapshot=not bool(body.query))
                total_fetched += fetched
                total_saved += saved
        except Exception as exc:
            error = str(exc)

        results.append(FetchResult(
            source_name=source_name,
            fetched=fetched,
            new_or_updated=saved,
            duration_s=round(time.time() - t0, 2),
            error=error,
        ))

    if not results or total_fetched == 0:
        t0 = time.time()
        fallback_error = None
        fallback_prices = []
        fallback_saved = 0
        try:
            fallback_prices = get_reference_prices(
                query=body.query,
                region=body.region,
                category=body.category,
            )
            if fallback_prices:
                fallback_saved = save_fetched_prices(fallback_prices, replace_source_snapshot=not bool(body.query))
                total_fetched += len(fallback_prices)
                total_saved += fallback_saved
            else:
                fallback_error = "未找到匹配的内置材料参考价"
        except Exception as exc:
            fallback_error = str(exc)

        results.append(FetchResult(
            source_name="reference",
            fetched=len(fallback_prices),
            new_or_updated=fallback_saved,
            duration_s=round(time.time() - t0, 2),
            error=fallback_error,
        ))

    completed = datetime.now(timezone.utc).isoformat()
    global _last_fetch_status
    _last_fetch_status = {
        "started_at": started.isoformat(),
        "completed_at": completed,
        "total_fetched": total_fetched,
        "total_saved": total_saved,
        "sources": len(results),
        "error": None,
    }

    return FetchResponse(
        total_fetched=total_fetched,
        total_new_or_updated=total_saved,
        results=results,
        started_at=started.isoformat(),
        completed_at=completed,
    )


@router.get("/status", response_model=FetchResponse)
def get_last_fetch_status():
    global _last_fetch_status
    if not _last_fetch_status:
        return FetchResponse(total_fetched=0, total_new_or_updated=0)
    return FetchResponse(
        total_fetched=_last_fetch_status.get("total_fetched", 0),
        total_new_or_updated=_last_fetch_status.get("total_saved", 0),
        started_at=_last_fetch_status.get("started_at", ""),
        completed_at=_last_fetch_status.get("completed_at", ""),
    )


@router.get("/scheduler/status", response_model=SchedulerStatus)
def scheduler_status():
    scheduler = get_scheduler()
    return SchedulerStatus(**scheduler.get_status())


@router.post("/scheduler/start")
def scheduler_start(body: SchedulerStartRequest = SchedulerStartRequest()):
    scheduler = get_scheduler()
    scheduler.start(interval_hours=body.interval_hours)
    return {"ok": True, "message": f"scheduler started, interval={body.interval_hours}h"}


@router.post("/scheduler/stop")
def scheduler_stop():
    scheduler = get_scheduler()
    scheduler.stop()
    return {"ok": True, "message": "scheduler stopped"}


@router.post("/import-to-material-prices")
def import_to_material_prices(body: ImportToMaterialPricesRequest):
    adapter = _adapter_by_name(body.source_name)
    if adapter is None:
        raise HTTPException(400, f"Unknown source: {body.source_name}")
    try:
        prices = adapter.fetch(query=body.query, region=body.region)
        if not prices:
            raise HTTPException(404, "no prices fetched")
        saved = save_fetched_prices(prices, replace_source_snapshot=not bool(body.query))
        return {"imported": saved, "source": body.source_name, "region": body.region}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(500, f"import failed: {exc}")


@router.get("/sources/health", response_model=list[SourceHealthInfo])
def sources_health():
    """实时检测所有采集源的健康状态。"""
    result: list[SourceHealthInfo] = []
    for adapter in get_all_adapters():
        health = adapter.health_check()
        result.append(SourceHealthInfo(
            source_name=adapter.source_name,
            display_name=adapter.display_name,
            available=health["ok"],
            latency_ms=health["latency_ms"],
            error=health["error"] or None,
        ))
    return result


@router.post("/preview", response_model=PreviewResponse)
def preview_fetch(body: FetchRequest = FetchRequest()):
    """预览采集结果，不写入数据库。"""
    import time as _time
    t0 = _time.time()
    sources_tried: list[str] = []
    all_prices: list = []

    source_names = body.source_names or [a.source_name for a in get_all_adapters()]
    for source_name in source_names:
        sources_tried.append(source_name)
        try:
            if source_name == "reference":
                prices = get_reference_prices(
                    query=body.query, region=body.region, category=body.category
                )
            else:
                prices, _ = fetch_prices_from_source(
                    source_name,
                    query=body.query,
                    region=body.region,
                    category=body.category,
                )
            all_prices.extend(prices)
        except Exception as exc:
            logger.warning("Preview fetch %s failed: %s", source_name, exc)

    # 去重
    seen: set[tuple[str, str, str, str]] = set()
    unique: list = []
    for p in all_prices:
        key = (p.name, p.spec, p.region, p.source)
        if key in seen:
            continue
        seen.add(key)
        unique.append(p)

    items = [
        PreviewPriceItem(
            name=p.name,
            spec=p.spec,
            unit=p.unit,
            unit_price=p.unit_price,
            region=p.region,
            effective_date=p.effective_date,
            source=p.source,
            url=p.url,
        )
        for p in unique[:200]
    ]

    return PreviewResponse(
        total=len(unique),
        items=items,
        sources_tried=sources_tried,
        duration_s=round(_time.time() - t0, 2),
    )
