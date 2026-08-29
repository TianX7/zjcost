from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.cache import _cache as cache
from app.compat import model_to_dict
from app.db.session import get_db
from app.models.material_price import MaterialPrice
from app.schemas.material_price import (
    BatchMaterialPriceRequest,
    MaterialPriceCreate,
    MaterialPriceOut,
)

router = APIRouter(tags=["material-prices"])

MATERIAL_PRICES_CACHE_TTL = 300  # 5 minutes


@router.post("/material-prices", response_model=MaterialPriceOut)
def create_material_price(
    payload: MaterialPriceCreate,
    db: Session = Depends(get_db),
) -> MaterialPriceOut:
    mp = MaterialPrice(**model_to_dict(payload))
    db.add(mp)
    db.commit()
    db.refresh(mp)
    cache.invalidate("mp:")
    return _to_out(mp)


@router.post("/material-prices:batch", response_model=list[MaterialPriceOut])
def batch_create_material_prices(
    payload: BatchMaterialPriceRequest,
    db: Session = Depends(get_db),
) -> list[MaterialPriceOut]:
    results = []
    for item in payload.items:
        mp = MaterialPrice(**model_to_dict(item))
        db.add(mp)
        db.flush()
        results.append(mp)
    db.commit()
    cache.invalidate("mp:")
    return [_to_out(mp) for mp in results]


@router.get("/material-prices", response_model=list[MaterialPriceOut])
def list_material_prices(
    region: str | None = Query(default=None),
    name: str | None = Query(default=None),
    as_of_date: str | None = Query(default=None, description="YYYY-MM-DD"),
    latest_only: bool = Query(default=False),
    db: Session = Depends(get_db),
) -> list[MaterialPriceOut]:
    cache_key = f"mp:list:{region}:{name}:{as_of_date}:{latest_only}"
    cached = cache.get(cache_key)
    if cached is not None:
        return [MaterialPriceOut(**d) for d in cached]

    q = db.query(MaterialPrice)
    if region is not None:
        q = q.filter(MaterialPrice.region == region)
    if name is not None:
        pattern = f"%{name}%"
        q = q.filter(MaterialPrice.name.ilike(pattern))
    if as_of_date is not None:
        q = q.filter(MaterialPrice.effective_date <= as_of_date)

    rows = (
        q.order_by(
            MaterialPrice.name.asc(),
            MaterialPrice.region.asc(),
            MaterialPrice.effective_date.desc(),
            MaterialPrice.id.desc(),
        )
        .all()
    )

    if latest_only:
        deduped: list[MaterialPrice] = []
        seen_keys: set[tuple[str, str, str]] = set()
        for row in rows:
            key = (row.name, row.region, row.unit)
            if key in seen_keys:
                continue
            seen_keys.add(key)
            deduped.append(row)
        rows = deduped

    result = [_to_out(mp) for mp in rows]
    cache.set(cache_key, [r.model_dump() for r in result], MATERIAL_PRICES_CACHE_TTL)
    return result


def _to_out(mp: MaterialPrice) -> MaterialPriceOut:
    return MaterialPriceOut(
        id=mp.id,
        code=mp.code,
        name=mp.name,
        spec=mp.spec or "",
        unit=mp.unit,
        unit_price=mp.unit_price,
        source=mp.source,
        region=mp.region,
        effective_date=mp.effective_date,
    )
