# -*- coding: utf-8 -*-
"""临时诊断：隐藏启动 CAD，等待"提示"对话框出现，PrintWindow 截图 + 枚举子窗。"""
import ctypes
import ctypes.wintypes as wt
import os
import struct
import subprocess
import sys
import time
import zlib

u32 = ctypes.windll.user32
g32 = ctypes.windll.gdi32
k32 = ctypes.windll.kernel32

DWG = r"uploads_cache\0d131534-f4d5-4d26-8f05-02c500d6e04d_长城结构(修正).dwg"
EXE = r"tools\CADReader\CADReader.exe"
OUT = r"tools\_dlg_capture.png"


def find_tip():
    found = []

    @ctypes.WINFUNCTYPE(ctypes.c_bool, wt.HWND, wt.LPARAM)
    def cb(hwnd, _):
        if not u32.IsWindowVisible(hwnd):
            return True
        n = u32.GetWindowTextLengthW(hwnd)
        buf = ctypes.create_unicode_buffer(n + 2)
        u32.GetWindowTextW(hwnd, buf, n + 2)
        if buf.value == "提示":
            found.append(hwnd)
        return True

    u32.EnumWindows(cb, 0)
    return found[0] if found else None


def dump_children(hwnd):
    kids = []

    @ctypes.WINFUNCTYPE(ctypes.c_bool, wt.HWND, wt.LPARAM)
    def cb(child, _):
        kids.append(child)
        return True

    u32.EnumChildWindows(hwnd, cb, 0)
    for k in kids:
        n = u32.GetWindowTextLengthW(k)
        buf = ctypes.create_unicode_buffer(n + 2)
        u32.GetWindowTextW(k, buf, n + 2)
        cbuf = ctypes.create_unicode_buffer(256)
        u32.GetClassNameW(k, cbuf, 256)
        r = wt.RECT()
        u32.GetWindowRect(k, ctypes.byref(r))
        print(f"  child hwnd={k:#x} cls={cbuf.value!r} text={buf.value!r} rect=({r.left},{r.top},{r.right},{r.bottom})", flush=True)


def capture(hwnd, path):
    r = wt.RECT()
    u32.GetWindowRect(hwnd, ctypes.byref(r))
    w, h = r.right - r.left, r.bottom - r.top
    hdc_screen = u32.GetDC(0)
    hdc_mem = g32.CreateCompatibleDC(hdc_screen)
    bmp = g32.CreateCompatibleBitmap(hdc_screen, w, h)
    g32.SelectObject(hdc_mem, bmp)
    # PW_RENDERFULLCONTENT = 2：对分层/自绘窗口也能拿到内容
    ok = u32.PrintWindow(hwnd, hdc_mem, 2)
    print("PrintWindow:", bool(ok), flush=True)
    bmi = ctypes.create_string_buffer(40)
    struct.pack_into("<iiiHHiiiiii", bmi, 0, 40, w, -h, 1, 32, 0, 0, 0, 0, 0)
    row = w * 4
    raw = ctypes.create_string_buffer(row * h)
    g32.GetDIBits(hdc_mem, bmp, 0, h, raw, bmi, 0)
    px = bytearray(w * h * 3)
    for y in range(h):
        src = y * row
        dst = y * w * 3
        for x in range(w):
            b, g, rr = raw[src + x * 4], raw[src + x * 4 + 1], raw[src + x * 4 + 2]
            px[dst + x * 3], px[dst + x * 3 + 1], px[dst + x * 3 + 2] = rr, g, b
    def chunk(tag, data):
        c = tag + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c))
    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
    rows = b"".join(b"\x00" + bytes(px[y * w * 3:(y + 1) * w * 3]) for y in range(h))
    png += chunk(b"IDAT", zlib.compress(rows))
    png += chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(png)
    g32.DeleteObject(bmp)
    g32.DeleteDC(hdc_mem)
    u32.ReleaseDC(0, hdc_screen)
    print("saved:", path, f"{w}x{h}", flush=True)


def main():
    subprocess.run(["taskkill", "/F", "/IM", "CADReader.exe"],
                   capture_output=True, creationflags=subprocess.CREATE_NO_WINDOW)
    time.sleep(0.6)
    si = subprocess.STARTUPINFO()
    si.dwFlags |= subprocess.STARTF_USESHOWWINDOW
    si.wShowWindow = 0  # SW_HIDE
    proc = subprocess.Popen([os.path.abspath(EXE), os.path.abspath(DWG)], startupinfo=si)
    print("launched pid:", proc.pid, flush=True)
    tip = None
    t0 = time.time()
    while time.time() - t0 < 25:
        tip = find_tip()
        if tip:
            print(f"tip found at t={time.time()-t0:.2f}s hwnd={tip:#x}", flush=True)
            break
        if proc.poll() is not None:
            print("proc exited early, keep watching...", flush=True)
        time.sleep(0.15)
    if tip:
        time.sleep(0.8)  # 等它画完
        dump_children(tip)
        capture(tip, OUT)
    else:
        print("no tip window in 25s", flush=True)
    # 顺便看主窗口是否出现
    @ctypes.WINFUNCTYPE(ctypes.c_bool, wt.HWND, wt.LPARAM)
    def cb2(hwnd, _):
        n = u32.GetWindowTextLengthW(hwnd)
        buf = ctypes.create_unicode_buffer(n + 2)
        u32.GetWindowTextW(hwnd, buf, n + 2)
        if "CAD快速看图" in buf.value:
            r = wt.RECT()
            u32.GetWindowRect(hwnd, ctypes.byref(r))
            print(f"MAIN hwnd={hwnd:#x} vis={u32.IsWindowVisible(hwnd)} title={buf.value!r} rect=({r.left},{r.top},{r.right},{r.bottom})", flush=True)
        return True
    u32.EnumWindows(cb2, 0)
    return 0


if __name__ == "__main__":
    sys.exit(main())
