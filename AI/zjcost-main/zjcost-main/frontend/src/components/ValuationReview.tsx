import { Empty, Tag, Tooltip } from "antd";
import type { DrawingValuation } from "../api";

interface Props {
  valuation: DrawingValuation | null | undefined;
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

export default function ValuationReview({ valuation }: Props) {
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

      {/* 匹配明细表 */}
      <div className="vr-table-wrap">
        <table className="vr-data-table">
          <thead>
            <tr>
              <th style={{ width: 120 }}>清单编码</th>
              <th>名称</th>
              <th style={{ width: 70 }}>单位</th>
              <th style={{ width: 100 }}>工程量</th>
              <th style={{ width: 130 }}>定额</th>
              <th style={{ width: 90 }}>置信度</th>
              <th style={{ width: 90 }}>状态</th>
              <th style={{ width: 120 }}>合价</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr><td colSpan={8} className="vr-empty-row">暂无匹配明细</td></tr>
            ) : items.map((row) => (
              <tr key={`${row.boq_item_id}-${row.code}`}>
                <td className="vr-cell-code">{row.code}</td>
                <td><span className="vr-cell-name">{row.name}</span></td>
                <td>{row.unit}</td>
                <td className="vr-cell-num">{row.quantity}</td>
                <td>
                  {row.quota_code ? (
                    <Tooltip title={row.quota_name || row.quota_code}>
                      <Tag color="blue" className="vr-quota-tag">{row.quota_code}</Tag>
                    </Tooltip>
                  ) : (
                    <Tag className="vr-quota-tag">未匹配</Tag>
                  )}
                </td>
                <td>{confTag(row.match_confidence)}</td>
                <td>
                  <Tag color={row.status === "matched" ? "green" : "orange"} className="vr-status-tag">
                    {row.status === "matched" ? "已匹配" : row.status}
                  </Tag>
                </td>
                <td className="vr-cell-num">{money(row.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
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
    </div>
  );
}
