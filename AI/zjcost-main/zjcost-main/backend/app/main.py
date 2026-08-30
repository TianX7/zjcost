from dotenv import load_dotenv
load_dotenv()

import importlib
import logging
import os
import sys
import time
import sqlite3
from pathlib import Path
from contextlib import asynccontextmanager
from typing import Any

logger = logging.getLogger(__name__)

from fastapi import Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles

from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from slowapi.util import get_remote_address

# 登录速率限制器（在导入路由模块前创建，避免与 auth 路由循环导入）
limiter = Limiter(key_func=get_remote_address)

from app.api.routes.auth import require_route_access
from app.db.base import Base
from app.services.auto_backup_service import create_backup, start_backup_timer
from app.services.task_store import mark_stale_processing_failed
from app.db.session import engine

# Import models so SQLAlchemy is aware of them for metadata.create_all
import app.models  # noqa: F401

def _env_bool(name: str, default: bool = False) -> bool:
    value = os.getenv(name, str(default)).strip().lower()
    return value in {"1", "true", "yes", "on"}


def _cors_origins() -> list[str]:
    raw = os.getenv("BACKEND_CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173")
    return [origin.strip() for origin in raw.split(",") if origin.strip()]


def _auth_dependencies():
    if not _env_bool("ZJCOST_AUTH_REQUIRED", False):
        return []
    return [Depends(require_route_access)]


def _auto_create_tables() -> bool:
    if os.getenv("ZJCOST_ENV", "").strip().lower() in {"prod", "production"}:
        return _env_bool("ZJCOST_AUTO_CREATE_TABLES", False)
    return _env_bool("ZJCOST_AUTO_CREATE_TABLES", True)


def _is_loopback_client(host: str | None) -> bool:
    if not host:
        return True
    normalized = host.strip().lower()
    return normalized in {"127.0.0.1", "::1", "localhost", "testclient"} or normalized.startswith("::ffff:127.0.0.1")


app = FastAPI(title="筑衡造价管理后端", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins(),
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"],
)

# 注册登录速率限制器与 SlowAPI 中间件
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(SlowAPIMiddleware)






def _ensure_calc_results_columns() -> None:
    """兼容旧库：补齐 calc_results 新增成本拆分列，避免旧 SQLite 查询失败。"""
    from sqlalchemy import inspect, text

    columns_to_add = {
        "labor_cost": "FLOAT NOT NULL DEFAULT 0",
        "material_cost": "FLOAT NOT NULL DEFAULT 0",
        "machine_cost": "FLOAT NOT NULL DEFAULT 0",
        "direct_cost": "FLOAT NOT NULL DEFAULT 0",
        "management_fee": "FLOAT NOT NULL DEFAULT 0",
        "profit": "FLOAT NOT NULL DEFAULT 0",
        "regulatory_fee": "FLOAT NOT NULL DEFAULT 0",
        "pre_tax_total": "FLOAT NOT NULL DEFAULT 0",
        "tax": "FLOAT NOT NULL DEFAULT 0",
        "created_at": "DATETIME",
    }

    try:
        inspector = inspect(engine)
        if "calc_results" not in inspector.get_table_names():
            return
        existing = {col["name"] for col in inspector.get_columns("calc_results")}
        missing = [(name, ddl) for name, ddl in columns_to_add.items() if name not in existing]
        if not missing:
            return
        with engine.begin() as conn:
            for name, ddl in missing:
                conn.execute(text(f"ALTER TABLE calc_results ADD COLUMN {name} {ddl}"))
    except Exception:
        logger.exception("calc_results 兼容迁移失败")


def _ensure_material_price_datetime_values() -> None:
    """兼容旧库：清理 material_prices.fetched_at 中的整数脏值。"""
    from sqlalchemy import inspect, text

    try:
        inspector = inspect(engine)
        if "material_prices" not in inspector.get_table_names():
            return
        columns = {col["name"] for col in inspector.get_columns("material_prices")}
        if "fetched_at" not in columns:
            return
        if engine.dialect.name == "sqlite":
            with engine.begin() as conn:
                conn.execute(text(
                    "UPDATE material_prices SET fetched_at = NULL "
                    "WHERE fetched_at IS NOT NULL AND typeof(fetched_at) != 'text'"
                ))
    except Exception:
        logger.exception("material_prices 日期兼容迁移失败")


def _ensure_project_valuation_config_datetime_values() -> None:
    """兼容旧库：补齐 project_valuation_configs 时间列与空值。"""
    from sqlalchemy import inspect, text

    try:
        inspector = inspect(engine)
        if "project_valuation_configs" not in inspector.get_table_names():
            return
        columns = {col["name"] for col in inspector.get_columns("project_valuation_configs")}
        with engine.begin() as conn:
            if "created_at" not in columns:
                conn.execute(text("ALTER TABLE project_valuation_configs ADD COLUMN created_at DATETIME"))
                columns.add("created_at")
            if "updated_at" not in columns:
                conn.execute(text("ALTER TABLE project_valuation_configs ADD COLUMN updated_at DATETIME"))
                columns.add("updated_at")
            conn.execute(text(
                "UPDATE project_valuation_configs "
                "SET created_at = CURRENT_TIMESTAMP "
                "WHERE created_at IS NULL"
            ))
            conn.execute(text(
                "UPDATE project_valuation_configs "
                "SET updated_at = COALESCE(updated_at, created_at, CURRENT_TIMESTAMP) "
                "WHERE updated_at IS NULL"
            ))
        if "updated_at" not in columns:
            return
    except Exception:
        logger.exception("project_valuation_configs 日期兼容迁移失败")


def _ensure_boq_item_timestamps() -> None:
    """兼容旧库：补齐 boq_items 时间列，避免 INSERT 时 RETURNING 报错。"""
    from sqlalchemy import inspect, text

    try:
        inspector = inspect(engine)
        if "boq_items" not in inspector.get_table_names():
            return
        columns = {col["name"] for col in inspector.get_columns("boq_items")}
        with engine.begin() as conn:
            if "created_at" not in columns:
                conn.execute(text("ALTER TABLE boq_items ADD COLUMN created_at DATETIME"))
                columns.add("created_at")
            if "updated_at" not in columns:
                conn.execute(text("ALTER TABLE boq_items ADD COLUMN updated_at DATETIME"))
                columns.add("updated_at")
    except Exception:
        logger.exception("boq_items 时间列兼容迁移失败")


def _ensure_quota_item_old_material_columns() -> None:
    """兼容旧库：补齐 quota_items 旧材料扩展列，避免查询/写入失败。"""
    from sqlalchemy import inspect, text

    columns_to_add = {
        "acquisition_method": "VARCHAR(20) NOT NULL DEFAULT ''",
        "origin_note": "TEXT NOT NULL DEFAULT ''",
        "heritage_site": "VARCHAR(255) NOT NULL DEFAULT ''",
        "relic_level": "VARCHAR(50) NOT NULL DEFAULT ''",
        "repair_part": "VARCHAR(255) NOT NULL DEFAULT ''",
        "condition_grade": "VARCHAR(50) NOT NULL DEFAULT ''",
        "batch_no": "VARCHAR(100) NOT NULL DEFAULT ''",
        "inspection_report_no": "VARCHAR(100) NOT NULL DEFAULT ''",
    }

    try:
        inspector = inspect(engine)
        if "quota_items" not in inspector.get_table_names():
            return
        existing = {col["name"] for col in inspector.get_columns("quota_items")}
        missing = [(name, ddl) for name, ddl in columns_to_add.items() if name not in existing]
        if not missing:
            return
        with engine.begin() as conn:
            for name, ddl in missing:
                conn.execute(text(f"ALTER TABLE quota_items ADD COLUMN {name} {ddl}"))
            # 为 acquisition_method 创建索引（若不存在），加速旧材料筛选
            existing_indexes = {idx["name"] for idx in inspector.get_indexes("quota_items")}
            if "ix_quota_items_acquisition_method" not in existing_indexes:
                try:
                    conn.execute(text(
                        "CREATE INDEX ix_quota_items_acquisition_method "
                        "ON quota_items (acquisition_method)"
                    ))
                except Exception:
                    logger.warning("ix_quota_items_acquisition_method 索引创建失败，忽略")
    except Exception:
        logger.exception("quota_items 旧材料扩展列兼容迁移失败")


def _sqlite_not_null_default_suffix(col: Any) -> str:
    """为 NOT NULL 列生成 ADD COLUMN 必需的 DEFAULT 子句。"""
    default = col.default.arg if col.default is not None and getattr(col.default, "is_scalar", False) else None
    if isinstance(default, bool):
        return f" NOT NULL DEFAULT {int(default)}"
    if default is not None:
        if isinstance(default, str):
            escaped = default.replace("'", "''")
            return f" NOT NULL DEFAULT '{escaped}'"
        return f" NOT NULL DEFAULT {default}"
    type_name = type(col.type).__name__.lower()
    if "float" in type_name or "numeric" in type_name or "decimal" in type_name:
        return " NOT NULL DEFAULT 0"
    if "int" in type_name or "bool" in type_name:
        return " NOT NULL DEFAULT 0"
    if "date" in type_name or "time" in type_name:
        return " NOT NULL DEFAULT CURRENT_TIMESTAMP"
    return " NOT NULL DEFAULT ''"


def _ensure_sqlite_schema() -> None:
    """兼容旧库的通用结构同步：模型新增的列自动 ALTER TABLE 补齐。

    逐表比对 Base.metadata 与实际 SQLite 结构，缺失的列按模型类型补上，
    防止版本漂移导致 `no such column` 查询失败。缺失的整表由 create_all 负责。
    """
    if engine.dialect.name != "sqlite":
        return
    from sqlalchemy import inspect, text

    try:
        inspector = inspect(engine)
        existing_tables = set(inspector.get_table_names())
        added = 0
        with engine.begin() as conn:
            for table in Base.metadata.sorted_tables:
                if table.name not in existing_tables:
                    continue
                existing_cols = {col["name"] for col in inspector.get_columns(table.name)}
                for col in table.columns:
                    if col.name in existing_cols:
                        continue
                    ddl = str(col.type)
                    if not col.nullable:
                        ddl += _sqlite_not_null_default_suffix(col)
                    conn.execute(text(f'ALTER TABLE "{table.name}" ADD COLUMN "{col.name}" {ddl}'))
                    added += 1
        if added:
            logger.info("通用结构同步完成：补齐 %d 个缺失列", added)
    except Exception:
        logger.exception("通用结构同步失败")


def _copy_table_rows_from_seed(db_path: Path, seed_path: Path, table: str) -> int:
    """Copy all rows for one reference table from the portable seed database."""
    with sqlite3.connect(db_path) as conn, sqlite3.connect(seed_path) as seed_conn:
        conn.execute("PRAGMA foreign_keys=OFF")
        main_cols = [row[1] for row in conn.execute(f"PRAGMA table_info({table})").fetchall()]
        seed_info = seed_conn.execute(f"PRAGMA table_info({table})").fetchall()
        seed_cols = [row[1] for row in seed_info]
        shared_cols = [col for col in seed_cols if col in main_cols]
        if not shared_cols:
            return 0

        seed_rows = seed_conn.execute(
            f"SELECT {', '.join(f'\"{col}\"' for col in shared_cols)} FROM {table}"
        ).fetchall()
        if not seed_rows:
            return 0

        placeholders = ", ".join("?" for _ in shared_cols)
        quoted_cols = ", ".join(f'"{col}"' for col in shared_cols)
        conn.execute(f"DELETE FROM {table}")
        conn.executemany(
            f"INSERT INTO {table} ({quoted_cols}) VALUES ({placeholders})",
            [tuple(row) for row in seed_rows],
        )
        try:
            conn.execute("DELETE FROM sqlite_sequence WHERE name = ?", (table,))
        except Exception:
            pass
        conn.commit()
        return len(seed_rows)


def _ensure_core_quota_extensions(db_path: Path) -> int:
    """Add high-frequency quota rows missing from older portable seeds."""
    rows = []
    concrete_members = [
        ("框架柱混凝土", "m3", 3.5, 0, 0, {"C25": 650, "C30": 690, "C35": 735, "C40": 790}),
        ("矩形柱混凝土", "m3", 3.5, 0, 0, {"C25": 650, "C30": 690, "C35": 735, "C40": 790}),
        ("框架梁混凝土", "m3", 3.4, 0, 0, {"C25": 635, "C30": 675, "C35": 720, "C40": 775}),
        ("矩形梁混凝土", "m3", 3.4, 0, 0, {"C25": 635, "C30": 675, "C35": 720, "C40": 775}),
        ("有梁板混凝土", "m3", 3.0, 0, 0, {"C25": 610, "C30": 650, "C35": 695, "C40": 750}),
        ("无梁板混凝土", "m3", 3.0, 0, 0, {"C25": 605, "C30": 645, "C35": 690, "C40": 745}),
        ("剪力墙混凝土", "m3", 3.2, 0, 0, {"C25": 625, "C30": 665, "C35": 710, "C40": 765}),
    ]
    seq = 1
    for name, unit, labor, material, machine, grades in concrete_members:
        for grade, base_price in grades.items():
            rows.append((
                f"ZJT-TJ-HNT-{seq:04d}",
                "土建",
                f"{name} {grade}",
                unit,
                labor,
                material,
                machine,
                "混凝土浇筑、振捣、养护",
                "适用于一般工业与民用建筑现浇混凝土构件",
                "第5章 混凝土及钢筋混凝土工程",
                "筑衡基础补充",
                base_price,
                0,
            ))
            seq += 1

    rows.extend([
        ("ZJT-TJ-GJ-0001", "土建", "现浇构件带肋钢筋HRB400 综合", "t", 8.8, 0, 0, "钢筋制作、绑扎、安装", "适用于现浇构件HRB400钢筋综合", "第5章 混凝土及钢筋混凝土工程", "筑衡基础补充", 5600, 0),
        ("ZJT-TJ-GJ-0002", "土建", "现浇构件圆钢筋HPB300 综合", "t", 9.6, 0, 0, "钢筋制作、绑扎、安装", "适用于现浇构件HPB300钢筋综合", "第5章 混凝土及钢筋混凝土工程", "筑衡基础补充", 5200, 0),
    ])

    with sqlite3.connect(db_path) as conn:
        existing = {
            row[0]
            for row in conn.execute("SELECT quota_code FROM quota_items WHERE quota_code LIKE 'ZJT-%'").fetchall()
        }
        to_insert = [row for row in rows if row[0] not in existing]
        if not to_insert:
            return 0
        conn.executemany(
            """
            INSERT INTO quota_items (
                quota_code, discipline, name, unit, labor_qty, material_qty, machine_qty,
                work_content, applicable_scope, chapter, version, base_price, has_resource_details
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            to_insert,
        )
        conn.commit()
        return len(to_insert)


def _ensure_reference_seed_data() -> None:
    """Restore quota/material/standard reference data when a local DB is empty.

    Users may delete all projects during testing. That should not wipe out the
    product's reference library, because automatic matching, valuation and audit
    all depend on these tables.
    """
    try:
        restored = restore_reference_seed_data(force=False)
        if restored:
            logger.info("restored reference seed data: %s", restored)
    except Exception:
        logger.exception("恢复内置基础库失败")


def restore_reference_seed_data(force: bool = False) -> dict[str, int]:
    """Restore bundled reference tables and return inserted counts."""
    from sqlalchemy import inspect, text

    if "sqlite" not in str(engine.url):
        return {}

    db_path = Path(str(engine.url.database or "")).resolve()
    exe_dir = Path(sys.executable).resolve().parent
    meipass = getattr(sys, "_MEIPASS", None)
    seed_candidates = [
        # Development layout
        Path(__file__).resolve().parents[1] / "portable_seed" / "valuation.seed.db",
        Path(__file__).resolve().parents[2] / "backend" / "portable_seed" / "valuation.seed.db",
        Path(__file__).resolve().parents[2] / "portable_seed" / "valuation.seed.db",
        # Packaged onedir layout: seed bundled as data/valuation.seed.db
        exe_dir / "_internal" / "data" / "valuation.seed.db",
        exe_dir / "data" / "valuation.seed.db",
        exe_dir / "backend" / "portable_seed" / "valuation.seed.db",
        exe_dir / "portable_seed" / "valuation.seed.db",
    ]
    if meipass:
        seed_candidates.insert(0, Path(meipass) / "data" / "valuation.seed.db")
    seed_path = next((path for path in seed_candidates if path.exists()), None)
    if not db_path.exists() or seed_path is None:
        return {}

    inspector = inspect(engine)
    existing_tables = set(inspector.get_table_names())
    with sqlite3.connect(seed_path) as seed_conn:
        seed_tables = {
            row[0]
            for row in seed_conn.execute("select name from sqlite_master where type='table'").fetchall()
        }

    reference_tables = [
        "quota_items",
        "material_prices",
        "boq_standard_codes",
        "quota_resource_details",
        "quota_resource_material_mappings",
    ]
    restored: dict[str, int] = {}
    with engine.connect() as conn:
        for table in reference_tables:
            if table not in existing_tables or table not in seed_tables:
                continue
            count = conn.execute(text(f"SELECT COUNT(*) FROM {table}")).scalar() or 0
            if force or int(count) == 0:
                restored[table] = _copy_table_rows_from_seed(db_path, seed_path, table)
    if "quota_items" in existing_tables:
        restored["quota_extensions"] = _ensure_core_quota_extensions(db_path)
    return restored


app.state.restore_reference_seed_data = restore_reference_seed_data




@asynccontextmanager
async def _lifespan(app: FastAPI):
    # MVP/dev convenience. Use Alembic for ongoing migrations.
    if _auto_create_tables():
        Base.metadata.create_all(bind=engine)
    _ensure_calc_results_columns()
    _ensure_material_price_datetime_values()
    _ensure_project_valuation_config_datetime_values()
    _ensure_boq_item_timestamps()
    _ensure_quota_item_old_material_columns()
    _ensure_sqlite_schema()
    _ensure_reference_seed_data()
    _load_zh_settings_from_db()
    # 上一进程遗留的"进行中"后台任务已无工作线程，启动时统一标记为失败
    mark_stale_processing_failed("drawing_recognition", "服务重启导致任务中断，请重新上传图纸")
    mark_stale_processing_failed("ifc_parse", "服务重启导致任务中断，请重新上传 IFC 模型")
    create_backup()  # auto-backup on startup
    start_backup_timer()  # periodic backup if configured

    yield


app.router.lifespan_context = _lifespan


def _load_zh_settings_from_db() -> None:
    """Restore persisted 辅助 settings into os.environ so get_zh_settings() picks them up."""
    import os
    from app.db.session import session_scope
    from app.models.system_setting import SystemSetting

    try:
        with session_scope() as db:
            rows = db.query(SystemSetting).filter(SystemSetting.key.like("ZH_%")).all()
            for row in rows:
                if row.key.endswith("_API_KEY") and not _env_bool("ZJCOST_PERSIST_ZH_API_KEYS", False):
                    continue
                if row.value and row.key not in os.environ:
                    os.environ[row.key] = row.value
    except Exception:
        pass  # DB may not exist yet on first run


auth_dependencies = _auth_dependencies()

PACKAGED_ROUTE_MODULES = (
    "zh_validate",
    "zh_valuate",
    "zh_analyze",
    "zh_chat",
    "zh_enhanced",
    "zh_settings",
    "zh_traces",
    "audit_logs",
    "auto_valuate",
    "bindings",
    "boq_generate",
    "boq_items",
    "calculate",
    "collaboration",
    "drawing_recognition",
    "exports",
    "graph",
    "ifc_parse",
    "imports",
    "knowledge_links",
    "knowledge_notes",
    "match",
    "material_prices",
    "measures",
    "memories",
    "old_materials",
    "orchestrator",
    "price_fetch",
    "projects",
    "provenance",
    "query",
    "quota_items",
    "reports",
    "rule_packages",
    "skills",
    "snapshots",
    "templates",
    "undo",
    "standard_codes",
    "system_check",
    "tags",
    "tasks",
    "validation",
    "valuation_management",
)


def _route_module_names() -> list[str]:
    """Return API route module names in both source and PyInstaller builds."""
    routes_dir = Path(__file__).parent / "api" / "routes"
    discovered = [
        f.stem
        for f in sorted(routes_dir.glob("*.py"))
        if not f.name.startswith("_") and f.stem not in {"auth", "health"}
    ]
    return discovered or list(PACKAGED_ROUTE_MODULES)


def _register_routes() -> None:
    """Auto-discover and register all route modules from app/api/routes/."""
    for module_name in _route_module_names():
        mod = importlib.import_module(f"app.api.routes.{module_name}")
        if hasattr(mod, "router"):
            app.include_router(mod.router, prefix="/api", dependencies=auth_dependencies)

    # Auth routes: no auth dependency (login/register must be public)
    import app.api.routes.auth as _auth
    app.include_router(_auth.router, prefix="/api")

    # Health check: no prefix, no deps
    import app.api.routes.health as _health
    app.include_router(_health.router)


_register_routes()


def _frontend_dist_dir() -> Path | None:
    candidates = []
    if getattr(sys, "frozen", False):
        candidates.extend([
            Path(sys.executable).resolve().parent / "frontend" / "dist",
            Path(getattr(sys, "_MEIPASS", "")).resolve() / "frontend" / "dist",
        ])

    env_dir = os.getenv("ZJCOST_FRONTEND_DIST", "").strip()
    if env_dir:
        candidates.append(Path(env_dir))

    app_root = Path(__file__).resolve().parents[2]
    candidates.extend([
        app_root / "frontend" / "dist",
        app_root.parent / "frontend" / "dist",
    ])

    for candidate in candidates:
        if candidate and (candidate / "index.html").exists():
            return candidate
    return None


_FRONTEND_DIST = _frontend_dist_dir()
if _FRONTEND_DIST:
    app.mount("/zjcost/assets", StaticFiles(directory=str(_FRONTEND_DIST / "assets")), name="zjcost-assets")
    fonts_dir = _FRONTEND_DIST / "fonts"
    if fonts_dir.exists():
        app.mount("/zjcost/fonts", StaticFiles(directory=str(fonts_dir)), name="zjcost-fonts")

    @app.get("/")
    def _root_redirect() -> RedirectResponse:
        return RedirectResponse(url="/zjcost/")

    @app.get("/zjcost")
    def _zjcost_redirect() -> RedirectResponse:
        return RedirectResponse(url="/zjcost/")

    @app.get("/zjcost/{path:path}", include_in_schema=False)
    def _serve_spa(path: str) -> FileResponse:
        target = (_FRONTEND_DIST / path).resolve()
        if target.is_file() and _FRONTEND_DIST.resolve() in target.parents:
            return FileResponse(target)
        return FileResponse(_FRONTEND_DIST / "index.html")
