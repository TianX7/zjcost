"""IFC model parsing: extract building elements, compute quantities, map to GB50500 BOQ codes."""

from __future__ import annotations

import os
import tempfile
import threading
import importlib
from typing import Any

ifcopenshell = None
ifcopenshell_shape_util = None

# 保护 ifcopenshell 初始化的线程锁
_ifcopenshell_lock = threading.Lock()


def _env_bool(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _env_int(name: str, default: int) -> int:
    try:
        return max(1, int(os.getenv(name, str(default))))
    except (TypeError, ValueError):
        return default


IFC_ENABLE_GEOMETRY_FALLBACK = _env_bool("IFC_ENABLE_GEOMETRY_FALLBACK", False)
IFC_ENABLE_PREVIEW_MESH = _env_bool("IFC_ENABLE_PREVIEW_MESH", True)
IFC_MAX_ELEMENTS = _env_int("IFC_MAX_ELEMENTS", 20000)
IFC_PREVIEW_ELEMENTS = _env_int("IFC_PREVIEW_ELEMENTS", 20000)
IFC_PREVIEW_MESH_ELEMENTS = _env_int("IFC_PREVIEW_MESH_ELEMENTS", 20000)
IFC_PREVIEW_MESH_PER_CLASS = _env_int("IFC_PREVIEW_MESH_PER_CLASS", IFC_PREVIEW_MESH_ELEMENTS)
IFC_PREVIEW_MAX_VERTICES_PER_ELEMENT = _env_int("IFC_PREVIEW_MAX_VERTICES_PER_ELEMENT", 3000)


def _ensure_ifcopenshell():
    global ifcopenshell, ifcopenshell_shape_util
    # 双重检查 + 锁保护，避免多线程并发初始化
    if ifcopenshell is not None:
        return ifcopenshell

    with _ifcopenshell_lock:
        if ifcopenshell is not None:
            return ifcopenshell
        try:
            ifcopenshell = importlib.import_module("ifcopenshell")
            importlib.import_module("ifcopenshell.geom")
            importlib.import_module("ifcopenshell.util.element")
            importlib.import_module("ifcopenshell.util.placement")
            try:
                ifcopenshell_shape_util = importlib.import_module("ifcopenshell.util.shape")
            except Exception:
                ifcopenshell_shape_util = None
            return ifcopenshell
        except Exception as exc:
            raise RuntimeError(f"IFC解析组件不可用: {exc}") from exc


IFC_TARGET_CLASSES = [
    "IfcColumn",
    "IfcBeam",
    "IfcWall",
    "IfcWallStandardCase",
    "IfcSlab",
    "IfcFooting",
    "IfcPile",
    "IfcDoor",
    "IfcWindow",
    "IfcStair",
    "IfcStairFlight",
    "IfcRoof",
    "IfcRailing",
    "IfcRamp",
    "IfcMember",
    "IfcCovering",
    "IfcCurtainWall",
    "IfcPipeSegment",
    "IfcPipeFitting",
    "IfcDuctSegment",
    "IfcDuctFitting",
    "IfcCableCarrierSegment",
    "IfcCableCarrierFitting",
]

IFC_PREVIEW_PRIORITY_CLASSES = [
    "IfcColumn",
    "IfcBeam",
    "IfcWall",
    "IfcWallStandardCase",
    "IfcSlab",
    "IfcFooting",
    "IfcPile",
    "IfcRoof",
    "IfcStair",
    "IfcStairFlight",
    "IfcDoor",
    "IfcWindow",
    "IfcMember",
    "IfcCovering",
    "IfcCurtainWall",
    "IfcPipeSegment",
    "IfcDuctSegment",
    "IfcCableCarrierSegment",
]

IFC_EXCLUDED_ELEMENT_CLASSES = {
    "IfcFeatureElement",
    "IfcFeatureElementAddition",
    "IfcFeatureElementSubtraction",
    "IfcOpeningElement",
    "IfcProjectionElement",
    "IfcVirtualElement",
}

IFC_TO_GB50500: dict[str, tuple[str, str, str]] = {
    "IfcColumn":               ("010402001", "现浇混凝土柱", "m³"),
    "IfcBeam":                 ("010403001", "现浇混凝土梁", "m³"),
    "IfcWall":                 ("010404001", "现浇混凝土墙", "m³"),
    "IfcWallStandardCase":     ("010404001", "现浇混凝土墙", "m³"),
    "IfcSlab":                 ("010405001", "现浇混凝土板", "m³"),
    "IfcFooting":              ("010401001", "现浇混凝土基础", "m³"),
    "IfcPile":                 ("010401002", "预制混凝土桩", "m³"),
    "IfcDoor":                 ("010801001", "木质门", "m²"),
    "IfcWindow":               ("010803001", "金属窗", "m²"),
    "IfcStair":                ("010406001", "现浇混凝土楼梯", "m²"),
    "IfcStairFlight":          ("010406001", "现浇混凝土楼梯", "m²"),
    "IfcRoof":                 ("010901001", "屋面", "m²"),
    "IfcRailing":              ("011001001", "栏杆", "m"),
    "IfcRamp":                 ("011002001", "坡道", "m²"),
    "IfcMember":               ("010603001", "钢结构构件", "t"),
    "IfcCovering":             ("011101001", "天棚吊顶", "m²"),
    "IfcCurtainWall":          ("011202001", "幕墙", "m²"),
    "IfcPipeSegment":          ("031001001", "给排水管道安装", "m"),
    "IfcPipeFitting":          ("031003001", "阀门管件安装", "个"),
    "IfcDuctSegment":          ("030701001", "风管制作安装", "m²"),
    "IfcDuctFitting":          ("030701002", "风管管件安装", "个"),
    "IfcCableCarrierSegment":  ("030404001", "电缆桥架安装", "m"),
    "IfcCableCarrierFitting":  ("030404002", "桥架配件安装", "个"),
}

IFC_CLASS_LABELS: dict[str, str] = {
    "IfcColumn": "柱", "IfcBeam": "梁", "IfcWall": "墙",
    "IfcWallStandardCase": "墙", "IfcSlab": "板", "IfcFooting": "基础",
    "IfcPile": "桩", "IfcDoor": "门", "IfcWindow": "窗",
    "IfcStair": "楼梯", "IfcStairFlight": "楼梯", "IfcRoof": "屋顶",
    "IfcRailing": "栏杆", "IfcRamp": "坡道", "IfcMember": "构件",
    "IfcCovering": "覆盖层", "IfcCurtainWall": "幕墙",
    "IfcPipeSegment": "管道", "IfcPipeFitting": "管件",
    "IfcDuctSegment": "风管", "IfcDuctFitting": "风管管件",
    "IfcCableCarrierSegment": "桥架", "IfcCableCarrierFitting": "桥架配件",
    "IfcBuildingElementProxy": "通用构件", "IfcElementAssembly": "组合构件",
    "IfcPlate": "板件", "IfcDiscreteAccessory": "附属构件",
    "IfcMechanicalFastener": "连接件", "IfcReinforcingBar": "钢筋",
    "IfcReinforcingMesh": "钢筋网", "IfcFlowSegment": "管线段",
    "IfcFlowFitting": "管线管件", "IfcFlowTerminal": "末端设备",
    "IfcFlowController": "控制设备", "IfcFlowMovingDevice": "动力设备",
    "IfcFlowStorageDevice": "储存设备", "IfcFlowTreatmentDevice": "处理设备",
    "IfcDistributionElement": "安装构件",
}


def _si_prefix_scale(prefix: Any) -> float:
    value = str(prefix or "").upper()
    return {
        "EXA": 1e18,
        "PETA": 1e15,
        "TERA": 1e12,
        "GIGA": 1e9,
        "MEGA": 1e6,
        "KILO": 1e3,
        "HECTO": 1e2,
        "DECA": 1e1,
        "DECI": 1e-1,
        "CENTI": 1e-2,
        "MILLI": 1e-3,
        "MICRO": 1e-6,
        "NANO": 1e-9,
        "PICO": 1e-12,
        "FEMTO": 1e-15,
        "ATTO": 1e-18,
    }.get(value, 1.0)


def _model_unit_scales(model) -> dict[str, float]:
    """Return project unit scales to metres, square metres and cubic metres."""
    scales = {"length": 1.0, "area": 1.0, "volume": 1.0}
    try:
        projects = model.by_type("IfcProject")
        project = projects[0] if projects else None
        units_in_context = _safe_getattr(project, "UnitsInContext", None)
        for unit in (_safe_getattr(units_in_context, "Units", []) or []):
            if not hasattr(unit, "is_a") or not unit.is_a("IfcSIUnit"):
                continue
            unit_type = str(_safe_getattr(unit, "UnitType", "")).upper()
            prefix_scale = _si_prefix_scale(_safe_getattr(unit, "Prefix", None))
            if unit_type == "LENGTHUNIT":
                scales["length"] = prefix_scale
            elif unit_type == "AREAUNIT":
                scales["area"] = prefix_scale ** 2
            elif unit_type == "VOLUMEUNIT":
                scales["volume"] = prefix_scale ** 3
    except Exception:
        pass
    return scales


def _is_excluded_element(entity) -> bool:
    try:
        return any(entity.is_a(ifc_class) for ifc_class in IFC_EXCLUDED_ELEMENT_CLASSES)
    except Exception:
        return False


def _collect_physical_elements(model, diagnostics: list[str]) -> list[Any]:
    """Collect unique physical IFC elements for preview and quantity extraction."""
    entities: list[Any] = []
    try:
        entities = list(model.by_type("IfcElement"))
    except Exception:
        entities = []

    if not entities:
        for ifc_class in IFC_TARGET_CLASSES:
            try:
                class_entities = model.by_type(ifc_class)
            except Exception:
                class_entities = []
            entities.extend(class_entities)

    seen: set[str] = set()
    unique: list[Any] = []
    duplicates = 0
    for entity in entities:
        if _is_excluded_element(entity):
            continue
        global_id = str(_safe_getattr(entity, "GlobalId", "") or "")
        key = global_id or f"{entity.is_a() if hasattr(entity, 'is_a') else 'IfcElement'}:{id(entity)}"
        if key in seen:
            duplicates += 1
            continue
        seen.add(key)
        unique.append(entity)

    priority = {ifc_class: idx for idx, ifc_class in enumerate(IFC_PREVIEW_PRIORITY_CLASSES)}
    unique.sort(key=lambda entity: (
        priority.get(entity.is_a() if hasattr(entity, "is_a") else "", len(priority)),
        str(_safe_getattr(entity, "Name", "") or ""),
        str(_safe_getattr(entity, "GlobalId", "") or ""),
    ))
    if duplicates:
        diagnostics.append(f"已去除 {duplicates} 个 IFC 重复构件，避免墙/标准墙等继承类型重复计量。")
    return unique


def parse_ifc_bytes(data: bytes, filename: str = "model.ifc", progress_callback=None) -> dict[str, Any]:
    """Parse an IFC file from bytes. Supports .ifc and .ifczip formats. Returns a dict with elements, boq_suggestions, stats, diagnostics."""
    diagnostics: list[str] = []
    tmp_path = None
    try:
        _ensure_ifcopenshell()
        suffix = os.path.splitext(filename)[1].lower() or ".ifc"

        # Handle .ifczip (compressed IFC) by extracting the .ifc inside
        if suffix == ".ifczip":
            import zipfile
            import io as _io
            with zipfile.ZipFile(_io.BytesIO(data)) as zf:
                ifc_names = [n for n in zf.namelist() if n.lower().endswith(".ifc")]
                if not ifc_names:
                    return {
                        "elements": [], "boq_suggestions": [], "statistics": {},
                        "diagnostics": ["IFCZIP 压缩包中未找到 .ifc 文件"],
                        "schema": "", "total_elements": 0,
                        "error": "IFCZIP 压缩包中未找到 .ifc 文件",
                    }
                data = zf.read(ifc_names[0])
                if len(ifc_names) > 1:
                    diagnostics.append(f"IFCZIP 包含多个 .ifc 文件，使用: {ifc_names[0]}")
                suffix = ".ifc"

        tmp = tempfile.NamedTemporaryFile(suffix=suffix, delete=False)
        tmp.write(data)
        tmp_path = tmp.name
        tmp.close()

        model = ifcopenshell.open(tmp_path)
        schema = model.schema
        diagnostics.append(f"IFC schema: {schema}")
        unit_scales = _model_unit_scales(model)

        elements_by_class: dict[str, list[dict[str, Any]]] = {}
        total_elements = 0
        preview_mesh_attempts = 0
        preview_mesh_attempts_by_class: dict[str, int] = {}
        entities = _collect_physical_elements(model, diagnostics)
        total_candidates = len(entities)
        if total_candidates > IFC_MAX_ELEMENTS:
            diagnostics.append(
                f"IFC 物理构件共 {total_candidates} 个，当前仅解析前 {IFC_MAX_ELEMENTS} 个以保护系统稳定；"
                "可通过 IFC_MAX_ELEMENTS 调整。"
            )
            entities = entities[:IFC_MAX_ELEMENTS]

        for ei, entity in enumerate(entities):
            try:
                ifc_class = entity.is_a() if hasattr(entity, "is_a") else "IfcElement"
                label = IFC_CLASS_LABELS.get(ifc_class, ifc_class)
                if progress_callback and (ei == 0 or ei % 10 == 0 or ei + 1 == len(entities)):
                    progress_callback(f"正在解析{label} {ei + 1}/{len(entities)}")
                elem = _extract_element(entity, model, unit_scales)
                if IFC_ENABLE_PREVIEW_MESH and _should_extract_preview_mesh(
                    ifc_class,
                    preview_mesh_attempts,
                    preview_mesh_attempts_by_class,
                ):
                    preview_mesh_attempts += 1
                    preview_mesh_attempts_by_class[ifc_class] = preview_mesh_attempts_by_class.get(ifc_class, 0) + 1
                    if progress_callback and (ei == 0 or ei % 10 == 0):
                        progress_callback(
                            f"正在生成真实3D预览网格 {preview_mesh_attempts}/{min(IFC_PREVIEW_MESH_ELEMENTS, len(entities))}"
                        )
                    elem.update(_extract_preview_mesh(entity))
                elements_by_class.setdefault(ifc_class, []).append(elem)
                total_elements += 1
            except Exception as e:
                diagnostics.append(f"Warning: failed to parse {getattr(entity, 'GlobalId', '?')}: {e}")

        if total_elements == 0:
            diagnostics.append("未找到可识别的IFC构件")

        if progress_callback:
            progress_callback("正在汇总构件并生成清单建议...")
        preview_elements = _select_preview_elements(elements_by_class, IFC_PREVIEW_ELEMENTS)
        aggregated = _aggregate_elements(elements_by_class)
        boq_suggestions = _build_boq_suggestions(aggregated)
        mesh_element_count = sum(1 for item in preview_elements if item.get("mesh_kind") == "mesh")

        stats: dict[str, int] = {}
        for ifc_class, items in elements_by_class.items():
            label = IFC_CLASS_LABELS.get(ifc_class, ifc_class)
            stats[label] = stats.get(label, 0) + len(items)

        if len(preview_elements) < total_elements:
            diagnostics.append(
                f"3D 预览已按上限返回 {len(preview_elements)} / {total_elements} 个构件；"
                "可通过 IFC_PREVIEW_ELEMENTS 调整。"
            )

        return {
            "elements": aggregated,
            "preview_elements": preview_elements,
            "boq_suggestions": boq_suggestions,
            "statistics": stats,
            "diagnostics": diagnostics,
            "schema": schema,
            "total_elements": total_elements,
            "detail_element_count": total_elements,
            "preview_element_count": len(preview_elements),
            "aggregated_element_count": len(aggregated),
            "mesh_element_count": mesh_element_count,
        }
    except Exception as e:
        return {
            "elements": [],
            "boq_suggestions": [],
            "statistics": {},
            "diagnostics": [f"IFC解析失败: {e}"],
            "schema": "",
            "total_elements": 0,
            "error": str(e),
        }
    finally:
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.unlink(tmp_path)
            except OSError:
                pass


def _should_extract_preview_mesh(
    ifc_class: str,
    total_attempts: int,
    attempts_by_class: dict[str, int],
) -> bool:
    """Keep one IFC class from consuming the whole browser mesh budget."""
    if total_attempts >= IFC_PREVIEW_MESH_ELEMENTS:
        return False
    return attempts_by_class.get(ifc_class, 0) < IFC_PREVIEW_MESH_PER_CLASS


def _select_preview_elements(
    elements_by_class: dict[str, list[dict[str, Any]]],
    max_elements: int,
) -> list[dict[str, Any]]:
    """Build a balanced 3D preview list so large models still show all major trades."""
    if max_elements <= 0:
        return []

    class_order = [
        ifc_class
        for ifc_class in IFC_PREVIEW_PRIORITY_CLASSES
        if elements_by_class.get(ifc_class)
    ]
    class_order.extend(
        ifc_class
        for ifc_class in IFC_TARGET_CLASSES
        if ifc_class not in class_order and elements_by_class.get(ifc_class)
    )
    class_order.extend(
        ifc_class
        for ifc_class in elements_by_class
        if ifc_class not in class_order and elements_by_class.get(ifc_class)
    )
    if not class_order:
        return []

    buckets = [
        sorted(
            elements_by_class[ifc_class],
            key=lambda item: 0 if item.get("mesh_kind") == "mesh" else 1,
        )
        for ifc_class in class_order
    ]
    total = sum(len(bucket) for bucket in buckets)
    if total <= max_elements:
        return [element for bucket in buckets for element in bucket]

    selected: list[dict[str, Any]] = []
    offsets = [0 for _ in buckets]
    first_pass_quota = max(1, min(120, max_elements // max(len(buckets), 1)))

    for index, bucket in enumerate(buckets):
        take = min(first_pass_quota, len(bucket), max_elements - len(selected))
        if take <= 0:
            break
        selected.extend(bucket[:take])
        offsets[index] = take

    while len(selected) < max_elements:
        added = False
        for index, bucket in enumerate(buckets):
            if offsets[index] >= len(bucket):
                continue
            selected.append(bucket[offsets[index]])
            offsets[index] += 1
            added = True
            if len(selected) >= max_elements:
                break
        if not added:
            break

    return selected


def _extract_element(entity, model, unit_scales: dict[str, float] | None = None) -> dict[str, Any]:
    """Extract all relevant data from a single IFC element."""
    ifc_class = entity.is_a()
    global_id = _safe_getattr(entity, "GlobalId")
    name = _safe_getattr(entity, "Name") or ""
    description = _safe_getattr(entity, "Description") or ""
    predefined_type = _safe_getattr(entity, "PredefinedType") or ""
    object_type = _safe_getattr(entity, "ObjectType") or ""

    # Property sets
    psets = {}
    try:
        psets = ifcopenshell.util.element.get_psets(entity)
    except Exception:
        pass

    # Dimensions
    dimensions = _extract_dimensions(entity, model, psets, unit_scales)

    # Material
    material = _extract_material(entity, model)

    # Quantity computation
    quantity, unit = _compute_quantity(ifc_class, dimensions, psets)

    # Element label for display
    element_type = _build_element_label(ifc_class, name, dimensions, predefined_type)

    # Position from ObjectPlacement
    pos_x, pos_y, pos_z = _extract_position(entity, unit_scales)

    return {
        "id": global_id,
        "type": ifc_class,
        "label": IFC_CLASS_LABELS.get(ifc_class, ifc_class),
        "name": name or f"{IFC_CLASS_LABELS.get(ifc_class, ifc_class)}-{global_id[:8]}",
        "element_type": element_type,
        "predefined_type": str(predefined_type),
        "object_type": str(object_type),
        "description": str(description),
        "material": material,
        "length": round(dimensions.get("length", 0), 3),
        "width": round(dimensions.get("width", 0), 3),
        "height": round(dimensions.get("height", 0), 3),
        "thickness": round(dimensions.get("thickness", 0), 3),
        "area": round(dimensions.get("area", 0), 4),
        "volume": round(dimensions.get("volume", 0), 4),
        "unit": unit,
        "quantity_estimate": round(quantity, 4),
        "confidence": 95.0,
        "pset_keys": list(psets.keys()),
        "pos_x": round(pos_x, 3),
        "pos_y": round(pos_y, 3),
        "pos_z": round(pos_z, 3),
    }


def _extract_dimensions(entity, model, psets: dict, unit_scales: dict[str, float] | None = None) -> dict[str, float]:
    """Extract dimensional data from quantity sets, property sets, and geometry."""
    dims: dict[str, float] = {
        "length": 0, "width": 0, "height": 0,
        "thickness": 0, "area": 0, "volume": 0,
        "diameter": 0,
    }

    # Try quantity sets first
    try:
        qsets = ifcopenshell.util.element.get_psets(entity, qtos_only=True)
        for qset_name, props in qsets.items():
            for prop_name, value in props.items():
                v = _safe_float(value)
                if v <= 0:
                    continue
                key = prop_name.lower()
                if "length" in key or key in ("depth", "span"):
                    if dims["length"] == 0:
                        dims["length"] = v
                elif "width" in key or "breadth" in key:
                    if dims["width"] == 0:
                        dims["width"] = v
                elif "height" in key or "rise" in key:
                    if dims["height"] == 0:
                        dims["height"] = v
                elif "thickness" in key:
                    if dims["thickness"] == 0:
                        dims["thickness"] = v
                elif "area" in key:
                    if dims["area"] == 0:
                        dims["area"] = v
                elif "volume" in key:
                    if dims["volume"] == 0:
                        dims["volume"] = v
                elif "diameter" in key:
                    dims["diameter"] = v
                elif "net" in key and "area" in key:
                    if dims["area"] == 0:
                        dims["area"] = v
    except Exception:
        pass

    # Try property sets for dimensions not yet found
    try:
        for pset_name, props in psets.items():
            for prop_name, value in props.items():
                v = _safe_float(value)
                if v <= 0:
                    continue
                key_lower = prop_name.lower()
                if "thickness" in key_lower and dims["thickness"] == 0:
                    dims["thickness"] = v
                elif "area" in key_lower and dims["area"] == 0:
                    dims["area"] = v
                elif "volume" in key_lower and dims["volume"] == 0:
                    dims["volume"] = v
    except Exception:
        pass

    _apply_unit_scales(dims, unit_scales)

    # Estimate from geometry if dimensions are still zero
    if all(dims[k] == 0 for k in ("length", "width", "height", "area", "volume")):
        try:
            geom_dims = _estimate_from_representation(entity, model, unit_scales)
            for k, v in geom_dims.items():
                if dims.get(k, 0) == 0 and v > 0:
                    dims[k] = v
        except Exception:
            pass

    # ifcopenshell.geom can be very expensive and may crash on malformed IFC.
    # Keep it opt-in so one uploaded model cannot make the whole backend unavailable.
    if IFC_ENABLE_GEOMETRY_FALLBACK and all(dims[k] == 0 for k in ("length", "width", "height", "area", "volume")):
        try:
            geom_dims = _estimate_from_geom_shape(entity, model)
            for k, v in geom_dims.items():
                if dims.get(k, 0) == 0 and v > 0:
                    dims[k] = v
        except Exception:
            pass

    return dims


def _apply_unit_scales(dims: dict[str, float], unit_scales: dict[str, float] | None) -> None:
    if not unit_scales:
        return
    length_scale = unit_scales.get("length", 1.0)
    area_scale = unit_scales.get("area", length_scale ** 2)
    volume_scale = unit_scales.get("volume", length_scale ** 3)
    for key in ("length", "width", "height", "thickness", "diameter"):
        if dims.get(key, 0) > 0:
            dims[key] *= length_scale
    if dims.get("area", 0) > 0:
        dims["area"] *= area_scale
    if dims.get("volume", 0) > 0:
        dims["volume"] *= volume_scale


def _estimate_from_representation(entity, model, unit_scales: dict[str, float] | None = None) -> dict[str, float]:
    """Estimate dimensions from IFC representation (extruded solids, bounding boxes)."""
    result: dict[str, float] = {}
    try:
        rep = _safe_getattr(entity, "Representation", None)
        if rep is None:
            return result

        length_scale = (unit_scales or {}).get("length", 1.0)
        area_scale = length_scale ** 2
        representations = _safe_getattr(rep, "Representations", []) or []
        for item in representations:
            for sub in (_safe_getattr(item, "Items", []) or []):
                sub_type = sub.is_a() if hasattr(sub, "is_a") else ""
                if sub_type == "IfcExtrudedAreaSolid":
                    depth = _safe_getattr(sub, "Depth", 0.0)
                    result["height"] = _safe_float(depth) * length_scale
                    profile = _safe_getattr(sub, "SweptArea", None)
                    if profile is not None:
                        profile_type = profile.is_a() if hasattr(profile, "is_a") else ""
                        if profile_type == "IfcRectangleProfileDef":
                            w = _safe_float(_safe_getattr(profile, "XDim", 0)) * length_scale
                            h = _safe_float(_safe_getattr(profile, "YDim", 0)) * length_scale
                            result["width"] = w
                            result["length"] = h
                        elif profile_type == "IfcCircleProfileDef":
                            r = _safe_float(_safe_getattr(profile, "Radius", 0)) * length_scale
                            if r > 0:
                                result["diameter"] = r * 2
                                result["width"] = r * 2
                                result["length"] = r * 2
                        area = _safe_float(_safe_getattr(profile, "Area", 0))
                        if area > 0:
                            result["area"] = area * area_scale
                elif sub_type == "IfcMappedItem":
                    mapping_source = _safe_getattr(sub, "MappingSource", None)
                    if mapping_source:
                        mapped_rep = _safe_getattr(mapping_source, "MappedRepresentation", None)
                        if mapped_rep:
                            for mapped_item in (_safe_getattr(mapped_rep, "Items", []) or []):
                                if hasattr(mapped_item, "is_a") and mapped_item.is_a("IfcExtrudedAreaSolid"):
                                    depth = _safe_getattr(mapped_item, "Depth", 0.0)
                                    if result.get("height", 0) == 0:
                                        result["height"] = _safe_float(depth) * length_scale
                elif sub_type in ("IfcFacetedBrep", "IfcShellBasedSurfaceModel", "IfcFaceBasedSurfaceModel"):
                    pass  # handled by geom fallback
                elif sub_type == "IfcBoundingBox":
                    x = _safe_float(_safe_getattr(sub, "XDim", 0)) * length_scale
                    y = _safe_float(_safe_getattr(sub, "YDim", 0)) * length_scale
                    z = _safe_float(_safe_getattr(sub, "ZDim", 0)) * length_scale
                    if x > 0 and result.get("length", 0) == 0:
                        result["length"] = x
                    if y > 0 and result.get("width", 0) == 0:
                        result["width"] = y
                    if z > 0 and result.get("height", 0) == 0:
                        result["height"] = z
    except Exception:
        pass
    return result


def _estimate_from_geom_shape(entity, model) -> dict[str, float]:
    """Use ifcopenshell.geom to compute volume, surface area, and bounding box.

    This is the most reliable fallback when quantity sets and property sets
    are absent from the IFC file.
    """
    result: dict[str, float] = {}
    try:
        ifcopenshell.geom.settings.ITERATOR_OUTPUT = ifcopenshell.ifcopenshell_wrapper.SERIALIZED
        shape = ifcopenshell.geom.create_shape(ifcopenshell.geom.settings(), entity)
        if not shape:
            return result

        geom = shape.geometry
        verts = ifcopenshell.ifcopenshell_wrapper.get_vertices(geom)
        if verts is None or len(verts) < 3:
            return result

        n = len(verts)
        xs = [verts[i] for i in range(0, n, 3)]
        ys = [verts[i] for i in range(1, n, 3)]
        zs = [verts[i] for i in range(2, n, 3)]

        min_x, max_x = min(xs), max(xs)
        min_y, max_y = min(ys), max(ys)
        min_z, max_z = min(zs), max(zs)

        length = max_x - min_x
        width = max_y - min_y
        height = max_z - min_z

        if length > 0:
            result["length"] = round(length, 3)
        if width > 0:
            result["width"] = round(width, 3)
        if height > 0:
            result["height"] = round(height, 3)

        # Volume from geometry
        vol = ifcopenshell.ifcopenshell_wrapper.get_volume(geom)
        if vol > 0:
            result["volume"] = round(vol, 4)

        # Surface area
        area = ifcopenshell.ifcopenshell_wrapper.get_surface_area(geom)
        if area > 0:
            result["area"] = round(area, 4)
    except Exception:
        pass
    return result


def _extract_preview_mesh(entity) -> dict[str, Any]:
    """Extract a bounded triangle mesh for the browser preview.

    The parser runs in an isolated subprocess, so using ifcopenshell.geom here
    cannot take down the API process. The payload is still capped because IFC
    element meshes can be very large.
    """
    try:
        settings = ifcopenshell.geom.settings()
        try:
            settings.set(settings.USE_WORLD_COORDS, True)
        except Exception:
            try:
                settings.set("USE_WORLD_COORDS", True)
            except Exception:
                pass

        shape = ifcopenshell.geom.create_shape(settings, entity)
        if not shape:
            return {"mesh_kind": "box"}

        geometry = shape.geometry
        raw_vertices = None
        raw_faces = None

        if ifcopenshell_shape_util is not None:
            try:
                raw_vertices = ifcopenshell_shape_util.get_vertices(geometry)
                raw_faces = ifcopenshell_shape_util.get_faces(geometry)
            except Exception:
                raw_vertices = None
                raw_faces = None

        if raw_vertices is None:
            raw_vertices = getattr(geometry, "verts", None)
        if raw_faces is None:
            raw_faces = getattr(geometry, "faces", None)

        if raw_vertices is None:
            try:
                raw_vertices = ifcopenshell.ifcopenshell_wrapper.get_vertices(geometry)
            except Exception:
                raw_vertices = None
        if raw_faces is None:
            try:
                raw_faces = ifcopenshell.ifcopenshell_wrapper.get_faces(geometry)
            except Exception:
                raw_faces = None

        vertices = _flatten_numbers(raw_vertices, float)
        indices = _flatten_numbers(raw_faces, int)
        vertex_count = len(vertices) // 3

        if (
            vertex_count < 3
            or len(vertices) % 3 != 0
            or len(indices) < 3
            or len(indices) % 3 != 0
            or vertex_count > IFC_PREVIEW_MAX_VERTICES_PER_ELEMENT
            or max(indices, default=-1) >= vertex_count
            or min(indices, default=0) < 0
        ):
            return {"mesh_kind": "box"}

        return {
            "mesh_vertices": [round(value, 5) for value in vertices],
            "mesh_indices": indices,
            "mesh_kind": "mesh",
        }
    except Exception:
        return {"mesh_kind": "box"}


def _flatten_numbers(values, cast):
    result = []

    def walk(value) -> None:
        if value is None or isinstance(value, (str, bytes)):
            return
        if not isinstance(value, (int, float)):
            try:
                iterator = iter(value)
            except TypeError:
                iterator = None
            if iterator is not None:
                for item in iterator:
                    walk(item)
                return
        try:
            result.append(cast(value))
        except (TypeError, ValueError, OverflowError):
            return

    walk(values)
    return result


def _extract_material(entity, model) -> str:
    """Extract material name from an IFC element."""
    try:
        associations = _safe_getattr(entity, "HasAssociations", [])
        if not associations:
            return ""
        for rel in associations:
            if rel.is_a("IfcRelAssociatesMaterial"):
                mat_select = rel.RelatingMaterial
                if mat_select.is_a("IfcMaterial"):
                    return str(_safe_getattr(mat_select, "Name") or "")
                elif mat_select.is_a("IfcMaterialLayerSetUsage"):
                    layers = _safe_getattr(mat_select, "ForLayerSet", None)
                    if layers:
                        layer_names = [
                            str(_safe_getattr(_safe_getattr(l, "Material", None), "Name") or "")
                            for l in (_safe_getattr(layers, "MaterialLayers", []) or [])
                            if _safe_getattr(l, "Material", None)
                        ]
                        if layer_names:
                            return "+".join(layer_names)
                elif mat_select.is_a("IfcMaterialList"):
                    mat_names = [
                        str(_safe_getattr(m, "Name") or "")
                        for m in (_safe_getattr(mat_select, "Materials", []) or [])
                    ]
                    if mat_names:
                        return "+".join(mat_names)
                elif mat_select.is_a("IfcMaterialProfileSetUsage"):
                    profile_set = _safe_getattr(mat_select, "ForProfileSet", None)
                    if profile_set:
                        mat_names = [
                            str(_safe_getattr(_safe_getattr(mp, "Material", None), "Name") or "")
                            for mp in (_safe_getattr(profile_set, "MaterialProfiles", []) or [])
                            if _safe_getattr(mp, "Material", None)
                        ]
                        if mat_names:
                            return "+".join(mat_names)
    except Exception:
        pass
    return ""


def _extract_position(entity, unit_scales: dict[str, float] | None = None) -> tuple[float, float, float]:
    """Extract the (x, y, z) world position from an IFC element's ObjectPlacement."""
    length_scale = (unit_scales or {}).get("length", 1.0)
    try:
        placement = _safe_getattr(entity, "ObjectPlacement", None)
        if placement is None:
            return 0.0, 0.0, 0.0
        try:
            matrix = ifcopenshell.util.placement.get_local_placement(placement)
            return (
                float(matrix[0][3]) * length_scale,
                float(matrix[1][3]) * length_scale,
                float(matrix[2][3]) * length_scale,
            )
        except Exception:
            pass
        x, y, z = _extract_placement_chain_position(placement)
        return x * length_scale, y * length_scale, z * length_scale
    except Exception:
        return 0.0, 0.0, 0.0


def _extract_placement_chain_position(placement) -> tuple[float, float, float]:
    x = y = z = 0.0
    current = placement
    guard = 0
    while current is not None and guard < 32:
        guard += 1
        rel_placement = _safe_getattr(current, "RelativePlacement", None)
        location = _safe_getattr(rel_placement, "Location", None)
        coords = _safe_getattr(location, "Coordinates", None)
        if coords and len(coords) >= 3:
            x += _safe_float(coords[0])
            y += _safe_float(coords[1])
            z += _safe_float(coords[2])
        current = _safe_getattr(current, "PlacementRelTo", None)
    return x, y, z


def _compute_quantity(ifc_class: str, dims: dict[str, float], psets: dict) -> tuple[float, str]:
    """Compute estimated quantity and unit based on element type.

    Priority:
    1. Direct quantity from dimension extraction (volume/area/length)
    2. Estimate from other dimensions (e.g. vol = l*w*h)
    3. Default minimum quantity so results are never zero
    """
    volume_based = {
        "IfcColumn", "IfcBeam", "IfcWall", "IfcWallStandardCase",
        "IfcFooting", "IfcPile", "IfcMember",
    }
    area_based = {
        "IfcSlab", "IfcDoor", "IfcWindow", "IfcCovering",
        "IfcCurtainWall", "IfcRoof", "IfcStair", "IfcStairFlight",
        "IfcRamp", "IfcDuctSegment",
    }
    length_based = {
        "IfcRailing", "IfcPipeSegment", "IfcCableCarrierSegment",
    }
    count_based = {
        "IfcPipeFitting", "IfcDuctFitting", "IfcCableCarrierFitting",
    }

    l, w, h, t = dims.get("length", 0), dims.get("width", 0), dims.get("height", 0), dims.get("thickness", 0)
    vol = dims.get("volume", 0)
    area = dims.get("area", 0)
    diameter = dims.get("diameter", 0)

    # Use direct measurements first
    if vol > 0 and ifc_class in volume_based:
        return vol, "m³"
    if area > 0 and ifc_class in area_based:
        return area, "m²"
    if l > 0 and ifc_class in length_based:
        return l, "m"

    # Estimate from dimensional combinations
    if ifc_class in volume_based:
        if vol <= 0:
            if l > 0 and w > 0 and h > 0:
                vol = l * w * h
            elif l > 0 and w > 0 and t > 0:
                vol = l * w * t
            elif diameter > 0 and h > 0:
                vol = 3.14159 * (diameter / 2) ** 2 * h
            elif l > 0 and w > 0:
                vol = l * w * 0.3  # assume 300mm thickness as fallback
            elif area > 0 and t > 0:
                vol = area * t
        return (round(vol, 4), "m³") if vol > 0 else (0.001, "m³")

    if ifc_class in area_based:
        if area <= 0:
            if l > 0 and w > 0:
                area = l * w
            elif l > 0 and t > 0:
                area = l * t
            elif l > 0:
                area = l * 0.3  # assume 300mm width as fallback
            elif vol > 0 and t > 0:
                area = vol / t
            elif vol > 0:
                area = vol / 0.2
        return (round(area, 4), "m²") if area > 0 else (0.001, "m²")

    if ifc_class in length_based:
        if l <= 0:
            if h > 0:
                l = h
            elif diameter > 0:
                l = diameter
            else:
                l = max(w, h, t, 0.3)
        return (round(l, 4), "m") if l > 0 else (0.001, "m")

    # Count-based (fittings, etc.)
    return 1.0, "个"


def _build_element_label(ifc_class: str, name: str, dims: dict[str, float], predefined_type: str) -> str:
    """Build a human-readable element label like 'KZ1 600x600x3000'."""
    parts = [name] if name else [IFC_CLASS_LABELS.get(ifc_class, ifc_class)]
    if predefined_type:
        parts.append(str(predefined_type))
    dim_str = _format_dims_for_label(ifc_class, dims)
    if dim_str:
        parts.append(dim_str)
    return " ".join(parts[-3:])  # Keep it short


def _format_dims_for_label(ifc_class: str, dims: dict[str, float]) -> str:
    """Format dimensions for display label."""
    subs = []
    for k in ("width", "length", "height", "thickness"):
        v = dims.get(k, 0)
        if v > 0:
            subs.append(str(int(v * 1000)))
    if not subs:
        area = dims.get("area", 0)
        if area > 0:
            return f"{area:.2f}m²"
        return ""
    return "x".join(subs)


def _safe_getattr(entity, name: str, default=""):
    """Safely get an attribute from an IFC entity, returning default on any error."""
    try:
        val = getattr(entity, name, default)
        return val if val is not None else default
    except Exception:
        return default


def _safe_float(value) -> float:
    """Safely convert a value to float."""
    if value is None:
        return 0.0
    try:
        return float(value)
    except (ValueError, TypeError):
        return 0.0


def _aggregate_elements(elements_by_class: dict[str, list[dict[str, Any]]]) -> list[dict[str, Any]]:
    """Aggregate elements by type + material + spec, counting duplicates."""
    groups: dict[tuple[str, str, str, str], dict[str, Any]] = {}

    for ifc_class, elements in elements_by_class.items():
        for elem in elements:
            key = (
                ifc_class,
                elem["element_type"],
                elem["material"],
                elem["unit"],
            )
            if key in groups:
                groups[key]["count"] += 1
                groups[key]["quantity_estimate"] += elem["quantity_estimate"]
            else:
                elem_copy = dict(elem)
                elem_copy["count"] = 1
                groups[key] = elem_copy

    return sorted(groups.values(), key=lambda e: e["label"])


def _build_boq_suggestions(elements: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Map aggregated elements to GB50500 BOQ suggestions."""
    suggestions = []
    for i, elem in enumerate(elements):
        ifc_class = elem["type"]
        code, name, unit = IFC_TO_GB50500.get(ifc_class, ("", "", ""))
        if not code:
            continue

        characteristics = _build_characteristics(elem, ifc_class)

        suggestions.append({
            "source_element_id": f"{ifc_class}_{i}",
            "suggested_code": code,
            "suggested_name": name,
            "suggested_unit": unit,
            "suggested_quantity": round(elem["quantity_estimate"], 4),
            "characteristics": characteristics,
            "confidence": 85.0,
            "material": elem.get("material", ""),
            "element_count": elem.get("count", 1),
        })
    return suggestions


def _build_characteristics(elem: dict[str, Any], ifc_class: str) -> str:
    """Build characteristics string for BOQ item description."""
    parts = []
    dims_str = _format_dims_for_label(ifc_class, {
        "width": elem.get("width", 0),
        "length": elem.get("length", 0),
        "height": elem.get("height", 0),
        "thickness": elem.get("thickness", 0),
    })
    if dims_str:
        parts.append(dims_str)
    mat = elem.get("material", "")
    if mat:
        parts.append(mat)
    elem_type = elem.get("element_type", "")
    if elem_type:
        parts.append(elem_type)
    return "、".join(parts) if parts else ifc_class
