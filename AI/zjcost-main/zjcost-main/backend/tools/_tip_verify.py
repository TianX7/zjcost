# -*- coding: utf-8 -*-
"""验证：设置 NoRemind=true 后首次提示窗是否还出现。同时验证闪屏/主窗口出现时序。"""
import ctypes
import ctypes.wintypes as wt
import os
import subprocess
import sys
import time

u32 = ctypes.windll.user32
k32 = ctypes.windll.kernel32
PROCESS_QUERY_LIMITED_INFORMATION = 0x1000

EXE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "CADReader", "CADReader.exe")
DWG = sys.argv[1]
DURATION = float(sys.argv[2]) if len(sys.argv) > 2 else 15.0


def process_name(pid):
    try:
        h = k32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
        if not h:
            return ""
        try:
            buf = ctypes.create_unicode_buffer(32768)
            size = wt.DWORD(len(buf))
            if k32.QueryFullProcessImageNameW(h, 0, buf, ctypes.byref(size)):
                return os.path.basename(buf.value).lower()
        finally:
            k32.CloseHandle(h)
    except Exception:
        pass
    return ""


def text(hwnd):
    n = u32.GetWindowTextLengthW(hwnd)
    buf = ctypes.create_unicode_buffer(n + 2)
    u32.GetWindowTextW(hwnd, buf, n + 2)
    return buf.value


def cls(hwnd):
    buf = ctypes.create_unicode_buffer(256)
    u32.GetClassNameW(hwnd, buf, 256)
    return buf.value


def rect(hwnd):
    r = wt.RECT()
    u32.GetWindowRect(hwnd, ctypes.byref(r))
    return r.left, r.top, r.right - r.left, r.bottom - r.top


def main():
    proc = subprocess.Popen([EXE, DWG])
    t0 = time.time()
    tip_seen = False
    events = []
    while time.time() - t0 < DURATION:
        now = time.time() - t0
        rows = []

        @ctypes.WINFUNCTYPE(ctypes.c_bool, wt.HWND, wt.LPARAM)
        def cb(hwnd, _):
            if not u32.IsWindowVisible(hwnd):
                return True
            pid = wt.DWORD()
            u32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
            if process_name(pid.value) != "cadreader.exe":
                return True
            rows.append(hwnd)
            return True

        u32.EnumWindows(cb, 0)
        for hwnd in rows:
            t, c, rc = text(hwnd), cls(hwnd), rect(hwnd)
            key = (t[:12], rc[2], rc[3])
            if not t and c == "QWidget" and rc[2] <= 900 and rc[3] <= 600 and rc[2:] != (200, 200):
                if not tip_seen:
                    tip_seen = True
                    events.append(f"t={now:.2f}s TIP_APPEARED rect={rc}")
            if "CAD快速看图" in t and not any("MAIN_VIS" in e for e in events):
                events.append(f"t={now:.2f}s MAIN_VISIBLE rect={rc}")
        time.sleep(0.05)
    for e in events:
        print(e)
    print("TIP_SEEN:", tip_seen)
    try:
        subprocess.run(["taskkill", "/F", "/PID", str(proc.pid)],
                       capture_output=True, creationflags=subprocess.CREATE_NO_WINDOW)
    except Exception:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
