import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button, Space, Tag, message } from "antd";
import { ArrowLeftOutlined, ReloadOutlined } from "@ant-design/icons";
import Panel from "../components/Panel";
import type { Project } from "../api";
import { api } from "../api";
import RestoredProjectWorkspace from "../components/RestoredProjectWorkspace";
import "../styles/business-screen.css";

const STATUS_LABELS: Record<string, string> = {
  draft: "立项中",
  ongoing: "实施中",
  completed: "已完成",
  archived: "已归档",
};

const STATUS_COLORS: Record<string, string> = {
  draft: "default",
  ongoing: "processing",
  completed: "green",
  archived: "default",
};

function money(value: number | null | undefined) {
  if (value == null) return "-";
  return Number(value).toLocaleString("zh-CN", { style: "currency", currency: "CNY" });
}

function dateText(value: string | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("zh-CN");
}

export default function ProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const projectId = Number(id);
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!Number.isFinite(projectId)) return;
    setLoading(true);
    try {
      setProject(await api.getProject(projectId));
    } catch (err) {
      message.error(err instanceof Error ? err.message : "加载项目失败");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  // 项目 ID 无效时给出提示
  if (!Number.isFinite(projectId)) {
    return (
      <div className="page-container pd-root bs-screen-page">
        <Panel title="项目信息" icon="folder_open">
          <div className="bs-alert warn">
            <span className="material-symbols-outlined">warning</span>
            <span>项目 ID 无效，请返回项目台账重新选择。</span>
          </div>
          <div className="bs-panel-inset">
            <Button icon={<ArrowLeftOutlined />} onClick={() => navigate("/projects")}>返回项目台账</Button>
          </div>
        </Panel>
      </div>
    );
  }

  const statusText = project ? (STATUS_LABELS[project.status] ?? project.status) : "加载中";
  const statusColor = project ? (STATUS_COLORS[project.status] ?? "default") : "default";

  return (
    <div className="page-container pd-root bs-screen-page">
      <div className="bs-summary-strip">
        <div className="bs-summary-item is-amber">
          <span className="bs-summary-label">项目预算</span>
          <strong className="bs-summary-value num">{money(project?.budget)}</strong>
          <span className="bs-summary-hint">以项目立项口径为准</span>
        </div>
        <div className="bs-summary-item is-green">
          <span className="bs-summary-label">当前状态</span>
          <strong className="bs-summary-value">{statusText}</strong>
          <span className="bs-summary-hint">项目生命周期阶段</span>
        </div>
        <div className="bs-summary-item is-cyan">
          <span className="bs-summary-label">工程类型</span>
          <strong className="bs-summary-value">{project?.project_type ?? "工程项目"}</strong>
          <span className="bs-summary-hint">{project?.region ?? "未设置地区"}</span>
        </div>
        <div className="bs-summary-item is-cyan">
          <span className="bs-summary-label">所属地区</span>
          <strong className="bs-summary-value">{project?.region ?? "-"}</strong>
          <span className="bs-summary-hint">计价规则区域口径</span>
        </div>
        <div className="bs-summary-item is-green">
          <span className="bs-summary-label">项目负责人</span>
          <strong className="bs-summary-value">{project?.owner ?? "-"}</strong>
          <span className="bs-summary-hint">更新于 {dateText(project?.updated_at)}</span>
        </div>
      </div>

      <div className="bs-two-col side-left">
        <div className="bs-col-stack">
          <Panel title="项目摘要" icon="description">
            <div className="bs-kv-list">
              <div className="bs-kv-row"><span>项目名称</span><strong>{project?.name ?? `项目 #${projectId}`}</strong></div>
              <div className="bs-kv-row"><span>状态</span><strong><Tag color={statusColor}>{statusText}</Tag></strong></div>
              <div className="bs-kv-row"><span>工程类型</span><strong>{project?.project_type ?? "-"}</strong></div>
              <div className="bs-kv-row"><span>地区</span><strong>{project?.region ?? "-"}</strong></div>
              <div className="bs-kv-row"><span>负责人</span><strong>{project?.owner ?? "-"}</strong></div>
              <div className="bs-kv-row"><span>预算</span><strong className="num">{money(project?.budget)}</strong></div>
              <div className="bs-kv-row"><span>起止日期</span><strong>{dateText(project?.start_date)} 至 {dateText(project?.end_date)}</strong></div>
            </div>
            <p className="bs-section-note" style={{ marginTop: 10 }}>{project?.description || "工程造价全过程工作台"}</p>
          </Panel>
        </div>

        <Panel
          title="项目工作区"
          icon="workspace_premium"
          extra={
            <Space size={8} wrap>
              <Button icon={<ArrowLeftOutlined />} onClick={() => navigate("/projects")}>返回台账</Button>
              <Button icon={<ReloadOutlined />} loading={loading} onClick={load}>刷新项目</Button>
            </Space>
          }
          bodyClassName="pd-workspace"
        >
          <RestoredProjectWorkspace projectId={projectId} project={project} />
        </Panel>
      </div>
    </div>
  );
}
