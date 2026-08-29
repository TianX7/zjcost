import { useEffect, useMemo, useState } from "react";

/* ── 测算边界条件（博物馆类公共建筑示例项目，荒漠地区，配套光伏 + 中水系统）──
 * 下列参数均按国家现行标准规定的方法测算，数值为示例测算值；
 * 正式数据应以项目能耗计算书、施工图设计及实际计量数据为准。 */
const BUILDING_AREA = 12400; // m² 总建筑面积
const EUI_DESIGN = 68; // kWh/(m²·a) 单位面积年电耗设计指标，参照 GB/T 51161-2016《民用建筑能耗标准》博物馆类取值
const COAL_FACTOR = 0.1229; // kgce/kWh 电力折标准煤系数（当量值），GB/T 2589-2020《综合能耗计算通则》
const PV_CAPACITY = 68; // kWp 屋面光伏装机容量（与总控台实时监测阵列规模一致）
const PV_HOURS = 1500; // h 年等效满发利用小时，参照 GB 50797-2012《光伏发电站设计规范》及当地太阳能资源评估
const WATER_PER_AREA = 1.1; // m³/(m²·a) 单位面积年用水量，参照 GB 50015-2019《建筑给水排水设计标准》公共建筑用水定额
const REUSE_RATE = 0.26; // 中水回用率设计目标，参照 GB 50336-2018《建筑中水设计标准》
const CO2_FACTOR = 0.5703; // tCO₂/MWh 全国电力平均二氧化碳排放因子（生态环境部2022年度公布值）

// 逐月占比：电耗呈夏季制冷、冬季供暖双峰；光伏春秋季偏高（荒漠区资源特征），各自合计为 1
const ELEC_W = [0.075, 0.072, 0.078, 0.078, 0.082, 0.088, 0.098, 0.097, 0.084, 0.078, 0.08, 0.09];
const PV_W = [0.065, 0.07, 0.09, 0.095, 0.105, 0.1, 0.1, 0.095, 0.09, 0.08, 0.06, 0.05];

function useCountUp(target: number, decimals = 1, duration = 900) {
  const [val, setVal] = useState(0);
  useEffect(() => {
    const t0 = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const p = Math.min((now - t0) / duration, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      setVal(target * eased);
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return val.toFixed(decimals);
}

function KpiValue({ target, decimals = 1, unit }: { target: number; decimals?: number; unit: string }) {
  const text = useCountUp(target, decimals);
  return (
    <div className="emp-kpi-value">
      <strong>{text}</strong>
      <span>{unit}</span>
    </div>
  );
}

export default function EnergyMonitorPanel() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setMounted(true), 60);
    return () => window.clearTimeout(t);
  }, []);

  // 全部派生指标由边界条件按标准公式计算，不单独杜撰
  const calc = useMemo(() => {
    const annualKwh = BUILDING_AREA * EUI_DESIGN; // 年用电量 kWh
    const annualTce = (annualKwh * COAL_FACTOR) / 1000; // 年综合能耗 tce
    const pvKwh = PV_CAPACITY * PV_HOURS; // 光伏年发电量 kWh
    const greenRate = pvKwh / annualKwh; // 绿电占比
    const annualWater = BUILDING_AREA * WATER_PER_AREA; // 年用水量 m³
    const reuseWater = annualWater * REUSE_RATE; // 中水年回用量 m³
    const co2Saved = (pvKwh / 1000) * CO2_FACTOR; // 光伏年减碳 tCO₂
    return { annualKwh, annualTce, pvKwh, greenRate, annualWater, reuseWater, co2Saved };
  }, []);

  const kpis = [
    { icon: "energy_savings_leaf", label: "年综合能耗", target: calc.annualTce, decimals: 1, unit: "tce", sub: `折标煤 ${COAL_FACTOR} kgce/kWh` },
    { icon: "speed", label: "单位面积电耗", target: EUI_DESIGN, decimals: 0, unit: "kWh/(m²·a)", sub: `建筑面积 ${BUILDING_AREA.toLocaleString()} m²` },
    { icon: "bolt", label: "年用电量", target: calc.annualKwh / 10000, decimals: 1, unit: "万kWh", sub: "面积 × 能耗指标测算" },
    { icon: "solar_power", label: "光伏年发电", target: calc.pvKwh / 10000, decimals: 1, unit: "万kWh", sub: `${PV_CAPACITY} kWp × ${PV_HOURS} h` },
    { icon: "recycling", label: "中水年回用", target: calc.reuseWater, decimals: 0, unit: "m³", sub: `回用率 ${Math.round(REUSE_RATE * 100)}%` },
    { icon: "co2", label: "年减碳量", target: calc.co2Saved, decimals: 1, unit: "tCO₂", sub: `因子 ${CO2_FACTOR} tCO₂/MWh` },
  ];

  const months = useMemo(
    () =>
      ELEC_W.map((w, i) => ({
        label: `${i + 1}月`,
        elec: (calc.annualKwh * w) / 10000, // 万kWh
        pv: (calc.pvKwh * PV_W[i]) / 10000, // 万kWh
      })),
    [calc],
  );
  const maxElec = Math.max(...months.map((m) => m.elec));

  const gridKwh = calc.annualKwh - calc.pvKwh;
  const tapWater = calc.annualWater - calc.reuseWater;

  return (
    <section className="resource-monitor emp-panel" aria-label="能耗与碳排分析">
      <div className="monitor-head">
        <div>
          <h3>
            <span className="material-symbols-outlined">monitoring</span>
            能耗与碳排分析
          </h3>
          <p>博物馆类公共建筑 · 总建筑面积 {BUILDING_AREA.toLocaleString()} m² · 光伏 {PV_CAPACITY} kWp · 中水回用</p>
        </div>
        <div className="monitor-head-actions">
          <span className="monitor-normal">测算口径合规</span>
        </div>
      </div>

      <div className="emp-kpi-grid">
        {kpis.map((k) => (
          <article key={k.label} className="emp-kpi">
            <header>
              <span className="material-symbols-outlined">{k.icon}</span>
              <em>{k.label}</em>
            </header>
            <KpiValue target={k.target} decimals={k.decimals} unit={k.unit} />
            <footer>{k.sub}</footer>
          </article>
        ))}
      </div>

      <div className="emp-body">
        <div className="emp-chart">
          <div className="emp-chart-head">
            <h4>逐月电耗与光伏发电</h4>
            <div className="emp-legend">
              <span><i className="emp-dot elec" />电耗(万kWh)</span>
              <span><i className="emp-dot pv" />光伏发电(万kWh)</span>
            </div>
          </div>
          <div className="emp-months">
            {months.map((m, i) => (
              <div key={m.label} className="emp-month">
                <div className="emp-bars">
                  <span
                    className="emp-bar elec"
                    title={`${m.label} 电耗 ${m.elec.toFixed(2)} 万kWh`}
                    style={{ height: mounted ? `${(m.elec / maxElec) * 100}%` : "0%", transitionDelay: `${i * 45}ms` }}
                  />
                  <span
                    className="emp-bar pv"
                    title={`${m.label} 光伏发电 ${m.pv.toFixed(2)} 万kWh`}
                    style={{ height: mounted ? `${(m.pv / maxElec) * 100}%` : "0%", transitionDelay: `${i * 45 + 60}ms` }}
                  />
                </div>
                <em>{m.label}</em>
              </div>
            ))}
          </div>
        </div>

        <div className="emp-share">
          <div className="emp-share-block">
            <h4>电力结构（年）</h4>
            <div className="emp-share-bar">
              <span className="emp-seg grid" style={{ width: mounted ? `${(gridKwh / calc.annualKwh) * 100}%` : "0%" }} />
              <span className="emp-seg pv" style={{ width: mounted ? `${calc.greenRate * 100}%` : "0%" }} />
            </div>
            <div className="emp-share-legend">
              <span><i className="emp-dot grid" />市电 {(gridKwh / 10000).toFixed(1)} 万kWh · {(100 - calc.greenRate * 100).toFixed(1)}%</span>
              <span><i className="emp-dot pv" />光伏自用 {(calc.pvKwh / 10000).toFixed(1)} 万kWh · {(calc.greenRate * 100).toFixed(1)}%</span>
            </div>
          </div>
          <div className="emp-share-block">
            <h4>供水结构（年）</h4>
            <div className="emp-share-bar">
              <span className="emp-seg tap" style={{ width: mounted ? `${(tapWater / calc.annualWater) * 100}%` : "0%" }} />
              <span className="emp-seg reuse" style={{ width: mounted ? `${REUSE_RATE * 100}%` : "0%" }} />
            </div>
            <div className="emp-share-legend">
              <span><i className="emp-dot tap" />市政自来水 {tapWater.toFixed(0)} m³ · {((1 - REUSE_RATE) * 100).toFixed(0)}%</span>
              <span><i className="emp-dot reuse" />中水回用 {calc.reuseWater.toFixed(0)} m³ · {Math.round(REUSE_RATE * 100)}%</span>
            </div>
          </div>
          <p className="emp-note">
            年用水量 {(calc.annualWater / 10000).toFixed(2)} 万m³，中水回用年节水 {calc.reuseWater.toFixed(0)} m³；
            光伏年发电占用电量 {(calc.greenRate * 100).toFixed(1)}%，余量由市政电网补充。
          </p>
        </div>
      </div>

      <footer className="emp-standards">
        <span>
          测算依据：GB/T 51161-2016《民用建筑能耗标准》 · GB/T 2589-2020《综合能耗计算通则》 · GB 50797-2012《光伏发电站设计规范》 ·
          GB 50015-2019《建筑给水排水设计标准》 · GB 50336-2018《建筑中水设计标准》 · 全国电力平均CO₂排放因子（生态环境部2022年度）
        </span>
        <em>本面板数据为依据上述标准方法测算的示例值，正式数据以项目能耗计算书及实际计量为准</em>
      </footer>
    </section>
  );
}
