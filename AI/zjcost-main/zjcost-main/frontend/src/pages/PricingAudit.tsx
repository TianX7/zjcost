import { useState } from "react";
import { Tabs } from "antd";
import { CalculatorOutlined, AuditOutlined, FileTextOutlined } from "@ant-design/icons";
import PageHeader from "../components/PageHeader";
import FlowGuide from "../components/FlowGuide";
import PricingManagement from "./PricingManagement";
import AuditWorkbench from "./AuditWorkbench";
import ReportsPage from "./ReportsPage";

const STEPS = [
  { key: "pricing", title: "清单计价", desc: "执行计价计算，生成综合单价与费用构成" },
  { key: "audit", title: "审计复核", desc: "规则校验、计价审查与风险提示" },
  { key: "reports", title: "成果报表", desc: "汇总造价报表并导出成果文件" },
];

const TAB_ICONS: Record<string, React.ReactNode> = {
  pricing: <CalculatorOutlined />,
  audit: <AuditOutlined />,
  reports: <FileTextOutlined />,
};

export default function PricingAudit() {
  const [activeKey, setActiveKey] = useState("pricing");

  return (
    <div className="page-container">
      <PageHeader
        icon="calculate"
        title="计价与复核"
        subtitle="完成清单计价后，直接进行审计复核并生成成果报表，形成计价→复核→出件的工作流。"
      />

      {/* 工作流步骤条 */}
      <div className="workflow-stepper">
        {STEPS.map((step, index) => (
          <div
            key={step.key}
            className={`workflow-step ${activeKey === step.key ? "active" : ""}`}
            onClick={() => setActiveKey(step.key)}
          >
            <div className="workflow-step-index">
              <span className="workflow-step-num">{index + 1}</span>
            </div>
            <div className="workflow-step-body">
              <div className="workflow-step-title">{TAB_ICONS[step.key]} {step.title}</div>
              <div className="workflow-step-desc">{step.desc}</div>
            </div>
            {index < STEPS.length - 1 && <div className="workflow-step-arrow" />}
          </div>
        ))}
      </div>

      <Tabs
        activeKey={activeKey}
        onChange={setActiveKey}
        items={[
          {
            key: "pricing",
            label: <span>{TAB_ICONS.pricing} 清单计价</span>,
            children: <PricingManagement />,
          },
          {
            key: "audit",
            label: <span>{TAB_ICONS.audit} 审计复核</span>,
            children: <AuditWorkbench />,
          },
          {
            key: "reports",
            label: <span>{TAB_ICONS.reports} 成果报表</span>,
            children: <ReportsPage />,
          },
        ]}
      />
      <FlowGuide current="pricing" />
    </div>
  );
}
