"""PyInstaller runtime hook: 在入口脚本执行前注册文件系统模块覆盖加载器。

使 exe 同级目录下的 app/ 中的 .py 文件优先于 PYZ 归档中的版本被加载，
从而实现打包后的热修复（无需重新打包即可更新业务代码）。
"""
import sys
import importlib.util
from pathlib import Path


class _FilesystemFinder:
    def __init__(self, base_dir):
        self._base = Path(base_dir)

    def find_spec(self, fullname, path=None, target=None):
        if not fullname.startswith("app"):
            return None
        parts = fullname.split(".")
        pkg_dir = self._base.joinpath(*parts)
        init_py = pkg_dir / "__init__.py"
        if init_py.exists():
            return importlib.util.spec_from_file_location(
                fullname, init_py,
                submodule_search_locations=[str(pkg_dir)],
            )
        mod_py = pkg_dir.with_suffix(".py")
        if mod_py.exists():
            return importlib.util.spec_from_file_location(fullname, mod_py)
        return None


if getattr(sys, "frozen", False):
    _exe_dir = Path(sys.executable).resolve().parent
    _app_dir = _exe_dir / "app"
    if _app_dir.exists():
        sys.path.insert(0, str(_exe_dir))
        sys.meta_path.insert(0, _FilesystemFinder(_exe_dir))
