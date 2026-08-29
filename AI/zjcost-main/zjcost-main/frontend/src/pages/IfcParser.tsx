import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Select, Table, Upload, message } from "antd";
import type { UploadProps } from "antd";
import { CloudUploadOutlined, ClearOutlined, DownloadOutlined, FolderAddOutlined, PlayCircleOutlined, SaveOutlined } from "@ant-design/icons";
import { api, type IfcElement, type IfcTaskStatus, type Project } from "../api";
import Ifc3DViewer from "../components/Ifc3DViewer";
import ValuationReview from "../components/ValuationReview";
import { createDemoProject } from "../demoProject";

type BottomTab = "elements" | "boq" | "valuation" | "diagnostics" | null;

/** BIM 解析会话缓存：切换页面后返回可恢复上次结果（结果过大时降级为仅存任务号，走后端取回） */
const IFC_SESSION_KEY = "zjcost.ifc.lastSession";

function money(value: number | null | undefined) {
  return `¥${Number(value ?? 0).toLocaleString("zh-CN", { maximumFractionDigits: 2 })}`;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function toViewerElements(result: IfcTaskStatus | null): IfcElement[] {
  if (!result) return [];
  const full = result.elements ?? [];
  const preview = result.preview_elements ?? [];
  if (preview.length) return preview;
  return full;
}

/** 等距投影线框体的三个可见面 + 底座（cx/cy 为原点地面角，w 深 d 进深 h 高） */
function isoFaces(cx: number, cy: number, w: number, d: number, h: number) {
  const X = (dx: number, dy: number) => cx + (dx - dy) * 0.866;
  const Y = (dx: number, dy: number, dz: number) => cy + (dx + dy) * 0.5 - dz;
  const pts = (list: Array<[number, number, number]>) =>
    list.map(([dx, dy, dz]) => `${X(dx, dy).toFixed(1)},${Y(dx, dy, dz).toFixed(1)}`).join(" ");
  return {
    top: pts([[0, 0, h], [w, 0, h], [w, d, h], [0, d, h]]),
    left: pts([[0, 0, h], [0, d, h], [0, d, 0], [0, 0, 0]]),
    right: pts([[0, 0, h], [w, 0, h], [w, 0, 0], [0, 0, 0]]),
    base: pts([[0, 0, 0], [w, 0, 0], [w, d, 0], [0, d, 0]]),
  };
}

/** 单栋线框楼宇：高层带天线与信标呼吸灯 */
function DecoBuilding({ cx, cy, w, d, h, delay }: { cx: number; cy: number; w: number; d: number; h: number; delay: number }) {
  const f = isoFaces(cx, cy, w, d, h);
  const ax = cx + ((w - d) / 2) * 0.866;
  const ay = cy + ((w + d) / 2) * 0.5 - h;
  return (
    <g className="ifc-deco-b" style={{ animationDelay: `${delay}s` }}>
      <polygon className="ifc-deco-base" points={f.base} />
      <polygon points={f.left} />
      <polygon points={f.right} />
      <polygon className="ifc-deco-roof" points={f.top} />
      {h >= 160 && (
        <>
          <line className="ifc-deco-antenna" x1={ax} y1={ay} x2={ax} y2={ay - 24} />
          <circle className="ifc-deco-beacon" cx={ax} cy={ay - 28} r="3">
            <animate attributeName="opacity" values="0.2;1;0.2" dur="2.2s" repeatCount="indefinite" />
          </circle>
        </>
      )}
    </g>
  );
}

/** 舞台四周装饰：轻量立体线框建筑群 + 电路连线 + 角标刻线 + 浮光点 */
function IfcStageDeco() {
  return (
    <div className="ifc-stage-deco" aria-hidden="true">
      <svg viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice">
        {/* 左下建筑群 */}
        <DecoBuilding cx={210} cy={760} w={120} d={90} h={150} delay={0} />
        <DecoBuilding cx={360} cy={800} w={90} d={70} h={210} delay={0.9} />
        <DecoBuilding cx={520} cy={830} w={140} d={100} h={90} delay={1.7} />
        {/* 右侧建筑群 */}
        <DecoBuilding cx={1430} cy={820} w={110} d={80} h={130} delay={0.4} />
        <DecoBuilding cx={1300} cy={860} w={80} d={70} h={190} delay={1.2} />
        {/* 上方悬浮小体块（填补顶部两角空缺） */}
        <DecoBuilding cx={1490} cy={210} w={64} d={54} h={96} delay={2} />
        <DecoBuilding cx={330} cy={200} w={56} d={48} h={74} delay={2.6} />
        {/* 电路连线与节点 */}
        <g className="ifc-deco-links">
          <polyline points="540,846 720,846 720,872 1180,872 1180,838 1360,838" />
          <polyline points="230,700 230,610 330,610" />
          <circle cx="540" cy="846" r="3.5" />
          <circle cx="720" cy="872" r="3.5" />
          <circle cx="1180" cy="872" r="3.5" />
          <circle cx="1360" cy="838" r="3.5" />
          <circle cx="330" cy="610" r="3.5" />
        </g>
        {/* 四角 HUD 刻线 */}
        <g className="ifc-deco-corners">
          <path d="M 24 64 L 24 24 L 64 24" />
          <path d="M 1536 24 L 1576 24 L 1576 64" />
          <path d="M 1576 836 L 1576 876 L 1536 876" />
          <path d="M 64 876 L 24 876 L 24 836" />
        </g>
      </svg>
      <i className="ifc-deco-dot" style={{ left: "18%", top: "30%", animationDelay: "0s" }} />
      <i className="ifc-deco-dot" style={{ left: "30%", top: "62%", animationDelay: "1.4s" }} />
      <i className="ifc-deco-dot" style={{ left: "68%", top: "24%", animationDelay: "2.6s" }} />
      <i className="ifc-deco-dot" style={{ left: "76%", top: "58%", animationDelay: "0.8s" }} />
      <i className="ifc-deco-dot" style={{ left: "12%", top: "78%", animationDelay: "2s" }} />
      <i className="ifc-deco-dot" style={{ left: "88%", top: "70%", animationDelay: "3.2s" }} />
    </div>
  );
}

export default function IfcParser() {
  const navigate = useNavigate();
  const [taskId, setTaskId] = useState("");
  const [fileName, setFileName] = useState("");
  const [result, setResult] = useState<IfcTaskStatus | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState<number>();
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [valuating, setValuating] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [creatingDemo, setCreatingDemo] = useState(false);
  const [bottomTab, setBottomTab] = useState<BottomTab>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // TEMP: perf-demo loader for browser testing, removed after verification.
  useEffect(() => {
    if (!new URLSearchParams(window.location.search).has("perf-demo")) return undefined;
    void (async () => {
      try {
        const response = await fetch(`${import.meta.env.BASE_URL}models/museum-complex.walk.json`);
        const raw = (await response.json()) as { elements?: IfcElement[] };
        const demo: IfcTaskStatus = {
          taskId: "perf-demo",
          status: "done",
          summary: "perf-demo",
          elements: raw.elements ?? [],
          preview_elements: [],
          boq_suggestions: [],
          statistics: {},
          diagnostics: [],
          ifc_schema: "",
          total_elements: raw.elements?.length ?? 0,
          error: null,
          detail_element_count: raw.elements?.length ?? 0,
          preview_element_count: 0,
          aggregated_element_count: 0,
          mesh_element_count: 0,
          valuation: null,
          valuation_status: "",
          valuation_progress: "",
          valuation_progress_percent: 0,
          valuation_error: null,
          progress: "done",
          created_at: null,
          updated_at: null,
          timeout_seconds: 0,
        };
        setResult(demo);
        setFileName("perf-demo-model");
        setTaskId("perf-demo");
      } catch (error) {
        console.error("perf demo load failed", error);
      }
    })();
    return undefined;
  }, []);

  const viewerElements = useMemo(() => toViewerElements(result), [result]);
  const detailRows = useMemo(() => {
    if (!result) return [];
    return result.preview_elements?.length ? result.preview_elements : (result.elements ?? []);
  }, [result]);
  const byType = useMemo(() => {
    if (result?.statistics && Object.keys(result.statistics).length) {
      return Object.entries(result.statistics).map(([type, count]) => ({ type, count }));
    }
    const map = new Map<string, number>();
    for (const item of viewerElements) {
      map.set(item.label || item.type, (map.get(item.label || item.type) ?? 0) + 1);
    }
    return Array.from(map.entries()).map(([type, count]) => ({ type, count }));
  }, [result?.statistics, viewerElements]);

  const status = result?.status;
  const isDone = status === "done";
  const isError = status === "error";
  const isProcessing = status === "processing";
  const showProgress = uploading || isProcessing;
  const progress = (() => {
    if (!result) return 0;
    if (isDone) return 100;
    if (isError) return 0;
    if (typeof result.valuation_progress_percent === "number" && result.valuation_progress_percent > 0) {
      return Math.min(100, Math.max(0, result.valuation_progress_percent));
    }
    if (isProcessing) return 45;
    return 0;
  })();

  const compCount = result?.detail_element_count ?? result?.elements?.length ?? 0;
  const previewCount = viewerElements.length;
  const meshCount = result?.mesh_element_count ?? viewerElements.filter((item) => item.mesh_vertices?.length).length;
  const boqCount = result?.boq_suggestions?.length ?? 0;
  const diagCount = result?.diagnostics?.length ?? 0;
  const matchedCount = result?.valuation?.matched ?? 0;
  const grandTotal = result?.valuation?.grand_total ?? null;

  // 会话恢复：切走再回来时还原上次的 BIM 解析结果（缓存优先，仅存任务号时走后端取回）
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    let cancelled = false;
    try {
      const raw = sessionStorage.getItem(IFC_SESSION_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as { taskId?: string; fileName?: string; result?: IfcTaskStatus | null; projectId?: number };
        if (saved.fileName) setFileName(saved.fileName);
        if (saved.projectId) setProjectId(saved.projectId);
        if (saved.taskId) setTaskId(saved.taskId);
        if (saved.result) {
          setResult(saved.result);
          message.info("已恢复上次的 BIM 解析结果");
        } else if (saved.taskId) {
          void api.getIfcParseResult(saved.taskId).then((data) => {
            if (!cancelled && data) {
              setResult(data);
              message.info("已恢复上次的 BIM 解析结果");
            }
          }).catch(() => undefined);
        }
      }
    } catch { /* 忽略缓存读取失败 */ }
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 会话持久化：任务号 / 文件名 / 结果变化时写入；上传中跳过以免覆盖旧缓存
  useEffect(() => {
    if ((!taskId && !result) || uploading) return;
    try {
      sessionStorage.setItem(IFC_SESSION_KEY, JSON.stringify({ taskId, fileName, result, projectId }));
    } catch {
      // 结果过大超出配额时丢弃构件明细，仅保留任务信息走后端恢复
      try {
        sessionStorage.setItem(IFC_SESSION_KEY, JSON.stringify({
          taskId,
          fileName,
          projectId,
          result: result ? { ...result, elements: [], preview_elements: [] } : null,
        }));
      } catch { /* 忽略配额超限 */ }
    }
  }, [taskId, fileName, result, projectId, uploading]);

  const loadProjects = async () => {
    const res = await api.listProjects({ page_size: 100, sort_by: "updated_at", sort_order: "desc" });
    setProjects(res.items);
    setProjectId((current) => current ?? res.items[0]?.id);
  };

  useEffect(() => {
    void loadProjects();
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const applyStatus = (data: IfcTaskStatus) => {
    setResult(data);
    setTaskId(data.taskId || taskId);
  };

  const poll = (id: string) => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(async () => {
      try {
        const data = await api.getIfcParseResult(id);
        applyStatus(data);
        if (data.status === "done" || data.status === "error") {
          if (timerRef.current) clearInterval(timerRef.current);
          if (data.status === "done") {
            message.success("IFC 解析完成，模型、构件和清单建议已生成");
          } else {
            message.error(data.error || "IFC 解析失败");
          }
        }
      } catch (err) {
        if (timerRef.current) clearInterval(timerRef.current);
        message.error(err instanceof Error ? err.message : "查询 IFC 解析任务失败");
      }
    }, 1200);
  };

  const uploadProps: UploadProps = {
    accept: ".ifc,.ifczip",
    showUploadList: false,
    beforeUpload: async (file) => {
      setUploading(true);
      setFileName(file.name);
      setResult(null);
      setBottomTab(null);
      try {
        const data = await api.uploadIfcFile(file);
        setTaskId(data.taskId);
        setResult(data);
        message.success("IFC 已上传，正在解析构件和工程量");
        poll(data.taskId);
      } catch (err) {
        message.error(err instanceof Error ? err.message : "上传 IFC 失败");
      } finally {
        setUploading(false);
      }
      return false;
    },
  };

  const runAutoValuation = async () => {
    if (!taskId || !isDone) return;
    setValuating(true);
    try {
      const data = await api.autoValuateIfcParseResult(taskId);
      applyStatus(data);
      message.success("IFC 自动套定额和计价已完成");
    } catch (err) {
      message.error(err instanceof Error ? err.message : "IFC 自动套定额失败");
    } finally {
      setValuating(false);
    }
  };

  const saveToProject = async () => {
    if (!taskId || !projectId) return;
    setSaving(true);
    try {
      const res = await api.saveIfcToProject(taskId, projectId);
      message.success(`已保存到项目列表并完成计价：创建 ${res.boq_items_created} 条清单，匹配 ${res.matched} 条定额，合计 ${money(res.grand_total)}`);
      await loadProjects();
      navigate(`/projects/${projectId}`);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "保存到项目失败");
    } finally {
      setSaving(false);
    }
  };

  const saveToNewProject = async () => {
    if (!taskId || !isDone) return;
    setSaving(true);
    try {
      const baseName = (fileName || "BIM模型").replace(/\.(ifc|ifczip)$/i, "");
      const project = await api.createProject({
        name: `${baseName} 工程量套价`,
        region: "CN",
        project_type: "building",
        standard_type: "GB50500",
        description: "由 IFC 模型解析自动生成的工程量、清单建议和计价项目。",
      });
      setProjectId(project.id);
      const res = await api.saveIfcToProject(taskId, project.id);
      message.success(`已新建项目并保存 IFC 成果：创建 ${res.boq_items_created} 条清单，匹配 ${res.matched} 条定额，合计 ${money(res.grand_total)}`);
      await loadProjects();
      navigate(`/projects/${project.id}`);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "新建项目并保存 IFC 失败");
    } finally {
      setSaving(false);
    }
  };

  const startDemo = async () => {
    setCreatingDemo(true);
    try {
      const project = await createDemoProject();
      message.success("已创建演示项目，可用于保存 IFC 清单");
      await loadProjects();
      setProjectId(project.id);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "创建演示项目失败");
    } finally {
      setCreatingDemo(false);
    }
  };

  const exportResult = async () => {
    if (!taskId || !isDone) return;
    setExporting(true);
    try {
      const blob = await api.exportIfcParseResult(taskId);
      downloadBlob(blob, `ifc-parse-result-${taskId}.xlsx`);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "导出 IFC 结果失败");
    } finally {
      setExporting(false);
    }
  };

  const statusLabel = isDone ? "完成" : isError ? "失败" : isProcessing ? "解析中" : "待上传";

  const resetSession = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    sessionStorage.removeItem(IFC_SESSION_KEY);
    setTaskId("");
    setFileName("");
    setResult(null);
    setBottomTab(null);
    message.info("已清空 BIM 解析结果，可重新上传模型");
  };

  return (
    <div className="ifc-root">
      {/* 顶部工具栏 */}
      <header className="ifc-topbar">
        <div className="ifc-topbar-left">
          <span className="material-symbols-outlined ifc-topbar-icon">view_in_ar</span>
          <div>
            <h1 className="ifc-topbar-title">BIM 算量</h1>
            {fileName ? <span className="ifc-topbar-file">{fileName}</span> : <span className="ifc-topbar-sub">IFC · IFCZIP · BIM 构件解析</span>}
          </div>
        </div>
        <div className="ifc-topbar-actions">
          <Upload {...uploadProps}>
            <Button type="primary" icon={<CloudUploadOutlined />} loading={uploading}>上传</Button>
          </Upload>
          {(taskId || result) && (
            <Button icon={<ClearOutlined />} onClick={resetSession}>重新开始</Button>
          )}
          <Button icon={<PlayCircleOutlined />} loading={valuating} disabled={!taskId || !isDone} onClick={runAutoValuation}>自动套定额</Button>
          <Button icon={<DownloadOutlined />} loading={exporting} disabled={!taskId || !isDone} onClick={exportResult}>导出</Button>
        </div>
      </header>

      {/* 全屏 3D 舞台 */}
      <div className="ifc-stage">
        {viewerElements.length > 0 ? (
          <div className="ifc-viewer-host">
            <Ifc3DViewer
              elements={viewerElements}
              sceneTitle={fileName ? `IFC 构件预览 - ${fileName}` : "IFC 构件预览"}
              initialViewMode="model"
            />
          </div>
        ) : (
          <div className="ifc-empty">
            <div className="ifc-empty-grid" />
            <div className="ifc-empty-vignette" />
            <IfcStageDeco />

            {/* 等距 3D 方块示意 */}
            <div className="ifc-empty-iso">
              <svg viewBox="0 0 280 220" preserveAspectRatio="xMidYMid meet">
                <defs>
                  <linearGradient id="ifc-iso-top" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.35" />
                    <stop offset="100%" stopColor="#1e3a5f" stopOpacity="0.2" />
                  </linearGradient>
                  <linearGradient id="ifc-iso-left" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="#1e3a5f" stopOpacity="0.3" />
                    <stop offset="100%" stopColor="#0f1e30" stopOpacity="0.15" />
                  </linearGradient>
                  <linearGradient id="ifc-iso-right" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="#0f1e30" stopOpacity="0.15" />
                    <stop offset="100%" stopColor="#1e3a5f" stopOpacity="0.3" />
                  </linearGradient>
                  <linearGradient id="ifc-iso-scan" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#38bdf8" stopOpacity="0" />
                    <stop offset="50%" stopColor="#38bdf8" stopOpacity="0.45" />
                    <stop offset="100%" stopColor="#38bdf8" stopOpacity="0" />
                  </linearGradient>
                </defs>
                {/* 主体建筑 */}
                <g stroke="#38bdf8" strokeWidth="1.2" opacity="0.7">
                  {/* 顶面 */}
                  <polygon points="140,30 220,70 140,110 60,70" fill="url(#ifc-iso-top)" />
                  {/* 左面 */}
                  <polygon points="60,70 140,110 140,190 60,150" fill="url(#ifc-iso-left)" />
                  {/* 右面 */}
                  <polygon points="220,70 140,110 140,190 220,150" fill="url(#ifc-iso-right)" />
                </g>
                {/* 楼层分隔线 */}
                <g stroke="#38bdf8" strokeWidth="0.8" opacity="0.4" strokeDasharray="3 2">
                  <polygon points="70,85 140,120 140,150 70,115" fill="none" />
                  <polygon points="210,85 140,120 140,150 210,115" fill="none" />
                </g>
                {/* 窗户网格 */}
                <g stroke="#38bdf8" strokeWidth="0.6" opacity="0.35">
                  <line x1="80" y1="95" x2="80" y2="135" />
                  <line x1="100" y1="105" x2="100" y2="145" />
                  <line x1="120" y1="115" x2="120" y2="155" />
                  <line x1="75" y1="105" x2="125" y2="130" />
                  <line x1="75" y1="125" x2="125" y2="150" />
                </g>
                {/* 底座环 + 扫描光带 */}
                <ellipse cx="140" cy="152" rx="118" ry="40" fill="none" stroke="#38bdf8" strokeOpacity="0.3" strokeWidth="1" strokeDasharray="6 6">
                  <animate attributeName="stroke-dashoffset" values="0;-48" dur="3s" repeatCount="indefinite" />
                </ellipse>
                <rect x="26" y="56" width="228" height="12" fill="url(#ifc-iso-scan)" opacity="0.7">
                  <animate attributeName="y" values="40;186;40" dur="4.2s" repeatCount="indefinite" />
                </rect>
                {/* 轴线标注 */}
                <g fill="#64748b" fontSize="8" fontFamily="ui-monospace, monospace" opacity="0.6">
                  <text x="140" y="22" textAnchor="middle">Z</text>
                  <text x="232" y="74" textAnchor="middle">X</text>
                  <text x="52" y="74" textAnchor="middle">Y</text>
                </g>
              </svg>
            </div>

            {result ? (
              /* 已有解析结果但没有网格预览数据：不再显示上传引导，改为说明 + 重新上传入口 */
              <div className="ifc-empty-hint ifc-no-preview">
                <div className="ifc-hint-icon">
                  <span className="material-symbols-outlined">view_in_ar</span>
                </div>
                <strong>该模型未生成三维网格预览</strong>
                <p>已解析 {compCount} 个构件 · {boqCount} 条清单建议 · 明细与套价结果可在下方查看</p>
                <Upload {...uploadProps}>
                  <Button icon={<CloudUploadOutlined />}>重新上传模型</Button>
                </Upload>
              </div>
            ) : (
              /* 中央上传提示 */
              <div className="ifc-empty-hint">
                <div className="ifc-hint-icon">
                  <span className="material-symbols-outlined">upload_file</span>
                </div>
                <strong>上传 IFC / IFCZIP 开始解析</strong>
                <p>自动提取构件 · 计算工程量 · 生成清单与套价</p>
                <div className="ifc-hint-steps">
                  <span><span className="material-symbols-outlined">cloud_upload</span>上传模型</span>
                  <span className="material-symbols-outlined ifc-step-arrow">arrow_forward</span>
                  <span><span className="material-symbols-outlined">view_in_ar</span>构件解析</span>
                  <span className="material-symbols-outlined ifc-step-arrow">arrow_forward</span>
                  <span><span className="material-symbols-outlined">payments</span>一键套价</span>
                </div>
                <div className="ifc-hint-formats">
                  <span>IFC</span><span>IFCZIP</span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* 左上 KPI 浮层 */}
        {result && (
          <div className="ifc-float-kpi">
            <div className="ifc-float-kpi-item">
              <span className="material-symbols-outlined">widgets</span>
              <strong>{compCount}</strong><em>构件</em>
            </div>
            <div className="ifc-float-kpi-item">
              <span className="material-symbols-outlined">view_in_ar</span>
              <strong>{meshCount}</strong><em>网格</em>
            </div>
            <div className="ifc-float-kpi-item">
              <span className="material-symbols-outlined">list_alt</span>
              <strong>{boqCount}</strong><em>清单</em>
            </div>
            <div className="ifc-float-kpi-item">
              <span className="material-symbols-outlined">payments</span>
              <strong>{grandTotal != null ? money(grandTotal) : "-"}</strong>
            </div>
          </div>
        )}

        {/* 左下进度浮层 */}
        {showProgress && (progress > 0 || uploading) && (
          <div className="ifc-float-progress">
            <div className="ifc-float-progress-head">
              <span>{uploading ? "上传中..." : result?.progress || result?.valuation_progress || statusLabel}</span>
              <strong>{progress}%</strong>
            </div>
            <div className="ifc-progress-track">
              <div className="ifc-progress-fill" style={{ width: `${progress}%` }} />
            </div>
          </div>
        )}

        {/* 右侧浮动面板 */}
        {result && (
          <div className="ifc-float-panel">
            {/* 任务概览 */}
            <div className="ifc-panel-card">
              <h3><span className="material-symbols-outlined">info</span>解析概览</h3>
              <p className="ifc-panel-summary">{result.summary || "解析结果将在此显示"}</p>
              <div className="ifc-panel-meta">
                <div className="ifc-panel-meta-item"><span>状态</span><strong>{statusLabel}</strong></div>
                <div className="ifc-panel-meta-item"><span>Schema</span><strong>{result.ifc_schema || "-"}</strong></div>
                <div className="ifc-panel-meta-item"><span>预览构件</span><strong>{previewCount}</strong></div>
                <div className="ifc-panel-meta-item"><span>已套定额</span><strong>{matchedCount}</strong></div>
              </div>
              {result.error && <div className="ifc-diag-list" style={{ marginTop: 10 }}><div className="ifc-diag-item"><span className="material-symbols-outlined">error</span>{result.error}</div></div>}
              {result.valuation_error && <div className="ifc-diag-list" style={{ marginTop: 10 }}><div className="ifc-diag-item"><span className="material-symbols-outlined">warning</span>{result.valuation_error}</div></div>}
            </div>

            {/* 构件分类 */}
            {byType.length > 0 && (
              <div className="ifc-panel-card">
                <h3><span className="material-symbols-outlined">category</span>构件分类</h3>
                <div className="ifc-type-list">
                  {byType.map((item) => (
                    <div className="ifc-type-row" key={item.type}>
                      <span className="ifc-type-name">{item.type}</span>
                      <span className="ifc-type-count">{item.count}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 保存到项目 */}
            <div className="ifc-panel-card">
              <h3><span className="material-symbols-outlined">save</span>保存到项目</h3>
              <div className="ifc-save-row">
                <Select
                  placeholder="选择项目"
                  value={projectId}
                  options={projects.map((project) => ({ value: project.id, label: project.name }))}
                  onChange={setProjectId}
                />
                <div className="ifc-save-actions">
                  <Button icon={<FolderAddOutlined />} loading={creatingDemo} onClick={startDemo}>演示</Button>
                  <Button loading={saving} disabled={!taskId || !isDone} onClick={saveToNewProject}>新建</Button>
                  <Button type="primary" icon={<SaveOutlined />} loading={saving} disabled={!taskId || !isDone || !projectId} onClick={saveToProject}>保存</Button>
                </div>
                <p className="ifc-save-hint">保存后形成独立 BIM 算量项目，可继续复核定额与导出报表。</p>
              </div>
            </div>
          </div>
        )}

        {/* 底部抽屉 */}
        {bottomTab && (
          <div className="ifc-drawer">
            <div className="ifc-drawer-head">
              <h3>{
                bottomTab === "elements" ? "构件明细" :
                bottomTab === "boq" ? "清单建议" :
                bottomTab === "valuation" ? "计价复核" : "诊断信息"
              }</h3>
              <button type="button" className="ifc-drawer-close" onClick={() => setBottomTab(null)}>
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <div className="ifc-drawer-body">
              {bottomTab === "elements" && (
                <Table
                  rowKey="id"
                  size="small"
                  dataSource={detailRows}
                  scroll={{ x: 1100 }}
                  pagination={{ pageSize: 8, size: "small" }}
                  columns={[
                    { title: "类型", dataIndex: "label", width: 120, render: (value: string, row) => value || row.type },
                    { title: "名称", dataIndex: "name", ellipsis: true },
                    { title: "材质", dataIndex: "material", width: 120 },
                    { title: "单位", dataIndex: "unit", width: 80 },
                    { title: "工程量", dataIndex: "quantity_estimate", width: 120, render: (value: number) => Number(value ?? 0).toFixed(3) },
                    { title: "长", dataIndex: "length", width: 90, render: (value: number) => Number(value ?? 0).toFixed(2) },
                    { title: "宽", dataIndex: "width", width: 90, render: (value: number) => Number(value ?? 0).toFixed(2) },
                    { title: "高", dataIndex: "height", width: 90, render: (value: number) => Number(value ?? 0).toFixed(2) },
                    { title: "置信度", dataIndex: "confidence", width: 100, render: (value: number) => `${Math.round(Number(value ?? 0) * 100)}%` },
                  ]}
                />
              )}
              {bottomTab === "boq" && (
                <Table
                  rowKey={(row) => row.source_element_id}
                  size="small"
                  dataSource={result?.boq_suggestions ?? []}
                  scroll={{ x: 980 }}
                  pagination={{ pageSize: 8, size: "small" }}
                  columns={[
                    { title: "编码", dataIndex: "suggested_code", width: 120 },
                    { title: "名称", dataIndex: "suggested_name", ellipsis: true },
                    { title: "单位", dataIndex: "suggested_unit", width: 80 },
                    { title: "工程量", dataIndex: "suggested_quantity", width: 120, render: (value: number) => Number(value ?? 0).toFixed(3) },
                    { title: "构件数", dataIndex: "element_count", width: 90 },
                    { title: "置信度", dataIndex: "confidence", width: 100, render: (value: number) => `${Math.round(Number(value ?? 0) * 100)}%` },
                    { title: "项目特征", dataIndex: "characteristics", ellipsis: true },
                  ]}
                />
              )}
              {bottomTab === "valuation" && (
                <ValuationReview valuation={result?.valuation} />
              )}
              {bottomTab === "diagnostics" && (
                <div className="ifc-diag-list">
                  {(result?.diagnostics?.length ? result.diagnostics : ["暂无诊断信息"]).map((item, idx) => (
                    <div className="ifc-diag-item" key={idx}>
                      <span className="material-symbols-outlined">info</span>
                      {item}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* 底部标签栏 */}
        {result && (
          <div className="ifc-bottom-bar">
            <button type="button" className={`ifc-bottom-tab${bottomTab === "elements" ? " active" : ""}`} onClick={() => setBottomTab(bottomTab === "elements" ? null : "elements")}>
              <span className="material-symbols-outlined">widgets</span>构件明细
              <span className="ifc-tab-badge">{compCount}</span>
            </button>
            <button type="button" className={`ifc-bottom-tab${bottomTab === "boq" ? " active" : ""}`} onClick={() => setBottomTab(bottomTab === "boq" ? null : "boq")}>
              <span className="material-symbols-outlined">list_alt</span>清单建议
              <span className="ifc-tab-badge">{boqCount}</span>
            </button>
            <button type="button" className={`ifc-bottom-tab${bottomTab === "valuation" ? " active" : ""}`} onClick={() => setBottomTab(bottomTab === "valuation" ? null : "valuation")}>
              <span className="material-symbols-outlined">payments</span>计价复核
              {matchedCount > 0 && <span className="ifc-tab-badge">{matchedCount}</span>}
            </button>
            <button type="button" className={`ifc-bottom-tab${bottomTab === "diagnostics" ? " active" : ""}`} onClick={() => setBottomTab(bottomTab === "diagnostics" ? null : "diagnostics")}>
              <span className="material-symbols-outlined">troubleshoot</span>诊断
              {diagCount > 0 && <span className="ifc-tab-badge">{diagCount}</span>}
            </button>
            <span className="ifc-bottom-spacer" />
            <span className="ifc-status-wait" style={{ position: "static", margin: 0 }}>
              <span className="material-symbols-outlined">{isDone ? "check_circle" : isProcessing ? "hourglass_empty" : "info"}</span>
              {statusLabel}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
