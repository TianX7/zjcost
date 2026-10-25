import { useState } from "react";
import { Table, Tabs, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import { CalculatorOutlined, AuditOutlined, FileTextOutlined } from "@ant-design/icons";
import Panel from "../components/Panel";
import FlowGuide from "../components/FlowGuide";
import PricingManagement from "./PricingManagement";
import AuditWorkbench from "./AuditWorkbench";
import ReportsPage from "./ReportsPage";
import "../styles/business-screen.css";

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

interface StandardTransition {
  key: string;
  old_code: string;
  old_name: string;
  new_code: string;
  new_name: string;
  effective_date: string;
  status: string;
}

// 计价标准更替对照表
const STANDARD_TRANSITIONS: StandardTransition[] = [
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

const standardsColumns: ColumnsType<StandardTransition> = [
  {
    title: "旧版（已废止）",
    key: "old",
    render: (_: unknown, record) => (
      <div>
        <div style={{ fontWeight: 600, color: "#94a3b8" }}>{record.old_code}</div>
        <div style={{ fontSize: 12, color: "#64748b" }}>{record.old_name}</div>
      </div>
    ),
  },
  {
    title: "现行最新版本",
    key: "new",
    render: (_: unknown, record) => (
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

export default function PricingAudit() {
  const [activeKey, setActiveKey] = useState("pricing");
  const current = STANDARD_TRANSITIONS.filter((item) => item.status === "已实施").length;
  const retired = STANDARD_TRANSITIONS.length;
  const activeStep = STEPS.find((step) => step.key === activeKey) ?? STEPS[0];

  return (
    <div className="page-container pa-root bs-screen-page">
      <div className="bs-summary-strip">
        <div className="bs-summary-item is-cyan">
          <span className="bs-summary-label">流程阶段</span>
          <strong className="bs-summary-value num">{STEPS.length}</strong>
          <span className="bs-summary-hint">计价 → 复核 → 出件</span>
        </div>
        <div className="bs-summary-item is-cyan">
          <span className="bs-summary-label">标准更替对照</span>
          <strong className="bs-summary-value num">{STANDARD_TRANSITIONS.length}</strong>
          <span className="bs-summary-hint">旧版与现行标准对照</span>
        </div>
        <div className="bs-summary-item is-green">
          <span className="bs-summary-label">现行标准</span>
          <strong className="bs-summary-value num">{current}</strong>
          <span className="bs-summary-hint">均已实施</span>
        </div>
        <div className="bs-summary-item is-amber">
          <span className="bs-summary-label">旧版（已废止）</span>
          <strong className="bs-summary-value num">{retired}</strong>
          <span className="bs-summary-hint">历史项目需核对依据</span>
        </div>
        <div className="bs-summary-item is-green">
          <span className="bs-summary-label">实施日期</span>
          <strong className="bs-summary-value">{STANDARD_TRANSITIONS[0]?.effective_date ?? "-"}</strong>
          <span className="bs-summary-hint">现行标准生效日</span>
        </div>
      </div>

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

      <div className="bs-two-col">
        <Panel
          title="计价复核工作台"
          icon="fact_check"
          extra={<Tag color="blue">当前：{activeStep.title}</Tag>}
          bodyClassName="pa-pane"
        >
          <Tabs
            className="bs-tabs"
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
        </Panel>

        <div className="bs-col-stack">
          <Panel title="标准更替对照" icon="history" flush bodyClassName="bs-panel-table">
            <Table
              rowKey="key"
              size="small"
              dataSource={STANDARD_TRANSITIONS}
              columns={standardsColumns}
              pagination={false}
              scroll={{ x: 520 }}
            />
            <div className="bs-panel-inset">
              <p className="bs-section-note">
                现行标准于 2025 年 9 月 1 日起实施，旧版规范同时废止；历史项目复核时需核对计价依据版本。
              </p>
            </div>
          </Panel>

          <Panel title="复核风险提示" icon="policy">
            <div className="bs-alert warn">
              <span className="material-symbols-outlined">warning</span>
              <span>旧版规范已废止，沿用旧版计价的清单需在复核阶段标注依据差异。</span>
            </div>
            <div className="bs-kv-list" style={{ marginTop: 10 }}>
              <div className="bs-kv-row"><span>规则校验</span><strong>计价依据版本一致性</strong></div>
              <div className="bs-kv-row"><span>计价审查</span><strong>综合单价与费用构成</strong></div>
              <div className="bs-kv-row"><span>风险提示</span><strong>废止标准引用与缺项</strong></div>
            </div>
          </Panel>
        </div>
      </div>

      <FlowGuide current="pricing" />
    </div>
  );
}
