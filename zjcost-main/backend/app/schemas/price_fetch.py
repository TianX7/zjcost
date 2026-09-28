from __future__ import annotations

from pydantic import BaseModel, Field


class PriceSourceInfo(BaseModel):
    source_name: str
    display_name: str
    available: bool
    supports_regions: list[str] = Field(default_factory=list)
    supports_categories: list[str] = Field(default_factory=list)
    last_success_at: str | None = None
    total_prices_fetched: int = 0
    error: str | None = None


class FetchRequest(BaseModel):
    source_names: list[str] | None = None
    query: str | None = None
    region: str = ""
    category: str = ""


class FetchResult(BaseModel):
    source_name: str
    fetched: int
    new_or_updated: int
    duration_s: float
    error: str | None = None


class FetchResponse(BaseModel):
    total_fetched: int
    total_new_or_updated: int
    results: list[FetchResult] = Field(default_factory=list)
    started_at: str = ""
    completed_at: str = ""


class SchedulerStatus(BaseModel):
    running: bool
    interval_hours: int
    last_fetch_at: str | None = None
    last_fetch_success: bool = False
    last_fetch_sources: int = 0
    last_fetch_count: int = 0
    last_fetch_error: str = ""
    next_fetch_at: str | None = None


class SchedulerStartRequest(BaseModel):
    interval_hours: int = 24


class ImportToMaterialPricesRequest(BaseModel):
    source_name: str
    region: str = ""
    query: str | None = None


class SourceHealthInfo(BaseModel):
    source_name: str
    display_name: str
    available: bool
    latency_ms: int = 0
    error: str | None = None


class PreviewPriceItem(BaseModel):
    name: str
    spec: str = ""
    unit: str = ""
    unit_price: float = 0
    region: str = ""
    effective_date: str = ""
    source: str = ""
    url: str = ""


class PreviewResponse(BaseModel):
    total: int
    items: list[PreviewPriceItem] = Field(default_factory=list)
    sources_tried: list[str] = Field(default_factory=list)
    duration_s: float = 0
    error: str | None = None
