import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Table, Tag, Upload, message } from "antd";
import type { UploadProps } from "antd";
import { CloudUploadOutlined, ClearOutlined, DownloadOutlined, FolderAddOutlined } from "@ant-design/icons";
import { api, type IfcElement, type IfcTaskStatus } from "../api";
import Panel from "../components/Panel";
import "../styles/resource-screen.css";
import Ifc3DViewer from "../components/Ifc3DViewer";
import { ErrorBoundary } from "../components/ErrorBoundary";
import ValuationReview from "../components/ValuationReview";

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

function confTag(value: number | undefined) {
  // 全站统一口径：≥80 绿 / ≥60 黄 / 否则红（与定额绑定、图纸识别一致）
  const v = Math.round(Number(value ?? 0) * 100);
  if (v >= 80) return <Tag color="green" className="num">{v}%</Tag>;
  if (v >= 60) return <Tag color="gold" className="num">{v}%</Tag>;
  return <Tag color="red" className="num">{v}%</Tag>;
}

function toViewerElements(result: IfcTaskStatus | null): IfcElement[] {
  if (!result) return [];
  const full = result.elements ?? [];
  const preview = result.preview_elements ?? [];
  if (preview.length) return preview;
  return full;
}

/* ─── BIM 蓝图：等轴测幽灵建筑，楼层随解析进度生长 ─── */

const ISO_R = 0.866;

function isoProject(ox: number, oy: number, u: number, v: number, z: number) {
  return [ox + (u - v) * ISO_R, oy + (u + v) * 0.5 - z] as const;
}

/** 等轴测多边形：给 z1 时生成侧面四边形，否则生成 z0 处的水平面 */
function isoPolygon(ox: number, oy: number, pts: Array<[number, number]>, z0: number, z1?: number) {
  const project = ([u, v]: [number, number], z: number) => {
    const [x, y] = isoProject(ox, oy, u, v, z);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  };
  if (z1 === undefined) return pts.map((point) => project(point, z0)).join(" ");
  return [...pts.map((point) => project(point, z0)), ...pts.slice().reverse().map((point) => project(point, z1))].join(" ");
}

type IsoTowerProps = {
  ox: number;
  oy: number;
  w: number;
  d: number;
  floors: number;
  floorHeight: number;
  progress: number;
};

/** 单栋楼：未点亮为虚线幽灵，进度越过该层阈值后实线点亮 */
function IsoTower({ ox, oy, w, d, floors, floorHeight, progress }: IsoTowerProps) {
  const height = floors * floorHeight;
  const rightEdge: Array<[number, number]> = [[0, 0], [w, 0]];
  const leftEdge: Array<[number, number]> = [[0, 0], [0, d]];
  const roofRing: Array<[number, number]> = [[0, 0], [w, 0], [w, d], [0, d]];
  const mullions = [
    ...[w / 3, (w * 2) / 3].map((u) => ({ u, v: 0 })),
    ...[d / 3, (d * 2) / 3].map((v) => ({ u: 0, v })),
  ];
  return (
    <g>
      {Array.from({ length: floors }, (_, index) => {
        const z0 = index * floorHeight;
        const z1 = z0 + floorHeight;
        const lit = progress > 0 && progress >= (index / floors) * 100;
        const rightFace = isoPolygon(ox, oy, rightEdge, z0, z1);
        const leftFace = isoPolygon(ox, oy, leftEdge, z0, z1);
        return (
          <g key={`floor-${index}`}>
            <polygon className="ifc-x-face-ghost" points={rightFace} />
            <polygon className="ifc-x-face-ghost" points={leftFace} />
            <polygon className={`ifc-x-face-lit${lit ? " is-on" : ""}`} points={rightFace} />
            <polygon className={`ifc-x-face-lit${lit ? " is-on" : ""}`} points={leftFace} />
          </g>
        );
      })}
      {mullions.map((line, index) => {
        const [x1, y1] = isoProject(ox, oy, line.u, line.v, 0);
        const [x2, y2] = isoProject(ox, oy, line.u, line.v, height);
        return <line key={`mullion-${index}`} className="ifc-x-mullion" x1={x1} y1={y1} x2={x2} y2={y2} />;
      })}
      <g className={`ifc-x-roof${progress >= 95 ? " is-on" : ""}`}>
        <polygon points={isoPolygon(ox, oy, roofRing, height)} />
      </g>
    </g>
  );
}

/** 空态 / 构建态共用蓝图：场地轮廓 + 主楼副楼 + 尺寸标注与楼层刻度 */
function IfcBlueprint({ progress, done }: { progress: number; done: boolean }) {
  const main = { ox: 545, oy: 450, w: 250, d: 185, floors: 10, floorHeight: 24 };
  const annex = { ox: 853, oy: 575, w: 135, d: 105, floors: 5, floorHeight: 20 };
  const mainHeight = main.floors * main.floorHeight;
  const [tickBaseX, tickBaseY] = isoProject(main.ox, main.oy, 0, main.d, 0);
  const tickX = tickBaseX - 40;
  const [frontX, frontY] = isoProject(main.ox, main.oy, 0, 0, 0);
  const [rightX, rightY] = isoProject(main.ox, main.oy, main.w, 0, 0);
  const [leftX, leftY] = isoProject(main.ox, main.oy, 0, main.d, 0);
  const dimOffset = 32;
  const rightMidX = (frontX + rightX) / 2;
  const rightMidY = (frontY + rightY) / 2 + dimOffset + 14;
  const leftMidX = (frontX + leftX) / 2;
  const leftMidY = (frontY + leftY) / 2 + dimOffset + 14;
  return (
    <div className="ifc-x-blueprint" aria-hidden="true">
      <svg viewBox="0 0 1200 880" preserveAspectRatio="xMidYMid meet">
        <defs>
          <linearGradient id="ifc-x-done-glow" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#4dd4ff" stopOpacity="0.26" />
            <stop offset="55%" stopColor="#4dd4ff" stopOpacity="0.08" />
            <stop offset="100%" stopColor="#4dd4ff" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* 场地轮廓与建筑基座 */}
        <polygon className="ifc-x-site" points="600,365 1040,605 600,845 160,605" />
        <polygon
          className="ifc-x-pad"
          points={isoPolygon(main.ox, main.oy, [[-18, -18], [main.w + 18, -18], [main.w + 18, main.d + 18], [-18, main.d + 18]], 0)}
        />
        <polygon
          className="ifc-x-pad"
          points={isoPolygon(annex.ox, annex.oy, [[-14, -14], [annex.w + 14, -14], [annex.w + 14, annex.d + 14], [-14, annex.d + 14]], 0)}
        />

        <IsoTower {...main} progress={progress} />
        <IsoTower {...annex} progress={progress} />

        {/* 左侧楼层刻度 */}
        <g>
          <line className="ifc-x-dim-line" x1={tickX} y1={tickBaseY - mainHeight} x2={tickX} y2={tickBaseY} />
          {Array.from({ length: main.floors + 1 }, (_, level) => {
            const y = tickBaseY - level * main.floorHeight;
            return (
              <g key={`tick-${level}`}>
                <line className="ifc-x-floor-tick" x1={tickX - 6} y1={y} x2={tickX + 4} y2={y} />
                {level > 0 && (
                  <text className="ifc-x-floor-label" x={tickX - 11} y={y + 3} textAnchor="end" fontSize="10">
                    {level}F
                  </text>
                )}
              </g>
            );
          })}
        </g>

        {/* 建筑底部尺寸标注 */}
        <g>
          <line className="ifc-x-dim-line" x1={frontX} y1={frontY + dimOffset} x2={rightX} y2={rightY + dimOffset} />
          <line className="ifc-x-dim-tick" x1={frontX} y1={frontY + dimOffset - 5} x2={frontX} y2={frontY + dimOffset + 5} />
          <line className="ifc-x-dim-tick" x1={rightX} y1={rightY + dimOffset - 5} x2={rightX} y2={rightY + dimOffset + 5} />
          <text
            className="ifc-x-dim-text"
            x={rightMidX}
            y={rightMidY}
            textAnchor="middle"
            fontSize="11"
            transform={`rotate(30 ${rightMidX} ${rightMidY})`}
          >
            25.0 m
          </text>
          <line className="ifc-x-dim-line" x1={frontX} y1={frontY + dimOffset} x2={leftX} y2={leftY + dimOffset} />
          <line className="ifc-x-dim-tick" x1={leftX} y1={leftY + dimOffset - 5} x2={leftX} y2={leftY + dimOffset + 5} />
          <text
            className="ifc-x-dim-text"
            x={leftMidX}
            y={leftMidY}
            textAnchor="middle"
            fontSize="11"
            transform={`rotate(-30 ${leftMidX} ${leftMidY})`}
          >
            18.5 m
          </text>
        </g>

        {/* 完成态：顶部静态光晕（不闪烁） */}
        {done && (
          <g className="ifc-x-done-glow">
            <polygon points="430,0 780,0 650,250 500,250" fill="url(#ifc-x-done-glow)" />
            <ellipse cx="575" cy="236" rx="170" ry="26" fill="rgba(77, 212, 255, 0.12)" />
          </g>
        )}
      </svg>
    </div>
  );
}

export default function IfcParser() {
  const navigate = useNavigate();
  const [taskId, setTaskId] = useState("");
  const [fileName, setFileName] = useState("");
  const [result, setResult] = useState<IfcTaskStatus | null>(null);
  const [projectId, setProjectId] = useState<number>();
  const [uploading, setUploading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [bottomTab, setBottomTab] = useState<BottomTab>(null);
  const [panelOpen, setPanelOpen] = useState(() => typeof window === "undefined" || window.innerWidth > 1024);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // 解析完成一次后自动触发套价（防重复触发）
  const autoValuatedRef = useRef(false);

  // TEMP: perf-tour loader for browser testing, removed after verification.
  useEffect(() => {
    if (!new URLSearchParams(window.location.search).has("perf-tour")) return undefined;
    void (async () => {
      try {
        const response = await fetch(`${import.meta.env.BASE_URL}models/museum-complex.walk.json`);
        const raw = (await response.json()) as { elements?: IfcElement[] };
        const tour: IfcTaskStatus = {
          taskId: "perf-tour",
          status: "done",
          summary: "perf-tour",
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
        setResult(tour);
        setFileName("perf-tour-model");
        setTaskId("perf-tour");
      } catch (error) {
        console.error("perf tour load failed", error);
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

  // 构建 HUD：全部由既有进度 / 计数派生，不引入额外定时器
  const hudSteps = ["读取 IFC 模型", "解析空间结构", "提取工程量", "生成清单与套价"];
  const builtFloors = progress <= 0 ? 0 : Math.min(10, Math.floor(progress / 10) + 1);
  const activeStep = uploading ? 0 : progress >= 80 ? 3 : progress >= 55 ? 2 : progress >= 20 ? 1 : 0;
  const phaseTitle = uploading
    ? "上传 IFC 文件"
    : progress >= 80
      ? "生成清单并匹配定额"
      : progress >= 55
        ? "提取构件工程量"
        : progress >= 20
          ? "解析空间结构与构件"
          : "读取 IFC 模型数据";
  const logLine = uploading
    ? `接收文件 ${fileName || "-"}`
    : progress >= 80
      ? `已识别 ${compCount} 个构件，正在生成清单建议`
      : progress >= 55
        ? `正在计算 ${compCount} 个构件的工程量`
        : compCount > 0
          ? `已识别 ${compCount} 个构件，正在聚合`
          : "等待解析引擎返回首批构件";
  const ringRadius = 18;
  const ringLength = 2 * Math.PI * ringRadius;
  const ringOffset = ringLength * (1 - Math.min(100, Math.max(0, progress)) / 100);

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

  useEffect(() => {
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
    let failures = 0;
    timerRef.current = setInterval(async () => {
      try {
        const data = await api.getIfcParseResult(id);
        failures = 0;
        applyStatus(data);
        if (data.status === "done") {
          if (timerRef.current) clearInterval(timerRef.current);
          message.success("IFC 解析完成，正在自动生成清单并套定额...");
          // 解析完成自动触发套价（仅首次）
          if (!autoValuatedRef.current) {
            autoValuatedRef.current = true;
            void triggerAutoValuation(id);
          }
        } else if (data.status === "error") {
          if (timerRef.current) clearInterval(timerRef.current);
          message.error(data.error || "IFC 解析失败");
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "查询 IFC 解析任务失败";
        if (msg.includes("任务不存在")) {
          // 后端重启会丢失内存任务，明确告知而不是无限轮询
          if (timerRef.current) clearInterval(timerRef.current);
          message.error("解析任务已丢失（后端服务可能重启过），请重新上传 IFC 文件");
          return;
        }
        // 瞬时错误容忍：连续 5 次失败才放弃，避免一次网络抖动中断跟踪
        failures += 1;
        if (failures >= 5) {
          if (timerRef.current) clearInterval(timerRef.current);
          message.error(msg);
        }
      }
    }, 1200);
  };

  /** 触发自动套价（后端创建独立项目并匹配定额、计价），完成后轮询 */
  const triggerAutoValuation = async (id: string) => {
    try {
      const data = await api.autoValuateIfcParseResult(id);
      applyStatus(data);
      if (data.valuation_status === "done" || data.valuation_status === "error" || data.valuation_status === "skipped") {
        handleValuationResult(data);
      } else {
        pollValuation(id);
      }
    } catch (err) {
      message.error(err instanceof Error ? err.message : "自动套价提交失败");
    }
  };

  const uploadProps: UploadProps = {
    accept: ".ifc,.ifczip",
    showUploadList: false,
    beforeUpload: async (file) => {
      if (file.size > 150 * 1024 * 1024) {
        message.error("IFC 文件超过 150MB 上限，请先拆分或压缩模型");
        return Upload.LIST_IGNORE;
      }
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

  /** 轮询等待自动套价后台任务完成 */
  const pollValuation = (id: string) => {
    if (timerRef.current) clearInterval(timerRef.current);
    let failures = 0;
    timerRef.current = setInterval(async () => {
      try {
        const data = await api.getIfcParseResult(id);
        failures = 0;
        applyStatus(data);
        if (data.valuation_status === "done" || data.valuation_status === "error" || data.valuation_status === "skipped") {
          if (timerRef.current) clearInterval(timerRef.current);
          handleValuationResult(data);
        }
      } catch {
        failures += 1;
        if (failures >= 5) {
          if (timerRef.current) clearInterval(timerRef.current);
          message.error("轮询套价结果失败，请在项目台账中查看");
        }
      }
    }, 2000);
  };

  /** 处理自动套价完成后的结果展示 */
  const handleValuationResult = (data: IfcTaskStatus) => {
    const v = data.valuation;
    if (data.valuation_status === "error") {
      message.error(data.valuation_error || "自动套价失败");
    } else if (data.valuation_status === "skipped") {
      message.warning(data.valuation_error || "未生成可计价清单");
    } else if (v?.project_id) {
      message.success(
        `自动套价完成：${v.boq_items_created ?? 0} 条清单，匹配 ${v.matched ?? 0} 条定额，右侧可进入项目`,
      );
    } else {
      message.warning("套价已结束但未生成项目");
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
    autoValuatedRef.current = false;
    setTaskId("");
    setFileName("");
    setResult(null);
    setBottomTab(null);
    message.info("已清空 BIM 解析结果，可重新上传模型");
  };

  return (
    <div className="ifc-root">
      {/* 单条顶部工具栏 */}
      <header className="ifc-topbar">
        <div className="ifc-topbar-left">
          <span className="material-symbols-outlined ifc-topbar-icon">view_in_ar</span>
          <span className={fileName ? "ifc-topbar-file" : "ifc-topbar-sub"}>{fileName || "IFC · IFCZIP · BIM 构件解析"}</span>
        </div>
        {/* 摘要指标：构件 / 网格 / 清单 / 造价 */}
        <div className="screen-metrics is-compact ifc-topbar-metrics">
          <div className="screen-metric">
            <span className="material-symbols-outlined screen-metric-icon">widgets</span>
            <div className="screen-metric-body">
              <span className="screen-metric-label">构件</span>
              <span className="screen-metric-value">{compCount}</span>
            </div>
          </div>
          <div className="screen-metric">
            <span className="material-symbols-outlined screen-metric-icon">view_in_ar</span>
            <div className="screen-metric-body">
              <span className="screen-metric-label">网格</span>
              <span className="screen-metric-value">{meshCount}</span>
            </div>
          </div>
          <div className="screen-metric">
            <span className="material-symbols-outlined screen-metric-icon">list_alt</span>
            <div className="screen-metric-body">
              <span className="screen-metric-label">清单</span>
              <span className="screen-metric-value">{boqCount}</span>
            </div>
          </div>
          <div className="screen-metric is-amber">
            <span className="material-symbols-outlined screen-metric-icon">payments</span>
            <div className="screen-metric-body">
              <span className="screen-metric-label">造价</span>
              <span className="screen-metric-value">{grandTotal != null ? money(grandTotal) : "-"}</span>
            </div>
          </div>
        </div>
        <div className="ifc-topbar-actions">
          <Upload {...uploadProps}>
            <Button type="primary" icon={<CloudUploadOutlined />} loading={uploading}>上传</Button>
          </Upload>
          {(taskId || result) && (
            <Button icon={<ClearOutlined />} onClick={resetSession}>重新开始</Button>
          )}
          <Button icon={<DownloadOutlined />} loading={exporting} disabled={!taskId || !isDone} onClick={exportResult}>导出</Button>
        </div>
      </header>

      {/* 全屏 3D 舞台 */}
      <div className="ifc-stage">
        {viewerElements.length > 0 ? (
          <div className="ifc-viewer-host">
            <ErrorBoundary title="3D 视图无法显示" inline>
              <Ifc3DViewer
                elements={viewerElements}
                sceneTitle={fileName ? `IFC 构件预览 - ${fileName}` : "IFC 构件预览"}
                initialViewMode="model"
              />
            </ErrorBoundary>
          </div>
        ) : (
          <div className="ifc-x-empty">
            <div className="ifc-x-grid" aria-hidden="true" />
            <div className="ifc-x-vignette" aria-hidden="true" />
            <IfcBlueprint progress={progress} done={isDone} />
            {!showProgress && !isDone && !isError && (
              <Upload.Dragger {...uploadProps} className="ifc-x-dock" multiple={false}>
                <div className="ifc-x-dock-body">
                  <span className="material-symbols-outlined ifc-x-dock-icon">upload_file</span>
                  <strong className="ifc-x-dock-title">拖入 IFC / IFCZIP 开始解析</strong>
                  <span className="ifc-x-dock-flow">
                    解析构件<span className="ifc-x-dock-arrow">→</span>提取工程量<span className="ifc-x-dock-arrow">→</span>自动套价
                  </span>
                  <span className="ifc-x-dock-formats"><b>IFC</b><b>IFCZIP</b></span>
                </div>
              </Upload.Dragger>
            )}
          </div>
        )}

        {/* 构建 HUD：左下小控制台，完成后收为窄条；进度全部来自既有轮询结果 */}
        {(showProgress || isDone || isError) && (
          <div className={`ifc-x-hud${isDone || isError ? " is-bar" : ""}${isError ? " is-error" : ""}`}>
            {isDone || isError ? (
              <div className="ifc-x-hud-bar">
                <span className="material-symbols-outlined">{isDone ? "check_circle" : "error"}</span>
                <strong>{isDone ? "解析完成" : "解析失败"}</strong>
                <span className="ifc-x-hud-bar-sep">·</span>
                <span className="ifc-x-hud-bar-num">{compCount}</span>
                <span className="ifc-x-hud-bar-unit">个构件</span>
                <span className="ifc-x-hud-bar-sep">·</span>
                <span className="ifc-x-hud-bar-num">{boqCount}</span>
                <span className="ifc-x-hud-bar-unit">项清单</span>
              </div>
            ) : (
              <>
                <div className="ifc-x-hud-head">
                  <span className="ifc-x-hud-eyebrow">BIM BUILD CONSOLE</span>
                  <strong className="ifc-x-hud-title">{phaseTitle}</strong>
                </div>
                <div className="ifc-x-hud-progress">
                  <svg className="ifc-x-ring" viewBox="0 0 44 44" aria-hidden="true">
                    <circle className="ifc-x-ring-track" cx="22" cy="22" r={ringRadius} />
                    <circle
                      className="ifc-x-ring-value"
                      cx="22"
                      cy="22"
                      r={ringRadius}
                      strokeDasharray={ringLength.toFixed(2)}
                      strokeDashoffset={ringOffset.toFixed(2)}
                    />
                  </svg>
                  <div className="ifc-x-hud-percent"><strong>{Math.round(progress)}</strong><span>%</span></div>
                  <div className="ifc-x-hud-note">{progress >= 80 ? "清单 / 套价" : progress >= 55 ? "工程量提取" : "构件识别"}</div>
                </div>
                <div className="ifc-x-hud-counts">
                  <div className="ifc-x-hud-count">
                    <span>已识别构件</span>
                    <strong>{compCount}</strong>
                  </div>
                  <div className="ifc-x-hud-count">
                    <span>已生成楼层</span>
                    <strong>{builtFloors}</strong>
                  </div>
                  <div className="ifc-x-hud-count is-amber">
                    <span>清单项</span>
                    <strong>{boqCount}</strong>
                  </div>
                </div>
                <ol className="ifc-x-hud-steps">
                  {hudSteps.map((label, index) => (
                    <li
                      key={label}
                      className={`ifc-x-hud-step${index < activeStep ? " is-done" : index === activeStep ? " is-active" : ""}`}
                    >
                      <span className="ifc-x-step-mark">{index < activeStep ? "✓" : index === activeStep ? "›" : ""}</span>
                      {label}
                    </li>
                  ))}
                </ol>
                <div className="ifc-x-hud-log" key={logLine}>
                  <span>&gt;</span>{logLine}
                </div>
              </>
            )}
          </div>
        )}

        {/* 右侧浮动面板（可收起，小屏默认收起避免遮挡 3D） */}
        {result && (
          <button
            type="button"
            className={`ifc-panel-toggle${panelOpen ? " is-open" : ""}`}
            onClick={() => setPanelOpen((v) => !v)}
            title={panelOpen ? "收起面板" : "展开面板"}
          >
            <span className="material-symbols-outlined">{panelOpen ? "chevron_right" : "chevron_left"}</span>
          </button>
        )}
        {result && panelOpen && (
          <div className="ifc-float-panel">
            <Panel
              title="解析结果"
              icon="view_in_ar"
              className="ifc-side-panel"
              bodyClassName="ifc-side-body"
              extra={<span>{statusLabel}</span>}
            >
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

            {/* 自动套价生成的项目链接 */}
            {result.valuation?.project_id && (
              <div className="ifc-panel-card ifc-panel-card-highlight">
                <h3><span className="material-symbols-outlined">check_circle</span>套价结果</h3>
                <div className="ifc-panel-meta">
                  <div className="ifc-panel-meta-item"><span>清单</span><strong className="num">{result.valuation.boq_items_created ?? 0} 条</strong></div>
                  <div className="ifc-panel-meta-item"><span>已套定额</span><strong className="num">{result.valuation.matched ?? 0}</strong></div>
                  <div className="ifc-panel-meta-item"><span>合计</span><strong className="num">{money(result.valuation.grand_total)}</strong></div>
                </div>
                <Button
                  type="primary"
                  icon={<FolderAddOutlined />}
                  onClick={() => navigate(`/projects/${result.valuation!.project_id}`)}
                  style={{ width: "100%", marginTop: 8 }}
                >
                  前往套价项目
                </Button>
              </div>
            )}

            {/* 构件分类（含占比） */}
            {byType.length > 0 && (
              <div className="ifc-panel-card">
                <h3><span className="material-symbols-outlined">category</span>构件分类</h3>
                <div className="ifc-type-list">
                  {(() => {
                    const total = byType.reduce((s, item) => s + Number(item.count ?? 0), 0);
                    return byType.map((item) => {
                      const ratio = total > 0 ? Math.round((Number(item.count ?? 0) / total) * 100) : 0;
                      return (
                        <div className="ifc-type-row" key={item.type} title={`${item.count} 个 · ${ratio}%`}>
                          <span className="ifc-type-name">{item.type}</span>
                          <span className="ifc-type-bar"><i style={{ width: `${ratio}%` }} /></span>
                          <span className="ifc-type-count num">{item.count}</span>
                          <span className="ifc-type-ratio num">{ratio}%</span>
                        </div>
                      );
                    });
                  })()}
                </div>
              </div>
            )}
            </Panel>
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
                    { title: "置信度", dataIndex: "confidence", width: 100, render: (value: number) => confTag(value) },
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
                    { title: "置信度", dataIndex: "confidence", width: 100, render: (value: number) => confTag(value) },
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
