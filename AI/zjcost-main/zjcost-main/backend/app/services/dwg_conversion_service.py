"""Local DWG to DXF conversion helpers.

DWG is a binary AutoCAD format. The offline parser in this project reads DXF,
so DWG support depends on a local converter such as ODA File Converter or
LibreDWG. Cloud conversion is intentionally not used here.
"""

from __future__ import annotations

import glob
import os
import re
import shutil
import subprocess
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class DwgConversionResult:
    dxf_bytes: bytes | None = None
    dwg_bytes: bytes | None = None
    diagnostics: list[str] = field(default_factory=list)
    error: str | None = None


@dataclass(frozen=True)
class _ConverterCandidate:
    kind: str
    path: str
    source: str = "system"


_BACKEND_ROOT = Path(__file__).resolve().parents[2]
_REPO_ROOT = _BACKEND_ROOT.parent
_BUNDLED_CONVERTER_DIRS = (
    _BACKEND_ROOT / "_internal" / "backend" / "tools" / "cad-converters" / "libredwg",
    _BACKEND_ROOT / "_internal" / "backend" / "tools" / "cad-converters",
    _BACKEND_ROOT / "tools" / "cad-converters",
    _BACKEND_ROOT / "tools" / "cad-converters" / "libredwg",
    _BACKEND_ROOT / "tools" / "cad-converters" / "windows",
    _BACKEND_ROOT / "tools" / "cad-converters" / "bin",
    _REPO_ROOT / "tools" / "cad-converters",
    _REPO_ROOT / "tools" / "cad-converters" / "libredwg",
    _REPO_ROOT / "tools" / "cad-converters" / "windows",
    _REPO_ROOT / "tools" / "cad-converters" / "bin",
)
_BUNDLED_DIR_ENV = "ZJCOST_CAD_CONVERTER_DIR"
_CONVERTER_TIMEOUT_ENV = "ZJCOST_CAD_CONVERTER_TIMEOUT"
_DEFAULT_CONVERTER_TIMEOUT_SECONDS = 600
_ODA_EXECUTABLES = ("ODAFileConverter.exe", "ODAFileConverter", "TeighaFileConverter.exe")
_DXF_TO_DWG_EXECUTABLES = ("dxf2dwg.exe", "dxf2dwg")
_DWG_TO_DXF_EXECUTABLES = ("dwgread.exe", "dwgread", "dwg2dxf.exe", "dwg2dxf")

# 打包版是无控制台的 GUI 进程：不隐藏子进程窗口的话，每次 DWG 转换都会在
# 桌面上弹出一个转换器的控制台/程序窗口。CREATE_NO_WINDOW 让转换完全后台运行。
_NO_WINDOW_FLAGS = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0


def _looks_like_dxf(file_bytes: bytes) -> bool:
    head = file_bytes[:4096].lstrip()
    if head.startswith((b"0\r\nSECTION", b"0\nSECTION")):
        return True
    return b"$ACADVER" in head and b"SECTION" in head


def _safe_stem(filename: str, default: str = "drawing") -> str:
    name = Path(filename or "drawing.dwg").name
    stem = Path(name).stem.strip() or default
    return re.sub(r"[^A-Za-z0-9._-]+", "_", stem) or default


def _safe_filename(filename: str) -> str:
    return f"{_safe_stem(filename)}.dwg"


def _safe_input_filename(filename: str, suffix: str) -> str:
    return f"{_safe_stem(filename)}{suffix}"


def _existing_env_path(*names: str) -> list[_ConverterCandidate]:
    candidates: list[_ConverterCandidate] = []
    for name in names:
        raw = os.environ.get(name)
        if not raw:
            continue
        path = Path(raw.strip('"'))
        if path.exists():
            kind = "oda" if "oda" in path.name.lower() or "fileconverter" in path.name.lower() else "libredwg"
            candidates.append(_ConverterCandidate(kind=kind, path=str(path), source=f"env:{name}"))
    return candidates


def _candidate_from_path(path: Path, *, source: str) -> _ConverterCandidate | None:
    if not path.exists() or not path.is_file():
        return None
    name = path.name.lower()
    if name in {item.lower() for item in _ODA_EXECUTABLES} or "fileconverter" in name:
        return _ConverterCandidate(kind="oda", path=str(path), source=source)
    if name in {item.lower() for item in (*_DXF_TO_DWG_EXECUTABLES, *_DWG_TO_DXF_EXECUTABLES)}:
        return _ConverterCandidate(kind="libredwg", path=str(path), source=source)
    return None


def _bundled_converter_dirs() -> list[Path]:
    dirs: list[Path] = []
    raw = os.environ.get(_BUNDLED_DIR_ENV, "")
    for item in raw.split(os.pathsep):
        item = item.strip().strip('"')
        if item:
            dirs.append(Path(item))
    dirs.extend(_BUNDLED_CONVERTER_DIRS)
    return dirs


def _find_bundled_candidates(names: tuple[str, ...]) -> list[_ConverterCandidate]:
    candidates: list[_ConverterCandidate] = []
    for directory in _bundled_converter_dirs():
        if not directory.exists():
            continue
        for name in names:
            direct = directory / name
            candidate = _candidate_from_path(direct, source="bundled")
            if candidate:
                candidates.append(candidate)
        for name in names:
            for found in directory.rglob(name):
                candidate = _candidate_from_path(found, source="bundled")
                if candidate:
                    candidates.append(candidate)
    return candidates


def _dedupe_candidates(candidates: list[_ConverterCandidate]) -> list[_ConverterCandidate]:
    unique: dict[str, _ConverterCandidate] = {}
    for candidate in candidates:
        unique.setdefault(str(Path(candidate.path).resolve()).lower(), candidate)
    return list(unique.values())


def _converter_timeout_seconds() -> int:
    raw = os.environ.get(_CONVERTER_TIMEOUT_ENV, "")
    try:
        return max(60, int(raw))
    except (TypeError, ValueError):
        return _DEFAULT_CONVERTER_TIMEOUT_SECONDS


def _find_dwg_to_dxf_candidates() -> list[_ConverterCandidate]:
    candidates: list[_ConverterCandidate] = []
    candidates.extend(_find_bundled_candidates((*_ODA_EXECUTABLES, *_DWG_TO_DXF_EXECUTABLES)))
    candidates.extend(_existing_env_path("DWG_CONVERTER_PATH", "ODA_FILE_CONVERTER", "LIBREDWG_DWG2DXF"))

    for command in _ODA_EXECUTABLES:
        found = shutil.which(command)
        if found:
            candidates.append(_ConverterCandidate(kind="oda", path=found, source="path"))

    for command in _DWG_TO_DXF_EXECUTABLES:
        found = shutil.which(command)
        if found:
            candidates.append(_ConverterCandidate(kind="libredwg", path=found, source="path"))

    common_globs = (
        r"C:\Program Files\ODA\*\ODAFileConverter.exe",
        r"C:\Program Files\ODAFileConverter*\ODAFileConverter.exe",
        r"C:\Program Files (x86)\ODA\*\ODAFileConverter.exe",
        r"C:\Program Files (x86)\ODAFileConverter*\ODAFileConverter.exe",
    )
    for pattern in common_globs:
        for found in glob.glob(pattern):
            candidates.append(_ConverterCandidate(kind="oda", path=found, source="program-files"))

    return _dedupe_candidates(candidates)


def _find_dxf_to_dwg_candidates() -> list[_ConverterCandidate]:
    candidates: list[_ConverterCandidate] = []
    candidates.extend(_find_bundled_candidates((*_ODA_EXECUTABLES, *_DXF_TO_DWG_EXECUTABLES)))
    candidates.extend(_existing_env_path("DXF_CONVERTER_PATH", "ODA_FILE_CONVERTER", "LIBREDWG_DXF2DWG"))

    for command in _ODA_EXECUTABLES:
        found = shutil.which(command)
        if found:
            candidates.append(_ConverterCandidate(kind="oda", path=found, source="path"))

    for command in _DXF_TO_DWG_EXECUTABLES:
        found = shutil.which(command)
        if found:
            candidates.append(_ConverterCandidate(kind="libredwg", path=found, source="path"))

    common_globs = (
        r"C:\Program Files\ODA\*\ODAFileConverter.exe",
        r"C:\Program Files\ODAFileConverter*\ODAFileConverter.exe",
        r"C:\Program Files (x86)\ODA\*\ODAFileConverter.exe",
        r"C:\Program Files (x86)\ODAFileConverter*\ODAFileConverter.exe",
    )
    for pattern in common_globs:
        for found in glob.glob(pattern):
            candidates.append(_ConverterCandidate(kind="oda", path=found, source="program-files"))

    return _dedupe_candidates(candidates)


def get_converter_status() -> dict[str, Any]:
    """Return user-facing converter availability without exposing full paths."""

    dxf_to_dwg = _find_dxf_to_dwg_candidates()
    dwg_to_dxf = _find_dwg_to_dxf_candidates()

    def serialize(candidates: list[_ConverterCandidate]) -> list[dict[str, str]]:
        return [
            {
                "name": Path(candidate.path).name,
                "kind": candidate.kind,
                "source": candidate.source,
                "bundled": candidate.source == "bundled",
            }
            for candidate in candidates
        ]

    configured_dirs = [str(path) for path in _bundled_converter_dirs()]
    return {
        "dxf_to_dwg": bool(dxf_to_dwg),
        "dwg_to_dxf": bool(dwg_to_dxf),
        "candidates": {
            "dxf_to_dwg": serialize(dxf_to_dwg),
            "dwg_to_dxf": serialize(dwg_to_dxf),
        },
        "bundled_dirs": configured_dirs,
        "timeout_seconds": _converter_timeout_seconds(),
        "instructions": (
            "将 ODAFileConverter.exe 或 LibreDWG 的 dxf2dwg.exe/dwg2dxf.exe 放入 "
            "backend/tools/cad-converters 后，系统会自动作为内置转换器使用。"
        ),
    }


def _run_oda_converter(
    exe: str,
    input_path: Path,
    output_dir: Path,
    *,
    output_format: str,
    input_filter: str,
    output_suffix: str,
) -> Path | None:
    input_dir = input_path.parent
    expected = output_dir / f"{input_path.stem}.{output_suffix}"
    command = [
        exe,
        str(input_dir),
        str(output_dir),
        "ACAD2018",
        output_format,
        "0",
        "1",
        input_filter,
    ]
    subprocess.run(command, check=True, capture_output=True, text=True, timeout=_converter_timeout_seconds(), creationflags=_NO_WINDOW_FLAGS)
    if expected.exists():
        return expected

    matches = sorted(output_dir.rglob(f"*.{output_suffix}"))
    return matches[0] if matches else None


def _run_libredwg_converter(
    exe: str,
    input_path: Path,
    output_dir: Path,
    *,
    output_suffix: str,
) -> Path | None:
    expected = output_dir / f"{input_path.stem}.{output_suffix}"
    name = Path(exe).name.lower()
    if "dxf2dwg" in name:
        command = [exe, "-y", "-o", str(expected), str(input_path)]
    elif "dwg2dxf" in name:
        command = [exe, "-y", "-o", str(expected), str(input_path)]
    elif "dwgread" in name:
        command = [exe, "-O", "DXF", "-o", str(expected), str(input_path)]
    else:
        command = [exe, "-o", str(expected), str(input_path)]
    result = subprocess.run(command, check=True, capture_output=True, timeout=_converter_timeout_seconds(), creationflags=_NO_WINDOW_FLAGS)
    if expected.exists():
        return expected
    if result.stdout:
        expected.write_bytes(result.stdout)
        return expected
    return None


def convert_dwg_to_dxf_bytes(file_bytes: bytes, filename: str) -> DwgConversionResult:
    """Convert DWG bytes to DXF bytes with a local converter when available."""

    if _looks_like_dxf(file_bytes):
        return DwgConversionResult(
            dxf_bytes=file_bytes,
            diagnostics=["文件扩展名是 DWG，但内容已经是 DXF，已直接按 DXF 解析。"],
        )

    candidates = _find_dwg_to_dxf_candidates()
    if not candidates:
        return DwgConversionResult(
            diagnostics=[
                "未检测到本机 DWG 转 DXF 工具，已停止解析。",
                "可将 ODAFileConverter.exe 或 LibreDWG 的 dwg2dxf.exe 放入 backend/tools/cad-converters，系统会自动作为内置转换器使用。",
                "也可以将转换器路径加入 PATH，或设置 DWG_CONVERTER_PATH。",
            ],
            error="dwg_converter_not_found",
        )

    errors: list[str] = []
    with tempfile.TemporaryDirectory(prefix="zjcost-dwg-") as tmp_dir:
        root = Path(tmp_dir)
        input_dir = root / "input"
        output_dir = root / "output"
        input_dir.mkdir()
        output_dir.mkdir()
        input_path = input_dir / _safe_filename(filename)
        input_path.write_bytes(file_bytes)

        for candidate in candidates:
            try:
                if candidate.kind == "oda":
                    output_path = _run_oda_converter(
                        candidate.path,
                        input_path,
                        output_dir,
                        output_format="DXF",
                        input_filter="*.dwg",
                        output_suffix="dxf",
                    )
                else:
                    output_path = _run_libredwg_converter(
                        candidate.path,
                        input_path,
                        output_dir,
                        output_suffix="dxf",
                    )
                if output_path and output_path.exists():
                    return DwgConversionResult(
                        dxf_bytes=output_path.read_bytes(),
                        diagnostics=[f"DWG 已通过{'内置' if candidate.source == 'bundled' else '本机'}转换器转换为 DXF：{Path(candidate.path).name}。"],
                    )
                errors.append(f"{Path(candidate.path).name}: 未生成 DXF 文件")
            except subprocess.CalledProcessError as e:
                # 保留 stderr 内容便于排查
                errors.append(f"{Path(candidate.path).name}: {e.stderr[:200] if e.stderr else str(e)}")
            except subprocess.TimeoutExpired:
                errors.append(f"{Path(candidate.path).name}: 转换超时")
            except Exception as exc:
                errors.append(f"{Path(candidate.path).name}: {exc}")

    return DwgConversionResult(
        diagnostics=[
            "已尝试本机 DWG 转 DXF，但转换失败。",
            *errors[:4],
        ],
        error="dwg_conversion_failed",
    )


def convert_dxf_to_dwg_bytes(file_bytes: bytes, filename: str) -> DwgConversionResult:
    """Convert DXF bytes to DWG bytes with a local converter when available."""

    if not _looks_like_dxf(file_bytes):
        return DwgConversionResult(
            diagnostics=["文件内容不像 DXF，已停止转换。"],
            error="dxf_not_detected",
        )

    candidates = _find_dxf_to_dwg_candidates()
    if not candidates:
        return DwgConversionResult(
            diagnostics=[
                "未检测到本机 DXF 转 DWG 工具，已停止转换。",
                "可将 ODAFileConverter.exe 或 LibreDWG 的 dxf2dwg.exe 放入 backend/tools/cad-converters，系统会自动作为内置转换器使用。",
                "也可以将转换器路径加入 PATH，或设置 DXF_CONVERTER_PATH。",
            ],
            error="dxf_converter_not_found",
        )

    errors: list[str] = []
    with tempfile.TemporaryDirectory(prefix="zjcost-dxf-") as tmp_dir:
        root = Path(tmp_dir)
        input_dir = root / "input"
        output_dir = root / "output"
        input_dir.mkdir()
        output_dir.mkdir()
        input_path = input_dir / _safe_input_filename(filename, ".dxf")
        input_path.write_bytes(file_bytes)

        for candidate in candidates:
            try:
                if candidate.kind == "oda":
                    output_path = _run_oda_converter(
                        candidate.path,
                        input_path,
                        output_dir,
                        output_format="DWG",
                        input_filter="*.dxf",
                        output_suffix="dwg",
                    )
                else:
                    output_path = _run_libredwg_converter(
                        candidate.path,
                        input_path,
                        output_dir,
                        output_suffix="dwg",
                    )
                if output_path and output_path.exists():
                    return DwgConversionResult(
                        dwg_bytes=output_path.read_bytes(),
                        diagnostics=[f"DXF 已通过{'内置' if candidate.source == 'bundled' else '本机'}转换器转换为 DWG：{Path(candidate.path).name}。"],
                    )
                errors.append(f"{Path(candidate.path).name}: 未生成 DWG 文件")
            except subprocess.CalledProcessError as e:
                # 保留 stderr 内容便于排查
                errors.append(f"{Path(candidate.path).name}: {e.stderr[:200] if e.stderr else str(e)}")
            except subprocess.TimeoutExpired:
                errors.append(f"{Path(candidate.path).name}: 转换超时")
            except Exception as exc:
                errors.append(f"{Path(candidate.path).name}: {exc}")

    return DwgConversionResult(
        diagnostics=[
            "已尝试本机 DXF 转 DWG，但转换失败。",
            *errors[:4],
        ],
        error="dxf_to_dwg_failed",
    )
