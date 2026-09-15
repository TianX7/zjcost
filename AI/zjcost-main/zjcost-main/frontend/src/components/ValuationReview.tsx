import { useCallback, useState } from "react";
import { Button, Empty, Modal, Radio, Spin, Table, Tag, Tooltip, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import type { DrawingValuation, DrawingValuationItem, MatchCandidate } from "../api";
import { api } from "../api";

interface Props {
  valuation: DrawingValuation | null | undefined;
  onChanged?: () => void;
}

function money(value: number | null | undefined) {
  const v = Number(value ?? 0);
  if (v >= 10000) return `${(v / 10000).toFixed(1)} 万`;
  return v.toLocaleString("zh-CN", { style: "currency", currency: "CNY" });
}

function confTag(value: number | undefined) {
  const v = Math.round(Number(value ?? 0) * 100);
  if (v >= 85) return <Tag color="green" className="vr-conf-tag">{v}%</Tag>;
  if (v >= 60) return <Tag color="blue" className="vr-conf-tag">{v}%</Tag>;
  if (v >= 40) return <Tag color="orange" className="vr-conf-tag">{v}%</Tag>;
  return <Tag color="red" className="vr-conf-tag">{v}%</Tag>;
}

type Disposal = "remapped" | "ignored";

export default function ValuationReview({ valuation, onChanged }: Props) {
  const [disposed, setDisposed] = useState<Record<number, Disposal>>({});
  const [replaceRow, setReplaceRow] = useState<DrawingValuationItem | null>(null);
  const [candidates, setCandidates] = useState<MatchCandidate[]>([]);
  const [candidatesLoading, setCandidatesLoading] = useState(false);
  const [candidatesChosen, setCandidatesChosen] = useState<number | undefined>();
  const [submitting, setSubmitting] = useState(false);

  const openReplace = useCallback(async (row: DrawingValuationItem) => {
    setReplaceRow(row);
    setCandidates([]);
    setCandidatesChosen(undefined);
    setCandidatesLoading(true);
    try {
      const res = await api.getQuotaCandidates(row.boq_item_id, 5);
      setCandidates(res);
      setCandidatesChosen(res[0]?.quota_item_id);
      if (res.length === 0) message.warning("没有找到可重挂的定额候选");
    } catch (err) {
      message.error(err instanceof Error ? err.message : "获取候选定额失败");
    } finally {
      setCandidatesLoading(false);
    }
  }, []);

  const confirmRemap = async () => {
    if (!replaceRow || !candidatesChosen) {
      message.warning("请先选择要重挂的定额");
      return;
    }
    setSubmitting(true);
    try {
      await api.replaceBinding(replaceRow.boq_item_id, candidatesChosen);
      setDisposed((prev) => ({ ...prev, [replaceRow.boq_item_id]: "remapped" }));
      message.success("定额已重挂");
      setReplaceRow(null);
      onChanged?.();
    } catch (err) {
      message.error(err instanceof Error ? err.message : "重挂定额失败");
    } finally {
      setSubmitting(false);
    }
  };

  const markIgnored = (row: DrawingValuationItem) => {
    setDisposed((prev) => ({ ...prev, [row.boq_item_id]: "ignored" }));
    message.success("已忽略该清单项");
    onChanged?.();
  };

  if (!valuation) {
    return <Empty description="暂无计价复核结果" className="vr-empty" />;
  }

  const items = valuation.items ?? [];
  const matched = items.filter((i) => i.status === "matched").length;
  const skipped = items.filter((i) => i.status !== "matched").length;
  const avgConf = items.length > 0
    ? items.reduce((s, i) => s + Number(i.match_confidence ?? 0), 0) / items.length
    : 0;
  const highConf = items.filter((i) => Number(i.match_confidence ?? 0) >= 0.85).length;
  const lowConf = items.filter((i) => Number(i.match_confidence ?? 0) < 0.55 && i.status === "matched").length;
  const matchRate = items.length > 0 ? matched / items.length : 0;

  // 匹配质量等级
  let level = "F";
  let levelColor = "#ef4444";
  const qualityScore = Math.round((matchRate * 40 + avgConf * 40 + (highConf / Math.max(items.length, 1)) * 20));
  if (qualityScore >= 85) { level = "A"; levelColor = "#22c55e"; }
  else if (qualityScore >= 70) { level = "B"; levelColor = "#38bdf8"; }
  else if (qualityScore >= 55) { level = "C"; levelColor = "#fbbf24"; }
  else if (qualityScore >= 40) { level = "D"; levelColor = "#f97316"; }

  const columns: ColumnsType<DrawingValuationItem> = [
    { title: "清单编码", dataIndex: "code", width: 120 },
    { title: "名称", dataIndex: "name", ellipsis: true },
    { title: "单位", dataIndex: "unit", width: 70 },
    { title: "工程量", dataIndex: "quantity", width: 100, align: "right" },
    {
      title: "定额",
      width: 130,
      render: (_, row) =>
        row.quota_code ? (
          <Tooltip title={row.quota_name || row.quota_code}>
            <Tag color="blue" className="vr-quota-tag">{row.quota_code}</Tag>
          </Tooltip>
        ) : (
          <Tag className="vr-quota-tag">未匹配</Tag>
        ),
    },
    {
      title: "置信度",
      width: 90,
      render: (_, row) => confTag(row.match_confidence),
    },
    {
      title: "状态",
      width: 100,
      render: (_, row) => {
        const disposal = disposed[row.boq_item_id];
        if (disposal === "remapped") return <Tag color="green">已重挂定额</Tag>;
        if (disposal === "ignored") return <Tag>已忽略</Tag>;
        return (
          <Tag color={row.status === "matched" ? "green" : "orange"} className="vr-status-tag">
            {row.status === "matched" ? "已匹配" : row.status}
          </Tag>
        );
      },
    },
    { title: "合价", dataIndex: "total", width: 110, align: "right", render: (v: number) => money(v) },
    {
      title: "处置",
      width: 220,
      render: (_, row) => {
        const disposal = disposed[row.boq_item_id];
        const needsAttention = row.status !== "matched" || Number(row.match_confidence ?? 0) < 0.55;
        return (
          <span style={{ display: "inline-flex", gap: 6 }}>
            {disposal === "remapped" ? (
              <Button size="small" onClick={() => openReplace(row)}>再次调整</Button>
            ) : disposal === "ignored" ? (
              <Button
                size="small"
                onClick={() => setDisposed((prev) => {
                  const next = { ...prev };
                  delete next[row.boq_item_id];
                  return next;
                })}
              >
                撤销忽略
              </Button>
            ) : (
              <>
                <Button size="small" onClick={() => openReplace(row)}>{needsAttention ? "重挂定额" : "调整定额"}</Button>
                {needsAttention && (
                  <Button size="small" onClick={() => markIgnored(row)}>忽略</Button>
                )}
              </>
            )}
          </span>
        );
      },
    },
  ];

  return (
    <div className="vr-root">
      {/* 匹配质量概览 */}
      <div className="vr-quality-strip">
        <div className="vr-quality-level" style={{ borderColor: levelColor }}>
          <span className="vr-quality-level-letter" style={{ color: levelColor }}>{level}</span>
          <span className="vr-quality-level-label">匹配等级</span>
        </div>
        <div className="vr-quality-metrics">
          <div className="vr-quality-metric">
            <strong>{Math.round(matchRate * 100)}%</strong>
            <span>匹配率</span>
          </div>
          <div className="vr-quality-metric">
            <strong>{Math.round(avgConf * 100)}%</strong>
            <span>平均置信</span>
          </div>
          <div className="vr-quality-metric">
            <strong style={{ color: "#22c55e" }}>{highConf}</strong>
            <span>高置信项</span>
          </div>
          <div className="vr-quality-metric">
            <strong style={{ color: "#fbbf24" }}>{lowConf}</strong>
            <span>低置信项</span>
          </div>
          <div className="vr-quality-metric">
            <strong style={{ color: "#f97316" }}>{skipped}</strong>
            <span>未匹配</span>
          </div>
        </div>
        <div className="vr-quality-total">
          <strong>{money(valuation.grand_total)}</strong>
          <span>总造价</span>
        </div>
      </div>

      {valuation.error && (
        <div className="vr-error-banner">
          <span className="material-symbols-outlined">error</span>
          {valuation.error}
        </div>
      )}

      {/* 处置提示 */}
      {(items.length > 0) && (
        <div className="vr-disposal-hint">
          <span className="material-symbols-outlined">fact_check</span>
          低置信或未匹配项可在此直接重挂定额或忽略，无需切换页面
        </div>
      )}

      {/* 匹配明细表 */}
      <div className="vr-table-wrap">
        <Table
          rowKey={(row) => `${row.boq_item_id}-${row.code}`}
          size="small"
          columns={columns}
          dataSource={items}
          pagination={false}
          scroll={{ x: 1000 }}
          locale={{ emptyText: <Empty description="暂无匹配明细" /> }}
        />
      </div>

      {/* 复核问题 */}
      {valuation.review_items?.length ? (
        <div className="vr-review-wrap">
          <div className="vr-review-head">
            <span className="material-symbols-outlined">flag</span>
            <h4>复核问题 ({valuation.review_items.length})</h4>
          </div>
          <div className="vr-review-list">
            {valuation.review_items.map((item, idx) => (
              <div key={`${item.category}-${idx}`} className={`vr-review-item severity-${item.severity}`}>
                <span className={`vr-review-severity ${item.severity}`}>
                  {item.severity === "error" ? "错误" : "警告"}
                </span>
                <span className="vr-review-category">{item.category}</span>
                <span className="vr-review-message">{item.message}</span>
                {item.suggestion && <span className="vr-review-suggestion">{item.suggestion}</span>}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* 重挂定额 Modal */}
      <Modal
        title={replaceRow ? `重挂定额：${replaceRow.code} ${replaceRow.name}` : "重挂定额"}
        open={!!replaceRow}
        onCancel={() => setReplaceRow(null)}
        onOk={confirmRemap}
        okText="确认重挂"
        cancelText="取消"
        confirmLoading={submitting}
        width={720}
        destroyOnHidden
      >
        {candidatesLoading ? (
          <div style={{ display: "flex", justifyContent: "center", padding: 32 }}>
            <Spin tip="加载候选定额..." />
          </div>
        ) : candidates.length === 0 ? (
          <Empty description="未找到候选定额" />
        ) : (
          <Radio.Group
            value={candidatesChosen}
            onChange={(event) => setCandidatesChosen(event.target.value)}
            style={{ display: "flex", flexDirection: "column", gap: 8 }}
          >
            {candidates.map((cand) => (
              <Radio key={cand.quota_item_id} value={cand.quota_item_id} style={{ display: "block" }}>
                <span>
                  <Tag color="blue">{cand.quota_code}</Tag>
                  {cand.quota_name}
                </span>
                <span style={{ marginLeft: 8, fontSize: 12 }}>
                  置信度 <strong>{Math.round(Number(cand.confidence ?? 0) * 100)}%</strong>
                </span>
                {cand.reasons?.length > 0 && (
                  <span style={{ display: "block", fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
                    {cand.reasons.join("；")}
                  </span>
                )}
              </Radio>
            ))}
          </Radio.Group>
        )}
      </Modal>
    </div>
  );
}