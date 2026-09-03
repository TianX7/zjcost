# -*- coding: utf-8 -*-
"""内置图纸查看器：调起 CAD 快速看图并只露出看图区（纯 ctypes，零外部依赖）。

两种模式：

1. 独立窗口：python cad_viewer.py <图纸路径>
   创建"图纸查看器"独立窗口，看图区铺满，CAD 快速看图不出现在任务栏。

2. 网页嵌入：python cad_viewer.py --embed <坐标文件> <图纸路径>
   创建无边框置顶窗口（无任务栏条目），精确贴合网页里图纸预览区的
   屏幕位置。前端持续把预览区坐标写入坐标文件，本进程轮询并跟随：
   浏览器移动/缩放/滚动/收起面板时窗口实时对齐，看起来就是网页的
   一部分。坐标文件被删除（用户切换回内置渲染）即退出。
"""
import ctypes
import ctypes.wintypes as wt
import json
import os
import subprocess
import sys
import threading
import time
from pathlib import Path

u32 = ctypes.windll.user32
k32 = ctypes.windll.kernel32

u32.GetParent.restype = wt.HWND
u32.GetParent.argtypes = [wt.HWND]
# 64 位指针宽度签名：WPARAM/LPARAM 是指针大小，声明错会回调溢出
u32.DefWindowProcW.restype = ctypes.c_ssize_t
u32.DefWindowProcW.argtypes = [wt.HWND, wt.UINT, ctypes.c_size_t, ctypes.c_ssize_t]
u32.SetWindowLongW.restype = ctypes.c_ssize_t
u32.SetWindowLongW.argtypes = [wt.HWND, ctypes.c_int, ctypes.c_ssize_t]
u32.GetWindowLongW.restype = ctypes.c_ssize_t
u32.GetWindowLongW.argtypes = [wt.HWND, ctypes.c_int]

u32.SetProcessDPIAware()

WS_OVERLAPPEDWINDOW = 0x00CF0000
WS_VISIBLE = 0x10000000
WS_CHILD = 0x40000000
WS_POPUP = 0x80000000
GWL_STYLE = -16
GWL_EXSTYLE = -20
WS_EX_TOPMOST = 0x00000008
WS_EX_TOOLWINDOW = 0x00000080
WS_EX_APPWINDOW = 0x00040000
WS_EX_LAYERED = 0x00080000
LWA_ALPHA = 0x02
WM_CLOSE = 0x0010
WM_DESTROY = 0x0002
SW_HIDE = 0
SW_SHOWNA = 8  # 显示但不抢焦点（网页保持前台）

CAD_EXE_CANDIDATES = [
    # 项目内置的 CAD 快速看图（随项目分发，部署零依赖）
    str(Path(__file__).resolve().parent / "CADReader" / "CADReader.exe"),
    # 本机安装的 CAD 快速看图
    r"D:\CADReader\CADReader.exe",
    r"C:\Program Files\CADReader\CADReader.exe",
    r"C:\Program Files (x86)\CADReader\CADReader.exe",
]
LOAD_TIMEOUT = 180  # 大图加载最长等待秒数


def find_cad_exe() -> str:
    for exe in CAD_EXE_CANDIDATES:
        if os.path.isfile(exe):
            return exe
    return ""


def _exe_file_version(path: str) -> str:
    """读 exe 文件版本：CAD 的多个"首次提示"按版本号触发（版本变了就再弹一次），
    预置为当前 exe 版本后永不再弹。"""
    try:
        ver_dll = ctypes.windll.version
        size = ver_dll.GetFileVersionInfoSizeW(path, None)
        if not size:
            return ""
        buf = ctypes.create_string_buffer(size)
        if not ver_dll.GetFileVersionInfoW(path, 0, size, buf):
            return ""
        ptr = ctypes.c_void_p()
        plen = wt.UINT()
        if not ver_dll.VerQueryValueW(buf, "\\", ctypes.byref(ptr), ctypes.byref(plen)):
            return ""
        ms = ctypes.c_uint32.from_address(ptr.value + 8).value
        ls = ctypes.c_uint32.from_address(ptr.value + 12).value
        return f"{ms >> 16}.{ms & 0xFFFF}.{ls >> 16}.{ls & 0xFFFF}"
    except Exception:
        return ""


def preseed_cad_config() -> None:
    """启动前写 CAD 快速看图注册表配置，关掉各类首次提示/消息弹窗。

    实测（6.5.3.105）：右上角 320x90 的"显示异常→切换显示模式"黄色提示由
    Graphic\\Switch_Prompted_Version 与 exe 版本不一致触发。该提示是自绘 Qt 窗口，
    不响应 WM_CLOSE，SW_HIDE 也只是暂时压住，只能从配置根治。提示浮在嵌入看图区
    上方，且弹出瞬间会抢前台导致看图窗显隐抖动。
    """
    try:
        import winreg
    except Exception:
        return

    def _set(subkey: str, name: str, value, vtype=None) -> None:
        try:
            key = winreg.CreateKey(
                winreg.HKEY_CURRENT_USER, "Software\\GrandSoft\\CADReader\\" + subkey
            )
            try:
                winreg.SetValueEx(key, name, 0, vtype or winreg.REG_SZ, value)
            finally:
                winreg.CloseKey(key)
        except Exception:
            pass

    ver = _exe_file_version(find_cad_exe())
    if ver:
        _set("Graphic", "Switch_Prompted_Version", ver)      # 显示模式切换提示（320x90 黄条）
        _set("Prompt", "UpdateIntroductionShowVersion", ver)  # 新版本功能介绍
        _set("Prompt", "CommentPromptViewShownVersion", ver)  # 评论引导提示
    _set("Prompt", "CommentPromptViewShown", "true")
    _set("Remind", "NoRemind", "true")                        # 常规提醒总开关
    # 消息弹窗进程 MsgPoper.exe（广告/优惠券）：今日弹窗配额置 0
    _set("MsgPoperPara", "Date", time.strftime("%Y-%m-%d"))
    _set("MsgPoperPara", "AvaTimes", 0, winreg.REG_DWORD)


def find_main_window(pid: int | None = None):
    """找 CAD 快速看图主窗口：优先按 pid 匹配（标题含 "CAD快速看图"）；
    找不到则全局按标题找——exe 可能因注册表重定向把工作交给已安装的
    另一份副本（pid 变了），按 pid 找会扑空。"""
    by_pid = []
    by_title = []

    @ctypes.WINFUNCTYPE(ctypes.c_bool, wt.HWND, wt.LPARAM)
    def cb(hwnd, _):
        if not u32.IsWindowVisible(hwnd):
            return True
        n = u32.GetWindowTextLengthW(hwnd)
        buf = ctypes.create_unicode_buffer(n + 2)
        u32.GetWindowTextW(hwnd, buf, n + 2)
        text = buf.value
        if "CAD快速看图" not in text:
            return True
        by_title.append(hwnd)
        if pid is not None:
            wpid = wt.DWORD()
            u32.GetWindowThreadProcessId(hwnd, ctypes.byref(wpid))
            if wpid.value == pid:
                by_pid.append(hwnd)
        return True

    u32.EnumWindows(cb, 0)
    if by_pid:
        return by_pid[0]
    return by_title[0] if by_title else None


def window_pid(hwnd: int) -> int:
    wpid = wt.DWORD()
    u32.GetWindowThreadProcessId(hwnd, ctypes.byref(wpid))
    return wpid.value


def child_windows(hwnd: int):
    out = []

    @ctypes.WINFUNCTYPE(ctypes.c_bool, wt.HWND, wt.LPARAM)
    def cb(child, _):
        out.append(child)
        return True

    u32.EnumChildWindows(hwnd, cb, 0)
    return out


def class_name(hwnd: int) -> str:
    buf = ctypes.create_unicode_buffer(256)
    u32.GetClassNameW(hwnd, buf, 256)
    return buf.value


def window_text(hwnd: int) -> str:
    n = u32.GetWindowTextLengthW(hwnd)
    buf = ctypes.create_unicode_buffer(n + 2)
    u32.GetWindowTextW(hwnd, buf, n + 2)
    return buf.value


def window_rect(hwnd: int):
    r = wt.RECT()
    u32.GetWindowRect(hwnd, ctypes.byref(r))
    return r.left, r.top, r.right, r.bottom


def hide_chrome(main_hwnd: int, pid: int) -> None:
    """隐藏界面元素：云广告条/工具栏/文档标签/状态栏/背景件 + 顶层浮动广告窗。"""
    hide_names = {"KKCloudPanel", "qt_tabwidget_tabbar", "statusBar", "GBackgroundWidget"}

    @ctypes.WINFUNCTYPE(ctypes.c_bool, wt.HWND, wt.LPARAM)
    def top_cb(hwnd, _):
        wpid = wt.DWORD()
        u32.GetWindowThreadProcessId(hwnd, ctypes.byref(wpid))
        if wpid.value == pid and u32.IsWindowVisible(hwnd):
            r = wt.RECT()
            u32.GetWindowRect(hwnd, ctypes.byref(r))
            w, h = r.right - r.left, r.bottom - r.top
            # 面积很小的无标题顶层窗（广告/浮层）隐藏
            if w * h < 200 * 200 and not window_text(hwnd):
                u32.ShowWindow(hwnd, SW_HIDE)
        return True

    u32.EnumWindows(top_cb, 0)

    for child in child_windows(main_hwnd):
        if window_text(child) in hide_names:
            u32.ShowWindow(child, SW_HIDE)


def wait_view(main_hwnd: int, deadline: float, rehide=None):
    """等看图区（QGLWidget）出现且尺寸稳定。

    rehide：每 40ms 调用（CAD 初始化会反复把主窗口移回屏幕全屏，
    间隔过长屏幕上会闪现零点几秒；0.4s 一次的 QGLWidget 稳定性判定
    不足以压制，因此重定位与判定分开节拍）。
    """
    last = None
    stable = 0
    next_check = 0.0
    while time.time() < deadline:
        if rehide:
            rehide()
        now = time.time()
        if now >= next_check:
            next_check = now + 0.4
            for child in child_windows(main_hwnd):
                if class_name(child) == "QGLWidget":
                    l, t, r, b = window_rect(child)
                    size = (r - l, b - t)
                    if size == last and size[0] > 100:
                        stable += 1
                        if stable >= 2:
                            return child
                    else:
                        stable = 0
                    last = size
                    break
        time.sleep(0.04)
    return None


def strip_taskbar(hwnd: int) -> None:
    """去掉窗口的任务栏按钮：加 WS_EX_TOOLWINDOW、去 WS_EX_APPWINDOW。

    任务栏按钮的显示由扩展样式决定（tool window 不占任务栏条目）。
    CAD 主窗口在冷启动顶层阶段、以及解挂回顶层驻留期间都是独立顶层窗，
    会重新冒出任务栏图标，调用本函数可从源头消除。
    """
    try:
        ex = u32.GetWindowLongW(hwnd, GWL_EXSTYLE)
        new_ex = (ex | WS_EX_TOOLWINDOW) & ~WS_EX_APPWINDOW
        if new_ex != ex:
            u32.SetWindowLongW(hwnd, GWL_EXSTYLE, new_ex)
    except Exception:
        pass


def attach(host: int, main_hwnd: int) -> None:
    """CAD 主窗口子窗口化并挂到宿主：去标题栏，任务栏条目消失。"""
    strip_taskbar(main_hwnd)
    u32.SetWindowRgn(main_hwnd, 0, False)  # 清掉停靠期间的 1x1 裁剪区域
    if u32.IsZoomed(main_hwnd):
        # 最大化窗口挂成子窗后尺寸锁死且 MoveWindow 无效，先还原
        u32.ShowWindow(main_hwnd, 9)  # SW_RESTORE
    # 移除驻留期的全透明样式，恢复看图区正常渲染
    ex = u32.GetWindowLongW(main_hwnd, GWL_EXSTYLE)
    u32.SetWindowLongW(main_hwnd, GWL_EXSTYLE, ex & ~WS_EX_LAYERED)
    style = u32.GetWindowLongW(main_hwnd, GWL_STYLE)
    # WS_POPUP 一并清掉：否则 GetParent 语义仍按属主窗返回，子窗判定失效
    u32.SetWindowLongW(main_hwnd, GWL_STYLE,
                       (style & ~(WS_OVERLAPPEDWINDOW | WS_POPUP))
                       | WS_CHILD | WS_VISIBLE)
    u32.SetParent(main_hwnd, host)


def make_park_invisible(hwnd: int) -> None:
    """驻留期给 CAD 主窗加 WS_EX_LAYERED + alpha=0：视觉完全隐身。

    实测跨进程设置立即生效、CAD 单实例交接后仍保持（交接会把驻留主窗
    重新 ShowWindow/最大化到屏上约 185ms，跨线程 SW_HIDE 被 CAD 忙线程
    阻塞压不住）；OpenGL 渲染不受影响，attach() 时移除样式即恢复显示。
    """
    try:
        ex = u32.GetWindowLongW(hwnd, GWL_EXSTYLE)
        if not ex & WS_EX_LAYERED:
            u32.SetWindowLongW(hwnd, GWL_EXSTYLE, ex | WS_EX_LAYERED)
        u32.SetLayeredWindowAttributes(hwnd, 0, 0, LWA_ALPHA)
    except Exception:
        pass


def align_view(host: int, main_hwnd: int) -> None:
    """反向偏移对齐：移动 CAD 主窗口使 QGLWidget 恰好铺满宿主客户区，
    工具栏/文档标签/状态栏被裁剪到宿主窗口外。Qt 重排后再次调用可自愈。"""
    view = None
    for child in child_windows(main_hwnd):
        if class_name(child) == "QGLWidget":
            view = child
            break
    if not view:
        return
    ml, mt, mr, mb = window_rect(main_hwnd)
    vl, vt, vr, vb = window_rect(view)
    off_x, off_y = vl - ml, vt - mt
    view_w, view_h = vr - vl, vb - vt
    if view_w <= 100 or view_h <= 100:
        return
    main_w, main_h = mr - ml, mb - mt
    right_pad = main_w - off_x - view_w
    bottom_pad = main_h - off_y - view_h
    hr = wt.RECT()
    u32.GetClientRect(host, ctypes.byref(hr))
    cw, ch = hr.right, hr.bottom
    target_w = cw + off_x + max(right_pad, 0)
    target_h = ch + off_y + max(bottom_pad, 0)
    if abs(off_x) > 4000 or abs(off_y) > 4000:
        return  # 异常坐标防护
    u32.MoveWindow(main_hwnd, -off_x, -off_y, target_w, target_h, False)


def make_window_class():
    @ctypes.WINFUNCTYPE(ctypes.c_ssize_t, wt.HWND, wt.UINT, ctypes.c_size_t, ctypes.c_ssize_t)
    def wndproc(hwnd, msg, wparam, lparam):
        if msg == WM_CLOSE:
            u32.DestroyWindow(hwnd)
            return 0
        if msg == WM_DESTROY:
            u32.PostQuitMessage(0)
            return 0
        return u32.DefWindowProcW(hwnd, msg, wparam, lparam)

    class WNDCLASSEXW(ctypes.Structure):
        _fields_ = [
            ("cbSize", wt.UINT), ("style", wt.UINT), ("lpfnWndProc", ctypes.c_void_p),
            ("cbClsExtra", ctypes.c_int), ("cbWndExtra", ctypes.c_int),
            ("hInstance", wt.HINSTANCE), ("hIcon", wt.HICON), ("hCursor", ctypes.c_void_p),
            ("hbrBackground", ctypes.c_void_p), ("lpszMenuName", wt.LPCWSTR),
            ("lpszClassName", wt.LPCWSTR), ("hIconSm", wt.HICON),
        ]

    gdi32 = ctypes.windll.gdi32
    hinst = k32.GetModuleHandleW(None)
    cls = WNDCLASSEXW()
    cls.cbSize = ctypes.sizeof(WNDCLASSEXW)
    cls.lpfnWndProc = ctypes.cast(wndproc, ctypes.c_void_p)
    cls.hInstance = hinst
    cls.lpszClassName = "ZjCostCadViewer"
    cls.hbrBackground = ctypes.c_void_p(gdi32.CreateSolidBrush(0x00000000))  # 黑色，与看图区底色一致
    if not u32.RegisterClassExW(ctypes.byref(cls)):
        return None, None
    return hinst, wndproc


def pump_messages() -> None:
    msg = wt.MSG()
    while u32.PeekMessageW(ctypes.byref(msg), 0, 0, 0, 1):
        u32.TranslateMessage(ctypes.byref(msg))
        u32.DispatchMessageW(ctypes.byref(msg))


def kill_existing_cad() -> None:
    """清理已存在的 CAD 快速看图实例，避免接管/干扰本次调起。"""
    try:
        subprocess.run(
            ["taskkill", "/F", "/IM", "CADReader.exe"],
            capture_output=True, creationflags=subprocess.CREATE_NO_WINDOW,
        )
        # 等进程真正退出：单实例互斥量等资源未释放时，新实例会以
        # "僵尸"状态干等（有进程无窗口），整个启动流程卡死
        for _ in range(20):
            chk = subprocess.run(
                ["tasklist", "/FI", "IMAGENAME eq CADReader.exe"],
                capture_output=True, creationflags=subprocess.CREATE_NO_WINDOW,
            )
            if b"CADReader.exe" not in chk.stdout:
                break
            time.sleep(0.15)
    except Exception:
        pass


PROCESS_QUERY_LIMITED_INFORMATION = 0x1000


def write_state(state_file, state: str, **fields) -> None:
    """把查看器启动/退出状态写进状态文件，后端据此判断是否可嵌入。"""
    if not state_file:
        return
    try:
        payload = {"state": state}
        payload.update(fields)
        Path(state_file).write_text(
            json.dumps(payload, ensure_ascii=False), encoding="utf-8"
        )
    except Exception:
        pass


def process_name(pid: int) -> str:
    """按 PID 取可执行文件名（低权限查询，失败返回空串）。"""
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


# CAD 的广告/消息弹窗由独立进程 MsgPoper.exe 弹出，一并纳入压制范围
CAD_FAMILY_PROCESSES = {"cadreader.exe", "msgpoper.exe"}


def is_cad_process(pid: int) -> bool:
    return process_name(pid) in CAD_FAMILY_PROCESSES


def maybe_cad_window(hwnd: int) -> bool:
    """低成本粗筛：CAD 快速看图是 Qt 应用，顶层窗类名恒为 QWidget 系。
    先查类名/标题（纯内存调用），通过后才值得 OpenProcess 查进程名——
    对系统每个可见窗口都查进程名每次枚举要上百毫秒，直接决定了
    冷启动全屏闪现的时长；粗筛后一轮枚举降到几毫秒。"""
    t = window_text(hwnd)
    if "CAD快速看图" in t or t == "CADReader":
        return True
    cls = class_name(hwnd)
    return cls.startswith("Q") and not cls.startswith("QEventDispatcher")


def _owned_by_cad_window(hwnd: int, pid: int) -> bool:
    """判断窗口是否从属于某 CAD 顶层窗（owner 链/父链），
    用于压掉无标题小窗——首次启动提示条常挂在主窗以外的
    某个顶层窗下，仅看 GetParent 会漏。"""
    root = u32.GetAncestor(hwnd, 2)  # GA_ROOTOWNER
    if not root:
        return False
    wpid = wt.DWORD()
    u32.GetWindowThreadProcessId(root, ctypes.byref(wpid))
    return wpid.value == pid


def suppress_popups(pid: int | None = None, main_hwnd: int | None = None) -> None:
    """隐藏调起/使用过程中弹出的首次提示、自检、广告等小窗。

    除了标题为 CADReader 的窗口外，也清理无标题的 QWidget 小窗：
    CAD 首次打开常显示一个空标题的自绘提示条，若不隐藏会一直浮在图上。
    """

    @ctypes.WINFUNCTYPE(ctypes.c_bool, wt.HWND, wt.LPARAM)
    def cb(hwnd, _):
        if not u32.IsWindowVisible(hwnd):
            return True
        if pid is None and not maybe_cad_window(hwnd):
            return True  # 粗筛不过直接跳过，不做进程名慢查询
        wpid = wt.DWORD()
        u32.GetWindowThreadProcessId(hwnd, ctypes.byref(wpid))
        if pid is not None and wpid.value != pid:
            return True
        if pid is None and not is_cad_process(wpid.value):
            return True
        if hwnd == main_hwnd:
            return True
        cls = class_name(hwnd)
        if cls.startswith("Microsoft.IME") or cls.startswith("MSCTFIME") or cls == "NativeHWNDHost" or cls.startswith("QEventDispatcher"):
            return True
        text = window_text(hwnd)
        r = wt.RECT()
        u32.GetWindowRect(hwnd, ctypes.byref(r))
        w, h = r.right - r.left, r.bottom - r.top
        parent_hwnd = u32.GetParent(hwnd)
        # 主窗口本身有“CAD快速看图”标题且尺寸大，不会被误杀；
        # 首次提示条/自检弹窗通常是无标题顶层小窗；同时压掉主窗里
        # 已显示但尚未被隐藏的子提示条，避免冷启动后残留 320x90 提示。
        if text == "CADReader":
            u32.ShowWindow(hwnd, SW_HIDE)
        elif not text and cls == "QWidget" and w <= 900 and h <= 600 and (
            not parent_hwnd
            or parent_hwnd == main_hwnd
            or _owned_by_cad_window(hwnd, wpid.value)
        ):
            u32.ShowWindow(hwnd, SW_HIDE)
        return True

    u32.EnumWindows(cb, 0)


def park_all_cad_windows(pos: tuple[int, int], host: int | None = None) -> None:
    """把所有可见的 CADReader 顶层窗挪到虚拟屏幕外（覆盖重定向/多进程场景）。"""

    @ctypes.WINFUNCTYPE(ctypes.c_bool, wt.HWND, wt.LPARAM)
    def cb(hwnd, _):
        if not u32.IsWindowVisible(hwnd) or not maybe_cad_window(hwnd):
            return True
        wpid = wt.DWORD()
        u32.GetWindowThreadProcessId(hwnd, ctypes.byref(wpid))
        if is_cad_process(wpid.value):
            if host and u32.GetParent(hwnd) == host:
                return True  # 已挂到宿主上的看图区不再挪走
            strip_taskbar(hwnd)
            _park_offscreen(hwnd, pos)
        return True

    u32.EnumWindows(cb, 0)


def _virtual_offscreen_xy() -> tuple[int, int]:
    """虚拟屏幕左边界外一点：窗口保持"可见"（OpenGL 正常初始化，
    避免隐藏窗口初始化 GL 触发"显示异常"提示），但用户完全看不到。"""
    vx = u32.GetSystemMetrics(76)   # SM_XVIRTUALSCREEN（多显示器负坐标安全）
    vw = u32.GetSystemMetrics(78)   # SM_CXVIRTUALSCREEN
    return vx - vw - 300, 0


def _park_offscreen(hwnd: int, pos: tuple[int, int] | None) -> None:
    """把窗口挪到屏幕外（保留可见状态与原尺寸）。

    最大化窗口实测可直接 SetWindowPos 挪走（约 1ms），不要先 SW_RESTORE
    （同步跨线程调用，CAD 冷启动忙时被阻塞上百毫秒=全屏闪现的主因），
    也不要用 SetWindowRgn 裁剪（实测同样被目标线程阻塞 160ms+），
    更不要给 CAD 发还原命令（创建中/隐藏的窗口收到 SC_RESTORE 会让
    Qt 在初始化阶段崩溃退出）。最大化标记由 attach() 挂接前兜底还原。
    """
    if not pos:
        return
    vx = u32.GetSystemMetrics(76)
    r = wt.RECT()
    u32.GetWindowRect(hwnd, ctypes.byref(r))
    if r.right <= vx:
        return  # 已在屏幕外，高频轮询时直接跳过
    w, h = r.right - r.left, r.bottom - r.top
    if w <= 0 or h <= 0:
        return
    u32.SetWindowPos(hwnd, 0, pos[0], pos[1], w, h, 0x0014)  # SWP_NOACTIVATE|SWP_NOZORDER


def _run_suppress_watcher(pid: int | None, pos: tuple[int, int], host: int | None, stop: list[int]) -> None:
    """高频压窗线程：CAD 冷启动期间毫秒级把任何可见顶层窗挪出屏幕，
    并持续隐藏首次提示等小窗。主线程等待 QGLWidget + attach 时，
    轮询停靠承担全部压制（实测单次挪窗约 1ms、轮询一圈 ~10ms 内，
    足以压住冷启动闪现；WinEvent 全局钩子在 CAD 初始化的事件洪泛下
    反而拖慢本线程的消息泵，不再使用）。"""
    last_suppress = 0.0
    while not stop[0]:
        # 停靠必须每圈都跑（它决定冷启动闪现时长）；弹窗压制是全桌面
        # 枚举、单圈几十毫秒，降频到 50ms 一次，别堵住停靠的节奏
        park_all_cad_windows(pos, host)
        now = time.time()
        if now - last_suppress >= 0.05:
            suppress_popups(None)
            last_suppress = now
        time.sleep(0.005)


def wait_cad_ready(proc, deadline: float, keep_hidden: bool = False, watcher=None):
    """等 CAD 主窗口与看图区就绪，返回 (main_hwnd)。

    keep_hidden（网页嵌入用）：发现主窗口立即挪到虚拟屏幕外并持续压制
    弹窗/回移，冷启动全程用户看不到原始窗口。移动到屏幕外而非 SW_HIDE，
    是为了避免隐藏状态下初始化 OpenGL 触发"显示异常"提示。
    exe 可能注册表重定向到已安装副本（原 proc 直接退出），
    故按窗口标题找主窗口（含隐藏窗——找到后我们会主动挪走它），
    用其真实 pid 后续判活。
    watcher：调用方启动的高频压窗线程 stop 标记。
    """
    offscreen = _virtual_offscreen_xy() if keep_hidden else None
    if offscreen:
        park_all_cad_windows(offscreen)
    main_hwnd = None
    t_start = time.time()
    while time.time() < deadline:
        pump_messages()
        if main_hwnd is None:
            # 冷启动前已 kill_existing_cad 清场，此后出现的即本次实例。
            # 跳过 160x28 之类的启动残根窗（文件缺失/单实例交接时出现），
            # 只认尺寸正常的真正主窗口
            for cand in find_any_cad_window():
                r = wt.RECT()
                u32.GetWindowRect(cand, ctypes.byref(r))
                if r.right - r.left >= 400 and r.bottom - r.top >= 250:
                    main_hwnd = cand
                    break
            if main_hwnd is None and time.time() - t_start > 6.0:
                # 6 秒仍无正常主窗：单实例交接卡死/启动失败等异常状态，
                # 干等 180 秒只会让前端超时报错，尽快失败让调用方重试
                return None
        if main_hwnd is not None:
            pid_now = window_pid(main_hwnd)
            strip_taskbar(main_hwnd)

            def _rehide():
                if offscreen:
                    park_all_cad_windows(offscreen, None)
                elif u32.IsWindowVisible(main_hwnd):
                    u32.ShowWindow(main_hwnd, SW_HIDE)
                suppress_popups(None, main_hwnd)

            _rehide()
            if wait_view(main_hwnd, min(deadline, time.time() + 20.0),
                         rehide=_rehide if keep_hidden else None):
                hide_chrome(main_hwnd, pid_now)
                suppress_popups(None, main_hwnd)
                return main_hwnd
            return None
        if proc is not None and proc.poll() is not None and not find_any_cad_window():
            return None  # 启动进程退出且无任何看图窗口（启动失败）
        time.sleep(0.01)
    return None


def detach_and_park(main_hwnd: int) -> None:
    """解除宿主挂接并把 CAD 主窗口隐藏驻留（不杀进程，下次切换秒级复用）。

    顺序关键：先藏宿主（自有窗口立即生效），再把仍为子窗的主窗挪到屏外
    并恢复顶层 —— 解挂瞬间窗口带可见样式回到顶层，若还停在网页预览区
    位置，跨线程 SW_HIDE 被 CAD 忙线程阻塞上百毫秒就会闪现。
    """
    try:
        host = u32.GetAncestor(main_hwnd, 1)  # GA_PARENT
        if host and host != u32.GetDesktopWindow():
            u32.ShowWindow(host, SW_HIDE)
        # 子窗坐标是宿主客户区坐标，解挂后被重新解释为屏幕坐标，先挪出屏幕
        u32.SetWindowPos(main_hwnd, 0, -30000, -30000, 0, 0,
                         0x0015)  # NOSIZE|NOZORDER|NOACTIVATE
        u32.SetParent(main_hwnd, 0)
        style = u32.GetWindowLongW(main_hwnd, GWL_STYLE)
        u32.SetWindowLongW(main_hwnd, GWL_STYLE,
                           (style & ~(WS_CHILD | WS_VISIBLE))
                           | WS_POPUP | WS_OVERLAPPEDWINDOW)
        # 解挂回顶层后会重新冒任务栏按钮，从源头去掉
        strip_taskbar(main_hwnd)
        # 全透明 + SW_HIDE 双保险：交接/异常路径把它拉回屏上也不可见
        make_park_invisible(main_hwnd)
        u32.ShowWindow(main_hwnd, SW_HIDE)
    except Exception:
        pass


def find_any_cad_window() -> list[int]:
    """枚举所有标题含 "CAD快速看图" 的顶层窗口（含隐藏的）。

    驻留窗口是隐藏的，find_main_window 只看可见窗口会扑空，
    导致驻留复用永不生效、每次切换都冷启动。
    """
    found = []

    @ctypes.WINFUNCTYPE(ctypes.c_bool, wt.HWND, wt.LPARAM)
    def cb(hwnd, _):
        n = u32.GetWindowTextLengthW(hwnd)
        buf = ctypes.create_unicode_buffer(n + 2)
        u32.GetWindowTextW(hwnd, buf, n + 2)
        if "CAD快速看图" in buf.value:
            found.append(hwnd)
        return True

    u32.EnumWindows(cb, 0)
    return found


def find_detached_cad(timeout: float = 2.0) -> int | None:
    """找驻留（已从宿主解挂、隐藏）的 CAD 主窗口，供切换时秒级复用。

    旧查看器收到坐标文件删除后会先解挂隐藏（约 0.1s），这里短暂等待；
    完全无 CAD 实例时立即返回 None（冷启动不增加延迟）。
    """
    t0 = time.time()
    while True:
        candidates = find_any_cad_window()
        if not candidates:
            return None  # 无任何 CAD 实例，无需等待
        for hwnd in candidates:
            if not u32.IsWindowVisible(hwnd) and not u32.GetParent(hwnd):
                return hwnd
        if time.time() - t0 >= timeout:
            return None  # 旧实例仍挂接/可见，交给调用方重启
        time.sleep(0.1)


def run_embed(rect_file: str, dwg: str) -> int:
    """网页嵌入模式：无边框置顶窗口跟随坐标文件贴合网页预览区。

    快速切换优化：切回内置渲染时不杀 CAD 进程，仅解挂隐藏驻留；
    再次启用时优先复用驻留实例（秒级贴合），驻留实例打开的图纸与当前
    不一致时走单实例文件交接（毫秒级、零闪现），交接失败才冷启动。
    """
    exe = find_cad_exe()
    if not exe:
        print("未找到 CAD 快速看图内核", flush=True)
        return 1
    # CAD 拿到相对路径会弹模态"提示"框并卡死整个启动流程，必须传绝对路径
    dwg = os.path.abspath(dwg)
    if not os.path.isfile(dwg):
        print("图纸文件不存在:", dwg, flush=True)
        return 1

    # 预置注册表配置：关掉"显示异常→切换显示模式"黄条等首次提示，
    # 该提示不响应 WM_CLOSE 且会抢前台导致看图窗显隐抖动，只能从配置根治
    preseed_cad_config()

    state_file = Path(rect_file).with_suffix(".state.json")
    write_state(state_file, "starting")
    main_hwnd = find_detached_cad()
    proc = None
    watcher_thread = None
    watcher_stop = [False]
    # STARTF_USESHOWWINDOW + SW_HIDE：部分应用首窗会尊重该提示，
    # 若 CAD 采纳则首窗从创建起就不可见，配合轮询隐藏实现零闪现
    si = subprocess.STARTUPINFO()
    si.dwFlags |= subprocess.STARTF_USESHOWWINDOW
    si.wShowWindow = SW_HIDE
    offscreen = _virtual_offscreen_xy()

    def start_watcher():
        nonlocal watcher_thread
        if watcher_thread is not None:
            return
        watcher_thread = threading.Thread(
            target=_run_suppress_watcher,
            args=(None, offscreen, None, watcher_stop),
            daemon=True,
            name="cad-park-watcher",
        )
        watcher_thread.start()

    if main_hwnd and window_text(main_hwnd).endswith(Path(dwg).name):
        print("复用驻留 CAD 实例:", hex(main_hwnd), flush=True)
    elif main_hwnd:
        # 驻留实例图纸不匹配：不杀进程，走单实例文件交接——再调起一个进程把
        # 新文件交给驻留实例即退（实测 ~0.3s 切换、同一窗口句柄、不抢前台），
        # 每次上传不同图纸不再冷启动闪现。交接会把目标窗 ShowWindow 并最大化，
        # watcher 高频压回屏外、此循环发现可见立即重新隐藏兜底
        print("驻留实例交接新图纸 ->", Path(dwg).name, flush=True)
        start_watcher()
        # 交接会把驻留主窗重新 ShowWindow/最大化，先确保它全透明
        make_park_invisible(main_hwnd)
        strip_taskbar(main_hwnd)
        park_all_cad_windows(offscreen, None)
        proc = subprocess.Popen([exe, dwg], startupinfo=si)
        deadline = time.time() + 8.0
        while time.time() < deadline:
            pump_messages()
            park_all_cad_windows(offscreen, None)
            if u32.IsWindow(main_hwnd):
                if u32.IsWindowVisible(main_hwnd):
                    u32.ShowWindow(main_hwnd, SW_HIDE)
                if window_text(main_hwnd).endswith(Path(dwg).name):
                    break
            else:
                # 个别情况下交接会重建主窗：按标题找回
                for cand in find_any_cad_window():
                    if window_text(cand).endswith(Path(dwg).name):
                        main_hwnd = cand
                        break
            time.sleep(0.02)
        if not (u32.IsWindow(main_hwnd)
                and window_text(main_hwnd).endswith(Path(dwg).name)):
            # 交接失败（残根窗/单实例交接卡死）：清场后走下方冷启动
            print("交接未完成，清场冷启动", flush=True)
            main_hwnd = None
    if main_hwnd is None:
        kill_existing_cad()
        start_watcher()
        park_all_cad_windows(offscreen)
        proc = subprocess.Popen([exe, dwg], startupinfo=si)
        deadline = time.time() + LOAD_TIMEOUT
        main_hwnd = wait_cad_ready(
            proc, deadline, keep_hidden=True, watcher=watcher_stop,
        )
        if not main_hwnd:
            # 启动偶发残根/交接失败：清场重试一次
            print("首次调起未就绪，重试一次", flush=True)
            kill_existing_cad()
            park_all_cad_windows(offscreen)
            proc = subprocess.Popen([exe, dwg], startupinfo=si)
            deadline = time.time() + LOAD_TIMEOUT
            main_hwnd = wait_cad_ready(
                proc, deadline, keep_hidden=True, watcher=watcher_stop,
            )
        if not main_hwnd:
            write_state(state_file, "failed", message="未等到 CAD 看图窗口")
            print("未等到 CAD 看图窗口", flush=True)
            if proc:
                proc.terminate()
            return 1

    hinst, _ = make_window_class()
    if not hinst:
        write_state(state_file, "failed", message="注册窗口类失败")
        print("注册窗口类失败", flush=True)
        if proc:
            proc.terminate()
        return 1

    # 无边框置顶工具窗（不进任务栏、不抢焦点），初始隐藏等首个坐标
    host = u32.CreateWindowExW(
        WS_EX_TOPMOST | WS_EX_TOOLWINDOW, "ZjCostCadViewer", "",
        WS_POPUP, 0, 0, 10, 10, 0, 0, hinst, 0,
    )
    if not host:
        write_state(state_file, "failed", message="创建窗口失败")
        print("创建窗口失败", flush=True)
        if proc:
            proc.terminate()
        return 1
    attach(host, main_hwnd)
    watcher_stop[0] = True
    if watcher_thread:
        watcher_thread.join(timeout=0.5)
    write_state(state_file, "attached", hwnd=hex(host))
    print("嵌入宿主就绪:", hex(host), flush=True)

    try:
        with open(rect_file, "r", encoding="utf-8") as f:
            init_data = json.load(f)
    except Exception:
        init_data = None
    init_rect = None
    if isinstance(init_data, dict) and init_data.get("visible", True):
        init_rect = (int(init_data.get("x", 0)), int(init_data.get("y", 0)),
                     int(init_data.get("w", 0)), int(init_data.get("h", 0)))
        if init_rect[2] < 80 or init_rect[3] < 80:
            init_rect = None

    shown = False
    last_rect = init_rect
    if last_rect:
        # 先按上传时的预览区坐标摆好宿主，主循环一进去就能立即显示，
        # 不再等前端下一帧坐标（首次打开启动中占位会一闪而过）
        u32.SetWindowPos(host, 0, last_rect[0], last_rect[1],
                         last_rect[2], last_rect[3], 0x0010)
    last_align = 0.0
    last_suppress = 0.0
    hide_streak = 0  # 隐藏防抖：可见性瞬断（焦点切换竞态）不立即藏窗
    cad_pid = window_pid(main_hwnd)
    # 看图区贴合周期：Qt 加载大图时会重排看图区，仅靠坐标变化时对齐会漏掉，
    # 导致看图区错位/闪烁且鼠标点不到图上。周期贴合可自愈任意一次 Qt 重排。
    ALIGN_INTERVAL = 0.35
    # 像素死区：亚像素抖动（<2px）不重定位，抑制宿主窗口来回挪动的闪烁
    REPOS_EPS = 2
    # 坐标流容忍期：前端布局量测瞬时失败/焦点切换会造成短暂停报，
    # 4 秒就隐藏会造成"看图窗↔预览"来回闪；放宽到 15 秒
    STALE_VISIBLE_S = 15.0
    while True:
        pump_messages()
        # 判活看真实看图窗口：重定向场景原 proc 已退出，窗口没了才算结束
        if not u32.IsWindow(main_hwnd):
            break
        if not u32.IsWindow(host):
            break
        try:
            with open(rect_file, "r", encoding="utf-8") as f:
                data = json.load(f)
            age = time.time() - os.path.getmtime(rect_file)
        except FileNotFoundError:
            # 坐标文件被删除 = 前端切回内置渲染：CAD 进程驻留不杀，
            # 解挂隐藏，下次切换秒级复用
            detach_and_park(main_hwnd)
            break
        except Exception:
            data, age = None, 0.0
        if not isinstance(data, dict):
            data = None

        # 首次提示/自检/广告可能在本进程挂接后才弹出，周期性压掉
        if time.time() - last_suppress >= 0.3:
            suppress_popups(None, main_hwnd)
            last_suppress = time.time()

        visible = bool(data and data.get("visible", True)) and age < STALE_VISIBLE_S
        # 用户切到其他软件：页面已失焦且看图窗不是前台窗口 → 跟随隐藏，
        # 避免置顶看图窗一直悬浮在其他软件上方；点击看图窗/CAD 弹窗时
        # 前台仍属于 CAD 进程，不能隐藏（否则拖动看图区会闪回"启动中"占位）
        if visible and data is not None and not data.get("pf", True):
            fg_hwnd = u32.GetForegroundWindow()
            fg_pid = window_pid(fg_hwnd) if fg_hwnd else 0
            if fg_hwnd != host and not is_cad_process(fg_pid):
                visible = False
            else:
                visible = True
        if age > 60.0:
            write_state(state_file, "exited", message="坐标流停止")
            detach_and_park(main_hwnd)
            break  # 坐标长时间未更新（前端已关闭/崩溃），驻留退出
        if visible:
            hide_streak = 0
            if isinstance(data, dict):
                rect = (int(data.get("x", 0)), int(data.get("y", 0)),
                        int(data.get("w", 0)), int(data.get("h", 0)))
            else:
                rect = init_rect
            if rect[2] >= 80 and rect[3] >= 80:
                if last_rect is None or any(
                    abs(a - b) >= REPOS_EPS
                    for a, b in zip(rect, last_rect)
                ):
                    u32.SetWindowPos(host, 0, rect[0], rect[1], rect[2], rect[3],
                                     0x0010)  # SWP_NOACTIVATE
                    last_rect = rect
            now = time.time()
            if now - last_align >= ALIGN_INTERVAL:
                align_view(host, main_hwnd)
                last_align = now
            if not shown:
                u32.ShowWindow(host, SW_SHOWNA)
                u32.UpdateWindow(host)
                shown = True
                # 一次性尝试激活 CAD 内核，使其能响应点击拖拽平移/滚轮缩放；
                # 之后每次重定位都用 NOACTIVATE，不再抢走网页焦点。
                u32.SetActiveWindow(host)
                u32.SetForegroundWindow(host)
                write_state(state_file, "ready", hwnd=hex(main_hwnd))
        else:
            hide_streak += 1
            if shown and hide_streak >= 3:
                # 连续约 0.18s 不可见才隐藏：仅挡住常规坐标上报间隙，
                # 切页/切走时窗口能尽快消失（不再等到 0.5s）
                u32.ShowWindow(host, SW_HIDE)
                shown = False
                hide_streak = 0
        time.sleep(0.06)

    # 销毁宿主窗口，避免网页上残留黑色空窗
    if u32.IsWindow(host):
        u32.DestroyWindow(host)
        pump_messages()
    write_state(state_file, "exited")

    # 收尾：仅当本进程是 CAD 的父进程（全新调起）且未走驻留路径时才结束它；
    # 正常退出路径已在 break 前 detach_and_park，这里只兜底异常退出
    if proc is not None and u32.IsWindow(main_hwnd) and not u32.GetParent(main_hwnd):
        parked = not u32.IsWindowVisible(main_hwnd)
        if not parked:
            try:
                subprocess.run(
                    ["taskkill", "/F", "/PID", str(cad_pid)],
                    capture_output=True, creationflags=subprocess.CREATE_NO_WINDOW,
                )
            except Exception:
                try:
                    proc.terminate()
                except Exception:
                    pass
    return 0


def run_standalone(dwg: str) -> int:
    """独立窗口模式：查看器窗口铺满看图区，居中显示。"""
    exe = find_cad_exe()
    if not exe:
        print("未找到 CAD 快速看图内核", flush=True)
        return 1
    dwg = os.path.abspath(dwg)
    preseed_cad_config()
    kill_existing_cad()
    proc = subprocess.Popen([exe, dwg])
    deadline = time.time() + LOAD_TIMEOUT
    main_hwnd = wait_cad_ready(proc, deadline)
    if not main_hwnd:
        print("未等到 CAD 看图窗口", flush=True)
        return 1
    cad_pid = window_pid(main_hwnd)

    hinst, _ = make_window_class()
    if not hinst:
        print("注册窗口类失败", flush=True)
        return 1

    scr_w = u32.GetSystemMetrics(0)
    scr_h = u32.GetSystemMetrics(1)
    frame_w = min(int(scr_w * 0.88), 1700)
    frame_h = min(int(scr_h * 0.86), 980)
    host = u32.CreateWindowExW(
        0, "ZjCostCadViewer", "图纸查看器", WS_OVERLAPPEDWINDOW,
        max((scr_w - frame_w) // 2, 0), max((scr_h - frame_h) // 2 - 20, 0),
        frame_w, frame_h, 0, 0, hinst, 0,
    )
    if not host:
        print("创建窗口失败", flush=True)
        return 1
    u32.ShowWindow(host, 5)
    u32.UpdateWindow(host)
    attach(host, main_hwnd)
    align_view(host, main_hwnd)
    u32.SetForegroundWindow(host)
    print("挂接完成，宿主=", hex(host), flush=True)

    t_attach = time.time()
    while True:
        pump_messages()
        # 判活看真实看图窗口：重定向场景原 proc 已退出
        if not u32.IsWindow(main_hwnd):
            u32.PostMessageW(host, WM_CLOSE, 0, 0)
            time.sleep(0.2)
            break
        if not u32.IsWindow(host):
            break
        # 加载初期 Qt 可能多次重排，前 30 秒高频对齐，之后降频维持
        align_view(host, main_hwnd)
        time.sleep(0.15 if time.time() - t_attach < 30 else 0.8)
    try:
        subprocess.run(
            ["taskkill", "/F", "/PID", str(cad_pid)],
            capture_output=True, creationflags=subprocess.CREATE_NO_WINDOW,
        )
    except Exception:
        try:
            proc.terminate()
        except Exception:
            pass
    return 0


def main() -> int:
    args = sys.argv[1:]
    if args and args[0] == "--embed":
        if len(args) < 3:
            print("用法：cad_viewer.py --embed <坐标文件> <图纸路径>")
            return 2
        return run_embed(args[1], args[2])
    if len(args) < 1:
        print("用法：cad_viewer.py [--embed <坐标文件>] <图纸路径>")
        return 2
    return run_standalone(args[0])


if __name__ == "__main__":
    sys.exit(main())
