$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$Backend = Join-Path $Root "backend"
$Python = Join-Path $Root "tools\python\python.exe"
$OutLog = Join-Path $Root "backend_8098.hidden.out.log"
$ErrLog = Join-Path $Root "backend_8098.hidden.err.log"

[System.Environment]::SetEnvironmentVariable("PATH", $null, "Process")
[System.Environment]::SetEnvironmentVariable(
  "Path",
  "C:\Windows\System32;C:\Windows;C:\Windows\System32\WindowsPowerShell\v1.0",
  "Process"
)
$env:PYTHONPATH = $Backend
$env:ZJCOST_DATA_DIR = $Backend

Start-Process `
  -FilePath $Python `
  -ArgumentList @("-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8098") `
  -WorkingDirectory $Backend `
  -RedirectStandardOutput $OutLog `
  -RedirectStandardError $ErrLog `
  -WindowStyle Hidden
