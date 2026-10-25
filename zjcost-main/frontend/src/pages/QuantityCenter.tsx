import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Empty, Input, Modal, Select, Space, Table, Tag, Typography, message } from "antd";
import { DownloadOutlined, EditOutlined, ReloadOutlined } from "@ant-design/icons";
import Panel from "../components/Panel";
import { api, type CalcSummary, type LineCalcResult, type Project } from "../api";
import "../styles/business-screen.css";

/**
 * 《房屋建筑与装饰工程工程量计算标准》GB/T 50854-2024 附录标准分项类目。
 * prefix 映射清单项目编码前 6 位（01 + 两位附录序号 + 两位章序号）。
 */
const GB50854_CATEGORIES = [
  { key: "earthwork", name: "土石方工程", codeRange: "010101-010103", standard: "GB/T 50854-2024 附录A", icon: "landscape", prefixes: ["010101", "010102", "010103"] },
  { key: "pile", name: "桩基工程", codeRange: "010301-010302", standard: "GB/T 50854-2024 附录C", icon: "foundation", prefixes: ["010301", "010302", "0102"] },
  { key: "foundation", name: "基础工程", codeRange: "010501-010503（基础部分）", standard: "GB/T 50854-2024 附录E 基础", icon: "square_foot", prefixes: ["010502", "010503"] },
  { key: "masonry", name: "砌筑工程", codeRange: "010401-010404", standard: "GB/T 50854-2024 附录D", icon: "view_module", prefixes: ["010401", "010402", "010403", "010404"] },
  { key: "rc", name: "混凝土及钢筋混凝土工程", codeRange: "010501-010515", standard: "GB/T 50854-2024 附录E", icon: "apartment", prefixes: ["010501", "010504", "010505", "010506", "010507", "010508", "010509", "010515"] },
  { key: "door-window", name: "门窗工程", codeRange: "010801-010805", standard: "GB/T 50854-2024 附录H", icon: "door_sliding", prefixes: ["010801", "010802", "010803", "010804", "010805", "010806"] },
  { key: "roof", name: "屋面及防水工程", codeRange: "010901-010902", standard: "GB/T 50854-2024 附录J", icon: "roofing", prefixes: ["010901", "010902", "010903", "010904", "010905"] },
  { key: "finishing", name: "装饰装修工程", codeRange: "011101-011507", standard: "GB/T 50854-2024 附录K-N", icon: "format_paint", prefixes: ["011101", "011102", "011103", "011104", "011105", "011106", "011107", "011108", "011109", "011110", "0112", "0113", "0114", "0115"] },
] as const;

/**
 * 《通用安装工程工程量计算标准》GB/T 50856-2024 附录标准分项类目（安装专业）。
 * 编码前缀：03 + 两位附录序号 + 两位章序号。
 */
const GB50856_CATEGORIES = [
  { key: "plumbing", name: "给排水工程", codeRange: "031001-031010", standard: "GB/T 50856-2024 附录K 给排水、采暖、燃气", icon: "water_drop", prefixes: ["0310"] },
  { key: "electrical", name: "电气工程", codeRange: "030401-030414", standard: "GB/T 50856-2024 附录D 电气设备安装", icon: "bolt", prefixes: ["0304"] },
  { key: "hvac", name: "通风空调（暖通）工程", codeRange: "030701-030706", standard: "GB/T 50856-2024 附录G 通风空调", icon: "hvac", prefixes: ["0307"] },
  { key: "fire", name: "消防工程", codeRange: "030901-030904", standard: "GB/T 50856-2024 附录J 消防", icon: "local_fire_department", prefixes: ["0309"] },
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

  // ── 就地修编码：纠正编码后进行国标归集 ──
  const [editItem, setEditItem] = useState<LineCalcResult | null>(null);
  const [editValue, setEditValue] = useState("");
  const [editSaving, setEditSaving] = useState(false);

  const openEditCode = (line: LineCalcResult) => {
    setEditItem(line);
    setEditValue(line.boq_code ?? "");
  };

  const saveCode = async () => {
    if (projectId == null || editItem == null) return;
    const code = editValue.trim();
    if (!code) {
      message.error("编码不能为空");
      return;
    }
    setEditSaving(true);
    try {
      await api.updateBoqItem(projectId, editItem.boq_item_id, { code });
      message.success(`已更新编码：${editItem.boq_code} → ${code}（归集后即自动归位）`);
      setEditItem(null);
      await reload();
    } catch (err) {
      message.error(err instanceof Error ? err.message : "更新编码失败");
    } finally {
      setEditSaving(false);
    }
  };

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

  const unmatchedAmount = buckets.unmatched.reduce((sum, line) => sum + (line.total ?? 0), 0);
  const topCategories = [...buckets.rows].sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0)).slice(0, 3);
  const coverage = buckets.totalItems > 0 ? Math.round((buckets.matched / buckets.totalItems) * 100) : 0;

  return (
    <div className="page-container qc-root bs-screen-page">
      <div className="bs-summary-strip">
        <div className="bs-summary-item is-cyan">
          <span className="bs-summary-label">清单总数</span>
          <strong className="bs-summary-value num">{buckets.totalItems}</strong>
          <span className="bs-summary-hint">当前归集项目</span>
        </div>
        <div className="bs-summary-item is-green">
          <span className="bs-summary-label">已归集</span>
          <strong className="bs-summary-value num">{buckets.matched}</strong>
          <span className="bs-summary-hint">命中 GB 50854 / 50856 分类段</span>
        </div>
        <div className={`bs-summary-item ${buckets.unmatched.length > 0 ? "is-red" : "is-green"}`}>
          <span className="bs-summary-label">未落入分类</span>
          <strong className="bs-summary-value num">{buckets.unmatched.length}</strong>
          <span className="bs-summary-hint">需补齐国标编码</span>
        </div>
        <div className="bs-summary-item is-amber">
          <span className="bs-summary-label">造价合计</span>
          <strong className="bs-summary-value num">{summary ? fmtMoney(summary.grand_total) : "-"}</strong>
          <span className="bs-summary-hint">随重新计价更新</span>
        </div>
        <div className="bs-summary-item is-cyan">
          <span className="bs-summary-label">归集项目</span>
          <strong className="bs-summary-value">{projectName || "未选择"}</strong>
          <span className="bs-summary-hint">共 {projects.length} 个可选项目</span>
        </div>
      </div>

      <div className="bs-two-col">
        <div className="bs-col-stack">
          <Panel
            title="标准分项归集"
            icon="square_foot"
            extra={<span>GB/T 50854-2024 · GB/T 50856-2024</span>}
            flush
            bodyClassName="bs-panel-table"
          >
            {summary && allUnmatched && (
              <div className="bs-panel-inset">
                <div className="bs-alert warn">
                  <span className="material-symbols-outlined">warning</span>
                  <span>编码未按国标分类段填写，无法归集。当前项目清单编码均未命中 GB 50854 / GB 50856 分类段，各分类如实显示为 0，请补齐国标编码后自动归位。</span>
                </div>
              </div>
            )}
            <Table
              rowKey="key"
              size="small"
              loading={loading}
              dataSource={buckets.rows}
              pagination={false}
              scroll={{ x: 720 }}
              locale={{
                emptyText: (
                  <Empty description="暂无工程量数据，可先在图纸识别或 BIM 算量页生成清单" />
                ),
              }}
              columns={[
                {
                  title: "标准分项",
                  dataIndex: "name",
                  render: (value: string, cat) => (
                    <div>
                      <Button type="link" style={{ padding: 0, height: "auto" }} disabled={projectId == null} onClick={openBoq}>
                        {value}
                      </Button>
                      <span className="bs-cell-sub">{cat.standard}</span>
                    </div>
                  ),
                },
                { title: "编码范围", dataIndex: "codeRange", width: 190 },
                { title: "清单项", dataIndex: "count", width: 90, align: "right", render: (value: number) => <span className="num">{value}</span> },
                { title: "金额", dataIndex: "amount", width: 140, align: "right", render: (value: number) => <span className="num">{fmtMoney(value)}</span> },
                {
                  title: "占比",
                  key: "ratio",
                  width: 150,
                  render: (_, cat) => {
                    const ratio = totalAmount > 0 ? Math.round(((cat.amount ?? 0) / totalAmount) * 100) : 0;
                    return (
                      <div className="bs-ratio">
                        <span className="num">{ratio}%</span>
                        <div className="qc-category-meter">
                          <span style={{ width: `${Math.max(ratio, cat.count > 0 ? 3 : 0)}%` }} />
                        </div>
                      </div>
                    );
                  },
                },
              ]}
            />
          </Panel>

          {buckets.unmatched.length > 0 && (
            <Panel
              title={`未落入分类的清单（${buckets.unmatched.length} 项）`}
              icon="warning"
              extra={<span>疑似编码归类段未按国标填写</span>}
              flush
              bodyClassName="bs-panel-table"
            >
              <Table
                rowKey="boq_item_id"
                size="small"
                dataSource={buckets.unmatched}
                pagination={{ pageSize: 8, showTotal: (t) => `共 ${t} 项` }}
                scroll={{ x: 560 }}
                columns={[
                  { title: "编码", dataIndex: "boq_code", width: 130, ellipsis: true },
                  { title: "名称", dataIndex: "boq_name", ellipsis: true },
                  { title: "合价", dataIndex: "total", width: 140, align: "right", render: (v: number) => <span className="num">{fmtMoney(v ?? 0)}</span> },
                  {
                    title: "操作",
                    key: "actions",
                    width: 120,
                    render: (_, row) => (
                      <Button size="small" icon={<EditOutlined />} onClick={() => openEditCode(row)}>修编码</Button>
                    ),
                  },
                ]}
              />
            </Panel>
          )}
        </div>

        <div className="bs-col-stack">
          <Panel title="项目与导入" icon="account_tree">
            <div className="bs-filter">
              <label className="bs-field">
                <span className="bs-field-label">归集项目</span>
                {projects.length > 0 ? (
                  <Select
                    className="qc-project-select"
                    value={projectId ?? undefined}
                    onChange={setProjectId}
                    options={projects.map((p) => ({ value: p.id, label: p.name }))}
                    showSearch
                    optionFilterProp="label"
                    placeholder="选择项目"
                  />
                ) : (
                  <Tag color="blue">暂无项目，展示标准类目框架</Tag>
                )}
              </label>
            </div>
            <Space wrap style={{ marginTop: 12 }}>
              <Button icon={<ReloadOutlined />} loading={loading} onClick={reload}>刷新</Button>
              <Button icon={<DownloadOutlined />} disabled={!summary} onClick={exportCsv}>导出 CSV</Button>
            </Space>
            <p className="bs-section-note" style={{ marginTop: 10 }}>
              工程量按 GB/T 50854-2024 与 GB/T 50856-2024 标准分项归集，配套安装专业给排水、电气、暖通与消防。
            </p>
          </Panel>

          <Panel title="归集汇总" icon="summarize">
            <div className="bs-kv-list">
              <div className="bs-kv-row"><span>归集覆盖率</span><strong>{coverage}%</strong></div>
              <div className="bs-kv-row"><span>已归集金额</span><strong className="num">{fmtMoney(totalAmount)}</strong></div>
              <div className="bs-kv-row"><span>未落入金额</span><strong className="num">{fmtMoney(unmatchedAmount)}</strong></div>
            </div>
            <div className="bs-kv-list" style={{ marginTop: 8 }}>
              {topCategories.map((cat) => {
                const ratio = totalAmount > 0 ? Math.round(((cat.amount ?? 0) / totalAmount) * 100) : 0;
                return (
                  <div className="bs-kv-row" key={cat.key}>
                    <span>{cat.name}</span>
                    <strong>{fmtMoney(cat.amount)} · {ratio}%</strong>
                  </div>
                );
              })}
            </div>
            <p className="bs-section-note" style={{ marginTop: 10 }}>
              未落入分类的清单不计入标准分项金额，修正编码后金额随重新计价更新。
            </p>
          </Panel>
        </div>
      </div>

      {/* 就地修编码 Modal */}
      <Modal
        title={`修编码 · ${editItem?.boq_name ?? ""}`}
        open={editItem != null}
        onCancel={() => setEditItem(null)}
        onOk={saveCode}
        okText="保存并重新归集"
        confirmLoading={editSaving}
        width={480}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 6 }}>
          <div>
            <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 4 }}>原编码（无法归入 GB 50854 / GB 50856 分类段）</div>
            <Tag color="red">{editItem?.boq_code ?? ""}</Tag>
          </div>
          <div>
            <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 4 }}>新编码（按国标项目编码前 6 位填写，如 010401、031001）</div>
            <Input
              value={editValue}
              onChange={(event) => setEditValue(event.target.value)}
              placeholder="输入国标清单编码"
              maxLength={20}
              onPressEnter={() => void saveCode()}
            />
          </div>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            保存后该条清单将以新编码重新归集至对应分类，并标记待重新计价。
          </Typography.Text>
        </div>
      </Modal>
    </div>
  );
}
