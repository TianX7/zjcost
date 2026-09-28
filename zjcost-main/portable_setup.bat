@echo off
setlocal enabledelayedexpansion
title 筑衡 - 环境初始化（首次运行）

set "ROOT=%~dp0"
set "TOOLS=%ROOT%tools"

echo.
echo  ╔════════════════════════════════════════════╗
echo  ║   筑衡 (zjcost) — 环境初始化（首次运行）   ║
echo  ║   自动下载 Python + Node.js 便携版         ║
echo  ╚════════════════════════════════════════════╝
echo.

REM ══════════════════════════════════════════
REM  检查是否已有系统 Python / Node
REM ══════════════════════════════════════════
set "NEED_PYTHON=1"
set "NEED_NODE=1"

where python >nul 2>&1
if not errorlevel 1 (
    for /f "tokens=2 delims= " %%v in ('python --version 2^>^&1') do set "SYS_PY_VER=%%v"
    echo  [OK] 检测到系统 Python: !SYS_PY_VER!
    set "NEED_PYTHON=0"
)

where node >nul 2>&1
if not errorlevel 1 (
    for /f "delims=" %%v in ('node --version 2^>^&1') do set "SYS_NODE_VER=%%v"
    echo  [OK] 检测到系统 Node.js: !SYS_NODE_VER!
    set "NEED_NODE=0"
)

if "!NEED_PYTHON!"=="0" if "!NEED_NODE!"=="0" (
    echo.
    echo  系统已安装 Python 和 Node.js，无需下载便携版。
    echo  你可以直接双击 start_dev.bat 启动项目！
    echo.
    pause
    exit /b 0
)

REM ══════════════════════════════════════════
REM  便携版目录
REM ══════════════════════════════════════════
set "PYTHON_DIR=%TOOLS%\python"
set "NODE_DIR=%TOOLS%\node"

if exist "%PYTHON_DIR%\python.exe" (
    echo  [OK] 便携 Python 已存在于 %PYTHON_DIR%
    set "NEED_PYTHON=0"
)
if exist "%NODE_DIR%\node.exe" (
    echo  [OK] 便携 Node.js 已存在于 %NODE_DIR%
    set "NEED_NODE=0"
)

if "!NEED_PYTHON!"=="0" if "!NEED_NODE!"=="0" (
    echo.
    echo  便携环境已就绪，你可以直接双击 start_dev.bat 启动项目！
    echo.
    pause
    exit /b 0
)

echo.
echo  即将下载便携版到: %TOOLS%
echo  （约 80-150 MB，仅需下载一次，不会影响系统其他程序）
echo.
choice /C YN /M "  是否继续下载"
if errorlevel 2 (
    echo  已取消。如需手动安装，请参阅 SETUP.md
    pause
    exit /b 0
)

if not exist "%TOOLS%" mkdir "%TOOLS%"

REM ══════════════════════════════════════════
REM  下载 Python 便携版
REM ══════════════════════════════════════════
if "!NEED_PYTHON!"=="1" (
    echo.
    echo  ── 下载 Python 3.12 便携版 ──
    set "PY_URL=https://www.python.org/ftp/python/3.12.10/python-3.12.10-embed-amd64.zip"
    set "PY_ZIP=%TOOLS%\python-embed.zip"

    if not exist "%PYTHON_DIR%\python.exe" (
        echo  正在下载...（约 15 MB）
        powershell -NoProfile -Command "Invoke-WebRequest -Uri '!PY_URL!' -OutFile '!PY_ZIP!' -UseBasicParsing"
        if errorlevel 1 (
            echo  [!!] 下载失败，请检查网络连接
            echo  手动下载地址: !PY_URL!
            echo  下载后放到 !PY_ZIP! 再重新运行此脚本
            pause
            exit /b 1
        )
        echo  下载完成，正在解压...
        mkdir "%PYTHON_DIR%" 2>nul
        powershell -NoProfile -Command "Expand-Archive -Path '!PY_ZIP!' -DestinationPath '!PYTHON_DIR!' -Force"
        del "%PY_ZIP%" 2>nul

        REM 便携版需要安装 pip
        echo  安装 pip 到便携 Python...
        powershell -NoProfile -Command "Invoke-WebRequest -Uri 'https://bootstrap.pypa.io/get-pip.py' -OutFile '%TOOLS%\get-pip.py' -UseBasicParsing"
        "%PYTHON_DIR%\python.exe" "%TOOLS%\get-pip.py" -q 2>nul
        del "%TOOLS%\get-pip.py" 2>nul

        REM 便携 Python 需要解开 import 限制
        powershell -NoProfile -Command "$p = Get-Content '%PYTHON_DIR%\python312._pth'; $p = $p -replace '#import site','import site'; Set-Content '%PYTHON_DIR%\python312._pth' $p -Encoding UTF8"
    )
    echo  [OK] 便携 Python 已就绪: %PYTHON_DIR%
)

REM ══════════════════════════════════════════
REM  下载 Node.js 便携版
REM ══════════════════════════════════════════
if "!NEED_NODE!"=="1" (
    echo.
    echo  ── 下载 Node.js 22 便携版 ──
    set "NODE_URL=https://nodejs.org/dist/v22.16.0/node-v22.16.0-win-x64.zip"
    set "NODE_ZIP=%TOOLS%\node-portable.zip"

    if not exist "%NODE_DIR%\node.exe" (
        echo  正在下载...（约 35 MB）
        powershell -NoProfile -Command "Invoke-WebRequest -Uri '!NODE_URL!' -OutFile '!NODE_ZIP!' -UseBasicParsing"
        if errorlevel 1 (
            echo  [!!] 下载失败，请检查网络连接
            echo  手动下载地址: !NODE_URL!
            echo  下载后解压到 %TOOLS%\node-portable-temp 再重新运行
            pause
            exit /b 1
        )
        echo  下载完成，正在解压...
        powershell -NoProfile -Command "Expand-Archive -Path '!NODE_ZIP!' -DestinationPath '%TOOLS%' -Force"
        REM Node zip 解压出 node-v22.16.0-win-x64/ 这样的顶层目录，重命名为 node
        for /d %%d in ("%TOOLS%\node-v*-win-x64") do (
            if exist "%NODE_DIR%" rd /s /q "%NODE_DIR%" 2>nul
            move "%%d" "%NODE_DIR%" >nul
        )
        del "%NODE_ZIP%" 2>nul
    )
    echo  [OK] 便携 Node.js 已就绪: %NODE_DIR%
)

echo.
echo  ╔════════════════════════════════════════════╗
echo  ║   环境初始化完成！                          ║
echo  ║   请双击 start_dev.bat 启动项目            ║
echo  ╚════════════════════════════════════════════╝
echo.
pause