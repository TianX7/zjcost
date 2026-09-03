# 临时验证：内置 CAD 内核嵌入模式端到端（用完即删）
import ctypes
import ctypes.wintypes as wt
import subprocess as sp
import time

import requests

u32 = ctypes.windll.user32
u32.SetProcessDPIAware()
BASE = "http://127.0.0.1:8098/api"
TASK = "fead6fd7-e2c8-4866-bb7e-de8627e6c2a9"


def host_rect():
    h = u32.FindWindowW("ZjCostCadViewer", None)
    if not h:
        return None
    r = wt.RECT()
    u32.GetWindowRect(h, ctypes.byref(r))
    return (r.left, r.top, r.right - r.left, r.bottom - r.top)


def post(path, body=None):
    return requests.post(f"{BASE}/drawing-recognition/{TASK}/{path}", json=body or {}, timeout=15).json()


r = post("embed-cad", {"x": 200, "y": 200, "w": 900, "h": 600, "visible": True})
print("启动:", r, flush=True)

ok = False
for _ in range(120):
    time.sleep(2)
    hr = host_rect()
    if hr and hr[2] > 100:
        print("宿主窗口:", hr, flush=True)
        ok = abs(hr[0] - 200) <= 2 and abs(hr[1] - 200) <= 2 and abs(hr[2] - 900) <= 2 and abs(hr[3] - 600) <= 2
        break
print("初始贴合:", "PASS" if ok else f"FAIL {host_rect()}", flush=True)

# 进程路径：确认运行的是内置副本或重定向后的实例
out = sp.run(["wmic", "process", "where", "name='CADReader.exe'", "get", "ExecutablePath"],
             capture_output=True, text=True).stdout
print("运行实例:", [l.strip() for l in out.splitlines() if "CADReader" in l and ".exe" in l], flush=True)

post("embed-cad/stop")
time.sleep(4)
h = u32.FindWindowW("ZjCostCadViewer", None)
left = sp.run(["tasklist", "/FI", "IMAGENAME eq CADReader.exe"], capture_output=True, text=True).stdout
print("停止: 宿主", "已退出 PASS" if not h else "FAIL", "；进程", "无残留 PASS" if "CADReader.exe" not in left else "FAIL", flush=True)
