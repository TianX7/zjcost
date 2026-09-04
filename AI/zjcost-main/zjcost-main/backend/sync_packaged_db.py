# -*- coding: utf-8 -*-
"""把 GS 补充定额与旧材三级价格同步进目标 SQLite 数据库。

目标库：
  1. backend/portable_seed/valuation.seed.db —— 打包版首次启动的种子库（全新安装）
  2. packaging/dist/筑衡_便携版/data/valuation.db —— 当前打包版运行库（保留既有项目数据）

用法：python sync_packaged_db.py <db_path> [<db_path2> ...]
"""
import os
import sqlite3
import sys

sys.path.insert(0, os.path.dirname(__file__))

from seed_gs_quotas import (
    CHAPTER,
    DEMO_BRICK_CODE,
    DEMO_BRICK_LEVEL_PRICES,
    DISCIPLINE,
    GS01_RESOURCES,
    METHOD_NOTE,
    SECTIONS,
    VERSION,
)


def _ensure_schema(con: sqlite3.Connection) -> None:
    """补充新列（回收价/加工价/运输价），与开发库模型保持一致。"""
    cols = [row[1] for row in con.execute("PRAGMA table_info(quota_items)")]
    for col in ("recycle_price", "process_price", "transport_price"):
        if col not in cols:
            con.execute(f"ALTER TABLE quota_items ADD COLUMN {col} REAL DEFAULT 0")


def sync(con: sqlite3.Connection) -> int:
    """幂等同步：GS-01~GS-05 补充定额（含 GS-01 人材机明细）+ 演示旧砖三级价格。"""
    _ensure_schema(con)
    for code, name, unit, labor, material, machine, price, work, scope, report in SECTIONS:
        has_detail = 1 if code == "GS-01" else 0
        row = con.execute(
            "SELECT id FROM quota_items WHERE discipline=? AND quota_code=?",
            (DISCIPLINE, code),
        ).fetchone()
        if row:
            qid = row[0]
            con.execute(
                "UPDATE quota_items SET name=?, unit=?, labor_qty=?, material_qty=?, "
                "machine_qty=?, base_price=?, work_content=?, applicable_scope=?, "
                "chapter=?, version=?, origin_note=?, inspection_report_no=?, "
                "has_resource_details=? WHERE id=?",
                (name, unit, labor, material, machine, price, work, scope, CHAPTER,
                 VERSION, METHOD_NOTE, report, has_detail, qid),
            )
        else:
            cur = con.execute(
                "INSERT INTO quota_items (quota_code, discipline, name, unit, labor_qty, "
                "material_qty, machine_qty, base_price, work_content, applicable_scope, "
                "chapter, version, origin_note, inspection_report_no, acquisition_method, "
                "has_resource_details, recycle_price, process_price, transport_price) "
                "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (code, DISCIPLINE, name, unit, labor, material, machine, price, work,
                 scope, CHAPTER, VERSION, METHOD_NOTE, report, "", has_detail, 0, 0, 0),
            )
            qid = cur.lastrowid

        if code == "GS-01":
            con.execute(
                "DELETE FROM quota_resource_details WHERE quota_item_id=?", (qid,)
            )
            for category, rcode, rname, spec, runit, qty, uprice, main in GS01_RESOURCES:
                con.execute(
                    "INSERT INTO quota_resource_details (quota_item_id, category, "
                    "resource_code, resource_name, spec, unit, quantity, unit_price, "
                    "is_main_material) VALUES (?,?,?,?,?,?,?,?,?)",
                    (qid, category, rcode, rname, spec, runit, qty, uprice, main),
                )

    con.execute(
        "UPDATE quota_items SET recycle_price=?, process_price=?, transport_price=?, "
        "base_price=? WHERE discipline='旧材料' AND quota_code=?",
        (
            DEMO_BRICK_LEVEL_PRICES["recycle_price"],
            DEMO_BRICK_LEVEL_PRICES["process_price"],
            DEMO_BRICK_LEVEL_PRICES["transport_price"],
            DEMO_BRICK_LEVEL_PRICES["base_price"],
            DEMO_BRICK_CODE,
        ),
    )
    con.commit()
    total = con.execute(
        "SELECT COUNT(*) FROM quota_items WHERE discipline=?", (DISCIPLINE,)
    ).fetchone()[0]
    return total


def main() -> None:
    targets = sys.argv[1:] if len(sys.argv) > 1 else []
    if not targets:
        print("用法：python sync_packaged_db.py <db1> [db2 ...]")
        sys.exit(1)
    for path in targets:
        con = sqlite3.connect(path)
        try:
            total = sync(con)
            print(f"OK 「{path}」：补充定额 {total} 项、GS-01 人工材机明细与旧砖三级价格已同步")
        finally:
            con.close()


if __name__ == "__main__":
    main()