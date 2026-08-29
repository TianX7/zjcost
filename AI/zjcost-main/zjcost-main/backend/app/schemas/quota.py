from pydantic import BaseModel, Field


class QuotaItemOut(BaseModel):
    id: int
    quota_code: str
    discipline: str = "土建"
    name: str
    unit: str
    chapter: str = ""
    labor_qty: float
    material_qty: float
    machine_qty: float
    base_price: float = 0


class QuotaWorkbookSheetOut(BaseModel):
    name: str
    index: int
    rows: int
    columns: int
    importable: bool
    matched_headers: list[str] = Field(default_factory=list)
    inferred_discipline: str = "土建"


class QuotaWorkbookInspectResult(BaseModel):
    total_sheets: int
    importable_sheets: int
    sheets: list[QuotaWorkbookSheetOut]


class QuotaImportResult(BaseModel):
    imported: int
    skipped: int
    items: list[QuotaItemOut]
    created: int = 0
    updated: int = 0
    discipline: str = "土建"


class BindingRequest(BaseModel):
    quota_item_id: int
    coefficient: float = 1.0


class BindingPair(BaseModel):
    boq_item_id: int
    quota_item_id: int
    coefficient: float = 1.0


class BatchBindingRequest(BaseModel):
    bindings: list[BindingPair]


class BatchReplaceBindingRequest(BaseModel):
    bindings: list[BindingPair]


class BindingOut(BaseModel):
    id: int
    boq_item_id: int
    quota_item_id: int
    coefficient: float


class BindingClearOut(BaseModel):
    boq_item_id: int
    removed: int


class BindingWithQuota(BaseModel):
    binding_id: int
    boq_item_id: int
    quota_item_id: int
    coefficient: float
    quota_code: str
    quota_name: str
    quota_unit: str
    labor_qty: float
    material_qty: float
    machine_qty: float
