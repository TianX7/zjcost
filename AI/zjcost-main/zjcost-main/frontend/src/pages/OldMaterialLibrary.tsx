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
import { DeleteOutlined, EditOutlined, PlusOutlined, ReloadOutlined, SearchOutlined } from "@ant-design/icons";
import {
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
    </div>
  );
}
