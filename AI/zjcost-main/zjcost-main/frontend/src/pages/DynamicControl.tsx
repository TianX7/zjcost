import { useEffect, useRef, useState, type ReactNode } from "react";
import { Table, Tabs, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import * as d3 from "d3";
import PageHeader from "../components/PageHeader";

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

interface DeviationRow {
  key: string;
  item: string;
  planned: number;
  actual: number;
  deviationRate: number;
  level: "normal" | "yellow";
  action: string;
}

const DEVIATION_ROWS: DeviationRow[] = [
  { key: "1", item: "钢材采购（HRB400E）", planned: 86.5, actual: 89.8, deviationRate: 3.8, level: "yellow", action: "当日询价锁定，签订补充协议" },
  { key: "2", item: "商品混凝土 C30", planned: 42.3, actual: 42.9, deviationRate: 1.4, level: "normal", action: "" },
  { key: "3", item: "砌块与砂浆", planned: 18.6, actual: 18.2, deviationRate: -2.2, level: "normal", action: "" },
  { key: "4", item: "人工费（瓦工班）", planned: 25.0, actual: 24.7, deviationRate: -1.2, level: "normal", action: "" },
  { key: "5", item: "机械台班（塔吊/搅拌）", planned: 12.4, actual: 12.5, deviationRate: 0.8, level: "normal", action: "" },
];

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

const PAY_ROWS: PayRow[] = [
  { key: "1", payNo: "PAY-2026-011", period: "第 11 期", amount: 156.8, declaredPct: 98.5, aiVerifiedPct: 98.6, result: "pass", time: "2026-08-05 09:42", traceNo: "AI-VC-20260805-011" },
  { key: "2", payNo: "PAY-2026-010", period: "第 10 期", amount: 143.2, declaredPct: 96.0, aiVerifiedPct: 96.2, result: "pass", time: "2026-07-05 10:18", traceNo: "AI-VC-20260705-010" },
  { key: "3", payNo: "PAY-2026-009", period: "第 9 期", amount: 128.5, declaredPct: 95.0, aiVerifiedPct: 91.2, result: "reject", time: "2026-06-05 15:07", traceNo: "AI-VC-20260605-009" },
  { key: "4", payNo: "PAY-2026-008", period: "第 8 期", amount: 119.7, declaredPct: 94.0, aiVerifiedPct: 94.3, result: "pass", time: "2026-05-05 09:31", traceNo: "AI-VC-20260505-008" },
  { key: "5", payNo: "PAY-2026-007", period: "第 7 期", amount: 108.4, declaredPct: 92.0, aiVerifiedPct: 92.1, result: "pass", time: "2026-04-05 11:05", traceNo: "AI-VC-20260405-007" },
];

/* ── ④ 风险模拟：四维数据 ─────────────────────────────────── */

const RISK_DIMENSIONS = [
  { name: "历史造价", detail: "同类荒漠地区项目 38 个成本样本", icon: "history", color: "#38bdf8" },
  { name: "进度计划", detail: "关键线路作业 216 项 · 资源直方图", icon: "event_note", color: "#a78bfa" },
  { name: "荒漠风沙天气", detail: "气象数据接入 · 未来 14 天沙尘暴窗口", icon: "storm", color: "#f97316" },
  { name: "建材市场价", detail: "钢材/水泥/燃油 60 日价格序列", icon: "trending_up", color: "#34d399" },
];

// 成本偏差模拟序列（%）：无应对 vs 应对后，横轴未来 14 天
const RISK_NO_ACTION = [1.2, 1.25, 1.3, 1.38, 1.45, 1.52, 1.58, 1.63, 1.68, 1.72, 1.76, 1.81, 1.85, 1.88, 1.9];
const RISK_WITH_ACTION = [1.2, 1.25, 1.3, 1.35, 1.4, 1.43, 1.45, 1.44, 1.42, 1.4, 1.38, 1.36, 1.34, 1.33, 1.32];

/* ── ⑤ 后评估：三值对比 ──────────────────────────────────── */

interface EvalRow {
  key: string;
  metric: string;
  unit: string;
  budget: number | null;
  aiPredicted: number | null;
  actual: number;
  deviationPct: number;
}

const EVAL_ROWS: EvalRow[] = [
  { key: "1", metric: "年运维成本", unit: "万元", budget: 4.5, aiPredicted: 4.3, actual: 4.2, deviationPct: 2.3 },
  { key: "2", metric: "光伏年发电量", unit: "万度", budget: null, aiPredicted: 2.75, actual: 2.82, deviationPct: 2.5 },
];

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

/* ── ② 月度对比 Tab ─────────────────────────────────────── */

function CompareTab() {
  const totalPlanned = DEVIATION_ROWS.reduce((s, r) => s + r.planned, 0);
  const totalActual = DEVIATION_ROWS.reduce((s, r) => s + r.actual, 0);
  const totalDev = ((totalActual - totalPlanned) / totalPlanned) * 100;

  const cols: ColumnsType<DeviationRow> = [
    { title: "成本项", dataIndex: "item" },
    { title: "计划成本（万元）", dataIndex: "planned", align: "right", render: (v: number) => v.toFixed(1) },
    { title: "实际成本（万元）", dataIndex: "actual", align: "right", render: (v: number) => v.toFixed(1) },
    {
      title: "偏差率",
      dataIndex: "deviationRate",
      align: "right",
      width: 100,
      render: (v: number) => (
        <span style={{ color: v > 3 ? "#fbbf24" : v < 0 ? "#34d399" : "#cbd5e1", fontWeight: v > 3 ? 700 : 400 }}>
          {v > 0 ? "+" : ""}{v.toFixed(1)}%
        </span>
      ),
    },
    {
      title: "预警",
      dataIndex: "level",
      width: 90,
      render: (v: DeviationRow["level"]) =>
        v === "yellow" ? <Tag color="warning">🟡 黄色预警</Tag> : <Tag color="green">正常</Tag>,
    },
    { title: "处置", dataIndex: "action", ellipsis: true, render: (v: string) => v || "—" },
  ];

  return (
    <div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
        <StatCard label="本月计划成本" value={`${totalPlanned.toFixed(1)} 万`} color="#2dd4bf" />
        <StatCard label="本月实际成本" value={`${totalActual.toFixed(1)} 万`} color="#2dd4bf" />
        <StatCard label="综合偏差率" value={`${totalDev > 0 ? "+" : ""}${totalDev.toFixed(1)}%`} sub="预警阈值 +3%" color={totalDev > 3 ? "#fbbf24" : "#2dd4bf"} />
      </div>
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
          <b>黄色预警</b>：本月钢材价差 +3.8% 触发黄色预警（阈值 3%）——已于当天询价锁定，价格波动风险闭环。
        </span>
      </div>
      <SectionTitle>逐项偏差对比（系统自动生成）</SectionTitle>
      <div className="content-card">
        <div className="content-card-body flush">
          <Table rowKey="key" columns={cols} dataSource={DEVIATION_ROWS} pagination={false} size="small" />
        </div>
      </div>
    </div>
  );
}

/* ── ③ 进度审核 Tab ─────────────────────────────────────── */

function PayTab() {
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
        <StatCard label="支付审核准确率" value="99.2%" sub="AI 校验 vs 人工复核" color="#2dd4bf" />
        <StatCard label="累计校验笔数" value="128 笔" sub="每笔支付前自动校验" color="#2dd4bf" />
        <StatCard label="自动放行" value="127 笔" sub="确认无误才放行" color="#2dd4bf" />
        <StatCard label="驳回复核" value="1 笔" sub="工程量完成度不足" color="#f87171" />
      </div>
      <SectionTitle>AI 支付校验记录（全程留痕，可追溯）</SectionTitle>
      <div className="content-card">
        <div className="content-card-body flush">
          <Table rowKey="key" columns={cols} dataSource={PAY_ROWS} pagination={false} size="small" />
        </div>
      </div>
      <p style={{ fontSize: 12, color: "#94a3b8", marginTop: 10 }}>
        每笔支付前，AI 依据 BIM 模型进度与现场数据自动校验工程量完成度，核定值 ≥ 申报值才放行；
        差异超阈值即驳回复核，全部记录写入审计流水。
      </p>
    </div>
  );
}

/* ── ④ 风险模拟 Tab ─────────────────────────────────────── */

/* 成本偏差模拟图（d3 交互式）：平滑曲线 + 渐变面积 + 沙尘暴窗口 + 应对干预线 + 悬停十字线 */
function RiskChart() {
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
    const x = d3.scaleLinear().domain([0, 14]).range([0, iw]);
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

    // 沙尘暴窗口（D+8 ~ D+11）
    g.append("rect").attr("x", x(8)).attr("y", 0).attr("width", x(11) - x(8)).attr("height", ih).attr("fill", "rgba(249,115,22,0.10)");
    g.append("line").attr("x1", x(8)).attr("x2", x(8)).attr("y1", 0).attr("y2", ih).attr("stroke", "rgba(251,146,60,0.5)").attr("stroke-dasharray", "4 4");
    g.append("line").attr("x1", x(11)).attr("x2", x(11)).attr("y1", 0).attr("y2", ih).attr("stroke", "rgba(251,146,60,0.5)").attr("stroke-dasharray", "4 4");
    g.append("text").attr("x", (x(8) + x(11)) / 2).attr("y", -10).attr("text-anchor", "middle").attr("font-size", 12).attr("fill", "#fb923c").text("沙尘暴窗口 D+8 ~ D+11");

    // 横向网格 + 纵轴刻度
    [0, 0.5, 1.0, 1.5, 2.0].forEach((v) => {
      g.append("line").attr("x1", 0).attr("x2", iw).attr("y1", y(v)).attr("y2", y(v)).attr("stroke", "rgba(148,163,184,0.16)");
      g.append("text").attr("x", -10).attr("y", y(v) + 4).attr("text-anchor", "end").attr("font-size", 12).attr("fill", "#94a3b8").text(`${v.toFixed(1)}%`);
    });
    // 横轴刻度（每 2 天）
    for (let d = 0; d <= 14; d += 2) {
      g.append("line").attr("x1", x(d)).attr("x2", x(d)).attr("y1", ih).attr("y2", ih + 5).attr("stroke", "rgba(148,163,184,0.4)");
      g.append("text").attr("x", x(d)).attr("y", ih + 20).attr("text-anchor", "middle").attr("font-size", 12).attr("fill", "#94a3b8").text(`D+${d}`);
    }
    g.append("line").attr("x1", 0).attr("x2", iw).attr("y1", ih).attr("y2", ih).attr("stroke", "rgba(148,163,184,0.35)");

    // 预警阈值线
    const thr = (v: number, color: string, label: string) => {
      g.append("line").attr("x1", 0).attr("x2", iw).attr("y1", y(v)).attr("y2", y(v)).attr("stroke", color).attr("stroke-width", 1.4).attr("stroke-dasharray", "7 5");
      g.append("text").attr("x", 6).attr("y", y(v) - 6).attr("font-size", 12).attr("fill", color).text(label);
    };
    thr(1.5, "#fbbf24", "预警线 1.5%");
    thr(1.8, "#f87171", "突破线 1.8%");

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
    g.append("circle").attr("cx", x(14)).attr("cy", y(RISK_NO_ACTION[14])).attr("r", 5).attr("fill", "#f87171").attr("stroke", "#fecaca").attr("stroke-width", 1.5);
    g.append("text").attr("x", x(14) - 12).attr("y", y(RISK_NO_ACTION[14]) - 12).attr("text-anchor", "end").attr("font-size", 13).attr("font-weight", 700).attr("fill", "#fca5a5").text("无应对 1.90%");
    g.append("circle").attr("cx", x(6)).attr("cy", y(RISK_WITH_ACTION[6])).attr("r", 5).attr("fill", "#34d399").attr("stroke", "#a7f3d0").attr("stroke-width", 1.5);
    g.append("text").attr("x", x(6) + 12).attr("y", y(RISK_WITH_ACTION[6]) + 22).attr("font-size", 13).attr("font-weight", 700).attr("fill", "#6ee7b7").text("应对后峰值 1.45%");

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
        const day = Math.min(14, Math.max(0, Math.round(x.invert(mx))));
        cross.style("display", null);
        cross.select(".cross-line").attr("x1", x(day)).attr("x2", x(day));
        dotR.attr("cx", x(day)).attr("cy", y(RISK_NO_ACTION[day]));
        dotG.attr("cx", x(day)).attr("cy", y(RISK_WITH_ACTION[day]));
        const flip = x(day) + m.l > width - 190;
        tip.style("display", "block")
          .style("left", `${flip ? x(day) + m.l - 178 : x(day) + m.l + 14}px`)
          .style("top", `${Math.max(4, y(RISK_NO_ACTION[day]) + m.t - 30)}px`)
          .html(
            `<b>D+${day}</b><br/>` +
            `<span style="color:#fca5a5">■ 无应对 ${RISK_NO_ACTION[day].toFixed(2)}%</span><br/>` +
            `<span style="color:#6ee7b7">■ 应对后 ${RISK_WITH_ACTION[day].toFixed(2)}%</span>`
          );
      })
      .on("mouseleave", () => {
        cross.style("display", "none");
        tip.style("display", "none");
      });
  }, [width]);

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

function RiskTab() {
  return (
    <div>
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
      <div
        style={{
          background: "rgba(249, 115, 22, 0.08)",
          border: "1px solid rgba(249, 115, 22, 0.35)",
          borderRadius: 8,
          padding: "12px 16px",
          marginBottom: 16,
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}
      >
        <span className="material-symbols-outlined" style={{ color: "#fb923c" }}>campaign</span>
        <span style={{ fontSize: 13, color: "#fed7aa" }}>
          <b>提前 14 天预警</b>：未来 14 天出现沙尘暴窗口，成本偏差可能突破 <b>1.8%</b>。
          应对措施：室外作业调整到室内 → 偏差压回 <b>1.5% 以内</b>。
        </span>
      </div>
      <SectionTitle>成本偏差模拟图（未来 14 天）</SectionTitle>
      <div className="content-card">
        <div className="content-card-body" style={{ padding: 16 }}>
          <RiskChart />
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

/* ── ⑤ 后评估 Tab ───────────────────────────────────────── */

function EvaluateTab() {
  const cols: ColumnsType<EvalRow> = [
    { title: "评估指标", dataIndex: "metric", width: 150 },
    { title: "单位", dataIndex: "unit", width: 80 },
    { title: "预算值", dataIndex: "budget", align: "right", render: (v: number | null) => (v == null ? "—" : v.toFixed(2)) },
    { title: "AI 预测值", dataIndex: "aiPredicted", align: "right", render: (v: number | null) => (v == null ? "—" : v.toFixed(2)) },
    { title: "实际值", dataIndex: "actual", align: "right", render: (v: number) => v.toFixed(2) },
    {
      title: "预测偏差",
      dataIndex: "deviationPct",
      align: "right",
      width: 110,
      render: (v: number) => (
        <span style={{ color: v <= 3 ? "#34d399" : "#f87171", fontWeight: 700 }}>{v.toFixed(1)}%</span>
      ),
    },
    {
      title: "结论",
      key: "verdict",
      width: 110,
      render: () => <Tag color="green">≤3% 达标</Tag>,
    },
  ];
  return (
    <div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
        <StatCard label="运维成本偏差" value="2.3%" sub="AI 预测 4.3 万 vs 实际 4.2 万" color="#34d399" />
        <StatCard label="发电量偏差" value="2.5%" sub="AI 预测 2.75 万度 vs 实际 2.82 万度" color="#34d399" />
        <StatCard label="可靠性阈值" value="3% 以内" sub="两项偏差均达标" color="#2dd4bf" />
      </div>
      <SectionTitle>三值对比（预算 / AI 预测 / 实际）</SectionTitle>
      <div className="content-card">
        <div className="content-card-body flush">
          <Table rowKey="key" columns={cols} dataSource={EVAL_ROWS} pagination={false} size="small" />
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
          运维期 AI 后评估：年运维成本预算 4.5 万、AI 预测 4.3 万、实际 4.2 万，偏差 2.3%；
          光伏年发电量 AI 预测 2.75 万度、实际 2.82 万度，偏差 2.5%——均在 3% 以内，模型可靠性得到验证。
          评估数据沉淀后反哺企业造价指标库。
        </span>
      </div>
    </div>
  );
}

/* ── 页面主体 ───────────────────────────────────────────── */

export default function DynamicControl() {
  const [activeKey, setActiveKey] = useState("link");

  return (
    <div className="page-container">
      <PageHeader
        icon="monitoring"
        title="动态管控"
        subtitle="从造价到运维的下半场闭环：四源关联 → 月度对比 → 进度审核 → 风险模拟 → 后评估，一个平台管住全生命周期。"
      />

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
          { key: "compare", label: <span><span className="material-symbols-outlined" style={{ verticalAlign: "-4px", marginRight: 4 }}>compare_arrows</span>月度对比</span>, children: <CompareTab /> },
          { key: "pay", label: <span><span className="material-symbols-outlined" style={{ verticalAlign: "-4px", marginRight: 4 }}>fact_check</span>进度审核</span>, children: <PayTab /> },
          { key: "risk", label: <span><span className="material-symbols-outlined" style={{ verticalAlign: "-4px", marginRight: 4 }}>storm</span>风险模拟</span>, children: <RiskTab /> },
          { key: "evaluate", label: <span><span className="material-symbols-outlined" style={{ verticalAlign: "-4px", marginRight: 4 }}>balance</span>后评估</span>, children: <EvaluateTab /> },
        ]}
      />
    </div>
  );
}
