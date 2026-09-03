# -*- coding: utf-8 -*-
"""临时验证脚本：持续采样 CADReader/嵌入宿主的可见顶层窗位置，输出到日志。"""
import ctypes
import ctypes.wintypes as wt
import os
import sys
import time

u32 = ctypes.windll.user32
k32 = ctypes.windll.kernel32
PROCESS_QUERY_LIMITED_INFORMATION = 0x1000


def process_name(pid: int) -> str:
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


def text(hwnd: int) -> str:
    n = u32.GetWindowTextLengthW(hwnd)
    buf = ctypes.create_unicode_buffer(n + 2)
    u32.GetWindowTextW(hwnd, buf, n + 2)
    return buf.value


def cls(hwnd: int) -> str:
    buf = ctypes.create_unicode_buffer(256)
    u32.GetClassNameW(hwnd, buf, 256)
    return buf.value


def rect(hwnd: int) -> tuple:
    r = wt.RECT()
    u32.GetWindowRect(hwnd, ctypes.byref(r))
    return r.left, r.top, r.right, r.bottom


def main() -> int:
    log_path = sys.argv[1] if len(sys.argv) > 1 else "cad_window_monitor.log"
    duration = float(sys.argv[2]) if len(sys.argv) > 2 else 90.0
    deadline = time.time() + duration
    vx = u32.GetSystemMetrics(76)
    vy = u32.GetSystemMetrics(77)
    vw = u32.GetSystemMetrics(78)
    vh = u32.GetSystemMetrics(79)
    seen = set()
    with open(log_path, "w", encoding="utf-8") as f:
        f.write(f"virtual_screen=({vx},{vy},{vw},{vh})\n")
        while time.time() < deadline:
            now = time.strftime("%H:%M:%S.") + f"{int(time.time() * 1000) % 1000:03d}"
            rows = []

            @ctypes.WINFUNCTYPE(ctypes.c_bool, wt.HWND, wt.LPARAM)
            def cb(hwnd, _):
                if not u32.IsWindowVisible(hwnd):
                    return True
                pid = wt.DWORD()
                u32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
                name = process_name(pid.value)
                if name != "cadreader.exe":
                    return True
                r = rect(hwnd)
                w = r[2] - r[0]
                h = r[3] - r[1]
                if w <= 0 or h <= 0:
                    return True
                on_screen = r[2] > vx and r[0] < vx + vw and r[3] > vy and r[1] < vy + vh
                rows.append(
                    f"{now} visible pid={pid.value} hwnd={hwnd:#x} on_screen={on_screen} "
                    f"cls={cls(hwnd)!r} title={text(hwnd)!r} rect={r} size={w}x{h}"
                )
                seen.add(hwnd)
                return True

            u32.EnumWindows(cb, 0)
            for row in rows:
                f.write(row + "\n")
            f.flush()
            time.sleep(0.04)
    return 0


if __name__ == "__main__":
    sys.exit(main())
