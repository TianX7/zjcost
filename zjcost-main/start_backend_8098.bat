@echo off
setlocal enabledelayedexpansion
title 筑衡-后端

set "PROJECT_ROOT=%~dp0"
set "BACKEND=%PROJECT_ROOT%backend"
set "TOOLS=%PROJECT_ROOT%tools"
set "PORTABLE_PY=%TOOLS%\python\python.exe"
set "VENV_PY=%BACKEND%\venv\Scripts\python.exe"

REM ── 杀毒检测 ──
set "AV_WARN=0"
for /f "delims=" %%a in ('powershell -NoProfile -Command "Get-CimInstance -Namespace root/SecurityCenter2 -ClassName AntivirusProduct -ErrorAction SilentlyContinue | Select-Object -ExpandProperty displayName 2>$null"') do (
    echo  [!] 检测到杀毒软件: %%a
    set "AV_WARN=1"
)
if "!AV_WARN!"=="1" (
    echo  [!] 若启动失败请将本项目文件夹加入杀毒白名单
    echo      或以管理员运行: Add-MpPreference -ExclusionPath "%PROJECT_ROOT%"
    echo.
)

REM ── 查找 Python：便携版 > venv > 系统 ──
set "BACKEND_PY="
if exist "%PORTABLE_PY%" (
    set "BACKEND_PY=%PORTABLE_PY%"
) else if exist "%VENV_PY%" (
    set "BACKEND_PY=%VENV_PY%"
) else (
    where python >nul 2>&1
    if not errorlevel 1 (
        set "BACKEND_PY=python"
    ) else (
        echo 未找到 Python，请双击 portable_setup.bat
        pause
        exit /b 1
    )
)

REM ── 创建 venv（如果不存在）──
if not exist "%VENV_PY%" (
    echo 首次运行：创建虚拟环境...
    "!BACKEND_PY!" -m venv "%BACKEND%\venv"
    if errorlevel 1 (
        echo 创建 venv 失败（可能被杀毒软件拦截）
        echo 请将项目文件夹加入杀毒白名单后重试
        pause
        exit /b 1
    )
    set "BACKEND_PY=%VENV_PY%"
)
if not "!BACKEND_PY!"=="%VENV_PY%" set "BACKEND_PY=%VENV_PY%"

REM ── 安装依赖（首次）──
if not exist "%BACKEND%\venv\Lib\site-packages\fastapi" (
    echo 首次运行：安装 Python 依赖...
    "%BACKEND%\venv\Scripts\pip.exe" install -r "%BACKEND%\requirements.txt" -q
    if errorlevel 1 (
        echo 切换国内镜像重试...
        "%BACKEND%\venv\Scripts\pip.exe" install -r "%BACKEND%\requirements.txt" -q -i https://pypi.tuna.tsinghua.edu.cn/simple
        if errorlevel 1 (
            echo 依赖安装失败 — 可能网络不可用或被杀毒拦截
            echo 请将项目文件夹加入杀毒白名单，或在有网环境下先运行一次
            pause
            exit /b 1
        )
    )
)

REM ── 确保 .env ──
if not exist "%PROJECT_ROOT%.env" (
    if exist "%PROJECT_ROOT%.env.example" copy "%PROJECT_ROOT%.env.example" "%PROJECT_ROOT%.env" >nul
)

set "ZJCOST_DATA_DIR=%BACKEND%"
set "PYTHONPATH=%BACKEND%"
cd /d "%BACKEND%"

echo 启动后端 (port 8098) ...
"%BACKEND_PY%" -m uvicorn app.main:app --host 127.0.0.1 --port 8098
pause
