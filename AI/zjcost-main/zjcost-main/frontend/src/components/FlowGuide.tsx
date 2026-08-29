/**
 * 筑衡 — 演示流程引导条
 *
 * 在关键页面底部显示"下一步"引导，串联核心流程：
 * 图纸识别 → 清单计价 → 审计复核 → 成果报表 → 3D 漫游核查
 *
 * 演示者点击"下一步"即可跳转到下一个流程节点，无需记忆路径
 */

import { useNavigate } from "react-router-dom";

interface FlowStep {
  key: string;
  label: string;
  route: string;
  icon: string;
}

/** 核心演示流程节点 */
const DEMO_FLOW: FlowStep[] = [
  { key: "dashboard", label: "总控台", route: "/dashboard", icon: "query_stats" },
  { key: "drawings", label: "图纸识别", route: "/drawings", icon: "drawing" },
  { key: "pricing", label: "清单计价", route: "/pricing-audit", icon: "calculate" },
  { key: "ifc-walk", label: "3D 核查", route: "/ifc-walk-demo", icon: "deployed_code" },
];

interface FlowGuideProps {
  /** 当前流程节点 key */
  current: string;
  /** 可选的自定义下一步路由（覆盖默认流程顺序） */
  customNext?: { route: string; label: string };
}

export default function FlowGuide({ current, customNext }: FlowGuideProps) {
  const navigate = useNavigate();
  const currentIndex = DEMO_FLOW.findIndex(s => s.key === current);

  if (currentIndex < 0) return null;

  const isLast = currentIndex >= DEMO_FLOW.length - 1;
  const nextStep = customNext
    ? { route: customNext.route, label: customNext.label, icon: "arrow_forward" }
    : !isLast
      ? { route: DEMO_FLOW[currentIndex + 1].route, label: DEMO_FLOW[currentIndex + 1].label, icon: DEMO_FLOW[currentIndex + 1].icon }
      : null;

  return (
    <div className="flow-guide">
      {/* 流程进度指示 */}
      <div className="flow-guide-steps">
        {DEMO_FLOW.map((step, i) => {
          const done = i < currentIndex;
          const active = i === currentIndex;
          return (
            <button
              key={step.key}
              type="button"
              className={`flow-guide-step-dot${active ? " active" : ""}${done ? " done" : ""}`}
              onClick={() => navigate(step.route)}
              title={step.label}
            >
              {active && <span className="flow-guide-active-ring" />}
              <span className="material-symbols-outlined">{done ? "check" : step.icon}</span>
              <span className="flow-guide-step-label">{step.label}</span>
            </button>
          );
        })}
      </div>

      {/* 下一步 */}
      {nextStep && (
        <button
          type="button"
          className="flow-guide-next-btn"
          onClick={() => navigate(nextStep.route)}
        >
          <span>下一步：{nextStep.label}</span>
          <span className="material-symbols-outlined">{nextStep.icon}</span>
        </button>
      )}
    </div>
  );
}
