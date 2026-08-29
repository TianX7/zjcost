import { useEffect, useId, useRef, useState } from "react";
import PageHeader from "../components/PageHeader";

/* ─────────────────────────────────────────────────────────────
 * 运营期专题页面：光伏发电监测 / 净水与中水回用 / 设施运维管理
 * 以动态可视化图形为主：实时驱动数值 + SVG 动效图表
 * ───────────────────────────────────────────────────────────── */

/** 全局时间心跳：驱动所有动态图形 */
function useTick(intervalMs = 1000) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((v) => v + 1), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return tick;
}

/** 平滑数值动画 */
function useSpring(target: number, speed = 0.08) {
  const [val, setVal] = useState(target);
  const raf = useRef(0);
  useEffect(() => {
    const step = () => {
      setVal((v) => {
        const next = v + (target - v) * speed;
        return Math.abs(target - next) < 0.01 ? target : next;
      });
      raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
  }, [target, speed]);
  return val;
}

/** 正弦波动 + 抖动，模拟实时遥测 */
function wave(t: number, base: number, amp: number, period = 12, noise = 0.15) {
  return base + Math.sin((t / period) * Math.PI * 2) * amp + (Math.random() - 0.5) * amp * noise;
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
              stroke={tk.active ? color : "rgba(148,163,184,0.2)"}
              strokeWidth="2" opacity={tk.active ? 0.85 : 1}
            />
          );
        })}
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(148,163,184,0.1)" strokeWidth={stroke} />
        <circle
          cx={cx} cy={cy} r={r} fill="none"
          stroke={`url(#${gid}-arc)`} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={`${ratio * c} ${c}`} transform={`rotate(-90 ${cx} ${cy})`}
          style={{ transition: "stroke-dasharray 0.25s linear", filter: `drop-shadow(0 0 6px ${color}66)` }}
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
          <line key={r} x1={pad.l} y1={pad.t + chartH * r} x2={w - pad.r} y2={pad.t + chartH * r} stroke="rgba(148,163,184,0.08)" strokeDasharray="3 4" />
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
              <circle cx={head[0]} cy={head[1]} r="4" fill={s.color}>
                <animate attributeName="r" values="3;5;3" dur="1.6s" repeatCount="indefinite" />
              </circle>
              <circle cx={head[0]} cy={head[1]} r="7" fill="none" stroke={s.color} strokeWidth="1.5">
                <animate attributeName="r" values="5;12" dur="1.6s" repeatCount="indefinite" />
                <animate attributeName="stroke-opacity" values="0.55;0" dur="1.6s" repeatCount="indefinite" />
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
              <span key={`${s.unit}-${s.color}`}>
                <i style={{ background: s.color }} />
                <strong style={{ color: s.color }}>{fmt(last, 1)} {s.unit}</strong>
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
  const t = useTick(1200);
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
    { id: "INV-01", power: power * 0.36, eff: 98.6, temp: wave(t, 41, 2, 11), kwh: todayKwh * 0.37, state: "normal" },
    { id: "INV-02", power: power * 0.35, eff: 98.2, temp: wave(t, 43, 2, 9), kwh: todayKwh * 0.36, state: "normal" },
    { id: "INV-03", power: power * 0.29, eff: 96.2, temp: wave(t, 51, 3, 7), kwh: todayKwh * 0.27, state: "warn" },
  ];

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
            series={[
              { data: live, color: "#fbbf24", unit: "kW" },
              { data: irrLive, color: "#fb923c", unit: "W/m²", dashed: true },
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
                  <stop offset="0%" stopColor="rgba(56,130,246,0.16)" />
                  <stop offset="100%" stopColor="rgba(8,20,40,0)" />
                </linearGradient>
                <radialGradient id="pv-sun">
                  <stop offset="0%" stopColor="#fef08a" />
                  <stop offset="70%" stopColor="#fbbf24" />
                  <stop offset="100%" stopColor="#f59e0b" stopOpacity="0.4" />
                </radialGradient>
              </defs>
              <rect x="0" y="0" width="560" height="250" fill="url(#pv-sky)" />
              {/* 太阳沿日轨迹运行（光线随行） */}
              <g>
                <animateMotion dur="25s" repeatCount="indefinite" path="M 60 120 Q 280 18 500 120" />
                <circle r="15" fill="url(#pv-sun)" />
                {Array.from({ length: 8 }).map((_, i) => {
                  const a = (i / 8) * Math.PI * 2;
                  return (
                    <line
                      key={i} x1={Math.cos(a) * 20} y1={Math.sin(a) * 20} x2={Math.cos(a) * 28} y2={Math.sin(a) * 28}
                      stroke="#fde68a" strokeWidth="2" strokeLinecap="round" opacity="0.6"
                    >
                      <animate attributeName="opacity" values="0.15;0.8;0.15" dur="2s" begin={`${i * 0.22}s`} repeatCount="indefinite" />
                    </line>
                  );
                })}
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
              <text x="400" y="234" textAnchor="middle" fill="#64748b" fontSize="10">厂区负荷</text>
              {/* 地面阵列 */}
              <g transform="translate(50 150) skewX(-12)">
                {Array.from({ length: 2 }).map((_, r) =>
                  Array.from({ length: 6 }).map((_, c) => (
                    <rect key={`${r}-${c}`} x={c * 26} y={r * 20} width="22" height="16" rx="2"
                      fill="#0e2a4a" stroke="#38bdf8" strokeWidth="1" opacity="0.85">
                      <animate attributeName="fill" values="#0e2a4a;#1d4e7e;#0e2a4a" dur="2.6s" begin={`${(r + c) * 0.18}s`} repeatCount="indefinite" />
                    </rect>
                  )),
                )}
              </g>
              <text x="128" y="196" textAnchor="middle" fill="#7dd3fc" fontSize="10">光伏阵列 68 kWp</text>
              {/* 逆变器 */}
              <rect x="216" y="152" width="52" height="40" rx="6" fill="rgba(19,45,82,0.9)" stroke="#38bdf8" strokeWidth="1.2" />
              <text x="242" y="176" textAnchor="middle" fill="#7dd3fc" fontSize="10">逆变器</text>
              <circle cx="242" cy="186" r="2.5" fill="#34d399">
                <animate attributeName="opacity" values="0.3;1;0.3" dur="1.5s" repeatCount="indefinite" />
              </circle>
              {/* 电网塔杆 */}
              <g stroke="#64748b" strokeWidth="2" strokeLinecap="round">
                <line x1="492" y1="236" x2="506" y2="168" /><line x1="520" y1="236" x2="506" y2="168" />
                <line x1="492" y1="196" x2="520" y2="196" /><line x1="497" y1="182" x2="515" y2="182" />
              </g>
              <text x="506" y="250" textAnchor="middle" fill="#64748b" fontSize="10">公共电网</text>
              {/* 能量流动：阵列 → 逆变器 → 负荷 / 电网 */}
              {[0, 1, 2].map((i) => (
                <circle key={`a${i}`} r="3" fill="#fde68a">
                  <animateMotion dur={`${1.5 + i * 0.3}s`} begin={`${i * 0.4}s`} repeatCount="indefinite" path="M 120 158 C 160 140, 190 150, 216 164" />
                  <animate attributeName="opacity" values="0;1;0" dur={`${1.5 + i * 0.3}s`} begin={`${i * 0.4}s`} repeatCount="indefinite" />
                </circle>
              ))}
              {[0, 1].map((i) => (
                <circle key={`b${i}`} r="3" fill="#7dd3fc">
                  <animateMotion dur={`${1.2 + i * 0.4}s`} begin={`${i * 0.5}s`} repeatCount="indefinite" path="M 268 172 C 292 180, 306 172, 328 168" />
                  <animate attributeName="opacity" values="0;1;0" dur={`${1.2 + i * 0.4}s`} begin={`${i * 0.5}s`} repeatCount="indefinite" />
                </circle>
              ))}
              {[0, 1].map((i) => (
                <circle key={`c${i}`} r="3" fill="#c4b5fd">
                  <animateMotion dur={`${1.6 + i * 0.5}s`} begin={`${0.3 + i * 0.6}s`} repeatCount="indefinite" path="M 268 186 C 330 212, 420 212, 490 196" />
                  <animate attributeName="opacity" values="0;1;0" dur={`${1.6 + i * 0.5}s`} begin={`${0.3 + i * 0.6}s`} repeatCount="indefinite" />
                </circle>
              ))}
              <text x="196" y="140" textAnchor="middle" fill="#64748b" fontSize="9">直流</text>
              <text x="380" y="222" textAnchor="middle" fill="#64748b" fontSize="9">余电上网</text>
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
              <span className={`ops-state-dot ${inv.state}`} />
            </div>
            <div className="ops-inv-metrics">
              <div><em>实时功率</em><strong>{fmt(inv.power, 1)} kW</strong></div>
              <div><em>转换效率</em><strong>{inv.eff}%</strong></div>
              <div><em>机内温度</em><strong>{fmt(inv.temp, 1)} ℃</strong></div>
              <div><em>今日发电</em><strong>{fmt(inv.kwh, 0)} kWh</strong></div>
            </div>
            <div className="ops-mini-track"><span style={{ width: `${clamp((inv.power / 25) * 100, 4, 100)}%` }} /></div>
          </div>
        ))}
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

/** 工艺单元盒子 */
function ProcessUnit({ x, y, name, icon, color }: { x: number; y: number; name: string; icon: string; color: string }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect width="110" height="76" rx="10" fill="rgba(19,45,82,0.85)" stroke={color} strokeWidth="1.2" />
      <text x="55" y="32" textAnchor="middle" fontSize="18" fill={color} opacity="0.9">{icon}</text>
      <text x="55" y="56" textAnchor="middle" fontSize="12" fill="#e2e8f0">{name}</text>
      <circle cx="55" cy="88" r="4" fill="#34d399">
        <animate attributeName="opacity" values="0.3;1;0.3" dur="1.6s" begin={`${(x / 175) * 0.3}s`} repeatCount="indefinite" />
      </circle>
    </g>
  );
}

/** 工艺管线（流动虚线） */
function FlowPipe({ d, color }: { d: string; color: string }) {
  return (
    <g>
      <path d={d} stroke="#1e3a5f" strokeWidth="9" fill="none" strokeLinecap="round" />
      <path d={d} stroke={color} strokeWidth="2.5" fill="none" strokeDasharray="9 13">
        <animate attributeName="stroke-dashoffset" values="0;-44" dur="1.15s" repeatCount="indefinite" />
      </path>
    </g>
  );
}

export function WaterReusePage() {
  const t = useTick(1500);
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
    { name: "原水调节池", level: 68, volume: "120 m³", color: "#38bdf8" },
    { name: "中水池", level: 54, volume: "80 m³", color: "#34d399" },
    { name: "净水箱", level: 76, volume: "60 m³", color: "#7dd3fc" },
  ];

  const quality = [
    { name: "CODcr", value: wave(t, 38, 3, 11), limit: 60, unit: "mg/L", color: "#38bdf8" },
    { name: "BOD₅", value: wave(t, 6.2, 0.6, 9), limit: 10, unit: "mg/L", color: "#34d399" },
    { name: "氨氮", value: wave(t, 2.1, 0.3, 13), limit: 5, unit: "mg/L", color: "#a78bfa" },
    { name: "余氯", value: residualCl, limit: 1.0, unit: "mg/L", color: "#fbbf24" },
  ];

  const dailyUse = [
    { label: "绿化浇灌", value: 22 },
    { label: "冲厕", value: 18 },
    { label: "道路浇洒", value: 10 },
    { label: "景观补水", value: 8 },
  ];

  // 工艺管线坐标
  const lane1 = { y: 40, pipe: 78 };
  const lane2 = { y: 196, pipe: 234 };
  const unitX = [20, 175, 330, 485, 640, 795];
  const pipes1 = unitX.slice(0, -1).map((x) => `M ${x + 110} ${lane1.pipe} L ${x + 155} ${lane1.pipe}`);
  const pipes2 = unitX.slice(0, -1).map((x) => `M ${x + 110} ${lane2.pipe} L ${x + 155} ${lane2.pipe}`);

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

      {/* 双系统工艺流程动效 */}
      <div className="ops-panel">
        <div className="ops-panel-head">
          <h3><span className="material-symbols-outlined">route</span>水处理工艺流程</h3>
          <div className="ops-flow-legend">
            <span style={{ color: "#7dd3fc", borderColor: "rgba(56,189,248,0.35)" }}><i style={{ background: "#38bdf8" }} />净水处理线 {fmt(supply, 1)} m³/h</span>
            <span style={{ color: "#6ee7b7", borderColor: "rgba(52,211,153,0.35)" }}><i style={{ background: "#34d399" }} />中水回用线 {fmt(reuseDaily, 0)} m³/d</span>
          </div>
        </div>
        <div className="ops-water-scene ops-scene">
          <svg viewBox="0 0 920 300" width="100%">
            <text x="20" y="26" fontSize="12" fontWeight="700" fill="#7dd3fc">净水处理线 · 直饮水 / 生活用水</text>
            {pipes1.map((d, i) => <FlowPipe key={`p1-${i}`} d={d} color="#38bdf8" />)}
            {[
              { name: "市政原水", icon: "⬇" },
              { name: "石英砂过滤", icon: "▦" },
              { name: "活性炭吸附", icon: "❋" },
              { name: "保安精滤", icon: "◎" },
              { name: "紫外消毒", icon: "☀" },
              { name: "净水箱", icon: "▣" },
            ].map((u, i) => (
              <ProcessUnit key={u.name} x={unitX[i]} y={lane1.y} name={u.name} icon={u.icon} color="#38bdf8" />
            ))}
            {/* 反冲洗排水跨线 */}
            <path d="M 540 128 C 540 168, 360 176, 232 192" stroke="#64748b" strokeWidth="1.5" fill="none" strokeDasharray="4 6">
              <animate attributeName="stroke-dashoffset" values="0;-20" dur="1.6s" repeatCount="indefinite" />
            </path>
            <text x="392" y="172" textAnchor="middle" fontSize="10" fill="#64748b">反冲洗排水</text>
            <text x="20" y="186" fontSize="12" fontWeight="700" fill="#6ee7b7">中水回用线 · 杂排水再生利用</text>
            {pipes2.map((d, i) => <FlowPipe key={`p2-${i}`} d={d} color="#34d399" />)}
            {[
              { name: "杂排水收集", icon: "▤" },
              { name: "格栅调节池", icon: "⚙" },
              { name: "MBR 膜反应", icon: "◈" },
              { name: "加氯消毒", icon: "✚" },
              { name: "中水池", icon: "▣" },
              { name: "回用输配", icon: "⇄" },
            ].map((u, i) => (
              <ProcessUnit key={u.name} x={unitX[i]} y={lane2.y} name={u.name} icon={u.icon} color="#34d399" />
            ))}
          </svg>
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
            series={[
              { data: flowData, color: "#818cf8", unit: "取水 m³/h" },
              { data: supData, color: "#38bdf8", unit: "供水 m³/h" },
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
              const level = Math.round(clamp(tank.level + Math.sin(t / 3 + i) * 4, 10, 95));
              return (
                <div key={tank.name} className="ops-tank">
                  <div className="ops-tank-body">
                    <div className="ops-tank-water" style={{ height: `${level}%`, background: `linear-gradient(180deg, ${tank.color}cc, ${tank.color}55)` }}>
                      <i className="ops-tank-crest" style={{ background: "rgba(255,255,255,0.22)", animationDelay: `${i * 0.5}s` }} />
                      <i className="ops-tank-crest slow" style={{ background: "rgba(255,255,255,0.12)", animationDelay: `${i * 0.9}s` }} />
                    </div>
                    <strong>{level}%</strong>
                  </div>
                  <em>{tank.name}</em>
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
            <span className="ops-quality-badge"><span className="material-symbols-outlined">verified</span>综合达标率 100%</span>
          </div>
          <div className="ops-quality-list">
            {quality.map((q) => (
              <div key={q.name} className="ops-quality-row">
                <em>{q.name}</em>
                <div className="ops-quality-track">
                  <span style={{ width: `${clamp((q.value / q.limit) * 100, 0, 100)}%`, background: `linear-gradient(90deg, ${q.color}, ${q.color}88)`, boxShadow: `0 0 8px ${q.color}66` }} />
                </div>
                <strong style={{ color: q.color }}>{fmt(q.value, 2)}</strong>
                <span className="ops-quality-limit">限值 {q.limit} {q.unit}</span>
              </div>
            ))}
            <div className="ops-quality-row">
              <em>浊度</em>
              <div className="ops-quality-track">
                <span style={{ width: `${clamp((turbidity / 5) * 100, 0, 100)}%`, background: "linear-gradient(90deg, #fbbf24, #fbbf2488)" }} />
              </div>
              <strong style={{ color: "#fbbf24" }}>{fmt(turbidity, 2)}</strong>
              <span className="ops-quality-limit">限值 5 NTU</span>
            </div>
            <div className="ops-quality-row">
              <em>pH 值</em>
              <div className="ops-quality-track">
                <span style={{ width: `${clamp((ph / 9) * 100, 0, 100)}%`, background: "linear-gradient(90deg, #a78bfa, #a78bfa88)" }} />
              </div>
              <strong style={{ color: "#a78bfa" }}>{fmt(ph, 2)}</strong>
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
    </div>
  );
}

/* ═══════════════ 设施运维管理 ═══════════════ */

export function FacilityOpsPage() {
  const t = useTick(1600);

  const [co2Series, setCo2Series] = useState<number[]>(() => Array.from({ length: 30 }, (_, i) => 620 + Math.sin(i / 4) * 60));
  const [tempSeries, setTempSeries] = useState<number[]>(() => Array.from({ length: 30 }, (_, i) => 24 + Math.sin(i / 6) * 1.1));
  const co2 = wave(t, 618, 52, 16);
  const indoorTemp = wave(t, 24.2, 0.9, 11);
  useEffect(() => {
    setCo2Series((prev) => [...prev.slice(1), co2]);
    setTempSeries((prev) => [...prev.slice(1), indoorTemp]);
  }, [t]); // eslint-disable-line react-hooks/exhaustive-deps

  const devices = [
    { name: "电梯系统", health: wave(t, 94, 1.5, 10), color: "#38bdf8" },
    { name: "暖通空调", health: wave(t, 89, 2.5, 8), color: "#a78bfa" },
    { name: "消防泵组", health: wave(t, 97, 1, 14), color: "#f87171" },
    { name: "照明系统", health: wave(t, 92, 2, 12), color: "#fbbf24" },
    { name: "给排水泵", health: wave(t, 91, 2, 9), color: "#34d399" },
    { name: "光伏系统", health: wave(t, 96, 1.2, 11), color: "#fb923c" },
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

  const alerts = [
    { level: "warn", icon: "warning", text: "INV-03 逆变器转换效率偏低", detail: "实测 96.2%，低于基线 97.5%，建议排查 MPPT 跟踪", time: "10 分钟前" },
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
          <span><span className="material-symbols-outlined">speed</span>综合健康度 93.2 分 · 较上周 +0.8</span>
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
                    <animate attributeName="stroke-width" values="14;18;14" dur="3s" repeatCount="indefinite" />
                  </circle>
                );
                donutOffset += dash;
                return el;
              })}
              <text x="85" y="80" textAnchor="middle" fill="#e2e8f0" fontSize="22" fontWeight="800">{donutTotal}</text>
              <text x="85" y="100" textAnchor="middle" fill="#64748b" fontSize="11">工单总数</text>
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
        </div>

        <div className="ops-panel">
          <div className="ops-panel-head">
            <h3><span className="material-symbols-outlined">air</span>室内环境监测（CO₂ × 温度）</h3>
            <span className="ops-live-badge"><i />LIVE</span>
          </div>
          <LiveLineChart
            series={[
              { data: co2Series, color: "#a78bfa", unit: "ppm", max: 900 },
              { data: tempSeries, color: "#fb923c", unit: "℃", dashed: true },
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
