import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Empty, Form, Input, InputNumber, Modal, Popconfirm, Select, Table, Tag, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import { CheckCircleOutlined, CloudSyncOutlined, DeleteOutlined, EditOutlined, PlusOutlined, ReloadOutlined } from "@ant-design/icons";
import type { PriceSourceInfo, Project, RulePackage, RulePackageCreate, SystemCheckItem } from "../api";
import { api } from "../api";
import Panel from "../components/Panel";
import "../styles/resource-screen.css";
import TaskCenter from "./TaskCenter";

// 费率 → 百分比展示
function pct(rate: number | null | undefined, digits = 2) {
  if (rate == null) return "-";
  return `${(Number(rate) * 100).toFixed(digits)}%`;
}

// 未绑定规则包时的默认费率（与后端 DEFAULT_FEE_CONFIG 一致）
const DEFAULT_RATES = { management_rate: 0.08, profit_rate: 0.05, regulatory_rate: 0.03, tax_rate: 0.09 };

type SettingsSection = "fees" | "system" | "prices" | "tasks";

// 设置导航分组
const SETTINGS_NAV: { key: SettingsSection; icon: string; label: string; desc: string }[] = [
  { key: "fees", icon: "calculate", label: "计费参数", desc: "规则包 · 费率快照" },
  { key: "system", icon: "monitor_heart", label: "系统检查", desc: "依赖与配置自检" },
  { key: "prices", icon: "cloud_sync", label: "价格调度", desc: "抓取任务 · 价格来源" },
  { key: "tasks", icon: "dashboard", label: "作业监控", desc: "后台任务与队列" },
];


export default function SystemSettings() {
  const [activeSection, setActiveSection] = useState<SettingsSection>("fees");
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
  const [editingRule, setEditingRule] = useState<RulePackage | null>(null);
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

  const openCreateRule = () => {
    setEditingRule(null);
    ruleForm.resetFields();
    ruleForm.setFieldsValue({ region: "全国", management_rate: 0.08, profit_rate: 0.05, regulatory_rate: 0.03, tax_rate: 0.09, rounding_rule: "ROUND_HALF_UP", version: "1.0" });
    setRuleModalOpen(true);
  };

  const openEditRule = (record: RulePackage) => {
    setEditingRule(record);
    ruleForm.setFieldsValue({
      name: record.name,
      region: record.region || "全国",
      management_rate: record.management_rate,
      profit_rate: record.profit_rate,
      regulatory_rate: record.regulatory_rate,
      tax_rate: record.tax_rate,
      rounding_rule: record.rounding_rule,
      version: record.version,
    });
    setRuleModalOpen(true);
  };

  const saveRule = async () => {
    try {
      const values = await ruleForm.validateFields();
      setSubmittingRule(true);
      if (editingRule) {
        await api.updateRulePackage(editingRule.id, values);
        message.success(`规则包「${values.name}」已更新`);
      } else {
        await api.createRulePackage(values);
        message.success(`规则包「${values.name}」已创建`);
      }
      ruleForm.resetFields();
      setRuleModalOpen(false);
      setEditingRule(null);
      await loadRules();
    } catch (err) {
      if (err instanceof Error) message.error(err.message);
    } finally {
      setSubmittingRule(false);
    }
  };

  const deleteRule = async (record: RulePackage) => {
    try {
      const res = await api.deleteRulePackage(record.id);
      message.success(res.message || "规则包已删除");
      await loadRules();
    } catch (err) {
      message.error(err instanceof Error ? err.message : "删除规则包失败");
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
    <div className="page-container res-page">
      {/* 摘要指标带 */}
      <div className="screen-metrics">
        <div className="screen-metric">
          <span className="material-symbols-outlined screen-metric-icon">tune</span>
          <div className="screen-metric-body">
            <span className="screen-metric-label">规则包</span>
            <span className="screen-metric-value">
              {rules.length}
              <span className="screen-metric-unit">个</span>
            </span>
          </div>
        </div>
        <div className="screen-metric">
          <span className="material-symbols-outlined screen-metric-icon">link</span>
          <div className="screen-metric-body">
            <span className="screen-metric-label">已绑定项目</span>
            <span className="screen-metric-value">
              {projects.filter((p) => p.rule_package_id).length}
              <span className="screen-metric-unit">/{projects.length || 0}</span>
            </span>
          </div>
        </div>
        <div className="screen-metric is-amber">
          <span className="material-symbols-outlined screen-metric-icon">verified</span>
          <div className="screen-metric-body">
            <span className="screen-metric-label">系统检查项</span>
            <span className="screen-metric-value">
              {systemChecks.length}
              <span className="screen-metric-unit">项</span>
            </span>
          </div>
        </div>
        <div className="screen-metric">
          <span className="material-symbols-outlined screen-metric-icon">trending_up</span>
          <div className="screen-metric-body">
            <span className="screen-metric-label">可用价格源</span>
            <span className="screen-metric-value">
              {priceSources.filter((source) => source.available).length}
              <span className="screen-metric-unit">/{priceSources.length || 0}</span>
            </span>
          </div>
        </div>
      </div>

      <div className="res-settings">
        {/* 左设置导航 */}
        <Panel title="设置导航" icon="tune" className="res-side" bodyClassName="res-side-body">
          {SETTINGS_NAV.map((item) => (
            <button
              key={item.key}
              type="button"
              className={`res-nav-item${activeSection === item.key ? " active" : ""}`}
              onClick={() => setActiveSection(item.key)}
            >
              <span className="material-symbols-outlined">{item.icon}</span>
              <span className="res-nav-text">
                <span className="res-nav-label">{item.label}</span>
                <span className="res-nav-desc">{item.desc}</span>
              </span>
            </button>
          ))}
          <p className="res-note">
            费率与规则包修改后即时联动项目计价；价格调度任务在后台运行，可在「作业监控」查看执行记录。
          </p>
        </Panel>

        {/* 右设置面板 */}
        <div className="res-settings-content">
          {activeSection === "fees" && (
            <>
              <Panel
                title="规则包"
                icon="tune"
                flush
                extra={
                  <span style={{ display: "inline-flex", gap: 8 }}>
                    <Button icon={<ReloadOutlined />} loading={rulesLoading} onClick={loadRules}>刷新</Button>
                    <Button type="primary" icon={<PlusOutlined />} onClick={openCreateRule}>新建规则包</Button>
                  </span>
                }
              >
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
                    {
                      title: "操作",
                      key: "actions",
                      width: 110,
                      render: (_: unknown, row) => (
                        <span style={{ display: "inline-flex", gap: 6 }}>
                          <Button size="small" icon={<EditOutlined />} onClick={() => openEditRule(row)}>编辑</Button>
                          <Popconfirm
                            title="删除规则包"
                            description={(ruleUsage.get(row.id) ?? 0) > 0 ? `该包已被 ${ruleUsage.get(row.id)} 个项目绑定，删除后将解绑并回默认费率。` : "确认删除该规则包？"}
                            okText="删除"
                            cancelText="取消"
                            okButtonProps={{ danger: true }}
                            onConfirm={() => deleteRule(row)}
                          >
                            <Button size="small" danger icon={<DeleteOutlined />} />
                          </Popconfirm>
                        </span>
                      ),
                    },
                  ]}
                />
              </Panel>

              <Panel title="项目费率快照（联动计价）" icon="link" flush>
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
              </Panel>
            </>
          )}

          {activeSection === "system" && (
            <Panel title="系统健康检查" icon="monitor_heart" flush>
              <Table rowKey="key" size="small" columns={checkColumns} dataSource={systemChecks} pagination={false} locale={{ emptyText: <Empty description="暂无检查项数据。" /> }} />
            </Panel>
          )}

          {activeSection === "prices" && (
            <>
              <Panel title="调度任务" icon="schedule">
                <div className="res-scheduler-grid">
                  <div className="res-scheduler-card">
                    <span className="material-symbols-outlined">cloud_sync</span>
                    <span className="res-scheduler-title">测试抓取</span>
                    <span className="res-scheduler-desc">立即执行一次价格抓取，验证采集源是否可用。</span>
                    <Button type="primary" icon={<CloudSyncOutlined />} loading={fetchingPrices} onClick={fetchPrices}>执行抓取</Button>
                  </div>
                  <div className="res-scheduler-card">
                    <span className="material-symbols-outlined">schedule</span>
                    <span className="res-scheduler-title">每日定时调度</span>
                    <span className="res-scheduler-desc">启动 24 小时周期自动抓取，保持价格库最新。</span>
                    <Button loading={schedulerBusy === "start"} onClick={async () => {
                      setSchedulerBusy("start");
                      try { await api.startPriceScheduler(24); message.success("价格抓取调度已启动"); }
                      catch (err) { message.error(err instanceof Error ? err.message : "启动调度失败"); }
                      finally { setSchedulerBusy(null); }
                    }}>启动调度</Button>
                  </div>
                  <div className="res-scheduler-card">
                    <span className="material-symbols-outlined">pause_circle</span>
                    <span className="res-scheduler-title">停止调度</span>
                    <span className="res-scheduler-desc">停止后台定时抓取任务，保留已采集的价格数据。</span>
                    <Button loading={schedulerBusy === "stop"} onClick={async () => {
                      setSchedulerBusy("stop");
                      try { await api.stopPriceScheduler(); message.success("价格抓取调度已停止"); }
                      catch (err) { message.error(err instanceof Error ? err.message : "停止调度失败"); }
                      finally { setSchedulerBusy(null); }
                    }}>停止调度</Button>
                  </div>
                </div>
              </Panel>

              <Panel title="价格来源" icon="trending_up" flush>
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
              </Panel>
            </>
          )}

          {activeSection === "tasks" && (
            <Panel title="作业监控" icon="dashboard" flush bodyClassName="res-embed">
              <TaskCenter />
            </Panel>
          )}
        </div>
      </div>

      {/* 新建 / 编辑规则包 */}
      <Modal
        title={editingRule ? `编辑规则包 · ${editingRule.name}` : "新建计费规则包"}
        open={ruleModalOpen}
        onCancel={() => { setEditingRule(null); setRuleModalOpen(false); }}
        onOk={saveRule}
        confirmLoading={submittingRule}
        okText={editingRule ? "保存" : "创建"}
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
