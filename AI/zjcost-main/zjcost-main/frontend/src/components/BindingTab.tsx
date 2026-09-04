import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Button,
  Drawer,
  Modal,
  Popconfirm,
  Space,
  Spin,
  Table,
  Tag,
  Typography,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { LinkOutlined, RobotOutlined, ThunderboltOutlined } from "@ant-design/icons";
import type { Binding, BoqItem, CalcProvenance, MatchCandidate } from "../api";
import { api } from "../api";

function money(value: number | null | undefined) {
  return `¥${Number(value ?? 0).toFixed(2)}`;
}

function num2(value: number | null | undefined) {
  return Number(value ?? 0).toFixed(2);
}

function fmtNum(value: number | null | undefined, digits = 2) {
  return Number(value ?? 0).toFixed(digits);
}

interface Props {
  projectId: number;
}

interface BoqBindingRow extends BoqItem {
  bindings: Binding[];
  bound: boolean;
}

export default function BindingTab({ projectId }: Props) {
  const [rows, setRows] = useState<BoqBindingRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [batchLoading, setBatchLoading] = useState(false);
  const [provOpen, setProvOpen] = useState(false);
  const [provenance, setProvenance] = useState<CalcProvenance | null>(null);
  const [provLoading, setProvLoading] = useState(false);
  const bindingsTotal = useMemo(
    () => (provenance?.bindings ?? []).reduce((sum, b) => sum + Number(b.direct_cost ?? 0), 0),
    [provenance],
  );
  const [replaceOpen, setReplaceOpen] = useState(false);
  const [replaceRow, setReplaceRow] = useState<BoqBindingRow | null>(null);
  const [replaceCandidates, setReplaceCandidates] = useState<MatchCandidate[]>([]);
  const [replaceChosen, setReplaceChosen] = useState<number | undefined>();
  const [replaceLoading, setReplaceLoading] = useState(false);
  const [replaceSubmitting, setReplaceSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const items = await api.listBoqItems(projectId);
      // 并发上限 6：清单多时不再逐个串行请求绑定
      const CONCURRENCY = 6;
      const queue = [...items];
      const enriched: BoqBindingRow[] = [];
      const runners = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
        while (queue.length) {
          const item = queue.shift();
          if (!item) break;
          try {
            const bindings = await api.listBindings(item.id);
            enriched.push({ ...item, bindings, bound: bindings.length > 0 });
          } catch {
            enriched.push({ ...item, bindings: [], bound: false });
          }
        }
      });
      await Promise.all(runners);
      enriched.sort((x, y) => x.id - y.id);
      setRows(enriched);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "加载清单绑定失败");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const unboundRows = useMemo(() => rows.filter((row) => !row.bound), [rows]);
  const boundCount = rows.length - unboundRows.length;
  const boundRate = rows.length ? Math.round((boundCount / rows.length) * 100) : 0;

  const openReplaceModal = async (row: BoqBindingRow) => {
    setReplaceOpen(true);
    setReplaceRow(row);
    setReplaceCandidates([]);
    setReplaceChosen(undefined);
    setReplaceLoading(true);
    try {
      const candidates = await api.getQuotaCandidates(row.id, 5);
      setReplaceCandidates(candidates);
      setReplaceChosen(candidates[0]?.quota_item_id);
      if (candidates.length === 0) message.warning("没有找到可替换的定额候选");
    } catch (err) {
      message.error(err instanceof Error ? err.message : "获取候选定额失败");
      setReplaceOpen(false);
    } finally {
      setReplaceLoading(false);
    }
  };

  const confirmManualReplace = async () => {
    if (!replaceRow || !replaceChosen) {
      message.warning("请选择要绑定的定额");
      return;
    }
    setReplaceSubmitting(true);
    try {
      await api.replaceBinding(replaceRow.id, replaceChosen);
      message.success("定额绑定已更新");
      setReplaceOpen(false);
      await load();
    } catch (err) {
      message.error(err instanceof Error ? err.message : "替换绑定失败");
    } finally {
      setReplaceSubmitting(false);
    }
  };

  const handleClearBindings = async (row: BoqBindingRow) => {
    try {
      const res = await api.clearBindings(row.id);
      message.success(`已清除 ${res.removed} 条绑定`);
      await load();
    } catch (err) {
      message.error(err instanceof Error ? err.message : "清除绑定失败");
    }
  };

  const handleBatchBind = async () => {
    if (unboundRows.length === 0) {
      message.info("所有清单项都已绑定");
      return;
    }
    setBatchLoading(true);
    let successCount = 0;
    for (const row of unboundRows) {
      try {
        const candidates = await api.getQuotaCandidates(row.id, 1);
        if (candidates[0]) {
          await api.confirmBinding(row.id, candidates[0].quota_item_id);
          successCount += 1;
        }
      } catch {
        // Keep the batch moving; final count tells the operator what happened.
      }
    }
    message.success(`批量绑定完成：${successCount}/${unboundRows.length}`);
    setBatchLoading(false);
    await load();
  };

  const openProvenance = async (boqItemId: number) => {
    setProvOpen(true);
    setProvLoading(true);
    setProvenance(null);
    try {
      setProvenance(await api.getProvenance(boqItemId));
    } catch (err) {
      message.error(err instanceof Error ? err.message : "加载计算溯源失败");
    } finally {
      setProvLoading(false);
    }
  };

  const columns: ColumnsType<BoqBindingRow> = [
    { title: "清单编码", dataIndex: "code", width: 120, ellipsis: true },
    { title: "项目名称", dataIndex: "name", ellipsis: true },
    { title: "单位", dataIndex: "unit", width: 80 },
    {
      title: "工程量",
      dataIndex: "quantity",
      width: 110,
      align: "right",
      render: (value: number) => <span className="num">{Number(value ?? 0).toLocaleString("zh-CN")}</span>,
    },
    {
      title: "绑定状态",
      width: 120,
      render: (_, row) =>
        row.bound ? (
          <Tag color="green" icon={<LinkOutlined />}>已绑定</Tag>
        ) : (
          <Tag color="red">未绑定</Tag>
        ),
    },
    {
      title: "操作",
      width: 280,
      render: (_, row) => (
        <Space size={6} wrap>
          <Button size="small" icon={<RobotOutlined />} disabled={!row.bound} onClick={() => openProvenance(row.id)}>
            溯源
          </Button>
          <Button size="small" onClick={() => openReplaceModal(row)}>
            {row.bound ? "替换定额" : "选择定额"}
          </Button>
          <Popconfirm title="确认清除该清单项的全部定额绑定？" onConfirm={() => handleClearBindings(row)}>
            <Button size="small" danger disabled={!row.bound}>
              清除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginBottom: 16,
          padding: "12px 16px",
          background: "var(--bg-surface)",
          borderRadius: "var(--radius)",
          border: "1px solid var(--border)",
          flexWrap: "wrap",
        }}
      >
        <Tag color="green" className="num">已绑定 {boundCount}</Tag>
        <Tag color={unboundRows.length > 0 ? "red" : "default"} className="num">未绑定 {unboundRows.length}</Tag>
        <Typography.Text type="secondary" className="num">绑定率 {boundRate}%</Typography.Text>
        <div style={{ flex: 1, minWidth: 120, height: 5, borderRadius: 3, background: "rgba(30, 58, 95, 0.8)", overflow: "hidden" }}>
          <div className="ws-bar-fill" style={{ height: "100%", width: `${boundRate}%`, borderRadius: 3, background: boundRate >= 95 ? "linear-gradient(90deg, #22c55e, #4dd4ff)" : "linear-gradient(90deg, #2563eb, #4dd4ff)", transition: "width 0.4s ease" }} />
        </div>
        <div style={{ marginLeft: "auto" }}>
          <Button
            type="primary"
            icon={<ThunderboltOutlined />}
            loading={batchLoading}
            disabled={unboundRows.length === 0}
            onClick={handleBatchBind}
          >
            批量绑定 {unboundRows.length}
          </Button>
        </div>
      </div>

      <Table
        rowKey="id"
        columns={columns}
        dataSource={rows}
        loading={loading}
        size="small"
        pagination={{ pageSize: 20, showSizeChanger: true, showTotal: (total) => `共 ${total} 项` }}
        rowClassName={(row) => (row.bound ? "" : "ant-table-row-warning")}
        scroll={{ x: 860 }}
      />

      <Modal
        title={replaceRow ? `定额绑定 - [${replaceRow.code}] ${replaceRow.name}` : "定额绑定"}
        open={replaceOpen}
        onCancel={() => setReplaceOpen(false)}
        onOk={confirmManualReplace}
        okText="确认绑定"
        confirmLoading={replaceSubmitting}
        width={760}
      >
        {replaceLoading ? (
          <div style={{ textAlign: "center", padding: 24 }}><Spin /></div>
        ) : replaceCandidates.length === 0 ? (
          <div style={{ color: "var(--text-secondary)", padding: 24, textAlign: "center" }}>暂无候选定额</div>
        ) : (
          <Table
            rowKey="quota_item_id"
            size="small"
            pagination={false}
            dataSource={replaceCandidates}
            rowSelection={{
              type: "radio",
              selectedRowKeys: replaceChosen ? [replaceChosen] : [],
              onChange: (keys) => setReplaceChosen(Number(keys[0])),
            }}
            columns={[
              { title: "定额编码", dataIndex: "quota_code", width: 120 },
              { title: "定额名称", dataIndex: "quota_name", ellipsis: true },
              { title: "单位", dataIndex: "unit", width: 70 },
              {
                title: "置信度",
                dataIndex: "confidence",
                width: 90,
                render: (value: number) => {
                  const v = Math.round(Number(value ?? 0) * 100);
                  return <span className="num" style={{ color: v >= 80 ? "var(--success)" : v >= 60 ? "var(--warning)" : "var(--danger)", fontWeight: 700 }}>{v}%</span>;
                },
              },
              {
                title: "理由",
                dataIndex: "reasons",
                width: 240,
                render: (reasons: string[]) => (
                  <span style={{ color: "var(--text-secondary)" }}>{reasons?.slice(0, 2).join("；") || "-"}</span>
                ),
              },
            ]}
          />
        )}
      </Modal>

      <Drawer
        title="计价溯源"
        open={provOpen}
        onClose={() => setProvOpen(false)}
        width={520}
      >
        {provLoading ? (
          <Spin />
        ) : provenance ? (
          <div>
            <Typography.Title level={4}>{provenance.boq_code} - {provenance.boq_name}</Typography.Title>
            <Typography.Paragraph type="secondary">
              工程量：{provenance.boq_quantity} {provenance.boq_unit}
            </Typography.Paragraph>
            {provenance.calc_breakdown && (
              <div className="unit-formula" style={{ marginBottom: 16 }}>
                <div className="unit-formula-row">
                  <span className="unit-formula-label">直接费</span>
                  <code title="各绑定定额直接费汇总">
                    {(provenance.bindings.map((b) => num2(b.direct_cost)).join(" + ") || "0.00")} = {num2(bindingsTotal)}
                  </code>
                </div>
                <div className="unit-formula-row">
                  <span className="unit-formula-label">税前合计</span>
                  <code title="直接费 + 管理费 + 利润 + 规费">
                    {num2(provenance.calc_breakdown.direct_cost)} + {num2(provenance.calc_breakdown.management_fee)} + {num2(provenance.calc_breakdown.profit)} + {num2(provenance.calc_breakdown.regulatory_fee)} = {num2(provenance.calc_breakdown.pre_tax_total)}
                  </code>
                </div>
                <div className="unit-formula-row">
                  <span className="unit-formula-label">含税合计</span>
                  <code title="税前合计 + 税金">
                    {num2(provenance.calc_breakdown.pre_tax_total)} + {num2(provenance.calc_breakdown.tax)} = {num2(provenance.calc_breakdown.total)}
                  </code>
                </div>
                <div className="unit-formula-row">
                  <span className="unit-formula-label">合价</span>
                  <code title="综合单价 × 工程量">
                    {money(provenance.unit_price)} × {fmtNum(provenance.boq_quantity)} = {money(provenance.calc_total)}
                  </code>
                </div>
              </div>
            )}
            {provenance.bindings.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <Typography.Text strong>绑定定额</Typography.Text>
                {provenance.bindings.map((binding) => (
                  <div
                    key={binding.binding_id}
                    style={{
                      marginTop: 8,
                      padding: 12,
                      background: "var(--bg)",
                      borderRadius: 8,
                      border: "1px solid var(--border)",
                    }}
                  >
                    <Tag color="blue">{binding.quota.quota_code}</Tag>
                    <Typography.Text strong>{binding.quota.quota_name}</Typography.Text>
                    <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 6 }}>
                      人工 {binding.quota.labor_qty}，材料 {binding.quota.material_qty}，机械 {binding.quota.machine_qty}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {provenance.calc_total != null && (
              <Typography.Title level={5}>合价：¥{Number(provenance.calc_total).toFixed(2)}</Typography.Title>
            )}
            <div className="smart-explain-box" style={{ marginTop: 16 }}>
              <RobotOutlined style={{ color: "var(--primary)", marginRight: 8 }} />
              <Typography.Text strong>计算说明</Typography.Text>
              <div style={{ marginTop: 6, color: "var(--text-secondary)", lineHeight: 1.6 }}>
                {provenance.explanation}
              </div>
            </div>
          </div>
        ) : null}
      </Drawer>
    </div>
  );
}
