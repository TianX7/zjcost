import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Button,
  Col,
  Descriptions,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Row,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  Typography,
  Upload,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import type { UploadProps } from "antd";
import {
  CalculatorOutlined,
  CameraOutlined,
  DeleteOutlined,
  FileExcelOutlined,
  FileTextOutlined,
  LinkOutlined,
  PlusOutlined,
  ReloadOutlined,
  SafetyOutlined,
  SettingOutlined,
  ThunderboltOutlined,
  DashboardOutlined,
} from "@ant-design/icons";
import type {
  BoqItem,
  BoqItemCreate,
  CalcSummary,
  DiffReport,
  MaterialPrice,
  MeasureItem,
  Project,
  RulePackage,
  Snapshot,
  ValidationReport,
} from "../api";
import { api } from "../api";
import BindingTab from "./BindingTab";

interface Props {
  projectId: number;
  project: Project | null;
}

function money(value: number | null | undefined) {
  return Number(value ?? 0).toLocaleString("zh-CN", { style: "currency", currency: "CNY" });
}

function dateText(value: string | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("zh-CN");
}

function OverviewTab({ projectId, project }: Props) {
  const [summary, setSummary] = useState<Awaited<ReturnType<typeof api.getDashboardSummary>> | null>(null);
  const [health, setHealth] = useState<Awaited<ReturnType<typeof api.getHealthScore>> | null>(null);
  const [logs, setLogs] = useState<Awaited<ReturnType<typeof api.listAuditLogs>>>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [summaryData, healthData, logData] = await Promise.all([
        api.getDashboardSummary(projectId).catch(() => null),
        api.getHealthScore(projectId).catch(() => null),
        api.listAuditLogs(projectId).catch(() => []),
      ]);
      setSummary(summaryData);
      setHealth(healthData);
      setLogs(logData);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* 项目标题栏 */}
      <div className="workspace-toolbar" style={{ justifyContent: "space-between" }}>
        <div>
          <Typography.Title level={4} style={{ margin: 0, color: "#e2e8f0" }}>{project?.name ?? `项目 #${projectId}`}</Typography.Title>
          <Typography.Text style={{ color: "#64748b" }}>{project?.description || "工程造价全过程工作台"}</Typography.Text>
        </div>
        <Button icon={<ReloadOutlined />} loading={loading} onClick={load}>刷新</Button>
      </div>

      {/* KPI 指标卡 */}
      <div className="kpi-grid">
        <div className="kpi-card">
          <span className="material-symbols-outlined kpi-card-icon">list_alt</span>
          <div className="kpi-card-body">
            <span className="kpi-card-label">清单项</span>
            <span className="kpi-card-value">{summary?.boq_count ?? 0}</span>
          </div>
        </div>
        <div className="kpi-card">
          <span className="material-symbols-outlined kpi-card-icon" style={{ color: (summary?.unbound_count ?? 0) > 0 ? "#f87171" : undefined, background: (summary?.unbound_count ?? 0) > 0 ? "rgba(248,113,113,0.12)" : undefined, borderColor: (summary?.unbound_count ?? 0) > 0 ? "rgba(248,113,113,0.2)" : undefined }}>link_off</span>
          <div className="kpi-card-body">
            <span className="kpi-card-label">未绑定</span>
            <span className="kpi-card-value" style={{ color: (summary?.unbound_count ?? 0) > 0 ? "#f87171" : undefined }}>{summary?.unbound_count ?? 0}</span>
          </div>
        </div>
        <div className="kpi-card">
          <span className="material-symbols-outlined kpi-card-icon">rule</span>
          <div className="kpi-card-body">
            <span className="kpi-card-label">校验问题</span>
            <span className="kpi-card-value">{summary?.validation_total ?? 0}</span>
          </div>
        </div>
        <div className="kpi-card">
          <span className="material-symbols-outlined kpi-card-icon">payments</span>
          <div className="kpi-card-body">
            <span className="kpi-card-label">总造价</span>
            <span className="kpi-card-value">{money(summary?.calc_total)}</span>
          </div>
        </div>
      </div>

      {/* 健康度 + 项目资料 */}
      <div className="reports-split-grid">
        <div className="content-card">
          <div className="content-card-head">
            <h3 className="content-card-title"><span className="material-symbols-outlined">health_and_safety</span>项目健康度</h3>
          </div>
          <div className="content-card-body">
            {health ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                  <span style={{ fontSize: 28, fontWeight: 800, color: "#38bdf8" }}>{health.overall_score}</span>
                  <span style={{ fontSize: 14, color: "#64748b" }}>/ {health.grade}</span>
                </div>
                {health.dimensions.map((item) => (
                  <div key={item.name} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <Typography.Text style={{ color: "#cbd5e1", fontSize: 13 }}>{item.name}</Typography.Text>
                      <Typography.Text strong style={{ color: "#e2e8f0" }}>{item.score}</Typography.Text>
                    </div>
                    <Typography.Text style={{ color: "#64748b", fontSize: 12 }}>{item.detail}</Typography.Text>
                  </div>
                ))}
              </div>
            ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无健康度数据" />}
          </div>
        </div>

        <div className="content-card">
          <div className="content-card-head">
            <h3 className="content-card-title"><span className="material-symbols-outlined">description</span>项目资料</h3>
          </div>
          <div className="content-card-body">
            <Descriptions column={1} size="small">
              <Descriptions.Item label="地区">{project?.region ?? "-"}</Descriptions.Item>
              <Descriptions.Item label="类型">{project?.project_type ?? "-"}</Descriptions.Item>
              <Descriptions.Item label="状态"><Tag>{project?.status ?? "-"}</Tag></Descriptions.Item>
              <Descriptions.Item label="预算">{project?.budget != null ? money(project.budget) : "-"}</Descriptions.Item>
              <Descriptions.Item label="起止日期">{dateText(project?.start_date)} 至 {dateText(project?.end_date)}</Descriptions.Item>
            </Descriptions>
          </div>
        </div>
      </div>

      {/* 最近操作 */}
      <div className="content-card">
        <div className="content-card-head">
          <h3 className="content-card-title"><span className="material-symbols-outlined">history</span>最近操作</h3>
        </div>
        <div className="content-card-body flush">
          <Table
            rowKey="id"
            size="small"
            pagination={{ pageSize: 6 }}
            dataSource={logs}
            columns={[
              { title: "时间", dataIndex: "timestamp", render: dateText, width: 160 },
              { title: "人员", dataIndex: "actor", width: 120 },
              { title: "动作", dataIndex: "action", width: 140, render: (value: string) => <Tag color="blue">{value}</Tag> },
              { title: "对象", dataIndex: "resource_type" },
            ]}
          />
        </div>
      </div>
    </div>
  );
}

function BoqWorkspaceTab({ projectId }: { projectId: number }) {
  const [items, setItems] = useState<BoqItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<BoqItem | null>(null);
  const [autoLoading, setAutoLoading] = useState(false);
  const [form] = Form.useForm<BoqItemCreate>();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await api.listBoqItems(projectId));
    } catch (err) {
      message.error(err instanceof Error ? err.message : "加载清单失败");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    const values = await form.validateFields();
    try {
      if (editing) await api.updateBoqItem(projectId, editing.id, values);
      else await api.createBoqItem(projectId, values);
      message.success("清单已保存");
      setOpen(false);
      setEditing(null);
      form.resetFields();
      await load();
    } catch (err) {
      message.error(err instanceof Error ? err.message : "保存失败");
    }
  };

  const startCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ unit: "项", quantity: 1 });
    setOpen(true);
  };

  const startEdit = (row: BoqItem) => {
    setEditing(row);
    form.setFieldsValue(row);
    setOpen(true);
  };

  const handleAutoValuate = async () => {
    setAutoLoading(true);
    try {
      const res = await api.autoValuate(projectId);
      message.success(`自动套定额完成：匹配 ${res.newly_matched} 项`);
      await load();
    } catch (err) {
      message.error(err instanceof Error ? err.message : "自动套定额失败");
    } finally {
      setAutoLoading(false);
    }
  };

  const importProps: UploadProps = {
    accept: ".xlsx,.xls,.csv",
    showUploadList: false,
    beforeUpload: async (file) => {
      try {
        const result = await api.importBoq(projectId, file);
        message.success(`导入完成：${result.imported ?? result.created ?? 0} 条`);
        await load();
      } catch (err) {
        message.error(err instanceof Error ? err.message : "导入失败");
      }
      return false;
    },
  };

  const columns: ColumnsType<BoqItem> = [
    { title: "编码", dataIndex: "code", width: 120, fixed: "left" },
    { title: "名称", dataIndex: "name", width: 260, ellipsis: true },
    { title: "项目特征", dataIndex: "characteristics", width: 280, ellipsis: true },
    { title: "单位", dataIndex: "unit", width: 70 },
    { title: "工程量", dataIndex: "quantity", width: 110, render: (value: number) => Number(value ?? 0).toLocaleString("zh-CN") },
    { title: "分部", dataIndex: "division", width: 140 },
    { title: "综合单价", dataIndex: "rate", width: 110, render: money },
    { title: "合价", dataIndex: "amount", width: 120, render: money },
    {
      title: "操作",
      width: 140,
      fixed: "right",
      render: (_, row) => (
        <Space>
          <Button size="small" type="link" onClick={() => startEdit(row)}>编辑</Button>
          <Popconfirm title="确认删除该清单项？" onConfirm={async () => { await api.deleteBoqItem(projectId, row.id); await load(); }}>
            <Button size="small" type="link" danger>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="workspace-toolbar">
        <Button type="primary" icon={<PlusOutlined />} onClick={startCreate}>新增清单</Button>
        <Upload {...importProps}><Button icon={<FileExcelOutlined />}>导入清单</Button></Upload>
        <Button icon={<ThunderboltOutlined />} loading={autoLoading} onClick={handleAutoValuate}>自动套定额</Button>
        <Button icon={<ReloadOutlined />} loading={loading} onClick={load} style={{ marginLeft: "auto" }}>刷新</Button>
      </div>
      <div className="content-card">
        <div className="content-card-head">
          <h3 className="content-card-title"><span className="material-symbols-outlined">table_rows</span>清单明细（{items.length} 项）</h3>
        </div>
        <div className="content-card-body flush">
          <Table rowKey="id" columns={columns} dataSource={items} loading={loading} scroll={{ x: 1350 }} pagination={{ pageSize: 20, showSizeChanger: true, showTotal: (total) => `共 ${total} 条` }} />
        </div>
      </div>

      <Modal title={editing ? "编辑清单项" : "新增清单项"} open={open} onCancel={() => setOpen(false)} onOk={save} width={760}>
        <Form form={form} layout="vertical">
          <Row gutter={12}>
            <Col span={8}><Form.Item name="code" label="编码" rules={[{ required: true }]}><Input /></Form.Item></Col>
            <Col span={16}><Form.Item name="name" label="名称" rules={[{ required: true }]}><Input /></Form.Item></Col>
            <Col span={24}><Form.Item name="characteristics" label="项目特征"><Input.TextArea rows={3} /></Form.Item></Col>
            <Col span={6}><Form.Item name="unit" label="单位" rules={[{ required: true }]}><Input /></Form.Item></Col>
            <Col span={6}><Form.Item name="quantity" label="工程量" rules={[{ required: true }]}><InputNumber min={0} style={{ width: "100%" }} /></Form.Item></Col>
            <Col span={6}><Form.Item name="rate" label="综合单价"><InputNumber min={0} style={{ width: "100%" }} /></Form.Item></Col>
            <Col span={6}><Form.Item name="division" label="分部"><Input /></Form.Item></Col>
            <Col span={12}><Form.Item name="trade_section" label="专业/章节"><Input /></Form.Item></Col>
            <Col span={12}><Form.Item name="remark" label="备注"><Input /></Form.Item></Col>
          </Row>
        </Form>
      </Modal>
    </div>
  );
}

function CalcWorkspaceTab({ projectId }: { projectId: number }) {
  const navigate = useNavigate();
  const [result, setResult] = useState<CalcSummary | null>(null);

  const loadSummary = useCallback(async () => {
    try {
      setResult(await api.getCalcSummary(projectId));
    } catch {
      setResult(null);
    }
  }, [projectId]);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  // 入口卡片：引导到独立的清单计价页面，避免功能重复
  return (
    <div className="workspace-portal">
      <div className="workspace-portal-card">
        <div className="workspace-portal-icon" style={{ background: "linear-gradient(135deg, rgba(56,189,248,0.2), rgba(59,130,246,0.12))", borderColor: "rgba(56,189,248,0.3)", color: "#38bdf8" }}>
          <span className="material-symbols-outlined">calculate</span>
        </div>
        <div className="workspace-portal-body">
          <h3 className="workspace-portal-title">清单计价</h3>
          <p className="workspace-portal-desc">执行计价计算、查看费用构成、综合单价分析和计价明细。</p>
          {result && (
            <div className="workspace-portal-stats">
              <span><em>总造价</em><strong>{money(result.grand_total)}</strong></span>
              <span><em>直接费</em><strong>{money(result.total_direct)}</strong></span>
              <span><em>明细</em><strong>{result.line_results?.length ?? 0} 项</strong></span>
            </div>
          )}
        </div>
        <Button type="primary" icon={<CalculatorOutlined />} onClick={() => navigate("/pricing-audit")}>
          打开计价页
        </Button>
      </div>
    </div>
  );
}

function ValidationWorkspaceTab({ projectId }: { projectId: number }) {
  const navigate = useNavigate();
  const [report, setReport] = useState<ValidationReport | null>(null);
  const [loading, setLoading] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      setReport(await api.validate(projectId));
    } catch {
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, [projectId]);
  useEffect(() => { void load(); }, [load]);

  // 入口卡片：引导到独立的审计复核页面，避免功能重复
  return (
    <div className="workspace-portal">
      <div className="workspace-portal-card">
        <div className="workspace-portal-icon" style={{ background: "linear-gradient(135deg, rgba(250,204,21,0.2), rgba(245,158,11,0.12))", borderColor: "rgba(250,204,21,0.3)", color: "#facc15" }}>
          <span className="material-symbols-outlined">policy</span>
        </div>
        <div className="workspace-portal-body">
          <h3 className="workspace-portal-title">审计复核</h3>
          <p className="workspace-portal-desc">规则校验、计价审查、风险提示和审计汇总，形成可追踪的审计结论。</p>
          {report && (
            <div className="workspace-portal-stats">
              <span><em>问题总数</em><strong style={{ color: (report.total_issues ?? 0) > 0 ? "#facc15" : "#34d399" }}>{report.total_issues ?? 0}</strong></span>
              <span><em>错误</em><strong style={{ color: (report.errors ?? 0) > 0 ? "#f87171" : "#34d399" }}>{report.errors ?? 0}</strong></span>
              <span><em>警告</em><strong>{report.warnings ?? 0}</strong></span>
            </div>
          )}
        </div>
        <Button type="primary" icon={<SafetyOutlined />} loading={loading} onClick={() => navigate("/pricing-audit")}>
          打开审计页
        </Button>
      </div>
    </div>
  );
}

function SnapshotWorkspaceTab({ projectId }: { projectId: number }) {
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [label, setLabel] = useState("");
  const [a, setA] = useState<number>();
  const [b, setB] = useState<number>();
  const [diff, setDiff] = useState<DiffReport | null>(null);
  const load = useCallback(async () => setSnapshots(await api.listSnapshots(projectId)), [projectId]);
  useEffect(() => { void load(); }, [load]);

  const create = async () => {
    await api.createSnapshot(projectId, label || `快照 ${new Date().toLocaleString("zh-CN")}`);
    setLabel("");
    message.success("快照已创建");
    await load();
  };
  const compare = async () => {
    if (!a || !b) return message.warning("请选择两个快照");
    setDiff(await api.diffSnapshots(projectId, a, b));
  };

  const options = snapshots.map((snapshot) => ({ value: snapshot.id, label: `#${snapshot.id} ${snapshot.label}` }));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="workspace-toolbar">
        <Input placeholder="快照名称" value={label} onChange={(event) => setLabel(event.target.value)} style={{ width: 240 }} />
        <Button type="primary" icon={<CameraOutlined />} onClick={create}>创建快照</Button>
        <Select placeholder="快照 A" options={options} value={a} onChange={setA} style={{ width: 220 }} />
        <Select placeholder="快照 B" options={options} value={b} onChange={setB} style={{ width: 220 }} />
        <Button onClick={compare}>对比</Button>
      </div>
      <div className="content-card">
        <div className="content-card-head">
          <h3 className="content-card-title"><span className="material-symbols-outlined">photo_library</span>历史快照</h3>
        </div>
        <div className="content-card-body flush">
          <Table rowKey="id" size="small" dataSource={snapshots} columns={[
            { title: "ID", dataIndex: "id", width: 80 },
            { title: "名称", dataIndex: "label" },
            { title: "总造价", dataIndex: "grand_total", render: money },
            { title: "创建时间", dataIndex: "created_at", render: dateText },
          ]} />
        </div>
      </div>
      {diff && (
        <div className="content-card">
          <div className="content-card-head">
            <h3 className="content-card-title"><span className="material-symbols-outlined">compare_arrows</span>对比结果</h3>
          </div>
          <div className="content-card-body">
            <Descriptions column={3}>
              <Descriptions.Item label="旧总价">{money(diff.old_grand_total)}</Descriptions.Item>
              <Descriptions.Item label="新总价">{money(diff.new_grand_total)}</Descriptions.Item>
              <Descriptions.Item label="差额">{money(diff.grand_total_delta)}</Descriptions.Item>
            </Descriptions>
            <Typography.Paragraph type="secondary">{diff.explanation}</Typography.Paragraph>
            <Table rowKey={(row) => `${row.boq_code}-${row.change_type}`} size="small" dataSource={diff.lines} columns={[
              { title: "编码", dataIndex: "boq_code" },
              { title: "名称", dataIndex: "boq_name" },
              { title: "变化", dataIndex: "change_type", render: (value: string) => <Tag>{value}</Tag> },
              { title: "旧价", dataIndex: "old_total", render: money },
              { title: "新价", dataIndex: "new_total", render: money },
              { title: "差额", dataIndex: "delta", render: money },
            ]} />
          </div>
        </div>
      )}
    </div>
  );
}

function SettingsWorkspaceTab({ projectId }: { projectId: number }) {
  const navigate = useNavigate();
  const [rules, setRules] = useState<RulePackage[]>([]);
  const [materials, setMaterials] = useState<MaterialPrice[]>([]);
  const [measures, setMeasures] = useState<MeasureItem[]>([]);
  const [ruleForm] = Form.useForm();
  const [measureForm] = Form.useForm();
  const [ruleOpen, setRuleOpen] = useState(false);
  const [measureOpen, setMeasureOpen] = useState(false);

  const load = useCallback(async () => {
    const [ruleData, materialData, measureData] = await Promise.all([
      api.listRulePackages().catch(() => []),
      api.listMaterialPrices({ latest_only: true }).catch(() => []),
      api.listMeasures(projectId).catch(() => []),
    ]);
    setRules(ruleData);
    setMaterials(materialData);
    setMeasures(measureData);
  }, [projectId]);

  useEffect(() => { void load(); }, [load]);

  const createRule = async () => {
    await api.createRulePackage(await ruleForm.validateFields());
    ruleForm.resetFields();
    setRuleOpen(false);
    await load();
  };
  const createMeasure = async () => {
    await api.createMeasure(projectId, await measureForm.validateFields());
    measureForm.resetFields();
    setMeasureOpen(false);
    await load();
  };

  return (
    <Tabs
      items={[
        {
          key: "rules",
          label: "规则包",
          children: (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div className="workspace-toolbar">
                <Button icon={<PlusOutlined />} onClick={() => setRuleOpen((value) => !value)}>新建规则包</Button>
                <Button icon={<ReloadOutlined />} onClick={load} style={{ marginLeft: "auto" }}>刷新</Button>
              </div>
              {ruleOpen && (
                <div className="content-card">
                  <div className="content-card-body">
                    <Form form={ruleForm} layout="inline">
                      <Form.Item name="name" rules={[{ required: true }]}><Input placeholder="名称" /></Form.Item>
                      <Form.Item name="region"><Input placeholder="地区" /></Form.Item>
                      <Form.Item name="management_rate"><InputNumber placeholder="管理费率" /></Form.Item>
                      <Form.Item name="profit_rate"><InputNumber placeholder="利润率" /></Form.Item>
                      <Form.Item name="tax_rate"><InputNumber placeholder="税率" /></Form.Item>
                      <Button type="primary" onClick={createRule}>创建</Button>
                    </Form>
                  </div>
                </div>
              )}
              <div className="content-card">
                <div className="content-card-body flush">
                  <Table rowKey="id" size="small" dataSource={rules} columns={[
                    { title: "名称", dataIndex: "name" },
                    { title: "地区", dataIndex: "region" },
                    { title: "管理费率", dataIndex: "management_rate" },
                    { title: "利润率", dataIndex: "profit_rate" },
                    { title: "税率", dataIndex: "tax_rate" },
                    { title: "操作", render: (_, row) => <Button type="link" onClick={async () => { await api.bindRulePackage(projectId, row.id); message.success("规则包已绑定"); }}>绑定</Button> },
                  ]} />
                </div>
              </div>
            </div>
          ),
        },
        {
          key: "materials",
          label: "材料价格",
          children: (
            <div className="workspace-portal">
              <div className="workspace-portal-card">
                <div className="workspace-portal-icon" style={{ background: "linear-gradient(135deg, rgba(52,211,153,0.2), rgba(16,185,129,0.12))", borderColor: "rgba(52,211,153,0.3)", color: "#34d399" }}>
                  <span className="material-symbols-outlined">payments</span>
                </div>
                <div className="workspace-portal-body">
                  <h3 className="workspace-portal-title">市场价信息</h3>
                  <p className="workspace-portal-desc">维护人工、材料、机械单价，在线抓取市场信息价，支持手工补录和价格源管理。</p>
                  <div className="workspace-portal-stats">
                    <span><em>当前材料价</em><strong>{materials.length} 条</strong></span>
                  </div>
                </div>
                <Button type="primary" icon={<CalculatorOutlined />} onClick={() => navigate("/data-resources")}>
                  打开市场价
                </Button>
              </div>
            </div>
          ),
        },
        {
          key: "measures",
          label: "措施项目",
          children: (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div className="workspace-toolbar">
                <Button icon={<PlusOutlined />} onClick={() => setMeasureOpen((value) => !value)}>新增措施项目</Button>
              </div>
              {measureOpen && (
                <div className="content-card">
                  <div className="content-card-body">
                    <Form form={measureForm} layout="inline">
                      <Form.Item name="name" rules={[{ required: true }]}><Input placeholder="名称" /></Form.Item>
                      <Form.Item name="calc_base"><Select placeholder="计算基数" style={{ width: 120 }} options={[{ value: "direct", label: "直接费" }, { value: "pre_tax", label: "税前" }]} /></Form.Item>
                      <Form.Item name="rate"><InputNumber placeholder="费率" /></Form.Item>
                      <Form.Item name="amount"><InputNumber placeholder="金额" /></Form.Item>
                      <Button type="primary" onClick={createMeasure}>创建</Button>
                    </Form>
                  </div>
                </div>
              )}
              <div className="content-card">
                <div className="content-card-body flush">
                  <Table rowKey="id" size="small" dataSource={measures} columns={[
                    { title: "名称", dataIndex: "name" },
                    { title: "计算基数", dataIndex: "calc_base" },
                    { title: "费率", dataIndex: "rate" },
                    { title: "金额", dataIndex: "amount", render: money },
                    { title: "类型", dataIndex: "is_fixed", render: (value: boolean) => <Tag>{value ? "固定" : "费率"}</Tag> },
                    { title: "操作", render: (_, row) => <Popconfirm title="确认删除？" onConfirm={async () => { await api.deleteMeasure(projectId, row.id); await load(); }}><Button icon={<DeleteOutlined />} danger size="small" /></Popconfirm> },
                  ]} />
                </div>
              </div>
            </div>
          ),
        },
      ]}
    />
  );
}

export default function RestoredProjectWorkspace({ projectId, project }: Props) {
  return (
    <Tabs
      defaultActiveKey="overview"
      items={[
        { key: "overview", label: <span><DashboardOutlined /> 项目总览</span>, children: <OverviewTab projectId={projectId} project={project} /> },
        { key: "boq", label: <span><FileTextOutlined /> 清单管理</span>, children: <BoqWorkspaceTab projectId={projectId} /> },
        { key: "binding", label: <span><LinkOutlined /> 定额绑定</span>, children: <BindingTab projectId={projectId} /> },
        { key: "calc", label: <span><CalculatorOutlined /> 计价计算</span>, children: <CalcWorkspaceTab projectId={projectId} /> },
        { key: "validation", label: <span><SafetyOutlined /> 校验审查</span>, children: <ValidationWorkspaceTab projectId={projectId} /> },
        { key: "snapshot", label: <span><CameraOutlined /> 快照对比</span>, children: <SnapshotWorkspaceTab projectId={projectId} /> },
        { key: "settings", label: <span><SettingOutlined /> 项目设置</span>, children: <SettingsWorkspaceTab projectId={projectId} /> },
      ]}
    />
  );
}
