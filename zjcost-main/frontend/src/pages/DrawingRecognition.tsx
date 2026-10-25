import { useEffect, useMemo, useRef, useState, type MouseEvent, type WheelEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Empty, Tag, Upload, message } from "antd";
import type { UploadProps } from "antd";
import { ArrowLeftOutlined, BuildOutlined, ClearOutlined, CloudUploadOutlined, DownloadOutlined } from "@ant-design/icons";
import { api } from "../api";
import Panel from "../components/Panel";
import "../styles/resource-screen.css";
import ValuationReview from "../components/ValuationReview";
import FlowGuide from "../components/FlowGuide";
import Ifc3DViewer, { type Element3D } from "../components/Ifc3DViewer";
import CadCanvasViewer, { type CadCanvasViewerHandle, type CadGeometry, type CadRaster } from "../components/CadCanvasViewer";
import { ErrorBoundary } from "../components/ErrorBoundary";

type DrawingResult = Awaited<ReturnType<typeof api.getDrawingResult>>;

/** 解析会话缓存：切换页面后返回可恢复上次结果（结果过大时降级为仅存任务号，走后端取回） */
const DR_SESSION_KEY = "zjcost.dr.lastSession";

/** 演示用预置模型数据：展馆.ifc 的构件网格预览（与 museum-complex.walk.json 同源） */
const MODEL_JSON_URL = `${import.meta.env.BASE_URL}models/museum-complex.walk.json`;
const MODEL_DISPLAY_NAME = "展馆.ifc";
const MODEL_SCENE_TITLE = "展馆 · 自动构建模型";

const MIN_DRAWING_SCALE = 0.6;
const MAX_DRAWING_SCALE = 10;
const CAD_EMBED_START_TIMEOUT_MS = 25000;
const CAD_EMBED_STATUS_INTERVAL_MS = 2000;

function clampDrawingScale(value: number) {
  return Math.min(MAX_DRAWING_SCALE, Math.max(MIN_DRAWING_SCALE, value));
}

function percentFromResult(result: DrawingResult | null) {
  if (!result) return 0;
  if (result.status === "error") return 0;
  if (result.valuation_progress_percent) return result.valuation_progress_percent;
  if (result.status === "done") return 100;
  if (result.status === "processing") return result.progress_percent ?? 35;
  return 0;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function confTag(value: number | undefined) {
  // 全站统一口径：≥80 绿 / ≥60 黄 / 否则红（与定额绑定一致）
  const v = Math.round(Number(value ?? 0) * 100);
  if (v >= 80) return <Tag color="green" className="dr-conf-tag num">{v}%</Tag>;
  if (v >= 60) return <Tag color="gold" className="dr-conf-tag num">{v}%</Tag>;
  return <Tag color="red" className="dr-conf-tag num">{v}%</Tag>;
}

/** 0-1 小数与 0-100 百分数统一为 0-100 */
function normPct(value: number | undefined) {
  const v = Number(value ?? 0);
  const pct = v <= 1 ? v * 100 : v;
  return Math.max(0, Math.min(100, Math.round(pct)));
}

function QualityMetric({ label, pct }: { label: string; pct: number }) {
  const v = normPct(pct);
  return (
    <div className="dr-quality-metric">
      <span>{label}</span>
      <strong className="num">{v}%</strong>
      <span className="dr-metric-bar"><i style={{ width: `${v}%` }} /></span>
    </div>
  );
}

function ringColor(score: number) {
  if (score >= 85) return "#22c55e";
  if (score >= 70) return "#38bdf8";
  return "#f59e0b";
}

function moneyShort(value: number | null | undefined) {
  if (value == null) return "-";
  if (value >= 10000) return `${(value / 10000).toFixed(1)} 万`;
  return value.toLocaleString("zh-CN", { maximumFractionDigits: 0 });
}

type BottomTab = "components" | "boq" | "valuation" | "diagnostics" | null;

const DISCIPLINES = [
  { key: "architecture", icon: "architecture", label: "建筑" },
  { key: "installation", icon: "plumbing", label: "安装" },
] as const;

/** 轻量化三维立体识别动效：由若干透视拉伸的线框体块构成建筑体量，配合扫描平面快速复原空间结构观感 */
function Recognition3DOverlay() {
  const volumes = [
    { x: 46, z: 24, w: 34, h: 30, d: 26 },
    { x: 16, z: 34, w: 22, h: 18, d: 20 },
    { x: 74, z: 30, w: 20, h: 40, d: 22 },
    { x: 52, z: 60, w: 40, h: 22, d: 16 },
  ];
  return (
    <div className="dr-3d-overlay" aria-hidden="true">
      <div className="dr-3d-floor" />
      <div className="dr-3d-scene">
        {volumes.map((v, i) => (
          <div
            key={i}
            className="dr-3d-volume"
            style={{
              left: `${v.x}%`,
              top: `${v.z}%`,
              width: `${v.w}%`,
              height: `${v.d}%`,
              animationDelay: `${i * 0.35}s`,
              ["--voh" as string]: v.h,
            }}
          >
            <span className="dr-3d-face dr-3d-front" />
            <span className="dr-3d-face dr-3d-right" />
            <span className="dr-3d-face dr-3d-top" />
          </div>
        ))}
      </div>
      <div className="dr-3d-scan" />
    </div>
  );
}

/** 自动构建模型进度动效：复用识别阶段的 3D 体块扫描动画，叠加居中进度卡片 */
function BuildingModelOverlay({ progress, modelName }: { progress: number; modelName: string }) {
  const steps = [
    { label: "解析图纸构件", min: 0 },
    { label: "匹配 BIM 构件库", min: 30 },
    { label: "定位基础与轴网", min: 62 },
    { label: "准备施工模拟", min: 85 },
  ];
  const currentIndex = steps.reduce((acc, s, i) => (progress >= s.min ? i : acc), 0);
  return (
    <div className="dr-build-wrap">
      <Recognition3DOverlay />
      <div className="dr-build-card">
        <div className="dr-build-card-icon">
          <span className="material-symbols-outlined">view_in_ar</span>
        </div>
        <h2>正在自动构建模型</h2>
        <p>正在基于识别结果生成 {modelName} 的三维模型</p>
        <div className="dr-build-progress">
          <div className="dr-build-track">
            <div className="dr-build-fill" style={{ width: `${Math.round(progress)}%` }} />
          </div>
          <strong>{Math.round(progress)}%</strong>
        </div>
        <div className="dr-build-steps">
          {steps.map((s, i) => (
            <span
              key={s.label}
              className={`dr-build-step${progress >= s.min ? " done" : ""}${i === currentIndex ? " current" : ""}`}
            >
              <span className="dr-build-step-dot">
                <span className="material-symbols-outlined">
                  {progress >= s.min ? "check" : i === currentIndex ? "sync" : "radio_button_unchecked"}
                </span>
              </span>
              {s.label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function DrawingRecognition() {
  const navigate = useNavigate();
  const [taskId, setTaskId] = useState("");
  const [fileName, setFileName] = useState("");
  const [result, setResult] = useState<DrawingResult | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadSimPct, setUploadSimPct] = useState(0);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [revealIndex, setRevealIndex] = useState(0);
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [panelOpen, setPanelOpen] = useState(true);
  const [bottomTab, setBottomTab] = useState<BottomTab>(null);
  const [activeDiscipline, setActiveDiscipline] = useState<string>("architecture");
  const [modelView, setModelView] = useState<"drawing" | "building" | "model">("drawing");
  const [modelProgress, setModelProgress] = useState(0);
  const [modelElements, setModelElements] = useState<Element3D[]>([]);
  // 解析完成态：HUD 收起为左上角窄状态条，只展示一次后淡出
  const [doneHud, setDoneHud] = useState<{ elements: number | null; boq: number } | null>(null);
  const prevStatusRef = useRef<string | undefined>(undefined);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const revealTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const buildTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const buildTokenRef = useRef(0);
  const dragStartRef = useRef({ pointerX: 0, pointerY: 0, viewX: 0, viewY: 0 });
  const dragRafRef = useRef<number | null>(null);
  const dragLatestRef = useRef<{ dx: number; dy: number } | null>(null);
  const stageTransformRef = useRef<HTMLDivElement | null>(null);
  const cadViewerRef = useRef<CadCanvasViewerHandle | null>(null);
  // 嵌入式 CAD 快速看图：上传 DWG/DXF 后自动启用（预览区直接显示 CAD 原样画面），
  // 内核不可用时自动回退内置渲染，不重复尝试
  const [cadEmbed, setCadEmbed] = useState(false);
  const cadEmbedFailedRef = useRef(false);
  const modelViewRef = useRef(modelView);
  modelViewRef.current = modelView;
  const viewRef = useRef(view);
  const lastGestureTsRef = useRef(0);
  const zoomSettleTimerRef = useRef<number | null>(null);

  // 上传 DWG/DXF 即自动启用 CAD 内核预览（无需手动切换）
  useEffect(() => {
    if (taskId && !cadEmbedFailedRef.current && /\.(dwg|dxf)$/i.test(fileName || "")) {
      setCadEmbed(true);
    }
  }, [taskId, fileName]);

  // 嵌入式 CAD 快速看图：把预览区（避让顶部工具栏/右侧面板/底部条）的
  // 屏幕坐标持续上报后端，查看器进程用无边框置顶窗口实时贴合该区域，
  // 浏览器移动/缩放/滚动/收起面板时跟随，效果等同把 CAD 窗口嵌进网页
  useEffect(() => {
    if (!cadEmbed || !taskId) return;
    let alive = true;
    let started = false;
    let fellBack = false;
    let lastStatusCheck = 0;
    let restarts = 0;

    const measure = () => {
      const stage = stageRef.current;
      if (!stage) return null;
      const sr = stage.getBoundingClientRect();
      let top = sr.top, right = sr.right, bottom = sr.bottom;
      const left = sr.left;
      // 避让浮在预览区上的 UI：顶部专业工具栏、右侧信息面板/折叠钮、底部状态条
      const avoid = (sel: string) => {
        const el = stage.querySelector<HTMLElement>(sel);
        if (!el) return;
        const r = el.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) return;
        if (r.bottom <= sr.top + 90) top = Math.max(top, r.bottom + 8);
        else if (r.left >= sr.right - 340) right = Math.min(right, r.left - 8);
        else if (r.top >= sr.bottom - 130) bottom = Math.min(bottom, r.top - 8);
      };
      avoid(".dr-cad-toolbar");
      avoid(".dr-float-panel");
      avoid(".dr-panel-toggle");
      avoid(".dr-bottom-bar");
      // 进度卡已移到顶部居中（CAD 嵌入时 CAD 窗口顶部让出此区域避免互盖）；
      // 卡片较高不满足 avoid 顶部阈值，单独处理：CAD 窗口上边界压到进度卡之下
      const progEl = stage.querySelector<HTMLElement>(".dr-float-progress");
      if (progEl) {
        const pr = progEl.getBoundingClientRect();
        if (pr.width >= 2 && pr.height >= 2) {
          top = Math.max(top, pr.bottom + 8);
        }
      }
      // 解析 HUD 控制台停在左下角且较高：CAD 窗口下边界让到控制台上方
      const hudEl = stage.querySelector<HTMLElement>(".dr-x-hud-console");
      if (hudEl) {
        const hr = hudEl.getBoundingClientRect();
        if (hr.width >= 2 && hr.height >= 2) {
          bottom = Math.min(bottom, hr.top - 8);
        }
      }
      // 底部抽屉（构件/清单/计价复核/诊断）较高，avoid 的底部判定阈值不够高，
      // 单独处理：抽屉打开时 CAD 窗口下边界让到抽屉顶部之上，避免盖住复核内容
      const drawerEl = stage.querySelector<HTMLElement>(".dr-drawer");
      if (drawerEl) {
        const dr = drawerEl.getBoundingClientRect();
        if (dr.width >= 2 && dr.height >= 2) {
          bottom = Math.min(bottom, dr.top - 8);
        }
      }
      const w = right - left, h = bottom - top;
      if (w < 100 || h < 100) return null;
      // CSS 视口坐标 → 物理屏幕坐标：
      // window.screenX/screenY 已是物理像素（相对扩展桌面原点），
      // getBoundingClientRect 返回 CSS（逻辑）像素，需乘 dpr 转物理像素。
      // 不能把 screenX 也乘 dpr——多显示器 DPI 不一致时（主屏 4K/副屏 1080p）
      // 会放大错位，导致窗口不落在副屏目标位置。
      // CSS 视口坐标 → 物理屏幕坐标：
      // window.screenX/screenY 与 getBoundingClientRect 同为 CSS（逻辑）像素，
      // 屏幕坐标空间定义在 DIP，物理像素 = DIP × devicePixelRatio，
      // 因此 screenX + 视口内偏移 直接相加后整体乘 dpr 即得物理坐标。
      const dpr = window.devicePixelRatio || 1;
      const cx = window.screenX + (window.outerWidth - window.innerWidth) / 2;
      const cy = window.screenY + (window.outerHeight - window.innerHeight);
      // 存在可见的 antd Modal（重挂定额/新增构件弹窗等）：原生 CAD 窗无法被
      // DOM 压住，此时整体让出，避免遮挡居中弹窗的交互
      const hasVisibleModal = Array.from(
        document.querySelectorAll(".ant-modal-wrap"),
      ).some((el) => {
        if ((el as HTMLElement).style.display === "none") return false;
        const modalEl = el.querySelector<HTMLElement>(".ant-modal");
        return !!modalEl && modalEl.offsetWidth > 0 && modalEl.offsetHeight > 0;
      });
      return {
        x: Math.round((cx + left) * dpr),
        y: Math.round((cy + top) * dpr),
        w: Math.round(w * dpr),
        h: Math.round(h * dpr),
        // 切到 3D 模型视图/标签页隐藏时暂停显示（ref 读最新值，坐标流不断）
        visible:
          !document.hidden &&
          modelViewRef.current === "drawing" &&
          !hasVisibleModal,
        // 页面是否持有焦点：看图窗获得焦点时为 false（此时由查看器按
        // 前台窗口判定保持显示）；切到其他软件时为 false → 看图窗跟随隐藏
        pf: document.hasFocus(),
      };
    };

    const fallback = (msg: string) => {
      if (fellBack || !alive) return;
      fellBack = true;
      cadEmbedFailedRef.current = true;
      message.warning(msg || "CAD 内核预览不可用，已切换内置渲染");
      setCadEmbed(false);
      api.stopCadEmbed(taskId).catch(() => {});
    };

    const tick = async () => {
      if (!alive || fellBack) return;
      const rect = measure();
      if (!rect) return;
      try {
        if (!started) {
          started = true;
          let result: { opened: boolean; message?: string } | undefined;
          try {
            const startPromise = api.startCadEmbed(taskId, rect);
            const timeout = new Promise<never>((_, reject) => {
              window.setTimeout(
                () => reject(new Error("cad-embed-timeout")),
                CAD_EMBED_START_TIMEOUT_MS,
              );
            });
            result = await Promise.race([startPromise, timeout]);
          } catch (err) {
            if (alive) {
              fallback(
                err instanceof Error && err.message === "cad-embed-timeout"
                  ? "CAD 内核预览启动超时，已切换内置渲染"
                  : "CAD 内核预览启动失败，已切换内置渲染",
              );
            }
            return;
          }
          if (!alive || fellBack) return;
          if (!result?.opened) {
            // 内核不可用：标记失败并自动回退内置渲染，不再重复尝试
            fallback(result?.message || "未检测到 CAD 快速看图内核，已切换内置渲染");
            return;
          }
          lastStatusCheck = Date.now();
        } else {
          await api.updateCadEmbedRect(taskId, rect);
        }
        if (alive && !fellBack && Date.now() - lastStatusCheck >= CAD_EMBED_STATUS_INTERVAL_MS) {
          lastStatusCheck = Date.now();
          try {
            const status = await api.cadEmbedStatus(taskId);
            if (!alive || fellBack) return;
            if (["failed", "exited", "error", "not_found"].includes(status.state)) {
              // 后端重启/查看器意外退出后自动重连（驻留实例秒级复用），
              // 最多 2 次仍失败才回退内置渲染
              if (restarts < 2) {
                restarts += 1;
                started = false;
                return;
              }
              fallback(status.message || "CAD 内核预览已退出，已切换内置渲染");
            }
          } catch {
            // 状态查询瞬时失败由下一轮重试
          }
        }
      } catch { /* 瞬时失败由下一轮补偿 */ }
    };
    tick();
    const iv = setInterval(tick, 120);
    const onVis = () => { if (!document.hidden) tick(); };
    // 焦点切换立即上报：切回页面立刻恢复看图窗，切走（含点击看图窗）立刻更新 pf
    const onFocus = () => { tick(); };
    const onBlur = () => { tick(); };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onFocus);
    window.addEventListener("blur", onBlur);
    window.addEventListener("resize", tick);
    window.addEventListener("scroll", tick, true);
    // 窗口被拖到不同 DPI 的副屏时 devicePixelRatio 会变化：显式监听
    // （MDN 推荐），否则 dpr 变了但无 resize/scroll 事件，坐标换算失真
    const mq = window.matchMedia(
      `(resolution: ${window.devicePixelRatio}dppx)`,
    );
    const onMq = () => { tick(); };
    mq.addEventListener?.("change", onMq);
    // 浏览器直接关闭/刷新时，React unmount 不保证执行，用 pagehide + keepalive fetch
    // 立即通知后端删除坐标文件，cad_viewer 轮询到后毫秒级隐藏看图窗口
    const onPageHide = () => { api.stopCadEmbedKeepalive(taskId); };
    window.addEventListener("pagehide", onPageHide);
    return () => {
      alive = false;
      clearInterval(iv);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("resize", tick);
      window.removeEventListener("scroll", tick, true);
      mq.removeEventListener?.("change", onMq);
      window.removeEventListener("pagehide", onPageHide);
      api.stopCadEmbed(taskId).catch(() => {});
    };
  }, [cadEmbed, taskId]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (revealTimerRef.current) clearInterval(revealTimerRef.current);
      if (buildTimerRef.current) clearInterval(buildTimerRef.current);
      if (dragRafRef.current != null) cancelAnimationFrame(dragRafRef.current);
    };
  }, []);

  // 会话恢复：切走再回来时还原上次的解析结果（缓存优先，仅存任务号时走后端取回）
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    // 注意：StrictMode 开发模式下 effect 会“挂载-清理-再挂载”，
    // 若用 cancelled 标记取消异步取回，第二次挂载又被 restoredRef 跳过，结果永远丢失，
    // 因此这里不做取消，任其完成。
    try {
      const raw = sessionStorage.getItem(DR_SESSION_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as { taskId?: string; fileName?: string; result?: DrawingResult | null };
        if (saved.fileName) setFileName(saved.fileName);
        if (saved.taskId) setTaskId(saved.taskId);
        if (saved.result) {
          setResult(saved.result);
          const discKeyMap: Record<string, string> = { civil: "architecture", water: "installation", electrical: "installation", hvac: "installation", fire: "installation" };
          const topDisc = (saved.result.disciplines ?? []).find((d) => discKeyMap[d.key]);
          if (topDisc) setActiveDiscipline(discKeyMap[topDisc.key]);
          if (saved.result.valuation?.project_id) setBottomTab("valuation");
          else if (saved.result.components?.length) setBottomTab("components");
          message.info("已恢复上次的图纸解析结果");
        } else if (saved.taskId) {
          void api.getDrawingResult(saved.taskId).then(async (data) => {
            if (!data) return;
            // 会话缓存不含大字段：就绪标记在就补拉渲染图/几何，恢复"原样"视图
            let merged = data;
            if (data.cad_raster_ready && !data.cad_raster) {
              try {
                const r = await api.getDrawingRaster(saved.taskId as string);
                if (r.cad_raster?.data_url) merged = { ...merged, cad_raster: r.cad_raster };
              } catch { /* 拉取失败则回退轻量视图 */ }
            }
            if (!merged.cad_raster && data.cad_geometry_ready && !data.cad_geometry) {
              try {
                const g = await api.getDrawingGeometry(saved.taskId as string);
                const geo = g.cad_geometry;
                if (geo?.bbox && geo.bbox.length === 4) {
                  merged = {
                    ...merged,
                    cad_geometry: {
                      ...geo,
                      bbox: [geo.bbox[0], geo.bbox[1], geo.bbox[2], geo.bbox[3]] as [number, number, number, number],
                    },
                  };
                }
              } catch { /* 拉取失败则回退轻量视图 */ }
            }
            setResult(merged);
            message.info("已恢复上次的图纸解析结果");
          }).catch(() => undefined);
        }
      }
    } catch { /* 忽略缓存读取失败 */ }
  }, []);

  // 会话持久化：任务号 / 文件名 / 结果变化时写入；上传中跳过以免覆盖旧缓存。
  // 渲染图/几何/高清 SVG 均为大体积字符串，任何状态下都不落缓存
  // （每 1.2s 对几十 MB 数据 stringify 会打满主线程；恢复时按就绪标记补拉）
  useEffect(() => {
    if ((!taskId && !result) || uploading) return;
    const toSave = result
      ? { ...result, cad_raster: null, cad_geometry: null, preview_svg_hd: "" }
      : result;
    try {
      sessionStorage.setItem(DR_SESSION_KEY, JSON.stringify({ taskId, fileName, result: toSave }));
    } catch {
      try { sessionStorage.setItem(DR_SESSION_KEY, JSON.stringify({ taskId, fileName })); } catch { /* 忽略配额超限 */ }
    }
  }, [taskId, fileName, result, uploading]);

  // 缩放/平移视图同步：状态变化时直写 DOM transform。
  // 混合策略（兼顾核显性能与清晰度）：滚轮/拖拽手势后的 180ms 内用 3D 变换走
  // GPU 合成层（缩放零重绘，不卡）；停止后由 settle 定时器切回 2D 变换，浏览器
  // 按最终比例重新光栅化 SVG，放大恢复清晰。
  useEffect(() => {
    viewRef.current = view;
    const node = stageTransformRef.current;
    if (!node) return;
    const interacting = performance.now() - lastGestureTsRef.current < 180;
    if (zoomSettleTimerRef.current != null) {
      clearTimeout(zoomSettleTimerRef.current);
      zoomSettleTimerRef.current = null;
    }
    if (interacting) {
      node.style.willChange = "transform";
      node.style.transform = `translate3d(${view.x}px, ${view.y}px, 0) scale(${view.scale})`;
      zoomSettleTimerRef.current = window.setTimeout(() => {
        zoomSettleTimerRef.current = null;
        node.style.willChange = "";
        const v = viewRef.current;
        node.style.transform = `translate(${v.x}px, ${v.y}px) scale(${v.scale})`;
      }, 200);
    } else {
      node.style.willChange = "";
      node.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.scale})`;
    }
  }, [view]);

  useEffect(() => () => {
    if (zoomSettleTimerRef.current != null) clearTimeout(zoomSettleTimerRef.current);
  }, []);

  useEffect(() => {
    if (revealTimerRef.current) clearInterval(revealTimerRef.current);
    const count = result?.components?.length ?? 0;
    if (!count || (!result?.preview_svg_hd && !result?.preview_svg && !result?.cad_geometry?.bbox)) {
      setRevealIndex(0);
      return;
    }
    setRevealIndex(0);
    // 解析完成后一次性显示全部高亮，避免持续操作大量 SVG 节点造成卡顿
    if (result?.status === "done") {
      setRevealIndex(count);
      return;
    }
    // 拖动期间暂停 reveal 动画，避免拖动时 setInterval 触发 DOM 操作导致掉帧
    if (dragging) return;
    revealTimerRef.current = setInterval(() => {
      setRevealIndex((current) => {
        if (current >= count) {
          if (revealTimerRef.current) clearInterval(revealTimerRef.current);
          return current;
        }
        return current + 1;
      });
    }, result.status === "processing" ? 420 : 240);
    return () => {
      if (revealTimerRef.current) clearInterval(revealTimerRef.current);
    };
  }, [result?.components?.length, result?.preview_svg, result?.preview_svg_hd, result?.cad_geometry, result?.status, dragging]);

  useEffect(() => {
    setView({ scale: 1, x: 0, y: 0 });
    setDragging(false);
  }, [taskId]);

  const [svgMountReady, setSvgMountReady] = useState(false);
  useEffect(() => {
    if (result?.status === "done" && (result.preview_svg_hd || result.preview_svg || result.cad_geometry?.bbox)) {
      const timer = window.setTimeout(() => setSvgMountReady(true), 350);
      return () => window.clearTimeout(timer);
    }
    setSvgMountReady(false);
    return undefined;
  }, [result?.status, result?.preview_svg, result?.preview_svg_hd, result?.cad_geometry]);

  // 内置 CAD 快速看图（WebGL）几何数据：优先于 SVG 预览使用，
  // 数万图元一次 draw call 渲染，缩放平移不卡顿
  // 快速看图几何：解析中即显示（GPU 渲染不卡主线程），
  // 高清原图就绪后由 CadCanvasViewer 按栅格优先策略自动替换
  const cadGeometry = useMemo<CadGeometry | null>(() => {
    const geo = result?.cad_geometry;
    if (!geo || !geo.bbox) return null;
    return geo;
  }, [result?.cad_geometry, svgMountReady]);

  // ezdxf 专业绘图引擎渲染的高清原图：栅格优先且不设状态门槛，
  // 渲染一就绪（解析仍在进行）即显示，前端无需等整个解析流程结束
  const cadRaster = useMemo<CadRaster | null>(() => {
    const r = result?.cad_raster;
    if (!r || !r.data_url) return null;
    return r;
  }, [result?.cad_raster, result?.status, svgMountReady]);

  const previewSvg = useMemo(() => {
    // 解析进行中不挂载预览 SVG：大图纸的预览有上万图元，边解析边渲染会拖死主线程。
    // 完成后由分帧挂载（svgChunkMount effect）逐块插入，避免一次性 innerHTML 卡死。
    if (result?.status === "processing") return "";
    if (!svgMountReady) return "";
    const hd = result?.preview_svg_hd || "";
    const sd = result?.preview_svg || "";
    // 高清版超过 4.5MB 时退回标清版（分帧也扛不住的超大图，牺牲清晰度保流畅）
    if (hd.length > 4_500_000 && sd) return sd;
    return hd || sd;
  }, [result?.preview_svg, result?.preview_svg_hd, result?.status, svgMountReady]);

  // 有可显示的图纸内容（WebGL 看图优先，SVG 兜底）
  const hasDrawing = cadGeometry != null || cadRaster != null || previewSvg !== "";

  // 预览挂载：常规图直接 innerHTML（源头已压缩，节点数可控）；
  // 超大 SVG（>800KB 兜底）走 Blob URL + <img> 光栅化，避免数万节点拖死渲染。
  const svgHostRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const host = svgHostRef.current;
    if (!host) return;
    if (!previewSvg) {
      host.innerHTML = "";
      return;
    }
    if (previewSvg.length > 800_000) {
      let blobUrl = "";
      try {
        const blob = new Blob([previewSvg], { type: "image/svg+xml;charset=utf-8" });
        blobUrl = URL.createObjectURL(blob);
      } catch {
        blobUrl = "";
      }
      if (blobUrl) {
        host.innerHTML = "";
        const img = document.createElement("img");
        img.src = blobUrl;
        img.alt = "图纸预览";
        img.className = "dr-svg-bitmap";
        img.draggable = false;
        host.appendChild(img);
        return () => {
          img.src = "";
          URL.revokeObjectURL(blobUrl);
        };
      }
    }
    host.innerHTML = previewSvg;
    return () => {
      host.innerHTML = "";
    };
  }, [previewSvg]);

  // 直接操作 DOM 推进高亮 reveal
  useEffect(() => {
    const host = svgHostRef.current;
    if (!host) return;
    const groups = host.querySelectorAll<SVGElement>(".dr-recognition-highlight");
    groups.forEach((node, index) => {
      const visible = index < revealIndex;
      const current = index === revealIndex - 1;
      node.classList.toggle("is-visible", visible);
      node.classList.toggle("is-current", current);
    });
  }, [revealIndex, previewSvg]);

  const poll = (id: string) => {
    if (timerRef.current) clearInterval(timerRef.current);
    let componentsShown = false;
    let failures = 0;
    // 完整结果（含数 MB 预览 SVG）只在识别完成与计价完成时各拉一次；
    // 识别完成后计价仍在进行期间，若每 1.2s 都重拉完整结果，7MB 下载+解析
    // 会反复打满主线程，页面表现为卡死。中间轮询一律用轻量数据。
    let fullFetched = false;
    let finalFetched = false;
    // 快速看图几何（十余秒）与高清原图（数分钟）就绪即拉取，解析未完成也能先看图。
    // 之前仅在 status==="processing" 分支内、且 3 次重试内拉取；解析较快/网络抖动/
    // 轮询错过 processing 窗口都会永久缺预览。改为：与解析状态解耦，只要就绪就主动
    // 拉取（成功才置锁，失败下轮继续重试，不设硬上限），杜绝"错过窗口即永久缺失"。
    let geometryLoaded = false;
    let rasterLoaded = false;
    timerRef.current = setInterval(async () => {
      try {
        const data = await api.getDrawingResult(id, false);
        failures = 0;
        const recognitionDone = data.status === "done" || data.status === "error";
        const valuationDone = data.valuation_status === "done" || data.valuation_status === "error" || data.valuation_status === "skipped";

        // —— 预览拉取（与 status 无关）：按就绪标记主动拉取，成功即止 ——
        let latestGeo: { groups: Record<string, number[]>; bbox: [number, number, number, number]; highlights: [number, number, number, number, string][]; texts: [number, number, number, string][] } | null = null;
        if (!geometryLoaded) {
          try {
            const g = await api.getDrawingGeometry(id);
            const geo = g?.cad_geometry;
            if (geo?.bbox && geo.bbox.length === 4) {
              // 接口返回裸数组，规范化为查看器需要的四元组
              latestGeo = {
                ...geo,
                bbox: [geo.bbox[0], geo.bbox[1], geo.bbox[2], geo.bbox[3]] as [number, number, number, number],
              };
              geometryLoaded = true;
            }
          } catch { /* 几何未就绪(404)或网络抖动：下轮按标记重试 */ }
        }
        let latestRaster: { data_url: string; width: number; height: number } | null = null;
        if (!rasterLoaded) {
          try {
            const r = await api.getDrawingRaster(id);
            if (r?.cad_raster?.data_url) {
              latestRaster = r.cad_raster;
              rasterLoaded = true;
            }
          } catch { /* 渲染图未就绪(404)或网络抖动：下轮按标记重试 */ }
        }

        if (data.status !== "processing" && !fullFetched) {
          try {
            const full = await api.getDrawingResult(id);
            fullFetched = true;
            setResult((prev) => ({
              ...full,
              // 完整结果恒把 cad_geometry/cad_raster 置 null，这里用本轮新拉取的覆盖，
              // 未拉到再回退 prev；确保已就绪的预览不会因终态拉取而丢失。
              cad_geometry: latestGeo ?? prev?.cad_geometry ?? full.cad_geometry ?? null,
              cad_raster: latestRaster ?? prev?.cad_raster ?? full.cad_raster ?? null,
            }));
          } catch {
            // 完整结果拉取失败：下一轮重试；本轮先用轻量数据推进状态，
            // 绝不能让 UI 卡在"解析中"（进度条冻结在 93% 的根因）
            setResult((prev) => ({
              ...data,
              cad_geometry: latestGeo ?? prev?.cad_geometry ?? null,
              cad_raster: latestRaster ?? prev?.cad_raster ?? null,
            }));
          }
        } else if (recognitionDone && valuationDone && !finalFetched) {
          finalFetched = true;
          const final = await api.getDrawingResult(id);
          setResult((prev) => ({
            ...final,
            cad_geometry: latestGeo ?? prev?.cad_geometry ?? final.cad_geometry ?? null,
            cad_raster: latestRaster ?? prev?.cad_raster ?? final.cad_raster ?? null,
          }));
        } else {
          // 识别中或尚未到终态：同步进度/计价字段，并保留本轮拉到的预览，
          // 避免 setResult 覆盖成 null 造成预览闪断/永久缺失
          setResult((prev) => prev ? {
            ...prev,
            cad_geometry: latestGeo ?? prev.cad_geometry ?? data.cad_geometry ?? null,
            cad_raster: latestRaster ?? prev.cad_raster ?? data.cad_raster ?? null,
            valuation: data.valuation ?? prev.valuation,
            valuation_status: data.valuation_status,
            valuation_progress: data.valuation_progress,
            valuation_progress_percent: data.valuation_progress_percent,
            valuation_error: data.valuation_error,
          } : data);
        }
        if (recognitionDone && !componentsShown && data.components?.length > 0) {
          setBottomTab("components");
          // 解析结果包含安装专业时，自动切换到安装专业底图
          const discKeyMap: Record<string, string> = { civil: "architecture", water: "installation", electrical: "installation", hvac: "installation", fire: "installation" };
          const topDisc = (data.disciplines ?? []).find((d) => discKeyMap[d.key]);
          if (topDisc) setActiveDiscipline(discKeyMap[topDisc.key]);
          componentsShown = true;
        }
        // 完整结果还没拿到（首次拉取失败待重试）时不停轮询，
        // 否则再也不会重试，预览图永远缺失
        if (recognitionDone && valuationDone && (fullFetched || data.status === "error")) {
          if (timerRef.current) clearInterval(timerRef.current);
          if (data.status === "done") {
            const projectId = data.valuation?.project_id;
            const created = data.valuation?.boq_items_created ?? data.boq_suggestions?.length ?? 0;
            const matched = data.valuation?.matched ?? 0;
            if (projectId) {
              message.success(`图纸识别完成，已自动创建项目并匹配定额：清单 ${created} 条，已匹配定额 ${matched} 条`);
              setBottomTab("valuation");
            } else if (data.valuation_error) {
              message.warning(`图纸识别完成，但自动计价未成功：${data.valuation_error}`);
            } else {
              message.success("图纸识别完成，可查看构件和清单建议");
            }
          } else {
            message.error(data.error || data.valuation_error || "图纸解析失败");
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "查询图纸解析任务失败";
        if (msg.includes("任务不存在")) {
          // 后端重启会丢失任务，明确告知而不是无限轮询
          if (timerRef.current) clearInterval(timerRef.current);
          message.error("解析任务已丢失（后端服务可能重启过），请重新上传图纸");
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

  const uploadProps: UploadProps = {
    accept: ".dwg,.dxf",
    showUploadList: false,
    beforeUpload: async (file) => {
      if (file.size > 100 * 1024 * 1024) {
        message.error("图纸文件超过 100MB 上限，请压缩或拆分后再上传");
        return Upload.LIST_IGNORE;
      }
      setUploading(true);
      setFileName(file.name);
      setResult(null);
      setRevealIndex(0);
      setUploadSimPct(0);
      // 0-100 平滑上传进度模拟：上传期间渐进逼近 92%，完成后补齐到 100%
      let sim = 0;
      setUploadSimPct(0);
      const simTimer = setInterval(() => {
        sim = Math.min(92, sim + Math.max(0.6, (92 - sim) * 0.06));
        setUploadSimPct(Math.round(sim));
      }, 90);
      try {
        const res = await api.uploadDrawing(file);
        clearInterval(simTimer);
        setUploadSimPct(100);
        setTaskId(res.taskId);
        message.success("图纸已上传，正在解析并生成计价项目");
        poll(res.taskId);
      } catch (err) {
        clearInterval(simTimer);
        message.error(err instanceof Error ? err.message : "上传失败");
      } finally {
        setTimeout(() => setUploading(false), 300);
      }
      return false;
    },
  };

  const exportResult = async () => {
    if (!taskId) return;
    try {
      const blob = await api.exportDrawingResult(taskId);
      downloadBlob(blob, `drawing-result-${taskId}.xlsx`);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "导出失败");
    }
  };

  const resetView = () => setView({ scale: 1, x: 0, y: 0 });
  const zoomBy = (delta: number) => setView((c) => ({ ...c, scale: clampDrawingScale(c.scale + delta) }));

  const loadModelElements = async (token: number) => {
    try {
      const res = await fetch(MODEL_JSON_URL);
      if (token !== buildTokenRef.current) return;
      if (!res.ok) throw new Error(`模型数据加载失败 (${res.status})`);
      const raw = (await res.json()) as { elements?: Element3D[] };
      if (token !== buildTokenRef.current) return;
      const elements = Array.isArray(raw.elements) ? raw.elements : [];
      if (!elements.length) throw new Error("模型数据为空");
      setModelElements(elements);
      setModelProgress(100);
      setModelView("model");
    } catch (err) {
      if (token !== buildTokenRef.current) return;
      message.error(err instanceof Error ? err.message : "模型构建失败");
      setModelView("drawing");
    }
  };

  const startModelBuild = () => {
    if (modelView !== "drawing" || result?.status !== "done" || !hasDrawing) return;
    buildTokenRef.current += 1;
    const token = buildTokenRef.current;
    if (buildTimerRef.current) clearInterval(buildTimerRef.current);
    let buildSteps = 0;
    setBottomTab(null);
    setPanelOpen(false);
    setModelView("building");
    setModelProgress(0);
    buildTimerRef.current = setInterval(() => {
      buildSteps += 1;
      const next = Math.min(96, Math.round((buildSteps / 12) * 96));
      setModelProgress(next);
      if (next >= 96) {
        if (buildTimerRef.current) {
          clearInterval(buildTimerRef.current);
          buildTimerRef.current = null;
        }
        void loadModelElements(token);
      }
    }, 320);
  };

  const exitModel = () => {
    buildTokenRef.current += 1;
    if (buildTimerRef.current) {
      clearInterval(buildTimerRef.current);
      buildTimerRef.current = null;
    }
    setModelView("drawing");
    setModelProgress(0);
    setPanelOpen(true);
  };

  const stageRef = useRef<HTMLDivElement | null>(null);

  const handleCanvasWheel = (event: WheelEvent<HTMLDivElement>) => {
    // CAD 看图组件自带滚轮缩放，这里不接管
    if (modelView !== "drawing" || !previewSvg || cadGeometry || cadRaster) return;
    event.preventDefault();
    const stage = stageRef.current;
    if (!stage) return;
    // 以鼠标位置为锚点缩放，放大后鼠标下的图纸点保持在原位
    const rect = stage.getBoundingClientRect();
    const px = event.clientX - rect.left;
    const py = event.clientY - rect.top;
    const factor = event.deltaY > 0 ? 0.88 : 1.12;
    lastGestureTsRef.current = performance.now();
    setView((c) => {
      const nextScale = clampDrawingScale(c.scale * factor);
      if (nextScale === c.scale) return c;
      const ratio = nextScale / c.scale;
      return {
        scale: nextScale,
        x: px - (px - c.x) * ratio,
        y: py - (py - c.y) * ratio,
      };
    });
  };

  const handleCanvasMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    // CAD 看图组件自带拖拽平移，这里不接管
    if (modelView !== "drawing" || !previewSvg || cadGeometry || cadRaster || event.button !== 0) return;
    setDragging(true);
    dragStartRef.current = { pointerX: event.clientX, pointerY: event.clientY, viewX: view.x, viewY: view.y };
    dragLatestRef.current = { dx: 0, dy: 0 };
  };

  const handleCanvasMouseMove = (event: MouseEvent<HTMLDivElement>) => {
    if (!dragging) return;
    const s = dragStartRef.current;
    dragLatestRef.current = { dx: event.clientX - s.pointerX, dy: event.clientY - s.pointerY };
    if (dragRafRef.current != null) return;
    dragRafRef.current = requestAnimationFrame(() => {
      dragRafRef.current = null;
      lastGestureTsRef.current = performance.now();
      const delta = dragLatestRef.current;
      if (!delta) return;
      const base = dragStartRef.current;
      const next = { ...viewRef.current, x: base.viewX + delta.dx, y: base.viewY + delta.dy };
      viewRef.current = next;
      // 拖拽期间直接写 DOM，绕过 React 渲染；松手后一次性同步回状态。
      // 这里故意用 3D translate：拖拽走 GPU 合成层纯平移（纹理已按当前缩放比例光栅化，
      // 不会糊），避免每帧全量重绘大 SVG 造成卡顿；松手后视图同步 effect 会切回 2D 变换。
      const node = stageTransformRef.current;
      if (node) node.style.transform = `translate3d(${next.x}px, ${next.y}px, 0) scale(${next.scale})`;
    });
  };

  const stopDragging = () => {
    if (!dragging) return;
    if (dragRafRef.current != null) {
      cancelAnimationFrame(dragRafRef.current);
      dragRafRef.current = null;
    }
    const delta = dragLatestRef.current;
    if (delta) {
      const base = dragStartRef.current;
      setView((c) => ({ ...c, x: base.viewX + delta.dx, y: base.viewY + delta.dy }));
    }
    dragLatestRef.current = null;
    setDragging(false);
  };

  const resetSession = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    buildTokenRef.current += 1;
    if (buildTimerRef.current) {
      clearInterval(buildTimerRef.current);
      buildTimerRef.current = null;
    }
    sessionStorage.removeItem(DR_SESSION_KEY);
    setSvgMountReady(false);
    setTaskId("");
    setFileName("");
    setResult(null);
    setDoneHud(null);
    setRevealIndex(0);
    setBottomTab(null);
    setModelView("drawing");
    setModelProgress(0);
    setView({ scale: 1, x: 0, y: 0 });
    message.info("已清空解析结果，可重新上传图纸");
  };

  const progress = uploading && !result ? Math.max(uploadSimPct, 1) : percentFromResult(result);
  const currentComponent = result?.components?.[Math.max(0, Math.min(revealIndex - 1, (result?.components?.length ?? 1) - 1))];
  const compCount = result?.components?.length ?? 0;
  const boqCount = result?.boq_suggestions?.length ?? 0;
  const diagCount = result?.diagnostics?.length ?? 0;

  // ── 解析/计价进度派生状态 ────────────────────────────
  const isUploading = uploading && !result;
  const parsing = !!result && result.status === "processing";
  const valuing = !!result && result.valuation_status === "processing";
  const PROG_STEPS = [
    { key: "upload", label: "上传转换", icon: "upload_file" },
    { key: "parse", label: "识别构件", icon: "fact_check" },
    { key: "render", label: "高清渲染", icon: "image" },
    { key: "value", label: "自动计价", icon: "request_quote" },
  ];
  // 依据后端 progress 阶段关键词 + 计价状态，定位当前主步骤
  const progText = result?.progress || "";
  const stepIndex =
    isUploading ? 0
    : valuing ? 3
    : /高清|预览|整理|生成/.test(progText) ? 2
    : /分类|标记|汇总|识别|转换|读取|图层|收集|几何/.test(progText) ? 1
    : parsing ? 1
    : 0;

  // ── 工程解析 HUD：真实计数 + 四段步骤 ────────────────
  const HUD_STEPS = ["快速预览", "图层识别", "构件归类", "清单生成"];
  const layerCount = result?.layer_summary?.length ?? 0;
  const elementCount = (result?.layer_summary ?? []).reduce(
    (sum, row) => sum + (Number(row.count) || 0),
    0,
  );
  const elementText = elementCount > 0 ? elementCount.toLocaleString("zh-CN") : "—";
  const layerText = layerCount > 0 ? String(layerCount) : "—";
  const boqText = boqCount > 0 ? String(boqCount) : "—";
  let hudStepIndex = 0;
  if (!isUploading) {
    hudStepIndex = Math.min(3, Math.floor(progress / 25));
    if (/图层|读取|收集/.test(progText)) hudStepIndex = Math.max(hudStepIndex, 1);
    if (/归类|分类|构件|识别|标记|几何/.test(progText)) hudStepIndex = Math.max(hudStepIndex, 2);
    if (/清单|汇总|生成/.test(progText)) hudStepIndex = Math.max(hudStepIndex, 3);
  }
  const hudLog = result?.progress
    || (isUploading ? "接收文件中 · 校验 DXF 结构" : "建立解析会话 · 等待几何数据");

  useEffect(() => {
    const status = result?.status;
    if (prevStatusRef.current === "processing" && status === "done") {
      setDoneHud({ elements: elementCount > 0 ? elementCount : null, boq: boqCount });
    }
    prevStatusRef.current = status;
  }, [result?.status, elementCount, boqCount]);

  // 窄状态条停留 2s 后淡出，2.4s 后移除；只触发一次，不循环
  useEffect(() => {
    if (!doneHud) return;
    const timer = window.setTimeout(() => setDoneHud(null), 2400);
    return () => window.clearTimeout(timer);
  }, [doneHud]);

  const COMPONENT_COLORS: Record<string, string> = {
    "框架柱": "#2563eb", "构造柱": "#3b82f6", "圈梁": "#60a5fa",
    "框架梁": "#059669", "连梁": "#10b981", "过梁": "#34d399",
    "剪力墙": "#d97706", "墙": "#f59e0b",
    "楼板": "#7c3aed", "板": "#8b5cf6",
    "基础": "#db2777", "楼梯": "#0d9488",
    "门": "#f97316", "窗": "#38bdf8",
    "钢筋": "#dc2626",
    "消防管道": "#dc2626", "喷淋头": "#ef4444", "消火栓": "#dc2626", "消防设备器具": "#f43f5e",
    "给排水管道": "#0ea5e9", "阀门": "#0284c7", "卫生洁具": "#14b8a6",
    "电气配管": "#f59e0b", "电缆电线": "#eab308", "电缆桥架": "#d97706", "电气设备器具": "#fb923c",
    "通风风管": "#6366f1", "暖通设备": "#8b5cf6", "风管部件": "#6366f1",
    "防水层": "#0891b2", "保温隔热层": "#0d9488", "涂料": "#eab308",
    "吊顶": "#a3a3a3", "楼地面": "#78716c", "墙面抹灰": "#d6d3d1",
    "防雷接地": "#facc15", "弱电系统": "#fbbf24",
    "阳台": "#a855f7", "雨篷": "#c084fc",
    "管道支架": "#64748b", "土方工程": "#92400e",
    "脚手架": "#78350f", "模板工程": "#854d0e",
  };

  const componentSummary = useMemo(() => {
    if (!result?.components?.length) return [];
    const summary: Record<string, { type: string; count: number; quantity: number; unit: string }> = {};
    for (const c of result.components) {
      if (!summary[c.type]) {
        summary[c.type] = { type: c.type, count: 0, quantity: 0, unit: c.unit };
      }
      summary[c.type].count += c.count;
      summary[c.type].quantity += c.quantity_estimate || 0;
    }
    return Object.values(summary).sort((a, b) => b.count - a.count);
  }, [result?.components]);

  type DrawingComponent = NonNullable<DrawingResult["components"]>[number];
  const componentsByType = useMemo(() => {
    const grouped = new Map<string, DrawingComponent[]>();
    for (const component of result?.components ?? []) {
      const list = grouped.get(component.type);
      if (list) {
        list.push(component);
      } else {
        grouped.set(component.type, [component]);
      }
    }
    return grouped;
  }, [result?.components]);

  return (
    <div className="dr-root">
      {/* 单条顶部工具栏 */}
      <header className="dr-topbar">
        <div className="dr-topbar-left">
          <span className="material-symbols-outlined dr-topbar-icon">architecture</span>
          <span className="dr-topbar-sub">{modelView !== "drawing" ? "BIM 模型" : "DWG · DXF"}</span>
          {fileName && <span className="dr-topbar-file">{fileName}</span>}
        </div>
        {/* 摘要指标：构件 / 清单 / 定额 / 造价 */}
        <div className="screen-metrics is-compact dr-topbar-metrics">
          <div className="screen-metric">
            <span className="material-symbols-outlined screen-metric-icon">widgets</span>
            <div className="screen-metric-body">
              <span className="screen-metric-label">构件</span>
              <span className="screen-metric-value">{compCount}</span>
            </div>
          </div>
          <div className="screen-metric">
            <span className="material-symbols-outlined screen-metric-icon">list_alt</span>
            <div className="screen-metric-body">
              <span className="screen-metric-label">清单</span>
              <span className="screen-metric-value">{boqCount}</span>
            </div>
          </div>
          <div className="screen-metric">
            <span className="material-symbols-outlined screen-metric-icon">link</span>
            <div className="screen-metric-body">
              <span className="screen-metric-label">定额</span>
              <span className="screen-metric-value">{result?.valuation?.matched ?? 0}</span>
            </div>
          </div>
          <div className="screen-metric is-amber">
            <span className="material-symbols-outlined screen-metric-icon">request_quote</span>
            <div className="screen-metric-body">
              <span className="screen-metric-label">造价</span>
              <span className="screen-metric-value">{moneyShort(result?.valuation?.grand_total)}</span>
            </div>
          </div>
        </div>
        <div className="dr-topbar-actions">
          <Upload {...uploadProps}>
            <Button type="primary" icon={<CloudUploadOutlined />} loading={uploading}>上传</Button>
          </Upload>
          {result?.status === "done" && hasDrawing && (
            <Button
              type={modelView === "drawing" ? "primary" : "default"}
              icon={modelView === "drawing" ? <BuildOutlined /> : <ArrowLeftOutlined />}
              loading={modelView === "building"}
              onClick={modelView === "drawing" ? startModelBuild : exitModel}
            >
              {modelView === "drawing" ? "自动构建模型" : modelView === "building" ? "构建中..." : "返回图纸"}
            </Button>
          )}
          {(taskId || result) && (
            <Button icon={<ClearOutlined />} onClick={resetSession}>重新开始</Button>
          )}
          <Button icon={<DownloadOutlined />} disabled={!taskId || result?.status !== "done"} onClick={exportResult}>导出</Button>
          {result?.valuation?.project_id && (
            <Button type="primary" ghost onClick={() => navigate(`/projects/${result.valuation!.project_id}`)}>进入项目</Button>
          )}
        </div>
      </header>

      {/* 全屏图纸区 */}
      <div
        ref={stageRef}
        className={`dr-stage${dragging ? " is-dragging" : ""}${cadEmbed ? " is-cad-embed" : ""}`}
        onWheel={handleCanvasWheel}
        onMouseDown={handleCanvasMouseDown}
        onMouseMove={handleCanvasMouseMove}
        onMouseUp={stopDragging}
        onMouseLeave={stopDragging}
      >
        {modelView === "drawing" ? (
          <>
        <div className="dr-stage-grid" />

        {/* 顶部专业切换工具条（常驻） */}
        <div className="dr-cad-toolbar">
          {DISCIPLINES.map((disc) => {
            const parsed = (result?.disciplines ?? []).some(
              (d) => (disc.key === "architecture" ? d.key === "civil" : ["water", "electrical", "hvac", "fire", "installation"].includes(d.key)),
            );
            return (
              <button
                key={disc.key}
                type="button"
                className={`dr-cad-tool${activeDiscipline === disc.key ? " active" : ""}`}
                onClick={() => setActiveDiscipline(disc.key)}
                title={parsed ? "解析结果包含该专业" : undefined}
              >
                <span className="material-symbols-outlined">{disc.icon}</span>
                {disc.label}
                {parsed && <i className="dr-cad-tool-dot" />}
              </button>
            );
          })}
        </div>

        {cadEmbed ? (
          /* 嵌入式 CAD 快速看图：此处由原生看图窗口贴合覆盖，
             占位层仅在后端调起期间可见（滚轮缩放/拖拽平移直接操作 CAD） */
          <div className="dr-cad-embed-placeholder">
            <span className="material-symbols-outlined">deployed_code</span>
            <strong>CAD 内核预览启动中…</strong>
            <p>滚轮缩放 · 拖拽平移 · 原样显示</p>
          </div>
        ) : cadGeometry || cadRaster ? (
          /* 内置 CAD 快速看图：优先专业绘图引擎渲染的高清原图，
             WebGL 几何模式兜底；自带滚轮缩放/拖拽平移/双击复位 */
          <ErrorBoundary inline title="CAD 快速看图初始化失败">
            <CadCanvasViewer
              ref={cadViewerRef}
              geometry={cadGeometry ?? { bbox: null, groups: {}, highlights: [], texts: [] }}
              raster={cadRaster}
              revealIndex={revealIndex}
              revealTotal={compCount}
              className="dr-cad-viewer-host"
            />
          </ErrorBoundary>
        ) : previewSvg ? (
          <div ref={stageTransformRef} className="dr-stage-transform" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}>
            <div
              ref={svgHostRef}
              className={`dr-svg-preview is-hd is-revealing${result?.status === "processing" ? " is-fast" : ""}${result?.status === "done" ? " is-done" : ""}`}
            />
          </div>
        ) : (
          <div className="dr-cad-empty">
            <div className="dr-x-blueprint-grid" />
            <div className="dr-cad-vignette" />

            {/* 图纸占位线稿：轴网 + 墙体双线 + 房间标注框 */}
            <svg className="dr-x-sketch" viewBox="0 0 640 420" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
              <g stroke="rgba(96,190,255,.16)" strokeWidth="0.8" strokeDasharray="7 5">
                <line x1="24" y1="60" x2="616" y2="60" />
                <line x1="24" y1="200" x2="616" y2="200" />
                <line x1="24" y1="360" x2="616" y2="360" />
                <line x1="70" y1="32" x2="70" y2="388" />
                <line x1="270" y1="32" x2="270" y2="388" />
                <line x1="470" y1="32" x2="470" y2="388" />
                <line x1="570" y1="32" x2="570" y2="388" />
              </g>
              <g fill="none" stroke="rgba(96,190,255,.34)" strokeWidth="1">
                <circle cx="70" cy="34" r="9" /><circle cx="270" cy="34" r="9" />
                <circle cx="470" cy="34" r="9" /><circle cx="570" cy="34" r="9" />
                <circle cx="44" cy="60" r="9" /><circle cx="44" cy="200" r="9" /><circle cx="44" cy="360" r="9" />
              </g>
              <g fill="rgba(148,196,230,.45)" fontSize="9" fontFamily="ui-monospace, monospace" textAnchor="middle" dominantBaseline="central">
                <text x="70" y="34">A</text><text x="270" y="34">B</text>
                <text x="470" y="34">C</text><text x="570" y="34">D</text>
                <text x="44" y="60">1</text><text x="44" y="200">2</text><text x="44" y="360">3</text>
              </g>
              {/* 外墙双线 */}
              <g stroke="rgba(120,200,255,.36)" fill="none">
                <rect x="70" y="60" width="500" height="300" strokeWidth="1.6" />
                <rect x="78" y="68" width="484" height="284" strokeWidth="1" opacity=".55" />
              </g>
              {/* 内墙双线 */}
              <g stroke="rgba(120,200,255,.3)" strokeWidth="1" fill="none">
                <line x1="266" y1="68" x2="266" y2="352" /><line x1="275" y1="68" x2="275" y2="352" />
                <line x1="78" y1="196" x2="562" y2="196" /><line x1="78" y1="204" x2="562" y2="204" />
                <line x1="470" y1="204" x2="470" y2="352" /><line x1="478" y1="204" x2="478" y2="352" />
              </g>
              {/* 门洞 */}
              <g stroke="rgba(125,211,252,.3)" strokeWidth="0.9" fill="none">
                <path d="M 275 232 A 30 30 0 0 1 305 262" />
                <path d="M 470 120 A 26 26 0 0 0 444 146" />
              </g>
              {/* 房间标注框 */}
              <g stroke="rgba(96,190,255,.24)" strokeWidth="0.7" strokeDasharray="3 3" fill="none">
                <rect x="108" y="104" width="122" height="64" rx="2" />
                <rect x="310" y="104" width="120" height="64" rx="2" />
                <rect x="108" y="240" width="122" height="68" rx="2" />
                <rect x="310" y="240" width="120" height="68" rx="2" />
              </g>
              <g fill="rgba(148,196,230,.5)" fontSize="10" fontFamily="ui-monospace, monospace" textAnchor="middle">
                <text x="169" y="141">客厅</text>
                <text x="370" y="141">餐厅</text>
                <text x="169" y="279">卧室</text>
                <text x="370" y="279">厨房</text>
              </g>
            </svg>

            <div className="dr-cad-demo-badge dr-x-badge"><span className="material-symbols-outlined">info</span>占位线稿 · 非解析结果</div>

            {/* 状态栏（无图纸时不编造坐标/图层/比例） */}
            <div className="dr-cad-statusbar">
              <span><span className="material-symbols-outlined">grid_on</span>坐标: -</span>
              <span><span className="material-symbols-outlined">straighten</span>单位: mm</span>
              <span><span className="material-symbols-outlined">layers</span>图层: -</span>
              <span><span className="material-symbols-outlined">aspect_ratio</span>比例: -</span>
              <span className="dr-cad-status-wait dr-x-status-wait"><span className="material-symbols-outlined">hourglass_empty</span>等待图纸</span>
            </div>

            {/* 上传码头：虚线框 + 图标 + 格式徽标，与线稿错位排布 */}
            <Upload.Dragger
              {...uploadProps}
              className={`dr-x-upload-dock${isUploading || parsing ? " is-parsing" : ""}`}
            >
              <div className="dr-x-dock-icon">
                <span className="material-symbols-outlined">upload_file</span>
              </div>
              <div className="dr-x-dock-title">拖入 DWG / DXF 开始识别</div>
              <div className="dr-x-dock-sub">自动提取构件、生成清单并匹配计价依据</div>
              <div className="dr-x-dock-formats">
                <span>DWG</span><span>DXF</span><span>≤100MB</span>
              </div>
            </Upload.Dragger>
          </div>
        )}

        {/* 工程解析 HUD：1px 扫描线 + 左下控制台 + 右下缩略导航 */}
        {(isUploading || parsing) && (
          <div className={`dr-x-hud${parsing ? " is-parsing" : ""}${panelOpen ? " is-panel-open" : ""}`}>
            {parsing && <div className="dr-x-scanline" aria-hidden="true" />}

            <section className="dr-x-hud-console">
              <div className="dr-x-hud-head">
                <i />
                <span>图纸解析中</span>
                <em>{String(hudStepIndex + 1).padStart(2, "0")} / 04</em>
              </div>
              <div className="dr-x-hud-progress">
                <strong className="dr-x-hud-pct">{progress}<i>%</i></strong>
                <div className="dr-x-hud-bar">
                  <span style={{ width: `${progress}%` }} />
                </div>
              </div>
              <div className="dr-x-hud-counts">
                <div className="dr-x-count-row"><span>图元</span><b>{elementText}</b></div>
                <div className="dr-x-count-row"><span>图层</span><b>{layerText}</b></div>
                <div className="dr-x-count-row"><span>清单项</span><b>{boqText}</b></div>
              </div>
              <ol className="dr-x-hud-steps">
                {HUD_STEPS.map((label, i) => (
                  <li
                    key={label}
                    className={i === hudStepIndex ? "is-current" : i < hudStepIndex ? "is-done" : ""}
                  >
                    <i>{String(i + 1).padStart(2, "0")}</i>{label}
                  </li>
                ))}
              </ol>
              <div className="dr-x-hud-log"><span>›</span>{hudLog}</div>
            </section>

            <aside className="dr-x-minimap" aria-hidden="true">
              <span className="dr-x-minimap-title">图纸缩略导航</span>
              <div className="dr-x-minimap-map">
                <svg viewBox="0 0 80 56" preserveAspectRatio="none">
                  <g stroke="rgba(96,190,255,.28)" strokeWidth="0.7" fill="none">
                    <rect x="6" y="5" width="68" height="46" />
                    <rect x="9" y="8" width="62" height="40" opacity=".45" />
                    <line x1="32" y1="8" x2="32" y2="48" />
                    <line x1="9" y1="27" x2="71" y2="27" />
                  </g>
                  <g stroke="rgba(96,190,255,.16)" strokeWidth="0.5" strokeDasharray="2 2">
                    <line x1="4" y1="14" x2="76" y2="14" />
                    <line x1="4" y1="39" x2="76" y2="39" />
                    <line x1="20" y1="3" x2="20" y2="52" />
                    <line x1="55" y1="3" x2="55" y2="52" />
                  </g>
                </svg>
                <i
                  className="dr-x-minimap-region"
                  style={{ top: `${4 + Math.round((Math.min(100, progress) / 100) * 36)}px` }}
                />
              </div>
            </aside>
          </div>
        )}

        {/* 完成态：HUD 收成左上角窄状态条，2s 后一次性淡出 */}
        {doneHud && (
          <div className="dr-x-hud-done" role="status">
            <span className="material-symbols-outlined">check_circle</span>
            <strong>解析完成</strong>
            <span className="dr-x-sep">·</span>
            <span>{doneHud.elements != null ? `${doneHud.elements.toLocaleString("zh-CN")} 个图元` : "— 个图元"}</span>
            <span className="dr-x-sep">·</span>
            <span>{doneHud.boq > 0 ? `${doneHud.boq} 项清单` : "— 项清单"}</span>
          </div>
        )}

        {/* 缩放控件（仅 SVG 预览模式；CAD 看图组件自带缩放控制） */}
        {previewSvg && !cadGeometry && !cadRaster && (
          <div className="dr-zoom-bar" onMouseDown={(e) => e.stopPropagation()}>
            <button type="button" className="dr-zoom-btn" onClick={() => zoomBy(-0.2)}><span className="material-symbols-outlined">zoom_out</span></button>
            <strong>{Math.round(view.scale * 100)}%</strong>
            <button type="button" className="dr-zoom-btn" onClick={() => zoomBy(0.2)}><span className="material-symbols-outlined">zoom_in</span></button>
            <span className="dr-zoom-sep" />
            <button type="button" className="dr-zoom-btn" onClick={resetView}><span className="material-symbols-outlined">fit_screen</span></button>
          </div>
        )}

        {/* 图纸复位（CAD 看图模式；嵌入模式由 CAD 原生交互接管） */}
        {(cadGeometry || cadRaster) && !cadEmbed && (
          <div className="dr-zoom-bar" onMouseDown={(e) => e.stopPropagation()}>
            <button type="button" className="dr-zoom-btn" onClick={() => cadViewerRef.current?.reset()} title="图纸复位">
              <span className="material-symbols-outlined">fit_screen</span>
            </button>
            <strong>复位</strong>
          </div>
        )}

        {/* 计价进度：沿用顶部居中卡（解析中的信息改由 HUD 承载） */}
        {valuing && !parsing && (
          <div className={`dr-float-progress is-parsing is-${valuing ? "valuing" : "working"}`}>
            <div className="dr-float-progress-lead">
              <span className="dr-progress-icon material-symbols-outlined">
                {isUploading ? "upload_file" : valuing ? "request_quote" : "auto_awesome"}
              </span>
              <div className="dr-progress-title">
                <span className="dr-progress-stage">
                  {isUploading ? "正在上传图纸"
                    : valuing ? "自动计价阶段"
                    : "正在解析图纸"}
                </span>
                <strong>{progress}%</strong>
              </div>
            </div>

            <div className="dr-progress-track dr-progress-track-flow">
              <div className="dr-progress-fill" style={{ width: `${progress}%` }} />
            </div>

            {/* 主步骤指示 */}
            <div className="dr-progress-steps">
              {PROG_STEPS.map((s, i) => (
                <span key={s.key} className={`dr-progress-step${i === stepIndex ? " current" : ""}${i < stepIndex ? " done" : ""}`}>
                  <span className="material-symbols-outlined">{i < stepIndex && stepIndex !== 3 ? "check" : s.icon}</span>
                  {s.label}
                </span>
              ))}
            </div>

            {/* 当前阶段详情 + 实时数据 */}
            <div className="dr-float-progress-meta">
              <span className="dr-progress-detail">
                {isUploading ? "上传中..."
                  : valuing ? result?.valuation_progress || "正在匹配定额..."
                  : result?.progress || "准备中"}
              </span>
              {!isUploading && !valuing && compCount + boqCount > 0 && (
                <span className="dr-progress-counts">
                  <em>构件 {compCount}</em>
                  <em>清单 {boqCount}</em>
                </span>
              )}
            </div>

            {currentComponent && parsing && (
              <div className="dr-float-reveal">
                <span className="material-symbols-outlined">auto_awesome_motion</span>
                正在识别：{currentComponent.type} {currentComponent.spec || ""}
              </div>
            )}
          </div>
        )}

        {/* 右侧面板切换按钮 */}
        <button
          type="button"
          className={`dr-panel-toggle${panelOpen ? " is-open" : ""}`}
          onClick={() => setPanelOpen((v) => !v)}
          title={panelOpen ? "收起面板" : "展开面板"}
        >
          <span className="material-symbols-outlined">{panelOpen ? "chevron_right" : "chevron_left"}</span>
        </button>

        {/* 右侧信息面板 */}
        {panelOpen && (
          <aside className="dr-float-panel">
            <Panel
              title="解析结果"
              icon="fact_check"
              className="dr-side-panel"
              bodyClassName="dr-side-body"
              extra={
                <span className={`dr-confidence-badge ${result?.status === "error" ? "error" : result?.status === "done" ? "real" : "working"}`}>
                  {result?.status === "done" ? "完成" : result?.status === "error" ? "失败" : taskId ? "解析中" : "待上传"}
                </span>
              }
            >
            <div className={`dr-float-panel-scroll${result ? "" : " dr-x-panel-scroll"}`}>
              {result ? (
                <p className="dr-summary">{result.summary || result.progress || "正在解析图纸…"}</p>
              ) : (
                <div className="dr-x-panel-empty">
                  <span className="dr-x-panel-empty-icon material-symbols-outlined">fact_check</span>
                  <strong>{isUploading || taskId ? "正在识别图纸" : "等待识别结果"}</strong>
                  <p>
                    {isUploading || taskId
                      ? "解析任务已建立，构件、清单与计价结果将自动汇总到这里。"
                      : "上传 DWG / DXF 图纸后，构件、清单与计价结果会汇总到这里。"}
                  </p>
                  <Upload {...uploadProps}>
                    <Button type="primary" icon={<CloudUploadOutlined />} loading={uploading}>
                      选择图纸文件
                    </Button>
                  </Upload>
                </div>
              )}

              {result?.quality_score && (
                <div className="dr-zh-card dr-quality-card">
                  <div className="dr-zh-card-head">
                    <h3><span className="material-symbols-outlined">verified</span>解析质量</h3>
                    <span className={`dr-quality-level level-${result.quality_score.level}`}>{result.quality_score.level} 级</span>
                  </div>
                  <div className="dr-quality-score-row">
                    <div
                      className="dr-quality-score-ring"
                      style={{ ["--ring-pct" as string]: result.quality_score.score, ["--ring-color" as string]: ringColor(result.quality_score.score) }}
                      title={`解析质量 ${result.quality_score.score} 分`}
                    >
                      <span className="dr-quality-score-num num">{result.quality_score.score}</span>
                      <span className="dr-quality-score-unit">分</span>
                    </div>
                    <div className="dr-quality-metrics">
                      <QualityMetric label="覆盖" pct={result.quality_score.coverage} />
                      <QualityMetric label="置信" pct={result.quality_score.avg_confidence} />
                      <QualityMetric label="完整" pct={result.quality_score.completeness} />
                      <QualityMetric label="规格" pct={result.quality_score.spec_extraction_rate} />
                    </div>
                  </div>
                  {result.quality_score.issues.length > 0 && (
                    <ul className="dr-quality-issues">
                      {result.quality_score.issues.map((issue, i) => (
                        <li key={i}><span className="material-symbols-outlined">warning</span>{issue}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {result?.disciplines && result.disciplines.length > 0 && (
                <div className="dr-zh-card dr-discipline-card">
                  <div className="dr-zh-card-head">
                    <h3><span className="material-symbols-outlined">category</span>专业</h3>
                    <span className="dr-discipline-count">{result.disciplines.length}</span>
                  </div>
                  <div className="dr-discipline-list">
                    {result.disciplines.map((d) => (
                      <div key={d.key} className={`dr-discipline-item disc-${d.key}`}>
                        <span className="dr-discipline-dot" />
                        <span className="dr-discipline-name">{d.name}</span>
                        <span className="dr-discipline-ratio">{Math.round(d.ratio * 100)}%</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {componentSummary.length > 0 && (
                <div className="dr-zh-card dr-component-summary-card">
                  <div className="dr-zh-card-head">
                    <h3><span className="material-symbols-outlined">widgets</span>构件汇总</h3>
                    <span className="dr-discipline-count">{compCount}类</span>
                  </div>
                  <div className="dr-component-summary-list">
                    {componentSummary.slice(0, 12).map((item) => (
                      <div key={item.type} className="dr-component-summary-item">
                        <span
                          className="dr-component-dot"
                          style={{ backgroundColor: COMPONENT_COLORS[item.type] || "#64748b" }}
                        />
                        <span className="dr-component-name">{item.type}</span>
                        <span className="dr-component-count">{item.count}个</span>
                        <span className="dr-component-qty">
                          {item.quantity > 0 ? `${item.quantity.toFixed(1)}${item.unit}` : ""}
                        </span>
                      </div>
                    ))}
                    {componentSummary.length > 12 && (
                      <div className="dr-component-more">还有 {componentSummary.length - 12} 类构件...</div>
                    )}
                  </div>
                </div>
              )}
            </div>
            </Panel>
          </aside>
        )}

        {/* 底部 Tab 触发条 */}
        <div className="dr-bottom-bar">
          <button type="button" className={`dr-bottom-tab${bottomTab === "components" ? " active" : ""}`} onClick={() => setBottomTab(bottomTab === "components" ? null : "components")}>
            <span className="material-symbols-outlined">widgets</span>构件 <em>{compCount}</em>
          </button>
          <button type="button" className={`dr-bottom-tab${bottomTab === "boq" ? " active" : ""}`} onClick={() => setBottomTab(bottomTab === "boq" ? null : "boq")}>
            <span className="material-symbols-outlined">list_alt</span>清单 <em>{boqCount}</em>
          </button>
          <button type="button" className={`dr-bottom-tab${bottomTab === "valuation" ? " active" : ""}`} onClick={() => setBottomTab(bottomTab === "valuation" ? null : "valuation")}>
            <span className="material-symbols-outlined">request_quote</span>计价
          </button>
          <button type="button" className={`dr-bottom-tab${bottomTab === "diagnostics" ? " active" : ""}`} onClick={() => setBottomTab(bottomTab === "diagnostics" ? null : "diagnostics")}>
            <span className="material-symbols-outlined">bug_report</span>诊断 <em>{diagCount}</em>
          </button>
        </div>

        {/* 底部抽屉 */}
        {bottomTab && (
          <div className="dr-drawer" onMouseDown={(e) => e.stopPropagation()}>
            <div className="dr-drawer-head">
              <h3>{bottomTab === "components" ? "识别构件" : bottomTab === "boq" ? "清单建议" : bottomTab === "valuation" ? "计价复核" : "诊断信息"}</h3>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                {bottomTab === "valuation" && result?.valuation?.project_id && (
                  <span className="dr-drawer-hint">入项目请点顶部“进入项目”</span>
                )}
                <button type="button" className="dr-drawer-close" onClick={() => setBottomTab(null)}>
                  <span className="material-symbols-outlined">close</span>
                </button>
              </div>
            </div>
            <div className="dr-drawer-body">
              {bottomTab === "components" && (
                compCount === 0 ? <Empty description="暂无识别构件" /> : (
                  <div className="dr-table-wrap">
                    <table className="dr-data-table">
                      <thead><tr><th style={{ width: 44 }} /><th>类型</th><th style={{ width: 70 }}>数量</th><th>规格</th><th style={{ width: 60 }}>单位</th><th style={{ width: 100 }}>工程量</th><th style={{ width: 80 }}>置信度</th><th>说明</th></tr></thead>
                      <tbody>
                        {componentSummary.map((grp) => {
                          const open = expandedGroups[grp.type] ?? false;
                          const items = componentsByType.get(grp.type) ?? [];
                          const rowKey = `grp-${grp.type}`;
                          return [
                            <tr key={rowKey} className="dr-group-row" onClick={() => setExpandedGroups((m) => ({ ...m, [grp.type]: !open }))}>
                              <td>
                                <button type="button" className="dr-group-toggle" aria-label={open ? "收起" : "展开"}>
                                  <span className="material-symbols-outlined">{open ? "remove" : "add"}</span>
                                </button>
                              </td>
                              <td>
                                <span className="dr-component-dot" style={{ backgroundColor: COMPONENT_COLORS[grp.type] || "#64748b" }} />
                                <span className="dr-cell-type">{grp.type}</span>
                              </td>
                              <td>{grp.count}</td>
                              <td className="dr-cell-spec">共 {items.length} 类明细</td>
                              <td>{grp.unit}</td>
                              <td className="dr-cell-num">{grp.quantity > 0 ? grp.quantity.toFixed(2) : "-"}</td>
                              <td className="dr-cell-note" colSpan={2}>{open ? "点击收起" : "点击展开明细"}</td>
                            </tr>,
                            ...(open
                              ? items.map((c) => (
                                  <tr key={c.id} className="dr-detail-row">
                                    <td />
                                    <td><span className="dr-cell-type" style={{ marginLeft: 8 }}>{c.type}</span></td>
                                    <td>{c.count}</td>
                                    <td className="dr-cell-spec">{c.spec || "-"}</td>
                                    <td>{c.unit}</td>
                                    <td className="dr-cell-num">{c.quantity_estimate}</td>
                                    <td>{confTag(c.confidence)}</td>
                                    <td className="dr-cell-note">{c.calc_note || "-"}</td>
                                  </tr>
                                ))
                              : []),
                          ];
                        })}
                      </tbody>
                    </table>
                  </div>
                )
              )}
              {bottomTab === "boq" && (
                boqCount === 0 ? <Empty description="暂无清单建议" /> : (
                  <div className="dr-table-wrap">
                    <table className="dr-data-table">
                      <thead><tr><th style={{ width: 120 }}>编码</th><th>名称</th><th style={{ width: 60 }}>单位</th><th style={{ width: 100 }}>工程量</th><th>特征</th><th style={{ width: 80 }}>置信度</th></tr></thead>
                      <tbody>
                        {(result?.boq_suggestions ?? []).map((b) => (
                          <tr key={b.source_component_id}>
                            <td className="dr-cell-code">{b.suggested_code}</td>
                            <td><span className="dr-cell-type">{b.suggested_name}</span></td>
                            <td>{b.suggested_unit}</td>
                            <td className="dr-cell-num">{b.suggested_quantity}</td>
                            <td className="dr-cell-spec">{b.characteristics || "-"}</td>
                            <td>{confTag(b.confidence)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )
              )}
              {bottomTab === "valuation" && <ValuationReview valuation={result?.valuation} />}
              {bottomTab === "diagnostics" && (
                <div className="dr-diag-card">
                  <p className="dr-diag-summary">{result?.summary ?? "暂无解析摘要"}</p>
                  <div className="dr-diag-tags">
                    {(result?.diagnostics ?? []).map((item, i) => <Tag key={i}>{item}</Tag>)}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
          </>
        ) : modelView === "building" ? (
          <BuildingModelOverlay progress={modelProgress} modelName={fileName || MODEL_DISPLAY_NAME} />
        ) : (
          <div className="dr-model-host">
            <ErrorBoundary title="3D 视图无法显示" inline>
              <Ifc3DViewer elements={modelElements} sceneTitle={fileName ? `${fileName} · 自动构建模型` : MODEL_SCENE_TITLE} initialViewMode="model" buildAnimation />
            </ErrorBoundary>
          </div>
        )}
      </div>
      <FlowGuide current="drawings" />
    </div>
  );
}
