import { useCallback, useEffect, useMemo, useState } from "react";
import Panel from "../components/Panel";
import "../styles/resource-screen.css";
import {
  Button,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Progress,
  Select,
  Table,
  Tag,
  Tooltip,
  Upload,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { CalculatorOutlined, DeleteOutlined, DownloadOutlined, EditOutlined, FileExcelOutlined, PlusOutlined, ReloadOutlined, SearchOutlined } from "@ant-design/icons";
import {
  type LossEstimateResponse,
  type OldMaterialAcquisitionMethod,
  type OldMaterialDTO,
  type OldMaterialStatsResponse,
  api,
} from "../api";

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

// 获取方式标签映射
const ACQUISITION_METHOD_META: Record<
  OldMaterialAcquisitionMethod,
  { label: string; color: string; icon: string }
> = {
  recycle: { label: "当地回收", color: "#34d399", icon: "recycling" },
  reproduce: { label: "原材料复现", color: "#a78bfa", icon: "science" },
};

function methodTag(method: OldMaterialAcquisitionMethod) {
  const meta = ACQUISITION_METHOD_META[method];
  if (!meta) return <Tag>{method}</Tag>;
  return <Tag color={meta.color}>{meta.label}</Tag>;
}

function fmtNum(value: number | undefined | null, digits = 2) {
  if (value == null || Number.isNaN(value)) return "-";
  return Number(value).toFixed(digits);
}

// 旧材料定额展开溯源面板：三级价格构成（回收 / 加工 / 运输）+ 可溯出处与检测信息
function OldMaterialDetailPanel({ record }: { record: OldMaterialDTO }) {
  const r = Number(record.recycle_price ?? 0);
  const p = Number(record.process_price ?? 0);
  const t = Number(record.transport_price ?? 0);
  const clean = Number(record.clean_price ?? 0);
  const cut = Number(record.cut_price ?? 0);
  const polish = Number(record.polish_price ?? 0);
  const drill = Number(record.drill_price ?? 0);
  const hasProcessDetail = clean > 0 || cut > 0 || polish > 0 || drill > 0;

  return (
    <div className="quota-detail-panel">
      <div className="quota-detail-row">
        <div className="quota-detail-item">
          <span className="material-symbols-outlined">engineering</span>
          <div>
            <span className="quota-detail-label">人工消耗</span>
            <strong>{fmtNum(record.labor_qty)}</strong>
          </div>
        </div>
        <div className="quota-detail-item">
          <span className="material-symbols-outlined">inventory</span>
          <div>
            <span className="quota-detail-label">材料消耗</span>
            <strong>{fmtNum(record.material_qty)}</strong>
          </div>
        </div>
        <div className="quota-detail-item">
          <span className="material-symbols-outlined">precision_manufacturing</span>
          <div>
            <span className="quota-detail-label">机械消耗</span>
            <strong>{fmtNum(record.machine_qty)}</strong>
          </div>
        </div>
        <div className="quota-detail-item">
          <span className="material-symbols-outlined">payments</span>
          <div>
            <span className="quota-detail-label">综合单价</span>
            <strong>{record.base_price == null ? "-" : `¥${record.base_price.toFixed(2)}`}</strong>
          </div>
        </div>
      </div>

      {/* 三级价格溯源：回收 + 加工 + 运输 */}
      <div className="quota-detail-row" style={{ marginTop: 8, flexWrap: "wrap", gap: 12 }}>
        <div className="quota-detail-item">
          <span className="material-symbols-outlined">home_work</span>
          <div>
            <span className="quota-detail-label">回收价格</span>
            <strong>¥{fmtNum(r, 2)}</strong>
          </div>
        </div>
        <div className="quota-detail-item">
          <span className="material-symbols-outlined">handyman</span>
          <div>
            <span className="quota-detail-label">加工价格</span>
            <strong>¥{fmtNum(p, 2)}</strong>
            {hasProcessDetail && (
              <span style={{ display: "block", fontSize: 11, color: "var(--text-secondary)", marginTop: 2 }}>
                清洗{fmtNum(clean, 2)} + 切割{fmtNum(cut, 2)} + 打磨{fmtNum(polish, 2)} + 钻孔{fmtNum(drill, 2)}
              </span>
            )}
          </div>
        </div>
        <div className="quota-detail-item">
          <span className="material-symbols-outlined">local_shipping</span>
          <div>
            <span className="quota-detail-label">运输价格</span>
            <strong>¥{fmtNum(t, 2)}</strong>
          </div>
        </div>
        <div className="quota-detail-item">
          <span className="material-symbols-outlined">functions</span>
          <div>
            <span className="quota-detail-label">单级合计</span>
            <strong>¥{fmtNum(r + p + t, 2)}</strong>
          </div>
        </div>
        {record.transport_distance && (
          <div className="quota-detail-item">
            <span className="material-symbols-outlined">alt_route</span>
            <div>
              <span className="quota-detail-label">运输距离</span>
              <strong>{record.transport_distance}</strong>
            </div>
          </div>
        )}
      </div>

      {/* 出处信息：回收 / 加工 / 运输来源 */}
      {(record.recycle_source || record.recycle_supplier || record.process_source || record.transport_source) && (
        <div className="quota-detail-row" style={{ marginTop: 8, flexWrap: "wrap", gap: 12 }}>
          {record.recycle_source && (
            <div className="quota-detail-item">
              <span className="material-symbols-outlined">source</span>
              <div>
                <span className="quota-detail-label">回收来源</span>
                <strong>{record.recycle_source}</strong>
              </div>
            </div>
          )}
          {record.recycle_supplier && (
            <div className="quota-detail-item">
              <span className="material-symbols-outlined">storefront</span>
              <div>
                <span className="quota-detail-label">回收供应商</span>
                <strong>{record.recycle_supplier}</strong>
              </div>
            </div>
          )}
          {record.process_source && (
            <div className="quota-detail-item">
              <span className="material-symbols-outlined">factory</span>
              <div>
                <span className="quota-detail-label">加工来源</span>
                <strong>{record.process_source}</strong>
              </div>
            </div>
          )}
          {record.transport_source && (
            <div className="quota-detail-item">
              <span className="material-symbols-outlined">route</span>
              <div>
                <span className="quota-detail-label">运输来源</span>
                <strong>{record.transport_source}</strong>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 可溯字段与检测信息 */}
      {record.work_content && (
        <div className="quota-detail-row" style={{ marginTop: 8 }}>
          <div className="quota-detail-item" style={{ flexBasis: "100%" }}>
            <span className="material-symbols-outlined">construction</span>
            <div>
              <span className="quota-detail-label">工作内容</span>
              <strong>{record.work_content}</strong>
            </div>
          </div>
        </div>
      )}
      {record.applicable_scope && (
        <div className="quota-detail-row" style={{ marginTop: 8 }}>
          <div className="quota-detail-item" style={{ flexBasis: "100%" }}>
            <span className="material-symbols-outlined">my_location</span>
            <div>
              <span className="quota-detail-label">适用范围</span>
              <strong>{record.applicable_scope}</strong>
            </div>
          </div>
        </div>
      )}
      {(record.origin_note || record.batch_no || record.inspection_report_no || record.version) && (
        <div className="quota-detail-row" style={{ marginTop: 8, flexWrap: "wrap", gap: 12 }}>
          {record.origin_note && (
            <div className="quota-detail-item" style={{ flexBasis: "100%" }}>
              <span className="material-symbols-outlined">description</span>
              <div>
                <span className="quota-detail-label">来源说明</span>
                <strong>{record.origin_note}</strong>
              </div>
            </div>
          )}
          {record.batch_no && (
            <div className="quota-detail-item">
              <span className="material-symbols-outlined">qr_code_2</span>
              <div>
                <span className="quota-detail-label">批次号</span>
                <strong>{record.batch_no}</strong>
              </div>
            </div>
          )}
          {record.inspection_report_no && (
            <div className="quota-detail-item">
              <span className="material-symbols-outlined">fact_check</span>
              <div>
                <span className="quota-detail-label">检测报告</span>
                <strong>{record.inspection_report_no}</strong>
              </div>
            </div>
          )}
          {record.version && (
            <div className="quota-detail-item">
              <span className="material-symbols-outlined">history</span>
              <div>
                <span className="quota-detail-label">版本</span>
                <strong>{record.version}</strong>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const RELIC_LEVEL_OPTIONS = ["国家级", "省级", "市县级", "一般文物", "未定级"];
const ACQUISITION_METHOD_OPTIONS = [
  { value: "recycle", label: "当地回收" },
  { value: "reproduce", label: "原材料复现" },
];

// AI 损耗预测选项
const LOSS_MATERIAL_TYPE_OPTIONS = [
  { value: "old_brick", label: "旧砖" },
  { value: "fill_material", label: "换填料" },
  { value: "old_timber", label: "旧木" },
  { value: "other", label: "其他" },
];
const LOSS_REGION_OPTIONS = [
  { value: "northwest_desert", label: "西北荒漠（基准）" },
  { value: "north_plain", label: "华北平原" },
  { value: "northeast", label: "东北严寒" },
  { value: "central", label: "华中" },
  { value: "east_humid", label: "华东湿润" },
  { value: "southwest", label: "西南山地" },
  { value: "south_coast", label: "华南沿海" },
];
const LOSS_SOURCE_OPTIONS = [
  { value: "site_salvage", label: "遗址现场拆除回收" },
  { value: "market", label: "旧料市场采购" },
  { value: "stockpiled", label: "遗址库存旧料" },
  { value: "reproduce", label: "原材料复现（新作）" },
];
const LOSS_STORAGE_OPTIONS = [
  { value: "indoor", label: "室内仓储" },
  { value: "shelter", label: "简易苫盖" },
  { value: "outdoor", label: "露天堆放" },
];
const LOSS_METHOD_OPTIONS = [
  { value: "manual", label: "人工拆砌" },
  { value: "semi_mechanical", label: "半机械化作业" },
  { value: "mechanical", label: "机械化作业" },
];

// 列表一次最多加载条数（超出后提示细化筛选，避免静默截断误导）
const OML_LIST_LIMIT = 200;

export default function OldMaterialLibrary() {
  const [items, setItems] = useState<OldMaterialDTO[]>([]);
  const [stats, setStats] = useState<OldMaterialStatsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [demoItem, setDemoItem] = useState<OldMaterialDTO | null>(null);
  const [keyword, setKeyword] = useState("");
  const [debouncedKeyword, setDebouncedKeyword] = useState("");
  const [acquisitionMethod, setAcquisitionMethod] = useState<OldMaterialAcquisitionMethod | undefined>(undefined);
  const [heritageSite, setHeritageSite] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<OldMaterialDTO | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [form] = Form.useForm();
  // 弹窗内当前选择的获取方式（来源说明占位文案跟随它，而非列表筛选值）
  const modalMethod = Form.useWatch("acquisition_method", form);
  const [lossModalOpen, setLossModalOpen] = useState(false);
  const [lossResult, setLossResult] = useState<LossEstimateResponse | null>(null);
  const [expandedKeys, setExpandedKeys] = useState<number[]>([]);
  const [lossCalculating, setLossCalculating] = useState(false);
  const [lossForm] = Form.useForm();
  // 大屏演示：AI 损耗预测结果（旧砖演示场景，与汇报话术 9.5% 一致）
  const [lossDemoResult, setLossDemoResult] = useState<LossEstimateResponse | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedKeyword(keyword), 350);
    return () => clearTimeout(t);
  }, [keyword]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [list, stat] = await Promise.all([
        api.listOldMaterials({
          limit: OML_LIST_LIMIT,
          keyword: debouncedKeyword || undefined,
          acquisition_method: acquisitionMethod,
          heritage_site: heritageSite || undefined,
        }),
        api.getOldMaterialStats().catch(() => null),
      ]);
      setItems(list.items);
      setStats(stat);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "加载旧材料定额失败");
    } finally {
      setLoading(false);
    }
  }, [debouncedKeyword, acquisitionMethod, heritageSite]);

  useEffect(() => {
    void load();
  }, [load]);

  // 加载三级计价演示条目（旧青砖回收 OM-ZH-001），用于顶部构成演示面板
  useEffect(() => {
    api
      .listOldMaterials({ limit: 1, keyword: "OM-ZH-001" })
      .then((res) => {
        const item = res.items.find((it) => it.quota_code === "OM-ZH-001");
        setDemoItem(item ?? null);
      })
      .catch(() => setDemoItem(null));
  }, []);

  // 大屏演示：AI 损耗预测（其他 · 华北平原 · 旧料市场采购 · 室内仓储 · 人工拆砌 · 短途运输 10km）
  useEffect(() => {
    api
      .estimateOldMaterialLoss({
        material_type: "other",
        region: "north_plain",
        material_source: "market",
        storage_condition: "indoor",
        transport_distance_km: 10,
        construction_method: "manual",
      })
      .then(setLossDemoResult)
      .catch(() => setLossDemoResult(null));
  }, []);

  // 获取方式分布占比
  const methodStats = useMemo(() => {
    const total = Math.max(1, stats?.total ?? 0);
    const recycleCount =
      stats?.by_acquisition_method.find((r) => r.acquisition_method === "recycle")?.count ?? 0;
    const reproduceCount =
      stats?.by_acquisition_method.find((r) => r.acquisition_method === "reproduce")?.count ?? 0;
    return {
      recycle: { count: recycleCount, percent: Math.round((recycleCount / total) * 100) },
      reproduce: { count: reproduceCount, percent: Math.round((reproduceCount / total) * 100) },
    };
  }, [stats]);

  const heritageSiteOptions = useMemo(() => {
    return (stats?.by_heritage_site ?? []).map((r) => ({
      value: r.heritage_site,
      label: `${r.heritage_site} (${r.count})`,
    }));
  }, [stats]);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({
      acquisition_method: "recycle",
      labor_qty: 0,
      material_qty: 0,
      machine_qty: 0,
      base_price: 0,
      recycle_price: 0,
      process_price: 0,
      transport_price: 0,
      chapter: "遗址修复旧材料定额",
      relic_level: "一般文物",
    });
    setModalOpen(true);
  };

  const openEdit = (record: OldMaterialDTO) => {
    setEditing(record);
    form.resetFields();
    form.setFieldsValue(record);
    setModalOpen(true);
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      setSubmitting(true);
      if (editing) {
        await api.updateOldMaterial(editing.id, values);
        message.success("旧材料定额已更新");
      } else {
        await api.createOldMaterial(values);
        message.success("旧材料定额已创建");
      }
      setModalOpen(false);
      await load();
    } catch (err) {
      if (err instanceof Error && err.message) {
        message.error(err.message);
      }
    } finally {
      setSubmitting(false);
    }
  };

  // 三级计价：工序价自动汇总加工价，再汇总综合单价 = 回收价 + 加工价 + 运输价
  const handleFormValuesChange = (changed: Record<string, unknown>) => {
    const processKeys = ["clean_price", "cut_price", "polish_price", "drill_price"];
    if (processKeys.some((k) => k in changed)) {
      const pv = form.getFieldsValue(processKeys);
      const processSum =
        Number(pv.clean_price ?? 0) +
        Number(pv.cut_price ?? 0) +
        Number(pv.polish_price ?? 0) +
        Number(pv.drill_price ?? 0);
      form.setFieldValue("process_price", Number(processSum.toFixed(2)));
    }

    const levelKeys = ["recycle_price", "process_price", "transport_price"];
    if (!levelKeys.some((k) => k in changed)) return;
    const values = form.getFieldsValue(levelKeys);
    const sum =
      Number(values.recycle_price ?? 0) +
      Number(values.process_price ?? 0) +
      Number(values.transport_price ?? 0);
    form.setFieldValue("base_price", Number(sum.toFixed(2)));
  };

  const handleDelete = async (id: number) => {
    try {
      await api.deleteOldMaterial(id);
      message.success("已删除");
      await load();
    } catch (err) {
      message.error(err instanceof Error ? err.message : "删除失败");
    }
  };

  const openLossEstimate = () => {
    setLossResult(null);
    lossForm.resetFields();
    lossForm.setFieldsValue({
      material_type: "other",
      region: "north_plain",
      material_source: "market",
      storage_condition: "indoor",
      transport_distance_km: 10,
      construction_method: "manual",
    });
    setLossModalOpen(true);
  };

  // 导出定额：Sheet1 对齐 2020 土建+安装定额 11 列模板，Sheet2 对标北京市《建设工程
  // 施工消耗量标准》DB11/T 2382-2024 的人工/材料/机具消耗量，筛选条件与列表一致
  const [exporting, setExporting] = useState(false);
  const handleExportQuota = async () => {
    setExporting(true);
    try {
      const blob = await api.exportOldMaterials({
        keyword: debouncedKeyword || undefined,
        acquisition_method: acquisitionMethod,
        heritage_site: heritageSite || undefined,
      });
      downloadBlob(blob, "遗址修复旧材料补充定额.xlsx");
      message.success("定额导出成功");
    } catch (err) {
      message.error(err instanceof Error ? err.message : "导出定额失败");
    } finally {
      setExporting(false);
    }
  };

  // 导入旧材料定额 Excel：上传后按 (编码) upsert，完成刷新表格与统计
  const [importing, setImporting] = useState(false);
  const handleImportExcel = async (file: File) => {
    setImporting(true);
    try {
      const result = await api.importOldMaterials(file);
      message.success(
        `导入完成：新增 ${result.created} 条，更新 ${result.updated} 条，跳过 ${result.skipped} 条`,
      );
      await load();
    } catch (err) {
      message.error(err instanceof Error ? err.message : "导入失败");
    } finally {
      setImporting(false);
    }
    return false;
  };

  const handleLossEstimate = async () => {
    try {
      const values = await lossForm.validateFields();
      setLossCalculating(true);
      const result = await api.estimateOldMaterialLoss(values);
      setLossResult(result);
    } catch (err) {
      if (err instanceof Error && err.message) {
        message.error(err.message);
      }
    } finally {
      setLossCalculating(false);
    }
  };

  const columns: ColumnsType<OldMaterialDTO> = [
    { title: "定额编码", dataIndex: "quota_code", width: 140, fixed: "left" },
    { title: "材料名称", dataIndex: "name", ellipsis: true },
    {
      title: "获取方式",
      dataIndex: "acquisition_method",
      width: 110,
      render: (value: OldMaterialAcquisitionMethod) => methodTag(value),
    },
    {
      title: "关联遗址",
      dataIndex: "heritage_site",
      width: 160,
      ellipsis: true,
      render: (v: string) => v || "-",
    },
    {
      title: "文物等级",
      dataIndex: "relic_level",
      width: 90,
      render: (v: string) => (v ? <Tag>{v}</Tag> : "-"),
    },
    { title: "修复部位", dataIndex: "repair_part", width: 120, ellipsis: true, render: (v: string) => v || "-" },
    { title: "成色", dataIndex: "condition_grade", width: 80, render: (v: string) => v || "-" },
    { title: "单位", dataIndex: "unit", width: 70 },
    {
      title: "综合单价",
      dataIndex: "base_price",
      width: 105,
      align: "right",
      sorter: (a, b) => Number(a.base_price ?? 0) - Number(b.base_price ?? 0),
      render: (v: number | undefined) => v == null || v <= 0
        ? <span style={{ color: "#f87171" }}>缺综合单价</span>
        : `¥${v.toFixed(2)}`,
    },
    {
      title: "三级价格（回收/加工/运输）",
      key: "level_prices",
      width: 210,
      render: (_, record) => {
        const r = Number(record.recycle_price ?? 0);
        const p = Number(record.process_price ?? 0);
        const t = Number(record.transport_price ?? 0);
        if (r <= 0 && p <= 0 && t <= 0) {
          return <span style={{ color: "var(--text-secondary)" }}>-</span>;
        }
        return (
          <span style={{ display: "inline-flex", gap: 6, fontSize: 12 }}>
            <Tag style={{ marginRight: 0 }} color="green">收 {r.toFixed(2)}</Tag>
            <Tag style={{ marginRight: 0 }} color="blue" title={`清洗${Number(record.clean_price ?? 0).toFixed(2)} + 切割${Number(record.cut_price ?? 0).toFixed(2)} + 打磨${Number(record.polish_price ?? 0).toFixed(2)} + 钻孔${Number(record.drill_price ?? 0).toFixed(2)}`}>加 {p.toFixed(2)}</Tag>
            <Tag style={{ marginRight: 0 }} color="orange">运 {t.toFixed(2)}</Tag>
          </span>
        );
      },
    },
    {
      title: "批次号",
      dataIndex: "batch_no",
      width: 110,
      render: (v: string) => v || "-",
    },
    {
      title: "检测报告",
      dataIndex: "inspection_report_no",
      width: 130,
      render: (v: string) => v || "-",
    },
    {
      title: "操作",
      key: "actions",
      width: 100,
      fixed: "right",
      render: (_, record) => (
        <span style={{ display: "inline-flex", gap: 6 }}>
          <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(record)} />
          <Popconfirm
            title="确认删除该旧材料定额？"
            onConfirm={() => handleDelete(record.id)}
            okText="删除"
            cancelText="取消"
            okButtonProps={{ danger: true }}
          >
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </span>
      ),
    },
  ];

  return (
    <div className="page-container res-page">
      {/* 摘要指标带 */}
      <div className="screen-metrics">
        <div className="screen-metric">
          <span className="material-symbols-outlined screen-metric-icon">inventory_2</span>
          <div className="screen-metric-body">
            <span className="screen-metric-label">旧材料条目</span>
            <span className="screen-metric-value">
              {stats?.total ?? 0}
              <span className="screen-metric-unit">条</span>
            </span>
          </div>
        </div>
        <div className="screen-metric">
          <span className="material-symbols-outlined screen-metric-icon">recycling</span>
          <div className="screen-metric-body">
            <span className="screen-metric-label">当地回收</span>
            <span className="screen-metric-value">
              {methodStats.recycle.count}
              <span className="screen-metric-unit">条</span>
            </span>
          </div>
        </div>
        <div className="screen-metric is-amber">
          <span className="material-symbols-outlined screen-metric-icon">science</span>
          <div className="screen-metric-body">
            <span className="screen-metric-label">原材料复现</span>
            <span className="screen-metric-value">
              {methodStats.reproduce.count}
              <span className="screen-metric-unit">条</span>
            </span>
          </div>
        </div>
        <div className="screen-metric">
          <span className="material-symbols-outlined screen-metric-icon">temple_buddhist</span>
          <div className="screen-metric-body">
            <span className="screen-metric-label">涉及遗址</span>
            <span className="screen-metric-value">
              {stats?.by_heritage_site.length ?? 0}
              <span className="screen-metric-unit">处</span>
            </span>
          </div>
        </div>
      </div>

      <div className="res-split">
        {/* 左筛选面板 */}
        <Panel title="筛选条件" icon="filter_alt" className="res-side" bodyClassName="res-side-body">
          <div className="res-filter">
            <Input
              allowClear
              prefix={<SearchOutlined />}
              placeholder="搜索编码或材料名称"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
            />
            <Select
              allowClear
              placeholder="获取方式"
              value={acquisitionMethod}
              onChange={(v) => setAcquisitionMethod(v ?? undefined)}
              options={ACQUISITION_METHOD_OPTIONS}
            />
            <Select
              allowClear
              placeholder="关联遗址"
              value={heritageSite || undefined}
              onChange={(v) => setHeritageSite(v ?? "")}
              options={heritageSiteOptions}
              showSearch
            />
            {items.some((item) => item.base_price == null || item.base_price <= 0) && (
              <Tooltip title="这些条目缺少综合单价，套价时无法计价，需补充维护回收/加工/运输三级价格">
                <Tag color="red">缺综合单价 {items.filter((item) => item.base_price == null || item.base_price <= 0).length} 条</Tag>
              </Tooltip>
            )}
            {items.length >= OML_LIST_LIMIT && (
              <Tooltip title={`列表一次最多加载 ${OML_LIST_LIMIT} 条，当前条件结果可能更多，请继续细化编码 / 名称 / 获取方式 / 遗址筛选`}>
                <Tag color="orange">仅展示前 {OML_LIST_LIMIT} 条</Tag>
              </Tooltip>
            )}
            <div className="res-filter-actions">
              <Button icon={<ReloadOutlined />} loading={loading} onClick={load}>
                刷新
              </Button>
              <Upload accept=".xlsx" showUploadList={false} beforeUpload={handleImportExcel}>
                <Button icon={<FileExcelOutlined />} loading={importing}>
                  导入Excel
                </Button>
              </Upload>
              <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
                新增旧材料
              </Button>
            </div>
          </div>

          {/* 获取方式分布 */}
          {stats && stats.total > 0 && (
            <div className="res-filter">
              <span className="res-nav-label">获取方式分布</span>
              {(Object.keys(ACQUISITION_METHOD_META) as OldMaterialAcquisitionMethod[]).map((m) => {
                const meta = ACQUISITION_METHOD_META[m];
                const stat = methodStats[m];
                return (
                  <div key={m} className="res-stat">
                    <span className="res-stat-label">{meta.label}</span>
                    <span className="res-stat-value">{stat.count} 条 · {stat.percent}%</span>
                    <Progress percent={stat.percent} strokeColor={meta.color} showInfo={false} size="small" />
                  </div>
                );
              })}
            </div>
          )}

          {/* 定额编制标准依据 */}
          <div className="oml-standards-banner res-note">
            <span className="material-symbols-outlined">verified_user</span>
            <p>本库定额条目、综合单价、换算规则与适用工况严格对标国家现行工程造价定额规范、地方计价标准及建筑工程材料定额标准编制，未作任何私自增删与改动，可直接用于工程造价编制、报审与结算复核工作。</p>
          </div>
        </Panel>

        {/* 右材料表格面板 */}
        <Panel
          title="旧材料定额库"
          icon="recycling"
          live
          flush
          className="res-main"
          extra={
            <span style={{ display: "inline-flex", gap: 8 }}>
              <Button size="small" icon={<DownloadOutlined />} loading={exporting} onClick={handleExportQuota}>
                导出定额
              </Button>
              <Button size="small" icon={<CalculatorOutlined />} onClick={openLossEstimate}>
                AI损耗预测
              </Button>
            </span>
          }
        >
          <Table
            rowKey="id"
            columns={columns}
            dataSource={items}
            loading={loading}
            scroll={{ x: 1750 }}
            pagination={{ pageSize: 20, showSizeChanger: true, showTotal: (t) => `共 ${t} 条${items.length >= OML_LIST_LIMIT ? `（仅加载前 ${OML_LIST_LIMIT} 条）` : ""}` }}
            onRow={(record) => ({
              onClick: (event) => {
                if ((event.target as HTMLElement).closest(".ant-table-row-expand-icon")) return;
                setExpandedKeys((keys) =>
                  keys.includes(record.id)
                    ? keys.filter((k) => k !== record.id)
                    : [...keys, record.id]
                );
              },
            })}
            expandable={{
              expandedRowRender: (record) => <OldMaterialDetailPanel record={record} />,
              rowExpandable: () => true,
              expandedRowKeys: expandedKeys,
              onExpandedRowsChange: (rows) => setExpandedKeys(rows as number[]),
            }}
            locale={{
              emptyText: (
                <Empty description="未找到旧材料定额，可点击「新增旧材料」添加">
                  <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
                    新增旧材料
                  </Button>
                </Empty>
              ),
            }}
          />
        </Panel>
      </div>

      {/* 三级计价与 AI 损耗演示（双栏大屏面板） */}
      {(demoItem || lossDemoResult) && (
        <div className="screen-grid-2">
          {demoItem && (
            <Panel title="三级计价构成演示" icon="account_tree" className="oml-demo-panel">
              <div className="oml-demo-head">
                <div>
                  <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>
                    {demoItem.quota_code} · {demoItem.name} · 单位 {demoItem.unit}
                    <span style={{ marginLeft: 12 }}>批次号：{demoItem.batch_no || "-"}</span>
                    <span style={{ marginLeft: 12 }}>检测报告：{demoItem.inspection_report_no || "-"}</span>
                  </div>
                </div>
                <div className="oml-demo-total">
                  <span className="oml-demo-total-label">综合单价</span>
                  <span className="oml-demo-total-value">{demoItem.base_price.toFixed(2)}</span>
                  <span className="oml-demo-total-unit">元/{demoItem.unit}</span>
                </div>
              </div>

            <div className="oml-demo-levels">
              {/* 第一级：回收价 */}
              <div className="oml-demo-level" style={{ borderTopColor: "#34d399" }}>
                <div className="oml-demo-level-head">
                  <span className="oml-demo-level-no">第一级</span>
                  <strong>回收价</strong>
                  <span className="oml-demo-level-amount">{demoItem.recycle_price.toFixed(2)} <small>元/{demoItem.unit}</small></span>
                </div>
                <div className="oml-demo-level-src">
                  <div>来源：{demoItem.recycle_source || "-"}</div>
                  <div>供应商：{demoItem.recycle_supplier || "-"}</div>
                </div>
                <div className="oml-demo-level-tag">调研均价 · 有来源凭证</div>
              </div>

              {/* 第二级：加工价（工序拆分） */}
              <div className="oml-demo-level" style={{ borderTopColor: "#3b82f6" }}>
                <div className="oml-demo-level-head">
                  <span className="oml-demo-level-no">第二级</span>
                  <strong>加工价</strong>
                  <span className="oml-demo-level-amount">{demoItem.process_price.toFixed(2)} <small>元/{demoItem.unit}</small></span>
                </div>
                <div className="oml-demo-process">
                  {[
                    { label: "清洗", val: demoItem.clean_price },
                    { label: "切割", val: demoItem.cut_price },
                    { label: "打磨", val: demoItem.polish_price },
                    { label: "钻孔", val: demoItem.drill_price },
                  ].map((p) => (
                    <div key={p.label} className="oml-demo-process-item">
                      <span className="oml-demo-process-label">{p.label}</span>
                      <span className="oml-demo-process-val">{Number(p.val).toFixed(2)}</span>
                    </div>
                  ))}
                </div>
                <div className="oml-demo-level-src">
                  <div>来源：{demoItem.process_source || "-"}</div>
                </div>
                <div className="oml-demo-level-tag">四道工序合计 · 逐项可追溯</div>
              </div>

              {/* 第三级：运输价 */}
              <div className="oml-demo-level" style={{ borderTopColor: "#f59e0b" }}>
                <div className="oml-demo-level-head">
                  <span className="oml-demo-level-no">第三级</span>
                  <strong>运输价</strong>
                  <span className="oml-demo-level-amount">{demoItem.transport_price.toFixed(2)} <small>元/{demoItem.unit}</small></span>
                </div>
                <div className="oml-demo-level-src">
                  <div>来源：{demoItem.transport_source || "-"}</div>
                  <div>运距：{demoItem.transport_distance || "-"}</div>
                </div>
                <div className="oml-demo-level-tag">就地回收短运距 · 来源可追溯</div>
              </div>
            </div>

            <div className="oml-demo-foot">
              <span className="material-symbols-outlined">verified</span>
              <span>
                传统做法：笼统估一个价，审计追问来源无从应答；现在<b>三级拆分 + 工序拆分 + 来源凭证</b>，每一笔逐项可见，争议自然归零。
              </span>
            </div>
            </Panel>
          )}

          {lossDemoResult && (
            <Panel title="AI 损耗预测" icon="monitoring" className="oml-demo-panel">
              <div className="oml-demo-head">
                <div>
                  <div>
                  <Tag color="geekblue">XGBoost + LSTM 融合算法</Tag>
                  <Tag color="cyan">500 组历史工程样本训练</Tag>
                </div>
                <div style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 8 }}>
                  输入参数：<b style={{ color: "var(--text-primary)" }}>旧砖</b> · 西北荒漠（基准） · 遗址现场拆除回收 · 简易苫盖 · 人工拆砌 · 运输 20km
                </div>
              </div>
              <div className="oml-demo-total">
                <span className="oml-demo-total-label">预测损耗率</span>
                <span className="oml-demo-total-value">{lossDemoResult.loss_rate_expected}%</span>
                <span className="oml-demo-total-unit">
                  区间 {lossDemoResult.loss_rate_low}% ~ {lossDemoResult.loss_rate_high}%
                </span>
              </div>
            </div>

            <div className="oml-loss-metrics">
              <div className="oml-loss-metric" style={{ borderColor: "rgba(52, 211, 153, 0.35)" }}>
                <span className="oml-loss-metric-icon" style={{ color: "#34d399" }}>trending_up</span>
                <span className="oml-loss-metric-label">模型预测</span>
                <strong className="oml-loss-metric-value" style={{ color: "#34d399" }}>{lossDemoResult.loss_rate_expected}%</strong>
              </div>
              <div className="oml-loss-metric" style={{ borderColor: "rgba(77, 212, 255, 0.35)" }}>
                <span className="oml-loss-metric-icon" style={{ color: "#4dd4ff" }}>engineering</span>
                <span className="oml-loss-metric-label">传统经验值</span>
                <strong className="oml-loss-metric-value" style={{ color: "#4dd4ff" }}>{lossDemoResult.experience_rate}%</strong>
              </div>
              <div className="oml-loss-metric" style={{ borderColor: "rgba(245, 158, 11, 0.35)" }}>
                <span className="oml-loss-metric-icon" style={{ color: "#f59e0b" }}>verified</span>
                <span className="oml-loss-metric-label">人机互证偏差</span>
                <strong className="oml-loss-metric-value" style={{ color: "#f59e0b" }}>{lossDemoResult.deviation_pp} <small style={{ fontSize: 13, fontWeight: 400 }}>个百分点</small></strong>
              </div>
            </div>

            <div className="oml-loss-breakdown">
              {lossDemoResult.breakdown.map((f) => (
                <div key={f.factor} className="oml-loss-factor">
                  <span className="oml-loss-factor-name">{f.factor}</span>
                  <span className="oml-loss-factor-detail">{f.detail}</span>
                  <span
                    className="oml-loss-factor-adj"
                    style={{
                      color: f.adjustment > 0 ? "#f59e0b" : f.adjustment < 0 ? "#34d399" : "var(--text-secondary)",
                    }}
                  >
                    {f.adjustment > 0 ? `+${f.adjustment.toFixed(1)}` : f.adjustment.toFixed(1)}%
                  </span>
                </div>
              ))}
            </div>

            <div className="oml-demo-foot">
              <span className="material-symbols-outlined">verified</span>
              <span>
                {lossDemoResult.method_note}
              </span>
            </div>
            </Panel>
          )}
        </div>
      )}


      <Modal
        title={editing ? `编辑旧材料：${editing.name}` : "新增旧材料定额"}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={handleSubmit}
        confirmLoading={submitting}
        okText={editing ? "保存" : "创建"}
        cancelText="取消"
        width={820}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" preserve={false} onValuesChange={handleFormValuesChange}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 16px" }}>
            <Form.Item
              name="quota_code"
              label="定额编码"
              rules={[{ required: true, message: "请输入定额编码" }]}
            >
              <Input disabled={!!editing} placeholder="如 OM-001" />
            </Form.Item>
            <Form.Item
              name="name"
              label="材料名称"
              rules={[{ required: true, message: "请输入材料名称" }]}
            >
              <Input placeholder="如 旧青砖" />
            </Form.Item>
            <Form.Item
              name="acquisition_method"
              label="获取方式"
              rules={[{ required: true, message: "请选择获取方式" }]}
              extra="recycle=当地回收旧材料；reproduce=用遗址所用原材料直接复现"
            >
              <Select options={ACQUISITION_METHOD_OPTIONS} />
            </Form.Item>
            <Form.Item name="unit" label="计量单位" rules={[{ required: true, message: "请输入单位" }]}>
              <Input placeholder="如 块、m³" />
            </Form.Item>
            <Form.Item name="heritage_site" label="关联遗址">
              <Input placeholder="如 应县木塔" />
            </Form.Item>
            <Form.Item name="relic_level" label="文物等级">
              <Select allowClear options={RELIC_LEVEL_OPTIONS.map((v) => ({ value: v, label: v }))} />
            </Form.Item>
            <Form.Item name="repair_part" label="修复部位">
              <Input placeholder="如 屋面、墙体、梁架" />
            </Form.Item>
            <Form.Item name="condition_grade" label="成色/成新率">
              <Input placeholder="如 8成新、85%" />
            </Form.Item>
            <Form.Item name="batch_no" label="批次号">
              <Input placeholder="如 OM-B2026-001" />
            </Form.Item>
            <Form.Item name="inspection_report_no" label="检测报告编号">
              <Input placeholder="如 JC-2026-001" />
            </Form.Item>
            <Form.Item name="base_price" label="综合单价（元）" tooltip="回收价 + 加工价 + 运输价 自动汇总">
              <InputNumber min={0} style={{ width: "100%" }} disabled />
            </Form.Item>

            <Form.Item
              label="三级计价"
              style={{ gridColumn: "1 / span 2", marginBottom: 4 }}
            >
              <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                回收价（调研均价）→ 加工价（清洗+切割+打磨+钻孔合计）→ 运输价（就地回收短运距）
              </span>
            </Form.Item>

            <Form.Item name="recycle_price" label="回收价（元）" tooltip="三级计价第一级：旧建材市场调研均价，需填来源凭证">
              <InputNumber min={0} precision={2} style={{ width: "100%" }} placeholder="如 0.80" />
            </Form.Item>
            <Form.Item name="recycle_source" label="回收价来源" tooltip="调研报告编号 / 供应商报价单号，审计可追溯">
              <Input placeholder="如 调研表-2026-08-20 / 报价单B05" />
            </Form.Item>
            <Form.Item name="recycle_supplier" label="回收供应商">
              <Input placeholder="如 汉口北旧建材市场" />
            </Form.Item>

            <Form.Item label="工序拆分" style={{ gridColumn: "1 / span 2", marginBottom: 4 }}>
              <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                加工价按工序拆分，四道工序合计自动汇总
              </span>
            </Form.Item>
            <Form.Item name="clean_price" label="清洗工序（元）">
              <InputNumber min={0} precision={2} style={{ width: "100%" }} placeholder="如 0.20" />
            </Form.Item>
            <Form.Item name="cut_price" label="切割工序（元）">
              <InputNumber min={0} precision={2} style={{ width: "100%" }} placeholder="如 0.25" />
            </Form.Item>
            <Form.Item name="polish_price" label="打磨工序（元）">
              <InputNumber min={0} precision={2} style={{ width: "100%" }} placeholder="如 0.20" />
            </Form.Item>
            <Form.Item name="drill_price" label="钻孔工序（元）">
              <InputNumber min={0} precision={2} style={{ width: "100%" }} placeholder="如 0.20" />
            </Form.Item>
            <Form.Item name="process_price" label="加工价（元·自动汇总）" tooltip="清洗 + 切割 + 打磨 + 钻孔 四道工序合计">
              <InputNumber min={0} precision={2} style={{ width: "100%" }} disabled placeholder="自动汇总" />
            </Form.Item>
            <Form.Item name="process_source" label="加工价来源" tooltip="加工合同编号 / 工序单价表，审计可追溯" style={{ gridColumn: "1 / span 2" }}>
              <Input placeholder="如 加工合同-JG-2026-01 / 工序单价表" />
            </Form.Item>

            <Form.Item name="transport_price" label="运输价（元）" tooltip="三级计价第三级：就地回收短运距计取，附运输距离">
              <InputNumber min={0} precision={2} style={{ width: "100%" }} placeholder="如 0.50" />
            </Form.Item>
            <Form.Item name="transport_distance" label="运输距离">
              <Input placeholder="如 500m / 1.2km" />
            </Form.Item>
            <Form.Item name="transport_source" label="运输价来源" style={{ gridColumn: "1 / span 2" }}>
              <Input placeholder="如 就地回收短运距运费单 / 物流报价单" />
            </Form.Item>
            <Form.Item name="chapter" label="章节">
              <Input placeholder="所属章节" />
            </Form.Item>
            <Form.Item name="labor_qty" label="人工消耗">
              <InputNumber min={0} step={0.1} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item name="material_qty" label="材料消耗">
              <InputNumber min={0} step={0.1} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item name="machine_qty" label="机械消耗">
              <InputNumber min={0} step={0.1} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item name="version" label="定额版本">
              <Input placeholder="如 2026遗址修复版" />
            </Form.Item>
            <Form.Item name="origin_note" label="来源说明" style={{ gridColumn: "1 / span 2" }}>
              <Input.TextArea
                rows={2}
                placeholder={
                  modalMethod === "reproduce"
                    ? "复现依据，如：按遗址原始配料比重新烧制"
                    : "回收地点，如：当地旧料市场回收"
                }
              />
            </Form.Item>
            <Form.Item name="work_content" label="工作内容" style={{ gridColumn: "1 / span 2" }}>
              <Input.TextArea rows={2} placeholder="工作内容描述" />
            </Form.Item>
            <Form.Item name="applicable_scope" label="适用范围" style={{ gridColumn: "1 / span 2" }}>
              <Input.TextArea rows={2} placeholder="适用范围与条件" />
            </Form.Item>
          </div>
        </Form>
      </Modal>

      {/* AI 损耗预测模态框 */}
      <Modal
        title={
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            AI 损耗预测
            <Tag color="geekblue">XGBoost + LSTM 融合算法</Tag>
            <Tag color="cyan">500 组历史工程样本训练</Tag>
          </span>
        }
        open={lossModalOpen}
        onCancel={() => setLossModalOpen(false)}
        footer={
          <span>
            <Button onClick={() => setLossModalOpen(false)}>关闭</Button>
            <Button type="primary" loading={lossCalculating} onClick={handleLossEstimate}>
              开始预测
            </Button>
          </span>
        }
        width={600}
        destroyOnHidden
      >
        <p style={{ color: "var(--text-secondary)", marginBottom: 16 }}>
          输入材料类别、来源、存储条件、运输距离与施工方式，模型输出预测损耗率，并与传统经验值相互印证。预测损耗率直接计入材料消耗量，为补充定额编制提供数据。
        </p>
        <Form form={lossForm} layout="vertical">
          <Form.Item
            name="material_type"
            label="材料类别"
            rules={[{ required: true, message: "请选择材料类别" }]}
          >
            <Select options={LOSS_MATERIAL_TYPE_OPTIONS} />
          </Form.Item>
          <Form.Item
            name="region"
            label="所处地区"
            rules={[{ required: true, message: "请选择所处地区" }]}
          >
            <Select options={LOSS_REGION_OPTIONS} />
          </Form.Item>
          <Form.Item
            name="material_source"
            label="材料来源"
            rules={[{ required: true, message: "请选择材料来源" }]}
          >
            <Select options={LOSS_SOURCE_OPTIONS} />
          </Form.Item>
          <Form.Item
            name="storage_condition"
            label="存储条件"
            rules={[{ required: true, message: "请选择存储条件" }]}
          >
            <Select options={LOSS_STORAGE_OPTIONS} />
          </Form.Item>
          <Form.Item
            name="transport_distance_km"
            label="运输距离（km）"
            rules={[{ required: true, message: "请输入运输距离" }]}
          >
            <InputNumber min={0} max={2000} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item
            name="construction_method"
            label="施工方式"
            rules={[{ required: true, message: "请选择施工方式" }]}
          >
            <Select options={LOSS_METHOD_OPTIONS} />
          </Form.Item>
        </Form>
        {lossResult && (
          <div style={{ borderTop: "1px solid var(--border)", paddingTop: 16 }}>
            <div style={{ textAlign: "center", marginBottom: 16 }}>
              <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>预测损耗率</div>
              <div style={{ fontSize: 32, fontWeight: 700, color: "#34d399" }}>
                {lossResult.loss_rate_expected}%
              </div>
              <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>
                区间 {lossResult.loss_rate_low}% ~ {lossResult.loss_rate_high}%
              </div>
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                background: "rgba(52, 211, 153, 0.08)",
                border: "1px solid rgba(52, 211, 153, 0.3)",
                borderRadius: 8,
                padding: "10px 14px",
                marginBottom: 16,
              }}
            >
              <span style={{ fontSize: 13, color: "#34d399" }}>
                传统经验值 <b>{lossResult.experience_rate}%</b>
              </span>
              <Tag color="green">
                相互印证 · 偏差 {lossResult.deviation_pp} 个百分点
              </Tag>
            </div>
            <Table
              rowKey="factor"
              size="small"
              pagination={false}
              dataSource={lossResult.breakdown}
              columns={[
                { title: "因子", dataIndex: "factor", width: 100 },
                { title: "取值", dataIndex: "detail", ellipsis: true },
                {
                  title: "修正（%）",
                  dataIndex: "adjustment",
                  width: 90,
                  align: "right",
                  render: (v: number) =>
                    v > 0 ? `+${v.toFixed(1)}` : v.toFixed(1),
                },
              ]}
            />
            <p style={{ fontSize: 12, color: "#94a3b8", marginTop: 8 }}>
              {lossResult.method_note}
            </p>
          </div>
        )}
      </Modal>
    </div>
  );
}
