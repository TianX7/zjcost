"""图纸解析独立 worker（无控制台窗口的进程隔离执行）。

供 drawing_recognition 上传流程调用：读取输入图纸字节文件，运行
app.services.dxf_analysis_service.analyze_dxf_bytes_worker，把进度与最终结果
逐行追加写至输出 JSONL 文件（每行一条 ("kind", payload)），父进程按行轮询。

独立进程 + CREATE_NO_WINDOW / windowed exe 启动，保证任何上传都不会
弹出 python 控制台黑窗（此前 multiprocessing spawn 在打包版无控制台环境下
每次上传都会新建一个 python 黑窗）。
"""

import json
import os
import sys


def _append_file(path: str, item) -> None:
    with open(path, "a", encoding="utf-8") as fh:
        fh.write(json.dumps(item, ensure_ascii=False, default=str) + "\n")


class _FileQueue:
    """仅实现 .put 的最小队列，替代 multiprocessing.Queue 供 worker 使用。"""

    def __init__(self, path: str) -> None:
        self.path = path

    def put(self, item, *args, **kwargs) -> None:
        # 不吞异常：落盘失败必须冒泡给调用方，否则父进程只会看到
        # “子进程 exitcode=0 却没有结果”的假死状态，无法定位原因。
        _append_file(self.path, item)


def main(argv: list[str]) -> int:
    in_file, out_file = argv[1], argv[2]
    q = _FileQueue(out_file)
    try:
        import app.services.dxf_analysis_service  # noqa: F401
        from app.services.dxf_analysis_service import analyze_dxf_bytes_worker
    except Exception as exc:
        q.put(("error", f"加载解析模块失败: {exc}"))
        return 1
    filename = os.path.basename(in_file)
    try:
        with open(in_file, "rb") as fh:
            data = fh.read()
    except Exception as exc:
        q.put(("error", f"读取输入文件失败: {exc}"))
        return 1
    try:
        analyze_dxf_bytes_worker(data, filename, q)
    except Exception as exc:
        q.put(("error", f"解析子进程异常: {exc}"))
        return 1
    return 0


if __name__ == "__main__":
    try:
        rc = main(sys.argv)
    except Exception as exc:  # 最外层兜底，绝不静默
        try:
            with open(sys.argv[2], "a", encoding="utf-8") as fh:
                fh.write(json.dumps(("error", f"worker 异常: {exc}"), ensure_ascii=False) + "\n")
        except Exception:
            pass
        rc = 1
    sys.exit(rc)