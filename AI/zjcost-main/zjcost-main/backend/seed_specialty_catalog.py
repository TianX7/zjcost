"""Seed specialty materials and quota items without clearing project data.

Adds built-in reference entries for:
- 仿古 / 古建
- 光伏
- 水利灌溉 / 古渠
"""

from __future__ import annotations

import os
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(__file__))

from dotenv import load_dotenv

load_dotenv()

from app.cache import _cache as cache
from app.data.specialty_catalog import (
    REFERENCE_EFFECTIVE_DATE,
    SPECIALTY_MATERIAL_PRICES,
    SPECIALTY_QUOTA_ITEMS,
)
from app.db.session import SessionLocal
from app.models.material_price import MaterialPrice
from app.models.quota_item import QuotaItem


def seed_material_prices() -> tuple[int, int]:
    db = SessionLocal()
    try:
        created = 0
        updated = 0
        fetched_at = datetime.now(timezone.utc)
        for row in SPECIALTY_MATERIAL_PRICES:
            code = str(row["code"])
            existing = (
                db.query(MaterialPrice)
                .filter(
                    MaterialPrice.code == code,
                    MaterialPrice.region == str(row.get("region", "")),
                    MaterialPrice.source == str(row.get("source", "reference")),
                    MaterialPrice.effective_date == REFERENCE_EFFECTIVE_DATE,
                )
                .first()
            )
            payload = {
                "code": code,
                "name": str(row["name"]),
                "spec": str(row.get("spec", "")),
                "unit": str(row["unit"]),
                "unit_price": float(row["unit_price"]),
                "source": str(row.get("source", "reference")),
                "region": str(row.get("region", "")),
                "effective_date": REFERENCE_EFFECTIVE_DATE,
                "fetched_at": fetched_at,
            }
            if existing:
                for key, value in payload.items():
                    setattr(existing, key, value)
                updated += 1
            else:
                db.add(MaterialPrice(**payload))
                created += 1
        db.commit()
        cache.invalidate("mp:")
        return created, updated
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def seed_quota_items() -> tuple[int, int]:
    db = SessionLocal()
    try:
        created = 0
        updated = 0
        for row in SPECIALTY_QUOTA_ITEMS:
            quota_code = str(row["quota_code"])
            discipline = str(row["discipline"])
            existing = (
                db.query(QuotaItem)
                .filter(QuotaItem.quota_code == quota_code, QuotaItem.discipline == discipline)
                .first()
            )
            payload = {
                "quota_code": quota_code,
                "discipline": discipline,
                "name": str(row["name"]),
                "unit": str(row["unit"]),
                "labor_qty": float(row.get("labor_qty", 0)),
                "material_qty": float(row.get("material_qty", 0)),
                "machine_qty": float(row.get("machine_qty", 0)),
                "work_content": str(row.get("work_content", "")),
                "applicable_scope": str(row.get("applicable_scope", "")),
                "chapter": str(row.get("chapter", "")),
                "version": "2026-专项内置参考",
                "base_price": float(row.get("base_price", 0)),
                "has_resource_details": 0,
            }
            if existing:
                for key, value in payload.items():
                    setattr(existing, key, value)
                updated += 1
            else:
                db.add(QuotaItem(**payload))
                created += 1
        db.commit()
        cache.invalidate("quota:")
        return created, updated
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def main() -> None:
    mat_created, mat_updated = seed_material_prices()
    quota_created, quota_updated = seed_quota_items()
    print(f"materials created={mat_created} updated={mat_updated}")
    print(f"quota_items created={quota_created} updated={quota_updated}")


if __name__ == "__main__":
    main()
