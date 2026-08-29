import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Button, Empty, Progress, Table, Tag, Typography, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import { api, type TaskStatusOut } from "../api";

function statusColor(status: string) {
  if (status === "completed" || status === "done") return "success";
  if (status === "failed" || status === "error") return "error";
  if (status === "running" || status === "processing") return "processing";
  return "default";
}

function formatDateTime(value?: string | null) {
  if (!value) return "-";
  const time = new Date(value);
  if (Number.isNaN(time.getTime())) return "-";
  return time.toLocaleString("zh-CN", { hour12: false });
}

export default function TaskCenter() {
  const [tasks, setTasks] = useState<TaskStatusOut[]>([]);
  const [loading, setLoading] = useState(false);

  const loadTasks = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.listTasks();
      setTasks(res.tasks || []);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "加载任务失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTasks();
  }, [loadTasks]);

  const taskStats = useMemo(() => {
    const running = tasks.filter((task) => ["running", "processing"].includes(task.status)).length;
    const failed = tasks.filter((task) => ["failed", "error"].includes(task.status)).length;
    const completed = tasks.filter((task) => ["completed", "done"].includes(task.status)).length;
    const latest = tasks
      .map((task) => task.created_at)
      .filter(Boolean)
      .sort()
      .at(-1);
    return { running, failed, completed, latest: latest ? formatDateTime(latest) : "-" };
  }, [tasks]);

  const columns: ColumnsType<TaskStatusOut> = [
    {
      title: "任务",
      dataIndex: "task_type",
      key: "type",
      width: 180,
      render: (value: string, row) => (
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <Typography.Text strong>{value}</Typography.Text>
          <Typography.Text copyable={{ text: row.task_id }} type="secondary">
            {row.task_id.slice(0, 12)}
          </Typography.Text>
        </div>
      ),
    },
    {
      title: "状态",
      dataIndex: "status",
      key: "status",
      width: 120,
      render: (value: string) => <Tag color={statusColor(value)}>{value}</Tag>,
    },
    {
      title: "进度",
      dataIndex: "progress",
      key: "progress",
      width: 200,
      render: (value: number) => <Progress percent={Math.round(Number(value || 0) * 100)} size="small" />,
    },
    { title: "消息", dataIndex: "message", key: "message", ellipsis: true },
    {
      title: "错误",
      dataIndex: "error",
      key: "error",
      ellipsis: true,
      render: (value: string | null) => value ? <Typography.Text type="danger">{value}</Typography.Text> : "-",
    },
    { title: "创建时间", dataIndex: "created_at", key: "created", width: 190, render: formatDateTime },
    { title: "完成时间", dataIndex: "completed_at", key: "completed", width: 190, render: formatDateTime },
  ];

  return (
    <div className="page-container">
      {/* KPI 指标卡 */}
      <div className="kpi-grid">
        <div className="kpi-card">
          <span className="material-symbols-outlined kpi-card-icon">task_alt</span>
          <div className="kpi-card-body">
            <span className="kpi-card-label">后台作业</span>
            <span className="kpi-card-value">{tasks.length}<span className="kpi-card-suffix">项</span></span>
          </div>
        </div>
        <div className="kpi-card">
          <span className="material-symbols-outlined kpi-card-icon">play_circle</span>
          <div className="kpi-card-body">
            <span className="kpi-card-label">运行中</span>
            <span className="kpi-card-value">{taskStats.running}<span className="kpi-card-suffix">项</span></span>
          </div>
        </div>
        <div className="kpi-card">
          <span className="material-symbols-outlined kpi-card-icon">error</span>
          <div className="kpi-card-body">
            <span className="kpi-card-label">失败/异常</span>
            <span className="kpi-card-value">{taskStats.failed}<span className="kpi-card-suffix">项</span></span>
          </div>
        </div>
        <div className="kpi-card">
          <span className="material-symbols-outlined kpi-card-icon">schedule</span>
          <div className="kpi-card-body">
            <span className="kpi-card-label">最近创建</span>
            <span className="kpi-card-value">{taskStats.latest}</span>
          </div>
        </div>
      </div>

      {/* 发起作业区 */}
      <div className="content-card">
        <div className="content-card-head">
          <h3 className="content-card-title"><span className="material-symbols-outlined">rocket_launch</span>发起作业</h3>
        </div>
        <div className="content-card-body">
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <Link to="/drawings"><Button>图纸工程量</Button></Link>
            <Link to="/ifc-parser"><Button>BIM模型工程量</Button></Link>
            <Link to="/pricing"><Button>清单计价</Button></Link>
          </div>
        </div>
      </div>

      {/* 后台任务表格 */}
      <div className="content-card">
        <div className="content-card-head">
          <h3 className="content-card-title"><span className="material-symbols-outlined">list_alt</span>后台任务</h3>
        </div>
        <div className="content-card-body flush">
          <Table
            dataSource={tasks}
            columns={columns}
            rowKey="task_id"
            loading={loading}
            pagination={{ pageSize: 10 }}
            scroll={{ x: 1120 }}
            locale={{
              emptyText: (
                <Empty description="暂无后台作业。上传图纸、上传 IFC 或执行计价后会在这里显示进度。">
                  <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
                    <Link to="/drawings"><Button type="primary">上传图纸</Button></Link>
                    <Link to="/ifc-parser"><Button>上传 IFC</Button></Link>
                  </div>
                </Empty>
              ),
            }}
          />
        </div>
      </div>
    </div>
  );
}
