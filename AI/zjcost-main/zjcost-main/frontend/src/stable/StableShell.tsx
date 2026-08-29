import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Alert,
  App,
  Button,
  Card,
  Col,
  Descriptions,
  Divider,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Progress,
  Row,
  Select,
  Space,
  Spin,
  Statistic,
  Table,
  Tabs,
  Tag,
  Typography,
  Upload,
  type UploadProps,
} from "antd";
const { Text } = Typography;
import {
  CloudUploadOutlined,
  DownloadOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  ReloadOutlined,
  SaveOutlined,
} from "@ant-design/icons";
import { useNavigate, useParams } from "react-router-dom";
import type {
  AutoValuateMatchDetail,
  BoqItem,
  CalcSummary,
  DashboardSummary,
  IfcElement,
  MaterialPrice,
  Project,
  ProjectCreateData,
  QuotaItemDTO,
  ReportDivision,
  ReportLineItem,
  TaskStatusOut,
  ValidationIssue,
} from "../api";
import { api } from "../api";
import { money, num, pct, text } from "./format";

type LoadState<T> = {
  data: T | null;
  loading: boolean;
  error: string | null;
};

type DrawingComponentRow = {
  id: string;
  type: string;
  spec: string;
  unit: string;
  quantity_estimate: number;
  confidence: number;
};

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

function useAsyncData<T>(loader: () => Promise<T>, deps: unknown[]) {
  const [state, setState] = useState<LoadState<T>>({ data: null, loading: true, error: null });

  const refresh = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const data = await loader();
      setState({ data, loading: false, error: null });
    } catch (err) {
      setState({ data: null, loading: false, error: err instanceof Error ? err.message : "加载失败" });
    }
  // `deps` is intentionally supplied by each useAsyncData call site.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { ...state, refresh };
}

function Page({ title, subtitle, extra, children }: {
  title: string;
  subtitle?: string;
  extra?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <Typography.Title level={2} style={{ margin: 0 }}>{title}</Typography.Title>
          {subtitle && <Typography.Text type="secondary">{subtitle}</Typography.Text>}
        </div>
        {extra}
      </div>
      {children}
    </div>
  );
}

function ErrorOrSpin({ loading, error, onRetry }: { loading: boolean; error: string | null; onRetry: () => void }) {
  if (loading) return <Card><Spin /> 正在加载...</Card>;
  if (!error) return null;
  return (
    <Alert
      type="error"
      showIcon
      title="加载失败"
      description={error}
      action={<Button onClick={onRetry}>重试</Button>}
      style={{ marginBottom: 16 }}
    />
  );
}

function ProjectPicker({ value, onChange }: { value?: number; onChange: (id: number) => void }) {
  const { data } = useAsyncData(() => api.listProjects({ page_size: 100 }), []);
  return (
    <Select
      value={value}
      onChange={onChange}
      placeholder="选择项目"
      style={{ minWidth: 260 }}
      options={(data?.items ?? []).map((project) => ({ label: project.name, value: project.id }))}
    />
  );
}

export function StableDashboard() {
  const navigate = useNavigate();
  const projects = useAsyncData(() => api.listProjects({ page_size: 8, sort_by: "updated_at", sort_order: "desc" }), []);
  const [activeProjectId, setActiveProjectId] = useState<number | undefined>();
  const summary = useAsyncData(
    async () => (activeProjectId ? api.getDashboardSummary(activeProjectId) : Promise.resolve(null as DashboardSummary | null)),
    [activeProjectId],
  );

  useEffect(() => {
    if (!activeProjectId && projects.data?.items?.[0]) setActiveProjectId(projects.data.items[0].id);
  }, [activeProjectId, projects.data]);

  return (
    <Page
      title="仪表盘"
      subtitle="查看项目、清单、计价和校验状态"
      extra={<Button icon={<ReloadOutlined />} onClick={() => { void projects.refresh(); void summary.refresh(); }}>刷新</Button>}
    >
      <ErrorOrSpin loading={projects.loading} error={projects.error} onRetry={projects.refresh} />
      <Row gutter={[16, 16]}>
        <Col xs={24} md={12} xl={6}><Card><Statistic title="项目数" value={projects.data?.total ?? 0} /></Card></Col>
        <Col xs={24} md={12} xl={6}><Card><Statistic title="清单项" value={summary.data?.boq_count ?? 0} /></Card></Col>
        <Col xs={24} md={12} xl={6}><Card><Statistic title="未绑定" value={summary.data?.unbound_count ?? 0} /></Card></Col>
        <Col xs={24} md={12} xl={6}><Card><Statistic title="总造价" prefix="¥" value={summary.data?.calc_total ?? 0} precision={2} /></Card></Col>
      </Row>
      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} lg={14}>
          <Card title="最近项目" extra={<Button type="link" onClick={() => navigate("/projects")}>全部项目</Button>}>
            <Table<Project>
              rowKey="id"
              dataSource={projects.data?.items ?? []}
              pagination={false}
              size="small"
              columns={[
                { title: "项目名称", dataIndex: "name", render: (name, row) => <Button type="link" onClick={() => navigate(`/projects/${row.id}`)}>{name}</Button> },
                { title: "地区", dataIndex: "region", width: 100 },
                { title: "状态", dataIndex: "status", width: 100, render: (v) => <Tag>{v}</Tag> },
                { title: "预算", dataIndex: "budget", width: 120, render: (v) => money(v) },
              ]}
            />
          </Card>
        </Col>
        <Col xs={24} lg={10}>
          <Card title="项目概览" extra={<ProjectPicker value={activeProjectId} onChange={setActiveProjectId} />}>
            <ErrorOrSpin loading={summary.loading && Boolean(activeProjectId)} error={summary.error} onRetry={summary.refresh} />
            {summary.data ? (
              <Space orientation="vertical" style={{ width: "100%" }}>
                <Progress percent={Number(summary.data.binding_rate?.replace("%", "")) || 0} />
                <Descriptions size="small" column={1}>
                  <Descriptions.Item label="校验问题">{summary.data.validation_total}</Descriptions.Item>
                  <Descriptions.Item label="错误/警告">{summary.data.validation_errors} / {summary.data.validation_warnings}</Descriptions.Item>
                  <Descriptions.Item label="最近审计">{summary.data.recent_audit_count}</Descriptions.Item>
                </Descriptions>
              </Space>
            ) : <Empty description="请选择项目" />}
          </Card>
        </Col>
      </Row>
    </Page>
  );
}

export function StableProjectList() {
  const { message } = App.useApp();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm<ProjectCreateData>();
  const projects = useAsyncData(() => api.listProjects({ page_size: 100 }), []);

  const createProject = async () => {
    const values = await form.validateFields();
    await api.createProject(values);
    message.success("项目已创建");
    setOpen(false);
    form.resetFields();
    await projects.refresh();
  };

  return (
    <Page
      title="项目管理"
      subtitle="创建、查看和进入项目工作台"
      extra={<Space><Button icon={<ReloadOutlined />} onClick={projects.refresh}>刷新</Button><Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>新建项目</Button></Space>}
    >
      <ErrorOrSpin loading={projects.loading} error={projects.error} onRetry={projects.refresh} />
      <Card>
        <Table<Project>
          rowKey="id"
          dataSource={projects.data?.items ?? []}
          columns={[
            { title: "名称", dataIndex: "name", render: (name, row) => <Button type="link" onClick={() => navigate(`/projects/${row.id}`)}>{name}</Button> },
            { title: "地区", dataIndex: "region" },
            { title: "类型", dataIndex: "project_type" },
            { title: "状态", dataIndex: "status", render: (v) => <Tag>{v}</Tag> },
            { title: "预算", dataIndex: "budget", render: (v) => money(v) },
            { title: "负责人", dataIndex: "owner", render: (v) => text(v) },
            { title: "操作", width: 140, render: (_, row) => <Button onClick={() => navigate(`/projects/${row.id}`)}>打开</Button> },
          ]}
        />
      </Card>
      <Modal
        title="新建项目"
        open={open}
        onCancel={() => setOpen(false)}
        onOk={createProject}
        okText="创建"
        cancelText="取消"
        width={640}
      >
        <Form
          form={form}
          layout="vertical"
          initialValues={{ region: "全国", project_type: "建筑工程", standard_type: "GB50500" }}
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
    </Page>
  );
}

export function StableProjectDetail() {
  const { message } = App.useApp();
  const params = useParams();
  const projectId = Number(params.id);
  const project = useAsyncData(() => api.getProject(projectId), [projectId]);
  const boq = useAsyncData(() => api.listBoqItems(projectId), [projectId]);
  const calc = useAsyncData(() => api.getCalcSummary(projectId), [projectId]);
  const validation = useAsyncData(() => api.validate(projectId), [projectId]);

  const uploadProps: UploadProps = {
    accept: ".xlsx,.xls,.csv",
    showUploadList: false,
    customRequest: async ({ file, onSuccess, onError }) => {
      try {
        const result = await api.importBoq(projectId, file as File);
        message.success(`导入完成：${result.imported ?? result.items?.length ?? 0} 条`);
        onSuccess?.(result);
        await boq.refresh();
      } catch (err) {
        onError?.(err as Error);
        message.error(err instanceof Error ? err.message : "导入失败");
      }
    },
  };

  const calculate = async () => {
    await api.calculate(projectId);
    message.success("计算完成");
    await calc.refresh();
  };

  return (
    <Page title={project.data?.name ?? "项目工作台"} subtitle={`项目 ID：${projectId}`} extra={<Button icon={<ReloadOutlined />} onClick={() => { void project.refresh(); void boq.refresh(); void calc.refresh(); void validation.refresh(); }}>刷新</Button>}>
      <ErrorOrSpin loading={project.loading} error={project.error} onRetry={project.refresh} />
      <Tabs
        items={[
          {
            key: "overview",
            label: "概览",
            children: (
              <Row gutter={[16, 16]}>
                <Col xs={24} lg={10}>
                  <Card title="项目资料">
                    {project.data && (
                      <Descriptions column={1} size="small">
                        <Descriptions.Item label="地区">{project.data.region}</Descriptions.Item>
                        <Descriptions.Item label="类型">{project.data.project_type}</Descriptions.Item>
                        <Descriptions.Item label="状态">{project.data.status}</Descriptions.Item>
                        <Descriptions.Item label="预算">{money(project.data.budget)}</Descriptions.Item>
                        <Descriptions.Item label="负责人">{text(project.data.owner)}</Descriptions.Item>
                      </Descriptions>
                    )}
                  </Card>
                </Col>
                <Col xs={24} lg={14}>
                  <Card title="造价摘要" extra={<Button type="primary" icon={<PlayCircleOutlined />} onClick={calculate}>重新计算</Button>}>
                    <Row gutter={16}>
                      <Col span={8}><Statistic title="直接费" prefix="¥" value={calc.data?.total_direct ?? 0} precision={2} /></Col>
                      <Col span={8}><Statistic title="税金" prefix="¥" value={calc.data?.total_tax ?? 0} precision={2} /></Col>
                      <Col span={8}><Statistic title="总价" prefix="¥" value={calc.data?.grand_total ?? 0} precision={2} /></Col>
                    </Row>
                  </Card>
                </Col>
              </Row>
            ),
          },
          {
            key: "boq",
            label: "清单",
            children: (
              <Card title="清单项" extra={<Upload {...uploadProps}><Button icon={<CloudUploadOutlined />}>导入清单</Button></Upload>}>
                <Table<BoqItem>
                  rowKey="id"
                  dataSource={boq.data ?? []}
                  loading={boq.loading}
                  size="small"
                  columns={[
                    { title: "编码", dataIndex: "code", width: 120 },
                    { title: "名称", dataIndex: "name" },
                    { title: "特征", dataIndex: "characteristics", ellipsis: true },
                    { title: "单位", dataIndex: "unit", width: 80 },
                    { title: "工程量", dataIndex: "quantity", width: 110, render: (v) => num(v) },
                    { title: "综合单价", dataIndex: "rate", width: 120, render: (v) => money(v) },
                    { title: "合价", dataIndex: "amount", width: 120, render: (v) => money(v) },
                  ]}
                />
              </Card>
            ),
          },
          {
            key: "validation",
            label: "校验",
            children: (
              <Card title="校验问题" extra={<Button onClick={validation.refresh}>重新校验</Button>}>
                <Table<ValidationIssue>
                  rowKey={(row, index) => `${row.code}-${index}`}
                  dataSource={validation.data?.issues ?? []}
                  loading={validation.loading}
                  columns={[
                    { title: "级别", dataIndex: "severity", width: 100, render: (v) => <Tag color={v === "error" ? "red" : "orange"}>{v}</Tag> },
                    { title: "编码", dataIndex: "code", width: 120 },
                    { title: "问题", dataIndex: "message" },
                    { title: "建议", dataIndex: "suggestion" },
                  ]}
                />
              </Card>
            ),
          },
        ]}
      />
    </Page>
  );
}

export function StablePricing() {
  const { message } = App.useApp();
  const [projectId, setProjectId] = useState<number | undefined>();
  const calc = useAsyncData(async () => (projectId ? api.getCalcSummary(projectId) : Promise.resolve(null as CalcSummary | null)), [projectId]);
  const autoValuate = useAsyncData(async () => (projectId ? api.autoValuate(projectId) : Promise.resolve(null)), [projectId]);

  const runCalc = async () => {
    if (!projectId) return;
    await api.calculate(projectId);
    message.success("计算完成");
    await calc.refresh();
  };

  const runAuto = async () => {
    if (!projectId) return;
    const result = await api.autoValuate(projectId);
    message.success(`自动匹配完成：新增 ${result.newly_matched} 项`);
    await autoValuate.refresh();
    await calc.refresh();
  };

  return (
    <Page title="过程计价" subtitle="定额匹配、计算汇总和结果复核" extra={<ProjectPicker value={projectId} onChange={setProjectId} />}>
      <Card>
        <Space>
          <Button type="primary" icon={<PlayCircleOutlined />} disabled={!projectId} onClick={runAuto}>自动匹配定额</Button>
          <Button icon={<PlayCircleOutlined />} disabled={!projectId} onClick={runCalc}>计算造价</Button>
          <Button icon={<ReloadOutlined />} disabled={!projectId} onClick={() => { void calc.refresh(); void autoValuate.refresh(); }}>刷新</Button>
        </Space>
      </Card>
      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} lg={8}><Card><Statistic title="直接费" prefix="¥" value={calc.data?.total_direct ?? 0} precision={2} /></Card></Col>
        <Col xs={24} lg={8}><Card><Statistic title="税金" prefix="¥" value={calc.data?.total_tax ?? 0} precision={2} /></Card></Col>
        <Col xs={24} lg={8}><Card><Statistic title="总造价" prefix="¥" value={calc.data?.grand_total ?? 0} precision={2} /></Card></Col>
      </Row>
      <Card title="匹配明细" style={{ marginTop: 16 }}>
        <Table<AutoValuateMatchDetail>
          rowKey={(row) => row.boq_item_id}
          dataSource={autoValuate.data?.match_details ?? []}
          loading={autoValuate.loading && Boolean(projectId)}
          columns={[
            { title: "清单", dataIndex: "boq_name" },
            { title: "定额编码", dataIndex: "quota_code", width: 120 },
            { title: "定额名称", dataIndex: "quota_name" },
            { title: "置信度", dataIndex: "confidence", width: 100, render: pct },
            { title: "状态", dataIndex: "status", width: 110, render: (v) => <Tag>{v}</Tag> },
          ]}
        />
      </Card>
    </Page>
  );
}

export function StablePriceManagement() {
  const { message } = App.useApp();
  const [keyword, setKeyword] = useState("");
  const [region, setRegion] = useState("默认区域");
  const prices = useAsyncData(() => api.listMaterialPrices({ name: keyword || undefined, region: region || undefined, latest_only: true }), [keyword, region]);
  const sources = useAsyncData(() => api.listPriceSources(), []);

  const fetchPrices = async () => {
    const result = await api.fetchPrices({ query: keyword || undefined, region });
    message.success(`抓取完成：${result.total_fetched} 条`);
    await prices.refresh();
  };

  return (
    <Page title="材料价格" subtitle="查询材料价格并触发价格源抓取" extra={<Button icon={<ReloadOutlined />} onClick={prices.refresh}>刷新</Button>}>
      <Card>
        <Space wrap>
          <Input.Search placeholder="材料名称" value={keyword} onChange={(e) => setKeyword(e.target.value)} onSearch={prices.refresh} style={{ width: 260 }} />
          <Input placeholder="地区" value={region} onChange={(e) => setRegion(e.target.value)} style={{ width: 120 }} />
          <Button type="primary" onClick={fetchPrices}>抓取价格</Button>
        </Space>
      </Card>
      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} lg={16}>
          <Card title="价格库">
            <Table<MaterialPrice>
              rowKey="id"
              dataSource={prices.data ?? []}
              loading={prices.loading}
              columns={[
                { title: "编码", dataIndex: "code", width: 120 },
                { title: "名称", dataIndex: "name" },
                { title: "规格", dataIndex: "spec" },
                { title: "单位", dataIndex: "unit", width: 80 },
                { title: "单价", dataIndex: "unit_price", width: 120, render: (v) => money(v) },
                { title: "来源", dataIndex: "source", width: 130 },
                { title: "日期", dataIndex: "effective_date", width: 120 },
              ]}
            />
          </Card>
        </Col>
        <Col xs={24} lg={8}>
          <Card title="价格源">
            <Table
              rowKey="source_name"
              pagination={false}
              size="small"
              dataSource={sources.data ?? []}
              columns={[
                { title: "名称", dataIndex: "display_name" },
                { title: "状态", dataIndex: "available", width: 90, render: (v) => <Tag color={v ? "green" : "red"}>{v ? "可用" : "不可用"}</Tag> },
              ]}
            />
          </Card>
        </Col>
      </Row>
    </Page>
  );
}

export function StableQuotaLibrary() {
  const [keyword, setKeyword] = useState("");
  const quotas = useAsyncData(() => api.listQuotaItems({ keyword: keyword || undefined, limit: 100 }), [keyword]);
  const stats = useAsyncData(() => api.getQuotaStats(), []);

  return (
    <Page title="定额库" subtitle="检索定额条目和章节统计" extra={<Input.Search placeholder="搜索定额" value={keyword} onChange={(e) => setKeyword(e.target.value)} onSearch={quotas.refresh} style={{ width: 280 }} />}>
      <Row gutter={[16, 16]}>
        <Col xs={24} md={8}><Card><Statistic title="定额总数" value={stats.data?.total ?? 0} /></Card></Col>
        <Col xs={24} md={8}><Card><Statistic title="专业数" value={stats.data?.disciplines?.length ?? 0} /></Card></Col>
        <Col xs={24} md={8}><Card><Statistic title="章节数" value={stats.data?.chapters?.length ?? 0} /></Card></Col>
      </Row>
      <Card title="定额条目" style={{ marginTop: 16 }}>
        <Table<QuotaItemDTO>
          rowKey="id"
          dataSource={quotas.data?.items ?? []}
          loading={quotas.loading}
          columns={[
            { title: "编码", dataIndex: "quota_code", width: 130 },
            { title: "名称", dataIndex: "name" },
            { title: "单位", dataIndex: "unit", width: 80 },
            { title: "专业", dataIndex: "discipline", width: 120 },
            { title: "章节", dataIndex: "chapter", width: 180 },
          ]}
        />
      </Card>
    </Page>
  );
}

export function StableDrawingRecognition() {
  const navigate = useNavigate();
  const { message } = App.useApp();
  const [taskId, setTaskId] = useState<string>("");
  const [data, setData] = useState<Awaited<ReturnType<typeof api.getDrawingResult>> | null>(null);
  const [polling, setPolling] = useState(false);

  useEffect(() => {
    if (!taskId || !polling) return;
    const timer = setInterval(async () => {
      try {
        const res = await api.getDrawingResult(taskId);
        setData(res);
        const recognitionDone = res.status === "done" || res.status === "error";
        const valuationDone = res.valuation_status === "done" || res.valuation_status === "error" || res.valuation_status === "skipped";
        if (recognitionDone && valuationDone) {
          setPolling(false);
          if (res.status === "done") {
            const projectId = res.valuation?.project_id;
            const created = res.valuation?.boq_items_created ?? res.boq_suggestions?.length ?? 0;
            const matched = res.valuation?.matched ?? 0;
            if (projectId) {
              message.success(`图纸识别完成，已自动创建项目并匹配定额：清单 ${created} 条，已匹配定额 ${matched} 条`);
            } else if (res.valuation_error) {
              message.warning(`图纸识别完成，但自动计价未成功：${res.valuation_error}`);
            } else {
              message.success("图纸识别完成，可查看构件和清单建议");
            }
          } else {
            message.error(res.error || res.valuation_error || "图纸解析失败");
          }
        }
      } catch (err) {
        setPolling(false);
        message.error(err instanceof Error ? err.message : "查询失败");
      }
    }, 1200);
    return () => clearInterval(timer);
  }, [taskId, polling, message]);

  const uploadProps: UploadProps = {
    accept: ".dwg,.dxf,.pdf,.png,.jpg,.jpeg",
    showUploadList: false,
    customRequest: async ({ file, onSuccess, onError }) => {
      try {
        const res = await api.uploadDrawing(file as File);
        setTaskId(res.taskId);
        setData(null);
        setPolling(true);
        message.success("图纸已上传，正在解析并生成计价项目");
        onSuccess?.(res);
      } catch (err) {
        onError?.(err as Error);
        message.error(err instanceof Error ? err.message : "上传失败");
      }
    },
  };

  const handleRefresh = async () => {
    if (!taskId) return;
    try {
      const res = await api.getDrawingResult(taskId);
      setData(res);
      const recognitionDone = res.status === "done" || res.status === "error";
      const valuationDone = res.valuation_status === "done" || res.valuation_status === "error" || res.valuation_status === "skipped";
      if (!recognitionDone || !valuationDone) {
        setPolling(true);
      }
    } catch (err) {
      message.error(err instanceof Error ? err.message : "刷新失败");
    }
  };

  const componentSummary = (() => {
    const components = data?.components ?? [];
    if (!components.length) return [];
    const summary: Record<string, { type: string; count: number; quantity: number; unit: string }> = {};
    for (const c of components) {
      if (!summary[c.type]) {
        summary[c.type] = { type: c.type, count: 0, quantity: 0, unit: c.unit };
      }
      summary[c.type].count += c.count;
      summary[c.type].quantity += c.quantity_estimate || 0;
    }
    return Object.values(summary).sort((a, b) => b.count - a.count);
  })();

  return (
    <Page
      title="图纸识别"
      subtitle="上传 CAD/PDF/图片，自动识别构件、生成清单并匹配定额"
      extra={
        <Space>
          {data?.valuation?.project_id && (
            <Button type="primary" onClick={() => navigate(`/projects/${data.valuation.project_id}`)}>
              进入项目
            </Button>
          )}
          <Upload {...uploadProps}>
            <Button type="primary" icon={<CloudUploadOutlined />}>上传图纸</Button>
          </Upload>
        </Space>
      }
    >
      <Card>
        <Space wrap>
          <Input.Search
            placeholder="输入任务 ID 查询"
            value={taskId}
            onChange={(e) => setTaskId(e.target.value)}
            onSearch={handleRefresh}
            style={{ width: 360 }}
          />
          <Button icon={<ReloadOutlined />} disabled={!taskId} onClick={handleRefresh}>刷新任务</Button>
          <Button
            icon={<DownloadOutlined />}
            disabled={!taskId || data?.status !== "done"}
            onClick={async () => {
              const blob = await api.exportDrawingResult(taskId);
              window.open(URL.createObjectURL(blob));
            }}
          >
            导出结果
          </Button>
        </Space>
        {data?.summary && (
          <Alert
            message={data.summary}
            type={data.status === "error" ? "error" : "info"}
            style={{ marginTop: 16 }}
            showIcon
          />
        )}
      </Card>

      {data && (
        <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
          <Col xs={24} md={6}>
            <Card>
              <Statistic
                title="识别状态"
                value={data.status === "done" ? "已完成" : data.status === "error" ? "失败" : "识别中"}
                valueStyle={{ color: data.status === "done" ? "#3f8600" : data.status === "error" ? "#cf1322" : "#1890ff" }}
              />
            </Card>
          </Col>
          <Col xs={24} md={6}>
            <Card>
              <Statistic title="构件数" value={data.components?.length ?? 0} />
            </Card>
          </Col>
          <Col xs={24} md={6}>
            <Card>
              <Statistic title="清单建议" value={data.boq_suggestions?.length ?? 0} />
            </Card>
          </Col>
          <Col xs={24} md={6}>
            <Card>
              <Statistic
                title="计价状态"
                value={
                  data.valuation_status === "done" ? "已完成" :
                  data.valuation_status === "processing" ? "计价中" :
                  data.valuation_status === "error" ? "失败" :
                  data.valuation_status === "skipped" ? "跳过" : "等待中"
                }
                valueStyle={{
                  color: data.valuation_status === "done" ? "#3f8600" :
                         data.valuation_status === "error" ? "#cf1322" : "#1890ff"
                }}
              />
            </Card>
          </Col>

          {componentSummary.length > 0 && (
            <Col span={24}>
              <Card title="构件汇总">
                <Space wrap size={[8, 8]}>
                  {componentSummary.map((item) => (
                    <Tag key={item.type} color="blue" style={{ padding: "4px 12px", fontSize: 13 }}>
                      {item.type}: {item.count}个 / {num(item.quantity)}{item.unit}
                    </Tag>
                  ))}
                </Space>
              </Card>
            </Col>
          )}

          {data.valuation_status === "processing" && (
            <Col span={24}>
              <Card>
                <Progress
                  percent={data.valuation_progress_percent ?? 0}
                  status="active"
                  format={() => data.valuation_progress || "正在处理..."}
                />
              </Card>
            </Col>
          )}

          <Col span={24}>
            <Card title="识别构件">
              <Table<DrawingComponentRow>
                rowKey="id"
                dataSource={data.components ?? []}
                pagination={{ pageSize: 10 }}
                columns={[
                  { title: "构件编号", dataIndex: "id", width: 100 },
                  { title: "类型", dataIndex: "type", width: 120 },
                  { title: "规格", dataIndex: "spec" },
                  { title: "数量", dataIndex: "count", width: 80 },
                  { title: "工程量", dataIndex: "quantity_estimate", width: 100, render: (v) => num(v) },
                  { title: "单位", dataIndex: "unit", width: 80 },
                  { title: "材料", dataIndex: "material", width: 120 },
                  { title: "置信度", dataIndex: "confidence", width: 100, render: (v) => pct(v) },
                ]}
              />
            </Card>
          </Col>

          {data.boq_suggestions?.length > 0 && (
            <Col span={24}>
              <Card title="清单建议">
                <Table
                  rowKey="source_component_id"
                  dataSource={data.boq_suggestions ?? []}
                  pagination={{ pageSize: 10 }}
                  columns={[
                    { title: "清单编码", dataIndex: "suggested_code", width: 140 },
                    { title: "清单名称", dataIndex: "suggested_name" },
                    { title: "单位", dataIndex: "suggested_unit", width: 80 },
                    { title: "工程量", dataIndex: "suggested_quantity", width: 100, render: (v) => num(v) },
                    { title: "项目特征", dataIndex: "characteristics" },
                    { title: "置信度", dataIndex: "confidence", width: 100, render: (v) => pct(v) },
                  ]}
                />
              </Card>
            </Col>
          )}

          {data.valuation?.items?.length > 0 && (
            <Col span={24}>
              <Card
                title="计价结果"
                extra={
                  <Space>
                    <Text strong>总造价: </Text>
                    <Text type="danger" strong style={{ fontSize: 18 }}>
                      {money(data.valuation.grand_total)}
                    </Text>
                  </Space>
                }
              >
                {data.valuation.error && (
                  <Alert message={data.valuation.error} type="warning" showIcon style={{ marginBottom: 16 }} />
                )}
                <Descriptions bordered size="small" column={4} style={{ marginBottom: 16 }}>
                  <Descriptions.Item label="项目名称">{data.valuation.project_name || "-"}</Descriptions.Item>
                  <Descriptions.Item label="清单条数">{data.valuation.boq_items_created ?? 0}</Descriptions.Item>
                  <Descriptions.Item label="已匹配定额">{data.valuation.matched ?? 0}</Descriptions.Item>
                  <Descriptions.Item label="未匹配">{data.valuation.skipped ?? 0}</Descriptions.Item>
                </Descriptions>
                <Table
                  rowKey="boq_item_id"
                  dataSource={data.valuation.items ?? []}
                  pagination={{ pageSize: 10 }}
                  columns={[
                    { title: "清单编码", dataIndex: "code", width: 140 },
                    { title: "清单名称", dataIndex: "name" },
                    { title: "单位", dataIndex: "unit", width: 70 },
                    { title: "工程量", dataIndex: "quantity", width: 100, render: (v) => num(v) },
                    { title: "定额编码", dataIndex: "quota_code", width: 140 },
                    { title: "定额名称", dataIndex: "quota_name" },
                    { title: "匹配度", dataIndex: "match_confidence", width: 90, render: (v) => pct(v) },
                    { title: "状态", dataIndex: "status", width: 80, render: (v) => (
                      <Tag color={v === "matched" ? "green" : "default"}>{v === "matched" ? "已匹配" : "未匹配"}</Tag>
                    )},
                    { title: "合价", dataIndex: "total", width: 120, render: (v) => money(v) },
                  ]}
                />
              </Card>
            </Col>
          )}
        </Row>
      )}
    </Page>
  );
}

export function StableIfcParser() {
  const { message } = App.useApp();
  const [taskId, setTaskId] = useState("");
  const result = useAsyncData(async () => (taskId ? api.getIfcParseResult(taskId) : Promise.resolve(null)), [taskId]);

  const uploadProps: UploadProps = {
    accept: ".ifc",
    showUploadList: false,
    customRequest: async ({ file, onSuccess, onError }) => {
      try {
        const data = await api.uploadIfcFile(file as File);
        setTaskId(data.taskId);
        message.success("IFC 已提交解析");
        onSuccess?.(data);
      } catch (err) {
        onError?.(err as Error);
        message.error(err instanceof Error ? err.message : "上传失败");
      }
    },
  };

  return (
    <Page title="IFC 解析" subtitle="上传 IFC 模型并生成工程量建议" extra={<Upload {...uploadProps}><Button type="primary" icon={<CloudUploadOutlined />}>上传 IFC</Button></Upload>}>
      <Card>
        <Space wrap>
          <Input.Search placeholder="输入任务 ID 查询" value={taskId} onChange={(e) => setTaskId(e.target.value)} onSearch={result.refresh} style={{ width: 360 }} />
          <Button icon={<ReloadOutlined />} disabled={!taskId} onClick={result.refresh}>刷新</Button>
          <Button disabled={!taskId} onClick={async () => { await api.autoValuateIfcParseResult(taskId); message.success("已启动自动计价"); void result.refresh(); }}>自动计价</Button>
        </Space>
      </Card>
      {result.data && (
        <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
          <Col xs={24} md={8}><Card><Statistic title="状态" value={result.data.status} /></Card></Col>
          <Col xs={24} md={8}><Card><Statistic title="元素数" value={result.data.total_elements ?? 0} /></Card></Col>
          <Col xs={24} md={8}><Card><Statistic title="网格元素" value={result.data.mesh_element_count ?? 0} /></Card></Col>
          <Col span={24}>
            <Card title="元素明细">
              <Table<IfcElement>
                rowKey="id"
                dataSource={result.data.elements ?? []}
                columns={[
                  { title: "类型", dataIndex: "element_type", width: 160 },
                  { title: "名称", dataIndex: "name" },
                  { title: "材料", dataIndex: "material" },
                  { title: "工程量", dataIndex: "quantity_estimate", render: (v) => num(v) },
                  { title: "单位", dataIndex: "unit", width: 80 },
                  { title: "置信度", dataIndex: "confidence", render: (v) => pct(v) },
                ]}
              />
            </Card>
          </Col>
        </Row>
      )}
    </Page>
  );
}

export function StableAuditWorkbench() {
  const { message } = App.useApp();
  const [projectId, setProjectId] = useState<number | undefined>();
  const pipeline = useAsyncData(async () => (projectId ? api.runAuditPipeline(projectId) : Promise.resolve(null)), [projectId]);
  const validation = useAsyncData(async () => (projectId ? api.validate(projectId) : Promise.resolve(null)), [projectId]);

  const runAudit = async () => {
    if (!projectId) return;
    const res = await api.runAuditPipeline(projectId);
    message.success("审计流水线已完成");
    await pipeline.refresh();
    await validation.refresh();
    return res;
  };

  return (
    <Page title="审计工作台" subtitle="运行审计并查看校验问题" extra={<ProjectPicker value={projectId} onChange={setProjectId} />}>
      <Card>
        <Space>
          <Button type="primary" icon={<PlayCircleOutlined />} disabled={!projectId} onClick={runAudit}>运行审计</Button>
          <Button icon={<ReloadOutlined />} disabled={!projectId} onClick={() => { void pipeline.refresh(); void validation.refresh(); }}>刷新</Button>
        </Space>
      </Card>
      {pipeline.data && (
        <Card title="审计流水线" style={{ marginTop: 16 }}>
          <Table
            rowKey="name"
            dataSource={pipeline.data.stages ?? []}
            pagination={false}
            columns={[
              { title: "阶段", dataIndex: "handler" },
              { title: "状态", dataIndex: "success", render: (v) => <Tag color={v ? "green" : "red"}>{v ? "成功" : "失败"}</Tag> },
              { title: "说明", dataIndex: "answer", ellipsis: true },
            ]}
          />
        </Card>
      )}
      <Card title="问题列表" style={{ marginTop: 16 }}>
        <Table<ValidationIssue>
          rowKey={(row, index) => `${row.code}-${index}`}
          dataSource={validation.data?.issues ?? []}
          loading={validation.loading && Boolean(projectId)}
          columns={[
            { title: "级别", dataIndex: "severity", width: 100, render: (v) => <Tag color={v === "error" ? "red" : "orange"}>{v}</Tag> },
            { title: "问题", dataIndex: "message" },
            { title: "建议", dataIndex: "suggestion" },
          ]}
        />
      </Card>
    </Page>
  );
}

export function StableTaskCenter() {
  const [taskType, setTaskType] = useState<string | undefined>();
  const tasks = useAsyncData(() => api.listTasks(taskType), [taskType]);
  return (
    <Page title="任务中心" subtitle="查看异步任务运行状态" extra={<Button icon={<ReloadOutlined />} onClick={tasks.refresh}>刷新</Button>}>
      <Card>
        <Select
          allowClear
          placeholder="任务类型"
          style={{ width: 220 }}
          value={taskType}
          onChange={setTaskType}
          options={[
            { label: "图纸识别", value: "drawing_recognition" },
            { label: "IFC 解析", value: "ifc_parse" },
            { label: "审计", value: "audit" },
          ]}
        />
      </Card>
      <Card style={{ marginTop: 16 }}>
        <Table<TaskStatusOut>
          rowKey="task_id"
          dataSource={tasks.data?.tasks ?? []}
          loading={tasks.loading}
          columns={[
            { title: "任务 ID", dataIndex: "task_id", ellipsis: true },
            { title: "类型", dataIndex: "task_type", width: 140 },
            { title: "状态", dataIndex: "status", width: 110, render: (v) => <Tag>{v}</Tag> },
            { title: "进度", dataIndex: "progress", width: 180, render: (v) => <Progress percent={Math.round(Number(v) || 0)} size="small" /> },
            { title: "消息", dataIndex: "message" },
            { title: "错误", dataIndex: "error", render: (v) => text(v) },
          ]}
        />
      </Card>
    </Page>
  );
}

export function StableSystemSettings() {
  const { message } = App.useApp();
  const settings = useAsyncData(() => api.getZhSettings(), []);
  const checks = useAsyncData(() => api.getSystemCheck(), []);
  const [form] = Form.useForm();

  useEffect(() => {
    if (settings.data) form.setFieldsValue(settings.data);
  }, [form, settings.data]);

  const save = async () => {
    const values = await form.validateFields();
    await api.updateZhSettings(values);
    message.success("设置已保存");
    await settings.refresh();
  };

  return (
    <Page title="系统设置" subtitle="模型、系统检查和运行状态" extra={<Button icon={<ReloadOutlined />} onClick={() => { void settings.refresh(); void checks.refresh(); }}>刷新</Button>}>
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={12}>
          <Card title="模型设置" extra={<Button type="primary" icon={<SaveOutlined />} onClick={save}>保存</Button>}>
            <Form form={form} layout="vertical">
              <Form.Item name="provider" label="当前 Provider"><Input /></Form.Item>
              <Form.Item name="timeout_seconds" label="超时时间"><InputNumber min={5} max={300} style={{ width: "100%" }} /></Form.Item>
              <Form.Item name="enable_audit_logs" label="启用审计日志"><Select options={[{ label: "启用", value: true }, { label: "关闭", value: false }]} /></Form.Item>
            </Form>
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card title="系统检查">
            <Tag color={checks.data?.status === "ok" ? "green" : "orange"}>{checks.data?.status ?? "unknown"}</Tag>
            <Divider />
            <Table
              rowKey="key"
              size="small"
              pagination={false}
              dataSource={checks.data?.checks ?? []}
              columns={[
                { title: "项目", dataIndex: "label" },
                { title: "状态", dataIndex: "status", width: 90, render: (v) => <Tag color={v === "ok" ? "green" : v === "error" ? "red" : "orange"}>{v}</Tag> },
                { title: "说明", dataIndex: "message" },
              ]}
            />
          </Card>
        </Col>
      </Row>
    </Page>
  );
}

export function StableReports() {
  const [projectId, setProjectId] = useState<number | undefined>();
  const report = useAsyncData(async () => (projectId ? api.getReport(projectId) : Promise.resolve(null)), [projectId]);
  const divisions = useMemo(() => report.data?.divisions ?? [], [report.data]);
  const lines = useMemo(() => report.data?.line_items ?? [], [report.data]);
  return (
    <Page title="报表中心" subtitle="项目造价报表和导出" extra={<ProjectPicker value={projectId} onChange={setProjectId} />}>
      <Row gutter={[16, 16]}>
        <Col xs={24} md={8}><Card><Statistic title="总造价" prefix="¥" value={report.data?.cost_summary?.grand_total ?? 0} precision={2} /></Card></Col>
        <Col xs={24} md={8}><Card><Statistic title="清单项" value={report.data?.statistics?.total_items ?? 0} /></Card></Col>
        <Col xs={24} md={8}><Card><Button disabled={!projectId} icon={<DownloadOutlined />} onClick={async () => {
          if (!projectId) return;
          const blob = await api.exportReport(projectId, "pdf");
          window.open(URL.createObjectURL(blob));
        }}>导出 PDF</Button></Card></Col>
      </Row>
      <Card title="分部汇总" style={{ marginTop: 16 }}>
        <Table<ReportDivision> rowKey="division" dataSource={divisions} pagination={false} columns={[
          { title: "分部", dataIndex: "division" },
          { title: "数量", dataIndex: "item_count" },
          { title: "金额", dataIndex: "total_cost", render: (v) => money(v) },
        ]} />
      </Card>
      <Card title="清单明细" style={{ marginTop: 16 }}>
        <Table<ReportLineItem> rowKey="boq_item_id" dataSource={lines} columns={[
          { title: "编码", dataIndex: "code" },
          { title: "名称", dataIndex: "name" },
          { title: "单位", dataIndex: "unit" },
          { title: "数量", dataIndex: "quantity", render: (v) => num(v) },
          { title: "合价", dataIndex: "total_cost", render: (v) => money(v) },
        ]} />
      </Card>
    </Page>
  );
}

export function StableLifecycle() {
  return (
    <Page title="全流程" subtitle="从项目创建到图纸识别、清单计价、审计和报表归档">
      <Row gutter={[16, 16]}>
        {[
          ["项目管理", "创建项目并维护基础资料"],
          ["图纸识别", "上传图纸生成构件和清单建议"],
          ["IFC 解析", "解析模型并提取工程量"],
          ["过程计价", "自动匹配定额并计算造价"],
          ["审计工作台", "校验异常和审计"],
          ["报表中心", "输出项目造价成果"],
        ].map(([title, detail], index) => (
          <Col xs={24} md={12} xl={8} key={title}>
            <Card>
              <Statistic title={`步骤 ${index + 1}`} value={title} />
              <Typography.Text type="secondary">{detail}</Typography.Text>
            </Card>
          </Col>
        ))}
      </Row>
    </Page>
  );
}
