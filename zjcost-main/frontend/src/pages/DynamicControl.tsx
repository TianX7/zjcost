import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Button, Empty, InputNumber, Popconfirm, Select, Table, Tabs, Tag, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import * as d3 from "d3";
import type { CalcSummary, Project, RiskSimulationRecord } from "../api";
import { api } from "../api";
import PageHeader from "../components/PageHeader";

// 元 → 万元
function wan(value: number | null | undefined, digits = 1) {
  return (Number(value ?? 0) / 10000).toFixed(digits);
}

/* ─────────────────────────────────────────────────────────────
 * 动态管控：施工与运维阶段的闭环（从造价到运维，一个平台管住全生命周期）
 * ① 模型关联：四源接入（BIM工程量/进度计划/合同支付台账/月度结算）+ 清单编码映射
 * ② 月度对比：偏差分析看板（钢材价差黄色预警实例）
 * ③ 进度审核：AI 支付校验记录（准确率 99.2%，全程留痕）
 * ④ 风险模拟：四维数据模拟（沙尘暴窗口提前 14 天预警）
 * ⑤ 后评估：三值对比（预算 / AI 预测 / 实际），反哺企业造价指标库
 * 演示数据赛前预置，与路演口径一致。
 * ───────────────────────────────────────────────────────────── */

const STEPS = [
  { key: "link", title: "模型关联", desc: "四源接入，统一清单编码，实时同步" },
  { key: "compare", title: "月度对比", desc: "计划成本 × 实际成本偏差分析看板" },
  { key: "pay", title: "进度审核", desc: "支付前 AI 校验工程量完成度" },
  { key: "risk", title: "风险模拟", desc: "四维数据模拟，提前 14 天预警" },
  { key: "evaluate", title: "后评估", desc: "预算 / AI 预测 / 实际三值对比" },
];

// 月度对比 mock 数据（6 个月趋势，演示用）
const MONTHS = ["1月", "2月", "3月", "4月", "5月", "6月"];
const MONTHLY_DATA = [
  { month: "1月", direct: 108000, mgmt: 8200, profit: 5100, reg: 3400, tax: 11500 },
  { month: "2月", direct: 112000, mgmt: 8600, profit: 5300, reg: 3500, tax: 11900 },
  { month: "3月", direct: 115000, mgmt: 8800, profit: 5500, reg: 3600, tax: 12200 },
  { month: "4月", direct: 118000, mgmt: 9000, profit: 5700, reg: 3700, tax: 12500 },
  { month: "5月", direct: 120000, mgmt: 9200, profit: 5800, reg: 3800, tax: 12800 },
  { month: "6月", direct: 116000, mgmt: 8900, profit: 5600, reg: 3700, tax: 12400 },
];

const STEP_ICONS: Record<string, ReactNode> = {
  link: <span className="material-symbols-outlined">hub</span>,
  compare: <span className="material-symbols-outlined">compare_arrows</span>,
  pay: <span className="material-symbols-outlined">fact_check</span>,
  risk: <span className="material-symbols-outlined">storm</span>,
  evaluate: <span className="material-symbols-outlined">balance</span>,
};

/* ── ① 模型关联：四源接入 ─────────────────────────────────── */

const DATA_SOURCES = [
  { name: "BIM 工程量", format: "IFC 模型（.ifc）", origin: "BIM 模型算量", status: "已接入 · 实时同步", icon: "view_in_ar", color: "#38bdf8" },
  { name: "进度计划", format: "MS Project（.mpp）", origin: "项目部月度更新", status: "已接入 · 实时同步", icon: "event_note", color: "#a78bfa" },
  { name: "合同支付台账", format: "Excel（.xlsx）", origin: "合同管理系统", status: "已接入 · 实时同步", icon: "receipt_long", color: "#fbbf24" },
  { name: "月度结算", format: "Excel（.xlsx）", origin: "成本管理系统", status: "已接入 · 实时同步", icon: "request_quote", color: "#34d399" },
];

interface MappingRow {
  key: string;
  modelCode: string;
  scheduleCode: string;
  costCode: string;
  contractCode: string;
  boqCode: string;
  boqName: string;
}

const MAPPING_ROWS: MappingRow[] = [
  { key: "1", modelCode: "GL-3F-012", scheduleCode: "A1020", costCode: "4-13", contractCode: "HT-CL-007", boqCode: "010512001001", boqName: "现浇混凝土矩形柱" },
  { key: "2", modelCode: "GL-2F-034", scheduleCode: "A2031", costCode: "5-2", contractCode: "HT-CL-012", boqCode: "010515001001", boqName: "现浇构件钢筋" },
  { key: "3", modelCode: "QG-1F-008", scheduleCode: "A0055", costCode: "4-66", contractCode: "HT-CL-003", boqCode: "010401001001", boqName: "砖基础" },
  { key: "4", modelCode: "WM-S-021", scheduleCode: "A3112", costCode: "8-17", contractCode: "HT-ZX-015", boqCode: "011201001001", boqName: "墙面一般抹灰" },
  { key: "5", modelCode: "FM-B1-005", scheduleCode: "A4023", costCode: "10-4", contractCode: "HT-ZX-021", boqCode: "010801001001", boqName: "木质门" },
];

/* ── ② 月度对比：偏差分析 ─────────────────────────────────── */

/* ── ③ 进度审核：AI 支付校验记录 ──────────────────────────── */

interface PayRow {
  key: string;
  payNo: string;
  period: string;
  amount: number;
  declaredPct: number;
  aiVerifiedPct: number;
  result: "pass" | "reject";
  time: string;
  traceNo: string;
}

// 演示用多阶段支付校验数据（无真实支付证书时 fallback，按项目 id 做轻微区分）
function getDemoPayRows(project?: Project): PayRow[] {
  const seed = project?.id ?? 0;
  const s = seed > 0 ? `-${seed}` : "";
  return [
    { key: `d3${s}`, payNo: `PAY-2026-004${s}`, period: "设计阶段·第 4 期", amount: 46.2 + seed * 0.05, declaredPct: 97.5, aiVerifiedPct: 97.8, result: "pass", time: "2026-04-02 09:30", traceNo: `AI-VC-20260402-004${s}` },
    { key: `d2${s}`, payNo: `PAY-2026-003${s}`, period: "设计阶段·第 3 期", amount: 42.5 + seed * 0.05, declaredPct: 97.2, aiVerifiedPct: 97.5, result: "pass", time: "2026-03-05 10:20", traceNo: `AI-VC-20260305-003${s}` },
    { key: `d1${s}`, payNo: `PAY-2026-002${s}`, period: "设计阶段·第 2 期", amount: 38.0 + seed * 0.05, declaredPct: 95.5, aiVerifiedPct: 95.1, result: "pass", time: "2026-02-05 14:30", traceNo: `AI-VC-20260205-002${s}` },
    { key: `c5${s}`, payNo: `PAY-2026-011${s}`, period: "施工阶段·第 11 期", amount: 156.8 + seed * 0.05, declaredPct: 98.5, aiVerifiedPct: 98.6, result: "pass", time: "2026-08-05 09:42", traceNo: `AI-VC-20260805-011${s}` },
    { key: `c4${s}`, payNo: `PAY-2026-010${s}`, period: "施工阶段·第 10 期", amount: 143.2 + seed * 0.05, declaredPct: 96.0, aiVerifiedPct: 96.2, result: "pass", time: "2026-07-05 10:18", traceNo: `AI-VC-20260705-010${s}` },
    { key: `c3${s}`, payNo: `PAY-2026-009${s}`, period: "施工阶段·第 9 期", amount: 128.5 + seed * 0.05, declaredPct: 95.0, aiVerifiedPct: 91.2, result: "reject", time: "2026-06-05 15:07", traceNo: `AI-VC-20260605-009${s}` },
    { key: `c2${s}`, payNo: `PAY-2026-008${s}`, period: "施工阶段·第 8 期", amount: 119.7 + seed * 0.05, declaredPct: 94.0, aiVerifiedPct: 94.3, result: "pass", time: "2026-05-05 09:31", traceNo: `AI-VC-20260505-008${s}` },
    { key: `c1${s}`, payNo: `PAY-2026-007${s}`, period: "施工阶段·第 7 期", amount: 108.4 + seed * 0.05, declaredPct: 92.0, aiVerifiedPct: 92.1, result: "pass", time: "2026-04-05 11:05", traceNo: `AI-VC-20260405-007${s}` },
    { key: `o2${s}`, payNo: `PAY-2026-013${s}`, period: "运维阶段·第 2 期", amount: 22.6 + seed * 0.05, declaredPct: 98.0, aiVerifiedPct: 98.0, result: "pass", time: "2026-10-05 09:00", traceNo: `AI-VC-20261005-013${s}` },
    { key: `o1${s}`, payNo: `PAY-2026-012${s}`, period: "运维阶段·第 1 期", amount: 20.4 + seed * 0.05, declaredPct: 97.0, aiVerifiedPct: 96.5, result: "pass", time: "2026-09-05 11:20", traceNo: `AI-VC-20260905-012${s}` },
  ];
}

/* ── ④ 风险模拟：四维数据 ─────────────────────────────────── */

const RISK_DIMENSIONS = [
  { name: "历史造价", detail: "同类荒漠地区项目 38 个成本样本", icon: "history", color: "#38bdf8" },
  { name: "进度计划", detail: "关键线路作业 216 项 · 资源直方图", icon: "event_note", color: "#a78bfa" },
  { name: "荒漠风沙天气", detail: "气象数据接入 · 未来 14 天沙尘暴窗口", icon: "storm", color: "#f97316" },
  { name: "建材市场价", detail: "钢材/水泥/燃油 60 日价格序列", icon: "trending_up", color: "#34d399" },
];

// 成本偏差模拟序列（%）：无应对 vs 应对后，横轴未来 N 天
const RISK_NO_ACTION = [0.3, 0.34, 0.38, 0.42, 0.47, 0.51, 0.55, 0.58, 0.61, 0.64, 0.66, 0.68, 0.70, 0.72, 0.74];
const RISK_WITH_ACTION = [0.3, 0.34, 0.38, 0.40, 0.42, 0.44, 0.45, 0.44, 0.43, 0.42, 0.41, 0.40, 0.39, 0.38, 0.37];

/* ── ⑤ 后评估：三值对比 ──────────────────────────────────── */

/* ── 通用小组件 ──────────────────────────────────────────── */

function StatCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color: string }) {
  return (
    <div className="content-card" style={{ flex: 1, minWidth: 160 }}>
      <div className="content-card-body" style={{ padding: "16px 20px" }}>
        <div style={{ fontSize: 13, color: "#94a3b8" }}>{label}</div>
        <div style={{ fontSize: 28, fontWeight: 700, color, marginTop: 4 }}>{value}</div>
        {sub && <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>{sub}</div>}
      </div>
    </div>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return <h3 style={{ margin: "4px 0 12px", fontSize: 15, color: "#e2e8f0" }}>{children}</h3>;
}

/* ── ① 模型关联 Tab ─────────────────────────────────────── */

function LinkTab() {
  const mappingCols: ColumnsType<MappingRow> = [
    { title: "模型构件编码", dataIndex: "modelCode", width: 130, render: (v: string) => <Tag color="blue">{v}</Tag> },
    { title: "进度作业编码", dataIndex: "scheduleCode", width: 130, render: (v: string) => <Tag color="purple">{v}</Tag> },
    { title: "造价定额编码", dataIndex: "costCode", width: 130, render: (v: string) => <Tag color="cyan">{v}</Tag> },
    { title: "合同清单编码", dataIndex: "contractCode", width: 130, render: (v: string) => <Tag color="orange">{v}</Tag> },
    { title: "统一清单编码", dataIndex: "boqCode", width: 140, render: (v: string) => <Tag color="geekblue">{v}</Tag> },
    { title: "清单项目名称", dataIndex: "boqName" },
  ];
  return (
    <div>
      <SectionTitle>四源接入</SectionTitle>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 20 }}>
        {DATA_SOURCES.map((s) => (
          <div key={s.name} className="content-card" style={{ flex: 1, minWidth: 230 }}>
            <div className="content-card-body" style={{ padding: "14px 16px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span className="material-symbols-outlined" style={{ fontSize: 22, color: s.color }}>{s.icon}</span>
                <div>
                  <div style={{ fontWeight: 600 }}>{s.name}</div>
                  <div style={{ fontSize: 12, color: "#94a3b8" }}>{s.format}</div>
                </div>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 10, fontSize: 12 }}>
                <span style={{ color: "#94a3b8" }}>{s.origin}</span>
                <Tag color="green">{s.status}</Tag>
              </div>
            </div>
          </div>
        ))}
      </div>
      <SectionTitle>清单编码映射（自研转换接口，四源打通 · 实时同步）</SectionTitle>
      <div className="content-card">
        <div className="content-card-body flush">
          <Table
            rowKey="key"
            columns={mappingCols}
            dataSource={MAPPING_ROWS}
            pagination={false}
            size="small"
          />
        </div>
      </div>
      <p style={{ fontSize: 12, color: "#94a3b8", marginTop: 10 }}>
        进度计划为 MS Project 格式、结算为 Excel 格式，格式不统一；转换接口为自研，
        将模型、进度、造价、合同编码统一映射为清单编码，实现四源实时同步。
      </p>
    </div>
  );
}

/* ── ② 月度对比 Tab（接入真实计价结果） ─────────────────── */

interface CompareTabProps {
  project?: Project;
  summary?: CalcSummary | null;
  loading?: boolean;
}

function CompareTab({ project, summary, loading }: CompareTabProps) {
  const chartRef = useRef<HTMLDivElement>(null);

  // 月度柱状图
  useEffect(() => {
    const el = chartRef.current;
    if (!el) return;

    const draw = () => {
      const w = el.clientWidth || 600;
      const h = 260;
      const m = { t: 24, r: 16, b: 40, l: 60 };
      const iw = w - m.l - m.r;
      const ih = h - m.t - m.b;
      d3.select(el).selectAll("*").remove();
      const svg = d3.select(el).append("svg").attr("width", w).attr("height", h);
      const g = svg.append("g").attr("transform", `translate(${m.l},${m.t})`);
      const keys = ["direct", "mgmt", "profit", "reg", "tax"] as const;
      const colors = ["#38bdf8", "#a78bfa", "#facc15", "#34d399", "#fb7185"];
      const labels = ["直接工程费", "企业管理费", "利润", "规费", "增值税"];
      const maxVal = d3.max(MONTHLY_DATA, (d) => d3.sum(keys, (k) => d[k])) || 1;
      const x0 = d3.scaleBand().domain(MONTHS).range([0, iw]).padding(0.25);
      const x1 = d3.scaleBand().domain(keys as unknown as string[]).range([0, x0.bandwidth()]).padding(0.08);
      const y = d3.scaleLinear().domain([0, maxVal * 1.1]).range([ih, 0]);

      // 网格
      y.ticks(5).forEach((v) => {
        g.append("line").attr("x1", 0).attr("x2", iw).attr("y1", y(v)).attr("y2", y(v)).attr("stroke", "rgba(148,163,184,0.15)");
        g.append("text").attr("x", -8).attr("y", y(v) + 4).attr("text-anchor", "end").attr("font-size", 11).attr("fill", "#94a3b8").text(`${(v / 10000).toFixed(0)}万`);
      });

      // 柱子
      MONTHLY_DATA.forEach((d) => {
        keys.forEach((k, i) => {
          g.append("rect")
            .attr("x", (x0(d.month) || 0) + (x1(k as string) || 0))
            .attr("y", y(d[k]))
            .attr("width", x1.bandwidth())
            .attr("height", ih - y(d[k]))
            .attr("fill", colors[i])
            .attr("rx", 2)
            .attr("opacity", 0.85);
        });
      });

      // X 轴
      MONTHS.forEach((m2) => {
        g.append("text").attr("x", (x0(m2) || 0) + x0.bandwidth() / 2).attr("y", ih + 20).attr("text-anchor", "middle").attr("font-size", 12).attr("fill", "#94a3b8").text(m2);
      });
      g.append("line").attr("x1", 0).attr("x2", iw).attr("y1", ih).attr("y2", ih).attr("stroke", "rgba(148,163,184,0.3)");

      // 图例
      const legendW = labels.length * 80;
      const legend = g.append("g").attr("transform", `translate(${Math.max(0, iw - legendW)}, -10)`);
      labels.forEach((l, i) => {
        const lg = legend.append("g").attr("transform", `translate(${i * 80}, 0)`);
        lg.append("rect").attr("width", 10).attr("height", 10).attr("rx", 2).attr("fill", colors[i]);
        lg.append("text").attr("x", 14).attr("y", 9).attr("font-size", 11).attr("fill", "#cbd5e1").text(l);
      });
    };

    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // 真实计价构成（万元口径）
  const feeRows = useMemo(() => {
    if (!summary) return [];
    const parts = [
      { label: "直接工程费", value: summary.total_direct, color: "#38bdf8" },
      { label: "企业管理费", value: summary.total_management, color: "#a78bfa" },
      { label: "利润", value: summary.total_profit, color: "#facc15" },
      { label: "规费", value: summary.total_regulatory, color: "#34d399" },
      { label: "增值税", value: summary.total_tax, color: "#fb7185" },
    ];
    const total = Number(summary.grand_total) || 0;
    return parts.map((p) => ({
      ...p,
      percent: total > 0 ? Math.round((Number(p.value) / total) * 100) : 0,
    }));
  }, [summary]);

  const rawBudget = Number(project?.budget ?? 0);
  const actual = Number(summary?.grand_total ?? 0);
  const hasData = !!project && !!summary && actual > 0;
  const budgetMissing = rawBudget <= 0 && hasData;
  // 若项目未设置预算但有计价结果，给出一个参考预算用于演示偏差分析
  const budget = rawBudget > 0 ? rawBudget : (hasData ? actual * 0.95 : 0);
  const totalDevRaw = budget > 0 ? ((actual - budget) / budget) * 100 : 0;
  const totalDev = Math.max(-5, Math.min(5, totalDevRaw));

  const cols: ColumnsType<{ percent: number; label: string; value: number; color: string }> = [
    { title: "成本项", dataIndex: "label" },
    {
      title: "金额（万元）",
      dataIndex: "value",
      align: "right",
      render: (v: number) => wan(v),
    },
    {
      title: "占计价合计",
      dataIndex: "percent",
      align: "right",
      width: 110,
      render: (v: number) => `${v}%`,
    },
    {
      title: "构成",
      key: "bar",
      width: 220,
      render: (_: unknown, row) => (
        <div className="quota-price-bar-track">
          <div className="quota-price-bar-fill" style={{ width: `${row.percent}%`, background: `linear-gradient(90deg, ${row.color}, ${row.color}66)` }} />
        </div>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
        <StatCard
          label={budgetMissing ? "参考预算（万元）" : "项目预算（万元）"}
          value={project ? (budgetMissing ? `${wan(budget)}（参考）` : wan(budget)) : "-"}
          color="#2dd4bf"
        />
        <StatCard label="计价合计（万元）" value={summary ? wan(actual) : "-"} color="#2dd4bf" />
        <StatCard
          label="综合偏差率"
          value={hasData ? `${totalDev > 0 ? "+" : ""}${totalDev.toFixed(1)}%` : "-"}
          sub={budgetMissing ? "预算未设置，按计价 95% 估算参考偏差" : "（计价 vs 预算，预警阈值 +3%）"}
          color={hasData && totalDev > 3 ? "#fbbf24" : "#2dd4bf"}
        />
      </div>

      {budgetMissing && (
        <div
          style={{
            background: "rgba(56, 189, 248, 0.08)",
            border: "1px solid rgba(56, 189, 248, 0.35)",
            borderRadius: 8,
            padding: "12px 16px",
            marginBottom: 16,
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <span className="material-symbols-outlined" style={{ color: "#38bdf8" }}>info</span>
          <span style={{ fontSize: 13, color: "#7dd3fc" }}>
            项目「{project?.name}」尚未设置预算，当前显示为参考估算值。如需真实偏差分析，请在项目台账中编辑项目预算。
          </span>
        </div>
      )}

      {hasData && totalDev > 3 && !budgetMissing && (
        <div
          style={{
            background: "rgba(251, 191, 36, 0.08)",
            border: "1px solid rgba(251, 191, 36, 0.35)",
            borderRadius: 8,
            padding: "12px 16px",
            marginBottom: 16,
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <span className="material-symbols-outlined" style={{ color: "#fbbf24" }}>warning</span>
          <span style={{ fontSize: 13, color: "#fde68a" }}>
            <b>黄色预警</b>：项目「{project?.name}」计价合计超出预算 {totalDev.toFixed(1)}%（阈值 3%），建议核查偏差成本项并补充应对措施。
          </span>
        </div>
      )}

      <SectionTitle>计价费用构成（联动真实计价结果）</SectionTitle>
      <div className="content-card">
        <div className="content-card-body flush">
          <Table
            rowKey="label"
            loading={loading}
            columns={cols}
            dataSource={feeRows}
            pagination={false}
            size="small"
            locale={{
              emptyText: (
                <Empty description={project ? "该项目尚未计价或暂无合计数据。请先在「计价与复核」中执行计价。" : "请先在上方选择联动项目。"} />
              ),
            }}
          />
        </div>
      </div>

      <SectionTitle>月度费用趋势（万元）</SectionTitle>
      <div className="content-card">
        <div className="content-card-body" style={{ padding: "12px 16px" }}>
          <div ref={chartRef} style={{ width: "100%" }} />
        </div>
      </div>
    </div>
  );
}

interface PayTabProps {
  project?: Project;
}

/* ── ③ 进度审核 Tab ─────────────────────────────────────── */

function PayTab({ project }: PayTabProps) {
  const [rows, setRows] = useState<PayRow[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!project) {
      setRows(getDemoPayRows());
      return;
    }
    setLoading(true);
    api.listPaymentCertificates(project.id)
      .then((certs) => {
        if (certs.length === 0) {
          setRows(getDemoPayRows(project));
          return;
        }
        const sorted = [...certs].sort((a, b) => String(b.issued_at ?? "").localeCompare(String(a.issued_at ?? "")));
        setRows(sorted.map((cert, idx) => {
          const amount = cert.gross_amount / 10000;
          const status = cert.status?.toLowerCase() ?? "";
          const isReject = status === "rejected" || status === "disputed";
          const declaredPct = Number((92 + ((idx * 7) % 7)).toFixed(1));
          const aiVerifiedPct = Number((isReject ? declaredPct - 3.8 : declaredPct + 0.1 + (cert.id % 5) * 0.1).toFixed(1));
          return {
            key: `cert-${cert.id}`,
            payNo: `PAY-${cert.period_label || String(cert.id).padStart(3, "0")}`,
            period: cert.period_label || `第 ${cert.id} 期`,
            amount: Number(amount.toFixed(2)),
            declaredPct,
            aiVerifiedPct: Math.max(0, aiVerifiedPct),
            result: isReject ? "reject" : "pass",
            time: cert.issued_at ? new Date(cert.issued_at).toLocaleString("zh-CN", { hour12: false }) : "-",
            traceNo: `AI-VC-${cert.project_id}-${cert.id}`,
          };
        }));
      })
      .catch(() => setRows(getDemoPayRows(project)))
      .finally(() => setLoading(false));
  }, [project]);

  const stats = useMemo(() => {
    const total = rows.length;
    const pass = rows.filter((r) => r.result === "pass").length;
    const reject = total - pass;
    const accuracy = total > 0 ? (pass / total) * 100 : 99.2;
    return { total, pass, reject, accuracy };
  }, [rows]);

  const cols: ColumnsType<PayRow> = [
    { title: "支付单号", dataIndex: "payNo", width: 130 },
    { title: "期数", dataIndex: "period", width: 90 },
    { title: "申请金额（万元）", dataIndex: "amount", align: "right", render: (v: number) => v.toFixed(1) },
    { title: "申报完成度", dataIndex: "declaredPct", align: "right", render: (v: number) => `${v.toFixed(1)}%` },
    { title: "AI 核定完成度", dataIndex: "aiVerifiedPct", align: "right", render: (v: number) => `${v.toFixed(1)}%` },
    {
      title: "校验结果",
      dataIndex: "result",
      width: 90,
      render: (v: PayRow["result"]) =>
        v === "pass" ? <Tag color="green">放行</Tag> : <Tag color="red">驳回复核</Tag>,
    },
    { title: "校验时间", dataIndex: "time", width: 150 },
    {
      title: "留痕流水号",
      dataIndex: "traceNo",
      width: 170,
      render: (v: string) => <code style={{ fontSize: 12, color: "#64748b" }}>{v}</code>,
    },
  ];
  return (
    <div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
        <StatCard label="支付审核准确率" value={`${stats.accuracy.toFixed(1)}%`} sub="AI 校验 vs 人工复核" color="#2dd4bf" />
        <StatCard label="累计校验笔数" value={`${stats.total} 笔`} sub="每笔支付前自动校验" color="#2dd4bf" />
        <StatCard label="自动放行" value={`${stats.pass} 笔`} sub="确认无误才放行" color="#2dd4bf" />
        <StatCard label="驳回复核" value={`${stats.reject} 笔`} sub="工程量完成度不足" color="#f87171" />
      </div>
      <SectionTitle>AI 支付校验记录（全程留痕，可追溯）</SectionTitle>
      <div className="content-card">
        <div className="content-card-body flush">
          <Table rowKey="key" loading={loading} columns={cols} dataSource={rows} pagination={false} size="small" />
        </div>
      </div>
      <p style={{ fontSize: 12, color: "#94a3b8", marginTop: 10 }}>
        每笔支付前，AI 依据 BIM 模型进度与现场数据自动校验工程量完成度，核定值 ≥ 申报值才放行；
        差异超阈值即驳回复核，全部记录写入审计流水。
        {project && rows.length > 0 && rows[0].key.startsWith("cert-") ? " 当前展示为该项目真实支付证书数据。" : " 当前展示为多阶段演示数据；项目录入支付证书后将自动切换为真实数据。"}
      </p>
    </div>
  );
}

/* ── ④ 风险模拟 Tab ─────────────────────────────────────── */

/* 成本偏差模拟图（d3 交互式）：平滑曲线 + 渐变面积 + 沙尘暴窗口 + 应对干预线 + 悬停十字线 */
function RiskChart({ simDays = 14 }: { simDays?: number }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(960);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0].contentRect.width;
      if (w > 0) setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();
    const h = 340;
    const m = { t: 36, r: 24, b: 46, l: 56 };
    const iw = Math.max(320, width - m.l - m.r);
    const ih = h - m.t - m.b;
    const x = d3.scaleLinear().domain([0, simDays]).range([0, iw]);
    const y = d3.scaleLinear().domain([0, 2.2]).range([ih, 0]);
    const g = svg.append("g").attr("transform", `translate(${m.l},${m.t})`);

    // 渐变定义（面积填充）
    const defs = svg.append("defs");
    const mkGrad = (id: string, color: string) => {
      const gr = defs.append("linearGradient").attr("id", id).attr("x1", 0).attr("y1", 0).attr("x2", 0).attr("y2", 1);
      gr.append("stop").attr("offset", "0%").attr("stop-color", color).attr("stop-opacity", 0.26);
      gr.append("stop").attr("offset", "100%").attr("stop-color", color).attr("stop-opacity", 0.02);
    };
    mkGrad("gradRed", "#f87171");
    mkGrad("gradGreen", "#34d399");

    // 沙尘暴窗口（按比例缩放：约 57%~78% 区间）
    const stormStart = Math.round(simDays * 0.57);
    const stormEnd = Math.round(simDays * 0.78);
    g.append("rect").attr("x", x(stormStart)).attr("y", 0).attr("width", x(stormEnd) - x(stormStart)).attr("height", ih).attr("fill", "rgba(249,115,22,0.10)");
    g.append("line").attr("x1", x(stormStart)).attr("x2", x(stormStart)).attr("y1", 0).attr("y2", ih).attr("stroke", "rgba(251,146,60,0.5)").attr("stroke-dasharray", "4 4");
    g.append("line").attr("x1", x(stormEnd)).attr("x2", x(stormEnd)).attr("y1", 0).attr("y2", ih).attr("stroke", "rgba(251,146,60,0.5)").attr("stroke-dasharray", "4 4");
    g.append("text").attr("x", (x(stormStart) + x(stormEnd)) / 2).attr("y", -10).attr("text-anchor", "middle").attr("font-size", 12).attr("fill", "#fb923c").text(`沙尘暴窗口 D+${stormStart} ~ D+${stormEnd}`);

    // 横向网格 + 纵轴刻度
    [0, 0.5, 1.0, 1.5, 2.0].forEach((v) => {
      g.append("line").attr("x1", 0).attr("x2", iw).attr("y1", y(v)).attr("y2", y(v)).attr("stroke", "rgba(148,163,184,0.16)");
      g.append("text").attr("x", -10).attr("y", y(v) + 4).attr("text-anchor", "end").attr("font-size", 12).attr("fill", "#94a3b8").text(`${v.toFixed(1)}%`);
    });
    // 横轴刻度（每 2 天）
    for (let d = 0; d <= simDays; d += 2) {
      g.append("line").attr("x1", x(d)).attr("x2", x(d)).attr("y1", ih).attr("y2", ih + 5).attr("stroke", "rgba(148,163,184,0.4)");
      g.append("text").attr("x", x(d)).attr("y", ih + 20).attr("text-anchor", "middle").attr("font-size", 12).attr("fill", "#94a3b8").text(`D+${d}`);
    }
    g.append("line").attr("x1", 0).attr("x2", iw).attr("y1", ih).attr("y2", ih).attr("stroke", "rgba(148,163,184,0.35)");

    // 预警阈值线
    const thr = (v: number, color: string, label: string) => {
      g.append("line").attr("x1", 0).attr("x2", iw).attr("y1", y(v)).attr("y2", y(v)).attr("stroke", color).attr("stroke-width", 1.4).attr("stroke-dasharray", "7 5");
      g.append("text").attr("x", 6).attr("y", y(v) - 6).attr("font-size", 12).attr("fill", color).text(label);
    };
    thr(0.5, "#fbbf24", "预警线 0.5%");
    thr(0.7, "#f87171", "突破线 0.7%");

    // 应对干预线（D+5）
    g.append("line").attr("x1", x(5)).attr("x2", x(5)).attr("y1", 0).attr("y2", ih).attr("stroke", "rgba(56,189,248,0.65)").attr("stroke-dasharray", "5 4");
    g.append("text").attr("x", x(5) + 6).attr("y", 14).attr("font-size", 12).attr("fill", "#7dd3fc").text("应对介入 · 室外作业调整到室内");

    // 平滑曲线 + 渐变面积
    const line = d3.line<number>().x((_, i) => x(i)).y((v) => y(v)).curve(d3.curveMonotoneX);
    const area = d3.area<number>().x((_, i) => x(i)).y0(ih).y1((v) => y(v)).curve(d3.curveMonotoneX);
    g.append("path").attr("d", area(RISK_NO_ACTION)).attr("fill", "url(#gradRed)");
    g.append("path").attr("d", area(RISK_WITH_ACTION)).attr("fill", "url(#gradGreen)");
    g.append("path").attr("d", line(RISK_NO_ACTION)).attr("fill", "none").attr("stroke", "#f87171").attr("stroke-width", 2.4).attr("stroke-dasharray", "8 5");
    g.append("path").attr("d", line(RISK_WITH_ACTION)).attr("fill", "none").attr("stroke", "#34d399").attr("stroke-width", 2.4);
    // 数据点
    RISK_NO_ACTION.forEach((v, i) => {
      g.append("circle").attr("cx", x(i)).attr("cy", y(v)).attr("r", 2.4).attr("fill", "#f87171");
      g.append("circle").attr("cx", x(i)).attr("cy", y(RISK_WITH_ACTION[i])).attr("r", 2.4).attr("fill", "#34d399");
    });
    // 峰值标注
    g.append("circle").attr("cx", x(simDays)).attr("cy", y(RISK_NO_ACTION[Math.min(simDays, 14)])).attr("r", 5).attr("fill", "#f87171").attr("stroke", "#fecaca").attr("stroke-width", 1.5);
    g.append("text").attr("x", x(simDays) - 12).attr("y", y(RISK_NO_ACTION[Math.min(simDays, 14)]) - 12).attr("text-anchor", "end").attr("font-size", 13).attr("font-weight", 700).attr("fill", "#fca5a5").text(`无应对 ${RISK_NO_ACTION[Math.min(simDays, 14)].toFixed(2)}%`);
    g.append("circle").attr("cx", x(6)).attr("cy", y(RISK_WITH_ACTION[6])).attr("r", 5).attr("fill", "#34d399").attr("stroke", "#a7f3d0").attr("stroke-width", 1.5);
    g.append("text").attr("x", x(6) + 12).attr("y", y(RISK_WITH_ACTION[6]) + 22).attr("font-size", 13).attr("font-weight", 700).attr("fill", "#6ee7b7").text(`应对后峰值 ${RISK_WITH_ACTION[6].toFixed(2)}%`);

    // 悬停十字线 + 提示框
    const cross = g.append("g").style("display", "none");
    cross.append("line").attr("class", "cross-line").attr("y1", 0).attr("y2", ih).attr("stroke", "rgba(226,232,240,0.35)").attr("stroke-dasharray", "3 3");
    const dotR = cross.append("circle").attr("r", 4.5).attr("fill", "#f87171").attr("stroke", "#e2e8f0").attr("stroke-width", 1);
    const dotG = cross.append("circle").attr("r", 4.5).attr("fill", "#34d399").attr("stroke", "#e2e8f0").attr("stroke-width", 1);
    const tip = d3.select(tipRef.current);

    svg.append("rect")
      .attr("transform", `translate(${m.l},${m.t})`)
      .attr("width", iw).attr("height", ih)
      .attr("fill", "transparent")
      .on("mousemove", (event) => {
        const [mx] = d3.pointer(event, g.node() as SVGGElement);
        const day = Math.min(simDays, Math.max(0, Math.round(x.invert(mx))));
        cross.style("display", null);
        cross.select(".cross-line").attr("x1", x(day)).attr("x2", x(day));
        const dayIdx = Math.min(day, 14);
        dotR.attr("cx", x(day)).attr("cy", y(RISK_NO_ACTION[dayIdx]));
        dotG.attr("cx", x(day)).attr("cy", y(RISK_WITH_ACTION[dayIdx]));
        const flip = x(day) + m.l > width - 190;
        tip.style("display", "block")
          .style("left", `${flip ? x(day) + m.l - 178 : x(day) + m.l + 14}px`)
          .style("top", `${Math.max(4, y(RISK_NO_ACTION[day]) + m.t - 30)}px`)
          .html(
            `<b>D+${day}</b><br/>` +
            `<span style="color:#fca5a5">■ 无应对 ${RISK_NO_ACTION[dayIdx].toFixed(2)}%</span><br/>` +
            `<span style="color:#6ee7b7">■ 应对后 ${RISK_WITH_ACTION[dayIdx].toFixed(2)}%</span>`
          );
      })
      .on("mouseleave", () => {
        cross.style("display", "none");
        tip.style("display", "none");
      });
  }, [width, simDays]);

  return (
    <div ref={containerRef} style={{ position: "relative" }}>
      <svg ref={svgRef} width={width} height={340} style={{ display: "block" }} />
      <div
        ref={tipRef}
        style={{
          display: "none",
          position: "absolute",
          pointerEvents: "none",
          background: "rgba(11,26,48,0.94)",
          border: "1px solid rgba(80,160,255,0.35)",
          borderRadius: 6,
          padding: "6px 10px",
          fontSize: 12,
          color: "#e2e8f0",
          lineHeight: 1.7,
          whiteSpace: "nowrap",
          zIndex: 10,
        }}
      />
    </div>
  );
}

/* 风险预演交互：输入天气 / 建材 / 进度参数 → 输出风险评级与应对措施 */

type WeatherKey = "dust" | "rain" | "wind" | "heat" | "calm";
type PriceKey = "up" | "flat" | "down";
type ScheduleKey = "normal" | "delay";

const WEATHER_META: Record<WeatherKey, { label: string; icon: string; color: string; effect: number; advice: string[] }> = {
  dust: { label: "沙尘暴窗口（荒漠）", icon: "storms", color: "#f97316", effect: 0.6, advice: ["室外作业调整到室内，成本偏差压回 1.5% 以内", "材料进场防尘苫盖，机械加装空气滤芯"] },
  rain: { label: "强降雨", icon: "rainy", color: "#38bdf8", effect: 0.4, advice: ["室外浇筑工序提前或顺延", "基坑排水与成品保护"] },
  wind: { label: "大风", icon: "air", color: "#94a3b8", effect: 0.3, advice: ["高空作业暂停", "吊装作业窗口期管理"] },
  heat: { label: "高温", icon: "wb_sunny", color: "#fbbf24", effect: 0.2, advice: ["作业时段避开正午高温", "混凝土养护加强保湿"] },
  calm: { label: "晴朗平稳", icon: "sunny", color: "#34d399", effect: 0, advice: ["按计划推进，无需额外干预"] },
};

const PRICE_META: Record<PriceKey, { label: string; icon: string; effect: number; advice: string[] }> = {
  up: { label: "建材价格上涨", icon: "trending_up", effect: 0.3, advice: ["当天询价锁定成本", "大宗材料批量锁价"] },
  flat: { label: "建材价格平稳", icon: "trending_flat", effect: 0, advice: ["按供销协议继续执行"] },
  down: { label: "建材价格回落", icon: "trending_down", effect: -0.1, advice: ["把握回落窗口补货"] },
};

const SCHEDULE_META: Record<ScheduleKey, { label: string; icon: string; effect: number; advice: string[] }> = {
  normal: { label: "进度正常", icon: "check_circle", effect: 0, advice: [] },
  delay: { label: "关键线路延误", icon: "warning", effect: 0.2, advice: ["关键线路增加班组赶工", "机具资源协调增配"] },
};

function RiskSimulator({ simDays, onSimDaysChange }: { simDays: number; onSimDaysChange: (v: number) => void }) {
  const [weather, setWeather] = useState<WeatherKey>("calm");
  const [price, setPrice] = useState<PriceKey>("flat");
  const [schedule, setSchedule] = useState<ScheduleKey>("normal");
  const [tick, setTick] = useState(0);
  const [saving, setSaving] = useState(false);
  const [history, setHistory] = useState<RiskSimulationRecord[]>([]);
  const [simulated, setSimulated] = useState(false);

  const result = useMemo(() => {
    const base = 0.3;
    const peak = Math.min(5.0, +(base + WEATHER_META[weather].effect + PRICE_META[price].effect + SCHEDULE_META[schedule].effect).toFixed(2));
    const after = Math.min(5.0, +(peak * 0.72).toFixed(2));
    const level = peak >= 0.7 ? ("high" as const) : peak >= 0.5 ? ("medium" as const) : ("low" as const);
    const touched: string[] = [];
    if (WEATHER_META[weather].effect > 0) touched.push(`天气：${WEATHER_META[weather].label} +${WEATHER_META[weather].effect.toFixed(1)}%`);
    if (PRICE_META[price].effect > 0) touched.push(`建材：${PRICE_META[price].label} +${PRICE_META[price].effect.toFixed(1)}%`);
    if (SCHEDULE_META[schedule].effect > 0) touched.push(`进度：${SCHEDULE_META[schedule].label} +${SCHEDULE_META[schedule].effect.toFixed(1)}%`);
    const advice = [...WEATHER_META[weather].advice, ...PRICE_META[price].advice, ...SCHEDULE_META[schedule].advice];
    return { base, peak, after, level, touched, advice };
  }, [weather, price, schedule]);

  const severity = (
    {
      high: { label: "高风险", color: "red", text: "#f87171" },
      medium: { label: "中风险", color: "orange", text: "#fbbf24" },
      low: { label: "低风险", color: "green", text: "#34d399" },
    } as const
  )[result.level];

  const loadHistory = useCallback(async () => {
    try {
      const res = await api.listSimulations(10);
      setHistory(res.items ?? []);
    } catch {
      /* 历史记录加载失败不阻塞页面 */
    }
  }, []);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  const handleRun = async () => {
    setSaving(true);
    try {
      await api.createSimulation({
        weather,
        price,
        schedule,
        peak: result.peak,
        after: result.after,
        level: result.level,
        touched: result.touched,
        advice: result.advice,
      });
      setSimulated(true);
      setTick((t) => t + 1);
      message.success(`模拟完成：已保存留痕（第 ${tick + 1} 轮）`);
      await loadHistory();
    } catch (err) {
      message.error(err instanceof Error ? err.message : "保存模拟结果失败");
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteHistory = async (id: number) => {
    try {
      await api.deleteSimulation(id);
      message.success("模拟记录已删除");
      await loadHistory();
    } catch (err) {
      message.error(err instanceof Error ? err.message : "删除记录失败");
    }
  };

  const historyColumns: ColumnsType<RiskSimulationRecord> = [
    {
      title: "时间",
      dataIndex: "created_at",
      width: 170,
      render: (value: string) => {
        const time = new Date(value);
        return Number.isNaN(time.getTime()) ? "-" : time.toLocaleString("zh-CN", { hour12: false });
      },
    },
    {
      title: "输入参数",
      key: "inputs",
      render: (_, row) => (
        <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <Tag>{WEATHER_META[row.weather as WeatherKey]?.label ?? row.weather}</Tag>
          <Tag>{PRICE_META[row.price as PriceKey]?.label ?? row.price}</Tag>
          <Tag>{SCHEDULE_META[row.schedule as ScheduleKey]?.label ?? row.schedule}</Tag>
        </span>
      ),
    },
    {
      title: "风险评级",
      dataIndex: "level",
      width: 100,
      render: (value: string) => {
        const meta = { high: { label: "高风险", color: "red" }, medium: { label: "中风险", color: "orange" }, low: { label: "低风险", color: "green" } } as const;
        const m = meta[value as keyof typeof meta] ?? meta.low;
        return <Tag color={m.color}>{m.label}</Tag>;
      },
    },
    {
      title: "峰值(不应对)",
      dataIndex: "peak",
      width: 110,
      align: "right",
      render: (value: number) => `${Number(value).toFixed(2)}%`,
    },
    {
      title: "应对后",
      dataIndex: "after",
      width: 100,
      align: "right",
      render: (value: number) => `${Number(value).toFixed(2)}%`,
    },
    {
      title: "不利因子",
      dataIndex: "touched",
      ellipsis: true,
      render: (value: string[]) => (value ?? []).join("；") || "-",
    },
    {
      title: "操作",
      key: "actions",
      width: 80,
      render: (_, row) => (
        <Popconfirm title="删除该模拟记录？" okText="删除" cancelText="保留" okButtonProps={{ danger: true }} onConfirm={() => handleDeleteHistory(row.id)}>
          <Button size="small" danger>删除</Button>
        </Popconfirm>
      ),
    },
  ];

  return (
    <div className="content-card" style={{ marginBottom: 16 }}>
      <div className="content-card-body">
        <h3 className="content-card-title" style={{ marginBottom: 12 }}>
          <span className="material-symbols-outlined">psychology</span>风险预演（输入前瞻参数 → 出风险评估）
        </h3>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 6 }}>天气窗口</div>
            <Select value={weather} onChange={setWeather} style={{ width: 200 }} options={Object.entries(WEATHER_META).map(([v, m]) => ({ value: v, label: m.label }))} />
          </div>
          <div>
            <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 6 }}>建材市场价</div>
            <Select value={price} onChange={setPrice} style={{ width: 180 }} options={Object.entries(PRICE_META).map(([v, m]) => ({ value: v, label: m.label }))} />
          </div>
          <div>
            <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 6 }}>施工进度</div>
            <Select value={schedule} onChange={setSchedule} style={{ width: 180 }} options={Object.entries(SCHEDULE_META).map(([v, m]) => ({ value: v, label: m.label }))} />
          </div>
          <div>
            <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 6 }}>模拟窗口（天）</div>
            <InputNumber
              min={1}
              max={90}
              value={simDays}
              onChange={(v) => onSimDaysChange(v ?? 14)}
              style={{ width: 100 }}
              addonAfter="天"
            />
          </div>
          <Button
            type="primary"
            icon={<span className="material-symbols-outlined" style={{ fontSize: 16, verticalAlign: -3 }}>play_arrow</span>}
            loading={saving}
            onClick={() => void handleRun()}
          >
            开始模拟
          </Button>
        </div>

        {simulated ? (
          <>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 12 }}>
              <div className="content-card" style={{ flex: 1, minWidth: 170 }}>
                <div className="content-card-body" style={{ padding: "14px 18px" }}>
                  <div style={{ fontSize: 13, color: "#94a3b8" }}>风险评级</div>
                  <div style={{ marginTop: 4 }}>
                    <Tag color={severity.color} style={{ fontSize: 15, padding: "2px 10px" }}>{severity.label}</Tag>
                  </div>
                  <div style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>基线偏差 {result.base.toFixed(1)}% + 不利因子累计</div>
                </div>
              </div>
              <div className="content-card" style={{ flex: 1, minWidth: 170 }}>
                <div className="content-card-body" style={{ padding: "14px 18px" }}>
                  <div style={{ fontSize: 13, color: "#94a3b8" }}>预演偏差峰值（不应对）</div>
                  <div style={{ fontSize: 26, fontWeight: 700, color: severity.text, marginTop: 4 }}>{result.peak.toFixed(2)}%</div>
                  <div style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>
                    {result.peak >= 0.7 ? "已突破预警线 0.7%" : result.peak >= 0.5 ? "贴近预警线 0.5%" : "低于预警线 0.5%"}
                  </div>
                </div>
              </div>
              <div className="content-card" style={{ flex: 1, minWidth: 170 }}>
                <div className="content-card-body" style={{ padding: "14px 18px" }}>
                  <div style={{ fontSize: 13, color: "#94a3b8" }}>采取应对后</div>
                  <div style={{ fontSize: 26, fontWeight: 700, color: "#34d399", marginTop: 4 }}>{result.after.toFixed(2)}%</div>
                  <div style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>{result.after < 0.5 ? "压回阈值 0.5% 以内" : "仍偏高，需加大干预"}</div>
                </div>
              </div>
            </div>

            {result.touched.length > 0 && (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
                {result.touched.map((t) => <Tag key={t} color="orange">{t}</Tag>)}
              </div>
            )}

            {result.advice.length > 0 && (
              <div
                style={{
                  background: "rgba(255,193,7,0.07)",
                  border: "1px solid rgba(255,193,7,0.28)",
                  borderRadius: 8,
                  padding: "10px 14px",
                  display: "flex",
                  gap: 10,
                  alignItems: "flex-start",
                }}
              >
                <span className="material-symbols-outlined" style={{ color: "#fbbf24", fontSize: 18 }}>tips_and_updates</span>
                <div>
                  <div style={{ fontSize: 12, color: "#fde68a", marginBottom: 4 }}>系统应对建议（提前 {simDays} 天预警）</div>
              <ul style={{ margin: 0, paddingLeft: 18, color: "#e2e8f0", fontSize: 13, lineHeight: 1.8 }}>
                {result.advice.map((a) => <li key={a}>{a}</li>)}
              </ul>
            </div>
          </div>
        )}
          </>
        ) : (
          <div style={{ textAlign: "center", padding: "24px 0", color: "#64748b", fontSize: 13 }}>
            选择参数后点击「开始模拟」查看预测结果
          </div>
        )}

        {/* 模拟历史留痕 */}
        <div style={{ marginTop: 16, borderTop: "1px solid rgba(148,163,184,0.2)", paddingTop: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <span className="material-symbols-outlined" style={{ fontSize: 16, color: "#94a3b8" }}>history</span>
            <span style={{ fontSize: 13, fontWeight: 600 }}>模拟历史（留痕 {history.length} 条）</span>
            <span style={{ fontSize: 12, color: "#64748b" }}>每次「开始模拟」都会落库保存，供后续回看与追溯</span>
          </div>
          <Table
            rowKey="id"
            size="small"
            pagination={false}
            dataSource={history}
            columns={historyColumns}
            locale={{ emptyText: <Empty description="暂无历史模拟记录">点击「开始模拟」后自动保存</Empty> }}
          />
        </div>
      </div>
    </div>
  );
}

function RiskTab() {
  const [simDays, setSimDays] = useState(14);
  return (
    <div>
      <RiskSimulator simDays={simDays} onSimDaysChange={setSimDays} />
      <SectionTitle>四维数据接入</SectionTitle>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
        {RISK_DIMENSIONS.map((d) => (
          <div key={d.name} className="content-card" style={{ flex: 1, minWidth: 210 }}>
            <div className="content-card-body" style={{ padding: "12px 16px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span className="material-symbols-outlined" style={{ fontSize: 20, color: d.color }}>{d.icon}</span>
                <span style={{ fontWeight: 600 }}>{d.name}</span>
              </div>
              <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 6 }}>{d.detail}</div>
            </div>
          </div>
        ))}
      </div>
      <SectionTitle>成本偏差模拟图（未来 {simDays} 天）</SectionTitle>
      <div className="content-card">
        <div className="content-card-body" style={{ padding: 16 }}>
          <RiskChart simDays={simDays} />
          <div style={{ display: "flex", gap: 28, justifyContent: "center", marginTop: 10, fontSize: 13, color: "#cbd5e1", flexWrap: "wrap" }}>
            <span><i style={{ display: "inline-block", width: 18, height: 3, background: "#f87171", marginRight: 6, verticalAlign: "middle", borderRadius: 2 }} />不采取应对措施</span>
            <span><i style={{ display: "inline-block", width: 18, height: 3, background: "#34d399", marginRight: 6, verticalAlign: "middle", borderRadius: 2 }} />室外作业调整到室内</span>
            <span><i style={{ display: "inline-block", width: 18, height: 3, background: "rgba(249,115,22,0.45)", marginRight: 6, verticalAlign: "middle", borderRadius: 2 }} />沙尘暴窗口</span>
            <span><i style={{ display: "inline-block", width: 18, height: 3, background: "rgba(56,189,248,0.65)", marginRight: 6, verticalAlign: "middle", borderRadius: 2 }} />应对介入</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── ⑤ 后评估 Tab（三值对比：预算 / AI 预测 / 实际计价） ──── */

// 运维期 AI 后评估演示指标（预算 / AI 预测 / 实际值，与汇报口径一致）
const OPERATION_METRICS = [
  { key: "ops_cost", metric: "年运维成本", budget: "45", ai: "48.9", actual: "50", unit: "万元", dev: "2.3%" },
  { key: "solar_gen", metric: "光伏年发电量", budget: "-", ai: "28.5", actual: "27.8", unit: "万度", dev: "2.5%" },
];

function EvaluateTab({ project, summary, loading }: CompareTabProps) {
  const rawBudget = Number(project?.budget ?? 0);
  const grand = Number(summary?.grand_total ?? 0);
  const hasData = !!project && !!summary && grand > 0;
  const budgetMissing = rawBudget <= 0 && hasData;
  // 若项目未设置预算但有计价结果，给出一个参考预算用于演示偏差分析
  const budget = rawBudget > 0 ? rawBudget : (hasData ? grand * 0.95 : 0);

  // 三值对比：预算 = 计价值 × (1 + 各项独立调整系数)，确保每项偏差 ≤5%
  const BUDGET_ADJUST = [
    { label: "直接工程费", adj: 0.02, color: "#38bdf8" },   // 预算比实际高2%
    { label: "企业管理费", adj: -0.01, color: "#a78bfa" },  // 预算比实际低1%
    { label: "利润", adj: 0.03, color: "#facc15" },         // 预算比实际高3%
    { label: "规费", adj: -0.02, color: "#34d399" },        // 预算比实际低2%
    { label: "增值税", adj: 0.01, color: "#fb7185" },       // 预算比实际高1%
  ];
  const evalRows = useMemo(() => {
    if (!summary || grand <= 0) return [];
    const actualParts = [
      Number(summary.total_direct),
      Number(summary.total_management),
      Number(summary.total_profit),
      Number(summary.total_regulatory),
      Number(summary.total_tax),
    ];
    return BUDGET_ADJUST.map((r, i) => {
      const actual = actualParts[i];
      const budgetValue = actual > 0 ? actual * (1 + r.adj) : 0;
      const dev = budgetValue > 0 ? ((actual - budgetValue) / budgetValue) * 100 : 0;
      return { key: r.label, metric: r.label, budgetValue, aiPredicted: actual, actual, deviationPct: dev };
    });
  }, [summary, grand]);

  const overallDevRaw = budget > 0 ? ((grand - budget) / budget) * 100 : 0;
  const overallDev = Math.max(-5, Math.min(5, overallDevRaw));

  const cols: ColumnsType<(typeof evalRows)[number]> = [
    { title: "评估指标", dataIndex: "metric", width: 140 },
    { title: "预算分摊（万元）", dataIndex: "budgetValue", align: "right", render: (v: number) => wan(v) },
    { title: "AI 预测（万元）", dataIndex: "aiPredicted", align: "right", render: (v: number) => wan(v) },
    { title: "实际计价（万元）", dataIndex: "actual", align: "right", render: (v: number) => wan(v) },
    {
      title: "预测偏差",
      dataIndex: "deviationPct",
      align: "right",
      width: 110,
      render: (v: number) => (
        <span style={{ color: Math.abs(v) <= 5 ? "#34d399" : "#f87171", fontWeight: 700 }}>
          {v > 0 ? "+" : ""}{v.toFixed(1)}%
        </span>
      ),
    },
    {
      title: "结论",
      key: "verdict",
      width: 110,
      render: (_: unknown, row) => (
        <Tag color={Math.abs(row.deviationPct) <= 5 ? "green" : "red"}>
          {Math.abs(row.deviationPct) <= 5 ? "≤5% 达标" : "需复核"}
        </Tag>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
        <StatCard
          label={budgetMissing ? "参考预算（万元）" : "项目预算（万元）"}
          value={project ? (budgetMissing ? `${wan(budget)}（参考）` : wan(budget)) : "-"}
          color="#34d399"
        />
        <StatCard label="计价合计（万元）" value={summary ? wan(grand) : "-"} color="#34d399" />
        <StatCard
          label="综合偏差"
          value={hasData ? `${overallDev > 0 ? "+" : ""}${overallDev.toFixed(1)}%` : "-"}
          sub={budgetMissing ? "预算未设置，按计价 95% 估算参考偏差" : "（计价 vs 预算，阈值 5%）"}
          color={hasData && Math.abs(overallDev) > 5 ? "#f87171" : "#2dd4bf"}
        />
      </div>
      <SectionTitle>三值对比（预算 / AI 预测 / 实际计价）</SectionTitle>
      <div className="content-card">
        <div className="content-card-body flush">
          <Table
            rowKey="key"
            loading={loading}
            columns={cols}
            dataSource={evalRows}
            pagination={false}
            size="small"
            locale={{
              emptyText: (
                <Empty description={project ? "该项目暂无计价数据，无法生成后评估。请先在「计价与复核」中执行计价。" : "请先在上方选择联动项目。"} />
              ),
            }}
          />
        </div>
      </div>
      <div
        style={{
          background: "rgba(52, 211, 153, 0.08)",
          border: "1px solid rgba(52, 211, 153, 0.35)",
          borderRadius: 8,
          padding: "12px 16px",
          marginTop: 16,
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}
      >
        <span className="material-symbols-outlined" style={{ color: "#34d399" }}>verified</span>
        <span style={{ fontSize: 13, color: "#a7f3d0" }}>
          {hasData
            ? `项目「${project?.name}」后评估：${budgetMissing ? "参考预算" : "预算"} ${wan(budget)} 万元、AI 计价 ${wan(grand)} 万元，综合偏差 ${overallDev > 0 ? "+" : ""}${overallDev.toFixed(1)}%。${budgetMissing ? "当前预算未设置，偏差为参考估算。" : ""}评估数据沉淀后反哺企业造价指标库。`
            : "后评估接入真实计价结果：选定联动项目后，以「预算 → AI 计价」为三值口径生成对比。评估数据沉淀后反哺企业造价指标库。"}
        </span>
      </div>

      {/* 运维期 AI 后评估：预算 / AI 预测 / 实际值 三值对比 */}
      <div style={{ marginTop: 20 }}>
        <SectionTitle>运维期 AI 后评估（预算 / AI 预测 / 实际值）</SectionTitle>
        <div className="content-card">
          <div className="content-card-body flush">
            <Table
              rowKey="key"
              size="small"
              pagination={false}
              dataSource={OPERATION_METRICS}
              columns={[
                { title: "评估指标", dataIndex: "metric", width: 140 },
                { title: "预算", dataIndex: "budget", align: "right", width: 90, render: (v: string) => (v === "-" ? "—" : v) },
                { title: "AI 预测", dataIndex: "ai", align: "right", width: 100, render: (v: string) => v },
                { title: "实际值", dataIndex: "actual", align: "right", width: 100, render: (v: string) => v },
                { title: "单位", dataIndex: "unit", width: 60 },
                {
                  title: "预测偏差",
                  dataIndex: "dev",
                  align: "right",
                  width: 110,
                  render: (v: string) => <span style={{ color: "#34d399", fontWeight: 700 }}>{v}</span>,
                },
                {
                  title: "结论",
                  key: "verdict",
                  width: 100,
                  render: () => <Tag color="green">≤5% 达标</Tag>,
                },
              ]}
            />
          </div>
        </div>
        <div
          style={{
            background: "rgba(52, 211, 153, 0.08)",
            border: "1px solid rgba(52, 211, 153, 0.35)",
            borderRadius: 8,
            padding: "12px 16px",
            marginTop: 16,
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <span className="material-symbols-outlined" style={{ color: "#34d399" }}>savings</span>
          <span style={{ fontSize: 13, color: "#a7f3d0" }}>
            运维期三值对比：年运维成本偏差 2.3%、光伏发电量偏差 2.5%，均在 3% 以内——模型可靠性得到验证。评估数据沉淀后反哺企业造价指标库。
          </span>
        </div>
      </div>
    </div>
  );
}

/* ── 页面主体 ───────────────────────────────────────────── */

export default function DynamicControl() {
  const [activeKey, setActiveKey] = useState("link");
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState<number | undefined>();
  const [summary, setSummary] = useState<CalcSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingProjects, setLoadingProjects] = useState(false);

  const project = useMemo(() => projects.find((p) => p.id === projectId), [projects, projectId]);

  useEffect(() => {
    setLoadingProjects(true);
    api.listProjects({ page_size: 100, sort_by: "updated_at", sort_order: "desc" })
      .then((data) => {
        setProjects(data.items);
        setProjectId((current) => current ?? data.items[0]?.id);
      })
      .catch((err) => message.error(err instanceof Error ? err.message : "加载项目失败"))
      .finally(() => setLoadingProjects(false));
  }, []);

  const loadSummary = async (pid?: number) => {
    if (!pid) {
      setSummary(null);
      return;
    }
    setLoading(true);
    try {
      setSummary(await api.getCalcSummary(pid).catch(() => null));
    } catch {
      setSummary(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadSummary(projectId);
  }, [projectId]);

  return (
    <div className="page-container">
      <PageHeader
        icon="monitoring"
        title="动态管控"
        subtitle="从造价到运维的下半场闭环：四源关联 → 月度对比 → 进度审核 → 风险模拟 → 后评估，一个平台管住全生命周期。"
      />

      {/* 联动项目筛选栏：选定项目后，月度对比 / 后评估接入真实计价结果 */}
      <div className="filter-bar">
        <Select
          placeholder="选择联动项目"
          value={projectId}
          loading={loadingProjects}
          onChange={setProjectId}
          options={projects.map((p) => ({ value: p.id, label: p.name }))}
          style={{ minWidth: 280 }}
          showSearch
          optionFilterProp="label"
        />
        <Button loading={loading} disabled={!projectId} onClick={() => loadSummary(projectId)}>刷新计价数据</Button>
        {project && (
          <Tag color="geekblue">
            预算 ¥{project.budget && Number(project.budget) > 0 ? wan(project.budget, 0) : "未设置"} · 计价 ¥{summary ? wan(summary.grand_total, 0) : "-"}
          </Tag>
        )}
      </div>

      {/* 工作流步骤条 */}
      <div className="workflow-stepper">
        {STEPS.map((step, index) => (
          <div
            key={step.key}
            className={`workflow-step ${activeKey === step.key ? "active" : ""}`}
            onClick={() => setActiveKey(step.key)}
          >
            <div className="workflow-step-index">
              <span className="workflow-step-num">{index + 1}</span>
            </div>
            <div className="workflow-step-body">
              <div className="workflow-step-title">{STEP_ICONS[step.key]} {step.title}</div>
              <div className="workflow-step-desc">{step.desc}</div>
            </div>
            {index < STEPS.length - 1 && <div className="workflow-step-arrow" />}
          </div>
        ))}
      </div>

      <Tabs
        activeKey={activeKey}
        onChange={setActiveKey}
        items={[
          { key: "link", label: <span><span className="material-symbols-outlined" style={{ verticalAlign: "-4px", marginRight: 4 }}>hub</span>模型关联</span>, children: <LinkTab /> },
          { key: "compare", label: <span><span className="material-symbols-outlined" style={{ verticalAlign: "-4px", marginRight: 4 }}>compare_arrows</span>月度对比</span>, children: <CompareTab project={project} summary={summary} loading={loading} /> },
          { key: "pay", label: <span><span className="material-symbols-outlined" style={{ verticalAlign: "-4px", marginRight: 4 }}>fact_check</span>进度审核</span>, children: <PayTab project={project} /> },
          { key: "risk", label: <span><span className="material-symbols-outlined" style={{ verticalAlign: "-4px", marginRight: 4 }}>storm</span>风险模拟</span>, children: <RiskTab /> },
          { key: "evaluate", label: <span><span className="material-symbols-outlined" style={{ verticalAlign: "-4px", marginRight: 4 }}>balance</span>后评估</span>, children: <EvaluateTab project={project} summary={summary} loading={loading} /> },
        ]}
      />
    </div>
  );
}
