import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button, InputNumber, Segmented, Select, Spin, Table, Tag, message } from "antd";
import type { BindingRef, BoqItem, CalcProvenance, Project } from "../api";
import { api } from "../api";
import Panel from "../components/Panel";
import "../styles/resource-screen.css";
import "../styles/business-screen.css";
import { DownloadOutlined } from "@ant-design/icons";

function asFiniteNumber(value: string | undefined) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function money(value: number | null | undefined) {
  return `¥${Number(value ?? 0).toFixed(2)}`;
}

function num2(value: number | null | undefined) {
  return Number(value ?? 0).toFixed(2);
}

// 费率快照字段中文名
const FEE_RATE_LABELS: Record<string, string> = {
  management_rate: "管理费率",
  profit_rate: "利润费率",
  regulatory_rate: "规费费率",
  tax_rate: "增值税率",
};

export default function UnitPriceAnalysis() {
  const { projectId, boqItemId } = useParams<{ projectId: string; boqItemId: string }>();
  const navigate = useNavigate();
  const [projects, setProjects] = useState<Project[]>([]);
  const [boqItems, setBoqItems] = useState<BoqItem[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<number | undefined>(asFiniteNumber(projectId));
  const [selectedBoqItemId, setSelectedBoqItemId] = useState<number | undefined>(asFiniteNumber(boqItemId));
  const [provenance, setProvenance] = useState<CalcProvenance | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingBoq, setLoadingBoq] = useState(false);

  useEffect(() => {
    const routeProjectId = asFiniteNumber(projectId);
    const routeBoqItemId = asFiniteNumber(boqItemId);
    if (routeProjectId) setSelectedProjectId(routeProjectId);
    if (routeBoqItemId) setSelectedBoqItemId(routeBoqItemId);
  }, [projectId, boqItemId]);

  useEffect(() => {
    api.listProjects({ page_size: 100, sort_by: "updated_at", sort_order: "desc" })
      .then((data) => {
        setProjects(data.items);
        setSelectedProjectId((current) => current ?? data.items[0]?.id);
      })
      .catch((err) => message.error(err instanceof Error ? err.message : "加载项目失败"));
  }, []);

  useEffect(() => {
    if (!selectedProjectId) {
      setBoqItems([]);
      return;
    }
    setLoadingBoq(true);
    api.listBoqItems(selectedProjectId)
      .then((items) => {
        setBoqItems(items);
        setSelectedBoqItemId((current) => {
          if (current && items.some((item) => item.id === current)) return current;
          return items[0]?.id;
        });
      })
      .catch((err) => {
        setBoqItems([]);
        message.error(err instanceof Error ? err.message : "加载清单失败");
      })
      .finally(() => setLoadingBoq(false));
  }, [selectedProjectId]);

  const load = useCallback(async () => {
    if (!selectedBoqItemId) {
      setProvenance(null);
      return;
    }
    setLoading(true);
    try {
      setProvenance(await api.getProvenance(selectedBoqItemId));
    } catch (err) {
      setProvenance(null);
      message.error(err instanceof Error ? err.message : "加载单价分析失败");
    } finally {
      setLoading(false);
    }
  }, [selectedBoqItemId]);

  useEffect(() => {
    void load();
  }, [load]);

  // 绑定直接费合计（与综合单价交叉核对）
  const bindingsTotal = useMemo(
    () => (provenance?.bindings ?? []).reduce((sum, b) => sum + Number(b.direct_cost ?? 0), 0),
    [provenance],
  );

  // ── 荒漠调价系数：按项目所在地套用，综合单价与费用构成即时联动 ──
  const exportReport = () => {
    if (!provenance) return;
    const bd = provenance.calc_breakdown;
    const rows: string[] = [];
    const push = (cells: Array<string | number>) => rows.push(cells.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","));

    push(["清单综合单价分析报告"]);
    push([]);
    push(["清单编码", "清单名称", "单位", "工程量", "综合单价(元)", "合价(元)"]);
    push([provenance.boq_code ?? "", provenance.boq_name ?? "", provenance.boq_unit ?? "", provenance.boq_quantity ?? "", num2(provenance.unit_price), num2(provenance.calc_total)]);
    push([]);
    push(["人工价(元)", "材料价(元)", "机械价(元)", "调价系数", "", ""]);
    push([
      num2(provenance.price_snapshot?.labor_price),
      num2(provenance.price_snapshot?.material_price),
      num2(provenance.price_snapshot?.machine_price),
      num2(currentCoeff),
      "", "",
    ]);
    push([]);
    push(["费用构成", "金额(元)", "含税合计(元): " + num2(bd?.total), "", "", ""]);
    if (bd) {
      push(["直接费", num2(bd.direct_cost), "", "", "", ""]);
      push(["管理费", num2(bd.management_fee), "", "", "", ""]);
      push(["利润", num2(bd.profit), "", "", "", ""]);
      push(["规费", num2(bd.regulatory_fee), "", "", "", ""]);
      push(["税金", num2(bd.tax), "", "", "", ""]);
    }
    push([]);
    push(["定额编码", "定额名称", "定额单位", "人工", "材料", "机械", "系数", "直接费(元)"]);
    (provenance.bindings ?? []).forEach((b: BindingRef) => {
      push([b.quota.quota_code, b.quota.quota_name, b.quota.unit, num2(b.quota.labor_qty), num2(b.quota.material_qty), num2(b.quota.machine_qty), num2(b.coefficient), b.direct_cost == null ? "" : num2(b.direct_cost)]);
    });
    if (bd) push(["合计", "", "", "", "", "", "", num2(bindingsTotal)]);
    push([]);
    push(["计算说明"]);
    push([provenance.explanation ?? ""]);

    const blob = new Blob(["\uFEFF" + rows.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `单价分析_${provenance.boq_code ?? "清单"}_${provenance.boq_name ?? ""}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    message.success("单价分析报告已导出");
  };

  const currentCoeff = useMemo(
    () => Number(provenance?.bindings?.[0]?.coefficient ?? 1),
    [provenance],
  );
  const [pendingCoeff, setPendingCoeff] = useState<number>(1);
  const [applyingCoeff, setApplyingCoeff] = useState(false);
  useEffect(() => {
    setPendingCoeff(currentCoeff);
  }, [currentCoeff]);

  const applyCoefficient = async () => {
    if (!selectedBoqItemId) return;
    setApplyingCoeff(true);
    try {
      await api.setBindingsCoefficient(selectedBoqItemId, Number(pendingCoeff));
      message.success(`已应用调价系数 ×${Number(pendingCoeff).toFixed(2)}，综合单价已更新`);
      await load();
    } catch (err) {
      message.error(err instanceof Error ? err.message : "应用调价系数失败");
    } finally {
      setApplyingCoeff(false);
    }
  };

  // 费用构成条目（直接费/管理费/利润/规费/税金）
  const feeParts = useMemo(() => {
    const bd = provenance?.calc_breakdown;
    if (!bd) return [];
    const total = Number(bd.total) || 0;
    const rows = [
      { label: "直接费", value: bd.direct_cost, color: "#38bdf8" },
      { label: "管理费", value: bd.management_fee, color: "#a78bfa" },
      { label: "利润", value: bd.profit, color: "#34d399" },
      { label: "规费", value: bd.regulatory_fee, color: "#facc15" },
      { label: "税金", value: bd.tax, color: "#fb7185" },
    ];
    return rows.map((r) => ({
      ...r,
      percent: total > 0 ? Math.round((Number(r.value ?? 0) / total) * 100) : 0,
    }));
  }, [provenance]);

  const feeConfigEntries = useMemo(
    () =>
      Object.entries(provenance?.fee_config_snapshot ?? {}).filter(([, value]) =>
        Number.isFinite(Number(value)),
      ),
    [provenance],
  );

  // 直接费合计占含税合计的比例
  const bindDirectPercent = useMemo(() => {
    const total = Number(provenance?.calc_breakdown?.total) || 0;
    return total > 0 ? Math.round((bindingsTotal / total) * 100) : 0;
  }, [provenance, bindingsTotal]);

  return (
    <div className="page-container res-page upa-page">
      {/* 摘要指标带：单价构成关键数值（压缩为单行 56px） */}
      <div className="screen-metrics upa-metrics">
        <div className="screen-metric">
          <span className="material-symbols-outlined screen-metric-icon">payments</span>
          <div className="screen-metric-body">
            <span className="screen-metric-label">综合单价</span>
            <span className="screen-metric-value">{money(provenance?.unit_price)}</span>
          </div>
        </div>
        <div className="screen-metric">
          <span className="material-symbols-outlined screen-metric-icon">summarize</span>
          <div className="screen-metric-body">
            <span className="screen-metric-label">合价</span>
            <span className="screen-metric-value">{money(provenance?.calc_total)}</span>
          </div>
        </div>
        <div className="screen-metric">
          <span className="material-symbols-outlined screen-metric-icon">percent</span>
          <div className="screen-metric-body">
            <span className="screen-metric-label">直接费占比</span>
            <span className="screen-metric-value">
              {bindDirectPercent}
              <span className="screen-metric-unit">%</span>
            </span>
          </div>
        </div>
        <div className="screen-metric is-amber">
          <span className="material-symbols-outlined screen-metric-icon">tune</span>
          <div className="screen-metric-body">
            <span className="screen-metric-label">调价系数</span>
            <span className="screen-metric-value">×{currentCoeff.toFixed(2)}</span>
          </div>
        </div>
        <div className="screen-metric">
          <span className="material-symbols-outlined screen-metric-icon">receipt_long</span>
          <div className="screen-metric-body">
            <span className="screen-metric-label">含税合计</span>
            <span className="screen-metric-value">{money(provenance?.calc_breakdown?.total)}</span>
          </div>
        </div>
      </div>

      {/* 单行筛选条：项目、清单、刷新与导出（40px） */}
      <div className="upa-toolbar">
        <Select
          placeholder="选择项目"
          value={selectedProjectId}
          onChange={(value) => {
            setSelectedProjectId(value);
            setSelectedBoqItemId(undefined);
          }}
          options={projects.map((project) => ({ value: project.id, label: project.name }))}
          style={{ width: 230 }}
          showSearch
          optionFilterProp="label"
        />
        <Select
          placeholder="选择清单项"
          value={selectedBoqItemId}
          loading={loadingBoq}
          disabled={!selectedProjectId}
          onChange={setSelectedBoqItemId}
          options={boqItems.map((item) => ({ value: item.id, label: `${item.code} ${item.name}` }))}
          style={{ flex: "1 1 320px", minWidth: 180, maxWidth: 460 }}
          showSearch
          optionFilterProp="label"
        />
        <Button onClick={load} loading={loading} disabled={!selectedBoqItemId}>刷新分析</Button>
        <span className="upa-toolbar-spacer" />
        <Button icon={<DownloadOutlined />} disabled={!provenance} onClick={exportReport}>导出报告</Button>
        <Button onClick={() => navigate(selectedProjectId ? `/projects/${selectedProjectId}` : "/projects")}>返回项目</Button>
      </div>

      {!selectedBoqItemId ? (
        <div className="upa-body">
          <div className="upa-placeholder">
            <span className="material-symbols-outlined">analytics</span>
            <strong>请选择项目和清单项</strong>
            <p>选择清单后展示综合单价构成与定额绑定明细</p>
          </div>
        </div>
      ) : loading && !provenance ? (
        <div className="upa-body">
          <div className="upa-placeholder">
            <Spin tip="正在加载单价分析..." />
          </div>
        </div>
      ) : (
        <div className="upa-body">
          {/* 清单信息：指标行 + 摘要行 */}
          <Panel title="清单信息" icon="description" className="upa-panel upa-panel-info">
            <div className="upa-info-main">
              <div className="upa-info-fields">
                <div className="upa-field">
                  <span className="upa-field-label">清单编码</span>
                  <b className="upa-field-value num">{provenance?.boq_code ?? "-"}</b>
                </div>
                <div className="upa-field is-grow">
                  <span className="upa-field-label">清单名称</span>
                  <b className="upa-field-value" title={provenance?.boq_name ?? ""}>{provenance?.boq_name ?? "-"}</b>
                </div>
                <div className="upa-field">
                  <span className="upa-field-label">单位</span>
                  <b className="upa-field-value">{provenance?.boq_unit ?? "-"}</b>
                </div>
                <div className="upa-field">
                  <span className="upa-field-label">工程量</span>
                  <b className="upa-field-value num">{provenance?.boq_quantity ?? "-"}</b>
                </div>
                <div className="upa-field">
                  <span className="upa-field-label">综合单价</span>
                  <b className="upa-field-value num is-accent">{money(provenance?.unit_price)}</b>
                </div>
                <div className="upa-field">
                  <span className="upa-field-label">人工价</span>
                  <b className="upa-field-value num">{money(provenance?.price_snapshot?.labor_price)}</b>
                </div>
                <div className="upa-field">
                  <span className="upa-field-label">材料价</span>
                  <b className="upa-field-value num">{money(provenance?.price_snapshot?.material_price)}</b>
                </div>
                <div className="upa-field">
                  <span className="upa-field-label">机械价</span>
                  <b className="upa-field-value num">{money(provenance?.price_snapshot?.machine_price)}</b>
                </div>
              </div>
              <div className="upa-info-total">
                <div className="upa-field">
                  <span className="upa-field-label">合计</span>
                  <b className="upa-field-value num is-accent">{money(provenance?.calc_total)}</b>
                </div>
                <div className="upa-field">
                  <span className="upa-field-label">直接费占比</span>
                  <b className="upa-field-value num">{bindDirectPercent}%</b>
                </div>
              </div>
            </div>

            {/* 调价系数与费用构成：压成一行副信息 */}
            <div className="upa-info-sub">
              {(provenance?.bindings.length ?? 0) > 0 ? (
                <div className="upa-coeff">
                  <span
                    className="upa-coeff-label"
                    title="荒漠区说明：平均运距 180km、技工日单价高 35%、风沙气候致机械台班利用率下降，叠加荒漠调价系数 ×1.15。"
                  >
                    调价系数
                  </span>
                  <strong className="upa-coeff-value num">×{currentCoeff.toFixed(2)}</strong>
                  <Segmented
                    size="small"
                    value={pendingCoeff}
                    onChange={(value) => setPendingCoeff(Number(value))}
                    options={[
                      { label: "标准区 ×1.00", value: 1.0 },
                      { label: "荒漠区 ×1.15", value: 1.15 },
                    ]}
                  />
                  <InputNumber
                    size="small"
                    min={0.1}
                    max={10}
                    step={0.05}
                    value={pendingCoeff}
                    onChange={(value) => setPendingCoeff(Number(value ?? 1))}
                    style={{ width: 118 }}
                    addonBefore="自定义"
                  />
                  <Button size="small" type="primary" loading={applyingCoeff} onClick={applyCoefficient}>
                    应用调价系数
                  </Button>
                </div>
              ) : (
                <span className="upa-coeff-none">未绑定定额，调价系数不可用</span>
              )}
              <div className="upa-fees">
                {feeParts.map((p) => (
                  <span key={p.label} className="upa-fee-chip" title={`${p.label} ${money(p.value)}`}>
                    <i style={{ background: p.color }} />
                    {p.label}
                    <b>{p.percent}%</b>
                  </span>
                ))}
                {feeConfigEntries.map(([key, value]) => (
                  <span key={key} className="upa-fee-rate">
                    {FEE_RATE_LABELS[key] ?? key} {(Number(value) * 100).toFixed(2)}%
                  </span>
                ))}
              </div>
            </div>
          </Panel>

          {/* 定额绑定：占满剩余高度，表头吸顶、合计行贴底 */}
          <Panel
            title={`定额绑定（${provenance?.bindings.length ?? 0} 项）`}
            icon="link"
            className="upa-panel upa-panel-bindings"
            flush
            bodyClassName="upa-bindings-body"
            extra={
              <span>
                {provenance?.calc_breakdown ? `直接费占含税合计 ${bindDirectPercent}%` : "尚未计价，暂无占比"}
              </span>
            }
          >
            {!loading && (provenance?.bindings.length ?? 0) === 0 ? (
              <div className="upa-empty">
                <span className="material-symbols-outlined">link_off</span>
                <div className="upa-empty-text">
                  <strong>尚未绑定定额</strong>
                  <span>该清单暂未绑定定额，无法计算综合单价。请在项目工作台的「定额绑定」中补充绑定后重新计价。</span>
                </div>
                {selectedProjectId && (
                  <Button size="small" type="primary" onClick={() => navigate(`/projects/${selectedProjectId}`)}>打开项目工作台</Button>
                )}
              </div>
            ) : (
              <div className="upa-bindings-scroll">
                <Table
                  rowKey="binding_id"
                  loading={loading}
                  dataSource={provenance?.bindings ?? []}
                  pagination={false}
                  summary={() =>
                    (provenance?.bindings.length ?? 0) > 0 ? (
                      <Table.Summary.Row>
                        <Table.Summary.Cell index={0} colSpan={5}><strong>合计</strong></Table.Summary.Cell>
                        <Table.Summary.Cell index={5}><strong>{money(bindingsTotal)}</strong></Table.Summary.Cell>
                        <Table.Summary.Cell index={6}><strong>{bindDirectPercent}%</strong></Table.Summary.Cell>
                      </Table.Summary.Row>
                    ) : null
                  }
                  columns={[
                    { title: "定额编码", dataIndex: ["quota", "quota_code"], width: 140, render: (value: string) => <Tag color="blue">{value}</Tag> },
                    { title: "定额名称", dataIndex: ["quota", "quota_name"] },
                    { title: "定额单位", dataIndex: ["quota", "unit"], width: 90, render: (v: string) => v || "-" },
                    { title: "工料机", key: "resources", width: 240, render: (_: unknown, row: BindingRef) => (
                      <span style={{ display: "inline-flex", gap: 10, fontSize: 12, color: "var(--text-secondary)" }}>
                        <span style={{ color: "#38bdf8" }}>人工 {num2(row.quota.labor_qty)}</span>
                        <span style={{ color: "#34d399" }}>材料 {num2(row.quota.material_qty)}</span>
                        <span style={{ color: "#facc15" }}>机械 {num2(row.quota.machine_qty)}</span>
                      </span>
                    ) },
                    { title: "系数", dataIndex: "coefficient", width: 80, align: "right", render: (v: number) => num2(v) },
                    { title: "直接费", dataIndex: "direct_cost", width: 110, align: "right", render: (value: number | null) => value == null ? "-" : money(value) },
                    {
                      title: "占比",
                      key: "share",
                      width: 80,
                      align: "right",
                      render: (_: unknown, row: BindingRef) => {
                        const d = Number(row.direct_cost ?? 0);
                        return bindingsTotal > 0 ? `${Math.round((d / bindingsTotal) * 100)}%` : "-";
                      },
                    },
                  ]}
                />
              </div>
            )}
          </Panel>

          {/* 计算说明：贴底窄条 */}
          <div className="upa-explain">
            <span className="material-symbols-outlined upa-explain-icon">info</span>
            <span className="upa-explain-label">计算说明</span>
            <p className="upa-explain-text" title={provenance?.explanation ?? "暂无说明"}>
              {provenance?.explanation ?? "暂无说明"}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
