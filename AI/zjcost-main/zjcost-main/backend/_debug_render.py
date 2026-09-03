# -*- coding: utf-8 -*-
"""临时调试 v2：真实电气图 转换→渲染 快速验证（含离群剔除），用完即删"""
import base64
import glob
import io
import logging
import time

logging.basicConfig(level=logging.INFO)

DWG = glob.glob(
    r"c:\Users\TIAN\Desktop\AI\AI\zjcost-main\zjcost-main\backend\uploads_cache\*.dwg"
)[0]
print("图纸文件:", DWG)

t0 = time.time()
with open(DWG, "rb") as f:
    dwg_bytes = f.read()

from app.services.dwg_conversion_service import convert_dwg_to_dxf_bytes

conv = convert_dwg_to_dxf_bytes(dwg_bytes, "milan_electrical.dwg")
print(f"[1] DWG->DXF: {time.time()-t0:.1f}s, {'成功' if conv.dxf_bytes else '失败:'+str(conv.error)}")
if not conv.dxf_bytes:
    raise SystemExit(1)

# 与系统管线一致的 LibreDWG 归一化预处理
dxf_bytes = conv.dxf_bytes.replace(b"\r\r\n", b"\r\n")

import ezdxf

tmp_dxf = r"c:\Users\TIAN\Desktop\AI\AI\zjcost-main\zjcost-main\backend\_debug_tmp.dxf"
with open(tmp_dxf, "wb") as f:
    f.write(dxf_bytes)
doc = ezdxf.readfile(tmp_dxf)
print(f"[2] ezdxf 打开: {time.time()-t0:.1f}s")

from app.services.dxf_analysis_service import build_cad_raster

raster = build_cad_raster(doc)
print(f"[3] build_cad_raster: {time.time()-t0:.1f}s")
if raster is None:
    print("    渲染失败返回 None")
    raise SystemExit(1)
print(f"    尺寸: {raster['width']}x{raster['height']}, data_url len={len(raster['data_url'])}")

png = base64.b64decode(raster["data_url"].split(",", 1)[1])
import PIL.Image

img = PIL.Image.open(io.BytesIO(png)).convert("RGB")
px = img.load()
w, h = img.size
lit = 0
sampled = 0
for y in range(0, h, 8):
    for x in range(0, w, 8):
        p = px[x, y]
        sampled += 1
        if max(p[0], p[1], p[2]) > 8:
            lit += 1
print(f"[4] 像素统计: {w}x{h}, 采样非黑像素 {lit}/{sampled} ({100.0*lit/sampled:.1f}%)")
out = r"c:\Users\TIAN\Desktop\AI\AI\zjcost-main\zjcost-main\backend\_debug_real.png"
with open(out, "wb") as f:
    f.write(png)
print(f"[5] PNG 已保存: {out}")
print(f"总耗时: {time.time()-t0:.1f}s")