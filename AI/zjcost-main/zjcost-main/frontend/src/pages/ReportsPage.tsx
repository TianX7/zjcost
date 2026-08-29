import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Empty, Input, Progress, Select, Space, Table, Tag, message } from "antd";
import { FileExcelOutlined, FilePdfOutlined } from "@ant-design/icons";
import type { Project, ReportData } from "../api";
import { api } from "../api";

const money = (value: number | null | undefined) => `¥${Number(value ?? 0).toFixed(2)}`;

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function ReportsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState<number>();
  const [report, setReport] = useState<ReportData | null>(null);
  const [division, setDivision] = useState<string>();
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.listProjects({ page_size: 100, sort_by: "updated_at", sort_order: "desc" })
      .then((data) => {
        setProjects(data.items);
        setProjectId((current) => current ?? data.items[0]?.id);
      })
      .catch((err) => message.error(err instanceof Error ? err.message : "加载项目失败"));
  }, []);

  const loadReport = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      setReport(await api.getReport(projectId, { division, search }));
    } catch (err) {
      setReport(null);
      message.error(err instanceof Error ? err.message : "加载报表失败");
    } finally {
      setLoading(false);
    }
  }, [division, projectId, search]);

  useEffect(() => {
    void loadReport();
  }, [loadReport]);

  const divisions = useMemo(() => report?.divisions.map((item) => ({ value: item.division, label: item.division || "未分部" })) ?? [], [report]);

  const bindingRateNumber = Number.parseFloat(String(report?.statistics.binding_rate ?? "0")) || 0;

  const [exporting, setExporting] = useState<"pdf" | "excel" | null>(null);

  const handleExport = useCallback(
    async (format: "pdf" | "excel") => {
      if (!projectId) {
        message.warning("请先选择项目");
        return;
      }
      setExporting(format);
      try {
        const blob = await api.exportReport(projectId, format);
        const ext = format === "excel" ? "xlsx" : "pdf";
        const name = report?.project?.name ?? `project-${projectId}`;
        downloadBlob(blob, `valuation_report_${name}_${projectId}.${ext}`);
        message.success(`已导出${format === "excel" ? " Excel" : " PDF"} 成果报表`);
      } catch (err) {
        message.error(err instanceof Error ? err.message : "导出报表失败");
      } finally {
        setExporting(null);
      }
    },
    [projectId, report],
  );

  return (
    <div className="page-container">
      {/* 筛选栏 */}
      <div className="filter-bar">
        <Select
          placeholder="选择项目"
          value={projectId}
          onChange={(value) => {
            setProjectId(value);
            setDivision(undefined);
          }}
          options={projects.map((project) => ({ value: project.id, label: project.name }))}
          style={{ minWidth: 260 }}
        />
        <Select allowClear placeholder="分部筛选" value={division} onChange={setDivision} options={divisions} style={{ minWidth: 180 }} />
        <Input.Search placeholder="搜索清单" allowClear value={search} onChange={(event) => setSearch(event.target.value)} onSearch={loadReport} style={{ width: 220 }} />
      </div>

      {/* KPI 指标卡 */}
      <div className="kpi-grid">
        <div className="kpi-card">
          <span className="material-symbols-outlined kpi-card-icon">list_alt</span>
          <div className="kpi-card-body">
            <span className="kpi-card-label">清单项</span>
            <span className="kpi-card-value">{report?.statistics.total_items ?? 0}</span>
          </div>
        </div>
        <div className="kpi-card">
          <span className="material-symbols-outlined kpi-card-icon">link</span>
          <div className="kpi-card-body">
            <span className="kpi-card-label">绑定率</span>
            <span className="kpi-card-value">{report?.statistics.binding_rate ?? "0%"}</span>
          </div>
        </div>
        <div className="kpi-card">
          <span className="material-symbols-outlined kpi-card-icon">link_off</span>
          <div className="kpi-card-body">
            <span className="kpi-card-label">未绑定</span>
            <span className="kpi-card-value">{report?.statistics.unbound_count ?? 0}<span className="kpi-card-suffix">项</span></span>
          </div>
        </div>
        <div className="kpi-card">
          <span className="material-symbols-outlined kpi-card-icon">payments</span>
          <div className="kpi-card-body">
            <span className="kpi-card-label">总造价</span>
            <span className="kpi-card-value">{money(report?.cost_summary.grand_total)}</span>
          </div>
        </div>
      </div>

      {/* 报表包 */}
      <div className="content-card">
        <div className="content-card-head">
          <h3 className="content-card-title"><span className="material-symbols-outlined">folder_zip</span>报表包</h3>
          <Space>
            <Button size="small" icon={<FilePdfOutlined />} loading={exporting === "pdf"} disabled={!projectId} onClick={() => void handleExport("pdf")}>
              导出 PDF
            </Button>
            <Button size="small" icon={<FileExcelOutlined />} loading={exporting === "excel"} disabled={!projectId} onClick={() => void handleExport("excel")}>
              导出 Excel
            </Button>
          </Space>
        </div>
        <div className="content-card-body">
          <div className="report-package-grid">
            {[
              { title: "项目封面", desc: report?.project?.name ?? "选择项目后生成" },
              { title: "造价汇总", desc: `总造价 ${money(report?.cost_summary.grand_total)}` },
              { title: "分部统计", desc: `${report?.divisions.length ?? 0} 个分部` },
              { title: "清单明细", desc: `${report?.line_items.length ?? 0} 项清单` },
              { title: "定额绑定", desc: `${report?.statistics.binding_rate ?? "0%"}` },
            ].map((item) => (
              <div className="report-package-item" key={item.title}>
                <span className="material-symbols-outlined">description</span>
                <strong>{item.title}</strong>
                <em>{item.desc}</em>
              </div>
            ))}
          </div>
          <div className="report-quality-row">
            <span>成果完整度</span>
            <Progress percent={Math.min(100, Math.max(0, bindingRateNumber))} />
            <span>未绑定清单 {report?.statistics.unbound_count ?? 0} 项</span>
          </div>
        </div>
      </div>

      {/* 分部汇总 + 清单明细 */}
      <div className="reports-split-grid">
        <div className="content-card">
          <div className="content-card-head">
            <h3 className="content-card-title"><span className="material-symbols-outlined">donut_large</span>分部汇总</h3>
          </div>
          <div className="content-card-body">
            <Table
              rowKey={(row) => row.division || "none"}
              size="small"
              pagination={false}
              loading={loading}
              dataSource={report?.divisions ?? []}
              locale={{ emptyText: <Empty description="暂无分部汇总。执行计价后会生成金额占比。" /> }}
              columns={[
                { title: "分部", dataIndex: "division", render: (value: string) => value || "未分部" },
                { title: "项数", dataIndex: "item_count" },
                { title: "金额", dataIndex: "total_cost", render: money },
                { title: "占比", dataIndex: "percentage" },
              ]}
            />
          </div>
        </div>

        <div className="content-card">
          <div className="content-card-head">
            <h3 className="content-card-title"><span className="material-symbols-outlined">table_rows</span>清单明细</h3>
          </div>
          <div className="content-card-body">
            <Table
              rowKey="boq_item_id"
              loading={loading}
              dataSource={report?.line_items ?? []}
              locale={{ emptyText: <Empty description="暂无清单报表明细。请先完成项目清单和计价。" /> }}
              columns={[
                { title: "编码", dataIndex: "code", width: 120 },
                { title: "名称", dataIndex: "name", ellipsis: true },
                { title: "分部", dataIndex: "division", render: (value: string) => <Tag>{value || "未分部"}</Tag> },
                { title: "单位", dataIndex: "unit", width: 70 },
                { title: "工程量", dataIndex: "quantity", width: 90 },
                { title: "单价", dataIndex: "unit_price", render: money },
                { title: "合价", dataIndex: "total_cost", render: money },
                { title: "绑定", dataIndex: "is_bound", render: (value: boolean) => <Tag color={value ? "green" : "red"}>{value ? "已绑定" : "未绑定"}</Tag> },
              ]}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
