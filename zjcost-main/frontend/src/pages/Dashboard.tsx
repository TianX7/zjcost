import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Spin, message } from "antd";
import { FolderAddOutlined, ReloadOutlined } from "@ant-design/icons";
import type { CalcSummary, DashboardSummary, Project, ValuationOverview } from "../api";
import { api } from "../api";
import { createSampleProject } from "../sampleProject";
import Panel from "../components/Panel";
import RingGauge from "../components/RingGauge";
import TwinScene3D from "../components/TwinScene3D";
import "../styles/dashboard-screen.css";

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
  done: boolean;
  current?: boolean;
  metric: string;
}

const CONCURRENCY = 4;

const STATUS_LABELS: Record<string, string> = {
  draft: "草稿",
  active: "进行中",
  completed: "已完成",
  archived: "已归档",
};

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


export default function Dashboard() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<Project[]>([]);
  const [stats, setStats] = useState<Map<number, ProjectStats>>(new Map());
  const [loading, setLoading] = useState(true);
  const [creatingSample, setCreatingSample] = useState(false);
  // 遥测心跳：驱动驾驶舱实时时钟与运营设施迷你曲线
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
  const waterReuse = waterSeries[waterSeries.length - 1];
  const healthScore = healthSeries[healthSeries.length - 1];
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
  const currentCost = Number(top?.calc?.grand_total ?? 0);

  const totals = useMemo(() => {
    const active = projects.filter((project) => project.status !== "archived").length;
    const totalBoq = allStats.reduce((sum, item) => sum + (item.dash?.boq_count ?? 0), 0);
    const totalUnbound = allStats.reduce((sum, item) => sum + (item.dash?.unbound_count ?? 0), 0);
    const totalCost = allStats.reduce((sum, item) => sum + Number(item.calc?.grand_total ?? 0), 0);
    return { active, totalBoq, totalUnbound, totalCost };
  }, [allStats, projects]);

  const portfolioBindRate = pct(totals.totalBoq - totals.totalUnbound, totals.totalBoq);

  const budgetAmount = Number(topProject?.budget ?? 0);
  const investmentAmount = budgetAmount > 0 ? budgetAmount : currentCost;
  const investmentWan = Math.round(investmentAmount / 10000);
  const currentCostWan = Math.round(currentCost / 10000);
  const gaugeMax = Math.max(1, Math.round(Math.max(investmentWan, currentCostWan) * 1.08));
  const deviationRate =
    investmentAmount > 0 ? Math.round((Math.abs(currentCost - investmentAmount) / investmentAmount) * 1000) / 10 : 0;

  const animInvestment = useCountUp(investmentWan);
  const animCurrentCost = useCountUp(currentCostWan);
  const animRisk = useCountUp(validationIssues);
  const animProjects = useCountUp(projects.length);
  const animTotalBoq = useCountUp(totals.totalBoq);

  // 成本构成：以直接费为基数，按人工 / 材料 / 机械拆分为堆叠条
  const directCost = Number(top?.calc?.total_direct ?? 0) || currentCost;
  const laborCost = Math.round(directCost * 0.28);
  const materialCost = Math.round(directCost * 0.62);
  const machineCost = Math.max(0, directCost - laborCost - materialCost);
  const costParts = [
    { key: "labor", label: "人工费", value: laborCost, color: "#4dd4ff", className: "twin-compose-labor" },
    { key: "material", label: "材料费", value: materialCost, color: "#fbbf24", className: "twin-compose-material" },
    { key: "machine", label: "机械费", value: machineCost, color: "#a78bfa", className: "twin-compose-machine" },
  ];

  const riskItems = [
    { key: "error", label: "校验错误", value: top?.dash?.validation_errors ?? 0, icon: "error", severity: "is-error", hint: "影响计价结果的阻断项" },
    { key: "warn", label: "校验警告", value: top?.dash?.validation_warnings ?? 0, icon: "warning", severity: "is-warn", hint: "建议复核的提示项" },
    { key: "unbound", label: "未绑定清单", value: unboundCount, icon: "link_off", severity: "is-warn", hint: "尚未套用定额的清单" },
    { key: "dirty", label: "待刷新计价", value: top?.dash?.dirty_count ?? 0, icon: "sync_problem", severity: "is-warn", hint: "数据变更后需要重算" },
  ].filter((item) => item.value > 0);

  const flowSteps: FlowStep[] = useMemo(() => {
    const pid = topProject?.id;
    const completed = topProject?.status === "completed" || topProject?.status === "archived";
    return [
      { key: "init", icon: "assignment_add", title: "立项建档", desc: "项目、地区、专业、计价口径", done: Boolean(pid), metric: pid ? "已建档" : "待新建" },
      { key: "source", icon: "upload_file", title: "资料接入", desc: "图纸、IFC、清单、历史资料", done: boqCount > 0, current: Boolean(pid) && boqCount === 0, metric: boqCount > 0 ? `${boqCount} 项成果` : "待导入" },
      { key: "drawing", icon: "architecture", title: "图纸解析", desc: "DWG 自动解析、高亮套价", done: boqCount > 0, current: Boolean(pid) && boqCount === 0, metric: "打开即预览" },
      { key: "ifc", icon: "view_in_ar", title: "BIM 算量", desc: "构件解析、模型预览、清单生成", done: boqCount > 0, current: Boolean(pid) && boqCount === 0, metric: "Z 轴朝上" },
      { key: "boq", icon: "format_list_bulleted", title: "清单生成", desc: "工程量、单位、项目特征核对", done: boqCount > 0, metric: `${boqCount} 项清单` },
      { key: "quota", icon: "link", title: "自动套定额", desc: "按专业匹配，低置信度复核", done: boqCount > 0 && bindRate >= 95, current: boqCount > 0 && bindRate < 95, metric: `${bindRate}% 已绑定` },
      { key: "price", icon: "payments", title: "市场价采集", desc: "多源采集、离线基础价兜底", done: hasCalc, current: boqCount > 0 && !hasCalc, metric: "价格库" },
      { key: "calc", icon: "calculate", title: "计价计算", desc: "综合单价、措施费、税金汇总", done: hasCalc, current: boqCount > 0 && !hasCalc, metric: money(top?.calc?.grand_total) },
      { key: "audit", icon: "policy", title: "复核审计", desc: "规则校验、风险提示、底稿", done: hasCalc && validationIssues === 0, current: hasCalc && validationIssues > 0, metric: `${validationIssues} 个问题` },
      { key: "report", icon: "summarize", title: "成果输出", desc: "PDF、Excel、项目报表导出", done: hasCalc, metric: "报表导出" },
      { key: "construction", icon: "construction", title: "过程管理", desc: "计量、变更、支付证书", done: maintenanceCount > 0, current: hasCalc && maintenanceCount === 0, metric: `${maintenanceCount} 条记录` },
      { key: "archive", icon: "inventory_2", title: "竣工归档", desc: "结算、审计留痕、维护台账", done: completed, current: hasCalc && !completed, metric: completed ? "已归档" : "待归档" },
    ];
  }, [bindRate, boqCount, hasCalc, maintenanceCount, top?.calc?.grand_total, topProject, validationIssues]);

  const currentStep = flowSteps.find((step) => step.current) ?? flowSteps.find((step) => !step.done);
  const doneCount = flowSteps.filter((step) => step.done).length;
  const projectRoute = topProject ? `/projects/${topProject.id}` : "/projects";
  const nextActions = flowSteps.filter((step) => step.current || !step.done).slice(0, 4);

  const startSample = async () => {
    setCreatingSample(true);
    try {
      const project = await createSampleProject();
      message.success("已创建示例项目，可用于离线验证全流程");
      navigate(`/projects/${project.id}`);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "创建示例项目失败");
    } finally {
      setCreatingSample(false);
    }
  };

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
    <div className="dash-root twin-root">
      <div className="twin-cockpit">
        <div className="twin-col twin-col--left">
          <Panel
            title="项目造价总览"
            icon="query_stats"
            className="twin-panel twin-panel--overview"
            extra={
              <button type="button" className="twin-icon-btn" onClick={() => void load()} title="刷新数据" aria-label="刷新数据">
                <ReloadOutlined />
              </button>
            }
          >
            <div className="twin-gauge-grid">
              <div className="twin-gauge-cell">
                <RingGauge value={animInvestment} max={gaugeMax} label="总投资" unit="万" size={104} />
              </div>
              <div className="twin-gauge-cell">
                <RingGauge value={animCurrentCost} max={gaugeMax} label="已完成计价" unit="万" size={104} />
              </div>
              <div className="twin-gauge-cell">
                <RingGauge
                  value={deviationRate}
                  max={20}
                  label="成本偏差率"
                  unit="%"
                  color={deviationRate > 5 ? "#fbbf24" : "#4dd4ff"}
                  size={104}
                />
              </div>
              <div className="twin-gauge-cell">
                <RingGauge
                  value={animRisk}
                  max={Math.max(10, validationIssues)}
                  label="风险项数"
                  unit="项"
                  color={validationIssues > 0 ? "#fbbf24" : "#4dd4ff"}
                  size={104}
                />
              </div>
            </div>
            <div className="twin-overview-foot">
              <div>
                <em>在册项目</em>
                <strong>{animProjects}</strong>
              </div>
              <div>
                <em>活跃项目</em>
                <strong>{totals.active}</strong>
              </div>
              <div>
                <em>全量清单</em>
                <strong>{animTotalBoq}</strong>
              </div>
              <div>
                <em>全量绑定</em>
                <strong>{portfolioBindRate}%</strong>
              </div>
            </div>
          </Panel>

          <Panel
            title="成本构成"
            icon="donut_large"
            className="twin-panel twin-panel--flex"
            bodyClassName="twin-panel-scroll"
            extra={<span className="twin-mini-tag">{money(directCost)} 直接费</span>}
          >
            {directCost > 0 ? (
              <>
                <div className="twin-compose-bar">
                  {costParts.map((part) => (
                    <span
                      key={part.key}
                      className={part.className}
                      style={{ flex: part.value }}
                      title={`${part.label} ${money(part.value)}`}
                    />
                  ))}
                </div>
                <div className="twin-legend">
                  {costParts.map((part) => (
                    <div key={part.key} className="twin-legend-row">
                      <i style={{ background: part.color }} />
                      <span>{part.label}</span>
                      <b>{money(part.value)}</b>
                      <em>{Math.round((part.value / Math.max(directCost, 1)) * 100)}%</em>
                    </div>
                  ))}
                </div>
                <div className="twin-compose-note">
                  直接费占计价 <strong>{pct(directCost, currentCost)}%</strong>，人工 / 材料 / 机械按直接费口径拆分。
                </div>
              </>
            ) : (
              <div className="twin-empty twin-empty--compact">
                <span className="material-symbols-outlined">donut_large</span>
                <strong>暂无计价数据</strong>
                <p>完成清单套价后自动生成成本构成</p>
              </div>
            )}
          </Panel>
        </div>

        <section className={`twin-stage${topProject ? "" : " is-empty"}`} aria-label="数字孪生项目场景">
          <TwinScene3D
            costText={topProject ? money(currentCost) : "待接入"}
            bindRate={bindRate}
            riskCount={validationIssues}
          />
          <div className="twin-stage-scan" />

          <div className="twin-stage-head">
            <div className="twin-stage-info">
              <span className="twin-stage-eyebrow">
                <span className="material-symbols-outlined">deployed_code</span>
                数字孪生 · 项目视图
              </span>
              <strong>{topProject?.name ?? "未选择项目"}</strong>
              <div className="twin-stage-meta">
                <span>
                  <span className="material-symbols-outlined">location_on</span>
                  {topProject?.region ?? "—"}
                </span>
                <span>
                  <span className="material-symbols-outlined">category</span>
                  {topProject?.project_type ?? "—"}
                </span>
                <span>
                  <span className="material-symbols-outlined">verified</span>
                  {topProject ? STATUS_LABELS[topProject.status] ?? topProject.status : "待选择"}
                </span>
              </div>
              {!topProject && (
                <div className="twin-stage-cta">
                  <Button type="primary" size="small" onClick={() => navigate("/projects")}>
                    前往项目台账
                  </Button>
                  {projects.length === 0 && (
                    <Button size="small" icon={<FolderAddOutlined />} loading={creatingSample} onClick={startSample}>
                      创建示例项目
                    </Button>
                  )}
                </div>
              )}
            </div>

            <div className="twin-stage-side">
              <div className="twin-stage-cost">
                <em>建造成本</em>
                <b>{money(currentCost)}</b>
              </div>
              <div className="twin-stage-chips">
                <span><i />BIM 线框</span>
                <span><i className="is-green" />清单同步</span>
                <span><i className="is-amber" />运营监测</span>
              </div>
            </div>
          </div>

          <div className="twin-stage-stats">
            <div>
              <em>清单项</em>
              <strong>{boqCount}</strong>
            </div>
            <div>
              <em>已绑定率</em>
              <strong>{bindRate}<small>%</small></strong>
            </div>
            <div>
              <em>总价</em>
              <strong>{money(currentCost)}</strong>
            </div>
          </div>
        </section>

        <div className="twin-col twin-col--right">
          <Panel
            title="风险预警"
            icon="shield"
            className="twin-panel twin-panel--risk"
            bodyClassName="twin-panel-scroll"
            extra={<span className="twin-mini-tag">{riskItems.length > 0 ? `${riskItems.length} 类` : "正常"}</span>}
          >
            {riskItems.length > 0 ? (
              <div className="twin-risk-list">
                {riskItems.map((item) => (
                  <div key={item.key} className={`twin-risk-row ${item.severity}`}>
                    <span className="material-symbols-outlined">{item.icon}</span>
                    <div className="twin-risk-main">
                      <strong>{item.label}</strong>
                      <em>{item.hint}</em>
                    </div>
                    <b>{item.value}</b>
                  </div>
                ))}
              </div>
            ) : (
              <div className="twin-empty">
                <span className="material-symbols-outlined">verified_user</span>
                <strong>暂无风险</strong>
                <p>校验通过，计价结果稳定</p>
              </div>
            )}
          </Panel>

          <Panel
            title="运维实时"
            icon="monitoring"
            className="twin-panel twin-panel--ops"
            extra={<span className="twin-mini-tag">示例遥测</span>}
          >
            <div className="twin-ops-list">
              <button type="button" className="twin-ops-row" onClick={() => navigate("/facility-ops?view=pv")}>
                <span className="twin-ops-icon is-amber">
                  <span className="material-symbols-outlined">solar_power</span>
                </span>
                <div className="twin-ops-main">
                  <strong>光伏发电</strong>
                  <em>今日 {todayKwh} kWh</em>
                </div>
                <div className="twin-ops-spark">
                  <MiniSpark data={pvSeries} color="#fbbf24" width={80} height={28} />
                </div>
                <span className="twin-ops-value">{pvPower.toFixed(1)} kW</span>
                <span className="material-symbols-outlined twin-ops-arrow">chevron_right</span>
              </button>

              <button type="button" className="twin-ops-row" onClick={() => navigate("/facility-ops?view=water")}>
                <span className="twin-ops-icon is-green">
                  <span className="material-symbols-outlined">water_drop</span>
                </span>
                <div className="twin-ops-main">
                  <strong>中水回用</strong>
                  <em>日回用 58 m³</em>
                </div>
                <div className="twin-ops-spark">
                  <MiniSpark data={waterSeries} color="#34d399" width={80} height={28} />
                </div>
                <span className="twin-ops-value">{waterReuse.toFixed(1)} %</span>
                <span className="material-symbols-outlined twin-ops-arrow">chevron_right</span>
              </button>

              <button type="button" className="twin-ops-row" onClick={() => navigate("/facility-ops?view=ops")}>
                <span className="twin-ops-icon">
                  <span className="material-symbols-outlined">build_circle</span>
                </span>
                <div className="twin-ops-main">
                  <strong>设施运维</strong>
                  <em>待处理 7 单</em>
                </div>
                <div className="twin-ops-spark">
                  <MiniSpark data={healthSeries} color="#4dd4ff" width={80} height={28} />
                </div>
                <span className="twin-ops-value">{healthScore.toFixed(1)} 分</span>
                <span className="material-symbols-outlined twin-ops-arrow">chevron_right</span>
              </button>
            </div>
          </Panel>

          <Panel
            title="待办事项"
            icon="checklist"
            className="twin-panel twin-panel--todo"
            bodyClassName="twin-panel-scroll"
            extra={<span className="twin-mini-tag">{nextActions.length} 项</span>}
          >
            {nextActions.length > 0 ? (
              <div className="twin-todo-list">
                {nextActions.slice(0, 3).map((step) => (
                  <div key={step.key} className="twin-todo-row">
                    <span className="twin-todo-icon">
                      <span className="material-symbols-outlined">{step.icon}</span>
                    </span>
                    <div className="twin-todo-main">
                      <strong>{step.title}</strong>
                      <em>{step.metric}</em>
                    </div>
                    <span className={`twin-todo-state${step.current ? "" : " is-pending"}`}>
                      {step.current ? "当前" : "待办"}
                    </span>
                  </div>
                ))}
                {nextActions.length > 3 && (
                  <button type="button" className="twin-todo-more" onClick={() => navigate("/plan")}>
                    其余 {nextActions.length - 3} 项
                    <span className="material-symbols-outlined">arrow_forward</span>
                  </button>
                )}
              </div>
            ) : (
              <div className="twin-empty">
                <span className="material-symbols-outlined">task_alt</span>
                <strong>暂无待办</strong>
                <p>项目推进顺利，保持当前节奏</p>
              </div>
            )}
          </Panel>
        </div>

        <div className="twin-lifecycle">
          <div className="twin-lifecycle-head">
            <span>
              <span className="material-symbols-outlined">route</span>
              全生命周期
            </span>
            <em>{doneCount}/{flowSteps.length} 已完成</em>
          </div>
          <div className="twin-lifecycle-track">
            <span className="twin-lifecycle-line" />
            <span className="twin-lifecycle-line-done" style={{ width: `${pct(doneCount, flowSteps.length)}%` }} />
            {flowSteps.map((step) => {
              // 仅“立项建档”与当前节点可点击，其余步骤只展示状态
              const route = step.key === "init" ? "/projects" : step.key === currentStep?.key ? projectRoute : null;
              const className = `twin-life-node${step.done ? " is-done" : ""}${step.key === currentStep?.key ? " is-current" : ""}${route ? " is-clickable" : ""}`;
              const content = (
                <>
                  <span className="twin-life-dot" />
                  <span className="twin-life-label">{step.title}</span>
                  {step.key === currentStep?.key && <em className="twin-life-metric">{step.metric}</em>}
                </>
              );

              if (!route) {
                return (
                  <div key={step.key} className={className} title={`${step.title} · ${step.metric}`}>
                    {content}
                  </div>
                );
              }

              return (
                <button
                  key={step.key}
                  type="button"
                  className={className}
                  onClick={() => navigate(route)}
                  title={`${step.title} · ${step.metric}`}
                >
                  {content}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
