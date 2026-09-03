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

CAD_TOOLS = BACKEND / "tools"

datas = [
    (str(FRONTEND_DIST), "frontend/dist"),
    (str(BACKEND / "tools" / "cad-converters" / "libredwg"), "backend/tools/cad-converters/libredwg"),
    # 内置 CAD 看图内核（CADReader.exe 及其 DLL/插件），供 cad_viewer 独立窗口与网页嵌入使用
    (str(BACKEND / "tools" / "CADReader"), "backend/tools/CADReader"),
    # 内置图纸查看器脚本（打包版内同时提供独立的 cad_viewer.exe 入口）
    (str(BACKEND / "tools" / "cad_viewer.py"), "backend/tools"),
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

# 独立图纸查看器入口：cad_viewer.exe（后端通过 subprocess 调用，加载 CADReader 看图内核）
cad_view_analysis = Analysis(
    [str(BACKEND / "tools" / "cad_viewer.py")],
    pathex=[str(BACKEND)],
    binaries=[],
    datas=[],
    hiddenimports=[],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        "tkinter",
        "matplotlib",
        "PyQt5",
        "PySide6",
        "pytest",
    ],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)
cad_view_pyz = PYZ(cad_view_analysis.pure, cad_view_analysis.zipped_data, cipher=block_cipher)

cad_view_exe = EXE(
    cad_view_pyz,
    cad_view_analysis.scripts,
    [],
    exclude_binaries=True,
    name="cad_viewer",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,
    disable_windowed_traceback=True,
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
    cad_view_exe,
    cad_view_analysis.binaries,
    cad_view_analysis.zipfiles,
    cad_view_analysis.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name="筑衡_便携版",
)
