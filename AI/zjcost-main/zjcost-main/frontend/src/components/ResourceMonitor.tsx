import { useEffect, useMemo, useState } from "react";

interface Telemetry {
  pvPower: number;
  powerDemand: number;
  pvGenerated: number;
  electricityUsed: number;
  hydroOutput: number;
  lineLoss: number;
  transformerLoss: number;
  controlLoss: number;
  panelTemperature: number;
  powerFactor: number;
  waterUsed: number;
  purifiedWater: number;
  reusedWater: number;
  waterFlow: number;
  purifiedFlow: number;
  turbidity: number;
  ph: number;
  residualChlorine: number;
}

type SeriesKey = "pvPower" | "powerDemand" | "hydroOutput" | "lossRate" | "waterFlow" | "purifiedFlow";

interface MonitorState {
  telemetry: Telemetry;
  series: Record<SeriesKey, number[]>;
}

const SAMPLE_SECONDS = 2;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

// ponytail: simulated telemetry; replace createState/nextState with an IoT feed when a real gateway exists.
function createState(): MonitorState {
  const telemetry: Telemetry = {
    pvPower: 42.6,
    powerDemand: 35.2,
    pvGenerated: 318.4,
    electricityUsed: 274.1,
    hydroOutput: 86.4,
    lineLoss: 1.8,
    transformerLoss: 1.2,
    controlLoss: 0.6,
    panelTemperature: 41,
    powerFactor: 0.96,
    waterUsed: 128.5,
    purifiedWater: 121.4,
    reusedWater: 34.8,
    waterFlow: 12.4,
    purifiedFlow: 11.7,
    turbidity: 0.18,
    ph: 7.24,
    residualChlorine: 0.36,
  };

  return {
    telemetry,
    series: {
      pvPower: Array.from({ length: 24 }, (_, i) => 34 + Math.sin(i / 3) * 7 + Math.random() * 3),
      powerDemand: Array.from({ length: 24 }, (_, i) => 28 + Math.cos(i / 4) * 5 + Math.random() * 3),
      hydroOutput: Array.from({ length: 24 }, (_, i) => 78 + Math.sin(i / 5) * 9 + Math.random() * 3),
      lossRate: Array.from({ length: 24 }, () => 3.4 + Math.random() * 0.8),
      waterFlow: Array.from({ length: 24 }, (_, i) => 11 + Math.sin(i / 4) * 2 + Math.random()),
      purifiedFlow: Array.from({ length: 24 }, (_, i) => 10 + Math.sin((i + 1) / 4) * 2 + Math.random()),
    },
  };
}

function nextState(prev: MonitorState): MonitorState {
  const t = prev.telemetry;
  const pvPower = clamp(t.pvPower + (Math.random() - 0.48) * 3.2, 12, 68);
  const powerDemand = clamp(t.powerDemand + (Math.random() - 0.5) * 2.4, 16, 54);
  const hydroOutput = clamp(t.hydroOutput + (Math.random() - 0.47) * 3.8, 52, 118);
  const lineLoss = clamp(t.lineLoss + (Math.random() - 0.5) * 0.14, 0.8, 3.2);
  const transformerLoss = clamp(t.transformerLoss + (Math.random() - 0.5) * 0.1, 0.6, 2.4);
  const controlLoss = clamp(t.controlLoss + (Math.random() - 0.5) * 0.06, 0.2, 1.2);
  const totalLoss = lineLoss + transformerLoss + controlLoss;
  const lossRate = (totalLoss / (hydroOutput + totalLoss)) * 100;
  const waterFlow = clamp(t.waterFlow + (Math.random() - 0.5) * 0.9, 6, 19);
  const purificationEfficiency = clamp(t.purifiedWater / t.waterUsed + (Math.random() - 0.5) * 0.004, 0.88, 0.97);
  const purifiedFlow = waterFlow * purificationEfficiency;

  const telemetry: Telemetry = {
    ...t,
    pvPower,
    powerDemand,
    pvGenerated: t.pvGenerated + pvPower * (SAMPLE_SECONDS / 3600),
    electricityUsed: t.electricityUsed + powerDemand * (SAMPLE_SECONDS / 3600),
    hydroOutput,
    lineLoss,
    transformerLoss,
    controlLoss,
    panelTemperature: clamp(t.panelTemperature + (Math.random() - 0.5) * 0.7, 32, 62),
    powerFactor: clamp(t.powerFactor + (Math.random() - 0.5) * 0.008, 0.91, 0.99),
    waterUsed: t.waterUsed + waterFlow * (SAMPLE_SECONDS / 3600),
    purifiedWater: t.purifiedWater + purifiedFlow * (SAMPLE_SECONDS / 3600),
    reusedWater: t.reusedWater + purifiedFlow * 0.26 * (SAMPLE_SECONDS / 3600),
    waterFlow,
    purifiedFlow,
    turbidity: clamp(t.turbidity + (Math.random() - 0.5) * 0.02, 0.05, 0.38),
    ph: clamp(t.ph + (Math.random() - 0.5) * 0.04, 6.8, 7.6),
    residualChlorine: clamp(t.residualChlorine + (Math.random() - 0.5) * 0.015, 0.2, 0.55),
  };

  const series = { ...prev.series };
  series.pvPower = [...series.pvPower.slice(1), pvPower];
  series.powerDemand = [...series.powerDemand.slice(1), powerDemand];
  series.hydroOutput = [...series.hydroOutput.slice(1), hydroOutput];
  series.lossRate = [...series.lossRate.slice(1), lossRate];
  series.waterFlow = [...series.waterFlow.slice(1), waterFlow];
  series.purifiedFlow = [...series.purifiedFlow.slice(1), purifiedFlow];

  return { telemetry, series };
}

export function Sparkline({ data, color }: { data: number[]; color: string }) {
  const width = 300;
  const height = 72;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const span = Math.max(max - min, 0.001);
  const points = data.map((value, index) => [
    (index / (data.length - 1)) * width,
    height - 10 - ((value - min) / span) * (height - 22),
  ]);
  const path = points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${path} L${width},${height} L0,${height} Z`;
  const last = points[points.length - 1];

  return (
    <svg className="monitor-sparkline" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
      <path d={area} fill={color} opacity={0.13} />
      <path d={path} fill="none" stroke={color} strokeWidth={2.2} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      <circle cx={last[0]} cy={last[1]} r={3.2} fill={color} />
    </svg>
  );
}

export function Metric({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="monitor-metric">
      <span>{label}</span>
      <strong>
        {value}
        {unit ? <em>{unit}</em> : null}
      </strong>
    </div>
  );
}

export default function ResourceMonitor() {
  const [state, setState] = useState<MonitorState>(createState);
  const [running, setRunning] = useState(true);
  const [updatedAt, setUpdatedAt] = useState(() => new Date());

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => {
      setState(nextState);
      setUpdatedAt(new Date());
    }, SAMPLE_SECONDS * 1000);
    return () => window.clearInterval(timer);
  }, [running]);

  const derived = useMemo(() => {
    const t = state.telemetry;
    const totalLoss = t.lineLoss + t.transformerLoss + t.controlLoss;
    return {
      selfUseRate: Math.round(clamp((t.electricityUsed / Math.max(t.pvGenerated, 1)) * 100, 0, 100)),
      totalLoss,
      lossRate: (totalLoss / (t.hydroOutput + totalLoss)) * 100,
      purificationRate: Math.round((t.purifiedWater / Math.max(t.waterUsed, 1)) * 100),
      reuseRate: Math.round((t.reusedWater / Math.max(t.waterUsed, 1)) * 100),
      gridExport: Math.max(0, t.pvGenerated - t.electricityUsed),
    };
  }, [state.telemetry]);

  const lossParts = [
    { label: "线损", value: state.telemetry.lineLoss, color: "#f59e0b" },
    { label: "变损", value: state.telemetry.transformerLoss, color: "#fb7185" },
    { label: "控制损耗", value: state.telemetry.controlLoss, color: "#a78bfa" },
  ];
  const alerts = [
    derived.lossRate > 5 && "损耗偏高",
    state.telemetry.turbidity > 0.3 && "浊度关注",
    state.telemetry.panelTemperature > 58 && "柜温偏高",
  ].filter(Boolean) as string[];

  return (
    <section className="resource-monitor" aria-label="水电与净水动态监测">
      <div className="monitor-head">
        <div>
          <h3>
            <span className="material-symbols-outlined">bolt</span>
            水电与净水监测
          </h3>
          <p>光伏阵列 · 水电控制柜 · 净水回用</p>
        </div>
        <div className="monitor-head-actions">
          {alerts.length > 0 ? (
            alerts.map((alert) => <span key={alert} className="monitor-alert">{alert}</span>)
          ) : (
            <span className="monitor-normal">运行正常</span>
          )}
          <span className="monitor-clock"><i />{updatedAt.toLocaleTimeString("zh-CN", { hour12: false })}</span>
          <button type="button" onClick={() => setRunning((value) => !value)} title={running ? "暂停刷新" : "继续刷新"}>
            <span className="material-symbols-outlined">{running ? "pause" : "play_arrow"}</span>
          </button>
        </div>
      </div>

      <div className="monitor-grid">
        <article>
          <header>
            <span className="monitor-icon solar"><span className="material-symbols-outlined">solar_power</span></span>
            <div><h4>光伏发电</h4><em>屋面阵列</em></div>
          </header>
          <div className="monitor-metrics">
            <Metric label="实时功率" value={state.telemetry.pvPower.toFixed(1)} unit="kW" />
            <Metric label="累计发电" value={state.telemetry.pvGenerated.toFixed(1)} unit="kWh" />
            <Metric label="消耗电量" value={state.telemetry.electricityUsed.toFixed(1)} unit="kWh" />
            <Metric label="余电上网" value={derived.gridExport.toFixed(1)} unit="kWh" />
          </div>
          <Sparkline data={state.series.pvPower} color="#f59e0b" />
          <footer>
            <div className="monitor-bar-label"><span>光伏自用率</span><strong>{derived.selfUseRate}%</strong></div>
            <div className="monitor-bar"><span style={{ width: `${derived.selfUseRate}%` }} /></div>
          </footer>
        </article>

        <article>
          <header>
            <span className="monitor-icon hydro"><span className="material-symbols-outlined">settings_input_component</span></span>
            <div><h4>水电控制面板</h4><em>损耗与能效</em></div>
          </header>
          <div className="monitor-metrics">
            <Metric label="输出功率" value={state.telemetry.hydroOutput.toFixed(1)} unit="kW" />
            <Metric label="综合损耗" value={`${derived.lossRate.toFixed(1)}`} unit="%" />
            <Metric label="柜体温度" value={state.telemetry.panelTemperature.toFixed(1)} unit="℃" />
            <Metric label="功率因数" value={state.telemetry.powerFactor.toFixed(2)} />
          </div>
          <Sparkline data={state.series.lossRate} color="#ef4444" />
          <footer>
            <div className="monitor-loss-track">
              {lossParts.map((part) => (
                <span key={part.label} title={`${part.label} ${part.value.toFixed(2)} kW`} style={{ width: `${(part.value / derived.totalLoss) * 100}%`, background: part.color }} />
              ))}
            </div>
            <div className="monitor-legend">
              {lossParts.map((part) => (
                <span key={part.label}><i style={{ background: part.color }} />{part.label} {part.value.toFixed(2)}</span>
              ))}
            </div>
          </footer>
        </article>

        <article>
          <header>
            <span className="monitor-icon water"><span className="material-symbols-outlined">water_drop</span></span>
            <div><h4>净水循环</h4><em>消耗与净化</em></div>
          </header>
          <div className="monitor-metrics">
            <Metric label="用水量" value={state.telemetry.waterUsed.toFixed(1)} unit="m³" />
            <Metric label="净化水量" value={state.telemetry.purifiedWater.toFixed(1)} unit="m³" />
            <Metric label="回用量" value={state.telemetry.reusedWater.toFixed(1)} unit="m³" />
            <Metric label="净化率" value={`${derived.purificationRate}`} unit="%" />
          </div>
          <Sparkline data={state.series.purifiedFlow} color="#22d3ee" />
          <footer>
            <div className="monitor-quality">
              <span>浊度<strong>{state.telemetry.turbidity.toFixed(2)} NTU</strong></span>
              <span>pH<strong>{state.telemetry.ph.toFixed(2)}</strong></span>
              <span>余氯<strong>{state.telemetry.residualChlorine.toFixed(2)}</strong></span>
            </div>
          </footer>
        </article>
      </div>
    </section>
  );
}
