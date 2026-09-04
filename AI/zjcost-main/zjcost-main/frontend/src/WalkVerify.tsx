import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, ConfigProvider, Progress, Space, Tag, Typography, message, theme } from "antd";
import { ArrowLeftOutlined, CloudUploadOutlined, HomeOutlined, ReloadOutlined } from "@ant-design/icons";
import { api, type IfcElement, type IfcTaskStatus } from "./api";
import Ifc3DViewer, { type Element3D } from "./components/Ifc3DViewer";
import { ErrorBoundary } from "./components/ErrorBoundary";

const WALK_TASK_POLL_LIMIT = 120;
const WALK_TASK_POLL_INTERVAL_MS = 1000;

// 默认漫游 IFC 模型
const DEFAULT_MODEL_PATH = `${import.meta.env.BASE_URL}models/museum-complex.walk.json`;
const buildModelRomanNamePattern = () =>
  [116, 105, 97, 110, 119, 101, 105, 100, 111, 110, 103].reduce(
    (name, code) => name + String.fromCharCode(code),
    "",
  ) + "2?";
const MODEL_ROMAN_NAME_PATTERN = buildModelRomanNamePattern();
const MODEL_PERSON_NAME_PATTERN = new RegExp("\\u7530\\u7ef4\\u4e1c2?|" + MODEL_ROMAN_NAME_PATTERN, "gi");

function cleanModelText(value?: string | null) {
  return value ? value.replace(MODEL_PERSON_NAME_PATTERN, "默认模型") : "";
}

function cleanOptionalModelText(value?: string | null) {
  return value ? cleanModelText(value) : value || undefined;
}

const verifyElements: Element3D[] = [
  {
    id: "ifc-slab-ground",
    label: "板",
    name: "首层防滑地面板",
    type: "IfcSlab",
    material: "灰色防滑地砖",
    description: "人物漫游的主要可行走楼板。",
    length: 18,
    width: 12,
    height: 0.22,
    area: 216,
    unit: "m²",
    quantity_estimate: 216,
    pos_x: -9,
    pos_y: -6,
    pos_z: 0,
  },
  {
    id: "ifc-covering-ceiling",
    label: "覆盖层",
    name: "矿棉板吊顶",
    type: "IfcCovering",
    material: "矿棉吸音板",
    description: "室内吊顶面，漫游时提供室内空间边界。",
    length: 17.4,
    width: 11.4,
    height: 0.12,
    area: 198.36,
    unit: "m²",
    quantity_estimate: 198.36,
    pos_x: -8.7,
    pos_y: -5.7,
    pos_z: 3.35,
  },
  {
    id: "ifc-wall-north",
    label: "墙",
    name: "北侧外墙",
    type: "IfcWall",
    material: "加气混凝土砌块+涂料",
    description: "外围护墙体，靠近时会高亮并显示构件信息。",
    length: 18,
    width: 0.28,
    height: 3.2,
    volume: 16.13,
    unit: "m³",
    quantity_estimate: 16.13,
    pos_x: -9,
    pos_y: 5.72,
    pos_z: 0.22,
  },
  {
    id: "ifc-wall-west",
    label: "墙",
    name: "西侧外墙",
    type: "IfcWall",
    material: "加气混凝土砌块+涂料",
    length: 0.28,
    width: 12,
    height: 3.2,
    volume: 10.75,
    unit: "m³",
    quantity_estimate: 10.75,
    pos_x: -9,
    pos_y: -6,
    pos_z: 0.22,
  },
  {
    id: "ifc-wall-east",
    label: "墙",
    name: "东侧外墙",
    type: "IfcWall",
    material: "加气混凝土砌块+涂料",
    length: 0.28,
    width: 12,
    height: 3.2,
    volume: 10.75,
    unit: "m³",
    quantity_estimate: 10.75,
    pos_x: 8.72,
    pos_y: -6,
    pos_z: 0.22,
  },
  {
    id: "ifc-wall-south-left",
    label: "墙",
    name: "南侧外墙-入口左段",
    type: "IfcWall",
    material: "加气混凝土砌块+涂料",
    length: 6.8,
    width: 0.28,
    height: 3.2,
    volume: 6.09,
    unit: "m³",
    quantity_estimate: 6.09,
    pos_x: -9,
    pos_y: -6,
    pos_z: 0.22,
  },
  {
    id: "ifc-wall-south-right",
    label: "墙",
    name: "南侧外墙-入口右段",
    type: "IfcWall",
    material: "加气混凝土砌块+涂料",
    length: 6.8,
    width: 0.28,
    height: 3.2,
    volume: 6.09,
    unit: "m³",
    quantity_estimate: 6.09,
    pos_x: 2.2,
    pos_y: -6,
    pos_z: 0.22,
  },
  {
    id: "ifc-door-entry",
    label: "门",
    name: "入口双扇木门",
    type: "IfcDoor",
    material: "木饰面防火门",
    description: "入口处可识别门构件，不参与漫游碰撞。",
    length: 2.2,
    width: 0.12,
    height: 2.2,
    area: 4.84,
    unit: "m²",
    quantity_estimate: 4.84,
    pos_x: -1.1,
    pos_y: -6.06,
    pos_z: 0.22,
  },
  {
    id: "ifc-wall-partition-a",
    label: "墙",
    name: "室内隔墙-会议室下段",
    type: "IfcWallStandardCase",
    material: "轻钢龙骨石膏板",
    length: 0.22,
    width: 2.6,
    height: 3.05,
    volume: 1.74,
    unit: "m³",
    quantity_estimate: 1.74,
    pos_x: 0.85,
    pos_y: -3.6,
    pos_z: 0.22,
  },
  {
    id: "ifc-wall-partition-b",
    label: "墙",
    name: "室内隔墙-会议室上段",
    type: "IfcWallStandardCase",
    material: "轻钢龙骨石膏板",
    length: 0.22,
    width: 4.1,
    height: 3.05,
    volume: 2.75,
    unit: "m³",
    quantity_estimate: 2.75,
    pos_x: 0.85,
    pos_y: 0.1,
    pos_z: 0.22,
  },
  {
    id: "ifc-door-meeting",
    label: "门",
    name: "会议室单扇门",
    type: "IfcDoor",
    material: "木饰面门",
    length: 0.14,
    width: 1.1,
    height: 2.1,
    area: 2.31,
    unit: "m²",
    quantity_estimate: 2.31,
    pos_x: 0.88,
    pos_y: -1.2,
    pos_z: 0.22,
  },
  {
    id: "ifc-column-1",
    label: "柱",
    name: "西南角钢筋混凝土柱",
    type: "IfcColumn",
    material: "C30混凝土",
    length: 0.58,
    width: 0.58,
    height: 3.25,
    volume: 1.09,
    unit: "m³",
    quantity_estimate: 1.09,
    pos_x: -7.8,
    pos_y: -4.8,
    pos_z: 0.22,
  },
  {
    id: "ifc-column-2",
    label: "柱",
    name: "东北角钢筋混凝土柱",
    type: "IfcColumn",
    material: "C30混凝土",
    length: 0.58,
    width: 0.58,
    height: 3.25,
    volume: 1.09,
    unit: "m³",
    quantity_estimate: 1.09,
    pos_x: 7.0,
    pos_y: 4.5,
    pos_z: 0.22,
  },
  {
    id: "ifc-column-3",
    label: "柱",
    name: "中庭结构柱",
    type: "IfcColumn",
    material: "清水混凝土",
    description: "靠近此柱时，左下角会弹出构件名、材料和工程量。",
    length: 0.62,
    width: 0.62,
    height: 3.25,
    volume: 1.25,
    unit: "m³",
    quantity_estimate: 1.25,
    pos_x: -1.2,
    pos_y: 1.8,
    pos_z: 0.22,
  },
  {
    id: "ifc-beam-north",
    label: "梁",
    name: "北侧框架梁",
    type: "IfcBeam",
    material: "C30混凝土",
    length: 18,
    width: 0.38,
    height: 0.45,
    volume: 3.08,
    unit: "m³",
    quantity_estimate: 3.08,
    pos_x: -9,
    pos_y: 5.48,
    pos_z: 3.08,
  },
  {
    id: "ifc-beam-entry",
    label: "梁",
    name: "入口过梁",
    type: "IfcBeam",
    material: "C30混凝土",
    length: 7.1,
    width: 0.36,
    height: 0.42,
    volume: 1.07,
    unit: "m³",
    quantity_estimate: 1.07,
    pos_x: -3.55,
    pos_y: -5.92,
    pos_z: 3.05,
  },
  {
    id: "ifc-beam-partition",
    label: "梁",
    name: "会议室隔墙顶梁",
    type: "IfcBeam",
    material: "C30混凝土",
    length: 0.36,
    width: 9.1,
    height: 0.38,
    volume: 1.24,
    unit: "m³",
    quantity_estimate: 1.24,
    pos_x: 0.75,
    pos_y: -3.6,
    pos_z: 3.02,
  },
  {
    id: "ifc-window-north-1",
    label: "窗",
    name: "北立面铝合金窗 A",
    type: "IfcWindow",
    material: "双层中空玻璃",
    length: 2.2,
    width: 0.1,
    height: 1.25,
    area: 2.75,
    unit: "m²",
    quantity_estimate: 2.75,
    pos_x: -6.8,
    pos_y: 5.9,
    pos_z: 1.25,
  },
  {
    id: "ifc-window-north-2",
    label: "窗",
    name: "北立面铝合金窗 B",
    type: "IfcWindow",
    material: "双层中空玻璃",
    length: 2.4,
    width: 0.1,
    height: 1.25,
    area: 3,
    unit: "m²",
    quantity_estimate: 3,
    pos_x: 2.7,
    pos_y: 5.9,
    pos_z: 1.25,
  },
  {
    id: "ifc-window-east",
    label: "窗",
    name: "东侧高窗",
    type: "IfcWindow",
    material: "Low-E玻璃",
    length: 0.1,
    width: 2,
    height: 1.3,
    area: 2.6,
    unit: "m²",
    quantity_estimate: 2.6,
    pos_x: 8.9,
    pos_y: -1.4,
    pos_z: 1.35,
  },
  {
    id: "ifc-duct-main",
    label: "风管",
    name: "吊顶内矩形送风管",
    type: "IfcDuctSegment",
    material: "镀锌钢板",
    description: "机电风管构件，使用金属贴图显示。",
    length: 8.5,
    width: 0.45,
    height: 0.28,
    unit: "m",
    quantity_estimate: 8.5,
    pos_x: -6.8,
    pos_y: -0.4,
    pos_z: 2.85,
  },
  {
    id: "ifc-pipe-fire",
    label: "管道",
    name: "消防喷淋主管",
    type: "IfcPipeSegment",
    material: "热镀锌钢管",
    length: 0.18,
    width: 8.6,
    height: 0.18,
    unit: "m",
    quantity_estimate: 8.6,
    pos_x: -3.2,
    pos_y: -4.6,
    pos_z: 2.65,
  },
  {
    id: "ifc-cable-tray",
    label: "桥架",
    name: "弱电金属桥架",
    type: "IfcCableCarrierSegment",
    material: "喷塑金属桥架",
    length: 9.5,
    width: 0.22,
    height: 0.12,
    unit: "m",
    quantity_estimate: 9.5,
    pos_x: -2.8,
    pos_y: 3.2,
    pos_z: 2.58,
  },
];

// 博物馆场地元素：依据建筑模型外包范围生成市政道路、景观水池、绿植造景、
// 硬化铺装与长城肌理女儿墙，契合博物馆公共建筑场景布置需求。
function buildMuseumSiteElements(building: Element3D[]): Element3D[] {
  const site: Element3D[] = [];
  if (!building.length) return site;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = 0;
  for (const el of building) {
    if (el.pos_x == null || el.pos_y == null) continue;
    minX = Math.min(minX, el.pos_x);
    minY = Math.min(minY, el.pos_y);
    maxX = Math.max(maxX, el.pos_x + (el.length || 0));
    maxY = Math.max(maxY, el.pos_y + (el.width || 0));
    maxZ = Math.max(maxZ, (el.pos_z || 0) + (el.height || 0));
  }
  if (!isFinite(minX)) return site;

  const addSiteBox = (id: string, name: string, material: string,
    x: number, y: number, z: number, l: number, w: number, h: number) => {
    site.push({
      id: `site-${id}`, label: name, name,
      type: "IfcBuildingElementProxy", material,
      description: "博物馆场地景观元素",
      length: l, width: w, height: h, unit: "m",
      pos_x: x, pos_y: y, pos_z: z,
    } as Element3D);
  };

  const spanX = maxX - minX;
  // 场地功能分区沿建筑南侧外扩布置，互不侵占建筑轮廓
  addSiteBox("plaza", "入口广场（混凝土广场砖铺装）", "混凝土广场砖铺装",
    minX, minY - 16, 0, spanX, 14, 0.12);
  addSiteBox("road-south", "市政道路（沥青混凝土路面）", "沥青混凝土",
    minX - 20, minY - 30, 0, spanX + 40, 14, 0.1);
  addSiteBox("pool", "景观水池", "景观水池水面",
    maxX - 70, minY - 58, 0, 60, 26, 0.35);
  addSiteBox("lawn", "草坪绿化", "草坪绿植",
    minX + 6, minY - 58, 0, 64, 26, 0.18);
  for (let i = 0; i < 5; i += 1) {
    addSiteBox(`hedge-${i}`, "绿篱", "修剪绿篱绿化",
      minX + 10 + i * 12, minY - 50, 0.18, 8, 1.2, 0.9);
  }

  // 女儿墙：长城标志性凹凸垛口，沿建筑外轮廓屋面布置
  const parapetZ = maxZ;
  const thick = 0.42, bandH = 0.55, merlonH = 1.05, merlonLen = 1.5, gap = 1.1;
  const step = merlonLen + gap;
  addSiteBox("parapet-band-s", "女儿墙基带", "仿古砌筑女儿墙", minX, minY - thick, parapetZ, spanX, thick, bandH);
  addSiteBox("parapet-band-n", "女儿墙基带", "仿古砌筑女儿墙", minX, maxY, parapetZ, spanX, thick, bandH);
  addSiteBox("parapet-band-w", "女儿墙基带", "仿古砌筑女儿墙", minX, minY, parapetZ, thick, maxY - minY, bandH);
  addSiteBox("parapet-band-e", "女儿墙基带", "仿古砌筑女儿墙", maxX - thick, minY, parapetZ, thick, maxY - minY, bandH);
  const addMerlonRun = (x: number, y: number, lx: number, wy: number) => {
    const span = Math.max(lx, wy);
    const count = Math.floor((span - gap) / step);
    for (let i = 0; i < count; i += 1) {
      const offset = gap / 2 + i * step;
      addSiteBox(
        `parapet-merlon-${Math.round(x * 10)}-${Math.round(y * 10)}-${i}`,
        "女儿墙垛口", "仿古砌筑女儿墙",
        lx > 0 ? x + offset : x, wy > 0 ? y + offset : y, parapetZ + bandH,
        lx > 0 ? merlonLen : thick, wy > 0 ? merlonLen : thick, merlonH,
      );
    }
  };
  addMerlonRun(minX, minY - thick, spanX, 0);
  addMerlonRun(minX, maxY, spanX, 0);
  addMerlonRun(minX, minY, 0, maxY - minY);
  addMerlonRun(maxX - thick, minY, 0, maxY - minY);

  return site;
}

function ifcToElement3D(el: IfcElement): Element3D {
  return {
    id: cleanModelText(el.id),
    label: cleanModelText(el.label),
    name: cleanModelText(el.name),
    type: cleanModelText(el.type),
    element_type: cleanOptionalModelText(el.element_type),
    predefined_type: cleanOptionalModelText(el.predefined_type),
    object_type: cleanOptionalModelText(el.object_type),
    description: cleanOptionalModelText(el.description),
    material: cleanOptionalModelText(el.material),
    count: el.count,
    unit: cleanOptionalModelText(el.unit),
    quantity_estimate: el.quantity_estimate, confidence: el.confidence,
    pset_keys: el.pset_keys?.map(cleanModelText), length: el.length, width: el.width,
    height: el.height, thickness: el.thickness, area: el.area,
    volume: el.volume, pos_x: el.pos_x, pos_y: el.pos_y, pos_z: el.pos_z,
    mesh_vertices: el.mesh_vertices, mesh_indices: el.mesh_indices,
    mesh_kind: el.mesh_kind,
  };
}

function pickDisplayElements(status: IfcTaskStatus): Element3D[] {
  const raw = (status.preview_elements?.length ?? 0) > 0
    ? status.preview_elements
    : status.elements;
  return (raw ?? []).map(ifcToElement3D);
}

export default function WalkVerify() {
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);
  const [sceneElements, setSceneElements] = useState<Element3D[]>([]);
  const [sceneTitle, setSceneTitle] = useState("IFC 建筑漫游");
  const [taskStatus, setTaskStatus] = useState<IfcTaskStatus | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [polling, setPolling] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadProgress, setLoadProgress] = useState(0);
  // 退出过渡：先播 220ms 淡出再真正跳路由，避免“瞬间切走”的生硬感
  const [exiting, setExiting] = useState(false);
  const exitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [loadStage, setLoadStage] = useState("初始化漫游引擎");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const attemptsRef = useRef(0);
  const loadAbortRef = useRef<AbortController | null>(null);

  // 真实加载进度：按 fetch 流式下载字节数 / 解析 / 构建三个阶段推进
  const loadModel = useCallback(async () => {
    loadAbortRef.current?.abort();
    const controller = new AbortController();
    loadAbortRef.current = controller;

    setLoading(true);
    setLoadProgress(0);
    setLoadStage("初始化漫游引擎");

    try {
      const response = await fetch(DEFAULT_MODEL_PATH, { signal: controller.signal });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const totalBytes = Number(response.headers.get("content-length") || 0);
      const reader = response.body?.getReader();

      let rawData: { elements?: IfcElement[] };
      if (reader) {
        const chunks: Uint8Array[] = [];
        let receivedBytes = 0;
        setLoadStage("下载场景数据");
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            chunks.push(value);
            receivedBytes += value.length;
            const ratio = totalBytes > 0 ? receivedBytes / totalBytes : Math.min(0.99, receivedBytes / 2_000_000);
            // 下载阶段占 0-80%
            setLoadProgress(Math.min(80, Math.round(ratio * 80)));
          }
        }
        const merged = new Uint8Array(receivedBytes);
        let offset = 0;
        for (const chunk of chunks) { merged.set(chunk, offset); offset += chunk.length; }

        setLoadStage("解析 IFC 构件数据");
        setLoadProgress(85);
        // 让出一帧，保证进度条先渲染再进入 JSON.parse 阻塞
        await new Promise((r) => setTimeout(r, 16));
        rawData = JSON.parse(new TextDecoder("utf-8").decode(merged));
      } else {
        setLoadProgress(60);
        setLoadStage("解析 IFC 构件数据");
        rawData = await response.json();
      }

      setLoadStage("构建建筑场景");
      setLoadProgress(92);
      await new Promise((r) => setTimeout(r, 16));

      const elements: Element3D[] = (rawData.elements || []).map(ifcToElement3D);
      elements.push(...buildMuseumSiteElements(elements));
      setSceneElements(elements);
      setSceneTitle(`IFC 漫游场景 · ${elements.length} 个构件`);
      setLoadStage("准备漫游控制");
      setLoadProgress(100);
    } catch (error) {
      if ((error as Error)?.name === "AbortError") return;
      console.error("加载默认模型失败:", error);
      // 如果加载失败，使用备用示例数据
      setSceneElements(verifyElements);
      setSceneTitle("IFC 漫游核查场景");
    } finally {
      if (loadAbortRef.current === controller) {
        loadAbortRef.current = null;
        setLoading(false);
      }
    }
  }, []);

  // 加载默认漫游模型
  useEffect(() => {
    void loadModel();
  }, [loadModel]);

  const stopPoll = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    setPolling(false);
  }, []);

  const fetchStatus = useCallback(async (id: string, showMsg = false) => {
    const s = await api.getIfcParseResult(id);
    
    setTaskStatus(s);
    if (s.status === "done") {
      stopPoll();
      const elems = pickDisplayElements(s);
      if (elems.length > 0) { setSceneElements(elems); setSceneTitle("上传 IFC 漫游场景"); }
      if (showMsg) message.success(`解析完成，共 ${s.total_elements} 个构件`);
    } else if (s.status === "error") {
      stopPoll();
      if (showMsg) message.error(s.error || "解析失败");
    }
    return s;
  }, [stopPoll]);

  const startPoll = useCallback((id: string) => {
    stopPoll();
    attemptsRef.current = 0;
    setPolling(true);
    pollRef.current = setInterval(async () => {
      attemptsRef.current += 1;
      try {
        const s = await fetchStatus(id, true);
        if (s.status !== "processing" || attemptsRef.current >= WALK_TASK_POLL_LIMIT) stopPoll();
      } catch { stopPoll(); }
    }, WALK_TASK_POLL_INTERVAL_MS);
  }, [fetchStatus, stopPoll]);

  const handleUpload = useCallback(async (file: File) => {
    setSubmitting(true);
    try {
      const res = await api.uploadIfcFile(file);
      
      setTaskStatus(res as IfcTaskStatus);
      if (res.status === "processing") startPoll(res.taskId);
      if (res.status === "done") {
        const elems = pickDisplayElements(res as IfcTaskStatus);
        if (elems.length > 0) { setSceneElements(elems); setSceneTitle("上传 IFC 漫游场景"); }
      }
    } catch (e: unknown) { message.error(e instanceof Error ? e.message : "上传失败"); }
    finally { setSubmitting(false); }
  }, [startPoll]);

  const handleRestoreSample = useCallback(() => {
    stopPoll();
    setTaskStatus(null);
    void loadModel();
  }, [stopPoll, loadModel]);

  useEffect(() => () => {
    stopPoll();
    loadAbortRef.current?.abort();
    if (exitTimerRef.current) clearTimeout(exitTimerRef.current);
  }, [stopPoll]);

  const progressPercent = taskStatus?.progress
    ? Math.min(100, Math.round(parseFloat(taskStatus.progress) || (taskStatus.status === "done" ? 100 : 0)))
    : 0;

  const goBack = useCallback(() => {
    if (exiting) return;
    setExiting(true);
    exitTimerRef.current = setTimeout(() => {
      if (window.history.length > 1) navigate(-1);
      else navigate("/dashboard");
    }, 220);
  }, [navigate, exiting]);

  const goHome = useCallback(() => {
    if (exiting) return;
    setExiting(true);
    exitTimerRef.current = setTimeout(() => {
      navigate("/dashboard");
    }, 220);
  }, [navigate, exiting]);

  return (
    <ConfigProvider
      theme={{
        algorithm: theme.darkAlgorithm,
        token: {
          colorPrimary: "#3d8bff",
          borderRadius: 8,
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif',
        },
      }}
    >
      <div className={`walk-tour-root${exiting ? " walk-tour-exiting" : ""}`} style={{ width: "100vw", height: "100vh", background: "#0d1f3c", position: "relative", display: "flex", flexDirection: "column" }}>
        {/* 顶部品牌栏 · 与主应用同款工程蓝，衔接侧边栏视觉 */}
        <header style={{
          flexShrink: 0,
          height: 48,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 16px",
          background: "linear-gradient(180deg, #132d52, #0d1f3c)",
          borderBottom: "1px solid rgba(80, 160, 255, 0.16)",
          zIndex: 30,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{
              display: "grid", placeItems: "center",
              width: 32, height: 32, borderRadius: 8,
              background: "linear-gradient(135deg, #3d8bff, #1456b8)",
              border: "1px solid rgba(80, 160, 255, 0.35)",
              boxShadow: "0 0 12px rgba(61, 139, 255, 0.35)",
            }}>
              <span className="material-symbols-outlined" style={{ fontSize: 18, color: "#e8f2ff" }}>architecture</span>
            </div>
            <div className="walk-brand" style={{ lineHeight: 1.2 }}>
              <div className="walk-brand-title" style={{ fontSize: 15, fontWeight: 700, color: "#e2e8f0", letterSpacing: 0.5 }}>筑衡</div>
              <div className="walk-brand-subtitle" style={{ fontSize: 10, color: "#64748b" }}>全过程工程造价协同管控平台</div>
            </div>
          </div>

          <div className="walk-context" style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span className="material-symbols-outlined" style={{ fontSize: 16, color: "#38bdf8" }}>deployed_code</span>
            <span style={{ fontSize: 13, fontWeight: 600, color: "#94a3b8" }}>模型漫游复核</span>
            {sceneElements.length > 0 && (
              <Tag color="blue" style={{ marginLeft: 4 }}>{sceneElements.length} 构件</Tag>
            )}
          </div>

          <div className="walk-header-actions" style={{ display: "flex", gap: 8 }}>
            <Button size="small" icon={<ArrowLeftOutlined />} onClick={goBack}>返回</Button>
            <Button size="small" icon={<HomeOutlined />} onClick={goHome}>工作台</Button>
          </div>
        </header>

        {/* 3D 场景容器 */}
        <div style={{ flex: 1, position: "relative", overflow: "hidden", zIndex: 40 }}>
          {/* 加载状态 — 进度条 */}
          {loading && (
            <div style={{
              position: "absolute",
              inset: 0,
              zIndex: 100,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "rgba(13, 31, 60, 0.96)",
            }}>
              <div className="walk-tour-loading-card" style={{
                width: 360,
                maxWidth: "90%",
                padding: "32px 28px",
                borderRadius: 14,
                background: "linear-gradient(180deg, rgba(19, 45, 82, 0.92), rgba(13, 31, 60, 0.96))",
                border: "1px solid rgba(80, 160, 255, 0.25)",
                boxShadow: "0 16px 48px rgba(0, 0, 0, 0.5)",
                textAlign: "center",
              }}>
                <div style={{
                  display: "grid", placeItems: "center",
                  width: 48, height: 48, borderRadius: 12,
                  background: "linear-gradient(135deg, rgba(61, 139, 255, 0.22), rgba(61, 139, 255, 0.08))",
                  border: "1px solid rgba(80, 160, 255, 0.35)",
                  margin: "0 auto 16px",
                }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 26, color: "#4dd4ff" }}>deployed_code</span>
                </div>
                <div style={{ fontSize: 15, fontWeight: 600, color: "#e2e8f0", marginBottom: 4 }}>正在准备漫游场景</div>
                <div style={{ fontSize: 12, color: "#64748b", marginBottom: 18 }}>{loadStage}</div>
                <Progress
                  percent={Math.round(loadProgress)}
                  status="active"
                  strokeColor={{ from: "#3d8bff", to: "#4dd4ff" }}
                  railColor="rgba(80, 160, 255, 0.12)"
                />
              </div>
            </div>
          )}

          {/* 浮动工具栏 */}
          <div className="walk-tour-floatbar" style={{
            position: "absolute", top: 14, left: 14, zIndex: 10,
            display: "flex", alignItems: "center", gap: 8,
            flexWrap: "wrap", maxWidth: "min(540px, calc(100% - 28px))",
            boxSizing: "border-box",
            background: "rgba(13, 31, 60, 0.85)", borderRadius: 8,
            padding: "8px 10px", backdropFilter: "blur(14px)",
            border: "1px solid rgba(80, 160, 255, 0.2)", pointerEvents: "auto",
            boxShadow: "0 8px 24px rgba(0, 0, 0, 0.3)",
          }}>
            <input ref={fileRef} type="file" accept=".ifc,.ifczip" hidden
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUpload(f); e.target.value = ""; }} />
            <Button size="small" type="primary" icon={<CloudUploadOutlined />}
              loading={submitting} onClick={() => fileRef.current?.click()}>
              上传 IFC
            </Button>
            <Button size="small" icon={<ReloadOutlined />} onClick={handleRestoreSample}>
              默认模型
            </Button>
            {taskStatus && (
              <Space size={6} style={{ marginLeft: 4 }}>
                <Tag color={taskStatus.status === "done" ? "green" : taskStatus.status === "error" ? "red" : "blue"}>
                  {taskStatus.status === "done" ? "已解析" : taskStatus.status === "error" ? "失败" : "解析中"}
                </Tag>
                {polling && <Progress percent={progressPercent} size="small" style={{ width: 80 }} />}
                {taskStatus.total_elements > 0 && (
                  <Typography.Text style={{ color: "#64748b", fontSize: 11 }}>
                    {taskStatus.total_elements} 构件
                  </Typography.Text>
                )}
              </Space>
            )}
          </div>

          <ErrorBoundary title="3D 视图无法显示" inline>
            <Ifc3DViewer
              elements={sceneElements}
              initialViewMode="walk"
              presentationMode
              materialTheme="museum"
              sceneTitle={sceneTitle}
              onExitWalkMode={goBack}
              style={{ width: "100%", height: "100%", minHeight: "100%", borderRadius: 0 }}
            />
          </ErrorBoundary>
        </div>
      </div>
    </ConfigProvider>
  );
}
