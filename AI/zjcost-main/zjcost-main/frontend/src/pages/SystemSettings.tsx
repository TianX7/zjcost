import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Form, Input, InputNumber, Select, Switch, Table, Tabs, Tag, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import { ApiOutlined, CheckCircleOutlined, CloudSyncOutlined, DesktopOutlined, SaveOutlined, CloudServerOutlined, SafetyOutlined } from "@ant-design/icons";
import type { PriceSourceInfo, ZhSettingsPayload, SystemCheckItem } from "../api";
import { api } from "../api";
import TaskCenter from "./TaskCenter";

const PROVIDERS = ["provider_a", "provider_b", "provider_c", "provider_d", "compatible"] as const;
type ProviderName = (typeof PROVIDERS)[number];

const PROVIDER_LABELS: Record<ProviderName, string> = {
  provider_a: "推理服务 A",
  provider_b: "推理服务 B",
  provider_c: "推理服务 C",
  provider_d: "推理服务 D",
  compatible: "兼容模式",
};

function defaultSettings(): ZhSettingsPayload {
  return {
    provider: "provider_a",
    timeout_seconds: 60,
    enable_audit_logs: true,
    providers: {
      provider_a: { api_key: "", api_key_set: false, base_url: "", model: "" },
      provider_b: { api_key: "", api_key_set: false, base_url: "", model: "" },
      provider_c: { api_key: "", api_key_set: false, base_url: "", model: "" },
      provider_d: { api_key: "", api_key_set: false, base_url: "", model: "" },
      compatible: { api_key: "", api_key_set: false, base_url: "", model: "" },
    },
  };
}

function isProviderName(value: string | undefined): value is ProviderName {
  return PROVIDERS.includes(value as ProviderName);
}

function normalizeSettings(value: ZhSettingsPayload | null | undefined): ZhSettingsPayload {
  const defaults = defaultSettings();
  const source = value ?? defaults;
  return {
    ...defaults,
    ...source,
    provider: isProviderName(source.provider) ? source.provider : defaults.provider,
    providers: {
      provider_a: { ...defaults.providers.provider_a, ...source.providers?.provider_a },
      provider_b: { ...defaults.providers.provider_b, ...source.providers?.provider_b },
      provider_c: { ...defaults.providers.provider_c, ...source.providers?.provider_c },
      provider_d: { ...defaults.providers.provider_d, ...source.providers?.provider_d },
      compatible: { ...defaults.providers.compatible, ...source.providers?.compatible },
    },
  };
}

export default function SystemSettings() {
  const navigate = useNavigate();
  const [settings, setSettings] = useState<ZhSettingsPayload>(defaultSettings());
  const [activeProvider, setActiveProvider] = useState<ProviderName>("provider_a");
  const [systemChecks, setSystemChecks] = useState<SystemCheckItem[]>([]);
  const [priceSources, setPriceSources] = useState<PriceSourceInfo[]>([]);
  const [, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [fetchingPrices, setFetchingPrices] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [zhConf, checks, sources] = await Promise.all([
        api.getZhSettings().catch(() => defaultSettings()),
        api.getSystemCheck().catch(() => null),
        api.listPriceSources().catch(() => []),
      ]);
      const normalized = normalizeSettings(zhConf);
      setSettings(normalized);
      setActiveProvider(isProviderName(zhConf.provider) ? zhConf.provider : normalized.provider as ProviderName);
      setSystemChecks(checks?.checks ?? []);
      setPriceSources(sources);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const updateProviderField = (field: "api_key" | "base_url" | "model", value: string) => {
    setSettings((current) => ({
      ...current,
      providers: {
        ...current.providers,
        [activeProvider]: {
          ...defaultSettings().providers[activeProvider],
          ...current.providers[activeProvider],
          [field]: value,
        },
      },
    }));
  };

  const save = async () => {
    setSaving(true);
    try {
      const data = await api.updateZhSettings({ ...normalizeSettings(settings), provider: activeProvider });
      setSettings(normalizeSettings(data));
      message.success("设置已保存");
    } catch (err) {
      message.error(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const testConnection = async () => {
    setTesting(true);
    try {
      const provider = normalizeSettings(settings).providers[activeProvider];
      const result = await api.testZhConnection({
        provider: activeProvider,
        api_key: provider.api_key,
        use_saved_key: !provider.api_key && provider.api_key_set,
        base_url: provider.base_url,
        model: provider.model,
        timeout_seconds: settings.timeout_seconds,
      });
      if (result.success) message.success(`连接成功，延迟 ${result.latency_ms}ms`);
      else message.error(result.error || "连接失败");
    } catch (err) {
      message.error(err instanceof Error ? err.message : "连接测试失败");
    } finally {
      setTesting(false);
    }
  };

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

  return (
    <div className="page-container">
      {/* KPI 指标卡 */}
      <div className="kpi-grid">
        <div className="kpi-card">
          <span className="material-symbols-outlined kpi-card-icon">cloud</span>
          <div className="kpi-card-body">
            <span className="kpi-card-label">在线服务供应商</span>
            <span className="kpi-card-value">{PROVIDERS.length}<span className="kpi-card-suffix">个</span></span>
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
        <div className="kpi-card">
          <span className="material-symbols-outlined kpi-card-icon">history</span>
          <div className="kpi-card-body">
            <span className="kpi-card-label">审计日志</span>
            <span className="kpi-card-value">{settings.enable_audit_logs ? "启用" : "停用"}</span>
          </div>
        </div>
      </div>

      <Tabs
        items={[
          {
            key: "zhConf",
            label: <span><CloudServerOutlined /> 在线服务</span>,
            children: (
              <div className="content-card">
                <div className="content-card-head">
                  <h3 className="content-card-title"><span className="material-symbols-outlined">zh_toy</span>辅助服务配置 — {PROVIDER_LABELS[activeProvider]}</h3>
                </div>
                <div className="content-card-body">
                  <Form layout="vertical">
                    <div className="settings-form-grid">
                      <Form.Item label="当前供应商">
                        <Select
                          value={activeProvider}
                          onChange={setActiveProvider}
                          options={PROVIDERS.map((provider) => ({ value: provider, label: PROVIDER_LABELS[provider] }))}
                        />
                      </Form.Item>
                      <Form.Item label="服务模型">
                        <Input
                          value={settings.providers[activeProvider].model}
                          placeholder="如 standard-model"
                          onChange={(event) => updateProviderField("model", event.target.value)}
                        />
                      </Form.Item>
                      <Form.Item label="API Key" className="settings-form-full">
                        <Input.Password
                          value={settings.providers[activeProvider].api_key}
                          placeholder={settings.providers[activeProvider].api_key_set ? "已保存，可留空继续使用" : "请输入 API Key"}
                          onChange={(event) => updateProviderField("api_key", event.target.value)}
                        />
                      </Form.Item>
                      <Form.Item label="Base URL" className="settings-form-full">
                        <Input
                          value={settings.providers[activeProvider].base_url}
                          placeholder="留空则使用供应商默认地址"
                          onChange={(event) => updateProviderField("base_url", event.target.value)}
                        />
                      </Form.Item>
                    </div>

                    <div className="settings-inline-row" style={{ marginTop: 16 }}>
                      <div className="settings-inline-item">
                        <span>超时秒数</span>
                        <InputNumber min={5} max={300} value={settings.timeout_seconds} onChange={(value) => setSettings((current) => ({ ...current, timeout_seconds: Number(value ?? 60) }))} />
                      </div>
                      <div className="settings-inline-item">
                        <span>审计日志</span>
                        <Switch checked={settings.enable_audit_logs} onChange={(checked) => setSettings((current) => ({ ...current, enable_audit_logs: checked }))} />
                      </div>
                    </div>

                    <div className="settings-action-bar">
                      <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={save}>保存设置</Button>
                      <Button icon={<ApiOutlined />} loading={testing} onClick={testConnection}>测试连接</Button>
                    </div>
                  </Form>
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
                  <Table rowKey="key" size="small" columns={checkColumns} dataSource={systemChecks} pagination={false} />
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
                    <Button onClick={async () => { await api.startPriceScheduler(24); message.success("价格抓取调度已启动"); }}>启动调度</Button>
                  </div>
                  <div className="price-scheduler-card">
                    <span className="material-symbols-outlined">pause_circle</span>
                    <span className="price-scheduler-card-title">停止调度</span>
                    <span className="price-scheduler-card-desc">停止后台定时抓取任务，保留已采集的价格数据。</span>
                    <Button onClick={async () => { await api.stopPriceScheduler(); message.success("价格抓取调度已停止"); }}>停止调度</Button>
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
                      dataSource={priceSources}
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
    </div>
  );
}
