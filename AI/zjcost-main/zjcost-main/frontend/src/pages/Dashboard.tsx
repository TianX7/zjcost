import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Empty, Space, Spin, Tag, message } from "antd";
import { FolderAddOutlined, PlusOutlined, ReloadOutlined } from "@ant-design/icons";
import type { CalcSummary, DashboardSummary, Project, ValuationOverview } from "../api";
import { api } from "../api";
import { createSampleProject } from "../sampleProject";

function useCountUp(target: number, duration = 700) {
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
      setVal(Math.round(start + diff * eased));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    prev.current = target;
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return val;
}

interface ProjectStats {
  project: Project;
  dash?: DashboardSummary;
  calc?: CalcSummary;
  valuation?: ValuationOverview;
}

interface FlowStep {
  key: string;
  icon: string;
  title: string;
  desc: string;
  route: string;
  done: boolean;
  current?: boolean;
  metric: string;
}

const CONCURRENCY = 4;

async function runWithConcurrency<T>(items: T[], limit: number, worker: (item: T) => Promise<void>) {
  const queue = [...items];
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (queue.length) {
      const item = queue.shift();
      if (item !== undefined) await worker(item);
    }
  });
  await Promise.all(runners);
}

function money(value: number | null | undefined) {
  const n = Number(value ?? 0);
  if (n >= 100000000) return `¥${(n / 100000000).toFixed(2)}亿`;
  if (n >= 10000) return `¥${(n / 10000).toFixed(1)}万`;
  return `¥${n.toLocaleString("zh-CN", { maximumFractionDigits: 0 })}`;
}

function pct(done: number, total: number) {
  if (total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((done / total) * 100)));
}

/** 平滑曲线（中点二次贝塞尔） */
function smoothPath(pts: Array<[number, number]>) {
  if (pts.length < 2) return "";
  let d = `M ${pts[0][0]} ${pts[0][1]}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i][0] + pts[i + 1][0]) / 2;
    const my = (pts[i][1] + pts[i + 1][1]) / 2;
    d += ` Q ${pts[i][0]} ${pts[i][1]} ${mx} ${my}`;
  }
  const last = pts[pts.length - 1];
  d += ` L ${last[0]} ${last[1]}`;
  return d;
}

interface DonutSegment {
  label: string;
  value: number;
  color: string;
}

function DonutChart({ data, size = 150, stroke = 18, centerLabel }: { data: DonutSegment[]; size?: number; stroke?: number; centerLabel?: string }) {
  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  const r = (size - stroke) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const circumference = 2 * Math.PI * r;
  const dasharray = data.map((item) => `${(item.value / total) * circumference} ${circumference}`);
  const offsets = data.reduce<number[]>((list, _item, index) => {
    const prev = data.slice(0, index).reduce((s, d) => s + d.value, 0);
    list.push((-prev / total) * circumference);
    return list;
  }, []);
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="dash-donut">
      <defs>
        {data.map((item) => (
          <linearGradient key={item.label} id={`grad-${item.label}`} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={item.color} />
            <stop offset="100%" stopColor={item.color} stopOpacity={0.6} />
          </linearGradient>
        ))}
        <filter id="donut-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="3" result="coloredBlur" />
          <feMerge>
            <feMergeNode in="coloredBlur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(148,163,184,0.08)" strokeWidth={stroke} />
      {data.map((item, index) => (
        <circle
          key={item.label}
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke={`url(#grad-${item.label})`}
          strokeWidth={stroke}
          strokeDasharray={dasharray[index]}
          strokeDashoffset={offsets[index]}
          transform={`rotate(-90 ${cx} ${cy})`}
          strokeLinecap="butt"
          filter="url(#donut-glow)"
          className="dash-donut-segment"
        />
      ))}
      <text x={cx} y={cy - 4} textAnchor="middle" fill="var(--text-primary)" fontSize="13" fontWeight="700">{centerLabel ?? "总计"}</text>
      <text x={cx} y={cy + 14} textAnchor="middle" fill="#38bdf8" fontSize="12" fontWeight="700">{`${Math.round(total / 10000)}万`}</text>
    </svg>
  );
}

function BarTrend({ data, color = "#38bdf8", height = 120, width = 360 }: { data: number[]; color?: string; height?: number; width?: number }) {
  if (data.length < 2) return null;
  const max = Math.max(...data, 1);
  const padBottom = 28;
  const padTop = 18;
  const padX = 24;
  const chartW = width - padX * 2;
  const chartH = height - padTop - padBottom;
  const gap = 10;
  const barW = (chartW - gap * (data.length - 1)) / data.length;
  const bars = data.map((v, i) => {
    const h = (v / max) * chartH * 0.9;
    const x = padX + i * (barW + gap);
    const y = height - padBottom - h;
    return { x, y, w: barW, h, v };
  });
  const labels = ["-6", "-5", "-4", "-3", "-2", "-1", "0"];
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="dash-bartrend">
      <defs>
        <linearGradient id="bar-gradient" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} />
          <stop offset="100%" stopColor={color} stopOpacity={0.4} />
        </linearGradient>
        <filter id="bar-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="2" result="coloredBlur" />
          <feMerge>
            <feMergeNode in="coloredBlur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      {[0, 0.5, 1].map((ratio, i) => {
        const y = height - padBottom - ratio * chartH;
        return <line key={i} x1={padX} y1={y} x2={width - padX} y2={y} stroke="rgba(148,163,184,0.08)" strokeDasharray="3 3" />;
      })}
      {bars.map((b, i) => (
        <g key={i} className="dash-bartrend-bar" style={{ animationDelay: `${i * 0.05}s` }}>
          <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={4} fill="url(#bar-gradient)" />
          <text x={b.x + b.w / 2} y={b.y - 6} textAnchor="middle" fill={i === bars.length - 1 ? color : "var(--text-secondary)"} fontSize="10" fontWeight={i === bars.length - 1 ? 700 : 500}>{b.v}</text>
          <text x={b.x + b.w / 2} y={height - 8} textAnchor="middle" fill="var(--text-muted)" fontSize="11">{labels[i]}</text>
        </g>
      ))}
    </svg>
  );
}

/* ─── 运营期设施总览（首页实时遥测卡片） ─────────────────── */

function MiniSpark({ data, color, width = 240, height = 52 }: { data: number[]; color: string; width?: number; height?: number }) {
  if (data.length < 2) return null;
  const top = Math.max(...data) * 1.06;
  const min = Math.min(...data) * 0.92;
  const range = Math.max(top - min, 0.001);
  const pts = data.map((v, i) => [
    (i / (data.length - 1)) * width,
    height - 4 - ((v - min) / range) * (height - 10),
  ] as [number, number]);
  const line = smoothPath(pts);
  const area = `${line} L ${width} ${height} L 0 ${height} Z`;
  const last = pts[pts.length - 1];
  const gid = `spark-${color.replace("#", "")}`;
  return (
    <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="dash-ops-spark">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.32" />
          <stop offset="100%" stopColor={color} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gid})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <circle cx={last[0]} cy={last[1]} r="3.5" fill={color}>
        <animate attributeName="r" values="2.5;4.5;2.5" dur="1.6s" repeatCount="indefinite" />
      </circle>
    </svg>
  );
}

interface OpsMetric {
  label: string;
  value: string;
}

function OpsPulseCard({ title, status, icon, route, color, data, metrics }: {
  title: string; status: string; icon: string; route: string; color: string; data: number[]; metrics: OpsMetric[];
}) {
  const navigate = useNavigate();
  return (
    <button type="button" className="dash-ops-card" onClick={() => navigate(route)}>
      <div className="dash-ops-card-head">
        <span className="dash-ops-card-icon" style={{ background: `${color}1a`, color }}>
          <span className="material-symbols-outlined">{icon}</span>
        </span>
        <div className="dash-ops-card-title">
          <strong>{title}</strong>
          <em>{status}</em>
        </div>
        <span className="dash-ops-live" style={{ color }}><i style={{ background: color }} />LIVE</span>
      </div>
      <MiniSpark data={data} color={color} />
      <div className="dash-ops-card-metrics">
        {metrics.map((m) => (
          <div key={m.label}>
            <em>{m.label}</em>
            <strong>{m.value}</strong>
          </div>
        ))}
      </div>
      <span className="material-symbols-outlined dash-ops-card-arrow">arrow_forward</span>
      <span className="dash-ops-card-pulse" style={{ background: `radial-gradient(circle, ${color}22, transparent 70%)` }} />
    </button>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<Project[]>([]);
  const [stats, setStats] = useState<Map<number, ProjectStats>>(new Map());
  const [loading, setLoading] = useState(true);
  const [creatingSample, setCreatingTour] = useState(false);
  // 遥测心跳：驱动首页实时时钟与运营设施迷你曲线
  const [opsClock, setOpsClock] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setOpsClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const now = new Date(opsClock);
  // 曲线按 3 秒节拍推进（与专题页一致的舒缓节奏），时钟仍每秒跳动
  const opsTick = Math.floor(opsClock / 3000);
  const pvSeries = Array.from({ length: 24 }, (_, i) => {
    const x = opsTick * 3 - (23 - i) * 45;
    return 40 + Math.sin(x / 9) * 9 + Math.sin(x / 2.7) * 3 + Math.sin(x / 31) * 4;
  });
  const waterSeries = Array.from({ length: 24 }, (_, i) => {
    const x = opsTick * 3 - (23 - i) * 45;
    return 32.2 + Math.sin(x / 11) * 2.4 + Math.sin(x / 3.3) * 0.9;
  });
  const healthSeries = Array.from({ length: 24 }, (_, i) => {
    const x = opsTick * 3 - (23 - i) * 45;
    return 93 + Math.sin(x / 13) * 1.6 + Math.sin(x / 4.1) * 0.5;
  });
  const pvPower = pvSeries[pvSeries.length - 1];
  const todayKwh = Math.round(96 + (now.getHours() * 60 + now.getMinutes()) * 0.13);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.listProjects({ page_size: 12, sort_by: "updated_at", sort_order: "desc" });
      setProjects(res.items);
      const next = new Map<number, ProjectStats>();
      await runWithConcurrency(res.items, CONCURRENCY, async (project) => {
        const [dash, calc, valuation] = await Promise.all([
          api.getDashboardSummary(project.id).catch(() => undefined),
          api.getCalcSummary(project.id).catch(() => undefined),
          api.getValuationOverview(project.id).catch(() => undefined),
        ]);
        next.set(project.id, { project, dash, calc, valuation });
      });
      setStats(next);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "加载驾驶舱失败，请确认后端服务已启动");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const allStats = useMemo(() => Array.from(stats.values()), [stats]);
  const top = allStats[0];
  const topProject = top?.project ?? projects[0];
  const boqCount = top?.dash?.boq_count ?? 0;
  const unboundCount = top?.dash?.unbound_count ?? 0;
  const boundCount = Math.max(0, boqCount - unboundCount);
  const bindRate = pct(boundCount, boqCount);
  const hasCalc = Number(top?.calc?.grand_total ?? 0) > 0;
  const validationIssues = top?.dash?.validation_total ?? 0;
  const maintenanceCount =
    (top?.valuation?.measurement_count ?? 0) +
    (top?.valuation?.adjustment_count ?? 0) +
    (top?.valuation?.payment_count ?? 0);

  const totals = useMemo(() => {
    const active = projects.filter((project) => project.status !== "archived").length;
    const totalBoq = allStats.reduce((sum, item) => sum + (item.dash?.boq_count ?? 0), 0);
    const totalUnbound = allStats.reduce((sum, item) => sum + (item.dash?.unbound_count ?? 0), 0);
    const totalCost = allStats.reduce((sum, item) => sum + Number(item.calc?.grand_total ?? 0), 0);
    const issues = allStats.reduce((sum, item) => sum + (item.dash?.validation_total ?? 0), 0);
    return { active, totalBoq, totalUnbound, totalCost, issues };
  }, [allStats, projects]);

  const portfolioBindRate = pct(totals.totalBoq - totals.totalUnbound, totals.totalBoq);

  const costComposition = useMemo<DonutSegment[]>(() => {
    const c = top?.calc;
    const realTotal = c?.grand_total ?? totals.totalCost;
    const base = realTotal && realTotal > 100 ? realTotal : 1500000;
    const safe = (n: number | undefined, ratio: number) => (n && n > 0 ? n : Math.round(base * ratio));
    return [
      { label: "直接费", value: safe(c?.total_direct, 0.55), color: "#38bdf8" },
      { label: "措施费", value: safe(c?.total_measures, 0.12), color: "#818cf8" },
      { label: "管理费", value: safe(c?.total_management, 0.08), color: "#fbbf24" },
      { label: "利润", value: safe(c?.total_profit, 0.07), color: "#34d399" },
      { label: "规费", value: safe(c?.total_regulatory, 0.06), color: "#f472b6" },
      { label: "税金", value: safe(c?.total_tax, 0.12), color: "#fb7185" },
    ];
  }, [top?.calc, totals.totalCost]);

  const boqTrend = useMemo(() => {
    const current = totals.totalBoq || 12;
    const values = Array.from({ length: 7 }, (_, i) => Math.max(0, Math.round(current * (0.45 + 0.09 * i) + Math.random() * 3 - 1.5)));
    values[values.length - 1] = current;
    return values;
  }, [totals.totalBoq]);

  const animProjects = useCountUp(projects.length);
  const animTotalBoq = useCountUp(totals.totalBoq);
  const animTotalCost = useCountUp(Math.round(totals.totalCost));
  const animIssues = useCountUp(totals.issues);

  const flowSteps: FlowStep[] = useMemo(() => {
    const pid = topProject?.id;
    const projectRoute = pid ? `/projects/${pid}` : "/projects";
    const completed = topProject?.status === "completed" || topProject?.status === "archived";
    return [
      { key: "init", icon: "assignment_add", title: "立项建档", desc: "项目、地区、专业、计价口径", route: "/projects", done: Boolean(pid), metric: pid ? "已建档" : "待新建" },
      { key: "source", icon: "upload_file", title: "资料接入", desc: "图纸、IFC、清单、历史资料", route: "/drawings", done: boqCount > 0, current: Boolean(pid) && boqCount === 0, metric: boqCount > 0 ? `${boqCount} 项成果` : "待导入" },
      { key: "drawing", icon: "architecture", title: "图纸解析", desc: "DWG 自动解析、高亮套价", route: "/drawings", done: boqCount > 0, current: Boolean(pid) && boqCount === 0, metric: "打开即预览" },
      { key: "ifc", icon: "view_in_ar", title: "BIM 算量", desc: "构件解析、模型预览、清单生成", route: "/ifc-parser", done: boqCount > 0, current: Boolean(pid) && boqCount === 0, metric: "Z 轴朝上" },
      { key: "boq", icon: "format_list_bulleted", title: "清单生成", desc: "工程量、单位、项目特征核对", route: projectRoute, done: boqCount > 0, metric: `${boqCount} 项清单` },
      { key: "quota", icon: "link", title: "自动套定额", desc: "按专业匹配，低置信度复核", route: projectRoute, done: boqCount > 0 && bindRate >= 95, current: boqCount > 0 && bindRate < 95, metric: `${bindRate}% 已绑定` },
      { key: "price", icon: "payments", title: "市场价采集", desc: "多源采集、离线基础价兜底", route: "/price-management", done: hasCalc, current: boqCount > 0 && !hasCalc, metric: "价格库" },
      { key: "calc", icon: "calculate", title: "计价计算", desc: "综合单价、措施费、税金汇总", route: "/pricing", done: hasCalc, current: boqCount > 0 && !hasCalc, metric: money(top?.calc?.grand_total) },
      { key: "audit", icon: "policy", title: "复核审计", desc: "规则校验、风险提示、底稿", route: "/audit", done: hasCalc && validationIssues === 0, current: hasCalc && validationIssues > 0, metric: `${validationIssues} 个问题` },
      { key: "report", icon: "summarize", title: "成果输出", desc: "PDF、Excel、项目报表导出", route: "/reports", done: hasCalc, metric: "报表导出" },
      { key: "construction", icon: "construction", title: "过程管理", desc: "计量、变更、支付证书", route: "/projects", done: maintenanceCount > 0, current: hasCalc && maintenanceCount === 0, metric: `${maintenanceCount} 条记录` },
      { key: "archive", icon: "inventory_2", title: "竣工归档", desc: "结算、审计留痕、维护台账", route: "/projects", done: completed, current: hasCalc && !completed, metric: completed ? "已归档" : "待归档" },
    ];
  }, [bindRate, boqCount, hasCalc, maintenanceCount, top?.calc?.grand_total, topProject, validationIssues]);

  const startSample = async () => {
    setCreatingTour(true);
    try {
      const project = await createSampleProject();
      message.success("已创建示例项目，可用于离线验证全流程");
      navigate(`/projects/${project.id}`);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "创建示例项目失败");
    } finally {
      setCreatingTour(false);
    }
  };

  const nextActions = flowSteps.filter((step) => step.current || !step.done).slice(0, 4);

  if (loading) {
    return (
      <div className="dash-root">
        <div className="dash-loading">
          <Spin size="large" />
          <p>正在加载工作台...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="dash-root">
      <div className="dash-content">
        <section className="dash-hero-grid">
          <div className="dash-hero-card">
            <div className="dash-hero-glow" />
            <div className="dash-hero-grid-bg" />
              <div className="dash-hero-body">
              <div className="dash-hero-inner">
                <div className="dash-hero-badge-row">
                  <div className="dash-hero-badge">
                    <span className="material-symbols-outlined">insights</span>
                    <span>工作台</span>
                  </div>
                  <span className="dash-hero-live"><i />遥测更新 {now.toLocaleTimeString("zh-CN", { hour12: false })}</span>
                </div>
                <h2 className="dash-hero-title">{topProject?.name ?? "从立项到归档，一屏掌握造价过程"}</h2>
                <p className="dash-hero-desc">
                  {topProject ? `清单 ${boqCount} 项 · 绑定率 ${bindRate}% · ${validationIssues} 个待复核` : "新建项目或导入资料，系统自动串联图纸解析、IFC 套价、计价计算与审计归档"}
                </p>
                <div className="dash-hero-tags">
                  <span className="dash-hero-tag"><span className="material-symbols-outlined">engineering</span>{topProject?.project_type ?? "建筑工程"}</span>
                  <span className="dash-hero-tag"><span className="material-symbols-outlined">event</span>{topProject?.created_at ? new Date(topProject.created_at).toLocaleDateString("zh-CN") : "-"}</span>
                </div>
              </div>
              <div className="dash-hero-progress-section">
                <div className="dash-hero-progress-head">
                  <span>清单绑定率</span>
                  <strong>{bindRate}%</strong>
                </div>
                <div className="dash-hero-progress-track">
                  <div className="dash-hero-progress-fill" style={{ width: `${bindRate}%` }} />
                </div>
                <div className="dash-hero-stats">
                  <div>
                    <strong>{boqCount}</strong>
                    <span>清单项</span>
                  </div>
                  <div>
                    <strong>{money(top?.calc?.grand_total ?? 0)}</strong>
                    <span>造价合计</span>
                  </div>
                  <div>
                    <strong>{validationIssues}</strong>
                    <span>待复核</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="dash-zh-chat">
            <div className="dash-zh-chat-head">
              <h3>今日待办</h3>
              <span className="dash-zh-online">{nextActions.length} 项</span>
            </div>
            <div className="dash-zh-chat-body">
              {nextActions.length > 0 ? nextActions.slice(0, 3).map((step) => (
                <button key={step.key} className="dash-command-row" type="button" onClick={() => navigate(step.route)}>
                  <span className="material-symbols-outlined">{step.icon}</span>
                  <div>
                    <strong>{step.title}</strong>
                    <em>{step.metric}</em>
                  </div>
                  <span className="material-symbols-outlined">chevron_right</span>
                </button>
              )) : (
                <div className="dash-command-empty">
                  <span className="material-symbols-outlined">check_circle</span>
                  <p>暂无待办，项目推进顺利</p>
                </div>
              )}
              <button className="dash-command-row all" type="button" onClick={() => navigate("/projects")}>
                <span className="material-symbols-outlined">timeline</span>
                <div>
                  <strong>查看全生命周期</strong>
                  <em>12 阶段进度详情</em>
                </div>
                <span className="material-symbols-outlined">chevron_right</span>
              </button>
            </div>
          </div>
        </section>

        <section className="dash-kpi-strip">
          <div className="dash-kpi-item">
            <span className="dash-kpi-icon blue"><span className="material-symbols-outlined">folder_open</span></span>
            <div>
              <strong>{animProjects}</strong>
              <em>项目总数</em>
            </div>
            <span className="dash-kpi-sub">{totals.active} 活跃</span>
          </div>
          <div className="dash-kpi-item">
            <span className="dash-kpi-icon purple"><span className="material-symbols-outlined">format_list_bulleted</span></span>
            <div>
              <strong>{animTotalBoq}</strong>
              <em>清单项</em>
            </div>
            <span className="dash-kpi-sub">绑定 {portfolioBindRate}%</span>
          </div>
          <div className="dash-kpi-item">
            <span className="dash-kpi-icon amber"><span className="material-symbols-outlined">request_quote</span></span>
            <div>
              <strong>{money(animTotalCost)}</strong>
              <em>造价合计</em>
            </div>
            <span className="dash-kpi-sub">{hasCalc ? "已计价" : "待计价"}</span>
          </div>
          <div className="dash-kpi-item">
            <span className="dash-kpi-icon red"><span className="material-symbols-outlined">rule</span></span>
            <div>
              <strong>{animIssues}</strong>
              <em>复核问题</em>
            </div>
            <span className="dash-kpi-sub">{totals.issues ? "需处理" : "正常"}</span>
          </div>
        </section>

        <section className="dash-progress-bar-card">
          <div className="dash-progress-bar-head">
            <h3>全过程阶段进度</h3>
            <button className="dash-link-btn" type="button" onClick={() => navigate("/projects")}>
              查看详情 <span className="material-symbols-outlined">arrow_forward</span>
            </button>
          </div>
          <div className="dash-progress-track-wrap">
            <div className="dash-progress-track-line" />
            <div className="dash-progress-track-done" style={{ width: `${pct(flowSteps.filter((s) => s.done).length, flowSteps.length)}%` }} />
            <div className="dash-progress-nodes">
              {flowSteps.map((step) => (
                <button
                  key={step.key}
                  type="button"
                  className={`dash-progress-node${step.done ? " done" : ""}${step.current ? " current" : ""}`}
                  onClick={() => navigate(step.route)}
                  title={step.title}
                >
                  <span className="dash-progress-dot">
                    <span className="material-symbols-outlined">{step.done ? "check" : step.icon}</span>
                  </span>
                  <span className="dash-progress-label">{step.title}</span>
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className="dash-charts-grid">
          <div className="dash-chart-card">
            <div className="dash-chart-head">
              <h3><span className="material-symbols-outlined">donut_large</span>造价构成</h3>
              <span>当前项目</span>
            </div>
            <div className="dash-chart-body">
              <DonutChart data={costComposition} size={200} stroke={22} centerLabel="总造价" />
              <div className="dash-chart-legend">
                {costComposition.map((item) => (
                  <div key={item.label} className="dash-legend-item">
                    <div className="dash-legend-head">
                      <span style={{ background: item.color }} />
                      <em>{item.label}</em>
                      <span className="dash-legend-pct">{Math.round((item.value / Math.max(1, costComposition.reduce((s, d) => s + d.value, 0))) * 100)}%</span>
                    </div>
                    <strong>{money(item.value)}</strong>
                  </div>
                ))}
              </div>
            </div>
            <div className="dash-chart-foot">
              <span className="material-symbols-outlined">lightbulb</span>
              <p>直接费占比最高，建议关注材料价格波动对总造价的影响。</p>
              <span className="dash-chart-tag">辅助诊断</span>
            </div>
          </div>

          <div className="dash-chart-card">
            <div className="dash-chart-head">
              <h3><span className="material-symbols-outlined">trending_up</span>清单项趋势</h3>
              <span>近 7 天</span>
            </div>
            <div className="dash-chart-body column">
              <BarTrend data={boqTrend} color="#38bdf8" />
              <div className="dash-trend-meta">
                <div>
                  <em>7日新增</em>
                  <strong>{boqTrend.reduce((a, b) => a + b, 0)}</strong>
                </div>
                <div>
                  <em>日均</em>
                  <strong>{Math.round(boqTrend.reduce((a, b) => a + b, 0) / boqTrend.length)}</strong>
                </div>
                <div>
                  <em>峰值</em>
                  <strong>{Math.max(...boqTrend)}</strong>
                </div>
              </div>
            </div>
            <div className="dash-chart-foot">
              <span className="material-symbols-outlined">rocket_launch</span>
              <p>近 7 天清单持续增长，优先处理未绑定项以推进计价。</p>
              <span className="dash-chart-tag">趋势向上</span>
            </div>
          </div>
        </section>

        <section className="dash-projects-card">
          <div className="dash-projects-head">
            <h3>项目概览</h3>
            <div className="dash-projects-actions">
              <Button icon={<ReloadOutlined />} onClick={load}>刷新</Button>
              <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate("/projects")}>新建项目</Button>
            </div>
          </div>
          {projects.length === 0 ? (
            <div className="dash-empty-panel">
              <Empty description="当前没有项目台账。可以新建真实工程，也可以用示例项目验证全流程。">
                <Space wrap>
                  <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate("/projects")}>新建项目</Button>
                  <Button icon={<FolderAddOutlined />} loading={creatingSample} onClick={startSample}>创建示例项目</Button>
                </Space>
              </Empty>
            </div>
          ) : (
            <div className="dash-project-cards">
              {projects.slice(0, 3).map((project) => {
                const item = stats.get(project.id);
                const rows = item?.dash?.boq_count ?? 0;
                const unbound = item?.dash?.unbound_count ?? 0;
                const rate = pct(rows - unbound, rows);
                const issues = item?.dash?.validation_total ?? 0;
                const cost = Number(item?.calc?.grand_total ?? 0);
                return (
                  <button
                    key={project.id}
                    type="button"
                    className="dash-project-card"
                    onClick={() => navigate(`/projects/${project.id}`)}
                  >
                    <div className="dash-project-card-head">
                      <span className="dash-project-card-icon"><span className="material-symbols-outlined">apartment</span></span>
                      <div className="dash-project-card-title">
                        <strong>{project.name}</strong>
                        <em>{project.project_type ?? "建筑工程"}</em>
                      </div>
                      <Tag color={issues ? "orange" : "green"}>{issues ? `${issues} 问题` : "通过"}</Tag>
                    </div>
                    <div className="dash-project-card-stats">
                      <div>
                        <strong>{rows}</strong>
                        <span>清单项</span>
                      </div>
                      <div>
                        <strong>{money(cost)}</strong>
                        <span>造价</span>
                      </div>
                      <div>
                        <strong>{rate}%</strong>
                        <span>绑定率</span>
                      </div>
                    </div>
                    <div className="dash-project-card-bar">
                      <span style={{ width: `${rate}%` }} />
                    </div>
                    <div className="dash-project-card-foot">
                      <span>打开项目</span>
                      <span className="material-symbols-outlined">arrow_forward</span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        <section className="dash-ops-section">
          <div className="dash-ops-head">
            <h3><span className="material-symbols-outlined">hub</span>运营期设施总览</h3>
            <span>实时遥测 · 点击卡片进入专题</span>
          </div>
          <div className="dash-ops-grid">
            <OpsPulseCard
              title="光伏发电监测"
              status="晴 · 屋面阵列发电中"
              icon="solar_power"
              route="/pv-power"
              color="#fbbf24"
              data={pvSeries}
              metrics={[
                { label: "实时功率", value: `${pvPower.toFixed(1)} kW` },
                { label: "今日发电", value: `${todayKwh} kWh` },
                { label: "装机容量", value: "68 kWp" },
              ]}
            />
            <OpsPulseCard
              title="净水与中水回用"
              status="MBR 机组 2 用 1 备"
              icon="water_drop"
              route="/water-reuse"
              color="#34d399"
              data={waterSeries}
              metrics={[
                { label: "中水回用率", value: `${waterSeries[waterSeries.length - 1].toFixed(1)} %` },
                { label: "日回用量", value: "58 m³" },
                { label: "出水浊度", value: "0.42 NTU" },
              ]}
            />
            <OpsPulseCard
              title="设施运维管理"
              status="全部系统运行正常"
              icon="build_circle"
              route="/facility-ops"
              color="#38bdf8"
              data={healthSeries}
              metrics={[
                { label: "综合健康度", value: `${healthSeries[healthSeries.length - 1].toFixed(1)} 分` },
                { label: "待处理工单", value: "7 单" },
                { label: "平均响应", value: "5.2 h" },
              ]}
            />
          </div>
        </section>
      </div>
    </div>
  );
}
