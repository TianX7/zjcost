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
  Popconfirm,
  Row,
  Segmented,
  Select,
  Space,
  Tag,
  Tooltip,
  Typography,
  message,
} from "antd";
import { AppstoreOutlined, CopyOutlined, DeleteOutlined, FolderAddOutlined, PlusOutlined, ReloadOutlined, SearchOutlined, TableOutlined } from "@ant-design/icons";
import type { Project, ProjectCreateData, ProjectListParams } from "../api";
import { api } from "../api";
import { createDemoProject } from "../demoProject";

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
  const [page, setPage] = useState(1);
  const [pageSize] = useState(10);
  const [view, setView] = useState<"card" | "table">("card");
  const [modalOpen, setModalOpen] = useState(false);
  const [creatingDemo, setCreatingDemo] = useState(false);
  const [form] = Form.useForm<ProjectCreateData>();

  const summary = useMemo(() => {
    const active = items.filter((item) => item.status !== "archived").length;
    const completed = items.filter((item) => item.status === "completed").length;
    const budgetTotal = items.reduce((sum, item) => sum + Number(item.budget ?? 0), 0);
    const types = new Set(items.map((item) => item.project_type).filter(Boolean));
    return { active, completed, budgetTotal, types: types.size };
  }, [items]);

  const animTotal = useCountUp(total);
  const animActive = useCountUp(summary.active);
  const animBudget = useCountUp(Math.round(summary.budgetTotal));
  const animTypes = useCountUp(summary.types);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params: ProjectListParams = {
        q: query.trim() || undefined,
        status: status || undefined,
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
  }, [page, pageSize, query, status]);

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

  const startDemo = async () => {
    setCreatingDemo(true);
    try {
      const project = await createDemoProject();
      message.success("已创建演示项目");
      navigate(`/projects/${project.id}`);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "创建演示项目失败");
    } finally {
      setCreatingDemo(false);
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
          <Button icon={<FolderAddOutlined />} loading={creatingDemo} onClick={startDemo}>演示项目</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setModalOpen(true)}>新建项目</Button>
        </Space>
      </div>

      <div className="pl-kpi-strip">
        <div className="pl-kpi-item">
          <span className="pl-kpi-icon blue"><span className="material-symbols-outlined">folder_open</span></span>
          <div>
            <strong>{animTotal}</strong>
            <em>项目总数</em>
          </div>
          <span className="pl-kpi-sub">{animActive} 活跃</span>
        </div>
        <div className="pl-kpi-item">
          <span className="pl-kpi-icon green"><span className="material-symbols-outlined">check_circle</span></span>
          <div>
            <strong>{summary.completed}</strong>
            <em>已完工</em>
          </div>
          <span className="pl-kpi-sub">{total > 0 ? `${Math.round((summary.completed / total) * 100)}%` : "0%"}</span>
        </div>
        <div className="pl-kpi-item">
          <span className="pl-kpi-icon amber"><span className="material-symbols-outlined">request_quote</span></span>
          <div>
            <strong>{money(animBudget)}</strong>
            <em>预算合计</em>
          </div>
          <span className="pl-kpi-sub">{total} 项</span>
        </div>
        <div className="pl-kpi-item">
          <span className="pl-kpi-icon purple"><span className="material-symbols-outlined">category</span></span>
          <div>
            <strong>{animTypes}</strong>
            <em>工程类型</em>
          </div>
          <span className="pl-kpi-sub">分类</span>
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
            style={{ width: 240 }}
          />
          <Select value={status} options={STATUS_OPTIONS} onChange={(value) => { setStatus(value); setPage(1); }} style={{ width: 130 }} />
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
          <Empty description="项目已清空。可以新建项目，也可以用演示项目检查图纸、IFC、计价和审计流程。">
            <Space wrap>
              <Button type="primary" onClick={() => setModalOpen(true)}>新建项目</Button>
              <Button loading={creatingDemo} onClick={startDemo}>创建演示项目</Button>
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
                  <em>{project.project_type ?? "建筑工程"}</em>
                </div>
                <Tag color={STATUS_COLORS[project.status] ?? "default"}>{STATUS_LABELS[project.status] ?? project.status}</Tag>
              </div>
              <div className="pl-card-stats">
                <div>
                  <strong>{money(project.budget)}</strong>
                  <span>预算</span>
                </div>
                <div>
                  <strong>{project.owner ?? "-"}</strong>
                  <span>负责人</span>
                </div>
                <div>
                  <strong>{project.updated_at ? new Date(project.updated_at).toLocaleDateString("zh-CN") : "-"}</strong>
                  <span>更新</span>
                </div>
              </div>
              <div className="pl-card-foot">
                <span className="pl-card-desc">{project.description ?? "暂无说明"}</span>
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
        <div className="pl-table-wrap">
          <table className="pl-table">
            <thead>
              <tr>
                <th>项目名称</th>
                <th>类型</th>
                <th>状态</th>
                <th>预算</th>
                <th>负责人</th>
                <th>更新时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {items.map((project) => (
                <tr key={project.id}>
                  <td>
                    <button className="pl-table-link" type="button" onClick={() => navigate(`/projects/${project.id}`)}>
                      {project.name}
                    </button>
                  </td>
                  <td>{project.project_type ?? "-"}</td>
                  <td><Tag color={STATUS_COLORS[project.status] ?? "default"}>{STATUS_LABELS[project.status] ?? project.status}</Tag></td>
                  <td>{money(project.budget)}</td>
                  <td>{project.owner ?? "-"}</td>
                  <td>{project.updated_at ? new Date(project.updated_at).toLocaleDateString("zh-CN") : "-"}</td>
                  <td>
                    <Space>
                      <Button size="small" onClick={() => navigate(`/projects/${project.id}`)}>打开</Button>
                      <Button size="small" icon={<CopyOutlined />} onClick={async () => { await api.duplicateProject(project.id); await load(); }} />
                      <Popconfirm title="确认归档？" onConfirm={async () => { await api.archiveProject(project.id); await load(); }}>
                        <Button size="small">归档</Button>
                      </Popconfirm>
                      <Popconfirm title="确认删除？" onConfirm={async () => { await api.deleteProject(project.id); await load(); }}>
                        <Button size="small" danger icon={<DeleteOutlined />} />
                      </Popconfirm>
                    </Space>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {items.length > 0 && (
        <div className="pl-pagination">
          <span>共 {total} 个项目</span>
          <Space>
            <Button size="small" disabled={page <= 1} onClick={() => setPage(page - 1)}>上一页</Button>
            <span>第 {page} 页</span>
            <Button size="small" disabled={items.length < pageSize} onClick={() => setPage(page + 1)}>下一页</Button>
          </Space>
        </div>
      )}

      <Modal
        title="新建项目"
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={create}
        okText="创建"
        cancelText="取消"
        width={640}
      >
        <Form
          form={form}
          layout="vertical"
          initialValues={{ region: "全国", project_type: "建筑工程", status: "draft", standard_type: "GB50500" }}
          style={{ marginTop: 8 }}
        >
          <Row gutter={16}>
            <Col span={24}>
              <Form.Item name="name" label="项目名称" rules={[{ required: true, message: "请输入项目名称" }]}>
                <Input placeholder="请输入项目名称" size="large" />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="region" label="地区" rules={[{ required: true, message: "请选择地区" }]}>
                <Select
                  placeholder="请选择地区"
                  options={REGION_OPTIONS}
                  showSearch
                  optionFilterProp="label"
                  size="large"
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
                  size="large"
                  allowClear
                />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item name="owner" label="负责人">
                <Input placeholder="项目负责人" size="large" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="budget" label="预算（元）">
                <InputNumber
                  placeholder="项目预算"
                  min={0}
                  style={{ width: "100%" }}
                  size="large"
                  formatter={(value) => `${value ?? 0}`.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}
                  parser={(value) => value?.replace(/,/g, "") as unknown as 0}
                />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="standard_type" label="计价规范">
                <Select
                  placeholder="计价规范"
                  options={STANDARD_OPTIONS}
                  showSearch
                  optionFilterProp="label"
                  size="large"
                  allowClear
                />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={24}>
              <Form.Item name="description" label="项目说明">
                <Input.TextArea rows={3} placeholder="项目描述、备注信息..." style={{ resize: "none" }} />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>
    </div>
  );
}
