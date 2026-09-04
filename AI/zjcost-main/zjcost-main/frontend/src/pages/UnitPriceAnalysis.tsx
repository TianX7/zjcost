import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button, Empty, InputNumber, Segmented, Select, Spin, Table, Tag, message } from "antd";
import type { BindingRef, BoqItem, CalcProvenance, Project } from "../api";
import { api } from "../api";
import PageHeader from "../components/PageHeader";

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
    () => Object.entries(provenance?.fee_config_snapshot ?? {}),
    [provenance],
  );

  // 直接费合计占含税合计的比例
  const bindDirectPercent = useMemo(() => {
    const total = Number(provenance?.calc_breakdown?.total) || 0;
    return total > 0 ? Math.round((bindingsTotal / total) * 100) : 0;
  }, [provenance, bindingsTotal]);

  return (
    <div className="page-container">
      <PageHeader
        icon="analytics"
        title="综合单价分析"
        subtitle="查看清单综合单价来源、定额组成和建议。"
        actions={
          <Button onClick={() => navigate(selectedProjectId ? `/projects/${selectedProjectId}` : "/projects")}>返回项目</Button>
        }
      />

      {/* 筛选栏：项目选择、清单选择、刷新按钮 */}
      <div className="filter-bar">
        <Select
          placeholder="选择项目"
          value={selectedProjectId}
          onChange={(value) => {
            setSelectedProjectId(value);
            setSelectedBoqItemId(undefined);
          }}
          options={projects.map((project) => ({ value: project.id, label: project.name }))}
          style={{ minWidth: 260 }}
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
          style={{ minWidth: 360 }}
          showSearch
          optionFilterProp="label"
        />
        <Button onClick={load} loading={loading} disabled={!selectedBoqItemId}>刷新分析</Button>
      </div>

      {!selectedBoqItemId ? (
        <div className="content-card">
          <div className="content-card-body">
            <Empty description="请选择项目和清单项" />
          </div>
        </div>
      ) : loading && !provenance ? (
        <div className="content-card">
          <div className="content-card-body" style={{ textAlign: "center", padding: "48px 0" }}>
            <Spin tip="正在加载单价分析..." />
          </div>
        </div>
      ) : (
        <>
          {/* 清单信息 */}
          <div className="content-card">
            <div className="content-card-head">
              <h3 className="content-card-title"><span className="material-symbols-outlined">description</span>清单信息</h3>
            </div>
            <div className="content-card-body">
              <div className="stat-row">
                <div className="stat-item">
                  <span className="stat-item-label">清单编码</span>
                  <span className="stat-item-value">{provenance?.boq_code ?? "-"}</span>
                </div>
                <div className="stat-item">
                  <span className="stat-item-label">清单名称</span>
                  <span className="stat-item-value">{provenance?.boq_name ?? "-"}</span>
                </div>
                <div className="stat-item">
                  <span className="stat-item-label">单位</span>
                  <span className="stat-item-value">{provenance?.boq_unit ?? "-"}</span>
                </div>
                <div className="stat-item">
                  <span className="stat-item-label">工程量</span>
                  <span className="stat-item-value">{provenance?.boq_quantity ?? "-"}</span>
                </div>
                <div className="stat-item">
                  <span className="stat-item-label">综合单价</span>
                  <span className="stat-item-value accent">{money(provenance?.unit_price)}</span>
                </div>
                <div className="stat-item">
                  <span className="stat-item-label">合价</span>
                  <span className="stat-item-value accent">{money(provenance?.calc_total)}</span>
                </div>
                <div className="stat-item">
                  <span className="stat-item-label">人工价</span>
                  <span className="stat-item-value">{money(provenance?.price_snapshot?.labor_price)}</span>
                </div>
                <div className="stat-item">
                  <span className="stat-item-label">材料价</span>
                  <span className="stat-item-value">{money(provenance?.price_snapshot?.material_price)}</span>
                </div>
                <div className="stat-item">
                  <span className="stat-item-label">机械价</span>
                  <span className="stat-item-value">{money(provenance?.price_snapshot?.machine_price)}</span>
                </div>
              </div>
            </div>
          </div>

            {/* 荒漠调价系数 */}
            {(provenance?.bindings.length ?? 0) > 0 && (
              <div className="content-card">
                <div className="content-card-head">
                  <h3 className="content-card-title"><span className="material-symbols-outlined">tune</span>荒漠调价系数</h3>
                  <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                    按项目所在地套用，作用于全部定额绑定，综合单价与费用构成即时联动
                  </span>
                </div>
                <div className="content-card-body">
                  <div style={{ display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap" }}>
                    <div style={{ display: "flex", alignItems: "flex-end", gap: 10 }}>
                      <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>当前调价系数</span>
                      <strong style={{ fontSize: 30, color: "#2dd4bf" }}>×{currentCoeff.toFixed(2)}</strong>
                    </div>
                    <Segmented
                      value={pendingCoeff}
                      onChange={(value) => setPendingCoeff(Number(value))}
                      options={[
                        { label: "标准区 ×1.00", value: 1.0 },
                        { label: "荒漠区 ×1.15", value: 1.15 },
                      ]}
                    />
                    <InputNumber
                      min={0.1}
                      max={10}
                      step={0.05}
                      value={pendingCoeff}
                      onChange={(value) => setPendingCoeff(Number(value ?? 1))}
                      style={{ width: 110 }}
                      addonBefore="自定义"
                    />
                    <Button type="primary" loading={applyingCoeff} onClick={applyCoefficient}>
                      应用调价系数
                    </Button>
                  </div>
                  <p style={{ margin: "10px 0 0", fontSize: 12, color: "var(--text-secondary)" }}>
                    荒漠区说明：平均运距 180km、技工日单价高 35%、风沙气候致机械台班利用率下降，叠加荒漠调价系数 ×1.15。
                  </p>
                </div>
              </div>
            )}

            {/* 费用构成 */}
            {feeParts.length > 0 && (
              <div className="content-card">
                <div className="content-card-head">
                  <h3 className="content-card-title"><span className="material-symbols-outlined">donut_small</span>费用构成</h3>
                  <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>含税合计 {money(provenance?.calc_breakdown?.total)}</span>
                </div>
                <div className="content-card-body">
                  <div className="quota-price-distribution">
                    {feeParts.map((p) => (
                      <div key={p.label} className="quota-price-bar-row">
                        <span className="quota-price-bar-label">{p.label}</span>
                        <div className="quota-price-bar-track">
                          <div className="quota-price-bar-fill" style={{ width: `${p.percent}%`, background: `linear-gradient(90deg, ${p.color}, ${p.color}66)` }} />
                        </div>
                        <strong className="quota-price-bar-count">{money(p.value)}</strong>
                      </div>
                    ))}
                  </div>
                  {feeConfigEntries.length > 0 && (
                    <div className="unit-fee-rates">
                      {feeConfigEntries.map(([key, value]) => (
                        <span key={key} className="unit-fee-rate">
                          {FEE_RATE_LABELS[key] ?? key} {(Number(value) * 100).toFixed(2)}%
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* 定额绑定 */}
            <div className="content-card">
              <div className="content-card-head">
                <h3 className="content-card-title"><span className="material-symbols-outlined">link</span>定额绑定（{provenance?.bindings.length ?? 0} 项）</h3>
                <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                  {provenance?.calc_breakdown ? `直接费占含税合计 ${bindDirectPercent}%` : "尚未计价，暂无占比"}
                </span>
              </div>
              <div className="content-card-body flush">
                <Table
                  rowKey="binding_id"
                  loading={loading}
                  dataSource={provenance?.bindings ?? []}
                  pagination={false}
                  scroll={{ x: 1120 }}
                  summary={() =>
                    (provenance?.bindings.length ?? 0) > 0 ? (
                      <Table.Summary.Row>
                        <Table.Summary.Cell index={0} colSpan={5}><strong>合计</strong></Table.Summary.Cell>
                        <Table.Summary.Cell index={5}><strong>{money(bindingsTotal)}</strong></Table.Summary.Cell>
                        <Table.Summary.Cell index={6}><strong>{bindDirectPercent}%</strong></Table.Summary.Cell>
                      </Table.Summary.Row>
                    ) : null
                  }
                  locale={{
                    emptyText: (
                      <Empty description="该清单暂未绑定定额，无法计算综合单价。请在项目工作台的「定额绑定」中补充绑定后重新计价。">
                        {selectedProjectId && (
                          <Button type="primary" onClick={() => navigate(`/projects/${selectedProjectId}`)}>打开项目工作台</Button>
                        )}
                      </Empty>
                    ),
                  }}
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
            </div>

          {/* 计算说明 */}
          <div className="content-card">
            <div className="content-card-head">
              <h3 className="content-card-title"><span className="material-symbols-outlined">info</span>计算说明</h3>
            </div>
            <div className="content-card-body">
              <p style={{ margin: 0 }}>{provenance?.explanation ?? "暂无说明"}</p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
