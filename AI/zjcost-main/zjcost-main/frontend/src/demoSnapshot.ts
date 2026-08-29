/**
 * 筑衡 — 演示数据快照
 *
 * 完全离线的预设项目数据，不依赖后端 API。
 * 演示模式开启后，client.ts 的 request 函数会优先匹配此快照返回数据。
 *
 * 涵盖演示流程所有关键页面：
 * 总控台 → 图纸识别 → 清单计价 → 审计复核 → 成果报表 → 3D 核查
 */

import type {
  Project, ProjectListResponse, BoqItem, CalcSummary,
  DashboardSummary, ValidationReport, ValuationOverview,
  PipelineResponse, ReportData,
} from "./api";

export const DEMO_PROJECT_ID = 9999;

// ─── 项目 ───────────────────────────────────────────────────────

const DEMO_PROJECT: Project = {
  id: DEMO_PROJECT_ID,
  name: "筑衡演示项目 · 滨江科创中心",
  description: "公共建筑演示项目，涵盖图纸识别、IFC 套价、全过程计价与审计流水线。",
  region: "浙江·杭州",
  project_type: "公共建筑",
  status: "active",
  budget: 12800000,
  start_date: "2025-03-01",
  end_date: "2026-08-30",
  owner: "滨江城建集团",
  standard_type: "GB/T50500-2024",
  language: "zh-CN",
  currency: "CNY",
  created_at: "2025-03-01T08:00:00Z",
  updated_at: "2025-06-15T14:30:00Z",
};

export const DEMO_PROJECT_LIST: ProjectListResponse = {
  items: [DEMO_PROJECT],
  total: 1,
  page: 1,
  page_size: 20,
  total_pages: 1,
};

// ─── 清单项 ─────────────────────────────────────────────────────

export const DEMO_BOQ_ITEMS: BoqItem[] = [
  { id: 9001, project_id: DEMO_PROJECT_ID, code: "010401003001", name: "框架柱混凝土 C30", characteristics: "柱类型:框架柱;混凝土强度:C30;泵送商品混凝土", unit: "m³", quantity: 186.5, division: "混凝土及钢筋混凝土工程", sort_order: 1, item_ref: "", trade_section: "建筑工程", description_en: "", rate: 0, amount: 0, remark: "" },
  { id: 9002, project_id: DEMO_PROJECT_ID, code: "010403002001", name: "矩形梁混凝土 C30", characteristics: "梁类型:框架梁;混凝土强度:C30;泵送商品混凝土", unit: "m³", quantity: 342.8, division: "混凝土及钢筋混凝土工程", sort_order: 2, item_ref: "", trade_section: "建筑工程", description_en: "", rate: 0, amount: 0, remark: "" },
  { id: 9003, project_id: DEMO_PROJECT_ID, code: "010405001001", name: "有梁板混凝土 C30", characteristics: "板厚:120mm;混凝土强度:C30", unit: "m³", quantity: 535.2, division: "混凝土及钢筋混凝土工程", sort_order: 3, item_ref: "", trade_section: "建筑工程", description_en: "", rate: 0, amount: 0, remark: "" },
  { id: 9004, project_id: DEMO_PROJECT_ID, code: "010515001001", name: "现浇构件钢筋 HRB400", characteristics: "钢筋种类:HRB400;直径综合", unit: "t", quantity: 124.6, division: "钢筋工程", sort_order: 4, item_ref: "", trade_section: "建筑工程", description_en: "", rate: 0, amount: 0, remark: "" },
  { id: 9005, project_id: DEMO_PROJECT_ID, code: "010515001002", name: "现浇构件钢筋 HPB300", characteristics: "钢筋种类:HPB300;直径综合", unit: "t", quantity: 38.2, division: "钢筋工程", sort_order: 5, item_ref: "", trade_section: "建筑工程", description_en: "", rate: 0, amount: 0, remark: "" },
  { id: 9006, project_id: DEMO_PROJECT_ID, code: "030404017001", name: "配电箱安装", characteristics: "规格:落地/嵌入综合;含接线调试", unit: "台", quantity: 28, division: "电气设备安装工程", sort_order: 6, item_ref: "", trade_section: "安装工程", description_en: "", rate: 0, amount: 0, remark: "" },
  { id: 9007, project_id: DEMO_PROJECT_ID, code: "030411001001", name: "配管 砖混结构暗配", characteristics: "材质:SC管;规格:DN25", unit: "m", quantity: 856, division: "电气设备安装工程", sort_order: 7, item_ref: "", trade_section: "安装工程", description_en: "", rate: 0, amount: 0, remark: "" },
  { id: 9008, project_id: DEMO_PROJECT_ID, code: "031001001001", name: "镀锌钢管 螺纹连接", characteristics: "规格:DN50;连接方式:螺纹", unit: "m", quantity: 342, division: "给排水工程", sort_order: 8, item_ref: "", trade_section: "安装工程", description_en: "", rate: 0, amount: 0, remark: "" },
];

// ─── 计算汇总 ───────────────────────────────────────────────────

export const DEMO_CALC_SUMMARY: CalcSummary = {
  total_direct: 8_965_000,
  total_management: 717_200,
  total_profit: 448_250,
  total_regulatory: 358_600,
  total_pre_tax: 10_489_050,
  total_tax: 1_089_342,
  total_measures: 320_000,
  grand_total: 11_898_392,
  line_results: [
    { boq_item_id: 9001, boq_code: "010401003001", boq_name: "框架柱混凝土 C30", direct_cost: 89_520, management_fee: 7_162, profit: 4_476, regulatory_fee: 3_581, pre_tax_total: 104_739, tax: 10_870, total: 115_609 },
    { boq_item_id: 9002, boq_code: "010403002001", boq_name: "矩形梁混凝土 C30", direct_cost: 164_544, management_fee: 13_164, profit: 8_227, regulatory_fee: 6_582, pre_tax_total: 192_517, tax: 19_970, total: 212_487 },
    { boq_item_id: 9003, boq_code: "010405001001", boq_name: "有梁板混凝土 C30", direct_cost: 256_896, management_fee: 20_552, profit: 12_845, regulatory_fee: 10_276, pre_tax_total: 300_569, tax: 31_184, total: 331_753 },
    { boq_item_id: 9004, boq_code: "010515001001", boq_name: "现浇构件钢筋 HRB400", direct_cost: 598_080, management_fee: 47_846, profit: 29_904, regulatory_fee: 23_923, pre_tax_total: 699_753, tax: 72_624, total: 772_377 },
    { boq_item_id: 9005, boq_code: "010515001002", boq_name: "现浇构件钢筋 HPB300", direct_cost: 168_802, management_fee: 13_504, profit: 8_440, regulatory_fee: 6_752, pre_tax_total: 197_498, tax: 20_492, total: 217_990 },
    { boq_item_id: 9006, boq_code: "030404017001", boq_name: "配电箱安装", direct_cost: 78_400, management_fee: 6_272, profit: 3_920, regulatory_fee: 3_136, pre_tax_total: 91_728, tax: 9_515, total: 101_243 },
    { boq_item_id: 9007, boq_code: "030411001001", boq_name: "配管 砖混结构暗配", direct_cost: 18_832, management_fee: 1_507, profit: 942, regulatory_fee: 753, pre_tax_total: 22_034, tax: 2_285, total: 24_319 },
    { boq_item_id: 9008, boq_code: "031001001001", boq_name: "镀锌钢管 螺纹连接", direct_cost: 23_940, management_fee: 1_915, profit: 1_197, regulatory_fee: 958, pre_tax_total: 28_010, tax: 2_906, total: 30_916 },
  ],
};

// ─── Dashboard 汇总 ─────────────────────────────────────────────

export const DEMO_DASHBOARD_SUMMARY: DashboardSummary = {
  project_id: DEMO_PROJECT_ID,
  boq_count: 8,
  unbound_count: 0,
  dirty_count: 0,
  validation_total: 5,
  validation_errors: 1,
  validation_warnings: 3,
  recent_audit_count: 12,
  recent_comment_count: 4,
  calc_total: 11_898_392,
} as DashboardSummary;

// ─── 审计校验 ───────────────────────────────────────────────────

export const DEMO_VALIDATION_REPORT: ValidationReport = {
  project_id: DEMO_PROJECT_ID,
  total_issues: 5,
  errors: 1,
  warnings: 3,
  issues: [
    { code: "RATE_ABNORMAL", severity: "error", boq_item_id: 9004, message: "HRB400 钢筋综合单价 4796 元/t，高于区域均价 4520 元/t（偏差 +6.1%）", suggestion: "建议复核人材机消耗量系数，或确认市场信息价来源" },
    { code: "QUANTITY_ANOMALY", severity: "warning", boq_item_id: 9003, message: "有梁板混凝土量 535.2 m³，板厚 120mm 推算面积约 4460 m²，与图纸标注面积 4200 m² 存在 6.2% 偏差", suggestion: "建议核对 IFC 模型体积与图纸面积的一致性" },
    { code: "BINDING_LOW_CONFIDENCE", severity: "warning", boq_item_id: 9007, message: "配管 SC25 套价定额置信度 0.72，低于阈值 0.80", suggestion: "建议人工复核定额匹配结果" },
    { code: "MISSING_DIVISION", severity: "warning", boq_item_id: null, message: "措施项目费未录入，当前措施费为系统估算值", suggestion: "建议补充脚手架、模板等措施项目清单" },
    { code: "SNAPSHOT_STALE", severity: "info", boq_item_id: null, message: "最近一次快照距今 18 天，期间有 3 项清单变更", suggestion: "建议生成新快照以保留版本对比基线" },
  ],
};

// ─── 审计流水线 ─────────────────────────────────────────────────

export const DEMO_PIPELINE_RESPONSE: PipelineResponse = {
  pipeline: "audit",
  stages: [
    { index: 0, handler: "数据校验", success: true, duration_s: 0.8, tool_calls: 3, answer: "校验 8 项清单，发现 5 个问题（1 错误 / 3 警告 / 1 提示）" },
    { index: 1, handler: "计价审查", success: true, duration_s: 1.2, tool_calls: 5, answer: "HRB400 钢筋单价偏高 6.1%，建议复核市场信息价" },
    { index: 2, handler: "风险扫描", success: true, duration_s: 0.6, tool_calls: 2, answer: "识别 2 项中风险：措施费缺失、快照过期" },
    { index: 3, handler: "汇总报告", success: true, duration_s: 0.4, tool_calls: 1, answer: "审计完成，生成 5 条审计发现，建议优先处理 1 项错误" },
  ],
  final_answer: "审计流水线完成。共校验 8 项清单，发现 5 个问题。优先处理：HRB400 钢筋综合单价偏高 6.1%（错误级）。建议复核人材机消耗量或确认信息价来源。",
  success: true,
  total_duration_s: 3.0,
  error: null,
};

// ─── 造价管理概览 ───────────────────────────────────────────────

export const DEMO_VALUATION_OVERVIEW: ValuationOverview = {
  project_id: DEMO_PROJECT_ID,
  standard: {
    project_id: DEMO_PROJECT_ID,
    standard_code: "GB/T50500-2024",
    standard_name: "建设工程工程量清单计价规范",
    effective_date: "2024-07-01",
    locked: true,
    locked_at: "2025-03-05T10:00:00Z",
  },
  stages: [
    { key: "contract", label: "合同计量", status: "done", detail: "8 项清单已确认" },
    { key: "adjustment", label: "价格调整", status: "done", detail: "2 项材料调差" },
    { key: "settlement", label: "进度结算", status: "active", detail: "第 3 期审核中" },
    { key: "final", label: "竣工结算", status: "pending", detail: "待竣工核实" },
  ],
  boq_count: 8,
  measurement_count: 8,
  adjustment_count: 2,
  payment_count: 2,
  adjustment_total: 86000,
  payment_net_total: 4_760_000,
};

// ─── 成果报表 ───────────────────────────────────────────────────

export const DEMO_REPORT_DATA: ReportData = {
  project: {
    id: DEMO_PROJECT_ID,
    name: DEMO_PROJECT.name,
    region: DEMO_PROJECT.region,
    project_type: DEMO_PROJECT.project_type,
    standard_type: DEMO_PROJECT.standard_type,
    currency: "CNY",
  },
  statistics: {
    total_items: 8,
    bound_count: 8,
    unbound_count: 0,
    binding_rate: "100%",
    calculated_items: 8,
  },
  cost_summary: {
    total_direct: DEMO_CALC_SUMMARY.total_direct,
    total_management: DEMO_CALC_SUMMARY.total_management,
    total_profit: DEMO_CALC_SUMMARY.total_profit,
    total_regulatory: DEMO_CALC_SUMMARY.total_regulatory,
    total_tax: DEMO_CALC_SUMMARY.total_tax,
    total_measures: DEMO_CALC_SUMMARY.total_measures,
    grand_total: DEMO_CALC_SUMMARY.grand_total,
  },
  divisions: [
    { division: "混凝土及钢筋混凝土工程", item_count: 3, bound_count: 3, total_cost: 659_849, percentage: "5.5%" },
    { division: "钢筋工程", item_count: 2, bound_count: 2, total_cost: 990_367, percentage: "8.3%" },
    { division: "电气设备安装工程", item_count: 2, bound_count: 2, total_cost: 125_562, percentage: "1.1%" },
    { division: "给排水工程", item_count: 1, bound_count: 1, total_cost: 30_916, percentage: "0.3%" },
  ],
  line_items: DEMO_BOQ_ITEMS.map((item, i) => ({
    boq_item_id: item.id,
    code: item.code,
    name: item.name,
    unit: item.unit,
    quantity: item.quantity,
    division: item.division,
    unit_price: DEMO_CALC_SUMMARY.line_results[i]?.total / item.quantity || null,
    total_cost: DEMO_CALC_SUMMARY.line_results[i]?.total || null,
    is_bound: true,
    quota_count: 1,
  })),
  generated_at: new Date().toISOString(),
};

// ─── 路由匹配 ───────────────────────────────────────────────────

/** 图纸识别演示结果 */
export const DEMO_DRAWING_RESULT = {
  taskId: "demo-drawing-001",
  status: "done" as const,
  drawing_type: "建筑施工图",
  summary: "识别 6 个图层，提取 42 个构件，自动套价 8 项清单",
  diagnostics: [
    "图层 ARCH-WALL 分类为 墙体 (置信度 0.96)",
    "图层 ARCH-COL 分类为 柱 (置信度 0.93)",
    "图层 ARCH-BEAM 分类为 梁 (置信度 0.91)",
    "图层 ARCH-DOOR 分类为 门窗 (置信度 0.88)",
    "图层 ELEC-LINE 分类为 电气线路 (置信度 0.85)",
    "图层 PIPE-WATER 分类为 给排水管道 (置信度 0.82)",
  ],
  layer_summary: [
    { layer: "ARCH-WALL", count: 18, classified_as: "墙体", entity_types: { LINE: 124, LWPOLYLINE: 18 } },
    { layer: "ARCH-COL", count: 8, classified_as: "柱", entity_types: { LINE: 48, CIRCLE: 8 } },
    { layer: "ARCH-BEAM", count: 12, classified_as: "梁", entity_types: { LINE: 72, LWPOLYLINE: 12 } },
    { layer: "ARCH-DOOR", count: 4, classified_as: "门窗", entity_types: { LINE: 16, ARC: 4 } },
  ],
  disciplines: [
    { key: "civil", name: "土建工程", ratio: 0.72, component_count: 38 },
    { key: "electrical", name: "电气工程", ratio: 0.18, component_count: 8 },
    { key: "plumbing", name: "给排水工程", ratio: 0.10, component_count: 4 },
  ],
  quality_score: {
    score: 92,
    level: "优良",
    coverage: 0.96,
    avg_confidence: 0.89,
    completeness: 0.94,
    discipline_count: 3,
    spec_extraction_rate: 0.88,
    issues: ["部分门窗构件缺少材质标注（4/42）"],
  },
  components: [
    { id: "C001", type: "框架柱", count: 8, spec: "C30 600×600mm", confidence: 0.96, material: "商品混凝土 C30", unit: "m³", quantity_estimate: 186.5, length_m: 0, area_m2: 0, layers: ["ARCH-COL"], calc_note: "按截面×层高×根数计算" },
    { id: "C002", type: "框架梁", count: 12, spec: "C30 300×600mm", confidence: 0.93, material: "商品混凝土 C30", unit: "m³", quantity_estimate: 342.8, length_m: 0, area_m2: 0, layers: ["ARCH-BEAM"], calc_note: "按截面×净跨×根数计算" },
    { id: "C003", type: "有梁板", count: 6, spec: "C30 板厚120mm", confidence: 0.91, material: "商品混凝土 C30", unit: "m³", quantity_estimate: 535.2, length_m: 0, area_m2: 4460, layers: ["ARCH-FLOOR"], calc_note: "按板面积×板厚计算" },
    { id: "C004", type: "HRB400钢筋", count: 1, spec: "直径综合 HRB400", confidence: 0.88, material: "HRB400钢筋", unit: "t", quantity_estimate: 124.6, length_m: 0, area_m2: 0, layers: ["ARCH-REBAR"], calc_note: "按含钢量估算" },
  ],
  boq_suggestions: [
    { source_component_id: "C001", suggested_code: "010401003001", suggested_name: "框架柱混凝土 C30", suggested_unit: "m³", suggested_quantity: 186.5, characteristics: "柱类型:框架柱;混凝土强度:C30", confidence: 0.95, material: "商品混凝土", component_count: 8 },
    { source_component_id: "C002", suggested_code: "010403002001", suggested_name: "矩形梁混凝土 C30", suggested_unit: "m³", suggested_quantity: 342.8, characteristics: "梁类型:框架梁;混凝土强度:C30", confidence: 0.93, material: "商品混凝土", component_count: 12 },
    { source_component_id: "C003", suggested_code: "010405001001", suggested_name: "有梁板混凝土 C30", suggested_unit: "m³", suggested_quantity: 535.2, characteristics: "板厚:120mm;混凝土强度:C30", confidence: 0.91, material: "商品混凝土", component_count: 6 },
    { source_component_id: "C004", suggested_code: "010515001001", suggested_name: "现浇构件钢筋 HRB400", suggested_unit: "t", suggested_quantity: 124.6, characteristics: "钢筋种类:HRB400;直径综合", confidence: 0.88, material: "HRB400钢筋", component_count: 1 },
  ],
  valuation: null,
  valuation_status: "done" as const,
  valuation_progress: "套价完成",
  valuation_progress_percent: 100,
  valuation_error: null,
};

/** 演示模式下 upload 函数的兜底返回 */
export const DEMO_UPLOAD_TASK_ID = { taskId: "demo-drawing-001" };

/**
 * 根据请求路径和方法匹配演示快照数据。
 * 返回 null 表示无匹配，请求将走真实 API。
 */
export function matchDemoSnapshot(path: string, method: string): unknown | null {
  // 仅拦截 GET 和部分 POST（审计流水线）
  const isPost = method === "POST";

  // 项目列表
  if (path === "/projects" || path.startsWith("/projects?")) return DEMO_PROJECT_LIST;

  // 项目详情
  const projectMatch = path.match(/^\/projects\/(\d+)(?:\/|$|\?)/);
  const pid = projectMatch ? Number(projectMatch[1]) : null;

  if (pid !== null) {
    if (path === `/projects/${pid}`) return DEMO_PROJECT;
    if (path === `/projects/${pid}/boq-items` || path.startsWith(`/projects/${pid}/boq-items?`)) return DEMO_BOQ_ITEMS;
    if (path === `/projects/${pid}/dashboard-summary`) return DEMO_DASHBOARD_SUMMARY;
    if (path === `/projects/${pid}/calc-summary`) return DEMO_CALC_SUMMARY;
    if (path === `/projects/${pid}/validation-issues`) return DEMO_VALIDATION_REPORT;
    if (path === `/projects/${pid}/valuation-management/overview`) return DEMO_VALUATION_OVERVIEW;
    if (path === `/projects/${pid}/report` || path.startsWith(`/projects/${pid}/report?`)) return DEMO_REPORT_DATA;
    if (isPost && path === `/projects/${pid}/pipeline/audit`) return DEMO_PIPELINE_RESPONSE;
    if (isPost && path === `/projects/${pid}/calculate`) return { ok: true, message: "演示模式：计价已完成" };
    if (isPost && path === `/projects/${pid}/calculate:dirty`) return { ok: true, updated: 0, message: "演示模式：无待重算项" };
  }

  // 定额匹配候选（图纸识别页可能用到）
  if (isPost && path.startsWith("/boq-items/") && path.endsWith("/quota-candidates")) {
    return [
      { quota_item_id: 8001, quota_code: "A4-1-2", quota_name: "现浇混凝土柱 框架柱 C30", unit: "m³", confidence: 0.95, reasons: ["名称匹配:框架柱", "强度等级匹配:C30", "单位匹配:m³"] },
      { quota_item_id: 8002, quota_code: "A4-1-5", quota_name: "现浇混凝土柱 构造柱 C30", unit: "m³", confidence: 0.78, reasons: ["强度等级匹配:C30", "单位匹配:m³"] },
    ];
  }

  // 快照列表
  if (path.match(/^\/projects\/\d+\/snapshots$/)) {
    return [
      { id: 8801, project_id: DEMO_PROJECT_ID, label: "施工图预算基线", created_at: "2025-05-28T09:00:00Z", grand_total: 11_580_000 },
      { id: 8802, project_id: DEMO_PROJECT_ID, label: "第 2 期进度结算", created_at: "2025-06-10T15:00:00Z", grand_total: 11_898_392 },
    ];
  }

  // 图纸识别结果
  if (path.startsWith("/drawing-recognition/") && !path.includes("/export")) {
    return DEMO_DRAWING_RESULT;
  }

  return null;
}
