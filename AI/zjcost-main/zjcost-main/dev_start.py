#!/usr/bin/env python3
"""筑衡 (zjcost) 跨平台一键启动脚本

自动检测环境 → 安装依赖 → 启动后端 + 前端。

用法:
    python dev_start.py          # 完整启动（推荐首次使用）
    python dev_start.py --skip-install  # 跳过依赖安装，直接启动
    python dev_start.py --backend-only  # 仅启动后端
    python dev_start.py --frontend-only # 仅启动前端

前置要求:
    - Python 3.12+
    - Node.js 18+
"""

from __future__ import annotations

import argparse
import os
import platform
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
BACKEND_DIR = ROOT / "backend"
FRONTEND_DIR = ROOT / "frontend"
VENV_DIR = BACKEND_DIR / "venv"
ENV_FILE = ROOT / ".env"
ENV_EXAMPLE = ROOT / ".env.example"


def _python() -> str:
    """Return the venv python path (create venv if missing)."""
    if platform.system() == "Windows":
        py = VENV_DIR / "Scripts" / "python.exe"
    else:
        py = VENV_DIR / "bin" / "python"
    return str(py)


def _pip() -> str:
    if platform.system() == "Windows":
        return str(VENV_DIR / "Scripts" / "pip.exe")
    return str(VENV_DIR / "bin" / "pip")


def _npm() -> str:
    npm = shutil.which("npm")
    if npm:
        return npm
    # Windows: try common paths
    if platform.system() == "Windows":
        for candidate in [
            r"D:\Node.js\npm.cmd",
            r"C:\Program Files\nodejs\npm.cmd",
        ]:
            if Path(candidate).exists():
                return candidate
    print("❌ 未找到 npm，请先安装 Node.js 18+: https://nodejs.org/")
    sys.exit(1)


def _check_python_version() -> None:
    ver = sys.version_info
    if ver < (3, 12):
        print(f"❌ Python 版本过低: {ver.major}.{ver.minor}，需要 3.12+")
        sys.exit(1)
    print(f"✅ Python {ver.major}.{ver.minor}.{ver.micro}")


def _ensure_venv() -> None:
    if VENV_DIR.exists():
        return
    print("🔧 创建 Python 虚拟环境...")
    subprocess.check_call([sys.executable, "-m", "venv", str(VENV_DIR)])


def _install_backend_deps() -> None:
    py = _python()
    if not Path(py).exists():
        _ensure_venv()
    req = BACKEND_DIR / "requirements.txt"
    if not req.exists():
        print(f"❌ 找不到 {req}")
        sys.exit(1)
    print("📦 安装后端 Python 依赖...")
    subprocess.check_call([_pip(), "install", "-r", str(req)])


def _install_frontend_deps() -> None:
    pkg = FRONTEND_DIR / "package.json"
    if not pkg.exists():
        print(f"❌ 找不到 {pkg}")
        sys.exit(1)
    node_modules = FRONTEND_DIR / "node_modules"
    if node_modules.exists():
        # Quick check: if node_modules/.package-lock.json exists, skip
        lock = FRONTEND_DIR / "package-lock.json"
        if lock.exists():
            print("⏩ 前端依赖已存在，跳过安装（如需重装请删除 frontend/node_modules）")
            return
    print("📦 安装前端 Node.js 依赖...")
    npm = _npm()
    subprocess.check_call([npm, "install"], cwd=str(FRONTEND_DIR))


def _ensure_env_file() -> None:
    if ENV_FILE.exists():
        return
    if ENV_EXAMPLE.exists():
        shutil.copy2(ENV_EXAMPLE, ENV_FILE)
        print(f"📝 已从 .env.example 创建 .env（请按需修改配置）")
    else:
        print("⚠️  未找到 .env.example，请手动创建 .env")


def _start_backend() -> subprocess.Popen:
    py = _python()
    env = os.environ.copy()
    env["ZJCOST_DATA_DIR"] = str(BACKEND_DIR)
    env["PYTHONPATH"] = str(BACKEND_DIR)
    print(f"🚀 启动后端 (port 8098)...")
    return subprocess.Popen(
        [py, "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8098"],
        cwd=str(BACKEND_DIR),
        env=env,
    )


def _start_frontend() -> subprocess.Popen:
    npm = _npm()
    print(f"🚀 启动前端 (port 5173)...")
    return subprocess.Popen(
        [npm, "run", "dev", "--", "--host", "127.0.0.1", "--port", "5173"],
        cwd=str(FRONTEND_DIR),
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="筑衡 开发环境一键启动")
    parser.add_argument("--skip-install", action="store_true", help="跳过依赖安装")
    parser.add_argument("--backend-only", action="store_true", help="仅启动后端")
    parser.add_argument("--frontend-only", action="store_true", help="仅启动前端")
    args = parser.parse_args()

    print("=" * 50)
    print("  筑衡 (zjcost) — 开发环境启动")
    print("=" * 50)
    print()

    _check_python_version()
    _ensure_env_file()

    if not args.skip_install:
        _ensure_venv()
        _install_backend_deps()
        if not args.backend_only:
            _install_frontend_deps()

    procs = []

    try:
        if not args.frontend_only:
            procs.append(_start_backend())
        if not args.backend_only:
            procs.append(_start_frontend())

        print()
        print("✅ 服务已启动：")
        if not args.frontend_only:
            print("   后端 API:  http://127.0.0.1:8098")
            print("   API 文档:  http://127.0.0.1:8098/docs")
        if not args.backend_only:
            print("   前端应用:  http://localhost:5173/zjcost/")
        print()
        print("按 Ctrl+C 停止所有服务...")

        # Wait for any subprocess to exit (which signals an error)
        for p in procs:
            p.wait()
    except KeyboardInterrupt:
        print("\n⏹  正在停止服务...")
    finally:
        for p in procs:
            try:
                p.terminate()
                p.wait(timeout=5)
            except Exception:
                p.kill()


if __name__ == "__main__":
    main()