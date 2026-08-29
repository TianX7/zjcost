import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button, Empty, Select, Table, Tag, message } from "antd";
import type { BoqItem, CalcProvenance, Project, RateSuggestionResponse } from "../api";
import { api } from "../api";
import PageHeader from "../components/PageHeader";

function asFiniteNumber(value: string | undefined) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function money(value: number | null | undefined) {
  return `¥${Number(value ?? 0).toFixed(2)}`;
}

export default function UnitPriceAnalysis() {
  const { projectId, boqItemId } = useParams<{ projectId: string; boqItemId: string }>();
  const navigate = useNavigate();
  const [projects, setProjects] = useState<Project[]>([]);
  const [boqItems, setBoqItems] = useState<BoqItem[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<number | undefined>(asFiniteNumber(projectId));
  const [selectedBoqItemId, setSelectedBoqItemId] = useState<number | undefined>(asFiniteNumber(boqItemId));
  const [provenance, setProvenance] = useState<CalcProvenance | null>(null);
  const [suggestion, setSuggestion] = useState<RateSuggestionResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingBoq, setLoadingBoq] = useState(false);

  useEffect(() => {
    const routeProjectId = asFiniteNumber(projectId);
    const routeBoqItemId = asFiniteNumber(boqItemId);
    if (routeProjectId) setSelectedProjectId(routeProjectId);
    if (routeBoqItemId) setSelectedBoqItemId(routeBoqItemId);
  }, [projectId, boqItemId]);

  useEffect(() => {
    api.listProjects({ page_size: 100, sort_by: "updated_at", sort_order: "desc" })
      .then((data) => {
        setProjects(data.items);
        setSelectedProjectId((current) => current ?? data.items[0]?.id);
      })
      .catch((err) => message.error(err instanceof Error ? err.message : "加载项目失败"));
  }, []);

  useEffect(() => {
    if (!selectedProjectId) {
      setBoqItems([]);
      return;
    }
    setLoadingBoq(true);
    api.listBoqItems(selectedProjectId)
      .then((items) => {
        setBoqItems(items);
        setSelectedBoqItemId((current) => {
          if (current && items.some((item) => item.id === current)) return current;
          return items[0]?.id;
        });
      })
      .catch((err) => {
        setBoqItems([]);
        message.error(err instanceof Error ? err.message : "加载清单失败");
      })
      .finally(() => setLoadingBoq(false));
  }, [selectedProjectId]);

  const load = useCallback(async () => {
    if (!selectedBoqItemId) {
      setProvenance(null);
      return;
    }
    setLoading(true);
    try {
      setProvenance(await api.getProvenance(selectedBoqItemId));
    } catch (err) {
      setProvenance(null);
      message.error(err instanceof Error ? err.message : "加载单价分析失败");
    } finally {
      setLoading(false);
    }
  }, [selectedBoqItemId]);

  useEffect(() => {
    setSuggestion(null);
    void load();
  }, [load]);

  const suggestRate = async () => {
    if (!selectedBoqItemId) return;
    try {
      setSuggestion(await api.suggestRate(selectedBoqItemId));
    } catch (err) {
      message.error(err instanceof Error ? err.message : "建议失败");
    }
  };

  return (
    <div className="page-container">
      <PageHeader
        icon="analytics"
        title="综合单价分析"
        subtitle="查看清单综合单价来源、定额组成和建议。"
        actions={
          <>
            <Button onClick={() => navigate(selectedProjectId ? `/projects/${selectedProjectId}` : "/projects")}>返回项目</Button>
            <Button type="primary" loading={loading} disabled={!selectedBoqItemId} onClick={suggestRate}>建议单价</Button>
          </>
        }
      />

      {/* 筛选栏：项目选择、清单选择、刷新按钮 */}
      <div className="filter-bar">
        <Select
          placeholder="选择项目"
          value={selectedProjectId}
          onChange={(value) => {
            setSelectedProjectId(value);
            setSelectedBoqItemId(undefined);
          }}
          options={projects.map((project) => ({ value: project.id, label: project.name }))}
          style={{ minWidth: 260 }}
        />
        <Select
          placeholder="选择清单项"
          value={selectedBoqItemId}
          loading={loadingBoq}
          disabled={!selectedProjectId}
          onChange={setSelectedBoqItemId}
          options={boqItems.map((item) => ({ value: item.id, label: `${item.code} ${item.name}` }))}
          style={{ minWidth: 360 }}
          showSearch
          optionFilterProp="label"
        />
        <Button onClick={load} loading={loading} disabled={!selectedBoqItemId}>刷新分析</Button>
      </div>

      {!selectedBoqItemId ? (
        <div className="content-card">
          <div className="content-card-body">
            <Empty description="请选择项目和清单项" />
          </div>
        </div>
      ) : (
        <>
          {/* 清单信息 */}
          <div className="content-card">
            <div className="content-card-head">
              <h3 className="content-card-title"><span className="material-symbols-outlined">description</span>清单信息</h3>
            </div>
            <div className="content-card-body">
              <div className="stat-row">
                <div className="stat-item">
                  <span className="stat-item-label">清单编码</span>
                  <span className="stat-item-value">{provenance?.boq_code ?? "-"}</span>
                </div>
                <div className="stat-item">
                  <span className="stat-item-label">清单名称</span>
                  <span className="stat-item-value">{provenance?.boq_name ?? "-"}</span>
                </div>
                <div className="stat-item">
                  <span className="stat-item-label">单位</span>
                  <span className="stat-item-value">{provenance?.boq_unit ?? "-"}</span>
                </div>
                <div className="stat-item">
                  <span className="stat-item-label">工程量</span>
                  <span className="stat-item-value">{provenance?.boq_quantity ?? "-"}</span>
                </div>
                <div className="stat-item">
                  <span className="stat-item-label">综合单价</span>
                  <span className="stat-item-value accent">{money(provenance?.unit_price)}</span>
                </div>
                <div className="stat-item">
                  <span className="stat-item-label">合价</span>
                  <span className="stat-item-value accent">{money(provenance?.calc_total)}</span>
                </div>
                <div className="stat-item">
                  <span className="stat-item-label">人工价</span>
                  <span className="stat-item-value">{money(provenance?.price_snapshot?.labor_price)}</span>
                </div>
                <div className="stat-item">
                  <span className="stat-item-label">材料价</span>
                  <span className="stat-item-value">{money(provenance?.price_snapshot?.material_price)}</span>
                </div>
                <div className="stat-item">
                  <span className="stat-item-label">机械价</span>
                  <span className="stat-item-value">{money(provenance?.price_snapshot?.machine_price)}</span>
                </div>
              </div>
            </div>
          </div>

          {/* 建议单价 */}
          {suggestion && (
            <div className="content-card">
              <div className="content-card-head">
                <h3 className="content-card-title"><span className="material-symbols-outlined">lightbulb</span>建议</h3>
              </div>
              <div className="content-card-body">
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <Tag color="blue">建议 {money(suggestion.suggested_rate)}</Tag>
                  <Tag>区间 {money(suggestion.rate_low)} - {money(suggestion.rate_high)}</Tag>
                  <Tag color="green">置信度 {Math.round(suggestion.confidence * 100)}%</Tag>
                </div>
                <p style={{ margin: "12px 0 0" }}>{suggestion.reasoning}</p>
              </div>
            </div>
          )}

          {/* 定额绑定 */}
          <div className="content-card">
            <div className="content-card-head">
              <h3 className="content-card-title"><span className="material-symbols-outlined">link</span>定额绑定</h3>
            </div>
            <div className="content-card-body flush">
              <Table
                rowKey="binding_id"
                loading={loading}
                dataSource={provenance?.bindings ?? []}
                columns={[
                  { title: "定额编码", dataIndex: ["quota", "quota_code"], render: (value: string) => <Tag color="blue">{value}</Tag> },
                  { title: "定额名称", dataIndex: ["quota", "quota_name"] },
                  { title: "系数", dataIndex: "coefficient" },
                  { title: "直接费", dataIndex: "direct_cost", render: (value: number | null) => value == null ? "-" : money(value) },
                ]}
              />
            </div>
          </div>

          {/* 计算说明 */}
          <div className="content-card">
            <div className="content-card-head">
              <h3 className="content-card-title"><span className="material-symbols-outlined">info</span>计算说明</h3>
            </div>
            <div className="content-card-body">
              <p style={{ margin: 0 }}>{provenance?.explanation ?? "暂无说明"}</p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
