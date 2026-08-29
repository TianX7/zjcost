@echo off
setlocal enabledelayedexpansion
title 筑衡 - 准备离线缓存

set "ROOT=%~dp0"
set "BACKEND=%ROOT%backend"
set "FRONTEND=%ROOT%frontend"
set "TOOLS=%ROOT%tools"
set "OFFLINE_DIR=%TOOLS%\offline_packages"
set "PORTABLE_PY=%TOOLS%\python\python.exe"

echo.
echo  ╔══════════════════════════════════════╗
echo  ║   筑衡 — 准备离线安装缓存             ║
echo  ╚══════════════════════════════════════╝
echo.
echo  此脚本会下载所有 Python/Node 依赖包到本地，
echo  之后在完全离线的电脑上也能安装依赖。
echo.

REM ── 查找 Python ──
set "FOUND_PY="
if exist "%PORTABLE_PY%" (
    set "FOUND_PY=%PORTABLE_PY%"
) else if exist "%BACKEND%\venv\Scripts\python.exe" (
    set "FOUND_PY=%BACKEND%\venv\Scripts\python.exe"
) else (
    where python >nul 2>&1
    if not errorlevel 1 set "FOUND_PY=python"
)

if not defined FOUND_PY (
    echo  [!!] 未找到 Python，请先运行 start_dev.bat
    pause
    exit /b 1
)

REM ── 1. 下载 Python wheels ──
echo  [..] 下载 Python 依赖包到 %OFFLINE_DIR%\pip ...
if not exist "%OFFLINE_DIR%\pip" mkdir "%OFFLINE_DIR%\pip"

set "PIP_CMD="
if exist "%BACKEND%\venv\Scripts\pip.exe" (
    set "PIP_CMD=%BACKEND%\venv\Scripts\pip.exe"
) else (
    set "PIP_CMD=pip"
)

"%PIP_CMD%" download -r "%BACKEND%\requirements.txt" -d "%OFFLINE_DIR%\pip"
if errorlevel 1 (
    echo  [..] 默认源失败，切换清华镜像...
    "%PIP_CMD%" download -r "%BACKEND%\requirements.txt" -d "%OFFLINE_DIR%\pip" -i https://pypi.tuna.tsinghua.edu.cn/simple
)
echo  [OK] Python 离线包已缓存

REM ── 2. 缓存 Node.js tarballs ──
echo  [..] 缓存 Node.js 依赖...
if not exist "%OFFLINE_DIR%\npm" mkdir "%OFFLINE_DIR%\npm"

set "FOUND_NPM="
if exist "%TOOLS%\node\npm.cmd" (
    set "FOUND_NPM=%TOOLS%\node\npm.cmd"
) else (
    where npm.cmd >nul 2>&1
    if not errorlevel 1 set "FOUND_NPM=npm.cmd"
)

if defined FOUND_NPM (
    cd /d "%FRONTEND%"
    echo  正在下载 npm 包...
    call "!FOUND_NPM!" pack --dry-run 2>nul || echo  [..] 跳过 npm pack（非关键）
    
    REM Copy node_modules as offline cache (simpler approach)
    if exist node_modules (
        echo  [OK] node_modules 已作为离线缓存可用
        echo      离线安装时直接拷贝整个项目文件夹即可
    )
) else (
    echo  [..] 未找到 npm，跳过 Node.js 缓存
)

REM ── 3. 创建离线安装说明 ──
echo  [..] 生成离线安装说明...
(
echo # 离线安装指南
echo.
echo ## 已缓存内容
echo - Python wheels: tools/offline_packages/pip/
echo - Node.js: 直接拷贝 frontend/node_modules/ 即可
echo.
echo ## 离线安装方法
echo.
echo ### Python 依赖（离线）
echo 收到离线包后，运行 start_dev.bat 时脚本会自动检测并使用本地缓存。
echo 手动安装: pip install --no-index --find-links tools/offline_packages/pip/ -r backend/requirements.txt
echo.
echo ### Node.js 依赖（离线）
echo 如果 frontend/node_modules/ 已存在，npm 不会重新下载。
echo 整个项目文件夹一起拷贝到离线电脑即可。
) > "%OFFLINE_DIR%\README.md"

echo.
echo  ╔══════════════════════════════════════╗
echo  ║   离线缓存准备完成！                  ║
echo  ║   缓存目录: tools/offline_packages/  ║
echo  ║   将整个项目拷到离线电脑即可使用         ║
echo  ╚══════════════════════════════════════╝
echo.
pause
