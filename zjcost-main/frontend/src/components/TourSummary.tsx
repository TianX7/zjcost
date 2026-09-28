/**
 * 筑衡 — 导览结束总结页
 *
 * 导览流程完成后弹出，汇总本次导览的核心成果数据，
 * 给评委一个直观的"一页式"收尾印象。
 */

import { useEffect, useState } from "react";

interface TourSummaryProps {
  open: boolean;
  elapsed: number;
  onClose: () => void;
}

interface MetricItem {
  icon: string;
  label: string;
  value: string;
  sub: string;
  color: string;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}分${s.toString().padStart(2, "0")}秒`;
}

export default function TourSummary({ open, elapsed, onClose }: TourSummaryProps) {
  const [animateIn, setAnimateIn] = useState(false);

  useEffect(() => {
    if (open) {
      const t = setTimeout(() => setAnimateIn(true), 50);
      return () => clearTimeout(t);
    }
    setAnimateIn(false);
  }, [open]);

  if (!open) return null;

  const metrics: MetricItem[] = [
    { icon: "drawing", label: "图纸辅助识别", value: "1 张", sub: "6 图层 · 42 构件 · 评分 92", color: "#38bdf8" },
    { icon: "calculate", label: "清单计价", value: "8 项", sub: "造价合计 ¥11,898,392", color: "#22c55e" },
    { icon: "verified", label: "审计复核", value: "5 个发现", sub: "1 错误 · 3 警告 · 1 提示", color: "#f59e0b" },
    { icon: "deployed_code", label: "3D 漫游核查", value: "4 个标注", sub: "自动巡航 · 问题飞入", color: "#a78bfa" },
  ];

  return (
    <div className={`tour-summary-overlay${animateIn ? " tour-summary-in" : ""}`}>
      <div className="tour-summary-card">
        {/* 顶部光效 */}
        <div className="tour-summary-glow" />

        {/* 标题 */}
        <div className="tour-summary-header">
          <span className="material-symbols-outlined tour-summary-header-icon">workspace_premium</span>
          <h2>导览完成</h2>
          <p>筑衡 · 全过程工程造价协同管控平台</p>
        </div>

        {/* 用时 */}
        <div className="tour-summary-time">
          <span className="material-symbols-outlined">schedule</span>
          <span>导览总用时 {formatTime(elapsed)}</span>
        </div>

        {/* 核心成果指标 */}
        <div className="tour-summary-metrics">
          {metrics.map((m, i) => (
            <div
              key={i}
              className="tour-summary-metric"
              style={{
                animationDelay: `${0.15 + i * 0.1}s`,
                borderColor: `${m.color}33`,
              }}
            >
              <div className="tour-summary-metric-icon" style={{ color: m.color }}>
                <span className="material-symbols-outlined">{m.icon}</span>
              </div>
              <div className="tour-summary-metric-body">
                <div className="tour-summary-metric-label">{m.label}</div>
                <div className="tour-summary-metric-value" style={{ color: m.color }}>{m.value}</div>
                <div className="tour-summary-metric-sub">{m.sub}</div>
              </div>
            </div>
          ))}
        </div>

        {/* 流程回顾 */}
        <div className="tour-summary-flow">
          <div className="tour-summary-flow-title">完整流程回顾</div>
          <div className="tour-summary-flow-chain">
            <span className="tour-summary-flow-node">总控台</span>
            <span className="tour-summary-flow-arrow material-symbols-outlined">arrow_forward</span>
            <span className="tour-summary-flow-node">图纸识别</span>
            <span className="tour-summary-flow-arrow material-symbols-outlined">arrow_forward</span>
            <span className="tour-summary-flow-node">清单计价</span>
            <span className="tour-summary-flow-arrow material-symbols-outlined">arrow_forward</span>
            <span className="tour-summary-flow-node">审计复核</span>
            <span className="tour-summary-flow-arrow material-symbols-outlined">arrow_forward</span>
            <span className="tour-summary-flow-node">成果报表</span>
            <span className="tour-summary-flow-arrow material-symbols-outlined">arrow_forward</span>
            <span className="tour-summary-flow-node tour-summary-flow-node-final">3D 核查</span>
          </div>
        </div>

        {/* 按钮 */}
        <div className="tour-summary-actions">
          <button
            type="button"
            className="tour-summary-btn tour-summary-btn-secondary"
            onClick={() => {
              window.location.reload();
            }}
          >
            <span className="material-symbols-outlined">restart_alt</span>
            重新导览
          </button>
          <button
            type="button"
            className="tour-summary-btn tour-summary-btn-primary"
            onClick={onClose}
          >
            <span className="material-symbols-outlined">check_circle</span>
            完成导览
          </button>
        </div>
      </div>
    </div>
  );
}
