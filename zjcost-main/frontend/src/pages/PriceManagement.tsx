import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Badge, Button, Checkbox, Empty, Form, Input, InputNumber, Modal, Progress, Select, Table, Tabs, Tag, Tooltip, message } from "antd";
import { CloudSyncOutlined, EyeOutlined, PlusOutlined, ReloadOutlined, RiseOutlined, FallOutlined, WifiOutlined, GlobalOutlined } from "@ant-design/icons";
import type { MaterialPrice, PriceSourceInfo, SourceHealthInfo, PreviewPriceItem, FetchResult } from "../api";
import { api } from "../api";

function useCountUp(target: number, duration = 700, digits = 0) {
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
      const next = start + diff * eased;
      setVal(digits > 0 ? Number(next.toFixed(digits)) : Math.round(next));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    prev.current = target;
    return () => cancelAnimationFrame(raf);
  }, [target, duration, digits]);
  return val;
}

function pseudoTrend(id: number, price: number) {
  const seed = (id * 9301 + 49297) % 233280;
  const normalized = seed / 233280;
  const rate = (normalized - 0.5) * 0.08;
  const prev = Math.max(price * (1 - rate), price * 0.5);
  return { rate, prev };
}

// 采集源显示名映射
const SOURCE_LABELS: Record<string, string> = {
  mysteel: "钢材行情",
  guangcai: "水泥行情",
  zaojiatong: "混凝土行情",
  regional_gov: "砂石行情",
  web_search: "全网价格搜索",
  reference: "内置参考价",
};

const SOURCE_COLORS: Record<string, string> = {
  mysteel: "#38bdf8",
  guangcai: "#34d399",
  zaojiatong: "#facc15",
  regional_gov: "#fb7185",
  web_search: "#a78bfa",
  reference: "#64748b",
};

const CATEGORIES = ["钢材", "水泥", "混凝土", "砂石", "木材", "管材", "装饰材料", "防水材料", "保温材料", "门窗", "安装材料"];

export default function PriceManagement() {
  const [materials, setMaterials] = useState<MaterialPrice[]>([]);
  const [sources, setSources] = useState<PriceSourceInfo[]>([]);
  const [healthList, setHealthList] = useState<SourceHealthInfo[]>([]);
  const [region, setRegion] = useState("");
  const [name, setName] = useState("");
  const [latestOnly, setLatestOnly] = useState(true);
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [checkingHealth, setCheckingHealth] = useState(false);
  const [open, setOpen] = useState(false);
  const [lastFetchError, setLastFetchError] = useState("");
  const [fetchResults, setFetchResults] = useState<FetchResult[]>([]);
  const [previewItems, setPreviewItems] = useState<PreviewPriceItem[]>([]);
  const [fetchProgress, setFetchProgress] = useState(0);
  const [form] = Form.useForm();

  // 采集配置
  const [collectQuery, setCollectQuery] = useState("");
  const [collectRegion, setCollectRegion] = useState("");
  const [collectCategory, setCollectCategory] = useState<string | undefined>();
  const [selectedSources, setSelectedSources] = useState<string[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [priceData, sourceData] = await Promise.all([
        api.listMaterialPrices({ region: region || undefined, name: name || undefined, latest_only: latestOnly }),
        api.listPriceSources().catch(() => []),
      ]);
      setMaterials(priceData);
      setSources(sourceData);
      // 默认选中所有在线源
      if (selectedSources.length === 0 && sourceData.length > 0) {
        setSelectedSources(sourceData.map((s) => s.source_name));
      }
    } catch (err) {
      message.error(err instanceof Error ? err.message : "加载材料价格失败");
    } finally {
      setLoading(false);
    }
  }, [latestOnly, name, region, selectedSources.length]);

  useEffect(() => { void load(); }, [load]);

  const checkHealth = useCallback(async () => {
    setCheckingHealth(true);
    try {
      const health = await api.getPriceSourcesHealth();
      setHealthList(health);
    } catch {
      setHealthList([]);
    } finally {
      setCheckingHealth(false);
    }
  }, []);

  const overview = useMemo(() => {
    const prices = materials.map((item) => Number(item.unit_price ?? 0)).filter((value) => value > 0);
    const avg = prices.length ? prices.reduce((sum, value) => sum + value, 0) / prices.length : 0;
    const latestDate = materials
      .map((item) => item.effective_date)
      .filter(Boolean)
      .sort()
      .at(-1);
    return {
      total: materials.length,
      avg,
      latestDate: latestDate || "-",
      availableSources: sources.filter((item) => item.available).length,
    };
  }, [materials, sources]);

  const animTotal = useCountUp(overview.total);
  const animAvg = useCountUp(overview.avg, 700, 2);
  const animSources = useCountUp(overview.availableSources);

  const create = async () => {
    try {
      const values = await form.validateFields();
      await api.createMaterialPrice({ ...values, effective_date: values.effective_date || new Date().toISOString().slice(0, 10) });
      message.success("材料价格已新增");
      setOpen(false);
      form.resetFields();
      await load();
    } catch (err) {
      // 表单校验不通过时静默（表单已标红）；仅接口失败才提示
      if (err && typeof err === "object" && "errorFields" in err) return;
      message.error(err instanceof Error ? err.message : "新增材料价格失败");
    }
  };

  // 真实采集：基于选中的源逐个采集，实时更新进度和结果
  const fetchPrices = async () => {
    if (selectedSources.length === 0) {
      message.warning("请至少选择一个采集源");
      return;
    }
    setFetching(true);
    setLastFetchError("");
    setFetchResults([]);
    setFetchProgress(0);
    const results: FetchResult[] = [];
    const totalSources = selectedSources.length;

    for (let i = 0; i < selectedSources.length; i++) {
      const sourceName = selectedSources[i];
      const t0 = performance.now();
      try {
        const res = await api.fetchPrices({
          source_names: [sourceName],
          query: collectQuery || undefined,
          region: collectRegion || "",
          category: collectCategory || "",
        });
        const result = res.results[0];
        if (result) {
          results.push(result);
        }
        setFetchResults([...results]);
      } catch (err) {
        results.push({
          source_name: sourceName,
          fetched: 0,
          new_or_updated: 0,
          duration_s: Number(((performance.now() - t0) / 1000).toFixed(2)),
          error: err instanceof Error ? err.message : "采集失败",
        });
        setFetchResults([...results]);
      }
      setFetchProgress(Math.round(((i + 1) / totalSources) * 100));
    }

    const totalFetched = results.reduce((sum, r) => sum + r.fetched, 0);
    const totalSaved = results.reduce((sum, r) => sum + r.new_or_updated, 0);
    const failed = results.filter((r) => r.error);
    if (failed.length > 0) {
      const names = failed.map((r) => SOURCE_LABELS[r.source_name] ?? r.source_name).join("、");
      setLastFetchError(`${names}：${failed[0].error}${failed.length > 1 ? ` 等 ${failed.length} 个源失败` : ""}`);
    }
    if (totalFetched > 0) {
      message.success(`采集完成：共 ${totalFetched} 条，新增/更新 ${totalSaved} 条`);
    } else {
      message.warning("本次采集未获取到新价格");
    }
    setFetching(false);
    setTimeout(() => setFetchProgress(0), 1500);
    await load();
    void checkHealth();
  };

  // 预览采集结果（不写入数据库）
  const previewFetch = async () => {
    if (selectedSources.length === 0) {
      message.warning("请至少选择一个采集源");
      return;
    }
    setPreviewing(true);
    setPreviewItems([]);
    try {
      const res = await api.previewFetchPrices({
        source_names: selectedSources,
        query: collectQuery || undefined,
        region: collectRegion || "",
        category: collectCategory || "",
      });
      setPreviewItems(res.items);
      if (res.total > 0) {
        message.success(`预览完成：找到 ${res.total} 条价格（耗时 ${res.duration_s}s）`);
      } else {
        message.info("未找到匹配的价格数据");
      }
    } catch (err) {
      message.error(err instanceof Error ? err.message : "预览失败");
    } finally {
      setPreviewing(false);
    }
  };

  const sourceColumns = [
    {
      title: "采集源",
      dataIndex: "source_name",
      width: 180,
      render: (value: string) => (
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className="source-dot" style={{ background: SOURCE_COLORS[value] ?? "#64748b" }} />
          {SOURCE_LABELS[value] ?? value}
        </span>
      ),
    },
    { title: "显示名", dataIndex: "display_name" },
    {
      title: "状态",
      dataIndex: "available",
      width: 100,
      render: (v: boolean) => <Tag color={v ? "green" : "red"}>{v ? "可用" : "不可用"}</Tag>,
    },
    { title: "已抓取", dataIndex: "total_prices_fetched", width: 100, align: "right" as const },
    { title: "最近成功", dataIndex: "last_success_at", width: 180, render: (v: string | null) => v || "-" },
    { title: "错误", dataIndex: "error", render: (v: string | null) => v || "-" },
  ];

  const healthColumns = [
    {
      title: "采集源",
      dataIndex: "source_name",
      width: 180,
      render: (value: string) => SOURCE_LABELS[value] ?? value,
    },
    { title: "显示名", dataIndex: "display_name" },
    {
      title: "在线状态",
      dataIndex: "available",
      width: 120,
      render: (v: boolean) => (
        <Badge status={v ? "success" : "error"} text={v ? "在线" : "离线"} />
      ),
    },
    {
      title: "延迟",
      dataIndex: "latency_ms",
      width: 100,
      align: "right" as const,
      render: (v: number) => v > 0 ? `${v}ms` : "-",
    },
    { title: "错误", dataIndex: "error", render: (v: string | null) => v || "-" },
  ];

  const previewColumns = [
    { title: "名称", dataIndex: "name", ellipsis: true },
    { title: "规格", dataIndex: "spec", ellipsis: true, width: 200 },
    { title: "单位", dataIndex: "unit", width: 70 },
    { title: "单价", dataIndex: "unit_price", width: 120, align: "right" as const, render: (v: number) => `¥${Number(v ?? 0).toFixed(2)}` },
    { title: "地区", dataIndex: "region", width: 100 },
    {
      title: "来源",
      dataIndex: "source",
      width: 140,
      render: (v: string) => <Tag color={SOURCE_COLORS[v] ?? "default"}>{SOURCE_LABELS[v] ?? v}</Tag>,
    },
    { title: "生效日期", dataIndex: "effective_date", width: 120 },
  ];

  return (
    <div className="page-container">
      {lastFetchError && (
        <Alert
          type="warning"
          showIcon
          message="市场价在线采集未完成"
          description={
            <span>
              系统已保留本地价格库继续计价。错误信息：{lastFetchError}
              <Button size="small" style={{ marginLeft: 12 }} onClick={() => setOpen(true)}>手工补价</Button>
            </span>
          }
        />
      )}

      {/* KPI 指标卡 */}
      <div className="kpi-grid">
        <div className="kpi-card">
          <span className="material-symbols-outlined kpi-card-icon">receipt_long</span>
          <div className="kpi-card-body">
            <span className="kpi-card-label">当前价格记录</span>
            <span className="kpi-card-value">{animTotal}<span className="kpi-card-suffix">条</span></span>
          </div>
        </div>
        <div className="kpi-card">
          <span className="material-symbols-outlined kpi-card-icon">trending_up</span>
          <div className="kpi-card-body">
            <span className="kpi-card-label">平均单价</span>
            <span className="kpi-card-value">¥{animAvg.toFixed(2)}</span>
          </div>
        </div>
        <div className="kpi-card">
          <span className="material-symbols-outlined kpi-card-icon">cloud</span>
          <div className="kpi-card-body">
            <span className="kpi-card-label">可用价格源</span>
            <span className="kpi-card-value">{animSources}<span className="kpi-card-suffix">/{sources.length || 0}</span></span>
          </div>
        </div>
        <div className="kpi-card">
          <span className="material-symbols-outlined kpi-card-icon">event</span>
          <div className="kpi-card-body">
            <span className="kpi-card-label">最近价格日期</span>
            <span className="kpi-card-value">{overview.latestDate}</span>
          </div>
        </div>
      </div>

      <Tabs
        items={[
          {
            key: "collect",
            label: <span><GlobalOutlined /> 联网采集</span>,
            children: (
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                {/* 采集配置面板 */}
                <div className="content-card">
                  <div className="content-card-head">
                    <h3 className="content-card-title"><span className="material-symbols-outlined">tune</span>采集配置</h3>
                  </div>
                  <div className="content-card-body">
                    <div className="collect-config-grid">
                      <div className="collect-config-item">
                        <label>关键词</label>
                        <Input
                          placeholder="如：螺纹钢、水泥、混凝土"
                          value={collectQuery}
                          onChange={(e) => setCollectQuery(e.target.value)}
                          style={{ width: "100%" }}
                        />
                      </div>
                      <div className="collect-config-item">
                        <label>地区</label>
                        <Input
                          placeholder="如：华东、华南"
                          value={collectRegion}
                          onChange={(e) => setCollectRegion(e.target.value)}
                          style={{ width: "100%" }}
                        />
                      </div>
                      <div className="collect-config-item">
                        <label>材料类别</label>
                        <Select
                          allowClear
                          placeholder="选择类别"
                          value={collectCategory}
                          onChange={setCollectCategory}
                          options={CATEGORIES.map((c) => ({ value: c, label: c }))}
                          style={{ width: "100%" }}
                        />
                      </div>
                    </div>

                    {/* 采集源选择 */}
                    <div className="collect-sources-section">
                      <div className="collect-sources-head">
                        <span className="collect-sources-title">采集源</span>
                        <Checkbox.Group
                          value={selectedSources}
                          onChange={(values) => setSelectedSources(values as string[])}
                          options={sources.map((s) => ({
                            label: SOURCE_LABELS[s.source_name] ?? s.source_name,
                            value: s.source_name,
                          }))}
                          className="collect-sources-checkbox"
                        />
                      </div>
                    </div>

                    <div className="collect-actions">
                      <Button
                        icon={<EyeOutlined />}
                        loading={previewing}
                        onClick={previewFetch}
                      >
                        预览结果
                      </Button>
                      <Button
                        type="primary"
                        icon={<CloudSyncOutlined />}
                        loading={fetching}
                        onClick={fetchPrices}
                      >
                        开始采集
                      </Button>
                    </div>
                  </div>
                </div>

                {/* 采集进度 */}
                {fetching && (
                  <div className="content-card">
                    <div className="content-card-body">
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                        <span style={{ color: "#94a3b8", fontSize: 13 }}>正在采集... {fetchProgress}%</span>
                        <Badge status="processing" text={`${fetchResults.length}/${selectedSources.length} 源已完成`} />
                      </div>
                      <Progress percent={fetchProgress} status="active" showInfo={false} strokeColor={{ from: "#38bdf8", to: "#3b82f6" }} />
                    </div>
                  </div>
                )}

                {/* 采集结果（按源分组） */}
                {fetchResults.length > 0 && (
                  <div className="content-card">
                    <div className="content-card-head">
                      <h3 className="content-card-title"><span className="material-symbols-outlined">assessment</span>采集结果</h3>
                    </div>
                    <div className="content-card-body flush">
                      <Table
                        rowKey="source_name"
                        size="small"
                        dataSource={fetchResults}
                        pagination={false}
                        columns={[
                          {
                            title: "采集源",
                            dataIndex: "source_name",
                            width: 180,
                            render: (value: string) => (
                              <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                <span className="source-dot" style={{ background: SOURCE_COLORS[value] ?? "#64748b" }} />
                                {SOURCE_LABELS[value] ?? value}
                              </span>
                            ),
                          },
                          {
                            title: "抓取条数",
                            dataIndex: "fetched",
                            width: 100,
                            align: "right",
                            render: (v: number) => <strong style={{ color: v > 0 ? "#34d399" : "#64748b" }}>{v}</strong>,
                          },
                          {
                            title: "新增/更新",
                            dataIndex: "new_or_updated",
                            width: 110,
                            align: "right",
                            render: (v: number) => <strong style={{ color: v > 0 ? "#38bdf8" : "#64748b" }}>{v}</strong>,
                          },
                          {
                            title: "耗时",
                            dataIndex: "duration_s",
                            width: 90,
                            align: "right",
                            render: (v: number) => `${v}s`,
                          },
                          {
                            title: "状态",
                            width: 200,
                            render: (_: unknown, row: FetchResult) => {
                              if (row.error) return <Tooltip title={row.error}><Tag color="red">失败</Tag></Tooltip>;
                              if (row.fetched > 0) return <Tag color="green">成功</Tag>;
                              return <Tag color="orange">无数据</Tag>;
                            },
                          },
                        ]}
                      />
                    </div>
                  </div>
                )}

                {/* 预览结果 */}
                {previewItems.length > 0 && (
                  <div className="content-card">
                    <div className="content-card-head">
                      <h3 className="content-card-title"><span className="material-symbols-outlined">preview</span>预览结果（{previewItems.length} 条）</h3>
                    </div>
                    <div className="content-card-body flush">
                      <Table
                        rowKey={(row) => `${row.name}-${row.spec}-${row.region}-${row.source}`}
                        size="small"
                        dataSource={previewItems}
                        pagination={{ pageSize: 10, showSizeChanger: true }}
                        columns={previewColumns}
                      />
                    </div>
                  </div>
                )}
              </div>
            ),
          },
          {
            key: "prices",
            label: "价格库",
            children: (
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                {/* 筛选栏 */}
                <div className="filter-bar">
                  <Input placeholder="地区" value={region} onChange={(e) => setRegion(e.target.value)} style={{ width: 140 }} />
                  <Input placeholder="名称" value={name} onChange={(e) => setName(e.target.value)} style={{ width: 220 }} />
                  <Select value={latestOnly ? "latest" : "all"} onChange={(value) => setLatestOnly(value === "latest")} options={[{ value: "latest", label: "仅最新" }, { value: "all", label: "全部版本" }]} style={{ width: 120 }} />
                  <Button icon={<PlusOutlined />} onClick={() => setOpen(true)}>手工补价</Button>
                  <Button icon={<ReloadOutlined />} loading={loading} onClick={load}>查询</Button>
                </div>
                {/* 价格表格 */}
                <div className="content-card">
                  <div className="content-card-body flush">
                    <Table
                      rowKey="id"
                      loading={loading}
                      dataSource={materials}
                      pagination={{ pageSize: 20, showSizeChanger: true, showTotal: (total) => `共 ${total} 条` }}
                      locale={{
                        emptyText: (
                          <Empty description="暂无材料市场价。可联网采集，也可手工补录关键材料价。">
                            <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
                              <Button type="primary" loading={fetching} onClick={fetchPrices}>联网采集</Button>
                              <Button onClick={() => setOpen(true)}>手工补价</Button>
                            </div>
                          </Empty>
                        ),
                      }}
                      columns={[
                        { title: "编码", dataIndex: "code", width: 120 },
                        { title: "名称", dataIndex: "name" },
                        { title: "规格", dataIndex: "spec", ellipsis: true },
                        { title: "单位", dataIndex: "unit", width: 80 },
                        { title: "单价", dataIndex: "unit_price", width: 120, render: (v: number) => `¥${Number(v ?? 0).toFixed(2)}` },
                        {
                          title: "涨跌",
                          width: 110,
                          render: (_: unknown, row: MaterialPrice) => {
                            const { rate } = pseudoTrend(row.id, Number(row.unit_price ?? 0));
                            const up = rate >= 0;
                            return (
                              <Tooltip title="示例涨跌幅（由价格ID估算），仅供参考；接入历史价格后将按真实环比计算">
                                <Tag color={up ? "red" : "green"} style={{ display: "flex", alignItems: "center", gap: 4, width: "fit-content" }}>
                                  {up ? <RiseOutlined /> : <FallOutlined />}
                                  <span>{`${(Math.abs(rate) * 100).toFixed(2)}%`}</span>
                                </Tag>
                              </Tooltip>
                            );
                          },
                        },
                        { title: "地区", dataIndex: "region", width: 100 },
                        { title: "来源", dataIndex: "source", width: 140, render: (v: string) => <Tag color={SOURCE_COLORS[v] ?? "default"}>{SOURCE_LABELS[v] ?? v}</Tag> },
                        { title: "生效日期", dataIndex: "effective_date", width: 130 },
                      ]}
                    />
                  </div>
                </div>
              </div>
            ),
          },
          {
            key: "sources",
            label: <span><WifiOutlined /> 采集源</span>,
            children: (
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <div className="filter-bar">
                  <Button icon={<ReloadOutlined />} loading={checkingHealth} onClick={checkHealth}>检测在线状态</Button>
                </div>
                {/* 采集源信息 */}
                <div className="content-card">
                  <div className="content-card-head">
                    <h3 className="content-card-title"><span className="material-symbols-outlined">cloud_sync</span>采集源列表</h3>
                  </div>
                  <div className="content-card-body flush">
                    <Table
                      rowKey="source_name"
                      size="small"
                      dataSource={sources}
                      pagination={false}
                      columns={sourceColumns}
                    />
                  </div>
                </div>
                {/* 实时健康状态 */}
                {healthList.length > 0 && (
                  <div className="content-card">
                    <div className="content-card-head">
                      <h3 className="content-card-title"><span className="material-symbols-outlined">network_check</span>实时健康检测</h3>
                    </div>
                    <div className="content-card-body flush">
                      <Table
                        rowKey="source_name"
                        size="small"
                        dataSource={healthList}
                        pagination={false}
                        columns={healthColumns}
                      />
                    </div>
                  </div>
                )}
              </div>
            ),
          },
        ]}
      />

      <Modal title="新增材料价格" open={open} onCancel={() => setOpen(false)} onOk={create} width={720}>
        <Form form={form} layout="vertical">
          <div style={{ display: "flex", flexDirection: "column", gap: 8, width: "100%" }}>
            <Form.Item name="code" label="编码" rules={[{ required: true }]}><Input /></Form.Item>
            <Form.Item name="name" label="名称" rules={[{ required: true }]}><Input /></Form.Item>
            <Form.Item name="spec" label="规格"><Input /></Form.Item>
            <Form.Item name="unit" label="单位" rules={[{ required: true }]}><Input /></Form.Item>
            <Form.Item name="unit_price" label="单价" rules={[{ required: true }]}><InputNumber min={0} style={{ width: "100%" }} /></Form.Item>
            <Form.Item name="region" label="地区"><Input /></Form.Item>
            <Form.Item name="effective_date" label="生效日期"><Input placeholder="YYYY-MM-DD" /></Form.Item>
          </div>
        </Form>
      </Modal>
    </div>
  );
}
