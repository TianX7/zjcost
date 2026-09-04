import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Alert, Button, Empty, Select, Space, Spin, Table, Tag, Typography } from "antd";
import { DownloadOutlined, ReloadOutlined } from "@ant-design/icons";
import PageHeader from "../components/PageHeader";
import { api, type CalcSummary, type LineCalcResult, type Project } from "../api";

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
  const navigate = useNavigate();
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState<number | null>(null);
  const [summary, setSummary] = useState<CalcSummary | null>(null);
  const [loading, setLoading] = useState(false);

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
    return () => { mounted = false; };
  }, []);

  const reload = async () => {
    if (projectId == null) return;
    setLoading(true);
    try {
      setSummary(await api.getCalcSummary(projectId));
    } catch {
      setSummary(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (projectId == null) return;
    let mounted = true;
    setLoading(true);
    setSummary(null);
    api
      .getCalcSummary(projectId)
      .then((data) => { if (mounted) setSummary(data); })
      .catch(() => { if (mounted) setSummary(null); })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, [projectId]);

  // 按 GB 50854 / GB 50856 标准分项归集：清单编码六位段匹配。
  // 诚实口径：匹配不上的如实列为“未落入”，绝不按比例编造分布。
  const buckets = useMemo(() => {
    const lines = summary?.line_results ?? [];
    const map = new Map<string, { count: number; amount: number }>(ALL_CATEGORIES.map((c) => [c.key, { count: 0, amount: 0 }]));
    const unmatched: LineCalcResult[] = [];
    for (const line of lines) {
      const code = String(line.boq_code ?? "").replace(/\D/g, "");
      const cat = ALL_CATEGORIES.find((c) => c.prefixes.some((p) => code.startsWith(p)));
      if (!cat) {
        unmatched.push(line);
        continue;
      }
      const entry = map.get(cat.key);
      if (entry) {
        entry.count += 1;
        entry.amount += line.total ?? 0;
      }
    }
    const rows = ALL_CATEGORIES.map((c) => ({ ...c, ...map.get(c.key)! }));
    const matched = lines.length - unmatched.length;
    return { rows, unmatched, matched, totalItems: lines.length };
  }, [summary]);

  const totalAmount = buckets.rows.reduce((s, r) => s + (r.amount ?? 0), 0);
  const projectName = projects.find((p) => p.id === projectId)?.name ?? "";
  const allUnmatched = buckets.totalItems > 0 && buckets.matched === 0;

  const openBoq = () => {
    if (projectId != null) navigate(`/projects/${projectId}?tab=boq`);
  };

  const exportCsv = () => {
    const head = "分类,编码范围,清单项数,金额(元),占比(%)";
    const lines = buckets.rows.map((r) => {
      const ratio = totalAmount > 0 ? Math.round(((r.amount ?? 0) / totalAmount) * 100) : 0;
      return `${r.name},${r.codeRange},${r.count},${(r.amount ?? 0).toFixed(2)},${ratio}`;
    });
    lines.push(`未落入分类,,${buckets.unmatched.length},${buckets.unmatched.reduce((s, l) => s + (l.total ?? 0), 0).toFixed(2)},`);
    const blob = new Blob(["\uFEFF" + [head, ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `算量归集_${projectName || "全部"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="page-container qc-root">
      <PageHeader
        icon="square_foot"
        title="算量中心"
        subtitle="工程量数据按《房屋建筑与装饰工程工程量计算规范》GB 50854-2013 与《通用安装工程工程量计算规范》GB 50856-2013（给排水、电气、暖通、消防等安装专业）标准分项归集。"
      />

      <div className="qc-toolbar">
        <Space wrap>
          <span className="qc-toolbar-label"><span className="material-symbols-outlined">account_tree</span>归集项目</span>
          {projects.length > 0 ? (
            <Select
              className="qc-project-select"
              value={projectId ?? undefined}
              onChange={setProjectId}
              options={projects.map((p) => ({ value: p.id, label: p.name }))}
              style={{ minWidth: 260 }}
              showSearch
              optionFilterProp="label"
              placeholder="选择项目"
            />
          ) : (
            <Tag color="blue">暂无项目，展示标准类目框架</Tag>
          )}
          {summary && <Tag color="blue">清单 {buckets.totalItems} 项 · 造价合计 {fmtMoney(summary.grand_total)}</Tag>}
        </Space>
        <Space wrap>
          <Button icon={<ReloadOutlined />} loading={loading} onClick={reload}>刷新</Button>
          <Button icon={<DownloadOutlined />} disabled={!summary} onClick={exportCsv}>导出 CSV</Button>
        </Space>
      </div>

      {summary && (
        <div className="kpi-grid">
          <div className="kpi-card">
            <span className="material-symbols-outlined kpi-card-icon">list_alt</span>
            <div className="kpi-card-body">
              <span className="kpi-card-label">清单总数</span>
              <span className="kpi-card-value num">{buckets.totalItems}</span>
            </div>
          </div>
          <div className="kpi-card">
            <span className="material-symbols-outlined kpi-card-icon" style={{ color: "#22c55e", background: "rgba(34,197,94,0.12)", borderColor: "rgba(34,197,94,0.2)" }}>check_circle</span>
            <div className="kpi-card-body">
              <span className="kpi-card-label">已归集</span>
              <span className="kpi-card-value num">{buckets.matched}</span>
            </div>
          </div>
          <div className="kpi-card">
            <span
              className="material-symbols-outlined kpi-card-icon"
              style={buckets.unmatched.length > 0
                ? { color: "#f87171", background: "rgba(248,113,113,0.12)", borderColor: "rgba(248,113,113,0.2)" }
                : undefined}
            >
              warning
            </span>
            <div className="kpi-card-body">
              <span className="kpi-card-label">未落入分类</span>
              <span className="kpi-card-value num" style={buckets.unmatched.length > 0 ? { color: "#f87171" } : undefined}>
                {buckets.unmatched.length}
              </span>
            </div>
          </div>
          <div className="kpi-card">
            <span className="material-symbols-outlined kpi-card-icon">payments</span>
            <div className="kpi-card-body">
              <span className="kpi-card-label">造价合计</span>
              <span className="kpi-card-value num">{fmtMoney(summary.grand_total)}</span>
            </div>
          </div>
        </div>
      )}

      {summary && allUnmatched && (
        <Alert
          type="warning"
          showIcon
          message="编码未按国标分类段填写，无法归集"
          description="当前项目清单编码均未命中 GB 50854 / GB 50856 分类段，各分类如实显示为 0。请为清单补齐国标编码后自动归位，切勿按占比估算。"
        />
      )}

      <Spin spinning={loading}>
        <div className="qc-category-grid">
          {buckets.rows.map((cat, idx) => {
            const ratio = totalAmount > 0 ? Math.round(((cat.amount ?? 0) / totalAmount) * 100) : 0;
            return (
              <button
                key={cat.key}
                type="button"
                className="qc-category-card qc-clickable"
                style={{ animationDelay: `${Math.min(idx, 11) * 0.05}s` }}
                onClick={openBoq}
                title={projectId != null ? "点击进入项目清单" : cat.name}
                disabled={projectId == null}
              >
                <div className="qc-category-head">
                  <span className="material-symbols-outlined qc-category-icon">{cat.icon}</span>
                  <div>
                    <h3>{cat.name}</h3>
                    <p className="qc-category-standard">{cat.standard} · {cat.codeRange}</p>
                  </div>
                </div>
                <div className="qc-category-stats">
                  <div><em>清单项</em><strong className="num">{cat.count}</strong></div>
                  <div><em>金额</em><strong className="num">{fmtMoney(cat.amount)}</strong></div>
                  <div><em>占比</em><strong className="num">{ratio}%</strong></div>
                </div>
                <div className="qc-category-meter">
                  <span style={{ width: `${Math.max(ratio, cat.count > 0 ? 3 : 0)}%` }} />
                </div>
              </button>
            );
          })}
        </div>
      </Spin>

      {buckets.unmatched.length > 0 && (
        <div className="content-card">
          <div className="content-card-head">
            <h3 className="content-card-title"><span className="material-symbols-outlined">warning</span>未落入分类的清单（{buckets.unmatched.length} 项）</h3>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>可能属措施或其他专业项目，请核对编码</Typography.Text>
          </div>
          <div className="content-card-body flush">
            <Table
              rowKey="boq_item_id"
              size="small"
              dataSource={buckets.unmatched}
              pagination={{ pageSize: 8, showTotal: (t) => `共 ${t} 项` }}
              columns={[
                { title: "编码", dataIndex: "boq_code", width: 130, ellipsis: true },
                { title: "名称", dataIndex: "boq_name", ellipsis: true },
                { title: "合价", dataIndex: "total", width: 140, align: "right", render: (v: number) => <span className="num">{fmtMoney(v ?? 0)}</span> },
              ]}
            />
          </div>
        </div>
      )}

      {!summary && !loading && projects.length === 0 && (
        <Empty description="暂无工程量数据，可先在图纸识别或 BIM 算量页生成清单" />
      )}
    </div>
  );
}
