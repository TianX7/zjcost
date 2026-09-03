# -*- coding: utf-8 -*-
"""临时诊断：图层开关状态 + 离群统计（不渲染，快速）"""
import time

import ezdxf

t0 = time.time()
doc = ezdxf.readfile(r"c:\Users\TIAN\Desktop\AI\AI\zjcost-main\zjcost-main\backend\_debug_tmp.dxf")
print(f"[1] 打开 DXF: {time.time()-t0:.1f}s")

off_layers = []
frozen_layers = []
n_layers = 0
for layer in doc.layers:
    n_layers += 1
    flags = int(layer.dxf.flags)
    # bit0 = frozen, bit2 = locked, bit4? off 在 ezdxf: layer.is_offline? on/off 用 flags bit? 
    if layer.is_off():
        off_layers.append(layer.dxf.name)
    if layer.is_frozen():
        frozen_layers.append(layer.dxf.name)
print(f"[2] 图层总数: {n_layers}, off: {len(off_layers)}, frozen: {len(frozen_layers)}")
print("    off 图层示例:", off_layers[:10])
print("    frozen 图层示例:", frozen_layers[:10])

msp = doc.modelspace()
entities = list(msp)
print(f"[3] 顶层实体数: {len(entities)}")

from ezdxf import bbox as ez_bbox

extents = ez_bbox.extents(entities, fast=True)
centers = []
ok = 0
import math
for ent, ext in zip(entities, extents):
    if ext is not None and ext.has_data:
        centers.append(((ext.extmin[0] + ext.extmax[0]) / 2, (ext.extmin[1] + ext.extmax[1]) / 2))
        ok += 1
    elif ent.dxf.hasattr("insert"):
        centers.append((float(ent.dxf.insert[0]), float(ent.dxf.insert[1])))
    else:
        centers.append((math.nan, math.nan))
print(f"[4] 有 bbox 的实体: {ok}/{len(entities)}")

cx = [c[0] for c in centers if not math.isnan(c[0])]
cy = [c[1] for c in centers if not math.isnan(c[1])]


def _mad(vals):
    m = sorted(vals)[len(vals) // 2]
    return m, sorted(abs(v - m) for v in vals)[len(vals) // 2]


med_x, mad_x = _mad(cx)
med_y, mad_y = _mad(cy)
print(f"[5] X: median={med_x:.3g}, MAD={mad_x:.3g} | Y: median={med_y:.3g}, MAD={mad_y:.3g}")

th_x = max(mad_x * 15, 1e-6)
th_y = max(mad_y * 15, 1e-6)
out_x = sum(1 for v in cx if abs(v - med_x) > th_x)
out_y = sum(1 for v in cy if abs(v - med_y) > th_y)
print(f"[6] X 离群: {out_x}, Y 离群: {out_y} (阈值 X={th_x:.3g}, Y={th_y:.3g})")

inlier_min_x = min(v for v in cx if abs(v - med_x) <= th_x)
inlier_max_x = max(v for v in cx if abs(v - med_x) <= th_x)
inlier_min_y = min(v for v in cy if abs(v - med_y) <= th_y)
inlier_max_y = max(v for v in cy if abs(v - med_y) <= th_y)
print(f"[7] 主体中心范围: X [{inlier_min_x:.3g}, {inlier_max_x:.3g}], Y [{inlier_min_y:.3g}, {inlier_max_y:.3g}]")

# 实体图层归属统计：主体实体 vs off 图层
off_set = set(off_layers)
in_off = 0
for ent, (x, y) in zip(entities, centers):
    try:
        if ent.dxf.layer in off_set:
            in_off += 1
    except Exception:
        pass
print(f"[8] 原状态在 off 图层的顶层实体: {in_off}/{len(entities)}")
print(f"总耗时: {time.time()-t0:.1f}s")