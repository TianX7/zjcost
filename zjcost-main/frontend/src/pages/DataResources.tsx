import { useEffect, useState } from "react";
import Panel from "../components/Panel";
import QuotaLibrary from "./QuotaLibrary";
import PriceManagement from "./PriceManagement";
import { api } from "../api";
import "../styles/resource-screen.css";

// 左侧资源分类：只保留两类真实数据源，避免与顶部导航重复入口
const RESOURCE_CATEGORIES = [
  {
    key: "quota",
    icon: "menu_book",
    label: "定额与工料机",
    desc: "定额条目 · 工料机消耗",
    panelTitle: "定额数据表",
  },
  {
    key: "price",
    icon: "payments",
    label: "市场价信息",
    desc: "材料价格 · 采集来源",
    panelTitle: "材料价格表",
  },
] as const;

type CategoryKey = (typeof RESOURCE_CATEGORIES)[number]["key"];

interface ResourceMetrics {
  quota: number;
  prices: number;
  rules: number;
  updatedAt: string;
}

export default function DataResources() {
  const [activeKey, setActiveKey] = useState<CategoryKey>("quota");
  const [metrics, setMetrics] = useState<ResourceMetrics>({ quota: 0, prices: 0, rules: 0, updatedAt: "-" });

  // 摘要指标复用既有接口，不新增后端能力
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api.getQuotaStats().catch(() => null),
      api.listMaterialPrices({ latest_only: true }).catch(() => []),
      api.listRulePackages().catch(() => []),
    ]).then(([stats, prices, rules]) => {
      if (cancelled) return;
      const sortedDates = prices
        .map((item) => item.effective_date)
        .filter(Boolean)
        .sort();
      const latest = sortedDates[sortedDates.length - 1];
      setMetrics({
        quota: stats?.total ?? 0,
        prices: prices.length,
        rules: rules.length,
        updatedAt: latest || "-",
      });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const active = RESOURCE_CATEGORIES.find((item) => item.key === activeKey) ?? RESOURCE_CATEGORIES[0];

  return (
    <div className="page-container res-page">
      {/* 摘要指标带 */}
      <div className="screen-metrics">
        <div className="screen-metric">
          <span className="material-symbols-outlined screen-metric-icon">menu_book</span>
          <div className="screen-metric-body">
            <span className="screen-metric-label">定额条目</span>
            <span className="screen-metric-value">
              {metrics.quota.toLocaleString("zh-CN")}
              <span className="screen-metric-unit">条</span>
            </span>
          </div>
        </div>
        <div className="screen-metric">
          <span className="material-symbols-outlined screen-metric-icon">payments</span>
          <div className="screen-metric-body">
            <span className="screen-metric-label">材料价格</span>
            <span className="screen-metric-value">
              {metrics.prices.toLocaleString("zh-CN")}
              <span className="screen-metric-unit">条</span>
            </span>
          </div>
        </div>
        <div className="screen-metric is-amber">
          <span className="material-symbols-outlined screen-metric-icon">tune</span>
          <div className="screen-metric-body">
            <span className="screen-metric-label">规则包</span>
            <span className="screen-metric-value">
              {metrics.rules}
              <span className="screen-metric-unit">个</span>
            </span>
          </div>
        </div>
        <div className="screen-metric">
          <span className="material-symbols-outlined screen-metric-icon">update</span>
          <div className="screen-metric-body">
            <span className="screen-metric-label">价格更新时间</span>
            <span className="screen-metric-value">{metrics.updatedAt}</span>
          </div>
        </div>
      </div>

      <div className="res-split">
        {/* 左分类面板 */}
        <Panel title="资源分类" icon="category" className="res-side" bodyClassName="res-side-body">
          {RESOURCE_CATEGORIES.map((item) => (
            <button
              key={item.key}
              type="button"
              className={`res-nav-item${activeKey === item.key ? " active" : ""}`}
              onClick={() => setActiveKey(item.key)}
            >
              <span className="material-symbols-outlined">{item.icon}</span>
              <span className="res-nav-text">
                <span className="res-nav-label">{item.label}</span>
                <span className="res-nav-desc">{item.desc}</span>
              </span>
            </button>
          ))}
          <p className="res-note">
            定额与市场价是清单计价的底层数据，修改后会在下次计价时生效。旧材利用定额请从顶部“资源”菜单进入。
          </p>
        </Panel>

        {/* 右数据表格面板 */}
        <Panel
          title={active.panelTitle}
          icon={active.icon}
          live
          flush
          className="res-main"
          extra={<span>当前分类：{active.label}</span>}
        >
          <div className="res-embed">
            {activeKey === "quota" ? <QuotaLibrary /> : <PriceManagement />}
          </div>
        </Panel>
      </div>
    </div>
  );
}
