# -*- coding: utf-8 -*-
"""临时诊断：列出 CADReader 进程的所有顶层窗与子窗（类名/标题/尺寸/可见性）。"""
import ctypes
import ctypes.wintypes as wt
import sys

u32 = ctypes.windll.user32
target_pid = int(sys.argv[1]) if len(sys.argv) > 1 else 0

top = []

@ctypes.WINFUNCTYPE(ctypes.c_bool, wt.HWND, wt.LPARAM)
def top_cb(hwnd, _):
    wpid = wt.DWORD()
    u32.GetWindowThreadProcessId(hwnd, ctypes.byref(wpid))
    if target_pid and wpid.value != target_pid:
        return True
    top.append((hwnd, wpid.value))
    return True

u32.EnumWindows(top_cb, 0)

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
    return (r.left, r.top, r.right - r.left, r.bottom - r.top)

for hwnd, pid in top:
    t, c, rc = text(hwnd), cls(hwnd), rect(hwnd)
    vis = u32.IsWindowVisible(hwnd)
    print(f"TOP pid={pid} hwnd={hwnd:#x} vis={vis} cls={c!r} title={t!r} rect={rc}")
    kids = []
    @ctypes.WINFUNCTYPE(ctypes.c_bool, wt.HWND, wt.LPARAM)
    def child_cb(child, _):
        kids.append(child)
        return True
    u32.EnumChildWindows(hwnd, child_cb, 0)
    for k in kids:
        print(f"    CHILD hwnd={k:#x} vis={u32.IsWindowVisible(k)} cls={cls(k)!r} title={text(k)!r} rect={rect(k)}")
