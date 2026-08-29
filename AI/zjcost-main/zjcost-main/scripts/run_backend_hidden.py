from __future__ import annotations

import os
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
LOG_PATH = ROOT / "backend_8098.hidden.log"

os.chdir(BACKEND)
sys.path.insert(0, str(BACKEND))
os.environ.setdefault("PYTHONPATH", str(BACKEND))
os.environ.setdefault("ZJCOST_DATA_DIR", str(BACKEND))

log = LOG_PATH.open("a", encoding="utf-8", buffering=1)
sys.stdout = log
sys.stderr = log

print(f"[{datetime.now().isoformat(timespec='seconds')}] starting backend 8098", flush=True)

import uvicorn  # noqa: E402

uvicorn.run("app.main:app", host="127.0.0.1", port=8098, log_level="info")
