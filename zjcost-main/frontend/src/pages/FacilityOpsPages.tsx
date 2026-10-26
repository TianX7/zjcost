/* eslint-disable react-refresh/only-export-components -- 本文件同时导出运营页共用的检测常量与辅助函数 */
import { useEffect, useId, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { message } from "antd";
import Panel from "../components/Panel";
import OpsScene3D from "../components/OpsScene3D";
import "../styles/ops-screen.css";

/* ─────────────────────────────────────────────────────────────
 * 运营期专题页面：光伏发电监测 / 净水与中水回用 / 设施运维管理
 * 三级运营页统一重构为数字孪生大屏：三栏数据 + 中央场景
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
  const [disposed, setDisposed] = useState<Record<string, boolean>>({});
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
  const toggleDispose = (a: OpsAlert, i: number) => {
    const key = `${a.text}-${i}`;
    const next = !disposed[key];
    setDisposed((prev) => ({ ...prev, [key]: next }));
    if (next) message.success(`已受理：${a.text}，处置单已生成`);
  };
  const disposedCount = alerts.filter((a, i) => disposed[`${a.text}-${i}`]).length;
  return (
    <div className="ops-alert-list">
      {alerts.map((a, i) => {
        const key = `${a.text}-${i}`;
        const isDisposed = disposed[key];
        return (
          <div key={key} className={`ops-alert-row${isDisposed ? " disposed" : ""}`}>
            <span className={`ops-alert-icon ${a.level === "alarm" ? "alarm" : a.level}`}>
              <span className="material-symbols-outlined">{a.icon}</span>
            </span>
            <div className="ops-alert-body">
              <strong>{LEVEL_TEXT[a.level]} · {a.text}</strong>
              <em>{a.detail}{a.action ? ` → ${a.action}` : ""}</em>
            </div>
            <button type="button" className={`ops-link-btn${isDisposed ? " disposed" : ""}`} onClick={() => toggleDispose(a, i)}>
              {isDisposed ? "撤销处置" : "处置"}
            </button>
          </div>
        );
      })}
      {disposedCount > 0 && (
        <div className="ops-alert-row disposed-summary">
          <span className="ops-alert-icon ok"><span className="material-symbols-outlined">task_alt</span></span>
          <div className="ops-alert-body"><strong>已处置 {disposedCount} 条</strong><em>处置记录留存于本界面，刷新后恢复待办</em></div>
        </div>
      )}
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
  const uid = useId().replace(/:/g, "");
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
              <circle cx={head[0]} cy={head[1]} r="3.4" fill={s.color} opacity="0.9" />
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
      {items.map((item) => (
        <div key={item.label} className="ops-bar-col">
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
  const todayIncome = todayKwh * 0.62;
  const totalIncome = 12.86 * 0.62;
  const monthTotal = MONTH_PV.reduce((a, b) => a + b, 0);

  // 厂区电力路径：屋面阵列 → 汇流箱 → 逆变器 → 配电房 → 厂区负荷 / 并网点
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

  // 场景节点色调取三台逆变器中最严重的一台
  const pvTone = inverters.some((inv) => inv.level === "alarm")
    ? "alarm"
    : inverters.some((inv) => inv.level === "warn")
      ? "warn"
      : "ok";

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
    <div className="ops-screen ops-screen-page">
      <div className="ops-columns">
        {/* 左栏：环形仪表 + 月度发电量 + 逆变器状态 */}
        <div className="ops-col ops-col-left">
          <Panel title="实时运行参数" icon="speed" live>
            <div className="ops-gauge-grid">
              <GaugeRing value={power} max={60} label="实时发电功率" unit="kW" color="#fbbf24" size={118} />
              <GaugeRing value={irradiance} max={1100} label="屋面辐照度" unit="W/m²" color="#fb923c" size={118} />
              <GaugeRing value={cellTemp} max={80} label="组件背板温度" unit="℃" color="#f87171" size={118} />
              <GaugeRing value={pr} max={100} label="系统效率比 PR" unit="%" color="#34d399" size={118} />
            </div>
            <div className="ops-gauge-strip">
              <span className="material-symbols-outlined">bolt</span>
              <em>当日发电量</em>
              <strong>{fmt(todayKwh, 1)}<i>kWh</i></strong>
            </div>
          </Panel>

          <Panel
            title="月度发电量"
            icon="bar_chart"
            extra={<span>年累计 {fmt(monthTotal, 1)} 万kWh</span>}
          >
            <AnimatedBars
              items={MONTHS.map((m, i) => ({ label: m, value: MONTH_PV[i] }))}
              color="#fbbf24"
              unit="万kWh"
              target={MONTH_PLAN}
              targetLabel="月度计划"
            />
            <div className="ops-stage-caption" style={{ textAlign: "center", paddingTop: 4 }}>
              计划完成率 {Math.round((monthTotal / (MONTH_PLAN * 12)) * 100)}%
            </div>
          </Panel>

          <Panel
            title="逆变器状态"
            icon="electrical_services"
            extra={<span>在线 3/3 · 效率基线 97.5%</span>}
          >
            <div className="ops-inverter-list">
              {inverters.map((inv) => (
                <div key={inv.id} className="ops-inverter-row">
                  <span className={`ops-state-dot ${inv.dot}`} />
                  <div className="ops-inverter-main">
                    <div className="ops-inverter-head">
                      <strong>{inv.id}</strong>
                      <em>{LEVEL_TEXT[inv.level]}</em>
                    </div>
                    <div className="ops-inverter-metrics">
                      <span>功率<b>{fmt(inv.power, 1)} kW</b></span>
                      <span>效率<b style={{ color: LEVEL_COLOR[assessLow(inv.eff, 97.5, 96.5)] }}>{fmt(inv.eff, 1)}%</b></span>
                      <span>温度<b style={{ color: LEVEL_COLOR[assessHigh(inv.temp, 50, 60)] }}>{fmt(inv.temp, 1)}℃</b></span>
                      <span>今日<b>{fmt(inv.kwh, 0)} kWh</b></span>
                    </div>
                    <div className="ops-mini-track"><span style={{ width: `${clamp((inv.power / 25) * 100, 4, 100)}%` }} /></div>
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        </div>

        {/* 中央：厂区屋面光伏数字孪生场景 */}
        <div className="ops-col ops-col-center">
          <div className="ops-stage">
            <div className="ops-stage-overlay ops-stage-overlay-top">
              <span className="ops-stage-chip">
                <span className="material-symbols-outlined">thermostat</span>
                厂区环温 <strong>{fmt(ambient, 1)}℃</strong>
              </span>
              <span className="ops-stage-chip">
                <span className="material-symbols-outlined">solar_power</span>
                屋面光伏 <strong>68 kWp</strong> · 组串 18
              </span>
              <span className="ops-stage-chip">
                <span className="material-symbols-outlined">electrical_services</span>
                逆变器 <strong>3/3 在线</strong>
              </span>
              <span className="ops-stage-chip">
                <span className="material-symbols-outlined">power</span>
                并网点 <strong>{fmt(gridExport, 1)} kW</strong> 上网
              </span>
            </div>

            <div className="ops-stage-scene">
                            <OpsScene3D
                kind="pv"
                ariaLabel="厂区屋面光伏与并网路径数字孪生场景"
                data={{
                  power,
                  gridExport,
                  inverters: inverters.map(({ id, level, power: invPower }) => ({ id, level, power: invPower })),
                }}
                tags={[
                  {
                    key: "roof",
                    label: "主厂房 · 屋面光伏",
                    value: `68 kWp · ${fmt(power, 1)} kW`,
                    anchor: [-195, 70, 55],
                    offset: [-150, -66],
                  },
                  {
                    key: "aux",
                    label: "辅房 · 配电控制",
                    value: "并网监控 · 正常",
                    anchor: [195, 46, 88],
                    offset: [58, -54],
                    tone: "ok",
                  },
                  {
                    key: "combiner",
                    label: "汇流箱",
                    value: "18 进 1 · 在线",
                    anchor: [-373, 38, 153],
                    offset: [-76, -46],
                  },
                  {
                    key: "inverter",
                    label: "逆变器站 INV-01~03",
                    value: `3/3 在线 · ${fmt(power, 1)} kW`,
                    anchor: [-185, 60, 180],
                    offset: [-24, -66],
                    tone: pvTone,
                  },
                  {
                    key: "substation",
                    label: "10kV 配电房",
                    value: "保护正常 · 并网中",
                    anchor: [-25, 52, 166],
                    offset: [-46, 46],
                    tone: "ok",
                  },
                  {
                    key: "grid",
                    label: "电网并网点",
                    value: `${fmt(gridExport, 1)} kW 上网`,
                    anchor: [377, 46, 169],
                    offset: [54, -48],
                  },
                  {
                    key: "crane",
                    label: "门式起重机",
                    value: "检修位 · 待机",
                    anchor: [180, 94, 180],
                    offset: [82, 20],
                  },
                ]}
              />
            </div>

            <div className="ops-stage-overlay ops-stage-overlay-bottom">
              <div className="ops-stage-kpi">
                <div><em>今日发电</em><strong>{fmt(todayKwh, 0)}<i>kWh</i></strong></div>
                <div><em>自发自用</em><strong>{fmt(selfUse, 0)}<i>%</i></strong></div>
                <div><em>余电上网</em><strong className="amber">{fmt(gridExport, 1)}<i>kW</i></strong></div>
                <div><em>自主巡检</em><strong>3<i>/3 在线</i></strong></div>
              </div>
              <span className="ops-stage-caption">
                屋面 <b>68 kWp</b> · 组串 18 · 逆变器 3/3 在线
              </span>
            </div>
          </div>
        </div>

        {/* 右栏：功率曲线 + 收益碳减排 + 动态检测 */}
        <div className="ops-col ops-col-right">
          <Panel title="功率 × 辐照度" icon="monitoring" live extra={<span>近 60 秒</span>}>
            <LiveLineChart
              height={150}
              series={[
                { data: live, color: "#fbbf24", unit: "kW", name: "发电功率" },
                { data: irrLive, color: "#fb923c", unit: "W/m²", name: "辐照度", dashed: true },
              ]}
            />
          </Panel>

          <Panel title="收益与碳减排" icon="eco" extra={<span>电价 0.62 元/kWh</span>}>
            <div className="ops-income-row">
              <div><em>今日收益</em><strong>{fmt(todayIncome, 1)}<i>元</i></strong></div>
              <div><em>累计收益</em><strong>{fmt(totalIncome, 2)}<i>万元</i></strong></div>
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
          </Panel>

          <Panel
            title="动态检测与处置"
            icon="troubleshoot"
            extra={<span>{pvAlerts.length === 0 ? "全部正常" : `${pvAlerts.length} 条待处理`}</span>}
          >
            <DetectStrip alerts={pvAlerts} emptyText="PR、组件温度与逆变器均在阈值内，继续保持巡检节拍" />
          </Panel>
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

  // 水处理站池体：调节池/中水池/清水池取实时液位，生化池按进水流量折算
  const hydraulicLevel = Math.round(clamp((rawIntake / 60) * 80, 40, 92));
  const basins = [
    { key: "raw", name: "调节池", note: "原水调蓄", x: 60, y: 196, w: 164, h: 118, level: tanks[0].level },
    { key: "ana", name: "厌氧池", note: "水解酸化", x: 260, y: 196, w: 140, h: 118, level: hydraulicLevel },
    { key: "aer", name: "好氧池", note: "曝气生化", x: 436, y: 196, w: 164, h: 118, level: hydraulicLevel },
    { key: "mid", name: "中水池", note: "回用调蓄", x: 60, y: 386, w: 140, h: 118, level: tanks[1].level },
    { key: "clr", name: "清水池", note: "消毒出水", x: 430, y: 386, w: 170, h: 118, level: tanks[2].level },
  ];
  return (
    <div className="ops-screen ops-screen-page">
      <div className="ops-columns">
        {/* 左栏：处理水量环表 + 水质指标 */}
        <div className="ops-col ops-col-left">
          <Panel title="处理水量" icon="water_drop" live extra={<span>处理规模 1000 m³/d</span>}>
            <div className="ops-gauge-grid">
              <GaugeRing value={supply} max={30} label="净水供水量" unit="m³/h" color="#38bdf8" size={118} />
              <GaugeRing value={rawIntake} max={60} label="原水取水量" unit="m³/h" color="#818cf8" size={118} />
              <GaugeRing value={reuseDaily} max={90} label="中水回用量" unit="m³/d" color="#34d399" size={118} />
              <GaugeRing value={reuseRate} max={50} label="中水回用率" unit="%" color="#7dd3fc" size={118} />
            </div>
            <div className="ops-gauge-strip">
              <span className="material-symbols-outlined">science</span>
              <em>出水浊度</em>
              <strong>{fmt(turbidity, 2)}<i>NTU</i></strong>
            </div>
          </Panel>

          <Panel
            title="水质指标"
            icon="science"
            extra={
              <span className="ops-quality-badge">
                <span className="material-symbols-outlined">verified</span>达标率 {compliance}%
              </span>
            }
          >
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
                  <span style={{ width: `${clamp((turbidity / 5) * 100, 0, 100)}%`, background: `linear-gradient(90deg, ${turbidityLevel === "ok" ? "#fbbf24" : LEVEL_COLOR[turbidityLevel]}, ${turbidityLevel === "ok" ? "#fbbf2488" : LEVEL_COLOR[turbidityLevel] + "88"})` }} />
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
          </Panel>
        </div>

        {/* 中央：厂区水处理站工艺场景 */}
        <div className="ops-col ops-col-center">
          <div className="ops-stage">
            <div className="ops-stage-overlay ops-stage-overlay-top">
              <span className="ops-stage-chip">
                <span className="material-symbols-outlined">factory</span>
                厂区水处理站 <strong>1000 m³/d</strong>
              </span>
              <span className="ops-stage-chip">
                <span className="material-symbols-outlined">account_tree</span>
                工艺 <strong>调节 → 厌氧 → 好氧 → MBR</strong>
              </span>
              <span className="ops-stage-chip">
                <span className="material-symbols-outlined">settings</span>
                膜组 <strong>2 用 1 备</strong>
              </span>
              <span className="ops-stage-chip">
                <span className="material-symbols-outlined">verified</span>
                排水许可证有效
              </span>
            </div>

            <div className="ops-stage-scene">
                            <OpsScene3D
                kind="water"
                ariaLabel="厂区水处理站工艺与池体液位数字孪生场景"
                data={{
                  basins: basins.map(({ key, level }) => ({ key, level })),
                  supply,
                  reuseDaily,
                }}
                tags={[
                  {
                    key: "raw",
                    label: "调节池 · 原水调蓄",
                    value: `${tanks[0].level}% · ${fmt(rawIntake, 1)} m³/h`,
                    anchor: [-358, 54, -55],
                    offset: [-115, -52],
                    tone: tanks[0].level < 20 ? "alarm" : tanks[0].level < 30 ? "warn" : "ok",
                  },
                  {
                    key: "ana",
                    label: "厌氧池 · 水解酸化",
                    value: `COD ${fmt(quality[0].value, 2)} mg/L`,
                    anchor: [-170, 54, -55],
                    offset: [-20, -50],
                    tone: quality[0].level,
                  },
                  {
                    key: "aer",
                    label: "好氧池 · 曝气生化",
                    value: `氨氮 ${fmt(quality[2].value, 2)} mg/L`,
                    anchor: [18, 54, -55],
                    offset: [70, -50],
                    tone: quality[2].level,
                  },
                  {
                    key: "dosing",
                    label: "加药间",
                    value: `pH ${fmt(ph, 2)} · 余氯 ${fmt(residualCl, 2)}`,
                    anchor: [290, 48, -85],
                    offset: [40, -50],
                    tone: phLevel,
                  },
                  {
                    key: "mid",
                    label: "中水池 · 回用调蓄",
                    value: `${tanks[1].level}% · ${fmt(reuseDaily, 0)} m³/d`,
                    anchor: [-370, 54, 135],
                    offset: [-105, -50],
                    tone: tanks[1].level < 20 ? "alarm" : tanks[1].level < 30 ? "warn" : "ok",
                  },
                  {
                    key: "pump",
                    label: "泵房 · 净水供水",
                    value: `${fmt(supply, 1)} m³/h`,
                    anchor: [-190, 36, 128],
                    offset: [-20, 44],
                    tone: "ok",
                  },
                  {
                    key: "clr",
                    label: "清水池 · 消毒出水",
                    value: `${tanks[2].level}% · ${fmt(turbidity, 2)} NTU`,
                    anchor: [15, 54, 135],
                    offset: [60, -50],
                    tone: turbidityLevel,
                  },
                  {
                    key: "mbr",
                    label: "MBR 膜车间",
                    value: `2 用 1 备 · ${fmt(supply, 1)} m³/h`,
                    anchor: [300, 50, 116],
                    offset: [90, -44],
                    tone: "ok",
                  },
                ]}
              />
            </div>

            <div className="ops-stage-overlay ops-stage-overlay-bottom">
              <div className="ops-stage-kpi">
                <div><em>原水取水</em><strong>{fmt(rawIntake, 1)}<i>m³/h</i></strong></div>
                <div><em>净水供水</em><strong>{fmt(supply, 1)}<i>m³/h</i></strong></div>
                <div><em>中水回用</em><strong className="amber">{fmt(reuseDaily, 0)}<i>m³/d</i></strong></div>
                <div><em>综合达标率</em><strong>{compliance}<i>%</i></strong></div>
              </div>
              <span className="ops-stage-caption">
                预处理 + 生化 + MBR · 膜组 <b>2 用 1 备</b> · <span className="ok">回用稳定</span>
              </span>
            </div>
          </div>
        </div>

        {/* 右栏：水量趋势 + 水池液位 + 水质状态 */}
        <div className="ops-col ops-col-right">
          <Panel title="处理水量趋势" icon="monitoring" live extra={<span>近 60 秒</span>}>
            <LiveLineChart
              height={206}
              series={[
                { data: flowData, color: "#818cf8", unit: "取水 m³/h", name: "原水取水" },
                { data: supData, color: "#38bdf8", unit: "供水 m³/h", name: "净水供水" },
              ]}
            />
          </Panel>

          <Panel title="调蓄水池液位" icon="water" extra={<span>低液位自动补水</span>}>
            <div className="ops-tanks">
              {tanks.map((tank) => {
                const level = tank.level;
                const lowLevel = level < 30;
                return (
                  <div key={tank.name} className="ops-tank">
                    <div className="ops-tank-body">
                      <div className="ops-tank-water" style={{ height: `${level}%`, background: `linear-gradient(180deg, ${tank.color}cc, ${tank.color}55)` }} />
                      <strong>{level}%</strong>
                    </div>
                    <em>{tank.name}{lowLevel && <span className="ops-tank-warn"> · 低液位</span>}</em>
                    <span>调蓄容积 {tank.volume}</span>
                  </div>
                );
              })}
            </div>
          </Panel>

          <Panel
            title="水质检测状态"
            icon="verified"
            extra={<span>水质限值 GB/T 18920 · 液位低线 30%</span>}
          >
            <div className="ops-status-row">
              <div className="ops-status-tile">
                <em>综合达标率</em>
                <strong style={{ color: compliance < 100 ? "#fbbf24" : "#34d399" }}>{compliance}<span>%</span></strong>
              </div>
              <div className="ops-status-tile">
                <em>出水浊度</em>
                <strong style={{ color: turbidityLevel === "ok" ? "#fbbf24" : LEVEL_COLOR[turbidityLevel] }}>{fmt(turbidity, 2)}<span>NTU</span></strong>
              </div>
              <div className="ops-status-tile">
                <em>出水 pH</em>
                <strong style={{ color: phLevel === "ok" ? "#a78bfa" : LEVEL_COLOR[phLevel] }}>{fmt(ph, 2)}</strong>
              </div>
            </div>
            <DetectStrip alerts={waterAlerts} emptyText="水质六项与三池液位均在阈值内，回用系统稳定" />
          </Panel>
        </div>
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

  // 总平面设备节点：健康度沿用设备清单口径；空压机取综合健康度
  const sceneNodes = [
    { key: "elevator", name: "电梯", kind: "elevator", x: 826, y: 226, health: devices[0].health, level: devices[0].level },
    { key: "ahu", name: "空调机组", kind: "ahu", x: 600, y: 232, health: devices[1].health, level: devices[1].level },
    { key: "chiller", name: "冷冻机组", kind: "chiller", x: 740, y: 288, health: devices[1].health, level: devices[1].level },
    { key: "compressor", name: "空压机", kind: "compressor", x: 188, y: 456, health: composite, level: compositeLevel },
    { key: "switchgear", name: "配电柜", kind: "switchgear", x: 330, y: 456, health: devices[3].health, level: devices[3].level },
    { key: "pump", name: "水泵", kind: "pump", x: 476, y: 456, health: devices[4].health, level: devices[4].level },
    { key: "firepump", name: "消防泵", kind: "firepump", x: 626, y: 456, health: devices[2].health, level: devices[2].level },
  ];
  // 3D 场景锚点与标签偏移，与 ops3d/builders 中的设备位置保持一致
  const nodeAnchors: Record<string, [number, number, number]> = {
    elevator: [326, 142, -84],
    ahu: [100, 58, -78],
    chiller: [240, 56, -22],
    compressor: [-282, 34, 146],
    switchgear: [-150, 44, 146],
    pump: [-24, 25, 146],
    firepump: [146, 25, 146],
  };
  const nodeTagOffsets: Record<string, [number, number]> = {
    elevator: [44, -74],
    ahu: [-20, -52],
    chiller: [34, 46],
    compressor: [-30, 48],
    switchgear: [-20, -54],
    pump: [10, 50],
    firepump: [44, -52],
  };

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

  // 工单看板：与顶部统计口径一致，卡片展示在办明细
  const workOrders: Array<{
    id: string; title: string; system: string; owner: string; time: string;
    status: "todo" | "doing" | "done"; level: DetectLevel;
  }> = [
    { id: "WO-2091", title: "电梯曳引机电流异常复核", system: "电梯系统", owner: "机电一班", time: "09:42", status: "todo", level: "alarm" },
    { id: "WO-2090", title: "中水池低液位补水阀确认", system: "给排水/中水", owner: "给排水班组", time: "08:36", status: "todo", level: "warn" },
    { id: "WO-2089", title: "MBR 膜组在线反洗", system: "给排水/中水", owner: "膜处理组", time: "08:05", status: "doing", level: "warn" },
    { id: "WO-2088", title: "冷冻水压差过滤器清洗", system: "暖通空调", owner: "暖通班组", time: "07:50", status: "doing", level: "warn" },
    { id: "WO-2087", title: "屋面光伏组串 IV 曲线抽检", system: "光伏系统", owner: "光伏运维", time: "07:20", status: "doing", level: "warn" },
    { id: "WO-2084", title: "消防泵组月度巡检", system: "消防设施", owner: "消防维保", time: "昨天 17:05", status: "done", level: "ok" },
    { id: "WO-2081", title: "应急照明放电测试", system: "照明系统", owner: "电气班组", time: "昨天 15:30", status: "done", level: "ok" },
    { id: "WO-2078", title: "电梯门机循环次数校核", system: "电梯系统", owner: "机电一班", time: "昨天 10:12", status: "done", level: "ok" },
  ];

  // 告警时间线：按时间倒序（刚刚 → 1 小时前 → 今天 → 昨天）
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

  const energyTotal = energy.reduce((s, e) => s + e.value, 0);

  return (
    <div className="ops-screen ops-screen-page">
      <div className="ops-columns">
        {/* 左栏：设备状态 */}
        <div className="ops-col ops-col-left">
          <Panel title="设备状态" icon="monitor_heart" live extra={<span>在线率 99.4%</span>}>
            <div className="ops-device-summary">
              <div>
                <em>综合健康度</em>
                <strong style={{ color: LEVEL_COLOR[compositeLevel] }}>{fmt(composite, 1)}<i>分</i></strong>
              </div>
              <div>
                <em>在线设备</em>
                <strong>6<i>/ 6</i></strong>
              </div>
              <div>
                <em>在岗测点</em>
                <strong>486<i>个</i></strong>
              </div>
            </div>
            <div className="ops-device-list">
              {devices.map((d) => (
                <div key={d.name} className="ops-device-row">
                  <span className={`ops-device-dot ${d.level}`} />
                  <div className="ops-device-main">
                    <div className="ops-device-head">
                      <strong>{d.name}</strong>
                      <em style={{ color: LEVEL_COLOR[d.level] }}>{fmt(d.health, 1)}%</em>
                    </div>
                    <div className="ops-device-track">
                      <span style={{ width: `${clamp(d.health, 0, 100)}%`, background: LEVEL_COLOR[d.level] }} />
                    </div>
                    <div className="ops-device-meta">
                      <span>{LEVEL_TEXT[d.level]}运行</span>
                      <span>预测性维护 v2.4</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </Panel>

          <Panel title="今日分项能耗" icon="electric_meter" extra={<span>合计 {fmt(energyTotal, 0)} kWh</span>}>
            <AnimatedBars items={energy} color="#7dd3fc" unit="kWh" />
            <div className="ops-stage-caption" style={{ textAlign: "center", paddingTop: 4 }}>
              同比 -2.4% · 空调采暖占比最高
            </div>
          </Panel>

          <Panel
            title="工单队列"
            icon="assignment"
            extra={<span>待接单 {orders[0].count} · 处理中 {orders[1].count} · 逾期 {orders[3].count}</span>}
          >
            <div className="ops-worklist">
              {workOrders.map((o) => (
                <div key={o.id} className="ops-worklist-row">
                  <span className="ops-worklist-bar" style={{ background: LEVEL_COLOR[o.level] }} />
                  <div className="ops-worklist-main">
                    <div className="ops-worklist-head">
                      <strong>{o.title}</strong>
                      <em>{o.time}</em>
                    </div>
                    <div className="ops-worklist-meta">
                      <span>{o.id} · {o.system} · {o.owner}</span>
                      <b style={{ color: LEVEL_COLOR[o.level] }}>
                        {o.status === "todo" ? "待接单" : o.status === "doing" ? "处理中" : "已闭环"}
                      </b>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="ops-stage-caption ops-worklist-note">
              现场在办 2 单 · 其余归档 31 单 · 按时闭环率 97% · 平均响应 5.2 h
            </div>
          </Panel>

          <Panel title="年度维保计划进度" icon="event_repeat" extra={<span>按系统推进 · 下次节点见右</span>}>
            <div className="ops-timeline">
              {planTimeline.map((p) => (
                <div key={p.system} className="ops-timeline-row">
                  <em>{p.system}</em>
                  <div className="ops-timeline-track">
                    <span style={{
                      width: `${p.progress}%`,
                      background: "linear-gradient(90deg, #2563eb, #4dd4ff)",
                    }} />
                    <strong>{p.progress}%</strong>
                  </div>
                  <span className="ops-timeline-next">下次 {p.next} · {p.team}</span>
                </div>
              ))}
            </div>
          </Panel>
        </div>

        {/* 中央：厂区设备数字孪生总平面 */}
        <div className="ops-col ops-col-center">
          <Panel
            title="厂区设备数字孪生 · 总平面"
            icon="view_in_ar"
            flush
            live
            className="ops-scene-panel"
            bodyClassName="ops-scene-panel-body"
            extra={<span>设备健康度实时回传 · 桥架逻辑拓扑</span>}
          >
            <div className="ops-stage ops-stage-ops">
              <div className="ops-stage-overlay ops-stage-overlay-top">
                <span className="ops-stage-chip">
                  <span className="material-symbols-outlined">precision_manufacturing</span>
                  厂区 A · 设备总平面
                </span>
                <span className="ops-stage-chip">
                  <span className="material-symbols-outlined">lan</span>
                  在岗测点 <strong>486</strong>
                </span>
                <span className="ops-stage-chip">
                  <span className="material-symbols-outlined">memory</span>
                  在线设备 <strong>6/6</strong>
                </span>
                <span className="ops-stage-chip">
                  <span className="material-symbols-outlined">update</span>
                  预测性维护 <strong>v2.4</strong>
                </span>
              </div>

              <div className="ops-stage-scene">
                                <OpsScene3D
                  kind="device"
                  ariaLabel="厂区厂房设备数字孪生总平面"
                  data={{
                    nodes: sceneNodes.map(({ key, name, level, health }) => ({ key, name, level, health })),
                  }}
                  tags={sceneNodes.map((node) => ({
                    key: node.key,
                    label: node.name,
                    value: `${fmt(node.health, 1)} 分 · ${node.level === "alarm" ? "故障" : LEVEL_TEXT[node.level]}`,
                    anchor: nodeAnchors[node.key] ?? [0, 30, 0],
                    offset: nodeTagOffsets[node.key],
                    tone: node.level,
                  }))}
                />
              </div>

              <div className="ops-stage-overlay ops-stage-overlay-bottom">
                <div className="ops-stage-kpi">
                  <div>
                    <em>综合健康度</em>
                    <strong className={compositeLevel === "ok" ? undefined : "amber"}>{fmt(composite, 1)}<i>分</i></strong>
                  </div>
                  <div>
                    <em>在线设备</em>
                    <strong>6<i>/ 6</i></strong>
                  </div>
                  <div>
                    <em>在办工单</em>
                    <strong>{orders[0].count + orders[1].count}<i>单</i></strong>
                  </div>
                  <div>
                    <em>本月完成</em>
                    <strong>{orders[2].count}<i>单</i></strong>
                  </div>
                </div>
                <span className="ops-stage-caption">桥架为逻辑拓扑 · 节点状态取设备实时健康度</span>
              </div>
            </div>
          </Panel>
        </div>

        {/* 右栏：告警时间线 + 室内环境 + 运维成本 */}
        <div className="ops-col ops-col-right">
          <Panel
            title="告警时间线"
            icon="notifications_active"
            extra={<span>待处理 {alerts.filter((a) => a.level !== "ok").length} 条</span>}
          >
            <div className="ops-alert-timeline">
              {alerts.map((a) => (
                <div key={a.text} className="ops-alert-timeline-item">
                  <span className={`ops-alert-dot ${a.level}`} />
                  <div className="ops-alert-timeline-body">
                    <strong>{a.text}</strong>
                    <em>{a.detail}</em>
                  </div>
                  <span className="ops-alert-time">{a.time}</span>
                </div>
              ))}
            </div>
          </Panel>

          <Panel title="室内环境监测" icon="air" live extra={<span>CO₂ × 温度</span>}>
            <LiveLineChart
              height={172}
              series={[
                { data: co2Series, color: "#a78bfa", unit: "ppm", name: "CO₂浓度", max: 900 },
                { data: tempSeries, color: "#fb923c", unit: "℃", name: "室内温度", dashed: true },
              ]}
            />
            <div className="ops-stage-caption" style={{ textAlign: "center", paddingTop: 4 }}>
              新风联动调速 · 目标 24 ± 1 ℃ / CO₂ ≤ 800 ppm
            </div>
          </Panel>

          <Panel title="年度运维成本构成" icon="pie_chart" extra={<span>预算执行 63%</span>}>
            <div className="ops-cost-bars">
              {opex.map((o) => (
                <div key={o.label} className="ops-cost-row">
                  <em>{o.label}</em>
                  <div className="ops-cost-track">
                    <span style={{
                      width: `${o.value * 3}%`,
                      background: `linear-gradient(90deg, ${o.color}, ${o.color}66)`,
                      boxShadow: `0 0 10px ${o.color}55`,
                    }} />
                  </div>
                  <strong style={{ color: o.color }}>{o.value}%</strong>
                </div>
              ))}
            </div>
            <div className="ops-stage-caption" style={{ textAlign: "center", paddingTop: 6 }}>
              累计支出 86.4 万元 · 单位面积年运维成本 28.6 元/m²
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
 * 合并页：光伏发电监测 / 净水与中水回用 / 设施运维管理
 * 大屏视图切换条替代 Tabs，URL 参数 ?view=pv|water|ops 同步。
 * ───────────────────────────────────────────────────────────── */

type OpsViewKey = "pv" | "water" | "ops";

const OPS_VIEWS: Array<{ key: OpsViewKey; label: string; icon: string }> = [
  { key: "pv", label: "厂区能源", icon: "solar_power" },
  { key: "water", label: "厂区水务", icon: "water_drop" },
  { key: "ops", label: "设备运维", icon: "precision_manufacturing" },
];

/** 解析视图：优先 ?view=，兼容旧 ?tab= 链接 */
function readOpsView(view: string | null, tab: string | null): OpsViewKey {
  if (view === "pv" || view === "water" || view === "ops") return view;
  if (tab === "pv" || tab === "water" || tab === "ops") return tab;
  return "pv";
}

export function MergedOpsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const view = readOpsView(searchParams.get("view"), searchParams.get("tab"));

  // 旧链接规范化：/pv-power → ?tab=pv 自动改写为 ?view=pv（replace 不新增历史记录）
  useEffect(() => {
    if (searchParams.get("view") || !searchParams.get("tab")) return;
    const next = new URLSearchParams(searchParams);
    next.delete("tab");
    next.set("view", view);
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams, view]);

  const changeView = (key: OpsViewKey) => {
    if (key === view) return;
    setSearchParams({ view: key });
  };

  return (
    <div className="ops-screen">
      <div className="ops-view-switch" role="tablist" aria-label="运营专题视图">
        {OPS_VIEWS.map((item) => (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={view === item.key}
            className={view === item.key ? "active" : ""}
            onClick={() => changeView(item.key)}
          >
            <span className="material-symbols-outlined">{item.icon}</span>
            {item.label}
          </button>
        ))}
      </div>

      {/* 受控 key 切换：仅重挂载当前视图，不刷新页面 */}
      <div className="ops-view-body" key={view}>
        {view === "pv" && <PvPowerPage />}
        {view === "water" && <WaterReusePage />}
        {view === "ops" && <FacilityOpsPage />}
      </div>
    </div>
  );
}
