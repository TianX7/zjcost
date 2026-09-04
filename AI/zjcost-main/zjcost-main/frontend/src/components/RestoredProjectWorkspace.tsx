import { useCallback, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
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
      {/* 项目描述 + 刷新（标题已在 PageHeader，避免重复） */}
      <div className="workspace-toolbar" style={{ justifyContent: "space-between" }}>
        <Typography.Text style={{ color: "var(--text-secondary)", fontSize: 13 }}>
          {project?.description || "工程造价全过程工作台"}
        </Typography.Text>
        <Button icon={<ReloadOutlined />} loading={loading} onClick={load}>刷新</Button>
      </div>

      {/* KPI 指标卡 */}
      <div className="kpi-grid">
        <div className="kpi-card">
          <span className="material-symbols-outlined kpi-card-icon">list_alt</span>
          <div className="kpi-card-body">
            <span className="kpi-card-label">清单项</span>
            <span className="kpi-card-value num">{summary?.boq_count ?? 0}</span>
          </div>
        </div>
        <div className="kpi-card">
          <span className="material-symbols-outlined kpi-card-icon" style={{ color: (summary?.unbound_count ?? 0) > 0 ? "#f87171" : undefined, background: (summary?.unbound_count ?? 0) > 0 ? "rgba(248,113,113,0.12)" : undefined, borderColor: (summary?.unbound_count ?? 0) > 0 ? "rgba(248,113,113,0.2)" : undefined }}>link_off</span>
          <div className="kpi-card-body">
            <span className="kpi-card-label">未绑定</span>
            <span className="kpi-card-value num" style={{ color: (summary?.unbound_count ?? 0) > 0 ? "#f87171" : undefined }}>{summary?.unbound_count ?? 0}</span>
          </div>
        </div>
        <div className="kpi-card">
          <span className="material-symbols-outlined kpi-card-icon">rule</span>
          <div className="kpi-card-body">
            <span className="kpi-card-label">校验问题</span>
            <span className="kpi-card-value num">{summary?.validation_total ?? 0}</span>
          </div>
        </div>
        <div className="kpi-card">
          <span className="material-symbols-outlined kpi-card-icon">payments</span>
          <div className="kpi-card-body">
            <span className="kpi-card-label">总造价</span>
            <span className="kpi-card-value num">{money(summary?.calc_total)}</span>
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
                  <div key={item.name} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <Typography.Text style={{ color: "#cbd5e1", fontSize: 13 }}>{item.name}</Typography.Text>
                      <Typography.Text strong className="num" style={{ color: "#e2e8f0" }}>{item.score}</Typography.Text>
                    </div>
                    <div style={{ height: 5, borderRadius: 3, background: "rgba(30, 58, 95, 0.8)", overflow: "hidden" }}>
                      <div className="ws-bar-fill" style={{ height: "100%", width: `${Math.max(0, Math.min(100, Number(item.score) || 0))}%`, borderRadius: 3, background: "linear-gradient(90deg, #2563eb, #4dd4ff)" }} />
                    </div>
                    <Typography.Text style={{ color: "var(--text-secondary)", fontSize: 12 }}>{item.detail}</Typography.Text>
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
            <Descriptions column={2} size="small">
              <Descriptions.Item label="地区">{project?.region ?? "-"}</Descriptions.Item>
              <Descriptions.Item label="类型">{project?.project_type ?? "-"}</Descriptions.Item>
              <Descriptions.Item label="状态">
                <Tag color={project?.status === "completed" ? "green" : project?.status === "archived" ? "default" : "processing"}>
                  {project?.status ?? "-"}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="预算"><span className="num">{project?.budget != null ? money(project.budget) : "-"}</span></Descriptions.Item>
              <Descriptions.Item label="起止日期" span={2}>{dateText(project?.start_date)} 至 {dateText(project?.end_date)}</Descriptions.Item>
              <Descriptions.Item label="负责人" span={2}>{project?.owner ?? "-"}</Descriptions.Item>
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
            loading={loading}
            pagination={{ pageSize: 6, showTotal: (t) => `共 ${t} 条` }}
            dataSource={logs}
            locale={{ emptyText: "暂无操作记录" }}
            columns={[
              { title: "时间", dataIndex: "timestamp", render: dateText, width: 160 },
              { title: "人员", dataIndex: "actor", width: 120, render: (v: string) => v ?? "-" },
              { title: "动作", dataIndex: "action", width: 140, render: (value: string) => <Tag color="blue">{value}</Tag> },
              { title: "对象", dataIndex: "resource_type", render: (v: string) => v ?? "-" },
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
      message.success(`自动套定额完成：匹配 ${res.newly_matched} 项，可到「定额绑定」页复核低置信度项`);
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
    { title: "编码", dataIndex: "code", width: 120, fixed: "left", ellipsis: true },
    { title: "名称", dataIndex: "name", width: 260, ellipsis: true },
    { title: "项目特征", dataIndex: "characteristics", width: 280, ellipsis: true },
    { title: "单位", dataIndex: "unit", width: 70 },
    { title: "工程量", dataIndex: "quantity", width: 110, align: "right", render: (value: number) => <span className="num">{Number(value ?? 0).toLocaleString("zh-CN")}</span> },
    { title: "分部", dataIndex: "division", width: 140, ellipsis: true },
    { title: "综合单价", dataIndex: "rate", width: 120, align: "right", render: (v: number) => <span className="num">{money(v)}</span> },
    { title: "合价", dataIndex: "amount", width: 130, align: "right", render: (v: number) => <span className="num">{money(v)}</span> },
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

      <Modal title={editing ? "编辑清单项" : "新增清单项"} open={open} onCancel={() => setOpen(false)} onOk={save} width={760} destroyOnClose>
        <Form form={form} layout="vertical" preserve={false}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>基本信息</Typography.Text>
          <Row gutter={12} style={{ marginTop: 8 }}>
            <Col span={8}><Form.Item name="code" label="编码" rules={[{ required: true, message: "请输入编码" }]}><Input placeholder="如 010101001001" /></Form.Item></Col>
            <Col span={16}><Form.Item name="name" label="名称" rules={[{ required: true, message: "请输入名称" }]}><Input placeholder="清单项目名称" maxLength={80} /></Form.Item></Col>
            <Col span={24}><Form.Item name="characteristics" label="项目特征"><Input.TextArea rows={4} placeholder="描述材质、规格、做法等计价要素" maxLength={500} showCount /></Form.Item></Col>
          </Row>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>工程量与计价</Typography.Text>
          <Row gutter={12} style={{ marginTop: 8 }}>
            <Col span={6}><Form.Item name="unit" label="单位" rules={[{ required: true, message: "请输入单位" }]}><Input placeholder="m³ / m² / 项" /></Form.Item></Col>
            <Col span={6}><Form.Item name="quantity" label="工程量" rules={[{ required: true, message: "请输入工程量" }]}><InputNumber min={0} style={{ width: "100%" }} /></Form.Item></Col>
            <Col span={6}><Form.Item name="rate" label="综合单价"><InputNumber min={0} style={{ width: "100%" }} /></Form.Item></Col>
            <Col span={6}><Form.Item name="division" label="分部"><Input placeholder="如 土石方工程" /></Form.Item></Col>
          </Row>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>归类与备注</Typography.Text>
          <Row gutter={12} style={{ marginTop: 8 }}>
            <Col span={12}><Form.Item name="trade_section" label="专业/章节"><Input placeholder="专业或章节" /></Form.Item></Col>
            <Col span={12}><Form.Item name="remark" label="备注"><Input placeholder="备注" maxLength={100} /></Form.Item></Col>
          </Row>
        </Form>
      </Modal>
    </div>
  );
}

function CalcWorkspaceTab({ projectId }: { projectId: number }) {
  const navigate = useNavigate();
  const [result, setResult] = useState<CalcSummary | null>(null);
  const [loading, setLoading] = useState(false);

  const loadSummary = useCallback(async () => {
    setLoading(true);
    try {
      setResult(await api.getCalcSummary(projectId));
    } catch {
      setResult(null);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  const topLines = (result?.line_results ?? []).slice().sort((x, y) => y.total - x.total).slice(0, 5);

  // 项目内嵌 mini 版：关键费用 + Top5 明细，详情再跳计价页
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="workspace-portal-mini">
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span className="workspace-portal-mini-icon" style={{ background: "rgba(61, 139, 255, 0.12)", borderColor: "var(--border-strong)", color: "var(--primary)" }}>
            <span className="material-symbols-outlined">calculate</span>
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h3 className="workspace-portal-mini-title">清单计价</h3>
            <p className="workspace-portal-mini-desc">项目内直接看费用构成与明细 Top5，完整分析去计价页。</p>
          </div>
          <Space>
            <Button icon={<ReloadOutlined />} loading={loading} onClick={loadSummary}>重算</Button>
            <Button type="primary" icon={<CalculatorOutlined />} onClick={() => navigate("/pricing-audit")}>打开计价页</Button>
          </Space>
        </div>
        {result ? (
          <div className="workspace-portal-mini-stats">
            <span><em>总造价</em><strong className="num">{money(result.grand_total)}</strong></span>
            <span><em>直接费</em><strong className="num">{money(result.total_direct)}</strong></span>
            <span><em>措施费</em><strong className="num">{money(result.total_measures)}</strong></span>
            <span><em>税金</em><strong className="num">{money(result.total_tax)}</strong></span>
            <span><em>明细</em><strong className="num">{result.line_results?.length ?? 0} 项</strong></span>
          </div>
        ) : (
          <Typography.Text type="secondary">暂无计价结果，先在清单管理中维护工程量与单价后重算。</Typography.Text>
        )}
      </div>
      <div className="content-card">
        <div className="content-card-head">
          <h3 className="content-card-title"><span className="material-symbols-outlined">leaderboard</span>合价 Top5</h3>
        </div>
        <div className="content-card-body flush">
          <Table
            rowKey="boq_item_id"
            size="small"
            loading={loading}
            pagination={false}
            locale={{ emptyText: "暂无明细" }}
            dataSource={topLines}
            columns={[
              { title: "编码", dataIndex: "boq_code", width: 130, ellipsis: true },
              { title: "名称", dataIndex: "boq_name", ellipsis: true },
              { title: "合价", dataIndex: "total", width: 140, align: "right", render: (v: number) => <span className="num">{money(v)}</span> },
            ]}
          />
        </div>
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

  // 项目内嵌 mini 版：问题统计 + Top5 问题，详情再跳审计页
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="workspace-portal-mini">
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span className="workspace-portal-mini-icon" style={{ background: "rgba(245, 158, 11, 0.12)", borderColor: "rgba(245, 158, 11, 0.35)", color: "var(--warning)" }}>
            <span className="material-symbols-outlined">policy</span>
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h3 className="workspace-portal-mini-title">审计复核</h3>
            <p className="workspace-portal-mini-desc">项目内直接看问题 Top5，规则校验与审计底稿去审计页。</p>
          </div>
          <Space>
            <Button icon={<ReloadOutlined />} loading={loading} onClick={load}>重新校验</Button>
            <Button type="primary" icon={<SafetyOutlined />} onClick={() => navigate("/pricing-audit")}>打开审计页</Button>
          </Space>
        </div>
        {report && (
          <div className="workspace-portal-mini-stats">
            <span><em>问题总数</em><strong className="num" style={{ color: (report.total_issues ?? 0) > 0 ? "var(--warning)" : "var(--success)" }}>{report.total_issues ?? 0}</strong></span>
            <span><em>错误</em><strong className="num" style={{ color: (report.errors ?? 0) > 0 ? "var(--danger)" : "var(--success)" }}>{report.errors ?? 0}</strong></span>
            <span><em>警告</em><strong className="num">{report.warnings ?? 0}</strong></span>
          </div>
        )}
      </div>
      <div className="content-card">
        <div className="content-card-head">
          <h3 className="content-card-title"><span className="material-symbols-outlined">report</span>待处理问题 Top5</h3>
        </div>
        <div className="content-card-body flush">
          <Table
            rowKey={(row: { code: string; boq_item_id: number | null }) => `${row.code}-${row.boq_item_id ?? "na"}`}
            size="small"
            loading={loading}
            pagination={false}
            locale={{ emptyText: "暂无问题，校验通过" }}
            dataSource={(report?.issues ?? []).slice(0, 5)}
            columns={[
              {
                title: "级别", dataIndex: "severity", width: 90,
                render: (v: string) => <Tag color={v === "error" ? "red" : "orange"}>{v === "error" ? "错误" : "警告"}</Tag>,
              },
              { title: "编码", dataIndex: "code", width: 120, ellipsis: true },
              { title: "问题", dataIndex: "message", ellipsis: true },
              { title: "建议", dataIndex: "suggestion", ellipsis: true },
            ]}
          />
        </div>
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
  const [loading, setLoading] = useState(false);
  const [comparing, setComparing] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      setSnapshots(await api.listSnapshots(projectId));
    } finally {
      setLoading(false);
    }
  }, [projectId]);
  useEffect(() => { void load(); }, [load]);

  const create = async () => {
    await api.createSnapshot(projectId, label || `快照 ${new Date().toLocaleString("zh-CN")}`);
    setLabel("");
    message.success("快照已创建");
    await load();
  };
  const compare = async () => {
    if (!a || !b) return message.warning("请选择两个快照");
    if (a === b) return message.warning("请选择两个不同的快照");
    setComparing(true);
    try {
      setDiff(await api.diffSnapshots(projectId, a, b));
    } finally {
      setComparing(false);
    }
  };

  const options = snapshots.map((snapshot) => ({ value: snapshot.id, label: `#${snapshot.id} ${snapshot.label} · ${dateText(snapshot.created_at)}` }));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="workspace-toolbar" style={{ justifyContent: "space-between" }}>
        <Space wrap>
          <Input placeholder="快照名称" value={label} onChange={(event) => setLabel(event.target.value)} style={{ width: 200 }} maxLength={40} />
          <Button type="primary" icon={<CameraOutlined />} onClick={create}>创建快照</Button>
        </Space>
        <Space wrap>
          <Select placeholder="快照 A（旧）" options={options} value={a} onChange={setA} style={{ width: 240 }} allowClear />
          <Select placeholder="快照 B（新）" options={options} value={b} onChange={setB} style={{ width: 240 }} allowClear />
          <Button onClick={compare} loading={comparing}>对比</Button>
          <Button icon={<ReloadOutlined />} loading={loading} onClick={load}>刷新</Button>
        </Space>
      </div>
      <div className="content-card">
        <div className="content-card-head">
          <h3 className="content-card-title"><span className="material-symbols-outlined">photo_library</span>历史快照</h3>
        </div>
        <div className="content-card-body flush">
          <Table
            rowKey="id" size="small" dataSource={snapshots} loading={loading}
            pagination={{ pageSize: 10, showTotal: (t) => `共 ${t} 个快照` }}
            locale={{ emptyText: "暂无快照，先创建一个基线" }}
            columns={[
              { title: "ID", dataIndex: "id", width: 80 },
              { title: "名称", dataIndex: "label", ellipsis: true },
              { title: "总造价", dataIndex: "grand_total", width: 150, align: "right", render: (v: number) => <span className="num">{money(v)}</span> },
              { title: "创建时间", dataIndex: "created_at", width: 130, render: dateText },
            ]}
          />
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
            <Table
              rowKey={(row: { boq_code: string; change_type: string }, index?: number) => `${row.boq_code}-${row.change_type}-${index ?? 0}`}
              size="small" dataSource={diff.lines}
              pagination={{ pageSize: 10, showTotal: (t) => `共 ${t} 条变化` }}
              columns={[
                { title: "编码", dataIndex: "boq_code", width: 130, ellipsis: true },
                { title: "名称", dataIndex: "boq_name", ellipsis: true },
                { title: "变化", dataIndex: "change_type", width: 100, render: (value: string) => <Tag>{value}</Tag> },
                { title: "旧价", dataIndex: "old_total", width: 130, align: "right", render: (v: number) => <span className="num">{money(v)}</span> },
                { title: "新价", dataIndex: "new_total", width: 130, align: "right", render: (v: number) => <span className="num">{money(v)}</span> },
                { title: "差额", dataIndex: "delta", width: 130, align: "right", render: (v: number) => <span className="num" style={{ color: Number(v) > 0 ? "var(--danger)" : Number(v) < 0 ? "var(--success)" : undefined }}>{money(v)}</span> },
              ]}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function SettingsWorkspaceTab({ projectId }: { projectId: number }) {
  const [rules, setRules] = useState<RulePackage[]>([]);
  const [measures, setMeasures] = useState<MeasureItem[]>([]);
  const [boundRuleId, setBoundRuleId] = useState<number | null>(null);
  const [ruleForm] = Form.useForm();
  const [measureForm] = Form.useForm();
  const [ruleOpen, setRuleOpen] = useState(false);
  const [measureOpen, setMeasureOpen] = useState(false);

  const load = useCallback(async () => {
    const [ruleData, measureData] = await Promise.all([
      api.listRulePackages().catch(() => []),
      api.listMeasures(projectId).catch(() => []),
    ]);
    setRules(ruleData);
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
                    <Form form={ruleForm} layout="inline" style={{ flexWrap: "wrap", gap: 8, rowGap: 12 }}>
                      <Form.Item name="name" rules={[{ required: true, message: "请输入名称" }]} style={{ marginBottom: 0 }}><Input placeholder="名称" style={{ width: 180 }} /></Form.Item>
                      <Form.Item name="region" style={{ marginBottom: 0 }}><Input placeholder="地区" style={{ width: 120 }} /></Form.Item>
                      <Form.Item name="management_rate" style={{ marginBottom: 0 }}><InputNumber placeholder="管理费率" style={{ width: 120 }} /></Form.Item>
                      <Form.Item name="profit_rate" style={{ marginBottom: 0 }}><InputNumber placeholder="利润率" style={{ width: 110 }} /></Form.Item>
                      <Form.Item name="tax_rate" style={{ marginBottom: 0 }}><InputNumber placeholder="税率" style={{ width: 100 }} /></Form.Item>
                      <Button type="primary" onClick={createRule}>创建</Button>
                    </Form>
                  </div>
                </div>
              )}
              <div className="content-card">
                <div className="content-card-body flush">
                  <Table
                    rowKey="id" size="small" dataSource={rules} loading={false}
                    pagination={{ pageSize: 10, showTotal: (t) => `共 ${t} 个规则包` }}
                    locale={{ emptyText: "暂无规则包，先新建一个" }}
                    columns={[
                      { title: "名称", dataIndex: "name", ellipsis: true },
                      { title: "地区", dataIndex: "region", width: 100, render: (v: string) => v ?? "-" },
                      { title: "管理费率", dataIndex: "management_rate", width: 100, align: "right", render: (v: number) => <span className="num">{v ?? "-"}</span> },
                      { title: "利润率", dataIndex: "profit_rate", width: 90, align: "right", render: (v: number) => <span className="num">{v ?? "-"}</span> },
                      { title: "税率", dataIndex: "tax_rate", width: 90, align: "right", render: (v: number) => <span className="num">{v ?? "-"}</span> },
                      {
                        title: "操作", width: 130,
                        render: (_, row) => boundRuleId === row.id
                          ? <Tag color="green">当前绑定</Tag>
                          : <Button type="link" onClick={async () => { await api.bindRulePackage(projectId, row.id); setBoundRuleId(row.id); message.success(`规则包「${row.name}」已绑定`); }}>绑定</Button>,
                      },
                    ]}
                  />
                </div>
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
                    <Form form={measureForm} layout="inline" style={{ flexWrap: "wrap", gap: 8, rowGap: 12 }}>
                      <Form.Item name="name" rules={[{ required: true, message: "请输入名称" }]} style={{ marginBottom: 0 }}><Input placeholder="名称" style={{ width: 180 }} /></Form.Item>
                      <Form.Item name="calc_base" style={{ marginBottom: 0 }}><Select placeholder="计算基数" style={{ width: 130 }} options={[{ value: "direct", label: "直接费" }, { value: "pre_tax", label: "税前" }]} /></Form.Item>
                      <Form.Item name="rate" style={{ marginBottom: 0 }}><InputNumber placeholder="费率" style={{ width: 110 }} /></Form.Item>
                      <Form.Item name="amount" style={{ marginBottom: 0 }}><InputNumber placeholder="金额" style={{ width: 130 }} /></Form.Item>
                      <Button type="primary" onClick={createMeasure}>创建</Button>
                    </Form>
                  </div>
                </div>
              )}
              <div className="content-card">
                <div className="content-card-body flush">
                  <Table
                    rowKey="id" size="small" dataSource={measures}
                    pagination={{ pageSize: 10, showTotal: (t) => `共 ${t} 项` }}
                    locale={{ emptyText: "暂无措施项目" }}
                    columns={[
                      { title: "名称", dataIndex: "name", ellipsis: true },
                      {
                        title: "计算基数", dataIndex: "calc_base", width: 110,
                        render: (v: string) => (v === "direct" ? "直接费" : v === "pre_tax" ? "税前" : v ?? "-"),
                      },
                      { title: "费率", dataIndex: "rate", width: 100, align: "right", render: (v: number) => <span className="num">{v ?? "-"}</span> },
                      { title: "金额", dataIndex: "amount", width: 130, align: "right", render: (v: number) => <span className="num">{money(v)}</span> },
                      { title: "类型", dataIndex: "is_fixed", width: 90, render: (value: boolean) => <Tag>{value ? "固定" : "费率"}</Tag> },
                      { title: "操作", width: 70, render: (_, row) => <Popconfirm title="确认删除？" onConfirm={async () => { await api.deleteMeasure(projectId, row.id); await load(); }}><Button icon={<DeleteOutlined />} danger size="small" /></Popconfirm> },
                    ]}
                  />
                </div>
              </div>
            </div>
          ),
        },
      ]}
    />
  );
}

const TAB_KEYS = ["overview", "boq", "binding", "calc", "validation", "snapshot", "settings"];

export default function RestoredProjectWorkspace({ projectId, project }: Props) {
  const [searchParams, setSearchParams] = useSearchParams();
  const requested = searchParams.get("tab");
  const activeKey = TAB_KEYS.includes(requested ?? "") ? requested! : "overview";
  return (
    <Tabs
      className="ws-tabs"
      activeKey={activeKey}
      onChange={(key) => setSearchParams(key === "overview" ? {} : { tab: key })}
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
