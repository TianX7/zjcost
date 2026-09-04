import { useEffect, useId, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import PageHeader from "../components/PageHeader";

/* ─────────────────────────────────────────────────────────────
 * 运营期专题页面：光伏发电监测 / 净水与中水回用 / 设施运维管理
 * 以动态可视化图形为主：实时驱动数值 + SVG 动效图表
 * 动态检测说明：阈值判定 + 趋势诊断均为前端实时计算；
 * 遥测数值当前为仿真信号（deterministic wave），后续接真实
 * 传感器/平台时只需替换各页顶部的信号源即可，判定逻辑不变。
 * ───────────────────────────────────────────────────────────── */

/** 是否偏好减少动态效果 */
function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(
    () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!mq) return;
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

/** 全局时间心跳：驱动所有动态图形（页面不可见时暂停，避免恢复后数据跳变） */
function useTick(intervalMs = 1000) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let t: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (t) return;
      t = setInterval(() => setTick((v) => v + 1), intervalMs);
    };
    const stop = () => {
      if (t) clearInterval(t);
      t = null;
    };
    const onVis = () => (document.hidden ? stop() : start());
    start();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [intervalMs]);
  return tick;
}

/** 平滑数值动画（收敛后自动停止 rAF，偏好减弱动效时直接跳变） */
function useSpring(target: number, speed = 0.08) {
  const [val, setVal] = useState(target);
  const raf = useRef(0);
  const reduced = usePrefersReducedMotion();
  useEffect(() => {
    if (reduced) {
      setVal(target);
      return;
    }
    const step = () => {
      let settled = false;
      setVal((v) => {
        const next = v + (target - v) * speed;
        if (Math.abs(target - next) < 0.01) {
          settled = true;
          return target;
        }
        return next;
      });
      if (settled) return;
      raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
  }, [target, speed, reduced]);
  return val;
}

/** 确定性伪噪声（同一 t 输出一致，避免 Math.random 抖动导致曲线毛刺） */
function pseudoNoise(t: number, seed = 0) {
  const n = Math.sin(t * 12.9898 + seed * 78.233) * 43758.5453;
  return n - Math.floor(n) - 0.5;
}

/** 正弦波动 + 确定性抖动，模拟实时遥测 */
function wave(t: number, base: number, amp: number, period = 12, noise = 0.15, seed = 0) {
  return base + Math.sin((t / period) * Math.PI * 2) * amp + pseudoNoise(t, seed) * amp * noise;
}

/* ── 动态检测：阈值判定 + 趋势诊断（各页共用） ───────────────── */

export type DetectLevel = "ok" | "warn" | "alarm";

export const LEVEL_COLOR: Record<DetectLevel, string> = {
  ok: "#34d399",
  warn: "#fbbf24",
  alarm: "#f87171",
};

export const LEVEL_TEXT: Record<DetectLevel, string> = {
  ok: "正常",
  warn: "预警",
  alarm: "告警",
};

/** 越高越危险（如温度、浊度、压差） */
export function assessHigh(v: number, warnAt: number, alarmAt: number): DetectLevel {
  if (v >= alarmAt) return "alarm";
  if (v >= warnAt) return "warn";
  return "ok";
}

/** 越低越危险（如效率、性能比） */
export function assessLow(v: number, warnAt: number, alarmAt: number): DetectLevel {
  if (v <= alarmAt) return "alarm";
  if (v <= warnAt) return "warn";
  return "ok";
}

export type TrendDir = "up" | "down" | "flat";

const TREND_ICON: Record<TrendDir, string> = { up: "↑", down: "↓", flat: "→" };
const TREND_CLASS: Record<TrendDir, string> = {
  up: "ops-trend-up",
  down: "ops-trend-down",
  flat: "ops-trend-flat",
};

/** 对比近 N 点与再前 N 点均值，给出趋势方向 */
export function trendOf(series: number[], window = 5): TrendDir {
  if (series.length < window * 2) return "flat";
  const tail = series.slice(-window);
  const prev = series.slice(-window * 2, -window);
  const avg = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
  const diff = avg(tail) - avg(prev);
  const scale = Math.max(1e-6, Math.abs(avg(prev)));
  if (diff / scale > 0.02) return "up";
  if (diff / scale < -0.02) return "down";
  return "flat";
}

/** 趋势箭头小组件（invert 用于越低越好的指标） */
export function TrendTag({ series, invert = false }: { series: number[]; invert?: boolean }) {
  const dir = trendOf(series);
  const shown = invert ? (dir === "up" ? "down" : dir === "down" ? "up" : "flat") : dir;
  return <span className={TREND_CLASS[shown]} title="近段趋势">{TREND_ICON[shown]}</span>;
}

export interface OpsAlert {
  level: DetectLevel;
  icon: string;
  text: string;
  detail: string;
  action?: string;
  /** 站内路由跳转，如 /facility-ops */
  to?: string;
}

/** 动态检测结果条（复用 ops-alert 视觉） */
export function DetectStrip({ alerts, emptyText = "各项指标正常，暂无预警" }: {
  alerts: OpsAlert[]; emptyText?: string;
}) {
  const nav = useNavigate();
  if (alerts.length === 0) {
    return (
      <div className="ops-alert-list">
        <div className="ops-alert-row">
          <span className="ops-alert-icon ok"><span className="material-symbols-outlined">check_circle</span></span>
          <div className="ops-alert-body"><strong>运行正常</strong><em>{emptyText}</em></div>
        </div>
      </div>
    );
  }
  return (
    <div className="ops-alert-list">
      {alerts.map((a, i) => (
        <div key={`${a.text}-${i}`} className="ops-alert-row" style={{ animationDelay: `${i * 0.06}s` }}>
          <span className={`ops-alert-icon ${a.level === "alarm" ? "alarm" : a.level}`}>
            <span className="material-symbols-outlined">{a.icon}</span>
          </span>
          <div className="ops-alert-body">
            <strong>{LEVEL_TEXT[a.level]} · {a.text}</strong>
            <em>{a.detail}{a.action ? ` → ${a.action}` : ""}</em>
          </div>
          {a.to && (
            <button type="button" className="ops-link-btn" onClick={() => nav(a.to!)}>
              去处理
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

function fmt(n: number, digits = 1) {
  return n.toLocaleString("zh-CN", { minimumFractionDigits: digits, maximumFractionDigits: digits });
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

/* ── 通用可视化组件 ───────────────────────────────────────── */

/** 动态环形仪表盘（带刻度环） */
function GaugeRing({ value, max, label, unit, color, size = 130 }: {
  value: number; max: number; label: string; unit: string; color: string; size?: number;
}) {
  const display = useSpring(value);
  const rawId = useId().replace(/:/g, "");
  const gid = `gauge-${rawId}`;
  const stroke = 10;
  const cx = size / 2;
  const cy = size / 2;
  const r = (size - stroke) / 2 - 8;
  const c = 2 * Math.PI * r;
  const ratio = clamp(display / max, 0, 1);
  const tickCount = 36;
  const ticks = Array.from({ length: tickCount }, (_, i) => {
    const a = (i / tickCount) * Math.PI * 2 - Math.PI / 2;
    return { a, active: i / tickCount <= ratio };
  });
  return (
    <div className="ops-gauge">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <defs>
          <linearGradient id={`${gid}-arc`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={color} />
            <stop offset="100%" stopColor={color} stopOpacity="0.5" />
          </linearGradient>
        </defs>
        {ticks.map((tk, i) => {
          const rOut = size / 2 - 1;
          const rIn = size / 2 - 6;
          return (
            <line
              key={i}
              x1={cx + Math.cos(tk.a) * rIn} y1={cy + Math.sin(tk.a) * rIn}
              x2={cx + Math.cos(tk.a) * rOut} y2={cy + Math.sin(tk.a) * rOut}
              stroke={tk.active ? color : "rgba(125, 211, 252, 0.3)"}
              strokeWidth="2" opacity={tk.active ? 0.85 : 1}
            />
          );
        })}
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(80,160,255,0.18)" strokeWidth={stroke} />
        <circle
          cx={cx} cy={cy} r={r} fill="none"
          stroke={`url(#${gid}-arc)`} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={`${ratio * c} ${c}`} transform={`rotate(-90 ${cx} ${cy})`}
          className="ops-gauge-arc"
          style={{ transition: "stroke-dasharray 0.25s linear", filter: `drop-shadow(0 0 8px ${color}88)` }}
        />
      </svg>
      <div className="ops-gauge-center">
        <strong style={{ color }}>{fmt(display, 1)}<em>{unit}</em></strong>
        <span>{label}</span>
      </div>
    </div>
  );
}

interface LiveSeries {
  data: number[];
  color: string;
  unit: string;
  /** 图例名称，如“发电功率” */
  name: string;
  max?: number;
  dashed?: boolean;
}

/** 多序列实时滚动曲线（支持双轴对比，如 功率×辐照度） */
function LiveLineChart({ series, height = 176 }: { series: LiveSeries[]; height?: number }) {
  const w = 560;
  const pad = { l: 10, r: 10, t: 14, b: 18 };
  const chartH = height - pad.t - pad.b;
  const chartW = w - pad.l - pad.r;
  const uid = useRef(`lc-${Math.random().toString(36).slice(2, 8)}`).current;
  return (
    <div className="ops-live-chart">
      <svg width="100%" height={height} viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none">
        <defs>
          {series.map((s, si) => (
            <linearGradient key={si} id={`${uid}-${si}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={s.color} stopOpacity="0.28" />
              <stop offset="100%" stopColor={s.color} stopOpacity="0.02" />
            </linearGradient>
          ))}
        </defs>
        {[0.25, 0.5, 0.75].map((r) => (
          <line key={r} x1={pad.l} y1={pad.t + chartH * r} x2={w - pad.r} y2={pad.t + chartH * r} stroke="rgba(80,160,255,0.14)" strokeDasharray="3 4" />
        ))}
        {series.map((s, si) => {
          const top = Math.max(...s.data, s.max ?? 0, 1) * 1.08;
          const pts = s.data.map((v, i) => [
            pad.l + (i / Math.max(1, s.data.length - 1)) * chartW,
            pad.t + chartH - (v / top) * chartH,
          ] as [number, number]);
          const line = smoothPath(pts);
          const area = `${line} L ${pts[pts.length - 1][0]} ${pad.t + chartH} L ${pts[0][0]} ${pad.t + chartH} Z`;
          const head = pts[pts.length - 1];
          return (
            <g key={si}>
              <path d={area} fill={`url(#${uid}-${si})`} />
              <path
                d={line} fill="none" stroke={s.color}
                strokeWidth={si === 0 ? 2.2 : 1.6}
                strokeLinejoin="round" strokeLinecap="round"
                strokeDasharray={s.dashed ? "5 4" : undefined}
              />
              {/* 流光 overlay：沿曲线方向持续流动，强化“实时”感 */}
              {!s.dashed && (
                <path d={line} fill="none" stroke="#fff" strokeOpacity="0.4" strokeWidth="1.2" className="ops-flow-line" />
              )}
              <circle cx={head[0]} cy={head[1]} r="4" fill={s.color}>
                <animate attributeName="r" values="3;5;3" dur="1.6s" repeatCount="indefinite" />
              </circle>
              <circle cx={head[0]} cy={head[1]} r="7" fill="none" stroke={s.color} strokeWidth="1.5">
                <animate attributeName="r" values="5;12" dur="1.6s" repeatCount="indefinite" />
                <animate attributeName="stroke-opacity" values="0.55;0" dur="1.6s" repeatCount="indefinite" />
              </circle>
              <circle cx={head[0]} cy={head[1]} r="7" fill="none" stroke={s.color} strokeWidth="1">
                <animate attributeName="r" values="5;14" dur="2.4s" repeatCount="indefinite" />
                <animate attributeName="stroke-opacity" values="0.4;0" dur="2.4s" repeatCount="indefinite" />
              </circle>
            </g>
          );
        })}
      </svg>
      <div className="ops-live-chart-meta">
        <div className="ops-live-legend">
          {series.map((s) => {
            const last = s.data[s.data.length - 1] ?? 0;
            const peak = Math.max(...s.data, 1);
            return (
              <span key={`${s.name}-${s.color}`}>
                <i style={{ background: s.color }} />
                <em>{s.name}</em>
                <strong style={{ color: s.color }}>{fmt(last, 1)} {s.unit}</strong>
                <TrendTag series={s.data} />
                <em>峰值 {fmt(peak, 1)}</em>
              </span>
            );
          })}
        </div>
        <em className="ops-live-window">实时 · 近 60 秒</em>
      </div>
    </div>
  );
}

/** 动态柱状图（支持计划参考线） */
function AnimatedBars({ items, color, unit, target, targetLabel = "计划" }: {
  items: Array<{ label: string; value: number }>; color: string; unit: string;
  target?: number; targetLabel?: string;
}) {
  const max = Math.max(...items.map((i) => i.value), target ?? 0, 1);
  return (
    <div className="ops-bars">
      {items.map((item, i) => (
        <div key={item.label} className="ops-bar-col" style={{ animationDelay: `${i * 0.08}s` }}>
          <div className="ops-bar-value">{fmt(item.value, 1)}</div>
          <div className="ops-bar-track">
            {target != null && (
              <span className="ops-bar-target" style={{ bottom: `${clamp((target / max) * 100, 0, 100)}%` }} />
            )}
            <div
              className="ops-bar-fill"
              style={{
                height: `${clamp((item.value / max) * 100, 0, 100)}%`,
                background: `linear-gradient(180deg, ${color}, ${color}44)`,
                boxShadow: `0 0 10px ${color}55`,
                animation: `ops-pulse 2.6s ${i * 0.14}s ease-in-out infinite`,
              }}
            />
          </div>
          <div className="ops-bar-label">{item.label}</div>
        </div>
      ))}
      <span className="ops-bars-unit">{unit}</span>
      {target != null && <span className="ops-bars-target-note">┄ {targetLabel} {target}</span>}
    </div>
  );
}

/* ═══════════════ 光伏发电监测 ═══════════════ */

const MONTHS = ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"];
const MONTH_PV = [6.2, 7.0, 9.1, 10.4, 11.2, 10.8, 10.6, 10.1, 9.4, 7.8, 6.0, 5.6];
const MONTH_PLAN = 9.2;

export function PvPowerPage() {
  const t = useTick(3000);
  // 白昼出力包络：晨 → 午 → 暮（约 1 分钟一个日循环）
  const dayPhase = (t % 50) / 50;
  const hourFactor = Math.max(0.1, Math.sin(dayPhase * Math.PI));
  const power = wave(t, 50 * hourFactor + 2, 3, 8, 0.25);
  const irradiance = Math.max(25, wave(t, 760 * hourFactor + 50, 42, 9, 0.2));
  const cellTemp = wave(t, 22 + 34 * hourFactor, 2.5, 10, 0.12);
  const ambient = wave(t, 28.4, 1.1, 13, 0.1);
  const pr = wave(t, 82.4, 1.6, 14, 0.04);
  const todayKwh = 96 + (t % 200) * 1.1 * Math.max(0.3, hourFactor);
  const gridExport = wave(t, 12.6, 2.4, 12, 0.25);
  const selfUse = wave(t, 86, 3, 15);

  const [live, setLive] = useState<number[]>(() => Array.from({ length: 30 }, (_, i) => 18 + Math.sin(i / 4) * 12));
  const [irrLive, setIrrLive] = useState<number[]>(() => Array.from({ length: 30 }, (_, i) => 240 + Math.sin(i / 5) * 170));
  useEffect(() => {
    setLive((prev) => [...prev.slice(1), Math.max(2, power)]);
    setIrrLive((prev) => [...prev.slice(1), Math.max(15, irradiance)]);
  }, [t]); // eslint-disable-line react-hooks/exhaustive-deps

  const inverters = [
    { id: "INV-01", share: 0.37, effBase: 98.6, effAmp: 0.25, tempBase: 41, tempSeed: 11 },
    { id: "INV-02", share: 0.36, effBase: 98.2, effAmp: 0.3, tempBase: 43, tempSeed: 12 },
    // INV-03 效率基线偏低、温度偏高：阈值线会动态穿越，演示预警的产生与恢复
    { id: "INV-03", share: 0.27, effBase: 97.1, effAmp: 0.9, tempBase: 49, tempSeed: 13 },
  ].map((inv) => {
    const eff = wave(t, inv.effBase, inv.effAmp, 9, 0.3, inv.tempSeed);
    const temp = wave(t, inv.tempBase, 2.5, 7, 0.25, inv.tempSeed + 5);
    const effLevel = assessLow(eff, 97.5, 96.5);
    const tempLevel = assessHigh(temp, 50, 60);
    const level: DetectLevel = effLevel === "alarm" || tempLevel === "alarm" ? "alarm" : effLevel === "warn" || tempLevel === "warn" ? "warn" : "ok";
    return {
      ...inv,
      power: power * inv.share,
      eff,
      temp,
      kwh: todayKwh * inv.share,
      level,
      dot: level === "ok" ? "normal" : "warn",
    };
  });

  // 动态检测：阈值判定 → 预警/告警 → 处置建议 → 联动运维
  const pvAlerts: OpsAlert[] = [];
  const prLevel = assessLow(pr, 80, 76);
  if (prLevel !== "ok") {
    pvAlerts.push({
      level: prLevel, icon: "trending_down", text: `系统效率比 PR 偏低（${fmt(pr, 1)}%）`,
      detail: `低于 ${prLevel === "alarm" ? "76%" : "80%"} ${prLevel === "alarm" ? "告警" : "预警"}线，重点查组串失配与逆变器效率`,
      action: "安排组串 IV 曲线抽检", to: "/facility-ops",
    });
  }
  const cellLevel = assessHigh(cellTemp, 60, 70);
  if (cellLevel !== "ok") {
    pvAlerts.push({
      level: cellLevel, icon: "thermostat", text: `组件背板温度偏高（${fmt(cellTemp, 1)}℃）`,
      detail: "高温导致出力折损，检查通风间隙与积灰遮挡",
      action: "清洁组件并检查支架通风", to: "/facility-ops",
    });
  }
  for (const inv of inverters) {
    if (inv.level === "ok") continue;
    const cause = inv.eff <= 97.5 ? `转换效率 ${fmt(inv.eff, 1)}%（基线 97.5%）` : `机内温度 ${fmt(inv.temp, 1)}℃（预警 50℃）`;
    pvAlerts.push({
      level: inv.level, icon: "electrical_services", text: `${inv.id} 运行异常 · ${cause}`,
      detail: "疑似 MPPT 跟踪偏差或散热不良",
      action: "排查 MPPT 并检查散热风道", to: "/facility-ops",
    });
  }

  const envStats = [
    { icon: "bolt", label: "累计发电量", value: "12.86", unit: "万kWh", color: "#fbbf24" },
    { icon: "co2", label: "累计碳减排", value: "16.92", unit: "tCO₂", color: "#34d399" },
    { icon: "local_fire_department", label: "节约标准煤", value: "5.24", unit: "tce", color: "#fb923c" },
    { icon: "forest", label: "等效植树造林", value: "93", unit: "棵", color: "#a78bfa" },
  ];

  return (
    <div className="page-container">
      <PageHeader icon="solar_power" title="光伏发电监测" subtitle="屋面光伏电站实时监测 · 发电收益与碳减排测算 · GB 50797-2012 / IEC 61724" />

      {/* 气象与运行工况 */}
      <div className="ops-panel">
        <div className="ops-gauges-meta">
          <span><span className="material-symbols-outlined">sunny</span>天气 晴</span>
          <span><span className="material-symbols-outlined">thermostat</span>环境温度 {fmt(ambient, 1)} ℃</span>
          <span><span className="material-symbols-outlined">wb_twilight</span>日照时长 9.6 h</span>
          <span><span className="material-symbols-outlined">bolt</span>装机容量 68 kWp · 屋面倾角 15°</span>
          <span><span className="material-symbols-outlined">sync_alt</span>余电上网 {fmt(gridExport, 1)} kW</span>
        </div>
        <div className="ops-gauges-row ops-gauges-row-flush">
          <GaugeRing value={power} max={60} label="实时发电功率" unit="kW" color="#fbbf24" />
          <GaugeRing value={irradiance} max={1100} label="太阳辐照度" unit="W/m²" color="#fb923c" />
          <GaugeRing value={cellTemp} max={80} label="组件背板温度" unit="℃" color="#f87171" />
          <GaugeRing value={pr} max={100} label="系统效率比 PR" unit="%" color="#34d399" />
          <GaugeRing value={todayKwh} max={320} label="当日发电量" unit="kWh" color="#38bdf8" />
        </div>
      </div>

      {/* 实时功率曲线 + 光伏阵列动效 */}
      <div className="ops-grid-2">
        <div className="ops-panel">
          <div className="ops-panel-head">
            <h3><span className="material-symbols-outlined">monitoring</span>发电功率 × 辐照度</h3>
            <span className="ops-live-badge"><i />LIVE</span>
          </div>
          <LiveLineChart
            height={240}
            series={[
              { data: live, color: "#fbbf24", unit: "kW", name: "发电功率" },
              { data: irrLive, color: "#fb923c", unit: "W/m²", name: "辐照度", dashed: true },
            ]}
          />
        </div>

        <div className="ops-panel">
          <div className="ops-panel-head">
            <h3><span className="material-symbols-outlined">solar_power</span>光伏阵列运行工况</h3>
            <span>自发自用率 {fmt(selfUse, 0)}%</span>
          </div>
          <div className="ops-pv-scene ops-scene">
            <svg viewBox="0 0 560 250" width="100%">
              <defs>
                <linearGradient id="pv-sky" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="rgba(56,130,246,0.2)" />
                  <stop offset="100%" stopColor="rgba(8,20,40,0)" />
                </linearGradient>
                <radialGradient id="pv-sun">
                  <stop offset="0%" stopColor="#fef08a" />
                  <stop offset="70%" stopColor="#fbbf24" />
                  <stop offset="100%" stopColor="#f59e0b" stopOpacity="0.4" />
                </radialGradient>
                <linearGradient id="pv-shimmer" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="#ffffff" stopOpacity="0" />
                  <stop offset="50%" stopColor="#ffffff" stopOpacity="0.3" />
                  <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
                </linearGradient>
              </defs>
              {/* 天光随日照强度明暗（晨昏变暗） */}
              <rect x="0" y="0" width="560" height="250" fill="url(#pv-sky)" opacity={0.3 + 0.7 * hourFactor} />
              {/* 太阳沿日轨迹运行：光晕 + 光线随行旋转 */}
              <g>
                <animateMotion dur="40s" repeatCount="indefinite" path="M 60 108 Q 280 14 500 108" />
                <circle r="26" fill="#fbbf24" opacity="0.16">
                  <animate attributeName="r" values="22;30;22" dur="3.2s" repeatCount="indefinite" />
                </circle>
                <circle r="15" fill="url(#pv-sun)" />
                <g>
                  <animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="14s" repeatCount="indefinite" />
                  {Array.from({ length: 8 }).map((_, i) => {
                    const a = (i / 8) * Math.PI * 2;
                    return (
                      <line
                        key={i} x1={Math.cos(a) * 20} y1={Math.sin(a) * 20} x2={Math.cos(a) * 28} y2={Math.sin(a) * 28}
                        stroke="#fde68a" strokeWidth="2" strokeLinecap="round" opacity="0.6"
                      />
                    );
                  })}
                </g>
              </g>
              {/* 漂移云朵 */}
              <g fill="#e2e8f0" opacity="0.08">
                <ellipse cx="150" cy="50" rx="34" ry="9">
                  <animateTransform attributeName="transform" type="translate" values="0 0; 42 4; 0 0" dur="22s" repeatCount="indefinite" />
                </ellipse>
                <ellipse cx="418" cy="32" rx="26" ry="7">
                  <animateTransform attributeName="transform" type="translate" values="0 0; -34 3; 0 0" dur="26s" repeatCount="indefinite" />
                </ellipse>
              </g>
              {/* 厂房与屋面光伏阵列 */}
              <rect x="330" y="138" width="140" height="82" rx="3" fill="rgba(15,40,72,0.85)" stroke="rgba(80,160,255,0.35)" />
              {Array.from({ length: 3 }).map((_, r) =>
                Array.from({ length: 6 }).map((_, c) => (
                  <rect key={`${r}-${c}`} x={344 + c * 20} y={150 + r * 20} width="14" height="12" rx="1.5" fill="rgba(56,189,248,0.14)" stroke="rgba(56,189,248,0.4)" strokeWidth="0.8">
                    <animate attributeName="fill" values="rgba(56,189,248,0.14);rgba(56,189,248,0.34);rgba(56,189,248,0.14)" dur="2.8s" begin={`${(r + c) * 0.15}s`} repeatCount="indefinite" />
                  </rect>
                )),
              )}
              <text x="400" y="234" textAnchor="middle" fill="#94a3b8" fontSize="10">厂区负荷</text>
              {/* 地面阵列 3×7：支架 + 高光扫掠 */}
              <g transform="translate(40 126) skewX(-12)">
                {Array.from({ length: 3 }).map((_, r) =>
                  Array.from({ length: 7 }).map((_, c) => (
                    <rect key={`${r}-${c}`} x={c * 26} y={r * 18} width="22" height="14" rx="2"
                      fill="#0e2a4a" stroke="#38bdf8" strokeWidth="1" opacity="0.85">
                      <animate attributeName="fill" values="#0e2a4a;#1d4e7e;#0e2a4a" dur="3s" begin={`${(r + c) * 0.14}s`} repeatCount="indefinite" />
                    </rect>
                  )),
                )}
                <rect x="-26" y="0" width="24" height="52" fill="url(#pv-shimmer)">
                  <animate attributeName="x" values="-26;216" dur="3.6s" repeatCount="indefinite" />
                </rect>
                {[30, 104, 166].map((lx) => (
                  <line key={lx} x1={lx} y1={54} x2={lx} y2={66} stroke="#7d8aa5" strokeWidth="2" />
                ))}
                <line x1="0" y1="66" x2="180" y2="66" stroke="#7d8aa5" strokeWidth="1.5" opacity="0.6" />
              </g>
              <text x="132" y="208" textAnchor="middle" fill="#7dd3fc" fontSize="10">光伏阵列 68 kWp</text>
              {/* 逆变器（含实时出力负载条） */}
              <rect x="230" y="148" width="54" height="46" rx="6" fill="rgba(19,45,82,0.9)" stroke="#38bdf8" strokeWidth="1.2" />
              <text x="257" y="164" textAnchor="middle" fill="#7dd3fc" fontSize="10">逆变器</text>
              <rect x="236" y="172" width="42" height="5" rx="2.5" fill="rgba(80,160,255,0.22)" />
              <rect x="236" y="172" width={Math.max(3, 42 * clamp(power / 60, 0, 1))} height="5" rx="2.5" fill="#34d399">
                <animate attributeName="opacity" values="0.7;1;0.7" dur="2s" repeatCount="indefinite" />
              </rect>
              <circle cx="257" cy="186" r="2.5" fill="#34d399">
                <animate attributeName="opacity" values="0.3;1;0.3" dur="1.5s" repeatCount="indefinite" />
              </circle>
              {/* 电网塔杆 */}
              <g stroke="#7d8aa5" strokeWidth="2" strokeLinecap="round">
                <line x1="492" y1="236" x2="506" y2="168" /><line x1="520" y1="236" x2="506" y2="168" />
                <line x1="492" y1="196" x2="520" y2="196" /><line x1="497" y1="182" x2="515" y2="182" />
              </g>
              <text x="506" y="248" textAnchor="middle" fill="#94a3b8" fontSize="10">公共电网</text>
              {/* 能量流动：阵列 → 逆变器 → 负荷 / 电网（余电经架空线上网） */}
              {[0, 1, 2].map((i) => (
                <circle key={`a${i}`} r="3.2" fill="#fde68a">
                  <animateMotion dur={`${0.9 + i * 0.22}s`} begin={`${i * 0.3}s`} repeatCount="indefinite" path="M 222 140 C 226 150, 228 154, 232 162" />
                  <animate attributeName="opacity" values="0;1;0" dur={`${0.9 + i * 0.22}s`} begin={`${i * 0.3}s`} repeatCount="indefinite" />
                </circle>
              ))}
              {[0, 1, 2].map((i) => (
                <circle key={`b${i}`} r="3.2" fill="#7dd3fc">
                  <animateMotion dur={`${0.9 + i * 0.25}s`} begin={`${i * 0.32}s`} repeatCount="indefinite" path="M 284 168 C 300 172, 314 172, 328 170" />
                  <animate attributeName="opacity" values="0;1;0" dur={`${0.9 + i * 0.25}s`} begin={`${i * 0.32}s`} repeatCount="indefinite" />
                </circle>
              ))}
              <path d="M 284 150 C 330 116, 420 110, 494 166" stroke="#7d8aa5" strokeWidth="1.5" fill="none" opacity="0.7" />
              {[0, 1, 2].map((i) => (
                <circle key={`c${i}`} r="3.2" fill="#c4b5fd">
                  <animateMotion dur={`${1.2 + i * 0.3}s`} begin={`${0.2 + i * 0.4}s`} repeatCount="indefinite" path="M 284 150 C 330 116, 420 110, 494 166" />
                  <animate attributeName="opacity" values="0;1;0" dur={`${1.2 + i * 0.3}s`} begin={`${0.2 + i * 0.4}s`} repeatCount="indefinite" />
                </circle>
              ))}
            </svg>
            <div className="ops-scene-caption">
              今日发电 {fmt(todayKwh, 0)} kWh · 自发自用 {fmt(selfUse, 0)}% · 余电上网 {fmt(gridExport, 1)} kW · 逆变器 3/3 在线
            </div>
          </div>
        </div>
      </div>

      {/* 月度发电量 */}
      <div className="ops-panel">
        <div className="ops-panel-head">
          <h3><span className="material-symbols-outlined">bar_chart</span>月度发电量（万kWh）</h3>
          <span>年累计 {fmt(MONTH_PV.reduce((a, b) => a + b, 0), 1)} 万kWh · 计划完成率 {Math.round((MONTH_PV.reduce((a, b) => a + b, 0) / (MONTH_PLAN * 12)) * 100)}%</span>
        </div>
        <AnimatedBars items={MONTHS.map((m, i) => ({ label: m, value: MONTH_PV[i] }))} color="#fbbf24" unit="万kWh" target={MONTH_PLAN} targetLabel="月度计划" />
      </div>

      {/* 逆变器运行状态 */}
      <div className="ops-grid-3">
        {inverters.map((inv) => (
          <div key={inv.id} className="ops-panel ops-inv-card">
            <div className="ops-panel-head">
              <h3><span className="material-symbols-outlined">electrical_services</span>{inv.id}</h3>
              <span className="ops-inv-state"><span className={`ops-state-dot ${inv.dot}`} />{LEVEL_TEXT[inv.level]}</span>
            </div>
            <div className="ops-inv-metrics">
              <div><em>实时功率</em><strong>{fmt(inv.power, 1)} kW</strong></div>
              <div><em>转换效率</em><strong style={{ color: LEVEL_COLOR[assessLow(inv.eff, 97.5, 96.5)] }}>{fmt(inv.eff, 1)}%</strong></div>
              <div><em>机内温度</em><strong style={{ color: LEVEL_COLOR[assessHigh(inv.temp, 50, 60)] }}>{fmt(inv.temp, 1)} ℃</strong></div>
              <div><em>今日发电</em><strong>{fmt(inv.kwh, 0)} kWh</strong></div>
            </div>
            <div className="ops-mini-track"><span style={{ width: `${clamp((inv.power / 25) * 100, 4, 100)}%` }} /></div>
          </div>
        ))}
      </div>

      {/* 动态检测与处置：阈值实时判定，异常一键联动运维 */}
      <div className="ops-panel">
        <div className="ops-panel-head">
          <h3><span className="material-symbols-outlined">troubleshoot</span>动态检测与处置建议</h3>
          <span>阈值 PR≥80% · 组件温度≤60℃ · 逆变效率≥97.5% · {pvAlerts.length === 0 ? "全部正常" : `${pvAlerts.length} 条待处理`}</span>
        </div>
        <DetectStrip alerts={pvAlerts} emptyText="PR、组件温度与逆变器均在阈值内，继续保持巡检节拍" />
      </div>

      {/* 节能减排效益 */}
      <div className="ops-panel">
        <div className="ops-panel-head">
          <h3><span className="material-symbols-outlined">eco</span>节能减排效益</h3>
          <span>按火电排放因子 0.5703 tCO₂/MWh 折算</span>
        </div>
        <div className="ops-env-row">
          {envStats.map((s) => (
            <div key={s.label} className="ops-env-card">
              <span className="material-symbols-outlined" style={{ color: s.color }}>{s.icon}</span>
              <div>
                <em>{s.label}</em>
                <strong style={{ color: s.color }}>{s.value}<em>{s.unit}</em></strong>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ═══════════════ 净水与中水回用 ═══════════════ */

export function WaterReusePage() {
  const t = useTick(3200);
  const rawIntake = wave(t, 42, 5, 10);        // 原水取水 m³/h
  const supply = wave(t, 20.8, 1.8, 9);        // 净水供水量 m³/h
  const reuseDaily = wave(t, 58, 4, 12);       // 中水回用量 m³/d
  const reuseRate = wave(t, 32.4, 2.2, 20);    // 中水回用率 %
  const turbidity = wave(t, 0.42, 0.08, 9);    // 浊度 NTU
  const residualCl = wave(t, 0.35, 0.06, 8);   // 余氯 mg/L
  const ph = wave(t, 7.4, 0.18, 14);           // pH

  const [flowData, setFlowData] = useState<number[]>(() => Array.from({ length: 30 }, (_, i) => 40 + Math.sin(i / 5) * 8));
  const [supData, setSupData] = useState<number[]>(() => Array.from({ length: 30 }, (_, i) => 20 + Math.sin(i / 4 + 1) * 3));
  useEffect(() => {
    setFlowData((prev) => [...prev.slice(1), rawIntake]);
    setSupData((prev) => [...prev.slice(1), Math.max(2, supply)]);
  }, [t]); // eslint-disable-line react-hooks/exhaustive-deps

  const tanks = [
    { name: "原水调节池", base: 68, volume: "120 m³", color: "#38bdf8" },
    // 中水池随回用需求波动大：会偶发跌破 30% 低液位线，演示低液位预警与自动补水
    { name: "中水池", base: 33, volume: "80 m³", color: "#34d399" },
    { name: "净水箱", base: 76, volume: "60 m³", color: "#7dd3fc" },
  ].map((tank, i) => ({
    ...tank,
    level: Math.round(clamp(tank.base + Math.sin(t / 3 + i) * 4, 10, 95)),
  }));

  const quality = [
    { name: "CODcr", value: wave(t, 38, 3, 11, 0.2, 21), limit: 60, unit: "mg/L", color: "#38bdf8" },
    { name: "BOD₅", value: wave(t, 6.2, 0.6, 9, 0.2, 22), limit: 10, unit: "mg/L", color: "#34d399" },
    // 氨氮随进水波动：偶发接近 85% 预警线，演示水质预警的产生与恢复
    { name: "氨氮", value: wave(t, 3.4, 0.8, 13, 0.25, 23), limit: 5, unit: "mg/L", color: "#a78bfa" },
    { name: "余氯", value: residualCl, limit: 1.0, unit: "mg/L", color: "#fbbf24" },
  ].map((q) => ({ ...q, level: assessHigh(q.value, q.limit * 0.85, q.limit) }));

  const turbidityLevel = assessHigh(turbidity, 4, 5);
  const phLevel: DetectLevel = ph < 6.5 || ph > 9.0 ? "alarm" : ph < 6.8 || ph > 8.5 ? "warn" : "ok";
  const allLevels: DetectLevel[] = [...quality.map((q) => q.level), turbidityLevel, phLevel];
  const okCount = allLevels.filter((l) => l === "ok").length;
  const compliance = Math.round((okCount / allLevels.length) * 100);

  // 动态检测：水质超限 / 液位过低 / 回用率偏低
  const waterAlerts: OpsAlert[] = [];
  for (const q of quality) {
    if (q.level === "ok") continue;
    waterAlerts.push({
      level: q.level, icon: "science",
      text: `${q.name} ${fmt(q.value, 2)} ${q.unit}（限值 ${q.limit}）`,
      detail: q.level === "alarm" ? "已超限值，立即核查加药与膜通量" : "接近限值 85%，加强加密监测",
      action: q.level === "alarm" ? "启动应急预案并留样复测" : "加密监测频次", to: "/facility-ops",
    });
  }
  if (turbidityLevel !== "ok") {
    waterAlerts.push({
      level: turbidityLevel, icon: "opacity", text: `出水浊度 ${fmt(turbidity, 2)} NTU 偏高`,
      detail: "检查滤池反洗周期与混凝加药", action: "提前反洗并校核加药量", to: "/facility-ops",
    });
  }
  if (phLevel !== "ok") {
    waterAlerts.push({
      level: phLevel, icon: "ph", text: `出水 pH ${fmt(ph, 2)} 偏离 6.5~9.0`,
      detail: "核查加药系统与在线仪表", action: "校准 pH 计并复核加药", to: "/facility-ops",
    });
  }
  for (const tank of tanks) {
    if (tank.level >= 30) continue;
    waterAlerts.push({
      level: tank.level < 20 ? "alarm" : "warn", icon: "water",
      text: `${tank.name}液位偏低（${tank.level}%）`,
      detail: "低于 30% 低液位线，已触发自动补水联锁",
      action: "确认补水阀动作并排查跑冒滴漏", to: "/facility-ops",
    });
  }

  const processChain = [
    { icon: "filter_alt", name: "预处理", value: `取水 ${fmt(rawIntake, 1)} m³/h` },
    { icon: "waves", name: "MBR 膜池", value: `产水 ${fmt(supply, 1)} m³/h` },
    { icon: "sanitizer", name: "消毒", value: `余氯 ${fmt(residualCl, 2)} mg/L` },
    { icon: "recycling", name: "中水回用", value: `${fmt(reuseDaily, 0)} m³/d · ${fmt(reuseRate, 1)}%` },
  ];

  const dailyUse = [
    { label: "绿化浇灌", value: 22 },
    { label: "冲厕", value: 18 },
    { label: "道路浇洒", value: 10 },
    { label: "景观补水", value: 8 },
  ];

  return (
    <div className="page-container">
      <PageHeader icon="water_drop" title="净水与中水回用" subtitle="净水处理与中水回用双系统运行监测 · GB 50336-2018 / GB/T 18920-2020" />

      {/* 顶部动态仪表组 */}
      <div className="ops-panel">
        <div className="ops-gauges-meta">
          <span><span className="material-symbols-outlined">factory</span>处理规模 1000 m³/d</span>
          <span><span className="material-symbols-outlined">account_tree</span>工艺 预处理 + MBR 膜 + 消毒</span>
          <span><span className="material-symbols-outlined">settings</span>机组 2 用 1 备</span>
          <span><span className="material-symbols-outlined">verified</span>排水许可证在有效期</span>
        </div>
        <div className="ops-gauges-row ops-gauges-row-flush">
          <GaugeRing value={supply} max={30} label="净水供水量" unit="m³/h" color="#38bdf8" />
          <GaugeRing value={rawIntake} max={60} label="原水取水量" unit="m³/h" color="#818cf8" />
          <GaugeRing value={reuseDaily} max={90} label="中水回用量" unit="m³/d" color="#34d399" />
          <GaugeRing value={reuseRate} max={50} label="中水回用率" unit="%" color="#7dd3fc" />
          <GaugeRing value={turbidity} max={2} label="出水浊度" unit="NTU" color="#fbbf24" />
        </div>
      </div>

      {/* 处理水量曲线 + 水池液位 */}
      <div className="ops-grid-2">
        <div className="ops-panel">
          <div className="ops-panel-head">
            <h3><span className="material-symbols-outlined">monitoring</span>处理水量曲线</h3>
            <span className="ops-live-badge"><i />LIVE</span>
          </div>
          <LiveLineChart
            height={205}
            series={[
              { data: flowData, color: "#818cf8", unit: "取水 m³/h", name: "原水取水" },
              { data: supData, color: "#38bdf8", unit: "供水 m³/h", name: "净水供水" },
            ]}
          />
        </div>

        <div className="ops-panel">
          <div className="ops-panel-head">
            <h3><span className="material-symbols-outlined">water</span>调蓄水池液位</h3>
            <span>液位实时波动 · 低液位自动补水</span>
          </div>
          <div className="ops-tanks">
            {tanks.map((tank, i) => {
              const level = tank.level;
              const lowLevel = level < 30;
              return (
                <div key={tank.name} className="ops-tank">
                  <div className="ops-tank-body">
                    <div className="ops-tank-water" style={{ height: `${level}%`, background: `linear-gradient(180deg, ${tank.color}cc, ${tank.color}55)` }}>
                      <i className="ops-tank-crest" style={{ background: "rgba(255,255,255,0.22)", animationDelay: `${i * 0.5}s` }} />
                      <i className="ops-tank-crest slow" style={{ background: "rgba(255,255,255,0.12)", animationDelay: `${i * 0.9}s` }} />
                    </div>
                    <strong>{level}%</strong>
                  </div>
                  <em>{tank.name}{lowLevel && <span className="ops-tank-warn"> · 低液位</span>}</em>
                  <span>调蓄容积 {tank.volume}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* 水质监测 + 回用去向 */}
      <div className="ops-grid-2">
        <div className="ops-panel">
          <div className="ops-panel-head">
            <h3><span className="material-symbols-outlined">analytics</span>中水水质实时监测</h3>
            <span className="ops-quality-badge" style={compliance < 100 ? { color: "#fbbf24", borderColor: "rgba(251,191,36,0.4)" } : undefined}>
              <span className="material-symbols-outlined">verified</span>综合达标率 {compliance}%
            </span>
          </div>
          <div className="ops-quality-list">
            {quality.map((q) => {
              const qc = q.level === "ok" ? q.color : LEVEL_COLOR[q.level];
              return (
                <div key={q.name} className="ops-quality-row">
                  <em>{q.name}{q.level !== "ok" && <span className={q.level === "alarm" ? "ops-trend-down" : "ops-trend-flat"}> ●</span>}</em>
                  <div className="ops-quality-track">
                    <span style={{ width: `${clamp((q.value / q.limit) * 100, 0, 100)}%`, background: `linear-gradient(90deg, ${qc}, ${qc}88)`, boxShadow: `0 0 8px ${qc}66` }} />
                  </div>
                  <strong style={{ color: qc }}>{fmt(q.value, 2)}</strong>
                  <span className="ops-quality-limit">限值 {q.limit} {q.unit}</span>
                </div>
              );
            })}
            <div className="ops-quality-row">
              <em>浊度{turbidityLevel !== "ok" && <span className="ops-trend-down"> ●</span>}</em>
              <div className="ops-quality-track">
                <span style={{ width: `${clamp((turbidity / 5) * 100, 0, 100)}%`, background: `linear-gradient(90deg, ${LEVEL_COLOR[turbidityLevel] === "#34d399" ? "#fbbf24" : LEVEL_COLOR[turbidityLevel]}, ${LEVEL_COLOR[turbidityLevel] === "#34d399" ? "#fbbf2488" : LEVEL_COLOR[turbidityLevel] + "88"})` }} />
              </div>
              <strong style={{ color: turbidityLevel === "ok" ? "#fbbf24" : LEVEL_COLOR[turbidityLevel] }}>{fmt(turbidity, 2)}</strong>
              <span className="ops-quality-limit">限值 5 NTU</span>
            </div>
            <div className="ops-quality-row">
              <em>pH 值{phLevel !== "ok" && <span className="ops-trend-down"> ●</span>}</em>
              <div className="ops-quality-track">
                <span style={{ width: `${clamp((ph / 9) * 100, 0, 100)}%`, background: `linear-gradient(90deg, ${phLevel === "ok" ? "#a78bfa" : LEVEL_COLOR[phLevel]}, ${phLevel === "ok" ? "#a78bfa88" : LEVEL_COLOR[phLevel] + "88"})` }} />
              </div>
              <strong style={{ color: phLevel === "ok" ? "#a78bfa" : LEVEL_COLOR[phLevel] }}>{fmt(ph, 2)}</strong>
              <span className="ops-quality-limit">范围 6.5 ~ 9.0</span>
            </div>
          </div>
        </div>

        <div className="ops-panel">
          <div className="ops-panel-head">
            <h3><span className="material-symbols-outlined">recycling</span>中水回用去向（m³/d）</h3>
            <span>日回用 {fmt(reuseDaily, 0)} m³ · 占杂排水量 {fmt(reuseRate, 1)}%</span>
          </div>
          <AnimatedBars items={dailyUse} color="#34d399" unit="m³/d" />
          <div className="ops-scene-caption">
            供水优先级：冲厕 → 绿化浇灌 → 道路浇洒 → 景观补水 · 缺水时自动切换市政补水
          </div>
        </div>
      </div>

      {/* 处理工艺流程 + 动态检测与处置 */}
      <div className="ops-panel">
        <div className="ops-panel-head">
          <h3><span className="material-symbols-outlined">account_tree</span>处理工艺流程（实时工况）</h3>
          <span>预处理 + MBR 膜 + 消毒 · 机组 2 用 1 备</span>
        </div>
        <div className="ops-process">
          {processChain.map((p, i) => (
            <div key={p.name} className="ops-process-node">
              <span className="material-symbols-outlined">{p.icon}</span>
              <strong>{p.name}</strong>
              <em>{p.value}</em>
              {i < processChain.length - 1 && <span className="material-symbols-outlined ops-process-arrow">arrow_forward</span>}
            </div>
          ))}
        </div>
      </div>

      <div className="ops-panel">
        <div className="ops-panel-head">
          <h3><span className="material-symbols-outlined">troubleshoot</span>动态检测与处置建议</h3>
          <span>水质限值 GB/T 18920 · 液位低线 30% · {waterAlerts.length === 0 ? "全部正常" : `${waterAlerts.length} 条待处理`}</span>
        </div>
        <DetectStrip alerts={waterAlerts} emptyText="水质六项与三池液位均在阈值内，回用系统稳定" />
      </div>
    </div>
  );
}

/* ═══════════════ 设施运维管理 ═══════════════ */

export function FacilityOpsPage() {
  const t = useTick(3400);

  const [co2Series, setCo2Series] = useState<number[]>(() => Array.from({ length: 30 }, (_, i) => 620 + Math.sin(i / 4) * 60));
  const [tempSeries, setTempSeries] = useState<number[]>(() => Array.from({ length: 30 }, (_, i) => 24 + Math.sin(i / 6) * 1.1));
  const co2 = wave(t, 618, 52, 16);
  const indoorTemp = wave(t, 24.2, 0.9, 11);
  useEffect(() => {
    setCo2Series((prev) => [...prev.slice(1), co2]);
    setTempSeries((prev) => [...prev.slice(1), indoorTemp]);
  }, [t]); // eslint-disable-line react-hooks/exhaustive-deps

  const devices = [
    { name: "电梯系统", base: 94, amp: 1.5, period: 10, color: "#38bdf8", seed: 31, advice: "核查曳引机电流与门机循环次数" },
    { name: "暖通空调", base: 89, amp: 2.5, period: 8, color: "#a78bfa", seed: 32, advice: "检查冷冻水供回水温差与过滤器压差" },
    { name: "消防泵组", base: 97, amp: 1, period: 14, color: "#f87171", seed: 33, advice: "手动盘车并测试压力开关动作" },
    { name: "照明系统", base: 92, amp: 2, period: 12, color: "#fbbf24", seed: 34, advice: "抽查应急照明放电时长" },
    { name: "给排水泵", base: 91, amp: 2, period: 9, color: "#34d399", seed: 35, advice: "检查水泵振动与机械密封渗漏" },
    { name: "光伏系统", base: 96, amp: 1.2, period: 11, color: "#fb923c", seed: 36, advice: "对照光伏页组串级检测结论" },
  ].map((d) => {
    const health = wave(t, d.base, d.amp, d.period, 0.2, d.seed);
    return { ...d, health, level: assessLow(health, 90, 85) };
  });
  const composite = devices.reduce((s, d) => s + d.health, 0) / devices.length;
  const compositeLevel = assessLow(composite, 90, 85);

  const orders = [
    { status: "待接单", count: 2, color: "#fbbf24" },
    { status: "处理中", count: 5, color: "#38bdf8" },
    { status: "本月已完成", count: 34, color: "#34d399" },
    { status: "已逾期", count: 1, color: "#f87171" },
  ];

  const energy = [
    { label: "空调采暖", value: 1284 },
    { label: "照明插座", value: 862 },
    { label: "动力设备", value: 641 },
    { label: "给排水", value: 418 },
    { label: "特殊用电", value: 286 },
  ];

  const planTimeline = [
    { system: "电梯系统", progress: 72, next: "08-30", team: "机电一班" },
    { system: "暖通空调", progress: 38, next: "09-05", team: "暖通班组" },
    { system: "消防设施", progress: 55, next: "09-10", team: "消防维保" },
    { system: "给排水/中水", progress: 20, next: "10-20", team: "给排水班组" },
    { system: "光伏系统", progress: 88, next: "11-01", team: "光伏运维" },
    { system: "电气照明", progress: 46, next: "12-18", team: "电气班组" },
  ];

  const opex = [
    { label: "维修耗材", value: 28, color: "#38bdf8" },
    { label: "电梯维保", value: 22, color: "#a78bfa" },
    { label: "暖通保养", value: 18, color: "#fbbf24" },
    { label: "消防维保", value: 14, color: "#f87171" },
    { label: "光伏运维", value: 10, color: "#34d399" },
    { label: "零星维修", value: 8, color: "#fb923c" },
  ];

  const alerts: Array<{ level: DetectLevel | "info" | "ok"; icon: string; text: string; detail: string; time: string }> = [
    // 由设备健康度实时推导：低于 90 分预警、低于 85 分告警（含处置建议，形成闭环）
    ...devices
      .filter((d) => d.level !== "ok")
      .map((d) => ({
        level: d.level as DetectLevel,
        icon: "monitor_heart",
        text: `${d.name}健康度 ${fmt(d.health, 1)} 分${d.level === "alarm" ? "（告警）" : "（预警）"}`,
        detail: d.advice,
        time: "刚刚",
      })),
    { level: "warn", icon: "speed", text: "MBR 膜组跨膜压差升高", detail: "12.4 kPa，建议执行在线反洗程序", time: "1 小时前" },
    { level: "info", icon: "event_available", text: "电梯系统年度检验临近", detail: "检验证书 09-15 到期，需预约特检机构", time: "今天 08:30" },
    { level: "ok", icon: "check_circle", text: "消防泵组月度巡检完成", detail: "12 项功能测试全部通过，台账已归档", time: "昨天 17:05" },
  ];

  const donutTotal = orders.reduce((s, o) => s + o.count, 0);
  const energyTotal = energy.reduce((s, e) => s + e.value, 0);
  let donutOffset = 0;

  return (
    <div className="page-container">
      <PageHeader icon="build_circle" title="设施运维管理" subtitle="设备健康监测 · 维保工单闭环 · 分项能耗统计 · 运维成本分析" />

      {/* 设备健康度动态环形组 */}
      <div className="ops-panel">
        <div className="ops-panel-head">
          <h3><span className="material-symbols-outlined">monitor_heart</span>设备健康度实时监测</h3>
          <span className="ops-live-badge"><i />LIVE</span>
        </div>
        <div className="ops-gauges-meta">
          <span><span className="material-symbols-outlined">speed</span>综合健康度 <strong style={{ color: LEVEL_COLOR[compositeLevel] }}>{fmt(composite, 1)} 分 · {LEVEL_TEXT[compositeLevel]}</strong></span>
          <span><span className="material-symbols-outlined">model_training</span>预测性维护模型 v2.4</span>
          <span><span className="material-symbols-outlined">sensors</span>在岗测点 486 个 · 完好率 99.4%</span>
        </div>
        <div className="ops-health-row">
          {devices.map((d) => (
            <GaugeRing key={d.name} value={d.health} max={100} label={d.name} unit="%" color={d.color} size={110} />
          ))}
        </div>
      </div>

      {/* 工单环形 + 室内环境双曲线 */}
      <div className="ops-grid-2">
        <div className="ops-panel">
          <div className="ops-panel-head">
            <h3><span className="material-symbols-outlined">assignment</span>维保工单状态</h3>
            <span>平均响应 5.2 h · 按时闭环率 97%</span>
          </div>
          <div className="ops-donut-wrap">
            <svg width="170" height="170" viewBox="0 0 170 170">
              {orders.map((o) => {
                const ratio = o.count / donutTotal;
                const dash = ratio * 289;
                const el = (
                  <circle key={o.status} cx="85" cy="85" r="46" fill="none" stroke={o.color} strokeWidth="16"
                    strokeDasharray={`${dash} ${289 - dash}`} strokeDashoffset={-donutOffset}
                    transform="rotate(-90 85 85)" opacity="0.9">
                    <animate attributeName="stroke-width" values="12;20;12" dur="2s" repeatCount="indefinite" />
                  </circle>
                );
                donutOffset += dash;
                return el;
              })}
              <text x="85" y="80" textAnchor="middle" fill="#e2e8f0" fontSize="22" fontWeight="800">{donutTotal}</text>
              <text x="85" y="100" textAnchor="middle" fill="#94a3b8" fontSize="11">工单总数</text>
            </svg>
            <div className="ops-donut-legend">
              {orders.map((o) => (
                <div key={o.status}>
                  <i style={{ background: o.color }} />
                  <em>{o.status}</em>
                  <strong>{o.count}</strong>
                  <span>{Math.round((o.count / donutTotal) * 100)}%</span>
                </div>
              ))}
            </div>
          </div>
          <div className="ops-order-stats">
            <div><em>今日新增</em><strong>6 单</strong></div>
            <div><em>现场在办</em><strong>3 单</strong></div>
            <div><em>逾期处置</em><strong>1 单</strong></div>
          </div>
        </div>

        <div className="ops-panel">
          <div className="ops-panel-head">
            <h3><span className="material-symbols-outlined">air</span>室内环境监测（CO₂ × 温度）</h3>
            <span className="ops-live-badge"><i />LIVE</span>
          </div>
          <LiveLineChart
            height={185}
            series={[
              { data: co2Series, color: "#a78bfa", unit: "ppm", name: "CO₂浓度", max: 900 },
              { data: tempSeries, color: "#fb923c", unit: "℃", name: "室内温度", dashed: true },
            ]}
          />
          <div className="ops-scene-caption">
            新风机组按 CO₂ 浓度联动调速 · 目标 24 ± 1 ℃ / CO₂ ≤ 800 ppm
          </div>
        </div>
      </div>

      {/* 分项能耗 + 年度维保计划 */}
      <div className="ops-grid-2">
        <div className="ops-panel">
          <div className="ops-panel-head">
            <h3><span className="material-symbols-outlined">electric_meter</span>今日分项能耗（kWh）</h3>
            <span>合计 {fmt(energyTotal, 0)} kWh · 同比 -2.4%</span>
          </div>
          <AnimatedBars items={energy} color="#7dd3fc" unit="kWh" />
        </div>

        <div className="ops-panel">
          <div className="ops-panel-head">
            <h3><span className="material-symbols-outlined">event_repeat</span>年度维保计划进度</h3>
            <span>按系统推进</span>
          </div>
          <div className="ops-timeline">
            {planTimeline.map((p, i) => (
              <div key={p.system} className="ops-timeline-row" style={{ animationDelay: `${i * 0.08}s` }}>
                <em>{p.system}</em>
                <div className="ops-timeline-track">
                  <span style={{
                    width: `${p.progress}%`,
                    background: `linear-gradient(90deg, #2563eb, #4dd4ff)`,
                    boxShadow: "0 0 8px rgba(77,212,255,0.5)",
                    animation: "ops-glow 2.8s ease-in-out infinite",
                  }} />
                  <strong>{p.progress}%</strong>
                </div>
                <span className="ops-timeline-next">下次 {p.next} · {p.team}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 运维成本 + 运维预警 */}
      <div className="ops-grid-2">
        <div className="ops-panel">
          <div className="ops-panel-head">
            <h3><span className="material-symbols-outlined">pie_chart</span>年度运维成本构成（%）</h3>
            <span>预算执行 63% · 累计支出 86.4 万元</span>
          </div>
          <div className="ops-cost-bars">
            {opex.map((o, i) => (
              <div key={o.label} className="ops-cost-row" style={{ animationDelay: `${i * 0.08}s` }}>
                <em>{o.label}</em>
                <div className="ops-cost-track">
                  <span style={{
                    width: `${o.value * 3}%`,
                    background: `linear-gradient(90deg, ${o.color}, ${o.color}66)`,
                    boxShadow: `0 0 10px ${o.color}55`,
                    animation: "ops-pulse 3s ease-in-out infinite",
                  }} />
                </div>
                <strong style={{ color: o.color }}>{o.value}%</strong>
              </div>
            ))}
          </div>
          <div className="ops-scene-caption">
            单位面积年运维成本 28.6 元/m² · 同比 -3.1% · 外包合同占比 62%
          </div>
        </div>

        <div className="ops-panel">
          <div className="ops-panel-head">
            <h3><span className="material-symbols-outlined">notifications_active</span>运维预警与提醒</h3>
            <span>待处理 {alerts.filter((a) => a.level !== "ok").length} 条</span>
          </div>
          <div className="ops-alert-list">
            {alerts.map((a, i) => (
              <div key={a.text} className="ops-alert-row" style={{ animationDelay: `${i * 0.08}s` }}>
                <span className={`ops-alert-icon ${a.level}`}><span className="material-symbols-outlined">{a.icon}</span></span>
                <div className="ops-alert-body">
                  <strong>{a.text}</strong>
                  <em>{a.detail}</em>
                </div>
                <span className="ops-alert-time">{a.time}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
