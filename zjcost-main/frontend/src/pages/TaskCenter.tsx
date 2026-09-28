import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Button, Descriptions, Drawer, Empty, Popconfirm, Progress, Space, Table, Tag, Typography, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import { api, type TaskStatusOut } from "../api";

function statusColor(status: string) {
  if (status === "completed" || status === "done") return "success";
  if (status === "failed" || status === "error") return "error";
  if (status === "running" || status === "processing") return "processing";
  return "default";
}

function statusLabel(status: string) {
  const map: Record<string, string> = {
    pending: "排队中",
    running: "运行中",
    processing: "处理中",
    completed: "已完成",
    done: "已完成",
    failed: "失败",
    error: "异常",
    removed: "已移除",
  };
  return map[status] ?? status;
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
  const [acting, setActing] = useState<string | null>(null);
  const [detail, setDetail] = useState<TaskStatusOut | null>(null);

  const loadTasks = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.listTasks();
      setTasks(res.tasks ?? []);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "加载任务失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTasks();
  }, [loadTasks]);

  const handleCancel = async (row: TaskStatusOut) => {
    setActing(row.task_id);
    try {
      await api.cancelTask(row.task_id);
      message.success("已请求取消任务");
      await loadTasks();
    } catch (err) {
      message.error(err instanceof Error ? err.message : "取消失败");
    } finally {
      setActing(null);
    }
  };

  const handleDelete = async (row: TaskStatusOut) => {
    setActing(row.task_id);
    try {
      await api.deleteTask(row.task_id);
      message.success("任务记录已移除");
      await loadTasks();
    } catch (err) {
      message.error(err instanceof Error ? err.message : "移除失败");
    } finally {
      setActing(null);
    }
  };

  const taskStats = useMemo(() => {
    const running = tasks.filter((task) => ["running", "processing", "pending"].includes(task.status)).length;
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
      width: 170,
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
      width: 110,
      render: (value: string, row) => (
        <Tag color={row.cancelled ? "orange" : statusColor(value)}>{statusLabel(value)}</Tag>
      ),
    },
    {
      title: "进度",
      dataIndex: "progress",
      key: "progress",
      width: 170,
      render: (value: number, row) =>
        row.cancelled ? (
          <Typography.Text type="secondary">已取消</Typography.Text>
        ) : (
          <Progress percent={Math.round(Number(value ?? 0) * 100)} size="small" />
        ),
    },
    { title: "消息", dataIndex: "message", key: "message", ellipsis: true },
    {
      title: "错误",
      dataIndex: "error",
      key: "error",
      ellipsis: true,
      render: (value: string | null) => value ? <Typography.Text type="danger">{value}</Typography.Text> : "-",
    },
    { title: "创建时间", dataIndex: "created_at", key: "created", width: 175, render: formatDateTime },
    {
      title: "操作",
      key: "actions",
      width: 200,
      fixed: "right",
      render: (_, row) => {
        const active = ["pending", "running", "processing"].includes(row.status);
        const finished = ["completed", "done", "failed", "error"].includes(row.status);
        return (
          <Space size={6} wrap>
            <Button size="small" onClick={() => setDetail(row)}>详情</Button>
            {active && !row.cancelled && (
              <Popconfirm title="确认取消该任务？" okText="取消任务" cancelText="再想想" onConfirm={() => handleCancel(row)}>
                <Button size="small" danger loading={acting === row.task_id}>取消</Button>
              </Popconfirm>
            )}
            {finished && (
              <Popconfirm title="移除该任务记录？" okText="移除" cancelText="保留" onConfirm={() => handleDelete(row)}>
                <Button size="small" danger loading={acting === row.task_id}>移除</Button>
              </Popconfirm>
            )}
          </Space>
        );
      },
    },
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
          <Button icon={<span className="material-symbols-outlined">refresh</span>} loading={loading} onClick={loadTasks}>
            刷新
          </Button>
        </div>
        <div className="content-card-body flush">
          <Table
            dataSource={tasks}
            columns={columns}
            rowKey="task_id"
            loading={loading}
            pagination={{ pageSize: 10 }}
            scroll={{ x: 1180 }}
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

      {/* 任务详情 Drawer */}
      <Drawer
        title={detail ? `${detail.task_type} · ${detail.task_id}` : "任务详情"}
        open={!!detail}
        onClose={() => setDetail(null)}
        width={520}
      >
        {detail && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <Descriptions column={1} size="small" bordered>
              <Descriptions.Item label="任务 ID">
                <Typography.Text copyable>{detail.task_id}</Typography.Text>
              </Descriptions.Item>
              <Descriptions.Item label="任务类型">{detail.task_type}</Descriptions.Item>
              <Descriptions.Item label="状态">
                <Tag color={detail.cancelled ? "orange" : statusColor(detail.status)}>
                  {statusLabel(detail.status)}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="进度">
                <Progress percent={Math.round(Number(detail.progress ?? 0) * 100)} size="small" />
              </Descriptions.Item>
              <Descriptions.Item label="消息">{detail.message || "-"}</Descriptions.Item>
              <Descriptions.Item label="错误">
                {detail.error ? <Typography.Text type="danger">{detail.error}</Typography.Text> : "-"}
              </Descriptions.Item>
              <Descriptions.Item label="创建时间">{formatDateTime(detail.created_at)}</Descriptions.Item>
              <Descriptions.Item label="完成时间">{formatDateTime(detail.completed_at)}</Descriptions.Item>
            </Descriptions>
            <Space size={8}>
              {["pending", "running", "processing"].includes(detail.status) && !detail.cancelled && (
                <Popconfirm title="确认取消该任务？" okText="取消任务" cancelText="再想想" onConfirm={() => { void (async () => {
                  await handleCancel(detail);
                  setDetail(null);
                })(); }}>
                  <Button danger>取消任务</Button>
                </Popconfirm>
              )}
              <Button onClick={() => setDetail(null)}>关闭</Button>
            </Space>
          </div>
        )}
      </Drawer>
    </div>
  );
}
