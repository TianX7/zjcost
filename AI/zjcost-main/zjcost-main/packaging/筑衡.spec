# -*- mode: python ; coding: utf-8 -*-

import sys
from pathlib import Path

from PyInstaller.utils.hooks import collect_data_files, collect_submodules

block_cipher = None

SPEC_DIR = Path(SPECPATH).resolve()
ROOT = SPEC_DIR if (SPEC_DIR / "backend").exists() else SPEC_DIR.parent
BACKEND = ROOT / "backend"
FRONTEND_DIST = ROOT / "frontend" / "dist"

if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

datas = [
    (str(FRONTEND_DIST), "frontend/dist"),
    (str(BACKEND / "tools" / "cad-converters" / "libredwg"), "backend/tools/cad-converters/libredwg"),
    (str(BACKEND / "portable_seed" / "valuation.seed.db"), "data"),
    (str(BACKEND / "app" / "services" / "price_fetch" / "reference_prices.json"), "app/services/price_fetch"),
    (str(BACKEND / "app" / "assistant" / "skills"), "app/assistant/skills"),
    (str(BACKEND / "app" / "assistant" / "prompts"), "app/assistant/prompts"),
    (str(BACKEND / "app" / "assistant" / "agents" / "configs"), "app/assistant/agents/configs"),
] + collect_data_files("ezdxf") + collect_data_files("ifcopenshell")

passlib_imports = [
    name for name in collect_submodules("passlib")
    if ".tests" not in name and name != "passlib.tests"
]

ezdxf_imports = [
    name for name in collect_submodules("ezdxf")
    if name != "ezdxf.addons.browser"
]

ifcopenshell_imports = [
    name for name in collect_submodules("ifcopenshell")
    if ".tests" not in name and "test" not in name
]

httpx_imports = collect_submodules("httpx")
bs4_imports = collect_submodules("bs4")
route_imports = collect_submodules("app.api.routes")
price_fetch_imports = collect_submodules("app.services.price_fetch")

hiddenimports = [
    "uvicorn.logging",
    "uvicorn.loops",
    "uvicorn.loops.auto",
    "uvicorn.protocols",
    "uvicorn.protocols.http",
    "uvicorn.protocols.http.auto",
    "uvicorn.protocols.websockets",
    "uvicorn.protocols.websockets.auto",
    "uvicorn.lifespan",
    "uvicorn.lifespan.on",
    "multipart",
    "openpyxl",
    "ezdxf",
    "reportlab",
    "ifcopenshell",
    "shapely",
    "httpx",
    "lxml",
] + ezdxf_imports + passlib_imports + collect_submodules("jwt") + ifcopenshell_imports + httpx_imports + bs4_imports + route_imports + price_fetch_imports + [
    "bcrypt",
]

a = Analysis(
    [str(BACKEND / "portable_launcher.py")],
    pathex=[str(BACKEND)],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[str(SPEC_DIR / "hook_load_app_override.py")],
    excludes=[
        "pytest",
        "tkinter",
        "matplotlib",
        "passlib.tests",
        "ezdxf.addons.browser",
        "PyQt5",
        "PySide6",
    ],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)
pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="筑衡",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name="筑衡_便携版",
)
