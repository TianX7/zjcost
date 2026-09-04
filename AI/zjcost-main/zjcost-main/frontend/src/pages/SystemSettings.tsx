import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Empty, Form, Input, InputNumber, Modal, Select, Table, Tabs, Tag, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import { CalculatorOutlined, CheckCircleOutlined, CloudSyncOutlined, DesktopOutlined, PlusOutlined, ReloadOutlined, SafetyOutlined } from "@ant-design/icons";
import type { PriceSourceInfo, Project, RulePackage, RulePackageCreate, SystemCheckItem } from "../api";
import { api } from "../api";
import PageHeader from "../components/PageHeader";
import TaskCenter from "./TaskCenter";

// 费率 → 百分比展示
function pct(rate: number | null | undefined, digits = 2) {
  if (rate == null) return "-";
  return `${(Number(rate) * 100).toFixed(digits)}%`;
}

// 未绑定规则包时的默认费率（与后端 DEFAULT_FEE_CONFIG 一致）
const DEFAULT_RATES = { management_rate: 0.08, profit_rate: 0.05, regulatory_rate: 0.03, tax_rate: 0.09 };

export default function SystemSettings() {
  const navigate = useNavigate();
  const [systemChecks, setSystemChecks] = useState<SystemCheckItem[]>([]);
  const [priceSources, setPriceSources] = useState<PriceSourceInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetchingPrices, setFetchingPrices] = useState(false);
  const [schedulerBusy, setSchedulerBusy] = useState<"start" | "stop" | null>(null);
  const [rules, setRules] = useState<RulePackage[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [rulesLoading, setRulesLoading] = useState(false);
  const [ruleModalOpen, setRuleModalOpen] = useState(false);
  const [submittingRule, setSubmittingRule] = useState(false);
  const [bindLoadingId, setBindLoadingId] = useState<number | null>(null);
  const [bindSelection, setBindSelection] = useState<Record<number, number>>({});
  const [ruleForm] = Form.useForm<RulePackageCreate>();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [checks, sources] = await Promise.all([
        api.getSystemCheck().catch(() => null),
        api.listPriceSources().catch(() => []),
      ]);
      setSystemChecks(checks?.checks ?? []);
      setPriceSources(sources);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const loadRules = useCallback(async () => {
    setRulesLoading(true);
    try {
      const [ruleData, projectData] = await Promise.all([
        api.listRulePackages().catch(() => [] as RulePackage[]),
        api.listProjects({ page_size: 100 }).catch(() => null),
      ]);
      setRules(ruleData);
      setProjects(projectData?.items ?? []);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "加载计费参数失败");
    } finally {
      setRulesLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadRules();
  }, [loadRules]);

  const createRule = async () => {
    try {
      const values = await ruleForm.validateFields();
      setSubmittingRule(true);
      await api.createRulePackage(values);
      message.success(`规则包「${values.name}」已创建`);
      ruleForm.resetFields();
      setRuleModalOpen(false);
      await loadRules();
    } catch (err) {
      if (err instanceof Error) message.error(err.message);
    } finally {
      setSubmittingRule(false);
    }
  };

  const bindRule = async (projectId: number, ruleId: number) => {
    setBindLoadingId(projectId);
    try {
      await api.bindRulePackage(projectId, ruleId);
      const rule = rules.find((r) => r.id === ruleId);
      message.success(`已绑定规则包「${rule?.name ?? ruleId}」`);
      setProjects((prev) => prev.map((p) => (p.id === projectId ? { ...p, rule_package_id: ruleId } : p)));
    } catch (err) {
      message.error(err instanceof Error ? err.message : "绑定失败");
    } finally {
      setBindLoadingId(null);
    }
  };

  // 规则包被多少项目绑定
  const ruleUsage = useMemo(() => {
    const map = new Map<number, number>();
    for (const p of projects) {
      if (p.rule_package_id) map.set(p.rule_package_id, (map.get(p.rule_package_id) ?? 0) + 1);
    }
    return map;
  }, [projects]);

  const fetchPrices = async () => {
    setFetchingPrices(true);
    try {
      const result = await api.fetchPrices({ region: "CN" });
      message.success(`抓取完成：${result.total_fetched} 条，新增/更新 ${result.total_new_or_updated} 条`);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "抓取失败");
    } finally {
      setFetchingPrices(false);
    }
  };

  const checkColumns: ColumnsType<SystemCheckItem> = [
    { title: "检查项", dataIndex: "label" },
    { title: "状态", dataIndex: "status", width: 110, render: (value: string) => <Tag color={value === "ok" ? "green" : value === "warning" ? "orange" : "red"}>{value}</Tag> },
    { title: "说明", dataIndex: "message" },
  ];

  // 项目当前费率快照（未绑定规则包则回退默认费率）
  const projectRateSnapshot = useMemo(
    () =>
      projects.map((p) => {
        const rule = p.rule_package_id ? rules.find((r) => r.id === p.rule_package_id) : undefined;
        return { ...p, rule };
      }),
    [projects, rules],
  );

  return (
    <div className="page-container">
      <PageHeader
        icon="tune"
        title="系统配置参数"
        subtitle="管理计费规则包、价格调度与作业监控，统一维护造价计算的费率与数据来源。"
      />

      {/* KPI 指标卡 */}
      <div className="kpi-grid">
        <div className="kpi-card">
          <span className="material-symbols-outlined kpi-card-icon">tune</span>
          <div className="kpi-card-body">
            <span className="kpi-card-label">规则包</span>
            <span className="kpi-card-value">{rules.length}<span className="kpi-card-suffix">个</span></span>
          </div>
        </div>
        <div className="kpi-card">
          <span className="material-symbols-outlined kpi-card-icon">link</span>
          <div className="kpi-card-body">
            <span className="kpi-card-label">已绑定项目</span>
            <span className="kpi-card-value">{projects.filter((p) => p.rule_package_id).length}<span className="kpi-card-suffix">/{projects.length || 0}</span></span>
          </div>
        </div>
        <div className="kpi-card">
          <span className="material-symbols-outlined kpi-card-icon">verified</span>
          <div className="kpi-card-body">
            <span className="kpi-card-label">系统检查项</span>
            <span className="kpi-card-value">{systemChecks.length}<span className="kpi-card-suffix">项</span></span>
          </div>
        </div>
        <div className="kpi-card">
          <span className="material-symbols-outlined kpi-card-icon">trending_up</span>
          <div className="kpi-card-body">
            <span className="kpi-card-label">可用价格源</span>
            <span className="kpi-card-value">{priceSources.filter((source) => source.available).length}<span className="kpi-card-suffix">/{priceSources.length || 0}</span></span>
          </div>
        </div>
      </div>

      <Tabs
        items={[
          {
            key: "fees",
            label: <span><CalculatorOutlined /> 计费参数</span>,
            children: (
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <div className="content-card">
                  <div className="content-card-head">
                    <h3 className="content-card-title"><span className="material-symbols-outlined">tune</span>规则包</h3>
                    <div style={{ display: "flex", gap: 8 }}>
                      <Button icon={<ReloadOutlined />} loading={rulesLoading} onClick={loadRules}>刷新</Button>
                      <Button type="primary" icon={<PlusOutlined />} onClick={() => setRuleModalOpen(true)}>新建规则包</Button>
                    </div>
                  </div>
                  <div className="content-card-body flush">
                    <Table
                      rowKey="id"
                      size="small"
                      loading={rulesLoading}
                      dataSource={rules}
                      pagination={false}
                      locale={{ emptyText: <Empty description="暂无规则包。计费默认使用管理费率 8% / 利润率 5% / 规费 3% / 增值税 9%，建议新建规则包并按项目绑定。" /> }}
                      columns={[
                        { title: "名称", dataIndex: "name", width: 150, ellipsis: true },
                        { title: "地区", dataIndex: "region", width: 90, render: (v: string) => v || "-" },
                        { title: "管理费率", dataIndex: "management_rate", width: 100, align: "right", render: (v: number) => pct(v) },
                        { title: "利润率", dataIndex: "profit_rate", width: 90, align: "right", render: (v: number) => pct(v) },
                        { title: "规费费率", dataIndex: "regulatory_rate", width: 100, align: "right", render: (v: number) => pct(v) },
                        { title: "增值税率", dataIndex: "tax_rate", width: 100, align: "right", render: (v: number) => pct(v) },
                        { title: "舍入规则", dataIndex: "rounding_rule", width: 120, render: (v: string) => v || "-" },
                        { title: "版本", dataIndex: "version", width: 70 },
                        {
                          title: "已绑定项目",
                          key: "usage",
                          width: 110,
                          align: "center",
                          render: (_: unknown, row) => (
                            <Tag color={(ruleUsage.get(row.id) ?? 0) > 0 ? "green" : "default"}>{ruleUsage.get(row.id) ?? 0} 个</Tag>
                          ),
                        },
                      ]}
                    />
                  </div>
                </div>

                <div className="content-card">
                  <div className="content-card-head">
                    <h3 className="content-card-title"><span className="material-symbols-outlined">link</span>项目费率快照（联动计价）</h3>
                  </div>
                  <div className="content-card-body flush">
                    <Table
                      rowKey="id"
                      size="small"
                      loading={rulesLoading}
                      dataSource={projectRateSnapshot}
                      pagination={false}
                      scroll={{ x: 1080 }}
                      locale={{ emptyText: <Empty description="暂无项目。创建项目后即可绑定规则包并参与计价。" /> }}
                      columns={[
                        { title: "项目名称", dataIndex: "name", width: 180, ellipsis: true, fixed: "left" },
                        { title: "地区", dataIndex: "region", width: 90, render: (v: string) => v || "-" },
                        {
                          title: "当前规则包",
                          key: "rule",
                          width: 150,
                          render: (_: unknown, row: (typeof projectRateSnapshot)[number]) =>
                            row.rule ? <Tag color="blue">{row.rule.name}</Tag> : <Tag>默认费率</Tag>,
                        },
                        { title: "管理费率", key: "m", width: 95, align: "right", render: (_: unknown, row: (typeof projectRateSnapshot)[number]) => pct(row.rule?.management_rate ?? DEFAULT_RATES.management_rate) },
                        { title: "利润率", key: "p", width: 85, align: "right", render: (_: unknown, row: (typeof projectRateSnapshot)[number]) => pct(row.rule?.profit_rate ?? DEFAULT_RATES.profit_rate) },
                        { title: "规费费率", key: "r", width: 95, align: "right", render: (_: unknown, row: (typeof projectRateSnapshot)[number]) => pct(row.rule?.regulatory_rate ?? DEFAULT_RATES.regulatory_rate) },
                        { title: "增值税率", key: "t", width: 95, align: "right", render: (_: unknown, row: (typeof projectRateSnapshot)[number]) => pct(row.rule?.tax_rate ?? DEFAULT_RATES.tax_rate) },
                        {
                          title: "绑定规则包",
                          key: "bind",
                          width: 220,
                          fixed: "right",
                          render: (_: unknown, row: (typeof projectRateSnapshot)[number]) => {
                            const selectedId = bindSelection[row.id] ?? row.rule_package_id;
                            return (
                              <div style={{ display: "flex", gap: 6 }}>
                                <Select
                                  size="small"
                                  placeholder="选择规则包"
                                  style={{ minWidth: 130, flex: 1 }}
                                  value={selectedId ?? undefined}
                                  options={rules.map((r) => ({ value: r.id, label: r.name }))}
                                  disabled={rules.length === 0}
                                  onChange={(value) => setBindSelection((prev) => ({ ...prev, [row.id]: value }))}
                                />
                                <Button
                                  size="small"
                                  type="primary"
                                  loading={bindLoadingId === row.id}
                                  disabled={rules.length === 0 || selectedId == null || selectedId === row.rule_package_id}
                                  onClick={() => selectedId != null && bindRule(row.id, selectedId)}
                                >
                                  绑定
                                </Button>
                              </div>
                            );
                          },
                        },
                      ]}
                    />
                  </div>
                </div>
              </div>
            ),
          },
          {
            key: "system",
            label: <span><SafetyOutlined /> 系统检查</span>,
            children: (
              <div className="content-card">
                <div className="content-card-head">
                  <h3 className="content-card-title"><span className="material-symbols-outlined">monitor_heart</span>系统健康检查</h3>
                </div>
                <div className="content-card-body flush">
                  <Table rowKey="key" size="small" columns={checkColumns} dataSource={systemChecks} pagination={false} locale={{ emptyText: <Empty description="暂无检查项数据。" /> }} />
                </div>
              </div>
            ),
          },
          {
            key: "prices",
            label: <span><CloudSyncOutlined /> 价格调度</span>,
            children: (
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <div className="price-scheduler-cards">
                  <div className="price-scheduler-card">
                    <span className="material-symbols-outlined">cloud_sync</span>
                    <span className="price-scheduler-card-title">测试抓取</span>
                    <span className="price-scheduler-card-desc">立即执行一次价格抓取，验证采集源是否可用。</span>
                    <Button type="primary" icon={<CloudSyncOutlined />} loading={fetchingPrices} onClick={fetchPrices}>执行抓取</Button>
                  </div>
                  <div className="price-scheduler-card">
                    <span className="material-symbols-outlined">schedule</span>
                    <span className="price-scheduler-card-title">每日定时调度</span>
                    <span className="price-scheduler-card-desc">启动 24 小时周期自动抓取，保持价格库最新。</span>
                    <Button loading={schedulerBusy === "start"} onClick={async () => {
                      setSchedulerBusy("start");
                      try { await api.startPriceScheduler(24); message.success("价格抓取调度已启动"); }
                      catch (err) { message.error(err instanceof Error ? err.message : "启动调度失败"); }
                      finally { setSchedulerBusy(null); }
                    }}>启动调度</Button>
                  </div>
                  <div className="price-scheduler-card">
                    <span className="material-symbols-outlined">pause_circle</span>
                    <span className="price-scheduler-card-title">停止调度</span>
                    <span className="price-scheduler-card-desc">停止后台定时抓取任务，保留已采集的价格数据。</span>
                    <Button loading={schedulerBusy === "stop"} onClick={async () => {
                      setSchedulerBusy("stop");
                      try { await api.stopPriceScheduler(); message.success("价格抓取调度已停止"); }
                      catch (err) { message.error(err instanceof Error ? err.message : "停止调度失败"); }
                      finally { setSchedulerBusy(null); }
                    }}>停止调度</Button>
                  </div>
                  <div className="price-scheduler-card">
                    <span className="material-symbols-outlined">database</span>
                    <span className="price-scheduler-card-title">数据资源</span>
                    <span className="price-scheduler-card-desc">前往数据资源页面管理定额库、工料机和市场价详情。</span>
                    <Button onClick={() => navigate("/data-resources")}>进入数据资源</Button>
                  </div>
                </div>
                <div className="content-card">
                  <div className="content-card-head">
                    <h3 className="content-card-title"><span className="material-symbols-outlined">trending_up</span>价格来源</h3>
                  </div>
                  <div className="content-card-body flush">
                    <Table
                      rowKey="source_name"
                      size="small"
                      loading={loading}
                      dataSource={priceSources}
                      pagination={false}
                      scroll={{ x: 760 }}
                      locale={{ emptyText: <Empty description="暂无价格来源。请在「数据资源」页配置采集源。" /> }}
                      columns={[
                        { title: "来源", dataIndex: "display_name" },
                        { title: "标识", dataIndex: "source_name" },
                        { title: "可用", dataIndex: "available", render: (value: boolean) => value ? <Tag color="green" icon={<CheckCircleOutlined />}>可用</Tag> : <Tag color="red">不可用</Tag> },
                        { title: "已抓取", dataIndex: "total_prices_fetched" },
                        { title: "最近成功", dataIndex: "last_success_at", render: (value: string | null) => value || "-" },
                        { title: "错误", dataIndex: "error", render: (value: string | null) => value || "-" },
                      ]}
                    />
                  </div>
                </div>
              </div>
            ),
          },
          {
            key: "tasks",
            label: (
              <span>
                <DesktopOutlined />
                作业监控
              </span>
            ),
            children: <TaskCenter />,
          },
        ]}
      />

      {/* 新建规则包 */}
      <Modal
        title="新建计费规则包"
        open={ruleModalOpen}
        onCancel={() => setRuleModalOpen(false)}
        onOk={createRule}
        confirmLoading={submittingRule}
        okText="创建"
        cancelText="取消"
        destroyOnClose
      >
        <Form form={ruleForm} layout="vertical" initialValues={{ region: "全国", management_rate: 0.08, profit_rate: 0.05, regulatory_rate: 0.03, tax_rate: 0.09 }}>
          <Form.Item name="name" label="名称" rules={[{ required: true, message: "请输入规则包名称" }]}>
            <Input placeholder="如：2026 版·全国通用费率" />
          </Form.Item>
          <Form.Item name="region" label="适用地区">
            <Input placeholder="如：全国 / 浙江省" />
          </Form.Item>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Form.Item name="management_rate" label="管理费率">
              <InputNumber min={0} max={1} step={0.01} style={{ width: "100%" }} addonAfter="管理费率 = 直接费 × 本值" />
            </Form.Item>
            <Form.Item name="profit_rate" label="利润率">
              <InputNumber min={0} max={1} step={0.01} style={{ width: "100%" }} addonAfter="利润 = 直接费 × 本值" />
            </Form.Item>
            <Form.Item name="regulatory_rate" label="规费费率">
              <InputNumber min={0} max={1} step={0.01} style={{ width: "100%" }} addonAfter="规费 = 直接费 × 本值" />
            </Form.Item>
            <Form.Item name="tax_rate" label="增值税率">
              <InputNumber min={0} max={1} step={0.01} style={{ width: "100%" }} addonAfter="税金 = 税前合计 × 本值" />
            </Form.Item>
          </div>
          <div style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.7 }}>
            计价口径：税前合计 = 直接费 + 管理费 + 利润 + 规费；税金 = 税前合计 × 增值税率；含税合计 = 税前合计 + 税金。
          </div>
        </Form>
      </Modal>
    </div>
  );
}
