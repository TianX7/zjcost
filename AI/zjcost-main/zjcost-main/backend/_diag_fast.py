# 临时测速：快速看图模式（跳过 HATCH + 低分辨率）渲染耗时（用完即删）
import io
import base64
import logging
import sys
import time

logging.basicConfig(level=logging.INFO, stream=sys.stdout, format="%(levelname)s %(message)s")

import ezdxf
from app.services.dxf_analysis_service import build_cad_raster, _read_dxf_document

DXF_PATH = r"C:\Users\TIAN\AppData\Local\Temp\tmpp3_w5u00.dxf"

t0 = time.perf_counter()
doc, diag = _read_dxf_document(ezdxf, DXF_PATH)
print("读取: %.1fs" % (time.perf_counter() - t0), flush=True)

# 快速看图模式：跳 HATCH + 长边 2000px
raster = build_cad_raster(doc, max_dim=2000, skip_hatch=True)
print("快速模式总耗时: %.1fs" % (time.perf_counter() - t0), flush=True)
if raster:
    import PIL.Image
    img = PIL.Image.open(io.BytesIO(base64.b64decode(raster["data_url"].split(",", 1)[1]))).convert("L")
    w, h = img.size
    px = list(img.getdata())[::977]
    lit = sum(1 for v in px if v > 8)
    print("尺寸: %sx%s 非黑占比: %.2f%%" % (w, h, 100.0 * lit / len(px)), flush=True)
    with open("_diag_fast.png", "wb") as f:
        f.write(base64.b64decode(raster["data_url"].split(",", 1)[1]))
else:
    print("快速模式渲染失败", flush=True)
