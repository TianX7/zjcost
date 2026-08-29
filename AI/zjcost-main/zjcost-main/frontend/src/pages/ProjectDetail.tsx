import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button, Tag, message } from "antd";
import { ArrowLeftOutlined, ReloadOutlined } from "@ant-design/icons";
import type { Project } from "../api";
import { api } from "../api";
import RestoredProjectWorkspace from "../components/RestoredProjectWorkspace";
import PageHeader from "../components/PageHeader";

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
      <div className="page-container">
        <div className="content-card">
          <div className="content-card-body">项目 ID 无效</div>
        </div>
      </div>
    );
  }

  return (
    <div className="page-container">
      <PageHeader
        icon="folder_open"
        title={project?.name ?? `项目 #${projectId}`}
        subtitle={
          <>
            <Tag color="blue">{project?.region ?? "未设置地区"}</Tag>
            <Tag>{project?.project_type ?? "工程项目"}</Tag>
            <Tag color={project?.status === "completed" ? "green" : "processing"}>
              {project?.status ?? "draft"}
            </Tag>
          </>
        }
        actions={
          <>
            <Button icon={<ArrowLeftOutlined />} onClick={() => navigate("/projects")} />
            <Button icon={<ReloadOutlined />} loading={loading} onClick={load}>刷新项目</Button>
          </>
        }
      />
      <RestoredProjectWorkspace projectId={projectId} project={project} />
    </div>
  );
}
