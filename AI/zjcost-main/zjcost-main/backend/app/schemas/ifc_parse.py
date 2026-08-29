from __future__ import annotations

from pydantic import BaseModel, Field


class IfcElementOut(BaseModel):
    id: str
    type: str
    label: str
    name: str
    element_type: str
    predefined_type: str = ""
    object_type: str = ""
    description: str = ""
    count: int = 1
    material: str = ""
    length: float = 0.0
    width: float = 0.0
    height: float = 0.0
    thickness: float = 0.0
    area: float = 0.0
    volume: float = 0.0
    unit: str = ""
    quantity_estimate: float = 0.0
    confidence: float = 95.0
    pset_keys: list[str] = Field(default_factory=list)
    pos_x: float = 0.0
    pos_y: float = 0.0
    pos_z: float = 0.0
    mesh_vertices: list[float] = Field(default_factory=list)
    mesh_indices: list[int] = Field(default_factory=list)
    mesh_kind: str = ""


class IfcBoqSuggestionOut(BaseModel):
    source_element_id: str
    suggested_code: str
    suggested_name: str
    suggested_unit: str
    suggested_quantity: float
    characteristics: str
    confidence: float
    material: str = ""
    element_count: int = 1


class IfcTaskStatusResponse(BaseModel):
    taskId: str
    status: str  # "processing" | "done" | "error"
    summary: str = ""
    elements: list[IfcElementOut] = Field(default_factory=list)
    preview_elements: list[IfcElementOut] = Field(default_factory=list)
    boq_suggestions: list[IfcBoqSuggestionOut] = Field(default_factory=list)
    statistics: dict[str, int] = Field(default_factory=dict)
    diagnostics: list[str] = Field(default_factory=list)
    ifc_schema: str = ""
    total_elements: int = 0
    detail_element_count: int = 0
    preview_element_count: int = 0
    aggregated_element_count: int = 0
    mesh_element_count: int = 0
    error: str | None = None
    valuation: dict | None = None  # auto-valuate result (project_id, matched, grand_total, etc.)
    valuation_status: str = "idle"  # "idle" | "processing" | "done" | "error" | "skipped"
    valuation_progress: str = ""
    valuation_progress_percent: int = 0
    valuation_error: str | None = None
    progress: str = ""  # human-readable progress e.g. "正在解析柱 15/45"
    created_at: str | None = None
    updated_at: str | None = None
    timeout_seconds: int = 0


class SaveToProjectRequest(BaseModel):
    project_id: int


class SaveToProjectResponse(BaseModel):
    project_id: int
    boq_items_created: int
    boq_items: list[str] = Field(default_factory=list)
    matched: int = 0
    skipped: int = 0
    grand_total: float | None = None
