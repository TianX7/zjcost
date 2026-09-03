# -*- coding: utf-8 -*-
"""临时调试：统计真实电气图的可渲染实体构成，评估渲染前零贡献图元过滤的收益，用完即删"""
import glob
import time

DWG = glob.glob(
    r"c:\Users\TIAN\Desktop\AI\AI\zjcost-main\zjcost-main\backend\uploads_cache\*.dwg"
)[0]
print("图纸文件:", DWG)

t0 = time.time()
with open(DWG, "rb") as f:
    dwg_bytes = f.read()

from app.services.dwg_conversion_service import convert_dwg_to_dxf_bytes

conv = convert_dwg_to_dxf_bytes(dwg_bytes, "stats.dwg")
print(f"[1] DWG->DXF: {time.time()-t0:.1f}s")
if not conv.dxf_bytes:
    raise SystemExit("转换失败")

dxf_bytes = conv.dxf_bytes.replace(b"\r\r\n", b"\r\n")

import ezdxf
from collections import Counter

tmp = r"c:\Users\TIAN\Desktop\AI\AI\zjcost-main\zjcost-main\backend\_debug_stats.dxf"
with open(tmp, "wb") as f:
    f.write(dxf_bytes)
doc = ezdxf.readfile(tmp)
print(f"[2] ezdxf 打开: {time.time()-t0:.1f}s")

from collections import Counter

# 各容器中的实体 dxftype 分布
def collect_stat(container):
    types = Counter()
    zero_len_lines = 0
    empty_text = 0
    points = 0
    degenerate_lw = 0  # 顶点不足2个的 LWPOLYLINE/POLYLINE
    invisible = 0  # invisible 属性
    for ent in container:
        t = ent.dxftype()
        types[t] += 1
        try:
            if t == "LINE":
                p1, p2 = ent.dxf.start, ent.dxf.end
                if (abs(p1[0]-p2[0]) < 1e-9 and abs(p1[1]-p2[1]) < 1e-9 and abs(p1[2]-p2[2]) < 1e-9):
                    zero_len_lines += 1
            elif t in ("TEXT", "MTEXT", "ATTRIB", "ATTDEF"):
                txt = getattr(ent, "text", "") if t != "MTEXT" else getattr(ent, "text", "")
                if t == "MTEXT":
                    try:
                        txt = ent.plain_text()
                    except Exception:
                        txt = getattr(ent, "text", "")
                if not txt or not str(txt).strip():
                    empty_text += 1
            elif t == "POINT":
                points += 1
            elif t == "LWPOLYLINE":
                try:
                    n = len(ent.get_points())
                except Exception:
                    n = 2
                if n < 2:
                    degenerate_lw += 1
            try:
                if ent.dxf.invisible:
                    invisible += 1
            except Exception:
                pass
        except Exception:
            continue
    return types, zero_len_lines, empty_text, points, degenerate_lw, invisible

ms_types, ms_z, ms_t, ms_p, ms_d, ms_i = collect_stat(doc.modelspace())
print("[3] 模型空间 top 类型:", ms_types.most_common(15))
print(f"    零长度线={ms_z} 空文字={ms_t} 孤立点={ms_p} 退化多段线={ms_d} invisible={ms_i} 总数={sum(ms_types.values())}")

bt = Counter()
bz = bt_count = 0
for block in doc.blocks:
    types, z, t, p, d, i = collect_stat(block)
    bt.update(types)
    bz += z
    bt_count += sum(types.values())
print("[4] 块表实体总数:", bt_count, " top 类型:", bt.most_common(15))
print(f"    块内零长度线={bz} 块数={len(doc.blocks)}")
print(f"总耗时: {time.time()-t0:.1f}s")