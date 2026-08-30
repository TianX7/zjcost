import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Table, Tabs, Tag, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import { CheckCircleOutlined, CloudSyncOutlined, DesktopOutlined, SafetyOutlined } from "@ant-design/icons";
import type { PriceSourceInfo, SystemCheckItem } from "../api";
import { api } from "../api";
import TaskCenter from "./TaskCenter";

export default function SystemSettings() {
  const navigate = useNavigate();
  const [systemChecks, setSystemChecks] = useState<SystemCheckItem[]>([]);
  const [priceSources, setPriceSources] = useState<PriceSourceInfo[]>([]);
  const [, setLoading] = useState(false);
  const [fetchingPrices, setFetchingPrices] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [checks, sources] = await Promise.all([
        api.getSystemCheck().catch(() => null),
        api.listPriceSources().catch(() => []),
      ]);
      setSystemChecks(checks?.checks ?? []);
      setPriceSources(sources);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const fetchPrices = async () => {
    setFetchingPrices(true);
    try {
      const result = await api.fetchPrices({ region: "CN" });
      message.success(`抓取完成：${result.total_fetched} 条，新增/更新 ${result.total_new_or_updated} 条`);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "抓取失败");
    } finally {
      setFetchingPrices(false);
    }
  };

  const checkColumns: ColumnsType<SystemCheckItem> = [
    { title: "检查项", dataIndex: "label" },
    { title: "状态", dataIndex: "status", width: 110, render: (value: string) => <Tag color={value === "ok" ? "green" : value === "warning" ? "orange" : "red"}>{value}</Tag> },
    { title: "说明", dataIndex: "message" },
  ];

  return (
    <div className="page-container">
      {/* KPI 指标卡 */}
      <div className="kpi-grid">
        <div className="kpi-card">
          <span className="material-symbols-outlined kpi-card-icon">verified</span>
          <div className="kpi-card-body">
            <span className="kpi-card-label">系统检查项</span>
            <span className="kpi-card-value">{systemChecks.length}<span className="kpi-card-suffix">项</span></span>
          </div>
        </div>
        <div className="kpi-card">
          <span className="material-symbols-outlined kpi-card-icon">trending_up</span>
          <div className="kpi-card-body">
            <span className="kpi-card-label">可用价格源</span>
            <span className="kpi-card-value">{priceSources.filter((source) => source.available).length}<span className="kpi-card-suffix">/{priceSources.length || 0}</span></span>
          </div>
        </div>
      </div>

      <Tabs
        items={[
          {
            key: "system",
            label: <span><SafetyOutlined /> 系统检查</span>,
            children: (
              <div className="content-card">
                <div className="content-card-head">
                  <h3 className="content-card-title"><span className="material-symbols-outlined">monitor_heart</span>系统健康检查</h3>
                </div>
                <div className="content-card-body flush">
                  <Table rowKey="key" size="small" columns={checkColumns} dataSource={systemChecks} pagination={false} />
                </div>
              </div>
            ),
          },
          {
            key: "prices",
            label: <span><CloudSyncOutlined /> 价格调度</span>,
            children: (
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <div className="price-scheduler-cards">
                  <div className="price-scheduler-card">
                    <span className="material-symbols-outlined">cloud_sync</span>
                    <span className="price-scheduler-card-title">测试抓取</span>
                    <span className="price-scheduler-card-desc">立即执行一次价格抓取，验证采集源是否可用。</span>
                    <Button type="primary" icon={<CloudSyncOutlined />} loading={fetchingPrices} onClick={fetchPrices}>执行抓取</Button>
                  </div>
                  <div className="price-scheduler-card">
                    <span className="material-symbols-outlined">schedule</span>
                    <span className="price-scheduler-card-title">每日定时调度</span>
                    <span className="price-scheduler-card-desc">启动 24 小时周期自动抓取，保持价格库最新。</span>
                    <Button onClick={async () => { await api.startPriceScheduler(24); message.success("价格抓取调度已启动"); }}>启动调度</Button>
                  </div>
                  <div className="price-scheduler-card">
                    <span className="material-symbols-outlined">pause_circle</span>
                    <span className="price-scheduler-card-title">停止调度</span>
                    <span className="price-scheduler-card-desc">停止后台定时抓取任务，保留已采集的价格数据。</span>
                    <Button onClick={async () => { await api.stopPriceScheduler(); message.success("价格抓取调度已停止"); }}>停止调度</Button>
                  </div>
                  <div className="price-scheduler-card">
                    <span className="material-symbols-outlined">database</span>
                    <span className="price-scheduler-card-title">数据资源</span>
                    <span className="price-scheduler-card-desc">前往数据资源页面管理定额库、工料机和市场价详情。</span>
                    <Button onClick={() => navigate("/data-resources")}>进入数据资源</Button>
                  </div>
                </div>
                <div className="content-card">
                  <div className="content-card-head">
                    <h3 className="content-card-title"><span className="material-symbols-outlined">trending_up</span>价格来源</h3>
                  </div>
                  <div className="content-card-body flush">
                    <Table
                      rowKey="source_name"
                      size="small"
                      dataSource={priceSources}
                      columns={[
                        { title: "来源", dataIndex: "display_name" },
                        { title: "标识", dataIndex: "source_name" },
                        { title: "可用", dataIndex: "available", render: (value: boolean) => value ? <Tag color="green" icon={<CheckCircleOutlined />}>可用</Tag> : <Tag color="red">不可用</Tag> },
                        { title: "已抓取", dataIndex: "total_prices_fetched" },
                        { title: "最近成功", dataIndex: "last_success_at", render: (value: string | null) => value || "-" },
                        { title: "错误", dataIndex: "error", render: (value: string | null) => value || "-" },
                      ]}
                    />
                  </div>
                </div>
              </div>
            ),
          },
          {
            key: "tasks",
            label: (
              <span>
                <DesktopOutlined />
                作业监控
              </span>
            ),
            children: <TaskCenter />,
          },
        ]}
      />
    </div>
  );
}
