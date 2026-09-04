import { useState } from "react";
import { Tabs, Table, Tag, Typography } from "antd";
import { CalculatorOutlined, AuditOutlined, FileTextOutlined, HistoryOutlined } from "@ant-design/icons";
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
  standards: <HistoryOutlined />,
};

// 计价标准更替对照表
const STANDARD_TRANSITIONS = [
  {
    key: "1",
    old_code: "GB 50500-2013",
    old_name: "建设工程工程量清单计价规范",
    new_code: "GB/T 50500-2024",
    new_name: "建设工程工程量清单计价标准",
    effective_date: "2025-09-01",
    status: "已实施",
  },
  {
    key: "2",
    old_code: "GB 50854-2013",
    old_name: "房屋建筑与装饰工程工程量计算规范",
    new_code: "GB/T 50854-2024",
    new_name: "房屋建筑与装饰工程工程量计算标准",
    effective_date: "2025-09-01",
    status: "已实施",
  },
];

const standardsColumns = [
  {
    title: "旧版（已废止）",
    key: "old",
    render: (_: any, record: any) => (
      <div>
        <div style={{ fontWeight: 600, color: "#94a3b8" }}>{record.old_code}</div>
        <div style={{ fontSize: 12, color: "#64748b" }}>{record.old_name}</div>
      </div>
    ),
  },
  {
    title: "现行最新版本",
    key: "new",
    render: (_: any, record: any) => (
      <div>
        <div style={{ fontWeight: 600, color: "#38bdf8" }}>{record.new_code}</div>
        <div style={{ fontSize: 12, color: "#94a3b8" }}>{record.new_name}</div>
      </div>
    ),
  },
  {
    title: "实施时间",
    dataIndex: "effective_date",
    key: "effective_date",
    width: 120,
    render: (value: string) => <Tag color="green">{value}</Tag>,
  },
  {
    title: "状态",
    dataIndex: "status",
    key: "status",
    width: 100,
    render: (value: string) => <Tag color={value === "已实施" ? "green" : "blue"}>{value}</Tag>,
  },
];

function StandardsComparison() {
  return (
    <div className="page-container">
      <div className="content-card">
        <div className="content-card-head">
          <h3 className="content-card-title">
            <HistoryOutlined /> 计价标准更替对照
          </h3>
        </div>
        <div className="content-card-body">
          <Typography.Paragraph style={{ color: "#94a3b8", marginBottom: 16 }}>
            以下展示建设工程造价相关标准的旧版与现行最新版本对照，便于审计复核时参考标准演进关系。
            现行标准于 2025 年 9 月 1 日起实施，旧版规范同时废止。
          </Typography.Paragraph>
          <Table
            rowKey="key"
            dataSource={STANDARD_TRANSITIONS}
            columns={standardsColumns}
            pagination={false}
            bordered
          />
        </div>
      </div>
    </div>
  );
}

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
            {index < STEPS.length - 1 && <div className="workflow-step-arrow" />}</div>
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
          {
            key: "standards",
            label: <span>{TAB_ICONS.standards} 标准对照</span>,
            children: <StandardsComparison />,
          },
        ]}
      />
      <FlowGuide current="pricing" />
    </div>
  );
}
