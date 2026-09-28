$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$backend = Join-Path $root "backend"
$frontend = Join-Path $root "frontend"
$venvPy = Join-Path $backend "venv\Scripts\python.exe"
$venvPip = Join-Path $backend "venv\Scripts\pip.exe"
$portablePy = Join-Path $root "tools\python\python.exe"
$portablePip = Join-Path $root "tools\python\Scripts\pip.exe"
$portableNpm = Join-Path $root "tools\node\npm.cmd"
$reqFile = Join-Path $backend "requirements.txt"
$usePortablePy = $false
$useVenv = $false

Write-Host ""
Write-Host "  ========================================"
Write-Host "    ZJC - Dev Server Launcher"
Write-Host "  ========================================"
Write-Host ""

# --- Find Python ---
$foundPy = $null
$foundPip = $null
if (Test-Path $portablePy) {
    $foundPy = $portablePy
    $usePortablePy = $true
    $foundPip = "$portablePy -m pip"
    Write-Host "  [OK] Portable Python found (embedded)"
} elseif (Test-Path $venvPy) {
    $foundPy = $venvPy
    $foundPip = $venvPip
    $useVenv = $true
    Write-Host "  [OK] venv Python found"
} else {
    try { $foundPy = (Get-Command python -ErrorAction Stop).Source }
    catch {
        Write-Host "  [!!] Python not found"
        Read-Host "  Press Enter to exit"
        exit 1
    }
    $foundPip = "pip"
    Write-Host "  [OK] System Python found"
}

# --- Create venv if needed (only for system Python, not embedded) ---
if (-not $usePortablePy -and -not (Test-Path $venvPy)) {
    Write-Host "  [..] Creating venv..."
    & $foundPy -m venv (Join-Path $backend "venv")
    if (-not (Test-Path $venvPy)) {
        Write-Host "  [!!] Failed to create venv"
        Read-Host "  Press Enter to exit"
        exit 1
    }
    $foundPy = $venvPy
    $foundPip = $venvPip
    $useVenv = $true
    Write-Host "  [OK] venv created"
}

# --- Determine site-packages path for checking deps ---
if ($usePortablePy) {
    $pyDir = Split-Path -Parent $portablePy
    $fastapiDir = Join-Path $pyDir "Lib\site-packages\fastapi"
    $pipCmd = $portablePy
    $pipArgs = @("-m", "pip", "install", "-r", $reqFile, "-q")
} elseif ($useVenv) {
    $fastapiDir = Join-Path $backend "venv\Lib\site-packages\fastapi"
    $pipCmd = $venvPip
    $pipArgs = @("install", "-r", $reqFile, "-q")
} else {
    $fastapiDir = Join-Path $backend "venv\Lib\site-packages\fastapi"
    $pipCmd = "pip"
    $pipArgs = @("install", "-r", $reqFile, "-q")
}

# --- Install Python deps if needed ---
if (-not (Test-Path $fastapiDir)) {
    Write-Host "  [..] Installing Python deps..."
    if ($usePortablePy) {
        & $pipCmd -m pip install -r $reqFile -q 2>&1 | Out-Host
    } else {
        & $pipCmd install -r $reqFile -q 2>&1 | Out-Host
    }
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  [..] Retrying with mirror..."
        if ($usePortablePy) {
            & $pipCmd -m pip install -r $reqFile -q -i https://pypi.tuna.tsinghua.edu.cn/simple 2>&1 | Out-Host
        } else {
            & $pipCmd install -r $reqFile -q -i https://pypi.tuna.tsinghua.edu.cn/simple 2>&1 | Out-Host
        }
    }
    Write-Host "  [OK] Python deps ready"
} else {
    Write-Host "  [OK] Python deps ready"
}

# --- Find npm ---
$npm = $null
if (Test-Path $portableNpm) {
    $npm = $portableNpm
    Write-Host "  [OK] Portable Node.js found"
} else {
    try { $npm = (Get-Command npm.cmd -ErrorAction Stop).Source }
    catch { Write-Host "  [!!] Node.js not found, backend only" }
    if ($npm) { Write-Host "  [OK] System npm found" }
}
$noFrontend = -not $npm

# --- Install npm deps if needed ---
if (-not $noFrontend) {
    $nmDir = Join-Path $frontend "node_modules"
    if (-not (Test-Path $nmDir)) {
        Write-Host "  [..] Installing Node.js deps..."
        Push-Location $frontend
        & $npm install 2>&1 | Out-Host
        if ($LASTEXITCODE -ne 0) {
            & $npm install --registry https://registry.npmmirror.com 2>&1 | Out-Host
        }
        Pop-Location
        Write-Host "  [OK] Node.js deps ready"
    } else {
        Write-Host "  [OK] Node.js deps ready"
    }
}

# --- Start Backend ---
Write-Host ""
Write-Host "  ----------------------------------------"
Write-Host "   Starting services..."
Write-Host "  ----------------------------------------"
Write-Host ""
$env:ZJCOST_DATA_DIR = $backend
$env:PYTHONPATH = $backend
Write-Host "  [->] Starting backend (http://127.0.0.1:8098) ..."
Start-Process -FilePath "cmd.exe" -ArgumentList "/k", "title ZJC-Backend && cd /d `"$backend`" && set ZJCOST_DATA_DIR=$backend && set PYTHONPATH=$backend && `"$foundPy`" -m uvicorn app.main:app --host 127.0.0.1 --port 8098" -WindowStyle Normal

# --- Start Frontend ---
if (-not $noFrontend) {
    Write-Host "  [->] Starting frontend (http://127.0.0.1:5173/zjcost/) ..."
    $nodeDir = Split-Path -Parent $npm
    Start-Process -FilePath "cmd.exe" -ArgumentList "/k", "title ZJC-Frontend && cd /d `"$frontend`" && set PATH=$nodeDir;%PATH% && call `"$npm`" run dev -- --host 127.0.0.1 --port 5173" -WindowStyle Normal
}

# --- Wait for Backend ---
Write-Host ""
Write-Host "  Waiting for backend..."
$backendReady = $false
for ($i = 1; $i -le 40; $i++) {
    try {
        $r = Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:8098/healthz" -TimeoutSec 2
        if ($r.StatusCode -eq 200) {
            $backendReady = $true
            Write-Host "  [OK] Backend ready"
            break
        }
    } catch {
        Start-Sleep -Seconds 1
    }
}

# --- Wait for Frontend ---
if (-not $noFrontend) {
    Write-Host "  Waiting for frontend..."
    $frontendReady = $false
    for ($i = 1; $i -le 40; $i++) {
        try {
            $r = Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:5173/zjcost/" -TimeoutSec 2
            if ($r.StatusCode -eq 200) {
                $frontendReady = $true
                Write-Host "  [OK] Frontend ready"
                break
            }
        } catch {
            Start-Sleep -Seconds 1
        }
    }
}

# --- Result ---
Write-Host ""
Write-Host "  ========================================"
if ($frontendReady) { Write-Host "    Frontend: http://127.0.0.1:5173/zjcost/" }
if ($backendReady) {
    Write-Host "    Backend:  http://127.0.0.1:8098"
    Write-Host "    API Docs: http://127.0.0.1:8098/docs"
}
Write-Host "  ========================================"
Write-Host ""

if ($frontendReady) {
    Write-Host "  Opening browser..."
    Start-Process "http://127.0.0.1:5173/zjcost/"
}

Write-Host "  Close this window - services keep running."
Write-Host "  To stop: close ZJC-Backend and ZJC-Frontend windows."
Write-Host ""
Read-Host "  Press Enter to close this window"
