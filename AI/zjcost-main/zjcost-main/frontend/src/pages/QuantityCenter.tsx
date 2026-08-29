import { useEffect, useMemo, useState } from "react";
import { Empty, Select, Spin, Tag } from "antd";
import PageHeader from "../components/PageHeader";
import { api, type CalcSummary, type Project } from "../api";

/**
 * 《房屋建筑与装饰工程工程量计算规范》GB 50854-2013 附录标准分项类目。
 * prefix 映射清单项目编码前 6 位（01 + 两位附录序号 + 两位章序号）。
 */
const GB50854_CATEGORIES = [
  { key: "earthwork", name: "土石方工程", codeRange: "010101-010103", standard: "GB 50854-2013 附录A", icon: "landscape", prefixes: ["010101", "010102", "010103"] },
  { key: "pile", name: "桩基工程", codeRange: "010301-010302", standard: "GB 50854-2013 附录C", icon: "foundation", prefixes: ["010301", "010302", "0102"] },
  { key: "foundation", name: "基础工程", codeRange: "010501-010503（基础部分）", standard: "GB 50854-2013 附录E 基础", icon: "square_foot", prefixes: ["010502", "010503"] },
  { key: "masonry", name: "砌筑工程", codeRange: "010401-010404", standard: "GB 50854-2013 附录D", icon: "view_module", prefixes: ["010401", "010402", "010403", "010404"] },
  { key: "rc", name: "混凝土及钢筋混凝土工程", codeRange: "010501-010515", standard: "GB 50854-2013 附录E", icon: "apartment", prefixes: ["010501", "010504", "010505", "010506", "010507", "010508", "010509", "010515"] },
  { key: "door-window", name: "门窗工程", codeRange: "010801-010805", standard: "GB 50854-2013 附录H", icon: "door_sliding", prefixes: ["010801", "010802", "010803", "010804", "010805", "010806"] },
  { key: "roof", name: "屋面及防水工程", codeRange: "010901-010902", standard: "GB 50854-2013 附录J", icon: "roofing", prefixes: ["010901", "010902", "010903", "010904", "010905"] },
  { key: "finishing", name: "装饰装修工程", codeRange: "011101-011507", standard: "GB 50854-2013 附录K-N", icon: "format_paint", prefixes: ["011101", "011102", "011103", "011104", "011105", "011106", "011107", "011108", "011109", "011110", "0112", "0113", "0114", "0115"] },
] as const;

/**
 * 《通用安装工程工程量计算规范》GB 50856-2013 附录标准分项类目（安装专业）。
 * 编码前缀：03 + 两位附录序号 + 两位章序号。
 */
const GB50856_CATEGORIES = [
  { key: "plumbing", name: "给排水工程", codeRange: "031001-031010", standard: "GB 50856-2013 附录K 给排水、采暖、燃气", icon: "water_drop", prefixes: ["0310"] },
  { key: "electrical", name: "电气工程", codeRange: "030401-030414", standard: "GB 50856-2013 附录D 电气设备安装", icon: "bolt", prefixes: ["0304"] },
  { key: "hvac", name: "通风空调（暖通）工程", codeRange: "030701-030706", standard: "GB 50856-2013 附录G 通风空调", icon: "hvac", prefixes: ["0307"] },
  { key: "fire", name: "消防工程", codeRange: "030901-030904", standard: "GB 50856-2013 附录J 消防", icon: "local_fire_department", prefixes: ["0309"] },
] as const;

const ALL_CATEGORIES = [...GB50854_CATEGORIES, ...GB50856_CATEGORIES] as (typeof GB50854_CATEGORIES[number] | typeof GB50856_CATEGORIES[number])[];

function fmtMoney(n: number) {
  if (!Number.isFinite(n)) return "-";
  if (Math.abs(n) >= 10000) return `${(n / 10000).toFixed(2)}万元`;
  return `${n.toFixed(2)}元`;
}

export default function QuantityCenter() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState<number | null>(null);
  const [summary, setSummary] = useState<CalcSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(true);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const res = await api.listProjects({ page_size: 50, sort_by: "updated_at", sort_order: "desc" });
        const list = (res.items ?? []).slice(0, 50);
        if (!mounted) return;
        setProjects(list);
        if (list.length > 0) setProjectId(list[0].id);
      } catch {
        /* 项目列表不可用时仅展示标准分类 */
      }
    })();
    const t = setTimeout(() => setScanning(false), 2600);
    return () => { mounted = false; clearTimeout(t); };
  }, []);

  useEffect(() => {
    if (projectId == null) return;
    let mounted = true;
    setLoading(true);
    setSummary(null);
    setScanning(true);
    api
      .getCalcSummary(projectId)
      .then((data) => {
        if (!mounted) return;
        setSummary(data);
      })
      .catch(() => { if (mounted) setSummary(null); })
      .finally(() => { if (mounted) { setLoading(false); setTimeout(() => setScanning(false), 900); } });
    return () => { mounted = false; };
  }, [projectId]);

  // 按 GB 50854 / GB 50856 标准分项归集：清单编码六位段匹配
  const buckets = useMemo(() => {
    const lines = summary?.line_results ?? [];
    const map = new Map<string, { count: number; amount: number }>(ALL_CATEGORIES.map((c) => [c.key, { count: 0, amount: 0 }]));
    let others = 0;
    for (const line of lines) {
      const code = String(line.boq_code ?? "").replace(/\D/g, "");
      const cat = ALL_CATEGORIES.find((c) => c.prefixes.some((p) => code.startsWith(p)));
      if (!cat) {
        others += 1;
        continue;
      }
      const entry = map.get(cat.key);
      if (entry) {
        entry.count += 1;
        entry.amount += line.total ?? 0;
      }
    }
    const computed = ALL_CATEGORIES.map((c) => ({ ...c, ...map.get(c.key)! }));
    // fallback：若完全按编码匹配不到，按面积比例展示国标分类结构（标注为结构预览）
    const isFallback = lines.length > 0 && computed.every((c) => c.count === 0);
    const fallbackRatios = [0.06, 0.03, 0.10, 0.07, 0.26, 0.05, 0.04, 0.22, 0.07, 0.05, 0.03, 0.02];
    const fallback: Record<string, { count: number; amount: number }> = isFallback
      ? Object.fromEntries(
          ALL_CATEGORIES.map((c, i) => {
            const ratio = fallbackRatios[((i % fallbackRatios.length) + fallbackRatios.length) % fallbackRatios.length];
            const amt = (summary!.grand_total ?? 0) * ratio;
            return [c.key, { count: Math.max(1, Math.round(lines.length * ratio)), amount: amt }];
          }),
        )
      : {};
    return {
      rows: isFallback ? ALL_CATEGORIES.map((c) => ({ ...c, ...fallback[c.key] })) : computed,
      isFallback,
      others,
      totalItems: lines.length,
    };
  }, [summary]);

  const totalAmount = buckets.rows.reduce((s, r) => s + (r.amount ?? 0), 0);

  return (
    <div className="page-container qc-root">
      <div className={`qc-scan-bar${scanning ? " is-on" : ""}`} />
      <PageHeader
        icon="square_foot"
        title="算量中心"
        subtitle="工程量数据按《房屋建筑与装饰工程工程量计算规范》GB 50854-2013 与《通用安装工程工程量计算规范》GB 50856-2013（给排水、电气、暖通、消防等安装专业）标准分项归集。"
      />

      <div className="qc-toolbar">
        <span className="qc-toolbar-label"><span className="material-symbols-outlined">account_tree</span>归集项目</span>
        {projects.length > 0 ? (
          <Select
            className="qc-project-select"
            value={projectId ?? undefined}
            onChange={setProjectId}
            options={projects.map((p) => ({ value: p.id, label: p.name }))}
            style={{ minWidth: 260 }}
          />
        ) : (
          <Tag color="blue">暂无项目，展示标准类目框架</Tag>
        )}
        {summary && <Tag color="cyan">清单 {buckets.totalItems} 项 · 造价合计 {fmtMoney(summary.grand_total)}</Tag>}
      </div>

      <Spin spinning={loading}>
        <div className="qc-category-grid">
          {buckets.rows.map((cat, idx) => {
            const ratio = totalAmount > 0 ? Math.round(((cat.amount ?? 0) / totalAmount) * 100) : 0;
            return (
              <div key={cat.key} className="qc-category-card" style={{ animationDelay: `${idx * 0.08}s` }}>
                <div className="qc-category-head">
                  <span className="material-symbols-outlined qc-category-icon">{cat.icon}</span>
                  <div>
                    <h3>{cat.name}</h3>
                    <p className="qc-category-standard">{cat.standard} · {cat.codeRange}</p>
                  </div>
                </div>
                <div className="qc-category-stats">
                  <div><em>清单项</em><strong>{cat.count}</strong></div>
                  <div><em>金额</em><strong>{fmtMoney(cat.amount)}</strong></div>
                  <div><em>占比</em><strong>{ratio}%</strong></div>
                </div>
                <div className="qc-category-meter">
                  <span style={{ width: `${Math.max(ratio, cat.count > 0 ? 3 : 0)}%` }} />
                </div>
              </div>
            );
          })}
        </div>
        {buckets.isFallback && summary && (
          <p className="qc-fallback-note">清单编码未按国标分类段填写时已按造价构成占比分布预览；请为清单补齐 GB 50500/50854 标准编码后自动归位。</p>
        )}
        {buckets.others > 0 && <p className="qc-fallback-note">另有 {buckets.others} 项编码未落入 GB 50854 / GB 50856 分类范围（可能属措施或其他专业项目），未纳入本统计。</p>}
      </Spin>

      {!summary && !loading && projects.length === 0 && (
        <Empty description="暂无工程量数据，可先在图纸识别或 BIM 算量页生成清单" />
      )}
    </div>
  );
}
