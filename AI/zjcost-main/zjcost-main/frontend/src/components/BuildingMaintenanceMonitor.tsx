import { useEffect, useMemo, useState } from "react";
import { Metric, Sparkline } from "./ResourceMonitor";

interface MaintenanceTelemetry {
  settlement: number;
  inclination: number;
  crackWidth: number;
  vibration: number;
  elevatorHealth: number;
  hvacHealth: number;
  firePumpHealth: number;
  lightingHealth: number;
  temperature: number;
  humidity: number;
  co2: number;
  pm25: number;
  openOrders: number;
  overdueOrders: number;
  completedThisMonth: number;
  avgResponseHours: number;
  energyIntensity: number;
}

type SeriesKey = "settlement" | "deviceHealth" | "co2" | "openOrders" | "energyIntensity";

interface MaintenanceState {
  telemetry: MaintenanceTelemetry;
  series: Record<SeriesKey, number[]>;
}

const SAMPLE_SECONDS = 3;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

// ponytail: simulated facility telemetry; swap createState/nextState for a BEMS/IoT feed when available.
function createState(): MaintenanceState {
  const telemetry: MaintenanceTelemetry = {
    settlement: 3.2,
    inclination: 1.1,
    crackWidth: 0.14,
    vibration: 0.8,
    elevatorHealth: 94,
    hvacHealth: 89,
    firePumpHealth: 97,
    lightingHealth: 92,
    temperature: 23.6,
    humidity: 52,
    co2: 620,
    pm25: 28,
    openOrders: 7,
    overdueOrders: 1,
    completedThisMonth: 34,
    avgResponseHours: 5.2,
    energyIntensity: 58.4,
  };

  return {
    telemetry,
    series: {
      settlement: Array.from({ length: 24 }, (_, i) => 2.8 + Math.sin(i / 6) * 0.4 + Math.random() * 0.2),
      deviceHealth: Array.from({ length: 24 }, () => 90 + Math.random() * 5),
      co2: Array.from({ length: 24 }, (_, i) => 580 + Math.sin(i / 4) * 70 + Math.random() * 30),
      openOrders: Array.from({ length: 24 }, () => Math.round(5 + Math.random() * 4)),
      energyIntensity: Array.from({ length: 24 }, (_, i) => 54 + Math.sin(i / 5) * 6 + Math.random() * 2),
    },
  };
}

function nextState(prev: MaintenanceState): MaintenanceState {
  const t = prev.telemetry;
  const elevatorHealth = clamp(t.elevatorHealth + (Math.random() - 0.5) * 0.8, 78, 99);
  const hvacHealth = clamp(t.hvacHealth + (Math.random() - 0.5) * 1.0, 72, 98);
  const firePumpHealth = clamp(t.firePumpHealth + (Math.random() - 0.5) * 0.4, 85, 100);
  const lightingHealth = clamp(t.lightingHealth + (Math.random() - 0.5) * 0.7, 80, 99);
  const deviceHealth = (elevatorHealth + hvacHealth + firePumpHealth + lightingHealth) / 4;
  const openOrders = Math.round(clamp(t.openOrders + (Math.random() - 0.52) * 1.2, 0, 16));
  const overdueOrders = openOrders > 10
    ? Math.max(1, t.overdueOrders)
    : Math.round(clamp(t.overdueOrders + (Math.random() - 0.55) * 0.4, 0, 4));

  const telemetry: MaintenanceTelemetry = {
    settlement: clamp(t.settlement + (Math.random() - 0.5) * 0.12, 1.2, 8.5),
    inclination: clamp(t.inclination + (Math.random() - 0.5) * 0.05, 0.3, 3.2),
    crackWidth: clamp(t.crackWidth + (Math.random() - 0.5) * 0.008, 0.05, 0.38),
    vibration: clamp(t.vibration + (Math.random() - 0.5) * 0.06, 0.2, 2.4),
    elevatorHealth,
    hvacHealth,
    firePumpHealth,
    lightingHealth,
    temperature: clamp(t.temperature + (Math.random() - 0.5) * 0.3, 19, 28),
    humidity: clamp(t.humidity + (Math.random() - 0.5) * 1.2, 38, 68),
    co2: clamp(t.co2 + (Math.random() - 0.5) * 35, 420, 1050),
    pm25: clamp(t.pm25 + (Math.random() - 0.5) * 2.4, 8, 78),
    openOrders,
    overdueOrders,
    completedThisMonth: t.completedThisMonth + (Math.random() > 0.94 ? 1 : 0),
    avgResponseHours: clamp(t.avgResponseHours + (Math.random() - 0.5) * 0.2, 2.5, 12),
    energyIntensity: clamp(t.energyIntensity + (Math.random() - 0.5) * 1.1, 42, 78),
  };

  const series = { ...prev.series };
  series.settlement = [...series.settlement.slice(1), telemetry.settlement];
  series.deviceHealth = [...series.deviceHealth.slice(1), deviceHealth];
  series.co2 = [...series.co2.slice(1), telemetry.co2];
  series.openOrders = [...series.openOrders.slice(1), openOrders];
  series.energyIntensity = [...series.energyIntensity.slice(1), telemetry.energyIntensity];

  return { telemetry, series };
}

function HealthRing({ score }: { score: number }) {
  const size = 82;
  const stroke = 8;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const color = score >= 90 ? "#22c55e" : score >= 80 ? "#f59e0b" : "#ef4444";

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="maintenance-health-ring">
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="rgba(148,163,184,0.14)" strokeWidth={stroke} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke={color}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={`${(score / 100) * circumference} ${circumference}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <text x={size / 2} y={size / 2 + 5} textAnchor="middle" fill="var(--text-primary)" fontSize="20" fontWeight="700">{score}</text>
    </svg>
  );
}

function DeviceStatus({ label, value }: { label: string; value: number }) {
  const state = value >= 92 ? "良好" : value >= 82 ? "关注" : "需检修";
  const color = value >= 92 ? "#22c55e" : value >= 82 ? "#f59e0b" : "#ef4444";

  return (
    <div className="maintenance-device">
      <div><span>{label}</span><strong style={{ color }}>{value.toFixed(0)}%</strong></div>
      <div className="maintenance-device-track"><span style={{ width: `${value}%`, background: color }} /></div>
      <em>{state}</em>
    </div>
  );
}

// 水电与能源配套测算基准：按博物馆类公共建筑规模，依据 GB 50189《公共建筑节能设计标准》
// 及公共建筑给水排水、用电负荷相关定额指标测算，供造价分析与工程核验参考。
const BUILDING_GFA_M2 = 18600; // 总建筑面积（m²）
const WATER_QUOTA_L_PER_M2_D = 2.2; // 公共建筑用水定额 L/(m²·d)
const ELEC_INTENSITY_KWH_PER_M2_Y = 78; // 公共建筑用电指标 kWh/(m²·a)
const RECLAIMED_WATER_RATIO = 0.32; // 中水系统回用比例
const PV_CAPACITY_KWP = 420; // 屋面光伏装机容量（kWp）
const PV_EQUIVALENT_HOURS_D = 3.6; // 等效满发利用小时（h/d）

function buildUtilityBaseline() {
  const dailyWaterM3 = (BUILDING_GFA_M2 * WATER_QUOTA_L_PER_M2_D) / 1000;
  const dailyElectricityKwh = (BUILDING_GFA_M2 * ELEC_INTENSITY_KWH_PER_M2_Y) / 365;
  const reclaimedWaterM3 = dailyWaterM3 * RECLAIMED_WATER_RATIO;
  const pvDailyKwh = PV_CAPACITY_KWP * PV_EQUIVALENT_HOURS_D;
  const pvSupplyRatio = (pvDailyKwh / dailyElectricityKwh) * 100;
  return { dailyWaterM3, dailyElectricityKwh, reclaimedWaterM3, pvDailyKwh, pvSupplyRatio };
}

export default function BuildingMaintenanceMonitor() {
  const [state, setState] = useState<MaintenanceState>(createState);
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
    const deviceHealth = (t.elevatorHealth + t.hvacHealth + t.firePumpHealth + t.lightingHealth) / 4;
    const structuralScore = clamp(100 - t.settlement * 5 - t.inclination * 8 - t.crackWidth * 60 - t.vibration * 5, 60, 100);
    const environmentScore = clamp(100 - Math.abs(t.temperature - 23) * 2 - Math.abs(t.humidity - 50) * 0.5 - (t.co2 - 500) / 12 - (t.pm25 - 20) / 2, 60, 100);
    const maintenanceScore = clamp(100 - t.overdueOrders * 12 - t.openOrders * 1.5 - t.avgResponseHours * 1.2, 60, 100);
    const healthScore = Math.round(structuralScore * 0.34 + deviceHealth * 0.32 + environmentScore * 0.18 + maintenanceScore * 0.16);
    // 水电与能源配套监测：以建筑规模测算基准值，随设备运行率与能耗强度做实时折算
    const base = buildUtilityBaseline();
    const loadFactor = clamp(t.energyIntensity / 58.4, 0.8, 1.25);
    const pvFactor = clamp(0.9 + (t.temperature - 23) * 0.004, 0.82, 1.0);
    const utilities = {
      dailyWaterM3: base.dailyWaterM3 * loadFactor,
      dailyElectricityKwh: base.dailyElectricityKwh * loadFactor,
      reclaimedWaterM3: base.reclaimedWaterM3 * loadFactor,
      pvDailyKwh: base.pvDailyKwh * pvFactor,
      pvSupplyRatio: (base.pvDailyKwh * pvFactor) / (base.dailyElectricityKwh * loadFactor) * 100,
      reclaimedRatio: RECLAIMED_WATER_RATIO * 100,
    };
    return { deviceHealth, structuralScore, environmentScore, maintenanceScore, healthScore, utilities };
  }, [state.telemetry]);

  const t = state.telemetry;
  const alerts = [
    t.settlement > 7 && "沉降关注",
    t.crackWidth > 0.3 && "裂缝关注",
    t.firePumpHealth < 88 && "消防泵检修",
    t.co2 > 900 && "CO₂偏高",
    t.overdueOrders > 0 && `${t.overdueOrders} 项维保逾期`,
  ].filter(Boolean) as string[];

  return (
    <section className="resource-monitor maintenance-monitor" aria-label="建筑后期维护动态监测">
      <div className="monitor-head">
        <div>
          <h3>
            <span className="material-symbols-outlined">home_repair_service</span>
            建筑后期维护
          </h3>
          <p>结构安全 · 设施设备 · 环境能耗 · 维保工单</p>
        </div>
        <div className="monitor-head-actions">
          {alerts.length > 0 ? (
            alerts.slice(0, 2).map((alert) => <span key={alert} className="monitor-alert">{alert}</span>)
          ) : (
            <span className="monitor-normal">维护正常</span>
          )}
          <span className="monitor-clock"><i />{updatedAt.toLocaleTimeString("zh-CN", { hour12: false })}</span>
          <button type="button" onClick={() => setRunning((value) => !value)} title={running ? "暂停刷新" : "继续刷新"}>
            <span className="material-symbols-outlined">{running ? "pause" : "play_arrow"}</span>
          </button>
        </div>
      </div>

      <div className="maintenance-summary">
        <div className="maintenance-summary-main">
          <HealthRing score={derived.healthScore} />
          <div>
            <strong>建筑维护健康度</strong>
            <span>综合结构、设备、环境与维保响应</span>
          </div>
        </div>
        <div className="maintenance-summary-metrics">
          <div><em>结构安全</em><strong>{derived.structuralScore.toFixed(0)}</strong></div>
          <div><em>设备健康</em><strong>{derived.deviceHealth.toFixed(0)}</strong></div>
          <div><em>环境评分</em><strong>{derived.environmentScore.toFixed(0)}</strong></div>
          <div><em>维保效能</em><strong>{derived.maintenanceScore.toFixed(0)}</strong></div>
        </div>
      </div>

      <div className="monitor-grid">
        <article>
          <header>
            <span className="monitor-icon building"><span className="material-symbols-outlined">foundation</span></span>
            <div><h4>结构安全</h4><em>沉降与形变</em></div>
          </header>
          <div className="monitor-metrics">
            <Metric label="累计沉降" value={t.settlement.toFixed(1)} unit="mm" />
            <Metric label="倾斜率" value={t.inclination.toFixed(2)} unit="‰" />
            <Metric label="裂缝宽度" value={t.crackWidth.toFixed(2)} unit="mm" />
            <Metric label="振动速度" value={t.vibration.toFixed(2)} unit="mm/s" />
          </div>
          <Sparkline data={state.series.settlement} color="#38bdf8" />
          <footer>
            <div className="monitor-bar-label"><span>结构安全分</span><strong>{derived.structuralScore.toFixed(0)}</strong></div>
            <div className="maintenance-score-track"><span style={{ width: `${derived.structuralScore}%` }} /></div>
          </footer>
        </article>

        <article>
          <header>
            <span className="monitor-icon facility"><span className="material-symbols-outlined">settings_suggest</span></span>
            <div><h4>设施设备</h4><em>运行健康度</em></div>
          </header>
          <div className="maintenance-devices">
            <DeviceStatus label="电梯系统" value={t.elevatorHealth} />
            <DeviceStatus label="暖通空调" value={t.hvacHealth} />
            <DeviceStatus label="消防泵组" value={t.firePumpHealth} />
            <DeviceStatus label="公共照明" value={t.lightingHealth} />
          </div>
          <footer>
            <div className="monitor-bar-label"><span>设备综合健康</span><strong>{derived.deviceHealth.toFixed(0)}</strong></div>
            <div className="maintenance-score-track"><span style={{ width: `${derived.deviceHealth}%` }} /></div>
          </footer>
        </article>

        <article>
          <header>
            <span className="monitor-icon environment"><span className="material-symbols-outlined">air</span></span>
            <div><h4>环境能耗</h4><em>舒适与运行强度</em></div>
          </header>
          <div className="monitor-metrics">
            <Metric label="室内温度" value={t.temperature.toFixed(1)} unit="℃" />
            <Metric label="相对湿度" value={t.humidity.toFixed(0)} unit="%" />
            <Metric label="CO₂" value={t.co2.toFixed(0)} unit="ppm" />
            <Metric label="PM2.5" value={t.pm25.toFixed(0)} unit="μg/m³" />
          </div>
          <Sparkline data={state.series.energyIntensity} color="#a78bfa" />
          <footer>
            <div className="monitor-bar-label"><span>能耗强度</span><strong>{t.energyIntensity.toFixed(1)} kWh/m²</strong></div>
            <div className="maintenance-score-track"><span style={{ width: `${clamp(t.energyIntensity, 0, 100)}%` }} /></div>
          </footer>
        </article>

        <article>
          <header>
            <span className="monitor-icon utility"><span className="material-symbols-outlined">water_drop</span></span>
            <div><h4>水电与能源配套</h4><em>按建筑规模依国标测算</em></div>
          </header>
          <div className="monitor-metrics">
            <Metric label="日用水量" value={derived.utilities.dailyWaterM3.toFixed(1)} unit="m³/d" />
            <Metric label="日用电量" value={derived.utilities.dailyElectricityKwh.toFixed(0)} unit="kWh/d" />
            <Metric label="中水回用量" value={derived.utilities.reclaimedWaterM3.toFixed(1)} unit="m³/d" />
            <Metric label="光伏日发电" value={derived.utilities.pvDailyKwh.toFixed(0)} unit="kWh/d" />
          </div>
          <Sparkline data={state.series.energyIntensity} color="#4dd4ff" />
          <footer>
            <div className="monitor-bar-label"><span>中水回用率</span><strong>{derived.utilities.reclaimedRatio.toFixed(0)}%</strong></div>
            <div className="maintenance-score-track"><span style={{ width: `${derived.utilities.reclaimedRatio}%` }} /></div>
            <div className="monitor-bar-label"><span>光伏供电占比</span><strong>{derived.utilities.pvSupplyRatio.toFixed(1)}%</strong></div>
            <div className="maintenance-score-track pv"><span style={{ width: `${clamp(derived.utilities.pvSupplyRatio, 0, 100)}%` }} /></div>
          </footer>
        </article>

        <article>
          <header>
            <span className="monitor-icon work"><span className="material-symbols-outlined">assignment</span></span>
            <div><h4>维保工单</h4><em>处置与响应</em></div>
          </header>
          <div className="monitor-metrics">
            <Metric label="进行中" value={`${t.openOrders}`} unit="项" />
            <Metric label="已逾期" value={`${t.overdueOrders}`} unit="项" />
            <Metric label="本月完成" value={`${t.completedThisMonth}`} unit="项" />
            <Metric label="平均响应" value={t.avgResponseHours.toFixed(1)} unit="h" />
          </div>
          <Sparkline data={state.series.openOrders} color="#fb7185" />
          <footer>
            <div className="monitor-bar-label"><span>维保效能分</span><strong>{derived.maintenanceScore.toFixed(0)}</strong></div>
            <div className="maintenance-score-track"><span style={{ width: `${derived.maintenanceScore}%` }} /></div>
          </footer>
        </article>
      </div>
    </section>
  );
}
