import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Button,
  Col,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Pagination,
  Popconfirm,
  Row,
  Segmented,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
  message,
} from "antd";
import { AppstoreOutlined, CopyOutlined, DeleteOutlined, FolderAddOutlined, PlusOutlined, ReloadOutlined, SearchOutlined, TableOutlined } from "@ant-design/icons";
import type { Project, ProjectCreateData, ProjectListParams } from "../api";
import { api } from "../api";
import { createSampleProject } from "../sampleProject";

const STATUS_OPTIONS = [
  { value: "", label: "全部状态" },
  { value: "draft", label: "立项中" },
  { value: "ongoing", label: "实施中" },
  { value: "completed", label: "已完成" },
  { value: "archived", label: "已归档" },
];

const REGION_OPTIONS = [
  { value: "全国", label: "全国" },
  { value: "北京", label: "北京" },
  { value: "上海", label: "上海" },
  { value: "广东", label: "广东" },
  { value: "江苏", label: "江苏" },
  { value: "浙江", label: "浙江" },
  { value: "山东", label: "山东" },
  { value: "四川", label: "四川" },
  { value: "河南", label: "河南" },
  { value: "湖北", label: "湖北" },
  { value: "湖南", label: "湖南" },
  { value: "福建", label: "福建" },
  { value: "安徽", label: "安徽" },
  { value: "陕西", label: "陕西" },
  { value: "重庆", label: "重庆" },
  { value: "天津", label: "天津" },
  { value: "新疆", label: "新疆" },
];

const PROJECT_TYPE_OPTIONS = [
  { value: "建筑工程", label: "建筑工程" },
  { value: "安装工程", label: "安装工程" },
  { value: "市政工程", label: "市政工程" },
  { value: "装饰工程", label: "装饰工程" },
  { value: "园林工程", label: "园林工程" },
  { value: "公路工程", label: "公路工程" },
  { value: "水利工程", label: "水利工程" },
  { value: "电力工程", label: "电力工程" },
];

const STANDARD_OPTIONS = [
  { value: "GB50500", label: "GB50500-2013 建设工程工程量清单计价规范" },
  { value: "GB50500-2018", label: "GB50500-2018 建设工程工程量清单计价规范" },
  { value: "其他", label: "其他" },
];

const STATUS_LABELS: Record<string, string> = {
  draft: "立项中",
  ongoing: "实施中",
  completed: "已完成",
  archived: "已归档",
};

const STATUS_COLORS: Record<string, string> = {
  draft: "default",
  ongoing: "blue",
  completed: "green",
  archived: "default",
};

function useCountUp(target: number, duration = 700) {
  const [val, setVal] = useState(0);
  const prev = useRef(0);
  useEffect(() => {
    if (target === prev.current) return;
    const start = prev.current;
    const diff = target - start;
    const t0 = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const p = Math.min((now - t0) / duration, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      setVal(Math.round(start + diff * eased));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    prev.current = target;
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return val;
}

function money(value: number | null | undefined) {
  if (value == null) return "-";
  if (value >= 10000) return `${(value / 10000).toFixed(1)} 万`;
  return value.toLocaleString("zh-CN", { style: "currency", currency: "CNY" });
}

export default function ProjectList() {
  const navigate = useNavigate();
  const [items, setItems] = useState<Project[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [projectType, setProjectType] = useState("");
  const [region, setRegion] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(12);
  const [view, setView] = useState<"card" | "table">("card");
  const [modalOpen, setModalOpen] = useState(false);
  const [creatingSample, setCreatingTour] = useState(false);
  const [form] = Form.useForm<ProjectCreateData>();

  // KPI 口径说明：总数来自服务端 total；其余为本页统计，避免把 10 条当全部
  const summary = useMemo(() => {
    const active = items.filter((item) => item.status !== "archived").length;
    const archived = items.filter((item) => item.status === "archived").length;
    const completed = items.filter((item) => item.status === "completed").length;
    const budgetTotal = items.reduce((sum, item) => sum + Number(item.budget ?? 0), 0);
    return { active, archived, completed, budgetTotal };
  }, [items]);

  const animTotal = useCountUp(total);
  const animActive = useCountUp(summary.active);
  const animBudget = useCountUp(Math.round(summary.budgetTotal));
  const animArchived = useCountUp(summary.archived);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params: ProjectListParams = {
        q: query.trim() || undefined,
        status: status || undefined,
        project_type: projectType || undefined,
        region: region || undefined,
        page,
        page_size: pageSize,
      };
      const data = await api.listProjects(params);
      setItems(data.items);
      setTotal(data.total);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "加载项目失败");
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, query, status, projectType, region]);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    const values = await form.validateFields();
    try {
      const project = await api.createProject(values);
      message.success("项目已创建");
      setModalOpen(false);
      form.resetFields();
      navigate(`/projects/${project.id}`);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "创建项目失败");
    }
  };

  const startSample = async () => {
    setCreatingTour(true);
    try {
      const project = await createSampleProject();
      message.success("已创建示例项目");
      navigate(`/projects/${project.id}`);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "创建示例项目失败");
    } finally {
      setCreatingTour(false);
    }
  };

  return (
    <div className="page-container pl-page">
      <div className="pl-header">
        <div>
          <Typography.Title level={3} style={{ marginBottom: 4 }}>项目台账</Typography.Title>
          <Typography.Text type="secondary">集中管理工程项目、计价规范、预算口径和全过程成果入口。</Typography.Text>
        </div>
        <Space wrap>
          <Button icon={<FolderAddOutlined />} loading={creatingSample} onClick={startSample}>示例项目</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setModalOpen(true)}>新建项目</Button>
        </Space>
      </div>

      <div className="pl-kpi-strip">
        <div className="pl-kpi-item">
          <span className="pl-kpi-icon blue"><span className="material-symbols-outlined">folder_open</span></span>
          <div>
            <strong className="num">{animTotal}</strong>
            <em>项目总数</em>
          </div>
          <span className="pl-kpi-sub">{animActive} 活跃</span>
        </div>
        <div className="pl-kpi-item">
          <span className="pl-kpi-icon green"><span className="material-symbols-outlined">check_circle</span></span>
          <div>
            <strong className="num">{summary.completed}</strong>
            <em>已完工（本页）</em>
          </div>
          <span className="pl-kpi-sub">本页 {items.length} 项</span>
        </div>
        <div className="pl-kpi-item">
          <span className="pl-kpi-icon amber"><span className="material-symbols-outlined">request_quote</span></span>
          <div>
            <strong className="num">{money(animBudget)}</strong>
            <em>预算合计（本页）</em>
          </div>
          <span className="pl-kpi-sub">仅统计当前页</span>
        </div>
        <div className="pl-kpi-item">
          <span className="pl-kpi-icon purple"><span className="material-symbols-outlined">archive</span></span>
          <div>
            <strong className="num">{animArchived}</strong>
            <em>已归档（本页）</em>
          </div>
          <span className="pl-kpi-sub">归档后只读</span>
        </div>
      </div>

      <div className="pl-toolbar">
        <Space wrap>
          <Input
            allowClear
            prefix={<SearchOutlined />}
            placeholder="搜索项目名称"
            value={query}
            onChange={(event) => { setQuery(event.target.value); setPage(1); }}
            style={{ width: 220 }}
          />
          <Select value={status} options={STATUS_OPTIONS} onChange={(value) => { setStatus(value); setPage(1); }} style={{ width: 130 }} placeholder="状态" />
          <Select
            value={projectType || undefined}
            options={[{ value: "", label: "全部类型" }, ...PROJECT_TYPE_OPTIONS]}
            onChange={(value) => { setProjectType(value); setPage(1); }}
            style={{ width: 140 }}
            placeholder="工程类型"
            allowClear
          />
          <Select
            value={region || undefined}
            options={[{ value: "", label: "全部地区" }, ...REGION_OPTIONS]}
            onChange={(value) => { setRegion(value ?? ""); setPage(1); }}
            style={{ width: 130 }}
            placeholder="地区"
            showSearch
            optionFilterProp="label"
            allowClear
          />
          <Button icon={<ReloadOutlined />} loading={loading} onClick={load}>刷新</Button>
        </Space>
        <Segmented
          value={view}
          onChange={(value) => setView(value as "card" | "table")}
          options={[
            { label: "卡片", value: "card", icon: <AppstoreOutlined /> },
            { label: "表格", value: "table", icon: <TableOutlined /> },
          ]}
        />
      </div>

      {items.length === 0 ? (
        <div className="pl-empty">
          <Empty description="项目已清空。可以新建项目，也可以用示例项目检查图纸、IFC、计价和审计流程。">
            <Space wrap>
              <Button type="primary" onClick={() => setModalOpen(true)}>新建项目</Button>
              <Button loading={creatingSample} onClick={startSample}>创建示例项目</Button>
            </Space>
          </Empty>
        </div>
      ) : view === "card" ? (
        <div className="pl-card-grid">
          {items.map((project) => (
            <button
              key={project.id}
              type="button"
              className={`pl-project-card${project.status === "archived" ? " archived" : ""}`}
              onClick={() => navigate(`/projects/${project.id}`)}
            >
              <div className="pl-card-head">
                <span className="pl-card-icon"><span className="material-symbols-outlined">apartment</span></span>
                <div className="pl-card-title">
                  <strong>{project.name}</strong>
                  <em>{[project.project_type ?? "建筑工程", project.region].filter(Boolean).join(" · ")}</em>
                </div>
                <Tag color={STATUS_COLORS[project.status] ?? "default"}>{STATUS_LABELS[project.status] ?? project.status}</Tag>
              </div>
              <div className="pl-card-stats">
                <div>
                  <strong className="num">{money(project.budget)}</strong>
                  <span>预算</span>
                </div>
                <div>
                  <strong>{project.owner ?? "-"}</strong>
                  <span>负责人</span>
                </div>
                <div>
                  <strong className="num">{project.updated_at ? new Date(project.updated_at).toLocaleDateString("zh-CN") : "-"}</strong>
                  <span>更新</span>
                </div>
              </div>
              <div className="pl-card-foot">
                <span className="pl-card-desc">{project.description?.trim() || "暂无说明，点击进入项目"}</span>
                <div className="pl-card-actions">
                  <Tooltip title="复制">
                    <span
                      className="pl-card-action"
                      onClick={(e) => { e.stopPropagation(); api.duplicateProject(project.id).then(() => load()).catch((err) => message.error(err instanceof Error ? err.message : "复制失败")); }}
                    >
                      <CopyOutlined />
                    </span>
                  </Tooltip>
                  <Tooltip title="归档">
                    <Popconfirm title="确认归档？" onConfirm={(e) => { e?.stopPropagation(); api.archiveProject(project.id).then(() => load()).catch((err) => message.error(err instanceof Error ? err.message : "归档失败")); }}>
                      <span className="pl-card-action" onClick={(e) => e.stopPropagation()}>
                        <span className="material-symbols-outlined">archive</span>
                      </span>
                    </Popconfirm>
                  </Tooltip>
                  <Tooltip title="删除">
                    <Popconfirm title="确认删除？" onConfirm={(e) => { e?.stopPropagation(); api.deleteProject(project.id).then(() => load()).catch((err) => message.error(err instanceof Error ? err.message : "删除失败")); }}>
                      <span className="pl-card-action danger" onClick={(e) => e.stopPropagation()}>
                        <DeleteOutlined />
                      </span>
                    </Popconfirm>
                  </Tooltip>
                </div>
              </div>
            </button>
          ))}
        </div>
      ) : (
        <Table
          rowKey="id"
          loading={loading}
          dataSource={items}
          pagination={false}
          onRow={(project) => ({ onClick: () => navigate(`/projects/${project.id}`) })}
          columns={[
            {
              title: "项目名称", dataIndex: "name", key: "name", ellipsis: true,
              render: (value: string, project: Project) => (
                <Button type="link" style={{ padding: 0, height: "auto" }} onClick={(e) => { e.stopPropagation(); navigate(`/projects/${project.id}`); }}>
                  {value}
                </Button>
              ),
            },
            { title: "类型", dataIndex: "project_type", key: "project_type", width: 110, render: (v: string) => v ?? "-" },
            { title: "地区", dataIndex: "region", key: "region", width: 90, render: (v: string) => v ?? "-" },
            {
              title: "状态", dataIndex: "status", key: "status", width: 100,
              render: (v: string) => <Tag color={STATUS_COLORS[v] ?? "default"}>{STATUS_LABELS[v] ?? v}</Tag>,
            },
            {
              title: "预算", dataIndex: "budget", key: "budget", width: 130, align: "right",
              render: (v: number) => <span className="num">{money(v)}</span>, sorter: (a: Project, b: Project) => Number(a.budget ?? 0) - Number(b.budget ?? 0),
            },
            { title: "负责人", dataIndex: "owner", key: "owner", width: 100, render: (v: string) => v ?? "-" },
            {
              title: "更新时间", dataIndex: "updated_at", key: "updated_at", width: 120,
              render: (v: string) => (v ? new Date(v).toLocaleDateString("zh-CN") : "-"),
              sorter: (a: Project, b: Project) => String(a.updated_at ?? "").localeCompare(String(b.updated_at ?? "")),
            },
            {
              title: "操作", key: "actions", width: 200, fixed: "right",
              render: (_: unknown, project: Project) => (
                <Space onClick={(e) => e.stopPropagation()}>
                  <Button size="small" onClick={() => navigate(`/projects/${project.id}`)}>打开</Button>
                  <Button size="small" icon={<CopyOutlined />} onClick={async () => { await api.duplicateProject(project.id); await load(); }} />
                  <Popconfirm title="确认归档？归档后只读。" onConfirm={async () => { await api.archiveProject(project.id); await load(); }}>
                    <Button size="small">归档</Button>
                  </Popconfirm>
                  <Popconfirm title="确认删除？该操作不可恢复。" onConfirm={async () => { await api.deleteProject(project.id); await load(); }}>
                    <Button size="small" danger icon={<DeleteOutlined />} />
                  </Popconfirm>
                </Space>
              ),
            },
          ]}
        />
      )}

      {total > 0 && (
        <div className="pl-pagination">
          <span>共 {total} 个项目</span>
          <Pagination
            size="small"
            current={page}
            pageSize={pageSize}
            total={total}
            showSizeChanger
            pageSizeOptions={[12, 20, 50]}
            showTotal={(t) => `共 ${t} 项`}
            onChange={(p, ps) => { setPage(p); setPageSize(ps); }}
          />
        </div>
      )}

      <Modal
        title="新建项目"
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={create}
        okText="创建"
        cancelText="取消"
        width={600}
        destroyOnClose
      >
        <Form
          form={form}
          layout="vertical"
          initialValues={{ region: "全国", project_type: "建筑工程", status: "draft", standard_type: "GB50500" }}
          style={{ marginTop: 8 }}
          preserve={false}
        >
          <Form.Item name="name" label="项目名称" rules={[{ required: true, message: "请输入项目名称" }]}>
            <Input placeholder="如：XX 市政道路改造工程" maxLength={60} showCount />
          </Form.Item>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="region" label="地区" rules={[{ required: true, message: "请选择地区" }]}>
                <Select
                  placeholder="请选择地区"
                  options={REGION_OPTIONS}
                  showSearch
                  optionFilterProp="label"
                  allowClear
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="project_type" label="项目类型">
                <Select
                  placeholder="请选择项目类型"
                  options={PROJECT_TYPE_OPTIONS}
                  showSearch
                  optionFilterProp="label"
                  allowClear
                />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="owner" label="负责人">
                <Input placeholder="项目负责人" maxLength={20} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="budget" label="预算（元）">
                <InputNumber<number>
                  placeholder="项目预算"
                  min={0}
                  style={{ width: "100%" }}
                  formatter={(value) => `${value ?? ""}`.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}
                  parser={(value) => Number((value ?? "").replace(/,/g, ""))}
                />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="standard_type" label="计价规范">
                <Select
                  placeholder="计价规范"
                  options={STANDARD_OPTIONS}
                  showSearch
                  optionFilterProp="label"
                  allowClear
                />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="status" label="初始状态">
                <Select options={STATUS_OPTIONS.filter((o) => o.value)} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="description" label="项目说明">
            <Input.TextArea rows={3} placeholder="项目描述、备注信息..." maxLength={300} showCount style={{ resize: "none" }} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
