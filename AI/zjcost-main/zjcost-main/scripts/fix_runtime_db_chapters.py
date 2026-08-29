from __future__ import annotations

import shutil
import sqlite3
from pathlib import Path


CHAPTERS = {
    1: "第1章 土石方工程",
    2: "第2章 地基处理与边坡支护工程",
    3: "第3章 桩基工程",
    4: "第4章 砌筑工程",
    5: "第5章 混凝土及钢筋混凝土工程",
    6: "第6章 金属结构工程",
    7: "第7章 木结构工程",
    8: "第8章 门窗工程",
    9: "第9章 屋面及防水工程",
    10: "第10章 保温隔热防腐工程",
    11: "第11章 楼地面装饰工程",
    12: "第12章 墙柱面装饰与隔断幕墙工程",
    13: "第13章 天棚工程",
    14: "第14章 油漆涂料裱糊工程",
    15: "第15章 其他装饰工程",
    16: "第16章 措施项目",
}


def find_runtime_db() -> Path:
    matches = [path for path in Path("dist").rglob("valuation.db") if path.is_file()]
    if not matches:
        raise FileNotFoundError("dist/**/valuation.db not found")
    return matches[0]


def main() -> None:
    db_path = find_runtime_db()
    backup = db_path.with_name("valuation.before_chapter_fix.db")
    if not backup.exists():
        shutil.copy2(db_path, backup)

    conn = sqlite3.connect(db_path)
    try:
        cur = conn.cursor()
        updated = 0
        for chapter_no, chapter_name in CHAPTERS.items():
            cur.execute(
                "update quota_items set chapter = ? where quota_code like ?",
                (chapter_name, f"{chapter_no}-%"),
            )
            updated += cur.rowcount
        conn.commit()

        cur.execute("select count(distinct chapter) from quota_items")
        distinct = cur.fetchone()[0]
        print(f"db={db_path}")
        print(f"updated={updated}")
        print(f"distinct_chapters={distinct}")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
