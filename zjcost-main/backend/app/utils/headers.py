"""HTTP 响应头工具：构建支持中文/Unicode 文件名的 Content-Disposition。

HTTP 头必须为 latin-1 编码，直接放入中文文件名会触发 UnicodeEncodeError，
导致下载接口 500。这里按 RFC 5987 提供 ASCII 回退文件名 + UTF-8 编码的
filename* 参数，现代浏览器均会优先使用 filename*。
"""

from __future__ import annotations

import re
from urllib.parse import quote

_INVALID_FILENAME_CHARS = re.compile(r'[\\/:*?"<>|\r\n\t\x00-\x1f]')


def sanitize_filename(name: str) -> str:
    """净化文件名：替换文件系统与 HTTP 头中的特殊字符，空白转下划线。"""
    if not name:
        return "unknown"
    safe = _INVALID_FILENAME_CHARS.sub("_", name)
    safe = re.sub(r"\s+", "_", safe)
    safe = re.sub(r"_+", "_", safe).strip("._ ")
    return safe or "unknown"


def _ascii_only(text: str) -> str:
    return "".join(ch for ch in text if ord(ch) < 128)


def build_attachment_disposition(filename: str) -> str:
    """构建 RFC 5987 的 Content-Disposition 附件头，支持中文文件名。"""
    safe = sanitize_filename(filename)
    fallback = sanitize_filename(_ascii_only(safe)) or "download"
    return f"attachment; filename=\"{fallback}\"; filename*=UTF-8''{quote(safe)}"
