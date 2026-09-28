import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Button, Empty, Form, Input, InputNumber, Modal, Popconfirm, Progress, Select, Space, Table, Tabs, Tag, Tooltip, Upload, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import { CopyOutlined, DeleteOutlined, EditOutlined, FileExcelOutlined, InboxOutlined, PlusOutlined, ReloadOutlined, SearchOutlined } from "@ant-design/icons";
import type { QuotaAcquisitionMethod, QuotaItemCreatePayload, QuotaItemDTO, QuotaResourceDetail, QuotaStatsResponse } from "../api";
import { api } from "../api";

// 专业配色
const DISCIPLINE_COLORS: Record<string, string> = {
  "土建": "#38bdf8",
  "给排水": "#34d399",
  "电气": "#facc15",
  "暖通消防": "#fb7185",
  "仿古": "#a78bfa",
  "光伏": "#f97316",
  "水利灌溉": "#22d3ee",
  "旧材料": "#fb923c",
  "补充定额": "#f472b6",
};

const DISCIPLINE_COLOR_FALLBACK = "#64748b";

function disciplineColor(name: string) {
  return DISCIPLINE_COLORS[name] ?? DISCIPLINE_COLOR_FALLBACK;
}

// 旧材料获取方式标签映射
const ACQUISITION_METHOD_LABEL: Record<string, { label: string; color: string }> = {
  recycle: { label: "当地回收", color: "#34d399" },
  reproduce: { label: "原材料复现", color: "#a78bfa" },
};

function acquisitionMethodTag(method?: string) {
  if (!method) return null;
  const meta = ACQUISITION_METHOD_LABEL[method];
  if (!meta) return <Tag>{method}</Tag>;
  return <Tag color={meta.color}>{meta.label}</Tag>;
}

// 格式化数字
function fmtNum(value: number | undefined | null, digits = 2) {
  if (value == null || Number.isNaN(value)) return "-";
  return Number(value).toFixed(digits);
}

// 列表一次最多加载条数（超出后提示细化筛选，避免静默截断误导）
const QUOTA_LIST_LIMIT = 200;

// 人材机类别配色
const RESOURCE_CATEGORY_COLORS: Record<string, string> = {
  人工: "#38bdf8",
  材料: "#34d399",
  机械: "#facc15",
};

// 定额展开详情面板：基础消耗 + 可溯字段（工作内容/适用范围/来源说明/检测报告）+ 人材机明细
function QuotaDetailPanel({ record }: { record: QuotaItemDTO }) {
  const [resources, setResources] = useState<QuotaResourceDetail[] | null>(null);

  useEffect(() => {
    if (Number(record.has_resource_details) === 1) {
      setResources(null);
      api
        .getQuotaItemResources(record.id)
        .then((res) => setResources(res.resources))
        .catch(() => setResources([]));
    } else {
      setResources([]);
    }
  }, [record.id, record.has_resource_details]);

  const hasTrace = Boolean(
    record.work_content || record.applicable_scope || record.origin_note || record.inspection_report_no || record.version,
  );

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
            <span className="quota-detail-label">基价</span>
            <strong>{record.base_price == null ? "-" : `¥${record.base_price.toFixed(2)}`}</strong>
          </div>
        </div>
      </div>

      {/* 可溯字段：工作内容 / 适用范围 / 来源说明 / 检测报告 / 版本（补充定额逐项展示） */}
      {hasTrace && (
        <div className="quota-detail-row" style={{ marginTop: 8, flexWrap: "wrap", gap: 12 }}>
          {record.work_content && (
            <div className="quota-detail-item" style={{ flexBasis: "100%" }}>
              <span className="material-symbols-outlined">construction</span>
              <div>
                <span className="quota-detail-label">工作内容</span>
                <strong>{record.work_content}</strong>
              </div>
            </div>
          )}
          {record.applicable_scope && (
            <div className="quota-detail-item" style={{ flexBasis: "100%" }}>
              <span className="material-symbols-outlined">my_location</span>
              <div>
                <span className="quota-detail-label">适用范围</span>
                <strong>{record.applicable_scope}</strong>
              </div>
            </div>
          )}
          {record.origin_note && (
            <div className="quota-detail-item" style={{ flexBasis: "100%" }}>
              <span className="material-symbols-outlined">description</span>
              <div>
                <span className="quota-detail-label">来源说明</span>
                <strong>{record.origin_note}</strong>
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

      {/* 旧材料扩展信息（仅当专业为 "旧材料" 时展示）*/}
      {record.discipline === "旧材料" && (
        <div className="quota-detail-row" style={{ marginTop: 8, flexWrap: "wrap", gap: 12 }}>
          <div className="quota-detail-item">
            <span className="material-symbols-outlined">recycling</span>
            <div>
              <span className="quota-detail-label">获取方式</span>
              <strong>{acquisitionMethodTag(record.acquisition_method) ?? "—"}</strong>
            </div>
          </div>
          <div className="quota-detail-item">
            <span className="material-symbols-outlined">location_on</span>
            <div>
              <span className="quota-detail-label">关联遗址</span>
              <strong>{record.heritage_site || "—"}</strong>
            </div>
          </div>
          <div className="quota-detail-item">
            <span className="material-symbols-outlined">workspace_premium</span>
            <div>
              <span className="quota-detail-label">文物等级</span>
              <strong>{record.relic_level || "—"}</strong>
            </div>
          </div>
          <div className="quota-detail-item">
            <span className="material-symbols-outlined">construction</span>
            <div>
              <span className="quota-detail-label">修复部位</span>
              <strong>{record.repair_part || "—"}</strong>
            </div>
          </div>
          <div className="quota-detail-item">
            <span className="material-symbols-outlined">grade</span>
            <div>
              <span className="quota-detail-label">成色</span>
              <strong>{record.condition_grade || "—"}</strong>
            </div>
          </div>
          <div className="quota-detail-item">
            <span className="material-symbols-outlined">qr_code_2</span>
            <div>
              <span className="quota-detail-label">批次号</span>
              <strong>{record.batch_no || "—"}</strong>
            </div>
          </div>
          <div className="quota-detail-item">
            <span className="material-symbols-outlined">fact_check</span>
            <div>
              <span className="quota-detail-label">检测报告</span>
              <strong>{record.inspection_report_no || "—"}</strong>
            </div>
          </div>
          {record.origin_note && (
            <div className="quota-detail-item" style={{ flexBasis: "100%" }}>
              <span className="material-symbols-outlined">description</span>
              <div>
                <span className="quota-detail-label">来源说明</span>
                <strong>{record.origin_note}</strong>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 人材机明细（补充定额逐项可溯） */}
      {Number(record.has_resource_details) === 1 && (
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 6, display: "flex", alignItems: "center", gap: 6 }}>
            <span className="material-symbols-outlined" style={{ fontSize: 14 }}>format_list_bulleted</span>
            人材机明细
            {resources === null && <span style={{ color: "var(--text-muted)" }}>加载中…</span>}
          </div>
          <Table
            rowKey="id"
            size="small"
            pagination={false}
            loading={resources === null}
            dataSource={resources ?? []}
            columns={[
              {
                title: "类别",
                dataIndex: "category",
                width: 70,
                render: (value: string) => <Tag color={RESOURCE_CATEGORY_COLORS[value] ?? "default"}>{value}</Tag>,
              },
              { title: "资源编码", dataIndex: "resource_code", width: 130 },
              {
                title: "名称",
                dataIndex: "resource_name",
                render: (value: string, r: QuotaResourceDetail) => (
                  <span>
                    {value}
                    {Number(r.is_main_material) === 1 && <Tag color="orange" style={{ marginLeft: 6 }}>主材</Tag>}
                  </span>
                ),
              },
              { title: "规格型号", dataIndex: "spec", ellipsis: true },
              { title: "单位", dataIndex: "unit", width: 60 },
              {
                title: "消耗量",
                dataIndex: "quantity",
                width: 90,
                align: "right",
                render: (value: number) => Number(value).toFixed(2),
              },
              {
                title: "单价",
                dataIndex: "unit_price",
                width: 100,
                align: "right",
                render: (value: number) => `¥${Number(value).toFixed(2)}`,
              },
              {
                title: "合计",
                width: 100,
                align: "right",
                render: (_: unknown, r: QuotaResourceDetail) => `¥${(Number(r.quantity) * Number(r.unit_price)).toFixed(2)}`,
              },
            ]}
          />
        </div>
      )}

      <div className="quota-detail-meta">
        <Tag color={disciplineColor(record.discipline)}>{record.discipline}</Tag>
        <Tag>{record.chapter}</Tag>
        <span>单位：{record.unit}</span>
        <span>编码：{record.quota_code}</span>
      </div>
    </div>
  );
}

export default function QuotaLibrary() {
  const [items, setItems] = useState<QuotaItemDTO[]>([]);
  const [stats, setStats] = useState<QuotaStatsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [debouncedKeyword, setDebouncedKeyword] = useState("");
  const [discipline, setDiscipline] = useState<string | undefined>();
  const [chapter, setChapter] = useState<string | undefined>();
  const [acquisitionMethod, setAcquisitionMethod] = useState<QuotaAcquisitionMethod | undefined>(undefined);
  const [restoring, setRestoring] = useState(false);
  const [activeTab, setActiveTab] = useState("library");
  const [selectedRowId, setSelectedRowId] = useState<number | null>(null);
  const [expandedKeys, setExpandedKeys] = useState<number[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<QuotaItemDTO | null>(null);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm<QuotaItemCreatePayload>();
  const modalMethod = Form.useWatch("acquisition_method", form);
  // 复用（模板再应用）：把已有定额复制一份生成新定额条目，供新项目套用
  const [reuseOpen, setReuseOpen] = useState(false);
  const [reuseSource, setReuseSource] = useState<QuotaItemDTO | null>(null);
  const [reusing, setReusing] = useState(false);
  const [reuseForm] = Form.useForm<{ quota_code: string; name: string }>();
  // 导入定额（Excel）
  const [importOpen, setImportOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importDiscipline, setImportDiscipline] = useState("AUTO");
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ created?: number; updated?: number; skipped?: number; imported?: number } | null>(null);

  // 搜索防抖
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedKeyword(keyword), 350);
    return () => clearTimeout(timer);
  }, [keyword]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [list, stat] = await Promise.all([
        api.listQuotaItems({
          limit: QUOTA_LIST_LIMIT,
          keyword: debouncedKeyword || undefined,
          discipline,
          chapter,
          acquisition_method: acquisitionMethod,
        }),
        api.getQuotaStats().catch(() => null),
      ]);
      setItems(list.items);
      setStats(stat);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "加载定额库失败");
    } finally {
      setLoading(false);
    }
  }, [chapter, debouncedKeyword, discipline, acquisitionMethod]);

  useEffect(() => {
    void load();
  }, [load]);

  // 专业分布（带占比）
  const topDisciplines = useMemo(() => {
    const total = Math.max(1, stats?.total ?? 0);
    return (stats?.disciplines ?? []).map((item) => ({
      ...item,
      percent: Math.round((item.count / total) * 100),
      color: disciplineColor(item.discipline),
    }));
  }, [stats]);

  // 工料机聚合分析
  const resourceAnalysis = useMemo(() => {
    if (items.length === 0) {
      return { laborTotal: 0, materialTotal: 0, machineTotal: 0, avgBasePrice: 0, byDiscipline: [] };
    }
    const laborTotal = items.reduce((sum, item) => sum + Number(item.labor_qty ?? 0), 0);
    const materialTotal = items.reduce((sum, item) => sum + Number(item.material_qty ?? 0), 0);
    const machineTotal = items.reduce((sum, item) => sum + Number(item.machine_qty ?? 0), 0);
    const priceItems = items.filter((item) => item.base_price != null);
    const avgBasePrice = priceItems.length > 0
      ? priceItems.reduce((sum, item) => sum + Number(item.base_price ?? 0), 0) / priceItems.length
      : 0;

    // 按专业聚合
    const disciplineMap = new Map<string, { count: number; labor: number; material: number; machine: number; price: number }>();
    items.forEach((item) => {
      const key = item.discipline || "未分类";
      const entry = disciplineMap.get(key) ?? { count: 0, labor: 0, material: 0, machine: 0, price: 0 };
      entry.count += 1;
      entry.labor += Number(item.labor_qty ?? 0);
      entry.material += Number(item.material_qty ?? 0);
      entry.machine += Number(item.machine_qty ?? 0);
      entry.price += Number(item.base_price ?? 0);
      disciplineMap.set(key, entry);
    });

    const byDiscipline = Array.from(disciplineMap.entries())
      .map(([name, data]) => ({
        name,
        ...data,
        avgPrice: data.count > 0 ? data.price / data.count : 0,
        total: data.labor + data.material + data.machine,
      }))
      .sort((a, b) => b.total - a.total);

    return { laborTotal, materialTotal, machineTotal, avgBasePrice, byDiscipline };
  }, [items]);

  // 基价分布
  const priceDistribution = useMemo(() => {
    const ranges = [
      { label: "0-100", min: 0, max: 100, count: 0 },
      { label: "100-500", min: 100, max: 500, count: 0 },
      { label: "500-1000", min: 500, max: 1000, count: 0 },
      { label: "1000-5000", min: 1000, max: 5000, count: 0 },
      { label: "5000+", min: 5000, max: Infinity, count: 0 },
    ];
    items.forEach((item) => {
      const price = Number(item.base_price ?? 0);
      if (price <= 0) return;
      const range = ranges.find((r) => price >= r.min && price < r.max);
      if (range) range.count += 1;
    });
    const max = Math.max(...ranges.map((r) => r.count), 1);
    return ranges.map((r) => ({ ...r, percent: Math.round((r.count / max) * 100) }));
  }, [items]);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ discipline: "土建", acquisition_method: "" });
    setModalOpen(true);
  };

  const openEdit = (record: QuotaItemDTO) => {
    setEditing(record);
    form.setFieldsValue({
      quota_code: record.quota_code,
      discipline: record.discipline,
      name: record.name,
      unit: record.unit,
      chapter: record.chapter,
      labor_qty: Number(record.labor_qty ?? 0),
      material_qty: Number(record.material_qty ?? 0),
      machine_qty: Number(record.machine_qty ?? 0),
      base_price: Number(record.base_price ?? 0),
      work_content: record.work_content ?? "",
      applicable_scope: record.applicable_scope ?? "",
      version: record.version ?? "",
      acquisition_method: (record.acquisition_method ?? "") as QuotaAcquisitionMethod,
      origin_note: record.origin_note ?? "",
      heritage_site: record.heritage_site ?? "",
      relic_level: record.relic_level ?? "",
      repair_part: record.repair_part ?? "",
      condition_grade: record.condition_grade ?? "",
      batch_no: record.batch_no ?? "",
      inspection_report_no: record.inspection_report_no ?? "",
    });
    setModalOpen(true);
  };

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      setSaving(true);
      await api.createQuotaItem(values);
      message.success(editing ? "定额已更新" : "定额已新增");
      setModalOpen(false);
      await load();
    } catch (err) {
      if (err instanceof Error) message.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (record: QuotaItemDTO) => {
    try {
      const res = await api.deleteQuotaItem(record.id);
      message.success(res.message || "定额已删除");
      setSelectedRowId(null);
      setExpandedKeys((keys) => keys.filter((k) => k !== record.id));
      await load();
    } catch (err) {
      message.error(err instanceof Error ? err.message : "删除失败");
    }
  };

  const openReuse = (record: QuotaItemDTO) => {
    setReuseSource(record);
    reuseForm.setFieldsValue({
      quota_code: `${record.quota_code}-R`,
      name: `${record.name}（复用）`,
    });
    setReuseOpen(true);
  };

  const handleReuse = async () => {
    if (!reuseSource) return;
    try {
      const values = await reuseForm.validateFields();
      setReusing(true);
      const payload: QuotaItemCreatePayload = {
        quota_code: values.quota_code,
        discipline: reuseSource.discipline,
        name: values.name,
        unit: reuseSource.unit,
        labor_qty: Number(reuseSource.labor_qty ?? 0),
        material_qty: Number(reuseSource.material_qty ?? 0),
        machine_qty: Number(reuseSource.machine_qty ?? 0),
        base_price: reuseSource.base_price,
        work_content: reuseSource.work_content ?? "",
        applicable_scope: reuseSource.applicable_scope ?? "",
        chapter: reuseSource.chapter,
        version: reuseSource.version ?? "",
        origin_note: reuseSource.origin_note ?? "",
      };
      const res = await api.createQuotaItem(payload);
      message.success(`已复用生成新定额 ${res.item.quota_code} · ${res.item.name}`);
      setReuseOpen(false);
      setReuseSource(null);
      await load();
    } catch (err) {
      if (err instanceof Error) message.error(err.message);
    } finally {
      setReusing(false);
    }
  };

  const restoreReference = async () => {
    setRestoring(true);
    try {
      const res = await api.restoreReferenceData(false);
      const total = Object.values(res.restored).reduce((sum, value) => sum + Number(value ?? 0), 0);
      message.success(total > 0 ? `已恢复基础库 ${total} 条记录` : res.message);
      await load();
    } catch (err) {
      message.error(err instanceof Error ? err.message : "恢复基础库失败");
    } finally {
      setRestoring(false);
    }
  };

  const openImport = () => {
    setImportOpen(true);
    setImportFile(null);
    setImportDiscipline("AUTO");
    setImportResult(null);
  };

  const handleImport = async () => {
    if (!importFile) {
      message.warning("请选择 .xlsx 格式的定额 Excel 文件");
      return;
    }
    setImporting(true);
    try {
      const res = await api.importQuota(importFile, importDiscipline);
      const created = res.created ?? 0;
      const updated = res.updated ?? 0;
      setImportResult({ created, updated, skipped: res.skipped, imported: res.imported });
      message.success(`定额导入完成：新增 ${created} 条、更新 ${updated} 条、跳过 ${res.skipped} 条`);
      await load();
    } catch (err) {
      message.error(err instanceof Error ? err.message : "定额导入失败");
    } finally {
      setImporting(false);
    }
  };

  const disciplineOptions = stats?.disciplines.map((item) => ({ value: item.discipline, label: `${item.discipline} (${item.count})` })) ?? [];
  const chapterOptions = stats?.chapters
    .filter((item) => !discipline || item.discipline === discipline)
    .map((item) => ({ value: item.chapter, label: `${item.chapter} (${item.count})` })) ?? [];

  const columns: ColumnsType<QuotaItemDTO> = [
    { title: "定额编码", dataIndex: "quota_code", width: 140, fixed: "left" },
    { title: "名称", dataIndex: "name", ellipsis: true },
    {
      title: "专业",
      dataIndex: "discipline",
      width: 100,
      render: (value: string) => <Tag color={disciplineColor(value)}>{value}</Tag>,
    },
    {
      title: "获取方式",
      dataIndex: "acquisition_method",
      width: 110,
      render: (value: string, record) => {
        if (record.discipline !== "旧材料" || !value) return "-";
        return acquisitionMethodTag(value);
      },
    },
    { title: "章节", dataIndex: "chapter", width: 140, ellipsis: true },
    { title: "单位", dataIndex: "unit", width: 70 },
    {
      title: "人工",
      dataIndex: "labor_qty",
      width: 80,
      align: "right",
      sorter: (a, b) => Number(a.labor_qty ?? 0) - Number(b.labor_qty ?? 0),
      render: (value: number) => fmtNum(value),
    },
    {
      title: "材料",
      dataIndex: "material_qty",
      width: 80,
      align: "right",
      sorter: (a, b) => Number(a.material_qty ?? 0) - Number(b.material_qty ?? 0),
      render: (value: number) => fmtNum(value),
    },
    {
      title: "机械",
      dataIndex: "machine_qty",
      width: 80,
      align: "right",
      sorter: (a, b) => Number(a.machine_qty ?? 0) - Number(b.machine_qty ?? 0),
      render: (value: number) => fmtNum(value),
    },
    {
      title: "基价",
      dataIndex: "base_price",
      width: 100,
      align: "right",
      sorter: (a, b) => Number(a.base_price ?? 0) - Number(b.base_price ?? 0),
      render: (value: number | undefined) => value == null || value <= 0
        ? <span style={{ color: "#f87171" }}>缺基价</span>
        : `¥${value.toFixed(2)}`,
    },
    {
      title: "操作",
      key: "actions",
      width: 230,
      fixed: "right",
      render: (_, record) => (
        <Space size={4} onClick={(event) => event.stopPropagation()}>
          <Tooltip title="复用为模板，生成新定额供新项目套用">
            <Button size="small" icon={<CopyOutlined />} onClick={() => openReuse(record)}>复用</Button>
          </Tooltip>
          <Tooltip title="编辑定额">
            <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(record)}>编辑</Button>
          </Tooltip>
          <Popconfirm
            title="删除定额"
            description="将同时删除其人材机明细；已绑定的清单项会回到待套价状态。确认删除？"
            okText="删除"
            cancelText="取消"
            okButtonProps={{ danger: true }}
            onConfirm={() => handleDelete(record)}
          >
            <Button size="small" danger icon={<DeleteOutlined />}>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  // 数据质量统计
  const qualityStats = useMemo(() => {
    const total = Math.max(1, items.length);
    const missingPrice = items.filter((item) => item.base_price == null || item.base_price <= 0).length;
    const missingLabor = items.filter((item) => item.labor_qty == null || item.labor_qty < 0).length;
    const missingMaterial = items.filter((item) => item.material_qty == null || item.material_qty < 0).length;
    const missingMachine = items.filter((item) => item.machine_qty == null || item.machine_qty < 0).length;
    const missingUnit = items.filter((item) => !item.unit).length;

    const codeCounts = new Map<string, number>();
    items.forEach((item) => {
      codeCounts.set(item.quota_code, (codeCounts.get(item.quota_code) ?? 0) + 1);
    });
    const duplicateCodes = Array.from(codeCounts.values()).filter((count) => count > 1).length;

    return {
      missingPrice,
      missingLabor,
      missingMaterial,
      missingMachine,
      missingUnit,
      duplicateCodes,
      // 五项缺失数叠加可能超总数，钳位到 0-100
      healthRate: Math.max(0, Math.min(100, Math.round(((total - missingPrice - missingLabor - missingMaterial - missingMachine - missingUnit) / total) * 100))),
    };
  }, [items]);

  // 价格统计
  const priceSummary = useMemo(() => {
    const prices = items.map((item) => Number(item.base_price ?? 0)).filter((price) => price > 0).sort((a, b) => a - b);
    if (prices.length === 0) return { max: 0, min: 0, avg: 0, median: 0 };
    const max = prices[prices.length - 1];
    const min = prices[0];
    const avg = prices.reduce((sum, price) => sum + price, 0) / prices.length;
    const mid = Math.floor(prices.length / 2);
    const median = prices.length % 2 === 0 ? (prices[mid - 1] + prices[mid]) / 2 : prices[mid];
    return { max, min, avg, median };
  }, [items]);

  // TOP10 榜单
  const topLists = useMemo(() => {
    const byPrice = [...items].filter((item) => item.base_price != null && item.base_price > 0).sort((a, b) => b.base_price! - a.base_price!).slice(0, 10);
    const byLabor = [...items].sort((a, b) => Number(b.labor_qty ?? 0) - Number(a.labor_qty ?? 0)).slice(0, 10);
    const byMaterial = [...items].sort((a, b) => Number(b.material_qty ?? 0) - Number(a.material_qty ?? 0)).slice(0, 10);
    const byMachine = [...items].sort((a, b) => Number(b.machine_qty ?? 0) - Number(a.machine_qty ?? 0)).slice(0, 10);
    return { byPrice, byLabor, byMaterial, byMachine };
  }, [items]);

  // 工料机总量占比
  const resourceTotal = resourceAnalysis.laborTotal + resourceAnalysis.materialTotal + resourceAnalysis.machineTotal;
  const resourceParts = [
    { label: "人工", value: resourceAnalysis.laborTotal, color: "#38bdf8", icon: "engineering" },
    { label: "材料", value: resourceAnalysis.materialTotal, color: "#34d399", icon: "inventory" },
    { label: "机械", value: resourceAnalysis.machineTotal, color: "#facc15", icon: "precision_manufacturing" },
  ];

  return (
    <div className="page-container">
      {/* KPI 指标卡 */}
      <div className="kpi-grid">
        <div className="kpi-card">
          <span className="material-symbols-outlined kpi-card-icon">inventory_2</span>
          <div className="kpi-card-body">
            <span className="kpi-card-label">定额条目</span>
            <span className="kpi-card-value">{stats?.total ?? 0}<span className="kpi-card-suffix">条</span></span>
          </div>
        </div>
        <div className="kpi-card">
          <span className="material-symbols-outlined kpi-card-icon">category</span>
          <div className="kpi-card-body">
            <span className="kpi-card-label">专业覆盖</span>
            <span className="kpi-card-value">{stats?.disciplines.length ?? 0}<span className="kpi-card-suffix">类</span></span>
          </div>
        </div>
        <div className="kpi-card">
          <span className="material-symbols-outlined kpi-card-icon">menu_book</span>
          <div className="kpi-card-body">
            <span className="kpi-card-label">章节索引</span>
            <span className="kpi-card-value">{stats?.chapters.length ?? 0}<span className="kpi-card-suffix">章</span></span>
          </div>
        </div>
        <div className="kpi-card">
          <span className="material-symbols-outlined kpi-card-icon">payments</span>
          <div className="kpi-card-body">
            <span className="kpi-card-label">平均基价</span>
            <span className="kpi-card-value">¥{fmtNum(resourceAnalysis.avgBasePrice)}<span className="kpi-card-suffix"></span></span>
          </div>
        </div>
      </div>

      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        items={[
          {
            key: "library",
            label: "定额查询",
            children: (
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                {/* 专业分布占比条 */}
                {topDisciplines.length > 0 && (
                  <div className="content-card">
                    <div className="content-card-head">
                      <h3 className="content-card-title"><span className="material-symbols-outlined">donut_large</span>专业分布</h3>
                    </div>
                    <div className="content-card-body">
                      <div className="quota-discipline-bar">
                        {topDisciplines.map((item) => (
                          <Tooltip key={item.discipline} title={`${item.discipline}：${item.count} 条（${item.percent}%）`}>
                            <div
                              className={`quota-discipline-segment${discipline === item.discipline ? " active" : ""}`}
                              style={{
                                flexGrow: item.percent,
                                background: item.color,
                              }}
                              onClick={() => {
                                setDiscipline(discipline === item.discipline ? undefined : item.discipline);
                                setChapter(undefined);
                              }}
                            >
                              <span className="quota-discipline-segment-label">{item.discipline}</span>
                              <span className="quota-discipline-segment-count">{item.count}</span>
                            </div>
                          </Tooltip>
                        ))}
                      </div>
                      <div className="quota-discipline-legend">
                        {topDisciplines.map((item) => (
                          <button
                            key={item.discipline}
                            type="button"
                            className={discipline === item.discipline ? "active" : ""}
                            onClick={() => {
                              setDiscipline(discipline === item.discipline ? undefined : item.discipline);
                              setChapter(undefined);
                            }}
                          >
                            <span className="quota-discipline-dot" style={{ background: item.color }} />
                            <span className="quota-discipline-name">{item.discipline}</span>
                            <strong>{item.count}</strong>
                            <em>{item.percent}%</em>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
                {/* 筛选栏 */}
                <div className="filter-bar">
                  <Input
                    allowClear
                    prefix={<SearchOutlined />}
                    placeholder="搜索编码或名称"
                    value={keyword}
                    onChange={(event) => setKeyword(event.target.value)}
                    style={{ width: 260 }}
                  />
                  <Select allowClear placeholder="专业" options={disciplineOptions} value={discipline} onChange={(value) => { setDiscipline(value); setChapter(undefined); }} style={{ width: 180 }} />
                  <Select allowClear placeholder="章节" options={chapterOptions} value={chapter} onChange={setChapter} style={{ width: 220 }} />
                  <Select
                    allowClear
                    placeholder="获取方式"
                    value={acquisitionMethod}
                    onChange={(value) => setAcquisitionMethod(value ?? undefined)}
                    style={{ width: 160 }}
                    options={[
                      { value: "recycle", label: "当地回收" },
                      { value: "reproduce", label: "原材料复现" },
                    ]}
                  />
                  <Button icon={<ReloadOutlined />} loading={loading} onClick={load}>刷新</Button>
                  <Button icon={<FileExcelOutlined />} onClick={openImport}>导入定额</Button>
                  <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新增定额</Button>
                  {qualityStats.missingPrice > 0 && (
                    <Tooltip title="这些条目缺少基价，自动套价时无法计价，需补充维护">
                      <Tag color="red">缺基价 {qualityStats.missingPrice} 条</Tag>
                    </Tooltip>
                  )}
                  {items.length >= QUOTA_LIST_LIMIT && (
                    <Tooltip title={`列表一次最多加载 ${QUOTA_LIST_LIMIT} 条，当前条件结果可能更多，请继续细化编码 / 名称 / 专业 / 章节筛选`}>
                      <Tag color="orange">仅展示前 {QUOTA_LIST_LIMIT} 条</Tag>
                    </Tooltip>
                  )}
                </div>
                {/* 定额表格 */}
                <div className="content-card">
                  <div className="content-card-body flush">
                    <Table
                      rowKey="id"
                      columns={columns}
                      dataSource={items}
                      loading={loading}
                      scroll={{ x: 1150 }}
                      pagination={{ pageSize: 20, showSizeChanger: true, showTotal: (total) => `共 ${total} 条${items.length >= QUOTA_LIST_LIMIT ? `（仅加载前 ${QUOTA_LIST_LIMIT} 条）` : ""}` }}
                      rowClassName={(record) => record.id === selectedRowId ? "quota-row-selected" : ""}
                      onRow={(record) => ({
                        onClick: (event) => {
                          if ((event.target as HTMLElement).closest(".ant-table-row-expand-icon")) return;
                          setSelectedRowId(selectedRowId === record.id ? null : record.id);
                          setExpandedKeys((keys) =>
                            keys.includes(record.id)
                              ? keys.filter((k) => k !== record.id)
                              : [...keys, record.id]
                          );
                        },
                      })}
                      expandable={{
                        expandedRowRender: (record) => <QuotaDetailPanel record={record} />,
                        rowExpandable: () => true,
                        expandedRowKeys: expandedKeys,
                        onExpandedRowsChange: (rows) => setExpandedKeys(rows as number[]),
                      }}
                      locale={{
                        emptyText: (
                          <Empty description={stats?.total === 0 ? "定额库为空，自动套定额和计价会受影响。" : "未找到匹配定额"}>
                            {stats?.total === 0 && (
                              <Button type="primary" loading={restoring} onClick={restoreReference}>恢复内置基础库</Button>
                            )}
                          </Empty>
                        ),
                      }}
                    />
                  </div>
                </div>
              </div>
            ),
          },
          {
            key: "resources",
            label: "工料机分析",
            children: (
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                {/* 工料机总量占比 */}
                <div className="content-card">
                  <div className="content-card-head">
                    <h3 className="content-card-title"><span className="material-symbols-outlined">trending_up</span>资源消耗总览</h3>
                  </div>
                  <div className="content-card-body">
                    <div className="quota-resource-overview">
                      {resourceParts.map((part) => {
                        const percent = resourceTotal > 0 ? Math.round((part.value / resourceTotal) * 100) : 0;
                        return (
                          <div key={part.label} className="quota-resource-card">
                            <span className="material-symbols-outlined quota-resource-icon" style={{ color: part.color }}>{part.icon}</span>
                            <div className="quota-resource-body">
                              <span className="quota-resource-label">{part.label}消耗</span>
                              <strong className="quota-resource-value">{fmtNum(part.value)}</strong>
                              <Progress percent={percent} strokeColor={part.color} showInfo={false} size="small" />
                              <span className="quota-resource-percent">{percent}%</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* 各专业工料机对比 */}
                <div className="content-card">
                  <div className="content-card-head">
                    <h3 className="content-card-title"><span className="material-symbols-outlined">bar_chart</span>各专业资源对比</h3>
                  </div>
                  <div className="content-card-body flush">
                    <Table
                      rowKey="name"
                      size="small"
                      dataSource={resourceAnalysis.byDiscipline}
                      pagination={false}
                      columns={[
                        {
                          title: "专业",
                          dataIndex: "name",
                          width: 120,
                          render: (value: string) => <Tag color={disciplineColor(value)}>{value}</Tag>,
                        },
                        { title: "条目数", dataIndex: "count", width: 90, align: "right" },
                        {
                          title: "人工",
                          dataIndex: "labor",
                          align: "right",
                          render: (value: number) => <span style={{ color: "#38bdf8" }}>{fmtNum(value)}</span>,
                        },
                        {
                          title: "材料",
                          dataIndex: "material",
                          align: "right",
                          render: (value: number) => <span style={{ color: "#34d399" }}>{fmtNum(value)}</span>,
                        },
                        {
                          title: "机械",
                          dataIndex: "machine",
                          align: "right",
                          render: (value: number) => <span style={{ color: "#facc15" }}>{fmtNum(value)}</span>,
                        },
                        {
                          title: "平均基价",
                          dataIndex: "avgPrice",
                          width: 120,
                          align: "right",
                          render: (value: number) => `¥${fmtNum(value)}`,
                        },
                      ]}
                    />
                  </div>
                </div>

                {/* 基价分布 */}
                <div className="content-card">
                  <div className="content-card-head">
                    <h3 className="content-card-title"><span className="material-symbols-outlined">analytics</span>基价区间分布</h3>
                  </div>
                  <div className="content-card-body">
                    <div className="quota-price-distribution">
                      {priceDistribution.map((range) => (
                        <div key={range.label} className="quota-price-bar-row">
                          <span className="quota-price-bar-label">{range.label}</span>
                          <div className="quota-price-bar-track">
                            <div
                              className="quota-price-bar-fill"
                              style={{ width: `${range.percent}%`, background: "linear-gradient(90deg, #38bdf8, #3b82f6)" }}
                            />
                          </div>
                          <strong className="quota-price-bar-count">{range.count}</strong>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            ),
          },
          {
            key: "stats",
            label: "库统计",
            children: (
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                {/* 数据质量概览 */}
                <div className="content-card">
                  <div className="content-card-head">
                    <h3 className="content-card-title"><span className="material-symbols-outlined">verified</span>数据质量</h3>
                  </div>
                  <div className="content-card-body">
                    <div className="quota-quality-grid">
                      <div className="quota-quality-card highlight">
                        <span className="material-symbols-outlined">health_and_safety</span>
                        <div>
                          <span className="quota-quality-label">健康度</span>
                          <strong className="quota-quality-value" style={{ color: qualityStats.healthRate >= 90 ? "#34d399" : qualityStats.healthRate >= 70 ? "#facc15" : "#f87171" }}>
                            {qualityStats.healthRate}%
                          </strong>
                        </div>
                      </div>
                      <div className="quota-quality-card">
                        <span className="material-symbols-outlined">payments</span>
                        <div>
                          <span className="quota-quality-label">缺失基价</span>
                          <strong className="quota-quality-value" style={{ color: qualityStats.missingPrice > 0 ? "#f87171" : "#34d399" }}>{qualityStats.missingPrice}</strong>
                        </div>
                      </div>
                      <div className="quota-quality-card">
                        <span className="material-symbols-outlined">engineering</span>
                        <div>
                          <span className="quota-quality-label">缺失人工</span>
                          <strong className="quota-quality-value" style={{ color: qualityStats.missingLabor > 0 ? "#f87171" : "#34d399" }}>{qualityStats.missingLabor}</strong>
                        </div>
                      </div>
                      <div className="quota-quality-card">
                        <span className="material-symbols-outlined">inventory</span>
                        <div>
                          <span className="quota-quality-label">缺失材料</span>
                          <strong className="quota-quality-value" style={{ color: qualityStats.missingMaterial > 0 ? "#f87171" : "#34d399" }}>{qualityStats.missingMaterial}</strong>
                        </div>
                      </div>
                      <div className="quota-quality-card">
                        <span className="material-symbols-outlined">precision_manufacturing</span>
                        <div>
                          <span className="quota-quality-label">缺失机械</span>
                          <strong className="quota-quality-value" style={{ color: qualityStats.missingMachine > 0 ? "#f87171" : "#34d399" }}>{qualityStats.missingMachine}</strong>
                        </div>
                      </div>
                      <div className="quota-quality-card">
                        <span className="material-symbols-outlined">straighten</span>
                        <div>
                          <span className="quota-quality-label">缺失单位</span>
                          <strong className="quota-quality-value" style={{ color: qualityStats.missingUnit > 0 ? "#f87171" : "#34d399" }}>{qualityStats.missingUnit}</strong>
                        </div>
                      </div>
                      <div className="quota-quality-card">
                        <span className="material-symbols-outlined">content_copy</span>
                        <div>
                          <span className="quota-quality-label">重复编码</span>
                          <strong className="quota-quality-value" style={{ color: qualityStats.duplicateCodes > 0 ? "#f87171" : "#34d399" }}>{qualityStats.duplicateCodes}</strong>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* 价格统计 */}
                <div className="content-card">
                  <div className="content-card-head">
                    <h3 className="content-card-title"><span className="material-symbols-outlined">attach_money</span>基价统计</h3>
                  </div>
                  <div className="content-card-body">
                    <div className="quota-price-summary">
                      <div><span>最高基价</span><strong>¥{fmtNum(priceSummary.max)}</strong></div>
                      <div><span>最低基价</span><strong>¥{fmtNum(priceSummary.min)}</strong></div>
                      <div><span>平均基价</span><strong>¥{fmtNum(priceSummary.avg)}</strong></div>
                      <div><span>中位基价</span><strong>¥{fmtNum(priceSummary.median)}</strong></div>
                    </div>
                  </div>
                </div>

                {/* TOP10 榜单 */}
                <div className="content-card">
                  <div className="content-card-head">
                    <h3 className="content-card-title"><span className="material-symbols-outlined">emoji_events</span>TOP10 榜单</h3>
                  </div>
                  <div className="content-card-body">
                    <Tabs
                      size="small"
                      items={[
                        {
                          key: "price",
                          label: "基价最高",
                          children: (
                            <ol className="quota-top-list">
                              {topLists.byPrice.map((item) => (
                                <li key={item.id}>
                                  <span className="quota-top-name" title={item.name}>{item.name}</span>
                                  <Tag color={disciplineColor(item.discipline)}>{item.discipline}</Tag>
                                  <strong className="quota-top-value">¥{fmtNum(item.base_price)}</strong>
                                </li>
                              ))}
                            </ol>
                          ),
                        },
                        {
                          key: "labor",
                          label: "人工最高",
                          children: (
                            <ol className="quota-top-list">
                              {topLists.byLabor.map((item) => (
                                <li key={item.id}>
                                  <span className="quota-top-name" title={item.name}>{item.name}</span>
                                  <Tag color={disciplineColor(item.discipline)}>{item.discipline}</Tag>
                                  <strong className="quota-top-value" style={{ color: "#38bdf8" }}>{fmtNum(item.labor_qty)}</strong>
                                </li>
                              ))}
                            </ol>
                          ),
                        },
                        {
                          key: "material",
                          label: "材料最高",
                          children: (
                            <ol className="quota-top-list">
                              {topLists.byMaterial.map((item) => (
                                <li key={item.id}>
                                  <span className="quota-top-name" title={item.name}>{item.name}</span>
                                  <Tag color={disciplineColor(item.discipline)}>{item.discipline}</Tag>
                                  <strong className="quota-top-value" style={{ color: "#34d399" }}>{fmtNum(item.material_qty)}</strong>
                                </li>
                              ))}
                            </ol>
                          ),
                        },
                        {
                          key: "machine",
                          label: "机械最高",
                          children: (
                            <ol className="quota-top-list">
                              {topLists.byMachine.map((item) => (
                                <li key={item.id}>
                                  <span className="quota-top-name" title={item.name}>{item.name}</span>
                                  <Tag color={disciplineColor(item.discipline)}>{item.discipline}</Tag>
                                  <strong className="quota-top-value" style={{ color: "#facc15" }}>{fmtNum(item.machine_qty)}</strong>
                                </li>
                              ))}
                            </ol>
                          ),
                        },
                      ]}
                    />
                  </div>
                </div>
              </div>
            ),
          },
        ]}
      />

      {/* 新增 / 编辑定额 Modal */}
      <Modal
        title={editing ? `编辑定额 · ${editing.quota_code}` : "新增定额"}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={handleSave}
        okText={editing ? "保存" : "新增"}
        confirmLoading={saving}
        width={680}
        destroyOnClose
      >
        <Form form={form} layout="vertical" initialValues={{ discipline: "土建", acquisition_method: "", labor_qty: 0, material_qty: 0, machine_qty: 0, base_price: 0 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 16px" }}>
            <Form.Item name="quota_code" label="定额编码" rules={[{ required: true, message: "请输入定额编码" }]}>
              <Input placeholder="如 GS1-1" disabled={!!editing} />
            </Form.Item>
            <Form.Item name="discipline" label="专业" rules={[{ required: true, message: "请选择专业" }]}>
              <Select
                options={(stats?.disciplines ?? []).map((item) => ({ value: item.discipline, label: `${item.discipline} (${item.count})` }))}
                placeholder="选择专业"
              />
            </Form.Item>
            <Form.Item name="name" label="名称" rules={[{ required: true, message: "请输入定额名称" }]}>
              <Input placeholder="如 干混抹灰砂浆 M20" />
            </Form.Item>
            <Form.Item name="unit" label="单位" rules={[{ required: true, message: "请输入计量单位" }]}>
              <Input placeholder="如 m³ / 10m³" />
            </Form.Item>
            <Form.Item name="chapter" label="章节/分部">
              <Input placeholder="如 建筑装饰工程" />
            </Form.Item>
            <Form.Item name="version" label="版本">
              <Input placeholder="如 2018通用版" />
            </Form.Item>
            <Form.Item name="labor_qty" label="人工消耗">
              <InputNumber min={0} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item name="material_qty" label="材料消耗">
              <InputNumber min={0} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item name="machine_qty" label="机械消耗">
              <InputNumber min={0} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item name="base_price" label="基价（元）">
              <InputNumber min={0} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item name="acquisition_method" label="旧材料获取方式">
              <Select
                allowClear
                placeholder="仅旧材料使用（可选）"
                options={[
                  { value: "recycle", label: "当地回收" },
                  { value: "reproduce", label: "原材料复现" },
                ]}
              />
            </Form.Item>
          </div>
          {modalMethod && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 16px" }}>
              <Form.Item name="heritage_site" label="关联遗址/文物"><Input /></Form.Item>
              <Form.Item name="relic_level" label="文物等级"><Input placeholder="如 国家级" /></Form.Item>
              <Form.Item name="repair_part" label="修复部位"><Input placeholder="如 屋面" /></Form.Item>
              <Form.Item name="condition_grade" label="成色/成新率"><Input placeholder="如 8成新" /></Form.Item>
              <Form.Item name="batch_no" label="批次号"><Input /></Form.Item>
              <Form.Item name="inspection_report_no" label="检测报告编号"><Input /></Form.Item>
            </div>
          )}
          <Form.Item name="work_content" label="工作内容">
            <Input.TextArea rows={2} placeholder="施工工作内容说明" />
          </Form.Item>
          <Form.Item name="applicable_scope" label="适用范围">
            <Input.TextArea rows={2} placeholder="适用条件与范围" />
          </Form.Item>
          <Form.Item name="origin_note" label="来源说明">
            <Input.TextArea rows={2} placeholder="回收地点或复现依据" />
          </Form.Item>
        </Form>
      </Modal>

      {/* 复用为模板 Modal：把已有定额复制一份，供新项目套用 */}
      <Modal
        title={reuseSource ? `复制定额 · ${reuseSource.quota_code}` : "复制定额"}
        open={reuseOpen}
        onCancel={() => { setReuseOpen(false); setReuseSource(null); }}
        onOk={handleReuse}
        okText="生成复用定额"
        confirmLoading={reusing}
        width={560}
        destroyOnClose
      >
        <Form form={reuseForm} layout="vertical">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 16px" }}>
            <Form.Item name="quota_code" label="新定额编码" rules={[{ required: true, message: "请输入新定额编码" }]}>
              <Input placeholder="如 GS-01-R" />
            </Form.Item>
            <Form.Item name="name" label="新定额名称" rules={[{ required: true, message: "请输入新定额名称" }]}>
              <Input />
            </Form.Item>
          </div>
          {reuseSource && (
            <>
              <div className="content-card" style={{ marginBottom: 16 }}>
                <div className="content-card-body" style={{ fontSize: 13, color: "var(--text-secondary)", display: "flex", flexDirection: "column", gap: 6 }}>
                  <div>
                    源定额：<Tag color={disciplineColor(reuseSource.discipline)}>{reuseSource.discipline}</Tag>
                    <strong style={{ color: "var(--text-primary)" }}>{reuseSource.quota_code} · {reuseSource.name}</strong>
                  </div>
                  <div>将随定额一起复用：单位 {reuseSource.unit}｜人工 {fmtNum(reuseSource.labor_qty)}｜材料 {fmtNum(reuseSource.material_qty)}｜机械 {fmtNum(reuseSource.machine_qty)}｜基价 {reuseSource.base_price == null ? "—" : `¥${reuseSource.base_price.toFixed(2)}`}</div>
                  {reuseSource.work_content && <div>工作内容：{reuseSource.work_content}</div>}
                  {reuseSource.applicable_scope && <div>适用范围：{reuseSource.applicable_scope}</div>}
                </div>
              </div>
            </>
          )}
        </Form>
      </Modal>

      {/* 导入定额 Modal：上传 Excel，按专业/表格自动识别并 upsert */}
      <Modal
        title="导入定额"
        open={importOpen}
        onCancel={() => { setImportOpen(false); setImportFile(null); setImportResult(null); }}
        onOk={handleImport}
        okText="开始导入"
        confirmLoading={importing}
        width={600}
        destroyOnClose
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>
            支持 <code>.xlsx</code> 格式的定额 Excel 表，自动识别表头（编码、名称、单位、人材机消耗、基价、章节等）。
            已存在的编码（相同专业）将更新，其余新增；专业选择 AUTO 时按工作表名自动归类。
          </div>
          <div>
            <Upload.Dragger
              accept=".xlsx"
              maxCount={1}
              beforeUpload={(file) => { setImportFile(file as unknown as File); setImportResult(null); return false; }}
              onRemove={() => { setImportFile(null); setImportResult(null); }}
              fileList={importFile ? [{ uid: "-1", name: importFile.name, status: "done" }] : []}
            >
              <p className="ant-upload-drag-icon"><InboxOutlined /></p>
              <p className="ant-upload-text">点击或拖拽定额 Excel 文件到此处</p>
              <p className="ant-upload-hint">单个 .xlsx 文件，≤100MB</p>
            </Upload.Dragger>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontSize: 13, color: "var(--text-secondary)", whiteSpace: "nowrap" }}>导入专业</span>
            <Select
              style={{ width: 260 }}
              value={importDiscipline}
              onChange={setImportDiscipline}
              options={[
                { value: "AUTO", label: "自动识别（按工作表名）" },
                ...disciplineOptions,
              ]}
            />
          </div>
          {importResult && (
            <Alert
              type="success"
              showIcon
              message={`导入结果：新增 ${importResult.created ?? 0} 条、更新 ${importResult.updated ?? 0} 条、跳过 ${importResult.skipped ?? 0} 条`}
            />
          )}
        </div>
      </Modal>
    </div>
  );
}
