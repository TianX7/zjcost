/* eslint-disable react-refresh/only-export-components -- 本文件同时导出运营页共用的检测常量与辅助函数 */
import { useEffect, useId, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { message } from "antd";
import Panel from "../components/Panel";
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

/** 管线/线路慢速流动光点：线性匀速，首尾无缝；减弱动效时不渲染 */
function FlowDots({ path, dur = 12, color = "#7dd3fc", r = 2.6, count = 2, opacity = 0.7 }: {
  path: string; dur?: number; color?: string; r?: number; count?: number; opacity?: number;
}) {
  const reduced = usePrefersReducedMotion();
  if (reduced) return null;
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <circle key={i} r={r} fill={color} opacity={opacity}>
          <animateMotion
            dur={`${dur}s`}
            begin={`${-(i * dur) / count}s`}
            repeatCount="indefinite"
            calcMode="linear"
            path={path}
          />
        </circle>
      ))}
    </>
  );
}

/** 场景读数气泡：挂在小体块上方，展示现有指标 */
function StageBubble({ x, y, w = 156, title, value, color = "#7dd3fc" }: {
  x: number; y: number; w?: number; title: string; value: string; color?: string;
}) {
  return (
    <g>
      <rect x={x} y={y} width={w} height="40" rx="4" fill="rgba(5, 17, 30, 0.88)" stroke={color} strokeOpacity="0.4" strokeWidth="0.7" />
      <text x={x + 8} y={y + 15} fill="#93a9bb" fontSize="13" letterSpacing="0.3">{title}</text>
      <text x={x + 8} y={y + 32} fill={color} fontSize="16" fontWeight="700">{value}</text>
    </g>
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
  const pvWires = [
    "M 300 300 V 340 H 127 V 448",
    "M 127 478 V 492 H 250",
    "M 302 486 H 420",
    "M 470 440 V 430 H 330",
    "M 530 486 H 850",
    "M 904 486 H 962",
  ];

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
              <svg
                className="ops-scene-svg"
                viewBox="0 0 1000 620"
                preserveAspectRatio="xMidYMid meet"
                role="img"
                aria-label="厂区屋面光伏与并网路径数字孪生场景"
              >
                <defs>
                  <linearGradient id="pv-ground" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#0c1824" />
                    <stop offset="100%" stopColor="#070f19" />
                  </linearGradient>
                  <linearGradient id="pv-wall" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#33465a" />
                    <stop offset="100%" stopColor="#22323f" />
                  </linearGradient>
                  <linearGradient id="pv-roof" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stopColor="#223142" />
                    <stop offset="100%" stopColor="#131e2a" />
                  </linearGradient>
                  <linearGradient id="pv-panel" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stopColor="#24506f" />
                    <stop offset="100%" stopColor="#12293d" />
                  </linearGradient>
                  <linearGradient id="pv-cabinet" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#233243" />
                    <stop offset="100%" stopColor="#141f2b" />
                  </linearGradient>
                </defs>

                {/* 厂区地坪与坐标网格 */}
                <rect x="0" y="56" width="1000" height="564" fill="url(#pv-ground)" />
                <g stroke="#5c6b7a" strokeOpacity="0.13" strokeWidth="0.7">
                  {Array.from({ length: 15 }).map((_, i) => (
                    <line key={`gx-${i}`} x1={i * 70} y1="56" x2={i * 70} y2="620" />
                  ))}
                  {Array.from({ length: 8 }).map((_, i) => (
                    <line key={`gy-${i}`} x1="0" y1={80 + i * 70} x2="1000" y2={80 + i * 70} />
                  ))}
                </g>

                {/* 绿化带与厂区道路 */}
                <rect x="24" y="520" width="952" height="16" fill="#22352f" stroke="#4c6b5e" strokeOpacity="0.4" strokeWidth="0.7" />
                {Array.from({ length: 20 }).map((_, i) => (
                  <rect key={`hedge-${i}`} x={40 + i * 47} y="524" width="30" height="8" fill="#2c4a3e" />
                ))}
                <rect x="24" y="544" width="952" height="48" fill="#0e1924" stroke="#5c6b7a" strokeWidth="0.7" />
                <line x1="34" y1="568" x2="966" y2="568" stroke="#8d99a6" strokeOpacity="0.3" strokeDasharray="18 16" strokeWidth="0.9" />

                {/* 设备基础平台 */}
                <rect x="48" y="436" width="904" height="82" fill="#152230" stroke="#5c6b7a" strokeWidth="0.7" />

                {/* 主厂房：锯齿采光屋顶 + 满铺屋面光伏 */}
                <polygon points="70,300 540,300 640,236 170,236" fill="url(#pv-roof)" stroke="#8d99a6" strokeWidth="1.4" strokeLinejoin="round" />
                <rect x="70" y="300" width="470" height="130" fill="url(#pv-wall)" stroke="#8d99a6" strokeWidth="1.4" />
                {[0, 1, 2, 3].map((i) => {
                  const x = 210 + i * 105;
                  return (
                    <g key={`tooth-${i}`}>
                      <polygon points={`${x},236 ${x + 58},236 ${x + 58},218 ${x + 30},218`} fill="#1b2b3a" stroke="#8d99a6" strokeWidth="1" />
                      <polygon points={`${x + 34},236 ${x + 54},236 ${x + 54},220 ${x + 34},220`} fill="#6fa8c8" fillOpacity="0.24" stroke="#6fa8c8" strokeWidth="0.7" />
                    </g>
                  );
                })}
                {Array.from({ length: 4 }).map((_, r) => (
                  <g key={`pv-row-${r}`}>
                    {Array.from({ length: 9 }).map((_, c) => {
                      const x = 96 + r * 25 + c * 47;
                      const y = 294 - r * 16;
                      return (
                        <polygon
                          key={`pv-cell-${r}-${c}`}
                          points={`${x},${y} ${x + 41},${y} ${x + 48},${y - 11} ${x + 7},${y - 11}`}
                          fill="url(#pv-panel)"
                          stroke="#6fa8c8"
                          strokeOpacity="0.5"
                          strokeWidth="0.7"
                        />
                      );
                    })}
                  </g>
                ))}
                {Array.from({ length: 6 }).map((_, i) => (
                  <rect key={`win-${i}`} x={94 + i * 72} y="330" width="50" height="14" fill="#6fa8c8" fillOpacity="0.16" stroke="#6fa8c8" strokeOpacity="0.4" strokeWidth="0.7" />
                ))}
                {[70, 164, 258, 352, 446, 540].map((x) => (
                  <line key={`col-${x}`} x1={x} y1="300" x2={x} y2="430" stroke="#5c6b7a" strokeWidth="0.7" />
                ))}
                <rect x="120" y="384" width="72" height="46" fill="#1b2937" stroke="#8d99a6" strokeWidth="0.7" />
                {Array.from({ length: 5 }).map((_, i) => (
                  <line key={`door-${i}`} x1="126" y1={390 + i * 9} x2="186" y2={390 + i * 9} stroke="#5c6b7a" strokeWidth="0.7" />
                ))}
                <text x="232" y="410" fill="#c7d6e2" fontSize="17" letterSpacing="1">厂区负荷 · 生产车间</text>
                <text x="70" y="206" fill="#d6e4ef" fontSize="19" fontWeight="700">主厂房 · 屋面光伏</text>
                <text x="70" y="222" fill="#8fa7ba" fontSize="16">锯齿采光带 · 组串 18 · 装机 68 kWp</text>

                {/* 排风塔（先画，底部由辅房屋面遮挡） */}
                <rect x="826" y="206" width="26" height="160" fill="#1b2937" stroke="#8d99a6" strokeWidth="1.4" />
                <rect x="820" y="198" width="38" height="10" fill="#5c6b7a" />
                {[230, 256, 282, 308, 334].map((y) => (
                  <line key={`stack-${y}`} x1="826" y1={y} x2="852" y2={y} stroke="#5c6b7a" strokeWidth="0.7" />
                ))}
                <line x1="839" y1="198" x2="839" y2="178" stroke="#8d99a6" strokeWidth="0.7" />
                <text x="839" y="170" textAnchor="middle" fill="#9fb0bf" fontSize="16">排风塔</text>

                {/* 辅房 */}
                <polygon points="590,360 800,360 850,322 640,322" fill="url(#pv-roof)" stroke="#8d99a6" strokeWidth="1.4" strokeLinejoin="round" />
                <rect x="590" y="360" width="210" height="76" fill="url(#pv-wall)" stroke="#8d99a6" strokeWidth="1.4" />
                {Array.from({ length: 3 }).map((_, i) => (
                  <polygon
                    key={`aux-pv-${i}`}
                    points={`${664 + i * 46},350 ${695 + i * 46},350 ${706 + i * 46},340 ${675 + i * 46},340`}
                    fill="url(#pv-panel)"
                    stroke="#6fa8c8"
                    strokeOpacity="0.45"
                    strokeWidth="0.7"
                  />
                ))}
                {Array.from({ length: 3 }).map((_, i) => (
                  <rect key={`aux-win-${i}`} x={608 + i * 64} y="378" width="44" height="12" fill="#6fa8c8" fillOpacity="0.16" stroke="#6fa8c8" strokeOpacity="0.35" strokeWidth="0.7" />
                ))}
                <rect x="726" y="402" width="38" height="34" fill="#1b2937" stroke="#8d99a6" strokeWidth="0.7" />
                <text x="600" y="314" fill="#a9bccb" fontSize="16">辅房 · 配电 / 控制</text>

                {/* 汇流箱 */}
                <rect x="104" y="448" width="46" height="30" rx="1.5" fill="url(#pv-cabinet)" stroke="#8d99a6" strokeWidth="1" />
                {Array.from({ length: 4 }).map((_, i) => (
                  <line key={`comb-louver-${i}`} x1="110" y1={455 + i * 5} x2="128" y2={455 + i * 5} stroke="#5c6b7a" strokeWidth="0.7" />
                ))}
                <circle cx="143" cy="454" r="2" fill="#4dd4ff" />
                <text x="127" y="494" textAnchor="middle" fill="#9fb0bf" fontSize="16">汇流箱</text>

                {/* 逆变器站：双柜 + 散热百叶 */}
                {[0, 1].map((i) => (
                  <g key={`inv-${i}`}>
                    <rect x={250 + i * 58} y="442" width="52" height="72" fill="url(#pv-cabinet)" stroke="#8d99a6" strokeWidth="1" />
                    {Array.from({ length: 7 }).map((_, k) => (
                      <line key={`inv-louver-${k}`} x1={256 + i * 58} y1={458 + k * 6} x2={296 + i * 58} y2={458 + k * 6} stroke="#5c6b7a" strokeWidth="0.7" />
                    ))}
                    <rect x={272 + i * 58} y="448" width="16" height="8" fill="#22303d" stroke="#6fa8c8" strokeOpacity="0.4" strokeWidth="0.7" />
                  </g>
                ))}
                <circle cx="258" cy="450" r="2" fill={inverters[0].level === "ok" ? "#4dd4ff" : LEVEL_COLOR[inverters[0].level]} />
                <circle cx="316" cy="450" r="2" fill={inverters[1].level === "ok" ? "#4dd4ff" : LEVEL_COLOR[inverters[1].level]} />
                <text x="308" y="432" textAnchor="middle" fill="#c7d6e2" fontSize="16.5">逆变器站 · INV-01~03</text>

                {/* 10kV 配电房 */}
                <rect x="420" y="440" width="110" height="72" fill="#1b2937" stroke="#8d99a6" strokeWidth="1.4" />
                <rect x="420" y="440" width="110" height="10" fill="#5c6b7a" stroke="#8d99a6" strokeWidth="0.7" />
                <rect x="470" y="456" width="52" height="52" fill="#233240" stroke="#5c6b7a" strokeWidth="0.7" />
                {Array.from({ length: 6 }).map((_, i) => (
                  <line key={`pd-louver-${i}`} x1="476" y1={462 + i * 7} x2="516" y2={462 + i * 7} stroke="#5c6b7a" strokeWidth="0.7" />
                ))}
                <rect x="428" y="462" width="30" height="46" fill="#22303d" stroke="#5c6b7a" strokeWidth="0.7" />
                <text x="475" y="432" textAnchor="middle" fill="#c7d6e2" fontSize="16.5">10kV 配电房</text>

                {/* 电网并网点柜 */}
                <rect x="850" y="446" width="54" height="66" fill="url(#pv-cabinet)" stroke="#8d99a6" strokeWidth="1" />
                <circle cx="877" cy="470" r="11" fill="none" stroke="#6fa8c8" strokeWidth="0.7" />
                <line x1="877" y1="470" x2="883" y2="463" stroke="#7dd3fc" strokeWidth="0.7" />
                <line x1="858" y1="492" x2="896" y2="492" stroke="#5c6b7a" strokeWidth="0.7" />
                <text x="877" y="438" textAnchor="middle" fill="#c7d6e2" fontSize="16.5">电网并网点</text>

                {/* 门式起重机 */}
                <g stroke="#8d99a6" strokeWidth="1" fill="none">
                  <line x1="600" y1="588" x2="600" y2="506" />
                  <line x1="760" y1="588" x2="760" y2="506" />
                  <rect x="596" y="500" width="168" height="8" fill="#5c6b7a" stroke="#8d99a6" strokeWidth="0.7" />
                  <line x1="600" y1="588" x2="640" y2="508" />
                  <line x1="760" y1="588" x2="720" y2="508" />
                  <rect x="676" y="508" width="12" height="10" fill="#22303d" stroke="#8d99a6" strokeWidth="0.7" />
                  <line x1="682" y1="518" x2="682" y2="542" />
                  <path d="M 675 542 h 14 v 7 h -14 z" fill="#5c6b7a" stroke="#8d99a6" strokeWidth="0.7" />
                </g>
                <text x="682" y="492" textAnchor="middle" fill="#8fa7ba" fontSize="15">门式起重机</text>

                {/* 电力路径：正交折线 + 慢速流动光点 */}
                {pvWires.map((d, i) => (
                  <path key={`wire-${i}`} d={d} fill="none" stroke="#5c6b7a" strokeWidth="1.1" strokeLinejoin="round" strokeLinecap="round" />
                ))}
                {pvWires.map((d, i) => (
                  <path key={`live-${i}`} d={d} fill="none" stroke="#4dd4ff" strokeWidth="0.7" strokeOpacity="0.6" strokeLinejoin="round" strokeLinecap="round" />
                ))}
                <FlowDots path={pvWires[0]} dur={13} count={2} />
                <FlowDots path={pvWires[1]} dur={11} count={1} />
                <FlowDots path={pvWires[2]} dur={12} count={1} />
                <FlowDots path={pvWires[3]} dur={10} count={1} color="#fbbf24" opacity={0.75} />
                <FlowDots path={pvWires[4]} dur={14} count={2} />
                <FlowDots path={pvWires[5]} dur={10} count={1} color="#fbbf24" opacity={0.75} />
                <polygon points="962,486 950,480 950,492" fill="#7dd3fc" fillOpacity="0.8" />
                <text x="962" y="474" textAnchor="end" fill="#8fa7ba" fontSize="15">公共电网</text>
              </svg>
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
  const waterWires = [
    "M 224 252 H 260",
    "M 400 252 H 436",
    "M 600 252 H 632 V 400 H 660",
    "M 660 432 H 600",
    "M 430 432 H 380",
    "M 240 432 H 200",
    "M 130 504 V 542 H 930",
  ];
  const waterValves = [
    { x: 248, y: 252 },
    { x: 424, y: 252 },
    { x: 410, y: 432 },
    { x: 224, y: 432 },
    { x: 700, y: 542 },
  ];
  const dailyUse = [
    { label: "绿化浇灌", value: 22 },
    { label: "冲厕", value: 18 },
    { label: "道路浇洒", value: 10 },
    { label: "景观补水", value: 8 },
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
              <svg
                className="ops-scene-svg"
                viewBox="0 0 1000 620"
                preserveAspectRatio="xMidYMid meet"
                role="img"
                aria-label="厂区水处理站工艺与池体液位数字孪生场景"
              >
                <defs>
                  <linearGradient id="wt-ground" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#0b1823" />
                    <stop offset="100%" stopColor="#06101a" />
                  </linearGradient>
                  <linearGradient id="wt-water" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#4dd4ff" stopOpacity="0.38" />
                    <stop offset="100%" stopColor="#2a9fc4" stopOpacity="0.12" />
                  </linearGradient>
                  <linearGradient id="wt-wall" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#263442" />
                    <stop offset="100%" stopColor="#17222e" />
                  </linearGradient>
                  <linearGradient id="wt-roof" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stopColor="#223142" />
                    <stop offset="100%" stopColor="#131e2a" />
                  </linearGradient>
                </defs>

                {/* 站区地坪 */}
                <rect x="0" y="60" width="1000" height="560" fill="url(#wt-ground)" />
                <g stroke="#5c6b7a" strokeOpacity="0.12" strokeWidth="0.7">
                  {Array.from({ length: 15 }).map((_, i) => (
                    <line key={`wgx-${i}`} x1={i * 70} y1="60" x2={i * 70} y2="620" />
                  ))}
                  {Array.from({ length: 8 }).map((_, i) => (
                    <line key={`wgy-${i}`} x1="0" y1={80 + i * 70} x2="1000" y2={80 + i * 70} />
                  ))}
                </g>
                <text x="60" y="92" fill="#d6e4ef" fontSize="19" fontWeight="700">厂区水处理站 · 预处理 + 生化 + MBR + 消毒</text>
                <text x="60" y="108" fill="#8fa7ba" fontSize="16">构筑物剖面 · 管廊低位敷设 · 中水回用至厂区</text>

                {/* 池体：混凝土池壁 + 半透明水位 + 液面波纹 */}
                {basins.map((b) => {
                  const innerW = b.w - 14;
                  const innerH = b.h - 14;
                  const fillH = Math.max(6, (innerH * b.level) / 100);
                  const surfaceY = b.y + b.h - 7 - fillH;
                  const low = b.level < 30;
                  return (
                    <g key={b.key}>
                      <rect x={b.x} y={b.y} width={b.w} height={b.h} fill="#16232f" stroke="#8d99a6" strokeWidth="1.4" />
                      <rect x={b.x + 7} y={b.y + 7} width={innerW} height={innerH} fill="#08141f" stroke="#5c6b7a" strokeWidth="0.7" />
                      <rect x={b.x + 7} y={surfaceY} width={innerW} height={fillH} fill="url(#wt-water)" />
                      <line x1={b.x + 7} y1={surfaceY} x2={b.x + b.w - 7} y2={surfaceY} stroke="#7dd3fc" strokeOpacity="0.45" strokeWidth="0.7" />
                      <path d={`M ${b.x + 14} ${surfaceY + 6} q 18 -3 36 0 t 36 0 t 36 0`} fill="none" stroke="#9fdcf2" strokeOpacity="0.3" strokeWidth="0.7" />
                      <path d={`M ${b.x + 20} ${surfaceY + 12} q 18 3 36 0 t 36 0`} fill="none" stroke="#9fdcf2" strokeOpacity="0.2" strokeWidth="0.7" />
                      <line
                        x1={b.x + 7} y1={b.y + b.h - 7 - innerH * 0.3}
                        x2={b.x + b.w - 7} y2={b.y + b.h - 7 - innerH * 0.3}
                        stroke="#fbbf24" strokeOpacity="0.28" strokeWidth="0.7" strokeDasharray="4 4"
                      />
                      <text x={b.x + 12} y={b.y + 20} fill="#c7d6e2" fontSize="16.5" fontWeight="700">{b.name}</text>
                      <text x={b.x + 12} y={b.y + 33} fill="#8fa7ba" fontSize="14.5">{b.note} · 液位 {b.level}%</text>
                      {low && <text x={b.x + b.w - 10} y={b.y + 20} textAnchor="end" fill="#fbbf24" fontSize="14.5">低液位</text>}
                    </g>
                  );
                })}

                {/* 加药间 */}
                <polygon points="680,156 900,156 920,132 700,132" fill="url(#wt-roof)" stroke="#8d99a6" strokeWidth="1.4" strokeLinejoin="round" />
                <rect x="680" y="156" width="220" height="138" fill="url(#wt-wall)" stroke="#8d99a6" strokeWidth="1.4" />
                <rect x="690" y="182" width="200" height="102" fill="#101b27" stroke="#5c6b7a" strokeWidth="0.7" />
                <text x="696" y="174" fill="#c7d6e2" fontSize="16.5">加药间</text>
                {[0, 1].map((i) => (
                  <g key={`dose-${i}`}>
                    <circle cx={728 + i * 56} cy="234" r="18" fill="#1a2c3a" stroke="#8d99a6" strokeWidth="1" />
                    <path d={`M ${710 + i * 56} 240 h 36`} stroke="#fbbf24" strokeOpacity="0.5" strokeWidth="0.7" />
                    <text x={728 + i * 56} y="272" textAnchor="middle" fill="#8fa7ba" fontSize="14">{i === 0 ? "PAC" : "次氯"}</text>
                  </g>
                ))}
                <rect x="820" y="220" width="34" height="22" fill="#1a2c3a" stroke="#8d99a6" strokeWidth="0.7" />
                <line x1="798" y1="252" x2="820" y2="252" stroke="#5c6b7a" strokeWidth="0.7" />
                <text x="837" y="258" textAnchor="middle" fill="#8fa7ba" fontSize="14">计量泵</text>

                {/* 泵房 */}
                <polygon points="240,372 380,372 400,348 260,348" fill="url(#wt-roof)" stroke="#8d99a6" strokeWidth="1.4" strokeLinejoin="round" />
                <rect x="240" y="372" width="140" height="132" fill="url(#wt-wall)" stroke="#8d99a6" strokeWidth="1.4" />
                <text x="250" y="390" fill="#c7d6e2" fontSize="16.5">泵房</text>
                <rect x="256" y="404" width="46" height="86" fill="#101b27" stroke="#5c6b7a" strokeWidth="0.7" />
                {Array.from({ length: 6 }).map((_, i) => (
                  <line key={`pump-door-${i}`} x1="262" y1={410 + i * 13} x2="296" y2={410 + i * 13} stroke="#5c6b7a" strokeWidth="0.7" />
                ))}
                {[0, 1].map((i) => (
                  <g key={`pump-${i}`}>
                    <circle cx={324 + i * 34} cy="438" r="12" fill="none" stroke="#8d99a6" strokeWidth="1" />
                    <line x1={324 + i * 34} y1="426" x2={324 + i * 34} y2="450" stroke="#6fa8c8" strokeWidth="0.7" />
                    <line x1={312 + i * 34} y1="438" x2={336 + i * 34} y2="438" stroke="#6fa8c8" strokeWidth="0.7" />
                    <rect x={314 + i * 34} y="464" width="22" height="16" fill="#1a2c3a" stroke="#5c6b7a" strokeWidth="0.7" />
                  </g>
                ))}

                {/* MBR 膜车间（剖面） */}
                <polygon points="660,348 940,348 912,318 688,318" fill="url(#wt-roof)" stroke="#8d99a6" strokeWidth="1.4" strokeLinejoin="round" />
                <rect x="660" y="348" width="280" height="156" fill="url(#wt-wall)" stroke="#8d99a6" strokeWidth="1.4" />
                <line x1="660" y1="332" x2="940" y2="332" stroke="#6fa8c8" strokeOpacity="0.35" strokeWidth="0.7" />
                {Array.from({ length: 5 }).map((_, i) => (
                  <line key={`truss-${i}`} x1={690 + i * 52} y1="318" x2={690 + i * 52} y2="348" stroke="#5c6b7a" strokeWidth="0.7" />
                ))}
                <text x="674" y="366" fill="#c7d6e2" fontSize="16.5" fontWeight="700">MBR 膜车间（剖面）</text>
                {[0, 1, 2].map((i) => (
                  <g key={`rack-${i}`}>
                    <rect x={678 + i * 84} y="380" width="70" height="84" fill="#101b27" stroke="#8d99a6" strokeWidth="1" />
                    {Array.from({ length: 7 }).map((_, k) => (
                      <line key={`membrane-${k}`} x1={683 + i * 84 + k * 10} y1="386" x2={683 + i * 84 + k * 10} y2="458" stroke="#6fa8c8" strokeOpacity="0.4" strokeWidth="0.7" />
                    ))}
                    <line x1={678 + i * 84} y1="466" x2={748 + i * 84} y2="466" stroke="#4dd4ff" strokeOpacity="0.4" strokeWidth="0.7" />
                    <text x={713 + i * 84} y="478" textAnchor="middle" fill="#8fa7ba" fontSize="14">膜组 {i + 1}</text>
                  </g>
                ))}
                <line x1="666" y1="486" x2="934" y2="486" stroke="#5c6b7a" strokeWidth="0.7" />
                <text x="930" y="500" textAnchor="end" fill="#8fa7ba" fontSize="14">曝气总管</text>

                {/* 工艺管道：双线 + 阀门 + 流向箭头 */}
                {waterWires.map((d, i) => (
                  <path key={`wp-${i}`} d={d} fill="none" stroke="#5c6b7a" strokeWidth="1.1" strokeLinejoin="round" strokeLinecap="round" />
                ))}
                {waterWires.map((d, i) => (
                  <path key={`wpc-${i}`} d={d} fill="none" stroke="#0b1824" strokeWidth="0.7" strokeLinejoin="round" strokeLinecap="round" />
                ))}
                {waterWires.map((d, i) => (
                  <path key={`wpl-${i}`} d={d} fill="none" stroke="#4dd4ff" strokeWidth="0.7" strokeOpacity="0.32" strokeLinejoin="round" strokeLinecap="round" />
                ))}
                {waterValves.map((v, i) => (
                  <g key={`valve-${i}`} stroke="#8d99a6" strokeWidth="0.7" fill="none">
                    <polygon points={`${v.x - 7},${v.y - 5} ${v.x - 7},${v.y + 5} ${v.x},${v.y}`} />
                    <polygon points={`${v.x + 7},${v.y - 5} ${v.x + 7},${v.y + 5} ${v.x},${v.y}`} />
                    <line x1={v.x} y1={v.y - 5} x2={v.x} y2={v.y - 11} />
                  </g>
                ))}
                {[
                  { x: 234, y: 252 },
                  { x: 406, y: 252 },
                  { x: 770, y: 542 },
                ].map((p) => (
                  <polygon key={`arrow-${p.x}-${p.y}`} points={`${p.x},${p.y - 4} ${p.x + 8},${p.y} ${p.x},${p.y + 4}`} fill="#7dd3fc" fillOpacity="0.75" />
                ))}
                {[
                  { x: 616, y: 432 },
                  { x: 390, y: 432 },
                  { x: 208, y: 432 },
                ].map((p) => (
                  <polygon key={`arrow-l-${p.x}`} points={`${p.x + 8},${p.y - 4} ${p.x},${p.y} ${p.x + 8},${p.y + 4}`} fill="#7dd3fc" fillOpacity="0.75" />
                ))}

                <FlowDots path={waterWires[0]} dur={11} count={1} />
                <FlowDots path={waterWires[1]} dur={11} count={1} />
                <FlowDots path={waterWires[2]} dur={13} count={2} />
                <FlowDots path={waterWires[3]} dur={12} count={1} />
                <FlowDots path={waterWires[4]} dur={11} count={1} />
                <FlowDots path={waterWires[5]} dur={11} count={1} />
                <FlowDots path={waterWires[6]} dur={14} count={3} color="#34d399" opacity={0.7} />

                {/* 加药支管（静态细线） */}
                <path d="M 690 200 H 660 V 136 H 330 V 196" fill="none" stroke="#fbbf24" strokeOpacity="0.35" strokeWidth="0.7" />
                <path d="M 520 136 V 196" fill="none" stroke="#fbbf24" strokeOpacity="0.3" strokeWidth="0.7" />

                {/* 回用出口 */}
                <polygon points="930,542 924,530 936,530" fill="#34d399" fillOpacity="0.85" />
                <text x="928" y="564" textAnchor="end" fill="#34d399" fontSize="15">回用至厂区 · {fmt(reuseDaily, 0)} m³/d</text>
                <text x="60" y="564" fill="#8fa7ba" fontSize="15">中水回用分配</text>
                <text x="60" y="580" fill="#7dd3fc" fontSize="15">
                  {dailyUse.map((d) => `${d.label} ${d.value}`).join(" · ")} m³/d
                </text>

                {/* 读数气泡 */}
                <StageBubble x={66} y={148} w={166} title="调节池液位" value={`${tanks[0].level}% · ${fmt(rawIntake, 1)} m³/h`} />
                <StageBubble x={252} y={148} w={140} title="厌氧池 COD" value={`${fmt(quality[0].value, 1)} mg/L`} color={quality[0].level === "ok" ? "#7dd3fc" : LEVEL_COLOR[quality[0].level]} />
                <StageBubble x={430} y={148} w={150} title="好氧池 氨氮" value={`${fmt(quality[2].value, 2)} mg/L`} color={quality[2].level === "ok" ? "#7dd3fc" : LEVEL_COLOR[quality[2].level]} />
                <StageBubble x={700} y={92} w={170} title="加药间 pH · 余氯" value={`${fmt(ph, 2)} · ${fmt(residualCl, 2)} mg/L`} color={phLevel === "ok" ? "#7dd3fc" : LEVEL_COLOR[phLevel]} />
                <StageBubble x={56} y={330} w={140} title="中水池液位" value={`${tanks[1].level}% · ${fmt(reuseDaily, 0)} m³/d`} color={tanks[1].level < 30 ? "#fbbf24" : "#7dd3fc"} />
                <StageBubble x={238} y={300} w={150} title="泵房 供水流量" value={`${fmt(supply, 1)} m³/h`} />
                <StageBubble x={430} y={330} w={180} title="清水池 浊度" value={`${tanks[2].level}% · ${fmt(turbidity, 2)} NTU`} color={turbidityLevel === "ok" ? "#7dd3fc" : LEVEL_COLOR[turbidityLevel]} />
                <StageBubble x={690} y={282} w={210} title="MBR 产水" value={`${fmt(supply, 1)} m³/h · ${fmt(turbidity, 2)} NTU`} />

                {/* 气泡引线 */}
                <g stroke="#5c6b7a" strokeWidth="0.7" strokeDasharray="2 3" opacity="0.8">
                  <line x1="146" y1="188" x2="120" y2="198" />
                  <line x1="322" y1="188" x2="330" y2="198" />
                  <line x1="505" y1="188" x2="505" y2="198" />
                  <line x1="785" y1="132" x2="772" y2="156" />
                  <line x1="126" y1="370" x2="120" y2="386" />
                  <line x1="313" y1="340" x2="310" y2="374" />
                  <line x1="520" y1="370" x2="512" y2="386" />
                  <line x1="795" y1="322" x2="800" y2="348" />
                </g>
              </svg>
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

/** 工业设备符号：统一以 (x, y) 为中心，线宽 1，辅助线 0.7 */
function DeviceGlyph({ kind, x, y, color }: { kind: string; x: number; y: number; color: string }) {
  switch (kind) {
    case "elevator":
      return (
        <g>
          <rect x={x - 14} y={y - 26} width="28" height="52" fill="#16222e" stroke={color} strokeWidth="1" />
          <rect x={x - 9} y={y - 18} width="18" height="18" fill="rgba(111,168,200,0.14)" stroke="#5c6b7a" strokeWidth="0.7" />
          <path d={`M ${x - 5} ${y + 8} l 5 -5 l 5 5`} fill="none" stroke="#8d99a6" strokeWidth="0.7" />
          <path d={`M ${x - 5} ${y + 16} l 5 5 l 5 -5`} fill="none" stroke="#8d99a6" strokeWidth="0.7" />
          <line x1={x} y1={y - 26} x2={x} y2={y - 32} stroke="#5c6b7a" strokeWidth="0.7" />
        </g>
      );
    case "ahu":
      return (
        <g>
          <rect x={x - 34} y={y - 18} width="68" height="36" fill="#16222e" stroke={color} strokeWidth="1" />
          <circle cx={x - 14} cy={y} r="9" fill="none" stroke="#5c6b7a" strokeWidth="0.7" />
          <line x1={x - 23} y1={y} x2={x - 5} y2={y} stroke="#5c6b7a" strokeWidth="0.7" />
          <line x1={x - 14} y1={y - 9} x2={x - 14} y2={y + 9} stroke="#5c6b7a" strokeWidth="0.7" />
          <path d={`M ${x + 4} ${y - 10} h 26 M ${x + 4} ${y + 10} h 26`} stroke="#5c6b7a" strokeWidth="0.7" />
        </g>
      );
    case "chiller":
      return (
        <g>
          <rect x={x - 30} y={y - 18} width="60" height="36" fill="#16222e" stroke={color} strokeWidth="1" />
          <circle cx={x - 14} cy={y} r="9" fill="none" stroke="#5c6b7a" strokeWidth="0.7" />
          <path d={`M ${x - 14} ${y - 6} l 4 6 l -8 0 z`} fill="#5c6b7a" stroke="none" />
          <path d={`M ${x + 4} ${y - 7} h 6 v 6 h 6 v 6 h 6 v 6`} fill="none" stroke="#5c6b7a" strokeWidth="0.7" />
        </g>
      );
    case "compressor":
      return (
        <g>
          <rect x={x - 32} y={y - 12} width="44" height="24" rx="7" fill="#16222e" stroke={color} strokeWidth="1" />
          <rect x={x - 24} y={y - 6} width="28" height="12" fill="rgba(111,168,200,0.12)" stroke="#5c6b7a" strokeWidth="0.7" />
          <circle cx={x + 20} cy={y} r="10" fill="#16222e" stroke={color} strokeWidth="1" />
          <line x1={x + 20} y1={y - 10} x2={x + 20} y2={y + 10} stroke="#5c6b7a" strokeWidth="0.7" />
          <line x1={x + 10} y1={y} x2={x + 30} y2={y} stroke="#5c6b7a" strokeWidth="0.7" />
        </g>
      );
    case "switchgear":
      return (
        <g>
          {[-16, 0, 16].map((dx) => (
            <g key={dx}>
              <rect x={x + dx - 7} y={y - 24} width="14" height="48" fill="#16222e" stroke={color} strokeWidth="1" />
              {[0, 1, 2, 3].map((k) => (
                <line key={k} x1={x + dx - 5} y1={y - 17 + k * 10} x2={x + dx + 5} y2={y - 17 + k * 10} stroke="#5c6b7a" strokeWidth="0.7" />
              ))}
            </g>
          ))}
          <path d={`M ${x - 2} ${y - 4} l -4 8 h 4 l -2 8 l 7 -10 h -4 l 3 -6 z`} fill="#fbbf24" fillOpacity="0.7" stroke="none" />
        </g>
      );
    case "pump":
      return (
        <g>
          <circle cx={x} cy={y} r="14" fill="#16222e" stroke={color} strokeWidth="1" />
          <circle cx={x} cy={y} r="5" fill="none" stroke="#5c6b7a" strokeWidth="0.7" />
          <path d={`M ${x - 6} ${y - 5} l 12 10 M ${x - 6} ${y + 5} l 12 -10`} stroke="#5c6b7a" strokeWidth="0.7" />
          <line x1={x - 28} y1={y} x2={x - 14} y2={y} stroke={color} strokeWidth="0.7" />
          <line x1={x + 14} y1={y} x2={x + 26} y2={y} stroke={color} strokeWidth="0.7" />
        </g>
      );
    case "firepump":
      return (
        <g>
          <circle cx={x} cy={y} r="14" fill="#16222e" stroke={color} strokeWidth="1" />
          <circle cx={x} cy={y} r="5" fill="none" stroke="#5c6b7a" strokeWidth="0.7" />
          <path d={`M ${x - 6} ${y - 5} l 12 10 M ${x - 6} ${y + 5} l 12 -10`} stroke="#5c6b7a" strokeWidth="0.7" />
          <path d={`M ${x} ${y - 22} l -6 9 h 12 z`} fill="none" stroke={color} strokeWidth="0.7" />
          <line x1={x} y1={y - 13} x2={x} y2={y - 14} stroke="#5c6b7a" strokeWidth="0.7" />
          <line x1={x - 28} y1={y} x2={x - 14} y2={y} stroke={color} strokeWidth="0.7" />
          <line x1={x + 14} y1={y} x2={x + 26} y2={y} stroke={color} strokeWidth="0.7" />
        </g>
      );
    default:
      return null;
  }
}

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
                <svg
                  className="ops-scene-svg"
                  viewBox="0 0 1000 620"
                  preserveAspectRatio="xMidYMid meet"
                  role="img"
                  aria-label="厂区厂房设备数字孪生总平面"
                >
                  <defs>
                    <linearGradient id="ops-ground" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#0b1722" />
                      <stop offset="100%" stopColor="#060f18" />
                    </linearGradient>
                    <linearGradient id="ops-floor" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#16273a" />
                      <stop offset="100%" stopColor="#0d1a26" />
                    </linearGradient>
                    <linearGradient id="ops-wall" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#33465a" />
                      <stop offset="100%" stopColor="#22323f" />
                    </linearGradient>
                  </defs>

                  {/* 厂区地坪 */}
                  <rect x="0" y="56" width="1000" height="564" fill="url(#ops-ground)" />
                  <g stroke="#5c6b7a" strokeOpacity="0.12" strokeWidth="0.7">
                    {Array.from({ length: 15 }).map((_, i) => (
                      <line key={`ogx-${i}`} x1={i * 70} y1="56" x2={i * 70} y2="620" />
                    ))}
                    {Array.from({ length: 8 }).map((_, i) => (
                      <line key={`ogy-${i}`} x1="0" y1={80 + i * 70} x2="1000" y2={80 + i * 70} />
                    ))}
                  </g>
                  <text x="96" y="124" fill="#d6e4ef" fontSize="19" fontWeight="700">厂区 A · 设备数字孪生总平面</text>
                  <text x="940" y="124" textAnchor="end" fill="#8fa7ba" fontSize="15">青 正常 · 琥珀 预警 · 红 故障</text>

                  {/* 厂房外壳（剖切俯视） */}
                  <rect x="96" y="140" width="808" height="400" fill="url(#ops-wall)" stroke="#8d99a6" strokeWidth="1.4" />
                  <rect x="106" y="150" width="788" height="380" fill="url(#ops-floor)" stroke="#5c6b7a" strokeWidth="0.7" />
                  <rect x="96" y="140" width="808" height="10" fill="#22303d" />
                  {[196, 296, 396, 496, 596, 696, 796, 896].map((x) => (
                    <line key={`col-${x}`} x1={x} y1="150" x2={x} y2="530" stroke="#5c6b7a" strokeOpacity="0.18" strokeWidth="0.7" />
                  ))}
                  <rect x="470" y="518" width="64" height="12" fill="#6fa8c8" fillOpacity="0.25" stroke="#6fa8c8" strokeOpacity="0.5" strokeWidth="0.7" />

                  {/* 功能分区 */}
                  <rect x="122" y="190" width="350" height="158" fill="#0e1a25" stroke="#5c6b7a" strokeWidth="0.7" />
                  <text x="132" y="206" fill="#9fb0bf" fontSize="15" letterSpacing="0.6">生产区</text>
                  {Array.from({ length: 3 }).map((_, r) =>
                    Array.from({ length: 3 }).map((_, c) => (
                      <g key={`machine-${r}-${c}`}>
                        <rect x={144 + c * 92} y={216 + r * 40} width="64" height="24" fill="#1a2a38" stroke="#6fa8c8" strokeOpacity="0.4" strokeWidth="0.7" />
                        <line x1={150 + c * 92} y1={228 + r * 40} x2={202 + c * 92} y2={228 + r * 40} stroke="#5c6b7a" strokeWidth="0.7" />
                        <circle cx={211 + c * 92} cy={228 + r * 40} r="2" fill="#4dd4ff" fillOpacity="0.5" />
                      </g>
                    )),
                  )}
                  <line x1="140" y1="344" x2="462" y2="344" stroke="#5c6b7a" strokeWidth="0.7" />
                  {Array.from({ length: 12 }).map((_, i) => (
                    <circle key={`roller-${i}`} cx={148 + i * 26} cy="344" r="3" fill="#22303d" stroke="#8d99a6" strokeWidth="0.7" />
                  ))}
                  <text x="462" y="334" textAnchor="end" fill="#8fa7ba" fontSize="14">产线</text>

                  <rect x="500" y="190" width="382" height="158" fill="#0e1a25" stroke="#5c6b7a" strokeWidth="0.7" />
                  <text x="510" y="206" fill="#9fb0bf" fontSize="15" letterSpacing="0.6">设备区</text>

                  {/* 主通道 */}
                  <rect x="122" y="366" width="760" height="36" fill="#16222e" stroke="#5c6b7a" strokeWidth="0.7" />
                  <line x1="140" y1="384" x2="862" y2="384" stroke="#8d99a6" strokeOpacity="0.3" strokeWidth="0.9" strokeDasharray="16 14" />
                  {[250, 500, 750].map((x) => (
                    <polygon key={`aisle-arrow-${x}`} points={`${x},380 ${x + 9},384 ${x},388`} fill="#6fa8c8" fillOpacity="0.6" />
                  ))}
                  <text x="852" y="360" textAnchor="end" fill="#8fa7ba" fontSize="14.5">主通道</text>

                  <rect x="122" y="420" width="760" height="104" fill="#0e1a25" stroke="#5c6b7a" strokeWidth="0.7" />
                  <text x="132" y="436" fill="#9fb0bf" fontSize="15" letterSpacing="0.6">动力辅机区</text>

                  {/* 电缆桥架与支线 */}
                  <g stroke="#5c6b7a" strokeWidth="0.7" fill="none">
                    <line x1="140" y1="408" x2="862" y2="408" />
                    <line x1="140" y1="414" x2="862" y2="414" />
                    {Array.from({ length: 15 }).map((_, i) => (
                      <line key={`tray-${i}`} x1={148 + i * 50} y1="408" x2={148 + i * 50} y2="414" />
                    ))}
                  </g>
                  {[
                    { x: 826, y: 252 },
                    { x: 600, y: 250 },
                    { x: 740, y: 306 },
                    { x: 188, y: 438 },
                    { x: 330, y: 432 },
                    { x: 476, y: 440 },
                    { x: 626, y: 440 },
                  ].map((p) => (
                    <g key={`drop-${p.x}`}>
                      <line x1={p.x} y1={p.y < 366 ? 408 : 414} x2={p.x} y2={p.y} stroke="#5c6b7a" strokeWidth="0.7" />
                      <circle cx={p.x} cy={p.y < 366 ? 408 : 414} r="2" fill="#8d99a6" />
                    </g>
                  ))}

                  {/* 冷冻水与工艺管线 */}
                  <path d="M 710 288 H 680 V 232 H 634" fill="none" stroke="#6fa8c8" strokeOpacity="0.5" strokeWidth="0.7" />
                  <path d="M 506 456 H 526 V 288 H 710" fill="none" stroke="#6fa8c8" strokeOpacity="0.35" strokeWidth="0.7" />

                  {/* 设备节点 */}
                  {sceneNodes.map((n) => {
                    const color = n.level === "ok" ? "#4dd4ff" : LEVEL_COLOR[n.level];
                    return (
                      <g key={n.key}>
                        {n.level !== "ok" && (
                          <circle
                            className={`ops-node-glow ${n.level}`}
                            cx={n.x}
                            cy={n.y}
                            r={n.level === "alarm" ? 36 : 30}
                            fill={color}
                            opacity="0.22"
                          />
                        )}
                        <DeviceGlyph kind={n.kind} x={n.x} y={n.y} color={color} />
                        <rect
                          x={n.x - 66}
                          y={n.y + 28}
                          width="132"
                          height="40"
                          rx="3"
                          fill="rgba(6, 17, 28, 0.92)"
                          stroke={n.level === "ok" ? "#5c6b7a" : color}
                          strokeOpacity={n.level === "ok" ? 0.7 : 0.45}
                          strokeWidth="0.7"
                        />
                        <text x={n.x - 58} y={n.y + 45} fill="#c7d6e2" fontSize="17">{n.name}</text>
                        <text x={n.x - 58} y={n.y + 61} fill={color} fontSize="16" fontWeight="700">
                          {fmt(n.health, 1)} 分 · {n.level === "alarm" ? "故障" : LEVEL_TEXT[n.level]}
                        </text>
                      </g>
                    );
                  })}

                  <FlowDots path="M 140 411 H 862" dur={14} count={3} color="#8fb6cc" r={2.2} opacity={0.55} />

                  {/* 厂区道路 */}
                  <rect x="0" y="552" width="1000" height="40" fill="#0e1924" stroke="#5c6b7a" strokeOpacity="0.7" strokeWidth="0.7" />
                  <line x1="14" y1="572" x2="986" y2="572" stroke="#8d99a6" strokeOpacity="0.3" strokeWidth="0.9" strokeDasharray="20 16" />
                  <rect x="96" y="542" width="808" height="10" fill="#22352f" stroke="#4c6b5e" strokeOpacity="0.4" strokeWidth="0.7" />
                </svg>
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
