# -*- coding: utf-8 -*-
"""诊断：启动内置 CADReader，记录窗口树演变（类名/标题/尺寸/可见性/父子关系）。"""
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
DURATION = float(sys.argv[2]) if len(sys.argv) > 2 else 22.0
OUT = sys.argv[3] if len(sys.argv) > 3 else "_tree_diag_out.txt"


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


def dump_window(f, hwnd, indent=""):
    try:
        vis = bool(u32.IsWindowVisible(hwnd))
        c = cls(hwnd)
        t = text(hwnd)
        rc = rect(hwnd)
        style = u32.GetWindowLongW(hwnd, -16)
        f.write(f"{indent}hwnd={hwnd:#x} vis={vis} cls={c!r} title={t!r} rect={rc} style={style:#x}\n")
    except Exception as exc:
        f.write(f"{indent}hwnd={hwnd:#x} <err {exc}>\n")


def main():
    proc = subprocess.Popen([EXE, DWG])
    t0 = time.time()
    with open(OUT, "w", encoding="utf-8") as f:
        f.write(f"exe={EXE}\ndwg={DWG}\npid={proc.pid}\n")
        children_dumped = False
        while time.time() - t0 < DURATION:
            now = time.time() - t0
            rows = []

            @ctypes.WINFUNCTYPE(ctypes.c_bool, wt.HWND, wt.LPARAM)
            def cb(hwnd, _):
                pid = wt.DWORD()
                u32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
                if process_name(pid.value) != "cadreader.exe":
                    return True
                rows.append((hwnd, pid.value))
                return True

            u32.EnumWindows(cb, 0)
            if rows:
                f.write(f"\n=== t={now:.2f}s ===\n")
                for hwnd, pid in rows:
                    dump_window(f, hwnd)
                # 找到主窗口后，一次性 dump 其完整子树（找看图区类名）
                if not children_dumped:
                    for hwnd, pid in rows:
                        if "CAD快速看图" in text(hwnd) and rect(hwnd)[2] > 400:
                            f.write(f"--- children of {hwnd:#x} at t={now:.2f}s ---\n")

                            @ctypes.WINFUNCTYPE(ctypes.c_bool, wt.HWND, wt.LPARAM)
                            def child_cb(child, _):
                                dump_window(f, child, indent="  ")
                                return True

                            u32.EnumChildWindows(hwnd, child_cb, 0)
                            children_dumped = True
                            break
                f.flush()
            time.sleep(0.1)
    try:
        subprocess.run(["taskkill", "/F", "/PID", str(proc.pid)],
                       capture_output=True, creationflags=subprocess.CREATE_NO_WINDOW)
    except Exception:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
