import { API_BASE, authHeaders, request, upload } from "./client";
export { API_BASE } from "./client";

// ─── SSE Stream Helper ──────────────────────────────────────────

/**
 * 发起返回二进制 Blob 的请求，并解析错误响应以便提供更友好的错误信息
 */
async function fetchBlob(url: string, init?: RequestInit): Promise<Blob> {
  const res = await fetch(url, init);
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (typeof body.detail === "string") detail = body.detail;
      else if (body.detail?.diagnostics?.length) detail = body.detail.diagnostics.join("；");
      else if (typeof body.message === "string") detail = body.message;
    } catch {
      // 响应可能不是 JSON（如纯文本错误），保持 HTTP 状态文本
    }
    throw new Error(detail);
  }
  return res.blob();
}

// ─── Types ───────────────────────────────────────────────────────

export interface Project {
  id: number; name: string; description: string | null; region: string;
  project_type: string; status: string; budget: number | null;
  start_date: string | null; end_date: string | null; owner: string | null;
  standard_type: string; language: string; currency: string;
  created_at: string | null; updated_at: string | null;
}

export interface ProjectListResponse {
  items: Project[]; total: number; page: number;
  page_size: number; total_pages: number;
}

export interface ProjectListParams {
  q?: string; status?: string; project_type?: string;
  region?: string; sort_by?: string; sort_order?: string;
  page?: number; page_size?: number;
}

export interface ProjectCreateData {
  name: string; region: string; description?: string;
  project_type?: string; budget?: number; start_date?: string;
  end_date?: string; owner?: string; standard_type?: string;
  language?: string; currency?: string;
}

export interface ProjectUpdateData {
  name?: string; description?: string; region?: string;
  project_type?: string; budget?: number; start_date?: string;
  end_date?: string; owner?: string; standard_type?: string;
  language?: string; currency?: string;
}

export interface BoqItem {
  id: number; project_id: number; code: string; name: string;
  characteristics: string; unit: string; quantity: number; division: string;
  sort_order: number; item_ref: string; trade_section: string;
  description_en: string; rate: number; amount: number; remark: string;
}
export interface BoqItemCreate {
  code: string; name: string; characteristics?: string; unit: string; quantity: number;
  division?: string; sort_order?: number; item_ref?: string; trade_section?: string;
  description_en?: string; rate?: number; remark?: string;
}
export interface BoqItemUpdate {
  name?: string; characteristics?: string; unit?: string; quantity?: number;
  division?: string; sort_order?: number; item_ref?: string; trade_section?: string;
  description_en?: string; rate?: number; remark?: string;
}

export interface ImportResult {
  imported: number;
  skipped: number;
  items: BoqItem[];
  created?: number;
  updated?: number;
  replaced?: number;
  quotas_updated?: number;
}

export interface QuotaWorkbookSheetInfo {
  name: string;
  index: number;
  rows: number;
  columns: number;
  importable: boolean;
  matched_headers: string[];
  inferred_discipline: string;
}

export interface QuotaWorkbookInspectResult {
  total_sheets: number;
  importable_sheets: number;
  sheets: QuotaWorkbookSheetInfo[];
}

export interface MatchCandidate {
  quota_item_id: number; quota_code: string; quota_name: string;
  unit: string; confidence: number; reasons: string[];
}

export interface Binding { id: number; boq_item_id: number; quota_item_id: number; coefficient: number }

export interface BindingWithQuota {
  binding_id: number;
  boq_item_id: number;
  quota_item_id: number;
  coefficient: number;
  quota_code: string;
  quota_name: string;
  quota_unit: string;
  labor_qty: number;
  material_qty: number;
  machine_qty: number;
}

export interface LineCalcResult {
  boq_item_id: number; boq_code: string; boq_name: string;
  direct_cost: number; management_fee: number; profit: number;
  regulatory_fee: number; pre_tax_total: number; tax: number; total: number;
}
export interface CalcSummary {
  total_direct: number; total_management: number; total_profit: number;
  total_regulatory: number; total_pre_tax: number; total_tax: number;
  total_measures: number; grand_total: number; line_results: LineCalcResult[];
}

export interface QuotaRef {
  quota_code: string; quota_name: string; unit: string;
  labor_qty: number; material_qty: number; machine_qty: number;
}
export interface BindingRef { binding_id: number; coefficient: number; direct_cost: number | null; quota: QuotaRef }
export interface PriceSnapshot {
  labor_price: number;
  material_price: number;
  machine_price: number;
}
export interface CalcBreakdown {
  direct_cost: number;
  management_fee: number;
  profit: number;
  regulatory_fee: number;
  pre_tax_total: number;
  tax: number;
  total: number;
}
export interface CalcProvenance {
  boq_item_id: number; boq_code: string; boq_name: string;
  boq_unit: string; boq_quantity: number; bindings: BindingRef[];
  price_snapshot: PriceSnapshot;
  calc_breakdown: CalcBreakdown | null;
  unit_price: number | null;
  calc_total: number | null; fee_config_snapshot: Record<string, number>;
  explanation: string;
}

export interface ValidationIssue {
  code: string; severity: string; boq_item_id: number | null;
  message: string; suggestion: string;
}
export interface ValidationReport {
  project_id: number; total_issues: number; errors: number;
  warnings: number; issues: ValidationIssue[];
}

export interface Snapshot {
  id: number; project_id: number; label: string;
  created_at: string; grand_total: number;
}
export interface LineDiff {
  boq_code: string; boq_name: string; change_type: string;
  old_total: number | null; new_total: number | null; delta: number;
}
export interface DiffReport {
  snapshot_a_id: number; snapshot_b_id: number;
  old_grand_total: number; new_grand_total: number; grand_total_delta: number;
  lines: LineDiff[]; explanation: string;
}

export interface RulePackage {
  id: number; name: string; region: string;
  management_rate: number; profit_rate: number; regulatory_rate: number;
  tax_rate: number; rounding_rule: string; version: string;
}
export interface RulePackageCreate {
  name: string; region?: string; management_rate?: number;
  profit_rate?: number; regulatory_rate?: number; tax_rate?: number;
}

export interface MaterialPrice {
  id: number; code: string; name: string; spec: string;
  unit: string; unit_price: number; source: string;
  region: string; effective_date: string;
}
export interface MaterialPriceCreate {
  code: string; name: string; spec?: string;
  unit: string; unit_price: number; source?: string;
  region?: string; effective_date?: string;
}

export interface MaterialPriceQuery {
  region?: string;
  name?: string;
  as_of_date?: string;
  latest_only?: boolean;
}

export interface MeasureItem {
  id: number; project_id: number; name: string;
  calc_base: string; rate: number; amount: number; is_fixed: boolean;
}
export interface MeasureItemCreate {
  name: string; calc_base?: string; rate?: number;
  amount?: number; is_fixed?: boolean;
}

export interface Member { id: number; project_id: number; user_name: string; role: string }
export interface CommentItem {
  id: number; project_id: number; boq_item_id: number | null;
  author: string; content: string; created_at: string;
}

export interface AuditLog {
  id: number; project_id: number; actor: string; action: string;
  resource_type: string; resource_id: number | null;
  before_json: string | null; after_json: string | null; timestamp: string;
}

export interface QueryHit {
  boq_item_id: number; code: string; name: string;
  unit: string; quantity: number; reason: string;
}
export interface QueryResponse { query: string; total_hits: number; hits: QueryHit[] }

export interface DivisionStat {
  division: string;
  count: number;
  cost: number;
}

export interface HealthScoreDimension {
  name: string;
  score: number;
  weight: number;
  detail: string;
}

export interface HealthScore {
  project_id: number;
  overall_score: number;
  grade: string;
  dimensions: HealthScoreDimension[];
  suggestions: string[];
}

export interface DashboardSummary {
  project_id: number;
  boq_count: number;
  unbound_count: number;
  dirty_count: number;
  validation_total: number;
  validation_errors: number;
  validation_warnings: number;
  recent_audit_count: number;
  recent_comment_count: number;
  calc_total: number;
  binding_rate: string;
  budget: number | null;
  top_divisions: DivisionStat[];
}

export interface ValuationStandardConfig {
  project_id: number;
  standard_code: string;
  standard_name: string;
  effective_date: string;
  locked: boolean;
  locked_at: string | null;
}

export interface ValuationStage {
  key: string;
  label: string;
  status: string;
  detail: string;
}

export interface ValuationOverview {
  project_id: number;
  standard: ValuationStandardConfig;
  stages: ValuationStage[];
  boq_count: number;
  measurement_count: number;
  adjustment_count: number;
  payment_count: number;
  adjustment_total: number;
  payment_net_total: number;
}

export interface ValuationStandardConfigUpdate {
  standard_code: string;
  standard_name: string;
  effective_date: string;
  lock_standard: boolean;
}

export interface ContractMeasurement {
  id: number;
  project_id: number;
  boq_item_id: number;
  boq_code: string;
  boq_name: string;
  boq_unit: string;
  period_label: string;
  measured_qty: number;
  cumulative_qty: number;
  status: string;
  approved_by: string;
  approved_at: string;
  note: string;
  created_at: string;
}

export interface ContractMeasurementCreate {
  boq_item_id: number;
  period_label: string;
  measured_qty: number;
  note?: string;
}

export interface PriceAdjustment {
  id: number;
  project_id: number;
  boq_item_id: number | null;
  boq_code: string;
  boq_name: string;
  adjustment_type: string;
  amount: number;
  status: string;
  reason: string;
  created_at: string;
}

export interface PriceAdjustmentCreate {
  adjustment_type: string;
  boq_item_id?: number | null;
  amount: number;
  reason?: string;
  status?: string;
}

export interface PaymentCertificate {
  id: number;
  project_id: number;
  period_label: string;
  gross_amount: number;
  prepayment_deduction: number;
  retention: number;
  net_payable: number;
  paid_amount: number;
  status: string;
  issued_at: string;
}

export interface PaymentCertificateCreate {
  period_label: string;
  gross_amount: number;
  prepayment_deduction?: number;
  retention?: number;
  paid_amount?: number;
  status?: string;
}

export interface AutoValuateMatchDetail {
  boq_item_id: number; boq_code: string; boq_name: string;
  quota_item_id: number | null; quota_code: string; quota_name: string;
  confidence: number; status: string;
}
export interface AutoValuateResponse {
  total_items: number; already_bound: number;
  newly_matched: number; skipped: number;
  match_details: AutoValuateMatchDetail[];
  calc_summary: CalcSummary | null;
}

export interface DrawingValuationItem {
  boq_item_id: number; code: string; name: string; unit: string; quantity: number;
  quota_item_id: number | null; quota_code: string; quota_name: string;
  match_confidence: number; match_reason?: string; match_reasons?: string[];
  status: string; total: number;
}

export interface DrawingValuationReviewItem {
  severity: string; category: string; message: string; suggestion: string;
  boq_item_id: number | null; code: string; name: string;
}

export interface DrawingValuation {
  project_id: number | null; project_name: string;
  boq_items_created: number; matched: number; skipped: number;
  grand_total: number; total_direct: number;
  items: DrawingValuationItem[]; calc_summary: CalcSummary | null;
  review_items?: DrawingValuationReviewItem[];
  review_summary?: { errors?: number; warnings?: number; total?: number };
  error: string | null;
}

export interface SystemCheckItem {
  key: string; label: string; status: "ok" | "warning" | "error";
  message: string; details: Record<string, unknown>;
}

export interface SystemCheckResponse {
  status: "ok" | "warning" | "error";
  checks: SystemCheckItem[];
  counts: Record<string, number>;
  zh_provider: string;
  offline_mode: boolean;
  database_url: string;
}

export interface TaskStatusOut {
  task_id: string; task_type: string; status: string; progress: number;
  message: string; error: string | null; created_at: string; completed_at: string | null;
}

export interface TaskListResponse {
  tasks: TaskStatusOut[];
}

export interface IfcElement {
  id: string; type: string; label: string; name: string;
  element_type: string; predefined_type: string; object_type: string;
  description: string; count: number; material: string;
  length: number; width: number; height: number; thickness: number;
  area: number; volume: number; unit: string;
  quantity_estimate: number; confidence: number; pset_keys: string[];
  pos_x: number; pos_y: number; pos_z: number;
  mesh_vertices: number[]; mesh_indices: number[]; mesh_kind: string;
}

export interface IfcTaskStatus {
  taskId: string; status: string; summary: string;
  elements: IfcElement[];
  preview_elements: IfcElement[];
  boq_suggestions: Array<{
    source_element_id: string; suggested_code: string; suggested_name: string;
    suggested_unit: string; suggested_quantity: number;
    characteristics: string; confidence: number;
    material: string; element_count: number;
  }>;
  statistics: Record<string, number>; diagnostics: string[];
  ifc_schema: string; total_elements: number; error: string | null;
  detail_element_count: number;
  preview_element_count: number;
  aggregated_element_count: number;
  mesh_element_count: number;
  valuation: DrawingValuation | null;
  valuation_status: string;
  valuation_progress: string;
  valuation_progress_percent: number;
  valuation_error: string | null;
  progress: string;
  progress_percent?: number;
  created_at: string | null;
  updated_at: string | null;
  timeout_seconds: number;
}

export interface PriceSourceInfo {
  source_name: string; display_name: string; available: boolean;
  supports_regions: string[]; supports_categories: string[];
  last_success_at: string | null; total_prices_fetched: number; error: string | null;
}
export interface FetchRequest {
  source_names?: string[] | null; query?: string | null;
  region?: string; category?: string;
}
export interface FetchResult {
  source_name: string; fetched: number; new_or_updated: number;
  duration_s: number; error: string | null;
}
export interface FetchResponse {
  total_fetched: number; total_new_or_updated: number;
  results: FetchResult[]; started_at: string; completed_at: string;
}
export interface SchedulerStatus {
  running: boolean; interval_hours: number;
  last_fetch_at: string | null; last_fetch_success: boolean;
  last_fetch_sources: number; last_fetch_count: number;
  last_fetch_error: string; next_fetch_at: string | null;
}

export interface SourceHealthInfo {
  source_name: string; display_name: string; available: boolean;
  latency_ms: number; error: string | null;
}

export interface PreviewPriceItem {
  name: string; spec: string; unit: string; unit_price: number;
  region: string; effective_date: string; source: string; url: string;
}

export interface PreviewResponse {
  total: number; items: PreviewPriceItem[];
  sources_tried: string[]; duration_s: number; error: string | null;
}

export interface QuotaItemDTO {
  id: number;
  quota_code: string;
  discipline: string;
  name: string;
  unit: string;
  chapter: string;
  labor_qty: number;
  material_qty: number;
  machine_qty: number;
  base_price?: number;
  // 旧材料（遗址修复材料）扩展字段
  acquisition_method?: string; // "" | "recycle" | "reproduce"
  origin_note?: string;
  heritage_site?: string;
  relic_level?: string;
  repair_part?: string;
  condition_grade?: string;
  batch_no?: string;
  inspection_report_no?: string;
}

export type QuotaAcquisitionMethod = "" | "recycle" | "reproduce";

export interface QuotaItemCreatePayload {
  quota_code: string;
  discipline?: string;
  name: string;
  unit: string;
  labor_qty?: number;
  material_qty?: number;
  machine_qty?: number;
  work_content?: string;
  applicable_scope?: string;
  chapter?: string;
  version?: string;
  base_price?: number;
  acquisition_method?: QuotaAcquisitionMethod;
  origin_note?: string;
  heritage_site?: string;
  relic_level?: string;
  repair_part?: string;
  condition_grade?: string;
  batch_no?: string;
  inspection_report_no?: string;
}

export interface QuotaItemCreateResponse {
  ok: boolean;
  action: "created" | "updated";
  item: QuotaItemDTO;
}

// ─── 旧材料（遗址修复材料）独立模块类型 ───────────────────────────

export type OldMaterialAcquisitionMethod = "recycle" | "reproduce";

export interface OldMaterialDTO {
  id: number;
  quota_code: string;
  name: string;
  unit: string;
  labor_qty: number;
  material_qty: number;
  machine_qty: number;
  base_price: number;
  chapter: string;
  version: string;
  work_content: string;
  applicable_scope: string;
  acquisition_method: OldMaterialAcquisitionMethod;
  origin_note: string;
  heritage_site: string;
  relic_level: string;
  repair_part: string;
  condition_grade: string;
  batch_no: string;
  inspection_report_no: string;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface OldMaterialListResponse {
  total: number;
  items: OldMaterialDTO[];
}

export interface OldMaterialCreatePayload {
  quota_code: string;
  name: string;
  unit: string;
  labor_qty?: number;
  material_qty?: number;
  machine_qty?: number;
  base_price?: number;
  chapter?: string;
  version?: string;
  work_content?: string;
  applicable_scope?: string;
  acquisition_method: OldMaterialAcquisitionMethod;
  origin_note?: string;
  heritage_site?: string;
  relic_level?: string;
  repair_part?: string;
  condition_grade?: string;
  batch_no?: string;
  inspection_report_no?: string;
}

export interface OldMaterialUpdatePayload {
  name?: string;
  unit?: string;
  labor_qty?: number;
  material_qty?: number;
  machine_qty?: number;
  base_price?: number;
  chapter?: string;
  version?: string;
  work_content?: string;
  applicable_scope?: string;
  acquisition_method?: OldMaterialAcquisitionMethod;
  origin_note?: string;
  heritage_site?: string;
  relic_level?: string;
  repair_part?: string;
  condition_grade?: string;
  batch_no?: string;
  inspection_report_no?: string;
}

export interface OldMaterialMutationResponse {
  ok: boolean;
  action: "created" | "updated";
  item: OldMaterialDTO;
}

export interface OldMaterialStatsResponse {
  total: number;
  by_acquisition_method: Array<{ acquisition_method: string; count: number }>;
  by_heritage_site: Array<{ heritage_site: string; count: number }>;
  by_relic_level: Array<{ relic_level: string; count: number }>;
}

export interface QuotaListResponse {
  total: number;
  items: QuotaItemDTO[];
}

export interface QuotaChapterStat {
  discipline: string;
  chapter: string;
  count: number;
}

export interface QuotaDisciplineStat {
  discipline: string;
  count: number;
}

export interface QuotaStatsResponse {
  total: number;
  disciplines: QuotaDisciplineStat[];
  chapters: QuotaChapterStat[];
}

export interface RestoreReferenceResponse {
  ok: boolean;
  restored: Record<string, number>;
  message: string;
}

// ─── Knowledge Graph Types ────────────────────────────────────────

export interface TagOut {
  id: number; name: string; color: string; category: string; created_at: string;
}
export interface TagCreate { name: string; color?: string; category?: string }

export interface EntityTagOut {
  id: number; tag_id: number; tag_name: string; tag_color: string;
  entity_type: string; entity_id: number;
}
export interface EntityTagCreate { tag_id: number; entity_type: string; entity_id: number }

export interface KnowledgeLinkOut {
  id: number; source_type: string; source_id: number;
  target_type: string; target_id: number;
  link_type: string; label: string; note: string; created_at: string;
}
export interface KnowledgeLinkCreate {
  source_type: string; source_id: number;
  target_type: string; target_id: number;
  link_type?: string; label?: string; note?: string;
}
export interface KnowledgeLinkUpdate {
  link_type?: string; label?: string; note?: string;
}

export interface KnowledgeNoteOut {
  id: number; entity_type: string; entity_id: number;
  title: string; content: string; created_at: string; updated_at: string;
}
export interface KnowledgeNoteCreate {
  entity_type: string; entity_id: number; title?: string; content?: string;
}
export interface KnowledgeNoteUpdate { title?: string; content?: string }

export interface GraphNode {
  id: string; type: string; label: string;
  properties: Record<string, unknown>; tags: string[];
}
export interface GraphEdge {
  source: string; target: string; type: string; label: string;
}
export interface GraphDataOut { nodes: GraphNode[]; edges: GraphEdge[] }

// ─── Report Types ────────────────────────────────────────────────

export interface ReportProjectInfo {
  id: number;
  name: string;
  region: string;
  project_type: string;
  standard_type: string;
  currency: string;
}

export interface ReportStatistics {
  total_items: number;
  bound_count: number;
  unbound_count: number;
  binding_rate: string;
  calculated_items: number;
}

export interface ReportCostSummary {
  total_direct: number;
  total_management: number;
  total_profit: number;
  total_regulatory: number;
  total_tax: number;
  total_measures: number;
  grand_total: number;
}

export interface ReportDivision {
  division: string;
  item_count: number;
  bound_count: number;
  total_cost: number;
  percentage: string;
}

export interface ReportLineItem {
  boq_item_id: number;
  code: string;
  name: string;
  unit: string;
  quantity: number;
  division: string;
  unit_price: number | null;
  total_cost: number | null;
  is_bound: boolean;
  quota_count: number;
}

export interface ReportData {
  project: ReportProjectInfo;
  statistics: ReportStatistics;
  cost_summary: ReportCostSummary;
  divisions: ReportDivision[];
  line_items: ReportLineItem[];
  generated_at: string;
}

// ─── API ─────────────────────────────────────────────────────────

export const api = {
  // Projects
  listProjects: (params?: ProjectListParams) => {
    const qs = new URLSearchParams();
    if (params?.q) qs.set("q", params.q);
    if (params?.status) qs.set("status", params.status);
    if (params?.project_type) qs.set("project_type", params.project_type);
    if (params?.region) qs.set("region", params.region);
    if (params?.sort_by) qs.set("sort_by", params.sort_by);
    if (params?.sort_order) qs.set("sort_order", params.sort_order);
    if (params?.page != null) qs.set("page", String(params.page));
    if (params?.page_size != null) qs.set("page_size", String(params.page_size));
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return request<ProjectListResponse>(`/projects${suffix}`);
  },
  getProject: (pid: number) => request<Project>(`/projects/${pid}`),
  createProject: (data: ProjectCreateData) =>
    request<Project>("/projects", { method: "POST", body: JSON.stringify(data) }),
  updateProject: (pid: number, data: ProjectUpdateData) =>
    request<Project>(`/projects/${pid}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteProject: (pid: number) =>
    request<{ ok: boolean; deleted_id: number }>(`/projects/${pid}`, { method: "DELETE" }),
  archiveProject: (pid: number) =>
    request<Project>(`/projects/${pid}:archive`, { method: "POST" }),
  duplicateProject: (pid: number) =>
    request<Project>(`/projects/${pid}:duplicate`, { method: "POST" }),
  changeProjectStatus: (pid: number, status: string) =>
    request<Project>(`/projects/${pid}/status`, { method: "PATCH", body: JSON.stringify({ status }) }),
  batchDeleteProjects: (ids: number[]) =>
    request<{ ok: boolean; deleted: number }>("/projects:batch-delete", { method: "POST", body: JSON.stringify(ids) }),
  batchArchiveProjects: (ids: number[]) =>
    request<{ ok: boolean; archived: number }>("/projects:batch-archive", { method: "POST", body: JSON.stringify(ids) }),

  // BOQ CRUD
  listBoqItems: (pid: number) => request<BoqItem[]>(`/projects/${pid}/boq-items`),
  createBoqItem: (pid: number, data: BoqItemCreate) =>
    request<BoqItem>(`/projects/${pid}/boq-items`, { method: "POST", body: JSON.stringify(data) }),
  updateBoqItem: (pid: number, itemId: number, data: BoqItemUpdate) =>
    request<BoqItem>(`/projects/${pid}/boq-items/${itemId}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteBoqItem: (pid: number, itemId: number) =>
    request<{ ok: boolean }>(`/projects/${pid}/boq-items/${itemId}`, { method: "DELETE" }),

  // Import
  importBoq: (pid: number, file: File) => {
    const fd = new FormData(); fd.append("file", file);
    return upload<ImportResult>(`/imports/boq?project_id=${pid}`, fd);
  },
  importQuota: (file: File, discipline = "AUTO", sheetNames?: string[]) => {
    const fd = new FormData(); fd.append("file", file);
    const qs = new URLSearchParams({ discipline });
    for (const name of sheetNames ?? []) qs.append("sheet_names", name);
    return upload<ImportResult>(`/imports/quota?${qs.toString()}`, fd);
  },
  inspectQuotaWorkbook: (file: File) => {
    const fd = new FormData(); fd.append("file", file);
    return upload<QuotaWorkbookInspectResult>("/imports/quota/sheets", fd);
  },
  importQuotaResourceDetails: (file: File) => {
    const fd = new FormData(); fd.append("file", file);
    return upload<ImportResult>("/imports/quota-resource-details", fd);
  },
  restoreReferenceData: (force = false) =>
    request<RestoreReferenceResponse>(`/quota-items/restore-reference?force=${force ? "true" : "false"}`, {
      method: "POST",
    }),

  //  Match
  getQuotaCandidates: (boqItemId: number, topN = 5) =>
    request<MatchCandidate[]>(`/boq-items/${boqItemId}/quota-candidates?top_n=${topN}`, { method: "POST" }),

  // Bindings
  confirmBinding: (boqItemId: number, quotaItemId: number) =>
    request<Binding>(`/boq-items/${boqItemId}/quota-binding:confirm`, {
      method: "POST", body: JSON.stringify({ quota_item_id: quotaItemId, coefficient: 1 }),
    }),
  confirmBindingWithCoefficient: (boqItemId: number, quotaItemId: number, coefficient: number) =>
    request<Binding>(`/boq-items/${boqItemId}/quota-binding:confirm`, {
      method: "POST", body: JSON.stringify({ quota_item_id: quotaItemId, coefficient }),
    }),
  replaceBinding: (boqItemId: number, quotaItemId: number) =>
    request<Binding>(`/boq-items/${boqItemId}/quota-binding:replace`, {
      method: "POST", body: JSON.stringify({ quota_item_id: quotaItemId, coefficient: 1 }),
    }),
  replaceBindingWithCoefficient: (boqItemId: number, quotaItemId: number, coefficient: number) =>
    request<Binding>(`/boq-items/${boqItemId}/quota-binding:replace`, {
      method: "POST", body: JSON.stringify({ quota_item_id: quotaItemId, coefficient }),
    }),
  batchConfirmBindings: (bindings: Array<{ boq_item_id: number; quota_item_id: number; coefficient?: number }>) =>
    request<Binding[]>("/boq-items/quota-binding:batch-confirm", {
      method: "POST", body: JSON.stringify({ bindings }),
    }),
  batchReplaceBindings: (bindings: Array<{ boq_item_id: number; quota_item_id: number; coefficient?: number }>) =>
    request<Binding[]>("/boq-items/quota-binding:batch-replace", {
      method: "POST", body: JSON.stringify({ bindings }),
    }),
  listBindings: (boqItemId: number) => request<Binding[]>(`/boq-items/${boqItemId}/quota-bindings`),
  listProjectBindings: (projectId: number) =>
    request<BindingWithQuota[]>(`/projects/${projectId}/bindings-with-quota`),
  deleteBinding: (boqItemId: number, bindingId: number) =>
    request<{ boq_item_id: number; removed: number }>(`/boq-items/${boqItemId}/quota-bindings/${bindingId}`, {
      method: "DELETE",
    }),
  clearBindings: (boqItemId: number) =>
    request<{ boq_item_id: number; removed: number }>(`/boq-items/${boqItemId}/quota-bindings:clear`, {
      method: "DELETE",
    }),

  // Calculate
  calculate: (pid: number) => request<CalcSummary>(`/projects/${pid}/calculate`, { method: "POST" }),
  getCalcSummary: (pid: number) => request<CalcSummary>(`/projects/${pid}/calc-summary`),

  // Provenance
  getProvenance: (boqItemId: number) => request<CalcProvenance>(`/calc-results/${boqItemId}/provenance`),

  // Validation
  validate: (pid: number) => request<ValidationReport>(`/projects/${pid}/validation-issues`),

  // Snapshots
  listSnapshots: (pid: number) => request<Snapshot[]>(`/projects/${pid}/snapshots`),
  createSnapshot: (pid: number, label: string) =>
    request<Snapshot>(`/projects/${pid}/snapshots`, { method: "POST", body: JSON.stringify({ label }) }),
  diffSnapshots: (pid: number, aId: number, bId: number) =>
    request<DiffReport>(`/projects/${pid}/diff`, {
      method: "POST", body: JSON.stringify({ snapshot_a_id: aId, snapshot_b_id: bId }),
    }),

  // Export (POST endpoints — trigger download via form submission)
  exportValuationUrl: (pid: number) => `${API_BASE}/exports/valuation-report?project_id=${pid}`,
  exportDiffUrl: (aId: number, bId: number) =>
    `${API_BASE}/exports/diff-report?snapshot_a_id=${aId}&snapshot_b_id=${bId}`,

  // Rule Packages
  listRulePackages: () => request<RulePackage[]>("/rule-packages"),
  createRulePackage: (data: RulePackageCreate) =>
    request<RulePackage>("/rule-packages", { method: "POST", body: JSON.stringify(data) }),
  bindRulePackage: (pid: number, rpId: number) =>
    request<Project>(`/projects/${pid}/rule-package:bind`, {
      method: "POST", body: JSON.stringify({ rule_package_id: rpId }),
    }),

  // Material Prices
  listMaterialPrices: (query?: MaterialPriceQuery) => {
    const qs = new URLSearchParams();
    if (query?.region) qs.set("region", query.region);
    if (query?.name) qs.set("name", query.name);
    if (query?.as_of_date) qs.set("as_of_date", query.as_of_date);
    if (query?.latest_only) qs.set("latest_only", "true");
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return request<MaterialPrice[]>(`/material-prices${suffix}`);
  },
  createMaterialPrice: (data: MaterialPriceCreate) =>
    request<MaterialPrice>("/material-prices", { method: "POST", body: JSON.stringify(data) }),

  // Measures
  listMeasures: (pid: number) => request<MeasureItem[]>(`/projects/${pid}/measures`),
  createMeasure: (pid: number, data: MeasureItemCreate) =>
    request<MeasureItem>(`/projects/${pid}/measures`, { method: "POST", body: JSON.stringify(data) }),
  deleteMeasure: (pid: number, mId: number) =>
    request<{ ok: boolean }>(`/projects/${pid}/measures/${mId}`, { method: "DELETE" }),

  // Collaboration
  listMembers: (pid: number) => request<Member[]>(`/projects/${pid}/members`),
  addMember: (pid: number, userName: string, role = "viewer") =>
    request<Member>(`/projects/${pid}/members`, { method: "POST", body: JSON.stringify({ user_name: userName, role }) }),
  listComments: (pid: number) => request<CommentItem[]>(`/projects/${pid}/comments`),
  addComment: (pid: number, author: string, content: string, boqItemId?: number) =>
    request<CommentItem>(`/projects/${pid}/comments`, {
      method: "POST", body: JSON.stringify({ author, content, boq_item_id: boqItemId ?? null }),
    }),

  // Audit Logs
  listAuditLogs: (pid: number) => request<AuditLog[]>(`/projects/${pid}/audit-logs`),
  getDashboardSummary: (pid: number) =>
    request<DashboardSummary>(`/projects/${pid}/dashboard-summary`),
  getHealthScore: (pid: number) =>
    request<HealthScore>(`/projects/${pid}/health-score`),
  recalculateDirty: (pid: number) =>
    request<{ ok?: boolean; updated?: number; message?: string }>(`/projects/${pid}/calculate:dirty`, { method: "POST" }),

  // Valuation management (GB/T50500-2024 workflow)
  getValuationOverview: (pid: number) =>
    request<ValuationOverview>(`/projects/${pid}/valuation-management/overview`),
  getValuationConfig: (pid: number) =>
    request<ValuationStandardConfig>(`/projects/${pid}/valuation-management/config`),
  updateValuationConfig: (pid: number, data: ValuationStandardConfigUpdate) =>
    request<ValuationStandardConfig>(`/projects/${pid}/valuation-management/config`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  listContractMeasurements: (pid: number) =>
    request<ContractMeasurement[]>(`/projects/${pid}/valuation-management/measurements`),
  createContractMeasurement: (pid: number, data: ContractMeasurementCreate) =>
    request<ContractMeasurement>(`/projects/${pid}/valuation-management/measurements`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  approveContractMeasurement: (pid: number, measurementId: number, approvedBy: string) =>
    request<ContractMeasurement>(`/projects/${pid}/valuation-management/measurements/${measurementId}:approve`, {
      method: "POST",
      body: JSON.stringify({ approved_by: approvedBy }),
    }),
  listPriceAdjustments: (pid: number) =>
    request<PriceAdjustment[]>(`/projects/${pid}/valuation-management/adjustments`),
  createPriceAdjustment: (pid: number, data: PriceAdjustmentCreate) =>
    request<PriceAdjustment>(`/projects/${pid}/valuation-management/adjustments`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  listPaymentCertificates: (pid: number) =>
    request<PaymentCertificate[]>(`/projects/${pid}/valuation-management/payments`),
  createPaymentCertificate: (pid: number, data: PaymentCertificateCreate) =>
    request<PaymentCertificate>(`/projects/${pid}/valuation-management/payments`, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  //  Query
  query: (pid: number, q: string) =>
    request<QueryResponse>(`/projects/${pid}/query`, { method: "POST", body: JSON.stringify({ q }) }),

  //  Settings
  getSystemCheck: () => request<SystemCheckResponse>("/system-check"),
  listTasks: (taskType?: string) => {
    const qs = taskType ? `?task_type=${encodeURIComponent(taskType)}` : "";
    return request<TaskListResponse>(`/tasks${qs}`);
  },
  getTaskStatus: (taskId: string) => request<TaskStatusOut>(`/tasks/${encodeURIComponent(taskId)}`),

  //  Auto Valuate (match + bind + calc)
  autoValuate: (pid: number) =>
    request<AutoValuateResponse>(`/projects/${pid}/auto-valuate`, { method: "POST" }),

  // Reorder BOQ items
  reorderBoqItems: (pid: number, items: Array<{ id: number; sort_order: number }>) =>
    request<{ ok: boolean; updated: number }>(`/projects/${pid}/boq-items:reorder`, {
      method: "POST", body: JSON.stringify({ items }),
    }),

  // Batch update BOQ items
  batchUpdateBoqItems: (pid: number, ids: number[], updates: { division?: string; trade_section?: string; remark?: string }) =>
    request<{ ok: boolean; updated: number }>(`/projects/${pid}/boq-items:batch-update`, {
      method: "PATCH", body: JSON.stringify({ ids, ...updates }),
    }),

  // Batch delete BOQ items
  batchDeleteBoqItems: (pid: number, ids: number[]) =>
    request<{ ok: boolean; deleted: number }>(`/projects/${pid}/boq-items:batch-delete`, {
      method: "POST", body: JSON.stringify({ ids }),
    }),

  // ─── Knowledge Graph APIs ──────────────────────────────────────────

  // Tags
  listTags: (category?: string) =>
    request<TagOut[]>(`/tags${category ? `?category=${category}` : ""}`),
  createTag: (data: TagCreate) =>
    request<TagOut>("/tags", { method: "POST", body: JSON.stringify(data) }),
  deleteTag: (tagId: number) =>
    request<void>(`/tags/${tagId}`, { method: "DELETE" }),

  // Entity Tags
  listEntityTags: (params?: { entity_type?: string; entity_id?: number; tag_id?: number }) => {
    const qs = new URLSearchParams();
    if (params?.entity_type) qs.set("entity_type", params.entity_type);
    if (params?.entity_id != null) qs.set("entity_id", String(params.entity_id));
    if (params?.tag_id != null) qs.set("tag_id", String(params.tag_id));
    const q = qs.toString();
    return request<EntityTagOut[]>(`/entity-tags${q ? `?${q}` : ""}`);
  },
  attachTag: (data: EntityTagCreate) =>
    request<EntityTagOut>("/entity-tags", { method: "POST", body: JSON.stringify(data) }),
  detachTag: (entityTagId: number) =>
    request<void>(`/entity-tags/${entityTagId}`, { method: "DELETE" }),

  // Knowledge Links
  listKnowledgeLinks: (params?: { entity_type?: string; entity_id?: number; link_type?: string }) => {
    const qs = new URLSearchParams();
    if (params?.entity_type) qs.set("entity_type", params.entity_type);
    if (params?.entity_id != null) qs.set("entity_id", String(params.entity_id));
    if (params?.link_type) qs.set("link_type", params.link_type);
    const q = qs.toString();
    return request<KnowledgeLinkOut[]>(`/knowledge-links${q ? `?${q}` : ""}`);
  },
  createKnowledgeLink: (data: KnowledgeLinkCreate) =>
    request<KnowledgeLinkOut>("/knowledge-links", { method: "POST", body: JSON.stringify(data) }),
  updateKnowledgeLink: (linkId: number, data: KnowledgeLinkUpdate) =>
    request<KnowledgeLinkOut>(`/knowledge-links/${linkId}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteKnowledgeLink: (linkId: number) =>
    request<void>(`/knowledge-links/${linkId}`, { method: "DELETE" }),

  // Knowledge Notes
  listKnowledgeNotes: (params?: { entity_type?: string; entity_id?: number }) => {
    const qs = new URLSearchParams();
    if (params?.entity_type) qs.set("entity_type", params.entity_type);
    if (params?.entity_id != null) qs.set("entity_id", String(params.entity_id));
    const q = qs.toString();
    return request<KnowledgeNoteOut[]>(`/knowledge-notes${q ? `?${q}` : ""}`);
  },
  createKnowledgeNote: (data: KnowledgeNoteCreate) =>
    request<KnowledgeNoteOut>("/knowledge-notes", { method: "POST", body: JSON.stringify(data) }),
  updateKnowledgeNote: (noteId: number, data: KnowledgeNoteUpdate) =>
    request<KnowledgeNoteOut>(`/knowledge-notes/${noteId}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteKnowledgeNote: (noteId: number) =>
    request<void>(`/knowledge-notes/${noteId}`, { method: "DELETE" }),

  // Graph Data
  getGraphData: (params?: {
    scope?: string; project_id?: number; entity_type?: string;
    entity_id?: number; depth?: number; types?: string; tag_filter?: string;
  }) => {
    const qs = new URLSearchParams();
    if (params?.scope) qs.set("scope", params.scope);
    if (params?.project_id != null) qs.set("project_id", String(params.project_id));
    if (params?.entity_type) qs.set("entity_type", params.entity_type);
    if (params?.entity_id != null) qs.set("entity_id", String(params.entity_id));
    if (params?.depth != null) qs.set("depth", String(params.depth));
    if (params?.types) qs.set("types", params.types);
    if (params?.tag_filter) qs.set("tag_filter", params.tag_filter);
    const q = qs.toString();
    return request<GraphDataOut>(`/graph/data${q ? `?${q}` : ""}`);
  },

  // ─── Orchestrator & Pipeline APIs ──────────────────────────────────

  // ─── Quota Library APIs ─────────────────────────────────────────

  listQuotaItems: (params: {
    skip?: number;
    limit?: number;
    discipline?: string;
    chapter?: string;
    keyword?: string;
    acquisition_method?: QuotaAcquisitionMethod;
  }) => {
    const qs = new URLSearchParams();
    if (params.skip != null) qs.set("skip", String(params.skip));
    if (params.limit != null) qs.set("limit", String(params.limit));
    if (params.discipline) qs.set("discipline", params.discipline);
    if (params.chapter) qs.set("chapter", params.chapter);
    if (params.keyword) qs.set("keyword", params.keyword);
    if (params.acquisition_method) qs.set("acquisition_method", params.acquisition_method);
    return request<QuotaListResponse>(`/quota-items?${qs.toString()}`);
  },

  getQuotaStats: () => request<QuotaStatsResponse>("/quota-items/stats"),

  createQuotaItem: (payload: QuotaItemCreatePayload) =>
    request<QuotaItemCreateResponse>("/quota-items", {
      method: "POST",
      body: JSON.stringify(payload),
      headers: { "Content-Type": "application/json" },
    }),

  // ─── 旧材料（遗址修复材料）独立模块 APIs ──────────────────────────

  listOldMaterials: (params: {
    skip?: number;
    limit?: number;
    keyword?: string;
    acquisition_method?: OldMaterialAcquisitionMethod;
    heritage_site?: string;
  }) => {
    const qs = new URLSearchParams();
    if (params.skip != null) qs.set("skip", String(params.skip));
    if (params.limit != null) qs.set("limit", String(params.limit));
    if (params.keyword) qs.set("keyword", params.keyword);
    if (params.acquisition_method) qs.set("acquisition_method", params.acquisition_method);
    if (params.heritage_site) qs.set("heritage_site", params.heritage_site);
    return request<OldMaterialListResponse>(`/old-materials?${qs.toString()}`);
  },

  getOldMaterialStats: () =>
    request<OldMaterialStatsResponse>("/old-materials/stats"),

  createOldMaterial: (payload: OldMaterialCreatePayload) =>
    request<OldMaterialMutationResponse>("/old-materials", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  updateOldMaterial: (id: number, payload: OldMaterialUpdatePayload) =>
    request<OldMaterialMutationResponse>(`/old-materials/${id}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    }),

  deleteOldMaterial: (id: number) =>
    request<{ ok: boolean; deleted_id: number }>(`/old-materials/${id}`, {
      method: "DELETE",
    }),

  // ─── Report APIs ──────────────────────────────────────────────

  getReport: (pid: number, opts?: { division?: string; search?: string }) => {
    const qs = new URLSearchParams();
    if (opts?.division) qs.set("division", opts.division);
    if (opts?.search) qs.set("search", opts.search);
    const q = qs.toString();
    return request<ReportData>(`/projects/${pid}/report${q ? `?${q}` : ""}`);
  },

  exportReport: (pid: number, format: "pdf" | "excel" = "pdf") => {
    const url = `${API_BASE}/projects/${pid}/report/export?format=${format}`;
    return fetchBlob(url, { headers: authHeaders() });
  },

  // 图纸识别
  uploadDrawing: (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return upload<{ taskId: string }>("/drawing-recognition", fd);
  },

  exportDrawingResult: (taskId: string) => {
    const url = `${API_BASE}/drawing-recognition/${taskId}/export`;
    return fetchBlob(url, { headers: authHeaders() });
  },

  convertDxfToDwg: async (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return fetchBlob(`${API_BASE}/drawing-recognition/convert/dxf-to-dwg`, {
      method: "POST",
      body: fd,
      headers: authHeaders(),
    });
  },

  getCadConverterStatus: () => {
    return request<{
      dxf_to_dwg: boolean;
      dwg_to_dxf: boolean;
      candidates: {
        dxf_to_dwg: Array<{ name: string; kind: string; source: string; bundled: boolean }>;
        dwg_to_dxf: Array<{ name: string; kind: string; source: string; bundled: boolean }>;
      };
      bundled_dirs: string[];
      timeout_seconds: number;
      instructions: string;
    }>("/drawing-recognition/convert/status");
  },

  getDrawingResult: (taskId: string, includeSvg = true) => {
    return request<{
      taskId: string;
      status: "processing" | "done" | "error";
      drawing_type: string;
      summary: string;
      diagnostics: string[];
      layer_summary: Array<{
        layer: string;
        count: number;
        classified_as: string;
        entity_types: Record<string, number>;
      }>;
      disciplines: Array<{
        key: string;
        name: string;
        ratio: number;
        component_count: number;
      }>;
      quality_score: {
        score: number;
        level: string;
        coverage: number;
        avg_confidence: number;
        completeness: number;
        discipline_count: number;
        spec_extraction_rate: number;
        issues: string[];
      } | null;
      components: Array<{
        id: string;
        type: string;
        count: number;
        spec: string;
        confidence: number;
        material: string;
        unit: string;
        quantity_estimate: number;
        length_m: number;
        area_m2: number;
        layers: string[];
        calc_note: string;
      }>;
      boq_suggestions: Array<{
        source_component_id: string;
        suggested_code: string;
        suggested_name: string;
        suggested_unit: string;
        suggested_quantity: number;
        characteristics: string;
        confidence: number;
        material: string;
        component_count: number;
      }>;
      valuation: DrawingValuation | null;
      valuation_status: "idle" | "processing" | "done" | "error" | "skipped";
      valuation_progress: string;
      valuation_progress_percent: number;
      valuation_error: string | null;
      progress: string;
      progress_percent?: number;
      created_at: string | null;
      updated_at: string | null;
      preview_svg: string;
      preview_svg_hd: string;
      error: string | null;
    }>(`/drawing-recognition/${taskId}${includeSvg ? "" : "?include_svg=false"}`);
  },

  // ─── IFC Parse ─────────────────────────────────────────────────

  uploadIfcFile: (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return upload<IfcTaskStatus>("/ifc-parse", fd);
  },
  getIfcParseResult: (taskId: string) => {
    return request<IfcTaskStatus>(`/ifc-parse/${taskId}`);
  },
  autoValuateIfcParseResult: (taskId: string) => {
    return request<IfcTaskStatus>(`/ifc-parse/${taskId}/auto-valuate`, { method: "POST" });
  },
  exportIfcParseResult: (taskId: string) => {
    const url = `${API_BASE}/ifc-parse/${taskId}/export`;
    return fetchBlob(url, { headers: authHeaders() });
  },
  saveIfcToProject: (taskId: string, projectId: number) => {
    return request<{
      project_id: number; boq_items_created: number; boq_items: string[];
      matched: number; skipped: number; grand_total: number | null;
    }>(
      `/ifc-parse/${taskId}/save-to-project`,
      { method: "POST", body: JSON.stringify({ project_id: projectId }) },
    );
  },

  // ─── Price Fetch ────────────────────────────────────────────────

  listPriceSources: () => request<PriceSourceInfo[]>("/price-fetch/sources"),
  fetchPrices: (req: FetchRequest) =>
    request<FetchResponse>("/price-fetch/fetch", { method: "POST", body: JSON.stringify(req) }),
  getPriceFetchStatus: () => request<FetchResponse>("/price-fetch/status"),
  getPriceFetchSchedulerStatus: () =>
    request<SchedulerStatus>("/price-fetch/scheduler/status"),
  startPriceScheduler: (intervalHours: number = 24) =>
    request<{ ok: boolean; message: string }>("/price-fetch/scheduler/start", {
      method: "POST", body: JSON.stringify({ interval_hours: intervalHours }),
    }),
  stopPriceScheduler: () =>
    request<{ ok: boolean; message: string }>("/price-fetch/scheduler/stop", { method: "POST" }),
  getPriceSourcesHealth: () =>
    request<SourceHealthInfo[]>("/price-fetch/sources/health"),
  previewFetchPrices: (req: FetchRequest) =>
    request<PreviewResponse>("/price-fetch/preview", { method: "POST", body: JSON.stringify(req) }),
};
