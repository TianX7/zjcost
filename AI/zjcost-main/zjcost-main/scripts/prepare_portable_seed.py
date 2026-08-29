from __future__ import annotations

import shutil
import sqlite3
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SOURCE_DB = ROOT / "backend" / "valuation.db"
SEED_DB = ROOT / "backend" / "portable_seed" / "valuation.seed.db"

PROJECT_DATA_TABLES = [
    "handler_memories",
    "handler_traces",
    "audit_logs",
    "entity_tags",
    "knowledge_links",
    "knowledge_notes",
    "tags",
    "comments",
    "contract_measurements",
    "payment_certificates",
    "price_adjustments",
    "project_members",
    "project_valuation_configs",
    "snapshots",
    "calc_results",
    "line_item_quota_bindings",
    "measure_items",
    "boq_items",
    "projects",
    "users",
]


def table_names(cur: sqlite3.Cursor) -> set[str]:
    return {row[0] for row in cur.execute("select name from sqlite_master where type='table'")}


def count(cur: sqlite3.Cursor, table: str) -> int:
    return int(cur.execute(f"select count(*) from {table}").fetchone()[0])


def main() -> None:
    if not SOURCE_DB.exists():
        raise SystemExit(f"source database does not exist: {SOURCE_DB}")

    SEED_DB.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(SOURCE_DB, SEED_DB)

    with sqlite3.connect(SEED_DB) as conn:
        cur = conn.cursor()
        tables = table_names(cur)

        for table in PROJECT_DATA_TABLES:
            if table in tables:
                cur.execute(f"delete from {table}")

        if "system_settings" in tables:
            cur.execute(
                "update system_settings set value=? where key=?",
                ("disabled", "ZH_PROVIDER"),
            )
            cur.execute(
                "update system_settings set value=? where key like ?",
                ("", "ZH_%_API_KEY"),
            )
            cur.execute(
                "insert into system_settings(key, value) "
                "select ?, ? where not exists (select 1 from system_settings where key=?)",
                ("ZH_PROVIDER", "disabled", "ZH_PROVIDER"),
            )

        if "sqlite_sequence" in tables:
            cleared = [table for table in PROJECT_DATA_TABLES if table in tables]
            if cleared:
                placeholders = ",".join("?" for _ in cleared)
                cur.execute(f"delete from sqlite_sequence where name in ({placeholders})", cleared)

        conn.commit()
        conn.execute("vacuum")

        tables = table_names(cur)
        quota_count = count(cur, "quota_items") if "quota_items" in tables else 0
        project_count = count(cur, "projects") if "projects" in tables else 0
        material_count = count(cur, "material_prices") if "material_prices" in tables else 0
        standard_count = count(cur, "boq_standard_codes") if "boq_standard_codes" in tables else 0
        key_lengths = []
        if "system_settings" in tables:
            key_lengths = cur.execute(
                "select key, length(coalesce(value, ?)) from system_settings "
                "where key=? or key like ? order by key",
                ("", "ZH_PROVIDER", "ZH_%_API_KEY"),
            ).fetchall()

    print(f"seed={SEED_DB}")
    print(f"projects={project_count}")
    print(f"quota_items={quota_count}")
    print(f"material_prices={material_count}")
    print(f"boq_standard_codes={standard_count}")
    print(f"zh_setting_lengths={key_lengths}")

    if project_count != 0:
        raise SystemExit("portable seed still contains projects")
    if quota_count < 10000:
        raise SystemExit("portable seed does not contain the full quota library")
    if any(key != "ZH_PROVIDER" and length != 0 for key, length in key_lengths):
        raise SystemExit("portable seed still contains an 辅助 API key")


if __name__ == "__main__":
    main()
