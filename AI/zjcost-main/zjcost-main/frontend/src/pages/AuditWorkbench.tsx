import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Button, Empty, Space, Table, Tag, message } from "antd";
import { FileExcelOutlined, FilePdfOutlined } from "@ant-design/icons";
import type { Project, ValidationReport } from "../api";
import { api } from "../api";
import { createSampleProject } from "../sampleProject";

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function AuditWorkbench() {
  const [, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState<number>();
  const [validation, setValidation] = useState<ValidationReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [creatingSample, setCreatingTour] = useState(false);
  const [exporting, setExporting] = useState<"pdf" | "excel" | null>(null);

  // 从校验报告中提取计价类问题（替代原 BatchReviewResponse 死代码）
  const pricingIssues = useMemo(() => {
    if (!validation?.issues) return [];
    return validation.issues
      .filter((i) => i.code.includes("RATE") || i.code.includes("PRICE") || i.code.includes("COST"))
      .map((i) => ({
        boq_item_id: i.boq_item_id ?? 0,
        boq_name: "",
        issue_type: i.code,
        severity: i.severity,
        message: i.message,
        suggestion: i.suggestion,
      }));
  }, [validation]);

  const loadProjects = useCallback(async () => {
    try {
      const res = await api.listProjects({ page_size: 100 });
      setProjects(res.items);
      setProjectId((current) => current ?? res.items[0]?.id);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "加载项目失败");
    }
  }, []);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  const validate = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      setValidation(await api.validate(projectId));
    } catch (err) {
      message.error(err instanceof Error ? err.message : "审查失败");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { void validate(); }, [validate]);

  const startSample = async () => {
    setCreatingTour(true);
    try {
      const project = await createSampleProject();
      message.success("已创建示例项目");
      await loadProjects();
      setProjectId(project.id);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "创建示例项目失败");
    } finally {
      setCreatingTour(false);
    }
  };

  const handleExport = useCallback(
    async (format: "pdf" | "excel") => {
      if (!projectId) {
        message.warning("请先创建或选择项目");
        return;
      }
      setExporting(format);
      try {
        const blob = await api.exportAuditReport(projectId, format);
        const ext = format === "excel" ? "xlsx" : "pdf";
        downloadBlob(blob, `复核审计报告_${projectId}.${ext}`);
        message.success(`已导出${format === "excel" ? " Excel" : " PDF"} 审计报告`);
      } catch (err) {
        message.error(err instanceof Error ? err.message : "导出审计报告失败");
      } finally {
        setExporting(null);
      }
    },
    [projectId],
  );

  return (
    <div className="page-container">
      {!projectId && (
        <div className="content-card">
          <div className="content-card-body">
            <Empty description="当前没有项目。创建或选择项目后，可以运行规则校验、计价审查和审计汇总。">
              <Button type="primary" loading={creatingSample} onClick={startSample}>创建示例项目</Button>
            </Empty>
          </div>
        </div>
      )}

      {projectId && (
        <div className="filter-bar" style={{ justifyContent: "flex-end" }}>
          <Space>
            <Button icon={<FilePdfOutlined />} loading={exporting === "pdf"} onClick={() => void handleExport("pdf")}>
              下载审计报告（PDF）
            </Button>
            <Button icon={<FileExcelOutlined />} loading={exporting === "excel"} onClick={() => void handleExport("excel")}>
              下载审计报告（Excel）
            </Button>
          </Space>
        </div>
      )}

      {/* KPI 指标卡 */}
      <div className="kpi-grid">
        <div className="kpi-card">
          <span className="material-symbols-outlined kpi-card-icon">rule</span>
          <div className="kpi-card-body">
            <span className="kpi-card-label">规则问题</span>
            <span className="kpi-card-value">{validation?.total_issues ?? 0}<span className="kpi-card-suffix">项</span></span>
          </div>
        </div>
        <div className="kpi-card">
          <span className="material-symbols-outlined kpi-card-icon">error</span>
          <div className="kpi-card-body">
            <span className="kpi-card-label">错误</span>
            <span className="kpi-card-value">{validation?.errors ?? 0}<span className="kpi-card-suffix">项</span></span>
          </div>
        </div>
        <div className="kpi-card">
          <span className="material-symbols-outlined kpi-card-icon">warning</span>
          <div className="kpi-card-body">
            <span className="kpi-card-label">警告</span>
            <span className="kpi-card-value">{validation?.warnings ?? 0}<span className="kpi-card-suffix">项</span></span>
          </div>
        </div>
      </div>

      <div className="audit-grid">
        {/* 规则问题 */}
        <div className="content-card">
          <div className="content-card-head">
            <h3 className="content-card-title"><span className="material-symbols-outlined">rule</span>规则问题</h3>
          </div>
          <div className="content-card-body">
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <Alert
                type={validation?.errors ? "error" : validation?.warnings ? "warning" : "success"}
                showIcon
                title={validation ? `发现 ${validation.total_issues} 个规则问题` : "等待规则校验"}
                description="错误会影响计价结果，警告通常需要人工复核。"
              />
              <Table
                rowKey={(row) => `${row.code}-${row.boq_item_id ?? "project"}-${row.message}`}
                loading={loading}
                dataSource={validation?.issues ?? []}
                pagination={{ pageSize: 6 }}
                columns={[
                  { title: "级别", dataIndex: "severity", width: 100, render: (value: string) => <Tag color={value === "error" ? "red" : "orange"}>{value === "error" ? "错误" : "警告"}</Tag> },
                  { title: "编码", dataIndex: "code", width: 150 },
                  { title: "问题", dataIndex: "message" },
                  { title: "建议", dataIndex: "suggestion" },
                ]}
              />
            </div>
          </div>
        </div>

        {/* 计价审查 */}
        <div className="content-card">
          <div className="content-card-head">
            <h3 className="content-card-title"><span className="material-symbols-outlined">calculate</span>计价审查</h3>
          </div>
          <div className="content-card-body">
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <p style={{ margin: 0, color: "#cbd5e1", lineHeight: 1.6 }}>
                {pricingIssues.length > 0
                  ? `检测到 ${pricingIssues.length} 项计价异常，建议优先处理错误级问题。`
                  : "执行规则校验后，这里汇总单价异常、费用构成和价格合理性问题。"}
              </p>
              <Table
                rowKey={(row) => `${row.boq_item_id}-${row.issue_type}-${row.message}`}
                dataSource={pricingIssues}
                pagination={{ pageSize: 6 }}
                columns={[
                  { title: "级别", dataIndex: "severity", width: 100, render: (value: string) => <Tag color={value === "error" ? "red" : "orange"}>{value === "error" ? "错误" : "警告"}</Tag> },
                  { title: "类型", dataIndex: "issue_type", width: 160 },
                  { title: "问题", dataIndex: "message" },
                  { title: "建议", dataIndex: "suggestion" },
                ]}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
