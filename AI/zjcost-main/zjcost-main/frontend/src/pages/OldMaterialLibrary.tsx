import { useCallback, useEffect, useMemo, useState } from "react";
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
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { CalculatorOutlined, DeleteOutlined, EditOutlined, PlusOutlined, ReloadOutlined, SearchOutlined } from "@ant-design/icons";
import {
  type LossEstimateResponse,
  type OldMaterialAcquisitionMethod,
  type OldMaterialDTO,
  type OldMaterialStatsResponse,
  api,
} from "../api";

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

export default function OldMaterialLibrary() {
  const [items, setItems] = useState<OldMaterialDTO[]>([]);
  const [stats, setStats] = useState<OldMaterialStatsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [debouncedKeyword, setDebouncedKeyword] = useState("");
  const [acquisitionMethod, setAcquisitionMethod] = useState<OldMaterialAcquisitionMethod | undefined>(undefined);
  const [heritageSite, setHeritageSite] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<OldMaterialDTO | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [form] = Form.useForm();
  const [lossModalOpen, setLossModalOpen] = useState(false);
  const [lossResult, setLossResult] = useState<LossEstimateResponse | null>(null);
  const [lossCalculating, setLossCalculating] = useState(false);
  const [lossForm] = Form.useForm();

  useEffect(() => {
    const t = setTimeout(() => setDebouncedKeyword(keyword), 350);
    return () => clearTimeout(t);
  }, [keyword]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [list, stat] = await Promise.all([
        api.listOldMaterials({
          limit: 200,
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
      material_type: "old_brick",
      material_source: "site_salvage",
      storage_condition: "shelter",
      transport_distance_km: 20,
      construction_method: "manual",
    });
    setLossModalOpen(true);
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
      title: "基价",
      dataIndex: "base_price",
      width: 100,
      align: "right",
      sorter: (a, b) => a.base_price - b.base_price,
      render: (v: number) => `¥${v.toFixed(2)}`,
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
    <div className="page-container">
      {/* 定额编制标准依据说明 */}
      <div className="content-card" style={{ marginBottom: 16 }}>
        <div className="content-card-body oml-standards-banner">
          <span className="material-symbols-outlined">verified_user</span>
          <div>
            <strong>定额编制标准依据</strong>
            <p>本库定额条目、综合单价、换算规则与适用工况严格对标国家现行工程造价定额规范、地方计价标准及建筑工程材料定额标准编制，未作任何私自增删与改动，可直接用于工程造价编制、报审与结算复核工作。</p>
          </div>
        </div>
      </div>
      {/* KPI 指标卡 */}
      <div className="kpi-grid">
        <div className="kpi-card">
          <span className="material-symbols-outlined kpi-card-icon">inventory_2</span>
          <div className="kpi-card-body">
            <span className="kpi-card-label">旧材料条目</span>
            <span className="kpi-card-value">{stats?.total ?? 0}<span className="kpi-card-suffix">条</span></span>
          </div>
        </div>
        <div className="kpi-card">
          <span className="material-symbols-outlined kpi-card-icon" style={{ color: "#34d399" }}>recycling</span>
          <div className="kpi-card-body">
            <span className="kpi-card-label">当地回收</span>
            <span className="kpi-card-value">{methodStats.recycle.count}<span className="kpi-card-suffix">条</span></span>
          </div>
        </div>
        <div className="kpi-card">
          <span className="material-symbols-outlined kpi-card-icon" style={{ color: "#a78bfa" }}>science</span>
          <div className="kpi-card-body">
            <span className="kpi-card-label">原材料复现</span>
            <span className="kpi-card-value">{methodStats.reproduce.count}<span className="kpi-card-suffix">条</span></span>
          </div>
        </div>
        <div className="kpi-card">
          <span className="material-symbols-outlined kpi-card-icon">temple_buddhist</span>
          <div className="kpi-card-body">
            <span className="kpi-card-label">涉及遗址</span>
            <span className="kpi-card-value">{stats?.by_heritage_site.length ?? 0}<span className="kpi-card-suffix">处</span></span>
          </div>
        </div>
      </div>

      {/* 获取方式分布 */}
      {stats && stats.total > 0 && (
        <div className="content-card">
          <div className="content-card-head">
            <h3 className="content-card-title">
              <span className="material-symbols-outlined">donut_large</span>
              获取方式分布
            </h3>
          </div>
          <div className="content-card-body">
            <div className="quota-resource-overview">
              {(Object.keys(ACQUISITION_METHOD_META) as OldMaterialAcquisitionMethod[]).map((m) => {
                const meta = ACQUISITION_METHOD_META[m];
                const stat = methodStats[m];
                return (
                  <div key={m} className="quota-resource-card">
                    <span className="material-symbols-outlined quota-resource-icon" style={{ color: meta.color }}>
                      {meta.icon}
                    </span>
                    <div className="quota-resource-body">
                      <span className="quota-resource-label">{meta.label}</span>
                      <strong className="quota-resource-value">{stat.count}</strong>
                      <Progress percent={stat.percent} strokeColor={meta.color} showInfo={false} size="small" />
                      <span className="quota-resource-percent">{stat.percent}%</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* 筛选栏 */}
      <div className="filter-bar">
        <Input
          allowClear
          prefix={<SearchOutlined />}
          placeholder="搜索编码或材料名称"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          style={{ width: 260 }}
        />
        <Select
          allowClear
          placeholder="获取方式"
          value={acquisitionMethod}
          onChange={(v) => setAcquisitionMethod(v ?? undefined)}
          style={{ width: 160 }}
          options={ACQUISITION_METHOD_OPTIONS}
        />
        <Select
          allowClear
          placeholder="关联遗址"
          value={heritageSite || undefined}
          onChange={(v) => setHeritageSite(v ?? "")}
          style={{ width: 220 }}
          options={heritageSiteOptions}
          showSearch
        />
        <Button icon={<ReloadOutlined />} loading={loading} onClick={load}>
          刷新
        </Button>
        <Button icon={<CalculatorOutlined />} onClick={openLossEstimate}>
          AI损耗预测
        </Button>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
          新增旧材料
        </Button>
      </div>

      {/* 旧材料定额表格 */}
      <div className="content-card">
        <div className="content-card-body flush">
          <Table
            rowKey="id"
            columns={columns}
            dataSource={items}
            loading={loading}
            scroll={{ x: 1500 }}
            pagination={{ pageSize: 20, showSizeChanger: true, showTotal: (t) => `共 ${t} 条` }}
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
        </div>
      </div>

      {/* 创建/编辑模态框 */}
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
        <Form form={form} layout="vertical" preserve={false}>
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
            <Form.Item name="base_price" label="基价（元）">
              <InputNumber min={0} style={{ width: "100%" }} />
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
                  acquisitionMethod === "recycle"
                    ? "回收地点，如：当地旧料市场回收"
                    : "复现依据，如：按遗址原始配料比重新烧制"
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
        <p style={{ color: "#64748b", marginBottom: 16 }}>
          输入材料类别、来源、存储条件、运输距离与施工方式，模型输出预测损耗率，并与老师傅经验值相互印证。预测损耗率直接计入材料消耗量，为补充定额编制提供数据。
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
          <div style={{ borderTop: "1px solid #e2e8f0", paddingTop: 16 }}>
            <div style={{ textAlign: "center", marginBottom: 16 }}>
              <div style={{ fontSize: 13, color: "#64748b" }}>预测损耗率</div>
              <div style={{ fontSize: 32, fontWeight: 700, color: "#0f766e" }}>
                {lossResult.loss_rate_expected}%
              </div>
              <div style={{ fontSize: 13, color: "#64748b" }}>
                区间 {lossResult.loss_rate_low}% ~ {lossResult.loss_rate_high}%
              </div>
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                background: "#f0fdfa",
                border: "1px solid #ccfbf1",
                borderRadius: 8,
                padding: "10px 14px",
                marginBottom: 16,
              }}
            >
              <span style={{ fontSize: 13, color: "#0f766e" }}>
                老师傅经验值 <b>{lossResult.experience_rate}%</b>
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
