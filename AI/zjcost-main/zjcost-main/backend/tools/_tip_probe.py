# -*- coding: utf-8 -*-
"""探针：启动 CADReader，等到 320x90 无标题提示窗后 dump 其子控件并截取该区域。"""
import ctypes
import ctypes.wintypes as wt
import os
import subprocess
import sys
import time

u32 = ctypes.windll.user32
k32 = ctypes.windll.kernel32
gdi32 = ctypes.windll.gdi32
PROCESS_QUERY_LIMITED_INFORMATION = 0x1000

EXE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "CADReader", "CADReader.exe")
DWG = sys.argv[1]


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


def find_tip():
    hits = []

    @ctypes.WINFUNCTYPE(ctypes.c_bool, wt.HWND, wt.LPARAM)
    def cb(hwnd, _):
        if not u32.IsWindowVisible(hwnd):
            return True
        pid = wt.DWORD()
        u32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
        if process_name(pid.value) != "cadreader.exe":
            return True
        t, c, rc = text(hwnd), cls(hwnd), rect(hwnd)
        # 提示窗：无标题 QWidget 小窗（排除主窗口/闪屏）
        if not t and c == "QWidget" and rc[2] <= 900 and rc[3] <= 600 and not (rc[2] == 200 and rc[3] == 200):
            hits.append(hwnd)
        return True

    u32.EnumWindows(cb, 0)
    return hits


def main():
    proc = subprocess.Popen([EXE, DWG])
    tip = None
    t0 = time.time()
    while time.time() - t0 < 25:
        hits = find_tip()
        if hits:
            tip = hits[0]
            break
        time.sleep(0.05)
    if not tip:
        print("NO_TIP_FOUND")
    else:
        print(f"TIP hwnd={tip:#x} rect={rect(tip)} cls={cls(tip)!r} title={text(tip)!r}")
        kids = []

        @ctypes.WINFUNCTYPE(ctypes.c_bool, wt.HWND, wt.LPARAM)
        def kcb(child, _):
            kids.append(child)
            return True

        u32.EnumChildWindows(tip, kcb, 0)
        for k in kids:
            print(f"  CHILD hwnd={k:#x} cls={cls(k)!r} title={text(k)!r} rect={rect(k)}")
        # 截取提示窗区域
        try:
            l, t, w, h = rect(tip)
            pad = 20
            x, y, cw, ch = l - pad, t - pad, w + 2 * pad, h + 2 * pad
            sdc = u32.GetDC(0)
            mdc = gdi32.CreateCompatibleDC(sdc)
            bmp = gdi32.CreateCompatibleBitmap(sdc, cw, ch)
            gdi32.SelectObject(mdc, bmp)
            gdi32.BitBlt(mdc, 0, 0, cw, ch, sdc, x, y, 0x00CC0020)
            import struct
            class BITMAPINFOHEADER(ctypes.Structure):
                _fields_ = [("biSize", wt.DWORD), ("biWidth", ctypes.c_long), ("biHeight", ctypes.c_long),
                            ("biPlanes", wt.WORD), ("biBitCount", wt.WORD), ("biCompression", wt.DWORD),
                            ("biSizeImage", wt.DWORD), ("biXPelsPerMeter", ctypes.c_long),
                            ("biYPelsPerMeter", ctypes.c_long), ("biClrUsed", wt.DWORD), ("biClrImportant", wt.DWORD)]
            bih = BITMAPINFOHEADER()
            bih.biSize = ctypes.sizeof(BITMAPINFOHEADER)
            bih.biWidth = cw
            bih.biHeight = -ch
            bih.biPlanes = 1
            bih.biBitCount = 24
            bih.biCompression = 0
            row = (cw * 3 + 3) & ~3
            px = ctypes.create_string_buffer(row * ch)
            gdi32.GetDIBits(mdc, bmp, 0, ch, px, ctypes.byref(bih), 0)
            def chunk(tag, data):
                import zlib
                return (struct.pack(">I", len(data)) + tag + data
                        + struct.pack(">I", zlib.crc32(tag + data) & 0xffffffff))
            import zlib
            png_rows = bytearray()
            for i in range(ch):
                src = px[i * row: i * row + cw * 3]
                line = bytearray()
                line.append(0)
                for j in range(0, cw * 3, 3):
                    b, g, r = src[j], src[j + 1], src[j + 2]
                    line += bytes((r, g, b))
                png_rows += line
            png = (b"\x89PNG\r\n\x1a\n"
                   + chunk(b"IHDR", struct.pack(">IIBBBBB", cw, ch, 8, 2, 0, 0, 0))
                   + chunk(b"IDAT", zlib.compress(bytes(png_rows), 6))
                   + chunk(b"IEND", b""))
            out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_tip_capture.png")
            with open(out, "wb") as f:
                f.write(png)
            print("SAVED", out)
        except Exception as exc:
            print("capture failed:", exc)
        # 尝试 WM_CLOSE 永久关闭
        u32.PostMessageW(tip, 0x0010, 0, 0)
        time.sleep(1.0)
        alive = bool(u32.IsWindow(tip))
        print("after WM_CLOSE alive =", alive)
    try:
        subprocess.run(["taskkill", "/F", "/PID", str(proc.pid)],
                       capture_output=True, creationflags=subprocess.CREATE_NO_WINDOW)
    except Exception:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
