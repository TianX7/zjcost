"""快速验证 build_cad_raster 的输出像素是否达到目标长边。"""
import io
import ezdxf
from ezdxf.math import Vec3
from app.services.dxf_analysis_service import build_cad_raster

doc = ezdxf.new("R2010")
msp = doc.modelspace()
# 模拟一张横向 200x100 单位的图：外框 + 两条线 + 一个文字
msp.add_lwpolyline([(0, 0), (200, 0), (200, 100), (0, 100), (0, 0)])
msp.add_line((10, 10), (190, 90))
msp.add_circle((100, 50), 8)
msp.add_text("测试文字 ABC123", dxfattribs={"height": 6}).set_placement((20, 80))

raster = build_cad_raster(doc)
if raster is None:
    raise SystemExit("raster None")
data_url = raster.get("data_url", "")
import base64
import io as _io
import PIL.Image
b64 = data_url.split(",", 1)[1]
img = PIL.Image.open(_io.BytesIO(base64.b64decode(b64)))
print("PNG size:", img.size, "meta w/h:", raster.get("width"), raster.get("height"))