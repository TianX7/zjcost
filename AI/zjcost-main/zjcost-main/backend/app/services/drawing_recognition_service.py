"""Drawing recognition service — uses 辅助 vision to identify structural components.

Accepts an uploaded drawing image, sends it to the configured 辅助 provider for
analysis, and returns structured component data suitable for BOQ generation.
"""

from __future__ import annotations

import base64
import json
import logging
from dataclasses import dataclass, field
from typing import Any

from app.assistant.providers import ZhProviderError, get_zh_provider

logger = logging.getLogger(__name__)


@dataclass
class RecognizedComponent:
    id: str
    type: str  # 构件类型: 框架柱, 框架梁, 剪力墙, etc.
    count: int
    spec: str  # 主规格: 600×600, T=250, etc.
    confidence: float  # 0-100
    material: str = ""  # 材料: C30混凝土, HRB400钢筋
    unit: str = ""  # 计量单位
    quantity_estimate: float = 0.0  # 初估工程量


@dataclass
class RecognitionResult:
    components: list[RecognizedComponent] = field(default_factory=list)
    summary: str = ""
    drawing_type: str = ""  # 结构平面图, 建筑平面图, etc.
    error: str | None = None


_RECOGNITION_PROMPT = """\
你是一位专业的工程造价图纸辅助识别助手。请分析上传的工程图纸图片，识别其中可用于生成工程量清单的土建、结构和安装工程内容。

请严格按以下JSON格式输出（不要包含其他文字），每个构件包含:
{
  "drawing_type": "图纸类型(如:结构平面图/建筑平面图/给排水平面图/电气平面图/暖通图/消防图等)",
  "summary": "简要描述图纸内容和识别结论",
  "components": [
    {
      "id": "唯一编号如C-1",
      "type": "构件类型(框架柱/框架梁/剪力墙/楼板/基础/给排水管道/电气配管/电缆电线/电缆桥架/通风风管/消防管道/阀门/卫生洁具/电气设备器具/暖通设备/消防设备器具等)",
      "count": 数量(整数),
      "spec": "主规格(如600×600, 300×600, T=250等)",
      "confidence": 置信度(0-100的浮点数),
      "material": "材料(如C30混凝土等，不确定则留空)",
      "unit": "计量单位(m³/m²/m/t/个/套/台/点等)",
      "quantity_estimate": 初估总工程量(浮点数，无法估计则为0)
    }
  ]
}

识别要点:
1. 土建结构：柱、梁、墙、板、基础、楼梯、门窗、钢筋。
2. 给排水：给水管、排水管、雨污废水管、阀门、水表、卫生洁具、地漏；管道按长度 m，阀门/洁具按个或套。
3. 电气：电气配管、电缆电线、桥架线槽、配电箱、灯具、开关插座；线缆/配管/桥架按长度 m，设备器具按个/套/台。
4. 暖通：风管、防排烟风管、空调水管、风机盘管、空调机组、风口；风管优先按面积 m²，管道按 m，设备按台/个。
5. 消防：消防管、喷淋管、消火栓、喷头、烟感、温感、报警模块、消防箱、灭火器；管道按 m，点位/设备按个/套。
6. 注意图层名、系统缩写、规格标注，例如 DN100、De50、SC20、JDG25、YJV、200×100、500×320。

如果图片不是工程图纸或无法识别，返回:
{"drawing_type": "unknown", "summary": "无法识别", "components": []}
"""


def _get_sample_components() -> list[RecognizedComponent]:
    return [
        RecognizedComponent(id="C-1", type="框架柱", count=12, spec="600×600", confidence=95.0, material="C30混凝土", unit="m³", quantity_estimate=17.28),
        RecognizedComponent(id="C-2", type="框架柱", count=8, spec="500×500", confidence=92.0, material="C30混凝土", unit="m³", quantity_estimate=8.64),
        RecognizedComponent(id="B-1", type="框架梁", count=16, spec="300×600", confidence=90.0, material="C30混凝土", unit="m³", quantity_estimate=34.56),
        RecognizedComponent(id="B-2", type="框架梁", count=10, spec="250×500", confidence=88.0, material="C30混凝土", unit="m³", quantity_estimate=15.00),
        RecognizedComponent(id="W-1", type="剪力墙", count=4, spec="T=250", confidence=93.0, material="C30混凝土", unit="m³", quantity_estimate=28.80),
        RecognizedComponent(id="S-1", type="楼板", count=2, spec="T=120", confidence=96.0, material="C30混凝土", unit="m³", quantity_estimate=57.60),
        RecognizedComponent(id="R-1", type="钢筋", count=1, spec="HRB400", confidence=85.0, material="HRB400", unit="t", quantity_estimate=18.50),
        RecognizedComponent(id="P-1", type="给排水管道", count=1, spec="DN100", confidence=87.0, unit="m", quantity_estimate=120.00),
        RecognizedComponent(id="P-2", type="给排水管道", count=1, spec="De50", confidence=85.0, unit="m", quantity_estimate=85.00),
        RecognizedComponent(id="V-1", type="阀门", count=12, spec="DN100", confidence=80.0, unit="个", quantity_estimate=12.00),
        RecognizedComponent(id="E-1", type="电气配管", count=1, spec="SC20", confidence=88.0, unit="m", quantity_estimate=350.00),
        RecognizedComponent(id="E-2", type="电缆电线", count=1, spec="YJV-4×25", confidence=82.0, unit="m", quantity_estimate=180.00),
        RecognizedComponent(id="L-1", type="电气设备器具", count=48, spec="灯具/开关插座", confidence=85.0, unit="个", quantity_estimate=48.00),
        RecognizedComponent(id="F-1", type="消防管道", count=1, spec="DN150", confidence=86.0, unit="m", quantity_estimate=95.00),
        RecognizedComponent(id="F-2", type="消防设备器具", count=24, spec="喷头/消火栓/烟感", confidence=83.0, unit="个", quantity_estimate=24.00),
    ]


def recognize_drawing(
    *,
    image_bytes: bytes,
    content_type: str = "image/png",
    project_context: str = "",
) -> RecognitionResult:
    provider = get_zh_provider()
    if not provider.is_enabled() or not provider.is_configured():
        return RecognitionResult(
            components=_get_sample_components(),
            summary="【离线模式】AI服务未配置，当前展示示例识别数据。共识别到15类构件，包含框架柱20根、框架梁26根、剪力墙4面、楼板2层，以及给排水、电气、消防等安装工程内容。",
            drawing_type="结构+安装综合平面图",
        )

    # Encode image to base64 for vision API
    b64_image = base64.b64encode(image_bytes).decode("utf-8")

    user_content: list[dict[str, Any]] = [
        {
            "type": "image_url",
            "image_url": {
                "url": f"data:{content_type};base64,{b64_image}",
            },
        },
        {
            "type": "text",
            "text": "请识别这张工程图纸中的结构构件。" + (
                f"\n项目背景: {project_context}" if project_context else ""
            ),
        },
    ]

    try:
        response_text = provider.generate_text(
            task="drawing_recognition",
            messages=[
                {"role": "system", "content": _RECOGNITION_PROMPT},
                {"role": "user", "content": user_content},
            ],
        )
    except ZhProviderError as exc:
        logger.error("Drawing recognition 辅助 call failed: %s", exc)
        return RecognitionResult(error=f"模型调用失败: {exc}")

    # Parse the JSON response
    try:
        # Strip markdown code fences if present
        text = response_text.strip()
        if text.startswith("```"):
            text = text.split("\n", 1)[1]  # remove first line
            if text.endswith("```"):
                text = text[:-3]
            text = text.strip()

        data = json.loads(text)
    except (json.JSONDecodeError, IndexError) as exc:
        logger.error("Failed to parse recognition response: %s", exc)
        return RecognitionResult(
            summary=response_text[:500],
            error="模型返回格式异常，无法解析",
        )

    components = []
    for item in data.get("components", []):
        try:
            components.append(RecognizedComponent(
                id=str(item.get("id", "")),
                type=str(item.get("type", "")),
                count=int(item.get("count", 0)),
                spec=str(item.get("spec", "")),
                confidence=float(item.get("confidence", 0)),
                material=str(item.get("material", "")),
                unit=str(item.get("unit", "")),
                quantity_estimate=float(item.get("quantity_estimate", 0)),
            ))
        except (ValueError, TypeError):
            continue

    return RecognitionResult(
        components=components,
        summary=data.get("summary", ""),
        drawing_type=data.get("drawing_type", ""),
    )


def components_to_boq_suggestions(
    components: list[RecognizedComponent],
) -> list[dict[str, Any]]:
    """Convert recognized components into BOQ item suggestions.

    Maps structural component types to GB50500 standard codes where possible.
    """
    _TYPE_TO_CODE = {
        "框架柱": ("010402001", "现浇混凝土柱", "m³"),
        "框架梁": ("010403001", "现浇混凝土梁", "m³"),
        "剪力墙": ("010404001", "现浇混凝土墙", "m³"),
        "楼板": ("010405001", "现浇混凝土板", "m³"),
        "基础": ("010401001", "现浇混凝土基础", "m³"),
        "连梁": ("010403001", "现浇混凝土梁", "m³"),
        "楼梯": ("010406001", "现浇混凝土楼梯", "m³"),
        "钢筋": ("010407001", "钢筋工程", "t"),
        "钢柱": ("010501001", "钢柱", "t"),
        "消防管道": ("030901001", "消防管道安装", "m"),
        "消防设备器具": ("030904001", "消防设备器具安装", "个"),
        "给排水管道": ("031001001", "给排水管道安装", "m"),
        "阀门": ("031003001", "阀门安装", "个"),
        "卫生洁具": ("031004001", "卫生洁具安装", "套"),
        "电气配管": ("030411001", "电气配管", "m"),
        "电缆电线": ("030408001", "电缆电线敷设", "m"),
        "电缆桥架": ("030404001", "电缆桥架安装", "m"),
        "电气设备器具": ("030412001", "电气设备器具安装", "个"),
        "通风风管": ("030701001", "通风风管制作安装", "m²"),
        "暖通设备": ("030702001", "暖通设备安装", "台"),
    }

    suggestions = []
    for comp in components:
        mapping = _TYPE_TO_CODE.get(comp.type)
        code = mapping[0] if mapping else ""
        standard_name = mapping[1] if mapping else comp.type
        unit = mapping[2] if mapping else comp.unit

        suggestions.append({
            "source_component_id": comp.id,
            "suggested_code": code,
            "suggested_name": f"{standard_name} {comp.spec}",
            "suggested_unit": unit,
            "suggested_quantity": comp.quantity_estimate,
            "characteristics": f"构件类型: {comp.type}, 规格: {comp.spec}",
            "confidence": comp.confidence,
            "material": comp.material,
            "component_count": comp.count,
        })

    return suggestions
