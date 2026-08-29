@echo off
setlocal enabledelayedexpansion
title 筑衡-前端

set "PROJECT_ROOT=%~dp0"
set "FRONTEND=%PROJECT_ROOT%frontend"
set "TOOLS=%PROJECT_ROOT%tools"
set "PORTABLE_NPM=%TOOLS%\node\npm.cmd"

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

REM ── 查找 npm：便携版 > 系统 PATH > 常见路径 ──
set "FOUND_NPM="
if exist "%PORTABLE_NPM%" (
    set "FOUND_NPM=%PORTABLE_NPM%"
    goto :npm_found
)

where npm.cmd >nul 2>&1
if not errorlevel 1 (
    set "FOUND_NPM=npm.cmd"
    goto :npm_found
)

for %%D in (
    "C:\Program Files\nodejs\npm.cmd"
    "D:\Node.js\npm.cmd"
) do (
    if exist %%D (
        set "FOUND_NPM=%%~D"
        goto :npm_found
    )
)

echo 未找到 npm，请双击 portable_setup.bat
pause
exit /b 1

:npm_found

REM ── 安装依赖（首次）──
if not exist "%FRONTEND%\node_modules" (
    echo 首次运行：安装 Node.js 依赖...
    cd /d "%FRONTEND%"
    call "!FOUND_NPM!" install
    if errorlevel 1 (
        echo 切换国内镜像重试...
        call "!FOUND_NPM!" install --registry https://registry.npmmirror.com
        if errorlevel 1 (
            echo 依赖安装失败 — 可能网络不可用或被杀毒拦截
            echo 请将项目文件夹加入杀毒白名单，或在有网环境下先运行一次
            pause
            exit /b 1
        )
    )
)

cd /d "%FRONTEND%"
echo 启动前端 (port 5173) ...
call "!FOUND_NPM!" run dev -- --host 127.0.0.1 --port 5173
pause
