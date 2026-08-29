"""
广联达数据映射层
将广联达返回的结构化数据映射为zjcost项目内部的构件数据格式
"""
import logging
from typing import Dict, List, Any, Optional
from dataclasses import dataclass, field
from enum import Enum

logger = logging.getLogger(__name__)


class ComponentType(Enum):
    """构件类型枚举"""
    COLUMN = "column"      # 柱
    BEAM = "beam"          # 梁
    SLAB = "slab"          # 板
    WALL = "wall"          # 墙
    DOOR = "door"          # 门
    WINDOW = "window"      # 窗
    STAIR = "stair"        # 楼梯
    OTHER = "other"        # 其他


@dataclass
class Point:
    """坐标点"""
    x: float
    y: float
    z: float = 0.0


@dataclass
class BoundingBox:
    """边界框"""
    min_x: float
    min_y: float
    max_x: float
    max_y: float


@dataclass
class SheetFrame:
    """图框信息"""
    sheet_id: str
    sheet_name: str
    sheet_number: str
    bounding_box: BoundingBox
    scale: str = ""
    designer: str = ""
    date: str = ""


@dataclass
class FloorInfo:
    """楼层信息"""
    floor_id: str
    floor_name: str
    floor_number: int
    elevation: float = 0.0
    height: float = 0.0


@dataclass
class Component:
    """基础构件数据（内部统一格式）"""
    component_id: str
    component_type: ComponentType
    component_name: str
    layer: str
    floor: str
    bounding_box: BoundingBox
    points: List[Point] = field(default_factory=list)
    properties: Dict[str, Any] = field(default_factory=dict)
    material: str = ""
    thickness: float = 0.0
    width: float = 0.0
    height: float = 0.0
    length: float = 0.0
    area: float = 0.0
    volume: float = 0.0


@dataclass
class DrawingResult:
    """图纸识别完整结果"""
    file_id: str
    sheet_frames: List[SheetFrame] = field(default_factory=list)
    floors: List[FloorInfo] = field(default_factory=list)
    components: List[Component] = field(default_factory=list)
    raw_data: Dict[str, Any] = field(default_factory=dict)
    metadata: Dict[str, Any] = field(default_factory=dict)


class GlodonDataMapper:
    """
    广联达数据映射器
    将广联达API返回的数据转换为zjcost内部统一格式
    """
    
    @staticmethod
    def map_bounding_box(raw_box: Dict[str, Any]) -> BoundingBox:
        """
        映射边界框
        
        Args:
            raw_box: 广联达原始边界框数据
            
        Returns:
            标准化边界框
        """
        return BoundingBox(
            min_x=float(raw_box.get("minX", raw_box.get("x", 0))),
            min_y=float(raw_box.get("minY", raw_box.get("y", 0))),
            max_x=float(raw_box.get("maxX", raw_box.get("x", 0) + raw_box.get("width", 0))),
            max_y=float(raw_box.get("maxY", raw_box.get("y", 0) + raw_box.get("height", 0)))
        )
    
    @staticmethod
    def map_point(raw_point: Dict[str, Any]) -> Point:
        """
        映射坐标点
        
        Args:
            raw_point: 原始点数据
            
        Returns:
            标准化点
        """
        return Point(
            x=float(raw_point.get("x", 0)),
            y=float(raw_point.get("y", 0)),
            z=float(raw_point.get("z", 0))
        )
    
    @staticmethod
    def map_sheet_frame(raw_sheet: Dict[str, Any]) -> SheetFrame:
        """
        映射图框信息
        
        Args:
            raw_sheet: 广联达原始图框数据
            
        Returns:
            标准化图框信息
        """
        bounding_box = raw_sheet.get("boundingBox", {})
        
        return SheetFrame(
            sheet_id=str(raw_sheet.get("id", raw_sheet.get("sheetId", ""))),
            sheet_name=raw_sheet.get("name", raw_sheet.get("sheetName", "")),
            sheet_number=raw_sheet.get("number", raw_sheet.get("sheetNumber", "")),
            bounding_box=GlodonDataMapper.map_bounding_box(bounding_box),
            scale=raw_sheet.get("scale", ""),
            designer=raw_sheet.get("designer", ""),
            date=raw_sheet.get("date", "")
        )
    
    @staticmethod
    def map_floor(raw_floor: Dict[str, Any]) -> FloorInfo:
        """
        映射楼层信息
        
        Args:
            raw_floor: 广联达原始楼层数据
            
        Returns:
            标准化楼层信息
        """
        return FloorInfo(
            floor_id=str(raw_floor.get("id", raw_floor.get("floorId", ""))),
            floor_name=raw_floor.get("name", raw_floor.get("floorName", "")),
            floor_number=int(raw_floor.get("number", raw_floor.get("floorNumber", 0))),
            elevation=float(raw_floor.get("elevation", 0)),
            height=float(raw_floor.get("height", raw_floor.get("floorHeight", 0)))
        )
    
    @staticmethod
    def detect_component_type(raw_component: Dict[str, Any]) -> ComponentType:
        """
        检测构件类型
        
        Args:
            raw_component: 原始构件数据
            
        Returns:
            构件类型
        """
        name = raw_component.get("name", "").lower()
        layer = raw_component.get("layer", "").lower()
        category = raw_component.get("category", "").lower()
        
        # 柱检测
        if any(key in name or key in layer or key in category 
               for key in ["柱", "column", "col", "z_"]):
            return ComponentType.COLUMN
        
        # 梁检测
        if any(key in name or key in layer or key in category 
               for key in ["梁", "beam", "bm", "l_"]):
            return ComponentType.BEAM
        
        # 板检测
        if any(key in name or key in layer or key in category 
               for key in ["板", "slab", "floor", "b_"]):
            return ComponentType.SLAB
        
        # 墙检测
        if any(key in name or key in layer or key in category 
               for key in ["墙", "wall", "w_"]):
            return ComponentType.WALL
        
        # 门检测
        if any(key in name or key in layer or key in category 
               for key in ["门", "door", "m_"]):
            return ComponentType.DOOR
        
        # 窗检测
        if any(key in name or key in layer or key in category 
               for key in ["窗", "window", "c_"]):
            return ComponentType.WINDOW
        
        # 楼梯检测
        if any(key in name or key in layer or key in category 
               for key in ["楼梯", "stair", "lt_"]):
            return ComponentType.STAIR
        
        return ComponentType.OTHER
    
    @staticmethod
    def map_component(raw_component: Dict[str, Any], floor: str = "") -> Component:
        """
        映射单个构件
        
        Args:
            raw_component: 原始构件数据
            floor: 楼层名称
            
        Returns:
            标准化构件
        """
        component_type = GlodonDataMapper.detect_component_type(raw_component)
        
        # 提取几何信息
        bounding_box = raw_component.get("boundingBox", {})
        geometry = raw_component.get("geometry", {})
        properties = raw_component.get("properties", {})
        
        # 提取尺寸
        width = float(properties.get("width", raw_component.get("width", 0)))
        height = float(properties.get("height", raw_component.get("height", 0)))
        length = float(properties.get("length", raw_component.get("length", 0)))
        thickness = float(properties.get("thickness", raw_component.get("thickness", 0)))
        area = float(properties.get("area", raw_component.get("area", 0)))
        volume = float(properties.get("volume", raw_component.get("volume", 0)))
        
        # 提取点数据
        points = []
        raw_points = geometry.get("points", [])
        for p in raw_points:
            points.append(GlodonDataMapper.map_point(p))
        
        return Component(
            component_id=str(raw_component.get("id", raw_component.get("elementId", ""))),
            component_type=component_type,
            component_name=raw_component.get("name", ""),
            layer=raw_component.get("layer", ""),
            floor=floor or raw_component.get("floor", ""),
            bounding_box=GlodonDataMapper.map_bounding_box(bounding_box),
            points=points,
            properties=properties,
            material=properties.get("material", ""),
            thickness=thickness,
            width=width,
            height=height,
            length=length,
            area=area,
            volume=volume
        )
    
    @staticmethod
    def map_full_result(raw_result: Dict[str, Any], file_id: str = "") -> DrawingResult:
        """
        映射完整识别结果
        
        Args:
            raw_result: 广联达完整API返回结果
            file_id: 文件ID
            
        Returns:
            标准化图纸识别结果
        """
        logger.info("开始映射广联达识别结果...")
        
        result = DrawingResult(
            file_id=file_id,
            raw_data=raw_result
        )
        
        # 提取图框信息
        try:
            sheet_frames_data = raw_result.get("sheetFrames", [])
            if isinstance(sheet_frames_data, dict):
                sheet_frames_data = sheet_frames_data.get("data", [])
            
            for sheet_data in sheet_frames_data:
                sheet_frame = GlodonDataMapper.map_sheet_frame(sheet_data)
                result.sheet_frames.append(sheet_frame)
            
            logger.info(f"映射图框: {len(result.sheet_frames)}个")
        except Exception as e:
            logger.warning(f"映射图框信息失败: {e}")
        
        # 提取楼层表信息
        try:
            floor_table_data = raw_result.get("floorTable", [])
            if isinstance(floor_table_data, dict):
                floor_table_data = floor_table_data.get("data", [])
            
            for floor_data in floor_table_data:
                floor_info = GlodonDataMapper.map_floor(floor_data)
                result.floors.append(floor_info)
            
            logger.info(f"映射楼层: {len(result.floors)}个")
        except Exception as e:
            logger.warning(f"映射楼层信息失败: {e}")
        
        # 提取构件信息
        try:
            elements_data = raw_result.get("elements", [])
            if isinstance(elements_data, dict):
                elements_data = elements_data.get("data", [])
            
            # 按楼层分组处理
            for floor_info in result.floors:
                floor_name = floor_info.floor_name
                # 这里简化处理，实际需要根据楼层过滤构件
                for elem_data in elements_data:
                    component = GlodonDataMapper.map_component(elem_data, floor_name)
                    result.components.append(component)
            
            # 如果没有楼层信息，直接处理所有构件
            if not result.floors:
                for elem_data in elements_data:
                    component = GlodonDataMapper.map_component(elem_data)
                    result.components.append(component)
            
            logger.info(f"映射构件: {len(result.components)}个")
            
            # 统计构件类型分布
            type_counts = {}
            for comp in result.components:
                comp_type = comp.component_type.value
                type_counts[comp_type] = type_counts.get(comp_type, 0) + 1
            logger.info(f"构件类型分布: {type_counts}")
            
        except Exception as e:
            logger.warning(f"映射构件信息失败: {e}")
        
        # 提取元数据
        result.metadata = {
            "version": raw_result.get("version", ""),
            "timestamp": raw_result.get("timestamp", ""),
            "engine": "glodon_iqcad",
            "component_count": len(result.components),
            "sheet_count": len(result.sheet_frames),
            "floor_count": len(result.floors)
        }
        
        logger.info("数据映射完成")
        return result
    
    @staticmethod
    def to_dict(drawing_result: DrawingResult) -> Dict[str, Any]:
        """
        将识别结果转换为字典格式（用于API返回）
        
        Args:
            drawing_result: 识别结果
            
        Returns:
            字典格式结果
        """
        return {
            "fileId": drawing_result.file_id,
            "metadata": drawing_result.metadata,
            "sheetFrames": [
                {
                    "sheetId": sf.sheet_id,
                    "sheetName": sf.sheet_name,
                    "sheetNumber": sf.sheet_number,
                    "scale": sf.scale,
                    "designer": sf.designer,
                    "date": sf.date,
                    "boundingBox": {
                        "minX": sf.bounding_box.min_x,
                        "minY": sf.bounding_box.min_y,
                        "maxX": sf.bounding_box.max_x,
                        "maxY": sf.bounding_box.max_y
                    }
                }
                for sf in drawing_result.sheet_frames
            ],
            "floors": [
                {
                    "floorId": f.floor_id,
                    "floorName": f.floor_name,
                    "floorNumber": f.floor_number,
                    "elevation": f.elevation,
                    "height": f.height
                }
                for f in drawing_result.floors
            ],
            "components": [
                {
                    "componentId": c.component_id,
                    "componentType": c.component_type.value,
                    "componentName": c.component_name,
                    "layer": c.layer,
                    "floor": c.floor,
                    "material": c.material,
                    "thickness": c.thickness,
                    "width": c.width,
                    "height": c.height,
                    "length": c.length,
                    "area": c.area,
                    "volume": c.volume,
                    "properties": c.properties,
                    "boundingBox": {
                        "minX": c.bounding_box.min_x,
                        "minY": c.bounding_box.min_y,
                        "maxX": c.bounding_box.max_x,
                        "maxY": c.bounding_box.max_y
                    },
                    "points": [
                        {"x": p.x, "y": p.y, "z": p.z}
                        for p in c.points
                    ]
                }
                for c in drawing_result.components
            ]
        }
