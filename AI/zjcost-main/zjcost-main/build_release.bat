@echo off
setlocal enabledelayedexpansion
title 筑衡 - 一键打包发布

set "ROOT=%~dp0"
set "BACKEND=%ROOT%backend"
set "FRONTEND=%ROOT%frontend"
set "TOOLS=%ROOT%tools"
set "PORTABLE_PY=%TOOLS%\python\python.exe"

echo.
echo  ╔══════════════════════════════════════╗
echo  ║   筑衡 (zjcost) — 一键打包           ║
echo  ╚══════════════════════════════════════╝
echo.

REM ── 1. 查找 Python（需带 venv 模块；embedded 便携版没有，须验证） ──
set "FOUND_PY="
if exist "%PORTABLE_PY%" (
    "%PORTABLE_PY%" -c "import venv" >nul 2>&1
    if not errorlevel 1 (
        set "FOUND_PY=%PORTABLE_PY%"
        echo  [OK] 便携 Python: %PORTABLE_PY%
    ) else (
        echo  [..] 便携 Python 为 embedded 版（无 venv 模块），改用系统 Python
    )
)
if not defined FOUND_PY (
    where python >nul 2>&1
    if not errorlevel 1 (
        python -c "import venv" >nul 2>&1
        if not errorlevel 1 (
            set "FOUND_PY=python"
            echo  [OK] 系统 Python
        ) else (
            echo  [!!] 系统 Python 缺少 venv 模块
        )
    ) else (
        echo  [..] 未找到系统 Python
    )
)
if not defined FOUND_PY (
    echo  [!!] 未找到可用的 Python（需完整版 Python 3.12+，embedded 版无法创建 venv）
    echo      请安装 Python 3.12+ 后重试
    pause
    exit /b 1
)

REM ── 2. 确保 venv 和依赖已安装 ──
if not exist "%BACKEND%\venv\Scripts\python.exe" (
    echo  [..] 创建 venv...
    "!FOUND_PY!" -m venv "%BACKEND%\venv"
)
echo  [..] 安装后端依赖...
"%BACKEND%\venv\Scripts\pip.exe" install -r "%BACKEND%\requirements.txt" -q
"%BACKEND%\venv\Scripts\pip.exe" install pyinstaller -q

REM ── 3. 构建前端 ──
echo.
echo  [..] 构建前端生产版本...
set "FOUND_NPM="
if exist "%TOOLS%\node\npm.cmd" (
    set "FOUND_NPM=%TOOLS%\node\npm.cmd"
) else (
    where npm.cmd >nul 2>&1
    if not errorlevel 1 set "FOUND_NPM=npm.cmd"
)

if defined FOUND_NPM (
    cd /d "%FRONTEND%"
    if not exist node_modules (
        call "!FOUND_NPM!" install
    )
    call "!FOUND_NPM!" run build
    echo  [OK] 前端构建完成
) else (
    echo  [!!] 未找到 npm，跳过前端构建
    echo      请确保 frontend/dist/ 已手动构建
)

REM ── 4. PyInstaller 打包 ──
echo.
echo  [..] PyInstaller 打包中（约 3-10 分钟）...
cd /d "%ROOT%\packaging"

"%BACKEND%\venv\Scripts\pyinstaller.exe" --clean --noconfirm "筑衡.spec"
if errorlevel 1 (
    echo  [!!] PyInstaller 打包失败
    echo      常见原因：
    echo      1. 杀毒软件拦截 — 请将项目加入白名单
    echo      2. 缺少依赖 — 运行 start_dev.bat 先装好依赖
    echo      3. 前端未构建 — 需要 frontend/dist/ 目录
    pause
    exit /b 1
)

echo.
echo  ╔══════════════════════════════════════╗
echo  ║   打包完成！                          ║
echo  ║   产出目录: packaging/dist/           ║
echo  ║   将 dist/ 文件夹拷给用户即可运行      ║
echo  ╚══════════════════════════════════════╝
echo.
pause
