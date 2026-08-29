import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Empty, Modal, Segmented, Table, Tag, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import { DownloadOutlined, NodeIndexOutlined } from "@ant-design/icons";
import type { BoqItem, CalcProvenance, CalcSummary, LineCalcResult, Project } from "../api";
import { api } from "../api";

// 费用构成配色
const COST_COLORS: Record<string, string> = {
  direct: "#38bdf8",
  management: "#a78bfa",
  profit: "#facc15",
  regulatory: "#34d399",
  tax: "#fb7185",
  measures: "#f97316",
};

export default function PricingManagement() {
  const navigate = useNavigate();
  const [, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState<number | undefined>();
  const [summary, setSummary] = useState<CalcSummary | null>(null);
  const [boqItems, setBoqItems] = useState<BoqItem[]>([]);
  const [viewMode, setViewMode] = useState<"fees" | "gb">("fees");
  const [loading, setLoading] = useState(false);
  const [calculating, setCalculating] = useState(false);
  const [provenance, setProvenance] = useState<CalcProvenance | null>(null);
  const [provenanceOpen, setProvenanceOpen] = useState(false);
  const [provenanceLoading, setProvenanceLoading] = useState(false);

  const loadProjects = useCallback(async () => {
    const res = await api.listProjects({ page_size: 100 });
    setProjects(res.items);
    setProjectId((current) => current ?? res.items[0]?.id);
  }, []);

  const loadSummary = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const [sum, items] = await Promise.all([
        api.getCalcSummary(projectId).catch(() => null),
        api.listBoqItems(projectId).catch(() => [] as BoqItem[]),
      ]);
      setSummary(sum);
      setBoqItems(items);
    } catch {
      setSummary(null);
      setBoqItems([]);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { void loadProjects(); }, [loadProjects]);
  useEffect(() => { void loadSummary(); }, [loadSummary]);

  // 明细统计
  const lineStats = useMemo(() => {
    const lines = summary?.line_results ?? [];
    if (lines.length === 0) return { count: 0, maxItem: null as LineCalcResult | null, minItem: null as LineCalcResult | null, avg: 0 };
    const sorted = [...lines].sort((a, b) => b.total - a.total);
    const avg = lines.reduce((sum, line) => sum + line.total, 0) / lines.length;
    return { count: lines.length, maxItem: sorted[0], minItem: sorted[sorted.length - 1], avg };
  }, [summary]);

  const calculate = async () => {
    if (!projectId) return;
    setCalculating(true);
    try {
      const res = await api.calculate(projectId);
      setSummary(res);
      message.success("计价完成");
    } catch (err) {
      message.error(err instanceof Error ? err.message : "计价失败");
    } finally {
      setCalculating(false);
    }
  };

  const showProvenance = async (boqItemId: number) => {
    setProvenanceOpen(true);
    setProvenanceLoading(true);
    setProvenance(null);
    try {
      const data = await api.getProvenance(boqItemId);
      setProvenance(data);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "加载溯源失败");
    } finally {
      setProvenanceLoading(false);
    }
  };

  // 格式化金额
  const fmt = (v: number | undefined | null) => `¥${Number(v ?? 0).toFixed(2)}`;
  const fmtNum = (v: number | undefined | null, digits = 2) => Number(v ?? 0).toFixed(digits);

  const columns: ColumnsType<LineCalcResult> = [
    { title: "编码", dataIndex: "boq_code", width: 130, fixed: "left" },
    { title: "名称", dataIndex: "boq_name", ellipsis: true },
    {
      title: "直接费",
      dataIndex: "direct_cost",
      width: 120,
      align: "right",
      sorter: (a, b) => a.direct_cost - b.direct_cost,
      render: (v: number) => <span style={{ color: COST_COLORS.direct }}>{fmt(v)}</span>,
    },
    {
      title: "管理费",
      dataIndex: "management_fee",
      width: 110,
      align: "right",
      sorter: (a, b) => a.management_fee - b.management_fee,
      render: (v: number) => <span style={{ color: COST_COLORS.management }}>{fmt(v)}</span>,
    },
    {
      title: "利润",
      dataIndex: "profit",
      width: 110,
      align: "right",
      sorter: (a, b) => a.profit - b.profit,
      render: (v: number) => <span style={{ color: COST_COLORS.profit }}>{fmt(v)}</span>,
    },
    {
      title: "规费",
      dataIndex: "regulatory_fee",
      width: 110,
      align: "right",
      render: (v: number) => <span style={{ color: COST_COLORS.regulatory }}>{fmt(v)}</span>,
    },
    {
      title: "税金",
      dataIndex: "tax",
      width: 110,
      align: "right",
      render: (v: number) => <span style={{ color: COST_COLORS.tax }}>{fmt(v)}</span>,
    },
    {
      title: "合计",
      dataIndex: "total",
      width: 130,
      align: "right",
      fixed: "right",
      sorter: (a, b) => a.total - b.total,
      render: (v: number) => <strong style={{ color: "#e2e8f0" }}>{fmt(v)}</strong>,
    },
    {
      title: "计算式",
      key: "calc_expr",
      width: 230,
      fixed: "right",
      render: (_: unknown, row: LineCalcResult) => {
        const parts = [row.direct_cost, row.management_fee, row.profit, row.regulatory_fee, row.tax];
        const sum = parts.reduce((s, p) => s + p, 0);
        return (
          <span title="合计 = 直接费 + 管理费 + 利润 + 规费 + 税金" style={{ fontFamily: "monospace", fontSize: 12, color: "#94a3b8", whiteSpace: "nowrap" }}>
            {parts.map(fmtNum).join(" + ")} = {fmtNum(sum)}
          </span>
        );
      },
    },
    {
      title: "操作",
      width: 90,
      fixed: "right",
      render: (_: unknown, row: LineCalcResult) => (
        <Button size="small" type="link" icon={<NodeIndexOutlined />} onClick={() => showProvenance(row.boq_item_id)}>
          溯源
        </Button>
      ),
    },
  ];

  // ===== 国标清单计价表（GB 50500-2013《建设工程工程量清单计价规范》表式）=====
  interface GbRow {
    key: string;
    seq: number;
    code: string;
    name: string;
    characteristics: string;
    unit: string;
    quantity: number;
    unitPrice: number;
    amount: number;
    boqItemId?: number;
  }

  const gbRows = useMemo<GbRow[]>(() => {
    const lineByCode = new Map<string, LineCalcResult>();
    for (const l of summary?.line_results ?? []) lineByCode.set(String(l.boq_code), l);
    const priceOf = (item: BoqItem | undefined, line: LineCalcResult | undefined): { unitPrice: number; amount: number } => {
      if (line) {
        const qty = item?.quantity ?? 0;
        const unitPrice = qty > 0 ? line.total / qty : line.total;
        return { unitPrice, amount: line.total };
      }
      if (item) {
        const unitPrice = item.rate || 0;
        const amount = item.amount || unitPrice * item.quantity;
        return { unitPrice, amount };
      }
      return { unitPrice: 0, amount: 0 };
    };
    if (boqItems.length > 0) {
      return boqItems.map((item, i) => {
        const line = lineByCode.get(String(item.code));
        const { unitPrice, amount } = priceOf(item, line);
        return {
          key: `gb-${item.id}`,
          seq: i + 1,
          code: item.code,
          name: item.name,
          characteristics: item.characteristics || "-",
          unit: item.unit,
          quantity: item.quantity,
          unitPrice,
          amount,
          boqItemId: item.id,
        };
      });
    }
    return (summary?.line_results ?? []).map((line, i) => ({
      key: `line-${line.boq_item_id}`,
      seq: i + 1,
      code: line.boq_code,
      name: line.boq_name,
      characteristics: "-",
      unit: "-",
      quantity: 1,
      unitPrice: line.total,
      amount: line.total,
      boqItemId: line.boq_item_id,
    }));
  }, [boqItems, summary]);

  const gbTotal = useMemo(() => gbRows.reduce((s, r) => s + r.amount, 0), [gbRows]);

  const gbColumns: ColumnsType<GbRow> = [
    { title: "序号", dataIndex: "seq", width: 56, align: "center" },
    { title: "项目编码", dataIndex: "code", width: 130 },
    { title: "项目名称", dataIndex: "name", width: 200, ellipsis: true },
    { title: "项目特征描述", dataIndex: "characteristics", ellipsis: true },
    { title: "计量单位", dataIndex: "unit", width: 80, align: "center" },
    {
      title: "工程量",
      dataIndex: "quantity",
      width: 110,
      align: "right",
      render: (v: number) => fmtNum(v, 3),
    },
    {
      title: "综合单价(元)",
      dataIndex: "unitPrice",
      width: 120,
      align: "right",
      sorter: (a, b) => a.unitPrice - b.unitPrice,
      render: (v: number) => <span style={{ color: "#7dd3fc" }}>{fmtNum(v)}</span>,
    },
    {
      title: "合价(元)",
      dataIndex: "amount",
      width: 130,
      align: "right",
      sorter: (a, b) => a.amount - b.amount,
      render: (v: number) => <strong style={{ color: "#e2e8f0" }}>{fmtNum(v)}</strong>,
    },
    {
      title: "计算式",
      key: "calc_expr",
      width: 220,
      render: (_: unknown, row: GbRow) => {
        if (row.quantity <= 0) {
          return <span style={{ fontFamily: "monospace", fontSize: 12, color: "#94a3b8" }}>-</span>;
        }
        return (
          <span title="综合单价 = 合价 ÷ 工程量" style={{ fontFamily: "monospace", fontSize: 12, color: "#94a3b8", whiteSpace: "nowrap" }}>
            {fmtNum(row.amount)} ÷ {fmtNum(row.quantity, 3)} = {fmtNum(row.unitPrice)}
          </span>
        );
      },
    },
    {
      title: "操作",
      width: 90,
      fixed: "right",
      render: (_: unknown, row: GbRow) =>
        row.boqItemId ? (
          <Button size="small" type="link" icon={<NodeIndexOutlined />} onClick={() => showProvenance(row.boqItemId!)}>
            溯源
          </Button>
        ) : null,
    },
  ];

  // 导出国标清单计价表 CSV（可直接用 Excel 打开，含 BOM）
  const exportGbSheet = () => {
    if (gbRows.length === 0) {
      message.warning("暂无可导出的清单计价数据");
      return;
    }
    const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
    const exprOf = (r: GbRow) => (r.quantity > 0 ? `${fmtNum(r.amount)}÷${fmtNum(r.quantity, 3)}=${fmtNum(r.unitPrice)}` : "-");
    const lines: string[] = [
      "分部分项工程量清单与计价表",
      "依据《建设工程工程量清单计价规范》GB 50500-2013 编制；项目编码依据 GB 50854-2013",
      ["序号", "项目编码", "项目名称", "项目特征描述", "计量单位", "工程量", "综合单价(元)", "合价(元)", "计算式"].map(esc).join(","),
      ...gbRows.map((r) => [r.seq, r.code, r.name, r.characteristics, r.unit, fmtNum(r.quantity, 3), fmtNum(r.unitPrice), fmtNum(r.amount), exprOf(r)].map(esc).join(",")),
      ["", "", "合计（本表）", "", "", "", "", fmtNum(gbTotal), ""].map(esc).join(","),
    ];
    const blob = new Blob([`﻿${lines.join("\r\n")}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `分部分项工程量清单与计价表_${projectId ?? "export"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    message.success("已生成国标清单计价表（CSV，Excel 可直接打开）");
  };

  return (
    <div className="page-container">
      {/* 顶部 KPI */}
      <div className="kpi-grid">
        <div className="kpi-card">
          <span className="material-symbols-outlined kpi-card-icon">list_alt</span>
          <div className="kpi-card-body">
            <span className="kpi-card-label">明细覆盖</span>
            <span className="kpi-card-value">{summary?.line_results?.length ?? 0}<span className="kpi-card-suffix">项</span></span>
          </div>
        </div>
        <div className="kpi-card">
          <span className="material-symbols-outlined kpi-card-icon">account_balance_wallet</span>
          <div className="kpi-card-body">
            <span className="kpi-card-label">直接费</span>
            <span className="kpi-card-value">{fmt(summary?.total_direct)}</span>
          </div>
        </div>
        <div className="kpi-card">
          <span className="material-symbols-outlined kpi-card-icon">receipt_long</span>
          <div className="kpi-card-body">
            <span className="kpi-card-label">税前造价</span>
            <span className="kpi-card-value">{fmt(summary?.total_pre_tax)}</span>
          </div>
        </div>
        <div className="kpi-card">
          <span className="material-symbols-outlined kpi-card-icon">payments</span>
          <div className="kpi-card-body">
            <span className="kpi-card-label">总造价</span>
            <span className="kpi-card-value">{fmt(summary?.grand_total)}</span>
          </div>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {/* 明细统计卡 */}
        {lineStats.count > 0 && (
          <div className="pricing-line-stats">
            <div className="pricing-line-stat">
              <span className="material-symbols-outlined">format_list_numbered</span>
              <div>
                <span className="pricing-line-stat-label">明细总数</span>
                <strong className="pricing-line-stat-value">{lineStats.count} 项</strong>
              </div>
            </div>
            <div className="pricing-line-stat">
              <span className="material-symbols-outlined">trending_up</span>
              <div>
                <span className="pricing-line-stat-label">最高项金额</span>
                <strong className="pricing-line-stat-value" style={{ color: "#fb7185" }}>{fmt(lineStats.maxItem?.total)}</strong>
                <span className="pricing-line-stat-sub">{lineStats.maxItem?.boq_name}</span>
              </div>
            </div>
            <div className="pricing-line-stat">
              <span className="material-symbols-outlined">trending_down</span>
              <div>
                <span className="pricing-line-stat-label">最低项金额</span>
                <strong className="pricing-line-stat-value" style={{ color: "#34d399" }}>{fmt(lineStats.minItem?.total)}</strong>
                <span className="pricing-line-stat-sub">{lineStats.minItem?.boq_name}</span>
              </div>
            </div>
            <div className="pricing-line-stat">
              <span className="material-symbols-outlined">analytics</span>
              <div>
                <span className="pricing-line-stat-label">平均金额</span>
                <strong className="pricing-line-stat-value">{fmt(lineStats.avg)}</strong>
              </div>
            </div>
          </div>
        )}

        {/* 计价明细表 */}
        <div className="content-card">
          <div className="content-card-head">
            <h3 className="content-card-title"><span className="material-symbols-outlined">table_chart</span>{viewMode === "gb" ? `分部分项工程量清单与计价表（${gbRows.length} 项）` : `计价明细（${summary?.line_results?.length ?? 0} 项）`}</h3>
            <div className="content-card-actions" style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <Segmented
                size="small"
                value={viewMode}
                onChange={(v) => setViewMode(v as "fees" | "gb")}
                options={[
                  { label: "费用构成", value: "fees" },
                  { label: "国标清单计价表", value: "gb" },
                ]}
              />
              <Button icon={<DownloadOutlined />} onClick={exportGbSheet}>生成国标清单表</Button>
            </div>
          </div>
          <div className="gb-sheet-banner">依据 GB 50500-2013《建设工程工程量清单计价规范》与 GB 50854-2013《房屋建筑与装饰工程工程量计算规范》编制</div>
          <div className="content-card-body flush">
            {viewMode === "gb" ? (
              <Table
                rowKey="key"
                loading={loading}
                dataSource={gbRows}
                scroll={{ x: 1100 }}
                pagination={{ pageSize: 20, showSizeChanger: true, showTotal: (total) => `共 ${total} 条` }}
                columns={gbColumns}
                locale={{
                  emptyText: (
                    <Empty description={projectId ? "当前项目暂无计价明细。请先完成清单和定额绑定，再执行计价。" : "请先选择项目。"}>
                      <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
                        <Button disabled={!projectId} type="primary" loading={calculating} onClick={calculate}>执行计价</Button>
                        <Button disabled={!projectId} onClick={() => projectId && navigate(`/projects/${projectId}`)}>打开项目工作台</Button>
                      </div>
                    </Empty>
                  ),
                }}
              />
            ) : (
              <Table
                rowKey="boq_item_id"
                loading={loading}
                dataSource={summary?.line_results ?? []}
                scroll={{ x: 1100 }}
                pagination={{ pageSize: 20, showSizeChanger: true, showTotal: (total) => `共 ${total} 条` }}
                columns={columns}
                locale={{
                  emptyText: (
                    <Empty description={projectId ? "当前项目暂无计价明细。请先完成清单和定额绑定，再执行计价。" : "请先选择项目。"}>
                      <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
                        <Button disabled={!projectId} type="primary" loading={calculating} onClick={calculate}>执行计价</Button>
                        <Button disabled={!projectId} onClick={() => projectId && navigate(`/projects/${projectId}`)}>打开项目工作台</Button>
                      </div>
                    </Empty>
                  ),
                }}
              />
            )}
          </div>
        </div>
      </div>

      {/* 计价溯源弹窗 */}
      <Modal
        title="计价溯源"
        open={provenanceOpen}
        onCancel={() => setProvenanceOpen(false)}
        footer={<Button onClick={() => setProvenanceOpen(false)}>关闭</Button>}
        width={780}
      >
        {provenanceLoading ? (
          <div style={{ textAlign: "center", padding: 40, color: "#64748b" }}>加载中...</div>
        ) : provenance ? (
          <div className="provenance-detail">
            <div className="provenance-head">
              <div>
                <h3 className="provenance-title">{provenance.boq_name}</h3>
                <div className="provenance-meta">
                  <Tag>编码：{provenance.boq_code}</Tag>
                  <Tag>单位：{provenance.boq_unit}</Tag>
                  <Tag>工程量：{fmtNum(provenance.boq_quantity)}</Tag>
                </div>
              </div>
              <div className="provenance-price">
                <span>综合单价</span>
                <strong>{provenance.unit_price != null ? fmt(provenance.unit_price) : "-"}</strong>
                <span>合价</span>
                <strong style={{ color: "#38bdf8" }}>{provenance.calc_total != null ? fmt(provenance.calc_total) : "-"}</strong>
              </div>
            </div>

            {provenance.calc_breakdown && (
              <div className="provenance-section">
                <h4 className="provenance-section-title">费用分解</h4>
                <div className="provenance-breakdown">
                  <div><span>直接费</span><strong style={{ color: COST_COLORS.direct }}>{fmt(provenance.calc_breakdown.direct_cost)}</strong></div>
                  <div><span>管理费</span><strong style={{ color: COST_COLORS.management }}>{fmt(provenance.calc_breakdown.management_fee)}</strong></div>
                  <div><span>利润</span><strong style={{ color: COST_COLORS.profit }}>{fmt(provenance.calc_breakdown.profit)}</strong></div>
                  <div><span>规费</span><strong style={{ color: COST_COLORS.regulatory }}>{fmt(provenance.calc_breakdown.regulatory_fee)}</strong></div>
                  <div><span>税前</span><strong>{fmt(provenance.calc_breakdown.pre_tax_total)}</strong></div>
                  <div><span>税金</span><strong style={{ color: COST_COLORS.tax }}>{fmt(provenance.calc_breakdown.tax)}</strong></div>
                  <div><span>合计</span><strong style={{ color: "#38bdf8" }}>{fmt(provenance.calc_breakdown.total)}</strong></div>
                </div>
              </div>
            )}

            {provenance.bindings.length > 0 && (
              <div className="provenance-section">
                <h4 className="provenance-section-title">定额绑定（{provenance.bindings.length} 项）</h4>
                <div className="provenance-bindings">
                  {provenance.bindings.map((binding, index) => (
                    <div key={index} className="provenance-binding-item">
                      <div className="provenance-binding-head">
                        <strong>{binding.quota.quota_name}</strong>
                        <Tag color="blue">{binding.quota.quota_code}</Tag>
                        <Tag>系数 {fmtNum(binding.coefficient, 3)}</Tag>
                      </div>
                      <div className="provenance-binding-meta">
                        <span>单位：{binding.quota.unit}</span>
                        <span>人工：{fmtNum(binding.quota.labor_qty)}</span>
                        <span>材料：{fmtNum(binding.quota.material_qty)}</span>
                        <span>机械：{fmtNum(binding.quota.machine_qty)}</span>
                        {binding.direct_cost != null && <span>直接费：{fmt(binding.direct_cost)}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="provenance-section">
              <h4 className="provenance-section-title">价格快照</h4>
              <div className="provenance-price-snapshot">
                <div><span>人工单价</span><strong>{fmt(provenance.price_snapshot.labor_price)}</strong></div>
                <div><span>材料单价</span><strong>{fmt(provenance.price_snapshot.material_price)}</strong></div>
                <div><span>机械单价</span><strong>{fmt(provenance.price_snapshot.machine_price)}</strong></div>
              </div>
            </div>

            {provenance.explanation && (
              <div className="provenance-section">
                <h4 className="provenance-section-title">计价说明</h4>
                <p className="provenance-explanation">{provenance.explanation}</p>
              </div>
            )}
          </div>
        ) : (
          <Empty description="未找到溯源数据" />
        )}
      </Modal>
    </div>
  );
}

